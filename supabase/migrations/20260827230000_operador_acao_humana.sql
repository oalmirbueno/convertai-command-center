-- A mão humana no quadro dos operadores.
--
-- A primeira migration deu ao painel apenas LEITURA dos vínculos: o
-- operador reportava e a equipe olhava. Faltava o gesto óbvio de um
-- quadro — arrastar o cartão, destravar o que ficou bloqueado, resolver
-- uma aprovação. Sem isso o humano só podia assistir, e um quadro que
-- não se move não é quadro.
--
-- O que NÃO se faz aqui: dar UPDATE solto na tabela. A ação humana passa
-- por um RPC que grava a MESMA trilha imutável das ações do agente — se
-- a mão humana escapasse da auditoria, a pergunta "quem mudou isso?"
-- voltaria a não ter resposta justamente nos casos mais importantes.
--
-- Rodar de novo não faz mal.

create or replace function public.operator_human_action(
  _link_id uuid,
  _new_status text default null,
  _note text default null,
  _resolve_approval boolean default false
)
returns public.operator_task_links
language plpgsql
security definer
set search_path = public
as $$
declare
  _link public.operator_task_links%rowtype;
  _velho text;
  _quem text;
  _flag boolean;
begin
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

  _velho := _link.status;

  -- A mesma régua do agente vale para a mão humana: concluir sem
  -- evidência vira revisão. A regra é do trabalho, não de quem clica.
  if _new_status = 'done' and coalesce(trim(_link.last_evidence), '') = '' then
    _new_status := 'review';
  end if;

  update public.operator_task_links set
    status = coalesce(_new_status, status),
    block_reason = case
      when _new_status is not null and _new_status <> 'blocked' then null
      else coalesce(_note, block_reason)
    end,
    next_step = case when _note is not null and coalesce(_new_status, '') <> 'blocked'
      then _note else next_step end,
    approval_required = case when _resolve_approval then false else approval_required end,
    updated_at = now()
  where id = _link_id
  returning * into _link;

  select coalesce(p.full_name, 'equipe') into _quem
    from public.profiles p where p.id = auth.uid();

  insert into public.operator_audit_log
    (actor, operator_id, task_link_id, kanban_task_id, action, old_status, new_status, evidence, from_cron, approval_required)
  values
    (coalesce(_quem, 'equipe') || ' (humano)', _link.operator_id, _link.id, _link.kanban_task_id,
     case
       when _resolve_approval and _new_status is null then 'aprovacao resolvida pela equipe'
       when _new_status is not null then 'movido pela equipe'
       else 'anotacao da equipe'
     end,
     _velho, _link.status, null, false, _link.approval_required);

  return _link;
end;
$$;

revoke execute on function public.operator_human_action(uuid, text, text, boolean) from anon;
grant execute on function public.operator_human_action(uuid, text, text, boolean) to authenticated, service_role;
