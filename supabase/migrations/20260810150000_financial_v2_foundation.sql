-- Financeiro V2 foundation.
-- Forward-only and additive: legacy finance tables are read for conservative
-- backfill only and are never updated or deleted by this migration.

CREATE SCHEMA IF NOT EXISTS app_private AUTHORIZATION postgres;

CREATE TABLE public.financial_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE,
  name text NOT NULL CHECK (btrim(name) <> ''),
  description text,
  operational_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.financial_plan_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.financial_plans(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  operational_amount numeric(14,2) NOT NULL CHECK (operational_amount >= 0),
  amount_kind text NOT NULL DEFAULT 'operational'
    CHECK (amount_kind IN ('operational', 'final', 'needs_review')),
  tax_rate numeric(7,6) CHECK (tax_rate >= 0 AND tax_rate < 1),
  final_amount numeric(14,2) NOT NULL CHECK (final_amount >= 0),
  direct_cost_amount numeric(14,2) NOT NULL DEFAULT 275 CHECK (direct_cost_amount >= 0),
  direct_cost_estimated boolean NOT NULL DEFAULT true,
  billing_period text NOT NULL DEFAULT 'monthly'
    CHECK (billing_period IN ('monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual')),
  setup_fee numeric(14,2) NOT NULL DEFAULT 0 CHECK (setup_fee >= 0),
  valid_from date NOT NULL,
  valid_to date,
  is_active boolean NOT NULL DEFAULT true,
  description text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT financial_plan_versions_valid_range
    CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT financial_plan_versions_plan_version_key UNIQUE (plan_id, version)
);

CREATE TABLE public.financial_client_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  plan_version_id uuid REFERENCES public.financial_plan_versions(id) ON DELETE RESTRICT,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  pricing_mode text NOT NULL DEFAULT 'linked'
    CHECK (pricing_mode IN ('linked', 'custom')),
  custom_justification text,
  operational_amount numeric(14,2) NOT NULL CHECK (operational_amount >= 0),
  amount_kind text NOT NULL DEFAULT 'operational'
    CHECK (amount_kind IN ('operational', 'final', 'needs_review')),
  tax_rate numeric(7,6) CHECK (tax_rate >= 0 AND tax_rate < 1),
  final_amount numeric(14,2) NOT NULL CHECK (final_amount >= 0),
  direct_cost_amount numeric(14,2) NOT NULL DEFAULT 275 CHECK (direct_cost_amount >= 0),
  direct_cost_estimated boolean NOT NULL DEFAULT true,
  due_day integer NOT NULL DEFAULT 10 CHECK (due_day BETWEEN 1 AND 28),
  billing_period text NOT NULL DEFAULT 'monthly'
    CHECK (billing_period IN ('monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual')),
  payment_method text,
  contract_started_on date,
  next_adjustment_on date,
  starts_on date NOT NULL,
  ends_on date,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'paused', 'ended', 'archived')),
  review_required boolean NOT NULL DEFAULT false,
  notes text,
  source_system text NOT NULL DEFAULT 'finance_v2',
  legacy_source_id uuid,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT financial_client_terms_valid_range
    CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT financial_client_terms_custom_reason
    CHECK (pricing_mode <> 'custom' OR custom_justification IS NOT NULL)
);

CREATE TABLE public.financial_recurring_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stable_code text UNIQUE,
  name text NOT NULL CHECK (btrim(name) <> ''),
  description text,
  direction text NOT NULL CHECK (direction IN ('income', 'expense')),
  kind text NOT NULL DEFAULT 'fixed_cost'
    CHECK (kind IN ('recurring', 'fixed_cost', 'pro_labore', 'tax', 'other')),
  category text,
  brand text,
  client_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  term_id uuid REFERENCES public.financial_client_terms(id) ON DELETE SET NULL,
  operational_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (operational_amount >= 0),
  tax_rate numeric(7,6) CHECK (tax_rate >= 0 AND tax_rate < 1),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  direct_cost_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (direct_cost_amount >= 0),
  direct_cost_estimated boolean NOT NULL DEFAULT false,
  frequency text NOT NULL DEFAULT 'monthly'
    CHECK (frequency IN ('monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual')),
  due_day integer NOT NULL DEFAULT 10 CHECK (due_day BETWEEN 1 AND 28),
  starts_on date NOT NULL,
  ends_on date,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT financial_recurring_rules_valid_range
    CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

CREATE TABLE public.financial_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction text NOT NULL CHECK (direction IN ('income', 'expense')),
  kind text NOT NULL
    CHECK (kind IN ('recurring', 'one_off', 'fixed_cost', 'pro_labore', 'tax', 'adjustment', 'other')),
  client_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  term_id uuid REFERENCES public.financial_client_terms(id) ON DELETE SET NULL,
  plan_version_id uuid REFERENCES public.financial_plan_versions(id) ON DELETE SET NULL,
  recurring_rule_id uuid REFERENCES public.financial_recurring_rules(id) ON DELETE SET NULL,
  brand text,
  category text,
  competence date NOT NULL CHECK (competence = date_trunc('month', competence)::date),
  competence_source text NOT NULL DEFAULT 'explicit',
  due_date date NOT NULL,
  operational_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (operational_amount >= 0),
  tax_rate numeric(7,6) CHECK (tax_rate >= 0 AND tax_rate < 1),
  tax_reserve numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_reserve >= 0),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  direct_cost_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (direct_cost_amount >= 0),
  direct_cost_estimated boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('draft', 'open', 'cancelled')),
  description text NOT NULL CHECK (btrim(description) <> ''),
  source_system text NOT NULL DEFAULT 'finance_v2',
  legacy_source_table text,
  legacy_source_id uuid,
  idempotency_key text NOT NULL UNIQUE,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancellation_reason text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.financial_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.financial_entries(id) ON DELETE RESTRICT,
  kind text NOT NULL DEFAULT 'payment' CHECK (kind IN ('payment', 'reversal', 'refund')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  tax_reserve_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_reserve_amount >= 0),
  settled_on date NOT NULL,
  method text,
  account_name text,
  notes text,
  reversal_of_id uuid UNIQUE REFERENCES public.financial_settlements(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL UNIQUE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.financial_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settings_key text NOT NULL DEFAULT 'default' UNIQUE,
  currency text NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  opening_balance numeric(14,2),
  reserve_target numeric(14,2) CHECK (reserve_target >= 0),
  default_due_day integer NOT NULL DEFAULT 10 CHECK (default_due_day BETWEEN 1 AND 28),
  forecast_months integer NOT NULL DEFAULT 6 CHECK (forecast_months BETWEEN 1 AND 24),
  monthly_goal numeric(14,2) CHECK (monthly_goal >= 0),
  growth_retention_rate numeric(7,6) CHECK (growth_retention_rate BETWEEN 0 AND 1),
  minimum_reserve_months numeric(8,2) CHECK (minimum_reserve_months >= 0),
  desired_minimum_margin numeric(7,6) CHECK (desired_minimum_margin BETWEEN -1 AND 1),
  current_pro_labore numeric(14,2) NOT NULL DEFAULT 3000 CHECK (current_pro_labore >= 0),
  target_pro_labore numeric(14,2) NOT NULL DEFAULT 10000 CHECK (target_pro_labore >= 0),
  tools_systems_cost numeric(14,2) NOT NULL DEFAULT 2500 CHECK (tools_systems_cost >= 0),
  default_direct_cost numeric(14,2) NOT NULL DEFAULT 275 CHECK (default_direct_cost >= 0),
  default_direct_cost_estimated boolean NOT NULL DEFAULT true,
  allocation_method text NOT NULL DEFAULT 'equal'
    CHECK (allocation_method IN ('equal', 'revenue', 'custom', 'none')),
  include_pro_labore_in_allocation boolean NOT NULL DEFAULT false,
  owner_name text NOT NULL DEFAULT 'Almir',
  owner_profit_share numeric(7,6) NOT NULL DEFAULT 1 CHECK (owner_profit_share = 1),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.financial_period_closures (
  competence date PRIMARY KEY CHECK (competence = date_trunc('month', competence)::date),
  period_status text NOT NULL DEFAULT 'open' CHECK (period_status IN ('open', 'closed')),
  closed_at timestamptz,
  closed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  close_reason text,
  reopened_at timestamptz,
  reopened_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reopen_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_private.financial_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_table text NOT NULL,
  entity_id text,
  action text NOT NULL,
  actor_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX financial_client_terms_one_current_idx
  ON public.financial_client_terms (client_id)
  WHERE status IN ('draft', 'active', 'paused') AND ends_on IS NULL AND client_id IS NOT NULL;
CREATE UNIQUE INDEX financial_entries_term_competence_idx
  ON public.financial_entries (term_id, competence)
  WHERE term_id IS NOT NULL AND kind = 'recurring' AND status <> 'cancelled';
CREATE UNIQUE INDEX financial_entries_client_competence_idx
  ON public.financial_entries (client_id, competence)
  WHERE client_id IS NOT NULL AND term_id IS NOT NULL
    AND kind = 'recurring' AND status <> 'cancelled';
CREATE UNIQUE INDEX financial_entries_rule_competence_idx
  ON public.financial_entries (recurring_rule_id, competence)
  WHERE recurring_rule_id IS NOT NULL AND status <> 'cancelled';
CREATE UNIQUE INDEX financial_entries_legacy_source_idx
  ON public.financial_entries (source_system, legacy_source_table, legacy_source_id)
  WHERE legacy_source_id IS NOT NULL;
CREATE INDEX financial_plan_versions_plan_dates_idx
  ON public.financial_plan_versions (plan_id, valid_from DESC, valid_to);
CREATE INDEX financial_client_terms_client_status_idx
  ON public.financial_client_terms (client_id, status, starts_on DESC);
CREATE INDEX financial_entries_competence_direction_idx
  ON public.financial_entries (competence, direction, kind);
CREATE INDEX financial_entries_client_due_idx
  ON public.financial_entries (client_id, due_date);
CREATE INDEX financial_entries_open_due_idx
  ON public.financial_entries (due_date) WHERE status = 'open';
CREATE INDEX financial_settlements_entry_date_idx
  ON public.financial_settlements (entry_id, settled_on);
CREATE INDEX financial_recurring_rules_active_dates_idx
  ON public.financial_recurring_rules (is_active, starts_on, ends_on);
CREATE INDEX financial_audit_entity_idx
  ON app_private.financial_audit_log (entity_table, entity_id, created_at DESC);

CREATE TRIGGER financial_plans_updated_at
  BEFORE UPDATE ON public.financial_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER financial_plan_versions_updated_at
  BEFORE UPDATE ON public.financial_plan_versions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER financial_client_terms_updated_at
  BEFORE UPDATE ON public.financial_client_terms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER financial_recurring_rules_updated_at
  BEFORE UPDATE ON public.financial_recurring_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER financial_entries_updated_at
  BEFORE UPDATE ON public.financial_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER financial_settings_updated_at
  BEFORE UPDATE ON public.financial_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER financial_period_closures_updated_at
  BEFORE UPDATE ON public.financial_period_closures
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION app_private.financial_audit_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  row_id text;
BEGIN
  row_id := COALESCE(
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW)->>'id' END,
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD)->>'id' END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW)->>'competence' END,
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD)->>'competence' END
  );

  INSERT INTO app_private.financial_audit_log (
    entity_table,
    entity_id,
    action,
    actor_id,
    old_data,
    new_data
  ) VALUES (
    TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
    row_id,
    TG_OP,
    auth.uid(),
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END
  );

  -- The return value of an AFTER trigger is ignored. Returning NULL also avoids
  -- dereferencing an unassigned transition record on INSERT/DELETE.
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.financial_lock_open_period(p_competence date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  locked_status text;
  normalized_competence date := date_trunc('month', p_competence)::date;
BEGIN
  IF p_competence IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.financial_period_closures (competence, period_status)
  VALUES (normalized_competence, 'open')
  ON CONFLICT (competence) DO NOTHING;

  SELECT closure_row.period_status
  INTO locked_status
  FROM public.financial_period_closures closure_row
  WHERE closure_row.competence = normalized_competence
  FOR UPDATE;

  IF locked_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'financial period % is closed (fechado)', normalized_competence
      USING ERRCODE = '55000';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.financial_guard_entry_period()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  old_competence date;
  new_competence date;
  lock_competence date;
BEGIN
  old_competence := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.competence END;
  new_competence := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.competence END;

  -- Lock every affected competence in a deterministic order. The shared helper
  -- materializes an OPEN row when absent, locks it without filtering by status,
  -- and only then rejects CLOSED. This serializes mutations with month closing.
  FOR lock_competence IN
    SELECT DISTINCT candidate_competence
    FROM unnest(ARRAY[old_competence, new_competence]) AS candidate_competence
    WHERE candidate_competence IS NOT NULL
    ORDER BY candidate_competence
  LOOP
    PERFORM app_private.financial_lock_open_period(lock_competence);
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION app_private.financial_guard_settlement_period()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_competence date;
BEGIN
  target_competence := date_trunc(
    'month',
    CASE WHEN TG_OP = 'DELETE' THEN OLD.settled_on ELSE NEW.settled_on END
  )::date;

  PERFORM app_private.financial_lock_open_period(target_competence);
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION app_private.financial_settlement_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'financial settlements are append-only; use a reversal'
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION app_private.financial_entry_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'financial entries are append-only; use an audited cancellation'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status NOT IN ('draft', 'open')
     OR NEW.status <> 'cancelled'
     OR NEW.cancelled_at IS NULL
     OR NEW.cancelled_by IS NULL
     OR NEW.cancelled_by IS DISTINCT FROM auth.uid()
     OR NULLIF(btrim(NEW.cancellation_reason), '') IS NULL
     OR (to_jsonb(NEW) - ARRAY[
       'status', 'cancelled_at', 'cancelled_by', 'cancellation_reason', 'updated_at'
     ]) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY[
       'status', 'cancelled_at', 'cancelled_by', 'cancellation_reason', 'updated_at'
     ]) THEN
    RAISE EXCEPTION 'financial entries are append-only; only audited cancellation is allowed'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.financial_plan_version_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'plan versions are immutable and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF (to_jsonb(NEW) - ARRAY['valid_to', 'is_active', 'updated_at'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['valid_to', 'is_active', 'updated_at']) THEN
    RAISE EXCEPTION 'plan versions are immutable; create a new version'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.financial_sync_rule_to_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.stable_code = 'pro-labore-almir' THEN
    UPDATE public.financial_settings
    SET current_pro_labore = NEW.amount,
        updated_by = COALESCE(auth.uid(), updated_by)
    WHERE settings_key = 'default'
      AND current_pro_labore IS DISTINCT FROM NEW.amount;
  ELSIF NEW.stable_code = 'tools-systems' THEN
    UPDATE public.financial_settings
    SET tools_systems_cost = NEW.amount,
        updated_by = COALESCE(auth.uid(), updated_by)
    WHERE settings_key = 'default'
      AND tools_systems_cost IS DISTINCT FROM NEW.amount;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.financial_sync_settings_to_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.financial_recurring_rules
  SET amount = NEW.current_pro_labore,
      operational_amount = 0
  WHERE stable_code = 'pro-labore-almir'
    AND amount IS DISTINCT FROM NEW.current_pro_labore;

  UPDATE public.financial_recurring_rules
  SET amount = NEW.tools_systems_cost,
      operational_amount = 0
  WHERE stable_code = 'tools-systems'
    AND amount IS DISTINCT FROM NEW.tools_systems_cost;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.financial_audit_row() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.financial_lock_open_period(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.financial_guard_entry_period() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.financial_guard_settlement_period() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.financial_settlement_append_only() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.financial_entry_append_only() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.financial_plan_version_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.financial_sync_rule_to_settings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.financial_sync_settings_to_rules() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER financial_entries_period_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.financial_entries
  FOR EACH ROW EXECUTE FUNCTION app_private.financial_guard_entry_period();
CREATE TRIGGER financial_entries_append_only
  BEFORE UPDATE OR DELETE ON public.financial_entries
  FOR EACH ROW EXECUTE FUNCTION app_private.financial_entry_append_only();
CREATE TRIGGER financial_settlements_period_guard
  BEFORE INSERT ON public.financial_settlements
  FOR EACH ROW EXECUTE FUNCTION app_private.financial_guard_settlement_period();
CREATE TRIGGER financial_settlements_append_only
  BEFORE UPDATE OR DELETE ON public.financial_settlements
  FOR EACH ROW EXECUTE FUNCTION app_private.financial_settlement_append_only();
CREATE TRIGGER financial_plan_versions_immutable
  BEFORE UPDATE OR DELETE ON public.financial_plan_versions
  FOR EACH ROW EXECUTE FUNCTION app_private.financial_plan_version_immutable();
CREATE TRIGGER financial_recurring_rules_sync_settings
  AFTER INSERT OR UPDATE OF amount, stable_code ON public.financial_recurring_rules
  FOR EACH ROW EXECUTE FUNCTION app_private.financial_sync_rule_to_settings();
CREATE TRIGGER financial_settings_sync_rules
  AFTER INSERT OR UPDATE OF current_pro_labore, tools_systems_cost ON public.financial_settings
  FOR EACH ROW EXECUTE FUNCTION app_private.financial_sync_settings_to_rules();

CREATE TRIGGER financial_plans_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.financial_plans
  FOR EACH ROW EXECUTE FUNCTION app_private.financial_audit_row();
CREATE TRIGGER financial_plan_versions_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.financial_plan_versions
  FOR EACH ROW EXECUTE FUNCTION app_private.financial_audit_row();
CREATE TRIGGER financial_client_terms_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.financial_client_terms
  FOR EACH ROW EXECUTE FUNCTION app_private.financial_audit_row();
CREATE TRIGGER financial_recurring_rules_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.financial_recurring_rules
  FOR EACH ROW EXECUTE FUNCTION app_private.financial_audit_row();
CREATE TRIGGER financial_entries_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.financial_entries
  FOR EACH ROW EXECUTE FUNCTION app_private.financial_audit_row();
CREATE TRIGGER financial_settlements_audit
  AFTER INSERT ON public.financial_settlements
  FOR EACH ROW EXECUTE FUNCTION app_private.financial_audit_row();
CREATE TRIGGER financial_settings_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.financial_settings
  FOR EACH ROW EXECUTE FUNCTION app_private.financial_audit_row();
CREATE TRIGGER financial_period_closures_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.financial_period_closures
  FOR EACH ROW EXECUTE FUNCTION app_private.financial_audit_row();

ALTER TABLE public.financial_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_plan_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_client_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_recurring_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_period_closures ENABLE ROW LEVEL SECURITY;

CREATE POLICY financial_plans_read ON public.financial_plans
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );
CREATE POLICY financial_plan_versions_read ON public.financial_plan_versions
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );
CREATE POLICY financial_client_terms_read ON public.financial_client_terms
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );
CREATE POLICY financial_recurring_rules_read ON public.financial_recurring_rules
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );
CREATE POLICY financial_entries_read ON public.financial_entries
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );
CREATE POLICY financial_settlements_read ON public.financial_settlements
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );
CREATE POLICY financial_settings_read ON public.financial_settings
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );
CREATE POLICY financial_period_closures_read ON public.financial_period_closures
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

REVOKE ALL ON TABLE public.financial_plans FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.financial_plan_versions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.financial_client_terms FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.financial_recurring_rules FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.financial_entries FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.financial_settlements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.financial_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.financial_period_closures FROM PUBLIC, anon, authenticated;
-- Keep the private boundary unreachable to API roles. Audit writes happen
-- through owner-controlled triggers/functions, never by granting direct
-- service_role access to app_private.
REVOKE ALL ON TABLE app_private.financial_audit_log
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE app_private.financial_audit_log_id_seq
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.financial_plans TO authenticated;
GRANT SELECT ON TABLE public.financial_plan_versions TO authenticated;
GRANT SELECT ON TABLE public.financial_client_terms TO authenticated;
GRANT SELECT ON TABLE public.financial_recurring_rules TO authenticated;
GRANT SELECT ON TABLE public.financial_entries TO authenticated;
GRANT SELECT ON TABLE public.financial_settlements TO authenticated;
GRANT SELECT ON TABLE public.financial_settings TO authenticated;
GRANT SELECT ON TABLE public.financial_period_closures TO authenticated;
GRANT ALL ON TABLE public.financial_plans TO service_role;
GRANT ALL ON TABLE public.financial_plan_versions TO service_role;
GRANT ALL ON TABLE public.financial_client_terms TO service_role;
GRANT ALL ON TABLE public.financial_recurring_rules TO service_role;
GRANT ALL ON TABLE public.financial_entries TO service_role;
GRANT ALL ON TABLE public.financial_settlements TO service_role;
GRANT ALL ON TABLE public.financial_settings TO service_role;
GRANT ALL ON TABLE public.financial_period_closures TO service_role;

CREATE VIEW public.financial_entries_enriched
WITH (security_invoker = true)
AS
SELECT
  entry_row.*,
  profile_row.company_name,
  profile_row.full_name,
  COALESCE(settlement_totals.settled_amount, 0::numeric) AS settled_amount,
  GREATEST(entry_row.amount - COALESCE(settlement_totals.settled_amount, 0::numeric), 0::numeric)
    AS outstanding_amount,
  settlement_totals.settled_at,
  CASE
    WHEN entry_row.status = 'cancelled' THEN 'cancelled'
    WHEN COALESCE(settlement_totals.settled_amount, 0::numeric) >= entry_row.amount THEN 'settled'
    WHEN COALESCE(settlement_totals.settled_amount, 0::numeric) > 0 THEN 'partial'
    WHEN entry_row.due_date < CURRENT_DATE THEN 'overdue'
    ELSE 'pending'
  END AS settlement_status
FROM public.financial_entries entry_row
LEFT JOIN public.profiles profile_row ON profile_row.id = entry_row.client_id
LEFT JOIN LATERAL (
  SELECT
    COALESCE(SUM(
      CASE
        WHEN settlement_row.kind = 'payment' THEN settlement_row.amount
        ELSE -settlement_row.amount
      END
    ), 0::numeric) AS settled_amount,
    MAX(settlement_row.settled_on) AS settled_at
  FROM public.financial_settlements settlement_row
  WHERE settlement_row.entry_id = entry_row.id
) settlement_totals ON true;

REVOKE ALL ON TABLE public.financial_entries_enriched FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.financial_entries_enriched TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.financial_require_admin()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
BEGIN
  IF actor IS NULL OR NOT public.has_role(actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;
  RETURN actor;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.financial_rule_applies(
  starts_on date,
  frequency text,
  competence date
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT competence >= date_trunc('month', starts_on)::date
    AND MOD(
      (
        EXTRACT(YEAR FROM age(competence, date_trunc('month', starts_on)::date))::integer * 12
        + EXTRACT(MONTH FROM age(competence, date_trunc('month', starts_on)::date))::integer
      ),
      CASE frequency
        WHEN 'monthly' THEN 1
        WHEN 'bimonthly' THEN 2
        WHEN 'quarterly' THEN 3
        WHEN 'semiannual' THEN 6
        WHEN 'annual' THEN 12
        ELSE 1
      END
    ) = 0
$$;

REVOKE ALL ON FUNCTION app_private.financial_require_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.financial_rule_applies(date, text, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.financial_gross_up(
  p_operational_amount numeric,
  p_tax_rate numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_operational_amount IS NULL OR p_operational_amount < 0 THEN NULL
    WHEN p_tax_rate IS NULL THEN round(p_operational_amount, 2)
    WHEN p_tax_rate < 0 OR p_tax_rate >= 1 THEN NULL
    ELSE round(p_operational_amount / (1 - p_tax_rate), 2)
  END
$$;

CREATE OR REPLACE FUNCTION public.financial_upsert_plan(
  p_plan_id uuid,
  p_name text,
  p_code text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_is_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := app_private.financial_require_admin();
  plan_row public.financial_plans%ROWTYPE;
BEGIN
  IF NULLIF(btrim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'plan name is required' USING ERRCODE = '22023';
  END IF;

  IF p_plan_id IS NULL THEN
    INSERT INTO public.financial_plans (name, code, description, is_active, created_by)
    VALUES (btrim(p_name), NULLIF(btrim(p_code), ''), NULLIF(btrim(p_description), ''), p_is_active, actor)
    RETURNING * INTO plan_row;
  ELSE
    UPDATE public.financial_plans
    SET name = btrim(p_name),
        code = NULLIF(btrim(p_code), ''),
        description = NULLIF(btrim(p_description), ''),
        is_active = p_is_active,
        archived_at = CASE WHEN p_is_active THEN NULL ELSE COALESCE(archived_at, now()) END
    WHERE id = p_plan_id
    RETURNING * INTO plan_row;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'financial plan not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN to_jsonb(plan_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.financial_archive_plan(p_plan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := app_private.financial_require_admin();
  plan_row public.financial_plans%ROWTYPE;
BEGIN
  UPDATE public.financial_plans
  SET is_active = false, archived_at = COALESCE(archived_at, now())
  WHERE id = p_plan_id
  RETURNING * INTO plan_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'financial plan not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN to_jsonb(plan_row) || jsonb_build_object('archived_by', actor);
END;
$$;

CREATE OR REPLACE FUNCTION public.financial_create_plan_version(
  p_plan_id uuid,
  p_amount numeric,
  p_effective_from date,
  p_description text DEFAULT NULL,
  p_tax_rate numeric DEFAULT NULL,
  p_direct_cost numeric DEFAULT 275,
  p_direct_cost_estimated boolean DEFAULT true,
  p_billing_period text DEFAULT 'monthly',
  p_setup_fee numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := app_private.financial_require_admin();
  next_version integer;
  final_value numeric(14,2);
  version_row public.financial_plan_versions%ROWTYPE;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 OR p_effective_from IS NULL THEN
    RAISE EXCEPTION 'positive amount and effective date are required' USING ERRCODE = '22023';
  END IF;
  IF p_effective_from <> date_trunc('month', p_effective_from)::date
     OR p_effective_from < date_trunc('month', CURRENT_DATE)::date THEN
    RAISE EXCEPTION 'plan changes must start on the first day of a current or future competence'
      USING ERRCODE = '22023';
  END IF;
  IF p_tax_rate IS NOT NULL AND (p_tax_rate < 0 OR p_tax_rate >= 1) THEN
    RAISE EXCEPTION 'tax rate must be between 0 and 1' USING ERRCODE = '22023';
  END IF;
  IF p_billing_period NOT IN ('monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual') THEN
    RAISE EXCEPTION 'unsupported billing period' USING ERRCODE = '22023';
  END IF;

  PERFORM app_private.financial_lock_open_period(p_effective_from);

  PERFORM 1 FROM public.financial_plans WHERE id = p_plan_id AND is_active FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active financial plan not found' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.financial_plan_versions
    WHERE plan_id = p_plan_id AND valid_from >= p_effective_from
  ) THEN
    RAISE EXCEPTION 'effective date must be after every existing version' USING ERRCODE = '22023';
  END IF;

  UPDATE public.financial_plan_versions
  SET valid_to = p_effective_from - 1
  WHERE plan_id = p_plan_id AND valid_to IS NULL;

  SELECT COALESCE(MAX(version), 0) + 1
  INTO next_version
  FROM public.financial_plan_versions
  WHERE plan_id = p_plan_id;

  final_value := CASE
    WHEN p_tax_rate IS NULL THEN round(p_amount, 2)
    ELSE public.financial_gross_up(p_amount, p_tax_rate)
  END;

  INSERT INTO public.financial_plan_versions (
    plan_id, version, operational_amount, amount_kind, tax_rate, final_amount,
    direct_cost_amount, direct_cost_estimated, billing_period, setup_fee,
    valid_from, description, created_by
  ) VALUES (
    p_plan_id, next_version, round(p_amount, 2),
    CASE WHEN p_tax_rate IS NULL THEN 'needs_review' ELSE 'operational' END,
    p_tax_rate, final_value, round(COALESCE(p_direct_cost, 275), 2),
    COALESCE(p_direct_cost_estimated, true), p_billing_period,
    round(COALESCE(p_setup_fee, 0), 2), p_effective_from,
    NULLIF(btrim(p_description), ''), actor
  )
  RETURNING * INTO version_row;

  RETURN to_jsonb(version_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.financial_upsert_recurring_rule(
  p_rule_id uuid,
  p_name text,
  p_description text DEFAULT NULL,
  p_direction text DEFAULT 'expense',
  p_category text DEFAULT NULL,
  p_amount numeric DEFAULT NULL,
  p_frequency text DEFAULT 'monthly',
  p_due_day integer DEFAULT 10,
  p_starts_on date DEFAULT CURRENT_DATE,
  p_ends_on date DEFAULT NULL,
  p_brand text DEFAULT NULL,
  p_is_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := app_private.financial_require_admin();
  rule_row public.financial_recurring_rules%ROWTYPE;
  derived_kind text;
BEGIN
  IF NULLIF(btrim(p_name), '') IS NULL OR p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'rule name and positive amount are required' USING ERRCODE = '22023';
  END IF;
  IF p_direction NOT IN ('income', 'expense')
     OR p_frequency NOT IN ('monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual')
     OR COALESCE(p_due_day, 10) NOT BETWEEN 1 AND 28 THEN
    RAISE EXCEPTION 'invalid recurring rule parameters' USING ERRCODE = '22023';
  END IF;
  derived_kind := CASE
    WHEN p_category = 'pro_labore' THEN 'pro_labore'
    WHEN p_direction = 'income' THEN 'recurring'
    ELSE 'fixed_cost'
  END;

  IF p_rule_id IS NULL THEN
    INSERT INTO public.financial_recurring_rules (
      name, description, direction, kind, category, brand,
      operational_amount, amount, frequency, due_day, starts_on, ends_on,
      is_active, created_by
    ) VALUES (
      btrim(p_name), NULLIF(btrim(p_description), ''), p_direction, derived_kind,
      NULLIF(btrim(p_category), ''), NULLIF(btrim(p_brand), ''),
      CASE WHEN p_direction = 'income' THEN round(p_amount, 2) ELSE 0 END,
      round(p_amount, 2), p_frequency, COALESCE(p_due_day, 10),
      COALESCE(p_starts_on, CURRENT_DATE), p_ends_on, p_is_active, actor
    ) RETURNING * INTO rule_row;
  ELSE
    UPDATE public.financial_recurring_rules
    SET name = btrim(p_name),
        description = NULLIF(btrim(p_description), ''),
        direction = p_direction,
        kind = derived_kind,
        category = NULLIF(btrim(p_category), ''),
        brand = NULLIF(btrim(p_brand), ''),
        operational_amount = CASE WHEN p_direction = 'income' THEN round(p_amount, 2) ELSE 0 END,
        amount = round(p_amount, 2),
        frequency = p_frequency,
        due_day = COALESCE(p_due_day, 10),
        starts_on = COALESCE(p_starts_on, starts_on),
        ends_on = p_ends_on,
        is_active = p_is_active
    WHERE id = p_rule_id
    RETURNING * INTO rule_row;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'recurring rule not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN to_jsonb(rule_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.financial_archive_recurring_rule(p_rule_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := app_private.financial_require_admin();
  rule_row public.financial_recurring_rules%ROWTYPE;
BEGIN
  UPDATE public.financial_recurring_rules
  SET is_active = false,
      ends_on = COALESCE(ends_on, GREATEST(starts_on, CURRENT_DATE))
  WHERE id = p_rule_id
  RETURNING * INTO rule_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'recurring rule not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN to_jsonb(rule_row) || jsonb_build_object('archived_by', actor);
END;
$$;

CREATE OR REPLACE FUNCTION public.financial_update_settings(
  p_currency text,
  p_opening_balance numeric,
  p_reserve_target numeric,
  p_default_due_day integer,
  p_forecast_months integer,
  p_monthly_goal numeric DEFAULT NULL,
  p_growth_retention_rate numeric DEFAULT NULL,
  p_minimum_reserve_months numeric DEFAULT NULL,
  p_desired_minimum_margin numeric DEFAULT NULL,
  p_current_pro_labore numeric DEFAULT NULL,
  p_target_pro_labore numeric DEFAULT NULL,
  p_default_direct_cost numeric DEFAULT NULL,
  p_allocation_method text DEFAULT NULL,
  p_include_pro_labore_in_allocation boolean DEFAULT NULL,
  p_tools_systems_cost numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := app_private.financial_require_admin();
  settings_row public.financial_settings%ROWTYPE;
BEGIN
  IF p_currency <> 'BRL' OR p_default_due_day NOT BETWEEN 1 AND 28
     OR p_forecast_months NOT BETWEEN 1 AND 24
     OR COALESCE(p_current_pro_labore, 0) < 0
     OR COALESCE(p_tools_systems_cost, 0) < 0 THEN
    RAISE EXCEPTION 'invalid financial settings' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.financial_settings (
    settings_key, currency, opening_balance, reserve_target, default_due_day,
    forecast_months, monthly_goal, growth_retention_rate,
    minimum_reserve_months, desired_minimum_margin, current_pro_labore,
    target_pro_labore, tools_systems_cost, default_direct_cost, allocation_method,
    include_pro_labore_in_allocation, updated_by
  ) VALUES (
    'default', p_currency, p_opening_balance, p_reserve_target, p_default_due_day,
    p_forecast_months, p_monthly_goal, p_growth_retention_rate,
    p_minimum_reserve_months, p_desired_minimum_margin,
    COALESCE(p_current_pro_labore, 3000), COALESCE(p_target_pro_labore, 10000),
    COALESCE(p_tools_systems_cost, 2500),
    COALESCE(p_default_direct_cost, 275), COALESCE(p_allocation_method, 'equal'),
    COALESCE(p_include_pro_labore_in_allocation, false), actor
  )
  ON CONFLICT (settings_key) DO UPDATE SET
    currency = EXCLUDED.currency,
    opening_balance = EXCLUDED.opening_balance,
    reserve_target = EXCLUDED.reserve_target,
    default_due_day = EXCLUDED.default_due_day,
    forecast_months = EXCLUDED.forecast_months,
    monthly_goal = EXCLUDED.monthly_goal,
    growth_retention_rate = EXCLUDED.growth_retention_rate,
    minimum_reserve_months = EXCLUDED.minimum_reserve_months,
    desired_minimum_margin = EXCLUDED.desired_minimum_margin,
    current_pro_labore = COALESCE(p_current_pro_labore, public.financial_settings.current_pro_labore),
    target_pro_labore = COALESCE(p_target_pro_labore, public.financial_settings.target_pro_labore),
    tools_systems_cost = COALESCE(p_tools_systems_cost, public.financial_settings.tools_systems_cost),
    default_direct_cost = COALESCE(p_default_direct_cost, public.financial_settings.default_direct_cost),
    allocation_method = COALESCE(p_allocation_method, public.financial_settings.allocation_method),
    include_pro_labore_in_allocation = COALESCE(
      p_include_pro_labore_in_allocation,
      public.financial_settings.include_pro_labore_in_allocation
    ),
    updated_by = actor
  RETURNING * INTO settings_row;
  RETURN to_jsonb(settings_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.financial_assign_client_plan(
  p_client_id uuid,
  p_plan_version_id uuid,
  p_effective_from date,
  p_pricing_mode text DEFAULT 'linked',
  p_operational_amount numeric DEFAULT NULL,
  p_tax_rate numeric DEFAULT NULL,
  p_direct_cost numeric DEFAULT NULL,
  p_due_day integer DEFAULT NULL,
  p_payment_method text DEFAULT NULL,
  p_justification text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := app_private.financial_require_admin();
  version_row public.financial_plan_versions%ROWTYPE;
  term_row public.financial_client_terms%ROWTYPE;
  chosen_operational numeric(14,2);
  chosen_tax numeric(7,6);
  chosen_final numeric(14,2);
  chosen_direct numeric(14,2);
  needs_review boolean;
BEGIN
  IF p_effective_from IS NULL
     OR p_effective_from <> date_trunc('month', p_effective_from)::date
     OR p_effective_from < date_trunc('month', CURRENT_DATE)::date THEN
    RAISE EXCEPTION 'client plan changes must start on the first day of a current or future competence'
      USING ERRCODE = '22023';
  END IF;
  IF p_pricing_mode NOT IN ('linked', 'custom') THEN
    RAISE EXCEPTION 'invalid pricing mode' USING ERRCODE = '22023';
  END IF;
  IF p_pricing_mode = 'custom' AND NULLIF(btrim(p_justification), '') IS NULL THEN
    RAISE EXCEPTION 'custom pricing requires a justification' USING ERRCODE = '22023';
  END IF;
  IF p_due_day IS NOT NULL AND p_due_day NOT BETWEEN 1 AND 28 THEN
    RAISE EXCEPTION 'due day must be between 1 and 28' USING ERRCODE = '22023';
  END IF;

  PERFORM app_private.financial_lock_open_period(p_effective_from);

  PERFORM 1 FROM public.profiles WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'client not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT version_candidate.* INTO version_row
  FROM public.financial_plan_versions version_candidate
  JOIN public.financial_plans plan_row ON plan_row.id = version_candidate.plan_id
  WHERE version_candidate.id = p_plan_version_id
    AND version_candidate.is_active
    AND plan_row.is_active
    AND version_candidate.valid_from <= p_effective_from
    AND (version_candidate.valid_to IS NULL OR version_candidate.valid_to >= p_effective_from)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active plan version is not valid for the selected competence'
      USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.financial_entries existing_entry
    WHERE existing_entry.client_id = p_client_id
      AND existing_entry.competence = p_effective_from
      AND existing_entry.term_id IS NOT NULL
      AND existing_entry.kind = 'recurring'
      AND existing_entry.status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'client competence is already materialized; schedule the plan change for a future competence'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.financial_client_terms existing_term
    WHERE existing_term.client_id = p_client_id
      AND existing_term.ends_on IS NULL
      AND existing_term.status IN ('draft', 'active', 'paused')
      AND existing_term.starts_on >= p_effective_from
  ) THEN
    RAISE EXCEPTION 'client plan change must start after the latest scheduled competence'
      USING ERRCODE = '22023';
  END IF;

  chosen_operational := CASE
    WHEN p_pricing_mode = 'custom' THEN COALESCE(p_operational_amount, version_row.operational_amount)
    ELSE version_row.operational_amount
  END;
  chosen_tax := CASE
    WHEN p_pricing_mode = 'custom' THEN p_tax_rate
    ELSE version_row.tax_rate
  END;
  chosen_direct := CASE
    WHEN p_pricing_mode = 'custom' THEN COALESCE(p_direct_cost, version_row.direct_cost_amount)
    ELSE version_row.direct_cost_amount
  END;
  IF chosen_operational <= 0 OR chosen_direct < 0
     OR (chosen_tax IS NOT NULL AND (chosen_tax < 0 OR chosen_tax >= 1)) THEN
    RAISE EXCEPTION 'invalid client pricing values' USING ERRCODE = '22023';
  END IF;
  needs_review := chosen_tax IS NULL OR version_row.amount_kind = 'needs_review';
  chosen_final := CASE
    WHEN chosen_tax IS NULL THEN round(chosen_operational, 2)
    ELSE public.financial_gross_up(chosen_operational, chosen_tax)
  END;

  UPDATE public.financial_client_terms
  SET ends_on = p_effective_from - 1,
      status = CASE
        WHEN p_effective_from <= CURRENT_DATE THEN 'ended'
        ELSE status
      END
  WHERE client_id = p_client_id
    AND ends_on IS NULL
    AND status IN ('draft', 'active', 'paused');

  INSERT INTO public.financial_client_terms (
    client_id, plan_version_id, pricing_mode, custom_justification,
    operational_amount, amount_kind, tax_rate, final_amount,
    direct_cost_amount, direct_cost_estimated, due_day, billing_period,
    payment_method, contract_started_on, starts_on, status,
    review_required, created_by
  ) VALUES (
    p_client_id, p_plan_version_id, p_pricing_mode,
    CASE WHEN p_pricing_mode = 'custom' THEN btrim(p_justification) ELSE NULL END,
    round(chosen_operational, 2),
    CASE WHEN needs_review THEN 'needs_review' ELSE 'operational' END,
    chosen_tax, chosen_final, round(chosen_direct, 2),
    CASE
      WHEN p_pricing_mode = 'custom' AND p_direct_cost IS NOT NULL THEN false
      ELSE version_row.direct_cost_estimated
    END,
    COALESCE(p_due_day, 10), version_row.billing_period,
    NULLIF(btrim(p_payment_method), ''), p_effective_from, p_effective_from,
    CASE WHEN needs_review THEN 'draft' ELSE 'active' END,
    needs_review, actor
  )
  RETURNING * INTO term_row;

  RETURN to_jsonb(term_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.financial_generate_competence(p_competence date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := app_private.financial_require_admin();
  target_competence date := date_trunc('month', p_competence)::date;
  term_count integer := 0;
  setup_count integer := 0;
  rule_count integer := 0;
BEGIN
  IF p_competence IS NULL OR target_competence < date_trunc('month', CURRENT_DATE)::date THEN
    RAISE EXCEPTION 'competence generation is allowed only for current or future periods'
      USING ERRCODE = '22023';
  END IF;

  PERFORM app_private.financial_lock_open_period(target_competence);

  INSERT INTO public.financial_entries (
    direction, kind, client_id, project_id, term_id, plan_version_id,
    competence, due_date, operational_amount, tax_rate, tax_reserve,
    amount, direct_cost_amount, direct_cost_estimated, status,
    description, idempotency_key, created_by
  )
  SELECT
    'income', 'recurring', term_row.client_id, term_row.project_id,
    term_row.id, term_row.plan_version_id, target_competence,
    target_competence + (term_row.due_day - 1),
    term_row.operational_amount, term_row.tax_rate,
    GREATEST(term_row.final_amount - term_row.operational_amount, 0),
    term_row.final_amount, term_row.direct_cost_amount,
    term_row.direct_cost_estimated, 'open',
    'Mensalidade - ' || COALESCE(profile_row.company_name, profile_row.full_name, 'Cliente'),
    'term:' || term_row.id::text || ':' || to_char(target_competence, 'YYYY-MM'),
    actor
  FROM public.financial_client_terms term_row
  LEFT JOIN public.profiles profile_row ON profile_row.id = term_row.client_id
  WHERE term_row.status = 'active'
    AND NOT term_row.review_required
    AND term_row.final_amount > 0
    AND term_row.starts_on <= (target_competence + INTERVAL '1 month - 1 day')::date
    AND (term_row.ends_on IS NULL OR term_row.ends_on >= target_competence)
    AND app_private.financial_rule_applies(term_row.starts_on, term_row.billing_period, target_competence)
    -- A future amendment can coexist with the current term until its start
    -- date. For a competence where both ranges touch, only the latest active
    -- term is allowed to create the monthly obligation.
    AND NOT EXISTS (
      SELECT 1
      FROM public.financial_client_terms newer_term
      WHERE newer_term.client_id = term_row.client_id
        AND newer_term.id <> term_row.id
        AND newer_term.status = 'active'
        AND NOT newer_term.review_required
        AND newer_term.starts_on > term_row.starts_on
        AND newer_term.starts_on <= (target_competence + INTERVAL '1 month - 1 day')::date
        AND (newer_term.ends_on IS NULL OR newer_term.ends_on >= target_competence)
    )
  -- No target is intentional: both the request key and the client+competence
  -- invariant prevent a plan amendment from creating a second monthly charge.
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS term_count = ROW_COUNT;

  INSERT INTO public.financial_entries (
    direction, kind, client_id, project_id, term_id, plan_version_id,
    competence, due_date, operational_amount, tax_rate, tax_reserve,
    amount, direct_cost_amount, direct_cost_estimated, status,
    description, idempotency_key, created_by
  )
  SELECT
    'income', 'one_off', term_row.client_id, term_row.project_id,
    term_row.id, term_row.plan_version_id, target_competence,
    target_competence + (term_row.due_day - 1),
    version_row.setup_fee, term_row.tax_rate,
    GREATEST(public.financial_gross_up(version_row.setup_fee, term_row.tax_rate)
      - version_row.setup_fee, 0),
    public.financial_gross_up(version_row.setup_fee, term_row.tax_rate),
    0, false, 'open',
    'Setup - ' || COALESCE(profile_row.company_name, profile_row.full_name, 'Cliente'),
    'term-setup:' || term_row.id::text,
    actor
  FROM public.financial_client_terms term_row
  JOIN public.financial_plan_versions version_row ON version_row.id = term_row.plan_version_id
  LEFT JOIN public.profiles profile_row ON profile_row.id = term_row.client_id
  WHERE term_row.status = 'active'
    AND NOT term_row.review_required
    AND version_row.setup_fee > 0
    AND date_trunc('month', term_row.starts_on)::date = target_competence
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS setup_count = ROW_COUNT;

  INSERT INTO public.financial_entries (
    direction, kind, client_id, term_id, recurring_rule_id, brand, category,
    competence, due_date, operational_amount, tax_rate, tax_reserve,
    amount, direct_cost_amount, direct_cost_estimated, status,
    description, idempotency_key, created_by
  )
  SELECT
    rule_row.direction, rule_row.kind, rule_row.client_id, rule_row.term_id,
    rule_row.id, rule_row.brand, rule_row.category, target_competence,
    target_competence + (rule_row.due_day - 1),
    rule_row.operational_amount, rule_row.tax_rate,
    CASE WHEN rule_row.direction = 'income'
      THEN GREATEST(rule_row.amount - rule_row.operational_amount, 0)
      ELSE 0 END,
    rule_row.amount, rule_row.direct_cost_amount,
    rule_row.direct_cost_estimated, 'open', rule_row.name,
    'rule:' || rule_row.id::text || ':' || to_char(target_competence, 'YYYY-MM'),
    actor
  FROM public.financial_recurring_rules rule_row
  WHERE rule_row.is_active
    AND rule_row.starts_on <= (target_competence + INTERVAL '1 month - 1 day')::date
    AND (rule_row.ends_on IS NULL OR rule_row.ends_on >= target_competence)
    AND app_private.financial_rule_applies(rule_row.starts_on, rule_row.frequency, target_competence)
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS rule_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'competence', target_competence,
    'generated_count', term_count + setup_count + rule_count,
    'term_entries', term_count,
    'setup_entries', setup_count,
    'rule_entries', rule_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.financial_record_settlement(
  p_entry_id uuid,
  p_amount numeric,
  p_settled_on date,
  p_method text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := app_private.financial_require_admin();
  entry_row public.financial_entries%ROWTYPE;
  settlement_row public.financial_settlements%ROWTYPE;
  net_settled numeric(14,2);
  normalized_key text := NULLIF(btrim(p_idempotency_key), '');
  normalized_method text := NULLIF(btrim(p_method), '');
  normalized_notes text := NULLIF(btrim(p_notes), '');
  rounded_amount numeric(14,2) := round(p_amount, 2);
  settlement_competence date := date_trunc('month', p_settled_on)::date;
BEGIN
  IF p_amount IS NULL OR rounded_amount <= 0 OR p_settled_on IS NULL
     OR normalized_key IS NULL THEN
    RAISE EXCEPTION 'amount, settlement date and idempotency key are required'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize retries by business key before looking for an existing fact.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(normalized_key, 0)
  );

  SELECT * INTO settlement_row
  FROM public.financial_settlements
  WHERE idempotency_key = normalized_key;
  IF FOUND THEN
    IF settlement_row.entry_id IS DISTINCT FROM p_entry_id
       OR settlement_row.kind <> 'payment'
       OR settlement_row.amount IS DISTINCT FROM rounded_amount
       OR settlement_row.settled_on IS DISTINCT FROM p_settled_on
       OR settlement_row.method IS DISTINCT FROM normalized_method
       OR settlement_row.notes IS DISTINCT FROM normalized_notes THEN
      RAISE EXCEPTION 'idempotency key was already used with a different settlement payload'
        USING ERRCODE = '22023';
    END IF;
    RETURN to_jsonb(settlement_row) || jsonb_build_object('idempotent_replay', true);
  END IF;

  SELECT * INTO entry_row
  FROM public.financial_entries
  WHERE id = p_entry_id
  FOR UPDATE;
  IF NOT FOUND OR entry_row.status <> 'open' THEN
    RAISE EXCEPTION 'open financial entry not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM app_private.financial_lock_open_period(settlement_competence);

  SELECT COALESCE(SUM(CASE WHEN kind = 'payment' THEN amount ELSE -amount END), 0)
  INTO net_settled
  FROM public.financial_settlements
  WHERE entry_id = p_entry_id;

  IF round(net_settled + rounded_amount, 2) > entry_row.amount THEN
    RAISE EXCEPTION 'settlement exceeds the outstanding balance' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.financial_settlements (
    entry_id, kind, amount, tax_reserve_amount, settled_on,
    method, notes, idempotency_key, created_by
  ) VALUES (
    p_entry_id, 'payment', rounded_amount,
    CASE WHEN entry_row.direction = 'income' AND entry_row.amount > 0
      THEN round(entry_row.tax_reserve * rounded_amount / entry_row.amount, 2)
      ELSE 0 END,
    p_settled_on, normalized_method, normalized_notes, normalized_key, actor
  ) RETURNING * INTO settlement_row;

  RETURN to_jsonb(settlement_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.financial_reverse_settlement(
  p_settlement_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := app_private.financial_require_admin();
  original_row public.financial_settlements%ROWTYPE;
  reversal_row public.financial_settlements%ROWTYPE;
BEGIN
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'reversal reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO original_row
  FROM public.financial_settlements
  WHERE id = p_settlement_id AND kind = 'payment'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment settlement not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO reversal_row
  FROM public.financial_settlements
  WHERE reversal_of_id = p_settlement_id;
  IF FOUND THEN
    RETURN to_jsonb(reversal_row) || jsonb_build_object('idempotent_replay', true);
  END IF;

  INSERT INTO public.financial_settlements (
    entry_id, kind, amount, tax_reserve_amount, settled_on,
    notes, reversal_of_id, idempotency_key, created_by
  ) VALUES (
    original_row.entry_id, 'reversal', original_row.amount,
    original_row.tax_reserve_amount, CURRENT_DATE, btrim(p_reason),
    original_row.id, 'reverse:' || original_row.id::text, actor
  ) RETURNING * INTO reversal_row;

  RETURN to_jsonb(reversal_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.financial_cancel_entry(
  p_entry_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := app_private.financial_require_admin();
  entry_row public.financial_entries%ROWTYPE;
  net_settled numeric(14,2);
BEGIN
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'cancellation reason is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO entry_row FROM public.financial_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND OR entry_row.status <> 'open' THEN
    RAISE EXCEPTION 'open financial entry not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(SUM(CASE WHEN kind = 'payment' THEN amount ELSE -amount END), 0)
  INTO net_settled FROM public.financial_settlements WHERE entry_id = p_entry_id;
  IF net_settled <> 0 THEN
    RAISE EXCEPTION 'reverse every settlement before cancelling the entry' USING ERRCODE = '55000';
  END IF;
  UPDATE public.financial_entries
  SET status = 'cancelled', cancelled_at = now(), cancelled_by = actor,
      cancellation_reason = btrim(p_reason)
  WHERE id = p_entry_id
  RETURNING * INTO entry_row;
  RETURN to_jsonb(entry_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.financial_close_period(
  p_competence date,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := app_private.financial_require_admin();
  target_competence date := date_trunc('month', p_competence)::date;
  closure_row public.financial_period_closures%ROWTYPE;
BEGIN
  IF p_competence IS NULL OR NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'competence and close reason are required' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.financial_period_closures (competence, period_status)
  VALUES (target_competence, 'open')
  ON CONFLICT (competence) DO NOTHING;
  PERFORM 1 FROM public.financial_period_closures
  WHERE competence = target_competence FOR UPDATE;
  UPDATE public.financial_period_closures
  SET period_status = 'closed', closed_at = now(), closed_by = actor,
      close_reason = btrim(p_reason)
  WHERE competence = target_competence
  RETURNING * INTO closure_row;
  RETURN to_jsonb(closure_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.financial_reopen_period(
  p_competence date,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := app_private.financial_require_admin();
  target_competence date := date_trunc('month', p_competence)::date;
  closure_row public.financial_period_closures%ROWTYPE;
BEGIN
  IF p_competence IS NULL OR NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'competence and reopen reason are required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO closure_row
  FROM public.financial_period_closures
  WHERE competence = target_competence
  FOR UPDATE;
  IF NOT FOUND OR closure_row.period_status <> 'closed' THEN
    RAISE EXCEPTION 'closed financial period not found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.financial_period_closures
  SET period_status = 'open', reopened_at = now(), reopened_by = actor,
      reopen_reason = btrim(p_reason)
  WHERE competence = target_competence
  RETURNING * INTO closure_row;
  RETURN to_jsonb(closure_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.financial_overview_v2(
  p_mode text,
  p_competence date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH parameters AS (
    SELECT date_trunc('month', p_competence)::date AS competence
  ),
  selected_entries AS (
    SELECT entry_row.*
    FROM public.financial_entries entry_row, parameters
    WHERE entry_row.competence = parameters.competence
      AND entry_row.status <> 'cancelled'
  ),
  selected_balances AS (
    SELECT
      entry_row.id,
      entry_row.direction,
      entry_row.kind,
      entry_row.amount,
      entry_row.operational_amount,
      entry_row.tax_reserve,
      entry_row.direct_cost_amount,
      entry_row.due_date,
      COALESCE(SUM(
        CASE WHEN settlement_row.kind = 'payment'
          THEN settlement_row.amount ELSE -settlement_row.amount END
      ), 0::numeric) AS settled_amount,
      COALESCE(SUM(
        CASE WHEN settlement_row.kind = 'payment'
          THEN settlement_row.tax_reserve_amount ELSE -settlement_row.tax_reserve_amount END
      ), 0::numeric) AS settled_tax_reserve
    FROM selected_entries entry_row
    LEFT JOIN public.financial_settlements settlement_row
      ON settlement_row.entry_id = entry_row.id
    GROUP BY entry_row.id, entry_row.direction, entry_row.kind, entry_row.amount,
      entry_row.operational_amount, entry_row.tax_reserve,
      entry_row.direct_cost_amount, entry_row.due_date
  ),
  accrual AS (
    SELECT
      COALESCE(SUM(operational_amount) FILTER (WHERE direction = 'income'), 0) AS operational_income,
      COALESCE(SUM(amount) FILTER (WHERE direction = 'income'), 0) AS gross_income,
      COALESCE(SUM(tax_reserve) FILTER (WHERE direction = 'income'), 0) AS tax_reserve,
      COALESCE(SUM(direct_cost_amount) FILTER (WHERE direction = 'income'), 0) AS direct_costs,
      COALESCE(SUM(amount) FILTER (WHERE direction = 'expense'), 0) AS expense_entries,
      COALESCE(SUM(amount) FILTER (WHERE direction = 'expense' AND kind = 'fixed_cost'), 0) AS fixed_costs,
      COALESCE(SUM(amount) FILTER (WHERE direction = 'expense' AND kind = 'pro_labore'), 0) AS pro_labore,
      COALESCE(SUM(amount) FILTER (
        WHERE direction = 'expense' AND kind NOT IN ('fixed_cost', 'pro_labore', 'tax')
      ), 0) AS other_expenses,
      COALESCE(SUM(operational_amount) FILTER (
        WHERE direction = 'income' AND kind = 'recurring'
      ), 0) AS recurring_revenue,
      COALESCE(SUM(GREATEST(amount - settled_amount, 0)) FILTER (WHERE direction = 'income'), 0) AS pending_income,
      COALESCE(SUM(GREATEST(tax_reserve - settled_tax_reserve, 0))
        FILTER (WHERE direction = 'income'), 0) AS pending_tax_reserve,
      COALESCE(SUM(GREATEST(amount - settled_amount, 0)) FILTER (WHERE direction = 'expense'), 0) AS pending_expense,
      COALESCE(SUM(GREATEST(amount - settled_amount, 0)) FILTER (
        WHERE direction = 'income' AND due_date < CURRENT_DATE
      ), 0) AS overdue_income
    FROM selected_balances
  ),
  cash AS (
    SELECT
      COALESCE(SUM(CASE WHEN settlement_row.kind = 'payment'
        THEN settlement_row.amount ELSE -settlement_row.amount END)
        FILTER (WHERE entry_row.direction = 'income'), 0) AS received,
      COALESCE(SUM(CASE WHEN settlement_row.kind = 'payment'
        THEN settlement_row.amount ELSE -settlement_row.amount END)
        FILTER (WHERE entry_row.direction = 'expense'), 0) AS paid,
      COALESCE(SUM(CASE WHEN settlement_row.kind = 'payment'
        THEN settlement_row.tax_reserve_amount ELSE -settlement_row.tax_reserve_amount END)
        FILTER (WHERE entry_row.direction = 'income'), 0) AS received_tax_reserve
    FROM public.financial_settlements settlement_row
    JOIN public.financial_entries entry_row ON entry_row.id = settlement_row.entry_id
    JOIN parameters ON true
    WHERE settlement_row.settled_on >= parameters.competence
      AND settlement_row.settled_on < (parameters.competence + INTERVAL '1 month')::date
  ),
  forecast_months AS (
    SELECT month_value::date AS competence
    FROM pg_catalog.generate_series(
      date_trunc('month', CURRENT_DATE),
      date_trunc('month', CURRENT_DATE + 90),
      INTERVAL '1 month'
    ) month_value
  ),
  materialized_projection_events AS (
    SELECT
      GREATEST(entry_row.due_date, CURRENT_DATE) AS due_date,
      CASE WHEN entry_row.direction = 'income'
        THEN GREATEST(
          entry_row.amount - balance_row.settled_amount
            - GREATEST(entry_row.tax_reserve - balance_row.settled_tax_reserve, 0),
          0
        )
        ELSE -GREATEST(entry_row.amount - balance_row.settled_amount, 0)
      END AS signed_amount
    FROM public.financial_entries entry_row
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(SUM(CASE WHEN settlement_row.kind = 'payment'
          THEN settlement_row.amount ELSE -settlement_row.amount END), 0) AS settled_amount,
        COALESCE(SUM(CASE WHEN settlement_row.kind = 'payment'
          THEN settlement_row.tax_reserve_amount ELSE -settlement_row.tax_reserve_amount END), 0)
          AS settled_tax_reserve
      FROM public.financial_settlements settlement_row
      WHERE settlement_row.entry_id = entry_row.id
    ) balance_row ON true
    WHERE entry_row.status = 'open'
      AND entry_row.due_date <= CURRENT_DATE + 90
  ),
  future_term_candidates AS (
    SELECT DISTINCT ON (term_row.client_id, month_row.competence)
      term_row.id AS term_id,
      term_row.client_id,
      month_row.competence,
      month_row.competence + (term_row.due_day - 1) AS due_date,
      term_row.operational_amount AS signed_amount
    FROM forecast_months month_row
    JOIN public.financial_client_terms term_row
      ON term_row.status = 'active'
     AND NOT term_row.review_required
     AND term_row.final_amount > 0
     AND term_row.client_id IS NOT NULL
     AND term_row.starts_on <= (month_row.competence + INTERVAL '1 month - 1 day')::date
     AND (term_row.ends_on IS NULL OR term_row.ends_on >= month_row.competence)
     AND MOD(
       EXTRACT(YEAR FROM month_row.competence)::integer * 12
         + EXTRACT(MONTH FROM month_row.competence)::integer
         - EXTRACT(YEAR FROM term_row.starts_on)::integer * 12
         - EXTRACT(MONTH FROM term_row.starts_on)::integer,
       CASE term_row.billing_period
         WHEN 'bimonthly' THEN 2
         WHEN 'quarterly' THEN 3
         WHEN 'semiannual' THEN 6
         WHEN 'annual' THEN 12
         ELSE 1
       END
     ) = 0
    ORDER BY term_row.client_id, month_row.competence,
      term_row.starts_on DESC, term_row.created_at DESC, term_row.id DESC
  ),
  future_term_events AS (
    SELECT candidate_row.due_date, candidate_row.signed_amount
    FROM future_term_candidates candidate_row
    WHERE candidate_row.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 90
      AND NOT EXISTS (
        SELECT 1
        FROM public.financial_entries entry_row
        WHERE entry_row.idempotency_key = 'term:' || candidate_row.term_id::text
          || ':' || to_char(candidate_row.competence, 'YYYY-MM')
          OR (
            entry_row.client_id = candidate_row.client_id
            AND entry_row.term_id IS NOT NULL
            AND entry_row.kind = 'recurring'
            AND entry_row.status <> 'cancelled'
            AND entry_row.competence = candidate_row.competence
          )
      )
  ),
  future_setup_events AS (
    SELECT candidate_row.due_date, version_row.setup_fee AS signed_amount
    FROM future_term_candidates candidate_row
    JOIN public.financial_client_terms term_row ON term_row.id = candidate_row.term_id
    JOIN public.financial_plan_versions version_row ON version_row.id = term_row.plan_version_id
    WHERE version_row.setup_fee > 0
      AND date_trunc('month', term_row.starts_on)::date = candidate_row.competence
      AND candidate_row.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 90
      AND NOT EXISTS (
        SELECT 1 FROM public.financial_entries entry_row
        WHERE entry_row.idempotency_key = 'term-setup:' || term_row.id::text
      )
  ),
  future_rule_events AS (
    SELECT
      month_row.competence + (rule_row.due_day - 1) AS due_date,
      CASE WHEN rule_row.direction = 'income'
        THEN CASE WHEN rule_row.operational_amount > 0
          THEN rule_row.operational_amount ELSE rule_row.amount END
        ELSE -rule_row.amount
      END AS signed_amount
    FROM forecast_months month_row
    JOIN public.financial_recurring_rules rule_row
      ON rule_row.is_active
     AND rule_row.starts_on <= (month_row.competence + INTERVAL '1 month - 1 day')::date
     AND (rule_row.ends_on IS NULL OR rule_row.ends_on >= month_row.competence)
     AND MOD(
       EXTRACT(YEAR FROM month_row.competence)::integer * 12
         + EXTRACT(MONTH FROM month_row.competence)::integer
         - EXTRACT(YEAR FROM rule_row.starts_on)::integer * 12
         - EXTRACT(MONTH FROM rule_row.starts_on)::integer,
       CASE rule_row.frequency
         WHEN 'bimonthly' THEN 2
         WHEN 'quarterly' THEN 3
         WHEN 'semiannual' THEN 6
         WHEN 'annual' THEN 12
         ELSE 1
       END
     ) = 0
    WHERE month_row.competence + (rule_row.due_day - 1)
      BETWEEN CURRENT_DATE AND CURRENT_DATE + 90
      AND NOT EXISTS (
        SELECT 1
        FROM public.financial_entries entry_row
        WHERE entry_row.idempotency_key = 'rule:' || rule_row.id::text
          || ':' || to_char(month_row.competence, 'YYYY-MM')
          OR (
            entry_row.recurring_rule_id = rule_row.id
            AND entry_row.status <> 'cancelled'
            AND entry_row.competence = month_row.competence
          )
      )
  ),
  projection_events AS (
    SELECT due_date, signed_amount FROM materialized_projection_events
    UNION ALL
    SELECT due_date, signed_amount FROM future_term_events
    UNION ALL
    SELECT due_date, signed_amount FROM future_setup_events
    UNION ALL
    SELECT due_date, signed_amount FROM future_rule_events
  ),
  projection AS (
    SELECT
      COALESCE(SUM(signed_amount) FILTER (WHERE due_date <= CURRENT_DATE + 30), 0) AS days_30,
      COALESCE(SUM(signed_amount) FILTER (WHERE due_date <= CURRENT_DATE + 60), 0) AS days_60,
      COALESCE(SUM(signed_amount) FILTER (WHERE due_date <= CURRENT_DATE + 90), 0) AS days_90
    FROM projection_events
  ),
  settings AS (
    SELECT settings_row.* FROM public.financial_settings settings_row
    WHERE settings_row.settings_key = 'default' LIMIT 1
  ),
  client_count AS (
    SELECT COUNT(DISTINCT client_id)::integer AS total
    FROM selected_entries WHERE client_id IS NOT NULL
  )
  SELECT jsonb_build_object(
    'competence', parameters.competence,
    'mode', p_mode,
    'opening_balance', COALESCE(settings.opening_balance, 0),
    'income', CASE
      WHEN p_mode = 'cash' THEN cash.received - cash.received_tax_reserve
      WHEN p_mode = 'forecast' THEN accrual.pending_income - accrual.pending_tax_reserve
      ELSE accrual.operational_income END,
    'expense', CASE
      WHEN p_mode = 'cash' THEN cash.paid
      WHEN p_mode = 'forecast' THEN accrual.pending_expense + accrual.direct_costs
      ELSE accrual.expense_entries + accrual.direct_costs END,
    'net', CASE
      WHEN p_mode = 'cash' THEN cash.received - cash.received_tax_reserve - cash.paid
      WHEN p_mode = 'forecast' THEN accrual.pending_income - accrual.pending_tax_reserve
        - accrual.pending_expense - accrual.direct_costs
      ELSE accrual.operational_income - accrual.expense_entries - accrual.direct_costs END,
    'settled_income', cash.received,
    'settled_expense', cash.paid,
    'pending_income', accrual.pending_income,
    'pending_expense', accrual.pending_expense,
    'overdue_income', accrual.overdue_income,
    'recurring_revenue', accrual.recurring_revenue,
    'gross_billing', accrual.gross_income,
    'tax_reserve', accrual.tax_reserve,
    'pending_tax_reserve', accrual.pending_tax_reserve,
    'realized_tax_reserve', cash.received_tax_reserve,
    'direct_costs', accrual.direct_costs,
    'fixed_costs', accrual.fixed_costs,
    'pro_labore', accrual.pro_labore,
    'other_expenses', accrual.other_expenses,
    'global_operating_result', accrual.operational_income
      - accrual.direct_costs - accrual.expense_entries,
    'break_even', CASE
      WHEN accrual.operational_income > 0
        AND (1 - accrual.direct_costs / accrual.operational_income) > 0
      THEN round(
        (accrual.fixed_costs + accrual.pro_labore + accrual.other_expenses)
        / (1 - accrual.direct_costs / accrual.operational_income), 2
      ) ELSE NULL END,
    'forecast_30_days', projection.days_30,
    'forecast_60_days', projection.days_60,
    'forecast_90_days', projection.days_90,
    'clients_count', client_count.total,
    'monthly_goal', settings.monthly_goal,
    'current_pro_labore', settings.current_pro_labore,
    'target_pro_labore', settings.target_pro_labore,
    'tools_systems_cost', settings.tools_systems_cost,
    'default_direct_cost', settings.default_direct_cost
  )
  FROM parameters, accrual, cash, projection, settings, client_count
  WHERE p_mode IN ('cash', 'accrual', 'forecast')
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'manager'::public.app_role)
    )
$$;

CREATE OR REPLACE FUNCTION public.financial_cash_flow_v2(
  p_mode text,
  p_competence date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH parameters AS (
    SELECT date_trunc('month', p_competence)::date AS competence
  ),
  cash_items AS (
    SELECT
      settlement_row.settled_on AS movement_date,
      settlement_row.id AS movement_id,
      jsonb_build_object(
        'id', settlement_row.id,
        'settlement_id', settlement_row.id,
        'entry_id', entry_row.id,
        'source_type', 'settlement',
        'competence', entry_row.competence,
        'movement_date', settlement_row.settled_on,
        'settled_on', settlement_row.settled_on,
        'due_date', entry_row.due_date,
        'direction', entry_row.direction,
        'kind', settlement_row.kind,
        'description', entry_row.description,
        'gross_amount', round(
          (CASE WHEN entry_row.direction = 'income' THEN 1 ELSE -1 END)
          * (CASE WHEN settlement_row.kind = 'payment' THEN 1 ELSE -1 END)
          * settlement_row.amount,
          2
        ),
        'tax_reserve_amount', round(
          (CASE WHEN settlement_row.kind = 'payment' THEN 1 ELSE -1 END)
          * settlement_row.tax_reserve_amount,
          2
        ),
        'amount', round(
          (CASE WHEN entry_row.direction = 'income' THEN 1 ELSE -1 END)
          * (CASE WHEN settlement_row.kind = 'payment' THEN 1 ELSE -1 END)
          * CASE WHEN entry_row.direction = 'income'
            THEN settlement_row.amount - settlement_row.tax_reserve_amount
            ELSE settlement_row.amount
          END,
          2
        ),
        'signed_amount', round(
          (CASE WHEN entry_row.direction = 'income' THEN 1 ELSE -1 END)
          * (CASE WHEN settlement_row.kind = 'payment' THEN 1 ELSE -1 END)
          * CASE WHEN entry_row.direction = 'income'
            THEN settlement_row.amount - settlement_row.tax_reserve_amount
            ELSE settlement_row.amount
          END,
          2
        ),
        'method', settlement_row.method,
        'notes', settlement_row.notes,
        'can_settle', false
      ) AS item
    FROM public.financial_settlements settlement_row
    JOIN public.financial_entries entry_row ON entry_row.id = settlement_row.entry_id
    JOIN parameters ON true
    WHERE settlement_row.settled_on >= parameters.competence
      AND settlement_row.settled_on < (parameters.competence + INTERVAL '1 month')::date
  ),
  entry_items AS (
    SELECT
      entry_row.due_date AS movement_date,
      entry_row.id AS movement_id,
      to_jsonb(entry_row) || jsonb_build_object(
        'source_type', 'entry',
        'movement_date', entry_row.due_date,
        'signed_amount', round(
          CASE
            WHEN p_mode = 'forecast' AND entry_row.direction = 'income' THEN GREATEST(
              entry_row.outstanding_amount
                - GREATEST(entry_row.tax_reserve - settlement_totals.settled_tax_reserve, 0),
              0
            )
            WHEN p_mode = 'forecast' THEN -entry_row.outstanding_amount
            WHEN entry_row.direction = 'income' THEN entry_row.operational_amount
            ELSE -entry_row.amount
          END,
          2
        ),
        'can_settle', entry_row.status = 'open' AND entry_row.outstanding_amount > 0
      ) AS item
    FROM public.financial_entries_enriched entry_row
    JOIN parameters ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(
        CASE WHEN settlement_row.kind = 'payment'
          THEN settlement_row.tax_reserve_amount ELSE -settlement_row.tax_reserve_amount END
      ), 0) AS settled_tax_reserve
      FROM public.financial_settlements settlement_row
      WHERE settlement_row.entry_id = entry_row.id
    ) settlement_totals ON true
    WHERE entry_row.competence = parameters.competence
      AND entry_row.status <> 'cancelled'
  ),
  forecast_term_items AS (
    SELECT
      parameters.competence + (term_row.due_day - 1) AS movement_date,
      term_row.id AS movement_id,
      jsonb_build_object(
        'id', 'forecast-term:' || term_row.id::text || ':' || to_char(parameters.competence, 'YYYY-MM'),
        'entry_id', NULL,
        'source_type', 'forecast_term',
        'status', 'scheduled',
        'competence', parameters.competence,
        'movement_date', parameters.competence + (term_row.due_day - 1),
        'due_date', parameters.competence + (term_row.due_day - 1),
        'direction', 'income',
        'kind', 'recurring',
        'client_id', term_row.client_id,
        'company_name', COALESCE(profile_row.company_name, profile_row.full_name),
        'description', 'Mensalidade prevista - '
          || COALESCE(profile_row.company_name, profile_row.full_name, 'Cliente'),
        'operational_amount', term_row.operational_amount,
        'tax_reserve', GREATEST(term_row.final_amount - term_row.operational_amount, 0),
        'amount', term_row.final_amount,
        'outstanding_amount', term_row.final_amount,
        'signed_amount', term_row.operational_amount,
        'can_settle', false
      ) AS item
    FROM public.financial_client_terms term_row
    LEFT JOIN public.profiles profile_row ON profile_row.id = term_row.client_id
    JOIN parameters ON true
    WHERE p_mode = 'forecast'
      AND term_row.status = 'active'
      AND NOT term_row.review_required
      AND term_row.final_amount > 0
      AND term_row.starts_on <= (parameters.competence + INTERVAL '1 month - 1 day')::date
      AND (term_row.ends_on IS NULL OR term_row.ends_on >= parameters.competence)
      AND MOD(
        EXTRACT(YEAR FROM parameters.competence)::integer * 12
          + EXTRACT(MONTH FROM parameters.competence)::integer
          - EXTRACT(YEAR FROM term_row.starts_on)::integer * 12
          - EXTRACT(MONTH FROM term_row.starts_on)::integer,
        CASE term_row.billing_period
          WHEN 'bimonthly' THEN 2
          WHEN 'quarterly' THEN 3
          WHEN 'semiannual' THEN 6
          WHEN 'annual' THEN 12
          ELSE 1
        END
      ) = 0
      AND NOT EXISTS (
        SELECT 1
        FROM public.financial_client_terms newer_term
        WHERE newer_term.client_id = term_row.client_id
          AND newer_term.id <> term_row.id
          AND newer_term.status = 'active'
          AND NOT newer_term.review_required
          AND newer_term.starts_on > term_row.starts_on
          AND newer_term.starts_on <= (parameters.competence + INTERVAL '1 month - 1 day')::date
          AND (newer_term.ends_on IS NULL OR newer_term.ends_on >= parameters.competence)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.financial_entries entry_row
        WHERE entry_row.idempotency_key = 'term:' || term_row.id::text
          || ':' || to_char(parameters.competence, 'YYYY-MM')
          OR (
            entry_row.client_id = term_row.client_id
            AND entry_row.term_id IS NOT NULL
            AND entry_row.kind = 'recurring'
            AND entry_row.status <> 'cancelled'
            AND entry_row.competence = parameters.competence
          )
      )
  ),
  forecast_setup_items AS (
    SELECT
      parameters.competence + (term_row.due_day - 1) AS movement_date,
      term_row.id AS movement_id,
      jsonb_build_object(
        'id', 'forecast-setup:' || term_row.id::text,
        'entry_id', NULL,
        'source_type', 'forecast_setup',
        'status', 'scheduled',
        'competence', parameters.competence,
        'movement_date', parameters.competence + (term_row.due_day - 1),
        'due_date', parameters.competence + (term_row.due_day - 1),
        'direction', 'income',
        'kind', 'one_off',
        'client_id', term_row.client_id,
        'company_name', COALESCE(profile_row.company_name, profile_row.full_name),
        'description', 'Setup previsto - '
          || COALESCE(profile_row.company_name, profile_row.full_name, 'Cliente'),
        'operational_amount', version_row.setup_fee,
        'tax_reserve', GREATEST(
          public.financial_gross_up(version_row.setup_fee, term_row.tax_rate) - version_row.setup_fee,
          0
        ),
        'amount', public.financial_gross_up(version_row.setup_fee, term_row.tax_rate),
        'outstanding_amount', public.financial_gross_up(version_row.setup_fee, term_row.tax_rate),
        'signed_amount', version_row.setup_fee,
        'can_settle', false
      ) AS item
    FROM public.financial_client_terms term_row
    JOIN public.financial_plan_versions version_row ON version_row.id = term_row.plan_version_id
    LEFT JOIN public.profiles profile_row ON profile_row.id = term_row.client_id
    JOIN parameters ON true
    WHERE p_mode = 'forecast'
      AND term_row.status = 'active'
      AND NOT term_row.review_required
      AND version_row.setup_fee > 0
      AND date_trunc('month', term_row.starts_on)::date = parameters.competence
      AND NOT EXISTS (
        SELECT 1 FROM public.financial_entries entry_row
        WHERE entry_row.idempotency_key = 'term-setup:' || term_row.id::text
      )
  ),
  forecast_rule_items AS (
    SELECT
      parameters.competence + (rule_row.due_day - 1) AS movement_date,
      rule_row.id AS movement_id,
      jsonb_build_object(
        'id', 'forecast-rule:' || rule_row.id::text || ':' || to_char(parameters.competence, 'YYYY-MM'),
        'entry_id', NULL,
        'source_type', 'forecast_rule',
        'status', 'scheduled',
        'competence', parameters.competence,
        'movement_date', parameters.competence + (rule_row.due_day - 1),
        'due_date', parameters.competence + (rule_row.due_day - 1),
        'direction', rule_row.direction,
        'kind', rule_row.kind,
        'category', rule_row.category,
        'description', rule_row.name,
        'operational_amount', rule_row.operational_amount,
        'amount', rule_row.amount,
        'outstanding_amount', rule_row.amount,
        'signed_amount', CASE WHEN rule_row.direction = 'income'
          THEN CASE WHEN rule_row.operational_amount > 0
            THEN rule_row.operational_amount ELSE rule_row.amount END
          ELSE -rule_row.amount END,
        'can_settle', false
      ) AS item
    FROM public.financial_recurring_rules rule_row
    JOIN parameters ON true
    WHERE p_mode = 'forecast'
      AND rule_row.is_active
      AND rule_row.starts_on <= (parameters.competence + INTERVAL '1 month - 1 day')::date
      AND (rule_row.ends_on IS NULL OR rule_row.ends_on >= parameters.competence)
      AND MOD(
        EXTRACT(YEAR FROM parameters.competence)::integer * 12
          + EXTRACT(MONTH FROM parameters.competence)::integer
          - EXTRACT(YEAR FROM rule_row.starts_on)::integer * 12
          - EXTRACT(MONTH FROM rule_row.starts_on)::integer,
        CASE rule_row.frequency
          WHEN 'bimonthly' THEN 2
          WHEN 'quarterly' THEN 3
          WHEN 'semiannual' THEN 6
          WHEN 'annual' THEN 12
          ELSE 1
        END
      ) = 0
      AND NOT EXISTS (
        SELECT 1
        FROM public.financial_entries entry_row
        WHERE entry_row.idempotency_key = 'rule:' || rule_row.id::text
          || ':' || to_char(parameters.competence, 'YYYY-MM')
          OR (
            entry_row.recurring_rule_id = rule_row.id
            AND entry_row.status <> 'cancelled'
            AND entry_row.competence = parameters.competence
          )
      )
  ),
  selected_items AS (
    SELECT movement_date, movement_id, item
    FROM cash_items
    WHERE p_mode = 'cash'
    UNION ALL
    SELECT movement_date, movement_id, item
    FROM entry_items
    WHERE p_mode IN ('accrual', 'forecast')
    UNION ALL
    SELECT movement_date, movement_id, item FROM forecast_term_items
    UNION ALL
    SELECT movement_date, movement_id, item FROM forecast_setup_items
    UNION ALL
    SELECT movement_date, movement_id, item FROM forecast_rule_items
  )
  SELECT jsonb_build_object(
    'mode', p_mode,
    'competence', parameters.competence,
    'items', COALESCE(
      jsonb_agg(selected_items.item ORDER BY selected_items.movement_date, selected_items.movement_id)
        FILTER (WHERE selected_items.item IS NOT NULL),
      '[]'::jsonb
    ),
    'count', COUNT(selected_items.item),
    'net_total', COALESCE(SUM((selected_items.item->>'signed_amount')::numeric), 0)
  )
  FROM parameters
  LEFT JOIN selected_items ON true
  WHERE p_mode IN ('cash', 'accrual', 'forecast')
    AND p_competence IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'manager'::public.app_role)
    )
  GROUP BY parameters.competence
$$;

CREATE OR REPLACE FUNCTION public.financial_client_summaries_v2()
RETURNS TABLE (
  client_id uuid,
  client_name text,
  plan_name text,
  pricing_mode text,
  operational_amount numeric,
  final_amount numeric,
  tax_rate numeric,
  tax_reserve numeric,
  direct_cost numeric,
  direct_cost_estimated boolean,
  contribution_margin_percent numeric,
  due_day integer,
  billing_status text,
  plan_amount numeric,
  final_plan_amount numeric,
  open_amount numeric,
  overdue_amount numeric,
  settled_amount numeric,
  next_due_date date,
  status text,
  billing_period text,
  review_required boolean,
  upcoming_plan_name text,
  upcoming_operational_amount numeric,
  upcoming_final_amount numeric,
  upcoming_starts_on date
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    profile_row.id AS client_id,
    COALESCE(profile_row.company_name, profile_row.full_name, 'Cliente') AS client_name,
    plan_row.name AS plan_name,
    term_row.pricing_mode,
    term_row.operational_amount,
    term_row.final_amount,
    term_row.tax_rate,
    GREATEST(term_row.final_amount - term_row.operational_amount, 0) AS tax_reserve,
    term_row.direct_cost_amount AS direct_cost,
    term_row.direct_cost_estimated,
    CASE WHEN term_row.operational_amount > 0 THEN round(
      ((term_row.operational_amount - term_row.direct_cost_amount)
        / term_row.operational_amount) * 100, 2
    ) ELSE NULL END AS contribution_margin_percent,
    term_row.due_day,
    CASE
      WHEN term_row.id IS NULL THEN 'not_configured'
      WHEN term_row.review_required THEN 'review_required'
      WHEN term_row.status = 'paused' THEN 'paused'
      WHEN COALESCE(entry_totals.overdue_amount, 0) > 0 THEN 'overdue'
      WHEN COALESCE(entry_totals.open_amount, 0) > 0 THEN 'pending'
      ELSE 'current'
    END AS billing_status,
    CASE term_row.billing_period
      WHEN 'bimonthly' THEN round(term_row.operational_amount / 2, 2)
      WHEN 'quarterly' THEN round(term_row.operational_amount / 3, 2)
      WHEN 'semiannual' THEN round(term_row.operational_amount / 6, 2)
      WHEN 'annual' THEN round(term_row.operational_amount / 12, 2)
      ELSE term_row.operational_amount
    END AS plan_amount,
    CASE term_row.billing_period
      WHEN 'bimonthly' THEN round(term_row.final_amount / 2, 2)
      WHEN 'quarterly' THEN round(term_row.final_amount / 3, 2)
      WHEN 'semiannual' THEN round(term_row.final_amount / 6, 2)
      WHEN 'annual' THEN round(term_row.final_amount / 12, 2)
      ELSE term_row.final_amount
    END AS final_plan_amount,
    COALESCE(entry_totals.open_amount, 0) AS open_amount,
    COALESCE(entry_totals.overdue_amount, 0) AS overdue_amount,
    COALESCE(entry_totals.settled_amount, 0) AS settled_amount,
    entry_totals.next_due_date,
    COALESCE(term_row.status, 'not_configured') AS status,
    term_row.billing_period,
    COALESCE(term_row.review_required, true) AS review_required,
    upcoming_plan_row.name AS upcoming_plan_name,
    upcoming_term_row.operational_amount AS upcoming_operational_amount,
    upcoming_term_row.final_amount AS upcoming_final_amount,
    upcoming_term_row.starts_on AS upcoming_starts_on
  FROM public.profiles profile_row
  JOIN public.user_roles role_row
    ON role_row.user_id = profile_row.id
   AND role_row.role = 'client'::public.app_role
  LEFT JOIN LATERAL (
    SELECT candidate_term.*
    FROM public.financial_client_terms candidate_term
    WHERE candidate_term.client_id = profile_row.id
      AND candidate_term.starts_on <= CURRENT_DATE
      AND (candidate_term.ends_on IS NULL OR candidate_term.ends_on >= CURRENT_DATE)
      AND candidate_term.status IN ('draft', 'active', 'paused')
    ORDER BY candidate_term.starts_on DESC, candidate_term.created_at DESC
    LIMIT 1
  ) term_row ON true
  LEFT JOIN public.financial_plan_versions version_row ON version_row.id = term_row.plan_version_id
  LEFT JOIN public.financial_plans plan_row ON plan_row.id = version_row.plan_id
  LEFT JOIN LATERAL (
    SELECT candidate_term.*
    FROM public.financial_client_terms candidate_term
    WHERE candidate_term.client_id = profile_row.id
      AND candidate_term.starts_on > CURRENT_DATE
      AND candidate_term.status IN ('draft', 'active', 'paused')
    ORDER BY candidate_term.starts_on, candidate_term.created_at, candidate_term.id
    LIMIT 1
  ) upcoming_term_row ON true
  LEFT JOIN public.financial_plan_versions upcoming_version_row
    ON upcoming_version_row.id = upcoming_term_row.plan_version_id
  LEFT JOIN public.financial_plans upcoming_plan_row
    ON upcoming_plan_row.id = upcoming_version_row.plan_id
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(SUM(entry_row.outstanding_amount), 0) AS open_amount,
      COALESCE(SUM(entry_row.outstanding_amount) FILTER (
        WHERE entry_row.due_date < CURRENT_DATE
          AND entry_row.settlement_status IN ('pending', 'partial', 'overdue')
      ), 0) AS overdue_amount,
      COALESCE(SUM(entry_row.settled_amount), 0) AS settled_amount,
      MIN(entry_row.due_date) FILTER (WHERE entry_row.outstanding_amount > 0) AS next_due_date
    FROM public.financial_entries_enriched entry_row
    WHERE entry_row.client_id = profile_row.id
      AND entry_row.direction = 'income'
      AND entry_row.status <> 'cancelled'
  ) entry_totals ON true
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
$$;

INSERT INTO public.financial_settings (
  settings_key,
  currency,
  timezone,
  current_pro_labore,
  target_pro_labore,
  tools_systems_cost,
  default_direct_cost,
  default_direct_cost_estimated,
  owner_name,
  owner_profit_share
) VALUES (
  'default',
  'BRL',
  'America/Sao_Paulo',
  3000,
  10000,
  2500,
  275,
  true,
  'Almir',
  1
)
ON CONFLICT (settings_key) DO NOTHING;

INSERT INTO public.financial_plans (
  code,
  name,
  description,
  is_active
)
SELECT DISTINCT ON (lower(btrim(profile_row.plan_name)))
  'legacy-' || substr(md5(lower(btrim(profile_row.plan_name))), 1, 16),
  btrim(profile_row.plan_name),
  'Importado do cadastro atual. Preço e natureza do valor exigem revisão.',
  true
FROM public.profiles profile_row
WHERE NULLIF(btrim(profile_row.plan_name), '') IS NOT NULL
ORDER BY lower(btrim(profile_row.plan_name)), profile_row.updated_at DESC
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.financial_plan_versions (
  plan_id,
  version,
  operational_amount,
  amount_kind,
  tax_rate,
  final_amount,
  direct_cost_amount,
  direct_cost_estimated,
  billing_period,
  valid_from,
  description
)
SELECT
  plan_row.id,
  1,
  COALESCE(MIN(profile_row.plan_value) FILTER (WHERE profile_row.plan_value > 0), 0),
  'needs_review',
  NULL,
  COALESCE(MIN(profile_row.plan_value) FILTER (WHERE profile_row.plan_value > 0), 0),
  275,
  true,
  'monthly',
  CURRENT_DATE,
  'Snapshot inicial conservador; nenhum imposto foi inferido.'
FROM public.financial_plans plan_row
JOIN public.profiles profile_row
  ON plan_row.code = 'legacy-' || substr(md5(lower(btrim(profile_row.plan_name))), 1, 16)
WHERE plan_row.code LIKE 'legacy-%'
GROUP BY plan_row.id
HAVING NOT EXISTS (
  SELECT 1 FROM public.financial_plan_versions existing_version
  WHERE existing_version.plan_id = plan_row.id
)
ON CONFLICT (plan_id, version) DO NOTHING;

INSERT INTO public.financial_client_terms (
  client_id,
  plan_version_id,
  pricing_mode,
  custom_justification,
  operational_amount,
  amount_kind,
  tax_rate,
  final_amount,
  direct_cost_amount,
  direct_cost_estimated,
  due_day,
  billing_period,
  contract_started_on,
  starts_on,
  status,
  review_required,
  notes,
  source_system,
  legacy_source_id
)
SELECT
  profile_row.id,
  version_row.id,
  'custom',
  'Snapshot do valor atual no cadastro legado; classificação e imposto pendentes.',
  profile_row.plan_value,
  'needs_review',
  NULL,
  profile_row.plan_value,
  275,
  true,
  LEAST(GREATEST(COALESCE(EXTRACT(DAY FROM profile_row.plan_renewal_date)::integer, 10), 1), 28),
  'monthly',
  CURRENT_DATE,
  CURRENT_DATE,
  'draft',
  true,
  'Backfill não gera competências nem reescreve cobranças existentes.',
  'legacy_profiles',
  profile_row.id
FROM public.profiles profile_row
JOIN public.user_roles role_row
  ON role_row.user_id = profile_row.id AND role_row.role = 'client'::public.app_role
JOIN public.financial_plans plan_row
  ON plan_row.code = 'legacy-' || substr(md5(lower(btrim(profile_row.plan_name))), 1, 16)
JOIN public.financial_plan_versions version_row
  ON version_row.plan_id = plan_row.id AND version_row.version = 1
WHERE NULLIF(btrim(profile_row.plan_name), '') IS NOT NULL
  AND profile_row.plan_value > 0
  AND profile_row.client_type::text <> 'one_off'
  AND NOT EXISTS (
    SELECT 1 FROM public.financial_client_terms existing_term
    WHERE existing_term.client_id = profile_row.id
      AND existing_term.ends_on IS NULL
      AND existing_term.status IN ('draft', 'active', 'paused')
  );

INSERT INTO public.financial_recurring_rules (
  stable_code,
  name,
  description,
  direction,
  kind,
  category,
  amount,
  frequency,
  due_day,
  starts_on,
  is_active
) VALUES
  (
    'tools-systems',
    'Ferramentas e sistemas',
    'Referência atual editável. Gera somente após confirmação da competência.',
    'expense',
    'fixed_cost',
    'tools_systems',
    2500,
    'monthly',
    10,
    date_trunc('month', CURRENT_DATE)::date,
    true
  ),
  (
    'pro-labore-almir',
    'Pró-labore Almir',
    'Valor atual editável. O alvo de R$ 10.000 permanece apenas na configuração.',
    'expense',
    'pro_labore',
    'pro_labore',
    3000,
    'monthly',
    10,
    date_trunc('month', CURRENT_DATE)::date,
    true
  )
ON CONFLICT (stable_code) DO NOTHING;

REVOKE ALL ON FUNCTION public.financial_gross_up(numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.financial_upsert_plan(uuid, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.financial_archive_plan(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.financial_create_plan_version(uuid, numeric, date, text, numeric, numeric, boolean, text, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.financial_upsert_recurring_rule(uuid, text, text, text, text, numeric, text, integer, date, date, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.financial_archive_recurring_rule(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.financial_update_settings(text, numeric, numeric, integer, integer, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, boolean, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.financial_assign_client_plan(uuid, uuid, date, text, numeric, numeric, numeric, integer, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.financial_generate_competence(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.financial_record_settlement(uuid, numeric, date, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.financial_reverse_settlement(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.financial_cancel_entry(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.financial_close_period(date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.financial_reopen_period(date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.financial_overview_v2(text, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.financial_cash_flow_v2(text, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.financial_client_summaries_v2() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.financial_gross_up(numeric, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financial_upsert_plan(uuid, text, text, text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financial_archive_plan(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financial_create_plan_version(uuid, numeric, date, text, numeric, numeric, boolean, text, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financial_upsert_recurring_rule(uuid, text, text, text, text, numeric, text, integer, date, date, text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financial_archive_recurring_rule(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financial_update_settings(text, numeric, numeric, integer, integer, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, boolean, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financial_assign_client_plan(uuid, uuid, date, text, numeric, numeric, numeric, integer, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financial_generate_competence(date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financial_record_settlement(uuid, numeric, date, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financial_reverse_settlement(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financial_cancel_entry(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financial_close_period(date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financial_reopen_period(date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financial_overview_v2(text, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financial_cash_flow_v2(text, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financial_client_summaries_v2() TO authenticated, service_role;
