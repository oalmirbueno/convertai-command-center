-- ============================================================================
-- Aceleriq OS - Financeiro V2 foundation contract
-- pgTAP suite. Runs inside BEGIN/ROLLBACK and never persists fixture data.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT * FROM no_plan();

-- Legacy outbound sync must stay silent while auth fixtures create profiles.
ALTER TABLE public.profiles DISABLE TRIGGER USER;

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', _uid::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text,
    true
  );
  EXECUTE 'SET LOCAL ROLE authenticated';
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.act_as_anon() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  EXECUTE 'SET LOCAL ROLE anon';
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.act_as_owner() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{}', true);
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.statement_fails(_sql text)
RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  _message text;
  _state text;
BEGIN
  BEGIN
    EXECUTE _sql;
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = '__financial_test_statement_succeeded__';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      _message = MESSAGE_TEXT,
      _state = RETURNED_SQLSTATE;
    RETURN NOT (
      _state = 'P0001'
      AND _message = '__financial_test_statement_succeeded__'
    );
  END;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.public_has_execute(_fn regprocedure)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure_row
    CROSS JOIN LATERAL aclexplode(
      COALESCE(procedure_row.proacl, acldefault('f', procedure_row.proowner))
    ) AS acl
    WHERE procedure_row.oid = _fn::oid
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  )
$$;

-- ---------------------------------------------------------------------------
-- 1. Structure, RLS, grants, seeds and conservative migration boundary.
-- ---------------------------------------------------------------------------
SELECT ok(
  (
    SELECT count(*) = 8
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace_row ON namespace_row.oid = relation.relnamespace
    WHERE namespace_row.nspname = 'public'
      AND relation.relkind = 'r'
      AND relation.relname IN (
        'financial_plans',
        'financial_plan_versions',
        'financial_client_terms',
        'financial_recurring_rules',
        'financial_entries',
        'financial_settlements',
        'financial_settings',
        'financial_period_closures'
      )
  ),
  'all eight public Financeiro V2 tables exist'
);

SELECT ok(
  to_regclass('app_private.financial_audit_log') IS NOT NULL,
  'private financial audit ledger exists'
);

SELECT ok(
  (
    SELECT bool_and(relation.relrowsecurity)
    FROM pg_class AS relation
    WHERE relation.oid IN (
      'public.financial_plans'::regclass,
      'public.financial_plan_versions'::regclass,
      'public.financial_client_terms'::regclass,
      'public.financial_recurring_rules'::regclass,
      'public.financial_entries'::regclass,
      'public.financial_settlements'::regclass,
      'public.financial_settings'::regclass,
      'public.financial_period_closures'::regclass
    )
  ),
  'RLS is enabled on every public Financeiro V2 table'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename LIKE 'financial_%'
      AND cmd <> 'SELECT'
  ),
  0,
  'no authenticated direct-write RLS policy exists'
);

SELECT ok(
  (
    SELECT bool_and(
      has_table_privilege(
        'authenticated', format('public.%I', table_name), 'SELECT'
      )
      AND NOT has_table_privilege(
        'authenticated', format('public.%I', table_name), 'INSERT'
      )
      AND NOT has_table_privilege(
        'authenticated', format('public.%I', table_name), 'UPDATE'
      )
      AND NOT has_table_privilege(
        'authenticated', format('public.%I', table_name), 'DELETE'
      )
      AND NOT has_table_privilege(
        'authenticated', format('public.%I', table_name), 'TRUNCATE'
      )
    )
    FROM (
      VALUES
        ('financial_plans'),
        ('financial_plan_versions'),
        ('financial_client_terms'),
        ('financial_recurring_rules'),
        ('financial_entries'),
        ('financial_settlements'),
        ('financial_settings'),
        ('financial_period_closures')
    ) AS finance_tables(table_name)
  ),
  'authenticated has SELECT-only table grants'
);

SELECT ok(
  (
    SELECT bool_and(
      NOT has_table_privilege('anon', format('public.%I', table_name), 'SELECT')
      AND NOT has_table_privilege('anon', format('public.%I', table_name), 'INSERT')
      AND NOT has_table_privilege('anon', format('public.%I', table_name), 'UPDATE')
      AND NOT has_table_privilege('anon', format('public.%I', table_name), 'DELETE')
    )
    FROM (
      VALUES
        ('financial_plans'),
        ('financial_plan_versions'),
        ('financial_client_terms'),
        ('financial_recurring_rules'),
        ('financial_entries'),
        ('financial_settlements'),
        ('financial_settings'),
        ('financial_period_closures')
    ) AS finance_tables(table_name)
  ),
  'anon has no Financeiro V2 table grants'
);

SELECT is(
  has_table_privilege(
    'authenticated', 'app_private.financial_audit_log', 'SELECT'
  ),
  false,
  'authenticated cannot inspect the private audit ledger'
);

SELECT is(
  pg_temp.public_has_execute(
    'public.financial_generate_competence(date)'::regprocedure
  ),
  false,
  'PUBLIC cannot execute competence generation'
);

SELECT is(
  has_function_privilege(
    'anon', 'public.financial_record_settlement(uuid,numeric,date,text,text,text)', 'EXECUTE'
  ),
  false,
  'anon cannot execute settlement recording'
);

SELECT is(
  has_function_privilege(
    'authenticated', 'public.financial_generate_competence(date)', 'EXECUTE'
  ),
  true,
  'authenticated can reach the role-guarded competence RPC'
);

SELECT is(
  pg_temp.public_has_execute(
    'public.financial_cash_flow_v2(text,date)'::regprocedure
  ),
  false,
  'PUBLIC cannot execute the cash-flow RPC'
);

SELECT is(
  has_function_privilege(
    'authenticated', 'public.financial_cash_flow_v2(text,date)', 'EXECUTE'
  ),
  true,
  'authenticated can execute the RLS-invoker cash-flow RPC'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.financial_settlements'::regclass
      AND tgname = 'financial_settlements_append_only'
      AND NOT tgisinternal
  ),
  'settlements have an append-only guard trigger'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.financial_entries'::regclass
      AND tgname = 'financial_entries_append_only'
      AND NOT tgisinternal
  )
  AND EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.financial_plan_versions'::regclass
      AND tgname = 'financial_plan_versions_immutable'
      AND NOT tgisinternal
  ),
  'entries and plan versions have immutable-history guards'
);

SELECT ok(
  pg_get_function_result('public.financial_client_summaries_v2()'::regprocedure)
    LIKE '%final_plan_amount%',
  'client summaries expose the monthlyized final plan amount'
);

SELECT ok(
  pg_get_functiondef(
    'public.financial_record_settlement(uuid,numeric,date,text,text,text)'::regprocedure
  ) LIKE '%pg_advisory_xact_lock%',
  'settlement retries serialize on the idempotency key'
);

SELECT ok(
  pg_get_functiondef(
    'app_private.financial_lock_open_period(date)'::regprocedure
  ) LIKE '%INSERT INTO public.financial_period_closures%'
  AND pg_get_functiondef(
    'app_private.financial_lock_open_period(date)'::regprocedure
  ) LIKE '%FOR UPDATE%'
  AND pg_get_functiondef(
    'app_private.financial_lock_open_period(date)'::regprocedure
  ) NOT LIKE '%period_status = ''closed''%',
  'period mutations materialize and lock the competence row before checking its status'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'financial_entries'
      AND indexname = 'financial_entries_term_competence_idx'
      AND indexdef LIKE '%UNIQUE%'
  )
  AND EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'financial_entries'
      AND indexname = 'financial_entries_client_competence_idx'
      AND indexdef LIKE '%UNIQUE%'
  )
  AND EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'financial_entries'
      AND indexname = 'financial_entries_rule_competence_idx'
      AND indexdef LIKE '%UNIQUE%'
  ),
  'term, client and recurring-rule competence uniqueness is enforced'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.financial_settings
    WHERE settings_key = 'default'
      AND currency = 'BRL'
      AND timezone = 'America/Sao_Paulo'
      AND current_pro_labore = 3000
      AND target_pro_labore = 10000
      AND tools_systems_cost = 2500
      AND default_direct_cost = 275
      AND owner_profit_share = 1
  ),
  1,
  'safe default settings are seeded once'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.financial_recurring_rules
    WHERE stable_code IN ('tools-systems', 'pro-labore-almir')
      AND is_active
  ),
  2,
  'tools and current pro-labore rules are seeded without the target pro-labore'
);

SELECT is(
  (
    SELECT sum(amount)::numeric
    FROM public.financial_recurring_rules
    WHERE stable_code IN ('tools-systems', 'pro-labore-almir')
  ),
  5500::numeric,
  'seeded recurring references total R$ 5,500'
);

SELECT is(
  (SELECT count(*)::integer FROM public.financial_entries),
  0,
  'migration does not invent historical entries or charges'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.financial_settlements
  ),
  0,
  'migration does not infer historical settlements'
);

SELECT is(
  public.financial_gross_up(1000, 0.14),
  1162.79::numeric,
  'gross-up uses operational / (1 - tax rate)'
);

-- ---------------------------------------------------------------------------
-- 2. Fixtures and guarded RPC behavior.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email)
VALUES
  ('f1000000-0000-0000-0000-000000000001', 'finance-admin@test.local'),
  ('f1000000-0000-0000-0000-00000000000a', 'finance-client-a@test.local'),
  ('f1000000-0000-0000-0000-00000000000b', 'finance-client-b@test.local'),
  ('f1000000-0000-0000-0000-00000000000f', 'finance-client-c@test.local'),
  ('f1000000-0000-0000-0000-00000000000c', 'finance-manager@test.local'),
  ('f1000000-0000-0000-0000-00000000000d', 'finance-design@test.local'),
  ('f1000000-0000-0000-0000-00000000000e', 'finance-traffic@test.local');

UPDATE public.profiles AS profile_row
SET full_name = fixture.full_name,
    company_name = fixture.company_name,
    plan_status = 'active',
    onboarding_done = true,
    sync_status = 'synced',
    client_type = 'recurring'
FROM (
  VALUES
    ('f1000000-0000-0000-0000-000000000001'::uuid, 'Finance Admin', 'Aceleriq'),
    ('f1000000-0000-0000-0000-00000000000a'::uuid, 'Finance Client A', 'Client A'),
    ('f1000000-0000-0000-0000-00000000000b'::uuid, 'Finance Client B', 'Client B'),
    ('f1000000-0000-0000-0000-00000000000f'::uuid, 'Finance Client C', 'Client C'),
    ('f1000000-0000-0000-0000-00000000000c'::uuid, 'Finance Manager', 'Aceleriq'),
    ('f1000000-0000-0000-0000-00000000000d'::uuid, 'Finance Design', 'Aceleriq'),
    ('f1000000-0000-0000-0000-00000000000e'::uuid, 'Finance Traffic', 'Aceleriq')
) AS fixture(id, full_name, company_name)
WHERE profile_row.id = fixture.id;

DELETE FROM public.user_roles
WHERE user_id IN (
  'f1000000-0000-0000-0000-000000000001',
  'f1000000-0000-0000-0000-00000000000c',
  'f1000000-0000-0000-0000-00000000000d',
  'f1000000-0000-0000-0000-00000000000e'
);
INSERT INTO public.user_roles (user_id, role)
VALUES
  ('f1000000-0000-0000-0000-000000000001', 'admin'),
  ('f1000000-0000-0000-0000-00000000000c', 'manager'),
  ('f1000000-0000-0000-0000-00000000000d', 'design'),
  ('f1000000-0000-0000-0000-00000000000e', 'traffic');

CREATE TEMP TABLE financial_test_state (
  key text PRIMARY KEY,
  value uuid NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE financial_test_metrics (
  key text PRIMARY KEY,
  value numeric NOT NULL
) ON COMMIT DROP;

SELECT pg_temp.act_as('f1000000-0000-0000-0000-00000000000a');

SELECT ok(
  pg_temp.statement_fails(
    $$SELECT public.financial_upsert_plan(
      NULL, 'Client cannot create', 'client-denied', NULL, true
    )$$
  ),
  'non-admin cannot mutate plans through an RPC'
);

SELECT pg_temp.act_as('f1000000-0000-0000-0000-000000000001');

INSERT INTO financial_test_state (key, value)
SELECT 'plan', (public.financial_upsert_plan(
  NULL,
  'Finance Test Plan',
  'finance-test-plan',
  'Fixture plan',
  true
)->>'id')::uuid;

INSERT INTO financial_test_state (key, value)
SELECT 'version', (public.financial_create_plan_version(
  (SELECT value FROM financial_test_state WHERE key = 'plan'),
  1000,
  date_trunc('month', CURRENT_DATE)::date,
  '14 percent gross-up fixture',
  0.14,
  275,
  false,
  'monthly',
  0
)->>'id')::uuid;

INSERT INTO financial_test_state (key, value)
SELECT 'term_a', (public.financial_assign_client_plan(
  'f1000000-0000-0000-0000-00000000000a',
  (SELECT value FROM financial_test_state WHERE key = 'version'),
  date_trunc('month', CURRENT_DATE)::date,
  'linked', NULL, NULL, NULL, 10, NULL, NULL
)->>'id')::uuid;

INSERT INTO financial_test_state (key, value)
SELECT 'term_b', (public.financial_assign_client_plan(
  'f1000000-0000-0000-0000-00000000000b',
  (SELECT value FROM financial_test_state WHERE key = 'version'),
  date_trunc('month', CURRENT_DATE)::date,
  'linked', NULL, NULL, NULL, 10, NULL, NULL
)->>'id')::uuid;

SELECT ok(
  pg_temp.statement_fails(format(
    'SELECT public.financial_create_plan_version(%L::uuid, 1100, %L::date, NULL, 0.14, 275, false, %L, 0)',
    (SELECT value FROM financial_test_state WHERE key = 'plan'),
    (date_trunc('month', CURRENT_DATE)::date + 1)::text,
    'monthly'
  )),
  'plan versions reject ambiguous mid-competence effective dates'
);

INSERT INTO financial_test_state (key, value)
SELECT 'future_version', (public.financial_create_plan_version(
  (SELECT value FROM financial_test_state WHERE key = 'plan'),
  1200,
  (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month')::date,
  'future competence fixture',
  0.14,
  300,
  false,
  'monthly',
  0
)->>'id')::uuid;

SELECT ok(
  (
    SELECT is_active
      AND valid_to = (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date
    FROM public.financial_plan_versions
    WHERE id = (SELECT value FROM financial_test_state WHERE key = 'version')
  ),
  'scheduling a future version preserves the currently effective version'
);

SELECT ok(
  pg_temp.statement_fails(format(
    'SELECT public.financial_assign_client_plan(%L::uuid, %L::uuid, %L::date)',
    'f1000000-0000-0000-0000-00000000000f',
    (SELECT value FROM financial_test_state WHERE key = 'future_version'),
    date_trunc('month', CURRENT_DATE)::date
  )),
  'a future version cannot be assigned before its valid competence'
);

INSERT INTO financial_test_state (key, value)
SELECT 'term_b_future', (public.financial_assign_client_plan(
  'f1000000-0000-0000-0000-00000000000b',
  (SELECT value FROM financial_test_state WHERE key = 'future_version'),
  (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month')::date,
  'linked', NULL, NULL, NULL, 10, NULL, NULL
)->>'id')::uuid;

SELECT is(
  (
    SELECT upcoming_starts_on
    FROM public.financial_client_summaries_v2()
    WHERE client_id = 'f1000000-0000-0000-0000-00000000000b'
  ),
  (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month')::date,
  'client summary exposes the next scheduled term without replacing the current one'
);

SELECT is(
  (
    SELECT final_amount
    FROM public.financial_client_terms
    WHERE id = (SELECT value FROM financial_test_state WHERE key = 'term_a')
  ),
  1162.79::numeric,
  'assigned term freezes the grossed-up final amount'
);

SELECT is(
  (public.financial_generate_competence(CURRENT_DATE)->>'generated_count')::integer,
  4,
  'first competence generation creates two client entries and two fixed rules'
);

SELECT is(
  (public.financial_generate_competence(CURRENT_DATE)->>'generated_count')::integer,
  0,
  'replaying competence generation is idempotent'
);

SELECT is(
  (SELECT count(*)::integer FROM public.financial_entries),
  4,
  'idempotent replay keeps exactly four generated entries'
);

SELECT ok(
  pg_temp.statement_fails(format(
    'SELECT public.financial_assign_client_plan(%L::uuid, %L::uuid, %L::date)',
    'f1000000-0000-0000-0000-00000000000a',
    (SELECT value FROM financial_test_state WHERE key = 'version'),
    date_trunc('month', CURRENT_DATE)::date
  )),
  'a materialized client competence cannot be rebound to another contractual term'
);

SELECT is(
  (
    SELECT count(DISTINCT idempotency_key)::integer
    FROM public.financial_entries
  ),
  4,
  'every generated entry has a unique idempotency key'
);

INSERT INTO financial_test_state (key, value)
SELECT 'entry_a', id
FROM public.financial_entries
WHERE term_id = (SELECT value FROM financial_test_state WHERE key = 'term_a');

INSERT INTO financial_test_state (key, value)
SELECT 'entry_b', id
FROM public.financial_entries
WHERE term_id = (SELECT value FROM financial_test_state WHERE key = 'term_b');

INSERT INTO financial_test_state (key, value)
SELECT 'settlement_a', (public.financial_record_settlement(
  (SELECT value FROM financial_test_state WHERE key = 'entry_a'),
  500,
  CURRENT_DATE,
  'pix',
  'partial fixture',
  'financial-test-settlement-a'
)->>'id')::uuid;

SELECT is(
  (
    SELECT tax_reserve_amount
    FROM public.financial_settlements
    WHERE id = (SELECT value FROM financial_test_state WHERE key = 'settlement_a')
  ),
  70.00::numeric,
  'partial receipt reserves tax proportionally to the frozen snapshot'
);

SELECT is(
  (
    public.financial_record_settlement(
      (SELECT value FROM financial_test_state WHERE key = 'entry_a'),
      500,
      CURRENT_DATE,
      'pix',
      'partial fixture',
      'financial-test-settlement-a'
    )->>'idempotent_replay'
  )::boolean,
  true,
  'settlement replay returns the existing settlement'
);

SELECT ok(
  pg_temp.statement_fails(format(
    'SELECT public.financial_record_settlement(%L::uuid, 500, CURRENT_DATE, %L, %L, %L)',
    (SELECT value FROM financial_test_state WHERE key = 'entry_a'),
    'pix',
    'different payload',
    'financial-test-settlement-a'
  )),
  'an idempotency key cannot be reused with a divergent payload'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.financial_settlements
    WHERE entry_id = (SELECT value FROM financial_test_state WHERE key = 'entry_a')
      AND kind = 'payment'
  ),
  1,
  'settlement replay never duplicates cash'
);

SELECT ok(
  pg_temp.statement_fails(format(
    'SELECT public.financial_record_settlement(%L::uuid, 1000, CURRENT_DATE, NULL, NULL, %L)',
    (SELECT value FROM financial_test_state WHERE key = 'entry_a'),
    'financial-test-overpayment'
  )),
  'settlement cannot exceed the outstanding amount'
);

SELECT is(
  (
    public.financial_reverse_settlement(
      (SELECT value FROM financial_test_state WHERE key = 'settlement_a'),
      'fixture reversal'
    )->>'kind'
  ),
  'reversal',
  'settlement reversal appends a reversing fact'
);

SELECT is(
  (
    public.financial_reverse_settlement(
      (SELECT value FROM financial_test_state WHERE key = 'settlement_a'),
      'fixture replay'
    )->>'idempotent_replay'
  )::boolean,
  true,
  'settlement reversal is idempotent'
);

SELECT is(
  (
    SELECT COALESCE(SUM(
      CASE WHEN kind = 'payment' THEN amount ELSE -amount END
    ), 0)
    FROM public.financial_settlements
    WHERE entry_id = (SELECT value FROM financial_test_state WHERE key = 'entry_a')
  ),
  0::numeric,
  'payment plus reversal nets to zero without deleting history'
);

SELECT pg_temp.act_as_owner();

SELECT ok(
  pg_temp.statement_fails(format(
    'UPDATE public.financial_entries SET description = %L WHERE id = %L::uuid',
    'rewritten fact',
    (SELECT value FROM financial_test_state WHERE key = 'entry_b')
  )),
  'an entry cannot be rewritten in place'
);

SELECT ok(
  pg_temp.statement_fails(format(
    'DELETE FROM public.financial_entries WHERE id = %L::uuid',
    (SELECT value FROM financial_test_state WHERE key = 'entry_b')
  )),
  'an entry cannot be hard-deleted'
);

SELECT ok(
  pg_temp.statement_fails(format(
    'DELETE FROM public.financial_plan_versions WHERE id = %L::uuid',
    (SELECT value FROM financial_test_state WHERE key = 'future_version')
  )),
  'a plan version cannot be hard-deleted'
);

WITH inserted_entry AS (
  INSERT INTO public.financial_entries (
    direction, kind, competence, due_date, operational_amount, amount,
    description, idempotency_key
  ) VALUES (
    'income', 'one_off',
    (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month')::date,
    (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month' + INTERVAL '9 days')::date,
    50, 50, 'Prior competence receivable', 'financial-test-prior-entry'
  )
  RETURNING id
)
INSERT INTO financial_test_state (key, value)
SELECT 'prior_entry', id FROM inserted_entry;

SELECT pg_temp.act_as('f1000000-0000-0000-0000-000000000001');

SELECT is(
  (
    public.financial_close_period(
      (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month')::date,
      'pgTAP prior close gate'
    )->>'period_status'
  ),
  'closed',
  'admin can close a prior accrual competence'
);

INSERT INTO financial_test_state (key, value)
SELECT 'prior_settlement', (public.financial_record_settlement(
  (SELECT value FROM financial_test_state WHERE key = 'prior_entry'),
  50,
  CURRENT_DATE,
  'pix',
  'late receipt in open cash month',
  'financial-test-prior-settlement'
)->>'id')::uuid;

SELECT ok(
  (SELECT value IS NOT NULL FROM financial_test_state WHERE key = 'prior_settlement'),
  'an obligation from a closed competence can be received in an open cash month'
);

SELECT ok(
  pg_temp.statement_fails(format(
    'SELECT public.financial_record_settlement(%L::uuid, 10, %L::date, NULL, NULL, %L)',
    (SELECT value FROM financial_test_state WHERE key = 'entry_b'),
    (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month')::date,
    'financial-test-backdated-closed-cash'
  )),
  'a settlement backdated into a closed cash month is rejected'
);

SELECT pg_temp.act_as_owner();
ALTER TABLE public.financial_entries DISABLE TRIGGER financial_entries_append_only;
SELECT ok(
  pg_temp.statement_fails(format(
    'UPDATE public.financial_entries SET competence = %L::date WHERE id = %L::uuid',
    date_trunc('month', CURRENT_DATE)::date,
    (SELECT value FROM financial_test_state WHERE key = 'prior_entry')
  )),
  'entry period guard validates OLD and NEW competence on updates'
);
ALTER TABLE public.financial_entries ENABLE TRIGGER financial_entries_append_only;
SELECT pg_temp.act_as('f1000000-0000-0000-0000-000000000001');

SELECT is(
  (public.financial_close_period(CURRENT_DATE, 'pgTAP close gate')->>'period_status'),
  'closed',
  'admin can close the current cash competence with a reason'
);

SELECT ok(
  pg_temp.statement_fails(format(
    'SELECT public.financial_assign_client_plan(%L::uuid, %L::uuid, %L::date)',
    'f1000000-0000-0000-0000-00000000000f',
    (SELECT value FROM financial_test_state WHERE key = 'version'),
    date_trunc('month', CURRENT_DATE)::date
  )),
  'a closed competence rejects a new client plan assignment'
);

SELECT ok(
  pg_temp.statement_fails(format(
    'SELECT public.financial_record_settlement(%L::uuid, 100, CURRENT_DATE, NULL, NULL, %L)',
    (SELECT value FROM financial_test_state WHERE key = 'entry_b'),
    'financial-test-closed-period'
  )),
  'closed cash month rejects new settlements dated in that month'
);

SELECT ok(
  pg_temp.statement_fails('SELECT public.financial_generate_competence(CURRENT_DATE)'),
  'closed competence rejects generation replay'
);

SELECT is(
  (public.financial_reopen_period(CURRENT_DATE, 'pgTAP reopen gate')->>'period_status'),
  'open',
  'admin can reopen a period only with an audited reason'
);

SELECT lives_ok(
  format(
    'SELECT public.financial_record_settlement(%L::uuid, 100, CURRENT_DATE, NULL, NULL, %L)',
    (SELECT value FROM financial_test_state WHERE key = 'entry_b'),
    'financial-test-after-reopen'
  ),
  'reopened cash month accepts a new settlement'
);

SELECT is(
  (public.financial_overview_v2('forecast', CURRENT_DATE)->>'income')::numeric,
  1914.00::numeric,
  'forecast income deducts only the tax reserve still outstanding after a partial receipt'
);

SELECT is(
  (public.financial_cash_flow_v2('cash', CURRENT_DATE)->>'count')::integer,
  4,
  'cash flow is built from the four settlement facts dated in the selected month'
);

SELECT is(
  (public.financial_cash_flow_v2('cash', CURRENT_DATE)->>'net_total')::numeric,
  136.00::numeric,
  'cash flow returns signed net amounts after proportional tax reserve'
);

SELECT ok(
  (
    SELECT bool_and(NOT (item->>'can_settle')::boolean)
    FROM jsonb_array_elements(
      public.financial_cash_flow_v2('cash', CURRENT_DATE)->'items'
    ) item
  ),
  'settlement facts in cash mode are never settleable again'
);

SELECT is(
  (public.financial_cash_flow_v2('accrual', CURRENT_DATE)->>'count')::integer,
  4,
  'accrual cash-flow mode returns enriched entries for the selected competence'
);

SELECT is(
  (
    SELECT billing_status
    FROM public.financial_client_summaries_v2()
    WHERE client_id = 'f1000000-0000-0000-0000-00000000000f'
  ),
  'not_configured',
  'a client without plan or price remains visible as not configured'
);

SELECT is(
  (
    SELECT final_plan_amount
    FROM public.financial_client_summaries_v2()
    WHERE client_id = 'f1000000-0000-0000-0000-00000000000a'
  ),
  1162.79::numeric,
  'client summary exposes the monthlyized final plan amount'
);

SELECT lives_ok(
  $$SELECT public.financial_update_settings(
    'BRL', 1000, 2000, 10, 6,
    12345, 0.5, 2, 0.2,
    3200, 10000, 275, 'equal', false, 2600
  )$$,
  'settings accept explicit optional targets and synchronize current costs'
);

SELECT lives_ok(
  $$SELECT public.financial_update_settings(
    'BRL', 1000, 2000, 10, 6,
    NULL, NULL, NULL, NULL,
    3200, 10000, 275, 'equal', false, 2600
  )$$,
  'NULL clears optional settings without clearing required current costs'
);

SELECT ok(
  (
    SELECT monthly_goal IS NULL
      AND growth_retention_rate IS NULL
      AND minimum_reserve_months IS NULL
      AND desired_minimum_margin IS NULL
    FROM public.financial_settings
    WHERE settings_key = 'default'
  ),
  'nullable financial settings are explicitly clearable'
);

SELECT ok(
  (
    SELECT bool_and(
      (stable_code = 'pro-labore-almir' AND amount = 3200)
      OR (stable_code = 'tools-systems' AND amount = 2600)
    )
    FROM public.financial_recurring_rules
    WHERE stable_code IN ('pro-labore-almir', 'tools-systems')
  ),
  'settings updates synchronize the two stable recurring rules'
);

SELECT is(
  (
    public.financial_upsert_recurring_rule(
      (SELECT id FROM public.financial_recurring_rules WHERE stable_code = 'pro-labore-almir'),
      'Pró-labore Almir', 'reverse sync fixture', 'expense', 'pro_labore',
      3300, 'monthly', 10, date_trunc('month', CURRENT_DATE)::date,
      NULL, NULL, true
    )->>'amount'
  )::numeric,
  3300::numeric,
  'stable recurring rule can update its current amount'
);

SELECT is(
  (SELECT current_pro_labore FROM public.financial_settings WHERE settings_key = 'default'),
  3300::numeric,
  'stable recurring rule changes synchronize back to settings'
);

INSERT INTO financial_test_state (key, value)
SELECT 'future_archive_rule', (public.financial_upsert_recurring_rule(
  NULL, 'Future archive fixture', NULL, 'expense', 'other', 75,
  'monthly', NULL,
  (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month')::date,
  NULL, NULL, true
)->>'id')::uuid;

SELECT is(
  (
    SELECT due_day
    FROM public.financial_recurring_rules
    WHERE id = (SELECT value FROM financial_test_state WHERE key = 'future_archive_rule')
  ),
  10,
  'NULL due day is normalized to the safe day 10 default'
);

SELECT is(
  (public.financial_archive_recurring_rule(
    (SELECT value FROM financial_test_state WHERE key = 'future_archive_rule')
  )->>'is_active')::boolean,
  false,
  'a future recurring rule archives without violating its date range'
);

INSERT INTO financial_test_state (key, value)
SELECT 'bimonthly_rule', (public.financial_upsert_recurring_rule(
  NULL, 'Bimonthly forecast fixture', NULL, 'expense', 'forecast_fixture', 100,
  'bimonthly', 1,
  (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month')::date,
  NULL, NULL, true
)->>'id')::uuid;

INSERT INTO financial_test_metrics (key, value)
SELECT 'forecast_before_materialization',
  (public.financial_overview_v2('forecast', CURRENT_DATE)->>'forecast_90_days')::numeric;

SELECT is(
  (
    public.financial_cash_flow_v2(
      'forecast', (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month')::date
    )->>'count'
  )::integer,
  5,
  'forecast cash-flow exposes unmaterialized terms and recurring rules'
);

SELECT is(
  (
    public.financial_generate_competence(
      (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month')::date
    )->>'generated_count'
  )::integer,
  5,
  'future competence materializes two terms, two monthly rules and one bimonthly rule'
);

SELECT is(
  (public.financial_overview_v2('forecast', CURRENT_DATE)->>'forecast_90_days')::numeric,
  (SELECT value FROM financial_test_metrics WHERE key = 'forecast_before_materialization'),
  'forecast does not change when a virtual future occurrence is materialized'
);

SELECT is(
  (
    public.financial_cash_flow_v2(
      'forecast', (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month')::date
    )->>'count'
  )::integer,
  5,
  'forecast cash-flow replaces virtual occurrences with entries without duplication'
);

INSERT INTO financial_test_state (key, value)
SELECT 'future_tools_entry', entry_row.id
FROM public.financial_entries entry_row
JOIN public.financial_recurring_rules rule_row ON rule_row.id = entry_row.recurring_rule_id
WHERE rule_row.stable_code = 'tools-systems'
  AND entry_row.competence = (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month')::date;

SELECT is(
  (public.financial_cancel_entry(
    (SELECT value FROM financial_test_state WHERE key = 'future_tools_entry'),
    'pgTAP cancellation fixture'
  )->>'status'),
  'cancelled',
  'future materialized occurrence is cancelled through the audited RPC'
);

SELECT is(
  (public.financial_overview_v2('forecast', CURRENT_DATE)->>'forecast_90_days')::numeric,
  (SELECT value + 2600 FROM financial_test_metrics WHERE key = 'forecast_before_materialization'),
  'a cancelled source occurrence is removed and never reappears as a virtual duplicate'
);

-- ---------------------------------------------------------------------------
-- 3. Runtime RLS matrix for staff and clients.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('f1000000-0000-0000-0000-00000000000c');

SELECT is(
  (SELECT count(*)::integer FROM public.financial_entries),
  10,
  'manager can read the global financial ledger'
);

SELECT is(
  (SELECT count(*)::integer FROM public.financial_settings),
  1,
  'manager can read global financial settings'
);

SELECT ok(
  pg_temp.statement_fails(
    $$SELECT public.financial_upsert_plan(
      NULL, 'Manager cannot create', 'manager-denied', NULL, true
    )$$
  ),
  'manager cannot mutate financial data through admin RPCs'
);

SELECT pg_temp.act_as('f1000000-0000-0000-0000-00000000000d');

SELECT is(
  (SELECT count(*)::integer FROM public.financial_entries),
  0,
  'design has no global ledger visibility'
);

SELECT is(
  (SELECT count(*)::integer FROM public.financial_settings),
  0,
  'design has no financial settings visibility'
);

SELECT pg_temp.act_as('f1000000-0000-0000-0000-00000000000e');

SELECT is(
  (SELECT count(*)::integer FROM public.financial_entries),
  0,
  'traffic has no global ledger visibility'
);

SELECT pg_temp.act_as('f1000000-0000-0000-0000-00000000000a');

SELECT is(
  (SELECT count(*)::integer FROM public.financial_client_terms),
  0,
  'client cannot read internal financial terms'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.financial_entries
    WHERE direction = 'income'
  ),
  0,
  'client cannot read internal income entries'
);

SELECT is(
  (SELECT count(*)::integer FROM public.financial_entries WHERE direction = 'expense'),
  0,
  'client never sees global expenses'
);

SELECT is(
  (SELECT count(*)::integer FROM public.financial_settings),
  0,
  'client never sees global settings or owner targets'
);

SELECT is(
  (SELECT count(*)::integer FROM public.financial_entries_enriched),
  0,
  'client cannot inspect the enriched internal ledger view'
);

SELECT is(
  (SELECT count(*)::integer FROM public.financial_client_summaries_v2()),
  0,
  'client cannot execute internal summaries with visible rows'
);

SELECT ok(
  public.financial_cash_flow_v2('cash', CURRENT_DATE) IS NULL
    AND public.financial_overview_v2('cash', CURRENT_DATE) IS NULL,
  'client cannot retrieve internal cash-flow or overview payloads'
);

SELECT ok(
  pg_temp.statement_fails(
    $$INSERT INTO public.financial_entries (
      direction, kind, competence, due_date, amount, description, idempotency_key
    ) VALUES (
      'income', 'one_off', date_trunc('month', CURRENT_DATE)::date,
      CURRENT_DATE, 10, 'denied direct write', 'financial-test-direct-write'
    )$$
  ),
  'client cannot bypass RPCs with direct DML'
);

SELECT pg_temp.act_as_anon();

SELECT ok(
  pg_temp.statement_fails('SELECT count(*) FROM public.financial_entries'),
  'anon cannot read the financial ledger'
);

SELECT pg_temp.act_as('f1000000-0000-0000-0000-000000000001');

INSERT INTO financial_test_state (key, value)
SELECT 'setup_plan', (public.financial_upsert_plan(
  NULL, 'Setup Test Plan', 'setup-test-plan', 'One-time setup fixture', true
)->>'id')::uuid;

INSERT INTO financial_test_state (key, value)
SELECT 'setup_version', (public.financial_create_plan_version(
  (SELECT value FROM financial_test_state WHERE key = 'setup_plan'),
  1000, date_trunc('month', CURRENT_DATE)::date, 'Setup fixture',
  0.14, 275, false, 'monthly', 300
)->>'id')::uuid;

INSERT INTO financial_test_state (key, value)
SELECT 'setup_term', (public.financial_assign_client_plan(
  'f1000000-0000-0000-0000-00000000000f',
  (SELECT value FROM financial_test_state WHERE key = 'setup_version'),
  date_trunc('month', CURRENT_DATE)::date,
  'linked', NULL, NULL, NULL, 10, NULL, NULL
)->>'id')::uuid;

SELECT is(
  (public.financial_generate_competence(CURRENT_DATE)->>'generated_count')::integer,
  2,
  'a new term materializes one recurring charge and one setup charge'
);

SELECT is(
  (
    SELECT amount
    FROM public.financial_entries
    WHERE term_id = (SELECT value FROM financial_test_state WHERE key = 'setup_term')
      AND kind = 'one_off'
  ),
  348.84::numeric,
  'setup charge uses the term tax gross-up and remains a separate obligation'
);

SELECT is(
  (public.financial_generate_competence(CURRENT_DATE)->>'generated_count')::integer,
  0,
  'setup and recurring charge replay stays idempotent'
);

SELECT pg_temp.act_as_owner();

SELECT ok(
  (SELECT count(*) FROM app_private.financial_audit_log) > 0,
  'mutations leave a private audit trail'
);

SELECT * FROM finish();

ROLLBACK;
