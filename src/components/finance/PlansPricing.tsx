import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Pencil, Archive, RotateCcw, Calculator, BookOpen, Users, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useClients } from "@/hooks/useSupabaseData";
import {
  useFinancePlans,
  useFinanceSettings,
  useFinanceMutations,
  calculateGrossedUpAmount,
  type FinancePlan,
} from "@/hooks/useFinanceV2";
import { DIRECTOR_PLAN_CATALOG, ONE_OFF_CATALOG, DEFAULT_TAX_RATE } from "@/lib/directorPlan";

const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
const pctLabel = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

const monthFirst = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;

/** Primeira competência em que uma nova versão de preço pode entrar em vigor. */
const minEffectiveFor = (plan: FinancePlan | null): string => {
  const current = monthFirst(new Date());
  if (!plan || plan.versions.length === 0) return current;
  const maxFrom = plan.versions.reduce((m, v) => (v.effectiveFrom > m ? v.effectiveFrom : m), "");
  if (!maxFrom || maxFrom < current) return current;
  const d = new Date(`${maxFrom.slice(0, 7)}-15T12:00:00`);
  d.setMonth(d.getMonth() + 1);
  return monthFirst(d);
};

const normName = (s: string | null | undefined) => (s || "").trim().toLowerCase();

const isProLaboreExpense = (e: any) =>
  /pr[oó][\s_-]?labore/i.test(`${e?.description || ""} ${e?.notes || ""}`);

const parsePct = (s: string): number | null => {
  if (!s.trim()) return null;
  const v = parseFloat(s.replace(",", "."));
  if (!Number.isFinite(v)) return null;
  return v > 1 ? v / 100 : v;
};

const receivedAmountOf = (row: any): number => {
  const total = Number(row?.amount) || 0;
  const paid = Number(row?.paid_amount) || 0;
  if (row?.status === "partial") return Math.min(paid, total);
  if (row?.status === "paid") return paid > 0 && paid < total ? paid : total;
  return 0;
};

interface Props {
  billing?: any[];
  projectPayments?: any[];
}

export default function PlansPricing({ billing = [], projectPayments = [] }: Props) {
  const { data: plans, isLoading } = useFinancePlans();
  const { data: settings } = useFinanceSettings();
  const { data: clients } = useClients();
  const { upsertPlan, archivePlan, createPlanVersion } = useFinanceMutations();

  const [versionModal, setVersionModal] = useState<{ plan: FinancePlan } | null>(null);
  const [versionForm, setVersionForm] = useState({ amount: "", taxPct: "", directCost: "", setupFee: "", description: "" });
  const [planModal, setPlanModal] = useState<{ plan: FinancePlan | null } | null>(null);
  const [planForm, setPlanForm] = useState({ name: "", description: "" });
  const [seedModal, setSeedModal] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [simulator, setSimulator] = useState({ amount: "1297", taxPct: "6", directCost: "275" });
  const [marginOpen, setMarginOpen] = useState(true);
  const [oneOffOpen, setOneOffOpen] = useState(true);
  const [pricerOpen, setPricerOpen] = useState(true);

  const { data: allExpenses = [] } = useQuery({
    queryKey: ["expenses"],
    queryFn: async () => {
      const { data, error } = await supabase.from("expenses").select("*").order("due_date", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const activeClients = useMemo(
    () => (clients || []).filter((c: any) => c.plan_status === "active" && c.client_type !== "one_off"),
    [clients]
  );

  // Estrutura fixa mensal para o rateio gerencial da precificação.
  const monthlyFixed = useMemo(() => {
    const real = (allExpenses || [])
      .filter((e: any) => e.recurrence === "monthly" && !isProLaboreExpense(e))
      .reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
    return real > 0 ? real : Number(settings?.raw?.tools_systems_cost ?? 2500);
  }, [allExpenses, settings]);

  const proLabore = settings?.currentProLabore ?? 3000;
  const includeProLabore = settings?.includeProLaboreInAllocation ?? false;
  const allocBase = monthlyFixed + (includeProLabore ? proLabore : 0);
  const defaultDirectCost = settings?.defaultDirectCost ?? 275;

  // Receita avulsa recebida no mês corrente, por cliente.
  const receivedByClient = useMemo(() => {
    const now = new Date();
    const inThisMonth = (v?: string | null) => {
      if (!v) return false;
      const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00`) : new Date(v);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    };
    const map = new Map<string, number>();
    (billing || [])
      .filter((b: any) => b.type !== "ads_recharge" && (b.status === "paid" || b.status === "partial") && inThisMonth(b.paid_date || b.due_date))
      .forEach((b: any) => {
        if (!b.client_id) return;
        map.set(b.client_id, (map.get(b.client_id) || 0) + receivedAmountOf(b));
      });
    (projectPayments || []).forEach((pp: any) => {
      (pp.installments || [])
        .filter((i: any) => (i.status === "paid" || i.status === "partial") && inThisMonth(i.paid_date || i.due_date))
        .forEach((i: any) => {
          if (!pp.client_id) return;
          map.set(pp.client_id, (map.get(pp.client_id) || 0) + receivedAmountOf(i));
        });
    });
    return map;
  }, [billing, projectPayments]);

  // Margem em tempo real por cliente (recorrente pelo plano; avulso pelo que entrou no mês).
  // O rateio divide a estrutura igualmente entre quem gera receita agora:
  // se um cliente sai, o custo se redistribui na hora entre os ativos.
  const baseMarginRows = useMemo(() => {
    const rateByPlanName = new Map<string, number>();
    (plans || []).forEach((p) => {
      const rate = p.currentVersion?.taxRate;
      if (rate !== null && rate !== undefined) rateByPlanName.set(normName(p.name), rate);
    });
    const rows: any[] = [];
    (clients || []).forEach((c: any) => {
      const isRecurring = c.client_type !== "one_off" && Number(c.plan_value) > 0 && c.plan_status === "active";
      const oneOffRevenue = receivedByClient.get(c.id) || 0;
      if (!isRecurring && oneOffRevenue <= 0.005) return;
      const revenue = isRecurring ? Number(c.plan_value) : oneOffRevenue;
      const taxRate = rateByPlanName.get(normName(c.plan_name)) ?? DEFAULT_TAX_RATE;
      const taxReserve = revenue * taxRate;
      rows.push({
        id: c.id,
        name: c.company_name || c.full_name || "-",
        plan: isRecurring ? (c.plan_name || "Sem plano") : "Avulso",
        type: isRecurring ? "recorrente" : "avulso",
        revenue,
        taxReserve,
        operational: revenue - taxReserve,
        directCost: defaultDirectCost,
      });
    });
    return rows.sort((a, b) => b.revenue - a.revenue);
  }, [clients, plans, receivedByClient, defaultDirectCost]);

  const contributorsCount = Math.max(baseMarginRows.length, 1);
  const fixedPerClient = allocBase / contributorsCount;
  const marginRows = baseMarginRows.map((r) => {
    const margin = r.operational - r.directCost - fixedPerClient;
    return { ...r, rateio: fixedPerClient, margin, marginPct: r.operational > 0 ? margin / r.operational : 0 };
  });

  const clientsByPlanName = useMemo(() => {
    const map = new Map<string, { count: number; mrr: number }>();
    activeClients.forEach((c: any) => {
      const key = normName(c.plan_name);
      if (!key) return;
      const entry = map.get(key) || { count: 0, mrr: 0 };
      entry.count += 1;
      entry.mrr += Number(c.plan_value || 0);
      map.set(key, entry);
    });
    return map;
  }, [activeClients]);

  const missingSeeds = useMemo(() => {
    const existing = new Set((plans || []).map((p) => normName(p.name)));
    return DIRECTOR_PLAN_CATALOG.filter((s) => !existing.has(normName(s.name)));
  }, [plans]);

  const activePlans = (plans || []).filter((p) => p.isActive);
  const archivedPlans = (plans || []).filter((p) => !p.isActive);

  // ── Precificação: composição de um valor operacional ──
  const breakdown = (amount: number, taxRate: number | null, directCost: number) => {
    const final = calculateGrossedUpAmount(amount, taxRate);
    const reserve = final - amount;
    const margin = amount - directCost - fixedPerClient;
    return { final, reserve, margin, marginPct: amount > 0 ? margin / amount : 0 };
  };

  const openVersionModal = (plan: FinancePlan) => {
    const v = plan.currentVersion || plan.versions[0] || null;
    setVersionForm({
      amount: v ? String(v.amount) : "",
      taxPct: v?.taxRate !== null && v?.taxRate !== undefined ? String(Math.round(v.taxRate * 10000) / 100) : String(DEFAULT_TAX_RATE * 100),
      directCost: v ? String(v.directCost) : String(defaultDirectCost),
      setupFee: v ? String(v.setupFee) : "0",
      description: "",
    });
    setVersionModal({ plan });
  };

  const saveVersion = async () => {
    if (!versionModal) return;
    const amount = parseFloat(versionForm.amount);
    const taxRate = parsePct(versionForm.taxPct);
    const directCost = parseFloat(versionForm.directCost) || defaultDirectCost;
    const setupFee = parseFloat(versionForm.setupFee) || 0;
    if (!Number.isFinite(amount) || amount < 0) { toast.error("Informe o valor operacional"); return; }
    if (taxRate !== null && (taxRate < 0 || taxRate >= 1)) { toast.error("Alíquota deve ficar entre 0% e 99%"); return; }
    const finalAmount = calculateGrossedUpAmount(amount, taxRate);
    try {
      await createPlanVersion.mutateAsync({
        planId: versionModal.plan.id,
        amount,
        taxRate,
        finalAmount,
        directCost,
        directCostEstimated: false,
        billingPeriod: "monthly",
        setupFee,
        amountKind: taxRate === null ? "needs_review" : "operational",
        effectiveFrom: minEffectiveFor(versionModal.plan),
        description: versionForm.description || null,
      });
      toast.success("Nova versão de preço criada. Mensalidades já pagas não mudam.");
      setVersionModal(null);
    } catch (err: any) {
      toast.error(err.message || "Erro ao criar versão");
    }
  };

  const savePlan = async () => {
    if (!planForm.name.trim()) { toast.error("Informe o nome do plano"); return; }
    try {
      await upsertPlan.mutateAsync({
        id: planModal?.plan?.id,
        name: planForm.name,
        description: planForm.description || null,
        isActive: planModal?.plan ? planModal.plan.isActive : true,
      });
      toast.success(planModal?.plan ? "Plano atualizado" : "Plano criado. Agora defina o preço na versão inicial.");
      setPlanModal(null);
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar plano");
    }
  };

  const toggleArchive = async (plan: FinancePlan) => {
    const linked = clientsByPlanName.get(normName(plan.name));
    if (plan.isActive && linked && linked.count > 0) {
      toast.error(`${linked.count} cliente(s) usam este plano. Migre-os antes de arquivar.`);
      return;
    }
    try {
      if (plan.isActive) {
        await archivePlan.mutateAsync(plan.id);
        toast.success("Plano arquivado (histórico preservado)");
      } else {
        await upsertPlan.mutateAsync({ id: plan.id, name: plan.name, description: plan.description, isActive: true });
        toast.success("Plano reativado");
      }
    } catch (err: any) {
      toast.error(err.message || "Erro ao alterar status do plano");
    }
  };

  const runSeed = async () => {
    setSeeding(true);
    let created = 0;
    try {
      for (const seed of missingSeeds) {
        const planRow: any = await upsertPlan.mutateAsync({
          name: seed.name,
          code: seed.code,
          description: `${seed.description} Contrato de ${seed.contractMonths} meses. Preço padrão futuro: ${fmt(seed.standardPrice)}.`,
          isActive: true,
        });
        const planId = planRow?.id;
        if (!planId) continue;
        await createPlanVersion.mutateAsync({
          planId,
          amount: seed.launchPrice,
          taxRate: DEFAULT_TAX_RATE,
          finalAmount: calculateGrossedUpAmount(seed.launchPrice, DEFAULT_TAX_RATE),
          directCost: defaultDirectCost,
          directCostEstimated: true,
          billingPeriod: "monthly",
          setupFee: seed.setupFee,
          amountKind: "operational",
          effectiveFrom: monthFirst(new Date()),
          description: "Preço de lançamento do Plano Diretor (alíquota ilustrativa de 6%, ajuste com o contador).",
        });
        created += 1;
      }
      toast.success(`${created} plano(s) do Plano Diretor adicionados ao catálogo`);
      setSeedModal(false);
    } catch (err: any) {
      toast.error(err.message || "Erro ao importar planos");
    } finally {
      setSeeding(false);
    }
  };

  const simAmount = parseFloat(simulator.amount) || 0;
  const simTax = parsePct(simulator.taxPct);
  const simDirect = parseFloat(simulator.directCost) || 0;
  const sim = breakdown(simAmount, simTax, simDirect);

  return (
    <div className="space-y-5">
      {/* Resumo do catálogo */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Planos ativos", value: String(activePlans.length), color: "text-foreground" },
          { label: "Clientes em planos", value: String([...clientsByPlanName.values()].reduce((s, v) => s + v.count, 0)), color: "text-primary" },
          { label: "MRR dos planos", value: fmt([...clientsByPlanName.values()].reduce((s, v) => s + v.mrr, 0)), color: "text-success" },
          { label: "Rateio fixo / cliente", value: fmt(fixedPerClient), color: "text-info" },
        ].map((s) => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</p>
            <p className={`text-lg font-mono font-semibold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Margem em tempo real por cliente */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <button
          onClick={() => setMarginOpen((v) => !v)}
          className="w-full px-4 sm:px-5 py-3 flex items-center gap-2 bg-transparent border-none cursor-pointer text-left"
        >
          <Users className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium flex-1">
            Margem em tempo real por cliente ({marginRows.length})
          </span>
          <span className="text-[10px] text-muted-foreground hidden sm:inline">
            Estrutura {fmt(allocBase)} ÷ {contributorsCount} = {fmt(fixedPerClient)}/cliente
          </span>
          <span className="text-[10px] text-muted-foreground">{marginOpen ? "▾" : "▸"}</span>
        </button>
        {marginOpen && (
          <>
            <div className="border-t border-border overflow-x-auto">
              <div className="max-h-[420px] overflow-y-auto">
                <table className="w-full text-[12px] min-w-[640px]">
                  <thead className="sticky top-0 bg-card z-10">
                    <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                      <th className="text-left px-4 sm:px-5 py-2 font-medium">Cliente</th>
                      <th className="text-left px-3 py-2 font-medium">Plano</th>
                      <th className="text-right px-3 py-2 font-medium">Receita/mês</th>
                      <th className="text-right px-3 py-2 font-medium">Reserva trib.</th>
                      <th className="text-right px-3 py-2 font-medium">Custo direto</th>
                      <th className="text-right px-3 py-2 font-medium">Rateio fixo</th>
                      <th className="text-right px-4 sm:px-5 py-2 font-medium">Margem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {marginRows.length === 0 && (
                      <tr><td colSpan={7} className="px-5 py-8 text-center text-muted-foreground">Nenhum cliente com receita ainda.</td></tr>
                    )}
                    {marginRows.map((r) => (
                      <tr key={r.id}>
                        <td className="px-4 sm:px-5 py-2 text-foreground whitespace-nowrap">
                          {r.name}
                          <span className={`ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full align-middle ${r.type === "recorrente" ? "bg-primary/10 text-primary" : "bg-info/10 text-info"}`}>
                            {r.type === "recorrente" ? "Recorrente" : "Avulso"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{r.plan}</td>
                        <td className="px-3 py-2 text-right font-mono text-foreground whitespace-nowrap">{fmt(r.revenue)}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground whitespace-nowrap">− {fmt(r.taxReserve)}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground whitespace-nowrap">− {fmt(r.directCost)}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground whitespace-nowrap">− {fmt(r.rateio)}</td>
                        <td className={`px-4 sm:px-5 py-2 text-right font-mono font-medium whitespace-nowrap ${r.margin < 0 ? "text-destructive" : r.marginPct < 0.2 ? "text-warning" : "text-success"}`}>
                          {fmt(r.margin)} ({Math.round(r.marginPct * 100)}%)
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {marginRows.length > 0 && (
                    <tfoot className="sticky bottom-0 bg-card">
                      <tr className="border-t border-border">
                        <td colSpan={2} className="px-4 sm:px-5 py-2 text-[11px] font-medium text-foreground">Total ({marginRows.length} clientes)</td>
                        <td className="px-3 py-2 text-right font-mono font-medium text-foreground whitespace-nowrap">{fmt(marginRows.reduce((s, r) => s + r.revenue, 0))}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground whitespace-nowrap">− {fmt(marginRows.reduce((s, r) => s + r.taxReserve, 0))}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground whitespace-nowrap">− {fmt(marginRows.reduce((s, r) => s + r.directCost, 0))}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground whitespace-nowrap">− {fmt(allocBase)}</td>
                        <td className={`px-4 sm:px-5 py-2 text-right font-mono font-semibold whitespace-nowrap ${marginRows.reduce((s, r) => s + r.margin, 0) >= 0 ? "text-success" : "text-destructive"}`}>
                          {fmt(marginRows.reduce((s, r) => s + r.margin, 0))}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground px-4 sm:px-5 py-2.5 border-t border-border">
              Rateio automático e sincronizado: a estrutura ({fmt(allocBase)}) é dividida igualmente entre os {contributorsCount} clientes que geram receita agora — se um cliente sai ou entra, a margem de todos recalcula na hora. Recorrentes entram pelo valor do plano; avulsos pelo que foi recebido no mês corrente. Margem abaixo de 20% aparece em amarelo (piso do Plano Diretor).
            </p>
          </>
        )}
      </div>

      {/* Ações */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-sm text-muted-foreground">Planos recorrentes · preço-base antes do gross-up tributário</span>
        <div className="flex gap-2">
          {missingSeeds.length > 0 && (
            <button
              onClick={() => setSeedModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium bg-info/10 text-info hover:bg-info/20 transition-colors cursor-pointer border-none"
            >
              <BookOpen className="w-3 h-3" /> Importar Plano Diretor ({missingSeeds.length})
            </button>
          )}
          <button
            onClick={() => { setPlanForm({ name: "", description: "" }); setPlanModal({ plan: null }); }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none"
          >
            <Plus className="w-3 h-3" /> Novo plano
          </button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground text-center py-6">Carregando catálogo…</p>}
      {!isLoading && activePlans.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-6">
          Nenhum plano no catálogo ainda. Importe a tabela do Plano Diretor ou crie o primeiro plano.
        </p>
      )}

      {/* Grid de planos */}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
        {activePlans.map((plan) => {
          const v = plan.currentVersion || plan.versions[0] || null;
          const linked = clientsByPlanName.get(normName(plan.name)) || { count: 0, mrr: 0 };
          const bd = v ? breakdown(v.amount, v.taxRate, v.directCost) : null;
          const needsReview = v?.amountKind === "needs_review" || v?.taxRate === null;
          return (
            <div key={plan.id} className="bg-card border border-border rounded-xl p-4 space-y-3 flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{plan.name}</p>
                  {plan.description && <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{plan.description}</p>}
                </div>
                {needsReview && (
                  <span className="text-[9px] px-2 py-0.5 rounded-full bg-warning/15 text-warning whitespace-nowrap flex items-center gap-1">
                    <AlertTriangle className="w-2.5 h-2.5" /> Revisar alíquota
                  </span>
                )}
              </div>

              {v ? (
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xl font-mono font-semibold text-foreground">{fmt(v.amount)}</span>
                    <span className="text-[10px] text-muted-foreground">base/mês</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                    <span className="text-muted-foreground">Alíquota</span>
                    <span className="font-mono text-right text-foreground">{pctLabel(v.taxRate)}</span>
                    <span className="text-muted-foreground">Cobrança final</span>
                    <span className="font-mono text-right text-info">{fmt(bd!.final)}</span>
                    <span className="text-muted-foreground">Reserva tributária</span>
                    <span className="font-mono text-right text-muted-foreground">{fmt(bd!.reserve)}</span>
                    <span className="text-muted-foreground">Custo direto{v.directCostEstimated ? " (estimado)" : ""}</span>
                    <span className="font-mono text-right text-warning">{fmt(v.directCost)}</span>
                    <span className="text-muted-foreground">Rateio fixo/cliente</span>
                    <span className="font-mono text-right text-warning">{fmt(fixedPerClient)}</span>
                    <span className="text-muted-foreground">Margem estimada</span>
                    <span className={`font-mono text-right ${bd!.margin >= 0 ? "text-success" : "text-destructive"}`}>
                      {fmt(bd!.margin)} ({Math.round(bd!.marginPct * 100)}%)
                    </span>
                    {v.setupFee > 0 && (
                      <>
                        <span className="text-muted-foreground">Setup</span>
                        <span className="font-mono text-right text-foreground">{fmt(v.setupFee)}</span>
                      </>
                    )}
                  </div>
                  {plan.upcomingVersion && (
                    <p className="text-[10px] text-info">
                      Programado: {fmt(plan.upcomingVersion.amount)} a partir de {new Date(`${plan.upcomingVersion.effectiveFrom}T12:00:00`).toLocaleDateString("pt-BR")}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground flex-1">Sem preço definido. Crie a primeira versão.</p>
              )}

              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Users className="w-3 h-3" />
                {linked.count > 0 ? `${linked.count} cliente(s) · ${fmt(linked.mrr)}/mês` : "Nenhum cliente vinculado"}
              </div>

              <div className="flex gap-1.5 pt-1 border-t border-border">
                <button
                  onClick={() => openVersionModal(plan)}
                  className="flex-1 text-[11px] px-2 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer border-none"
                >
                  Novo preço
                </button>
                <button
                  onClick={() => { setPlanForm({ name: plan.name, description: plan.description || "" }); setPlanModal({ plan }); }}
                  className="text-[11px] px-2.5 py-1.5 rounded-lg bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer border-none"
                >
                  <Pencil className="w-3 h-3" />
                </button>
                <button
                  onClick={() => toggleArchive(plan)}
                  title="Arquivar plano"
                  className="text-[11px] px-2.5 py-1.5 rounded-lg bg-secondary text-muted-foreground hover:text-destructive transition-colors cursor-pointer border-none"
                >
                  <Archive className="w-3 h-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {archivedPlans.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Arquivados ({archivedPlans.length})</p>
          <div className="flex flex-wrap gap-2">
            {archivedPlans.map((plan) => (
              <button
                key={plan.id}
                onClick={() => toggleArchive(plan)}
                className="text-[11px] px-3 py-1.5 rounded-full bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors cursor-pointer border border-border flex items-center gap-1.5"
              >
                <RotateCcw className="w-3 h-3" /> {plan.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Avulsos · tabela oficial do Plano Diretor */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <button
          onClick={() => setOneOffOpen((v) => !v)}
          className="w-full px-5 py-3 flex items-center justify-between flex-wrap gap-2 bg-transparent border-none cursor-pointer text-left"
        >
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
            Avulsos · tabela do Plano Diretor
          </span>
          <span className="text-[10px] text-muted-foreground">
            Não entram no MRR · mudança de escopo vira nova etapa e novo preço <span className="ml-1">{oneOffOpen ? "▾" : "▸"}</span>
          </span>
        </button>
        {oneOffOpen && (<>
        <div className="overflow-x-auto max-h-[420px] overflow-y-auto border-t border-border">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="text-left px-4 sm:px-5 py-2 font-medium">Entrega</th>
                <th className="text-right px-3 py-2 font-medium">Lançamento</th>
                <th className="text-right px-3 py-2 font-medium">Padrão</th>
                <th className="text-right px-3 py-2 font-medium hidden sm:table-cell">Cobrança final*</th>
                <th className="text-right px-3 py-2 font-medium hidden md:table-cell">Limite</th>
                <th className="text-right px-4 sm:px-5 py-2 font-medium">Pagamento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ONE_OFF_CATALOG.map((o) => (
                <tr key={o.name}>
                  <td className="px-4 sm:px-5 py-2 text-foreground">{o.name}</td>
                  <td className="px-3 py-2 text-right font-mono text-foreground whitespace-nowrap">
                    {o.fromPrice ? "a partir de " : ""}{fmt(o.launchPrice)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-muted-foreground whitespace-nowrap">
                    {o.fromPrice ? "a partir de " : ""}{fmt(o.standardPrice)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-info whitespace-nowrap hidden sm:table-cell">
                    {fmt(calculateGrossedUpAmount(o.launchPrice, DEFAULT_TAX_RATE))}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground whitespace-nowrap hidden md:table-cell">{o.limit}</td>
                  <td className="px-4 sm:px-5 py-2 text-right text-muted-foreground whitespace-nowrap">{o.payment}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-muted-foreground px-5 py-2.5 border-t border-border">
          *Cobrança final = preço de lançamento com gross-up na alíquota ilustrativa de {Math.round(DEFAULT_TAX_RATE * 100)}%. Para cobrar um avulso, use "Nova Cobrança" (Visão Geral) ou um projeto avulso no cadastro do cliente — o valor entra no fluxo de caixa normalmente.
        </p>
        </>)}
      </div>

      {/* Precificador */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <button
          onClick={() => setPricerOpen((v) => !v)}
          className="w-full flex items-center gap-2 bg-transparent border-none cursor-pointer text-left p-0"
        >
          <Calculator className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium flex-1">
            Precificador · componha um valor antes de fechar
          </span>
          <span className="text-[10px] text-muted-foreground">{pricerOpen ? "▾" : "▸"}</span>
        </button>
        {pricerOpen && (<>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Valor operacional</label>
            <Input type="number" step="0.01" value={simulator.amount} onChange={(e) => setSimulator((f) => ({ ...f, amount: e.target.value }))} className="mt-1" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Alíquota (%)</label>
            <Input type="number" step="0.01" value={simulator.taxPct} onChange={(e) => setSimulator((f) => ({ ...f, taxPct: e.target.value }))} className="mt-1" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Custo direto</label>
            <Input type="number" step="0.01" value={simulator.directCost} onChange={(e) => setSimulator((f) => ({ ...f, directCost: e.target.value }))} className="mt-1" />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Cobrança final", value: fmt(sim.final), color: "text-info" },
            { label: "Reserva tributária", value: fmt(sim.reserve), color: "text-muted-foreground" },
            { label: "Rateio fixo/cliente", value: fmt(fixedPerClient), color: "text-warning" },
            { label: "Margem estimada", value: `${fmt(sim.margin)} (${simAmount > 0 ? Math.round(sim.marginPct * 100) : 0}%)`, color: sim.margin >= 0 ? "text-success" : "text-destructive" },
          ].map((s) => (
            <div key={s.label} className="bg-secondary/30 border border-border rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</p>
              <p className={`text-sm font-mono font-medium mt-1 ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">
          Fórmula oficial: cobrança final = valor operacional ÷ (1 − alíquota). Rateio gerencial: {fmt(allocBase)} de estrutura ÷ {contributorsCount} cliente(s) com receita. O rateio é análise — no resultado global o custo fixo é descontado uma única vez.
        </p>
        </>)}
      </div>

      {/* Modal nova versão de preço */}
      <Dialog open={!!versionModal} onOpenChange={() => setVersionModal(null)}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader><DialogTitle className="text-foreground">Novo preço · {versionModal?.plan.name}</DialogTitle></DialogHeader>
          {versionModal && (() => {
            const amount = parseFloat(versionForm.amount) || 0;
            const taxRate = parsePct(versionForm.taxPct);
            const directCost = parseFloat(versionForm.directCost) || 0;
            const bd = breakdown(amount, taxRate, directCost);
            const linked = clientsByPlanName.get(normName(versionModal.plan.name)) || { count: 0, mrr: 0 };
            const effective = minEffectiveFor(versionModal.plan);
            return (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground">Valor operacional (R$)</label>
                    <Input type="number" step="0.01" value={versionForm.amount} onChange={(e) => setVersionForm((f) => ({ ...f, amount: e.target.value }))} className="mt-1" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Alíquota (%)</label>
                    <Input type="number" step="0.01" value={versionForm.taxPct} onChange={(e) => setVersionForm((f) => ({ ...f, taxPct: e.target.value }))} className="mt-1" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground">Custo direto (R$)</label>
                    <Input type="number" step="0.01" value={versionForm.directCost} onChange={(e) => setVersionForm((f) => ({ ...f, directCost: e.target.value }))} className="mt-1" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Taxa de setup (R$)</label>
                    <Input type="number" step="0.01" value={versionForm.setupFee} onChange={(e) => setVersionForm((f) => ({ ...f, setupFee: e.target.value }))} className="mt-1" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Observação (opcional)</label>
                  <Input value={versionForm.description} onChange={(e) => setVersionForm((f) => ({ ...f, description: e.target.value }))} className="mt-1" placeholder="Ex: reajuste do degrau 60-90 dias" />
                </div>

                <div className="bg-secondary/50 rounded-lg p-3 space-y-1">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Prévia da precificação</p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[12px]">
                    <span className="text-muted-foreground">Cobrança final</span>
                    <span className="font-mono text-right text-info">{fmt(bd.final)}</span>
                    <span className="text-muted-foreground">Reserva tributária</span>
                    <span className="font-mono text-right text-muted-foreground">{fmt(bd.reserve)}</span>
                    <span className="text-muted-foreground">Margem estimada</span>
                    <span className={`font-mono text-right ${bd.margin >= 0 ? "text-success" : "text-destructive"}`}>{fmt(bd.margin)}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground pt-1">
                    Vigência: {new Date(`${effective}T12:00:00`).toLocaleDateString("pt-BR")} em diante · {linked.count} cliente(s) hoje neste plano.
                    Mensalidades já pagas e competências passadas não mudam.
                  </p>
                </div>

                <button
                  onClick={saveVersion}
                  disabled={createPlanVersion.isPending}
                  className="w-full py-2.5 rounded-xl text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none disabled:opacity-50"
                >
                  Criar nova versão de preço
                </button>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Modal criar/editar plano */}
      <Dialog open={!!planModal} onOpenChange={() => setPlanModal(null)}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader><DialogTitle className="text-foreground">{planModal?.plan ? "Editar plano" : "Novo plano"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Nome</label>
              <Input value={planForm.name} onChange={(e) => setPlanForm((f) => ({ ...f, name: e.target.value }))} className="mt-1" placeholder="Ex: Essencial" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Descrição curta</label>
              <textarea
                value={planForm.description}
                onChange={(e) => setPlanForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full mt-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground resize-none"
                rows={2}
              />
            </div>
            <button
              onClick={savePlan}
              disabled={upsertPlan.isPending}
              className="w-full py-2.5 rounded-xl text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none disabled:opacity-50"
            >
              {planModal?.plan ? "Salvar" : "Criar plano"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal seed Plano Diretor */}
      <Dialog open={seedModal} onOpenChange={setSeedModal}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader><DialogTitle className="text-foreground">Importar planos do Plano Diretor</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-[12px] text-muted-foreground">
              Serão criados os planos abaixo com o preço de lançamento, alíquota ilustrativa de 6% e custo direto estimado de {fmt(defaultDirectCost)}. Planos já existentes não são duplicados nem alterados.
            </p>
            <div className="space-y-1 max-h-52 overflow-y-auto">
              {missingSeeds.map((s) => (
                <div key={s.code} className="flex items-center gap-3 text-[12px] px-3 py-2 rounded-lg bg-secondary/30">
                  <span className="flex-1 text-foreground">{s.name}</span>
                  <span className="font-mono text-muted-foreground">{fmt(s.launchPrice)}/mês</span>
                  <span className="font-mono text-[10px] text-muted-foreground">setup {fmt(s.setupFee)}</span>
                </div>
              ))}
            </div>
            <button
              onClick={runSeed}
              disabled={seeding}
              className="w-full py-2.5 rounded-xl text-[13px] font-medium bg-info text-white hover:opacity-90 transition-opacity cursor-pointer border-none disabled:opacity-50"
            >
              {seeding ? "Importando…" : `Importar ${missingSeeds.length} plano(s)`}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
