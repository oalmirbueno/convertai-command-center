-- A camada de Operadores internos: os agentes Hermes como cidadãos do
-- painel, sem fingir que são gente.
--
-- Vértice, Registro e Prisma executam; Augusto coordena e consolida. Até
-- aqui eles trabalhavam por fora e o painel não tinha onde registrar quem
-- fez o quê, com que evidência, sob qual responsável humano. A alternativa
-- errada seria criar contas humanas fictícias para eles — e-mail falso,
-- senha falsa, membro de equipe que não existe. Operador interno é OUTRA
-- entidade: sem e-mail, sem senha, sem cliente atribuído, sem nunca ocupar
-- o assigned_to de uma tarefa.
--
-- Quatro peças, todas aditivas (nenhuma tabela existente é alterada):
--
--   internal_operators    quem são os operadores.
--   operator_task_links   o vínculo operacional com a tarefa, SEM
--                         substituir o responsável humano.
--   operator_runs         cada execução: heartbeat, tentativa, timeout,
--                         e a trava de execução simultânea.
--   operator_audit_log    trilha imutável (trigger recusa UPDATE/DELETE).
--
-- Feature flag: a linha 'operators_layer' em feature_flags. ROLLBACK
-- DOCUMENTADO: desligar a flag (UPDATE feature_flags SET enabled = false
-- WHERE flag_key = 'operators_layer') esconde a área no painel e faz o
-- MCP recusar novos registros de execução; nada é apagado, nenhum dado de
-- tarefa, cliente ou responsável é tocado. Religar volta tudo.
--
-- Rodar de novo não faz mal: tudo IF NOT EXISTS / ON CONFLICT DO NOTHING.

-- ─── Feature flags (nasce aqui; serve às próximas também) ───────────────
create table if not exists public.feature_flags (
  flag_key text primary key,
  enabled boolean not null default false,
  description text,
  updated_at timestamptz not null default now()
);

alter table public.feature_flags enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'feature_flags'
      and policyname = 'staff_le_flags'
  ) then
    create policy staff_le_flags on public.feature_flags
      for select using (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        or public.has_role(auth.uid(), 'manager'::public.app_role)
        or public.has_role(auth.uid(), 'design'::public.app_role)
        or public.has_role(auth.uid(), 'traffic'::public.app_role)
      );
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'feature_flags'
      and policyname = 'admin_escreve_flags'
  ) then
    create policy admin_escreve_flags on public.feature_flags
      for all using (public.has_role(auth.uid(), 'admin'::public.app_role))
      with check (public.has_role(auth.uid(), 'admin'::public.app_role));
  end if;
end $$;

insert into public.feature_flags (flag_key, enabled, description)
values ('operators_layer', true, 'Camada de Operadores internos (Hermes): area Execucao da equipe, vinculos e auditoria.')
on conflict (flag_key) do nothing;

-- ─── 1) Operadores internos ─────────────────────────────────────────────
create table if not exists public.internal_operators (
  id uuid primary key default gen_random_uuid(),
  -- O slug é a identidade estável: é o que o Hermes envia e o que o painel
  -- exibe quando tudo mais mudar de nome.
  slug text not null unique,
  display_name text not null,
  role text not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  scope text not null,
  permissions jsonb not null default '{}'::jsonb,
  hermes_profile_ref text not null,
  is_coordinator boolean not null default false,
  created_at timestamptz not null default now(),
  last_run_at timestamptz
);

alter table public.internal_operators enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'internal_operators'
      and policyname = 'staff_le_operadores'
  ) then
    create policy staff_le_operadores on public.internal_operators
      for select using (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        or public.has_role(auth.uid(), 'manager'::public.app_role)
        or public.has_role(auth.uid(), 'design'::public.app_role)
        or public.has_role(auth.uid(), 'traffic'::public.app_role)
      );
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'internal_operators'
      and policyname = 'admin_gerencia_operadores'
  ) then
    create policy admin_gerencia_operadores on public.internal_operators
      for all using (public.has_role(auth.uid(), 'admin'::public.app_role))
      with check (public.has_role(auth.uid(), 'admin'::public.app_role));
  end if;
end $$;

-- Os quatro do piloto. As permissões aqui são DESCRITIVAS (o que cada um
-- cobre); a imposição dura mora no servidor MCP: operador só tem a
-- ferramenta de RELATAR execução — publicar, gastar, agendar, contratar e
-- alterar financeiro nunca estiveram no catálogo dele.
insert into public.internal_operators
  (slug, display_name, role, scope, permissions, hermes_profile_ref, is_coordinator)
values
  ('vertice', 'Vértice', 'Operacao e fila',
   'Fila, prazos, dependencias e documentacao operacional',
   '{"fila": true, "prazos": true, "dependencias": true, "documentacao_operacional": true}'::jsonb,
   'hermes:vertice', false),
  ('registro', 'Registro', 'Documentacao e evidencias',
   'Documentacao, evidencias, briefs, versoes e handoffs',
   '{"documentacao": true, "evidencias": true, "briefs": true, "versoes": true, "handoffs": true}'::jsonb,
   'hermes:registro', false),
  ('prisma', 'Prisma', 'QA e dados',
   'QA, dados, saude, controle e leitura financeira',
   '{"qa": true, "dados": true, "saude": true, "controle": true, "leitura_financeira": true}'::jsonb,
   'hermes:prisma', false),
  ('augusto', 'Augusto', 'Coordenacao',
   'Coordenacao e consolidacao dos operadores',
   '{"coordenacao": true, "consolidacao": true}'::jsonb,
   'hermes:augusto', true)
on conflict (slug) do nothing;

-- ─── 2) Vínculo operacional com a tarefa ────────────────────────────────
create table if not exists public.operator_task_links (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.internal_operators(id),
  agent_run_id text,
  -- Sem FK dura de propósito: a tarefa pode ser apagada pelo fluxo normal
  -- do Kanban e o vínculo vira história, não erro de integridade.
  kanban_task_id uuid,
  painel_task_id uuid,
  execution_source text not null default 'mcp',
  status text not null default 'queued'
    check (status in ('queued', 'in_progress', 'done', 'review', 'awaiting_input', 'blocked')),
  last_action text,
  last_evidence text,
  next_step text,
  block_reason text,
  approval_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists operator_task_links_task_idx
  on public.operator_task_links (kanban_task_id);
create index if not exists operator_task_links_operator_idx
  on public.operator_task_links (operator_id, status);

-- Uma execução EM ANDAMENTO por tarefa, não importa o operador: é a trava
-- que impede dois agentes de trabalharem a mesma tarefa ao mesmo tempo.
create unique index if not exists operator_task_links_uma_ativa
  on public.operator_task_links (kanban_task_id)
  where status = 'in_progress' and kanban_task_id is not null;

alter table public.operator_task_links enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'operator_task_links'
      and policyname = 'staff_le_vinculos'
  ) then
    create policy staff_le_vinculos on public.operator_task_links
      for select using (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        or public.has_role(auth.uid(), 'manager'::public.app_role)
        or public.has_role(auth.uid(), 'design'::public.app_role)
        or public.has_role(auth.uid(), 'traffic'::public.app_role)
      );
  end if;
end $$;

-- ─── 3) Execuções (runs): heartbeat, tentativa, timeout ─────────────────
create table if not exists public.operator_runs (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.internal_operators(id),
  -- Idempotência POR EXECUÇÃO: o mesmo run_key do mesmo operador é a mesma
  -- execução, e reprocessar não cria linha nova.
  run_key text not null,
  task_link_id uuid references public.operator_task_links(id),
  status text not null default 'started'
    check (status in ('started', 'progress', 'done', 'failed', 'blocked', 'timeout')),
  attempt integer not null default 1 check (attempt >= 1),
  timeout_seconds integer not null default 900 check (timeout_seconds between 30 and 21600),
  started_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  finished_at timestamptz,
  error text,
  detail jsonb not null default '{}'::jsonb,
  unique (operator_id, run_key)
);

create index if not exists operator_runs_link_idx on public.operator_runs (task_link_id, status);

-- Uma run VIVA por vínculo: a segunda tentativa simultânea colide aqui e
-- vira fila, não corrida.
create unique index if not exists operator_runs_uma_viva
  on public.operator_runs (task_link_id)
  where status in ('started', 'progress') and task_link_id is not null;

alter table public.operator_runs enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'operator_runs'
      and policyname = 'staff_le_runs'
  ) then
    create policy staff_le_runs on public.operator_runs
      for select using (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        or public.has_role(auth.uid(), 'manager'::public.app_role)
        or public.has_role(auth.uid(), 'design'::public.app_role)
        or public.has_role(auth.uid(), 'traffic'::public.app_role)
      );
  end if;
end $$;

-- ─── 4) Trilha de auditoria imutável ────────────────────────────────────
create table if not exists public.operator_audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor text not null,
  operator_id uuid references public.internal_operators(id),
  task_link_id uuid,
  kanban_task_id uuid,
  action text not null,
  old_status text,
  new_status text,
  evidence text,
  from_cron boolean not null default false,
  approval_required boolean not null default false,
  run_key text
);

create index if not exists operator_audit_task_idx on public.operator_audit_log (kanban_task_id, occurred_at desc);
create index if not exists operator_audit_operator_idx on public.operator_audit_log (operator_id, occurred_at desc);

alter table public.operator_audit_log enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'operator_audit_log'
      and policyname = 'staff_le_auditoria'
  ) then
    create policy staff_le_auditoria on public.operator_audit_log
      for select using (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        or public.has_role(auth.uid(), 'manager'::public.app_role)
        or public.has_role(auth.uid(), 'design'::public.app_role)
        or public.has_role(auth.uid(), 'traffic'::public.app_role)
      );
  end if;
end $$;

-- Imutável DE VERDADE: o trigger recusa UPDATE e DELETE para qualquer um,
-- inclusive service_role. Auditoria que aceita conserto vira narrativa.
create or replace function public.operator_audit_imutavel()
returns trigger
language plpgsql
as $$
begin
  raise exception 'operator_audit_log e imutavel: % nao e permitido', tg_op;
end;
$$;

drop trigger if exists operator_audit_sem_update on public.operator_audit_log;
create trigger operator_audit_sem_update
  before update or delete on public.operator_audit_log
  for each row execute function public.operator_audit_imutavel();

-- ─── 5) O RPC que o MCP chama: um evento, todas as consequências ────────
--
-- Uma função só, transacional: valida flag e operador, aplica o evento no
-- vínculo, registra a run (com idempotência), grava a auditoria e decide
-- se notifica. Espalhar isso em quatro escritas do cliente deixaria a
-- trilha e o estado divergirem no primeiro erro de rede.
--
-- Notificação é EXCEÇÃO, não diário: started/done/review/blocked/failed e
-- aprovação necessária notificam; progress e heartbeat nunca. O link abre
-- direto o vínculo na área Execução da equipe.
create or replace function public.operator_report_event(
  _operator_slug text,
  _event text,
  _run_key text,
  _actor text,
  _kanban_task_id uuid default null,
  _painel_task_id uuid default null,
  _action text default null,
  _evidence text default null,
  _next_step text default null,
  _block_reason text default null,
  _error text default null,
  _approval_required boolean default false,
  _from_cron boolean default false,
  _attempt integer default 1,
  _timeout_seconds integer default 900,
  _detail jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _flag boolean;
  _op public.internal_operators%rowtype;
  _link public.operator_task_links%rowtype;
  _run public.operator_runs%rowtype;
  _status_novo text;
  _status_velho text;
  _notifica boolean := false;
  _mensagem text;
begin
  select enabled into _flag from public.feature_flags where flag_key = 'operators_layer';
  if not coalesce(_flag, false) then
    raise exception 'flag_off: a camada de operadores esta desligada (operators_layer)';
  end if;

  select * into _op from public.internal_operators
    where slug = lower(trim(_operator_slug)) and status = 'active';
  if not found then
    raise exception 'operator_not_found: % nao e um operador interno ativo', _operator_slug;
  end if;

  if _event not in ('started', 'progress', 'done', 'failed', 'blocked', 'review', 'awaiting_input', 'heartbeat') then
    raise exception 'invalid_event: %', _event;
  end if;

  -- Evidência nunca carrega segredo: URL assinada perde a query string.
  if _evidence is not null and (
    _evidence ~* '(token|signature|x-amz|apikey|api_key|secret|sig)='
  ) then
    _evidence := split_part(_evidence, '?', 1) || ' [query removida: continha credencial]';
  end if;

  -- O vínculo: acha pelo run/tarefa ou nasce agora.
  if _kanban_task_id is not null or _painel_task_id is not null then
    select * into _link from public.operator_task_links l
      where l.operator_id = _op.id
        and coalesce(l.kanban_task_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(_kanban_task_id, '00000000-0000-0000-0000-000000000000'::uuid)
        and coalesce(l.painel_task_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(_painel_task_id, '00000000-0000-0000-0000-000000000000'::uuid)
      order by l.created_at desc limit 1;
    if not found and _event <> 'heartbeat' then
      insert into public.operator_task_links
        (operator_id, agent_run_id, kanban_task_id, painel_task_id, execution_source)
      values (_op.id, _run_key, _kanban_task_id, _painel_task_id,
              case when _from_cron then 'cron' else 'mcp' end)
      returning * into _link;
    end if;
  end if;

  _status_velho := _link.status;
  _status_novo := case _event
    when 'started' then 'in_progress'
    when 'progress' then 'in_progress'
    when 'done' then case when coalesce(trim(_evidence), '') = '' and coalesce(trim(_link.last_evidence), '') = ''
      -- Feito sem evidência não é feito: vai para revisão, e o relatório
      -- diz o porquê. É a regra "feitos somente com evidência verificável".
      then 'review' else 'done' end
    when 'failed' then 'blocked'
    when 'blocked' then 'blocked'
    when 'review' then 'review'
    when 'awaiting_input' then 'awaiting_input'
    else null
  end;

  if _link.id is not null and _status_novo is not null then
    update public.operator_task_links set
      status = _status_novo,
      agent_run_id = coalesce(_run_key, agent_run_id),
      last_action = coalesce(_action, last_action),
      last_evidence = coalesce(_evidence, last_evidence),
      next_step = coalesce(_next_step, next_step),
      block_reason = case when _event in ('failed', 'blocked')
        then coalesce(_block_reason, _error, block_reason) else null end,
      approval_required = _approval_required or approval_required,
      updated_at = now()
    where id = _link.id;
  end if;

  -- A run, idempotente por (operador, run_key).
  insert into public.operator_runs
    (operator_id, run_key, task_link_id, status, attempt, timeout_seconds, error, detail)
  values (
    _op.id, _run_key, _link.id,
    case _event
      when 'heartbeat' then 'progress'
      when 'started' then 'started'
      when 'progress' then 'progress'
      when 'done' then 'done'
      when 'failed' then 'failed'
      when 'blocked' then 'blocked'
      else 'progress'
    end,
    greatest(_attempt, 1), _timeout_seconds, _error, _detail
  )
  on conflict (operator_id, run_key) do update set
    status = excluded.status,
    task_link_id = coalesce(excluded.task_link_id, operator_runs.task_link_id),
    attempt = greatest(operator_runs.attempt, excluded.attempt),
    heartbeat_at = now(),
    finished_at = case when excluded.status in ('done', 'failed', 'blocked', 'timeout')
      then now() else operator_runs.finished_at end,
    error = coalesce(excluded.error, operator_runs.error),
    detail = operator_runs.detail || excluded.detail
  returning * into _run;

  update public.internal_operators set last_run_at = now() where id = _op.id;

  -- Auditoria: todo evento entra, inclusive heartbeat (barato e completo).
  insert into public.operator_audit_log
    (actor, operator_id, task_link_id, kanban_task_id, action, old_status,
     new_status, evidence, from_cron, approval_required, run_key)
  values
    (_actor, _op.id, _link.id, _kanban_task_id,
     coalesce(_action, _event), _status_velho, coalesce(_status_novo, _status_velho),
     _evidence, _from_cron, _approval_required, _run_key);

  -- Notificação: só exceção e marco. progress/heartbeat nunca notificam.
  _notifica := _event in ('started', 'done', 'failed', 'blocked', 'review')
    or _approval_required;
  if _notifica then
    _mensagem := _op.display_name || case _event
      when 'started' then ' iniciou'
      when 'done' then case when _status_novo = 'review'
        then ' concluiu SEM evidencia (foi para revisao)' else ' concluiu' end
      when 'failed' then ' falhou em'
      when 'blocked' then ' bloqueou'
      when 'review' then ' enviou para revisao'
      else ' atualizou'
    end || ' uma tarefa' || case when _approval_required then ' · precisa de aprovacao' else '' end;

    insert into public.notifications (user_id, message, notification_type, link)
    select ur.user_id, _mensagem, 'operator',
      '/execucao?vinculo=' || coalesce(_link.id::text, '')
    from public.user_roles ur
    where ur.role = 'admin';
  end if;

  return jsonb_build_object(
    'ok', true,
    'operator', _op.slug,
    'link_id', _link.id,
    'run_id', _run.id,
    'run_status', _run.status,
    'link_status', coalesce(_status_novo, _status_velho),
    'attempt', _run.attempt,
    'notified', _notifica
  );
end;
$$;

revoke execute on function public.operator_report_event(text, text, text, text, uuid, uuid, text, text, text, text, text, boolean, boolean, integer, integer, jsonb) from anon;
grant execute on function public.operator_report_event(text, text, text, text, uuid, uuid, text, text, text, text, text, boolean, boolean, integer, integer, jsonb) to service_role;

-- ─── 6) Runs penduradas viram timeout (retomada segura) ─────────────────
-- Chamada pela leitura do quadro: run viva cujo heartbeat passou do
-- timeout vira 'timeout' e libera a trava — a proxima execucao pode
-- assumir. Nao ha promessa de zero falha; ha detecção e retomada.
create or replace function public.operator_expire_stale_runs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  _n integer;
begin
  with expiradas as (
    update public.operator_runs r set
      status = 'timeout',
      finished_at = now(),
      error = coalesce(r.error, 'timeout: sem heartbeat dentro do prazo')
    where r.status in ('started', 'progress')
      and r.heartbeat_at < now() - make_interval(secs => r.timeout_seconds)
    returning r.id, r.task_link_id
  ),
  liberadas as (
    update public.operator_task_links l set
      status = 'blocked',
      block_reason = coalesce(l.block_reason, 'execucao expirou sem heartbeat'),
      updated_at = now()
    from expiradas e
    where l.id = e.task_link_id and l.status = 'in_progress'
    returning l.id
  )
  select count(*) into _n from expiradas;
  return _n;
end;
$$;

revoke execute on function public.operator_expire_stale_runs() from anon;
grant execute on function public.operator_expire_stale_runs() to service_role, authenticated;
