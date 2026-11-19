/**
 * Ateliê de Cor (19/11/2026): a matemática da cor, sem IA e sem rede.
 *
 * OKLab/OKLCH (Björn Ottosson, 2020; CSS Color 4) para gerar tons e medir
 * distância, porque o L do OKLCH é a luminosidade percebida e o matiz não
 * escorrega quando o tom clareia ou escurece (o HSL suja o azul e estoura o
 * amarelo). Contraste pela luminância relativa da WCAG 2.2 e, como segunda
 * opinião, o Lc do APCA (SAPC 0.0.98G). Daltonismo pelas matrizes de Machado,
 * Oliveira e Fernandes (2009), severidade 1, aplicadas no RGB linear.
 *
 * Fontes: bottosson.github.io/posts/oklab · bottosson.github.io/posts/gamutclipping
 * · w3.org/WAI/WCAG22/Understanding/relative-luminance.html · github.com/Myndex/apca-w3
 * · inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html
 *
 * Puro: roda na tela (Vite) e nas funções (Deno). Sem lookbehind, sem \p{}.
 */

export type Rgb = { r: number; g: number; b: number };
export type Oklch = { l: number; c: number; h: number };

const HEX6 = /^#?([0-9a-fA-F]{6})$/;
const HEX3 = /^#?([0-9a-fA-F]{3})$/;

/** "#abc", "abc", "#AABBCC" viram "#AABBCC"; o que não for cor vira null. */
export function hexValido(v: unknown): string | null {
  const s = String(v ?? "").trim();
  const m6 = HEX6.exec(s);
  if (m6) return `#${m6[1].toUpperCase()}`;
  const m3 = HEX3.exec(s);
  if (m3) return `#${m3[1].split("").map((x) => x + x).join("").toUpperCase()}`;
  return null;
}

export function hexParaRgb(hex: string): Rgb {
  const h = hexValido(hex) ?? "#000000";
  return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) };
}

function doisDigitos(n: number): string {
  const v = Math.max(0, Math.min(255, Math.round(n)));
  return (v < 16 ? "0" : "") + v.toString(16);
}

export function rgbParaHex({ r, g, b }: Rgb): string {
  return `#${doisDigitos(r)}${doisDigitos(g)}${doisDigitos(b)}`.toUpperCase();
}

const paraLinear = (c: number) => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
};
const deLinear = (x: number) => 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);

function linearParaOklab(r: number, g: number, b: number) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function oklabParaLinear(L: number, a: number, b: number) {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

export function hexParaOklch(hex: string): Oklch {
  const { r, g, b } = hexParaRgb(hex);
  const o = linearParaOklab(paraLinear(r), paraLinear(g), paraLinear(b));
  const c = Math.sqrt(o.a * o.a + o.b * o.b);
  let h = (Math.atan2(o.b, o.a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: o.L, c, h: c < 1e-4 ? 0 : h };
}

function oklchParaLinear({ l, c, h }: Oklch) {
  const rad = (h * Math.PI) / 180;
  return oklabParaLinear(l, c * Math.cos(rad), c * Math.sin(rad));
}

const EPS = 1e-6;
export function cabeNoSrgb(cor: Oklch): boolean {
  const { r, g, b } = oklchParaLinear(cor);
  return r >= -EPS && r <= 1 + EPS && g >= -EPS && g <= 1 + EPS && b >= -EPS && b <= 1 + EPS;
}

/**
 * Traz a cor para dentro do sRGB reduzindo só o croma (mantém L e matiz), o
 * método do CSS Color 4. Cortar o RGB direto mudaria o matiz.
 */
export function noGamut(cor: Oklch): Oklch {
  const l = Math.max(0, Math.min(1, cor.l));
  const h = ((cor.h % 360) + 360) % 360;
  if (cabeNoSrgb({ l, c: cor.c, h })) return { l, c: Math.max(0, cor.c), h };
  let lo = 0;
  let hi = Math.max(0, cor.c);
  for (let i = 0; i < 24; i++) {
    const meio = (lo + hi) / 2;
    if (cabeNoSrgb({ l, c: meio, h })) lo = meio;
    else hi = meio;
  }
  return { l, c: lo, h };
}

export function oklchParaHex(cor: Oklch): string {
  const { r, g, b } = oklchParaLinear(noGamut(cor));
  const lim = (x: number) => Math.max(0, Math.min(1, x));
  return rgbParaHex({ r: deLinear(lim(r)), g: deLinear(lim(g)), b: deLinear(lim(b)) });
}

/** Maior croma que cabe no sRGB para este L e matiz. */
export function cromaMaximo(l: number, h: number): number {
  return noGamut({ l, c: 0.4, h }).c;
}

export function textoOklch(hex: string): string {
  const o = hexParaOklch(hex);
  return `oklch(${(o.l * 100).toFixed(1)}% ${o.c.toFixed(3)} ${o.h.toFixed(1)})`;
}

/** ΔE no OKLab (0 igual; ~0,02 mal se nota; acima de 0,1 bem diferente). */
export function distancia(a: string, b: string): number {
  const x = hexParaRgb(a);
  const y = hexParaRgb(b);
  const p = linearParaOklab(paraLinear(x.r), paraLinear(x.g), paraLinear(x.b));
  const q = linearParaOklab(paraLinear(y.r), paraLinear(y.g), paraLinear(y.b));
  return Math.sqrt((p.L - q.L) ** 2 + (p.a - q.a) ** 2 + (p.b - q.b) ** 2);
}

/** Diferença de matiz em graus (0 a 180). */
export function difMatiz(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

// ------------------------------------------------------------------ contraste

export function luminancia(hex: string): number {
  const { r, g, b } = hexParaRgb(hex);
  return 0.2126 * paraLinear(r) + 0.7152 * paraLinear(g) + 0.0722 * paraLinear(b);
}

/** Razão WCAG 2.2 (1 a 21). */
export function contraste(a: string, b: string): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export type NivelWcag = "AAA" | "AA" | "AA grande" | "reprovado";
export function nivelWcag(razao: number): NivelWcag {
  if (razao >= 7) return "AAA";
  if (razao >= 4.5) return "AA";
  if (razao >= 3) return "AA grande";
  return "reprovado";
}

/** Lc do APCA (texto sobre fundo). Positivo: texto escuro no claro; negativo: claro no escuro. */
export function apca(texto: string, fundo: string): number {
  const y = (hex: string) => {
    const { r, g, b } = hexParaRgb(hex);
    const f = (c: number) => Math.pow(c / 255, 2.4);
    const v = 0.2126729 * f(r) + 0.7151522 * f(g) + 0.072175 * f(b);
    return v > 0.022 ? v : v + Math.pow(0.022 - v, 1.414);
  };
  const yt = y(texto);
  const yf = y(fundo);
  if (Math.abs(yf - yt) < 0.0005) return 0;
  let s: number;
  if (yf > yt) {
    s = (Math.pow(yf, 0.56) - Math.pow(yt, 0.57)) * 1.14;
    return s < 0.1 ? 0 : (s - 0.027) * 100;
  }
  s = (Math.pow(yf, 0.65) - Math.pow(yt, 0.62)) * 1.14;
  return s > -0.1 ? 0 : (s + 0.027) * 100;
}

/** Leitura do APCA em palavras (corpo pede |Lc| 75, ideal 90; título grande 45). */
export function nivelApca(lc: number): string {
  const v = Math.abs(lc);
  if (v >= 90) return "ótimo para texto corrido";
  if (v >= 75) return "bom para texto corrido";
  if (v >= 60) return "bom para rótulos e subtítulos";
  if (v >= 45) return "só para títulos grandes";
  if (v >= 30) return "só para detalhe e texto desabilitado";
  return "não serve para texto";
}

/** Entre as candidatas, a que dá mais contraste sobre o fundo. */
export function melhorTexto(fundo: string, candidatas: string[] = ["#000000", "#FFFFFF"]): { hex: string; razao: number } {
  let melhor = { hex: candidatas[0], razao: contraste(candidatas[0], fundo) };
  for (const c of candidatas.slice(1)) {
    const r = contraste(c, fundo);
    if (r > melhor.razao) melhor = { hex: c, razao: r };
  }
  return melhor;
}

/**
 * Acha o tom mais próximo de `cor` (mesmo matiz, mesmo croma quando cabe) que
 * passa de `alvo` contra `outra`. Mexe só no L, para os dois lados, e devolve o
 * que andou menos. null se nem o preto nem o branco do matiz chegam lá.
 */
export function ajustarAteContraste(cor: string, outra: string, alvo: number): string | null {
  if (contraste(cor, outra) >= alvo) return hexValido(cor);
  const base = hexParaOklch(cor);
  const tentar = (para: 0 | 1): string | null => {
    const extremo = oklchParaHex({ ...base, l: para });
    if (contraste(extremo, outra) < alvo) return null;
    let lo = base.l;
    let hi = para;
    for (let i = 0; i < 30; i++) {
      const meio = (lo + hi) / 2;
      if (contraste(oklchParaHex({ ...base, l: meio }), outra) >= alvo) hi = meio;
      else lo = meio;
    }
    return oklchParaHex({ ...base, l: hi });
  };
  const escuro = tentar(0);
  const claro = tentar(1);
  if (escuro && claro) return distancia(escuro, cor) <= distancia(claro, cor) ? escuro : claro;
  return escuro ?? claro;
}

// ------------------------------------------------------------------ escala 50–950

export const DEGRAUS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
/** Curva de L parecida com a do Tailwind v4 (definido em OKLCH). */
const L_DOS_DEGRAUS = [0.975, 0.945, 0.895, 0.82, 0.72, 0.635, 0.555, 0.485, 0.415, 0.36, 0.265];
/** Croma relativo em sino: cheio no meio, baixo nas pontas. */
const C_DOS_DEGRAUS = [0.14, 0.26, 0.45, 0.68, 0.9, 1, 0.97, 0.88, 0.75, 0.62, 0.48];

export type Degrau = { degrau: number; hex: string; original: boolean };

/** Escala 50–950 com matiz constante; a cor original fica no degrau de L mais próximo, sem mudar. */
export function escala(hex: string): Degrau[] {
  const base = hexParaOklch(hex);
  let perto = 0;
  for (let i = 1; i < L_DOS_DEGRAUS.length; i++) {
    if (Math.abs(L_DOS_DEGRAUS[i] - base.l) < Math.abs(L_DOS_DEGRAUS[perto] - base.l)) perto = i;
  }
  const picoDoCroma = base.c / Math.max(0.2, C_DOS_DEGRAUS[perto]);
  return DEGRAUS.map((degrau, i) => {
    if (i === perto) return { degrau, hex: hexValido(hex) ?? "#000000", original: true };
    return { degrau, hex: oklchParaHex({ l: L_DOS_DEGRAUS[i], c: picoDoCroma * C_DOS_DEGRAUS[i], h: base.h }), original: false };
  });
}

// ------------------------------------------------------------------ harmonias

export type Harmonia = "complementar" | "dividida" | "analoga" | "triadica" | "tetradica" | "monocromatica";
export const HARMONIAS: Array<{ id: Harmonia; nome: string; graus: number[]; quando: string }> = [
  { id: "complementar", nome: "Complementar", graus: [0, 180], quando: "Contraste máximo: botão que salta sobre a cor da marca." },
  { id: "dividida", nome: "Complementar dividida", graus: [0, 150, 210], quando: "Contraste com menos tensão; a mais segura para marketing." },
  { id: "analoga", nome: "Análoga", graus: [-30, 0, 30], quando: "Calma e coesa; pede um destaque de fora para o botão." },
  { id: "triadica", nome: "Triádica", graus: [0, 120, 240], quando: "Vibrante; uma domina e as outras duas entram pouco." },
  { id: "tetradica", nome: "Tetrádica", graus: [0, 90, 180, 270], quando: "Rica e difícil de equilibrar; boa para ilustração e dados." },
  { id: "monocromatica", nome: "Monocromática", graus: [0, 0, 0], quando: "Um matiz só, variando claro e escuro; elegante e fácil." },
];

/** Cores da harmonia a partir da base, girando o matiz no OKLCH e mantendo L e C quando cabem. */
export function harmonia(hex: string, tipo: Harmonia): string[] {
  const base = hexParaOklch(hex);
  const def = HARMONIAS.find((x) => x.id === tipo) ?? HARMONIAS[0];
  if (tipo === "monocromatica") {
    return [0.3, base.l, 0.9].map((l, i) => (i === 1 ? hexValido(hex)! : oklchParaHex({ l, c: base.c * (i === 0 ? 0.8 : 0.35), h: base.h })));
  }
  return def.graus.map((g) => (g === 0 ? hexValido(hex)! : oklchParaHex({ ...base, h: base.h + g })));
}

// ------------------------------------------------------------------ daltonismo

export type Daltonismo = "protanopia" | "deuteranopia" | "tritanopia";
const MATRIZES: Record<Daltonismo, number[][]> = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
export const ROTULO_DALTONISMO: Record<Daltonismo, string> = {
  protanopia: "Protanopia (sem vermelho)",
  deuteranopia: "Deuteranopia (sem verde)",
  tritanopia: "Tritanopia (sem azul)",
};

export function simularDaltonismo(hex: string, tipo: Daltonismo): string {
  const { r, g, b } = hexParaRgb(hex);
  const v = [paraLinear(r), paraLinear(g), paraLinear(b)];
  const m = MATRIZES[tipo];
  const lim = (x: number) => Math.max(0, Math.min(1, x));
  const s = m.map((linha) => lim(linha[0] * v[0] + linha[1] * v[1] + linha[2] * v[2]));
  return rgbParaHex({ r: deLinear(s[0]), g: deLinear(s[1]), b: deLinear(s[2]) });
}

// ------------------------------------------------------------------ nome da cor

const MATIZES_NOMEADOS: Array<[number, string]> = [
  [15, "Rosa"], [45, "Vermelho"], [70, "Laranja"], [90, "Âmbar"], [112, "Amarelo"], [125, "Lima"],
  [165, "Verde"], [185, "Turquesa"], [215, "Ciano"], [275, "Azul"], [295, "Índigo"], [320, "Roxo"],
  [345, "Magenta"], [360, "Rosa"],
];

/**
 * Nome em português pela posição no OKLCH (matiz, luminosidade e croma). É
 * descritivo, para a tela e o prompt; a equipe pode renomear.
 */
export function nomeDaCor(hex: string): string {
  const { l, c, h } = hexParaOklch(hex);
  if (l >= 0.8 && c >= 0.012 && c < 0.08 && h >= 45 && h < 105) return l > 0.95 ? "Creme" : "Bege";
  if (c < 0.025) {
    if (l > 0.97) return "Branco";
    if (l > 0.9) return c > 0.008 ? "Off-white" : "Gelo";
    if (l > 0.7) return "Cinza claro";
    if (l > 0.45) return "Cinza";
    if (l > 0.25) return "Grafite";
    return "Preto";
  }
  // Famílias que o matiz sozinho não explica.
  if ((h >= 350 || h < 30) && l < 0.42) return "Vinho";
  if ((h >= 345 || h < 30) && c < 0.09 && l >= 0.35 && l < 0.62) return "Marrom-vinho";
  if (h >= 30 && h < 95 && l < 0.55 && c < 0.13) return l < 0.35 ? "Café" : "Marrom";
  if (h >= 45 && h < 105 && l >= 0.82 && c < 0.08) return l > 0.92 ? "Creme" : "Bege";
  if (h >= 30 && h < 62 && l >= 0.5 && l < 0.74 && c >= 0.06 && c < 0.16) return "Terracota";
  if (h >= 75 && h < 100 && l >= 0.6 && l < 0.82 && c >= 0.1) return "Dourado";
  if (h >= 25 && h < 70 && l >= 0.78 && c >= 0.05 && c < 0.15) return "Pêssego";
  if (h >= 15 && h < 40 && l >= 0.62 && l < 0.78 && c >= 0.1) return "Coral";
  if (h >= 115 && h < 175 && c < 0.07 && l >= 0.5 && l < 0.85) return "Sálvia";
  if (h >= 95 && h < 130 && l < 0.65 && c < 0.13) return "Oliva";
  if (h >= 245 && h < 275 && l < 0.38) return "Azul-marinho";
  if (h >= 290 && h < 330 && l > 0.75) return "Lilás";
  if (h >= 200 && h < 245 && l < 0.45) return "Petróleo";
  let base = "Rosa";
  for (const [limite, nome] of MATIZES_NOMEADOS) {
    if (h < limite) { base = nome; break; }
  }
  if (l > 0.88) return `${base} claro`;
  if (l < 0.35) return `${base} profundo`;
  if (c > 0.2) return `${base} vivo`;
  return base;
}
