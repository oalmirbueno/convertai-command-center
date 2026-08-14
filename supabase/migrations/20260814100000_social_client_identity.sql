-- Identidade visual do cliente puxada do Instagram (foto de perfil, @, nome,
-- bio e site), pelo mesmo robo de metricas. Atualiza a cada 7 dias por conta.

CREATE TABLE IF NOT EXISTS public.social_client_identity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  external_account_id uuid NOT NULL REFERENCES public.external_accounts(id) ON DELETE CASCADE,
  username text,
  display_name text,
  biography text,
  website text,
  profile_picture_url text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (external_account_id)
);

ALTER TABLE public.social_client_identity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS social_client_identity_staff_read ON public.social_client_identity;
CREATE POLICY social_client_identity_staff_read ON public.social_client_identity
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) AND public.can_access_client(client_id));

DROP POLICY IF EXISTS social_client_identity_client_read ON public.social_client_identity;
CREATE POLICY social_client_identity_client_read ON public.social_client_identity
  FOR SELECT TO authenticated
  USING (client_id = auth.uid());

REVOKE INSERT, UPDATE, DELETE ON public.social_client_identity FROM anon, authenticated;
GRANT SELECT ON public.social_client_identity TO authenticated;

ALTER TABLE social_private.social_metrics_requests
  DROP CONSTRAINT IF EXISTS social_metrics_requests_kind_check;
ALTER TABLE social_private.social_metrics_requests
  ADD CONSTRAINT social_metrics_requests_kind_check
  CHECK (kind IN ('profile', 'reach', 'engage', 'posts', 'post_insights', 'identity'));

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
  IF position('identity' IN original_definition) > 0 THEN
    RAISE NOTICE 'identidade ja habilitada; nada a fazer';
    RETURN;
  END IF;
  IF position('post_insights' IN original_definition) = 0 THEN
    RAISE EXCEPTION 'rode antes a migration do mergulho por post (post_insights)';
  END IF;

  -- Ramo de parse: identidade vem antes do ramo de post_insights.
  patched_definition := replace(
    original_definition,
    $a$      ELSIF _req.kind = 'post_insights' THEN$a$,
    $b$      ELSIF _req.kind = 'identity' THEN
        INSERT INTO public.social_client_identity AS ident
          (client_id, external_account_id, username, display_name, biography, website, profile_picture_url, captured_at)
        VALUES
          (_req.client_id, _req.external_account_id,
           _body->>'username', _body->>'name', _body->>'biography',
           _body->>'website', _body->>'profile_picture_url', now())
        ON CONFLICT (external_account_id) DO UPDATE
          SET username = EXCLUDED.username,
              display_name = EXCLUDED.display_name,
              biography = EXCLUDED.biography,
              website = EXCLUDED.website,
              profile_picture_url = EXCLUDED.profile_picture_url,
              captured_at = now();
      ELSIF _req.kind = 'post_insights' THEN$b$
  );

  -- Falha definitiva de identidade nao deve poluir o semanal.
  patched_definition := replace(
    patched_definition,
    $c$        IF _req.kind NOT IN ('posts', 'post_insights') THEN$c$,
    $d$        IF _req.kind NOT IN ('posts', 'post_insights', 'identity') THEN$d$
  );

  -- Despacho: identidade com mais de 7 dias (ou inexistente) e recoletada.
  patched_definition := replace(
    patched_definition,
    $e$  RETURN jsonb_build_object(
    'week_start', _week_start,$e$,
    $f$  FOR _acct IN
    SELECT account.id, account.client_id
    FROM public.external_accounts AS account
    WHERE account.platform = 'instagram'
      AND account.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM public.social_client_identity AS ident
        WHERE ident.external_account_id = account.id
          AND ident.captured_at > now() - interval '7 days'
      )
      AND NOT EXISTS (
        SELECT 1 FROM social_private.social_metrics_requests AS r
        WHERE r.external_account_id = account.id AND r.kind = 'identity'
      )
  LOOP
    SELECT t.resource_id, t.access_token INTO _token_resource, _token_secret
    FROM social_private.autopublish_account_token(_acct.id) AS t;
    IF _token_secret IS NULL THEN CONTINUE; END IF;
    _url := social_private.social_metrics_url(
      'identity', _token_resource, _token_secret, _week_start, _week_end);
    SELECT net.http_get(url := _url) INTO _rid;
    INSERT INTO social_private.social_metrics_requests
      (external_account_id, client_id, kind, request_id, week_start, week_end)
    VALUES (_acct.id, _acct.client_id, 'identity', _rid, _week_start, _week_end);
    _dispatched := _dispatched + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'week_start', _week_start,$f$
  );

  IF patched_definition = original_definition THEN
    RAISE EXCEPTION 'nenhuma alteracao produzida no tick; nada aplicado';
  END IF;
  EXECUTE patched_definition;
  RAISE NOTICE 'identidade do Instagram habilitada (foto, arroba, bio, site)';
END
$patch$;
