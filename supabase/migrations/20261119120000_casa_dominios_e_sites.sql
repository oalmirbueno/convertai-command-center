-- Central de domínios e sites da casa (19/11/2026, pedido do dono).
--
-- "Administrar domínios e sites dos clientes num lugar só, fácil, e ganhar margem": domínio
-- gerenciado (Registro.br com o cliente como titular e a Aceleriq como contato, DNS na Cloudflare da
-- Aceleriq) e hospedagem dos sites publicados na Cloudflare.
--
-- O que entra (só acréscimo, idempotente):
--   1. casa_dominios: um domínio por linha, com registrador, nameservers, zona na Cloudflare da casa,
--      vencimento (RDAP ou anotado), conferência do e-mail (MX, SPF, DKIM, DMARC), custo e preço.
--   2. casa_sites: um site por linha (Worker, Pages ou cadastro manual), com endereço, domínio ligado,
--      resposta (200, SSL), última publicação, custo e preço.
--   3. Leitura só pela casa (produto_email_pela_casa); escrita só por RPC security definer.
--   4. casa_dominios_sites_central(): a leitura da tela, numa chamada. Domínios do e-mail que ainda
--      não estão cadastrados aparecem também (sem id), para nada ficar de fora.
--   5. casa_dominios_sites_gravar_leitura(): a função casa-dominios grava o que leu na Cloudflare, no
--      RDAP, no DNS público e nos sites. Só a chave de serviço. O que é da casa (cliente, preço, custo,
--      observação) nunca é sobrescrito pela leitura.
-- O token da Cloudflare mora só no segredo da função (CLOUDFLARE_API_TOKEN), nunca no banco.

-- ---------------------------------------------------------------------------
-- 1. Domínios
-- ---------------------------------------------------------------------------
create table if not exists public.casa_dominios (
  id uuid primary key default gen_random_uuid(),
  dominio text not null,
  client_id uuid references public.profiles(id) on delete set null,
  conta_id uuid references public.produto_contas(id) on delete set null,
  origem text not null default 'manual',
  registrador text,
  titular text,
  nameservers text[] not null default '{}',
  cloudflare_zona_id text,
  cloudflare_status text,
  na_cloudflare_da_casa boolean not null default false,
  vence_em date,
  vencimento_fonte text,
  rdap_lido_em timestamptz,
  rdap_erro text,
  dns_email jsonb,
  dns_conferido_em timestamptz,
  custo_valor numeric(10, 2),
  custo_periodo text not null default 'anual',
  preco_valor numeric(10, 2),
  preco_periodo text not null default 'mensal',
  observacao text,
  arquivado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create unique index if not exists casa_dominios_por_nome on public.casa_dominios (dominio);
create index if not exists casa_dominios_por_cliente on public.casa_dominios (client_id) where client_id is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'casa_dominios_nome_check') then
    alter table public.casa_dominios add constraint casa_dominios_nome_check
      check (dominio = lower(dominio) and dominio ~ '^([a-z0-9-]+\.)+[a-z]{2,}$' and length(dominio) <= 253);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'casa_dominios_origem_check') then
    alter table public.casa_dominios add constraint casa_dominios_origem_check check (origem in ('manual', 'cloudflare', 'email'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'casa_dominios_periodos_check') then
    alter table public.casa_dominios add constraint casa_dominios_periodos_check
      check (custo_periodo in ('mensal', 'anual') and preco_periodo in ('mensal', 'anual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'casa_dominios_valores_check') then
    alter table public.casa_dominios add constraint casa_dominios_valores_check
      check ((custo_valor is null or custo_valor >= 0) and (preco_valor is null or preco_valor >= 0));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'casa_dominios_fonte_check') then
    alter table public.casa_dominios add constraint casa_dominios_fonte_check
      check (vencimento_fonte is null or vencimento_fonte in ('rdap', 'manual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'casa_dominios_tamanho_check') then
    alter table public.casa_dominios add constraint casa_dominios_tamanho_check
      check (pg_column_size(dns_email) < 30000 and coalesce(length(observacao), 0) <= 1500);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Sites
-- ---------------------------------------------------------------------------
create table if not exists public.casa_sites (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  endereco text,
  client_id uuid references public.profiles(id) on delete set null,
  conta_id uuid references public.produto_contas(id) on delete set null,
  dominio_id uuid references public.casa_dominios(id) on delete set null,
  origem text not null default 'manual',
  cf_tipo text,
  cf_nome text,
  hospedagem text,
  dominios_personalizados text[] not null default '{}',
  ultima_publicacao timestamptz,
  http_status integer,
  ssl_ok boolean,
  resposta_ms integer,
  erro text,
  conferido_em timestamptz,
  custo_valor numeric(10, 2),
  custo_periodo text not null default 'mensal',
  preco_valor numeric(10, 2),
  preco_periodo text not null default 'mensal',
  observacao text,
  arquivado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create unique index if not exists casa_sites_por_cloudflare on public.casa_sites (cf_tipo, cf_nome) where cf_tipo is not null;
create index if not exists casa_sites_por_cliente on public.casa_sites (client_id) where client_id is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'casa_sites_origem_check') then
    alter table public.casa_sites add constraint casa_sites_origem_check check (origem in ('manual', 'cloudflare'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'casa_sites_tipo_check') then
    alter table public.casa_sites add constraint casa_sites_tipo_check
      check ((cf_tipo is null and cf_nome is null) or (cf_tipo in ('worker', 'pages') and cf_nome is not null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'casa_sites_periodos_check') then
    alter table public.casa_sites add constraint casa_sites_periodos_check
      check (custo_periodo in ('mensal', 'anual') and preco_periodo in ('mensal', 'anual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'casa_sites_valores_check') then
    alter table public.casa_sites add constraint casa_sites_valores_check
      check ((custo_valor is null or custo_valor >= 0) and (preco_valor is null or preco_valor >= 0));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'casa_sites_endereco_check') then
    alter table public.casa_sites add constraint casa_sites_endereco_check
      check (endereco is null or (endereco = lower(endereco) and endereco ~ '^([a-z0-9-]+\.)+[a-z]{2,}(/[^\s]*)?$'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'casa_sites_tamanho_check') then
    alter table public.casa_sites add constraint casa_sites_tamanho_check
      check (length(nome) between 1 and 160 and coalesce(length(observacao), 0) <= 1500 and coalesce(length(erro), 0) <= 300);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Quem lê: só a casa. Escrita só pelas funções abaixo.
-- ---------------------------------------------------------------------------
alter table public.casa_dominios enable row level security;
alter table public.casa_sites enable row level security;

drop policy if exists casa_dominios_leitura on public.casa_dominios;
create policy casa_dominios_leitura on public.casa_dominios for select to authenticated using (public.produto_dono());
drop policy if exists casa_sites_leitura on public.casa_sites;
create policy casa_sites_leitura on public.casa_sites for select to authenticated using (public.produto_dono());

revoke all on public.casa_dominios from anon, authenticated;
revoke all on public.casa_sites from anon, authenticated;
grant select on public.casa_dominios to authenticated;
grant select on public.casa_sites to authenticated;
grant all on public.casa_dominios to service_role;
grant all on public.casa_sites to service_role;

-- Texto curto ou nulo. Valor em reais ou nulo (vírgula vira ponto).
create or replace function public.casa_texto(_v text, _max integer)
returns text
language sql
immutable
set search_path = ''
as $$ select nullif(left(btrim(coalesce(_v, '')), _max), '') $$;

create or replace function public.casa_valor(_v text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  _t text := replace(btrim(coalesce(_v, '')), ',', '.');
begin
  if _t = '' then
    return null;
  end if;
  if _t !~ '^\d{1,7}(\.\d{1,2})?$' then
    raise exception 'Valor inválido: use reais, como 39,90.' using errcode = 'P0001';
  end if;
  return _t::numeric;
end;
$$;

-- O endereço do site sem protocolo, em minúsculas e sem barra no fim.
create or replace function public.casa_host(_v text)
returns text
language sql
immutable
set search_path = ''
as $$ select nullif(regexp_replace(regexp_replace(lower(btrim(coalesce(_v, ''))), '^https?://', ''), '/+$', ''), '') $$;

revoke all on function public.casa_texto(text, integer) from public, anon;
revoke all on function public.casa_valor(text) from public, anon;
revoke all on function public.casa_host(text) from public, anon;
grant execute on function public.casa_texto(text, integer) to authenticated, service_role;
grant execute on function public.casa_valor(text) to authenticated, service_role;
grant execute on function public.casa_host(text) to authenticated, service_role;

-- Cliente escolhido na tela: "c:<id do cliente>" (cliente da Aceleriq) ou "p:<id da empresa do produto>".
create or replace function public.casa_conferir_dono(_client uuid, _conta uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if _client is not null and not exists (select 1 from public.profiles p where p.id = _client) then
    raise exception 'O cliente não foi encontrado.' using errcode = 'P0001';
  end if;
  if _conta is not null and not exists (select 1 from public.produto_contas c where c.id = _conta) then
    raise exception 'A empresa não foi encontrada.' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.casa_conferir_dono(uuid, uuid) from public, anon, authenticated;
grant execute on function public.casa_conferir_dono(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Cadastro e edição pela casa
-- ---------------------------------------------------------------------------
-- _id nulo cria (ou reaproveita o domínio de mesmo nome). Só mexe nos campos que vierem em _dados.
create or replace function public.casa_dominio_salvar(_id uuid, _dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _d public.casa_dominios;
  _nome text;
  _client uuid;
  _conta uuid;
begin
  if not public.produto_email_pela_casa() then
    raise exception 'Só a administração da Aceleriq.' using errcode = '42501';
  end if;
  _dados := coalesce(_dados, '{}'::jsonb);
  if lower(_dados::text) ~ '"(senha|password|token|secret|api_key|chave)"' then
    raise exception 'Senha e token não entram no banco do painel. Guarde no cofre.' using errcode = 'P0001';
  end if;
  if _dados ? 'cliente' then
    _client := case when _dados ->> 'cliente' like 'c:%' then substr(_dados ->> 'cliente', 3)::uuid end;
    _conta := case when _dados ->> 'cliente' like 'p:%' then substr(_dados ->> 'cliente', 3)::uuid end;
    perform public.casa_conferir_dono(_client, _conta);
  end if;

  if _id is null then
    _nome := regexp_replace(lower(btrim(coalesce(_dados ->> 'dominio', ''))), '^(https?://)?(www\.)?', '');
    _nome := regexp_replace(_nome, '/.*$', '');
    if _nome !~ '^([a-z0-9-]+\.)+[a-z]{2,}$' then
      raise exception 'Escreva o domínio como empresa.com.br.' using errcode = 'P0001';
    end if;
    insert into public.casa_dominios (dominio, origem) values (_nome, case when _dados ? 'email_dominio_id' then 'email' else 'manual' end)
    on conflict (dominio) do update set arquivado_em = null, atualizado_em = now()
    returning * into _d;
  else
    select * into _d from public.casa_dominios where id = _id for update;
    if _d.id is null then
      raise exception 'O domínio não foi encontrado.' using errcode = 'P0001';
    end if;
  end if;

  update public.casa_dominios set
    client_id = case when _dados ? 'cliente' then _client else client_id end,
    conta_id = case when _dados ? 'cliente' then _conta else conta_id end,
    registrador = case when _dados ? 'registrador' then public.casa_texto(_dados ->> 'registrador', 80) else registrador end,
    titular = case when _dados ? 'titular' then public.casa_texto(_dados ->> 'titular', 160) else titular end,
    vence_em = case when _dados ? 'vence_em' then nullif(_dados ->> 'vence_em', '')::date else vence_em end,
    vencimento_fonte = case when _dados ? 'vence_em' then case when nullif(_dados ->> 'vence_em', '') is null then null else 'manual' end else vencimento_fonte end,
    custo_valor = case when _dados ? 'custo_valor' then public.casa_valor(_dados ->> 'custo_valor') else custo_valor end,
    custo_periodo = case when _dados ? 'custo_periodo' then coalesce(nullif(_dados ->> 'custo_periodo', ''), 'anual') else custo_periodo end,
    preco_valor = case when _dados ? 'preco_valor' then public.casa_valor(_dados ->> 'preco_valor') else preco_valor end,
    preco_periodo = case when _dados ? 'preco_periodo' then coalesce(nullif(_dados ->> 'preco_periodo', ''), 'mensal') else preco_periodo end,
    observacao = case when _dados ? 'observacao' then public.casa_texto(_dados ->> 'observacao', 1500) else observacao end,
    atualizado_em = now()
   where id = _d.id
  returning * into _d;

  -- O domínio do e-mail já sabe de quem é: herda o cliente quando a casa ainda não escolheu.
  if _d.client_id is null and _d.conta_id is null then
    update public.casa_dominios cd set conta_id = e.conta_id, client_id = c.client_id
      from public.produto_email_dominios e join public.produto_contas c on c.id = e.conta_id
     where cd.id = _d.id and lower(e.dominio) = lower(cd.dominio);
  end if;

  return jsonb_build_object('id', _d.id, 'dominio', _d.dominio);
end;
$$;

revoke all on function public.casa_dominio_salvar(uuid, jsonb) from public, anon;
grant execute on function public.casa_dominio_salvar(uuid, jsonb) to authenticated, service_role;

create or replace function public.casa_site_salvar(_id uuid, _dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _s public.casa_sites;
  _client uuid;
  _conta uuid;
  _dominio uuid;
begin
  if not public.produto_email_pela_casa() then
    raise exception 'Só a administração da Aceleriq.' using errcode = '42501';
  end if;
  _dados := coalesce(_dados, '{}'::jsonb);
  if lower(_dados::text) ~ '"(senha|password|token|secret|api_key|chave)"' then
    raise exception 'Senha e token não entram no banco do painel. Guarde no cofre.' using errcode = 'P0001';
  end if;
  if _dados ? 'cliente' then
    _client := case when _dados ->> 'cliente' like 'c:%' then substr(_dados ->> 'cliente', 3)::uuid end;
    _conta := case when _dados ->> 'cliente' like 'p:%' then substr(_dados ->> 'cliente', 3)::uuid end;
    perform public.casa_conferir_dono(_client, _conta);
  end if;
  if nullif(_dados ->> 'dominio_id', '') is not null then
    _dominio := (_dados ->> 'dominio_id')::uuid;
    if not exists (select 1 from public.casa_dominios d where d.id = _dominio) then
      raise exception 'O domínio não foi encontrado.' using errcode = 'P0001';
    end if;
  end if;

  if _id is null then
    if public.casa_texto(_dados ->> 'nome', 160) is null and public.casa_host(_dados ->> 'endereco') is null then
      raise exception 'Dê um nome ou o endereço do site.' using errcode = 'P0001';
    end if;
    insert into public.casa_sites (nome, endereco, origem)
    values (coalesce(public.casa_texto(_dados ->> 'nome', 160), public.casa_host(_dados ->> 'endereco')), public.casa_host(_dados ->> 'endereco'), 'manual')
    returning * into _s;
  else
    select * into _s from public.casa_sites where id = _id for update;
    if _s.id is null then
      raise exception 'O site não foi encontrado.' using errcode = 'P0001';
    end if;
  end if;

  update public.casa_sites set
    nome = case when _dados ? 'nome' then coalesce(public.casa_texto(_dados ->> 'nome', 160), nome) else nome end,
    endereco = case when _dados ? 'endereco' then public.casa_host(_dados ->> 'endereco') else endereco end,
    client_id = case when _dados ? 'cliente' then _client else client_id end,
    conta_id = case when _dados ? 'cliente' then _conta else conta_id end,
    dominio_id = case when _dados ? 'dominio_id' then _dominio else dominio_id end,
    hospedagem = case when _dados ? 'hospedagem' then public.casa_texto(_dados ->> 'hospedagem', 80) else hospedagem end,
    custo_valor = case when _dados ? 'custo_valor' then public.casa_valor(_dados ->> 'custo_valor') else custo_valor end,
    custo_periodo = case when _dados ? 'custo_periodo' then coalesce(nullif(_dados ->> 'custo_periodo', ''), 'mensal') else custo_periodo end,
    preco_valor = case when _dados ? 'preco_valor' then public.casa_valor(_dados ->> 'preco_valor') else preco_valor end,
    preco_periodo = case when _dados ? 'preco_periodo' then coalesce(nullif(_dados ->> 'preco_periodo', ''), 'mensal') else preco_periodo end,
    observacao = case when _dados ? 'observacao' then public.casa_texto(_dados ->> 'observacao', 1500) else observacao end,
    atualizado_em = now()
   where id = _s.id
  returning * into _s;

  -- Sem domínio escolhido, liga ao domínio cadastrado que bate com o endereço.
  if _s.dominio_id is null and _s.endereco is not null then
    update public.casa_sites s set dominio_id = (
      select d.id from public.casa_dominios d
       where split_part(s.endereco, '/', 1) = d.dominio or split_part(s.endereco, '/', 1) like '%.' || d.dominio
       order by length(d.dominio) desc limit 1)
     where s.id = _s.id;
  end if;

  return jsonb_build_object('id', _s.id, 'nome', _s.nome);
end;
$$;

revoke all on function public.casa_site_salvar(uuid, jsonb) from public, anon;
grant execute on function public.casa_site_salvar(uuid, jsonb) to authenticated, service_role;

-- Tira da central (fica guardado). _arquivar falso devolve.
create or replace function public.casa_dominios_sites_arquivar(_tipo text, _id uuid, _arquivar boolean default true)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.produto_email_pela_casa() then
    raise exception 'Só a administração da Aceleriq.' using errcode = '42501';
  end if;
  if _tipo = 'dominio' then
    update public.casa_dominios set arquivado_em = case when _arquivar then now() end, atualizado_em = now() where id = _id;
  elsif _tipo = 'site' then
    update public.casa_sites set arquivado_em = case when _arquivar then now() end, atualizado_em = now() where id = _id;
  else
    raise exception 'Tipo desconhecido.' using errcode = 'P0001';
  end if;
  if not found then
    raise exception 'Não encontrado.' using errcode = 'P0001';
  end if;
  return coalesce(_arquivar, true);
end;
$$;

revoke all on function public.casa_dominios_sites_arquivar(text, uuid, boolean) from public, anon;
grant execute on function public.casa_dominios_sites_arquivar(text, uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. O que a função casa-dominios leu (Cloudflare, RDAP, DNS público, sites)
-- ---------------------------------------------------------------------------
-- _leitura = { dominios: [{dominio, origem?, registrador?, titular?, nameservers?, cloudflare_zona_id?,
--   cloudflare_status?, na_cloudflare_da_casa?, vence_em?, rdap_erro?, rdap?: bool, dns_email?}],
--   sites: [{cf_tipo, cf_nome, nome, endereco?, dominios_personalizados?, ultima_publicacao?}],
--   saude_sites: [{id, http_status, ssl_ok, resposta_ms, erro}] }
-- Só grava o que veio. Nunca toca em cliente, preço, custo ou observação.
create or replace function public.casa_dominios_sites_gravar_leitura(_leitura jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _x jsonb;
  _nome text;
  _dominios integer := 0;
  _sites integer := 0;
  _saude integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Só as funções do servidor gravam a leitura.' using errcode = '42501';
  end if;

  for _x in select * from jsonb_array_elements(coalesce(_leitura -> 'dominios', '[]'::jsonb)) loop
    _nome := lower(btrim(coalesce(_x ->> 'dominio', '')));
    continue when _nome !~ '^([a-z0-9-]+\.)+[a-z]{2,}$';
    insert into public.casa_dominios (dominio, origem)
    values (_nome, coalesce(nullif(_x ->> 'origem', ''), 'cloudflare'))
    on conflict (dominio) do nothing;
    update public.casa_dominios set
      registrador = case when _x ? 'registrador' then coalesce(public.casa_texto(_x ->> 'registrador', 80), registrador) else registrador end,
      titular = case when _x ? 'titular' then coalesce(public.casa_texto(_x ->> 'titular', 160), titular) else titular end,
      nameservers = case when _x ? 'nameservers' then coalesce((select array_agg(lower(n)) from jsonb_array_elements_text(_x -> 'nameservers') n), '{}') else nameservers end,
      cloudflare_zona_id = case when _x ? 'cloudflare_zona_id' then public.casa_texto(_x ->> 'cloudflare_zona_id', 64) else cloudflare_zona_id end,
      cloudflare_status = case when _x ? 'cloudflare_status' then public.casa_texto(_x ->> 'cloudflare_status', 40) else cloudflare_status end,
      na_cloudflare_da_casa = case when _x ? 'na_cloudflare_da_casa' then coalesce((_x ->> 'na_cloudflare_da_casa')::boolean, false) else na_cloudflare_da_casa end,
      -- O RDAP manda no vencimento; sem resposta dele, fica o que estava (inclusive o anotado à mão).
      vence_em = case when _x ? 'vence_em' and nullif(_x ->> 'vence_em', '') is not null then (_x ->> 'vence_em')::date else vence_em end,
      vencimento_fonte = case when _x ? 'vence_em' and nullif(_x ->> 'vence_em', '') is not null then 'rdap' else vencimento_fonte end,
      rdap_lido_em = case when (_x ->> 'rdap')::boolean then now() else rdap_lido_em end,
      rdap_erro = case when (_x ->> 'rdap')::boolean then public.casa_texto(_x ->> 'rdap_erro', 200) else rdap_erro end,
      dns_email = case when _x ? 'dns_email' then _x -> 'dns_email' else dns_email end,
      dns_conferido_em = case when _x ? 'dns_email' then now() else dns_conferido_em end,
      atualizado_em = now()
     where lower(dominio) = _nome;
    -- O vencimento lido vale também para a central de e-mail, quando ela ainda não tem.
    if nullif(_x ->> 'vence_em', '') is not null then
      update public.produto_email_dominios set dominio_vence_em = (_x ->> 'vence_em')::date
       where lower(dominio) = _nome and dominio_vence_em is null;
    end if;
    _dominios := _dominios + 1;
  end loop;

  for _x in select * from jsonb_array_elements(coalesce(_leitura -> 'sites', '[]'::jsonb)) loop
    continue when coalesce(_x ->> 'cf_tipo', '') not in ('worker', 'pages') or nullif(_x ->> 'cf_nome', '') is null;
    insert into public.casa_sites (nome, origem, cf_tipo, cf_nome, hospedagem)
    values (left(coalesce(nullif(_x ->> 'nome', ''), _x ->> 'cf_nome'), 160), 'cloudflare', _x ->> 'cf_tipo', left(_x ->> 'cf_nome', 160),
            case when _x ->> 'cf_tipo' = 'pages' then 'Cloudflare Pages' else 'Cloudflare Workers' end)
    on conflict (cf_tipo, cf_nome) where cf_tipo is not null do nothing;
    update public.casa_sites s set
      endereco = coalesce(public.casa_host(_x ->> 'endereco'), s.endereco),
      dominios_personalizados = case when _x ? 'dominios_personalizados' then coalesce((select array_agg(lower(n)) from jsonb_array_elements_text(_x -> 'dominios_personalizados') n), '{}') else s.dominios_personalizados end,
      ultima_publicacao = case when nullif(_x ->> 'ultima_publicacao', '') is not null then (_x ->> 'ultima_publicacao')::timestamptz else s.ultima_publicacao end,
      atualizado_em = now()
     where s.cf_tipo = _x ->> 'cf_tipo' and s.cf_nome = _x ->> 'cf_nome';
    _sites := _sites + 1;
  end loop;

  -- Liga cada site sem domínio ao domínio cadastrado que bate com o endereço.
  update public.casa_sites s set dominio_id = (
    select d.id from public.casa_dominios d
     where split_part(s.endereco, '/', 1) = d.dominio or split_part(s.endereco, '/', 1) like '%.' || d.dominio
     order by length(d.dominio) desc limit 1)
   where s.dominio_id is null and s.endereco is not null;

  for _x in select * from jsonb_array_elements(coalesce(_leitura -> 'saude_sites', '[]'::jsonb)) loop
    update public.casa_sites set
      http_status = nullif(_x ->> 'http_status', '')::integer,
      ssl_ok = (_x ->> 'ssl_ok')::boolean,
      resposta_ms = nullif(_x ->> 'resposta_ms', '')::integer,
      erro = public.casa_texto(_x ->> 'erro', 300),
      conferido_em = now()
     where id = (_x ->> 'id')::uuid;
    if found then
      _saude := _saude + 1;
    end if;
  end loop;

  return jsonb_build_object('dominios', _dominios, 'sites', _sites, 'saude_sites', _saude);
end;
$$;

revoke all on function public.casa_dominios_sites_gravar_leitura(jsonb) from public, anon, authenticated;
grant execute on function public.casa_dominios_sites_gravar_leitura(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 6. A leitura da tela
-- ---------------------------------------------------------------------------
create or replace function public.casa_dominios_sites_central()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.produto_email_pela_casa() then
    raise exception 'Só a administração da Aceleriq.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'dominios', (
      select coalesce(jsonb_agg(j order by j ->> 'dominio'), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', d.id, 'dominio', d.dominio, 'origem', d.origem,
          'cliente', case when d.client_id is not null then 'c:' || d.client_id when d.conta_id is not null then 'p:' || d.conta_id end,
          'cliente_nome', coalesce((select coalesce(p.company_name, p.full_name) from public.profiles p where p.id = d.client_id),
                                   (select c.nome from public.produto_contas c where c.id = d.conta_id)),
          'registrador', d.registrador, 'titular', d.titular, 'nameservers', to_jsonb(d.nameservers),
          'cloudflare_zona_id', d.cloudflare_zona_id, 'cloudflare_status', d.cloudflare_status, 'na_cloudflare_da_casa', d.na_cloudflare_da_casa,
          'vence_em', coalesce(d.vence_em, e.dominio_vence_em), 'vencimento_fonte', case when d.vence_em is not null then d.vencimento_fonte when e.dominio_vence_em is not null then 'manual' end,
          'rdap_lido_em', d.rdap_lido_em, 'rdap_erro', d.rdap_erro,
          'dns_email', coalesce(d.dns_email, e.checagem), 'dns_conferido_em', coalesce(d.dns_conferido_em, e.checado_em),
          'email', case when e.id is not null then jsonb_build_object('dominio_id', e.id, 'provedor', e.provedor, 'estado', e.estado) end,
          'custo_valor', d.custo_valor, 'custo_periodo', d.custo_periodo, 'preco_valor', d.preco_valor, 'preco_periodo', d.preco_periodo,
          'observacao', d.observacao, 'arquivado', d.arquivado_em is not null, 'criado_em', d.criado_em
        ) as j
          from public.casa_dominios d
          left join lateral (select * from public.produto_email_dominios x where lower(x.dominio) = lower(d.dominio) order by x.criado_em limit 1) e on true
        union all
        -- Domínio do e-mail ainda sem cadastro na central: aparece sem id, e salvar cria.
        select jsonb_build_object(
          'id', null, 'dominio', lower(x.dominio), 'origem', 'email',
          'cliente', case when c.client_id is not null then 'c:' || c.client_id else 'p:' || c.id end,
          'cliente_nome', coalesce((select coalesce(p.company_name, p.full_name) from public.profiles p where p.id = c.client_id), c.nome),
          'registrador', x.registro_em, 'titular', null, 'nameservers', '[]'::jsonb,
          'cloudflare_zona_id', x.cloudflare_zona_id, 'cloudflare_status', null, 'na_cloudflare_da_casa', x.cloudflare_zona_id is not null,
          'vence_em', x.dominio_vence_em, 'vencimento_fonte', case when x.dominio_vence_em is not null then 'manual' end,
          'rdap_lido_em', null, 'rdap_erro', null,
          'dns_email', x.checagem, 'dns_conferido_em', x.checado_em,
          'email', jsonb_build_object('dominio_id', x.id, 'provedor', x.provedor, 'estado', x.estado),
          'custo_valor', null, 'custo_periodo', 'anual', 'preco_valor', null, 'preco_periodo', 'mensal',
          'observacao', null, 'arquivado', false, 'criado_em', x.criado_em
        )
          from public.produto_email_dominios x
          join public.produto_contas c on c.id = x.conta_id
         where not exists (select 1 from public.casa_dominios d where lower(d.dominio) = lower(x.dominio))
      ) t
    ),
    'sites', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', s.id, 'nome', s.nome, 'endereco', s.endereco, 'origem', s.origem, 'cf_tipo', s.cf_tipo, 'cf_nome', s.cf_nome,
          'hospedagem', s.hospedagem, 'dominios_personalizados', to_jsonb(s.dominios_personalizados),
          'cliente', case when coalesce(s.client_id, d.client_id) is not null then 'c:' || coalesce(s.client_id, d.client_id)
                          when coalesce(s.conta_id, d.conta_id) is not null then 'p:' || coalesce(s.conta_id, d.conta_id) end,
          'cliente_nome', coalesce((select coalesce(p.company_name, p.full_name) from public.profiles p where p.id = coalesce(s.client_id, d.client_id)),
                                   (select c.nome from public.produto_contas c where c.id = coalesce(s.conta_id, d.conta_id))),
          'cliente_herdado', s.client_id is null and s.conta_id is null and (d.client_id is not null or d.conta_id is not null),
          'dominio_id', s.dominio_id, 'dominio', d.dominio,
          'ultima_publicacao', s.ultima_publicacao, 'http_status', s.http_status, 'ssl_ok', s.ssl_ok, 'resposta_ms', s.resposta_ms,
          'erro', s.erro, 'conferido_em', s.conferido_em,
          'custo_valor', s.custo_valor, 'custo_periodo', s.custo_periodo, 'preco_valor', s.preco_valor, 'preco_periodo', s.preco_periodo,
          'observacao', s.observacao, 'arquivado', s.arquivado_em is not null, 'criado_em', s.criado_em
        ) order by s.nome), '[]'::jsonb)
        from public.casa_sites s
        left join public.casa_dominios d on d.id = s.dominio_id
    ),
    'clientes', (
      select coalesce(jsonb_agg(jsonb_build_object('valor', v, 'nome', n) order by n), '[]'::jsonb) from (
        select 'c:' || p.id as v, coalesce(nullif(btrim(p.company_name), ''), nullif(btrim(p.full_name), ''), p.email) as n
          from public.profiles p
         where exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'client'::public.app_role)
        union all
        select 'p:' || c.id, c.nome || ' (produto)'
          from public.produto_contas c
         where c.client_id is null and c.estado <> 'cancelada'
      ) k where n is not null
    ),
    'leitura', jsonb_build_object(
      'dominios_em', (select max(rdap_lido_em) from public.casa_dominios),
      'cloudflare_em', (select max(atualizado_em) from public.casa_sites where origem = 'cloudflare'),
      'sites_em', (select max(conferido_em) from public.casa_sites)
    )
  );
end;
$$;

revoke all on function public.casa_dominios_sites_central() from public, anon;
grant execute on function public.casa_dominios_sites_central() to authenticated, service_role;
