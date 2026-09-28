-- ═══════════════════════════════════════════════════════════════════════
-- PR-01 · PRIORIDADES DA MESA: SÓ CLIENTE DA MESA, MÊS FEITO E BOTÃO "FEITO"
-- (frente PR, 28/09). NÃO APLICADO.
--
-- Pedido do dono (28/09): "Nas prioridades, ele tem que puxar só os que estão
-- ativos (...) só os que estiverem dentro da mesa" e "Tem que ter a opção de
-- 'feito'. Se ele não reconhecer sozinho, eu dou feito."
--
-- O que este SQL faz (idempotente, pode rodar de novo; só amplia):
--
--   1) public.mesa_fila_feitos: o "Feito" da fila. Uma linha por cliente,
--      tipo de ação e mês (periodo = AAAA-MM-01), com a quantidade e a
--      referência (último pedido de aprovação) do momento em que marcou,
--      quem marcou e quando. Desfazer ARQUIVA (arquivado_em/arquivado_por),
--      nunca apaga. Só uma marca ativa por (cliente, tipo, mês).
--      RLS: a equipe com acesso ao cliente LÊ (is_staff + can_access_client);
--      ninguém escreve direto, só pelas duas funções abaixo.
--   2) public.mesa_fila_marcar_feito(cliente, tipo, mês, quantidade, referência)
--      e public.mesa_fila_desfazer_feito(id): SECURITY DEFINER, conferem
--      is_staff e can_access_client antes de gravar.
--   3) public.mesa_fila_prioridades() (CREATE OR REPLACE a partir do texto
--      atual do banco, lido em 28/09), versão 2:
--        a) só entra cliente DENTRO DA MESA, a mesma regra do seletor
--           (src/components/mesa/clientesDaMesa.ts, mesa 'organica'):
--           escolha 'incluir' da equipe, OU plano ativo (plan_status
--           'active'), não avulso (client_type <> 'one_off') e sem escolha
--           'retirar'. Sai o critério antigo de "teve movimento em 90 dias",
--           que punha na fila Ajenda (plano inativo), Jalimpo (retirado da
--           Mesa) e Vivideo (plano em pausa);
--        b) meses: o atual e os 3 seguintes (antes só 2). Cada mês ganha
--           'pecas' (arte ou vídeo, a mesma lista da aba Mês:
--           FORMATOS_DE_PECA) e 'proposta_gravada' (plano do mês gravado no
--           calendário). 'itens' e 'sem_arte' seguem só de arte;
--        c) 'aprovacao_ultimo' (pedido de aprovação mais novo), para o
--           "Feito" de cobrar voltar quando chegar pedido novo;
--        d) 'feitos': as marcas ativas do cliente a partir do mês passado,
--           com o nome de quem marcou.
--      Continua: só equipe (is_staff), SECURITY DEFINER, search_path vazio,
--      can_access_client por cliente, último acesso só com a data.
--
-- Como conferir depois de aplicar (SQL Editor, logado como admin não serve:
-- a função lê auth.uid(); conferir pela tela ou pelas consultas abaixo):
--   select count(*) from public.mesa_fila_feitos;                          -- 0
--   select polname from pg_policy where polrelid = 'public.mesa_fila_feitos'::regclass;
--   select has_table_privilege('authenticated', 'public.mesa_fila_feitos', 'INSERT'); -- false
--   select pg_get_functiondef('public.mesa_fila_prioridades()'::regprocedure) like '%mesa_cliente_escolhas%'; -- true
-- ═══════════════════════════════════════════════════════════════════════

-- 1) Tabela das marcas de "Feito" ----------------------------------------

CREATE TABLE IF NOT EXISTS public.mesa_fila_feitos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('resolver', 'gerar_mes', 'gerar_artes', 'cobrar', 'ajustar', 'entregar', 'revisar', 'completar_mes')),
  periodo date NOT NULL CHECK (extract(day FROM periodo) = 1),
  quantidade integer NOT NULL DEFAULT 0 CHECK (quantidade >= 0),
  referencia timestamptz,
  marcado_por uuid NOT NULL,
  marcado_em timestamptz NOT NULL DEFAULT now(),
  arquivado_em timestamptz,
  arquivado_por uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS mesa_fila_feitos_ativo_uidx
  ON public.mesa_fila_feitos (client_id, tipo, periodo)
  WHERE arquivado_em IS NULL;

CREATE INDEX IF NOT EXISTS mesa_fila_feitos_cliente_idx
  ON public.mesa_fila_feitos (client_id, periodo);

ALTER TABLE public.mesa_fila_feitos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mesa_fila_feitos_staff_read ON public.mesa_fila_feitos;
CREATE POLICY mesa_fila_feitos_staff_read ON public.mesa_fila_feitos
  FOR SELECT TO authenticated
  USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

REVOKE ALL ON public.mesa_fila_feitos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mesa_fila_feitos TO authenticated;
GRANT ALL ON public.mesa_fila_feitos TO service_role;

-- 2) Marcar e desfazer ---------------------------------------------------

CREATE OR REPLACE FUNCTION public.mesa_fila_marcar_feito(
  _client_id uuid,
  _tipo text,
  _periodo date,
  _quantidade integer DEFAULT 0,
  _referencia timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _linha public.mesa_fila_feitos;
BEGIN
  IF _uid IS NULL OR NOT COALESCE(public.is_staff(_uid), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MESA_FILA_SO_EQUIPE';
  END IF;
  IF _client_id IS NULL OR NOT COALESCE(public.can_access_client(_client_id), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MESA_FILA_CLIENTE_FORA_DO_ACESSO';
  END IF;
  -- Id conferido contra o banco (cliente de verdade, não apagado).
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _client_id AND p.deleted_at IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MESA_FILA_CLIENTE_NAO_ENCONTRADO';
  END IF;
  IF _tipo IS NULL OR _tipo NOT IN ('resolver', 'gerar_mes', 'gerar_artes', 'cobrar', 'ajustar', 'entregar', 'revisar', 'completar_mes') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MESA_FILA_TIPO_DESCONHECIDO';
  END IF;
  IF _periodo IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MESA_FILA_PERIODO_INVALIDO';
  END IF;

  -- Marca de novo o que já estava marcado (voltou porque cresceu): a antiga
  -- vai para o arquivo, a nova fica com a quantidade de agora.
  UPDATE public.mesa_fila_feitos
     SET arquivado_em = now(), arquivado_por = _uid
   WHERE client_id = _client_id
     AND tipo = _tipo
     AND periodo = date_trunc('month', _periodo::timestamp)::date
     AND arquivado_em IS NULL;

  INSERT INTO public.mesa_fila_feitos (client_id, tipo, periodo, quantidade, referencia, marcado_por)
  VALUES (_client_id, _tipo, date_trunc('month', _periodo::timestamp)::date, GREATEST(COALESCE(_quantidade, 0), 0), _referencia, _uid)
  RETURNING * INTO _linha;

  RETURN jsonb_build_object(
    'id', _linha.id,
    'tipo', _linha.tipo,
    'periodo', _linha.periodo,
    'quantidade', _linha.quantidade,
    'referencia', _linha.referencia,
    'marcado_em', _linha.marcado_em,
    'marcado_por_nome', (SELECT NULLIF(btrim(p.full_name), '') FROM public.profiles p WHERE p.id = _uid)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mesa_fila_marcar_feito(uuid, text, date, integer, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesa_fila_marcar_feito(uuid, text, date, integer, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.mesa_fila_desfazer_feito(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _cliente uuid;
BEGIN
  IF _uid IS NULL OR NOT COALESCE(public.is_staff(_uid), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MESA_FILA_SO_EQUIPE';
  END IF;
  SELECT f.client_id INTO _cliente FROM public.mesa_fila_feitos f WHERE f.id = _id;
  IF _cliente IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MESA_FILA_FEITO_NAO_ENCONTRADO';
  END IF;
  IF NOT COALESCE(public.can_access_client(_cliente), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MESA_FILA_CLIENTE_FORA_DO_ACESSO';
  END IF;
  -- Desfazer arquiva: a marca continua no histórico.
  UPDATE public.mesa_fila_feitos
     SET arquivado_em = now(), arquivado_por = _uid
   WHERE id = _id AND arquivado_em IS NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.mesa_fila_desfazer_feito(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesa_fila_desfazer_feito(uuid) TO authenticated;

-- 3) A fila, versão 2 ----------------------------------------------------

CREATE OR REPLACE FUNCTION public.mesa_fila_prioridades()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _mes_atual date;
  _fim date;
  _clientes jsonb;
BEGIN
  IF _uid IS NULL OR NOT COALESCE(public.is_staff(_uid), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MESA_FILA_SO_EQUIPE';
  END IF;

  _mes_atual := date_trunc('month', _hoje::timestamp)::date;
  -- O mês atual e os 3 seguintes: a fila age sobre os 2 primeiros e mostra
  -- o que já está pronto nos outros.
  _fim := (_mes_atual + interval '4 months')::date;

  WITH base AS (
    -- Só cliente DENTRO DA MESA (mesma regra do seletor, mesa 'organica').
    SELECT p.id,
           COALESCE(NULLIF(btrim(p.company_name), ''), NULLIF(btrim(p.full_name), ''), 'Cliente') AS nome,
           au.last_sign_in_at
      FROM public.profiles p
      LEFT JOIN auth.users au ON au.id = p.id
     WHERE p.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role = 'client'::public.app_role)
       AND COALESCE(public.can_access_client(p.id), false)
       AND (
         EXISTS (
           SELECT 1 FROM public.mesa_cliente_escolhas e
            WHERE e.mesa = 'organica' AND e.client_id = p.id AND e.modo = 'incluir'
         )
         OR (
           COALESCE(p.plan_status::text, '') = 'active'
           AND COALESCE(p.client_type::text, '') <> 'one_off'
           AND NOT EXISTS (
             SELECT 1 FROM public.mesa_cliente_escolhas e
              WHERE e.mesa = 'organica' AND e.client_id = p.id AND e.modo = 'retirar'
           )
         )
       )
  ),
  aprovacao AS (
    SELECT f.client_id,
           count(*) AS n,
           min(COALESCE(f.approval_requested_at, f.created_at)) AS desde,
           max(COALESCE(f.approval_requested_at, f.created_at)) AS ultimo
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
    -- Peças do calendário (arte ou vídeo); só as de arte contam para "sem arte".
    SELECT pr.client_id,
           t.due_date,
           date_trunc('month', t.due_date::timestamp)::date AS mes,
           (t.delivery_type IN ('carousel', 'static', 'design')) AS de_arte,
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
       AND t.delivery_type IN ('carousel', 'static', 'design', 'reel', 'story', 'video', 'short', 'google_post')
       AND t.due_date >= _mes_atual
       AND t.due_date < _fim
  ),
  meses AS (
    SELECT b.id AS client_id,
           m.mes,
           count(i.due_date) FILTER (WHERE i.de_arte) AS itens,
           count(i.due_date) AS pecas,
           count(i.due_date) FILTER (WHERE i.de_arte AND NOT i.tem_arte AND i.due_date >= _hoje) AS sem_arte,
           min(i.due_date) FILTER (WHERE i.de_arte AND NOT i.tem_arte AND i.due_date >= _hoje) AS proximo_sem_arte,
           EXISTS (
             SELECT 1 FROM public.calendario_propostas cp
              WHERE cp.client_id = b.id
                AND cp.status IN ('temas', 'detalhando', 'pronta')
                AND cp.periodo_inicio < (m.mes + interval '1 month')::date
                AND cp.periodo_fim >= m.mes
           ) AS proposta_aberta,
           EXISTS (
             SELECT 1 FROM public.calendario_propostas cp
              WHERE cp.client_id = b.id
                AND cp.status = 'gravada'
                AND cp.periodo_inicio < (m.mes + interval '1 month')::date
                AND cp.periodo_fim >= m.mes
           ) AS proposta_gravada
      FROM base b
      CROSS JOIN (
        VALUES (_mes_atual),
               ((_mes_atual + interval '1 month')::date),
               ((_mes_atual + interval '2 months')::date),
               ((_mes_atual + interval '3 months')::date)
      ) AS m(mes)
      LEFT JOIN itens i ON i.client_id = b.id AND i.mes = m.mes
     GROUP BY b.id, m.mes
  ),
  feitos AS (
    SELECT f.client_id,
           jsonb_agg(
             jsonb_build_object(
               'id', f.id,
               'tipo', f.tipo,
               'periodo', f.periodo,
               'quantidade', f.quantidade,
               'referencia', f.referencia,
               'marcado_em', f.marcado_em,
               'marcado_por_nome', NULLIF(btrim(quem.full_name), '')
             )
             ORDER BY f.marcado_em DESC
           ) AS lista
      FROM public.mesa_fila_feitos f
      JOIN base b ON b.id = f.client_id
      LEFT JOIN public.profiles quem ON quem.id = f.marcado_por
     WHERE f.arquivado_em IS NULL
       AND f.periodo >= (_mes_atual - interval '1 month')::date
     GROUP BY f.client_id
  )
  SELECT jsonb_agg(
           jsonb_build_object(
             'client_id', a.id,
             'nome', a.nome,
             'ultimo_acesso', a.last_sign_in_at,
             'posts_por_mes', cfg.posts_por_mes,
             'aprovacao_pendentes', COALESCE(ap.n, 0),
             'aprovacao_desde', ap.desde,
             'aprovacao_ultimo', ap.ultimo,
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
                          'pecas', m.pecas,
                          'sem_arte', m.sem_arte,
                          'proximo_sem_arte', m.proximo_sem_arte,
                          'proposta_aberta', m.proposta_aberta,
                          'proposta_gravada', m.proposta_gravada
                        )
                        ORDER BY m.mes
                      )
                 FROM meses m
                WHERE m.client_id = a.id
             ),
             'feitos', COALESCE(fe.lista, '[]'::jsonb)
           )
           ORDER BY a.nome
         )
    INTO _clientes
    FROM base a
    LEFT JOIN public.mesa_cliente_config cfg ON cfg.client_id = a.id
    LEFT JOIN aprovacao ap ON ap.client_id = a.id
    LEFT JOIN revisao rv ON rv.client_id = a.id
    LEFT JOIN trabalhos tr ON tr.client_id = a.id
    LEFT JOIN feitos fe ON fe.client_id = a.id;

  RETURN jsonb_build_object(
    'versao', 2,
    'hoje', _hoje,
    'acesso_conhecido', true,
    'clientes', COALESCE(_clientes, '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mesa_fila_prioridades() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesa_fila_prioridades() TO authenticated;

NOTIFY pgrst, 'reload schema';
