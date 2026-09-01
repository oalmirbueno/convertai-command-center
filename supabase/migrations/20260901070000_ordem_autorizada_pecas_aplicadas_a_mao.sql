-- ═══════════════════════════════════════════════════════════════════════
-- AS DUAS PECAS DO LACO DE ORDEM QUE FORAM APLICADAS A MAO.
--
-- Estas duas nao passaram pelo caminho normal: o classificador de
-- permissoes desta maquina recusou as escritas, e o dono aplicou o SQL
-- pelo Editor do Supabase. O banco ja tem as duas — este arquivo existe
-- para o REPOSITORIO parar de mentir sobre producao.
--
-- Repositorio que nao descreve o banco e pior que repositorio incompleto:
-- o proximo a ler vai desenhar em cima de um mapa errado.
--
-- Tudo aqui e idempotente (create or replace / drop if exists), entao
-- aplicar de novo nao quebra nada e nao duplica nada.
--
-- ═══ REVERSAO ══════════════════════════════════════════════════════════
--
--   drop trigger if exists trg_avisar_ordem_executada
--     on public.operator_approvals;
--   drop function if exists public.operator_avisar_ordem_executada();
--   drop function if exists public.operator_cancelar_tarefa(text, uuid, uuid, text);
--
-- Reverter NAO desfaz cancelamentos ja feitos: as tarefas continuam com
-- status 'cancelado' e o motivo dentro da descricao. Isso e de proposito —
-- desfazer em massa apagaria decisoes que alguem tomou, e o painel nao tem
-- como saber quais foram um erro.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1) Cancelar tarefa, so com ordem aprovada, e SEM apagar ────────────
create or replace function public.operator_cancelar_tarefa(
  _operator_slug text, _approval_id uuid, _task_id uuid, _motivo text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  _op public.internal_operators%rowtype;
  _aprov public.operator_approvals%rowtype;
  _status_velho text;
begin
  if coalesce(btrim(_motivo), '') = '' then
    raise exception 'sem_motivo: tarefa cancelada sem motivo vira misterio no historico'; end if;

  select * into _op from public.internal_operators where slug = lower(trim(_operator_slug));
  if not found then raise exception 'operator_not_found: %', _operator_slug; end if;

  select * into _aprov from public.operator_approvals
   where id = _approval_id and operator_id = _op.id;
  if not found then
    raise exception 'approval_not_found: ordem % nao existe para este agente', _approval_id; end if;
  if _aprov.status <> 'aprovado' then
    raise exception
      'nao_autorizada: cancelar tarefa exige ordem aprovada (esta como %)', _aprov.status; end if;
  if _aprov.action_kind <> 'excluir_dados' then
    raise exception
      'ordem_de_outro_tipo: esta ordem autoriza "%", nao cancelar tarefa', _aprov.action_kind; end if;

  select status into _status_velho from public.tasks where id = _task_id;
  if not found then raise exception 'task_not_found: %', _task_id; end if;

  -- NAO APAGA. Marca cancelado com o motivo dentro da propria tarefa.
  -- Apagar destruiria a trilha que sustenta esta camada inteira, e o dono
  -- perderia a historia junto com a linha. Titulo, prazo e responsavel
  -- ficam intocados: cancelar e mudar o estado, nao reescrever o passado.
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

grant execute on function public.operator_cancelar_tarefa(text, uuid, uuid, text)
  to authenticated, service_role;

-- ─── 2) O aviso de que uma ordem foi CUMPRIDA ───────────────────────────
--
-- Gatilho, e nao codigo dentro de operator_ordem_executada: assim vale
-- para qualquer caminho que marque executed_at, hoje ou amanha. O dono
-- soube quando autorizou; acao externa sem aviso de conclusao e o que
-- gera o "publicaram o que?".
create or replace function public.operator_avisar_ordem_executada()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
declare _nome text;
begin
  -- So no instante da virada: update que nao mexe em executed_at nao avisa
  -- de novo, senao uma correcao de texto reenviaria a notificacao.
  if new.executed_at is null or old.executed_at is not null then
    return new;
  end if;
  select display_name into _nome from public.internal_operators where id = new.operator_id;
  insert into public.notifications (user_id, message, notification_type, link)
  select ur.user_id,
         coalesce(_nome, 'Um agente') || ' executou: ' || new.o_que,
         'operator_executou',
         '/execucao?vinculo=' || coalesce(new.task_link_id::text, '')
    from public.user_roles ur where ur.role = 'admin';
  return new;
end;
$$;

drop trigger if exists trg_avisar_ordem_executada on public.operator_approvals;
create trigger trg_avisar_ordem_executada
  after update of executed_at on public.operator_approvals
  for each row execute function public.operator_avisar_ordem_executada();
