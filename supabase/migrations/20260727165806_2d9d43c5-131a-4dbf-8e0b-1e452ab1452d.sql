GRANT SELECT, INSERT, UPDATE, DELETE ON public.files TO authenticated;
GRANT ALL ON public.files TO service_role;
REVOKE ALL ON public.files FROM anon;