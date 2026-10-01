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
  /**
   * Como a luz se espalha pela BORDA da logo (a silhueta: pixel opaco que encosta no transparente),
   * em faixas de luma com o peso de cada uma. Com ela, a regra também confere se um PEDAÇO da logo
   * some na superfície (ex.: o "iq" verde de uma logo branca e verde sobre um fundo verde): a média
   * passa, mas a marca fica ilegível. O miolo de dentro de uma forma (texto branco num selo
   * colorido, preenchimento branco de uma logo preta) não conta: quem encosta na superfície é a
   * forma de fora, e a versão chapada apagaria justamente esse miolo.
   */
  distribuicao?: Array<{ luma: number; peso: number }> | null;
}

/** Parte da logo (0..1) que pode sumir na superfície antes de a versão ser recusada. */
export const PARTE_ILEGIVEL_MAXIMA = 0.08;
/** Contraste abaixo do qual um pedaço da logo conta como ilegível. */
export const CONTRASTE_DO_PEDACO = 1.35;

/** Alfa abaixo do qual o pixel conta como transparente. */
const ALFA_VAZIO = 0.1;

/**
 * Pixel opaco que encosta no transparente (vizinho de 8, ou a beirada da imagem): a silhueta.
 * Sem `largura`, a imagem é tratada como uma linha só (todo pixel encosta na beirada).
 */
function naSilhueta(pixels: Uint8ClampedArray | Uint8Array, largura: number, altura: number, x: number, y: number): boolean {
  if (x === 0 || y === 0 || x === largura - 1 || y === altura - 1) return true;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      if (pixels[((y + dy) * largura + (x + dx)) * 4 + 3] / 255 < ALFA_VAZIO) return true;
    }
  }
  return false;
}

/**
 * Distribuição da luma da silhueta da logo em 16 faixas, pesada pelo alfa (pixel transparente e
 * miolo não contam). `largura` é a largura da imagem em pixels: sem ela, conta a logo inteira.
 */
export function distribuicaoDaLogo(pixels: Uint8ClampedArray | Uint8Array, largura?: number, faixas = 16): Array<{ luma: number; peso: number }> {
  const pesos = new Array(faixas).fill(0);
  const somas = new Array(faixas).fill(0);
  const total = Math.floor(pixels.length / 4);
  const w = largura && largura > 0 && total % largura === 0 ? Math.floor(largura) : total;
  const h = w ? Math.floor(total / w) : 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3] / 255;
    if (a < ALFA_VAZIO) continue;
    const n = i / 4;
    if (!naSilhueta(pixels, w, h, n % w, Math.floor(n / w))) continue;
    const l = luma(pixels[i], pixels[i + 1], pixels[i + 2]);
    const k = Math.min(faixas - 1, Math.floor(l * faixas));
    pesos[k] += a;
    somas[k] += l * a;
  }
  const soma = pesos.reduce((t, p) => t + p, 0);
  if (!soma) return [];
  return pesos.map((p, k) => ({ luma: p ? somas[k] / p : (k + 0.5) / faixas, peso: p / soma })).filter((f) => f.peso > 0);
}

/** Quanto da silhueta da logo (0..1) fica sem contraste nesta superfície. */
export function parteIlegivel(distribuicao: Array<{ luma: number; peso: number }> | null | undefined, superficie: number): number {
  if (!distribuicao || !distribuicao.length) return 0;
  return distribuicao.reduce((t, f) => t + (contraste(f.luma, superficie) < CONTRASTE_DO_PEDACO ? f.peso : 0), 0);
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
  let somePedaco: string | null = null;
  for (const l of logos) {
    const lu = lumaEstimada(l);
    if (lu === null) continue;
    const c = contraste(lu, superficie);
    // A média passa, mas um pedaço some (o verde da logo no fundo verde): esta versão não serve.
    const some = parteIlegivel(l.distribuicao, superficie);
    if (some > PARTE_ILEGIVEL_MAXIMA) {
      somePedaco = `${Math.round(some * 100)}% da logo ${l.id} some na superfície`;
      continue;
    }
    if (!melhor || c > melhor.c) melhor = { logo: l, c };
  }
  if (melhor && melhor.c >= minimo) {
    return { variante: { tipo: "original", id: melhor.logo.id }, contraste: melhor.c, motivo: `logo ${melhor.logo.id} com contraste ${melhor.c.toFixed(1)}` };
  }
  const c = contraste(escura ? 1 : 0, superficie);
  const versao = escura ? "branca" : "preta";
  return {
    variante: chapada,
    contraste: c,
    motivo: somePedaco && !melhor ? `${somePedaco}: versão ${versao}` : melhor ? `nenhuma logo do kit passa de ${minimo}: versão ${versao}` : `sem medida da logo: versão ${versao}`,
  };
}
