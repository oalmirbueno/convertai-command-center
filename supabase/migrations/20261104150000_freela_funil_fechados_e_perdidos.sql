-- Funil do Freela: Fechados vira cliente, Perdidos guarda o motivo (04/11/2026).
--
-- Dono: "quando fecha a venda tem que ir para uma casa de fechados, com um botão Transformar em cliente: cria o
-- cliente, o projeto, pergunta se foi pago e qual o plano; se foi pago vai para o financeiro e conta como recorrente.
-- O perdido tem a lista, por que perdeu, para fazer follow-up e tentar recuperar. O freela é um caixinha separado,
-- mas entra no valor geral."
--
-- 1. freela_propostas: motivo da perda, data de retomada e o elo com o cliente criado.
-- 2. profiles.origem_aquisicao: marca o cliente que veio do Freela. As cobranças dele são comuns (entram nos números
--    gerais e o gatilho da renovação gera as próximas), e o filtro de origem do /financeiro continua achando a origem.
-- 3. freela_transformar_em_cliente: tudo numa transação, só admin (é quem escreve no billing). Repetir não duplica.
-- Valor em dólar não vira cobrança comum (billing_origem_chk exige real): fica em parcela no caixa do Freela.

ALTER TABLE public.freela_propostas
  ADD COLUMN IF NOT EXISTS motivo_perda text,
  ADD COLUMN IF NOT EXISTS perdida_em timestamptz,
  ADD COLUMN IF NOT EXISTS follow_up_em date,
  ADD COLUMN IF NOT EXISTS convertida_em timestamptz,
  ADD COLUMN IF NOT EXISTS convertida_client_id uuid REFERENCES public.profiles(id);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS origem_aquisicao text;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_origem_aquisicao_chk;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_origem_aquisicao_chk CHECK (origem_aquisicao IS NULL OR origem_aquisicao IN ('freela'));

CREATE OR REPLACE FUNCTION public.freela_transformar_em_cliente(
  p_proposta_id uuid,
  p_modelo text,
  p_valor numeric,
  p_plano_nome text DEFAULT NULL,
  p_pago boolean DEFAULT false,
  p_vencimento date DEFAULT NULL,
  p_tipo_projeto text DEFAULT 'other',
  p_prazo date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_proposta public.freela_propostas%ROWTYPE;
  v_contato public.freela_contatos%ROWTYPE;
  v_perfil public.profiles%ROWTYPE;
  v_client_id uuid;
  v_nome text;
  v_hoje date := (pg_catalog.now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_vencimento date;
  v_billing_id uuid;
  v_projeto_id uuid;
  v_freela_projeto_id uuid;
  v_tem_parcelas boolean;
BEGIN
  IF NOT COALESCE(public.has_role(auth.uid(), 'admin'::public.app_role), false) THEN
    RAISE EXCEPTION 'Só o admin transforma em cliente: esse passo escreve no financeiro.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_proposta FROM public.freela_propostas WHERE id = p_proposta_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proposta não encontrada.'; END IF;
  IF v_proposta.convertida_em IS NOT NULL THEN
    RETURN jsonb_build_object('client_id', v_proposta.convertida_client_id, 'recuperada', true);
  END IF;
  IF v_proposta.status <> 'aceita' THEN RAISE EXCEPTION 'Só proposta fechada vira cliente.'; END IF;
  IF p_modelo NOT IN ('recorrente', 'avulso') THEN RAISE EXCEPTION 'Escolha plano mensal ou projeto único.'; END IF;
  IF p_valor IS NULL OR p_valor <= 0 THEN RAISE EXCEPTION 'Informe um valor maior que zero.'; END IF;
  IF v_proposta.moeda <> 'BRL' AND p_modelo = 'recorrente' THEN
    RAISE EXCEPTION 'Plano mensal é em real. Proposta em dólar fica no caixa do Freela.';
  END IF;

  SELECT * INTO v_contato FROM public.freela_contatos WHERE id = v_proposta.contato_id;
  v_client_id := public.freela_promover_a_cliente(v_proposta.contato_id, false);
  SELECT * INTO v_perfil FROM public.profiles WHERE id = v_client_id FOR UPDATE;
  v_nome := COALESCE(NULLIF(btrim(v_contato.empresa), ''), NULLIF(btrim(v_perfil.company_name), ''), v_contato.nome);
  v_vencimento := CASE WHEN p_pago THEN v_hoje ELSE COALESCE(p_vencimento, v_hoje) END;

  IF p_modelo = 'recorrente' THEN
    IF v_perfil.plan_status = 'active' AND COALESCE(v_perfil.plan_value, 0) > 0 THEN
      RAISE EXCEPTION 'Este cliente já tem plano ativo. Ajuste o plano na ficha dele.';
    END IF;
    UPDATE public.profiles SET
      company_name = v_nome,
      phone = COALESCE(NULLIF(btrim(phone), ''), v_contato.whatsapp),
      client_type = (CASE WHEN client_type = 'one_off' THEN 'hybrid' ELSE 'recurring' END)::public.client_type,
      plan_value = p_valor,
      plan_name = COALESCE(NULLIF(btrim(p_plano_nome), ''), 'Mensalidade'),
      plan_status = 'active',
      plan_renewal_date = v_vencimento,
      origem_aquisicao = 'freela'
    WHERE id = v_client_id;

    INSERT INTO public.billing (client_id, type, amount, due_date, description, status)
    VALUES (v_client_id, 'renewal', p_valor, v_vencimento, 'Mensalidade · ' || v_nome, 'pending')
    RETURNING id INTO v_billing_id;
    -- Paga depois de nascer: é a passagem para 'paid' que faz o gatilho avançar o ciclo e gerar a próxima mensalidade.
    IF p_pago THEN
      UPDATE public.billing SET status = 'paid', paid_date = v_hoje, paid_amount = p_valor WHERE id = v_billing_id;
    END IF;
  ELSE
    UPDATE public.profiles SET
      company_name = v_nome,
      phone = COALESCE(NULLIF(btrim(phone), ''), v_contato.whatsapp),
      client_type = (CASE WHEN client_type IN ('recurring', 'hybrid') AND COALESCE(plan_value, 0) > 0 THEN 'hybrid' ELSE 'one_off' END)::public.client_type,
      origem_aquisicao = 'freela'
    WHERE id = v_client_id;

    SELECT EXISTS (
      SELECT 1 FROM public.freela_parcelas AS parcela
      JOIN public.freela_projetos AS projeto ON projeto.id = parcela.projeto_id
      WHERE projeto.proposta_id = p_proposta_id AND parcela.status <> 'cancelada'
    ) INTO v_tem_parcelas;

    -- Já tem parcela no caixa do Freela: o dinheiro já está contado, uma cobrança nova contaria duas vezes.
    IF NOT v_tem_parcelas THEN
      IF v_proposta.moeda = 'BRL' THEN
        INSERT INTO public.billing (client_id, type, amount, due_date, paid_date, paid_amount, description, status)
        VALUES (
          v_client_id, 'one_off', p_valor, v_vencimento,
          CASE WHEN p_pago THEN v_hoje END, CASE WHEN p_pago THEN p_valor END,
          'Projeto · ' || v_proposta.titulo, CASE WHEN p_pago THEN 'paid' ELSE 'pending' END
        )
        RETURNING id INTO v_billing_id;
      ELSE
        SELECT id INTO v_freela_projeto_id FROM public.freela_projetos WHERE proposta_id = p_proposta_id LIMIT 1;
        IF v_freela_projeto_id IS NULL THEN
          INSERT INTO public.freela_projetos (proposta_id, contato_id, titulo, escopo, valor_fechado, moeda, promoted_client_id, created_by)
          VALUES (p_proposta_id, v_proposta.contato_id, v_proposta.titulo, v_proposta.escopo, p_valor, v_proposta.moeda, v_client_id, auth.uid())
          RETURNING id INTO v_freela_projeto_id;
        END IF;
        INSERT INTO public.freela_parcelas (projeto_id, numero, valor, moeda, vencimento, status, pago_em)
        VALUES (
          v_freela_projeto_id, 1, p_valor, v_proposta.moeda, v_vencimento,
          CASE WHEN p_pago THEN 'paga' ELSE 'aberta' END, CASE WHEN p_pago THEN v_hoje END
        );
      END IF;
    END IF;
  END IF;

  INSERT INTO public.projects (
    client_id, name, description, project_type, status, progress, start_date, deadline,
    scope, created_by, billing_mode, total_value
  ) VALUES (
    v_client_id, v_proposta.titulo, 'Fechado pelo Freela.', COALESCE(NULLIF(btrim(p_tipo_projeto), ''), 'other'), 'planning', 0,
    v_hoje, COALESCE(p_prazo, v_hoje + 30), v_proposta.escopo #>> '{}', auth.uid(),
    (CASE WHEN p_modelo = 'recorrente' THEN 'included' ELSE 'one_off' END)::public.project_billing_mode,
    CASE WHEN p_modelo = 'avulso' AND v_proposta.moeda = 'BRL' THEN p_valor END
  )
  RETURNING id INTO v_projeto_id;

  UPDATE public.freela_propostas SET convertida_em = pg_catalog.now(), convertida_client_id = v_client_id WHERE id = p_proposta_id;

  RETURN jsonb_build_object('client_id', v_client_id, 'project_id', v_projeto_id, 'billing_id', v_billing_id, 'recuperada', false);
END
$$;

REVOKE ALL ON FUNCTION public.freela_transformar_em_cliente(uuid, text, numeric, text, boolean, date, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.freela_transformar_em_cliente(uuid, text, numeric, text, boolean, date, text, date) TO authenticated;
