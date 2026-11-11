-- 11/11/2026: arquivo do Workspace/Estúdio que já foi ao cliente
-- (visibility = approval, approval_status = pending) pode voltar a rascunho
-- interno. Não apaga o arquivo nem o blob. Cancela o pedido pendente, tira
-- da vista do cliente e grava file_approval_events.approval_withdrawn.
--
-- Estado interno editável, o mesmo de file_is_editable: visibility internal,
-- agency_approval_status not_requested, approval_status none, sem trava.
-- Filhas do carrossel acompanham a raiz. Quem já decidiu (approved/rejected)
-- ou está travado não entra por aqui.

ALTER TABLE public.file_approval_events
  DROP CONSTRAINT IF EXISTS file_approval_events_type_check;
ALTER TABLE public.file_approval_events
  ADD CONSTRAINT file_approval_events_type_check CHECK (
    event_type = ANY (ARRAY[
      'agency_review_requested'::text,
      'agency_approved'::text,
      'agency_rejected'::text,
      'released_client_shared'::text,
      'released_for_approval'::text,
      'client_approved'::text,
      'client_rejected'::text,
      'client_approved_offline'::text,
      'contract_signed'::text,
      'approval_withdrawn'::text
    ])
  );

CREATE OR REPLACE FUNCTION public.withdraw_file_client_approval(p_file_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  _actor uuid := auth.uid();
  _file public.files%ROWTYPE;
BEGIN
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'somente admin ou gestor retira da aprovacao do cliente';
  END IF;

  SELECT * INTO _file
  FROM public.files
  WHERE id = p_file_id
    AND parent_file_id IS NULL
  FOR UPDATE;

  IF NOT FOUND OR NOT public.can_manage_client(_file.client_id) THEN
    RAISE EXCEPTION 'arquivo nao encontrado ou sem acesso';
  END IF;
  IF _file.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'arquivo arquivado nao volta por esta acao';
  END IF;
  IF _file.locked_at IS NOT NULL
    OR _file.visibility IS DISTINCT FROM 'approval'
    OR _file.approval_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'so da para retirar o que ainda espera o cliente';
  END IF;

  UPDATE public.files
  SET
    visibility = 'internal',
    requires_approval = false,
    approval_status = 'none',
    feedback = NULL,
    client_decided_by = NULL,
    client_decided_at = NULL,
    approval_requested_at = NULL,
    locked_at = NULL,
    agency_approval_status = 'not_requested',
    agency_feedback = NULL,
    agency_reviewed_by = NULL,
    agency_reviewed_at = NULL
  WHERE id = _file.id
     OR parent_file_id = _file.id;

  INSERT INTO public.file_approval_events (
    file_id,
    client_id,
    actor_id,
    event_type,
    from_status,
    to_status,
    metadata
  ) VALUES (
    _file.id,
    _file.client_id,
    _actor,
    'approval_withdrawn',
    'pending',
    'none',
    jsonb_build_object(
      'visibility_from', 'approval',
      'visibility_to', 'internal',
      'agency_approval_status_from', _file.agency_approval_status,
      'version', COALESCE(_file.version, 1)
    )
  );

  RETURN jsonb_build_object(
    'file_id', _file.id,
    'client_id', _file.client_id,
    'visibility', 'internal',
    'approval_status', 'none',
    'agency_approval_status', 'not_requested'
  );
END
$function$;

REVOKE ALL ON FUNCTION public.withdraw_file_client_approval(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_file_client_approval(uuid) TO authenticated;

-- A Mesa deixa de esperar o cliente, e o Workspace solta o vínculo.
-- Idempotente: se o evento já está no gatilho, não refaz.
DO $mesa$
DECLARE
  _def text;
  _novo text;
BEGIN
  _def := replace(pg_get_functiondef('public.mesa_entrega_acompanha_aprovacao()'::regprocedure), E'\r\n', E'\n');
  IF position('approval_withdrawn' IN _def) > 0 THEN
    RETURN;
  END IF;
  _novo := replace(
    _def,
    $a$'client_approved', 'client_approved_offline', 'client_rejected'$a$,
    $b$'client_approved', 'client_approved_offline', 'client_rejected', 'approval_withdrawn'$b$
  );
  IF _novo = _def THEN
    RAISE EXCEPTION 'mesa: lista de eventos nao encontrada';
  END IF;
  _def := _novo;
  _novo := replace(
    _def,
    $a$    ELSE
      -- Aprovado (no painel ou registrado pela equipe como aprovação fora dele).$a$,
    $b$    ELSIF NEW.event_type = 'approval_withdrawn' THEN
      UPDATE public.estudio_trabalhos
         SET entrega_status = NULL, entrega_aviso = NULL
       WHERE id = _t.id
         AND entrega_status = 'aguardando_cliente';
      UPDATE public.workspace_nodes
         SET sent_for_approval_file_id = NULL
       WHERE sent_for_approval_file_id = NEW.file_id;
    ELSE
      -- Aprovado (no painel ou registrado pela equipe como aprovação fora dele).$b$
  );
  IF _novo = _def THEN
    RAISE EXCEPTION 'mesa: ramo de aprovado nao encontrado';
  END IF;
  _def := _novo;
  _novo := replace(
    _def,
    $a$    IF _t.id IS NULL THEN
      RETURN NEW;
    END IF;$a$,
    $b$    IF _t.id IS NULL THEN
      -- Arquivo enviado só pelo Workspace: não há trabalho do Estúdio,
      -- mas o vínculo da aprovação tem que sair mesmo assim.
      IF NEW.event_type = 'approval_withdrawn' THEN
        UPDATE public.workspace_nodes
           SET sent_for_approval_file_id = NULL
         WHERE sent_for_approval_file_id = NEW.file_id;
      END IF;
      RETURN NEW;
    END IF;$b$
  );
  IF _novo = _def THEN
    RAISE EXCEPTION 'mesa: retorno sem trabalho nao encontrado';
  END IF;
  EXECUTE _novo;
END
$mesa$;
