-- Freela mesa: schema + billing multimoeda (sem UI/MCP).
-- Decisões Almir 03/11/2026: promoção contato→cliente ok; USD sem conversão no rollup.
-- AVISO APP: queries do /financeiro que somam billing.amount DEVEM filtrar currency='BRL'
--            no mesmo deploy do código da UI (esta migration sozinha não altera o front).

-- 1) Tabelas freela_*
CREATE TABLE public.freela_contatos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  empresa text,
  email text,
  whatsapp text,
  pais text,
  moeda_preferida text NOT NULL DEFAULT 'BRL' CHECK (moeda_preferida IN ('BRL', 'USD')),
  notes text,
  promoted_client_id uuid REFERENCES public.profiles(id),
  archived_at timestamptz,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.freela_propostas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contato_id uuid NOT NULL REFERENCES public.freela_contatos(id),
  titulo text NOT NULL,
  escopo jsonb,
  valor numeric(12,2) NOT NULL,
  moeda text NOT NULL CHECK (moeda IN ('BRL', 'USD')),
  status text NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho', 'enviada', 'negociacao', 'aceita', 'perdida')),
  link_externo text,
  validade_ate date,
  notes text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.freela_projetos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposta_id uuid REFERENCES public.freela_propostas(id),
  contato_id uuid NOT NULL REFERENCES public.freela_contatos(id),
  titulo text NOT NULL,
  escopo jsonb,
  valor_fechado numeric(12,2) NOT NULL,
  moeda text NOT NULL CHECK (moeda IN ('BRL', 'USD')),
  status text NOT NULL DEFAULT 'kickoff'
    CHECK (status IN ('kickoff', 'em_andamento', 'entrega', 'pago', 'arquivado')),
  prazo_date date,
  promoted_client_id uuid REFERENCES public.profiles(id),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- billing_id sem FK ainda (ciclo com billing.freela_parcela_id)
CREATE TABLE public.freela_parcelas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES public.freela_projetos(id) ON DELETE CASCADE,
  numero integer NOT NULL,
  valor numeric(12,2) NOT NULL,
  moeda text NOT NULL CHECK (moeda IN ('BRL', 'USD')),
  vencimento date NOT NULL,
  status text NOT NULL DEFAULT 'aberta'
    CHECK (status IN ('aberta', 'paga', 'atrasada', 'cancelada')),
  pago_em date,
  billing_id uuid,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (projeto_id, numero)
);

CREATE INDEX freela_propostas_contato_id_idx ON public.freela_propostas (contato_id);
CREATE INDEX freela_propostas_status_idx ON public.freela_propostas (status);
CREATE INDEX freela_projetos_contato_id_idx ON public.freela_projetos (contato_id);
CREATE INDEX freela_projetos_status_idx ON public.freela_projetos (status);
CREATE INDEX freela_parcelas_projeto_id_idx ON public.freela_parcelas (projeto_id);
CREATE INDEX freela_parcelas_status_idx ON public.freela_parcelas (status);
CREATE INDEX freela_parcelas_vencimento_idx ON public.freela_parcelas (vencimento);

-- 2) Alter billing
ALTER TABLE public.billing
  ALTER COLUMN client_id DROP NOT NULL;

ALTER TABLE public.billing
  ADD COLUMN currency text NOT NULL DEFAULT 'BRL',
  ADD COLUMN freela_parcela_id uuid;

ALTER TABLE public.billing
  ADD CONSTRAINT billing_currency_chk CHECK (currency IN ('BRL', 'USD'));

ALTER TABLE public.billing
  ADD CONSTRAINT billing_freela_parcela_id_fkey
    FOREIGN KEY (freela_parcela_id) REFERENCES public.freela_parcelas(id);

ALTER TABLE public.billing
  ADD CONSTRAINT billing_freela_parcela_id_key UNIQUE (freela_parcela_id);

ALTER TABLE public.billing
  ADD CONSTRAINT billing_origem_chk CHECK (
    (type = 'freela' AND freela_parcela_id IS NOT NULL)
    OR (type <> 'freela' AND client_id IS NOT NULL AND currency = 'BRL')
  );

ALTER TABLE public.freela_parcelas
  ADD CONSTRAINT freela_parcelas_billing_id_fkey
    FOREIGN KEY (billing_id) REFERENCES public.billing(id);

-- 3) updated_at triggers (helper existente)
CREATE TRIGGER freela_contatos_updated_at
  BEFORE UPDATE ON public.freela_contatos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER freela_propostas_updated_at
  BEFORE UPDATE ON public.freela_propostas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER freela_projetos_updated_at
  BEFORE UPDATE ON public.freela_projetos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER freela_parcelas_updated_at
  BEFORE UPDATE ON public.freela_parcelas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4) Moeda da parcela = moeda do projeto
CREATE OR REPLACE FUNCTION public.freela_parcela_moeda_match()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  v_moeda text;
BEGIN
  SELECT p.moeda INTO v_moeda
  FROM public.freela_projetos p
  WHERE p.id = NEW.projeto_id;

  IF v_moeda IS NULL THEN
    RAISE EXCEPTION 'freela_projetos % não encontrado', NEW.projeto_id;
  END IF;

  IF NEW.moeda IS DISTINCT FROM v_moeda THEN
    RAISE EXCEPTION 'freela_parcelas.moeda (%) deve ser igual a freela_projetos.moeda (%)', NEW.moeda, v_moeda;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER freela_parcelas_moeda_match
  BEFORE INSERT OR UPDATE OF moeda, projeto_id ON public.freela_parcelas
  FOR EACH ROW EXECUTE FUNCTION public.freela_parcela_moeda_match();

-- 5) Sync parcela → billing
CREATE OR REPLACE FUNCTION public.freela_parcela_sync_billing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_billing_id uuid;
  v_billing_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'cancelada' AND NEW.status = 'cancelada' THEN
    -- ainda sincroniza valores se mudarem
    NULL;
  END IF;

  v_billing_status := CASE NEW.status
    WHEN 'paga' THEN 'paid'
    WHEN 'cancelada' THEN 'cancelled'
    ELSE 'pending'
  END;

  IF NEW.billing_id IS NULL THEN
    INSERT INTO public.billing (
      client_id,
      type,
      amount,
      status,
      due_date,
      paid_date,
      description,
      currency,
      freela_parcela_id
    ) VALUES (
      NULL,
      'freela',
      NEW.valor,
      v_billing_status,
      NEW.vencimento,
      NEW.pago_em,
      COALESCE(NEW.description, 'Freela parcela ' || NEW.numero::text),
      NEW.moeda,
      NEW.id
    )
    RETURNING id INTO v_billing_id;

    UPDATE public.freela_parcelas
    SET billing_id = v_billing_id
    WHERE id = NEW.id;

    NEW.billing_id := v_billing_id;
  ELSE
    UPDATE public.billing
    SET
      amount = NEW.valor,
      status = v_billing_status,
      due_date = NEW.vencimento,
      paid_date = NEW.pago_em,
      description = COALESCE(NEW.description, description),
      currency = NEW.moeda,
      freela_parcela_id = NEW.id,
      client_id = NULL,
      type = 'freela'
    WHERE id = NEW.billing_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER freela_parcelas_sync_billing
  AFTER INSERT OR UPDATE OF valor, moeda, vencimento, status, pago_em, description
  ON public.freela_parcelas
  FOR EACH ROW EXECUTE FUNCTION public.freela_parcela_sync_billing();

-- 6) Promoção: liga profile existente (criar auth.users fica no MCP)
CREATE OR REPLACE FUNCTION public.freela_promover_a_cliente(
  p_contato_id uuid,
  p_criar_org boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_contato public.freela_contatos%ROWTYPE;
  v_client_id uuid;
  v_org_id uuid;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'somente admin ou manager podem promover contato freela';
  END IF;

  SELECT * INTO v_contato
  FROM public.freela_contatos
  WHERE id = p_contato_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'contato freela % não encontrado', p_contato_id;
  END IF;

  IF v_contato.promoted_client_id IS NOT NULL THEN
    RETURN v_contato.promoted_client_id;
  END IF;

  IF v_contato.email IS NULL OR btrim(v_contato.email) = '' THEN
    RAISE EXCEPTION 'contato freela precisa de email para promover';
  END IF;

  SELECT p.id INTO v_client_id
  FROM public.profiles p
  WHERE lower(p.email) = lower(v_contato.email)
  LIMIT 1;

  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'nenhum profile com email %; crie o usuário via Auth Admin (MCP) e chame de novo', v_contato.email;
  END IF;

  -- user_roles tem UNIQUE(user_id): um papel por usuário
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_client_id
  ) THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_client_id, 'client'::public.app_role);
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_client_id AND ur.role = 'client'::public.app_role
  ) THEN
    RAISE EXCEPTION 'profile % já tem outro papel em user_roles; não dá para promover a client', v_client_id;
  END IF;

  UPDATE public.freela_contatos
  SET promoted_client_id = v_client_id
  WHERE id = p_contato_id;

  UPDATE public.freela_projetos
  SET promoted_client_id = v_client_id
  WHERE contato_id = p_contato_id AND promoted_client_id IS NULL;

  IF p_criar_org THEN
    SELECT o.id INTO v_org_id
    FROM public.commercial_organizations o
    WHERE o.client_id = v_client_id
      AND o.archived_at IS NULL
    ORDER BY o.created_at
    LIMIT 1;

    IF v_org_id IS NULL THEN
      INSERT INTO public.commercial_organizations (name, client_id, created_by)
      VALUES (COALESCE(v_contato.empresa, v_contato.nome), v_client_id, auth.uid())
      RETURNING id INTO v_org_id;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.commercial_contacts c
      WHERE c.organization_id = v_org_id
        AND lower(COALESCE(c.email, '')) = lower(v_contato.email)
        AND c.archived_at IS NULL
    ) THEN
      INSERT INTO public.commercial_contacts (
        organization_id, name, email, whatsapp, is_primary, created_by
      ) VALUES (
        v_org_id, v_contato.nome, v_contato.email, v_contato.whatsapp, true, auth.uid()
      );
    END IF;
  END IF;

  RETURN v_client_id;
END;
$$;

REVOKE ALL ON FUNCTION public.freela_promover_a_cliente(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.freela_promover_a_cliente(uuid, boolean) TO authenticated;

-- 7) RLS
ALTER TABLE public.freela_contatos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.freela_propostas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.freela_projetos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.freela_parcelas ENABLE ROW LEVEL SECURITY;

CREATE POLICY freela_contatos_staff ON public.freela_contatos
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

CREATE POLICY freela_propostas_staff ON public.freela_propostas
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

CREATE POLICY freela_projetos_staff ON public.freela_projetos
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

CREATE POLICY freela_parcelas_staff ON public.freela_parcelas
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

COMMENT ON TABLE public.freela_contatos IS 'Mesa Freela: contatos (podem promover a cliente de agência).';
COMMENT ON TABLE public.freela_propostas IS 'Mesa Freela: propostas BRL/USD.';
COMMENT ON TABLE public.freela_projetos IS 'Mesa Freela: projetos fechados.';
COMMENT ON TABLE public.freela_parcelas IS 'Mesa Freela: parcelas; sync → billing type=freela.';
COMMENT ON COLUMN public.billing.currency IS 'Moeda da linha. Rollup geral = SUM WHERE currency=BRL. Sem FX.';
COMMENT ON COLUMN public.billing.freela_parcela_id IS 'Origem freela; type deve ser freela quando preenchido.';
