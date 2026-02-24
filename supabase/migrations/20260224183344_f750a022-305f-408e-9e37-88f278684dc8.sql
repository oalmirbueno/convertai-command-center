
-- Allow admin to delete profiles (needed for team member removal)
CREATE POLICY "profiles_admin_delete"
ON public.profiles
FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));

-- Allow admin to delete user_roles
CREATE POLICY "user_roles_admin_delete"
ON public.user_roles
FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));

-- Allow admin to insert user_roles
CREATE POLICY "user_roles_admin_insert"
ON public.user_roles
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Allow admin to update user_roles
CREATE POLICY "user_roles_admin_update"
ON public.user_roles
FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role));
