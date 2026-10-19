-- Vendas, quiz e teste A/B do Laboratório v4 (19/10/2026, ESPEC-LABORATORIO-v4).
--
-- 1) Checkout pelo gateway do cliente (seção 5, opção (a), decisão do dono):
--    · vendas_integracoes: uma integração ligada por cliente (NULL = agência)
--      e gateway. A chave pública vai no endereço do webhook. O segredo:
--        - token (Hotmart hottok, Asaas asaas-access-token): só o hash SHA-256;
--          o do Asaas é gerado aqui e volta UMA vez na criação;
--        - hmac (Stripe, Kiwify, Mercado Pago): o segredo de assinatura é do
--          gateway e precisa existir para recalcular a assinatura, então mora
--          no Vault (cifrado), nunca em coluna, nunca volta para a tela;
--        - token_api (Mercado Pago obrigatório, Asaas opcional): chave de API
--          do cliente para ler o pagamento/cliente; também no Vault.
--    · vendas_eventos: o evento normalizado, único por (integração, id
--      externo), ligado ao lead do CRM pelo e-mail ou WhatsApp. Sem lead, cria
--      um com origin 'checkout' e a nota "Venda pelo checkout ...".
--    · RPCs só da service_role (função vendas-webhook): criar, salvar segredo,
--      desligar, ler para o webhook e registrar evento.
--    · RLS: só a equipe (admin ou gestor) lê; escrita só pela função.
-- 2) Quiz pelo formulário do site: site_registrar_lead ganha _quiz jsonb
--    DEFAULT NULL (a assinatura de 10 argumentos sai; chamada sem _quiz segue
--    igual). Vai para commercial_leads.qualificacao.quiz e a nota diz a faixa.
-- 3) Teste A/B: lab_ab_contagem (teste, variante, visita|conversao, dia,
--    total) com incremento por RPC e limite por IP (lab_ab_limite).
--
-- Só amplia: nenhuma linha existente muda, nada é apagado.

-- ════════════════════════════════════════════════════════════════════════
-- 1) Vendas
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.vendas_integracoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  gateway text NOT NULL CHECK (gateway IN ('hotmart', 'kiwify', 'stripe', 'mercado_pago', 'asaas')),
  chave text NOT NULL UNIQUE CHECK (chave ~ '^[a-f0-9]{32}$'),
  validacao text NOT NULL CHECK (validacao IN ('token', 'hmac')),
  segredo_hash text CHECK (segredo_hash IS NULL OR segredo_hash ~ '^[a-f0-9]{64}$'),
  segredo_vault_id uuid,
  token_api_vault_id uuid,
  segredo_final text CHECK (segredo_final IS NULL OR char_length(segredo_final) <= 4),
  segredo_em timestamptz,
  token_api_em timestamptz,
  ativo boolean NOT NULL DEFAULT true,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  desligado_por uuid,
  desligado_em timestamptz,
  ultimo_evento_em timestamptz,
  CONSTRAINT vendas_integracoes_segredo_coerente CHECK (
    (validacao = 'token' AND segredo_vault_id IS NULL) OR (validacao = 'hmac' AND segredo_hash IS NULL)
  )
);

-- Uma integração ligada por cliente (ou agência) e gateway.
CREATE UNIQUE INDEX IF NOT EXISTS vendas_integracoes_uma_ligada
  ON public.vendas_integracoes (COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid), gateway)
  WHERE ativo;
CREATE INDEX IF NOT EXISTS vendas_integracoes_cliente_idx ON public.vendas_integracoes (client_id, criado_em DESC);

CREATE TABLE IF NOT EXISTS public.vendas_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integracao_id uuid NOT NULL REFERENCES public.vendas_integracoes(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  gateway text NOT NULL CHECK (gateway IN ('hotmart', 'kiwify', 'stripe', 'mercado_pago', 'asaas')),
  id_externo text NOT NULL CHECK (char_length(id_externo) BETWEEN 1 AND 200),
  tipo text NOT NULL CHECK (tipo IN (
    'compra_aprovada', 'compra_recusada', 'pix_gerado', 'boleto_gerado', 'pagamento_expirado',
    'carrinho_abandonado', 'reembolso', 'chargeback', 'cancelamento',
    'assinatura_renovada', 'assinatura_atrasada', 'assinatura_cancelada'
  )),
  valor numeric(14, 2) CHECK (valor IS NULL OR valor >= 0),
  moeda text CHECK (moeda IS NULL OR moeda ~ '^[A-Z]{3}$'),
  produto_externo_id text CHECK (produto_externo_id IS NULL OR char_length(produto_externo_id) <= 120),
  comprador_email text CHECK (comprador_email IS NULL OR char_length(comprador_email) <= 120),
  comprador_nome text CHECK (comprador_nome IS NULL OR char_length(comprador_nome) <= 120),
  comprador_whatsapp text CHECK (comprador_whatsapp IS NULL OR comprador_whatsapp ~ '^[0-9]{8,15}$'),
  lead_id uuid REFERENCES public.commercial_leads(id) ON DELETE SET NULL,
  -- Só o resumo que a função monta (evento, status, método...). Nunca o corpo do gateway nem dado de cartão.
  payload_resumido jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payload_resumido) = 'object' AND pg_column_size(payload_resumido) <= 4096),
  recebido_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendas_eventos_idempotente UNIQUE (integracao_id, id_externo)
);

CREATE INDEX IF NOT EXISTS vendas_eventos_integracao_idx ON public.vendas_eventos (integracao_id, recebido_em DESC);
CREATE INDEX IF NOT EXISTS vendas_eventos_cliente_idx ON public.vendas_eventos (client_id, recebido_em DESC);
CREATE INDEX IF NOT EXISTS vendas_eventos_lead_idx ON public.vendas_eventos (lead_id) WHERE lead_id IS NOT NULL;

COMMENT ON TABLE public.vendas_integracoes IS
  'Webhook de vendas do gateway do cliente (Laboratório v4). Segredo: hash (token) ou Vault (hmac); nunca em texto. Escrita só pela função vendas-webhook.';
COMMENT ON TABLE public.vendas_eventos IS
  'Eventos de venda normalizados (compra, Pix, boleto, carrinho, reembolso...), únicos por integração e id externo, ligados ao lead do CRM.';

ALTER TABLE public.vendas_integracoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendas_eventos ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.vendas_integracoes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.vendas_eventos FROM PUBLIC, anon, authenticated;
-- A equipe lê a integração sem o hash e sem os ponteiros do Vault.
GRANT SELECT (id, client_id, gateway, chave, validacao, segredo_final, segredo_em, token_api_em, ativo, criado_por, criado_em, desligado_por, desligado_em, ultimo_evento_em)
  ON public.vendas_integracoes TO authenticated;
GRANT SELECT ON public.vendas_eventos TO authenticated;
GRANT ALL ON public.vendas_integracoes TO service_role;
GRANT ALL ON public.vendas_eventos TO service_role;

DROP POLICY IF EXISTS vendas_integracoes_equipe_le ON public.vendas_integracoes;
CREATE POLICY vendas_integracoes_equipe_le ON public.vendas_integracoes
  FOR SELECT TO authenticated
  USING (
    (public.has_role((select auth.uid()), 'admin'::public.app_role) OR public.has_role((select auth.uid()), 'manager'::public.app_role))
    AND (client_id IS NULL OR COALESCE(public.can_access_client(client_id), false))
  );

DROP POLICY IF EXISTS vendas_eventos_equipe_le ON public.vendas_eventos;
CREATE POLICY vendas_eventos_equipe_le ON public.vendas_eventos
  FOR SELECT TO authenticated
  USING (
    (public.has_role((select auth.uid()), 'admin'::public.app_role) OR public.has_role((select auth.uid()), 'manager'::public.app_role))
    AND (client_id IS NULL OR COALESCE(public.can_access_client(client_id), false))
  );

-- ─── 1.1 Criar: chave pública e, no Asaas, o token (volta uma vez) ─────────
CREATE OR REPLACE FUNCTION public.vendas_integracao_criar(_client_id uuid, _gateway text, _ator uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _id uuid;
  _existente uuid;
  _chave text;
  _segredo text;
  _validacao text;
BEGIN
  IF NOT app_private.rpc_trusted_backend() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'VENDAS_SO_BACKEND';
  END IF;
  IF _gateway IS NULL OR _gateway NOT IN ('hotmart', 'kiwify', 'stripe', 'mercado_pago', 'asaas') THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'gateway_invalido');
  END IF;
  IF _client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _client_id) THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'cliente_invalido');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('vendas_integracao:' || COALESCE(_client_id::text, 'agencia') || ':' || _gateway));

  SELECT i.id INTO _existente FROM public.vendas_integracoes i
   WHERE i.ativo AND i.gateway = _gateway AND i.client_id IS NOT DISTINCT FROM _client_id
   LIMIT 1;
  IF _existente IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'ja_existe', 'id', _existente);
  END IF;

  _chave := encode(extensions.gen_random_bytes(16), 'hex');
  _validacao := CASE WHEN _gateway IN ('hotmart', 'asaas') THEN 'token' ELSE 'hmac' END;
  IF _gateway = 'asaas' THEN
    -- 48 hex: dentro dos 32 a 255 caracteres que o Asaas pede, sem espaço nem sequência.
    _segredo := encode(extensions.gen_random_bytes(24), 'hex');
  END IF;

  INSERT INTO public.vendas_integracoes (client_id, gateway, chave, validacao, segredo_hash, segredo_final, segredo_em, criado_por)
  VALUES (
    _client_id, _gateway, _chave, _validacao,
    CASE WHEN _segredo IS NOT NULL THEN encode(extensions.digest(_segredo, 'sha256'), 'hex') END,
    CASE WHEN _segredo IS NOT NULL THEN right(_segredo, 4) END,
    CASE WHEN _segredo IS NOT NULL THEN now() END,
    _ator
  )
  RETURNING id INTO _id;

  RETURN jsonb_build_object('ok', true, 'id', _id, 'chave', _chave, 'segredo', _segredo);
END;
$body$;

-- ─── 1.2 Salvar o segredo do gateway e/ou a chave de API ───────────────────
CREATE OR REPLACE FUNCTION public.vendas_integracao_segredo(_id uuid, _segredo text, _token_api text, _ator uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _i public.vendas_integracoes%ROWTYPE;
  _novo uuid;
BEGIN
  IF NOT app_private.rpc_trusted_backend() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'VENDAS_SO_BACKEND';
  END IF;
  SELECT * INTO _i FROM public.vendas_integracoes WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR NOT _i.ativo THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'nao_encontrada');
  END IF;

  _segredo := NULLIF(btrim(COALESCE(_segredo, '')), '');
  _token_api := NULLIF(btrim(COALESCE(_token_api, '')), '');
  IF (_segredo IS NOT NULL AND (char_length(_segredo) NOT BETWEEN 8 AND 512 OR _segredo ~ '\s'))
     OR (_token_api IS NOT NULL AND (char_length(_token_api) NOT BETWEEN 8 AND 512 OR _token_api ~ '\s')) THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'segredo_invalido');
  END IF;
  IF _segredo IS NOT NULL AND _i.gateway = 'asaas' THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'segredo_gerado_pelo_painel');
  END IF;
  IF _token_api IS NOT NULL AND _i.gateway NOT IN ('mercado_pago', 'asaas') THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'token_api_nao_usado');
  END IF;

  IF _segredo IS NOT NULL THEN
    IF _i.validacao = 'token' THEN
      UPDATE public.vendas_integracoes
         SET segredo_hash = encode(extensions.digest(_segredo, 'sha256'), 'hex'), segredo_final = right(_segredo, 4), segredo_em = now()
       WHERE id = _id;
    ELSIF _i.segredo_vault_id IS NOT NULL THEN
      PERFORM vault.update_secret(_i.segredo_vault_id, _segredo, NULL, NULL, NULL);
      UPDATE public.vendas_integracoes SET segredo_final = right(_segredo, 4), segredo_em = now() WHERE id = _id;
    ELSE
      SELECT vault.create_secret(_segredo, 'vendas-webhook-segredo-' || _id::text || '-' || gen_random_uuid()::text, 'Segredo de assinatura do webhook de vendas', NULL) INTO _novo;
      UPDATE public.vendas_integracoes SET segredo_vault_id = _novo, segredo_final = right(_segredo, 4), segredo_em = now() WHERE id = _id;
    END IF;
  END IF;

  IF _token_api IS NOT NULL THEN
    IF _i.token_api_vault_id IS NOT NULL THEN
      PERFORM vault.update_secret(_i.token_api_vault_id, _token_api, NULL, NULL, NULL);
      UPDATE public.vendas_integracoes SET token_api_em = now() WHERE id = _id;
    ELSE
      SELECT vault.create_secret(_token_api, 'vendas-webhook-api-' || _id::text || '-' || gen_random_uuid()::text, 'Chave de API do gateway (leitura do pagamento)', NULL) INTO _novo;
      UPDATE public.vendas_integracoes SET token_api_vault_id = _novo, token_api_em = now() WHERE id = _id;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$body$;

-- ─── 1.3 Desligar: para de aceitar avisos e apaga os segredos do Vault ─────
CREATE OR REPLACE FUNCTION public.vendas_integracao_desligar(_id uuid, _ator uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _i public.vendas_integracoes%ROWTYPE;
BEGIN
  IF NOT app_private.rpc_trusted_backend() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'VENDAS_SO_BACKEND';
  END IF;
  SELECT * INTO _i FROM public.vendas_integracoes WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'nao_encontrada');
  END IF;
  IF NOT _i.ativo THEN
    RETURN jsonb_build_object('ok', true, 'ja_desligada', true);
  END IF;
  IF _i.segredo_vault_id IS NOT NULL THEN DELETE FROM vault.secrets WHERE id = _i.segredo_vault_id; END IF;
  IF _i.token_api_vault_id IS NOT NULL THEN DELETE FROM vault.secrets WHERE id = _i.token_api_vault_id; END IF;
  UPDATE public.vendas_integracoes
     SET ativo = false, desligado_em = now(), desligado_por = _ator,
         segredo_hash = NULL, segredo_vault_id = NULL, token_api_vault_id = NULL
   WHERE id = _id;
  RETURN jsonb_build_object('ok', true);
END;
$body$;

-- ─── 1.4 Ler para o webhook (com o segredo decifrado): só a função ─────────
CREATE OR REPLACE FUNCTION public.vendas_integracao_para_webhook(_gateway text, _chave text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _i public.vendas_integracoes%ROWTYPE;
BEGIN
  IF NOT app_private.rpc_trusted_backend() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'VENDAS_SO_BACKEND';
  END IF;
  IF _chave IS NULL OR _chave !~ '^[a-f0-9]{32}$' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO _i FROM public.vendas_integracoes WHERE chave = _chave AND gateway = _gateway;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'id', _i.id,
    'client_id', _i.client_id,
    'gateway', _i.gateway,
    'ativo', _i.ativo,
    'segredo_hash', _i.segredo_hash,
    'segredo', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.id = _i.segredo_vault_id),
    'token_api', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.id = _i.token_api_vault_id)
  );
END;
$body$;

-- ─── 1.5 Registrar o evento (idempotente) e ligar ao lead do CRM ───────────
CREATE OR REPLACE FUNCTION public.vendas_registrar_evento(
  _integracao_id uuid,
  _id_externo text,
  _tipo text,
  _valor numeric,
  _moeda text,
  _produto text,
  _email text,
  _nome text,
  _whatsapp text,
  _resumo jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _i public.vendas_integracoes%ROWTYPE;
  _lead uuid;
  _novo boolean := false;
  _evento uuid;
  _nome_gateway text;
  _rotulo text;
  _quantia text;
  _resumo_limpo jsonb := '{}'::jsonb;
BEGIN
  IF NOT app_private.rpc_trusted_backend() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'VENDAS_SO_BACKEND';
  END IF;
  SELECT * INTO _i FROM public.vendas_integracoes WHERE id = _integracao_id;
  IF NOT FOUND OR NOT _i.ativo THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'integracao_desligada');
  END IF;
  IF _id_externo IS NULL OR char_length(_id_externo) NOT BETWEEN 1 AND 200 THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'id_externo_invalido');
  END IF;
  IF _tipo IS NULL OR _tipo NOT IN ('compra_aprovada', 'compra_recusada', 'pix_gerado', 'boleto_gerado', 'pagamento_expirado',
      'carrinho_abandonado', 'reembolso', 'chargeback', 'cancelamento', 'assinatura_renovada', 'assinatura_atrasada', 'assinatura_cancelada') THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'tipo_invalido');
  END IF;

  -- O mesmo aviso chegando duas vezes ao mesmo tempo não vira dois eventos.
  PERFORM pg_advisory_xact_lock(hashtext('vendas_evento:' || _integracao_id::text || ':' || _id_externo));
  IF EXISTS (SELECT 1 FROM public.vendas_eventos e WHERE e.integracao_id = _integracao_id AND e.id_externo = _id_externo) THEN
    RETURN jsonb_build_object('ok', true, 'duplicado', true);
  END IF;

  -- Segunda trava (a função já conferiu): contato no formato, texto curto.
  _email := lower(btrim(COALESCE(_email, '')));
  IF _email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[a-z]{2,}$' OR char_length(_email) > 120 THEN _email := NULL; END IF;
  _whatsapp := regexp_replace(COALESCE(_whatsapp, ''), '[^0-9]', '', 'g');
  IF char_length(_whatsapp) NOT BETWEEN 8 AND 15 THEN _whatsapp := NULL; END IF;
  _nome := NULLIF(left(btrim(regexp_replace(COALESCE(_nome, ''), '[[:space:]]+', ' ', 'g')), 120), '');
  _produto := NULLIF(left(btrim(COALESCE(_produto, '')), 120), '');
  _moeda := CASE WHEN upper(COALESCE(_moeda, '')) ~ '^[A-Z]{3}$' THEN upper(_moeda) END;
  IF _valor IS NOT NULL AND (_valor < 0 OR _valor > 999999999999) THEN _valor := NULL; END IF;
  IF _resumo IS NOT NULL AND jsonb_typeof(_resumo) = 'object' THEN
    SELECT COALESCE(jsonb_object_agg(t.k, CASE WHEN jsonb_typeof(t.v) = 'string' THEN to_jsonb(left(t.v #>> '{}', 120)) ELSE t.v END), '{}'::jsonb)
      INTO _resumo_limpo
      FROM (SELECT k, v FROM jsonb_each(_resumo) AS e(k, v)
             WHERE char_length(k) <= 40 AND jsonb_typeof(v) IN ('string', 'number', 'boolean')
             LIMIT 12) AS t;
  END IF;

  -- Lead do CRM: o mais recente do mesmo cliente (ou da agência) com o mesmo e-mail ou WhatsApp.
  IF _email IS NOT NULL OR _whatsapp IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('vendas_lead:' || COALESCE(_i.client_id::text, 'agencia') || ':' || COALESCE(_email, _whatsapp)));
    SELECT l.id INTO _lead
      FROM public.commercial_leads l
     WHERE l.archived_at IS NULL
       AND COALESCE(l.qualificacao ->> 'client_id', '') = COALESCE(_i.client_id::text, '')
       AND ((_email IS NOT NULL AND lower(l.email) = _email) OR (_whatsapp IS NOT NULL AND l.whatsapp = _whatsapp))
     ORDER BY l.created_at DESC
     LIMIT 1;
    IF _lead IS NULL THEN
      INSERT INTO public.commercial_leads (name, email, whatsapp, origin, qualificacao)
      VALUES (
        left(COALESCE(_nome, _email, _whatsapp), 120),
        _email,
        _whatsapp,
        'checkout',
        jsonb_build_object('fonte', 'checkout', 'gateway', _i.gateway, 'client_id', _i.client_id, 'integracao_id', _i.id, 'produto', _produto)
      )
      RETURNING id INTO _lead;
      _novo := true;
    END IF;
  END IF;

  INSERT INTO public.vendas_eventos (integracao_id, client_id, gateway, id_externo, tipo, valor, moeda, produto_externo_id,
                                     comprador_email, comprador_nome, comprador_whatsapp, lead_id, payload_resumido)
  VALUES (_i.id, _i.client_id, _i.gateway, _id_externo, _tipo, _valor, _moeda, _produto,
          _email, _nome, _whatsapp, _lead, _resumo_limpo)
  RETURNING id INTO _evento;

  UPDATE public.vendas_integracoes SET ultimo_evento_em = now() WHERE id = _i.id;

  IF _lead IS NOT NULL THEN
    _nome_gateway := CASE _i.gateway WHEN 'hotmart' THEN 'Hotmart' WHEN 'kiwify' THEN 'Kiwify' WHEN 'stripe' THEN 'Stripe'
                                     WHEN 'mercado_pago' THEN 'Mercado Pago' ELSE 'Asaas' END;
    _rotulo := CASE _tipo
      WHEN 'compra_aprovada' THEN 'compra aprovada'
      WHEN 'compra_recusada' THEN 'compra recusada'
      WHEN 'pix_gerado' THEN 'Pix gerado, ainda não pago'
      WHEN 'boleto_gerado' THEN 'boleto gerado, ainda não pago'
      WHEN 'pagamento_expirado' THEN 'Pix ou boleto vencido'
      WHEN 'carrinho_abandonado' THEN 'carrinho abandonado'
      WHEN 'reembolso' THEN 'reembolso'
      WHEN 'chargeback' THEN 'chargeback'
      WHEN 'cancelamento' THEN 'compra cancelada'
      WHEN 'assinatura_renovada' THEN 'assinatura renovada'
      WHEN 'assinatura_atrasada' THEN 'assinatura em atraso'
      ELSE 'assinatura cancelada' END;
    _quantia := CASE WHEN _valor IS NULL THEN NULL
                     WHEN COALESCE(_moeda, 'BRL') = 'BRL' THEN 'R$ ' || replace(to_char(_valor, 'FM999999999990.00'), '.', ',')
                     ELSE _moeda || ' ' || to_char(_valor, 'FM999999999990.00') END;
    INSERT INTO public.commercial_lead_events (lead_id, kind, note)
    VALUES (_lead, 'nota', left('Venda pelo checkout ' || _nome_gateway || ': ' || _rotulo
      || COALESCE(' de ' || _quantia, '') || COALESCE(' (produto ' || _produto || ')', '') || '.', 400));
  END IF;

  RETURN jsonb_build_object('ok', true, 'duplicado', false, 'evento_id', _evento, 'lead_id', _lead, 'lead_novo', _novo);
END;
$body$;

REVOKE ALL ON FUNCTION public.vendas_integracao_criar(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vendas_integracao_segredo(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vendas_integracao_desligar(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vendas_integracao_para_webhook(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vendas_registrar_evento(uuid, text, text, numeric, text, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vendas_integracao_criar(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.vendas_integracao_segredo(uuid, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.vendas_integracao_desligar(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.vendas_integracao_para_webhook(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.vendas_registrar_evento(uuid, text, text, numeric, text, text, text, text, text, jsonb) TO service_role;

-- ════════════════════════════════════════════════════════════════════════
-- 2) Quiz pelo formulário do site: site_registrar_lead ganha _quiz
-- ════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.site_registrar_lead(text, text, text, text, text, text, text, text, text, jsonb);

CREATE FUNCTION public.site_registrar_lead(
  _chave text,
  _ip_hash text,
  _nome text,
  _email text,
  _whatsapp text,
  _empresa text,
  _mensagem text,
  _pagina text,
  _spam_motivo text DEFAULT NULL,
  _origem jsonb DEFAULT NULL,
  _quiz jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _s record;
  _lead uuid;
  _repetido uuid;
  _por_ip int;
  _por_site int;
  _o jsonb;
  _q jsonb;
  _respostas jsonb;
  _pontuacao numeric;
  _faixa text;
BEGIN
  IF NOT app_private.rpc_trusted_backend() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SITE_FORMULARIO_SO_BACKEND';
  END IF;
  IF _chave IS NULL OR _chave !~ '^[a-z0-9]{20,40}$' OR _ip_hash IS NULL OR char_length(_ip_hash) NOT BETWEEN 16 AND 128 THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'pedido_invalido');
  END IF;

  SELECT s.id, s.client_id, s.nome INTO _s
  FROM public.sites s
  WHERE s.integracoes -> 'formulario' ->> 'chave' = _chave
    AND COALESCE((s.integracoes -> 'formulario' ->> 'ligado')::boolean, false)
    AND s.arquivado_em IS NULL
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'formulario_desligado');
  END IF;

  -- Um envio por vez por site: a contagem e a gravação não se atropelam.
  PERFORM pg_advisory_xact_lock(hashtext('site_formulario:' || _s.id::text));

  IF _spam_motivo IS NOT NULL THEN
    INSERT INTO public.site_formulario_envios (site_id, client_id, ip_hash, resultado, motivo, pagina)
    VALUES (_s.id, _s.client_id, _ip_hash, 'spam', left(_spam_motivo, 60), left(_pagina, 200));
    RETURN jsonb_build_object('ok', false, 'codigo', 'spam');
  END IF;

  SELECT count(*) INTO _por_ip FROM public.site_formulario_envios
   WHERE ip_hash = _ip_hash AND criado_em > now() - interval '10 minutes';
  SELECT count(*) INTO _por_site FROM public.site_formulario_envios
   WHERE site_id = _s.id AND resultado IN ('aceito', 'duplicado') AND criado_em > now() - interval '1 hour';
  IF _por_ip >= 5 OR _por_site >= 60 THEN
    INSERT INTO public.site_formulario_envios (site_id, client_id, ip_hash, resultado, motivo, pagina)
    VALUES (_s.id, _s.client_id, _ip_hash, 'limite', CASE WHEN _por_ip >= 5 THEN 'ip' ELSE 'site' END, left(_pagina, 200));
    RETURN jsonb_build_object('ok', false, 'codigo', 'limite');
  END IF;

  -- Quiz: pontuação (número), faixa (até 60) e até 30 respostas de texto
  -- (até 200 cada). A função pública já conferiu (quiz-do-site.ts); aqui é a
  -- segunda trava. Fora do formato, o lead entra sem o quiz.
  IF _quiz IS NOT NULL AND jsonb_typeof(_quiz) = 'object'
     AND jsonb_typeof(_quiz -> 'pontuacao') = 'number' AND jsonb_typeof(_quiz -> 'faixa') = 'string' THEN
    _pontuacao := (_quiz ->> 'pontuacao')::numeric;
    _faixa := left(btrim(_quiz ->> 'faixa'), 60);
    IF abs(_pontuacao) <= 1000000 AND _faixa <> '' THEN
      IF jsonb_typeof(_quiz -> 'respostas') = 'object' THEN
        SELECT COALESCE(jsonb_object_agg(left(t.k, 200), left(t.v, 200)), '{}'::jsonb)
          INTO _respostas
          FROM (SELECT r.k, r.v FROM jsonb_each_text(_quiz -> 'respostas') AS r(k, v)
                 WHERE jsonb_typeof((_quiz -> 'respostas') -> r.k) = 'string'
                 LIMIT 30) AS t;
      END IF;
      _q := jsonb_build_object('pontuacao', round(_pontuacao, 2), 'faixa', _faixa, 'respostas', COALESCE(_respostas, '{}'::jsonb), 'respondido_em', now());
    END IF;
  END IF;

  SELECT e.lead_id INTO _repetido
  FROM public.site_formulario_envios e
  JOIN public.commercial_leads l ON l.id = e.lead_id
  WHERE e.site_id = _s.id AND e.resultado = 'aceito' AND e.criado_em > now() - interval '10 minutes'
    AND ((NULLIF(_email, '') IS NOT NULL AND lower(l.email) = lower(_email)) OR (NULLIF(_whatsapp, '') IS NOT NULL AND l.whatsapp = _whatsapp))
  ORDER BY e.criado_em DESC
  LIMIT 1;
  IF _repetido IS NOT NULL THEN
    -- Refez o quiz logo depois: fica a resposta nova, o lead é o mesmo.
    IF _q IS NOT NULL THEN
      UPDATE public.commercial_leads SET qualificacao = COALESCE(qualificacao, '{}'::jsonb) || jsonb_build_object('quiz', _q) WHERE id = _repetido;
      INSERT INTO public.commercial_lead_events (lead_id, kind, note)
      VALUES (_repetido, 'nota', left('Refez o quiz do site ' || _s.nome || ': faixa ' || (_q ->> 'faixa') || ' (pontuação ' || (_q ->> 'pontuacao') || ').', 400));
    END IF;
    INSERT INTO public.site_formulario_envios (site_id, client_id, ip_hash, resultado, lead_id, pagina)
    VALUES (_s.id, _s.client_id, _ip_hash, 'duplicado', _repetido, left(_pagina, 200));
    RETURN jsonb_build_object('ok', true, 'duplicado', true);
  END IF;

  -- Origem do clique: só as chaves conhecidas, texto curto, nada de objeto
  -- aninhado. A função pública já conferiu o formato (origem-clique.ts);
  -- aqui é a segunda trava, no banco.
  IF _origem IS NOT NULL AND jsonb_typeof(_origem) = 'object' THEN
    SELECT jsonb_object_agg(t.k, left(t.v, CASE WHEN t.k = 'fbclid' THEN 500 ELSE 150 END))
      INTO _o
      FROM jsonb_each_text(_origem) AS t(k, v)
     WHERE t.k IN ('utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ad_id', 'adset_id', 'campaign_id', 'fbclid')
       AND jsonb_typeof(_origem -> t.k) IN ('string', 'number')
       AND NULLIF(btrim(t.v), '') IS NOT NULL
       AND (t.k NOT IN ('ad_id', 'adset_id', 'campaign_id') OR t.v ~ '^[0-9]{5,25}$');
  END IF;

  INSERT INTO public.commercial_leads (name, email, whatsapp, origin, notes, qualificacao, origem_clique)
  VALUES (
    left(btrim(_nome), 120),
    NULLIF(left(btrim(COALESCE(_email, '')), 120), ''),
    NULLIF(left(btrim(COALESCE(_whatsapp, '')), 20), ''),
    'site',
    NULLIF(left(concat_ws(E'\n', CASE WHEN NULLIF(btrim(COALESCE(_empresa, '')), '') IS NOT NULL THEN 'Empresa: ' || left(btrim(_empresa), 120) END, NULLIF(btrim(COALESCE(_mensagem, '')), '')), 2200), ''),
    jsonb_build_object('fonte', 'site', 'site_id', _s.id, 'client_id', _s.client_id, 'site', _s.nome, 'pagina', left(COALESCE(_pagina, ''), 200), 'empresa', left(COALESCE(_empresa, ''), 120))
      || CASE WHEN _q IS NOT NULL THEN jsonb_build_object('quiz', _q) ELSE '{}'::jsonb END,
    _o
  )
  RETURNING id INTO _lead;

  INSERT INTO public.commercial_lead_events (lead_id, kind, note)
  VALUES (_lead, 'nota', left('Chegou pelo formulário do site ' || _s.nome || COALESCE(' (' || NULLIF(_pagina, '') || ')', '') || '.'
    || COALESCE(' Quiz: faixa ' || (_q ->> 'faixa') || ' (pontuação ' || (_q ->> 'pontuacao') || ').', '')
    || COALESCE(' Clique do anúncio ' || (_o ->> 'ad_id') || ' da Meta.', CASE WHEN _o ? 'campaign_id' THEN ' Clique da campanha ' || (_o ->> 'campaign_id') || ' da Meta.' END, ''), 400));

  INSERT INTO public.site_formulario_envios (site_id, client_id, ip_hash, resultado, lead_id, pagina)
  VALUES (_s.id, _s.client_id, _ip_hash, 'aceito', _lead, left(_pagina, 200));

  RETURN jsonb_build_object('ok', true, 'lead_id', _lead);
END;
$body$;

REVOKE ALL ON FUNCTION public.site_registrar_lead(text, text, text, text, text, text, text, text, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.site_registrar_lead(text, text, text, text, text, text, text, text, text, jsonb, jsonb) TO service_role;

-- ════════════════════════════════════════════════════════════════════════
-- 3) Teste A/B: contagem por variante e dia
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.lab_ab_contagem (
  teste_id text NOT NULL CHECK (teste_id ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  variante text NOT NULL CHECK (variante ~ '^[a-z0-9][a-z0-9_-]{0,31}$'),
  tipo text NOT NULL CHECK (tipo IN ('visita', 'conversao')),
  dia date NOT NULL,
  total bigint NOT NULL DEFAULT 0 CHECK (total >= 0),
  PRIMARY KEY (teste_id, variante, tipo, dia)
);

-- Limite por IP (hash com sal, nunca o IP): janelas de 10 minutos.
CREATE TABLE IF NOT EXISTS public.lab_ab_limite (
  ip_hash text NOT NULL CHECK (char_length(ip_hash) BETWEEN 16 AND 128),
  janela timestamptz NOT NULL,
  total int NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, janela)
);
CREATE INDEX IF NOT EXISTS lab_ab_limite_janela_idx ON public.lab_ab_limite (janela);

COMMENT ON TABLE public.lab_ab_contagem IS
  'Teste A/B do Laboratório: visitas e conversões por variante e dia (America/Sao_Paulo). Escrita só por lab_ab_registrar (função ab-contar).';

ALTER TABLE public.lab_ab_contagem ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_ab_limite ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lab_ab_contagem FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.lab_ab_limite FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.lab_ab_contagem TO authenticated;
GRANT ALL ON public.lab_ab_contagem TO service_role;
GRANT ALL ON public.lab_ab_limite TO service_role;

DROP POLICY IF EXISTS lab_ab_contagem_equipe_le ON public.lab_ab_contagem;
CREATE POLICY lab_ab_contagem_equipe_le ON public.lab_ab_contagem
  FOR SELECT TO authenticated
  USING (COALESCE(public.is_staff((select auth.uid())), false));

CREATE OR REPLACE FUNCTION public.lab_ab_registrar(_teste_id text, _variante text, _tipo text, _ip_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _janela timestamptz;
  _n int;
  _dia date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF NOT app_private.rpc_trusted_backend() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'LAB_AB_SO_BACKEND';
  END IF;
  IF _teste_id IS NULL OR _teste_id !~ '^[a-z0-9][a-z0-9-]{2,62}$'
     OR _variante IS NULL OR _variante !~ '^[a-z0-9][a-z0-9_-]{0,31}$'
     OR _tipo IS NULL OR _tipo NOT IN ('visita', 'conversao')
     OR _ip_hash IS NULL OR char_length(_ip_hash) NOT BETWEEN 16 AND 128 THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'pedido_invalido');
  END IF;

  _janela := to_timestamp(floor(extract(epoch FROM now()) / 600) * 600);
  INSERT INTO public.lab_ab_limite AS l (ip_hash, janela, total) VALUES (_ip_hash, _janela, 1)
  ON CONFLICT (ip_hash, janela) DO UPDATE SET total = l.total + 1
  RETURNING total INTO _n;
  IF _n > 30 THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'limite');
  END IF;

  -- No máximo 5 variantes por teste (a ESPEC: 2 a 5): ninguém enche a tabela com variantes inventadas.
  IF NOT EXISTS (SELECT 1 FROM public.lab_ab_contagem c WHERE c.teste_id = _teste_id AND c.variante = _variante) THEN
    PERFORM pg_advisory_xact_lock(hashtext('lab_ab:' || _teste_id));
    IF (SELECT count(DISTINCT c.variante) FROM public.lab_ab_contagem c WHERE c.teste_id = _teste_id) >= 5
       AND NOT EXISTS (SELECT 1 FROM public.lab_ab_contagem c WHERE c.teste_id = _teste_id AND c.variante = _variante) THEN
      RETURN jsonb_build_object('ok', false, 'codigo', 'variantes_demais');
    END IF;
  END IF;

  INSERT INTO public.lab_ab_contagem AS c (teste_id, variante, tipo, dia, total)
  VALUES (_teste_id, _variante, _tipo, _dia, 1)
  ON CONFLICT (teste_id, variante, tipo, dia) DO UPDATE SET total = c.total + 1;

  -- Faxina leve das janelas velhas (1 em cada 100 chamadas).
  IF random() < 0.01 THEN
    DELETE FROM public.lab_ab_limite WHERE janela < now() - interval '1 day';
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$body$;

REVOKE ALL ON FUNCTION public.lab_ab_registrar(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lab_ab_registrar(text, text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';

-- Conferir depois de aplicar (só leitura):
-- select table_name from information_schema.tables where table_name in ('vendas_integracoes','vendas_eventos','lab_ab_contagem','lab_ab_limite');
-- select pg_get_function_identity_arguments(oid) from pg_proc where proname in ('site_registrar_lead','vendas_registrar_evento','lab_ab_registrar');
-- select has_function_privilege('anon', 'public.vendas_integracao_para_webhook(text,text)', 'execute'); -- false
