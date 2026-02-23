
-- Allow admins to update profiles
DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
CREATE POLICY "profiles_update" ON public.profiles FOR UPDATE
USING (auth.uid() = id OR has_role(auth.uid(), 'admin'::app_role));

-- Allow admins to update client_requests
CREATE POLICY "client_requests_update" ON public.client_requests FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role) OR client_id = auth.uid());
