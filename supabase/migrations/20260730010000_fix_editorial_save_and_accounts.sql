BEGIN;

-- Rollback is data-free: restore editorial_file_is_publishable_media from
-- 20260729233930 and drop create_and_link_editorial_account(uuid, uuid, text,
-- text, text). This migration does not rewrite existing files or accounts.

-- A carousel is approved as one version rooted at parent_file_id IS NULL.
-- Children keep the root's client decision and may retain
-- requires_approval=true after release_file_to_client('approval'). Keep every
-- child integrity gate, but do not treat that inherited flag as a separate
-- pending approval.
CREATE OR REPLACE FUNCTION public.editorial_file_is_publishable_media(
  _file_id uuid,
  _client_id uuid,
  _project_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.files AS root
    WHERE root.id = _file_id
      AND public.editorial_file_is_publishable(
        root.id,
        _client_id,
        _project_id
      )
      AND NOT (
        lower(COALESCE(root.mime_type, '')) = 'application/pdf'
        OR lower(COALESCE(root.mime_type, '')) IN (
          'application/msword',
          'application/vnd.ms-powerpoint',
          'application/vnd.ms-excel',
          'text/csv'
        )
        OR lower(COALESCE(root.mime_type, '')) LIKE
          'application/vnd.openxmlformats-officedocument.%'
        OR lower(COALESCE(root.mime_type, '')) LIKE
          'application/vnd.oasis.opendocument.%'
        OR lower(COALESCE(root.extension, '')) IN (
          'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx',
          'csv', 'odt', 'ods', 'odp'
        )
        OR lower(COALESCE(root.file_name, '')) ~
          '\.(pdf|docx?|pptx?|xlsx?|csv|odt|ods|odp)([[:space:]_()/#?()-]|\[|\]|$)'
        OR lower(COALESCE(root.file_url, '')) ~
          '\.(pdf|docx?|pptx?|xlsx?|csv|odt|ods|odp)([[:space:]_()/#?()-]|\[|\]|$)'
        OR lower(COALESCE(root.storage_path, '')) ~
          '\.(pdf|docx?|pptx?|xlsx?|csv|odt|ods|odp)([[:space:]_()/#?()-]|\[|\]|$)'
        OR lower(COALESCE(root.file_type, '')) IN (
          'pdf',
          'application/pdf',
          'application/msword',
          'application/vnd.ms-powerpoint',
          'application/vnd.ms-excel',
          'document',
          'documento',
          'contract',
          'contrato',
          'report',
          'relatorio',
          'relatório',
          'office'
        )
      )
      AND (
        lower(COALESCE(root.mime_type, '')) LIKE 'image/%'
        OR lower(COALESCE(root.mime_type, '')) LIKE 'video/%'
        OR lower(COALESCE(root.extension, '')) IN (
          'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg',
          'bmp', 'mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi'
        )
        OR lower(COALESCE(root.file_name, '')) ~
          '\.(jpe?g|png|gif|webp|avif|svg|bmp|mp4|webm|mov|m4v|mkv|avi)([[:space:]_()/#?()-]|\[|\]|$)'
        OR lower(COALESCE(root.file_url, '')) ~
          '\.(jpe?g|png|gif|webp|avif|svg|bmp|mp4|webm|mov|m4v|mkv|avi)([[:space:]_()/#?()-]|\[|\]|$)'
        OR lower(COALESCE(root.storage_path, '')) ~
          '\.(jpe?g|png|gif|webp|avif|svg|bmp|mp4|webm|mov|m4v|mkv|avi)([[:space:]_()/#?()-]|\[|\]|$)'
        OR lower(COALESCE(root.file_type, '')) IN (
          'image',
          'imagem',
          'photo',
          'foto',
          'video',
          'vídeo'
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.files AS child
        WHERE child.parent_file_id = root.id
          AND (
            child.client_id IS DISTINCT FROM root.client_id
            OR child.project_id IS DISTINCT FROM root.project_id
            OR child.archived_at IS NOT NULL
            OR COALESCE(child.status, 'ready') <> 'ready'
            OR child.agency_approval_status <> 'approved'
            OR child.visibility <> 'approval'
            OR child.approval_status <> 'none'
            OR child.locked_at IS NULL
            OR NOT (
              lower(COALESCE(child.mime_type, '')) LIKE 'image/%'
              OR lower(COALESCE(child.extension, '')) IN (
                'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg',
                'bmp'
              )
              OR lower(COALESCE(child.file_name, '')) ~
                '\.(jpe?g|png|gif|webp|avif|svg|bmp)([[:space:]_()/#?()-]|\[|\]|$)'
              OR lower(COALESCE(child.file_url, '')) ~
                '\.(jpe?g|png|gif|webp|avif|svg|bmp)([[:space:]_()/#?()-]|\[|\]|$)'
              OR lower(COALESCE(child.storage_path, '')) ~
                '\.(jpe?g|png|gif|webp|avif|svg|bmp)([[:space:]_()/#?()-]|\[|\]|$)'
              OR lower(COALESCE(child.file_type, '')) IN (
                'image',
                'imagem',
                'photo',
                'foto'
              )
            )
          )
      )
  )
$$;

REVOKE ALL ON FUNCTION public.editorial_file_is_publishable_media(
  uuid,
  uuid,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;

-- Create the account and its project link in one statement. SECURITY DEFINER
-- is required because both protected tables must commit atomically; the actor,
-- client assignment and composite project scope are revalidated explicitly.
CREATE OR REPLACE FUNCTION public.create_and_link_editorial_account(
  p_client_id uuid,
  p_project_id uuid,
  p_platform text,
  p_display_name text,
  p_handle text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _actor uuid := auth.uid();
  _platform text := lower(NULLIF(btrim(p_platform), ''));
  _display_name text := NULLIF(btrim(p_display_name), '');
  _handle text := NULLIF(btrim(p_handle), '');
  _account_id uuid;
BEGIN
  IF _actor IS NULL
    OR p_client_id IS NULL
    OR NOT public.can_manage_client(p_client_id) THEN
    RAISE EXCEPTION 'editorial account access denied';
  END IF;

  IF p_project_id IS NULL THEN
    RAISE EXCEPTION
      'editorial project must be available and belong to the client';
  END IF;

  PERFORM 1
  FROM public.projects AS project
  WHERE project.id = p_project_id
    AND project.client_id = p_client_id
    AND project.deleted_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'editorial project must be available and belong to the client';
  END IF;

  IF _platform IS NULL
    OR _platform NOT IN (
      'instagram',
      'facebook',
      'tiktok',
      'linkedin',
      'youtube',
      'google_business'
    ) THEN
    RAISE EXCEPTION 'unsupported editorial platform';
  END IF;

  IF _display_name IS NULL THEN
    RAISE EXCEPTION 'editorial account display name is required';
  END IF;

  INSERT INTO public.external_accounts (
    client_id,
    platform,
    display_name,
    handle,
    status,
    created_by
  ) VALUES (
    p_client_id,
    _platform,
    _display_name,
    _handle,
    'active',
    _actor
  )
  RETURNING id INTO _account_id;

  INSERT INTO public.project_external_accounts (
    client_id,
    project_id,
    external_account_id,
    created_by
  ) VALUES (
    p_client_id,
    p_project_id,
    _account_id,
    _actor
  );

  RETURN _account_id;
END
$$;

REVOKE ALL ON FUNCTION public.create_and_link_editorial_account(
  uuid,
  uuid,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_and_link_editorial_account(
  uuid,
  uuid,
  text,
  text,
  text
) TO authenticated;

-- Linking an already existing account continues through INSERT on
-- project_external_accounts. Its authenticated-only grant, pea_insert RLS
-- policy, composite client foreign keys and created_by guard already enforce
-- the same client/project/actor boundary without privileged code.

COMMIT;
