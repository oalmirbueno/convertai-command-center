CREATE OR REPLACE FUNCTION public.create_file_record(p_file jsonb)
RETURNS public.files
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _actor uuid := auth.uid();
  _client_id uuid;
  _project_id uuid;
  _created public.files%ROWTYPE;
BEGIN
  IF _actor IS NULL OR NOT (
    public.has_role(_actor, 'admin'::public.app_role)
    OR public.has_role(_actor, 'manager'::public.app_role)
    OR public.has_role(_actor, 'design'::public.app_role)
    OR public.has_role(_actor, 'traffic'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'only team members can create files';
  END IF;

  _client_id := NULLIF(p_file->>'client_id', '')::uuid;
  IF _client_id IS NULL OR NOT public.can_access_client(_client_id) THEN
    RAISE EXCEPTION 'client access denied';
  END IF;

  _project_id := NULLIF(p_file->>'project_id', '')::uuid;
  IF _project_id IS NOT NULL AND NOT public.can_staff_access_project(_project_id) THEN
    RAISE EXCEPTION 'project access denied';
  END IF;

  INSERT INTO public.files (
    id,
    client_id,
    project_id,
    uploaded_by,
    file_name,
    file_url,
    file_type,
    folder,
    mime_type,
    extension,
    storage_bucket,
    storage_path,
    size_bytes,
    sha256,
    tags,
    sensitivity,
    source,
    status,
    visibility,
    requires_approval,
    approval_status,
    agency_approval_status,
    version,
    parent_file_id,
    revision_of_file_id,
    caption,
    carousel_text,
    description,
    idempotency_key
  ) VALUES (
    COALESCE(NULLIF(p_file->>'id', '')::uuid, gen_random_uuid()),
    _client_id,
    _project_id,
    _actor,
    COALESCE(NULLIF(p_file->>'file_name', ''), 'Arquivo'),
    COALESCE(NULLIF(p_file->>'file_url', ''), ''),
    NULLIF(p_file->>'file_type', ''),
    NULLIF(p_file->>'folder', ''),
    NULLIF(p_file->>'mime_type', ''),
    NULLIF(p_file->>'extension', ''),
    NULLIF(p_file->>'storage_bucket', ''),
    NULLIF(p_file->>'storage_path', ''),
    NULLIF(p_file->>'size_bytes', '')::bigint,
    NULLIF(p_file->>'sha256', ''),
    CASE
      WHEN jsonb_typeof(p_file->'tags') = 'array'
        THEN ARRAY(SELECT jsonb_array_elements_text(p_file->'tags'))
      ELSE NULL
    END,
    NULLIF(p_file->>'sensitivity', ''),
    COALESCE(NULLIF(p_file->>'source', ''), 'panel'),
    COALESCE(NULLIF(p_file->>'status', ''), 'ready'),
    'internal',
    false,
    'none',
    'not_requested',
    COALESCE(NULLIF(p_file->>'version', '')::integer, 1),
    NULLIF(p_file->>'parent_file_id', '')::uuid,
    NULLIF(p_file->>'revision_of_file_id', '')::uuid,
    NULLIF(p_file->>'caption', ''),
    NULLIF(p_file->>'carousel_text', ''),
    NULLIF(p_file->>'description', ''),
    NULLIF(p_file->>'idempotency_key', '')
  )
  RETURNING * INTO _created;

  RETURN _created;
END;
$$;

REVOKE ALL ON FUNCTION public.create_file_record(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_file_record(jsonb) TO authenticated, service_role;