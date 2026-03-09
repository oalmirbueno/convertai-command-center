
-- Allow all team members to update any task
DROP POLICY IF EXISTS "tasks_update" ON public.tasks;
CREATE POLICY "tasks_update" ON public.tasks
FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'design'::app_role)
  OR has_role(auth.uid(), 'traffic'::app_role)
  OR has_role(auth.uid(), 'manager'::app_role)
  OR (assigned_to = auth.uid())
);
