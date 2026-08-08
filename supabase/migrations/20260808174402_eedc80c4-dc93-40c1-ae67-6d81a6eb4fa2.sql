CREATE TABLE IF NOT EXISTS public.ai_usage_hourly (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workload text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, workload, window_start),
  CONSTRAINT ai_usage_hourly_count_check
    CHECK (request_count BETWEEN 0 AND 500),
  CONSTRAINT ai_usage_hourly_workload_check
    CHECK (workload IN (
      'workspace-agent-chat',
      'workspace-agent-editor',
      'workspace-ocr',
      'workspace-agent-import'
    ))
);

ALTER TABLE public.ai_usage_hourly ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_usage_hourly
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_ai_usage(_workload text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _actor_id uuid := auth.uid();
  _limit integer;
  _window timestamptz := date_trunc('hour', statement_timestamp());
  _claimed integer;
BEGIN
  IF _actor_id IS NULL THEN
    RETURN false;
  END IF;

  _limit := CASE _workload
    WHEN 'workspace-agent-chat' THEN 120
    WHEN 'workspace-agent-editor' THEN 30
    WHEN 'workspace-ocr' THEN 20
    WHEN 'workspace-agent-import' THEN 10
    ELSE NULL
  END;
  IF _limit IS NULL THEN RETURN false; END IF;

  INSERT INTO public.ai_usage_hourly (
    user_id,
    workload,
    window_start,
    request_count
  ) VALUES (
    _actor_id,
    _workload,
    _window,
    1
  )
  ON CONFLICT (user_id, workload, window_start) DO UPDATE
  SET request_count = public.ai_usage_hourly.request_count + 1,
      updated_at = statement_timestamp()
  WHERE public.ai_usage_hourly.request_count < _limit
  RETURNING request_count INTO _claimed;

  RETURN _claimed IS NOT NULL;
END
$$;

REVOKE ALL ON FUNCTION public.claim_ai_usage(text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.claim_ai_usage(text)
  TO authenticated;