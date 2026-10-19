-- 19/10/2026 (dono: "tem muitas tarefas travadas, isso não pode acontecer; proíbe
-- demais os agentes de trabalhar"). Dos 11 vínculos travados, 6 eram de tarefa já
-- excluída e 3 de rodada que parou sem sinal: nenhum dependia dele.
--
-- 1. Rodada que parou sem sinal volta para a fila do agente (ele retoma do ponto
--    em que parou). Só trava na terceira seguida em 24 h.
-- 2. Vínculo de tarefa excluída é encerrado, não bloqueado.
-- 3. Os que já estavam presos assim saem da mesa do dono.

create or replace function public.operator_expire_stale_runs()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _n integer;
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
    -- Volta para a fila: o agente retoma na próxima rodada. Só trava quando a
    -- mesma tarefa já parou sem sinal duas vezes nas últimas 24 h (esta é a terceira).
    update public.operator_task_links l set
      status = case when (
          select count(*) from public.operator_runs r2
           where r2.task_link_id = l.id
             and r2.status = 'timeout'
             and r2.finished_at > now() - interval '24 hours'
        ) >= 2 then 'blocked' else 'queued' end,
      block_reason = case when (
          select count(*) from public.operator_runs r2
           where r2.task_link_id = l.id
             and r2.status = 'timeout'
             and r2.finished_at > now() - interval '24 hours'
        ) >= 2 then 'execucao parou 3 vezes seguidas sem sinal' else null end,
      next_step = 'Retomar do ponto em que parou (a rodada anterior parou sem sinal).',
      updated_at = now()
    from expiradas e
    where l.id = e.task_link_id and l.status = 'in_progress'
    returning l.id
  )
  select count(*) into _n from expiradas;
  return _n;
end;
$function$;

create or replace function public.operator_fechar_orfaos()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _propostas integer := 0;
  _runs integer := 0;
  _vinculos integer := 0;
BEGIN
  -- rpc-caller-boundary-20260912
  PERFORM app_private.require_rpc_admin();
  IF NOT app_private.rpc_trusted_backend() AND NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'somente_equipe';
  END IF;

  -- 1) Proposta de responsavel para tarefa que nao existe mais, foi
  --    excluida ou ja foi concluida: perdeu o objeto.
  WITH fechadas AS (
    UPDATE public.assignment_proposals p
       SET status = 'rejeitada',
           decided_at = now(),
           decision_note = COALESCE(p.decision_note, 'Fechada pelo painel: a tarefa foi excluída ou concluída antes da decisão.')
      FROM (
        SELECT p2.id
          FROM public.assignment_proposals p2
          LEFT JOIN public.tasks t ON t.id = p2.kanban_task_id
         WHERE p2.status = 'pendente'
           AND (t.id IS NULL OR t.deleted_at IS NOT NULL OR lower(COALESCE(t.status, '')) IN ('done', 'completed', 'concluida', 'cancelado', 'cancelled'))
      ) alvo
     WHERE p.id = alvo.id
     RETURNING p.id
  )
  SELECT count(*) INTO _propostas FROM fechadas;

  -- 2) Run que espera gente (ou revisao) para tarefa excluida: expira com motivo.
  WITH expiradas AS (
    UPDATE public.operator_runs r
       SET status = 'timeout',
           finished_at = COALESCE(r.finished_at, now()),
           error = COALESCE(r.error, 'encerrada: a tarefa foi excluída')
      FROM public.operator_task_links l
      LEFT JOIN public.tasks t ON t.id = l.kanban_task_id
     WHERE r.task_link_id = l.id
       AND r.status IN ('awaiting_input', 'review', 'started', 'progress')
       AND l.kanban_task_id IS NOT NULL
       AND (t.id IS NULL OR t.deleted_at IS NOT NULL)
     RETURNING r.id
  )
  SELECT count(*) INTO _runs FROM expiradas;

  -- 3) Vinculo de tarefa excluida e encerrado com o motivo (19/10/2026: antes
  --    virava "bloqueado" e ficava na mesa do dono para sempre).
  WITH encerrados AS (
    UPDATE public.operator_task_links l
       SET status = 'done',
           last_evidence = COALESCE(NULLIF(btrim(l.last_evidence), ''), 'Tarefa excluída: vínculo encerrado pelo painel.'),
           block_reason = NULL,
           next_step = NULL,
           updated_at = now()
      FROM (
        SELECT l2.id
          FROM public.operator_task_links l2
          LEFT JOIN public.tasks t ON t.id = l2.kanban_task_id
         WHERE l2.kanban_task_id IS NOT NULL
           AND l2.status <> 'done'
           AND (t.id IS NULL OR t.deleted_at IS NOT NULL)
      ) alvo
     WHERE l.id = alvo.id
     RETURNING l.id
  )
  SELECT count(*) INTO _vinculos FROM encerrados;

  RETURN jsonb_build_object('propostas_fechadas', _propostas, 'runs_expirados', _runs, 'vinculos_encerrados', _vinculos);
END;
$function$;

-- 3) Os que já estavam presos assim saem da mesa do dono, com a trilha.
with encerrados as (
  update public.operator_task_links set
    status = 'done',
    last_evidence = coalesce(nullif(btrim(last_evidence), ''), block_reason),
    block_reason = null,
    next_step = null,
    updated_at = now()
  where status = 'blocked'
    and block_reason ilike 'Tarefa exclu%'
  returning id, operator_id, kanban_task_id
)
insert into public.operator_audit_log (actor, operator_id, task_link_id, kanban_task_id, action, new_status, from_cron)
select 'painel (limpeza de 19/10)', operator_id, id, kanban_task_id, 'encerrado: a tarefa tinha sido excluida', 'done', false
  from encerrados;

with retomados as (
  update public.operator_task_links set
    status = 'queued',
    block_reason = null,
    next_step = 'Retomar do ponto em que parou (a rodada anterior parou sem sinal).',
    updated_at = now()
  where status = 'blocked'
    and block_reason = 'execucao expirou sem heartbeat'
  returning id, operator_id, kanban_task_id
)
insert into public.operator_audit_log (actor, operator_id, task_link_id, kanban_task_id, action, old_status, new_status, from_cron)
select 'painel (limpeza de 19/10)', operator_id, id, kanban_task_id, 'devolvido a fila: a rodada tinha parado sem sinal', 'blocked', 'queued', false
  from retomados;
