REVOKE SELECT ON TABLE public.profiles FROM PUBLIC, anon, authenticated;

GRANT SELECT (
  id,
  full_name,
  email,
  company_name,
  avatar_url,
  plan_renewal_date,
  plan_status,
  services_config,
  onboarding_done,
  created_at,
  updated_at,
  phone,
  plan_name,
  plan_value,
  client_type,
  brand,
  first_access_used_at,
  overdue_since,
  deleted_at
) ON public.profiles TO authenticated;

GRANT SELECT ON TABLE public.profiles TO service_role;
