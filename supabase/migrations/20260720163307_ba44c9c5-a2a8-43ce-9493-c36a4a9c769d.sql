-- Todo cadastro nasce como cliente. raw_user_meta_data é editável pelo usuário
-- e nunca pode participar de uma decisão de autorização.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, company_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      split_part(COALESCE(NEW.email, ''), '@', 1)
    ),
    NEW.raw_user_meta_data->>'company_name'
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'client'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.has_role(
  _user_id uuid,
  _role public.app_role
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN (
        'admin'::public.app_role,
        'design'::public.app_role,
        'traffic'::public.app_role,
        'manager'::public.app_role
      )
  )
$$;

REVOKE ALL ON FUNCTION public.handle_new_user()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.is_staff(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role)
  TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.is_staff(uuid)
  TO authenticated, service_role;