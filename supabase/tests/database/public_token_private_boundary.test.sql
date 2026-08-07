-- EXPAND coexistence for legacy plaintext and private-digest state machines.
-- Synthetic fixtures run inside BEGIN/ROLLBACK and never touch production.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT * FROM no_plan();

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', _uid::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text,
    true
  );
  EXECUTE 'SET LOCAL ROLE authenticated';
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.act_as_service() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  EXECUTE 'SET LOCAL ROLE service_role';
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.act_as_owner() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
END
$$;

SELECT ok(
  (
    SELECT relrowsecurity AND relforcerowsecurity
    FROM pg_class
    WHERE oid = 'app_private.first_access_tokens'::regclass
  ),
  'first-access token state has enabled and forced RLS'
);

SELECT ok(
  (
    SELECT relrowsecurity AND relforcerowsecurity
    FROM pg_class
    WHERE oid = 'app_private.quiz_invitation_tokens'::regclass
  ),
  'quiz token state has enabled and forced RLS'
);

SELECT is(
  has_schema_privilege('authenticated', 'app_private', 'USAGE'),
  false,
  'authenticated cannot use the private schema'
);

SELECT is(
  has_schema_privilege('service_role', 'app_private', 'USAGE'),
  false,
  'service role reaches private token state only through reviewed RPCs'
);

SELECT is(
  has_function_privilege(
    'authenticated',
    'public.claim_first_access_token(text)',
    'EXECUTE'
  ),
  false,
  'browser roles cannot claim first-access links directly'
);

SELECT is(
  has_function_privilege(
    'service_role',
    'public.claim_first_access_token(text)',
    'EXECUTE'
  ),
  true,
  'the first-access Edge boundary can invoke the claim RPC'
);

SELECT is(
  has_function_privilege(
    'authenticated',
    'public.submit_quiz_invitation(text,jsonb,integer,text)',
    'EXECUTE'
  ),
  false,
  'browser roles cannot submit quiz state without the Edge boundary'
);

SELECT ok(
  to_regclass('public.idx_profiles_first_access_token') IS NOT NULL
    AND to_regclass('public.profiles_active_first_access_idx') IS NOT NULL
    AND to_regclass('public.quiz_submissions_active_invitation_idx') IS NOT NULL,
  'EXPAND preserves every legacy plaintext lookup index'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_trigger
    WHERE tgrelid = 'public.profiles'::regclass
      AND tgname = 'profiles_capture_legacy_first_access_token_insert'
      AND NOT tgisinternal
  ),
  0,
  'no profile BEFORE INSERT trigger can write a child row before its FK parent'
);

SELECT is(
  pg_get_function_result('public.issue_quiz_invitation()'::regprocedure),
  'text',
  'the legacy quiz issuer keeps its scalar text return contract'
);

SELECT ok(
  to_regprocedure('public.issue_quiz_invitation_v2()') IS NOT NULL,
  'the richer quiz issuer is exposed under an additive v2 name'
);

SELECT is(
  has_function_privilege(
    'authenticated',
    'public.issue_quiz_invitation_v2()',
    'EXECUTE'
  ),
  true,
  'authenticated staff can reach the additive v2 quiz issuer'
);

INSERT INTO auth.users (id, email)
VALUES
  ('e0000000-0000-4000-8000-000000000001', 'token-admin@test.local'),
  ('e0000000-0000-4000-8000-000000000002', 'token-manager@test.local'),
  ('e0000000-0000-4000-8000-000000000003', 'token-client@test.local'),
  ('e0000000-0000-4000-8000-000000000004', 'token-design@test.local');

INSERT INTO public.user_roles (user_id, role)
VALUES
  ('e0000000-0000-4000-8000-000000000001', 'admin'),
  ('e0000000-0000-4000-8000-000000000002', 'manager'),
  ('e0000000-0000-4000-8000-000000000004', 'design')
ON CONFLICT (user_id) DO UPDATE
SET role = EXCLUDED.role;

-- A non-admin profile owner cannot smuggle a known bearer through the legacy
-- public profile column during the rollout window.
SELECT pg_temp.act_as('e0000000-0000-4000-8000-000000000003');

SELECT throws_ok(
  $$
    UPDATE public.profiles
    SET
      first_access_token = repeat('b', 64),
      first_access_expires_at = now() + interval '7 days'
    WHERE id = 'e0000000-0000-4000-8000-000000000003'
  $$,
  '42501',
  'FIRST_ACCESS_TOKEN_ISSUE_FORBIDDEN',
  'non-admin users cannot issue a known first-access bearer through profiles'
);

SELECT pg_temp.act_as_owner();

-- Exercise the legacy admin write with a deterministic bearer so coexistence,
-- private dual-write and claim transitions can be asserted exactly.
SELECT pg_temp.act_as('e0000000-0000-4000-8000-000000000001');

UPDATE public.profiles
SET
  portal_password = 'legacy-placeholder-not-a-real-secret',
  first_access_token = repeat('a', 64),
  first_access_expires_at = now() + interval '7 days'
WHERE id = 'e0000000-0000-4000-8000-000000000003';

SELECT pg_temp.act_as_owner();

SELECT is(
  (
    SELECT first_access_token
    FROM public.profiles
    WHERE id = 'e0000000-0000-4000-8000-000000000003'
  ),
  repeat('a', 64),
  'legacy first-access bearer remains readable by the old runtime during EXPAND'
);

SELECT is(
  (
    SELECT portal_password
    FROM public.profiles
    WHERE id = 'e0000000-0000-4000-8000-000000000003'
  ),
  'legacy-placeholder-not-a-real-secret',
  'EXPAND does not scrub the independent legacy portal password column'
);

SELECT is(
  encode(
    (
      SELECT token_hash
      FROM app_private.first_access_tokens
      WHERE profile_id = 'e0000000-0000-4000-8000-000000000003'
    ),
    'hex'
  ),
  encode(
    extensions.digest(pg_catalog.convert_to(repeat('a', 64), 'UTF8'), 'sha256'),
    'hex'
  ),
  'the same legacy bearer is dual-written as a private SHA-256 digest'
);

SELECT pg_temp.act_as_service();

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.claim_first_access_token(
      encode(
        extensions.digest(
          pg_catalog.convert_to(repeat('a', 64), 'UTF8'),
          'sha256'
        ),
        'hex'
      )
    )
  ),
  1,
  'the first concurrent claimant acquires the link'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.claim_first_access_token(
      encode(
        extensions.digest(
          pg_catalog.convert_to(repeat('a', 64), 'UTF8'),
          'sha256'
        ),
        'hex'
      )
    )
  ),
  0,
  'a second claimant cannot acquire an already claimed link'
);

SELECT pg_temp.act_as_owner();

CREATE TEMP TABLE first_access_claim_fixture AS
SELECT claim_id
FROM app_private.first_access_tokens
WHERE profile_id = 'e0000000-0000-4000-8000-000000000003';
GRANT SELECT ON first_access_claim_fixture TO service_role;

SELECT pg_temp.act_as_service();

SELECT is(
  public.release_first_access_claim(
    (SELECT claim_id FROM first_access_claim_fixture)
  ),
  true,
  'a definitive Auth failure can release the private claim'
);

SELECT pg_temp.act_as_owner();

SELECT is(
  (
    SELECT first_access_attempts
    FROM public.profiles
    WHERE id = 'e0000000-0000-4000-8000-000000000003'
  ),
  (
    SELECT attempts
    FROM app_private.first_access_tokens
    WHERE profile_id = 'e0000000-0000-4000-8000-000000000003'
  ),
  'a released v2 claim mirrors attempt metadata for the legacy runtime'
);

UPDATE app_private.first_access_tokens
SET last_attempt_at = now() - interval '2 seconds'
WHERE profile_id = 'e0000000-0000-4000-8000-000000000003';

DROP TABLE first_access_claim_fixture;
CREATE TEMP TABLE first_access_claim_fixture (claim_id uuid);
GRANT SELECT, INSERT ON first_access_claim_fixture TO service_role;

SELECT pg_temp.act_as_service();

INSERT INTO first_access_claim_fixture (claim_id)
SELECT claim_id
FROM public.claim_first_access_token(
  encode(
    extensions.digest(
      pg_catalog.convert_to(repeat('a', 64), 'UTF8'),
      'sha256'
    ),
    'hex'
  )
);

SELECT is(
  public.consume_first_access_claim(
    (SELECT claim_id FROM first_access_claim_fixture)
  ),
  true,
  'a successful Auth update consumes the claim'
);

SELECT is(
  public.consume_first_access_claim(
    (SELECT claim_id FROM first_access_claim_fixture)
  ),
  true,
  'repeating consume after a lost response is safely idempotent'
);

SELECT pg_temp.act_as_owner();

SELECT is(
  (
    SELECT status
    FROM app_private.first_access_tokens
    WHERE profile_id = 'e0000000-0000-4000-8000-000000000003'
  ),
  'used',
  'consumed first-access bearer cannot be claimed again'
);

SELECT ok(
  (
    SELECT first_access_used_at IS NOT NULL
    FROM public.profiles
    WHERE id = 'e0000000-0000-4000-8000-000000000003'
  ),
  'non-sensitive profile metadata records first-access completion'
);

SELECT is(
  (
    SELECT first_access_token
    FROM public.profiles
    WHERE id = 'e0000000-0000-4000-8000-000000000003'
  ),
  NULL::text,
  'normal token consumption still clears the legacy bearer as a state transition'
);

SELECT is(
  (
    SELECT portal_password
    FROM public.profiles
    WHERE id = 'e0000000-0000-4000-8000-000000000003'
  ),
  'legacy-placeholder-not-a-real-secret',
  'v2 token consumption does not perform an unrelated plaintext cutover'
);

CREATE TEMP TABLE first_access_v2_issue_fixture (
  token text,
  expires_at timestamptz
);
GRANT SELECT, INSERT ON first_access_v2_issue_fixture TO authenticated;

SELECT pg_temp.act_as('e0000000-0000-4000-8000-000000000001');

INSERT INTO first_access_v2_issue_fixture
SELECT *
FROM public.issue_first_access_token(
  'e0000000-0000-4000-8000-000000000003'
);

SELECT pg_temp.act_as_owner();

SELECT is(
  (
    SELECT first_access_token
    FROM public.profiles
    WHERE id = 'e0000000-0000-4000-8000-000000000003'
  ),
  (SELECT token FROM first_access_v2_issue_fixture),
  'first-access v2 issuance also writes the raw token for the legacy runtime'
);

SELECT is(
  encode(
    (
      SELECT token_hash
      FROM app_private.first_access_tokens
      WHERE profile_id = 'e0000000-0000-4000-8000-000000000003'
    ),
    'hex'
  ),
  encode(
    extensions.digest(
      pg_catalog.convert_to(
        btrim((SELECT token FROM first_access_v2_issue_fixture)),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ),
  'first-access v2 issuance and legacy storage share one private digest'
);

-- Exercise both quiz issuer contracts in parallel.
CREATE TEMP TABLE quiz_v1_issue_fixture (token text);
GRANT SELECT, INSERT ON quiz_v1_issue_fixture TO authenticated, service_role;

CREATE TEMP TABLE quiz_v2_issue_fixture (
  token text,
  submission_id uuid,
  expires_at timestamptz
);
GRANT SELECT, INSERT ON quiz_v2_issue_fixture TO authenticated, service_role;

-- The legacy dashboard is shared with every staff role. Use design for v1 and
-- manager for v2 so the additive helper cannot accidentally narrow that grant.
SELECT pg_temp.act_as('e0000000-0000-4000-8000-000000000004');

INSERT INTO quiz_v1_issue_fixture (token)
SELECT public.issue_quiz_invitation();

SELECT pg_temp.act_as('e0000000-0000-4000-8000-000000000002');

INSERT INTO quiz_v2_issue_fixture
SELECT * FROM public.issue_quiz_invitation_v2();

SELECT pg_temp.act_as_owner();

SELECT is(
  (
    SELECT token
    FROM public.quiz_submissions
    WHERE token = (SELECT token FROM quiz_v1_issue_fixture)
  ),
  (SELECT token FROM quiz_v1_issue_fixture),
  'v1 scalar issuer keeps a legacy plaintext lookup row'
);

SELECT is(
  (
    SELECT token
    FROM public.quiz_submissions
    WHERE id = (SELECT submission_id FROM quiz_v2_issue_fixture)
  ),
  (SELECT token FROM quiz_v2_issue_fixture),
  'v2 issuer also keeps the old quiz runtime functional during EXPAND'
);

SELECT is(
  encode(
    (
      SELECT token_hash
      FROM app_private.quiz_invitation_tokens
      WHERE submission_id = (SELECT submission_id FROM quiz_v2_issue_fixture)
    ),
    'hex'
  ),
  encode(
    extensions.digest(
      pg_catalog.convert_to(
        (SELECT token FROM quiz_v2_issue_fixture),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ),
  'v2 quiz issuance dual-writes the private bearer digest'
);

SELECT is(
  encode(
    (
      SELECT private_token.token_hash
      FROM app_private.quiz_invitation_tokens AS private_token
      JOIN public.quiz_submissions AS submission
        ON submission.id = private_token.submission_id
      WHERE submission.token = (SELECT token FROM quiz_v1_issue_fixture)
    ),
    'hex'
  ),
  encode(
    extensions.digest(
      pg_catalog.convert_to(
        btrim((SELECT token FROM quiz_v1_issue_fixture)),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ),
  'v1 scalar issuance uses the same private digest bridge'
);

-- Simulate one old-runtime action by its raw-token lookup. The public counter
-- remains authoritative and the trigger mirrors it privately for v2.
SELECT pg_temp.act_as_service();

UPDATE public.quiz_submissions
SET
  lead_name = 'Legacy Runtime Lead',
  action_count = action_count + 1,
  last_action_at = now() - interval '1 second'
WHERE token = (SELECT token FROM quiz_v1_issue_fixture)
  AND status = 'draft';

SELECT pg_temp.act_as_owner();

SELECT is(
  (
    SELECT private_token.action_count
    FROM app_private.quiz_invitation_tokens AS private_token
    JOIN public.quiz_submissions AS submission
      ON submission.id = private_token.submission_id
    WHERE submission.token = (SELECT token FROM quiz_v1_issue_fixture)
  ),
  1,
  'legacy quiz actions dual-write private v2 rate metadata'
);

SELECT pg_temp.act_as_service();

UPDATE public.quiz_submissions
SET token = ''
WHERE token = (SELECT token FROM quiz_v1_issue_fixture)
  AND status = 'draft';

SELECT pg_temp.act_as_owner();

SELECT ok(
  (
    SELECT private_token.used_at IS NOT NULL
    FROM app_private.quiz_invitation_tokens AS private_token
    WHERE private_token.token_hash = extensions.digest(
      pg_catalog.convert_to(
        btrim((SELECT token FROM quiz_v1_issue_fixture)),
        'UTF8'
      ),
      'sha256'
    )
  ),
  'clearing a legacy quiz token makes its previous private digest terminal'
);

-- Whitespace-equivalent legacy bearers remain stored exactly as written, but
-- neither ambiguous row is admitted through the normalized v2 digest.
INSERT INTO public.quiz_submissions (
  id,
  token,
  status,
  origin,
  invitation_expires_at,
  action_count
) VALUES
  (
    'e1000000-0000-4000-8000-000000000001',
    '  ' || repeat('d', 64) || '  ',
    'draft',
    'portal_admin',
    now() + interval '14 days',
    0
  ),
  (
    'e1000000-0000-4000-8000-000000000002',
    repeat('d', 64),
    'draft',
    'portal_admin',
    now() + interval '14 days',
    0
  );

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.quiz_submissions
    WHERE btrim(token) = repeat('d', 64)
  ),
  2,
  'EXPAND preserves normalized duplicate plaintext quiz rows for legacy readers'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM app_private.quiz_invitation_tokens
    WHERE token_hash = extensions.digest(
      pg_catalog.convert_to(repeat('d', 64), 'UTF8'),
      'sha256'
    )
      AND used_at IS NULL
  ),
  0,
  'normalized duplicate quiz bearers fail closed in the private v2 boundary'
);

CREATE TEMP TABLE quiz_hash_fixture AS
SELECT encode(
  extensions.digest(
    pg_catalog.convert_to((SELECT token FROM quiz_v2_issue_fixture), 'UTF8'),
    'sha256'
  ),
  'hex'
) AS token_hash_hex;
GRANT SELECT ON quiz_hash_fixture TO service_role;

SELECT pg_temp.act_as_service();

SELECT is(
  public.save_quiz_invitation(
    (SELECT token_hash_hex FROM quiz_hash_fixture),
    '{"lead_name":"Synthetic Lead","lead_email":"lead@test.local","lead_company":"Synthetic Co"}'::jsonb
  ) ->> 'outcome',
  'ok',
  'an active quiz invitation can save a validated, whitelisted payload'
);

SELECT pg_temp.act_as_owner();

SELECT is(
  (
    SELECT private_token.action_count
    FROM app_private.quiz_invitation_tokens AS private_token
    WHERE private_token.submission_id = (
      SELECT submission_id FROM quiz_v2_issue_fixture
    )
  ),
  (
    SELECT submission.action_count
    FROM public.quiz_submissions AS submission
    WHERE submission.id = (SELECT submission_id FROM quiz_v2_issue_fixture)
  ),
  'v2 quiz actions keep public and private rate metadata synchronized'
);

SELECT is(
  (
    SELECT submission.token
    FROM public.quiz_submissions AS submission
    WHERE submission.id = (SELECT submission_id FROM quiz_v2_issue_fixture)
  ),
  (SELECT token FROM quiz_v2_issue_fixture),
  'v2 quiz mutations do not replace the raw legacy bearer during EXPAND'
);

UPDATE public.quiz_submissions
SET last_action_at = now() - interval '1 second'
WHERE id = (SELECT submission_id FROM quiz_v2_issue_fixture);

CREATE TEMP TABLE quiz_submit_fixture (result jsonb);
GRANT SELECT, INSERT ON quiz_submit_fixture TO service_role;

SELECT pg_temp.act_as_service();

INSERT INTO quiz_submit_fixture (result)
SELECT public.submit_quiz_invitation(
  (SELECT token_hash_hex FROM quiz_hash_fixture),
  '{"lead_name":"Synthetic Lead","lead_email":"lead@test.local","lead_company":"Synthetic Co"}'::jsonb,
  75,
  'growth'
);

SELECT is(
  (SELECT result ->> 'outcome' FROM quiz_submit_fixture),
  'ok',
  'quiz submission atomically consumes the invitation'
);

SELECT is(
  public.submit_quiz_invitation(
    (SELECT token_hash_hex FROM quiz_hash_fixture),
    '{}'::jsonb,
    75,
    'growth'
  ) ->> 'idempotent',
  'true',
  'a repeated quiz submit returns only an idempotent result summary'
);

SELECT is(
  public.load_quiz_invitation(
    (SELECT token_hash_hex FROM quiz_hash_fixture)
  ) ? 'responses',
  false,
  'loading a submitted invitation never returns saved PII'
);

SELECT is(
  public.load_quiz_invitation(
    (SELECT token_hash_hex FROM quiz_hash_fixture)
  ) ->> 'outcome',
  'used',
  'a submitted quiz bearer is terminal for all further mutations'
);

SELECT * FROM finish();
ROLLBACK;
