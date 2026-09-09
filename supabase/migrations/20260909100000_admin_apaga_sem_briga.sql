-- Apagar cliente, pessoa ou documento parava num erro diferente a cada vez
-- ("Failed to clean files_client", "file project must belong to the same
-- client", "is not unique"...). A raiz: 91 vinculos entre tabelas sem regra de
-- exclusao (NO ACTION/RESTRICT) e uma lista manual de limpeza no manage-team
-- que nunca acompanhou as tabelas novas. Cada tabela nova era um erro novo.
--
-- Esta migration resolve na fonte:
--   1. Cada vinculo declara o que acontece quando o perfil some: o que e do
--      cliente vai embora junto (CASCADE), quem apenas agiu fica anonimo
--      (SET NULL), e cadeias internas deixam de travar a cascata.
--   2. Administrador pode apagar qualquer arquivo, inclusive travado ou em
--      revisao. Quem nao e administrador segue com as travas de sempre.
--   3. admin_purge_user(alvo, ator) apaga uma conta numa transacao so, com
--      uma rede de seguranca que varre o catalogo: qualquer tabela nova que
--      aponte para o perfil e tratada automaticamente, sem editar codigo.
--   4. user_purges registra quem apagou quem, quando e o que foi reatribuido,
--      para o historico continuar auditavel.

-- ---------------------------------------------------------------- 1. vinculos
create or replace function public._migr_set_fk_on_delete(
  _schema text, _table text, _column text, _action text
) returns void
language plpgsql
set search_path to ''
as $fn$
declare
  c record;
  _def text;
  _achou boolean := false;
begin
  for c in
    select con.conname, pg_get_constraintdef(con.oid) as def
    from pg_constraint con
    join pg_class t on t.oid = con.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = t.oid and a.attnum = any(con.conkey)
    where con.contype = 'f'
      and n.nspname = _schema and t.relname = _table and a.attname = _column
  loop
    _achou := true;
    _def := regexp_replace(c.def, '\s+ON DELETE (NO ACTION|RESTRICT|CASCADE|SET NULL|SET DEFAULT)', '', 'i');
    execute format('alter table %I.%I drop constraint %I', _schema, _table, c.conname);
    execute format('alter table %I.%I add constraint %I %s on delete %s', _schema, _table, c.conname, _def, _action);
  end loop;
  if not _achou then
    raise exception 'vinculo nao encontrado: %.%.%', _schema, _table, _column;
  end if;
end
$fn$;

-- o que e do cliente vai embora com o cliente; cadeias internas acompanham
select public._migr_set_fk_on_delete('public', 'billing', 'client_id', 'cascade');
select public._migr_set_fk_on_delete('public', 'client_requests', 'client_id', 'cascade');
select public._migr_set_fk_on_delete('public', 'recharge_requests', 'client_id', 'cascade');
select public._migr_set_fk_on_delete('public', 'reports', 'client_id', 'cascade');
select public._migr_set_fk_on_delete('public', 'files', 'client_id', 'cascade');
select public._migr_set_fk_on_delete('public', 'editorial_events', 'client_id', 'cascade');
select public._migr_set_fk_on_delete('public', 'editorial_post_internal', 'client_id', 'cascade');
select public._migr_set_fk_on_delete('public', 'editorial_posts', 'client_id', 'cascade');
select public._migr_set_fk_on_delete('public', 'editorial_publication_internal', 'client_id', 'cascade');
select public._migr_set_fk_on_delete('public', 'external_account_connections', 'client_id', 'cascade');
select public._migr_set_fk_on_delete('public', 'file_approval_events', 'client_id', 'cascade');
select public._migr_set_fk_on_delete('social_private', 'editorial_publication_assets', 'client_id', 'cascade');
select public._migr_set_fk_on_delete('social_private', 'editorial_publication_delivery_requests', 'client_id', 'cascade');
select public._migr_set_fk_on_delete('social_private', 'external_account_grants', 'client_id', 'cascade');
select public._migr_set_fk_on_delete('social_private', 'oauth_grants', 'client_id', 'cascade');
select public._migr_set_fk_on_delete('social_private', 'oauth_resource_candidates', 'client_id', 'cascade');
select public._migr_set_fk_on_delete('social_private', 'oauth_sessions', 'client_id', 'cascade');
select public._migr_set_fk_on_delete('public', 'file_approval_events', 'file_id', 'cascade');
select public._migr_set_fk_on_delete('public', 'files', 'parent_file_id', 'cascade');
select public._migr_set_fk_on_delete('social_private', 'editorial_publication_assets', 'file_id', 'cascade');
select public._migr_set_fk_on_delete('social_private', 'editorial_publication_assets', 'root_file_id', 'cascade');
select public._migr_set_fk_on_delete('public', 'editorial_events', 'post_id', 'cascade');
select public._migr_set_fk_on_delete('public', 'editorial_post_internal', 'post_id', 'cascade');
select public._migr_set_fk_on_delete('public', 'editorial_publications', 'post_id', 'cascade');
select public._migr_set_fk_on_delete('public', 'editorial_publication_internal', 'publication_id', 'cascade');
select public._migr_set_fk_on_delete('social_private', 'editorial_publication_assets', 'publication_id', 'cascade');
select public._migr_set_fk_on_delete('social_private', 'editorial_publication_delivery_requests', 'publication_id', 'cascade');
select public._migr_set_fk_on_delete('public', 'editorial_publications', 'external_account_id', 'cascade');
select public._migr_set_fk_on_delete('public', 'external_account_connections', 'external_account_id', 'cascade');
select public._migr_set_fk_on_delete('social_private', 'external_account_grants', 'external_account_id', 'cascade');
select public._migr_set_fk_on_delete('public', 'editorial_posts', 'project_id', 'cascade');
select public._migr_set_fk_on_delete('social_private', 'oauth_resource_candidates', 'project_id', 'cascade');
select public._migr_set_fk_on_delete('social_private', 'oauth_sessions', 'project_id', 'cascade');
select public._migr_set_fk_on_delete('social_private', 'external_account_grants', 'grant_id', 'cascade');
select public._migr_set_fk_on_delete('social_private', 'oauth_resource_candidates', 'grant_id', 'cascade');
select public._migr_set_fk_on_delete('social_private', 'external_account_grants', 'candidate_id', 'cascade');
select public._migr_set_fk_on_delete('social_private', 'oauth_resource_candidates', 'oauth_session_id', 'cascade');

-- quem fez a acao some, a acao fica registrada sem autor
select public._migr_set_fk_on_delete('public', 'assignment_proposals', 'current_assignee', 'set null');
select public._migr_set_fk_on_delete('public', 'assignment_proposals', 'decided_by', 'set null');
select public._migr_set_fk_on_delete('public', 'editorial_events', 'actor_id', 'set null');
select public._migr_set_fk_on_delete('public', 'editorial_publication_internal', 'published_by', 'set null');
select public._migr_set_fk_on_delete('public', 'editorial_publication_internal', 'scheduled_by', 'set null');
select public._migr_set_fk_on_delete('public', 'external_account_connections', 'connected_by', 'set null');
select public._migr_set_fk_on_delete('public', 'external_account_connections', 'disconnected_by', 'set null');
select public._migr_set_fk_on_delete('public', 'external_accounts', 'created_by', 'set null');
select public._migr_set_fk_on_delete('public', 'file_approval_events', 'actor_id', 'set null');
select public._migr_set_fk_on_delete('public', 'files', 'agency_reviewed_by', 'set null');
select public._migr_set_fk_on_delete('public', 'files', 'client_decided_by', 'set null');
select public._migr_set_fk_on_delete('public', 'financial_tax_rates', 'updated_by', 'set null');
select public._migr_set_fk_on_delete('public', 'operator_approvals', 'decided_by', 'set null');
select public._migr_set_fk_on_delete('public', 'operator_participations', 'author_id', 'set null');
select public._migr_set_fk_on_delete('public', 'project_external_accounts', 'created_by', 'set null');
select public._migr_set_fk_on_delete('public', 'project_payments', 'created_by', 'set null');
select public._migr_set_fk_on_delete('public', 'projects', 'created_by', 'set null');
select public._migr_set_fk_on_delete('public', 'recharge_requests', 'approved_by', 'set null');
select public._migr_set_fk_on_delete('public', 'recharge_requests', 'requested_by', 'set null');
select public._migr_set_fk_on_delete('public', 'reports', 'created_by', 'set null');
select public._migr_set_fk_on_delete('public', 'tasks', 'assigned_to', 'set null');
select public._migr_set_fk_on_delete('social_private', 'ads_oauth_sessions', 'actor_id', 'set null');
select public._migr_set_fk_on_delete('social_private', 'ads_tokens', 'saved_by', 'set null');
select public._migr_set_fk_on_delete('social_private', 'external_account_grants', 'revoked_by', 'set null');
select public._migr_set_fk_on_delete('public', 'editorial_posts', 'primary_file_id', 'set null');
select public._migr_set_fk_on_delete('public', 'editorial_publications', 'file_id', 'set null');
select public._migr_set_fk_on_delete('public', 'editorial_events', 'publication_id', 'set null');

-- RESTRICT derruba a cascata no meio; NO ACTION confere so no fim do comando
select public._migr_set_fk_on_delete('public', 'files', 'revision_of_file_id', 'no action');
select public._migr_set_fk_on_delete('public', 'editorial_post_internal', 'revision_of_post_id', 'no action');

drop function public._migr_set_fk_on_delete(text, text, text, text);

-- ------------------------------------------------ 2. administrador apaga arquivo
-- e a purga passa por todas as guardas. Cada funcao abaixo e a versao da
-- producao com UMA coisa a mais no inicio: se a transacao e uma purga de
-- conta, a guarda deixa passar. files_secure_guard ganha tambem o bypass de
-- administrador no DELETE.
CREATE OR REPLACE FUNCTION app_private.capture_legacy_first_access_token()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _raw_token text;
  _token_hash bytea;
  _expires_at timestamptz;
  _attempts integer;
  _desired_status text;
  _private_status text;
BEGIN
  -- Purga de conta (admin_purge_user): a cascata declarada no banco leva
  -- tudo que era do cliente, e esta guarda nao deve segurar a propria purga.
  IF current_setting('app.purge_in_progress', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF NEW.first_access_token IS NOT NULL
     AND btrim(NEW.first_access_token) <> '' THEN
    _raw_token := btrim(NEW.first_access_token);
    _token_hash := extensions.digest(
      pg_catalog.convert_to(_raw_token, 'UTF8'),
      'sha256'
    );
    _expires_at := COALESCE(
      NEW.first_access_expires_at,
      now() + interval '7 days'
    );
    _attempts := LEAST(
      GREATEST(COALESCE(NEW.first_access_attempts, 0), 0),
      10
    );
    _desired_status := CASE
      WHEN NEW.first_access_used_at IS NOT NULL THEN 'used'
      WHEN _expires_at <= now() OR _attempts >= 10 THEN 'revoked'
      ELSE 'available'
    END;

    IF NEW.first_access_token IS DISTINCT FROM OLD.first_access_token THEN
      IF COALESCE(auth.role(), '') <> 'service_role'
         AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
        RAISE EXCEPTION USING
          ERRCODE = '42501',
          MESSAGE = 'FIRST_ACCESS_TOKEN_ISSUE_FORBIDDEN';
      END IF;

      IF length(_raw_token) < 32 OR length(_raw_token) > 512 THEN
        RAISE EXCEPTION USING
          ERRCODE = '22023',
          MESSAGE = 'FIRST_ACCESS_TOKEN_INVALID';
      END IF;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.profiles AS duplicate_profile
      WHERE duplicate_profile.id <> NEW.id
        AND duplicate_profile.first_access_token IS NOT NULL
        AND btrim(duplicate_profile.first_access_token) = _raw_token
    ) THEN
      UPDATE app_private.first_access_tokens AS token_state
      SET
        status = CASE
          WHEN token_state.status = 'used' THEN 'used'
          ELSE 'revoked'
        END,
        claim_id = CASE
          WHEN token_state.status = 'used' THEN token_state.claim_id
          ELSE NULL
        END,
        claimed_at = CASE
          WHEN token_state.status = 'used' THEN token_state.claimed_at
          ELSE NULL
        END,
        updated_at = now()
      WHERE token_state.profile_id = NEW.id
         OR token_state.token_hash = _token_hash;

      RETURN NEW;
    END IF;

    IF NEW.first_access_token IS DISTINCT FROM OLD.first_access_token THEN
      BEGIN
        INSERT INTO app_private.first_access_tokens (
          profile_id,
          token_hash,
          status,
          expires_at,
          attempts,
          last_attempt_at,
          claim_id,
          claimed_at,
          used_at,
          issued_by,
          created_at,
          updated_at
        ) VALUES (
          NEW.id,
          _token_hash,
          _desired_status,
          _expires_at,
          _attempts,
          NEW.first_access_last_attempt_at,
          NULL,
          NULL,
          NEW.first_access_used_at,
          auth.uid(),
          now(),
          now()
        )
        ON CONFLICT (profile_id) DO UPDATE SET
          token_hash = EXCLUDED.token_hash,
          status = EXCLUDED.status,
          expires_at = EXCLUDED.expires_at,
          attempts = EXCLUDED.attempts,
          last_attempt_at = EXCLUDED.last_attempt_at,
          claim_id = NULL,
          claimed_at = NULL,
          used_at = EXCLUDED.used_at,
          issued_by = EXCLUDED.issued_by,
          created_at = now(),
          updated_at = now();
      EXCEPTION
        WHEN unique_violation THEN
          UPDATE app_private.first_access_tokens AS token_state
          SET
            status = CASE
              WHEN token_state.status = 'used' THEN 'used'
              ELSE 'revoked'
            END,
            claim_id = CASE
              WHEN token_state.status = 'used' THEN token_state.claim_id
              ELSE NULL
            END,
            claimed_at = CASE
              WHEN token_state.status = 'used' THEN token_state.claimed_at
              ELSE NULL
            END,
            updated_at = now()
          WHERE token_state.profile_id = NEW.id
             OR token_state.token_hash = _token_hash;
      END;

      RETURN NEW;
    END IF;

    SELECT token_state.status
    INTO _private_status
    FROM app_private.first_access_tokens AS token_state
    WHERE token_state.profile_id = NEW.id
    FOR UPDATE;

    IF NOT FOUND THEN
      BEGIN
        INSERT INTO app_private.first_access_tokens (
          profile_id,
          token_hash,
          status,
          expires_at,
          attempts,
          last_attempt_at,
          used_at,
          issued_by
        ) VALUES (
          NEW.id,
          _token_hash,
          _desired_status,
          _expires_at,
          _attempts,
          NEW.first_access_last_attempt_at,
          NEW.first_access_used_at,
          auth.uid()
        );
      EXCEPTION
        WHEN unique_violation THEN
          NULL;
      END;
      RETURN NEW;
    END IF;

    IF _desired_status = 'available'
       AND _private_status <> 'available' THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'FIRST_ACCESS_TOKEN_NOT_AVAILABLE';
    END IF;

    UPDATE app_private.first_access_tokens AS token_state
    SET
      status = _desired_status,
      expires_at = _expires_at,
      attempts = GREATEST(token_state.attempts, _attempts),
      last_attempt_at = GREATEST(
        token_state.last_attempt_at,
        NEW.first_access_last_attempt_at
      ),
      claim_id = NULL,
      claimed_at = NULL,
      used_at = NEW.first_access_used_at,
      updated_at = now()
    WHERE token_state.profile_id = NEW.id;

    RETURN NEW;
  END IF;

  IF OLD.first_access_token IS NOT NULL
     AND btrim(OLD.first_access_token) <> '' THEN
    _raw_token := btrim(OLD.first_access_token);
    _attempts := LEAST(
      GREATEST(COALESCE(NEW.first_access_attempts, 0), 0),
      10
    );
    _desired_status := CASE
      WHEN NEW.first_access_used_at IS NOT NULL THEN 'used'
      ELSE 'revoked'
    END;

    SELECT token_state.status
    INTO _private_status
    FROM app_private.first_access_tokens AS token_state
    WHERE token_state.profile_id = NEW.id
    FOR UPDATE;

    IF FOUND AND _private_status = 'claimed' THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'FIRST_ACCESS_TOKEN_CLAIMED';
    END IF;

    BEGIN
      INSERT INTO app_private.first_access_tokens AS current_token (
        profile_id,
        token_hash,
        status,
        expires_at,
        attempts,
        last_attempt_at,
        claim_id,
        claimed_at,
        used_at,
        issued_by,
        created_at,
        updated_at
      ) VALUES (
        NEW.id,
        extensions.digest(pg_catalog.convert_to(_raw_token, 'UTF8'), 'sha256'),
        _desired_status,
        COALESCE(
          NEW.first_access_expires_at,
          OLD.first_access_expires_at,
          now()
        ),
        _attempts,
        NEW.first_access_last_attempt_at,
        NULL,
        NULL,
        NEW.first_access_used_at,
        auth.uid(),
        now(),
        now()
      )
      ON CONFLICT (profile_id) DO UPDATE SET
        status = EXCLUDED.status,
        expires_at = EXCLUDED.expires_at,
        attempts = GREATEST(current_token.attempts, EXCLUDED.attempts),
        last_attempt_at = GREATEST(
          current_token.last_attempt_at,
          EXCLUDED.last_attempt_at
        ),
        claim_id = CASE
          WHEN current_token.status = 'used'
               AND EXCLUDED.status = 'used'
            THEN current_token.claim_id
          ELSE NULL
        END,
        claimed_at = CASE
          WHEN current_token.status = 'used'
               AND EXCLUDED.status = 'used'
            THEN current_token.claimed_at
          ELSE NULL
        END,
        used_at = EXCLUDED.used_at,
        updated_at = now();
    EXCEPTION
      WHEN unique_violation THEN
        NULL;
    END;
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION app_private.financial_entry_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Purga de conta (admin_purge_user): a cascata declarada no banco leva
  -- tudo que era do cliente, e esta guarda nao deve segurar a propria purga.
  IF current_setting('app.purge_in_progress', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'financial entries are append-only; use an audited cancellation'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status NOT IN ('draft', 'open')
     OR NEW.status <> 'cancelled'
     OR NEW.cancelled_at IS NULL
     OR NEW.cancelled_by IS NULL
     OR NEW.cancelled_by IS DISTINCT FROM auth.uid()
     OR NULLIF(btrim(NEW.cancellation_reason), '') IS NULL
     OR (to_jsonb(NEW) - ARRAY[
       'status', 'cancelled_at', 'cancelled_by', 'cancellation_reason', 'updated_at'
     ]) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY[
       'status', 'cancelled_at', 'cancelled_by', 'cancellation_reason', 'updated_at'
     ]) THEN
    RAISE EXCEPTION 'financial entries are append-only; only audited cancellation is allowed'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.financial_plan_version_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Purga de conta (admin_purge_user): a cascata declarada no banco leva
  -- tudo que era do cliente, e esta guarda nao deve segurar a propria purga.
  IF current_setting('app.purge_in_progress', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'plan versions are immutable and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF (to_jsonb(NEW) - ARRAY['valid_to', 'is_active', 'updated_at'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['valid_to', 'is_active', 'updated_at']) THEN
    RAISE EXCEPTION 'plan versions are immutable; create a new version'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.financial_settlement_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Purga de conta (admin_purge_user): a cascata declarada no banco leva
  -- tudo que era do cliente, e esta guarda nao deve segurar a propria purga.
  IF current_setting('app.purge_in_progress', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'financial settlements are append-only; use a reversal'
    USING ERRCODE = '55000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.client_requests_secure_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  -- Purga de conta (admin_purge_user): a cascata declarada no banco leva
  -- tudo que era do cliente, e esta guarda nao deve segurar a propria purga.
  IF current_setting('app.purge_in_progress', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF NEW.project_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.projects AS project
      WHERE project.id = NEW.project_id
        AND project.client_id = NEW.client_id
    ) THEN
    RAISE EXCEPTION 'request project must belong to the same client';
  END IF;
  IF auth.role() = 'authenticated' THEN
    IF TG_OP = 'INSERT' AND NEW.ai_draft IS NOT NULL THEN
      RAISE EXCEPTION 'internal request draft is backend-only';
    END IF;
    IF TG_OP = 'UPDATE'
      AND NEW.ai_draft IS DISTINCT FROM OLD.ai_draft THEN
      RAISE EXCEPTION 'internal request draft is backend-only';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.contracts_secure_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  _actor uuid := auth.uid();
  _service_write boolean := auth.role() = 'service_role';
  _trusted_write boolean :=
    current_user NOT IN ('anon', 'authenticated', 'service_role', 'authenticator');
BEGIN
  -- Purga de conta (admin_purge_user): a cascata declarada no banco leva
  -- tudo que era do cliente, e esta guarda nao deve segurar a propria purga.
  IF current_setting('app.purge_in_progress', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft'
      OR OLD.admin_signed_at IS NOT NULL
      OR OLD.sent_at IS NOT NULL
      OR OLD.client_signed_at IS NOT NULL
      OR OLD.file_id IS NOT NULL THEN
      RAISE EXCEPTION 'sent and signed contracts are immutable';
    END IF;
    IF _service_write THEN
      RETURN OLD;
    END IF;
    IF _actor IS NULL
      OR NOT public.can_manage_client(OLD.client_id) THEN
      RAISE EXCEPTION 'contract deletion access denied';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.project_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.projects AS project
      WHERE project.id = NEW.project_id
        AND project.client_id = NEW.client_id
  ) THEN
    RAISE EXCEPTION 'contract project must belong to the same client';
  END IF;
  IF public.files_reference_path(NEW.original_file_url) IS NOT NULL
    AND NOT public.file_storage_matches_client(
      'files',
      public.files_reference_path(NEW.original_file_url),
      NEW.client_id
    ) THEN
    RAISE EXCEPTION 'contract file must belong to the same client';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft'
      OR NEW.admin_signature_name IS NOT NULL
      OR NEW.admin_signed_at IS NOT NULL
      OR NEW.admin_signature_ip IS NOT NULL
      OR NEW.client_signature_name IS NOT NULL
      OR NEW.client_signed_at IS NOT NULL
      OR NEW.client_signature_ip IS NOT NULL
      OR NEW.sent_at IS NOT NULL
      OR NEW.file_id IS NOT NULL THEN
      RAISE EXCEPTION 'new contracts must start as an unsigned draft';
    END IF;
    IF NOT _service_write AND (
      _actor IS NULL
      OR NOT public.can_manage_client(NEW.client_id)
      OR NEW.created_by IS DISTINCT FROM _actor
    ) THEN
      RAISE EXCEPTION 'contract creation access denied';
    END IF;
    RETURN NEW;
  END IF;

  IF _trusted_write THEN
    RETURN NEW;
  END IF;

  IF _service_write THEN
    IF OLD.status = 'sent' THEN
      IF NEW.status <> 'sent'
        OR (
          to_jsonb(NEW) - 'sent_at' - 'updated_at'
        ) IS DISTINCT FROM (
          to_jsonb(OLD) - 'sent_at' - 'updated_at'
        ) THEN
        RAISE EXCEPTION 'sent and signed contracts are immutable';
      END IF;
      RETURN NEW;
    END IF;
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'sent and signed contracts are immutable';
    END IF;
    IF NEW.client_id IS DISTINCT FROM OLD.client_id
      OR NEW.client_signature_name IS DISTINCT FROM OLD.client_signature_name
      OR NEW.client_signed_at IS DISTINCT FROM OLD.client_signed_at
      OR NEW.client_signature_ip IS DISTINCT FROM OLD.client_signature_ip
      OR NEW.sign_token IS DISTINCT FROM OLD.sign_token
      OR NEW.file_id IS DISTINCT FROM OLD.file_id
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'protected contract fields are immutable';
    END IF;
    IF NEW.status NOT IN ('draft', 'sent', 'cancelled') THEN
      RAISE EXCEPTION 'invalid service contract transition';
    END IF;
    IF NEW.status = 'sent'
      AND (
        NULLIF(btrim(NEW.admin_signature_name), '') IS NULL
        OR NEW.admin_signed_at IS NULL
      ) THEN
      RAISE EXCEPTION 'agency signature is required before sending';
    END IF;
    RETURN NEW;
  END IF;

  IF _actor IS NULL
    OR NOT public.can_manage_client(OLD.client_id)
    OR NOT public.can_manage_client(NEW.client_id) THEN
    RAISE EXCEPTION 'contract update access denied';
  END IF;
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'sent and signed contracts are immutable';
  END IF;
  IF NEW.client_id IS DISTINCT FROM OLD.client_id
    OR NEW.original_file_url IS DISTINCT FROM OLD.original_file_url
    OR NEW.original_file_name IS DISTINCT FROM OLD.original_file_name
    OR NEW.client_signature_name IS DISTINCT FROM OLD.client_signature_name
    OR NEW.client_signed_at IS DISTINCT FROM OLD.client_signed_at
    OR NEW.client_signature_ip IS DISTINCT FROM OLD.client_signature_ip
    OR NEW.sign_token IS DISTINCT FROM OLD.sign_token
    OR NEW.file_id IS DISTINCT FROM OLD.file_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'protected contract fields are immutable';
  END IF;
  IF NEW.status NOT IN ('draft', 'sent') THEN
    RAISE EXCEPTION 'invalid authenticated contract transition';
  END IF;
  IF NEW.status = 'sent'
    AND (
      NULLIF(btrim(NEW.admin_signature_name), '') IS NULL
      OR NEW.admin_signed_at IS NULL
    ) THEN
    RAISE EXCEPTION 'agency signature is required before sending';
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.editorial_events_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  -- Purga de conta (admin_purge_user): a cascata declarada no banco leva
  -- tudo que era do cliente, e esta guarda nao deve segurar a propria purga.
  IF current_setting('app.purge_in_progress', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'editorial history is append-only';
END
$function$;

CREATE OR REPLACE FUNCTION public.editorial_post_delivery_type_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _aligned_delivery_type text;
  _task_delivery_type text;
  _task_id uuid;
BEGIN
  -- Purga de conta (admin_purge_user): a cascata declarada no banco leva
  -- tudo que era do cliente, e esta guarda nao deve segurar a propria purga.
  IF current_setting('app.purge_in_progress', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF NEW.content_type IS NOT DISTINCT FROM OLD.content_type THEN
    RETURN NEW;
  END IF;

  PERFORM public.editorial_lock_task_sync();

  SELECT task.id, task.delivery_type
  INTO _task_id, _task_delivery_type
  FROM public.editorial_post_internal AS internal
  JOIN public.tasks AS task ON task.id = internal.task_id
  WHERE internal.post_id = NEW.id
    AND task.deleted_at IS NULL
  FOR UPDATE OF task;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  _aligned_delivery_type :=
    public.editorial_delivery_type_for_content_type(NEW.content_type);

  IF _task_delivery_type = 'unspecified' THEN
    IF _aligned_delivery_type IS NOT NULL THEN
      UPDATE public.tasks
      SET delivery_type = _aligned_delivery_type
      WHERE id = _task_id
        AND delivery_type = 'unspecified';
    END IF;
  ELSIF NOT public.editorial_delivery_type_is_publishable(
    _task_delivery_type
  ) OR public.editorial_content_type_for_delivery_type(
    _task_delivery_type
  ) IS DISTINCT FROM NEW.content_type THEN
    RAISE EXCEPTION
      'O formato editorial não corresponde ao tipo da tarefa vinculada.';
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.editorial_post_internal_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _post public.editorial_posts%ROWTYPE;
BEGIN
  -- Purga de conta (admin_purge_user): a cascata declarada no banco leva
  -- tudo que era do cliente, e esta guarda nao deve segurar a propria purga.
  IF current_setting('app.purge_in_progress', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'editorial internal records are never deleted';
  END IF;

  SELECT * INTO _post
  FROM public.editorial_posts
  WHERE id = NEW.post_id;
  IF NOT FOUND OR _post.client_id IS DISTINCT FROM NEW.client_id THEN
    RAISE EXCEPTION 'editorial internal record must match the post client';
  END IF;

  IF TG_OP = 'INSERT'
    OR (
      TG_OP = 'UPDATE'
      AND NEW.task_id IS DISTINCT FROM OLD.task_id
    ) THEN
    IF NEW.task_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.tasks AS task
        WHERE task.id = NEW.task_id
          AND task.project_id = _post.project_id
          AND task.deleted_at IS NULL
      ) THEN
      RAISE EXCEPTION 'editorial task must belong to the same active project';
    END IF;
  END IF;

  IF TG_OP = 'INSERT'
    OR (
      TG_OP = 'UPDATE'
      AND NEW.responsible_id IS DISTINCT FROM OLD.responsible_id
    ) THEN
    IF NEW.responsible_id IS NOT NULL
      AND NOT (
        public.has_role(NEW.responsible_id, 'admin'::public.app_role)
        OR (
          (
            public.has_role(NEW.responsible_id, 'manager'::public.app_role)
            OR public.has_role(NEW.responsible_id, 'design'::public.app_role)
            OR public.has_role(NEW.responsible_id, 'traffic'::public.app_role)
          )
          AND EXISTS (
            SELECT 1
            FROM public.team_client_assignments AS assignment
            WHERE assignment.user_id = NEW.responsible_id
              AND assignment.client_id = NEW.client_id
          )
        )
      ) THEN
      RAISE EXCEPTION 'editorial responsible must be assigned to the client';
    END IF;
  END IF;

  IF NEW.revision_of_post_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.editorial_posts AS source_post
      WHERE source_post.id = NEW.revision_of_post_id
        AND source_post.client_id = NEW.client_id
        AND source_post.project_id = _post.project_id
    ) THEN
    RAISE EXCEPTION 'editorial revision must stay in the same client and project';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.post_id IS DISTINCT FROM OLD.post_id
      OR NEW.client_id IS DISTINCT FROM OLD.client_id
      OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
      OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.revision_of_post_id IS DISTINCT FROM OLD.revision_of_post_id THEN
      RAISE EXCEPTION 'editorial internal identity fields are immutable';
    END IF;
    NEW.updated_at := now();
  ELSE
    NEW.created_at := COALESCE(NEW.created_at, now());
    NEW.updated_at := NEW.created_at;
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.editorial_posts_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _file public.files%ROWTYPE;
BEGIN
  -- Purga de conta (admin_purge_user): a cascata declarada no banco leva
  -- tudo que era do cliente, e esta guarda nao deve segurar a propria purga.
  IF current_setting('app.purge_in_progress', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'editorial posts are archived, never deleted';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.client_id IS DISTINCT FROM OLD.client_id
      OR NEW.project_id IS DISTINCT FROM OLD.project_id
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'editorial post identity and scope are immutable';
    END IF;
    IF OLD.production_status = 'archived' THEN
      RAISE EXCEPTION 'archived editorial posts are immutable';
    END IF;
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
  ELSE
    NEW.version := 1;
    NEW.created_at := COALESCE(NEW.created_at, now());
    NEW.updated_at := NEW.created_at;
  END IF;

  IF NEW.primary_file_id IS NOT NULL THEN
    SELECT * INTO _file
    FROM public.files
    WHERE id = NEW.primary_file_id
      AND parent_file_id IS NULL;

    IF NOT FOUND
      OR _file.client_id IS DISTINCT FROM NEW.client_id
      OR _file.project_id IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'editorial primary file must be a root file from the same client and project';
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.editorial_prevent_premature_task_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _post_id uuid;
  _canonical_task_status text;
  _current_post_status text;
  _target_post_status text;
BEGIN
  -- Purga de conta (admin_purge_user): a cascata declarada no banco leva
  -- tudo que era do cliente, e esta guarda nao deve segurar a propria purga.
  IF current_setting('app.purge_in_progress', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status
    OR left(COALESCE(NEW.source, ''), 15) = 'client_request:' THEN
    RETURN NEW;
  END IF;

  _post_id := public.editorial_current_post_id_for_task(NEW.id);
  IF _post_id IS NULL THEN
    RETURN NEW;
  END IF;

  _canonical_task_status :=
    public.editorial_task_status_for_post(_post_id);

  IF NEW.status = 'done'
    AND _canonical_task_status IS DISTINCT FROM 'done' THEN
    RAISE EXCEPTION
      'O conteúdo vinculado precisa estar publicado antes de concluir a tarefa.';
  END IF;

  IF _canonical_task_status = 'done' AND NEW.status <> 'done' THEN
    RAISE EXCEPTION
      'Uma tarefa editorial publicada não pode voltar de etapa pelo Kanban.';
  END IF;

  _target_post_status :=
    public.editorial_production_status_for_task(NEW.status);
  IF _target_post_status IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT post.production_status
  INTO _current_post_status
  FROM public.editorial_posts AS post
  WHERE post.id = _post_id;

  IF _current_post_status IS DISTINCT FROM _target_post_status
    AND EXISTS (
      SELECT 1
      FROM public.editorial_publications AS publication
      WHERE publication.post_id = _post_id
        AND publication.status NOT IN ('planned', 'cancelled')
    ) THEN
    RAISE EXCEPTION
      'Publicações agendadas ou finalizadas não podem voltar de etapa pelo Kanban.';
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.editorial_publication_internal_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Purga de conta (admin_purge_user): a cascata declarada no banco leva
  -- tudo que era do cliente, e esta guarda nao deve segurar a propria purga.
  IF current_setting('app.purge_in_progress', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'editorial publication internals are never deleted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.editorial_publications AS publication
    WHERE publication.id = NEW.publication_id
      AND publication.client_id = NEW.client_id
  ) THEN
    RAISE EXCEPTION 'editorial publication internal scope mismatch';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.publication_id IS DISTINCT FROM OLD.publication_id
      OR NEW.client_id IS DISTINCT FROM OLD.client_id
      OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
      OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'editorial publication internal identity is immutable';
    END IF;
    NEW.updated_at := now();
  ELSE
    NEW.created_at := COALESCE(NEW.created_at, now());
    NEW.updated_at := NEW.created_at;
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.editorial_publications_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _account public.external_accounts%ROWTYPE;
  _file public.files%ROWTYPE;
BEGIN
  -- Purga de conta (admin_purge_user): a cascata declarada no banco leva
  -- tudo que era do cliente, e esta guarda nao deve segurar a propria purga.
  IF current_setting('app.purge_in_progress', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'editorial publications are cancelled, never deleted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.editorial_posts AS post
    WHERE post.id = NEW.post_id
      AND post.client_id = NEW.client_id
      AND post.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'editorial publication must match its post scope';
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.status IN ('failed', 'cancelled') THEN
    IF NEW.external_account_id IS DISTINCT FROM OLD.external_account_id
      OR NEW.platform IS DISTINCT FROM OLD.platform THEN
      RAISE EXCEPTION 'cleanup transitions cannot change the editorial account';
    END IF;
    -- Uma conta pode ser desativada ou desvinculada depois do agendamento.
    -- Isso nunca impede registrar falha, cancelar ou arquivar o plano.
    NEW.platform := OLD.platform;
  ELSE
    SELECT * INTO _account
    FROM public.external_accounts
    WHERE id = NEW.external_account_id
      AND client_id = NEW.client_id;
    IF NOT FOUND
      OR _account.status <> 'active'
      OR _account.platform NOT IN (
        'instagram',
        'facebook',
        'tiktok',
        'linkedin',
        'youtube',
        'google_business'
      ) THEN
      RAISE EXCEPTION 'editorial publication requires an active publishable account';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.project_external_accounts AS link
      WHERE link.project_id = NEW.project_id
        AND link.external_account_id = NEW.external_account_id
        AND link.client_id = NEW.client_id
    ) THEN
      RAISE EXCEPTION 'editorial account must be linked to the project';
    END IF;
    NEW.platform := _account.platform;
  END IF;

  IF NEW.file_id IS NOT NULL THEN
    SELECT * INTO _file
    FROM public.files
    WHERE id = NEW.file_id
      AND parent_file_id IS NULL;
    IF NOT FOUND
      OR _file.client_id IS DISTINCT FROM NEW.client_id
      OR _file.project_id IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'editorial publication file must match the client and project';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_timezone_names
    WHERE name = NEW.scheduled_timezone
  ) THEN
    RAISE EXCEPTION 'invalid editorial timezone';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.post_id IS DISTINCT FROM OLD.post_id
      OR NEW.client_id IS DISTINCT FROM OLD.client_id
      OR NEW.project_id IS DISTINCT FROM OLD.project_id
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'editorial publication identity and scope are immutable';
    END IF;
    IF OLD.status = 'published' THEN
      RAISE EXCEPTION 'published editorial records are immutable';
    END IF;
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
  ELSE
    NEW.version := 1;
    NEW.created_at := COALESCE(NEW.created_at, now());
    NEW.updated_at := NEW.created_at;
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.editorial_record_published_receipt()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _publication public.editorial_publications%ROWTYPE;
  _post public.editorial_posts%ROWTYPE;
  _task_id uuid;
  _task_assignee uuid;
  _task_project uuid;
  _comment text;
  _link text;
  _cliente uuid;
  _onde text;
  _titulo text;
BEGIN
  -- Purga de conta (admin_purge_user): a cascata declarada no banco leva
  -- tudo que era do cliente, e esta guarda nao deve segurar a propria purga.
  IF current_setting('app.purge_in_progress', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF NEW.published_by IS NULL
    OR NEW.published_by IS NOT DISTINCT FROM OLD.published_by THEN
    RETURN NEW;
  END IF;

  SELECT * INTO _publication
  FROM public.editorial_publications AS publication
  WHERE publication.id = NEW.publication_id
    AND publication.client_id = NEW.client_id
    AND publication.status = 'published'
    AND publication.permalink IS NOT NULL
    AND btrim(publication.permalink) ~* '^https?://[^[:space:]]+$';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'published receipt requires a confirmed public permalink';
  END IF;

  SELECT post.* INTO _post
  FROM public.editorial_posts AS post
  WHERE post.id = _publication.post_id
    AND post.client_id = _publication.client_id
    AND post.project_id = _publication.project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'published receipt post scope mismatch';
  END IF;

  SELECT internal.task_id
  INTO _task_id
  FROM public.editorial_post_internal AS internal
  WHERE internal.post_id = _post.id
    AND internal.client_id = _post.client_id;

  IF _task_id IS NOT NULL THEN
    SELECT task.assigned_to, task.project_id
    INTO _task_assignee, _task_project
    FROM public.tasks AS task
    WHERE task.id = _task_id
      AND task.deleted_at IS NULL;

    IF FOUND THEN
      IF _task_project IS DISTINCT FROM _post.project_id THEN
        RAISE EXCEPTION 'published receipt task scope mismatch';
      END IF;

      _comment := format(
        'Publicado em %s: %s',
        _publication.platform,
        btrim(_publication.permalink)
      );

      INSERT INTO public.task_comments (
        task_id,
        author_id,
        content
      ) VALUES (
        _task_id,
        NEW.published_by,
        _comment
      );
    ELSE
      _task_assignee := NULL;
    END IF;
  END IF;

  _link := btrim(_publication.permalink);
  _onde := initcap(_publication.platform);
  _titulo := NULLIF(btrim(regexp_replace(
    COALESCE(_post.title, ''),
    '[.](png|jpe?g|jpe|webp|gif|heic|heif|mp4|mov|m4v|webm)$',
    '', 'i')), '');
  _titulo := COALESCE(_titulo, _post.title, 'conteudo');

  INSERT INTO public.notifications (
    user_id,
    message,
    notification_type,
    link
  )
  SELECT DISTINCT
    recipient.user_id,
    format(
      'Conteúdo publicado no %s: %s',
      _onde,
      _titulo
    ),
    'publication',
    _link
  FROM (
    SELECT _task_assignee AS user_id
    WHERE _task_assignee IS NOT NULL

    UNION

    SELECT role_row.user_id
    FROM public.user_roles AS role_row
    WHERE role_row.role = 'admin'::public.app_role

    UNION

    SELECT assignment.user_id
    FROM public.team_client_assignments AS assignment
    WHERE assignment.client_id = _publication.client_id
  ) AS recipient
  JOIN public.profiles AS profile
    ON profile.id = recipient.user_id
  WHERE recipient.user_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.user_roles AS role_row
      WHERE role_row.user_id = recipient.user_id
        AND role_row.role IN (
          'admin'::public.app_role,
          'manager'::public.app_role,
          'design'::public.app_role,
          'traffic'::public.app_role
        )
    );

  _cliente := _publication.client_id;
  IF _cliente IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_roles AS role_row
    WHERE role_row.user_id = _cliente
      AND role_row.role = 'client'::public.app_role
  ) THEN
    INSERT INTO public.notifications (
      user_id, message, notification_type, link
    ) VALUES (
      _cliente,
      format('Seu conteúdo já está no ar no %s: %s', _onde, _titulo),
      'publication',
      _link
    );
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.editorial_sync_post_from_task_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _post_id uuid;
  _client_id uuid;
  _from_status text;
  _to_status text;
  _post_version integer;
BEGIN
  -- Purga de conta (admin_purge_user): a cascata declarada no banco leva
  -- tudo que era do cliente, e esta guarda nao deve segurar a propria purga.
  IF current_setting('app.purge_in_progress', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status
    OR left(COALESCE(NEW.source, ''), 15) = 'client_request:' THEN
    RETURN NEW;
  END IF;

  _to_status := public.editorial_production_status_for_task(NEW.status);
  IF _to_status IS NULL THEN
    RETURN NEW;
  END IF;

  _post_id := public.editorial_current_post_id_for_task(NEW.id);
  IF _post_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT post.client_id, post.production_status
  INTO _client_id, _from_status
  FROM public.editorial_posts AS post
  WHERE post.id = _post_id
  FOR UPDATE;

  IF NOT FOUND OR _from_status IS NOT DISTINCT FROM _to_status THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.editorial_publications AS publication
    WHERE publication.post_id = _post_id
      AND publication.status NOT IN ('planned', 'cancelled')
  ) THEN
    RAISE EXCEPTION
      'Publicações agendadas ou finalizadas não podem voltar de etapa pelo Kanban.';
  END IF;

  IF _to_status <> 'ready' AND EXISTS (
    SELECT 1
    FROM public.editorial_publications AS publication
    JOIN public.editorial_posts AS post ON post.id = publication.post_id
    WHERE publication.post_id = _post_id
      AND publication.status = 'planned'
      AND publication.scheduled_at IS NOT NULL
      AND COALESCE(public.editorial_file_is_publishable(
            COALESCE(publication.file_id, post.primary_file_id),
            publication.client_id, publication.project_id), false)
  ) THEN
    RAISE EXCEPTION
      'Esta arte já está aprovada e tem publicação marcada. Mover o card para trás cancelaria o post sem avisar ninguém: cancele ou reagende a publicação na Agenda primeiro.';
  END IF;

  UPDATE public.editorial_posts
  SET production_status = _to_status
  WHERE id = _post_id
  RETURNING version INTO _post_version;

  INSERT INTO public.editorial_events (
    client_id, post_id, actor_id, event_type, from_status, to_status, metadata
  ) VALUES (
    _client_id, _post_id, auth.uid(),
    'production_status_synced_from_task', _from_status, _to_status,
    jsonb_build_object(
      'source', 'kanban', 'task_id', NEW.id,
      'task_status_before', OLD.status, 'task_status_after', NEW.status,
      'post_version', _post_version
    )
  );

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.editorial_task_delivery_type_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _post_id uuid;
  _content_type text;
  _expected_content_type text;
BEGIN
  -- Purga de conta (admin_purge_user): a cascata declarada no banco leva
  -- tudo que era do cliente, e esta guarda nao deve segurar a propria purga.
  IF current_setting('app.purge_in_progress', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF NEW.delivery_type IS NOT DISTINCT FROM OLD.delivery_type THEN
    RETURN NEW;
  END IF;

  PERFORM public.editorial_lock_task_sync();
  _post_id := public.editorial_current_post_id_for_task(NEW.id);
  IF _post_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT post.content_type
  INTO _content_type
  FROM public.editorial_posts AS post
  WHERE post.id = _post_id;

  IF NEW.delivery_type = 'unspecified'
    OR NOT public.editorial_delivery_type_is_publishable(NEW.delivery_type) THEN
    RAISE EXCEPTION
      'Uma tarefa com conteúdo editorial ativo precisa manter um tipo publicável.';
  END IF;

  _expected_content_type :=
    public.editorial_content_type_for_delivery_type(NEW.delivery_type);
  IF _expected_content_type IS DISTINCT FROM _content_type THEN
    RAISE EXCEPTION
      'O tipo da tarefa não corresponde ao formato do conteúdo editorial ativo.';
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.editorial_task_link_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _aligned_delivery_type text;
  _current_post_id uuid;
  _post_content_type text;
  _source text;
  _source_task_id uuid;
  _task_delivery_type text;
BEGIN
  -- Purga de conta (admin_purge_user): a cascata declarada no banco leva
  -- tudo que era do cliente, e esta guarda nao deve segurar a propria purga.
  IF current_setting('app.purge_in_progress', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE'
    AND NEW.task_id IS NOT DISTINCT FROM OLD.task_id
    AND NEW.revision_of_post_id
      IS NOT DISTINCT FROM OLD.revision_of_post_id THEN
    RETURN NEW;
  END IF;

  PERFORM public.editorial_lock_task_sync();

  SELECT post.content_type
  INTO _post_content_type
  FROM public.editorial_posts AS post
  WHERE post.id = NEW.post_id;

  IF NEW.task_id IS NOT NULL THEN
    SELECT task.source, task.delivery_type
    INTO _source, _task_delivery_type
    FROM public.tasks AS task
    WHERE task.id = NEW.task_id
      AND task.deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'A tarefa editorial não existe ou foi excluída.';
    END IF;

    IF left(COALESCE(_source, ''), 15) = 'client_request:' THEN
      RAISE EXCEPTION
        'Tarefas originadas de pedidos não podem ser vinculadas ao editorial.';
    END IF;

    _aligned_delivery_type :=
      public.editorial_delivery_type_for_content_type(_post_content_type);

    IF _task_delivery_type = 'unspecified' THEN
      IF _aligned_delivery_type IS NOT NULL THEN
        UPDATE public.tasks
        SET delivery_type = _aligned_delivery_type
        WHERE id = NEW.task_id
          AND delivery_type = 'unspecified';
      END IF;
    ELSIF NOT public.editorial_delivery_type_is_publishable(
      _task_delivery_type
    ) THEN
      RAISE EXCEPTION
        'Somente tarefas com tipo publicável podem ser vinculadas ao editorial.';
    ELSIF public.editorial_content_type_for_delivery_type(
      _task_delivery_type
    ) IS DISTINCT FROM _post_content_type THEN
      RAISE EXCEPTION
        'O tipo da tarefa não corresponde ao formato do conteúdo editorial.';
    END IF;
  END IF;

  IF NEW.revision_of_post_id IS NOT NULL THEN
    SELECT source_internal.task_id
    INTO _source_task_id
    FROM public.editorial_post_internal AS source_internal
    WHERE source_internal.post_id = NEW.revision_of_post_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'A revisão de origem não possui estado editorial interno.';
    END IF;

    IF NEW.task_id IS DISTINCT FROM _source_task_id THEN
      RAISE EXCEPTION
        'A revisão editorial precisa manter a tarefa de origem.';
    END IF;

    IF _source_task_id IS NOT NULL
      AND public.editorial_current_post_id_for_task(_source_task_id)
        IS DISTINCT FROM NEW.revision_of_post_id THEN
      RAISE EXCEPTION
        'A revisão de origem não é mais a revisão atual.';
    END IF;
  ELSIF NEW.task_id IS NOT NULL THEN
    _current_post_id :=
      public.editorial_current_post_id_for_task(NEW.task_id);

    IF _current_post_id IS NOT NULL
      AND _current_post_id IS DISTINCT FROM NEW.post_id THEN
      RAISE EXCEPTION
        'A tarefa já possui um conteúdo editorial ativo.';
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.external_accounts_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Purga de conta (admin_purge_user): a cascata declarada no banco leva
  -- tudo que era do cliente, e esta guarda nao deve segurar a propria purga.
  IF current_setting('app.purge_in_progress', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.created_at := COALESCE(NEW.created_at, now());
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'id is immutable on external_accounts';
    END IF;
    IF NEW.client_id IS DISTINCT FROM OLD.client_id THEN
      RAISE EXCEPTION 'client_id is immutable on external_accounts';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'created_at is immutable on external_accounts';
    END IF;
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'created_by is immutable on external_accounts';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.external_account_connections AS connection
      WHERE connection.external_account_id = OLD.id
    ) AND (
      NEW.platform IS DISTINCT FROM OLD.platform
      OR NEW.external_id IS DISTINCT FROM OLD.external_id
    ) THEN
      RAISE EXCEPTION
        'platform and external_id are immutable for connected accounts';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.file_approval_events_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Purga de conta (admin_purge_user): a cascata declarada no banco leva
  -- tudo que era do cliente, e esta guarda nao deve segurar a propria purga.
  IF current_setting('app.purge_in_progress', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'file approval events are append-only';
END
$function$;

CREATE OR REPLACE FUNCTION public.files_secure_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  _trusted_approval_write boolean :=
    current_user NOT IN ('anon', 'authenticated', 'service_role', 'authenticator');
  _admin_delete boolean :=
    TG_OP = 'DELETE' AND public.has_role(auth.uid(), 'admin'::public.app_role);
  _previous public.files%ROWTYPE;
  _contract public.contracts%ROWTYPE;
  _root_locked boolean;
  _root_visibility text;
  _root_agency_status text;
  _root_approval_status text;
  _root_editable boolean;
BEGIN
  -- Purga de conta (admin_purge_user): a cascata declarada no banco leva
  -- tudo que era do cliente, e esta guarda nao deve segurar a propria purga.
  IF current_setting('app.purge_in_progress', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    IF NEW.project_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.projects AS project
        WHERE project.id = NEW.project_id
          AND project.client_id = NEW.client_id
      ) THEN
      RAISE EXCEPTION 'file project must belong to the same client';
    END IF;
    IF NOT public.file_storage_matches_client(
      NEW.storage_bucket,
      NEW.storage_path,
      NEW.client_id
    ) THEN
      RAISE EXCEPTION 'file storage path must belong to the same client';
    END IF;
    IF NOT public.file_storage_reference_is_canonical(
      NEW.file_url,
      NEW.storage_bucket,
      NEW.storage_path
    ) THEN
      RAISE EXCEPTION 'private file URL must match its storage metadata';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.parent_file_id IS NOT NULL THEN
      SELECT
        file_state.client_id,
        file_state.parent_file_id,
        file_state.locked_at,
        file_state.visibility,
        file_state.agency_approval_status,
        file_state.approval_status,
        file_state.version
      INTO
        _previous.client_id,
        _previous.parent_file_id,
        _previous.locked_at,
        _previous.visibility,
        _previous.agency_approval_status,
        _previous.approval_status,
        _previous.version
      FROM public.file_guard_state(NEW.parent_file_id) AS file_state;

      IF NOT FOUND OR _previous.client_id IS DISTINCT FROM NEW.client_id THEN
        RAISE EXCEPTION 'carousel parent must belong to the same client';
      END IF;
      IF _previous.parent_file_id IS NOT NULL THEN
        RAISE EXCEPTION 'nested carousel children are not allowed';
      END IF;
      IF _previous.locked_at IS NOT NULL
        OR _previous.visibility <> 'internal'
        OR _previous.agency_approval_status <> 'not_requested'
        OR _previous.approval_status <> 'none' THEN
        RAISE EXCEPTION 'carousel children can only be added before review';
      END IF;
      IF NEW.revision_of_file_id IS NOT NULL THEN
        RAISE EXCEPTION 'a revision cannot also be a carousel child';
      END IF;
    END IF;

    IF NEW.revision_of_file_id IS NOT NULL THEN
      SELECT
        file_state.client_id,
        file_state.parent_file_id,
        file_state.locked_at,
        file_state.visibility,
        file_state.agency_approval_status,
        file_state.approval_status,
        file_state.version
      INTO
        _previous.client_id,
        _previous.parent_file_id,
        _previous.locked_at,
        _previous.visibility,
        _previous.agency_approval_status,
        _previous.approval_status,
        _previous.version
      FROM public.file_guard_state(NEW.revision_of_file_id) AS file_state;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'revision source not found';
      END IF;
      IF _previous.parent_file_id IS NOT NULL THEN
        RAISE EXCEPTION 'revision source must be a root file';
      END IF;
      IF _previous.client_id IS DISTINCT FROM NEW.client_id THEN
        RAISE EXCEPTION 'revision source belongs to another client';
      END IF;
      IF (
        _previous.approval_status <> 'rejected'
        AND _previous.agency_approval_status <> 'rejected'
      )
        OR _previous.locked_at IS NULL THEN
        RAISE EXCEPTION 'only a terminal rejected version can be revised';
      END IF;

      NEW.version := COALESCE(_previous.version, 1) + 1;
    ELSE
      NEW.version := COALESCE(NEW.version, 1);
    END IF;

    IF NEW.source = 'contract-public' THEN
      IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'contract-public inserts require the trusted signing backend';
      END IF;

      SELECT contract.* INTO _contract
      FROM public.contracts AS contract
      WHERE contract.client_id = NEW.client_id
        AND contract.status = 'completed'
        AND contract.client_signed_at IS NOT NULL
        AND contract.file_id IS NULL
        AND contract.original_file_name = NEW.file_name
        AND (
          (
            NEW.storage_path IS NOT NULL
            AND public.files_reference_matches(
              contract.original_file_url,
              NEW.storage_path
            )
          )
          OR (
            NEW.storage_path IS NULL
            AND contract.original_file_url = NEW.file_url
          )
        )
      ORDER BY contract.client_signed_at DESC
      LIMIT 1
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'signed contract not found or already registered';
      END IF;

      NEW.project_id := _contract.project_id;
      NEW.uploaded_by := COALESCE(_contract.created_by, _contract.client_id);
      NEW.file_name := _contract.original_file_name;
      NEW.file_url := CASE
        WHEN NEW.storage_path IS NOT NULL THEN 'files://' || NEW.storage_path
        ELSE _contract.original_file_url
      END;
      NEW.file_type := 'application/pdf';
      NEW.folder := 'contratos';
      NEW.description := format(
        'Contrato assinado por %s em %s',
        COALESCE(_contract.client_signature_name, 'cliente'),
        _contract.client_signed_at
      );
      NEW.parent_file_id := NULL;
      NEW.revision_of_file_id := NULL;
      NEW.version := COALESCE(NEW.version, 1);
      NEW.agency_approval_status := 'approved';
      NEW.agency_feedback := NULL;
      NEW.agency_reviewed_by :=
        COALESCE(_contract.created_by, _contract.client_id);
      NEW.agency_reviewed_at := _contract.client_signed_at;
      NEW.approval_status := 'approved';
      NEW.feedback := NULL;
      NEW.client_decided_by := _contract.client_id;
      NEW.client_decided_at := _contract.client_signed_at;
      NEW.approval_requested_at := _contract.client_signed_at;
      NEW.locked_at := _contract.client_signed_at;
      NEW.visibility := 'client_shared';
      NEW.requires_approval := false;
      NEW.source := 'contract-public';
      NEW.status := 'ready';
      NEW.storage_bucket := CASE
        WHEN NEW.storage_path IS NOT NULL THEN 'files'
        ELSE NULL
      END;
      RETURN NEW;
    END IF;

    NEW.agency_approval_status := 'not_requested';
    NEW.agency_feedback := NULL;
    NEW.agency_reviewed_by := NULL;
    NEW.agency_reviewed_at := NULL;
    NEW.approval_status := 'none';
    NEW.feedback := NULL;
    NEW.client_decided_by := NULL;
    NEW.client_decided_at := NULL;
    NEW.approval_requested_at := NULL;
    NEW.locked_at := NULL;
    NEW.visibility := 'internal';
    NEW.requires_approval := false;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT
      COALESCE(root.locked_at, file_row.locked_at) IS NOT NULL,
      root.visibility,
      root.agency_approval_status,
      root.approval_status
    INTO
      _root_locked,
      _root_visibility,
      _root_agency_status,
      _root_approval_status
    FROM public.files AS file_row
    JOIN public.files AS root
      ON root.id = COALESCE(file_row.parent_file_id, file_row.id)
    WHERE file_row.id = OLD.id;

    -- Administrador apaga qualquer versao; o mesmo vale para a limpeza
    -- confiavel que roda por dentro do banco (cascata ao apagar um cliente).
    -- Quem nao e administrador continua sem apagar versao travada ou em revisao.
    IF _trusted_approval_write OR _admin_delete THEN
      RETURN OLD;
    END IF;
    IF COALESCE(_root_locked, false) THEN
      RAISE EXCEPTION 'terminal file versions are immutable';
    END IF;
    _root_editable :=
      _root_visibility = 'internal'
      AND _root_agency_status = 'not_requested'
      AND _root_approval_status = 'none';
    IF NOT COALESCE(_root_editable, false) THEN
      RAISE EXCEPTION 'file versions under review or released are immutable';
    END IF;
    RETURN OLD;
  END IF;

  SELECT
    COALESCE(root.locked_at, file_row.locked_at) IS NOT NULL,
    root.visibility,
    root.agency_approval_status,
    root.approval_status
  INTO
    _root_locked,
    _root_visibility,
    _root_agency_status,
    _root_approval_status
  FROM public.files AS file_row
  JOIN public.files AS root
    ON root.id = COALESCE(file_row.parent_file_id, file_row.id)
  WHERE file_row.id = OLD.id;

  IF COALESCE(_root_locked, false)
    AND NOT _trusted_approval_write THEN
    RAISE EXCEPTION 'terminal file versions are immutable';
  END IF;
  _root_editable :=
    _root_visibility = 'internal'
    AND _root_agency_status = 'not_requested'
    AND _root_approval_status = 'none';
  IF NOT _trusted_approval_write
    AND NOT COALESCE(_root_editable, false) THEN
    RAISE EXCEPTION 'file versions under review or released are immutable';
  END IF;

  IF NOT _trusted_approval_write AND (
    NEW.agency_approval_status IS DISTINCT FROM OLD.agency_approval_status
    OR NEW.agency_feedback IS DISTINCT FROM OLD.agency_feedback
    OR NEW.agency_reviewed_by IS DISTINCT FROM OLD.agency_reviewed_by
    OR NEW.agency_reviewed_at IS DISTINCT FROM OLD.agency_reviewed_at
    OR NEW.approval_status IS DISTINCT FROM OLD.approval_status
    OR NEW.feedback IS DISTINCT FROM OLD.feedback
    OR NEW.client_decided_by IS DISTINCT FROM OLD.client_decided_by
    OR NEW.client_decided_at IS DISTINCT FROM OLD.client_decided_at
    OR NEW.approval_requested_at IS DISTINCT FROM OLD.approval_requested_at
    OR NEW.visibility IS DISTINCT FROM OLD.visibility
    OR NEW.requires_approval IS DISTINCT FROM OLD.requires_approval
    OR NEW.locked_at IS DISTINCT FROM OLD.locked_at
    OR NEW.revision_of_file_id IS DISTINCT FROM OLD.revision_of_file_id
    OR NEW.version IS DISTINCT FROM OLD.version
  ) THEN
    RAISE EXCEPTION 'approval state can only change through guarded functions';
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.guard_workspace_inbox_security_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  -- Purga de conta (admin_purge_user): a cascata declarada no banco leva
  -- tudo que era do cliente, e esta guarda nao deve segurar a propria purga.
  IF current_setting('app.purge_in_progress', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF current_user = 'authenticated' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.inbox_token IS NOT NULL
         OR NEW.inbox_token_created_at IS NOT NULL
         OR NEW.inbox_token_expires_at IS NOT NULL
         OR NEW.inbox_token_generation IS NOT NULL THEN
        RAISE EXCEPTION USING
          ERRCODE = '42501',
          MESSAGE = 'WORKSPACE_INBOX_SECURITY_FIELDS_SERVER_ONLY';
      END IF;
    ELSIF NEW.inbox_token IS DISTINCT FROM OLD.inbox_token
       OR NEW.inbox_token_created_at IS DISTINCT FROM OLD.inbox_token_created_at
       OR NEW.inbox_token_expires_at IS DISTINCT FROM OLD.inbox_token_expires_at
       OR NEW.inbox_token_generation IS DISTINCT FROM OLD.inbox_token_generation THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'WORKSPACE_INBOX_SECURITY_FIELDS_SERVER_ONLY';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.project_external_accounts_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Purga de conta (admin_purge_user): a cascata declarada no banco leva
  -- tudo que era do cliente, e esta guarda nao deve segurar a propria purga.
  IF current_setting('app.purge_in_progress', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.created_at := COALESCE(NEW.created_at, now());
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'created_by is immutable on project_external_accounts';
    END IF;
    IF NEW.client_id IS DISTINCT FROM OLD.client_id THEN
      RAISE EXCEPTION 'client_id is immutable on project_external_accounts';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'created_at is immutable on project_external_accounts';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reports_secure_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  _path text;
  _actor uuid := auth.uid();
BEGIN
  -- Purga de conta (admin_purge_user): a cascata declarada no banco leva
  -- tudo que era do cliente, e esta guarda nao deve segurar a propria purga.
  IF current_setting('app.purge_in_progress', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'published' THEN
      RAISE EXCEPTION 'published reports are immutable';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.status NOT IN ('draft', 'published') THEN
    RAISE EXCEPTION 'invalid report status';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.projects AS project
    WHERE project.id = NEW.project_id
      AND project.client_id = NEW.client_id
  ) THEN
    RAISE EXCEPTION 'report project must belong to the same client';
  END IF;

  _path := public.files_reference_path(NEW.file_url);
  IF _path IS NOT NULL
    AND NOT public.file_storage_matches_client(
      'files',
      _path,
      NEW.client_id
    ) THEN
    RAISE EXCEPTION 'report file must belong to the same client';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF auth.role() = 'authenticated'
      AND NEW.created_by IS DISTINCT FROM _actor THEN
      RAISE EXCEPTION 'report creator must be the authenticated actor';
    END IF;
    IF NEW.status = 'published'
      AND (
        _actor IS NULL
        OR NOT public.can_manage_client(NEW.client_id)
      ) THEN
      RAISE EXCEPTION 'only an assigned manager can publish reports';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'published reports are immutable';
  END IF;
  IF NEW.client_id IS DISTINCT FROM OLD.client_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'protected report fields are immutable';
  END IF;
  IF NEW.status = 'published'
    AND (
      _actor IS NULL
      OR NOT public.can_manage_client(NEW.client_id)
    ) THEN
    RAISE EXCEPTION 'only an assigned manager can publish reports';
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.social_account_events_immutable_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Purga de conta (admin_purge_user): a cascata declarada no banco leva
  -- tudo que era do cliente, e esta guarda nao deve segurar a propria purga.
  IF current_setting('app.purge_in_progress', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'social account events are immutable';
END;
$function$;

CREATE OR REPLACE FUNCTION social_private.external_account_grants_scope_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Purga de conta (admin_purge_user): a cascata declarada no banco leva
  -- tudo que era do cliente, e esta guarda nao deve segurar a propria purga.
  IF current_setting('app.purge_in_progress', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF NEW.revoked_at IS NULL AND EXISTS (
    SELECT 1
    FROM social_private.external_account_grants AS mapping
    WHERE mapping.provider = NEW.provider
      AND mapping.platform = NEW.platform
      AND mapping.provider_resource_id = NEW.provider_resource_id
      AND mapping.revoked_at IS NULL
      AND mapping.external_account_id <> NEW.external_account_id
  ) THEN
    RAISE EXCEPTION
      'this Meta account is already connected; disconnect it before reassignment';
  END IF;

  RETURN NEW;
END;
$function$;

create or replace function public.can_delete_file(_file_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $fn$
  select exists (
    select 1 from public.files as f
    where f.id = _file_id
      and public.can_access_client(f.client_id)
      and (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        or public.can_write_file(f.id)
      )
  )
$fn$;

drop policy if exists files_secure_delete on public.files;
create policy files_secure_delete on public.files
  for delete to authenticated
  using (public.can_delete_file(id));

-- --------------------------------------------------------- 3. registro da purga
create table if not exists public.user_purges (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null,
  target_email text,
  target_name text,
  actor_id uuid not null,
  purged_at timestamptz not null default now(),
  summary jsonb not null default '{}'::jsonb
);
alter table public.user_purges enable row level security;
drop policy if exists user_purges_admin_read on public.user_purges;
create policy user_purges_admin_read on public.user_purges
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role));

-- -------------------------------------------- 4. objetos do storage da conta
create or replace function public.admin_user_storage_objects(_target uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $fn$
  select coalesce(jsonb_object_agg(bucket_id, names), '{}'::jsonb)
  from (
    select bucket_id, jsonb_agg(name order by name) as names
    from storage.objects
    where name like _target::text || '/%'
       or name like 'contracts/' || _target::text || '/%'
       or name like 'reports/' || _target::text || '/%'
    group by bucket_id
  ) as s
$fn$;
revoke all on function public.admin_user_storage_objects(uuid) from public, anon, authenticated;
grant execute on function public.admin_user_storage_objects(uuid) to service_role;

-- ------------------------------------------------------- 5. apagar uma conta
create or replace function public.admin_purge_user(_target uuid, _actor uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  fk record;
  n bigint;
  resumo jsonb := '{}'::jsonb;
  _email text;
  _nome text;
  acao text;
begin
  if _target is null or _actor is null then
    raise exception 'alvo e ator sao obrigatorios';
  end if;
  if _target = _actor then
    raise exception 'Cannot delete yourself';
  end if;
  if not exists (select 1 from public.user_roles where user_id = _actor and role = 'admin') then
    raise exception 'Unauthorized: admin only';
  end if;
  if exists (select 1 from public.user_roles where user_id = _target and role = 'admin') then
    raise exception 'Demote the administrator before deleting this account';
  end if;
  if not exists (select 1 from auth.users where id = _target) then
    raise exception 'usuario nao encontrado';
  end if;

  select p.email, p.full_name into _email, _nome from public.profiles as p where p.id = _target;

  -- vale so nesta transacao: as guardas de imutabilidade deixam a purga passar
  perform set_config('app.purge_in_progress', 'on', true);

  -- o feed de atualizacoes escrito pela pessoa some com ela (regra antiga mantida)
  delete from public.updates where author_id = _target;
  get diagnostics n = row_count;
  if n > 0 then resumo := resumo || jsonb_build_object('public.updates.author_id', 'apagado:' || n); end if;

  -- rede de seguranca: todo vinculo que ainda nao declara o que fazer quando
  -- o perfil some. Tabela nova entra aqui sozinha, sem mexer em codigo.
  for fk in
    select tn.nspname as sch, t.relname as tab, a.attname as col, a.attnotnull as nn
    from pg_constraint con
    join pg_class t on t.oid = con.conrelid
    join pg_namespace tn on tn.oid = t.relnamespace
    join pg_class r on r.oid = con.confrelid
    join pg_namespace rn on rn.oid = r.relnamespace
    join pg_attribute a on a.attrelid = t.oid and a.attnum = con.conkey[1]
    where con.contype = 'f'
      and array_length(con.conkey, 1) = 1
      and con.confdeltype in ('a', 'r')
      and tn.nspname not in ('auth', 'storage', 'vault', 'cron', 'net')
      and ((rn.nspname = 'public' and r.relname = 'profiles')
        or (rn.nspname = 'auth' and r.relname = 'users'))
    order by 1, 2, 3
  loop
    if fk.col in ('client_id', 'user_id', 'profile_id', 'owner_id') then
      execute format('delete from %I.%I where %I = $1', fk.sch, fk.tab, fk.col) using _target;
      acao := 'apagado';
    elsif fk.nn then
      -- coluna obrigatoria de autor: passa para quem apagou (convencao que o
      -- manage-team ja usava). user_purges guarda de quem era.
      execute format('update %I.%I set %I = $2 where %I = $1', fk.sch, fk.tab, fk.col, fk.col) using _target, _actor;
      acao := 'reatribuido';
    else
      execute format('update %I.%I set %I = null where %I = $1', fk.sch, fk.tab, fk.col, fk.col) using _target;
      acao := 'anulado';
    end if;
    get diagnostics n = row_count;
    if n > 0 then
      resumo := resumo || jsonb_build_object(fk.sch || '.' || fk.tab || '.' || fk.col, acao || ':' || n);
    end if;
  end loop;

  insert into public.user_purges (target_id, target_email, target_name, actor_id, summary)
  values (_target, _email, _nome, _actor, resumo);

  -- a cascata declarada acima faz o resto: perfil, papeis, sessoes e tudo que e do cliente
  delete from auth.users where id = _target;

  return resumo;
end
$fn$;
revoke all on function public.admin_purge_user(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_purge_user(uuid, uuid) to service_role;

-- ------------------------------------------- 6. o que ainda falta declarar
-- Lista vinculos ao perfil que dependem da rede de seguranca. Serve para a
-- auditoria apontar tabela nova antes que ela vire erro para alguem.
create or replace function public.admin_delete_readiness()
returns table (tabela text, coluna text, obrigatoria boolean, tratamento text)
language sql
stable
security definer
set search_path to ''
as $fn$
  select tn.nspname || '.' || t.relname, a.attname, a.attnotnull,
         case when a.attname in ('client_id','user_id','profile_id','owner_id') then 'apaga linhas'
              when a.attnotnull then 'reatribui ao administrador'
              else 'anula' end
  from pg_constraint con
  join pg_class t on t.oid = con.conrelid
  join pg_namespace tn on tn.oid = t.relnamespace
  join pg_class r on r.oid = con.confrelid
  join pg_namespace rn on rn.oid = r.relnamespace
  join pg_attribute a on a.attrelid = t.oid and a.attnum = con.conkey[1]
  where con.contype = 'f' and array_length(con.conkey, 1) = 1
    and con.confdeltype in ('a', 'r')
    and tn.nspname not in ('auth', 'storage', 'vault', 'cron', 'net')
    and ((rn.nspname = 'public' and r.relname = 'profiles') or (rn.nspname = 'auth' and r.relname = 'users'))
  order by 1, 2
$fn$;

-- ------------------------------------------------------------- 7. prova
do $chk$
declare n int;
begin
  select count(*) into n from pg_constraint con
  join pg_class r on r.oid = con.confrelid join pg_namespace rn on rn.oid = r.relnamespace
  join pg_class t on t.oid = con.conrelid join pg_attribute a on a.attrelid = t.oid and a.attnum = con.conkey[1]
  where con.contype = 'f' and rn.nspname = 'public' and r.relname = 'profiles'
    and a.attname = 'client_id' and con.confdeltype in ('a', 'r');
  if n <> 0 then
    raise exception 'ainda ha % vinculo(s) client_id -> profiles sem cascata', n;
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'files' and policyname = 'files_secure_delete') <> 1 then
    raise exception 'politica files_secure_delete nao ficou como esperado';
  end if;
end
$chk$;
