import type { Hype, HypesDaSemana } from "./mesaV4Api";
import { hypeNaAgenda } from "./momentoDoGancho";

/**
 * A leitura semanal (mesa_hypes) dentro de Hype e Trending. 21/10/2026: os filtros de tipo e formato do
 * Trendy saíram (o servidor só grava carrossel ou estático, então Foto, Vídeo, Stories e Outros ficavam
 * sempre vazios); o tipo virou a área (hype no Hype, nicho no Trending).
 */
export interface ItemDoTrendy { h: Hype; indice: number }

/** Uma resposta atrasada de outro cliente nunca preenche a tela do cliente atual. */
export function dadosDoTrendy(dados: HypesDaSemana | null | undefined, clientId: string): HypesDaSemana | null {
  return dados?.client_id === clientId ? dados : null;
}

/** Itens com o índice original (o "Criar campanha" do link antigo aponta por ele); o que já está na agenda sai. */
export function itensDoTrendy(itens: Hype[], ganchos: string[]): ItemDoTrendy[] {
  return itens.map((h, indice) => ({ h, indice })).filter(({ h }) => !hypeNaAgenda(h.titulo, ganchos));
}

/** Separa a leitura nas duas áreas: hype (datas, eventos) e nicho (o que viraliza agora). */
export function separarLeitura(itens: ItemDoTrendy[]): { hype: ItemDoTrendy[]; nicho: ItemDoTrendy[] } {
  return { hype: itens.filter((x) => x.h.tipo !== "nicho"), nicho: itens.filter((x) => x.h.tipo === "nicho") };
}
