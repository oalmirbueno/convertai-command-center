
-- Allow clients to update approval_status and feedback on their own files
CREATE POLICY "Clients can update own files approval"
ON public.files
FOR UPDATE
USING (client_id = auth.uid())
WITH CHECK (client_id = auth.uid());

-- Allow clients to view tasks of their projects (for kanban read-only)
CREATE POLICY "Clients can view tasks of their projects"
ON public.tasks
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = tasks.project_id AND p.client_id = auth.uid()
  )
);
