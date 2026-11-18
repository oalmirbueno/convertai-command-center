-- CRM da empresa, rodada 3 (14/11/2026): lead do formulario da Meta (Lead Ads) entra sozinho, e pontuado,
-- vai para o vendedor certo pelo rodizio (tipo de bem e expediente) e conversa pelo WhatsApp oficial da
-- propria empresa. Cada empresa conecta a Meta e o WhatsApp DELA (modo manual: app, token e segredo
-- colados na tela; tudo no Vault). Nasce DESLIGADO e em modo teste: em teste nada sai para fora.
--
-- Quem faz o que:
--   a tela (gestor)   crm_integracao_ler / crm_integracao_salvar / crm_vendedores_ler / crm_vendedor_salvar / crm_integracao_atividade
--   o servico         crm_integracao_por_chave, crm_meta_lead_registrar, crm_meta_lead_criar, crm_fila_distribuir,
--                     crm_lead_avancar, crm_whats_* (so service_role)

-- ---------------------------------------------------------------------------
-- 1. A conexao de cada empresa
-- ---------------------------------------------------------------------------
create table if not exists public.crm_integracoes (
  conta_id uuid primary key references public.produto_contas(id) on delete cascade,
  -- A chave geral. Desligada, o webhook responde 200 e nao faz nada.
  ativo boolean not null default false,
  -- teste: registra tudo e marca os envios como simulados, sem chamar a Meta nem o WhatsApp.
  modo text not null default 'teste' check (modo in ('teste', 'real')),
  -- O endereco do webhook desta empresa leva esta chave; o verify_token e o que a Meta devolve na conferencia.
  webhook_chave text not null unique default replace(gen_random_uuid()::text, '-', ''),
  verify_token text not null default left(replace(gen_random_uuid()::text, '-', ''), 24),
  -- Meta (Lead Ads)
  pagina_id text check (pagina_id is null or pagina_id ~ '^[0-9]{5,25}$'),
  formularios text[] not null default '{}'::text[] check (array_length(formularios, 1) is null or array_length(formularios, 1) <= 50),
  app_secret_id uuid,
  token_id uuid,
  token_final text check (token_final is null or length(token_final) <= 4),
  -- WhatsApp Cloud API (o numero da propria empresa)
  wa_phone_id text check (wa_phone_id is null or wa_phone_id ~ '^[0-9]{5,25}$'),
  wa_waba_id text check (wa_waba_id is null or wa_waba_id ~ '^[0-9]{5,25}$'),
  wa_numero text check (wa_numero is null or length(wa_numero) <= 24),
  wa_token_id uuid,
  wa_token_final text check (wa_token_final is null or length(wa_token_final) <= 4),
  -- Nomes dos templates aprovados no WhatsApp da empresa: { lead, vendedor, followup, nutricao } e o idioma.
  templates jsonb not null default '{}'::jsonb check (jsonb_typeof(templates) = 'object' and pg_column_size(templates) <= 2000),
  idioma text not null default 'pt_BR' check (idioma ~ '^[a-z]{2}(_[A-Z]{2})?$'),
  -- As regras da pontuacao (formato em supabase/functions/_shared/pontuacao-do-crm.ts). Vazio = padrao do ramo.
  pontuacao jsonb not null default '{}'::jsonb check (jsonb_typeof(pontuacao) = 'object' and pg_column_size(pontuacao) <= 8000),
  -- Depois de quantas horas sem resposta o robo insiste (no maximo 3 vezes).
  followup_horas integer[] not null default array[24, 72] check (array_length(followup_horas, 1) is null or array_length(followup_horas, 1) <= 3),
  ultimo_erro text check (ultimo_erro is null or length(ultimo_erro) <= 300),
  atualizado_por uuid,
  atualizado_em timestamptz not null default now(),
  criado_em timestamptz not null default now()
);

alter table public.crm_integracoes enable row level security;
revoke all on public.crm_integracoes from anon, authenticated;
grant all on public.crm_integracoes to service_role;

-- Apagar a conexao (ou a empresa) leva os segredos junto.
create or replace function public.crm_integracao_apaga_segredos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    delete from vault.secrets where id in (old.app_secret_id, old.token_id, old.wa_token_id);
  exception when others then
    raise warning 'crm integracao: segredo nao removido: %', sqlerrm;
  end;
  return old;
end;
$$;

revoke all on function public.crm_integracao_apaga_segredos() from public, anon, authenticated;
drop trigger if exists crm_integracao_apaga_segredos_trg on public.crm_integracoes;
create trigger crm_integracao_apaga_segredos_trg
  after delete on public.crm_integracoes
  for each row execute function public.crm_integracao_apaga_segredos();

-- ---------------------------------------------------------------------------
-- 2. O negocio ganha nota, faixa e fila
-- ---------------------------------------------------------------------------
alter table public.crm_leads
  add column if not exists nota integer check (nota is null or nota between 0 and 100),
  add column if not exists faixa text check (faixa is null or faixa in ('quente', 'morno', 'frio')),
  add column if not exists nota_motivos jsonb not null default '[]'::jsonb check (jsonb_typeof(nota_motivos) = 'array' and pg_column_size(nota_motivos) <= 4000),
  -- Qualificado esperando vendedor (ninguem no expediente): o primeiro que entrar recebe.
  add column if not exists fila_desde timestamptz,
  -- Frio: fica em nutricao, sem ocupar vendedor.
  add column if not exists nutricao boolean not null default false;

create index if not exists crm_leads_na_fila on public.crm_leads (conta_id, fila_desde) where fila_desde is not null;

-- ---------------------------------------------------------------------------
-- 3. Os leads que a Meta mandou (um por leadgen_id: a Meta repete o aviso)
-- ---------------------------------------------------------------------------
create table if not exists public.crm_meta_leads (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.produto_contas(id) on delete cascade,
  leadgen_id text not null check (leadgen_id ~ '^[A-Za-z0-9_:-]{3,60}$'),
  pagina_id text,
  form_id text,
  ad_id text,
  adset_id text,
  campaign_id text,
  -- O que veio da Graph API (respostas, nomes do anuncio e da campanha). Sem token.
  dados jsonb not null default '{}'::jsonb check (jsonb_typeof(dados) = 'object' and pg_column_size(dados) <= 16000),
  lead_id uuid references public.crm_leads(id) on delete set null,
  situacao text not null default 'recebido' check (situacao in ('recebido', 'criado', 'repetido', 'ignorado', 'erro')),
  de_teste boolean not null default false,
  erro text check (erro is null or length(erro) <= 300),
  criado_em timestamptz not null default now(),
  unique (conta_id, leadgen_id)
);

create index if not exists crm_meta_leads_da_conta on public.crm_meta_leads (conta_id, criado_em desc);
alter table public.crm_meta_leads enable row level security;
revoke all on public.crm_meta_leads from anon, authenticated;
grant all on public.crm_meta_leads to service_role;

-- ---------------------------------------------------------------------------
-- 4. Vendedores: que bens atende, expediente e o WhatsApp onde recebe os avisos
-- ---------------------------------------------------------------------------
create table if not exists public.crm_vendedores (
  membro_id uuid primary key references public.produto_membros(id) on delete cascade,
  conta_id uuid not null references public.produto_contas(id) on delete cascade,
  recebe_leads boolean not null default true,
  -- Vazio = atende qualquer bem. Valores livres e curtos: imovel, carro, moto, pesados, servicos, outros...
  bens text[] not null default '{}'::text[] check (array_length(bens, 1) is null or array_length(bens, 1) <= 12),
  -- { "dias": [1,2,3,4,5], "inicio": "09:00", "fim": "18:00" } (1 = segunda ... 7 = domingo). Vazio = sempre.
  expediente jsonb not null default '{}'::jsonb check (jsonb_typeof(expediente) = 'object' and pg_column_size(expediente) <= 600),
  -- So numeros, com pais e DDD (5541999990000).
  whatsapp text check (whatsapp is null or whatsapp ~ '^[0-9]{10,15}$'),
  ultimo_lead_em timestamptz,
  atualizado_em timestamptz not null default now()
);

alter table public.crm_vendedores enable row level security;
revoke all on public.crm_vendedores from anon, authenticated;
grant all on public.crm_vendedores to service_role;

-- A pessoa esta no expediente agora? Sem expediente definido, esta sempre.
create or replace function public.crm_no_expediente(_expediente jsonb, _quando timestamptz default now())
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  _local timestamp := _quando at time zone 'America/Sao_Paulo';
  _dia integer := extract(isodow from _local)::integer;
  _hora text := to_char(_local, 'HH24:MI');
  _inicio text := _expediente ->> 'inicio';
  _fim text := _expediente ->> 'fim';
begin
  if _expediente is null or _expediente = '{}'::jsonb then
    return true;
  end if;
  if jsonb_typeof(_expediente -> 'dias') = 'array' and jsonb_array_length(_expediente -> 'dias') > 0
     and not (_expediente -> 'dias') @> to_jsonb(_dia) then
    return false;
  end if;
  if _inicio ~ '^[0-2][0-9]:[0-5][0-9]$' and _fim ~ '^[0-2][0-9]:[0-5][0-9]$' then
    return _hora >= _inicio and _hora < _fim;
  end if;
  return true;
end;
$$;

-- O proximo do rodizio para um tipo de bem, entre quem esta no expediente: menos negocios abertos primeiro,
-- empate para quem recebeu ha mais tempo. Nulo quando nao ha ninguem agora (o negocio espera na fila).
create or replace function public.crm_rodizio_por_bem(_conta uuid, _bem text default null, _quando timestamptz default now())
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with pessoas as (
    select m.user_id, m.papel, v.ultimo_lead_em,
           (select count(*) from public.crm_leads l
             where l.conta_id = _conta and l.owner_id = m.user_id and l.archived_at is null and l.stage not in ('ganho', 'perdido')) as abertos
      from public.produto_membros m
      left join public.crm_vendedores v on v.membro_id = m.id
     where m.conta_id = _conta and m.estado = 'ativo' and m.user_id is not null
       and coalesce(v.recebe_leads, true)
       and (_bem is null or v.bens is null or v.bens = '{}'::text[] or lower(_bem) = any (v.bens))
       and public.crm_no_expediente(coalesce(v.expediente, '{}'::jsonb), _quando)
  )
  select p.user_id from pessoas p
   -- Gerente e admin so recebem quando a empresa nao tem vendedor nenhum (e nao quando o vendedor esta fora do expediente).
   where p.papel = 'usuario' or not exists (
           select 1 from public.produto_membros x
            where x.conta_id = _conta and x.estado = 'ativo' and x.user_id is not null and x.papel = 'usuario')
   order by p.abertos, p.ultimo_lead_em nulls first, p.user_id
   limit 1
$$;

revoke all on function public.crm_no_expediente(jsonb, timestamptz) from public, anon;
grant execute on function public.crm_no_expediente(jsonb, timestamptz) to authenticated, service_role;
revoke all on function public.crm_rodizio_por_bem(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.crm_rodizio_por_bem(uuid, text, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 5. WhatsApp: a conversa do robo com cada lead e a fila de envio
-- ---------------------------------------------------------------------------
create table if not exists public.crm_whats_conversas (
  lead_id uuid primary key references public.crm_leads(id) on delete cascade,
  conta_id uuid not null references public.produto_contas(id) on delete cascade,
  telefone text not null check (telefone ~ '^[0-9]{10,15}$'),
  -- inicio | perguntando | qualificado | passado | nutricao | encerrado
  etapa text not null default 'inicio' check (etapa in ('inicio', 'perguntando', 'qualificado', 'passado', 'nutricao', 'encerrado')),
  -- Em qual pergunta esta e o que ja respondeu.
  pergunta text,
  respostas jsonb not null default '{}'::jsonb check (jsonb_typeof(respostas) = 'object' and pg_column_size(respostas) <= 4000),
  -- A janela de 24 h do WhatsApp: fora dela so sai template.
  janela_ate timestamptz,
  ultima_do_lead_em timestamptz,
  followups integer not null default 0,
  proximo_followup_em timestamptz,
  vendedor_avisado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists crm_whats_conversas_telefone on public.crm_whats_conversas (conta_id, telefone);
create index if not exists crm_whats_conversas_followup on public.crm_whats_conversas (proximo_followup_em) where proximo_followup_em is not null;

create table if not exists public.crm_whats_envios (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.produto_contas(id) on delete cascade,
  lead_id uuid references public.crm_leads(id) on delete cascade,
  para text not null check (para ~ '^[0-9]{10,15}$'),
  -- lead: mensagem ao lead; vendedor: aviso ao vendedor.
  destino text not null default 'lead' check (destino in ('lead', 'vendedor')),
  -- O corpo pronto da Cloud API (sem o token): { type: template|text|interactive, ... }.
  corpo jsonb not null check (jsonb_typeof(corpo) = 'object' and pg_column_size(corpo) <= 12000),
  -- Evita mandar duas vezes a mesma coisa (ex.: "lead:<id>:boas-vindas").
  chave text not null,
  situacao text not null default 'pendente' check (situacao in ('pendente', 'enviado', 'simulado', 'erro')),
  wa_message_id text,
  tentativas integer not null default 0,
  erro text check (erro is null or length(erro) <= 300),
  proxima_em timestamptz not null default now(),
  criado_em timestamptz not null default now(),
  enviado_em timestamptz,
  unique (conta_id, chave)
);

create index if not exists crm_whats_envios_da_fila on public.crm_whats_envios (proxima_em) where situacao = 'pendente';
create index if not exists crm_whats_envios_da_conta on public.crm_whats_envios (conta_id, criado_em desc);

-- Mensagens que chegaram, para nao tratar duas vezes a mesma (a Meta repete).
create table if not exists public.crm_whats_recebidas (
  conta_id uuid not null references public.produto_contas(id) on delete cascade,
  wa_message_id text not null,
  criado_em timestamptz not null default now(),
  primary key (conta_id, wa_message_id)
);

alter table public.crm_whats_conversas enable row level security;
alter table public.crm_whats_envios enable row level security;
alter table public.crm_whats_recebidas enable row level security;
revoke all on public.crm_whats_conversas, public.crm_whats_envios, public.crm_whats_recebidas from anon, authenticated;
grant all on public.crm_whats_conversas, public.crm_whats_envios, public.crm_whats_recebidas to service_role;

-- ---------------------------------------------------------------------------
-- 6. A tela do gestor: ler e salvar a conexao (o segredo entra e nunca volta)
-- ---------------------------------------------------------------------------
create or replace function public.crm_integracao_ler()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _conta uuid := public.crm_conta_atual();
  _i public.crm_integracoes;
begin
  if _conta is null or not public.crm_sou_gestor() then
    raise exception 'Só o gerente ou quem administra a empresa vê as integrações.' using errcode = '42501';
  end if;
  select * into _i from public.crm_integracoes where conta_id = _conta;
  return jsonb_build_object(
    'existe', _i.conta_id is not null,
    'ativo', coalesce(_i.ativo, false),
    'modo', coalesce(_i.modo, 'teste'),
    'webhook_chave', _i.webhook_chave,
    'verify_token', _i.verify_token,
    'pagina_id', _i.pagina_id,
    'formularios', coalesce(to_jsonb(_i.formularios), '[]'::jsonb),
    'tem_app_secret', _i.app_secret_id is not null,
    'tem_token', _i.token_id is not null,
    'token_final', _i.token_final,
    'wa_phone_id', _i.wa_phone_id,
    'wa_waba_id', _i.wa_waba_id,
    'wa_numero', _i.wa_numero,
    'tem_wa_token', _i.wa_token_id is not null,
    'wa_token_final', _i.wa_token_final,
    'templates', coalesce(_i.templates, '{}'::jsonb),
    'idioma', coalesce(_i.idioma, 'pt_BR'),
    'pontuacao', coalesce(_i.pontuacao, '{}'::jsonb),
    'followup_horas', coalesce(to_jsonb(_i.followup_horas), '[24, 72]'::jsonb),
    'ultimo_erro', _i.ultimo_erro,
    'numeros', jsonb_build_object(
      'leads_7_dias', (select count(*) from public.crm_meta_leads m where m.conta_id = _conta and m.criado_em > now() - interval '7 days'),
      'na_fila', (select count(*) from public.crm_leads l where l.conta_id = _conta and l.fila_desde is not null and l.archived_at is null),
      'em_nutricao', (select count(*) from public.crm_leads l where l.conta_id = _conta and l.nutricao and l.archived_at is null and l.stage not in ('ganho', 'perdido')),
      'envios_pendentes', (select count(*) from public.crm_whats_envios e where e.conta_id = _conta and e.situacao = 'pendente'),
      'envios_com_erro', (select count(*) from public.crm_whats_envios e where e.conta_id = _conta and e.situacao = 'erro' and e.criado_em > now() - interval '7 days')
    )
  );
end;
$$;

-- Guarda um segredo no Vault (cria ou troca) e devolve o endereco dele.
create or replace function public.crm_integracao_guardar_segredo(_atual uuid, _valor text, _nome text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare _id uuid := _atual;
begin
  if _valor !~ '^[A-Za-z0-9_.|-]+$' or length(_valor) not between 16 and 600 then
    raise exception 'O valor colado não parece válido. Copie de novo, inteiro, sem espaços.' using errcode = 'P0001';
  end if;
  if _id is not null then
    perform vault.update_secret(_id, _valor, null, null, null);
  else
    select vault.create_secret(_valor, _nome || '-' || gen_random_uuid()::text, 'Segredo da integração do CRM da empresa', null) into _id;
  end if;
  return _id;
end;
$$;

revoke all on function public.crm_integracao_guardar_segredo(uuid, text, text) from public, anon, authenticated;

create or replace function public.crm_integracao_salvar(_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _eu uuid := auth.uid();
  _conta uuid := public.crm_conta_atual();
  _i public.crm_integracoes;
  _v text;
  _formularios text[];
  _horas integer[];
  _ativo boolean;
  _modo text;
begin
  if _conta is null then
    raise exception 'O CRM da empresa não está liberado.' using errcode = '42501';
  end if;
  if not public.crm_sou_gestor() then
    raise exception 'Só o gerente ou quem administra a empresa configura as integrações.' using errcode = '42501';
  end if;
  if _dados is null or jsonb_typeof(_dados) <> 'object' then
    raise exception 'Nada para salvar.' using errcode = 'P0001';
  end if;
  insert into public.crm_integracoes (conta_id, atualizado_por) values (_conta, _eu) on conflict (conta_id) do nothing;
  select * into _i from public.crm_integracoes where conta_id = _conta for update;

  foreach _v in array array['pagina_id', 'wa_phone_id', 'wa_waba_id'] loop
    if _dados ? _v and nullif(regexp_replace(coalesce(_dados ->> _v, ''), '\s', '', 'g'), '') is not null
       and regexp_replace(_dados ->> _v, '\s', '', 'g') !~ '^[0-9]{5,25}$' then
      raise exception 'Esse identificador tem só números. Copie de novo na Meta.' using errcode = 'P0001';
    end if;
  end loop;

  if _dados ? 'formularios' and jsonb_typeof(_dados -> 'formularios') = 'array' then
    select coalesce(array_agg(distinct f.v), '{}'::text[]) into _formularios
      from jsonb_array_elements_text(_dados -> 'formularios') as f(v) where f.v ~ '^[0-9]{5,25}$';
  else
    _formularios := _i.formularios;
  end if;
  if _dados ? 'followup_horas' and jsonb_typeof(_dados -> 'followup_horas') = 'array' then
    select coalesce(array_agg(h.v::integer order by h.v::integer), '{}'::integer[]) into _horas
      from jsonb_array_elements_text(_dados -> 'followup_horas') as h(v) where h.v ~ '^[0-9]{1,3}$' and h.v::integer between 1 and 240;
    _horas := _horas[1:3];
  else
    _horas := _i.followup_horas;
  end if;

  if nullif(btrim(coalesce(_dados ->> 'app_secret', '')), '') is not null then
    _i.app_secret_id := public.crm_integracao_guardar_segredo(_i.app_secret_id, btrim(_dados ->> 'app_secret'), 'crm-meta-app-' || _conta::text);
  end if;
  if nullif(btrim(coalesce(_dados ->> 'token', '')), '') is not null then
    _i.token_id := public.crm_integracao_guardar_segredo(_i.token_id, btrim(_dados ->> 'token'), 'crm-meta-token-' || _conta::text);
    _i.token_final := right(btrim(_dados ->> 'token'), 4);
  end if;
  if nullif(btrim(coalesce(_dados ->> 'wa_token', '')), '') is not null then
    _i.wa_token_id := public.crm_integracao_guardar_segredo(_i.wa_token_id, btrim(_dados ->> 'wa_token'), 'crm-wa-token-' || _conta::text);
    _i.wa_token_final := right(btrim(_dados ->> 'wa_token'), 4);
  end if;

  _modo := case when _dados ->> 'modo' in ('teste', 'real') then _dados ->> 'modo' else _i.modo end;
  _ativo := case when _dados ? 'ativo' then coalesce((_dados ->> 'ativo')::boolean, false) else _i.ativo end;
  -- No modo real a chave so liga com o minimo conectado: segredo do app, token e Pagina.
  if _ativo and _modo = 'real' and (_i.app_secret_id is null or _i.token_id is null
       or coalesce(nullif(regexp_replace(coalesce(_dados ->> 'pagina_id', _i.pagina_id, ''), '\s', '', 'g'), ''), '') = '') then
    raise exception 'Para ligar de verdade, conecte antes a Página, o token e o segredo do app da Meta.' using errcode = 'P0001';
  end if;

  update public.crm_integracoes set
    ativo = _ativo,
    modo = _modo,
    pagina_id = case when _dados ? 'pagina_id' then nullif(regexp_replace(coalesce(_dados ->> 'pagina_id', ''), '\s', '', 'g'), '') else pagina_id end,
    formularios = _formularios,
    app_secret_id = _i.app_secret_id,
    token_id = _i.token_id,
    token_final = _i.token_final,
    wa_phone_id = case when _dados ? 'wa_phone_id' then nullif(regexp_replace(coalesce(_dados ->> 'wa_phone_id', ''), '\s', '', 'g'), '') else wa_phone_id end,
    wa_waba_id = case when _dados ? 'wa_waba_id' then nullif(regexp_replace(coalesce(_dados ->> 'wa_waba_id', ''), '\s', '', 'g'), '') else wa_waba_id end,
    wa_numero = case when _dados ? 'wa_numero' then nullif(left(regexp_replace(coalesce(_dados ->> 'wa_numero', ''), '\D', '', 'g'), 24), '') else wa_numero end,
    wa_token_id = _i.wa_token_id,
    wa_token_final = _i.wa_token_final,
    templates = case when jsonb_typeof(_dados -> 'templates') = 'object' then (
        select coalesce(jsonb_object_agg(t.k, left(btrim(t.v), 120)), '{}'::jsonb)
          from jsonb_each_text(_dados -> 'templates') as t(k, v)
         where t.k in ('lead', 'vendedor', 'followup', 'nutricao') and btrim(t.v) ~ '^[a-z0-9_]{1,120}$') else templates end,
    idioma = case when _dados ->> 'idioma' ~ '^[a-z]{2}(_[A-Z]{2})?$' then _dados ->> 'idioma' else idioma end,
    pontuacao = case when jsonb_typeof(_dados -> 'pontuacao') = 'object' then _dados -> 'pontuacao' else pontuacao end,
    followup_horas = _horas,
    atualizado_por = _eu,
    atualizado_em = now()
  where conta_id = _conta;

  insert into public.produto_historico (conta_id, ator, acao, detalhe)
  values (_conta, _eu, 'integracao_salva', jsonb_build_object('ativo', _ativo, 'modo', _modo));
  return public.crm_integracao_ler();
end;
$$;

revoke all on function public.crm_integracao_ler() from public, anon;
grant execute on function public.crm_integracao_ler() to authenticated;
revoke all on function public.crm_integracao_salvar(jsonb) from public, anon;
grant execute on function public.crm_integracao_salvar(jsonb) to authenticated;

-- Vendedores: a lista com bens, expediente e WhatsApp, e a gravacao de um.
create or replace function public.crm_vendedores_ler()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare _conta uuid := public.crm_conta_atual();
begin
  if _conta is null or not public.crm_sou_gestor() then
    raise exception 'Só o gerente ou quem administra a empresa vê os vendedores.' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'membro_id', m.id, 'user_id', m.user_id, 'nome', m.nome, 'papel', m.papel, 'cargo', m.cargo, 'estado', m.estado,
             'recebe_leads', coalesce(v.recebe_leads, true), 'bens', coalesce(to_jsonb(v.bens), '[]'::jsonb),
             'expediente', coalesce(v.expediente, '{}'::jsonb), 'whatsapp', v.whatsapp,
             'no_expediente', public.crm_no_expediente(coalesce(v.expediente, '{}'::jsonb), now()),
             'ultimo_lead_em', v.ultimo_lead_em)
             order by case m.papel when 'usuario' then 0 when 'gerente' then 1 else 2 end, m.nome), '[]'::jsonb)
      from public.produto_membros m
      left join public.crm_vendedores v on v.membro_id = m.id
     where m.conta_id = _conta and m.estado <> 'removido'
  );
end;
$$;

create or replace function public.crm_vendedor_salvar(_membro uuid, _dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _conta uuid := public.crm_conta_atual();
  _m public.produto_membros;
  _bens text[];
  _exp jsonb;
  _whats text;
begin
  if _conta is null or not public.crm_sou_gestor() then
    raise exception 'Só o gerente ou quem administra a empresa configura os vendedores.' using errcode = '42501';
  end if;
  select * into _m from public.produto_membros where id = _membro;
  if _m.id is null or _m.conta_id <> _conta or _m.estado = 'removido' then
    raise exception 'Pessoa não encontrada na empresa.' using errcode = '42501';
  end if;
  insert into public.crm_vendedores (membro_id, conta_id) values (_membro, _conta) on conflict (membro_id) do nothing;

  if jsonb_typeof(_dados -> 'bens') = 'array' then
    select coalesce(array_agg(distinct lower(left(btrim(b.v), 30))), '{}'::text[]) into _bens
      from jsonb_array_elements_text(_dados -> 'bens') as b(v) where btrim(b.v) ~ '^[A-Za-z0-9_ -]{2,30}$';
    _bens := _bens[1:12];
  end if;
  if jsonb_typeof(_dados -> 'expediente') = 'object' then
    _exp := _dados -> 'expediente';
    if _exp <> '{}'::jsonb and not (coalesce(_exp ->> 'inicio', '') ~ '^[0-2][0-9]:[0-5][0-9]$' and coalesce(_exp ->> 'fim', '') ~ '^[0-2][0-9]:[0-5][0-9]$'
         and _exp ->> 'inicio' < _exp ->> 'fim') then
      raise exception 'Diga o início e o fim do expediente, como 09:00 e 18:00.' using errcode = 'P0001';
    end if;
    if _exp <> '{}'::jsonb then
      _exp := jsonb_build_object('inicio', _exp ->> 'inicio', 'fim', _exp ->> 'fim', 'dias', (
        select coalesce(jsonb_agg(distinct d.v::integer), '[]'::jsonb) from jsonb_array_elements_text(
          case when jsonb_typeof(_exp -> 'dias') = 'array' then _exp -> 'dias' else '[]'::jsonb end) as d(v) where d.v ~ '^[1-7]$'));
    end if;
  end if;
  if _dados ? 'whatsapp' then
    _whats := nullif(regexp_replace(coalesce(_dados ->> 'whatsapp', ''), '\D', '', 'g'), '');
    if _whats is not null and _whats !~ '^[0-9]{10,15}$' then
      raise exception 'O WhatsApp precisa ter país e DDD, só números (5541999990000).' using errcode = 'P0001';
    end if;
  end if;

  update public.crm_vendedores set
    recebe_leads = case when _dados ? 'recebe_leads' then coalesce((_dados ->> 'recebe_leads')::boolean, true) else recebe_leads end,
    bens = coalesce(_bens, bens),
    expediente = coalesce(_exp, expediente),
    whatsapp = case when _dados ? 'whatsapp' then _whats else whatsapp end,
    atualizado_em = now()
  where membro_id = _membro;
end;
$$;

revoke all on function public.crm_vendedores_ler() from public, anon;
grant execute on function public.crm_vendedores_ler() to authenticated;
revoke all on function public.crm_vendedor_salvar(uuid, jsonb) from public, anon;
grant execute on function public.crm_vendedor_salvar(uuid, jsonb) to authenticated;

-- O que aconteceu por ultimo (leads da Meta e mensagens), para o gestor acompanhar. Sem tokens.
create or replace function public.crm_integracao_atividade(_limite integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare _conta uuid := public.crm_conta_atual();
begin
  if _conta is null or not public.crm_sou_gestor() then
    raise exception 'Só o gerente ou quem administra a empresa vê a atividade.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'leads', (select coalesce(jsonb_agg(to_jsonb(x) order by x.criado_em desc), '[]'::jsonb) from (
        select m.id, m.leadgen_id, m.form_id, m.situacao, m.de_teste, m.erro, m.criado_em, m.lead_id,
               l.name as nome, l.faixa, l.nota, l.fila_desde, l.nutricao,
               (select pm.nome from public.produto_membros pm where pm.conta_id = _conta and pm.user_id = l.owner_id and pm.estado = 'ativo' limit 1) as vendedor,
               m.dados ->> 'campaign_name' as campanha
          from public.crm_meta_leads m left join public.crm_leads l on l.id = m.lead_id
         where m.conta_id = _conta order by m.criado_em desc limit least(greatest(_limite, 1), 100)) x),
    'envios', (select coalesce(jsonb_agg(to_jsonb(y) order by y.criado_em desc), '[]'::jsonb) from (
        select e.id, e.destino, e.situacao, e.erro, e.criado_em, e.enviado_em, e.lead_id, e.corpo ->> 'type' as tipo,
               coalesce(e.corpo -> 'template' ->> 'name', left(e.corpo -> 'text' ->> 'body', 80), left(e.corpo -> 'interactive' -> 'body' ->> 'text', 80)) as resumo
          from public.crm_whats_envios e
         where e.conta_id = _conta order by e.criado_em desc limit least(greatest(_limite, 1), 100)) y)
  );
end;
$$;

revoke all on function public.crm_integracao_atividade(integer) from public, anon;
grant execute on function public.crm_integracao_atividade(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. O servico: achar a empresa pela chave do webhook (com os segredos) e registrar o lead
-- ---------------------------------------------------------------------------
create or replace function public.crm_integracao_por_chave(_chave text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'conta_id', i.conta_id, 'ativo', i.ativo, 'modo', i.modo, 'verify_token', i.verify_token,
    'liberada', c.crm_ativo and public.produto_conta_liberada(c.id),
    'empresa', c.nome, 'nicho', c.perfil ->> 'nicho',
    'pagina_id', i.pagina_id, 'formularios', to_jsonb(i.formularios),
    'app_secret', (select s.decrypted_secret from vault.decrypted_secrets s where s.id = i.app_secret_id),
    'token', (select s.decrypted_secret from vault.decrypted_secrets s where s.id = i.token_id),
    'wa_phone_id', i.wa_phone_id, 'wa_waba_id', i.wa_waba_id, 'wa_numero', i.wa_numero,
    'wa_token', coalesce((select s.decrypted_secret from vault.decrypted_secrets s where s.id = i.wa_token_id),
                         (select s.decrypted_secret from vault.decrypted_secrets s where s.id = i.token_id)),
    'templates', i.templates, 'idioma', i.idioma, 'pontuacao', i.pontuacao, 'followup_horas', to_jsonb(i.followup_horas))
    from public.crm_integracoes i
    join public.produto_contas c on c.id = i.conta_id
   where i.webhook_chave = _chave and _chave ~ '^[0-9a-f]{32}$'
$$;

-- A mesma leitura pela empresa (a rotina de envio e o teste pela tela usam).
create or replace function public.crm_integracao_da_conta(_conta uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.crm_integracao_por_chave(i.webhook_chave) from public.crm_integracoes i where i.conta_id = _conta
$$;

-- Registra o aviso da Meta uma vez so. Devolve se e novo.
create or replace function public.crm_meta_lead_registrar(_conta uuid, _leadgen_id text, _meta jsonb default '{}'::jsonb, _de_teste boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare _id uuid;
begin
  insert into public.crm_meta_leads (conta_id, leadgen_id, pagina_id, form_id, ad_id, adset_id, campaign_id, de_teste)
  values (_conta, _leadgen_id, _meta ->> 'page_id', _meta ->> 'form_id', _meta ->> 'ad_id', _meta ->> 'adgroup_id', _meta ->> 'campaign_id', coalesce(_de_teste, false))
  on conflict (conta_id, leadgen_id) do nothing
  returning id into _id;
  if _id is null then
    return jsonb_build_object('novo', false, 'id', (select m.id from public.crm_meta_leads m where m.conta_id = _conta and m.leadgen_id = _leadgen_id));
  end if;
  return jsonb_build_object('novo', true, 'id', _id);
end;
$$;

create or replace function public.crm_meta_lead_falhou(_registro uuid, _erro text, _situacao text default 'erro')
returns void
language sql
security definer
set search_path = ''
as $$
  update public.crm_meta_leads set situacao = case when _situacao in ('erro', 'ignorado') then _situacao else 'erro' end, erro = left(coalesce(_erro, ''), 300)
   where id = _registro
$$;

-- Cria o negocio a partir do lead da Meta, ja com nota e faixa, e decide o destino:
--   quente ou morno -> vendedor do rodizio (por bem e expediente); sem ninguem agora, fila;
--   frio            -> nutricao, sem vendedor.
-- _dados: { nome, whatsapp (so numeros), email, bem, valor_mensal, valor_avulso, campos {..}, respostas {..},
--           nota, faixa, motivos [..], origem { form_id, form_name, ad_id, ad_name, adset_id, campaign_id, campaign_name, plataforma } }
create or replace function public.crm_meta_lead_criar(_registro uuid, _dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _r public.crm_meta_leads;
  _d jsonb := case when jsonb_typeof(_dados) = 'object' then _dados else '{}'::jsonb end;
  _o jsonb;
  _nome text;
  _whats text;
  _email text;
  _bem text;
  _faixa text;
  _nota integer;
  _dono uuid;
  _lead uuid;
  _ja uuid;
  _clique jsonb;
  _fila timestamptz;
  _vend jsonb;
begin
  select * into _r from public.crm_meta_leads where id = _registro for update;
  if _r.id is null then
    raise exception 'registro inexistente' using errcode = 'P0001';
  end if;
  if _r.lead_id is not null then
    return jsonb_build_object('lead_id', _r.lead_id, 'repetido', true);
  end if;
  _o := case when jsonb_typeof(_d -> 'origem') = 'object' then _d -> 'origem' else '{}'::jsonb end;
  _nome := left(btrim(regexp_replace(coalesce(_d ->> 'nome', ''), '\s+', ' ', 'g')), 120);
  if length(_nome) < 2 then _nome := 'Lead da Meta'; end if;
  _whats := nullif(regexp_replace(coalesce(_d ->> 'whatsapp', ''), '\D', '', 'g'), '');
  if _whats is not null and _whats !~ '^[0-9]{10,15}$' then _whats := null; end if;
  _email := nullif(lower(left(btrim(coalesce(_d ->> 'email', '')), 254)), '');
  _bem := nullif(lower(left(btrim(coalesce(_d ->> 'bem', '')), 30)), '');
  _faixa := case when _d ->> 'faixa' in ('quente', 'morno', 'frio') then _d ->> 'faixa' else 'morno' end;
  _nota := least(greatest(coalesce(nullif(_d ->> 'nota', '')::integer, 0), 0), 100);

  -- A mesma pessoa com negocio aberto nao vira dois negocios: ganha uma nota no que ja existe.
  if _whats is not null or _email is not null then
    select l.id into _ja from public.crm_leads l
     where l.conta_id = _r.conta_id and l.archived_at is null and l.stage not in ('ganho', 'perdido')
       and ((_whats is not null and regexp_replace(coalesce(l.whatsapp, ''), '\D', '', 'g') = _whats) or (_email is not null and lower(l.email) = _email))
     order by l.created_at desc limit 1;
  end if;
  if _ja is not null then
    insert into public.crm_lead_events (conta_id, lead_id, kind, note)
    values (_r.conta_id, _ja, 'nota', left('Preencheu de novo o formulário da Meta' || coalesce(' (' || nullif(_o ->> 'campaign_name', '') || ')', '') || '.', 600));
    update public.crm_meta_leads set lead_id = _ja, situacao = 'repetido', dados = _d - 'respostas' || jsonb_build_object('respostas', coalesce(_d -> 'respostas', '{}'::jsonb)) where id = _r.id;
    return jsonb_build_object('lead_id', _ja, 'repetido', true);
  end if;

  if _faixa in ('quente', 'morno') then
    _dono := public.crm_rodizio_por_bem(_r.conta_id, _bem, now());
    if _dono is null then _fila := now(); end if;
  end if;

  _clique := jsonb_strip_nulls(jsonb_build_object(
    'leadgen_id', _r.leadgen_id, 'plataforma', coalesce(nullif(_o ->> 'plataforma', ''), 'meta'),
    'form_id', coalesce(_r.form_id, _o ->> 'form_id'), 'formulario', nullif(left(coalesce(_o ->> 'form_name', ''), 150), ''),
    'ad_id', coalesce(_r.ad_id, _o ->> 'ad_id'), 'anuncio', nullif(left(coalesce(_o ->> 'ad_name', ''), 150), ''),
    'adset_id', coalesce(_r.adset_id, _o ->> 'adset_id'),
    'campaign_id', coalesce(_r.campaign_id, _o ->> 'campaign_id'), 'utm_campaign', nullif(left(coalesce(_o ->> 'campaign_name', ''), 150), ''),
    'utm_source', 'meta', 'utm_medium', 'lead_ads'));

  -- As automacoes genericas de "negocio criado" nao rodam aqui: este caminho ja pontua e distribui.
  perform set_config('crm.automacao', '1', true);
  insert into public.crm_leads (conta_id, name, email, whatsapp, origin, stage, owner_id, monthly_value, one_off_value,
                                campos, origem_clique, nota, faixa, nota_motivos, fila_desde, nutricao, notes)
  values (_r.conta_id, _nome, _email, _whats, 'meta', 'novo', _dono,
          least(greatest(coalesce(nullif(_d ->> 'valor_mensal', '')::numeric, 0), 0), 99999999),
          least(greatest(coalesce(nullif(_d ->> 'valor_avulso', '')::numeric, 0), 0), 9999999999),
          case when jsonb_typeof(_d -> 'campos') = 'object' and pg_column_size(_d -> 'campos') <= 12000 then _d -> 'campos' else '{}'::jsonb end,
          _clique, _nota, _faixa,
          case when jsonb_typeof(_d -> 'motivos') = 'array' and pg_column_size(_d -> 'motivos') <= 3500 then _d -> 'motivos' else '[]'::jsonb end,
          _fila, _faixa = 'frio',
          nullif(left(coalesce(_d ->> 'notas', ''), 2000), ''))
  returning id into _lead;
  perform set_config('crm.automacao', '', true);

  insert into public.crm_lead_events (conta_id, lead_id, kind, note)
  values (_r.conta_id, _lead, 'nota', left('Entrou pelo formulário da Meta' || coalesce(' "' || nullif(_o ->> 'form_name', '') || '"', '')
          || '. Nota ' || _nota || ' (' || _faixa || ').'
          || case when _faixa = 'frio' then ' Foi para a nutrição.' when _dono is null then ' Ninguém no expediente: aguarda na fila.' else '' end, 600));

  update public.crm_meta_leads set lead_id = _lead, situacao = 'criado', dados = _d where id = _r.id;

  if _dono is not null then
    update public.crm_vendedores v set ultimo_lead_em = now()
      from public.produto_membros m where m.id = v.membro_id and m.conta_id = _r.conta_id and m.user_id = _dono;
    insert into public.crm_avisos (conta_id, para, titulo, texto, lead_id)
    values (_r.conta_id, _dono, case _faixa when 'quente' then 'Lead quente para você' else 'Lead novo para você' end, left(_nome, 200), _lead);
    select jsonb_build_object('user_id', m.user_id, 'nome', m.nome, 'whatsapp', v.whatsapp) into _vend
      from public.produto_membros m left join public.crm_vendedores v on v.membro_id = m.id
     where m.conta_id = _r.conta_id and m.user_id = _dono and m.estado = 'ativo' limit 1;
  end if;
  return jsonb_build_object('lead_id', _lead, 'repetido', false, 'faixa', _faixa, 'nota', _nota, 'owner_id', _dono,
                            'na_fila', _fila is not null, 'nutricao', _faixa = 'frio', 'vendedor', _vend);
end;
$$;

-- Quem estava na fila ganha vendedor quando alguem entra no expediente. Devolve o que distribuiu.
create or replace function public.crm_fila_distribuir()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _l record;
  _dono uuid;
  _feitos jsonb := '[]'::jsonb;
begin
  perform set_config('crm.automacao', '1', true);
  for _l in
    select l.id, l.conta_id, l.name, l.faixa, l.campos ->> 'tipo_de_bem' as bem
      from public.crm_leads l
      join public.crm_integracoes i on i.conta_id = l.conta_id and i.ativo
     where l.fila_desde is not null and l.owner_id is null and l.archived_at is null and l.stage not in ('ganho', 'perdido')
     order by l.fila_desde limit 200
     for update of l skip locked
  loop
    _dono := public.crm_rodizio_por_bem(_l.conta_id, lower(_l.bem), now());
    if _dono is not null then
      update public.crm_leads set owner_id = _dono, fila_desde = null where id = _l.id;
      update public.crm_vendedores v set ultimo_lead_em = now()
        from public.produto_membros m where m.id = v.membro_id and m.conta_id = _l.conta_id and m.user_id = _dono;
      insert into public.crm_avisos (conta_id, para, titulo, texto, lead_id)
      values (_l.conta_id, _dono, 'Lead da fila para você', left(_l.name, 200), _l.id);
      _feitos := _feitos || jsonb_build_object('lead_id', _l.id, 'conta_id', _l.conta_id, 'owner_id', _dono);
    end if;
  end loop;
  perform set_config('crm.automacao', '', true);
  return _feitos;
end;
$$;

-- O robo requalifica depois das respostas no WhatsApp: nova nota e faixa, e o destino acompanha
-- (esfriou -> nutricao e solta o vendedor; esquentou sem vendedor -> rodizio ou fila).
create or replace function public.crm_lead_requalificar(_lead uuid, _nota integer, _faixa text, _motivos jsonb default '[]'::jsonb, _campos jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _l public.crm_leads;
  _dono uuid;
  _fila timestamptz;
begin
  select * into _l from public.crm_leads where id = _lead for update;
  if _l.id is null or _faixa not in ('quente', 'morno', 'frio') then
    raise exception 'negócio ou faixa inválidos' using errcode = 'P0001';
  end if;
  _dono := _l.owner_id;
  _fila := _l.fila_desde;
  if _faixa = 'frio' then
    _fila := null;
  elsif _dono is null then
    _dono := public.crm_rodizio_por_bem(_l.conta_id, lower(coalesce(_campos ->> 'tipo_de_bem', _l.campos ->> 'tipo_de_bem')), now());
    _fila := case when _dono is null then coalesce(_l.fila_desde, now()) end;
  end if;
  perform set_config('crm.automacao', '1', true);
  update public.crm_leads set
    nota = least(greatest(coalesce(_nota, 0), 0), 100), faixa = _faixa,
    nota_motivos = case when jsonb_typeof(_motivos) = 'array' and pg_column_size(_motivos) <= 3500 then _motivos else nota_motivos end,
    campos = case when jsonb_typeof(_campos) = 'object' and pg_column_size(campos || _campos) <= 15000 then campos || _campos else campos end,
    nutricao = _faixa = 'frio', owner_id = _dono, fila_desde = _fila
  where id = _lead;
  perform set_config('crm.automacao', '', true);
  if _dono is not null and _l.owner_id is null then
    update public.crm_vendedores v set ultimo_lead_em = now()
      from public.produto_membros m where m.id = v.membro_id and m.conta_id = _l.conta_id and m.user_id = _dono;
    insert into public.crm_avisos (conta_id, para, titulo, texto, lead_id)
    values (_l.conta_id, _dono, 'Lead qualificado para você', left(_l.name, 200), _lead);
  end if;
  return jsonb_build_object('lead_id', _lead, 'faixa', _faixa, 'owner_id', _dono, 'na_fila', _fila is not null, 'nutricao', _faixa = 'frio',
    'vendedor', (select jsonb_build_object('user_id', m.user_id, 'nome', m.nome, 'whatsapp', v.whatsapp)
                   from public.produto_membros m left join public.crm_vendedores v on v.membro_id = m.id
                  where m.conta_id = _l.conta_id and m.user_id = _dono and m.estado = 'ativo' limit 1));
end;
$$;

-- O vendedor toca um botao no aviso do WhatsApp e o negocio anda. So vale se o telefone e do responsavel.
--   atendi -> Em contato; simulacao -> Proposta; vendeu -> Ganho; sem_resposta -> so anota.
create or replace function public.crm_lead_avancar(_lead uuid, _acao text, _telefone text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _l public.crm_leads;
  _tel text := regexp_replace(coalesce(_telefone, ''), '\D', '', 'g');
  _vend record;
  _para text;
  _ordem text[] := array['novo', 'contato', 'diagnostico', 'proposta', 'negociacao', 'ganho'];
begin
  select * into _l from public.crm_leads where id = _lead for update;
  if _l.id is null or _l.archived_at is not null then
    return jsonb_build_object('ok', false, 'motivo', 'inexistente');
  end if;
  select m.user_id, m.nome into _vend
    from public.crm_vendedores v join public.produto_membros m on m.id = v.membro_id
   where v.conta_id = _l.conta_id and m.estado = 'ativo' and v.whatsapp is not null
     and right(v.whatsapp, 8) = right(_tel, 8) and length(_tel) >= 10
   limit 1;
  if _vend.user_id is null or (_l.owner_id is not null and _l.owner_id <> _vend.user_id) then
    return jsonb_build_object('ok', false, 'motivo', 'nao_e_o_responsavel');
  end if;
  _para := case _acao when 'atendi' then 'contato' when 'simulacao' then 'proposta' when 'vendeu' then 'ganho' end;
  if _acao = 'sem_resposta' then
    insert into public.crm_lead_events (conta_id, lead_id, kind, note, created_by)
    values (_l.conta_id, _l.id, 'nota', _vend.nome || ' avisou pelo WhatsApp: o lead não respondeu.', _vend.user_id);
    return jsonb_build_object('ok', true, 'etapa', _l.stage);
  end if;
  if _para is null then
    return jsonb_build_object('ok', false, 'motivo', 'acao_desconhecida');
  end if;
  -- Nao volta de etapa: quem ja esta adiante fica onde esta.
  if _l.stage in ('ganho', 'perdido') or array_position(_ordem, _l.stage) >= array_position(_ordem, _para) then
    return jsonb_build_object('ok', true, 'etapa', _l.stage, 'sem_mudanca', true);
  end if;
  update public.crm_leads set stage = _para, owner_id = coalesce(owner_id, _vend.user_id), fila_desde = null,
         closed_at = case when _para = 'ganho' then now() else closed_at end
   where id = _l.id;
  insert into public.crm_lead_events (conta_id, lead_id, kind, from_stage, to_stage, note, created_by)
  values (_l.conta_id, _l.id, 'stage', _l.stage, _para, 'Marcado por ' || _vend.nome || ' pelo WhatsApp.', _vend.user_id);
  return jsonb_build_object('ok', true, 'etapa', _para);
end;
$$;

do $$
declare _f text;
begin
  foreach _f in array array[
    'crm_integracao_por_chave(text)', 'crm_integracao_da_conta(uuid)', 'crm_meta_lead_registrar(uuid, text, jsonb, boolean)',
    'crm_meta_lead_falhou(uuid, text, text)', 'crm_meta_lead_criar(uuid, jsonb)', 'crm_fila_distribuir()',
    'crm_lead_requalificar(uuid, integer, text, jsonb, jsonb)', 'crm_lead_avancar(uuid, text, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', _f);
    execute format('grant execute on function public.%s to service_role', _f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Conversoes para a Meta: as etapas do lead do formulario voltam com o lead_id
-- ---------------------------------------------------------------------------
do $$
declare _c text;
begin
  for _c in
    select conname from pg_constraint
     where conrelid = 'public.crm_conversoes'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%Purchase%'
  loop
    execute format('alter table public.crm_conversoes drop constraint %I', _c);
  end loop;
end;
$$;

-- QualifiedLead e SimulationCompleted saem sempre que a empresa tem pixel e token (nao dependem da lista de eventos).
alter table public.crm_conversoes
  add constraint crm_conversoes_evento_check check (evento in ('Lead', 'Purchase', 'QualifiedLead', 'SimulationCompleted'));

create or replace function public.crm_conversoes_do_negocio()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _r public.crm_rastreamento;
  _clique jsonb;
  _da_meta boolean;
  _ordem text[] := array['novo', 'contato', 'diagnostico', 'proposta', 'negociacao', 'ganho'];
begin
  begin
    -- Negocio reaberto antes do envio: a venda que ainda nao foi para a Meta sai da fila.
    if tg_op = 'UPDATE' and old.stage = 'ganho' and new.stage <> 'ganho' then
      delete from public.crm_conversoes where lead_id = new.id and evento = 'Purchase' and situacao = 'pendente';
    end if;

    select * into _r from public.crm_rastreamento where conta_id = new.conta_id;
    if _r.conta_id is null or _r.meta_pixel_id is null or _r.meta_token_secret_id is null then
      return new;
    end if;
    _clique := case when jsonb_typeof(new.origem_clique) = 'object' then new.origem_clique else '{}'::jsonb end;
    _da_meta := _clique ? 'leadgen_id';

    if tg_op = 'INSERT' and _clique ? 'formulario_id' and new.archived_at is null and 'Lead' = any (_r.eventos) then
      insert into public.crm_conversoes (conta_id, lead_id, evento, valor, dados)
      values (new.conta_id, new.id, 'Lead', 0, _clique)
      on conflict (lead_id, evento) do nothing;
    end if;

    -- Lead do formulario da Meta: qualificou (quente ou morno) e fez a simulacao (chegou em Proposta ou adiante).
    if _da_meta and new.archived_at is null then
      if new.faixa in ('quente', 'morno') and (tg_op = 'INSERT' or old.faixa is distinct from new.faixa) then
        insert into public.crm_conversoes (conta_id, lead_id, evento, valor, dados)
        values (new.conta_id, new.id, 'QualifiedLead', 0, _clique)
        on conflict (lead_id, evento) do nothing;
      end if;
      if array_position(_ordem, new.stage) >= 4 and (tg_op = 'INSERT' or coalesce(array_position(_ordem, old.stage), 0) < 4) then
        insert into public.crm_conversoes (conta_id, lead_id, evento, valor, dados)
        values (new.conta_id, new.id, 'SimulationCompleted', public.crm_valor_do_negocio(new.monthly_value, new.one_off_value), _clique)
        on conflict (lead_id, evento) do nothing;
      end if;
    end if;

    if new.stage = 'ganho' and (tg_op = 'INSERT' or old.stage is distinct from 'ganho') and 'Purchase' = any (_r.eventos) then
      insert into public.crm_conversoes (conta_id, lead_id, evento, valor, dados)
      values (new.conta_id, new.id, 'Purchase', public.crm_valor_do_negocio(new.monthly_value, new.one_off_value), _clique)
      on conflict (lead_id, evento) do nothing;
    end if;
  exception when others then
    raise warning 'crm conversoes: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists crm_conversoes_do_negocio_trg on public.crm_leads;
create trigger crm_conversoes_do_negocio_trg
  after insert or update of stage, faixa on public.crm_leads
  for each row execute function public.crm_conversoes_do_negocio();
