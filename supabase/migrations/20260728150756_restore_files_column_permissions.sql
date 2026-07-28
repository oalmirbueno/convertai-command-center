-- Restore the column-scoped contract defined by
-- 20260727132145_secure_file_approval_double_gate.sql.
--
-- A later emergency migration granted table-wide SELECT and UPDATE to every
-- authenticated user. Revoking only those table-level privileges makes the
-- existing column-level grants effective again without changing INSERT,
-- DELETE, service_role, RLS policies, data, Storage buckets or MCP.
REVOKE SELECT, UPDATE ON TABLE public.files FROM authenticated;
