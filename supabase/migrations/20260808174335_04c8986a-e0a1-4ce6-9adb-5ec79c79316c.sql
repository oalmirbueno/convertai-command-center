ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_access_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_access_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_access_last_attempt_at timestamptz;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_first_access_attempts_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_first_access_attempts_check
  CHECK (first_access_attempts BETWEEN 0 AND 10);

-- Invalidate bearer links created before an expiry contract existed.
UPDATE public.profiles
SET first_access_expires_at = COALESCE(first_access_expires_at, now())
WHERE first_access_token IS NOT NULL
  AND first_access_used_at IS NULL;

CREATE INDEX IF NOT EXISTS profiles_active_first_access_idx
  ON public.profiles (first_access_token, first_access_expires_at)
  WHERE first_access_token IS NOT NULL
    AND first_access_used_at IS NULL;