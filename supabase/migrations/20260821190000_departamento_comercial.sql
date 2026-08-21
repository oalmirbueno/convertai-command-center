-- Departamento Comercial: onde a Aceleriq vende, mede e cobra a si mesma.
--
-- O painel sabia tudo sobre o trabalho DEPOIS que o cliente assina — ciclo,
-- entregas, financeiro. Antes disso não havia nada: lead vivia em conversa
-- de WhatsApp, meta na cabeça do dono, campanha da própria agência em lugar
-- nenhum. As duas únicas pontas que existiam eram `quiz_submissions` (quem
-- preencheu o diagnóstico) e `financial_entries` (o dinheiro que entrou) —
-- sem nada ligando uma na outra.
--
-- Quatro tabelas, e a razão de cada uma:
--
-- · commercial_campaigns — o que a Aceleriq investe para aparecer. Vem
--   primeiro porque o lead aponta para ela.
-- · commercial_leads     — o funil. Guarda o valor proposto separado em
--   mensalidade e entrada, que é como a casa vende, e aponta para o cliente
--   criado quando fecha: é esse elo que deixa o financeiro responder
--   "quanto aquele lead virou".
-- · commercial_lead_events — a história do lead. Existe porque "em que pé
--   está" sem "como chegou aqui" vira adivinhação na semana seguinte.
-- · commercial_goals     — a meta do mês. Só o alvo mora aqui; o realizado
--   NÃO é copiado, é lido do financeiro na hora. Número de dinheiro copiado
--   diverge do original no primeiro acerto, e aí duas telas discordam sobre
--   o mesmo mês.
--
-- QUEM VÊ: admin e manager. Nada disto é do cliente — é gestão de dentro de
-- casa —, e nem toda a equipe: design e tráfego operam entrega, não vendem.
-- As políticas usam has_role direto, sem função nova, para que a régua fique
-- visível na própria política em vez de escondida em mais um nível.

-- ───────────────────────────── Campanhas ──────────────────────────────────

create table if not exists public.commercial_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Canal é texto livre com valores sugeridos na tela, não enum: cada canal
  -- novo viraria uma migration, e o comercial testa canal o tempo todo.
  channel text not null default 'outro',
  status text not null default 'ativa',
  starts_on date,
  ends_on date,
  budget numeric(12,2) not null default 0,
  spent numeric(12,2) not null default 0,
  goal text,
  notes text,
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────── Leads ────────────────────────────────────

create table if not exists public.commercial_leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  email text,
  whatsapp text,
  origin text not null default 'manual',
  campaign_id uuid references public.commercial_campaigns(id) on delete set null,
  -- O diagnóstico já existia e já trazia gente qualificada; sem este elo,
  -- puxar um lead do quiz para o funil seria recadastrar na mão.
  quiz_submission_id uuid references public.quiz_submissions(id) on delete set null,
  stage text not null default 'novo',
  -- Separado porque é assim que a casa vende: mensalidade sustenta o mês,
  -- entrada entra uma vez. Somar os dois num campo só faria a meta de MRR
  -- mentir toda vez que houvesse projeto avulso junto.
  monthly_value numeric(12,2) not null default 0,
  one_off_value numeric(12,2) not null default 0,
  owner_id uuid,
  next_action text,
  next_action_at date,
  notes text,
  lost_reason text,
  -- Preenchido quando o lead vira cliente: é a ponte para o financeiro.
  won_client_id uuid references public.profiles(id) on delete set null,
  closed_at timestamptz,
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Um lead por submissão de quiz: puxar duas vezes criaria funil duplicado
-- para a mesma pessoa, e a taxa de conversão passaria a mentir.
create unique index if not exists commercial_leads_quiz_unico
  on public.commercial_leads (quiz_submission_id)
  where quiz_submission_id is not null;

create index if not exists commercial_leads_por_estagio
  on public.commercial_leads (stage) where archived_at is null;
create index if not exists commercial_leads_por_campanha
  on public.commercial_leads (campaign_id) where campaign_id is not null;
create index if not exists commercial_leads_por_fechamento
  on public.commercial_leads (closed_at) where closed_at is not null;

-- ─────────────────────────── História do lead ─────────────────────────────

create table if not exists public.commercial_lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.commercial_leads(id) on delete cascade,
  kind text not null default 'nota',
  from_stage text,
  to_stage text,
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists commercial_lead_events_por_lead
  on public.commercial_lead_events (lead_id, created_at desc);

-- ──────────────────────────────── Metas ───────────────────────────────────

create table if not exists public.commercial_goals (
  id uuid primary key default gen_random_uuid(),
  -- Sempre o dia 1: a meta é do MÊS, e guardar o dia real deixaria duas
  -- metas do mesmo mês conviverem sem que a chave única percebesse.
  period date not null,
  metric text not null,
  target numeric(14,2) not null,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_goals_periodo_metrica unique (period, metric),
  constraint commercial_goals_dia_primeiro check (date_trunc('month', period) = period),
  constraint commercial_goals_alvo_positivo check (target > 0)
);

-- ──────────────────────── updated_at, como o resto ────────────────────────

drop trigger if exists commercial_campaigns_updated_at on public.commercial_campaigns;
create trigger commercial_campaigns_updated_at
  before update on public.commercial_campaigns
  for each row execute function public.update_updated_at_column();

drop trigger if exists commercial_leads_updated_at on public.commercial_leads;
create trigger commercial_leads_updated_at
  before update on public.commercial_leads
  for each row execute function public.update_updated_at_column();

drop trigger if exists commercial_goals_updated_at on public.commercial_goals;
create trigger commercial_goals_updated_at
  before update on public.commercial_goals
  for each row execute function public.update_updated_at_column();

-- ──────────────────────────────── Acesso ──────────────────────────────────
--
-- Cliente não vê; design e tráfego também não. A política é a mesma nas
-- quatro tabelas de propósito: régua repetida com texto diferente diverge no
-- primeiro conserto, e a de acesso é a pior para divergir.

alter table public.commercial_campaigns enable row level security;
alter table public.commercial_leads enable row level security;
alter table public.commercial_lead_events enable row level security;
alter table public.commercial_goals enable row level security;

drop policy if exists "comercial admin e manager" on public.commercial_campaigns;
create policy "comercial admin e manager" on public.commercial_campaigns
  for all to authenticated
  using (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or public.has_role(auth.uid(), 'manager'::public.app_role)
  )
  with check (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or public.has_role(auth.uid(), 'manager'::public.app_role)
  );

drop policy if exists "comercial admin e manager" on public.commercial_leads;
create policy "comercial admin e manager" on public.commercial_leads
  for all to authenticated
  using (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or public.has_role(auth.uid(), 'manager'::public.app_role)
  )
  with check (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or public.has_role(auth.uid(), 'manager'::public.app_role)
  );

drop policy if exists "comercial admin e manager" on public.commercial_lead_events;
create policy "comercial admin e manager" on public.commercial_lead_events
  for all to authenticated
  using (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or public.has_role(auth.uid(), 'manager'::public.app_role)
  )
  with check (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or public.has_role(auth.uid(), 'manager'::public.app_role)
  );

drop policy if exists "comercial admin e manager" on public.commercial_goals;
create policy "comercial admin e manager" on public.commercial_goals
  for all to authenticated
  using (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or public.has_role(auth.uid(), 'manager'::public.app_role)
  )
  with check (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or public.has_role(auth.uid(), 'manager'::public.app_role)
  );

-- anon não tem o que fazer aqui em nenhuma hipótese.
revoke all on public.commercial_campaigns from anon;
revoke all on public.commercial_leads from anon;
revoke all on public.commercial_lead_events from anon;
revoke all on public.commercial_goals from anon;
