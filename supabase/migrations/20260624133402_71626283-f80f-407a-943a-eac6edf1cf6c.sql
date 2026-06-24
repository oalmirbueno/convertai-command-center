
-- Allow anonymous public access to a briefing by its unguessable token (UUID).
-- The token IS the secret. The public diagnostic page (/briefing/:token) needs
-- anon SELECT to load the briefing and UPDATE to submit it.
GRANT SELECT, UPDATE ON public.briefings TO anon;

DROP POLICY IF EXISTS briefings_public_select_by_token ON public.briefings;
CREATE POLICY briefings_public_select_by_token ON public.briefings
  FOR SELECT TO anon
  USING (token IS NOT NULL);

DROP POLICY IF EXISTS briefings_public_update_by_token ON public.briefings;
CREATE POLICY briefings_public_update_by_token ON public.briefings
  FOR UPDATE TO anon
  USING (token IS NOT NULL AND submitted IS NOT TRUE)
  WITH CHECK (token IS NOT NULL);
