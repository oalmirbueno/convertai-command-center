-- 19/10/2026 (dono: "coloque uma carteira separada só para o Estúdio livre, não pode misturar; a ideia
-- do Estúdio livre é não precisar criar cliente; o código é meu e quero isso"). Carteira própria do
-- Estúdio livre, sem cliente: a arte livre (sem marca) é registrada aqui e toda cobrança dela (diretor,
-- Jev, imagem, conferência) sai desta carteira, nunca da carteira da Aceleriq nem de outro cliente.
-- O trabalho continua guardado sob o cliente interno da agência (só para os arquivos e o acesso), mas o
-- relatório de consumo dele não conta o que é do Estúdio livre.

CREATE TABLE IF NOT EXISTS public.estudio_livre_carteira (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  saldo_usd numeric NOT NULL DEFAULT 0,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.estudio_livre_carteira (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.estudio_livre_movimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('debito', 'recarga')),
  valor_usd numeric NOT NULL,
  uso_id uuid,
  trabalho_id uuid,
  observacao text,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);

-- As artes livres (o servidor registra o id antes da primeira cobrança).
CREATE TABLE IF NOT EXISTS public.estudio_livre_trabalhos (
  trabalho_id uuid PRIMARY KEY,
  criado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.estudio_livre_carteira ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estudio_livre_movimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estudio_livre_trabalhos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.estudio_livre_carteira, public.estudio_livre_movimentos, public.estudio_livre_trabalhos FROM anon, authenticated;

-- De que carteira saiu o uso: 'cliente' (a de sempre) ou 'estudio_livre'.
ALTER TABLE public.ia_usos ADD COLUMN IF NOT EXISTS carteira text NOT NULL DEFAULT 'cliente';

CREATE OR REPLACE FUNCTION public.ia_registrar_uso(_client_id uuid, _tarefa text, _agente text, _modelo_id text, _provedor text, _tokens_entrada integer DEFAULT 0, _tokens_saida integer DEFAULT 0, _tokens_cache integer DEFAULT 0, _imagens integer DEFAULT 0, _qualidade text DEFAULT NULL::text, _custo_usd numeric DEFAULT 0, _custo_fonte text DEFAULT 'tabela'::text, _referencia_tipo text DEFAULT NULL::text, _referencia_id uuid DEFAULT NULL::uuid, _criado_por uuid DEFAULT NULL::uuid, _chave_origem text DEFAULT NULL::text, _chave_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _uso_id uuid;
  _custo numeric := COALESCE(_custo_usd, 0);
  _saldo numeric;
  _livre boolean;
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

  -- Arte do Estúdio livre: a cobrança sai da carteira própria dele.
  _livre := _referencia_tipo = 'estudio_trabalho' AND _referencia_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.estudio_livre_trabalhos AS l WHERE l.trabalho_id = _referencia_id);

  INSERT INTO public.ia_usos (
    client_id, tarefa, agente, modelo_id, provedor,
    tokens_entrada, tokens_saida, tokens_cache, imagens, qualidade,
    custo_usd, custo_fonte, referencia_tipo, referencia_id, criado_por,
    chave_origem, chave_id, carteira
  )
  VALUES (
    _client_id, _tarefa, _agente, _modelo_id, _provedor,
    COALESCE(_tokens_entrada, 0), COALESCE(_tokens_saida, 0),
    COALESCE(_tokens_cache, 0), COALESCE(_imagens, 0), _qualidade,
    _custo, COALESCE(_custo_fonte, 'tabela'), _referencia_tipo, _referencia_id, _criado_por,
    _chave_origem, _chave_id, CASE WHEN _livre THEN 'estudio_livre' ELSE 'cliente' END
  )
  RETURNING id INTO _uso_id;

  IF _livre THEN
    IF _custo > 0 THEN
      INSERT INTO public.estudio_livre_movimentos (tipo, valor_usd, uso_id, trabalho_id, observacao, criado_por)
      VALUES ('debito', -_custo, _uso_id, _referencia_id, _tarefa || ' / ' || _agente || ' / ' || _modelo_id, _criado_por);
    END IF;
    UPDATE public.estudio_livre_carteira SET saldo_usd = saldo_usd - _custo, atualizado_em = now()
    WHERE id RETURNING saldo_usd INTO _saldo;
    RETURN jsonb_build_object('uso_id', _uso_id, 'saldo_usd', _saldo, 'carteira', 'estudio_livre');
  END IF;

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
$function$;

-- O consumo do cliente não conta o que saiu da carteira do Estúdio livre.
DO $$
DECLARE def text; novo text;
BEGIN
  def := pg_get_functiondef('public.ia_consumo_cliente(uuid,date)'::regprocedure);
  novo := replace(def, 'WHERE uso.client_id = _client_id', 'WHERE uso.client_id = _client_id AND uso.carteira = ''cliente''');
  IF novo <> def THEN EXECUTE novo; END IF;
END $$;

-- Saldo e gasto do mês do Estúdio livre (equipe).
CREATE OR REPLACE FUNCTION public.estudio_livre_saldo()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  _inicio timestamptz := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::timestamp AT TIME ZONE 'America/Sao_Paulo';
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ESTUDIO_LIVRE_SO_EQUIPE';
  END IF;
  RETURN jsonb_build_object(
    'saldo_usd', COALESCE((SELECT c.saldo_usd FROM public.estudio_livre_carteira AS c WHERE c.id), 0),
    'gasto_mes_usd', COALESCE((SELECT -sum(m.valor_usd) FROM public.estudio_livre_movimentos AS m WHERE m.tipo = 'debito' AND m.criado_em >= _inicio), 0),
    'recargas_mes_usd', COALESCE((SELECT sum(m.valor_usd) FROM public.estudio_livre_movimentos AS m WHERE m.tipo = 'recarga' AND m.criado_em >= _inicio), 0)
  );
END;
$function$;

-- Recarga da carteira do Estúdio livre (só admin), como a recarga da carteira de cliente.
CREATE OR REPLACE FUNCTION public.estudio_livre_recarregar(_valor_usd numeric, _observacao text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  _saldo numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ESTUDIO_LIVRE_RECARGA_SO_ADMIN';
  END IF;
  IF _valor_usd IS NULL OR _valor_usd <= 0 OR _valor_usd > 1000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ESTUDIO_LIVRE_VALOR_INVALIDO';
  END IF;
  INSERT INTO public.estudio_livre_movimentos (tipo, valor_usd, observacao, criado_por)
  VALUES ('recarga', _valor_usd, NULLIF(btrim(COALESCE(_observacao, '')), ''), auth.uid());
  UPDATE public.estudio_livre_carteira SET saldo_usd = saldo_usd + _valor_usd, atualizado_em = now()
  WHERE id RETURNING saldo_usd INTO _saldo;
  RETURN jsonb_build_object('saldo_usd', _saldo);
END;
$function$;

REVOKE ALL ON FUNCTION public.estudio_livre_saldo() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.estudio_livre_recarregar(numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.estudio_livre_saldo() TO authenticated;
GRANT EXECUTE ON FUNCTION public.estudio_livre_recarregar(numeric, text) TO authenticated;
