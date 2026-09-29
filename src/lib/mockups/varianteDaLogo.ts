/**
 * Qual versão da logo vai em cada superfície: regra fixa, sem IA.
 *
 * Mede o contraste (WCAG) entre a logo e o que fica embaixo dela: a superfície do mockup (slot
 * "só a logo": camiseta, caneca, vitrine) ou a cor de fundo do design (slot "arte"). Fica a logo
 * do kit com mais contraste; se nenhuma passa do mínimo, vai a versão chapada branca (superfície
 * escura) ou preta (superfície clara), feita pelo código a partir da própria logo.
 */

export type TomDaLogo = "clara" | "escura" | null | undefined;

export interface LogoDoKit {
  /** Identificador livre (ex.: "principal", "alternativa"). */
  id: string;
  /** Tom gravado no kit (cliente_kit_marca.logo_tom): clara vai sobre fundo escuro. */
  tom?: TomDaLogo;
  /** Luminância medida na imagem (0..1), média ponderada pelo alfa. Vence o tom quando existe. */
  luminancia?: number | null;
}

export type VarianteDaLogo = { tipo: "original"; id: string } | { tipo: "branca" } | { tipo: "preta" };

export interface EscolhaDaVariante {
  variante: VarianteDaLogo;
  /** Contraste da escolha (1..21). */
  contraste: number;
  motivo: string;
}

export const CONTRASTE_MINIMO = 2.2;

/** Luma (0..1) de um RGB em 0..255: a mesma conta de psd_mockup.py (luminancia). */
export function luma(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Luma de uma cor #rrggbb (ou #rgb). Cor inválida: null. */
export function lumaDoHex(hex: string | null | undefined): number | null {
  const m = String(hex || "").trim().replace(/^#/, "");
  const cheio = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  if (!/^[0-9a-fA-F]{6}$/.test(cheio)) return null;
  const n = parseInt(cheio, 16);
  return luma((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

/** Luma para luminância relativa (aproximação sRGB, gama 2,2). */
function linear(l: number): number {
  return Math.pow(Math.max(0, Math.min(1, l)), 2.2);
}

/** Razão de contraste WCAG entre duas lumas (1 a 21). */
export function contraste(l1: number, l2: number): number {
  const a = linear(l1);
  const b = linear(l2);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Luminância média da logo, pesada pelo alfa (pixels RGBA). Logo vazia: null. */
export function lumaDaLogo(pixels: Uint8ClampedArray | Uint8Array): number | null {
  let soma = 0;
  let peso = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3] / 255;
    if (a < 0.1) continue;
    soma += luma(pixels[i], pixels[i + 1], pixels[i + 2]) * a;
    peso += a;
  }
  return peso > 0 ? soma / peso : null;
}

function lumaEstimada(l: LogoDoKit): number | null {
  if (typeof l.luminancia === "number" && Number.isFinite(l.luminancia)) return l.luminancia;
  if (l.tom === "clara") return 0.9;
  if (l.tom === "escura") return 0.1;
  return null;
}

/**
 * A regra. `superficie` é a luma (0..1) do que fica embaixo da logo; null = desconhecida
 * (fica a primeira logo do kit, como veio).
 */
export function escolherVarianteDaLogo(superficie: number | null | undefined, logos: LogoDoKit[], minimo = CONTRASTE_MINIMO): EscolhaDaVariante {
  const escura = typeof superficie === "number" ? superficie < 0.5 : false;
  const chapada: VarianteDaLogo = escura ? { tipo: "branca" } : { tipo: "preta" };
  if (typeof superficie !== "number" || !Number.isFinite(superficie)) {
    if (logos.length) return { variante: { tipo: "original", id: logos[0].id }, contraste: 1, motivo: "superfície desconhecida: logo do kit" };
    return { variante: { tipo: "preta" }, contraste: 1, motivo: "sem logo no kit" };
  }
  let melhor: { logo: LogoDoKit; c: number } | null = null;
  for (const l of logos) {
    const lu = lumaEstimada(l);
    if (lu === null) continue;
    const c = contraste(lu, superficie);
    if (!melhor || c > melhor.c) melhor = { logo: l, c };
  }
  if (melhor && melhor.c >= minimo) {
    return { variante: { tipo: "original", id: melhor.logo.id }, contraste: melhor.c, motivo: `logo ${melhor.logo.id} com contraste ${melhor.c.toFixed(1)}` };
  }
  const c = contraste(escura ? 1 : 0, superficie);
  return {
    variante: chapada,
    contraste: c,
    motivo: melhor ? `nenhuma logo do kit passa de ${minimo}: versão ${escura ? "branca" : "preta"}` : `sem medida da logo: versão ${escura ? "branca" : "preta"}`,
  };
}
