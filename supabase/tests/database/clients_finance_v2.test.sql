BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(68);

SELECT has_table('public', 'finance_plan_catalog', 'plan catalog exists');
SELECT has_table('public', 'finance_plan_versions', 'plan versions exist');
SELECT has_table(
  'public',
  'finance_client_subscriptions',
  'subscriptions exist'
);
SELECT has_table('public', 'finance_settings', 'settings exist');
SELECT has_table('public', 'finance_fixed_costs', 'fixed costs exist');
SELECT has_table(
  'public',
  'finance_period_closures',
  'closures exist'
);
SELECT has_table('public', 'finance_audit_log', 'audit exists');

SELECT has_column(
  'public',
  'billing',
  'subscription_id',
  'billing subscription link'
);
SELECT has_column(
  'public',
  'billing',
  'plan_version_id',
  'billing version link'
);
SELECT has_column(
  'public',
  'billing',
  'billing_period_start',
  'billing competence'
);
SELECT has_column(
  'public',
  'expenses',
  'fixed_cost_id',
  'expense template link'
);
SELECT has_column(
  'public',
  'expenses',
  'expense_period_start',
  'expense competence'
);

SELECT col_type_is(
  'public',
  'finance_plan_versions',
  'monthly_price',
  'numeric(14,2)',
  'plan money exact'
);
SELECT col_type_is(
  'public',
  'finance_client_subscriptions',
  'agreed_monthly_amount',
  'numeric(14,2)',
  'subscription money exact'
);
SELECT col_type_is(
  'public',
  'finance_fixed_costs',
  'amount',
  'numeric(14,2)',
  'fixed cost money exact'
);
SELECT col_type_is(
  'public',
  'finance_settings',
  'monthly_revenue_goal',
  'numeric(14,2)',
  'goal money exact'
);

SELECT has_check(
  'public',
  'finance_client_subscriptions',
  'finance_client_subscriptions_review_ck',
  'review enum enforced'
);
SELECT has_index(
  'public',
  'billing',
  'billing_subscription_competence_uq',
  'billing idempotency index'
);
SELECT has_index(
  'public',
  'expenses',
  'expenses_fixed_cost_competence_uq',
  'expense idempotency index'
);
SELECT has_index(
  'public',
  'finance_client_subscriptions',
  'finance_client_subscriptions_one_open_uq',
  'one open subscription'
);

SELECT ok(
  (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.finance_plan_catalog'::regclass
  ),
  'catalog RLS'
);
SELECT ok(
  (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.finance_plan_versions'::regclass
  ),
  'versions RLS'
);
SELECT ok(
  (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.finance_client_subscriptions'::regclass
  ),
  'subscriptions RLS'
);
SELECT ok(
  (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.finance_settings'::regclass
  ),
  'settings RLS'
);
SELECT ok(
  (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.finance_fixed_costs'::regclass
  ),
  'fixed cost RLS'
);
SELECT ok(
  (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.finance_period_closures'::regclass
  ),
  'closures RLS'
);
SELECT ok(
  (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.finance_audit_log'::regclass
  ),
  'audit RLS'
);

SELECT has_function(
  'public',
  'finance_upsert_plan',
  ARRAY['text', 'text', 'text', 'boolean', 'integer'],
  'upsert plan RPC'
);
SELECT has_function(
  'public',
  'finance_publish_plan_version',
  ARRAY['uuid', 'numeric', 'date', 'numeric', 'text', 'text', 'jsonb'],
  'publish version RPC'
);
SELECT has_function(
  'public',
  'finance_set_client_subscription',
  ARRAY['uuid', 'uuid', 'date', 'numeric', 'smallint', 'date', 'text'],
  'subscription RPC'
);
SELECT has_function(
  'public',
  'finance_review_subscription',
  ARRAY['uuid', 'numeric', 'date', 'text'],
  'review RPC'
);
SELECT has_function(
  'public',
  'finance_issue_subscription_billing',
  ARRAY['uuid', 'date', 'date', 'text'],
  'issue billing RPC'
);
SELECT has_function(
  'public',
  'finance_generate_monthly_billing',
  ARRAY['date'],
  'monthly generator RPC'
);
SELECT has_function(
  'public',
  'finance_upsert_fixed_cost',
  ARRAY[
    'text', 'numeric', 'text', 'smallint', 'uuid', 'text', 'text',
    'date', 'date', 'boolean', 'text', 'text', 'text', 'text'
  ],
  'fixed cost RPC'
);
SELECT has_function(
  'public',
  'finance_archive_fixed_cost',
  ARRAY['uuid', 'text'],
  'archive RPC'
);
SELECT has_function(
  'public',
  'finance_update_settings',
  ARRAY[
    'text', 'smallint', 'numeric', 'text', 'boolean', 'text',
    'numeric', 'numeric', 'numeric', 'numeric', 'numeric'
  ],
  'settings RPC'
);
SELECT has_function(
  'public',
  'finance_get_period_snapshot',
  ARRAY['date', 'date'],
  'snapshot RPC'
);
SELECT has_function(
  'public',
  'finance_get_dashboard',
  ARRAY['date', 'date'],
  'dashboard RPC'
);
SELECT has_function(
  'public',
  'finance_close_period',
  ARRAY['date', 'text'],
  'close RPC'
);
SELECT has_function(
  'public',
  'finance_reopen_period',
  ARRAY['date', 'text'],
  'reopen RPC'
);
SELECT has_function(
  'public',
  'finance_received_amount',
  ARRAY['text', 'numeric', 'numeric'],
  'received helper'
);

SELECT is(
  public.finance_received_amount('pending', 100, 0),
  0::numeric,
  'unpaid is zero'
);
SELECT is(
  public.finance_received_amount('paid', 100, 0),
  100::numeric,
  'legacy paid zero means full'
);
SELECT is(
  public.finance_received_amount('partial', 100, 40),
  40::numeric,
  'partial uses paid amount'
);
SELECT is(
  public.finance_received_amount('paid', 100, 140),
  100::numeric,
  'received is capped'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM public.finance_fixed_costs
    WHERE id IN (
      '00000000-0000-4000-8000-000000000211',
      '00000000-0000-4000-8000-000000000212'
    )
  ),
  2::bigint,
  'two planning defaults'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.finance_plan_catalog
    WHERE code = 'personalizado'
  ),
  'personalized legacy plan'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.billing
    WHERE subscription_id IS NOT NULL
  ),
  'legacy import creates no billing'
);

SELECT ok(
  NOT has_table_privilege(
    'authenticated',
    'public.finance_plan_catalog',
    'INSERT'
  ),
  'no direct catalog write'
);
SELECT ok(
  has_table_privilege(
    'authenticated',
    'public.finance_plan_catalog',
    'SELECT'
  ),
  'catalog Data API select'
);
SELECT ok(
  NOT has_table_privilege(
    'authenticated',
    'public.finance_fixed_costs',
    'UPDATE'
  ),
  'no direct fixed cost write'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.finance_get_dashboard(date,date)',
    'EXECUTE'
  ),
  'dashboard executable by authenticated then role-checked'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.finance_generate_monthly_billing(date)',
    'EXECUTE'
  ),
  'generator executable then admin-checked'
);
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.finance_get_dashboard(date,date)',
    'EXECUTE'
  ),
  'anon dashboard denied'
);
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.finance_generate_monthly_billing(date)',
    'EXECUTE'
  ),
  'anon generator denied'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.billing'::regclass
      AND tgname = 'finance_audit_row'
      AND NOT tgisinternal
  ),
  'billing audited'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.billing'::regclass
      AND tgname = 'finance_closed_period_guard'
      AND NOT tgisinternal
  ),
  'billing closure guard'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.expenses'::regclass
      AND tgname = 'finance_closed_period_guard'
      AND NOT tgisinternal
  ),
  'expense closure guard'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.profiles'::regclass
      AND tgname = 'finance_profile_plan_audit'
      AND NOT tgisinternal
  ),
  'profile plan audited'
);
SELECT is(
  (
    SELECT provolatile::text
    FROM pg_proc
    WHERE oid =
      'public.finance_generate_monthly_billing(date)'::regprocedure
  ),
  'v',
  'generator is volatile'
);

INSERT INTO auth.users(id, email)
VALUES
  (
    'f2000000-0000-4000-8000-000000000001',
    'finance-admin@test.local'
  ),
  (
    'f2000000-0000-4000-8000-000000000002',
    'finance-client@test.local'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles(
  id,
  full_name,
  email,
  client_type
)
VALUES
  (
    'f2000000-0000-4000-8000-000000000001',
    'Finance Admin Test',
    'finance-admin@test.local',
    'recurring'
  ),
  (
    'f2000000-0000-4000-8000-000000000002',
    'Finance Client Test',
    'finance-client@test.local',
    'recurring'
  )
ON CONFLICT (id) DO UPDATE
SET full_name = EXCLUDED.full_name;

INSERT INTO public.user_roles(user_id, role)
VALUES (
  'f2000000-0000-4000-8000-000000000001',
  'admin'
)
ON CONFLICT DO NOTHING;

SELECT set_config(
  'request.jwt.claim.sub',
  'f2000000-0000-4000-8000-000000000001',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"f2000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

CREATE TEMP TABLE finance_test_ids(
  kind text PRIMARY KEY,
  id uuid
);

INSERT INTO finance_test_ids
VALUES (
  'plan',
  public.finance_upsert_plan(
    'pgtap-monthly',
    'PgTAP Monthly',
    NULL,
    true,
    1
  )
);

INSERT INTO finance_test_ids
SELECT
  'version',
  public.finance_publish_plan_version(
    id,
    123.45,
    CURRENT_DATE,
    0,
    'BRL',
    'monthly',
    '{}'::jsonb
  )
FROM finance_test_ids
WHERE kind = 'plan';

INSERT INTO finance_test_ids
SELECT
  'subscription',
  public.finance_set_client_subscription(
    'f2000000-0000-4000-8000-000000000002',
    id,
    CURRENT_DATE,
    NULL,
    10,
    CURRENT_DATE,
    'pgTAP generator'
  )
FROM finance_test_ids
WHERE kind = 'version';

CREATE TEMP TABLE finance_test_generation(
  sequence_number integer,
  result jsonb
);

INSERT INTO finance_test_generation
VALUES (
  1,
  public.finance_generate_monthly_billing(CURRENT_DATE)
);

SELECT is(
  (
    SELECT (result ->> 'generated_count')::integer
    FROM finance_test_generation
    WHERE sequence_number = 1
  ),
  1,
  'generator creates one current invoice'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.billing AS billing
    JOIN finance_test_ids AS fixture
      ON fixture.kind = 'subscription'
      AND fixture.id = billing.subscription_id
  ),
  1,
  'one invoice exists'
);
SELECT ok(
  (
    SELECT subscription.next_billing_date > CURRENT_DATE
    FROM public.finance_client_subscriptions AS subscription
    JOIN finance_test_ids AS fixture
      ON fixture.kind = 'subscription'
      AND fixture.id = subscription.id
  ),
  'generator advances renewal'
);

UPDATE public.finance_client_subscriptions
SET next_billing_date = CURRENT_DATE
WHERE id = (
  SELECT id
  FROM finance_test_ids
  WHERE kind = 'subscription'
);

INSERT INTO finance_test_generation
VALUES (
  2,
  public.finance_generate_monthly_billing(CURRENT_DATE)
);

SELECT is(
  (
    SELECT (result ->> 'existing_count')::integer
    FROM finance_test_generation
    WHERE sequence_number = 2
  ),
  1,
  'rerun detects existing invoice'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.billing AS billing
    JOIN finance_test_ids AS fixture
      ON fixture.kind = 'subscription'
      AND fixture.id = billing.subscription_id
  ),
  1,
  'rerun does not duplicate'
);
SELECT is(
  (
    SELECT jsonb_array_length(result -> 'billing_ids')
    FROM finance_test_generation
    WHERE sequence_number = 2
  ),
  1,
  'rerun returns existing id'
);

SELECT set_config(
  'request.jwt.claim.sub',
  'f2000000-0000-4000-8000-000000000002',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"f2000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

SELECT throws_ok(
  'SELECT public.finance_generate_monthly_billing(CURRENT_DATE)',
  '42501',
  'finance admin permission required',
  'client cannot generate billing'
);
SELECT ok(
  (
    SELECT plan_renewal_date > CURRENT_DATE
    FROM public.profiles
    WHERE id = 'f2000000-0000-4000-8000-000000000002'
  ),
  'profile renewal mirror advances'
);

SELECT * FROM finish();
ROLLBACK;
