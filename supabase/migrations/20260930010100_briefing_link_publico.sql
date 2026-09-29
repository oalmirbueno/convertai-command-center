-- Frente BRF (30/09/2026): o link público do briefing, ampliado.
--
-- As RPCs de sempre continuam sendo o ÚNICO caminho do link público até a tabela (a tabela segue
-- fechada para anon). Mudanças:
-- * briefing_public_get: devolve um objeto (jsonb) com o modelo, o dado já sabido, a validade, o
--   rascunho salvo no servidor, os anexos e o estado (enviado, expirado). Link arquivado ou
--   desconhecido: null. A tela antiga lia `id` e `submitted` do primeiro item ou do objeto: continua
--   funcionando com o objeto.
-- * briefing_public_save (nova): salva parcial por chave (só as chaves mudadas; null apaga). Duas
--   pessoas preenchendo juntas não apagam uma a resposta da outra. Recusa link enviado ou expirado.
-- * briefing_public_submit: mesma assinatura e mesmo retorno (true só quando gravou). Agora recusa
--   link expirado ou arquivado, junta as respostas com o que já estava salvo, marca enviado_em, põe a
--   decupagem na fila e avisa a equipe do cliente (o aviso nunca derruba o envio). Envio único: o
--   segundo envio devolve false.
-- * briefing_public_pedir_reabertura (nova): depois de enviado, o cliente pede para editar de novo;
--   a equipe reabre pelo painel (função briefing-agente). Um aviso por hora, no máximo.
-- * briefing_anexo_reservar (nova, só service_role): a função briefing-publico reserva o anexo
--   (trava a linha do briefing, confere estado e tetos) antes de mandar os bytes para o Storage.
-- Só amplia e é idempotente.

-- Nome do modelo para os avisos (o mesmo de briefing-modelos.ts).
CREATE OR REPLACE FUNCTION public.briefing_nome_do_modelo(_modelo text, _conteudo jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(NULLIF(_conteudo->>'nome', ''), CASE COALESCE(_modelo, 'diagnostico')
    WHEN 'site' THEN 'Site'
    WHEN 'landing' THEN 'Landing page'
    WHEN 'identidade' THEN 'Identidade e logo'
    WHEN 'naming' THEN 'Naming e logo'
    WHEN 'redes' THEN 'Redes sociais e peças'
    WHEN 'video' THEN 'Vídeo e motion'
    ELSE 'Diagnóstico geral' END);
$$;

-- Junta as mudanças por chave (null apaga a chave). Chave com mais de 64 letras é ignorada.
CREATE OR REPLACE FUNCTION public.briefing_juntar_respostas(_base jsonb, _mudancas jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  _novo jsonb := COALESCE(_base, '{}'::jsonb);
  k text;
BEGIN
  IF _mudancas IS NULL OR jsonb_typeof(_mudancas) <> 'object' THEN
    RETURN _novo;
  END IF;
  FOR k IN SELECT jsonb_object_keys(_mudancas) LOOP
    IF length(k) = 0 OR length(k) > 64 THEN
      CONTINUE;
    END IF;
    IF jsonb_typeof(_mudancas -> k) = 'null' THEN
      _novo := _novo - k;
    ELSE
      _novo := jsonb_set(_novo, ARRAY[k], _mudancas -> k, true);
    END IF;
  END LOOP;
  RETURN _novo;
END;
$$;

REVOKE ALL ON FUNCTION public.briefing_nome_do_modelo(text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.briefing_juntar_respostas(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.briefing_nome_do_modelo(text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.briefing_juntar_respostas(jsonb, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- briefing_public_get
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.briefing_public_get(text);
CREATE FUNCTION public.briefing_public_get(_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b public.briefings%ROWTYPE;
  _expirado boolean;
  _nome text;
  _marca text;
  _anexos jsonb;
BEGIN
  IF _token IS NULL OR length(_token) < 20 OR length(_token) > 80 THEN
    RETURN NULL;
  END IF;
  SELECT * INTO b FROM public.briefings WHERE token = _token AND arquivado_em IS NULL LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  _expirado := b.submitted IS NOT TRUE AND b.expira_em IS NOT NULL AND b.expira_em <= now();
  SELECT COALESCE(NULLIF(p.company_name, ''), p.full_name) INTO _nome FROM public.profiles p WHERE p.id = b.client_id;
  IF b.marca_id IS NOT NULL THEN
    SELECT m.nome INTO _marca FROM public.cliente_marcas m WHERE m.id = b.marca_id AND m.client_id = b.client_id;
  END IF;

  IF _expirado THEN
    -- Expirado: só o bastante para a tela dizer o que houve (sem as respostas).
    RETURN jsonb_build_object(
      'id', b.id,
      'submitted', false,
      'expirado', true,
      'expira_em', b.expira_em,
      'modelo', COALESCE(b.modelo, 'diagnostico'),
      'modelo_nome', public.briefing_nome_do_modelo(b.modelo, b.modelo_conteudo),
      'cliente_nome', COALESCE(_marca, _nome)
    );
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', a.id, 'campo', a.campo, 'categoria', a.categoria, 'nome', a.nome, 'tamanho', a.tamanho, 'mime', a.mime
         ) ORDER BY a.criado_em), '[]'::jsonb)
    INTO _anexos
    FROM public.briefing_anexos a
   WHERE a.briefing_id = b.id AND a.status = 'pronto' AND a.arquivado_em IS NULL;

  RETURN jsonb_build_object(
    'id', b.id,
    'submitted', COALESCE(b.submitted, false),
    'expirado', false,
    'responses', COALESCE(b.responses, '{}'::jsonb),
    'modelo', COALESCE(b.modelo, 'diagnostico'),
    'modelo_versao', b.modelo_versao,
    'modelo_conteudo', b.modelo_conteudo,
    'modelo_nome', public.briefing_nome_do_modelo(b.modelo, b.modelo_conteudo),
    'prefill', COALESCE(b.prefill, '{}'::jsonb),
    'titulo', b.titulo,
    'cliente_nome', _nome,
    'marca_nome', _marca,
    'tem_cliente', b.client_id IS NOT NULL,
    'expira_em', b.expira_em,
    'rascunho_salvo_em', b.rascunho_salvo_em,
    'enviado_em', b.enviado_em,
    'reabertura_pedida_em', b.reabertura_pedida_em,
    'anexos', _anexos,
    'equipe', COALESCE(public.is_staff(auth.uid()), false)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- briefing_public_save (salvar parcial)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.briefing_public_save(_token text, _mudancas jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b public.briefings%ROWTYPE;
  _novo jsonb;
  _agora timestamptz := now();
BEGIN
  IF _token IS NULL OR length(_token) < 20 OR length(_token) > 80 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'inexistente');
  END IF;
  IF _mudancas IS NULL OR jsonb_typeof(_mudancas) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'invalido');
  END IF;
  IF pg_column_size(_mudancas) > 262144 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'grande');
  END IF;

  SELECT * INTO b FROM public.briefings WHERE token = _token AND arquivado_em IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'inexistente');
  END IF;
  IF b.submitted IS TRUE THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'enviado');
  END IF;
  IF b.expira_em IS NOT NULL AND b.expira_em <= _agora THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'expirado');
  END IF;

  _novo := public.briefing_juntar_respostas(b.responses, _mudancas);
  IF pg_column_size(_novo) > 524288 OR (SELECT count(*) FROM jsonb_object_keys(_novo)) > 400 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'grande');
  END IF;

  UPDATE public.briefings SET responses = _novo, rascunho_salvo_em = _agora WHERE id = b.id;
  RETURN jsonb_build_object('ok', true, 'salvo_em', _agora, 'respostas', _novo);
END;
$$;

-- ---------------------------------------------------------------------------
-- briefing_public_submit (envio único)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.briefing_public_submit(_token text, _responses jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b public.briefings%ROWTYPE;
  _novo jsonb;
  _nome text;
BEGIN
  IF _token IS NULL OR length(_token) < 20 OR length(_token) > 80 THEN
    RETURN false;
  END IF;
  SELECT * INTO b FROM public.briefings WHERE token = _token AND arquivado_em IS NULL FOR UPDATE;
  IF NOT FOUND OR b.submitted IS TRUE THEN
    RETURN false;
  END IF;
  IF b.expira_em IS NOT NULL AND b.expira_em <= now() THEN
    RETURN false;
  END IF;
  IF _responses IS NOT NULL AND (jsonb_typeof(_responses) <> 'object' OR pg_column_size(_responses) > 524288) THEN
    RETURN false;
  END IF;

  _novo := public.briefing_juntar_respostas(b.responses, _responses);
  UPDATE public.briefings
     SET responses = _novo,
         submitted = true,
         enviado_em = now(),
         envios = COALESCE(b.envios, 0) + 1,
         reabertura_pedida_em = NULL,
         reabertura_motivo = NULL
   WHERE id = b.id;

  -- A decupagem deste envio entra na fila (a função briefing-publico ou o painel processam).
  INSERT INTO public.briefing_decupagens (briefing_id, client_id, marca_id, envio, status)
  VALUES (b.id, b.client_id, b.marca_id, COALESCE(b.envios, 0) + 1, 'pendente')
  ON CONFLICT (briefing_id, envio) DO NOTHING;

  -- Aviso para a equipe do cliente, com o link direto. Falha no aviso nunca derruba o envio.
  BEGIN
    SELECT COALESCE(NULLIF(p.company_name, ''), p.full_name) INTO _nome FROM public.profiles p WHERE p.id = b.client_id;
    PERFORM public.avisar_equipe_do_cliente(
      b.client_id,
      format('Briefing recebido: %s (%s)', COALESCE(_nome, NULLIF(_novo->>'companyName', ''), NULLIF(_novo->>'empresa', ''), 'sem nome'), public.briefing_nome_do_modelo(b.modelo, b.modelo_conteudo)),
      'request',
      '/briefings?briefing=' || b.id::text
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'briefing_public_submit: aviso da equipe falhou: %', SQLERRM;
  END;

  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- briefing_public_pedir_reabertura
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.briefing_public_pedir_reabertura(_token text, _motivo text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b public.briefings%ROWTYPE;
  _nome text;
BEGIN
  IF _token IS NULL OR length(_token) < 20 OR length(_token) > 80 THEN
    RETURN false;
  END IF;
  SELECT * INTO b FROM public.briefings WHERE token = _token AND arquivado_em IS NULL FOR UPDATE;
  IF NOT FOUND OR b.submitted IS NOT TRUE THEN
    RETURN false;
  END IF;
  -- Já pedido na última hora: vale o pedido de antes, sem outro aviso.
  IF b.reabertura_pedida_em IS NOT NULL AND b.reabertura_pedida_em > now() - interval '1 hour' THEN
    RETURN true;
  END IF;

  UPDATE public.briefings
     SET reabertura_pedida_em = now(),
         reabertura_motivo = left(NULLIF(btrim(COALESCE(_motivo, '')), ''), 500)
   WHERE id = b.id;

  BEGIN
    SELECT COALESCE(NULLIF(p.company_name, ''), p.full_name) INTO _nome FROM public.profiles p WHERE p.id = b.client_id;
    PERFORM public.avisar_equipe_do_cliente(
      b.client_id,
      format('Pedido para reabrir o briefing: %s (%s)', COALESCE(_nome, 'sem nome'), public.briefing_nome_do_modelo(b.modelo, b.modelo_conteudo)),
      'request',
      '/briefings?briefing=' || b.id::text
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'briefing_public_pedir_reabertura: aviso da equipe falhou: %', SQLERRM;
  END;
  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- briefing_anexo_reservar (só a função briefing-publico, com a chave de serviço)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.briefing_anexo_reservar(
  _token text,
  _campo text,
  _categoria text,
  _nome text,
  _mime text,
  _tamanho bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b public.briefings%ROWTYPE;
  _qtd integer;
  _bytes bigint;
  _ultimo_minuto integer;
  _id uuid;
BEGIN
  IF _token IS NULL OR length(_token) < 20 OR length(_token) > 80 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'inexistente');
  END IF;
  IF _tamanho IS NULL OR _tamanho <= 0 OR _tamanho > 26214400 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'grande');
  END IF;
  IF _campo IS NOT NULL AND _campo !~ '^[A-Za-z][A-Za-z0-9_]{0,48}$' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'campo_invalido');
  END IF;

  SELECT * INTO b FROM public.briefings WHERE token = _token AND arquivado_em IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'inexistente');
  END IF;
  IF b.submitted IS TRUE THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'enviado');
  END IF;
  IF b.expira_em IS NOT NULL AND b.expira_em <= now() THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'expirado');
  END IF;
  IF b.client_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sem_cliente');
  END IF;

  -- Reserva presa há mais de 15 minutos não conta (envio que caiu no meio).
  SELECT count(*), COALESCE(sum(a.tamanho), 0),
         count(*) FILTER (WHERE a.criado_em > now() - interval '1 minute')
    INTO _qtd, _bytes, _ultimo_minuto
    FROM public.briefing_anexos a
   WHERE a.briefing_id = b.id
     AND a.arquivado_em IS NULL
     AND (a.status = 'pronto' OR (a.status = 'enviando' AND a.criado_em > now() - interval '15 minutes'));

  IF _qtd >= 40 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'muitos_anexos');
  END IF;
  IF _bytes + _tamanho > 314572800 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'cota');
  END IF;
  IF _ultimo_minuto >= 12 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'devagar');
  END IF;

  INSERT INTO public.briefing_anexos (briefing_id, client_id, campo, categoria, nome, mime, tamanho, status)
  VALUES (
    b.id,
    b.client_id,
    _campo,
    CASE WHEN _categoria IN ('logo', 'manual', 'fotos', 'textos', 'videos', 'referencias', 'outros') THEN _categoria ELSE 'outros' END,
    left(_nome, 220),
    left(_mime, 120),
    _tamanho,
    'enviando'
  )
  RETURNING id INTO _id;

  RETURN jsonb_build_object('ok', true, 'anexo_id', _id, 'briefing_id', b.id, 'client_id', b.client_id, 'project_id', b.project_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- Permissões: o link público só executa estas funções; a tabela continua fechada.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.briefing_public_get(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.briefing_public_save(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.briefing_public_submit(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.briefing_public_pedir_reabertura(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.briefing_anexo_reservar(text, text, text, text, text, bigint) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.briefing_public_get(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.briefing_public_save(text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.briefing_public_submit(text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.briefing_public_pedir_reabertura(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.briefing_anexo_reservar(text, text, text, text, text, bigint) TO service_role;

-- Conferência (só leitura, depois de aplicar):
--   select public.briefing_public_get('token-que-nao-existe-000000');                 -- null
--   select has_function_privilege('anon', 'public.briefing_anexo_reservar(text,text,text,text,text,bigint)', 'execute'); -- false
--   begin; set local role anon; select count(*) from public.briefings; rollback;       -- 0 linhas (RLS)
