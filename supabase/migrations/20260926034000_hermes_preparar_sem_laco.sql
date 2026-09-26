-- 26/09: mesma proteção de hermes_decidir_sem_laco no preparar do agente.
-- Conflito de versão (40001) volta como resposta normal e desfaz tudo o que a
-- chamada tinha mudado (bloco com subtransação), para o agente não repetir.
CREATE OR REPLACE FUNCTION public.central_review_preparar_por_agente(_operator_slug text, _report_id uuid, _destination jsonb, _idempotency_key text, _summary text DEFAULT NULL::text, _next_steps text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _r public.reports%ROWTYPE;
  _src jsonb;
  _metrics jsonb;
BEGIN
  PERFORM app_private.agente_assume_admin(_operator_slug);
  BEGIN
    SELECT * INTO _r FROM public.reports WHERE id = _report_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CENTRAL_REPORT_NOT_FOUND'; END IF;
    IF _r.status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'CENTRAL_REPORT_NOT_DRAFT'; END IF;
    IF _destination->>'channel' = 'portal' THEN
      _destination := jsonb_build_object('channel', 'portal', 'recipient', _r.client_id::text);
    END IF;
    _src := public.central_review_source(_r.client_id);
    _metrics := COALESCE(_r.metrics, '{}'::jsonb);
    IF _metrics->'central_review_source' IS DISTINCT FROM _src THEN
      _metrics := _metrics || jsonb_build_object('central_review_source', _src, 'central_review_source_stamped_by', lower(btrim(_operator_slug)), 'central_review_source_stamped_at', now());
    END IF;
    UPDATE public.reports
       SET summary = COALESCE(NULLIF(btrim(_summary), ''), summary),
           next_steps = COALESCE(NULLIF(btrim(_next_steps), ''), next_steps),
           metrics = _metrics
     WHERE id = _r.id RETURNING * INTO _r;
    RETURN public.central_review_prepare(_r.id, _r.review_version, _destination, _idempotency_key);
  EXCEPTION WHEN SQLSTATE '40001' THEN
    RETURN jsonb_build_object(
      'ok', false, 'status', 'versao_mudou', 'report_id', _report_id,
      'motivo', 'O relatório mudou durante o preparo. Leia a fila de novo antes de preparar; não repita esta chamada.');
  END;
END;
$function$;
