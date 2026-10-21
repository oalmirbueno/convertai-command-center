import type { Hype, HypesDaSemana } from "./mesaV4Api";
import { hypeNaAgenda, semAcento } from "./momentoDoGancho";

/** Filtros da leitura existente: nenhum conteúdo, custo ou índice é alterado. */
export type TipoDoTrendy = "todos" | "momento" | "nicho";
export type FormatoDoTrendy = "todos" | "carrossel" | "estatico" | "foto" | "video" | "story" | "outro";
export interface FiltrosDoTrendy { tipo: TipoDoTrendy; formato: FormatoDoTrendy; busca: string }
export interface ItemDoTrendy { h: Hype; indice: number }
export const FILTROS_INICIAIS_DO_TRENDY: FiltrosDoTrendy = { tipo: "todos", formato: "todos", busca: "" };
export const FORMATOS_DO_TRENDY: { valor: FormatoDoTrendy; rotulo: string }[] = [
  { valor: "todos", rotulo: "Todos os formatos" },
  { valor: "carrossel", rotulo: "Carrossel" },
  { valor: "estatico", rotulo: "Estático" },
  { valor: "foto", rotulo: "Foto" },
  { valor: "video", rotulo: "Vídeo / Reels" },
  { valor: "story", rotulo: "Stories" },
  { valor: "outro", rotulo: "Outros / sem formato" },
];

export function formatoDoTrendy(formato: string | undefined): FormatoDoTrendy {
  const f = semAcento(formato || "");
  if (/carrossel|carousel/.test(f)) return "carrossel";
  if (/reels?|video|short/.test(f)) return "video";
  if (/story|stories/.test(f)) return "story";
  if (/foto/.test(f)) return "foto";
  if (/estatico|static|post unico/.test(f)) return "estatico";
  return "outro";
}

/** Uma resposta atrasada de outro cliente nunca preenche o Trendy atual. */
export function dadosDoTrendy(dados: HypesDaSemana | null | undefined, clientId: string): HypesDaSemana | null {
  return dados?.client_id === clientId ? dados : null;
}

export function itensDoTrendy(itens: Hype[], ganchos: string[]): ItemDoTrendy[] {
  return itens.map((h, indice) => ({ h, indice })).filter(({ h }) => !hypeNaAgenda(h.titulo, ganchos));
}

export function filtrarTrendy(itens: ItemDoTrendy[], filtros: FiltrosDoTrendy): ItemDoTrendy[] {
  const termos = semAcento(filtros.busca).split(" ").filter(Boolean);
  return itens.filter(({ h }) => {
    const tipo = h.tipo === "nicho" ? "nicho" : "momento";
    if (filtros.tipo !== "todos" && filtros.tipo !== tipo) return false;
    if (filtros.formato !== "todos" && filtros.formato !== formatoDoTrendy(h.formato)) return false;
    const texto = semAcento([h.titulo, h.o_que_e, h.por_que_agora, h.como_usar, h.sinal, h.fonte, h.formato, h.pauta?.tema, h.pauta?.gancho].filter(Boolean).join(" "));
    return termos.every((termo) => texto.includes(termo));
  });
}
