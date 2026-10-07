CREATE OR REPLACE FUNCTION public.operator_report_event(_operator_slug text, _event text, _run_key text, _actor text, _kanban_task_id uuid DEFAULT NULL::uuid, _painel_task_id uuid DEFAULT NULL::uuid, _action text DEFAULT NULL::text, _evidence text DEFAULT NULL::text, _next_step text DEFAULT NULL::text, _block_reason text DEFAULT NULL::text, _error text DEFAULT NULL::text, _approval_required boolean DEFAULT false, _from_cron boolean DEFAULT false, _attempt integer DEFAULT 1, _timeout_seconds integer DEFAULT 900, _detail jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  _nome_cliente text;
  _pronto_cliente boolean := false;
  _tarefa uuid;
begin
  select enabled into _flag from public.feature_flags where flag_key = 'operators_layer';
  if not coalesce(_flag, false) then
    raise exception 'flag_off: a camada de operadores esta desligada (operators_layer)';
  end if;

  select * into _op from public.internal_operators
    where slug = lower(trim(_operator_slug));
  if not found then
    raise exception 'operator_not_found: % nao existe na hierarquia', _operator_slug;
  end if;
  if _op.status <> 'active' then
    raise exception
      'operator_paused: % esta com status % e nao recebe nem registra trabalho ate ser reativado',
      _op.slug, _op.status;
  end if;

  if _event not in ('started', 'progress', 'done', 'failed', 'blocked', 'review', 'awaiting_input', 'heartbeat') then
    raise exception 'invalid_event: %', _event;
  end if;

  if _evidence is not null and (
    _evidence ~* '(token|signature|x-amz|apikey|api_key|secret|sig)='
  ) then
    _evidence := split_part(_evidence, '?', 1) || ' [query removida: continha credencial]';
  end if;

  -- ── Achar o vinculo: PRIMEIRO pela chave de idempotencia ──────────────
  --
  -- O run_key identifica a execucao. Se ja existe vinculo deste operador
  -- com esta chave, e ELE, venha o id no campo que vier. Casar so pelo par
  -- de ids foi o que fez o mesmo trabalho virar dois vinculos quando o
  -- relato trocou kanban_task_id por painel_task_id.
  select * into _link from public.operator_task_links l
    where l.operator_id = _op.id
      and l.agent_run_id = _run_key
    order by l.created_at
    limit 1;

  if not found and (_kanban_task_id is not null or _painel_task_id is not null) then
    select * into _link from public.operator_task_links l
      where l.operator_id = _op.id
        and coalesce(l.kanban_task_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(_kanban_task_id, '00000000-0000-0000-0000-000000000000'::uuid)
        and coalesce(l.painel_task_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(_painel_task_id, '00000000-0000-0000-0000-000000000000'::uuid)
      order by l.created_at desc limit 1;
  end if;

  if _link.id is null and _event <> 'heartbeat'
     and (_kanban_task_id is not null or _painel_task_id is not null) then
    insert into public.operator_task_links
      (operator_id, agent_run_id, kanban_task_id, painel_task_id, execution_source)
    values (_op.id, _run_key, _kanban_task_id, _painel_task_id,
            case when _from_cron then 'cron' else 'mcp' end)
    returning * into _link;
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
      -- O vinculo APRENDE o id que faltava, em vez de nascer um irmao.
      kanban_task_id = coalesce(kanban_task_id, _kanban_task_id),
      painel_task_id = coalesce(painel_task_id, _painel_task_id),
      last_action = coalesce(_action, last_action),
      last_evidence = coalesce(_evidence, last_evidence),
      next_step = coalesce(_next_step, next_step),
      block_reason = case when _event in ('failed', 'blocked')
        then coalesce(_block_reason, _error, block_reason) else null end,
      -- A flag ESPELHA a aprovacao, e nao o contrario. Antes isto era
      -- "_approval_required or approval_required": um OU que so sabia
      -- ligar, e prendia o vinculo numa pergunta que nunca existiu.
      approval_required = exists (
        select 1 from public.operator_approvals a
         where a.task_link_id = _link.id and a.status = 'pendente'
      ),
      updated_at = now()
    where id = _link.id
    returning * into _link;
  end if;

  insert into public.operator_runs
    (operator_id, run_key, task_link_id, status, attempt, timeout_seconds, error, detail)
  values (
    _op.id, _run_key, _link.id,
    public.operator_status_do_run(_event),
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
    (_actor, _op.id, _link.id, coalesce(_kanban_task_id, _link.kanban_task_id),
     coalesce(_action, _event), _status_velho, coalesce(_status_novo, _status_velho),
     _evidence, _from_cron, _approval_required, _run_key);

  -- ── A ponte com o progresso do cliente ────────────────────────────────
  --
  -- A tarefa sai do VINCULO, e nao so do parametro: quem relatou done por
  -- painel_task_id continua chegando na tarefa certa.
  -- SINALIZAR APROVACAO SEM ABRIR O PEDIDO agora deixa rastro.
  --
  -- O booleano nao diz QUAL acao o agente quer fazer, e action_kind e um
  -- vocabulario fechado: nao da para abrir o pedido por ele sem inventar a
  -- natureza da coisa. Entao o trabalho SEGUE e o desvio fica registrado,
  -- em vez de travar em silencio como travou treze vinculos.
  if _approval_required and _link.id is not null
     and not exists (
       select 1 from public.operator_approvals a
        where a.task_link_id = _link.id and a.status = 'pendente'
     ) then
    insert into public.operator_audit_log
      (actor, operator_id, task_link_id, kanban_task_id, action, evidence, run_key)
    values (
      'sistema', _op.id, _link.id, coalesce(_kanban_task_id, _link.kanban_task_id),
      'agente sinalizou aprovacao sem abrir o pedido',
      'O agente ' || _op.slug || ' passou _approval_required=true em report_event, '
        || 'mas nao ha aprovacao pendente para este vinculo. Pedido de aprovacao se '
        || 'abre por operator_request_approval, dizendo QUAL acao se quer fazer. '
        || 'O trabalho seguiu; nada ficou travado.',
      _run_key
    );
  end if;

  _tarefa := coalesce(_kanban_task_id, _link.kanban_task_id, _link.painel_task_id);

  if _status_novo = 'done' and _tarefa is not null then
    select pj.client_id, t.title into _client_id, _titulo_tarefa
      from public.tasks t
      join public.projects pj on pj.id = t.project_id
      where t.id = _tarefa
      limit 1;

    if _client_id is not null then
      select coalesce(nullif(trim(p.company_name), ''), p.full_name)
        into _nome_cliente
        from public.profiles p where p.id = _client_id;
      _pronto_cliente := true;

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
            'kanban_task_id', _tarefa,
            'task_link_id', _link.id,
            'pronto_para_cliente', true,
            'client_visible', false
          )
        );
      end if;
    end if;
  end if;

  -- ── O dono sabe de tudo, menos do pulso do cron ───────────────────────
  _notifica := _event <> 'heartbeat';
  if _notifica then
    _mensagem := _op.display_name || case _event
      when 'started' then ' iniciou'
      when 'progress' then ' avancou em'
      when 'done' then case when _status_novo = 'review'
        then ' concluiu SEM evidencia (foi para revisao)' else ' concluiu' end
      when 'failed' then ' falhou em'
      when 'blocked' then ' bloqueou'
      when 'review' then ' enviou para revisao'
      when 'awaiting_input' then ' esta esperando resposta em'
      else ' atualizou'
    end || ' ' || coalesce(nullif(trim(_titulo_tarefa), ''), 'uma tarefa')
      || coalesce(' · ' || _nome_cliente, '')
      || case when _pronto_cliente then ' · PRONTO PARA O CLIENTE' else '' end
      || case when _approval_required then ' · precisa de aprovacao' else '' end;

    -- O link leva ao VINCULO e carrega a run: quem clica no aviso chega no
    -- registro exato, e nao numa lista para procurar de novo.
    insert into public.notifications (user_id, message, notification_type, link)
    select ur.user_id, _mensagem,
      case when _pronto_cliente then 'operator_pronto' else 'operator' end,
      '/execucao?vinculo=' || coalesce(_link.id::text, '')
        || coalesce('&run=' || _run.id::text, '')
    from public.user_roles ur
    where ur.role = 'admin';
  end if;

  -- ─── O CARD ANDA JUNTO ───────────────────────────────────────────
  --
  -- Ate aqui o agente trabalhava e a tarefa ficava parada onde estava:
  -- dezenas de "pendentes" que ja tinham sido tocadas. O card agora
  -- acompanha o trabalho — ate a revisao, nunca alem.
  --
  -- `assigned_to` NAO e tocado: mover a coluna e dizer em que pe esta o
  -- trabalho; dizer de quem ele e continua sendo decisao humana.
  if _tarefa is not null then
    declare
      _status_card text;
      _card_novo text;
    begin
      select t.status into _status_card from public.tasks t where t.id = _tarefa;
      _card_novo := public.operator_status_do_card(
        _event, _status_card, _evidence is not null and btrim(_evidence) <> ''
      );
      if _card_novo is not null and _card_novo is distinct from _status_card then
        update public.tasks set status = _card_novo where id = _tarefa;
        insert into public.operator_audit_log
          (actor, operator_id, task_link_id, kanban_task_id, action, old_status, new_status)
        values ('mcp:' || _op.slug, _op.id, _link.id, _tarefa,
                'card movido pelo trabalho do agente', _status_card, _card_novo);
      end if;
    exception when others then
      -- Mover o card NAO pode derrubar o relato. O trabalho aconteceu; se
      -- o Kanban recusar (guard editorial, por exemplo), isso vira nota na
      -- trilha e o evento segue.
      insert into public.operator_audit_log
        (actor, operator_id, task_link_id, kanban_task_id, action)
      values ('mcp:' || _op.slug, _op.id, _link.id, _tarefa,
              'card NAO moveu: ' || left(sqlerrm, 200));
    end;
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
    'kanban_task_id', _tarefa,
    'registrado_no_progresso', (_status_novo = 'done' and _client_id is not null),
    'pronto_para_cliente', _pronto_cliente
  );
end;
$function$
