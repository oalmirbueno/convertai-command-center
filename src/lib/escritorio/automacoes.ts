import type { Automacao } from "./tipos";

/** O filtro da aba Automações: todas, só as que deram erro na última vez ou as que nunca rodaram. */
export type FiltroDeAutomacao = "todas" | "erro" | "nunca";

type AutomacaoParaFiltrar = Pick<Automacao, "ultimo_status" | "ultima_execucao_em">;

export function filtrarAutomacoes<T extends AutomacaoParaFiltrar>(lista: readonly T[], filtro: FiltroDeAutomacao): T[] {
  if (filtro === "erro") return lista.filter((a) => a.ultimo_status === "erro");
  if (filtro === "nunca") return lista.filter((a) => !a.ultima_execucao_em);
  return [...lista];
}
