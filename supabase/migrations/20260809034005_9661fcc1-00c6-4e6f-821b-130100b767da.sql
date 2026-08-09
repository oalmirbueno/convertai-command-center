GRANT EXECUTE ON FUNCTION public.user_owns_project(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_owns_task(uuid, uuid) TO authenticated, service_role;