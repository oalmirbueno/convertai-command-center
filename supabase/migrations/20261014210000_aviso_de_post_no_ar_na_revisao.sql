-- Aviso de post no ar entra na Revisão do Ciclo (14/10/2026).
--
-- Quando um post vai ao ar, a equipe (ou o Hermes / n8n ACQ-03) prepara uma mensagem curta para o cliente
-- ("seu post está no ar: link"). Antes, esse aviso não tinha onde ser aprovado. Agora segue o mesmo rito da
-- Revisão do Ciclo: preparar (texto e destino congelados) → o dono decide → quem envia registra o envio com
-- evidência. Aprovar NÃO envia; nada aqui manda mensagem.
--
-- Tabela própria, e não operator_approvals: mais de dez leitores (contadores, Aprovações explicadas, Gestor,
-- navegador operacional) leem operator_approvals sem filtrar a origem. Uma linha nova lá apareceria nesses
-- lugares. Aqui nenhuma função ou tabela existente é alterada.
--
-- Regras:
-- - só post com status published e published_at;
-- - um aviso vivo (pendente ou aprovado, inclusive já enviado) por publicação; rejeitado ou vencido libera outro;
-- - o aviso preparado é imutável (texto, destino, hash); decidir confere o hash;
-- - vale 3 dias; vencido não pode ser aprovado;
-- - mesmas portas da revisão: administrador logado no painel; o Hermes pelas versões *_por_agente, que assumem
--   o administrador configurado (app_private.agente_assume_admin) e deixam "[via Hermes <slug>]" na trilha.

BEGIN;

CREATE TABLE public.aviso_publicacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id uuid NOT NULL REFERENCES public.editorial_publications(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  mensagem text NOT NULL CHECK (length(btrim(mensagem)) BETWEEN 1 AND 2000),
  destino jsonb NOT NULL,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  request_key text NOT NULL UNIQUE CHECK (length(request_key) BETWEEN 8 AND 128),
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovado', 'rejeitado', 'expirado')),
  preparado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  preparado_via text NOT NULL DEFAULT 'painel',
  valid_until timestamptz NOT NULL,
  decided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_note text,
  decision_key text,
  executed_at timestamptz,
  execution_evidence text,
  execution_run_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aviso_publicacao_envio_so_aprovado CHECK (executed_at IS NULL OR status = 'aprovado')
);
CREATE UNIQUE INDEX aviso_publicacao_um_vivo_por_post ON public.aviso_publicacao (publication_id) WHERE status IN ('pendente', 'aprovado');
CREATE INDEX aviso_publicacao_cliente ON public.aviso_publicacao (client_id, created_at DESC);

ALTER TABLE public.aviso_publicacao ENABLE ROW LEVEL SECURITY;
CREATE POLICY aviso_publicacao_admin_le ON public.aviso_publicacao FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
REVOKE ALL ON public.aviso_publicacao FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.aviso_publicacao TO authenticated;

-- O aviso preparado não muda: só a decisão e o envio andam.
CREATE FUNCTION app_private.aviso_publicacao_imutavel() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status', 'decided_by', 'decided_at', 'decision_note', 'decision_key', 'executed_at', 'execution_evidence', 'execution_run_key'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'decided_by', 'decided_at', 'decision_note', 'decision_key', 'executed_at', 'execution_evidence', 'execution_run_key']) THEN
    RAISE EXCEPTION 'AVISO_IMUTAVEL: o aviso preparado não muda; prepare outro';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.aviso_publicacao_imutavel() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER aviso_publicacao_imutavel BEFORE UPDATE ON public.aviso_publicacao
  FOR EACH ROW EXECUTE FUNCTION app_private.aviso_publicacao_imutavel();

-- Aviso no sino dos administradores (tipo próprio; não entra na lista que vira e-mail).
CREATE FUNCTION app_private.aviso_publicacao_avisar(_aviso_id uuid, _frase text, _tipo text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.notifications (user_id, message, notification_type, link)
  SELECT ur.user_id, left(_frase, 300), _tipo, '/ciclo/revisao?aviso=' || _aviso_id::text
    FROM public.user_roles ur WHERE ur.role = 'admin';
$$;
REVOKE ALL ON FUNCTION app_private.aviso_publicacao_avisar(uuid, text, text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION app_private.aviso_publicacao_rotulo(_a public.aviso_publicacao) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT COALESCE(NULLIF(p.company_name, ''), p.full_name) FROM public.profiles p WHERE p.id = _a.client_id), 'Cliente')
         || ' · "' || left(COALESCE(_a.payload->'publication'->>'title', 'publicação'), 80) || '"';
$$;
REVOKE ALL ON FUNCTION app_private.aviso_publicacao_rotulo(public.aviso_publicacao) FROM PUBLIC, anon, authenticated;

-- 1) Preparar: congela post, texto e destino.
CREATE FUNCTION public.aviso_publicacao_preparar(_publication_id uuid, _mensagem text, _destination jsonb, _idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _e public.editorial_publications%ROWTYPE;
  _a public.aviso_publicacao%ROWTYPE;
  _titulo text;
  _snap jsonb;
  _msg text;
  _via text;
BEGIN
  PERFORM app_private.central_review_admin();
  IF length(COALESCE(_idempotency_key, '')) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'AVISO_CHAVE_INVALIDA'; END IF;
  _msg := btrim(COALESCE(_mensagem, ''));
  IF length(_msg) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'AVISO_MENSAGEM_INVALIDA: de 1 a 2000 caracteres'; END IF;
  SELECT * INTO _e FROM public.editorial_publications WHERE id = _publication_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'AVISO_PUBLICACAO_NAO_ENCONTRADA'; END IF;
  IF _e.status IS DISTINCT FROM 'published' OR _e.published_at IS NULL THEN
    RAISE EXCEPTION 'AVISO_POST_NAO_PUBLICADO: só se avisa post que já está no ar';
  END IF;
  -- No portal o destinatário é sempre o próprio cliente.
  IF jsonb_typeof(_destination) = 'object' AND _destination->>'channel' = 'portal' THEN
    _destination := jsonb_build_object('channel', 'portal', 'recipient', _e.client_id::text);
  END IF;
  IF jsonb_typeof(_destination) IS DISTINCT FROM 'object' OR
     (_destination->>'channel') IS NULL OR (_destination->>'channel') NOT IN ('portal', 'whatsapp') OR
     length(btrim(COALESCE(_destination->>'recipient', ''))) NOT BETWEEN 1 AND 250 OR
     (_destination - ARRAY['channel', 'recipient']) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'AVISO_DESTINO_INVALIDO: channel portal ou whatsapp e recipient';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('aviso-key:' || _idempotency_key, 0));
  SELECT * INTO _a FROM public.aviso_publicacao WHERE request_key = _idempotency_key;
  IF FOUND THEN
    IF _a.publication_id IS DISTINCT FROM _publication_id OR _a.mensagem IS DISTINCT FROM _msg OR _a.destino IS DISTINCT FROM _destination THEN
      RAISE EXCEPTION 'AVISO_CHAVE_REUSADA: a chave já preparou outro aviso' USING ERRCODE = '23505';
    END IF;
    RETURN to_jsonb(_a) || jsonb_build_object('repetido', true);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('aviso-post:' || _publication_id::text, 0));
  UPDATE public.aviso_publicacao SET status = 'expirado'
   WHERE publication_id = _publication_id AND status = 'pendente' AND valid_until <= now();
  SELECT * INTO _a FROM public.aviso_publicacao WHERE publication_id = _publication_id AND status IN ('pendente', 'aprovado') LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'AVISO_JA_EXISTE: este post já tem o aviso % (%)', _a.id,
      CASE WHEN _a.executed_at IS NOT NULL THEN 'enviado' ELSE _a.status END USING ERRCODE = '23505';
  END IF;

  SELECT NULLIF(po.title, '') INTO _titulo FROM public.editorial_posts po WHERE po.id = _e.post_id;
  _snap := jsonb_build_object(
    'publication', jsonb_build_object('id', _e.id, 'client_id', _e.client_id, 'post_id', _e.post_id,
      'title', COALESCE(_titulo, 'publicação'), 'platform', _e.platform, 'permalink', _e.permalink,
      'published_at', _e.published_at, 'version', _e.version),
    'mensagem', _msg,
    'destination', _destination);
  _via := NULLIF(current_setting('app.agent_actor', true), '');
  INSERT INTO public.aviso_publicacao (publication_id, client_id, mensagem, destino, payload, payload_hash, request_key, preparado_por, preparado_via, valid_until)
  VALUES (_e.id, _e.client_id, _msg, _destination, _snap, encode(extensions.digest(_snap::text, 'sha256'), 'hex'),
          _idempotency_key, auth.uid(), COALESCE('agente:' || _via, 'painel'), now() + interval '3 days')
  RETURNING * INTO _a;
  PERFORM app_private.aviso_publicacao_avisar(_a.id,
    'Aviso de post no ar: ' || app_private.aviso_publicacao_rotulo(_a) || ' está pronto para a sua decisão.', 'aviso_publicacao_pendente');
  RETURN to_jsonb(_a);
END $$;

-- 2) Decidir: aprovado ou rejeitado, conferindo o hash do que foi preparado.
CREATE FUNCTION public.aviso_publicacao_decidir(_aviso_id uuid, _expected_payload_hash text, _decision text, _comment text, _idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _a public.aviso_publicacao%ROWTYPE;
  _nota text;
BEGIN
  PERFORM app_private.central_review_admin();
  IF length(COALESCE(_idempotency_key, '')) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'AVISO_CHAVE_INVALIDA'; END IF;
  IF _decision IS NULL OR _decision NOT IN ('aprovado', 'rejeitado') THEN RAISE EXCEPTION 'AVISO_DECISAO_INVALIDA: aprovado ou rejeitado'; END IF;
  _nota := NULLIF(btrim(COALESCE(_comment, '')), '');
  IF _decision = 'rejeitado' AND _nota IS NULL THEN RAISE EXCEPTION 'AVISO_COMENTARIO_OBRIGATORIO: diga por que rejeitou'; END IF;
  IF length(COALESCE(_nota, '')) > 4000 THEN RAISE EXCEPTION 'AVISO_COMENTARIO_LONGO'; END IF;
  SELECT * INTO _a FROM public.aviso_publicacao WHERE id = _aviso_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AVISO_NAO_ENCONTRADO'; END IF;
  IF _a.decision_key = _idempotency_key THEN
    IF _a.status IS DISTINCT FROM _decision THEN RAISE EXCEPTION 'AVISO_CHAVE_REUSADA' USING ERRCODE = '23505'; END IF;
    RETURN to_jsonb(_a) || jsonb_build_object('repetido', true);
  END IF;
  IF _a.payload_hash IS DISTINCT FROM _expected_payload_hash OR
     _a.payload_hash <> encode(extensions.digest(_a.payload::text, 'sha256'), 'hex') THEN
    RAISE EXCEPTION 'AVISO_VERSAO_MUDOU: atualize a revisão' USING ERRCODE = '40001';
  END IF;
  IF _a.status <> 'pendente' THEN RAISE EXCEPTION 'AVISO_JA_DECIDIDO: está como %', _a.status USING ERRCODE = '40001'; END IF;
  IF _a.valid_until <= now() THEN RAISE EXCEPTION 'AVISO_VENCIDO: prepare outro aviso'; END IF;
  UPDATE public.aviso_publicacao
     SET status = _decision, decided_by = auth.uid(), decided_at = now(), decision_note = _nota, decision_key = _idempotency_key
   WHERE id = _a.id RETURNING * INTO _a;
  PERFORM app_private.aviso_publicacao_avisar(_a.id,
    'Aviso de post no ar: ' || app_private.aviso_publicacao_rotulo(_a) || CASE _decision
      WHEN 'aprovado' THEN ' foi aprovado. Nada foi enviado; o envio continua sendo seu.'
      ELSE ' foi rejeitado.' END, 'aviso_publicacao_decidido');
  RETURN to_jsonb(_a);
END $$;

-- 3) Marcar enviado: quem enviou registra a prova.
CREATE FUNCTION public.aviso_publicacao_marcar_enviado(_aviso_id uuid, _evidence text, _idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _a public.aviso_publicacao%ROWTYPE;
  _via text;
BEGIN
  PERFORM app_private.central_review_admin();
  IF length(COALESCE(_idempotency_key, '')) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'AVISO_CHAVE_INVALIDA'; END IF;
  IF length(btrim(COALESCE(_evidence, ''))) < 3 THEN RAISE EXCEPTION 'AVISO_EVIDENCIA_OBRIGATORIA: diga onde e quando enviou'; END IF;
  SELECT * INTO _a FROM public.aviso_publicacao WHERE id = _aviso_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AVISO_NAO_ENCONTRADO'; END IF;
  IF _a.executed_at IS NOT NULL THEN
    IF _a.execution_run_key = _idempotency_key THEN RETURN to_jsonb(_a) || jsonb_build_object('repetido', true); END IF;
    RAISE EXCEPTION 'AVISO_JA_ENVIADO: registrado em %', _a.executed_at;
  END IF;
  IF _a.status <> 'aprovado' THEN RAISE EXCEPTION 'AVISO_NAO_APROVADO: só aviso aprovado pode ser marcado como enviado'; END IF;
  _via := NULLIF(current_setting('app.agent_actor', true), '');
  UPDATE public.aviso_publicacao
     SET executed_at = now(), execution_evidence = btrim(_evidence), execution_run_key = _idempotency_key
   WHERE id = _a.id RETURNING * INTO _a;
  PERFORM app_private.aviso_publicacao_avisar(_a.id,
    'Aviso enviado ao cliente: ' || app_private.aviso_publicacao_rotulo(_a) || CASE WHEN _via IS NOT NULL THEN ' (pelo Hermes).' ELSE '.' END,
    'aviso_publicacao_enviado');
  RETURN to_jsonb(_a) || jsonb_build_object('via', COALESCE(_via, 'painel'));
END $$;

REVOKE ALL ON FUNCTION public.aviso_publicacao_preparar(uuid, text, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.aviso_publicacao_decidir(uuid, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.aviso_publicacao_marcar_enviado(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aviso_publicacao_preparar(uuid, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aviso_publicacao_decidir(uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aviso_publicacao_marcar_enviado(uuid, text, text) TO authenticated;

-- 4) As mesmas portas para o Hermes e as automações (só service_role, pelo MCP).
CREATE FUNCTION public.aviso_publicacao_fila_para_agente(_operator_slug text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _esperando jsonb; _aprovados jsonb; _enviados jsonb; _sem_aviso jsonb;
BEGIN
  PERFORM app_private.agente_assume_admin(_operator_slug);
  SELECT COALESCE(jsonb_agg(x ORDER BY x.created_at DESC), '[]'::jsonb) INTO _esperando FROM (
    SELECT a.id AS aviso_id, a.client_id, COALESCE(NULLIF(p.company_name, ''), p.full_name) AS cliente, a.publication_id,
           a.payload->'publication' AS post, a.mensagem, a.destino, a.payload_hash, a.valid_until, a.created_at, a.preparado_via
      FROM public.aviso_publicacao a LEFT JOIN public.profiles p ON p.id = a.client_id
     WHERE a.status = 'pendente' AND a.valid_until > now()) x;
  SELECT COALESCE(jsonb_agg(x ORDER BY x.decided_at DESC), '[]'::jsonb) INTO _aprovados FROM (
    SELECT a.id AS aviso_id, a.client_id, COALESCE(NULLIF(p.company_name, ''), p.full_name) AS cliente, a.publication_id,
           a.payload->'publication' AS post, a.mensagem, a.destino, a.decided_at, a.decision_note
      FROM public.aviso_publicacao a LEFT JOIN public.profiles p ON p.id = a.client_id
     WHERE a.status = 'aprovado' AND a.executed_at IS NULL) x;
  SELECT COALESCE(jsonb_agg(x ORDER BY x.executed_at DESC), '[]'::jsonb) INTO _enviados FROM (
    SELECT a.id AS aviso_id, COALESCE(NULLIF(p.company_name, ''), p.full_name) AS cliente, a.payload->'publication'->>'title' AS titulo,
           a.executed_at, a.execution_evidence
      FROM public.aviso_publicacao a LEFT JOIN public.profiles p ON p.id = a.client_id
     WHERE a.executed_at IS NOT NULL ORDER BY a.executed_at DESC LIMIT 20) x;
  SELECT COALESCE(jsonb_agg(x ORDER BY x.published_at DESC), '[]'::jsonb) INTO _sem_aviso FROM (
    SELECT e.id AS publication_id, e.client_id, COALESCE(NULLIF(p.company_name, ''), p.full_name) AS cliente,
           COALESCE(NULLIF(po.title, ''), 'publicação') AS titulo, e.platform, e.permalink, e.published_at
      FROM public.editorial_publications e
      LEFT JOIN public.editorial_posts po ON po.id = e.post_id
      LEFT JOIN public.profiles p ON p.id = e.client_id
     WHERE e.status = 'published' AND e.published_at > now() - interval '72 hours'
       AND NOT EXISTS (SELECT 1 FROM public.aviso_publicacao a WHERE a.publication_id = e.id AND a.status IN ('pendente', 'aprovado'))
     ORDER BY e.published_at DESC LIMIT 30) x;
  RETURN jsonb_build_object(
    'esperando_decisao', _esperando,
    'aprovados_para_enviar', _aprovados,
    'enviados_recentes', _enviados,
    'posts_no_ar_sem_aviso', _sem_aviso,
    'como_agir', jsonb_build_array(
      'posts_no_ar_sem_aviso: confira o link e prepare a mensagem com aceleriq_aviso_publicacao_preparar (whatsapp com o nome exato do grupo, ou portal).',
      'esperando_decisao: leve ao dono; quando ele responder, registre com aceleriq_aviso_publicacao_decidir citando a mensagem dele como evidência.',
      'aprovados_para_enviar: envie o texto congelado ao destino e registre com aceleriq_aviso_publicacao_marcar_enviado, com a evidência do envio.'));
END $$;

CREATE FUNCTION public.aviso_publicacao_preparar_por_agente(_operator_slug text, _publication_id uuid, _mensagem text, _destination jsonb, _idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.agente_assume_admin(_operator_slug);
  RETURN public.aviso_publicacao_preparar(_publication_id, _mensagem, _destination, _idempotency_key);
END $$;

CREATE FUNCTION public.aviso_publicacao_decidir_por_agente(_operator_slug text, _aviso_id uuid, _decision text, _comment text, _evidence text, _idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _a public.aviso_publicacao%ROWTYPE;
BEGIN
  PERFORM app_private.agente_assume_admin(_operator_slug);
  IF length(btrim(COALESCE(_evidence, ''))) < 3 THEN
    RAISE EXCEPTION 'AVISO_EVIDENCIA_OBRIGATORIA: cite a mensagem do dono que autorizou a decisão';
  END IF;
  SELECT * INTO _a FROM public.aviso_publicacao WHERE id = _aviso_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'AVISO_NAO_ENCONTRADO'; END IF;
  RETURN public.aviso_publicacao_decidir(_a.id, _a.payload_hash, _decision,
    '[via Hermes ' || lower(btrim(_operator_slug)) || ']'
      || CASE WHEN length(btrim(COALESCE(_comment, ''))) > 0 THEN ' ' || btrim(_comment) ELSE '' END
      || ' | evidência: ' || btrim(_evidence),
    _idempotency_key);
END $$;

CREATE FUNCTION public.aviso_publicacao_marcar_enviado_por_agente(_operator_slug text, _aviso_id uuid, _evidence text, _idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.agente_assume_admin(_operator_slug);
  RETURN public.aviso_publicacao_marcar_enviado(_aviso_id, _evidence, _idempotency_key);
END $$;

REVOKE ALL ON FUNCTION public.aviso_publicacao_fila_para_agente(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aviso_publicacao_preparar_por_agente(text, uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aviso_publicacao_decidir_por_agente(text, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aviso_publicacao_marcar_enviado_por_agente(text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aviso_publicacao_fila_para_agente(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.aviso_publicacao_preparar_por_agente(text, uuid, text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.aviso_publicacao_decidir_por_agente(text, uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.aviso_publicacao_marcar_enviado_por_agente(text, uuid, text, text) TO service_role;

COMMIT;
