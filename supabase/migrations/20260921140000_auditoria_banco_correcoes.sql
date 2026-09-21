-- Auditoria do banco (21/09/2026): correcoes confirmadas.
--
-- 1. project_memory: o cliente so le o que foi marcado como visivel para ele.
-- 2. notificacao_por_email: o link do e-mail so aponta para o painel, e o
--    pedido ao net.http_post espera 15 s (o padrao de 5 s perdia e-mail
--    quando a funcao de borda acordava fria).
-- 3. notifications_insert: quem nao e administrador so grava aviso para si.
-- 4. file_root_state: le a raiz so se quem chama pode ler o arquivo, como a
--    irma file_guard_state ja fazia.
-- 5. CRM: nome de empresa unico entre as vivas (sem duplicata no banco em
--    21/09, conferido antes de criar).
-- 6. Desempenho: indice duplicado fora; indices de chave estrangeira e de
--    ordenacao que faltavam.
-- 7. Cron: jobs de 5/10/15/30 min deixam de disparar todos no mesmo minuto.
-- 8. autopublish_status_secure vira barreira de seguranca.

-- ---------------------------------------------------------------------------
-- 1. project_memory: cliente le so o que e client_visible
-- ---------------------------------------------------------------------------
-- Antes: qual = (client_id = auth.uid()), ou seja, o cliente lia as 48 linhas
-- da propria memoria, inclusive as 41 internas. A politica da equipe
-- ("memory staff full") fica como esta.
DROP POLICY IF EXISTS "memory client read own" ON public.project_memory;
CREATE POLICY "memory client read own" ON public.project_memory
  FOR SELECT TO authenticated
  USING (
    client_id = auth.uid()
    AND coalesce((metadata->>'client_visible')::boolean, false)
  );

-- ---------------------------------------------------------------------------
-- 2. notificacao_por_email: link so do painel e espera de 15 s
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notificacao_por_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _email text; _nome text; _segredo text; _portao text; _base text; _req bigint; _link text; _na_hora integer;
BEGIN
  IF NOT (public.notificacao_merece_email(NEW.notification_type)
          OR (NEW.notification_type = 'system' AND NEW.message LIKE 'Cliente acessou o portal:%')) THEN
    RETURN NEW;
  END IF;
  SELECT p.email, COALESCE(NULLIF(p.full_name, ''), 'equipe') INTO _email, _nome
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role IN ('admin', 'manager')
   WHERE p.id = NEW.user_id AND p.deleted_at IS NULL
   LIMIT 1;
  IF _email IS NULL OR _email ILIKE 'n8n@%' THEN RETURN NEW; END IF;

  SELECT count(*) INTO _na_hora FROM public.notification_email_log l
   WHERE l.user_id = NEW.user_id AND l.created_at > now() - interval '1 hour';
  IF _na_hora >= 20 THEN RETURN NEW; END IF;

  SELECT decrypted_secret INTO _segredo FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;
  SELECT decrypted_secret INTO _portao FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key' LIMIT 1;
  IF _segredo IS NULL OR _portao IS NULL THEN RETURN NEW; END IF;
  _base := 'https://jjjtkowvxemvituvywvf.supabase.co';
  -- O link do e-mail so pode levar ao painel: caminho relativo ou o proprio
  -- dominio. Qualquer outra URL gravada em notifications.link vira a raiz.
  _link := CASE WHEN NEW.link IS NULL OR NEW.link = '' THEN 'https://aceleriq.online'
                WHEN NEW.link LIKE '/%' THEN 'https://aceleriq.online' || NEW.link
                WHEN NEW.link LIKE 'https://aceleriq.online%' THEN NEW.link
                ELSE 'https://aceleriq.online' END;

  BEGIN
    SELECT net.http_post(
      url := _base || '/functions/v1/send-transactional-email',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || _portao, 'x-cron-secret', _segredo),
      body := jsonb_build_object(
        'templateName', 'aviso-do-painel',
        'recipientEmail', _email,
        'idempotencyKey', 'notificacao-' || NEW.id::text,
        'templateData', jsonb_build_object(
          'name', _nome,
          'message', NEW.message,
          'kind', CASE WHEN NEW.notification_type = 'system' THEN 'acesso' ELSE NEW.notification_type END,
          'link', _link,
          'when', to_char(NEW.created_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
        )
      ),
      timeout_milliseconds := 15000
    ) INTO _req;
    INSERT INTO public.notification_email_log (notification_id, user_id, request_id) VALUES (NEW.id, NEW.user_id, _req)
    ON CONFLICT (notification_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'notificacao_por_email falhou (%): %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. notifications_insert: equipe sem cargo de administrador grava so para si
-- ---------------------------------------------------------------------------
-- Antes: with_check = (user_id = auth.uid()) OR is_staff(auth.uid()), ou seja,
-- qualquer pessoa da equipe gravava aviso em nome de qualquer usuario.
-- A chave de servico nao passa por RLS e continua igual.
DROP POLICY IF EXISTS notifications_insert ON public.notifications;
CREATE POLICY notifications_insert ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  );

-- ---------------------------------------------------------------------------
-- 4. file_root_state: le a raiz so se quem chama pode ler o arquivo
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.file_root_state(p_root_id uuid)
RETURNS TABLE (
  root_locked_at timestamptz,
  root_visibility text,
  root_agency_status text,
  root_approval_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT
    root.locked_at,
    root.visibility::text,
    root.agency_approval_status::text,
    root.approval_status::text
  FROM public.files AS root
  WHERE root.id = p_root_id
    AND public.can_read_file(root.id)
$$;

-- ---------------------------------------------------------------------------
-- 5. CRM: nome de empresa unico entre as vivas
-- ---------------------------------------------------------------------------
-- Conferido em 21/09/2026: nenhuma duplicata de lower(btrim(name)) entre as
-- organizacoes com archived_at IS NULL, entao o indice pode nascer.
CREATE UNIQUE INDEX IF NOT EXISTS commercial_organizations_nome_unico
  ON public.commercial_organizations (lower(btrim(name)))
  WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- 6. Desempenho
-- ---------------------------------------------------------------------------
-- tasks_project_ops_node_unique era copia exata de tasks_project_ops_node_uniq.
DROP INDEX IF EXISTS public.tasks_project_ops_node_unique;

CREATE INDEX IF NOT EXISTS updates_created_at_idx ON public.updates (created_at DESC);
CREATE INDEX IF NOT EXISTS updates_project_created_idx ON public.updates (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS projects_client_id_idx ON public.projects (client_id);
CREATE INDEX IF NOT EXISTS tasks_assigned_to_idx ON public.tasks (assigned_to);
CREATE INDEX IF NOT EXISTS files_project_id_idx ON public.files (project_id);
CREATE INDEX IF NOT EXISTS files_uploaded_by_idx ON public.files (uploaded_by);
CREATE INDEX IF NOT EXISTS file_approval_events_actor_id_idx ON public.file_approval_events (actor_id);
CREATE INDEX IF NOT EXISTS client_requests_project_id_idx ON public.client_requests (project_id);
-- editorial_publications(post_id): ja coberto por editorial_publications_post_idx.
-- editorial_posts(project_id): ja coberto por editorial_posts_project_status_idx
-- (project_id, production_status), que tem project_id na frente.
CREATE INDEX IF NOT EXISTS reports_client_created_idx ON public.reports (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS briefings_client_id_idx ON public.briefings (client_id);
CREATE INDEX IF NOT EXISTS task_comments_author_id_idx ON public.task_comments (author_id);
CREATE INDEX IF NOT EXISTS task_attachments_task_id_idx ON public.task_attachments (task_id);
CREATE INDEX IF NOT EXISTS operator_approvals_client_id_idx ON public.operator_approvals (client_id);

-- ---------------------------------------------------------------------------
-- 7. Cron: espalhar os jobs periodicos pelo minuto
-- ---------------------------------------------------------------------------
-- Todos os jobs de */5, */10, */15 e */30 disparavam no minuto 0 junto com
-- os de 1 minuto. Cada um ganha um deslocamento; o comando e o mesmo que ja
-- estava gravado em cron.job. Os jobs de 1 minuto e os diarios nao mudam.
DO $$
DECLARE
  _job record;
  _novo text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN;
  END IF;
  FOR _job IN
    SELECT j.jobname, j.command
      FROM cron.job j
     WHERE j.jobname IN (
       'operator-maintenance-5min', 'ads-metrics', 'social-metrics',
       'cleanup-meta-oauth-secrets', 'editorial-agendamento-atrasado',
       'materiais-classificar-30min'
     )
  LOOP
    _novo := CASE _job.jobname
      WHEN 'operator-maintenance-5min'      THEN '2-59/5 * * * *'
      WHEN 'ads-metrics'                    THEN '3-59/10 * * * *'
      WHEN 'social-metrics'                 THEN '6-59/10 * * * *'
      WHEN 'cleanup-meta-oauth-secrets'     THEN '8-59/10 * * * *'
      WHEN 'editorial-agendamento-atrasado' THEN '4-59/15 * * * *'
      WHEN 'materiais-classificar-30min'    THEN '11,41 * * * *'
    END;
    PERFORM cron.unschedule(_job.jobname);
    PERFORM cron.schedule(_job.jobname, _novo, _job.command);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 8. autopublish_status_secure: barreira de seguranca
-- ---------------------------------------------------------------------------
-- A vista filtra por is_staff/can_access_client; sem security_barrier o
-- planejador podia empurrar uma funcao do usuario para antes do filtro.
ALTER VIEW public.autopublish_status_secure SET (security_barrier = true);
