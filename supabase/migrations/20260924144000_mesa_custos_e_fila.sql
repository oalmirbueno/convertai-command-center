-- Mesa v6: custos de produção e fila de prioridades (formato documentado em
-- docs/mesa/v6/migrations/20260924180000_mesa_custos_e_fila.sql).
-- Só acrescenta: duas funções de leitura e um índice.

CREATE INDEX IF NOT EXISTS ia_usos_referencia_idx
  ON public.ia_usos (referencia_id)
  WHERE referencia_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.mesa_custos_producao(_inicio date DEFAULT NULL, _fim date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _uid uuid := auth.uid();
  _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _ini date;
  _fim_ex date;
  _ts_ini timestamptz;
  _ts_fim timestamptz;
  _linhas jsonb;
BEGIN
  IF _uid IS NULL OR NOT (
    COALESCE(public.has_role(_uid, 'admin'::public.app_role), false)
    OR COALESCE(public.has_role(_uid, 'manager'::public.app_role), false)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MESA_CUSTOS_SO_ADMIN_OU_GESTOR';
  END IF;

  _ini := COALESCE(_inicio, date_trunc('month', _hoje::timestamp)::date);
  _fim_ex := COALESCE(_fim, (date_trunc('month', _hoje::timestamp) + interval '1 month')::date);
  IF _fim_ex <= _ini OR _fim_ex - _ini > 1200 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MESA_CUSTOS_PERIODO_INVALIDO';
  END IF;
  _ts_ini := _ini::timestamp AT TIME ZONE 'America/Sao_Paulo';
  _ts_fim := _fim_ex::timestamp AT TIME ZONE 'America/Sao_Paulo';

  WITH clientes AS (
    SELECT p.id,
           COALESCE(NULLIF(btrim(p.company_name), ''), NULLIF(btrim(p.full_name), ''), 'Cliente') AS nome
      FROM public.profiles p
     WHERE COALESCE(public.can_access_client(p.id), false)
  ),
  usos AS (
    SELECT u.client_id,
           date_trunc('month', u.criado_em AT TIME ZONE 'America/Sao_Paulo')::date AS mes,
           CASE
             WHEN u.agente = 'gerador_imagem' THEN 'imagem'
             WHEN u.agente = 'jev' OR u.tarefa = 'verificacao' THEN 'conferencia'
             WHEN u.tarefa IN ('leitura_referencia', 'contexto') OR u.agente IN ('leitor', 'contexto') THEN 'leitura'
             ELSE 'planejamento'
           END AS categoria,
           u.custo_usd,
           u.imagens,
           u.tarefa,
           u.agente
      FROM public.ia_usos u
      JOIN clientes c ON c.id = u.client_id
     WHERE u.criado_em >= _ts_ini AND u.criado_em < _ts_fim
  ),
  gasto AS (
    SELECT client_id,
           mes,
           COALESCE(sum(custo_usd), 0) AS total,
           COALESCE(sum(custo_usd) FILTER (WHERE categoria = 'planejamento'), 0) AS planejamento,
           COALESCE(sum(custo_usd) FILTER (WHERE categoria = 'imagem'), 0) AS imagem,
           COALESCE(sum(custo_usd) FILTER (WHERE categoria = 'conferencia'), 0) AS conferencia,
           COALESCE(sum(custo_usd) FILTER (WHERE categoria = 'leitura'), 0) AS leitura,
           count(*) AS usos,
           COALESCE(sum(imagens) FILTER (WHERE agente = 'gerador_imagem'), 0) AS imagens_geradas,
           count(*) FILTER (WHERE tarefa = 'verificacao' AND agente NOT IN ('jev', 'gerador_imagem')) AS conferencias
      FROM usos
     GROUP BY client_id, mes
  ),
  trabalhos AS (
    SELECT t.id,
           t.client_id,
           date_trunc('month', t.criado_em AT TIME ZONE 'America/Sao_Paulo')::date AS mes,
           COALESCE(t.tipo, 'social') AS tipo,
           tk.delivery_type,
           greatest(
             (SELECT count(DISTINCT c->>'ordem') FROM jsonb_array_elements(t.cards) AS c),
             1
           ) AS laminas,
           jsonb_array_length(t.cards) AS versoes,
           (SELECT count(*) FROM jsonb_array_elements(t.cards) AS c
             WHERE jsonb_typeof(c->'autocorrecao') = 'object') AS automaticas,
           COALESCE(
             NULLIF((SELECT sum(u.custo_usd) FROM public.ia_usos u
                      WHERE u.referencia_tipo = 'estudio_trabalho' AND u.referencia_id = t.id), 0),
             t.custo_usd,
             0
           ) AS custo
      FROM public.estudio_trabalhos t
      JOIN clientes c ON c.id = t.client_id
      LEFT JOIN public.tasks tk ON tk.id = t.task_id
     WHERE t.criado_em >= _ts_ini AND t.criado_em < _ts_fim
       AND jsonb_array_length(t.cards) > 0
  ),
  pecas AS (
    SELECT tr.*,
           CASE
             WHEN tr.tipo = 'ads' THEN 'criativo'
             WHEN tr.delivery_type = 'carousel' OR tr.laminas > 1 THEN 'carrossel'
             ELSE 'post'
           END AS peca
      FROM trabalhos tr
  ),
  producao AS (
    SELECT client_id,
           mes,
           count(*) FILTER (WHERE peca = 'post') AS posts,
           count(*) FILTER (WHERE peca = 'carrossel') AS carrosseis,
           COALESCE(sum(laminas) FILTER (WHERE peca IN ('post', 'carrossel')), 0) AS laminas,
           COALESCE(sum(laminas) FILTER (WHERE peca = 'carrossel'), 0) AS laminas_carrossel,
           count(*) FILTER (WHERE peca = 'criativo') AS criativos,
           COALESCE(sum(versoes), 0) AS versoes,
           COALESCE(sum(greatest(versoes - laminas, 0)), 0) AS refacoes,
           COALESCE(sum(automaticas), 0) AS automaticas,
           COALESCE(sum(custo) FILTER (WHERE peca = 'post'), 0) AS custo_posts,
           COALESCE(sum(custo) FILTER (WHERE peca = 'carrossel'), 0) AS custo_carrosseis,
           COALESCE(sum(custo) FILTER (WHERE peca = 'criativo'), 0) AS custo_criativos
      FROM pecas
     GROUP BY client_id, mes
  ),
  juntos AS (
    SELECT COALESCE(g.client_id, p.client_id) AS client_id,
           COALESCE(g.mes, p.mes) AS mes,
           g.total, g.planejamento, g.imagem, g.conferencia, g.leitura, g.usos, g.imagens_geradas, g.conferencias,
           p.posts, p.carrosseis, p.laminas, p.laminas_carrossel, p.criativos, p.versoes, p.refacoes, p.automaticas,
           p.custo_posts, p.custo_carrosseis, p.custo_criativos
      FROM gasto g
      FULL OUTER JOIN producao p ON p.client_id = g.client_id AND p.mes = g.mes
  )
  SELECT jsonb_agg(
           jsonb_build_object(
             'client_id', j.client_id,
             'nome', c.nome,
             'mes', j.mes,
             'gasto_total_usd', round(COALESCE(j.total, 0), 6),
             'gasto_planejamento_usd', round(COALESCE(j.planejamento, 0), 6),
             'gasto_imagem_usd', round(COALESCE(j.imagem, 0), 6),
             'gasto_conferencia_usd', round(COALESCE(j.conferencia, 0), 6),
             'gasto_leitura_usd', round(COALESCE(j.leitura, 0), 6),
             'usos', COALESCE(j.usos, 0),
             'imagens_geradas', COALESCE(j.imagens_geradas, 0),
             'conferencias', COALESCE(j.conferencias, 0),
             'posts', COALESCE(j.posts, 0),
             'carrosseis', COALESCE(j.carrosseis, 0),
             'laminas', COALESCE(j.laminas, 0),
             'laminas_carrossel', COALESCE(j.laminas_carrossel, 0),
             'criativos', COALESCE(j.criativos, 0),
             'versoes', COALESCE(j.versoes, 0),
             'refacoes', COALESCE(j.refacoes, 0),
             'correcoes_automaticas', COALESCE(j.automaticas, 0),
             'custo_posts_usd', round(COALESCE(j.custo_posts, 0), 6),
             'custo_carrosseis_usd', round(COALESCE(j.custo_carrosseis, 0), 6),
             'custo_criativos_usd', round(COALESCE(j.custo_criativos, 0), 6)
           )
           ORDER BY j.mes, c.nome
         )
    INTO _linhas
    FROM juntos j
    JOIN clientes c ON c.id = j.client_id;

  RETURN jsonb_build_object(
    'versao', 1,
    'inicio', _ini,
    'fim', _fim_ex,
    'gerado_em', now(),
    'linhas', COALESCE(_linhas, '[]'::jsonb)
  );
END;
$body$;

REVOKE ALL ON FUNCTION public.mesa_custos_producao(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesa_custos_producao(date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.mesa_fila_prioridades()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _uid uuid := auth.uid();
  _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _mes_atual date;
  _mes_seguinte date;
  _fim date;
  _clientes jsonb;
BEGIN
  IF _uid IS NULL OR NOT COALESCE(public.is_staff(_uid), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MESA_FILA_SO_EQUIPE';
  END IF;

  _mes_atual := date_trunc('month', _hoje::timestamp)::date;
  _mes_seguinte := (_mes_atual + interval '1 month')::date;
  _fim := (_mes_atual + interval '2 months')::date;

  WITH base AS (
    SELECT p.id,
           COALESCE(NULLIF(btrim(p.company_name), ''), NULLIF(btrim(p.full_name), ''), 'Cliente') AS nome,
           au.last_sign_in_at
      FROM public.profiles p
      LEFT JOIN auth.users au ON au.id = p.id
     WHERE p.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role = 'client'::public.app_role)
       AND COALESCE(public.can_access_client(p.id), false)
  ),
  aprovacao AS (
    SELECT f.client_id,
           count(*) AS n,
           min(COALESCE(f.approval_requested_at, f.created_at)) AS desde
      FROM public.files f
      JOIN base b ON b.id = f.client_id
     WHERE f.parent_file_id IS NULL
       AND f.archived_at IS NULL
       AND f.visibility = 'approval'
       AND f.approval_status = 'pending'
       AND f.folder IN ('materiais', 'criativos')
       AND NOT EXISTS (
         SELECT 1 FROM public.files r
          WHERE r.revision_of_file_id = f.id AND r.archived_at IS NULL
       )
     GROUP BY f.client_id
  ),
  revisao AS (
    SELECT f.client_id, count(*) AS n, min(f.created_at) AS desde
      FROM public.files f
      JOIN base b ON b.id = f.client_id
     WHERE f.parent_file_id IS NULL
       AND f.archived_at IS NULL
       AND f.agency_approval_status = 'pending'
     GROUP BY f.client_id
  ),
  ultimos AS (
    SELECT DISTINCT ON (COALESCE(t.task_id, t.id)) t.client_id, t.status, t.entrega_status
      FROM public.estudio_trabalhos t
      JOIN base b ON b.id = t.client_id
     WHERE COALESCE(t.tipo, 'social') = 'social'
       AND t.atualizado_em > now() - interval '60 days'
     ORDER BY COALESCE(t.task_id, t.id), t.criado_em DESC
  ),
  trabalhos AS (
    SELECT client_id,
           count(*) FILTER (WHERE entrega_status IS NULL AND status IN ('pronto', 'entregue')) AS prontas,
           count(*) FILTER (WHERE entrega_status = 'reprovado') AS reprovados,
           count(*) FILTER (WHERE entrega_status = 'precisa_de_atencao') AS atencao,
           count(*) AS total
      FROM ultimos
     GROUP BY client_id
  ),
  itens AS (
    SELECT pr.client_id,
           t.due_date,
           date_trunc('month', t.due_date::timestamp)::date AS mes,
           (
             t.status IN ('done', 'review')
             OR EXISTS (
               SELECT 1 FROM public.estudio_trabalhos e
                WHERE e.task_id = t.id AND jsonb_array_length(e.cards) > 0
             )
             OR EXISTS (
               SELECT 1
                 FROM public.editorial_post_internal epi
                 JOIN public.editorial_posts ep ON ep.id = epi.post_id
                WHERE epi.task_id = t.id
                  AND ep.archived_at IS NULL
                  AND COALESCE(ep.production_status, '') <> 'archived'
                  AND (
                    ep.primary_file_id IS NOT NULL
                    OR EXISTS (
                      SELECT 1 FROM public.editorial_publications pub
                       WHERE pub.post_id = ep.id AND pub.file_id IS NOT NULL AND pub.status <> 'cancelled'
                    )
                  )
             )
             OR EXISTS (SELECT 1 FROM public.task_attachments a WHERE a.task_id = t.id)
           ) AS tem_arte
      FROM public.tasks t
      JOIN public.projects pr ON pr.id = t.project_id AND pr.deleted_at IS NULL
      JOIN base b ON b.id = pr.client_id
     WHERE t.deleted_at IS NULL
       AND t.delivery_type IN ('carousel', 'static', 'design')
       AND t.due_date >= _mes_atual
       AND t.due_date < _fim
  ),
  meses AS (
    SELECT b.id AS client_id,
           m.mes,
           count(i.due_date) AS itens,
           count(i.due_date) FILTER (WHERE NOT i.tem_arte AND i.due_date >= _hoje) AS sem_arte,
           min(i.due_date) FILTER (WHERE NOT i.tem_arte AND i.due_date >= _hoje) AS proximo_sem_arte,
           EXISTS (
             SELECT 1 FROM public.calendario_propostas cp
              WHERE cp.client_id = b.id
                AND cp.status IN ('temas', 'detalhando', 'pronta')
                AND cp.periodo_inicio < (m.mes + interval '1 month')::date
                AND cp.periodo_fim >= m.mes
           ) AS proposta_aberta
      FROM base b
      CROSS JOIN (VALUES (_mes_atual), (_mes_seguinte)) AS m(mes)
      LEFT JOIN itens i ON i.client_id = b.id AND i.mes = m.mes
     GROUP BY b.id, m.mes
  ),
  ativos AS (
    SELECT b.*
      FROM base b
     WHERE EXISTS (
             SELECT 1 FROM public.tasks t
               JOIN public.projects pr ON pr.id = t.project_id AND pr.deleted_at IS NULL
              WHERE pr.client_id = b.id
                AND t.deleted_at IS NULL
                AND t.delivery_type IN ('carousel', 'static', 'design')
                AND t.due_date >= _hoje - 90
           )
        OR EXISTS (SELECT 1 FROM public.mesa_cliente_config cfg WHERE cfg.client_id = b.id AND cfg.posts_por_mes IS NOT NULL)
        OR EXISTS (SELECT 1 FROM trabalhos tr WHERE tr.client_id = b.id)
        OR EXISTS (SELECT 1 FROM aprovacao ap WHERE ap.client_id = b.id)
  )
  SELECT jsonb_agg(
           jsonb_build_object(
             'client_id', a.id,
             'nome', a.nome,
             'ultimo_acesso', a.last_sign_in_at,
             'posts_por_mes', cfg.posts_por_mes,
             'aprovacao_pendentes', COALESCE(ap.n, 0),
             'aprovacao_desde', ap.desde,
             'revisao_pendentes', COALESCE(rv.n, 0),
             'revisao_desde', rv.desde,
             'reprovados', COALESCE(tr.reprovados, 0),
             'prontas_para_enviar', COALESCE(tr.prontas, 0),
             'precisam_atencao', COALESCE(tr.atencao, 0),
             'meses', (
               SELECT jsonb_agg(
                        jsonb_build_object(
                          'mes', m.mes,
                          'itens', m.itens,
                          'sem_arte', m.sem_arte,
                          'proximo_sem_arte', m.proximo_sem_arte,
                          'proposta_aberta', m.proposta_aberta
                        )
                        ORDER BY m.mes
                      )
                 FROM meses m
                WHERE m.client_id = a.id
             )
           )
           ORDER BY a.nome
         )
    INTO _clientes
    FROM ativos a
    LEFT JOIN public.mesa_cliente_config cfg ON cfg.client_id = a.id
    LEFT JOIN aprovacao ap ON ap.client_id = a.id
    LEFT JOIN revisao rv ON rv.client_id = a.id
    LEFT JOIN trabalhos tr ON tr.client_id = a.id;

  RETURN jsonb_build_object(
    'versao', 1,
    'hoje', _hoje,
    'acesso_conhecido', true,
    'clientes', COALESCE(_clientes, '[]'::jsonb)
  );
END;
$body$;

REVOKE ALL ON FUNCTION public.mesa_fila_prioridades() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesa_fila_prioridades() TO authenticated;

-- Correção da semente da Mesa Ads (parte 3): o padrão "Reforma: obra entregue
-- limpa" é de seguidores (a gravação saiu com reconhecimento).
UPDATE public.ads_referencias
   SET ficha = jsonb_set(ficha, '{objetivo}', '"seguidores"')
 WHERE client_id IS NULL AND origem = 'padrao' AND titulo = 'Reforma: obra entregue limpa'
   AND ficha->>'objetivo' IS DISTINCT FROM 'seguidores';