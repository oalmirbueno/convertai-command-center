/**
 * Cores da marca por código (Mesa Identidade, frente IDV, 30/09/2026).
 *
 * O brandbook mostra cada cor em HEX, RGB e CMYK. HEX e RGB são a mesma
 * coisa escrita de dois jeitos. CMYK não: a mesma cor na tela vira números
 * diferentes conforme o papel e a máquina. A conta ingênua (K = 1 - máx(RGB))
 * erra feio: o verde #11BC76 sai com 26% de preto e 91% de ciano, quando uma
 * gráfica imprime com K 0. Por isso aqui o CMYK sai de um PERFIL:
 *
 * 1. RGB (sRGB, D65) vira Lab (D50, adaptação de Bradford), como no ICC.
 * 2. Um modelo de impressão em papel revestido (Neugebauer com Yule-Nielsen e
 *    ganho de ponto), montado com os sólidos típicos do padrão offset para
 *    papel revestido (ISO 12647-2, a referência do FOGRA39), diz que cor sai
 *    de cada combinação de C, M, Y e K.
 * 3. A conversão procura o C, M e Y que chegam mais perto da cor pedida
 *    (colorimétrico relativo: o branco do papel é o branco), com geração de
 *    preto média (o preto entra no lugar do cinza que as três cores fariam)
 *    e limite de tinta total de 300%.
 *
 * O resultado é uma aproximação honesta do perfil, não a tabela oficial: o
 * brandbook diz isso ao lado dos números e pede a prova da gráfica. Os
 * números da prancha recebida (Whatsflow, feitos no Illustrator) servem de
 * régua no teste.
 *
 * Puro: sem Deno, sem npm. A tela, a função e os testes usam o mesmo arquivo.
 * Sem lookbehind, sem \p{}, sem grupo nomeado (Safari 11).
 */

export type Rgb = { r: number; g: number; b: number };
export type Cmyk = { c: number; m: number; y: number; k: number };
export type Lab = { L: number; a: number; b: number };

// ------------------------------------------------------------------ hex e rgb

const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;

/** "#1a2b3c", "1A2B3C" ou "#abc" viram "#1A2B3C"; o resto, null. */
export function normalizarHex(v: unknown): string | null {
  const s = String(v == null ? "" : v).trim();
  const m = HEX.exec(s);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
  return `#${h.toUpperCase()}`;
}

export function hexParaRgb(hex: string): Rgb {
  const h = normalizarHex(hex);
  if (!h) throw new Error(`Cor inválida: ${String(hex).slice(0, 20)}`);
  return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) };
}

const dois = (n: number) => {
  const s = Math.max(0, Math.min(255, Math.round(n))).toString(16).toUpperCase();
  return s.length < 2 ? `0${s}` : s;
};

export function rgbParaHex(c: Rgb): string {
  return `#${dois(c.r)}${dois(c.g)}${dois(c.b)}`;
}

// ------------------------------------------------------------------ colorimetria

const D50 = { X: 0.9642, Y: 1, Z: 0.8251 };

function linear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** sRGB -> XYZ já adaptado para D50 (matriz sRGB D50 de Bradford, a do ICC). */
export function rgbParaXyzD50(c: Rgb): { X: number; Y: number; Z: number } {
  const r = linear(c.r);
  const g = linear(c.g);
  const b = linear(c.b);
  return {
    X: 0.4360747 * r + 0.3850649 * g + 0.1430804 * b,
    Y: 0.2225045 * r + 0.7168786 * g + 0.0606169 * b,
    Z: 0.0139322 * r + 0.0971045 * g + 0.7141733 * b,
  };
}

const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const fInv = (t: number) => (t * t * t > 216 / 24389 ? t * t * t : (116 * t - 16) / (24389 / 27));

export function xyzParaLab(x: { X: number; Y: number; Z: number }): Lab {
  const fx = f(x.X / D50.X);
  const fy = f(x.Y / D50.Y);
  const fz = f(x.Z / D50.Z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function labParaXyz(l: Lab): { X: number; Y: number; Z: number } {
  const fy = (l.L + 16) / 116;
  const fx = fy + l.a / 500;
  const fz = fy - l.b / 200;
  return { X: fInv(fx) * D50.X, Y: fInv(fy) * D50.Y, Z: fInv(fz) * D50.Z };
}

export function rgbParaLab(c: Rgb): Lab {
  return xyzParaLab(rgbParaXyzD50(c));
}

export function deltaE(a: Lab, b: Lab): number {
  const dl = a.L - b.L;
  const da = a.a - b.a;
  const db = a.b - b.b;
  return Math.sqrt(dl * dl + da * da + db * db);
}

// ------------------------------------------------------------------ perfil de impressão

/**
 * Sólidos e sobreposições medidos no padrão offset em papel revestido
 * (valores típicos da caracterização ISO 12647-2 / FOGRA39, D50). As
 * combinações com preto saem pela regra de transmissão (multiplicar o fator
 * de reflexão do preto pelo da combinação).
 */
const SOLIDOS_REVESTIDO: Record<string, Lab> = {
  papel: { L: 95, a: 0, b: -2 },
  c: { L: 55, a: -37, b: -50 },
  m: { L: 48, a: 74, b: -3 },
  y: { L: 89, a: -5, b: 93 },
  cm: { L: 24, a: 22, b: -46 },
  cy: { L: 50, a: -65, b: 27 },
  my: { L: 47, a: 68, b: 48 },
  cmy: { L: 23, a: 0, b: 0 },
  k: { L: 16, a: 0, b: 0 },
};

export type PerfilDeImpressao = {
  chave: "revestido" | "nao_revestido";
  nome: string;
  /** Limite de tinta total (C+M+Y+K), em %. */
  limiteDeTinta: number;
  /** Ganho de ponto no meio-tom (50%), em fração. */
  ganho: number;
  /** Expoente de Yule-Nielsen (espalhamento de luz no papel). */
  yuleNielsen: number;
  /** Quanto preto vai no preto puro (0 a 1); o resto do escuro é cor (preto rico). */
  forcaDoPreto: number;
  solidos: Record<string, Lab>;
};

export const PERFIS: Record<PerfilDeImpressao["chave"], PerfilDeImpressao> = {
  revestido: {
    chave: "revestido",
    nome: "Papel revestido (offset, referência FOGRA39)",
    limiteDeTinta: 300,
    ganho: 0.12,
    yuleNielsen: 1.4,
    forcaDoPreto: 0.9,
    solidos: SOLIDOS_REVESTIDO,
  },
  nao_revestido: {
    chave: "nao_revestido",
    nome: "Papel não revestido (offset, referência FOGRA29)",
    limiteDeTinta: 260,
    ganho: 0.2,
    yuleNielsen: 2,
    forcaDoPreto: 0.85,
    solidos: {
      papel: { L: 95, a: 0, b: -2 },
      c: { L: 58, a: -25, b: -43 },
      m: { L: 54, a: 58, b: -2 },
      y: { L: 86, a: -3, b: 77 },
      cm: { L: 36, a: 12, b: -32 },
      cy: { L: 54, a: -44, b: 14 },
      my: { L: 52, a: 55, b: 26 },
      cmy: { L: 33, a: 1, b: 1 },
      k: { L: 31, a: 1, b: 1 },
    },
  },
};

type Xyz = { X: number; Y: number; Z: number };

type Primarias = { xyz: Xyz[]; papel: Xyz; raiz: number[][] };
const CACHE_DE_PRIMARIAS: Record<string, Primarias> = {};

/** As 16 primárias de Neugebauer (ordem: bit 1 = c, 2 = m, 4 = y, 8 = k), já na raiz de Yule-Nielsen. */
function primariasDo(perfil: PerfilDeImpressao): Primarias {
  const ja = CACHE_DE_PRIMARIAS[perfil.chave];
  if (ja) return ja;
  const s = perfil.solidos;
  const papel = labParaXyz(s.papel);
  const semK: Record<number, Xyz> = {
    0: papel,
    1: labParaXyz(s.c),
    2: labParaXyz(s.m),
    3: labParaXyz(s.cm),
    4: labParaXyz(s.y),
    5: labParaXyz(s.cy),
    6: labParaXyz(s.my),
    7: labParaXyz(s.cmy),
  };
  const k = labParaXyz(s.k);
  const xyz: Xyz[] = [];
  for (let i = 0; i < 16; i++) {
    const base = semK[i & 7];
    if (i & 8) xyz.push({ X: (base.X * k.X) / papel.X, Y: (base.Y * k.Y) / papel.Y, Z: (base.Z * k.Z) / papel.Z });
    else xyz.push(base);
  }
  const n = perfil.yuleNielsen;
  const raiz = xyz.map((p) => [Math.pow(p.X, 1 / n), Math.pow(p.Y, 1 / n), Math.pow(p.Z, 1 / n)]);
  const pronto = { xyz, papel, raiz };
  CACHE_DE_PRIMARIAS[perfil.chave] = pronto;
  return pronto;
}

const efetivo = (a: number, ganho: number) => {
  const x = Math.max(0, Math.min(1, a));
  return x + 4 * ganho * x * (1 - x);
};

/** Que cor sai no papel (Lab relativo ao branco do papel) para C, M, Y e K de 0 a 1. */
export function cmykParaLab(c: number, m: number, y: number, k: number, perfil: PerfilDeImpressao = PERFIS.revestido): Lab {
  const p = primariasDo(perfil);
  const a = [efetivo(c, perfil.ganho), efetivo(m, perfil.ganho), efetivo(y, perfil.ganho), efetivo(k, perfil.ganho)];
  let x = 0;
  let yy = 0;
  let z = 0;
  for (let i = 0; i < 16; i++) {
    let w = 1;
    for (let j = 0; j < 4; j++) w *= i & (1 << j) ? a[j] : 1 - a[j];
    if (!w) continue;
    x += w * p.raiz[i][0];
    yy += w * p.raiz[i][1];
    z += w * p.raiz[i][2];
  }
  const n = perfil.yuleNielsen;
  const X = Math.pow(x, n);
  const Y = Math.pow(yy, n);
  const Z = Math.pow(z, n);
  // Colorimétrico relativo: o papel vira o branco D50.
  return xyzParaLab({ X: (X / p.papel.X) * D50.X, Y: (Y / p.papel.Y) * D50.Y, Z: (Z / p.papel.Z) * D50.Z });
}

const limitar = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * C, M e Y (0 a 1) que chegam mais perto do alvo com o K dado: Gauss-Newton
 * com jacobiana numérica e passo projetado na caixa [0, 1]. Poucas dezenas de
 * avaliações do modelo: roda em microssegundos.
 */
function resolverCmy(alvo: Lab, k: number, inicio: [number, number, number], perfil: PerfilDeImpressao, tetoCmy: number, pesoL = PESO_DA_LUZ): { cmy: [number, number, number]; erro: number } {
  let v: [number, number, number] = [limitar(inicio[0]), limitar(inicio[1]), limitar(inicio[2])];
  const projetar = (x: [number, number, number]): [number, number, number] => {
    const p: [number, number, number] = [limitar(x[0]), limitar(x[1]), limitar(x[2])];
    const soma = p[0] + p[1] + p[2];
    if (soma > tetoCmy && soma > 0) {
      const fator = tetoCmy / soma;
      return [p[0] * fator, p[1] * fator, p[2] * fator];
    }
    return p;
  };
  v = projetar(v);
  const lab = (x: [number, number, number]) => cmykParaLab(x[0], x[1], x[2], k, perfil);
  const residuo = (l: Lab) => [pesoL * (l.L - alvo.L), l.a - alvo.a, l.b - alvo.b];
  const distancia = (l: Lab) => {
    const r = residuo(l);
    return Math.sqrt(r[0] * r[0] + r[1] * r[1] + r[2] * r[2]);
  };
  let atual = lab(v);
  let erro = distancia(atual);
  let lambda = 0.01;
  for (let it = 0; it < 40 && erro > 0.05; it++) {
    const r = residuo(atual);
    const J: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const h = 1e-3;
    for (let j = 0; j < 3; j++) {
      const w: [number, number, number] = [v[0], v[1], v[2]];
      const passo = w[j] + h <= 1 ? h : -h;
      w[j] += passo;
      const lw = lab(w);
      const rw = residuo(lw);
      for (let i = 0; i < 3; i++) J[i][j] = (rw[i] - r[i]) / passo;
    }
    // (JtJ + lambda I) d = -Jt r
    const A: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const g = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        let s = 0;
        for (let i = 0; i < 3; i++) s += J[i][a] * J[i][b];
        A[a][b] = s;
      }
      let s = 0;
      for (let i = 0; i < 3; i++) s += J[i][a] * r[i];
      g[a] = -s;
    }
    let melhorou = false;
    for (let tentativa = 0; tentativa < 6; tentativa++) {
      const M = A.map((linha, i) => linha.map((x, j) => (i === j ? x * (1 + lambda) + 1e-9 : x)));
      const d = resolver3(M, g);
      if (!d) break;
      const novo = projetar([v[0] + d[0], v[1] + d[1], v[2] + d[2]]);
      const ln = lab(novo);
      const en = distancia(ln);
      if (en < erro - 1e-6) {
        v = novo;
        atual = ln;
        erro = en;
        lambda = Math.max(1e-4, lambda / 3);
        melhorou = true;
        break;
      }
      lambda *= 4;
    }
    if (!melhorou) break;
  }
  return { cmy: v, erro: deltaE(atual, alvo) };
}

/**
 * Fora do que a tinta alcança (verde-água muito vivo, azul elétrico), a cor
 * mais perto em Lab puro troca claridade por saturação e escurece demais. O
 * perfil guarda a claridade primeiro: a diferença de luz pesa o dobro.
 */
let PESO_DA_LUZ = 2;

/**
 * Preto da geração média: cresce com o escuro da cor (a partir de L* 60) e
 * some nas cores saturadas (o preto sujaria o azul, o vermelho, o verde).
 * Régua: cinza médio #808080 leva pouco preto; #191D20, cerca de 3/4; preto
 * puro, 9/10 (o resto é cor, o preto rico).
 */
export function pretoDaGeracao(alvo: Lab, perfil: PerfilDeImpressao = PERFIS.revestido): number {
  const escuro = Math.max(0, 1 - alvo.L / 60);
  if (!escuro) return 0;
  const croma = Math.sqrt(alvo.a * alvo.a + alvo.b * alvo.b);
  const neutro = Math.max(0, 1 - Math.pow(croma / 60, 2));
  return perfil.forcaDoPreto * Math.pow(escuro, 1.05) * neutro;
}

function resolver3(A: number[][], b: number[]): number[] | null {
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A);
  if (!isFinite(D) || Math.abs(D) < 1e-12) return null;
  const saida: number[] = [];
  for (let c = 0; c < 3; c++) {
    const m = A.map((linha, i) => linha.map((x, j) => (j === c ? b[i] : x)));
    saida.push(det(m) / D);
  }
  return saida;
}

/** A conta ingênua (só para comparação e teste): K = 1 - máx(RGB). */
export function cmykIngenuo(hex: string): Cmyk {
  const { r, g, b } = hexParaRgb(hex);
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const k = 1 - Math.max(R, G, B);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 };
  return {
    c: Math.round(((1 - R - k) / (1 - k)) * 100),
    m: Math.round(((1 - G - k) / (1 - k)) * 100),
    y: Math.round(((1 - B - k) / (1 - k)) * 100),
    k: Math.round(k * 100),
  };
}

const CACHE_CMYK: Record<string, Cmyk> = {};

/** Só para calibrar e testar: esquece as contas guardadas (e ajusta o peso da luz). */
export function limparCachesDeCor(pesoDaLuz?: number) {
  for (const k of Object.keys(CACHE_CMYK)) delete CACHE_CMYK[k];
  for (const k of Object.keys(CACHE_DE_PRIMARIAS)) delete CACHE_DE_PRIMARIAS[k];
  if (typeof pesoDaLuz === "number") PESO_DA_LUZ = pesoDaLuz;
}

/**
 * CMYK (0 a 100, inteiro) de uma cor, pelo perfil. Branco puro sai 0/0/0/0;
 * preto puro sai com preto rico dentro do limite de tinta.
 */
export function rgbParaCmyk(hex: string, perfilChave: PerfilDeImpressao["chave"] = "revestido"): Cmyk {
  const h = normalizarHex(hex);
  if (!h) throw new Error(`Cor inválida: ${String(hex).slice(0, 20)}`);
  const chave = `${perfilChave}:${h}`;
  const ja = CACHE_CMYK[chave];
  if (ja) return { ...ja };
  const perfil = PERFIS[perfilChave];
  const alvo = rgbParaLab(hexParaRgb(h));
  const teto = perfil.limiteDeTinta / 100;
  if (alvo.L >= 99.5 && Math.abs(alvo.a) < 0.5 && Math.abs(alvo.b) < 0.5) {
    CACHE_CMYK[chave] = { c: 0, m: 0, y: 0, k: 0 };
    return { c: 0, m: 0, y: 0, k: 0 };
  }
  const ing = cmykIngenuo(h);
  const inicio: [number, number, number] = [
    limitar((ing.c / 100) * (1 - ing.k / 100) + ing.k / 100),
    limitar((ing.m / 100) * (1 - ing.k / 100) + ing.k / 100),
    limitar((ing.y / 100) * (1 - ing.k / 100) + ing.k / 100),
  ];
  // 1. Geração de preto média: o preto entra pelo escuro neutro da cor.
  let k = pretoDaGeracao(alvo, perfil);
  let melhor = resolverCmy(alvo, k, inicio, perfil, Math.max(0, teto - k));
  // 2. Limite de tinta: se as cores sozinhas não chegam ao escuro dentro do
  //    limite, o preto sobe (e a cor desce) até caber e chegar.
  for (let passo = 0; passo < 20 && k < perfil.forcaDoPreto; passo++) {
    const soma = melhor.cmy[0] + melhor.cmy[1] + melhor.cmy[2];
    const noLimite = soma >= teto - k - 0.02;
    if (!(noLimite && melhor.erro > 2 && alvo.L < 50)) break;
    const kNovo = Math.min(perfil.forcaDoPreto, k + 0.05);
    const tentativa = resolverCmy(alvo, kNovo, melhor.cmy, perfil, Math.max(0, teto - kNovo));
    if (tentativa.erro >= melhor.erro) break;
    melhor = tentativa;
    k = kNovo;
  }
  const saida: Cmyk = {
    c: Math.round(melhor.cmy[0] * 100),
    m: Math.round(melhor.cmy[1] * 100),
    y: Math.round(melhor.cmy[2] * 100),
    k: Math.round(k * 100),
  };
  // Arredondar não pode passar do limite.
  let excesso = saida.c + saida.m + saida.y + saida.k - perfil.limiteDeTinta;
  while (excesso > 0) {
    const maior = saida.c >= saida.m && saida.c >= saida.y ? "c" : saida.m >= saida.y ? "m" : "y";
    saida[maior] -= 1;
    excesso -= 1;
  }
  CACHE_CMYK[chave] = saida;
  return { ...saida };
}

// ------------------------------------------------------------------ contraste (WCAG)

export function luminanciaRelativa(hex: string): number {
  const { r, g, b } = hexParaRgb(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contraste(a: string, b: string): number {
  const la = luminanciaRelativa(a);
  const lb = luminanciaRelativa(b);
  const claro = Math.max(la, lb);
  const escuro = Math.min(la, lb);
  return Math.round(((claro + 0.05) / (escuro + 0.05)) * 100) / 100;
}

/** Texto preto ou branco por cima da cor, pelo contraste real. */
export function textoSobre(hex: string): "#111111" | "#FFFFFF" {
  return contraste(hex, "#111111") >= contraste(hex, "#FFFFFF") ? "#111111" : "#FFFFFF";
}

/** Nível WCAG do par para texto: AAA (7), AA (4,5), AA grande (3) ou nenhum. */
export function nivelDoContraste(razao: number): "AAA" | "AA" | "AA grande" | "baixo" {
  if (razao >= 7) return "AAA";
  if (razao >= 4.5) return "AA";
  if (razao >= 3) return "AA grande";
  return "baixo";
}

// ------------------------------------------------------------------ ficha da cor

export type PapelDaCor = "primaria" | "secundaria" | "destaque" | "neutra";

export const ROTULO_DO_PAPEL_DA_COR: Record<PapelDaCor, string> = {
  primaria: "Cor primária",
  secundaria: "Cor secundária",
  destaque: "Cor de destaque",
  neutra: "Cor neutra",
};

export type FichaDaCor = {
  nome: string;
  papel: PapelDaCor;
  hex: string;
  rgb: Rgb;
  cmyk: Cmyk;
  /** Texto que fica legível por cima. */
  texto: "#111111" | "#FFFFFF";
};

export function fichaDaCor(c: { nome?: unknown; papel?: unknown; hex: unknown }, perfil: PerfilDeImpressao["chave"] = "revestido"): FichaDaCor | null {
  const hex = normalizarHex(c.hex);
  if (!hex) return null;
  const papel = (["primaria", "secundaria", "destaque", "neutra"].indexOf(String(c.papel)) >= 0 ? String(c.papel) : "secundaria") as PapelDaCor;
  const nome = String(c.nome == null ? "" : c.nome).replace(/\s+/g, " ").trim().slice(0, 40) || hex;
  return { nome, papel, hex, rgb: hexParaRgb(hex), cmyk: rgbParaCmyk(hex, perfil), texto: textoSobre(hex) };
}

/** Texto das fichas: "C 75  M 0  Y 74  K 0", "R 17  G 188  B 118". */
export const textoCmyk = (c: Cmyk) => `C ${c.c}  M ${c.m}  Y ${c.y}  K ${c.k}`;
export const textoRgb = (c: Rgb) => `R ${c.r}  G ${c.g}  B ${c.b}`;

/**
 * Proporção de uso (60/30/10): primárias levam 60, secundárias 30, destaque
 * 10 (neutras entram com as secundárias). Sem uma das camadas, o peso dela
 * vai para as outras na mesma proporção.
 */
export function proporcaoDeUso(cores: Array<{ hex: string; papel: PapelDaCor }>): Array<{ hex: string; parte: number }> {
  const pesos: Record<string, number> = { primaria: 60, secundaria: 30, neutra: 30, destaque: 10 };
  const grupos: Record<string, string[]> = { primaria: [], secundaria: [], destaque: [] };
  for (const c of cores) grupos[c.papel === "neutra" ? "secundaria" : c.papel].push(c.hex);
  const presentes = Object.keys(grupos).filter((g) => grupos[g].length);
  const soma = presentes.reduce((s, g) => s + pesos[g], 0) || 1;
  const saida: Array<{ hex: string; parte: number }> = [];
  for (const g of presentes) {
    const parteDoGrupo = (pesos[g] / soma) * 100;
    for (const hex of grupos[g]) saida.push({ hex, parte: Math.round((parteDoGrupo / grupos[g].length) * 10) / 10 });
  }
  return saida;
}
