ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS audience text;

UPDATE public.api_keys
SET audience = 'mcp'
WHERE audience IS NULL
  AND lower(btrim(origin)) = 'mcp';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.api_keys'::regclass
      AND conname = 'api_keys_audience_not_blank'
  ) THEN
    ALTER TABLE public.api_keys
      ADD CONSTRAINT api_keys_audience_not_blank
      CHECK (audience IS NULL OR audience = btrim(audience) AND audience <> '');
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS api_keys_active_audience_idx
  ON public.api_keys (audience, is_active, revoked_at)
  WHERE is_active = true AND revoked_at IS NULL;

CREATE OR REPLACE FUNCTION public.validate_api_key_for_audience(
  _key_hash text,
  _audience text
)
RETURNS TABLE(
  id uuid,
  name text,
  scopes text[],
  origin text,
  audience text,
  created_by uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT k.id, k.name, k.scopes, k.origin, k.audience, k.created_by
  FROM public.api_keys AS k
  WHERE k.key_hash = _key_hash
    AND k.audience = _audience
    AND _audience IS NOT NULL
    AND _audience <> ''
    AND k.is_active = true
    AND k.revoked_at IS NULL
    AND (k.expires_at IS NULL OR k.expires_at > now())
  LIMIT 1
$$;

COMMENT ON COLUMN public.api_keys.audience IS
  'Credential consumer boundary. Examples: api-gateway or mcp. NULL is denied by audience-aware consumers.';

COMMENT ON FUNCTION public.validate_api_key_for_audience(text, text) IS
  'Validates an active API key only for its exact credential audience.';

REVOKE ALL ON FUNCTION public.validate_api_key_for_audience(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_api_key_for_audience(text, text)
  TO service_role;