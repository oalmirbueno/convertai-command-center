-- 20/10/2026 (dono, com o print do Estúdio livre travado em "saldo US$ 0,00" enquanto o topo do Laboratório
-- mostrava US$ 4,65: "ainda tá com essa patifaria de créditos"). Eram duas carteiras: a do Estúdio livre
-- (zerada) e os Créditos do Laboratório. Agora a arte do Estúdio livre é cobrada dos Créditos do
-- Laboratório (lab_carteira), a mesma do topo. Limite desligado: só registra, nunca trava. Nunca toca
-- a carteira de cliente nem a da Aceleriq.

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
  _ativa boolean;
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

  -- Arte do Estúdio livre: a cobrança sai dos Créditos do Laboratório (a carteira do topo do Laboratório).
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
    INSERT INTO public.lab_carteira (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
    SELECT c.saldo_usd, c.ativa INTO _saldo, _ativa FROM public.lab_carteira AS c WHERE c.id = true FOR UPDATE;
    IF _ativa THEN
      _saldo := _saldo - _custo;
      UPDATE public.lab_carteira SET saldo_usd = _saldo, atualizado_em = now() WHERE id = true;
    END IF;
    IF _custo > 0 THEN
      INSERT INTO public.lab_creditos_movimentos (tipo, valor_usd, saldo_depois, debitado, nota, criado_por)
      VALUES ('uso', round(_custo, 6), _saldo, _ativa, left('Estúdio livre: ' || _tarefa || ' / ' || _agente || ' / ' || _modelo_id, 400), _criado_por);
    END IF;
    RETURN jsonb_build_object('uso_id', _uso_id, 'saldo_usd', _saldo, 'carteira', 'laboratorio');
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
