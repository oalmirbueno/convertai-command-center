-- 28/09 (frente CR): cronômetro por cliente e central de horas e custos.
--
-- Pedido do dono: contar sozinho o tempo de trabalho de cada cliente no painel
-- inteiro (Mesa, mesas de vídeo, Central, Workspace, Arquivos, Agenda, ficha,
-- Ciclo), zerar todo começo de mês guardando o histórico e cruzar com o custo
-- de IA que o painel já mede (mesa_custos_producao, carteira ia_usos).
--
-- Desenho:
--   * tempo_de_trabalho: um trecho por sessão contínua de trabalho num cliente,
--     cortado na hora cheia (as contas por dia, semana, período do dia e hora
--     viram soma simples, sem dividir trecho no SQL). O navegador acumula e
--     grava no máximo a cada 60 s (e ao sair ou trocar de cliente): nunca a
--     cada segundo (ver o que derrubou o banco em 26/09).
--   * Escrita só pela função tempo_de_trabalho_registrar (confere dono, acesso
--     ao cliente e limites; a mesma chamada repetida ou fora de ordem não
--     estraga nada: vale a versão maior). Conflito e dado inválido voltam como
--     resposta normal {ok:false}, nunca como erro "tente de novo" (40001).
--   * Leitura: cada pessoa lê os próprios trechos; o admin lê todos.
--   * O histórico é a própria tabela: nada é apagado na virada do mês; o mês
--     novo começa do zero porque as contas agrupam pelo mês de São Paulo.
--
-- Idempotente: pode ser aplicada de novo pelo SQL Editor sem efeito colateral.

CREATE TABLE IF NOT EXISTS public.tempo_de_trabalho (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rota text NOT NULL CHECK (rota ~ '^[a-z][a-z0-9-]{0,39}$'),
  inicio timestamptz NOT NULL,
  fim timestamptz NOT NULL,
  segundos integer NOT NULL CHECK (segundos BETWEEN 0 AND 3900),
  versao integer NOT NULL DEFAULT 1 CHECK (versao >= 1),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tempo_de_trabalho_fim_depois_do_inicio CHECK (fim >= inicio)
);

COMMENT ON TABLE public.tempo_de_trabalho IS
  'Cronômetro por cliente (frente CR, 28/09): um trecho por sessão contínua, cortado na hora cheia. Escrita só por tempo_de_trabalho_registrar; leitura: o próprio ou o admin.';

CREATE INDEX IF NOT EXISTS tempo_de_trabalho_pessoa_cliente_idx
  ON public.tempo_de_trabalho (user_id, client_id, inicio DESC);
CREATE INDEX IF NOT EXISTS tempo_de_trabalho_cliente_idx
  ON public.tempo_de_trabalho (client_id, inicio DESC);
CREATE INDEX IF NOT EXISTS tempo_de_trabalho_inicio_idx
  ON public.tempo_de_trabalho (inicio DESC);

ALTER TABLE public.tempo_de_trabalho ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.tempo_de_trabalho FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.tempo_de_trabalho TO authenticated;
GRANT ALL ON TABLE public.tempo_de_trabalho TO service_role;

DROP POLICY IF EXISTS "tempo_de_trabalho_le_o_proprio_ou_admin" ON public.tempo_de_trabalho;
CREATE POLICY "tempo_de_trabalho_le_o_proprio_ou_admin"
  ON public.tempo_de_trabalho
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR COALESCE(public.has_role(auth.uid(), 'admin'::public.app_role), false)
  );
-- Sem política de INSERT/UPDATE/DELETE: a escrita passa pela função abaixo.

-- ─── Gravar (ou atualizar) um trecho ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tempo_de_trabalho_registrar(
  _id uuid,
  _client_id uuid,
  _rota text,
  _inicio timestamptz,
  _fim timestamptz,
  _segundos integer,
  _versao integer
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _uid uuid := auth.uid();
  _duracao numeric;
  _linhas integer;
BEGIN
  IF _uid IS NULL OR NOT COALESCE(public.is_staff(_uid), false) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  END IF;
  IF _id IS NULL OR _client_id IS NULL OR _inicio IS NULL OR _fim IS NULL OR _segundos IS NULL OR _versao IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'invalido');
  END IF;
  IF NOT COALESCE(public.can_access_client(_client_id), false) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sem_acesso');
  END IF;
  IF _rota IS NULL OR _rota !~ '^[a-z][a-z0-9-]{0,39}$' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'invalido');
  END IF;
  _duracao := extract(epoch FROM (_fim - _inicio));
  IF _fim < _inicio
     OR _duracao > 3660
     OR _fim > now() + interval '5 minutes'
     OR _inicio < now() - interval '7 days'
     OR _segundos < 0
     OR _segundos > ceil(_duracao) + 5
     OR _versao < 1 OR _versao > 1000000 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'invalido');
  END IF;

  INSERT INTO public.tempo_de_trabalho AS t (id, user_id, client_id, rota, inicio, fim, segundos, versao)
  VALUES (_id, _uid, _client_id, _rota, _inicio, _fim, least(_segundos, 3900), _versao)
  ON CONFLICT (id) DO UPDATE
    SET fim = EXCLUDED.fim,
        segundos = EXCLUDED.segundos,
        versao = EXCLUDED.versao,
        atualizado_em = now()
  WHERE t.user_id = EXCLUDED.user_id
    AND t.client_id = EXCLUDED.client_id
    AND t.inicio = EXCLUDED.inicio
    AND EXCLUDED.versao > t.versao;
  GET DIAGNOSTICS _linhas = ROW_COUNT;

  -- 0 linhas: a versão já gravada é igual ou mais nova (reenvio) ou o id é de
  -- outro trecho. Nos dois casos não há o que repetir.
  RETURN jsonb_build_object('ok', true, 'gravado', _linhas > 0);
END;
$body$;

REVOKE ALL ON FUNCTION public.tempo_de_trabalho_registrar(uuid, uuid, text, timestamptz, timestamptz, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tempo_de_trabalho_registrar(uuid, uuid, text, timestamptz, timestamptz, integer, integer) TO authenticated, service_role;

-- ─── Total do mês de UM cliente, da própria pessoa (o cronômetro do topo) ──
-- `_excluir`: o trecho aberto no navegador, que ele soma por conta própria.
CREATE OR REPLACE FUNCTION public.tempo_de_trabalho_total(
  _client_id uuid,
  _desde timestamptz DEFAULT NULL,
  _excluir uuid DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $body$
  SELECT COALESCE(sum(t.segundos), 0)::bigint
    FROM public.tempo_de_trabalho t
   WHERE t.user_id = auth.uid()
     AND t.client_id = _client_id
     AND t.inicio >= COALESCE(
           _desde,
           date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
         )
     AND (_excluir IS NULL OR t.id <> _excluir)
$body$;

REVOKE ALL ON FUNCTION public.tempo_de_trabalho_total(uuid, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tempo_de_trabalho_total(uuid, timestamptz, uuid) TO authenticated, service_role;

-- ─── Central de horas e custos (admin e gestor) ───────────────────────────
-- Devolve, para o mês escolhido e os `_meses` anteriores (histórico):
--   meses:        cliente × mês: segundos, dias trabalhados, trechos
--   detalhe:      só do mês escolhido: cliente × dia × hora (São Paulo)
--   pecas_hora:   só do mês escolhido: peças do Estúdio com arte, cliente × hora
--   publicacoes:  cliente × mês: posts publicados pela Agenda
--   pessoas:      (só admin) quem tem tempo no período, para o filtro
--   entregas:     cliente × mês (histórico), com dado real do painel:
--                 pecas_aprovadas   arquivos raiz aprovados pelo cliente (files.client_decided_at;
--                                   cobre Estúdio, Mesa Foto, Mesa Ads e o que passa por Arquivos)
--                 videos_aprovados  video_versoes aprovadas (decidido_em)
--                 roteiros          roteiros aprovados (aprovado_em)
--                 tarefas           tarefas concluídas que NÃO são peça (a peça já conta na aprovação);
--                                   data = updated_at, porque tasks não tem data de conclusão
--                 marcos            marcos cumpridos (updated_at, pelo mesmo motivo)
--                 publicados        posts publicados pela Agenda (mostrado à parte: é a mesma peça,
--                                   num estágio seguinte; somar contaria duas vezes)
--                 pautas            pautas do mês (tasks com formato de peça e due_date no mês)
--                 pautas_feitas     dessas, as concluídas ou aprovadas
--                 atrasadas         pautas do mês vencidas e ainda abertas + marcos do mês vencidos
--   pacotes:      posts por mês contratados (mesa_cliente_config.posts_por_mes), por cliente
-- Quem vê: o admin vê todos (ou a pessoa escolhida em `_pessoa`); o gestor vê
-- só o próprio tempo, e só dos clientes que ele acessa (can_access_client).
CREATE OR REPLACE FUNCTION public.horas_resumo(
  _mes date DEFAULT NULL,
  _meses integer DEFAULT 12,
  _pessoa uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _uid uuid := auth.uid();
  _admin boolean;
  _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _mes_ini date;
  _mes_fim date;
  _hist_ini date;
  _ts_hist timestamptz;
  _ts_mes timestamptz;
  _ts_fim timestamptz;
  _quem uuid;
  _saida jsonb;
  _formatos_de_peca text[] := ARRAY['carousel', 'static', 'design', 'reel', 'story', 'video', 'short', 'google_post'];
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'HORAS_SO_ADMIN_OU_GESTOR';
  END IF;
  _admin := COALESCE(public.has_role(_uid, 'admin'::public.app_role), false);
  IF NOT _admin AND NOT COALESCE(public.has_role(_uid, 'manager'::public.app_role), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'HORAS_SO_ADMIN_OU_GESTOR';
  END IF;
  IF _meses IS NULL OR _meses < 1 OR _meses > 36 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'HORAS_PERIODO_INVALIDO';
  END IF;

  _mes_ini := date_trunc('month', COALESCE(_mes, _hoje)::timestamp)::date;
  _mes_fim := (_mes_ini + interval '1 month')::date;
  _hist_ini := (_mes_ini - make_interval(months => _meses - 1))::date;
  _ts_hist := _hist_ini::timestamp AT TIME ZONE 'America/Sao_Paulo';
  _ts_mes := _mes_ini::timestamp AT TIME ZONE 'America/Sao_Paulo';
  _ts_fim := _mes_fim::timestamp AT TIME ZONE 'America/Sao_Paulo';
  _quem := CASE WHEN _admin THEN _pessoa ELSE _uid END;

  WITH clientes AS (
    SELECT p.id,
           COALESCE(NULLIF(btrim(p.company_name), ''), NULLIF(btrim(p.full_name), ''), 'Cliente') AS nome
      FROM public.profiles p
     WHERE COALESCE(public.can_access_client(p.id), false)
  ),
  trechos AS (
    SELECT t.client_id,
           t.segundos,
           (t.inicio AT TIME ZONE 'America/Sao_Paulo') AS local
      FROM public.tempo_de_trabalho t
      JOIN clientes c ON c.id = t.client_id
     WHERE t.inicio >= _ts_hist
       AND t.inicio < _ts_fim
       AND (_quem IS NULL OR t.user_id = _quem)
  ),
  meses AS (
    SELECT client_id,
           date_trunc('month', local)::date AS mes,
           sum(segundos)::bigint AS segundos,
           count(DISTINCT local::date) AS dias,
           count(*) AS trechos
      FROM trechos
     GROUP BY 1, 2
  ),
  detalhe AS (
    SELECT client_id,
           local::date AS dia,
           extract(hour FROM local)::int AS hora,
           sum(segundos)::bigint AS segundos
      FROM trechos
     WHERE local >= _mes_ini AND local < _mes_fim
     GROUP BY 1, 2, 3
  ),
  pecas AS (
    SELECT e.client_id,
           extract(hour FROM e.criado_em AT TIME ZONE 'America/Sao_Paulo')::int AS hora,
           count(*) AS pecas
      FROM public.estudio_trabalhos e
      JOIN clientes c ON c.id = e.client_id
     WHERE e.criado_em >= _ts_mes
       AND e.criado_em < _ts_fim
       AND jsonb_typeof(e.cards) = 'array'
       AND jsonb_array_length(e.cards) > 0
     GROUP BY 1, 2
  ),
  publicacoes AS (
    SELECT p.client_id,
           date_trunc('month', p.published_at AT TIME ZONE 'America/Sao_Paulo')::date AS mes,
           count(DISTINCT p.post_id) AS n
      FROM public.editorial_publications p
      JOIN clientes c ON c.id = p.client_id
     WHERE p.status = 'published'
       AND p.published_at >= _ts_hist
       AND p.published_at < _ts_fim
     GROUP BY 1, 2
  ),
  aprovadas AS (
    SELECT f.client_id,
           date_trunc('month', f.client_decided_at AT TIME ZONE 'America/Sao_Paulo')::date AS mes,
           count(*) AS n
      FROM public.files f
      JOIN clientes c ON c.id = f.client_id
     WHERE f.parent_file_id IS NULL
       AND f.archived_at IS NULL
       AND f.approval_status = 'approved'
       AND f.client_decided_at >= _ts_hist
       AND f.client_decided_at < _ts_fim
     GROUP BY 1, 2
  ),
  videos AS (
    SELECT v.client_id,
           date_trunc('month', v.decidido_em AT TIME ZONE 'America/Sao_Paulo')::date AS mes,
           count(*) AS n
      FROM public.video_versoes v
      JOIN clientes c ON c.id = v.client_id
     WHERE v.estado = 'aprovada'
       AND v.decidido_em >= _ts_hist
       AND v.decidido_em < _ts_fim
     GROUP BY 1, 2
  ),
  roteiros AS (
    SELECT r.client_id,
           date_trunc('month', r.aprovado_em AT TIME ZONE 'America/Sao_Paulo')::date AS mes,
           count(*) AS n
      FROM public.roteiros r
      JOIN clientes c ON c.id = r.client_id
     WHERE r.status IN ('aprovado', 'gravado')
       AND r.aprovado_em >= _ts_hist
       AND r.aprovado_em < _ts_fim
     GROUP BY 1, 2
  ),
  -- Tarefa concluída: tasks não guarda a data da conclusão. Vale a data prevista
  -- (due_date) quando existe; sem ela, a última alteração (updated_at), que a
  -- sincronização também mexe, por isso fica só como reserva.
  tarefas AS (
    SELECT pr.client_id,
           date_trunc('month', COALESCE(t.due_date::timestamp, t.updated_at AT TIME ZONE 'America/Sao_Paulo'))::date AS mes,
           count(*) AS n
      FROM public.tasks t
      JOIN public.projects pr ON pr.id = t.project_id AND pr.deleted_at IS NULL
      JOIN clientes c ON c.id = pr.client_id
     WHERE t.deleted_at IS NULL
       AND t.status = 'done'
       AND NOT (COALESCE(t.delivery_type, '') = ANY (_formatos_de_peca))
       AND COALESCE(t.due_date::timestamp, t.updated_at AT TIME ZONE 'America/Sao_Paulo') >= _hist_ini::timestamp
       AND COALESCE(t.due_date::timestamp, t.updated_at AT TIME ZONE 'America/Sao_Paulo') < _mes_fim::timestamp
     GROUP BY 1, 2
  ),
  marcos AS (
    SELECT pr.client_id,
           date_trunc('month', m.updated_at AT TIME ZONE 'America/Sao_Paulo')::date AS mes,
           count(*) AS n
      FROM public.milestones m
      JOIN public.projects pr ON pr.id = m.project_id AND pr.deleted_at IS NULL
      JOIN clientes c ON c.id = pr.client_id
     WHERE m.deleted_at IS NULL
       AND m.status = 'completed'
       AND m.updated_at >= _ts_hist
       AND m.updated_at < _ts_fim
     GROUP BY 1, 2
  ),
  marcos_atrasados AS (
    SELECT pr.client_id,
           date_trunc('month', m.target_date)::date AS mes,
           count(*) AS n
      FROM public.milestones m
      JOIN public.projects pr ON pr.id = m.project_id AND pr.deleted_at IS NULL
      JOIN clientes c ON c.id = pr.client_id
     WHERE m.deleted_at IS NULL
       AND COALESCE(m.status, '') <> 'completed'
       AND m.target_date >= _hist_ini
       AND m.target_date < _mes_fim
       AND m.target_date < _hoje
     GROUP BY 1, 2
  ),
  pautas AS (
    SELECT pr.client_id,
           date_trunc('month', t.due_date)::date AS mes,
           count(*) AS previstas,
           count(*) FILTER (WHERE t.status IN ('done', 'approved')) AS feitas,
           count(*) FILTER (WHERE t.status IN ('backlog', 'todo', 'doing', 'in_progress', 'review') AND t.due_date < _hoje) AS atrasadas
      FROM public.tasks t
      JOIN public.projects pr ON pr.id = t.project_id AND pr.deleted_at IS NULL
      JOIN clientes c ON c.id = pr.client_id
     WHERE t.deleted_at IS NULL
       AND COALESCE(t.status, '') NOT IN ('cancelled', 'archived')
       AND t.delivery_type = ANY (_formatos_de_peca)
       AND t.due_date >= _hist_ini
       AND t.due_date < _mes_fim
     GROUP BY 1, 2
  ),
  chaves AS (
    SELECT client_id, mes FROM aprovadas
    UNION SELECT client_id, mes FROM videos
    UNION SELECT client_id, mes FROM roteiros
    UNION SELECT client_id, mes FROM tarefas
    UNION SELECT client_id, mes FROM marcos
    UNION SELECT client_id, mes FROM marcos_atrasados
    UNION SELECT client_id, mes FROM publicacoes
    UNION SELECT client_id, mes FROM pautas
  ),
  entregas AS (
    SELECT k.client_id,
           k.mes,
           COALESCE(a.n, 0) AS pecas_aprovadas,
           COALESCE(v.n, 0) AS videos_aprovados,
           COALESCE(r.n, 0) AS roteiros,
           COALESCE(t.n, 0) AS tarefas,
           COALESCE(m.n, 0) AS marcos,
           COALESCE(pb.n, 0) AS publicados,
           COALESCE(pa.previstas, 0) AS pautas,
           COALESCE(pa.feitas, 0) AS pautas_feitas,
           COALESCE(pa.atrasadas, 0) + COALESCE(ma.n, 0) AS atrasadas
      FROM chaves k
      LEFT JOIN aprovadas a ON a.client_id = k.client_id AND a.mes = k.mes
      LEFT JOIN videos v ON v.client_id = k.client_id AND v.mes = k.mes
      LEFT JOIN roteiros r ON r.client_id = k.client_id AND r.mes = k.mes
      LEFT JOIN tarefas t ON t.client_id = k.client_id AND t.mes = k.mes
      LEFT JOIN marcos m ON m.client_id = k.client_id AND m.mes = k.mes
      LEFT JOIN marcos_atrasados ma ON ma.client_id = k.client_id AND ma.mes = k.mes
      LEFT JOIN publicacoes pb ON pb.client_id = k.client_id AND pb.mes = k.mes
      LEFT JOIN pautas pa ON pa.client_id = k.client_id AND pa.mes = k.mes
  ),
  pacotes AS (
    SELECT mc.client_id, mc.posts_por_mes
      FROM public.mesa_cliente_config mc
      JOIN clientes c ON c.id = mc.client_id
     WHERE mc.posts_por_mes IS NOT NULL
  ),
  pessoas AS (
    SELECT t.user_id AS id,
           COALESCE(NULLIF(btrim(pr.full_name), ''), 'Pessoa') AS nome,
           sum(t.segundos)::bigint AS segundos
      FROM public.tempo_de_trabalho t
      JOIN public.profiles pr ON pr.id = t.user_id
     WHERE _admin
       AND t.inicio >= _ts_hist
       AND t.inicio < _ts_fim
     GROUP BY 1, 2
  )
  SELECT jsonb_build_object(
           'versao', 1,
           'mes', _mes_ini,
           'inicio_historico', _hist_ini,
           'fim', _mes_fim,
           'escopo', CASE WHEN _quem IS NULL THEN 'todos' WHEN _quem = _uid THEN 'meu' ELSE 'pessoa' END,
           'meses', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                        'client_id', m.client_id, 'nome', c.nome, 'mes', m.mes,
                        'segundos', m.segundos, 'dias', m.dias, 'trechos', m.trechos)
                        ORDER BY m.mes, c.nome)
                      FROM meses m JOIN clientes c ON c.id = m.client_id), '[]'::jsonb),
           'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                        'client_id', d.client_id, 'dia', d.dia, 'hora', d.hora, 'segundos', d.segundos)
                        ORDER BY d.dia, d.hora)
                      FROM detalhe d), '[]'::jsonb),
           'pecas_hora', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                        'client_id', x.client_id, 'hora', x.hora, 'pecas', x.pecas))
                      FROM pecas x), '[]'::jsonb),
           'entregas', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                        'client_id', e.client_id, 'nome', c.nome, 'mes', e.mes,
                        'pecas_aprovadas', e.pecas_aprovadas, 'videos_aprovados', e.videos_aprovados,
                        'roteiros', e.roteiros, 'tarefas', e.tarefas, 'marcos', e.marcos,
                        'publicados', e.publicados, 'pautas', e.pautas, 'pautas_feitas', e.pautas_feitas,
                        'atrasadas', e.atrasadas)
                        ORDER BY e.mes, c.nome)
                      FROM entregas e JOIN clientes c ON c.id = e.client_id), '[]'::jsonb),
           'pacotes', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                        'client_id', x.client_id, 'posts_por_mes', x.posts_por_mes))
                      FROM pacotes x), '[]'::jsonb),
           'pessoas', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                        'id', x.id, 'nome', x.nome, 'segundos', x.segundos) ORDER BY x.segundos DESC)
                      FROM pessoas x), '[]'::jsonb)
         )
    INTO _saida;

  RETURN _saida;
END;
$body$;

REVOKE ALL ON FUNCTION public.horas_resumo(date, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.horas_resumo(date, integer, uuid) TO authenticated, service_role;
