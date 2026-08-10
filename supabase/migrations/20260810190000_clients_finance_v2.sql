BEGIN;

-- Clientes + Financeiro V2 is additive. Legacy ledgers remain intact.
CREATE TABLE IF NOT EXISTS public.finance_plan_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  display_name text NOT NULL,
  description text,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  archived_at timestamptz,
  CONSTRAINT finance_plan_catalog_code_ck
    CHECK (code ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  CONSTRAINT finance_plan_catalog_name_ck
    CHECK (length(btrim(display_name)) BETWEEN 2 AND 120)
);

CREATE TABLE IF NOT EXISTS public.finance_plan_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL
    REFERENCES public.finance_plan_catalog(id) ON DELETE RESTRICT,
  version_number integer NOT NULL,
  monthly_price numeric(14,2) NOT NULL,
  setup_fee numeric(14,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'BRL',
  billing_cycle text NOT NULL DEFAULT 'monthly',
  effective_from date NOT NULL,
  effective_to date,
  status text NOT NULL DEFAULT 'draft',
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT finance_plan_versions_plan_version_uq
    UNIQUE (plan_id, version_number),
  CONSTRAINT finance_plan_versions_version_ck CHECK (version_number > 0),
  CONSTRAINT finance_plan_versions_monthly_price_ck
    CHECK (monthly_price >= 0 AND monthly_price = round(monthly_price, 2)),
  CONSTRAINT finance_plan_versions_setup_fee_ck
    CHECK (setup_fee >= 0 AND setup_fee = round(setup_fee, 2)),
  CONSTRAINT finance_plan_versions_currency_ck CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT finance_plan_versions_cycle_ck
    CHECK (billing_cycle IN (
      'monthly', 'quarterly', 'semiannual', 'annual', 'one_time'
    )),
  CONSTRAINT finance_plan_versions_status_ck
    CHECK (status IN ('draft', 'published', 'retired')),
  CONSTRAINT finance_plan_versions_window_ck
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT finance_plan_versions_features_ck
    CHECK (jsonb_typeof(features) = 'object')
);

CREATE TABLE IF NOT EXISTS public.finance_client_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  plan_version_id uuid NOT NULL
    REFERENCES public.finance_plan_versions(id) ON DELETE RESTRICT,
  status text NOT NULL,
  agreed_monthly_amount numeric(14,2) NOT NULL,
  currency text NOT NULL DEFAULT 'BRL',
  billing_day smallint NOT NULL DEFAULT 10,
  starts_on date NOT NULL,
  ends_on date,
  next_billing_date date,
  is_custom boolean NOT NULL DEFAULT false,
  review_status text NOT NULL DEFAULT 'not_required',
  source text NOT NULL DEFAULT 'admin',
  source_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  CONSTRAINT finance_client_subscriptions_status_ck
    CHECK (status IN ('pending', 'active', 'paused', 'ended', 'cancelled')),
  CONSTRAINT finance_client_subscriptions_amount_ck
    CHECK (
      agreed_monthly_amount >= 0
      AND agreed_monthly_amount = round(agreed_monthly_amount, 2)
    ),
  CONSTRAINT finance_client_subscriptions_currency_ck
    CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT finance_client_subscriptions_billing_day_ck
    CHECK (billing_day BETWEEN 1 AND 28),
  CONSTRAINT finance_client_subscriptions_window_ck
    CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT finance_client_subscriptions_review_ck
    CHECK (review_status IN ('needs_review', 'reviewed', 'not_required')),
  CONSTRAINT finance_client_subscriptions_source_ck
    CHECK (source IN ('legacy_profile', 'admin', 'import', 'system')),
  CONSTRAINT finance_client_subscriptions_source_details_ck
    CHECK (jsonb_typeof(source_details) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS finance_client_subscriptions_one_open_uq
  ON public.finance_client_subscriptions(client_id)
  WHERE ends_on IS NULL AND status IN ('pending', 'active', 'paused');
CREATE UNIQUE INDEX IF NOT EXISTS finance_client_subscriptions_legacy_uq
  ON public.finance_client_subscriptions(client_id)
  WHERE source = 'legacy_profile';
CREATE INDEX IF NOT EXISTS finance_client_subscriptions_client_idx
  ON public.finance_client_subscriptions(client_id, starts_on DESC);
CREATE INDEX IF NOT EXISTS finance_client_subscriptions_plan_version_idx
  ON public.finance_client_subscriptions(plan_version_id);
CREATE INDEX IF NOT EXISTS finance_plan_versions_effective_idx
  ON public.finance_plan_versions(plan_id, effective_from DESC);

CREATE TABLE IF NOT EXISTS public.finance_settings (
  id smallint PRIMARY KEY DEFAULT 1,
  default_currency text NOT NULL DEFAULT 'BRL',
  default_billing_day smallint NOT NULL DEFAULT 10,
  tax_rate_percent numeric(7,4) NOT NULL DEFAULT 0,
  project_receipts_mode text NOT NULL DEFAULT 'separate',
  closing_requires_completed_month boolean NOT NULL DEFAULT true,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  monthly_revenue_goal numeric(14,2) NOT NULL DEFAULT 100000,
  retention_percent numeric(7,4) NOT NULL DEFAULT 10,
  reserve_months numeric(5,2) NOT NULL DEFAULT 3,
  minimum_margin_percent numeric(7,4) NOT NULL DEFAULT 30,
  target_pro_labore numeric(14,2) NOT NULL DEFAULT 10000,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT finance_settings_singleton_ck CHECK (id = 1),
  CONSTRAINT finance_settings_currency_ck
    CHECK (default_currency ~ '^[A-Z]{3}$'),
  CONSTRAINT finance_settings_billing_day_ck
    CHECK (default_billing_day BETWEEN 1 AND 28),
  CONSTRAINT finance_settings_tax_ck
    CHECK (
      tax_rate_percent BETWEEN 0 AND 100
      AND tax_rate_percent = round(tax_rate_percent, 4)
    ),
  CONSTRAINT finance_settings_project_mode_ck
    CHECK (project_receipts_mode IN ('separate', 'included_in_billing')),
  CONSTRAINT finance_settings_timezone_ck
    CHECK (length(btrim(timezone)) BETWEEN 1 AND 80),
  CONSTRAINT finance_settings_goals_ck CHECK (
    monthly_revenue_goal >= 0
    AND monthly_revenue_goal = round(monthly_revenue_goal, 2)
    AND retention_percent BETWEEN 0 AND 100
    AND retention_percent = round(retention_percent, 4)
    AND reserve_months BETWEEN 0 AND 60
    AND reserve_months = round(reserve_months, 2)
    AND minimum_margin_percent BETWEEN 0 AND 100
    AND minimum_margin_percent = round(minimum_margin_percent, 4)
    AND target_pro_labore >= 0
    AND target_pro_labore = round(target_pro_labore, 2)
  )
);

INSERT INTO public.finance_settings(id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.finance_fixed_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL,
  amount numeric(14,2) NOT NULL,
  currency text NOT NULL DEFAULT 'BRL',
  frequency text NOT NULL DEFAULT 'monthly',
  due_day smallint NOT NULL,
  starts_on date NOT NULL,
  ends_on date,
  active boolean NOT NULL DEFAULT true,
  supplier text,
  payment_method text,
  brand text,
  notes text,
  archived_at timestamptz,
  archive_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  CONSTRAINT finance_fixed_costs_name_ck
    CHECK (length(btrim(name)) BETWEEN 2 AND 160),
  CONSTRAINT finance_fixed_costs_amount_ck
    CHECK (amount >= 0 AND amount = round(amount, 2)),
  CONSTRAINT finance_fixed_costs_currency_ck
    CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT finance_fixed_costs_frequency_ck
    CHECK (frequency IN ('monthly', 'quarterly', 'semiannual', 'annual')),
  CONSTRAINT finance_fixed_costs_due_day_ck CHECK (due_day BETWEEN 1 AND 28),
  CONSTRAINT finance_fixed_costs_window_ck
    CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT finance_fixed_costs_archive_ck
    CHECK (
      archived_at IS NULL
      OR (
        active = false
        AND length(btrim(archive_reason)) >= 5
      )
    )
);

CREATE INDEX IF NOT EXISTS finance_fixed_costs_active_idx
  ON public.finance_fixed_costs(active, starts_on, ends_on);

INSERT INTO public.finance_fixed_costs(
  id, name, category, amount, frequency, due_day, starts_on, active, notes
)
VALUES
  (
    '00000000-0000-4000-8000-000000000211',
    'Ferramentas e sistemas',
    'operational_tools',
    2500,
    'monthly',
    10,
    DATE '2026-08-10',
    true,
    'Custo-base editável; não gera saída automaticamente.'
  ),
  (
    '00000000-0000-4000-8000-000000000212',
    'Pró-labore atual',
    'pro_labore',
    3000,
    'monthly',
    10,
    DATE '2026-08-10',
    true,
    'Planejamento editável; não gera saída automaticamente.'
  )
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.finance_period_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date NOT NULL,
  period_end date NOT NULL,
  revision integer NOT NULL,
  status text NOT NULL DEFAULT 'closed',
  billing_due_total numeric(14,2) NOT NULL DEFAULT 0,
  billing_received_total numeric(14,2) NOT NULL DEFAULT 0,
  project_due_total numeric(14,2) NOT NULL DEFAULT 0,
  project_received_total numeric(14,2) NOT NULL DEFAULT 0,
  expenses_due_total numeric(14,2) NOT NULL DEFAULT 0,
  expenses_paid_total numeric(14,2) NOT NULL DEFAULT 0,
  cash_in_total numeric(14,2) NOT NULL DEFAULT 0,
  cash_out_total numeric(14,2) NOT NULL DEFAULT 0,
  net_cash_total numeric(14,2) NOT NULL DEFAULT 0,
  accrual_in_total numeric(14,2) NOT NULL DEFAULT 0,
  accrual_out_total numeric(14,2) NOT NULL DEFAULT 0,
  accrual_net_total numeric(14,2) NOT NULL DEFAULT 0,
  forecast_in_total numeric(14,2) NOT NULL DEFAULT 0,
  forecast_out_total numeric(14,2) NOT NULL DEFAULT 0,
  forecast_net_total numeric(14,2) NOT NULL DEFAULT 0,
  snapshot jsonb NOT NULL,
  snapshot_hash text NOT NULL,
  close_reason text,
  closed_at timestamptz NOT NULL DEFAULT now(),
  closed_by uuid NOT NULL,
  reopened_at timestamptz,
  reopened_by uuid,
  reopen_reason text,
  CONSTRAINT finance_period_closures_period_revision_uq
    UNIQUE (period_start, revision),
  CONSTRAINT finance_period_closures_month_ck
    CHECK (period_start = date_trunc('month', period_start)::date),
  CONSTRAINT finance_period_closures_end_ck
    CHECK (
      period_end = (period_start + interval '1 month - 1 day')::date
    ),
  CONSTRAINT finance_period_closures_revision_ck CHECK (revision > 0),
  CONSTRAINT finance_period_closures_status_ck
    CHECK (status IN ('closed', 'reopened')),
  CONSTRAINT finance_period_closures_snapshot_ck
    CHECK (jsonb_typeof(snapshot) = 'object'),
  CONSTRAINT finance_period_closures_hash_ck
    CHECK (snapshot_hash ~ '^[0-9a-f]{32}$'),
  CONSTRAINT finance_period_closures_reopen_ck CHECK (
    (
      status = 'closed'
      AND reopened_at IS NULL
      AND reopened_by IS NULL
      AND reopen_reason IS NULL
    )
    OR (
      status = 'reopened'
      AND reopened_at IS NOT NULL
      AND reopened_by IS NOT NULL
      AND length(btrim(reopen_reason)) >= 5
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS finance_period_closures_one_closed_uq
  ON public.finance_period_closures(period_start)
  WHERE status = 'closed';
CREATE INDEX IF NOT EXISTS finance_period_closures_period_idx
  ON public.finance_period_closures(period_start DESC, revision DESC);

CREATE TABLE IF NOT EXISTS public.finance_audit_log (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_user_id uuid,
  action text NOT NULL,
  table_name text NOT NULL,
  row_id text,
  old_data jsonb,
  new_data jsonb,
  changed_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  transaction_id bigint NOT NULL DEFAULT txid_current(),
  CONSTRAINT finance_audit_log_action_ck
    CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  CONSTRAINT finance_audit_log_changed_ck
    CHECK (jsonb_typeof(changed_fields) = 'array')
);

CREATE INDEX IF NOT EXISTS finance_audit_log_occurred_idx
  ON public.finance_audit_log(occurred_at DESC);
CREATE INDEX IF NOT EXISTS finance_audit_log_row_idx
  ON public.finance_audit_log(table_name, row_id, occurred_at DESC);

ALTER TABLE public.billing ADD COLUMN IF NOT EXISTS subscription_id uuid;
ALTER TABLE public.billing ADD COLUMN IF NOT EXISTS plan_version_id uuid;
ALTER TABLE public.billing ADD COLUMN IF NOT EXISTS billing_period_start date;
ALTER TABLE public.billing ADD COLUMN IF NOT EXISTS billing_period_end date;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'billing_subscription_id_fk'
      AND conrelid = 'public.billing'::regclass
  ) THEN
    ALTER TABLE public.billing
      ADD CONSTRAINT billing_subscription_id_fk
      FOREIGN KEY (subscription_id)
      REFERENCES public.finance_client_subscriptions(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'billing_plan_version_id_fk'
      AND conrelid = 'public.billing'::regclass
  ) THEN
    ALTER TABLE public.billing
      ADD CONSTRAINT billing_plan_version_id_fk
      FOREIGN KEY (plan_version_id)
      REFERENCES public.finance_plan_versions(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'billing_period_window_ck'
      AND conrelid = 'public.billing'::regclass
  ) THEN
    ALTER TABLE public.billing
      ADD CONSTRAINT billing_period_window_ck
      CHECK (
        billing_period_end IS NULL
        OR (
          billing_period_start IS NOT NULL
          AND billing_period_end >= billing_period_start
        )
      )
      NOT VALID;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS billing_subscription_id_idx
  ON public.billing(subscription_id);
CREATE INDEX IF NOT EXISTS billing_plan_version_id_idx
  ON public.billing(plan_version_id);
CREATE UNIQUE INDEX IF NOT EXISTS billing_subscription_competence_uq
  ON public.billing(subscription_id, billing_period_start)
  WHERE subscription_id IS NOT NULL AND billing_period_start IS NOT NULL;

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS fixed_cost_id uuid;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS expense_period_start date;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'expenses_fixed_cost_id_fk'
      AND conrelid = 'public.expenses'::regclass
  ) THEN
    ALTER TABLE public.expenses
      ADD CONSTRAINT expenses_fixed_cost_id_fk
      FOREIGN KEY (fixed_cost_id)
      REFERENCES public.finance_fixed_costs(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS expenses_fixed_cost_competence_uq
  ON public.expenses(fixed_cost_id, expense_period_start)
  WHERE fixed_cost_id IS NOT NULL AND expense_period_start IS NOT NULL;

CREATE OR REPLACE FUNCTION public.finance_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(
    public.has_role(auth.uid(), 'admin'::public.app_role),
    false
  )
$$;

CREATE OR REPLACE FUNCTION public.finance_can_manage()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    COALESCE(
      public.has_role(auth.uid(), 'admin'::public.app_role),
      false
    )
    OR COALESCE(
      public.has_role(auth.uid(), 'manager'::public.app_role),
      false
    )
$$;

CREATE OR REPLACE FUNCTION public.finance_assert_manager()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.finance_can_manage() THEN
    RAISE EXCEPTION 'finance manager permission required'
      USING ERRCODE = '42501';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.finance_assert_admin()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.finance_is_admin() THEN
    RAISE EXCEPTION 'finance admin permission required'
      USING ERRCODE = '42501';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.finance_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.finance_received_amount(
  p_status text,
  p_amount numeric,
  p_paid_amount numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN COALESCE(p_amount, 0) <= 0 THEN 0::numeric
    WHEN COALESCE(p_paid_amount, 0) > 0
      THEN LEAST(GREATEST(p_paid_amount, 0), p_amount)
    WHEN lower(COALESCE(p_status, '')) IN (
      'paid', 'pago', 'completed', 'complete', 'received', 'recebido'
    ) THEN p_amount
    ELSE 0::numeric
  END
$$;

CREATE OR REPLACE FUNCTION public.finance_capture_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_changed jsonb;
  v_row_id text;
BEGIN
  v_old := CASE
    WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD)
    ELSE NULL
  END;
  v_new := CASE
    WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW)
    ELSE NULL
  END;

  SELECT COALESCE(jsonb_agg(key_name ORDER BY key_name), '[]'::jsonb)
  INTO v_changed
  FROM jsonb_object_keys(
    COALESCE(v_old, '{}'::jsonb) || COALESCE(v_new, '{}'::jsonb)
  ) AS fields(key_name)
  WHERE v_old -> key_name IS DISTINCT FROM v_new -> key_name;

  v_row_id := COALESCE(
    v_new ->> 'id',
    v_old ->> 'id',
    v_new ->> 'client_id',
    v_old ->> 'client_id'
  );

  INSERT INTO public.finance_audit_log(
    actor_user_id,
    action,
    table_name,
    row_id,
    old_data,
    new_data,
    changed_fields
  )
  VALUES (
    auth.uid(),
    TG_OP,
    TG_TABLE_NAME,
    v_row_id,
    v_old,
    v_new,
    v_changed
  );

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

CREATE OR REPLACE FUNCTION public.finance_capture_profile_plan_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_changed jsonb;
BEGIN
  v_old := jsonb_build_object(
    'plan_name', OLD.plan_name,
    'plan_value', OLD.plan_value,
    'plan_status', OLD.plan_status,
    'plan_renewal_date', OLD.plan_renewal_date
  );
  v_new := jsonb_build_object(
    'plan_name', NEW.plan_name,
    'plan_value', NEW.plan_value,
    'plan_status', NEW.plan_status,
    'plan_renewal_date', NEW.plan_renewal_date
  );

  SELECT COALESCE(jsonb_agg(key_name ORDER BY key_name), '[]'::jsonb)
  INTO v_changed
  FROM jsonb_object_keys(v_old || v_new) AS fields(key_name)
  WHERE v_old -> key_name IS DISTINCT FROM v_new -> key_name;

  INSERT INTO public.finance_audit_log(
    actor_user_id,
    action,
    table_name,
    row_id,
    old_data,
    new_data,
    changed_fields
  )
  VALUES (
    auth.uid(),
    'UPDATE',
    'profiles_plan',
    NEW.id::text,
    v_old,
    v_new,
    v_changed
  );

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.finance_period_is_closed(p_date date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.finance_period_closures AS closure
    WHERE closure.status = 'closed'
      AND p_date BETWEEN closure.period_start AND closure.period_end
  )
$$;

CREATE OR REPLACE FUNCTION public.finance_guard_closed_period()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old jsonb := CASE
    WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD)
    ELSE '{}'::jsonb
  END;
  v_new jsonb := CASE
    WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW)
    ELSE '{}'::jsonb
  END;
  v_old_due date;
  v_new_due date;
  v_old_paid date;
  v_new_paid date;
  v_comp_changed boolean := false;
  v_cash_changed boolean := false;
  v_status_changed boolean := false;
  v_key text;
BEGIN
  v_old_due := NULLIF(v_old ->> 'due_date', '')::date;
  v_new_due := NULLIF(v_new ->> 'due_date', '')::date;
  v_old_paid := NULLIF(v_old ->> 'paid_date', '')::date;
  v_new_paid := NULLIF(v_new ->> 'paid_date', '')::date;

  IF TG_OP = 'INSERT' THEN
    IF (
      v_new_due IS NOT NULL
      AND public.finance_period_is_closed(v_new_due)
    ) OR (
      v_new_paid IS NOT NULL
      AND public.finance_period_is_closed(v_new_paid)
    ) THEN
      RAISE EXCEPTION 'cannot insert financial event into a closed period'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF (
      v_old_due IS NOT NULL
      AND public.finance_period_is_closed(v_old_due)
    ) OR (
      v_old_paid IS NOT NULL
      AND public.finance_period_is_closed(v_old_paid)
    ) THEN
      RAISE EXCEPTION 'cannot delete financial event from a closed period'
        USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  FOREACH v_key IN ARRAY ARRAY[
    'due_date',
    'amount',
    'client_id',
    'project_id',
    'payment_id',
    'subscription_id',
    'plan_version_id',
    'billing_period_start',
    'billing_period_end',
    'fixed_cost_id',
    'expense_period_start',
    'type',
    'category',
    'description',
    'installment_number'
  ]
  LOOP
    v_comp_changed :=
      v_comp_changed OR (v_old -> v_key IS DISTINCT FROM v_new -> v_key);
  END LOOP;

  FOREACH v_key IN ARRAY ARRAY['paid_date', 'paid_amount', 'amount']
  LOOP
    v_cash_changed :=
      v_cash_changed OR (v_old -> v_key IS DISTINCT FROM v_new -> v_key);
  END LOOP;

  v_status_changed := v_old -> 'status' IS DISTINCT FROM v_new -> 'status';

  IF (
    (
      v_old_due IS NOT NULL
      AND public.finance_period_is_closed(v_old_due)
    )
    OR (
      v_new_due IS NOT NULL
      AND public.finance_period_is_closed(v_new_due)
    )
  ) AND v_comp_changed THEN
    RAISE EXCEPTION 'cannot change competence fields in a closed period'
      USING ERRCODE = '55000';
  END IF;

  IF (
    (
      v_old_paid IS NOT NULL
      AND public.finance_period_is_closed(v_old_paid)
    )
    OR (
      v_new_paid IS NOT NULL
      AND public.finance_period_is_closed(v_new_paid)
    )
  ) AND (v_cash_changed OR v_status_changed) THEN
    RAISE EXCEPTION 'cannot change cash fields in a closed period'
      USING ERRCODE = '55000';
  END IF;

  IF v_status_changed
    AND v_old_due IS NOT NULL
    AND public.finance_period_is_closed(v_old_due)
  THEN
    IF NOT (
      v_new_paid IS NOT NULL
      AND NOT public.finance_period_is_closed(v_new_paid)
      AND lower(COALESCE(v_new ->> 'status', '')) IN (
        'paid', 'pago', 'completed', 'complete',
        'received', 'recebido', 'partial', 'parcial'
      )
    ) THEN
      RAISE EXCEPTION
        'closed competence status can change only for payment in open period'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.finance_fixed_cost_occurrences(
  p_period_start date,
  p_period_end date
)
RETURNS TABLE (
  fixed_cost_id uuid,
  due_date date,
  amount numeric(14,2),
  currency text,
  name text,
  category text,
  supplier text,
  payment_method text,
  brand text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    cost.id,
    make_date(
      extract(year FROM month_point)::integer,
      extract(month FROM month_point)::integer,
      cost.due_day
    ),
    cost.amount,
    cost.currency,
    cost.name,
    cost.category,
    cost.supplier,
    cost.payment_method,
    cost.brand
  FROM public.finance_fixed_costs AS cost
  CROSS JOIN LATERAL generate_series(
    date_trunc('month', GREATEST(cost.starts_on, p_period_start))::date,
    date_trunc(
      'month',
      LEAST(COALESCE(cost.ends_on, p_period_end), p_period_end)
    )::date,
    interval '1 month'
  ) AS month_point
  WHERE p_period_end >= p_period_start
    AND cost.active
    AND cost.archived_at IS NULL
    AND make_date(
      extract(year FROM month_point)::integer,
      extract(month FROM month_point)::integer,
      cost.due_day
    ) BETWEEN GREATEST(cost.starts_on, p_period_start)
      AND LEAST(COALESCE(cost.ends_on, p_period_end), p_period_end)
    AND mod(
      (
        extract(year FROM month_point)::integer * 12
        + extract(month FROM month_point)::integer
      ) - (
        extract(year FROM cost.starts_on)::integer * 12
        + extract(month FROM cost.starts_on)::integer
      ),
      CASE cost.frequency
        WHEN 'monthly' THEN 1
        WHEN 'quarterly' THEN 3
        WHEN 'semiannual' THEN 6
        ELSE 12
      END
    ) = 0
$$;

DROP TRIGGER IF EXISTS finance_plan_catalog_touch
  ON public.finance_plan_catalog;
CREATE TRIGGER finance_plan_catalog_touch
BEFORE UPDATE ON public.finance_plan_catalog
FOR EACH ROW
EXECUTE FUNCTION public.finance_touch_updated_at();

DROP TRIGGER IF EXISTS finance_subscription_touch
  ON public.finance_client_subscriptions;
CREATE TRIGGER finance_subscription_touch
BEFORE UPDATE ON public.finance_client_subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.finance_touch_updated_at();

DROP TRIGGER IF EXISTS finance_settings_touch
  ON public.finance_settings;
CREATE TRIGGER finance_settings_touch
BEFORE UPDATE ON public.finance_settings
FOR EACH ROW
EXECUTE FUNCTION public.finance_touch_updated_at();

DROP TRIGGER IF EXISTS finance_fixed_costs_touch
  ON public.finance_fixed_costs;
CREATE TRIGGER finance_fixed_costs_touch
BEFORE UPDATE ON public.finance_fixed_costs
FOR EACH ROW
EXECUTE FUNCTION public.finance_touch_updated_at();

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'finance_plan_catalog',
    'finance_plan_versions',
    'finance_client_subscriptions',
    'finance_settings',
    'finance_fixed_costs',
    'finance_period_closures',
    'billing',
    'expenses',
    'project_payments',
    'payment_installments'
  ]
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS finance_audit_row ON public.%I',
      v_table
    );
    EXECUTE format(
      'CREATE TRIGGER finance_audit_row '
      || 'AFTER INSERT OR UPDATE OR DELETE ON public.%I '
      || 'FOR EACH ROW EXECUTE FUNCTION public.finance_capture_audit()',
      v_table
    );
  END LOOP;
END
$$;

DROP TRIGGER IF EXISTS finance_profile_plan_audit ON public.profiles;
CREATE TRIGGER finance_profile_plan_audit
AFTER UPDATE OF
  plan_name,
  plan_value,
  plan_status,
  plan_renewal_date
ON public.profiles
FOR EACH ROW
WHEN (
  OLD.plan_name IS DISTINCT FROM NEW.plan_name
  OR OLD.plan_value IS DISTINCT FROM NEW.plan_value
  OR OLD.plan_status IS DISTINCT FROM NEW.plan_status
  OR OLD.plan_renewal_date IS DISTINCT FROM NEW.plan_renewal_date
)
EXECUTE FUNCTION public.finance_capture_profile_plan_audit();

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'billing',
    'expenses',
    'payment_installments'
  ]
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS finance_closed_period_guard ON public.%I',
      v_table
    );
    EXECUTE format(
      'CREATE TRIGGER finance_closed_period_guard '
      || 'BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
      || 'FOR EACH ROW EXECUTE FUNCTION public.finance_guard_closed_period()',
      v_table
    );
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.finance_backfill_legacy_subscriptions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_plan_id uuid;
  v_version_id uuid;
  v_inserted integer := 0;
  v_import_date constant date := DATE '2026-08-10';
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.deleted_at IS NULL
      AND profile.plan_value IS NOT NULL
      AND (
        profile.plan_value < 0
        OR profile.plan_value <> round(profile.plan_value, 2)
      )
  ) THEN
    RAISE EXCEPTION
      'legacy profiles contain invalid cent values; migration aborted'
      USING ERRCODE = '22003';
  END IF;

  INSERT INTO public.finance_plan_catalog(
    id,
    code,
    display_name,
    description,
    active,
    sort_order
  )
  VALUES (
    '00000000-0000-4000-8000-000000000201',
    'personalizado',
    'Personalizado',
    'Importado dos campos legados de profiles; preço exige revisão.',
    true,
    999
  )
  ON CONFLICT (code) DO NOTHING;

  SELECT id
  INTO STRICT v_plan_id
  FROM public.finance_plan_catalog
  WHERE code = 'personalizado';

  INSERT INTO public.finance_plan_versions(
    id,
    plan_id,
    version_number,
    monthly_price,
    setup_fee,
    currency,
    billing_cycle,
    effective_from,
    status,
    features
  )
  VALUES (
    '00000000-0000-4000-8000-000000000202',
    v_plan_id,
    1,
    0,
    0,
    'BRL',
    'monthly',
    DATE '1900-01-01',
    'published',
    '{"legacy_custom":true}'::jsonb
  )
  ON CONFLICT (plan_id, version_number) DO NOTHING;

  SELECT id
  INTO STRICT v_version_id
  FROM public.finance_plan_versions
  WHERE plan_id = v_plan_id
    AND version_number = 1;

  INSERT INTO public.finance_client_subscriptions(
    id,
    client_id,
    plan_version_id,
    status,
    agreed_monthly_amount,
    currency,
    billing_day,
    starts_on,
    ends_on,
    next_billing_date,
    is_custom,
    review_status,
    source,
    source_details
  )
  SELECT
    md5('finance-legacy-subscription:' || profile.id::text)::uuid,
    profile.id,
    v_version_id,
    CASE
      WHEN lower(COALESCE(profile.plan_status, '')) IN ('active', 'ativo')
        THEN 'active'
      WHEN lower(COALESCE(profile.plan_status, '')) IN (
        'paused', 'pausado', 'inactive', 'inativo'
      ) THEN 'paused'
      WHEN lower(COALESCE(profile.plan_status, '')) IN (
        'ended', 'encerrado', 'cancelled', 'canceled', 'cancelado'
      ) THEN 'ended'
      ELSE 'pending'
    END,
    COALESCE(profile.plan_value, 0)::numeric(14,2),
    'BRL',
    (
      SELECT default_billing_day
      FROM public.finance_settings
      WHERE id = 1
    ),
    v_import_date,
    CASE
      WHEN lower(COALESCE(profile.plan_status, '')) IN (
        'ended', 'encerrado', 'cancelled', 'canceled', 'cancelado'
      ) THEN v_import_date
      ELSE NULL
    END,
    profile.plan_renewal_date,
    true,
    'needs_review',
    'legacy_profile',
    jsonb_strip_nulls(jsonb_build_object(
      'legacy_plan_name', profile.plan_name,
      'legacy_plan_value', profile.plan_value,
      'legacy_plan_status', profile.plan_status,
      'legacy_plan_renewal_date', profile.plan_renewal_date,
      'imported_at_boundary', v_import_date
    ))
  FROM public.profiles AS profile
  WHERE profile.deleted_at IS NULL
    AND profile.client_type::text IN ('recurring', 'hybrid')
    AND (
      profile.plan_name IS NOT NULL
      OR profile.plan_value IS NOT NULL
      OR profile.plan_renewal_date IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_roles AS internal_role
      WHERE internal_role.user_id = profile.id
        AND internal_role.role IN (
          'admin'::public.app_role,
          'manager'::public.app_role,
          'design'::public.app_role,
          'traffic'::public.app_role
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.finance_client_subscriptions AS subscription
      WHERE subscription.client_id = profile.id
        AND subscription.source = 'legacy_profile'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.finance_client_subscriptions AS subscription
      WHERE subscription.client_id = profile.id
        AND subscription.ends_on IS NULL
        AND subscription.status IN ('pending', 'active', 'paused')
    )
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END
$$;

CREATE OR REPLACE FUNCTION public.finance_upsert_plan(
  p_code text,
  p_display_name text,
  p_description text DEFAULT NULL,
  p_active boolean DEFAULT true,
  p_sort_order integer DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id uuid;
  v_code text := lower(btrim(p_code));
BEGIN
  PERFORM public.finance_assert_admin();

  IF v_code !~ '^[a-z0-9][a-z0-9_-]{1,63}$'
    OR length(btrim(p_display_name)) NOT BETWEEN 2 AND 120
  THEN
    RAISE EXCEPTION 'invalid plan code or name'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.finance_plan_catalog(
    code,
    display_name,
    description,
    active,
    sort_order,
    created_by,
    updated_by
  )
  VALUES (
    v_code,
    btrim(p_display_name),
    NULLIF(btrim(p_description), ''),
    p_active,
    p_sort_order,
    auth.uid(),
    auth.uid()
  )
  ON CONFLICT (code) DO UPDATE
  SET
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    active = EXCLUDED.active,
    sort_order = EXCLUDED.sort_order,
    archived_at = CASE
      WHEN EXCLUDED.active THEN NULL
      ELSE COALESCE(public.finance_plan_catalog.archived_at, now())
    END,
    updated_by = auth.uid()
  RETURNING id INTO v_id;

  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.finance_publish_plan_version(
  p_plan_id uuid,
  p_monthly_price numeric,
  p_effective_from date,
  p_setup_fee numeric DEFAULT 0,
  p_currency text DEFAULT 'BRL',
  p_billing_cycle text DEFAULT 'monthly',
  p_features jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_previous public.finance_plan_versions%ROWTYPE;
  v_next integer;
  v_id uuid;
  v_currency text := upper(btrim(p_currency));
BEGIN
  PERFORM public.finance_assert_admin();

  IF p_monthly_price < 0
    OR p_monthly_price <> round(p_monthly_price, 2)
    OR p_setup_fee < 0
    OR p_setup_fee <> round(p_setup_fee, 2)
  THEN
    RAISE EXCEPTION
      'money must be non-negative with at most two decimal places'
      USING ERRCODE = '22003';
  END IF;

  IF v_currency !~ '^[A-Z]{3}$'
    OR p_billing_cycle NOT IN (
      'monthly', 'quarterly', 'semiannual', 'annual', 'one_time'
    )
    OR jsonb_typeof(COALESCE(p_features, '{}'::jsonb)) <> 'object'
  THEN
    RAISE EXCEPTION 'invalid plan version attributes'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.finance_plan_catalog
  WHERE id = p_plan_id
    AND active
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active plan not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT *
  INTO v_previous
  FROM public.finance_plan_versions
  WHERE plan_id = p_plan_id
    AND status = 'published'
  ORDER BY version_number DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF p_effective_from <= v_previous.effective_from THEN
      RAISE EXCEPTION
        'new version must start after latest published version'
        USING ERRCODE = '22007';
    END IF;

    UPDATE public.finance_plan_versions
    SET effective_to = p_effective_from - 1
    WHERE id = v_previous.id;
  END IF;

  SELECT COALESCE(max(version_number), 0) + 1
  INTO v_next
  FROM public.finance_plan_versions
  WHERE plan_id = p_plan_id;

  INSERT INTO public.finance_plan_versions(
    plan_id,
    version_number,
    monthly_price,
    setup_fee,
    currency,
    billing_cycle,
    effective_from,
    status,
    features,
    created_by
  )
  VALUES (
    p_plan_id,
    v_next,
    p_monthly_price::numeric(14,2),
    p_setup_fee::numeric(14,2),
    v_currency,
    p_billing_cycle,
    p_effective_from,
    'published',
    COALESCE(p_features, '{}'::jsonb),
    auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.finance_set_client_subscription(
  p_client_id uuid,
  p_plan_version_id uuid,
  p_effective_on date DEFAULT CURRENT_DATE,
  p_agreed_monthly_amount numeric DEFAULT NULL,
  p_billing_day smallint DEFAULT NULL,
  p_next_billing_date date DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_plan record;
  v_current public.finance_client_subscriptions%ROWTYPE;
  v_amount numeric(14,2);
  v_day smallint;
  v_next date;
  v_candidate date;
  v_status text;
  v_id uuid;
BEGIN
  PERFORM public.finance_assert_admin();
  PERFORM pg_advisory_xact_lock(
    hashtextextended('finance-subscription:' || p_client_id::text, 0)
  );

  PERFORM 1
  FROM public.profiles
  WHERE id = p_client_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'client not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT version.*, catalog.display_name, catalog.code
  INTO v_plan
  FROM public.finance_plan_versions AS version
  JOIN public.finance_plan_catalog AS catalog
    ON catalog.id = version.plan_id
  WHERE version.id = p_plan_version_id
    AND version.status = 'published'
    AND catalog.active
    AND p_effective_on >= version.effective_from
    AND (
      version.effective_to IS NULL
      OR p_effective_on <= version.effective_to
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'published plan version is not effective on requested date'
      USING ERRCODE = 'P0002';
  END IF;

  v_amount := COALESCE(p_agreed_monthly_amount, v_plan.monthly_price);
  IF v_amount < 0 OR v_amount <> round(v_amount, 2) THEN
    RAISE EXCEPTION
      'money must be non-negative with at most two decimal places'
      USING ERRCODE = '22003';
  END IF;

  v_day := COALESCE(
    p_billing_day,
    (
      SELECT default_billing_day
      FROM public.finance_settings
      WHERE id = 1
    )
  );
  IF v_day NOT BETWEEN 1 AND 28 THEN
    RAISE EXCEPTION 'billing day must be between 1 and 28'
      USING ERRCODE = '22023';
  END IF;

  v_next := p_next_billing_date;
  IF v_next IS NULL THEN
    v_candidate := make_date(
      extract(year FROM p_effective_on)::integer,
      extract(month FROM p_effective_on)::integer,
      v_day
    );
    v_next := CASE
      WHEN v_candidate >= p_effective_on THEN v_candidate
      ELSE (v_candidate + interval '1 month')::date
    END;
  END IF;

  IF v_next < p_effective_on THEN
    RAISE EXCEPTION 'next billing date cannot precede effective date'
      USING ERRCODE = '22007';
  END IF;

  v_status := CASE
    WHEN p_effective_on > CURRENT_DATE THEN 'pending'
    ELSE 'active'
  END;

  SELECT *
  INTO v_current
  FROM public.finance_client_subscriptions
  WHERE client_id = p_client_id
    AND ends_on IS NULL
    AND status IN ('pending', 'active', 'paused')
  ORDER BY starts_on DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_current.plan_version_id = p_plan_version_id
      AND v_current.agreed_monthly_amount = v_amount
      AND v_current.starts_on = p_effective_on
      AND v_current.billing_day = v_day
      AND v_current.next_billing_date IS NOT DISTINCT FROM v_next
    THEN
      RETURN v_current.id;
    END IF;

    IF p_effective_on <= v_current.starts_on THEN
      RAISE EXCEPTION
        'new subscription must start after current subscription'
        USING ERRCODE = '22007';
    END IF;

    UPDATE public.finance_client_subscriptions
    SET
      status = 'ended',
      ends_on = p_effective_on - 1,
      updated_by = auth.uid()
    WHERE id = v_current.id;
  END IF;

  INSERT INTO public.finance_client_subscriptions(
    client_id,
    plan_version_id,
    status,
    agreed_monthly_amount,
    currency,
    billing_day,
    starts_on,
    next_billing_date,
    is_custom,
    review_status,
    source,
    notes,
    created_by,
    updated_by
  )
  VALUES (
    p_client_id,
    p_plan_version_id,
    v_status,
    v_amount,
    v_plan.currency,
    v_day,
    p_effective_on,
    v_next,
    p_agreed_monthly_amount IS NOT NULL
      AND v_amount <> v_plan.monthly_price,
    CASE
      WHEN p_agreed_monthly_amount IS NOT NULL
        AND v_amount <> v_plan.monthly_price
      THEN 'reviewed'
      ELSE 'not_required'
    END,
    'admin',
    NULLIF(btrim(p_notes), ''),
    auth.uid(),
    auth.uid()
  )
  RETURNING id INTO v_id;

  UPDATE public.profiles
  SET
    plan_name = v_plan.display_name,
    plan_value = v_amount,
    plan_status = v_status,
    plan_renewal_date = v_next
  WHERE id = p_client_id;

  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.finance_review_subscription(
  p_subscription_id uuid,
  p_agreed_monthly_amount numeric DEFAULT NULL,
  p_next_billing_date date DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_subscription public.finance_client_subscriptions%ROWTYPE;
  v_amount numeric(14,2);
  v_next date;
BEGIN
  PERFORM public.finance_assert_admin();

  SELECT *
  INTO v_subscription
  FROM public.finance_client_subscriptions
  WHERE id = p_subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'subscription not found' USING ERRCODE = 'P0002';
  END IF;

  v_amount := COALESCE(
    p_agreed_monthly_amount,
    v_subscription.agreed_monthly_amount
  );
  v_next := COALESCE(
    p_next_billing_date,
    v_subscription.next_billing_date
  );

  IF v_amount < 0
    OR v_amount <> round(v_amount, 2)
    OR (
      v_next IS NOT NULL
      AND v_next < v_subscription.starts_on
    )
  THEN
    RAISE EXCEPTION 'invalid reviewed subscription values'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.finance_client_subscriptions
  SET
    agreed_monthly_amount = v_amount,
    next_billing_date = v_next,
    review_status = 'reviewed',
    notes = COALESCE(NULLIF(btrim(p_notes), ''), notes),
    updated_by = auth.uid()
  WHERE id = p_subscription_id;

  IF v_subscription.ends_on IS NULL THEN
    UPDATE public.profiles
    SET
      plan_value = v_amount,
      plan_renewal_date = v_next
    WHERE id = v_subscription.client_id;
  END IF;

  RETURN p_subscription_id;
END
$$;

CREATE OR REPLACE FUNCTION public.finance_update_settings(
  p_default_currency text DEFAULT NULL,
  p_default_billing_day smallint DEFAULT NULL,
  p_tax_rate_percent numeric DEFAULT NULL,
  p_project_receipts_mode text DEFAULT NULL,
  p_closing_requires_completed_month boolean DEFAULT NULL,
  p_timezone text DEFAULT NULL,
  p_monthly_revenue_goal numeric DEFAULT NULL,
  p_retention_percent numeric DEFAULT NULL,
  p_reserve_months numeric DEFAULT NULL,
  p_minimum_margin_percent numeric DEFAULT NULL,
  p_target_pro_labore numeric DEFAULT NULL
)
RETURNS public.finance_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_result public.finance_settings;
BEGIN
  PERFORM public.finance_assert_admin();

  IF p_default_currency IS NOT NULL
    AND upper(btrim(p_default_currency)) !~ '^[A-Z]{3}$'
  THEN
    RAISE EXCEPTION 'invalid currency' USING ERRCODE = '22023';
  END IF;

  IF p_default_billing_day IS NOT NULL
    AND p_default_billing_day NOT BETWEEN 1 AND 28
  THEN
    RAISE EXCEPTION 'invalid billing day' USING ERRCODE = '22023';
  END IF;

  IF p_tax_rate_percent IS NOT NULL
    AND (
      p_tax_rate_percent < 0
      OR p_tax_rate_percent > 100
      OR p_tax_rate_percent <> round(p_tax_rate_percent, 4)
    )
  THEN
    RAISE EXCEPTION 'invalid tax rate' USING ERRCODE = '22023';
  END IF;

  IF p_project_receipts_mode IS NOT NULL
    AND p_project_receipts_mode NOT IN (
      'separate', 'included_in_billing'
    )
  THEN
    RAISE EXCEPTION 'invalid project receipts mode'
      USING ERRCODE = '22023';
  END IF;

  IF p_timezone IS NOT NULL
    AND length(btrim(p_timezone)) NOT BETWEEN 1 AND 80
  THEN
    RAISE EXCEPTION 'invalid timezone' USING ERRCODE = '22023';
  END IF;

  IF p_monthly_revenue_goal IS NOT NULL
    AND (
      p_monthly_revenue_goal < 0
      OR p_monthly_revenue_goal <> round(p_monthly_revenue_goal, 2)
    )
  THEN
    RAISE EXCEPTION 'invalid monthly revenue goal'
      USING ERRCODE = '22023';
  END IF;

  IF p_retention_percent IS NOT NULL
    AND (
      p_retention_percent < 0
      OR p_retention_percent > 100
      OR p_retention_percent <> round(p_retention_percent, 4)
    )
  THEN
    RAISE EXCEPTION 'invalid retention percent'
      USING ERRCODE = '22023';
  END IF;

  IF p_reserve_months IS NOT NULL
    AND (
      p_reserve_months < 0
      OR p_reserve_months > 60
      OR p_reserve_months <> round(p_reserve_months, 2)
    )
  THEN
    RAISE EXCEPTION 'invalid reserve months'
      USING ERRCODE = '22023';
  END IF;

  IF p_minimum_margin_percent IS NOT NULL
    AND (
      p_minimum_margin_percent < 0
      OR p_minimum_margin_percent > 100
      OR p_minimum_margin_percent <> round(p_minimum_margin_percent, 4)
    )
  THEN
    RAISE EXCEPTION 'invalid minimum margin'
      USING ERRCODE = '22023';
  END IF;

  IF p_target_pro_labore IS NOT NULL
    AND (
      p_target_pro_labore < 0
      OR p_target_pro_labore <> round(p_target_pro_labore, 2)
    )
  THEN
    RAISE EXCEPTION 'invalid target pro-labore'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.finance_settings
  SET
    default_currency = COALESCE(
      upper(btrim(p_default_currency)),
      default_currency
    ),
    default_billing_day = COALESCE(
      p_default_billing_day,
      default_billing_day
    ),
    tax_rate_percent = COALESCE(
      p_tax_rate_percent,
      tax_rate_percent
    ),
    project_receipts_mode = COALESCE(
      p_project_receipts_mode,
      project_receipts_mode
    ),
    closing_requires_completed_month = COALESCE(
      p_closing_requires_completed_month,
      closing_requires_completed_month
    ),
    timezone = COALESCE(NULLIF(btrim(p_timezone), ''), timezone),
    monthly_revenue_goal = COALESCE(
      p_monthly_revenue_goal,
      monthly_revenue_goal
    ),
    retention_percent = COALESCE(
      p_retention_percent,
      retention_percent
    ),
    reserve_months = COALESCE(p_reserve_months, reserve_months),
    minimum_margin_percent = COALESCE(
      p_minimum_margin_percent,
      minimum_margin_percent
    ),
    target_pro_labore = COALESCE(
      p_target_pro_labore,
      target_pro_labore
    ),
    updated_by = auth.uid()
  WHERE id = 1
  RETURNING * INTO v_result;

  RETURN v_result;
END
$$;

CREATE OR REPLACE FUNCTION public.finance_upsert_fixed_cost(
  p_name text,
  p_amount numeric,
  p_category text,
  p_due_day smallint,
  p_id uuid DEFAULT NULL,
  p_currency text DEFAULT 'BRL',
  p_frequency text DEFAULT 'monthly',
  p_starts_on date DEFAULT CURRENT_DATE,
  p_ends_on date DEFAULT NULL,
  p_active boolean DEFAULT true,
  p_supplier text DEFAULT NULL,
  p_payment_method text DEFAULT NULL,
  p_brand text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id uuid;
  v_currency text := upper(btrim(p_currency));
BEGIN
  PERFORM public.finance_assert_admin();

  IF length(btrim(p_name)) NOT BETWEEN 2 AND 160
    OR p_amount < 0
    OR p_amount <> round(p_amount, 2)
    OR p_due_day NOT BETWEEN 1 AND 28
    OR v_currency !~ '^[A-Z]{3}$'
    OR p_frequency NOT IN (
      'monthly', 'quarterly', 'semiannual', 'annual'
    )
    OR (p_ends_on IS NOT NULL AND p_ends_on < p_starts_on)
  THEN
    RAISE EXCEPTION 'invalid fixed cost values'
      USING ERRCODE = '22023';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.finance_fixed_costs(
      name,
      category,
      amount,
      currency,
      frequency,
      due_day,
      starts_on,
      ends_on,
      active,
      supplier,
      payment_method,
      brand,
      notes,
      created_by,
      updated_by
    )
    VALUES (
      btrim(p_name),
      btrim(p_category),
      p_amount,
      v_currency,
      p_frequency,
      p_due_day,
      p_starts_on,
      p_ends_on,
      p_active,
      NULLIF(btrim(p_supplier), ''),
      NULLIF(btrim(p_payment_method), ''),
      NULLIF(btrim(p_brand), ''),
      NULLIF(btrim(p_notes), ''),
      auth.uid(),
      auth.uid()
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.finance_fixed_costs
    SET
      name = btrim(p_name),
      category = btrim(p_category),
      amount = p_amount,
      currency = v_currency,
      frequency = p_frequency,
      due_day = p_due_day,
      starts_on = p_starts_on,
      ends_on = p_ends_on,
      active = p_active,
      supplier = NULLIF(btrim(p_supplier), ''),
      payment_method = NULLIF(btrim(p_payment_method), ''),
      brand = NULLIF(btrim(p_brand), ''),
      notes = NULLIF(btrim(p_notes), ''),
      updated_by = auth.uid()
    WHERE id = p_id
      AND archived_at IS NULL
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'active fixed cost not found'
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.finance_archive_fixed_cost(
  p_id uuid,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM public.finance_assert_admin();

  IF length(btrim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'archive reason must have at least 5 characters'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.finance_fixed_costs
  SET
    active = false,
    archived_at = now(),
    archive_reason = btrim(p_reason),
    updated_by = auth.uid()
  WHERE id = p_id
    AND archived_at IS NULL
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'active fixed cost not found'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.finance_issue_subscription_billing(
  p_subscription_id uuid,
  p_competence_start date,
  p_due_date date,
  p_description text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_subscription public.finance_client_subscriptions%ROWTYPE;
  v_id uuid;
  v_period_end date;
BEGIN
  PERFORM public.finance_assert_admin();

  IF extract(day FROM p_competence_start) <> 1 THEN
    RAISE EXCEPTION 'competence must start on first day of month'
      USING ERRCODE = '22007';
  END IF;

  v_period_end :=
    (p_competence_start + interval '1 month - 1 day')::date;

  SELECT *
  INTO v_subscription
  FROM public.finance_client_subscriptions
  WHERE id = p_subscription_id
    AND starts_on <= v_period_end
    AND (ends_on IS NULL OR ends_on >= p_competence_start)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'subscription is not effective for competence'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.billing(
    client_id,
    type,
    amount,
    status,
    due_date,
    description,
    subscription_id,
    plan_version_id,
    billing_period_start,
    billing_period_end
  )
  VALUES (
    v_subscription.client_id,
    'subscription',
    v_subscription.agreed_monthly_amount,
    'pending',
    p_due_date,
    COALESCE(NULLIF(btrim(p_description), ''), 'Mensalidade'),
    v_subscription.id,
    v_subscription.plan_version_id,
    p_competence_start,
    v_period_end
  )
  ON CONFLICT (subscription_id, billing_period_start)
    WHERE subscription_id IS NOT NULL
      AND billing_period_start IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id
    INTO v_id
    FROM public.billing
    WHERE subscription_id = p_subscription_id
      AND billing_period_start = p_competence_start;
  END IF;

  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.finance_generate_monthly_billing(
  p_through date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_subscription record;
  v_due date;
  v_competence date;
  v_period_end date;
  v_next date;
  v_id uuid;
  v_generated integer := 0;
  v_existing integer := 0;
  v_skipped integer := 0;
  v_guard integer := 0;
  v_ids jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.finance_assert_admin();

  IF p_through IS NULL
    OR p_through > (CURRENT_DATE + interval '24 months')::date
  THEN
    RAISE EXCEPTION 'through date exceeds safe generation horizon'
      USING ERRCODE = '22007';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('finance-generate-monthly-billing', 0)
  );

  FOR v_subscription IN
    SELECT subscription.*, version.billing_cycle
    FROM public.finance_client_subscriptions AS subscription
    JOIN public.finance_plan_versions AS version
      ON version.id = subscription.plan_version_id
    WHERE subscription.status IN ('active', 'pending')
      AND subscription.next_billing_date IS NOT NULL
      AND subscription.next_billing_date <= p_through
      AND version.billing_cycle = 'monthly'
    ORDER BY subscription.next_billing_date, subscription.id
    FOR UPDATE OF subscription
  LOOP
    v_due := v_subscription.next_billing_date;
    v_guard := 0;

    WHILE v_due <= p_through
      AND (
        v_subscription.ends_on IS NULL
        OR v_due <= v_subscription.ends_on
      )
    LOOP
      v_guard := v_guard + 1;
      IF v_guard > 240 THEN
        RAISE EXCEPTION
          'generation safeguard exceeded for subscription %',
          v_subscription.id;
      END IF;

      v_competence := date_trunc('month', v_due)::date;
      v_period_end :=
        (v_competence + interval '1 month - 1 day')::date;
      v_id := NULL;

      IF public.finance_period_is_closed(v_competence)
        OR public.finance_period_is_closed(v_due)
      THEN
        v_skipped := v_skipped + 1;
      ELSE
        INSERT INTO public.billing(
          client_id,
          type,
          amount,
          status,
          due_date,
          description,
          subscription_id,
          plan_version_id,
          billing_period_start,
          billing_period_end
        )
        VALUES (
          v_subscription.client_id,
          'subscription',
          v_subscription.agreed_monthly_amount,
          'pending',
          v_due,
          'Mensalidade',
          v_subscription.id,
          v_subscription.plan_version_id,
          v_competence,
          v_period_end
        )
        ON CONFLICT (subscription_id, billing_period_start)
          WHERE subscription_id IS NOT NULL
            AND billing_period_start IS NOT NULL
        DO NOTHING
        RETURNING id INTO v_id;

        IF v_id IS NULL THEN
          v_existing := v_existing + 1;
          SELECT id
          INTO v_id
          FROM public.billing
          WHERE subscription_id = v_subscription.id
            AND billing_period_start = v_competence;
        ELSE
          v_generated := v_generated + 1;
        END IF;

        v_ids := v_ids || jsonb_build_array(v_id);
      END IF;

      v_next := (
        date_trunc('month', v_due)
        + interval '1 month'
        + (v_subscription.billing_day - 1) * interval '1 day'
      )::date;
      v_due := v_next;
    END LOOP;

    UPDATE public.finance_client_subscriptions
    SET
      next_billing_date = v_due,
      status = CASE
        WHEN status = 'pending' AND starts_on <= CURRENT_DATE THEN 'active'
        ELSE status
      END,
      updated_by = auth.uid()
    WHERE id = v_subscription.id;

    UPDATE public.profiles
    SET
      plan_renewal_date = v_due,
      plan_status = CASE
        WHEN plan_status = 'pending'
          AND v_subscription.starts_on <= CURRENT_DATE
        THEN 'active'
        ELSE plan_status
      END
    WHERE id = v_subscription.client_id;
  END LOOP;

  RETURN jsonb_build_object(
    'through', p_through,
    'generated_count', v_generated,
    'existing_count', v_existing,
    'skipped_closed_count', v_skipped,
    'billing_ids', v_ids
  );
END
$$;

CREATE OR REPLACE FUNCTION public.finance_build_period_snapshot_internal(
  p_period_start date,
  p_period_end date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_billing_due numeric;
  v_billing_paid numeric;
  v_billing_open numeric;
  v_billing_receivable numeric;
  v_project_due numeric;
  v_project_paid numeric;
  v_project_open numeric;
  v_project_receivable numeric;
  v_expense_due numeric;
  v_expense_paid numeric;
  v_expense_open numeric;
  v_fixed_open numeric;
  v_cash_in numeric;
  v_cash_out numeric;
  v_accrual_in numeric;
  v_accrual_out numeric;
  v_forecast_in numeric;
  v_forecast_out numeric;
  v_mrr numeric;
  v_mode text;
  v_forecast_from date;
BEGIN
  IF p_period_start IS NULL
    OR p_period_end IS NULL
    OR p_period_end < p_period_start
    OR p_period_end - p_period_start > 366
  THEN
    RAISE EXCEPTION 'invalid period' USING ERRCODE = '22007';
  END IF;

  SELECT project_receipts_mode
  INTO v_mode
  FROM public.finance_settings
  WHERE id = 1;

  v_forecast_from := GREATEST(p_period_start, CURRENT_DATE);

  SELECT
    COALESCE(sum(amount) FILTER (
      WHERE due_date BETWEEN p_period_start AND p_period_end
        AND lower(COALESCE(status, '')) NOT IN (
          'cancelled', 'canceled', 'cancelado'
        )
    ), 0),
    COALESCE(sum(public.finance_received_amount(
      status, amount, paid_amount
    )) FILTER (
      WHERE paid_date BETWEEN p_period_start AND p_period_end
    ), 0),
    COALESCE(sum(GREATEST(
      amount - public.finance_received_amount(status, amount, paid_amount),
      0
    )) FILTER (
      WHERE due_date BETWEEN v_forecast_from AND p_period_end
        AND lower(COALESCE(status, '')) NOT IN (
          'cancelled', 'canceled', 'cancelado'
        )
    ), 0),
    COALESCE(sum(GREATEST(
      amount - public.finance_received_amount(status, amount, paid_amount),
      0
    )) FILTER (
      WHERE due_date <= p_period_end
        AND lower(COALESCE(status, '')) NOT IN (
          'cancelled', 'canceled', 'cancelado'
        )
    ), 0)
  INTO
    v_billing_due,
    v_billing_paid,
    v_billing_open,
    v_billing_receivable
  FROM public.billing;

  SELECT
    COALESCE(sum(amount) FILTER (
      WHERE due_date BETWEEN p_period_start AND p_period_end
        AND lower(COALESCE(status, '')) NOT IN (
          'cancelled', 'canceled', 'cancelado'
        )
    ), 0),
    COALESCE(sum(public.finance_received_amount(
      status, amount, paid_amount
    )) FILTER (
      WHERE paid_date BETWEEN p_period_start AND p_period_end
    ), 0),
    COALESCE(sum(GREATEST(
      amount - public.finance_received_amount(status, amount, paid_amount),
      0
    )) FILTER (
      WHERE due_date BETWEEN v_forecast_from AND p_period_end
        AND lower(COALESCE(status, '')) NOT IN (
          'cancelled', 'canceled', 'cancelado'
        )
    ), 0),
    COALESCE(sum(GREATEST(
      amount - public.finance_received_amount(status, amount, paid_amount),
      0
    )) FILTER (
      WHERE due_date <= p_period_end
        AND lower(COALESCE(status, '')) NOT IN (
          'cancelled', 'canceled', 'cancelado'
        )
    ), 0)
  INTO
    v_project_due,
    v_project_paid,
    v_project_open,
    v_project_receivable
  FROM public.payment_installments;

  SELECT
    COALESCE(sum(amount) FILTER (
      WHERE due_date BETWEEN p_period_start AND p_period_end
        AND lower(COALESCE(status, '')) NOT IN (
          'cancelled', 'canceled', 'cancelado'
        )
    ), 0),
    COALESCE(sum(amount) FILTER (
      WHERE paid_date BETWEEN p_period_start AND p_period_end
    ), 0),
    COALESCE(sum(amount) FILTER (
      WHERE due_date BETWEEN v_forecast_from AND p_period_end
        AND paid_date IS NULL
        AND lower(COALESCE(status, '')) NOT IN (
          'paid', 'pago', 'completed', 'complete',
          'cancelled', 'canceled', 'cancelado'
        )
    ), 0)
  INTO v_expense_due, v_expense_paid, v_expense_open
  FROM public.expenses;

  SELECT COALESCE(sum(occurrence.amount), 0)
  INTO v_fixed_open
  FROM public.finance_fixed_cost_occurrences(
    v_forecast_from,
    p_period_end
  ) AS occurrence
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.expenses AS expense
    WHERE expense.fixed_cost_id = occurrence.fixed_cost_id
      AND expense.expense_period_start =
        date_trunc('month', occurrence.due_date)::date
      AND lower(COALESCE(expense.status, '')) NOT IN (
        'cancelled', 'canceled', 'cancelado'
      )
  );

  SELECT COALESCE(sum(agreed_monthly_amount), 0)
  INTO v_mrr
  FROM public.finance_client_subscriptions
  WHERE status = 'active'
    AND starts_on <= p_period_end
    AND (ends_on IS NULL OR ends_on >= p_period_end);

  v_cash_in :=
    v_billing_paid
    + CASE WHEN v_mode = 'separate' THEN v_project_paid ELSE 0 END;
  v_cash_out := v_expense_paid;

  v_accrual_in :=
    v_billing_due
    + CASE WHEN v_mode = 'separate' THEN v_project_due ELSE 0 END;
  v_accrual_out := v_expense_due;

  v_forecast_in :=
    v_billing_open
    + CASE WHEN v_mode = 'separate' THEN v_project_open ELSE 0 END;
  v_forecast_out := v_expense_open + v_fixed_open;

  RETURN jsonb_build_object(
    'period', jsonb_build_object(
      'start', p_period_start,
      'end', p_period_end
    ),
    'recurring_mrr', v_mrr::numeric(14,2),
    'receivables_open', (
      v_billing_receivable
      + CASE
          WHEN v_mode = 'separate' THEN v_project_receivable
          ELSE 0
        END
    )::numeric(14,2),
    'obligations', jsonb_build_object(
      'billing', jsonb_build_object(
        'due', v_billing_due::numeric(14,2),
        'paid', v_billing_paid::numeric(14,2),
        'open_forecast', v_billing_open::numeric(14,2)
      ),
      'projects', jsonb_build_object(
        'due', v_project_due::numeric(14,2),
        'paid', v_project_paid::numeric(14,2),
        'open_forecast', v_project_open::numeric(14,2)
      ),
      'expenses', jsonb_build_object(
        'due', v_expense_due::numeric(14,2),
        'paid', v_expense_paid::numeric(14,2),
        'open_forecast', v_expense_open::numeric(14,2)
      ),
      'fixed_costs', jsonb_build_object(
        'planned_forecast', v_fixed_open::numeric(14,2)
      )
    ),
    'cash', jsonb_build_object(
      'in', v_cash_in::numeric(14,2),
      'out', v_cash_out::numeric(14,2),
      'net', (v_cash_in - v_cash_out)::numeric(14,2)
    ),
    'accrual', jsonb_build_object(
      'in', v_accrual_in::numeric(14,2),
      'out', v_accrual_out::numeric(14,2),
      'net', (v_accrual_in - v_accrual_out)::numeric(14,2)
    ),
    'forecast', jsonb_build_object(
      'in', v_forecast_in::numeric(14,2),
      'out', v_forecast_out::numeric(14,2),
      'net', (v_forecast_in - v_forecast_out)::numeric(14,2)
    ),
    'project_receipts_mode', v_mode
  );
END
$$;

CREATE OR REPLACE FUNCTION public.finance_get_period_snapshot(
  p_period_start date,
  p_period_end date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_snapshot jsonb;
BEGIN
  PERFORM public.finance_assert_manager();

  SELECT snapshot
  INTO v_snapshot
  FROM public.finance_period_closures
  WHERE period_start = p_period_start
    AND period_end = p_period_end
    AND status = 'closed'
  ORDER BY revision DESC
  LIMIT 1;

  RETURN COALESCE(
    v_snapshot,
    public.finance_build_period_snapshot_internal(
      p_period_start,
      p_period_end
    )
  );
END
$$;

CREATE OR REPLACE FUNCTION public.finance_close_period(
  p_period_start date,
  p_close_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_end date;
  v_snapshot jsonb;
  v_id uuid;
  v_revision integer;
  v_requires_completed boolean;
BEGIN
  PERFORM public.finance_assert_admin();

  IF p_period_start <> date_trunc('month', p_period_start)::date THEN
    RAISE EXCEPTION 'period_start must be first day of month'
      USING ERRCODE = '22007';
  END IF;

  v_end := (p_period_start + interval '1 month - 1 day')::date;

  SELECT closing_requires_completed_month
  INTO v_requires_completed
  FROM public.finance_settings
  WHERE id = 1;

  IF v_requires_completed AND v_end >= CURRENT_DATE THEN
    RAISE EXCEPTION 'only completed months can be closed'
      USING ERRCODE = '22007';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('finance-close:' || p_period_start::text, 0)
  );

  SELECT id
  INTO v_id
  FROM public.finance_period_closures
  WHERE period_start = p_period_start
    AND status = 'closed'
  FOR UPDATE;

  IF FOUND THEN
    RETURN v_id;
  END IF;

  SELECT COALESCE(max(revision), 0) + 1
  INTO v_revision
  FROM public.finance_period_closures
  WHERE period_start = p_period_start;

  v_snapshot :=
    public.finance_build_period_snapshot_internal(p_period_start, v_end);

  INSERT INTO public.finance_period_closures(
    period_start,
    period_end,
    revision,
    status,
    billing_due_total,
    billing_received_total,
    project_due_total,
    project_received_total,
    expenses_due_total,
    expenses_paid_total,
    cash_in_total,
    cash_out_total,
    net_cash_total,
    accrual_in_total,
    accrual_out_total,
    accrual_net_total,
    forecast_in_total,
    forecast_out_total,
    forecast_net_total,
    snapshot,
    snapshot_hash,
    close_reason,
    closed_by
  )
  VALUES (
    p_period_start,
    v_end,
    v_revision,
    'closed',
    (v_snapshot #>> '{obligations,billing,due}')::numeric,
    (v_snapshot #>> '{obligations,billing,paid}')::numeric,
    (v_snapshot #>> '{obligations,projects,due}')::numeric,
    (v_snapshot #>> '{obligations,projects,paid}')::numeric,
    (v_snapshot #>> '{obligations,expenses,due}')::numeric,
    (v_snapshot #>> '{obligations,expenses,paid}')::numeric,
    (v_snapshot #>> '{cash,in}')::numeric,
    (v_snapshot #>> '{cash,out}')::numeric,
    (v_snapshot #>> '{cash,net}')::numeric,
    (v_snapshot #>> '{accrual,in}')::numeric,
    (v_snapshot #>> '{accrual,out}')::numeric,
    (v_snapshot #>> '{accrual,net}')::numeric,
    (v_snapshot #>> '{forecast,in}')::numeric,
    (v_snapshot #>> '{forecast,out}')::numeric,
    (v_snapshot #>> '{forecast,net}')::numeric,
    v_snapshot,
    md5(v_snapshot::text),
    NULLIF(btrim(p_close_reason), ''),
    auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.finance_reopen_period(
  p_period_start date,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM public.finance_assert_admin();

  IF length(btrim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'reopen reason must have at least 5 characters'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('finance-close:' || p_period_start::text, 0)
  );

  SELECT id
  INTO v_id
  FROM public.finance_period_closures
  WHERE period_start = p_period_start
    AND status = 'closed'
  ORDER BY revision DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'closed period not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.finance_period_closures
  SET
    status = 'reopened',
    reopened_at = now(),
    reopened_by = auth.uid(),
    reopen_reason = btrim(p_reason)
  WHERE id = v_id;

  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.finance_get_dashboard(
  p_period_start date DEFAULT date_trunc('month', CURRENT_DATE)::date,
  p_period_end date DEFAULT (
    date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day'
  )::date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_snapshot jsonb;
  v_clients jsonb;
  v_plans jsonb;
  v_subscriptions jsonb;
  v_cash_flow jsonb;
  v_fixed_costs jsonb;
  v_settings jsonb;
  v_closure public.finance_period_closures%ROWTYPE;
  v_closed boolean := false;
  v_mode text;
BEGIN
  PERFORM public.finance_assert_manager();

  IF p_period_start IS NULL
    OR p_period_end IS NULL
    OR p_period_end < p_period_start
    OR p_period_end - p_period_start > 366
  THEN
    RAISE EXCEPTION 'invalid period' USING ERRCODE = '22007';
  END IF;

  SELECT *
  INTO v_closure
  FROM public.finance_period_closures
  WHERE period_start = p_period_start
    AND period_end = p_period_end
    AND status = 'closed'
  ORDER BY revision DESC
  LIMIT 1;

  v_closed := FOUND;
  v_snapshot := CASE
    WHEN v_closed THEN v_closure.snapshot
    ELSE public.finance_build_period_snapshot_internal(
      p_period_start,
      p_period_end
    )
  END;
  v_mode := v_snapshot ->> 'project_receipts_mode';

  SELECT COALESCE(
    jsonb_agg(item ORDER BY item ->> 'name', item ->> 'id'),
    '[]'::jsonb
  )
  INTO v_clients
  FROM (
    SELECT jsonb_build_object(
      'id', profile.id,
      'name', COALESCE(
        profile.company_name,
        profile.full_name,
        profile.email
      ),
      'brand', profile.brand,
      'subscription', CASE
        WHEN subscription.id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'id', subscription.id,
          'status', subscription.status,
          'amount', subscription.agreed_monthly_amount,
          'currency', subscription.currency,
          'billing_day', subscription.billing_day,
          'starts_on', subscription.starts_on,
          'ends_on', subscription.ends_on,
          'next_billing_date', subscription.next_billing_date,
          'review_status', subscription.review_status,
          'is_custom', subscription.is_custom,
          'plan', jsonb_build_object(
            'catalog_id', catalog.id,
            'version_id', version.id,
            'code', catalog.code,
            'name', catalog.display_name,
            'version', version.version_number,
            'list_price', version.monthly_price
          )
        )
      END,
      'billing', jsonb_build_object(
        'due', COALESCE(billing.due_total, 0),
        'received', COALESCE(billing.received_total, 0),
        'open', COALESCE(billing.open_total, 0),
        'overdue', COALESCE(billing.overdue_total, 0)
      )
    ) AS item
    FROM public.profiles AS profile
    LEFT JOIN LATERAL (
      SELECT *
      FROM public.finance_client_subscriptions AS candidate
      WHERE candidate.client_id = profile.id
        AND candidate.starts_on <= p_period_end
        AND (
          candidate.ends_on IS NULL
          OR candidate.ends_on >= p_period_start
        )
      ORDER BY candidate.starts_on DESC
      LIMIT 1
    ) AS subscription ON true
    LEFT JOIN public.finance_plan_versions AS version
      ON version.id = subscription.plan_version_id
    LEFT JOIN public.finance_plan_catalog AS catalog
      ON catalog.id = version.plan_id
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(sum(row.amount) FILTER (
          WHERE row.due_date BETWEEN p_period_start AND p_period_end
        ), 0)::numeric(14,2) AS due_total,
        COALESCE(sum(public.finance_received_amount(
          row.status,
          row.amount,
          row.paid_amount
        )) FILTER (
          WHERE row.paid_date BETWEEN p_period_start AND p_period_end
        ), 0)::numeric(14,2) AS received_total,
        COALESCE(sum(GREATEST(
          row.amount - public.finance_received_amount(
            row.status,
            row.amount,
            row.paid_amount
          ),
          0
        )) FILTER (
          WHERE row.due_date <= p_period_end
        ), 0)::numeric(14,2) AS open_total,
        COALESCE(sum(GREATEST(
          row.amount - public.finance_received_amount(
            row.status,
            row.amount,
            row.paid_amount
          ),
          0
        )) FILTER (
          WHERE row.due_date < CURRENT_DATE
        ), 0)::numeric(14,2) AS overdue_total
      FROM public.billing AS row
      WHERE row.client_id = profile.id
        AND lower(COALESCE(row.status, '')) NOT IN (
          'cancelled', 'canceled', 'cancelado'
        )
    ) AS billing ON true
    WHERE profile.deleted_at IS NULL
      AND (
        subscription.id IS NOT NULL
        OR profile.plan_name IS NOT NULL
        OR profile.plan_value IS NOT NULL
        OR EXISTS (
          SELECT 1
          FROM public.billing AS existing_billing
          WHERE existing_billing.client_id = profile.id
        )
        OR EXISTS (
          SELECT 1
          FROM public.project_payments AS existing_project
          WHERE existing_project.client_id = profile.id
        )
      )
  ) AS client_rows;

  SELECT COALESCE(
    jsonb_agg(item ORDER BY item ->> 'name'),
    '[]'::jsonb
  )
  INTO v_plans
  FROM (
    SELECT jsonb_build_object(
      'id', catalog.id,
      'code', catalog.code,
      'name', catalog.display_name,
      'description', catalog.description,
      'active', catalog.active,
      'current_version', CASE
        WHEN version.id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'id', version.id,
          'version', version.version_number,
          'monthly_price', version.monthly_price,
          'currency', version.currency,
          'billing_cycle', version.billing_cycle,
          'effective_from', version.effective_from,
          'effective_to', version.effective_to
        )
      END
    ) AS item
    FROM public.finance_plan_catalog AS catalog
    LEFT JOIN LATERAL (
      SELECT *
      FROM public.finance_plan_versions AS candidate
      WHERE candidate.plan_id = catalog.id
        AND candidate.status = 'published'
        AND candidate.effective_from <= p_period_end
        AND (
          candidate.effective_to IS NULL
          OR candidate.effective_to >= p_period_start
        )
      ORDER BY candidate.version_number DESC
      LIMIT 1
    ) AS version ON true
  ) AS plan_rows;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', subscription.id,
        'client_id', subscription.client_id,
        'status', subscription.status,
        'amount', subscription.agreed_monthly_amount,
        'currency', subscription.currency,
        'billing_day', subscription.billing_day,
        'starts_on', subscription.starts_on,
        'ends_on', subscription.ends_on,
        'next_billing_date', subscription.next_billing_date,
        'is_custom', subscription.is_custom,
        'review_status', subscription.review_status,
        'plan', jsonb_build_object(
          'catalog_id', catalog.id,
          'version_id', version.id,
          'code', catalog.code,
          'name', catalog.display_name,
          'version', version.version_number,
          'list_price', version.monthly_price
        )
      )
      ORDER BY subscription.starts_on DESC, subscription.id
    ),
    '[]'::jsonb
  )
  INTO v_subscriptions
  FROM public.finance_client_subscriptions AS subscription
  JOIN public.finance_plan_versions AS version
    ON version.id = subscription.plan_version_id
  JOIN public.finance_plan_catalog AS catalog
    ON catalog.id = version.plan_id
  WHERE subscription.starts_on <= p_period_end
    AND (
      subscription.ends_on IS NULL
      OR subscription.ends_on >= p_period_start
    );

  SELECT COALESCE(
    jsonb_agg(to_jsonb(flow) ORDER BY flow.date DESC, flow.id),
    '[]'::jsonb
  )
  INTO v_cash_flow
  FROM (
    SELECT
      'billing:' || bill.id || ':competence' AS id,
      bill.id::text AS obligation_id,
      bill.due_date AS date,
      'income'::text AS type,
      'competence'::text AS basis,
      'billing'::text AS source,
      bill.type AS category,
      COALESCE(bill.description, 'Cobrança') AS description,
      bill.amount::numeric(14,2) AS amount,
      bill.status,
      bill.client_id,
      NULL::uuid AS project_id
    FROM public.billing AS bill
    WHERE bill.due_date BETWEEN p_period_start AND p_period_end
      AND lower(COALESCE(bill.status, '')) NOT IN (
        'cancelled', 'canceled', 'cancelado'
      )

    UNION ALL

    SELECT
      'project_installment:' || installment.id || ':competence',
      installment.id::text,
      installment.due_date,
      'income',
      'competence',
      'project_installment',
      'project',
      'Parcela ' || installment.installment_number,
      installment.amount::numeric(14,2),
      installment.status,
      payment.client_id,
      payment.project_id
    FROM public.payment_installments AS installment
    JOIN public.project_payments AS payment
      ON payment.id = installment.payment_id
    WHERE v_mode = 'separate'
      AND installment.due_date BETWEEN p_period_start AND p_period_end
      AND lower(COALESCE(installment.status, '')) NOT IN (
        'cancelled', 'canceled', 'cancelado'
      )

    UNION ALL

    SELECT
      'expense:' || expense.id || ':competence',
      expense.id::text,
      expense.due_date,
      'expense',
      'competence',
      'expense',
      expense.category,
      expense.description,
      expense.amount::numeric(14,2),
      expense.status,
      NULL::uuid,
      NULL::uuid
    FROM public.expenses AS expense
    WHERE expense.due_date BETWEEN p_period_start AND p_period_end
      AND lower(COALESCE(expense.status, '')) NOT IN (
        'cancelled', 'canceled', 'cancelado'
      )

    UNION ALL

    SELECT
      'billing:' || bill.id || ':cash',
      bill.id::text,
      bill.paid_date,
      'income',
      'cash',
      'billing',
      bill.type,
      COALESCE(bill.description, 'Cobrança'),
      public.finance_received_amount(
        bill.status,
        bill.amount,
        bill.paid_amount
      )::numeric(14,2),
      bill.status,
      bill.client_id,
      NULL::uuid
    FROM public.billing AS bill
    WHERE bill.paid_date BETWEEN p_period_start AND p_period_end
      AND public.finance_received_amount(
        bill.status,
        bill.amount,
        bill.paid_amount
      ) > 0

    UNION ALL

    SELECT
      'project_installment:' || installment.id || ':cash',
      installment.id::text,
      installment.paid_date,
      'income',
      'cash',
      'project_installment',
      'project',
      'Parcela ' || installment.installment_number,
      public.finance_received_amount(
        installment.status,
        installment.amount,
        installment.paid_amount
      )::numeric(14,2),
      installment.status,
      payment.client_id,
      payment.project_id
    FROM public.payment_installments AS installment
    JOIN public.project_payments AS payment
      ON payment.id = installment.payment_id
    WHERE v_mode = 'separate'
      AND installment.paid_date BETWEEN p_period_start AND p_period_end
      AND public.finance_received_amount(
        installment.status,
        installment.amount,
        installment.paid_amount
      ) > 0

    UNION ALL

    SELECT
      'expense:' || expense.id || ':cash',
      expense.id::text,
      expense.paid_date,
      'expense',
      'cash',
      'expense',
      expense.category,
      expense.description,
      expense.amount::numeric(14,2),
      expense.status,
      NULL::uuid,
      NULL::uuid
    FROM public.expenses AS expense
    WHERE expense.paid_date BETWEEN p_period_start AND p_period_end
      AND lower(COALESCE(expense.status, '')) NOT IN (
        'cancelled', 'canceled', 'cancelado'
      )

    UNION ALL

    SELECT
      'billing:' || bill.id || ':forecast',
      bill.id::text,
      bill.due_date,
      'income',
      'forecast',
      'billing',
      bill.type,
      COALESCE(bill.description, 'Cobrança'),
      GREATEST(
        bill.amount - public.finance_received_amount(
          bill.status,
          bill.amount,
          bill.paid_amount
        ),
        0
      )::numeric(14,2),
      bill.status,
      bill.client_id,
      NULL::uuid
    FROM public.billing AS bill
    WHERE bill.due_date BETWEEN GREATEST(p_period_start, CURRENT_DATE)
      AND p_period_end
      AND lower(COALESCE(bill.status, '')) NOT IN (
        'cancelled', 'canceled', 'cancelado'
      )
      AND GREATEST(
        bill.amount - public.finance_received_amount(
          bill.status,
          bill.amount,
          bill.paid_amount
        ),
        0
      ) > 0

    UNION ALL

    SELECT
      'project_installment:' || installment.id || ':forecast',
      installment.id::text,
      installment.due_date,
      'income',
      'forecast',
      'project_installment',
      'project',
      'Parcela ' || installment.installment_number,
      GREATEST(
        installment.amount - public.finance_received_amount(
          installment.status,
          installment.amount,
          installment.paid_amount
        ),
        0
      )::numeric(14,2),
      installment.status,
      payment.client_id,
      payment.project_id
    FROM public.payment_installments AS installment
    JOIN public.project_payments AS payment
      ON payment.id = installment.payment_id
    WHERE v_mode = 'separate'
      AND installment.due_date
        BETWEEN GREATEST(p_period_start, CURRENT_DATE) AND p_period_end
      AND lower(COALESCE(installment.status, '')) NOT IN (
        'cancelled', 'canceled', 'cancelado'
      )
      AND GREATEST(
        installment.amount - public.finance_received_amount(
          installment.status,
          installment.amount,
          installment.paid_amount
        ),
        0
      ) > 0

    UNION ALL

    SELECT
      'expense:' || expense.id || ':forecast',
      expense.id::text,
      expense.due_date,
      'expense',
      'forecast',
      'expense',
      expense.category,
      expense.description,
      expense.amount::numeric(14,2),
      expense.status,
      NULL::uuid,
      NULL::uuid
    FROM public.expenses AS expense
    WHERE expense.due_date
      BETWEEN GREATEST(p_period_start, CURRENT_DATE) AND p_period_end
      AND expense.paid_date IS NULL
      AND lower(COALESCE(expense.status, '')) NOT IN (
        'paid', 'pago', 'completed', 'complete',
        'cancelled', 'canceled', 'cancelado'
      )

    UNION ALL

    SELECT
      'fixed_cost:' || occurrence.fixed_cost_id
        || ':' || occurrence.due_date || ':forecast',
      occurrence.fixed_cost_id::text,
      occurrence.due_date,
      'expense',
      'forecast',
      'fixed_cost',
      occurrence.category,
      occurrence.name,
      occurrence.amount,
      'planned',
      NULL::uuid,
      NULL::uuid
    FROM public.finance_fixed_cost_occurrences(
      GREATEST(p_period_start, CURRENT_DATE),
      p_period_end
    ) AS occurrence
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.expenses AS expense
      WHERE expense.fixed_cost_id = occurrence.fixed_cost_id
        AND expense.expense_period_start =
          date_trunc('month', occurrence.due_date)::date
        AND lower(COALESCE(expense.status, '')) NOT IN (
          'cancelled', 'canceled', 'cancelado'
        )
    )
  ) AS flow;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', cost.id,
        'name', cost.name,
        'category', cost.category,
        'amount', cost.amount,
        'currency', cost.currency,
        'frequency', cost.frequency,
        'due_day', cost.due_day,
        'starts_on', cost.starts_on,
        'ends_on', cost.ends_on,
        'active', cost.active AND cost.archived_at IS NULL,
        'next_due_date', CASE
          WHEN cost.active AND cost.archived_at IS NULL THEN (
            SELECT occurrence.due_date
            FROM public.finance_fixed_cost_occurrences(
              GREATEST(CURRENT_DATE, p_period_start),
              p_period_end
            ) AS occurrence
            WHERE occurrence.fixed_cost_id = cost.id
            ORDER BY occurrence.due_date
            LIMIT 1
          )
          ELSE NULL
        END,
        'supplier', cost.supplier,
        'payment_method', cost.payment_method,
        'brand', cost.brand,
        'notes', cost.notes
      )
      ORDER BY cost.active DESC, cost.name, cost.id
    ),
    '[]'::jsonb
  )
  INTO v_fixed_costs
  FROM public.finance_fixed_costs AS cost;

  SELECT jsonb_build_object(
    'currency', default_currency,
    'default_billing_day', default_billing_day,
    'tax_rate_percent', tax_rate_percent,
    'project_receipts_mode', project_receipts_mode,
    'closing_requires_completed_month', closing_requires_completed_month,
    'timezone', timezone,
    'goals', jsonb_build_object(
      'monthly_revenue', monthly_revenue_goal,
      'retention_percent', retention_percent,
      'reserve_months', reserve_months,
      'minimum_margin_percent', minimum_margin_percent,
      'target_pro_labore', target_pro_labore
    )
  )
  INTO v_settings
  FROM public.finance_settings
  WHERE id = 1;

  RETURN jsonb_build_object(
    'schema_version', 2,
    'generated_at', now(),
    'period', jsonb_build_object(
      'start', p_period_start,
      'end', p_period_end,
      'status', CASE WHEN v_closed THEN 'closed' ELSE 'open' END,
      'closure_id', CASE WHEN v_closed THEN v_closure.id ELSE NULL END,
      'revision', CASE WHEN v_closed THEN v_closure.revision ELSE NULL END
    ),
    'summary', jsonb_build_object(
      'recurring_mrr', (v_snapshot ->> 'recurring_mrr')::numeric,
      'cash', v_snapshot -> 'cash',
      'accrual', v_snapshot -> 'accrual',
      'forecast', v_snapshot -> 'forecast',
      'receivables_open',
        (v_snapshot ->> 'receivables_open')::numeric
    ),
    'clients', v_clients,
    'cash_flow', v_cash_flow,
    'subscriptions', v_subscriptions,
    'fixed_costs', v_fixed_costs,
    'plans', v_plans,
    'settings', v_settings
  );
END
$$;

ALTER TABLE public.finance_plan_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_plan_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_client_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_fixed_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_period_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS finance_plan_catalog_select
  ON public.finance_plan_catalog;
CREATE POLICY finance_plan_catalog_select
ON public.finance_plan_catalog
FOR SELECT
TO authenticated
USING (
  public.finance_can_manage()
  OR EXISTS (
    SELECT 1
    FROM public.finance_plan_versions AS version
    JOIN public.finance_client_subscriptions AS subscription
      ON subscription.plan_version_id = version.id
    WHERE version.plan_id = finance_plan_catalog.id
      AND subscription.client_id = auth.uid()
  )
);

DROP POLICY IF EXISTS finance_plan_versions_select
  ON public.finance_plan_versions;
CREATE POLICY finance_plan_versions_select
ON public.finance_plan_versions
FOR SELECT
TO authenticated
USING (
  public.finance_can_manage()
  OR EXISTS (
    SELECT 1
    FROM public.finance_client_subscriptions AS subscription
    WHERE subscription.plan_version_id = finance_plan_versions.id
      AND subscription.client_id = auth.uid()
  )
);

DROP POLICY IF EXISTS finance_subscriptions_select
  ON public.finance_client_subscriptions;
CREATE POLICY finance_subscriptions_select
ON public.finance_client_subscriptions
FOR SELECT
TO authenticated
USING (
  public.finance_can_manage()
  OR client_id = auth.uid()
);

DROP POLICY IF EXISTS finance_settings_select
  ON public.finance_settings;
CREATE POLICY finance_settings_select
ON public.finance_settings
FOR SELECT
TO authenticated
USING (public.finance_can_manage());

DROP POLICY IF EXISTS finance_fixed_costs_select
  ON public.finance_fixed_costs;
CREATE POLICY finance_fixed_costs_select
ON public.finance_fixed_costs
FOR SELECT
TO authenticated
USING (public.finance_can_manage());

DROP POLICY IF EXISTS finance_period_closures_select
  ON public.finance_period_closures;
CREATE POLICY finance_period_closures_select
ON public.finance_period_closures
FOR SELECT
TO authenticated
USING (public.finance_can_manage());

DROP POLICY IF EXISTS finance_audit_log_select
  ON public.finance_audit_log;
CREATE POLICY finance_audit_log_select
ON public.finance_audit_log
FOR SELECT
TO authenticated
USING (public.finance_can_manage());

REVOKE ALL ON TABLE
  public.finance_plan_catalog,
  public.finance_plan_versions,
  public.finance_client_subscriptions,
  public.finance_settings,
  public.finance_fixed_costs,
  public.finance_period_closures,
  public.finance_audit_log
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
  public.finance_plan_catalog,
  public.finance_plan_versions,
  public.finance_client_subscriptions,
  public.finance_settings,
  public.finance_fixed_costs,
  public.finance_period_closures,
  public.finance_audit_log
TO authenticated;

REVOKE ALL ON SEQUENCE public.finance_audit_log_id_seq
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.finance_is_admin()
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_can_manage()
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_assert_admin()
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_assert_manager()
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_touch_updated_at()
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_received_amount(text, numeric, numeric)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_capture_audit()
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_capture_profile_plan_audit()
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_period_is_closed(date)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_guard_closed_period()
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_fixed_cost_occurrences(date, date)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_backfill_legacy_subscriptions()
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION
  public.finance_build_period_snapshot_internal(date, date)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION
  public.finance_upsert_plan(text, text, text, boolean, integer)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION
  public.finance_publish_plan_version(
    uuid, numeric, date, numeric, text, text, jsonb
  )
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION
  public.finance_set_client_subscription(
    uuid, uuid, date, numeric, smallint, date, text
  )
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION
  public.finance_review_subscription(uuid, numeric, date, text)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION
  public.finance_issue_subscription_billing(uuid, date, date, text)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_generate_monthly_billing(date)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION
  public.finance_upsert_fixed_cost(
    text, numeric, text, smallint, uuid, text, text,
    date, date, boolean, text, text, text, text
  )
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_archive_fixed_cost(uuid, text)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION
  public.finance_update_settings(
    text, smallint, numeric, text, boolean, text,
    numeric, numeric, numeric, numeric, numeric
  )
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_get_period_snapshot(date, date)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_close_period(date, text)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_reopen_period(date, text)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_get_dashboard(date, date)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.finance_can_manage()
TO authenticated;
GRANT EXECUTE ON FUNCTION
  public.finance_upsert_plan(text, text, text, boolean, integer)
TO authenticated;
GRANT EXECUTE ON FUNCTION
  public.finance_publish_plan_version(
    uuid, numeric, date, numeric, text, text, jsonb
  )
TO authenticated;
GRANT EXECUTE ON FUNCTION
  public.finance_set_client_subscription(
    uuid, uuid, date, numeric, smallint, date, text
  )
TO authenticated;
GRANT EXECUTE ON FUNCTION
  public.finance_review_subscription(uuid, numeric, date, text)
TO authenticated;
GRANT EXECUTE ON FUNCTION
  public.finance_issue_subscription_billing(uuid, date, date, text)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_generate_monthly_billing(date)
TO authenticated;
GRANT EXECUTE ON FUNCTION
  public.finance_upsert_fixed_cost(
    text, numeric, text, smallint, uuid, text, text,
    date, date, boolean, text, text, text, text
  )
TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_archive_fixed_cost(uuid, text)
TO authenticated;
GRANT EXECUTE ON FUNCTION
  public.finance_update_settings(
    text, smallint, numeric, text, boolean, text,
    numeric, numeric, numeric, numeric, numeric
  )
TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_get_period_snapshot(date, date)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_close_period(date, text)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_reopen_period(date, text)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_get_dashboard(date, date)
TO authenticated;

SELECT public.finance_backfill_legacy_subscriptions();

ALTER TABLE public.billing
  VALIDATE CONSTRAINT billing_subscription_id_fk;
ALTER TABLE public.billing
  VALIDATE CONSTRAINT billing_plan_version_id_fk;
ALTER TABLE public.billing
  VALIDATE CONSTRAINT billing_period_window_ck;
ALTER TABLE public.expenses
  VALIDATE CONSTRAINT expenses_fixed_cost_id_fk;

COMMENT ON TABLE public.finance_client_subscriptions IS
  'Versioned client contracts. Legacy import does not create billing.';
COMMENT ON TABLE public.finance_fixed_costs IS
  'Planning templates affect forecast and never create expenses automatically.';
COMMENT ON TABLE public.finance_period_closures IS
  'Revisioned immutable financial snapshots.';

COMMIT;
