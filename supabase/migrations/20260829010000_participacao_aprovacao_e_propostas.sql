-- ═══════════════════════════════════════════════════════════════════════
-- O CENTRO DE COMANDO GANHA TRES COISAS QUE HOJE SO EXISTEM NA CABECA:
-- a participacao do Almir, a aprovacao explicada e a sugestao de
-- responsavel. E uma correcao de honestidade: operador pausado deixa de
-- errar como se nao existisse.
--
-- O que NAO muda: tarefas, titulos, prazos, assigned_to, financeiro,
-- calendario. A unica escrita em tasks.assigned_to que este arquivo
-- introduz acontece DENTRO de assignment_proposal_decidir, e so quando um
-- admin humano aprova a proposta — nunca por inferencia do agente.
--
-- Rollback: drop das tres tabelas e das cinco funcoes novas; o patch de
-- pausa se desfaz reaplicando 20260828020000 e 20260828140000.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1) O diario da execucao: onde Almir e agente conversam ─────────────
--
-- A tela mostrava o agente trabalhando e nao dava ao dono um lugar para
-- responder. Instrucao ia por fora (chat, memoria) e se perdia da trilha.
-- Aqui cada entrada tem autor, tipo e vinculo — e vira historia.
create table if not exists public.operator_participations (
  id uuid primary key default gen_random_uuid(),
  task_link_id uuid references public.operator_task_links(id) on delete set null,
  kanban_task_id uuid,
  author_kind text not null check (author_kind in ('humano', 'operador')),
  author_id uuid references public.profiles(id),
  operator_id uuid references public.internal_operators(id),
  entry_type text not null check (entry_type in (
    'comentario', 'instrucao', 'decisao', 'contexto', 'evidencia',
    'correcao', 'aprovacao', 'rejeicao', 'pedido_revisao', 'pedido_insumo',
    'resposta_insumo'
  )),
  title text,
  body text not null,
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  -- Autor sem identidade nao e participacao, e ruido: humano exige
  -- profile, operador exige operador.
  constraint participacao_tem_autor check (
    (author_kind = 'humano' and author_id is not null)
    or (author_kind = 'operador' and operator_id is not null)
  )
);

create index if not exists operator_participations_link_idx
  on public.operator_participations (task_link_id, created_at);
create index if not exists operator_participations_task_idx
  on public.operator_participations (kanban_task_id, created_at);

alter table public.operator_participations enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'operator_participations'
      and policyname = 'staff_le_participacoes'
  ) then
    create policy staff_le_participacoes on public.operator_participations
      for select using (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        or public.has_role(auth.uid(), 'manager'::public.app_role)
        or public.has_role(auth.uid(), 'design'::public.app_role)
        or public.has_role(auth.uid(), 'traffic'::public.app_role)
      );
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'operator_participations'
      and policyname = 'admin_escreve_como_humano'
  ) then
    -- O painel escreve como a PESSOA logada, nunca em nome de outra: o
    -- author_id tem que ser o proprio auth.uid(). Entradas de operador
    -- entram pelo RPC (service role), nao por aqui.
    create policy admin_escreve_como_humano on public.operator_participations
      for insert with check (
        author_kind = 'humano'
        and author_id = auth.uid()
        and (
          public.has_role(auth.uid(), 'admin'::public.app_role)
          or public.has_role(auth.uid(), 'manager'::public.app_role)
        )
      );
  end if;
end $$;

-- ─── 2) Aprovacao explicada: o selo generico vira dossie de decisao ─────
--
-- "Aprovacao necessaria" sem dizer O QUE sera feito, com QUAIS dados e
-- PARA ONDE eles vao nao e pedido de aprovacao — e pedido de fe. Cada
-- linha aqui carrega a explicacao completa e o payload exato da acao.
create table if not exists public.operator_approvals (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.internal_operators(id),
  task_link_id uuid references public.operator_task_links(id) on delete set null,
  kanban_task_id uuid,
  -- O catalogo fechado das acoes que EXIGEM humano. Fora desta lista o
  -- agente nao pede aprovacao: ou e acao interna (nao precisa) ou e acao
  -- que nem pedindo pode (nao existe no catalogo de tools).
  action_kind text not null check (action_kind in (
    'publicar', 'agendar', 'enviar_mensagem', 'contatar_cliente',
    'criar_proposta', 'enviar_contrato', 'ativar_campanha',
    'alterar_orcamento', 'gastar', 'alterar_financeiro',
    'alterar_permissoes', 'exportar_dados', 'excluir_dados',
    'mudar_estrategia', 'alterar_responsavel', 'promover_autonomia'
  )),
  o_que text not null,
  por_que text not null,
  dados_usados text,
  destino text,
  impacto text,
  risco text,
  custo_previsto numeric,
  prazo date,
  reversivel boolean not null default true,
  payload jsonb not null default '{}'::jsonb,
  payload_version integer not null default 1,
  evidencia text,
  status text not null default 'pendente' check (status in (
    'pendente', 'aprovado', 'rejeitado', 'alteracoes_pedidas', 'adiado', 'expirado'
  )),
  valid_until timestamptz,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);

create index if not exists operator_approvals_status_idx
  on public.operator_approvals (status, created_at desc);
create index if not exists operator_approvals_link_idx
  on public.operator_approvals (task_link_id, created_at desc);

alter table public.operator_approvals enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'operator_approvals'
      and policyname = 'staff_le_aprovacoes'
  ) then
    create policy staff_le_aprovacoes on public.operator_approvals
      for select using (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        or public.has_role(auth.uid(), 'manager'::public.app_role)
        or public.has_role(auth.uid(), 'design'::public.app_role)
        or public.has_role(auth.uid(), 'traffic'::public.app_role)
      );
  end if;
end $$;

-- O payload aprovado e IMUTAVEL. Mudou a acao? E outra aprovacao, com
-- versao nova. Sem isto, "aprovado" nao garante nada: o payload poderia
-- mudar depois do sim, e a aprovacao viraria cheque em branco.
create or replace function public.operator_approval_payload_imutavel()
returns trigger
language plpgsql
as $$
begin
  if new.payload is distinct from old.payload
     or new.payload_version is distinct from old.payload_version
     or new.action_kind is distinct from old.action_kind
     or new.o_que is distinct from old.o_que then
    raise exception
      'payload_imutavel: a acao aprovavel nao muda depois de criada; crie outra aprovacao com payload_version maior';
  end if;
  return new;
end;
$$;

drop trigger if exists operator_approvals_payload_imutavel on public.operator_approvals;
create trigger operator_approvals_payload_imutavel
  before update on public.operator_approvals
  for each row execute function public.operator_approval_payload_imutavel();

-- ─── 3) Proposta de responsavel: o agente sugere, o humano decide ───────
--
-- O agente pode perceber que uma tarefa precisa de dono, mas assigned_to
-- e territorio humano. A proposta carrega justificativa e evidencia, e a
-- UNICA escrita em assigned_to mora no RPC de decisao, atras de um admin.
create table if not exists public.assignment_proposals (
  id uuid primary key default gen_random_uuid(),
  kanban_task_id uuid not null,
  current_assignee uuid references public.profiles(id),
  suggested_assignee uuid not null references public.profiles(id),
  operator_id uuid not null references public.internal_operators(id),
  justificativa text not null,
  evidencias jsonb not null default '[]'::jsonb,
  confianca numeric check (confianca >= 0 and confianca <= 1),
  prazo date,
  impacto text,
  status text not null default 'pendente' check (status in (
    'pendente', 'aprovada', 'rejeitada', 'esclarecimento'
  )),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);

-- Uma proposta pendente por tarefa: duas sugestoes vivas para a mesma
-- tarefa e o leitor sem saber qual vale.
create unique index if not exists assignment_proposals_uma_pendente
  on public.assignment_proposals (kanban_task_id)
  where status = 'pendente';

alter table public.assignment_proposals enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'assignment_proposals'
      and policyname = 'staff_le_propostas'
  ) then
    create policy staff_le_propostas on public.assignment_proposals
      for select using (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        or public.has_role(auth.uid(), 'manager'::public.app_role)
        or public.has_role(auth.uid(), 'design'::public.app_role)
        or public.has_role(auth.uid(), 'traffic'::public.app_role)
      );
  end if;
end $$;

-- ─── 4) Operador pausado deixa de errar como inexistente ────────────────
--
-- Antes do patch, uma reconciliacao de catalogo: operator_update ja
-- aceitava 'paused' e 'retired', mas o CHECK da tabela so conhecia
-- 'active' e 'inactive' — pausar via operator_update violaria a
-- constraint. Dois catalogos para o mesmo campo e um deles mentindo.
-- 'inactive' permanece valido para nao invalidar linha existente.
alter table public.internal_operators
  drop constraint if exists internal_operators_status_check;
alter table public.internal_operators
  add constraint internal_operators_status_check
  check (status in ('active', 'paused', 'retired', 'inactive'));

--
-- A imposicao ja existia: os dois RPCs exigiam status = 'active'. Mas um
-- operador pausado caia em "operator_not_found: nao e um operador interno
-- ativo" — a mesma frase de um slug digitado errado. Quem pausa precisa
-- ver "pausado", nao "nao existe".
--
-- O patch e textual sobre a definicao VIVA (pg_get_functiondef), com
-- ancora exata: se o texto esperado nao estiver la, a migration aborta em
-- vez de fingir que corrigiu.
do $patch$
declare
  _fn record;
  _def text;
  _alvo constant text := $a$  select * into _op from public.internal_operators
    where slug = lower(trim(_operator_slug)) and status = 'active';
  if not found then
    raise exception 'operator_not_found: % nao e um operador interno ativo', _operator_slug;
  end if;$a$;
  _novo constant text := $n$  select * into _op from public.internal_operators
    where slug = lower(trim(_operator_slug));
  if not found then
    raise exception 'operator_not_found: % nao existe na hierarquia', _operator_slug;
  end if;
  if _op.status <> 'active' then
    raise exception
      'operator_paused: % esta com status % e nao recebe nem registra trabalho ate ser reativado',
      _op.slug, _op.status;
  end if;$n$;
begin
  for _fn in
    select p.oid from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('operator_assign_task', 'operator_report_event')
  loop
    _def := pg_get_functiondef(_fn.oid);
    if position(_alvo in _def) = 0 then
      raise exception 'patch_ancora_nao_encontrada: % mudou de forma; revise antes de aplicar',
        _fn.oid::regprocedure;
    end if;
    execute replace(_def, _alvo, _novo);
  end loop;
end $patch$;

-- Pausar e despausar pelo painel, com motivo na trilha. So admin: pausa e
-- instrumento de comando, nao de rotina.
create or replace function public.operator_pausar(
  _slug text,
  _pausar boolean,
  _motivo text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _op public.internal_operators%rowtype;
  _novo text;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'apenas_admin: pausar operador e acao de comando';
  end if;

  select * into _op from public.internal_operators
    where slug = lower(trim(_slug));
  if not found then
    raise exception 'operator_not_found: % nao existe na hierarquia', _slug;
  end if;

  _novo := case when _pausar then 'paused' else 'active' end;
  update public.internal_operators set status = _novo where id = _op.id;

  insert into public.operator_audit_log
    (actor, operator_id, action, old_status, new_status)
  values (
    'painel:' || coalesce(auth.uid()::text, 'desconhecido'),
    _op.id,
    case when _pausar then 'operador pausado' else 'operador reativado' end
      || coalesce(': ' || nullif(trim(_motivo), ''), ''),
    _op.status, _novo
  );

  return jsonb_build_object('ok', true, 'operator', _op.slug, 'status', _novo);
end;
$$;

revoke all on function public.operator_pausar(text, boolean, text) from anon;

-- ─── 5) O agente participa: escreve no diario pelo RPC ──────────────────
create or replace function public.operator_participar(
  _operator_slug text,
  _link_id uuid,
  _entry_type text,
  _body text,
  _title text default null,
  _attachments jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _op public.internal_operators%rowtype;
  _link public.operator_task_links%rowtype;
  _linha public.operator_participations%rowtype;
begin
  select * into _op from public.internal_operators
    where slug = lower(trim(_operator_slug));
  if not found then
    raise exception 'operator_not_found: % nao existe na hierarquia', _operator_slug;
  end if;
  if _op.status <> 'active' then
    raise exception 'operator_paused: % esta pausado e nao participa ate ser reativado', _op.slug;
  end if;

  select * into _link from public.operator_task_links where id = _link_id;
  if not found then
    raise exception 'link_not_found: vinculo % nao existe', _link_id;
  end if;

  if nullif(trim(_body), '') is null then
    raise exception 'body_vazio: participacao sem texto nao e participacao';
  end if;

  insert into public.operator_participations
    (task_link_id, kanban_task_id, author_kind, operator_id, entry_type, title, body, attachments)
  values
    (_link.id, _link.kanban_task_id, 'operador', _op.id, _entry_type,
     nullif(trim(_title), ''), trim(_body), coalesce(_attachments, '[]'::jsonb))
  returning * into _linha;

  insert into public.operator_audit_log
    (actor, operator_id, task_link_id, kanban_task_id, action)
  values ('mcp:' || _op.slug, _op.id, _link.id, _link.kanban_task_id,
          'participacao: ' || _entry_type);

  -- Pedido de insumo e pedido de revisao PARAM o trabalho ate o humano
  -- responder — por isso notificam. Comentario e contexto nao: diario nao
  -- vira spam.
  if _entry_type in ('pedido_insumo', 'pedido_revisao') then
    insert into public.notifications (user_id, message, notification_type, link)
    select ur.user_id,
      _op.display_name || case _entry_type
        when 'pedido_insumo' then ' precisa de um insumo seu'
        else ' pediu revisao'
      end || coalesce(': ' || _linha.title, ''),
      'operator_insumo',
      '/execucao?vinculo=' || _link.id || '&aba=diario'
    from public.user_roles ur where ur.role = 'admin';
  end if;

  return jsonb_build_object(
    'ok', true, 'participation_id', _linha.id, 'entry_type', _linha.entry_type,
    'link_id', _link.id, 'notificou', _entry_type in ('pedido_insumo', 'pedido_revisao')
  );
end;
$$;

revoke all on function public.operator_participar(text, uuid, text, text, text, jsonb) from anon, authenticated;

-- ─── 6) O agente pede aprovacao: com explicacao completa ou nada ────────
create or replace function public.operator_request_approval(
  _operator_slug text,
  _link_id uuid,
  _action_kind text,
  _o_que text,
  _por_que text,
  _payload jsonb,
  _dados_usados text default null,
  _destino text default null,
  _impacto text default null,
  _risco text default null,
  _custo_previsto numeric default null,
  _prazo date default null,
  _reversivel boolean default true,
  _evidencia text default null,
  _valid_until timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _op public.internal_operators%rowtype;
  _link public.operator_task_links%rowtype;
  _aprov public.operator_approvals%rowtype;
  _versao integer;
begin
  select * into _op from public.internal_operators
    where slug = lower(trim(_operator_slug));
  if not found then
    raise exception 'operator_not_found: % nao existe na hierarquia', _operator_slug;
  end if;
  if _op.status <> 'active' then
    raise exception 'operator_paused: % esta pausado e nao pede aprovacao ate ser reativado', _op.slug;
  end if;

  select * into _link from public.operator_task_links where id = _link_id;
  if not found then
    raise exception 'link_not_found: vinculo % nao existe', _link_id;
  end if;

  -- Sem O QUE e POR QUE nao ha o que aprovar. Pedido vazio e o selo
  -- generico de volta, so que em tabela nova.
  if nullif(trim(_o_que), '') is null or nullif(trim(_por_que), '') is null then
    raise exception 'explicacao_obrigatoria: aprovacao sem "o que" e "por que" nao entra na fila';
  end if;

  -- A versao cresce por vinculo+acao: o pedido refeito depois de
  -- "alteracoes_pedidas" nasce como v2, e o historico das versoes fica.
  select coalesce(max(payload_version), 0) + 1 into _versao
    from public.operator_approvals
    where task_link_id = _link.id and action_kind = _action_kind;

  insert into public.operator_approvals
    (operator_id, task_link_id, kanban_task_id, action_kind, o_que, por_que,
     dados_usados, destino, impacto, risco, custo_previsto, prazo, reversivel,
     payload, payload_version, evidencia, valid_until)
  values
    (_op.id, _link.id, _link.kanban_task_id, _action_kind, trim(_o_que), trim(_por_que),
     _dados_usados, _destino, _impacto, _risco, _custo_previsto, _prazo,
     coalesce(_reversivel, true), coalesce(_payload, '{}'::jsonb), _versao,
     _evidencia, _valid_until)
  returning * into _aprov;

  update public.operator_task_links
    set approval_required = true, updated_at = now()
    where id = _link.id;

  insert into public.operator_audit_log
    (actor, operator_id, task_link_id, kanban_task_id, action, approval_required)
  values ('mcp:' || _op.slug, _op.id, _link.id, _link.kanban_task_id,
          'pediu aprovacao: ' || _action_kind || ' v' || _versao, true);

  insert into public.notifications (user_id, message, notification_type, link)
  select ur.user_id,
    _op.display_name || ' pede aprovacao para ' || replace(_action_kind, '_', ' ')
      || ': ' || left(trim(_o_que), 140),
    'aprovacao_necessaria',
    '/execucao?aprovacao=' || _aprov.id
  from public.user_roles ur where ur.role = 'admin';

  return jsonb_build_object(
    'ok', true, 'approval_id', _aprov.id, 'payload_version', _versao,
    'status', 'pendente',
    'regra', 'nada e executado ate um humano aprovar; e o executado tem que ser ESTE payload'
  );
end;
$$;

revoke all on function public.operator_request_approval(
  text, uuid, text, text, text, jsonb, text, text, text, text,
  numeric, date, boolean, text, timestamptz
) from anon, authenticated;

-- ─── 7) O humano decide a aprovacao ─────────────────────────────────────
create or replace function public.operator_approval_decidir(
  _approval_id uuid,
  _decisao text,
  _nota text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _aprov public.operator_approvals%rowtype;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'apenas_admin: decidir aprovacao e acao de comando';
  end if;
  if _decisao not in ('aprovado', 'rejeitado', 'alteracoes_pedidas', 'adiado') then
    raise exception 'decisao_invalida: % (use aprovado, rejeitado, alteracoes_pedidas ou adiado)', _decisao;
  end if;

  select * into _aprov from public.operator_approvals where id = _approval_id;
  if not found then
    raise exception 'approval_not_found: % nao existe', _approval_id;
  end if;
  -- Adiado volta a ser decidivel; o resto e final. Redecidir "aprovado"
  -- para "rejeitado" depois do fato apagaria a base de uma acao ja
  -- executada.
  if _aprov.status not in ('pendente', 'adiado') then
    raise exception 'ja_decidida: esta aprovacao esta como % e nao volta atras; crie outra versao', _aprov.status;
  end if;

  update public.operator_approvals
    set status = _decisao, decided_by = auth.uid(), decided_at = now(),
        decision_note = nullif(trim(_nota), '')
    where id = _approval_id
    returning * into _aprov;

  -- O selo do vinculo so cai quando nao resta pedido pendente nele.
  if not exists (
    select 1 from public.operator_approvals
    where task_link_id = _aprov.task_link_id and status = 'pendente'
  ) then
    update public.operator_task_links
      set approval_required = false, updated_at = now()
      where id = _aprov.task_link_id;
  end if;

  insert into public.operator_audit_log
    (actor, operator_id, task_link_id, kanban_task_id, action)
  values ('painel:' || auth.uid()::text, _aprov.operator_id, _aprov.task_link_id,
          _aprov.kanban_task_id,
          'aprovacao ' || _aprov.action_kind || ' v' || _aprov.payload_version
            || ' -> ' || _decisao);

  return jsonb_build_object(
    'ok', true, 'approval_id', _aprov.id, 'status', _aprov.status,
    'payload_version', _aprov.payload_version
  );
end;
$$;

revoke all on function public.operator_approval_decidir(uuid, text, text) from anon;

-- ─── 8) O agente propoe responsavel ─────────────────────────────────────
create or replace function public.operator_propor_responsavel(
  _operator_slug text,
  _kanban_task_id uuid,
  _suggested_assignee uuid,
  _justificativa text,
  _evidencias jsonb default '[]'::jsonb,
  _confianca numeric default null,
  _prazo date default null,
  _impacto text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _op public.internal_operators%rowtype;
  _tarefa public.tasks%rowtype;
  _pessoa public.profiles%rowtype;
  _prop public.assignment_proposals%rowtype;
begin
  select * into _op from public.internal_operators
    where slug = lower(trim(_operator_slug));
  if not found then
    raise exception 'operator_not_found: % nao existe na hierarquia', _operator_slug;
  end if;
  if _op.status <> 'active' then
    raise exception 'operator_paused: % esta pausado e nao propoe ate ser reativado', _op.slug;
  end if;

  -- Todo id validado contra o banco: agente ja transpos UUID antes, e uma
  -- proposta apontando para tarefa ou pessoa inexistente e lixo com cara
  -- de dado.
  select * into _tarefa from public.tasks where id = _kanban_task_id;
  if not found then
    raise exception 'task_not_found: tarefa % nao existe no Kanban', _kanban_task_id;
  end if;
  select * into _pessoa from public.profiles where id = _suggested_assignee;
  if not found then
    raise exception 'profile_not_found: pessoa % nao existe', _suggested_assignee;
  end if;

  if nullif(trim(_justificativa), '') is null then
    raise exception 'justificativa_obrigatoria: proposta sem razao nao entra na fila';
  end if;

  insert into public.assignment_proposals
    (kanban_task_id, current_assignee, suggested_assignee, operator_id,
     justificativa, evidencias, confianca, prazo, impacto)
  values
    (_tarefa.id, _tarefa.assigned_to, _pessoa.id, _op.id,
     trim(_justificativa), coalesce(_evidencias, '[]'::jsonb), _confianca, _prazo, _impacto)
  returning * into _prop;

  insert into public.operator_audit_log
    (actor, operator_id, kanban_task_id, action)
  values ('mcp:' || _op.slug, _op.id, _tarefa.id,
          'propos responsavel: ' || coalesce(_pessoa.full_name, _pessoa.id::text));

  insert into public.notifications (user_id, message, notification_type, link)
  select ur.user_id,
    _op.display_name || ' sugere ' || coalesce(_pessoa.full_name, 'alguem')
      || ' como responsavel de: ' || coalesce(_tarefa.title, 'tarefa'),
    'responsavel_sugerido',
    '/execucao?proposta=' || _prop.id
  from public.user_roles ur where ur.role = 'admin';

  return jsonb_build_object(
    'ok', true, 'proposal_id', _prop.id, 'status', 'pendente',
    'assigned_to_intocado', true
  );
end;
$$;

revoke all on function public.operator_propor_responsavel(
  text, uuid, uuid, text, jsonb, numeric, date, text
) from anon, authenticated;

-- ─── 9) O humano decide a proposta — e SO AQUI assigned_to muda ─────────
create or replace function public.assignment_proposal_decidir(
  _proposal_id uuid,
  _decisao text,
  _nota text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _prop public.assignment_proposals%rowtype;
  _antigo uuid;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'apenas_admin: decidir responsavel e acao de comando';
  end if;
  if _decisao not in ('aprovada', 'rejeitada', 'esclarecimento') then
    raise exception 'decisao_invalida: % (use aprovada, rejeitada ou esclarecimento)', _decisao;
  end if;

  select * into _prop from public.assignment_proposals where id = _proposal_id;
  if not found then
    raise exception 'proposal_not_found: % nao existe', _proposal_id;
  end if;
  if _prop.status <> 'pendente' then
    raise exception 'ja_decidida: esta proposta esta como %', _prop.status;
  end if;

  update public.assignment_proposals
    set status = _decisao, decided_by = auth.uid(), decided_at = now(),
        decision_note = nullif(trim(_nota), '')
    where id = _proposal_id
    returning * into _prop;

  if _decisao = 'aprovada' then
    select assigned_to into _antigo from public.tasks where id = _prop.kanban_task_id;
    update public.tasks
      set assigned_to = _prop.suggested_assignee
      where id = _prop.kanban_task_id;

    insert into public.operator_audit_log
      (actor, operator_id, kanban_task_id, action, old_status, new_status)
    values ('painel:' || auth.uid()::text, _prop.operator_id, _prop.kanban_task_id,
            'responsavel alterado por proposta aprovada',
            coalesce(_antigo::text, 'sem responsavel'),
            _prop.suggested_assignee::text);

    -- Quem foi designado fica sabendo — com o link da tarefa, nao com um
    -- aviso solto.
    insert into public.notifications (user_id, message, notification_type, link)
    values (_prop.suggested_assignee,
            'Voce foi designado como responsavel de uma tarefa (proposta aprovada)',
            'responsavel_designado',
            '/kanban?task=' || _prop.kanban_task_id);
  else
    insert into public.operator_audit_log
      (actor, operator_id, kanban_task_id, action)
    values ('painel:' || auth.uid()::text, _prop.operator_id, _prop.kanban_task_id,
            'proposta de responsavel -> ' || _decisao);
  end if;

  return jsonb_build_object(
    'ok', true, 'proposal_id', _prop.id, 'status', _prop.status,
    'assigned_to_alterado', _decisao = 'aprovada'
  );
end;
$$;

revoke all on function public.assignment_proposal_decidir(uuid, text, text) from anon;
