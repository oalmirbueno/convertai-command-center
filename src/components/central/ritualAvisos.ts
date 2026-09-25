/**
 * O que a resposta do ritual-writer traz além do texto: o aviso de repetição
 * (conferência determinística + Jev só como aviso), as tarefas sugeridas e a
 * fase do método. Uma função só para a Central, o gerador e o agente lerem
 * igual e guardarem no rascunho do mesmo jeito.
 */

export interface TarefaSugerida {
  titulo: string;
  passo: string;
  frente: "social" | "trafego" | "geral";
  prazo_dias: number;
  promessa: string;
}

export interface ResumoDaRepeticao {
  indice: number;
  acima_do_limite: boolean;
  motivos: string[];
  frases: string[];
  jev: string | null;
}

type Resposta = Record<string, unknown> | null | undefined;

const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function resumoDaRepeticao(data: Resposta): ResumoDaRepeticao | null {
  const r = data && typeof data.repeticao === "object" && data.repeticao ? data.repeticao as Record<string, unknown> : null;
  if (!r) return null;
  const jev = r.jev && typeof r.jev === "object" ? (r.jev as Record<string, unknown>).aviso : null;
  return {
    indice: typeof r.indice === "number" ? r.indice : 0,
    acima_do_limite: r.acima_do_limite === true,
    motivos: lista(r.motivos).filter((m): m is string => typeof m === "string").slice(0, 4),
    frases: lista(r.frases_repetidas)
      .map((f) => (f && typeof f === "object" ? String((f as Record<string, unknown>).frase ?? "") : ""))
      .filter(Boolean)
      .slice(0, 4),
    jev: typeof jev === "string" && jev ? jev : null,
  };
}

/** Uma linha de aviso para a tela, ou null quando não repetiu. */
export function avisoDeRepeticao(data: Resposta): string | null {
  const r = resumoDaRepeticao(data);
  if (!r || !r.acima_do_limite) return null;
  return [`Repetição: ${r.motivos.join(" ")}`, r.jev].filter(Boolean).join(" ");
}

/** Alertas internos do rascunho: a repetição vem primeiro, depois os da IA. */
export function avisosDoRitual(data: Resposta): string[] {
  const alertas = lista(data?.alertas).filter((a): a is string => typeof a === "string").slice(0, 4);
  const repeticao = avisoDeRepeticao(data);
  return repeticao ? [repeticao, ...alertas] : alertas;
}

export function tarefasSugeridas(data: Resposta): TarefaSugerida[] {
  return lista(data?.tarefas_sugeridas)
    .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
    .map((t) => ({
      titulo: String(t.titulo ?? "").slice(0, 90),
      passo: String(t.passo ?? "").slice(0, 240),
      frente: (t.frente === "social" || t.frente === "trafego" ? t.frente : "geral") as TarefaSugerida["frente"],
      prazo_dias: Math.min(14, Math.max(1, Math.round(Number(t.prazo_dias)) || 4)),
      promessa: String(t.promessa ?? "").slice(0, 200),
    }))
    .filter((t) => t.titulo.length >= 4)
    .slice(0, 5);
}

/** O que entra em reports.metrics além do que applyCentralAiDraft já grava. */
export function extrasDoRitual(data: Resposta): Record<string, unknown> {
  const contexto = data && typeof data.contexto === "object" && data.contexto ? data.contexto as Record<string, unknown> : null;
  return {
    alertas: avisosDoRitual(data),
    tarefas_sugeridas: tarefasSugeridas(data),
    repeticao: resumoDaRepeticao(data),
    fase_acelera: typeof contexto?.fase === "string" ? contexto.fase : null,
  };
}
