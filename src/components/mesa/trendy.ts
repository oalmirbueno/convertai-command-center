import type { Hype, HypesDaSemana } from "./mesaV4Api";
import { hypeNaAgenda, semAcento } from "./momentoDoGancho";
import { dominioDoLink, linkSeguro } from "./mesaV4Api";

/**
 * Trendy (Codex, ce942b77): busca e filtros locais sobre a leitura semanal gravada (mesa_hypes), sem nova
 * chamada de IA; o índice original segue junto para "Criar campanha". 21/10/2026, 4ª visão do Hype e Trending:
 * o formato só oferece os que existem nos dados (antes Foto, Vídeo, Stories e Outros ficavam sempre vazios) e
 * entrou o filtro de fonte (domínio do link).
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

export type TipoDoTrendy = "todos" | "momento" | "nicho";
export type FormatoDoTrendy = "todos" | "carrossel" | "estatico" | "foto" | "video" | "story" | "outro";
export interface FiltrosDoTrendy { tipo: TipoDoTrendy; formato: FormatoDoTrendy; busca: string; fonte: string }
export const FILTROS_INICIAIS_DO_TRENDY: FiltrosDoTrendy = { tipo: "todos", formato: "todos", busca: "", fonte: "" };
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

/** Só os formatos que existem nos itens ("Todos" sempre primeiro). */
export function formatosPresentes(itens: ItemDoTrendy[]): { valor: FormatoDoTrendy; rotulo: string }[] {
  const tem: Record<string, true> = {};
  itens.forEach(({ h }) => { tem[formatoDoTrendy(h.formato)] = true; });
  return FORMATOS_DO_TRENDY.filter((f) => f.valor === "todos" || tem[f.valor]);
}

/** A fonte do item: o domínio do link (ou vazio). */
export function fonteDoTrendy(h: Hype): string {
  const link = linkSeguro(h.fonte);
  return link ? dominioDoLink(link) : "";
}

export function fontesPresentes(itens: ItemDoTrendy[]): string[] {
  const vistas: Record<string, true> = {};
  return itens.map(({ h }) => fonteDoTrendy(h)).filter((f) => f && !vistas[f] && (vistas[f] = true)).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export function filtrarTrendy(itens: ItemDoTrendy[], filtros: FiltrosDoTrendy): ItemDoTrendy[] {
  const termos = semAcento(filtros.busca).split(" ").filter(Boolean);
  return itens.filter(({ h }) => {
    const tipo = h.tipo === "nicho" ? "nicho" : "momento";
    if (filtros.tipo !== "todos" && filtros.tipo !== tipo) return false;
    if (filtros.formato !== "todos" && filtros.formato !== formatoDoTrendy(h.formato)) return false;
    if (filtros.fonte && fonteDoTrendy(h) !== filtros.fonte) return false;
    const texto = semAcento([h.titulo, h.o_que_e, h.por_que_agora, h.como_usar, h.sinal, h.fonte, h.formato, h.pauta?.tema, h.pauta?.gancho].filter(Boolean).join(" "));
    return termos.every((termo) => texto.includes(termo));
  });
}

/** Relevância ao cliente: nota do Jev da leitura, maior primeiro; sem nota no fim; empate mantém a ordem. */
export function ordenarPelaNota(itens: ItemDoTrendy[]): ItemDoTrendy[] {
  const nota = (x: ItemDoTrendy) => (typeof x.h.nota === "number" && isFinite(x.h.nota) ? x.h.nota : -1);
  return itens.map((x, i) => ({ x, i })).sort((a, b) => nota(b.x) - nota(a.x) || a.i - b.i).map((y) => y.x);
}
