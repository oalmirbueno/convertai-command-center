import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Plus, Pencil, PiggyBank, Wrench, Scale, CheckCircle2, XCircle, Trash2,
  CalendarDays, Landmark, Loader2, Wallet, SlidersHorizontal,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useFinanceSettings, useFinanceRecurringRules, useFinanceMutations } from "@/hooks/useFinanceV2";
import { interpolateProLabore, nextProLaboreTier, PRO_LABORE_LADDER } from "@/lib/directorPlan";
import AreaTributaria from "@/components/finance/AreaTributaria";
// Frente CFO (30/09): a trava do limite do mês nos custos fixos novos.
import { useTravaDeGasto } from "@/components/cfo/TravaDeGasto";
import { custoMensal, diasAteVencer, proximoVencimento } from "@/lib/tributos";
import {
  CampoDeFormulario, Carregando, EstadoDeErro, EstadoVazio, GrupoDeCampos, RegiaoRolavel, Secao, SeletorCompacto,
  botao, campo, juntar, superficie, texto, useEstadoDaTela,
} from "@/components/sistema";
import { AcoesDoDialogo, Etiqueta, GradeDeKpis, Kpi, botaoDeLinha } from "@/components/finance/pecasDoFinanceiro";
import { ABAS_DOS_CUSTOS, CHAVE_DA_ABA_DOS_CUSTOS, validarAbaDosCustos, type AbaDosCustos } from "@/components/finance/abasDosCustos";

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
const dataBr = (v?: string | null) => (v ? new Date(`${v}T12:00:00`).toLocaleDateString("pt-BR") : "-");

interface Props {
  /** Receita operacional de referência do mês (para a sugestão de pró-labore). */
  monthlyOperationalRevenue: number;
  /** Bruto recebido no mês: é sobre ele que a alíquota incide. */
  grossReceivedThisMonth?: number;
  /**
   * Leitura escolhida por fora (o seletor mora na linha do título da página,
   * AdminFinanceiro). Sem estas props, o seletor aparece aqui, como antes.
   */
  aba?: AbaDosCustos;
  onAba?: (aba: AbaDosCustos) => void;
}

/* As três leituras desta área (abasDosCustos.ts). */
const ABAS = ABAS_DOS_CUSTOS;

export default function FixedCosts({ monthlyOperationalRevenue, grossReceivedThisMonth = 0, aba: abaDeFora, onAba }: Props) {
  const [abaPropria, setAbaPropria] = useEstadoDaTela<AbaDosCustos>(CHAVE_DA_ABA_DOS_CUSTOS, "custos", {
    validar: validarAbaDosCustos,
  });
  const seletorDeFora = abaDeFora !== undefined && !!onAba;
  const aba = seletorDeFora ? abaDeFora : abaPropria;
  const setAba = seletorDeFora ? onAba : setAbaPropria;
  const [pagando, setPagando] = useState<string | null>(null);
  const [vencModal, setVencModal] = useState<any | null>(null);
  const qc = useQueryClient();
  const { pedirLiberacao, janela: janelaDaTrava } = useTravaDeGasto("custos_fixos");
  const { data: settings } = useFinanceSettings();
  const { data: rules } = useFinanceRecurringRules();
  const { updateSettings, upsertRecurringRule } = useFinanceMutations();

  const [costModal, setCostModal] = useState<any | null>(null);
  const [proLaboreModal, setProLaboreModal] = useState(false);
  const [proLaboreInput, setProLaboreInput] = useState("");
  const [toolsModal, setToolsModal] = useState(false);
  const [toolsInput, setToolsInput] = useState("");
  const [confirmDel, setConfirmDel] = useState<any | null>(null);

  const { data: allExpenses = [], isLoading: carregando, error: erroDasDespesas, refetch } = useQuery({
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
    // Custo fixo novo passa pela trava do CFO: o que se repete conta todo mês.
    if (!form.id) {
      const liberado = await pedirLiberacao({ valor: payload.amount, recorrente: payload.recurrence === "monthly", categoria: payload.category, descricao: payload.description });
      if (!liberado) {
        toast.info("Não lancei: ficou dentro do limite do CFO.");
        return;
      }
    }
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
   * vezes. Por isso a chamada é um RPC, e não dois updates daqui.
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

  // Esqueleto só na primeira carga: depois, o dado velho fica na tela enquanto relê.
  const primeiraCarga = carregando && (allExpenses || []).length === 0;

  return (
    <div className="min-w-0 space-y-6">
      {janelaDaTrava}
      {/* As três leituras: três opções, controle segmentado (lembra ao voltar). Com o seletor por fora, ele mora no título da página. */}
      {!seletorDeFora && (
        <SeletorCompacto
          opcoes={ABAS.map((x) => ({ valor: x.id, rotulo: x.rotulo, icone: <x.icone className="h-3.5 w-3.5" /> }))}
          valor={aba}
          onEscolher={(v) => setAba(v as AbaDosCustos)}
          rotulo="Leitura dos custos"
          modo="segmentado"
          className="w-full sm:w-[420px]"
          larguraTotal
        />
      )}

      {aba === "tributaria" && <AreaTributaria brutoRecebidoNoMes={grossReceivedThisMonth} />}

      {aba === "prolabore" && (
        <div className="min-w-0 space-y-6">
          {/* A soma que o dono pediu: quanto a estrutura custa HOJE e
              quanto custaria no pró-labore proporcional à receita. Ver os
              dois lado a lado é o que torna a decisão possível: o número
              proporcional sozinho não diz o que ele faz com o total. */}
          <Secao
            titulo="Estrutura e pró-labore"
            ajuda="Quanto a estrutura custa hoje e quanto custaria com o pró-labore proporcional à receita operacional, lado a lado."
          >
            <GradeDeKpis colunas={3}>
              <Kpi
                rotulo="Custos fixos (sem pró-labore)"
                valor={fmt(fixedWithoutProLabore)}
                apoio={`${recurringExpenses.length - proLaboreRows.length} lançamentos`}
                tom="aviso"
              />
              <Kpi
                rotulo="Estrutura com pró-labore atual"
                valor={fmt(fixedWithoutProLabore + proLabore)}
                apoio={`pró-labore de ${fmt(proLabore)}`}
              />
              <Kpi
                rotulo="Estrutura com o proporcional"
                valor={fmt(fixedWithoutProLabore + suggested)}
                apoio={`proporcional de ${fmt(suggested)} sobre ${fmt(monthlyOperationalRevenue)}`}
                tom={suggested > proLabore ? "sucesso" : "info"}
              />
            </GradeDeKpis>
          </Secao>

          {suggested !== proLabore && (
            <div className={juntar(superficie.poco, "flex min-w-0 flex-wrap items-center px-3.5 py-3")}>
              <p className="mr-3 min-w-0 flex-1 py-1 text-[13px] leading-5 text-foreground">
                A escada indica <strong className="font-semibold tabular-nums">{fmt(suggested)}</strong> para {fmt(monthlyOperationalRevenue)} operacionais.
                Hoje você retira <strong className="font-semibold tabular-nums">{fmt(proLabore)}</strong>. A diferença de{" "}
                <strong className="font-semibold tabular-nums">{fmt(Math.abs(suggested - proLabore))}</strong>
                {" "}{suggested > proLabore ? "cabe" : "excede"} no mês.
              </p>
              <button
                type="button"
                onClick={() => { setProLaboreInput(String(suggested)); setProLaboreModal(true); }}
                className={botao.secundario}
              >
                <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Ajustar para {fmt(suggested)}
              </button>
            </div>
          )}
        </div>
      )}

      {aba === "custos" && (
        <div className="min-w-0 space-y-6">
          <GradeDeKpis>
            <Kpi rotulo="Custos fixos / mês" valor={fmt(fixedWithoutProLabore)} apoio={`${recurringExpenses.length} recorrentes`} tom="aviso" />
            <Kpi rotulo="Pró-labore atual" valor={fmt(proLabore)} apoio={`Alvo no estágio 100k: ${fmt(targetProLabore)}`} />
            <Kpi rotulo="Ferramentas (referência)" valor={fmt(toolsReference)} apoio="Plano Diretor: R$ 2.500" tom="info" ajuda="Custo compartilhado de IA e ferramentas. Editável em Referência de ferramentas." />
            <Kpi rotulo="Estrutura total / mês" valor={fmt(fixedWithoutProLabore + proLabore)} apoio="Custos fixos + pró-labore" tom="primario" />
          </GradeDeKpis>

          {/* Pró-labore pela escada */}
          <Secao
            divisoria
            titulo="Pró-labore pela escada"
            descricao={nextTier ? `Próximo degrau: ${fmt(nextTier.proLabore)} ao atingir ${fmt(nextTier.revenue)}` : "Topo da escada atingido"}
            ajuda={
              <>
                Base: {fmt(monthlyOperationalRevenue)} de receita operacional. Abaixo de R$ 10 mil o valor acompanha proporcionalmente
                o que entra; entre degraus soma a diferença proporcional. O reajuste nunca é automático: sempre exige a sua confirmação aqui.
              </>
            }
            acao={
              <button
                type="button"
                onClick={() => { setProLaboreInput(String(suggested !== proLabore ? suggested : proLabore)); setProLaboreModal(true); }}
                className={botao.secundario}
                aria-label="Ajustar pró-labore"
              >
                <Pencil className="h-3.5 w-3.5 sm:mr-1.5" aria-hidden="true" />
                <span className="hidden sm:inline">Ajustar pró-labore</span>
              </button>
            }
          >
            <div className="-mb-1 flex min-w-0 flex-wrap items-center [&>*]:mb-1">
              <span className="mr-3 text-[24px] font-semibold leading-8 tabular-nums text-foreground">{fmt(proLabore)}</span>
              {suggested !== proLabore && (
                <Etiqueta tom={suggested > proLabore ? "sucesso" : "aviso"}>Proporcional à receita: {fmt(suggested)}</Etiqueta>
              )}
              {suggested === proLabore && (
                <Etiqueta tom="sucesso">
                  <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden="true" /> Alinhado à escada
                </Etiqueta>
              )}
            </div>
            <ul className="mt-3 flex min-w-0 overflow-x-auto pb-1 scrollbar-hidden [&>*+*]:ml-1" aria-label="Degraus da escada">
              {PRO_LABORE_LADDER.map((t) => {
                const atingido = monthlyOperationalRevenue >= t.revenue;
                return (
                  <li
                    key={t.revenue}
                    className={juntar(
                      "shrink-0 rounded-md px-2.5 py-1.5 text-center",
                      atingido ? "bg-success/10" : "bg-muted/50",
                    )}
                  >
                    <p className="text-[11px] tabular-nums text-muted-foreground">{t.revenue >= 1000000 ? "R$ 1M" : `R$ ${Math.round(t.revenue / 1000)}k`}</p>
                    <p className={juntar("text-[12px] font-medium tabular-nums", atingido ? "text-success" : "text-muted-foreground")}>{fmt(t.proLabore)}</p>
                  </li>
                );
              })}
            </ul>
          </Secao>

          {/* Garantias do Plano Diretor */}
          {(!hasToolsExpense || proLaboreRows.length === 0) && (
            <Secao divisoria titulo="Sugestões do Plano Diretor">
              <ul className="divide-y divide-border">
                {!hasToolsExpense && (
                  <li className="flex min-w-0 flex-wrap items-center py-2.5">
                    <Wrench className="mr-2.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
                    <p className="mr-3 min-w-0 flex-1 text-[13px] leading-5 text-muted-foreground">
                      Ferramentas e sistemas (<span className="tabular-nums">{fmt(toolsReference)}</span>/mês) ainda não estão lançados como custo fixo.
                    </p>
                    <button type="button" onClick={() => launchExpense("tools")} className={juntar(botaoDeLinha, "my-1")}>
                      Lançar {fmt(toolsReference)}/mês
                    </button>
                  </li>
                )}
                {proLaboreRows.length === 0 && (
                  <li className="flex min-w-0 flex-wrap items-center py-2.5">
                    <PiggyBank className="mr-2.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                    <p className="mr-3 min-w-0 flex-1 text-[13px] leading-5 text-muted-foreground">
                      O pró-labore de <span className="tabular-nums">{fmt(proLabore)}</span> ainda não é saída recorrente no fluxo.
                    </p>
                    <button type="button" onClick={() => launchExpense("prolabore")} className={juntar(botaoDeLinha, "my-1")}>
                      Lançar {fmt(proLabore)}/mês
                    </button>
                  </li>
                )}
              </ul>
            </Secao>
          )}

          {/* Lista de custos fixos reais */}
          <Secao
            divisoria
            titulo="Custos recorrentes"
            descricao={`${recurringExpenses.length} ${recurringExpenses.length === 1 ? "custo" : "custos"}`}
            ajuda="Os custos que entram todo mês (ou todo ano, rateado por doze). Contam no fluxo de caixa e no resultado global automaticamente. Pagar registra a saída real e rola o vencimento."
            acao={
              <>
                <button
                  type="button"
                  onClick={() => { setToolsInput(String(toolsReference)); setToolsModal(true); }}
                  className={botao.secundario}
                  aria-label="Editar referência de ferramentas"
                  title="Editar referência de ferramentas"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5 sm:mr-1.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Referência de ferramentas</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCostModal({ description: "", category: "ferramentas", amount: "", due_date: todayKey(), recurrence: "monthly", status: "pending" })}
                  className={botao.primario}
                  aria-label="Novo custo fixo"
                >
                  <Plus className="h-3.5 w-3.5 sm:mr-1.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Novo custo fixo</span>
                </button>
              </>
            }
          >
            {erroDasDespesas ? (
              <EstadoDeErro
                titulo="Não consegui ler os custos."
                acao={<button type="button" onClick={() => refetch()} className={botao.secundario}>Tentar de novo</button>}
              />
            ) : primeiraCarga ? (
              <Carregando linhas={4} rotulo="Carregando custos" />
            ) : recurringExpenses.length === 0 ? (
              <EstadoVazio
                compacto
                titulo="Nenhum custo fixo cadastrado."
                descricao="Eles passam a contar no fluxo de caixa assim que entram."
              />
            ) : (
              <RegiaoRolavel memoria="financeiro:custos:lista" rotulo="Custos recorrentes" className="lg:max-h-[70vh]">
                <ul className="divide-y divide-border">
                  {recurringExpenses.map((e: any) => {
                    // O vencimento em destaque, com o atraso dito em dias:
                    // "vence dia 10" não avisa nada em dia 23.
                    const dias = diasAteVencer(e.due_date, todayKey());
                    const venc = dataBr(e.due_date);
                    return (
                      <li key={e.id} className="flex min-w-0 flex-wrap items-center py-2.5">
                        <div className="mr-3 min-w-0 flex-1 basis-56">
                          <p className="flex min-w-0 items-center text-[13px] font-medium text-foreground">
                            <span className="min-w-0 truncate">{e.description}</span>
                            {isProLaboreExpense(e) && <Etiqueta tom="sucesso" className="ml-2">Pró-labore</Etiqueta>}
                          </p>
                          <div className="mt-0.5 flex min-w-0 flex-wrap items-center">
                            <span className={juntar(texto.auxiliar, "mr-2 truncate")}>
                              {catLabel(e.category)} · {e.recurrence === "monthly" ? "Mensal" : "Anual"}
                            </span>
                            <button
                              type="button"
                              onClick={() => setVencModal({ id: e.id, description: e.description, due_date: e.due_date })}
                              title="Alterar a data de vencimento"
                              className={juntar(
                                "inline-flex h-5 items-center rounded px-1.5 text-[11px] font-medium tabular-nums transition-colors",
                                dias < 0 ? "bg-destructive/15 text-destructive hover:bg-destructive/25"
                                  : dias <= 3 ? "bg-warning/15 text-warning hover:bg-warning/25"
                                    : "bg-muted text-muted-foreground hover:text-foreground",
                              )}
                            >
                              <CalendarDays className="mr-1 h-3 w-3" aria-hidden="true" />
                              vence {venc}
                              {dias < 0 ? ` · ${Math.abs(dias)}d em atraso` : dias === 0 ? " · hoje" : ` · em ${dias}d`}
                            </button>
                          </div>
                        </div>
                        <div className="ml-auto flex shrink-0 items-center py-1">
                          <p className="mr-3 whitespace-nowrap text-right text-[13px] font-semibold tabular-nums text-foreground">
                            {fmt(Number(e.amount))}{e.recurrence === "yearly" && <span className="text-[11px] font-normal text-muted-foreground">/ano</span>}
                          </p>
                          {/* Pagar: registra a saída real e já mostra o próximo mês. */}
                          <button
                            type="button"
                            onClick={() => pagarCusto(e)}
                            disabled={pagando === e.id}
                            title={`Registrar pagamento e rolar para ${dataBr(proximoVencimento(e.due_date, e.recurrence === "yearly" ? "yearly" : "monthly"))}`}
                            className={juntar(botaoDeLinha, "border-success/40 text-success hover:bg-success/10")}
                          >
                            {pagando === e.id
                              ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                              : <Wallet className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
                            Pagar
                          </button>
                          <button type="button" onClick={() => setCostModal({ ...e, amount: String(e.amount) })} className={juntar(botao.icone, "ml-1")} aria-label={`Editar ${e.description}`} title="Editar">
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => endRecurrence(e)}
                            title="Encerrar recorrência (mantém o histórico)"
                            aria-label={`Encerrar recorrência de ${e.description}`}
                            className={juntar(botao.icone, "hover:text-warning")}
                          >
                            <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <button type="button" onClick={() => setConfirmDel(e)} className={juntar(botao.icone, "hover:text-destructive")} aria-label={`Remover ${e.description}`} title="Remover">
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </RegiaoRolavel>
            )}
          </Secao>

          {/* O histórico das saídas já pagas, com rolagem própria no
              computador. Sem ela, doze meses de pagamentos empurram a
              lista de custos para fora da tela, e a lista é o que o dono
              veio ver. */}
          {historico.length > 0 && (
            <Secao divisoria titulo="Histórico de pagamentos" descricao={`${historico.length} ${historico.length === 1 ? "pagamento" : "pagamentos"}`}>
              <RegiaoRolavel memoria="financeiro:custos:historico" rotulo="Histórico de pagamentos" className="lg:max-h-[360px]">
                <ul className="divide-y divide-border">
                  {historico.map((h: any) => (
                    <li key={h.id} className="flex min-w-0 flex-wrap items-center py-2">
                      <span className="mr-3 min-w-0 flex-1 basis-40 truncate text-[13px] text-foreground">{h.description}</span>
                      <span className={juntar(texto.auxiliar, "mr-3 tabular-nums")}>venc. {dataBr(h.due_date)}</span>
                      <span className="mr-3 text-[12px] tabular-nums text-success">pago {h.paid_date ? dataBr(h.paid_date) : "-"}</span>
                      <span className="ml-auto whitespace-nowrap text-[13px] font-medium tabular-nums text-foreground">{fmt(Number(h.amount))}</span>
                    </li>
                  ))}
                </ul>
              </RegiaoRolavel>
            </Secao>
          )}
        </div>
      )}

      {/* Modal de vencimento */}
      <Dialog open={!!vencModal} onOpenChange={() => setVencModal(null)}>
        <DialogContent className="max-w-sm border-border bg-card">
          <DialogHeader><DialogTitle className="text-foreground">Alterar vencimento</DialogTitle></DialogHeader>
          {vencModal && (
            <div className="space-y-4">
              <GrupoDeCampos colunas={1}>
                <CampoDeFormulario rotulo="Vence em" apoio={vencModal.description} ajuda="Muda só o próximo vencimento deste custo. Os pagamentos já registrados continuam com a data em que aconteceram.">
                  <input
                    type="date"
                    value={vencModal.due_date}
                    onChange={(e) => setVencModal((f: any) => ({ ...f, due_date: e.target.value }))}
                    className={campo}
                  />
                </CampoDeFormulario>
              </GrupoDeCampos>
              <AcoesDoDialogo>
                <button type="button" onClick={() => setVencModal(null)} className={botao.discreto}>Cancelar</button>
                <button type="button" onClick={salvarVencimento} className={botao.primario}>Salvar vencimento</button>
              </AcoesDoDialogo>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal novo/editar custo */}
      <Dialog open={!!costModal} onOpenChange={() => setCostModal(null)}>
        <DialogContent className="max-w-md border-border bg-card">
          <DialogHeader><DialogTitle className="text-foreground">{costModal?.id ? "Editar custo fixo" : "Novo custo fixo"}</DialogTitle></DialogHeader>
          {costModal && (
            <div className="space-y-4">
              <GrupoDeCampos>
                <CampoDeFormulario rotulo="Descrição" obrigatorio largo>
                  <input value={costModal.description} onChange={(e) => setCostModal((f: any) => ({ ...f, description: e.target.value }))} className={campo} placeholder="Ex.: Contabilidade" />
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Categoria">
                  <select value={costModal.category} onChange={(e) => setCostModal((f: any) => ({ ...f, category: e.target.value }))} className={campo}>
                    {FIXED_COST_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Valor (R$)" obrigatorio>
                  <input type="number" step="0.01" inputMode="decimal" value={costModal.amount} onChange={(e) => setCostModal((f: any) => ({ ...f, amount: e.target.value }))} className={campo} placeholder="0,00" />
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Primeiro vencimento" obrigatorio>
                  <input type="date" value={costModal.due_date} onChange={(e) => setCostModal((f: any) => ({ ...f, due_date: e.target.value }))} className={campo} />
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Recorrência">
                  <select value={costModal.recurrence} onChange={(e) => setCostModal((f: any) => ({ ...f, recurrence: e.target.value }))} className={campo}>
                    <option value="monthly">Mensal</option>
                    <option value="yearly">Anual</option>
                  </select>
                </CampoDeFormulario>
              </GrupoDeCampos>
              <AcoesDoDialogo>
                <button type="button" onClick={() => setCostModal(null)} className={botao.discreto}>Cancelar</button>
                <button type="button" onClick={saveCost} className={botao.primario}>
                  {costModal.id ? "Salvar" : "Registrar custo fixo"}
                </button>
              </AcoesDoDialogo>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal pró-labore */}
      <Dialog open={proLaboreModal} onOpenChange={setProLaboreModal}>
        <DialogContent className="max-w-md border-border bg-card">
          <DialogHeader><DialogTitle className="text-foreground">Ajustar pró-labore</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <dl className={juntar(superficie.poco, "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-3 py-2.5 text-[13px]")}>
              <dt className="text-muted-foreground">Atual</dt>
              <dd className="text-right tabular-nums text-foreground">{fmt(proLabore)}</dd>
              <dt className="min-w-0 truncate text-muted-foreground">Proporcional ({fmt(monthlyOperationalRevenue)} operacionais)</dt>
              <dd className="text-right tabular-nums text-success">{fmt(suggested)}</dd>
            </dl>
            <GrupoDeCampos colunas={1}>
              <CampoDeFormulario
                rotulo="Novo valor mensal (R$)"
                ajuda="Ao confirmar, a configuração é atualizada e, se houver pró-labore lançado como custo recorrente, a recorrência antiga é encerrada e um novo lançamento entra a partir deste mês. Meses já pagos não mudam."
              >
                <input type="number" step="0.01" inputMode="decimal" value={proLaboreInput} onChange={(e) => setProLaboreInput(e.target.value)} className={campo} />
              </CampoDeFormulario>
            </GrupoDeCampos>
            <AcoesDoDialogo>
              <button type="button" onClick={() => setProLaboreModal(false)} className={botao.discreto}>Cancelar</button>
              <button type="button" onClick={applyProLabore} disabled={updateSettings.isPending} className={botao.primario}>
                Confirmar novo pró-labore
              </button>
            </AcoesDoDialogo>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal referência ferramentas */}
      <Dialog open={toolsModal} onOpenChange={setToolsModal}>
        <DialogContent className="max-w-sm border-border bg-card">
          <DialogHeader><DialogTitle className="text-foreground">Referência de ferramentas</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <GrupoDeCampos colunas={1}>
              <CampoDeFormulario
                rotulo="Valor mensal (R$)"
                ajuda="Custo compartilhado de IA e ferramentas de toda a operação. O Plano Diretor trava esse valor em R$ 2.500 até R$ 25 mil de receita."
              >
                <input type="number" step="0.01" inputMode="decimal" value={toolsInput} onChange={(e) => setToolsInput(e.target.value)} className={campo} />
              </CampoDeFormulario>
            </GrupoDeCampos>
            <AcoesDoDialogo>
              <button type="button" onClick={() => setToolsModal(false)} className={botao.discreto}>Cancelar</button>
              <button type="button" onClick={applyTools} disabled={upsertRecurringRule.isPending} className={botao.primario}>
                Salvar referência
              </button>
            </AcoesDoDialogo>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmação de exclusão */}
      <Dialog open={!!confirmDel} onOpenChange={() => setConfirmDel(null)}>
        <DialogContent className="max-w-sm border-border bg-card">
          <DialogHeader><DialogTitle className="text-foreground">Remover custo fixo?</DialogTitle></DialogHeader>
          <p className="text-[13px] leading-5 text-muted-foreground">
            "{confirmDel?.description}" sai do fluxo de caixa. Se já teve meses pagos, prefira <span className="text-warning">encerrar a recorrência</span> para preservar o histórico.
          </p>
          <AcoesDoDialogo>
            <button type="button" onClick={() => setConfirmDel(null)} className={botao.discreto}>Cancelar</button>
            <button type="button" onClick={() => deleteCost(confirmDel)} className={botao.perigo}>Remover</button>
          </AcoesDoDialogo>
        </DialogContent>
      </Dialog>
    </div>
  );
}
