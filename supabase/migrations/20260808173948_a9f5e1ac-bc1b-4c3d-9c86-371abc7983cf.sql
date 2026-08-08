CREATE OR REPLACE FUNCTION public.notify_ops_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_url text;
  v_secret text;
  v_event text;
  v_data jsonb;
  v_old jsonb;
  v_type text := TG_TABLE_NAME;
  v_ctx jsonb := '{}'::jsonb;
  v_proj record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event := v_type || '_created';
    v_data := pg_catalog.to_jsonb(NEW);
    v_old := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    v_event := v_type || '_updated';
    v_data := pg_catalog.to_jsonb(NEW);
    v_old := pg_catalog.to_jsonb(OLD);
  ELSE
    v_event := v_type || '_deleted';
    v_data := pg_catalog.to_jsonb(OLD);
    v_old := pg_catalog.to_jsonb(OLD);
  END IF;

  IF v_type IN ('tasks', 'milestones') THEN
    BEGIN
      SELECT
        project.name AS project_title,
        project.client_id AS client_id
      INTO v_proj
      FROM public.projects AS project
      WHERE project.id = NULLIF(v_data ->> 'project_id', '')::uuid;

      IF FOUND THEN
        v_ctx := pg_catalog.jsonb_build_object(
          'project_title', v_proj.project_title,
          'client_id', v_proj.client_id
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_ctx := '{}'::jsonb;
    END;
  END IF;

  BEGIN
    SELECT NULLIF(pg_catalog.btrim(secret.decrypted_secret), '')
    INTO v_url
    FROM vault.decrypted_secrets AS secret
    WHERE secret.name = 'ops_receive_portal_sync_url'
    LIMIT 1;

    SELECT NULLIF(pg_catalog.btrim(secret.decrypted_secret), '')
    INTO v_secret
    FROM vault.decrypted_secrets AS secret
    WHERE secret.name = 'ops_webhook_secret'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    RETURN COALESCE(NEW, OLD);
  END;

  IF v_url IS NULL OR v_secret IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_secret
    ),
    body := pg_catalog.jsonb_build_object(
      'event', v_event,
      'type', v_type,
      'table', v_type,
      'op', TG_OP,
      'data', v_data,
      'record', v_data,
      'old_record', v_old,
      'context', COALESCE(v_ctx, '{}'::jsonb),
      'source', 'portal'
    )
  );

  RETURN COALESCE(NEW, OLD);
END;
$function$;

COMMENT ON FUNCTION public.notify_ops_sync() IS
  'Queues the legacy Portal-to-Ops webhook only when both required Vault entries exist.';

REVOKE ALL ON FUNCTION public.notify_ops_sync()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_ops_sync() TO service_role;