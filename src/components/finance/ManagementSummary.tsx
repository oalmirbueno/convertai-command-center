import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Wallet, PiggyBank, Target, Scale, TrendingUp, Landmark, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useFinanceSettings, useFinancePlans, useFinanceMutations } from "@/hooks/useFinanceV2";
import { DEFAULT_TAX_RATE, interpolateProLabore, nextProLaboreTier } from "@/lib/directorPlan";

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
  /** true quando o mês exibido é o mês corrente (habilita o ritmo por dias). */
  isCurrentMonth?: boolean;
}

const isProLaboreExpense = (e: any) =>
  /pr[oó][\s_-]?labore/i.test(`${e?.description || ""} ${e?.notes || ""}`);

export default function ManagementSummary({ monthLabel, receivedItems, expectedMonthlyRevenue, activeClientsCount, clients, isCurrentMonth = false }: Props) {
  const { data: settings } = useFinanceSettings();
  const { data: plans } = useFinancePlans();
  const { updateSettings } = useFinanceMutations();
  const [goalModal, setGoalModal] = useState(false);
  const [goalInput, setGoalInput] = useState("");
  const [panelOpen, setPanelOpen] = useState(true);

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

  // Pró-labore proporcional ao que entrou (regra oficial da escada, sem saltos).
  const proLaboreProp = interpolateProLabore(operationalReceived);
  // O custo de clientes vira RESERVA para investimento: só é alocado do que
  // sobra depois da estrutura — uma estimativa nunca joga a divisão pro negativo.
  const afterStructure = operationalReceived - fixedCostsValue - proLaboreProp;
  const clientReserveTarget = directCosts;
  const clientReserve = Math.min(Math.max(afterStructure, 0), clientReserveTarget);
  const result = afterStructure - clientReserve;
  const breakEvenOperational = fixedCostsValue + proLabore;
  const breakEvenGross = breakEvenOperational / (1 - DEFAULT_TAX_RATE);

  const monthlyGoal = settings?.monthlyGoal ?? null;
  const goalProgress = monthlyGoal && monthlyGoal > 0 ? Math.min(operationalReceived / monthlyGoal, 1) : null;

  const nextTier = nextProLaboreTier(operationalReceived);

  // Ritmo do mês corrente: projeção simples pelo dia atual.
  const today = new Date();
  const dayOfMonth = today.getDate();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const projectedOperational = isCurrentMonth && dayOfMonth > 0
    ? (operationalReceived / dayOfMonth) * daysInMonth
    : null;
  const projectedProLabore = projectedOperational !== null ? interpolateProLabore(projectedOperational) : null;

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

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <button
        onClick={() => setPanelOpen((v) => !v)}
        className="w-full flex items-center justify-between flex-wrap gap-2 bg-transparent border-none cursor-pointer text-left p-0"
      >
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-2">
          <Landmark className="w-3.5 h-3.5 text-primary" />
          Gestão Financeira · Divisão automática de {monthLabel}
        </p>
        <span className="text-[10px] text-muted-foreground">
          Alíquota do plano de cada cliente; sem plano, {pct(DEFAULT_TAX_RATE)} ilustrativa <span className="ml-1">{panelOpen ? "▾" : "▸"}</span>
        </span>
      </button>

      {panelOpen && (
      <div className="grid md:grid-cols-2 gap-4">
        {/* Coluna 1: divisão do que entrou */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 py-1">
            <Wallet className="w-3.5 h-3.5 shrink-0 text-foreground" />
            <span className="text-[12px] flex-1 text-foreground font-medium">Recebido no mês (bruto)</span>
            <span className="text-[13px] font-mono text-foreground">{fmt(grossReceived)}</span>
          </div>
          <div className="flex items-center gap-2 py-1">
            <Landmark className="w-3.5 h-3.5 shrink-0 text-info" />
            <span className="text-[12px] flex-1 text-muted-foreground">Reserva tributária (separa na hora)</span>
            <span className="text-[13px] font-mono text-muted-foreground">− {fmt(taxReserve)}</span>
          </div>
          <div className="flex items-center gap-2 py-1 pb-2 border-b border-border">
            <TrendingUp className="w-3.5 h-3.5 shrink-0 text-success" />
            <span className="text-[12px] flex-1 text-foreground font-medium">Receita operacional</span>
            <span className="text-[13px] font-mono text-success">{fmt(operationalReceived)}</span>
          </div>
          <div className="flex items-center gap-2 py-1">
            <Scale className="w-3.5 h-3.5 shrink-0 text-warning" />
            <span className="text-[12px] flex-1 text-muted-foreground">
              {fixedCostsSource === "real" ? "Custos fixos do mês" : "Custos fixos (referência: ferramentas)"}
            </span>
            <span className="text-[13px] font-mono text-muted-foreground">− {fmt(fixedCostsValue)}</span>
          </div>
          <div className="flex items-center gap-2 py-1">
            <PiggyBank className="w-3.5 h-3.5 shrink-0 text-primary" />
            <span className="text-[12px] flex-1 text-muted-foreground">
              Pró-labore proporcional ao que entrou
              <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary align-middle">escada</span>
            </span>
            <span className="text-[13px] font-mono text-primary">− {fmt(proLaboreProp)}</span>
          </div>
          <div className="flex items-center gap-2 py-1">
            <Scale className="w-3.5 h-3.5 shrink-0 text-info" />
            <span className="text-[12px] flex-1 text-muted-foreground">
              Reserva p/ custos de clientes e investimento
              {clientReserve >= clientReserveTarget - 0.005 && clientReserveTarget > 0 ? (
                <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-success/10 text-success align-middle">completa · {fmt(clientReserveTarget)}</span>
              ) : clientReserve > 0 ? (
                <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-warning/10 text-warning align-middle">parcial · faltam {fmt(clientReserveTarget - clientReserve)} do alvo {fmt(clientReserveTarget)}</span>
              ) : (
                <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground align-middle">sem sobra ainda · alvo {fmt(clientReserveTarget)}</span>
              )}
            </span>
            <span className="text-[13px] font-mono text-info">
              {clientReserve > 0 ? `− ${fmt(clientReserve)}` : fmt(0)}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground pl-5 -mt-0.5">
            Essa linha é o que <span className="text-info">sobrou e foi guardado</span> (desconta antes do lucro) — não é falta. Se não sobrar nada, fica R$ 0,00 e o alvo espera o próximo dinheiro que entrar.
          </p>
          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <span className="text-[12px] font-medium text-foreground flex-1">Lucro do mês</span>
            <span className={`text-base font-mono font-semibold ${result >= 0 ? "text-success" : "text-destructive"}`}>{fmt(result)}</span>
          </div>

          {/* Barra única: como o dinheiro que entrou se divide (alocação em ordem de prioridade) */}
          {(() => {
            let rest = Math.max(operationalReceived, 0);
            const alloc = (target: number) => {
              const v = Math.min(rest, Math.max(target, 0));
              rest -= v;
              return v;
            };
            const fixosAlloc = alloc(fixedCostsValue);
            const plAlloc = alloc(proLaboreProp);
            const reservaAlloc = alloc(clientReserveTarget);
            const lucroAlloc = rest;
            const uncovered = fixedCostsValue + proLaboreProp - (fixosAlloc + plAlloc);
            const segs = [
              { label: "Reserva tributária", value: taxReserve, cls: "bg-info" },
              { label: "Custos fixos", value: fixosAlloc, cls: "bg-warning" },
              { label: "Pró-labore", value: plAlloc, cls: "bg-primary" },
              { label: "Reserva clientes/invest.", value: reservaAlloc, cls: "bg-info/60" },
              { label: "Lucro", value: lucroAlloc, cls: "bg-success" },
            ].filter((s) => s.value > 0.005);
            const total = grossReceived > 0 ? grossReceived : 1;
            return grossReceived > 0 ? (
              <div className="pt-3 space-y-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                  Como o dinheiro que entrou se divide
                </p>
                <div className="h-3 rounded-full overflow-hidden flex bg-secondary">
                  {segs.map((s) => (
                    <div key={s.label} className={s.cls} style={{ width: `${(s.value / total) * 100}%` }} title={`${s.label}: ${fmt(s.value)}`} />
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {segs.map((s) => (
                    <span key={s.label} className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${s.cls}`} /> {s.label} {fmt(s.value)} ({Math.round((s.value / total) * 100)}%)
                    </span>
                  ))}
                </div>
                {uncovered > 0.005 && (
                  <p className="text-[10px] text-destructive">
                    Faltam {fmt(uncovered)} entrando para cobrir custos fixos + pró-labore proporcional do mês.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-[10px] text-muted-foreground pt-2">
                Nenhum valor recebido neste mês ainda — a divisão aparece automaticamente conforme o dinheiro entra.
              </p>
            );
          })()}

          {isCurrentMonth && projectedOperational !== null && grossReceived > 0 && (
            <p className="text-[10px] text-muted-foreground pt-1">
              Entrou {fmt(operationalReceived)} operacionais até o dia {dayOfMonth}. Se a média diária continuar, o mês fecha em ~{fmt(projectedOperational)} (estimativa — o que vale é o recebido), com pró-labore proporcional projetado de {fmt(projectedProLabore || 0)}.
            </p>
          )}

          <p className="text-[10px] text-muted-foreground pt-1">
            Regra do pró-labore proporcional: abaixo de R$ 10 mil ele acompanha o que entra (ex.: R$ 5 mil → R$ 1.500); em R$ 10 mil vale R$ 3.000; entre degraus soma a diferença proporcional (ex.: R$ 12,5 mil → R$ 3.500). Retirada oficial configurada: {fmt(proLabore)} — ajuste na aba Custos Fixos. A reserva de clientes ({activeClientsCount} × {fmt(defaultDirectCost)}) é separada só do que sobra, como colchão para custos e investimento — estimativa não gera negativo.
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
              <span className="text-lg font-mono font-semibold text-foreground">{fmt(proLaboreProp)}</span>
              <span className="text-[11px] text-muted-foreground">proporcional ao mês</span>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
                Oficial: {fmt(proLabore)}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              {nextTier
                ? `Próximo degrau: ${fmt(nextTier.proLabore)} ao atingir ${fmt(nextTier.revenue)} operacionais.`
                : "Topo da escada atingido."}
              {" "}Nada muda sozinho — a retirada oficial você confirma na aba Custos Fixos.
            </p>
          </div>
        </div>
      </div>
      )}

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
