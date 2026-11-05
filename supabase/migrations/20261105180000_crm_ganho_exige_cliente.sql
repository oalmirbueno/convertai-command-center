-- Ganho só com o cliente cadastrado (05/11/2026).
--
-- Dono: a Imobiliária Prix foi marcada como ganho por um agente, pelo MCP, sem cadastro: não apareceu em Clientes nem no
-- Financeiro. "Tem que colocar se é avulso ou não e todos os detalhes; aí sim marca como ganho."
-- 1. Nenhum caminho (tela, MCP, agente) passa um lead para ganho sem won_client_id. Quem já está em ganho sem cliente
--    continua podendo ser editado e ganha o botão Cadastrar cliente na ficha. Apagar o cliente (ON DELETE SET NULL) segue.
-- 2. crm_ganho_cadastrar recebe os detalhes da janela: tipo, valores, plano, marca, serviços e a data da próxima parcela.

CREATE OR REPLACE FUNCTION public.commercial_lead_ganho_exige_cliente()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF NEW.stage = 'ganho' AND NEW.won_client_id IS NULL AND (TG_OP = 'INSERT' OR OLD.stage IS DISTINCT FROM 'ganho') THEN
    RAISE EXCEPTION 'Ganho exige o cliente cadastrado: use a janela de ganho do CRM, que pede o tipo, os valores e cria o cliente.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS commercial_lead_ganho_exige_cliente_trg ON public.commercial_leads;
CREATE TRIGGER commercial_lead_ganho_exige_cliente_trg
  BEFORE INSERT OR UPDATE OF stage ON public.commercial_leads
  FOR EACH ROW EXECUTE FUNCTION public.commercial_lead_ganho_exige_cliente();

DROP FUNCTION IF EXISTS public.crm_ganho_cadastrar(uuid, uuid, text, text, text, numeric, integer, date, date, boolean);

CREATE OR REPLACE FUNCTION public.crm_ganho_cadastrar(
  p_lead_id uuid,
  p_client_id uuid,
  p_tipo text,
  p_mensalidade numeric,
  p_valor_projeto numeric,
  p_empresa text,
  p_email text,
  p_whatsapp text,
  p_marca text DEFAULT NULL,
  p_plano_nome text DEFAULT NULL,
  p_servicos jsonb DEFAULT NULL,
  p_entrada_recebida numeric DEFAULT NULL,
  p_entrada_parcelas integer DEFAULT NULL,
  p_proxima_parcela date DEFAULT NULL,
  p_mensalidade_inicio date DEFAULT NULL,
  p_mensalidade_vencimento date DEFAULT NULL,
  p_mensalidade_paga boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_lead public.commercial_leads%ROWTYPE;
  v_perfil public.profiles%ROWTYPE;
  v_hoje date := (pg_catalog.now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_mensal numeric := CASE WHEN p_tipo = 'one_off' THEN 0 ELSE COALESCE(p_mensalidade, 0) END;
  v_projeto numeric := CASE WHEN p_tipo = 'recurring' THEN 0 ELSE COALESCE(p_valor_projeto, 0) END;
  v_recebida numeric := CASE WHEN p_tipo = 'recurring' THEN NULL ELSE p_entrada_recebida END;
  v_parcelas integer := CASE WHEN p_tipo = 'recurring' THEN NULL ELSE p_entrada_parcelas END;
  v_inicio date := CASE WHEN p_tipo = 'one_off' THEN NULL ELSE p_mensalidade_inicio END;
  v_primeira date;
  v_nome text;
  v_ja_tem_financeiro boolean;
  v_vencimento date;
  v_billing_id uuid;
  v_resto numeric;
  v_parcela numeric;
  v_n integer;
BEGIN
  IF NOT COALESCE(public.has_role(auth.uid(), 'admin'::public.app_role), false) THEN
    RAISE EXCEPTION 'Só o admin cadastra cliente pelo ganho: esse passo escreve no financeiro.' USING ERRCODE = '42501';
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('recurring', 'one_off', 'hybrid') THEN
    RAISE EXCEPTION 'Escolha se o cliente é recorrente, avulso ou híbrido.';
  END IF;
  IF p_tipo IN ('recurring', 'hybrid') AND v_mensal <= 0 THEN RAISE EXCEPTION 'Informe o valor da mensalidade.'; END IF;
  IF p_tipo IN ('one_off', 'hybrid') AND v_projeto <= 0 THEN RAISE EXCEPTION 'Informe o valor do projeto.'; END IF;
  IF v_recebida IS NOT NULL AND (v_recebida < 0 OR v_recebida >= v_projeto) THEN
    RAISE EXCEPTION 'O que já entrou fica entre zero e o valor do projeto.';
  END IF;

  SELECT * INTO v_lead FROM public.commercial_leads WHERE id = p_lead_id AND archived_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead não encontrado.'; END IF;
  IF v_lead.stage = 'ganho' AND v_lead.won_client_id = p_client_id THEN
    RETURN jsonb_build_object('client_id', p_client_id, 'vinculado', true, 'recuperada', true);
  END IF;

  SELECT * INTO v_perfil FROM public.profiles WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente não encontrado.'; END IF;
  IF NOT COALESCE(public.has_role(p_client_id, 'client'::public.app_role), false) THEN
    RAISE EXCEPTION 'Este e-mail é de alguém da equipe, não de um cliente.';
  END IF;

  v_ja_tem_financeiro := COALESCE(v_perfil.plan_value, 0) > 0
    OR EXISTS (SELECT 1 FROM public.billing WHERE client_id = p_client_id AND status <> 'cancelled');
  v_nome := COALESCE(NULLIF(btrim(p_empresa), ''), NULLIF(btrim(v_perfil.company_name), ''), v_lead.company, v_lead.name);

  IF NOT v_ja_tem_financeiro THEN
    UPDATE public.profiles SET
      company_name = v_nome,
      phone = COALESCE(NULLIF(btrim(p_whatsapp), ''), phone),
      client_type = p_tipo::public.client_type,
      brand = COALESCE(NULLIF(btrim(p_marca), '')::public.brand_type, brand),
      services_config = COALESCE(p_servicos, services_config)
    WHERE id = p_client_id;

    IF v_mensal > 0 THEN
      v_vencimento := CASE WHEN p_mensalidade_paga THEN v_hoje ELSE COALESCE(p_mensalidade_vencimento, v_inicio, v_hoje) END;
      UPDATE public.profiles SET
        plan_value = v_mensal,
        plan_name = COALESCE(NULLIF(btrim(p_plano_nome), ''), NULLIF(btrim(plan_name), ''), 'Mensalidade'),
        plan_status = 'active',
        plan_renewal_date = v_vencimento
      WHERE id = p_client_id;

      INSERT INTO public.billing (client_id, type, amount, due_date, description, status)
      VALUES (p_client_id, 'renewal', v_mensal, v_vencimento, 'Mensalidade · ' || v_nome, 'pending')
      RETURNING id INTO v_billing_id;
      -- Paga depois de nascer: é a passagem para 'paid' que faz o gatilho avançar o ciclo e gerar a próxima mensalidade.
      IF p_mensalidade_paga THEN
        UPDATE public.billing SET status = 'paid', paid_date = v_hoje, paid_amount = v_mensal WHERE id = v_billing_id;
      END IF;
    END IF;

    IF v_projeto > 0 THEN
      IF v_recebida IS NULL THEN
        INSERT INTO public.billing (client_id, type, amount, due_date, paid_date, paid_amount, description, status)
        VALUES (p_client_id, 'one_off', v_projeto, v_hoje, v_hoje, v_projeto, 'Projeto · ' || v_nome, 'paid');
      ELSE
        IF v_recebida > 0 THEN
          INSERT INTO public.billing (client_id, type, amount, due_date, paid_date, paid_amount, description, status)
          VALUES (p_client_id, 'one_off', v_recebida, v_hoje, v_hoje, v_recebida, 'Projeto · Entrada · ' || v_nome, 'paid');
        END IF;
        v_resto := v_projeto - v_recebida;
        v_n := GREATEST(COALESCE(v_parcelas, 1), 1);
        v_primeira := COALESCE(p_proxima_parcela, (v_hoje + pg_catalog.make_interval(months => 1))::date);
        FOR i IN 1..v_n LOOP
          -- A última parcela acerta o arredondamento.
          v_parcela := CASE WHEN i = v_n THEN v_resto - round(v_resto / v_n, 2) * (v_n - 1) ELSE round(v_resto / v_n, 2) END;
          INSERT INTO public.billing (client_id, type, amount, due_date, description, status)
          VALUES (p_client_id, 'one_off', v_parcela, (v_primeira + pg_catalog.make_interval(months => i - 1))::date, 'Projeto · ' || v_nome || ' · parcela ' || i || '/' || v_n, 'pending');
        END LOOP;
      END IF;
    END IF;
  END IF;

  UPDATE public.commercial_leads SET
    stage = 'ganho',
    closed_at = CASE WHEN stage = 'ganho' THEN COALESCE(closed_at, pg_catalog.now()) ELSE pg_catalog.now() END,
    lost_reason = NULL,
    won_client_id = p_client_id,
    monthly_value = v_mensal,
    one_off_value = v_projeto,
    company = COALESCE(NULLIF(btrim(p_empresa), ''), company),
    email = COALESCE(NULLIF(btrim(p_email), ''), email),
    whatsapp = COALESCE(NULLIF(btrim(p_whatsapp), ''), whatsapp),
    entrada_recebida = v_recebida,
    entrada_parcelas = v_parcelas,
    mensalidade_inicio = v_inicio
  WHERE id = p_lead_id;

  INSERT INTO public.commercial_lead_events (lead_id, kind, from_stage, to_stage, note, created_by)
  VALUES (p_lead_id, 'stage', v_lead.stage, 'ganho', CASE WHEN v_ja_tem_financeiro THEN 'Ligado a um cliente que já existia.' ELSE 'Cliente cadastrado no ganho.' END, auth.uid());

  RETURN jsonb_build_object('client_id', p_client_id, 'vinculado', v_ja_tem_financeiro, 'recuperada', false);
END
$$;

REVOKE ALL ON FUNCTION public.crm_ganho_cadastrar(uuid, uuid, text, numeric, numeric, text, text, text, text, text, jsonb, numeric, integer, date, date, date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_ganho_cadastrar(uuid, uuid, text, numeric, numeric, text, text, text, text, text, jsonb, numeric, integer, date, date, date, boolean) TO authenticated;
