
CREATE TABLE public.team_client_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE(user_id, client_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_client_assignments TO authenticated;
GRANT ALL ON public.team_client_assignments TO service_role;

ALTER TABLE public.team_client_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_assignments_select" ON public.team_client_assignments
  FOR SELECT USING (
    auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role)
  );

CREATE POLICY "team_assignments_admin_insert" ON public.team_client_assignments
  FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "team_assignments_admin_delete" ON public.team_client_assignments
  FOR DELETE USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_team_client_assignments_user ON public.team_client_assignments(user_id);
CREATE INDEX idx_team_client_assignments_client ON public.team_client_assignments(client_id);
