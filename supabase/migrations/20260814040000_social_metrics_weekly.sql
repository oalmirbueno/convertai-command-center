-- Metricas REAIS do Instagram, coletadas toda semana sem mao humana.
-- Mesmo padrao ja provado pelo motor de publicacao: pg_net + pg_cron +
-- token da conta no Vault (social_private.autopublish_account_token).
--
-- O que entra por semana fechada (segunda a domingo, horario de Sao Paulo):
--   followers, media_count (foto do perfil no fim da semana)
--   reach (soma diaria da semana)
--   profile_views, accounts_engaged, total_interactions (total da semana)
-- Historico fica em public.social_metrics_weekly (staff ve tudo; cliente ve
-- so o proprio). Escrita apenas pelo worker.

-- ───────────────────────────── 1) Historico ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.social_metrics_weekly (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  external_account_id uuid NOT NULL REFERENCES public.external_accounts(id) ON DELETE CASCADE,
  platform text NOT NULL DEFAULT 'instagram',
  week_start date NOT NULL,
  week_end date NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  followers integer,
  media_count integer,
  reach integer,
  profile_views integer,
  accounts_engaged integer,
  total_interactions integer,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (external_account_id, week_start)
);

CREATE INDEX IF NOT EXISTS social_metrics_weekly_client_idx
  ON public.social_metrics_weekly (client_id, week_start DESC);

ALTER TABLE public.social_metrics_weekly ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS social_metrics_weekly_staff_read ON public.social_metrics_weekly;
CREATE POLICY social_metrics_weekly_staff_read ON public.social_metrics_weekly
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) AND public.can_access_client(client_id));

DROP POLICY IF EXISTS social_metrics_weekly_client_read ON public.social_metrics_weekly;
CREATE POLICY social_metrics_weekly_client_read ON public.social_metrics_weekly
  FOR SELECT TO authenticated
  USING (client_id = auth.uid());

REVOKE INSERT, UPDATE, DELETE ON public.social_metrics_weekly FROM anon, authenticated;
GRANT SELECT ON public.social_metrics_weekly TO authenticated;

-- ─────────────────── 2) Fila de requisicoes (pg_net e assincrono) ───────────
CREATE TABLE IF NOT EXISTS social_private.social_metrics_requests (
  id bigserial PRIMARY KEY,
  external_account_id uuid NOT NULL,
  client_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('profile', 'reach', 'engage')),
  request_id bigint,
  week_start date NOT NULL,
  week_end date NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────── 3) Montador de URL ─────────────────────────
CREATE OR REPLACE FUNCTION social_private.social_metrics_url(
  _kind text, _ig text, _token text, _week_start date, _week_end date
)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT CASE _kind
    WHEN 'profile' THEN
      'https://graph.facebook.com/v21.0/' || _ig
      || '?fields=followers_count,media_count&access_token=' || _token
    WHEN 'reach' THEN
      'https://graph.facebook.com/v21.0/' || _ig
      || '/insights?metric=reach&period=day&since=' || _week_start::text
      || '&until=' || (_week_end + 1)::text || '&access_token=' || _token
    ELSE
      'https://graph.facebook.com/v21.0/' || _ig
      || '/insights?metric=profile_views,accounts_engaged,total_interactions'
      || '&metric_type=total_value&period=day&since=' || _week_start::text
      || '&until=' || (_week_end + 1)::text || '&access_token=' || _token
  END;
$function$;

-- ─────────────────────────────── 4) Tick ────────────────────────────────
CREATE OR REPLACE FUNCTION public.social_metrics_tick()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  _week_start date;
  _week_end date;
  _req record;
  _acct record;
  _status integer;
  _content text;
  _body jsonb;
  _token_resource text;
  _token_secret text;
  _url text;
  _rid bigint;
  _kind text;
  _sum bigint;
  _dispatched integer := 0;
  _parsed integer := 0;
BEGIN
  -- Ultima semana FECHADA: segunda a domingo, no fuso de Sao Paulo.
  _week_start := date_trunc(
    'week', (now() AT TIME ZONE 'America/Sao_Paulo')::date::timestamp
  )::date - 7;
  _week_end := _week_start + 6;

  -- A) Colhe respostas que ja chegaram
  FOR _req IN
    SELECT * FROM social_private.social_metrics_requests
    WHERE request_id IS NOT NULL
    ORDER BY id
  LOOP
    SELECT r.status_code, r.content INTO _status, _content
    FROM net._http_response AS r WHERE r.id = _req.request_id;
    IF NOT FOUND THEN
      -- Resposta perdida: libera para redespacho depois de 30 minutos.
      IF _req.created_at < now() - interval '30 minutes' THEN
        UPDATE social_private.social_metrics_requests
        SET request_id = NULL, attempts = attempts + 1 WHERE id = _req.id;
      END IF;
      CONTINUE;
    END IF;

    BEGIN
      _body := _content::jsonb;
    EXCEPTION WHEN others THEN
      _body := jsonb_build_object('parse_error', left(COALESCE(_content, ''), 500));
    END;

    IF _status BETWEEN 200 AND 299 AND NOT (_body ? 'error') THEN
      IF _req.kind = 'profile' THEN
        INSERT INTO public.social_metrics_weekly AS w
          (client_id, external_account_id, week_start, week_end, followers, media_count, raw)
        VALUES
          (_req.client_id, _req.external_account_id, _req.week_start, _req.week_end,
           NULLIF(_body->>'followers_count', '')::integer,
           NULLIF(_body->>'media_count', '')::integer,
           jsonb_build_object('profile', _body))
        ON CONFLICT (external_account_id, week_start) DO UPDATE
          SET followers = EXCLUDED.followers,
              media_count = EXCLUDED.media_count,
              captured_at = now(),
              raw = w.raw || EXCLUDED.raw;
      ELSIF _req.kind = 'reach' THEN
        SELECT COALESCE(SUM(NULLIF(v->>'value', '')::bigint), 0) INTO _sum
        FROM jsonb_array_elements(COALESCE(_body#>'{data,0,values}', '[]'::jsonb)) AS v;
        INSERT INTO public.social_metrics_weekly AS w
          (client_id, external_account_id, week_start, week_end, reach, raw)
        VALUES
          (_req.client_id, _req.external_account_id, _req.week_start, _req.week_end,
           _sum::integer, jsonb_build_object('reach', _body))
        ON CONFLICT (external_account_id, week_start) DO UPDATE
          SET reach = EXCLUDED.reach,
              captured_at = now(),
              raw = w.raw || EXCLUDED.raw;
      ELSE
        INSERT INTO public.social_metrics_weekly AS w
          (client_id, external_account_id, week_start, week_end,
           profile_views, accounts_engaged, total_interactions, raw)
        VALUES
          (_req.client_id, _req.external_account_id, _req.week_start, _req.week_end,
           (SELECT NULLIF(m#>>'{total_value,value}', '')::integer
              FROM jsonb_array_elements(COALESCE(_body->'data', '[]'::jsonb)) AS m
              WHERE m->>'name' = 'profile_views' LIMIT 1),
           (SELECT NULLIF(m#>>'{total_value,value}', '')::integer
              FROM jsonb_array_elements(COALESCE(_body->'data', '[]'::jsonb)) AS m
              WHERE m->>'name' = 'accounts_engaged' LIMIT 1),
           (SELECT NULLIF(m#>>'{total_value,value}', '')::integer
              FROM jsonb_array_elements(COALESCE(_body->'data', '[]'::jsonb)) AS m
              WHERE m->>'name' = 'total_interactions' LIMIT 1),
           jsonb_build_object('engage', _body))
        ON CONFLICT (external_account_id, week_start) DO UPDATE
          SET profile_views = EXCLUDED.profile_views,
              accounts_engaged = EXCLUDED.accounts_engaged,
              total_interactions = EXCLUDED.total_interactions,
              captured_at = now(),
              raw = w.raw || EXCLUDED.raw;
      END IF;
      _parsed := _parsed + 1;
      DELETE FROM social_private.social_metrics_requests WHERE id = _req.id;
    ELSE
      IF _req.attempts >= 3 THEN
        -- Registra o erro no historico (sem travar as outras metricas) e para.
        INSERT INTO public.social_metrics_weekly AS w
          (client_id, external_account_id, week_start, week_end, raw)
        VALUES
          (_req.client_id, _req.external_account_id, _req.week_start, _req.week_end,
           jsonb_build_object('error_' || _req.kind, _body))
        ON CONFLICT (external_account_id, week_start) DO UPDATE
          SET raw = w.raw || EXCLUDED.raw, captured_at = now();
        DELETE FROM social_private.social_metrics_requests WHERE id = _req.id;
      ELSE
        UPDATE social_private.social_metrics_requests
        SET attempts = attempts + 1, request_id = NULL WHERE id = _req.id;
      END IF;
    END IF;
  END LOOP;

  -- B) Redespacha pendentes sem requisicao no ar
  FOR _req IN
    SELECT * FROM social_private.social_metrics_requests
    WHERE request_id IS NULL ORDER BY id
  LOOP
    SELECT t.resource_id, t.access_token INTO _token_resource, _token_secret
    FROM social_private.autopublish_account_token(_req.external_account_id) AS t;
    IF _token_secret IS NULL THEN
      DELETE FROM social_private.social_metrics_requests WHERE id = _req.id;
      CONTINUE;
    END IF;
    _url := social_private.social_metrics_url(
      _req.kind, _token_resource, _token_secret, _req.week_start, _req.week_end);
    SELECT net.http_get(url := _url) INTO _rid;
    UPDATE social_private.social_metrics_requests
    SET request_id = _rid, created_at = now() WHERE id = _req.id;
    _dispatched := _dispatched + 1;
  END LOOP;

  -- C) Abre a coleta da semana fechada para contas que ainda nao tem
  FOR _acct IN
    SELECT account.id, account.client_id
    FROM public.external_accounts AS account
    WHERE account.platform = 'instagram'
      AND account.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM public.social_metrics_weekly AS w
        WHERE w.external_account_id = account.id
          AND w.week_start = _week_start
          AND w.followers IS NOT NULL
          AND (w.reach IS NOT NULL OR w.raw ? 'error_reach')
          AND (w.total_interactions IS NOT NULL OR w.raw ? 'error_engage')
      )
      AND NOT EXISTS (
        SELECT 1 FROM social_private.social_metrics_requests AS r
        WHERE r.external_account_id = account.id AND r.week_start = _week_start
      )
  LOOP
    SELECT t.resource_id, t.access_token INTO _token_resource, _token_secret
    FROM social_private.autopublish_account_token(_acct.id) AS t;
    IF _token_secret IS NULL THEN CONTINUE; END IF;
    FOREACH _kind IN ARRAY ARRAY['profile', 'reach', 'engage'] LOOP
      _url := social_private.social_metrics_url(
        _kind, _token_resource, _token_secret, _week_start, _week_end);
      SELECT net.http_get(url := _url) INTO _rid;
      INSERT INTO social_private.social_metrics_requests
        (external_account_id, client_id, kind, request_id, week_start, week_end)
      VALUES (_acct.id, _acct.client_id, _kind, _rid, _week_start, _week_end);
      _dispatched := _dispatched + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'week_start', _week_start,
    'dispatched', _dispatched,
    'parsed', _parsed
  );
END
$function$;

REVOKE ALL ON FUNCTION public.social_metrics_tick() FROM PUBLIC, anon, authenticated;

-- ─────────────── 5) Atualizar agora, pela equipe, direto do painel ───────────
CREATE OR REPLACE FUNCTION public.collect_social_metrics_now()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'somente a equipe pode atualizar as metricas';
  END IF;
  RETURN public.social_metrics_tick();
END
$function$;

REVOKE ALL ON FUNCTION public.collect_social_metrics_now() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.collect_social_metrics_now() TO authenticated;

-- ────────────────────────────── 6) Cron ─────────────────────────────────
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('social-metrics');
    EXCEPTION WHEN others THEN
      NULL;
    END;
    PERFORM cron.schedule(
      'social-metrics',
      '*/10 * * * *',
      'SELECT public.social_metrics_tick();'
    );
    RAISE NOTICE 'coleta de metricas agendada (a cada 10 min; so trabalha quando falta semana)';
  ELSE
    RAISE NOTICE 'pg_cron indisponivel: chame public.social_metrics_tick() por outro agendador';
  END IF;
END
$cron$;
