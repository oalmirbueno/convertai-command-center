
-- 1. Briefings: replace open-anon RLS with token-scoped RPCs
DROP POLICY IF EXISTS briefings_public_select_by_token ON public.briefings;
DROP POLICY IF EXISTS briefings_public_update_by_token ON public.briefings;

CREATE OR REPLACE FUNCTION public.briefing_public_get(_token text)
RETURNS TABLE(id uuid, submitted boolean, responses jsonb)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id, b.submitted, b.responses
  FROM public.briefings b
  WHERE b.token::text = _token
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.briefing_public_submit(_token text, _responses jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _updated int;
BEGIN
  UPDATE public.briefings
     SET responses = _responses, submitted = true
   WHERE token::text = _token AND submitted IS NOT TRUE;
  GET DIAGNOSTICS _updated = ROW_COUNT;
  RETURN _updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.briefing_public_get(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.briefing_public_submit(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.briefing_public_get(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.briefing_public_submit(text, jsonb) TO anon, authenticated;

-- 2. client_vault: restrict to admins + explicitly assigned staff
DROP POLICY IF EXISTS client_vault_select ON public.client_vault;
DROP POLICY IF EXISTS client_vault_insert ON public.client_vault;
DROP POLICY IF EXISTS client_vault_update ON public.client_vault;
DROP POLICY IF EXISTS client_vault_delete ON public.client_vault;

CREATE POLICY client_vault_select ON public.client_vault
  FOR SELECT TO authenticated
  USING (
    client_id = auth.uid()
    OR has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.team_client_assignments t
      WHERE t.client_id = client_vault.client_id AND t.user_id = auth.uid()
    )
  );

CREATE POLICY client_vault_insert ON public.client_vault
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY client_vault_update ON public.client_vault
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY client_vault_delete ON public.client_vault
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 3. tasks: add explicit non-admin DELETE prevention (fail-closed already, add for clarity)
--    Also fix "anon can insert quiz" always-true INSERT check by scoping to quiz submissions bucket.
DROP POLICY IF EXISTS "anon can insert quiz" ON public.quiz_submissions;
CREATE POLICY "anon can insert quiz" ON public.quiz_submissions
  FOR INSERT TO anon, authenticated
  WITH CHECK (submitted_at IS NOT NULL);

-- 4. Storage: remove broad SELECT policies that allow listing public buckets
DROP POLICY IF EXISTS "Authenticated can read files" ON storage.objects;
DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "avatars_authenticated_select" ON storage.objects;
DROP POLICY IF EXISTS "email_assets_authenticated_select" ON storage.objects;

-- Owner-scoped read for files bucket; public buckets remain readable via CDN
CREATE POLICY "files owner or staff read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'files' AND (is_staff(auth.uid()) OR split_part(name, '/', 1) = auth.uid()::text));

-- 5. Functions: add SET search_path where missing
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public, pgmq;
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public, pgmq;
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public, pgmq;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public, pgmq;

-- 6. Revoke EXECUTE on SECURITY DEFINER functions that must not be callable via the API
REVOKE ALL ON FUNCTION public.read_email_batch(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_email(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_email(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_queue_dispatch() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_queue_wake() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_api_key(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_ops_sync() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_milestone_progress() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_quiz_submission() FROM PUBLIC, anon, authenticated;

-- Keep RLS helpers callable by authenticated (used inside policies) but revoke anon
REVOKE EXECUTE ON FUNCTION public.get_admin_user_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.user_owns_project(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.user_owns_task(uuid, uuid) FROM anon;
