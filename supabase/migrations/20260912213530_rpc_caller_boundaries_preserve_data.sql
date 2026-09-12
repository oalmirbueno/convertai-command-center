-- SEC-01..05: caller boundaries, without changing or removing existing data.
-- Signatures, return contracts, OIDs and business bodies are preserved. The
-- guarded replacement below fails closed if a known routine changes shape.
-- No data migration, job dispatch, token rotation or history cleanup occurs.

CREATE OR REPLACE FUNCTION app_private.rpc_trusted_backend()
RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $body$
  SELECT
    current_setting('role', true) = 'service_role'
    OR (
      COALESCE(NULLIF(current_setting('role', true), ''), 'none') = 'none'
      AND session_user IN ('postgres', 'supabase_admin', 'service_role')
    );
$body$;

COMMENT ON FUNCTION app_private.rpc_trusted_backend() IS
  'Trust the database request role, not current_user (elevated by SECURITY DEFINER), JWT text or missing auth.uid. Direct postgres/pg_cron with no SET ROLE remains supported.';

CREATE OR REPLACE FUNCTION app_private.require_rpc_staff()
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $body$
BEGIN
  IF app_private.rpc_trusted_backend() THEN RETURN; END IF;
  IF auth.uid() IS NULL OR NOT COALESCE(public.is_staff(auth.uid()), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RPC_STAFF_REQUIRED';
  END IF;
END;
$body$;

CREATE OR REPLACE FUNCTION app_private.require_rpc_admin()
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $body$
BEGIN
  IF app_private.rpc_trusted_backend() THEN RETURN; END IF;
  IF auth.uid() IS NULL OR NOT COALESCE(public.has_role(auth.uid(), 'admin'::public.app_role), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RPC_ADMIN_REQUIRED';
  END IF;
END;
$body$;

CREATE OR REPLACE FUNCTION app_private.require_rpc_client_staff(_client_id uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $body$
BEGIN
  IF app_private.rpc_trusted_backend() THEN RETURN; END IF;
  PERFORM app_private.require_rpc_staff();
  IF NOT COALESCE(public.can_access_client(_client_id), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RPC_CLIENT_SCOPE_DENIED';
  END IF;
END;
$body$;

CREATE OR REPLACE FUNCTION app_private.require_rpc_task_staff(_task_id uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $body$
DECLARE _client_id uuid;
BEGIN
  IF app_private.rpc_trusted_backend()
     OR COALESCE(public.has_role(auth.uid(), 'admin'::public.app_role), false) THEN RETURN; END IF;
  PERFORM app_private.require_rpc_staff();
  SELECT project.client_id INTO _client_id
  FROM public.tasks task JOIN public.projects project ON project.id = task.project_id
  WHERE task.id = _task_id AND task.deleted_at IS NULL AND project.deleted_at IS NULL;
  IF _client_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RPC_CLIENT_SCOPE_DENIED';
  END IF;
  PERFORM app_private.require_rpc_client_staff(_client_id);
END;
$body$;

CREATE OR REPLACE FUNCTION app_private.require_rpc_link_staff(_link_id uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $body$
DECLARE _link public.operator_task_links%ROWTYPE;
BEGIN
  IF app_private.rpc_trusted_backend()
     OR COALESCE(public.has_role(auth.uid(), 'admin'::public.app_role), false) THEN RETURN; END IF;
  PERFORM app_private.require_rpc_staff();
  SELECT * INTO _link FROM public.operator_task_links WHERE id = _link_id;
  IF NOT FOUND OR (_link.kanban_task_id IS NULL AND _link.painel_task_id IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RPC_CLIENT_SCOPE_DENIED';
  END IF;
  IF _link.kanban_task_id IS NOT NULL THEN
    PERFORM app_private.require_rpc_task_staff(_link.kanban_task_id);
  END IF;
  IF _link.painel_task_id IS NOT NULL THEN
    PERFORM app_private.require_rpc_task_staff(_link.painel_task_id);
  END IF;
END;
$body$;

CREATE OR REPLACE FUNCTION app_private.rpc_audit_actor(_service_actor text)
RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $body$
  SELECT CASE WHEN app_private.rpc_trusted_backend()
    THEN COALESCE(NULLIF(btrim(_service_actor), ''), 'service:' || session_user::text)
    ELSE 'painel:' || auth.uid()::text END;
$body$;

REVOKE ALL ON FUNCTION app_private.rpc_trusted_backend() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.require_rpc_staff() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.require_rpc_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.require_rpc_client_staff(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.require_rpc_task_staff(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.require_rpc_link_staff(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.rpc_audit_actor(text) FROM PUBLIC, anon, authenticated;

-- Keep current patched business logic and function identity (including callers
-- bound to the OID), adding only the authorization prelude. No copied stale body.
DO $migration$
DECLARE _item record; _oid regprocedure; _source text; _new_source text; _definition text;
BEGIN
  FOR _item IN SELECT * FROM (VALUES
    ('public.upsert_current_dossier(uuid,text,text,uuid,text,text,text,text,text[],jsonb,text,text,integer)',
      E'PERFORM app_private.require_rpc_client_staff(_client_id);\n  _actor := app_private.rpc_audit_actor(_actor);'),
    ('public.dossie_registrar_avancos(uuid)',
      'PERFORM app_private.require_rpc_client_staff(_client_id);'),
    ('public.operator_update(text,text,text,text,text,text,integer,text,text,boolean)',
      E'PERFORM app_private.require_rpc_admin();\n  _actor := app_private.rpc_audit_actor(_actor);'),
    ('public.operator_assign_task(text,uuid,text,text)',
      E'PERFORM app_private.require_rpc_task_staff(_kanban_task_id);\n  _actor := app_private.rpc_audit_actor(_actor);'),
    ('public.operator_human_action(uuid,text,text,boolean)',
      'PERFORM app_private.require_rpc_link_staff(_link_id);'),
    ('public.operator_expire_stale_runs()',
      'PERFORM app_private.require_rpc_admin();'),
    ('public.operator_fechar_orfaos()',
      'PERFORM app_private.require_rpc_admin();')
  ) AS guard(signature, prelude)
  LOOP
    _oid := to_regprocedure(_item.signature);
    IF _oid IS NULL THEN RAISE EXCEPTION 'RPC_BOUNDARY_TARGET_MISSING: %', _item.signature; END IF;
    SELECT p.prosrc, pg_get_functiondef(p.oid) INTO _source, _definition
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
    WHERE p.oid = _oid AND l.lanname = 'plpgsql' AND p.prosecdef;
    IF NOT FOUND THEN RAISE EXCEPTION 'RPC_BOUNDARY_TARGET_SHAPE: %', _item.signature; END IF;
    _new_source := regexp_replace(_source, '(?im)^begin[[:blank:]]*$',
      E'BEGIN\n  -- rpc-caller-boundary-20260912\n  ' || _item.prelude);
    IF _new_source = _source THEN RAISE EXCEPTION 'RPC_BOUNDARY_BEGIN_MISSING: %', _item.signature; END IF;
    IF _item.signature = 'public.operator_fechar_orfaos()' THEN
      -- This pre-existing human check otherwise rejects legitimate service and
      -- postgres cron sessions with no JWT. The new admin guard stays first.
      IF position('IF NOT public.is_staff(auth.uid()) THEN' IN _new_source) = 0 THEN
        RAISE EXCEPTION 'RPC_BOUNDARY_ORPHAN_CHECK_CHANGED';
      END IF;
      _new_source := replace(_new_source, 'IF NOT public.is_staff(auth.uid()) THEN',
        'IF NOT app_private.rpc_trusted_backend() AND NOT public.is_staff(auth.uid()) THEN');
    END IF;
    -- Replace only the function body; headers/defaults/search_path remain exact.
    EXECUTE replace(_definition, _source, _new_source);
  END LOOP;
END;
$migration$;

-- SQL readers used by these features need the same scope boundary. Convert
-- their expression into a guarded PL/pgSQL return without changing its result.
DO $migration$
DECLARE _item record; _oid regprocedure; _args text; _result text; _source text;
BEGIN
  FOR _item IN SELECT * FROM (VALUES
    ('public.dossie_avancos_texto(uuid,integer)', 'dossie_avancos_texto',
      'PERFORM app_private.require_rpc_client_staff(_client_id);'),
    ('public.ads_contas_conhecidas()', 'ads_contas_conhecidas',
      'PERFORM app_private.require_rpc_admin();')
  ) AS guard(signature, name, prelude)
  LOOP
    _oid := to_regprocedure(_item.signature);
    IF _oid IS NULL THEN RAISE EXCEPTION 'RPC_BOUNDARY_TARGET_MISSING: %', _item.signature; END IF;
    SELECT pg_get_function_arguments(p.oid), pg_get_function_result(p.oid),
      regexp_replace(btrim(p.prosrc), ';[[:space:]]*$', '')
    INTO _args, _result, _source FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
    WHERE p.oid = _oid AND l.lanname = 'sql' AND p.prosecdef;
    IF NOT FOUND THEN RAISE EXCEPTION 'RPC_BOUNDARY_TARGET_SHAPE: %', _item.signature; END IF;
    EXECUTE format('CREATE OR REPLACE FUNCTION public.%I(%s) RETURNS %s LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = %L AS %L',
      _item.name, _args, _result, '', 'BEGIN ' || _item.prelude || E'\nRETURN (' || _source || E');\nEND;');
  END LOOP;
END;
$migration$;

-- Audit inventory: these privileged functions are internal services or cron
-- entrypoints, not browser RPCs. Revoking PUBLIC is essential: revoking anon
-- alone leaves the inherited =X permission in place. Triggers keep firing;
-- PostgreSQL does not consult EXECUTE grants when executing an existing trigger.
DO $migration$
DECLARE _name text; _function record; _found boolean;
BEGIN
  FOREACH _name IN ARRAY ARRAY[
    'save_meta_ads_token_from_login', 'ads_oauth_consume_session',
    'ads_creatives_tick', 'ads_metrics_tick', 'social_metrics_tick',
    'editorial_ciclo_publicacao', 'editorial_promover_planejados',
    'editorial_alerta_agendamento_atrasado', 'editorial_conferir_agendamentos',
    'editorial_limpar_alertas_resolvidos', 'editorial_reconciliar_publicados',
    'social_metrics_ciclo', 'social_retrato_da_semana_corrente',
    'audit_dossies_duplicados', 'audit_referencias_orfas',
    'dossie_registrar_avancos_todos',
    'operator_report_event', 'operator_ordens_abertas', 'operator_ordem_executada',
    'operator_cancelar_tarefa', 'operator_participar', 'operator_request_approval',
    'operator_propor_responsavel', 'operator_registrar_feito',
    'operator_reconciliar_vinculos_gemeos'
  ] LOOP
    _found := false;
    FOR _function IN SELECT p.oid::regprocedure AS signature
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = _name AND p.prokind = 'f'
    LOOP
      _found := true;
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', _function.signature);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', _function.signature);
    END LOOP;
    IF NOT _found THEN RAISE EXCEPTION 'RPC_BOUNDARY_TARGET_MISSING: %', _name; END IF;
  END LOOP;
END;
$migration$;

-- The actual publication tick is also service-only; its body belongs to the
-- independent cancellation fix. Legitimate cron/service wrappers retain access.
REVOKE ALL ON FUNCTION public.editorial_autopublish_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.editorial_autopublish_tick() TO service_role;

-- Authenticated UI entrypoints retain their contracts and now require the
-- server-side role/scope guard (or an existing explicit role check).
DO $migration$
DECLARE _name text; _function record;
BEGIN
  FOREACH _name IN ARRAY ARRAY[
    'upsert_current_dossier', 'dossie_registrar_avancos', 'dossie_avancos_texto',
    'operator_update', 'operator_assign_task', 'operator_human_action',
    'operator_expire_stale_runs', 'operator_fechar_orfaos',
    'operator_approval_decidir', 'operator_pausar',
    'assignment_proposal_decidir', 'assignment_proposal_decidir_lote',
    'ads_oauth_create_session', 'ads_contas_conhecidas', 'collect_ads_now',
    'collect_ads_metrics_now', 'collect_social_metrics_now',
    'expense_pagar', 'expense_estornar', 'admin_delete_readiness', 'can_delete_file'
  ] LOOP
    FOR _function IN SELECT p.oid::regprocedure AS signature
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = _name AND p.prokind = 'f'
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', _function.signature);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', _function.signature);
    END LOOP;
  END LOOP;
END;
$migration$;

-- Ongoing SQL-only maintenance. These routines update logical status/reasons
-- and preserve records, evidence, prior decisions and approvals. They never
-- execute approved orders, dispatch agents or call external services.
CREATE OR REPLACE FUNCTION public.operator_maintenance_tick()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $body$
DECLARE _expired integer; _orphans jsonb;
BEGIN
  PERFORM app_private.require_rpc_admin();
  _expired := public.operator_expire_stale_runs();
  _orphans := public.operator_fechar_orfaos();
  RETURN jsonb_build_object('stale_runs_expired', _expired, 'orphans', _orphans);
END;
$body$;
REVOKE ALL ON FUNCTION public.operator_maintenance_tick() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_maintenance_tick() TO authenticated, service_role;

-- Installed only when this migration is approved/applied. Named schedule is
-- idempotent for the same cron owner; no maintenance is run during migration.
DO $migration$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'RPC_MAINTENANCE_REQUIRES_PG_CRON';
  END IF;
  PERFORM cron.schedule('operator-maintenance-5min', '*/5 * * * *',
    'SELECT public.operator_maintenance_tick();');
END;
$migration$;

-- A row policy controls WHOSE profile can be edited, not WHICH fields.
-- A trigger is used instead of blanket column revokes because both Almir/admin
-- and clients use the same PostgREST authenticated database role.
CREATE OR REPLACE FUNCTION app_private.guard_profile_editable_fields()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $body$
BEGIN
  IF app_private.rpc_trusted_backend()
     OR COALESCE(public.has_role(auth.uid(), 'admin'::public.app_role), false) THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PROFILE_EDIT_DENIED';
  END IF;
  -- onboarding_done is the existing first-login tour acknowledgement, written
  -- by AppLayout. Keep that self-service flow. All unlisted/new fields deny by
  -- default, including plan_value/status/date, services_config and deleted_at.
  IF (to_jsonb(NEW) - ARRAY['full_name','company_name','email','phone','avatar_url','onboarding_done','updated_at'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['full_name','company_name','email','phone','avatar_url','onboarding_done','updated_at']) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PROFILE_COMMERCIAL_FIELDS_ADMIN_ONLY';
  END IF;
  RETURN NEW;
END;
$body$;

REVOKE ALL ON FUNCTION app_private.guard_profile_editable_fields() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER profiles_guard_editable_fields
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION app_private.guard_profile_editable_fields();

-- No mutation of existing records. No DELETE, TRUNCATE, DROP of data objects,
-- UPDATE of business rows, token rotation, queue dispatch or history rewrite.
