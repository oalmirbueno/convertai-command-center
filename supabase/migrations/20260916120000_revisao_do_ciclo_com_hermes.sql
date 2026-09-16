-- A Revisao do Ciclo vira area de trabalho do Hermes.
--
-- Regra do dono (2026-09-16): esta area E a aprovacao. Nada de fila infinita
-- de "autorizacoes": o rascunho e preparado, alguem decide (no painel ou no
-- WhatsApp com o Hermes), e quem envia registra que enviou. Vice-versa: o
-- Hermes le a fila, prepara, decide em nome do dono quando o dono mandou no
-- WhatsApp, e marca o envio com a evidencia.
--
-- Como funciona por dentro: os RPCs da revisao exigem um administrador
-- autenticado (app_private.central_review_admin). O Hermes chega pelo MCP
-- com papel de servico, sem usuario. Os wrappers *_por_agente validam o
-- operador, assumem a identidade do administrador que o Hermes representa
-- (agent_settings.central_review_admin, transacao local) e chamam os RPCs
-- oficiais. A trilha fica inteira: decisao com "[via Hermes <slug>]" e a
-- evidencia do WhatsApp na nota; envio com evidencia e chave propria.

CREATE TABLE IF NOT EXISTS public.agent_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.agent_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_settings FROM PUBLIC, anon, authenticated;

-- O administrador que o Hermes representa: o dono da casa.
INSERT INTO public.agent_settings (key, value)
SELECT 'central_review_admin', ur.user_id::text
  FROM public.user_roles ur
  JOIN public.profiles p ON p.id = ur.user_id
 WHERE ur.role = 'admin' AND p.email ILIKE 'almirbarrosbueno%'
 ORDER BY p.created_at
 LIMIT 1
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION app_private.agente_assume_admin(_operator_slug text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _op public.internal_operators%ROWTYPE;
  _admin uuid;
BEGIN
  SELECT * INTO _op FROM public.internal_operators WHERE slug = lower(btrim(_operator_slug));
  IF NOT FOUND THEN RAISE EXCEPTION 'operator_not_found: % nao existe na hierarquia', _operator_slug; END IF;
  IF _op.status <> 'active' THEN RAISE EXCEPTION 'operator_paused: % esta pausado', _op.slug; END IF;
  SELECT value::uuid INTO _admin FROM public.agent_settings WHERE key = 'central_review_admin';
  IF _admin IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _admin AND role = 'admin') THEN
    RAISE EXCEPTION 'central_review_admin_nao_configurado: defina agent_settings.central_review_admin com um administrador';
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', _admin::text, true);
  PERFORM set_config('app.agent_actor', _op.slug, true);
  RETURN _admin;
END;
$$;
REVOKE ALL ON FUNCTION app_private.agente_assume_admin(text) FROM PUBLIC, anon, authenticated;

-- 1) A fila, do jeito que o Hermes precisa: texto inteiro, destino, estado.
CREATE OR REPLACE FUNCTION public.central_review_fila_para_agente(_operator_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _esperando jsonb;
  _aprovados jsonb;
  _rascunhos jsonb;
  _enviados jsonb;
BEGIN
  PERFORM app_private.agente_assume_admin(_operator_slug);

  SELECT COALESCE(jsonb_agg(x ORDER BY x.created_at DESC), '[]'::jsonb) INTO _esperando FROM (
    SELECT a.id AS approval_id, a.client_id, COALESCE(NULLIF(p.company_name, ''), p.full_name) AS cliente,
           a.report_id, a.payload->'report'->>'title' AS titulo,
           a.payload->'report'->'metrics'->>'ritual_type' AS ritual,
           a.payload->'report'->>'summary' AS mensagem, a.payload->'report'->>'next_steps' AS proximo_passo,
           a.payload->'destination' AS destino, a.status, a.payload_version, a.payload_hash,
           a.valid_until, a.created_at, a.decision_note
      FROM public.operator_approvals a LEFT JOIN public.profiles p ON p.id = a.client_id
     WHERE a.origin = 'central' AND a.status IN ('pendente', 'adiado') AND a.executed_at IS NULL
       AND a.invalidated_at IS NULL AND (a.valid_until IS NULL OR a.valid_until > now())
  ) x;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.decided_at DESC), '[]'::jsonb) INTO _aprovados FROM (
    SELECT a.id AS approval_id, a.client_id, COALESCE(NULLIF(p.company_name, ''), p.full_name) AS cliente,
           a.report_id, a.payload->'report'->>'title' AS titulo,
           a.payload->'report'->'metrics'->>'ritual_type' AS ritual,
           a.payload->'report'->>'summary' AS mensagem, a.payload->'report'->>'next_steps' AS proximo_passo,
           a.payload->'destination' AS destino, a.decided_at, a.decision_note, a.valid_until
      FROM public.operator_approvals a LEFT JOIN public.profiles p ON p.id = a.client_id
     WHERE a.origin = 'central' AND a.status = 'aprovado' AND a.executed_at IS NULL AND a.invalidated_at IS NULL
  ) x;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.created_at DESC), '[]'::jsonb) INTO _rascunhos FROM (
    SELECT r.id AS report_id, r.client_id, COALESCE(NULLIF(p.company_name, ''), p.full_name) AS cliente,
           r.title AS titulo, r.metrics->>'ritual_type' AS ritual, r.summary AS mensagem, r.next_steps AS proximo_passo,
           r.review_version, r.created_at
      FROM public.reports r LEFT JOIN public.profiles p ON p.id = r.client_id
     WHERE r.status = 'draft' AND r.created_at > now() - interval '30 days'
       AND NOT EXISTS (
         SELECT 1 FROM public.operator_approvals a
          WHERE a.origin = 'central' AND a.report_id = r.id AND a.invalidated_at IS NULL
            AND a.executed_at IS NULL AND a.status IN ('pendente', 'adiado', 'aprovado'))
     ORDER BY r.created_at DESC LIMIT 50
  ) x;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.executed_at DESC), '[]'::jsonb) INTO _enviados FROM (
    SELECT a.id AS approval_id, COALESCE(NULLIF(p.company_name, ''), p.full_name) AS cliente,
           a.payload->'report'->>'title' AS titulo, a.executed_at, a.execution_evidence
      FROM public.operator_approvals a LEFT JOIN public.profiles p ON p.id = a.client_id
     WHERE a.origin = 'central' AND a.executed_at IS NOT NULL
     ORDER BY a.executed_at DESC LIMIT 20
  ) x;

  RETURN jsonb_build_object(
    'esperando_decisao', _esperando,
    'aprovados_para_enviar', _aprovados,
    'rascunhos_sem_pedido', _rascunhos,
    'enviados_recentes', _enviados,
    'como_agir', jsonb_build_array(
      'rascunhos_sem_pedido: revise o texto (aceleriq_create_report_draft cria ou ajusta) e prepare com aceleriq_central_review_preparar informando o destino.',
      'esperando_decisao: leve ao dono no WhatsApp; quando ele responder, registre com aceleriq_central_review_decidir (aprovado, rejeitado, alteracoes_pedidas) citando a mensagem dele como evidencia.',
      'aprovados_para_enviar: envie ao destino congelado e registre com aceleriq_central_review_marcar_enviado, com a evidencia do envio. Sem esse registro o painel considera nao enviado.'
    )
  );
END;
$$;

-- 2) Preparar um pedido a partir de um rascunho. O Hermes pode ajustar o
-- texto na mesma chamada; a fonte (dossie/plano atual) e carimbada no
-- rascunho antes de preparar, como a tela faz, para o pedido nascer valido.
CREATE OR REPLACE FUNCTION public.central_review_preparar_por_agente(_operator_slug text, _report_id uuid, _destination jsonb, _idempotency_key text, _summary text DEFAULT NULL, _next_steps text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _r public.reports%ROWTYPE;
  _src jsonb;
  _metrics jsonb;
BEGIN
  PERFORM app_private.agente_assume_admin(_operator_slug);
  SELECT * INTO _r FROM public.reports WHERE id = _report_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CENTRAL_REPORT_NOT_FOUND'; END IF;
  IF _r.status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'CENTRAL_REPORT_NOT_DRAFT'; END IF;
  -- No portal o destinatario e sempre o proprio cliente; o agente nao precisa saber o id.
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
END;
$$;

-- 3) Decidir em nome do dono, com a evidencia de onde a decisao veio.
CREATE OR REPLACE FUNCTION public.central_review_decidir_por_agente(_operator_slug text, _approval_id uuid, _decision text, _comment text, _evidence text, _idempotency_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _a public.operator_approvals%ROWTYPE;
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
  RETURN public.central_review_decide(_a.id, _a.client_id, _a.payload_version, _a.payload_hash, _decision, _nota, _idempotency_key);
END;
$$;

-- 4) Marcar como enviado: quem enviou (painel ou Hermes) registra a prova.
CREATE OR REPLACE FUNCTION public.central_review_marcar_enviado(_approval_id uuid, _evidence text, _idempotency_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _a public.operator_approvals%ROWTYPE;
  _cliente text;
  _titulo text;
  _via text;
  _result jsonb;
BEGIN
  PERFORM app_private.central_review_admin();
  IF length(COALESCE(_idempotency_key, '')) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'CENTRAL_INVALID_KEY'; END IF;
  IF length(btrim(COALESCE(_evidence, ''))) < 3 THEN RAISE EXCEPTION 'CENTRAL_EVIDENCE_REQUIRED'; END IF;
  SELECT * INTO _a FROM public.operator_approvals WHERE id = _approval_id AND origin = 'central' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CENTRAL_APPROVAL_NOT_FOUND'; END IF;
  IF _a.executed_at IS NOT NULL THEN
    IF _a.execution_run_key = _idempotency_key THEN
      RETURN jsonb_build_object('approval_id', _a.id, 'status', 'enviado', 'executed_at', _a.executed_at, 'evidence', _a.execution_evidence, 'repetido', true);
    END IF;
    RAISE EXCEPTION 'CENTRAL_ALREADY_SENT';
  END IF;
  IF _a.status <> 'aprovado' THEN RAISE EXCEPTION 'CENTRAL_NOT_APPROVED: so pedido aprovado pode ser marcado como enviado'; END IF;
  IF _a.invalidated_at IS NOT NULL THEN RAISE EXCEPTION 'CENTRAL_INVALIDATED'; END IF;

  _via := current_setting('app.agent_actor', true);
  UPDATE public.operator_approvals
     SET executed_at = now(), execution_evidence = btrim(_evidence), execution_run_key = _idempotency_key
   WHERE id = _a.id RETURNING * INTO _a;
  UPDATE public.central_review_dispatches SET status = 'enviado', updated_at = now() WHERE approval_id = _a.id;
  IF NOT FOUND THEN
    INSERT INTO public.central_review_dispatches (approval_id, status, updated_at) VALUES (_a.id, 'enviado', now());
  END IF;

  _result := jsonb_build_object('approval_id', _a.id, 'status', 'enviado', 'executed_at', _a.executed_at, 'evidence', _a.execution_evidence, 'via', COALESCE(_via, 'painel'));
  INSERT INTO public.central_review_events (approval_id, actor_id, event, comment, idempotency_key, input_hash, result)
  VALUES (_a.id, auth.uid(), 'enviado', btrim(_evidence), _idempotency_key,
          encode(extensions.digest(jsonb_build_array(_a.id, 'enviado', btrim(_evidence))::text, 'sha256'), 'hex'), _result);

  SELECT COALESCE(NULLIF(p.company_name, ''), p.full_name, 'Cliente') INTO _cliente FROM public.profiles p WHERE p.id = _a.client_id;
  _titulo := COALESCE(NULLIF(_a.payload->'report'->>'title', ''), _a.o_que, 'mensagem');
  INSERT INTO public.notifications (user_id, message, notification_type, link)
  SELECT ur.user_id,
         'Enviado ao cliente: ' || COALESCE(_cliente, 'Cliente') || ' · "' || left(_titulo, 80) || '"' || CASE WHEN _via IS NOT NULL THEN ' (pelo Hermes)' ELSE '' END || '.',
         'central_review_enviada',
         '/ciclo/revisao?client=' || COALESCE(_a.client_id::text, '') || '&review=' || _a.id::text
    FROM public.user_roles ur WHERE ur.role = 'admin';
  RETURN _result;
END;
$$;

CREATE OR REPLACE FUNCTION public.central_review_marcar_enviado_por_agente(_operator_slug text, _approval_id uuid, _evidence text, _idempotency_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  PERFORM app_private.agente_assume_admin(_operator_slug);
  RETURN public.central_review_marcar_enviado(_approval_id, _evidence, _idempotency_key);
END;
$$;

REVOKE ALL ON FUNCTION public.central_review_fila_para_agente(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.central_review_preparar_por_agente(text, uuid, jsonb, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.central_review_decidir_por_agente(text, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.central_review_marcar_enviado_por_agente(text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.central_review_fila_para_agente(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.central_review_preparar_por_agente(text, uuid, jsonb, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.central_review_decidir_por_agente(text, uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.central_review_marcar_enviado_por_agente(text, uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.central_review_marcar_enviado(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.central_review_marcar_enviado(uuid, text, text) TO authenticated, service_role;

-- O aviso antigo de "ordem executada" nao serve para pedido central (nao ha
-- operador nem vinculo): o envio central tem o proprio aviso acima.
CREATE OR REPLACE FUNCTION public.operator_avisar_ordem_executada()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _nome text;
BEGIN
  IF new.origin = 'central' THEN
    RETURN new;
  END IF;
  IF new.executed_at IS NULL OR old.executed_at IS NOT NULL THEN
    RETURN new;
  END IF;
  SELECT display_name INTO _nome FROM public.internal_operators WHERE id = new.operator_id;
  INSERT INTO public.notifications (user_id, message, notification_type, link)
  SELECT ur.user_id,
         COALESCE(_nome, 'Um agente') || ' executou: ' || new.o_que,
         'operator_executou',
         '/execucao?vinculo=' || COALESCE(new.task_link_id::text, '')
    FROM public.user_roles ur WHERE ur.role = 'admin';
  RETURN new;
END;
$$;
