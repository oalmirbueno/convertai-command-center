/**
 * Achar a legenda que já veio gravada no vídeo (Mesa Edição, 02/10/2026).
 *
 * Sem custo e sem rede: a tela tira alguns quadros do vídeo (canvas pequeno,
 * só a luminância) e esta regra procura a FAIXA de texto:
 * - letra de legenda é clara (branca ou amarela) com contorno ou sombra
 *   escura: muitas bordas fortes com um lado claro, concentradas numa faixa
 *   horizontal;
 * - a faixa fica embaixo (até a metade de baixo) ou em cima (até 22%);
 * - legenda MUDA de um quadro para o outro; texto parado (logo, placa) fica
 *   com a confiança baixa e marcado como `parado`.
 * A pessoa vê a faixa desenhada num quadro e ajusta antes de pagar. A região
 * sai em fração do quadro, pronta para `regiaoValida` (tratamento-de-video.ts).
 *
 * Puro: sem DOM. A tela passa a luminância (0 a 255) de cada quadro.
 */

export interface QuadroEmLuma {
  largura: number;
  altura: number;
  /** Luminância por pixel, linha a linha (largura x altura). */
  luma: ArrayLike<number>;
}

export interface LegendaAchada {
  regiao: { x: number; y: number; w: number; h: number };
  /** 0 a 1. */
  confianca: number;
  /** Em quantos quadros a faixa tinha texto. */
  presenca: number;
  quadros: number;
  /** O texto não muda entre os quadros (logo, placa): talvez não seja legenda. */
  parado: boolean;
}

/** Borda de letra: salto de luminância de 48 ou mais com o lado claro acima de 165. */
const SALTO = 48;
const CLARO = 165;

/** Fração de pixels de borda de letra em cada linha do quadro. */
export function perfilDasLinhas(q: QuadroEmLuma): number[] {
  const W = q.largura;
  const H = q.altura;
  const saida: number[] = new Array(H).fill(0);
  for (let y = 0; y < H; y++) {
    let n = 0;
    const base = y * W;
    for (let x = 0; x + 1 < W; x++) {
      const a = q.luma[base + x];
      const b = q.luma[base + x + 1];
      if (Math.abs(a - b) >= SALTO && Math.max(a, b) >= CLARO) n++;
    }
    saida[y] = n / Math.max(1, W - 1);
  }
  return saida;
}

/** Bordas de letra por coluna dentro de uma faixa de linhas. */
function perfilDasColunas(q: QuadroEmLuma, y0: number, y1: number): number[] {
  const W = q.largura;
  const saida: number[] = new Array(W).fill(0);
  for (let y = y0; y < y1; y++) {
    const base = y * W;
    for (let x = 0; x + 1 < W; x++) {
      const a = q.luma[base + x];
      const b = q.luma[base + x + 1];
      if (Math.abs(a - b) >= SALTO && Math.max(a, b) >= CLARO) saida[x]++;
    }
  }
  return saida;
}

const media = (l: number[]) => (l.length ? l.reduce((s, x) => s + x, 0) / l.length : 0);

/** Assinatura da faixa num quadro (para saber se o texto muda): luminância média por bloco. */
function assinatura(q: QuadroEmLuma, y0: number, y1: number, x0: number, x1: number, blocos = 16): number[] {
  const W = q.largura;
  const passo = Math.max(1, Math.floor((x1 - x0) / blocos));
  const saida: number[] = [];
  for (let b = 0; b < blocos; b++) {
    let s = 0;
    let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0 + b * passo; x < Math.min(x1, x0 + (b + 1) * passo); x++) {
      s += q.luma[y * W + x];
      n++;
    }
    saida.push(n ? s / n : 0);
  }
  return saida;
}

/**
 * A faixa de legenda nos quadros, ou null quando não há texto que pareça
 * legenda. Quadros de tamanhos diferentes: só os do tamanho do primeiro contam.
 */
export function acharLegenda(quadros: QuadroEmLuma[]): LegendaAchada | null {
  if (!quadros.length) return null;
  const W = quadros[0].largura;
  const H = quadros[0].altura;
  const validos = quadros.filter((q) => q.largura === W && q.altura === H && q.luma.length >= W * H);
  if (!validos.length || W < 32 || H < 32) return null;
  const perfis = validos.map(perfilDasLinhas);
  // Perfil médio, suavizado em 3 linhas.
  const medio = new Array(H).fill(0).map((_, y) => media(perfis.map((p) => p[y])));
  const suave = medio.map((_, y) => media([medio[Math.max(0, y - 1)], medio[y], medio[Math.min(H - 1, y + 1)]]));
  const ordenado = suave.slice().sort((a, b) => a - b);
  const mediana = ordenado[Math.floor(H / 2)];
  const limiar = Math.max(0.03, mediana * 3 + 0.01);
  // Trechos de linhas acima do limiar, juntando buracos de até 2% da altura.
  const buraco = Math.max(1, Math.round(H * 0.02));
  const trechos: { y0: number; y1: number; soma: number }[] = [];
  let atual: { y0: number; y1: number; soma: number } | null = null;
  let vazias = 0;
  for (let y = 0; y < H; y++) {
    if (suave[y] >= limiar) {
      if (!atual) atual = { y0: y, y1: y + 1, soma: 0 };
      atual.y1 = y + 1;
      atual.soma += suave[y];
      vazias = 0;
    } else if (atual) {
      vazias++;
      if (vazias > buraco) {
        trechos.push(atual);
        atual = null;
        vazias = 0;
      }
    }
  }
  if (atual) trechos.push(atual);
  const naZona = trechos.filter((t) => {
    const altura = (t.y1 - t.y0) / H;
    const centro = (t.y0 + t.y1) / 2 / H;
    return altura >= 0.02 && altura <= 0.35 && (centro >= 0.5 || centro <= 0.22);
  });
  if (!naZona.length) return null;
  const melhor = naZona.reduce((a, b) => (b.soma > a.soma ? b : a));
  // Largura: colunas com borda de letra em pelo menos 1/4 dos quadros.
  const colunas = new Array(W).fill(0);
  validos.forEach((q) => {
    const c = perfilDasColunas(q, melhor.y0, melhor.y1);
    for (let x = 0; x < W; x++) if (c[x] > 0) colunas[x]++;
  });
  const minimo = Math.max(1, Math.ceil(validos.length / 4));
  let x0 = colunas.findIndex((n) => n >= minimo);
  let x1 = W - 1 - colunas.slice().reverse().findIndex((n) => n >= minimo);
  if (x0 < 0 || x1 <= x0) return null;
  x0 = Math.max(0, x0 - Math.round(W * 0.03));
  x1 = Math.min(W, x1 + 1 + Math.round(W * 0.03));
  // Presença por quadro e mudança do texto entre quadros.
  const porQuadro = perfis.map((p) => media(p.slice(melhor.y0, melhor.y1)));
  const presenca = porQuadro.filter((v) => v >= limiar * 0.8).length;
  const assinaturas = validos.map((q) => assinatura(q, melhor.y0, melhor.y1, x0, x1));
  let mudanca = 0;
  for (let k = 1; k < assinaturas.length; k++) mudanca += media(assinaturas[k].map((v, i) => Math.abs(v - assinaturas[k - 1][i])));
  mudanca = assinaturas.length > 1 ? mudanca / (assinaturas.length - 1) : 0;
  const parado = validos.length > 2 && mudanca < 2;
  const forca = Math.min(1, media(suave.slice(melhor.y0, melhor.y1)) / (limiar * 2.5));
  const constancia = presenca / validos.length;
  let confianca = 0.45 * forca + 0.35 * constancia + (parado ? 0 : 0.2);
  confianca = Math.round(Math.max(0, Math.min(1, confianca)) * 100) / 100;
  if (confianca < 0.35) return null;
  const q = (z: number) => Math.round(z * 10000) / 10000;
  return { regiao: { x: q(x0 / W), y: q(melhor.y0 / H), w: q((x1 - x0) / W), h: q((melhor.y1 - melhor.y0) / H) }, confianca, presenca, quadros: validos.length, parado };
}
