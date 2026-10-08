-- PROPOSTA — NÃO APLICADA (08/10/2026). Precisa de aprovação específica do Almir.
--
-- Divergência de integridade do operator_report (diagnóstico em
-- docs/execucao/CENTRAL-DE-AUTONOMIA.md, seção 3).
--
-- Causa: operator_status_do_card só move o card em started (-> doing),
-- review e done (-> review). blocked, failed e awaiting_input devolvem null:
-- o vínculo e a execução param, mas o card fica em "doing" para sempre.
-- operator_expire_stale_runs também bloqueia o vínculo sem tocar o card.
--
-- Correção mínima (duas funções, nada de schema, nada retroativo):
-- 1. trabalho parou (blocked/failed/awaiting_input) com o card em doing:
--    o card volta para todo. O motivo fica no vínculo (block_reason); um
--    started novo devolve o card a doing. Nunca sobe além de review; nunca
--    toca assigned_to; nunca conclui.
-- 2. a expiração sem sinal faz o mesmo, linha a linha, com a mesma trilha
--    ("card movido pelo trabalho do agente") e sem derrubar a expiração se
--    um guard do Kanban recusar (vira nota na trilha, como no report).
--
-- O caso "done fecha execução e vínculo, a tarefa fica em review" NÃO muda:
-- é o desenho (o agente leva até a revisão; concluir é humano, por
-- complete_task). A Central mostra isso como "Execução concluída · entrega em
-- revisão", nunca como feito.
--
-- Rollback: reaplicar as duas definições de
-- supabase/migrations/20260901010000_agente_termina_e_o_kanban_anda.sql
-- (operator_status_do_card) e 20260912213530_rpc_caller_boundaries_preserve_data.sql
-- (operator_expire_stale_runs).

CREATE OR REPLACE FUNCTION public.operator_status_do_card(_event text, _status_atual text, _tem_evidencia boolean)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    -- Comecou a trabalhar: tira da fila, poe em andamento.
    when _event = 'started' and _status_atual in ('backlog','todo') then 'doing'
    -- Entregou (com ou sem prova) ou pediu revisao: vai para revisao humana.
    -- done sem evidencia ja e rebaixado a review no vinculo; o card nunca passa de review.
    when _event in ('review', 'done') then
      case when _status_atual in ('backlog','todo','doing') then 'review' else null end
    -- O trabalho PAROU (bloqueio, falha, espera de insumo): o card sai de
    -- "em andamento". Antes ficava em doing com o vinculo bloqueado.
    when _event in ('blocked', 'failed', 'awaiting_input') and _status_atual = 'doing' then 'todo'
    else null
  end
$function$;

CREATE OR REPLACE FUNCTION public.operator_expire_stale_runs()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _n integer;
  _lib jsonb;
  _l record;
BEGIN
  -- rpc-caller-boundary-20260912
  PERFORM app_private.require_rpc_admin();
  with expiradas as (
    update public.operator_runs r set
      status = 'timeout',
      finished_at = now(),
      error = coalesce(r.error, 'timeout: sem heartbeat dentro do prazo')
    where r.status in ('started', 'progress')
      and r.heartbeat_at < now() - make_interval(secs => r.timeout_seconds)
    returning r.id, r.task_link_id
  ),
  liberadas as (
    update public.operator_task_links l set
      status = 'blocked',
      block_reason = coalesce(l.block_reason, 'execucao expirou sem heartbeat'),
      updated_at = now()
    from expiradas e
    where l.id = e.task_link_id and l.status = 'in_progress'
    returning l.id, l.operator_id, coalesce(l.kanban_task_id, l.painel_task_id) as tarefa
  )
  select (select count(*) from expiradas),
         coalesce((select jsonb_agg(jsonb_build_object('id', id, 'operator_id', operator_id, 'tarefa', tarefa)) from liberadas), '[]'::jsonb)
    into _n, _lib;

  -- O card acompanha a parada, como no operator_report_event (e com a mesma rede de seguranca).
  for _l in select * from jsonb_to_recordset(_lib) as x(id uuid, operator_id uuid, tarefa uuid) where x.tarefa is not null loop
    begin
      update public.tasks set status = 'todo'
        where id = _l.tarefa and status = 'doing' and deleted_at is null;
      if found then
        insert into public.operator_audit_log
          (actor, operator_id, task_link_id, kanban_task_id, action, old_status, new_status)
        values ('sistema', _l.operator_id, _l.id, _l.tarefa,
                'card movido pelo trabalho do agente', 'doing', 'todo');
      end if;
    exception when others then
      insert into public.operator_audit_log
        (actor, operator_id, task_link_id, kanban_task_id, action)
      values ('sistema', _l.operator_id, _l.id, _l.tarefa, 'card NAO moveu: ' || left(sqlerrm, 200));
    end;
  end loop;
  return _n;
end;
$function$;

-- Opcional, separado, também só com aprovação: reconciliar os casos já existentes
-- (hoje: tarefa 1980d0bb em doing com vínculo bloqueado; 3218120b em doing com
-- vínculo concluído desde 29/08, anterior à regra do card). Não incluído aqui de
-- propósito: mexe em card de cliente e deve ser decidido caso a caso.
