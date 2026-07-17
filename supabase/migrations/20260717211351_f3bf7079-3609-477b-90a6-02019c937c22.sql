-- Migration: 20260717203622_papel_gerenciado_atomico
DROP POLICY IF EXISTS "user_roles_admin_delete" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_admin_insert" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_admin_update" ON public.user_roles;

REVOKE ALL ON TABLE public.user_roles FROM PUBLIC;
REVOKE ALL ON TABLE public.user_roles FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.user_roles FROM authenticated;
REVOKE ALL ON TABLE public.user_roles FROM service_role;

GRANT SELECT ON TABLE public.user_roles TO authenticated, service_role;
GRANT INSERT, DELETE ON TABLE public.user_roles TO service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.user_roles
    GROUP BY user_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'users with multiple roles found; audit public.user_roles before deployment'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_user_id_key UNIQUE (user_id);

CREATE OR REPLACE FUNCTION public.replace_managed_user_role(
  _actor_id uuid,
  _user_id uuid,
  _role public.app_role
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  _admin_count integer;
BEGIN
  IF _actor_id IS NULL OR _user_id IS NULL OR _role IS NULL THEN
    RAISE EXCEPTION 'actor, user and role are required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('aceleriq:managed-user-role')
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _actor_id
      AND role = 'admin'::public.app_role
  ) THEN
    RAISE EXCEPTION 'administrator role required'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.profiles
  WHERE id = _user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'managed user not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF _actor_id = _user_id
     AND _role <> 'admin'::public.app_role
  THEN
    RAISE EXCEPTION 'an administrator cannot demote their own account'
      USING ERRCODE = '42501';
  END IF;

  IF _role <> 'admin'::public.app_role
     AND EXISTS (
       SELECT 1
       FROM public.user_roles
       WHERE user_id = _user_id
         AND role = 'admin'::public.app_role
     )
  THEN
    SELECT count(*)::integer
    INTO _admin_count
    FROM public.user_roles
    WHERE role = 'admin'::public.app_role;

    IF _admin_count <= 1 THEN
      RAISE EXCEPTION 'the last administrator cannot be demoted'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  DELETE FROM public.user_roles
  WHERE user_id = _user_id;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (_user_id, _role);
END;
$$;

REVOKE ALL ON FUNCTION public.replace_managed_user_role(
  uuid,
  uuid,
  public.app_role
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.replace_managed_user_role(
  uuid,
  uuid,
  public.app_role
) TO service_role;