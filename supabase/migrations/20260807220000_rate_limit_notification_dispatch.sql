CREATE TABLE IF NOT EXISTS public.notification_dispatch_hourly (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, window_start),
  CONSTRAINT notification_dispatch_count_check
    CHECK (request_count BETWEEN 0 AND 120)
);

ALTER TABLE public.notification_dispatch_hourly ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.notification_dispatch_hourly
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_notification_dispatch()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _actor_id uuid := auth.uid();
  _window timestamptz := date_trunc('hour', statement_timestamp());
  _limit integer;
  _claimed integer;
BEGIN
  IF _actor_id IS NULL THEN RETURN false; END IF;
  _limit := CASE WHEN public.is_staff(_actor_id) THEN 120 ELSE 10 END;

  INSERT INTO public.notification_dispatch_hourly (
    user_id,
    window_start,
    request_count
  ) VALUES (
    _actor_id,
    _window,
    1
  )
  ON CONFLICT (user_id, window_start) DO UPDATE
  SET request_count = public.notification_dispatch_hourly.request_count + 1,
      updated_at = statement_timestamp()
  WHERE public.notification_dispatch_hourly.request_count < _limit
  RETURNING request_count INTO _claimed;

  RETURN _claimed IS NOT NULL;
END
$$;

REVOKE ALL ON FUNCTION public.claim_notification_dispatch()
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.claim_notification_dispatch()
  TO authenticated;
