
-- Reports table
CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES profiles(id),
  title text NOT NULL,
  period_start date,
  period_end date,
  metrics jsonb DEFAULT '{}',
  summary text,
  file_url text,
  status text DEFAULT 'draft',
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reports_select" ON reports FOR SELECT TO authenticated USING (
  client_id = auth.uid()
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'traffic'::app_role)
  OR has_role(auth.uid(), 'manager'::app_role)
);
CREATE POLICY "reports_insert" ON reports FOR INSERT TO authenticated WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'traffic'::app_role)
  OR has_role(auth.uid(), 'manager'::app_role)
);
CREATE POLICY "reports_update" ON reports FOR UPDATE TO authenticated USING (
  has_role(auth.uid(), 'admin'::app_role)
);
CREATE POLICY "reports_delete" ON reports FOR DELETE TO authenticated USING (
  has_role(auth.uid(), 'admin'::app_role)
);
