import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Wallet, PiggyBank, Target, Scale, TrendingUp, Landmark, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useFinanceSettings, useFinancePlans, useFinanceMutations } from "@/hooks/useFinanceV2";
import { DEFAULT_TAX_RATE, suggestProLabore, nextProLaboreTier } from "@/lib/directorPlan";

const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

export interface ReceivedItem {
  clientId: string | null;
  amount: number;
}

interface Props {
  monthLabel: string;
  /** Valores realmente recebidos no mês (billing + parcelas de projetos). */
  receivedItems: ReceivedItem[];
  /** MRR esperado (soma dos planos de clientes ativos). */
  expectedMonthlyRevenue: number;
  activeClientsCount: number;
  clients: any[];
}

const isProLaboreExpense = (e: any) =>
  /pr[oó][\s_-]?labore/i.test(`${e?.description || ""} ${e?.notes || ""}`);

export default function ManagementSummary({ monthLabel, receivedItems, expectedMonthlyRevenue, activeClientsCount, clients }: Props) {
  const { data: settings } = useFinanceSettings();
  const { data: plans } = useFinancePlans();
  const { updateSettings } = useFinanceMutations();
  const [goalModal, setGoalModal] = useState(false);
  const [goalInput, setGoalInput] = useState("");

  const { data: allExpenses = [] } = useQuery({
    queryKey: ["expenses"],
    queryFn: async () => {
      const { data, error } = await supabase.from("expenses").select("*").order("due_date", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Alíquota por cliente: usa a alíquota do plano do catálogo quando cadastrada;
  // caso contrário aplica a alíquota ilustrativa de 6% (editável em Planos & Preços).
  const taxRateByClientId = useMemo(() => {
    const rateByPlanName = new Map<string, number>();
    (plans || []).forEach((p) => {
      const rate = p.currentVersion?.taxRate;
      if (rate !== null && rate !== undefined) rateByPlanName.set(p.name.trim().toLowerCase(), rate);
    });
    const map = new Map<string, number>();
    (clients || []).forEach((c: any) => {
      const planKey = (c.plan_name || "").trim().toLowerCase();
      map.set(c.id, rateByPlanName.get(planKey) ?? DEFAULT_TAX_RATE);
    });
    return map;
  }, [plans, clients]);

  const grossReceived = receivedItems.reduce((s, it) => s + it.amount, 0);
  const taxReserve = receivedItems.reduce((s, it) => {
    const rate = (it.clientId && taxRateByClientId.get(it.clientId)) ?? DEFAULT_TAX_RATE;
    return s + it.amount * rate;
  }, 0);
  const operationalReceived = grossReceived - taxReserve;

  // Custos fixos reais: despesas recorrentes mensais (o pró-labore fica em linha própria,
  // vindo das configurações, para nunca ser descontado duas vezes).
  const monthlyFixedExpenses = useMemo(
    () => (allExpenses || []).filter((e: any) => e.recurrence === "monthly" && !isProLaboreExpense(e)),
    [allExpenses]
  );
  const fixedCosts = monthlyFixedExpenses.reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
  const fixedCostsSource = fixedCosts > 0 ? "real" : "referencia";
  const fixedCostsValue = fixedCosts > 0 ? fixedCosts : Number(settings?.raw?.tools_systems_cost ?? 2500);

  const proLabore = settings?.currentProLabore ?? 3000;
  const defaultDirectCost = settings?.defaultDirectCost ?? 275;
  const directCosts = activeClientsCount * defaultDirectCost;

  const result = operationalReceived - fixedCostsValue - proLabore - directCosts;
  const breakEvenOperational = fixedCostsValue + proLabore + directCosts;
  const breakEvenGross = breakEvenOperational / (1 - DEFAULT_TAX_RATE);

  const monthlyGoal = settings?.monthlyGoal ?? null;
  const goalProgress = monthlyGoal && monthlyGoal > 0 ? Math.min(operationalReceived / monthlyGoal, 1) : null;

  const suggested = suggestProLabore(Math.max(operationalReceived, expectedMonthlyRevenue));
  const nextTier = nextProLaboreTier(Math.max(operationalReceived, expectedMonthlyRevenue));

  const saveGoal = async () => {
    if (!settings) return;
    const value = parseFloat(goalInput);
    if (!Number.isFinite(value) || value < 0) { toast.error("Informe uma meta válida"); return; }
    try {
      await updateSettings.mutateAsync({
        currency: settings.currency,
        openingBalance: settings.openingBalance,
        reserveTarget: settings.reserveTarget,
        defaultDueDay: settings.defaultDueDay,
        forecastMonths: settings.forecastMonths,
        monthlyGoal: value,
        growthRetentionRate: settings.growthRetentionRate,
        minimumReserveMonths: settings.minimumReserveMonths,
        desiredMinimumMargin: settings.desiredMinimumMargin,
        currentProLabore: settings.currentProLabore,
        targetProLabore: settings.targetProLabore,
        defaultDirectCost: settings.defaultDirectCost,
        allocationMethod: settings.allocationMethod,
        includeProLaboreInAllocation: settings.includeProLaboreInAllocation,
      });
      toast.success("Meta mensal atualizada");
      setGoalModal(false);
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar meta");
    }
  };

  const lines = [
    { label: "Recebido no mês (bruto)", value: grossReceived, icon: Wallet, color: "text-foreground", strong: true },
    { label: "Reserva tributária (separada automaticamente)", value: -taxReserve, icon: Landmark, color: "text-info" },
    { label: "Receita operacional", value: operationalReceived, icon: TrendingUp, color: "text-success", strong: true },
    { label: fixedCostsSource === "real" ? "Custos fixos do mês" : "Custos fixos (referência: ferramentas)", value: -fixedCostsValue, icon: Scale, color: "text-warning" },
    { label: "Pró-labore Almir", value: -proLabore, icon: PiggyBank, color: "text-warning" },
    { label: `Custos diretos estimados (${activeClientsCount} clientes × ${fmt(defaultDirectCost)})`, value: -directCosts, icon: Scale, color: "text-warning" },
  ];

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-2">
          <Landmark className="w-3.5 h-3.5 text-primary" />
          Gestão Financeira · Divisão automática de {monthLabel}
        </p>
        <span className="text-[10px] text-muted-foreground">Alíquota do plano de cada cliente; sem plano, {pct(DEFAULT_TAX_RATE)} ilustrativa</span>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Coluna 1: divisão do que entrou */}
        <div className="space-y-1.5">
          {lines.map((l) => (
            <div key={l.label} className="flex items-center gap-2 py-1">
              <l.icon className={`w-3.5 h-3.5 shrink-0 ${l.color}`} />
              <span className={`text-[12px] flex-1 ${l.strong ? "text-foreground font-medium" : "text-muted-foreground"}`}>{l.label}</span>
              <span className={`text-[13px] font-mono ${l.value < 0 ? "text-muted-foreground" : l.color}`}>
                {l.value < 0 ? `− ${fmt(Math.abs(l.value))}` : fmt(l.value)}
              </span>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <span className="text-[12px] font-medium text-foreground flex-1">Resultado do mês</span>
            <span className={`text-base font-mono font-semibold ${result >= 0 ? "text-success" : "text-destructive"}`}>{fmt(result)}</span>
          </div>

          {/* Cascata de cobertura: cada real que entra vai cobrindo a estrutura na ordem */}
          {(() => {
            let available = Math.max(operationalReceived, 0);
            const buckets = [
              { label: "Custos diretos", target: directCosts },
              { label: "Custos fixos", target: fixedCostsValue },
              { label: "Pró-labore", target: proLabore },
            ].map((b) => {
              const covered = Math.min(available, Math.max(b.target, 0));
              available -= covered;
              return { ...b, covered, pct: b.target > 0 ? covered / b.target : 1 };
            });
            const profit = available;
            return (
              <div className="pt-3 space-y-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                  Cobertura automática · para onde vai o que entrou
                </p>
                {buckets.map((b) => (
                  <div key={b.label} className="space-y-0.5">
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="text-muted-foreground flex-1">{b.label}</span>
                      <span className={`font-mono ${b.pct >= 1 ? "text-success" : "text-warning"}`}>
                        {fmt(b.covered)} de {fmt(b.target)}
                      </span>
                    </div>
                    <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${b.pct >= 1 ? "bg-success" : "bg-warning"}`}
                        style={{ width: `${Math.round(Math.min(b.pct, 1) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
                <div className="flex items-center gap-2 text-[11px] pt-1">
                  <span className="text-muted-foreground flex-1">Lucro / reserva do mês (sobra após a estrutura)</span>
                  <span className={`font-mono font-medium ${profit > 0 ? "text-success" : "text-muted-foreground"}`}>{fmt(profit)}</span>
                </div>
                {grossReceived > 0 && (
                  <p className="text-[10px] text-muted-foreground">
                    De cada R$ 1,00 recebido este mês: {Math.round((taxReserve / grossReceived) * 100)}% reserva tributária
                    {" · "}{Math.round((buckets.reduce((s, b) => s + b.covered, 0) / grossReceived) * 100)}% estrutura
                    {" · "}{Math.max(Math.round((profit / grossReceived) * 100), 0)}% lucro/reserva.
                  </p>
                )}
              </div>
            );
          })()}

          <p className="text-[10px] text-muted-foreground pt-1">
            Custos diretos usam a estimativa padrão de {fmt(defaultDirectCost)}/cliente (marcada como estimada). Pró-labore e custos fixos são descontados uma única vez.
          </p>
        </div>

        {/* Coluna 2: meta, ponto de equilíbrio e pró-labore sugerido */}
        <div className="space-y-3">
          <div className="bg-secondary/30 border border-border rounded-xl p-3.5">
            <div className="flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Target className="w-3 h-3 text-primary" /> Meta mensal (receita operacional)
              </p>
              <button
                onClick={() => { setGoalInput(monthlyGoal ? String(monthlyGoal) : "10000"); setGoalModal(true); }}
                className="text-[10px] text-primary flex items-center gap-1 bg-transparent border-none cursor-pointer hover:opacity-80"
              >
                <Pencil className="w-3 h-3" /> {monthlyGoal ? "Editar" : "Definir"}
              </button>
            </div>
            {monthlyGoal && monthlyGoal > 0 ? (
              <>
                <div className="flex items-baseline gap-2 mt-1.5">
                  <span className="text-lg font-mono font-semibold text-foreground">{fmt(operationalReceived)}</span>
                  <span className="text-[11px] text-muted-foreground">de {fmt(monthlyGoal)}</span>
                  <span className={`text-[11px] font-mono ml-auto ${goalProgress! >= 1 ? "text-success" : "text-muted-foreground"}`}>
                    {Math.round(goalProgress! * 100)}%
                  </span>
                </div>
                <div className="h-1.5 bg-secondary rounded-full mt-2 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${goalProgress! >= 1 ? "bg-success" : "bg-primary"}`}
                    style={{ width: `${Math.round(goalProgress! * 100)}%` }}
                  />
                </div>
              </>
            ) : (
              <p className="text-[11px] text-muted-foreground mt-1.5">Sem meta definida. O Plano Diretor sugere R$ 10.000 operacionais na fase atual.</p>
            )}
          </div>

          <div className="bg-secondary/30 border border-border rounded-xl p-3.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Scale className="w-3 h-3 text-info" /> Ponto de equilíbrio
            </p>
            <div className="flex items-baseline gap-2 mt-1.5">
              <span className="text-lg font-mono font-semibold text-foreground">{fmt(breakEvenOperational)}</span>
              <span className="text-[11px] text-muted-foreground">operacionais/mês · {fmt(breakEvenGross)} brutos</span>
            </div>
            <p className={`text-[11px] mt-1 ${operationalReceived >= breakEvenOperational ? "text-success" : "text-warning"}`}>
              {operationalReceived >= breakEvenOperational
                ? "Estrutura do mês coberta pelo que já entrou."
                : `Faltam ${fmt(breakEvenOperational - operationalReceived)} operacionais para cobrir a estrutura.`}
            </p>
          </div>

          <div className="bg-secondary/30 border border-border rounded-xl p-3.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <PiggyBank className="w-3 h-3 text-success" /> Pró-labore pela escada do Plano Diretor
            </p>
            <div className="flex items-baseline gap-2 mt-1.5 flex-wrap">
              <span className="text-lg font-mono font-semibold text-foreground">{fmt(proLabore)}</span>
              <span className="text-[11px] text-muted-foreground">atual</span>
              {suggested !== proLabore && (
                <span className={`text-[11px] px-2 py-0.5 rounded-full ${suggested > proLabore ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
                  Sugerido: {fmt(suggested)}
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              {nextTier
                ? `Próximo degrau: ${fmt(nextTier.proLabore)} ao atingir ${fmt(nextTier.revenue)} operacionais.`
                : "Topo da escada atingido."}
              {" "}Sugestão nunca é aplicada sozinha — confirme na aba Custos Fixos.
            </p>
          </div>
        </div>
      </div>

      {/* Modal meta mensal */}
      <Dialog open={goalModal} onOpenChange={setGoalModal}>
        <DialogContent className="bg-card border-border max-w-sm">
          <DialogHeader><DialogTitle className="text-foreground">Meta mensal de receita operacional</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Meta (R$)</label>
              <Input type="number" step="0.01" value={goalInput} onChange={(e) => setGoalInput(e.target.value)} className="mt-1" placeholder="10000" />
            </div>
            <p className="text-[11px] text-muted-foreground">Receita operacional = valor recebido após separar a reserva tributária.</p>
            <button
              onClick={saveGoal}
              disabled={updateSettings.isPending}
              className="w-full py-2.5 rounded-xl text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none disabled:opacity-50"
            >
              Salvar meta
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
