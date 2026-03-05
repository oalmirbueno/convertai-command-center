
-- Table for project payment plans (non-recurring projects)
CREATE TABLE public.project_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  total_value numeric NOT NULL,
  entry_percentage numeric NOT NULL DEFAULT 50,
  entry_amount numeric NOT NULL,
  installments_count integer NOT NULL DEFAULT 1,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id)
);

-- Table for individual installments
CREATE TABLE public.payment_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.project_payments(id) ON DELETE CASCADE,
  installment_number integer NOT NULL,
  amount numeric NOT NULL,
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  paid_date date,
  description text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.project_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_installments ENABLE ROW LEVEL SECURITY;

-- RLS for project_payments
CREATE POLICY "project_payments_select" ON public.project_payments FOR SELECT
  USING (client_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "project_payments_insert" ON public.project_payments FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "project_payments_update" ON public.project_payments FOR UPDATE
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "project_payments_delete" ON public.project_payments FOR DELETE
  USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS for payment_installments
CREATE POLICY "payment_installments_select" ON public.payment_installments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_payments pp
      WHERE pp.id = payment_installments.payment_id
      AND (pp.client_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
    )
  );

CREATE POLICY "payment_installments_insert" ON public.payment_installments FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "payment_installments_update" ON public.payment_installments FOR UPDATE
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "payment_installments_delete" ON public.payment_installments FOR DELETE
  USING (has_role(auth.uid(), 'admin'::app_role));
