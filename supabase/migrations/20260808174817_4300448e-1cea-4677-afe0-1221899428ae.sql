CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS app_private.first_access_tokens (
  profile_id uuid PRIMARY KEY
    REFERENCES public.profiles(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE
    CHECK (octet_length(token_hash) = 32),
  status text NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'claimed', 'used', 'revoked')),
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0
    CHECK (attempts BETWEEN 0 AND 10),
  last_attempt_at timestamptz,
  claim_id uuid UNIQUE,
  claimed_at timestamptz,
  used_at timestamptz,
  issued_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_private.first_access_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.first_access_tokens FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app_private.first_access_tokens
  FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX IF NOT EXISTS first_access_tokens_active_idx
  ON app_private.first_access_tokens (expires_at)
  WHERE status = 'available';

CREATE TABLE IF NOT EXISTS app_private.quiz_invitation_tokens (
  submission_id uuid PRIMARY KEY
    REFERENCES public.quiz_submissions(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE
    CHECK (octet_length(token_hash) = 32),
  expires_at timestamptz NOT NULL,
  action_count integer NOT NULL DEFAULT 0
    CHECK (action_count BETWEEN 0 AND 500),
  last_action_at timestamptz,
  used_at timestamptz,
  issued_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_private.quiz_invitation_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.quiz_invitation_tokens FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app_private.quiz_invitation_tokens
  FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX IF NOT EXISTS quiz_invitation_tokens_active_idx
  ON app_private.quiz_invitation_tokens (expires_at)
  WHERE used_at IS NULL;

-- Preserve only unique, still-meaningful legacy first-access links. Duplicate
-- plaintext bearers fail closed in v2: no ambiguous private digest is admitted,
-- while all public values remain untouched for the old runtime during EXPAND.
WITH legacy_first_access AS (
  SELECT
    p.id AS profile_id,
    extensions.digest(
      pg_catalog.convert_to(btrim(p.first_access_token), 'UTF8'),
      'sha256'
    ) AS token_hash,
    CASE
      WHEN p.first_access_used_at IS NOT NULL THEN 'used'
      WHEN COALESCE(p.first_access_expires_at, now()) <= now() THEN 'revoked'
      ELSE 'available'
    END AS status,
    COALESCE(p.first_access_expires_at, now()) AS expires_at,
    LEAST(GREATEST(COALESCE(p.first_access_attempts, 0), 0), 10) AS attempts,
    p.first_access_last_attempt_at AS last_attempt_at,
    p.first_access_used_at AS used_at,
    row_number() OVER (
      PARTITION BY btrim(p.first_access_token)
      ORDER BY p.id
    ) AS duplicate_rank,
    count(*) OVER (
      PARTITION BY btrim(p.first_access_token)
    ) AS duplicate_count
  FROM public.profiles AS p
  WHERE p.first_access_token IS NOT NULL
    AND btrim(p.first_access_token) <> ''
)
INSERT INTO app_private.first_access_tokens (
  profile_id,
  token_hash,
  status,
  expires_at,
  attempts,
  last_attempt_at,
  used_at
)
SELECT
  profile_id,
  token_hash,
  status,
  expires_at,
  attempts,
  last_attempt_at,
  used_at
FROM legacy_first_access
WHERE duplicate_rank = 1
  AND duplicate_count = 1
ON CONFLICT DO NOTHING;

WITH legacy_quiz_invitations AS (
  SELECT
    q.id AS submission_id,
    extensions.digest(
      pg_catalog.convert_to(btrim(q.token), 'UTF8'),
      'sha256'
    ) AS token_hash,
    q.invitation_expires_at AS expires_at,
    LEAST(GREATEST(COALESCE(q.action_count, 0), 0), 500) AS action_count,
    q.last_action_at
  FROM public.quiz_submissions AS q
  WHERE q.status = 'draft'
    AND q.invitation_expires_at > now()
    AND btrim(q.token) <> ''
    AND NOT EXISTS (
      SELECT 1
      FROM public.quiz_submissions AS duplicate_submission
      WHERE duplicate_submission.id <> q.id
        AND btrim(duplicate_submission.token) = btrim(q.token)
    )
)
INSERT INTO app_private.quiz_invitation_tokens (
  submission_id,
  token_hash,
  expires_at,
  action_count,
  last_action_at
)
SELECT
  submission_id,
  token_hash,
  expires_at,
  action_count,
  last_action_at
FROM legacy_quiz_invitations
WHERE true
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION app_private.capture_legacy_first_access_token()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _raw_token text;
  _token_hash bytea;
  _expires_at timestamptz;
  _attempts integer;
  _desired_status text;
  _private_status text;
BEGIN
  IF NEW.first_access_token IS NOT NULL
     AND btrim(NEW.first_access_token) <> '' THEN
    _raw_token := btrim(NEW.first_access_token);
    _token_hash := extensions.digest(
      pg_catalog.convert_to(_raw_token, 'UTF8'),
      'sha256'
    );
    _expires_at := COALESCE(
      NEW.first_access_expires_at,
      now() + interval '7 days'
    );
    _attempts := LEAST(
      GREATEST(COALESCE(NEW.first_access_attempts, 0), 0),
      10
    );
    _desired_status := CASE
      WHEN NEW.first_access_used_at IS NOT NULL THEN 'used'
      WHEN _expires_at <= now() OR _attempts >= 10 THEN 'revoked'
      ELSE 'available'
    END;

    IF NEW.first_access_token IS DISTINCT FROM OLD.first_access_token THEN
      IF COALESCE(auth.role(), '') <> 'service_role'
         AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
        RAISE EXCEPTION USING
          ERRCODE = '42501',
          MESSAGE = 'FIRST_ACCESS_TOKEN_ISSUE_FORBIDDEN';
      END IF;

      IF length(_raw_token) < 32 OR length(_raw_token) > 512 THEN
        RAISE EXCEPTION USING
          ERRCODE = '22023',
          MESSAGE = 'FIRST_ACCESS_TOKEN_INVALID';
      END IF;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.profiles AS duplicate_profile
      WHERE duplicate_profile.id <> NEW.id
        AND duplicate_profile.first_access_token IS NOT NULL
        AND btrim(duplicate_profile.first_access_token) = _raw_token
    ) THEN
      UPDATE app_private.first_access_tokens AS token_state
      SET
        status = CASE
          WHEN token_state.status = 'used' THEN 'used'
          ELSE 'revoked'
        END,
        claim_id = CASE
          WHEN token_state.status = 'used' THEN token_state.claim_id
          ELSE NULL
        END,
        claimed_at = CASE
          WHEN token_state.status = 'used' THEN token_state.claimed_at
          ELSE NULL
        END,
        updated_at = now()
      WHERE token_state.profile_id = NEW.id
         OR token_state.token_hash = _token_hash;

      RETURN NEW;
    END IF;

    IF NEW.first_access_token IS DISTINCT FROM OLD.first_access_token THEN
      BEGIN
        INSERT INTO app_private.first_access_tokens (
          profile_id,
          token_hash,
          status,
          expires_at,
          attempts,
          last_attempt_at,
          claim_id,
          claimed_at,
          used_at,
          issued_by,
          created_at,
          updated_at
        ) VALUES (
          NEW.id,
          _token_hash,
          _desired_status,
          _expires_at,
          _attempts,
          NEW.first_access_last_attempt_at,
          NULL,
          NULL,
          NEW.first_access_used_at,
          auth.uid(),
          now(),
          now()
        )
        ON CONFLICT (profile_id) DO UPDATE SET
          token_hash = EXCLUDED.token_hash,
          status = EXCLUDED.status,
          expires_at = EXCLUDED.expires_at,
          attempts = EXCLUDED.attempts,
          last_attempt_at = EXCLUDED.last_attempt_at,
          claim_id = NULL,
          claimed_at = NULL,
          used_at = EXCLUDED.used_at,
          issued_by = EXCLUDED.issued_by,
          created_at = now(),
          updated_at = now();
      EXCEPTION
        WHEN unique_violation THEN
          UPDATE app_private.first_access_tokens AS token_state
          SET
            status = CASE
              WHEN token_state.status = 'used' THEN 'used'
              ELSE 'revoked'
            END,
            claim_id = CASE
              WHEN token_state.status = 'used' THEN token_state.claim_id
              ELSE NULL
            END,
            claimed_at = CASE
              WHEN token_state.status = 'used' THEN token_state.claimed_at
              ELSE NULL
            END,
            updated_at = now()
          WHERE token_state.profile_id = NEW.id
             OR token_state.token_hash = _token_hash;
      END;

      RETURN NEW;
    END IF;

    SELECT token_state.status
    INTO _private_status
    FROM app_private.first_access_tokens AS token_state
    WHERE token_state.profile_id = NEW.id
    FOR UPDATE;

    IF NOT FOUND THEN
      BEGIN
        INSERT INTO app_private.first_access_tokens (
          profile_id,
          token_hash,
          status,
          expires_at,
          attempts,
          last_attempt_at,
          used_at,
          issued_by
        ) VALUES (
          NEW.id,
          _token_hash,
          _desired_status,
          _expires_at,
          _attempts,
          NEW.first_access_last_attempt_at,
          NEW.first_access_used_at,
          auth.uid()
        );
      EXCEPTION
        WHEN unique_violation THEN
          NULL;
      END;
      RETURN NEW;
    END IF;

    IF _desired_status = 'available'
       AND _private_status <> 'available' THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'FIRST_ACCESS_TOKEN_NOT_AVAILABLE';
    END IF;

    UPDATE app_private.first_access_tokens AS token_state
    SET
      status = _desired_status,
      expires_at = _expires_at,
      attempts = GREATEST(token_state.attempts, _attempts),
      last_attempt_at = GREATEST(
        token_state.last_attempt_at,
        NEW.first_access_last_attempt_at
      ),
      claim_id = NULL,
      claimed_at = NULL,
      used_at = NEW.first_access_used_at,
      updated_at = now()
    WHERE token_state.profile_id = NEW.id;

    RETURN NEW;
  END IF;

  IF OLD.first_access_token IS NOT NULL
     AND btrim(OLD.first_access_token) <> '' THEN
    _raw_token := btrim(OLD.first_access_token);
    _attempts := LEAST(
      GREATEST(COALESCE(NEW.first_access_attempts, 0), 0),
      10
    );
    _desired_status := CASE
      WHEN NEW.first_access_used_at IS NOT NULL THEN 'used'
      ELSE 'revoked'
    END;

    SELECT token_state.status
    INTO _private_status
    FROM app_private.first_access_tokens AS token_state
    WHERE token_state.profile_id = NEW.id
    FOR UPDATE;

    IF FOUND AND _private_status = 'claimed' THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'FIRST_ACCESS_TOKEN_CLAIMED';
    END IF;

    BEGIN
      INSERT INTO app_private.first_access_tokens AS current_token (
        profile_id,
        token_hash,
        status,
        expires_at,
        attempts,
        last_attempt_at,
        claim_id,
        claimed_at,
        used_at,
        issued_by,
        created_at,
        updated_at
      ) VALUES (
        NEW.id,
        extensions.digest(pg_catalog.convert_to(_raw_token, 'UTF8'), 'sha256'),
        _desired_status,
        COALESCE(
          NEW.first_access_expires_at,
          OLD.first_access_expires_at,
          now()
        ),
        _attempts,
        NEW.first_access_last_attempt_at,
        NULL,
        NULL,
        NEW.first_access_used_at,
        auth.uid(),
        now(),
        now()
      )
      ON CONFLICT (profile_id) DO UPDATE SET
        status = EXCLUDED.status,
        expires_at = EXCLUDED.expires_at,
        attempts = GREATEST(current_token.attempts, EXCLUDED.attempts),
        last_attempt_at = GREATEST(
          current_token.last_attempt_at,
          EXCLUDED.last_attempt_at
        ),
        claim_id = CASE
          WHEN current_token.status = 'used'
               AND EXCLUDED.status = 'used'
            THEN current_token.claim_id
          ELSE NULL
        END,
        claimed_at = CASE
          WHEN current_token.status = 'used'
               AND EXCLUDED.status = 'used'
            THEN current_token.claimed_at
          ELSE NULL
        END,
        used_at = EXCLUDED.used_at,
        updated_at = now();
    EXCEPTION
      WHEN unique_violation THEN
        NULL;
    END;
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION app_private.capture_legacy_first_access_token()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS profiles_capture_legacy_first_access_token_insert
  ON public.profiles;

DROP TRIGGER IF EXISTS profiles_capture_legacy_first_access_token_update
  ON public.profiles;
CREATE TRIGGER profiles_capture_legacy_first_access_token_update
  AFTER UPDATE OF
    first_access_token,
    first_access_expires_at,
    first_access_attempts,
    first_access_last_attempt_at,
    first_access_used_at
  ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION app_private.capture_legacy_first_access_token();

CREATE OR REPLACE FUNCTION app_private.issue_first_access_token_for_profile(
  p_profile_id uuid,
  p_issued_by uuid DEFAULT NULL
)
RETURNS TABLE(token text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _token text;
  _expires_at timestamptz := now() + interval '7 days';
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    JOIN public.user_roles AS r ON r.user_id = p.id
    WHERE p.id = p_profile_id
      AND r.role = 'client'::public.app_role
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'FIRST_ACCESS_PROFILE_INVALID';
  END IF;

  _token := encode(extensions.gen_random_bytes(32), 'hex');

  UPDATE public.profiles
  SET
    first_access_token = _token,
    first_access_expires_at = _expires_at,
    first_access_attempts = 0,
    first_access_last_attempt_at = NULL,
    first_access_used_at = NULL
  WHERE id = p_profile_id;

  UPDATE app_private.first_access_tokens AS token_state
  SET issued_by = p_issued_by
  WHERE token_state.profile_id = p_profile_id;

  RETURN QUERY SELECT _token, _expires_at;
END
$$;

REVOKE ALL ON FUNCTION app_private.issue_first_access_token_for_profile(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_first_access_token(p_profile_id uuid)
RETURNS TABLE(token text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _actor uuid := auth.uid();
BEGIN
  IF _actor IS NULL
     OR NOT public.has_role(_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'FIRST_ACCESS_ISSUE_FORBIDDEN';
  END IF;

  RETURN QUERY
  SELECT issued.token, issued.expires_at
  FROM app_private.issue_first_access_token_for_profile(
    p_profile_id,
    _actor
  ) AS issued;
END
$$;

REVOKE ALL ON FUNCTION public.issue_first_access_token(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_first_access_token(uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_first_access_token_service(
  p_profile_id uuid
)
RETURNS TABLE(token text, expires_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT issued.token, issued.expires_at
  FROM app_private.issue_first_access_token_for_profile(
    p_profile_id,
    NULL
  ) AS issued
$$;

REVOKE ALL ON FUNCTION public.issue_first_access_token_service(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_first_access_token_service(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.validate_first_access_token(
  p_token_hash_hex text
)
RETURNS TABLE(
  profile_id uuid,
  email text,
  status text,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_token_hash_hex IS NULL
     OR p_token_hash_hex !~ '^[0-9a-f]{64}$' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    t.profile_id,
    p.email,
    t.status,
    t.expires_at
  FROM app_private.first_access_tokens AS t
  JOIN public.profiles AS p ON p.id = t.profile_id
  WHERE t.token_hash = pg_catalog.decode(p_token_hash_hex, 'hex')
    AND t.status IN ('available', 'used')
    AND t.expires_at > now()
    AND (t.status = 'used' OR t.attempts < 10);
END
$$;

REVOKE ALL ON FUNCTION public.validate_first_access_token(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_first_access_token(text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.claim_first_access_token(
  p_token_hash_hex text
)
RETURNS TABLE(claim_id uuid, profile_id uuid, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_token_hash_hex IS NULL
     OR p_token_hash_hex !~ '^[0-9a-f]{64}$' THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH claimed AS (
    UPDATE app_private.first_access_tokens AS t
    SET
      status = 'claimed',
      attempts = t.attempts + 1,
      last_attempt_at = now(),
      claim_id = pg_catalog.gen_random_uuid(),
      claimed_at = now(),
      updated_at = now()
    WHERE t.token_hash = pg_catalog.decode(p_token_hash_hex, 'hex')
      AND t.status = 'available'
      AND t.expires_at > now()
      AND t.attempts < 10
      AND (
        t.last_attempt_at IS NULL
        OR t.last_attempt_at <= now() - interval '1 second'
      )
    RETURNING t.claim_id, t.profile_id
  )
  SELECT c.claim_id, c.profile_id, p.email
  FROM claimed AS c
  JOIN public.profiles AS p ON p.id = c.profile_id;
END
$$;

REVOKE ALL ON FUNCTION public.claim_first_access_token(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_first_access_token(text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.release_first_access_claim(p_claim_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _profile_id uuid;
  _released_profile_id uuid;
  _attempts integer;
  _last_attempt_at timestamptz;
BEGIN
  SELECT t.profile_id
  INTO _profile_id
  FROM app_private.first_access_tokens AS t
  WHERE t.claim_id = p_claim_id
    AND t.status = 'claimed';

  IF _profile_id IS NULL THEN
    RETURN false;
  END IF;

  PERFORM 1
  FROM public.profiles AS profile
  WHERE profile.id = _profile_id
  FOR UPDATE;

  UPDATE app_private.first_access_tokens AS t
  SET
    status = 'available',
    claim_id = NULL,
    claimed_at = NULL,
    updated_at = now()
  WHERE t.claim_id = p_claim_id
    AND t.status = 'claimed'
    AND t.expires_at > now()
  RETURNING t.profile_id, t.attempts, t.last_attempt_at
  INTO _released_profile_id, _attempts, _last_attempt_at;

  IF _released_profile_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.profiles AS profile
  SET
    first_access_attempts = GREATEST(
      profile.first_access_attempts,
      _attempts
    ),
    first_access_last_attempt_at = GREATEST(
      profile.first_access_last_attempt_at,
      _last_attempt_at
    )
  WHERE profile.id = _released_profile_id;

  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION public.release_first_access_claim(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_first_access_claim(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.consume_first_access_claim(p_claim_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _profile_id uuid;
  _attempts integer;
  _status text;
  _used_at timestamptz := now();
BEGIN
  SELECT t.profile_id, t.attempts, t.status
  INTO _profile_id, _attempts, _status
  FROM app_private.first_access_tokens AS t
  WHERE t.claim_id = p_claim_id;

  IF _profile_id IS NULL THEN
    RETURN false;
  END IF;

  IF _status = 'used' THEN
    RETURN true;
  END IF;

  IF _status <> 'claimed' THEN
    RETURN false;
  END IF;

  PERFORM 1
  FROM public.profiles AS profile
  WHERE profile.id = _profile_id
  FOR UPDATE;

  UPDATE app_private.first_access_tokens AS t
  SET
    status = 'used',
    used_at = _used_at,
    updated_at = _used_at
  WHERE t.claim_id = p_claim_id
    AND t.status = 'claimed'
  RETURNING t.profile_id, t.attempts
  INTO _profile_id, _attempts;

  IF _profile_id IS NULL THEN
    RETURN EXISTS (
      SELECT 1
      FROM app_private.first_access_tokens AS t
      WHERE t.claim_id = p_claim_id
        AND t.status = 'used'
    );
  END IF;

  UPDATE public.profiles
  SET
    first_access_token = NULL,
    first_access_expires_at = NULL,
    first_access_attempts = _attempts,
    first_access_last_attempt_at = _used_at,
    first_access_used_at = _used_at
  WHERE id = _profile_id;

  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION public.consume_first_access_claim(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_first_access_claim(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION app_private.quiz_payload_is_valid(p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  _field text;
  _allowed_fields constant text[] := ARRAY[
    'lead_name',
    'lead_email',
    'lead_whatsapp',
    'lead_company',
    'positioning',
    'differential',
    'icp',
    'main_pains',
    'goals_12m',
    'success_metric',
    'revenue_range',
    'team_size',
    'maturity_digital',
    'ai_readiness'
  ];
  _limits constant integer[] := ARRAY[
    160, 254, 40, 200, 4000, 4000, 4000, 4000, 4000, 2000,
    80, 80, 20, 20
  ];
  _index integer;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN false;
  END IF;

  IF (p_payload - _allowed_fields) <> '{}'::jsonb THEN
    RETURN false;
  END IF;

  FOR _index IN 1..array_length(_allowed_fields, 1) LOOP
    _field := _allowed_fields[_index];
    IF p_payload ? _field THEN
      IF jsonb_typeof(p_payload -> _field) <> 'string'
         OR length(p_payload ->> _field) > _limits[_index] THEN
        RETURN false;
      END IF;
    END IF;
  END LOOP;

  IF COALESCE(p_payload ->> 'lead_email', '') <> ''
     AND (p_payload ->> 'lead_email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RETURN false;
  END IF;

  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION app_private.quiz_payload_is_valid(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.capture_legacy_quiz_invitation_token()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _raw_token text := btrim(NEW.token);
  _token_hash bytea;
  _expires_at timestamptz := COALESCE(NEW.invitation_expires_at, now());
  _action_count integer := LEAST(
    GREATEST(COALESCE(NEW.action_count, 0), 0),
    500
  );
  _used_at timestamptz := CASE
    WHEN NEW.status = 'draft' THEN NULL
    ELSE COALESCE(NEW.submitted_at, now())
  END;
BEGIN
  IF _raw_token IS NULL OR _raw_token = '' THEN
    IF TG_OP = 'UPDATE' THEN
      UPDATE app_private.quiz_invitation_tokens AS current_token
      SET
        expires_at = _expires_at,
        action_count = _action_count,
        last_action_at = NEW.last_action_at,
        used_at = COALESCE(current_token.used_at, NEW.submitted_at, now()),
        updated_at = now()
      WHERE current_token.submission_id = NEW.id;
    END IF;

    RETURN NEW;
  END IF;

  _token_hash := extensions.digest(
    pg_catalog.convert_to(_raw_token, 'UTF8'),
    'sha256'
  );

  IF EXISTS (
    SELECT 1
    FROM public.quiz_submissions AS duplicate_submission
    WHERE duplicate_submission.id <> NEW.id
      AND btrim(duplicate_submission.token) = _raw_token
  ) THEN
    UPDATE app_private.quiz_invitation_tokens AS current_token
    SET
      used_at = COALESCE(current_token.used_at, _used_at, now()),
      updated_at = now()
    WHERE current_token.submission_id = NEW.id
       OR current_token.token_hash = _token_hash;

    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO app_private.quiz_invitation_tokens AS current_token (
      submission_id,
      token_hash,
      expires_at,
      action_count,
      last_action_at,
      used_at,
      issued_by,
      created_at,
      updated_at
    ) VALUES (
      NEW.id,
      _token_hash,
      _expires_at,
      _action_count,
      NEW.last_action_at,
      _used_at,
      auth.uid(),
      now(),
      now()
    )
    ON CONFLICT (submission_id) DO UPDATE SET
      token_hash = EXCLUDED.token_hash,
      expires_at = EXCLUDED.expires_at,
      action_count = EXCLUDED.action_count,
      last_action_at = EXCLUDED.last_action_at,
      used_at = COALESCE(current_token.used_at, EXCLUDED.used_at),
      issued_by = COALESCE(current_token.issued_by, EXCLUDED.issued_by),
      updated_at = now();
  EXCEPTION
    WHEN unique_violation THEN
      UPDATE app_private.quiz_invitation_tokens AS current_token
      SET
        used_at = COALESCE(current_token.used_at, _used_at, now()),
        updated_at = now()
      WHERE current_token.submission_id = NEW.id
         OR current_token.token_hash = _token_hash;
  END;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION app_private.capture_legacy_quiz_invitation_token()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS quiz_submissions_capture_legacy_invitation_insert
  ON public.quiz_submissions;
CREATE TRIGGER quiz_submissions_capture_legacy_invitation_insert
  AFTER INSERT
  ON public.quiz_submissions
  FOR EACH ROW
  EXECUTE FUNCTION app_private.capture_legacy_quiz_invitation_token();

DROP TRIGGER IF EXISTS quiz_submissions_capture_legacy_invitation_update
  ON public.quiz_submissions;
CREATE TRIGGER quiz_submissions_capture_legacy_invitation_update
  AFTER UPDATE OF
    token,
    invitation_expires_at,
    action_count,
    last_action_at,
    status,
    submitted_at
  ON public.quiz_submissions
  FOR EACH ROW
  EXECUTE FUNCTION app_private.capture_legacy_quiz_invitation_token();

CREATE OR REPLACE FUNCTION app_private.issue_quiz_invitation_for_actor(
  p_actor_id uuid
)
RETURNS TABLE(token text, submission_id uuid, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _token text;
  _submission_id uuid := pg_catalog.gen_random_uuid();
  _expires_at timestamptz := now() + interval '14 days';
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_staff(p_actor_id) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'QUIZ_INVITATION_ISSUE_FORBIDDEN';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_actor_id::text, 722000)
  );

  IF (
    SELECT count(*)
    FROM app_private.quiz_invitation_tokens AS t
    WHERE t.issued_by = p_actor_id
      AND t.created_at > now() - interval '1 hour'
  ) >= 20 THEN
    RAISE EXCEPTION USING
      ERRCODE = '54000',
      MESSAGE = 'QUIZ_INVITATION_RATE_LIMITED';
  END IF;

  _token := encode(extensions.gen_random_bytes(32), 'hex');

  INSERT INTO public.quiz_submissions (
    id,
    token,
    status,
    origin,
    invitation_expires_at,
    action_count,
    last_action_at
  ) VALUES (
    _submission_id,
    _token,
    'draft',
    'portal_admin',
    _expires_at,
    0,
    NULL
  );

  UPDATE app_private.quiz_invitation_tokens AS invitation
  SET issued_by = p_actor_id
  WHERE invitation.submission_id = _submission_id;

  RETURN QUERY SELECT _token, _submission_id, _expires_at;
END
$$;

REVOKE ALL ON FUNCTION app_private.issue_quiz_invitation_for_actor(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_quiz_invitation()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _token text;
BEGIN
  SELECT issued.token
  INTO _token
  FROM app_private.issue_quiz_invitation_for_actor(auth.uid()) AS issued;

  RETURN _token;
END
$$;

REVOKE ALL ON FUNCTION public.issue_quiz_invitation()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_quiz_invitation()
  TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_quiz_invitation_v2()
RETURNS TABLE(token text, submission_id uuid, expires_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT issued.token, issued.submission_id, issued.expires_at
  FROM app_private.issue_quiz_invitation_for_actor(auth.uid()) AS issued
$$;

REVOKE ALL ON FUNCTION public.issue_quiz_invitation_v2()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_quiz_invitation_v2()
  TO authenticated;

CREATE OR REPLACE FUNCTION public.load_quiz_invitation(
  p_token_hash_hex text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _token app_private.quiz_invitation_tokens%ROWTYPE;
  _submission public.quiz_submissions%ROWTYPE;
BEGIN
  IF p_token_hash_hex IS NULL
     OR p_token_hash_hex !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;

  SELECT t.* INTO _token
  FROM app_private.quiz_invitation_tokens AS t
  WHERE t.token_hash = pg_catalog.decode(p_token_hash_hex, 'hex');

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;

  SELECT q.* INTO _submission
  FROM public.quiz_submissions AS q
  WHERE q.id = _token.submission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;

  SELECT t.* INTO _token
  FROM app_private.quiz_invitation_tokens AS t
  WHERE t.submission_id = _submission.id
    AND t.token_hash = pg_catalog.decode(p_token_hash_hex, 'hex')
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;

  IF _token.expires_at <= now() THEN
    RETURN jsonb_build_object('outcome', 'expired');
  END IF;

  IF _token.used_at IS NOT NULL OR _submission.status <> 'draft' THEN
    RETURN jsonb_build_object(
      'outcome', 'used',
      'status', _submission.status,
      'score', _submission.icp_fit_score,
      'plan', _submission.recommended_plan,
      'submitted_at', _submission.submitted_at
    );
  END IF;

  IF _token.action_count >= 500
     OR (
       _token.last_action_at IS NOT NULL
       AND _token.last_action_at > now() - interval '250 milliseconds'
     ) THEN
    RETURN jsonb_build_object('outcome', 'rate_limited');
  END IF;

  UPDATE public.quiz_submissions AS submission
  SET
    action_count = submission.action_count + 1,
    last_action_at = now()
  WHERE submission.id = _token.submission_id;

  RETURN jsonb_build_object(
    'outcome', 'ok',
    'status', 'draft',
    'responses', jsonb_build_object(
      'lead_name', COALESCE(_submission.lead_name, ''),
      'lead_email', COALESCE(_submission.lead_email, ''),
      'lead_whatsapp', COALESCE(_submission.lead_whatsapp, ''),
      'lead_company', COALESCE(_submission.lead_company, ''),
      'positioning', COALESCE(_submission.positioning, ''),
      'differential', COALESCE(_submission.differential, ''),
      'icp', COALESCE(_submission.icp, ''),
      'main_pains', COALESCE(_submission.main_pains, ''),
      'goals_12m', COALESCE(_submission.goals_12m, ''),
      'success_metric', COALESCE(_submission.success_metric, ''),
      'revenue_range', COALESCE(_submission.revenue_range, ''),
      'team_size', COALESCE(_submission.team_size, ''),
      'maturity_digital', COALESCE(_submission.maturity_digital, ''),
      'ai_readiness', COALESCE(_submission.ai_readiness, '')
    )
  );
END
$$;

REVOKE ALL ON FUNCTION public.load_quiz_invitation(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.load_quiz_invitation(text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.save_quiz_invitation(
  p_token_hash_hex text,
  p_responses jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _token app_private.quiz_invitation_tokens%ROWTYPE;
  _submission public.quiz_submissions%ROWTYPE;
BEGIN
  IF p_token_hash_hex IS NULL
     OR p_token_hash_hex !~ '^[0-9a-f]{64}$'
     OR NOT app_private.quiz_payload_is_valid(p_responses) THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;

  SELECT t.* INTO _token
  FROM app_private.quiz_invitation_tokens AS t
  WHERE t.token_hash = pg_catalog.decode(p_token_hash_hex, 'hex');

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;

  SELECT q.* INTO _submission
  FROM public.quiz_submissions AS q
  WHERE q.id = _token.submission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;

  SELECT t.* INTO _token
  FROM app_private.quiz_invitation_tokens AS t
  WHERE t.submission_id = _submission.id
    AND t.token_hash = pg_catalog.decode(p_token_hash_hex, 'hex')
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;

  IF _token.used_at IS NOT NULL OR _submission.status <> 'draft' THEN
    RETURN jsonb_build_object(
      'outcome', 'used',
      'status', _submission.status,
      'score', _submission.icp_fit_score,
      'plan', _submission.recommended_plan,
      'submitted_at', _submission.submitted_at
    );
  END IF;

  IF _token.expires_at <= now() THEN
    RETURN jsonb_build_object('outcome', 'expired');
  END IF;

  IF _token.action_count >= 500
     OR (
       _token.last_action_at IS NOT NULL
       AND _token.last_action_at > now() - interval '250 milliseconds'
     ) THEN
    RETURN jsonb_build_object('outcome', 'rate_limited');
  END IF;

  UPDATE public.quiz_submissions
  SET
    lead_name = COALESCE(p_responses ->> 'lead_name', lead_name),
    lead_email = COALESCE(p_responses ->> 'lead_email', lead_email),
    lead_whatsapp = COALESCE(p_responses ->> 'lead_whatsapp', lead_whatsapp),
    lead_company = COALESCE(p_responses ->> 'lead_company', lead_company),
    positioning = COALESCE(p_responses ->> 'positioning', positioning),
    differential = COALESCE(p_responses ->> 'differential', differential),
    icp = COALESCE(p_responses ->> 'icp', icp),
    main_pains = COALESCE(p_responses ->> 'main_pains', main_pains),
    goals_12m = COALESCE(p_responses ->> 'goals_12m', goals_12m),
    success_metric = COALESCE(p_responses ->> 'success_metric', success_metric),
    revenue_range = COALESCE(p_responses ->> 'revenue_range', revenue_range),
    team_size = COALESCE(p_responses ->> 'team_size', team_size),
    maturity_digital = COALESCE(p_responses ->> 'maturity_digital', maturity_digital),
    ai_readiness = COALESCE(p_responses ->> 'ai_readiness', ai_readiness),
    action_count = action_count + 1,
    last_action_at = now()
  WHERE id = _token.submission_id
    AND status = 'draft';

  RETURN jsonb_build_object('outcome', 'ok');
END
$$;

REVOKE ALL ON FUNCTION public.save_quiz_invitation(text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_quiz_invitation(text, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.submit_quiz_invitation(
  p_token_hash_hex text,
  p_responses jsonb,
  p_score integer,
  p_plan text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _token app_private.quiz_invitation_tokens%ROWTYPE;
  _submission public.quiz_submissions%ROWTYPE;
  _submitted_at timestamptz := now();
BEGIN
  IF p_token_hash_hex IS NULL
     OR p_token_hash_hex !~ '^[0-9a-f]{64}$'
     OR NOT app_private.quiz_payload_is_valid(p_responses)
     OR p_score IS NULL
     OR p_score NOT BETWEEN 0 AND 100
     OR p_plan IS NULL
     OR p_plan NOT IN ('starter', 'growth', 'enterprise') THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;

  SELECT t.* INTO _token
  FROM app_private.quiz_invitation_tokens AS t
  WHERE t.token_hash = pg_catalog.decode(p_token_hash_hex, 'hex');

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;

  SELECT q.* INTO _submission
  FROM public.quiz_submissions AS q
  WHERE q.id = _token.submission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;

  SELECT t.* INTO _token
  FROM app_private.quiz_invitation_tokens AS t
  WHERE t.submission_id = _submission.id
    AND t.token_hash = pg_catalog.decode(p_token_hash_hex, 'hex')
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;

  IF _token.used_at IS NOT NULL OR _submission.status <> 'draft' THEN
    RETURN jsonb_build_object(
      'outcome', 'used',
      'id', _submission.id,
      'status', _submission.status,
      'score', _submission.icp_fit_score,
      'plan', _submission.recommended_plan,
      'submitted_at', _submission.submitted_at,
      'idempotent', true
    );
  END IF;

  IF _token.expires_at <= now() THEN
    RETURN jsonb_build_object('outcome', 'expired');
  END IF;

  IF _token.action_count >= 500
     OR (
       _token.last_action_at IS NOT NULL
       AND _token.last_action_at > now() - interval '250 milliseconds'
     ) THEN
    RETURN jsonb_build_object('outcome', 'rate_limited');
  END IF;

  UPDATE public.quiz_submissions
  SET
    lead_name = p_responses ->> 'lead_name',
    lead_email = p_responses ->> 'lead_email',
    lead_whatsapp = p_responses ->> 'lead_whatsapp',
    lead_company = p_responses ->> 'lead_company',
    positioning = p_responses ->> 'positioning',
    differential = p_responses ->> 'differential',
    icp = p_responses ->> 'icp',
    main_pains = p_responses ->> 'main_pains',
    goals_12m = p_responses ->> 'goals_12m',
    success_metric = p_responses ->> 'success_metric',
    revenue_range = p_responses ->> 'revenue_range',
    team_size = p_responses ->> 'team_size',
    maturity_digital = p_responses ->> 'maturity_digital',
    ai_readiness = p_responses ->> 'ai_readiness',
    status = 'submitted',
    submitted_at = _submitted_at,
    icp_fit_score = p_score,
    recommended_plan = p_plan,
    action_count = action_count + 1,
    last_action_at = _submitted_at
  WHERE id = _token.submission_id
    AND status = 'draft';

  RETURN jsonb_build_object(
    'outcome', 'ok',
    'id', _token.submission_id,
    'status', 'submitted',
    'score', p_score,
    'plan', p_plan,
    'submitted_at', _submitted_at,
    'idempotent', false
  );
END
$$;

REVOKE ALL ON FUNCTION public.submit_quiz_invitation(text, jsonb, integer, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_quiz_invitation(text, jsonb, integer, text)
  TO service_role;

COMMENT ON SCHEMA app_private IS
  'Server-only token digests, authorization state and other non-API data.';
COMMENT ON TABLE app_private.first_access_tokens IS
  'SHA-256 digests and two-phase claim state for single-use first-access links.';
COMMENT ON TABLE app_private.quiz_invitation_tokens IS
  'SHA-256 digests and action state for public quiz invitations.';

NOTIFY pgrst, 'reload schema';