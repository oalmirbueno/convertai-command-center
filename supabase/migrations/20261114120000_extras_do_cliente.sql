-- Extras do cliente: order bumps e upsells com o financeiro junto (14/11/2026, pedido do dono).
--
-- "Qualquer cliente que entra, eu consigo colocar order bumps: suporte mensal depois da entrega do
--  sistema, automação com implementação e mensalidade, CRM, e-mail, comissão sobre resultado. Marco,
--  coloco a data e o valor, digo se já pagou ou quando vai pagar, e já atualiza o financeiro. Tudo
--  especificado, sem duplicar."
--
-- O que existia: o cliente tem UMA mensalidade (profiles.plan_value) e cobranças soltas. Um segundo
-- produto recorrente não tinha onde morar; a saída era lançar cobrança avulsa à mão todo mês ou
-- inventar um "projeto" (foi assim que o Vip DK ficou com o caixa errado em 12/11).
--
-- O que entra:
--   1. public.client_extras: cada coisa que o cliente comprou além da mensalidade base.
--        cobranca = 'mensal'   → valor por mês, começa em `inicio` (pode ficar "aguardando a entrega");
--                   'unico'    → valor total, em entrada + parcelas livres;
--                   'comissao' → percentual sobre um resultado que o dono lança a cada mês.
--   2. billing ganha extra_id e competencia: a cobrança sabe de qual extra é e de qual mês. O índice
--      único (extra_id, competencia) é o que impede a mesma mensalidade de extra nascer duas vezes.
--   3. RPCs, só para admin: extra_salvar, extra_iniciar, extra_encerrar, extra_lancar_comissao.
--   4. app_private.extras_gerar_mensais(): todo dia cria a cobrança do mês dos extras mensais ativos.
--
-- A cobrança de extra usa type = 'extra' (mensal e comissão) ou 'one_off' (único). Nunca 'renewal':
-- o gatilho da renovação do plano (renovacao_ao_pagar) e as telas tratam 'renewal' como A mensalidade
-- do cliente, e um extra pago empurraria a data de renovação do plano.
--
-- Não mexe em cobrança existente, não envia nada a cliente.

-- ───────────────────────── 1) a tabela ─────────────────────────
CREATE TABLE IF NOT EXISTS public.client_extras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(btrim(nome)) BETWEEN 2 AND 120),
  categoria text NOT NULL DEFAULT 'outro'
    CHECK (categoria IN ('suporte', 'sistema', 'automacao', 'crm', 'email', 'site', 'trafego', 'conteudo', 'outro')),
  cobranca text NOT NULL CHECK (cobranca IN ('mensal', 'unico', 'comissao')),
  valor numeric(12, 2) NOT NULL DEFAULT 0 CHECK (valor >= 0),
  percentual numeric(6, 3) CHECK (percentual IS NULL OR (percentual > 0 AND percentual <= 100)),
  base_da_comissao text,
  inicio date,
  dia_vencimento integer CHECK (dia_vencimento IS NULL OR dia_vencimento BETWEEN 1 AND 31),
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'aguardando', 'encerrado')),
  encerrado_em date,
  produto_conta_id uuid,
  observacao text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_extras_comissao_tem_percentual CHECK (cobranca <> 'comissao' OR percentual IS NOT NULL),
  CONSTRAINT client_extras_mensal_ativo_tem_inicio CHECK (cobranca <> 'mensal' OR status <> 'ativo' OR inicio IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS client_extras_client_idx ON public.client_extras (client_id, status);

ALTER TABLE public.client_extras ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_extras_admin ON public.client_extras;
CREATE POLICY client_extras_admin ON public.client_extras
  FOR ALL USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
REVOKE ALL ON public.client_extras FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_extras TO authenticated;

-- ───────────────────────── 2) a cobrança sabe de qual extra é ─────────────────────────
ALTER TABLE public.billing ADD COLUMN IF NOT EXISTS extra_id uuid REFERENCES public.client_extras(id) ON DELETE SET NULL;
ALTER TABLE public.billing ADD COLUMN IF NOT EXISTS competencia date;
CREATE UNIQUE INDEX IF NOT EXISTS billing_extra_competencia_uidx
  ON public.billing (extra_id, competencia) WHERE extra_id IS NOT NULL AND competencia IS NOT NULL;
CREATE INDEX IF NOT EXISTS billing_extra_idx ON public.billing (extra_id) WHERE extra_id IS NOT NULL;

-- ───────────────────────── apoio ─────────────────────────
CREATE OR REPLACE FUNCTION app_private.extras_so_admin()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'SO_ADMIN_MEXE_NOS_EXTRAS' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION app_private.extras_so_admin() FROM PUBLIC, anon;

-- O vencimento de um mês: o dia combinado, ou o último dia quando o mês é mais curto.
CREATE OR REPLACE FUNCTION app_private.extras_vencimento(_mes date, _dia integer)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
  SELECT (date_trunc('month', _mes)::date
          + (LEAST(GREATEST(COALESCE(_dia, 1), 1),
                   EXTRACT(DAY FROM (date_trunc('month', _mes) + interval '1 month - 1 day'))::integer) - 1));
$$;

-- Uma cobrança mensal do extra, se ainda não existir a daquele mês.
CREATE OR REPLACE FUNCTION app_private.extras_cobranca_do_mes(_extra public.client_extras, _mes date, _paga boolean DEFAULT false, _paga_em date DEFAULT NULL, _vencimento date DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _competencia date := date_trunc('month', _mes)::date;
  _vence date := COALESCE(_vencimento, app_private.extras_vencimento(_competencia, COALESCE(_extra.dia_vencimento, EXTRACT(DAY FROM _extra.inicio)::integer)));
  _id uuid;
BEGIN
  IF _extra.valor <= 0 THEN RETURN NULL; END IF;
  INSERT INTO public.billing (client_id, type, amount, status, due_date, paid_date, paid_amount, description, extra_id, competencia)
  VALUES (_extra.client_id, 'extra', _extra.valor,
          CASE WHEN _paga THEN 'paid' ELSE 'pending' END,
          _vence,
          CASE WHEN _paga THEN COALESCE(_paga_em, _vence) END,
          CASE WHEN _paga THEN _extra.valor END,
          _extra.nome || ' · ' || to_char(_competencia, 'MM/YYYY'),
          _extra.id, _competencia)
  ON CONFLICT (extra_id, competencia) WHERE extra_id IS NOT NULL AND competencia IS NOT NULL DO NOTHING
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION app_private.extras_cobranca_do_mes(public.client_extras, date, boolean, date, date) FROM PUBLIC, anon, authenticated;

-- ───────────────────────── 3) RPCs ─────────────────────────
-- Cria o extra e as cobranças dele.
--   _dados: { client_id, nome, categoria, cobranca, valor, percentual, base_da_comissao, inicio,
--             dia_vencimento, observacao, produto_conta_id,
--             primeira_paga (bool), primeira_paga_em (date),            -- mensal
--             parcelas: [{ valor, vencimento, paga, paga_em, rotulo }] } -- unico
CREATE OR REPLACE FUNCTION public.extra_salvar(_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _e public.client_extras%ROWTYPE;
  _cobranca text := _dados->>'cobranca';
  _inicio date := NULLIF(_dados->>'inicio', '')::date;
  _valor numeric := COALESCE(NULLIF(_dados->>'valor', '')::numeric, 0);
  _p jsonb;
  _soma numeric := 0;
  _n integer := 0;
  _total integer;
  _criadas integer := 0;
  _paga boolean;
BEGIN
  PERFORM app_private.extras_so_admin();
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = (_dados->>'client_id')::uuid AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'CLIENTE_NAO_ENCONTRADO';
  END IF;
  IF _cobranca NOT IN ('mensal', 'unico', 'comissao') THEN RAISE EXCEPTION 'COBRANCA_INVALIDA'; END IF;
  IF _cobranca <> 'comissao' AND _valor <= 0 THEN RAISE EXCEPTION 'VALOR_OBRIGATORIO'; END IF;

  IF _cobranca = 'unico' THEN
    _total := COALESCE(jsonb_array_length(_dados->'parcelas'), 0);
    IF _total = 0 THEN RAISE EXCEPTION 'PARCELAS_OBRIGATORIAS: diga como o valor vai ser pago'; END IF;
    IF _total > 60 THEN RAISE EXCEPTION 'PARCELAS_DEMAIS'; END IF;
    SELECT COALESCE(sum((x->>'valor')::numeric), 0) INTO _soma FROM jsonb_array_elements(_dados->'parcelas') x;
    IF abs(_soma - _valor) > 0.01 THEN
      RAISE EXCEPTION 'PARCELAS_NAO_FECHAM: as parcelas somam % e o valor e %', _soma, _valor;
    END IF;
  END IF;

  INSERT INTO public.client_extras
    (client_id, nome, categoria, cobranca, valor, percentual, base_da_comissao, inicio, dia_vencimento, status, produto_conta_id, observacao, created_by)
  VALUES (
    (_dados->>'client_id')::uuid,
    btrim(_dados->>'nome'),
    COALESCE(NULLIF(_dados->>'categoria', ''), 'outro'),
    _cobranca,
    _valor,
    NULLIF(_dados->>'percentual', '')::numeric,
    NULLIF(btrim(COALESCE(_dados->>'base_da_comissao', '')), ''),
    _inicio,
    COALESCE(NULLIF(_dados->>'dia_vencimento', '')::integer, EXTRACT(DAY FROM _inicio)::integer),
    CASE WHEN _cobranca = 'mensal' AND _inicio IS NULL THEN 'aguardando' ELSE 'ativo' END,
    NULLIF(_dados->>'produto_conta_id', '')::uuid,
    NULLIF(btrim(COALESCE(_dados->>'observacao', '')), ''),
    (SELECT auth.uid()))
  RETURNING * INTO _e;

  IF _cobranca = 'mensal' AND _inicio IS NOT NULL THEN
    _paga := COALESCE((_dados->>'primeira_paga')::boolean, false);
    IF app_private.extras_cobranca_do_mes(_e, _inicio, _paga, NULLIF(_dados->>'primeira_paga_em', '')::date, _inicio) IS NOT NULL THEN
      _criadas := 1;
    END IF;
  ELSIF _cobranca = 'unico' THEN
    FOR _p IN SELECT * FROM jsonb_array_elements(_dados->'parcelas') LOOP
      _n := _n + 1;
      _paga := COALESCE((_p->>'paga')::boolean, false);
      INSERT INTO public.billing (client_id, type, amount, status, due_date, paid_date, paid_amount, description, extra_id)
      VALUES (_e.client_id, 'one_off', (_p->>'valor')::numeric,
              CASE WHEN _paga THEN 'paid' ELSE 'pending' END,
              (_p->>'vencimento')::date,
              CASE WHEN _paga THEN COALESCE(NULLIF(_p->>'paga_em', '')::date, (_p->>'vencimento')::date) END,
              CASE WHEN _paga THEN (_p->>'valor')::numeric END,
              _e.nome || ' · ' || COALESCE(NULLIF(btrim(COALESCE(_p->>'rotulo', '')), ''),
                                           CASE WHEN _total = 1 THEN 'pagamento único' ELSE 'parcela ' || _n || '/' || _total END),
              _e.id);
      _criadas := _criadas + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('id', _e.id, 'status', _e.status, 'cobrancas_criadas', _criadas);
END;
$$;
REVOKE ALL ON FUNCTION public.extra_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.extra_salvar(jsonb) TO authenticated;

-- O extra mensal que estava aguardando a entrega começa a valer.
CREATE OR REPLACE FUNCTION public.extra_iniciar(_id uuid, _inicio date, _primeira_paga boolean DEFAULT false, _paga_em date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _e public.client_extras%ROWTYPE;
BEGIN
  PERFORM app_private.extras_so_admin();
  IF _inicio IS NULL THEN RAISE EXCEPTION 'INICIO_OBRIGATORIO'; END IF;
  SELECT * INTO _e FROM public.client_extras WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EXTRA_NAO_ENCONTRADO'; END IF;
  IF _e.cobranca <> 'mensal' THEN RAISE EXCEPTION 'SO_EXTRA_MENSAL_TEM_INICIO'; END IF;
  IF _e.status = 'encerrado' THEN RAISE EXCEPTION 'EXTRA_ENCERRADO'; END IF;
  IF _e.status = 'ativo' AND EXISTS (SELECT 1 FROM public.billing WHERE extra_id = _id) THEN
    RAISE EXCEPTION 'EXTRA_JA_INICIADO: ja existe cobranca deste extra';
  END IF;
  UPDATE public.client_extras
     SET inicio = _inicio, dia_vencimento = COALESCE(dia_vencimento, EXTRACT(DAY FROM _inicio)::integer),
         status = 'ativo', updated_at = now()
   WHERE id = _id RETURNING * INTO _e;
  PERFORM app_private.extras_cobranca_do_mes(_e, _inicio, COALESCE(_primeira_paga, false), _paga_em, _inicio);
  RETURN jsonb_build_object('id', _e.id, 'status', _e.status, 'inicio', _e.inicio);
END;
$$;
REVOKE ALL ON FUNCTION public.extra_iniciar(uuid, date, boolean, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.extra_iniciar(uuid, date, boolean, date) TO authenticated;

-- Encerra o extra. O que já foi pago fica; o que ainda não venceu e não foi pago sai.
CREATE OR REPLACE FUNCTION public.extra_encerrar(_id uuid, _em date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _e public.client_extras%ROWTYPE;
  _dia date := COALESCE(_em, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  _removidas integer;
BEGIN
  PERFORM app_private.extras_so_admin();
  SELECT * INTO _e FROM public.client_extras WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EXTRA_NAO_ENCONTRADO'; END IF;
  UPDATE public.client_extras SET status = 'encerrado', encerrado_em = _dia, updated_at = now() WHERE id = _id;
  DELETE FROM public.billing WHERE extra_id = _id AND status = 'pending' AND due_date > _dia;
  GET DIAGNOSTICS _removidas = ROW_COUNT;
  RETURN jsonb_build_object('id', _id, 'status', 'encerrado', 'cobrancas_futuras_removidas', _removidas);
END;
$$;
REVOKE ALL ON FUNCTION public.extra_encerrar(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.extra_encerrar(uuid, date) TO authenticated;

-- Comissão do mês: percentual do extra sobre o resultado informado. Uma por mês.
CREATE OR REPLACE FUNCTION public.extra_lancar_comissao(_id uuid, _base numeric, _mes date, _vencimento date, _paga boolean DEFAULT false, _paga_em date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _e public.client_extras%ROWTYPE;
  _competencia date := date_trunc('month', _mes)::date;
  _valor numeric;
  _cobranca uuid;
BEGIN
  PERFORM app_private.extras_so_admin();
  SELECT * INTO _e FROM public.client_extras WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EXTRA_NAO_ENCONTRADO'; END IF;
  IF _e.cobranca <> 'comissao' THEN RAISE EXCEPTION 'EXTRA_NAO_E_COMISSAO'; END IF;
  IF _e.status <> 'ativo' THEN RAISE EXCEPTION 'EXTRA_NAO_ESTA_ATIVO'; END IF;
  IF _base IS NULL OR _base <= 0 THEN RAISE EXCEPTION 'BASE_OBRIGATORIA: informe o resultado do mes'; END IF;
  IF _vencimento IS NULL THEN RAISE EXCEPTION 'VENCIMENTO_OBRIGATORIO'; END IF;
  _valor := round(_base * _e.percentual / 100, 2);
  INSERT INTO public.billing (client_id, type, amount, status, due_date, paid_date, paid_amount, description, extra_id, competencia)
  VALUES (_e.client_id, 'extra', _valor,
          CASE WHEN _paga THEN 'paid' ELSE 'pending' END, _vencimento,
          CASE WHEN _paga THEN COALESCE(_paga_em, _vencimento) END,
          CASE WHEN _paga THEN _valor END,
          _e.nome || ' · ' || to_char(_competencia, 'MM/YYYY') || ' ('
            || replace(rtrim(rtrim(_e.percentual::text, '0'), '.'), '.', ',') || '% de R$ '
            || replace(replace(replace(to_char(_base, 'FM999,999,999,990.00'), ',', '#'), '.', ','), '#', '.') || ')',
          _e.id, _competencia)
  ON CONFLICT (extra_id, competencia) WHERE extra_id IS NOT NULL AND competencia IS NOT NULL DO NOTHING
  RETURNING id INTO _cobranca;
  IF _cobranca IS NULL THEN
    RAISE EXCEPTION 'COMISSAO_JA_LANCADA: ja existe a comissao deste mes';
  END IF;
  RETURN jsonb_build_object('cobranca_id', _cobranca, 'valor', _valor, 'competencia', _competencia);
END;
$$;
REVOKE ALL ON FUNCTION public.extra_lancar_comissao(uuid, numeric, date, date, boolean, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.extra_lancar_comissao(uuid, numeric, date, date, boolean, date) TO authenticated;

-- ───────────────────────── 4) a rotina do mês ─────────────────────────
-- Para cada extra mensal ativo: garante a cobrança de todo mês desde o início até o mês corrente e,
-- quando faltam 10 dias ou menos para o vencimento, a do mês seguinte. Rodar duas vezes não duplica.
CREATE OR REPLACE FUNCTION app_private.extras_gerar_mensais(_hoje date DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _dia date := COALESCE(_hoje, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  _e public.client_extras%ROWTYPE;
  _mes date;
  _ate date;
  _criadas integer := 0;
BEGIN
  FOR _e IN
    SELECT x.* FROM public.client_extras x
      JOIN public.profiles p ON p.id = x.client_id
     WHERE x.cobranca = 'mensal' AND x.status = 'ativo' AND x.inicio IS NOT NULL AND x.valor > 0
       AND p.deleted_at IS NULL AND COALESCE(p.plan_status, 'active') <> 'inactive'
  LOOP
    _ate := date_trunc('month', _dia)::date;
    IF app_private.extras_vencimento((_ate + interval '1 month')::date, COALESCE(_e.dia_vencimento, EXTRACT(DAY FROM _e.inicio)::integer)) <= _dia + 10 THEN
      _ate := (_ate + interval '1 month')::date;
    END IF;
    _mes := date_trunc('month', _e.inicio)::date;
    WHILE _mes <= _ate LOOP
      IF app_private.extras_cobranca_do_mes(_e, _mes) IS NOT NULL THEN _criadas := _criadas + 1; END IF;
      _mes := (_mes + interval '1 month')::date;
    END LOOP;
  END LOOP;
  RETURN _criadas;
END;
$$;
REVOKE ALL ON FUNCTION app_private.extras_gerar_mensais(date) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'extras-gerar-mensais';
    PERFORM cron.schedule('extras-gerar-mensais', '40 10 * * *', $cron$SELECT app_private.extras_gerar_mensais();$cron$);
  END IF;
END
$$;
