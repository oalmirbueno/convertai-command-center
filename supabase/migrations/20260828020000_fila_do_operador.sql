-- O elo que faltava: alguem PRECISA entregar a tarefa ao agente.
--
-- O quadro estava vazio e a leitura obvia era "os agentes nao reportam".
-- A causa e uma casa antes: ate aqui, a UNICA coisa que criava vinculo era
-- o proprio `operator_report_event`. Ou seja, para o agente reportar uma
-- tarefa, ele ja precisava saber o UUID dela — e ninguem tinha como
-- contar isso a ele, a nao ser um humano colando o identificador no grupo.
--
-- Um sistema que so funciona quando alguem cola UUID a mao nao esta
-- ligado; esta sendo empurrado.
--
-- Aqui entra o despachante: a tarefa do Kanban e OFERECIDA ao agente, que
-- passa a ver a propria fila e puxa dela. O ciclo fecha sozinho:
--
--   Kanban -> operator_assign_task -> fila do agente -> operator_report
--          -> evidencia -> project_memory -> notificacao
--
-- O que esta funcao NAO faz, e nunca vai fazer: encostar em
-- `assigned_to`. Oferecer trabalho a um agente nao tira a tarefa de quem
-- responde por ela. Sao duas colunas diferentes porque sao duas coisas
-- diferentes, e essa distincao e o coracao de toda a camada.
--
-- Rodar de novo nao faz mal.

/**
 * Oferece uma tarefa do Kanban a um operador interno.
 *
 * Idempotente por (operador, tarefa): chamar duas vezes devolve o vinculo
 * que ja existe, em vez de abrir uma segunda fila para o mesmo trabalho.
 *
 * Se a tarefa ja estiver VIVA com OUTRO operador, recusa e diz com quem —
 * dois agentes na mesma tarefa e o jeito mais rapido de gerar trabalho
 * duplicado e evidencia contraditoria.
 */
create or replace function public.operator_assign_task(
  _operator_slug text,
  _kanban_task_id uuid,
  _actor text,
  _note text default null
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
  _dono public.internal_operators%rowtype;
  _titulo text;
  _humano uuid;
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

  -- A tarefa tem que existir. Sem esta checagem, um id errado viraria uma
  -- fila fantasma que o agente nunca conseguiria cumprir.
  select t.title, t.assigned_to into _titulo, _humano
    from public.tasks t where t.id = _kanban_task_id;
  if not found then
    raise exception 'task_not_found: tarefa % nao existe no Kanban', _kanban_task_id;
  end if;

  -- Ja ofereci esta tarefa a este operador? Devolve o que existe.
  select * into _link from public.operator_task_links
    where operator_id = _op.id and kanban_task_id = _kanban_task_id
    order by created_at desc limit 1;
  if found and _link.status not in ('done') then
    return jsonb_build_object(
      'ok', true, 'ja_existia', true, 'link_id', _link.id,
      'status', _link.status, 'operator', _op.slug, 'titulo', _titulo
    );
  end if;

  -- Outro operador ja esta nela?
  select o.* into _dono from public.operator_task_links l
    join public.internal_operators o on o.id = l.operator_id
   where l.kanban_task_id = _kanban_task_id
     and l.operator_id <> _op.id
     and l.status in ('queued', 'in_progress', 'awaiting_input', 'review')
   limit 1;
  if found then
    raise exception
      'ja_atribuida: esta tarefa ja esta com %. Conclua, libere ou escolha outra tarefa.',
      _dono.display_name;
  end if;

  insert into public.operator_task_links
    (operator_id, kanban_task_id, execution_source, status, next_step)
  values (_op.id, _kanban_task_id, 'painel', 'queued', nullif(trim(_note), ''))
  returning * into _link;

  insert into public.operator_audit_log
    (actor, operator_id, task_link_id, kanban_task_id, action, old_status, new_status)
  values
    (_actor, _op.id, _link.id, _kanban_task_id,
     'tarefa oferecida a ' || _op.display_name, null, 'queued');

  return jsonb_build_object(
    'ok', true,
    'ja_existia', false,
    'link_id', _link.id,
    'status', 'queued',
    'operator', _op.slug,
    'titulo', _titulo,
    -- O responsavel humano continua exatamente onde estava. Devolver isso
    -- na resposta e a prova, para quem chamou, de que nada foi tomado.
    'responsavel_humano_intocado', _humano
  );
end;
$$;

revoke execute on function public.operator_assign_task(text, uuid, text, text) from anon;
grant execute on function public.operator_assign_task(text, uuid, text, text) to authenticated, service_role;

-- Buscar "a fila deste operador" e a consulta mais quente da camada agora.
create index if not exists operator_task_links_fila_idx
  on public.operator_task_links (operator_id, status, created_at desc);
