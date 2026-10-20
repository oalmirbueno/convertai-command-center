-- Only scripts/seed-ci-e2e.mjs may run this against the ephemeral CI stack.
-- Keep real authentication, business guards and RLS; isolate outbound hooks.
DO $ci$
DECLARE item record; http_sequence regclass; http_state jsonb; hook_state jsonb; vault_state jsonb;
BEGIN
  IF session_user <> 'postgres' OR current_database() <> 'postgres'
     OR to_regclass('aceleriq_ci_replay.operator_parent_attestation') IS NULL THEN
    RAISE EXCEPTION 'E2E_REQUIRES_EPHEMERAL_CI_STACK';
  END IF;
  IF to_regclass('aceleriq_ci_replay.background_job_attestation') IS NULL
     OR EXISTS(SELECT 1 FROM cron.job WHERE active) THEN
    RAISE EXCEPTION 'E2E_REQUIRES_PAUSED_CI_BACKGROUND_JOBS';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM aceleriq_ci_replay.operator_parent_attestation WHERE frozen)
     OR EXISTS(SELECT 1 FROM auth.users) OR EXISTS(SELECT 1 FROM public.profiles)
     OR EXISTS(SELECT 1 FROM public.projects) OR EXISTS(SELECT 1 FROM public.tasks)
     OR EXISTS(SELECT 1 FROM public.user_roles) OR EXISTS(SELECT 1 FROM public.team_client_assignments)
     OR EXISTS(SELECT 1 FROM public.editorial_posts) OR EXISTS(SELECT 1 FROM public.editorial_publications)
     OR EXISTS(SELECT 1 FROM public.operator_runs) OR EXISTS(SELECT 1 FROM public.operator_task_links)
     OR EXISTS(SELECT 1 FROM public.operator_approvals) OR EXISTS(SELECT 1 FROM public.operator_participations)
     OR EXISTS(SELECT 1 FROM public.assignment_proposals) OR EXISTS(SELECT 1 FROM public.operator_deliveries)
     OR EXISTS(SELECT 1 FROM social_private.autopublish_jobs)
     -- The canonical render migration generates one local callback secret.
     -- Accept only its metadata, with rendering disconnected. Never read its
     -- value, allow provider credentials, or remove canonical replay data.
     OR (SELECT count(*) FROM vault.secrets)<>1
     OR EXISTS(SELECT 1 FROM vault.secrets
       WHERE name IS DISTINCT FROM 'render_nuvem_segredo'
          OR description IS DISTINCT FROM 'Aviso do banco para o render na nuvem (Modal)')
     OR EXISTS(SELECT 1 FROM public.render_nuvem WHERE ligada OR url_acordar IS NOT NULL)
     OR EXISTS(SELECT 1 FROM net.http_request_queue)
     OR to_regclass('aceleriq_ci_replay.e2e_seed_guard') IS NOT NULL THEN
    RAISE EXCEPTION 'E2E_REQUIRES_EMPTY_UNCONFIGURED_SYNTHETIC_STACK';
  END IF;
  -- Every trigger reached by these fixtures is explicitly reviewed. A future
  -- trigger must be reviewed before auth.admin.createUser may run this seed.
  IF EXISTS(
    SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE NOT t.tgisinternal AND t.tgrelid IN (
      'auth.users'::regclass,'public.profiles'::regclass,'public.projects'::regclass,
      'public.tasks'::regclass,'public.user_roles'::regclass,'public.team_client_assignments'::regclass)
    AND (t.tgrelid::regclass::text,n.nspname,p.proname) NOT IN (
      ('auth.users','public','handle_new_user'),
      ('profiles','public','notify_ops_sync'),('profiles','public','update_updated_at_column'),
      ('profiles','app_private','capture_legacy_first_access_token'),('profiles','app_private','guard_profile_editable_fields'),
      ('projects','public','notify_ops_sync'),('projects','public','update_updated_at_column'),
      ('tasks','public','notify_ops_sync'),('tasks','public','update_updated_at_column'),
      ('tasks','public','update_milestone_progress'),('tasks','public','editorial_lock_task_sync_trigger'),
      ('tasks','public','editorial_task_delivery_type_guard'),('tasks','public','editorial_prevent_premature_task_completion'),
      ('tasks','public','editorial_sync_post_from_task_trigger'),('tasks','public','tasks_encerra_propostas'),
      ('tasks','public','contexto_extra_enfileira'),('tasks','public','tasks_acao_feita_no_dossie')
    )
  ) THEN RAISE EXCEPTION 'E2E_UNREVIEWED_FIXTURE_TRIGGER'; END IF;
  -- These two reviewed triggers only react to an UPDATE of deletion/status.
  -- The seed inserts backlog tasks; retain both triggers and reject rebinding.
  IF EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE t.tgrelid='public.tasks'::regclass AND NOT t.tgisinternal
      AND p.proname IN ('contexto_extra_enfileira','tasks_acao_feita_no_dossie')
      AND (t.tgtype<>17 OR t.tgenabled<>'O' OR t.tgqual IS NOT NULL
        OR t.tgattr::text IS DISTINCT FROM (
          SELECT a.attnum::text FROM pg_attribute a WHERE a.attrelid=t.tgrelid
            AND a.attname=CASE p.proname WHEN 'contexto_extra_enfileira' THEN 'deleted_at' ELSE 'status' END))) THEN
    RAISE EXCEPTION 'E2E_BACKGROUND_TRIGGER_BINDING_CHANGED';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='auth.users'::regclass
       AND tgfoid='public.handle_new_user()'::regprocedure AND tgenabled='O') THEN
    RAISE EXCEPTION 'E2E_REQUIRES_REAL_AUTH_PROFILE_TRIGGER';
  END IF;
  http_sequence:=pg_get_serial_sequence('net.http_request_queue','id')::regclass;
  IF http_sequence IS NULL THEN RAISE EXCEPTION 'E2E_HTTP_SEQUENCE_UNAVAILABLE'; END IF;
  EXECUTE format('SELECT jsonb_build_object(''last_value'',last_value,''is_called'',is_called) FROM %s',http_sequence) INTO http_state;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('table_oid',t.tgrelid,'trigger_oid',t.oid,
    'function_oid',t.tgfoid,'name',t.tgname,'enabled',t.tgenabled) ORDER BY t.tgrelid,t.tgname),'[]'::jsonb)
  INTO hook_state FROM pg_trigger t WHERE NOT t.tgisinternal
    AND t.tgfoid='public.notify_ops_sync()'::regprocedure
    AND t.tgrelid IN ('public.profiles'::regclass,'public.projects'::regclass,'public.tasks'::regclass);
  SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'description',s.description,
    'created_at',s.created_at,'updated_at',s.updated_at) ORDER BY s.id)
    INTO vault_state FROM vault.secrets AS s;
  CREATE TABLE aceleriq_ci_replay.e2e_seed_guard(
    id boolean PRIMARY KEY DEFAULT true CHECK(id), run_id uuid NOT NULL,
    hook_state jsonb NOT NULL, http_sequence oid NOT NULL, http_state jsonb NOT NULL, vault_state jsonb NOT NULL,
    restored boolean NOT NULL DEFAULT false, seeded boolean NOT NULL DEFAULT false,
    business_state jsonb
  );
  REVOKE ALL ON aceleriq_ci_replay.e2e_seed_guard FROM PUBLIC,anon,authenticated,service_role;
  INSERT INTO aceleriq_ci_replay.e2e_seed_guard(run_id,hook_state,http_sequence,http_state,vault_state)
    VALUES('__RUN_ID__',hook_state,http_sequence,http_state,vault_state);
  FOR item IN SELECT * FROM jsonb_to_recordset(hook_state)
    AS h(table_oid oid,trigger_oid oid,function_oid oid,name text,enabled text) LOOP
    EXECUTE format('ALTER TABLE %s DISABLE TRIGGER %I',item.table_oid::regclass,item.name);
  END LOOP;
END
$ci$;
