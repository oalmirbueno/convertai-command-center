/**
 * Tarefa do ritual só quando é ação concreta (27/10/2026). Diagnóstico de 26/10: das tarefas que o ritual
 * gerou, 18 de 137 fecharam; muitas eram vagas ("Acompanhar anúncios", "Revisar formatos", "Comparar
 * formatos de post e anúncio") ou repetiam o que a Agenda já faz ("Publicar carrossel tal").
 *
 * Regra (código, sem IA): vira tarefa, com dono (quem toca em Criar tarefa) e prazo, só o passo que começa
 * por um verbo de ação e diz o quê. O resto vira linha no resumo do ritual, sem tarefa:
 * - verbo de acompanhar/olhar/revisar (acompanhar, monitorar, revisar, conferir, comparar, avaliar...);
 * - publicar ou agendar post: quem cuida é a Agenda (aprovou, agenda sozinho);
 * - título curto demais para dizer o quê (menos de 3 palavras).
 *
 * Sem import: o ritual-writer (Deno) e a Central (front, por src/components/central/ritualAvisos.ts) leem
 * este arquivo. Sem travessão.
 */

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Verbos de "olhar" (o começo do título, sem acento). */
export const VERBOS_VAGOS = [
  "acompanhar", "monitorar", "revisar", "rever", "conferir", "comparar", "avaliar", "analisar", "observar",
  "verificar", "checar", "garantir", "manter", "estudar", "pensar", "considerar", "explorar", "olhar",
  "cuidar", "seguir", "alinhar", "refletir", "entender", "estruturar", "mapear", "investigar", "validar",
  "dar visibilidade", "dar atencao", "ficar de olho",
] as const;

/** Publicar ou agendar post: a Agenda faz (entrega, aprovação e data). */
const VERBOS_DA_AGENDA = ["publicar", "agendar", "postar", "programar"] as const;
const OBJETOS_DA_AGENDA = /\b(post|posts|carrossel|carrosseis|arte|artes|conteudo|conteudos|reel|reels|story|stories|video|videos|peca|pecas|estatico)\b/;

export type MotivoDeTarefaVaga = "verbo_vago" | "vai_pela_agenda" | "sem_o_que";

/** Por que este passo não vira tarefa (null = é ação concreta). */
export function tarefaVaga(titulo: string | null | undefined): { motivo: MotivoDeTarefaVaga; texto: string } | null {
  const t = semAcento(String(titulo ?? "")).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return { motivo: "sem_o_que", texto: "sem título" };
  const vago = VERBOS_VAGOS.find((v) => t === v || t.startsWith(`${v} `));
  if (vago) return { motivo: "verbo_vago", texto: `"${vago}" não é uma entrega: fica no resumo` };
  const agenda = VERBOS_DA_AGENDA.find((v) => t.startsWith(`${v} `));
  if (agenda && OBJETOS_DA_AGENDA.test(t)) return { motivo: "vai_pela_agenda", texto: "publicar post é da Agenda (aprovou, agenda sozinho): fica no resumo" };
  if (t.split(" ").filter((p) => p.length >= 2).length < 3) return { motivo: "sem_o_que", texto: "não diz o quê: fica no resumo" };
  return null;
}

/** Separa as sugestões do ritual: as concretas viram tarefa; as vagas, linha no resumo. */
export function separarTarefasDoRitual<T extends { titulo: string }>(tarefas: readonly T[]): { tarefas: T[]; no_resumo: Array<T & { motivo: string }> } {
  const concretas: T[] = [];
  const noResumo: Array<T & { motivo: string }> = [];
  for (const t of tarefas ?? []) {
    const v = tarefaVaga(t?.titulo);
    if (v) noResumo.push({ ...t, motivo: v.texto });
    else concretas.push(t);
  }
  return { tarefas: concretas, no_resumo: noResumo };
}
