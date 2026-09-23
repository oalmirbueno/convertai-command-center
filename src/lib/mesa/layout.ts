/**
 * Esqueleto de layout das lâminas na prancheta do Estúdio.
 *
 * Mesmas zonas e margens do compositor de prompt
 * (supabase/functions/_shared/direcao-arte.ts), em percentual do quadro 4:5:
 * o que a tela mostra antes de gerar é o que o gerador recebe como posição.
 */

export type ZonaTexto =
  | "topo-esquerda" | "topo-centro" | "centro-esquerda" | "centro" | "base-esquerda" | "base-centro" | "base-direita" | "coluna-esquerda" | "coluna-direita";

export interface LayoutLamina {
  zona_texto?: ZonaTexto | string;
  alinhamento?: "esquerda" | "centro" | "direita" | string;
  imagem?: string;
  ponto_focal?: string;
  fundo?: string;
  tratamento?: string;
  cor_fundo?: string | null;
  cor_texto?: string | null;
  cor_destaque?: string | null;
}

export interface BlocoTexto {
  papel: "headline" | "subtitulo" | "apoio" | "numero" | "cta" | "selo" | string;
  texto: string;
}

export interface Caixa {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const MARGEM_X = 8.3;
const MARGEM_TOPO = 7.4;
const MARGEM_BASE = 7.9;
const CAPA_EXTRA = 3.1;
const um = (v: number) => Math.round(v * 10) / 10;

/** Caixa do texto (percentual do quadro) para a zona, igual ao compositor. */
export function caixaDaZona(zona: string | undefined, capa: boolean, carrossel = true): Caixa {
  const extra = capa ? CAPA_EXTRA : 0;
  const esq = MARGEM_X + extra;
  const dir = 100 - MARGEM_X - extra;
  // Zonas que chegam ao lado direito no topo descem abaixo do contador do carrossel.
  const topo = carrossel && (zona === "topo-centro" || zona === "coluna-direita") ? 8.9 : MARGEM_TOPO;
  const base = 100 - MARGEM_BASE;
  const altura = base - topo;
  const largura = dir - esq;
  const terco = um(altura / 3);
  switch (zona) {
    case "topo-esquerda": return { x0: esq, x1: esq + um(largura * 0.78), y0: topo, y1: topo + um(altura * 0.42) };
    case "topo-centro": return { x0: esq, x1: dir, y0: topo, y1: topo + um(altura * 0.4) };
    case "centro-esquerda": return { x0: esq, x1: esq + um(largura * 0.72), y0: topo + terco - 3, y1: topo + 2 * terco + 3 };
    case "centro": return { x0: esq, x1: dir, y0: topo + terco - 3, y1: topo + 2 * terco + 3 };
    case "base-centro": return { x0: esq, x1: dir, y0: base - um(altura * 0.42), y1: base };
    case "base-direita": return { x0: esq + um(largura * 0.25), x1: dir, y0: base - um(altura * 0.45), y1: base };
    case "coluna-esquerda": return { x0: esq, x1: esq + um(largura * 0.5), y0: topo, y1: base };
    case "coluna-direita": return { x0: dir - um(largura * 0.5), x1: dir, y0: topo, y1: base };
    default: return { x0: esq, x1: esq + um(largura * 0.8), y0: base - um(altura * 0.45), y1: base };
  }
}

/** Zona padrão quando a direção antiga não tem layout (mesma regra do compositor). */
export function zonaPadrao(funcao: string | undefined, ordem: number, total: number): ZonaTexto {
  if (funcao === "capa" || ordem === 1) return "base-esquerda";
  if (funcao === "cta" || ordem === total) return "centro";
  const giro: ZonaTexto[] = ["topo-esquerda", "coluna-esquerda", "base-esquerda", "centro-esquerda"];
  return giro[(ordem - 2) % giro.length];
}

/** Blocos a partir do texto exato quando a direção não trouxe os blocos. */
export function blocosDoTexto(textoExato: string, funcao?: string): BlocoTexto[] {
  const linhas = (textoExato || "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!linhas.length) return [];
  let headline = "";
  let i = 0;
  while (i < linhas.length && i < 3 && (headline + " " + linhas[i]).trim().length <= 60) {
    headline = headline ? headline + "\n" + linhas[i] : linhas[i];
    i++;
  }
  if (!headline) {
    headline = linhas[0];
    i = 1;
  }
  const blocos: BlocoTexto[] = [{ papel: "headline", texto: headline }];
  const resto = linhas.slice(i);
  resto.forEach((l, k) => {
    const ultimo = k === resto.length - 1;
    blocos.push({ papel: funcao === "cta" && ultimo ? "cta" : k === 0 && l.length <= 70 ? "subtitulo" : "apoio", texto: l });
  });
  return blocos;
}

/** Altura relativa de cada papel no esqueleto (proporcional ao tamanho de letra do compositor). */
export const ESCALA_DO_PAPEL: Record<string, number> = {
  headline: 1,
  numero: 1.6,
  subtitulo: 0.42,
  apoio: 0.3,
  cta: 0.38,
  selo: 0.24,
};
