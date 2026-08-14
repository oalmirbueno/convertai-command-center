-- Previa visual no ranking de posts: o robo passa a guardar media_url e
-- thumbnail_url de cada publicacao coletada da Meta.

ALTER TABLE public.social_post_metrics
  ADD COLUMN IF NOT EXISTS media_url text,
  ADD COLUMN IF NOT EXISTS thumbnail_url text;

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
    RAISE EXCEPTION 'social_metrics_tick nao encontrada; rode antes as migrations de metricas';
  END IF;
  IF position('thumbnail_url' IN original_definition) > 0 THEN
    RAISE NOTICE 'tick ja coleta media_url/thumbnail_url; nada a fazer';
    RETURN;
  END IF;

  patched_definition := replace(
    original_definition,
    $a$(client_id, external_account_id, media_id, media_type, caption,
             permalink, posted_at, like_count, comments_count)$a$,
    $b$(client_id, external_account_id, media_id, media_type, caption,
             permalink, media_url, thumbnail_url, posted_at, like_count, comments_count)$b$
  );
  patched_definition := replace(
    patched_definition,
    $c$             _item->>'permalink',
             NULLIF(_item->>'timestamp', '')::timestamptz,$c$,
    $d$             _item->>'permalink',
             _item->>'media_url',
             _item->>'thumbnail_url',
             NULLIF(_item->>'timestamp', '')::timestamptz,$d$
  );
  patched_definition := replace(
    patched_definition,
    $e$                media_type = EXCLUDED.media_type,$e$,
    $f$                media_type = EXCLUDED.media_type,
                media_url = EXCLUDED.media_url,
                thumbnail_url = EXCLUDED.thumbnail_url,$f$
  );

  IF patched_definition = original_definition THEN
    RAISE EXCEPTION 'nenhuma alteracao produzida no tick; nada aplicado';
  END IF;
  EXECUTE patched_definition;
  RAISE NOTICE 'tick atualizado: previa visual dos posts habilitada';
END
$patch$;

-- Forca recoleta com os novos campos na proxima passada.
UPDATE public.social_post_metrics SET captured_at = now() - interval '4 days';
