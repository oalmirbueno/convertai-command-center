-- 26/09: o Hermes repetia central_review_decidir_por_agente ~100 vezes por
-- segundo desde 18/09 numa aprovação que já não podia ser decidida. A decisão
-- falhava com SQLSTATE 40001 (CENTRAL_REPORT_VERSION_CONFLICT /
-- CENTRAL_ALREADY_DECIDED), que clientes tratam como "tente de novo já":
-- 708 milhões de chamadas, 8 milhões de linhas de log por dia (142 GB no ciclo)
-- e o banco NANO saturado até o painel cair.
-- Agora, só no caminho do agente, o 40001 volta como resposta normal
-- {ok:false, status:'versao_mudou'|'ja_decidido'}, sem erro. A repetição
-- idempotente de uma decisão que deu certo continua devolvendo o resultado
-- guardado (quem responde é central_review_decide, que não mudou). O fluxo do
-- painel não passa por aqui.
CREATE OR REPLACE FUNCTION public.central_review_decidir_por_agente(_operator_slug text, _approval_id uuid, _decision text, _comment text, _evidence text, _idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _a public.operator_approvals%ROWTYPE;
  _agora public.operator_approvals%ROWTYPE;
  _nota text;
BEGIN
  PERFORM app_private.agente_assume_admin(_operator_slug);
  IF length(btrim(COALESCE(_evidence, ''))) < 3 THEN
    RAISE EXCEPTION 'CENTRAL_EVIDENCE_REQUIRED: cite a mensagem do dono que autorizou a decisao';
  END IF;
  SELECT * INTO _a FROM public.operator_approvals WHERE id = _approval_id AND origin = 'central';
  IF NOT FOUND THEN RAISE EXCEPTION 'CENTRAL_APPROVAL_NOT_FOUND'; END IF;
  _nota := '[via Hermes ' || lower(btrim(_operator_slug)) || ']'
        || CASE WHEN length(btrim(COALESCE(_comment, ''))) > 0 THEN ' ' || btrim(_comment) ELSE '' END
        || ' | evidência: ' || btrim(_evidence);
  BEGIN
    RETURN public.central_review_decide(_a.id, _a.client_id, _a.payload_version, _a.payload_hash, _decision, _nota, _idempotency_key);
  EXCEPTION WHEN SQLSTATE '40001' THEN
    SELECT * INTO _agora FROM public.operator_approvals WHERE id = _approval_id;
    IF _agora.invalidated_at IS NOT NULL OR _agora.executed_at IS NOT NULL OR _agora.status NOT IN ('pendente', 'adiado') THEN
      RETURN jsonb_build_object(
        'ok', false, 'status', 'ja_decidido', 'approval_id', _a.id, 'estado', _agora.status,
        'motivo', 'Este pedido não está mais aguardando decisão. Leia a fila de novo; não repita esta decisão.');
    END IF;
    RETURN jsonb_build_object(
      'ok', false, 'status', 'versao_mudou', 'approval_id', _a.id,
      'motivo', 'O relatório mudou depois deste pedido. Leia a fila de novo e prepare um pedido novo; não repita esta decisão.');
  END;
END;
$function$;
