/**
 * Tarefa parecida (26/10/2026). O ritual criava de novo o mesmo próximo passo a
 * cada semana (só deduplicava por origem + índice): 119 tarefas abertas, 106
 * vencidas. Antes de criar, o painel procura uma tarefa aberta do mesmo
 * cliente com o título parecido e oferece "Já existe: abrir".
 *
 * Puro. Sem \p{} nem lookbehind (Safari 11): acento sai por normalize + faixa
 * de marcas combinantes.
 */

const PALAVRAS_VAZIAS = new Set([
  "a", "o", "as", "os", "um", "uma", "uns", "umas", "de", "do", "da", "dos", "das", "e", "ou", "em", "no", "na", "nos", "nas",
  "para", "pra", "por", "com", "sem", "que", "se", "ao", "aos", "à", "às", "sua", "seu", "suas", "seus", "esta", "este", "essa", "esse",
  "semana", "cliente", "fazer", "ritual",
]);

/** Minúsculas, sem acento, sem pontuação, sem palavra vazia. */
export function palavrasDoTitulo(titulo: string): string[] {
  const base = String(titulo || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!base) return [];
  return base
    .split(" ")
    .filter((p) => p.length > 1 && !PALAVRAS_VAZIAS.has(p))
    // Plural simples: "anuncios" e "anuncio" contam como a mesma palavra.
    .map((p) => (p.length > 4 && p.charAt(p.length - 1) === "s" ? p.slice(0, -1) : p));
}

export function tituloNormalizado(titulo: string): string {
  return palavrasDoTitulo(titulo).join(" ");
}

/** Semelhança de 0 a 1 entre dois títulos (palavras em comum sobre o título menor, com peso no conjunto). */
export function semelhancaDeTitulo(a: string, b: string): number {
  const pa = palavrasDoTitulo(a);
  const pb = palavrasDoTitulo(b);
  if (!pa.length || !pb.length) return 0;
  if (pa.join(" ") === pb.join(" ")) return 1;
  const sa = new Set(pa);
  const sb = new Set(pb);
  let comuns = 0;
  sa.forEach((p) => { if (sb.has(p)) comuns += 1; });
  const uniao = sa.size + sb.size - comuns;
  const jaccard = comuns / uniao;
  const cobertura = comuns / Math.min(sa.size, sb.size);
  return Math.round(((jaccard + cobertura) / 2) * 100) / 100;
}

export const LIMIAR_DE_PARECIDA = 0.6;

export interface TarefaAberta {
  id: string;
  title: string;
  status?: string | null;
  due_date?: string | null;
}

/** A tarefa aberta mais parecida (acima do limiar), ou null. */
export function acharTarefaParecida<T extends TarefaAberta>(titulo: string, abertas: readonly T[], limiar = LIMIAR_DE_PARECIDA): T | null {
  let melhor: T | null = null;
  let nota = 0;
  for (const t of abertas) {
    const s = semelhancaDeTitulo(titulo, t.title);
    if (s >= limiar && s > nota) {
      melhor = t;
      nota = s;
    }
  }
  return melhor;
}
