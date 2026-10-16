-- 16/10/2026 (dono: "está tendo muitos bloqueios no painel e não parece direito para aprovar").
--
-- Na trilha da ACE-87 o dono clicou "Aprovar e concluir" sete vezes e cada clique
-- voltou para "em revisão": a regra "concluir sem evidência vira revisão" (agosto)
-- valia também para a mão humana. Depois, o agente reabria o que a equipe decidira.
--
-- Agora:
-- 1. A decisão da equipe é final. Concluir sem prova anexada fecha, e a própria
--    decisão vira o registro ("Decisão de <nome> no painel em <data>").
-- 2. Concluir fecha o cartão do Kanban e os vínculos irmãos da mesma tarefa
--    (a decisão é sobre a tarefa, não sobre um agente).
-- 3. Agente não reabre o que a equipe concluiu: só a mão humana
--    (operator_human_action, que marca app.decisao_humana) reabre um vínculo.

create or replace function public.operator_human_action(_link_id uuid, _new_status text DEFAULT NULL::text, _note text DEFAULT NULL::text, _resolve_approval boolean DEFAULT false)
 RETURNS operator_task_links
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _link public.operator_task_links%rowtype;
  _velho text;
  _quem text;
  _flag boolean;
  _registro text;
  _irmao record;
  _status_card text;
begin
  -- rpc-caller-boundary-20260912
  PERFORM app_private.require_rpc_link_staff(_link_id);
  select enabled into _flag from public.feature_flags where flag_key = 'operators_layer';
  if not coalesce(_flag, false) then
    raise exception 'flag_off: a camada de operadores esta desligada (operators_layer)';
  end if;

  -- Só a equipe move o quadro. Cliente não vê e não toca.
  if not (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or public.has_role(auth.uid(), 'manager'::public.app_role)
    or public.has_role(auth.uid(), 'design'::public.app_role)
    or public.has_role(auth.uid(), 'traffic'::public.app_role)
  ) then
    raise exception 'not_allowed: somente a equipe move o quadro de execucao';
  end if;

  select * into _link from public.operator_task_links where id = _link_id;
  if not found then
    raise exception 'not_found: vinculo % nao existe', _link_id;
  end if;

  if _new_status is not null
    and _new_status not in ('queued', 'in_progress', 'done', 'review', 'awaiting_input', 'blocked')
  then
    raise exception 'invalid_status: %', _new_status;
  end if;

  -- Esta transação é a mão humana: o gatilho deixa reabrir um vínculo concluído.
  perform set_config('app.decisao_humana', '1', true);

  _velho := _link.status;
  select coalesce(p.full_name, 'equipe') into _quem
    from public.profiles p where p.id = auth.uid();
  _quem := coalesce(_quem, 'equipe');

  -- A decisão da equipe é final: concluir sem prova anexada fecha, e a
  -- decisão vira o registro. Antes isto virava "revisão" e o botão parecia
  -- não funcionar (16/10/2026).
  if _new_status = 'done' and coalesce(trim(_link.last_evidence), '') = '' then
    _registro := 'Decisão de ' || _quem || ' no painel em '
      || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') || '.';
  end if;

  update public.operator_task_links set
    status = coalesce(_new_status, status),
    last_evidence = case when _new_status = 'done' then coalesce(_registro, last_evidence) else last_evidence end,
    block_reason = case
      when _new_status is not null and _new_status <> 'blocked' then null
      else coalesce(_note, block_reason)
    end,
    next_step = case
      when _new_status = 'done' then null
      when _note is not null and coalesce(_new_status, '') <> 'blocked' then _note
      else next_step
    end,
    approval_required = case when _resolve_approval or _new_status = 'done' then false else approval_required end,
    updated_at = now()
  where id = _link_id
  returning * into _link;

  insert into public.operator_audit_log
    (actor, operator_id, task_link_id, kanban_task_id, action, old_status, new_status, evidence, from_cron, approval_required)
  values
    (_quem || ' (humano)', _link.operator_id, _link.id, _link.kanban_task_id,
     case
       when _resolve_approval and _new_status is null then 'aprovacao resolvida pela equipe'
       when _new_status is not null then 'movido pela equipe'
       else 'anotacao da equipe'
     end,
     _velho, _link.status, _registro, false, _link.approval_required);

  -- Concluir é sobre a tarefa: fecha os vínculos irmãos e o cartão do Kanban.
  if _link.status = 'done' and _link.kanban_task_id is not null then
    for _irmao in
      update public.operator_task_links set
        status = 'done',
        last_evidence = case when coalesce(trim(last_evidence), '') = ''
          then coalesce(_registro, _link.last_evidence) else last_evidence end,
        block_reason = null,
        next_step = null,
        approval_required = false,
        updated_at = now()
      where kanban_task_id = _link.kanban_task_id
        and id <> _link.id
        and status <> 'done'
      returning id, operator_id
    loop
      insert into public.operator_audit_log
        (actor, operator_id, task_link_id, kanban_task_id, action, new_status, from_cron)
      values (_quem || ' (humano)', _irmao.operator_id, _irmao.id, _link.kanban_task_id,
              'concluido junto com a tarefa pela equipe', 'done', false);
    end loop;

    begin
      select t.status into _status_card from public.tasks t where t.id = _link.kanban_task_id;
      if _status_card is distinct from 'done' then
        update public.tasks set status = 'done' where id = _link.kanban_task_id;
        insert into public.operator_audit_log
          (actor, operator_id, task_link_id, kanban_task_id, action, old_status, new_status, from_cron)
        values (_quem || ' (humano)', _link.operator_id, _link.id, _link.kanban_task_id,
                'cartao concluido pela equipe', _status_card, 'done', false);
      end if;
    exception when others then
      -- O Kanban recusar (guarda editorial, por exemplo) não derruba a decisão.
      insert into public.operator_audit_log
        (actor, operator_id, task_link_id, kanban_task_id, action, from_cron)
      values (_quem || ' (humano)', _link.operator_id, _link.id, _link.kanban_task_id,
              'cartao NAO fechou: ' || left(sqlerrm, 200), false);
    end;
  end if;

  return _link;
end;
$function$;

-- Agente não reabre o que a equipe concluiu. Os outros campos (último passo,
-- evidência) continuam atualizando: o diário segue completo.
create or replace function app_private.decisao_humana_e_final()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if old.status = 'done' and new.status is distinct from 'done'
     and coalesce(current_setting('app.decisao_humana', true), '') <> '1' then
    new.status := old.status;
    new.block_reason := old.block_reason;
  end if;
  return new;
end;
$function$;

drop trigger if exists operator_task_links_decisao_humana_final on public.operator_task_links;
create trigger operator_task_links_decisao_humana_final
  before update of status on public.operator_task_links
  for each row execute function app_private.decisao_humana_e_final();
