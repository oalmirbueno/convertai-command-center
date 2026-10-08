/**
 * Central de Autonomia (08/10/2026): a régua dos indicadores e do histórico.
 *
 * Pura (sem banco) para a tela e os testes usarem a mesma conta. Tarefa e
 * execução são contadas SEPARADAS: o card do Kanban diz em que pé está a
 * entrega; a execução diz o que o agente fez. Uma execução concluída com a
 * tarefa em revisão é "entrega em revisão", nunca "feito".
 */

export type TarefaContada = { id: string; status: string; updated_at: string };
export type ExecucaoContada = {
  id: string;
  operator_id: string;
  task_link_id: string | null;
  status: string; // started | progress | done | failed | blocked | review | awaiting_input | timeout
  started_at: string | null;
  finished_at: string | null;
  heartbeat_at: string | null;
};
export type VinculoContado = { id: string; status: string; operator_id: string; kanban_task_id: string | null; painel_task_id: string | null; last_evidence: string | null; updated_at: string };
export type AgenteContado = { id: string; status: string; display_name: string };
export type Intervalo = { desde: string; ate: string };

const dentro = (iso: string | null | undefined, p: Intervalo) => !!iso && iso >= p.desde && iso < p.ate;
const temTexto = (s: string | null | undefined) => !!s && s.trim().length > 0;

/** A execução tocou o intervalo (começou, terminou ou deu sinal nele). */
export const execucaoNoIntervalo = (r: ExecucaoContada, p: Intervalo) => dentro(r.started_at, p) || dentro(r.finished_at, p) || dentro(r.heartbeat_at, p);

export type Indicadores = {
  tarefasAbertas: { total: number; backlog: number; todo: number; doing: number; review: number };
  tarefasConcluidas: { periodo: number; anterior: number };
  execucoes: { periodo: number; anterior: number; emAndamento: number; bloqueadas: number; aguardandoInsumo: number; concluidas: number; concluidasAnterior: number };
  entregasEmRevisao: number;
  aprovacoesPendentes: number;
  incidentes: { periodo: number; anterior: number; falhas: number; semSinal: number; divergencias: number };
  agentesAtivos: { periodo: number; anterior: number; cadastrados: number };
};

/**
 * Divergência entre execução e tarefa: o caso do operator_report.
 * - vínculo bloqueado/aguardando com a tarefa ainda em andamento;
 * - vínculo concluído com a tarefa parada antes da revisão (backlog/todo/doing).
 * Vínculo concluído com a tarefa em revisão NÃO é divergência: é o desenho
 * (o agente leva até a revisão; concluir é humano, por complete_task).
 */
export function divergenciaDoVinculo(v: Pick<VinculoContado, "status">, statusDaTarefa: string | null | undefined): string | null {
  if (!statusDaTarefa || statusDaTarefa === "done") return null;
  if ((v.status === "blocked" || v.status === "awaiting_input") && statusDaTarefa === "doing") return "Execução parada, card ainda em andamento";
  if (v.status === "done" && ["backlog", "todo", "doing"].includes(statusDaTarefa)) return "Execução concluída, card não chegou à revisão";
  return null;
}

export function calcularIndicadores(e: {
  periodo: Intervalo;
  anterior: Intervalo;
  tarefasAbertas: TarefaContada[];
  concluidasPeriodo: number;
  concluidasAnterior: number;
  execucoes: ExecucaoContada[];
  vinculos: VinculoContado[];
  statusDaTarefa: (id: string | null | undefined) => string | null;
  aprovacoesPendentes: number;
  agentes: AgenteContado[];
}): Indicadores {
  const abertas = { total: 0, backlog: 0, todo: 0, doing: 0, review: 0 };
  for (const t of e.tarefasAbertas) {
    if (t.status === "done") continue;
    abertas.total++;
    if (t.status in abertas) (abertas as Record<string, number>)[t.status]++;
  }
  const doPeriodo = e.execucoes.filter((r) => execucaoNoIntervalo(r, e.periodo));
  const doAnterior = e.execucoes.filter((r) => execucaoNoIntervalo(r, e.anterior) && !execucaoNoIntervalo(r, e.periodo));
  const falhas = (xs: ExecucaoContada[]) => xs.filter((r) => r.status === "failed").length;
  const semSinal = (xs: ExecucaoContada[]) => xs.filter((r) => r.status === "timeout").length;
  const divergencias = e.vinculos.filter((v) => divergenciaDoVinculo(v, e.statusDaTarefa(v.kanban_task_id || v.painel_task_id))).length;
  // Entrega em revisão: o CARD em revisão (do agente ou da equipe). É o que espera olho humano.
  const emRevisao = abertas.review;
  const agentesNo = (xs: ExecucaoContada[]) => new Set(xs.map((r) => r.operator_id)).size;
  return {
    tarefasAbertas: abertas,
    tarefasConcluidas: { periodo: e.concluidasPeriodo, anterior: e.concluidasAnterior },
    execucoes: {
      periodo: doPeriodo.length,
      anterior: doAnterior.length,
      emAndamento: e.vinculos.filter((v) => v.status === "in_progress").length,
      bloqueadas: e.vinculos.filter((v) => v.status === "blocked").length,
      aguardandoInsumo: e.vinculos.filter((v) => v.status === "awaiting_input").length,
      concluidas: doPeriodo.filter((r) => r.status === "done").length,
      concluidasAnterior: doAnterior.filter((r) => r.status === "done").length,
    },
    entregasEmRevisao: emRevisao,
    aprovacoesPendentes: e.aprovacoesPendentes,
    incidentes: {
      periodo: falhas(doPeriodo) + semSinal(doPeriodo) + divergencias,
      anterior: falhas(doAnterior) + semSinal(doAnterior),
      falhas: falhas(doPeriodo),
      semSinal: semSinal(doPeriodo),
      divergencias,
    },
    agentesAtivos: { periodo: agentesNo(doPeriodo), anterior: agentesNo(doAnterior), cadastrados: e.agentes.filter((a) => a.status === "active").length },
  };
}

/** "+3 vs. anterior", "igual ao anterior", "−2 vs. anterior". */
export function variacao(atual: number, anterior: number): string {
  const d = atual - anterior;
  if (d === 0) return "igual ao período anterior";
  return `${d > 0 ? "+" : "−"}${Math.abs(d)} vs. período anterior (${anterior})`;
}

export type ResultadoVerificado =
  | "concluida_com_prova"
  | "execucao_concluida_entrega_em_revisao"
  | "em_revisao"
  | "em_andamento"
  | "bloqueada"
  | "aguardando_insumo"
  | "falhou"
  | "sem_sinal"
  | "concluida_sem_prova";

export const ROTULO_DO_RESULTADO: Record<ResultadoVerificado, string> = {
  concluida_com_prova: "Concluída com prova",
  execucao_concluida_entrega_em_revisao: "Execução concluída · entrega em revisão",
  em_revisao: "Em revisão (não concluída)",
  em_andamento: "Em andamento",
  bloqueada: "Bloqueada",
  aguardando_insumo: "Aguardando insumo",
  falhou: "Falhou",
  sem_sinal: "Expirou sem sinal",
  concluida_sem_prova: "Concluída sem prova anexada",
};

/**
 * O resultado VERIFICADO de uma execução: a execução, o vínculo e a tarefa
 * juntos. Só é "concluída com prova" quando a tarefa está done E há prova no
 * vínculo. Revisão nunca aparece como concluída.
 */
export function resultadoVerificado(
  r: Pick<ExecucaoContada, "status">,
  v: Pick<VinculoContado, "status" | "last_evidence"> | null,
  statusDaTarefa: string | null,
): ResultadoVerificado {
  if (r.status === "timeout") return "sem_sinal";
  if (r.status === "failed") return "falhou";
  if (r.status === "blocked") return "bloqueada";
  if (r.status === "awaiting_input") return "aguardando_insumo";
  if (r.status === "review") return statusDaTarefa === "done" && v && temTexto(v.last_evidence) ? "concluida_com_prova" : "em_revisao";
  if (r.status === "done") {
    if (statusDaTarefa === "done") return v && temTexto(v.last_evidence) ? "concluida_com_prova" : "concluida_sem_prova";
    if (!statusDaTarefa) return v && temTexto(v.last_evidence) ? "execucao_concluida_entrega_em_revisao" : "em_revisao";
    return "execucao_concluida_entrega_em_revisao";
  }
  return "em_andamento";
}

export type PeriodoDaCentral = "semana" | "7d" | "30d";
export const PERIODOS_DA_CENTRAL: Array<{ valor: PeriodoDaCentral; rotulo: string }> = [
  { valor: "semana", rotulo: "Esta semana" },
  { valor: "7d", rotulo: "7 dias" },
  { valor: "30d", rotulo: "30 dias" },
];
