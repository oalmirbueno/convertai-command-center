/**
 * Contraste de cor (WCAG 2.2) para os tokens do painel. TypeScript puro, sem
 * import com "@/": o Node 24 importa este arquivo direto (scripts/design) e o
 * vitest também. Os tokens estão no formato do shadcn, "h s% l%".
 */

export type Rgb = [number, number, number];
export type Nota = "AAA" | "AA" | "AA grande" | "reprova";

/** "145 80% 38%" (ou "hsl(145 80% 38%)", com vírgulas ou não) para RGB 0..255. */
export function hslParaRgb(hsl: string): Rgb {
  const m = /^\s*(?:hsl\(\s*)?(-?[\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%\s*\)?\s*$/.exec(hsl);
  if (!m) throw new Error(`Cor HSL inválida: "${hsl}"`);
  const h = (((Number(m[1]) % 360) + 360) % 360) / 360;
  const s = Math.min(1, Number(m[2]) / 100);
  const l = Math.min(1, Number(m[3]) / 100);
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const canal = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [Math.round(canal(h + 1 / 3) * 255), Math.round(canal(h) * 255), Math.round(canal(h - 1 / 3) * 255)];
}

/** As três partes de "h s% l%" em números, e de volta. */
export function partesHsl(hsl: string): [number, number, number] {
  const m = /^\s*(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*$/.exec(hsl);
  if (!m) throw new Error(`Cor HSL inválida: "${hsl}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function montarHsl(h: number, s: number, l: number): string {
  const limitar = (v: number) => Math.round(Math.min(100, Math.max(0, v)) * 10) / 10;
  return `${h} ${limitar(s)}% ${limitar(l)}%`;
}

/** "#13ae54" ou "#fff" para RGB. */
export function hexParaRgb(hex: string): Rgb {
  const limpo = hex.trim().replace(/^#/, "");
  const cheio = limpo.length === 3 ? limpo.split("").map((c) => c + c).join("") : limpo;
  if (!/^[0-9a-fA-F]{6}$/.test(cheio)) throw new Error(`Cor HEX inválida: "${hex}"`);
  return [parseInt(cheio.slice(0, 2), 16), parseInt(cheio.slice(2, 4), 16), parseInt(cheio.slice(4, 6), 16)];
}

export function rgbParaHex([r, g, b]: Rgb): string {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

/** Aceita HEX, "h s% l%" ou um RGB já pronto. */
export function paraRgb(cor: string | Rgb): Rgb {
  if (Array.isArray(cor)) return cor;
  return cor.trim().startsWith("#") ? hexParaRgb(cor) : hslParaRgb(cor);
}

/** Luminância relativa da WCAG 2.2 (0 = preto, 1 = branco). */
export function luminancia(cor: string | Rgb): number {
  const [r, g, b] = paraRgb(cor).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razão de contraste entre duas cores (1 a 21), sem arredondar. */
export function razaoDeContraste(a: string | Rgb, b: string | Rgb): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** A nota de um par de TEXTO: AAA (7), AA (4,5), AA só para texto grande (3) ou reprova. */
export function nota(razao: number): Nota {
  if (razao >= 7) return "AAA";
  if (razao >= 4.5) return "AA";
  if (razao >= 3) return "AA grande";
  return "reprova";
}

/** Mínimos da WCAG 2.2 AA. */
export const MINIMO = { texto: 4.5, textoGrande: 3, grafico: 3 } as const;

/** Razão em pt-BR com duas casas ("4,52:1"), para tela e relatório. */
export function formatarRazao(razao: number): string {
  return `${(Math.floor(razao * 100) / 100).toFixed(2).replace(".", ",")}:1`;
}

export type MapaDeTokens = Record<string, string>;

function lerDeclaracoes(corpo: string): MapaDeTokens {
  const mapa: MapaDeTokens = {};
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(corpo))) mapa[m[1]] = m[2].trim();
  return mapa;
}

/**
 * Lê do texto do src/index.css os blocos ":root,\n  .dark" e ".light" e
 * devolve os tokens de cada tema, com o nome inteiro (ex. "--primary").
 * O claro herda do escuro o que não redefine.
 */
export function lerTokensDoCss(css: string): { escuro: MapaDeTokens; claro: MapaDeTokens } {
  const semComentario = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const escuro = /:root,\s*\.dark\s*\{([^}]*)\}/.exec(semComentario);
  const claro = /(?:^|\n)\s*\.light\s*\{([^}]*)\}/.exec(semComentario);
  if (!escuro) throw new Error('Bloco ":root, .dark" não encontrado no CSS');
  if (!claro) throw new Error('Bloco ".light" não encontrado no CSS');
  const tokensEscuro = lerDeclaracoes(escuro[1]);
  return { escuro: tokensEscuro, claro: { ...tokensEscuro, ...lerDeclaracoes(claro[1]) } };
}

/** Razão entre dois tokens de um mapa (pelo nome, com ou sem "--"). */
export function razaoEntreTokens(tokens: MapaDeTokens, frente: string, fundo: string): number {
  const valor = (nome: string) => {
    const chave = nome.startsWith("--") ? nome : `--${nome}`;
    const v = tokens[chave];
    if (!v) throw new Error(`Token ${chave} não existe`);
    return v;
  };
  return razaoDeContraste(valor(frente), valor(fundo));
}
