
-- 1. Fix touch_quiz_submission search_path
CREATE OR REPLACE FUNCTION public.touch_quiz_submission()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

-- 2. Revoke EXECUTE on SECURITY DEFINER functions from public/anon/authenticated;
-- keep only what's needed. validate_api_key is only called from edge functions (service_role).
-- has_role, is_staff, user_owns_project, user_owns_task, get_admin_user_id are called inside RLS
-- so they need to be executable by authenticated users.
-- enqueue/read/delete/move_to_dlq email functions, update_milestone_progress, notify_ops_sync,
-- handle_new_user, update_updated_at_column should not be callable directly by clients.

REVOKE EXECUTE ON FUNCTION public.validate_api_key(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_milestone_progress() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_ops_sync() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_quiz_submission() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_admin_user_id() FROM PUBLIC, anon;

-- 3. Tighten recharge_requests INSERT — clients can only create their own
DROP POLICY IF EXISTS recharge_requests_insert ON public.recharge_requests;
CREATE POLICY recharge_requests_insert ON public.recharge_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    client_id = auth.uid()
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'traffic'::app_role)
  );

-- 4. Restrict listing on public storage buckets (avatars, email-assets, files)
-- Public reads of known URLs still work; only LIST/scan via API is restricted.
DROP POLICY IF EXISTS "Public read avatars" ON storage.objects;
DROP POLICY IF EXISTS "Public can read avatars" ON storage.objects;
DROP POLICY IF EXISTS "Avatars are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "avatars_public_select" ON storage.objects;
DROP POLICY IF EXISTS "email_assets_public_select" ON storage.objects;
DROP POLICY IF EXISTS "Public read email-assets" ON storage.objects;

-- Restrict listing to authenticated users for public buckets
CREATE POLICY "avatars_authenticated_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'avatars');

CREATE POLICY "email_assets_authenticated_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'email-assets');

-- 5. Realtime channel authorization — restrict topic subscriptions to authorized users
-- Topic convention: "user:<uid>", "project:<project_id>", "client:<client_id>"
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can subscribe to authorized topics" ON realtime.messages;
CREATE POLICY "Authenticated can subscribe to authorized topics"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    -- Personal user channel
    (realtime.topic() = 'user:' || auth.uid()::text)
    -- Staff can subscribe to any topic
    OR public.is_staff(auth.uid())
    -- Project topic the user owns
    OR (
      realtime.topic() LIKE 'project:%'
      AND public.user_owns_project(auth.uid(), NULLIF(SPLIT_PART(realtime.topic(), ':', 2), '')::uuid)
    )
    -- Client topic = self
    OR (realtime.topic() = 'client:' || auth.uid()::text)
  );
