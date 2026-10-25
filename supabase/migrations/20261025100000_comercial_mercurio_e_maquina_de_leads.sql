-- Comercial com o Mercúrio e a Máquina de leads (25/10/2026). Contrato: docs/comercial/MERCURIO.md.
-- Pedido do dono: "o Mercúrio, que é o comercial, vai ficar ativo e ser o vendedor ativo para ir atrás dos
-- clientes e receber mensagem e registrar tudo; ter uma caixinha aonde ele avisa só os que avançaram ou fecharam,
-- com dados, contexto e o telefone, fácil só clicar e continuar comigo; notificação comercial; ligar com as
-- campanhas de Ads com opção de selecionar, e nas campanhas eu sempre escolher usar ou não; máquina de leads".
-- Só amplia e é idempotente (pode rodar de novo).
--
-- 1) commercial_leads: agente_slug (quem atende: 'mercurio' ou nulo) e ads_campaign_id (a campanha da Meta,
--    tirada sozinha de origem_clique). commercial_campaigns: meta_campaign_ids (as campanhas da Meta escolhidas)
--    e mercurio_ativo (a equipe escolhe se o Mercúrio atende os leads da campanha).
--    Gatilho: lead novo da casa (sem qualificacao.client_id: lead de site de cliente não é venda da Aceleriq)
--    ganha a campanha interna pela campanha da Meta e, com mercurio_ativo, o Mercúrio.
-- 2) commercial_lead_messages: a conversa do lead (entrada e saída, canal, quem escreveu, id externo idempotente).
-- 3) commercial_handoffs: a Caixa do comercial. O Mercúrio avisa só quem avançou ou fechou, com resumo,
--    próximo passo, telefone e os dados. Avisa no sino (tipo 'commercial_caixa') a todo admin e manager.
-- 4) commercial_facts: o que o agente levantou, com a prova (evidência e fonte). A prova forte grava; o resto
--    fica como sugestão para a equipe confirmar (regra em _shared/comercial-evidencia.ts).
-- 5) commercial_agente_config: liga e desliga o Mercúrio e o teto de primeiros contatos por dia.
-- 6) leads_buscas e leads_candidatos: a Máquina de leads (worker da casa com Scrapling); leads_busca_pegar
--    entrega a próxima busca a um worker (FOR UPDATE SKIP LOCKED) e devolve as presas há mais de 15 min.
-- RLS: admin e manager, como o resto do comercial. Funções de worker só para service_role.

-- ---------------------------------------------------------------------------
-- 1. Quem atende e a campanha da Meta
-- ---------------------------------------------------------------------------
alter table public.commercial_leads add column if not exists agente_slug text;
alter table public.commercial_leads add column if not exists agente_desde timestamptz;
alter table public.commercial_leads add column if not exists ads_campaign_id text;

create index if not exists commercial_leads_por_agente
  on public.commercial_leads (agente_slug, updated_at desc) where agente_slug is not null and archived_at is null;
create index if not exists commercial_leads_por_campanha_meta
  on public.commercial_leads (ads_campaign_id) where ads_campaign_id is not null;

alter table public.commercial_campaigns add column if not exists meta_campaign_ids text[] not null default '{}';
alter table public.commercial_campaigns add column if not exists mercurio_ativo boolean not null default false;

create or replace function public.commercial_lead_campanha_e_agente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _campanha record;
begin
  if new.ads_campaign_id is null and new.origem_clique is not null then
    new.ads_campaign_id := nullif(left(coalesce(new.origem_clique->>'campaign_id', ''), 64), '');
  end if;
  -- Lead de site de cliente (qualificacao.client_id) não é venda da casa: sem campanha interna e sem Mercúrio.
  if coalesce(new.qualificacao->>'client_id', '') <> '' then
    return new;
  end if;
  if new.ads_campaign_id is not null and (new.campaign_id is null or tg_op = 'INSERT') then
    select c.id, c.mercurio_ativo into _campanha
    from public.commercial_campaigns c
    where c.archived_at is null and new.ads_campaign_id = any(c.meta_campaign_ids)
    order by c.created_at desc
    limit 1;
    if found then
      if new.campaign_id is null then new.campaign_id := _campanha.id; end if;
      if tg_op = 'INSERT' and new.agente_slug is null and _campanha.mercurio_ativo then
        new.agente_slug := 'mercurio';
      end if;
    end if;
  end if;
  if tg_op = 'INSERT' and new.agente_slug is null and new.campaign_id is not null then
    if exists (select 1 from public.commercial_campaigns c where c.id = new.campaign_id and c.mercurio_ativo) then
      new.agente_slug := 'mercurio';
    end if;
  end if;
  if new.agente_slug is not null and (tg_op = 'INSERT' or old.agente_slug is distinct from new.agente_slug) then
    new.agente_desde := now();
  end if;
  if new.agente_slug is null then
    new.agente_desde := null;
  end if;
  return new;
end;
$$;

drop trigger if exists commercial_lead_campanha_e_agente_trg on public.commercial_leads;
create trigger commercial_lead_campanha_e_agente_trg
  before insert or update of origem_clique, campaign_id, ads_campaign_id, agente_slug on public.commercial_leads
  for each row execute function public.commercial_lead_campanha_e_agente();

-- ---------------------------------------------------------------------------
-- 2. A conversa do lead
-- ---------------------------------------------------------------------------
create table if not exists public.commercial_lead_messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.commercial_leads(id) on delete cascade,
  direcao text not null check (direcao in ('entrada', 'saida')),
  canal text not null default 'whatsapp' check (canal in ('whatsapp', 'instagram', 'email', 'telefone', 'site', 'outro')),
  texto text not null check (length(texto) between 1 and 8000),
  enviada_em timestamptz not null default now(),
  -- Quem escreveu do nosso lado: o agente (slug) ou a pessoa (autor_id). Entrada fica sem os dois.
  operador_slug text,
  autor_id uuid,
  -- O id da mensagem no canal (WhatsApp do Hermes, Instagram...): registrar duas vezes não duplica.
  id_externo text,
  created_at timestamptz not null default now()
);

create index if not exists commercial_lead_messages_por_lead
  on public.commercial_lead_messages (lead_id, enviada_em desc);
create unique index if not exists commercial_lead_messages_externo_unico
  on public.commercial_lead_messages (lead_id, id_externo) where id_externo is not null;

-- ---------------------------------------------------------------------------
-- 3. A Caixa do comercial (só quem avançou ou fechou)
-- ---------------------------------------------------------------------------
create table if not exists public.commercial_handoffs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.commercial_leads(id) on delete cascade,
  tipo text not null check (tipo in ('avancou', 'fechou')),
  resumo text not null check (length(resumo) between 1 and 2000),
  proximo_passo text,
  telefone text,
  dados jsonb not null default '{}'::jsonb,
  operador_slug text not null default 'mercurio',
  situacao text not null default 'nova' check (situacao in ('nova', 'assumida', 'concluida')),
  assumida_por uuid,
  assumida_em timestamptz,
  concluida_em timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists commercial_handoffs_abertas
  on public.commercial_handoffs (situacao, created_at desc);
create index if not exists commercial_handoffs_por_lead
  on public.commercial_handoffs (lead_id, created_at desc);

create or replace function public.commercial_handoff_avisar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _lead record;
begin
  select l.name, l.company into _lead from public.commercial_leads l where l.id = new.lead_id;
  insert into public.commercial_lead_events (lead_id, kind, note)
  values (new.lead_id, 'agente', format('%s (%s): %s', case when new.tipo = 'fechou' then 'Fechou' else 'Avançou' end, new.operador_slug, left(new.resumo, 400)));
  insert into public.notifications (user_id, message, notification_type, link)
  select distinct r.user_id,
    format('%s: %s %s · %s',
      initcap(new.operador_slug),
      coalesce(nullif(_lead.company, ''), _lead.name, 'lead'),
      case when new.tipo = 'fechou' then 'fechou' else 'avançou' end,
      left(new.resumo, 140)),
    'commercial_caixa',
    format('/comercial/caixa?item=%s', new.id)
  from public.user_roles r
  where r.role in ('admin'::public.app_role, 'manager'::public.app_role);
  return new;
end;
$$;

drop trigger if exists commercial_handoff_avisar_trg on public.commercial_handoffs;
create trigger commercial_handoff_avisar_trg
  after insert on public.commercial_handoffs
  for each row execute function public.commercial_handoff_avisar();

-- ---------------------------------------------------------------------------
-- 4. Fatos com prova
-- ---------------------------------------------------------------------------
create table if not exists public.commercial_facts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.commercial_leads(id) on delete cascade,
  organization_id uuid references public.commercial_organizations(id) on delete cascade,
  campo text not null check (length(campo) between 1 and 60),
  valor text not null check (length(valor) between 1 and 1000),
  evidencia text not null check (length(evidencia) between 1 and 60),
  detalhe text,
  fonte_url text,
  situacao text not null check (situacao in ('gravado', 'sugestao', 'descartado')),
  operador_slug text,
  decidido_por uuid,
  decidido_em timestamptz,
  created_at timestamptz not null default now(),
  check (lead_id is not null or organization_id is not null)
);

create index if not exists commercial_facts_por_lead on public.commercial_facts (lead_id, created_at desc) where lead_id is not null;
create index if not exists commercial_facts_por_empresa on public.commercial_facts (organization_id, created_at desc) where organization_id is not null;

-- ---------------------------------------------------------------------------
-- 5. Configuração do agente comercial
-- ---------------------------------------------------------------------------
create table if not exists public.commercial_agente_config (
  slug text primary key,
  ativo boolean not null default true,
  -- Teto de PRIMEIROS contatos por dia (lead frio, da prospecção): conversa já aberta não conta.
  limite_primeiros_contatos_dia integer not null default 20 check (limite_primeiros_contatos_dia between 0 and 500),
  horario_inicio time not null default '09:00',
  horario_fim time not null default '18:00',
  orientacoes text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into public.commercial_agente_config (slug) values ('mercurio') on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- 6. Máquina de leads
-- ---------------------------------------------------------------------------
create table if not exists public.leads_buscas (
  id uuid primary key default gen_random_uuid(),
  nicho text not null check (length(nicho) between 2 and 120),
  cidade text not null check (length(cidade) between 2 and 120),
  uf text,
  fontes text[] not null default array['osm', 'sites']::text[],
  limite integer not null default 50 check (limite between 1 and 300),
  situacao text not null default 'na_fila' check (situacao in ('na_fila', 'rodando', 'pronta', 'falhou', 'cancelada')),
  erro text,
  encontrados integer not null default 0,
  progresso jsonb not null default '{}'::jsonb,
  campanha_id uuid references public.commercial_campaigns(id) on delete set null,
  entregar_ao_mercurio boolean not null default false,
  criado_por uuid,
  worker text,
  pego_em timestamptz,
  terminado_em timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists leads_buscas_fila on public.leads_buscas (situacao, created_at);

create table if not exists public.leads_candidatos (
  id uuid primary key default gen_random_uuid(),
  busca_id uuid not null references public.leads_buscas(id) on delete cascade,
  chave text not null,
  nome text not null,
  categoria text,
  site text,
  telefone text,
  whatsapp text,
  email text,
  instagram text,
  endereco text,
  cidade text,
  fonte text not null,
  fonte_url text,
  evidencias jsonb not null default '[]'::jsonb,
  nota numeric(4, 1),
  porque text,
  situacao text not null default 'novo' check (situacao in ('novo', 'importado', 'descartado')),
  lead_id uuid references public.commercial_leads(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (busca_id, chave)
);

create index if not exists leads_candidatos_por_busca on public.leads_candidatos (busca_id, nota desc nulls last, created_at);

-- O worker pega a próxima busca (e devolve a que ficou presa num worker que morreu).
create or replace function public.leads_busca_pegar(_worker text)
returns setof public.leads_buscas
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.leads_buscas
  set situacao = 'na_fila', worker = null, pego_em = null
  where situacao = 'rodando' and pego_em < now() - interval '15 minutes';
  return query
  update public.leads_buscas b
  set situacao = 'rodando', worker = left(coalesce(_worker, 'worker'), 80), pego_em = now(), erro = null
  where b.id = (
    select x.id from public.leads_buscas x
    where x.situacao = 'na_fila'
    order by x.created_at
    for update skip locked
    limit 1
  )
  returning b.*;
end;
$$;

revoke all on function public.leads_busca_pegar(text) from public, anon, authenticated;
grant execute on function public.leads_busca_pegar(text) to service_role;

-- ---------------------------------------------------------------------------
-- RLS: admin e manager (como o resto do comercial)
-- ---------------------------------------------------------------------------
do $$
declare
  _t text;
begin
  foreach _t in array array['commercial_lead_messages', 'commercial_handoffs', 'commercial_facts', 'commercial_agente_config', 'leads_buscas', 'leads_candidatos'] loop
    execute format('alter table public.%I enable row level security', _t);
    execute format('drop policy if exists "comercial admin e manager" on public.%I', _t);
    execute format($p$create policy "comercial admin e manager" on public.%I
      for all to authenticated
      using (public.has_role(auth.uid(), 'admin'::public.app_role) or public.has_role(auth.uid(), 'manager'::public.app_role))
      with check (public.has_role(auth.uid(), 'admin'::public.app_role) or public.has_role(auth.uid(), 'manager'::public.app_role))$p$, _t);
  end loop;
end;
$$;

-- Conferência depois de aplicar (todas true):
-- select to_regclass('public.commercial_handoffs') is not null, to_regclass('public.leads_candidatos') is not null,
--   exists (select 1 from information_schema.columns where table_name = 'commercial_leads' and column_name = 'agente_slug'),
--   exists (select 1 from public.commercial_agente_config where slug = 'mercurio');
