-- Mergulho por publicacao: alcance, salvamentos, compartilhamentos e total de
-- interacoes de cada post (1 chamada por post, ate 8 por passada, posts dos
-- ultimos 45 dias). Erros da Meta em post individual nao travam o resto.

ALTER TABLE public.social_post_metrics
  ADD COLUMN IF NOT EXISTS reach integer,
  ADD COLUMN IF NOT EXISTS saved integer,
  ADD COLUMN IF NOT EXISTS shares integer,
  ADD COLUMN IF NOT EXISTS total_interactions integer,
  ADD COLUMN IF NOT EXISTS insights_captured_at timestamptz;

ALTER TABLE social_private.social_metrics_requests
  ADD COLUMN IF NOT EXISTS media_id text;
ALTER TABLE social_private.social_metrics_requests
  DROP CONSTRAINT IF EXISTS social_metrics_requests_kind_check;
ALTER TABLE social_private.social_metrics_requests
  ADD CONSTRAINT social_metrics_requests_kind_check
  CHECK (kind IN ('profile', 'reach', 'engage', 'posts', 'post_insights'));

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
    WHEN 'posts' THEN
      'https://graph.facebook.com/v21.0/' || _ig
      || '/media?fields=id,caption,timestamp,media_type,permalink,like_count,comments_count,media_url,thumbnail_url'
      || '&limit=25&access_token=' || _token
    WHEN 'post_insights' THEN
      'https://graph.facebook.com/v21.0/' || _ig
      || '/insights?metric=reach,saved,shares,total_interactions&access_token=' || _token
    ELSE
      'https://graph.facebook.com/v21.0/' || _ig
      || '/insights?metric=profile_views,accounts_engaged,total_interactions'
      || '&metric_type=total_value&period=day&since=' || _week_start::text
      || '&until=' || (_week_end + 1)::text || '&access_token=' || _token
  END;
$function$;

DO $patch$
DECLARE
  original_definition text;
  patched_definition text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO original_definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'social_metrics_tick';

  IF original_definition IS NULL THEN
    RAISE EXCEPTION 'social_metrics_tick nao encontrada; rode as migrations de metricas antes';
  END IF;
  IF position('post_insights' IN original_definition) > 0 THEN
    RAISE NOTICE 'mergulho por post ja habilitado; nada a fazer';
    RETURN;
  END IF;
  IF position('thumbnail_url' IN original_definition) = 0 THEN
    RAISE EXCEPTION 'rode antes a migration das previas (media_url/thumbnail)';
  END IF;

  -- Novo ramo de parse antes do ELSE final do bloco de respostas.
  patched_definition := replace(
    original_definition,
    $a$      ELSE
        INSERT INTO public.social_metrics_weekly AS w
          (client_id, external_account_id, week_start, week_end,
           profile_views, accounts_engaged, total_interactions, raw)$a$,
    $b$      ELSIF _req.kind = 'post_insights' THEN
        UPDATE public.social_post_metrics
        SET
          reach = COALESCE((SELECT NULLIF(m#>>'{values,0,value}', '')::integer
            FROM jsonb_array_elements(COALESCE(_body->'data', '[]'::jsonb)) AS m
            WHERE m->>'name' = 'reach' LIMIT 1), reach),
          saved = COALESCE((SELECT NULLIF(m#>>'{values,0,value}', '')::integer
            FROM jsonb_array_elements(COALESCE(_body->'data', '[]'::jsonb)) AS m
            WHERE m->>'name' = 'saved' LIMIT 1), saved),
          shares = COALESCE((SELECT NULLIF(m#>>'{values,0,value}', '')::integer
            FROM jsonb_array_elements(COALESCE(_body->'data', '[]'::jsonb)) AS m
            WHERE m->>'name' = 'shares' LIMIT 1), shares),
          total_interactions = COALESCE((SELECT NULLIF(m#>>'{values,0,value}', '')::integer
            FROM jsonb_array_elements(COALESCE(_body->'data', '[]'::jsonb)) AS m
            WHERE m->>'name' = 'total_interactions' LIMIT 1), total_interactions),
          insights_captured_at = now()
        WHERE external_account_id = _req.external_account_id
          AND media_id = _req.media_id;
      ELSE
        INSERT INTO public.social_metrics_weekly AS w
          (client_id, external_account_id, week_start, week_end,
           profile_views, accounts_engaged, total_interactions, raw)$b$
  );

  -- Falha definitiva em post individual: marca como tentado e segue.
  patched_definition := replace(
    patched_definition,
    $c$      IF _req.attempts >= 3 THEN
        IF _req.kind <> 'posts' THEN$c$,
    $d$      IF _req.attempts >= 3 THEN
        IF _req.kind = 'post_insights' THEN
          UPDATE public.social_post_metrics
          SET insights_captured_at = now()
          WHERE external_account_id = _req.external_account_id
            AND media_id = _req.media_id;
        END IF;
        IF _req.kind NOT IN ('posts', 'post_insights') THEN$d$
  );

  -- Redespacho usa o media_id como alvo quando o tipo e post_insights.
  patched_definition := replace(
    patched_definition,
    $e$    _url := social_private.social_metrics_url(
      _req.kind, _token_resource, _token_secret, _req.week_start, _req.week_end);$e$,
    $f$    _url := social_private.social_metrics_url(
      _req.kind,
      CASE WHEN _req.kind = 'post_insights' THEN _req.media_id ELSE _token_resource END,
      _token_secret, _req.week_start, _req.week_end);$f$
  );

  -- Novo loop de despacho: ate 8 posts sem mergulho por passada.
  patched_definition := replace(
    patched_definition,
    $g$  RETURN jsonb_build_object(
    'week_start', _week_start,$g$,
    $h$  FOR _req IN
    SELECT p.external_account_id, p.client_id, p.media_id
    FROM public.social_post_metrics AS p
    WHERE p.insights_captured_at IS NULL
      AND p.posted_at > now() - interval '45 days'
      AND NOT EXISTS (
        SELECT 1 FROM social_private.social_metrics_requests AS r
        WHERE r.kind = 'post_insights' AND r.media_id = p.media_id
      )
    ORDER BY p.posted_at DESC
    LIMIT 8
  LOOP
    SELECT t.resource_id, t.access_token INTO _token_resource, _token_secret
    FROM social_private.autopublish_account_token(_req.external_account_id) AS t;
    IF _token_secret IS NULL THEN CONTINUE; END IF;
    _url := social_private.social_metrics_url(
      'post_insights', _req.media_id, _token_secret, _week_start, _week_end);
    SELECT net.http_get(url := _url) INTO _rid;
    INSERT INTO social_private.social_metrics_requests
      (external_account_id, client_id, kind, request_id, week_start, week_end, media_id)
    VALUES (_req.external_account_id, _req.client_id, 'post_insights', _rid,
            _week_start, _week_end, _req.media_id);
    _dispatched := _dispatched + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'week_start', _week_start,$h$
  );

  IF patched_definition = original_definition THEN
    RAISE EXCEPTION 'nenhuma alteracao produzida no tick; nada aplicado';
  END IF;
  EXECUTE patched_definition;
  RAISE NOTICE 'mergulho por post habilitado: reach, saved, shares por publicacao';
END
$patch$;
