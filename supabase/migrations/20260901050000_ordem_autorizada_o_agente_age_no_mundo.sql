-- ═══════════════════════════════════════════════════════════════════════
-- A ORDEM AUTORIZADA: aprovar passa a PRODUZIR trabalho.
--
-- O dono pediu que os agentes facam coisas no mundo, e nao so organizem a
-- casa. Faltava a peca do meio: hoje aprovar so vira status.
-- operator_approval_decidir marca 'aprovado', limpa a flag, grava a
-- trilha — e acaba. Nao avisa o agente, nao enfileira nada, nao deixa
-- rastro que alguem possa PEGAR e executar. Aprovar era um beco sem saida.
--
-- ═══ MUDANCA DE REGRA, DECLARADA ═══════════════════════════════════════
--
-- A regra anterior, fixada pelo proprio dono em 28/08/2026, dizia:
--
--   "Operador interno nao e gente. Agente RELATA trabalho; quem age no
--    mundo (publicar, agendar, gastar, contratar, mexer no financeiro)
--    continua sendo pessoa."
--
-- Ele pediu explicitamente o contrario agora, e e decisao dele. Mas a
-- regra protegia algo real: acao externa e IRREVERSIVEL — post publicado
-- foi visto, verba gasta nao volta, mensagem enviada foi lida. Entao a
-- mudanca aqui NAO e "agente faz o que quiser". E:
--
--   o humano AUTORIZA uma acao especifica -> vira ordem -> o agente
--   executa AQUELA ordem -> e prova o que fez.
--
-- O gesto humano continua existindo; ele deixou de ser "fazer" e passou a
-- ser "autorizar". Nenhuma acao externa nasce do agente sozinho.
--
-- ═══ O QUE ESTA MIGRACAO ADICIONA ══════════════════════════════════════
--
--  A) Aprovacao ganha rastro de EXECUCAO: quando foi feita, com que prova,
--     em qual run. Sem isso "aprovado" e "feito" viram a mesma palavra.
--
--  B) operator_ordens_abertas(slug): o que este agente esta autorizado a
--     fazer e ainda nao fez. E a lista que o Hermes le para agir.
--
--  C) operator_ordem_executada(...): o agente diz que fez, COM EVIDENCIA.
--     Sem evidencia a funcao recusa — mesma regra do 'done', porque
--     "publiquei" sem link e afirmacao, nao entrega.
--
--  D) operator_cancelar_tarefa(...): fechar tarefa a pedido, e so com
--     ordem aprovada. NAO apaga: marca 'cancelado' com motivo. Apagar
--     destruiria a trilha que sustenta esta camada inteira, e o dono
--     perderia a historia junto com a linha.
--
-- Rollback: dropar as tres funcoes novas e as colunas de execucao.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── A) A aprovacao lembra se ja foi cumprida ───────────────────────────
alter table public.operator_approvals
  add column if not exists executed_at timestamptz,
  add column if not exists execution_evidence text,
  add column if not exists execution_run_key text;

comment on column public.operator_approvals.executed_at is
  'Quando o agente CUMPRIU a ordem. Aprovado e feito sao coisas diferentes: '
  'sem esta coluna, uma ordem autorizada e nunca executada ficaria '
  'indistinguivel de uma ja cumprida, e ninguem notaria o trabalho que nao '
  'aconteceu.';

-- ─── B) O que o agente esta autorizado a fazer ──────────────────────────
create or replace function public.operator_ordens_abertas(_operator_slug text)
returns table (
  approval_id uuid,
  action_kind text,
  o_que text,
  por_que text,
  destino text,
  prazo date,
  reversivel boolean,
  custo_previsto numeric,
  payload jsonb,
  kanban_task_id uuid,
  task_link_id uuid,
  titulo_da_tarefa text,
  aprovada_em timestamptz,
  nota_de_quem_aprovou text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  -- Autorizada, ainda nao cumprida, e ainda dentro da validade. Ordem
  -- vencida NAO aparece: autorizacao de tres semanas atras pode nao valer
  -- mais, e executar em cima dela e agir com procuracao velha.
  select
    a.id, a.action_kind, a.o_que, a.por_que, a.destino, a.prazo,
    a.reversivel, a.custo_previsto, a.payload,
    a.kanban_task_id, a.task_link_id,
    t.title,
    a.decided_at, a.decision_note
  from public.operator_approvals a
  join public.internal_operators o on o.id = a.operator_id
  left join public.tasks t on t.id = a.kanban_task_id
  where o.slug = lower(trim(_operator_slug))
    and o.status = 'active'
    and a.status = 'aprovado'
    and a.executed_at is null
    and (a.valid_until is null or a.valid_until > now())
  order by a.prazo nulls last, a.decided_at;
$$;

comment on function public.operator_ordens_abertas(text) is
  'A fila de ordens autorizadas de um agente. Ordem vencida nao aparece: '
  'autorizacao antiga pode nao valer mais, e agir sobre ela e usar '
  'procuracao velha.';

-- ─── C) O agente diz que cumpriu, com prova ─────────────────────────────
create or replace function public.operator_ordem_executada(
  _operator_slug text,
  _approval_id uuid,
  _evidence text,
  _run_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _op public.internal_operators%rowtype;
  _aprov public.operator_approvals%rowtype;
begin
  select * into _op from public.internal_operators
   where slug = lower(trim(_operator_slug));
  if not found then
    raise exception 'operator_not_found: % nao existe', _operator_slug;
  end if;
  if _op.status <> 'active' then
    raise exception 'operator_paused: % esta % e nao executa ordem', _op.slug, _op.status;
  end if;

  select * into _aprov from public.operator_approvals where id = _approval_id;
  if not found then
    raise exception 'approval_not_found: % nao existe', _approval_id;
  end if;
  if _aprov.operator_id <> _op.id then
    raise exception 'ordem_de_outro: esta ordem foi autorizada para outro agente';
  end if;
  if _aprov.status <> 'aprovado' then
    raise exception 'nao_autorizada: a ordem esta como % e nao pode ser executada', _aprov.status;
  end if;
  if _aprov.executed_at is not null then
    raise exception
      'ja_executada: cumprida em %; repetir publicaria ou gastaria duas vezes',
      _aprov.executed_at;
  end if;
  if _aprov.valid_until is not null and _aprov.valid_until <= now() then
    raise exception 'ordem_vencida: a autorizacao expirou em %; peca outra', _aprov.valid_until;
  end if;

  -- EVIDENCIA E OBRIGATORIA. Mesma regra do 'done': "publiquei" sem link e
  -- afirmacao, nao entrega — e acao externa e a que menos pode ser afirmada
  -- sem prova, porque ninguem consegue desfazer depois.
  if coalesce(btrim(_evidence), '') = '' then
    raise exception
      'sem_evidencia: acao externa exige prova (link do post, id da campanha, '
      'recibo). Sem isso nao da para saber se aconteceu.';
  end if;

  update public.operator_approvals
     set executed_at = now(),
         execution_evidence = _evidence,
         execution_run_key = _run_key
   where id = _approval_id
  returning * into _aprov;

  insert into public.operator_audit_log
    (actor, operator_id, task_link_id, kanban_task_id, action, evidence, run_key)
  values
    ('mcp:' || _op.slug, _op.id, _aprov.task_link_id, _aprov.kanban_task_id,
     'ordem ' || _aprov.action_kind || ' EXECUTADA no mundo', _evidence, _run_key);

  -- O dono soube quando autorizou; precisa saber tambem quando aconteceu.
  -- Acao externa sem aviso de conclusao e a que gera o "publicaram o que?".
  insert into public.notifications (user_id, message, notification_type, link)
  select ur.user_id,
         _op.display_name || ' executou: ' || _aprov.o_que,
         'operator_executou',
         '/execucao?vinculo=' || coalesce(_aprov.task_link_id::text, '')
    from public.user_roles ur where ur.role = 'admin';

  return jsonb_build_object(
    'ok', true, 'approval_id', _aprov.id, 'executed_at', _aprov.executed_at,
    'action_kind', _aprov.action_kind
  );
end;
$$;

-- ─── D) Cancelar tarefa: so com ordem, e sem apagar ─────────────────────
create or replace function public.operator_cancelar_tarefa(
  _operator_slug text,
  _approval_id uuid,
  _task_id uuid,
  _motivo text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _op public.internal_operators%rowtype;
  _aprov public.operator_approvals%rowtype;
  _status_velho text;
begin
  if coalesce(btrim(_motivo), '') = '' then
    raise exception 'sem_motivo: tarefa cancelada sem motivo vira misterio no historico';
  end if;

  select * into _op from public.internal_operators
   where slug = lower(trim(_operator_slug));
  if not found then
    raise exception 'operator_not_found: %', _operator_slug;
  end if;

  select * into _aprov from public.operator_approvals
   where id = _approval_id and operator_id = _op.id;
  if not found then
    raise exception 'approval_not_found: ordem % nao existe para este agente', _approval_id;
  end if;
  if _aprov.status <> 'aprovado' then
    raise exception
      'nao_autorizada: cancelar tarefa exige ordem aprovada (esta como %)', _aprov.status;
  end if;
  if _aprov.action_kind <> 'excluir_dados' then
    raise exception
      'ordem_de_outro_tipo: esta ordem autoriza "%", nao cancelar tarefa', _aprov.action_kind;
  end if;

  select status into _status_velho from public.tasks where id = _task_id;
  if not found then
    raise exception 'task_not_found: %', _task_id;
  end if;

  -- NAO APAGA. Marca cancelado com o motivo dentro da propria tarefa.
  -- Apagar destruiria a trilha que sustenta esta camada inteira, e o dono
  -- perderia a historia junto com a linha.
  update public.tasks
     set status = 'cancelado',
         description = coalesce(description || E'\n\n', '')
           || '[cancelado por ' || _op.display_name || ' em '
           || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
           || '] ' || _motivo
   where id = _task_id;

  insert into public.operator_audit_log
    (actor, operator_id, kanban_task_id, action, old_status, new_status, evidence)
  values ('mcp:' || _op.slug, _op.id, _task_id,
          'tarefa cancelada a pedido', _status_velho, 'cancelado', _motivo);

  return jsonb_build_object('ok', true, 'task_id', _task_id,
                            'status_anterior', _status_velho, 'motivo', _motivo);
end;
$$;

grant execute on function public.operator_ordens_abertas(text)
  to authenticated, service_role;
grant execute on function public.operator_ordem_executada(text, uuid, text, text)
  to authenticated, service_role;
grant execute on function public.operator_cancelar_tarefa(text, uuid, uuid, text)
  to authenticated, service_role;
