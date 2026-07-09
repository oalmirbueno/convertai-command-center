
-- Enum for scope
DO $$ BEGIN
  CREATE TYPE public.workspace_scope AS ENUM ('global','client');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.workspace_kind AS ENUM ('folder','file');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.workspace_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES public.workspace_nodes(id) ON DELETE CASCADE,
  scope public.workspace_scope NOT NULL,
  client_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  kind public.workspace_kind NOT NULL,
  name text NOT NULL,
  mime text,
  size_bytes bigint,
  storage_path text,
  thumb_path text,
  duration_sec numeric,
  sort_index int NOT NULL DEFAULT 0,
  sent_for_approval_file_id uuid REFERENCES public.files(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_nodes_scope_client_ck
    CHECK ((scope = 'client' AND client_id IS NOT NULL) OR (scope = 'global' AND client_id IS NULL)),
  CONSTRAINT workspace_nodes_file_fields_ck
    CHECK (kind = 'folder' OR storage_path IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_workspace_nodes_parent ON public.workspace_nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_workspace_nodes_client ON public.workspace_nodes(client_id);
CREATE INDEX IF NOT EXISTS idx_workspace_nodes_scope ON public.workspace_nodes(scope);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_nodes TO authenticated;
GRANT ALL ON public.workspace_nodes TO service_role;

ALTER TABLE public.workspace_nodes ENABLE ROW LEVEL SECURITY;

-- Only staff (admin/design/traffic/manager) can access
CREATE POLICY "workspace_nodes_staff_select"
  ON public.workspace_nodes FOR SELECT
  TO authenticated
  USING (public.is_staff(auth.uid()));

CREATE POLICY "workspace_nodes_staff_insert"
  ON public.workspace_nodes FOR INSERT
  TO authenticated
  WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "workspace_nodes_staff_update"
  ON public.workspace_nodes FOR UPDATE
  TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "workspace_nodes_staff_delete"
  ON public.workspace_nodes FOR DELETE
  TO authenticated
  USING (public.is_staff(auth.uid()));

-- Updated_at trigger
DROP TRIGGER IF EXISTS trg_workspace_nodes_updated_at ON public.workspace_nodes;
CREATE TRIGGER trg_workspace_nodes_updated_at
  BEFORE UPDATE ON public.workspace_nodes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage policies on the 'workspace' bucket: staff-only
CREATE POLICY "workspace_bucket_staff_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'workspace' AND public.is_staff(auth.uid()));

CREATE POLICY "workspace_bucket_staff_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'workspace' AND public.is_staff(auth.uid()));

CREATE POLICY "workspace_bucket_staff_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'workspace' AND public.is_staff(auth.uid()));

CREATE POLICY "workspace_bucket_staff_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'workspace' AND public.is_staff(auth.uid()));
