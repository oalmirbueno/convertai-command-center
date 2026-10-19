import type { TipoDeAdesivo } from "./storiesApi";

/**
 * O desenho do story 9:16, num lugar só: a prévia da tela (DOM) e a arte do
 * canvas (1080 x 1920) usam as mesmas frações, então o que a equipe vê no
 * cartão é o que sai no PNG.
 *
 * Zona segura (supabase/functions/_shared/direcao-arte.ts): 14% livres em cima
 * (barra de progresso e perfil) e 20% embaixo (responder e enviar). O texto
 * fica logo abaixo da zona de cima; o adesivo, no meio para baixo, sem nada
 * desenhado na arte (a equipe põe o adesivo no app).
 */

export const TAMANHO_DO_STORY = { largura: 1080, altura: 1920 } as const;

export const ZONA_SEGURA = { topo: 0.14, baixo: 0.2 } as const;

export const LAYOUT_DO_TEXTO = {
  /** Margem dos lados (fração da largura). */
  margem: 0.08,
  /** Onde o texto começa (fração da altura), logo abaixo da zona de cima. */
  topo: 0.17,
  /** Corpo da letra (fração da largura) e o menor aceito quando o texto é longo. */
  corpo: 0.062,
  corpoMinimo: 0.042,
  /** Altura da linha (vezes o corpo). */
  entrelinha: 1.28,
  /** Mais que isto, a letra encolhe. */
  linhasMaximas: 4,
  /** Respiro do fundo do texto sobre a foto (vezes o corpo). */
  respiro: 0.32,
} as const;

/** Área reservada ao adesivo (frações): centro na vertical, largura e altura por tipo. */
export function areaDoAdesivo(tipo: TipoDeAdesivo): { centroY: number; largura: number; altura: number } | null {
  switch (tipo) {
    case "enquete":
      return { centroY: 0.6, largura: 0.7, altura: 0.17 };
    case "caixinha":
      return { centroY: 0.6, largura: 0.7, altura: 0.17 };
    case "quiz":
      return { centroY: 0.6, largura: 0.7, altura: 0.24 };
    case "contagem":
      return { centroY: 0.6, largura: 0.7, altura: 0.15 };
    case "reacao":
      return { centroY: 0.6, largura: 0.7, altura: 0.13 };
    case "link":
    case "localizacao":
    case "mencao":
      return { centroY: 0.62, largura: 0.5, altura: 0.055 };
    default:
      return null;
  }
}

/** A área do adesivo nunca entra nas zonas seguras. */
export function adesivoNaZonaSegura(tipo: TipoDeAdesivo): boolean {
  const a = areaDoAdesivo(tipo);
  if (!a) return true;
  return a.centroY - a.altura / 2 >= ZONA_SEGURA.topo && a.centroY + a.altura / 2 <= 1 - ZONA_SEGURA.baixo;
}

/** #rrggbb válido (ou null). */
export function hexValido(v: string | null | undefined): string | null {
  const s = String(v || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return `#${s.charAt(1)}${s.charAt(1)}${s.charAt(2)}${s.charAt(2)}${s.charAt(3)}${s.charAt(3)}`.toLowerCase();
  return null;
}

/** Luminância relativa (0 a 1) de um #rrggbb. */
export function luminancia(hex: string): number {
  const h = hexValido(hex) || "#000000";
  const canal = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
}

/** Contraste entre duas cores (1 a 21). */
export function contraste(a: string, b: string): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * A cor da letra sobre um fundo: a cor da marca que mais contrasta (se
 * passar de 4,5) ou, sem nenhuma boa, branco ou quase preto.
 */
export function corDaLetra(fundo: string, paleta: string[]): string {
  let melhor: string | null = null;
  let nota = 0;
  for (const c of paleta) {
    const h = hexValido(c);
    if (!h || h === hexValido(fundo)) continue;
    const n = contraste(fundo, h);
    if (n > nota) {
      nota = n;
      melhor = h;
    }
  }
  if (melhor && nota >= 4.5) return melhor;
  return contraste(fundo, "#ffffff") >= contraste(fundo, "#111111") ? "#ffffff" : "#111111";
}

/**
 * Quebra o texto em linhas que cabem na largura (medir devolve a largura de um
 * pedaço). Quebra de linha escrita pela equipe vale.
 */
export function quebrarEmLinhas(texto: string, largura: number, medir: (t: string) => number): string[] {
  const linhas: string[] = [];
  for (const paragrafo of String(texto || "").split("\n")) {
    const palavras = paragrafo.split(" ").filter(Boolean);
    let atual = "";
    for (const p of palavras) {
      const tentativa = atual ? `${atual} ${p}` : p;
      if (!atual || medir(tentativa) <= largura) atual = tentativa;
      else {
        linhas.push(atual);
        atual = p;
      }
    }
    if (atual) linhas.push(atual);
  }
  return linhas;
}
