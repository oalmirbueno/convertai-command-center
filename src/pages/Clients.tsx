import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useClients } from "@/hooks/useSupabaseData";
import { useClientFinancialSummaries, useFinancePlans, useFinanceSettings } from "@/hooks/useFinanceV2";
import { useAuth } from "@/contexts/AuthContext";
import FotoDoCliente from "@/components/clients/FotoDoCliente";
import { useFotosDosClientes } from "@/hooks/useFotosDosClientes";
import {
  UserPlus,
  Link2,
  CalendarClock,
  AlertTriangle,
  Eye,
  Search,
  X,
  ChevronRight,
  MoreHorizontal,
  Users,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AjudaRecolhida,
  AreaDeTrabalho,
  CabecalhoDePagina,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  Painel,
  Secao,
  SeletorCompacto,
  botao,
  campo,
  etiqueta,
  juntar,
  texto,
  useEstadoDaTela,
} from "@/components/sistema";
import CreateClientModal from "@/components/admin/CreateClientModal";
import EditClientDrawer from "@/components/admin/EditClientDrawer";
import BriefingLinkModal from "@/components/admin/BriefingLinkModal";
import { formatBRDate, parseAppDate, todayBR } from "@/lib/dateBR";
import { isInternalClient } from "@/lib/clientFlags";
import { useBilling } from "@/hooks/useFinancialData";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { MenuDeContexto, type ItemDeMenu } from "@/components/ui/menu-de-contexto";
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
  { value: "all", label: "Todos os status" },
  { value: "active", label: "Ativos" },
  { value: "onboarding", label: "Em andamento" },
  { value: "standby", label: "Standby" },
  { value: "inactive", label: "Inativos" },
];

// Bolinha de status parada (nada piscando na lista).
const statusDot: Record<string, string> = {
  active: "bg-success",
  onboarding: "bg-warning",
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
  recurring: { label: "Recorrente", cls: "bg-primary/10 text-primary" },
  one_off: { label: "Avulso", cls: "bg-warning/10 text-warning" },
  hybrid: { label: "Híbrido", cls: "bg-accent/15 text-foreground" },
};

const validarOpcao = (opcoes: { value: string }[]) => (v: unknown) =>
  typeof v === "string" && opcoes.some((o) => o.value === v);

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
  if (["not_configured", "unconfigured", "none"].includes(normalized)) {
    return { label: "Definir cobrança", className: "border-border bg-secondary/60 text-muted-foreground" };
  }
  return { label: status ? "Revisar cobrança" : "Sem cobrança", className: "border-border bg-secondary/60 text-muted-foreground" };
}

function formatCurrency(value: number | null) {
  if (value == null || value === 0) return "-";
  return currencyFormatter.format(value);
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
  // A cara de cada cliente: cadastro, senao Instagram (como em /metricas), senao a logo dos arquivos.
  const clientesParaFoto = useMemo(() => ((clients ?? []) as any[]).map((c) => ({ id: String(c.id), nome: c.company_name || c.full_name, avatar_url: c.avatar_url })), [clients]);
  const { fotoDe } = useFotosDosClientes(clientesParaFoto);

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
  // Preço oficial dos planos: é o desempate quando o cadastro tem o plano mas
  // nenhum valor preenchido (o caso do "Sem vínculo" com tudo zerado).
  const { data: financePlans } = useFinancePlans();
  // Custo direto padrão do Financeiro: quando o cliente ainda não tem custo
  // real cadastrado, a linha usa a estimativa oficial em vez de ficar em "-".
  const { data: financeSettings } = useFinanceSettings();
  const defaultDirectCost = Number(financeSettings?.defaultDirectCost) || 275;
  const normalizePlanName = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/^plano\s+/, "")
      .trim();
  const planByName = useMemo(() => {
    const map = new Map<string, any>();
    for (const plan of financePlans || []) {
      if (plan?.name) map.set(normalizePlanName(plan.name), plan);
    }
    return map;
  }, [financePlans]);
  const planVersionById = useMemo(() => {
    const map = new Map<string, any>();
    for (const plan of financePlans || []) {
      for (const version of plan?.versions || []) map.set(version.id, version);
    }
    return map;
  }, [financePlans]);

  // O caso real do "escolhi o plano e coloquei outro valor e não puxou": o
  // valor vive no TERMO do cliente (financeiro v2). Quando o resumo oficial
  // não devolve a linha, lemos o termo direto, para o valor digitado nunca
  // sumir da lista.
  const { data: rawClientTerms } = useQuery({
    queryKey: ["clients-terms-fallback"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_client_terms")
        .select("client_id, status, pricing_mode, operational_amount, final_amount, direct_cost_amount, direct_cost_estimated, billing_period, plan_version_id, ends_on");
      if (error) return [];
      return data || [];
    },
    enabled: isAdmin,
    staleTime: 30_000,
  });
  const termByClient = useMemo(() => {
    // Termo vigente ganha de encerrado; ativo ganha de rascunho. Antes um
    // termo com ends_on preenchido sumia da lista e o cliente ficava zerado.
    const termScore = (term: any) =>
      (term.status === "active" ? 2 : 0) + (term.ends_on ? 0 : 1);
    const map = new Map<string, any>();
    for (const term of rawClientTerms || []) {
      if (!term.client_id) continue;
      const current = map.get(term.client_id);
      if (!current || termScore(term) > termScore(current)) {
        map.set(term.client_id, term);
      }
    }
    return map;
  }, [rawClientTerms]);
  const financialPayload = financialQuery.data;
  const financialLoading = financialQuery.isLoading || financialQuery.isPending;
  const financialError = financialQuery.isError;
  const [createOpen, setCreateOpen] = useState(false);
  const [editClient, setEditClient] = useState<ClientRecord | null>(null);

  /** Botão direito na linha do cliente: abrir e copiar os contatos. */
  const [menuCliente, setMenuCliente] = useState<{ x: number; y: number; cliente: any } | null>(null);

  function itensDoCliente(c: any): ItemDeMenu[] {
    const copiar = (rotulo: string, valor: string) => () => {
      void navigator.clipboard
        .writeText(valor)
        .then(() => toast.success(`${rotulo} copiado.`))
        .catch(() => toast.error("Não foi possível copiar."));
    };
    const itens: ItemDeMenu[] = [
      { rotulo: "Abrir cadastro", acao: () => setEditClient(c) },
      { separador: true },
      { rotulo: "Copiar nome", acao: copiar("Nome", c.company_name || c.full_name || "") },
    ];
    if (isAdmin && !isInternalClient(c)) {
      itens.splice(1, 0, { rotulo: "Cobrança e custo no Financeiro", acao: () => navigate("/financeiro") });
    }
    if (c.email) itens.push({ rotulo: "Copiar e-mail", acao: copiar("E-mail", c.email) });
    if (c.phone) itens.push({ rotulo: "Copiar telefone", acao: copiar("Telefone", c.phone) });
    if (c.phone) {
      itens.push({
        rotulo: "Abrir WhatsApp",
        acao: () => window.open(`https://wa.me/${String(c.phone).replace(/\D/g, "")}`, "_blank", "noopener,noreferrer"),
      });
    }
    if (!isInternalClient(c) && (c.client_type || "recurring") === "one_off") {
      const concluido = Boolean(c?.services_config?.one_off_done);
      itens.push({ separador: true });
      itens.push({
        rotulo: concluido ? "Retomar cliente" : "Marcar avulso como concluído",
        acao: () => void toggleOneOffDone(c, !concluido),
      });
    }
    return itens;
  }
  const [briefingOpen, setBriefingOpen] = useState(false);
  // Filtros, busca e o grupo de avulsos concluídos ficam lembrados ao sair e voltar.
  const [tab, setTab] = useEstadoDaTela("filtro:status", "all", { validar: validarOpcao(STATUS_TABS) });
  const [typeFilter, setTypeFilter] = useEstadoDaTela("filtro:tipo", "all", { validar: validarOpcao(TYPE_TABS) });
  const [showDoneOneOffs, setShowDoneOneOffs] = useEstadoDaTela("avulsos-concluidos", false, { validar: (v) => typeof v === "boolean" });
  const [serviceFilter, setServiceFilter] = useEstadoDaTela("filtro:servico", "all", { validar: validarOpcao(SERVICE_FILTERS) });
  const [search, setSearch] = useEstadoDaTela("busca", "", { validar: (v) => typeof v === "string" });

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
    if (typeFilter !== "all") {
      const type = c.client_type || "recurring";
      // Híbrido também é recorrente (mensalidade + avulsos por cima), então o
      // filtro Recorrentes inclui os dois; o filtro Híbridos segue exclusivo.
      const matchesType = typeFilter === "recurring" ? type !== "one_off" : type === typeFilter;
      if (!matchesType) return false;
    }
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

  // Leitura simples da cobrança de CADA cliente na lista: Atrasado ganha de
  // A receber, que ganha de Em dia. É a mesma fonte real dos KPIs (billing),
  // sem os termos internos do Financeiro (rascunho/revisar) que só confundiam.
  const billingReadByClient = new Map<
    string,
    { tone: "late" | "due" | "paid"; label: string; detail: string }
  >();
  for (const bill of (kpiBilling || []) as any[]) {
    if (!bill?.client_id || bill.type === "ads_recharge") continue;
    const clientKey = String(bill.client_id);
    const due = parseAppDate(bill.due_date);
    const pendingLike = bill.status === "pending" || bill.status === "partial";
    const current = billingReadByClient.get(clientKey);
    if (pendingLike && due && kpiToday && due < kpiToday) {
      if (current?.tone !== "late") {
        billingReadByClient.set(clientKey, {
          tone: "late",
          label: "Atrasado",
          detail: `Venceu ${formatBRDate(bill.due_date)}`,
        });
      }
      continue;
    }
    if (current?.tone === "late") continue;
    if (pendingLike && kpiInThisMonth(bill.due_date)) {
      billingReadByClient.set(clientKey, {
        tone: "due",
        label: "A receber",
        detail: `Vence ${formatBRDate(bill.due_date)}`,
      });
      continue;
    }
    if (current) continue;
    if (bill.status === "paid" && kpiInThisMonth(bill.paid_date || bill.due_date)) {
      billingReadByClient.set(clientKey, {
        tone: "paid",
        label: "Em dia",
        detail: `Pago em ${formatBRDate(bill.paid_date || bill.due_date)}`,
      });
    }
  }

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
      tone: "text-success",
      loading: isLoading,
    },
    {
      label: "MRR (mensalidades)",
      value: formatCurrency(grossBilling),
      helper: `soma real de ${payingClients.length} mensalista(s)`,
      tone: "text-primary",
      loading: isLoading,
    },
    {
      label: "Recebido no mês",
      value: formatCurrency(receivedThisMonth),
      helper: `Mensalidades ${formatCurrency(receivedMonthBills)} · Projetos ${formatCurrency(receivedMonthInstallments)}`,
      tone: "text-success",
      loading: isLoading,
    },
    {
      label: "A receber no mês",
      value: formatCurrency(receivableTotal),
      helper: `Mensalidades ${formatCurrency(receivableBillsMonth)} · Projetos ${formatCurrency(receivableInstallmentsMonth)}`,
      tone: "text-warning",
      loading: isLoading,
    },
    {
      label: "Inadimplente",
      value: formatCurrency(overdueTotal),
      helper: "saldo vencido",
      tone: overdueTotal && overdueTotal > 0 ? "text-destructive" : "text-muted-foreground",
      loading: isLoading,
    },
  ];

  const filtrosAtivos = serviceFilter !== "all" || typeFilter !== "all" || tab !== "all";
  const abrirMenuNoBotao = (e: { currentTarget: HTMLElement }, cliente: any) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenuCliente({ x: Math.max(8, r.right - 220), y: r.bottom + 4, cliente });
  };

  /** Uma linha da lista: identificação, renovação, projetos e (admin) o financeiro numa faixa só. */
  const renderClientRow = (c: any, extra?: { acao?: ReactNode; apagado?: boolean }) => {
    const financialRecord = financialByClient.get(String(c.id));
    const internal = isInternalClient(c);
    // Sem vinculo no financeiro v2, o cadastro ainda vale: deriva o
    // operacional do plano do perfil para a linha nunca ficar sem soma.
    const profileValue = Number((c as any).plan_value) || 0;
    // Regra de ouro: cada degrau só ganha se tiver VALOR de verdade.
    // Um vínculo vazio no resumo oficial (o caso Acerbi: híbrido com
    // linha zerada) não pode esconder o valor que existe no termo, no
    // cadastro ou no catálogo de planos.
    const recordValue =
      Number(financialRecord?.operationalAmount) || Number(financialRecord?.finalAmount) || 0;
    // Degrau 1.5: o termo do cliente lido direto (o valor que a equipe
    // digitou ao escolher o plano mora aqui e não pode sumir).
    const directTerm = !internal ? termByClient.get(String(c.id)) : null;
    const termVersion = directTerm?.plan_version_id
      ? planVersionById.get(directTerm.plan_version_id)
      : null;
    const termOperational =
      Number(directTerm?.operational_amount) || Number(termVersion?.amount) || 0;
    // Último degrau (o bug do "tudo zerado"): cadastro tem o PLANO
    // mas nenhum valor. O preço oficial do plano no Financeiro vale.
    const matchedPlan =
      !internal && c.plan_name
        ? planByName.get(normalizePlanName(String(c.plan_name)))
        : null;
    const matchedVersion = matchedPlan?.currentVersion || matchedPlan?.versions?.[0] || null;
    const matchedAmount =
      Number(matchedVersion?.amount) || Number(matchedVersion?.finalAmount) || 0;
    const financial = financialRecord && recordValue > 0
      ? financialRecord
      : directTerm && termOperational > 0
        ? ({
            clientId: String(c.id),
            planName: c.plan_name || null,
            pricingMode:
              directTerm.pricing_mode === "linked" || directTerm.pricing_mode === "custom"
                ? directTerm.pricing_mode
                : null,
            operationalAmount: termOperational,
            finalAmount: Number(directTerm.final_amount) || termOperational,
            planAmount: termOperational,
            finalPlanAmount: Number(directTerm.final_amount) || termOperational,
            billingPeriod: directTerm.billing_period || null,
            termStatus: directTerm.status || null,
            reviewRequired: false,
            directCost: Number(directTerm.direct_cost_amount) || null,
            directCostEstimated: !!directTerm.direct_cost_estimated,
            marginPercent:
              termOperational > 0 && Number(directTerm.direct_cost_amount) > 0
                ? ((termOperational - Number(directTerm.direct_cost_amount)) / termOperational) * 100
                : null,
            dueLabel: null,
            billingStatus: c.plan_status || null,
            receivableAmount: null,
            overdueAmount: null,
            raw: {},
          } as ClientFinancialView)
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
        : matchedAmount > 0
          ? ({
              clientId: String(c.id),
              planName: matchedPlan.name,
              pricingMode: null,
              operationalAmount: matchedVersion.amount ?? null,
              finalAmount: matchedVersion.finalAmount ?? matchedVersion.amount ?? null,
              planAmount: matchedVersion.amount ?? null,
              finalPlanAmount: matchedVersion.finalAmount ?? matchedVersion.amount ?? null,
              billingPeriod: matchedVersion.billingPeriod || null,
              termStatus: null,
              reviewRequired: false,
              directCost: matchedVersion.directCost ?? null,
              directCostEstimated: !!matchedVersion.directCostEstimated,
              marginPercent:
                matchedVersion.amount && matchedVersion.directCost != null
                  ? ((matchedVersion.amount - matchedVersion.directCost) / matchedVersion.amount) * 100
                  : null,
              dueLabel: null,
              billingStatus: c.plan_status || null,
              receivableAmount: null,
              overdueAmount: null,
              raw: {},
            } as ClientFinancialView)
          // Vínculo existe mas está sem valor: mantém a linha oficial
          // (vencimento/status) em vez de fingir que não há financeiro.
          : financialRecord || undefined;
    const planName = internal ? "Empresa do grupo" : (financial?.planName || c.plan_name || "Sem plano");
    // Leitura da cobrança em uma frase, sem jargão interno: primeiro
    // a verdade do billing (Atrasado / A receber / Em dia); sem
    // cobrança no mês, diz isso com todas as letras.
    const billingRead = internal ? null : billingReadByClient.get(String(c.id));
    const statusMeta = internal
      ? { label: "Interna", className: "border-info/30 bg-info/10 text-info" }
      : billingRead
        ? {
            label: billingRead.label,
            className:
              billingRead.tone === "late"
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : billingRead.tone === "due"
                  ? "border-warning/30 bg-warning/10 text-warning"
                  : "border-success/30 bg-success/10 text-success",
          }
        : (c.client_type || "recurring") === "one_off"
          ? { label: "Por projeto", className: "border-border bg-secondary/60 text-muted-foreground" }
          : financial
            ? { label: "Sem cobrança este mês", className: "border-border bg-secondary/60 text-muted-foreground" }
            : { label: "Sem cobrança criada", className: "border-border bg-secondary/60 text-muted-foreground" };
    // O selo conta de ONDE o valor veio, na ordem real dos degraus.
    const priceSource =
      financialRecord && recordValue > 0
        ? "official"
        : directTerm && termOperational > 0
          ? "term"
          : profileValue > 0 && !internal
            ? "profile"
            : matchedAmount > 0
              ? "plan"
              : "none";
    const modeLabel = internal
      ? "Sem cobrança"
      : financial?.pricingMode === "linked"
        ? "Vinculado"
        : financial?.pricingMode === "custom"
          ? "Personalizado"
          : priceSource === "plan"
            ? "Preço do plano"
            : priceSource === "profile"
              ? "Valor do cadastro"
              : priceSource === "official" || priceSource === "term"
                ? "Valor do financeiro"
                : financial
                  ? "Definir valor"
                  : "Financeiro pendente";
    // Fechamento da linha: custo e margem SEMPRE somam, igual para
    // todos. Sem custo real cadastrado, entra a estimativa (custo do
    // plano no catálogo, senão o padrão do Financeiro).
    const rowOperational =
      Number(financial?.operationalAmount) || Number(financial?.finalAmount) || 0;
    const realCost = Number(financial?.directCost) || 0;
    const estimatedCost = Number(matchedVersion?.directCost) || defaultDirectCost;
    const displayCost = internal
      ? null
      : realCost > 0
        ? realCost
        : rowOperational > 0
          ? estimatedCost
          : null;
    const costIsEstimate =
      !internal && displayCost != null && (realCost <= 0 || !!financial?.directCostEstimated);
    const displayMargin =
      financial?.marginPercent != null
        ? financial.marginPercent
        : rowOperational > 0 && displayCost != null
          ? ((rowOperational - displayCost) / rowOperational) * 100
          : null;


    const nome = c.company_name || c.full_name;
    const status = getRenewalStatus(c.plan_renewal_date);
    const renovacaoEmAlerta = status?.level === "expired" || status?.level === "urgent";
    const tipo = typeBadge[c.client_type || "recurring"];
    const origemDoValor =
      priceSource === "official"
        ? "Valores vêm da cobrança oficial do Financeiro."
        : priceSource === "term"
          ? "Valores vêm do termo do cliente no Financeiro."
          : priceSource === "profile"
            ? "Valor digitado no cadastro do cliente."
            : priceSource === "plan"
              ? "Preço de tabela do plano. Ajuste no cadastro se este cliente paga diferente."
              : "Sem valor definido ainda. Defina o plano no cadastro ou crie a cobrança no Financeiro.";

    return (
      <li
        key={c.id}
        className={juntar("min-w-0 px-3 py-3 transition-colors hover:bg-muted/30 sm:px-4", extra?.apagado && "opacity-80")}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuCliente({ x: e.clientX, y: e.clientY, cliente: c });
        }}
        data-cliente={c.id}
      >
        <div className="flex min-w-0 items-center">
          <button
            type="button"
            onClick={() => setEditClient(c)}
            aria-label={`Abrir cadastro do cliente ${nome}`}
            aria-describedby={isAdmin ? `client-finance-${c.id}` : undefined}
            className="flex min-w-0 flex-1 items-center rounded-md bg-transparent text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <FotoDoCliente nome={nome || ""} foto={fotoDe({ id: String(c.id), nome, avatar_url: c.avatar_url })} tamanho="md" />
            <span className="ml-3 block min-w-0 flex-1">
              <span className="flex min-w-0 items-center">
                <span className="min-w-0 truncate text-[14px] font-semibold leading-5 text-foreground">{nome}</span>
                {(searching || tab === "all") && (
                  <span className={juntar(etiqueta, "ml-1.5 hidden bg-muted text-muted-foreground sm:inline-flex")}>
                    {statusLabel[c.plan_status || "active"] || "Sem status"}
                  </span>
                )}
                {tipo && <span className={juntar(etiqueta, "ml-1.5", tipo.cls)}>{tipo.label}</span>}
                {c.brand && (
                  <span className={juntar(etiqueta, "ml-1.5 hidden bg-muted text-muted-foreground md:inline-flex")}>
                    {c.brand === "aceleriq" ? "AcelerIQ" : "SiteBolt"}
                  </span>
                )}
              </span>
              <span className={juntar(texto.auxiliar, "mt-0.5 block truncate")}>
                {c.company_name && c.full_name ? `${c.full_name} · ` : ""}
                {[c.email, c.phone].filter(Boolean).join(" · ")}
              </span>
            </span>
          </button>

          {c.plan_renewal_date && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className={juntar(
                      "ml-3 hidden shrink-0 items-center rounded-md px-2 py-1 text-[12px] tabular-nums md:inline-flex",
                      renovacaoEmAlerta ? juntar(status?.color, "bg-destructive/10") : "text-muted-foreground",
                    )}
                    aria-label={`Renovação ${formatBRDate(c.plan_renewal_date)}${status?.label ? `. ${status.label}` : ""}`}
                  >
                    {status?.icon ? <AlertTriangle className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <CalendarClock className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                    {formatBRDate(c.plan_renewal_date)}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p className="text-xs">{status?.label || "Renovação"}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <span className="ml-3 hidden w-16 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground lg:inline" title="Projetos">
            {c.projectCount ?? 0} {Number(c.projectCount) === 1 ? "projeto" : "projetos"}
          </span>
          <span
            role="img"
            aria-label={`Status: ${statusLabel[c.plan_status || "active"] || "sem status"}`}
            className={`ml-3 h-2 w-2 shrink-0 rounded-full ${statusDot[c.plan_status || "active"] || "bg-muted-foreground"}`}
          />
          {extra?.acao && <span className="ml-2 shrink-0">{extra.acao}</span>}
          <button
            type="button"
            onClick={(e) => abrirMenuNoBotao(e, c)}
            aria-label={`Mais ações de ${nome}`}
            aria-haspopup="menu"
            className={juntar(botao.icone, "ml-1")}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </button>
          <ChevronRight className="ml-0.5 hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
        </div>

        {isAdmin && (
          <dl
            id={`client-finance-${c.id}`}
            className="mt-2.5 grid min-w-0 grid-cols-2 gap-x-4 gap-y-2 sm:ml-[52px] sm:grid-cols-3 xl:grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,1fr))_minmax(0,1.7fr)]"
          >
            <div className="col-span-2 min-w-0 sm:col-span-1">
              <dt className="flex h-5 min-w-0 items-center text-[11px] text-muted-foreground">
                Plano
                {!internal && (
                  <AjudaRecolhida rotulo={`De onde vem o valor de ${nome}`} className="ml-1">
                    {origemDoValor}
                    {costIsEstimate ? " Custo direto é estimativa padrão." : ""}
                  </AjudaRecolhida>
                )}
              </dt>
              <dd className="mt-0.5 flex min-w-0 items-center">
                <span className="min-w-0 truncate text-[13px] font-medium text-foreground">{planName}</span>
                <span
                  className={juntar(
                    etiqueta,
                    "ml-1.5",
                    financial?.pricingMode === "custom"
                      ? "bg-warning/10 text-warning"
                      : financial?.pricingMode === "linked"
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {modeLabel}
                </span>
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="flex h-5 items-center text-[11px] text-muted-foreground">Operacional</dt>
              <dd className="mt-0.5 text-[13px] font-medium tabular-nums text-foreground">{formatCurrency(financial?.operationalAmount ?? null)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="flex h-5 items-center text-[11px] text-muted-foreground">Final</dt>
              <dd className="mt-0.5 text-[13px] font-medium tabular-nums text-foreground">{formatCurrency(financial?.finalAmount ?? null)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="flex h-5 items-center text-[11px] text-muted-foreground">
                Custo direto
                {costIsEstimate && (
                  <span title="Custo padrão do Financeiro. Defina o custo real em Cobrança e custo." className="ml-1 text-warning">
                    (estimativa)
                  </span>
                )}
              </dt>
              <dd className="mt-0.5 text-[13px] font-medium tabular-nums text-foreground">{formatCurrency(displayCost)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="flex h-5 items-center text-[11px] text-muted-foreground">Margem</dt>
              <dd
                className={juntar(
                  "mt-0.5 text-[13px] font-semibold tabular-nums",
                  displayMargin == null ? "text-muted-foreground" : displayMargin < 0 ? "text-destructive" : "text-success",
                )}
              >
                {formatPercent(displayMargin)}
              </dd>
            </div>
            <div className="col-span-2 min-w-0 sm:col-span-1">
              <dt className="flex h-5 items-center text-[11px] text-muted-foreground">Cobrança do mês</dt>
              <dd className="mt-0.5 flex min-w-0 items-center">
                <span className="min-w-0 truncate text-[13px] tabular-nums text-foreground">{billingRead?.detail || financial?.dueLabel || "-"}</span>
                <span className={juntar(etiqueta, "ml-1.5 border", statusMeta.className)}>{statusMeta.label}</span>
              </dd>
            </div>
          </dl>
        )}
      </li>
    );
  };

  const cabecalhoDescricao = isLoading
    ? "Carregando"
    : searching || filtrosAtivos
      ? `${filtered.length} de ${clientRows.length} na lista`
      : `${activeClientCount} ${activeClientCount === 1 ? "ativo" : "ativos"} · ${clientRows.length} no total`;

  return (
    <div className="min-w-0 space-y-4">
      <CabecalhoDePagina
        titulo="Clientes"
        descricao={cabecalhoDescricao}
        ajuda="Cadastro, plano e cobrança de cada cliente. Toque na linha para abrir a ficha; botão direito ou ... para copiar contatos e outras ações."
        acoes={
          isAdmin ? (
            <>
              <button type="button" onClick={() => navigate("/ver-como-cliente")} className={botao.discreto} aria-label="Ver como cliente">
                <Eye className="h-4 w-4" aria-hidden="true" />
                <span className="ml-1.5 hidden md:inline">Ver como cliente</span>
              </button>
              <button type="button" onClick={() => setBriefingOpen(true)} data-tour="clients-briefing-btn" className={botao.secundario} aria-label="Link do briefing">
                <Link2 className="h-4 w-4" aria-hidden="true" />
                <span className="ml-1.5 hidden sm:inline">Link do briefing</span>
              </button>
              <button type="button" onClick={() => setCreateOpen(true)} data-tour="clients-create-btn" className={botao.primario} aria-label="Novo cliente">
                <UserPlus className="h-4 w-4" aria-hidden="true" />
                <span className="ml-1.5 hidden sm:inline">Novo cliente</span>
              </button>
            </>
          ) : undefined
        }
      />


      {/* Filtros: status, tipo e serviço contratado, e a busca na mesma linha */}
      <div className="-m-1 flex flex-wrap items-center [&>*]:m-1">
        <div className="relative min-w-0 flex-1 basis-full sm:basis-[240px]" data-tour="clients-search">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por empresa, contato, e-mail ou telefone"
            aria-label="Buscar cliente existente"
            className={juntar(campo, "pl-9 pr-9 text-[16px] sm:text-[13px]")}
          />
          {searching && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Limpar busca"
              title="Limpar busca"
              className={juntar(botao.icone, "absolute right-0.5 top-1/2 -translate-y-1/2")}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
        <SeletorCompacto
          rotulo="Status"
          opcoes={STATUS_TABS.map((t) => ({ valor: t.value, rotulo: t.label }))}
          valor={tab}
          onEscolher={setTab}
          modo="lista"
        />
        <SeletorCompacto
          rotulo="Serviço"
          opcoes={SERVICE_FILTERS.map((s) => ({ valor: s.value, rotulo: s.label }))}
          valor={serviceFilter}
          onEscolher={setServiceFilter}
          modo="lista"
        />
        <SeletorCompacto
          rotulo="Filtrar clientes por tipo"
          opcoes={TYPE_TABS.map((t) => ({ valor: t.value, rotulo: t.label }))}
          valor={typeFilter}
          onEscolher={setTypeFilter}
        />
        {filtrosAtivos && (
          <button
            type="button"
            onClick={() => {
              setServiceFilter("all");
              setTypeFilter("all");
              setTab("all");
            }}
            className={botao.discreto}
          >
            Limpar filtros
          </button>
        )}
        <p aria-live="polite" className="sr-only">
          {searching ? (filtered.length === 1 ? "1 cliente encontrado." : `${filtered.length} clientes encontrados.`) : ""}
        </p>
      </div>

      <AreaDeTrabalho memoriaDaRolagem="clientes:lista" rotuloDoPrincipal="Lista de clientes">
        {/* Resumo financeiro rola junto com a lista: o cabeçalho e os filtros ficam parados. */}
        {isAdmin && (
          <section aria-label="Resumo financeiro dos clientes" className="mb-5">
            <Painel semEspaco className="overflow-hidden">
              <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-5">
                {kpiCards.map((card, i) => (
                  <div key={card.label} className={juntar("min-w-0 bg-card px-4 py-3", i === kpiCards.length - 1 && "col-span-2 sm:col-span-1")}>
                    <p className={juntar(texto.rotulo, "truncate")}>{card.label}</p>
                    {card.loading ? (
                      <div className="mt-1.5 h-5 w-24 animate-pulse rounded bg-muted" aria-label={`Carregando ${card.label}`} />
                    ) : (
                      <p className={juntar("mt-1 truncate text-[17px] font-semibold leading-6 tabular-nums", card.tone)}>{card.value}</p>
                    )}
                    <p className={juntar(texto.auxiliar, "mt-0.5 hidden truncate sm:block")} title={card.helper}>
                      {card.helper}
                    </p>
                  </div>
                ))}
              </div>
            </Painel>
            {financialError && (
              <p className={juntar(texto.auxiliar, "mt-1.5 flex items-center text-warning")} role="status">
                <AlertTriangle className="mr-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Resumo financeiro indisponível agora. Os clientes seguem acessíveis.
              </p>
            )}
          </section>
        )}
        {isError ? (
          <EstadoDeErro
            titulo="Não foi possível carregar os clientes."
            descricao="Não cadastre de novo agora: isso pode criar um cliente duplicado."
            acao={
              <button type="button" onClick={() => refetch()} className={botao.secundario}>
                Tentar de novo
              </button>
            }
          />
        ) : isLoading && !clients ? (
          <Carregando rotulo="Carregando clientes" linhas={6} />
        ) : filtered.length === 0 ? (
          <EstadoVazio
            icone={<Users className="h-5 w-5" />}
            titulo={searching ? `Nenhum cliente para "${search.trim()}"` : "Nenhum cliente nesses filtros"}
            acao={
              searching ? (
                <button type="button" onClick={() => setSearch("")} className={botao.secundario}>
                  Limpar busca
                </button>
              ) : filtrosAtivos ? (
                <button
                  type="button"
                  onClick={() => {
                    setServiceFilter("all");
                    setTypeFilter("all");
                    setTab("all");
                  }}
                  className={botao.secundario}
                >
                  Limpar filtros
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="space-y-6">
            <section aria-label="Clientes recorrentes e híbridos">
              {principais.length > 0 ? (
                <Painel semEspaco>
                  <ul className="divide-y divide-border">{principais.map((c) => renderClientRow(c))}</ul>
                </Painel>
              ) : (
                <EstadoVazio compacto titulo="Nenhum recorrente ou híbrido nestes filtros." />
              )}
            </section>

            {avulsosList.length > 0 && (
              <Secao
                titulo="Avulsos"
                descricao={`${avulsosList.length} em andamento · ${principais.length + avulsosList.length} clientes no total`}
              >
                <Painel semEspaco>
                  <ul className="divide-y divide-border">
                    {avulsosList.map((c) =>
                      renderClientRow(c, {
                        acao: (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleOneOffDone(c, true);
                            }}
                            title="Marcar este avulso como concluído"
                            className={juntar(botao.secundario, "h-8 px-2.5 text-[12px] text-success")}
                          >
                            Concluir
                          </button>
                        ),
                      }),
                    )}
                  </ul>
                </Painel>
              </Secao>
            )}

            {avulsosDone.length > 0 && (
              <Secao
                titulo="Avulsos concluídos"
                descricao={`${avulsosDone.length} ${avulsosDone.length === 1 ? "concluído" : "concluídos"}`}
                acao={
                  <button type="button" onClick={() => setShowDoneOneOffs((v) => !v)} aria-expanded={showDoneOneOffs} className={botao.discreto}>
                    {showDoneOneOffs ? "Recolher" : "Mostrar"}
                  </button>
                }
              >
                {showDoneOneOffs && (
                  <Painel semEspaco>
                    <ul className="divide-y divide-border">
                      {avulsosDone.map((c) =>
                        renderClientRow(c, {
                          apagado: true,
                          acao: (
                            <button type="button" onClick={() => toggleOneOffDone(c, false)} className={juntar(botao.discreto, "h-8 text-[12px] text-primary")}>
                              Retomar cliente
                            </button>
                          ),
                        }),
                      )}
                    </ul>
                  </Painel>
                )}
              </Secao>
            )}

            {internasList.length > 0 && (
              <Secao
                titulo="Empresas do grupo"
                descricao={`${internasList.length} ${internasList.length === 1 ? "empresa" : "empresas"}`}
                ajuda="Organização interna. Fica fora da contagem, das cobranças e dos alertas."
              >
                <Painel semEspaco>
                  <ul className="divide-y divide-border">{internasList.map((c) => renderClientRow(c))}</ul>
                </Painel>
              </Secao>
            )}
          </div>
        )}
      </AreaDeTrabalho>

      {isAdmin && <CreateClientModal open={createOpen} onClose={() => setCreateOpen(false)} />}
      <EditClientDrawer
        open={!!editClient}
        onClose={closeClientDrawer}
        client={editClient}
        fotoFallback={editClient ? fotoDe({ id: String(editClient.id), nome: editClient.company_name || editClient.full_name, avatar_url: editClient.avatar_url }) : null}
        initialSection={searchParams.get("section") === "accounts" ? "accounts" : null}
        initialProjectId={searchParams.get("project")}
      />
      {isAdmin && <BriefingLinkModal open={briefingOpen} onClose={() => setBriefingOpen(false)} />}
      {menuCliente && (
        <MenuDeContexto
          x={menuCliente.x}
          y={menuCliente.y}
          itens={itensDoCliente(menuCliente.cliente)}
          aoFechar={() => setMenuCliente(null)}
        />
      )}
    </div>
  );
}
