CREATE SCHEMA IF NOT EXISTS app_private AUTHORIZATION postgres;

REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
REVOKE ALL ON SCHEMA app_private FROM anon;
REVOKE ALL ON SCHEMA app_private FROM authenticated;
REVOKE ALL ON SCHEMA app_private FROM service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_private REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_private REVOKE EXECUTE ON FUNCTIONS FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_private REVOKE EXECUTE ON FUNCTIONS FROM service_role;

CREATE OR REPLACE FUNCTION app_private.staff_files_secure_rows()
RETURNS SETOF public.files
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT f.*
  FROM public.files AS f
  WHERE public.is_staff(auth.uid())
    AND public.can_access_client(f.client_id)
$$;

ALTER FUNCTION app_private.staff_files_secure_rows() OWNER TO postgres;

REVOKE ALL ON FUNCTION app_private.staff_files_secure_rows() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.staff_files_secure_rows() FROM anon;
REVOKE ALL ON FUNCTION app_private.staff_files_secure_rows() FROM authenticated;
REVOKE ALL ON FUNCTION app_private.staff_files_secure_rows() FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.staff_files_secure_rows() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.staff_files_secure_rows() TO service_role;

CREATE OR REPLACE VIEW public.staff_files_secure
WITH (security_barrier = true, security_invoker = true) AS
 SELECT file_row.id,
    file_row.project_id,
    file_row.client_id,
    file_row.uploaded_by,
    file_row.file_name,
    file_row.file_url,
    file_row.file_type,
    file_row.folder,
    file_row.approval_status,
    file_row.feedback,
    file_row.created_at,
    file_row.version,
    file_row.parent_file_id,
    file_row.caption,
    file_row.carousel_text,
    file_row.description,
    file_row.mime_type,
    file_row.extension,
    file_row.size_bytes,
    file_row.sha256,
    file_row.storage_bucket,
    file_row.storage_path,
    file_row.tags,
    file_row.visibility,
    file_row.sensitivity,
    file_row.requires_approval,
    file_row.status,
    file_row.extraction_status,
    file_row.extraction_error,
    file_row.page_count,
    file_row.sheet_count,
    file_row.slide_count,
    file_row.extracted_metadata,
    file_row.source,
    file_row.idempotency_key,
    file_row.archived_at,
    file_row.updated_at,
    file_row.agency_approval_status,
    file_row.agency_feedback,
    file_row.agency_reviewed_by,
    file_row.agency_reviewed_at,
    file_row.client_decided_by,
    file_row.client_decided_at,
    file_row.approval_requested_at,
    file_row.revision_of_file_id,
    file_row.locked_at,
    jsonb_build_object('full_name', uploader.full_name) AS uploader,
    jsonb_build_object('name', project.name) AS project,
    jsonb_build_object('full_name', client.full_name, 'company_name', client.company_name) AS client
   FROM app_private.staff_files_secure_rows() file_row
     LEFT JOIN public.profiles uploader ON uploader.id = file_row.uploaded_by
     LEFT JOIN public.projects project ON project.id = file_row.project_id
     LEFT JOIN public.profiles client ON client.id = file_row.client_id
  WHERE public.is_staff(auth.uid()) AND public.can_access_client(file_row.client_id);

REVOKE ALL ON TABLE public.staff_files_secure FROM PUBLIC;
REVOKE ALL ON TABLE public.staff_files_secure FROM anon;
GRANT SELECT ON TABLE public.staff_files_secure TO authenticated;