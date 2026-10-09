-- Retorno do Hermes nas conversas dos agentes das Mesas (lote B, 09/10/2026).
-- O pedido nasce no agente da Mesa (_shared/pedido-ao-hermes.ts: tarefa com
-- source 'agente_mesa_hermes' + operator_assign_task + diário). O quadro do
-- pedido guarda o id do vínculo na conversa. Aqui, o caminho de volta, sem
-- fila nova: quando o Hermes escreve no diário do vínculo ou o estado muda
-- para revisão, bloqueio, espera de informação ou concluído, uma linha entra na
-- conversa de origem (uma inserção leve; nada é reescrito).

create or replace function app_private.conversa_do_pedido_ao_hermes(_link_id uuid)
returns table (conversa_id uuid, client_id uuid)
language sql
stable
security definer
set search_path to 'public'
as $$
  select m.conversa_id, m.client_id
  from public.agente_mensagens m
  where m.papel = 'agente' and m.conteudo like '%' || _link_id::text || '%'
  order by m.criado_em asc
  limit 1;
$$;

create or replace function app_private.retorno_do_hermes_no_diario()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _link public.operator_task_links%rowtype;
  _fonte text;
  _conversa uuid;
  _cliente uuid;
begin
  if new.author_kind is distinct from 'operador' then return new; end if;
  select * into _link from public.operator_task_links where id = new.task_link_id;
  if not found then return new; end if;
  select t.source into _fonte from public.tasks t where t.id = _link.kanban_task_id;
  if coalesce(_fonte, '') <> 'agente_mesa_hermes' then return new; end if;
  select c.conversa_id, c.client_id into _conversa, _cliente from app_private.conversa_do_pedido_ao_hermes(_link.id) c;
  if _conversa is null then return new; end if;
  insert into public.agente_mensagens (conversa_id, client_id, papel, conteudo, anexos)
  values (
    _conversa, _cliente, 'agente',
    'Retorno do Hermes' || coalesce(': ' || nullif(trim(new.title), ''), '') || E'\n\n' || left(coalesce(new.body, ''), 3000),
    jsonb_build_array(jsonb_build_object('tipo', 'retorno_do_hermes', 'vinculo_id', _link.id, 'tarefa_id', _link.kanban_task_id, 'participacao_id', new.id, 'entrada', new.entry_type, 'anexos', coalesce(new.attachments, '[]'::jsonb)))
  );
  return new;
end;
$$;

create or replace function app_private.estado_do_pedido_ao_hermes()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _fonte text;
  _conversa uuid;
  _cliente uuid;
  _rotulo text;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status not in ('review', 'blocked', 'awaiting_input', 'done') then return new; end if;
  select t.source into _fonte from public.tasks t where t.id = new.kanban_task_id;
  if coalesce(_fonte, '') <> 'agente_mesa_hermes' then return new; end if;
  select c.conversa_id, c.client_id into _conversa, _cliente from app_private.conversa_do_pedido_ao_hermes(new.id) c;
  if _conversa is null then return new; end if;
  _rotulo := case new.status
    when 'review' then 'em revisão (falta conferir a evidência)'
    when 'blocked' then 'bloqueado'
    when 'awaiting_input' then 'esperando informação'
    when 'done' then 'concluído com evidência'
  end;
  insert into public.agente_mensagens (conversa_id, client_id, papel, conteudo, anexos)
  values (
    _conversa, _cliente, 'sistema',
    'Pedido ao Hermes ' || _rotulo
      || coalesce('. Evidência: ' || left(nullif(trim(new.last_evidence), ''), 600), '')
      || coalesce('. Motivo: ' || left(nullif(trim(new.block_reason), ''), 400), '')
      || coalesce('. Próximo passo: ' || left(nullif(trim(new.next_step), ''), 300), '') || '.',
    jsonb_build_array(jsonb_build_object('tipo', 'estado_do_hermes', 'vinculo_id', new.id, 'tarefa_id', new.kanban_task_id, 'estado', new.status))
  );
  return new;
end;
$$;

revoke all on function app_private.conversa_do_pedido_ao_hermes(uuid) from public;
revoke all on function app_private.retorno_do_hermes_no_diario() from public;
revoke all on function app_private.estado_do_pedido_ao_hermes() from public;

drop trigger if exists operator_participations_retorno_nas_mesas on public.operator_participations;
create trigger operator_participations_retorno_nas_mesas
  after insert on public.operator_participations
  for each row execute function app_private.retorno_do_hermes_no_diario();

drop trigger if exists operator_task_links_estado_nas_mesas on public.operator_task_links;
create trigger operator_task_links_estado_nas_mesas
  after update of status on public.operator_task_links
  for each row execute function app_private.estado_do_pedido_ao_hermes();
