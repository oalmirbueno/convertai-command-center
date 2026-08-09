-- Regression: the ownership helper functions must never be executable by anon.
-- They are SECURITY DEFINER and are only called from authenticated policies.
BEGIN;

SELECT plan(6);

SELECT is(
  has_function_privilege('anon', 'public.user_owns_project(uuid, uuid)', 'EXECUTE'),
  false,
  'anon has no effective EXECUTE on user_owns_project'
);

SELECT is(
  has_function_privilege('anon', 'public.user_owns_task(uuid, uuid)', 'EXECUTE'),
  false,
  'anon has no effective EXECUTE on user_owns_task'
);

SELECT is(
  has_function_privilege('authenticated', 'public.user_owns_project(uuid, uuid)', 'EXECUTE'),
  true,
  'authenticated keeps EXECUTE on user_owns_project'
);

SELECT is(
  has_function_privilege('authenticated', 'public.user_owns_task(uuid, uuid)', 'EXECUTE'),
  true,
  'authenticated keeps EXECUTE on user_owns_task'
);

SELECT is(
  has_function_privilege('service_role', 'public.user_owns_project(uuid, uuid)', 'EXECUTE'),
  true,
  'service_role keeps EXECUTE on user_owns_project'
);

SELECT is(
  has_function_privilege('service_role', 'public.user_owns_task(uuid, uuid)', 'EXECUTE'),
  true,
  'service_role keeps EXECUTE on user_owns_task'
);

SELECT * FROM finish();

ROLLBACK;
