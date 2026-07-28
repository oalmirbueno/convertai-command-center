-- Restore the column-scoped contract defined by
-- 20260727132145_secure_file_approval_double_gate.sql.
--
-- A later emergency migration granted table-wide SELECT and UPDATE to every
-- authenticated user. Revoking those table-level privileges also revokes the
-- existing column grants, so restore the original safe column lists in the
-- same transaction. INSERT, DELETE, service_role, RLS policies, data, Storage
-- buckets and MCP remain unchanged.
REVOKE SELECT, UPDATE ON TABLE public.files FROM authenticated;

GRANT SELECT (
  id,
  client_id,
  project_id,
  uploaded_by,
  file_name,
  file_url,
  file_type,
  folder,
  description,
  caption,
  carousel_text,
  approval_status,
  feedback,
  client_decided_by,
  client_decided_at,
  approval_requested_at,
  visibility,
  requires_approval,
  status,
  archived_at,
  created_at,
  updated_at,
  parent_file_id,
  revision_of_file_id,
  locked_at,
  version,
  storage_bucket,
  storage_path,
  mime_type,
  extension,
  size_bytes,
  page_count,
  sheet_count,
  slide_count
) ON public.files TO authenticated;

GRANT UPDATE (
  file_name,
  file_type,
  folder,
  project_id,
  description,
  caption,
  carousel_text,
  tags,
  sensitivity,
  status,
  archived_at,
  updated_at
) ON public.files TO authenticated;
