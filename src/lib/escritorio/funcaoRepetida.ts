import type { AgenteDoEscritorio } from "./tipos";

/**
 * Função repetida: dois ou mais agentes ATIVOS na mesma área com a mesma função.
 * É o aviso que fica acima do organograma do Escritório: dois fazendo a mesma
 * coisa costuma ser sobra de cadastro, e cada um responde de um jeito.
 */

/** Minúsculo, sem acento, sem espaço sobrando: "  Social  Média " e "social media" são a mesma função. */
export function normalizarFuncao(texto: string | null | undefined): string {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export interface FuncaoRepetida {
  /** Área e função já normalizadas (serve de key). */
  chave: string;
  /** Como a área e a função estão escritas no primeiro agente do grupo. */
  area: string | null;
  funcao: string;
  agentes: { slug: string; nome: string }[];
}

type AgenteParaComparar = Pick<AgenteDoEscritorio, "slug" | "display_name" | "role" | "area" | "status">;

/** Os grupos de agentes ativos com a mesma área e a mesma função, na ordem em que aparecem. */
export function funcoesRepetidas(agentes: readonly AgenteParaComparar[]): FuncaoRepetida[] {
  const grupos = new Map<string, FuncaoRepetida>();
  for (const a of agentes) {
    if (a.status !== "active") continue;
    const funcao = normalizarFuncao(a.role);
    if (!funcao) continue;
    const chave = `${normalizarFuncao(a.area)}|${funcao}`;
    const grupo = grupos.get(chave);
    const quem = { slug: a.slug, nome: a.display_name };
    if (grupo) grupo.agentes.push(quem);
    else grupos.set(chave, { chave, area: a.area?.trim() || null, funcao: a.role.trim(), agentes: [quem] });
  }
  return [...grupos.values()].filter((g) => g.agentes.length > 1);
}
