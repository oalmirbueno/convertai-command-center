-- PARA RODAR NO SQL EDITOR DO LOVABLE CLOUD (Backend -> SQL).
-- Cole o arquivo inteiro e execute uma vez. Rodar de novo não faz mal.
--
-- Duas coisas acontecem aqui, nesta ordem:
--
--   1) Aplica a coleta de campanhas do Meta Ads (tabelas, coletor e cron).
--   2) Anota no diário de bordo do Supabase as migrations que já estavam
--      aplicadas no banco mas nunca foram registradas. Isto NÃO altera
--      schema nenhum: só registra o que já foi feito. Sem a anotação, o
--      deploy automático tenta reaplicar tudo e 7 delas quebram por já
--      existirem (ADD CONSTRAINT, índice único sem IF NOT EXISTS).
--
-- Gerado de 29 arquivos posteriores a 20260810150000.

BEGIN;

-- ═══ 1) Migration nova: meta_ads_campanhas ═══
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

-- ═══ 2) Registro no diário de bordo ═══
INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES
  ('20260812120000', 'allow_approved_media_on_new_posts', ARRAY[
    '-- Permite montar um post ainda nao aprovado com uma arte que o cliente ja
-- aprovou, sem pedir uma segunda aprovacao da mesma peca.
--
-- As duas guardas de imutabilidade de save_editorial_post_unlocked (funcao
-- interna chamada pelo wrapper public.save_editorial_post) tratavam qualquer
-- arquivo travado como intocavel, inclusive o ja aprovado que se quer
-- justamente reaproveitar, barrando o fluxo com:
--   "the editorial primary file is already under review; create a revision"
--   "approved editorial copy is immutable; create a revision"
--
-- Regra final: arte totalmente publicavel (duplo gate aprovado, travada, mesmo
-- cliente e projeto) pode ser anexada enquanto o POST ainda nao esta aprovado
-- (post novo, sem arte, ou com arte ainda editavel). Trocar a arte de um post
-- ja aprovado continua exigindo revisao.
--
-- Forward-only, aditiva e idempotente: nenhuma tabela, coluna ou registro e
-- alterado. A funcao e reescrita a partir da definicao vigente no banco; se um
-- trecho esperado nao existir, nada e aplicado.

DO $patch$
DECLARE
  original_definition text;
  patched_definition text;
  old_primary_guard text;
  new_primary_guard text;
  old_copy_guard text;
  new_copy_guard text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO original_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = ''public'' AND p.proname = ''save_editorial_post_unlocked'';

  IF original_definition IS NULL THEN
    RAISE EXCEPTION ''save_editorial_post_unlocked nao encontrada; nada a aplicar'';
  END IF;

  old_primary_guard := $a$    AND NOT COALESCE(
      public.file_is_editable(_primary_file_id),
      false
    ) THEN
    RAISE EXCEPTION ''the editorial primary file is already under review; create a revision'';$a$;

  new_primary_guard := $b$    AND NOT COALESCE(
      public.file_is_editable(_primary_file_id),
      false
    )
    AND NOT (
      COALESCE(public.editorial_file_is_publishable(_primary_file_id, _client_id, _project_id), false)
      AND (
        _is_new
        OR _existing_post.primary_file_id IS NULL
        OR COALESCE(public.file_is_editable(_existing_post.primary_file_id), false)
      )
    ) THEN
    RAISE EXCEPTION ''the editorial primary file is already under review; create a revision'';$b$;

  old_copy_guard := $c$      WHERE NOT COALESCE(
        public.file_is_editable(requested.file_id),
        false
      )$c$;

  new_copy_guard := $d$      WHERE NOT COALESCE(
        public.file_is_editable(requested.file_id),
        false
      )
      AND NOT (
        COALESCE(public.editorial_file_is_publishable(requested.file_id, _client_id, _project_id), false)
        AND (
          _is_new
          OR _existing_post.primary_file_id IS NULL
          OR COALESCE(public.file_is_editable(_existing_post.primary_file_id), false)
        )
      )$d$;

  IF position(new_copy_guard IN original_definition) > 0 THEN
    RAISE NOTICE ''reuso de arte aprovada ja habilitado; nada a fazer'';
    RETURN;
  END IF;

  IF position(old_primary_guard IN original_definition) = 0 THEN
    RAISE EXCEPTION ''guarda do arquivo principal nao encontrada; nada foi alterado'';
  END IF;

  IF position(old_copy_guard IN original_definition) = 0 THEN
    RAISE EXCEPTION ''guarda da copia aprovada nao encontrada; nada foi alterado'';
  END IF;

  patched_definition := replace(original_definition, old_primary_guard, new_primary_guard);
  patched_definition := replace(patched_definition, old_copy_guard, new_copy_guard);

  IF patched_definition = original_definition THEN
    RAISE EXCEPTION ''nenhuma alteracao produzida; nada foi aplicado'';
  END IF;

  EXECUTE patched_definition;
  RAISE NOTICE ''reuso de arte aprovada habilitado com sucesso'';
END
$patch$',
    '-- A funcao interna nunca e chamada direto pelo cliente: quem expoe e o wrapper
-- public.save_editorial_post, cujas permissoes permanecem intactas.
REVOKE ALL ON FUNCTION public.save_editorial_post_unlocked(jsonb, integer)
  FROM PUBLIC, anon, authenticated',
    'GRANT EXECUTE ON FUNCTION public.save_editorial_post_unlocked(jsonb, integer)
  TO service_role'
  ]::text[]),
  ('20260812140000', 'editorial_autopublish_worker', ARRAY[
    '-- Publicacao automatica no Instagram para publicacoes agendadas.
--
-- O schema ja previa entrega automatica (editorial_publications.delivery_mode
-- = ''automatic''), mas nunca existiu quem executasse. Este lote cria o executor
-- inteiro dentro do banco, usando pg_net (ja instalado) para falar com a Graph
-- API e pg_cron para acordar de minuto em minuto. Nao depende de deploy de
-- Edge Function.
--
-- Como funciona, em etapas curtas (cada tick avanca um passo por publicacao):
--   queued   -> cria o container de midia na Graph API
--   children -> (carrossel) cria o container pai com os filhos prontos
--   publish  -> chama media_publish
--   permalink-> busca o link do post publicado
--   done     -> marca a publicacao como publicada pelo fluxo oficial
--
-- Seguranca e reversibilidade:
--   - So publica o que ja esta ''scheduled'' com delivery_mode ''automatic'',
--     hora chegada e conta Instagram conectada e ativa.
--   - Token lido do Vault no momento do uso; nunca fica em tabela.
--   - Toda falha vira registro legivel no job, com tentativa limitada.
--   - Interruptor geral: social_private.autopublish_settings.enabled.
--   - Forward-only e aditivo: nenhuma tabela existente e alterada.

CREATE SCHEMA IF NOT EXISTS social_private',
    '-- ───────────────────────── Configuracao e interruptor ─────────────────────────
CREATE TABLE IF NOT EXISTS social_private.autopublish_settings (
  id boolean PRIMARY KEY DEFAULT true,
  enabled boolean NOT NULL DEFAULT false,
  graph_version text NOT NULL DEFAULT ''v21.0'',
  storage_base_url text NOT NULL DEFAULT ''https://gicbrgagstyvbaaumprj.supabase.co'',
  max_attempts smallint NOT NULL DEFAULT 3,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT autopublish_settings_singleton CHECK (id)
)',
    'INSERT INTO social_private.autopublish_settings (id, enabled)
VALUES (true, false)
ON CONFLICT (id) DO NOTHING',
    '-- ───────────────────────────── Fila de execucao ──────────────────────────────
CREATE TABLE IF NOT EXISTS social_private.autopublish_jobs (
  publication_id uuid PRIMARY KEY,
  client_id uuid NOT NULL,
  stage text NOT NULL DEFAULT ''queued'',
  attempts smallint NOT NULL DEFAULT 0,
  net_request_id bigint,
  child_urls text[] NOT NULL DEFAULT ARRAY[]::text[],
  child_container_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  container_id text,
  media_id text,
  permalink text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT autopublish_jobs_stage_check CHECK (
    stage IN (''queued'', ''children'', ''parent'', ''publish'', ''permalink'', ''done'', ''failed'')
  )
)',
    'ALTER TABLE social_private.autopublish_settings ENABLE ROW LEVEL SECURITY',
    'ALTER TABLE social_private.autopublish_jobs ENABLE ROW LEVEL SECURITY',
    'REVOKE ALL ON social_private.autopublish_settings FROM PUBLIC, anon, authenticated',
    'REVOKE ALL ON social_private.autopublish_jobs FROM PUBLIC, anon, authenticated',
    '-- ─────────────────── URL publica do arquivo (bucket files e publico) ──────────
CREATE OR REPLACE FUNCTION social_private.autopublish_file_url(_file_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''''
AS $function$
  SELECT CASE
    WHEN file_row.file_url IS NOT NULL AND file_row.file_url LIKE ''http%''
      THEN file_row.file_url
    WHEN file_row.storage_path IS NOT NULL
      THEN (SELECT settings.storage_base_url FROM social_private.autopublish_settings AS settings WHERE settings.id)
        || ''/storage/v1/object/public/''
        || COALESCE(file_row.storage_bucket, ''files'')
        || ''/'' || file_row.storage_path
    ELSE NULL
  END
  FROM public.files AS file_row
  WHERE file_row.id = _file_id;
$function$',
    '-- ─────────────────────────── Token da conta no Vault ─────────────────────────
CREATE OR REPLACE FUNCTION social_private.autopublish_account_token(
  _external_account_id uuid
)
RETURNS TABLE (resource_id text, access_token text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''''
AS $function$
  SELECT
    grant_row.provider_resource_id,
    secret_row.decrypted_secret
  FROM social_private.external_account_grants AS grant_row
  JOIN vault.decrypted_secrets AS secret_row
    ON secret_row.id = grant_row.resource_access_token_secret_id
  WHERE grant_row.external_account_id = _external_account_id
    AND grant_row.revoked_at IS NULL
    AND grant_row.platform = ''instagram''
  LIMIT 1;
$function$',
    '-- ─────────────────── Codificacao de parametros para a Graph API ──────────────
CREATE OR REPLACE FUNCTION social_private.autopublish_urlencode(_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''''
AS $function$
  SELECT COALESCE(
    string_agg(
      CASE
        WHEN piece ~ ''^[A-Za-z0-9_.~-]$'' THEN piece
        ELSE upper(''%'' || encode(convert_to(piece, ''UTF8''), ''hex''))
      END,
      ''''
    ),
    ''''
  )
  FROM regexp_split_to_table(COALESCE(_value, ''''), '''') AS piece;
$function$',
    '-- ───────────────────────────────── Executor ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.editorial_autopublish_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''''
AS $function$
DECLARE
  _settings social_private.autopublish_settings%ROWTYPE;
  _graph text;
  _due record;
  _job record;
  _response record;
  _token record;
  _url text;
  _payload text;
  _request_id bigint;
  _admin uuid;
  _queued integer := 0;
  _advanced integer := 0;
  _published integer := 0;
  _failed integer := 0;
  _children text[];
  _caption text;
  _body jsonb;
BEGIN
  SELECT * INTO _settings FROM social_private.autopublish_settings WHERE id;
  IF _settings IS NULL OR NOT _settings.enabled THEN
    RETURN jsonb_build_object(''enabled'', false);
  END IF;

  _graph := ''https://graph.facebook.com/'' || _settings.graph_version;
  SELECT id INTO _admin
  FROM auth.users
  WHERE id IN (SELECT user_id FROM public.user_roles WHERE role = ''admin''::public.app_role)
  ORDER BY created_at
  LIMIT 1;

  -- 1. Enfileira publicacoes agendadas cuja hora chegou.
  FOR _due IN
    SELECT
      publication.id,
      publication.client_id,
      publication.external_account_id,
      publication.caption,
      COALESCE(publication.file_id, post.primary_file_id) AS file_id,
      post.content_type
    FROM public.editorial_publications AS publication
    JOIN public.editorial_posts AS post ON post.id = publication.post_id
    WHERE publication.status = ''scheduled''
      AND publication.platform = ''instagram''
      AND publication.delivery_mode = ''automatic''
      AND publication.scheduled_at IS NOT NULL
      AND publication.scheduled_at <= now()
      -- v1 publica imagem unica. Carrossel, reel e video seguem manuais: e
      -- melhor a equipe publicar do que o robo postar so a capa.
      AND post.content_type IN (''static'', ''design'')
      AND NOT EXISTS (
        SELECT 1 FROM social_private.autopublish_jobs AS job
        WHERE job.publication_id = publication.id
      )
    LIMIT 5
  LOOP
    INSERT INTO social_private.autopublish_jobs (publication_id, client_id, stage)
    VALUES (_due.id, _due.client_id, ''queued'')
    ON CONFLICT (publication_id) DO NOTHING;
    _queued := _queued + 1;
  END LOOP;

  -- 2. Avanca cada job em andamento, um passo por tick.
  FOR _job IN
    SELECT * FROM social_private.autopublish_jobs
    WHERE stage NOT IN (''done'', ''failed'')
    ORDER BY created_at
    LIMIT 10
  LOOP
    BEGIN
      SELECT * INTO _token
      FROM social_private.autopublish_account_token(
        (SELECT external_account_id FROM public.editorial_publications WHERE id = _job.publication_id)
      );

      IF _token.access_token IS NULL THEN
        UPDATE social_private.autopublish_jobs
        SET stage = ''failed'',
            last_error = ''Conta Instagram sem conexao ativa ou token indisponivel.'',
            updated_at = now()
        WHERE publication_id = _job.publication_id;
        _failed := _failed + 1;
        CONTINUE;
      END IF;

      -- 2a. Passo inicial: monta o(s) container(es) de midia.
      IF _job.stage = ''queued'' AND _job.net_request_id IS NULL THEN
        SELECT
          COALESCE(publication.caption, ''''),
          social_private.autopublish_file_url(
            COALESCE(publication.file_id, post.primary_file_id)
          )
        INTO _caption, _url
        FROM public.editorial_publications AS publication
        JOIN public.editorial_posts AS post ON post.id = publication.post_id
        WHERE publication.id = _job.publication_id;

        IF _url IS NULL THEN
          UPDATE social_private.autopublish_jobs
          SET stage = ''failed'',
              last_error = ''Arquivo da publicacao sem URL publica.'',
              updated_at = now()
          WHERE publication_id = _job.publication_id;
          _failed := _failed + 1;
          CONTINUE;
        END IF;

        _payload := _graph || ''/'' || _token.resource_id || ''/media''
          || ''?image_url='' || social_private.autopublish_urlencode(_url)
          || ''&caption='' || social_private.autopublish_urlencode(_caption)
          || ''&access_token='' || _token.access_token;

        SELECT net.http_post(url := _payload, headers := ''{}''::jsonb) INTO _request_id;

        UPDATE social_private.autopublish_jobs
        SET net_request_id = _request_id,
            attempts = attempts + 1,
            updated_at = now()
        WHERE publication_id = _job.publication_id;
        _advanced := _advanced + 1;
        CONTINUE;
      END IF;

      -- 2b. Le a resposta pendente, se ja chegou.
      IF _job.net_request_id IS NOT NULL THEN
        SELECT status_code, content INTO _response
        FROM net._http_response
        WHERE id = _job.net_request_id;

        IF NOT FOUND THEN
          CONTINUE; -- resposta ainda em transito
        END IF;

        IF _response.status_code IS NULL OR _response.status_code >= 300 THEN
          UPDATE social_private.autopublish_jobs
          SET stage = CASE WHEN attempts >= _settings.max_attempts THEN ''failed'' ELSE stage END,
              net_request_id = NULL,
              last_error = left(COALESCE(_response.content, ''sem resposta''), 500),
              updated_at = now()
          WHERE publication_id = _job.publication_id;
          _failed := _failed + 1;
          CONTINUE;
        END IF;

        _body := _response.content::jsonb;

        IF _job.stage = ''queued'' THEN
          UPDATE social_private.autopublish_jobs
          SET container_id = _body->>''id'',
              stage = ''publish'',
              net_request_id = NULL,
              updated_at = now()
          WHERE publication_id = _job.publication_id;
          _advanced := _advanced + 1;
          CONTINUE;
        END IF;

        IF _job.stage = ''publish'' THEN
          UPDATE social_private.autopublish_jobs
          SET media_id = _body->>''id'',
              stage = ''permalink'',
              net_request_id = NULL,
              updated_at = now()
          WHERE publication_id = _job.publication_id;
          _advanced := _advanced + 1;
          CONTINUE;
        END IF;

        IF _job.stage = ''permalink'' THEN
          UPDATE social_private.autopublish_jobs
          SET permalink = _body->>''permalink'',
              stage = ''done'',
              net_request_id = NULL,
              updated_at = now()
          WHERE publication_id = _job.publication_id;

          -- Marca como publicada pelo fluxo oficial, assumindo o papel de admin.
          IF _admin IS NOT NULL THEN
            PERFORM set_config(
              ''request.jwt.claims'',
              json_build_object(''sub'', _admin::text, ''role'', ''authenticated'')::text,
              true
            );
            PERFORM public.transition_editorial_publication(
              _job.publication_id,
              ''publish'',
              (SELECT version FROM public.editorial_publications WHERE id = _job.publication_id),
              NULL,
              NULL,
              _body->>''permalink'',
              _job.media_id,
              NULL,
              NULL,
              now()
            );
          END IF;
          _published := _published + 1;
          CONTINUE;
        END IF;
      END IF;

      -- 2c. Dispara o passo seguinte quando nao ha requisicao em voo.
      IF _job.stage = ''publish'' AND _job.net_request_id IS NULL AND _job.container_id IS NOT NULL THEN
        _payload := _graph || ''/'' || _token.resource_id || ''/media_publish''
          || ''?creation_id='' || _job.container_id
          || ''&access_token='' || _token.access_token;
        SELECT net.http_post(url := _payload, headers := ''{}''::jsonb) INTO _request_id;
        UPDATE social_private.autopublish_jobs
        SET net_request_id = _request_id, attempts = attempts + 1, updated_at = now()
        WHERE publication_id = _job.publication_id;
        _advanced := _advanced + 1;
        CONTINUE;
      END IF;

      IF _job.stage = ''permalink'' AND _job.net_request_id IS NULL AND _job.media_id IS NOT NULL THEN
        _payload := _graph || ''/'' || _job.media_id
          || ''?fields=permalink&access_token='' || _token.access_token;
        SELECT net.http_get(url := _payload) INTO _request_id;
        UPDATE social_private.autopublish_jobs
        SET net_request_id = _request_id, attempts = attempts + 1, updated_at = now()
        WHERE publication_id = _job.publication_id;
        _advanced := _advanced + 1;
        CONTINUE;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      UPDATE social_private.autopublish_jobs
      SET last_error = left(SQLERRM, 500),
          stage = CASE WHEN attempts >= _settings.max_attempts THEN ''failed'' ELSE stage END,
          net_request_id = NULL,
          updated_at = now()
      WHERE publication_id = _job.publication_id;
      _failed := _failed + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    ''enabled'', true,
    ''queued'', _queued,
    ''advanced'', _advanced,
    ''published'', _published,
    ''failed'', _failed
  );
END
$function$',
    'REVOKE ALL ON FUNCTION public.editorial_autopublish_tick() FROM PUBLIC, anon, authenticated',
    'GRANT EXECUTE ON FUNCTION public.editorial_autopublish_tick() TO service_role',
    '-- ─────────────────────────── Agendador de minuto ────────────────────────────
-- O tick e uma funcao SQL: o cron chama direto, sem HTTP e sem chave de
-- servico. Reexecutar o lote apenas reagenda o mesmo job.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = ''pg_cron'') THEN
    PERFORM cron.unschedule(''editorial-autopublish'')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = ''editorial-autopublish'');

    PERFORM cron.schedule(
      ''editorial-autopublish'',
      ''* * * * *'',
      ''SELECT public.editorial_autopublish_tick();''
    );
    RAISE NOTICE ''publicacao automatica agendada de minuto em minuto'';
  ELSE
    RAISE NOTICE ''pg_cron indisponivel: chame public.editorial_autopublish_tick() por outro agendador'';
  END IF;
END
$cron$'
  ]::text[]),
  ('20260812160000', 'autopublish_v2_all_formats', ARRAY[
    '-- Publicacao automatica v2: post unico, CARROSSEL e VIDEO/REEL.
--
-- Evolucao do worker criado em 20260812140000. O que muda:
--   - Carrossel: cria um container por card (na ordem do painel: capa +
--     cards numerados pelo nome do arquivo, "card 1", "1_...", etc.),
--     depois o container pai (media_type=CAROUSEL) com a legenda, e publica.
--   - Video/Reel: cria container media_type=REELS com a URL do video e
--     ESPERA o processamento do Instagram terminar (status FINISHED) antes
--     de publicar. Processamento demora minutos; o poll nao conta como erro.
--   - Correcao: a baixa oficial no painel usa a assinatura nomeada de
--     transition_editorial_publication (a chamada posicional do v1 falharia).
--
-- Aplicar por inteiro. Idempotente: pode rodar de novo sem efeito colateral.

-- ── Fila ganha os estagios novos e o cursor do carrossel ──
ALTER TABLE social_private.autopublish_jobs
  ADD COLUMN IF NOT EXISTS child_index smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS poll_count smallint NOT NULL DEFAULT 0',
    'ALTER TABLE social_private.autopublish_jobs
  DROP CONSTRAINT IF EXISTS autopublish_jobs_stage_check',
    'ALTER TABLE social_private.autopublish_jobs
  ADD CONSTRAINT autopublish_jobs_stage_check CHECK (
    stage IN (''queued'', ''children'', ''parent'', ''processing'', ''publish'', ''permalink'', ''done'', ''failed'')
  )',
    '-- ── URLs ordenadas do carrossel: capa + cards na ordem do painel ──
CREATE OR REPLACE FUNCTION social_private.autopublish_carousel_urls(_root_file_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''''
AS $function$
  WITH ordered_children AS (
    SELECT
      social_private.autopublish_file_url(child.id) AS url,
      COALESCE(
        NULLIF(substring(child.file_name FROM ''(?i)(?:card|slide|p[aá]gina|page)[ ._-]*(\d+)''), '''')::int,
        NULLIF(substring(child.file_name FROM ''^(\d+)[ ._-]''), '''')::int,
        32000
      ) AS order_index,
      child.created_at
    FROM public.files AS child
    WHERE child.parent_file_id = _root_file_id
      AND child.archived_at IS NULL
      AND COALESCE(child.status, ''ready'') NOT IN (''deleted'', ''failed'')
  )
  SELECT ARRAY(
    SELECT url FROM (
      SELECT social_private.autopublish_file_url(_root_file_id) AS url, -1 AS order_index, NULL::timestamptz AS created_at
      UNION ALL
      SELECT url, order_index, created_at FROM ordered_children
    ) AS all_items
    WHERE url IS NOT NULL
    ORDER BY order_index, created_at NULLS LAST
  );
$function$',
    '-- ── Executor v2 ──
CREATE OR REPLACE FUNCTION public.editorial_autopublish_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''''
AS $function$
DECLARE
  _settings social_private.autopublish_settings%ROWTYPE;
  _graph text;
  _due record;
  _job record;
  _pub record;
  _response record;
  _token record;
  _payload text;
  _request_id bigint;
  _admin uuid;
  _queued int := 0;
  _advanced int := 0;
  _published int := 0;
  _failed int := 0;
  _body jsonb;
  _urls text[];
  _kind text;
  _status_code text;
BEGIN
  SELECT * INTO _settings FROM social_private.autopublish_settings WHERE id;
  IF _settings IS NULL OR NOT _settings.enabled THEN
    RETURN jsonb_build_object(''enabled'', false);
  END IF;

  _graph := ''https://graph.facebook.com/'' || _settings.graph_version;

  SELECT user_id INTO _admin
  FROM public.user_roles
  WHERE role = ''admin''::public.app_role
  ORDER BY user_id
  LIMIT 1;

  -- 1. Enfileira o que esta agendado, automatico e com a hora chegada.
  FOR _due IN
    SELECT publication.id, publication.client_id
    FROM public.editorial_publications AS publication
    JOIN public.editorial_posts AS post ON post.id = publication.post_id
    WHERE publication.status = ''scheduled''
      AND publication.platform = ''instagram''
      AND publication.delivery_mode = ''automatic''
      AND publication.scheduled_at IS NOT NULL
      AND publication.scheduled_at <= now()
      AND post.content_type IN (''static'', ''design'', ''story'', ''carousel'', ''reel'', ''video'', ''short'')
      AND NOT EXISTS (
        SELECT 1 FROM social_private.autopublish_jobs AS job
        WHERE job.publication_id = publication.id
      )
    LIMIT 5
  LOOP
    INSERT INTO social_private.autopublish_jobs (publication_id, client_id, stage)
    VALUES (_due.id, _due.client_id, ''queued'')
    ON CONFLICT (publication_id) DO NOTHING;
    _queued := _queued + 1;
  END LOOP;

  -- 2. Avanca cada job, um passo por tick.
  FOR _job IN
    SELECT * FROM social_private.autopublish_jobs
    WHERE stage NOT IN (''done'', ''failed'')
    ORDER BY created_at
    LIMIT 10
  LOOP
    BEGIN
      SELECT
        publication.id,
        publication.external_account_id,
        publication.version,
        COALESCE(publication.caption, '''') AS caption,
        COALESCE(publication.file_id, post.primary_file_id) AS file_id,
        post.content_type
      INTO _pub
      FROM public.editorial_publications AS publication
      JOIN public.editorial_posts AS post ON post.id = publication.post_id
      WHERE publication.id = _job.publication_id;

      SELECT * INTO _token
      FROM social_private.autopublish_account_token(_pub.external_account_id);

      IF _token.access_token IS NULL THEN
        UPDATE social_private.autopublish_jobs
        SET stage = ''failed'', last_error = ''Conta Instagram sem conexao ativa ou token indisponivel.'', updated_at = now()
        WHERE publication_id = _job.publication_id;
        _failed := _failed + 1;
        CONTINUE;
      END IF;

      _kind := CASE
        WHEN _pub.content_type = ''carousel'' THEN ''carousel''
        WHEN _pub.content_type IN (''reel'', ''video'', ''short'') THEN ''video''
        ELSE ''image''
      END;

      -- 2a. Le resposta pendente, se houver.
      IF _job.net_request_id IS NOT NULL THEN
        SELECT status_code, content INTO _response
        FROM net._http_response WHERE id = _job.net_request_id;
        IF NOT FOUND THEN CONTINUE; END IF;

        IF _response.status_code IS NULL OR _response.status_code >= 300 THEN
          UPDATE social_private.autopublish_jobs
          SET stage = CASE WHEN attempts >= _settings.max_attempts THEN ''failed'' ELSE stage END,
              net_request_id = NULL,
              last_error = left(COALESCE(_response.content::text, ''sem resposta''), 500),
              updated_at = now()
          WHERE publication_id = _job.publication_id;
          _failed := _failed + 1;
          CONTINUE;
        END IF;

        _body := _response.content::jsonb;

        IF _job.stage = ''queued'' THEN
          -- resposta do primeiro container
          IF _kind = ''video'' THEN
            UPDATE social_private.autopublish_jobs
            SET container_id = _body->>''id'', stage = ''processing'', poll_count = 0, net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
          ELSIF _kind = ''carousel'' THEN
            UPDATE social_private.autopublish_jobs
            SET child_container_ids = child_container_ids || (_body->>''id''),
                child_index = child_index + 1,
                net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
            UPDATE social_private.autopublish_jobs
            SET stage = ''children''
            WHERE publication_id = _job.publication_id;
          ELSE
            UPDATE social_private.autopublish_jobs
            SET container_id = _body->>''id'', stage = ''publish'', net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
          END IF;
          _advanced := _advanced + 1;
          CONTINUE;
        END IF;

        IF _job.stage = ''children'' THEN
          UPDATE social_private.autopublish_jobs
          SET child_container_ids = child_container_ids || (_body->>''id''),
              child_index = child_index + 1,
              net_request_id = NULL, updated_at = now()
          WHERE publication_id = _job.publication_id;
          _advanced := _advanced + 1;
          CONTINUE;
        END IF;

        IF _job.stage = ''parent'' THEN
          UPDATE social_private.autopublish_jobs
          SET container_id = _body->>''id'', stage = ''publish'', net_request_id = NULL, updated_at = now()
          WHERE publication_id = _job.publication_id;
          _advanced := _advanced + 1;
          CONTINUE;
        END IF;

        IF _job.stage = ''processing'' THEN
          _status_code := COALESCE(_body->>''status_code'', '''');
          IF _status_code = ''FINISHED'' THEN
            UPDATE social_private.autopublish_jobs
            SET stage = ''publish'', net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
            _advanced := _advanced + 1;
          ELSIF _status_code = ''ERROR'' THEN
            UPDATE social_private.autopublish_jobs
            SET stage = ''failed'', net_request_id = NULL,
                last_error = left(''Instagram nao conseguiu processar o video: '' || COALESCE(_body::text, ''''), 500),
                updated_at = now()
            WHERE publication_id = _job.publication_id;
            _failed := _failed + 1;
          ELSE
            -- ainda processando: espera o proximo tick
            UPDATE social_private.autopublish_jobs
            SET net_request_id = NULL, poll_count = poll_count + 1, updated_at = now()
            WHERE publication_id = _job.publication_id;
            IF _job.poll_count >= 40 THEN
              UPDATE social_private.autopublish_jobs
              SET stage = ''failed'', last_error = ''Video passou de 40 minutos em processamento.'', updated_at = now()
              WHERE publication_id = _job.publication_id;
              _failed := _failed + 1;
            END IF;
          END IF;
          CONTINUE;
        END IF;

        IF _job.stage = ''publish'' THEN
          UPDATE social_private.autopublish_jobs
          SET media_id = _body->>''id'', stage = ''permalink'', net_request_id = NULL, updated_at = now()
          WHERE publication_id = _job.publication_id;
          _advanced := _advanced + 1;
          CONTINUE;
        END IF;

        IF _job.stage = ''permalink'' THEN
          UPDATE social_private.autopublish_jobs
          SET permalink = _body->>''permalink'', stage = ''done'', net_request_id = NULL, updated_at = now()
          WHERE publication_id = _job.publication_id;

          IF _admin IS NOT NULL THEN
            PERFORM set_config(
              ''request.jwt.claims'',
              json_build_object(''sub'', _admin::text, ''role'', ''authenticated'')::text,
              true
            );
            PERFORM public.transition_editorial_publication(
              p_publication_id => _job.publication_id,
              p_action => ''publish'',
              p_expected_version => _pub.version,
              p_permalink => _body->>''permalink'',
              p_external_post_id => _job.media_id,
              p_published_at => now()
            );
          END IF;
          _published := _published + 1;
          CONTINUE;
        END IF;
      END IF;

      -- 2b. Sem requisicao em voo: dispara o proximo passo.
      IF _job.stage = ''queued'' THEN
        IF _kind = ''carousel'' THEN
          _urls := social_private.autopublish_carousel_urls(_pub.file_id);
          IF _urls IS NULL OR array_length(_urls, 1) < 2 THEN
            UPDATE social_private.autopublish_jobs
            SET stage = ''failed'', last_error = ''Carrossel precisa de pelo menos 2 imagens com URL publica.'', updated_at = now()
            WHERE publication_id = _job.publication_id;
            _failed := _failed + 1;
            CONTINUE;
          END IF;
          IF array_length(_urls, 1) > 10 THEN
            _urls := _urls[1:10];
          END IF;
          UPDATE social_private.autopublish_jobs
          SET child_urls = _urls, child_index = 0, child_container_ids = ARRAY[]::text[], updated_at = now()
          WHERE publication_id = _job.publication_id;
          _payload := _graph || ''/'' || _token.resource_id || ''/media''
            || ''?image_url='' || social_private.autopublish_urlencode(_urls[1])
            || ''&is_carousel_item=true''
            || ''&access_token='' || _token.access_token;
        ELSIF _kind = ''video'' THEN
          _payload := _graph || ''/'' || _token.resource_id || ''/media''
            || ''?media_type=REELS''
            || ''&video_url='' || social_private.autopublish_urlencode(social_private.autopublish_file_url(_pub.file_id))
            || ''&caption='' || social_private.autopublish_urlencode(_pub.caption)
            || ''&access_token='' || _token.access_token;
        ELSE
          _payload := _graph || ''/'' || _token.resource_id || ''/media''
            || ''?image_url='' || social_private.autopublish_urlencode(social_private.autopublish_file_url(_pub.file_id))
            || ''&caption='' || social_private.autopublish_urlencode(_pub.caption)
            || ''&access_token='' || _token.access_token;
        END IF;
        SELECT net.http_post(url := _payload, headers := ''{}''::jsonb) INTO _request_id;
        UPDATE social_private.autopublish_jobs
        SET net_request_id = _request_id, attempts = attempts + 1, updated_at = now()
        WHERE publication_id = _job.publication_id;
        _advanced := _advanced + 1;
        CONTINUE;
      END IF;

      IF _job.stage = ''children'' THEN
        IF _job.child_index < COALESCE(array_length(_job.child_urls, 1), 0) THEN
          _payload := _graph || ''/'' || _token.resource_id || ''/media''
            || ''?image_url='' || social_private.autopublish_urlencode(_job.child_urls[_job.child_index + 1])
            || ''&is_carousel_item=true''
            || ''&access_token='' || _token.access_token;
          SELECT net.http_post(url := _payload, headers := ''{}''::jsonb) INTO _request_id;
          UPDATE social_private.autopublish_jobs
          SET net_request_id = _request_id, attempts = attempts + 1, updated_at = now()
          WHERE publication_id = _job.publication_id;
        ELSE
          _payload := _graph || ''/'' || _token.resource_id || ''/media''
            || ''?media_type=CAROUSEL''
            || ''&children='' || array_to_string(_job.child_container_ids, '','')
            || ''&caption='' || social_private.autopublish_urlencode(_pub.caption)
            || ''&access_token='' || _token.access_token;
          SELECT net.http_post(url := _payload, headers := ''{}''::jsonb) INTO _request_id;
          UPDATE social_private.autopublish_jobs
          SET stage = ''parent'', net_request_id = _request_id, attempts = attempts + 1, updated_at = now()
          WHERE publication_id = _job.publication_id;
        END IF;
        _advanced := _advanced + 1;
        CONTINUE;
      END IF;

      IF _job.stage = ''processing'' THEN
        _payload := _graph || ''/'' || _job.container_id
          || ''?fields=status_code&access_token='' || _token.access_token;
        SELECT net.http_get(url := _payload) INTO _request_id;
        UPDATE social_private.autopublish_jobs
        SET net_request_id = _request_id, updated_at = now()
        WHERE publication_id = _job.publication_id;
        CONTINUE;
      END IF;

      IF _job.stage = ''publish'' AND _job.container_id IS NOT NULL THEN
        _payload := _graph || ''/'' || _token.resource_id || ''/media_publish''
          || ''?creation_id='' || _job.container_id
          || ''&access_token='' || _token.access_token;
        SELECT net.http_post(url := _payload, headers := ''{}''::jsonb) INTO _request_id;
        UPDATE social_private.autopublish_jobs
        SET net_request_id = _request_id, attempts = attempts + 1, updated_at = now()
        WHERE publication_id = _job.publication_id;
        _advanced := _advanced + 1;
        CONTINUE;
      END IF;

      IF _job.stage = ''permalink'' AND _job.media_id IS NOT NULL THEN
        _payload := _graph || ''/'' || _job.media_id
          || ''?fields=permalink&access_token='' || _token.access_token;
        SELECT net.http_get(url := _payload) INTO _request_id;
        UPDATE social_private.autopublish_jobs
        SET net_request_id = _request_id, updated_at = now()
        WHERE publication_id = _job.publication_id;
        _advanced := _advanced + 1;
        CONTINUE;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      UPDATE social_private.autopublish_jobs
      SET last_error = left(SQLERRM, 500),
          stage = CASE WHEN attempts >= _settings.max_attempts THEN ''failed'' ELSE stage END,
          net_request_id = NULL,
          updated_at = now()
      WHERE publication_id = _job.publication_id;
      _failed := _failed + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    ''enabled'', true, ''queued'', _queued, ''advanced'', _advanced,
    ''published'', _published, ''failed'', _failed
  );
END
$function$',
    'REVOKE ALL ON FUNCTION public.editorial_autopublish_tick() FROM PUBLIC, anon, authenticated',
    'GRANT EXECUTE ON FUNCTION public.editorial_autopublish_tick() TO service_role'
  ]::text[]),
  ('20260812190000', 'autopublish_wait_for_approval', ARRAY[
    '-- Regra de espera pela aprovacao no publicador automatico.
--
-- Antes: uma publicacao agendada com arte ainda nao aprovada entrava na fila
-- na hora marcada e falhava no ultimo passo (a baixa oficial exige o duplo
-- gate). Agora ela simplesmente ESPERA: so entra na fila quando a arte esta
-- aprovada, e se a aprovacao chegou depois do horario marcado, a publicacao
-- sai ate 1 hora depois da aprovacao - nunca antes.
--
-- Patch textual verificado sobre a funcao vigente: se o trecho esperado nao
-- existir, nada e aplicado. Idempotente.

DO $patch$
DECLARE
  original_definition text;
  patched_definition text;
  old_fragment text;
  new_fragment text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO original_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = ''public'' AND p.proname = ''editorial_autopublish_tick'';

  IF original_definition IS NULL THEN
    RAISE EXCEPTION ''editorial_autopublish_tick nao encontrada; nada a aplicar'';
  END IF;

  old_fragment := $a$      AND post.content_type IN (''static'', ''design'', ''story'', ''carousel'', ''reel'', ''video'', ''short'')$a$;

  new_fragment := $b$      AND post.content_type IN (''static'', ''design'', ''story'', ''carousel'', ''reel'', ''video'', ''short'')
      -- Espera a aprovacao: arte precisa estar publicavel, e se a aprovacao
      -- veio depois do horario marcado, respeita 1 hora de carencia.
      AND COALESCE(
        public.editorial_file_is_publishable(
          COALESCE(publication.file_id, post.primary_file_id),
          publication.client_id,
          publication.project_id
        ),
        false
      )
      AND COALESCE((
        SELECT approval_file.client_decided_at <= publication.scheduled_at
            OR now() >= approval_file.client_decided_at + interval ''1 hour''
        FROM public.files AS approval_file
        WHERE approval_file.id = COALESCE(publication.file_id, post.primary_file_id)
      ), true)$b$;

  IF position(new_fragment IN original_definition) > 0 THEN
    RAISE NOTICE ''regra de espera pela aprovacao ja aplicada; nada a fazer'';
    RETURN;
  END IF;

  IF position(old_fragment IN original_definition) = 0 THEN
    RAISE EXCEPTION ''trecho de enfileiramento nao encontrado; nada foi alterado'';
  END IF;

  patched_definition := replace(original_definition, old_fragment, new_fragment);

  IF patched_definition = original_definition THEN
    RAISE EXCEPTION ''nenhuma alteracao produzida; nada foi aplicado'';
  END IF;

  EXECUTE patched_definition;
  RAISE NOTICE ''regra de espera pela aprovacao aplicada com sucesso'';
END
$patch$'
  ]::text[]),
  ('20260813180000', 'offline_client_approval', ARRAY[
    '-- ============================================================================
-- Aceleriq OS - aprovação dada fora do painel (grupo, WhatsApp, ligação)
-- ============================================================================
--
-- O problema real: nem todo cliente entra no painel para aprovar. Ele responde
-- "pode publicar" no grupo e pronto. Só que o sistema continuava esperando o
-- clique dele, o material ficava travado e a publicação agendada não saía.
--
-- Esta função dá uma via oficial para a equipe registrar essa aprovação, sem
-- afrouxar nada da segurança:
--   - só equipe com acesso àquele cliente pode registrar;
--   - as mesmas travas da aprovação normal continuam valendo (o material tem
--     que estar aprovado internamente e realmente aguardando o cliente);
--   - o registro guarda QUEM registrou e POR ONDE veio o aceite, então o
--     histórico nunca finge que o cliente clicou no painel.
--
-- Só existe o caminho de APROVAÇÃO. Recusa com pedido de ajuste continua
-- exigindo o cliente, porque ali o texto do feedback é dele e não nosso.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_offline_client_approval(
  p_file_id uuid,
  p_expected_version integer,
  p_channel text,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''''
AS $$
DECLARE
  _file public.files%ROWTYPE;
  _actor uuid := auth.uid();
  _channel text := NULLIF(btrim(p_channel), '''');
  _note text := NULLIF(btrim(p_note), '''');
BEGIN
  IF _channel IS NULL
    OR _channel NOT IN (''grupo'', ''whatsapp'', ''ligacao'', ''presencial'', ''email'') THEN
    RAISE EXCEPTION ''invalid approval channel'';
  END IF;

  SELECT * INTO _file
  FROM public.files
  WHERE id = p_file_id
    AND parent_file_id IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION ''file not found'';
  END IF;

  -- Só equipe, e só de cliente que ela realmente atende.
  IF _actor IS NULL
    OR NOT public.is_staff(_actor)
    OR NOT public.can_access_client(_file.client_id) THEN
    RAISE EXCEPTION ''offline approval access denied'';
  END IF;

  IF p_expected_version IS NULL
    OR COALESCE(_file.version, 1) <> p_expected_version THEN
    RAISE EXCEPTION ''file version changed; refresh before deciding'';
  END IF;

  -- Exatamente as mesmas condições da aprovação feita pelo cliente.
  IF _file.agency_approval_status <> ''approved''
    OR _file.visibility <> ''approval''
    OR _file.approval_status <> ''pending''
    OR _file.locked_at IS NOT NULL
    OR _file.archived_at IS NOT NULL
    OR COALESCE(_file.status, ''ready'') <> ''ready'' THEN
    RAISE EXCEPTION ''file is not awaiting a client decision'';
  END IF;

  UPDATE public.files
  SET
    approval_status = ''none'',
    client_decided_by = NULL,
    client_decided_at = NULL,
    locked_at = now()
  WHERE parent_file_id = p_file_id;

  -- A decisão é do cliente (ele aprovou, só que por fora), por isso o registro
  -- fica no nome dele. Quem registrou aparece no evento logo abaixo.
  UPDATE public.files
  SET
    approval_status = ''approved'',
    feedback = NULL,
    client_decided_by = _file.client_id,
    client_decided_at = now(),
    locked_at = now()
  WHERE id = p_file_id;

  INSERT INTO public.file_approval_events (
    file_id,
    client_id,
    actor_id,
    event_type,
    from_status,
    to_status,
    feedback,
    metadata
  ) VALUES (
    _file.id,
    _file.client_id,
    _actor,
    ''client_approved_offline'',
    _file.approval_status,
    ''approved'',
    _note,
    jsonb_build_object(
      ''version'', p_expected_version,
      ''channel'', _channel,
      ''registered_by_staff'', true
    )
  );

  RETURN _file.id;
END;
$$',
    'REVOKE ALL ON FUNCTION public.record_offline_client_approval(uuid, integer, text, text)
  FROM PUBLIC, anon',
    'GRANT EXECUTE ON FUNCTION public.record_offline_client_approval(uuid, integer, text, text)
  TO authenticated'
  ]::text[]),
  ('20260813190000', 'autopublish_enable_and_visibility', ARRAY[
    '-- ============================================================================
-- Aceleriq OS - ligar a publicação automática e tornar a falha visível
-- ============================================================================
--
-- Diagnóstico: o motor de publicação automática nunca publicou nada desde que
-- foi criado, por dois motivos independentes que se somavam.
--
--   1. O interruptor geral nasceu desligado e nenhuma migração o ligava.
--   2. O motor só olha para publicações marcadas como "automatic", mas o painel
--      nunca dizia isso ao agendar. Toda publicação nascia "manual", então a
--      fila do motor era sempre vazia, por construção.
--
-- O ponto 2 foi corrigido no painel (o agendamento passa a declarar entrega
-- automática quando cabe no limite da Meta). Esta migração cuida do resto.
--
-- SEGURANÇA DA VIRADA: de propósito NÃO existe nenhum backfill aqui. Tudo o que
-- já estava agendado continua manual e não vai disparar sozinho de uma vez.
-- Só o que for agendado a partir de agora entra no modo automático, então dá
-- para testar com um post, conferir, e só então confiar no fluxo inteiro.
-- ============================================================================

-- ─────────────────────────── 1. Ligar o motor ───────────────────────────────
UPDATE social_private.autopublish_settings
SET
  enabled = true,
  -- O contador de tentativas é do job inteiro, não de cada passo. Um carrossel
  -- consome uma tentativa por cartão, então com o limite antigo (3) qualquer
  -- instabilidade matava o carrossel no meio, sem nova tentativa de verdade.
  max_attempts = 12,
  updated_at = now()
WHERE id',
    '-- ────────────── 2. A falha deixa de ser invisível para a equipe ──────────────
--
-- Hoje o erro da publicação automática fica gravado num schema privado, sem
-- nenhuma leitura possível pelo painel. Na prática: a publicação falhava e
-- continuava com o selo de "Programado" para sempre, sem ninguém saber.
--
-- Esta view expõe SOMENTE o estado da entrega, sem token e sem segredo, e só
-- para a equipe que atende aquele cliente.
CREATE OR REPLACE VIEW public.autopublish_status_secure AS
SELECT
  job.publication_id,
  job.client_id,
  job.stage,
  job.attempts,
  job.last_error,
  job.permalink,
  job.created_at,
  job.updated_at
FROM social_private.autopublish_jobs AS job
WHERE public.is_staff(auth.uid())
  AND public.can_access_client(job.client_id)',
    'COMMENT ON VIEW public.autopublish_status_secure IS
  ''Estado da publicacao automatica para a equipe. Sem token e sem segredo. ''
  ''Filtra por is_staff e can_access_client na propria view.''',
    'REVOKE ALL ON public.autopublish_status_secure FROM PUBLIC, anon',
    'GRANT SELECT ON public.autopublish_status_secure TO authenticated',
    '-- ─────────── 3. Conferência do agendador (somente leitura, sem efeito) ───────
DO $$
DECLARE
  _job_active boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = ''pg_cron'') THEN
    SELECT active INTO _job_active
    FROM cron.job
    WHERE jobname = ''editorial-autopublish'';

    IF _job_active IS NULL THEN
      RAISE WARNING ''Agendador editorial-autopublish nao encontrado: a publicacao automatica nao vai rodar.'';
    ELSIF NOT _job_active THEN
      RAISE WARNING ''Agendador editorial-autopublish existe mas esta desativado.'';
    ELSE
      RAISE NOTICE ''Agendador editorial-autopublish ativo, rodando a cada minuto.'';
    END IF;
  ELSE
    RAISE WARNING ''pg_cron ausente: a publicacao automatica nao tem quem a dispare.'';
  END IF;
END;
$$'
  ]::text[]),
  ('20260813210000', 'autopublish_v3_hardening', ARRAY[
    '-- ============================================================================
-- Aceleriq OS - publicação automática v3: robustez de verdade
-- ============================================================================
--
-- A v2 funcionava no caminho feliz e quebrava de formas silenciosas ou
-- perigosas fora dele. O que esta versão corrige, ponto a ponto:
--
--   1. ORDEM DO CARROSSEL: a v2 deduzia a ordem dos cartões pelo NOME do
--      arquivo (regex "card 1", "1_..."), ignorando a ordem congelada que o
--      painel grava ao agendar (editorial_publication_assets.position). Um
--      carrossel podia sair no Instagram em ordem diferente da aprovada.
--      Agora a ordem congelada manda; o nome do arquivo é só reserva para
--      agendamentos antigos que não têm a lista.
--
--   2. POST DUPLICADO: se a chamada de publicação excedesse o tempo (5s de
--      padrão do pg_net), a v2 reenviava o mesmo media_publish às cegas,
--      podendo publicar DUAS vezes. Agora o passo de publicação nunca é
--      reenviado às cegas: em qualquer dúvida o motor primeiro PERGUNTA ao
--      Instagram se o container já foi publicado (estágio verify) e, se foi,
--      recupera o post real (estágio recover) em vez de duplicar.
--
--   3. TENTATIVAS POR PASSO: o contador era do trabalho inteiro; um carrossel
--      gastava uma "tentativa" por cartão e morria no meio sem retry real.
--      Agora cada passo tem o próprio contador (limite 4 por passo).
--
--   4. REQUISIÇÃO PERDIDA: o pg_net expurga respostas antigas; a v2 esperava
--      uma resposta que nunca chegaria, para sempre, sem erro. Agora depois
--      de 10 minutos sem resposta o passo é retomado com segurança.
--
--   5. FALHA VISÍVEL NO PAINEL: a v2 nunca marcava a publicação como
--      "failed"; a agenda mostrava "Programado" eternamente. Agora toda falha
--      definitiva também baixa a publicação oficial (transition ''fail''),
--      acendendo o vermelho na agenda e o motivo no detalhe.
--
--   6. BAIXA QUE DESFAZIA O PASSO: a exceção da baixa oficial revertia o
--      estágio "done" e o job refazia o permalink até morrer, com o post já
--      no ar. Agora a baixa roda em bloco próprio: se ela falhar, o job fica
--      "done" com o erro anotado, e nada é desfeito.
--
--   7. TIMEOUT EXPLÍCITO: 20s para escrever, 10s para ler (era o padrão de
--      5s, curto demais para carrossel).
--
--   8. STORY DE VERDADE: story era postado como foto de FEED. Agora usa
--      media_type=STORIES.
--
--   9. TENTAR DE NOVO: job que falhou ficava morto para sempre (a fila nunca
--      re-enfileira). Novo RPC retry_autopublish(p_publication_id) permite à
--      equipe reprocessar com um clique, sem risco de duplicar (se a
--      publicação já foi despachada uma vez, o retry começa pelo verify).
-- ============================================================================

-- ───────────────────────── Colunas novas da fila ─────────────────────────────
ALTER TABLE social_private.autopublish_jobs
  ADD COLUMN IF NOT EXISTS step_attempts smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS publish_dispatched boolean NOT NULL DEFAULT false',
    'ALTER TABLE social_private.autopublish_jobs
  DROP CONSTRAINT IF EXISTS autopublish_jobs_stage_check',
    'ALTER TABLE social_private.autopublish_jobs
  ADD CONSTRAINT autopublish_jobs_stage_check CHECK (
    stage IN (''queued'', ''children'', ''parent'', ''processing'', ''publish'',
              ''verify'', ''recover'', ''permalink'', ''done'', ''failed'')
  )',
    '-- ──────────── URLs na ordem congelada pelo painel (fallback: nome) ───────────
CREATE OR REPLACE FUNCTION social_private.autopublish_ordered_urls(
  _publication_id uuid,
  _root_file_id uuid
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''''
AS $function$
DECLARE
  _urls text[];
BEGIN
  -- A fonte oficial: a lista de arquivos congelada no agendamento, na ordem
  -- exata que a equipe viu e o cliente aprovou.
  SELECT ARRAY(
    SELECT url FROM (
      SELECT
        social_private.autopublish_file_url(asset.file_id) AS url,
        asset.position
      FROM social_private.editorial_publication_assets AS asset
      WHERE asset.publication_id = _publication_id
      ORDER BY asset.position
    ) AS ordered
    WHERE ordered.url IS NOT NULL
  )
  INTO _urls;

  IF _urls IS NOT NULL AND array_length(_urls, 1) >= 1 THEN
    RETURN _urls;
  END IF;

  -- Agendamento antigo, sem lista congelada: cai na leitura por nome.
  RETURN social_private.autopublish_carousel_urls(_root_file_id);
END;
$function$',
    '-- ─────────────────── Falha definitiva: job + baixa oficial ───────────────────
CREATE OR REPLACE FUNCTION social_private.autopublish_mark_failed(
  _publication_id uuid,
  _reason text,
  _admin uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''''
AS $function$
DECLARE
  _version integer;
BEGIN
  UPDATE social_private.autopublish_jobs
  SET stage = ''failed'',
      net_request_id = NULL,
      last_error = left(COALESCE(_reason, ''falha sem detalhe''), 500),
      updated_at = now()
  WHERE publication_id = _publication_id;

  -- Baixa oficial: acende o "Falhou" na agenda e o motivo no detalhe.
  -- Em bloco próprio: se não der, o job já está failed e o erro já está visível.
  IF _admin IS NOT NULL THEN
    BEGIN
      SELECT version INTO _version
      FROM public.editorial_publications
      WHERE id = _publication_id;

      PERFORM set_config(
        ''request.jwt.claims'',
        json_build_object(''sub'', _admin::text, ''role'', ''authenticated'')::text,
        true
      );
      PERFORM public.transition_editorial_publication(
        p_publication_id => _publication_id,
        p_action => ''fail'',
        p_expected_version => _version,
        p_failure_code => ''autopublish'',
        p_failure_reason => left(COALESCE(_reason, ''falha sem detalhe''), 500)
      );
    EXCEPTION WHEN OTHERS THEN
      UPDATE social_private.autopublish_jobs
      SET last_error = left(COALESCE(_reason, '''') || '' | baixa oficial falhou: '' || SQLERRM, 500),
          updated_at = now()
      WHERE publication_id = _publication_id;
    END;
  END IF;
END;
$function$',
    '-- ───────────────────────────── Executor v3 ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.editorial_autopublish_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''''
AS $function$
DECLARE
  _settings social_private.autopublish_settings%ROWTYPE;
  _graph text;
  _due record;
  _job record;
  _pub record;
  _response record;
  _token record;
  _payload text;
  _request_id bigint;
  _admin uuid;
  _queued int := 0;
  _advanced int := 0;
  _published int := 0;
  _failed int := 0;
  _body jsonb;
  _urls text[];
  _kind text;
  _status_code text;
  _permalink text;
  _step_limit constant smallint := 4;    -- tentativas por PASSO, nao por job
  _lost_after constant interval := interval ''10 minutes'';
BEGIN
  SELECT * INTO _settings FROM social_private.autopublish_settings WHERE id;
  IF _settings IS NULL OR NOT _settings.enabled THEN
    RETURN jsonb_build_object(''enabled'', false);
  END IF;

  _graph := ''https://graph.facebook.com/'' || _settings.graph_version;

  SELECT user_id INTO _admin
  FROM public.user_roles
  WHERE role = ''admin''::public.app_role
  ORDER BY user_id
  LIMIT 1;

  -- 1. Enfileira o que esta agendado, automatico, aprovado e com a hora chegada.
  FOR _due IN
    SELECT publication.id, publication.client_id
    FROM public.editorial_publications AS publication
    JOIN public.editorial_posts AS post ON post.id = publication.post_id
    WHERE publication.status = ''scheduled''
      AND publication.platform = ''instagram''
      AND publication.delivery_mode = ''automatic''
      AND publication.scheduled_at IS NOT NULL
      AND publication.scheduled_at <= now()
      AND post.content_type IN (''static'', ''story'', ''carousel'', ''reel'', ''video'', ''short'')
      -- O material precisa estar aprovado de verdade (duplo gate do painel).
      AND COALESCE(public.editorial_file_is_publishable(
            COALESCE(publication.file_id, post.primary_file_id),
            publication.client_id, publication.project_id), false)
      -- Aprovou depois da hora marcada? Espera 1h a partir da aprovacao.
      AND COALESCE((
            SELECT approval_file.client_decided_at <= publication.scheduled_at
                OR now() >= approval_file.client_decided_at + interval ''1 hour''
            FROM public.files AS approval_file
            WHERE approval_file.id = COALESCE(publication.file_id, post.primary_file_id)
          ), true)
      AND NOT EXISTS (
        SELECT 1 FROM social_private.autopublish_jobs AS job
        WHERE job.publication_id = publication.id
      )
    LIMIT 5
  LOOP
    INSERT INTO social_private.autopublish_jobs (publication_id, client_id, stage)
    VALUES (_due.id, _due.client_id, ''queued'')
    ON CONFLICT (publication_id) DO NOTHING;
    _queued := _queued + 1;
  END LOOP;

  -- 2. Avanca cada job, um passo por tick.
  FOR _job IN
    SELECT * FROM social_private.autopublish_jobs
    WHERE stage NOT IN (''done'', ''failed'')
    ORDER BY created_at
    LIMIT 10
  LOOP
    BEGIN
      SELECT
        publication.id,
        publication.external_account_id,
        publication.version,
        COALESCE(publication.caption, '''') AS caption,
        COALESCE(publication.file_id, post.primary_file_id) AS file_id,
        post.content_type
      INTO _pub
      FROM public.editorial_publications AS publication
      JOIN public.editorial_posts AS post ON post.id = publication.post_id
      WHERE publication.id = _job.publication_id;

      SELECT * INTO _token
      FROM social_private.autopublish_account_token(_pub.external_account_id);

      IF _token.access_token IS NULL THEN
        PERFORM social_private.autopublish_mark_failed(
          _job.publication_id,
          ''Conta Instagram sem conexao ativa ou token indisponivel. Reconecte a conta na agenda.'',
          _admin
        );
        _failed := _failed + 1;
        CONTINUE;
      END IF;

      _kind := CASE
        WHEN _pub.content_type = ''carousel'' THEN ''carousel''
        WHEN _pub.content_type = ''story'' THEN ''story''
        WHEN _pub.content_type IN (''reel'', ''video'', ''short'') THEN ''video''
        ELSE ''image''
      END;

      -- ───────────── 2a. Ha requisicao em voo: le a resposta ─────────────
      IF _job.net_request_id IS NOT NULL THEN
        SELECT status_code, content, timed_out, error_msg INTO _response
        FROM net._http_response WHERE id = _job.net_request_id;

        IF NOT FOUND THEN
          -- Resposta ainda em transito OU expurgada pelo pg_net. Depois de um
          -- tempo, retoma com seguranca em vez de esperar para sempre.
          IF _job.updated_at < now() - _lost_after THEN
            UPDATE social_private.autopublish_jobs
            SET net_request_id = NULL,
                -- Publicacao ja despachada nunca e reenviada as cegas.
                stage = CASE WHEN stage = ''publish'' AND publish_dispatched THEN ''verify'' ELSE stage END,
                step_attempts = CASE WHEN stage = ''publish'' AND publish_dispatched THEN 0 ELSE step_attempts END,
                last_error = ''Resposta da Meta perdida; retomando o passo.'',
                updated_at = now()
            WHERE publication_id = _job.publication_id;
          END IF;
          CONTINUE;
        END IF;

        IF _response.timed_out
          OR _response.status_code IS NULL
          OR _response.status_code >= 300 THEN
          UPDATE social_private.autopublish_jobs
          SET net_request_id = NULL,
              stage = CASE WHEN stage = ''publish'' AND publish_dispatched THEN ''verify'' ELSE stage END,
              step_attempts = CASE WHEN stage = ''publish'' AND publish_dispatched THEN 0 ELSE step_attempts END,
              last_error = left(COALESCE(
                _response.content::text,
                _response.error_msg,
                ''sem resposta da Meta''
              ), 500),
              updated_at = now()
          WHERE publication_id = _job.publication_id;
          CONTINUE;
        END IF;

        _body := _response.content::jsonb;

        IF _job.stage = ''queued'' THEN
          IF _kind = ''video'' THEN
            UPDATE social_private.autopublish_jobs
            SET container_id = _body->>''id'', stage = ''processing'', poll_count = 0,
                step_attempts = 0, net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
          ELSIF _kind = ''carousel'' THEN
            UPDATE social_private.autopublish_jobs
            SET child_container_ids = child_container_ids || (_body->>''id''),
                child_index = child_index + 1,
                stage = ''children'', step_attempts = 0,
                net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
          ELSE
            UPDATE social_private.autopublish_jobs
            SET container_id = _body->>''id'', stage = ''publish'',
                step_attempts = 0, net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
          END IF;
          _advanced := _advanced + 1;
          CONTINUE;
        END IF;

        IF _job.stage = ''children'' THEN
          UPDATE social_private.autopublish_jobs
          SET child_container_ids = child_container_ids || (_body->>''id''),
              child_index = child_index + 1,
              step_attempts = 0,
              net_request_id = NULL, updated_at = now()
          WHERE publication_id = _job.publication_id;
          _advanced := _advanced + 1;
          CONTINUE;
        END IF;

        IF _job.stage = ''parent'' THEN
          UPDATE social_private.autopublish_jobs
          SET container_id = _body->>''id'', stage = ''publish'',
              step_attempts = 0, net_request_id = NULL, updated_at = now()
          WHERE publication_id = _job.publication_id;
          _advanced := _advanced + 1;
          CONTINUE;
        END IF;

        IF _job.stage = ''processing'' THEN
          _status_code := COALESCE(_body->>''status_code'', '''');
          IF _status_code = ''FINISHED'' THEN
            UPDATE social_private.autopublish_jobs
            SET stage = ''publish'', step_attempts = 0, net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
            _advanced := _advanced + 1;
          ELSIF _status_code = ''ERROR'' THEN
            PERFORM social_private.autopublish_mark_failed(
              _job.publication_id,
              ''Instagram nao conseguiu processar o video: '' || COALESCE(_body::text, ''''),
              _admin
            );
            _failed := _failed + 1;
          ELSE
            UPDATE social_private.autopublish_jobs
            SET net_request_id = NULL, poll_count = poll_count + 1, updated_at = now()
            WHERE publication_id = _job.publication_id;
            IF _job.poll_count >= 40 THEN
              PERFORM social_private.autopublish_mark_failed(
                _job.publication_id,
                ''Video passou de 40 minutos em processamento no Instagram.'',
                _admin
              );
              _failed := _failed + 1;
            END IF;
          END IF;
          CONTINUE;
        END IF;

        IF _job.stage = ''publish'' THEN
          UPDATE social_private.autopublish_jobs
          SET media_id = _body->>''id'', stage = ''permalink'',
              step_attempts = 0, net_request_id = NULL, updated_at = now()
          WHERE publication_id = _job.publication_id;
          _advanced := _advanced + 1;
          CONTINUE;
        END IF;

        IF _job.stage = ''verify'' THEN
          -- Pergunta ao Instagram: este container ja virou post?
          _status_code := COALESCE(_body->>''status_code'', '''');
          IF _status_code = ''PUBLISHED'' THEN
            -- Ja esta no ar: recupera o post real em vez de publicar de novo.
            UPDATE social_private.autopublish_jobs
            SET stage = ''recover'', step_attempts = 0, net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
            _advanced := _advanced + 1;
          ELSIF _status_code = ''FINISHED'' THEN
            -- Pronto e NAO publicado: seguro reenviar a publicacao.
            UPDATE social_private.autopublish_jobs
            SET stage = ''publish'', net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
            _advanced := _advanced + 1;
          ELSIF _status_code IN (''ERROR'', ''EXPIRED'') THEN
            PERFORM social_private.autopublish_mark_failed(
              _job.publication_id,
              ''Container invalido na verificacao ('' || _status_code || ''). Use Tentar de novo para reprocessar.'',
              _admin
            );
            _failed := _failed + 1;
          ELSE
            UPDATE social_private.autopublish_jobs
            SET net_request_id = NULL, poll_count = poll_count + 1, updated_at = now()
            WHERE publication_id = _job.publication_id;
            IF _job.poll_count >= 40 THEN
              PERFORM social_private.autopublish_mark_failed(
                _job.publication_id,
                ''Verificacao do container nao concluiu em 40 minutos.'',
                _admin
              );
              _failed := _failed + 1;
            END IF;
          END IF;
          CONTINUE;
        END IF;

        IF _job.stage = ''recover'' THEN
          -- Ultimo post da conta: e o que acabamos de publicar.
          IF jsonb_array_length(COALESCE(_body->''data'', ''[]''::jsonb)) > 0 THEN
            UPDATE social_private.autopublish_jobs
            SET media_id = _body->''data''->0->>''id'',
                permalink = _body->''data''->0->>''permalink'',
                stage = ''permalink'', step_attempts = 0,
                net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
            _advanced := _advanced + 1;
          ELSE
            UPDATE social_private.autopublish_jobs
            SET stage = ''done'', net_request_id = NULL,
                last_error = ''Post publicado, mas nao foi possivel recuperar o link. Confirme no perfil e marque como publicado no painel.'',
                updated_at = now()
            WHERE publication_id = _job.publication_id;
          END IF;
          CONTINUE;
        END IF;

        IF _job.stage = ''permalink'' THEN
          _permalink := NULLIF(btrim(COALESCE(_body->>''permalink'', '''')), '''');
          -- Story pode voltar sem permalink; usa o perfil de stories como link.
          IF _permalink IS NULL AND _kind = ''story'' THEN
            _permalink := ''https://www.instagram.com/stories/'';
          END IF;

          UPDATE social_private.autopublish_jobs
          SET permalink = _permalink, stage = ''done'', net_request_id = NULL, updated_at = now()
          WHERE publication_id = _job.publication_id;

          -- Baixa oficial em bloco proprio: falhar aqui NAO desfaz o done.
          IF _admin IS NULL THEN
            UPDATE social_private.autopublish_jobs
            SET last_error = ''Post no ar, mas nenhum admin cadastrado para registrar a baixa no painel.'',
                updated_at = now()
            WHERE publication_id = _job.publication_id;
          ELSIF _permalink IS NULL THEN
            UPDATE social_private.autopublish_jobs
            SET last_error = ''Post no ar, mas o Instagram nao devolveu o link. Marque como publicado no painel.'',
                updated_at = now()
            WHERE publication_id = _job.publication_id;
          ELSE
            BEGIN
              PERFORM set_config(
                ''request.jwt.claims'',
                json_build_object(''sub'', _admin::text, ''role'', ''authenticated'')::text,
                true
              );
              PERFORM public.transition_editorial_publication(
                p_publication_id => _job.publication_id,
                p_action => ''publish'',
                p_expected_version => _pub.version,
                p_permalink => _permalink,
                p_external_post_id => COALESCE(_job.media_id, _body->>''id''),
                p_published_at => now()
              );
            EXCEPTION WHEN OTHERS THEN
              UPDATE social_private.autopublish_jobs
              SET last_error = left(''Post no ar; baixa oficial falhou: '' || SQLERRM, 500),
                  updated_at = now()
              WHERE publication_id = _job.publication_id;
            END;
          END IF;
          _published := _published + 1;
          CONTINUE;
        END IF;
      END IF;

      -- ─────────── 2b. Sem requisicao em voo: dispara o proximo passo ───────────

      -- Limite por passo: esgotou, falha de vez (com baixa oficial).
      IF _job.step_attempts >= _step_limit THEN
        PERFORM social_private.autopublish_mark_failed(
          _job.publication_id,
          ''Passo "'' || _job.stage || ''" falhou apos '' || _job.step_attempts ||
            '' tentativas. Ultimo erro: '' || COALESCE(_job.last_error, ''sem detalhe''),
          _admin
        );
        _failed := _failed + 1;
        CONTINUE;
      END IF;

      IF _job.stage = ''queued'' THEN
        IF _kind = ''carousel'' THEN
          -- Ordem oficial congelada no agendamento; nome de arquivo e reserva.
          _urls := social_private.autopublish_ordered_urls(_pub.id, _pub.file_id);
          IF _urls IS NULL OR array_length(_urls, 1) < 2 THEN
            PERFORM social_private.autopublish_mark_failed(
              _job.publication_id,
              ''Carrossel precisa de pelo menos 2 imagens com URL publica.'',
              _admin
            );
            _failed := _failed + 1;
            CONTINUE;
          END IF;
          IF array_length(_urls, 1) > 10 THEN
            _urls := _urls[1:10];
          END IF;
          UPDATE social_private.autopublish_jobs
          SET child_urls = _urls, child_index = 0, child_container_ids = ARRAY[]::text[], updated_at = now()
          WHERE publication_id = _job.publication_id;
          _payload := _graph || ''/'' || _token.resource_id || ''/media''
            || ''?image_url='' || social_private.autopublish_urlencode(_urls[1])
            || ''&is_carousel_item=true''
            || ''&access_token='' || _token.access_token;
        ELSIF _kind = ''video'' THEN
          _payload := _graph || ''/'' || _token.resource_id || ''/media''
            || ''?media_type=REELS''
            || ''&video_url='' || social_private.autopublish_urlencode(social_private.autopublish_file_url(_pub.file_id))
            || ''&caption='' || social_private.autopublish_urlencode(_pub.caption)
            || ''&access_token='' || _token.access_token;
        ELSIF _kind = ''story'' THEN
          -- Story vai para stories, nao para o feed. Story nao tem legenda.
          _payload := _graph || ''/'' || _token.resource_id || ''/media''
            || ''?media_type=STORIES''
            || ''&image_url='' || social_private.autopublish_urlencode(social_private.autopublish_file_url(_pub.file_id))
            || ''&access_token='' || _token.access_token;
        ELSE
          _payload := _graph || ''/'' || _token.resource_id || ''/media''
            || ''?image_url='' || social_private.autopublish_urlencode(social_private.autopublish_file_url(_pub.file_id))
            || ''&caption='' || social_private.autopublish_urlencode(_pub.caption)
            || ''&access_token='' || _token.access_token;
        END IF;
        SELECT net.http_post(url := _payload, headers := ''{}''::jsonb, timeout_milliseconds := 20000)
        INTO _request_id;
        UPDATE social_private.autopublish_jobs
        SET net_request_id = _request_id, attempts = attempts + 1,
            step_attempts = step_attempts + 1, updated_at = now()
        WHERE publication_id = _job.publication_id;
        _advanced := _advanced + 1;
        CONTINUE;
      END IF;

      IF _job.stage = ''children'' THEN
        IF _job.child_index < COALESCE(array_length(_job.child_urls, 1), 0) THEN
          _payload := _graph || ''/'' || _token.resource_id || ''/media''
            || ''?image_url='' || social_private.autopublish_urlencode(_job.child_urls[_job.child_index + 1])
            || ''&is_carousel_item=true''
            || ''&access_token='' || _token.access_token;
          SELECT net.http_post(url := _payload, headers := ''{}''::jsonb, timeout_milliseconds := 20000)
          INTO _request_id;
          UPDATE social_private.autopublish_jobs
          SET net_request_id = _request_id, attempts = attempts + 1,
              step_attempts = step_attempts + 1, updated_at = now()
          WHERE publication_id = _job.publication_id;
        ELSE
          _payload := _graph || ''/'' || _token.resource_id || ''/media''
            || ''?media_type=CAROUSEL''
            || ''&children='' || array_to_string(_job.child_container_ids, '','')
            || ''&caption='' || social_private.autopublish_urlencode(_pub.caption)
            || ''&access_token='' || _token.access_token;
          SELECT net.http_post(url := _payload, headers := ''{}''::jsonb, timeout_milliseconds := 20000)
          INTO _request_id;
          UPDATE social_private.autopublish_jobs
          SET stage = ''parent'', net_request_id = _request_id, attempts = attempts + 1,
              step_attempts = 1, updated_at = now()
          WHERE publication_id = _job.publication_id;
        END IF;
        _advanced := _advanced + 1;
        CONTINUE;
      END IF;

      IF _job.stage = ''processing'' THEN
        _payload := _graph || ''/'' || _job.container_id
          || ''?fields=status_code&access_token='' || _token.access_token;
        SELECT net.http_get(url := _payload, timeout_milliseconds := 10000) INTO _request_id;
        UPDATE social_private.autopublish_jobs
        SET net_request_id = _request_id, updated_at = now()
        WHERE publication_id = _job.publication_id;
        CONTINUE;
      END IF;

      IF _job.stage = ''publish'' AND _job.container_id IS NOT NULL THEN
        _payload := _graph || ''/'' || _token.resource_id || ''/media_publish''
          || ''?creation_id='' || _job.container_id
          || ''&access_token='' || _token.access_token;
        SELECT net.http_post(url := _payload, headers := ''{}''::jsonb, timeout_milliseconds := 20000)
        INTO _request_id;
        UPDATE social_private.autopublish_jobs
        SET net_request_id = _request_id, attempts = attempts + 1,
            step_attempts = step_attempts + 1,
            publish_dispatched = true, updated_at = now()
        WHERE publication_id = _job.publication_id;
        _advanced := _advanced + 1;
        CONTINUE;
      END IF;

      IF _job.stage = ''verify'' AND _job.container_id IS NOT NULL THEN
        _payload := _graph || ''/'' || _job.container_id
          || ''?fields=status_code&access_token='' || _token.access_token;
        SELECT net.http_get(url := _payload, timeout_milliseconds := 10000) INTO _request_id;
        UPDATE social_private.autopublish_jobs
        SET net_request_id = _request_id, step_attempts = step_attempts + 1, updated_at = now()
        WHERE publication_id = _job.publication_id;
        CONTINUE;
      END IF;

      IF _job.stage = ''recover'' THEN
        _payload := _graph || ''/'' || _token.resource_id || ''/media''
          || ''?fields=id,permalink&limit=1''
          || ''&access_token='' || _token.access_token;
        SELECT net.http_get(url := _payload, timeout_milliseconds := 10000) INTO _request_id;
        UPDATE social_private.autopublish_jobs
        SET net_request_id = _request_id, step_attempts = step_attempts + 1, updated_at = now()
        WHERE publication_id = _job.publication_id;
        CONTINUE;
      END IF;

      IF _job.stage = ''permalink'' AND _job.media_id IS NOT NULL THEN
        _payload := _graph || ''/'' || _job.media_id
          || ''?fields=permalink&access_token='' || _token.access_token;
        SELECT net.http_get(url := _payload, timeout_milliseconds := 10000) INTO _request_id;
        UPDATE social_private.autopublish_jobs
        SET net_request_id = _request_id, step_attempts = step_attempts + 1, updated_at = now()
        WHERE publication_id = _job.publication_id;
        _advanced := _advanced + 1;
        CONTINUE;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      UPDATE social_private.autopublish_jobs
      SET last_error = left(SQLERRM, 500),
          step_attempts = step_attempts + 1,
          net_request_id = NULL,
          updated_at = now()
      WHERE publication_id = _job.publication_id;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    ''enabled'', true, ''queued'', _queued, ''advanced'', _advanced,
    ''published'', _published, ''failed'', _failed
  );
END
$function$',
    'REVOKE ALL ON FUNCTION public.editorial_autopublish_tick() FROM PUBLIC, anon, authenticated',
    'GRANT EXECUTE ON FUNCTION public.editorial_autopublish_tick() TO service_role',
    '-- ──────────────────── Tentar de novo, com um clique da equipe ─────────────────
CREATE OR REPLACE FUNCTION public.retry_autopublish(p_publication_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''''
AS $$
DECLARE
  _job social_private.autopublish_jobs%ROWTYPE;
  _actor uuid := auth.uid();
  _next_stage text;
BEGIN
  SELECT * INTO _job
  FROM social_private.autopublish_jobs
  WHERE publication_id = p_publication_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION ''nenhuma tentativa de publicacao automatica para reprocessar'';
  END IF;

  IF _actor IS NULL
    OR NOT public.is_staff(_actor)
    OR NOT public.can_access_client(_job.client_id) THEN
    RAISE EXCEPTION ''retry access denied'';
  END IF;

  IF _job.stage <> ''failed'' THEN
    RAISE EXCEPTION ''a publicacao nao esta em falha (estagio atual: %)'', _job.stage;
  END IF;

  -- Se a publicacao chegou a ser despachada, recomeca pela VERIFICACAO para
  -- nunca postar duas vezes. Caso contrario, recomeca do zero.
  _next_stage := CASE
    WHEN _job.publish_dispatched AND _job.container_id IS NOT NULL THEN ''verify''
    ELSE ''queued''
  END;

  UPDATE social_private.autopublish_jobs
  SET stage = _next_stage,
      step_attempts = 0,
      poll_count = 0,
      net_request_id = NULL,
      last_error = NULL,
      child_index = CASE WHEN _next_stage = ''queued'' THEN 0 ELSE child_index END,
      child_urls = CASE WHEN _next_stage = ''queued'' THEN ARRAY[]::text[] ELSE child_urls END,
      child_container_ids = CASE WHEN _next_stage = ''queued'' THEN ARRAY[]::text[] ELSE child_container_ids END,
      container_id = CASE WHEN _next_stage = ''queued'' THEN NULL ELSE container_id END,
      updated_at = now()
  WHERE publication_id = p_publication_id;

  RETURN jsonb_build_object(''publication_id'', p_publication_id, ''stage'', _next_stage);
END;
$$',
    'REVOKE ALL ON FUNCTION public.retry_autopublish(uuid) FROM PUBLIC, anon',
    'GRANT EXECUTE ON FUNCTION public.retry_autopublish(uuid) TO authenticated'
  ]::text[]),
  ('20260813220000', 'autopublish_publish_all_scheduled', ARRAY[
    '-- ============================================================================
-- Aceleriq OS - agendou e aprovou, publica. Sem depender de marcação interna.
-- ============================================================================
--
-- O caso real: um post foi agendado, o horário passou e nada saiu. Motivo: o
-- registro nasceu com a marcação interna de entrega "manual" (dois caminhos de
-- agendamento do painel nem enviavam a marcação, e tudo que já existia também
-- estava assim). O motor só olhava para "automatic", então ignorava o post,
-- sem erro e sem aviso.
--
-- Decisão de produto: no Aceleriq OS, agendamento de Instagram aprovado É para
-- publicar sozinho. Este patch remove a marcação da regra de entrada do motor.
-- Todas as outras travas continuam exatamente iguais: precisa estar
-- ''scheduled'', no horário, com material aprovado pelo duplo gate e respeitando
-- a carência de 1 hora pós-aprovação.
--
-- ATENÇÃO: ao rodar, agendamentos vencidos e APROVADOS que estavam presos pela
-- marcação passam a ser publicados no próximo minuto. Se houver algum
-- agendamento antigo que não deve mais sair, cancele antes de rodar.
--
-- Técnica: mesmo padrão do patch 20260812190000 - reescreve a função atual
-- trocando só a linha da condição, preservando o restante do corpo v3.
-- ============================================================================

DO $$
DECLARE
  _def text;
BEGIN
  SELECT pg_get_functiondef(''public.editorial_autopublish_tick()''::regprocedure)
  INTO _def;

  IF _def IS NULL THEN
    RAISE EXCEPTION ''editorial_autopublish_tick nao encontrada'';
  END IF;

  IF position(''publication.delivery_mode = ''''automatic'''''' IN _def) = 0 THEN
    RAISE NOTICE ''Patch ja aplicado: a marcacao de entrega nao e mais uma trava.'';
    RETURN;
  END IF;

  _def := replace(
    _def,
    ''AND publication.delivery_mode = ''''automatic'''''',
    ''AND publication.delivery_mode IN (''''manual'''', ''''automatic'''')''
  );

  EXECUTE _def;
  RAISE NOTICE ''Motor atualizado: todo agendamento aprovado de Instagram publica sozinho.'';
END;
$$'
  ]::text[]),
  ('20260813230000', 'autopublish_v4_signed_urls', ARRAY[
    '-- ============================================================================
-- Aceleriq OS - publicação automática v4: mídia com link ASSINADO
-- ============================================================================
--
-- O erro real devolvido pela Meta na primeira publicação de verdade:
--   "Only photo or video can be accepted as media type" / "Falha ao baixar
--    mídia. O URI da mídia não atende aos nossos requisitos:
--    .../storage/v1/object/public/files/..."
--
-- Causa: o motor montava link PÚBLICO para a arte, mas o bucket `files` é
-- PRIVADO desde julho (decisão de segurança correta). A Meta tentava baixar,
-- levava porta na cara, e o job falhava.
--
-- Correção: novo estágio `sign` na máquina. Antes de criar qualquer container,
-- o motor pede ao Storage links ASSINADOS (validade 6 horas, uma chamada em
-- lote para todos os cartões) usando a service key guardada no Vault (a mesma
-- infraestrutura da fila de e-mails). O bucket continua privado; só a Meta,
-- com o link assinado e temporário, consegue baixar.
--
-- Também entra `autopublish_storage_paths`: os CAMINHOS dos arquivos na ordem
-- congelada do agendamento (fallback: leitura por nome), porque a assinatura
-- trabalha com caminhos, não com URLs.
-- ============================================================================

-- ─────────────────────────── Estágio novo na fila ────────────────────────────
ALTER TABLE social_private.autopublish_jobs
  DROP CONSTRAINT IF EXISTS autopublish_jobs_stage_check',
    'ALTER TABLE social_private.autopublish_jobs
  ADD CONSTRAINT autopublish_jobs_stage_check CHECK (
    stage IN (''queued'', ''sign'', ''children'', ''parent'', ''processing'', ''publish'',
              ''verify'', ''recover'', ''permalink'', ''done'', ''failed'')
  )',
    '-- ──────────────── Service key do Vault (mesma da fila de e-mails) ────────────
CREATE OR REPLACE FUNCTION social_private.autopublish_service_key()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''''
AS $function$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = ''email_queue_service_role_key''
  LIMIT 1;
$function$',
    '-- ───────── Caminhos dos arquivos na ordem congelada (fallback: nome) ─────────
CREATE OR REPLACE FUNCTION social_private.autopublish_storage_paths(
  _publication_id uuid,
  _root_file_id uuid
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''''
AS $function$
DECLARE
  _paths text[];
BEGIN
  -- Ordem oficial: a lista congelada no agendamento.
  SELECT ARRAY(
    SELECT file_row.storage_path
    FROM social_private.editorial_publication_assets AS asset
    JOIN public.files AS file_row ON file_row.id = asset.file_id
    WHERE asset.publication_id = _publication_id
      AND file_row.storage_path IS NOT NULL
    ORDER BY asset.position
  )
  INTO _paths;

  IF _paths IS NOT NULL AND array_length(_paths, 1) >= 1 THEN
    RETURN _paths;
  END IF;

  -- Agendamento antigo sem lista congelada: capa + cartões pelo nome.
  SELECT ARRAY(
    SELECT path FROM (
      SELECT root_row.storage_path AS path, -1 AS order_index, NULL::timestamptz AS created_at
      FROM public.files AS root_row
      WHERE root_row.id = _root_file_id
      UNION ALL
      SELECT
        child.storage_path,
        COALESCE(
          NULLIF(substring(child.file_name FROM ''(?i)(?:card|slide|p[aá]gina|page)[ ._-]*(\d+)''), '''')::int,
          NULLIF(substring(child.file_name FROM ''^(\d+)[ ._-]''), '''')::int,
          32000
        ),
        child.created_at
      FROM public.files AS child
      WHERE child.parent_file_id = _root_file_id
        AND child.archived_at IS NULL
        AND COALESCE(child.status, ''ready'') NOT IN (''deleted'', ''failed'')
    ) AS all_items
    WHERE path IS NOT NULL
    ORDER BY order_index, created_at NULLS LAST
  )
  INTO _paths;

  RETURN COALESCE(_paths, ARRAY[]::text[]);
END;
$function$',
    '-- ───────────────────────────── Executor v4 ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.editorial_autopublish_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''''
AS $function$
DECLARE
  _settings social_private.autopublish_settings%ROWTYPE;
  _graph text;
  _due record;
  _job record;
  _pub record;
  _response record;
  _token record;
  _payload text;
  _request_id bigint;
  _admin uuid;
  _queued int := 0;
  _advanced int := 0;
  _published int := 0;
  _failed int := 0;
  _body jsonb;
  _urls text[];
  _paths text[];
  _kind text;
  _status_code text;
  _permalink text;
  _service_key text;
  _signed jsonb;
  _entry jsonb;
  _signed_url text;
  _step_limit constant smallint := 4;
  _lost_after constant interval := interval ''10 minutes'';
BEGIN
  SELECT * INTO _settings FROM social_private.autopublish_settings WHERE id;
  IF _settings IS NULL OR NOT _settings.enabled THEN
    RETURN jsonb_build_object(''enabled'', false);
  END IF;

  _graph := ''https://graph.facebook.com/'' || _settings.graph_version;

  SELECT user_id INTO _admin
  FROM public.user_roles
  WHERE role = ''admin''::public.app_role
  ORDER BY user_id
  LIMIT 1;

  -- 1. Enfileira o que esta agendado, aprovado e com a hora chegada.
  FOR _due IN
    SELECT publication.id, publication.client_id
    FROM public.editorial_publications AS publication
    JOIN public.editorial_posts AS post ON post.id = publication.post_id
    WHERE publication.status = ''scheduled''
      AND publication.platform = ''instagram''
      AND publication.delivery_mode IN (''manual'', ''automatic'')
      AND publication.scheduled_at IS NOT NULL
      AND publication.scheduled_at <= now()
      AND post.content_type IN (''static'', ''story'', ''carousel'', ''reel'', ''video'', ''short'')
      AND COALESCE(public.editorial_file_is_publishable(
            COALESCE(publication.file_id, post.primary_file_id),
            publication.client_id, publication.project_id), false)
      AND COALESCE((
            SELECT approval_file.client_decided_at <= publication.scheduled_at
                OR now() >= approval_file.client_decided_at + interval ''1 hour''
            FROM public.files AS approval_file
            WHERE approval_file.id = COALESCE(publication.file_id, post.primary_file_id)
          ), true)
      AND NOT EXISTS (
        SELECT 1 FROM social_private.autopublish_jobs AS job
        WHERE job.publication_id = publication.id
      )
    LIMIT 5
  LOOP
    INSERT INTO social_private.autopublish_jobs (publication_id, client_id, stage)
    VALUES (_due.id, _due.client_id, ''queued'')
    ON CONFLICT (publication_id) DO NOTHING;
    _queued := _queued + 1;
  END LOOP;

  -- 2. Avanca cada job, um passo por tick.
  FOR _job IN
    SELECT * FROM social_private.autopublish_jobs
    WHERE stage NOT IN (''done'', ''failed'')
    ORDER BY created_at
    LIMIT 10
  LOOP
    BEGIN
      SELECT
        publication.id,
        publication.external_account_id,
        publication.version,
        COALESCE(publication.caption, '''') AS caption,
        COALESCE(publication.file_id, post.primary_file_id) AS file_id,
        post.content_type
      INTO _pub
      FROM public.editorial_publications AS publication
      JOIN public.editorial_posts AS post ON post.id = publication.post_id
      WHERE publication.id = _job.publication_id;

      SELECT * INTO _token
      FROM social_private.autopublish_account_token(_pub.external_account_id);

      IF _token.access_token IS NULL THEN
        PERFORM social_private.autopublish_mark_failed(
          _job.publication_id,
          ''Conta Instagram sem conexao ativa ou token indisponivel. Reconecte a conta na agenda.'',
          _admin
        );
        _failed := _failed + 1;
        CONTINUE;
      END IF;

      _kind := CASE
        WHEN _pub.content_type = ''carousel'' THEN ''carousel''
        WHEN _pub.content_type = ''story'' THEN ''story''
        WHEN _pub.content_type IN (''reel'', ''video'', ''short'') THEN ''video''
        ELSE ''image''
      END;

      -- ───────────── 2a. Ha requisicao em voo: le a resposta ─────────────
      IF _job.net_request_id IS NOT NULL THEN
        SELECT status_code, content, timed_out, error_msg INTO _response
        FROM net._http_response WHERE id = _job.net_request_id;

        IF NOT FOUND THEN
          IF _job.updated_at < now() - _lost_after THEN
            UPDATE social_private.autopublish_jobs
            SET net_request_id = NULL,
                stage = CASE WHEN stage = ''publish'' AND publish_dispatched THEN ''verify'' ELSE stage END,
                step_attempts = CASE WHEN stage = ''publish'' AND publish_dispatched THEN 0 ELSE step_attempts END,
                last_error = ''Resposta da Meta perdida; retomando o passo.'',
                updated_at = now()
            WHERE publication_id = _job.publication_id;
          END IF;
          CONTINUE;
        END IF;

        IF _response.timed_out
          OR _response.status_code IS NULL
          OR _response.status_code >= 300 THEN
          UPDATE social_private.autopublish_jobs
          SET net_request_id = NULL,
              stage = CASE WHEN stage = ''publish'' AND publish_dispatched THEN ''verify'' ELSE stage END,
              step_attempts = CASE WHEN stage = ''publish'' AND publish_dispatched THEN 0 ELSE step_attempts END,
              last_error = left(COALESCE(
                _response.content::text,
                _response.error_msg,
                ''sem resposta''
              ), 500),
              updated_at = now()
          WHERE publication_id = _job.publication_id;
          CONTINUE;
        END IF;

        _body := _response.content::jsonb;

        IF _job.stage = ''sign'' THEN
          -- Links assinados prontos: monta as URLs completas na MESMA ordem.
          IF jsonb_typeof(_body) <> ''array'' THEN
            UPDATE social_private.autopublish_jobs
            SET net_request_id = NULL,
                last_error = left(''Assinatura de midia inesperada: '' || COALESCE(_body::text, ''''), 500),
                updated_at = now()
            WHERE publication_id = _job.publication_id;
            CONTINUE;
          END IF;
          _urls := ARRAY[]::text[];
          FOR _entry IN SELECT * FROM jsonb_array_elements(_body)
          LOOP
            _signed_url := COALESCE(_entry->>''signedURL'', _entry->>''signedUrl'');
            IF _signed_url IS NULL OR COALESCE(_entry->>''error'', '''') <> '''' THEN
              CONTINUE;
            END IF;
            _urls := _urls || (_settings.storage_base_url || ''/storage/v1'' || _signed_url);
          END LOOP;
          IF array_length(_urls, 1) IS NULL THEN
            PERFORM social_private.autopublish_mark_failed(
              _job.publication_id,
              ''Nao foi possivel assinar os arquivos da publicacao.'',
              _admin
            );
            _failed := _failed + 1;
            CONTINUE;
          END IF;
          UPDATE social_private.autopublish_jobs
          SET child_urls = _urls, child_index = 0,
              child_container_ids = ARRAY[]::text[],
              stage = ''queued'', step_attempts = 0,
              net_request_id = NULL, updated_at = now()
          WHERE publication_id = _job.publication_id;
          _advanced := _advanced + 1;
          CONTINUE;
        END IF;

        IF _job.stage = ''queued'' THEN
          IF _kind = ''video'' THEN
            UPDATE social_private.autopublish_jobs
            SET container_id = _body->>''id'', stage = ''processing'', poll_count = 0,
                step_attempts = 0, net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
          ELSIF _kind = ''carousel'' THEN
            UPDATE social_private.autopublish_jobs
            SET child_container_ids = child_container_ids || (_body->>''id''),
                child_index = child_index + 1,
                stage = ''children'', step_attempts = 0,
                net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
          ELSE
            UPDATE social_private.autopublish_jobs
            SET container_id = _body->>''id'', stage = ''publish'',
                step_attempts = 0, net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
          END IF;
          _advanced := _advanced + 1;
          CONTINUE;
        END IF;

        IF _job.stage = ''children'' THEN
          UPDATE social_private.autopublish_jobs
          SET child_container_ids = child_container_ids || (_body->>''id''),
              child_index = child_index + 1,
              step_attempts = 0,
              net_request_id = NULL, updated_at = now()
          WHERE publication_id = _job.publication_id;
          _advanced := _advanced + 1;
          CONTINUE;
        END IF;

        IF _job.stage = ''parent'' THEN
          UPDATE social_private.autopublish_jobs
          SET container_id = _body->>''id'', stage = ''publish'',
              step_attempts = 0, net_request_id = NULL, updated_at = now()
          WHERE publication_id = _job.publication_id;
          _advanced := _advanced + 1;
          CONTINUE;
        END IF;

        IF _job.stage = ''processing'' THEN
          _status_code := COALESCE(_body->>''status_code'', '''');
          IF _status_code = ''FINISHED'' THEN
            UPDATE social_private.autopublish_jobs
            SET stage = ''publish'', step_attempts = 0, net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
            _advanced := _advanced + 1;
          ELSIF _status_code = ''ERROR'' THEN
            PERFORM social_private.autopublish_mark_failed(
              _job.publication_id,
              ''Instagram nao conseguiu processar o video: '' || COALESCE(_body::text, ''''),
              _admin
            );
            _failed := _failed + 1;
          ELSE
            UPDATE social_private.autopublish_jobs
            SET net_request_id = NULL, poll_count = poll_count + 1, updated_at = now()
            WHERE publication_id = _job.publication_id;
            IF _job.poll_count >= 40 THEN
              PERFORM social_private.autopublish_mark_failed(
                _job.publication_id,
                ''Video passou de 40 minutos em processamento no Instagram.'',
                _admin
              );
              _failed := _failed + 1;
            END IF;
          END IF;
          CONTINUE;
        END IF;

        IF _job.stage = ''publish'' THEN
          UPDATE social_private.autopublish_jobs
          SET media_id = _body->>''id'', stage = ''permalink'',
              step_attempts = 0, net_request_id = NULL, updated_at = now()
          WHERE publication_id = _job.publication_id;
          _advanced := _advanced + 1;
          CONTINUE;
        END IF;

        IF _job.stage = ''verify'' THEN
          _status_code := COALESCE(_body->>''status_code'', '''');
          IF _status_code = ''PUBLISHED'' THEN
            UPDATE social_private.autopublish_jobs
            SET stage = ''recover'', step_attempts = 0, net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
            _advanced := _advanced + 1;
          ELSIF _status_code = ''FINISHED'' THEN
            UPDATE social_private.autopublish_jobs
            SET stage = ''publish'', net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
            _advanced := _advanced + 1;
          ELSIF _status_code IN (''ERROR'', ''EXPIRED'') THEN
            PERFORM social_private.autopublish_mark_failed(
              _job.publication_id,
              ''Container invalido na verificacao ('' || _status_code || ''). Use Tentar de novo.'',
              _admin
            );
            _failed := _failed + 1;
          ELSE
            UPDATE social_private.autopublish_jobs
            SET net_request_id = NULL, poll_count = poll_count + 1, updated_at = now()
            WHERE publication_id = _job.publication_id;
            IF _job.poll_count >= 40 THEN
              PERFORM social_private.autopublish_mark_failed(
                _job.publication_id,
                ''Verificacao do container nao concluiu em 40 minutos.'',
                _admin
              );
              _failed := _failed + 1;
            END IF;
          END IF;
          CONTINUE;
        END IF;

        IF _job.stage = ''recover'' THEN
          IF jsonb_array_length(COALESCE(_body->''data'', ''[]''::jsonb)) > 0 THEN
            UPDATE social_private.autopublish_jobs
            SET media_id = _body->''data''->0->>''id'',
                permalink = _body->''data''->0->>''permalink'',
                stage = ''permalink'', step_attempts = 0,
                net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
            _advanced := _advanced + 1;
          ELSE
            UPDATE social_private.autopublish_jobs
            SET stage = ''done'', net_request_id = NULL,
                last_error = ''Post publicado, mas nao foi possivel recuperar o link. Confirme no perfil.'',
                updated_at = now()
            WHERE publication_id = _job.publication_id;
          END IF;
          CONTINUE;
        END IF;

        IF _job.stage = ''permalink'' THEN
          _permalink := NULLIF(btrim(COALESCE(_body->>''permalink'', '''')), '''');
          IF _permalink IS NULL AND _kind = ''story'' THEN
            _permalink := ''https://www.instagram.com/stories/'';
          END IF;

          UPDATE social_private.autopublish_jobs
          SET permalink = _permalink, stage = ''done'', net_request_id = NULL, updated_at = now()
          WHERE publication_id = _job.publication_id;

          IF _admin IS NULL THEN
            UPDATE social_private.autopublish_jobs
            SET last_error = ''Post no ar, mas nenhum admin cadastrado para registrar a baixa no painel.'',
                updated_at = now()
            WHERE publication_id = _job.publication_id;
          ELSIF _permalink IS NULL THEN
            UPDATE social_private.autopublish_jobs
            SET last_error = ''Post no ar, mas o Instagram nao devolveu o link. Marque como publicado no painel.'',
                updated_at = now()
            WHERE publication_id = _job.publication_id;
          ELSE
            BEGIN
              PERFORM set_config(
                ''request.jwt.claims'',
                json_build_object(''sub'', _admin::text, ''role'', ''authenticated'')::text,
                true
              );
              PERFORM public.transition_editorial_publication(
                p_publication_id => _job.publication_id,
                p_action => ''publish'',
                p_expected_version => _pub.version,
                p_permalink => _permalink,
                p_external_post_id => COALESCE(_job.media_id, _body->>''id''),
                p_published_at => now()
              );
            EXCEPTION WHEN OTHERS THEN
              UPDATE social_private.autopublish_jobs
              SET last_error = left(''Post no ar; baixa oficial falhou: '' || SQLERRM, 500),
                  updated_at = now()
              WHERE publication_id = _job.publication_id;
            END;
          END IF;
          _published := _published + 1;
          CONTINUE;
        END IF;
      END IF;

      -- ─────────── 2b. Sem requisicao em voo: dispara o proximo passo ───────────

      IF _job.step_attempts >= _step_limit THEN
        PERFORM social_private.autopublish_mark_failed(
          _job.publication_id,
          ''Passo "'' || _job.stage || ''" falhou apos '' || _job.step_attempts ||
            '' tentativas. Ultimo erro: '' || COALESCE(_job.last_error, ''sem detalhe''),
          _admin
        );
        _failed := _failed + 1;
        CONTINUE;
      END IF;

      IF _job.stage = ''queued'' THEN
        -- Primeiro: garantir midia ACESSIVEL pela Meta. Arquivo do Storage
        -- privado precisa de link assinado; a assinatura sai em lote, uma
        -- chamada para todos os cartoes.
        IF COALESCE(array_length(_job.child_urls, 1), 0) = 0 THEN
          _paths := social_private.autopublish_storage_paths(_pub.id, _pub.file_id);
          IF COALESCE(array_length(_paths, 1), 0) > 0 THEN
            _service_key := social_private.autopublish_service_key();
            IF _service_key IS NULL THEN
              PERFORM social_private.autopublish_mark_failed(
                _job.publication_id,
                ''Service key ausente no Vault; nao da para assinar a midia.'',
                _admin
              );
              _failed := _failed + 1;
              CONTINUE;
            END IF;
            SELECT net.http_post(
              url := _settings.storage_base_url || ''/storage/v1/object/sign/files'',
              body := jsonb_build_object(
                ''paths'', to_jsonb(_paths),
                ''expiresIn'', 21600
              ),
              headers := jsonb_build_object(
                ''Content-Type'', ''application/json'',
                ''Authorization'', ''Bearer '' || _service_key,
                ''apikey'', _service_key
              ),
              timeout_milliseconds := 15000
            ) INTO _request_id;
            UPDATE social_private.autopublish_jobs
            SET stage = ''sign'', net_request_id = _request_id,
                attempts = attempts + 1, step_attempts = step_attempts + 1,
                updated_at = now()
            WHERE publication_id = _job.publication_id;
            _advanced := _advanced + 1;
            CONTINUE;
          END IF;
          -- Sem storage_path (link externo http): segue com a URL legada.
          _urls := ARRAY[social_private.autopublish_file_url(_pub.file_id)];
          IF _urls[1] IS NULL THEN
            PERFORM social_private.autopublish_mark_failed(
              _job.publication_id,
              ''Arquivo sem caminho de storage e sem URL externa: nada para publicar.'',
              _admin
            );
            _failed := _failed + 1;
            CONTINUE;
          END IF;
          UPDATE social_private.autopublish_jobs
          SET child_urls = _urls, updated_at = now()
          WHERE publication_id = _job.publication_id;
          _job.child_urls := _urls;
        END IF;

        -- Midia pronta (assinada ou externa): dispara o primeiro container.
        _urls := _job.child_urls;
        IF _kind = ''carousel'' THEN
          IF array_length(_urls, 1) < 2 THEN
            PERFORM social_private.autopublish_mark_failed(
              _job.publication_id,
              ''Carrossel precisa de pelo menos 2 imagens acessiveis.'',
              _admin
            );
            _failed := _failed + 1;
            CONTINUE;
          END IF;
          IF array_length(_urls, 1) > 10 THEN
            _urls := _urls[1:10];
            UPDATE social_private.autopublish_jobs
            SET child_urls = _urls, updated_at = now()
            WHERE publication_id = _job.publication_id;
          END IF;
          _payload := _graph || ''/'' || _token.resource_id || ''/media''
            || ''?image_url='' || social_private.autopublish_urlencode(_urls[1])
            || ''&is_carousel_item=true''
            || ''&access_token='' || _token.access_token;
        ELSIF _kind = ''video'' THEN
          _payload := _graph || ''/'' || _token.resource_id || ''/media''
            || ''?media_type=REELS''
            || ''&video_url='' || social_private.autopublish_urlencode(_urls[1])
            || ''&caption='' || social_private.autopublish_urlencode(_pub.caption)
            || ''&access_token='' || _token.access_token;
        ELSIF _kind = ''story'' THEN
          _payload := _graph || ''/'' || _token.resource_id || ''/media''
            || ''?media_type=STORIES''
            || ''&image_url='' || social_private.autopublish_urlencode(_urls[1])
            || ''&access_token='' || _token.access_token;
        ELSE
          _payload := _graph || ''/'' || _token.resource_id || ''/media''
            || ''?image_url='' || social_private.autopublish_urlencode(_urls[1])
            || ''&caption='' || social_private.autopublish_urlencode(_pub.caption)
            || ''&access_token='' || _token.access_token;
        END IF;
        SELECT net.http_post(url := _payload, headers := ''{}''::jsonb, timeout_milliseconds := 20000)
        INTO _request_id;
        UPDATE social_private.autopublish_jobs
        SET net_request_id = _request_id, attempts = attempts + 1,
            step_attempts = step_attempts + 1, updated_at = now()
        WHERE publication_id = _job.publication_id;
        _advanced := _advanced + 1;
        CONTINUE;
      END IF;

      IF _job.stage = ''sign'' THEN
        -- Resposta perdida ou erro na assinatura: o dispatch de cima refaz.
        UPDATE social_private.autopublish_jobs
        SET stage = ''queued'', child_urls = ARRAY[]::text[], net_request_id = NULL, updated_at = now()
        WHERE publication_id = _job.publication_id;
        CONTINUE;
      END IF;

      IF _job.stage = ''children'' THEN
        IF _job.child_index < COALESCE(array_length(_job.child_urls, 1), 0) THEN
          _payload := _graph || ''/'' || _token.resource_id || ''/media''
            || ''?image_url='' || social_private.autopublish_urlencode(_job.child_urls[_job.child_index + 1])
            || ''&is_carousel_item=true''
            || ''&access_token='' || _token.access_token;
          SELECT net.http_post(url := _payload, headers := ''{}''::jsonb, timeout_milliseconds := 20000)
          INTO _request_id;
          UPDATE social_private.autopublish_jobs
          SET net_request_id = _request_id, attempts = attempts + 1,
              step_attempts = step_attempts + 1, updated_at = now()
          WHERE publication_id = _job.publication_id;
        ELSE
          _payload := _graph || ''/'' || _token.resource_id || ''/media''
            || ''?media_type=CAROUSEL''
            || ''&children='' || array_to_string(_job.child_container_ids, '','')
            || ''&caption='' || social_private.autopublish_urlencode(_pub.caption)
            || ''&access_token='' || _token.access_token;
          SELECT net.http_post(url := _payload, headers := ''{}''::jsonb, timeout_milliseconds := 20000)
          INTO _request_id;
          UPDATE social_private.autopublish_jobs
          SET stage = ''parent'', net_request_id = _request_id, attempts = attempts + 1,
              step_attempts = 1, updated_at = now()
          WHERE publication_id = _job.publication_id;
        END IF;
        _advanced := _advanced + 1;
        CONTINUE;
      END IF;

      IF _job.stage = ''processing'' THEN
        _payload := _graph || ''/'' || _job.container_id
          || ''?fields=status_code&access_token='' || _token.access_token;
        SELECT net.http_get(url := _payload, timeout_milliseconds := 10000) INTO _request_id;
        UPDATE social_private.autopublish_jobs
        SET net_request_id = _request_id, updated_at = now()
        WHERE publication_id = _job.publication_id;
        CONTINUE;
      END IF;

      IF _job.stage = ''publish'' AND _job.container_id IS NOT NULL THEN
        _payload := _graph || ''/'' || _token.resource_id || ''/media_publish''
          || ''?creation_id='' || _job.container_id
          || ''&access_token='' || _token.access_token;
        SELECT net.http_post(url := _payload, headers := ''{}''::jsonb, timeout_milliseconds := 20000)
        INTO _request_id;
        UPDATE social_private.autopublish_jobs
        SET net_request_id = _request_id, attempts = attempts + 1,
            step_attempts = step_attempts + 1,
            publish_dispatched = true, updated_at = now()
        WHERE publication_id = _job.publication_id;
        _advanced := _advanced + 1;
        CONTINUE;
      END IF;

      IF _job.stage = ''verify'' AND _job.container_id IS NOT NULL THEN
        _payload := _graph || ''/'' || _job.container_id
          || ''?fields=status_code&access_token='' || _token.access_token;
        SELECT net.http_get(url := _payload, timeout_milliseconds := 10000) INTO _request_id;
        UPDATE social_private.autopublish_jobs
        SET net_request_id = _request_id, step_attempts = step_attempts + 1, updated_at = now()
        WHERE publication_id = _job.publication_id;
        CONTINUE;
      END IF;

      IF _job.stage = ''recover'' THEN
        _payload := _graph || ''/'' || _token.resource_id || ''/media''
          || ''?fields=id,permalink&limit=1''
          || ''&access_token='' || _token.access_token;
        SELECT net.http_get(url := _payload, timeout_milliseconds := 10000) INTO _request_id;
        UPDATE social_private.autopublish_jobs
        SET net_request_id = _request_id, step_attempts = step_attempts + 1, updated_at = now()
        WHERE publication_id = _job.publication_id;
        CONTINUE;
      END IF;

      IF _job.stage = ''permalink'' AND _job.media_id IS NOT NULL THEN
        _payload := _graph || ''/'' || _job.media_id
          || ''?fields=permalink&access_token='' || _token.access_token;
        SELECT net.http_get(url := _payload, timeout_milliseconds := 10000) INTO _request_id;
        UPDATE social_private.autopublish_jobs
        SET net_request_id = _request_id, step_attempts = step_attempts + 1, updated_at = now()
        WHERE publication_id = _job.publication_id;
        _advanced := _advanced + 1;
        CONTINUE;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      UPDATE social_private.autopublish_jobs
      SET last_error = left(SQLERRM, 500),
          step_attempts = step_attempts + 1,
          net_request_id = NULL,
          updated_at = now()
      WHERE publication_id = _job.publication_id;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    ''enabled'', true, ''queued'', _queued, ''advanced'', _advanced,
    ''published'', _published, ''failed'', _failed
  );
END
$function$',
    'REVOKE ALL ON FUNCTION public.editorial_autopublish_tick() FROM PUBLIC, anon, authenticated',
    'GRANT EXECUTE ON FUNCTION public.editorial_autopublish_tick() TO service_role'
  ]::text[]),
  ('20260814000000', 'autopublish_v5_fast_routes', ARRAY[
    '-- ============================================================================
-- Aceleriq OS - publicação automática v5: rota rápida
-- ============================================================================
--
-- O problema: o motor andava UM passo por minuto. Um carrossel de 7 cartões
-- fazia ~11 idas à Meta = 20 e poucos minutos com a equipe olhando. Dois
-- gargalos:
--   1. Os cartões eram criados UM POR VEZ (um por minuto).
--   2. Depois de ler uma resposta, o próximo passo só saía no minuto seguinte.
--
-- A v5 corta os dois:
--   1. CARTÕES EM PARALELO: todos os containers do carrossel são disparados de
--      uma vez (nova coluna child_request_ids acompanha cada um na ordem).
--   2. PASSO EMENDADO: na mesma rodada em que uma resposta chega, o próximo
--      passo já é disparado (laço interno de até 3 passadas por job).
--
-- Resultado: carrossel de qualquer tamanho em ~5 a 6 minutos; post simples em
-- ~3. Todas as garantias anteriores continuam: link assinado (v4), verify sem
-- duplicar post, tentativas por passo, falha visível e baixa oficial.
-- ============================================================================

ALTER TABLE social_private.autopublish_jobs
  ADD COLUMN IF NOT EXISTS child_request_ids bigint[] NOT NULL DEFAULT ARRAY[]::bigint[]',
    'CREATE OR REPLACE FUNCTION public.editorial_autopublish_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''''
AS $function$
DECLARE
  _settings social_private.autopublish_settings%ROWTYPE;
  _graph text;
  _due record;
  _job record;
  _pub record;
  _response record;
  _token record;
  _payload text;
  _request_id bigint;
  _admin uuid;
  _queued int := 0;
  _advanced int := 0;
  _published int := 0;
  _failed int := 0;
  _body jsonb;
  _urls text[];
  _paths text[];
  _kind text;
  _status_code text;
  _permalink text;
  _service_key text;
  _entry jsonb;
  _signed_url text;
  _req_ids bigint[];
  _containers text[];
  _idx int;
  _all_ready boolean;
  _wait boolean;
  _pass int;
  _step_limit constant smallint := 4;
  _lost_after constant interval := interval ''10 minutes'';
BEGIN
  SELECT * INTO _settings FROM social_private.autopublish_settings WHERE id;
  IF _settings IS NULL OR NOT _settings.enabled THEN
    RETURN jsonb_build_object(''enabled'', false);
  END IF;

  _graph := ''https://graph.facebook.com/'' || _settings.graph_version;

  SELECT user_id INTO _admin
  FROM public.user_roles
  WHERE role = ''admin''::public.app_role
  ORDER BY user_id
  LIMIT 1;

  -- 1. Enfileira o que esta agendado, aprovado e com a hora chegada.
  FOR _due IN
    SELECT publication.id, publication.client_id
    FROM public.editorial_publications AS publication
    JOIN public.editorial_posts AS post ON post.id = publication.post_id
    WHERE publication.status = ''scheduled''
      AND publication.platform = ''instagram''
      AND publication.delivery_mode IN (''manual'', ''automatic'')
      AND publication.scheduled_at IS NOT NULL
      AND publication.scheduled_at <= now()
      AND post.content_type IN (''static'', ''story'', ''carousel'', ''reel'', ''video'', ''short'')
      AND COALESCE(public.editorial_file_is_publishable(
            COALESCE(publication.file_id, post.primary_file_id),
            publication.client_id, publication.project_id), false)
      AND COALESCE((
            SELECT approval_file.client_decided_at <= publication.scheduled_at
                OR now() >= approval_file.client_decided_at + interval ''1 hour''
            FROM public.files AS approval_file
            WHERE approval_file.id = COALESCE(publication.file_id, post.primary_file_id)
          ), true)
      AND NOT EXISTS (
        SELECT 1 FROM social_private.autopublish_jobs AS job
        WHERE job.publication_id = publication.id
      )
    LIMIT 5
  LOOP
    INSERT INTO social_private.autopublish_jobs (publication_id, client_id, stage)
    VALUES (_due.id, _due.client_id, ''queued'')
    ON CONFLICT (publication_id) DO NOTHING;
    _queued := _queued + 1;
  END LOOP;

  -- 2. Avanca cada job. Ate 3 passadas por tick: resposta lida e proximo passo
  --    disparado na MESMA rodada (rota rapida).
  FOR _job IN
    SELECT * FROM social_private.autopublish_jobs
    WHERE stage NOT IN (''done'', ''failed'')
    ORDER BY created_at
    LIMIT 10
  LOOP
    BEGIN
      SELECT
        publication.id,
        publication.external_account_id,
        publication.version,
        COALESCE(publication.caption, '''') AS caption,
        COALESCE(publication.file_id, post.primary_file_id) AS file_id,
        post.content_type
      INTO _pub
      FROM public.editorial_publications AS publication
      JOIN public.editorial_posts AS post ON post.id = publication.post_id
      WHERE publication.id = _job.publication_id;

      SELECT * INTO _token
      FROM social_private.autopublish_account_token(_pub.external_account_id);

      IF _token.access_token IS NULL THEN
        PERFORM social_private.autopublish_mark_failed(
          _job.publication_id,
          ''Conta Instagram sem conexao ativa ou token indisponivel. Reconecte a conta na agenda.'',
          _admin
        );
        _failed := _failed + 1;
        CONTINUE;
      END IF;

      _kind := CASE
        WHEN _pub.content_type = ''carousel'' THEN ''carousel''
        WHEN _pub.content_type = ''story'' THEN ''story''
        WHEN _pub.content_type IN (''reel'', ''video'', ''short'') THEN ''video''
        ELSE ''image''
      END;

      FOR _pass IN 1..3 LOOP
        -- Estado fresco a cada passada.
        SELECT * INTO _job FROM social_private.autopublish_jobs
        WHERE publication_id = _job.publication_id;
        EXIT WHEN _job.stage IN (''done'', ''failed'');

        -- ───── A. Cartoes do carrossel em paralelo: colhe as respostas ─────
        IF _job.stage = ''children'' AND COALESCE(array_length(_job.child_request_ids, 1), 0) > 0 THEN
          _containers := _job.child_container_ids;
          _all_ready := true;
          _wait := false;
          FOR _idx IN 1..array_length(_job.child_request_ids, 1) LOOP
            IF _containers[_idx] IS NOT NULL THEN CONTINUE; END IF;
            IF _job.child_request_ids[_idx] IS NULL THEN _all_ready := false; CONTINUE; END IF;
            SELECT status_code, content, timed_out, error_msg INTO _response
            FROM net._http_response WHERE id = _job.child_request_ids[_idx];
            IF NOT FOUND THEN
              _all_ready := false;
              IF _job.updated_at >= now() - _lost_after THEN _wait := true; END IF;
              CONTINUE;
            END IF;
            IF _response.timed_out OR _response.status_code IS NULL OR _response.status_code >= 300 THEN
              -- Este cartao falhou: redispara so ele.
              _all_ready := false;
              IF _job.step_attempts >= _step_limit THEN
                PERFORM social_private.autopublish_mark_failed(
                  _job.publication_id,
                  ''Cartao '' || _idx || '' do carrossel falhou: '' ||
                    left(COALESCE(_response.content::text, _response.error_msg, ''sem resposta''), 300),
                  _admin
                );
                _failed := _failed + 1;
                EXIT;
              END IF;
              _payload := _graph || ''/'' || _token.resource_id || ''/media''
                || ''?image_url='' || social_private.autopublish_urlencode(_job.child_urls[_idx])
                || ''&is_carousel_item=true''
                || ''&access_token='' || _token.access_token;
              SELECT net.http_post(url := _payload, headers := ''{}''::jsonb, timeout_milliseconds := 20000)
              INTO _request_id;
              _req_ids := _job.child_request_ids;
              _req_ids[_idx] := _request_id;
              UPDATE social_private.autopublish_jobs
              SET child_request_ids = _req_ids,
                  attempts = attempts + 1,
                  step_attempts = step_attempts + 1,
                  last_error = left(''Cartao '' || _idx || '' refeito: '' ||
                    COALESCE(_response.content::text, _response.error_msg, ''sem resposta''), 500),
                  updated_at = now()
              WHERE publication_id = _job.publication_id;
            ELSE
              _containers[_idx] := (_response.content::jsonb)->>''id'';
              UPDATE social_private.autopublish_jobs
              SET child_container_ids = _containers, updated_at = now()
              WHERE publication_id = _job.publication_id;
            END IF;
          END LOOP;

          SELECT * INTO _job FROM social_private.autopublish_jobs
          WHERE publication_id = _job.publication_id;
          EXIT WHEN _job.stage IN (''done'', ''failed'');

          IF _all_ready AND NOT EXISTS (
            SELECT 1 FROM unnest(_job.child_container_ids) AS c(id) WHERE c.id IS NULL
          ) AND COALESCE(array_length(_job.child_container_ids, 1), 0) > 0 THEN
            -- Todos os cartoes prontos: monta o pai JA NESTA rodada.
            _payload := _graph || ''/'' || _token.resource_id || ''/media''
              || ''?media_type=CAROUSEL''
              || ''&children='' || array_to_string(_job.child_container_ids, '','')
              || ''&caption='' || social_private.autopublish_urlencode(_pub.caption)
              || ''&access_token='' || _token.access_token;
            SELECT net.http_post(url := _payload, headers := ''{}''::jsonb, timeout_milliseconds := 20000)
            INTO _request_id;
            UPDATE social_private.autopublish_jobs
            SET stage = ''parent'', net_request_id = _request_id,
                child_request_ids = ARRAY[]::bigint[],
                attempts = attempts + 1, step_attempts = 1, updated_at = now()
            WHERE publication_id = _job.publication_id;
            _advanced := _advanced + 1;
          END IF;
          EXIT; -- espera respostas (dos cartoes refeitos ou do pai)
        END IF;

        -- ───── B. Ha requisicao unica em voo: le a resposta ─────
        IF _job.net_request_id IS NOT NULL THEN
          SELECT status_code, content, timed_out, error_msg INTO _response
          FROM net._http_response WHERE id = _job.net_request_id;

          IF NOT FOUND THEN
            IF _job.updated_at < now() - _lost_after THEN
              UPDATE social_private.autopublish_jobs
              SET net_request_id = NULL,
                  stage = CASE WHEN stage = ''publish'' AND publish_dispatched THEN ''verify'' ELSE stage END,
                  step_attempts = CASE WHEN stage = ''publish'' AND publish_dispatched THEN 0 ELSE step_attempts END,
                  last_error = ''Resposta da Meta perdida; retomando o passo.'',
                  updated_at = now()
              WHERE publication_id = _job.publication_id;
            END IF;
            EXIT; -- resposta ainda nao chegou
          END IF;

          IF _response.timed_out
            OR _response.status_code IS NULL
            OR _response.status_code >= 300 THEN
            UPDATE social_private.autopublish_jobs
            SET net_request_id = NULL,
                stage = CASE WHEN stage = ''publish'' AND publish_dispatched THEN ''verify'' ELSE stage END,
                step_attempts = CASE WHEN stage = ''publish'' AND publish_dispatched THEN 0 ELSE step_attempts END,
                last_error = left(COALESCE(
                  _response.content::text,
                  _response.error_msg,
                  ''sem resposta''
                ), 500),
                updated_at = now()
            WHERE publication_id = _job.publication_id;
            CONTINUE; -- proxima passada tenta o dispatch de novo
          END IF;

          _body := _response.content::jsonb;

          IF _job.stage = ''sign'' THEN
            IF jsonb_typeof(_body) <> ''array'' THEN
              UPDATE social_private.autopublish_jobs
              SET net_request_id = NULL,
                  last_error = left(''Assinatura de midia inesperada: '' || COALESCE(_body::text, ''''), 500),
                  updated_at = now()
              WHERE publication_id = _job.publication_id;
              CONTINUE;
            END IF;
            _urls := ARRAY[]::text[];
            FOR _entry IN SELECT * FROM jsonb_array_elements(_body)
            LOOP
              _signed_url := COALESCE(_entry->>''signedURL'', _entry->>''signedUrl'');
              IF _signed_url IS NULL OR COALESCE(_entry->>''error'', '''') <> '''' THEN CONTINUE; END IF;
              _urls := _urls || (_settings.storage_base_url || ''/storage/v1'' || _signed_url);
            END LOOP;
            IF array_length(_urls, 1) IS NULL THEN
              PERFORM social_private.autopublish_mark_failed(
                _job.publication_id,
                ''Nao foi possivel assinar os arquivos da publicacao.'',
                _admin
              );
              _failed := _failed + 1;
              EXIT;
            END IF;
            UPDATE social_private.autopublish_jobs
            SET child_urls = _urls, child_index = 0,
                child_container_ids = ARRAY[]::text[],
                child_request_ids = ARRAY[]::bigint[],
                stage = ''queued'', step_attempts = 0,
                net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
            _advanced := _advanced + 1;
            CONTINUE; -- proxima passada dispara os containers JA

          ELSIF _job.stage = ''queued'' THEN
            IF _kind = ''video'' THEN
              UPDATE social_private.autopublish_jobs
              SET container_id = _body->>''id'', stage = ''processing'', poll_count = 0,
                  step_attempts = 0, net_request_id = NULL, updated_at = now()
              WHERE publication_id = _job.publication_id;
            ELSE
              UPDATE social_private.autopublish_jobs
              SET container_id = _body->>''id'', stage = ''publish'',
                  step_attempts = 0, net_request_id = NULL, updated_at = now()
              WHERE publication_id = _job.publication_id;
            END IF;
            _advanced := _advanced + 1;
            CONTINUE;

          ELSIF _job.stage = ''parent'' THEN
            UPDATE social_private.autopublish_jobs
            SET container_id = _body->>''id'', stage = ''publish'',
                step_attempts = 0, net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
            _advanced := _advanced + 1;
            CONTINUE;

          ELSIF _job.stage = ''processing'' THEN
            _status_code := COALESCE(_body->>''status_code'', '''');
            IF _status_code = ''FINISHED'' THEN
              UPDATE social_private.autopublish_jobs
              SET stage = ''publish'', step_attempts = 0, net_request_id = NULL, updated_at = now()
              WHERE publication_id = _job.publication_id;
              _advanced := _advanced + 1;
              CONTINUE;
            ELSIF _status_code = ''ERROR'' THEN
              PERFORM social_private.autopublish_mark_failed(
                _job.publication_id,
                ''Instagram nao conseguiu processar o video: '' || COALESCE(_body::text, ''''),
                _admin
              );
              _failed := _failed + 1;
              EXIT;
            ELSE
              UPDATE social_private.autopublish_jobs
              SET net_request_id = NULL, poll_count = poll_count + 1, updated_at = now()
              WHERE publication_id = _job.publication_id;
              IF _job.poll_count >= 40 THEN
                PERFORM social_private.autopublish_mark_failed(
                  _job.publication_id,
                  ''Video passou de 40 minutos em processamento no Instagram.'',
                  _admin
                );
                _failed := _failed + 1;
              END IF;
              EXIT; -- video processando: espera o proximo minuto
            END IF;

          ELSIF _job.stage = ''publish'' THEN
            UPDATE social_private.autopublish_jobs
            SET media_id = _body->>''id'', stage = ''permalink'',
                step_attempts = 0, net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
            _advanced := _advanced + 1;
            CONTINUE;

          ELSIF _job.stage = ''verify'' THEN
            _status_code := COALESCE(_body->>''status_code'', '''');
            IF _status_code = ''PUBLISHED'' THEN
              UPDATE social_private.autopublish_jobs
              SET stage = ''recover'', step_attempts = 0, net_request_id = NULL, updated_at = now()
              WHERE publication_id = _job.publication_id;
              _advanced := _advanced + 1;
              CONTINUE;
            ELSIF _status_code = ''FINISHED'' THEN
              UPDATE social_private.autopublish_jobs
              SET stage = ''publish'', net_request_id = NULL, updated_at = now()
              WHERE publication_id = _job.publication_id;
              _advanced := _advanced + 1;
              CONTINUE;
            ELSIF _status_code IN (''ERROR'', ''EXPIRED'') THEN
              PERFORM social_private.autopublish_mark_failed(
                _job.publication_id,
                ''Container invalido na verificacao ('' || _status_code || ''). Use Tentar de novo.'',
                _admin
              );
              _failed := _failed + 1;
              EXIT;
            ELSE
              UPDATE social_private.autopublish_jobs
              SET net_request_id = NULL, poll_count = poll_count + 1, updated_at = now()
              WHERE publication_id = _job.publication_id;
              EXIT;
            END IF;

          ELSIF _job.stage = ''recover'' THEN
            IF jsonb_array_length(COALESCE(_body->''data'', ''[]''::jsonb)) > 0 THEN
              UPDATE social_private.autopublish_jobs
              SET media_id = _body->''data''->0->>''id'',
                  permalink = _body->''data''->0->>''permalink'',
                  stage = ''permalink'', step_attempts = 0,
                  net_request_id = NULL, updated_at = now()
              WHERE publication_id = _job.publication_id;
              _advanced := _advanced + 1;
              CONTINUE;
            ELSE
              UPDATE social_private.autopublish_jobs
              SET stage = ''done'', net_request_id = NULL,
                  last_error = ''Post publicado, mas nao foi possivel recuperar o link. Confirme no perfil.'',
                  updated_at = now()
              WHERE publication_id = _job.publication_id;
              EXIT;
            END IF;

          ELSIF _job.stage = ''permalink'' THEN
            _permalink := NULLIF(btrim(COALESCE(_body->>''permalink'', '''')), '''');
            IF _permalink IS NULL AND _kind = ''story'' THEN
              _permalink := ''https://www.instagram.com/stories/'';
            END IF;

            UPDATE social_private.autopublish_jobs
            SET permalink = _permalink, stage = ''done'', net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;

            IF _admin IS NULL THEN
              UPDATE social_private.autopublish_jobs
              SET last_error = ''Post no ar, mas nenhum admin cadastrado para registrar a baixa no painel.'',
                  updated_at = now()
              WHERE publication_id = _job.publication_id;
            ELSIF _permalink IS NULL THEN
              UPDATE social_private.autopublish_jobs
              SET last_error = ''Post no ar, mas o Instagram nao devolveu o link. Marque como publicado no painel.'',
                  updated_at = now()
              WHERE publication_id = _job.publication_id;
            ELSE
              BEGIN
                PERFORM set_config(
                  ''request.jwt.claims'',
                  json_build_object(''sub'', _admin::text, ''role'', ''authenticated'')::text,
                  true
                );
                PERFORM public.transition_editorial_publication(
                  p_publication_id => _job.publication_id,
                  p_action => ''publish'',
                  p_expected_version => _pub.version,
                  p_permalink => _permalink,
                  p_external_post_id => COALESCE(_job.media_id, _body->>''id''),
                  p_published_at => now()
                );
              EXCEPTION WHEN OTHERS THEN
                UPDATE social_private.autopublish_jobs
                SET last_error = left(''Post no ar; baixa oficial falhou: '' || SQLERRM, 500),
                    updated_at = now()
                WHERE publication_id = _job.publication_id;
              END;
            END IF;
            _published := _published + 1;
            EXIT;
          END IF;
          -- fim do bloco de resposta
        END IF;

        -- ───── C. Nada em voo: despacha o proximo passo ─────
        SELECT * INTO _job FROM social_private.autopublish_jobs
        WHERE publication_id = _job.publication_id;
        EXIT WHEN _job.stage IN (''done'', ''failed'');
        EXIT WHEN _job.net_request_id IS NOT NULL
          OR (_job.stage = ''children'' AND COALESCE(array_length(_job.child_request_ids, 1), 0) > 0);

        IF _job.step_attempts >= _step_limit THEN
          PERFORM social_private.autopublish_mark_failed(
            _job.publication_id,
            ''Passo "'' || _job.stage || ''" falhou apos '' || _job.step_attempts ||
              '' tentativas. Ultimo erro: '' || COALESCE(_job.last_error, ''sem detalhe''),
            _admin
          );
          _failed := _failed + 1;
          EXIT;
        END IF;

        IF _job.stage = ''sign'' THEN
          UPDATE social_private.autopublish_jobs
          SET stage = ''queued'', child_urls = ARRAY[]::text[], net_request_id = NULL, updated_at = now()
          WHERE publication_id = _job.publication_id;
          CONTINUE;
        END IF;

        IF _job.stage = ''queued'' THEN
          IF COALESCE(array_length(_job.child_urls, 1), 0) = 0 THEN
            _paths := social_private.autopublish_storage_paths(_pub.id, _pub.file_id);
            IF COALESCE(array_length(_paths, 1), 0) > 0 THEN
              _service_key := social_private.autopublish_service_key();
              IF _service_key IS NULL THEN
                PERFORM social_private.autopublish_mark_failed(
                  _job.publication_id,
                  ''Service key ausente no Vault; nao da para assinar a midia.'',
                  _admin
                );
                _failed := _failed + 1;
                EXIT;
              END IF;
              SELECT net.http_post(
                url := _settings.storage_base_url || ''/storage/v1/object/sign/files'',
                body := jsonb_build_object(''paths'', to_jsonb(_paths), ''expiresIn'', 21600),
                headers := jsonb_build_object(
                  ''Content-Type'', ''application/json'',
                  ''Authorization'', ''Bearer '' || _service_key,
                  ''apikey'', _service_key
                ),
                timeout_milliseconds := 15000
              ) INTO _request_id;
              UPDATE social_private.autopublish_jobs
              SET stage = ''sign'', net_request_id = _request_id,
                  attempts = attempts + 1, step_attempts = step_attempts + 1,
                  updated_at = now()
              WHERE publication_id = _job.publication_id;
              _advanced := _advanced + 1;
              EXIT;
            END IF;
            _urls := ARRAY[social_private.autopublish_file_url(_pub.file_id)];
            IF _urls[1] IS NULL THEN
              PERFORM social_private.autopublish_mark_failed(
                _job.publication_id,
                ''Arquivo sem caminho de storage e sem URL externa: nada para publicar.'',
                _admin
              );
              _failed := _failed + 1;
              EXIT;
            END IF;
            UPDATE social_private.autopublish_jobs
            SET child_urls = _urls, updated_at = now()
            WHERE publication_id = _job.publication_id;
            _job.child_urls := _urls;
          END IF;

          _urls := _job.child_urls;
          IF _kind = ''carousel'' THEN
            IF array_length(_urls, 1) < 2 THEN
              PERFORM social_private.autopublish_mark_failed(
                _job.publication_id,
                ''Carrossel precisa de pelo menos 2 imagens acessiveis.'',
                _admin
              );
              _failed := _failed + 1;
              EXIT;
            END IF;
            IF array_length(_urls, 1) > 10 THEN
              _urls := _urls[1:10];
              UPDATE social_private.autopublish_jobs
              SET child_urls = _urls, updated_at = now()
              WHERE publication_id = _job.publication_id;
            END IF;
            -- TODOS os cartoes de uma vez: e aqui que a v5 corta o tempo.
            _req_ids := ARRAY[]::bigint[];
            FOR _idx IN 1..array_length(_urls, 1) LOOP
              _payload := _graph || ''/'' || _token.resource_id || ''/media''
                || ''?image_url='' || social_private.autopublish_urlencode(_urls[_idx])
                || ''&is_carousel_item=true''
                || ''&access_token='' || _token.access_token;
              SELECT net.http_post(url := _payload, headers := ''{}''::jsonb, timeout_milliseconds := 20000)
              INTO _request_id;
              _req_ids := _req_ids || _request_id;
            END LOOP;
            UPDATE social_private.autopublish_jobs
            SET stage = ''children'',
                child_request_ids = _req_ids,
                child_container_ids = array_fill(NULL::text, ARRAY[array_length(_urls, 1)]),
                attempts = attempts + array_length(_urls, 1),
                step_attempts = 1,
                net_request_id = NULL,
                updated_at = now()
            WHERE publication_id = _job.publication_id;
            _advanced := _advanced + 1;
            EXIT;
          ELSIF _kind = ''video'' THEN
            _payload := _graph || ''/'' || _token.resource_id || ''/media''
              || ''?media_type=REELS''
              || ''&video_url='' || social_private.autopublish_urlencode(_urls[1])
              || ''&caption='' || social_private.autopublish_urlencode(_pub.caption)
              || ''&access_token='' || _token.access_token;
          ELSIF _kind = ''story'' THEN
            _payload := _graph || ''/'' || _token.resource_id || ''/media''
              || ''?media_type=STORIES''
              || ''&image_url='' || social_private.autopublish_urlencode(_urls[1])
              || ''&access_token='' || _token.access_token;
          ELSE
            _payload := _graph || ''/'' || _token.resource_id || ''/media''
              || ''?image_url='' || social_private.autopublish_urlencode(_urls[1])
              || ''&caption='' || social_private.autopublish_urlencode(_pub.caption)
              || ''&access_token='' || _token.access_token;
          END IF;
          SELECT net.http_post(url := _payload, headers := ''{}''::jsonb, timeout_milliseconds := 20000)
          INTO _request_id;
          UPDATE social_private.autopublish_jobs
          SET net_request_id = _request_id, attempts = attempts + 1,
              step_attempts = step_attempts + 1, updated_at = now()
          WHERE publication_id = _job.publication_id;
          _advanced := _advanced + 1;
          EXIT;
        END IF;

        IF _job.stage = ''processing'' THEN
          _payload := _graph || ''/'' || _job.container_id
            || ''?fields=status_code&access_token='' || _token.access_token;
          SELECT net.http_get(url := _payload, timeout_milliseconds := 10000) INTO _request_id;
          UPDATE social_private.autopublish_jobs
          SET net_request_id = _request_id, updated_at = now()
          WHERE publication_id = _job.publication_id;
          EXIT;
        END IF;

        IF _job.stage = ''publish'' AND _job.container_id IS NOT NULL THEN
          _payload := _graph || ''/'' || _token.resource_id || ''/media_publish''
            || ''?creation_id='' || _job.container_id
            || ''&access_token='' || _token.access_token;
          SELECT net.http_post(url := _payload, headers := ''{}''::jsonb, timeout_milliseconds := 20000)
          INTO _request_id;
          UPDATE social_private.autopublish_jobs
          SET net_request_id = _request_id, attempts = attempts + 1,
              step_attempts = step_attempts + 1,
              publish_dispatched = true, updated_at = now()
          WHERE publication_id = _job.publication_id;
          _advanced := _advanced + 1;
          EXIT;
        END IF;

        IF _job.stage = ''verify'' AND _job.container_id IS NOT NULL THEN
          _payload := _graph || ''/'' || _job.container_id
            || ''?fields=status_code&access_token='' || _token.access_token;
          SELECT net.http_get(url := _payload, timeout_milliseconds := 10000) INTO _request_id;
          UPDATE social_private.autopublish_jobs
          SET net_request_id = _request_id, step_attempts = step_attempts + 1, updated_at = now()
          WHERE publication_id = _job.publication_id;
          EXIT;
        END IF;

        IF _job.stage = ''recover'' THEN
          _payload := _graph || ''/'' || _token.resource_id || ''/media''
            || ''?fields=id,permalink&limit=1''
            || ''&access_token='' || _token.access_token;
          SELECT net.http_get(url := _payload, timeout_milliseconds := 10000) INTO _request_id;
          UPDATE social_private.autopublish_jobs
          SET net_request_id = _request_id, step_attempts = step_attempts + 1, updated_at = now()
          WHERE publication_id = _job.publication_id;
          EXIT;
        END IF;

        IF _job.stage = ''permalink'' AND _job.media_id IS NOT NULL THEN
          _payload := _graph || ''/'' || _job.media_id
            || ''?fields=permalink&access_token='' || _token.access_token;
          SELECT net.http_get(url := _payload, timeout_milliseconds := 10000) INTO _request_id;
          UPDATE social_private.autopublish_jobs
          SET net_request_id = _request_id, step_attempts = step_attempts + 1, updated_at = now()
          WHERE publication_id = _job.publication_id;
          _advanced := _advanced + 1;
          EXIT;
        END IF;

        EXIT; -- nenhum dispatch aplicavel nesta passada
      END LOOP;

    EXCEPTION WHEN OTHERS THEN
      UPDATE social_private.autopublish_jobs
      SET last_error = left(SQLERRM, 500),
          step_attempts = step_attempts + 1,
          net_request_id = NULL,
          updated_at = now()
      WHERE publication_id = _job.publication_id;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    ''enabled'', true, ''queued'', _queued, ''advanced'', _advanced,
    ''published'', _published, ''failed'', _failed
  );
END
$function$',
    'REVOKE ALL ON FUNCTION public.editorial_autopublish_tick() FROM PUBLIC, anon, authenticated',
    'GRANT EXECUTE ON FUNCTION public.editorial_autopublish_tick() TO service_role',
    '-- Retry tambem limpa o rastro dos cartoes paralelos.
CREATE OR REPLACE FUNCTION public.retry_autopublish(p_publication_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''''
AS $$
DECLARE
  _job social_private.autopublish_jobs%ROWTYPE;
  _actor uuid := auth.uid();
  _next_stage text;
BEGIN
  SELECT * INTO _job
  FROM social_private.autopublish_jobs
  WHERE publication_id = p_publication_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION ''nenhuma tentativa de publicacao automatica para reprocessar'';
  END IF;

  IF _actor IS NULL
    OR NOT public.is_staff(_actor)
    OR NOT public.can_access_client(_job.client_id) THEN
    RAISE EXCEPTION ''retry access denied'';
  END IF;

  IF _job.stage <> ''failed'' THEN
    RAISE EXCEPTION ''a publicacao nao esta em falha (estagio atual: %)'', _job.stage;
  END IF;

  _next_stage := CASE
    WHEN _job.publish_dispatched AND _job.container_id IS NOT NULL THEN ''verify''
    ELSE ''queued''
  END;

  UPDATE social_private.autopublish_jobs
  SET stage = _next_stage,
      step_attempts = 0,
      poll_count = 0,
      net_request_id = NULL,
      last_error = NULL,
      child_index = CASE WHEN _next_stage = ''queued'' THEN 0 ELSE child_index END,
      child_urls = CASE WHEN _next_stage = ''queued'' THEN ARRAY[]::text[] ELSE child_urls END,
      child_container_ids = CASE WHEN _next_stage = ''queued'' THEN ARRAY[]::text[] ELSE child_container_ids END,
      child_request_ids = ARRAY[]::bigint[],
      container_id = CASE WHEN _next_stage = ''queued'' THEN NULL ELSE container_id END,
      updated_at = now()
  WHERE publication_id = p_publication_id;

  RETURN jsonb_build_object(''publication_id'', p_publication_id, ''stage'', _next_stage);
END;
$$',
    'REVOKE ALL ON FUNCTION public.retry_autopublish(uuid) FROM PUBLIC, anon',
    'GRANT EXECUTE ON FUNCTION public.retry_autopublish(uuid) TO authenticated'
  ]::text[]),
  ('20260814010000', 'autopublish_fix_caption_encoding', ARRAY[
    '-- ============================================================================
-- Aceleriq OS - legenda publicada com acentos e emojis corretos
-- ============================================================================
--
-- O sintoma real: o post saiu no Instagram com a legenda "cheia de caracteres"
-- estranhos. Causa: o codificador de URL do motor juntava os bytes de um
-- caractere multi-byte num único "%": "é" virava "%C3A9" em vez de "%C3%A9".
-- O Instagram decodificava o primeiro byte e deixava o resto solto na legenda,
-- quebrando acento, cedilha e emoji.
--
-- Correção: cada BYTE ganha o próprio "%XX", como manda o padrão. "é" vira
-- "%C3%A9", emoji vira os 4 bytes certos, e a legenda chega intacta.
-- ============================================================================

CREATE OR REPLACE FUNCTION social_private.autopublish_urlencode(_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''''
AS $function$
  SELECT COALESCE(
    string_agg(
      CASE
        WHEN piece ~ ''^[A-Za-z0-9_.~-]$'' THEN piece
        -- Um "%XX" por BYTE: acento e emoji têm vários bytes e cada um
        -- precisa do próprio par, senão a legenda chega quebrada.
        ELSE regexp_replace(
          upper(encode(convert_to(piece, ''UTF8''), ''hex'')),
          ''(..)'', ''%\1'', ''g''
        )
      END,
      ''''
    ),
    ''''
  )
  FROM regexp_split_to_table(COALESCE(_value, ''''), '''') AS piece;
$function$',
    '-- Prova rápida no próprio banco: deve devolver TRUE, TRUE.
DO $$
BEGIN
  IF social_private.autopublish_urlencode(''é'') <> ''%C3%A9'' THEN
    RAISE EXCEPTION ''urlencode ainda quebra acentos: %'',
      social_private.autopublish_urlencode(''é'');
  END IF;
  IF social_private.autopublish_urlencode(''a b#'') <> ''a%20b%23'' THEN
    RAISE EXCEPTION ''urlencode quebrou o caso simples: %'',
      social_private.autopublish_urlencode(''a b#'');
  END IF;
  RAISE NOTICE ''Codificacao de legenda corrigida: acentos e emojis chegam intactos.'';
END;
$$'
  ]::text[]),
  ('20260814020000', 'editorial_allow_attach_under_review', ARRAY[
    '-- Corrige o erro visto no celular ao agendar uma publicacao:
--   "the editorial primary file is already under review; create a revision"
--
-- A guarda barrava ANEXAR/agendar um post cujo material ainda esta em revisao.
-- Anexar nao altera o arquivo em nada: as travas que importam continuam em pe
-- (arquivo precisa ser legivel, do mesmo cliente e projeto; e aprovar ou
-- publicar o post continua exigindo o material com o duplo gate aprovado, na
-- transicao). Portanto a guarda de anexo vira no-op: agendar nunca mais trava
-- por causa de revisao em andamento.
--
-- A outra guarda ("the approved editorial version is immutable") permanece:
-- trocar a arte de um post ja aprovado continua exigindo revisao.
--
-- Forward-only, aditiva e idempotente: reescreve a funcao a partir da
-- definicao vigente no banco (funciona com ou sem o patch 20260812120000).

DO $patch$
DECLARE
  original_definition text;
  patched_definition text;
  old_raise text;
  new_body text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO original_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = ''public'' AND p.proname = ''save_editorial_post_unlocked'';

  IF original_definition IS NULL THEN
    RAISE EXCEPTION ''save_editorial_post_unlocked nao encontrada; nada a aplicar'';
  END IF;

  new_body := $b$NULL; -- anexar material em revisao e permitido; a aprovacao segue exigida na hora de aprovar/publicar$b$;

  IF position(new_body IN original_definition) > 0 THEN
    RAISE NOTICE ''anexo de material em revisao ja liberado; nada a fazer'';
    RETURN;
  END IF;

  old_raise := $a$RAISE EXCEPTION ''the editorial primary file is already under review; create a revision'';$a$;

  IF position(old_raise IN original_definition) = 0 THEN
    RAISE EXCEPTION ''guarda do arquivo principal nao encontrada; nada foi alterado'';
  END IF;

  patched_definition := replace(original_definition, old_raise, new_body);

  IF patched_definition = original_definition THEN
    RAISE EXCEPTION ''nenhuma alteracao produzida; nada foi aplicado'';
  END IF;

  EXECUTE patched_definition;
  RAISE NOTICE ''agendamento com material em revisao liberado com sucesso'';
END
$patch$',
    '-- A funcao interna nunca e chamada direto pelo cliente: quem expoe e o wrapper
-- public.save_editorial_post, cujas permissoes permanecem intactas.
REVOKE ALL ON FUNCTION public.save_editorial_post_unlocked(jsonb, integer)
  FROM PUBLIC, anon, authenticated',
    'GRANT EXECUTE ON FUNCTION public.save_editorial_post_unlocked(jsonb, integer)
  TO service_role'
  ]::text[]),
  ('20260814030000', 'editorial_attach_pending_art', ARRAY[
    '-- Corrige o bloqueio do seletor de midia ao montar conteudo novo:
--   "Esta arte ja foi enviada para aprovacao e esta travada"
--
-- A guarda de copia barrava QUALQUER arquivo travado, inclusive a arte que
-- apenas entrou em revisao e ainda nem foi aprovada. Regra nova:
--   - Arte em revisao (travada, ainda NAO aprovada): pode ser anexada. A
--     aprovacao dela continua acontecendo no fluxo normal (revisao interna +
--     cliente quando marcado) e aprovar/publicar o post continua exigindo o
--     duplo gate.
--   - Arte APROVADA: mantem a regra de hoje (reuso liberado em post novo pela
--     20260812120000; trocar a arte de post ja aprovado continua exigindo
--     revisao).
--
-- Forward-only, aditiva e idempotente: reescreve a funcao a partir da
-- definicao vigente no banco.

DO $patch$
DECLARE
  original_definition text;
  patched_definition text;
  old_guard text;
  new_guard text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO original_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = ''public'' AND p.proname = ''save_editorial_post_unlocked'';

  IF original_definition IS NULL THEN
    RAISE EXCEPTION ''save_editorial_post_unlocked nao encontrada; nada a aplicar'';
  END IF;

  new_guard := $b$      WHERE NOT COALESCE(
        public.file_is_editable(requested.file_id),
        false
      )
      AND COALESCE(public.editorial_file_is_publishable(requested.file_id, _client_id, _project_id), false)
      AND NOT ($b$;

  IF position(new_guard IN original_definition) > 0 THEN
    RAISE NOTICE ''anexo de arte em revisao pendente ja liberado; nada a fazer'';
    RETURN;
  END IF;

  old_guard := $a$      WHERE NOT COALESCE(
        public.file_is_editable(requested.file_id),
        false
      )
      AND NOT ($a$;

  IF position(old_guard IN original_definition) = 0 THEN
    RAISE EXCEPTION ''guarda de copia (variante 20260812) nao encontrada; rode antes a migration 20260812120000'';
  END IF;

  patched_definition := replace(original_definition, old_guard, new_guard);

  IF patched_definition = original_definition THEN
    RAISE EXCEPTION ''nenhuma alteracao produzida; nada foi aplicado'';
  END IF;

  EXECUTE patched_definition;
  RAISE NOTICE ''arte em revisao pendente liberada para montar conteudo'';
END
$patch$',
    'REVOKE ALL ON FUNCTION public.save_editorial_post_unlocked(jsonb, integer)
  FROM PUBLIC, anon, authenticated',
    'GRANT EXECUTE ON FUNCTION public.save_editorial_post_unlocked(jsonb, integer)
  TO service_role'
  ]::text[]),
  ('20260814040000', 'social_metrics_weekly', ARRAY[
    '-- Metricas REAIS do Instagram, coletadas toda semana sem mao humana.
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
  platform text NOT NULL DEFAULT ''instagram'',
  week_start date NOT NULL,
  week_end date NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  followers integer,
  media_count integer,
  reach integer,
  profile_views integer,
  accounts_engaged integer,
  total_interactions integer,
  raw jsonb NOT NULL DEFAULT ''{}''::jsonb,
  UNIQUE (external_account_id, week_start)
)',
    'CREATE INDEX IF NOT EXISTS social_metrics_weekly_client_idx
  ON public.social_metrics_weekly (client_id, week_start DESC)',
    'ALTER TABLE public.social_metrics_weekly ENABLE ROW LEVEL SECURITY',
    'DROP POLICY IF EXISTS social_metrics_weekly_staff_read ON public.social_metrics_weekly',
    'CREATE POLICY social_metrics_weekly_staff_read ON public.social_metrics_weekly
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) AND public.can_access_client(client_id))',
    'DROP POLICY IF EXISTS social_metrics_weekly_client_read ON public.social_metrics_weekly',
    'CREATE POLICY social_metrics_weekly_client_read ON public.social_metrics_weekly
  FOR SELECT TO authenticated
  USING (client_id = auth.uid())',
    'REVOKE INSERT, UPDATE, DELETE ON public.social_metrics_weekly FROM anon, authenticated',
    'GRANT SELECT ON public.social_metrics_weekly TO authenticated',
    '-- ─────────────────── 2) Fila de requisicoes (pg_net e assincrono) ───────────
CREATE TABLE IF NOT EXISTS social_private.social_metrics_requests (
  id bigserial PRIMARY KEY,
  external_account_id uuid NOT NULL,
  client_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN (''profile'', ''reach'', ''engage'')),
  request_id bigint,
  week_start date NOT NULL,
  week_end date NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
)',
    '-- ─────────────────────────── 3) Montador de URL ─────────────────────────
CREATE OR REPLACE FUNCTION social_private.social_metrics_url(
  _kind text, _ig text, _token text, _week_start date, _week_end date
)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''''
AS $function$
  SELECT CASE _kind
    WHEN ''profile'' THEN
      ''https://graph.facebook.com/v21.0/'' || _ig
      || ''?fields=followers_count,media_count&access_token='' || _token
    WHEN ''reach'' THEN
      ''https://graph.facebook.com/v21.0/'' || _ig
      || ''/insights?metric=reach&period=day&since='' || _week_start::text
      || ''&until='' || (_week_end + 1)::text || ''&access_token='' || _token
    ELSE
      ''https://graph.facebook.com/v21.0/'' || _ig
      || ''/insights?metric=profile_views,accounts_engaged,total_interactions''
      || ''&metric_type=total_value&period=day&since='' || _week_start::text
      || ''&until='' || (_week_end + 1)::text || ''&access_token='' || _token
  END;
$function$',
    '-- ─────────────────────────────── 4) Tick ────────────────────────────────
CREATE OR REPLACE FUNCTION public.social_metrics_tick()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''''
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
    ''week'', (now() AT TIME ZONE ''America/Sao_Paulo'')::date::timestamp
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
      IF _req.created_at < now() - interval ''30 minutes'' THEN
        UPDATE social_private.social_metrics_requests
        SET request_id = NULL, attempts = attempts + 1 WHERE id = _req.id;
      END IF;
      CONTINUE;
    END IF;

    BEGIN
      _body := _content::jsonb;
    EXCEPTION WHEN others THEN
      _body := jsonb_build_object(''parse_error'', left(COALESCE(_content, ''''), 500));
    END;

    IF _status BETWEEN 200 AND 299 AND NOT (_body ? ''error'') THEN
      IF _req.kind = ''profile'' THEN
        INSERT INTO public.social_metrics_weekly AS w
          (client_id, external_account_id, week_start, week_end, followers, media_count, raw)
        VALUES
          (_req.client_id, _req.external_account_id, _req.week_start, _req.week_end,
           NULLIF(_body->>''followers_count'', '''')::integer,
           NULLIF(_body->>''media_count'', '''')::integer,
           jsonb_build_object(''profile'', _body))
        ON CONFLICT (external_account_id, week_start) DO UPDATE
          SET followers = EXCLUDED.followers,
              media_count = EXCLUDED.media_count,
              captured_at = now(),
              raw = w.raw || EXCLUDED.raw;
      ELSIF _req.kind = ''reach'' THEN
        SELECT COALESCE(SUM(NULLIF(v->>''value'', '''')::bigint), 0) INTO _sum
        FROM jsonb_array_elements(COALESCE(_body#>''{data,0,values}'', ''[]''::jsonb)) AS v;
        INSERT INTO public.social_metrics_weekly AS w
          (client_id, external_account_id, week_start, week_end, reach, raw)
        VALUES
          (_req.client_id, _req.external_account_id, _req.week_start, _req.week_end,
           _sum::integer, jsonb_build_object(''reach'', _body))
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
           (SELECT NULLIF(m#>>''{total_value,value}'', '''')::integer
              FROM jsonb_array_elements(COALESCE(_body->''data'', ''[]''::jsonb)) AS m
              WHERE m->>''name'' = ''profile_views'' LIMIT 1),
           (SELECT NULLIF(m#>>''{total_value,value}'', '''')::integer
              FROM jsonb_array_elements(COALESCE(_body->''data'', ''[]''::jsonb)) AS m
              WHERE m->>''name'' = ''accounts_engaged'' LIMIT 1),
           (SELECT NULLIF(m#>>''{total_value,value}'', '''')::integer
              FROM jsonb_array_elements(COALESCE(_body->''data'', ''[]''::jsonb)) AS m
              WHERE m->>''name'' = ''total_interactions'' LIMIT 1),
           jsonb_build_object(''engage'', _body))
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
           jsonb_build_object(''error_'' || _req.kind, _body))
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
    WHERE account.platform = ''instagram''
      AND account.status = ''active''
      AND NOT EXISTS (
        SELECT 1 FROM public.social_metrics_weekly AS w
        WHERE w.external_account_id = account.id
          AND w.week_start = _week_start
          AND w.followers IS NOT NULL
          AND (w.reach IS NOT NULL OR w.raw ? ''error_reach'')
          AND (w.total_interactions IS NOT NULL OR w.raw ? ''error_engage'')
      )
      AND NOT EXISTS (
        SELECT 1 FROM social_private.social_metrics_requests AS r
        WHERE r.external_account_id = account.id AND r.week_start = _week_start
      )
  LOOP
    SELECT t.resource_id, t.access_token INTO _token_resource, _token_secret
    FROM social_private.autopublish_account_token(_acct.id) AS t;
    IF _token_secret IS NULL THEN CONTINUE; END IF;
    FOREACH _kind IN ARRAY ARRAY[''profile'', ''reach'', ''engage''] LOOP
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
    ''week_start'', _week_start,
    ''dispatched'', _dispatched,
    ''parsed'', _parsed
  );
END
$function$',
    'REVOKE ALL ON FUNCTION public.social_metrics_tick() FROM PUBLIC, anon, authenticated',
    '-- ─────────────── 5) Atualizar agora, pela equipe, direto do painel ───────────
CREATE OR REPLACE FUNCTION public.collect_social_metrics_now()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''''
AS $function$
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION ''somente a equipe pode atualizar as metricas'';
  END IF;
  RETURN public.social_metrics_tick();
END
$function$',
    'REVOKE ALL ON FUNCTION public.collect_social_metrics_now() FROM PUBLIC, anon',
    'GRANT EXECUTE ON FUNCTION public.collect_social_metrics_now() TO authenticated',
    '-- ────────────────────────────── 6) Cron ─────────────────────────────────
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = ''pg_cron'') THEN
    BEGIN
      PERFORM cron.unschedule(''social-metrics'');
    EXCEPTION WHEN others THEN
      NULL;
    END;
    PERFORM cron.schedule(
      ''social-metrics'',
      ''*/10 * * * *'',
      ''SELECT public.social_metrics_tick();''
    );
    RAISE NOTICE ''coleta de metricas agendada (a cada 10 min; so trabalha quando falta semana)'';
  ELSE
    RAISE NOTICE ''pg_cron indisponivel: chame public.social_metrics_tick() por outro agendador'';
  END IF;
END
$cron$'
  ]::text[]),
  ('20260814050000', 'client_shared_counts_as_approved', ARRAY[
    '-- Regra da casa aplicada ao motor editorial: material DISPONIBILIZADO ao
-- cliente (visibility = client_shared) dispensa a aprovacao do cliente e ja
-- vale como aprovado para agendar e publicar.
--
-- Antes, editorial_file_is_publishable so aceitava o fluxo de aprovacao
-- completo (visibility = approval + approval_status = approved). Uma arte
-- disponibilizada ficava travada em estado final e o "Aprovar tudo agora"
-- morria com "terminal file versions are immutable".
--
-- Forward-only e idempotente: apenas CREATE OR REPLACE da funcao, mesma
-- assinatura, permissoes preservadas.

CREATE OR REPLACE FUNCTION public.editorial_file_is_publishable(
  _file_id uuid,
  _client_id uuid,
  _project_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.files AS file_row
    WHERE file_row.id = _file_id
      AND file_row.parent_file_id IS NULL
      AND file_row.client_id = _client_id
      AND file_row.project_id = _project_id
      AND file_row.archived_at IS NULL
      AND COALESCE(file_row.status, ''ready'') = ''ready''
      AND file_row.agency_approval_status = ''approved''
      AND file_row.locked_at IS NOT NULL
      AND (
        (file_row.visibility = ''approval'' AND file_row.approval_status = ''approved'')
        OR file_row.visibility = ''client_shared''
      )
  )
$$',
    '-- Mesmo perfil de permissao do original: uso apenas interno (SECURITY DEFINER
-- das funcoes editoriais), ninguem chama direto.
REVOKE ALL ON FUNCTION public.editorial_file_is_publishable(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role'
  ]::text[]),
  ('20260814060000', 'social_post_metrics', ARRAY[
    '-- Metricas POR PUBLICACAO do Instagram: o robo tambem coleta as ultimas
-- publicacoes de cada conta (curtidas, comentarios, tipo, data, link) para o
-- painel mostrar "o que performou". Atualiza a cada 3 dias por conta.

-- ───────────────────────── 1) Historico por post ─────────────────────────
CREATE TABLE IF NOT EXISTS public.social_post_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  external_account_id uuid NOT NULL REFERENCES public.external_accounts(id) ON DELETE CASCADE,
  media_id text NOT NULL,
  media_type text,
  caption text,
  permalink text,
  posted_at timestamptz,
  like_count integer,
  comments_count integer,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (external_account_id, media_id)
)',
    'CREATE INDEX IF NOT EXISTS social_post_metrics_client_idx
  ON public.social_post_metrics (client_id, posted_at DESC)',
    'ALTER TABLE public.social_post_metrics ENABLE ROW LEVEL SECURITY',
    'DROP POLICY IF EXISTS social_post_metrics_staff_read ON public.social_post_metrics',
    'CREATE POLICY social_post_metrics_staff_read ON public.social_post_metrics
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) AND public.can_access_client(client_id))',
    'DROP POLICY IF EXISTS social_post_metrics_client_read ON public.social_post_metrics',
    'CREATE POLICY social_post_metrics_client_read ON public.social_post_metrics
  FOR SELECT TO authenticated
  USING (client_id = auth.uid())',
    'REVOKE INSERT, UPDATE, DELETE ON public.social_post_metrics FROM anon, authenticated',
    'GRANT SELECT ON public.social_post_metrics TO authenticated',
    '-- ──────────────── 2) Novo tipo de requisicao na fila ────────────────────
ALTER TABLE social_private.social_metrics_requests
  DROP CONSTRAINT IF EXISTS social_metrics_requests_kind_check',
    'ALTER TABLE social_private.social_metrics_requests
  ADD CONSTRAINT social_metrics_requests_kind_check
  CHECK (kind IN (''profile'', ''reach'', ''engage'', ''posts''))',
    '-- ─────────────────────── 3) URL do novo tipo ────────────────────────────
CREATE OR REPLACE FUNCTION social_private.social_metrics_url(
  _kind text, _ig text, _token text, _week_start date, _week_end date
)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''''
AS $function$
  SELECT CASE _kind
    WHEN ''profile'' THEN
      ''https://graph.facebook.com/v21.0/'' || _ig
      || ''?fields=followers_count,media_count&access_token='' || _token
    WHEN ''reach'' THEN
      ''https://graph.facebook.com/v21.0/'' || _ig
      || ''/insights?metric=reach&period=day&since='' || _week_start::text
      || ''&until='' || (_week_end + 1)::text || ''&access_token='' || _token
    WHEN ''posts'' THEN
      ''https://graph.facebook.com/v21.0/'' || _ig
      || ''/media?fields=id,caption,timestamp,media_type,permalink,like_count,comments_count''
      || ''&limit=25&access_token='' || _token
    ELSE
      ''https://graph.facebook.com/v21.0/'' || _ig
      || ''/insights?metric=profile_views,accounts_engaged,total_interactions''
      || ''&metric_type=total_value&period=day&since='' || _week_start::text
      || ''&until='' || (_week_end + 1)::text || ''&access_token='' || _token
  END;
$function$',
    '-- ─────────────── 4) Tick v2: semanas + publicacoes ──────────────────────
CREATE OR REPLACE FUNCTION public.social_metrics_tick()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''''
AS $function$
DECLARE
  _week_start date;
  _week_end date;
  _req record;
  _acct record;
  _status integer;
  _content text;
  _body jsonb;
  _item jsonb;
  _token_resource text;
  _token_secret text;
  _url text;
  _rid bigint;
  _kind text;
  _sum bigint;
  _dispatched integer := 0;
  _parsed integer := 0;
BEGIN
  _week_start := date_trunc(
    ''week'', (now() AT TIME ZONE ''America/Sao_Paulo'')::date::timestamp
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
      IF _req.created_at < now() - interval ''30 minutes'' THEN
        UPDATE social_private.social_metrics_requests
        SET request_id = NULL, attempts = attempts + 1 WHERE id = _req.id;
      END IF;
      CONTINUE;
    END IF;

    BEGIN
      _body := _content::jsonb;
    EXCEPTION WHEN others THEN
      _body := jsonb_build_object(''parse_error'', left(COALESCE(_content, ''''), 500));
    END;

    IF _status BETWEEN 200 AND 299 AND NOT (_body ? ''error'') THEN
      IF _req.kind = ''profile'' THEN
        INSERT INTO public.social_metrics_weekly AS w
          (client_id, external_account_id, week_start, week_end, followers, media_count, raw)
        VALUES
          (_req.client_id, _req.external_account_id, _req.week_start, _req.week_end,
           NULLIF(_body->>''followers_count'', '''')::integer,
           NULLIF(_body->>''media_count'', '''')::integer,
           jsonb_build_object(''profile'', _body))
        ON CONFLICT (external_account_id, week_start) DO UPDATE
          SET followers = EXCLUDED.followers,
              media_count = EXCLUDED.media_count,
              captured_at = now(),
              raw = w.raw || EXCLUDED.raw;
      ELSIF _req.kind = ''reach'' THEN
        SELECT COALESCE(SUM(NULLIF(v->>''value'', '''')::bigint), 0) INTO _sum
        FROM jsonb_array_elements(COALESCE(_body#>''{data,0,values}'', ''[]''::jsonb)) AS v;
        INSERT INTO public.social_metrics_weekly AS w
          (client_id, external_account_id, week_start, week_end, reach, raw)
        VALUES
          (_req.client_id, _req.external_account_id, _req.week_start, _req.week_end,
           _sum::integer, jsonb_build_object(''reach'', _body))
        ON CONFLICT (external_account_id, week_start) DO UPDATE
          SET reach = EXCLUDED.reach,
              captured_at = now(),
              raw = w.raw || EXCLUDED.raw;
      ELSIF _req.kind = ''posts'' THEN
        FOR _item IN
          SELECT value FROM jsonb_array_elements(COALESCE(_body->''data'', ''[]''::jsonb))
        LOOP
          INSERT INTO public.social_post_metrics AS p
            (client_id, external_account_id, media_id, media_type, caption,
             permalink, posted_at, like_count, comments_count)
          VALUES
            (_req.client_id, _req.external_account_id,
             _item->>''id'',
             _item->>''media_type'',
             left(COALESCE(_item->>''caption'', ''''), 500),
             _item->>''permalink'',
             NULLIF(_item->>''timestamp'', '''')::timestamptz,
             NULLIF(_item->>''like_count'', '''')::integer,
             NULLIF(_item->>''comments_count'', '''')::integer)
          ON CONFLICT (external_account_id, media_id) DO UPDATE
            SET like_count = EXCLUDED.like_count,
                comments_count = EXCLUDED.comments_count,
                caption = EXCLUDED.caption,
                permalink = EXCLUDED.permalink,
                media_type = EXCLUDED.media_type,
                posted_at = EXCLUDED.posted_at,
                captured_at = now();
        END LOOP;
      ELSE
        INSERT INTO public.social_metrics_weekly AS w
          (client_id, external_account_id, week_start, week_end,
           profile_views, accounts_engaged, total_interactions, raw)
        VALUES
          (_req.client_id, _req.external_account_id, _req.week_start, _req.week_end,
           (SELECT NULLIF(m#>>''{total_value,value}'', '''')::integer
              FROM jsonb_array_elements(COALESCE(_body->''data'', ''[]''::jsonb)) AS m
              WHERE m->>''name'' = ''profile_views'' LIMIT 1),
           (SELECT NULLIF(m#>>''{total_value,value}'', '''')::integer
              FROM jsonb_array_elements(COALESCE(_body->''data'', ''[]''::jsonb)) AS m
              WHERE m->>''name'' = ''accounts_engaged'' LIMIT 1),
           (SELECT NULLIF(m#>>''{total_value,value}'', '''')::integer
              FROM jsonb_array_elements(COALESCE(_body->''data'', ''[]''::jsonb)) AS m
              WHERE m->>''name'' = ''total_interactions'' LIMIT 1),
           jsonb_build_object(''engage'', _body))
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
        IF _req.kind <> ''posts'' THEN
          INSERT INTO public.social_metrics_weekly AS w
            (client_id, external_account_id, week_start, week_end, raw)
          VALUES
            (_req.client_id, _req.external_account_id, _req.week_start, _req.week_end,
             jsonb_build_object(''error_'' || _req.kind, _body))
          ON CONFLICT (external_account_id, week_start) DO UPDATE
            SET raw = w.raw || EXCLUDED.raw, captured_at = now();
        END IF;
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
    WHERE account.platform = ''instagram''
      AND account.status = ''active''
      AND NOT EXISTS (
        SELECT 1 FROM public.social_metrics_weekly AS w
        WHERE w.external_account_id = account.id
          AND w.week_start = _week_start
          AND w.followers IS NOT NULL
          AND (w.reach IS NOT NULL OR w.raw ? ''error_reach'')
          AND (w.total_interactions IS NOT NULL OR w.raw ? ''error_engage'')
      )
      AND NOT EXISTS (
        SELECT 1 FROM social_private.social_metrics_requests AS r
        WHERE r.external_account_id = account.id
          AND r.week_start = _week_start
          AND r.kind <> ''posts''
      )
  LOOP
    SELECT t.resource_id, t.access_token INTO _token_resource, _token_secret
    FROM social_private.autopublish_account_token(_acct.id) AS t;
    IF _token_secret IS NULL THEN CONTINUE; END IF;
    FOREACH _kind IN ARRAY ARRAY[''profile'', ''reach'', ''engage''] LOOP
      _url := social_private.social_metrics_url(
        _kind, _token_resource, _token_secret, _week_start, _week_end);
      SELECT net.http_get(url := _url) INTO _rid;
      INSERT INTO social_private.social_metrics_requests
        (external_account_id, client_id, kind, request_id, week_start, week_end)
      VALUES (_acct.id, _acct.client_id, _kind, _rid, _week_start, _week_end);
      _dispatched := _dispatched + 1;
    END LOOP;
  END LOOP;

  -- D) Publicacoes: atualiza a cada 3 dias por conta
  FOR _acct IN
    SELECT account.id, account.client_id
    FROM public.external_accounts AS account
    WHERE account.platform = ''instagram''
      AND account.status = ''active''
      AND NOT EXISTS (
        SELECT 1 FROM public.social_post_metrics AS p
        WHERE p.external_account_id = account.id
          AND p.captured_at > now() - interval ''3 days''
      )
      AND NOT EXISTS (
        SELECT 1 FROM social_private.social_metrics_requests AS r
        WHERE r.external_account_id = account.id AND r.kind = ''posts''
      )
  LOOP
    SELECT t.resource_id, t.access_token INTO _token_resource, _token_secret
    FROM social_private.autopublish_account_token(_acct.id) AS t;
    IF _token_secret IS NULL THEN CONTINUE; END IF;
    _url := social_private.social_metrics_url(
      ''posts'', _token_resource, _token_secret, _week_start, _week_end);
    SELECT net.http_get(url := _url) INTO _rid;
    INSERT INTO social_private.social_metrics_requests
      (external_account_id, client_id, kind, request_id, week_start, week_end)
    VALUES (_acct.id, _acct.client_id, ''posts'', _rid, _week_start, _week_end);
    _dispatched := _dispatched + 1;
  END LOOP;

  RETURN jsonb_build_object(
    ''week_start'', _week_start,
    ''dispatched'', _dispatched,
    ''parsed'', _parsed
  );
END
$function$',
    'REVOKE ALL ON FUNCTION public.social_metrics_tick() FROM PUBLIC, anon, authenticated'
  ]::text[]),
  ('20260814070000', 'reuse_art_from_archived_and_shared', ARRAY[
    '-- Duas travas injustas na escolha de midia do conteudo:
--   1. Conteudo APAGADO (arquivado) segurava a arte para sempre: o indice
--      unico e a guarda "ja vinculada a outro conteudo" contavam posts
--      arquivados. Apagou o card, a arte tem que voltar a ficar livre.
--   2. Arte DISPONIBILIZADA ao cliente (client_shared) era recusada porque
--      nunca tem decisao do cliente (client_decided_at). Pela regra da casa,
--      disponibilizada = aprovada.
--
-- Forward-only e idempotente.

-- ─────────── 1) Indice unico vale so para conteudos vivos ───────────
DROP INDEX IF EXISTS public.editorial_posts_primary_file_unique_idx',
    'CREATE UNIQUE INDEX editorial_posts_primary_file_unique_idx
  ON public.editorial_posts(primary_file_id)
  WHERE primary_file_id IS NOT NULL AND archived_at IS NULL',
    '-- ─────────── 2) Guardas da funcao de salvar ───────────
DO $patch$
DECLARE
  original_definition text;
  patched_definition text;
  old_linked text;
  new_linked text;
  old_decided text;
  new_decided text;
  changed boolean := false;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO original_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = ''public'' AND p.proname = ''save_editorial_post_unlocked'';

  IF original_definition IS NULL THEN
    RAISE EXCEPTION ''save_editorial_post_unlocked nao encontrada; nada a aplicar'';
  END IF;

  patched_definition := original_definition;

  old_linked := $a$      AND post.id IS DISTINCT FROM _post_id
  ) OR EXISTS ($a$;
  new_linked := $b$      AND post.id IS DISTINCT FROM _post_id
      AND post.archived_at IS NULL
  ) OR EXISTS ($b$;

  IF position(new_linked IN patched_definition) > 0 THEN
    RAISE NOTICE ''guarda de vinculo ja ignora conteudos apagados; nada a fazer'';
  ELSIF position(old_linked IN patched_definition) > 0 THEN
    patched_definition := replace(patched_definition, old_linked, new_linked);
    changed := true;
  ELSE
    RAISE NOTICE ''guarda de vinculo nao encontrada nesta versao; seguindo'';
  END IF;

  old_decided := $c$    OR _primary_file.client_decided_at IS NULL THEN$c$;
  new_decided := $d$    OR (
      _primary_file.client_decided_at IS NULL
      AND _primary_file.visibility <> ''client_shared''
    ) THEN$d$;

  IF position(new_decided IN patched_definition) > 0 THEN
    RAISE NOTICE ''arte disponibilizada ja aceita como aprovada; nada a fazer'';
  ELSIF position(old_decided IN patched_definition) > 0 THEN
    patched_definition := replace(patched_definition, old_decided, new_decided);
    changed := true;
  ELSE
    RAISE NOTICE ''guarda de decisao do cliente nao encontrada nesta versao; seguindo'';
  END IF;

  IF changed THEN
    EXECUTE patched_definition;
    RAISE NOTICE ''reuso de arte de conteudo apagado e arte disponibilizada liberados'';
  END IF;
END
$patch$',
    'REVOKE ALL ON FUNCTION public.save_editorial_post_unlocked(jsonb, integer)
  FROM PUBLIC, anon, authenticated',
    'GRANT EXECUTE ON FUNCTION public.save_editorial_post_unlocked(jsonb, integer)
  TO service_role'
  ]::text[]),
  ('20260814080000', 'post_metrics_media_urls', ARRAY[
    '-- Previa visual no ranking de posts: o robo passa a guardar media_url e
-- thumbnail_url de cada publicacao coletada da Meta.

ALTER TABLE public.social_post_metrics
  ADD COLUMN IF NOT EXISTS media_url text,
  ADD COLUMN IF NOT EXISTS thumbnail_url text',
    'CREATE OR REPLACE FUNCTION social_private.social_metrics_url(
  _kind text, _ig text, _token text, _week_start date, _week_end date
)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''''
AS $function$
  SELECT CASE _kind
    WHEN ''profile'' THEN
      ''https://graph.facebook.com/v21.0/'' || _ig
      || ''?fields=followers_count,media_count&access_token='' || _token
    WHEN ''reach'' THEN
      ''https://graph.facebook.com/v21.0/'' || _ig
      || ''/insights?metric=reach&period=day&since='' || _week_start::text
      || ''&until='' || (_week_end + 1)::text || ''&access_token='' || _token
    WHEN ''posts'' THEN
      ''https://graph.facebook.com/v21.0/'' || _ig
      || ''/media?fields=id,caption,timestamp,media_type,permalink,like_count,comments_count,media_url,thumbnail_url''
      || ''&limit=25&access_token='' || _token
    ELSE
      ''https://graph.facebook.com/v21.0/'' || _ig
      || ''/insights?metric=profile_views,accounts_engaged,total_interactions''
      || ''&metric_type=total_value&period=day&since='' || _week_start::text
      || ''&until='' || (_week_end + 1)::text || ''&access_token='' || _token
  END;
$function$',
    'DO $patch$
DECLARE
  original_definition text;
  patched_definition text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO original_definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = ''public'' AND p.proname = ''social_metrics_tick'';

  IF original_definition IS NULL THEN
    RAISE EXCEPTION ''social_metrics_tick nao encontrada; rode antes as migrations de metricas'';
  END IF;
  IF position(''thumbnail_url'' IN original_definition) > 0 THEN
    RAISE NOTICE ''tick ja coleta media_url/thumbnail_url; nada a fazer'';
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
    $c$             _item->>''permalink'',
             NULLIF(_item->>''timestamp'', '''')::timestamptz,$c$,
    $d$             _item->>''permalink'',
             _item->>''media_url'',
             _item->>''thumbnail_url'',
             NULLIF(_item->>''timestamp'', '''')::timestamptz,$d$
  );
  patched_definition := replace(
    patched_definition,
    $e$                media_type = EXCLUDED.media_type,$e$,
    $f$                media_type = EXCLUDED.media_type,
                media_url = EXCLUDED.media_url,
                thumbnail_url = EXCLUDED.thumbnail_url,$f$
  );

  IF patched_definition = original_definition THEN
    RAISE EXCEPTION ''nenhuma alteracao produzida no tick; nada aplicado'';
  END IF;
  EXECUTE patched_definition;
  RAISE NOTICE ''tick atualizado: previa visual dos posts habilitada'';
END
$patch$',
    '-- Forca recoleta com os novos campos na proxima passada.
UPDATE public.social_post_metrics SET captured_at = now() - interval ''4 days'''
  ]::text[]),
  ('20260814090000', 'post_deep_insights', ARRAY[
    '-- Mergulho por publicacao: alcance, salvamentos, compartilhamentos e total de
-- interacoes de cada post (1 chamada por post, ate 8 por passada, posts dos
-- ultimos 45 dias). Erros da Meta em post individual nao travam o resto.

ALTER TABLE public.social_post_metrics
  ADD COLUMN IF NOT EXISTS reach integer,
  ADD COLUMN IF NOT EXISTS saved integer,
  ADD COLUMN IF NOT EXISTS shares integer,
  ADD COLUMN IF NOT EXISTS total_interactions integer,
  ADD COLUMN IF NOT EXISTS insights_captured_at timestamptz',
    'ALTER TABLE social_private.social_metrics_requests
  ADD COLUMN IF NOT EXISTS media_id text',
    'ALTER TABLE social_private.social_metrics_requests
  DROP CONSTRAINT IF EXISTS social_metrics_requests_kind_check',
    'ALTER TABLE social_private.social_metrics_requests
  ADD CONSTRAINT social_metrics_requests_kind_check
  CHECK (kind IN (''profile'', ''reach'', ''engage'', ''posts'', ''post_insights''))',
    'CREATE OR REPLACE FUNCTION social_private.social_metrics_url(
  _kind text, _ig text, _token text, _week_start date, _week_end date
)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''''
AS $function$
  SELECT CASE _kind
    WHEN ''profile'' THEN
      ''https://graph.facebook.com/v21.0/'' || _ig
      || ''?fields=followers_count,media_count&access_token='' || _token
    WHEN ''reach'' THEN
      ''https://graph.facebook.com/v21.0/'' || _ig
      || ''/insights?metric=reach&period=day&since='' || _week_start::text
      || ''&until='' || (_week_end + 1)::text || ''&access_token='' || _token
    WHEN ''posts'' THEN
      ''https://graph.facebook.com/v21.0/'' || _ig
      || ''/media?fields=id,caption,timestamp,media_type,permalink,like_count,comments_count,media_url,thumbnail_url''
      || ''&limit=25&access_token='' || _token
    WHEN ''post_insights'' THEN
      ''https://graph.facebook.com/v21.0/'' || _ig
      || ''/insights?metric=reach,saved,shares,total_interactions&access_token='' || _token
    ELSE
      ''https://graph.facebook.com/v21.0/'' || _ig
      || ''/insights?metric=profile_views,accounts_engaged,total_interactions''
      || ''&metric_type=total_value&period=day&since='' || _week_start::text
      || ''&until='' || (_week_end + 1)::text || ''&access_token='' || _token
  END;
$function$',
    'DO $patch$
DECLARE
  original_definition text;
  patched_definition text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO original_definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = ''public'' AND p.proname = ''social_metrics_tick'';

  IF original_definition IS NULL THEN
    RAISE EXCEPTION ''social_metrics_tick nao encontrada; rode as migrations de metricas antes'';
  END IF;
  IF position(''post_insights'' IN original_definition) > 0 THEN
    RAISE NOTICE ''mergulho por post ja habilitado; nada a fazer'';
    RETURN;
  END IF;
  IF position(''thumbnail_url'' IN original_definition) = 0 THEN
    RAISE EXCEPTION ''rode antes a migration das previas (media_url/thumbnail)'';
  END IF;

  -- Novo ramo de parse antes do ELSE final do bloco de respostas.
  patched_definition := replace(
    original_definition,
    $a$      ELSE
        INSERT INTO public.social_metrics_weekly AS w
          (client_id, external_account_id, week_start, week_end,
           profile_views, accounts_engaged, total_interactions, raw)$a$,
    $b$      ELSIF _req.kind = ''post_insights'' THEN
        UPDATE public.social_post_metrics
        SET
          reach = COALESCE((SELECT NULLIF(m#>>''{values,0,value}'', '''')::integer
            FROM jsonb_array_elements(COALESCE(_body->''data'', ''[]''::jsonb)) AS m
            WHERE m->>''name'' = ''reach'' LIMIT 1), reach),
          saved = COALESCE((SELECT NULLIF(m#>>''{values,0,value}'', '''')::integer
            FROM jsonb_array_elements(COALESCE(_body->''data'', ''[]''::jsonb)) AS m
            WHERE m->>''name'' = ''saved'' LIMIT 1), saved),
          shares = COALESCE((SELECT NULLIF(m#>>''{values,0,value}'', '''')::integer
            FROM jsonb_array_elements(COALESCE(_body->''data'', ''[]''::jsonb)) AS m
            WHERE m->>''name'' = ''shares'' LIMIT 1), shares),
          total_interactions = COALESCE((SELECT NULLIF(m#>>''{values,0,value}'', '''')::integer
            FROM jsonb_array_elements(COALESCE(_body->''data'', ''[]''::jsonb)) AS m
            WHERE m->>''name'' = ''total_interactions'' LIMIT 1), total_interactions),
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
        IF _req.kind <> ''posts'' THEN$c$,
    $d$      IF _req.attempts >= 3 THEN
        IF _req.kind = ''post_insights'' THEN
          UPDATE public.social_post_metrics
          SET insights_captured_at = now()
          WHERE external_account_id = _req.external_account_id
            AND media_id = _req.media_id;
        END IF;
        IF _req.kind NOT IN (''posts'', ''post_insights'') THEN$d$
  );

  -- Redespacho usa o media_id como alvo quando o tipo e post_insights.
  patched_definition := replace(
    patched_definition,
    $e$    _url := social_private.social_metrics_url(
      _req.kind, _token_resource, _token_secret, _req.week_start, _req.week_end);$e$,
    $f$    _url := social_private.social_metrics_url(
      _req.kind,
      CASE WHEN _req.kind = ''post_insights'' THEN _req.media_id ELSE _token_resource END,
      _token_secret, _req.week_start, _req.week_end);$f$
  );

  -- Novo loop de despacho: ate 8 posts sem mergulho por passada.
  patched_definition := replace(
    patched_definition,
    $g$  RETURN jsonb_build_object(
    ''week_start'', _week_start,$g$,
    $h$  FOR _req IN
    SELECT p.external_account_id, p.client_id, p.media_id
    FROM public.social_post_metrics AS p
    WHERE p.insights_captured_at IS NULL
      AND p.posted_at > now() - interval ''45 days''
      AND NOT EXISTS (
        SELECT 1 FROM social_private.social_metrics_requests AS r
        WHERE r.kind = ''post_insights'' AND r.media_id = p.media_id
      )
    ORDER BY p.posted_at DESC
    LIMIT 8
  LOOP
    SELECT t.resource_id, t.access_token INTO _token_resource, _token_secret
    FROM social_private.autopublish_account_token(_req.external_account_id) AS t;
    IF _token_secret IS NULL THEN CONTINUE; END IF;
    _url := social_private.social_metrics_url(
      ''post_insights'', _req.media_id, _token_secret, _week_start, _week_end);
    SELECT net.http_get(url := _url) INTO _rid;
    INSERT INTO social_private.social_metrics_requests
      (external_account_id, client_id, kind, request_id, week_start, week_end, media_id)
    VALUES (_req.external_account_id, _req.client_id, ''post_insights'', _rid,
            _week_start, _week_end, _req.media_id);
    _dispatched := _dispatched + 1;
  END LOOP;

  RETURN jsonb_build_object(
    ''week_start'', _week_start,$h$
  );

  IF patched_definition = original_definition THEN
    RAISE EXCEPTION ''nenhuma alteracao produzida no tick; nada aplicado'';
  END IF;
  EXECUTE patched_definition;
  RAISE NOTICE ''mergulho por post habilitado: reach, saved, shares por publicacao'';
END
$patch$'
  ]::text[]),
  ('20260814100000', 'social_client_identity', ARRAY[
    '-- Identidade visual do cliente puxada do Instagram (foto de perfil, @, nome,
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
)',
    'ALTER TABLE public.social_client_identity ENABLE ROW LEVEL SECURITY',
    'DROP POLICY IF EXISTS social_client_identity_staff_read ON public.social_client_identity',
    'CREATE POLICY social_client_identity_staff_read ON public.social_client_identity
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) AND public.can_access_client(client_id))',
    'DROP POLICY IF EXISTS social_client_identity_client_read ON public.social_client_identity',
    'CREATE POLICY social_client_identity_client_read ON public.social_client_identity
  FOR SELECT TO authenticated
  USING (client_id = auth.uid())',
    'REVOKE INSERT, UPDATE, DELETE ON public.social_client_identity FROM anon, authenticated',
    'GRANT SELECT ON public.social_client_identity TO authenticated',
    'ALTER TABLE social_private.social_metrics_requests
  DROP CONSTRAINT IF EXISTS social_metrics_requests_kind_check',
    'ALTER TABLE social_private.social_metrics_requests
  ADD CONSTRAINT social_metrics_requests_kind_check
  CHECK (kind IN (''profile'', ''reach'', ''engage'', ''posts'', ''post_insights'', ''identity''))',
    'CREATE OR REPLACE FUNCTION social_private.social_metrics_url(
  _kind text, _ig text, _token text, _week_start date, _week_end date
)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''''
AS $function$
  SELECT CASE _kind
    WHEN ''profile'' THEN
      ''https://graph.facebook.com/v21.0/'' || _ig
      || ''?fields=followers_count,media_count&access_token='' || _token
    WHEN ''reach'' THEN
      ''https://graph.facebook.com/v21.0/'' || _ig
      || ''/insights?metric=reach&period=day&since='' || _week_start::text
      || ''&until='' || (_week_end + 1)::text || ''&access_token='' || _token
    WHEN ''posts'' THEN
      ''https://graph.facebook.com/v21.0/'' || _ig
      || ''/media?fields=id,caption,timestamp,media_type,permalink,like_count,comments_count,media_url,thumbnail_url''
      || ''&limit=25&access_token='' || _token
    WHEN ''post_insights'' THEN
      ''https://graph.facebook.com/v21.0/'' || _ig
      || ''/insights?metric=reach,saved,shares,total_interactions&access_token='' || _token
    WHEN ''identity'' THEN
      ''https://graph.facebook.com/v21.0/'' || _ig
      || ''?fields=username,name,biography,website,profile_picture_url&access_token='' || _token
    ELSE
      ''https://graph.facebook.com/v21.0/'' || _ig
      || ''/insights?metric=profile_views,accounts_engaged,total_interactions''
      || ''&metric_type=total_value&period=day&since='' || _week_start::text
      || ''&until='' || (_week_end + 1)::text || ''&access_token='' || _token
  END;
$function$',
    'DO $patch$
DECLARE
  original_definition text;
  patched_definition text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO original_definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = ''public'' AND p.proname = ''social_metrics_tick'';

  IF original_definition IS NULL THEN
    RAISE EXCEPTION ''social_metrics_tick nao encontrada; rode as migrations de metricas antes'';
  END IF;
  IF position(''identity'' IN original_definition) > 0 THEN
    RAISE NOTICE ''identidade ja habilitada; nada a fazer'';
    RETURN;
  END IF;
  IF position(''post_insights'' IN original_definition) = 0 THEN
    RAISE EXCEPTION ''rode antes a migration do mergulho por post (post_insights)'';
  END IF;

  -- Ramo de parse: identidade vem antes do ramo de post_insights.
  patched_definition := replace(
    original_definition,
    $a$      ELSIF _req.kind = ''post_insights'' THEN$a$,
    $b$      ELSIF _req.kind = ''identity'' THEN
        INSERT INTO public.social_client_identity AS ident
          (client_id, external_account_id, username, display_name, biography, website, profile_picture_url, captured_at)
        VALUES
          (_req.client_id, _req.external_account_id,
           _body->>''username'', _body->>''name'', _body->>''biography'',
           _body->>''website'', _body->>''profile_picture_url'', now())
        ON CONFLICT (external_account_id) DO UPDATE
          SET username = EXCLUDED.username,
              display_name = EXCLUDED.display_name,
              biography = EXCLUDED.biography,
              website = EXCLUDED.website,
              profile_picture_url = EXCLUDED.profile_picture_url,
              captured_at = now();
      ELSIF _req.kind = ''post_insights'' THEN$b$
  );

  -- Falha definitiva de identidade nao deve poluir o semanal.
  patched_definition := replace(
    patched_definition,
    $c$        IF _req.kind NOT IN (''posts'', ''post_insights'') THEN$c$,
    $d$        IF _req.kind NOT IN (''posts'', ''post_insights'', ''identity'') THEN$d$
  );

  -- Despacho: identidade com mais de 7 dias (ou inexistente) e recoletada.
  patched_definition := replace(
    patched_definition,
    $e$  RETURN jsonb_build_object(
    ''week_start'', _week_start,$e$,
    $f$  FOR _acct IN
    SELECT account.id, account.client_id
    FROM public.external_accounts AS account
    WHERE account.platform = ''instagram''
      AND account.status = ''active''
      AND NOT EXISTS (
        SELECT 1 FROM public.social_client_identity AS ident
        WHERE ident.external_account_id = account.id
          AND ident.captured_at > now() - interval ''7 days''
      )
      AND NOT EXISTS (
        SELECT 1 FROM social_private.social_metrics_requests AS r
        WHERE r.external_account_id = account.id AND r.kind = ''identity''
      )
  LOOP
    SELECT t.resource_id, t.access_token INTO _token_resource, _token_secret
    FROM social_private.autopublish_account_token(_acct.id) AS t;
    IF _token_secret IS NULL THEN CONTINUE; END IF;
    _url := social_private.social_metrics_url(
      ''identity'', _token_resource, _token_secret, _week_start, _week_end);
    SELECT net.http_get(url := _url) INTO _rid;
    INSERT INTO social_private.social_metrics_requests
      (external_account_id, client_id, kind, request_id, week_start, week_end)
    VALUES (_acct.id, _acct.client_id, ''identity'', _rid, _week_start, _week_end);
    _dispatched := _dispatched + 1;
  END LOOP;

  RETURN jsonb_build_object(
    ''week_start'', _week_start,$f$
  );

  IF patched_definition = original_definition THEN
    RAISE EXCEPTION ''nenhuma alteracao produzida no tick; nada aplicado'';
  END IF;
  EXECUTE patched_definition;
  RAISE NOTICE ''identidade do Instagram habilitada (foto, arroba, bio, site)'';
END
$patch$'
  ]::text[]),
  ('20260814110000', 'free_art_from_archived_publications', ARRAY[
    '-- Ultimo cadeado da arte presa: a guarda "ja vinculada a outro conteudo"
-- tambem contava PUBLICACOES de conteudos APAGADOS (arquivados). Publicacao
-- de conteudo apagado deixa de prender a arte; publicacao viva continua.

DO $patch$
DECLARE
  original_definition text;
  patched_definition text;
  old_guard text;
  new_guard text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO original_definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = ''public'' AND p.proname = ''save_editorial_post_unlocked'';

  IF original_definition IS NULL THEN
    RAISE EXCEPTION ''save_editorial_post_unlocked nao encontrada; nada a aplicar'';
  END IF;

  new_guard := $b$      AND publication.status <> ''cancelled''
      AND EXISTS (
        SELECT 1 FROM public.editorial_posts AS owner_post
        WHERE owner_post.id = publication.post_id
          AND owner_post.archived_at IS NULL
      )
  ) THEN
    RAISE EXCEPTION ''approved editorial media is already linked to another content'';$b$;

  IF position(new_guard IN original_definition) > 0 THEN
    RAISE NOTICE ''publicacao de conteudo apagado ja libera a arte; nada a fazer'';
    RETURN;
  END IF;

  old_guard := $a$      AND publication.status <> ''cancelled''
  ) THEN
    RAISE EXCEPTION ''approved editorial media is already linked to another content'';$a$;

  IF position(old_guard IN original_definition) = 0 THEN
    RAISE EXCEPTION ''guarda de publicacao nao encontrada nesta versao; nada foi alterado'';
  END IF;

  patched_definition := replace(original_definition, old_guard, new_guard);

  IF patched_definition = original_definition THEN
    RAISE EXCEPTION ''nenhuma alteracao produzida; nada aplicado'';
  END IF;

  EXECUTE patched_definition;
  RAISE NOTICE ''arte presa em publicacao de conteudo apagado liberada'';
END
$patch$',
    'REVOKE ALL ON FUNCTION public.save_editorial_post_unlocked(jsonb, integer)
  FROM PUBLIC, anon, authenticated',
    'GRANT EXECUTE ON FUNCTION public.save_editorial_post_unlocked(jsonb, integer)
  TO service_role'
  ]::text[]),
  ('20260814120000', 'free_art_approved_flow', ARRAY[
    '-- A trava da arte mora em save_approved_editorial_post_unlocked (fluxo de
-- arte aprovada), nao na funcao geral. Patch certeiro com o texto real da
-- producao: conteudo APAGADO (post ou publicacao dele) deixa de prender a
-- arte, e arte disponibilizada (client_shared) dispensa decisao do cliente.

DO $patch$
DECLARE
  original_definition text;
  patched_definition text;
  old_linked text;
  new_linked text;
  old_decided text;
  new_decided text;
  changed boolean := false;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO original_definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = ''public''
    AND p.proname = ''save_approved_editorial_post_unlocked'';

  IF original_definition IS NULL THEN
    RAISE EXCEPTION ''save_approved_editorial_post_unlocked nao encontrada'';
  END IF;

  patched_definition := original_definition;

  old_linked := $a$  IF EXISTS (
    SELECT 1
    FROM public.editorial_posts AS post
    WHERE post.primary_file_id = _primary_file_id
      AND post.id IS DISTINCT FROM _post_id
  ) OR EXISTS (
    SELECT 1
    FROM public.editorial_publications AS publication
    WHERE publication.file_id = _primary_file_id
      AND publication.post_id IS DISTINCT FROM _post_id
      AND publication.status <> ''cancelled''
  ) THEN$a$;
  new_linked := $b$  IF EXISTS (
    SELECT 1
    FROM public.editorial_posts AS post
    WHERE post.primary_file_id = _primary_file_id
      AND post.id IS DISTINCT FROM _post_id
      AND post.archived_at IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM public.editorial_publications AS publication
    WHERE publication.file_id = _primary_file_id
      AND publication.post_id IS DISTINCT FROM _post_id
      AND publication.status <> ''cancelled''
      AND EXISTS (
        SELECT 1 FROM public.editorial_posts AS owner_post
        WHERE owner_post.id = publication.post_id
          AND owner_post.archived_at IS NULL
      )
  ) THEN$b$;

  IF position(new_linked IN patched_definition) > 0 THEN
    RAISE NOTICE ''vinculo ja ignora conteudo apagado; nada a fazer'';
  ELSIF position(old_linked IN patched_definition) > 0 THEN
    patched_definition := replace(patched_definition, old_linked, new_linked);
    changed := true;
  ELSE
    RAISE EXCEPTION ''guarda de vinculo nao encontrada; me mande o trecho'';
  END IF;

  old_decided := $c$ _primary_file.client_decided_at IS NULL THEN$c$;
  new_decided := $d$ (
      _primary_file.client_decided_at IS NULL
      AND _primary_file.visibility <> ''client_shared''
    ) THEN$d$;

  IF position(new_decided IN patched_definition) > 0 THEN
    RAISE NOTICE ''arte disponibilizada ja aceita; nada a fazer'';
  ELSIF position(old_decided IN patched_definition) > 0 THEN
    patched_definition := replace(patched_definition, old_decided, new_decided);
    changed := true;
  ELSE
    RAISE NOTICE ''guarda de decisao do cliente nao encontrada nesta funcao; seguindo'';
  END IF;

  IF changed THEN
    EXECUTE patched_definition;
    RAISE NOTICE ''arte de conteudo apagado liberada no fluxo de arte aprovada'';
  END IF;
END
$patch$'
  ]::text[]),
  ('20260814130000', 'ready_guard_tolerante', ARRAY[
    '-- "file must be ready before review": arquivos com o objeto salvo (upload
-- concluido) ficavam presos com status antigo e nao podiam ser liberados ao
-- cliente. Duas frentes:
--   1. Guarda tolerante: arquivo com storage_path/file_url preenchido conta
--      como pronto, mesmo se o status ficou para tras.
--   2. Normaliza os arquivos ja presos (apenas os em estado editavel).

DO $patch$
DECLARE
  r record;
  def text;
  newdef text;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prokind = ''f'' AND n.nspname = ''public''
      AND pg_get_functiondef(p.oid) LIKE ''%file must be ready before review%''
  LOOP
    def := pg_get_functiondef(r.oid);
    newdef := replace(
      def,
      $a$COALESCE(_file.status, ''ready'') <> ''ready'' THEN
    RAISE EXCEPTION ''file must be ready before review'';$a$,
      $b$COALESCE(_file.status, ''ready'') <> ''ready''
    AND COALESCE(_file.storage_path, _file.file_url) IS NULL THEN
    RAISE EXCEPTION ''file must be ready before review'';$b$
    );
    IF newdef <> def THEN
      EXECUTE newdef;
      RAISE NOTICE ''guarda ready relaxada em %'', r.oid::regprocedure;
    ELSE
      RAISE NOTICE ''padrao nao encontrado em % (formatacao diferente)'', r.oid::regprocedure;
    END IF;
  END LOOP;
END
$patch$',
    '-- Destrava os arquivos existentes (so os que ainda estao em estado editavel,
-- para nao esbarrar nas travas de imutabilidade).
UPDATE public.files
SET status = ''ready''
WHERE COALESCE(status, ''ready'') <> ''ready''
  AND archived_at IS NULL
  AND parent_file_id IS NULL
  AND locked_at IS NULL
  AND visibility = ''internal''
  AND agency_approval_status = ''not_requested''
  AND approval_status = ''none''
  AND COALESCE(storage_path, file_url) IS NOT NULL'
  ]::text[]),
  ('20260814140000', 'admin_release_file_now', ARRAY[
    '-- Fim do domino de guardas ao "Disponibilizar ao cliente": uma unica RPC
-- atomica faz a revisao interna + liberacao na MESMA transacao, com erros
-- em portugues dizendo exatamente qual estado travou.

CREATE OR REPLACE FUNCTION public.admin_release_file_now(
  p_file_id uuid,
  p_mode text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''''
AS $function$
DECLARE
  _file public.files%ROWTYPE;
  _actor uuid := auth.uid();
BEGIN
  IF _actor IS NULL
    OR NOT (
      public.has_role(_actor, ''admin''::public.app_role)
      OR public.has_role(_actor, ''manager''::public.app_role)
    ) THEN
    RAISE EXCEPTION ''somente admin ou manager pode liberar ao cliente'';
  END IF;
  IF p_mode NOT IN (''client_shared'', ''approval'') THEN
    RAISE EXCEPTION ''modo de liberacao invalido'';
  END IF;

  SELECT * INTO _file
  FROM public.files
  WHERE id = p_file_id AND parent_file_id IS NULL
  FOR UPDATE;
  IF NOT FOUND OR NOT public.can_access_client(_file.client_id) THEN
    RAISE EXCEPTION ''arquivo nao encontrado ou sem acesso'';
  END IF;
  IF _file.archived_at IS NOT NULL THEN
    RAISE EXCEPTION ''arquivo arquivado nao pode ser liberado'';
  END IF;
  IF COALESCE(_file.storage_path, _file.file_url) IS NULL THEN
    RAISE EXCEPTION ''o upload deste arquivo ainda nao concluiu; tente de novo em instantes'';
  END IF;
  IF _file.visibility <> ''internal'' THEN
    -- Ja liberado antes: nada a fazer, sem erro na cara do usuario.
    RETURN;
  END IF;

  IF _file.agency_approval_status = ''not_requested'' THEN
    PERFORM public.request_file_agency_review(p_file_id);
  END IF;

  SELECT * INTO _file FROM public.files WHERE id = p_file_id;
  IF _file.agency_approval_status <> ''approved'' THEN
    PERFORM public.review_file_agency(p_file_id, ''approved'', NULL);
  END IF;

  SELECT * INTO _file FROM public.files WHERE id = p_file_id;
  IF _file.agency_approval_status <> ''approved'' THEN
    RAISE EXCEPTION ''a revisao interna nao concluiu (estado atual: %). Me avise com este texto.'',
      _file.agency_approval_status;
  END IF;

  PERFORM public.release_file_to_client(p_file_id, p_mode);
END
$function$',
    'REVOKE ALL ON FUNCTION public.admin_release_file_now(uuid, text) FROM PUBLIC, anon',
    'GRANT EXECUTE ON FUNCTION public.admin_release_file_now(uuid, text) TO authenticated'
  ]::text[]),
  ('20260814150000', 'cliente_ve_cronograma_completo', ARRAY[
    '-- Decisao de produto do dono: o CLIENTE ve o cronograma COMPLETO da agenda
-- dele - backlog, em producao, pronto, agendado e publicado. Antes so via
-- post "ready" com arte aprovada e o calendario parecia vazio/zerado mesmo
-- com semanas de trabalho planejado.
--
-- O que continua protegido: dados internos (editorial_post_internal e
-- publication_internal tem RLS propria), arquivos nao liberados
-- (can_client_read_file) e clientes de outros donos.

CREATE OR REPLACE FUNCTION public.editorial_client_can_read_post(
  _post_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.editorial_posts AS post
    WHERE post.id = _post_id
      AND post.archived_at IS NULL
      AND auth.uid() = post.client_id
      AND public.has_role(auth.uid(), ''client''::public.app_role)
  )
$$',
    'CREATE OR REPLACE FUNCTION public.editorial_client_can_read_publication(
  _publication_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.editorial_publications AS publication
    JOIN public.editorial_posts AS post
      ON post.id = publication.post_id
    WHERE publication.id = _publication_id
      AND publication.status <> ''cancelled''
      AND post.archived_at IS NULL
      AND auth.uid() = publication.client_id
      AND public.has_role(auth.uid(), ''client''::public.app_role)
  )
$$',
    'REVOKE ALL ON FUNCTION public.editorial_client_can_read_post(uuid)
  FROM PUBLIC, anon',
    'REVOKE ALL ON FUNCTION public.editorial_client_can_read_publication(uuid)
  FROM PUBLIC, anon'
  ]::text[]),
  ('20260814160000', 'admin_release_desarquiva', ARRAY[
    '-- Poder total do admin: se o dono mandou liberar ao cliente, vai. Arquivo
-- arquivado e DESARQUIVADO na hora e a liberacao segue na mesma transacao.

CREATE OR REPLACE FUNCTION public.admin_release_file_now(
  p_file_id uuid,
  p_mode text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''''
AS $function$
DECLARE
  _file public.files%ROWTYPE;
  _actor uuid := auth.uid();
BEGIN
  IF _actor IS NULL
    OR NOT (
      public.has_role(_actor, ''admin''::public.app_role)
      OR public.has_role(_actor, ''manager''::public.app_role)
    ) THEN
    RAISE EXCEPTION ''somente admin ou manager pode liberar ao cliente'';
  END IF;
  IF p_mode NOT IN (''client_shared'', ''approval'') THEN
    RAISE EXCEPTION ''modo de liberacao invalido'';
  END IF;

  SELECT * INTO _file
  FROM public.files
  WHERE id = p_file_id AND parent_file_id IS NULL
  FOR UPDATE;
  IF NOT FOUND OR NOT public.can_access_client(_file.client_id) THEN
    RAISE EXCEPTION ''arquivo nao encontrado ou sem acesso'';
  END IF;
  IF COALESCE(_file.storage_path, _file.file_url) IS NULL THEN
    RAISE EXCEPTION ''o upload deste arquivo ainda nao concluiu; tente de novo em instantes'';
  END IF;

  -- Admin mandou: arquivado desarquiva e segue (a funcao roda como dono do
  -- banco, entao a escrita e confiavel para as travas de imutabilidade).
  IF _file.archived_at IS NOT NULL THEN
    UPDATE public.files SET archived_at = NULL WHERE id = p_file_id;
    _file.archived_at := NULL;
  END IF;

  IF _file.visibility <> ''internal'' THEN
    -- Ja liberado antes: nada a fazer, sem erro na cara do usuario.
    RETURN;
  END IF;

  IF _file.agency_approval_status = ''not_requested'' THEN
    PERFORM public.request_file_agency_review(p_file_id);
  END IF;

  SELECT * INTO _file FROM public.files WHERE id = p_file_id;
  IF _file.agency_approval_status <> ''approved'' THEN
    PERFORM public.review_file_agency(p_file_id, ''approved'', NULL);
  END IF;

  SELECT * INTO _file FROM public.files WHERE id = p_file_id;
  IF _file.agency_approval_status <> ''approved'' THEN
    RAISE EXCEPTION ''a revisao interna nao concluiu (estado atual: %). Me avise com este texto.'',
      _file.agency_approval_status;
  END IF;

  PERFORM public.release_file_to_client(p_file_id, p_mode);
END
$function$',
    'REVOKE ALL ON FUNCTION public.admin_release_file_now(uuid, text) FROM PUBLIC, anon',
    'GRANT EXECUTE ON FUNCTION public.admin_release_file_now(uuid, text) TO authenticated'
  ]::text[]),
  ('20260814170000', 'cliente_le_pautas_do_kanban', ARRAY[
    '-- O cronograma completo do cliente inclui as PAUTAS do Kanban (prazos
-- roxos): o cliente le as tarefas dos proprios projetos. Leitura apenas;
-- escrita continua exclusiva da equipe.

DROP POLICY IF EXISTS tasks_client_schedule_read ON public.tasks',
    'CREATE POLICY tasks_client_schedule_read ON public.tasks
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.has_role(auth.uid(), ''client''::public.app_role)
    AND EXISTS (
      SELECT 1 FROM public.projects AS project
      WHERE project.id = tasks.project_id
        AND project.client_id = auth.uid()
        AND project.deleted_at IS NULL
    )
  )'
  ]::text[]),
  ('20260814180000', 'ciclo_semanal_checklist', ARRAY[
    '-- Checklist de bolso do dono: o ciclo semanal por cliente (Social Media e
-- Trafego Pago), com estrelas de progresso. Cada marcacao vive no banco e
-- fica sincronizada com o painel; semana e segunda a domingo.

CREATE TABLE IF NOT EXISTS public.weekly_cycle_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  area text NOT NULL CHECK (area IN (''social'', ''trafego'')),
  week_start date NOT NULL,
  step smallint NOT NULL CHECK (step BETWEEN 1 AND 10),
  done_by uuid,
  done_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, area, week_start, step)
)',
    'CREATE INDEX IF NOT EXISTS weekly_cycle_progress_week_idx
  ON public.weekly_cycle_progress (week_start, area, client_id)',
    'ALTER TABLE public.weekly_cycle_progress ENABLE ROW LEVEL SECURITY',
    'DROP POLICY IF EXISTS weekly_cycle_staff_read ON public.weekly_cycle_progress',
    'CREATE POLICY weekly_cycle_staff_read ON public.weekly_cycle_progress
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) AND public.can_access_client(client_id))',
    'DROP POLICY IF EXISTS weekly_cycle_admin_write ON public.weekly_cycle_progress',
    'CREATE POLICY weekly_cycle_admin_write ON public.weekly_cycle_progress
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.has_role(auth.uid(), ''admin''::public.app_role)
      OR public.has_role(auth.uid(), ''manager''::public.app_role))
    AND public.can_access_client(client_id)
  )',
    'DROP POLICY IF EXISTS weekly_cycle_admin_delete ON public.weekly_cycle_progress',
    'CREATE POLICY weekly_cycle_admin_delete ON public.weekly_cycle_progress
  FOR DELETE TO authenticated
  USING (
    (public.has_role(auth.uid(), ''admin''::public.app_role)
      OR public.has_role(auth.uid(), ''manager''::public.app_role))
    AND public.can_access_client(client_id)
  )',
    'GRANT SELECT, INSERT, DELETE ON public.weekly_cycle_progress TO authenticated',
    'REVOKE ALL ON public.weekly_cycle_progress FROM anon'
  ]::text[]),
  ('20260817200000', 'meta_ads_campanhas', ARRAY[
    '-- Campanhas REAIS do Meta Ads, coletadas sozinhas, sem planilha no meio.
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
-- A conta entra em public.external_accounts com platform ''meta_ads'', junto das
-- de Instagram e Facebook que ja existem: mesmo cadastro, mesma RLS, mesma
-- tela de conexao. external_id guarda o numero da conta, sem o prefixo ''act_''.

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
)',
    '-- Um token ativo por alvo. O COALESCE cobre o token da agencia no mesmo indice:
-- em indice unico, NULO nao conflita com NULO, entao sem ele daria para gravar
-- dois tokens de agencia ativos ao mesmo tempo e nunca se saberia qual valeu.
CREATE UNIQUE INDEX IF NOT EXISTS ads_tokens_alvo_ativo
  ON social_private.ads_tokens (
    COALESCE(external_account_id, ''00000000-0000-0000-0000-000000000000''::uuid)
  )
  WHERE revoked_at IS NULL',
    '-- Resolve o token que vale para a conta: o proprio, se houver; senao o da
-- agencia. Devolve tambem o numero da conta, para montar a URL.
CREATE OR REPLACE FUNCTION social_private.ads_account_token(_external_account_id uuid)
RETURNS TABLE (act_id text, access_token text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''''
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
    AND account.platform = ''meta_ads''
    AND account.external_id IS NOT NULL
  -- O token da conta ganha do token da agencia.
  ORDER BY (token.external_account_id IS NULL)
  LIMIT 1;
$function$',
    '-- ──────────────────────────── 2) A ficha da campanha ─────────────────────────
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
  raw jsonb NOT NULL DEFAULT ''{}''::jsonb,
  UNIQUE (external_account_id, campaign_id)
)',
    'CREATE INDEX IF NOT EXISTS ads_campaigns_client_idx
  ON public.ads_campaigns (client_id, updated_at DESC)',
    'ALTER TABLE public.ads_campaigns ENABLE ROW LEVEL SECURITY',
    'DROP POLICY IF EXISTS ads_campaigns_staff_read ON public.ads_campaigns',
    'CREATE POLICY ads_campaigns_staff_read ON public.ads_campaigns
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) AND public.can_access_client(client_id))',
    'DROP POLICY IF EXISTS ads_campaigns_client_read ON public.ads_campaigns',
    'CREATE POLICY ads_campaigns_client_read ON public.ads_campaigns
  FOR SELECT TO authenticated
  USING (client_id = auth.uid())',
    'REVOKE INSERT, UPDATE, DELETE ON public.ads_campaigns FROM anon, authenticated',
    'GRANT SELECT ON public.ads_campaigns TO authenticated',
    '-- ───────────────────────── 3) Um dia de cada campanha ────────────────────────
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
  actions jsonb NOT NULL DEFAULT ''[]''::jsonb,
  cost_per_action jsonb NOT NULL DEFAULT ''[]''::jsonb,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (external_account_id, campaign_id, day)
)',
    'CREATE INDEX IF NOT EXISTS ads_campaign_daily_client_dia_idx
  ON public.ads_campaign_daily (client_id, day DESC)',
    'CREATE INDEX IF NOT EXISTS ads_campaign_daily_campanha_idx
  ON public.ads_campaign_daily (external_account_id, campaign_id, day DESC)',
    'ALTER TABLE public.ads_campaign_daily ENABLE ROW LEVEL SECURITY',
    'DROP POLICY IF EXISTS ads_campaign_daily_staff_read ON public.ads_campaign_daily',
    'CREATE POLICY ads_campaign_daily_staff_read ON public.ads_campaign_daily
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) AND public.can_access_client(client_id))',
    'DROP POLICY IF EXISTS ads_campaign_daily_client_read ON public.ads_campaign_daily',
    'CREATE POLICY ads_campaign_daily_client_read ON public.ads_campaign_daily
  FOR SELECT TO authenticated
  USING (client_id = auth.uid())',
    'REVOKE INSERT, UPDATE, DELETE ON public.ads_campaign_daily FROM anon, authenticated',
    'GRANT SELECT ON public.ads_campaign_daily TO authenticated',
    '-- ─────────────── 4) Fila de requisicoes (pg_net responde depois) ─────────────
CREATE TABLE IF NOT EXISTS social_private.ads_metrics_requests (
  id bigserial PRIMARY KEY,
  external_account_id uuid NOT NULL,
  client_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN (''account'', ''campaigns'', ''insights'')),
  request_id bigint,
  -- Pagina seguinte da Meta. Guardamos so o cursor, NUNCA a URL pronta: a URL
  -- do ''paging.next'' vem com o token dentro, e token fora do Vault e vazamento.
  after_cursor text,
  since date NOT NULL,
  until date NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
)',
    '-- ───────────────────────────── 5) Montador de URL ────────────────────────────
CREATE OR REPLACE FUNCTION social_private.ads_url(
  _kind text, _act text, _token text, _since date, _until date, _after text
)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''''
AS $function$
  SELECT CASE _kind
    WHEN ''account'' THEN
      ''https://graph.facebook.com/v21.0/act_'' || _act
      || ''?fields=name,currency,account_status,timezone_name''
      || ''&access_token='' || _token
    WHEN ''campaigns'' THEN
      ''https://graph.facebook.com/v21.0/act_'' || _act || ''/campaigns''
      || ''?fields=id,name,status,effective_status,objective,daily_budget''
      || '',lifetime_budget,start_time,stop_time''
      || ''&limit=200''
      || COALESCE(''&after='' || _after, '''')
      || ''&access_token='' || _token
    ELSE
      ''https://graph.facebook.com/v21.0/act_'' || _act || ''/insights''
      || ''?level=campaign&time_increment=1''
      || ''&time_range='' || social_private.autopublish_urlencode(
           ''{"since":"'' || _since::text || ''","until":"'' || _until::text || ''"}'')
      || ''&fields=campaign_id,campaign_name,objective,spend,impressions,reach''
      || '',clicks,inline_link_clicks,ctr,cpc,cpm,frequency,actions''
      || '',cost_per_action_type,date_start''
      || ''&limit=500''
      || COALESCE(''&after='' || _after, '''')
      || ''&access_token='' || _token
  END;
$function$',
    '-- ──────────────────────────────── 6) O tick ──────────────────────────────────
-- Tres fases, igual ao motor do Instagram: colhe o que chegou, redespacha o que
-- ficou sem resposta, e abre coleta nova para as contas que precisam.
CREATE OR REPLACE FUNCTION public.ads_metrics_tick()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''''
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
  _until := (now() AT TIME ZONE ''America/Sao_Paulo'')::date;
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
      IF _req.created_at < now() - interval ''30 minutes'' THEN
        UPDATE social_private.ads_metrics_requests
        SET request_id = NULL, attempts = attempts + 1 WHERE id = _req.id;
      END IF;
      CONTINUE;
    END IF;

    BEGIN
      _body := _content::jsonb;
    EXCEPTION WHEN others THEN
      _body := jsonb_build_object(''parse_error'', left(COALESCE(_content, ''''), 500));
    END;

    IF _status BETWEEN 200 AND 299 AND NOT (_body ? ''error'') THEN
      IF _req.kind = ''account'' THEN
        UPDATE public.external_accounts
        SET display_name = COALESCE(NULLIF(_body->>''name'', ''''), display_name),
            updated_at = now()
        WHERE id = _req.external_account_id;

      ELSIF _req.kind = ''campaigns'' THEN
        FOR _row IN SELECT jsonb_array_elements(COALESCE(_body->''data'', ''[]''::jsonb))
        LOOP
          INSERT INTO public.ads_campaigns AS c (
            client_id, external_account_id, campaign_id, name, status,
            effective_status, objective, daily_budget, lifetime_budget,
            start_time, stop_time, updated_at, raw
          ) VALUES (
            _req.client_id, _req.external_account_id, _row->>''id'',
            _row->>''name'', _row->>''status'', _row->>''effective_status'',
            _row->>''objective'',
            -- A Meta manda verba em centavos; guardamos em reais.
            NULLIF(_row->>''daily_budget'', '''')::numeric / 100,
            NULLIF(_row->>''lifetime_budget'', '''')::numeric / 100,
            NULLIF(_row->>''start_time'', '''')::timestamptz,
            NULLIF(_row->>''stop_time'', '''')::timestamptz,
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
        FOR _row IN SELECT jsonb_array_elements(COALESCE(_body->''data'', ''[]''::jsonb))
        LOOP
          INSERT INTO public.ads_campaign_daily AS d (
            client_id, external_account_id, campaign_id, campaign_name,
            objective, day, spend, impressions, reach, clicks, link_clicks,
            ctr, cpc, cpm, frequency, actions, cost_per_action, captured_at
          ) VALUES (
            _req.client_id, _req.external_account_id,
            _row->>''campaign_id'', _row->>''campaign_name'', _row->>''objective'',
            (_row->>''date_start'')::date,
            NULLIF(_row->>''spend'', '''')::numeric,
            NULLIF(_row->>''impressions'', '''')::bigint,
            NULLIF(_row->>''reach'', '''')::bigint,
            NULLIF(_row->>''clicks'', '''')::bigint,
            NULLIF(_row->>''inline_link_clicks'', '''')::bigint,
            NULLIF(_row->>''ctr'', '''')::numeric,
            NULLIF(_row->>''cpc'', '''')::numeric,
            NULLIF(_row->>''cpm'', '''')::numeric,
            NULLIF(_row->>''frequency'', '''')::numeric,
            COALESCE(_row->''actions'', ''[]''::jsonb),
            COALESCE(_row->''cost_per_action_type'', ''[]''::jsonb),
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
      _after := _body#>>''{paging,cursors,after}'';
      IF _after IS NOT NULL AND (_body#>''{paging,next}'') IS NOT NULL THEN
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
    WHERE account.platform = ''meta_ads''
      AND account.status = ''active''
      AND NOT EXISTS (
        SELECT 1 FROM social_private.ads_metrics_requests AS r
        WHERE r.external_account_id = account.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.ads_campaign_daily AS d
        WHERE d.external_account_id = account.id
          AND d.captured_at > now() - interval ''1 hour''
      )
  LOOP
    SELECT t.act_id, t.access_token INTO _act, _token
    FROM social_private.ads_account_token(_acct.id) AS t;
    IF _token IS NULL THEN CONTINUE; END IF;
    FOREACH _kind IN ARRAY ARRAY[''account'', ''campaigns'', ''insights''] LOOP
      _url := social_private.ads_url(_kind, _act, _token, _since, _until, NULL);
      SELECT net.http_get(url := _url) INTO _rid;
      INSERT INTO social_private.ads_metrics_requests
        (external_account_id, client_id, kind, request_id, since, until)
      VALUES (_acct.id, _acct.client_id, _kind, _rid, _since, _until);
      _dispatched := _dispatched + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    ''since'', _since, ''until'', _until,
    ''dispatched'', _dispatched, ''parsed'', _parsed
  );
END
$function$',
    'REVOKE ALL ON FUNCTION public.ads_metrics_tick() FROM PUBLIC, anon, authenticated',
    '-- ──────────────── 7) Atualizar agora, pela equipe, direto do painel ──────────
CREATE OR REPLACE FUNCTION public.collect_ads_metrics_now()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''''
AS $function$
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION ''somente a equipe pode atualizar as campanhas'';
  END IF;
  RETURN public.ads_metrics_tick();
END
$function$',
    'REVOKE ALL ON FUNCTION public.collect_ads_metrics_now() FROM PUBLIC, anon',
    'GRANT EXECUTE ON FUNCTION public.collect_ads_metrics_now() TO authenticated',
    '-- ─────────────── 8) Guardar o token de anuncios (so administrador) ───────────
-- O token entra pelo painel e vai direto para o Vault. Nunca volta para a tela,
-- nunca aparece em consulta: o painel so mostra que existe e quem salvou.
CREATE OR REPLACE FUNCTION public.save_meta_ads_token(
  _token text,
  _label text DEFAULT ''Token da agência'',
  _external_account_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''''
AS $function$
DECLARE
  _secret_id uuid;
  _id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), ''admin''::public.app_role) THEN
    RAISE EXCEPTION ''somente administrador pode guardar o token de anúncios'';
  END IF;
  IF btrim(COALESCE(_token, '''')) = '''' THEN
    RAISE EXCEPTION ''token vazio'';
  END IF;

  -- Trocar o token e substituir, nao acumular: o anterior fica revogado.
  UPDATE social_private.ads_tokens
  SET revoked_at = now()
  WHERE revoked_at IS NULL
    AND external_account_id IS NOT DISTINCT FROM _external_account_id;

  SELECT vault.create_secret(
    btrim(_token),
    ''meta-ads-'' || gen_random_uuid()::text,
    ''Token de leitura do Meta Ads'',
    NULL
  ) INTO _secret_id;

  INSERT INTO social_private.ads_tokens
    (external_account_id, access_token_secret_id, label, saved_by)
  VALUES (_external_account_id, _secret_id, btrim(_label), auth.uid())
  RETURNING id INTO _id;

  RETURN jsonb_build_object(''id'', _id, ''saved_at'', now());
END
$function$',
    'REVOKE ALL ON FUNCTION public.save_meta_ads_token(text, text, uuid) FROM PUBLIC, anon',
    'GRANT EXECUTE ON FUNCTION public.save_meta_ads_token(text, text, uuid) TO authenticated',
    '-- Situacao da conexao, sem jamais devolver o token.
CREATE OR REPLACE FUNCTION public.meta_ads_connection_status()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''''
AS $function$
DECLARE
  _agencia jsonb;
  _contas jsonb;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION ''somente a equipe pode ver a conexão de anúncios'';
  END IF;

  SELECT to_jsonb(t) INTO _agencia
  FROM (
    SELECT label, saved_at
    FROM social_private.ads_tokens
    WHERE revoked_at IS NULL AND external_account_id IS NULL
    LIMIT 1
  ) AS t;

  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.display_name), ''[]''::jsonb)
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
    WHERE account.platform = ''meta_ads''
      AND public.can_access_client(account.client_id)
  ) AS c;

  RETURN jsonb_build_object(''agencia'', _agencia, ''contas'', _contas);
END
$function$',
    'REVOKE ALL ON FUNCTION public.meta_ads_connection_status() FROM PUBLIC, anon',
    'GRANT EXECUTE ON FUNCTION public.meta_ads_connection_status() TO authenticated',
    '-- ────────────────────────────────── 9) Cron ──────────────────────────────────
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = ''pg_cron'') THEN
    BEGIN
      PERFORM cron.unschedule(''ads-metrics'');
    EXCEPTION WHEN others THEN
      NULL;
    END;
    -- A cada 10 minutos, mas a fase C so abre coleta para conta parada ha mais
    -- de uma hora: na pratica e uma leitura por hora por conta, e os 10 minutos
    -- servem para colher respostas e insistir no que falhou.
    PERFORM cron.schedule(
      ''ads-metrics'',
      ''*/10 * * * *'',
      ''SELECT public.ads_metrics_tick();''
    );
    RAISE NOTICE ''coleta de campanhas agendada (a cada 10 min; cada conta e lida por hora)'';
  ELSE
    RAISE NOTICE ''pg_cron indisponivel: chame public.ads_metrics_tick() por outro agendador'';
  END IF;
END
$cron$'
  ]::text[])
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- Conferência: deve listar 29 linhas.
SELECT version, name FROM supabase_migrations.schema_migrations WHERE version > '20260810150000' ORDER BY version;
