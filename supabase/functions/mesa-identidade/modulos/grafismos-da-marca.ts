/**
 * Grafismos e padrões gerados por código (frente IDV2, 30/09/2026): SVG
 * feito aqui, com as cores da marca, sem gerador de imagem (a regra "logo
 * pelo código" vale também para o que é geométrico). O mesmo SVG vai para a
 * tela (prévia), para o pacote da marca (vetor) e vira PNG no navegador para
 * o PDF e a página.
 *
 * Puro: sem Deno, sem banco. Sem lookbehind, sem \p{} (Safari 11).
 */

import { normalizarHex } from "../../_shared/cores-da-marca.ts";

export const TIPOS_DE_PADRAO = [
  { valor: "pontos", rotulo: "Pontos" },
  { valor: "listras", rotulo: "Listras diagonais" },
  { valor: "ondas", rotulo: "Ondas" },
  { valor: "xadrez", rotulo: "Xadrez" },
  { valor: "circulos", rotulo: "Círculos" },
  { valor: "triangulos", rotulo: "Triângulos" },
  { valor: "grade", rotulo: "Grade" },
  { valor: "arcos", rotulo: "Arcos" },
  { valor: "monograma", rotulo: "Monograma" },
] as const;

export type TipoDePadrao = (typeof TIPOS_DE_PADRAO)[number]["valor"];

export function ehTipoDePadrao(v: unknown): v is TipoDePadrao {
  return typeof v === "string" && TIPOS_DE_PADRAO.some((t) => t.valor === v);
}

export type OpcoesDoPadrao = {
  tipo: TipoDePadrao;
  /** Fundo, forma e (opcional) apoio, em #RRGGBB. */
  fundo: string;
  forma: string;
  apoio?: string | null;
  /** Tamanho da célula em px (12 a 160). */
  escala?: number;
  /** Espessura relativa (0,1 a 0,9). */
  peso?: number;
  /** Giro do padrão em graus (0 a 180). */
  giro?: number;
  /** Letra do monograma (1 ou 2 caracteres). */
  letra?: string;
  /** Família da letra do monograma (a do título da marca). */
  familia?: string;
  largura?: number;
  altura?: number;
};

const num = (v: unknown, padrao: number, min: number, max: number) => {
  const n = Number(v);
  return isFinite(n) ? Math.max(min, Math.min(max, n)) : padrao;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Texto seguro dentro do SVG (a letra do monograma). */
export function escaparXml(s: string): string {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** O desenho de uma célula do padrão (s = tamanho da célula). */
function celula(tipo: TipoDePadrao, s: number, peso: number, forma: string, apoio: string, letra: string, familia: string): string {
  const w = r2(Math.max(1, s * peso * 0.5));
  switch (tipo) {
    case "pontos":
      return `<circle cx="${r2(s / 2)}" cy="${r2(s / 2)}" r="${r2(Math.max(1, s * peso * 0.3))}" fill="${forma}"/>`;
    case "listras":
      return `<rect x="0" y="0" width="${w}" height="${s}" fill="${forma}"/>`;
    case "ondas":
      return `<path d="M0 ${r2(s / 2)} Q ${r2(s / 4)} ${r2(s / 2 - s * 0.3)} ${r2(s / 2)} ${r2(s / 2)} T ${s} ${r2(s / 2)}" fill="none" stroke="${forma}" stroke-width="${r2(Math.max(1, s * peso * 0.2))}" stroke-linecap="round"/>`;
    case "xadrez":
      return `<rect x="0" y="0" width="${r2(s / 2)}" height="${r2(s / 2)}" fill="${forma}"/><rect x="${r2(s / 2)}" y="${r2(s / 2)}" width="${r2(s / 2)}" height="${r2(s / 2)}" fill="${apoio}"/>`;
    case "circulos":
      return `<circle cx="${r2(s / 2)}" cy="${r2(s / 2)}" r="${r2(s * 0.4)}" fill="none" stroke="${forma}" stroke-width="${r2(Math.max(1, s * peso * 0.12))}"/><circle cx="${r2(s / 2)}" cy="${r2(s / 2)}" r="${r2(s * 0.2)}" fill="none" stroke="${apoio}" stroke-width="${r2(Math.max(1, s * peso * 0.12))}"/>`;
    case "triangulos":
      return `<path d="M0 ${s} L ${r2(s / 2)} ${r2(s * (1 - peso * 0.9))} L ${s} ${s} Z" fill="${forma}"/>`;
    case "grade":
      return `<path d="M ${s} 0 L 0 0 0 ${s}" fill="none" stroke="${forma}" stroke-width="${r2(Math.max(1, s * peso * 0.08))}"/>`;
    case "arcos":
      return `<path d="M0 ${s} A ${r2(s / 2)} ${r2(s / 2)} 0 0 1 ${s} ${s}" fill="none" stroke="${forma}" stroke-width="${r2(Math.max(1, s * peso * 0.16))}"/><path d="M${r2(s * 0.2)} ${s} A ${r2(s * 0.3)} ${r2(s * 0.3)} 0 0 1 ${r2(s * 0.8)} ${s}" fill="none" stroke="${apoio}" stroke-width="${r2(Math.max(1, s * peso * 0.16))}"/>`;
    case "monograma":
      return `<text x="${r2(s / 2)}" y="${r2(s / 2)}" text-anchor="middle" dominant-baseline="central" font-family="${escaparXml(familia)}, Helvetica, Arial, sans-serif" font-weight="700" font-size="${r2(s * (0.3 + peso * 0.5))}" fill="${forma}">${escaparXml(letra)}</text>`;
  }
  return "";
}

/**
 * O SVG do padrão (retângulo de largura x altura preenchido pelo pattern).
 * Cor inválida vira a padrão; tamanho fora da faixa é trazido para dentro.
 */
export function svgDoPadrao(o: OpcoesDoPadrao): string {
  const tipo = ehTipoDePadrao(o.tipo) ? o.tipo : "pontos";
  const fundo = normalizarHex(o.fundo) || "#F4F6F4";
  const forma = normalizarHex(o.forma) || "#151B17";
  const apoio = normalizarHex(o.apoio) || forma;
  const s = Math.round(num(o.escala, 48, 12, 160));
  const peso = num(o.peso, 0.4, 0.1, 0.9);
  const giro = Math.round(num(o.giro, tipo === "listras" ? 45 : 0, 0, 180));
  const L = Math.round(num(o.largura, 1200, 64, 4000));
  const A = Math.round(num(o.altura, 1200, 64, 4000));
  const letra = String(o.letra || "A").replace(/\s+/g, "").slice(0, 2) || "A";
  const familia = String(o.familia || "Helvetica").replace(/[^A-Za-z0-9 ]+/g, "").slice(0, 40) || "Helvetica";
  const id = `p-${tipo}`;
  const transformacao = giro ? ` patternTransform="rotate(${giro})"` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${L}" height="${A}" viewBox="0 0 ${L} ${A}">` +
    `<defs><pattern id="${id}" width="${s}" height="${s}" patternUnits="userSpaceOnUse"${transformacao}>${celula(tipo, s, peso, forma, apoio, letra, familia)}</pattern></defs>` +
    `<rect width="100%" height="100%" fill="${fundo}"/><rect width="100%" height="100%" fill="url(#${id})"/></svg>`
  );
}

/** data URL do SVG (para <img> na tela e para desenhar no canvas). */
export function dataUrlDoSvg(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Nome curto e descrição de uso para o manual. */
export function descricaoDoPadrao(o: Pick<OpcoesDoPadrao, "tipo" | "escala">): string {
  const t = TIPOS_DE_PADRAO.filter((x) => x.valor === o.tipo)[0];
  return `${t ? t.rotulo : "Padrão"} gerado com as cores da marca. Use em fundos, embalagens e respiros; nunca atrás da logo sem área de proteção.`;
}
