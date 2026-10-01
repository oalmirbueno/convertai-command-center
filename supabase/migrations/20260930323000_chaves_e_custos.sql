-- Configurações › Chaves e custos (frente CHV, 01/10/2026).
--
-- Pedido do dono: cadastrar todas as chaves de provedor pelo admin, testar se
-- valem e ver o custo embaixo. Regras:
-- - o segredo mora só no Supabase Vault; a tabela guarda o ponteiro e os 4
--   últimos caracteres;
-- - nada aqui é lido ou escrito pelo navegador: só a função chaves-admin (que
--   confere has_role admin) e as funções do servidor, pela service_role;
-- - a lógica fica em app_private (SECURITY DEFINER); o que o PostgREST expõe
--   são invólucros em public, executáveis só pela service_role;
-- - a auditoria guarda só "chave X trocada por fulano", nunca o valor;
-- - o segredo do ambiente das funções (Deno.env) continua valendo e tem
--   prioridade sobre o do cofre (_shared/chaves.ts).
-- Só acrescenta. Idempotente.

-- ---------------------------------------------------------------------------
-- 1. Tabelas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chaves_cofre (
  -- nome do segredo, o mesmo do ambiente das funções (ex.: FAL_KEY)
  nome text PRIMARY KEY CHECK (nome IN (
    'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY',
    'ELEVENLABS_API_KEY', 'FAL_KEY', 'TYPESAFE_API_KEY', 'RESEND_API_KEY',
    'VERCEL_TOKEN', 'RUNWAYML_API_SECRET', 'HEYGEN_API_KEY', 'HIGGSFIELD_API_KEY',
    'HIGGSFIELD_API_SECRET', 'SECOND_BRAIN_GITHUB_TOKEN', 'OPENART_API_KEY'
  )),
  provedor text NOT NULL CHECK (provedor ~ '^[a-z0-9_]{2,40}$'),
  -- a chave mora no Vault; aqui só o ponteiro
  vault_secret_id uuid NOT NULL UNIQUE,
  -- últimos 4 caracteres, só para exibir
  final_chave text NOT NULL CHECK (char_length(final_chave) BETWEEN 1 AND 4),
  atualizado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chaves_cofre_provedor_idx ON public.chaves_cofre (provedor);

-- Último teste de cada provedor (a chave em uso naquela hora).
CREATE TABLE IF NOT EXISTS public.chaves_testes (
  provedor text PRIMARY KEY CHECK (provedor ~ '^[a-z0-9_]{2,40}$'),
  estado text NOT NULL CHECK (estado IN ('valida', 'invalida', 'nao_testada')),
  -- de onde veio a chave testada: segredo do servidor ou cofre do painel
  origem text NOT NULL CHECK (origem IN ('servidor', 'painel')),
  final_chave text CHECK (final_chave IS NULL OR char_length(final_chave) BETWEEN 1 AND 4),
  -- mensagem curta e números (saldo, uso); nunca a chave
  resultado jsonb NOT NULL DEFAULT '{}'::jsonb,
  testada_por uuid,
  testada_em timestamptz NOT NULL DEFAULT now()
);

-- Auditoria: quem cadastrou, trocou ou removeu. Sem valor de chave.
CREATE TABLE IF NOT EXISTS public.chaves_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provedor text NOT NULL CHECK (provedor ~ '^[a-z0-9_]{2,40}$'),
  acao text NOT NULL CHECK (acao IN ('cadastrada', 'trocada', 'removida')),
  estado text CHECK (estado IS NULL OR estado IN ('valida', 'invalida', 'nao_testada')),
  ator uuid,
  ator_nome text CHECK (ator_nome IS NULL OR char_length(ator_nome) <= 120),
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chaves_eventos_criado_idx ON public.chaves_eventos (criado_em DESC);

-- Aviso de saldo baixo por provedor (começa em US$ 10; o admin ajusta).
CREATE TABLE IF NOT EXISTS public.chaves_alertas (
  provedor text PRIMARY KEY CHECK (provedor ~ '^[a-z0-9_]{2,40}$'),
  saldo_minimo_usd numeric NOT NULL DEFAULT 10 CHECK (saldo_minimo_usd >= 0 AND saldo_minimo_usd <= 100000),
  atualizado_por uuid,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS chaves_cofre_tocar ON public.chaves_cofre;
CREATE TRIGGER chaves_cofre_tocar
BEFORE UPDATE ON public.chaves_cofre
FOR EACH ROW EXECUTE FUNCTION public.mesa_tocar_atualizado_em();

-- ---------------------------------------------------------------------------
-- 2. RLS e privilégios: ninguém do navegador lê nem escreve
-- ---------------------------------------------------------------------------
ALTER TABLE public.chaves_cofre ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chaves_testes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chaves_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chaves_alertas ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.chaves_cofre, public.chaves_testes, public.chaves_eventos, public.chaves_alertas
  FROM PUBLIC, anon, authenticated;
-- A service_role só lê; toda escrita passa pelas funções abaixo.
REVOKE ALL ON TABLE public.chaves_cofre, public.chaves_testes, public.chaves_eventos, public.chaves_alertas
  FROM service_role;
GRANT SELECT ON TABLE public.chaves_testes, public.chaves_eventos, public.chaves_alertas TO service_role;
-- Nem o ponteiro do Vault sai: grant por coluna.
GRANT SELECT (nome, provedor, final_chave, atualizado_por, criado_em, atualizado_em)
  ON public.chaves_cofre TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Lógica (app_private, SECURITY DEFINER, sem acesso de fora)
-- ---------------------------------------------------------------------------
-- 3.1 Grava (cria ou troca) os segredos de um provedor e registra o teste e o
-- evento, tudo na mesma transação. _valores = {"NOME": "segredo", ...}.
CREATE OR REPLACE FUNCTION app_private.chaves_salvar(
  _provedor text,
  _valores jsonb,
  _teste jsonb,
  _ator uuid,
  _ator_nome text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _nome text;
  _segredo text;
  _atual public.chaves_cofre%ROWTYPE;
  _secret_id uuid;
  _trocada boolean := false;
  _salvos text[] := ARRAY[]::text[];
  _estado text := COALESCE(NULLIF(_teste->>'estado', ''), 'nao_testada');
BEGIN
  IF _provedor IS NULL OR _provedor !~ '^[a-z0-9_]{2,40}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CHAVES_PROVEDOR_INVALIDO';
  END IF;
  IF _valores IS NULL OR jsonb_typeof(_valores) <> 'object' OR _valores = '{}'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CHAVES_SEM_VALOR';
  END IF;
  IF _estado NOT IN ('valida', 'invalida', 'nao_testada') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CHAVES_ESTADO_INVALIDO';
  END IF;

  FOR _nome, _segredo IN SELECT chave, valor FROM jsonb_each_text(_valores) AS t(chave, valor) LOOP
    _segredo := btrim(COALESCE(_segredo, ''));
    IF char_length(_segredo) < 8 OR char_length(_segredo) > 4096 OR _segredo ~ '\s' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CHAVES_VALOR_INVALIDO';
    END IF;

    SELECT * INTO _atual FROM public.chaves_cofre AS c WHERE c.nome = _nome FOR UPDATE;
    IF FOUND THEN
      PERFORM vault.update_secret(_atual.vault_secret_id, _segredo, NULL, NULL, NULL);
      UPDATE public.chaves_cofre
      SET final_chave = right(_segredo, 4), provedor = _provedor, atualizado_por = _ator
      WHERE nome = _nome;
      _trocada := true;
    ELSE
      SELECT vault.create_secret(
        _segredo,
        'chave-provedor-' || lower(_nome) || '-' || gen_random_uuid()::text,
        'Chave de provedor (Configurações, Chaves e custos)',
        NULL
      ) INTO _secret_id;
      -- O CHECK de nome barra o que não está no catálogo.
      INSERT INTO public.chaves_cofre (nome, provedor, vault_secret_id, final_chave, atualizado_por)
      VALUES (_nome, _provedor, _secret_id, right(_segredo, 4), _ator);
    END IF;
    _salvos := _salvos || _nome;
  END LOOP;

  INSERT INTO public.chaves_testes AS t (provedor, estado, origem, final_chave, resultado, testada_por, testada_em)
  VALUES (
    _provedor, _estado, 'painel',
    NULLIF(left(COALESCE(_teste->>'final_chave', ''), 4), ''),
    COALESCE(_teste->'resultado', '{}'::jsonb),
    _ator, now()
  )
  ON CONFLICT (provedor) DO UPDATE
  SET estado = EXCLUDED.estado, origem = EXCLUDED.origem, final_chave = EXCLUDED.final_chave,
      resultado = EXCLUDED.resultado, testada_por = EXCLUDED.testada_por, testada_em = EXCLUDED.testada_em;

  INSERT INTO public.chaves_eventos (provedor, acao, estado, ator, ator_nome)
  VALUES (_provedor, CASE WHEN _trocada THEN 'trocada' ELSE 'cadastrada' END, _estado, _ator, left(NULLIF(btrim(_ator_nome), ''), 120));

  RETURN jsonb_build_object('provedor', _provedor, 'nomes', to_jsonb(_salvos), 'trocada', _trocada, 'estado', _estado);
END;
$body$;

REVOKE ALL ON FUNCTION app_private.chaves_salvar(text, jsonb, jsonb, uuid, text) FROM PUBLIC, anon, authenticated;

-- 3.2 Remove os segredos de um provedor do cofre (o segredo do servidor, se
-- houver, continua valendo: ele não mora aqui).
CREATE OR REPLACE FUNCTION app_private.chaves_remover(_provedor text, _ator uuid, _ator_nome text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _linha public.chaves_cofre%ROWTYPE;
  _removidos text[] := ARRAY[]::text[];
BEGIN
  FOR _linha IN SELECT * FROM public.chaves_cofre AS c WHERE c.provedor = _provedor FOR UPDATE LOOP
    DELETE FROM vault.secrets WHERE id = _linha.vault_secret_id;
    DELETE FROM public.chaves_cofre WHERE nome = _linha.nome;
    _removidos := _removidos || _linha.nome;
  END LOOP;
  IF array_length(_removidos, 1) IS NULL THEN
    RETURN jsonb_build_object('provedor', _provedor, 'nomes', '[]'::jsonb);
  END IF;
  DELETE FROM public.chaves_testes WHERE provedor = _provedor AND origem = 'painel';
  INSERT INTO public.chaves_eventos (provedor, acao, ator, ator_nome)
  VALUES (_provedor, 'removida', _ator, left(NULLIF(btrim(_ator_nome), ''), 120));
  RETURN jsonb_build_object('provedor', _provedor, 'nomes', to_jsonb(_removidos));
END;
$body$;

REVOKE ALL ON FUNCTION app_private.chaves_remover(text, uuid, text) FROM PUBLIC, anon, authenticated;

-- 3.3 Guarda o resultado de um teste (botão Testar), sem tocar no cofre.
CREATE OR REPLACE FUNCTION app_private.chaves_registrar_teste(
  _provedor text,
  _estado text,
  _origem text,
  _final_chave text,
  _resultado jsonb,
  _ator uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
BEGIN
  IF _provedor IS NULL OR _provedor !~ '^[a-z0-9_]{2,40}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CHAVES_PROVEDOR_INVALIDO';
  END IF;
  INSERT INTO public.chaves_testes AS t (provedor, estado, origem, final_chave, resultado, testada_por, testada_em)
  VALUES (_provedor, _estado, _origem, NULLIF(left(COALESCE(_final_chave, ''), 4), ''), COALESCE(_resultado, '{}'::jsonb), _ator, now())
  ON CONFLICT (provedor) DO UPDATE
  SET estado = EXCLUDED.estado, origem = EXCLUDED.origem, final_chave = EXCLUDED.final_chave,
      resultado = EXCLUDED.resultado, testada_por = EXCLUDED.testada_por, testada_em = EXCLUDED.testada_em;
  RETURN jsonb_build_object('provedor', _provedor, 'estado', _estado);
END;
$body$;

REVOKE ALL ON FUNCTION app_private.chaves_registrar_teste(text, text, text, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;

-- 3.4 O que a tela mostra: o que está no cofre (sem segredo), o último teste
-- de cada provedor, o gasto da agência no mês por provedor (ia_usos, mês de
-- São Paulo, sem o que saiu na chave própria do cliente), os avisos de saldo,
-- o gasto do mês por cliente com a carteira de IA e os últimos eventos.
CREATE OR REPLACE FUNCTION app_private.chaves_listar()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $body$
  SELECT jsonb_build_object(
    'cofre', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'nome', c.nome, 'provedor', c.provedor, 'final_chave', c.final_chave,
        'atualizado_em', c.atualizado_em
      ) ORDER BY c.nome)
      FROM public.chaves_cofre AS c
    ), '[]'::jsonb),
    'testes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'provedor', t.provedor, 'estado', t.estado, 'origem', t.origem,
        'final_chave', t.final_chave, 'resultado', t.resultado, 'testada_em', t.testada_em
      ))
      FROM public.chaves_testes AS t
    ), '[]'::jsonb),
    'gasto_mes', COALESCE((
      SELECT jsonb_object_agg(g.provedor, g.usd)
      FROM (
        SELECT uso.provedor, round(sum(uso.custo_usd)::numeric, 4) AS usd
        FROM public.ia_usos AS uso
        WHERE uso.criado_em >= (
            date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')) AT TIME ZONE 'America/Sao_Paulo'
          )
          AND uso.chave_origem IS DISTINCT FROM 'cliente'
        GROUP BY uso.provedor
      ) AS g
    ), '{}'::jsonb),
    'alertas', COALESCE((
      SELECT jsonb_object_agg(a.provedor, a.saldo_minimo_usd) FROM public.chaves_alertas AS a
    ), '{}'::jsonb),
    -- Gasto do mês por cliente (todas as chaves), com o saldo da carteira de IA.
    'por_cliente', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'client_id', c.client_id, 'nome', c.nome, 'mes_usd', c.usd, 'carteira_usd', c.carteira
      ) ORDER BY c.usd DESC)
      FROM (
        SELECT uso.client_id,
               left(COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.company_name), ''), 'cliente sem nome'), 80) AS nome,
               round(sum(uso.custo_usd)::numeric, 4) AS usd,
               (SELECT round(cart.saldo_usd::numeric, 4) FROM public.ia_carteiras AS cart WHERE cart.client_id = uso.client_id) AS carteira
        FROM public.ia_usos AS uso
        LEFT JOIN public.profiles AS p ON p.id = uso.client_id
        WHERE uso.client_id IS NOT NULL
          AND uso.criado_em >= (
            date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')) AT TIME ZONE 'America/Sao_Paulo'
          )
        GROUP BY uso.client_id, p.full_name, p.company_name
        ORDER BY 3 DESC
        LIMIT 40
      ) AS c
    ), '[]'::jsonb),
    'eventos', COALESCE((
      SELECT jsonb_agg(e.linha ORDER BY e.criado_em DESC)
      FROM (
        SELECT ev.criado_em, jsonb_build_object(
          'provedor', ev.provedor, 'acao', ev.acao, 'estado', ev.estado,
          'ator_nome', ev.ator_nome, 'criado_em', ev.criado_em
        ) AS linha
        FROM public.chaves_eventos AS ev
        ORDER BY ev.criado_em DESC
        LIMIT 12
      ) AS e
    ), '[]'::jsonb)
  );
$body$;

REVOKE ALL ON FUNCTION app_private.chaves_listar() FROM PUBLIC, anon, authenticated;

-- 3.5 Lê segredos do cofre por nome (único caminho que devolve o valor).
CREATE OR REPLACE FUNCTION app_private.chaves_ler(_nomes text[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $body$
  SELECT COALESCE(jsonb_object_agg(c.nome, s.decrypted_secret), '{}'::jsonb)
  FROM public.chaves_cofre AS c
  JOIN vault.decrypted_secrets AS s ON s.id = c.vault_secret_id
  WHERE c.nome = ANY (COALESCE(_nomes, ARRAY[]::text[]));
$body$;

REVOKE ALL ON FUNCTION app_private.chaves_ler(text[]) FROM PUBLIC, anon, authenticated;

-- 3.6 Ajusta o aviso de saldo baixo de um provedor.
CREATE OR REPLACE FUNCTION app_private.chaves_alerta(_provedor text, _saldo_minimo_usd numeric, _ator uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
BEGIN
  IF _provedor IS NULL OR _provedor !~ '^[a-z0-9_]{2,40}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CHAVES_PROVEDOR_INVALIDO';
  END IF;
  IF _saldo_minimo_usd IS NULL OR _saldo_minimo_usd < 0 OR _saldo_minimo_usd > 100000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CHAVES_ALERTA_INVALIDO';
  END IF;
  INSERT INTO public.chaves_alertas AS a (provedor, saldo_minimo_usd, atualizado_por, atualizado_em)
  VALUES (_provedor, round(_saldo_minimo_usd, 2), _ator, now())
  ON CONFLICT (provedor) DO UPDATE
  SET saldo_minimo_usd = EXCLUDED.saldo_minimo_usd, atualizado_por = EXCLUDED.atualizado_por, atualizado_em = EXCLUDED.atualizado_em;
  RETURN jsonb_build_object('provedor', _provedor, 'saldo_minimo_usd', round(_saldo_minimo_usd, 2));
END;
$body$;

REVOKE ALL ON FUNCTION app_private.chaves_alerta(text, numeric, uuid) FROM PUBLIC, anon, authenticated;

-- 3.7 Uso dos últimos 7 dias por agente (para estimar o custo semanal ao
-- trocar o modelo padrão de um papel, em Modelos de IA). Só números.
CREATE OR REPLACE FUNCTION app_private.chaves_uso_semana()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $body$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'agente', u.agente, 'chamadas', u.chamadas, 'tokens_entrada', u.entrada, 'tokens_saida', u.saida,
    'tokens_cache', u.cache, 'imagens', u.imagens, 'custo_usd', u.usd
  ) ORDER BY u.usd DESC), '[]'::jsonb)
  FROM (
    SELECT uso.agente, count(*)::int AS chamadas,
           COALESCE(sum(uso.tokens_entrada), 0)::bigint AS entrada,
           COALESCE(sum(uso.tokens_saida), 0)::bigint AS saida,
           COALESCE(sum(uso.tokens_cache), 0)::bigint AS cache,
           COALESCE(sum(uso.imagens), 0)::bigint AS imagens,
           round(COALESCE(sum(uso.custo_usd), 0)::numeric, 4) AS usd
    FROM public.ia_usos AS uso
    WHERE uso.criado_em >= now() - interval '7 days'
    GROUP BY uso.agente
  ) AS u;
$body$;

REVOKE ALL ON FUNCTION app_private.chaves_uso_semana() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Invólucros expostos ao PostgREST: só a service_role executa
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chaves_admin_salvar(
  _provedor text, _valores jsonb, _teste jsonb, _ator uuid, _ator_nome text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
BEGIN
  IF NOT app_private.rpc_trusted_backend() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CHAVES_SO_SERVIDOR';
  END IF;
  RETURN app_private.chaves_salvar(_provedor, _valores, _teste, _ator, _ator_nome);
END;
$body$;

CREATE OR REPLACE FUNCTION public.chaves_admin_remover(_provedor text, _ator uuid, _ator_nome text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
BEGIN
  IF NOT app_private.rpc_trusted_backend() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CHAVES_SO_SERVIDOR';
  END IF;
  RETURN app_private.chaves_remover(_provedor, _ator, _ator_nome);
END;
$body$;

CREATE OR REPLACE FUNCTION public.chaves_admin_registrar_teste(
  _provedor text, _estado text, _origem text, _final_chave text, _resultado jsonb, _ator uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
BEGIN
  IF NOT app_private.rpc_trusted_backend() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CHAVES_SO_SERVIDOR';
  END IF;
  RETURN app_private.chaves_registrar_teste(_provedor, _estado, _origem, _final_chave, _resultado, _ator);
END;
$body$;

CREATE OR REPLACE FUNCTION public.chaves_admin_listar()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $body$
BEGIN
  IF NOT app_private.rpc_trusted_backend() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CHAVES_SO_SERVIDOR';
  END IF;
  RETURN app_private.chaves_listar();
END;
$body$;

CREATE OR REPLACE FUNCTION public.chaves_do_cofre(_nomes text[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $body$
BEGIN
  IF NOT app_private.rpc_trusted_backend() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CHAVES_SO_SERVIDOR';
  END IF;
  RETURN app_private.chaves_ler(_nomes);
END;
$body$;

CREATE OR REPLACE FUNCTION public.chaves_admin_alerta(_provedor text, _saldo_minimo_usd numeric, _ator uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
BEGIN
  IF NOT app_private.rpc_trusted_backend() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CHAVES_SO_SERVIDOR';
  END IF;
  RETURN app_private.chaves_alerta(_provedor, _saldo_minimo_usd, _ator);
END;
$body$;

CREATE OR REPLACE FUNCTION public.chaves_admin_uso_semana()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $body$
BEGIN
  IF NOT app_private.rpc_trusted_backend() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CHAVES_SO_SERVIDOR';
  END IF;
  RETURN app_private.chaves_uso_semana();
END;
$body$;

REVOKE ALL ON FUNCTION public.chaves_admin_salvar(text, jsonb, jsonb, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chaves_admin_remover(text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chaves_admin_registrar_teste(text, text, text, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chaves_admin_listar() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chaves_do_cofre(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chaves_admin_alerta(text, numeric, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chaves_admin_uso_semana() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.chaves_admin_salvar(text, jsonb, jsonb, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.chaves_admin_remover(text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.chaves_admin_registrar_teste(text, text, text, text, jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.chaves_admin_listar() TO service_role;
GRANT EXECUTE ON FUNCTION public.chaves_do_cofre(text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.chaves_admin_alerta(text, numeric, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.chaves_admin_uso_semana() TO service_role;

COMMENT ON TABLE public.chaves_cofre IS
  'Chaves de provedor cadastradas pelo admin (Configurações, Chaves e custos). O segredo mora no Vault; aqui só o ponteiro e os 4 últimos caracteres. Só a service_role lê, sem o ponteiro.';
COMMENT ON FUNCTION public.chaves_do_cofre(text[]) IS
  'Só backend (service_role): devolve {nome: segredo} das chaves do cofre. Usado por _shared/chaves.ts quando o segredo não está no ambiente da função.';
