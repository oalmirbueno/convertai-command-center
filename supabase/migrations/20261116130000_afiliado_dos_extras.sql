-- Indicação (afiliado) nos extras do cliente (16/11/2026, pedido do dono).
--
-- "Uma opção de afiliados onde eu consigo colocar a % e repassar para a pessoa que indicou, sobre a
--  mensalidade do projeto."
--
-- O que entra:
--   1. client_extras ganha afiliado_nome e afiliado_percentual (os dois opcionais, juntos).
--   2. expenses ganha billing_id: o repasse sabe de qual recebimento veio. O índice único impede que o
--      mesmo recebimento gere dois repasses.
--   3. Gatilho em billing: quando uma cobrança de extra com afiliado vira paga, nasce em Despesas um
--      repasse "a pagar" (categoria comissoes) com o percentual sobre o que entrou. Se o pagamento for
--      desfeito, o repasse que ainda não foi pago sai junto. Repasse já pago nunca é apagado.
--
-- Não envia nada a ninguém e não paga nada: o repasse fica em Despesas para o dono pagar.

ALTER TABLE public.client_extras ADD COLUMN IF NOT EXISTS afiliado_nome text;
ALTER TABLE public.client_extras ADD COLUMN IF NOT EXISTS afiliado_percentual numeric(6, 3);
ALTER TABLE public.client_extras DROP CONSTRAINT IF EXISTS client_extras_afiliado_valido;
ALTER TABLE public.client_extras ADD CONSTRAINT client_extras_afiliado_valido CHECK (
  afiliado_percentual IS NULL
  OR (afiliado_percentual > 0 AND afiliado_percentual <= 100 AND length(btrim(COALESCE(afiliado_nome, ''))) >= 2)
);

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS billing_id uuid REFERENCES public.billing(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS expenses_billing_uidx ON public.expenses (billing_id) WHERE billing_id IS NOT NULL;

CREATE OR REPLACE FUNCTION app_private.repasse_do_afiliado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _e public.client_extras%ROWTYPE;
  _cliente text;
  _base numeric;
  _valor numeric;
BEGIN
  IF NEW.extra_id IS NULL THEN RETURN NEW; END IF;

  -- Pagamento desfeito: o repasse que ainda não foi pago sai junto.
  IF NEW.status <> 'paid' THEN
    IF TG_OP = 'UPDATE' AND OLD.status = 'paid' THEN
      DELETE FROM public.expenses WHERE billing_id = NEW.id AND status <> 'paid';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'paid' THEN RETURN NEW; END IF;

  SELECT * INTO _e FROM public.client_extras WHERE id = NEW.extra_id;
  IF NOT FOUND OR _e.afiliado_percentual IS NULL OR _e.afiliado_percentual <= 0 THEN RETURN NEW; END IF;

  _base := COALESCE(NULLIF(NEW.paid_amount, 0), NEW.amount);
  _valor := round(_base * _e.afiliado_percentual / 100, 2);
  IF _valor <= 0 THEN RETURN NEW; END IF;
  SELECT COALESCE(NULLIF(btrim(company_name), ''), full_name, 'cliente') INTO _cliente FROM public.profiles WHERE id = NEW.client_id;

  INSERT INTO public.expenses (description, category, amount, due_date, status, recurrence, supplier, notes, billing_id)
  VALUES (
    'Repasse · ' || _e.afiliado_nome || ' · ' || _cliente,
    'comissoes',
    _valor,
    COALESCE(NEW.paid_date, (now() AT TIME ZONE 'America/Sao_Paulo')::date),
    'pending',
    'none',
    _e.afiliado_nome,
    replace(rtrim(rtrim(_e.afiliado_percentual::text, '0'), '.'), '.', ',') || '% de ' || COALESCE(NEW.description, _e.nome),
    NEW.id)
  ON CONFLICT (billing_id) WHERE billing_id IS NOT NULL DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.repasse_do_afiliado() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS billing_repasse_do_afiliado ON public.billing;
CREATE TRIGGER billing_repasse_do_afiliado
  AFTER INSERT OR UPDATE OF status, paid_amount ON public.billing
  FOR EACH ROW EXECUTE FUNCTION app_private.repasse_do_afiliado();
