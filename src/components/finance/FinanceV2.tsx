import { useMemo, useState } from "react";
import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  CalendarDays,
  CircleAlert,
  CircleCheck,
  CircleDollarSign,
  Clock3,
  FileClock,
  Landmark,
  Layers3,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";
import {
  calculateGrossedUpAmount,
  type ClientFinancialSummary,
  type FinanceAllocationMethod,
  type FinanceAmountKind,
  type FinanceBillingPeriod,
  type FinanceEntry,
  type FinanceMode,
  type FinancePlan,
  type FinancePlanVersion,
  type FinancePricingMode,
  type FinanceRecurringRule,
  type UpsertPlanInput,
  type UpsertRecurringRuleInput,
  type UpdateSettingsInput,
  useClientFinancialSummaries,
  useFinanceEntries,
  useFinanceMutations,
  useFinanceOverview,
  useFinancePlans,
  useFinanceRecurringRules,
  useFinanceSettings,
} from "@/hooks/useFinanceV2";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import { todayBR } from "@/lib/dateBR";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type FinanceTab = "overview" | "cash-flow" | "subscriptions" | "fixed-costs" | "plans";

const MODES: Array<{ value: FinanceMode; label: string; description: string }> = [
  { value: "cash", label: "Caixa", description: "Movimentos pela data de liquidação" },
  { value: "accrual", label: "Competência", description: "Receitas e custos do período" },
  { value: "forecast", label: "Previsão", description: "Realizado e valores esperados" },
];

const TAB_ITEMS: Array<{ value: FinanceTab; label: string }> = [
  { value: "overview", label: "Visão geral" },
  { value: "cash-flow", label: "Fluxo de caixa" },
  { value: "subscriptions", label: "Mensalidades" },
  { value: "fixed-costs", label: "Custos fixos" },
  { value: "plans", label: "Planos e preços" },
];

const BILLING_PERIOD_LABELS: Record<FinanceBillingPeriod, string> = {
  monthly: "Mensal",
  bimonthly: "Bimestral",
  quarterly: "Trimestral",
  semiannual: "Semestral",
  annual: "Anual",
};

const ALLOCATION_METHOD_LABELS: Record<FinanceAllocationMethod, string> = {
  equal: "Igual por cliente",
  revenue: "Proporcional à receita",
  custom: "Personalizada",
  none: "Sem alocação",
};

const currency = (value: number, code = "BRL") =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: code }).format(Number(value) || 0);

const compactCurrency = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: Math.abs(value) >= 100_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(value) >= 100_000 ? 1 : 2,
  }).format(Number(value) || 0);

const dateLabel = (value?: string | null) => {
  if (!value) return "-";
  const dateKey = value.slice(0, 10);
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("pt-BR").format(new Date(year, month - 1, day, 12));
};

const competenceLabel = (value: string) => {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  const label = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(
    new Date(year, month - 1, 1, 12),
  );
  return label.charAt(0).toUpperCase() + label.slice(1);
};

const currentCompetence = () => todayBR().slice(0, 7);

const effectiveDateForCompetence = (competence: string) => `${competence}-01`;

const versionCoversDate = (version: FinancePlanVersion, dateKey: string) =>
  version.effectiveFrom <= dateKey && (!version.effectiveTo || version.effectiveTo >= dateKey);

const percentageLabel = (value: number | null) =>
  value === null
    ? "-"
    : new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(value);

const percentageInputValue = (value: number | null) =>
  value === null ? "" : String(Math.round(value * 10_000) / 100);

const percentageFromInput = (value: string) => value === "" ? null : Number(value) / 100;

const nextCompetenceStart = (dateKey: string) => {
  const [year, month] = dateKey.split("-").map(Number);
  const date = new Date(year, month, 1, 12);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const messageOf = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return "Não foi possível concluir a operação.";
};

const mutationKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `finance-v2-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function LoadingPanel({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-label="Carregando dados financeiros" aria-busy="true">
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className={cn("h-20 w-full motion-reduce:animate-none", index === 0 && "h-28")} />
      ))}
    </div>
  );
}

function ErrorPanel({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Alert variant="destructive" className="bg-destructive/5">
      <CircleAlert className="h-4 w-4" />
      <AlertTitle>Não foi possível carregar esta seção</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>{messageOf(error)} Verifique se a migration do Financeiro V2 já foi aplicada.</p>
        <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" />
          Tentar novamente
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function EmptyPanel({
  icon: Icon = FileClock,
  title,
  description,
  action,
}: {
  icon?: typeof FileClock;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed bg-muted/20 px-6 py-10 text-center">
      <div className="mb-4 rounded-full border bg-background p-3 shadow-sm">
        <Icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Banknote;
  tone?: "neutral" | "positive" | "negative" | "warning";
}) {
  const toneClass = {
    neutral: "bg-primary/10 text-primary",
    positive: "bg-success/10 text-success",
    negative: "bg-destructive/10 text-destructive",
    warning: "bg-warning/10 text-warning",
  }[tone];
  return (
    <Card className="overflow-hidden shadow-none">
      <CardContent className="flex min-h-36 flex-col justify-between p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <span className={cn("rounded-lg p-2", toneClass)}>
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        </div>
        <div className="mt-5">
          <p className="font-mono text-2xl font-semibold tabular-nums tracking-tight text-foreground">{value}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const label = {
    pending: "Pendente",
    partial: "Parcial",
    settled: "Liquidado",
    paid: "Liquidado",
    overdue: "Atrasado",
    cancelled: "Cancelado",
    active: "Ativo",
    inactive: "Inativo",
    current: "Em dia",
    draft: "Rascunho",
    ended: "Encerrado",
    archived: "Arquivado",
    not_configured: "Sem configuração",
    paused: "Pausado",
    review_required: "Revisar",
    scheduled: "Previsto",
    unlinked: "Sem vínculo",
    reversal: "Estorno",
    refund: "Reembolso",
  }[normalized] || status;
  const className =
    normalized === "settled" || normalized === "paid" || normalized === "active" || normalized === "current"
      ? "border-success/30 bg-success/10 text-success"
      : normalized === "overdue"
        ? "border-destructive/30 bg-destructive/10 text-destructive"
        : normalized === "pending" || normalized === "partial" || normalized === "review_required" || normalized === "scheduled" || normalized === "draft"
          ? "border-warning/30 bg-warning/10 text-warning"
          : "border-border bg-muted text-muted-foreground";
  return <Badge variant="outline" className={cn("whitespace-nowrap", className)}>{label}</Badge>;
}

function OverviewTab({
  mode,
  competence,
  currencyCode,
}: {
  mode: FinanceMode;
  competence: string;
  currencyCode: string;
}) {
  const overview = useFinanceOverview(mode, competence);
  const clients = useClientFinancialSummaries();

  if (overview.isLoading) return <LoadingPanel />;
  if (overview.error) return <ErrorPanel error={overview.error} onRetry={() => void overview.refetch()} />;
  if (!overview.data) {
    return <EmptyPanel title="Sem visão consolidada" description="Gere a competência para começar a consolidar receitas, custos e saldos deste período." />;
  }

  const data = overview.data;
  const modeLabel = MODES.find((item) => item.value === mode)?.label || mode;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Receitas"
          value={currency(data.income, currencyCode)}
          detail={`${modeLabel} em ${competenceLabel(competence)}`}
          icon={ArrowDownToLine}
          tone="positive"
        />
        <MetricCard
          label="Custos e despesas"
          value={currency(data.expense, currencyCode)}
          detail={`${currency(data.fixedCosts, currencyCode)} em custos fixos`}
          icon={ArrowUpFromLine}
          tone="negative"
        />
        <MetricCard
          label="Resultado"
          value={currency(data.net, currencyCode)}
          detail={`Saldo inicial de ${currency(data.openingBalance, currencyCode)}`}
          icon={WalletCards}
          tone={data.net >= 0 ? "positive" : "negative"}
        />
        <MetricCard
          label="Em atraso"
          value={currency(data.overdueIncome, currencyCode)}
          detail={`${data.clientsCount} clientes no consolidado`}
          icon={Clock3}
          tone={data.overdueIncome > 0 ? "warning" : "neutral"}
        />
      </div>

      {mode === "forecast" && (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-lg">Horizonte de caixa</CardTitle>
            <CardDescription>Saldo líquido acumulado dos lançamentos abertos, já descontada a reserva tributária proporcional.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            {[
              ["30 dias", data.forecast30Days],
              ["60 dias", data.forecast60Days],
              ["90 dias", data.forecast90Days],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border bg-muted/15 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className={cn(
                  "mt-2 font-mono text-xl font-semibold tabular-nums",
                  Number(value) >= 0 ? "text-success" : "text-destructive",
                )}>
                  {currency(Number(value), currencyCode)}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-lg">Composição do período</CardTitle>
            <CardDescription>Realizado e valores ainda em aberto usam a mesma fonte canônica.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {[
              ["Recebido", data.settledIncome, "text-success"],
              ["Pago", data.settledExpense, "text-foreground"],
              ["A receber", data.pendingIncome, "text-warning"],
              ["A pagar", data.pendingExpense, "text-destructive"],
              ["Receita recorrente", data.recurringRevenue, "text-primary"],
              ["Saldo projetado", data.openingBalance + data.net, "text-foreground"],
            ].map(([label, value, color]) => (
              <div key={String(label)} className="rounded-lg border bg-muted/15 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className={cn("mt-2 font-mono text-lg font-semibold tabular-nums", color)}>
                  {currency(Number(value), currencyCode)}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-lg">Clientes que pedem atenção</CardTitle>
            <CardDescription>Maiores saldos vencidos no portfólio atual.</CardDescription>
          </CardHeader>
          <CardContent>
            {clients.isLoading ? (
              <div className="space-y-3"><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
            ) : clients.error ? (
              <p className="text-sm text-destructive">{messageOf(clients.error)}</p>
            ) : (clients.data || []).filter((client) => client.overdueAmount > 0).length === 0 ? (
              <div className="flex items-center gap-3 rounded-lg border border-success/30 bg-success/5 p-4">
                <CircleCheck className="h-5 w-5 text-success" aria-hidden="true" />
                <p className="text-sm text-foreground">Nenhum saldo vencido entre os clientes listados.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {(clients.data || [])
                  .filter((client) => client.overdueAmount > 0)
                  .sort((left, right) => right.overdueAmount - left.overdueAmount)
                  .slice(0, 5)
                  .map((client) => (
                    <div key={client.clientId} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{client.clientName}</p>
                        <p className="text-xs text-muted-foreground">{client.planName || "Sem plano vinculado"}</p>
                      </div>
                      <p className="shrink-0 font-mono text-sm font-semibold tabular-nums text-destructive">
                        {currency(client.overdueAmount, currencyCode)}
                      </p>
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function EntryCard({
  entry,
  mode,
  readOnly,
  onSettle,
}: {
  entry: FinanceEntry;
  mode: FinanceMode;
  readOnly: boolean;
  onSettle: (entry: FinanceEntry) => void;
}) {
  const canSettle = !readOnly && entry.canSettle;
  const cashMode = mode === "cash";
  return (
    <article className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {entry.direction === "income" ? (
              <ArrowDownToLine className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
            ) : (
              <ArrowUpFromLine className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            )}
            <h3 className="break-words text-sm font-semibold text-foreground">{entry.description}</h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{entry.clientName || entry.category || "Sem vínculo"}</p>
        </div>
        <StatusBadge status={entry.status} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div><p className="text-xs text-muted-foreground">{cashMode ? "Valor líquido" : "Valor"}</p><p className="mt-1 font-mono font-semibold tabular-nums">{currency(cashMode ? entry.signedAmount : entry.amount)}</p></div>
        <div><p className="text-xs text-muted-foreground">{cashMode ? "Liquidação" : "Vencimento"}</p><p className="mt-1 font-medium">{dateLabel(cashMode ? entry.settledAt : entry.dueDate)}</p></div>
        {cashMode ? (
          <div className="col-span-2"><p className="text-xs text-muted-foreground">Competência de origem</p><p className="mt-1 font-medium">{entry.competence ? competenceLabel(entry.competence.slice(0, 7)) : "-"}</p></div>
        ) : (
          <>
            <div><p className="text-xs text-muted-foreground">Liquidado</p><p className="mt-1 font-mono tabular-nums">{currency(entry.settledAmount)}</p></div>
            <div><p className="text-xs text-muted-foreground">Em aberto</p><p className="mt-1 font-mono tabular-nums">{currency(entry.outstandingAmount)}</p></div>
          </>
        )}
      </div>
      {canSettle && (
        <Button type="button" variant="outline" className="mt-4 min-h-11 w-full" onClick={() => onSettle(entry)}>
          <Banknote className="h-4 w-4" />
          Registrar liquidação
        </Button>
      )}
    </article>
  );
}

function CashFlowTab({ mode, competence, readOnly }: { mode: FinanceMode; competence: string; readOnly: boolean }) {
  const entries = useFinanceEntries(mode, competence);
  const { recordSettlement } = useFinanceMutations();
  const [selectedEntry, setSelectedEntry] = useState<FinanceEntry | null>(null);
  const [settlementAmount, setSettlementAmount] = useState("");
  const [settledOn, setSettledOn] = useState(todayBR());
  const [settlementMethod, setSettlementMethod] = useState("bank_transfer");
  const [settlementNotes, setSettlementNotes] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(mutationKey());

  const openSettlement = (entry: FinanceEntry) => {
    setSelectedEntry(entry);
    setSettlementAmount(String(entry.outstandingAmount));
    setSettledOn(todayBR());
    setSettlementMethod("bank_transfer");
    setSettlementNotes("");
    setIdempotencyKey(mutationKey());
  };

  const submitSettlement = async () => {
    if (!selectedEntry || readOnly || !selectedEntry.canSettle) return;
    const amount = Number(settlementAmount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > selectedEntry.outstandingAmount) {
      toast.error("Informe um valor maior que zero e limitado ao saldo em aberto.");
      return;
    }
    try {
      await recordSettlement.mutateAsync({
        entryId: selectedEntry.entryId || selectedEntry.id,
        amount,
        settledOn,
        method: settlementMethod,
        notes: settlementNotes,
        idempotencyKey,
      });
      toast.success("Liquidação registrada com sucesso.");
      setSelectedEntry(null);
    } catch (error) {
      toast.error(messageOf(error));
    }
  };

  if (entries.isLoading) return <LoadingPanel />;
  if (entries.error) return <ErrorPanel error={entries.error} onRetry={() => void entries.refetch()} />;
  const rows = entries.data || [];
  if (rows.length === 0) {
    return <EmptyPanel title="Nenhum lançamento nesta competência" description="Gere a competência ou ajuste o período para visualizar entradas e saídas." />;
  }

  const cashMode = mode === "cash";
  const income = rows.filter((entry) => entry.direction === "income").reduce((sum, entry) => sum + entry.amount, 0);
  const expense = rows.filter((entry) => entry.direction === "expense").reduce((sum, entry) => sum + entry.amount, 0);
  const open = rows.reduce((sum, entry) => sum + entry.outstandingAmount, 0);
  const net = rows.reduce((sum, entry) => sum + entry.signedAmount, 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Entradas" value={compactCurrency(income)} detail={`${rows.filter((row) => row.direction === "income").length} ${cashMode ? "movimentos" : "lançamentos"}`} icon={ArrowDownToLine} tone="positive" />
        <MetricCard label="Saídas" value={compactCurrency(expense)} detail={`${rows.filter((row) => row.direction === "expense").length} ${cashMode ? "movimentos" : "lançamentos"}`} icon={ArrowUpFromLine} tone="negative" />
        <MetricCard label={cashMode ? "Saldo líquido" : "Saldo em aberto"} value={compactCurrency(cashMode ? net : open)} detail={cashMode ? "Movimentos pela data de liquidação" : "Recebimentos e pagamentos pendentes"} icon={cashMode ? WalletCards : Clock3} tone={cashMode ? (net >= 0 ? "positive" : "negative") : "warning"} />
      </div>

      <div className="grid gap-3 md:hidden">
        {rows.map((entry) => <EntryCard key={entry.id} entry={entry} mode={mode} readOnly={readOnly} onSettle={openSettlement} />)}
      </div>

      <Card className="hidden overflow-hidden shadow-none md:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-sm">
            <caption className="sr-only">Lançamentos de {competenceLabel(competence)}</caption>
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Lançamento</th>
                <th className="px-4 py-3 font-medium">{cashMode ? "Liquidação" : "Vencimento"}</th>
                <th className="px-4 py-3 text-right font-medium">{cashMode ? "Valor líquido" : "Valor"}</th>
                <th className="px-4 py-3 text-right font-medium">Em aberto</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((entry) => {
                const canSettle = !readOnly && entry.canSettle;
                return (
                  <tr key={entry.id} className="transition-colors hover:bg-muted/30">
                    <td className="px-4 py-4">
                      <div className="flex items-start gap-3">
                        <span className={cn("mt-0.5 rounded-md p-1.5", entry.direction === "income" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>
                          {entry.direction === "income" ? <ArrowDownToLine className="h-4 w-4" /> : <ArrowUpFromLine className="h-4 w-4" />}
                        </span>
                        <div><p className="font-medium text-foreground">{entry.description}</p><p className="mt-0.5 text-xs text-muted-foreground">{entry.clientName || entry.category || "Sem vínculo"}</p></div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-muted-foreground">{dateLabel(cashMode ? entry.settledAt : entry.dueDate)}</td>
                    <td className="px-4 py-4 text-right font-mono tabular-nums">{currency(cashMode ? entry.signedAmount : entry.amount)}</td>
                    <td className="px-4 py-4 text-right font-mono tabular-nums">{cashMode ? "-" : currency(entry.outstandingAmount)}</td>
                    <td className="px-4 py-4"><StatusBadge status={entry.status} /></td>
                    <td className="px-4 py-4 text-right">
                      {canSettle ? <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => openSettlement(entry)}>Liquidar</Button> : <span className="text-xs text-muted-foreground">Somente leitura</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {!readOnly && <Dialog open={!!selectedEntry} onOpenChange={(open) => !open && setSelectedEntry(null)}>
        <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar liquidação</DialogTitle>
            <DialogDescription>{selectedEntry?.description}. O lançamento original será preservado.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Saldo em aberto</span><strong className="font-mono tabular-nums">{currency(selectedEntry?.outstandingAmount || 0)}</strong></div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="settlement-amount">Valor liquidado *</Label>
              <Input id="settlement-amount" type="number" inputMode="decimal" min="0.01" step="0.01" className="h-11" value={settlementAmount} onChange={(event) => setSettlementAmount(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="settlement-date">Data da liquidação *</Label>
              <Input id="settlement-date" type="date" className="h-11" value={settledOn} onChange={(event) => setSettledOn(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="settlement-method">Forma de pagamento</Label>
              <Select value={settlementMethod} onValueChange={setSettlementMethod}>
                <SelectTrigger id="settlement-method" className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank_transfer">Transferência</SelectItem>
                  <SelectItem value="pix">Pix</SelectItem>
                  <SelectItem value="card">Cartão</SelectItem>
                  <SelectItem value="cash">Dinheiro</SelectItem>
                  <SelectItem value="other">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="settlement-notes">Observações</Label>
              <Textarea id="settlement-notes" value={settlementNotes} onChange={(event) => setSettlementNotes(event.target.value)} placeholder="Referência, comprovante ou contexto da liquidação" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setSelectedEntry(null)}>Cancelar</Button>
            <Button type="button" className="min-h-11" disabled={recordSettlement.isPending} onClick={() => void submitSettlement()}>
              {recordSettlement.isPending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <CircleCheck className="h-4 w-4" />}
              Confirmar liquidação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}
    </div>
  );
}

type ClientProfileOption = {
  id: string;
  full_name?: string | null;
  company_name?: string | null;
  email?: string | null;
};

type SubscriptionClient = {
  id: string;
  name: string;
  email: string | null;
  summary: ClientFinancialSummary | null;
};

type AssignClientDraft = {
  clientId: string;
  planVersionId: string;
  pricingMode: FinancePricingMode;
  operationalAmount: string;
  taxRatePercent: string;
  directCost: string;
  dueDay: string;
  paymentMethod: string;
  effectiveCompetence: string;
  justification: string;
};

const emptyAssignClientDraft = (): AssignClientDraft => ({
  clientId: "",
  planVersionId: "",
  pricingMode: "linked",
  operationalAmount: "",
  taxRatePercent: "",
  directCost: "",
  dueDay: "10",
  paymentMethod: "unspecified",
  effectiveCompetence: currentCompetence(),
  justification: "",
});

function ClientRow({
  client,
  readOnly,
  onAssign,
}: {
  client: SubscriptionClient;
  readOnly: boolean;
  onAssign: (client: SubscriptionClient) => void;
}) {
  const summary = client.summary;
  const hasConfiguredTerm = !!summary && summary.status !== "not_configured";
  return (
    <div className="grid gap-4 rounded-xl border bg-card p-4 shadow-sm lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(110px,0.55fr))_auto] lg:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="break-words text-sm font-semibold text-foreground">{client.name}</h3>
          <StatusBadge status={hasConfiguredTerm ? summary.billingStatus : "unlinked"} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {hasConfiguredTerm ? `${summary.planName || "Plano personalizado"} · próximo vencimento ${dateLabel(summary.nextDueDate)}` : "Sem termo financeiro vigente"}
        </p>
        {summary?.upcomingStartsOn && (
          <p className="mt-1 text-xs font-medium text-primary">
            Programado: {summary.upcomingPlanName || "nova condição"} a partir de {dateLabel(summary.upcomingStartsOn)}
          </p>
        )}
      </div>
      <div><p className="text-xs text-muted-foreground">Operacional mensal</p><p className="mt-1 font-mono text-sm font-semibold tabular-nums">{hasConfiguredTerm ? currency(summary.planAmount) : "-"}</p></div>
      <div><p className="text-xs text-muted-foreground">Bruto mensal</p><p className="mt-1 font-mono text-sm font-semibold tabular-nums">{hasConfiguredTerm ? currency(summary.finalPlanAmount) : "-"}</p></div>
      <div><p className="text-xs text-muted-foreground">Em aberto</p><p className="mt-1 font-mono text-sm font-semibold tabular-nums text-warning">{summary ? currency(summary.openAmount) : "-"}</p></div>
      {!readOnly && (
        <Button type="button" variant="outline" className="min-h-11 w-full lg:w-auto" onClick={() => onAssign(client)}>
          {hasConfiguredTerm ? "Alterar vínculo" : "Vincular plano"}
        </Button>
      )}
    </div>
  );
}

function SubscriptionsTab({ readOnly }: { readOnly: boolean }) {
  const summariesQuery = useClientFinancialSummaries();
  const profilesQuery = useClients();
  const plansQuery = useFinancePlans();
  const settingsQuery = useFinanceSettings();
  const { assignClientPlan } = useFinanceMutations();
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignDraft, setAssignDraft] = useState<AssignClientDraft>(emptyAssignClientDraft);
  const [assignError, setAssignError] = useState<string | null>(null);

  const summaries = useMemo(() => summariesQuery.data || [], [summariesQuery.data]);
  const profiles = useMemo(
    () => (profilesQuery.data || []) as ClientProfileOption[],
    [profilesQuery.data],
  );
  const clients = useMemo(() => {
    const roster = new Map<string, SubscriptionClient>();
    profiles.forEach((profile) => {
      roster.set(profile.id, {
        id: profile.id,
        name: profile.company_name || profile.full_name || profile.email || "Cliente",
        email: profile.email || null,
        summary: null,
      });
    });
    summaries.forEach((summary) => {
      const current = roster.get(summary.clientId);
      roster.set(summary.clientId, {
        id: summary.clientId,
        name: current?.name || summary.clientName,
        email: current?.email || null,
        summary,
      });
    });
    return [...roster.values()].sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
  }, [profiles, summaries]);

  const minimumCompetenceForClient = (client?: SubscriptionClient | null) =>
    client?.summary?.upcomingStartsOn
      ? nextCompetenceStart(client.summary.upcomingStartsOn).slice(0, 7)
      : currentCompetence();
  const selectedClient = clients.find((client) => client.id === assignDraft.clientId) || null;
  const minimumAssignmentCompetence = minimumCompetenceForClient(selectedClient);

  const effectiveDate = effectiveDateForCompetence(assignDraft.effectiveCompetence);
  const versionOptions = useMemo(() => (plansQuery.data || [])
    .filter((plan) => plan.isActive)
    .flatMap((plan) => plan.versions
      .filter((version) => version.isActive && versionCoversDate(version, effectiveDate))
      .map((version) => ({ plan, version }))), [effectiveDate, plansQuery.data]);
  const selectedOption = versionOptions.find(({ version }) => version.id === assignDraft.planVersionId) || null;
  const previewOperational = assignDraft.pricingMode === "linked"
    ? selectedOption?.version.amount || 0
    : Number(assignDraft.operationalAmount) || 0;
  const previewTaxRate = assignDraft.pricingMode === "linked"
    ? selectedOption?.version.taxRate ?? null
    : assignDraft.taxRatePercent === "" ? null : Number(assignDraft.taxRatePercent) / 100;
  const previewDirectCost = assignDraft.pricingMode === "linked"
    ? selectedOption?.version.directCost || 0
    : Number(assignDraft.directCost) || 0;
  const previewFinal = calculateGrossedUpAmount(previewOperational, previewTaxRate);
  const previewNeedsReview = previewTaxRate === null || selectedOption?.version.amountKind === "needs_review";

  const selectVersion = (versionId: string) => {
    const option = versionOptions.find(({ version }) => version.id === versionId);
    setAssignDraft((draft) => ({
      ...draft,
      planVersionId: versionId,
      operationalAmount: option ? String(option.version.amount) : "",
      taxRatePercent: option?.version.taxRate === null || option?.version.taxRate === undefined
        ? ""
        : String(Math.round(option.version.taxRate * 10_000) / 100),
      directCost: option ? String(option.version.directCost) : "",
    }));
    setAssignError(null);
  };

  const openAssign = (client?: SubscriptionClient) => {
    if (readOnly) return;
    const effectiveCompetence = minimumCompetenceForClient(client);
    const startDate = effectiveDateForCompetence(effectiveCompetence);
    const available = (plansQuery.data || [])
      .filter((plan) => plan.isActive)
      .flatMap((plan) => plan.versions
        .filter((version) => version.isActive && versionCoversDate(version, startDate))
        .map((version) => ({ plan, version })));
    const matching = client?.summary
      ? available.find(({ plan, version }) => plan.name === client.summary?.planName
        && Math.abs(version.amount - (client.summary?.operationalAmount || 0)) < 0.01)
      : null;
    const samePlan = client?.summary
      ? available.find(({ plan }) => plan.name === client.summary?.planName)
      : null;
    const initial = matching || samePlan || available[0] || null;
    setAssignDraft({
      clientId: client?.id || "",
      planVersionId: initial?.version.id || "",
      pricingMode: client?.summary?.pricingMode === "custom" ? "custom" : "linked",
      operationalAmount: String(client?.summary?.operationalAmount ?? initial?.version.amount ?? ""),
      taxRatePercent: client?.summary?.taxRate === null || client?.summary?.taxRate === undefined
        ? initial?.version.taxRate === null || initial?.version.taxRate === undefined ? "" : String(Math.round(initial.version.taxRate * 10_000) / 100)
        : String(Math.round(client.summary.taxRate * 10_000) / 100),
      directCost: String(client?.summary?.directCost ?? initial?.version.directCost ?? settingsQuery.data?.defaultDirectCost ?? 275),
      dueDay: String(client?.summary?.dueDay ?? settingsQuery.data?.defaultDueDay ?? 10),
      paymentMethod: "unspecified",
      effectiveCompetence,
      justification: "",
    });
    setAssignError(null);
    setAssignOpen(true);
  };

  const submitAssignment = async () => {
    if (readOnly) return;
    const dueDay = Number(assignDraft.dueDay);
    if (!assignDraft.clientId || !selectedOption) return setAssignError("Selecione o cliente e uma versão de plano válida para a competência.");
    if (assignDraft.effectiveCompetence < minimumAssignmentCompetence) return setAssignError(`A vigência deve começar em ${competenceLabel(minimumAssignmentCompetence)} ou depois.`);
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28) return setAssignError("Informe um dia de vencimento entre 1 e 28.");
    if (assignDraft.pricingMode === "custom") {
      if (!Number.isFinite(previewOperational) || previewOperational <= 0) return setAssignError("Informe um valor operacional personalizado maior que zero.");
      if (previewTaxRate !== null && (!Number.isFinite(previewTaxRate) || previewTaxRate < 0 || previewTaxRate >= 1)) return setAssignError("A alíquota deve ficar entre 0% e menos de 100%.");
      if (!Number.isFinite(previewDirectCost) || previewDirectCost < 0) return setAssignError("O custo direto não pode ser negativo.");
      if (!assignDraft.justification.trim()) return setAssignError("Explique por que este cliente terá uma condição personalizada.");
    }
    setAssignError(null);
    try {
      await assignClientPlan.mutateAsync({
        clientId: assignDraft.clientId,
        planVersionId: assignDraft.planVersionId,
        effectiveFrom: effectiveDateForCompetence(assignDraft.effectiveCompetence),
        pricingMode: assignDraft.pricingMode,
        operationalAmount: assignDraft.pricingMode === "custom" ? previewOperational : null,
        taxRate: assignDraft.pricingMode === "custom" ? previewTaxRate : null,
        directCost: assignDraft.pricingMode === "custom" ? previewDirectCost : null,
        dueDay,
        paymentMethod: assignDraft.paymentMethod === "unspecified" ? null : assignDraft.paymentMethod,
        justification: assignDraft.pricingMode === "custom" ? assignDraft.justification : null,
      });
      toast.success("Vínculo financeiro atualizado sem reescrever o histórico.");
      setAssignOpen(false);
    } catch (error) {
      setAssignError(messageOf(error));
    }
  };

  if (summariesQuery.isLoading || profilesQuery.isLoading || plansQuery.isLoading || settingsQuery.isLoading) return <LoadingPanel />;
  const queryError = summariesQuery.error || profilesQuery.error || plansQuery.error || settingsQuery.error;
  if (queryError) return <ErrorPanel error={queryError} onRetry={() => void Promise.all([summariesQuery.refetch(), profilesQuery.refetch(), plansQuery.refetch(), settingsQuery.refetch()])} />;

  const activeSummaries = summaries.filter((client) => client.status === "active" && !client.reviewRequired);
  const mrr = activeSummaries.reduce((sum, client) => sum + client.planAmount, 0);
  const open = summaries.reduce((sum, client) => sum + client.openAmount, 0);
  const overdue = summaries.reduce((sum, client) => sum + client.overdueAmount, 0);
  const unlinked = clients.filter((client) => !client.summary || client.summary.status === "not_configured").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-sm font-semibold text-foreground">Carteira de mensalidades</p><p className="mt-1 text-sm text-muted-foreground">{unlinked} cliente(s) sem termo financeiro vigente.</p></div>
        {!readOnly && <Button type="button" className="min-h-11" onClick={() => openAssign()}><Plus className="h-4 w-4" />Vincular cliente</Button>}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="MRR contratado" value={compactCurrency(mrr)} detail={`${activeSummaries.length} clientes ativos e revisados`} icon={CircleDollarSign} tone="positive" />
        <MetricCard label="A receber" value={compactCurrency(open)} detail="Saldo aberto das mensalidades" icon={FileClock} tone="warning" />
        <MetricCard label="Vencido" value={compactCurrency(overdue)} detail="Prioridade de cobrança" icon={CircleAlert} tone={overdue > 0 ? "negative" : "neutral"} />
      </div>
      {clients.length === 0 ? (
        <EmptyPanel icon={UsersRound} title="Nenhum cliente disponível" description="Cadastre um cliente antes de criar seu vínculo financeiro." />
      ) : (
        <div className="space-y-3">{clients.map((client) => <ClientRow key={client.id} client={client} readOnly={readOnly} onAssign={openAssign} />)}</div>
      )}

      {!readOnly && <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-3xl">
          <DialogHeader><DialogTitle>Vincular plano ao cliente</DialogTitle><DialogDescription>Cria um novo termo com vigência própria. O vínculo anterior e as competências geradas permanecem no histórico.</DialogDescription></DialogHeader>
          <div className="space-y-5">
            {assignError && <Alert variant="destructive" role="alert"><CircleAlert className="h-4 w-4" /><AlertTitle>Revise o vínculo</AlertTitle><AlertDescription>{assignError}</AlertDescription></Alert>}
            <fieldset className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2">
              <legend className="px-2 text-sm font-semibold text-foreground">Cliente e vigência</legend>
              <div className="space-y-2"><Label htmlFor="assignment-client">Cliente *</Label><Select value={assignDraft.clientId} onValueChange={(value) => { const client = clients.find((item) => item.id === value); const effectiveCompetence = minimumCompetenceForClient(client); setAssignDraft((draft) => ({ ...draft, clientId: value, effectiveCompetence, planVersionId: "" })); }}><SelectTrigger id="assignment-client" className="h-11"><SelectValue placeholder="Selecione o cliente" /></SelectTrigger><SelectContent>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label htmlFor="assignment-competence">Vigência por competência *</Label><Input id="assignment-competence" type="month" min={minimumAssignmentCompetence} className="h-11" value={assignDraft.effectiveCompetence} onChange={(event) => setAssignDraft((draft) => ({ ...draft, effectiveCompetence: event.target.value || minimumAssignmentCompetence, planVersionId: "" }))} /></div>
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="assignment-version">Plano e versão válidos *</Label><Select value={assignDraft.planVersionId} onValueChange={selectVersion}><SelectTrigger id="assignment-version" className="h-11"><SelectValue placeholder="Selecione plano e versão" /></SelectTrigger><SelectContent>{versionOptions.map(({ plan, version }) => <SelectItem key={version.id} value={version.id}>{plan.name} · V{version.version} · {currency(version.finalAmount)}</SelectItem>)}</SelectContent></Select>{versionOptions.length === 0 && <p className="text-xs text-warning">Nenhuma versão cobre esta competência. Crie ou ajuste uma versão em Planos e preços.</p>}</div>
            </fieldset>

            <fieldset className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-3">
              <legend className="px-2 text-sm font-semibold text-foreground">Condição comercial</legend>
              <div className="space-y-2"><Label htmlFor="assignment-pricing-mode">Tipo de preço *</Label><Select value={assignDraft.pricingMode} onValueChange={(value) => setAssignDraft((draft) => ({ ...draft, pricingMode: value as FinancePricingMode }))}><SelectTrigger id="assignment-pricing-mode" className="h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="linked">Vinculado ao plano</SelectItem><SelectItem value="custom">Personalizado</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label htmlFor="assignment-due-day">Dia de vencimento *</Label><Input id="assignment-due-day" type="number" inputMode="numeric" min="1" max="28" className="h-11" value={assignDraft.dueDay} onChange={(event) => setAssignDraft((draft) => ({ ...draft, dueDay: event.target.value }))} /></div>
              <div className="space-y-2"><Label htmlFor="assignment-payment-method">Forma de pagamento</Label><Select value={assignDraft.paymentMethod} onValueChange={(value) => setAssignDraft((draft) => ({ ...draft, paymentMethod: value }))}><SelectTrigger id="assignment-payment-method" className="h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unspecified">Não informada</SelectItem><SelectItem value="pix">Pix</SelectItem><SelectItem value="bank_transfer">Transferência</SelectItem><SelectItem value="card">Cartão</SelectItem><SelectItem value="boleto">Boleto</SelectItem><SelectItem value="other">Outro</SelectItem></SelectContent></Select></div>
              {assignDraft.pricingMode === "custom" && <>
                <div className="space-y-2"><Label htmlFor="assignment-operational">Valor operacional *</Label><Input id="assignment-operational" type="number" inputMode="decimal" min="0.01" step="0.01" className="h-11" value={assignDraft.operationalAmount} onChange={(event) => setAssignDraft((draft) => ({ ...draft, operationalAmount: event.target.value }))} /></div>
                <div className="space-y-2"><Label htmlFor="assignment-tax">Alíquota (%)</Label><Input id="assignment-tax" type="number" inputMode="decimal" min="0" max="99.99" step="0.01" className="h-11" value={assignDraft.taxRatePercent} onChange={(event) => setAssignDraft((draft) => ({ ...draft, taxRatePercent: event.target.value }))} /><p className="text-xs text-muted-foreground">Em branco mantém o termo em revisão.</p></div>
                <div className="space-y-2"><Label htmlFor="assignment-direct-cost">Custo direto *</Label><Input id="assignment-direct-cost" type="number" inputMode="decimal" min="0" step="0.01" className="h-11" value={assignDraft.directCost} onChange={(event) => setAssignDraft((draft) => ({ ...draft, directCost: event.target.value }))} /></div>
                <div className="space-y-2 sm:col-span-2 lg:col-span-3"><Label htmlFor="assignment-justification">Justificativa da condição personalizada *</Label><Textarea id="assignment-justification" value={assignDraft.justification} onChange={(event) => setAssignDraft((draft) => ({ ...draft, justification: event.target.value }))} placeholder="Descreva a exceção comercial acordada" /></div>
              </>}
            </fieldset>

            <section className="rounded-xl border border-primary/20 bg-primary/5 p-4" aria-labelledby="assignment-preview-title" aria-live="polite">
              <h3 id="assignment-preview-title" className="text-sm font-semibold text-foreground">Preview do novo termo</h3>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div><p className="text-xs text-muted-foreground">Operacional</p><p className="mt-1 font-mono font-semibold tabular-nums">{currency(previewOperational)}</p></div>
                <div><p className="text-xs text-muted-foreground">Reserva fiscal</p><p className="mt-1 font-mono font-semibold tabular-nums">{currency(Math.max(previewFinal - previewOperational, 0))}</p></div>
                <div><p className="text-xs text-muted-foreground">Valor final</p><p className="mt-1 font-mono font-semibold tabular-nums">{currency(previewFinal)}</p></div>
                <div><p className="text-xs text-muted-foreground">Custo direto</p><p className="mt-1 font-mono font-semibold tabular-nums">{currency(previewDirectCost)}</p></div>
              </div>
              {previewNeedsReview && <p className="mt-3 text-xs font-medium text-warning">Sem alíquota validada, o termo será salvo como “Revisar” e não gerará mensalidade até a revisão.</p>}
            </section>
          </div>
          <DialogFooter><Button type="button" variant="outline" className="min-h-11" onClick={() => setAssignOpen(false)}>Cancelar</Button><Button type="button" className="min-h-11" disabled={assignClientPlan.isPending || !selectedOption} onClick={() => void submitAssignment()}>{assignClientPlan.isPending && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />}Salvar vínculo</Button></DialogFooter>
        </DialogContent>
      </Dialog>}
    </div>
  );
}

const emptyRuleDraft = (): UpsertRecurringRuleInput => ({
  name: "",
  description: "",
  direction: "expense",
  category: "operacional",
  amount: 0,
  frequency: "monthly",
  dueDay: 10,
  startsOn: `${currentCompetence()}-01`,
  endsOn: null,
  brand: null,
  isActive: true,
});

function FixedCostsTab({ readOnly }: { readOnly: boolean }) {
  const rules = useFinanceRecurringRules();
  const { upsertRecurringRule, archiveRecurringRule } = useFinanceMutations();
  const [ruleOpen, setRuleOpen] = useState(false);
  const [ruleDraft, setRuleDraft] = useState<UpsertRecurringRuleInput>(emptyRuleDraft);
  const [archiveTarget, setArchiveTarget] = useState<FinanceRecurringRule | null>(null);

  const openRule = (rule?: FinanceRecurringRule) => {
    setRuleDraft(rule ? {
      id: rule.id,
      name: rule.name,
      description: rule.description,
      direction: "expense",
      category: rule.category,
      amount: rule.amount,
      frequency: rule.frequency,
      dueDay: rule.dueDay,
      startsOn: rule.startsOn,
      endsOn: rule.endsOn,
      brand: rule.brand,
      isActive: rule.isActive,
    } : emptyRuleDraft());
    setRuleOpen(true);
  };

  const saveRule = async () => {
    if (!ruleDraft.name.trim() || !Number.isFinite(Number(ruleDraft.amount)) || Number(ruleDraft.amount) <= 0) {
      toast.error("Informe o nome e um valor válido para o custo fixo.");
      return;
    }
    try {
      await upsertRecurringRule.mutateAsync({ ...ruleDraft, amount: Number(ruleDraft.amount), direction: "expense" });
      toast.success(ruleDraft.id ? "Custo fixo atualizado." : "Custo fixo criado.");
      setRuleOpen(false);
    } catch (error) {
      toast.error(messageOf(error));
    }
  };

  const archiveRule = async () => {
    if (!archiveTarget) return;
    try {
      await archiveRecurringRule.mutateAsync(archiveTarget.id);
      toast.success("Custo fixo arquivado. O histórico foi preservado.");
      setArchiveTarget(null);
    } catch (error) {
      toast.error(messageOf(error));
    }
  };

  if (rules.isLoading) return <LoadingPanel />;
  if (rules.error) return <ErrorPanel error={rules.error} onRetry={() => void rules.refetch()} />;
  const rows = (rules.data || []).filter((rule) => rule.direction === "expense");
  const activeTotal = rows.filter((rule) => rule.isActive).reduce((sum, rule) => sum + rule.amount, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-sm font-medium text-muted-foreground">Base mensal ativa</p><p className="mt-1 font-mono text-2xl font-semibold tabular-nums">{currency(activeTotal)}</p></div>
        {!readOnly && <Button type="button" className="min-h-11" onClick={() => openRule()}><Plus className="h-4 w-4" />Novo custo fixo</Button>}
      </div>

      {rows.length === 0 ? (
        <EmptyPanel icon={Layers3} title="Nenhum custo fixo cadastrado" description="Cadastre despesas recorrentes para incluí-las na geração de competência e na previsão." action={!readOnly ? <Button type="button" className="min-h-11" onClick={() => openRule()}><Plus className="h-4 w-4" />Cadastrar custo</Button> : undefined} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map((rule) => (
            <Card key={rule.id} className={cn("shadow-none", !rule.isActive && "opacity-65")}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-foreground">{rule.name}</h3><StatusBadge status={rule.isActive ? "active" : "inactive"} /></div><p className="mt-1 text-sm text-muted-foreground">{rule.category || "Sem categoria"} · vence no dia {rule.dueDay || "-"}</p></div>
                  <p className="shrink-0 font-mono text-lg font-semibold tabular-nums">{currency(rule.amount)}</p>
                </div>
                {rule.description && <p className="mt-4 text-sm leading-6 text-muted-foreground">{rule.description}</p>}
                {!readOnly && <div className="mt-5 flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => openRule(rule)}><Pencil className="h-4 w-4" />Editar</Button>
                  {rule.isActive && <Button type="button" variant="ghost" size="sm" className="min-h-11 text-muted-foreground" onClick={() => setArchiveTarget(rule)}><Archive className="h-4 w-4" />Arquivar</Button>}
                </div>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!readOnly && <Dialog open={ruleOpen} onOpenChange={setRuleOpen}>
        <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>{ruleDraft.id ? "Editar custo fixo" : "Novo custo fixo"}</DialogTitle><DialogDescription>A regra gera lançamentos idempotentes quando uma competência é confirmada.</DialogDescription></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="rule-name">Nome *</Label><Input id="rule-name" className="h-11" value={ruleDraft.name} onChange={(event) => setRuleDraft((draft) => ({ ...draft, name: event.target.value }))} /></div>
            <div className="space-y-2"><Label htmlFor="rule-amount">Valor *</Label><Input id="rule-amount" type="number" inputMode="decimal" min="0.01" step="0.01" className="h-11" value={ruleDraft.amount || ""} onChange={(event) => setRuleDraft((draft) => ({ ...draft, amount: Number(event.target.value) }))} /></div>
            <div className="space-y-2"><Label htmlFor="rule-due-day">Dia de vencimento</Label><Input id="rule-due-day" type="number" inputMode="numeric" min="1" max="28" className="h-11" value={ruleDraft.dueDay || ""} onChange={(event) => setRuleDraft((draft) => ({ ...draft, dueDay: Number(event.target.value) }))} /></div>
            <div className="space-y-2"><Label htmlFor="rule-category">Categoria</Label><Input id="rule-category" className="h-11" value={ruleDraft.category || ""} onChange={(event) => setRuleDraft((draft) => ({ ...draft, category: event.target.value }))} /></div>
            <div className="space-y-2"><Label htmlFor="rule-start">Início</Label><Input id="rule-start" type="date" className="h-11" value={ruleDraft.startsOn || ""} onChange={(event) => setRuleDraft((draft) => ({ ...draft, startsOn: event.target.value }))} /></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="rule-description">Descrição</Label><Textarea id="rule-description" value={ruleDraft.description || ""} onChange={(event) => setRuleDraft((draft) => ({ ...draft, description: event.target.value }))} /></div>
          </div>
          <DialogFooter><Button type="button" variant="outline" className="min-h-11" onClick={() => setRuleOpen(false)}>Cancelar</Button><Button type="button" className="min-h-11" disabled={upsertRecurringRule.isPending} onClick={() => void saveRule()}>{upsertRecurringRule.isPending && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />}Salvar custo</Button></DialogFooter>
        </DialogContent>
      </Dialog>}

      {!readOnly && <AlertDialog open={!!archiveTarget} onOpenChange={(open) => !open && setArchiveTarget(null)}>
        <AlertDialogContent className="w-[calc(100%-2rem)]">
          <AlertDialogHeader><AlertDialogTitle>Arquivar custo fixo?</AlertDialogTitle><AlertDialogDescription>Novas competências deixarão de incluir “{archiveTarget?.name}”. Lançamentos já gerados e o histórico permanecerão intactos.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel className="min-h-11">Cancelar</AlertDialogCancel><AlertDialogAction className="min-h-11" disabled={archiveRecurringRule.isPending} onClick={() => void archiveRule()}>Arquivar regra</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>}
    </div>
  );
}

const emptyPlanDraft = (): UpsertPlanInput => ({ name: "", code: "", description: "", isActive: true });

type PlanVersionDraft = {
  amount: string;
  taxRatePercent: string;
  directCost: string;
  directCostEstimated: boolean;
  billingPeriod: FinanceBillingPeriod;
  setupFee: string;
  effectiveFrom: string;
  description: string;
};

const emptySettingsDraft = (): UpdateSettingsInput => ({
  currency: "BRL",
  openingBalance: 0,
  reserveTarget: 0,
  defaultDueDay: 10,
  forecastMonths: 6,
  monthlyGoal: null,
  growthRetentionRate: null,
  minimumReserveMonths: null,
  desiredMinimumMargin: null,
  currentProLabore: 3000,
  targetProLabore: 10000,
  defaultDirectCost: 275,
  allocationMethod: "equal",
  includeProLaboreInAllocation: false,
});

const minimumVersionDate = (plan: FinancePlan) => {
  const latestDate = plan.versions[0]?.effectiveFrom;
  const currentStart = effectiveDateForCompetence(currentCompetence());
  const afterLatest = latestDate ? nextCompetenceStart(latestDate) : currentStart;
  return afterLatest > currentStart ? afterLatest : currentStart;
};

function PlanCard({ plan, readOnly, onEdit, onVersion, onArchive }: { plan: FinancePlan; readOnly: boolean; onEdit: (plan: FinancePlan) => void; onVersion: (plan: FinancePlan) => void; onArchive: (plan: FinancePlan) => void }) {
  const version = plan.currentVersion;
  const upcoming = plan.upcomingVersion;
  return (
    <Card className={cn("shadow-none", !plan.isActive && "opacity-65")}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-foreground">{plan.name}</h3><StatusBadge status={plan.isActive ? "active" : "inactive"} /></div><p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">{plan.code || "Sem código"}</p></div>
          <div className="shrink-0 text-right">
            <p className="font-mono text-xl font-semibold tabular-nums">{version ? currency(version.finalAmount) : "Sem preço vigente"}</p>
            {version && <p className="mt-1 text-xs text-muted-foreground">operacional {currency(version.amount)}</p>}
          </div>
        </div>
        <p className="mt-4 min-h-10 text-sm leading-5 text-muted-foreground">{plan.description || "Sem descrição cadastrada."}</p>
        {version ? (
          <div className="mt-4 space-y-3 rounded-lg border bg-muted/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>V{version.version} · vigente desde <strong className="text-foreground">{dateLabel(version.effectiveFrom)}</strong></span>
              {version.amountKind === "needs_review" && <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning">Revisar imposto</Badge>}
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div><p className="text-muted-foreground">Imposto</p><p className="mt-1 font-medium text-foreground">{percentageLabel(version.taxRate)}</p></div>
              <div><p className="text-muted-foreground">Custo direto</p><p className="mt-1 font-mono font-medium tabular-nums text-foreground">{currency(version.directCost)}</p></div>
              <div><p className="text-muted-foreground">Cobrança</p><p className="mt-1 font-medium text-foreground">{BILLING_PERIOD_LABELS[version.billingPeriod]}</p></div>
              <div><p className="text-muted-foreground">Setup</p><p className="mt-1 font-mono font-medium tabular-nums text-foreground">{currency(version.setupFee)}</p></div>
            </div>
          </div>
        ) : !upcoming ? (
          <div className="mt-4 rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">Crie a primeira versão de preço para ativar a contratação.</div>
        ) : null}
        {upcoming && (
          <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-foreground">V{upcoming.version} programada para {dateLabel(upcoming.effectiveFrom)}</span>
              <span className="font-mono font-semibold tabular-nums text-primary">{currency(upcoming.finalAmount)}</span>
            </div>
            <p className="mt-1 text-muted-foreground">Ainda não é o preço vigente.</p>
          </div>
        )}
        {!readOnly && <div className="mt-5 flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => onEdit(plan)}><Pencil className="h-4 w-4" />Editar plano</Button>
          {plan.isActive && <Button type="button" variant="secondary" size="sm" className="min-h-11" onClick={() => onVersion(plan)}><Plus className="h-4 w-4" />Nova versão</Button>}
          {plan.isActive && <Button type="button" variant="ghost" size="sm" className="min-h-11 text-muted-foreground" onClick={() => onArchive(plan)}><Archive className="h-4 w-4" />Arquivar</Button>}
        </div>}
      </CardContent>
    </Card>
  );
}

function PlansTab({ readOnly }: { readOnly: boolean }) {
  const plans = useFinancePlans();
  const settings = useFinanceSettings();
  const { upsertPlan, archivePlan, createPlanVersion, updateSettings } = useFinanceMutations();
  const [planOpen, setPlanOpen] = useState(false);
  const [planDraft, setPlanDraft] = useState<UpsertPlanInput>(emptyPlanDraft);
  const [versionPlan, setVersionPlan] = useState<FinancePlan | null>(null);
  const [versionDraft, setVersionDraft] = useState<PlanVersionDraft>({
    amount: "",
    taxRatePercent: "",
    directCost: "275",
    directCostEstimated: true,
    billingPeriod: "monthly",
    setupFee: "0",
    effectiveFrom: effectiveDateForCompetence(currentCompetence()),
    description: "",
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<UpdateSettingsInput>(emptySettingsDraft);
  const [archiveTarget, setArchiveTarget] = useState<FinancePlan | null>(null);

  const openPlan = (plan?: FinancePlan) => {
    setPlanDraft(plan ? { id: plan.id, name: plan.name, code: plan.code, description: plan.description, isActive: plan.isActive } : emptyPlanDraft());
    setPlanOpen(true);
  };

  const openVersion = (plan: FinancePlan) => {
    const current = plan.upcomingVersion || plan.currentVersion || plan.versions[0] || null;
    setVersionPlan(plan);
    setVersionDraft({
      amount: current ? String(current.amount) : "",
      taxRatePercent: current?.taxRate === null || current?.taxRate === undefined
        ? ""
        : String(Math.round(current.taxRate * 10_000) / 100),
      directCost: String(current?.directCost ?? settings.data?.defaultDirectCost ?? 275),
      directCostEstimated: current?.directCostEstimated ?? true,
      billingPeriod: current?.billingPeriod ?? "monthly",
      setupFee: String(current?.setupFee ?? 0),
      effectiveFrom: minimumVersionDate(plan),
      description: "",
    });
  };

  const openSettings = () => {
    setSettingsDraft(settings.data ? {
      currency: settings.data.currency,
      openingBalance: settings.data.openingBalance,
      reserveTarget: settings.data.reserveTarget,
      defaultDueDay: settings.data.defaultDueDay,
      forecastMonths: settings.data.forecastMonths,
      monthlyGoal: settings.data.monthlyGoal,
      growthRetentionRate: settings.data.growthRetentionRate,
      minimumReserveMonths: settings.data.minimumReserveMonths,
      desiredMinimumMargin: settings.data.desiredMinimumMargin,
      currentProLabore: settings.data.currentProLabore,
      targetProLabore: settings.data.targetProLabore,
      defaultDirectCost: settings.data.defaultDirectCost,
      allocationMethod: settings.data.allocationMethod,
      includeProLaboreInAllocation: settings.data.includeProLaboreInAllocation,
    } : emptySettingsDraft());
    setSettingsOpen(true);
  };

  const savePlan = async () => {
    if (!planDraft.name.trim()) return toast.error("Informe o nome do plano.");
    try {
      await upsertPlan.mutateAsync(planDraft);
      toast.success(planDraft.id ? "Plano atualizado." : "Plano criado.");
      setPlanOpen(false);
    } catch (error) { toast.error(messageOf(error)); }
  };

  const saveVersion = async () => {
    const amount = Number(versionDraft.amount);
    const directCost = Number(versionDraft.directCost);
    const setupFee = Number(versionDraft.setupFee);
    const taxRate = versionDraft.taxRatePercent === "" ? null : Number(versionDraft.taxRatePercent) / 100;
    const finalAmount = calculateGrossedUpAmount(amount, taxRate);
    const amountKind: FinanceAmountKind = taxRate === null ? "needs_review" : "operational";
    if (!versionPlan || !Number.isFinite(amount) || amount <= 0 || !versionDraft.effectiveFrom) {
      return toast.error("Informe valor operacional e vigência válidos.");
    }
    if (!/^\d{4}-\d{2}-01$/.test(versionDraft.effectiveFrom)) {
      return toast.error("A vigência deve começar no primeiro dia de uma competência.");
    }
    if (taxRate !== null && (!Number.isFinite(taxRate) || taxRate < 0 || taxRate >= 1)) {
      return toast.error("A alíquota deve estar entre 0% e menos de 100%.");
    }
    if (!Number.isFinite(directCost) || directCost < 0 || !Number.isFinite(setupFee) || setupFee < 0) {
      return toast.error("Custo direto e setup não podem ser negativos.");
    }
    if (versionDraft.effectiveFrom < minimumVersionDate(versionPlan)) {
      return toast.error(`A nova vigência deve começar em ${dateLabel(minimumVersionDate(versionPlan))} ou depois.`);
    }
    try {
      await createPlanVersion.mutateAsync({
        planId: versionPlan.id,
        amount,
        taxRate,
        finalAmount,
        directCost,
        directCostEstimated: versionDraft.directCostEstimated,
        billingPeriod: versionDraft.billingPeriod,
        setupFee,
        amountKind,
        effectiveFrom: versionDraft.effectiveFrom,
        description: versionDraft.description,
      });
      toast.success("Nova versão de preço criada sem alterar o histórico.");
      setVersionPlan(null);
    } catch (error) { toast.error(messageOf(error)); }
  };

  const saveSettings = async () => {
    if (settingsDraft.defaultDueDay < 1 || settingsDraft.defaultDueDay > 28 || settingsDraft.forecastMonths < 1 || settingsDraft.forecastMonths > 24) return toast.error("Use vencimento entre 1 e 28 e previsão entre 1 e 24 meses.");
    if (settingsDraft.growthRetentionRate !== null && (settingsDraft.growthRetentionRate < 0 || settingsDraft.growthRetentionRate > 1)) return toast.error("A retenção do crescimento deve ficar entre 0% e 100%.");
    if (settingsDraft.desiredMinimumMargin !== null && (settingsDraft.desiredMinimumMargin < -1 || settingsDraft.desiredMinimumMargin > 1)) return toast.error("A margem mínima deve ficar entre -100% e 100%.");
    if ([settingsDraft.openingBalance, settingsDraft.reserveTarget, settingsDraft.currentProLabore, settingsDraft.targetProLabore, settingsDraft.defaultDirectCost].some((value) => !Number.isFinite(value))) return toast.error("Revise os valores financeiros obrigatórios.");
    if ([settingsDraft.reserveTarget, settingsDraft.currentProLabore, settingsDraft.targetProLabore, settingsDraft.defaultDirectCost].some((value) => value < 0)) return toast.error("Reserva, pró-labore e custo direto não podem ser negativos.");
    if (settingsDraft.monthlyGoal !== null && settingsDraft.monthlyGoal < 0) return toast.error("A meta mensal não pode ser negativa.");
    if (settingsDraft.minimumReserveMonths !== null && settingsDraft.minimumReserveMonths < 0) return toast.error("Os meses de reserva não podem ser negativos.");
    try {
      await updateSettings.mutateAsync(settingsDraft);
      toast.success("Configurações financeiras atualizadas.");
      setSettingsOpen(false);
    } catch (error) { toast.error(messageOf(error)); }
  };

  const doArchivePlan = async () => {
    if (!archiveTarget) return;
    try {
      await archivePlan.mutateAsync(archiveTarget.id);
      toast.success("Plano arquivado. Contratos e preços históricos foram preservados.");
      setArchiveTarget(null);
    } catch (error) { toast.error(messageOf(error)); }
  };

  if (plans.isLoading || settings.isLoading) return <LoadingPanel />;
  if (plans.error) return <ErrorPanel error={plans.error} onRetry={() => void plans.refetch()} />;
  if (settings.error) return <ErrorPanel error={settings.error} onRetry={() => void settings.refetch()} />;
  const rows = plans.data || [];
  const hasVersionsPendingReview = rows.some((plan) =>
    plan.versions.some((version) => version.amountKind === "needs_review"),
  );
  const previewOperationalAmount = Number(versionDraft.amount) || 0;
  const previewTaxRate = versionDraft.taxRatePercent === "" ? null : Number(versionDraft.taxRatePercent) / 100;
  const previewFinalAmount = calculateGrossedUpAmount(previewOperationalAmount, previewTaxRate);
  const previewDirectCost = Number(versionDraft.directCost) || 0;
  const previewMargin = previewOperationalAmount > 0
    ? (previewOperationalAmount - previewDirectCost) / previewOperationalAmount
    : null;
  const previewAmountKind: FinanceAmountKind = previewTaxRate === null ? "needs_review" : "operational";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-sm font-semibold text-foreground">Catálogo comercial</p><p className="mt-1 text-sm text-muted-foreground">Preços são versionados por vigência; o passado não é reescrito.</p></div>
        {!readOnly && <div className="flex flex-col gap-2 sm:flex-row"><Button type="button" variant="outline" className="min-h-11" onClick={openSettings}><Settings2 className="h-4 w-4" />Configurações</Button><Button type="button" className="min-h-11" onClick={() => openPlan()}><Plus className="h-4 w-4" />Novo plano</Button></div>}
      </div>

      <Card className="shadow-none">
        <CardContent className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Moeda</p><p className="mt-1 font-semibold">{settings.data?.currency || "BRL"}</p></div>
          <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Saldo inicial</p><p className="mt-1 font-mono font-semibold tabular-nums">{currency(settings.data?.openingBalance || 0)}</p></div>
          <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Reserva alvo</p><p className="mt-1 font-mono font-semibold tabular-nums">{currency(settings.data?.reserveTarget || 0)}</p></div>
          <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Janela de previsão</p><p className="mt-1 font-semibold">{settings.data?.forecastMonths || 6} meses</p></div>
          <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Meta mensal</p><p className="mt-1 font-mono font-semibold tabular-nums">{settings.data?.monthlyGoal === null ? "-" : currency(settings.data?.monthlyGoal || 0)}</p></div>
          <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Retenção do crescimento</p><p className="mt-1 font-semibold">{percentageLabel(settings.data?.growthRetentionRate ?? null)}</p></div>
          <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Margem mínima</p><p className="mt-1 font-semibold">{percentageLabel(settings.data?.desiredMinimumMargin ?? null)}</p></div>
          <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Pró-labore atual / alvo</p><p className="mt-1 font-mono font-semibold tabular-nums">{currency(settings.data?.currentProLabore || 0)} / {currency(settings.data?.targetProLabore || 0)}</p></div>
          <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Custo direto padrão</p><p className="mt-1 font-mono font-semibold tabular-nums">{currency(settings.data?.defaultDirectCost || 0)}</p></div>
          <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Reserva mínima</p><p className="mt-1 font-semibold">{settings.data?.minimumReserveMonths ?? "-"} meses</p></div>
          <div className="sm:col-span-2"><p className="text-xs uppercase tracking-wide text-muted-foreground">Alocação de custos</p><p className="mt-1 font-semibold">{ALLOCATION_METHOD_LABELS[settings.data?.allocationMethod || "equal"]}{settings.data?.includeProLaboreInAllocation ? " · inclui pró-labore" : " · sem pró-labore"}</p></div>
        </CardContent>
      </Card>

      {hasVersionsPendingReview && (
        <Alert className="border-warning/30 bg-warning/5">
          <CircleAlert className="h-4 w-4" />
          <AlertTitle>Preços importados aguardam revisão</AlertTitle>
          <AlertDescription>Crie uma nova versão no mesmo plano com a alíquota validada. Depois, vincule os clientes na aba Mensalidades a partir da competência escolhida. O snapshot antigo continua preservado.</AlertDescription>
        </Alert>
      )}

      {rows.length === 0 ? <EmptyPanel icon={Landmark} title="Nenhum plano cadastrado" description="Crie um plano e depois adicione sua primeira versão de preço com data de vigência." action={!readOnly ? <Button type="button" className="min-h-11" onClick={() => openPlan()}><Plus className="h-4 w-4" />Criar plano</Button> : undefined} /> : <div className="grid gap-3 lg:grid-cols-2">{rows.map((plan) => <PlanCard key={plan.id} plan={plan} readOnly={readOnly} onEdit={openPlan} onVersion={openVersion} onArchive={setArchiveTarget} />)}</div>}

      {!readOnly && <Dialog open={planOpen} onOpenChange={setPlanOpen}>
        <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>{planDraft.id ? "Editar plano" : "Novo plano"}</DialogTitle><DialogDescription>Defina a identidade comercial. O preço é criado em uma versão separada.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label htmlFor="plan-name">Nome *</Label><Input id="plan-name" className="h-11" value={planDraft.name} onChange={(event) => setPlanDraft((draft) => ({ ...draft, name: event.target.value }))} /></div>
            <div className="space-y-2"><Label htmlFor="plan-code">Código</Label><Input id="plan-code" className="h-11" value={planDraft.code || ""} onChange={(event) => setPlanDraft((draft) => ({ ...draft, code: event.target.value }))} placeholder="Ex.: growth-pro" /></div>
            <div className="space-y-2"><Label htmlFor="plan-description">Descrição</Label><Textarea id="plan-description" value={planDraft.description || ""} onChange={(event) => setPlanDraft((draft) => ({ ...draft, description: event.target.value }))} /></div>
          </div>
          <DialogFooter><Button type="button" variant="outline" className="min-h-11" onClick={() => setPlanOpen(false)}>Cancelar</Button><Button type="button" className="min-h-11" disabled={upsertPlan.isPending} onClick={() => void savePlan()}>{upsertPlan.isPending && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />}Salvar plano</Button></DialogFooter>
        </DialogContent>
      </Dialog>}

      {!readOnly && <Dialog open={!!versionPlan} onOpenChange={(open) => !open && setVersionPlan(null)}>
        <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>Nova versão de preço</DialogTitle><DialogDescription>{versionPlan?.name}. A versão vigente será encerrada na véspera da nova vigência.</DialogDescription></DialogHeader>
          <Alert className="bg-primary/5"><ShieldCheck className="h-4 w-4" /><AlertTitle>Histórico protegido</AlertTitle><AlertDescription>Uma nova versão não altera competências nem contratos anteriores.</AlertDescription></Alert>
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="sr-only">Composição da nova versão de preço</legend>
            <div className="space-y-2">
              <Label htmlFor="version-amount">Valor operacional *</Label>
              <Input id="version-amount" type="number" inputMode="decimal" min="0.01" step="0.01" className="h-11" value={versionDraft.amount} onChange={(event) => setVersionDraft((draft) => ({ ...draft, amount: event.target.value }))} aria-describedby="version-amount-help" />
              <p id="version-amount-help" className="text-xs leading-5 text-muted-foreground">Valor líquido necessário para entregar o serviço, antes do gross-up de impostos.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="version-tax-rate">Alíquota de impostos (%)</Label>
              <Input id="version-tax-rate" type="number" inputMode="decimal" min="0" max="99.99" step="0.01" className="h-11" value={versionDraft.taxRatePercent} onChange={(event) => setVersionDraft((draft) => ({ ...draft, taxRatePercent: event.target.value }))} aria-describedby="version-tax-help" />
              <p id="version-tax-help" className="text-xs leading-5 text-muted-foreground">Deixe vazio apenas se a alíquota ainda precisar de revisão.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="version-direct-cost">Custo direto *</Label>
              <Input id="version-direct-cost" type="number" inputMode="decimal" min="0" step="0.01" className="h-11" value={versionDraft.directCost} onChange={(event) => setVersionDraft((draft) => ({ ...draft, directCost: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="version-billing-period">Período de cobrança *</Label>
              <Select value={versionDraft.billingPeriod} onValueChange={(value) => setVersionDraft((draft) => ({ ...draft, billingPeriod: value as FinanceBillingPeriod }))}>
                <SelectTrigger id="version-billing-period" className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(BILLING_PERIOD_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="version-setup-fee">Taxa de setup</Label>
              <Input id="version-setup-fee" type="number" inputMode="decimal" min="0" step="0.01" className="h-11" value={versionDraft.setupFee} onChange={(event) => setVersionDraft((draft) => ({ ...draft, setupFee: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="version-date">Vigência a partir de *</Label>
              <Input id="version-date" type="date" min={versionPlan ? minimumVersionDate(versionPlan) : effectiveDateForCompetence(currentCompetence())} className="h-11" value={versionDraft.effectiveFrom} onChange={(event) => setVersionDraft((draft) => ({ ...draft, effectiveFrom: event.target.value }))} aria-describedby="version-date-help" />
              <p id="version-date-help" className="text-xs leading-5 text-muted-foreground">Use sempre o primeiro dia do mês. Versões existentes exigem a competência seguinte.</p>
            </div>
            <div className="flex min-h-16 items-center justify-between gap-4 rounded-lg border bg-muted/20 p-3 sm:col-span-2">
              <div><Label htmlFor="version-direct-cost-estimated">Custo direto estimado</Label><p className="mt-1 text-xs leading-5 text-muted-foreground">Marque enquanto o custo ainda não tiver confirmação real.</p></div>
              <Switch id="version-direct-cost-estimated" checked={versionDraft.directCostEstimated} onCheckedChange={(checked) => setVersionDraft((draft) => ({ ...draft, directCostEstimated: checked }))} />
            </div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="version-description">Motivo ou observação</Label><Textarea id="version-description" value={versionDraft.description} onChange={(event) => setVersionDraft((draft) => ({ ...draft, description: event.target.value }))} /></div>
          </fieldset>

          <section className="rounded-xl border border-primary/20 bg-primary/5 p-4" aria-labelledby="version-preview-title" aria-live="polite">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div><h3 id="version-preview-title" className="text-sm font-semibold text-foreground">Preview com gross-up</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">O servidor recalcula estes valores ao criar a versão.</p></div>
              <div className="text-left sm:text-right"><p className="text-xs uppercase tracking-wide text-muted-foreground">Valor final</p><p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-primary">{currency(previewFinalAmount)}</p></div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><p className="text-xs text-muted-foreground">Operacional</p><p className="mt-1 font-mono font-medium tabular-nums">{currency(previewOperationalAmount)}</p></div>
              <div><p className="text-xs text-muted-foreground">Reserva fiscal</p><p className="mt-1 font-mono font-medium tabular-nums">{currency(Math.max(previewFinalAmount - previewOperationalAmount, 0))}</p></div>
              <div><p className="text-xs text-muted-foreground">Margem após custo direto</p><p className="mt-1 font-medium">{percentageLabel(previewMargin)}</p></div>
              <div><p className="text-xs text-muted-foreground">Classificação</p><p className="mt-1 font-medium">{previewAmountKind === "needs_review" ? "Revisão necessária" : "Valor operacional"}</p></div>
            </div>
          </section>
          <DialogFooter><Button type="button" variant="outline" className="min-h-11" onClick={() => setVersionPlan(null)}>Cancelar</Button><Button type="button" className="min-h-11" disabled={createPlanVersion.isPending} onClick={() => void saveVersion()}>{createPlanVersion.isPending && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />}Criar versão</Button></DialogFooter>
        </DialogContent>
      </Dialog>}

      {!readOnly && <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-3xl">
          <DialogHeader><DialogTitle>Configurações financeiras</DialogTitle><DialogDescription>Parâmetros usados no consolidado e nas previsões.</DialogDescription></DialogHeader>
          <div className="space-y-6">
            <fieldset className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-3">
              <legend className="px-2 text-sm font-semibold text-foreground">Base e metas</legend>
              <div className="space-y-2"><Label htmlFor="settings-currency">Moeda</Label><Select value={settingsDraft.currency} onValueChange={(value) => setSettingsDraft((draft) => ({ ...draft, currency: value }))}><SelectTrigger id="settings-currency" className="h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="BRL">BRL · Real</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label htmlFor="settings-due-day">Vencimento padrão</Label><Input id="settings-due-day" type="number" inputMode="numeric" min="1" max="28" className="h-11" value={settingsDraft.defaultDueDay} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, defaultDueDay: Number(event.target.value) }))} /></div>
              <div className="space-y-2"><Label htmlFor="settings-forecast">Meses de previsão</Label><Input id="settings-forecast" type="number" inputMode="numeric" min="1" max="24" className="h-11" value={settingsDraft.forecastMonths} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, forecastMonths: Number(event.target.value) }))} /></div>
              <div className="space-y-2"><Label htmlFor="settings-opening">Saldo inicial</Label><Input id="settings-opening" type="number" inputMode="decimal" step="0.01" className="h-11" value={settingsDraft.openingBalance} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, openingBalance: Number(event.target.value) }))} /></div>
              <div className="space-y-2"><Label htmlFor="settings-reserve">Reserva alvo</Label><Input id="settings-reserve" type="number" inputMode="decimal" min="0" step="0.01" className="h-11" value={settingsDraft.reserveTarget} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, reserveTarget: Number(event.target.value) }))} /></div>
              <div className="space-y-2"><Label htmlFor="settings-monthly-goal">Meta mensal</Label><Input id="settings-monthly-goal" type="number" inputMode="decimal" min="0" step="0.01" className="h-11" value={settingsDraft.monthlyGoal ?? ""} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, monthlyGoal: event.target.value === "" ? null : Number(event.target.value) }))} /></div>
              <div className="space-y-2"><Label htmlFor="settings-minimum-reserve-months">Reserva mínima (meses)</Label><Input id="settings-minimum-reserve-months" type="number" inputMode="decimal" min="0" step="0.1" className="h-11" value={settingsDraft.minimumReserveMonths ?? ""} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, minimumReserveMonths: event.target.value === "" ? null : Number(event.target.value) }))} /></div>
            </fieldset>

            <fieldset className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2">
              <legend className="px-2 text-sm font-semibold text-foreground">Crescimento e rentabilidade</legend>
              <div className="space-y-2"><Label htmlFor="settings-growth-retention">Retenção do crescimento (%)</Label><Input id="settings-growth-retention" type="number" inputMode="decimal" min="0" max="100" step="0.1" className="h-11" value={percentageInputValue(settingsDraft.growthRetentionRate)} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, growthRetentionRate: percentageFromInput(event.target.value) }))} /><p className="text-xs leading-5 text-muted-foreground">Parcela do crescimento que deve permanecer no caixa.</p></div>
              <div className="space-y-2"><Label htmlFor="settings-minimum-margin">Margem mínima desejada (%)</Label><Input id="settings-minimum-margin" type="number" inputMode="decimal" min="-100" max="100" step="0.1" className="h-11" value={percentageInputValue(settingsDraft.desiredMinimumMargin)} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, desiredMinimumMargin: percentageFromInput(event.target.value) }))} /><p className="text-xs leading-5 text-muted-foreground">Guardrail para precificação e análise de contribuição.</p></div>
            </fieldset>

            <fieldset className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-3">
              <legend className="px-2 text-sm font-semibold text-foreground">Pró-labore e custos</legend>
              <div className="space-y-2"><Label htmlFor="settings-current-pro-labore">Pró-labore atual</Label><Input id="settings-current-pro-labore" type="number" inputMode="decimal" min="0" step="0.01" className="h-11" value={settingsDraft.currentProLabore} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, currentProLabore: Number(event.target.value) }))} /></div>
              <div className="space-y-2"><Label htmlFor="settings-target-pro-labore">Pró-labore alvo</Label><Input id="settings-target-pro-labore" type="number" inputMode="decimal" min="0" step="0.01" className="h-11" value={settingsDraft.targetProLabore} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, targetProLabore: Number(event.target.value) }))} /></div>
              <div className="space-y-2"><Label htmlFor="settings-default-direct-cost">Custo direto padrão</Label><Input id="settings-default-direct-cost" type="number" inputMode="decimal" min="0" step="0.01" className="h-11" value={settingsDraft.defaultDirectCost} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, defaultDirectCost: Number(event.target.value) }))} /></div>
              <div className="space-y-2 sm:col-span-2 lg:col-span-1"><Label htmlFor="settings-allocation-method">Método de alocação</Label><Select value={settingsDraft.allocationMethod} onValueChange={(value) => setSettingsDraft((draft) => ({ ...draft, allocationMethod: value as FinanceAllocationMethod }))}><SelectTrigger id="settings-allocation-method" className="h-11"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(ALLOCATION_METHOD_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
              <div className="flex min-h-16 items-center justify-between gap-4 rounded-lg border bg-muted/20 p-3 sm:col-span-2">
                <div><Label htmlFor="settings-include-pro-labore">Incluir pró-labore na alocação</Label><p className="mt-1 text-xs leading-5 text-muted-foreground">Distribui o pró-labore junto dos custos compartilhados.</p></div>
                <Switch id="settings-include-pro-labore" checked={settingsDraft.includeProLaboreInAllocation} onCheckedChange={(checked) => setSettingsDraft((draft) => ({ ...draft, includeProLaboreInAllocation: checked }))} />
              </div>
            </fieldset>
          </div>
          <DialogFooter><Button type="button" variant="outline" className="min-h-11" onClick={() => setSettingsOpen(false)}>Cancelar</Button><Button type="button" className="min-h-11" disabled={updateSettings.isPending} onClick={() => void saveSettings()}>{updateSettings.isPending && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />}Salvar configurações</Button></DialogFooter>
        </DialogContent>
      </Dialog>}

      {!readOnly && <AlertDialog open={!!archiveTarget} onOpenChange={(open) => !open && setArchiveTarget(null)}>
        <AlertDialogContent className="w-[calc(100%-2rem)]"><AlertDialogHeader><AlertDialogTitle>Arquivar plano?</AlertDialogTitle><AlertDialogDescription>“{archiveTarget?.name}” deixará de aparecer para novas contratações. Versões, vínculos de clientes e competências existentes não serão excluídos.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="min-h-11">Cancelar</AlertDialogCancel><AlertDialogAction className="min-h-11" disabled={archivePlan.isPending} onClick={() => void doArchivePlan()}>Arquivar plano</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>}
    </div>
  );
}

export interface FinanceV2Props {
  initialMode?: FinanceMode;
  initialCompetence?: string;
}

export default function FinanceV2({
  initialMode = "accrual",
  initialCompetence = currentCompetence(),
}: FinanceV2Props) {
  const { profile } = useAuth();
  const readOnly = profile?.role !== "admin";
  const [mode, setMode] = useState<FinanceMode>(initialMode);
  const [competence, setCompetence] = useState(initialCompetence.slice(0, 7));
  const [activeTab, setActiveTab] = useState<FinanceTab>("overview");
  const { generateCompetence } = useFinanceMutations();
  const settings = useFinanceSettings();
  const modeDescription = useMemo(() => MODES.find((item) => item.value === mode)?.description || "", [mode]);

  const generate = async () => {
    if (readOnly) return;
    try {
      const result = await generateCompetence.mutateAsync({ competence });
      const resultRecord = result && typeof result === "object" ? result as Record<string, unknown> : {};
      const generated = Number(resultRecord.generated_count ?? resultRecord.generated ?? 0);
      toast.success(generated > 0 ? `${generated} lançamento(s) gerado(s) para ${competenceLabel(competence)}.` : "Competência verificada. Nenhum lançamento novo foi necessário.");
    } catch (error) {
      toast.error(messageOf(error));
    }
  };

  return (
    <main className="mx-auto w-full max-w-[1500px] space-y-6 overflow-x-hidden pb-8" aria-labelledby="finance-v2-title">
      <section className="relative overflow-hidden rounded-2xl border bg-card px-4 py-5 shadow-sm sm:px-6 sm:py-6">
        <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-1/3 bg-gradient-to-l from-primary/10 to-transparent lg:block" aria-hidden="true" />
        <div className="relative flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary"><Landmark className="h-4 w-4" aria-hidden="true" />Controle financeiro</div>
            <h1 id="finance-v2-title" className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Financeiro V2</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Uma leitura por competência, caixa ou previsão, com planos versionados e liquidações sem reescrever o histórico.</p>
          </div>
          <div className={cn("grid gap-3 sm:items-end", !readOnly && "sm:grid-cols-[minmax(180px,220px)_auto]")}>
            <div className="space-y-2"><Label htmlFor="finance-competence">Competência</Label><Input id="finance-competence" type="month" className="h-11 bg-background" value={competence} onChange={(event) => setCompetence(event.target.value || currentCompetence())} /></div>
            {!readOnly && <AlertDialog>
              <AlertDialogTrigger asChild><Button type="button" className="min-h-11" disabled={!competence || generateCompetence.isPending}><CalendarDays className="h-4 w-4" />Gerar competência</Button></AlertDialogTrigger>
              <AlertDialogContent className="w-[calc(100%-2rem)]">
                <AlertDialogHeader><AlertDialogTitle>Gerar {competenceLabel(competence)}?</AlertDialogTitle><AlertDialogDescription>Esta ação cria apenas os lançamentos recorrentes ausentes. A operação é idempotente, mas exige sua confirmação e nunca acontece ao abrir a página.</AlertDialogDescription></AlertDialogHeader>
                <AlertDialogFooter><AlertDialogCancel className="min-h-11">Cancelar</AlertDialogCancel><AlertDialogAction className="min-h-11" disabled={generateCompetence.isPending} onClick={() => void generate()}>{generateCompetence.isPending ? "Gerando…" : "Confirmar geração"}</AlertDialogAction></AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>}
          </div>
        </div>
      </section>

      {readOnly && (
        <Alert className="border-primary/20 bg-primary/5">
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>Acesso gerencial somente leitura</AlertTitle>
          <AlertDescription>Você pode consultar todos os modos e cadastros disponíveis, sem gerar competências ou alterar dados financeiros.</AlertDescription>
        </Alert>
      )}

      <section aria-labelledby="finance-mode-title" className="rounded-xl border bg-card p-3 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="px-1"><h2 id="finance-mode-title" className="text-sm font-semibold text-foreground">Modo de leitura</h2><p className="mt-0.5 text-xs leading-5 text-muted-foreground">{modeDescription}</p></div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="group" aria-label="Modo de leitura financeira">
            {MODES.map((item) => (
              <Button key={item.value} type="button" variant={mode === item.value ? "default" : "ghost"} className="min-h-11 justify-start sm:justify-center" aria-pressed={mode === item.value} onClick={() => setMode(item.value)}>
                {item.value === "cash" ? <Banknote className="h-4 w-4" /> : item.value === "accrual" ? <Layers3 className="h-4 w-4" /> : <FileClock className="h-4 w-4" />}
                {item.label}
              </Button>
            ))}
          </div>
        </div>
      </section>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as FinanceTab)} className="space-y-5">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-xl p-1 sm:grid-cols-3 xl:grid-cols-5">
          {TAB_ITEMS.map((item, index) => (
            <TabsTrigger key={item.value} value={item.value} className={cn("min-h-11 px-3 py-2.5", index === TAB_ITEMS.length - 1 && "col-span-2 sm:col-span-1")}>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="mt-0"><OverviewTab mode={mode} competence={competence} currencyCode={settings.data?.currency || "BRL"} /></TabsContent>
        <TabsContent value="cash-flow" className="mt-0"><CashFlowTab mode={mode} competence={competence} readOnly={readOnly} /></TabsContent>
        <TabsContent value="subscriptions" className="mt-0"><SubscriptionsTab readOnly={readOnly} /></TabsContent>
        <TabsContent value="fixed-costs" className="mt-0"><FixedCostsTab readOnly={readOnly} /></TabsContent>
        <TabsContent value="plans" className="mt-0"><PlansTab readOnly={readOnly} /></TabsContent>
      </Tabs>
    </main>
  );
}
