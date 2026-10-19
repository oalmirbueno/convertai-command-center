-- 19/10/2026 (dono: "o aprovar está demorando demais e não aprova"; regra de 16/10:
-- "a decisão humana é final"). O dossiê de contexto de cada cliente ganha versão nova
-- várias vezes por dia (12:42, 13:50, 14:46, 15:05...). Todo pedido da Central escrito de
-- manhã ficava "fonte desatualizada" à tarde e nunca mais podia ser aprovado, rejeitado
-- ou devolvido. Agora a decisão do dono vale mesmo com a fonte mudada: ele lê o texto que
-- vai ao cliente. Fica registrado (fonte_antiga no resultado e no evento). Preparar um
-- pedido novo continua exigindo a fonte atual (central_review_prepare não muda).
CREATE OR REPLACE FUNCTION public.central_review_decide(_approval_id uuid, _expected_client_id uuid, _expected_version integer, _expected_payload_hash text, _decision text, _comment text, _idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE a public.operator_approvals%rowtype; r public.reports%rowtype; rid uuid; h text; e public.central_review_events%rowtype; result jsonb; fonte_antiga boolean := false;
BEGIN
 PERFORM app_private.central_review_admin();
 IF length(COALESCE(_idempotency_key,'')) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'CENTRAL_INVALID_KEY'; END IF;
 IF _decision IS NULL OR _decision NOT IN ('aprovado','rejeitado','alteracoes_pedidas','comentario') THEN RAISE EXCEPTION 'CENTRAL_INVALID_DECISION'; END IF;
 IF _decision IN ('comentario','rejeitado','alteracoes_pedidas') AND length(btrim(COALESCE(_comment,'')))=0 THEN RAISE EXCEPTION 'CENTRAL_COMMENT_REQUIRED'; END IF;
 IF length(COALESCE(_comment,''))>4000 THEN RAISE EXCEPTION 'CENTRAL_COMMENT_TOO_LONG'; END IF;
 h:=encode(extensions.digest(jsonb_build_array(_approval_id,_expected_client_id,_expected_version,_expected_payload_hash,_decision,_comment)::text,'sha256'),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('central-decision:'||auth.uid()::text||':'||_idempotency_key,0));
 SELECT * INTO e FROM public.central_review_events WHERE actor_id=auth.uid() AND idempotency_key=_idempotency_key;
 IF FOUND THEN
  IF e.input_hash<>h THEN RAISE EXCEPTION 'CENTRAL_IDEMPOTENCY_CONFLICT' USING ERRCODE='23505'; END IF;
  RETURN e.result;
 END IF;
 SELECT report_id INTO rid FROM public.operator_approvals WHERE id=_approval_id AND origin='central';
 IF rid IS NULL THEN RAISE EXCEPTION 'CENTRAL_APPROVAL_NOT_FOUND'; END IF;
 SELECT * INTO r FROM public.reports WHERE id=rid FOR UPDATE;
 SELECT * INTO a FROM public.operator_approvals WHERE id=_approval_id AND origin='central' FOR UPDATE;
 IF a.client_id IS DISTINCT FROM _expected_client_id OR r.client_id IS DISTINCT FROM a.client_id THEN RAISE EXCEPTION 'CENTRAL_CLIENT_MISMATCH' USING ERRCODE='42501'; END IF;
 IF _expected_version IS NULL OR a.payload_version<>_expected_version OR
  a.payload_hash IS DISTINCT FROM _expected_payload_hash OR
  a.payload_hash<>encode(extensions.digest(a.payload::text,'sha256'),'hex') THEN RAISE EXCEPTION 'CENTRAL_REPORT_VERSION_CONFLICT' USING ERRCODE = 'P0001'; END IF;
 -- A comment belongs to the exact immutable historical snapshot and does not
 -- reopen its decision. Only actions require the current report.
 IF _decision<>'comentario' THEN
  IF r.review_version<>_expected_version THEN RAISE EXCEPTION 'CENTRAL_REPORT_VERSION_CONFLICT' USING ERRCODE = 'P0001'; END IF;
  IF a.invalidated_at IS NOT NULL OR a.status NOT IN ('pendente','adiado') OR a.executed_at IS NOT NULL THEN RAISE EXCEPTION 'CENTRAL_ALREADY_DECIDED' USING ERRCODE = 'P0001'; END IF;
  IF a.valid_until IS NULL OR a.valid_until<=now() THEN RAISE EXCEPTION 'CENTRAL_APPROVAL_EXPIRED'; END IF;
  -- A decisão do dono é final: fonte mudada depois do texto não impede decidir; fica registrada.
  fonte_antiga := a.payload->'source' IS DISTINCT FROM public.central_review_source(a.client_id);
  IF r.status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'CENTRAL_REPORT_NOT_DRAFT'; END IF;
  IF _decision='aprovado' AND length(btrim(COALESCE(r.summary,'')))=0 THEN RAISE EXCEPTION 'CENTRAL_SUMMARY_REQUIRED'; END IF;
  IF _decision='aprovado' AND length(btrim(COALESCE(r.next_steps,'')))=0 THEN RAISE EXCEPTION 'CENTRAL_NEXT_STEPS_REQUIRED'; END IF;
  UPDATE public.operator_approvals SET status=_decision,decided_by=auth.uid(),decided_at=now(),decision_note=NULLIF(btrim(_comment),'')
   WHERE id=a.id RETURNING * INTO a;
  UPDATE public.central_review_dispatches SET status=CASE WHEN _decision='aprovado' THEN 'aprovado' ELSE 'invalidado' END,updated_at=now() WHERE approval_id=a.id;
 END IF;
 result:=app_private.central_review_result(a)||jsonb_build_object('decision',_decision,'fonte_antiga',fonte_antiga);
 INSERT INTO public.central_review_events(approval_id,actor_id,event,comment,idempotency_key,input_hash,result)
 VALUES(a.id,auth.uid(),_decision,NULLIF(btrim(_comment),''),_idempotency_key,h,result);
 RETURN result;
END $function$;
