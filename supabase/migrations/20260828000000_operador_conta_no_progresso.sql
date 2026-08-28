-- O trabalho do operador conta no progresso do cliente.
--
-- Até aqui a execução dos agentes vivia numa ilha: a área Execução sabia
-- tudo, e o Ciclo, a Central e o Dossiê não sabiam nada. O dono disse a
-- frase que resume: "cada ação deles conta no progresso". Um agente que
-- entrega e não aparece no lugar onde a equipe olha todo dia é um agente
-- que trabalhou de graça.
--
-- A ponte é `project_memory`, a história do cliente que o Ciclo, a
-- Central e o Dossiê já leem. Nada de tabela nova: o registro entra na
-- MESMA linha do tempo do trabalho humano, porque para o cliente a
-- entrega é uma só.
--
-- A RÉGUA, e ela é estreita de propósito: só entrega CONCLUÍDA COM
-- EVIDÊNCIA vira registro. started, progress, heartbeat, bloqueio e
-- revisão não entram. Se cada passo virasse linha, a história do cliente
-- viraria log de máquina e ninguém leria — o mesmo motivo pelo qual a
-- notificação já é exceção, não diário.
--
-- Rodar de novo não faz mal.

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
  _client_id uuid;
  _titulo_tarefa text;
  _memoria_id uuid;
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

  if _evidence is not null and (
    _evidence ~* '(token|signature|x-amz|apikey|api_key|secret|sig)='
  ) then
    _evidence := split_part(_evidence, '?', 1) || ' [query removida: continha credencial]';
  end if;

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

  insert into public.operator_audit_log
    (actor, operator_id, task_link_id, kanban_task_id, action, old_status,
     new_status, evidence, from_cron, approval_required, run_key)
  values
    (_actor, _op.id, _link.id, _kanban_task_id,
     coalesce(_action, _event), _status_velho, coalesce(_status_novo, _status_velho),
     _evidence, _from_cron, _approval_required, _run_key);

  -- ─── A ponte com o progresso do cliente ───────────────────────────────
  --
  -- Só entrega concluída COM evidência. O cliente sai da tarefa pelo
  -- projeto: tasks nao tem client_id.
  if _status_novo = 'done' and _kanban_task_id is not null then
    select pj.client_id, t.title into _client_id, _titulo_tarefa
      from public.tasks t
      join public.projects pj on pj.id = t.project_id
      where t.id = _kanban_task_id
      limit 1;

    if _client_id is not null then
      -- Idempotente pela run: reportar done duas vezes com a mesma chave
      -- nao duplica a linha na historia do cliente.
      select id into _memoria_id from public.project_memory
        where client_id = _client_id
          and source = 'operador'
          and metadata->>'run_key' = _run_key
        limit 1;

      if _memoria_id is null then
        insert into public.project_memory
          (client_id, kind, source, title, content, tags, metadata)
        values (
          _client_id,
          'entrega',
          'operador',
          coalesce(_titulo_tarefa, _action, 'Entrega concluida'),
          coalesce(_action, _titulo_tarefa, 'Entrega concluida')
            || E'\n\nEvidencia: ' || coalesce(_evidence, _link.last_evidence, '(sem link)')
            || E'\nOperador: ' || _op.display_name,
          array['operador', _op.slug],
          jsonb_build_object(
            'run_key', _run_key,
            'operator_slug', _op.slug,
            'kanban_task_id', _kanban_task_id,
            'task_link_id', _link.id,
            -- O texto e interno: o cliente nao le "operador Vertice".
            'client_visible', false
          )
        );
      end if;
    end if;
  end if;

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
    'notified', _notifica,
    -- O agente fica sabendo que a entrega dele contou no progresso do
    -- cliente: e a confirmacao de que o trabalho saiu da ilha.
    'registrado_no_progresso', (_status_novo = 'done' and _client_id is not null)
  );
end;
$$;

revoke execute on function public.operator_report_event(text, text, text, text, uuid, uuid, text, text, text, text, text, boolean, boolean, integer, integer, jsonb) from anon;
grant execute on function public.operator_report_event(text, text, text, text, uuid, uuid, text, text, text, text, text, boolean, boolean, integer, integer, jsonb) to service_role;
