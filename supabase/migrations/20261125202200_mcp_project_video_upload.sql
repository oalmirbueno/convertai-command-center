-- MCP: envio de MP4 à pauta e pedido de revisão HUMANA da agência pela chave presa a projeto/operador.
-- Migration incremental, somente arquivo: NÃO aplicada. Depende de 20261125202100_mcp_project_grants.sql.
-- Exige plano, backup restaurável e autorização explícita (AGENTS.md).
--
-- Fechado por padrão, quatro travas independentes (todas precisam abrir):
--   1) mcp_project_grants.allow_video_upload: opt-in na CRIAÇÃO da concessão, padrão false, imutável
--      (o gatilho mcp_project_grants_check já congela a coluna; aqui só sai o CHECK = false do lote de leitura);
--   2) atestado EXPLÍCITO, separado do vínculo, de que o perfil é exclusivo do agente (mcp_agent_author_attestations);
--   3) binding do operador a esse perfil de AUTORIA, não-admin (mcp_operator_author_profiles);
--   4) no servidor, MCP_PROJECT_VIDEO_WRITE=true.
--
-- Autoria: files.uploaded_by, task_attachments.uploaded_by e file_approval_events.actor_id exigem profiles.id.
-- internal_operators.slug NÃO é profiles.id. Nada aqui usa perfil do cliente, de pessoa da equipe, UUID inventado ou
-- admin: o admin cadastra um perfil dedicado ao agente (ex.: "Corte (agente)"), ATESTA por escrito que ele é exclusivo
-- do agente (sem uso humano) e só então liga o operador a ele. Papel só design/traffic, sem admin/manager/client, sem
-- ser cliente de projeto, na carteira do cliente (team_client_assignments). Papéis e carteira são reconferidos em cada
-- RPC com travas (ver seção 3) para que mudança concorrente espere a RPC ou seja vista por ela.
--
-- Gate: o pedido de revisão reaproveita public.request_file_agency_review (mesmas checagens, mesmo evento
-- agency_review_requested, ator = perfil dedicado) e fica EXCLUSIVAMENTE na revisão interna (Gate 1). Nada aqui
-- aprova, libera ao cliente, agenda, publica ou avisa; o Gate 2 continua sendo a decisão humana do cliente no painel.
--
-- Storage: o objeto fica no prefixo RESERVADO mcp-files/<client_id>/mcp-project-video/. Políticas RESTRITIVAS
-- negam a anon/authenticated qualquer INSERT/UPDATE/DELETE nesse prefixo (inclusive a equipe, que no resto do
-- mcp-files pode gravar) e só deixam LER o objeto registrado por uma sessão finalizada, na MESMA versão
-- (storage.objects.id + version) conferida na finalização. Upload órfão é ilegível e imutável para o painel.
--
-- Rollback lógico (sem apagar nada): revogar o binding/atestado e/ou as concessões, ou desligar MCP_PROJECT_VIDEO_WRITE.
--   UPDATE public.mcp_operator_author_profiles SET revoked_at = now() WHERE revoked_at IS NULL;
--   UPDATE public.mcp_agent_author_attestations SET revoked_at = now() WHERE revoked_at IS NULL;
-- Rollback do schema (só se autorizado, sem sessões em uso): DROP das políticas "mcp project video: ..." em
--   storage.objects, dos gatilhos mcp_agent_author_serializa em user_roles/team_client_assignments/projects, das funções
--   mcp_project_video_* e mcp_agent_author_*, DROP TABLE public.mcp_project_video_uploads,
--   public.mcp_operator_author_profiles, public.mcp_agent_author_attestations e recriar o CHECK
--   (allow_video_upload = false) em mcp_project_grants (só possível se nenhuma concessão tiver true).
--   Atenção: sem as políticas restritivas, objetos do prefixo voltam a seguir as regras gerais do mcp-files.

-- ─── 1) Opt-in imutável na concessão ─────────────────────────────────────────
DO $$
DECLARE _c record;
BEGIN
  FOR _c IN
    SELECT con.conname
      FROM pg_constraint con
     WHERE con.conrelid = 'public.mcp_project_grants'::regclass
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%allow_video_upload = false%'
  LOOP
    EXECUTE format('ALTER TABLE public.mcp_project_grants DROP CONSTRAINT %I', _c.conname);
  END LOOP;
END
$$;

-- A escrita desta operação é exclusiva do Corte. A concessão escolhe um único projeto.
ALTER TABLE public.mcp_project_grants ADD CONSTRAINT mcp_project_grants_video_only_corte
  CHECK (NOT allow_video_upload OR operator_slug = 'corte');

-- ─── 2) Autoria: perfil dedicado, atestado explícito e vínculo ───────────────
-- Papéis do perfil: existe, não apagado, só design/traffic, nunca admin/manager/client, não é cliente de projeto.
-- (Não decide sozinho: o atestado explícito é exigido à parte.)
CREATE OR REPLACE FUNCTION public.mcp_author_profile_is_dedicated(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
       SELECT 1 FROM auth.users a
        WHERE a.id = p_profile_id AND a.last_sign_in_at IS NULL
          AND a.banned_until > now()
          AND a.raw_app_meta_data ->> 'aceleriq_mcp_author_operator' = 'corte'
     )
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_profile_id AND p.deleted_at IS NULL)
     AND EXISTS (
       SELECT 1 FROM public.user_roles r
        WHERE r.user_id = p_profile_id
          AND r.role IN ('design'::public.app_role, 'traffic'::public.app_role)
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.user_roles r
        WHERE r.user_id = p_profile_id
          AND r.role IN ('admin'::public.app_role, 'manager'::public.app_role, 'client'::public.app_role)
     )
     AND NOT EXISTS (SELECT 1 FROM public.projects pr WHERE pr.client_id = p_profile_id)
$$;
REVOKE ALL ON FUNCTION public.mcp_author_profile_is_dedicated(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- 2a) Atestado explícito: um admin declara, em registro próprio e separado do vínculo, que o perfil é exclusivo do
-- agente (sem login nem uso humano, sem outra função). Papel design/traffic sozinho NÃO prova isso.
CREATE TABLE IF NOT EXISTS public.mcp_agent_author_attestations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    uuid NOT NULL,
  operator_slug text NOT NULL REFERENCES public.internal_operators(slug) ON DELETE RESTRICT ON UPDATE RESTRICT,
  declaracao    text NOT NULL CHECK (declaracao = 'perfil-exclusivo-do-agente:sem-uso-humano:sem-outra-funcao'),
  attested_by   uuid NOT NULL,
  attested_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  CONSTRAINT mcp_agent_author_attestations_not_self CHECK (profile_id <> attested_by)
);
-- IDs de perfil são históricos. As checagens vivas fecham o acesso se o perfil for excluído.
-- Um atestado por perfil, para sempre (revogado, o perfil não volta a ser autor); um ativo por operador.
CREATE UNIQUE INDEX IF NOT EXISTS mcp_agent_author_attestations_profile_once
  ON public.mcp_agent_author_attestations (profile_id);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_agent_author_attestations_one_active
  ON public.mcp_agent_author_attestations (operator_slug) WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION public.mcp_agent_author_attestations_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'mcp_agent_author_attestations: o atestado não é apagado; preencha revoked_at';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.profile_id IS DISTINCT FROM OLD.profile_id
       OR NEW.operator_slug IS DISTINCT FROM OLD.operator_slug
       OR NEW.declaracao IS DISTINCT FROM OLD.declaracao
       OR NEW.attested_by IS DISTINCT FROM OLD.attested_by
       OR NEW.attested_at IS DISTINCT FROM OLD.attested_at
       OR OLD.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'mcp_agent_author_attestations: imutável; só revoked_at (uma vez)';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'mcp_agent_author_attestations: o atestado nasce ativo';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.id = r.user_id
     WHERE r.user_id = NEW.attested_by AND r.role = 'admin'::public.app_role AND p.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'mcp_agent_author_attestations: só um admin atesta';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.internal_operators o WHERE o.slug = NEW.operator_slug AND o.status = 'active' FOR SHARE) THEN
    RAISE EXCEPTION 'mcp_agent_author_attestations: operador interno inexistente ou inativo';
  END IF;
  PERFORM 1 FROM public.profiles p WHERE p.id = NEW.profile_id FOR SHARE OF p;
  IF NOT public.mcp_author_profile_is_dedicated(NEW.profile_id) THEN
    RAISE EXCEPTION 'mcp_agent_author_attestations: o perfil precisa ser só design/traffic, sem admin/manager/client e sem projeto como cliente';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.mcp_agent_author_attestations_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS mcp_agent_author_attestations_guard ON public.mcp_agent_author_attestations;
CREATE TRIGGER mcp_agent_author_attestations_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.mcp_agent_author_attestations
  FOR EACH ROW EXECUTE FUNCTION public.mcp_agent_author_attestations_guard();

ALTER TABLE public.mcp_agent_author_attestations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_agent_author_attestations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.mcp_agent_author_attestations TO service_role;

COMMENT ON TABLE public.mcp_agent_author_attestations IS
  'Atestado explícito de admin: o perfil é exclusivo do agente (sem uso humano). Separado do vínculo; imutável; revogação definitiva.';

-- 2b) Vínculo operador -> perfil atestado.
CREATE TABLE IF NOT EXISTS public.mcp_operator_author_profiles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_slug text NOT NULL REFERENCES public.internal_operators(slug) ON DELETE RESTRICT ON UPDATE RESTRICT,
  profile_id    uuid NOT NULL,
  configured_by uuid NOT NULL,
  configured_at timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  CONSTRAINT mcp_operator_author_profiles_not_self CHECK (profile_id <> configured_by)
);
-- Um perfil serve a UM operador, para sempre (revogado, não é reaproveitado por outro agente).
CREATE UNIQUE INDEX IF NOT EXISTS mcp_operator_author_profiles_profile_once
  ON public.mcp_operator_author_profiles (profile_id);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_operator_author_profiles_one_active
  ON public.mcp_operator_author_profiles (operator_slug) WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION public.mcp_operator_author_profiles_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'mcp_operator_author_profiles: o vínculo não é apagado; preencha revoked_at';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.operator_slug IS DISTINCT FROM OLD.operator_slug
       OR NEW.profile_id IS DISTINCT FROM OLD.profile_id
       OR NEW.configured_by IS DISTINCT FROM OLD.configured_by
       OR NEW.configured_at IS DISTINCT FROM OLD.configured_at
       OR OLD.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'mcp_operator_author_profiles: imutável; só revoked_at (uma vez)';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'mcp_operator_author_profiles: o vínculo nasce ativo';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.id = r.user_id
     WHERE r.user_id = NEW.configured_by AND r.role = 'admin'::public.app_role AND p.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'mcp_operator_author_profiles: só um admin configura o vínculo';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.internal_operators o WHERE o.slug = NEW.operator_slug AND o.status = 'active' FOR SHARE) THEN
    RAISE EXCEPTION 'mcp_operator_author_profiles: operador interno inexistente ou inativo';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.mcp_agent_author_attestations a
     WHERE a.profile_id = NEW.profile_id AND a.operator_slug = NEW.operator_slug AND a.revoked_at IS NULL
     FOR SHARE
  ) THEN
    RAISE EXCEPTION 'mcp_operator_author_profiles: falta o atestado explícito de perfil exclusivo deste agente';
  END IF;
  IF NOT public.mcp_author_profile_is_dedicated(NEW.profile_id) THEN
    RAISE EXCEPTION 'mcp_operator_author_profiles: o perfil precisa ser dedicado, só design/traffic, sem admin/manager/client';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.mcp_operator_author_profiles_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS mcp_operator_author_profiles_guard ON public.mcp_operator_author_profiles;
CREATE TRIGGER mcp_operator_author_profiles_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.mcp_operator_author_profiles
  FOR EACH ROW EXECUTE FUNCTION public.mcp_operator_author_profiles_guard();

ALTER TABLE public.mcp_operator_author_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_operator_author_profiles FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.mcp_operator_author_profiles TO service_role;

COMMENT ON TABLE public.mcp_operator_author_profiles IS
  'Perfil de autoria (atestado à parte) de um operador interno, configurado por admin. Não-admin, não-cliente; imutável, revogação definitiva.';

-- 2c) Concorrência de papéis/carteira: mudar papel (user_roles), carteira (team_client_assignments) ou tornar o
-- perfil cliente de projeto (projects.client_id) TRAVA o atestado do perfil (FOR UPDATE), se houver. As RPCs travam o
-- mesmo atestado FOR SHARE (por último, depois de papéis e carteira): a mudança espera a RPC em curso, e a RPC seguinte
-- espera a mudança e reconfere papéis/carteira em comandos novos (READ COMMITTED). Perfis sem atestado: só uma
-- busca por índice, sem trava.
CREATE OR REPLACE FUNCTION public.mcp_agent_author_serializa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _ids uuid[];
BEGIN
  IF TG_TABLE_NAME = 'projects' THEN
    _ids := ARRAY[NEW.client_id];
  ELSIF TG_OP = 'INSERT' THEN
    _ids := ARRAY[NEW.user_id];
  ELSIF TG_OP = 'DELETE' THEN
    _ids := ARRAY[OLD.user_id];
  ELSE
    _ids := ARRAY[NEW.user_id, OLD.user_id];
  END IF;
  PERFORM 1 FROM public.mcp_agent_author_attestations a
   WHERE a.profile_id = ANY (_ids)
   ORDER BY a.id
   FOR UPDATE;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.mcp_agent_author_serializa() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS mcp_agent_author_serializa ON public.user_roles;
CREATE TRIGGER mcp_agent_author_serializa
  AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.mcp_agent_author_serializa();
DROP TRIGGER IF EXISTS mcp_agent_author_serializa ON public.team_client_assignments;
CREATE TRIGGER mcp_agent_author_serializa
  AFTER INSERT OR UPDATE OR DELETE ON public.team_client_assignments
  FOR EACH ROW EXECUTE FUNCTION public.mcp_agent_author_serializa();
DROP TRIGGER IF EXISTS mcp_agent_author_serializa ON public.projects;
CREATE TRIGGER mcp_agent_author_serializa
  AFTER INSERT OR UPDATE OF client_id ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.mcp_agent_author_serializa();

-- ─── 3) Sessões de envio (uma por chave + idempotency_key) ───────────────────
CREATE TABLE IF NOT EXISTS public.mcp_project_video_uploads (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id         uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE RESTRICT,
  grant_id           uuid NOT NULL REFERENCES public.mcp_project_grants(id) ON DELETE RESTRICT,
  project_id         uuid NOT NULL,
  client_id          uuid NOT NULL,
  operator_slug      text NOT NULL,
  author_binding_id  uuid NOT NULL REFERENCES public.mcp_operator_author_profiles(id) ON DELETE RESTRICT,
  author_attestation_id uuid NOT NULL REFERENCES public.mcp_agent_author_attestations(id) ON DELETE RESTRICT,
  author_profile_id  uuid NOT NULL,
  task_id            uuid NOT NULL,
  task_status        text NOT NULL,
  task_assigned_to   uuid,
  task_milestone_id  uuid,
  idempotency_key    text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'),
  size_bytes         bigint NOT NULL CHECK (size_bytes BETWEEN 1024 AND 104857600),
  sha256             text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_bucket     text NOT NULL DEFAULT 'mcp-files' CHECK (storage_bucket = 'mcp-files'),
  storage_path       text NOT NULL UNIQUE,
  status             text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'finalized', 'review_requested')),
  file_id            uuid UNIQUE,
  attachment_id      uuid UNIQUE,
  -- Versão do objeto conferida (storage.objects.id + version). Fica presa da finalização em diante.
  object_id          uuid UNIQUE,
  object_version     text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  finalized_at       timestamptz,
  review_requested_at timestamptz,
  CONSTRAINT mcp_project_video_uploads_key_idem UNIQUE (api_key_id, idempotency_key),
  CONSTRAINT mcp_project_video_uploads_path_shape CHECK (
    storage_path = client_id::text || '/mcp-project-video/' || id::text || '.mp4'
  ),
  CONSTRAINT mcp_project_video_uploads_state CHECK (
    (status = 'prepared' AND file_id IS NULL AND attachment_id IS NULL AND object_id IS NULL AND object_version IS NULL
       AND finalized_at IS NULL AND review_requested_at IS NULL)
    OR (status = 'finalized' AND file_id IS NOT NULL AND attachment_id IS NOT NULL AND object_id IS NOT NULL
       AND object_version IS NOT NULL AND finalized_at IS NOT NULL AND review_requested_at IS NULL)
    OR (status = 'review_requested' AND file_id IS NOT NULL AND attachment_id IS NOT NULL AND object_id IS NOT NULL
       AND object_version IS NOT NULL AND finalized_at IS NOT NULL AND review_requested_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS mcp_project_video_uploads_task_idx ON public.mcp_project_video_uploads (task_id);

-- Só avança: prepared -> finalized -> review_requested. Identidade, objeto, versão e vínculos nunca mudam. Nunca apagada.
CREATE OR REPLACE FUNCTION public.mcp_project_video_uploads_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'mcp_project_video_uploads: sessão não é apagada';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.api_key_id IS DISTINCT FROM OLD.api_key_id
     OR NEW.grant_id IS DISTINCT FROM OLD.grant_id OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.operator_slug IS DISTINCT FROM OLD.operator_slug
     OR NEW.author_binding_id IS DISTINCT FROM OLD.author_binding_id
     OR NEW.author_attestation_id IS DISTINCT FROM OLD.author_attestation_id
     OR NEW.author_profile_id IS DISTINCT FROM OLD.author_profile_id
     OR NEW.task_id IS DISTINCT FROM OLD.task_id OR NEW.task_status IS DISTINCT FROM OLD.task_status
     OR NEW.task_assigned_to IS DISTINCT FROM OLD.task_assigned_to
     OR NEW.task_milestone_id IS DISTINCT FROM OLD.task_milestone_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes OR NEW.sha256 IS DISTINCT FROM OLD.sha256
     OR NEW.storage_bucket IS DISTINCT FROM OLD.storage_bucket OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
     OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR (OLD.file_id IS NOT NULL AND NEW.file_id IS DISTINCT FROM OLD.file_id)
     OR (OLD.attachment_id IS NOT NULL AND NEW.attachment_id IS DISTINCT FROM OLD.attachment_id)
     OR (OLD.object_id IS NOT NULL AND NEW.object_id IS DISTINCT FROM OLD.object_id)
     OR (OLD.object_version IS NOT NULL AND NEW.object_version IS DISTINCT FROM OLD.object_version)
     OR (OLD.finalized_at IS NOT NULL AND NEW.finalized_at IS DISTINCT FROM OLD.finalized_at)
     OR NOT (
       (OLD.status = 'prepared' AND NEW.status IN ('prepared', 'finalized'))
       OR (OLD.status = 'finalized' AND NEW.status IN ('finalized', 'review_requested'))
       OR (OLD.status = 'review_requested' AND NEW.status = 'review_requested'
           AND NEW.review_requested_at IS NOT DISTINCT FROM OLD.review_requested_at)
     ) THEN
    RAISE EXCEPTION 'mcp_project_video_uploads: transição inválida';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.mcp_project_video_uploads_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS mcp_project_video_uploads_guard ON public.mcp_project_video_uploads;
CREATE TRIGGER mcp_project_video_uploads_guard
  BEFORE UPDATE OR DELETE ON public.mcp_project_video_uploads
  FOR EACH ROW EXECUTE FUNCTION public.mcp_project_video_uploads_guard();

-- Escrita só pelas RPCs abaixo (definidoras). O MCP (service_role) só lê; ninguém mais vê.
ALTER TABLE public.mcp_project_video_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_project_video_uploads FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.mcp_project_video_uploads TO service_role;

COMMENT ON TABLE public.mcp_project_video_uploads IS
  'Envio de MP4 por chave presa a projeto/operador: tarefa, objeto (caminho único gerado no servidor, versão presa na finalização), autoria e estado. Sem URL assinada.';

-- ─── 4) Área protegida do Storage (prefixo reservado) ────────────────────────
-- mcp-files/<qualquer>/mcp-project-video/...: o painel (anon/authenticated) nunca grava, move, sobrescreve ou apaga;
-- só lê o objeto registrado por sessão finalizada, na versão presa. O envio acontece pela URL assinada de upload
-- (sem upsert) gerada pelo MCP; conferência e registro só pelas RPCs. service_role e funções definidoras não passam
-- por RLS: a integridade contra eles vem da versão presa (seção 5).
CREATE OR REPLACE FUNCTION public.mcp_project_video_area_reservada(_bucket text, _name text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT coalesce(_bucket = 'mcp-files' AND lower(split_part(_name, '/', 2)) = 'mcp-project-video', false)
$$;
REVOKE ALL ON FUNCTION public.mcp_project_video_area_reservada(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mcp_project_video_area_reservada(text, text) TO anon, authenticated, service_role;

-- Objeto do prefixo legível só se for o registrado por uma sessão finalizada, com o MESMO id e a MESMA versão.
CREATE OR REPLACE FUNCTION public.mcp_project_video_objeto_registrado(_name text, _object_id uuid, _version text)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mcp_project_video_uploads u
      JOIN public.files f ON f.id = u.file_id AND f.storage_bucket = u.storage_bucket AND f.storage_path = u.storage_path
     WHERE u.storage_path = _name
       AND u.status IN ('finalized', 'review_requested')
       AND u.object_id = _object_id
       AND u.object_version = _version
       AND public.can_read_file(f.id)
  )
$$;
REVOKE ALL ON FUNCTION public.mcp_project_video_objeto_registrado(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mcp_project_video_objeto_registrado(text, uuid, text) TO anon, authenticated;

-- Preflight: o prefixo nasce vazio. Objeto ou registro pré-existente nele = parar e investigar (nada é apagado).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM storage.objects o
     WHERE public.mcp_project_video_area_reservada(o.bucket_id, o.name)
       AND NOT EXISTS (SELECT 1 FROM public.mcp_project_video_uploads u WHERE u.storage_path = o.name)
  ) OR EXISTS (
    SELECT 1 FROM public.files f
     WHERE public.mcp_project_video_area_reservada(f.storage_bucket, f.storage_path)
       AND NOT EXISTS (SELECT 1 FROM public.mcp_project_video_uploads u WHERE u.file_id = f.id)
  ) THEN
    RAISE EXCEPTION 'preflight: há objeto ou arquivo no prefixo reservado mcp-files/*/mcp-project-video/ sem sessão';
  END IF;
END
$$;

-- Políticas RESTRITIVAS (somam-se com AND às permissivas existentes, atuais e futuras).
DROP POLICY IF EXISTS "mcp project video: sem envio pelo painel" ON storage.objects;
CREATE POLICY "mcp project video: sem envio pelo painel" ON storage.objects
AS RESTRICTIVE FOR INSERT TO anon, authenticated
WITH CHECK (NOT public.mcp_project_video_area_reservada(storage.objects.bucket_id, storage.objects.name));

DROP POLICY IF EXISTS "mcp project video: nao muda" ON storage.objects;
CREATE POLICY "mcp project video: nao muda" ON storage.objects
AS RESTRICTIVE FOR UPDATE TO anon, authenticated
USING (NOT public.mcp_project_video_area_reservada(storage.objects.bucket_id, storage.objects.name))
WITH CHECK (NOT public.mcp_project_video_area_reservada(storage.objects.bucket_id, storage.objects.name));

DROP POLICY IF EXISTS "mcp project video: nao sai" ON storage.objects;
CREATE POLICY "mcp project video: nao sai" ON storage.objects
AS RESTRICTIVE FOR DELETE TO anon, authenticated
USING (NOT public.mcp_project_video_area_reservada(storage.objects.bucket_id, storage.objects.name));

DROP POLICY IF EXISTS "mcp project video: leitura so registrada" ON storage.objects;
CREATE POLICY "mcp project video: leitura so registrada" ON storage.objects
AS RESTRICTIVE FOR SELECT TO anon, authenticated
USING (
  NOT public.mcp_project_video_area_reservada(storage.objects.bucket_id, storage.objects.name)
  OR public.mcp_project_video_objeto_registrado(storage.objects.name, storage.objects.id, storage.objects.version)
);

-- Só uma tarefa pode referenciar o objeto de uma sessão, inclusive em inserções concorrentes.
CREATE UNIQUE INDEX mcp_project_video_unique_attachment
  ON public.task_attachments (file_url)
  WHERE file_url LIKE 'mcp-files://%/mcp-project-video/%';

-- ─── 5) Conferência viva (mesma transação de cada RPC) ───────────────────────
-- Ordem de travas compatível com a cascata de exclusão do cliente e com a revogação em projects:
--   cliente -> projeto -> chave -> concessão -> operador -> vínculo -> Auth -> perfil -> papéis -> carteira -> atestado.
-- Revogação/arquivamento/mudança concorrente espera esta transação e vale para a próxima; tudo o que decide é
-- reconferido DEPOIS das travas, em comandos novos.
CREATE OR REPLACE FUNCTION public.mcp_project_video_contexto(p_api_key_id uuid)
RETURNS TABLE (grant_id uuid, project_id uuid, client_id uuid, operator_slug text, binding_id uuid,
               attestation_id uuid, author_profile_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _g public.mcp_project_grants%ROWTYPE;
  _b public.mcp_operator_author_profiles%ROWTYPE;
  _a public.mcp_agent_author_attestations%ROWTYPE;
  _projeto uuid;
  _cliente uuid;
  _n integer;
BEGIN
  -- Exatamente uma concessão para a chave (revogada inclusa). A linha é imutável: lê o projeto sem travar.
  SELECT count(*) INTO _n FROM public.mcp_project_grants g WHERE g.api_key_id = p_api_key_id;
  IF _n <> 1 THEN RAISE EXCEPTION 'mcp_video:negado'; END IF;
  SELECT g.project_id, g.client_id INTO _projeto, _cliente
    FROM public.mcp_project_grants g WHERE g.api_key_id = p_api_key_id;
  PERFORM 1 FROM public.profiles pr WHERE pr.id = _cliente AND pr.deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'mcp_video:negado'; END IF;

  -- 1) Projeto ANTES da concessão (o gatilho de revogação em projects trava projeto -> concessões).
  PERFORM 1 FROM public.projects p WHERE p.id = _projeto FOR SHARE OF p;
  IF NOT FOUND THEN RAISE EXCEPTION 'mcp_video:negado'; END IF;

  -- 2) Chave.
  PERFORM 1 FROM public.api_keys k
   WHERE k.id = p_api_key_id AND k.scopes = ARRAY['mcp:project']::text[] AND k.audience = 'mcp'
     AND k.is_active = true AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > now())
   FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'mcp_video:negado'; END IF;

  -- 3) Concessão, revalidada depois da trava.
  SELECT * INTO _g FROM public.mcp_project_grants g WHERE g.api_key_id = p_api_key_id FOR SHARE;
  IF NOT FOUND OR _g.project_id IS DISTINCT FROM _projeto OR _g.client_id IS DISTINCT FROM _cliente
     OR _g.revoked_at IS NOT NULL
     OR _g.allow_video_upload IS NOT TRUE OR _g.operator_slug IS DISTINCT FROM 'corte' THEN
    RAISE EXCEPTION 'mcp_video:negado';
  END IF;

  -- 4) Operador.
  PERFORM 1 FROM public.internal_operators o WHERE o.slug = _g.operator_slug AND o.status = 'active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'mcp_video:negado'; END IF;

  -- Revalidação do projeto (já travado): vivo, do cliente, cliente não apagado.
  IF NOT public.mcp_project_is_live(_g.project_id, _g.client_id) THEN
    RAISE EXCEPTION 'mcp_video:negado';
  END IF;

  -- 5) Vínculo de autoria.
  SELECT * INTO _b FROM public.mcp_operator_author_profiles b
   WHERE b.operator_slug = _g.operator_slug AND b.revoked_at IS NULL
   FOR SHARE;
  IF NOT FOUND OR _b.profile_id = _g.client_id THEN RAISE EXCEPTION 'mcp_video:autoria'; END IF;

  -- 6) Perfil, 7) papéis e 8) carteira: linhas existentes travadas (remoção/alteração concorrente espera).
  PERFORM 1 FROM auth.users a WHERE a.id = _b.profile_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'mcp_video:autoria'; END IF;
  PERFORM 1 FROM public.profiles pr WHERE pr.id = _b.profile_id AND pr.deleted_at IS NULL FOR SHARE OF pr;
  IF NOT FOUND THEN RAISE EXCEPTION 'mcp_video:autoria'; END IF;
  PERFORM 1 FROM public.user_roles r WHERE r.user_id = _b.profile_id ORDER BY r.role FOR SHARE;
  PERFORM 1 FROM public.team_client_assignments a
   WHERE a.user_id = _b.profile_id AND a.client_id = _g.client_id
   FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'mcp_video:autoria'; END IF;

  -- 9) Atestado por último: papel/carteira/projeto novo do perfil (gatilho mcp_agent_author_serializa) espera aqui.
  SELECT * INTO _a FROM public.mcp_agent_author_attestations a
   WHERE a.profile_id = _b.profile_id AND a.operator_slug = _g.operator_slug AND a.revoked_at IS NULL
   FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'mcp_video:autoria'; END IF;

  -- Decisão em comandos novos, depois de todas as travas.
  IF NOT public.mcp_author_profile_is_dedicated(_b.profile_id)
     OR NOT EXISTS (
       SELECT 1 FROM public.team_client_assignments a WHERE a.user_id = _b.profile_id AND a.client_id = _g.client_id
     ) THEN
    RAISE EXCEPTION 'mcp_video:autoria';
  END IF;

  RETURN QUERY SELECT _g.id, _g.project_id, _g.client_id, _g.operator_slug, _b.id, _a.id, _b.profile_id;
END;
$$;
REVOKE ALL ON FUNCTION public.mcp_project_video_contexto(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Sessão da chave (FOR UPDATE) + contexto vivo + tarefa com os MESMOS vínculos do preparo (projeto, estado,
-- responsável, marco). As RPCs nunca alteram a tarefa: só anexam.
CREATE OR REPLACE FUNCTION public.mcp_project_video_sessao(p_api_key_id uuid, p_upload_id uuid, p_idempotency_key text)
RETURNS public.mcp_project_video_uploads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _s public.mcp_project_video_uploads%ROWTYPE;
  _c record;
  _t record;
BEGIN
  SELECT * INTO _c FROM public.mcp_project_video_contexto(p_api_key_id);
  SELECT * INTO _s FROM public.mcp_project_video_uploads u
   WHERE u.id = p_upload_id AND u.api_key_id = p_api_key_id AND u.idempotency_key = p_idempotency_key
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'mcp_video:nao_encontrado'; END IF;
  IF _s.grant_id <> _c.grant_id OR _s.project_id <> _c.project_id OR _s.client_id <> _c.client_id
     OR _s.operator_slug <> _c.operator_slug THEN
    RAISE EXCEPTION 'mcp_video:negado';
  END IF;
  IF _s.author_binding_id <> _c.binding_id OR _s.author_attestation_id <> _c.attestation_id
     OR _s.author_profile_id <> _c.author_profile_id THEN
    RAISE EXCEPTION 'mcp_video:autoria';
  END IF;
  SELECT t.project_id, t.status, t.assigned_to, t.milestone_id, t.deleted_at INTO _t
    FROM public.tasks t WHERE t.id = _s.task_id FOR SHARE;
  IF NOT FOUND OR _t.deleted_at IS NOT NULL OR _t.project_id IS DISTINCT FROM _s.project_id
     OR _t.status IS DISTINCT FROM _s.task_status OR _t.assigned_to IS DISTINCT FROM _s.task_assigned_to
     OR _t.milestone_id IS DISTINCT FROM _s.task_milestone_id THEN
    RAISE EXCEPTION 'mcp_video:tarefa';
  END IF;
  RETURN _s;
END;
$$;
REVOKE ALL ON FUNCTION public.mcp_project_video_sessao(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;

-- Registro de sessão finalizada: arquivo canônico, anexo, ausência de filhos e objeto na versão presa.
-- Usado antes de QUALQUER resposta de repetição e antes do pedido de revisão. p_exclusivo = trava o arquivo
-- FOR UPDATE (conflita com a FK de um filho novo: nenhum filho entra enquanto a operação unitária corre).
CREATE OR REPLACE FUNCTION public.mcp_project_video_registro_confere(p_upload_id uuid, p_exclusivo boolean)
RETURNS public.files
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _s public.mcp_project_video_uploads%ROWTYPE;
  _f public.files%ROWTYPE;
  _o record;
  _url text;
BEGIN
  SELECT * INTO _s FROM public.mcp_project_video_uploads u WHERE u.id = p_upload_id;
  IF NOT FOUND OR _s.status NOT IN ('finalized', 'review_requested') THEN RAISE EXCEPTION 'mcp_video:estado'; END IF;
  _url := 'mcp-files://' || _s.storage_path;

  IF p_exclusivo THEN
    SELECT * INTO _f FROM public.files f WHERE f.id = _s.file_id FOR UPDATE;
  ELSE
    SELECT * INTO _f FROM public.files f WHERE f.id = _s.file_id FOR SHARE;
  END IF;
  IF NOT FOUND
     OR _f.client_id IS DISTINCT FROM _s.client_id OR _f.project_id IS DISTINCT FROM _s.project_id
     OR _f.parent_file_id IS NOT NULL OR _f.revision_of_file_id IS NOT NULL
     OR _f.storage_bucket IS DISTINCT FROM _s.storage_bucket OR _f.storage_path IS DISTINCT FROM _s.storage_path
     OR _f.file_url IS DISTINCT FROM _url OR _f.uploaded_by IS DISTINCT FROM _s.author_profile_id
     OR _f.idempotency_key IS DISTINCT FROM ('mcp-project-video:' || _s.id::text)
     OR _f.sha256 IS DISTINCT FROM _s.sha256 OR _f.size_bytes IS DISTINCT FROM _s.size_bytes
     OR _f.archived_at IS NOT NULL OR _f.status IS DISTINCT FROM 'ready'
     OR _f.source IS DISTINCT FROM 'mcp:project-video'
     OR _f.file_type IS DISTINCT FROM 'video' OR _f.mime_type IS DISTINCT FROM 'video/mp4' THEN
    RAISE EXCEPTION 'mcp_video:estado';
  END IF;
  -- Objeto pertence a UM registro e a UM anexo; o arquivo não tem filhos nem revisões apontando para ele.
  IF (SELECT count(*) FROM public.files f WHERE f.storage_bucket = _s.storage_bucket AND f.storage_path = _s.storage_path) <> 1
     OR EXISTS (SELECT 1 FROM public.files f WHERE f.parent_file_id = _s.file_id OR f.revision_of_file_id = _s.file_id)
     OR (SELECT count(*) FROM public.task_attachments a WHERE a.file_url = _url) <> 1 THEN
    RAISE EXCEPTION 'mcp_video:estado';
  END IF;
  PERFORM 1 FROM public.task_attachments a
   WHERE a.id = _s.attachment_id AND a.task_id = _s.task_id AND a.file_url = _url
     AND a.uploaded_by = _s.author_profile_id AND a.file_type = 'video/mp4'
     AND a.file_size = _s.size_bytes
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mcp_video:estado';
  END IF;
  -- Mesma versão do objeto conferida na finalização (troca, remoção ou regravação = fora).
  SELECT o.id, o.version, o.metadata INTO _o FROM storage.objects o
   WHERE o.bucket_id = _s.storage_bucket AND o.name = _s.storage_path
   FOR SHARE;
  IF NOT FOUND OR _o.id IS DISTINCT FROM _s.object_id OR _o.version IS DISTINCT FROM _s.object_version
     OR (_o.metadata ->> 'size') IS DISTINCT FROM _s.size_bytes::text THEN
    RAISE EXCEPTION 'mcp_video:estado';
  END IF;
  RETURN _f;
END;
$$;
REVOKE ALL ON FUNCTION public.mcp_project_video_registro_confere(uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;

-- ─── 6) RPCs do MCP (service_role) ───────────────────────────────────────────
-- Preparo: tarefa viva do projeto da concessão; caminho gerado aqui (nunca vem do chamador).
-- Mesma chave + mesma idempotency_key + mesmos dados = mesma sessão; dados diferentes = conflito.
CREATE OR REPLACE FUNCTION public.mcp_project_video_prepare(
  p_api_key_id uuid, p_task_id uuid, p_size_bytes bigint, p_sha256 text, p_idempotency_key text
)
RETURNS TABLE (upload_id uuid, status text, storage_path text, expires_at timestamptz, reused boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _c record;
  _t record;
  _s public.mcp_project_video_uploads%ROWTYPE;
  _id uuid := gen_random_uuid();
  _novo uuid;
BEGIN
  IF p_task_id IS NULL OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$'
     OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$'
     OR p_size_bytes IS NULL OR p_size_bytes < 1024 OR p_size_bytes > 104857600 THEN
    RAISE EXCEPTION 'mcp_video:entrada';
  END IF;
  SELECT * INTO _c FROM public.mcp_project_video_contexto(p_api_key_id);

  SELECT u.id INTO _novo FROM public.mcp_project_video_uploads u
   WHERE u.api_key_id = p_api_key_id AND u.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    _s := public.mcp_project_video_sessao(p_api_key_id, _novo, p_idempotency_key);
    IF _s.task_id <> p_task_id OR _s.size_bytes <> p_size_bytes OR _s.sha256 <> p_sha256 THEN
      RAISE EXCEPTION 'mcp_video:conflito';
    END IF;
    IF _s.status = 'prepared' AND _s.expires_at <= now() THEN RAISE EXCEPTION 'mcp_video:expirado'; END IF;
    IF _s.status <> 'prepared' THEN PERFORM public.mcp_project_video_registro_confere(_s.id, false); END IF;
    RETURN QUERY SELECT _s.id, _s.status, CASE WHEN _s.status = 'prepared' THEN _s.storage_path END, _s.expires_at, true;
    RETURN;
  END IF;

  SELECT t.status, t.assigned_to, t.milestone_id INTO _t FROM public.tasks t
   WHERE t.id = p_task_id AND t.project_id = _c.project_id AND t.deleted_at IS NULL
     AND lower(coalesce(t.status, '')) NOT IN ('done', 'cancelled', 'canceled', 'archived')
   FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'mcp_video:tarefa'; END IF;

  INSERT INTO public.mcp_project_video_uploads AS u (
    id, api_key_id, grant_id, project_id, client_id, operator_slug, author_binding_id, author_attestation_id,
    author_profile_id, task_id, task_status, task_assigned_to, task_milestone_id, idempotency_key, size_bytes, sha256,
    storage_path, expires_at
  ) VALUES (
    _id, p_api_key_id, _c.grant_id, _c.project_id, _c.client_id, _c.operator_slug, _c.binding_id, _c.attestation_id,
    _c.author_profile_id, p_task_id, _t.status, _t.assigned_to, _t.milestone_id, p_idempotency_key, p_size_bytes, p_sha256,
    _c.client_id::text || '/mcp-project-video/' || _id::text || '.mp4', now() + interval '3 hours'
  )
  ON CONFLICT ON CONSTRAINT mcp_project_video_uploads_key_idem DO NOTHING
  RETURNING u.id INTO _novo;
  IF _novo IS NULL THEN
    -- Corrida com a mesma idempotency_key: a outra transação já gravou; responde como repetição.
    RETURN QUERY SELECT * FROM public.mcp_project_video_prepare(p_api_key_id, p_task_id, p_size_bytes, p_sha256, p_idempotency_key);
    RETURN;
  END IF;
  RETURN QUERY SELECT _id, 'prepared'::text, _c.client_id::text || '/mcp-project-video/' || _id::text || '.mp4',
    now() + interval '3 hours', false;
END;
$$;

-- Antes de baixar o objeto: mesma conferência viva; devolve o que o servidor precisa para validar, inclusive o
-- tamanho, o id e a VERSÃO que o Storage registrou. A finalização só aceita essa mesma versão.
CREATE OR REPLACE FUNCTION public.mcp_project_video_open(p_api_key_id uuid, p_upload_id uuid, p_idempotency_key text)
RETURNS TABLE (status text, storage_path text, size_bytes bigint, sha256 text, file_id uuid, attachment_id uuid,
               object_bytes bigint, object_id uuid, object_version text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _s public.mcp_project_video_uploads%ROWTYPE;
  _o record;
BEGIN
  _s := public.mcp_project_video_sessao(p_api_key_id, p_upload_id, p_idempotency_key);
  IF _s.status <> 'prepared' THEN
    PERFORM public.mcp_project_video_registro_confere(_s.id, false);
    RETURN QUERY SELECT _s.status, _s.storage_path, _s.size_bytes, _s.sha256, _s.file_id, _s.attachment_id,
      _s.size_bytes, _s.object_id, _s.object_version;
    RETURN;
  END IF;
  IF _s.expires_at <= now() THEN RAISE EXCEPTION 'mcp_video:expirado'; END IF;
  SELECT o.id, o.version,
         CASE WHEN (o.metadata ->> 'size') ~ '^[0-9]+$' THEN (o.metadata ->> 'size')::bigint END AS bytes
    INTO _o
    FROM storage.objects o WHERE o.bucket_id = _s.storage_bucket AND o.name = _s.storage_path;
  RETURN QUERY SELECT _s.status, _s.storage_path, _s.size_bytes, _s.sha256, _s.file_id, _s.attachment_id,
    _o.bytes, _o.id, _o.version;
END;
$$;

-- Finalização: objeto conferido (tamanho, MIME e sha256 declarados; cabeçalho MP4 validado no servidor) e PRESO à
-- versão aberta (storage.objects.id + version, travado FOR SHARE); registro canônico em files + anexo na tarefa com o
-- MESMO objeto, autoria do perfil dedicado. Repetição reconfere o registro e devolve o mesmo.
CREATE OR REPLACE FUNCTION public.mcp_project_video_finalize(
  p_api_key_id uuid, p_upload_id uuid, p_idempotency_key text, p_size_bytes bigint, p_sha256 text, p_header_ok boolean,
  p_object_id uuid, p_object_version text
)
RETURNS TABLE (status text, file_id uuid, attachment_id uuid, reused boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _s public.mcp_project_video_uploads%ROWTYPE;
  _o record;
  _titulo text;
  _agente text;
  _nome text;
  _url text;
  _file uuid := gen_random_uuid();
  _anexo uuid := gen_random_uuid();
BEGIN
  _s := public.mcp_project_video_sessao(p_api_key_id, p_upload_id, p_idempotency_key);
  IF _s.status IN ('finalized', 'review_requested') THEN
    PERFORM public.mcp_project_video_registro_confere(_s.id, false);
    RETURN QUERY SELECT _s.status, _s.file_id, _s.attachment_id, true;
    RETURN;
  END IF;
  IF _s.expires_at <= now() THEN RAISE EXCEPTION 'mcp_video:expirado'; END IF;
  IF p_header_ok IS NOT TRUE OR p_size_bytes IS DISTINCT FROM _s.size_bytes OR p_sha256 IS DISTINCT FROM _s.sha256
     OR p_object_id IS NULL OR p_object_version IS NULL OR p_object_version = '' THEN
    RAISE EXCEPTION 'mcp_video:objeto';
  END IF;
  -- A versão baixada e conferida pelo servidor é a que está lá agora; trava contra troca/remoção até o commit.
  SELECT o.id, o.version INTO _o FROM storage.objects o
   WHERE o.bucket_id = _s.storage_bucket AND o.name = _s.storage_path
     AND (o.metadata ->> 'size') ~ '^[0-9]+$' AND (o.metadata ->> 'size')::bigint = _s.size_bytes
     AND lower(coalesce(o.metadata ->> 'mimetype', '')) = 'video/mp4'
   FOR SHARE;
  IF NOT FOUND OR _o.id IS DISTINCT FROM p_object_id OR _o.version IS DISTINCT FROM p_object_version THEN
    RAISE EXCEPTION 'mcp_video:objeto';
  END IF;
  -- O objeto pertence a esta sessão e a nenhum outro registro ou anexo.
  _url := 'mcp-files://' || _s.storage_path;
  IF EXISTS (SELECT 1 FROM public.files f WHERE f.storage_bucket = _s.storage_bucket AND f.storage_path = _s.storage_path)
     OR EXISTS (SELECT 1 FROM public.task_attachments a WHERE a.file_url = _url) THEN
    RAISE EXCEPTION 'mcp_video:estado';
  END IF;

  SELECT left(regexp_replace(btrim(t.title), '[[:cntrl:]/\\]+', ' ', 'g'), 150) INTO _titulo
    FROM public.tasks t WHERE t.id = _s.task_id;
  SELECT o.display_name INTO _agente FROM public.internal_operators o WHERE o.slug = _s.operator_slug;
  _nome := coalesce(nullif(_titulo, ''), 'Vídeo') || '.mp4';

  INSERT INTO public.files (
    id, client_id, project_id, uploaded_by, file_name, file_url, file_type, folder, description,
    mime_type, extension, size_bytes, sha256, storage_bucket, storage_path, status, extraction_status,
    sensitivity, source, tags, idempotency_key
  ) VALUES (
    _file, _s.client_id, _s.project_id, _s.author_profile_id, _nome, _url, 'video', 'materiais',
    'Enviado pelo agente ' || coalesce(_agente, _s.operator_slug) || ' para a tarefa "' || coalesce(_titulo, '') || '"',
    'video/mp4', 'mp4', _s.size_bytes, _s.sha256, _s.storage_bucket, _s.storage_path, 'ready', 'unsupported',
    'normal', 'mcp:project-video', ARRAY['agente:' || _s.operator_slug], 'mcp-project-video:' || _s.id::text
  );
  INSERT INTO public.task_attachments (id, task_id, file_name, file_url, file_type, file_size, uploaded_by)
  VALUES (_anexo, _s.task_id, _nome, _url, 'video/mp4', _s.size_bytes::integer, _s.author_profile_id);

  UPDATE public.mcp_project_video_uploads u
     SET status = 'finalized', file_id = _file, attachment_id = _anexo, finalized_at = now(),
         object_id = _o.id, object_version = _o.version
   WHERE u.id = _s.id;
  RETURN QUERY SELECT 'finalized'::text, _file, _anexo, false;
END;
$$;

-- Pedido de revisão HUMANA da agência (Gate 1) só do arquivo desta sessão, pelo contrato de sempre
-- (request_file_agency_review). Operação UNITÁRIA: arquivo travado FOR UPDATE, sem filhos nem revisões ligadas,
-- objeto na versão presa. O ator é o perfil dedicado, nesta transação. Depois da chamada o arquivo PRECISA estar
-- só em revisão interna (pending, sem decisão do cliente, interno, destravado, sem filhos, um único evento);
-- qualquer outro efeito desfaz tudo. O Gate 2 (cliente) segue humano, no painel.
CREATE OR REPLACE FUNCTION public.mcp_project_video_request_review(p_api_key_id uuid, p_upload_id uuid, p_idempotency_key text)
RETURNS TABLE (status text, file_id uuid, agency_approval_status text, reused boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _s public.mcp_project_video_uploads%ROWTYPE;
  _f public.files%ROWTYPE;
  _sub text;
  _role text;
  _claims text;
BEGIN
  _s := public.mcp_project_video_sessao(p_api_key_id, p_upload_id, p_idempotency_key);
  IF _s.status = 'review_requested' THEN
    _f := public.mcp_project_video_registro_confere(_s.id, false);
    RETURN QUERY SELECT _s.status, _s.file_id, _f.agency_approval_status::text, true;
    RETURN;
  END IF;
  IF _s.status <> 'finalized' THEN RAISE EXCEPTION 'mcp_video:estado'; END IF;

  _f := public.mcp_project_video_registro_confere(_s.id, true);
  IF _f.locked_at IS NOT NULL OR _f.visibility IS DISTINCT FROM 'internal'
     OR _f.agency_approval_status IS DISTINCT FROM 'not_requested' OR _f.approval_status IS DISTINCT FROM 'none'
     OR EXISTS (SELECT 1 FROM public.file_approval_events e WHERE e.file_id = _s.file_id) THEN
    RAISE EXCEPTION 'mcp_video:estado';
  END IF;

  -- auth.uid() = perfil dedicado só durante a chamada; o contrato confere papel, carteira do cliente e estado.
  _sub := current_setting('request.jwt.claim.sub', true);
  _role := current_setting('request.jwt.claim.role', true);
  _claims := current_setting('request.jwt.claims', true);
  PERFORM set_config('request.jwt.claim.sub', _s.author_profile_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _s.author_profile_id::text, 'role', 'authenticated')::text, true);
  PERFORM public.request_file_agency_review(_s.file_id);
  PERFORM set_config('request.jwt.claim.sub', coalesce(_sub, ''), true);
  PERFORM set_config('request.jwt.claim.role', coalesce(_role, ''), true);
  PERFORM set_config('request.jwt.claims', coalesce(_claims, ''), true);

  -- Exclusivamente revisão interna: nada além do pedido de Gate 1 deste arquivo.
  SELECT * INTO _f FROM public.files f WHERE f.id = _s.file_id;
  IF _f.agency_approval_status IS DISTINCT FROM 'pending'
     OR _f.approval_status IS DISTINCT FROM 'none' OR _f.visibility IS DISTINCT FROM 'internal'
     OR _f.locked_at IS NOT NULL OR _f.archived_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.files f WHERE f.parent_file_id = _s.file_id OR f.revision_of_file_id = _s.file_id)
     OR (SELECT count(*) FROM public.file_approval_events e WHERE e.file_id = _s.file_id) <> 1
     OR NOT EXISTS (
       SELECT 1 FROM public.file_approval_events e
        WHERE e.file_id = _s.file_id AND e.event_type = 'agency_review_requested'
          AND e.actor_id = _s.author_profile_id AND e.to_status = 'pending'
     ) THEN
    RAISE EXCEPTION 'mcp_video:estado';
  END IF;

  UPDATE public.mcp_project_video_uploads u
     SET status = 'review_requested', review_requested_at = now()
   WHERE u.id = _s.id;
  RETURN QUERY SELECT 'review_requested'::text, _s.file_id, _f.agency_approval_status::text, false;
END;
$$;

REVOKE ALL ON FUNCTION public.mcp_project_video_prepare(uuid, uuid, bigint, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_project_video_open(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_project_video_finalize(uuid, uuid, text, bigint, text, boolean, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_project_video_request_review(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_project_video_prepare(uuid, uuid, bigint, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_project_video_open(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_project_video_finalize(uuid, uuid, text, bigint, text, boolean, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_project_video_request_review(uuid, uuid, text) TO service_role;
