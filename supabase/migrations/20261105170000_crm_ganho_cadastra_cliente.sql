-- O ganho do CRM já monta o cliente (05/11/2026).
--
-- Dono: "no ganho já pede o e-mail e o número do cliente e já monta o cadastro automático, igual cadastramos clientes,
-- para o CRM ficar integrado". A conta nasce pelo manage-team e o convite sai pela tela, como no Novo cliente; aqui fica
-- o que precisa ser uma transação só: perfil, cobranças e a passagem do lead para ganho.
--
-- Repetir não duplica: lead já ganho com esse cliente volta sem mexer em nada. Cliente que já tem plano ou cobrança só
-- ganha o vínculo, porque o dinheiro dele já está contado no Financeiro.

CREATE OR REPLACE FUNCTION public.crm_ganho_cadastrar(
  p_lead_id uuid,
  p_client_id uuid,
  p_empresa text,
  p_email text,
  p_whatsapp text,
  p_entrada_recebida numeric DEFAULT NULL,
  p_entrada_parcelas integer DEFAULT NULL,
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
  IF v_lead.one_off_value > 0 AND p_entrada_recebida IS NOT NULL AND (p_entrada_recebida < 0 OR p_entrada_recebida >= v_lead.one_off_value) THEN
    RAISE EXCEPTION 'O recebido fica entre zero e o valor da entrada.';
  END IF;

  v_ja_tem_financeiro := COALESCE(v_perfil.plan_value, 0) > 0
    OR EXISTS (SELECT 1 FROM public.billing WHERE client_id = p_client_id AND status <> 'cancelled');
  v_nome := COALESCE(NULLIF(btrim(p_empresa), ''), NULLIF(btrim(v_perfil.company_name), ''), v_lead.company, v_lead.name);

  IF NOT v_ja_tem_financeiro THEN
    UPDATE public.profiles SET
      company_name = v_nome,
      phone = COALESCE(NULLIF(btrim(p_whatsapp), ''), phone),
      client_type = (CASE
        WHEN v_lead.monthly_value > 0 AND v_lead.one_off_value > 0 THEN 'hybrid'
        WHEN v_lead.monthly_value > 0 THEN 'recurring'
        ELSE 'one_off'
      END)::public.client_type
    WHERE id = p_client_id;

    IF v_lead.monthly_value > 0 THEN
      v_vencimento := CASE WHEN p_mensalidade_paga THEN v_hoje ELSE COALESCE(p_mensalidade_vencimento, p_mensalidade_inicio, v_hoje) END;
      UPDATE public.profiles SET
        plan_value = v_lead.monthly_value,
        plan_name = COALESCE(NULLIF(btrim(plan_name), ''), 'Mensalidade'),
        plan_status = 'active',
        plan_renewal_date = v_vencimento
      WHERE id = p_client_id;

      INSERT INTO public.billing (client_id, type, amount, due_date, description, status)
      VALUES (p_client_id, 'renewal', v_lead.monthly_value, v_vencimento, 'Mensalidade · ' || v_nome, 'pending')
      RETURNING id INTO v_billing_id;
      -- Paga depois de nascer: é a passagem para 'paid' que faz o gatilho avançar o ciclo e gerar a próxima mensalidade.
      IF p_mensalidade_paga THEN
        UPDATE public.billing SET status = 'paid', paid_date = v_hoje, paid_amount = v_lead.monthly_value WHERE id = v_billing_id;
      END IF;
    END IF;

    IF v_lead.one_off_value > 0 THEN
      IF p_entrada_recebida IS NULL THEN
        INSERT INTO public.billing (client_id, type, amount, due_date, paid_date, paid_amount, description, status)
        VALUES (p_client_id, 'one_off', v_lead.one_off_value, v_hoje, v_hoje, v_lead.one_off_value, 'Entrada · ' || v_nome, 'paid');
      ELSE
        IF p_entrada_recebida > 0 THEN
          INSERT INTO public.billing (client_id, type, amount, due_date, paid_date, paid_amount, description, status)
          VALUES (p_client_id, 'one_off', p_entrada_recebida, v_hoje, v_hoje, p_entrada_recebida, 'Entrada · ' || v_nome, 'paid');
        END IF;
        v_resto := v_lead.one_off_value - p_entrada_recebida;
        v_n := GREATEST(COALESCE(p_entrada_parcelas, 1), 1);
        FOR i IN 1..v_n LOOP
          -- A última parcela acerta o arredondamento.
          v_parcela := CASE WHEN i = v_n THEN v_resto - round(v_resto / v_n, 2) * (v_n - 1) ELSE round(v_resto / v_n, 2) END;
          INSERT INTO public.billing (client_id, type, amount, due_date, description, status)
          VALUES (p_client_id, 'one_off', v_parcela, (v_hoje + pg_catalog.make_interval(months => i))::date, 'Entrada · ' || v_nome || ' · parcela ' || i || '/' || v_n, 'pending');
        END LOOP;
      END IF;
    END IF;
  END IF;

  UPDATE public.commercial_leads SET
    stage = 'ganho',
    closed_at = pg_catalog.now(),
    lost_reason = NULL,
    won_client_id = p_client_id,
    company = COALESCE(NULLIF(btrim(p_empresa), ''), company),
    email = COALESCE(NULLIF(btrim(p_email), ''), email),
    whatsapp = COALESCE(NULLIF(btrim(p_whatsapp), ''), whatsapp),
    entrada_recebida = p_entrada_recebida,
    entrada_parcelas = p_entrada_parcelas,
    mensalidade_inicio = p_mensalidade_inicio
  WHERE id = p_lead_id;

  INSERT INTO public.commercial_lead_events (lead_id, kind, from_stage, to_stage, note, created_by)
  VALUES (p_lead_id, 'stage', v_lead.stage, 'ganho', CASE WHEN v_ja_tem_financeiro THEN 'Ligado a um cliente que já existia.' ELSE 'Cliente cadastrado no ganho.' END, auth.uid());

  RETURN jsonb_build_object('client_id', p_client_id, 'vinculado', v_ja_tem_financeiro, 'recuperada', false);
END
$$;

REVOKE ALL ON FUNCTION public.crm_ganho_cadastrar(uuid, uuid, text, text, text, numeric, integer, date, date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_ganho_cadastrar(uuid, uuid, text, text, text, numeric, integer, date, date, boolean) TO authenticated;
