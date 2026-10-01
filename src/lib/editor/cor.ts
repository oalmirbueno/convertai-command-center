import type { CorDoProjeto, CurvaDaLut } from "../../../supabase/functions/_shared/projeto-de-edicao";

/**
 * Cor do editor (frente EDT, rodada 2, 30/09/2026): correção básica, looks
 * prontos e LUT (.cube) do cliente. Puro (sem "@/"): a composição Remotion usa
 * o mesmo cálculo na prévia do navegador e no render do worker.
 *
 * Como a cor é desenhada: um filtro SVG por grade (feComponentTransfer para as
 * curvas, feColorMatrix para saturação, temperatura e tinta), sempre em sRGB.
 * O Chrome do Remotion (worker) e o do painel desenham igual.
 *
 * LUT 3D não cabe num filtro CSS. A tela lê o .cube e guarda a aproximação:
 * saída = curvas(matriz · entrada). As curvas vêm do eixo cinza da LUT (o tom:
 * contraste, brilho, virada de cor nas sombras e altas); a matriz 3x4 sai por
 * mínimos quadrados sobre a LUT inteira (saturação, troca entre canais). O
 * erro médio fica guardado e a tela mostra quanto ficou fiel.
 */

export interface Look {
  id: string;
  rotulo: string;
  /** Uma linha (vai no "?"). */
  quando: string;
  exposicao: number;
  contraste: number;
  saturacao: number;
  temperatura: number;
  tinta: number;
  vinheta: number;
}

export const LOOKS: Look[] = [
  { id: "natural", rotulo: "Natural", quando: "sem look: só a correção que você ajustar", exposicao: 0, contraste: 0, saturacao: 0, temperatura: 0, tinta: 0, vinheta: 0 },
  { id: "vivo", rotulo: "Vivo", quando: "cores fortes para rede social, produto e comida", exposicao: 0.02, contraste: 0.12, saturacao: 0.3, temperatura: 0.03, tinta: 0, vinheta: 0 },
  { id: "quente", rotulo: "Quente", quando: "fim de tarde, aconchego, pele mais bonita", exposicao: 0.03, contraste: 0.06, saturacao: 0.06, temperatura: 0.35, tinta: 0.03, vinheta: 0.1 },
  { id: "frio", rotulo: "Frio", quando: "tecnologia, clínica, limpeza", exposicao: 0, contraste: 0.08, saturacao: -0.05, temperatura: -0.35, tinta: 0, vinheta: 0.05 },
  { id: "cinema", rotulo: "Cinema", quando: "institucional e filme da marca: contraste, cor contida e borda escura", exposicao: -0.03, contraste: 0.18, saturacao: -0.14, temperatura: 0.08, tinta: -0.05, vinheta: 0.3 },
  { id: "suave", rotulo: "Suave", quando: "beleza, moda, bem-estar: pouco contraste", exposicao: 0.06, contraste: -0.16, saturacao: -0.08, temperatura: 0.06, tinta: 0.02, vinheta: 0 },
  { id: "vintage", rotulo: "Vintage", quando: "memória, nostalgia, história da marca", exposicao: 0.02, contraste: -0.1, saturacao: -0.28, temperatura: 0.22, tinta: 0.06, vinheta: 0.35 },
  { id: "noite", rotulo: "Noite", quando: "clima noturno e dramático", exposicao: -0.16, contraste: 0.12, saturacao: -0.12, temperatura: -0.22, tinta: 0, vinheta: 0.35 },
  { id: "pb", rotulo: "Preto e branco", quando: "depoimento forte, antes e depois, clima sério", exposicao: 0, contraste: 0.18, saturacao: -1, temperatura: 0, tinta: 0, vinheta: 0.2 },
];

export const lookPorId = (id: string): Look => LOOKS.find((l) => l.id === id) || LOOKS[0];

const limitar = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** Parâmetros finais: o look (na força escolhida) somado ao ajuste manual. */
export function parametrosFinais(c: CorDoProjeto): { exposicao: number; contraste: number; saturacao: number; temperatura: number; tinta: number; vinheta: number } {
  const l = lookPorId(c.look);
  const f = limitar(Number(c.intensidade) || 0, 0, 1);
  const soma = (a: number, b: number, min: number, max: number) => limitar(a * f + (Number(b) || 0), min, max);
  return {
    exposicao: soma(l.exposicao, c.exposicao, -1, 1),
    contraste: soma(l.contraste, c.contraste, -1, 1),
    saturacao: soma(l.saturacao, c.saturacao, -1, 1),
    temperatura: soma(l.temperatura, c.temperatura, -1, 1),
    tinta: soma(l.tinta, c.tinta, -1, 1),
    vinheta: soma(l.vinheta, c.vinheta, 0, 1),
  };
}

/** Curva de tom (17 pontos): exposição em até 1 ponto de luz para cada lado, contraste em torno do meio. */
export function curvaDeTom(exposicao: number, contraste: number): number[] {
  const ganho = Math.pow(2, limitar(exposicao, -1, 1));
  const k = 1 + limitar(contraste, -1, 1);
  const saida: number[] = [];
  for (let i = 0; i <= 16; i++) {
    const v = (i / 16) * ganho;
    saida.push(r4(limitar((v - 0.5) * k + 0.5, 0, 1)));
  }
  return saida;
}

/** Matriz 3x4 de saturação, temperatura e tinta (linhas r, g, b; última coluna: deslocamento). */
export function matrizDeCor(saturacao: number, temperatura: number, tinta: number): number[] {
  const s = 1 + limitar(saturacao, -1, 1);
  const L = [0.2126, 0.7152, 0.0722];
  const sat = [0, 1, 2].map((lin) => [0, 1, 2].map((col) => (1 - s) * L[col] + (lin === col ? s : 0)));
  const t = limitar(temperatura, -1, 1);
  const ti = limitar(tinta, -1, 1);
  const ganho = [1 + 0.12 * t + 0.04 * ti, 1 - 0.09 * ti, 1 - 0.12 * t + 0.04 * ti];
  const m: number[] = [];
  for (let lin = 0; lin < 3; lin++) {
    for (let col = 0; col < 3; col++) m.push(r4(sat[lin][col] * ganho[lin]));
    m.push(0);
  }
  return m;
}

const IDENTIDADE_3X4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

/** feColorMatrix (4x5) a partir da 3x4. */
export const matrizSvg = (m: number[]) => [m[0], m[1], m[2], 0, m[3], m[4], m[5], m[6], 0, m[7], m[8], m[9], m[10], 0, m[11], 0, 0, 0, 1, 0].map((x) => r4(x)).join(" ");

export interface FiltroDaCor {
  /** Nada a desenhar (tudo neutro). */
  neutro: boolean;
  lut: { r: string; g: string; b: string; matriz: string; forca: number } | null;
  tom: string | null;
  matriz: string | null;
  vinheta: number;
}

const ehIdentidade = (m: number[]) => m.every((x, i) => Math.abs(x - IDENTIDADE_3X4[i]) < 1e-4);

/** O que a composição desenha para esta cor (valores já prontos para o SVG). */
export function filtroDaCor(c: CorDoProjeto | null | undefined): FiltroDaCor {
  if (!c) return { neutro: true, lut: null, tom: null, matriz: null, vinheta: 0 };
  const p = parametrosFinais(c);
  const tom = Math.abs(p.exposicao) > 1e-4 || Math.abs(p.contraste) > 1e-4 ? curvaDeTom(p.exposicao, p.contraste).join(" ") : null;
  const m = matrizDeCor(p.saturacao, p.temperatura, p.tinta);
  const matriz = ehIdentidade(m) ? null : matrizSvg(m);
  const forca = limitar(Number(c.intensidade) || 0, 0, 1);
  const lut = c.lut && forca > 0 ? { r: c.lut.r.join(" "), g: c.lut.g.join(" "), b: c.lut.b.join(" "), matriz: matrizSvg(c.lut.matriz), forca } : null;
  return { neutro: !tom && !matriz && !lut && p.vinheta <= 0, lut, tom, matriz, vinheta: p.vinheta };
}

// ------------------------------------------------------------------ conta de um pixel (testes e erro da LUT)

/** Curva por tabela (como o feComponentTransfer type="table"): interpolação linear. */
export function porTabela(t: number[], v: number): number {
  const n = t.length - 1;
  if (n <= 0) return t[0] || 0;
  const x = limitar(v, 0, 1) * n;
  const k = Math.min(n - 1, Math.floor(x));
  return t[k] + (t[k + 1] - t[k]) * (x - k);
}

export function porMatriz(m: number[], px: [number, number, number]): [number, number, number] {
  const [r, g, b] = px;
  return [limitar(m[0] * r + m[1] * g + m[2] * b + m[3], 0, 1), limitar(m[4] * r + m[5] * g + m[6] * b + m[7], 0, 1), limitar(m[8] * r + m[9] * g + m[10] * b + m[11], 0, 1)];
}

/** A aproximação da LUT aplicada a um pixel (curvas(matriz · x)). */
export function aplicarCurvaDaLut(l: Pick<CurvaDaLut, "r" | "g" | "b" | "matriz">, px: [number, number, number]): [number, number, number] {
  const q = porMatriz(l.matriz, px);
  return [porTabela(l.r, q[0]), porTabela(l.g, q[1]), porTabela(l.b, q[2])];
}

// ------------------------------------------------------------------ .cube

export interface LutLida {
  tipo: "1d" | "3d";
  tamanho: number;
  titulo: string | null;
  /** Valores normalizados de 0 a 1; 3D: índice r + g*N + b*N*N. */
  dados: Float32Array;
}

export class ErroDaLut extends Error {}

/** Lê um .cube (Adobe/Resolve). Aceita 1D e 3D, DOMAIN_MIN/MAX e comentários. */
export function lerCube(texto: string): LutLida {
  const linhas = String(texto || "").split(/\r?\n/);
  let tamanho = 0;
  let tipo: "1d" | "3d" | null = null;
  let titulo: string | null = null;
  let min = [0, 0, 0];
  let max = [1, 1, 1];
  const valores: number[] = [];
  for (const bruta of linhas) {
    const l = bruta.trim();
    if (!l || l[0] === "#") continue;
    const partes = l.split(/\s+/);
    const chave = partes[0].toUpperCase();
    if (chave === "TITLE") {
      titulo = l.replace(/^TITLE\s+/i, "").replace(/^"|"$/g, "").slice(0, 80) || null;
      continue;
    }
    if (chave === "LUT_3D_SIZE" || chave === "LUT_1D_SIZE") {
      tipo = chave === "LUT_3D_SIZE" ? "3d" : "1d";
      tamanho = Number(partes[1]);
      continue;
    }
    if (chave === "DOMAIN_MIN" || chave === "DOMAIN_MAX") {
      const v = partes.slice(1, 4).map(Number);
      if (v.length === 3 && v.every((x) => isFinite(x))) {
        if (chave === "DOMAIN_MIN") min = v;
        else max = v;
      }
      continue;
    }
    if (/^[A-Z_]+$/.test(chave)) continue;
    const v = partes.slice(0, 3).map(Number);
    if (v.length !== 3 || v.some((x) => !isFinite(x))) throw new ErroDaLut("O arquivo .cube tem uma linha que não é número.");
    valores.push(v[0], v[1], v[2]);
  }
  if (!tipo || !(tamanho >= 2)) throw new ErroDaLut("Não achei LUT_3D_SIZE nem LUT_1D_SIZE: o arquivo não parece um .cube.");
  if (tipo === "3d" && tamanho > 129) throw new ErroDaLut("LUT grande demais (mais de 129 pontos por lado).");
  const esperado = tipo === "3d" ? tamanho * tamanho * tamanho * 3 : tamanho * 3;
  if (valores.length !== esperado) throw new ErroDaLut(`O .cube diz ${tamanho} pontos, mas tem ${valores.length / 3} linhas de cor.`);
  const dados = new Float32Array(valores.length);
  for (let i = 0; i < valores.length; i++) {
    const c = i % 3;
    const faixa = max[c] - min[c] || 1;
    dados[i] = limitar((valores[i] - min[c]) / faixa, 0, 1);
  }
  return { tipo, tamanho, titulo, dados };
}

/** Valor da LUT 3D num ponto (interpolação trilinear). */
export function amostrarLut3d(l: LutLida, px: [number, number, number]): [number, number, number] {
  const N = l.tamanho;
  const pos = px.map((v) => limitar(v, 0, 1) * (N - 1));
  const i0 = pos.map((p) => Math.min(N - 2, Math.floor(p)));
  const f = pos.map((p, k) => p - i0[k]);
  const out: [number, number, number] = [0, 0, 0];
  for (let dr = 0; dr < 2; dr++)
    for (let dg = 0; dg < 2; dg++)
      for (let db = 0; db < 2; db++) {
        const w = (dr ? f[0] : 1 - f[0]) * (dg ? f[1] : 1 - f[1]) * (db ? f[2] : 1 - f[2]);
        if (!w) continue;
        const idx = ((i0[0] + dr) + (i0[1] + dg) * N + (i0[2] + db) * N * N) * 3;
        out[0] += w * l.dados[idx];
        out[1] += w * l.dados[idx + 1];
        out[2] += w * l.dados[idx + 2];
      }
  return out;
}

const PONTOS_DA_CURVA = 33;

function reamostrar(v: number[], n: number): number[] {
  if (v.length === n) return v.slice();
  const saida: number[] = [];
  for (let i = 0; i < n; i++) saida.push(porTabela(v, i / (n - 1)));
  return saida;
}

function inversa(t: number[], y: number): number {
  const n = t.length - 1;
  if (y <= t[0]) return 0;
  if (y >= t[n]) return 1;
  for (let k = 0; k < n; k++) {
    if (y <= t[k + 1]) {
      const d = t[k + 1] - t[k];
      return (k + (d > 1e-9 ? (y - t[k]) / d : 0)) / n;
    }
  }
  return 1;
}

/** Resolve A x = b (4x4) por eliminação com pivô. */
function resolver4(A: number[][], b: number[]): number[] {
  const M = A.map((l, i) => l.concat([b[i]]));
  const n = 4;
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return c < 3 ? [c === 0 ? 1 : 0, c === 1 ? 1 : 0, c === 2 ? 1 : 0, 0] : [0, 0, 0, 0];
    const tmp = M[c];
    M[c] = M[piv];
    M[piv] = tmp;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const fator = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= fator * M[c][k];
    }
  }
  return M.map((l, i) => l[n] / l[i]);
}

/**
 * A aproximação guardada no projeto: curvas do eixo cinza (monótonas) e a
 * matriz 3x4 que melhor leva a entrada ao "antes da curva" da LUT. Erro médio
 * medido na própria LUT (0 a 1; 0,02 = 2%).
 */
export function aproximarLut(l: LutLida, nome: string): CurvaDaLut {
  if (l.tipo === "1d") {
    const canal = (c: number) => {
      const v: number[] = [];
      for (let i = 0; i < l.tamanho; i++) v.push(l.dados[i * 3 + c]);
      return reamostrar(v, Math.min(PONTOS_DA_CURVA, l.tamanho)).map(r4);
    };
    return { nome: nome.slice(0, 80), r: canal(0), g: canal(1), b: canal(2), matriz: IDENTIDADE_3X4.slice(), erro: 0 };
  }
  const N = l.tamanho;
  // Curvas: eixo cinza (i, i, i), feitas monótonas (a inversa precisa).
  const cinza: number[][] = [[], [], []];
  for (let i = 0; i < N; i++) {
    const idx = (i + i * N + i * N * N) * 3;
    for (let c = 0; c < 3; c++) cinza[c].push(l.dados[idx + c]);
  }
  const monotona = (v: number[]) => {
    const s = v.slice();
    for (let i = 1; i < s.length; i++) if (s[i] < s[i - 1]) s[i] = s[i - 1];
    return s;
  };
  let curvas = cinza.map((v) => reamostrar(monotona(v), Math.min(PONTOS_DA_CURVA, N)));
  // LUT que inverte ou achata o cinza: sem curva útil, a matriz carrega tudo.
  if (curvas.some((v) => v[v.length - 1] - v[0] < 0.05)) curvas = [0, 1, 2].map(() => [0, 1]);
  // Pontos da LUT (no máximo ~17 por lado).
  const passo = Math.max(1, Math.ceil(N / 17));
  const amostras: { x: [number, number, number]; y: [number, number, number] }[] = [];
  for (let b = 0; b < N; b += passo)
    for (let g = 0; g < N; g += passo)
      for (let r = 0; r < N; r += passo) {
        const idx = (r + g * N + b * N * N) * 3;
        amostras.push({ x: [r / (N - 1), g / (N - 1), b / (N - 1)], y: [l.dados[idx], l.dados[idx + 1], l.dados[idx + 2]] });
      }
  const AtA = [0, 1, 2, 3].map(() => [0, 0, 0, 0]);
  const Atz = [0, 1, 2].map(() => [0, 0, 0, 0]);
  amostras.forEach((a) => {
    const v = [a.x[0], a.x[1], a.x[2], 1];
    const z = [0, 1, 2].map((c) => inversa(curvas[c], a.y[c]));
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) AtA[i][j] += v[i] * v[j];
      for (let c = 0; c < 3; c++) Atz[c][i] += v[i] * z[c];
    }
  });
  const matriz = [0, 1, 2].reduce((m, c) => m.concat(resolver4(AtA, Atz[c]).map((x) => Math.round(x * 100000) / 100000)), [] as number[]);
  const saida: CurvaDaLut = { nome: nome.slice(0, 80), r: curvas[0].map(r4), g: curvas[1].map(r4), b: curvas[2].map(r4), matriz, erro: 0 };
  let soma = 0;
  amostras.forEach((a) => {
    const q = aplicarCurvaDaLut(saida, a.x);
    soma += (Math.abs(q[0] - a.y[0]) + Math.abs(q[1] - a.y[1]) + Math.abs(q[2] - a.y[2])) / 3;
  });
  saida.erro = Math.round((soma / Math.max(1, amostras.length)) * 10000) / 10000;
  return saida;
}

/** .cube (texto) -> aproximação pronta para o projeto. Lança ErroDaLut com o motivo. */
export function lutDoArquivo(texto: string, nomeDoArquivo: string): CurvaDaLut {
  const l = lerCube(texto);
  return aproximarLut(l, l.titulo || String(nomeDoArquivo || "LUT").replace(/\.cube$/i, ""));
}

/** "fiel", "próxima" ou "aproximada", pelo erro médio. */
export function fidelidadeDaLut(erro: number): string {
  if (erro <= 0.015) return "fiel";
  if (erro <= 0.04) return "próxima";
  return "aproximada";
}
