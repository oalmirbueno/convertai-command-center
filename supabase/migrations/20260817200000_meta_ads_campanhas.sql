-- Campanhas REAIS do Meta Ads, coletadas sozinhas, sem planilha no meio.
--
-- Ate aqui o relatorio de ads dependia de alguem exportar a planilha do
-- Gerenciador e subir no painel. Isso significa numero velho, trabalho manual
-- toda semana e nenhuma continuidade: cada relatorio comecava do zero.
--
-- O motor aqui e o MESMO ja provado pela coleta do Instagram
-- (social_metrics_tick): pg_net dispara, pg_cron insiste, o token mora no
-- Vault e nunca sai em texto. Se aquele funciona ha semanas, este funciona.
--
-- O que entra:
--   ads_campaigns       -> a ficha da campanha (nome, objetivo, situacao, verba)
--   ads_campaign_daily  -> um dia de cada campanha (gasto, alcance, cliques...)
--
-- O grao e DIARIO por campanha de proposito: com o dia guardado da para somar
-- qualquer periodo depois (7 dias, mes, comparar com o anterior) sem precisar
-- coletar de novo. O contrario nao funciona: total do mes nao se divide.
--
-- A leitura do que cada numero SIGNIFICA fica no aplicativo
-- (src/lib/adsLanguage.ts), nao aqui. O banco guarda o fato; a traducao para a
-- lingua do cliente muda com o tempo e precisa de teste, entao mora no codigo.

-- ─────────────────── 1) A conta de anuncios e o token dela ───────────────────
-- A conta entra em public.external_accounts com platform 'meta_ads', junto das
-- de Instagram e Facebook que ja existem: mesmo cadastro, mesma RLS, mesma
-- tela de conexao. external_id guarda o numero da conta, sem o prefixo 'act_'.

CREATE TABLE IF NOT EXISTS social_private.ads_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULO significa "vale para todas as contas": e o token da agencia, tirado
  -- do Business Manager que ja tem acesso as contas dos clientes. Um token so
  -- cobre a carteira inteira. Preenchido, vale so para aquela conta, para o
  -- caso do cliente que roda anuncios fora do BM da agencia.
  external_account_id uuid REFERENCES public.external_accounts(id) ON DELETE CASCADE,
  access_token_secret_id uuid NOT NULL,
  label text NOT NULL,
  saved_by uuid REFERENCES public.profiles(id),
  saved_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

-- Um token ativo por alvo. O COALESCE cobre o token da agencia no mesmo indice:
-- em indice unico, NULO nao conflita com NULO, entao sem ele daria para gravar
-- dois tokens de agencia ativos ao mesmo tempo e nunca se saberia qual valeu.
CREATE UNIQUE INDEX IF NOT EXISTS ads_tokens_alvo_ativo
  ON social_private.ads_tokens (
    COALESCE(external_account_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE revoked_at IS NULL;

-- Resolve o token que vale para a conta: o proprio, se houver; senao o da
-- agencia. Devolve tambem o numero da conta, para montar a URL.
CREATE OR REPLACE FUNCTION social_private.ads_account_token(_external_account_id uuid)
RETURNS TABLE (act_id text, access_token text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT
    account.external_id,
    secret_row.decrypted_secret
  FROM public.external_accounts AS account
  JOIN social_private.ads_tokens AS token
    ON token.revoked_at IS NULL
   AND (token.external_account_id = account.id OR token.external_account_id IS NULL)
  JOIN vault.decrypted_secrets AS secret_row
    ON secret_row.id = token.access_token_secret_id
  WHERE account.id = _external_account_id
    AND account.platform = 'meta_ads'
    AND account.external_id IS NOT NULL
  -- O token da conta ganha do token da agencia.
  ORDER BY (token.external_account_id IS NULL)
  LIMIT 1;
$function$;

-- ──────────────────────────── 2) A ficha da campanha ─────────────────────────
CREATE TABLE IF NOT EXISTS public.ads_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  external_account_id uuid NOT NULL REFERENCES public.external_accounts(id) ON DELETE CASCADE,
  campaign_id text NOT NULL,
  name text,
  status text,
  effective_status text,
  objective text,
  daily_budget numeric,
  lifetime_budget numeric,
  start_time timestamptz,
  stop_time timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (external_account_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS ads_campaigns_client_idx
  ON public.ads_campaigns (client_id, updated_at DESC);

ALTER TABLE public.ads_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ads_campaigns_staff_read ON public.ads_campaigns;
CREATE POLICY ads_campaigns_staff_read ON public.ads_campaigns
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) AND public.can_access_client(client_id));

DROP POLICY IF EXISTS ads_campaigns_client_read ON public.ads_campaigns;
CREATE POLICY ads_campaigns_client_read ON public.ads_campaigns
  FOR SELECT TO authenticated
  USING (client_id = auth.uid());

REVOKE INSERT, UPDATE, DELETE ON public.ads_campaigns FROM anon, authenticated;
GRANT SELECT ON public.ads_campaigns TO authenticated;

-- ───────────────────────── 3) Um dia de cada campanha ────────────────────────
CREATE TABLE IF NOT EXISTS public.ads_campaign_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  external_account_id uuid NOT NULL REFERENCES public.external_accounts(id) ON DELETE CASCADE,
  campaign_id text NOT NULL,
  campaign_name text,
  objective text,
  day date NOT NULL,
  spend numeric,
  impressions bigint,
  reach bigint,
  clicks bigint,
  link_clicks bigint,
  ctr numeric,
  cpc numeric,
  cpm numeric,
  frequency numeric,
  -- A lista crua de resultados da Meta (conversas, cadastros, compras...).
  -- Qual deles E o resultado depende do objetivo, e essa escolha mora no
  -- aplicativo, onde da para testar e corrigir sem mexer no banco.
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  cost_per_action jsonb NOT NULL DEFAULT '[]'::jsonb,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (external_account_id, campaign_id, day)
);

CREATE INDEX IF NOT EXISTS ads_campaign_daily_client_dia_idx
  ON public.ads_campaign_daily (client_id, day DESC);
CREATE INDEX IF NOT EXISTS ads_campaign_daily_campanha_idx
  ON public.ads_campaign_daily (external_account_id, campaign_id, day DESC);

ALTER TABLE public.ads_campaign_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ads_campaign_daily_staff_read ON public.ads_campaign_daily;
CREATE POLICY ads_campaign_daily_staff_read ON public.ads_campaign_daily
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) AND public.can_access_client(client_id));

DROP POLICY IF EXISTS ads_campaign_daily_client_read ON public.ads_campaign_daily;
CREATE POLICY ads_campaign_daily_client_read ON public.ads_campaign_daily
  FOR SELECT TO authenticated
  USING (client_id = auth.uid());

REVOKE INSERT, UPDATE, DELETE ON public.ads_campaign_daily FROM anon, authenticated;
GRANT SELECT ON public.ads_campaign_daily TO authenticated;

-- ─────────────── 4) Fila de requisicoes (pg_net responde depois) ─────────────
CREATE TABLE IF NOT EXISTS social_private.ads_metrics_requests (
  id bigserial PRIMARY KEY,
  external_account_id uuid NOT NULL,
  client_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('account', 'campaigns', 'insights')),
  request_id bigint,
  -- Pagina seguinte da Meta. Guardamos so o cursor, NUNCA a URL pronta: a URL
  -- do 'paging.next' vem com o token dentro, e token fora do Vault e vazamento.
  after_cursor text,
  since date NOT NULL,
  until date NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────────── 5) Montador de URL ────────────────────────────
CREATE OR REPLACE FUNCTION social_private.ads_url(
  _kind text, _act text, _token text, _since date, _until date, _after text
)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT CASE _kind
    WHEN 'account' THEN
      'https://graph.facebook.com/v21.0/act_' || _act
      || '?fields=name,currency,account_status,timezone_name'
      || '&access_token=' || _token
    WHEN 'campaigns' THEN
      'https://graph.facebook.com/v21.0/act_' || _act || '/campaigns'
      || '?fields=id,name,status,effective_status,objective,daily_budget'
      || ',lifetime_budget,start_time,stop_time'
      || '&limit=200'
      || COALESCE('&after=' || _after, '')
      || '&access_token=' || _token
    ELSE
      'https://graph.facebook.com/v21.0/act_' || _act || '/insights'
      || '?level=campaign&time_increment=1'
      || '&time_range=' || social_private.autopublish_urlencode(
           '{"since":"' || _since::text || '","until":"' || _until::text || '"}')
      || '&fields=campaign_id,campaign_name,objective,spend,impressions,reach'
      || ',clicks,inline_link_clicks,ctr,cpc,cpm,frequency,actions'
      || ',cost_per_action_type,date_start'
      || '&limit=500'
      || COALESCE('&after=' || _after, '')
      || '&access_token=' || _token
  END;
$function$;

-- ──────────────────────────────── 6) O tick ──────────────────────────────────
-- Tres fases, igual ao motor do Instagram: colhe o que chegou, redespacha o que
-- ficou sem resposta, e abre coleta nova para as contas que precisam.
CREATE OR REPLACE FUNCTION public.ads_metrics_tick()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  _since date;
  _until date;
  _req record;
  _acct record;
  _status integer;
  _content text;
  _body jsonb;
  _row jsonb;
  _act text;
  _token text;
  _url text;
  _rid bigint;
  _kind text;
  _after text;
  _dispatched integer := 0;
  _parsed integer := 0;
BEGIN
  -- Janela movel de 30 dias, no fuso de Sao Paulo. Cobre o mes corrente e o
  -- pedaco do anterior que ainda serve de comparacao.
  _until := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _since := _until - 29;

  -- A) Colhe as respostas que ja chegaram
  FOR _req IN
    SELECT * FROM social_private.ads_metrics_requests
    WHERE request_id IS NOT NULL ORDER BY id
  LOOP
    SELECT r.status_code, r.content INTO _status, _content
    FROM net._http_response AS r WHERE r.id = _req.request_id;
    IF NOT FOUND THEN
      -- Resposta perdida: libera para redespacho depois de 30 minutos.
      IF _req.created_at < now() - interval '30 minutes' THEN
        UPDATE social_private.ads_metrics_requests
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
      IF _req.kind = 'account' THEN
        UPDATE public.external_accounts
        SET display_name = COALESCE(NULLIF(_body->>'name', ''), display_name),
            updated_at = now()
        WHERE id = _req.external_account_id;

      ELSIF _req.kind = 'campaigns' THEN
        FOR _row IN SELECT jsonb_array_elements(COALESCE(_body->'data', '[]'::jsonb))
        LOOP
          INSERT INTO public.ads_campaigns AS c (
            client_id, external_account_id, campaign_id, name, status,
            effective_status, objective, daily_budget, lifetime_budget,
            start_time, stop_time, updated_at, raw
          ) VALUES (
            _req.client_id, _req.external_account_id, _row->>'id',
            _row->>'name', _row->>'status', _row->>'effective_status',
            _row->>'objective',
            -- A Meta manda verba em centavos; guardamos em reais.
            NULLIF(_row->>'daily_budget', '')::numeric / 100,
            NULLIF(_row->>'lifetime_budget', '')::numeric / 100,
            NULLIF(_row->>'start_time', '')::timestamptz,
            NULLIF(_row->>'stop_time', '')::timestamptz,
            now(), _row
          )
          ON CONFLICT (external_account_id, campaign_id) DO UPDATE
            SET name = EXCLUDED.name,
                status = EXCLUDED.status,
                effective_status = EXCLUDED.effective_status,
                objective = EXCLUDED.objective,
                daily_budget = EXCLUDED.daily_budget,
                lifetime_budget = EXCLUDED.lifetime_budget,
                start_time = EXCLUDED.start_time,
                stop_time = EXCLUDED.stop_time,
                updated_at = now(),
                raw = EXCLUDED.raw;
        END LOOP;

      ELSE
        FOR _row IN SELECT jsonb_array_elements(COALESCE(_body->'data', '[]'::jsonb))
        LOOP
          INSERT INTO public.ads_campaign_daily AS d (
            client_id, external_account_id, campaign_id, campaign_name,
            objective, day, spend, impressions, reach, clicks, link_clicks,
            ctr, cpc, cpm, frequency, actions, cost_per_action, captured_at
          ) VALUES (
            _req.client_id, _req.external_account_id,
            _row->>'campaign_id', _row->>'campaign_name', _row->>'objective',
            (_row->>'date_start')::date,
            NULLIF(_row->>'spend', '')::numeric,
            NULLIF(_row->>'impressions', '')::bigint,
            NULLIF(_row->>'reach', '')::bigint,
            NULLIF(_row->>'clicks', '')::bigint,
            NULLIF(_row->>'inline_link_clicks', '')::bigint,
            NULLIF(_row->>'ctr', '')::numeric,
            NULLIF(_row->>'cpc', '')::numeric,
            NULLIF(_row->>'cpm', '')::numeric,
            NULLIF(_row->>'frequency', '')::numeric,
            COALESCE(_row->'actions', '[]'::jsonb),
            COALESCE(_row->'cost_per_action_type', '[]'::jsonb),
            now()
          )
          ON CONFLICT (external_account_id, campaign_id, day) DO UPDATE
            SET campaign_name = EXCLUDED.campaign_name,
                objective = EXCLUDED.objective,
                spend = EXCLUDED.spend,
                impressions = EXCLUDED.impressions,
                reach = EXCLUDED.reach,
                clicks = EXCLUDED.clicks,
                link_clicks = EXCLUDED.link_clicks,
                ctr = EXCLUDED.ctr,
                cpc = EXCLUDED.cpc,
                cpm = EXCLUDED.cpm,
                frequency = EXCLUDED.frequency,
                actions = EXCLUDED.actions,
                cost_per_action = EXCLUDED.cost_per_action,
                captured_at = now();
        END LOOP;
      END IF;

      -- Conta com muitas campanhas vem em paginas. Enfileira a proxima usando
      -- so o cursor: a URL pronta da Meta traz o token dentro e nao pode ser
      -- guardada aqui.
      _after := _body#>>'{paging,cursors,after}';
      IF _after IS NOT NULL AND (_body#>'{paging,next}') IS NOT NULL THEN
        INSERT INTO social_private.ads_metrics_requests
          (external_account_id, client_id, kind, after_cursor, since, until)
        VALUES (_req.external_account_id, _req.client_id, _req.kind,
                _after, _req.since, _req.until);
      END IF;

      _parsed := _parsed + 1;
      DELETE FROM social_private.ads_metrics_requests WHERE id = _req.id;
    ELSE
      IF _req.attempts >= 3 THEN
        -- Desiste desta rodada sem travar as outras contas. O erro aparece na
        -- tela de conexao pela ausencia de coleta recente.
        DELETE FROM social_private.ads_metrics_requests WHERE id = _req.id;
      ELSE
        UPDATE social_private.ads_metrics_requests
        SET attempts = attempts + 1, request_id = NULL WHERE id = _req.id;
      END IF;
    END IF;
  END LOOP;

  -- B) Redespacha o que esta pendente sem requisicao no ar
  FOR _req IN
    SELECT * FROM social_private.ads_metrics_requests
    WHERE request_id IS NULL ORDER BY id
  LOOP
    SELECT t.act_id, t.access_token INTO _act, _token
    FROM social_private.ads_account_token(_req.external_account_id) AS t;
    IF _token IS NULL THEN
      DELETE FROM social_private.ads_metrics_requests WHERE id = _req.id;
      CONTINUE;
    END IF;
    _url := social_private.ads_url(
      _req.kind, _act, _token, _req.since, _req.until, _req.after_cursor);
    SELECT net.http_get(url := _url) INTO _rid;
    UPDATE social_private.ads_metrics_requests
    SET request_id = _rid, created_at = now() WHERE id = _req.id;
    _dispatched := _dispatched + 1;
  END LOOP;

  -- C) Abre coleta para as contas ativas que ainda nao rodaram nesta hora
  FOR _acct IN
    SELECT account.id, account.client_id
    FROM public.external_accounts AS account
    WHERE account.platform = 'meta_ads'
      AND account.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM social_private.ads_metrics_requests AS r
        WHERE r.external_account_id = account.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.ads_campaign_daily AS d
        WHERE d.external_account_id = account.id
          AND d.captured_at > now() - interval '1 hour'
      )
  LOOP
    SELECT t.act_id, t.access_token INTO _act, _token
    FROM social_private.ads_account_token(_acct.id) AS t;
    IF _token IS NULL THEN CONTINUE; END IF;
    FOREACH _kind IN ARRAY ARRAY['account', 'campaigns', 'insights'] LOOP
      _url := social_private.ads_url(_kind, _act, _token, _since, _until, NULL);
      SELECT net.http_get(url := _url) INTO _rid;
      INSERT INTO social_private.ads_metrics_requests
        (external_account_id, client_id, kind, request_id, since, until)
      VALUES (_acct.id, _acct.client_id, _kind, _rid, _since, _until);
      _dispatched := _dispatched + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'since', _since, 'until', _until,
    'dispatched', _dispatched, 'parsed', _parsed
  );
END
$function$;

REVOKE ALL ON FUNCTION public.ads_metrics_tick() FROM PUBLIC, anon, authenticated;

-- ──────────────── 7) Atualizar agora, pela equipe, direto do painel ──────────
CREATE OR REPLACE FUNCTION public.collect_ads_metrics_now()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'somente a equipe pode atualizar as campanhas';
  END IF;
  RETURN public.ads_metrics_tick();
END
$function$;

REVOKE ALL ON FUNCTION public.collect_ads_metrics_now() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.collect_ads_metrics_now() TO authenticated;

-- ─────────────── 8) Guardar o token de anuncios (so administrador) ───────────
-- O token entra pelo painel e vai direto para o Vault. Nunca volta para a tela,
-- nunca aparece em consulta: o painel so mostra que existe e quem salvou.
CREATE OR REPLACE FUNCTION public.save_meta_ads_token(
  _token text,
  _label text DEFAULT 'Token da agência',
  _external_account_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  _secret_id uuid;
  _id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'somente administrador pode guardar o token de anúncios';
  END IF;
  IF btrim(COALESCE(_token, '')) = '' THEN
    RAISE EXCEPTION 'token vazio';
  END IF;

  -- Trocar o token e substituir, nao acumular: o anterior fica revogado.
  UPDATE social_private.ads_tokens
  SET revoked_at = now()
  WHERE revoked_at IS NULL
    AND external_account_id IS NOT DISTINCT FROM _external_account_id;

  SELECT vault.create_secret(
    btrim(_token),
    'meta-ads-' || gen_random_uuid()::text,
    'Token de leitura do Meta Ads',
    NULL
  ) INTO _secret_id;

  INSERT INTO social_private.ads_tokens
    (external_account_id, access_token_secret_id, label, saved_by)
  VALUES (_external_account_id, _secret_id, btrim(_label), auth.uid())
  RETURNING id INTO _id;

  RETURN jsonb_build_object('id', _id, 'saved_at', now());
END
$function$;

REVOKE ALL ON FUNCTION public.save_meta_ads_token(text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_meta_ads_token(text, text, uuid) TO authenticated;

-- Situacao da conexao, sem jamais devolver o token.
CREATE OR REPLACE FUNCTION public.meta_ads_connection_status()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  _agencia jsonb;
  _contas jsonb;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'somente a equipe pode ver a conexão de anúncios';
  END IF;

  SELECT to_jsonb(t) INTO _agencia
  FROM (
    SELECT label, saved_at
    FROM social_private.ads_tokens
    WHERE revoked_at IS NULL AND external_account_id IS NULL
    LIMIT 1
  ) AS t;

  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.display_name), '[]'::jsonb)
  INTO _contas
  FROM (
    SELECT
      account.id,
      account.client_id,
      account.display_name,
      account.external_id,
      account.status,
      EXISTS (
        SELECT 1 FROM social_private.ads_tokens AS token
        WHERE token.revoked_at IS NULL
          AND token.external_account_id = account.id
      ) AS token_proprio,
      (
        SELECT max(d.captured_at) FROM public.ads_campaign_daily AS d
        WHERE d.external_account_id = account.id
      ) AS ultima_coleta
    FROM public.external_accounts AS account
    WHERE account.platform = 'meta_ads'
      AND public.can_access_client(account.client_id)
  ) AS c;

  RETURN jsonb_build_object('agencia', _agencia, 'contas', _contas);
END
$function$;

REVOKE ALL ON FUNCTION public.meta_ads_connection_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meta_ads_connection_status() TO authenticated;

-- ────────────────────────────────── 9) Cron ──────────────────────────────────
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('ads-metrics');
    EXCEPTION WHEN others THEN
      NULL;
    END;
    -- A cada 10 minutos, mas a fase C so abre coleta para conta parada ha mais
    -- de uma hora: na pratica e uma leitura por hora por conta, e os 10 minutos
    -- servem para colher respostas e insistir no que falhou.
    PERFORM cron.schedule(
      'ads-metrics',
      '*/10 * * * *',
      'SELECT public.ads_metrics_tick();'
    );
    RAISE NOTICE 'coleta de campanhas agendada (a cada 10 min; cada conta e lida por hora)';
  ELSE
    RAISE NOTICE 'pg_cron indisponivel: chame public.ads_metrics_tick() por outro agendador';
  END IF;
END
$cron$;
