
-- Allow team members to see projects where they have assigned tasks
DROP POLICY IF EXISTS "projects_select" ON public.projects;
CREATE POLICY "projects_select" ON public.projects
FOR SELECT TO authenticated
USING (
  client_id = auth.uid()
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'design'::app_role)
  OR has_role(auth.uid(), 'traffic'::app_role)
  OR has_role(auth.uid(), 'manager'::app_role)
);

-- Allow team members to see user roles (needed to list clients)
DROP POLICY IF EXISTS "user_roles_select" ON public.user_roles;
CREATE POLICY "user_roles_select" ON public.user_roles
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'design'::app_role)
  OR has_role(auth.uid(), 'traffic'::app_role)
  OR has_role(auth.uid(), 'manager'::app_role)
);
