-- ═══════════════════════════════════════════════════════════════════════
-- MESA DO CLIENTE: CAMPANHAS, HYPES DA SEMANA E PEDIDOS DO MÊS.
--
-- Pedido do dono (23/09):
-- - uma área de campanhas (ex.: "promoção do amor", "dia do cliente") em que
--   o estrategista cria o tema, a base, a identidade da campanha (inclusive um
--   selo ou logo do tema) e os conteúdos, que entram na agenda e chegam ao
--   Estúdio seguindo essa identidade;
-- - um botão para buscar os hypes da semana com a inteligência do contexto de
--   cada cliente, sem gastar de novo a cada clique (uma busca por semana);
-- - um agente dentro do Mês para pedidos livres ("prepare três conteúdos para
--   tal campanha", "a agenda de hoje"), com imagens e prints anexados.
-- As escritas passam pela função agente-calendario (chave de serviço); a
-- equipe lê direto e ajusta nome, estado e referências da campanha.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1) Campanhas ───────────────────────────────────────────────────────

CREATE TABLE public.mesa_campanhas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  nome text NOT NULL,
  pedido text,
  objetivo text,
  periodo_inicio date,
  periodo_fim date,
  conceito text,
  -- tema_visual, paleta_apoio [{nome,hex}], tipografia, elementos, tom, selo {texto, descricao}
  identidade jsonb NOT NULL DEFAULT '{}'::jsonb,
  referencias_ids text[] NOT NULL DEFAULT '{}',
  selo_path text,
  proposta_id uuid REFERENCES public.calendario_propostas(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'planejada' CHECK (status IN ('planejada', 'gravada', 'encerrada')),
  custo_usd numeric NOT NULL DEFAULT 0,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mesa_campanhas_periodo_ok CHECK (periodo_fim IS NULL OR periodo_inicio IS NULL OR periodo_fim >= periodo_inicio)
);

CREATE INDEX mesa_campanhas_cliente_idx ON public.mesa_campanhas (client_id, criado_em DESC);
CREATE INDEX mesa_campanhas_proposta_idx ON public.mesa_campanhas (proposta_id) WHERE proposta_id IS NOT NULL;

CREATE TRIGGER mesa_campanhas_tocar
BEFORE UPDATE ON public.mesa_campanhas
FOR EACH ROW EXECUTE FUNCTION public.mesa_tocar_atualizado_em();

ALTER TABLE public.mesa_campanhas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mesa_campanhas FROM PUBLIC, anon, authenticated, service_role;

CREATE POLICY mesa_campanhas_equipe_le ON public.mesa_campanhas
FOR SELECT TO authenticated
USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));
CREATE POLICY mesa_campanhas_equipe_altera ON public.mesa_campanhas
FOR UPDATE TO authenticated
USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id))
WITH CHECK (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

GRANT SELECT ON public.mesa_campanhas TO authenticated;
-- A equipe muda só o que é dela na tela; o resto vem do estrategista.
GRANT UPDATE (nome, status, referencias_ids) ON public.mesa_campanhas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mesa_campanhas TO service_role;

-- ─── 2) Hypes da semana (uma busca por cliente e semana) ───────────────

CREATE TABLE public.mesa_hypes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Segunda-feira da semana (fuso de São Paulo).
  semana date NOT NULL,
  itens jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(itens) = 'array'),
  resumo text,
  custo_usd numeric NOT NULL DEFAULT 0,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mesa_hypes_cliente_semana_unica UNIQUE (client_id, semana)
);

ALTER TABLE public.mesa_hypes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mesa_hypes FROM PUBLIC, anon, authenticated, service_role;

CREATE POLICY mesa_hypes_equipe_le ON public.mesa_hypes
FOR SELECT TO authenticated
USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

GRANT SELECT ON public.mesa_hypes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mesa_hypes TO service_role;
