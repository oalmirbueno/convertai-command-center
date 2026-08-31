import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Plus, Pencil, PiggyBank, Wrench, Scale, CheckCircle2, XCircle, Trash2,
  CalendarDays, Landmark, Loader2, Receipt, Wallet,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useFinanceSettings, useFinanceRecurringRules, useFinanceMutations } from "@/hooks/useFinanceV2";
import { interpolateProLabore, nextProLaboreTier, PRO_LABORE_LADDER } from "@/lib/directorPlan";
import AreaTributaria from "@/components/finance/AreaTributaria";
import { custoMensal, diasAteVencer, proximoVencimento } from "@/lib/tributos";

const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

// Mesmos valores usados no Fluxo de Caixa (expenses.category) para manter os
// lançamentos compatíveis entre as abas.
const FIXED_COST_CATEGORIES = [
  { value: "salarios", label: "Salários & Pró-labore" },
  { value: "ferramentas", label: "Ferramentas / SaaS" },
  { value: "marketing", label: "Marketing & Ads próprios" },
  { value: "impostos", label: "Impostos & Taxas" },
  { value: "fornecedores", label: "Fornecedores" },
  { value: "infraestrutura", label: "Infraestrutura / Hosting" },
  { value: "comissoes", label: "Comissões" },
  { value: "outros", label: "Outros" },
];
const catLabel = (v: string) => FIXED_COST_CATEGORIES.find((c) => c.value === v)?.label || v;

const isProLaboreExpense = (e: any) =>
  /pr[oó][\s_-]?labore/i.test(`${e?.description || ""} ${e?.notes || ""}`);

const todayKey = () => new Date().toISOString().slice(0, 10);
const monthDay10 = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-10`;
};

interface Props {
  /** Receita operacional de referência do mês (para a sugestão de pró-labore). */
  monthlyOperationalRevenue: number;
  /** Bruto recebido no mês: é sobre ele que a alíquota incide. */
  grossReceivedThisMonth?: number;
}

/* As três leituras desta área. Separadas porque respondem a perguntas
   diferentes: quanto a estrutura custa, quanto eu posso retirar, e quanto
   fica reservado para o governo. Juntas numa página só, nenhuma era
   legível. */
const ABAS = [
  { id: "custos", rotulo: "Custos fixos", icone: Scale },
  { id: "prolabore", rotulo: "Pró-labore", icone: PiggyBank },
  { id: "tributaria", rotulo: "Tributária", icone: Landmark },
] as const;

export default function FixedCosts({ monthlyOperationalRevenue, grossReceivedThisMonth = 0 }: Props) {
  const [aba, setAba] = useState<(typeof ABAS)[number]["id"]>("custos");
  const [pagando, setPagando] = useState<string | null>(null);
  const [vencModal, setVencModal] = useState<any | null>(null);
  const qc = useQueryClient();
  const { data: settings } = useFinanceSettings();
  const { data: rules } = useFinanceRecurringRules();
  const { updateSettings, upsertRecurringRule } = useFinanceMutations();

  const [costModal, setCostModal] = useState<any | null>(null);
  const [proLaboreModal, setProLaboreModal] = useState(false);
  const [proLaboreInput, setProLaboreInput] = useState("");
  const [toolsModal, setToolsModal] = useState(false);
  const [toolsInput, setToolsInput] = useState("");
  const [confirmDel, setConfirmDel] = useState<any | null>(null);

  const { data: allExpenses = [] } = useQuery({
    queryKey: ["expenses"],
    queryFn: async () => {
      const { data, error } = await supabase.from("expenses").select("*").order("due_date", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const recurringExpenses = useMemo(
    () => (allExpenses || []).filter((e: any) => e.recurrence === "monthly" || e.recurrence === "yearly"),
    [allExpenses]
  );
  const monthlyBase = recurringExpenses.reduce(
    (s: number, e: any) => s + (e.recurrence === "monthly" ? Number(e.amount || 0) : Number(e.amount || 0) / 12),
    0
  );
  /* O histórico: as saídas REAIS já pagas. São linhas com recurrence
     'none', para não virarem molde e não contarem duas vezes no fluxo. */
  const historico = useMemo(
    () => (allExpenses || [])
      .filter((e: any) => e.status === "paid" && e.recurrence === "none")
      .sort((a: any, b: any) => String(b.paid_date || "").localeCompare(String(a.paid_date || ""))),
    [allExpenses],
  );

  const proLaboreRows = recurringExpenses.filter(isProLaboreExpense);
  const proLaboreInExpenses = proLaboreRows.reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
  const fixedWithoutProLabore = monthlyBase - proLaboreRows.filter((e: any) => e.recurrence === "monthly").reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
  const hasToolsExpense = recurringExpenses.some((e: any) => e.category === "ferramentas" || e.category === "infraestrutura");

  const proLabore = settings?.currentProLabore ?? 3000;
  const targetProLabore = settings?.targetProLabore ?? 10000;
  const toolsReference = Number(settings?.raw?.tools_systems_cost ?? 2500);
  const suggested = interpolateProLabore(monthlyOperationalRevenue);
  const nextTier = nextProLaboreTier(monthlyOperationalRevenue);
  const toolsRule = (rules || []).find((r) => (r.raw as any)?.stable_code === "tools-systems");

  const invalidate = () => qc.invalidateQueries({ queryKey: ["expenses"] });

  const saveCost = async () => {
    const form = costModal;
    if (!form?.description || !form?.amount || !form?.due_date) {
      toast.error("Preencha descrição, valor e vencimento");
      return;
    }
    const payload = {
      description: form.description,
      category: form.category || "outros",
      amount: parseFloat(form.amount) || 0,
      due_date: form.due_date,
      status: form.status || "pending",
      recurrence: form.recurrence || "monthly",
      notes: form.notes || null,
    };
    if (form.id) {
      const { error } = await supabase.from("expenses").update(payload).eq("id", form.id);
      if (error) return toast.error(error.message);
      toast.success("Custo fixo atualizado");
    } else {
      const { error } = await supabase.from("expenses").insert(payload);
      if (error) return toast.error(error.message);
      toast.success("Custo fixo registrado");
    }
    setCostModal(null);
    invalidate();
  };

  const endRecurrence = async (e: any) => {
    const { error } = await supabase.from("expenses").update({ recurrence: "none" }).eq("id", e.id);
    if (error) return toast.error(error.message);
    toast.success("Recorrência encerrada. O lançamento original permanece no histórico.");
    invalidate();
  };

  const deleteCost = async (e: any) => {
    const { error } = await supabase.from("expenses").delete().eq("id", e.id);
    if (error) return toast.error(error.message);
    toast.success("Custo removido");
    setConfirmDel(null);
    invalidate();
  };

  const buildSettingsInput = (overrides: Partial<Record<string, number>>) => ({
    currency: settings!.currency,
    openingBalance: settings!.openingBalance,
    reserveTarget: settings!.reserveTarget,
    defaultDueDay: settings!.defaultDueDay,
    forecastMonths: settings!.forecastMonths,
    monthlyGoal: settings!.monthlyGoal,
    growthRetentionRate: settings!.growthRetentionRate,
    minimumReserveMonths: settings!.minimumReserveMonths,
    desiredMinimumMargin: settings!.desiredMinimumMargin,
    currentProLabore: overrides.currentProLabore ?? settings!.currentProLabore,
    targetProLabore: settings!.targetProLabore,
    defaultDirectCost: settings!.defaultDirectCost,
    allocationMethod: settings!.allocationMethod,
    includeProLaboreInAllocation: settings!.includeProLaboreInAllocation,
  });

  const applyProLabore = async () => {
    if (!settings) return;
    const value = parseFloat(proLaboreInput);
    if (!Number.isFinite(value) || value < 0) { toast.error("Informe um valor válido"); return; }
    try {
      await updateSettings.mutateAsync(buildSettingsInput({ currentProLabore: value }));

      // Mantém o custo fixo real coerente sem reescrever o passado: encerra a
      // recorrência antiga e cria um novo lançamento a partir deste mês.
      const activeRow = proLaboreRows.find((e: any) => e.recurrence === "monthly");
      if (activeRow && Number(activeRow.amount) !== value) {
        await supabase.from("expenses").update({ recurrence: "none" }).eq("id", activeRow.id);
        await supabase.from("expenses").insert({
          description: "Pró-labore Almir",
          category: "salarios",
          amount: value,
          due_date: monthDay10(),
          status: "pending",
          recurrence: "monthly",
          notes: "Reajustado pela escada do Plano Diretor",
        });
        invalidate();
      }
      toast.success(`Pró-labore atualizado para ${fmt(value)}`);
      setProLaboreModal(false);
    } catch (err: any) {
      toast.error(err.message || "Erro ao atualizar pró-labore");
    }
  };

  const applyTools = async () => {
    const value = parseFloat(toolsInput);
    if (!Number.isFinite(value) || value < 0) { toast.error("Informe um valor válido"); return; }
    if (!toolsRule) { toast.error("Regra de ferramentas não encontrada no backend"); return; }
    try {
      await upsertRecurringRule.mutateAsync({
        id: toolsRule.id,
        name: toolsRule.name,
        description: toolsRule.description,
        direction: "expense",
        category: toolsRule.category,
        amount: value,
        frequency: toolsRule.frequency,
        dueDay: toolsRule.dueDay,
        startsOn: toolsRule.startsOn,
        endsOn: toolsRule.endsOn,
        brand: toolsRule.brand,
        isActive: toolsRule.isActive,
      });
      toast.success(`Referência de ferramentas atualizada para ${fmt(value)}`);
      setToolsModal(false);
    } catch (err: any) {
      toast.error(err.message || "Erro ao atualizar referência");
    }
  };

  /**
   * Pagar é atômico no banco, de propósito.
   *
   * São dois atos que precisam acontecer juntos: registrar a saída real
   * do mês e rolar o vencimento do molde para o próximo. Se um deles
   * falhasse sozinho, o custo sumiria do caixa ou seria cobrado duas
   * vezes — por isso a chamada é um RPC, e não dois updates daqui.
   */
  const pagarCusto = async (e: any, proximo?: string) => {
    setPagando(e.id);
    try {
      const { data, error } = await (supabase as any).rpc("expense_pagar", {
        _expense_id: e.id,
        _pago_em: todayKey(),
        _valor: null,
        _proximo_vencimento: proximo ?? null,
      });
      if (error) throw new Error(error.message);
      const prox = new Date(`${data.proximo_vencimento}T12:00:00`).toLocaleDateString("pt-BR");
      toast.success(`${e.description} pago. Próximo vencimento: ${prox}.`);
      invalidate();
    } catch (err: any) {
      toast.error(err.message || "Não consegui registrar o pagamento");
    } finally {
      setPagando(null);
    }
  };

  const salvarVencimento = async () => {
    if (!vencModal?.due_date) return;
    const { error } = await supabase.from("expenses")
      .update({ due_date: vencModal.due_date }).eq("id", vencModal.id);
    if (error) return toast.error(error.message);
    toast.success("Vencimento atualizado");
    setVencModal(null);
    invalidate();
  };

  const launchExpense = async (kind: "tools" | "prolabore") => {
    const payload =
      kind === "tools"
        ? { description: "Ferramentas e sistemas", category: "ferramentas", amount: toolsReference, notes: "Custo compartilhado de IA e ferramentas" }
        : { description: "Pró-labore Almir", category: "salarios", amount: proLabore, notes: "Única retirada mensal do sócio único" };
    const { error } = await supabase.from("expenses").insert({
      ...payload,
      due_date: monthDay10(),
      status: "pending",
      recurrence: "monthly",
    });
    if (error) return toast.error(error.message);
    toast.success(`${payload.description} lançado como custo fixo mensal`);
    invalidate();
  };

  return (
    <div className="space-y-5">
      {/* As três leituras, em faixa. No telefone corre para o lado. */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-hidden">
        {ABAS.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => setAba(x.id)}
            className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[11.5px] font-semibold transition-colors ${
              aba === x.id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            <x.icone className="h-3.5 w-3.5" /> {x.rotulo}
          </button>
        ))}
      </div>

      {aba === "tributaria" && <AreaTributaria brutoRecebidoNoMes={grossReceivedThisMonth} />}

      {aba === "prolabore" && (
        <div className="space-y-4">
          {/* A soma que o dono pediu: quanto a estrutura custa HOJE e
              quanto custaria no pró-labore proporcional à receita. Ver os
              dois lado a lado é o que torna a decisão possível — o número
              proporcional sozinho não diz o que ele faz com o total. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              {
                label: "Custos fixos (sem pró-labore)",
                value: fmt(fixedWithoutProLabore),
                sub: `${recurringExpenses.length - proLaboreRows.length} lançamentos`,
                color: "text-warning",
              },
              {
                label: "Estrutura com pró-labore atual",
                value: fmt(fixedWithoutProLabore + proLabore),
                sub: `pró-labore de ${fmt(proLabore)}`,
                color: "text-foreground",
              },
              {
                label: "Estrutura com o proporcional",
                value: fmt(fixedWithoutProLabore + suggested),
                sub: `proporcional de ${fmt(suggested)} sobre ${fmt(monthlyOperationalRevenue)}`,
                color: suggested > proLabore ? "text-success" : "text-info",
              },
            ].map((c) => (
              <div key={c.label} className="rounded-xl border border-border bg-card p-4">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{c.label}</p>
                <p className={`mt-1 font-mono text-lg font-semibold ${c.color}`}>{c.value}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">{c.sub}</p>
              </div>
            ))}
          </div>

          {suggested !== proLabore && (
            <div className="rounded-xl border border-border bg-secondary/40 p-4">
              <p className="text-[12px] text-foreground">
                A escada indica <strong className="font-mono">{fmt(suggested)}</strong> para uma receita
                operacional de {fmt(monthlyOperationalRevenue)} · hoje você retira{" "}
                <strong className="font-mono">{fmt(proLabore)}</strong>.
                A diferença de <strong className="font-mono">{fmt(Math.abs(suggested - proLabore))}</strong>
                {" "}{suggested > proLabore ? "cabe" : "excede"} no mês.
              </p>
              <button
                onClick={() => { setProLaboreInput(String(suggested)); setProLaboreModal(true); }}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-3 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
              >
                <Pencil className="h-3 w-3" /> Ajustar para {fmt(suggested)}
              </button>
            </div>
          )}
        </div>
      )}

      {aba === "custos" && (
      <>
      {/* Cards resumo */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Custos fixos / mês", value: fmt(fixedWithoutProLabore), sub: `${recurringExpenses.length} lançamentos recorrentes`, color: "text-warning" },
          { label: "Pró-labore atual", value: fmt(proLabore), sub: `Alvo no estágio 100k: ${fmt(targetProLabore)}`, color: "text-foreground" },
          { label: "Ferramentas (referência)", value: fmt(toolsReference), sub: "Editável · Plano Diretor: R$ 2.500", color: "text-info" },
          { label: "Estrutura total / mês", value: fmt(fixedWithoutProLabore + proLabore), sub: "Custos fixos + pró-labore", color: "text-primary" },
        ].map((s) => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</p>
            <p className={`text-lg font-mono font-semibold mt-1 ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Pró-labore pela escada */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-2">
            <PiggyBank className="w-3.5 h-3.5 text-success" /> Pró-labore · escada do Plano Diretor
          </p>
          <button
            onClick={() => { setProLaboreInput(String(suggested !== proLabore ? suggested : proLabore)); setProLaboreModal(true); }}
            className="text-[11px] px-3 py-1.5 rounded-lg bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer border border-border flex items-center gap-1.5"
          >
            <Pencil className="w-3 h-3" /> Ajustar pró-labore
          </button>
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-2xl font-mono font-semibold text-foreground">{fmt(proLabore)}</span>
          {suggested !== proLabore && (
            <span className={`text-[12px] px-2.5 py-1 rounded-full ${suggested > proLabore ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
              Proporcional à receita: {fmt(suggested)}
            </span>
          )}
          {suggested === proLabore && (
            <span className="text-[12px] px-2.5 py-1 rounded-full bg-success/15 text-success flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Alinhado à escada
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Base: {fmt(monthlyOperationalRevenue)} de receita operacional.
          {" "}{nextTier ? `Próximo degrau: ${fmt(nextTier.proLabore)} ao atingir ${fmt(nextTier.revenue)}.` : "Topo da escada atingido."}
          {" "}Abaixo de R$ 10 mil o valor acompanha proporcionalmente o que entra; entre degraus soma a diferença proporcional. O reajuste nunca é automático · sempre exige a sua confirmação aqui.
        </p>
        <div className="flex gap-1 overflow-x-auto scrollbar-hidden pb-1">
          {PRO_LABORE_LADDER.map((t) => (
            <div
              key={t.revenue}
              className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-center ${
                monthlyOperationalRevenue >= t.revenue ? "border-success/40 bg-success/10" : "border-border bg-secondary/30"
              }`}
            >
              <p className="text-[9px] text-muted-foreground font-mono">{t.revenue >= 1000000 ? "R$ 1M" : `R$ ${Math.round(t.revenue / 1000)}k`}</p>
              <p className={`text-[11px] font-mono font-medium ${monthlyOperationalRevenue >= t.revenue ? "text-success" : "text-muted-foreground"}`}>
                {fmt(t.proLabore)}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Garantias do Plano Diretor */}
      {(!hasToolsExpense || proLaboreRows.length === 0) && (
        <div className="bg-secondary/30 border border-border rounded-xl p-4 space-y-2">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Sugestões do Plano Diretor</p>
          {!hasToolsExpense && (
            <div className="flex items-center gap-3 flex-wrap">
              <Wrench className="w-3.5 h-3.5 text-info shrink-0" />
              <p className="text-[12px] text-muted-foreground flex-1">Ferramentas e sistemas ({fmt(toolsReference)}/mês) ainda não estão lançados como custo fixo real.</p>
              <button onClick={() => launchExpense("tools")} className="text-[11px] px-3 py-1.5 rounded-lg bg-info/10 text-info hover:bg-info/20 transition-colors cursor-pointer border-none">
                Lançar {fmt(toolsReference)}/mês
              </button>
            </div>
          )}
          {proLaboreRows.length === 0 && (
            <div className="flex items-center gap-3 flex-wrap">
              <PiggyBank className="w-3.5 h-3.5 text-success shrink-0" />
              <p className="text-[12px] text-muted-foreground flex-1">O pró-labore de {fmt(proLabore)} ainda não aparece como saída recorrente no fluxo de caixa.</p>
              <button onClick={() => launchExpense("prolabore")} className="text-[11px] px-3 py-1.5 rounded-lg bg-success/10 text-success hover:bg-success/20 transition-colors cursor-pointer border-none">
                Lançar {fmt(proLabore)}/mês
              </button>
            </div>
          )}
        </div>
      )}

      {/* Lista de custos fixos reais */}
      <div className="space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Scale className="w-3.5 h-3.5 text-warning" />
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
              Custos recorrentes ({recurringExpenses.length})
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { setToolsInput(String(toolsReference)); setToolsModal(true); }}
              className="text-[11px] px-3 py-1.5 rounded-lg bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer border border-border"
            >
              Editar referência de ferramentas
            </button>
            <button
              onClick={() => setCostModal({ description: "", category: "ferramentas", amount: "", due_date: todayKey(), recurrence: "monthly", status: "pending" })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none"
            >
              <Plus className="w-3 h-3" /> Novo custo fixo
            </button>
          </div>
        </div>

        {recurringExpenses.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-6">
            Nenhum custo fixo cadastrado. Vá adicionando conforme os custos forem entrando · eles passam a contar no fluxo de caixa e no resultado global automaticamente.
          </p>
        )}

        {recurringExpenses.map((e: any) => (
          <div key={e.id} className="bg-card border border-border rounded-xl px-4 sm:px-5 py-3 flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {e.description}
                {isProLaboreExpense(e) && <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded-full bg-success/10 text-success align-middle">Pró-labore</span>}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {catLabel(e.category)} · {e.recurrence === "monthly" ? "Mensal" : "Anual"}
              </p>
              {/* O vencimento em destaque, com o atraso dito em dias: "vence
                  dia 10" não avisa nada em dia 23. */}
              {(() => {
                const dias = diasAteVencer(e.due_date, todayKey());
                const venc = new Date(`${e.due_date}T12:00:00`).toLocaleDateString("pt-BR");
                return (
                  <button
                    onClick={() => setVencModal({ id: e.id, description: e.description, due_date: e.due_date })}
                    title="Alterar a data de vencimento"
                    className={`mt-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium transition-colors ${
                      dias < 0 ? "bg-destructive/15 text-destructive hover:bg-destructive/25"
                        : dias <= 3 ? "bg-warning/15 text-warning hover:bg-warning/25"
                        : "bg-secondary text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <CalendarDays className="h-3 w-3" />
                    vence {venc}
                    {dias < 0 ? ` · ${Math.abs(dias)}d em atraso` : dias === 0 ? " · hoje" : ` · em ${dias}d`}
                  </button>
                );
              })()}
            </div>
            <p className="text-sm font-mono font-medium text-foreground whitespace-nowrap">
              {fmt(Number(e.amount))}{e.recurrence === "yearly" && <span className="text-[10px] text-muted-foreground">/ano</span>}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {/* Pagar: registra a saída real e já mostra o próximo mês. */}
              <button
                onClick={() => pagarCusto(e)}
                disabled={pagando === e.id}
                title={`Registrar pagamento e rolar para ${new Date(`${proximoVencimento(e.due_date, e.recurrence === "yearly" ? "yearly" : "monthly")}T12:00:00`).toLocaleDateString("pt-BR")}`}
                className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-1 text-[11px] font-semibold text-success transition-colors hover:bg-success/25 disabled:opacity-50"
              >
                {pagando === e.id
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <Wallet className="h-3 w-3" />}
                Pagar
              </button>
              <button
                onClick={() => setCostModal({ ...e, amount: String(e.amount) })}
                className="text-[11px] px-2.5 py-1 rounded-full bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer border-none"
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                onClick={() => endRecurrence(e)}
                title="Encerrar recorrência (mantém o histórico)"
                className="text-[11px] px-2.5 py-1 rounded-full bg-warning/10 text-warning hover:bg-warning/20 transition-colors cursor-pointer border-none"
              >
                <XCircle className="w-3 h-3" />
              </button>
              <button
                onClick={() => setConfirmDel(e)}
                className="text-[11px] px-2.5 py-1 rounded-full bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors cursor-pointer border-none"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* O histórico das saídas já pagas, com rolagem própria. Sem ela,
          doze meses de pagamentos empurram a lista de custos para fora
          da tela — e a lista é o que o dono veio ver. */}
      {historico.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <Receipt className="h-3.5 w-3.5 text-success" /> Histórico de pagamentos ({historico.length})
          </p>
          <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
            {historico.map((h: any) => (
              <div key={h.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">{h.description}</span>
                <span className="text-[10.5px] text-muted-foreground">
                  venc. {new Date(`${h.due_date}T12:00:00`).toLocaleDateString("pt-BR")}
                </span>
                <span className="text-[10.5px] text-success">
                  pago {h.paid_date ? new Date(`${h.paid_date}T12:00:00`).toLocaleDateString("pt-BR") : "—"}
                </span>
                <span className="whitespace-nowrap font-mono text-[12px] font-medium text-foreground">
                  {fmt(Number(h.amount))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      </>
      )}

      {/* Modal de vencimento */}
      <Dialog open={!!vencModal} onOpenChange={() => setVencModal(null)}>
        <DialogContent className="max-w-sm border-border bg-card">
          <DialogHeader><DialogTitle className="text-foreground">Alterar vencimento</DialogTitle></DialogHeader>
          {vencModal && (
            <div className="space-y-3">
              <p className="text-[12px] text-muted-foreground">{vencModal.description}</p>
              <div>
                <label className="text-xs text-muted-foreground">Vence em</label>
                <Input
                  type="date"
                  value={vencModal.due_date}
                  onChange={(e) => setVencModal((f: any) => ({ ...f, due_date: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Muda só o próximo vencimento deste custo. Os pagamentos já registrados
                continuam com a data em que aconteceram.
              </p>
              <button
                onClick={salvarVencimento}
                className="w-full rounded-lg bg-primary px-3 py-2 text-[12px] font-semibold text-primary-foreground"
              >
                Salvar vencimento
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal novo/editar custo */}
      <Dialog open={!!costModal} onOpenChange={() => setCostModal(null)}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader><DialogTitle className="text-foreground">{costModal?.id ? "Editar custo fixo" : "Novo custo fixo"}</DialogTitle></DialogHeader>
          {costModal && (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Descrição</label>
                <Input value={costModal.description} onChange={(e) => setCostModal((f: any) => ({ ...f, description: e.target.value }))} className="mt-1" placeholder="Ex: Contabilidade" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Categoria</label>
                  <select
                    value={costModal.category}
                    onChange={(e) => setCostModal((f: any) => ({ ...f, category: e.target.value }))}
                    className="w-full mt-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground"
                  >
                    {FIXED_COST_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Valor (R$)</label>
                  <Input type="number" step="0.01" value={costModal.amount} onChange={(e) => setCostModal((f: any) => ({ ...f, amount: e.target.value }))} className="mt-1" placeholder="0.00" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Primeiro vencimento</label>
                  <Input type="date" value={costModal.due_date} onChange={(e) => setCostModal((f: any) => ({ ...f, due_date: e.target.value }))} className="mt-1" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Recorrência</label>
                  <select
                    value={costModal.recurrence}
                    onChange={(e) => setCostModal((f: any) => ({ ...f, recurrence: e.target.value }))}
                    className="w-full mt-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground"
                  >
                    <option value="monthly">Mensal</option>
                    <option value="yearly">Anual</option>
                  </select>
                </div>
              </div>
              <button onClick={saveCost} className="w-full py-2.5 rounded-xl text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none">
                {costModal.id ? "Salvar" : "Registrar custo fixo"}
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal pró-labore */}
      <Dialog open={proLaboreModal} onOpenChange={setProLaboreModal}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader><DialogTitle className="text-foreground">Ajustar pró-labore</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="bg-secondary/50 rounded-lg p-3 space-y-1">
              <p className="text-[12px] text-muted-foreground">Atual: <span className="font-mono text-foreground">{fmt(proLabore)}</span></p>
              <p className="text-[12px] text-muted-foreground">Proporcional pela escada ({fmt(monthlyOperationalRevenue)} operacionais): <span className="font-mono text-success">{fmt(suggested)}</span></p>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Novo valor mensal (R$)</label>
              <Input type="number" step="0.01" value={proLaboreInput} onChange={(e) => setProLaboreInput(e.target.value)} className="mt-1" />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Ao confirmar: a configuração é atualizada e, se houver pró-labore lançado como custo recorrente, a recorrência antiga é encerrada e um novo lançamento entra a partir deste mês. Meses já pagos não mudam.
            </p>
            <button
              onClick={applyProLabore}
              disabled={updateSettings.isPending}
              className="w-full py-2.5 rounded-xl text-[13px] font-medium bg-success text-success-foreground hover:opacity-90 transition-opacity cursor-pointer border-none disabled:opacity-50"
            >
              Confirmar novo pró-labore
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal referência ferramentas */}
      <Dialog open={toolsModal} onOpenChange={setToolsModal}>
        <DialogContent className="bg-card border-border max-w-sm">
          <DialogHeader><DialogTitle className="text-foreground">Referência de ferramentas e sistemas</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Valor mensal (R$)</label>
              <Input type="number" step="0.01" value={toolsInput} onChange={(e) => setToolsInput(e.target.value)} className="mt-1" />
            </div>
            <p className="text-[11px] text-muted-foreground">Custo compartilhado de IA e ferramentas de toda a operação. O Plano Diretor trava esse valor em R$ 2.500 até R$ 25 mil de receita.</p>
            <button
              onClick={applyTools}
              disabled={upsertRecurringRule.isPending}
              className="w-full py-2.5 rounded-xl text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none disabled:opacity-50"
            >
              Salvar referência
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmação de exclusão */}
      <Dialog open={!!confirmDel} onOpenChange={() => setConfirmDel(null)}>
        <DialogContent className="bg-card border-border max-w-sm">
          <DialogHeader><DialogTitle className="text-foreground">Remover custo fixo?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            "{confirmDel?.description}" será removido do fluxo de caixa. Se ele já teve meses pagos, prefira <span className="text-warning">encerrar a recorrência</span> para preservar o histórico.
          </p>
          <div className="flex gap-2">
            <button onClick={() => setConfirmDel(null)} className="flex-1 py-2 rounded-lg text-[12px] bg-secondary text-muted-foreground border border-border cursor-pointer">Cancelar</button>
            <button onClick={() => deleteCost(confirmDel)} className="flex-1 py-2 rounded-lg text-[12px] bg-destructive/15 text-destructive border-none cursor-pointer">Remover</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
