-- Mesa Ads v4, frente E: contas de anúncio, métricas e evolução (25/09/2026).
-- Fonte: docs/mesa-ads/v4/migrations/01_contas_metricas_evolucao.sql (diagnóstico completo no cabeçalho dela).
-- Ficha da conta (saldo, gasto total, limite), token por perfil da Meta, campos novos por anúncio,
-- órfãos da fila, Instagram sem zero falso e sem token no raw, releitura dos posts, leituras de evolução.

-- ───────────── 1) Ficha da conta de anúncio: saldo, gasto total, limite ─────────────

create table if not exists public.ads_account_snapshot (
  external_account_id uuid primary key references public.external_accounts(id) on delete cascade,
  client_id uuid not null references public.profiles(id) on delete cascade,
  currency text,
  -- 1 ativa, 2 desativada, 3 pendência de pagamento, 7 análise de risco,
  -- 8 aguardando acerto, 9 carência, 100/101 encerramento.
  account_status integer,
  disable_reason integer,
  -- Dinheiro em reais (a Meta manda em centavos).
  amount_spent numeric(16, 2),
  balance numeric(16, 2),
  spend_cap numeric(16, 2),
  is_prepay_account boolean,
  timezone_name text,
  funding_display text,
  funding_type text,
  business_name text,
  -- Saldo de conta pré-paga, lido do texto do meio de pagamento.
  saldo_disponivel numeric(16, 2),
  saldo_em timestamptz,
  coletado_em timestamptz,
  tentado_em timestamptz,
  historico_em timestamptz,
  erro text,
  raw jsonb not null default '{}'::jsonb
);

create index if not exists ads_account_snapshot_cliente_idx
  on public.ads_account_snapshot (client_id);

alter table public.ads_account_snapshot enable row level security;

drop policy if exists ads_account_snapshot_staff_read on public.ads_account_snapshot;
create policy ads_account_snapshot_staff_read on public.ads_account_snapshot
  for select to authenticated
  using (public.is_staff(auth.uid()) and public.can_access_client(client_id));

drop policy if exists ads_account_snapshot_client_read on public.ads_account_snapshot;
create policy ads_account_snapshot_client_read on public.ads_account_snapshot
  for select to authenticated
  using (client_id = auth.uid());

revoke insert, update, delete on public.ads_account_snapshot from anon, authenticated;
grant select on public.ads_account_snapshot to authenticated;

-- Saldo de conta pré-paga a partir do texto da Meta
-- ("Saldo disponível (R$ 1.234,56 BRL)"). Sem número, nulo. Mesma regra de
-- saldoDoTexto em supabase/functions/_shared/evolucao.ts.
create or replace function social_private.ads_saldo_do_texto(_t text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  _m text;
begin
  _m := rtrim(substring(coalesce(_t, '') from '(?:R\$|BRL|US\$|\$)\s*([0-9][0-9.,]*)'), '.,');
  if _m is null or _m = '' then
    return null;
  end if;
  if position(',' in _m) > 0
     and (position('.' in _m) = 0 or strpos(reverse(_m), ',') < strpos(reverse(_m), '.')) then
    _m := replace(replace(_m, '.', ''), ',', '.');
  else
    _m := replace(_m, ',', '');
  end if;
  return round(_m::numeric, 2);
exception when others then
  return null;
end;
$fn$;

-- ───────────── 2) Colunas novas: conjunto, objetivo, valor e ROAS por anúncio ─────────────

alter table public.ads_creative_daily
  add column if not exists adset_id text,
  add column if not exists adset_name text,
  add column if not exists campaign_name text,
  add column if not exists objective text,
  add column if not exists optimization_goal text,
  add column if not exists action_values jsonb,
  add column if not exists purchase_roas jsonb;

alter table public.ads_creatives
  add column if not exists adset_name text,
  add column if not exists optimization_goal text,
  add column if not exists instagram_permalink_url text,
  add column if not exists cta_type text;

create index if not exists ads_creative_daily_cliente_anuncio_idx
  on public.ads_creative_daily (client_id, ad_id, day);

-- A fila das campanhas ganha o pedido 'saldo' (meio de pagamento e empresa),
-- separado do 'account' de propósito: se a Meta recusar esse campo por
-- permissão, só o saldo falta; nome, gasto total e limite continuam chegando.
alter table social_private.ads_metrics_requests
  drop constraint if exists ads_metrics_requests_kind_check;
alter table social_private.ads_metrics_requests
  add constraint ads_metrics_requests_kind_check
  check (kind = any (array['account', 'saldo', 'campaigns', 'insights']));

-- ───────────── 3) Um token por perfil da Meta, cada um com as contas que enxerga ─────────────

alter table social_private.ads_tokens
  add column if not exists meta_user_id text,
  add column if not exists contas text[] not null default '{}'::text[];

drop index if exists social_private.ads_tokens_alvo_ativo;
create unique index if not exists ads_tokens_alvo_ativo_por_perfil
  on social_private.ads_tokens (
    coalesce(external_account_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(meta_user_id, '')
  )
  where revoked_at is null;

-- O token que vale para a conta: o próprio da conta; senão o do perfil que
-- ENXERGA aquela conta (lista gravada no login); senão o mais recente.
create or replace function social_private.ads_account_token(_external_account_id uuid)
returns table (act_id text, access_token text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    account.external_id,
    secret_row.decrypted_secret
  from public.external_accounts as account
  join social_private.ads_tokens as token
    on token.revoked_at is null
   and (token.external_account_id = account.id or token.external_account_id is null)
  join vault.decrypted_secrets as secret_row
    on secret_row.id = token.access_token_secret_id
  where account.id = _external_account_id
    and account.platform = 'meta_ads'
    and account.external_id is not null
  order by
    (token.external_account_id is null),
    (not (account.external_id = any (coalesce(token.contas, '{}'::text[])))),
    token.saved_at desc
  limit 1;
$fn$;

/**
 * Guarda o token do login da Meta POR PERFIL, com a lista de contas que ele
 * enxerga. Trocar de perfil não derruba mais o token do outro.
 */
create or replace function public.save_meta_ads_token_from_login(
  _token text,
  _label text,
  _meta_user_id text,
  _contas text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  _secret_id uuid;
  _id uuid;
  _igual uuid;
  _lista text[] := coalesce(_contas, '{}'::text[]);
begin
  if btrim(coalesce(_token, '')) = '' then
    raise exception 'token vazio';
  end if;

  -- Já é exatamente este token, e está ativo? Só atualiza a lista de contas.
  select t.id into _igual
    from social_private.ads_tokens as t
    join vault.decrypted_secrets as s on s.id = t.access_token_secret_id
   where t.revoked_at is null
     and t.external_account_id is null
     and s.decrypted_secret = btrim(_token)
   limit 1;

  if _igual is not null then
    update social_private.ads_tokens
       set contas = case when cardinality(_lista) > 0 then _lista else contas end,
           meta_user_id = coalesce(meta_user_id, _meta_user_id)
     where id = _igual;
    return jsonb_build_object('ok', true, 'mudou', false, 'id', _igual);
  end if;

  -- Substitui só o token do MESMO perfil (ou o legado sem perfil, quando o
  -- login também não diz o perfil).
  update social_private.ads_tokens
     set revoked_at = now()
   where revoked_at is null
     and external_account_id is null
     and coalesce(meta_user_id, '') = coalesce(_meta_user_id, '');

  select vault.create_secret(
    btrim(_token),
    'meta-ads-login-' || gen_random_uuid()::text,
    'Token de leitura do Meta Ads, vindo do login da Meta',
    null
  ) into _secret_id;

  insert into social_private.ads_tokens
    (external_account_id, access_token_secret_id, label, saved_by, meta_user_id, contas)
  values (null, _secret_id, btrim(coalesce(_label, 'Token do login da Meta')), null, _meta_user_id, _lista)
  returning id into _id;

  return jsonb_build_object('ok', true, 'mudou', true, 'id', _id);
end;
$fn$;

revoke execute on function public.save_meta_ads_token_from_login(text, text, text, text[]) from public, anon, authenticated;
grant execute on function public.save_meta_ads_token_from_login(text, text, text, text[]) to service_role;

-- A versão antiga (2 argumentos) continua existindo e passa pela nova.
create or replace function public.save_meta_ads_token_from_login(
  _token text,
  _label text default 'Token do login da Meta'
)
returns jsonb
language sql
security definer
set search_path = ''
as $fn$
  select public.save_meta_ads_token_from_login(_token, _label, null::text, '{}'::text[]);
$fn$;

revoke execute on function public.save_meta_ads_token_from_login(text, text) from public, anon, authenticated;
grant execute on function public.save_meta_ads_token_from_login(text, text) to service_role;

-- Token colado à mão (administrador): substitui só o token manual, nunca os
-- tokens de login de cada perfil.
create or replace function public.save_meta_ads_token(
  _token text,
  _label text default 'Token da agência',
  _external_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  _secret_id uuid;
  _id uuid;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'somente administrador pode guardar o token de anúncios';
  end if;
  if btrim(coalesce(_token, '')) = '' then
    raise exception 'token vazio';
  end if;

  update social_private.ads_tokens
     set revoked_at = now()
   where revoked_at is null
     and meta_user_id is null
     and external_account_id is not distinct from _external_account_id;

  select vault.create_secret(
    btrim(_token),
    'meta-ads-' || gen_random_uuid()::text,
    'Token de leitura do Meta Ads',
    null
  ) into _secret_id;

  insert into social_private.ads_tokens
    (external_account_id, access_token_secret_id, label, saved_by)
  values (_external_account_id, _secret_id, btrim(_label), auth.uid())
  returning id into _id;

  return jsonb_build_object('id', _id, 'saved_at', now());
end;
$fn$;

revoke all on function public.save_meta_ads_token(text, text, uuid) from public, anon;
grant execute on function public.save_meta_ads_token(text, text, uuid) to authenticated;

-- ───────────── 4) O que se pede à Meta (campanhas, conta e saldo) ─────────────

create or replace function social_private.ads_url(
  _kind text, _act text, _token text, _since date, _until date, _after text
)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select case _kind
    when 'account' then
      'https://graph.facebook.com/v21.0/act_' || _act
      || '?fields=name,account_id,currency,account_status,disable_reason'
      || ',amount_spent,balance,spend_cap,is_prepay_account,timezone_name'
      || '&access_token=' || _token
    when 'saldo' then
      'https://graph.facebook.com/v21.0/act_' || _act
      || '?fields=funding_source_details,business{id,name}'
      || '&access_token=' || _token
    when 'campaigns' then
      'https://graph.facebook.com/v21.0/act_' || _act || '/campaigns'
      || '?fields=id,name,status,effective_status,objective,daily_budget'
      || ',lifetime_budget,start_time,stop_time'
      || '&limit=200'
      || coalesce('&after=' || _after, '')
      || '&access_token=' || _token
    else
      'https://graph.facebook.com/v21.0/act_' || _act || '/insights'
      || '?level=campaign&time_increment=1'
      || '&time_range=' || social_private.autopublish_urlencode(
           '{"since":"' || _since::text || '","until":"' || _until::text || '"}')
      || '&fields=campaign_id,campaign_name,objective,spend,impressions,reach'
      || ',clicks,inline_link_clicks,ctr,cpc,cpm,frequency,actions'
      || ',cost_per_action_type,action_values,date_start'
      || '&limit=500'
      || coalesce('&after=' || _after, '')
      || '&access_token=' || _token
  end;
$fn$;

-- ───────────── 5) O que se pede à Meta (anúncios e números por anúncio) ─────────────

create or replace function social_private.ads_creatives_url(
  _kind text, _act text, _token text, _since date, _until date, _after text
)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select case _kind
    when 'pecas' then
      'https://graph.facebook.com/v21.0/act_' || _act || '/ads'
      || '?fields=id,name,status,effective_status,campaign_id,adset_id'
      || ',adset{name,optimization_goal}'
      || ',creative{id,thumbnail_url,image_url,video_id,title,body,object_story_spec'
      || ',instagram_permalink_url,call_to_action_type}'
      || '&limit=100'
      || coalesce('&after=' || _after, '')
      || '&access_token=' || _token
    else
      'https://graph.facebook.com/v21.0/act_' || _act || '/insights'
      || '?level=ad&time_increment=1'
      || '&time_range=' || social_private.autopublish_urlencode(
           '{"since":"' || _since::text || '","until":"' || _until::text || '"}')
      || '&fields=ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name'
      || ',objective,optimization_goal,spend,impressions,reach'
      || ',clicks,inline_link_clicks,ctr,cpc,cpm,frequency,actions'
      || ',cost_per_action_type,action_values,purchase_roas,date_start'
      || '&limit=500'
      || coalesce('&after=' || _after, '')
      || '&access_token=' || _token
  end;
$fn$;


-- ───────────── 6) Motor das campanhas e da ficha da conta (ads_metrics_tick) ─────────────

CREATE OR REPLACE FUNCTION public.ads_metrics_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
  _fs jsonb;
BEGIN
  -- Janela movel de 30 dias, no fuso de Sao Paulo. Cobre o mes corrente e o
  -- pedaco do anterior que ainda serve de comparacao.
  _until := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _since := _until - 29;

  -- Órfãos: pedido que esgotou as tentativas sem requisição no ar prende a
  -- conta para sempre (a fase C pula conta com pedido na fila).
  DELETE FROM social_private.ads_metrics_requests
   WHERE request_id IS NULL AND attempts >= 3;

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

        -- A ficha da conta: moeda, situação, gasto total, saldo a pagar e
        -- limite. A Meta manda dinheiro em centavos; guardamos em reais.
        INSERT INTO public.ads_account_snapshot AS s (
          external_account_id, client_id, currency, account_status,
          disable_reason, amount_spent, balance, spend_cap, is_prepay_account,
          timezone_name, coletado_em, erro, raw
        ) VALUES (
          _req.external_account_id, _req.client_id, _body->>'currency',
          NULLIF(_body->>'account_status', '')::integer,
          NULLIF(_body->>'disable_reason', '')::integer,
          NULLIF(_body->>'amount_spent', '')::numeric / 100,
          NULLIF(_body->>'balance', '')::numeric / 100,
          NULLIF(NULLIF(_body->>'spend_cap', ''), '0')::numeric / 100,
          (_body->>'is_prepay_account')::boolean,
          _body->>'timezone_name', now(), NULL, _body - 'paging'
        )
        ON CONFLICT (external_account_id) DO UPDATE
          SET client_id = EXCLUDED.client_id,
              currency = EXCLUDED.currency,
              account_status = EXCLUDED.account_status,
              disable_reason = EXCLUDED.disable_reason,
              amount_spent = EXCLUDED.amount_spent,
              balance = EXCLUDED.balance,
              spend_cap = EXCLUDED.spend_cap,
              is_prepay_account = EXCLUDED.is_prepay_account,
              timezone_name = EXCLUDED.timezone_name,
              coletado_em = now(),
              erro = NULL,
              raw = s.raw || EXCLUDED.raw;

      ELSIF _req.kind = 'saldo' THEN
        -- Meio de pagamento e saldo de conta pré-paga: o número vem no texto
        -- (display_string) e a leitura dele mora no aplicativo
        -- (supabase/functions/_shared/evolucao.ts, saldoDoTexto).
        _fs := COALESCE(_body->'funding_source_details', '{}'::jsonb);
        UPDATE public.ads_account_snapshot
           SET funding_display = _fs->>'display_string',
               funding_type = _fs->>'type',
               business_name = _body#>>'{business,name}',
               saldo_disponivel = social_private.ads_saldo_do_texto(_fs->>'display_string'),
               saldo_em = now()
         WHERE external_account_id = _req.external_account_id;

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
            ctr, cpc, cpm, frequency, actions, cost_per_action, action_values, captured_at
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
            COALESCE(_row->'cost_per_action_type', '[]'::jsonb), COALESCE(_row->'action_values', '[]'::jsonb),
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
                cost_per_action = EXCLUDED.cost_per_action, action_values = EXCLUDED.action_values,
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
        -- Desiste desta rodada sem travar as outras contas; o erro da Meta
        -- fica na ficha da conta e aparece na tela de conexão.
        UPDATE public.ads_account_snapshot
           SET erro = left(_req.kind || ': ' || COALESCE(
                 (_body#>>'{error,code}') || ' ' || COALESCE(_body#>>'{error,message}', ''),
                 'HTTP ' || COALESCE(_status::text, '?')), 300)
         WHERE external_account_id = _req.external_account_id;
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
      UPDATE public.ads_account_snapshot SET erro = 'sem token de anúncios que alcance esta conta'
       WHERE external_account_id = _req.external_account_id;
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
        SELECT 1 FROM public.ads_account_snapshot AS s
        WHERE s.external_account_id = account.id
          AND s.tentado_em > now() - interval '1 hour'
      )
  LOOP
    SELECT t.act_id, t.access_token INTO _act, _token
    FROM social_private.ads_account_token(_acct.id) AS t;
    IF _token IS NULL THEN
      INSERT INTO public.ads_account_snapshot AS s (external_account_id, client_id, tentado_em, erro)
      VALUES (_acct.id, _acct.client_id, now(), 'sem token de anúncios que alcance esta conta')
      ON CONFLICT (external_account_id) DO UPDATE SET tentado_em = now(), erro = EXCLUDED.erro;
      CONTINUE;
    END IF;
    INSERT INTO public.ads_account_snapshot AS s (external_account_id, client_id, tentado_em)
    VALUES (_acct.id, _acct.client_id, now())
    ON CONFLICT (external_account_id) DO UPDATE SET tentado_em = now(), client_id = EXCLUDED.client_id;
    FOREACH _kind IN ARRAY ARRAY['account', 'saldo', 'campaigns', 'insights'] LOOP
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


-- ───────────── 7) Motor dos criativos (ads_creatives_tick) ─────────────

CREATE OR REPLACE FUNCTION public.ads_creatives_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
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
  _crea jsonb;
  _dispatched integer := 0;
  _parsed integer := 0;
  _since_acct date;
begin
  _until := (now() at time zone 'America/Sao_Paulo')::date;
  _since := _until - 29;

  -- Órfãos: a fase B só redespacha com attempts < 3, a fase A só olha quem
  -- tem requisição no ar. Pedido que esgotou as tentativas ficava parado e
  -- a fase C pulava a conta para sempre (Preserva Eco: parada desde 01/09).
  delete from social_private.ads_creatives_requests
   where request_id is null and attempts >= 3;

  -- ── A) o que já voltou ────────────────────────────────────────────────
  for _req in
    select * from social_private.ads_creatives_requests
     where request_id is not null order by id
  loop
    select r.status_code, r.content into _status, _content
      from net._http_response as r where r.id = _req.request_id;

    if not found then
      -- Resposta perdida: libera para redespacho depois de 30 minutos.
      if _req.created_at < now() - interval '30 minutes' then
        update social_private.ads_creatives_requests
           set request_id = null, attempts = attempts + 1 where id = _req.id;
      end if;
      continue;
    end if;

    begin
      _body := _content::jsonb;
    exception when others then
      _body := jsonb_build_object('parse_error', left(coalesce(_content, ''), 500));
    end;

    if _status between 200 and 299 and not (_body ? 'error') then
      if _req.kind = 'pecas' then
        for _row in select jsonb_array_elements(coalesce(_body -> 'data', '[]'::jsonb))
        loop
          _crea := coalesce(_row -> 'creative', '{}'::jsonb);
          insert into public.ads_creatives as c
            (client_id, external_account_id, ad_id, ad_name, campaign_id, adset_id,
             creative_id, thumbnail_url, image_url, video_id, titulo, corpo,
             status, effective_status, raw,
             adset_name, optimization_goal, instagram_permalink_url, cta_type)
          values (
            _req.client_id, _req.external_account_id,
            _row ->> 'id', _row ->> 'name', _row ->> 'campaign_id', _row ->> 'adset_id',
            _crea ->> 'id', _crea ->> 'thumbnail_url', _crea ->> 'image_url',
            _crea ->> 'video_id', _crea ->> 'title', _crea ->> 'body',
            _row ->> 'status', _row ->> 'effective_status', _row,
            _row #>> '{adset,name}', _row #>> '{adset,optimization_goal}',
            _crea ->> 'instagram_permalink_url',
            _crea ->> 'call_to_action_type'
          )
          on conflict (external_account_id, ad_id) do update set
            ad_name = excluded.ad_name,
            campaign_id = excluded.campaign_id,
            adset_id = excluded.adset_id,
            creative_id = excluded.creative_id,
            -- A miniatura EXPIRA: sobrescrever a cada leitura é o que
            -- mantém a imagem viva na tela.
            thumbnail_url = excluded.thumbnail_url,
            image_url = excluded.image_url,
            video_id = excluded.video_id,
            titulo = coalesce(excluded.titulo, c.titulo),
            corpo = coalesce(excluded.corpo, c.corpo),
            status = excluded.status,
            effective_status = excluded.effective_status,
            updated_at = now(),
            raw = excluded.raw,
            adset_name = coalesce(excluded.adset_name, c.adset_name),
            optimization_goal = coalesce(excluded.optimization_goal, c.optimization_goal),
            instagram_permalink_url = coalesce(excluded.instagram_permalink_url, c.instagram_permalink_url),
            cta_type = coalesce(excluded.cta_type, c.cta_type);
        end loop;
      else
        for _row in select jsonb_array_elements(coalesce(_body -> 'data', '[]'::jsonb))
        loop
          insert into public.ads_creative_daily as d
            (client_id, external_account_id, ad_id, ad_name, campaign_id, day,
             spend, impressions, reach, clicks, link_clicks, ctr, cpc, cpm,
             frequency, actions, cost_per_action,
             adset_id, adset_name, campaign_name, objective, optimization_goal,
             action_values, purchase_roas)
          values (
            _req.client_id, _req.external_account_id,
            _row ->> 'ad_id', _row ->> 'ad_name', _row ->> 'campaign_id',
            (_row ->> 'date_start')::date,
            nullif(_row ->> 'spend', '')::numeric,
            nullif(_row ->> 'impressions', '')::bigint,
            nullif(_row ->> 'reach', '')::bigint,
            nullif(_row ->> 'clicks', '')::bigint,
            nullif(_row ->> 'inline_link_clicks', '')::bigint,
            nullif(_row ->> 'ctr', '')::numeric,
            nullif(_row ->> 'cpc', '')::numeric,
            nullif(_row ->> 'cpm', '')::numeric,
            nullif(_row ->> 'frequency', '')::numeric,
            _row -> 'actions',
            _row -> 'cost_per_action_type',
            _row ->> 'adset_id', _row ->> 'adset_name', _row ->> 'campaign_name',
            _row ->> 'objective', _row ->> 'optimization_goal',
            _row -> 'action_values', _row -> 'purchase_roas'
          )
          on conflict (external_account_id, ad_id, day) do update set
            ad_name = excluded.ad_name,
            campaign_id = excluded.campaign_id,
            spend = excluded.spend,
            impressions = excluded.impressions,
            reach = excluded.reach,
            clicks = excluded.clicks,
            link_clicks = excluded.link_clicks,
            ctr = excluded.ctr,
            cpc = excluded.cpc,
            cpm = excluded.cpm,
            frequency = excluded.frequency,
            actions = excluded.actions,
            cost_per_action = excluded.cost_per_action,
            adset_id = excluded.adset_id,
            adset_name = excluded.adset_name,
            campaign_name = excluded.campaign_name,
            objective = excluded.objective,
            optimization_goal = excluded.optimization_goal,
            action_values = excluded.action_values,
            purchase_roas = excluded.purchase_roas,
            captured_at = now();
        end loop;
      end if;

      _parsed := _parsed + 1;

      -- Paginação: se a Meta disse que há mais, pede a próxima página em
      -- vez de parar na primeira. Sem isto, conta com muitas peças
      -- mostraria só as cem primeiras e ninguém saberia que faltava.
      _after := _body #>> '{paging,cursors,after}';
      if _after is not null and (_body #> '{paging,next}') is not null then
        select t.act_id, t.access_token into _act, _token
          from social_private.ads_account_token(_req.external_account_id) as t;
        if _token is not null then
          _url := social_private.ads_creatives_url(
            _req.kind, _act, _token, _req.since, _req.until, _after);
          select net.http_get(url := _url) into _rid;
          insert into social_private.ads_creatives_requests
            (external_account_id, client_id, kind, request_id, after_cursor, since, until)
          values (_req.external_account_id, _req.client_id, _req.kind, _rid,
                  _after, _req.since, _req.until);
        end if;
      end if;

      delete from social_private.ads_creatives_requests where id = _req.id;
    else
      -- Três tentativas e desiste, para um erro permanente não ficar
      -- ocupando a fila para sempre.
      if _req.attempts >= 3 then
        update public.ads_account_snapshot
           set erro = left(_req.kind || ': ' || coalesce(
                 (_body #>> '{error,code}') || ' ' || coalesce(_body #>> '{error,message}', ''),
                 'HTTP ' || coalesce(_status::text, '?')), 300)
         where external_account_id = _req.external_account_id;
        delete from social_private.ads_creatives_requests where id = _req.id;
      else
        update social_private.ads_creatives_requests
           set request_id = null, attempts = attempts + 1 where id = _req.id;
      end if;
    end if;
  end loop;

  -- ── B) redespacha o que ficou sem resposta ────────────────────────────
  for _req in
    select * from social_private.ads_creatives_requests
     where request_id is null and attempts < 3 order by id limit 50
  loop
    select t.act_id, t.access_token into _act, _token
      from social_private.ads_account_token(_req.external_account_id) as t;
    if _token is null then continue; end if;
    _url := social_private.ads_creatives_url(
      _req.kind, _act, _token, _req.since, _req.until, _req.after_cursor);
    select net.http_get(url := _url) into _rid;
    update social_private.ads_creatives_requests
       set request_id = _rid where id = _req.id;
    _dispatched := _dispatched + 1;
  end loop;

  -- ── C) abre coleta nova para quem está velho ──────────────────────────
  for _acct in
    select account.id, account.client_id
      from public.external_accounts as account
     where account.platform = 'meta_ads'
       and account.status = 'active'
       and not exists (
         select 1 from social_private.ads_creatives_requests as r
          where r.external_account_id = account.id
       )
       and not exists (
         select 1 from public.ads_creatives as c
          where c.external_account_id = account.id
            and c.updated_at > now() - interval '30 minutes'
       )
  loop
    select t.act_id, t.access_token into _act, _token
      from social_private.ads_account_token(_acct.id) as t;
    if _token is null then continue; end if;

    _since_acct := _since;
    if not exists (
      select 1 from public.ads_account_snapshot as s
       where s.external_account_id = _acct.id
         and s.historico_em > now() - interval '1 day'
    ) then
      _since_acct := _until - 89;
      insert into public.ads_account_snapshot as s (external_account_id, client_id, historico_em)
      values (_acct.id, _acct.client_id, now())
      on conflict (external_account_id) do update set historico_em = now();
    end if;
    foreach _kind in array array['pecas', 'numeros'] loop
      _url := social_private.ads_creatives_url(_kind, _act, _token, _since_acct, _until, null);
      select net.http_get(url := _url) into _rid;
      insert into social_private.ads_creatives_requests
        (external_account_id, client_id, kind, request_id, since, until)
      values (_acct.id, _acct.client_id, _kind, _rid, _since_acct, _until);
      _dispatched := _dispatched + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'dispatched', _dispatched, 'parsed', _parsed,
    'since', _since, 'until', _until
  );
end;
$function$;


-- ───────────── 8) Instagram: motor semanal e de posts (social_metrics_tick) ─────────────

CREATE OR REPLACE FUNCTION public.social_metrics_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
           jsonb_build_object('profile', _body - 'paging'))
        ON CONFLICT (external_account_id, week_start) DO UPDATE
          SET followers = EXCLUDED.followers,
              media_count = EXCLUDED.media_count,
              captured_at = now(),
              raw = w.raw || EXCLUDED.raw;
      ELSIF _req.kind = 'reach' THEN
        -- Resposta vazia (dia ainda não fechado) é "sem dado", não zero.
        SELECT SUM(NULLIF(v->>'value', '')::bigint) INTO _sum
        FROM jsonb_array_elements(COALESCE(_body#>'{data,0,values}', '[]'::jsonb)) AS v;
        INSERT INTO public.social_metrics_weekly AS w
          (client_id, external_account_id, week_start, week_end, reach, raw)
        VALUES
          (_req.client_id, _req.external_account_id, _req.week_start, _req.week_end,
           _sum::integer, jsonb_build_object('reach', _body - 'paging'))
        ON CONFLICT (external_account_id, week_start) DO UPDATE
          SET reach = COALESCE(EXCLUDED.reach, w.reach),
              captured_at = now(),
              raw = w.raw || EXCLUDED.raw;
      ELSIF _req.kind = 'posts' THEN
        FOR _item IN
          SELECT value FROM jsonb_array_elements(COALESCE(_body->'data', '[]'::jsonb))
        LOOP
          INSERT INTO public.social_post_metrics AS p
            (client_id, external_account_id, media_id, media_type, caption,
             permalink, media_url, thumbnail_url, posted_at, like_count, comments_count)
          VALUES
            (_req.client_id, _req.external_account_id,
             _item->>'id',
             _item->>'media_type',
             left(COALESCE(_item->>'caption', ''), 500),
             _item->>'permalink',
             _item->>'media_url',
             _item->>'thumbnail_url',
             NULLIF(_item->>'timestamp', '')::timestamptz,
             NULLIF(_item->>'like_count', '')::integer,
             NULLIF(_item->>'comments_count', '')::integer)
          ON CONFLICT (external_account_id, media_id) DO UPDATE
            SET like_count = EXCLUDED.like_count,
                comments_count = EXCLUDED.comments_count,
                caption = EXCLUDED.caption,
                permalink = EXCLUDED.permalink,
                media_type = EXCLUDED.media_type,
                media_url = EXCLUDED.media_url,
                thumbnail_url = EXCLUDED.thumbnail_url,
                posted_at = EXCLUDED.posted_at,
                captured_at = now();
        END LOOP;

        -- A PROXIMA PAGINA.
        --
        -- Sem isto a coleta parava na primeira e a conta ficava congelada
        -- nos posts mais recentes, parecendo completa, porque a resposta
        -- vinha 200 com dados.
        --
        -- O teto de 40 paginas existe para uma conta com anos de historico
        -- nao prender a fila; a 4000 posts por varredura, ninguem real
        -- esbarra nele, e quem esbarrar aparece na fila em vez de sumir.
        IF COALESCE(_body#>>'{paging,cursors,after}', '') <> ''
           AND jsonb_array_length(COALESCE(_body->'data', '[]'::jsonb)) > 0
           AND COALESCE(_req.page_no, 1) < 40 THEN
          INSERT INTO social_private.social_metrics_requests
            (external_account_id, client_id, kind, week_start, week_end,
             after_cursor, page_no)
          VALUES (_req.external_account_id, _req.client_id, 'posts',
                  _req.week_start, _req.week_end,
                  _body#>>'{paging,cursors,after}', COALESCE(_req.page_no, 1) + 1);
        END IF;
      ELSIF _req.kind = 'identity' THEN
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
      ELSIF _req.kind = 'post_insights' THEN
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
           jsonb_build_object('engage', _body - 'paging'))
        ON CONFLICT (external_account_id, week_start) DO UPDATE
          SET profile_views = COALESCE(EXCLUDED.profile_views, w.profile_views),
              accounts_engaged = COALESCE(EXCLUDED.accounts_engaged, w.accounts_engaged),
              total_interactions = COALESCE(EXCLUDED.total_interactions, w.total_interactions),
              captured_at = now(),
              raw = w.raw || EXCLUDED.raw;
      END IF;
      _parsed := _parsed + 1;
      DELETE FROM social_private.social_metrics_requests WHERE id = _req.id;
    ELSE
      IF _req.attempts >= 3 THEN
        IF _req.kind = 'post_insights' THEN
          UPDATE public.social_post_metrics
          SET insights_captured_at = now()
          WHERE external_account_id = _req.external_account_id
            AND media_id = _req.media_id;
        END IF;
        IF _req.kind NOT IN ('posts', 'post_insights', 'identity') THEN
          INSERT INTO public.social_metrics_weekly AS w
            (client_id, external_account_id, week_start, week_end, raw)
          VALUES
            (_req.client_id, _req.external_account_id, _req.week_start, _req.week_end,
             jsonb_build_object('error_' || _req.kind, _body - 'paging'))
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
      _req.kind,
      CASE WHEN _req.kind = 'post_insights' THEN _req.media_id ELSE _token_resource END,
      _token_secret, _req.week_start, _req.week_end, _req.after_cursor);
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
        WHERE r.external_account_id = account.id
          AND r.week_start = _week_start
          AND r.kind <> 'posts'
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

  -- D) Publicacoes: atualiza a cada 3 dias por conta
  FOR _acct IN
    SELECT account.id, account.client_id
    FROM public.external_accounts AS account
    WHERE account.platform = 'instagram'
      AND account.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM public.social_post_metrics AS p
        WHERE p.external_account_id = account.id
          AND p.captured_at > now() - interval '30 minutes'
      )
      AND NOT EXISTS (
        SELECT 1 FROM social_private.social_metrics_requests AS r
        WHERE r.external_account_id = account.id AND r.kind = 'posts'
      )
  LOOP
    SELECT t.resource_id, t.access_token INTO _token_resource, _token_secret
    FROM social_private.autopublish_account_token(_acct.id) AS t;
    IF _token_secret IS NULL THEN CONTINUE; END IF;
    _url := social_private.social_metrics_url(
      'posts', _token_resource, _token_secret, _week_start, _week_end);
    SELECT net.http_get(url := _url) INTO _rid;
    INSERT INTO social_private.social_metrics_requests
      (external_account_id, client_id, kind, request_id, week_start, week_end)
    VALUES (_acct.id, _acct.client_id, 'posts', _rid, _week_start, _week_end);
    _dispatched := _dispatched + 1;
  END LOOP;

  FOR _req IN
    SELECT p.external_account_id, p.client_id, p.media_id
    FROM public.social_post_metrics AS p
    WHERE p.posted_at > now() - interval '90 days'
      AND (
        p.insights_captured_at IS NULL
        OR (p.posted_at > now() - interval '7 days' AND p.insights_captured_at < now() - interval '6 hours')
        OR (p.posted_at > now() - interval '30 days' AND p.insights_captured_at < now() - interval '24 hours')
        OR p.insights_captured_at < now() - interval '7 days'
      )
      AND EXISTS (
        SELECT 1 FROM public.external_accounts AS a
        WHERE a.id = p.external_account_id AND a.status = 'active'
      )
      AND NOT EXISTS (
        SELECT 1 FROM social_private.social_metrics_requests AS r
        WHERE r.kind = 'post_insights' AND r.media_id = p.media_id
      )
    ORDER BY (p.insights_captured_at IS NULL) DESC, p.posted_at DESC
    LIMIT 20
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

  FOR _acct IN
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
    'week_start', _week_start,
    'dispatched', _dispatched,
    'parsed', _parsed
  );
END
$function$;


-- ───────────── 9) Instagram: retrato da semana corrente ─────────────

CREATE OR REPLACE FUNCTION public.social_retrato_da_semana_corrente()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _inicio date;
  _fim date;
  _acct record;
  _fim_consulta date;
  _ig text;
  _token text;
  _url text;
  _rid bigint;
  _kind text;
  _idade interval;
  _despachados integer := 0;
begin
  -- A semana CORRENTE, nao a anterior. E aqui que mora a diferenca.
  _inicio := date_trunc(
    'week', (now() at time zone 'America/Sao_Paulo')::date::timestamp
  )::date;
  _fim := _inicio + 6;

  -- A semana corrente ainda nao acabou, entao o fim dela esta no FUTURO.
  -- Pedir insight com `until` no futuro e pedir dado que nao existe: o
  -- Graph recusa, o pedido gasta as tres tentativas e a linha termina com
  -- erro gravado. Para a CONSULTA, o fim e hoje; para o REGISTRO, o fim
  -- continua sendo o domingo, senao a linha mentiria sobre que semana e.
  -- O dia de hoje ainda não fechou: a Meta devolve lista vazia quando o
  -- `until` passa de agora, e isso virava alcance 0 na tela. Consulta até
  -- ontem (o `until` do Graph é exclusivo: vira hoje).
  _fim_consulta := least(_fim, (now() at time zone 'America/Sao_Paulo')::date - 1);

  for _acct in
    select account.id, account.client_id
      from public.external_accounts as account
     where account.platform = 'instagram'
       and account.status = 'active'
  loop
    select t.resource_id, t.access_token into _ig, _token
      from social_private.autopublish_account_token(_acct.id) as t;
    -- Conta sem token nao e erro: e conta que ainda nao foi conectada.
    if _token is null then continue; end if;

    select now() - w.captured_at into _idade
      from public.social_metrics_weekly as w
     where w.external_account_id = _acct.id and w.week_start = _inicio;

    foreach _kind in array array['profile', 'reach', 'engage'] loop
      -- Nunca dois pedidos iguais em voo para a mesma conta e semana.
      if exists (
        select 1 from social_private.social_metrics_requests as r
         where r.external_account_id = _acct.id
           and r.week_start = _inicio
           and r.kind = _kind
      ) then
        continue;
      end if;

      -- Sem linha ainda: busca tudo. Com linha: so o que venceu.
      -- Segunda-feira: a semana ainda não tem dia fechado; só o perfil.
      if _kind <> 'profile' and _fim_consulta < _inicio then continue; end if;

      if _idade is not null then
        if _kind = 'profile' and _idade < interval '30 minutes' then continue; end if;
        if _kind <> 'profile' and _idade < interval '3 hours' then continue; end if;
      end if;

      _url := social_private.social_metrics_url(_kind, _ig, _token, _inicio, _fim_consulta);
      select net.http_get(url := _url) into _rid;
      insert into social_private.social_metrics_requests
        (external_account_id, client_id, kind, request_id, week_start, week_end)
      values (_acct.id, _acct.client_id, _kind, _rid, _inicio, _fim);
      _despachados := _despachados + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'despachados', _despachados,
    'semana', _inicio,
    'em', now()
  );
end;
$function$;


-- ───────────── 10) Situação da conexão com saldo e última leitura de verdade ─────────────
-- "Lida em" passa a ser a última leitura da CONTA (ficha), não a última
-- linha diária de campanha: conta sem gasto também é conta lida.
create or replace function public.meta_ads_connection_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  _agencia jsonb;
  _perfis jsonb;
  _contas jsonb;
begin
  if not public.is_staff(auth.uid()) then
    raise exception 'somente a equipe pode ver a conexão de anúncios';
  end if;

  select to_jsonb(t) into _agencia
  from (
    select label, saved_at
      from social_private.ads_tokens
     where revoked_at is null and external_account_id is null
     order by saved_at desc
     limit 1
  ) as t;

  select coalesce(jsonb_agg(jsonb_build_object(
           'label', t.label, 'saved_at', t.saved_at, 'contas', cardinality(t.contas)
         ) order by t.saved_at desc), '[]'::jsonb)
    into _perfis
    from social_private.ads_tokens as t
   where t.revoked_at is null and t.external_account_id is null;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.display_name), '[]'::jsonb)
  into _contas
  from (
    select
      account.id,
      account.client_id,
      account.display_name,
      account.external_id,
      account.status,
      exists (
        select 1 from social_private.ads_tokens as token
         where token.revoked_at is null
           and token.external_account_id = account.id
      ) as token_proprio,
      greatest(
        snap.coletado_em,
        (select max(d.captured_at) from public.ads_campaign_daily as d
          where d.external_account_id = account.id)
      ) as ultima_coleta,
      snap.currency as moeda,
      snap.account_status,
      snap.amount_spent as gasto_total,
      snap.saldo_disponivel,
      snap.spend_cap as limite_de_gasto,
      snap.funding_display as pagamento,
      snap.erro
    from public.external_accounts as account
    left join public.ads_account_snapshot as snap on snap.external_account_id = account.id
    where account.platform = 'meta_ads'
      and public.can_access_client(account.client_id)
  ) as c;

  return jsonb_build_object('agencia', _agencia, 'perfis', _perfis, 'contas', _contas);
end;
$fn$;

revoke all on function public.meta_ads_connection_status() from public, anon;
grant execute on function public.meta_ads_connection_status() to authenticated;

-- ───────────── 11) Leituras de evolução (histórico do que a Mesa concluiu) ─────────────
-- Os aprendizados em si vão para agente_memoria (origem 'metrica'), que os
-- agentes já leem; aqui fica a leitura inteira, para comparar semana a semana.
create table if not exists public.evolucao_leituras (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id) on delete cascade,
  periodo_inicio date not null,
  periodo_fim date not null,
  leitura jsonb not null default '{}'::jsonb,
  explicacao jsonb,
  memorias_gravadas integer not null default 0,
  custo_usd numeric not null default 0,
  criado_por uuid references public.profiles(id) on delete set null,
  criado_em timestamptz not null default now()
);

create index if not exists evolucao_leituras_cliente_idx
  on public.evolucao_leituras (client_id, criado_em desc);

alter table public.evolucao_leituras enable row level security;

drop policy if exists evolucao_leituras_staff_read on public.evolucao_leituras;
create policy evolucao_leituras_staff_read on public.evolucao_leituras
  for select to authenticated
  using (public.is_staff(auth.uid()) and public.can_access_client(client_id));

revoke insert, update, delete on public.evolucao_leituras from anon, authenticated;
grant select on public.evolucao_leituras to authenticated;

-- ───────────── 12) Limpeza dos dados que já estão errados ─────────────

-- Tira o token da página que estava em raw (paging.previous / paging.next).
update public.social_metrics_weekly as w
   set raw = (
     select coalesce(jsonb_object_agg(k, case when jsonb_typeof(v) = 'object' then v - 'paging' else v end), '{}'::jsonb)
       from jsonb_each(w.raw) as e(k, v)
   )
 where w.raw::text like '%access_token=%';

-- Alcance 0 que era "resposta vazia" volta a ser "sem dado".
update public.social_metrics_weekly as w
   set reach = null
 where w.reach = 0
   and jsonb_typeof(w.raw #> '{reach,data}') = 'array'
   and jsonb_array_length(w.raw #> '{reach,data}') = 0;

-- Pedidos órfãos das duas filas de anúncio (a Preserva Eco volta a ser lida).
delete from social_private.ads_creatives_requests where request_id is null and attempts >= 3;
delete from social_private.ads_metrics_requests where request_id is null and attempts >= 3;

-- Posts cujo mergulho foi feito na primeira hora: entram de novo na fila.
update public.social_post_metrics
   set insights_captured_at = null
 where posted_at > now() - interval '90 days'
   and insights_captured_at is not null
   and insights_captured_at - posted_at < interval '2 days';