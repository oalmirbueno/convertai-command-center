-- Legacy objects that existed in production before the first tracked migration
-- that references them. This file is intentionally NOT part of the incremental
-- production migration ledger.
--
-- Usage:
--   * fresh/local or CI database: copy this file into migrations as
--     20260528163000_legacy_prerequisites.sql before `supabase db reset`;
--   * brand-new empty remote: apply this SQL once in a transaction before
--     `supabase db push`, without recording it in schema_migrations;
--   * existing production database: never apply this file.
--
-- The definitions below were reconstructed from PostgreSQL catalogs in the
-- production database on 2026-08-07. No table data or secret values were read.

CREATE TABLE IF NOT EXISTS public.quiz_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  submitted_at timestamptz,
  status text DEFAULT 'draft'
    CHECK (status = ANY (ARRAY['draft'::text, 'submitted'::text, 'processed'::text])),
  lead_name text,
  lead_email text,
  lead_whatsapp text,
  lead_company text,
  positioning text,
  differential text,
  icp text,
  main_pains text,
  goals_12m text,
  success_metric text,
  revenue_range text,
  team_size text,
  maturity_digital text,
  ai_readiness text,
  icp_fit_score integer,
  recommended_plan text,
  origin text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE public.quiz_submissions IS
  'Submissões do quiz público de diagnóstico. Alimenta o Aceleriq Ops com leads qualificados.';

CREATE INDEX IF NOT EXISTS idx_quiz_submissions_status
  ON public.quiz_submissions (status);
CREATE INDEX IF NOT EXISTS idx_quiz_submissions_token
  ON public.quiz_submissions (token);

ALTER TABLE public.quiz_submissions ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.quiz_submissions TO anon, authenticated, service_role;

-- The trigger already existed with the legacy table. A later tracked migration
-- replaces this function with its hardened final definition.
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

DROP TRIGGER IF EXISTS trg_quiz_submissions_touch ON public.quiz_submissions;
CREATE TRIGGER trg_quiz_submissions_touch
  BEFORE UPDATE ON public.quiz_submissions
  FOR EACH ROW EXECUTE FUNCTION public.touch_quiz_submission();

-- These functions are the portable form of the legacy email dispatcher. The
-- target URL and service-role token stay in Vault, never in source control.
-- A new environment must create both secrets before enabling the email worker:
--   email_queue_function_url
--   email_queue_service_role_key
CREATE OR REPLACE FUNCTION public.email_queue_dispatch()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  target_url text;
  service_key text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pgmq.q_auth_emails)
     AND NOT EXISTS (SELECT 1 FROM pgmq.q_transactional_emails) THEN
    BEGIN
      PERFORM pg_catalog.pg_advisory_xact_lock(7700000000000001);
      IF EXISTS (SELECT 1 FROM pgmq.q_auth_emails)
         OR EXISTS (SELECT 1 FROM pgmq.q_transactional_emails) THEN
        RETURN;
      END IF;
      PERFORM cron.unschedule('process-email-queue');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'email_queue_dispatch: cron unschedule failed: %', SQLERRM;
    END;
    RETURN;
  END IF;

  IF (SELECT retry_after_until FROM public.email_send_state WHERE id = 1) > now() THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO target_url
  FROM vault.decrypted_secrets
  WHERE name = 'email_queue_function_url'
  LIMIT 1;

  SELECT decrypted_secret INTO service_key
  FROM vault.decrypted_secrets
  WHERE name = 'email_queue_service_role_key'
  LIMIT 1;

  IF target_url IS NULL OR service_key IS NULL THEN
    RAISE WARNING 'email_queue_dispatch: Vault configuration missing';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := target_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Aceleriq-Context', 'cron',
      'Authorization', 'Bearer ' || service_key
    ),
    body := '{}'::jsonb
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.email_queue_wake()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  target_url text;
  service_key text;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(7700000000000001);
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-email-queue') THEN
    BEGIN
      PERFORM cron.schedule(
        'process-email-queue',
        '5 seconds',
        $cron$ SELECT public.email_queue_dispatch(); $cron$
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'email_queue_wake: cron schedule failed: %', SQLERRM;
    END;
  END IF;

  SELECT decrypted_secret INTO target_url
  FROM vault.decrypted_secrets
  WHERE name = 'email_queue_function_url'
  LIMIT 1;

  SELECT decrypted_secret INTO service_key
  FROM vault.decrypted_secrets
  WHERE name = 'email_queue_service_role_key'
  LIMIT 1;

  IF target_url IS NULL OR service_key IS NULL THEN
    RAISE WARNING 'email_queue_wake: Vault configuration missing';
    RETURN NULL;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url := target_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Aceleriq-Context', 'cron',
        'Authorization', 'Bearer ' || service_key
      ),
      body := '{}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'email_queue_wake failed (enqueue preserved): %', SQLERRM;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.email_queue_dispatch() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_queue_wake() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_queue_dispatch() TO service_role;
GRANT EXECUTE ON FUNCTION public.email_queue_wake() TO service_role;
