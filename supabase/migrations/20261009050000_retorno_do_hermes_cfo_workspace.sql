-- Retorno do Hermes também nas conversas do CFO e do Workspace (lote B, 09/10/2026).
-- O pedido ao Hermes pode nascer no CFO (cfo_mensagens) e no Workspace
-- (workspace_agent_messages), que não usam agente_mensagens. O quadro do
-- pedido guarda o id do vínculo no texto; aqui o caminho de volta procura
-- nas três conversas e escreve onde o pedido nasceu. Uma inserção leve.

create or replace function app_private.origem_do_pedido_ao_hermes(_link_id uuid)
returns table (destino text, conversa_id uuid, client_id uuid, dono_id uuid)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  return query
    select 'agente'::text, m.conversa_id, m.client_id, null::uuid
    from public.agente_mensagens m
    where m.papel = 'agente' and m.conteudo like '%' || _link_id::text || '%'
    order by m.criado_em asc limit 1;
  if found then return; end if;
  return query
    select 'cfo'::text, null::uuid, null::uuid, c.dono_id
    from public.cfo_mensagens c
    where c.papel = 'agente' and c.conteudo like '%' || _link_id::text || '%'
    order by c.criado_em asc limit 1;
  if found then return; end if;
  return query
    select 'workspace'::text, w.thread_id, null::uuid, null::uuid
    from public.workspace_agent_messages w
    where w.role = 'assistant' and w.content like '%' || _link_id::text || '%'
    order by w.created_at asc limit 1;
end;
$$;

revoke all on function app_private.origem_do_pedido_ao_hermes(uuid) from public;

create or replace function app_private.escrever_retorno_do_hermes(_link_id uuid, _papel text, _texto text, _anexo jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _o record;
begin
  select * into _o from app_private.origem_do_pedido_ao_hermes(_link_id) limit 1;
  if _o.destino is null then return; end if;
  if _o.destino = 'agente' then
    insert into public.agente_mensagens (conversa_id, client_id, papel, conteudo, anexos)
    values (_o.conversa_id, _o.client_id, _papel, _texto, jsonb_build_array(_anexo));
  elsif _o.destino = 'cfo' then
    insert into public.cfo_mensagens (dono_id, papel, conteudo, anexos)
    values (_o.dono_id, case when _papel = 'sistema' then 'sistema' else 'agente' end, _texto, jsonb_build_array(_anexo));
  elsif _o.destino = 'workspace' then
    insert into public.workspace_agent_messages (thread_id, role, content, meta)
    values (_o.conversa_id, 'assistant', _texto, _anexo);
  end if;
end;
$$;

revoke all on function app_private.escrever_retorno_do_hermes(uuid, text, text, jsonb) from public;

create or replace function app_private.retorno_do_hermes_no_diario()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _link public.operator_task_links%rowtype;
  _fonte text;
begin
  if new.author_kind is distinct from 'operador' then return new; end if;
  select * into _link from public.operator_task_links where id = new.task_link_id;
  if not found then return new; end if;
  select t.source into _fonte from public.tasks t where t.id = _link.kanban_task_id;
  if coalesce(_fonte, '') <> 'agente_mesa_hermes' then return new; end if;
  perform app_private.escrever_retorno_do_hermes(
    _link.id, 'agente',
    'Retorno do Hermes' || coalesce(': ' || nullif(trim(new.title), ''), '') || E'\n\n' || left(coalesce(new.body, ''), 3000),
    jsonb_build_object('tipo', 'retorno_do_hermes', 'vinculo_id', _link.id, 'tarefa_id', _link.kanban_task_id, 'participacao_id', new.id, 'entrada', new.entry_type, 'anexos', coalesce(new.attachments, '[]'::jsonb))
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
  _rotulo text;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status not in ('review', 'blocked', 'awaiting_input', 'done') then return new; end if;
  select t.source into _fonte from public.tasks t where t.id = new.kanban_task_id;
  if coalesce(_fonte, '') <> 'agente_mesa_hermes' then return new; end if;
  _rotulo := case new.status
    when 'review' then 'em revisão (falta conferir a evidência)'
    when 'blocked' then 'bloqueado'
    when 'awaiting_input' then 'esperando informação'
    when 'done' then 'concluído com evidência'
  end;
  perform app_private.escrever_retorno_do_hermes(
    new.id, 'sistema',
    'Pedido ao Hermes ' || _rotulo
      || coalesce('. Evidência: ' || left(nullif(trim(new.last_evidence), ''), 600), '')
      || coalesce('. Motivo: ' || left(nullif(trim(new.block_reason), ''), 400), '')
      || coalesce('. Próximo passo: ' || left(nullif(trim(new.next_step), ''), 300), '') || '.',
    jsonb_build_object('tipo', 'estado_do_hermes', 'vinculo_id', new.id, 'tarefa_id', new.kanban_task_id, 'estado', new.status)
  );
  return new;
end;
$$;
