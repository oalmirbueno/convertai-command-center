import { lazy, Suspense, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import BotaoDoCrescimento from "@/components/clientes/BotaoDoCrescimento";
import { useBilling, useAdsWallet, useRechargeRequests } from "@/hooks/useFinancialData";
import { useFreelaContatos } from "@/components/freela/dadosFreela";
import { useQuery } from "@tanstack/react-query";
import { useClients } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { notifyUser } from "@/lib/notifyHelpers";
import { fireWebhook, webhooks } from "@/lib/webhooks";
import {
  DollarSign, TrendingUp, CreditCard, Plus, RefreshCw, Bell, Edit3, Zap, CheckCircle2, MessageCircle, Briefcase,
  AlertTriangle as AlertTriangleIcon, History, ChevronLeft, ChevronRight, ChevronDown, LayoutList, LayoutDashboard,
  Sparkles, ArrowLeftRight, Repeat, Receipt, Tag, Landmark, Wallet, Inbox, Brain,
} from "lucide-react";
import { getProjectBrand, BrandFilter, BRAND_FILTERS, matchesBrandFilter } from "@/lib/brandHelpers";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  AjudaRecolhida, CabecalhoDePagina, CampoDeFormulario, Carregando, EstadoDeErro, EstadoVazio, GrupoDeCampos, Painel,
  RegiaoRolavel, Secao, SeletorCompacto, useEstadoDaTela, botao, campo, campoTexto, etiqueta, foco, juntar, superficie, texto,
  type OpcaoCompacta,
} from "@/components/sistema";
import { Avatar, ChartLegend, Donut, OverflowMenu, ProgressBar, StatCard, StatGrid, StatusPill } from "@/components/ds";
import { IconeDaLinha, Numeros, grafico } from "@/components/finance/pecasDoFinanceiro";
import CashFlow from "@/components/finance/CashFlow";
import InvestorCapital from "@/components/finance/InvestorCapital";
import FixedCosts from "@/components/finance/FixedCosts";
import { ABAS_DOS_CUSTOS, CHAVE_DA_ABA_DOS_CUSTOS, validarAbaDosCustos, type AbaDosCustos } from "@/components/finance/abasDosCustos";
import PlansPricing from "@/components/finance/PlansPricing";
import ManagementSummary from "@/components/finance/ManagementSummary";
import AdsInvestment from "@/components/finance/AdsInvestment";
import CFOAssistant from "@/components/finance/CFOAssistant";
// Frente CFO (30/09): o campo do agente financeiro (carrega só quando a aba abre).
const AreaDoCFO = lazy(() => import("@/components/cfo/AreaDoCFO"));
import { useFinanceSettings } from "@/hooks/useFinanceV2";
import { isInternalClient } from "@/lib/clientFlags";
import { useFinanceBoxes, boxesTotal } from "@/hooks/useFinanceBoxes";
import FaturamentoDoProduto from "@/components/produto/casa/FaturamentoDoProduto";
import { DinheiroDoMesLido } from "@/components/comercial/DinheiroDoMes";
import { Boxes } from "lucide-react";
import { DEFAULT_TAX_RATE } from "@/lib/directorPlan";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { todayBR as _todayBR, toBRDateKey as _toBRDateKey } from "@/lib/dateBR";
import { createBilling } from "@/lib/createBilling";
import { saldoDaCobranca } from "@/lib/clientes/situacaoDaCobranca";
import { fmtMoeda, moedaDe } from "@/lib/freela/freelaLib";

const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

/** Tons da rosca de proporção por marca (os mesmos do tema: marca, tinta/lima e violeta). */
const TONS_DA_PROPORCAO = [1, 3, 2] as const;

const MONTHS_FULL = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const MONTHS_SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const parseAppDate = (value?: string | null) => {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day, 12);
  }
  return new Date(value);
};

// Always returns YYYY-MM-DD in America/Sao_Paulo (GMT-3).
const toLocalDateKey = (date?: Date) => (date ? _toBRDateKey(date) : _todayBR());




const formatAppDate = (value?: string | null) => parseAppDate(value)?.toLocaleDateString("pt-BR") || "-";

// Returns the amount actually received for a billing/installment record,
// respecting partial payments. Use this for any "received" aggregation.
const receivedOf = (row: any): number => {
  if (!row) return 0;
  const total = Number(row.amount) || 0;
  const paid = Number(row.paid_amount) || 0;
  if (row.status === "partial") return Math.min(paid, total);
  if (row.status === "paid") return paid > 0 && paid < total ? paid : total;
  return 0;
};

const statusBadge = (status: string, dueDate?: string) => {
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const due = parseAppDate(dueDate);
  const isOverdue = due && due < todayStart && status === "pending";
  if (status === "paid") return <StatusPill tone="success">Pago</StatusPill>;
  if (status === "partial") return <StatusPill tone="info">Parcial</StatusPill>;
  if (status === "completed") return <StatusPill tone="success">Concluída</StatusPill>;
  if (status === "approved") return <StatusPill tone="info">Aprovada pelo cliente</StatusPill>;
  if (isOverdue) return <StatusPill tone="danger">Atrasado</StatusPill>;
  if (status === "pending") return <StatusPill tone="warning">Pendente</StatusPill>;
  if (status === "rejected") return <StatusPill tone="danger">Recusada</StatusPill>;
  return <StatusPill>{status}</StatusPill>;
};

/* ------------------------------------------------------------------ */
/* Peças locais da tela (sistema de design, docs/design/SISTEMA.md).   */
/* ------------------------------------------------------------------ */

type PapelDaAba = "admin" | "gestao" | "todos";

/** Abas do Financeiro v1 e quem vê cada uma (as mesmas condições do TabsList antigo). */
const ABAS_DO_FINANCEIRO: { valor: string; rotulo: string; papeis: PapelDaAba; icone: ReactNode }[] = [
  { valor: "overview", rotulo: "Visão geral", papeis: "admin", icone: <LayoutDashboard className="h-3.5 w-3.5" /> },
  { valor: "cfo", rotulo: "CFO", papeis: "admin", icone: <Brain className="h-3.5 w-3.5" /> },
  { valor: "assistant", rotulo: "Assistente", papeis: "admin", icone: <Sparkles className="h-3.5 w-3.5" /> },
  { valor: "cashflow", rotulo: "Fluxo de caixa", papeis: "gestao", icone: <ArrowLeftRight className="h-3.5 w-3.5" /> },
  { valor: "renewals", rotulo: "Mensalidades", papeis: "admin", icone: <Repeat className="h-3.5 w-3.5" /> },
  { valor: "fixedcosts", rotulo: "Custos fixos", papeis: "admin", icone: <Receipt className="h-3.5 w-3.5" /> },
  { valor: "plans", rotulo: "Planos e preços", papeis: "admin", icone: <Tag className="h-3.5 w-3.5" /> },
  // 13/11/2026: o faturamento e o custo do produto CRM e E-mail (assinaturas pelo Asaas).
  { valor: "produto", rotulo: "CRM e E-mail", papeis: "admin", icone: <Boxes className="h-3.5 w-3.5" /> },
  { valor: "capital", rotulo: "Capital", papeis: "gestao", icone: <Landmark className="h-3.5 w-3.5" /> },
  { valor: "ads", rotulo: "Ads Wallet", papeis: "todos", icone: <Wallet className="h-3.5 w-3.5" /> },
  { valor: "audit", rotulo: "Histórico", papeis: "admin", icone: <History className="h-3.5 w-3.5" /> },
];


/** Mês guardado válido: não pode passar do mês corrente (a seta de avançar para nele). */
const mesValido = (v: unknown) => {
  if (!v || typeof v !== "object") return false;
  const { m, y } = v as { m?: unknown; y?: unknown };
  if (typeof m !== "number" || typeof y !== "number" || m < 0 || m > 11 || y < 2000 || y > 2100) return false;
  const hoje = new Date();
  return y * 12 + m <= hoje.getFullYear() * 12 + hoje.getMonth();
};

const rascunhoDeCobrancaValido = (v: unknown) =>
  !!v && typeof v === "object" && ["client_id", "type", "amount", "due_date", "description"].every((k) => typeof (v as Record<string, unknown>)[k] === "string");

/** Ação discreta de uma linha de lista (32 px). */
const acaoDaLinha = `inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-border bg-card px-4 text-[12px] font-medium text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50 ${foco}`;

/** A ação que resolve a linha (Pagar, Marcar como pago): pílula de tinta. */
const acaoPrincipalDaLinha = `inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-foreground px-4 text-[12px] font-medium text-background transition-colors hover:bg-foreground/85 disabled:pointer-events-none disabled:opacity-50 ${foco}`;

/** Linha das listas do Financeiro: mais ar, fundo suave ao passar o mouse. */
const linhaDaLista = "flex min-w-0 items-center px-4 py-3.5 transition-colors hover:bg-muted/40 sm:px-6";
/** Cabeçalho de grupo dentro de uma lista (plano, situação). */
const grupoDaLista = "bg-muted/50 px-4 py-2.5 sm:px-6";

/** Rodapé de diálogo: ações à direita, o primário por último. */
const rodapeDoDialogo = "flex min-w-0 flex-wrap items-center justify-end border-t border-border pt-4 [&>*+*]:ml-2";

/** No celular o cartão tem meia tela: o ícone sai para o rótulo caber inteiro. */
const semIconeNoCelular = "max-sm:[&>span:first-child>span[aria-hidden]]:hidden";

/** Resumo de uma seção: os números numa faixa só (mesmo cartão das outras áreas do Financeiro). */
function Resumo({ itens }: { itens: { rotulo: string; valor: string; cor?: string }[] }) {
  return (
    <Numeros
      rotulo="Resumo"
      colunas={Math.min(4, Math.max(2, itens.length)) as 2 | 3 | 4}
      itens={itens.map((s) => ({ rotulo: s.rotulo, valor: s.valor, corDoValor: s.cor }))}
    />
  );
}

/** Lista longa: um painel só, linhas com divisória, rolagem própria no computador (com memória). */
function ListaDoFinanceiro({ memoria, rotulo, alta = false, children }: { memoria: string; rotulo: string; alta?: boolean; children: ReactNode }) {
  return (
    <div className={juntar(superficie.painel, "overflow-hidden")}>
      <RegiaoRolavel memoria={memoria} rotulo={rotulo} sobre="cartao" className={alta ? "lg:max-h-[70vh]" : "lg:max-h-[56vh]"}>
        <ul className="divide-y divide-border/60">{children}</ul>
      </RegiaoRolavel>
    </div>
  );
}

/** Mês/ano com setas (o próximo mês para no mês corrente, como antes). */
function SeletorDeMes({ mes, ano, noMesAtual, onMudar, onHoje }: { mes: number; ano: number; noMesAtual: boolean; onMudar: (passo: number) => void; onHoje: () => void }) {
  return (
    <div className="flex min-w-0 items-center" role="group" aria-label="Mês do financeiro">
      <button type="button" onClick={() => onMudar(-1)} className={botao.icone} aria-label="Mês anterior">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      <span className="mx-0.5 min-w-[72px] text-center text-[13px] font-semibold tabular-nums text-foreground sm:min-w-[118px]" aria-live="polite">
        <span className="sm:hidden">{MONTHS_SHORT[mes]} {ano}</span>
        <span className="hidden sm:inline">{MONTHS_FULL[mes]} {ano}</span>
      </span>
      <button type="button" onClick={() => onMudar(1)} disabled={noMesAtual} className={juntar(botao.icone, "disabled:pointer-events-none disabled:opacity-30")} aria-label="Próximo mês">
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
      {!noMesAtual && (
        <button type="button" onClick={onHoje} className={juntar(botao.discreto, "h-8 px-2 text-primary")}>
          Hoje
        </button>
      )}
    </div>
  );
}

const typeIcon = (type: string) => {
  if (type === "renewal") return "REC";
  if (type === "ads_recharge") return "ADS";
  if (type === "freela") return "FRL";
  // 14/11/2026: cobrança de extra do cliente (suporte, CRM, e-mail, comissão), ligada a client_extras.
  if (type === "extra") return "EXT";
  return "AVU";
};

function LegacyFinanceiro() {
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const isManager = profile?.role === "manager";
  const queryClient = useQueryClient();
  const billingQuery = useBilling();
  // Cliente que veio do Freela. profiles só libera colunas de uma lista (20260809044000): origem_aquisicao fora dela
  // derrubava toda leitura de cobranças com 403. A origem vem dos contatos promovidos, que o admin já lê.
  const { data: contatosDoFreela } = useFreelaContatos();
  const { data: billing, isLoading: billingLoading } = billingQuery;
  const walletsQuery = useAdsWallet();
  const { data: wallets } = walletsQuery;
  const rechargesQuery = useRechargeRequests();
  const { data: recharges } = rechargesQuery;
  const { data: clients } = useClients();
  const paymentsQuery = useQuery({
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
  const { data: projectPayments } = paymentsQuery;
  // Extras mensais ativos dos clientes (client_extras): entram no resumo das mensalidades.
  const { data: extrasPorMes = 0 } = useQuery({
    queryKey: ["extras-mensais-ativos"],
    enabled: isAdmin,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("client_extras").select("valor").eq("cobranca", "mensal").eq("status", "ativo");
      if (error) return 0;
      return Math.round(((data ?? []) as Array<{ valor: number }>).reduce((s, e) => s + (Number(e.valor) || 0), 0) * 100) / 100;
    },
  });
  const { data: financeSettings } = useFinanceSettings();
  const { data: allExpensesCash } = useQuery({
    queryKey: ["expenses"],
    queryFn: async () => {
      const { data, error } = await supabase.from("expenses").select("*").order("due_date", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: isAdmin,
  });
  const auditQuery = useQuery({
    queryKey: ["payment-audit-log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      // Fetch performer names
      const performerIds = [...new Set((data || []).map((l: any) => l.performed_by).filter(Boolean))];
      const performers: Record<string, string> = {};
      if (performerIds.length > 0) {
        const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", performerIds);
        (profiles || []).forEach((p: any) => { performers[p.id] = p.full_name; });
      }
      return (data || []).map((l: any) => ({ ...l, performerName: performers[l.performed_by] || null }));
    },
    enabled: isAdmin,
  });
  const { data: auditLogs } = auditQuery;

  // Abas: as mesmas condições de papel do seletor antigo. Manager não tem Visão geral.
  const abasPermitidas = ABAS_DO_FINANCEIRO.filter((a) =>
    a.papeis === "todos" || (a.papeis === "admin" ? isAdmin : isAdmin || isManager),
  );
  const abaPadrao = isAdmin ? "overview" : "ads";
  const [abaGuardada, setAba] = useEstadoDaTela<string>("financeiro:aba", abaPadrao, {
    validar: (v) => typeof v === "string" && abasPermitidas.some((a) => a.valor === v),
  });
  const aba = abasPermitidas.some((a) => a.valor === abaGuardada) ? abaGuardada : abaPadrao;

  const [newBillingOpen, setNewBillingOpen] = useState(false);
  const [creatingBilling, setCreatingBilling] = useState(false);
  const creatingBillingRef = useRef(false);
  const [rechargeModal, setRechargeModal] = useState<{ clientId: string; platform: string } | null>(null);
  const [addWalletModal, setAddWalletModal] = useState(false);
  const [editPlanModal, setEditPlanModal] = useState<any>(null);
  const [receivedFilter, setReceivedFilter] = useEstadoDaTela<string>("financeiro:recebidos-filtro", "month", {
    validar: (v) => v === "all" || v === "month" || v === "last3" || v === "year",
  });
  const [brandFilter, setBrandFilter] = useEstadoDaTela<BrandFilter>("financeiro:marca", "all", {
    validar: (v) => BRAND_FILTERS.some((f) => f.value === v),
  });
  // Origem do lançamento: agência (planos, projetos, ads) ou freela (mesa /freela).
  const [origem, setOrigem] = useEstadoDaTela<"todos" | "agencia" | "freela">("financeiro:origem", "todos", {
    validar: (v) => v === "todos" || v === "agencia" || v === "freela",
  });
  const [periodFilter, setPeriodFilter] = useEstadoDaTela<"month" | "all">("financeiro:periodo", "month", {
    validar: (v) => v === "month" || v === "all",
  });
  const [payModal, setPayModal] = useState<{ id: string; type: "billing" | "installment"; label: string; amount: number; clientId?: string; billingType?: string; paidSoFar?: number; totalAmount?: number } | null>(null);
  const [payType, setPayType] = useState<"full" | "partial">("full");
  const [payPartialAmount, setPayPartialAmount] = useState("");
  // Leitura dos Custos fixos: o seletor mora no título da página (mesma chave que o FixedCosts usava).
  const [abaDosCustos, setAbaDosCustos] = useEstadoDaTela<AbaDosCustos>(CHAVE_DA_ABA_DOS_CUSTOS, "custos", { validar: validarAbaDosCustos });
  const [renewalsView, setRenewalsView] = useEstadoDaTela<"mensalistas" | "avulsos">("financeiro:mensalidades-visao", "mensalistas", {
    validar: (v) => v === "mensalistas" || v === "avulsos",
  });
  const [mesEscolhido, setMesEscolhido] = useEstadoDaTela<{ m: number; y: number }>(
    "financeiro:mes",
    { m: new Date().getMonth(), y: new Date().getFullYear() },
    { validar: mesValido },
  );
  const selMonth = mesEscolhido.m;
  const selYear = mesEscolhido.y;

  // Rascunho da nova cobrança: fica guardado ao sair e voltar; limpa só depois de criar.
  const [billForm, setBillForm] = useEstadoDaTela("financeiro:rascunho-cobranca", { client_id: "", type: "renewal", amount: "", due_date: "", description: "" }, {
    validar: rascunhoDeCobrancaValido,
    esperaMs: 300,
  });
  const [rechargeForm, setRechargeForm] = useState({ amount: "", reason: "", period: "semanal" });
  const [addWalletForm, setAddWalletForm] = useState({ client_id: "", platform: "meta", balance: "0" });
  const [planForm, setPlanForm] = useState({ amount: "", renewal_date: "", description: "" });

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thisMonth = now.getMonth();
  const thisYear = now.getFullYear();

  // Computed totals · combine billing + client plan data for accurate stats
  // "month" period is driven by the selected month/year (month picker)
  const isThisMonth = (d: string) => {
    const date = parseAppDate(d);
    if (!date) return false;
    return date.getMonth() === selMonth && date.getFullYear() === selYear;
  };
  const isCurrentMonthSelected = selMonth === thisMonth && selYear === thisYear;

  // Standby/inactive clients: pause their recurring pending charges from the finance view.
  // Empresas do grupo (internas) também ficam fora de qualquer cobrança recorrente.
  const pausedClientIds = new Set(
    (clients || [])
      .filter((c: any) => c.plan_status === "standby" || c.plan_status === "inactive" || isInternalClient(c))
      .map((c: any) => c.id)
  );
  const isPausedRenewal = (b: any) => b.type === "renewal" && pausedClientIds.has(b.client_id);

  /* Freela: as linhas type='freela' chegam prontas do banco (gatilho das
     parcelas), com moeda própria e client_id NULL. Duas réguas:
     1) Soma em R$ só com linhas em BRL — o dólar do freela tem caixa próprio
        em /freela/caixa e nunca entra em total de real. Linhas antigas sem
        `currency` são BRL (o painel só trabalhava em real).
     2) O filtro de origem escolhe o que entra nos números e listas da visão
        geral. Com os dados de hoje (tudo agência em BRL), "Todos" e "Agência"
        dão exatamente os mesmos números de antes. */
  const ehCobrancaFreela = (b: any) => b?.type === "freela";
  const billingBRL = (billing || []).filter((b: any) => moedaDe(b) === "BRL");
  // 04/11/2026: cliente que veio do Freela tem cobrança comum (conta em tudo), e a origem dele segue sendo Freela.
  const clientesDoFreela = new Set((contatosDoFreela || []).map((c) => c.promoted_client_id).filter(Boolean));
  const daOrigemFreela = (b: any) => ehCobrancaFreela(b) || clientesDoFreela.has(b?.client_id);
  const billingDaOrigem = billingBRL.filter((b: any) =>
    origem === "todos" ? true : origem === "freela" ? daOrigemFreela(b) : !daOrigemFreela(b),
  );

  const pendingBills = billingDaOrigem.filter((b: any) => b.status === "pending" && !isPausedRenewal(b));
  // "Recebido" inclui parcial: o valor recebido vem de paid_amount nesse caso.
  const paidBills = billingDaOrigem.filter((b: any) => b.status === "paid" || b.status === "partial");
  const overdueBills = pendingBills.filter((b: any) => {
    const due = parseAppDate(b.due_date);
    return due ? due < todayStart : false;
  });

  // "A Receber" · from billing pending + active clients with plan_value not yet in billing
  const isInActivePeriod = (date?: string | null) => periodFilter === "all" || (!!date && isThisMonth(date));
  const hasPaidRenewalInActiveMonth = (clientId: string) =>
    periodFilter === "month" && billingBRL.some((b: any) =>
      b.client_id === clientId &&
      b.type === "renewal" &&
      (b.status === "paid" || b.status === "partial") &&
      isThisMonth(b.paid_date || b.due_date)
    );
  const pendingBillsInActivePeriod = pendingBills.filter((b: any) => isInActivePeriod(b.due_date));
  const clientsWithPlanNotInBilling = (clients || []).filter((c: any) =>
    c.plan_value && c.plan_status === "active" &&
    c.client_type !== "one_off" && !isInternalClient(c) &&
    isInActivePeriod(c.plan_renewal_date) &&
    !pendingBills.some((b: any) => b.client_id === c.id && b.type === "renewal") &&
    !hasPaidRenewalInActiveMonth(c.id)
  );
  const extraPending = clientsWithPlanNotInBilling.reduce((s: number, c: any) => s + Number(c.plan_value), 0);

  // Period-aware filtering
  const monthPendingBills = pendingBills.filter((b: any) => b.type !== "ads_recharge" && isThisMonth(b.due_date));
  const monthPaidBills = paidBills.filter((b: any) => b.type !== "ads_recharge" && isThisMonth(b.paid_date || b.due_date));

  const monthlyRevenue = monthPaidBills.reduce((s: number, b: any) => s + receivedOf(b), 0);

  const pendingTotal = periodFilter === "month"
    ? monthPendingBills.reduce((s: number, b: any) => s + Number(b.amount), 0)
    : pendingBills.filter((b: any) => b.type !== "ads_recharge").reduce((s: number, b: any) => s + Number(b.amount), 0) + (origem === "freela" ? 0 : extraPending);

  const overdueTotal = periodFilter === "month"
    ? monthPendingBills.filter((b: any) => {
      const due = parseAppDate(b.due_date);
      return due ? due < todayStart : false;
    }).reduce((s: number, b: any) => s + Number(b.amount), 0)
    : overdueBills.reduce((s: number, b: any) => s + Number(b.amount), 0);

  const receivedTotal = periodFilter === "month"
    ? monthlyRevenue
    : paidBills.filter((b: any) => b.type !== "ads_recharge").reduce((s: number, b: any) => s + receivedOf(b), 0);

  // Receita Mensal Esperada = soma dos plan_value de clientes ativos (fora empresas internas)
  const expectedMonthlyRevenue = (clients || [])
    .filter((c: any) => c.plan_value && c.plan_status === "active" && c.client_type !== "one_off" && !isInternalClient(c))
    .reduce((s: number, c: any) => s + Number(c.plan_value), 0);

  // Saldo em caixa real · mesma fórmula do bloco "Caixa da Aceleriq" no Fluxo de Caixa:
  // base de meses anteriores (conciliada) + tudo que entrou − tudo que saiu.
  const isInvestorExpense = (e: any) => {
    const c = e?.category || "";
    return c === "investidor" || c.startsWith("inv_");
  };
  const allTimeReceivedCash =
    billingBRL
      .filter((b: any) => b.type !== "ads_recharge" && (b.status === "paid" || b.status === "partial"))
      .reduce((s: number, b: any) => s + receivedOf(b), 0) +
    (projectPayments || []).reduce(
      (s: number, pp: any) =>
        s +
        (pp.installments || [])
          .filter((i: any) => i.status === "paid" || i.status === "partial")
          .reduce((x: number, i: any) => x + receivedOf(i), 0),
      0
    );
  const allTimePaidOutCash = (allExpensesCash || [])
    .filter((e: any) => e.status === "paid" && !isInvestorExpense(e))
    .reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
  const cashBalance = (financeSettings?.openingBalance ?? 0) + allTimeReceivedCash - allTimePaidOutCash;
  const { data: financeBoxes } = useFinanceBoxes();
  const reservedInBoxes = boxesTotal(financeBoxes);

  // Divisão automática · valores realmente recebidos no mês selecionado (planos + projetos)
  const monthReceivedItems = [
    ...monthPaidBills.map((b: any) => ({ clientId: b.client_id || null, amount: receivedOf(b) })),
    // Freela não mistura parcela de projeto da agência no recebido do mês.
    ...(origem === "freela" ? [] : (projectPayments || []).flatMap((pp: any) =>
      (pp.installments || [])
        .filter((i: any) => (i.status === "paid" || i.status === "partial") && isThisMonth(i.paid_date || i.due_date))
        .map((i: any) => ({ clientId: pp.client_id || null, amount: receivedOf(i) }))
    )),
  ];
  const monthGrossReceived = monthReceivedItems.reduce((s, it) => s + it.amount, 0);
  const activeMensalistas = (clients || [])
    .filter((c: any) => c.plan_value && c.plan_status === "active" && c.client_type !== "one_off" && !isInternalClient(c)).length;
  // Referência para a escada de pró-labore: melhor entre o operacional recebido e o MRR
  const ladderRevenue = Math.max(monthGrossReceived * (1 - DEFAULT_TAX_RATE), expectedMonthlyRevenue);

  // Projeção próximo mês
  const nextMonth = thisMonth === 11 ? 0 : thisMonth + 1;
  const nextYear = thisMonth === 11 ? thisYear + 1 : thisYear;
  const isNextMonth = (d: string) => {
    const date = parseAppDate(d);
    if (!date) return false;
    return date.getMonth() === nextMonth && date.getFullYear() === nextYear;
  };

  // Recurring: plan_value de clientes ativos (mesma receita esperada)
  const nextMonthRecurring = expectedMonthlyRevenue;

  // Individual: parcelas pendentes com vencimento no próximo mês
  const nextMonthIndiv = (projectPayments || [])
    .filter((pp: any) => matchesBrandFilter(pp.project?.project_type, brandFilter))
    .reduce((sum: number, pp: any) =>
      sum + (pp.installments || []).filter((i: any) => i.status === "pending" && isNextMonth(i.due_date))
        .reduce((s: number, i: any) => s + Number(i.amount), 0), 0);

  const nextMonthTotal = (brandFilter === "all" || brandFilter === "aceleriq" ? nextMonthRecurring : 0)
    + (brandFilter === "all" || brandFilter === "sitebolt" ? nextMonthIndiv : 0);

  const totalAds = (wallets || []).reduce((s: number, w: any) => s + Number(w.balance), 0);

  // Individual project payments totals (period-aware)
  const filteredPayments = (projectPayments || []).filter((pp: any) => matchesBrandFilter(pp.project?.project_type, brandFilter));

  const indivPaid = filteredPayments.reduce((sum: number, pp: any) =>
    sum + (pp.installments || [])
      .filter((i: any) => (i.status === "paid" || i.status === "partial") && (periodFilter === "all" || isThisMonth(i.paid_date || i.due_date)))
      .reduce((s: number, i: any) => s + Number(i.status === "partial" ? (i.paid_amount || 0) : i.amount), 0), 0);

  const indivPendingAll = filteredPayments.reduce((sum: number, pp: any) =>
    sum + (pp.installments || []).filter((i: any) => i.status === "pending")
      .reduce((s: number, i: any) => s + Number(i.amount), 0), 0);

  const indivPendingMonth = filteredPayments.reduce((sum: number, pp: any) =>
    sum + (pp.installments || []).filter((i: any) => i.status === "pending" && isThisMonth(i.due_date))
      .reduce((s: number, i: any) => s + Number(i.amount), 0), 0);

  const indivPending = periodFilter === "month" ? indivPendingMonth : indivPendingAll;

  const indivOverdue = filteredPayments.reduce((sum: number, pp: any) =>
    sum + (pp.installments || []).filter((i: any) => {
      const due = parseAppDate(i.due_date);
      return i.status === "pending" && !!due && due < todayStart && (periodFilter === "all" || isThisMonth(i.due_date));
    })
      .reduce((s: number, i: any) => s + Number(i.amount), 0), 0);

  const indivTotal = filteredPayments.reduce((sum: number, pp: any) => sum + Number(pp.total_value), 0);

  const handleMarkPaid = async (id: string) => {
    const localBill = (billing || []).find((b: any) => b.id === id);
    const { data: currentBill, error: fetchError } = await supabase
      .from("billing")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (fetchError) {
      toast.error(fetchError.message);
      return;
    }
    const bill = currentBill || localBill;
    if (!bill) {
      toast.error("Cobrança não encontrada");
      return;
    }
    // Parcela freela só muda em freela_parcelas. O gatilho do banco espelha no billing.
    if (ehCobrancaFreela(bill)) {
      toast.info("A baixa do freela é no caixa da mesa Freela.");
      return;
    }
    if (bill.status === "paid") {
      await queryClient.invalidateQueries({ queryKey: ["billing"] });
      toast.info("Esse pagamento já estava registrado");
      return;
    }
    const today = toLocalDateKey();
    const { data: updatedRows, error: updateError } = await supabase
      .from("billing")
      .update({ status: "paid", paid_date: today, paid_amount: Number(bill.amount) || null } as any)
      .eq("id", id)
      .eq("status", "pending")
      .select();
    if (updateError) {
      toast.error(updateError.message);
      return;
    }
    if (!updatedRows || updatedRows.length === 0) {
      await queryClient.invalidateQueries({ queryKey: ["billing"] });
      toast.info("Esse lançamento já saiu dos pendentes");
      return;
    }

    // Registra no histórico de auditoria (caso o pagamento venha do botão direto, não do painel)
    if (bill) {
      await supabase.from("payment_audit_log").insert({
        entity_type: "billing",
        entity_id: id,
        action: "paid_full",
        old_status: bill.status || "pending",
        new_status: "paid",
        old_amount: Number(bill.amount),
        new_amount: Number(bill.amount),
        notes: bill.description || (bill.type === "renewal" ? "Renovação Mensal" : "Cobrança"),
        performed_by: user?.id || null,
      } as any);
      queryClient.invalidateQueries({ queryKey: ["payment-audit-log"] });
    }


    // Renovação paga: o banco avança plan_renewal_date, limpa o atraso, reativa
    // projetos pausados e cria a próxima cobrança (gatilho
    // billing_renovacao_ao_pagar, migration 20261030190000). Vale para qualquer
    // caminho que marque pago, então a tela não repete esse trabalho.

    // Notify client
    if (bill?.client_id) {
      await notifyUser(bill.client_id, `Pagamento de ${fmt(Number(bill.amount))} registrado`, "billing", "/financeiro");
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["billing"] }),
      queryClient.invalidateQueries({ queryKey: ["clients"] }),
      queryClient.invalidateQueries({ queryKey: ["all-project-payments-finance"] }),
    ]);
    toast.success("Pagamento registrado! Próxima renovação gerada automaticamente.");
  };

  const handleCreateBilling = async () => {
    // A ref tambem cobre dois cliques antes do proximo render do React.
    if (creatingBillingRef.current) return;
    creatingBillingRef.current = true;
    setCreatingBilling(true);
    try {
      const { notificationFailed } = await createBilling(billForm);
      toast.success("Cobrança criada");
      setNewBillingOpen(false);
      setBillForm({ client_id: "", type: "renewal", amount: "", due_date: "", description: "" });
      if (notificationFailed) toast.warning("A cobrança foi criada, mas não consegui avisar o cliente.");
      // Uma falha de recarga posterior nao pode apresentar a criacao como
      // falha e incentivar uma segunda cobranca para o mesmo pedido.
      void queryClient.invalidateQueries({ queryKey: ["billing"] }).catch(() => {
        toast.warning("Cobrança criada. Atualize a lista para conferir o lançamento.");
      });
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Não foi possível criar a cobrança. Seus dados foram mantidos.");
    } finally {
      creatingBillingRef.current = false;
      setCreatingBilling(false);
    }
  };

  const handleRequestRecharge = async () => {
    if (!rechargeModal || !rechargeForm.amount) { toast.error("Informe o valor"); return; }
    const amount = parseFloat(rechargeForm.amount);
    const periodLabel = rechargeForm.period === "mensal" ? "mensal" : "semanal";
    const { error: erroDoPedido } = await supabase.from("recharge_requests").insert({
      client_id: rechargeModal.clientId, platform: rechargeModal.platform,
      amount, reason: rechargeForm.reason ? `${rechargeForm.reason} (${periodLabel})` : `Investimento ${periodLabel}`, requested_by: user?.id,
    });
    // Pedido não gravado (RLS, rede): antes o cliente era notificado e o webhook disparava para um pedido
    // que não existe, e ele não tinha o que confirmar. Para aqui e mantém o modal com o valor.
    if (erroDoPedido) {
      toast.error("Não consegui registrar a solicitação de recarga. Nada foi enviado ao cliente.");
      return;
    }
    // Notify the CLIENT
    await notifyUser(rechargeModal.clientId, `Recarga de ${fmt(amount)} (${periodLabel}) solicitada para ${rechargeModal.platform}. Por favor, confirme.`, "billing", "/financeiro");
    queryClient.invalidateQueries({ queryKey: ["recharge-requests"] });
    toast.success("Solicitação de recarga enviada! Cliente será notificado.");

    // Fire webhook
    const client = (clients || []).find((c: any) => c.id === rechargeModal.clientId);
    fireWebhook(webhooks.adsRecharge, {
      client_id: rechargeModal.clientId,
      client_name: client?.full_name || '',
      client_email: client?.email || '',
      amount,
      platform: rechargeModal.platform,
      urgency: 'normal',
    });

    setRechargeModal(null);
    setRechargeForm({ amount: "", reason: "", period: "semanal" });
  };

  // Pedidos de recarga sendo concluídos agora: dois cliques rápidos não somam a recarga duas vezes.
  const concluindoRecarga = useRef(new Set<string>());

  const handleCompleteRecharge = async (r: any) => {
    if (concluindoRecarga.current.has(r.id)) return;
    concluindoRecarga.current.add(r.id);
    try {
      const wallet = (wallets || []).find((w: any) => w.client_id === r.client_id && w.platform === r.platform);
      let saldoAnterior: { balance: number; last_recharge_date: string | null } | null = null;
      let novoSaldo = 0;
      if (wallet) {
        // O saldo vem do banco, não do cache da tela: se o cliente gastou ou outra recarga entrou desde
        // que a lista carregou, somar em cima do wallet.balance antigo apagava esse movimento.
        const { data: atual, error: erroDaLeitura } = await supabase
          .from("ads_wallet").select("balance, last_recharge_date").eq("id", wallet.id).maybeSingle();
        if (erroDaLeitura || !atual) {
          toast.error("Não consegui ler o saldo atual da wallet. A recarga não foi concluída.");
          return;
        }
        saldoAnterior = { balance: Number(atual.balance) || 0, last_recharge_date: atual.last_recharge_date ?? null };
        novoSaldo = saldoAnterior.balance + Number(r.amount);
        // Grava só se o saldo ainda é o que acabou de ser lido: um gasto ou outra recarga entre a leitura e a
        // gravação seria apagado pela soma feita sobre o valor velho.
        const { data: gravados, error: erroDoSaldo } = await supabase.from("ads_wallet").update({
          balance: novoSaldo,
          last_recharge_date: new Date().toISOString(),
        }).eq("id", wallet.id).eq("balance", saldoAnterior.balance).select("id");
        if (erroDoSaldo) {
          toast.error("Não consegui atualizar o saldo da wallet. A recarga não foi concluída.");
          return;
        }
        if (!gravados || gravados.length === 0) {
          queryClient.invalidateQueries({ queryKey: ["ads-wallet"] });
          toast.error("O saldo da wallet mudou enquanto a recarga era concluída. Nada foi alterado; tente de novo.");
          return;
        }
      }
      // Só conclui o pedido que ainda está aprovado: se outra aba já concluiu, o update não acha linha
      // e o saldo somado acima é desfeito, em vez de a recarga contar duas vezes.
      const { data: concluidos, error: erroDoPedido } = await supabase
        .from("recharge_requests").update({ status: "completed", approved_by: user?.id })
        .eq("id", r.id).eq("status", "approved").select("id");
      if (erroDoPedido || !concluidos || concluidos.length === 0) {
        if (wallet && saldoAnterior) {
          // Desfaz só se ninguém mexeu no saldo depois de nós.
          await supabase.from("ads_wallet").update(saldoAnterior).eq("id", wallet.id).eq("balance", novoSaldo);
        }
        queryClient.invalidateQueries({ queryKey: ["recharge-requests"] });
        queryClient.invalidateQueries({ queryKey: ["ads-wallet"] });
        toast.error(erroDoPedido
          ? "Não consegui concluir o pedido de recarga. O saldo foi mantido como estava."
          : "Este pedido não está mais aprovado (talvez já tenha sido concluído). O saldo foi mantido como estava.");
        return;
      }
      // Notify client
      await notifyUser(r.client_id, `Recarga de ${fmt(Number(r.amount))} para ${r.platform} concluída. Saldo atualizado`, "billing", "/financeiro");
      queryClient.invalidateQueries({ queryKey: ["recharge-requests"] });
      queryClient.invalidateQueries({ queryKey: ["ads-wallet"] });
      toast.success("Saldo atualizado!");
    } finally {
      concluindoRecarga.current.delete(r.id);
    }
  };

  const handleSendReminder = async (client: any, via: "notification" | "whatsapp") => {
    const billingRecord = billingBRL.find((b: any) => b.client_id === client.id && b.type === "renewal" && b.status === "pending");
    const renewalDate = client.plan_renewal_date ? formatAppDate(client.plan_renewal_date) : "em breve";

    if (via === "whatsapp") {
      const phone = client.phone?.replace(/\D/g, "") || "";
      const msg = encodeURIComponent(`Olá! Seu plano renova em ${renewalDate}. Os resultados estão crescendo! Para garantir a continuidade, confirme a renovação.`);
      window.open(`https://wa.me/${phone}?text=${msg}`, "_blank");
    } else {
      await notifyUser(client.id, `Olá! Seu plano renova em ${renewalDate}. Garanta a continuidade dos seus resultados!`, "billing", "/financeiro");
      toast.success("Lembrete enviado");
    }

    if (billingRecord) {
      await supabase.from("billing").update({ reminder_count: (billingRecord.reminder_count || 0) + 1 }).eq("id", billingRecord.id);
      queryClient.invalidateQueries({ queryKey: ["billing"] });
    }
  };

  const handleEditPlan = async () => {
    if (!editPlanModal) return;
    const valor = planForm.amount ? parseFloat(planForm.amount) : null;
    // O valor mensal mora no perfil (plan_value): é dele que o gatilho de renovação tira o valor da
    // próxima cobrança. Mudar só a cobrança fazia a mensalidade seguinte nascer com o valor antigo.
    const perfil = {
      ...(planForm.renewal_date ? { plan_renewal_date: planForm.renewal_date } : {}),
      ...(valor !== null && Number.isFinite(valor) ? { plan_value: valor } : {}),
    };
    if (Object.keys(perfil).length > 0) {
      const { error } = await supabase.from("profiles").update(perfil).eq("id", editPlanModal.id);
      if (error) {
        toast.error("Não consegui salvar o plano do cliente. Nada foi alterado.");
        return;
      }
    }
    if (planForm.amount || planForm.description) {
      // Só a renovação ainda em aberto acompanha o plano. Antes pegava qualquer "renewal" (podia ser uma
      // já paga) e reescrevia o valor de um recebimento passado.
      const billingRecord = billingBRL
        .filter((b: any) => b.client_id === editPlanModal.id && b.type === "renewal" && b.status === "pending")
        .sort((a: { due_date?: string | null }, b: { due_date?: string | null }) => String(b.due_date || "").localeCompare(String(a.due_date || "")))[0];
      if (billingRecord) {
        const { error } = await supabase.from("billing").update({
          ...(valor !== null && Number.isFinite(valor) ? { amount: valor } : {}),
          ...(planForm.description ? { description: planForm.description } : {}),
          ...(planForm.renewal_date ? { due_date: planForm.renewal_date } : {}),
        }).eq("id", billingRecord.id).eq("status", "pending");
        if (error) {
          queryClient.invalidateQueries({ queryKey: ["clients"] });
          toast.error("O plano foi salvo, mas não consegui atualizar a cobrança pendente. Tente salvar de novo.");
          return;
        }
      }
    }
    queryClient.invalidateQueries({ queryKey: ["billing"] });
    queryClient.invalidateQueries({ queryKey: ["clients"] });
    toast.success("Plano atualizado");
    setEditPlanModal(null);
    setPlanForm({ amount: "", renewal_date: "", description: "" });
  };

  const openWhatsAppReminder = (client: any, billingItem: any) => {
    const phone = client?.phone?.replace(/\D/g, "") || "";
    const msg = encodeURIComponent(`Olá! Lembramos que há uma fatura de ${fmt(Number(billingItem.amount))} com vencimento em ${formatAppDate(billingItem.due_date)}. Qualquer dúvida estamos à disposição!`);
    window.open(`https://wa.me/${phone}?text=${msg}`, "_blank");
  };

  const logAudit = async (entityType: string, entityId: string, action: string, oldStatus: string | null, newStatus: string, oldAmount: number | null, newAmount: number, notes?: string) => {
    await supabase.from("payment_audit_log").insert({
      entity_type: entityType, entity_id: entityId, action, old_status: oldStatus, new_status: newStatus,
      old_amount: oldAmount, new_amount: newAmount, notes: notes || null, performed_by: user?.id || null,
    } as any);
    queryClient.invalidateQueries({ queryKey: ["payment-audit-log"] });
  };

  const handlePayFromPanel = async () => {
    if (!payModal) return;
    const today = toLocalDateKey();
    const paidAmount = payType === "full" ? payModal.amount : (parseFloat(payPartialAmount) || 0);

    if (payModal.type === "billing") {
      if (payModal.billingType === "freela") {
        toast.info("A baixa do freela é no caixa da mesa Freela.");
        setPayModal(null);
        return;
      }
      if (payType === "full") {
        await handleMarkPaid(payModal.id);
      } else {
        const { data: currentBill, error: fetchError } = await supabase
          .from("billing")
          .select("*")
          .eq("id", payModal.id)
          .maybeSingle();
        if (fetchError) {
          toast.error(fetchError.message);
          return;
        }
        if (!currentBill || currentBill.status !== "pending") {
          await queryClient.invalidateQueries({ queryKey: ["billing"] });
          toast.info("Esse lançamento já saiu dos pendentes");
          return;
        }
        const remaining = Math.max(payModal.amount - paidAmount, 0);
        const isFullyPaidNow = paidAmount >= payModal.amount;
        // Marca a fatura ORIGINAL como "partial" (não "paid") quando recebido < total.
        // Assim "Recebido" considera apenas o valor realmente pago e dashboards param de inflar.
        const { data: updatedRows, error: updateError } = await supabase.from("billing").update({
          status: isFullyPaidNow ? "paid" : "partial",
          paid_date: today,
          paid_amount: paidAmount,
          description: `${currentBill.description || "Fatura"} (parcial: ${fmt(paidAmount)} de ${fmt(payModal.amount)})`,
        } as any).eq("id", payModal.id).eq("status", "pending").select();
        if (updateError) {
          toast.error(updateError.message);
          return;
        }
        if (!updatedRows || updatedRows.length === 0) {
          await queryClient.invalidateQueries({ queryKey: ["billing"] });
          toast.info("Esse lançamento já saiu dos pendentes");
          return;
        }
        if (remaining > 0 && payModal.clientId) {
          const { error: insertError } = await supabase.from("billing").insert({
            client_id: payModal.clientId,
            type: currentBill.type || "renewal",
            amount: remaining,
            due_date: currentBill.due_date || today,
            description: `Saldo restante: ${fmt(remaining)}`,
            // O saldo de uma cobrança de extra continua ligado ao extra, senão some da ficha do cliente.
            ...((currentBill as any).extra_id ? { extra_id: (currentBill as any).extra_id } : {}),
          } as any);
          if (insertError) {
            // A original já virou "partial" e o saldo só existe na linha nova: sem ela, o restante sumia de
            // A receber, atrasados e régua (todos leem "pending") e a tela ainda dizia sucesso. Desfaz o parcial.
            const { error: rollbackError } = await supabase.from("billing").update({
              status: "pending",
              paid_date: currentBill.paid_date ?? null,
              paid_amount: currentBill.paid_amount ?? null,
              description: currentBill.description ?? null,
            }).eq("id", payModal.id).eq("status", "partial");
            await queryClient.invalidateQueries({ queryKey: ["billing"] });
            toast.error(
              rollbackError
                ? `Não consegui criar o saldo restante (${insertError.message}) nem desfazer o parcial. Confira esta cobrança.`
                : `Não consegui registrar o saldo restante: ${insertError.message}. A cobrança voltou a pendente.`,
            );
            return;
          }
        }
        await logAudit("billing", payModal.id, "paid_partial", "pending", isFullyPaidNow ? "paid" : "partial", payModal.amount, paidAmount, `${payModal.label}, restante: ${fmt(remaining)}`);
        if (payModal.clientId) {
          await notifyUser(payModal.clientId, `Pagamento parcial de ${fmt(paidAmount)} registrado. Restante: ${fmt(remaining)}`, "billing", "/financeiro");
        }
        queryClient.invalidateQueries({ queryKey: ["billing"] });
        queryClient.invalidateQueries({ queryKey: ["clients"] });
        toast.success("Pagamento parcial registrado!");
      }
    } else if (payModal.type === "installment") {
      const { data: currentInstallment, error: fetchError } = await supabase
        .from("payment_installments")
        .select("*")
        .eq("id", payModal.id)
        .maybeSingle();
      if (fetchError) {
        toast.error(fetchError.message);
        return;
      }
      if (!currentInstallment || currentInstallment.status === "paid") {
        await queryClient.invalidateQueries({ queryKey: ["all-project-payments-finance"] });
        toast.info("Essa parcela já estava quitada");
        return;
      }
      const total = Number(currentInstallment.amount) || Number(payModal.totalAmount) || payModal.amount;
      const currentPaid = Number(currentInstallment.paid_amount || 0);
      const amountDue = Math.max(total - currentPaid, 0);
      if (amountDue <= 0.01) {
        await supabase.from("payment_installments").update({ status: "paid", paid_amount: total, paid_date: currentInstallment.paid_date || today } as any).eq("id", payModal.id);
        await queryClient.invalidateQueries({ queryKey: ["all-project-payments-finance"] });
        toast.info("Essa parcela já estava quitada");
        return;
      }
      const paymentValue = payType === "full" ? amountDue : Math.min(paidAmount, amountDue);
      const newPaidTotal = Math.min(currentPaid + paymentValue, total);
      const newStatus = newPaidTotal >= total ? "paid" : "partial";
      const updateInstallment = () => {
        let q = supabase
          .from("payment_installments")
          .update({ status: newStatus, paid_amount: newPaidTotal, paid_date: today } as any)
          .eq("id", payModal.id)
          .eq("status", currentInstallment.status || "pending");
        q = currentPaid > 0 ? q.eq("paid_amount", currentPaid) : q.or("paid_amount.is.null,paid_amount.eq.0");
        return q.select();
      };
      const { data: updatedRows, error: updateError } = await updateInstallment();
      if (updateError) {
        toast.error(updateError.message);
        return;
      }
      if (!updatedRows || updatedRows.length === 0) {
        await queryClient.invalidateQueries({ queryKey: ["all-project-payments-finance"] });
        toast.info("Essa parcela já saiu dos pendentes");
        return;
      }
      if (payType === "full") {
        await logAudit("installment", payModal.id, "paid_full", currentInstallment.status || "pending", newStatus, total, paymentValue, payModal.label);
      } else {
        await logAudit("installment", payModal.id, "paid_partial", currentInstallment.status || "pending", newStatus, total, paymentValue, payModal.label);
      }
      queryClient.invalidateQueries({ queryKey: ["all-project-payments-finance"] });
      queryClient.invalidateQueries({ queryKey: ["payment-installments"] });
      toast.success(payType === "full" ? "Parcela paga!" : "Pagamento parcial registrado!");
    }

    setPayModal(null);
    setPayType("full");
    setPayPartialAmount("");
  };

  // Group wallets by client
  const walletsByClient: Record<string, any[]> = {};
  (wallets || []).forEach((w: any) => {
    if (!walletsByClient[w.client_id]) walletsByClient[w.client_id] = [];
    walletsByClient[w.client_id].push(w);
  });

  /* ---------------- Visão geral: números, listas e gráficos ---------------- */
  const showMonthly = brandFilter === "all" || brandFilter === "aceleriq";
  const showIndiv = brandFilter === "all" || brandFilter === "sitebolt";
  const primeiraCarga = billingLoading && !billing;
  const erroAoLer = (billingQuery.isError && !billing) || (paymentsQuery.isError && !projectPayments);
  const tentarDeNovo = () => {
    void billingQuery.refetch?.();
    void paymentsQuery.refetch?.();
  };

  const contaProjeto = origem !== "freela" && showIndiv;
  const pendingVal = (showMonthly ? pendingTotal : 0) + (contaProjeto ? indivPending : 0);
  const receivedVal = (showMonthly ? receivedTotal : 0) + (contaProjeto ? indivPaid : 0);
  const overdueVal = (showMonthly ? overdueTotal : 0) + (contaProjeto ? indivOverdue : 0);
  const subLabel = origem === "freela"
    ? "Parcelas em real"
    : brandFilter === "all" ? `AcelerIQ ${fmt(showMonthly ? pendingTotal : 0)} · SiteBolt ${fmt(showIndiv ? indivPending : 0)}` : undefined;
  const recSub = origem === "freela"
    ? "Parcelas em real"
    : brandFilter === "all" ? `AcelerIQ ${fmt(showMonthly ? receivedTotal : 0)} · SiteBolt ${fmt(showIndiv ? indivPaid : 0)}` : undefined;
  const ovSub = origem === "freela"
    ? "Parcelas em real"
    : brandFilter === "all" ? `AcelerIQ ${fmt(showMonthly ? overdueTotal : 0)} · SiteBolt ${fmt(showIndiv ? indivOverdue : 0)}` : undefined;
  const noPeriodo = periodFilter === "month" ? "no mês" : "no geral";
  const nextMonthFull = MONTHS_FULL[nextMonth];
  const nextMonthSub = brandFilter === "all" ? `AcelerIQ ${fmt(nextMonthRecurring)} · SiteBolt ${fmt(nextMonthIndiv)}` : (brandFilter === "aceleriq" ? "Planos recorrentes" : "Parcelas de projetos");
  const receivedBreakdown = origem === "freela"
    ? "Parcelas em real. Dólar fica no card do Freela."
    : brandFilter === "all"
    ? `Planos ${fmt(showMonthly ? receivedTotal : 0)} · Projetos ${fmt(contaProjeto ? indivPaid : 0)}`
    : recSub;
  const numeros: { rotulo: string; valor: string; sub?: string; icone: ReactNode; cor: string; ajuda?: string }[] = [
    {
      rotulo: "Saldo em caixa",
      valor: fmt(cashBalance),
      sub: reservedInBoxes > 0 ? `Caixinhas ${fmt(reservedInBoxes)} · livre ${fmt(cashBalance - reservedInBoxes)}` : undefined,
      icone: <DollarSign className="h-3.5 w-3.5" />,
      cor: "text-primary",
      ajuda: "Base de meses anteriores + tudo que entrou − tudo que saiu. Concilie no Fluxo de caixa.",
    },
    { rotulo: `Recebido ${noPeriodo}`, valor: fmt(receivedVal), sub: receivedBreakdown, icone: <TrendingUp className="h-3.5 w-3.5" />, cor: "text-success" },
    { rotulo: `A receber ${noPeriodo}`, valor: fmt(pendingVal), sub: subLabel, icone: <CreditCard className="h-3.5 w-3.5" />, cor: "text-warning" },
    { rotulo: "Atrasado", valor: fmt(overdueVal), sub: ovSub, icone: <CreditCard className="h-3.5 w-3.5" />, cor: "text-destructive" },
    ...(periodFilter === "month" && origem !== "freela" ? [{
      rotulo: "Receita esperada",
      valor: fmt((showMonthly ? expectedMonthlyRevenue : 0) + (showIndiv ? indivPendingMonth : 0)),
      sub: brandFilter === "all"
        ? `Planos ${fmt(expectedMonthlyRevenue)} · Parcelas ${fmt(indivPendingMonth)}`
        : (brandFilter === "aceleriq" ? "Planos ativos AcelerIQ" : "Parcelas avulsas do mês"),
      icone: <CheckCircle2 className="h-3.5 w-3.5" />,
      cor: "text-info",
    }] : []),
  ];
  const mostraProjecao = origem !== "freela";
  const totalDeNumeros = numeros.length + (mostraProjecao ? 1 : 0);

  // Card do Freela: recebido no mês e em aberto, cada um em R$ e US$.
  // O dólar nunca entra nos totais em real da faixa de cima.
  const freelaDoCaixa = (billing || []).filter((b: any) => daOrigemFreela(b));
  const mesDoFreela = periodFilter === "month" ? selMonth : thisMonth;
  const anoDoFreela = periodFilter === "month" ? selYear : thisYear;
  const nomeMesFreela = MONTHS_SHORT[mesDoFreela];
  const somaFreela = (moeda: "BRL" | "USD", modo: "recebido" | "aberto") =>
    freelaDoCaixa
      .filter((b: any) => moedaDe(b) === moeda)
      .reduce((s: number, b: any) => {
        if (modo === "recebido") {
          if (b.status !== "paid" && b.status !== "partial") return s;
          const d = parseAppDate(b.paid_date || b.due_date);
          if (!d || d.getMonth() !== mesDoFreela || d.getFullYear() !== anoDoFreela) return s;
          return s + receivedOf(b);
        }
        if (b.status === "pending") return s + (Number(b.amount) || 0);
        if (b.status === "partial") return s + Math.max((Number(b.amount) || 0) - (Number(b.paid_amount) || 0), 0);
        return s;
      }, 0);
  const cardFreela = (rotulo: string, moeda: "BRL" | "USD", modo: "recebido" | "aberto") => ({
    rotulo,
    valor: billingLoading ? <span className="block h-6 w-24 animate-pulse rounded bg-muted" aria-label={`Carregando ${rotulo}`} /> : fmtMoeda(somaFreela(moeda, modo), moeda),
    ponto: (modo === "recebido" ? "verde" : "alerta") as "verde" | "alerta",
    para: "/freela/caixa",
    dica: "Abrir o caixa do Freela",
  });

  const linhasDoFreela: Array<[string, "BRL" | "USD", "recebido" | "aberto"]> = [
    [`Recebido em ${nomeMesFreela} (R$)`, "BRL", "recebido"],
    [`Recebido em ${nomeMesFreela} (US$)`, "USD", "recebido"],
    ["Em aberto (R$)", "BRL", "aberto"],
    ["Em aberto (US$)", "USD", "aberto"],
  ];
  const todosOsCardsDoFreela = linhasDoFreela.map(([r, moeda, modo]) => cardFreela(r, moeda, modo));
  const cardsDoFreela = linhasDoFreela.filter(([, moeda, modo]) => somaFreela(moeda, modo) > 0).map(([r, moeda, modo]) => cardFreela(r, moeda, modo));

  // A receber: cobranças pendentes, parcelas abertas e planos ativos ainda sem cobrança.
  const itemDaCobranca = (b: any) => {
    const client = (clients || []).find((c: any) => c.id === b.client_id);
    const due = parseAppDate(b.due_date);
    // Freela não tem cliente ligado (client_id NULL): aparece como "Freela" e
    // a baixa é na mesa /freela (o front nunca escreve no billing do freela).
    const freela = ehCobrancaFreela(b);
    return { id: b.id, label: b.description || (freela ? "Parcela freela" : "Renovação Mensal"), client: b.client_id ? (client?.company_name || client?.full_name || "-") : "Freela", amount: Number(b.amount), due: b.due_date, brand: "AcelerIQ", isOverdue: due ? due < todayStart : false, itemType: "billing" as const, clientId: b.client_id, billingType: b.type, freela };
  };
  const monthlyPendingItems = showMonthly ? pendingBillsInActivePeriod.filter((b: any) => b.type !== "ads_recharge").map(itemDaCobranca) : [];
  const itensDasParcelas = (vale: (i: any) => boolean) => showIndiv && origem !== "freela" ? filteredPayments.flatMap((pp: any) =>
    (pp.installments || []).filter((i: any) => (i.status === "pending" || i.status === "partial") && vale(i)).map((i: any) => ({
      id: i.id, label: `${pp.project?.name || "Projeto"} · ${i.installment_number === 0 ? "Entrada" : `Parcela ${i.installment_number}`}`,
      client: pp.client?.company_name || pp.client?.full_name || "-", amount: Number(i.amount) - Number(i.paid_amount || 0), due: i.due_date,
      brand: getProjectBrand(pp.project?.project_type), isOverdue: (() => { const due = parseAppDate(i.due_date); return due ? due < todayStart : false; })(), itemType: "installment" as const, clientId: pp.client_id, paidSoFar: Number(i.paid_amount || 0), totalAmount: Number(i.amount),
    }))
  ) : [];
  const indivPendingItems = itensDasParcelas(() => true);
  // Na visão do mês, o que vence depois do mês escolhido não some: fica numa lista própria logo abaixo,
  // com o mesmo "Pagar". Pedido do dono (15/11): "todos que eu lançar têm que aparecer ali como a pagar".
  const depoisDoMes = (d?: string | null) => {
    const data = parseAppDate(d || "");
    return !!data && data.getFullYear() * 12 + data.getMonth() > selYear * 12 + selMonth;
  };
  const aReceberDepois: any[] = periodFilter === "month" ? [
    ...(showMonthly ? pendingBills.filter((b: any) => b.type !== "ads_recharge" && !isPausedRenewal(b) && depoisDoMes(b.due_date)).map(itemDaCobranca) : []),
    ...itensDasParcelas((i: any) => depoisDoMes(i.due_date)),
  ].sort((a, b) => (parseAppDate(a.due)?.getTime() || 0) - (parseAppDate(b.due)?.getTime() || 0)) : [];
  const aReceberDepoisTotal = aReceberDepois.reduce((t: number, it: any) => t + Number(it.amount || 0), 0);
  const extraItems = showMonthly && origem !== "freela" ? clientsWithPlanNotInBilling.map((c: any) => ({
    id: `extra-${c.id}`, label: c.plan_name ? `Renovação · ${c.plan_name}` : "Renovação Mensal",
    client: c.company_name || c.full_name, amount: Number(c.plan_value), due: c.plan_renewal_date || "",
    brand: "AcelerIQ", isOverdue: (() => { const due = parseAppDate(c.plan_renewal_date); return due ? due < todayStart : false; })(), itemType: "extra" as const, clientId: c.id,
  })) : [];
  const allPending: any[] = [...monthlyPendingItems, ...indivPendingItems, ...extraItems]
    .sort((a, b) => (parseAppDate(a.due)?.getTime() || 0) - (parseAppDate(b.due)?.getTime() || 0));
  const linhaAReceber = (item: any) => (
                        <li key={item.id} className={linhaDaLista}>
                          <Avatar name={item.client} className="mr-3 hidden sm:inline-flex" />
                          <div className="mr-3 min-w-0 flex-1">
                            <p className={juntar(texto.corpo, "truncate")}>{item.label}</p>
                            <p className={juntar(texto.auxiliar, "truncate")}>
                              {item.client}
                              <span className="hidden sm:inline"> · {item.brand}</span>
                              {item.paidSoFar > 0 && <span className="text-success"> · já pago {fmt(item.paidSoFar)}</span>}
                            </p>
                          </div>
                          <div className="mr-3 flex shrink-0 flex-col items-end">
                            <span className="text-[13px] font-semibold tabular-nums text-foreground">{fmt(item.amount)}</span>
                            {item.isOverdue ? (
                              <StatusPill tone="danger" className="mt-1">Atrasado</StatusPill>
                            ) : (
                              <span className="mt-0.5 text-[12px] tabular-nums text-muted-foreground">{formatAppDate(item.due)}</span>
                            )}
                           </div>
                          {item.freela ? (
                            <Link to="/freela/caixa" className={juntar(acaoDaLinha, "text-primary")}>
                              Ver no Freela
                            </Link>
                          ) : (
                            <button type="button" onClick={() => void abrirPagamento(item)} className={acaoPrincipalDaLinha}>
                              Pagar
                            </button>
                          )}
                        </li>
  );
  const allPendingTotal = allPending.reduce((s: number, it: any) => s + Number(it.amount || 0), 0);

  const abrirPagamento = async (item: any) => {
    let realId = item.id;
    // For "extra" items (plan_value but no billing row), create the billing first
    if (item.itemType === "extra" && item.clientId) {
      const { data: newBill, error } = await supabase.from("billing").insert({
        client_id: item.clientId,
        type: "renewal",
        amount: item.amount,
        due_date: item.due || toLocalDateKey(),
        description: item.label,
      }).select().single();
      if (error || !newBill) { toast.error("Erro ao gerar cobrança"); return; }
      realId = newBill.id;
      await queryClient.invalidateQueries({ queryKey: ["billing"] });
    }
    setPayModal({
      id: realId,
      type: item.itemType === "installment" ? "installment" : "billing",
      label: item.label,
      amount: item.itemType === "installment" ? item.totalAmount || item.amount : item.amount,
      clientId: item.clientId,
      billingType: item.billingType || "renewal",
      paidSoFar: item.paidSoFar || 0,
      totalAmount: item.totalAmount || item.amount,
    });
    setPayType("full");
    setPayPartialAmount("");
  };

  // Já recebido: histórico unificado (planos + projetos)
  const billingItems = showMonthly
    ? paidBills
        .filter((b: any) => b.type !== "ads_recharge")
        .map((b: any) => ({
          id: `bill-${b.id}`,
          label: b.description || (ehCobrancaFreela(b) ? "Parcela freela" : b.type === "renewal" ? "Renovação Mensal" : "Serviço Extra"),
          client: ehCobrancaFreela(b) ? "Freela" : (b.client?.company_name || b.client?.full_name || "-"),
          brand: "AcelerIQ",
          amount: receivedOf(b),
          totalAmount: Number(b.amount) || 0,
          isPartial: b.status === "partial" || (Number(b.paid_amount) > 0 && Number(b.paid_amount) < Number(b.amount)),
          date: b.paid_date || b.due_date,
          icon: typeIcon(b.type),
        }))
    : [];
  const installmentItems = showIndiv
    ? filteredPayments.flatMap((pp: any) =>
        (pp.installments || [])
          .filter((i: any) => i.status === "paid" || i.status === "partial")
          .map((i: any) => ({
            id: `inst-${i.id}`,
            label: `${pp.project?.name || "Projeto"} · Parcela ${i.installment_number}${i.status === "partial" ? " (parcial)" : ""}`,
            client: pp.client?.company_name || pp.client?.full_name || "-",
            brand: getProjectBrand(pp.project?.project_type),
            amount: receivedOf(i),
            totalAmount: Number(i.amount) || 0,
            isPartial: i.status === "partial" || (Number(i.paid_amount) > 0 && Number(i.paid_amount) < Number(i.amount)),
            date: i.paid_date || i.due_date,
            icon: "PRJ",
          }))
      )
    : [];
  const allReceived = [...billingItems, ...installmentItems].sort(
    (a, b) => (parseAppDate(b.date)?.getTime() || 0) - (parseAppDate(a.date)?.getTime() || 0)
  );
  const receivedFiltered = allReceived.filter((it) => {
    const d = parseAppDate(it.date);
    if (!d) return false;
    if (receivedFilter === "month") return d.getMonth() === selMonth && d.getFullYear() === selYear;
    if (receivedFilter === "last3") { const lim = new Date(); lim.setMonth(lim.getMonth() - 3); return d >= lim; }
    if (receivedFilter === "year") return d.getFullYear() === selYear;
    return true;
  });
  const receivedFilteredTotal = receivedFiltered.reduce((s, it) => s + it.amount, 0);
  const receivedGrandTotal = allReceived.reduce((s, it) => s + it.amount, 0);

  // Projetos individuais (SiteBolt / avulsos)
  const enrichedProjects = filteredPayments.map((pp: any) => {
    const paid = (pp.installments || [])
      .filter((i: any) => i.status === "paid" || i.status === "partial")
      .reduce((s: number, i: any) => s + receivedOf(i), 0);
    const pct = pp.total_value > 0 ? Math.round((paid / Number(pp.total_value)) * 100) : 0;
    const hasOverdue = (pp.installments || []).some((i: any) => {
      const due = parseAppDate(i.due_date);
      return i.status === "pending" && !!due && due < todayStart;
    });
    const remaining = Number(pp.total_value) - paid;
    const group = remaining <= 0.01 ? "quitado" : hasOverdue ? "atrasado" : "andamento";
    return { ...pp, _paid: paid, _pct: pct, _remaining: remaining, _hasOverdue: hasOverdue, _group: group };
  });
  const quitados = enrichedProjects.filter((p: any) => p._group === "quitado");
  const andamento = enrichedProjects.filter((p: any) => p._group === "andamento");
  const atrasados = enrichedProjects.filter((p: any) => p._group === "atrasado");

  // Receita mês a mês (ano corrente)
  const chartData: { name: string; recebido: number; pendente: number }[] = [];
  const currentYear = now.getFullYear();
  for (let m = 0; m < 12; m++) {
    let received = 0;
    let pending = 0;
    if (showMonthly) {
      received += billingDaOrigem
        .filter((b: any) => (b.status === "paid" || b.status === "partial") && b.type !== "ads_recharge")
        .filter((b: any) => { const d = parseAppDate(b.paid_date || b.due_date); return !!d && d.getMonth() === m && d.getFullYear() === currentYear; })
        .reduce((s: number, b: any) => s + receivedOf(b), 0);
      pending += billingDaOrigem
        .filter((b: any) => b.status === "pending" && b.type !== "ads_recharge" && !isPausedRenewal(b))
        .filter((b: any) => { const d = parseAppDate(b.due_date); return !!d && d.getMonth() === m && d.getFullYear() === currentYear; })
        .reduce((s: number, b: any) => s + Number(b.amount), 0);
    }
    if (showIndiv && origem !== "freela") {
      filteredPayments.forEach((pp: any) => {
        (pp.installments || []).forEach((inst: any) => {
          const d = parseAppDate(inst.paid_date || inst.due_date);
          if (d && d.getMonth() === m && d.getFullYear() === currentYear) {
            if (inst.status === "paid") received += Number(inst.amount);
            else if (inst.status === "partial") received += Number(inst.paid_amount || 0);
            else if (inst.status === "pending") pending += Number(inst.amount);
          }
        });
      });
    }
    if (received > 0 || pending > 0 || m <= now.getMonth()) {
      chartData.push({ name: MONTHS_SHORT[m], recebido: received, pendente: pending });
    }
  }

  // Proporção da receita: AcelerIQ x SiteBolt (tudo que já entrou)
  const allPaymentsForPie = origem === "freela" ? [] : (projectPayments || []);
  const aceleriqReceived = paidBills
    .filter((b: any) => b.type !== "ads_recharge")
    .reduce((s: number, b: any) => s + receivedOf(b), 0);
  const siteboltReceived = allPaymentsForPie
    .filter((pp: any) => ["site", "landing_page", "event", "other"].includes(pp.project?.project_type))
    .reduce((sum: number, pp: any) =>
      sum + (pp.installments || [])
        .filter((i: any) => i.status === "paid" || i.status === "partial")
        .reduce((s: number, i: any) => s + receivedOf(i), 0), 0);
  const jointReceived = allPaymentsForPie
    .filter((pp: any) => pp.project?.project_type === "automation")
    .reduce((sum: number, pp: any) =>
      sum + (pp.installments || [])
        .filter((i: any) => i.status === "paid" || i.status === "partial")
        .reduce((s: number, i: any) => s + receivedOf(i), 0), 0);
  const pieData = [
    { name: origem === "freela" ? "Freela (R$)" : "AcelerIQ", value: aceleriqReceived, color: "hsl(var(--success))" },
    { name: "SiteBolt", value: siteboltReceived, color: "hsl(var(--primary))" },
    ...(jointReceived > 0 ? [{ name: "AcelerIQ + SiteBolt", value: jointReceived, color: "hsl(var(--info))" }] : []),
  ].filter(d => d.value > 0);
  const pieTotal = pieData.reduce((s, d) => s + d.value, 0);

  const semNadaNoFinanceiro = (!billing || billing.length === 0) && pendingBills.length === 0 && paidBills.length === 0 && (projectPayments || []).length === 0;

  /* ---------------- Topo ---------------- */
  const mostrarMes = isAdmin && ((aba === "overview" && periodFilter === "month") || aba === "fixedcosts");
  const mudarMes = (passo: number) => {
    const d = new Date(selYear, selMonth + passo, 1);
    setMesEscolhido({ m: d.getMonth(), y: d.getFullYear() });
  };
  const opcoesDasAbas: OpcaoCompacta[] = abasPermitidas.map((a) => ({ valor: a.valor, rotulo: a.rotulo, icone: a.icone }));
  const abrirNovaCobranca = () => setNewBillingOpen(true);

  return (
    <div className="min-w-0 space-y-6 pb-4 sm:space-y-8">
      <CabecalhoDePagina
        titulo="Financeiro"
        ajuda="Cobranças, recebimentos, mensalidades, wallets de anúncios e histórico de pagamentos. A visão geral segue o mês e a marca escolhidos."
        acoes={
          (mostrarMes || isAdmin || opcoesDasAbas.length > 1) ? (
            <>
              {/* Seletores pequenos moram na linha do título (nada de linha própria). */}
              {isAdmin && <BotaoDoCrescimento />}
              {opcoesDasAbas.length > 1 && (
                <SeletorCompacto
                  opcoes={opcoesDasAbas}
                  valor={aba}
                  onEscolher={setAba}
                  rotulo="Área do financeiro"
                  icone={<LayoutList className="h-3.5 w-3.5" />}
                />
              )}
              {isAdmin && aba === "overview" && (
                <>
                  <SeletorCompacto
                    opcoes={[{ valor: "month", rotulo: "Mês" }, { valor: "all", rotulo: "Geral" }]}
                    valor={periodFilter}
                    onEscolher={(v) => setPeriodFilter(v === "all" ? "all" : "month")}
                    rotulo="Período"
                  />
                  <SeletorCompacto
                    opcoes={[
                      { valor: "todos", rotulo: "Todos" },
                      { valor: "agencia", rotulo: "Agência" },
                      { valor: "freela", rotulo: "Freela" },
                    ]}
                    valor={origem}
                    onEscolher={(v) => setOrigem(v === "agencia" || v === "freela" ? v : "todos")}
                    rotulo="Origem"
                  />
                  <SeletorCompacto
                    opcoes={BRAND_FILTERS.map((f) => ({ valor: f.value, rotulo: f.label }))}
                    valor={brandFilter}
                    onEscolher={(v) => setBrandFilter(v as BrandFilter)}
                    rotulo="Marca"
                    modo="lista"
                  />
                </>
              )}
              {isAdmin && aba === "fixedcosts" && (
                <SeletorCompacto
                  opcoes={ABAS_DOS_CUSTOS.map((x) => ({ valor: x.id, rotulo: x.rotulo, icone: <x.icone className="h-3.5 w-3.5" /> }))}
                  valor={abaDosCustos}
                  onEscolher={(v) => setAbaDosCustos(v as AbaDosCustos)}
                  rotulo="Leitura dos custos"
                  listaQuandoNaoCabe
                />
              )}
              {isAdmin && aba === "renewals" && (
                <SeletorCompacto
                  opcoes={[
                    { valor: "mensalistas", rotulo: "Mensalistas" },
                    { valor: "avulsos", rotulo: "Avulsos e histórico" },
                  ]}
                  valor={renewalsView}
                  onEscolher={(v) => setRenewalsView(v === "avulsos" ? "avulsos" : "mensalistas")}
                  rotulo="Tipo de cliente"
                />
              )}
              {mostrarMes && (
                <SeletorDeMes
                  mes={selMonth}
                  ano={selYear}
                  noMesAtual={isCurrentMonthSelected}
                  onMudar={mudarMes}
                  onHoje={() => setMesEscolhido({ m: thisMonth, y: thisYear })}
                />
              )}
              {isAdmin && (
                // Primário só na visão geral; nas outras áreas cada uma tem o seu (um primário por área).
                <button type="button" onClick={abrirNovaCobranca} className={aba === "overview" ? botao.primario : botao.secundario} aria-label="Nova cobrança">
                  <Plus className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Nova cobrança</span>
                </button>
              )}
            </>
          ) : undefined
        }
      />

      <Tabs value={aba} onValueChange={setAba} className="min-w-0">
        {(isAdmin || isManager) && (
          <TabsContent value="cashflow" className="mt-0 space-y-6 sm:space-y-8">
            <CashFlow
              billing={billingBRL}
              projectPayments={projectPayments || []}
              clientsReserveSuggestion={activeMensalistas * (financeSettings?.defaultDirectCost ?? 275)}
            />
          </TabsContent>
        )}

        {(isAdmin || isManager) && (
          <TabsContent value="capital" className="mt-0 space-y-6 sm:space-y-8">
            <InvestorCapital billing={billingBRL} projectPayments={projectPayments || []} />
          </TabsContent>
        )}

        {isAdmin && aba === "cfo" && (
          <TabsContent value="cfo" className="mt-0 space-y-6 sm:space-y-8">
            <Suspense fallback={<Carregando forma="aba" rotulo="Abrindo o CFO" />}>
              <AreaDoCFO />
            </Suspense>
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="assistant" className="mt-0 space-y-6 sm:space-y-8">
            <CFOAssistant billing={billingBRL} projectPayments={projectPayments || []} clients={clients || []} />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="fixedcosts" className="mt-0 space-y-6 sm:space-y-8">
            <FixedCosts monthlyOperationalRevenue={ladderRevenue} grossReceivedThisMonth={monthGrossReceived} aba={abaDosCustos} onAba={setAbaDosCustos} />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="plans" className="mt-0 space-y-6 sm:space-y-8">
            <PlansPricing billing={billingBRL} projectPayments={projectPayments || []} />
          </TabsContent>
        )}

        {isAdmin && aba === "produto" && (
          <TabsContent value="produto" className="mt-0 space-y-6 sm:space-y-8">
            <FaturamentoDoProduto />
          </TabsContent>
        )}

        {/* Visão geral (só admin, como antes) */}
        {isAdmin && (
          <TabsContent value="overview" className="mt-0 space-y-6 sm:space-y-8">
            {erroAoLer && (
              <EstadoDeErro
                titulo="Não foi possível carregar o financeiro."
                descricao="Os números abaixo podem estar incompletos."
                acao={<button type="button" onClick={tentarDeNovo} className={botao.secundario}>Tentar de novo</button>}
              />
            )}

            {/* Rodada ousada (15/11/2026): três por fileira, número grande; o saldo é o cartão de tinta e o recebido o sólido da marca. */}
            <StatGrid cols={3} label="Números do financeiro">
              {numeros.map((n, i) => {
                const previsto = receivedVal + pendingVal;
                return (
                  <StatCard
                    key={n.rotulo}
                    label={n.rotulo}
                    value={billingLoading ? <span className="block h-9 w-32 animate-pulse rounded-full bg-muted" aria-label={`Carregando ${n.rotulo}`} /> : n.valor}
                    hint={billingLoading ? undefined : n.sub}
                    icon={n.icone}
                    help={n.ajuda}
                    size={i === 0 ? "xl" : "lg"}
                    variant={i === 0 ? "ink" : i === 1 ? "accent" : "default"}
                    className={juntar(semIconeNoCelular, i === 0 && "max-sm:col-span-2", i === 3 && overdueVal > 0 && "[&_.ds-stat-valor]:text-destructive")}
                    chart={
                      billingLoading ? undefined : i === 0 && reservedInBoxes > 0 && cashBalance > 0 ? (
                        <ProgressBar value={cashBalance - reservedInBoxes} max={cashBalance} striped label={`Livre ${fmt(cashBalance - reservedInBoxes)} de ${fmt(cashBalance)} em caixa`} />
                      ) : i === 1 && previsto > 0 ? (
                        <ProgressBar value={receivedVal} max={previsto} striped label={`Recebido ${fmt(receivedVal)} de ${fmt(previsto)} (recebido mais a receber)`} />
                      ) : i === 2 && previsto > 0 ? (
                        <ProgressBar value={pendingVal} max={previsto} tone={4} label={`A receber ${fmt(pendingVal)} de ${fmt(previsto)} (recebido mais a receber)`} />
                      ) : i === 3 && pendingVal > 0 ? (
                        <ProgressBar value={overdueVal} max={pendingVal} tone={4} label={`Atrasado ${fmt(overdueVal)} de ${fmt(pendingVal)} a receber`} />
                      ) : undefined
                    }
                  />
                );
              })}
              {mostraProjecao && (
                <StatCard
                  label="Próximo mês"
                  value={fmt(nextMonthTotal)}
                  hint={`${nextMonthFull} ${nextYear}: ${nextMonthSub}`}
                  icon={<ChevronRight className="h-4 w-4" />}
                  corner={<span aria-hidden="true" className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-muted text-foreground"><ChevronRight className="h-4 w-4" /></span>}
                  to="/financeiro/projecao"
                  className={semIconeNoCelular}
                />
              )}
            </StatGrid>

            {/* 13/11/2026 (dono): entrou, saiu, saldo e de onde entrou, com o CRM e E-mail junto. */}
            <DinheiroDoMesLido periodo={`${selYear}-${String(selMonth + 1).padStart(2, "0")}-01`} />

            {/* 09/11/2026 (dono: "mais clean"): quatro zeros do Freela eram só ruído. Aparece o que tem valor; sem
                movimento, uma linha leva ao caixa do Freela. */}
            {billingLoading || cardsDoFreela.length > 0 ? (
              <Numeros
                rotulo="Freela"
                destaques={false}
                tamanho="md"
                colunas={billingLoading ? 4 : (Math.max(2, cardsDoFreela.length) as 2 | 3 | 4)}
                itens={billingLoading ? todosOsCardsDoFreela : cardsDoFreela}
              />
            ) : (
              <p className={texto.auxiliar} data-freela-sem-movimento="">
                <Link to="/freela/caixa" className="underline-offset-2 hover:text-foreground hover:underline">Freela sem movimento em {nomeMesFreela}</Link>
              </p>
            )}

            <ManagementSummary
              monthLabel={`${MONTHS_FULL[selMonth]} ${selYear}`}
              receivedItems={monthReceivedItems}
              expectedMonthlyRevenue={expectedMonthlyRevenue}
              activeClientsCount={activeMensalistas}
              clients={clients || []}
              isCurrentMonth={isCurrentMonthSelected}
            />

            {primeiraCarga ? (
              <Carregando forma="lista" linhas={5} rotulo="Carregando cobranças" />
            ) : semNadaNoFinanceiro ? (
              <EstadoVazio
                icone={<Inbox className="h-5 w-5" />}
                titulo="Nenhuma transação ainda"
                descricao="Use Nova cobrança para lançar a primeira."
              />
            ) : (
              <>
                {/* A receber: tudo que está em aberto (cobranças, parcelas e planos sem cobrança) */}
                {allPending.length > 0 && (
                  <Secao
                    titulo="A receber"
                    descricao={`${allPending.length} ${allPending.length === 1 ? "item" : "itens"} · ${fmt(allPendingTotal)}`}
                    ajuda="Cobranças pendentes, parcelas de projetos em aberto e planos ativos que ainda não têm cobrança. Pagar registra o pagamento total ou parcial."
                    divisoria
                  >
                    <ListaDoFinanceiro memoria="financeiro:a-receber" rotulo="A receber">
                      {allPending.map(linhaAReceber)}
                    </ListaDoFinanceiro>
                  </Secao>
                )}
                {aReceberDepois.length > 0 && (
                  <Secao
                    titulo="A receber nos próximos meses"
                    descricao={`${aReceberDepois.length} ${aReceberDepois.length === 1 ? "item" : "itens"} · ${fmt(aReceberDepoisTotal)}`}
                    ajuda="O que já está lançado e vence depois do mês escolhido. Não entra nos totais do mês; dá para receber adiantado em Pagar."
                    divisoria
                    data-a-receber-depois=""
                  >
                    <ListaDoFinanceiro memoria="financeiro:a-receber-depois" rotulo="A receber nos próximos meses">
                      {aReceberDepois.map(linhaAReceber)}
                    </ListaDoFinanceiro>
                  </Secao>
                )}

                {/* Pendentes a receber: marcar como pago direto ou lembrar pelo WhatsApp */}
                {pendingBillsInActivePeriod.length > 0 && (
                  <Secao
                    titulo="Cobranças pendentes"
                    descricao={`${pendingBillsInActivePeriod.length} ${pendingBillsInActivePeriod.length === 1 ? "cobrança" : "cobranças"} · ${fmt(pendingBillsInActivePeriod.reduce((s: number, b: any) => s + Number(b.amount || 0), 0))}`}
                    ajuda="Marcar como pago registra o valor total, avança a renovação do plano e gera a cobrança do mês seguinte."
                    divisoria
                  >
                    <ListaDoFinanceiro memoria="financeiro:pendentes" rotulo="Cobranças pendentes">
                      {pendingBillsInActivePeriod.map((b: any) => {
                        const due = parseAppDate(b.due_date);
                        const isOverdue = due ? due < todayStart : false;
                        return (
                          <li key={b.id} className={linhaDaLista}>
                            <IconeDaLinha className="hidden sm:inline-flex">{typeIcon(b.type)}</IconeDaLinha>
                            <div className="mr-3 min-w-0 flex-1">
                              <p className={juntar(texto.corpo, "truncate font-medium")}>{b.description || (b.type === "renewal" ? "Renovação Mensal" : b.type === "ads_recharge" ? "Recarga Ads" : b.type === "freela" ? "Parcela freela" : "Serviço Extra")}</p>
                              <p className={juntar(texto.auxiliar, "truncate", isOverdue && "text-destructive")}>{b.client?.company_name || b.client?.full_name || (ehCobrancaFreela(b) ? "Freela" : "Sem cliente")} · vence {formatAppDate(b.due_date)}</p>
                            </div>
                            <div className="mr-2 flex shrink-0 flex-col items-end">
                              <span className="text-[13px] font-semibold tabular-nums text-foreground">{fmtMoeda(Number(b.amount), moedaDe(b))}</span>
                              <span className="mt-1">{statusBadge(b.status, b.due_date)}</span>
                            </div>
                            {/* Freela: a baixa é na mesa /freela (o front nunca escreve no billing do freela). */}
                            {ehCobrancaFreela(b) ? (
                              <Link to="/freela/caixa" className={juntar(acaoDaLinha, "text-primary")} aria-label="Abrir o caixa do freela">
                                <span className="hidden sm:inline">Ver no Freela</span>
                                <CheckCircle2 className="h-3.5 w-3.5 sm:hidden" aria-hidden="true" />
                              </Link>
                            ) : (
                              <>
                                <button type="button" onClick={() => handleMarkPaid(b.id)} className={acaoPrincipalDaLinha} aria-label="Marcar como pago">
                                  <CheckCircle2 className="h-3.5 w-3.5 sm:mr-1" aria-hidden="true" />
                                  <span className="hidden sm:inline">Marcar como pago</span>
                                </button>
                                {b.client && (
                                  <button type="button" onClick={() => openWhatsAppReminder(b.client, b)} className={juntar(botao.icone, "ml-1")} aria-label="Lembrar pelo WhatsApp">
                                    <MessageCircle className="h-4 w-4" aria-hidden="true" />
                                  </button>
                                )}
                              </>
                            )}
                          </li>
                        );
                      })}
                    </ListaDoFinanceiro>
                  </Secao>
                )}

                {/* Já recebido */}
                <Secao
                  titulo="Já recebido"
                  descricao={`${allReceived.length} ${allReceived.length === 1 ? "pagamento" : "pagamentos"} · ${fmt(receivedGrandTotal)}`}
                  divisoria
                >
                    <div className="space-y-3">
                      <div className="-m-1 flex min-w-0 flex-wrap items-center [&>*]:m-1">
                        <SeletorCompacto
                          opcoes={[
                            { valor: "all", rotulo: "Todos" },
                            { valor: "month", rotulo: `${MONTHS_SHORT[selMonth]}/${selYear}` },
                            { valor: "last3", rotulo: "3 meses" },
                            { valor: "year", rotulo: `${selYear}` },
                          ]}
                          valor={receivedFilter}
                          onEscolher={setReceivedFilter}
                          rotulo="Período do recebido"
                        />
                        <span className={juntar(texto.auxiliar, "min-w-0 truncate")}>
                          {receivedFilter === "all" ? "Total" : "Filtrado"}: <span className="tabular-nums text-success">{fmt(receivedFilteredTotal)}</span> ({receivedFiltered.length} {receivedFiltered.length === 1 ? "pagamento" : "pagamentos"})
                        </span>
                      </div>
                      {receivedFiltered.length === 0 ? (
                        <EstadoVazio compacto titulo="Nenhum pagamento neste período." />
                      ) : (
                        <ListaDoFinanceiro memoria="financeiro:recebidos" rotulo="Já recebido">
                          {receivedFiltered.map((it) => (
                            <li key={it.id} className={linhaDaLista}>
                              <IconeDaLinha tom="sucesso" className="hidden sm:inline-flex">{it.icon}</IconeDaLinha>
                              <div className="mr-3 min-w-0 flex-1">
                                <p className={juntar(texto.corpo, "truncate font-medium")}>{it.label}</p>
                                <p className={juntar(texto.auxiliar, "truncate")}>
                                  {it.client} · {it.brand} · pago em {formatAppDate(it.date)}
                                  {it.isPartial && <> · recebido {fmt(it.amount)} de {fmt(it.totalAmount)}</>}
                                </p>
                              </div>
                              <span className="shrink-0 text-[13px] font-semibold tabular-nums text-foreground">+ {fmt(it.amount)}</span>
                            </li>
                          ))}
                        </ListaDoFinanceiro>
                      )}
                    </div>
                </Secao>

                {/* Projetos individuais (SiteBolt / avulsos) */}
                {filteredPayments.length > 0 && (
                  <Secao
                    titulo="Projetos individuais"
                    descricao={[
                      `${quitados.length} ${quitados.length === 1 ? "quitado" : "quitados"}`,
                      andamento.length > 0 ? `${andamento.length} em andamento` : "",
                      atrasados.length > 0 ? `${atrasados.length} ${atrasados.length === 1 ? "atrasado" : "atrasados"}` : "",
                    ].filter(Boolean).join(" · ")}
                    recolhidaDeInicio
                    divisoria
                  >
                    <div className="space-y-4">
                      <Resumo
                        itens={[
                          { rotulo: "Total contratado", valor: fmt(indivTotal), cor: "text-primary" },
                          { rotulo: "Recebido", valor: fmt(indivPaid), cor: "text-success" },
                          { rotulo: "Pendente", valor: fmt(indivPending), cor: "text-warning" },
                          { rotulo: "Atrasado", valor: fmt(indivOverdue), cor: "text-destructive" },
                        ]}
                      />
                        <ListaDoFinanceiro memoria="financeiro:projetos" rotulo="Projetos individuais">
                          {([
                            { chave: "atrasado", rotulo: "Atrasados", cor: "text-destructive", itens: atrasados },
                            { chave: "andamento", rotulo: "Em andamento", cor: "text-warning", itens: andamento },
                            { chave: "quitado", rotulo: "Quitados", cor: "text-success", itens: quitados },
                          ] as const).filter((g) => g.itens.length > 0).map((g) => (
                            <li key={g.chave} className="min-w-0">
                              <p className={juntar(grupoDaLista, "text-[12px] font-medium", g.cor)}>{g.rotulo} ({g.itens.length})</p>
                              <ul className="divide-y divide-border/60">
                                {g.itens.map((pp: any) => (
                                  <li key={pp.id} className={linhaDaLista}>
                                    <Avatar name={pp.client?.company_name || pp.client?.full_name || pp.project?.name} className="mr-3 hidden sm:inline-flex" />
                                    <div className="mr-3 min-w-0 flex-1">
                                      <p className={juntar(texto.corpo, "truncate font-medium")}>{pp.project?.name || "Projeto"}</p>
                                      <p className={juntar(texto.auxiliar, "truncate")}>{pp.client?.company_name || pp.client?.full_name} · {getProjectBrand(pp.project?.project_type)}</p>
                                    </div>
                                    <div className="mr-4 hidden w-28 shrink-0 sm:block">
                                      <p className="mb-1 text-right text-[11px] font-medium tabular-nums text-muted-foreground">{pp._pct}%</p>
                                      <ProgressBar value={pp._pct} max={100} height={6} tone={pp._hasOverdue ? 4 : 1} label={`${pp._pct}% recebido`} />
                                    </div>
                                    <div className="flex shrink-0 flex-col items-end">
                                      <span className="text-[13px] font-semibold tabular-nums text-foreground">{fmt(pp._paid)}</span>
                                      <span className="text-[11px] tabular-nums text-muted-foreground">de {fmt(Number(pp.total_value))}</span>
                                    </div>
                                    {pp._remaining > 0.01 && (
                                      <div className="ml-3 hidden shrink-0 flex-col items-end md:flex">
                                        <span className="text-[13px] tabular-nums text-warning">{fmt(pp._remaining)}</span>
                                        <span className="text-[11px] text-muted-foreground">falta</span>
                                      </div>
                                    )}
                                    {pp._hasOverdue && <AlertTriangleIcon className="ml-2 h-3.5 w-3.5 shrink-0 text-destructive" aria-label="Parcela atrasada" />}
                                  </li>
                                ))}
                              </ul>
                            </li>
                          ))}
                        </ListaDoFinanceiro>
                    </div>
                  </Secao>
                )}
              </>
            )}

            {/* Receita: mês a mês e proporção por marca */}
            {(chartData.length > 0 || pieTotal > 0) && (
              <Secao titulo="Receita" descricao={`${currentYear}${brandFilter !== "all" ? ` · ${brandFilter === "aceleriq" ? "AcelerIQ" : "SiteBolt"}` : ""}`} divisoria>
                <div className="grid min-w-0 grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-3">
                  {chartData.length > 0 && (
                    <Painel titulo="Mês a mês" descricao="Recebido e pendente" className={pieTotal > 0 ? "lg:col-span-2" : "lg:col-span-3"}>
                      <ChartLegend
                        className="mb-3 flex divide-y-0 [&>li]:mr-5 [&>li]:py-0"
                        items={[{ label: "Recebido", tone: 1 }, { label: "Pendente", tone: 3 }]}
                      />
                      <div className="h-[260px] min-w-0">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={chartData} barGap={4} barCategoryGap="28%">
                            <CartesianGrid {...grafico.grade} />
                            <XAxis dataKey="name" {...grafico.eixo} />
                            <YAxis {...grafico.eixo} width={48} tickFormatter={(v) => `R$${(v / 1000).toFixed(v >= 1000 ? 1 : 0)}${v >= 1000 ? 'k' : ''}`} />
                            <Tooltip
                              {...grafico.dica}
                              formatter={(value: number, name: string) => [fmt(value), name === "recebido" ? "Recebido" : "Pendente"]}
                            />
                            <Bar dataKey="recebido" fill={grafico.cor(1)} radius={grafico.raio} maxBarSize={22} isAnimationActive={false} />
                            <Bar dataKey="pendente" fill={grafico.cor(3)} radius={grafico.raio} maxBarSize={22} isAnimationActive={false} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </Painel>
                  )}
                  {pieTotal > 0 && (
                    <Painel titulo="Proporção por marca" descricao="Tudo que já entrou" className={chartData.length > 0 ? "" : "lg:col-span-3"}>
                      <div className="flex min-w-0 flex-col items-center">
                        <Donut size={176} thickness={20} segments={pieData.map((d, i) => ({ value: d.value, label: d.name, tone: TONS_DA_PROPORCAO[i % TONS_DA_PROPORCAO.length] }))}>
                          <span className="text-[11px] leading-4 text-muted-foreground">Total</span>
                          <span className="max-w-full truncate text-[15px] font-semibold leading-5 tabular-nums">{fmt(pieTotal)}</span>
                        </Donut>
                        <ChartLegend
                          className="mt-4 w-full"
                          items={pieData.map((d, i) => ({ label: `${d.name} · ${Math.round((d.value / pieTotal) * 100)}%`, value: fmt(d.value), tone: TONS_DA_PROPORCAO[i % TONS_DA_PROPORCAO.length] }))}
                        />
                      </div>
                    </Painel>
                  )}
                </div>
              </Secao>
            )}
          </TabsContent>
        )}

        {/* Ads Wallet: investimento da Aceleriq, wallets dos clientes e recargas */}
        <TabsContent value="ads" className="mt-0 space-y-6 sm:space-y-8">
          {!isAdmin && (
            <Numeros
              rotulo="Investimento em anúncios"
              colunas={1}
              className="max-w-sm"
              itens={[{ rotulo: "Investimento Ads total", valor: fmt(totalAds), variante: "accent", icone: <Wallet className="h-4 w-4" /> }]}
            />
          )}

          {isAdmin && <AdsInvestment billing={billingBRL} projectPayments={projectPayments || []} />}

          <Secao
            titulo="Wallets de clientes"
            descricao={`${Object.entries(walletsByClient).length} ${Object.entries(walletsByClient).length === 1 ? "cliente" : "clientes"} · ${(wallets || []).length} ${(wallets || []).length === 1 ? "carteira" : "carteiras"} · ${fmt(totalAds)}`}
            acao={
              <>
                <button type="button" onClick={() => setAddWalletModal(true)} className={botao.secundario} aria-label="Adicionar wallet">
                  <Plus className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Adicionar wallet</span>
                </button>
              </>
            }
            divisoria={isAdmin}
            // Admin: nasce recolhida (como antes); a setinha do título abre. Sem admin, sempre aberta.
            recolher={isAdmin ? undefined : false}
            recolhidaDeInicio={isAdmin}
          >
            {(
              walletsQuery.isError && !wallets ? (
                <EstadoDeErro
                  titulo="Não foi possível carregar as wallets."
                  acao={<button type="button" onClick={() => { void walletsQuery.refetch?.(); }} className={botao.secundario}>Tentar de novo</button>}
                />
              ) : walletsQuery.isLoading && !wallets ? (
                <Carregando forma="lista" linhas={3} rotulo="Carregando wallets" />
              ) : Object.entries(walletsByClient).length === 0 ? (
                <EstadoVazio
                  compacto
                  titulo="Nenhuma wallet de anúncios."
                  descricao="Adicione a primeira para acompanhar saldo e recargas."
                  acao={<button type="button" onClick={() => setAddWalletModal(true)} className={acaoDaLinha}>Adicionar wallet</button>}
                />
              ) : (
                <ListaDoFinanceiro memoria="financeiro:wallets" rotulo="Wallets de clientes" alta>
                  {Object.entries(walletsByClient).map(([clientId, clientWallets]) => {
                    const clientTotal = clientWallets.reduce((s: number, w: any) => s + Number(w.balance), 0);
                    const clientRecharges = (recharges || []).filter((r: any) => r.client_id === clientId && r.status === "completed");
                    const totalInvested = clientRecharges.reduce((s: number, r: any) => s + Number(r.amount), 0);
                    const detalhes = [
                      totalInvested > 0 ? `Já investido ${fmt(totalInvested)} (${clientRecharges.length} ${clientRecharges.length === 1 ? "recarga" : "recargas"})` : "",
                      clientWallets[0]?.last_recharge_date ? `Última recarga ${new Date(clientWallets[0].last_recharge_date).toLocaleDateString("pt-BR")}` : "",
                    ].filter(Boolean).join(" · ");
                    return (
                      <li key={clientId} className="min-w-0 px-4 py-4 sm:px-6">
                        <div className="flex min-w-0 items-center">
                          <Avatar name={clientWallets[0]?.client?.company_name || clientWallets[0]?.client?.full_name} className="mr-3" />
                          <div className="min-w-0 flex-1">
                            <p className={juntar(texto.corpo, "truncate font-medium")}>{clientWallets[0]?.client?.company_name || clientWallets[0]?.client?.full_name}</p>
                            {detalhes && <p className={juntar(texto.auxiliar, "mt-0.5 truncate")}>{detalhes}</p>}
                          </div>
                          <span className="ml-3 shrink-0 text-[20px] font-semibold leading-7 tracking-[-0.02em] tabular-nums text-foreground">{fmt(clientTotal)}</span>
                        </div>
                        <ul className={juntar(superficie.poco, "mt-3 divide-y divide-border/60")}>
                          {clientWallets.map((w: any) => (
                            <li key={w.id} className="flex min-w-0 items-center px-4 py-2.5">
                              <span className={juntar(texto.auxiliar, "w-24 shrink-0 truncate capitalize")}>{w.platform} Ads</span>
                              <span className={juntar("min-w-0 flex-1 truncate text-[13px] font-medium tabular-nums", Number(w.balance) < 100 ? "text-warning" : "text-foreground")}>{fmt(Number(w.balance))}</span>
                              <button type="button" onClick={() => setRechargeModal({ clientId, platform: w.platform })} className={juntar(acaoDaLinha, "ml-2 text-info")} aria-label={`Solicitar recarga ${w.platform}`}>
                                <RefreshCw className="h-3.5 w-3.5 sm:mr-1" aria-hidden="true" />
                                <span className="hidden sm:inline">Solicitar recarga</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </li>
                    );
                  })}
                </ListaDoFinanceiro>
              )
            )}
          </Secao>

          {(recharges || []).length > 0 && (
            <Secao titulo="Solicitações de recarga" descricao={`${(recharges || []).length} ${(recharges || []).length === 1 ? "solicitação" : "solicitações"}`} divisoria>
              <ListaDoFinanceiro memoria="financeiro:recargas" rotulo="Solicitações de recarga">
                {(recharges || []).map((r: any) => (
                  <li key={r.id} className={linhaDaLista}>
                    <IconeDaLinha tom="aviso"><Zap className="h-4 w-4" /></IconeDaLinha>
                    <div className="mr-3 min-w-0 flex-1">
                      <p className={juntar(texto.corpo, "truncate font-medium")}><span className="tabular-nums">{fmt(Number(r.amount))}</span> · {r.platform}</p>
                      <p className={juntar(texto.auxiliar, "truncate")}>
                        {r.reason ? `${r.reason} · ` : ""}por {r.requester?.full_name} · {new Date(r.created_at).toLocaleDateString("pt-BR")}
                      </p>
                    </div>
                    <span className="mr-2 shrink-0">{statusBadge(r.status)}</span>
                    {r.status === "approved" && (
                      <button type="button" onClick={() => handleCompleteRecharge(r)} className={acaoPrincipalDaLinha} aria-label="Concluir recarga">
                        <CheckCircle2 className="h-3.5 w-3.5 sm:mr-1" aria-hidden="true" />
                        <span className="hidden sm:inline">Concluir recarga</span>
                      </button>
                    )}
                  </li>
                ))}
              </ListaDoFinanceiro>
            </Secao>
          )}
        </TabsContent>

        {/* Mensalidades: mensalistas e avulsos (só admin, como antes) */}
        {isAdmin && (
          <TabsContent value="renewals" className="mt-0 space-y-6 sm:space-y-8">

            {renewalsView === "mensalistas" && (() => {
              const mensalistas = (clients || []).filter((c: any) => c.plan_value && Number(c.plan_value) > 0 && !isInternalClient(c));
              if (mensalistas.length === 0) {
                return (
                  <EstadoVazio
                    icone={<Repeat className="h-5 w-5" />}
                    titulo="Nenhum cliente mensalista"
                    descricao="Edite um cliente e adicione o valor do plano para marcá-lo como mensalista."
                  />
                );
              }
              // Group by plan_name
              const groups: Record<string, any[]> = {};
              mensalistas.forEach((c: any) => {
                const key = c.plan_name || "Sem plano definido";
                if (!groups[key]) groups[key] = [];
                groups[key].push(c);
              });
              const planNames = Object.keys(groups).sort();

              return (
                <div className="space-y-5">
                  <Resumo
                    itens={[
                      { rotulo: "Mensalistas", valor: String(mensalistas.length) },
                      { rotulo: "Planos distintos", valor: String(planNames.length), cor: "text-primary" },
                      { rotulo: "MRR esperado", valor: fmt(mensalistas.reduce((s: number, c: any) => s + Number(c.plan_value || 0), 0)), cor: "text-success" },
                      // 14/11/2026: extras mensais ativos (suporte, CRM, e-mail, automação) somam à parte, para o MRR do plano não mudar de sentido.
                      ...(extrasPorMes > 0 ? [{ rotulo: "Extras recorrentes", valor: `${fmt(extrasPorMes)}/mês`, cor: "text-success" }] : []),
                      { rotulo: "Renovam em até 15 dias", valor: String(mensalistas.filter((c: any) => {
                        const renewal = parseAppDate(c.plan_renewal_date);
                        if (!renewal) return false;
                        const d = Math.ceil((renewal.getTime() - todayStart.getTime()) / 86400000);
                        return d >= 0 && d <= 15;
                      }).length), cor: "text-warning" },
                    ]}
                  />

                  <ListaDoFinanceiro memoria="financeiro:mensalistas" rotulo="Mensalistas" alta>
                    {planNames.map((planName) => {
                      const planClients = groups[planName];
                      const planMRR = planClients.reduce((s: number, c: any) => s + Number(c.plan_value || 0), 0);
                      return (
                        <li key={planName} className="min-w-0">
                          <div className={juntar(grupoDaLista, "flex min-w-0 items-center")}>
                            <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-foreground">
                              {planName} <span className="font-normal text-muted-foreground">({planClients.length} {planClients.length === 1 ? "cliente" : "clientes"})</span>
                            </span>
                            <span className="ml-3 shrink-0 text-[12px] font-semibold tabular-nums text-foreground">{fmt(planMRR)}/mês</span>
                          </div>
                          <ul className="divide-y divide-border/60">
                            {planClients.map((c: any) => {
                              const renewalDate = parseAppDate(c.plan_renewal_date);
                              const daysLeft = renewalDate ? Math.ceil((renewalDate.getTime() - todayStart.getTime()) / 86400000) : null;
                              const planStatus = !renewalDate || daysLeft === null ? "unknown" : daysLeft < 0 ? "overdue" : daysLeft <= 15 ? "soon" : "active";
                              const clientBilling = billingBRL.find((b: any) => b.client_id === c.id && b.type === "renewal");
                              const reminderCount = clientBilling?.reminder_count || 0;
                              const nome = c.company_name || c.full_name;
                              return (
                                <li key={c.id} className={linhaDaLista}>
                                  <Avatar name={nome} className="mr-3 hidden sm:inline-flex" />
                                  <div className="mr-3 min-w-0 flex-1">
                                    <div className="flex min-w-0 items-center">
                                      <p className={juntar(texto.corpo, "mr-2 min-w-0 truncate font-medium")}>{nome}</p>
                                      {planStatus === "active" && <StatusPill tone="success">Ativo</StatusPill>}
                                      {planStatus === "soon" && <StatusPill tone="warning">Renova em breve</StatusPill>}
                                      {planStatus === "overdue" && <StatusPill tone="danger">Pendente</StatusPill>}
                                      {planStatus === "unknown" && <StatusPill>Sem data</StatusPill>}
                                    </div>
                                    <p className={juntar(texto.auxiliar, "truncate")}>
                                      <span className="tabular-nums">{fmt(Number(c.plan_value))}</span>/mês
                                      {renewalDate && <> · renova {formatAppDate(c.plan_renewal_date)}{daysLeft !== null && daysLeft >= 0 && ` (${daysLeft} dias)`}</>}
                                    </p>
                                  </div>
                                  <div className="flex shrink-0 items-center [&>*+*]:ml-1">
                                    <button
                                      type="button"
                                      onClick={() => { setEditPlanModal(c); setPlanForm({ amount: clientBilling ? String(clientBilling.amount) : String(c.plan_value || ""), renewal_date: c.plan_renewal_date || "", description: clientBilling?.description || c.plan_name || "" }); }}
                                      className={juntar(acaoDaLinha, "max-sm:w-9 max-sm:px-0")}
                                      aria-label={`Editar plano de ${nome}`}
                                    >
                                      <Edit3 className="h-3.5 w-3.5 sm:mr-1.5" aria-hidden="true" />
                                      <span className="hidden sm:inline">Editar plano</span>
                                    </button>
                                    <OverflowMenu
                                      label={`Mais ações de ${nome}`}
                                      items={[
                                        { label: reminderCount > 0 ? `Lembrete (${reminderCount}x)` : "Notificar", icon: <Bell className="h-3.5 w-3.5" />, onSelect: () => handleSendReminder(c, "notification") },
                                        { label: "WhatsApp", icon: <MessageCircle className="h-3.5 w-3.5" />, onSelect: () => handleSendReminder(c, "whatsapp") },
                                      ]}
                                    />
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        </li>
                      );
                    })}
                  </ListaDoFinanceiro>
                </div>
              );
            })()}

            {renewalsView === "avulsos" && (() => {
              // Avulsos = clientes one_off OU sem plan_value que tenham QUALQUER lançamento
              // (project_payments ou billing avulso). Antes só considerávamos project_payments,
              // o que escondia recebimentos como o de Itamar (lançado via billing).
              const isAvulsoClient = (c: any) =>
                !!c && !isInternalClient(c) && (c.client_type === "one_off" || !c.plan_value || Number(c.plan_value) === 0);

              const billingByClient = new Map<string, any[]>();
              billingBRL.forEach((b: any) => {
                if (!b.client_id) return;
                const c = (clients || []).find((cl: any) => cl.id === b.client_id);
                if (!isAvulsoClient(c)) return;
                const arr = billingByClient.get(b.client_id) || [];
                arr.push(b);
                billingByClient.set(b.client_id, arr);
              });
              const paymentsByClient = new Map<string, any[]>();
              (projectPayments || []).forEach((pp: any) => {
                if (!pp.client_id) return;
                const c = (clients || []).find((cl: any) => cl.id === pp.client_id);
                if (!isAvulsoClient(c)) return;
                const arr = paymentsByClient.get(pp.client_id) || [];
                arr.push(pp);
                paymentsByClient.set(pp.client_id, arr);
              });

              const avulsoClientIds = new Set<string>([
                ...billingByClient.keys(),
                ...paymentsByClient.keys(),
              ]);
              const avulsoClients = (clients || []).filter((c: any) => avulsoClientIds.has(c.id));

              if (avulsoClients.length === 0) {
                return <EstadoVazio icone={<Receipt className="h-5 w-5" />} titulo="Nenhum cliente avulso com histórico" />;
              }

              const sumBillingPaid = (rows: any[]) =>
                (rows || []).filter((b: any) => b.status === "paid" || b.status === "partial")
                  .reduce((s: number, b: any) => s + receivedOf(b), 0);
              // Em aberto de cobrança: só a pendente. A parcial já tem o saldo numa linha "pending" própria;
              // somar o resto dela de novo contava o mesmo dinheiro duas vezes.
              const sumBillingOpen = (rows: any[]) =>
                (rows || []).reduce((s: number, b: any) => s + saldoDaCobranca(b), 0);
              const sumInstallmentsPaid = (pps: any[]) =>
                (pps || []).reduce((s: number, pp: any) => s + (pp.installments || [])
                  .filter((i: any) => i.status === "paid" || i.status === "partial")
                  .reduce((x: number, i: any) => x + receivedOf(i), 0), 0);
              const sumInstallmentsOpen = (pps: any[]) =>
                (pps || []).reduce((s: number, pp: any) => s + (pp.installments || [])
                  .filter((i: any) => i.status === "pending" || i.status === "partial")
                  .reduce((x: number, i: any) => x + Math.max(Number(i.amount) - Number(i.paid_amount || 0), 0), 0), 0);

              const totalRecebido = avulsoClients.reduce((s, c) =>
                s + sumBillingPaid(billingByClient.get(c.id) || []) + sumInstallmentsPaid(paymentsByClient.get(c.id) || []), 0);
              const totalAberto = avulsoClients.reduce((s, c) =>
                s + sumBillingOpen(billingByClient.get(c.id) || []) + sumInstallmentsOpen(paymentsByClient.get(c.id) || []), 0);

              return (
                <div className="space-y-5">
                  <Resumo
                    itens={[
                      { rotulo: "Clientes avulsos", valor: String(avulsoClients.length) },
                      { rotulo: "Total recebido", valor: fmt(totalRecebido), cor: "text-success" },
                      { rotulo: "Em aberto", valor: fmt(totalAberto), cor: "text-warning" },
                    ]}
                  />

                  <ListaDoFinanceiro memoria="financeiro:avulsos" rotulo="Clientes avulsos" alta>
                    {avulsoClients.map((c: any) => {
                      const clientProjects = paymentsByClient.get(c.id) || [];
                      const clientBills = billingByClient.get(c.id) || [];
                      const totalFaturado =
                        clientProjects.reduce((s: number, pp: any) => s + Number(pp.total_value), 0) +
                        clientBills.reduce((s: number, b: any) => s + Number(b.amount || 0), 0);
                      const totalPago = sumInstallmentsPaid(clientProjects) + sumBillingPaid(clientBills);
                      const aberto = Math.max(totalFaturado - totalPago, 0);
                      const lineCount = clientProjects.length + clientBills.length;
                      return (
                        <li key={c.id} className="min-w-0 px-4 py-4 sm:px-6">
                          <div className="flex min-w-0 items-center">
                            <Avatar name={c.company_name || c.full_name} className="mr-3" />
                            <div className="mr-2 min-w-0 flex-1">
                              <p className={juntar(texto.corpo, "truncate font-medium")}>{c.company_name || c.full_name}</p>
                              <p className={juntar(texto.auxiliar, "mt-0.5 truncate")}>
                                Faturado <span className="tabular-nums text-foreground">{fmt(totalFaturado)}</span>
                                {" · "}Pago <span className="tabular-nums text-success">{fmt(totalPago)}</span>
                                {aberto > 0.01 && <>{" · "}Aberto <span className="tabular-nums text-warning">{fmt(aberto)}</span></>}
                              </p>
                            </div>
                            <StatusPill className="max-sm:hidden">
                              {lineCount} {lineCount === 1 ? "lançamento" : "lançamentos"}
                            </StatusPill>
                          </div>
                          {totalFaturado > 0 && <ProgressBar className="mt-3" value={totalPago} max={totalFaturado} height={6} label={`Pago ${fmt(totalPago)} de ${fmt(totalFaturado)}`} />}
                          <ul className={juntar(superficie.poco, "mt-3 divide-y divide-border/60")}>
                            {clientProjects.map((pp: any) => {
                              const paid = sumInstallmentsPaid([pp]);
                              const total = Number(pp.total_value) || 0;
                              const pct = total > 0 ? Math.round((paid / total) * 100) : 0;
                              const isPartial = paid > 0 && paid < total;
                              const isFull = paid >= total && total > 0;
                              const cor = isFull ? "text-success" : isPartial ? "text-warning" : "text-muted-foreground";
                              return (
                                <li key={pp.id} className="flex min-w-0 items-center px-4 py-2.5 text-[12px] text-muted-foreground">
                                  <span className="min-w-0 flex-1 truncate">{pp.project?.name || "Projeto"}</span>
                                  <span className={juntar("ml-3 shrink-0 text-[11px] tabular-nums", cor)}>{pct}%</span>
                                  <span className="ml-3 shrink-0 tabular-nums">
                                    <span className={cor}>{fmt(paid)}</span>
                                    {!isFull && <span> / {fmt(total)}</span>}
                                  </span>
                                </li>
                              );
                            })}
                            {clientBills.map((b: any) => {
                              const paid = sumBillingPaid([b]);
                              const total = Number(b.amount) || 0;
                              const pct = total > 0 ? Math.round((paid / total) * 100) : 0;
                              const isPartial = b.status === "partial";
                              const isPaid = b.status === "paid" && paid >= total;
                              const cor = isPaid ? "text-success" : isPartial ? "text-warning" : "text-muted-foreground";
                              return (
                                <li key={b.id} className="flex min-w-0 items-center px-4 py-2.5 text-[12px] text-muted-foreground">
                                  <span className="min-w-0 flex-1 truncate">{b.description || "Cobrança avulsa"}</span>
                                  <span className={juntar("ml-3 shrink-0 text-[11px] tabular-nums", cor)}>{pct}%</span>
                                  <span className="ml-3 shrink-0 tabular-nums">
                                    <span className={cor}>{fmt(paid)}</span>
                                    {!isPaid && <span> / {fmt(total)}</span>}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        </li>
                      );
                    })}
                  </ListaDoFinanceiro>
                </div>
              );
            })()}
          </TabsContent>
        )}

        {/* Histórico de alterações de pagamento */}
        {isAdmin && (
          <TabsContent value="audit" className="mt-0 space-y-6 sm:space-y-8">
            <Secao titulo="Histórico de alterações" descricao="Últimos 50 registros">
              {auditQuery.isError && !auditLogs ? (
                <EstadoDeErro
                  titulo="Não foi possível carregar o histórico."
                  acao={<button type="button" onClick={() => { void auditQuery.refetch?.(); }} className={botao.secundario}>Tentar de novo</button>}
                />
              ) : auditQuery.isLoading && !auditLogs ? (
                <Carregando forma="lista" linhas={5} rotulo="Carregando histórico" />
              ) : (auditLogs || []).length === 0 ? (
                <EstadoVazio icone={<History className="h-5 w-5" />} titulo="Nenhuma alteração registrada ainda" />
              ) : (
                <ListaDoFinanceiro memoria="financeiro:historico" rotulo="Histórico de alterações" alta>
                  {(auditLogs || []).map((log: any) => {
                    const actionLabels: Record<string, { label: string; color: string }> = {
                      paid_full: { label: "Pago total", color: "text-success bg-success-soft" },
                      paid_partial: { label: "Pago parcial", color: "text-warning bg-warning-soft" },
                      status_change: { label: "Status alterado", color: "text-info bg-info-soft" },
                      amount_change: { label: "Valor alterado", color: "text-primary bg-accent-soft" },
                    };
                    const actionInfo = actionLabels[log.action] || { label: log.action, color: "text-muted-foreground bg-muted" };
                    const typeLabel = log.entity_type === "billing" ? "Fatura" : "Parcela";
                    const mudancas = [
                      log.old_amount != null && log.new_amount != null && log.old_amount !== log.new_amount ? `${fmt(log.old_amount)} para ${fmt(log.new_amount)}` : "",
                      log.new_amount != null && log.old_amount === log.new_amount ? fmt(log.new_amount) : "",
                      log.old_status && log.new_status && log.old_status !== log.new_status ? `${log.old_status} para ${log.new_status}` : "",
                    ].filter(Boolean).join(" · ");
                    return (
                      <li key={log.id} className={juntar(linhaDaLista, "items-start")}>
                        <IconeDaLinha className="hidden sm:inline-flex"><History className="h-4 w-4" /></IconeDaLinha>
                        <div className="mr-3 min-w-0 flex-1">
                          <div className="flex min-w-0 flex-wrap items-center [&>*+*]:ml-1.5">
                            <span className={juntar(etiqueta, actionInfo.color)}>{actionInfo.label}</span>
                            <span className={juntar(etiqueta, "bg-muted text-muted-foreground")}>{typeLabel}</span>
                          </div>
                          {log.notes && <p className={juntar(texto.corpo, "mt-1 truncate")}>{log.notes}</p>}
                          {mudancas && <p className={juntar(texto.auxiliar, "mt-0.5 truncate tabular-nums")}>{mudancas}</p>}
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-[12px] tabular-nums text-muted-foreground">{new Date(log.created_at).toLocaleDateString("pt-BR")}</p>
                          <p className="text-[11px] tabular-nums text-muted-foreground/70">
                            {new Date(log.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                          </p>
                          {log.performerName && <p className="mt-0.5 max-w-[120px] truncate text-[11px] text-primary">{log.performerName}</p>}
                        </div>
                      </li>
                    );
                  })}
                </ListaDoFinanceiro>
              )}
            </Secao>
          </TabsContent>
        )}
      </Tabs>

      {/* Nova cobrança */}
      <Dialog open={newBillingOpen} onOpenChange={(open) => { if (!creatingBilling) setNewBillingOpen(open); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-border bg-card sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground">Nova cobrança</DialogTitle>
            <DialogDescription>Confira os dados. O cliente será avisado depois que a cobrança for criada.</DialogDescription>
          </DialogHeader>
          <fieldset disabled={creatingBilling} className="min-w-0 space-y-4 border-0 p-0">
            <GrupoDeCampos>
              <CampoDeFormulario rotulo="Cliente">
                <select id="billing-client" value={billForm.client_id} onChange={e => setBillForm(f => ({ ...f, client_id: e.target.value }))} className={campo}>
                  <option value="">Selecionar...</option>
                  {(clients || []).map((c: any) => <option key={c.id} value={c.id}>{c.company_name || c.full_name}</option>)}
                </select>
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Tipo">
                <select id="billing-type" value={billForm.type} onChange={e => setBillForm(f => ({ ...f, type: e.target.value }))} className={campo}>
                  <option value="renewal">Renovação</option>
                  <option value="ads_recharge">Recarga Ads</option>
                  <option value="extra_service">Serviço Extra</option>
                </select>
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Valor (R$)">
                <Input id="billing-amount" type="number" inputMode="decimal" value={billForm.amount} onChange={e => setBillForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" className="h-9" />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Vencimento">
                <Input id="billing-due-date" type="date" value={billForm.due_date} onChange={e => setBillForm(f => ({ ...f, due_date: e.target.value }))} className="h-9" />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Descrição" largo>
                <textarea id="billing-description" value={billForm.description} onChange={e => setBillForm(f => ({ ...f, description: e.target.value }))} className={juntar(campoTexto, "min-h-[64px] resize-none")} rows={2} />
              </CampoDeFormulario>
            </GrupoDeCampos>
            <div className={rodapeDoDialogo}>
              <button type="button" onClick={() => setNewBillingOpen(false)} className={botao.secundario}>Cancelar</button>
              <button type="button" onClick={handleCreateBilling} disabled={creatingBilling} className={botao.primario}>
                {creatingBilling ? "Criando cobrança…" : "Criar cobrança"}
              </button>
            </div>
          </fieldset>
        </DialogContent>
      </Dialog>

      {/* Solicitar recarga: valores prontos ou personalizado */}
      <Dialog open={!!rechargeModal} onOpenChange={() => setRechargeModal(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-border bg-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Solicitar recarga · <span className="capitalize">{rechargeModal?.platform}</span></DialogTitle>
            <DialogDescription>O cliente recebe o pedido e confirma a recarga.</DialogDescription>
          </DialogHeader>
          <div className="min-w-0 space-y-4">
            <div className="min-w-0">
              <p className={juntar(texto.rotulo, "mb-1.5")}>Valor</p>
              <div className="grid grid-cols-3 gap-2" role="group" aria-label="Valor da recarga">
                {[250, 500, 1000].map((val) => {
                  const ativo = rechargeForm.amount === String(val);
                  return (
                    <button
                      key={val}
                      type="button"
                      aria-pressed={ativo}
                      onClick={() => setRechargeForm(f => ({ ...f, amount: String(val) }))}
                      className={juntar(
                        "flex min-w-0 flex-col items-center rounded-md border px-2 py-2.5 transition-colors",
                        ativo ? "border-primary bg-accent-soft text-primary" : "border-border text-foreground hover:bg-muted",
                        foco,
                      )}
                    >
                      <span className="text-[14px] font-semibold tabular-nums">{fmt(val)}</span>
                      <span className="text-[11px] text-muted-foreground">por semana</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <GrupoDeCampos>
              <CampoDeFormulario rotulo="Outro valor (R$)">
                <Input
                  type="number"
                  inputMode="decimal"
                  value={![250, 500, 1000].includes(Number(rechargeForm.amount)) ? rechargeForm.amount : ""}
                  onChange={e => setRechargeForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder="Outro valor..."
                  className="h-9"
                  onFocus={() => {
                    if ([250, 500, 1000].includes(Number(rechargeForm.amount))) {
                      setRechargeForm(f => ({ ...f, amount: "" }));
                    }
                  }}
                />
              </CampoDeFormulario>
              <div className="min-w-0">
                <p className={juntar(texto.rotulo, "mb-1.5")}>Período</p>
                <SeletorCompacto
                  opcoes={[{ valor: "semanal", rotulo: "Semanal" }, { valor: "mensal", rotulo: "Mensal" }]}
                  valor={rechargeForm.period}
                  onEscolher={(p) => setRechargeForm(f => ({ ...f, period: p }))}
                  rotulo="Período da recarga"
                  larguraTotal
                />
              </div>
              <CampoDeFormulario rotulo="Observação (opcional)" largo>
                <textarea value={rechargeForm.reason} onChange={e => setRechargeForm(f => ({ ...f, reason: e.target.value }))} className={juntar(campoTexto, "min-h-[64px] resize-none")} rows={2} placeholder="Ex.: manter a campanha X ativa" />
              </CampoDeFormulario>
            </GrupoDeCampos>

            {rechargeForm.amount && (
              <div className={juntar(superficie.poco, "px-3 py-2.5")}>
                <p className={texto.corpo}>
                  <span className="font-semibold tabular-nums text-primary">{fmt(Number(rechargeForm.amount))}</span>
                  <span className="text-muted-foreground"> / {rechargeForm.period} · <span className="capitalize">{rechargeModal?.platform}</span> Ads</span>
                </p>
                {rechargeForm.period === "mensal" && (
                  <p className={juntar(texto.auxiliar, "mt-0.5 tabular-nums")}>≈ {fmt(Number(rechargeForm.amount) / 4)}/semana</p>
                )}
              </div>
            )}

            <div className={rodapeDoDialogo}>
              <button type="button" onClick={() => setRechargeModal(null)} className={botao.secundario}>Cancelar</button>
              <button
                type="button"
                onClick={handleRequestRecharge}
                disabled={!rechargeForm.amount || Number(rechargeForm.amount) <= 0}
                className={botao.primario}
              >
                <Bell className="mr-1.5 h-4 w-4" aria-hidden="true" /> Enviar ao cliente
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Adicionar wallet */}
      <Dialog open={addWalletModal} onOpenChange={setAddWalletModal}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-border bg-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Adicionar wallet de anúncios</DialogTitle>
          </DialogHeader>
          <div className="min-w-0 space-y-4">
            <GrupoDeCampos>
              <CampoDeFormulario rotulo="Cliente" largo>
                <select value={addWalletForm.client_id} onChange={e => setAddWalletForm(f => ({ ...f, client_id: e.target.value }))} className={campo}>
                  <option value="">Selecionar...</option>
                  {(clients || []).map((c: any) => <option key={c.id} value={c.id}>{c.company_name || c.full_name}</option>)}
                </select>
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Plataforma">
                <select value={addWalletForm.platform} onChange={e => setAddWalletForm(f => ({ ...f, platform: e.target.value }))} className={campo}>
                  <option value="meta">Meta Ads</option>
                  <option value="google">Google Ads</option>
                  <option value="tiktok">TikTok Ads</option>
                  <option value="linkedin">LinkedIn Ads</option>
                </select>
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Saldo inicial (R$)">
                <Input type="number" inputMode="decimal" value={addWalletForm.balance} onChange={e => setAddWalletForm(f => ({ ...f, balance: e.target.value }))} className="h-9" placeholder="0" />
              </CampoDeFormulario>
            </GrupoDeCampos>
            <div className={rodapeDoDialogo}>
              <button type="button" onClick={() => setAddWalletModal(false)} className={botao.secundario}>Cancelar</button>
              <button
                type="button"
                onClick={async () => {
                  if (!addWalletForm.client_id) { toast.error("Selecione um cliente"); return; }
                  const existing = (wallets || []).find((w: any) => w.client_id === addWalletForm.client_id && w.platform === addWalletForm.platform);
                  if (existing) { toast.error("Este cliente já possui wallet para esta plataforma"); return; }
                  await supabase.from("ads_wallet").insert({
                    client_id: addWalletForm.client_id,
                    platform: addWalletForm.platform,
                    balance: Number(addWalletForm.balance) || 0,
                  });
                  queryClient.invalidateQueries({ queryKey: ["ads-wallet"] });
                  toast.success("Wallet criado com sucesso!");
                  setAddWalletModal(false);
                  setAddWalletForm({ client_id: "", platform: "meta", balance: "0" });
                }}
                className={botao.primario}
              >
                Criar wallet
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Editar plano */}
      <Dialog open={!!editPlanModal} onOpenChange={() => setEditPlanModal(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-border bg-card sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="truncate pr-6 text-foreground">Editar plano · {editPlanModal?.company_name || editPlanModal?.full_name}</DialogTitle>
          </DialogHeader>
          <div className="min-w-0 space-y-4">
            <GrupoDeCampos>
              <CampoDeFormulario rotulo="Valor mensal (R$)">
                <Input type="number" inputMode="decimal" value={planForm.amount} onChange={e => setPlanForm(f => ({ ...f, amount: e.target.value }))} className="h-9" />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Data de renovação">
                <Input type="date" value={planForm.renewal_date} onChange={e => setPlanForm(f => ({ ...f, renewal_date: e.target.value }))} className="h-9" />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Descrição do plano" largo>
                <textarea value={planForm.description} onChange={e => setPlanForm(f => ({ ...f, description: e.target.value }))} className={juntar(campoTexto, "min-h-[64px] resize-none")} rows={2} />
              </CampoDeFormulario>
            </GrupoDeCampos>
            <div className={rodapeDoDialogo}>
              <button type="button" onClick={() => setEditPlanModal(null)} className={botao.secundario}>Cancelar</button>
              <button type="button" onClick={handleEditPlan} className={botao.primario}>Salvar</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Registrar pagamento (total ou parcial) */}
      <Dialog open={!!payModal} onOpenChange={() => setPayModal(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-border bg-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Registrar pagamento</DialogTitle>
          </DialogHeader>
          {payModal && (
            <div className="min-w-0 space-y-4">
              <div className={juntar(superficie.poco, "px-3 py-2.5")}>
                <p className={juntar(texto.corpo, "font-medium [overflow-wrap:anywhere]")}>{payModal.label}</p>
                <p className={juntar(texto.auxiliar, "mt-0.5 tabular-nums")}>Valor {fmt(payModal.amount)}</p>
              </div>

              <SeletorCompacto
                opcoes={[{ valor: "full", rotulo: "Pago total" }, { valor: "partial", rotulo: "Pagou parte" }]}
                valor={payType}
                onEscolher={(v) => setPayType(v === "partial" ? "partial" : "full")}
                rotulo="Tipo de pagamento"
                larguraTotal
              />

              {payType === "partial" && (
                <GrupoDeCampos colunas={1}>
                  <CampoDeFormulario
                    rotulo="Valor pago (R$)"
                    apoio={payPartialAmount && parseFloat(payPartialAmount) > 0 && parseFloat(payPartialAmount) < payModal.amount
                      ? `Restante: ${fmt(payModal.amount - parseFloat(payPartialAmount))}`
                      : undefined}
                  >
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={payPartialAmount}
                      onChange={e => setPayPartialAmount(e.target.value)}
                      className="h-9"
                      placeholder={`Máx: ${payModal.amount.toFixed(2)}`}
                    />
                  </CampoDeFormulario>
                </GrupoDeCampos>
              )}

              <div className={rodapeDoDialogo}>
                <button type="button" onClick={() => setPayModal(null)} className={botao.secundario}>Cancelar</button>
                <button
                  type="button"
                  onClick={handlePayFromPanel}
                  disabled={payType === "partial" && (!payPartialAmount || parseFloat(payPartialAmount) <= 0)}
                  className={botao.primario}
                >
                  {payType === "full" ? `Confirmar · ${fmt(payModal.amount)}` : `Confirmar · ${fmt(parseFloat(payPartialAmount) || 0)}`}
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AdminFinanceiro() {
  const { profile, loading } = useAuth();

  if (loading || !profile) {
    return <Carregando forma="aba" rotulo="Carregando financeiro" />;
  }

  return <LegacyFinanceiro />;
}
