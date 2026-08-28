-- Criativos: a peça que faltava para o painel falar de anúncio de verdade.
--
-- O PEDIDO: miniaturas dos criativos, abrir em tela grande, desempenho de
-- cada um, leitura completa, e o MCP conseguindo ler tudo isso.
--
-- O QUE EXISTIA: só CAMPANHA. As tabelas ads_campaigns e
-- ads_campaign_daily guardam o agregado, e a Graph era consultada com
-- `level=campaign`. Nesse nível não existe imagem, não existe nome de
-- peça, não existe "qual anúncio performou melhor" — existe só a soma.
-- Nenhuma tela conseguiria mostrar miniatura a partir disso, por melhor
-- que fosse escrita: o dado não estava lá.
--
-- FILA PRÓPRIA, e isto é deliberado: a coleta de campanhas funciona e o
-- dono depende dela hoje. Enfiar dois tipos novos na fila que
-- ads_metrics_tick varre significaria mexer numa função grande que está de
-- pé, e a fase que colhe respostas trata o que não reconhece de um jeito
-- que eu teria de auditar inteiro. Fila separada custa uma tabela e
-- garante que, se o lado novo falhar, o lado que já funciona nem fica
-- sabendo.
--
-- Rodar de novo não faz mal.

-- ─────────────────────── 1) A peça e o seu retrato ───────────────────────

create table if not exists public.ads_creatives (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id) on delete cascade,
  external_account_id uuid not null references public.external_accounts(id) on delete cascade,
  ad_id text not null,
  ad_name text,
  campaign_id text,
  adset_id text,
  creative_id text,
  -- O endereço da miniatura vem da Meta e EXPIRA. Guardar a imagem em si
  -- seria copiar arte de cliente para o nosso armazenamento sem ninguém
  -- ter pedido; guardar o endereço e recolher de novo a cada leitura é o
  -- que mantém a tela viva sem virar depósito de material alheio.
  thumbnail_url text,
  image_url text,
  video_id text,
  titulo text,
  corpo text,
  destino text,
  status text,
  effective_status text,
  updated_at timestamptz not null default now(),
  raw jsonb not null default '{}'::jsonb,
  unique (external_account_id, ad_id)
);

create index if not exists ads_creatives_cliente_idx
  on public.ads_creatives (client_id, updated_at desc);
create index if not exists ads_creatives_campanha_idx
  on public.ads_creatives (campaign_id);

create table if not exists public.ads_creative_daily (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id) on delete cascade,
  external_account_id uuid not null references public.external_accounts(id) on delete cascade,
  ad_id text not null,
  ad_name text,
  campaign_id text,
  day date not null,
  spend numeric(14, 2),
  impressions bigint,
  reach bigint,
  clicks bigint,
  link_clicks bigint,
  ctr numeric(10, 4),
  cpc numeric(12, 4),
  cpm numeric(12, 4),
  frequency numeric(10, 4),
  actions jsonb,
  cost_per_action jsonb,
  captured_at timestamptz not null default now(),
  unique (external_account_id, ad_id, day)
);

create index if not exists ads_creative_daily_cliente_dia_idx
  on public.ads_creative_daily (client_id, day desc);

alter table public.ads_creatives enable row level security;
alter table public.ads_creative_daily enable row level security;

-- A MESMA régua das campanhas, copiada e não inventada: duas políticas
-- separadas, e a da equipe passa por can_access_client. Minha primeira
-- versão deixava qualquer pessoa da equipe ver qualquer cliente, o que é
-- mais frouxo do que o resto do painel: designer alocado num cliente não
-- tem por que ver o investimento de outro.
do $rls$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'ads_creatives'
       and policyname = 'ads_creatives_client_read'
  ) then
    create policy ads_creatives_client_read on public.ads_creatives
      for select using (client_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'ads_creatives'
       and policyname = 'ads_creatives_staff_read'
  ) then
    create policy ads_creatives_staff_read on public.ads_creatives
      for select using (
        public.is_staff(auth.uid()) and public.can_access_client(client_id)
      );
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'ads_creative_daily'
       and policyname = 'ads_creative_daily_client_read'
  ) then
    create policy ads_creative_daily_client_read on public.ads_creative_daily
      for select using (client_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'ads_creative_daily'
       and policyname = 'ads_creative_daily_staff_read'
  ) then
    create policy ads_creative_daily_staff_read on public.ads_creative_daily
      for select using (
        public.is_staff(auth.uid()) and public.can_access_client(client_id)
      );
  end if;
end
$rls$;

-- ────────────────────────── 2) A fila separada ───────────────────────────

create table if not exists social_private.ads_creatives_requests (
  id bigserial primary key,
  external_account_id uuid not null,
  client_id uuid not null,
  kind text not null,
  request_id bigint,
  after_cursor text,
  since date,
  until date,
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);

alter table social_private.ads_creatives_requests enable row level security;

create index if not exists ads_creatives_requests_voo_idx
  on social_private.ads_creatives_requests (request_id)
  where request_id is not null;

/**
 * As duas consultas que trazem criativo, e o que cada uma faz.
 *
 *   'pecas'   — a ficha do anúncio: nome, estado e o criativo com a
 *               miniatura. É daqui que sai a imagem da tela.
 *   'numeros' — insights com level=ad, um por dia. É o que permite dizer
 *               qual PEÇA performou, e não apenas qual campanha.
 */
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
      || ',creative{id,thumbnail_url,image_url,video_id,title,body,object_story_spec}'
      || '&limit=100'
      || coalesce('&after=' || _after, '')
      || '&access_token=' || _token
    else
      'https://graph.facebook.com/v21.0/act_' || _act || '/insights'
      || '?level=ad&time_increment=1'
      || '&time_range=' || social_private.autopublish_urlencode(
           '{"since":"' || _since::text || '","until":"' || _until::text || '"}')
      || '&fields=ad_id,ad_name,campaign_id,spend,impressions,reach'
      || ',clicks,inline_link_clicks,ctr,cpc,cpm,frequency,actions'
      || ',cost_per_action_type,date_start'
      || '&limit=500'
      || coalesce('&after=' || _after, '')
      || '&access_token=' || _token
  end;
$fn$;

-- ───────────────────────────── 3) O motor ────────────────────────────────

/**
 * Colhe criativos e o desempenho de cada um.
 *
 * Três fases, iguais às do motor de campanhas: recolhe o que voltou,
 * redespacha o que se perdeu, e abre pedido novo para quem está velho.
 *
 * A janela é de 30 dias, como a das campanhas — comparar peça de hoje com
 * a de três semanas atrás é metade do trabalho de quem cuida de tráfego.
 */
create or replace function public.ads_creatives_tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
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
begin
  _until := (now() at time zone 'America/Sao_Paulo')::date;
  _since := _until - 29;

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
             status, effective_status, raw)
          values (
            _req.client_id, _req.external_account_id,
            _row ->> 'id', _row ->> 'name', _row ->> 'campaign_id', _row ->> 'adset_id',
            _crea ->> 'id', _crea ->> 'thumbnail_url', _crea ->> 'image_url',
            _crea ->> 'video_id', _crea ->> 'title', _crea ->> 'body',
            _row ->> 'status', _row ->> 'effective_status', _row
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
            raw = excluded.raw;
        end loop;
      else
        for _row in select jsonb_array_elements(coalesce(_body -> 'data', '[]'::jsonb))
        loop
          insert into public.ads_creative_daily as d
            (client_id, external_account_id, ad_id, ad_name, campaign_id, day,
             spend, impressions, reach, clicks, link_clicks, ctr, cpc, cpm,
             frequency, actions, cost_per_action)
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
            _row -> 'cost_per_action_type'
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

    foreach _kind in array array['pecas', 'numeros'] loop
      _url := social_private.ads_creatives_url(_kind, _act, _token, _since, _until, null);
      select net.http_get(url := _url) into _rid;
      insert into social_private.ads_creatives_requests
        (external_account_id, client_id, kind, request_id, since, until)
      values (_acct.id, _acct.client_id, _kind, _rid, _since, _until);
      _dispatched := _dispatched + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'dispatched', _dispatched, 'parsed', _parsed,
    'since', _since, 'until', _until
  );
end;
$fn$;

revoke execute on function public.ads_creatives_tick() from anon, authenticated;
grant execute on function public.ads_creatives_tick() to service_role;

/**
 * Atualizar agora, para campanhas E criativos, de uma vez.
 *
 * Duas passadas: a primeira despacha, a segunda lê o que já voltou. Um
 * botão que dispara e responde "0 lidos" parece que não fez nada.
 */
create or replace function public.collect_ads_now()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  _c1 jsonb; _p1 jsonb; _c2 jsonb; _p2 jsonb;
begin
  if not public.is_staff(auth.uid()) then
    raise exception 'somente a equipe pode atualizar os anuncios';
  end if;

  _c1 := public.ads_metrics_tick();
  _p1 := public.ads_creatives_tick();
  perform pg_sleep(2);
  _c2 := public.ads_metrics_tick();
  _p2 := public.ads_creatives_tick();

  return jsonb_build_object(
    'campanhas', jsonb_build_object(
      'dispatched', coalesce((_c1 ->> 'dispatched')::int, 0) + coalesce((_c2 ->> 'dispatched')::int, 0),
      'parsed', coalesce((_c1 ->> 'parsed')::int, 0) + coalesce((_c2 ->> 'parsed')::int, 0)
    ),
    'criativos', jsonb_build_object(
      'dispatched', coalesce((_p1 ->> 'dispatched')::int, 0) + coalesce((_p2 ->> 'dispatched')::int, 0),
      'parsed', coalesce((_p1 ->> 'parsed')::int, 0) + coalesce((_p2 ->> 'parsed')::int, 0)
    )
  );
end;
$fn$;

revoke execute on function public.collect_ads_now() from anon;
grant execute on function public.collect_ads_now() to authenticated;

-- O cron de anúncios passa a colher os dois. De 10 em 10 minutos, como
-- antes: quem manda no relógio dos números é a Meta, e perguntar mais
-- vezes só gasta cota.
do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('ads-metrics')
      where exists (select 1 from cron.job where jobname = 'ads-metrics');
    perform cron.schedule(
      'ads-metrics', '*/10 * * * *',
      $job$SELECT public.ads_metrics_tick(), public.ads_creatives_tick();$job$
    );
  end if;
end
$cron$;
