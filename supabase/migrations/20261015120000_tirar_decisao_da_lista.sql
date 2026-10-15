-- Tirar um pedido de aprovação da lista sem apagar (15/10/2026).
--
-- O dono (Execução > Central > Decisões): "fica muito poluído, com um monte de
-- decisões que não dá para decidir". Pedido vencido (valid_until no passado)
-- não aceita mais aprovar; até hoje só saía da fila por limpeza manual em
-- migration. Agora o admin tira da lista pelo painel.
--
-- Não apaga e não executa nada: o pedido vira 'expirado' com o motivo, quem
-- tirou e quando (invalidated_at), o selo do vínculo cai se não sobrar outro
-- pendente, e a trilha registra.

create or replace function public.operator_approval_retirar(_approval_id uuid, _motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  _aprov public.operator_approvals%rowtype;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'apenas_admin: tirar pedido de aprovacao da lista';
  end if;

  select * into _aprov from public.operator_approvals where id = _approval_id for update;
  if not found then
    raise exception 'approval_not_found: % nao existe', _approval_id;
  end if;
  if _aprov.status not in ('pendente', 'adiado') then
    raise exception 'ja_decidida: esta aprovacao esta como %', _aprov.status;
  end if;

  update public.operator_approvals
    set status = 'expirado',
        invalidated_at = now(),
        invalidation_reason = coalesce(
          nullif(trim(_motivo), ''),
          case when _aprov.valid_until is not null and _aprov.valid_until <= now()
            then 'vencida_retirada_pelo_dono' else 'retirada_pelo_dono' end),
        decided_by = auth.uid(),
        decided_at = now()
    where id = _approval_id
    returning * into _aprov;

  if _aprov.task_link_id is not null and not exists (
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
            || ' -> retirada da lista (' || _aprov.invalidation_reason || ')');

  return jsonb_build_object('ok', true, 'approval_id', _aprov.id, 'status', _aprov.status);
end;
$function$;

revoke all on function public.operator_approval_retirar(uuid, text) from public, anon;
grant execute on function public.operator_approval_retirar(uuid, text) to authenticated;
