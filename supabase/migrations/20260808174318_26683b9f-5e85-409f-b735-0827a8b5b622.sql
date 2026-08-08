ALTER TABLE public.quiz_submissions
  ADD COLUMN IF NOT EXISTS invitation_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS action_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_action_at timestamptz;

ALTER TABLE public.quiz_submissions
  DROP CONSTRAINT IF EXISTS quiz_submissions_action_count_check;
ALTER TABLE public.quiz_submissions
  ADD CONSTRAINT quiz_submissions_action_count_check
  CHECK (action_count BETWEEN 0 AND 500);

-- Drafts created before invitations were server-issued cannot be trusted as
-- public bearer links. Submitted records remain available to staff reports.
UPDATE public.quiz_submissions
SET invitation_expires_at = COALESCE(invitation_expires_at, now())
WHERE status = 'draft';

CREATE INDEX IF NOT EXISTS quiz_submissions_active_invitation_idx
  ON public.quiz_submissions (token, invitation_expires_at)
  WHERE status = 'draft';

CREATE OR REPLACE FUNCTION public.issue_quiz_invitation()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _actor_id uuid := auth.uid();
  _token text;
BEGIN
  IF _actor_id IS NULL OR NOT public.is_staff(_actor_id) THEN
    RAISE EXCEPTION 'quiz invitation access denied';
  END IF;

  _token := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.quiz_submissions (
    token,
    status,
    origin,
    invitation_expires_at
  ) VALUES (
    _token,
    'draft',
    'portal_admin',
    now() + interval '14 days'
  );
  RETURN _token;
END
$$;

REVOKE ALL ON FUNCTION public.issue_quiz_invitation()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_quiz_invitation()
  TO authenticated;

DROP POLICY IF EXISTS "anon can insert quiz" ON public.quiz_submissions;