
-- Recreate updates policy for clients (was dropped in previous migration)
CREATE POLICY "Clients can view updates of their projects" ON public.updates
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = updates.project_id
        AND p.client_id = auth.uid()
    )
  );
