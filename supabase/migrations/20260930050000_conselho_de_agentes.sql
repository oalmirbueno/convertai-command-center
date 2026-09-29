-- ═══════════════════════════════════════════════════════════════════════
-- CNS-01 · CONSELHO DE AGENTES (frente CNS, 30/09). NÃO APLICADO.
--
-- Pedido do dono: "um campo de brainstorm profissional agêntico onde vários
-- agentes discutem com os modelos (...) como se fosse um conselho de agentes
-- e profissionais, cada agente com sua especialidade e visão, e no final
-- entra em um consenso sempre para entregar algo acima da média, e tudo
-- documentado."
--
-- O que este SQL faz (idempotente, pode rodar de novo; só amplia):
--
--   1) public.conselho_sessoes: uma linha por sessão do conselho (tema,
--      pergunta, especialistas com o modelo de cada um, número FIXO de
--      rodadas, teto de custo, custo gasto, resultado com o consenso e as
--      divergências, decisão do dono e a ata). A função `conselho` roda a
--      sessão em passos (trava_token + trava_ate, teto de passos e de
--      tentativas): nada repete sem teto e sem espera.
--   2) public.conselho_falas: quem disse o quê, por rodada (propostas,
--      crítica com notas de 1 a 10, revisão, consolidação e a conversa com
--      a pessoa depois). Cada fala guarda o custo e o uso da carteira.
--   3) public.conselho_pegar_passo(sessão, token, segundos): pega a vez de
--      rodar um passo da sessão (só service_role; a função confere o acesso
--      ao cliente com o login de quem pediu antes de chamar).
--   4) As duas tabelas entram na publicação supabase_realtime: a Sala do
--      Conselho mostra o andamento ao vivo (quem está falando, notas).
--
-- RLS: a equipe com acesso ao cliente LÊ (is_staff + can_access_client);
-- ninguém escreve direto (só service_role, pela função `conselho`). Apagar
-- não existe: parar arquiva a sessão (status 'parada').
--
-- Como conferir depois de aplicar:
--   select count(*) from public.conselho_sessoes;                                    -- 0
--   select has_table_privilege('authenticated', 'public.conselho_sessoes', 'INSERT'); -- false
--   select has_table_privilege('authenticated', 'public.conselho_falas', 'UPDATE');   -- false
--   select polname from pg_policy where polrelid = 'public.conselho_falas'::regclass;
--   select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'conselho_%';
-- ═══════════════════════════════════════════════════════════════════════

-- 1) Sessões ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.conselho_sessoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  marca_id uuid,
  origem text NOT NULL DEFAULT 'painel' CHECK (origem ~ '^[a-z0-9_-]{2,40}$'),
  referencia jsonb NOT NULL DEFAULT '{}'::jsonb,
  tema text NOT NULL CHECK (char_length(tema) BETWEEN 3 AND 300),
  pergunta text NOT NULL CHECK (char_length(pergunta) BETWEEN 3 AND 4000),
  contexto text CHECK (contexto IS NULL OR char_length(contexto) <= 8000),
  -- Retrato do cliente (cérebro, dossiê, decisões anteriores) lido UMA vez na convocação: todas as rodadas usam o mesmo.
  contexto_cliente text CHECK (contexto_cliente IS NULL OR char_length(contexto_cliente) <= 12000),
  criterios jsonb NOT NULL DEFAULT '[]'::jsonb,
  especialistas jsonb NOT NULL DEFAULT '[]'::jsonb,
  rodadas smallint NOT NULL DEFAULT 4 CHECK (rodadas BETWEEN 2 AND 4),
  rodadas_extras smallint NOT NULL DEFAULT 0 CHECK (rodadas_extras BETWEEN 0 AND 2),
  rodada_atual smallint NOT NULL DEFAULT 1 CHECK (rodada_atual BETWEEN 1 AND 12),
  etapa text NOT NULL DEFAULT 'propostas' CHECK (etapa IN ('propostas', 'critica', 'revisao', 'consolidacao', 'fim')),
  status text NOT NULL DEFAULT 'fila' CHECK (status IN ('fila', 'rodando', 'concluida', 'parada', 'teto', 'erro')),
  teto_usd numeric(10, 4) NOT NULL CHECK (teto_usd > 0 AND teto_usd <= 50),
  estimativa_usd numeric(10, 4) NOT NULL DEFAULT 0 CHECK (estimativa_usd >= 0),
  custo_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (custo_usd >= 0),
  resultado jsonb,
  decisao jsonb,
  ata text,
  memoria_id uuid,
  trava_token uuid,
  trava_ate timestamptz,
  tentativas smallint NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  passos smallint NOT NULL DEFAULT 0 CHECK (passos >= 0),
  erro_codigo text,
  erro_mensagem text,
  aviso text,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  concluido_em timestamptz
);

COMMENT ON TABLE public.conselho_sessoes IS
  'Conselho de agentes (frente CNS, 30/09): uma sessão de brainstorm com especialistas, rodadas fixas, teto de custo, consenso medido pelo Jev e decisão do dono. Escrita só pela função conselho.';

CREATE INDEX IF NOT EXISTS conselho_sessoes_cliente_idx ON public.conselho_sessoes (client_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS conselho_sessoes_ativas_idx ON public.conselho_sessoes (status, atualizado_em) WHERE status IN ('fila', 'rodando');

ALTER TABLE public.conselho_sessoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conselho_sessoes_equipe_le ON public.conselho_sessoes;
CREATE POLICY conselho_sessoes_equipe_le ON public.conselho_sessoes
  FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid())) AND public.can_access_client(client_id));

REVOKE ALL ON public.conselho_sessoes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.conselho_sessoes TO authenticated;
GRANT ALL ON public.conselho_sessoes TO service_role;

-- 2) Falas ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.conselho_falas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sessao_id uuid NOT NULL REFERENCES public.conselho_sessoes(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rodada smallint NOT NULL CHECK (rodada BETWEEN 1 AND 12),
  etapa text NOT NULL CHECK (etapa IN ('propostas', 'critica', 'revisao', 'consolidacao', 'conversa')),
  especialista text NOT NULL CHECK (especialista ~ '^[a-z0-9_]{2,40}$'),
  papel text NOT NULL DEFAULT 'especialista' CHECK (papel IN ('especialista', 'moderador')),
  modelo_id text,
  pedido text CHECK (pedido IS NULL OR char_length(pedido) <= 4000),
  status text NOT NULL DEFAULT 'fila' CHECK (status IN ('fila', 'falando', 'feita', 'erro', 'pulada')),
  conteudo jsonb,
  texto text,
  notas jsonb,
  custo_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (custo_usd >= 0),
  uso_id text,
  tentativas smallint NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  erro_codigo text,
  erro_mensagem text,
  pedido_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  iniciado_em timestamptz,
  concluido_em timestamptz,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.conselho_falas IS
  'Quem disse o quê no conselho de agentes (frente CNS, 30/09), por rodada. Escrita só pela função conselho.';

-- Uma fala por especialista em cada rodada (a conversa com a pessoa fica de fora).
CREATE UNIQUE INDEX IF NOT EXISTS conselho_falas_rodada_uidx
  ON public.conselho_falas (sessao_id, rodada, especialista)
  WHERE etapa <> 'conversa';
CREATE INDEX IF NOT EXISTS conselho_falas_sessao_idx ON public.conselho_falas (sessao_id, rodada, criado_em);
CREATE INDEX IF NOT EXISTS conselho_falas_cliente_idx ON public.conselho_falas (client_id, criado_em DESC);

ALTER TABLE public.conselho_falas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conselho_falas_equipe_le ON public.conselho_falas;
CREATE POLICY conselho_falas_equipe_le ON public.conselho_falas
  FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid())) AND public.can_access_client(client_id));

REVOKE ALL ON public.conselho_falas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.conselho_falas TO authenticated;
GRANT ALL ON public.conselho_falas TO service_role;

-- 3) Pegar a vez de rodar um passo -----------------------------------------
--
-- Uma sessão roda um passo por vez (trava de _trava_segundos). Queda do
-- worker: a trava vence e a sessão é retomada com tentativas + 1; com 3
-- tentativas, vira erro. Passos acima de 40 também viram erro (teto).

CREATE OR REPLACE FUNCTION public.conselho_pegar_passo(_sessao uuid, _token uuid, _trava_segundos integer DEFAULT 300)
RETURNS SETOF public.conselho_sessoes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r public.conselho_sessoes;
BEGIN
  IF _sessao IS NULL OR _token IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO _r FROM public.conselho_sessoes WHERE id = _sessao FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF _r.status NOT IN ('fila', 'rodando') THEN
    RETURN;
  END IF;
  IF _r.trava_ate IS NOT NULL AND _r.trava_ate >= now() THEN
    RETURN;
  END IF;

  -- Trava vencida: o passo anterior caiu no meio.
  IF _r.trava_ate IS NOT NULL AND _r.trava_ate < now() AND _r.tentativas + 1 >= 3 THEN
    UPDATE public.conselho_sessoes
       SET status = 'erro', erro_codigo = 'tentativas_esgotadas',
           erro_mensagem = 'O conselho parou várias vezes no servidor. Convoque de novo.',
           trava_token = NULL, trava_ate = NULL, concluido_em = now(), atualizado_em = now()
     WHERE id = _r.id;
    RETURN;
  END IF;
  IF _r.passos + 1 > 40 THEN
    UPDATE public.conselho_sessoes
       SET status = 'erro', erro_codigo = 'passos_esgotados',
           erro_mensagem = 'O conselho passou do número máximo de passos.',
           trava_token = NULL, trava_ate = NULL, concluido_em = now(), atualizado_em = now()
     WHERE id = _r.id;
    RETURN;
  END IF;

  UPDATE public.conselho_sessoes
     SET status = 'rodando',
         tentativas = CASE WHEN _r.trava_ate IS NOT NULL AND _r.trava_ate < now() THEN _r.tentativas + 1 ELSE _r.tentativas END,
         passos = _r.passos + 1,
         trava_token = _token,
         trava_ate = now() + make_interval(secs => GREATEST(LEAST(_trava_segundos, 420), 60)),
         atualizado_em = now()
   WHERE id = _r.id
   RETURNING * INTO _r;
  RETURN NEXT _r;
END;
$$;

REVOKE ALL ON FUNCTION public.conselho_pegar_passo(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conselho_pegar_passo(uuid, uuid, integer) TO service_role;

-- 4) Andamento ao vivo (Realtime) -------------------------------------------

DO $rt$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conselho_sessoes'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.conselho_sessoes;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conselho_falas'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.conselho_falas;
    END IF;
  END IF;
END
$rt$;
