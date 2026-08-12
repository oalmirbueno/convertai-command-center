import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useClients } from "@/hooks/useSupabaseData";
import { useClientFinancialSummaries } from "@/hooks/useFinanceV2";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  UserPlus,
  Link2,
  CalendarClock,
  AlertTriangle,
  Eye,
  Search,
  X,
  ChevronRight,
  Users,
  DollarSign,
  Receipt,
  Wallet,
  AlertCircle,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import CreateClientModal from "@/components/admin/CreateClientModal";
import EditClientDrawer from "@/components/admin/EditClientDrawer";
import BriefingLinkModal from "@/components/admin/BriefingLinkModal";
import { formatBRDate, parseAppDate, todayBR } from "@/lib/dateBR";
import { isInternalClient } from "@/lib/clientFlags";
import { useBilling } from "@/hooks/useFinancialData";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";

function getRenewalStatus(dateStr: string | null | undefined) {
  if (!dateStr) return null;
  const today = parseAppDate(todayBR());
  const renewal = parseAppDate(dateStr);
  if (!today || !renewal) return null;
  const diffMs = renewal.getTime() - today.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return { level: "expired", label: `Vencido há ${Math.abs(diffDays)} dia(s)`, color: "text-destructive", bg: "bg-destructive/10 border-destructive/30", icon: true };
  if (diffDays <= 7) return { level: "urgent", label: `Vence em ${diffDays} dia(s)`, color: "text-warning", bg: "bg-warning/10 border-warning/30", icon: true };
  if (diffDays <= 15) return { level: "soon", label: `Vence em ${diffDays} dias`, color: "text-muted-foreground", bg: "", icon: false };
  return { level: "ok", label: "", color: "text-muted-foreground", bg: "", icon: false };
}

const STATUS_TABS = [
  { value: "all", label: "Todos" },
  { value: "active", label: "Ativos" },
  { value: "onboarding", label: "Em Andamento" },
  { value: "standby", label: "Standby" },
  { value: "inactive", label: "Inativos" },
];

const statusDot: Record<string, string> = {
  active: "bg-success pulse-dot",
  onboarding: "bg-warning pulse-dot",
  standby: "bg-accent",
  inactive: "bg-muted-foreground",
};

const statusLabel: Record<string, string> = {
  active: "Ativo",
  onboarding: "Em Andamento",
  standby: "Standby",
  inactive: "Inativo",
};

const TYPE_TABS = [
  { value: "all", label: "Todos" },
  { value: "recurring", label: "Recorrentes" },
  { value: "one_off", label: "Avulsos" },
  { value: "hybrid", label: "Híbridos" },
];

// Filtro por serviço contratado (services_config do cadastro). Rótulos curtos
// para o filtro caber em uma linha sem virar bagunça.
const SERVICE_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "Todos os serviços" },
  { value: "social", label: "Social Media" },
  { value: "trafego", label: "Tráfego" },
  { value: "site", label: "Site" },
  { value: "automacao", label: "Automação" },
  { value: "design", label: "Design" },
  { value: "videos_ia", label: "Vídeos" },
  { value: "seo", label: "SEO" },
];

const typeBadge: Record<string, { label: string; cls: string }> = {
  recurring: { label: "Recorrente", cls: "bg-primary/10 text-primary border-primary/30" },
  one_off: { label: "Avulso", cls: "bg-warning/10 text-warning border-warning/30" },
  hybrid: { label: "Híbrido", cls: "bg-accent/10 text-accent-foreground border-accent/30" },
};

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

type FinancialRecord = Record<string, unknown>;

type ClientRecord = {
  id: string;
  full_name?: string | null;
  company_name?: string | null;
  email?: string | null;
  phone?: string | null;
  avatar_url?: string | null;
  plan_name?: string | null;
  plan_status?: string | null;
  plan_renewal_date?: string | null;
  client_type?: string | null;
  brand?: string | null;
  projectCount?: number;
};

type ClientFinancialView = {
  clientId: string;
  planName: string | null;
  pricingMode: "linked" | "custom" | null;
  operationalAmount: number | null;
  finalAmount: number | null;
  planAmount: number | null;
  finalPlanAmount: number | null;
  billingPeriod: string | null;
  termStatus: string | null;
  reviewRequired: boolean;
  directCost: number | null;
  directCostEstimated: boolean;
  marginPercent: number | null;
  dueLabel: string | null;
  billingStatus: string | null;
  receivableAmount: number | null;
  overdueAmount: number | null;
  raw: FinancialRecord;
};

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const percentFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function readPath(source: unknown, path: string) {
  let current: unknown = source;
  for (const key of path.split(".")) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function firstValue(source: unknown, paths: string[]) {
  for (const path of paths) {
    const value = readPath(source, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;

  const compact = value.trim().replace(/[^0-9,.-]/g, "");
  if (!compact) return null;

  const commaIndex = compact.lastIndexOf(",");
  const dotIndex = compact.lastIndexOf(".");
  let normalized = compact;
  if (commaIndex >= 0 && dotIndex >= 0) {
    normalized = commaIndex > dotIndex
      ? compact.replace(/\./g, "").replace(",", ".")
      : compact.replace(/,/g, "");
  } else if (commaIndex >= 0) {
    normalized = compact.replace(",", ".");
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(source: unknown, paths: string[]) {
  return toFiniteNumber(firstValue(source, paths));
}

function firstString(source: unknown, paths: string[]) {
  const value = firstValue(source, paths);
  return value === undefined ? null : String(value).trim() || null;
}

function firstBoolean(source: unknown, paths: string[]) {
  const value = firstValue(source, paths);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.toLowerCase().trim();
    if (["true", "1", "yes", "sim"].includes(normalized)) return true;
    if (["false", "0", "no", "nao", "não"].includes(normalized)) return false;
  }
  return null;
}

function extractFinancialRows(payload: unknown): FinancialRecord[] {
  if (Array.isArray(payload)) return payload.filter(Boolean) as FinancialRecord[];

  const candidates = [
    "items",
    "summaries",
    "client_summaries",
    "clientSummaries",
    "clients",
    "rows",
    "data.items",
    "data.summaries",
    "data.clients",
    "data.rows",
    "data",
  ];
  for (const path of candidates) {
    const value = readPath(payload, path);
    if (Array.isArray(value)) return value.filter(Boolean) as FinancialRecord[];
  }
  return [];
}

function normalizePricingMode(record: FinancialRecord, planName: string | null) {
  const rawMode = firstString(record, [
    "pricing_mode",
    "pricingMode",
    "price_source",
    "priceSource",
    "plan_link_mode",
    "planLinkMode",
    "contract_mode",
  ])?.toLowerCase();
  const isCustom = firstBoolean(record, [
    "is_custom_pricing",
    "isCustomPricing",
    "custom_price",
    "customPrice",
  ]);
  const isLinked = firstBoolean(record, [
    "is_plan_linked",
    "isPlanLinked",
    "linked_to_plan",
    "linkedToPlan",
  ]);

  if (isCustom || rawMode?.includes("custom") || rawMode?.includes("personal")) return "custom";
  if (isLinked || rawMode?.includes("link") || rawMode?.includes("plan") || rawMode?.includes("version")) return "linked";
  return planName && isCustom === false ? "linked" : null;
}

function formatDueLabel(record: FinancialRecord) {
  const dueDay = firstNumber(record, ["due_day", "dueDay", "billing_day", "billingDay"]);
  if (dueDay != null && dueDay >= 1 && dueDay <= 31) return `Dia ${Math.trunc(dueDay)}`;

  const rawDate = firstString(record, [
    "next_due_date",
    "nextDueDate",
    "due_date",
    "dueDate",
    "competence_due_date",
    "competenceDueDate",
  ]);
  if (!rawDate) return null;

  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
    ? new Date(`${rawDate}T00:00:00`)
    : new Date(rawDate);
  return Number.isNaN(parsed.getTime()) ? rawDate : parsed.toLocaleDateString("pt-BR");
}

function normalizeMarginPercent(value: number | null) {
  if (value == null) return null;
  return Math.abs(value) <= 1 ? value * 100 : value;
}

function normalizeClientFinancial(record: FinancialRecord): ClientFinancialView | null {
  const clientId = firstString(record, [
    "client_id",
    "clientId",
    "profile_id",
    "profileId",
    "customer_id",
    "customerId",
    "id",
  ]);
  if (!clientId) return null;

  const planName = firstString(record, [
    "plan_name",
    "planName",
    "plan_version_name",
    "planVersionName",
    "plan.name",
    "plan_version.plan.name",
    "planVersion.plan.name",
    "subscription.plan_name",
    "subscription.planName",
    "subscription.plan_version.plan.name",
  ]);
  const operationalAmount = firstNumber(record, [
    "operational_amount",
    "operationalAmount",
    "operational_value",
    "operationalValue",
    "monthly_operational_amount",
    "monthlyOperationalAmount",
    "mrr_operational",
    "operational_mrr",
    "operational_revenue",
    "operationalRevenue",
  ]);
  const finalAmount = firstNumber(record, [
    "final_amount",
    "finalAmount",
    "final_value",
    "finalValue",
    "monthly_final_amount",
    "monthlyFinalAmount",
    "mrr_final",
    "final_mrr",
    "gross_amount",
    "grossAmount",
    "billing_amount",
    "billingAmount",
  ]);
  const billingPeriod = firstString(record, [
    "billing_period",
    "billingPeriod",
    "raw.billing_period",
  ])?.toLowerCase() || null;
  const periodMonths: Record<string, number> = {
    monthly: 1,
    bimonthly: 2,
    quarterly: 3,
    semiannual: 6,
    annual: 12,
  };
  const divisor = periodMonths[billingPeriod || "monthly"] || 1;
  const planAmount = firstNumber(record, [
    "plan_amount",
    "planAmount",
    "monthly_operational_amount",
    "monthlyOperationalAmount",
    "raw.plan_amount",
  ]) ?? (operationalAmount == null ? null : operationalAmount / divisor);
  const finalPlanAmount = firstNumber(record, [
    "final_plan_amount",
    "finalPlanAmount",
    "monthly_final_amount",
    "monthlyFinalAmount",
    "raw.final_plan_amount",
  ]) ?? (finalAmount == null ? null : finalAmount / divisor);
  const directCost = firstNumber(record, [
    "direct_cost",
    "directCost",
    "direct_cost_amount",
    "directCostAmount",
    "direct_costs",
    "directCosts",
    "estimated_direct_cost",
    "estimatedDirectCost",
  ]);
  const explicitMargin = normalizeMarginPercent(firstNumber(record, [
    "contribution_margin_percent",
    "contributionMarginPercent",
    "managerial_margin_percent",
    "managerialMarginPercent",
    "direct_margin_percent",
    "directMarginPercent",
    "margin_percent",
    "marginPercent",
  ]));
  const calculatedMargin = operationalAmount != null && operationalAmount !== 0 && directCost != null
    ? ((operationalAmount - directCost) / operationalAmount) * 100
    : null;
  const billingStatus = firstString(record, [
    "billing_status",
    "billingStatus",
    "payment_status",
    "paymentStatus",
    "receivable_status",
    "receivableStatus",
    "latest_charge.status",
    "latestCharge.status",
  ]);
  const receivableAmount = firstNumber(record, [
    "receivable_amount",
    "receivableAmount",
    "amount_receivable",
    "amountReceivable",
    "accounts_receivable",
    "accountsReceivable",
    "outstanding_amount",
    "outstandingAmount",
    "open_amount",
    "openAmount",
    "pending_amount",
    "pendingAmount",
  ]);
  const explicitOverdue = firstNumber(record, [
    "overdue_amount",
    "overdueAmount",
    "delinquent_amount",
    "delinquentAmount",
    "late_amount",
    "lateAmount",
  ]);
  const normalizedStatus = billingStatus?.toLowerCase() || "";
  const isOverdue = ["overdue", "late", "delinquent", "atrasado", "inadimplente"].some((status) => normalizedStatus.includes(status));
  const estimateSource = firstString(record, ["direct_cost_source", "directCostSource"])?.toLowerCase();

  return {
    clientId,
    planName,
    pricingMode: normalizePricingMode(record, planName),
    operationalAmount,
    finalAmount,
    planAmount,
    finalPlanAmount,
    billingPeriod,
    termStatus: firstString(record, [
      "term_status",
      "termStatus",
      "raw.status",
      "subscription.status",
    ]),
    reviewRequired: firstBoolean(record, [
      "review_required",
      "reviewRequired",
      "raw.review_required",
    ]) ?? false,
    directCost,
    directCostEstimated: firstBoolean(record, [
      "direct_cost_estimated",
      "directCostEstimated",
      "is_direct_cost_estimated",
      "isDirectCostEstimated",
      "is_estimated",
      "isEstimated",
    ]) ?? estimateSource === "estimated",
    marginPercent: explicitMargin ?? calculatedMargin,
    dueLabel: formatDueLabel(record),
    billingStatus,
    receivableAmount,
    overdueAmount: explicitOverdue ?? (isOverdue ? receivableAmount : null),
    raw: record,
  };
}

function financialStatusMeta(status: string | null) {
  const normalized = status?.toLowerCase().trim() || "";
  if (["current", "active", "em_dia"].includes(normalized)) {
    return { label: "Em dia", className: "border-success/30 bg-success/10 text-success" };
  }
  if (["review_required", "needs_review", "draft"].includes(normalized)) {
    return { label: "Revisar", className: "border-warning/30 bg-warning/10 text-warning" };
  }
  if (["paused", "standby", "pausado"].includes(normalized)) {
    return { label: "Pausado", className: "border-border bg-secondary text-muted-foreground" };
  }
  if (["paid", "received", "completed", "pago", "recebido"].includes(normalized)) {
    return { label: "Recebido", className: "border-success/30 bg-success/10 text-success" };
  }
  if (["partial", "partially_paid", "parcial"].includes(normalized)) {
    return { label: "Parcial", className: "border-warning/30 bg-warning/10 text-warning" };
  }
  if (["overdue", "late", "delinquent", "atrasado", "inadimplente"].includes(normalized)) {
    return { label: "Inadimplente", className: "border-destructive/30 bg-destructive/10 text-destructive" };
  }
  if (["cancelled", "canceled", "reversed", "cancelado", "estornado"].includes(normalized)) {
    return { label: "Cancelado", className: "border-border bg-secondary text-muted-foreground" };
  }
  if (["pending", "open", "expected", "scheduled", "pendente", "aberto", "previsto"].includes(normalized)) {
    return { label: "A receber", className: "border-warning/30 bg-warning/10 text-warning" };
  }
  return { label: status || "Sem cobrança", className: "border-border bg-secondary/60 text-muted-foreground" };
}

function formatCurrency(value: number | null) {
  return value == null ? "-" : currencyFormatter.format(value);
}

function formatPercent(value: number | null) {
  return value == null ? "-" : `${percentFormatter.format(value)}%`;
}

export default function Clients() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isAdmin = profile?.role === "admin";
  const { data: clients, isLoading, isError, refetch } = useClients();

  const toggleOneOffDone = async (client: any, done: boolean) => {
    const nextConfig = { ...(client.services_config || {}), one_off_done: done };
    const { error } = await supabase
      .from("profiles")
      .update({ services_config: nextConfig })
      .eq("id", client.id);
    if (error) {
      toast.error("Não foi possível atualizar o cliente.");
      return;
    }
    toast.success(done ? "Avulso marcado como concluído." : "Avulso retomado.");
    refetch();
  };
  const clientRows = useMemo(() => (clients || []) as ClientRecord[], [clients]);
  const financialQuery = useClientFinancialSummaries();
  const financialPayload = financialQuery.data;
  const financialLoading = financialQuery.isLoading || financialQuery.isPending;
  const financialError = financialQuery.isError;
  const [createOpen, setCreateOpen] = useState(false);
  const [editClient, setEditClient] = useState<ClientRecord | null>(null);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [tab, setTab] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [showDoneOneOffs, setShowDoneOneOffs] = useState(false);
  const [serviceFilter, setServiceFilter] = useState("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const requestedClientId = searchParams.get("client");
    if (!requestedClientId || !clientRows.length) return;
    const requestedClient = clientRows.find((client) => client.id === requestedClientId);
    if (requestedClient) setEditClient(requestedClient);
  }, [clientRows, searchParams]);

  const closeClientDrawer = () => {
    setEditClient(null);
    if (
      !searchParams.has("client") &&
      !searchParams.has("project") &&
      !searchParams.has("section")
    ) return;
    const next = new URLSearchParams(searchParams);
    next.delete("client");
    next.delete("project");
    next.delete("section");
    setSearchParams(next, { replace: true });
  };

  const searchTerm = normalizeSearch(search);
  const searching = searchTerm.length > 0;

  const filtered = clientRows.filter((c) => {
    const status = c.plan_status || "active";
    if (tab !== "all" && status !== tab) return false;
    if (typeFilter !== "all" && (c.client_type || "recurring") !== typeFilter) return false;
    if (serviceFilter !== "all" && !(c as any).services_config?.[serviceFilter]) return false;

    if (searching) {
      const searchable = normalizeSearch([
        c.company_name,
        c.full_name,
        c.email,
        c.phone,
      ].filter(Boolean).join(" "));
      const searchedDigits = search.replace(/\D/g, "");
      const phoneDigits = String(c.phone || "").replace(/\D/g, "");
      const matchesPhone = searchedDigits.length > 0 && phoneDigits.includes(searchedDigits);
      if (!searchable.includes(searchTerm) && !matchesPhone) return false;
    }
    return true;
  });

  // Separação para a lista: clientes de verdade (recorrentes + híbridos),
  // avulsos em seção própria e empresas do grupo fora da contagem.
  const principais = filtered.filter((c) => !isInternalClient(c) && (c.client_type || "recurring") !== "one_off");
  const avulsosAll = filtered.filter((c) => !isInternalClient(c) && (c.client_type || "recurring") === "one_off");
  // Avulso entregue sai da lista viva para nao poluir; fica num grupo
  // recolhido com opcao de retomar. Flag no proprio cadastro, sem migration.
  const isOneOffDone = (c: any) => Boolean(c?.services_config?.one_off_done);
  const avulsosList = avulsosAll.filter((c) => !isOneOffDone(c));
  const avulsosDone = avulsosAll.filter((c) => isOneOffDone(c));
  const internasList = filtered.filter((c) => isInternalClient(c));

  const financialRows = useMemo(
    () => extractFinancialRows(financialPayload),
    [financialPayload],
  );
  const financialViews = useMemo(
    () => financialRows.map(normalizeClientFinancial).filter(Boolean) as ClientFinancialView[],
    [financialRows],
  );
  const financialByClient = useMemo(
    () => new Map(financialViews.map((summary) => [summary.clientId, summary])),
    [financialViews],
  );
  const clientsById = useMemo(
    () => new Map(clientRows.map((client) => [String(client.id), client])),
    [clientRows],
  );
  const recurringFinancialViews = financialViews.filter((summary) => {
    const client = clientsById.get(summary.clientId);
    if (client && isInternalClient(client)) return false;
    const status = String(
      client?.plan_status
      ?? firstString(summary.raw, ["client_status", "clientStatus", "contract_status", "contractStatus"])
      ?? "active",
    ).toLowerCase();
    const clientType = String(
      client?.client_type
      ?? firstString(summary.raw, ["client_type", "clientType", "contract_type", "contractType"])
      ?? "recurring",
    ).toLowerCase();
    const termStatus = String(summary.termStatus || "").toLowerCase();
    return status === "active"
      && clientType !== "one_off"
      && termStatus === "active"
      && !summary.reviewRequired;
  });
  // KPIs calculados da MESMA fonte real do Financeiro (mensalistas + cobranças),
  // para os cards ficarem sempre sincronizados com a operação.
  const { data: kpiBilling } = useBilling();
  const { data: kpiPayments } = useQuery({
    queryKey: ["all-project-payments-finance"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_payments")
        .select("*, project:projects!project_payments_project_id_fkey(name, project_type, billing_mode, brand), client:profiles!project_payments_client_id_fkey(full_name, company_name, client_type, brand), installments:payment_installments(*)");
      if (error) throw error;
      return data || [];
    },
    enabled: isAdmin,
  });

  // Contagem oficial: só recorrentes + híbridos ativos. Avulsos e empresas do
  // grupo não entram (aparecem em seções próprias na lista).
  const activeClientCount = clientRows.filter(
    (client) =>
      (client.plan_status || "active") === "active" &&
      (client.client_type || "recurring") !== "one_off" &&
      !isInternalClient(client)
  ).length;

  // Mensalistas = MRR. Faturamento bruto = soma cobrada; operacional = após a
  // reserva tributária (alíquota do plano no catálogo, senão 6% ilustrativa).
  const payingClients = clientRows.filter(
    (client) =>
      (client.plan_status || "active") === "active" &&
      (client.client_type || "recurring") !== "one_off" &&
      !isInternalClient(client) &&
      Number((client as any).plan_value) > 0
  );
  const grossBilling = payingClients.reduce((sum, client) => sum + Number((client as any).plan_value || 0), 0);

  const kpiToday = parseAppDate(todayBR());
  const kpiInThisMonth = (value?: string | null) => {
    const d = parseAppDate(value || "");
    return !!d && !!kpiToday && d.getMonth() === kpiToday.getMonth() && d.getFullYear() === kpiToday.getFullYear();
  };
  const kpiReceivedOf = (row: any) => {
    const total = Number(row?.amount) || 0;
    const paid = Number(row?.paid_amount) || 0;
    if (row?.status === "partial") return Math.min(paid, total);
    if (row?.status === "paid") return paid > 0 && paid < total ? paid : total;
    return 0;
  };
  const kpiPausedIds = new Set(
    clientRows
      .filter((client) => client.plan_status === "standby" || client.plan_status === "inactive" || isInternalClient(client))
      .map((client) => client.id)
  );
  const kpiPendingBills = (kpiBilling || []).filter(
    (b: any) =>
      b.status === "pending" &&
      b.type !== "ads_recharge" &&
      !(b.type === "renewal" && kpiPausedIds.has(b.client_id))
  );
  const installmentRemaining = (i: any) => Math.max((Number(i.amount) || 0) - (Number(i.paid_amount) || 0), 0);
  const kpiPendingInstallments = (kpiPayments || []).flatMap((pp: any) =>
    (pp.installments || []).filter((i: any) => i.status === "pending" || i.status === "partial")
  );

  // Recebido REAL no mês corrente (mensalidades + parcelas de projetos)
  const receivedMonthBills = (kpiBilling || [])
    .filter((b: any) => (b.status === "paid" || b.status === "partial") && b.type !== "ads_recharge" && kpiInThisMonth(b.paid_date || b.due_date))
    .reduce((sum: number, b: any) => sum + kpiReceivedOf(b), 0);
  const receivedMonthInstallments = (kpiPayments || []).reduce(
    (sum: number, pp: any) =>
      sum +
      (pp.installments || [])
        .filter((i: any) => (i.status === "paid" || i.status === "partial") && kpiInThisMonth(i.paid_date || i.due_date))
        .reduce((s: number, i: any) => s + kpiReceivedOf(i), 0),
    0
  );
  const receivedThisMonth = receivedMonthBills + receivedMonthInstallments;

  // A receber DENTRO DO MÊS, especificando o que compõe o valor
  const receivableBillsMonth = kpiPendingBills
    .filter((b: any) => kpiInThisMonth(b.due_date))
    .reduce((sum: number, b: any) => sum + Number(b.amount || 0), 0);
  const receivableInstallmentsMonth = kpiPendingInstallments
    .filter((i: any) => kpiInThisMonth(i.due_date))
    .reduce((sum: number, i: any) => sum + installmentRemaining(i), 0);
  const receivableTotal = receivableBillsMonth + receivableInstallmentsMonth;

  const overdueTotal =
    kpiPendingBills
      .filter((b: any) => {
        const due = parseAppDate(b.due_date);
        return !!due && !!kpiToday && due < kpiToday;
      })
      .reduce((sum: number, b: any) => sum + Number(b.amount || 0), 0) +
    kpiPendingInstallments
      .filter((i: any) => {
        const due = parseAppDate(i.due_date);
        return !!due && !!kpiToday && due < kpiToday;
      })
      .reduce((sum: number, i: any) => sum + installmentRemaining(i), 0);
  const kpiCards = [
    {
      label: "Clientes ativos",
      value: String(activeClientCount),
      helper: "recorrentes + híbridos",
      icon: Users,
      tone: "text-success",
      loading: isLoading,
    },
    {
      label: "MRR (mensalidades)",
      value: formatCurrency(grossBilling),
      helper: `soma real de ${payingClients.length} mensalista(s)`,
      icon: DollarSign,
      tone: "text-primary",
      loading: isLoading,
    },
    {
      label: "Recebido no mês",
      value: formatCurrency(receivedThisMonth),
      helper: `Mensalidades ${formatCurrency(receivedMonthBills)} · Projetos ${formatCurrency(receivedMonthInstallments)}`,
      icon: Receipt,
      tone: "text-success",
      loading: isLoading,
    },
    {
      label: "A receber no mês",
      value: formatCurrency(receivableTotal),
      helper: `Mensalidades ${formatCurrency(receivableBillsMonth)} · Projetos ${formatCurrency(receivableInstallmentsMonth)}`,
      icon: Wallet,
      tone: "text-warning",
      loading: isLoading,
    },
    {
      label: "Inadimplente",
      value: formatCurrency(overdueTotal),
      helper: "saldo vencido",
      icon: AlertCircle,
      tone: overdueTotal && overdueTotal > 0 ? "text-destructive" : "text-muted-foreground",
      loading: isLoading,
    },
  ];

  return (
    <div className="-mx-4 flex h-full min-h-0 flex-col animate-fade-in md:mx-0 md:block md:h-auto md:space-y-6">
      <div className="shrink-0 border-b border-border/60 bg-background/95 px-4 pb-3 backdrop-blur-sm md:border-b-0 md:bg-transparent md:px-0 md:pb-0 md:backdrop-blur-none">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="heading-page">Clientes</p>
        {isAdmin && (
          <div className="flex gap-2 flex-wrap justify-end">
            <button onClick={() => navigate("/ver-como-cliente")}
              className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full text-[12px] sm:text-[13px] text-muted-foreground border border-border hover:border-muted-foreground/50 hover:text-foreground transition-colors cursor-pointer bg-transparent">
              <Eye className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Ver como</span> Cliente
            </button>
            <button onClick={() => setBriefingOpen(true)}
              data-tour="clients-briefing-btn"
              className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full text-[12px] sm:text-[13px] text-muted-foreground border border-border hover:border-muted-foreground/50 hover:text-foreground transition-colors cursor-pointer bg-transparent">
              <Link2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Link</span> Briefing
            </button>
            <button
              onClick={() => setCreateOpen(true)}
              data-tour="clients-create-btn"
              className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full text-[12px] sm:text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Novo</span> Cliente
            </button>
          </div>
        )}
      </div>

      {isAdmin && (
        <section className="mt-4" aria-label="Resumo financeiro dos clientes">
          <div className="grid grid-flow-col auto-cols-[minmax(158px,1fr)] gap-2 overflow-x-auto pb-1 scrollbar-hidden md:grid-flow-row md:auto-cols-auto md:grid-cols-3 md:overflow-visible xl:grid-cols-5">
            {kpiCards.map((card) => {
              const Icon = card.icon;
              return (
                <div key={card.label} className="rounded-xl border border-border bg-card px-3 py-2.5 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      {card.label}
                    </p>
                    <Icon className={`h-3.5 w-3.5 shrink-0 ${card.tone}`} aria-hidden="true" />
                  </div>
                  {card.loading ? (
                    <div className="mt-2 h-5 w-24 animate-pulse rounded bg-secondary" aria-label={`Carregando ${card.label}`} />
                  ) : (
                    <p className={`mt-1 truncate font-mono text-base font-semibold ${card.tone}`}>{card.value}</p>
                  )}
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{card.helper}</p>
                </div>
              );
            })}
          </div>
          {financialError && (
            <p className="mt-1.5 flex items-center gap-1 text-[10px] text-warning" role="status">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              O resumo financeiro está temporariamente indisponível; os clientes continuam acessíveis.
            </p>
          )}
        </section>
      )}

      {/* Filtros: status, tipo e serviço contratado */}
      <div className="mt-4 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Filtrar por</p>
          <select
            value={serviceFilter}
            onChange={(event) => setServiceFilter(event.target.value)}
            aria-label="Filtrar clientes por serviço contratado"
            className="rounded-lg border border-border bg-secondary/50 px-3 py-1.5 text-[12px] text-foreground focus:outline-none focus:border-primary/50"
          >
            {SERVICE_FILTERS.map((service) => (
              <option key={service.value} value={service.value}>{service.label}</option>
            ))}
          </select>
          {(serviceFilter !== "all" || typeFilter !== "all" || tab !== "all") && (
            <button
              type="button"
              onClick={() => { setServiceFilter("all"); setTypeFilter("all"); setTab("all"); }}
              className="text-[11px] text-primary hover:opacity-80 cursor-pointer bg-transparent border-none"
            >
              Limpar filtros
            </button>
          )}
        </div>
      <div className="flex flex-nowrap items-center gap-2 overflow-x-auto scrollbar-hidden pb-1 md:flex-wrap md:overflow-visible md:pb-0">
        <div className="flex shrink-0 gap-1 bg-secondary/50 border border-border rounded-lg p-1 w-fit" role="group" aria-label="Filtrar clientes por status">
          {STATUS_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              aria-pressed={tab === t.value}
              className={`px-3 py-1.5 rounded-md text-[13px] transition-colors cursor-pointer border-none ${
                tab === t.value
                  ? "bg-background text-foreground font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground bg-transparent"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex shrink-0 gap-1 bg-secondary/50 border border-border rounded-lg p-1 w-fit" role="group" aria-label="Filtrar clientes por tipo">
          {TYPE_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTypeFilter(t.value)}
              aria-pressed={typeFilter === t.value}
              className={`px-3 py-1.5 rounded-md text-[12px] transition-colors cursor-pointer border-none ${
                typeFilter === t.value
                  ? "bg-background text-foreground font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground bg-transparent"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      </div>

      <div className="mt-3" data-tour="clients-search">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Digite o nome da empresa, contato, e-mail ou telefone"
            aria-label="Buscar cliente existente"
            className="h-11 w-full rounded-xl border border-border bg-card pl-10 pr-10 text-[16px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/60 md:text-sm"
          />
          {searching && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Limpar busca"
              title="Limpar busca"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg border-none bg-transparent p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <p aria-live="polite" className="mt-1.5 text-[11px] text-muted-foreground">
          {searching
            ? filtered.length === 1
              ? "1 cliente encontrado entre os clientes disponíveis."
              : `${filtered.length} clientes encontrados entre os clientes disponíveis.`
            : "Busque um cliente que já existe para abrir e conferir o cadastro. Você não precisa cadastrá-lo novamente."}
        </p>
      </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-4 md:overflow-visible md:px-0 md:pt-0 md:pb-0">
      {isError ? (
        <div className="py-8 text-center">
          <p className="text-sm text-destructive">Não foi possível carregar os clientes.</p>
          <p className="mt-1 text-xs text-muted-foreground">Não cadastre novamente agora, isso pode criar um cliente duplicado.</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-3 rounded-lg border border-border bg-transparent px-3 py-1.5 text-xs text-foreground hover:border-muted-foreground/50"
          >
            Tentar carregar novamente
          </button>
        </div>
      ) : isLoading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm text-muted-foreground">
            {searching
              ? `Nenhum cliente encontrado para "${search.trim()}".`
              : "Nenhum cliente encontrado com os filtros aplicados."}
          </p>
          {searching && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="mt-3 rounded-lg border border-border bg-transparent px-3 py-1.5 text-xs text-foreground hover:border-muted-foreground/50"
            >
              Limpar busca
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {(() => {
            const renderClientRow = (c: any) => {
            const financialRecord = financialByClient.get(String(c.id));
            const internal = isInternalClient(c);
            // Sem vinculo no financeiro v2, o cadastro ainda vale: deriva o
            // operacional do plano do perfil para a linha nunca ficar sem soma.
            const profileValue = Number((c as any).plan_value) || 0;
            const financial = financialRecord
              ? financialRecord
              : profileValue > 0 && !internal
                ? ({
                    clientId: String(c.id),
                    planName: c.plan_name || null,
                    pricingMode: null,
                    operationalAmount: profileValue * (1 - 0.06),
                    finalAmount: profileValue,
                    planAmount: profileValue,
                    finalPlanAmount: profileValue,
                    billingPeriod: null,
                    termStatus: null,
                    reviewRequired: false,
                    directCost: null,
                    directCostEstimated: false,
                    marginPercent: null,
                    dueLabel: null,
                    billingStatus: c.plan_status || null,
                    receivableAmount: null,
                    overdueAmount: null,
                    raw: {},
                  } as ClientFinancialView)
                : undefined;
            const planName = internal ? "Empresa do grupo" : (financial?.planName || c.plan_name || "Sem plano");
            const statusMeta = internal
              ? { label: "Interna", className: "border-info/30 bg-info/10 text-info" }
              : financialRecord
                ? financialStatusMeta(financialRecord.billingStatus)
                : financial
                  ? { label: "Valor do cadastro", className: "border-info/30 bg-info/10 text-info" }
                  : { label: "Não configurado", className: "border-border bg-secondary/60 text-muted-foreground" };
            const modeLabel = internal
              ? "Sem cobrança"
              : financial?.pricingMode === "linked"
                ? "Vinculado"
                : financial?.pricingMode === "custom"
                  ? "Personalizado"
                  : financial
                    ? "Sem vínculo"
                    : "Financeiro pendente";

            return (
              <div
                key={c.id}
                className="rounded-xl border border-border bg-card transition-colors hover:border-muted-foreground/30"
              >
                <button
                  type="button"
                  onClick={() => setEditClient(c)}
                  aria-label={`Abrir cadastro do cliente ${c.company_name || c.full_name}`}
                  aria-describedby={isAdmin ? `client-finance-${c.id}` : undefined}
                  className="flex w-full items-center gap-3 rounded-xl border-0 bg-transparent px-4 py-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 md:gap-4 md:px-5 md:py-4"
                >
                  <Avatar className="w-10 h-10 shrink-0">
                    {c.avatar_url && <AvatarImage src={c.avatar_url} alt={c.full_name} />}
                    <AvatarFallback className="bg-primary text-primary-foreground text-sm font-semibold">
                      {c.full_name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="truncate text-[15px] font-semibold leading-tight text-foreground">{c.company_name || c.full_name}</p>
                      {(searching || tab === "all") && (
                        <span className="inline-flex items-center rounded-md border border-border bg-secondary/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {statusLabel[c.plan_status || "active"] || "Sem status"}
                        </span>
                      )}
                      {(() => {
                        const t = typeBadge[c.client_type || "recurring"];
                        return t ? (
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-semibold uppercase tracking-wider border ${t.cls}`}>
                            {t.label}
                          </span>
                        ) : null;
                      })()}
                      {c.brand && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-semibold uppercase tracking-wider bg-foreground/5 text-muted-foreground border border-border">
                          {c.brand === "aceleriq" ? "AcelerIQ" : "SiteBolt"}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 truncate text-[11.5px] leading-relaxed text-muted-foreground">
                      {c.company_name && c.full_name ? `${c.full_name} · ` : ""}
                      {[c.email, c.phone].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {c.plan_renewal_date && (() => {
                    const status = getRenewalStatus(c.plan_renewal_date);
                    const isAlert = status?.level === "expired" || status?.level === "urgent";
                    return (
                      <TooltipProvider delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className={`text-right hidden md:flex items-center gap-1.5 px-2 py-1 rounded-lg border border-transparent ${isAlert ? status.bg : ""} ${status?.color || "text-muted-foreground"}`}>
                              {status?.icon ? (
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                              ) : (
                                <CalendarClock className="w-3.5 h-3.5 shrink-0" />
                              )}
                              <div>
                                <p className={`text-xs font-mono ${isAlert ? status.color : "text-foreground"}`}>
                                  {formatBRDate(c.plan_renewal_date)}
                                </p>
                                <p className="text-[10px]">renovação</p>
                              </div>
                            </div>
                          </TooltipTrigger>
                          {status?.label && (
                            <TooltipContent side="top">
                              <p className="text-xs">{status.label}</p>
                            </TooltipContent>
                          )}
                        </Tooltip>
                      </TooltipProvider>
                    );
                  })()}
                  <div className="text-right hidden md:block">
                    <p className="text-xs font-mono text-foreground">{c.projectCount}</p>
                    <p className="text-[10px] text-muted-foreground">projetos</p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                    <span className="hidden sm:inline">Abrir</span> <ChevronRight className="h-3.5 w-3.5" />
                  </span>
                  <span
                    role="img"
                    aria-label={`Status: ${statusLabel[c.plan_status || "active"] || "sem status"}`}
                    className={`w-2 h-2 rounded-full shrink-0 ${statusDot[c.plan_status || "active"] || "bg-muted-foreground"}`}
                  />
                </button>

                {isAdmin && (
                  <div id={`client-finance-${c.id}`} className="mx-4 mb-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border/60 pt-3 sm:grid-cols-3 xl:grid-cols-6 md:mx-5 md:mb-4">
                    <div className="col-span-2 min-w-0 sm:col-span-1">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Plano</p>
                      <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                        <p className="truncate text-xs font-medium text-foreground">{planName}</p>
                        <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide ${
                          financial?.pricingMode === "custom"
                            ? "border-warning/30 bg-warning/10 text-warning"
                            : financial?.pricingMode === "linked"
                              ? "border-primary/30 bg-primary/10 text-primary"
                              : "border-border bg-secondary/60 text-muted-foreground"
                        }`}>
                          {modeLabel}
                        </span>
                      </div>
                    </div>
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Operacional</p>
                      <p className="mt-0.5 font-mono text-xs font-medium text-foreground">
                        {formatCurrency(financial?.operationalAmount ?? null)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Final</p>
                      <p className="mt-0.5 font-mono text-xs font-medium text-foreground">
                        {formatCurrency(financial?.finalAmount ?? null)}
                      </p>
                    </div>
                    <div>
                      <div className="flex items-center gap-1">
                        <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Custo direto</p>
                        {financial?.directCostEstimated && (
                          <span className="rounded bg-warning/10 px-1 py-0.5 text-[7px] font-semibold uppercase tracking-wide text-warning">
                            Estimated
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 font-mono text-xs font-medium text-foreground">
                        {formatCurrency(financial?.directCost ?? null)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Margem</p>
                      <p className={`mt-0.5 font-mono text-xs font-semibold ${
                        financial?.marginPercent == null
                          ? "text-muted-foreground"
                          : financial.marginPercent < 0
                            ? "text-destructive"
                            : "text-success"
                      }`}>
                        {formatPercent(financial?.marginPercent ?? null)}
                      </p>
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Vencimento / status</p>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span className="font-mono text-xs text-foreground">{financial?.dueLabel || "-"}</span>
                        <span className={`rounded-md border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide ${statusMeta.className}`}>
                          {statusMeta.label}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
            };

            return (
              <>
                <div className="space-y-2 stagger-children">
                  {principais.map((c) => renderClientRow(c))}
                  {principais.length === 0 && (
                    <p className="py-3 text-center text-xs text-muted-foreground">Nenhum cliente recorrente ou híbrido nos filtros aplicados.</p>
                  )}
                </div>

                {avulsosList.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 px-1 pt-2 flex-wrap">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Avulsos ({avulsosList.length})</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        Total geral: {principais.length + avulsosList.length} clientes ({principais.length} recorrentes/híbridos + {avulsosList.length} avulsos)
                      </span>
                    </div>
                    <div className="space-y-2 text-[13px]">
                      {avulsosList.map((c) => renderClientRow(c))}
                    </div>
                    <div className="flex flex-wrap gap-1.5 px-1 pt-1">
                      {avulsosList.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => toggleOneOffDone(c, true)}
                          className="rounded-md border border-border bg-transparent px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:border-success/40 hover:text-success"
                        >
                          Concluir {c.company_name || c.full_name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {avulsosDone.length > 0 && (
                  <div className="space-y-1">
                    <button
                      type="button"
                      onClick={() => setShowDoneOneOffs((v) => !v)}
                      className="flex w-full items-center gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-left"
                    >
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Avulsos concluídos ({avulsosDone.length})
                      </span>
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {showDoneOneOffs ? "Recolher" : "Mostrar"}
                      </span>
                    </button>
                    {showDoneOneOffs && (
                      <div className="space-y-2 text-[13px] opacity-80">
                        {avulsosDone.map((c) => (
                          <div key={c.id} className="space-y-1">
                            {renderClientRow(c)}
                            <div className="px-1">
                              <button
                                type="button"
                                onClick={() => toggleOneOffDone(c, false)}
                                className="rounded-md border border-border bg-transparent px-2 py-1 text-[10px] text-primary transition-colors hover:border-primary/40"
                              >
                                Retomar cliente
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {internasList.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 px-1 pt-2 flex-wrap">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-info">Empresas do grupo ({internasList.length})</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">Organização interna · fora da contagem e das cobranças</span>
                    </div>
                    <div className="space-y-1">
                      {internasList.map((c) => renderClientRow(c))}
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}
      </div>

      {isAdmin && <CreateClientModal open={createOpen} onClose={() => setCreateOpen(false)} />}
      <EditClientDrawer
        open={!!editClient}
        onClose={closeClientDrawer}
        client={editClient}
        initialSection={searchParams.get("section") === "accounts" ? "accounts" : null}
        initialProjectId={searchParams.get("project")}
      />
      {isAdmin && <BriefingLinkModal open={briefingOpen} onClose={() => setBriefingOpen(false)} />}
    </div>
  );
}
