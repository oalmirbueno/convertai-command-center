import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Pencil, Archive, RotateCcw, BookOpen, Users, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useClients } from "@/hooks/useSupabaseData";
import {
  useFinancePlans,
  useFinanceSettings,
  useFinanceMutations,
  calculateGrossedUpAmount,
  type FinancePlan,
} from "@/hooks/useFinanceV2";
import { DIRECTOR_PLAN_CATALOG, ONE_OFF_CATALOG, DEFAULT_TAX_RATE } from "@/lib/directorPlan";
import { isInternalClient } from "@/lib/clientFlags";
import {
  CampoDeFormulario, Carregando, EstadoVazio, GrupoDeCampos, RegiaoRolavel, Secao,
  botao, campo, campoTexto, juntar, superficie, texto, useEstadoDaTela,
} from "@/components/sistema";
import { AcoesDoDialogo, Etiqueta, GradeDeKpis, Kpi, TituloRecolhivel, botaoDeLinha, corDoTom } from "@/components/finance/pecasDoFinanceiro";

const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
const pctLabel = (v: number | null | undefined) =>
  v === null || v === undefined ? "-" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

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

const ehBooleano = (v: unknown) => typeof v === "boolean";
const SIMULADOR_INICIAL = { amount: "1297", taxPct: "6", directCost: "275" };
const ehSimulador = (v: unknown) =>
  !!v && typeof v === "object" && ["amount", "taxPct", "directCost"].every((k) => typeof (v as any)[k] === "string");

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
  // O simulador e os blocos abertos/recolhidos ficam lembrados ao sair e voltar.
  const [simulator, setSimulator] = useEstadoDaTela("financeiro:planos:simulador", SIMULADOR_INICIAL, { validar: ehSimulador, esperaMs: 300 });
  const [marginOpen, setMarginOpen] = useEstadoDaTela("financeiro:planos:margem:aberta", true, { validar: ehBooleano });
  const [oneOffOpen, setOneOffOpen] = useEstadoDaTela("financeiro:planos:avulsos:aberta", true, { validar: ehBooleano });
  const [pricerOpen, setPricerOpen] = useEstadoDaTela("financeiro:planos:precificador:aberto", true, { validar: ehBooleano });

  const { data: allExpenses = [] } = useQuery({
    queryKey: ["expenses"],
    queryFn: async () => {
      const { data, error } = await supabase.from("expenses").select("*").order("due_date", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const activeClients = useMemo(
    () => (clients || []).filter((c: any) => c.plan_status === "active" && c.client_type !== "one_off" && !isInternalClient(c)),
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
      if (isInternalClient(c)) return;
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

  const totalMargem = marginRows.reduce((s, r) => s + r.margin, 0);
  const tomDaMargem = (r: { margin: number; marginPct: number }) =>
    r.margin < 0 ? corDoTom.perigo : r.marginPct < 0.2 ? corDoTom.aviso : corDoTom.sucesso;

  return (
    <div className="min-w-0 space-y-6">
      {/* Resumo do catálogo */}
      <GradeDeKpis>
        <Kpi rotulo="Planos ativos" valor={String(activePlans.length)} />
        <Kpi rotulo="Clientes em planos" valor={String([...clientsByPlanName.values()].reduce((s, v) => s + v.count, 0))} tom="primario" />
        <Kpi rotulo="MRR dos planos" valor={fmt([...clientsByPlanName.values()].reduce((s, v) => s + v.mrr, 0))} tom="sucesso" />
        <Kpi rotulo="Rateio fixo / cliente" valor={fmt(fixedPerClient)} tom="info" />
      </GradeDeKpis>

      {/* Margem em tempo real por cliente */}
      <Secao
        divisoria
        titulo={
          <TituloRecolhivel aberto={marginOpen} onAlternar={() => setMarginOpen((v) => !v)} controla="financeiro-margem">
            Margem por cliente ({marginRows.length})
          </TituloRecolhivel>
        }
        descricao={`Estrutura ${fmt(allocBase)} ÷ ${contributorsCount} = ${fmt(fixedPerClient)}/cliente`}
        ajuda={
          <>
            Rateio automático e sincronizado: a estrutura ({fmt(allocBase)}) é dividida igualmente entre os {contributorsCount} clientes
            que geram receita agora. Se um cliente sai ou entra, a margem de todos recalcula na hora. Recorrentes entram pelo valor do
            plano; avulsos pelo que foi recebido no mês corrente. Margem abaixo de 20% aparece em amarelo (piso do Plano Diretor).
          </>
        }
      >
        {marginOpen && (
          <div id="financeiro-margem">
            {marginRows.length === 0 ? (
              <EstadoVazio compacto titulo="Nenhum cliente com receita ainda." />
            ) : (
              <RegiaoRolavel memoria="financeiro:planos:margem" rotulo="Margem por cliente" className="lg:max-h-[420px]">
                {/* Computador: tabela. Celular e tablet: lista. */}
                <table className="hidden w-full text-[13px] lg:table">
                  <thead className="bg-background lg:sticky lg:top-0 lg:z-10">
                    <tr className="border-b border-border">
                      <th className={juntar(texto.rotulo, "py-2 pr-3 text-left")}>Cliente</th>
                      <th className={juntar(texto.rotulo, "px-3 py-2 text-left")}>Plano</th>
                      <th className={juntar(texto.rotulo, "px-3 py-2 text-right")}>Receita/mês</th>
                      <th className={juntar(texto.rotulo, "px-3 py-2 text-right")}>Reserva trib.</th>
                      <th className={juntar(texto.rotulo, "px-3 py-2 text-right")}>Custo direto</th>
                      <th className={juntar(texto.rotulo, "px-3 py-2 text-right")}>Rateio fixo</th>
                      <th className={juntar(texto.rotulo, "py-2 pl-3 text-right")}>Margem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {marginRows.map((r) => (
                      <tr key={r.id}>
                        <td className="max-w-[240px] py-2 pr-3 text-foreground">
                          <span className="flex min-w-0 items-center">
                            <span className="min-w-0 truncate">{r.name}</span>
                            <Etiqueta tom={r.type === "recorrente" ? "primario" : "info"} className="ml-1.5">
                              {r.type === "recorrente" ? "Recorrente" : "Avulso"}
                            </Etiqueta>
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{r.plan}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-foreground">{fmt(r.revenue)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">− {fmt(r.taxReserve)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">− {fmt(r.directCost)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">− {fmt(r.rateio)}</td>
                        <td className={juntar("whitespace-nowrap py-2 pl-3 text-right font-medium tabular-nums", tomDaMargem(r))}>
                          {fmt(r.margin)} ({Math.round(r.marginPct * 100)}%)
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-background lg:sticky lg:bottom-0">
                    <tr className="border-t border-border">
                      <td colSpan={2} className="py-2 pr-3 text-[12px] font-medium text-foreground">Total ({marginRows.length} clientes)</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums text-foreground">{fmt(marginRows.reduce((s, r) => s + r.revenue, 0))}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">− {fmt(marginRows.reduce((s, r) => s + r.taxReserve, 0))}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">− {fmt(marginRows.reduce((s, r) => s + r.directCost, 0))}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">− {fmt(allocBase)}</td>
                      <td className={juntar("whitespace-nowrap py-2 pl-3 text-right font-semibold tabular-nums", totalMargem >= 0 ? corDoTom.sucesso : corDoTom.perigo)}>
                        {fmt(totalMargem)}
                      </td>
                    </tr>
                  </tfoot>
                </table>

                <ul className="divide-y divide-border lg:hidden">
                  {marginRows.map((r) => (
                    <li key={r.id} className="min-w-0 py-2.5">
                      <div className="flex min-w-0 items-center">
                        <span className="mr-2 min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{r.name}</span>
                        <span className={juntar("shrink-0 text-[13px] font-medium tabular-nums", tomDaMargem(r))}>
                          {fmt(r.margin)} ({Math.round(r.marginPct * 100)}%)
                        </span>
                      </div>
                      <p className={juntar(texto.auxiliar, "mt-0.5 truncate tabular-nums")}>
                        {r.type === "recorrente" ? r.plan : "Avulso"} · {fmt(r.revenue)} − trib. {fmt(r.taxReserve)} − direto {fmt(r.directCost)} − rateio {fmt(r.rateio)}
                      </p>
                    </li>
                  ))}
                  <li className="flex min-w-0 items-center py-2.5">
                    <span className="mr-2 min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">Total ({marginRows.length} clientes)</span>
                    <span className={juntar("shrink-0 text-[13px] font-semibold tabular-nums", totalMargem >= 0 ? corDoTom.sucesso : corDoTom.perigo)}>{fmt(totalMargem)}</span>
                  </li>
                </ul>
              </RegiaoRolavel>
            )}
          </div>
        )}
      </Secao>

      {/* Planos recorrentes */}
      <Secao
        divisoria
        titulo="Planos recorrentes"
        descricao={`${activePlans.length} ${activePlans.length === 1 ? "ativo" : "ativos"}`}
        ajuda="Preço-base antes do gross-up tributário. Um preço novo vira uma versão nova: mensalidades já pagas e competências passadas não mudam."
        acao={
          <>
            {missingSeeds.length > 0 && (
              <button type="button" onClick={() => setSeedModal(true)} className={botao.secundario} aria-label={`Importar Plano Diretor (${missingSeeds.length})`}>
                <BookOpen className="h-3.5 w-3.5 sm:mr-1.5" aria-hidden="true" />
                <span className="hidden sm:inline">Importar Plano Diretor ({missingSeeds.length})</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => { setPlanForm({ name: "", description: "" }); setPlanModal({ plan: null }); }}
              className={botao.primario}
              aria-label="Novo plano"
            >
              <Plus className="h-3.5 w-3.5 sm:mr-1.5" aria-hidden="true" />
              <span className="hidden sm:inline">Novo plano</span>
            </button>
          </>
        }
      >
        {isLoading && !plans ? (
          <Carregando forma="lista" linhas={3} rotulo="Carregando catálogo" />
        ) : activePlans.length === 0 ? (
          <EstadoVazio compacto titulo="Nenhum plano no catálogo." descricao="Importe a tabela do Plano Diretor ou crie o primeiro plano." />
        ) : (
          <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {activePlans.map((plan) => {
              const v = plan.currentVersion || plan.versions[0] || null;
              const linked = clientsByPlanName.get(normName(plan.name)) || { count: 0, mrr: 0 };
              const bd = v ? breakdown(v.amount, v.taxRate, v.directCost) : null;
              const needsReview = v?.amountKind === "needs_review" || v?.taxRate === null;
              return (
                <article key={plan.id} className={juntar(superficie.painel, "flex min-w-0 flex-col")}>
                  <div className="flex min-w-0 items-start px-4 pt-4">
                    <div className="mr-2 min-w-0 flex-1">
                      <h3 className="truncate text-[13px] font-semibold text-foreground">{plan.name}</h3>
                      {plan.description && <p className={juntar(texto.auxiliar, "mt-0.5 line-clamp-2 leading-4")}>{plan.description}</p>}
                    </div>
                    {needsReview && (
                      <Etiqueta tom="aviso">
                        <AlertTriangle className="mr-1 h-3 w-3" aria-hidden="true" /> Revisar alíquota
                      </Etiqueta>
                    )}
                  </div>

                  <div className="flex-1 px-4 pb-3 pt-3">
                    {v ? (
                      <>
                        <p className="flex items-baseline">
                          <span className="mr-2 text-[20px] font-semibold tabular-nums text-foreground">{fmt(v.amount)}</span>
                          <span className={texto.auxiliar}>base/mês</span>
                        </p>
                        <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-[12px]">
                          <dt className="text-muted-foreground">Alíquota</dt>
                          <dd className="text-right tabular-nums text-foreground">{pctLabel(v.taxRate)}</dd>
                          <dt className="text-muted-foreground">Cobrança final</dt>
                          <dd className="text-right tabular-nums text-info">{fmt(bd!.final)}</dd>
                          <dt className="text-muted-foreground">Reserva tributária</dt>
                          <dd className="text-right tabular-nums text-muted-foreground">{fmt(bd!.reserve)}</dd>
                          <dt className="truncate text-muted-foreground">Custo direto{v.directCostEstimated ? " (estimado)" : ""}</dt>
                          <dd className="text-right tabular-nums text-warning">{fmt(v.directCost)}</dd>
                          <dt className="text-muted-foreground">Rateio fixo/cliente</dt>
                          <dd className="text-right tabular-nums text-warning">{fmt(fixedPerClient)}</dd>
                          <dt className="text-muted-foreground">Margem estimada</dt>
                          <dd className={juntar("text-right tabular-nums", bd!.margin >= 0 ? "text-success" : "text-destructive")}>
                            {fmt(bd!.margin)} ({Math.round(bd!.marginPct * 100)}%)
                          </dd>
                          {v.setupFee > 0 && (
                            <>
                              <dt className="text-muted-foreground">Setup</dt>
                              <dd className="text-right tabular-nums text-foreground">{fmt(v.setupFee)}</dd>
                            </>
                          )}
                        </dl>
                        {plan.upcomingVersion && (
                          <p className="mt-2 truncate text-[12px] text-info">
                            Programado: {fmt(plan.upcomingVersion.amount)} a partir de {new Date(`${plan.upcomingVersion.effectiveFrom}T12:00:00`).toLocaleDateString("pt-BR")}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className={texto.auxiliar}>Sem preço definido. Crie a primeira versão.</p>
                    )}
                    <p className={juntar(texto.auxiliar, "mt-3 flex items-center")}>
                      <Users className="mr-1.5 h-3 w-3 shrink-0" aria-hidden="true" />
                      <span className="truncate">{linked.count > 0 ? `${linked.count} cliente(s) · ${fmt(linked.mrr)}/mês` : "Nenhum cliente vinculado"}</span>
                    </p>
                  </div>

                  <div className="flex min-w-0 items-center border-t border-border px-3 py-2">
                    <button type="button" onClick={() => openVersionModal(plan)} className={juntar(botaoDeLinha, "mr-auto")}>
                      Novo preço
                    </button>
                    <button
                      type="button"
                      onClick={() => { setPlanForm({ name: plan.name, description: plan.description || "" }); setPlanModal({ plan }); }}
                      className={botao.icone}
                      aria-label={`Editar ${plan.name}`}
                      title="Editar plano"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleArchive(plan)}
                      title="Arquivar plano"
                      aria-label={`Arquivar ${plan.name}`}
                      className={juntar(botao.icone, "hover:text-destructive")}
                    >
                      <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {archivedPlans.length > 0 && (
          <div className="mt-4 min-w-0">
            <p className={juntar(texto.rotulo, "mb-1.5")}>Arquivados ({archivedPlans.length})</p>
            <div className="-m-1 flex min-w-0 flex-wrap">
              {archivedPlans.map((plan) => (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => toggleArchive(plan)}
                  title="Reativar plano"
                  className={juntar(botaoDeLinha, "m-1 max-w-full text-muted-foreground hover:text-foreground")}
                >
                  <RotateCcw className="mr-1.5 h-3 w-3 shrink-0" aria-hidden="true" /> <span className="truncate">{plan.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </Secao>

      {/* Avulsos · tabela oficial do Plano Diretor */}
      <Secao
        divisoria
        titulo={
          <TituloRecolhivel aberto={oneOffOpen} onAlternar={() => setOneOffOpen((v) => !v)} controla="financeiro-avulsos">
            Avulsos do Plano Diretor
          </TituloRecolhivel>
        }
        descricao="Não entram no MRR"
        ajuda={
          <>
            Mudança de escopo vira nova etapa e novo preço. Cobrança final = preço de lançamento com gross-up na alíquota ilustrativa
            de {Math.round(DEFAULT_TAX_RATE * 100)}%. Para cobrar um avulso, use "Nova Cobrança" (Visão Geral) ou um projeto avulso no
            cadastro do cliente: o valor entra no fluxo de caixa normalmente.
          </>
        }
      >
        {oneOffOpen && (
          <div id="financeiro-avulsos">
            <RegiaoRolavel memoria="financeiro:planos:avulsos" rotulo="Avulsos do Plano Diretor" className="lg:max-h-[420px]">
              <table className="hidden w-full text-[13px] lg:table">
                <thead className="bg-background lg:sticky lg:top-0 lg:z-10">
                  <tr className="border-b border-border">
                    <th className={juntar(texto.rotulo, "py-2 pr-3 text-left")}>Entrega</th>
                    <th className={juntar(texto.rotulo, "px-3 py-2 text-right")}>Lançamento</th>
                    <th className={juntar(texto.rotulo, "px-3 py-2 text-right")}>Padrão</th>
                    <th className={juntar(texto.rotulo, "px-3 py-2 text-right")}>Cobrança final</th>
                    <th className={juntar(texto.rotulo, "hidden px-3 py-2 text-right xl:table-cell")}>Limite</th>
                    <th className={juntar(texto.rotulo, "py-2 pl-3 text-right")}>Pagamento</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {ONE_OFF_CATALOG.map((o) => (
                    <tr key={o.name}>
                      <td className="py-2 pr-3 text-foreground">{o.name}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-foreground">
                        {o.fromPrice ? "a partir de " : ""}{fmt(o.launchPrice)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {o.fromPrice ? "a partir de " : ""}{fmt(o.standardPrice)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-info">
                        {fmt(calculateGrossedUpAmount(o.launchPrice, DEFAULT_TAX_RATE))}
                      </td>
                      <td className="hidden whitespace-nowrap px-3 py-2 text-right text-muted-foreground xl:table-cell">{o.limit}</td>
                      <td className="whitespace-nowrap py-2 pl-3 text-right text-muted-foreground">{o.payment}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <ul className="divide-y divide-border lg:hidden">
                {ONE_OFF_CATALOG.map((o) => (
                  <li key={o.name} className="min-w-0 py-2.5">
                    <div className="flex min-w-0 items-center">
                      <span className="mr-2 min-w-0 flex-1 text-[13px] font-medium text-foreground [overflow-wrap:anywhere]">{o.name}</span>
                      <span className="shrink-0 text-[13px] tabular-nums text-foreground">{o.fromPrice ? "a partir de " : ""}{fmt(o.launchPrice)}</span>
                    </div>
                    <p className={juntar(texto.auxiliar, "mt-0.5 tabular-nums [overflow-wrap:anywhere]")}>
                      Padrão {fmt(o.standardPrice)} · final {fmt(calculateGrossedUpAmount(o.launchPrice, DEFAULT_TAX_RATE))} · {o.limit} · {o.payment}
                    </p>
                  </li>
                ))}
              </ul>
            </RegiaoRolavel>
          </div>
        )}
      </Secao>

      {/* Precificador */}
      <Secao
        divisoria
        titulo={
          <TituloRecolhivel aberto={pricerOpen} onAlternar={() => setPricerOpen((v) => !v)} controla="financeiro-precificador">
            Precificador
          </TituloRecolhivel>
        }
        ajuda={
          <>
            Componha um valor antes de fechar. Fórmula oficial: cobrança final = valor operacional ÷ (1 − alíquota). Rateio gerencial:
            {" "}{fmt(allocBase)} de estrutura ÷ {contributorsCount} cliente(s) com receita. O rateio é análise: no resultado global o custo
            fixo é descontado uma única vez.
          </>
        }
      >
        {pricerOpen && (
          <div id="financeiro-precificador" className="min-w-0 space-y-4">
            <GrupoDeCampos colunas={3}>
              <CampoDeFormulario rotulo="Valor operacional (R$)">
                <input type="number" step="0.01" inputMode="decimal" value={simulator.amount} onChange={(e) => setSimulator((f) => ({ ...f, amount: e.target.value }))} className={campo} />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Alíquota (%)">
                <input type="number" step="0.01" inputMode="decimal" value={simulator.taxPct} onChange={(e) => setSimulator((f) => ({ ...f, taxPct: e.target.value }))} className={campo} />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Custo direto (R$)">
                <input type="number" step="0.01" inputMode="decimal" value={simulator.directCost} onChange={(e) => setSimulator((f) => ({ ...f, directCost: e.target.value }))} className={campo} />
              </CampoDeFormulario>
            </GrupoDeCampos>
            <GradeDeKpis>
              <Kpi rotulo="Cobrança final" valor={fmt(sim.final)} tom="info" />
              <Kpi rotulo="Reserva tributária" valor={fmt(sim.reserve)} tom="apagado" />
              <Kpi rotulo="Rateio fixo/cliente" valor={fmt(fixedPerClient)} tom="aviso" />
              <Kpi
                rotulo="Margem estimada"
                valor={`${fmt(sim.margin)} (${simAmount > 0 ? Math.round(sim.marginPct * 100) : 0}%)`}
                tom={sim.margin >= 0 ? "sucesso" : "perigo"}
              />
            </GradeDeKpis>
          </div>
        )}
      </Secao>

      {/* Modal nova versão de preço */}
      <Dialog open={!!versionModal} onOpenChange={() => setVersionModal(null)}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto border-border bg-card">
          <DialogHeader><DialogTitle className="text-foreground">Novo preço · {versionModal?.plan.name}</DialogTitle></DialogHeader>
          {versionModal && (() => {
            const amount = parseFloat(versionForm.amount) || 0;
            const taxRate = parsePct(versionForm.taxPct);
            const directCost = parseFloat(versionForm.directCost) || 0;
            const bd = breakdown(amount, taxRate, directCost);
            const linked = clientsByPlanName.get(normName(versionModal.plan.name)) || { count: 0, mrr: 0 };
            const effective = minEffectiveFor(versionModal.plan);
            return (
              <div className="space-y-4">
                <GrupoDeCampos>
                  <CampoDeFormulario rotulo="Valor operacional (R$)">
                    <input type="number" step="0.01" inputMode="decimal" value={versionForm.amount} onChange={(e) => setVersionForm((f) => ({ ...f, amount: e.target.value }))} className={campo} />
                  </CampoDeFormulario>
                  <CampoDeFormulario rotulo="Alíquota (%)">
                    <input type="number" step="0.01" inputMode="decimal" value={versionForm.taxPct} onChange={(e) => setVersionForm((f) => ({ ...f, taxPct: e.target.value }))} className={campo} />
                  </CampoDeFormulario>
                  <CampoDeFormulario rotulo="Custo direto (R$)">
                    <input type="number" step="0.01" inputMode="decimal" value={versionForm.directCost} onChange={(e) => setVersionForm((f) => ({ ...f, directCost: e.target.value }))} className={campo} />
                  </CampoDeFormulario>
                  <CampoDeFormulario rotulo="Taxa de setup (R$)">
                    <input type="number" step="0.01" inputMode="decimal" value={versionForm.setupFee} onChange={(e) => setVersionForm((f) => ({ ...f, setupFee: e.target.value }))} className={campo} />
                  </CampoDeFormulario>
                  <CampoDeFormulario rotulo="Observação (opcional)" largo>
                    <input value={versionForm.description} onChange={(e) => setVersionForm((f) => ({ ...f, description: e.target.value }))} className={campo} placeholder="Ex.: reajuste do degrau 60-90 dias" />
                  </CampoDeFormulario>
                </GrupoDeCampos>

                <div className={juntar(superficie.poco, "px-3 py-2.5")}>
                  <p className={juntar(texto.rotulo, "mb-1")}>Prévia</p>
                  <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 text-[13px]">
                    <dt className="text-muted-foreground">Cobrança final</dt>
                    <dd className="text-right tabular-nums text-info">{fmt(bd.final)}</dd>
                    <dt className="text-muted-foreground">Reserva tributária</dt>
                    <dd className="text-right tabular-nums text-muted-foreground">{fmt(bd.reserve)}</dd>
                    <dt className="text-muted-foreground">Margem estimada</dt>
                    <dd className={juntar("text-right tabular-nums", bd.margin >= 0 ? "text-success" : "text-destructive")}>{fmt(bd.margin)}</dd>
                  </dl>
                  <p className={juntar(texto.auxiliar, "mt-1.5 leading-4")}>
                    Vale de {new Date(`${effective}T12:00:00`).toLocaleDateString("pt-BR")} em diante · {linked.count} cliente(s) hoje neste plano. O que já foi pago não muda.
                  </p>
                </div>

                <AcoesDoDialogo>
                  <button type="button" onClick={() => setVersionModal(null)} className={botao.discreto}>Cancelar</button>
                  <button type="button" onClick={saveVersion} disabled={createPlanVersion.isPending} className={botao.primario}>
                    Criar nova versão de preço
                  </button>
                </AcoesDoDialogo>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Modal criar/editar plano */}
      <Dialog open={!!planModal} onOpenChange={() => setPlanModal(null)}>
        <DialogContent className="max-w-md border-border bg-card">
          <DialogHeader><DialogTitle className="text-foreground">{planModal?.plan ? "Editar plano" : "Novo plano"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <GrupoDeCampos colunas={1}>
              <CampoDeFormulario rotulo="Nome" obrigatorio>
                <input value={planForm.name} onChange={(e) => setPlanForm((f) => ({ ...f, name: e.target.value }))} className={campo} placeholder="Ex.: Essencial" />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Descrição curta">
                <textarea
                  value={planForm.description}
                  onChange={(e) => setPlanForm((f) => ({ ...f, description: e.target.value }))}
                  className={juntar(campoTexto, "resize-none")}
                  rows={2}
                />
              </CampoDeFormulario>
            </GrupoDeCampos>
            <AcoesDoDialogo>
              <button type="button" onClick={() => setPlanModal(null)} className={botao.discreto}>Cancelar</button>
              <button type="button" onClick={savePlan} disabled={upsertPlan.isPending} className={botao.primario}>
                {planModal?.plan ? "Salvar" : "Criar plano"}
              </button>
            </AcoesDoDialogo>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal seed Plano Diretor */}
      <Dialog open={seedModal} onOpenChange={setSeedModal}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto border-border bg-card">
          <DialogHeader><DialogTitle className="text-foreground">Importar planos do Plano Diretor</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-[13px] leading-5 text-muted-foreground">
              Entram com o preço de lançamento, alíquota ilustrativa de 6% e custo direto estimado de {fmt(defaultDirectCost)}. Planos que já existem não mudam.
            </p>
            <RegiaoRolavel modo="sempre" sobre="cartao" className="max-h-52">
              <ul className="divide-y divide-border">
                {missingSeeds.map((s) => (
                  <li key={s.code} className="flex min-w-0 items-center py-2 text-[13px]">
                    <span className="mr-3 min-w-0 flex-1 truncate text-foreground">{s.name}</span>
                    <span className="mr-3 shrink-0 tabular-nums text-muted-foreground">{fmt(s.launchPrice)}/mês</span>
                    <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">setup {fmt(s.setupFee)}</span>
                  </li>
                ))}
              </ul>
            </RegiaoRolavel>
            <AcoesDoDialogo>
              <button type="button" onClick={() => setSeedModal(false)} className={botao.discreto}>Cancelar</button>
              <button type="button" onClick={runSeed} disabled={seeding} className={botao.primario}>
                {seeding ? "Importando..." : `Importar ${missingSeeds.length} plano(s)`}
              </button>
            </AcoesDoDialogo>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
