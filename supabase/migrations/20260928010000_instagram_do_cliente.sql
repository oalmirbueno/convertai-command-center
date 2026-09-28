-- Frente IG (28/09/2026): aba Instagram da Mesa do cliente.
-- Função: supabase/functions/mesa-instagram. Conhecimento: _shared/conhecimento-perfil-instagram.ts.
--
-- Só amplia e é idempotente (pode rodar de novo). RLS: equipe lê (is_staff +
-- can_access_client, sem mexer nessas funções); só service_role escreve (a
-- função confere o acesso de quem chama antes de qualquer escrita).
-- Apagar = arquivar (arquivado_em). Sem estas tabelas a função responde com
-- sql_pendente nas ações que gravam e a aba mostra o aviso, sem quebrar
-- (prévia, bio e métricas funcionam sem elas; só não guardam a ordem da
-- grade, as capas nem as redes).

-- ---------------------------------------------------------------------------
-- 1. Plano do perfil: ordem da grade e a última análise da bio (por conta)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cliente_instagram_planos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- id da conta em external_accounts, ou 'sem_conta' (cliente sem Instagram conectado)
  conta_chave text NOT NULL CHECK (conta_chave = 'sem_conta' OR conta_chave ~ '^[0-9a-f-]{36}$'),
  -- ids dos posts da Agenda (editorial_posts) na ordem de ir ao ar
  ordem jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(ordem) = 'array'),
  -- {veredito, sugestoes, escolha, gerado_em, bio_lida}: reabrir sem gastar de novo
  bio_analise jsonb CHECK (bio_analise IS NULL OR jsonb_typeof(bio_analise) = 'object'),
  atualizado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cliente_instagram_planos_conta_uk UNIQUE (client_id, conta_chave)
);

DROP TRIGGER IF EXISTS cliente_instagram_planos_tocar ON public.cliente_instagram_planos;
CREATE TRIGGER cliente_instagram_planos_tocar
BEFORE UPDATE ON public.cliente_instagram_planos
FOR EACH ROW EXECUTE FUNCTION public.mesa_tocar_atualizado_em();

-- ---------------------------------------------------------------------------
-- 2. Capas de destaque geradas (imagem do ícone no bucket mesa)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cliente_instagram_destaques (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  conta_chave text NOT NULL DEFAULT 'sem_conta',
  -- o Instagram aceita 15 caracteres no nome do destaque
  nome text NOT NULL CHECK (char_length(nome) BETWEEN 1 AND 15),
  icone text,
  -- {fundo, desenho, traco}: cores sempre do kit do cliente (a função confere)
  estilo jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(estilo) = 'object'),
  -- <cliente>/instagram/destaques/<id>.<ext> no bucket mesa
  caminho text,
  modelo_id text,
  custo_usd numeric NOT NULL DEFAULT 0 CHECK (custo_usd >= 0),
  ordem integer NOT NULL DEFAULT 0,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  arquivado_em timestamptz,
  arquivado_por uuid
);

CREATE INDEX IF NOT EXISTS cliente_instagram_destaques_cliente_idx
  ON public.cliente_instagram_destaques (client_id, conta_chave, ordem)
  WHERE arquivado_em IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Outras redes do cliente (guardadas à mão; a conexão de verdade é Integrações)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cliente_redes_sociais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rede text NOT NULL CHECK (rede IN ('instagram', 'facebook', 'tiktok', 'linkedin', 'youtube', 'threads', 'google')),
  -- @ ou link (sem espaço)
  endereco text NOT NULL CHECK (char_length(endereco) BETWEEN 1 AND 200),
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  arquivado_em timestamptz,
  arquivado_por uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS cliente_redes_sociais_uk
  ON public.cliente_redes_sociais (client_id, rede, lower(endereco))
  WHERE arquivado_em IS NULL;

-- ---------------------------------------------------------------------------
-- 4. RLS: equipe lê; só service_role escreve
-- ---------------------------------------------------------------------------
ALTER TABLE public.cliente_instagram_planos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cliente_instagram_destaques ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cliente_redes_sociais ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cliente_instagram_planos_staff_read ON public.cliente_instagram_planos;
CREATE POLICY cliente_instagram_planos_staff_read ON public.cliente_instagram_planos
  FOR SELECT TO authenticated
  USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

DROP POLICY IF EXISTS cliente_instagram_destaques_staff_read ON public.cliente_instagram_destaques;
CREATE POLICY cliente_instagram_destaques_staff_read ON public.cliente_instagram_destaques
  FOR SELECT TO authenticated
  USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

DROP POLICY IF EXISTS cliente_redes_sociais_staff_read ON public.cliente_redes_sociais;
CREATE POLICY cliente_redes_sociais_staff_read ON public.cliente_redes_sociais
  FOR SELECT TO authenticated
  USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

REVOKE ALL ON public.cliente_instagram_planos, public.cliente_instagram_destaques, public.cliente_redes_sociais FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cliente_instagram_planos, public.cliente_instagram_destaques, public.cliente_redes_sociais TO authenticated;
GRANT ALL ON public.cliente_instagram_planos, public.cliente_instagram_destaques, public.cliente_redes_sociais TO service_role;

COMMENT ON TABLE public.cliente_instagram_planos IS
  'Aba Instagram da Mesa (frente IG): ordem da grade planejada e a última análise da bio, por conta do Instagram do cliente.';
COMMENT ON TABLE public.cliente_instagram_destaques IS
  'Capas de destaque geradas na aba Instagram da Mesa (cores só do kit do cliente). Apagar = arquivar.';
COMMENT ON TABLE public.cliente_redes_sociais IS
  'Outras redes do cliente guardadas à mão na aba Instagram da Mesa (TikTok, LinkedIn...). A conexão de verdade é em Integrações. Apagar = arquivar.';

-- Conferência (só leitura, depois de aplicar):
-- select relname, relrowsecurity from pg_class where relname in ('cliente_instagram_planos','cliente_instagram_destaques','cliente_redes_sociais');
-- select tablename, policyname, cmd, roles from pg_policies where tablename in ('cliente_instagram_planos','cliente_instagram_destaques','cliente_redes_sociais');
-- select grantee, table_name, privilege_type from information_schema.role_table_grants where table_name in ('cliente_instagram_planos','cliente_instagram_destaques','cliente_redes_sociais') and grantee in ('anon','authenticated') order by 1,2,3;
