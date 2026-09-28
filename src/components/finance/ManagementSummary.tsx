import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Wallet, PiggyBank, Target, Scale, TrendingUp, Landmark, Pencil, ChevronDown } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useFinanceSettings, useFinancePlans, useFinanceMutations } from "@/hooks/useFinanceV2";
import { DEFAULT_TAX_RATE, interpolateProLabore, nextProLaboreTier } from "@/lib/directorPlan";
import {
  AjudaRecolhida, CampoDeFormulario, GrupoDeCampos, Painel, Secao, useEstadoDaTela, botao, etiqueta, juntar, texto,
} from "@/components/sistema";

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
  // Aberto/recolhido fica guardado ao sair e voltar.
  const [panelOpen, setPanelOpen] = useEstadoDaTela("financeiro:divisao-aberta", true, { validar: (v) => typeof v === "boolean" });

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
  // sobra depois da estrutura · uma estimativa nunca joga a divisão pro negativo.
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

  const reservaCompleta = clientReserve >= clientReserveTarget - 0.005 && clientReserveTarget > 0;
  const estadoDaReserva = reservaCompleta
    ? `Completa · alvo ${fmt(clientReserveTarget)}`
    : clientReserve > 0
      ? `Parcial · faltam ${fmt(clientReserveTarget - clientReserve)} do alvo ${fmt(clientReserveTarget)}`
      : `Sem sobra ainda · alvo ${fmt(clientReserveTarget)}`;

  // Barra única: como o dinheiro que entrou se divide (alocação em ordem de prioridade)
  let restante = Math.max(operationalReceived, 0);
  const alocar = (target: number) => {
    const v = Math.min(restante, Math.max(target, 0));
    restante -= v;
    return v;
  };
  const fixosAlloc = alocar(fixedCostsValue);
  const plAlloc = alocar(proLaboreProp);
  const reservaAlloc = alocar(clientReserveTarget);
  const lucroAlloc = restante;
  const uncovered = fixedCostsValue + proLaboreProp - (fixosAlloc + plAlloc);
  const segs = [
    { label: "Reserva tributária", value: taxReserve, cls: "bg-info" },
    { label: "Custos fixos", value: fixosAlloc, cls: "bg-warning" },
    { label: "Pró-labore", value: plAlloc, cls: "bg-primary" },
    { label: "Reserva clientes/invest.", value: reservaAlloc, cls: "bg-info/60" },
    { label: "Lucro", value: lucroAlloc, cls: "bg-success" },
  ].filter((s) => s.value > 0.005);
  const totalDaBarra = grossReceived > 0 ? grossReceived : 1;

  return (
    <Secao
      titulo="Divisão do mês"
      descricao={monthLabel}
      ajuda={
        <>
          Divide o que entrou no mês. A reserva tributária usa a alíquota do plano de cada cliente; sem plano, {pct(DEFAULT_TAX_RATE)} ilustrativa.
          {" "}Pró-labore proporcional: abaixo de R$ 10 mil acompanha o que entra (R$ 5 mil vira R$ 1.500); em R$ 10 mil vale R$ 3.000; entre degraus soma a diferença proporcional (R$ 12,5 mil vira R$ 3.500).
          {" "}Retirada oficial: {fmt(proLabore)}, ajuste em Custos fixos. A reserva de clientes ({activeClientsCount} × {fmt(defaultDirectCost)}) sai só do que sobra, então estimativa não gera negativo.
        </>
      }
      acao={
        <button
          type="button"
          onClick={() => setPanelOpen((v) => !v)}
          aria-expanded={panelOpen}
          aria-label={`${panelOpen ? "Recolher" : "Mostrar"} divisão do mês`}
          className={botao.discreto}
        >
          <span className="hidden sm:inline">{panelOpen ? "Recolher" : "Mostrar"}</span>
          <ChevronDown className={juntar("h-4 w-4 transition-transform sm:ml-1", panelOpen && "rotate-180")} aria-hidden="true" />
        </button>
      }
    >
      {panelOpen && (
        <Painel semEspaco>
          <div className="grid min-w-0 grid-cols-1 md:grid-cols-2">
            {/* Coluna 1: divisão do que entrou */}
            <div className="min-w-0 p-4 sm:p-5">
              <ul className="min-w-0">
                <Linha icone={<Wallet className="h-3.5 w-3.5 text-foreground" />} rotulo="Recebido no mês (bruto)" forte valor={fmt(grossReceived)} />
                <Linha icone={<Landmark className="h-3.5 w-3.5 text-info" />} rotulo="Reserva tributária" valor={`− ${fmt(taxReserve)}`} />
                <Linha icone={<TrendingUp className="h-3.5 w-3.5 text-success" />} rotulo="Receita operacional" forte valor={fmt(operationalReceived)} corDoValor="text-success" separada />
                <Linha
                  icone={<Scale className="h-3.5 w-3.5 text-warning" />}
                  rotulo={fixedCostsSource === "real" ? "Custos fixos do mês" : "Custos fixos (referência: ferramentas)"}
                  valor={`− ${fmt(fixedCostsValue)}`}
                />
                <Linha
                  icone={<PiggyBank className="h-3.5 w-3.5 text-primary" />}
                  rotulo={<>Pró-labore proporcional <span className={juntar(etiqueta, "ml-1 bg-primary/10 text-primary")}>escada</span></>}
                  valor={`− ${fmt(proLaboreProp)}`}
                  corDoValor="text-primary"
                />
                <Linha
                  icone={<Scale className="h-3.5 w-3.5 text-info" />}
                  rotulo="Reserva de clientes e investimento"
                  apoio={<span className={reservaCompleta ? "text-success" : clientReserve > 0 ? "text-warning" : undefined}>{estadoDaReserva}</span>}
                  ajuda="É o que sobrou e foi guardado antes do lucro. Não é falta: sem sobra fica R$ 0,00 e o alvo espera o próximo dinheiro que entrar."
                  valor={clientReserve > 0 ? `− ${fmt(clientReserve)}` : fmt(0)}
                  corDoValor="text-info"
                />
              </ul>
              <div className="mt-2 flex min-w-0 items-center border-t border-border pt-2.5">
                <span className={juntar(texto.corpo, "min-w-0 flex-1 font-medium")}>Lucro do mês</span>
                <span className={juntar("shrink-0 text-[15px] font-semibold tabular-nums", result >= 0 ? "text-success" : "text-destructive")}>{fmt(result)}</span>
              </div>

              {grossReceived > 0 ? (
                <div className="mt-4 min-w-0">
                  <p className={juntar(texto.rotulo, "mb-1.5")}>Como o dinheiro que entrou se divide</p>
                  <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
                    {segs.map((s) => (
                      <div key={s.label} className={s.cls} style={{ width: `${(s.value / totalDaBarra) * 100}%` }} title={`${s.label}: ${fmt(s.value)}`} />
                    ))}
                  </div>
                  <div className="-mx-1.5 mt-1.5 flex min-w-0 flex-wrap">
                    {segs.map((s) => (
                      <span key={s.label} className="mx-1.5 my-0.5 inline-flex items-center text-[11px] tabular-nums text-muted-foreground">
                        <span className={juntar("mr-1 h-2 w-2 shrink-0 rounded-full", s.cls)} aria-hidden="true" />
                        {s.label} {fmt(s.value)} ({Math.round((s.value / totalDaBarra) * 100)}%)
                      </span>
                    ))}
                  </div>
                  {uncovered > 0.005 && (
                    <p className="mt-1.5 text-[12px] leading-4 text-destructive">
                      Faltam {fmt(uncovered)} para cobrir custos fixos e pró-labore do mês.
                    </p>
                  )}
                </div>
              ) : (
                <p className={juntar(texto.auxiliar, "mt-3")}>Nada recebido neste mês ainda.</p>
              )}

              {isCurrentMonth && projectedOperational !== null && grossReceived > 0 && (
                <div className="mt-2 flex min-w-0 items-center">
                  <p className={juntar(texto.auxiliar, "min-w-0 truncate")}>
                    Ritmo: fecha em ~<span className="tabular-nums">{fmt(projectedOperational)}</span> operacionais
                  </p>
                  <AjudaRecolhida className="ml-1" rotulo="Como o ritmo é calculado">
                    Entrou {fmt(operationalReceived)} operacionais até o dia {dayOfMonth}. Se a média diária continuar, o mês fecha em ~{fmt(projectedOperational)}, com pró-labore proporcional projetado de {fmt(projectedProLabore || 0)}. É estimativa: o que vale é o recebido.
                  </AjudaRecolhida>
                </div>
              )}
            </div>

            {/* Coluna 2: meta, ponto de equilíbrio e pró-labore pela escada */}
            <div className="min-w-0 divide-y divide-border border-t border-border md:border-l md:border-t-0">
              <div className="min-w-0 p-4 sm:p-5">
                <div className="flex min-w-0 items-center">
                  <Target className="mr-1.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                  <span className={juntar(texto.rotulo, "min-w-0 flex-1 truncate")}>Meta mensal (receita operacional)</span>
                  <button
                    type="button"
                    onClick={() => { setGoalInput(monthlyGoal ? String(monthlyGoal) : "10000"); setGoalModal(true); }}
                    className={juntar(botao.discreto, "h-7 px-2 text-primary")}
                  >
                    <Pencil className="mr-1 h-3 w-3" aria-hidden="true" /> {monthlyGoal ? "Editar" : "Definir"}
                  </button>
                </div>
                {monthlyGoal && monthlyGoal > 0 ? (
                  <>
                    <div className="mt-1 flex min-w-0 items-baseline">
                      <span className="text-[15px] font-semibold tabular-nums text-foreground">{fmt(operationalReceived)}</span>
                      <span className={juntar(texto.auxiliar, "ml-2 min-w-0 truncate")}>de {fmt(monthlyGoal)}</span>
                      <span className={juntar("ml-auto shrink-0 pl-2 text-[12px] tabular-nums", goalProgress! >= 1 ? "text-success" : "text-muted-foreground")}>
                        {Math.round(goalProgress! * 100)}%
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={juntar("h-full rounded-full", goalProgress! >= 1 ? "bg-success" : "bg-primary")}
                        style={{ width: `${Math.round(goalProgress! * 100)}%` }}
                      />
                    </div>
                  </>
                ) : (
                  <p className={juntar(texto.auxiliar, "mt-1.5 truncate")}>Sem meta. O Plano Diretor sugere R$ 10.000 operacionais.</p>
                )}
              </div>

              <div className="min-w-0 p-4 sm:p-5">
                <div className="flex min-w-0 items-center">
                  <Scale className="mr-1.5 h-3.5 w-3.5 shrink-0 text-info" aria-hidden="true" />
                  <span className={juntar(texto.rotulo, "min-w-0 truncate")}>Ponto de equilíbrio</span>
                </div>
                <div className="mt-1 flex min-w-0 items-baseline">
                  <span className="shrink-0 text-[15px] font-semibold tabular-nums text-foreground">{fmt(breakEvenOperational)}</span>
                  <span className={juntar(texto.auxiliar, "ml-2 min-w-0 truncate")}>por mês · {fmt(breakEvenGross)} brutos</span>
                </div>
                <p className={juntar("mt-1 text-[12px] leading-4", operationalReceived >= breakEvenOperational ? "text-success" : "text-warning")}>
                  {operationalReceived >= breakEvenOperational
                    ? "Estrutura do mês coberta pelo que já entrou."
                    : `Faltam ${fmt(breakEvenOperational - operationalReceived)} operacionais para cobrir a estrutura.`}
                </p>
              </div>

              <div className="min-w-0 p-4 sm:p-5">
                <div className="flex min-w-0 items-center">
                  <PiggyBank className="mr-1.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
                  <span className={juntar(texto.rotulo, "min-w-0 truncate")}>Pró-labore pela escada</span>
                  <AjudaRecolhida className="ml-1" rotulo="Sobre o pró-labore">
                    Proporcional ao que entrou no mês, pela escada do Plano Diretor. Nada muda sozinho: a retirada oficial você confirma em Custos fixos.
                  </AjudaRecolhida>
                </div>
                <div className="mt-1 flex min-w-0 flex-wrap items-center">
                  <span className="mr-2 text-[15px] font-semibold tabular-nums text-foreground">{fmt(proLaboreProp)}</span>
                  <span className={juntar(etiqueta, "bg-muted text-muted-foreground")}>Oficial {fmt(proLabore)}</span>
                </div>
                <p className={juntar(texto.auxiliar, "mt-1 truncate")}>
                  {nextTier
                    ? `Próximo degrau: ${fmt(nextTier.proLabore)} ao atingir ${fmt(nextTier.revenue)}.`
                    : "Topo da escada atingido."}
                </p>
              </div>
            </div>
          </div>
        </Painel>
      )}

      {/* Meta mensal */}
      <Dialog open={goalModal} onOpenChange={setGoalModal}>
        <DialogContent className="border-border bg-card sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-foreground">Meta mensal</DialogTitle>
          </DialogHeader>
          <div className="min-w-0 space-y-4">
            <GrupoDeCampos colunas={1}>
              <CampoDeFormulario rotulo="Meta (R$)" apoio="Receita operacional: recebido menos a reserva tributária.">
                <Input type="number" inputMode="decimal" step="0.01" value={goalInput} onChange={(e) => setGoalInput(e.target.value)} className="h-9" placeholder="10000" />
              </CampoDeFormulario>
            </GrupoDeCampos>
            <div className="flex min-w-0 items-center justify-end border-t border-border pt-4 [&>*+*]:ml-2">
              <button type="button" onClick={() => setGoalModal(false)} className={botao.secundario}>Cancelar</button>
              <button type="button" onClick={saveGoal} disabled={updateSettings.isPending} className={botao.primario}>
                Salvar meta
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Secao>
  );
}

/** Uma linha da divisão: ícone, rótulo (com apoio opcional) e valor à direita. */
function Linha({ icone, rotulo, apoio, ajuda, valor, corDoValor = "text-muted-foreground", forte = false, separada = false }: {
  icone: ReactNode;
  rotulo: ReactNode;
  apoio?: ReactNode;
  ajuda?: ReactNode;
  valor: ReactNode;
  corDoValor?: string;
  forte?: boolean;
  separada?: boolean;
}) {
  return (
    <li className={juntar("flex min-w-0 items-start py-1.5", separada && "mb-1 border-b border-border pb-2.5")}>
      <span className="mr-2 mt-0.5 inline-flex shrink-0" aria-hidden="true">{icone}</span>
      <div className="mr-3 min-w-0 flex-1">
        <div className="flex min-w-0 items-center">
          <span className={juntar("min-w-0 text-[13px] leading-5", forte ? "font-medium text-foreground" : "text-muted-foreground")}>{rotulo}</span>
          {ajuda && <AjudaRecolhida className="ml-1">{ajuda}</AjudaRecolhida>}
        </div>
        {apoio && <p className="truncate text-[12px] leading-4 text-muted-foreground">{apoio}</p>}
      </div>
      <span className={juntar("shrink-0 text-[13px] leading-5 tabular-nums", forte && !corDoValor.includes("success") ? "text-foreground" : corDoValor)}>{valor}</span>
    </li>
  );
}
