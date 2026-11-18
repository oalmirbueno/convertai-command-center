-- Molde do carrossel (11/11/2026): o carrossel do perfil de referência lido
-- lâmina a lâmina e a estrutura dele (gancho, promessa, esqueleto, chamada
-- final) guardados junto do post. Idempotente.

ALTER TABLE public.cliente_perfis_posts
  ADD COLUMN IF NOT EXISTS laminas jsonb,
  ADD COLUMN IF NOT EXISTS molde jsonb,
  ADD COLUMN IF NOT EXISTS molde_em timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cliente_perfis_posts_laminas_lista') THEN
    ALTER TABLE public.cliente_perfis_posts
      ADD CONSTRAINT cliente_perfis_posts_laminas_lista CHECK (laminas IS NULL OR jsonb_typeof(laminas) = 'array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cliente_perfis_posts_molde_objeto') THEN
    ALTER TABLE public.cliente_perfis_posts
      ADD CONSTRAINT cliente_perfis_posts_molde_objeto CHECK (molde IS NULL OR jsonb_typeof(molde) = 'object');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS cliente_perfis_posts_molde_idx
  ON public.cliente_perfis_posts (client_id, molde_em DESC)
  WHERE molde IS NOT NULL;

-- A rodada de moldes entra no registro de rodadas (custo e auditoria).
ALTER TABLE public.cliente_perfis_rodadas DROP CONSTRAINT IF EXISTS cliente_perfis_rodadas_tipo_check;
ALTER TABLE public.cliente_perfis_rodadas
  ADD CONSTRAINT cliente_perfis_rodadas_tipo_check
  CHECK (tipo IN ('captura', 'leitura', 'resumo', 'monitoramento', 'plano', 'ideias', 'comparar', 'conversa', 'estilo', 'molde'));
