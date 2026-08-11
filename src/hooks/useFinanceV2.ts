import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { todayBR } from "@/lib/dateBR";
import { grossUp, roundMoney } from "@/lib/financialModel";

export type FinanceMode = "cash" | "accrual" | "forecast";
export type FinanceDirection = "income" | "expense";
export type FinanceEntryStatus = "pending" | "partial" | "settled" | "overdue" | "cancelled" | "reversal" | "refund" | "scheduled";
export type FinanceAmountKind = "operational" | "final" | "needs_review";
export type FinanceBillingPeriod = "monthly" | "bimonthly" | "quarterly" | "semiannual" | "annual";
export type FinanceAllocationMethod = "equal" | "revenue" | "custom" | "none";
export type FinancePricingMode = "linked" | "custom";

export interface FinanceOverview {
  competence: string;
  mode: FinanceMode;
  openingBalance: number;
  income: number;
  expense: number;
  net: number;
  settledIncome: number;
  settledExpense: number;
  pendingIncome: number;
  pendingExpense: number;
  overdueIncome: number;
  recurringRevenue: number;
  fixedCosts: number;
  forecast30Days: number;
  forecast60Days: number;
  forecast90Days: number;
  clientsCount: number;
  raw: Record<string, unknown>;
}

export interface FinanceEntry {
  id: string;
  entryId: string | null;
  competence: string;
  direction: FinanceDirection;
  description: string;
  category: string | null;
  amount: number;
  signedAmount: number;
  settledAmount: number;
  outstandingAmount: number;
  dueDate: string | null;
  settledAt: string | null;
  canSettle: boolean;
  status: FinanceEntryStatus;
  clientId: string | null;
  clientName: string | null;
  planId: string | null;
  recurringRuleId: string | null;
  brand: string | null;
  sourceType: string | null;
  raw: Record<string, unknown>;
}

export interface FinancePlanVersion {
  id: string;
  planId: string;
  version: number;
  amount: number;
  taxRate: number | null;
  finalAmount: number;
  directCost: number;
  directCostEstimated: boolean;
  billingPeriod: FinanceBillingPeriod;
  setupFee: number;
  amountKind: FinanceAmountKind;
  effectiveFrom: string;
  effectiveTo: string | null;
  description: string | null;
  createdAt: string | null;
  isActive: boolean;
  raw: Record<string, unknown>;
}

export interface FinancePlan {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  isActive: boolean;
  currentVersion: FinancePlanVersion | null;
  upcomingVersion: FinancePlanVersion | null;
  versions: FinancePlanVersion[];
  raw: Record<string, unknown>;
}

export interface FinanceRecurringRule {
  id: string;
  name: string;
  description: string | null;
  direction: FinanceDirection;
  category: string | null;
  amount: number;
  frequency: string;
  dueDay: number | null;
  startsOn: string | null;
  endsOn: string | null;
  brand: string | null;
  isActive: boolean;
  raw: Record<string, unknown>;
}

export interface FinanceSettings {
  id: string | null;
  currency: string;
  openingBalance: number;
  reserveTarget: number;
  defaultDueDay: number;
  forecastMonths: number;
  monthlyGoal: number | null;
  growthRetentionRate: number | null;
  minimumReserveMonths: number | null;
  desiredMinimumMargin: number | null;
  currentProLabore: number;
  targetProLabore: number;
  defaultDirectCost: number;
  allocationMethod: FinanceAllocationMethod;
  includeProLaboreInAllocation: boolean;
  raw: Record<string, unknown>;
}

export interface ClientFinancialSummary {
  clientId: string;
  clientName: string;
  planName: string | null;
  pricingMode: string | null;
  operationalAmount: number;
  finalAmount: number;
  taxRate: number | null;
  taxReserve: number;
  directCost: number;
  directCostEstimated: boolean;
  contributionMarginPercent: number | null;
  dueDay: number | null;
  billingStatus: string;
  billingPeriod: FinanceBillingPeriod;
  reviewRequired: boolean;
  planAmount: number;
  finalPlanAmount: number;
  openAmount: number;
  overdueAmount: number;
  settledAmount: number;
  nextDueDate: string | null;
  status: string;
  upcomingPlanName: string | null;
  upcomingOperationalAmount: number | null;
  upcomingFinalAmount: number | null;
  upcomingStartsOn: string | null;
  raw: Record<string, unknown>;
}

export interface GenerateCompetenceInput {
  competence: string;
}

export interface RecordSettlementInput {
  entryId: string;
  amount: number;
  settledOn: string;
  method?: string | null;
  notes?: string | null;
  idempotencyKey?: string | null;
}

export interface ReverseSettlementInput {
  settlementId: string;
  reason: string;
}

export interface AssignClientPlanInput {
  clientId: string;
  planVersionId: string;
  effectiveFrom: string;
  pricingMode: FinancePricingMode;
  operationalAmount?: number | null;
  taxRate?: number | null;
  directCost?: number | null;
  dueDay?: number | null;
  paymentMethod?: string | null;
  justification?: string | null;
}

export interface CreatePlanVersionInput {
  planId: string;
  amount: number;
  taxRate: number | null;
  finalAmount: number;
  directCost: number;
  directCostEstimated: boolean;
  billingPeriod: FinanceBillingPeriod;
  setupFee: number;
  amountKind: FinanceAmountKind;
  effectiveFrom: string;
  description?: string | null;
}

export interface UpdateSettingsInput {
  currency: string;
  openingBalance: number;
  reserveTarget: number;
  defaultDueDay: number;
  forecastMonths: number;
  monthlyGoal: number | null;
  growthRetentionRate: number | null;
  minimumReserveMonths: number | null;
  desiredMinimumMargin: number | null;
  currentProLabore: number;
  targetProLabore: number;
  defaultDirectCost: number;
  allocationMethod: FinanceAllocationMethod;
  includeProLaboreInAllocation: boolean;
}

export interface UpsertPlanInput {
  id?: string;
  name: string;
  code?: string | null;
  description?: string | null;
  isActive?: boolean;
}

export interface UpsertRecurringRuleInput {
  id?: string;
  name: string;
  description?: string | null;
  direction: FinanceDirection;
  category?: string | null;
  amount: number;
  frequency?: string;
  dueDay?: number | null;
  startsOn?: string | null;
  endsOn?: string | null;
  brand?: string | null;
  isActive?: boolean;
}

// Types for the additive V2 schema are generated only after its migration is applied.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const financeDb = supabase as any;

export const FINANCE_V2_CONTRACT = {
  tables: {
    plans: "financial_plans",
    planVersions: "financial_plan_versions",
    entries: "financial_entries_enriched",
    recurringRules: "financial_recurring_rules",
    settings: "financial_settings",
  },
  rpc: {
    overview: "financial_overview_v2",
    cashFlow: "financial_cash_flow_v2",
    clientSummaries: "financial_client_summaries_v2",
    generateCompetence: "financial_generate_competence",
    recordSettlement: "financial_record_settlement",
    reverseSettlement: "financial_reverse_settlement",
    createPlanVersion: "financial_create_plan_version",
    updateSettings: "financial_update_settings",
    upsertPlan: "financial_upsert_plan",
    archivePlan: "financial_archive_plan",
    upsertRecurringRule: "financial_upsert_recurring_rule",
    archiveRecurringRule: "financial_archive_recurring_rule",
    assignClientPlan: "financial_assign_client_plan",
  },
} as const;

export const financeV2Keys = {
  all: ["finance-v2"] as const,
  overview: (userId: string | undefined, mode: FinanceMode, competence: string) =>
    [...financeV2Keys.all, "overview", userId, mode, competence] as const,
  entries: (userId: string | undefined, mode: FinanceMode, competence: string) =>
    [...financeV2Keys.all, "entries", userId, mode, competence] as const,
  plans: (userId: string | undefined) => [...financeV2Keys.all, "plans", userId] as const,
  recurringRules: (userId: string | undefined) => [...financeV2Keys.all, "recurring-rules", userId] as const,
  settings: (userId: string | undefined) => [...financeV2Keys.all, "settings", userId] as const,
  clientSummaries: (userId: string | undefined) => [...financeV2Keys.all, "client-summaries", userId] as const,
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const firstRecord = (value: unknown): Record<string, unknown> => {
  if (Array.isArray(value)) return asRecord(value[0]);
  return asRecord(value);
};

const numberOf = (...values: unknown[]): number => {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const stringOf = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
};

const booleanOf = (value: unknown, fallback = true): boolean =>
  typeof value === "boolean" ? value : value === null || value === undefined ? fallback : Boolean(value);

export const normalizeCompetence = (competence: string): string => {
  if (/^\d{4}-\d{2}$/.test(competence)) return `${competence}-01`;
  return competence;
};

export const calculateGrossedUpAmount = (operationalAmount: number, taxRate: number | null): number => {
  if (!Number.isFinite(operationalAmount) || operationalAmount < 0) return 0;
  if (taxRate === null) return roundMoney(operationalAmount);
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate >= 1) return 0;
  return grossUp(operationalAmount, taxRate);
};

const normalizeOverview = (value: unknown, mode: FinanceMode, competence: string): FinanceOverview => {
  const row = firstRecord(value);
  const income = numberOf(row.income, row.income_total, row.total_income, row.revenue, row.revenue_total);
  const expense = numberOf(row.expense, row.expense_total, row.total_expense, row.costs, row.cost_total);
  return {
    competence: stringOf(row.competence, row.competence_month) || normalizeCompetence(competence),
    mode: (stringOf(row.mode) as FinanceMode | null) || mode,
    openingBalance: numberOf(row.opening_balance),
    income,
    expense,
    net: numberOf(row.net, row.net_total, row.balance, income - expense),
    settledIncome: numberOf(row.settled_income, row.received, row.received_total),
    settledExpense: numberOf(row.settled_expense, row.paid, row.paid_total),
    pendingIncome: numberOf(row.pending_income, row.receivable, row.receivable_total),
    pendingExpense: numberOf(row.pending_expense, row.payable, row.payable_total),
    overdueIncome: numberOf(row.overdue_income, row.overdue, row.overdue_total),
    recurringRevenue: numberOf(row.recurring_revenue, row.mrr),
    fixedCosts: numberOf(row.fixed_costs, row.recurring_expense),
    forecast30Days: numberOf(row.forecast_30_days),
    forecast60Days: numberOf(row.forecast_60_days),
    forecast90Days: numberOf(row.forecast_90_days),
    clientsCount: numberOf(row.clients_count, row.active_clients),
    raw: row,
  };
};

const normalizeEntry = (value: unknown, mode: FinanceMode): FinanceEntry => {
  const row = asRecord(value);
  const hasSignedAmount = row.signed_amount !== null && row.signed_amount !== undefined;
  const rawAmount = numberOf(row.amount, row.net_amount, row.total_amount);
  const rawSignedAmount = hasSignedAmount ? numberOf(row.signed_amount) : rawAmount;
  const settledAmount = numberOf(row.settled_amount, row.paid_amount, row.received_amount);
  const directionValue = stringOf(row.direction, row.entry_type, row.kind, row.type);
  const direction: FinanceDirection = hasSignedAmount
    ? rawSignedAmount < 0 ? "expense" : "income"
    : directionValue === "expense" || directionValue === "outflow" ? "expense" : "income";
  const amount = Math.abs(hasSignedAmount ? rawSignedAmount : rawAmount);
  const signedAmount = hasSignedAmount ? rawSignedAmount : direction === "income" ? amount : -amount;
  const outstandingAmount = Math.abs(numberOf(
    row.outstanding_amount,
    row.open_amount,
    Math.max(amount - Math.abs(settledAmount), 0),
  ));
  const settlementKind = stringOf(row.kind);
  const statusValue = stringOf(row.settlement_status, row.status)
    || (mode === "cash"
      ? settlementKind === "reversal" || settlementKind === "refund" ? settlementKind : "settled"
      : "pending");
  return {
    id: String(row.id || row.entry_id || ""),
    entryId: stringOf(row.entry_id, row.id),
    competence: stringOf(row.competence, row.competence_month) || "",
    direction,
    description: stringOf(row.description, row.name, row.label) || "Lançamento financeiro",
    category: stringOf(row.category),
    amount,
    signedAmount,
    settledAmount: Math.abs(settledAmount),
    outstandingAmount,
    dueDate: stringOf(row.due_date, row.due_on),
    settledAt: stringOf(row.settled_at, row.settled_on, row.paid_date, row.received_date),
    canSettle: booleanOf(
      row.can_settle,
      mode !== "cash" && outstandingAmount > 0 && !["settled", "cancelled"].includes(statusValue),
    ),
    status: statusValue as FinanceEntryStatus,
    clientId: stringOf(row.client_id),
    clientName: stringOf(row.client_name, row.company_name, row.full_name),
    planId: stringOf(row.plan_id),
    recurringRuleId: stringOf(row.recurring_rule_id),
    brand: stringOf(row.brand),
    sourceType: stringOf(row.source_type, row.kind),
    raw: row,
  };
};

const normalizePlanVersion = (value: unknown): FinancePlanVersion => {
  const row = asRecord(value);
  const operationalAmount = numberOf(row.operational_amount, row.amount, row.price, row.monthly_amount);
  const taxRate = row.tax_rate === null || row.tax_rate === undefined ? null : numberOf(row.tax_rate);
  return {
    id: String(row.id || ""),
    planId: String(row.plan_id || ""),
    version: numberOf(row.version),
    amount: operationalAmount,
    taxRate,
    finalAmount: numberOf(row.final_amount, calculateGrossedUpAmount(operationalAmount, taxRate)),
    directCost: numberOf(row.direct_cost_amount, row.direct_cost, 275),
    directCostEstimated: booleanOf(row.direct_cost_estimated),
    billingPeriod: (stringOf(row.billing_period) as FinanceBillingPeriod | null) || "monthly",
    setupFee: numberOf(row.setup_fee),
    amountKind: (stringOf(row.amount_kind) as FinanceAmountKind | null) || (taxRate === null ? "needs_review" : "operational"),
    effectiveFrom: stringOf(row.valid_from, row.effective_from, row.starts_on) || "",
    effectiveTo: stringOf(row.valid_to, row.effective_to, row.ends_on),
    description: stringOf(row.description, row.notes),
    createdAt: stringOf(row.created_at),
    isActive: booleanOf(row.is_active ?? row.active),
    raw: row,
  };
};

const normalizePlan = (value: unknown, versions: FinancePlanVersion[]): FinancePlan => {
  const row = asRecord(value);
  const planVersions = versions
    .filter((version) => version.planId === row.id)
    .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom));
  const today = todayBR();
  const currentVersion = planVersions.find(
    (version) => version.effectiveFrom <= today && (!version.effectiveTo || version.effectiveTo >= today),
  ) || null;
  const upcomingVersion = planVersions
    .filter((version) => version.effectiveFrom > today)
    .sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom))[0] || null;
  return {
    id: String(row.id || ""),
    name: stringOf(row.name, row.title) || "Plano sem nome",
    code: stringOf(row.code, row.slug),
    description: stringOf(row.description),
    isActive: booleanOf(row.is_active ?? row.active),
    currentVersion,
    upcomingVersion,
    versions: planVersions,
    raw: row,
  };
};

const normalizeRecurringRule = (value: unknown): FinanceRecurringRule => {
  const row = asRecord(value);
  const directionValue = stringOf(row.direction, row.entry_type, row.kind, row.type);
  return {
    id: String(row.id || ""),
    name: stringOf(row.name, row.description, row.label) || "Regra recorrente",
    description: stringOf(row.description, row.notes),
    direction: directionValue === "income" || directionValue === "inflow" ? "income" : "expense",
    category: stringOf(row.category),
    amount: numberOf(row.amount),
    frequency: stringOf(row.frequency, row.recurrence) || "monthly",
    dueDay: row.due_day === null || row.due_day === undefined ? null : numberOf(row.due_day),
    startsOn: stringOf(row.starts_on, row.start_date),
    endsOn: stringOf(row.ends_on, row.end_date),
    brand: stringOf(row.brand),
    isActive: booleanOf(row.is_active ?? row.active),
    raw: row,
  };
};

const normalizeSettings = (value: unknown): FinanceSettings => {
  const row = firstRecord(value);
  return {
    id: stringOf(row.id),
    currency: stringOf(row.currency) || "BRL",
    openingBalance: numberOf(row.opening_balance),
    reserveTarget: numberOf(row.reserve_target, row.cash_reserve_target),
    defaultDueDay: numberOf(row.default_due_day, 10),
    forecastMonths: numberOf(row.forecast_months, row.projection_months, 6),
    monthlyGoal: row.monthly_goal === null || row.monthly_goal === undefined ? null : numberOf(row.monthly_goal),
    growthRetentionRate: row.growth_retention_rate === null || row.growth_retention_rate === undefined
      ? null
      : numberOf(row.growth_retention_rate),
    minimumReserveMonths: row.minimum_reserve_months === null || row.minimum_reserve_months === undefined
      ? null
      : numberOf(row.minimum_reserve_months),
    desiredMinimumMargin: row.desired_minimum_margin === null || row.desired_minimum_margin === undefined
      ? null
      : numberOf(row.desired_minimum_margin),
    currentProLabore: numberOf(row.current_pro_labore, 3000),
    targetProLabore: numberOf(row.target_pro_labore, 10000),
    defaultDirectCost: numberOf(row.default_direct_cost, 275),
    allocationMethod: (stringOf(row.allocation_method) as FinanceAllocationMethod | null) || "equal",
    includeProLaboreInAllocation: booleanOf(row.include_pro_labore_in_allocation, false),
    raw: row,
  };
};

const normalizeClientSummary = (value: unknown): ClientFinancialSummary => {
  const row = asRecord(value);
  const rawBillingPeriod = stringOf(row.billing_period);
  const billingPeriod: FinanceBillingPeriod = ["monthly", "bimonthly", "quarterly", "semiannual", "annual"]
    .includes(rawBillingPeriod || "")
    ? rawBillingPeriod as FinanceBillingPeriod
    : "monthly";
  const billingMonths: Record<FinanceBillingPeriod, number> = {
    monthly: 1,
    bimonthly: 2,
    quarterly: 3,
    semiannual: 6,
    annual: 12,
  };
  const operationalAmount = numberOf(row.operational_amount);
  const finalAmount = numberOf(row.final_amount);
  const planAmount = row.plan_amount === null || row.plan_amount === undefined
    ? roundMoney(operationalAmount / billingMonths[billingPeriod])
    : numberOf(row.plan_amount);
  const finalPlanAmount = row.final_plan_amount === null || row.final_plan_amount === undefined
    ? roundMoney(finalAmount / billingMonths[billingPeriod])
    : numberOf(row.final_plan_amount);
  return {
    clientId: String(row.client_id || row.id || ""),
    clientName: stringOf(row.client_name, row.company_name, row.full_name) || "Cliente",
    planName: stringOf(row.plan_name),
    pricingMode: stringOf(row.pricing_mode),
    operationalAmount,
    finalAmount,
    taxRate: row.tax_rate === null || row.tax_rate === undefined ? null : numberOf(row.tax_rate),
    taxReserve: numberOf(row.tax_reserve),
    directCost: numberOf(row.direct_cost),
    directCostEstimated: booleanOf(row.direct_cost_estimated),
    contributionMarginPercent: row.contribution_margin_percent === null || row.contribution_margin_percent === undefined
      ? null
      : numberOf(row.contribution_margin_percent),
    dueDay: row.due_day === null || row.due_day === undefined ? null : numberOf(row.due_day),
    billingStatus: stringOf(row.billing_status) || "pending",
    billingPeriod,
    reviewRequired: booleanOf(row.review_required, false),
    planAmount,
    finalPlanAmount,
    openAmount: numberOf(row.open_amount, row.pending_amount),
    overdueAmount: numberOf(row.overdue_amount),
    settledAmount: numberOf(row.settled_amount, row.received_amount),
    nextDueDate: stringOf(row.next_due_date, row.due_date),
    status: stringOf(row.status, row.term_status, row.plan_status) || "not_configured",
    upcomingPlanName: stringOf(row.upcoming_plan_name),
    upcomingOperationalAmount: row.upcoming_operational_amount === null || row.upcoming_operational_amount === undefined
      ? null
      : numberOf(row.upcoming_operational_amount),
    upcomingFinalAmount: row.upcoming_final_amount === null || row.upcoming_final_amount === undefined
      ? null
      : numberOf(row.upcoming_final_amount),
    upcomingStartsOn: stringOf(row.upcoming_starts_on),
    raw: row,
  };
};

const unwrapRows = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  const row = asRecord(value);
  if (Array.isArray(row.data)) return row.data;
  if (Array.isArray(row.rows)) return row.rows;
  if (Array.isArray(row.items)) return row.items;
  return Object.keys(row).length ? [row] : [];
};

const invalidateFinance = async (queryClient: ReturnType<typeof useQueryClient>) => {
  await queryClient.invalidateQueries({ queryKey: financeV2Keys.all });
};

export function useFinanceOverview(mode: FinanceMode, competence: string) {
  const { user } = useAuth();
  const normalizedCompetence = normalizeCompetence(competence);
  return useQuery({
    queryKey: financeV2Keys.overview(user?.id, mode, normalizedCompetence),
    queryFn: async () => {
      const { data, error } = await financeDb.rpc(FINANCE_V2_CONTRACT.rpc.overview, {
        p_mode: mode,
        p_competence: normalizedCompetence,
      });
      if (error) throw error;
      return normalizeOverview(data, mode, normalizedCompetence);
    },
    enabled: !!user && !!normalizedCompetence,
  });
}

export function useFinanceEntries(mode: FinanceMode, competence: string) {
  const { user } = useAuth();
  const normalizedCompetence = normalizeCompetence(competence);
  return useQuery({
    queryKey: financeV2Keys.entries(user?.id, mode, normalizedCompetence),
    queryFn: async () => {
      const { data, error } = await financeDb.rpc(FINANCE_V2_CONTRACT.rpc.cashFlow, {
        p_mode: mode,
        p_competence: normalizedCompetence,
      }, { get: true });
      if (error) throw error;
      return unwrapRows(data).map((row) => normalizeEntry(row, mode));
    },
    enabled: !!user && !!normalizedCompetence,
  });
}

export function useFinancePlans() {
  const { user } = useAuth();
  return useQuery({
    queryKey: financeV2Keys.plans(user?.id),
    queryFn: async () => {
      const [plansResult, versionsResult] = await Promise.all([
        financeDb.from(FINANCE_V2_CONTRACT.tables.plans).select("*").order("name", { ascending: true }),
        financeDb
          .from(FINANCE_V2_CONTRACT.tables.planVersions)
          .select("*")
          .order("valid_from", { ascending: false }),
      ]);
      if (plansResult.error) throw plansResult.error;
      if (versionsResult.error) throw versionsResult.error;
      const versions = (versionsResult.data || []).map(normalizePlanVersion);
      return (plansResult.data || []).map((plan: unknown) => normalizePlan(plan, versions));
    },
    enabled: !!user,
  });
}

export function useFinanceRecurringRules() {
  const { user } = useAuth();
  return useQuery({
    queryKey: financeV2Keys.recurringRules(user?.id),
    queryFn: async () => {
      const { data, error } = await financeDb
        .from(FINANCE_V2_CONTRACT.tables.recurringRules)
        .select("*")
        .order("is_active", { ascending: false })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data || []).map(normalizeRecurringRule);
    },
    enabled: !!user,
  });
}

export function useFinanceSettings() {
  const { user } = useAuth();
  return useQuery({
    queryKey: financeV2Keys.settings(user?.id),
    queryFn: async () => {
      const { data, error } = await financeDb
        .from(FINANCE_V2_CONTRACT.tables.settings)
        .select("*")
        .eq("settings_key", "default")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return normalizeSettings(data);
    },
    enabled: !!user,
  });
}

export function useClientFinancialSummaries(options: { enabled?: boolean } = {}) {
  const { user, profile } = useAuth();
  const canReadPortfolio = profile?.role === "admin" || profile?.role === "manager";
  return useQuery({
    queryKey: financeV2Keys.clientSummaries(user?.id),
    queryFn: async () => {
      const { data, error } = await financeDb.rpc(FINANCE_V2_CONTRACT.rpc.clientSummaries);
      if (error) throw error;
      return unwrapRows(data).map(normalizeClientSummary);
    },
    enabled: !!user && canReadPortfolio && (options.enabled ?? true),
  });
}

export function useFinanceMutations() {
  const queryClient = useQueryClient();

  const generateCompetence = useMutation({
    mutationFn: async ({ competence }: GenerateCompetenceInput) => {
      const { data, error } = await financeDb.rpc(FINANCE_V2_CONTRACT.rpc.generateCompetence, {
        p_competence: normalizeCompetence(competence),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateFinance(queryClient),
  });

  const recordSettlement = useMutation({
    mutationFn: async (input: RecordSettlementInput) => {
      const { data, error } = await financeDb.rpc(FINANCE_V2_CONTRACT.rpc.recordSettlement, {
        p_entry_id: input.entryId,
        p_amount: input.amount,
        p_settled_on: input.settledOn,
        p_method: input.method || null,
        p_notes: input.notes || null,
        p_idempotency_key: input.idempotencyKey || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateFinance(queryClient),
  });

  const reverseSettlement = useMutation({
    mutationFn: async (input: ReverseSettlementInput) => {
      const { data, error } = await financeDb.rpc(FINANCE_V2_CONTRACT.rpc.reverseSettlement, {
        p_settlement_id: input.settlementId,
        p_reason: input.reason.trim(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateFinance(queryClient),
  });

  const assignClientPlan = useMutation({
    mutationFn: async (input: AssignClientPlanInput) => {
      if (input.pricingMode === "custom" && !input.justification?.trim()) {
        throw new Error("Informe a justificativa do preço personalizado.");
      }
      const { data, error } = await financeDb.rpc(FINANCE_V2_CONTRACT.rpc.assignClientPlan, {
        p_client_id: input.clientId,
        p_plan_version_id: input.planVersionId,
        p_effective_from: input.effectiveFrom,
        p_pricing_mode: input.pricingMode,
        p_operational_amount: input.pricingMode === "custom" ? input.operationalAmount ?? null : null,
        p_tax_rate: input.pricingMode === "custom" ? input.taxRate ?? null : null,
        p_direct_cost: input.pricingMode === "custom" ? input.directCost ?? null : null,
        p_due_day: input.dueDay ?? null,
        p_payment_method: input.paymentMethod?.trim() || null,
        p_justification: input.pricingMode === "custom" ? input.justification?.trim() || null : null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateFinance(queryClient),
  });

  const createPlanVersion = useMutation({
    mutationFn: async (input: CreatePlanVersionInput) => {
      const expectedFinalAmount = calculateGrossedUpAmount(input.amount, input.taxRate);
      const expectedAmountKind: FinanceAmountKind = input.taxRate === null ? "needs_review" : "operational";
      if (Math.abs(expectedFinalAmount - input.finalAmount) > 0.01 || input.amountKind !== expectedAmountKind) {
        throw new Error("O preview do preço mudou. Revise valor operacional e alíquota antes de salvar.");
      }
      const { data, error } = await financeDb.rpc(FINANCE_V2_CONTRACT.rpc.createPlanVersion, {
        p_plan_id: input.planId,
        p_amount: input.amount,
        p_effective_from: input.effectiveFrom,
        p_description: input.description || null,
        p_tax_rate: input.taxRate,
        p_direct_cost: input.directCost,
        p_direct_cost_estimated: input.directCostEstimated,
        p_billing_period: input.billingPeriod,
        p_setup_fee: input.setupFee,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateFinance(queryClient),
  });

  const updateSettings = useMutation({
    mutationFn: async (input: UpdateSettingsInput) => {
      const { data, error } = await financeDb.rpc(FINANCE_V2_CONTRACT.rpc.updateSettings, {
        p_currency: input.currency,
        p_opening_balance: input.openingBalance,
        p_reserve_target: input.reserveTarget,
        p_default_due_day: input.defaultDueDay,
        p_forecast_months: input.forecastMonths,
        p_monthly_goal: input.monthlyGoal,
        p_growth_retention_rate: input.growthRetentionRate,
        p_minimum_reserve_months: input.minimumReserveMonths,
        p_desired_minimum_margin: input.desiredMinimumMargin,
        p_current_pro_labore: input.currentProLabore,
        p_target_pro_labore: input.targetProLabore,
        p_default_direct_cost: input.defaultDirectCost,
        p_allocation_method: input.allocationMethod,
        p_include_pro_labore_in_allocation: input.includeProLaboreInAllocation,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateFinance(queryClient),
  });

  const upsertPlan = useMutation({
    mutationFn: async (input: UpsertPlanInput) => {
      const { data, error } = await financeDb.rpc(FINANCE_V2_CONTRACT.rpc.upsertPlan, {
        p_plan_id: input.id || null,
        p_name: input.name.trim(),
        p_code: input.code?.trim() || null,
        p_description: input.description?.trim() || null,
        p_is_active: input.isActive ?? true,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateFinance(queryClient),
  });

  const archivePlan = useMutation({
    mutationFn: async (planId: string) => {
      const { data, error } = await financeDb.rpc(FINANCE_V2_CONTRACT.rpc.archivePlan, {
        p_plan_id: planId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateFinance(queryClient),
  });

  const upsertRecurringRule = useMutation({
    mutationFn: async (input: UpsertRecurringRuleInput) => {
      const { data, error } = await financeDb.rpc(FINANCE_V2_CONTRACT.rpc.upsertRecurringRule, {
        p_rule_id: input.id || null,
        p_name: input.name.trim(),
        p_description: input.description?.trim() || null,
        p_direction: input.direction,
        p_category: input.category?.trim() || null,
        p_amount: input.amount,
        p_frequency: input.frequency || "monthly",
        p_due_day: input.dueDay ?? null,
        p_starts_on: input.startsOn || null,
        p_ends_on: input.endsOn || null,
        p_brand: input.brand || null,
        p_is_active: input.isActive ?? true,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateFinance(queryClient),
  });

  const archiveRecurringRule = useMutation({
    mutationFn: async (ruleId: string) => {
      const { data, error } = await financeDb.rpc(FINANCE_V2_CONTRACT.rpc.archiveRecurringRule, {
        p_rule_id: ruleId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateFinance(queryClient),
  });

  return {
    generateCompetence,
    recordSettlement,
    reverseSettlement,
    assignClientPlan,
    createPlanVersion,
    updateSettings,
    upsertPlan,
    archivePlan,
    upsertRecurringRule,
    archiveRecurringRule,
  };
}
