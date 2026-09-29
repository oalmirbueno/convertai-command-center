-- Frente BRF (30/09/2026): briefing por modelo, link profissional, anexos e decupagem.
--
-- Amplia o briefing que já existe (public.briefings, /briefing/:token, RPCs briefing_public_*):
-- 1. briefings ganha o modelo (tipo de serviço, versão e a cópia do modelo com que o link nasceu),
--    o dado já sabido para confirmar (prefill), a marca, a validade (expira_em), o rascunho salvo no
--    servidor, o envio (data e contagem), o pedido de reabertura, quem criou e o PDF exportado.
--    Links antigos seguem valendo: modelo nulo = diagnóstico, expira_em nulo = sem validade.
-- 2. briefing_modelos: as versões dos modelos que o dono editar (a versão de fábrica mora no código,
--    supabase/functions/_shared/briefing-modelos.ts; a ativa mais nova do banco vence).
-- 3. briefing_anexos: os arquivos que o cliente anexa pelo link. O arquivo vai para Arquivos do
--    cliente (public.files, bucket files); aqui fica a ligação com o campo do briefing.
-- 4. briefing_decupagens: a decupagem de cada envio (palavras-chave, dores, público, restrições,
--    referências, tom) e as sugestões para o contexto, com o que precisa para Desfazer.
--
-- Segurança: nenhuma tabela abre para anon. O link público só lê e grava pelas RPCs security definer
-- (20260930010100) e pela função briefing-publico (chave de serviço). A equipe lê pelo RLS de sempre
-- (is_staff + can_access_client). Escrita de estado (decupagem, anexos) só por service_role.
-- Só amplia e é idempotente. Apagar = arquivar.

-- ---------------------------------------------------------------------------
-- 1. briefings: colunas novas
-- ---------------------------------------------------------------------------
ALTER TABLE public.briefings ADD COLUMN IF NOT EXISTS modelo text;
ALTER TABLE public.briefings ADD COLUMN IF NOT EXISTS modelo_versao integer;
ALTER TABLE public.briefings ADD COLUMN IF NOT EXISTS modelo_conteudo jsonb;
ALTER TABLE public.briefings ADD COLUMN IF NOT EXISTS prefill jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.briefings ADD COLUMN IF NOT EXISTS titulo text;
ALTER TABLE public.briefings ADD COLUMN IF NOT EXISTS marca_id uuid;
ALTER TABLE public.briefings ADD COLUMN IF NOT EXISTS expira_em timestamptz;
ALTER TABLE public.briefings ADD COLUMN IF NOT EXISTS rascunho_salvo_em timestamptz;
ALTER TABLE public.briefings ADD COLUMN IF NOT EXISTS enviado_em timestamptz;
ALTER TABLE public.briefings ADD COLUMN IF NOT EXISTS envios integer NOT NULL DEFAULT 0;
ALTER TABLE public.briefings ADD COLUMN IF NOT EXISTS reabertura_pedida_em timestamptz;
ALTER TABLE public.briefings ADD COLUMN IF NOT EXISTS reabertura_motivo text;
ALTER TABLE public.briefings ADD COLUMN IF NOT EXISTS reaberto_em timestamptz;
ALTER TABLE public.briefings ADD COLUMN IF NOT EXISTS reaberto_por uuid;
ALTER TABLE public.briefings ADD COLUMN IF NOT EXISTS criado_por uuid;
ALTER TABLE public.briefings ADD COLUMN IF NOT EXISTS arquivado_em timestamptz;
ALTER TABLE public.briefings ADD COLUMN IF NOT EXISTS arquivo_pdf_id uuid;

-- Link novo nasce com 30 dias de validade e como diagnóstico (o que a tela antiga cria direto).
-- As linhas que já existem ficam com expira_em nulo (sem validade) e modelo nulo (diagnóstico).
ALTER TABLE public.briefings ALTER COLUMN expira_em SET DEFAULT (now() + interval '30 days');
ALTER TABLE public.briefings ALTER COLUMN modelo SET DEFAULT 'diagnostico';

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'briefings_modelo_check') THEN
    ALTER TABLE public.briefings ADD CONSTRAINT briefings_modelo_check
      CHECK (modelo IS NULL OR modelo IN ('diagnostico', 'site', 'landing', 'identidade', 'naming', 'redes', 'video'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'briefings_prefill_objeto') THEN
    ALTER TABLE public.briefings ADD CONSTRAINT briefings_prefill_objeto CHECK (jsonb_typeof(prefill) = 'object');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'briefings_marca_fk') THEN
    -- A marca é sempre do mesmo cliente do briefing (mesmo formato de cliente_perfis_instagram).
    ALTER TABLE public.briefings
      ADD CONSTRAINT briefings_marca_fk
      FOREIGN KEY (marca_id, client_id)
      REFERENCES public.cliente_marcas (id, client_id)
      ON DELETE SET NULL (marca_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'briefings_arquivo_pdf_fk') THEN
    ALTER TABLE public.briefings
      ADD CONSTRAINT briefings_arquivo_pdf_fk FOREIGN KEY (arquivo_pdf_id) REFERENCES public.files (id) ON DELETE SET NULL;
  END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS briefings_client_criado_idx ON public.briefings (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS briefings_reabertura_idx ON public.briefings (reabertura_pedida_em) WHERE reabertura_pedida_em IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. briefing_modelos: versões editadas pelo dono
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.briefing_modelos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL CHECK (slug IN ('diagnostico', 'site', 'landing', 'identidade', 'naming', 'redes', 'video')),
  versao integer NOT NULL CHECK (versao >= 2),
  titulo text,
  conteudo jsonb NOT NULL CHECK (jsonb_typeof(conteudo) = 'object'),
  ativo boolean NOT NULL DEFAULT true,
  nota text,
  criado_por uuid DEFAULT auth.uid(),
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slug, versao)
);

ALTER TABLE public.briefing_modelos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.briefing_modelos FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.briefing_modelos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.briefing_modelos TO service_role;

DROP POLICY IF EXISTS briefing_modelos_equipe_le ON public.briefing_modelos;
CREATE POLICY briefing_modelos_equipe_le ON public.briefing_modelos
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS briefing_modelos_admin_cria ON public.briefing_modelos;
CREATE POLICY briefing_modelos_admin_cria ON public.briefing_modelos
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY IF EXISTS briefing_modelos_admin_muda ON public.briefing_modelos;
CREATE POLICY briefing_modelos_admin_muda ON public.briefing_modelos
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ---------------------------------------------------------------------------
-- 3. briefing_anexos: arquivos enviados pelo link
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.briefing_anexos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  briefing_id uuid NOT NULL REFERENCES public.briefings (id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  campo text CHECK (campo IS NULL OR campo ~ '^[A-Za-z][A-Za-z0-9_]{0,48}$'),
  categoria text NOT NULL DEFAULT 'outros'
    CHECK (categoria IN ('logo', 'manual', 'fotos', 'textos', 'videos', 'referencias', 'outros')),
  nome text NOT NULL CHECK (length(nome) BETWEEN 1 AND 220),
  mime text,
  tamanho bigint NOT NULL CHECK (tamanho > 0 AND tamanho <= 26214400),
  status text NOT NULL DEFAULT 'enviando' CHECK (status IN ('enviando', 'pronto', 'falhou')),
  file_id uuid REFERENCES public.files (id) ON DELETE SET NULL,
  storage_path text,
  erro text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  concluido_em timestamptz,
  arquivado_em timestamptz,
  arquivado_por text CHECK (arquivado_por IS NULL OR arquivado_por IN ('cliente', 'equipe'))
);

CREATE INDEX IF NOT EXISTS briefing_anexos_briefing_idx ON public.briefing_anexos (briefing_id, criado_em);
CREATE INDEX IF NOT EXISTS briefing_anexos_cliente_idx ON public.briefing_anexos (client_id);

ALTER TABLE public.briefing_anexos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.briefing_anexos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.briefing_anexos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.briefing_anexos TO service_role;

DROP POLICY IF EXISTS briefing_anexos_equipe_le ON public.briefing_anexos;
CREATE POLICY briefing_anexos_equipe_le ON public.briefing_anexos
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) AND public.can_access_client(client_id));

-- ---------------------------------------------------------------------------
-- 4. briefing_decupagens: uma por envio
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.briefing_decupagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  briefing_id uuid NOT NULL REFERENCES public.briefings (id) ON DELETE CASCADE,
  client_id uuid,
  marca_id uuid,
  envio integer NOT NULL DEFAULT 1 CHECK (envio >= 1),
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'processando', 'pronta', 'falhou', 'aplicada', 'desfeita')),
  itens jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(itens) = 'array'),
  tom_de_voz text,
  sugestoes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sugestoes) = 'array'),
  destino jsonb,
  aplicadas jsonb,
  custo_usd numeric(12, 6) NOT NULL DEFAULT 0,
  erro text,
  tentativas integer NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now(),
  iniciado_em timestamptz,
  concluido_em timestamptz,
  aplicada_em timestamptz,
  aplicada_por uuid,
  desfeita_em timestamptz,
  desfeita_por uuid,
  UNIQUE (briefing_id, envio)
);

CREATE INDEX IF NOT EXISTS briefing_decupagens_pendentes_idx ON public.briefing_decupagens (criado_em) WHERE status IN ('pendente', 'falhou');
CREATE INDEX IF NOT EXISTS briefing_decupagens_cliente_idx ON public.briefing_decupagens (client_id);

ALTER TABLE public.briefing_decupagens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.briefing_decupagens FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.briefing_decupagens TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.briefing_decupagens TO service_role;

DROP POLICY IF EXISTS briefing_decupagens_equipe_le ON public.briefing_decupagens;
CREATE POLICY briefing_decupagens_equipe_le ON public.briefing_decupagens
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) AND client_id IS NOT NULL AND public.can_access_client(client_id));

-- Conferência (só leitura, depois de aplicar):
--   select column_name from information_schema.columns where table_name = 'briefings' and column_name in ('modelo','expira_em','prefill','marca_id');
--   select tablename, policyname, roles from pg_policies where tablename like 'briefing_%';
--   select has_table_privilege('anon', 'public.briefing_anexos', 'select');   -- false
