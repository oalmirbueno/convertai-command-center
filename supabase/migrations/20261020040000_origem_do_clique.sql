-- Origem do clique (19/10/2026, ideia 8 do estudo do ClickMax): ligar cada
-- lead ao anúncio de onde ele veio.
--
-- 1) commercial_leads.origem_clique (jsonb, opcional): os parâmetros do link
--    de entrada que o site da Mesa Site repassa no formulário (utm_source,
--    utm_medium, utm_campaign, utm_content, utm_term, ad_id, adset_id,
--    campaign_id, fbclid). Só o que veio no link; lead sem link fica NULL.
--    Índices por ad_id e campaign_id: a tela de anúncios conta os leads de
--    cada anúncio e campanha.
-- 2) site_registrar_lead ganha _origem jsonb DEFAULT NULL (a assinatura
--    antiga, de 9 argumentos, sai para não haver duas). Chamada sem _origem
--    continua igual. A função pública manda _origem só quando há origem e,
--    se o banco ainda não tiver esta migration, repete sem ela.
--
-- Só amplia: nenhuma linha muda, nada é apagado.

ALTER TABLE public.commercial_leads ADD COLUMN IF NOT EXISTS origem_clique jsonb;

ALTER TABLE public.commercial_leads DROP CONSTRAINT IF EXISTS commercial_leads_origem_clique_objeto;
ALTER TABLE public.commercial_leads ADD CONSTRAINT commercial_leads_origem_clique_objeto
  CHECK (origem_clique IS NULL OR (jsonb_typeof(origem_clique) = 'object' AND pg_column_size(origem_clique) <= 4096));

COMMENT ON COLUMN public.commercial_leads.origem_clique IS
  'Parâmetros do link de entrada (utm_*, ad_id, adset_id, campaign_id, fbclid) repassados pelo formulário do site. Só o que veio no link.';

CREATE INDEX IF NOT EXISTS commercial_leads_por_anuncio_meta
  ON public.commercial_leads ((origem_clique ->> 'ad_id'))
  WHERE origem_clique ? 'ad_id';
CREATE INDEX IF NOT EXISTS commercial_leads_por_campanha_meta
  ON public.commercial_leads ((origem_clique ->> 'campaign_id'))
  WHERE origem_clique ? 'campaign_id';

DROP FUNCTION IF EXISTS public.site_registrar_lead(text, text, text, text, text, text, text, text, text);

CREATE FUNCTION public.site_registrar_lead(
  _chave text,
  _ip_hash text,
  _nome text,
  _email text,
  _whatsapp text,
  _empresa text,
  _mensagem text,
  _pagina text,
  _spam_motivo text DEFAULT NULL,
  _origem jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _s record;
  _lead uuid;
  _repetido uuid;
  _por_ip int;
  _por_site int;
  _o jsonb;
BEGIN
  IF NOT app_private.rpc_trusted_backend() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SITE_FORMULARIO_SO_BACKEND';
  END IF;
  IF _chave IS NULL OR _chave !~ '^[a-z0-9]{20,40}$' OR _ip_hash IS NULL OR char_length(_ip_hash) NOT BETWEEN 16 AND 128 THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'pedido_invalido');
  END IF;

  SELECT s.id, s.client_id, s.nome INTO _s
  FROM public.sites s
  WHERE s.integracoes -> 'formulario' ->> 'chave' = _chave
    AND COALESCE((s.integracoes -> 'formulario' ->> 'ligado')::boolean, false)
    AND s.arquivado_em IS NULL
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'formulario_desligado');
  END IF;

  -- Um envio por vez por site: a contagem e a gravação não se atropelam.
  PERFORM pg_advisory_xact_lock(hashtext('site_formulario:' || _s.id::text));

  IF _spam_motivo IS NOT NULL THEN
    INSERT INTO public.site_formulario_envios (site_id, client_id, ip_hash, resultado, motivo, pagina)
    VALUES (_s.id, _s.client_id, _ip_hash, 'spam', left(_spam_motivo, 60), left(_pagina, 200));
    RETURN jsonb_build_object('ok', false, 'codigo', 'spam');
  END IF;

  SELECT count(*) INTO _por_ip FROM public.site_formulario_envios
   WHERE ip_hash = _ip_hash AND criado_em > now() - interval '10 minutes';
  SELECT count(*) INTO _por_site FROM public.site_formulario_envios
   WHERE site_id = _s.id AND resultado IN ('aceito', 'duplicado') AND criado_em > now() - interval '1 hour';
  IF _por_ip >= 5 OR _por_site >= 60 THEN
    INSERT INTO public.site_formulario_envios (site_id, client_id, ip_hash, resultado, motivo, pagina)
    VALUES (_s.id, _s.client_id, _ip_hash, 'limite', CASE WHEN _por_ip >= 5 THEN 'ip' ELSE 'site' END, left(_pagina, 200));
    RETURN jsonb_build_object('ok', false, 'codigo', 'limite');
  END IF;

  SELECT e.lead_id INTO _repetido
  FROM public.site_formulario_envios e
  JOIN public.commercial_leads l ON l.id = e.lead_id
  WHERE e.site_id = _s.id AND e.resultado = 'aceito' AND e.criado_em > now() - interval '10 minutes'
    AND ((NULLIF(_email, '') IS NOT NULL AND lower(l.email) = lower(_email)) OR (NULLIF(_whatsapp, '') IS NOT NULL AND l.whatsapp = _whatsapp))
  ORDER BY e.criado_em DESC
  LIMIT 1;
  IF _repetido IS NOT NULL THEN
    INSERT INTO public.site_formulario_envios (site_id, client_id, ip_hash, resultado, lead_id, pagina)
    VALUES (_s.id, _s.client_id, _ip_hash, 'duplicado', _repetido, left(_pagina, 200));
    RETURN jsonb_build_object('ok', true, 'duplicado', true);
  END IF;

  -- Origem do clique: só as chaves conhecidas, texto curto, nada de objeto
  -- aninhado. A função pública já conferiu o formato (origem-clique.ts);
  -- aqui é a segunda trava, no banco.
  IF _origem IS NOT NULL AND jsonb_typeof(_origem) = 'object' THEN
    SELECT jsonb_object_agg(t.k, left(t.v, CASE WHEN t.k = 'fbclid' THEN 500 ELSE 150 END))
      INTO _o
      FROM jsonb_each_text(_origem) AS t(k, v)
     WHERE t.k IN ('utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ad_id', 'adset_id', 'campaign_id', 'fbclid')
       AND jsonb_typeof(_origem -> t.k) IN ('string', 'number')
       AND NULLIF(btrim(t.v), '') IS NOT NULL
       AND (t.k NOT IN ('ad_id', 'adset_id', 'campaign_id') OR t.v ~ '^[0-9]{5,25}$');
  END IF;

  INSERT INTO public.commercial_leads (name, email, whatsapp, origin, notes, qualificacao, origem_clique)
  VALUES (
    left(btrim(_nome), 120),
    NULLIF(left(btrim(COALESCE(_email, '')), 120), ''),
    NULLIF(left(btrim(COALESCE(_whatsapp, '')), 20), ''),
    'site',
    NULLIF(left(concat_ws(E'\n', CASE WHEN NULLIF(btrim(COALESCE(_empresa, '')), '') IS NOT NULL THEN 'Empresa: ' || left(btrim(_empresa), 120) END, NULLIF(btrim(COALESCE(_mensagem, '')), '')), 2200), ''),
    jsonb_build_object('fonte', 'site', 'site_id', _s.id, 'client_id', _s.client_id, 'site', _s.nome, 'pagina', left(COALESCE(_pagina, ''), 200), 'empresa', left(COALESCE(_empresa, ''), 120)),
    _o
  )
  RETURNING id INTO _lead;

  INSERT INTO public.commercial_lead_events (lead_id, kind, note)
  VALUES (_lead, 'nota', left('Chegou pelo formulário do site ' || _s.nome || COALESCE(' (' || NULLIF(_pagina, '') || ')', '') || '.'
    || COALESCE(' Clique do anúncio ' || (_o ->> 'ad_id') || ' da Meta.', CASE WHEN _o ? 'campaign_id' THEN ' Clique da campanha ' || (_o ->> 'campaign_id') || ' da Meta.' END, ''), 400));

  INSERT INTO public.site_formulario_envios (site_id, client_id, ip_hash, resultado, lead_id, pagina)
  VALUES (_s.id, _s.client_id, _ip_hash, 'aceito', _lead, left(_pagina, 200));

  RETURN jsonb_build_object('ok', true, 'lead_id', _lead);
END;
$body$;

REVOKE ALL ON FUNCTION public.site_registrar_lead(text, text, text, text, text, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.site_registrar_lead(text, text, text, text, text, text, text, text, text, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';

-- Conferir depois de aplicar (só leitura):
-- select column_name, data_type from information_schema.columns where table_name = 'commercial_leads' and column_name = 'origem_clique';
-- select indexname from pg_indexes where tablename = 'commercial_leads' and indexname like '%_meta';
-- select pg_get_function_identity_arguments(oid) from pg_proc where proname = 'site_registrar_lead';
