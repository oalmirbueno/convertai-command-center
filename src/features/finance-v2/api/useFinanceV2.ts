import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { currentMonthRange } from "../lib/finance";
import type { FinanceDashboardData, FinanceDateRange } from "../types";

type RpcResult = {
  data: unknown;
  error: { message: string } | null;
};

const call = async (name: string, args: Record<string, unknown>) => {
  const rpc = supabase.rpc as unknown as (
    rpcName: string,
    rpcArgs: Record<string, unknown>,
  ) => Promise<RpcResult>;
  const { data, error } = await rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
};

const parseDashboard = (raw: unknown): FinanceDashboardData => {
  const value = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
  if (
    !value ||
    typeof value !== "object" ||
    (value as { schema_version?: number }).schema_version !== 2
  ) {
    throw new Error("Contrato financeiro V2 indisponivel.");
  }
  for (const key of [
    "clients",
    "cash_flow",
    "subscriptions",
    "fixed_costs",
    "plans",
  ] as const) {
    if (!Array.isArray((value as Record<string, unknown>)[key])) {
      throw new Error("Resposta financeira sem " + key + ".");
    }
  }
  return value as FinanceDashboardData;
};

export const financeKey = (range: FinanceDateRange) =>
  ["finance-v2", range.start, range.end] as const;

export function useFinanceDashboard(
  range: FinanceDateRange = currentMonthRange(),
) {
  return useQuery({
    queryKey: financeKey(range),
    queryFn: async () =>
      parseDashboard(
        await call("finance_get_dashboard", {
          p_period_start: range.start,
          p_period_end: range.end,
        }),
      ),
    staleTime: 30_000,
    gcTime: 300_000,
    retry: 1,
  });
}

function useAdminRpc<T>(name: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: T) => call(name, args as Record<string, unknown>),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["finance-v2"] }),
  });
}

export type UpsertPlanArgs = {
  p_code: string;
  p_display_name: string;
  p_description?: string | null;
  p_active?: boolean;
  p_sort_order?: number;
};

export type PublishPlanVersionArgs = {
  p_plan_id: string;
  p_monthly_price: number;
  p_effective_from: string;
  p_setup_fee?: number;
  p_currency?: string;
  p_billing_cycle?:
    | "monthly"
    | "quarterly"
    | "semiannual"
    | "annual"
    | "one_time";
  p_features?: unknown;
};

export type SetSubscriptionArgs = {
  p_client_id: string;
  p_plan_version_id: string;
  p_effective_on?: string;
  p_agreed_monthly_amount?: number | null;
  p_billing_day?: number | null;
  p_next_billing_date?: string | null;
  p_notes?: string | null;
};

export type UpsertFixedCostArgs = {
  p_name: string;
  p_amount: number;
  p_category: string;
  p_due_day: number;
  p_id?: string | null;
  p_currency?: string;
  p_frequency?: "monthly" | "quarterly" | "semiannual" | "annual";
  p_starts_on?: string;
  p_ends_on?: string | null;
  p_active?: boolean;
  p_supplier?: string | null;
  p_payment_method?: string | null;
  p_brand?: string | null;
  p_notes?: string | null;
};

export type UpdateSettingsArgs = {
  p_default_currency?: string | null;
  p_default_billing_day?: number | null;
  p_tax_rate_percent?: number | null;
  p_project_receipts_mode?: "separate" | "included_in_billing" | null;
  p_closing_requires_completed_month?: boolean | null;
  p_timezone?: string | null;
  p_monthly_revenue_goal?: number | null;
  p_retention_percent?: number | null;
  p_reserve_months?: number | null;
  p_minimum_margin_percent?: number | null;
  p_target_pro_labore?: number | null;
};

export const useUpsertPlan = () =>
  useAdminRpc<UpsertPlanArgs>("finance_upsert_plan");
export const usePublishPlanVersion = () =>
  useAdminRpc<PublishPlanVersionArgs>("finance_publish_plan_version");
export const useSetClientSubscription = () =>
  useAdminRpc<SetSubscriptionArgs>("finance_set_client_subscription");
export const useUpsertFixedCost = () =>
  useAdminRpc<UpsertFixedCostArgs>("finance_upsert_fixed_cost");
export const useUpdateFinanceSettings = () =>
  useAdminRpc<UpdateSettingsArgs>("finance_update_settings");
export const useGenerateMonthlyBilling = () =>
  useAdminRpc<{ p_through?: string }>("finance_generate_monthly_billing");
