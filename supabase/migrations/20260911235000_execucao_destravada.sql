-- Execucao da equipe travada: 311 propostas de responsavel pendentes de um
-- unico lote (01/09), 185 delas apontando para tarefa excluida ou concluida;
-- 16 vinculos "bloqueados" cuja tarefa ja nao existe; runs esperando gente
-- ha mais de uma semana. A tela pedia decisao sobre coisa que perdeu o
-- objeto e o dono nao conseguia enxergar o que ainda e real.
--
-- Regra que fica: proposta e vinculo so vivem enquanto a tarefa vive.
-- Tarefa excluida ou concluida fecha a proposta sozinha (gatilho) e o
-- painel esconde o vinculo como "encerrado". Nada e apagado: a trilha
-- continua inteira, so muda o status e fica o motivo.

CREATE OR REPLACE FUNCTION public.operator_fechar_orfaos()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _propostas integer := 0;
  _runs integer := 0;
  _vinculos integer := 0;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
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

  -- 3) Vinculo de tarefa excluida vira bloqueado com o motivo, se ainda nao era.
  WITH encerrados AS (
    UPDATE public.operator_task_links l
       SET status = 'blocked',
           block_reason = COALESCE(l.block_reason, 'Tarefa excluída: vínculo encerrado pelo painel.'),
           updated_at = now()
      FROM (
        SELECT l2.id
          FROM public.operator_task_links l2
          LEFT JOIN public.tasks t ON t.id = l2.kanban_task_id
         WHERE l2.kanban_task_id IS NOT NULL
           AND l2.status <> 'done'
           AND l2.status <> 'blocked'
           AND (t.id IS NULL OR t.deleted_at IS NOT NULL)
      ) alvo
     WHERE l.id = alvo.id
     RETURNING l.id
  )
  SELECT count(*) INTO _vinculos FROM encerrados;

  RETURN jsonb_build_object('propostas_fechadas', _propostas, 'runs_expirados', _runs, 'vinculos_encerrados', _vinculos);
END;
$$;

REVOKE ALL ON FUNCTION public.operator_fechar_orfaos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_fechar_orfaos() TO authenticated, service_role;

-- Gatilho: tarefa excluida ou concluida fecha as propostas pendentes dela
-- na hora, para a fila nunca mais acumular pedido sem objeto.
CREATE OR REPLACE FUNCTION public.tasks_encerra_propostas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL)
     OR (lower(COALESCE(NEW.status, '')) IN ('done', 'completed', 'concluida', 'cancelado', 'cancelled')
         AND lower(COALESCE(OLD.status, '')) NOT IN ('done', 'completed', 'concluida', 'cancelado', 'cancelled')) THEN
    UPDATE public.assignment_proposals p
       SET status = 'rejeitada',
           decided_at = now(),
           decision_note = COALESCE(p.decision_note,
             CASE WHEN NEW.deleted_at IS NOT NULL THEN 'Fechada automaticamente: a tarefa foi excluída.'
                  ELSE 'Fechada automaticamente: a tarefa foi concluída.' END)
     WHERE p.kanban_task_id = NEW.id AND p.status = 'pendente';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_encerra_propostas_trg ON public.tasks;
CREATE TRIGGER tasks_encerra_propostas_trg
  AFTER UPDATE OF deleted_at, status ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.tasks_encerra_propostas();

-- Bulk de decisao: aprovar ou rejeitar varias propostas de uma vez, pela
-- mesma trilha da decisao unitaria (assignment_proposal_decidir), para
-- nenhuma escrita em assigned_to escapar da auditoria.
CREATE OR REPLACE FUNCTION public.assignment_proposal_decidir_lote(_proposal_ids uuid[], _decisao text, _nota text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _id uuid;
  _ok integer := 0;
  _erros jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'somente_equipe';
  END IF;
  FOREACH _id IN ARRAY COALESCE(_proposal_ids, ARRAY[]::uuid[]) LOOP
    BEGIN
      PERFORM public.assignment_proposal_decidir(_id, _decisao, _nota);
      _ok := _ok + 1;
    EXCEPTION WHEN OTHERS THEN
      _erros := _erros || jsonb_build_object('id', _id, 'erro', SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('decididas', _ok, 'erros', _erros);
END;
$$;

REVOKE ALL ON FUNCTION public.assignment_proposal_decidir_lote(uuid[], text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assignment_proposal_decidir_lote(uuid[], text, text) TO authenticated, service_role;
