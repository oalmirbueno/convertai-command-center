/**
 * "O que o painel aprendeu" (frente AP, 27/09/2026): o que o cérebro do
 * cliente guardou (public.agente_memoria) com a origem legível para a equipe:
 * entrega, ajuste, reprovação, números reais ou a própria equipe. Puro: a
 * tela e o Vitest usam o mesmo arquivo. Sem travessão.
 */

export type LinhaDaMemoria = {
  id: string;
  agente?: string | null;
  tipo?: string | null;
  texto: string;
  origem?: string | null;
  ativa?: boolean | null;
  criado_em?: string | null;
  categoria?: string | null;
  fonte?: string | null;
  reforcos?: number | null;
  reforcado_em?: string | null;
  area?: string | null;
  motivo?: string | null;
};

export type FonteDoAprendizado = "entrega" | "ajuste" | "reprovacao" | "desempenho" | "equipe";

export const ROTULO_DA_FONTE: Record<FonteDoAprendizado, string> = {
  entrega: "entrega",
  ajuste: "ajuste",
  reprovacao: "reprovação",
  desempenho: "números reais",
  equipe: "equipe",
};

export const FILTROS_DOS_APRENDIZADOS: Array<{ valor: "todos" | FonteDoAprendizado; rotulo: string }> = [
  { valor: "todos", rotulo: "Todos" },
  { valor: "entrega", rotulo: "Entregas" },
  { valor: "ajuste", rotulo: "Ajustes" },
  { valor: "reprovacao", rotulo: "Reprovações" },
  { valor: "desempenho", rotulo: "Números reais" },
];

/** De onde veio o aprendizado, pelas colunas do cérebro (e pelas antigas, tipo e origem). */
export function fonteDoAprendizado(l: LinhaDaMemoria): FonteDoAprendizado {
  if (l.fonte === "entrega" || l.categoria === "entrega") return "entrega";
  if (l.fonte === "desempenho" || l.categoria === "performou" || l.origem === "metrica") return "desempenho";
  if (l.categoria === "reprovado" || (l.origem === "aprovacao" && l.tipo === "evitar")) return "reprovacao";
  if (l.categoria === "ajuste" || l.origem === "ajuste") return "ajuste";
  return "equipe";
}

export type AprendizadoNaTela = {
  id: string;
  texto: string;
  motivo: string | null;
  fonte: FonteDoAprendizado;
  /** Quantas vezes o mesmo aprendizado se repetiu (1 = uma vez). */
  forca: number;
  data: string | null;
};

/** O plano do mês combinado com o agente tem tela própria: fica fora desta lista. */
const ehPlanoDoMes = (t: string) => /^Plano do m[eê]s \d{4}-\d{2}:/.test(t);

/**
 * A lista da tela: só o que está valendo, fora o plano do mês, filtrada pela
 * origem, mais forte e mais recente primeiro.
 */
export function aprendizadosDoPainel(linhas: LinhaDaMemoria[] | null | undefined, filtro: "todos" | FonteDoAprendizado = "todos"): AprendizadoNaTela[] {
  return (linhas || [])
    .filter((l) => l && l.ativa !== false && typeof l.texto === "string" && l.texto.trim() && !ehPlanoDoMes(l.texto))
    .map((l) => ({
      id: String(l.id),
      texto: l.texto.trim(),
      motivo: l.motivo && String(l.motivo).trim() ? String(l.motivo).trim() : null,
      fonte: fonteDoAprendizado(l),
      forca: Math.max(1, Math.round(Number(l.reforcos) || 1)),
      data: l.reforcado_em || l.criado_em || null,
    }))
    .filter((a) => filtro === "todos" || a.fonte === filtro)
    .sort((a, b) => b.forca - a.forca || String(b.data || "").localeCompare(String(a.data || "")));
}

/** Resumo de uma linha do hub: quantos por origem. */
export function resumoDosAprendizados(lista: AprendizadoNaTela[]): string {
  if (!lista.length) return "Nada aprendido ainda";
  const conta = (f: FonteDoAprendizado) => lista.filter((a) => a.fonte === f).length;
  const partes = [
    conta("entrega") ? `${conta("entrega")} de entregas` : "",
    conta("ajuste") ? `${conta("ajuste")} de ajustes` : "",
    conta("reprovacao") ? `${conta("reprovacao")} de reprovações` : "",
    conta("desempenho") ? `${conta("desempenho")} de números reais` : "",
  ].filter(Boolean);
  return partes.length ? partes.join(" · ") : `${lista.length} da equipe`;
}

export const dataCurtaDoAprendizado = (iso: string | null) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
