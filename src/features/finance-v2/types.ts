export type Money = number;
export type FlowBasis = "competence" | "cash" | "forecast";
export type ReviewStatus = "needs_review" | "reviewed" | "not_required";

export interface FlowTotals {
  in: Money;
  out: Money;
  net: Money;
}

export interface FinanceSummary {
  recurring_mrr: Money;
  cash: FlowTotals;
  accrual: FlowTotals;
  forecast: FlowTotals;
  receivables_open: Money;
}

export interface FinancePeriod {
  start: string;
  end: string;
  status: "open" | "closed";
  closure_id: string | null;
  revision: number | null;
}

export interface PlanRef {
  catalog_id: string;
  version_id: string;
  code: string;
  name: string;
  version: number;
  list_price: Money;
}

export interface ClientSubscription {
  id: string;
  client_id: string;
  status: string;
  amount: Money;
  currency: string;
  billing_day: number;
  starts_on: string;
  ends_on: string | null;
  next_billing_date: string | null;
  is_custom: boolean;
  review_status: ReviewStatus;
  plan: PlanRef;
}

export interface FinanceClient {
  id: string;
  name: string | null;
  brand: string | null;
  subscription: Omit<ClientSubscription, "client_id"> | null;
  billing: { due: Money; received: Money; open: Money; overdue: Money };
}

export interface CashFlowItem {
  id: string;
  obligation_id: string;
  date: string;
  type: "income" | "expense";
  source: "billing" | "project_installment" | "expense" | "fixed_cost";
  category: string | null;
  description: string;
  amount: Money;
  status: string;
  client_id: string | null;
  project_id: string | null;
  basis: FlowBasis;
}

export interface FixedCost {
  id: string;
  name: string;
  category: string;
  amount: Money;
  currency: string;
  frequency: "monthly" | "quarterly" | "semiannual" | "annual";
  due_day: number;
  active: boolean;
  starts_on: string;
  ends_on: string | null;
  next_due_date: string | null;
  supplier: string | null;
  payment_method: string | null;
  brand: string | null;
  notes: string | null;
}

export interface PlanCatalogItem {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  active: boolean;
  current_version: {
    id: string;
    version: number;
    monthly_price: Money;
    currency: string;
    billing_cycle: string;
    effective_from: string;
    effective_to: string | null;
  } | null;
}

export interface FinanceGoals {
  monthly_revenue: Money;
  retention_percent: number;
  reserve_months: number;
  minimum_margin_percent: number;
  target_pro_labore: Money;
}

export interface FinanceSettings {
  currency: string;
  default_billing_day: number;
  tax_rate_percent: number;
  project_receipts_mode: "separate" | "included_in_billing";
  closing_requires_completed_month: boolean;
  goals: FinanceGoals;
}

export interface FinanceDashboardData {
  schema_version: 2;
  generated_at: string;
  period: FinancePeriod;
  summary: FinanceSummary;
  clients: FinanceClient[];
  cash_flow: CashFlowItem[];
  subscriptions: ClientSubscription[];
  fixed_costs: FixedCost[];
  plans: PlanCatalogItem[];
  settings: FinanceSettings;
}

export interface FinanceDateRange {
  start: string;
  end: string;
}
