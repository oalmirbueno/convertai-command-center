-- Créditos do Laboratório (20/10/2026, pedido do dono: "ter o crédito no Laboratório, poder carregar aqui
-- dentro, para não misturar com os outros").
--
-- Uma carteira só da agência para o Laboratório, separada da carteira de IA dos clientes (ia_carteira).
-- O motor de IA continua cobrando a carteira de sempre; aqui fica o limite e o extrato do Laboratório.
--
-- Regras:
-- * lab_carteira tem UMA linha (id = true). Nasce INATIVA: só registra o uso, sem bloquear (nada para de
--   funcionar). Fica ativa quando o dono carrega crédito pela primeira vez. O admin pode desligar o limite.
-- * Ativa: a confirmação de rodar reserva (debita) o custo estimado; sem saldo, devolve 'sem_credito' e nada roda.
-- * Falha não cobra: a função estorna o que reservou para o nó que falhou ou não rodou.
-- * Carga é registro manual (sem pagamento nem cartão), com quem e quando. Valor de 1 a 10.000 (US$).
-- * A equipe (is_staff) lê; escrita só pela função laboratorio (chave de serviço) pelas RPCs abaixo.
--
-- Idempotente e só amplia. Nada é apagado.

-- ─── 1) Carteira do Laboratório (uma linha) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lab_carteira (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  saldo_usd numeric(14,6) NOT NULL DEFAULT 0,
  ativa boolean NOT NULL DEFAULT false,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid
);

INSERT INTO public.lab_carteira (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- ─── 2) Extrato ─────────────────────────────────────────────────────────────
-- debitado: o movimento mudou o saldo (uso com a carteira ativa, ou o estorno dele).
-- reserva_id: no estorno, o uso que ele devolve (nunca devolve mais do que o uso reservou).
CREATE TABLE IF NOT EXISTS public.lab_creditos_movimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('carga', 'uso', 'estorno', 'ajuste')),
  valor_usd numeric(14,6) NOT NULL CHECK (valor_usd >= 0),
  saldo_depois numeric(14,6) NOT NULL,
  debitado boolean NOT NULL DEFAULT false,
  projeto_id uuid REFERENCES public.lab_projetos(id) ON DELETE SET NULL,
  execucao_id uuid,
  reserva_id uuid REFERENCES public.lab_creditos_movimentos(id) ON DELETE SET NULL,
  nota text CHECK (nota IS NULL OR char_length(nota) <= 400),
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lab_creditos_movimentos_data_idx ON public.lab_creditos_movimentos (criado_em DESC);
CREATE INDEX IF NOT EXISTS lab_creditos_movimentos_projeto_idx ON public.lab_creditos_movimentos (projeto_id, criado_em DESC) WHERE projeto_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS lab_creditos_movimentos_reserva_idx ON public.lab_creditos_movimentos (reserva_id) WHERE reserva_id IS NOT NULL;

-- ─── 3) RLS: a equipe lê; escrita só pela função (chave de serviço) ─────────
ALTER TABLE public.lab_carteira ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_creditos_movimentos ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.lab_carteira FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.lab_creditos_movimentos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.lab_carteira TO authenticated;
GRANT SELECT ON public.lab_creditos_movimentos TO authenticated;
GRANT ALL ON public.lab_carteira TO service_role;
GRANT ALL ON public.lab_creditos_movimentos TO service_role;

DROP POLICY IF EXISTS lab_carteira_equipe_le ON public.lab_carteira;
CREATE POLICY lab_carteira_equipe_le ON public.lab_carteira
  FOR SELECT TO authenticated
  USING (COALESCE(public.is_staff((select auth.uid())), false));

DROP POLICY IF EXISTS lab_creditos_movimentos_equipe_le ON public.lab_creditos_movimentos;
CREATE POLICY lab_creditos_movimentos_equipe_le ON public.lab_creditos_movimentos
  FOR SELECT TO authenticated
  USING (
    COALESCE(public.is_staff((select auth.uid())), false)
    AND (
      projeto_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.lab_projetos p
        WHERE p.id = lab_creditos_movimentos.projeto_id
          AND (p.client_id IS NULL OR COALESCE(public.can_access_client(p.client_id), false))
      )
    )
  );

-- ─── 4) Carregar (só admin; registro manual) ────────────────────────────────
-- A primeira carga liga o limite. Depois disso, ligar ou desligar é com lab_creditos_limite.
CREATE OR REPLACE FUNCTION public.lab_creditos_carregar(p_valor numeric, p_nota text, p_ator uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  _c public.lab_carteira;
  _valor numeric := round(COALESCE(p_valor, 0), 6);
  _primeira boolean;
  _depois numeric;
  _ativa boolean;
  _mov uuid;
BEGIN
  IF p_ator IS NULL OR NOT COALESCE(public.has_role(p_ator, 'admin'::public.app_role), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'LAB_CREDITOS_SO_ADMIN';
  END IF;
  IF _valor < 1 OR _valor > 10000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'LAB_CREDITOS_VALOR_INVALIDO';
  END IF;

  INSERT INTO public.lab_carteira (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
  SELECT * INTO _c FROM public.lab_carteira WHERE id = true FOR UPDATE;

  _primeira := NOT EXISTS (SELECT 1 FROM public.lab_creditos_movimentos WHERE tipo = 'carga');
  _depois := _c.saldo_usd + _valor;
  _ativa := _c.ativa OR _primeira;

  UPDATE public.lab_carteira
     SET saldo_usd = _depois, ativa = _ativa, atualizado_em = now(), atualizado_por = p_ator
   WHERE id = true;

  INSERT INTO public.lab_creditos_movimentos (tipo, valor_usd, saldo_depois, debitado, nota, criado_por)
  VALUES ('carga', _valor, _depois, true, NULLIF(left(btrim(COALESCE(p_nota, '')), 400), ''), p_ator)
  RETURNING id INTO _mov;

  RETURN jsonb_build_object('ok', true, 'movimento_id', _mov, 'saldo_usd', _depois, 'ativa', _ativa, 'primeira', _primeira);
END;
$fn$;

-- ─── 5) Reservar na confirmação ─────────────────────────────────────────────
-- Ativa: debita; sem saldo devolve { ok: false, erro: 'sem_credito', saldo_usd, custo_usd } e nada muda.
-- Inativa: só registra o uso (saldo igual, debitado = false).
CREATE OR REPLACE FUNCTION public.lab_creditos_reservar(p_valor numeric, p_projeto_id uuid, p_execucao_id uuid, p_nota text, p_ator uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  _c public.lab_carteira;
  _valor numeric := round(COALESCE(p_valor, 0), 6);
  _depois numeric;
  _mov uuid;
BEGIN
  IF _valor < 0 OR _valor > 10000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'LAB_CREDITOS_VALOR_INVALIDO';
  END IF;

  INSERT INTO public.lab_carteira (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
  SELECT * INTO _c FROM public.lab_carteira WHERE id = true FOR UPDATE;

  IF _c.ativa AND _c.saldo_usd < _valor THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_credito', 'saldo_usd', _c.saldo_usd, 'custo_usd', _valor, 'ativa', true);
  END IF;

  _depois := CASE WHEN _c.ativa THEN _c.saldo_usd - _valor ELSE _c.saldo_usd END;
  IF _c.ativa THEN
    UPDATE public.lab_carteira SET saldo_usd = _depois, atualizado_em = now() WHERE id = true;
  END IF;

  INSERT INTO public.lab_creditos_movimentos (tipo, valor_usd, saldo_depois, debitado, projeto_id, execucao_id, nota, criado_por)
  VALUES ('uso', _valor, _depois, _c.ativa, p_projeto_id, p_execucao_id, NULLIF(left(btrim(COALESCE(p_nota, '')), 400), ''), p_ator)
  RETURNING id INTO _mov;

  RETURN jsonb_build_object('ok', true, 'movimento_id', _mov, 'saldo_usd', _depois, 'ativa', _c.ativa, 'custo_usd', _valor);
END;
$fn$;

-- ─── 6) Estornar a falha ────────────────────────────────────────────────────
-- Devolve até o que o uso reservou (somando os estornos anteriores dele); só mexe no saldo se o uso debitou.
CREATE OR REPLACE FUNCTION public.lab_creditos_estornar(p_reserva_id uuid, p_valor numeric, p_execucao_id uuid, p_nota text, p_ator uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  _c public.lab_carteira;
  _r public.lab_creditos_movimentos;
  _ja numeric;
  _valor numeric;
  _depois numeric;
  _mov uuid;
BEGIN
  INSERT INTO public.lab_carteira (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
  -- Sempre a carteira primeiro, depois o uso (mesma ordem de trava das outras RPCs).
  SELECT * INTO _c FROM public.lab_carteira WHERE id = true FOR UPDATE;
  SELECT * INTO _r FROM public.lab_creditos_movimentos WHERE id = p_reserva_id AND tipo = 'uso' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'LAB_CREDITOS_RESERVA_INEXISTENTE';
  END IF;

  SELECT COALESCE(sum(valor_usd), 0) INTO _ja
    FROM public.lab_creditos_movimentos
   WHERE reserva_id = p_reserva_id AND tipo = 'estorno';

  _valor := least(greatest(round(COALESCE(p_valor, _r.valor_usd), 6), 0), _r.valor_usd - _ja);
  IF _valor <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'estornado_usd', 0, 'saldo_usd', _c.saldo_usd, 'ativa', _c.ativa);
  END IF;

  _depois := CASE WHEN _r.debitado THEN _c.saldo_usd + _valor ELSE _c.saldo_usd END;
  IF _r.debitado THEN
    UPDATE public.lab_carteira SET saldo_usd = _depois, atualizado_em = now() WHERE id = true;
  END IF;

  INSERT INTO public.lab_creditos_movimentos (tipo, valor_usd, saldo_depois, debitado, projeto_id, execucao_id, reserva_id, nota, criado_por)
  VALUES ('estorno', _valor, _depois, _r.debitado, _r.projeto_id, COALESCE(p_execucao_id, _r.execucao_id), p_reserva_id,
          NULLIF(left(btrim(COALESCE(p_nota, '')), 400), ''), p_ator)
  RETURNING id INTO _mov;

  RETURN jsonb_build_object('ok', true, 'movimento_id', _mov, 'estornado_usd', _valor, 'saldo_usd', _depois, 'ativa', _c.ativa);
END;
$fn$;

-- ─── 7) Ligar ou desligar o limite (só admin) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.lab_creditos_limite(p_ativa boolean, p_ator uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  _c public.lab_carteira;
BEGIN
  IF p_ator IS NULL OR NOT COALESCE(public.has_role(p_ator, 'admin'::public.app_role), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'LAB_CREDITOS_SO_ADMIN';
  END IF;
  IF p_ativa IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'LAB_CREDITOS_LIMITE_INVALIDO';
  END IF;

  INSERT INTO public.lab_carteira (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
  SELECT * INTO _c FROM public.lab_carteira WHERE id = true FOR UPDATE;
  IF _c.ativa = p_ativa THEN
    RETURN jsonb_build_object('ok', true, 'saldo_usd', _c.saldo_usd, 'ativa', _c.ativa);
  END IF;

  UPDATE public.lab_carteira SET ativa = p_ativa, atualizado_em = now(), atualizado_por = p_ator WHERE id = true;
  INSERT INTO public.lab_creditos_movimentos (tipo, valor_usd, saldo_depois, debitado, nota, criado_por)
  VALUES ('ajuste', 0, _c.saldo_usd, false, CASE WHEN p_ativa THEN 'Limite ligado' ELSE 'Limite desligado' END, p_ator);

  RETURN jsonb_build_object('ok', true, 'saldo_usd', _c.saldo_usd, 'ativa', p_ativa);
END;
$fn$;

-- Só a função laboratorio (chave de serviço) chama as RPCs; quem é admin ela confere antes e a RPC de novo.
REVOKE ALL ON FUNCTION public.lab_creditos_carregar(numeric, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lab_creditos_reservar(numeric, uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lab_creditos_estornar(uuid, numeric, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lab_creditos_limite(boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lab_creditos_carregar(numeric, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.lab_creditos_reservar(numeric, uuid, uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.lab_creditos_estornar(uuid, numeric, uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.lab_creditos_limite(boolean, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

-- Conferir depois de aplicar (só leitura):
-- select saldo_usd, ativa from public.lab_carteira;             -- 0, false
-- select count(*) from public.lab_creditos_movimentos;          -- 0
