-- Views por post (12/10/2026): o "O que performou" passa a ordenar por múltiplo (views ou alcance do
-- post dividido pela mediana do perfil), como no yt-viral e no ig-audience-insights.
--
-- Testado antes na Meta, com o token da própria coleta e sem expor a URL: na v21, a métrica `views`
-- responde 200 para VIDEO, IMAGE e CAROUSEL_ALBUM junto com reach, saved, shares e total_interactions.
--
-- Só amplia e é idempotente: coluna nova (nula até o post ser recoletado), a URL dos insights com views
-- e um remendo cirúrgico no tick, ancorado no texto vivo (falha alto se a âncora mudou), como em
-- 20260901030000. Rollback: tirar `,views` da URL e o trecho do remendo; a coluna pode ficar.

ALTER TABLE public.social_post_metrics ADD COLUMN IF NOT EXISTS views integer;

CREATE OR REPLACE FUNCTION social_private.social_metrics_url(
  _kind text, _ig text, _token text, _week_start date, _week_end date,
  _after text default null
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
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
      || '&limit=100'
      || COALESCE('&after=' || _after, '')
      || '&access_token=' || _token
    WHEN 'post_insights' THEN
      'https://graph.facebook.com/v21.0/' || _ig
      || '/insights?metric=reach,saved,shares,total_interactions,views&access_token=' || _token
    WHEN 'identity' THEN
      'https://graph.facebook.com/v21.0/' || _ig
      || '?fields=username,name,biography,website,profile_picture_url&access_token=' || _token
    ELSE
      'https://graph.facebook.com/v21.0/' || _ig
      || '/insights?metric=profile_views,accounts_engaged,total_interactions'
      || '&metric_type=total_value&period=day&since=' || _week_start::text
      || '&until=' || (_week_end + 1)::text || '&access_token=' || _token
  END;
$function$;

do $patch$
declare
  _def text;
  _oid oid;
  _ancora constant text := $a$          insights_captured_at = now()
        WHERE external_account_id = _req.external_account_id
          AND media_id = _req.media_id;$a$;
  _novo constant text := $n$          views = COALESCE((SELECT NULLIF(m#>>'{values,0,value}', '')::integer
            FROM jsonb_array_elements(COALESCE(_body->'data', '[]'::jsonb)) AS m
            WHERE m->>'name' = 'views' LIMIT 1), views),
          insights_captured_at = now()
        WHERE external_account_id = _req.external_account_id
          AND media_id = _req.media_id;$n$;
begin
  select p.oid into _oid from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'social_metrics_tick';
  if _oid is null then
    raise exception 'patch_alvo_ausente: social_metrics_tick nao existe';
  end if;
  _def := pg_get_functiondef(_oid);
  -- Idempotente: já remendado, nada a fazer.
  if position($v$WHERE m->>'name' = 'views'$v$ in _def) > 0 then
    return;
  end if;
  if position(_ancora in _def) = 0 then
    raise exception 'patch_ancora_nao_encontrada: o bloco post_insights do tick mudou de forma';
  end if;
  _def := replace(_def, _ancora, _novo);
  execute _def;
end $patch$;
