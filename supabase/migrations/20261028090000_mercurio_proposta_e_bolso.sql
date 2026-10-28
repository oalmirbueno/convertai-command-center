-- ═══════════════════════════════════════════════════════════════════════
-- Mercúrio conduz até o contrato (28/10/2026, MCP 2.23): pedido de
-- proposta e liberação do Aceleriq de Bolso, com aprovação humana.
--
-- O QUE ESTE ARQUIVO FAZ (só acrescenta; propostas, Bolso, vendas e a
-- Caixa do comercial não mudam):
--   · commercial_pedidos_proposta: o rascunho que o agente monta a partir
--     do lead (negócio, dor, plano sugerido, avulsos, verba e moeda), com
--     o conteúdo nos blocos da proposta e os itens do catálogo. Lead que já
--     é cliente vira proposta em rascunho na hora; lead sem ficha espera o
--     Almir criar o cliente na Mesa Proposta, que nasce com este rascunho.
--   · commercial_bolso_pedidos: o pedido de acesso anual ao Aceleriq de
--     Bolso ligado ao lead, com a política aprovada do momento e o valor.
--     Só libera o direito depois do pagamento confirmado por uma pessoa da
--     administração (comercial_bolso_confirmar_pagamento, no painel) ou
--     por uma compra aprovada que chegou pelo vendas-webhook. Comprovante
--     em imagem nunca libera: não existe caminho que aceite um.
--   · bolso_privado.liberar_pedido_comercial: concede pelo mesmo
--     bolso_privado.conceder (política aprovada, créditos iniciais e
--     validade da política; referência única por pedido, idempotente).
--
-- Acesso: RLS nas duas tabelas; admin e manager leem o pedido de
-- proposta, só admin lê o pedido do Bolso. Ninguém escreve pela API: o
-- MCP grava com a chave de serviço e a confirmação humana passa pela RPC.
--
-- Reverter (lógico): revogar EXECUTE de comercial_bolso_confirmar_pagamento
-- e comercial_bolso_liberar_por_agente; as tabelas ficam com o histórico.
-- Um direito concedido sai por bolso_admin_revogar, como os outros.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

DO $$ BEGIN
  IF to_regclass('public.propostas') IS NULL OR to_regclass('public.commercial_handoffs') IS NULL
     OR to_regclass('public.vendas_eventos') IS NULL OR to_regclass('public.bolso_direitos') IS NULL
     OR to_regprocedure('bolso_privado.conceder(uuid,text,text,text,uuid,timestamptz,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisitos ausentes (propostas, Caixa do comercial, vendas ou Bolso). Parar e conferir o preflight.';
  END IF;
END $$;

-- ─── Pedido de proposta ────────────────────────────────────────────────
CREATE TABLE public.commercial_pedidos_proposta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.commercial_leads(id) ON DELETE CASCADE,
  operador_slug text NOT NULL CHECK (operador_slug ~ '^[a-z0-9_-]{2,40}$'),
  situacao text NOT NULL DEFAULT 'aguardando_cliente' CHECK (situacao IN ('aguardando_cliente', 'rascunho_criado', 'descartado')),
  moeda text NOT NULL DEFAULT 'BRL' CHECK (moeda IN ('BRL', 'USD', 'EUR')),
  -- O que o agente mandou, como mandou (negócio, dor, plano, avulsos, verba).
  pedido jsonb NOT NULL CHECK (jsonb_typeof(pedido) = 'object' AND pg_column_size(pedido) <= 16384),
  -- O rascunho já nos blocos da proposta e os itens com o preço do catálogo.
  conteudo jsonb NOT NULL CHECK (jsonb_typeof(conteudo) = 'object'),
  itens jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(itens) = 'array'),
  notas text NOT NULL DEFAULT '' CHECK (length(notas) <= 6000),
  proposta_id uuid REFERENCES public.propostas(id) ON DELETE SET NULL,
  handoff_id uuid REFERENCES public.commercial_handoffs(id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
-- Um pedido esperando por lead: o agente não abre outro por cima.
CREATE UNIQUE INDEX commercial_pedidos_proposta_um_aberto ON public.commercial_pedidos_proposta (lead_id) WHERE situacao = 'aguardando_cliente';
CREATE INDEX commercial_pedidos_proposta_por_lead ON public.commercial_pedidos_proposta (lead_id, criado_em DESC);

-- ─── Pedido do Aceleriq de Bolso ───────────────────────────────────────
CREATE TABLE public.commercial_bolso_pedidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.commercial_leads(id) ON DELETE SET NULL,
  operador_slug text NOT NULL CHECK (operador_slug ~ '^[a-z0-9_-]{2,40}$'),
  -- A conta da área de membros que recebe o acesso (o e-mail do cadastro).
  email text NOT NULL CHECK (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[a-z]{2,}$' AND length(email) <= 120),
  produto text NOT NULL DEFAULT 'anual' CHECK (produto = 'anual'),
  politica_id uuid NOT NULL REFERENCES public.bolso_politicas(id),
  valor_centavos integer NOT NULL CHECK (valor_centavos BETWEEN 1 AND 100000000),
  moeda text NOT NULL DEFAULT 'BRL' CHECK (moeda = 'BRL'),
  situacao text NOT NULL DEFAULT 'aguardando_pagamento' CHECK (situacao IN ('aguardando_pagamento', 'pagamento_confirmado', 'liberado', 'cancelado')),
  confirmacao_origem text CHECK (confirmacao_origem IN ('pessoa', 'gateway')),
  confirmado_por uuid,
  confirmado_em timestamptz,
  confirmacao_nota text CHECK (confirmacao_nota IS NULL OR length(confirmacao_nota) <= 500),
  vendas_evento_id uuid REFERENCES public.vendas_eventos(id),
  checkout_url text CHECK (checkout_url IS NULL OR checkout_url ~ '^https://'),
  direito_id uuid REFERENCES public.bolso_direitos(id),
  user_id uuid REFERENCES auth.users(id),
  liberado_em timestamptz,
  handoff_id uuid REFERENCES public.commercial_handoffs(id) ON DELETE SET NULL,
  observacao text NOT NULL DEFAULT '' CHECK (length(observacao) <= 1000),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  -- Pagamento confirmado sempre diz quem confirmou: a pessoa ou o evento do gateway.
  CHECK ((situacao IN ('pagamento_confirmado', 'liberado')) = (confirmacao_origem IS NOT NULL AND confirmado_em IS NOT NULL)),
  CHECK (confirmacao_origem IS DISTINCT FROM 'pessoa' OR confirmado_por IS NOT NULL),
  CHECK (confirmacao_origem IS DISTINCT FROM 'gateway' OR vendas_evento_id IS NOT NULL),
  CHECK ((situacao = 'liberado') = (direito_id IS NOT NULL AND user_id IS NOT NULL AND liberado_em IS NOT NULL))
);
CREATE UNIQUE INDEX commercial_bolso_pedidos_um_aberto ON public.commercial_bolso_pedidos (lead_id) WHERE situacao IN ('aguardando_pagamento', 'pagamento_confirmado');
-- Uma compra do gateway paga um pedido só.
CREATE UNIQUE INDEX commercial_bolso_pedidos_evento_unico ON public.commercial_bolso_pedidos (vendas_evento_id) WHERE vendas_evento_id IS NOT NULL;
CREATE INDEX commercial_bolso_pedidos_por_situacao ON public.commercial_bolso_pedidos (situacao, criado_em DESC);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['commercial_pedidos_proposta', 'commercial_bolso_pedidos'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_tocar', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.mesa_tocar_atualizado_em()', t || '_tocar', t);
  END LOOP;
END $$;

CREATE POLICY "comercial admin e manager leem" ON public.commercial_pedidos_proposta
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role));

CREATE POLICY "bolso comercial so admin le" ON public.commercial_bolso_pedidos
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ─── Liberação (interna) ───────────────────────────────────────────────
-- Concede o anual à conta confirmada com o e-mail do pedido. Só roda com o
-- pagamento já confirmado (pessoa ou gateway). Sem conta, devolve o motivo e
-- não muda nada: a pessoa cria a conta e a liberação roda de novo.
CREATE FUNCTION bolso_privado.liberar_pedido_comercial(_pedido uuid, _ator uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.commercial_bolso_pedidos; u uuid; v_origem text; v_ref text; novo uuid;
BEGIN
  SELECT * INTO p FROM public.commercial_bolso_pedidos WHERE id = _pedido FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Pedido do Bolso não encontrado' USING ERRCODE = '22023'; END IF;
  IF p.situacao = 'liberado' THEN
    RETURN jsonb_build_object('liberado', true, 'ja_liberado', true, 'direito_id', p.direito_id, 'user_id', p.user_id);
  END IF;
  IF p.situacao <> 'pagamento_confirmado' THEN
    RETURN jsonb_build_object('liberado', false, 'motivo', 'pagamento_nao_confirmado');
  END IF;
  SELECT id INTO u FROM auth.users
   WHERE lower(email) = p.email AND email_confirmed_at IS NOT NULL AND NOT COALESCE(is_anonymous, false)
   ORDER BY created_at LIMIT 1;
  IF u IS NULL THEN
    RETURN jsonb_build_object('liberado', false, 'motivo', 'conta_ausente', 'email', p.email);
  END IF;
  v_origem := CASE WHEN p.confirmacao_origem = 'gateway' THEN 'pagamento' ELSE 'validacao_manual' END;
  v_ref := 'comercial:' || p.id::text;
  -- A política aprovada é conferida de novo dentro do conceder (arquivada ou rascunho recusa).
  novo := bolso_privado.conceder(u, 'anual', v_origem, v_ref, p.politica_id, now(), _ator);
  IF novo IS NULL THEN
    SELECT id INTO novo FROM public.bolso_direitos WHERE tipo = 'anual' AND origem = v_origem AND referencia = v_ref;
  END IF;
  UPDATE public.commercial_bolso_pedidos
     SET situacao = 'liberado', direito_id = novo, user_id = u, liberado_em = now()
   WHERE id = p.id;
  INSERT INTO public.bolso_auditoria (ator, acao, alvo, dados)
  VALUES (_ator, 'direito_concedido_comercial', novo::text,
    jsonb_build_object('pedido', p.id, 'lead_id', p.lead_id, 'confirmacao', p.confirmacao_origem, 'operador', p.operador_slug));
  IF p.lead_id IS NOT NULL THEN
    INSERT INTO public.commercial_lead_events (lead_id, kind, note, created_by)
    VALUES (p.lead_id, 'nota', 'Aceleriq de Bolso liberado para ' || p.email || ' (pagamento confirmado '
      || CASE WHEN p.confirmacao_origem = 'gateway' THEN 'pelo gateway' ELSE 'pela equipe' END || ').', _ator);
  END IF;
  RETURN jsonb_build_object('liberado', true, 'ja_liberado', false, 'direito_id', novo, 'user_id', u);
END $$;

-- ─── Confirmação humana (painel, só administração) ─────────────────────
-- Quem confirma diz onde viu o dinheiro (extrato, Pix, gateway). Confirmado,
-- já tenta liberar; sem conta, fica confirmado e libera quando ela existir.
CREATE FUNCTION public.comercial_bolso_confirmar_pagamento(_pedido uuid, _nota text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a uuid := auth.uid(); p public.commercial_bolso_pedidos; v_nota text := btrim(COALESCE(_nota, ''));
BEGIN
  IF a IS NULL OR NOT public.has_role(a, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Somente a administração confirma pagamento' USING ERRCODE = '42501';
  END IF;
  IF length(v_nota) < 5 THEN
    RAISE EXCEPTION 'Diga onde conferiu o dinheiro (extrato, Pix ou gateway). Comprovante em imagem não vale.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO p FROM public.commercial_bolso_pedidos WHERE id = _pedido FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Pedido do Bolso não encontrado' USING ERRCODE = '22023'; END IF;
  IF p.situacao = 'cancelado' THEN RAISE EXCEPTION 'Pedido cancelado' USING ERRCODE = '22023'; END IF;
  IF p.situacao = 'aguardando_pagamento' THEN
    UPDATE public.commercial_bolso_pedidos
       SET situacao = 'pagamento_confirmado', confirmacao_origem = 'pessoa', confirmado_por = a,
           confirmado_em = now(), confirmacao_nota = left(v_nota, 500)
     WHERE id = p.id;
    IF p.lead_id IS NOT NULL THEN
      INSERT INTO public.commercial_lead_events (lead_id, kind, note, created_by)
      VALUES (p.lead_id, 'nota', left('Pagamento do Aceleriq de Bolso confirmado pela equipe: ' || v_nota, 400), a);
    END IF;
  END IF;
  RETURN bolso_privado.liberar_pedido_comercial(p.id, a);
END $$;

-- ─── Liberação pelo agente (MCP, chave de serviço) ─────────────────────
-- O agente não confirma pagamento: ou a equipe já confirmou, ou existe uma
-- compra aprovada do gateway da casa (vendas-webhook) para este lead ou
-- e-mail, no valor do pedido, depois do pedido, sem reembolso, chargeback ou
-- cancelamento depois dela, e ainda não usada por outro pedido.
CREATE FUNCTION public.comercial_bolso_liberar_por_agente(_pedido uuid, _operador text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.commercial_bolso_pedidos; ev uuid;
BEGIN
  PERFORM bolso_privado.exigir_servico();
  SELECT * INTO p FROM public.commercial_bolso_pedidos WHERE id = _pedido FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Pedido do Bolso não encontrado' USING ERRCODE = '22023'; END IF;
  IF p.situacao = 'cancelado' THEN RAISE EXCEPTION 'Pedido cancelado' USING ERRCODE = '22023'; END IF;
  IF p.situacao = 'aguardando_pagamento' THEN
    SELECT e.id INTO ev FROM public.vendas_eventos e
     WHERE e.client_id IS NULL
       AND e.tipo = 'compra_aprovada'
       AND (e.lead_id = p.lead_id OR lower(e.comprador_email) = p.email)
       AND e.valor IS NOT NULL AND round(e.valor * 100) >= p.valor_centavos
       AND COALESCE(e.moeda, 'BRL') = p.moeda
       AND e.recebido_em >= p.criado_em
       AND NOT EXISTS (
         SELECT 1 FROM public.vendas_eventos r
          WHERE r.integracao_id = e.integracao_id
            AND r.tipo IN ('reembolso', 'chargeback', 'cancelamento')
            AND (r.lead_id = e.lead_id OR lower(r.comprador_email) = lower(e.comprador_email))
            AND r.recebido_em >= e.recebido_em)
       AND NOT EXISTS (SELECT 1 FROM public.commercial_bolso_pedidos o WHERE o.vendas_evento_id = e.id)
     ORDER BY e.recebido_em
     LIMIT 1;
    IF ev IS NULL THEN
      RETURN jsonb_build_object('liberado', false, 'motivo', 'pagamento_nao_confirmado');
    END IF;
    UPDATE public.commercial_bolso_pedidos
       SET situacao = 'pagamento_confirmado', confirmacao_origem = 'gateway', vendas_evento_id = ev,
           confirmado_em = now(), confirmacao_nota = 'Compra aprovada recebida pelo gateway (' || left(COALESCE(_operador, ''), 40) || ' conferiu).'
     WHERE id = p.id;
  END IF;
  RETURN bolso_privado.liberar_pedido_comercial(p.id, NULL);
END $$;

REVOKE ALL ON FUNCTION bolso_privado.liberar_pedido_comercial(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.comercial_bolso_confirmar_pagamento(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comercial_bolso_confirmar_pagamento(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.comercial_bolso_liberar_por_agente(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comercial_bolso_liberar_por_agente(uuid, text) TO service_role;

COMMIT;

-- Conferência depois de aplicar (todas true):
-- select to_regclass('public.commercial_pedidos_proposta') is not null, to_regclass('public.commercial_bolso_pedidos') is not null,
--   to_regprocedure('public.comercial_bolso_confirmar_pagamento(uuid,text)') is not null,
--   to_regprocedure('public.comercial_bolso_liberar_por_agente(uuid,text)') is not null;
