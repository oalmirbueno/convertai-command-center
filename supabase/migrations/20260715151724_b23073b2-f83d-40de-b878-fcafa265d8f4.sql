DROP POLICY IF EXISTS files_admin_delete ON public.files;
DROP POLICY IF EXISTS "Admins can do anything with files" ON public.files;
DROP POLICY IF EXISTS files_staff_delete ON public.files;

CREATE POLICY files_staff_delete
ON public.files
FOR DELETE
TO authenticated
USING (public.is_staff(auth.uid()));