-- Mesa do cliente: chaves de API por cliente e cotas (SPEC.md, secao 2.1).
--
-- Cada cliente pode ter a propria chave de cada provedor, para o custo sair na
-- conta certa. Regras:
-- - o segredo mora so no Supabase Vault; a tabela guarda o vault_secret_id e os
--   4 ultimos caracteres (para exibir);
-- - salvar, trocar cota, desativar, listar e configurar: so admin ou manager
--   (este com acesso ao cliente); nem o backend faz isso sozinho;
-- - resolver a chave (unico caminho que devolve o segredo): so backend;
-- - nenhuma RPC acessivel a authenticated devolve o segredo;
-- - o uso de IA passa a registrar chave_origem (cliente ou agencia) e chave_id.
-- So acrescenta; a unica troca e a assinatura de ia_registrar_uso, criada hoje
-- em 20260922120000 e ainda sem chamador, que ganha os dois campos no fim.

-- ---------------------------------------------------------------------------
-- 1. Guarda: admin (qualquer cliente) ou manager com acesso ao cliente
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.ia_exigir_gestor_de_chaves(_client_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _ator uuid := auth.uid();
BEGIN
  IF _ator IS NULL OR NOT (
    COALESCE(public.has_role(_ator, 'admin'::public.app_role), false)
    OR (
      COALESCE(public.has_role(_ator, 'manager'::public.app_role), false)
      AND _client_id IS NOT NULL
      AND COALESCE(public.can_access_client(_client_id), false)
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'IA_CHAVES_SO_ADMIN_OU_MANAGER';
  END IF;
END;
$body$;

REVOKE ALL ON FUNCTION app_private.ia_exigir_gestor_de_chaves(uuid)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Tabelas
-- ---------------------------------------------------------------------------
CREATE TABLE public.ia_chaves_cliente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provedor text NOT NULL CHECK (provedor IN ('openai', 'anthropic', 'openrouter')),
  rotulo text,
  -- a chave mora no Vault; aqui so o ponteiro
  vault_secret_id uuid NOT NULL UNIQUE,
  -- ultimos 4 caracteres, so para exibir
  final_chave text NOT NULL CHECK (char_length(final_chave) BETWEEN 1 AND 4),
  -- nulo = sem teto
  cota_mensal_usd numeric CHECK (cota_mensal_usd IS NULL OR cota_mensal_usd >= 0),
  ativa boolean NOT NULL DEFAULT true,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ia_chaves_cliente_uma_ativa
  ON public.ia_chaves_cliente (client_id, provedor)
  WHERE ativa;
CREATE INDEX ia_chaves_cliente_cliente_idx
  ON public.ia_chaves_cliente (client_id);

CREATE TRIGGER ia_chaves_cliente_tocar
BEFORE UPDATE ON public.ia_chaves_cliente
FOR EACH ROW EXECUTE FUNCTION public.mesa_tocar_atualizado_em();

-- Linha apagada (so pela cascata da exclusao do cliente) leva o segredo junto.
CREATE OR REPLACE FUNCTION app_private.ia_chave_apagar_segredo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
BEGIN
  DELETE FROM vault.secrets WHERE id = OLD.vault_secret_id;
  RETURN OLD;
END;
$body$;

REVOKE ALL ON FUNCTION app_private.ia_chave_apagar_segredo()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER ia_chaves_cliente_apaga_segredo
AFTER DELETE ON public.ia_chaves_cliente
FOR EACH ROW EXECUTE FUNCTION app_private.ia_chave_apagar_segredo();

CREATE TABLE public.ia_clientes_config (
  client_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- enquanto o cliente nao tem chave propria, usa a da agencia; desligado,
  -- o cliente sem chave fica bloqueado
  usar_chave_agencia boolean NOT NULL DEFAULT true,
  observacao text,
  atualizado_por uuid,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER ia_clientes_config_tocar
BEFORE UPDATE ON public.ia_clientes_config
FOR EACH ROW EXECUTE FUNCTION public.mesa_tocar_atualizado_em();

ALTER TABLE public.ia_usos
  ADD COLUMN chave_origem text CHECK (chave_origem IN ('cliente', 'agencia')),
  ADD COLUMN chave_id uuid REFERENCES public.ia_chaves_cliente(id) ON DELETE SET NULL;

CREATE INDEX ia_usos_chave_criado_idx
  ON public.ia_usos (chave_id, criado_em)
  WHERE chave_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. RLS e privilegios: leitura so admin/manager; escrita so pelas RPCs
-- ---------------------------------------------------------------------------
ALTER TABLE public.ia_chaves_cliente ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ia_clientes_config ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ia_chaves_cliente, public.ia_clientes_config
  FROM PUBLIC, anon, authenticated, service_role;

CREATE POLICY ia_chaves_cliente_gestor_le
ON public.ia_chaves_cliente
FOR SELECT TO authenticated
USING (
  public.has_role((select auth.uid()), 'admin'::public.app_role)
  OR (
    public.has_role((select auth.uid()), 'manager'::public.app_role)
    AND public.can_access_client(client_id)
  )
);

CREATE POLICY ia_clientes_config_gestor_le
ON public.ia_clientes_config
FOR SELECT TO authenticated
USING (
  public.has_role((select auth.uid()), 'admin'::public.app_role)
  OR (
    public.has_role((select auth.uid()), 'manager'::public.app_role)
    AND public.can_access_client(client_id)
  )
);

-- Nem o ponteiro do Vault vai para o navegador: grant por coluna, sem ele.
GRANT SELECT (
  id, client_id, provedor, rotulo, final_chave, cota_mensal_usd,
  ativa, criado_por, criado_em, atualizado_em
) ON public.ia_chaves_cliente TO authenticated;
GRANT SELECT ON public.ia_clientes_config TO authenticated;
-- O motor le a configuracao do cliente e a lista pela chave de servico; o
-- segredo so sai por ia_chave_resolver.
GRANT SELECT ON public.ia_chaves_cliente, public.ia_clientes_config TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Gasto do mes de uma chave (mes do calendario de Sao Paulo)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.ia_gasto_mes_chave(_chave_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $body$
  SELECT COALESCE(sum(uso.custo_usd), 0)
  FROM public.ia_usos AS uso
  WHERE uso.chave_id = _chave_id
    AND uso.criado_em >= (
      date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))
      AT TIME ZONE 'America/Sao_Paulo'
    );
$body$;

REVOKE ALL ON FUNCTION app_private.ia_gasto_mes_chave(uuid)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. RPCs de gestao (so admin ou manager)
-- ---------------------------------------------------------------------------
-- 5.1 Cria a chave do provedor ou troca o segredo da ativa. Guarda so o final.
-- A cota enviada vale como a nova cota (nula = sem teto).
CREATE OR REPLACE FUNCTION public.ia_chave_salvar(
  _client_id uuid,
  _provedor text,
  _chave text,
  _rotulo text DEFAULT NULL,
  _cota_mensal_usd numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _ator uuid := auth.uid();
  _segredo text := btrim(COALESCE(_chave, ''));
  _atual public.ia_chaves_cliente%ROWTYPE;
  _secret_id uuid;
  _id uuid;
  _trocada boolean := false;
BEGIN
  PERFORM app_private.ia_exigir_gestor_de_chaves(_client_id);

  IF _provedor IS NULL OR _provedor NOT IN ('openai', 'anthropic', 'openrouter') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'IA_PROVEDOR_INVALIDO';
  END IF;
  IF char_length(_segredo) < 8 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'IA_CHAVE_INVALIDA';
  END IF;
  IF _cota_mensal_usd IS NOT NULL AND _cota_mensal_usd < 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'IA_COTA_INVALIDA';
  END IF;

  SELECT * INTO _atual
  FROM public.ia_chaves_cliente AS chave
  WHERE chave.client_id = _client_id
    AND chave.provedor = _provedor
    AND chave.ativa
  FOR UPDATE;

  IF FOUND THEN
    PERFORM vault.update_secret(_atual.vault_secret_id, _segredo, NULL, NULL, NULL);
    UPDATE public.ia_chaves_cliente
    SET final_chave = right(_segredo, 4),
        rotulo = COALESCE(NULLIF(btrim(_rotulo), ''), _atual.rotulo),
        cota_mensal_usd = _cota_mensal_usd
    WHERE id = _atual.id;
    _id := _atual.id;
    _trocada := true;
  ELSE
    SELECT vault.create_secret(
      _segredo,
      'ia-chave-' || _client_id::text || '-' || _provedor || '-' || gen_random_uuid()::text,
      'Chave de IA do cliente (Mesa do cliente)',
      NULL
    ) INTO _secret_id;
    INSERT INTO public.ia_chaves_cliente (
      client_id, provedor, rotulo, vault_secret_id, final_chave, cota_mensal_usd, criado_por
    )
    VALUES (
      _client_id, _provedor, NULLIF(btrim(_rotulo), ''), _secret_id,
      right(_segredo, 4), _cota_mensal_usd, _ator
    )
    RETURNING id INTO _id;
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'chave_id', chave.id,
      'provedor', chave.provedor,
      'rotulo', chave.rotulo,
      'final_chave', chave.final_chave,
      'cota_mensal_usd', chave.cota_mensal_usd,
      'ativa', chave.ativa,
      'trocada', _trocada
    )
    FROM public.ia_chaves_cliente AS chave
    WHERE chave.id = _id
  );
END;
$body$;

REVOKE ALL ON FUNCTION public.ia_chave_salvar(uuid, text, text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ia_chave_salvar(uuid, text, text, text, numeric)
  TO authenticated, service_role;

-- 5.2 Troca a cota do mes (nula = sem teto).
CREATE OR REPLACE FUNCTION public.ia_chave_cota(_chave_id uuid, _cota_mensal_usd numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _client_id uuid;
BEGIN
  -- Sem papel de gestor, nem a existencia da chave e revelada.
  IF auth.uid() IS NULL OR NOT (
    COALESCE(public.has_role(auth.uid(), 'admin'::public.app_role), false)
    OR COALESCE(public.has_role(auth.uid(), 'manager'::public.app_role), false)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'IA_CHAVES_SO_ADMIN_OU_MANAGER';
  END IF;

  SELECT chave.client_id INTO _client_id
  FROM public.ia_chaves_cliente AS chave
  WHERE chave.id = _chave_id
  FOR UPDATE;
  IF _client_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'IA_CHAVES_SO_ADMIN_OU_MANAGER';
  END IF;
  PERFORM app_private.ia_exigir_gestor_de_chaves(_client_id);

  IF _cota_mensal_usd IS NOT NULL AND _cota_mensal_usd < 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'IA_COTA_INVALIDA';
  END IF;

  UPDATE public.ia_chaves_cliente
  SET cota_mensal_usd = _cota_mensal_usd
  WHERE id = _chave_id;

  RETURN jsonb_build_object(
    'chave_id', _chave_id,
    'cota_mensal_usd', _cota_mensal_usd,
    'gasto_mes_usd', app_private.ia_gasto_mes_chave(_chave_id)
  );
END;
$body$;

REVOKE ALL ON FUNCTION public.ia_chave_cota(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ia_chave_cota(uuid, numeric) TO authenticated, service_role;

-- 5.3 Desativa a chave e inutiliza o segredo no Vault. A linha fica para o
-- historico de gasto; para voltar, salva-se uma chave nova.
CREATE OR REPLACE FUNCTION public.ia_chave_desativar(_chave_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _chave public.ia_chaves_cliente%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    COALESCE(public.has_role(auth.uid(), 'admin'::public.app_role), false)
    OR COALESCE(public.has_role(auth.uid(), 'manager'::public.app_role), false)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'IA_CHAVES_SO_ADMIN_OU_MANAGER';
  END IF;

  SELECT * INTO _chave
  FROM public.ia_chaves_cliente AS chave
  WHERE chave.id = _chave_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'IA_CHAVES_SO_ADMIN_OU_MANAGER';
  END IF;
  PERFORM app_private.ia_exigir_gestor_de_chaves(_chave.client_id);

  IF _chave.ativa THEN
    PERFORM vault.update_secret(
      _chave.vault_secret_id,
      'revogada:' || gen_random_uuid()::text,
      NULL,
      'Chave de IA do cliente desativada',
      NULL
    );
    UPDATE public.ia_chaves_cliente SET ativa = false WHERE id = _chave_id;
  END IF;

  RETURN jsonb_build_object('chave_id', _chave_id, 'ativa', false);
END;
$body$;

REVOKE ALL ON FUNCTION public.ia_chave_desativar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ia_chave_desativar(uuid) TO authenticated, service_role;

-- 5.4 Lista as chaves do cliente, sem segredo, com o gasto do mes de cada uma,
-- e a configuracao de uso da chave da agencia.
CREATE OR REPLACE FUNCTION public.ia_chaves_listar(_client_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $body$
BEGIN
  PERFORM app_private.ia_exigir_gestor_de_chaves(_client_id);

  RETURN jsonb_build_object(
    'client_id', _client_id,
    'usar_chave_agencia', COALESCE((
      SELECT config.usar_chave_agencia FROM public.ia_clientes_config AS config
      WHERE config.client_id = _client_id
    ), true),
    'observacao', (
      SELECT config.observacao FROM public.ia_clientes_config AS config
      WHERE config.client_id = _client_id
    ),
    'chaves', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', chave.id,
          'provedor', chave.provedor,
          'rotulo', chave.rotulo,
          'final_chave', chave.final_chave,
          'cota_mensal_usd', chave.cota_mensal_usd,
          'gasto_mes_usd', app_private.ia_gasto_mes_chave(chave.id),
          'ativa', chave.ativa,
          'criado_em', chave.criado_em,
          'atualizado_em', chave.atualizado_em
        )
        ORDER BY chave.ativa DESC, chave.provedor, chave.criado_em DESC
      )
      FROM public.ia_chaves_cliente AS chave
      WHERE chave.client_id = _client_id
    ), '[]'::jsonb)
  );
END;
$body$;

REVOKE ALL ON FUNCTION public.ia_chaves_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ia_chaves_listar(uuid) TO authenticated, service_role;

-- 5.5 Liga ou desliga o uso da chave da agencia para o cliente sem chave
-- propria. Observacao nula mantem a anterior.
CREATE OR REPLACE FUNCTION public.ia_cliente_config_salvar(
  _client_id uuid,
  _usar_chave_agencia boolean,
  _observacao text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _config public.ia_clientes_config%ROWTYPE;
BEGIN
  PERFORM app_private.ia_exigir_gestor_de_chaves(_client_id);

  IF _usar_chave_agencia IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'IA_CONFIG_INVALIDA';
  END IF;

  INSERT INTO public.ia_clientes_config AS config (
    client_id, usar_chave_agencia, observacao, atualizado_por
  )
  VALUES (_client_id, _usar_chave_agencia, NULLIF(btrim(_observacao), ''), auth.uid())
  ON CONFLICT (client_id) DO UPDATE
  SET usar_chave_agencia = EXCLUDED.usar_chave_agencia,
      observacao = COALESCE(EXCLUDED.observacao, config.observacao),
      atualizado_por = EXCLUDED.atualizado_por
  RETURNING * INTO _config;

  RETURN jsonb_build_object(
    'client_id', _config.client_id,
    'usar_chave_agencia', _config.usar_chave_agencia,
    'observacao', _config.observacao
  );
END;
$body$;

REVOKE ALL ON FUNCTION public.ia_cliente_config_salvar(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ia_cliente_config_salvar(uuid, boolean, text)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Resolver (so backend): unico caminho que devolve o segredo
-- ---------------------------------------------------------------------------
-- Devolve {chave_id, segredo, cota_mensal_usd, gasto_mes_usd} da chave ativa
-- do cliente para o provedor, ou {} quando nao ha chave propria.
CREATE OR REPLACE FUNCTION public.ia_chave_resolver(_client_id uuid, _provedor text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _resultado jsonb;
BEGIN
  IF NOT app_private.rpc_trusted_backend() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'IA_CHAVE_SO_BACKEND';
  END IF;

  SELECT jsonb_build_object(
    'chave_id', chave.id,
    'segredo', segredo.decrypted_secret,
    'cota_mensal_usd', chave.cota_mensal_usd,
    'gasto_mes_usd', app_private.ia_gasto_mes_chave(chave.id)
  )
  INTO _resultado
  FROM public.ia_chaves_cliente AS chave
  JOIN vault.decrypted_secrets AS segredo ON segredo.id = chave.vault_secret_id
  WHERE chave.client_id = _client_id
    AND chave.provedor = _provedor
    AND chave.ativa;

  RETURN COALESCE(_resultado, '{}'::jsonb);
END;
$body$;

REVOKE ALL ON FUNCTION public.ia_chave_resolver(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ia_chave_resolver(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Registro de uso ganha chave_origem e chave_id (so backend, como antes)
-- ---------------------------------------------------------------------------
DROP FUNCTION public.ia_registrar_uso(
  uuid, text, text, text, text, integer, integer, integer, integer,
  text, numeric, text, text, uuid, uuid
);

CREATE FUNCTION public.ia_registrar_uso(
  _client_id uuid,
  _tarefa text,
  _agente text,
  _modelo_id text,
  _provedor text,
  _tokens_entrada integer DEFAULT 0,
  _tokens_saida integer DEFAULT 0,
  _tokens_cache integer DEFAULT 0,
  _imagens integer DEFAULT 0,
  _qualidade text DEFAULT NULL,
  _custo_usd numeric DEFAULT 0,
  _custo_fonte text DEFAULT 'tabela',
  _referencia_tipo text DEFAULT NULL,
  _referencia_id uuid DEFAULT NULL,
  _criado_por uuid DEFAULT NULL,
  _chave_origem text DEFAULT NULL,
  _chave_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _uso_id uuid;
  _custo numeric := COALESCE(_custo_usd, 0);
  _saldo numeric;
BEGIN
  IF NOT app_private.rpc_trusted_backend() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'IA_USO_SO_BACKEND';
  END IF;

  IF _client_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'IA_CLIENTE_OBRIGATORIO';
  END IF;

  IF _custo < 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'IA_CUSTO_NEGATIVO';
  END IF;

  -- Chave do cliente exige o id da chave, e a chave tem de ser deste cliente
  -- (um uuid trocado nunca joga custo na conta de outro).
  IF _chave_origem = 'cliente' AND _chave_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'IA_CHAVE_ID_OBRIGATORIO';
  END IF;
  IF _chave_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.ia_chaves_cliente AS chave
    WHERE chave.id = _chave_id AND chave.client_id = _client_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'IA_CHAVE_DE_OUTRO_CLIENTE';
  END IF;

  INSERT INTO public.ia_usos (
    client_id, tarefa, agente, modelo_id, provedor,
    tokens_entrada, tokens_saida, tokens_cache, imagens, qualidade,
    custo_usd, custo_fonte, referencia_tipo, referencia_id, criado_por,
    chave_origem, chave_id
  )
  VALUES (
    _client_id, _tarefa, _agente, _modelo_id, _provedor,
    COALESCE(_tokens_entrada, 0), COALESCE(_tokens_saida, 0),
    COALESCE(_tokens_cache, 0), COALESCE(_imagens, 0), _qualidade,
    _custo, COALESCE(_custo_fonte, 'tabela'), _referencia_tipo, _referencia_id, _criado_por,
    _chave_origem, _chave_id
  )
  RETURNING id INTO _uso_id;

  IF _custo > 0 THEN
    INSERT INTO public.ia_carteira_movimentos (client_id, tipo, valor_usd, uso_id, observacao, criado_por)
    VALUES (_client_id, 'debito', -_custo, _uso_id, _tarefa || ' / ' || _agente || ' / ' || _modelo_id, _criado_por);
  END IF;

  INSERT INTO public.ia_carteiras AS carteira (client_id, saldo_usd, atualizado_em)
  VALUES (_client_id, -_custo, now())
  ON CONFLICT (client_id) DO UPDATE
  SET saldo_usd = carteira.saldo_usd + EXCLUDED.saldo_usd,
      atualizado_em = now()
  RETURNING carteira.saldo_usd INTO _saldo;

  RETURN jsonb_build_object('uso_id', _uso_id, 'saldo_usd', _saldo);
END;
$body$;

REVOKE ALL ON FUNCTION public.ia_registrar_uso(
  uuid, text, text, text, text, integer, integer, integer, integer,
  text, numeric, text, text, uuid, uuid, text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ia_registrar_uso(
  uuid, text, text, text, text, integer, integer, integer, integer,
  text, numeric, text, text, uuid, uuid, text, uuid
) TO service_role;
