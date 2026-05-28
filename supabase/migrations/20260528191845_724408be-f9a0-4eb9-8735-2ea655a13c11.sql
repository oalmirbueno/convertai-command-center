ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS portal_password text,
  ADD COLUMN IF NOT EXISTS first_access_token text,
  ADD COLUMN IF NOT EXISTS first_access_used_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_profiles_first_access_token ON public.profiles (first_access_token) WHERE first_access_token IS NOT NULL;