-- Navegador remoto da Central (09/10/2026, lote C; aplicado em 09/10).
--
-- Só amplia e é idempotente. Um navegador remoto (Browserbase) por cliente:
-- - navegador_contextos: o "perfil" do navegador de cada cliente (cookies e
--   login ficam no provedor, cifrados; aqui só o id do contexto). Nunca um
--   contexto para dois clientes (isolamento: chave única por cliente).
-- - navegador_sessoes: cada sessão aberta (quem abriu, de onde: Central,
--   Gestor ou Hermes; o pedido que a originou), para a Central oferecer o
--   atalho real da sessão e nunca dizer que uma página está aberta sem sessão
--   verificável.
-- Senha não passa por aqui: o login é feito pelo dono dentro da sessão.
-- Leitura: staff. Escrita: só a função navegador-remoto (chave de serviço).

CREATE TABLE IF NOT EXISTS public.navegador_contextos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provedor text NOT NULL DEFAULT 'browserbase' CHECK (provedor IN ('browserbase')),
  contexto_externo text NOT NULL,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  usado_em timestamptz,
  CONSTRAINT navegador_contextos_um_por_cliente UNIQUE (client_id, provedor)
);

CREATE TABLE IF NOT EXISTS public.navegador_sessoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  contexto_id uuid NOT NULL REFERENCES public.navegador_contextos(id) ON DELETE CASCADE,
  sessao_externa text NOT NULL,
  origem text NOT NULL DEFAULT 'central' CHECK (origem IN ('central', 'gestor', 'hermes')),
  pedido text,
  aberta_por uuid,
  estado text NOT NULL DEFAULT 'aberta' CHECK (estado IN ('aberta', 'encerrada', 'falhou')),
  aberta_em timestamptz NOT NULL DEFAULT now(),
  encerrada_em timestamptz,
  ultima_url text
);

CREATE INDEX IF NOT EXISTS navegador_sessoes_cliente_idx ON public.navegador_sessoes (client_id, aberta_em DESC);
CREATE UNIQUE INDEX IF NOT EXISTS navegador_sessoes_externa_idx ON public.navegador_sessoes (sessao_externa);

ALTER TABLE public.navegador_contextos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.navegador_sessoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS navegador_contextos_staff_le ON public.navegador_contextos;
CREATE POLICY navegador_contextos_staff_le ON public.navegador_contextos FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS navegador_sessoes_staff_le ON public.navegador_sessoes;
CREATE POLICY navegador_sessoes_staff_le ON public.navegador_sessoes FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS navegador_contextos_servico ON public.navegador_contextos;
CREATE POLICY navegador_contextos_servico ON public.navegador_contextos FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS navegador_sessoes_servico ON public.navegador_sessoes;
CREATE POLICY navegador_sessoes_servico ON public.navegador_sessoes FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE INSERT, UPDATE, DELETE ON public.navegador_contextos FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.navegador_sessoes FROM authenticated, anon;
