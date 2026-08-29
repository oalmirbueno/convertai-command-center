/**
 * Os dois badges obrigatórios do cartão de execução.
 *
 * A queixa que originou isto: a fila mistura mídia, QA, carrossel e
 * documentação, e o cartão não dizia POR QUE a tarefa foi selecionada nem
 * o que "em revisão" significa — um carrossel em revisão parecia arte
 * final publicada. Dois eixos resolvem:
 *
 *  - ORIGEM: quem está segurando o próximo passo (interno / aguardando
 *    Almir / externo bloqueado). É a resposta a "isso depende de mim?".
 *  - CATEGORIA: que tipo de trabalho é (conteúdo / QA / mídia /
 *    documentação). É heurística por palavras do título — e se declara
 *    "geral" quando não sabe, porque badge chutado ensina errado.
 */

export type OrigemDaExecucao = "interno" | "aguardando_almir" | "externo_bloqueado";

export function origemDaExecucao(v: {
  status: string;
  approval_required?: boolean | null;
}): OrigemDaExecucao {
  // Aprovação pendente vem primeiro: mesmo que o agente siga analisando,
  // o RESULTADO externo está travado num sim que só o humano dá.
  if (v.approval_required && v.status !== "done") return "externo_bloqueado";
  if (v.status === "awaiting_input") return "aguardando_almir";
  return "interno";
}

export const ROTULO_ORIGEM: Record<OrigemDaExecucao, string> = {
  interno: "interno",
  aguardando_almir: "aguardando Almir",
  externo_bloqueado: "externo bloqueado",
};

export type CategoriaDaTarefa = "conteudo" | "qa" | "midia" | "documentacao" | "geral";

const PALAVRAS: Array<[CategoriaDaTarefa, RegExp]> = [
  // QA antes de conteúdo: "QA do carrossel" é QA, não carrossel.
  ["qa", /\b(qa|teste|testar|valida[cç][aã]o|revisar bug|auditoria)\b/i],
  ["midia", /\b(meta ads|ads|anum?[nc]io|campanha|tr[aá]fego|impulsion|midia|m[ií]dia|boost)\b/i],
  ["documentacao", /\b(document|doc\b|runbook|manual|checklist|dossi[eê]|relat[oó]rio|briefing)\b/i],
  ["conteudo", /\b(carrossel|reel|reels|post|stories|story|legenda|arte|criativo|v[ií]deo|roteiro|copy|design)\b/i],
];

export function categoriaDaTarefa(titulo?: string | null): CategoriaDaTarefa {
  const t = String(titulo ?? "");
  for (const [cat, re] of PALAVRAS) {
    if (re.test(t)) return cat;
  }
  return "geral";
}

export const ROTULO_CATEGORIA: Record<CategoriaDaTarefa, string> = {
  conteudo: "conteúdo",
  qa: "QA",
  midia: "mídia",
  documentacao: "documentação",
  geral: "geral",
};

/**
 * O filtro combinado da tela: busca livre + cliente + recorte de prazo.
 * Puro de propósito — a tela só aplica; a régua mora aqui e é testável.
 */
export function passaNoFiltro(opts: {
  busca: string;
  cliente: string;
  prazo: "todas" | "vencidas" | "semana";
  hoje: string;
  titulo?: string | null;
  nomeCliente?: string | null;
  nomeProjeto?: string | null;
  nomeOperador?: string | null;
  dueDate?: string | null;
  statusFinal?: boolean;
}): boolean {
  const busca = opts.busca.trim().toLowerCase();
  if (busca) {
    const alvo = [opts.titulo, opts.nomeCliente, opts.nomeProjeto, opts.nomeOperador]
      .filter(Boolean).join(" ").toLowerCase();
    if (!alvo.includes(busca)) return false;
  }
  if (opts.cliente && (opts.nomeCliente ?? "") !== opts.cliente) return false;
  if (opts.prazo === "vencidas") {
    // Concluída não é vencida: cobrar prazo de tarefa entregue é ruído.
    if (!opts.dueDate || opts.statusFinal) return false;
    if (String(opts.dueDate) > opts.hoje) return false;
  }
  if (opts.prazo === "semana") {
    if (!opts.dueDate) return false;
    const limite = new Date(opts.hoje + "T00:00:00");
    limite.setDate(limite.getDate() + 7);
    const alvo = String(opts.dueDate).slice(0, 10);
    if (alvo > limite.toISOString().slice(0, 10)) return false;
  }
  return true;
}
