/**
 * Recorte limpo, sem halo (frente IDR, 30/09; revisão de 01/10). Núcleo do
 * servidor e da tela, sem IA: fundo sólido pela borda (alfa pela projeção
 * C = aF + (1 - a)B e cor descontaminada) e a borda do recorte da IA com a
 * foto original atrás. A franja de PNG transparente e a medida do halo moram
 * em src/lib/recorte/franja.ts (só a janela "Limpar fundo" usa; aqui o
 * compartilhado das funções fica abaixo do teto do Lovable).
 * Puro. Sem lookbehind, \p{} ou grupo nomeado.
 */

export type PixelsRGBA = { data: Uint8Array | Uint8ClampedArray; largura: number; altura: number };
export type Rgb = [number, number, number];
export type FundoDaBorda = { tipo: "transparente" | "solido" | "misto"; cor: Rgb | null; ruido: number; claro: boolean };
export type InfoDoRecorte = { tolerancia: number; fundo_px: number; furos_tirados: number; furos_mantidos: number; borda_px: number; erosao: number };

export const BRANCO: Rgb = [255, 255, 255];

export const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
export const byte = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
export function dist(d: ArrayLike<number>, i: number, c: Rgb): number {
  const r = d[i] - c[0], g = d[i + 1] - c[1], b = d[i + 2] - c[2];
  return Math.sqrt(r * r + g * g + b * b);
}

/** Tolerância (distância RGB) pelo ruído da borda: JPEG e sombra leve cabem, a logo não. */
export function toleranciaDoFundo(ruido: number): number {
  return Math.max(22, Math.min(60, 3 * ruido + 16));
}

/** O fundo pela borda: transparente, sólido (cor e ruído) ou misto (foto, degradê). */
export function fundoPelaBorda(img: PixelsRGBA): FundoDaBorda {
  const { data: d, largura: W, altura: H } = img;
  const pts: number[] = [];
  const passo = Math.max(1, Math.floor(Math.max(W, H) / 400));
  for (let x = 0; x < W; x += passo) pts.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y += passo) pts.push(y * W, y * W + W - 1);
  if (pts.filter((p) => d[p * 4 + 3] < 16).length >= pts.length * 0.6) return { tipo: "transparente", cor: null, ruido: 0, claro: false };
  const opacos = pts.filter((p) => d[p * 4 + 3] >= 200);
  if (!opacos.length) return { tipo: "misto", cor: null, ruido: 0, claro: false };
  const med = (v: number[]) => v.sort((a, b) => a - b)[Math.floor(v.length / 2)];
  const cor = [0, 1, 2].map((k) => med(opacos.map((p) => d[p * 4 + k]))) as Rgb;
  const desvios = opacos.map((p) => dist(d, p * 4, cor));
  const ruido = med(desvios.slice());
  const iguais = desvios.filter((x) => x <= toleranciaDoFundo(ruido)).length;
  const claro = lum(cor[0], cor[1], cor[2]) >= 185;
  return iguais >= pts.length * 0.8 ? { tipo: "solido", cor, ruido, claro } : { tipo: "misto", cor: null, ruido, claro };
}

/** 1 em todo pixel com algum marcado a até `r` px (quadrado): carimba só em volta da beirada do marcado. */
export function dilatar(m: Uint8Array, W: number, H: number, r: number): Uint8Array {
  const N = W * H;
  const s = new Uint8Array(m);
  for (let p = 0; p < N; p++) {
    if (!m[p]) continue;
    const x0 = p % W;
    if ((x0 === 0 || m[p - 1]) && (x0 === W - 1 || m[p + 1]) && (p < W || m[p - W]) && (p + W >= N || m[p + W])) continue;
    const y0 = (p - x0) / W;
    for (let y = Math.max(0, y0 - r); y <= Math.min(H - 1, y0 + r); y++) s.fill(1, y * W + Math.max(0, x0 - r), y * W + Math.min(W - 1, x0 + r) + 1);
  }
  return s;
}

/**
 * Preenche a partir das sementes (4 vizinhos) o que `aceito` deixa, pondo
 * `valor` em `marca`. Pilha tipada: cada pixel entra uma vez. Devolve os pixels.
 */
export function encher(marca: Uint8Array, pilha: Int32Array, W: number, sementes: ArrayLike<number>, valor: number, aceito: (p: number) => boolean): number[] {
  const N = marca.length;
  let topo = 0;
  const vistos: number[] = [];
  const por = (q: number) => {
    if (!marca[q] && aceito(q)) {
      marca[q] = valor;
      pilha[topo++] = q;
    }
  };
  for (let k = 0; k < sementes.length; k++) por(sementes[k]);
  while (topo) {
    const p = pilha[--topo];
    vistos.push(p);
    const x = p % W;
    if (x > 0) por(p - 1);
    if (x < W - 1) por(p + 1);
    if (p >= W) por(p - W);
    if (p + W < N) por(p + W);
  }
  return vistos;
}

function bordaDaImagem(W: number, H: number): number[] {
  const b: number[] = [];
  for (let x = 0; x < W; x++) b.push(x, (H - 1) * W + x);
  for (let y = 1; y < H - 1; y++) b.push(y * W, y * W + W - 1);
  return b;
}

/** Quanto do pixel é a cor F sobre o fundo B (0 a 1), pela projeção; null quando F e B quase se confundem. */
export function alfaPorProjecao(c: ArrayLike<number>, i: number, f: Rgb, b: Rgb): number | null {
  const fx = f[0] - b[0], fy = f[1] - b[1], fz = f[2] - b[2];
  const n2 = fx * fx + fy * fy + fz * fz;
  if (n2 < 900) return null;
  const a = ((c[i] - b[0]) * fx + (c[i + 1] - b[1]) * fy + (c[i + 2] - b[2]) * fz) / n2;
  return a < 0 ? 0 : a > 1 ? 1 : a;
}

/**
 * A faixa da borda: para cada pixel do desenho a até `raio` px do fundo
 * (`fundo` = 1), o alfa pela projeção entre a cor de dentro (F) e a do fundo
 * naquele ponto (B: `corFixa` ou a média de `fonte` sob `fundoDaCor`, a até 4 px)
 * e a cor descontaminada. `somenteBaixar`: o alfa nunca sobe (recorte que já
 * tinha alfa); nesse caso o miolo é o que está longe do fundo pela cor
 * (`longeDoFundo`), porque a máscara da IA pode ter pego o fundo. Laços sem
 * função interna: a Mesa Foto roda isto dentro dos 2 s de CPU.
 */
export function mattear(d: ArrayLike<number>, s: Uint8ClampedArray, W: number, H: number, fundo: Uint8Array, corFixa: Rgb | null, fonte: ArrayLike<number> | null, raio: number, somenteBaixar: boolean, longeDoFundo = 0, fundoDaCor: Uint8Array = fundo): { borda: number; lumFundo: number } {
  const N = W * H;
  const perto = dilatar(fundo, W, H, raio);
  const colado = longeDoFundo ? dilatar(fundo, W, H, 1) : perto;
  const miolo = new Uint8Array(N);
  for (let q = 0; q < N; q++) miolo[q] = !colado[q] && !fundo[q] && d[q * 4 + 3] >= 250 ? 1 : 0;
  const limite2 = longeDoFundo * longeDoFundo;
  let borda = 0, somaLum = 0, nLum = 0;
  const b: Rgb = [0, 0, 0];
  const f: Rgb = [0, 0, 0];
  for (let p = 0; p < N; p++) {
    const i = p * 4;
    if (fundo[p]) {
      s[i + 3] = 0;
      continue;
    }
    if (!perto[p] && (!somenteBaixar || d[i + 3] >= 250)) continue;
    borda++;
    const x0 = p % W, y0 = (p - x0) / W;
    if (corFixa) {
      b[0] = corFixa[0];
      b[1] = corFixa[1];
      b[2] = corFixa[2];
    } else if (fonte) {
      let r = 0, g = 0, bl = 0, n = 0;
      for (let y = Math.max(0, y0 - 4); y <= Math.min(H - 1, y0 + 4); y++) {
        for (let x = Math.max(0, x0 - 4), q = y * W + x; x <= Math.min(W - 1, x0 + 4); x++, q++) {
          if (!fundoDaCor[q]) continue;
          r += fonte[q * 4];
          g += fonte[q * 4 + 1];
          bl += fonte[q * 4 + 2];
          n++;
        }
      }
      if (!n) continue;
      b[0] = r / n;
      b[1] = g / n;
      b[2] = bl / n;
    } else continue;
    somaLum += lum(b[0], b[1], b[2]);
    nLum++;
    // F: a média do miolo a até 3 px (senão 5), longe do fundo pela cor quando a máscara é da IA.
    let achou = false;
    // Borda larga (logo ampliada, JPEG borrado): o miolo começa depois da faixa, então a janela também.
    const iniF = !somenteBaixar && raio > 2 ? raio + 1 : 3;
    for (let raioF = iniF; raioF <= iniF + 2 && !achou; raioF += 2) {
      let r = 0, g = 0, bl = 0, n = 0;
      for (let y = Math.max(0, y0 - raioF); y <= Math.min(H - 1, y0 + raioF); y++) {
        for (let x = Math.max(0, x0 - raioF), q = y * W + x; x <= Math.min(W - 1, x0 + raioF); x++, q++) {
          if (!miolo[q]) continue;
          const j = q * 4;
          if (limite2) {
            const e0 = d[j] - b[0], e1 = d[j + 1] - b[1], e2 = d[j + 2] - b[2];
            if (e0 * e0 + e1 * e1 + e2 * e2 <= limite2) continue;
          }
          r += d[j];
          g += d[j + 1];
          bl += d[j + 2];
          n++;
        }
      }
      if (n) {
        f[0] = r / n;
        f[1] = g / n;
        f[2] = bl / n;
        achou = true;
      }
    }
    if (!achou && !somenteBaixar) {
      // Traço fino, sem miolo perto: a cor mais longe do fundo na vizinhança (do tamanho da faixa).
      let melhor = -1;
      const rv = raio > 2 ? raio : 2;
      for (let y = Math.max(0, y0 - rv); y <= Math.min(H - 1, y0 + rv); y++) {
        for (let x = Math.max(0, x0 - rv), q = y * W + x; x <= Math.min(W - 1, x0 + rv); x++, q++) {
          if (fundo[q]) continue;
          const dq = dist(d, q * 4, b);
          if (dq > melhor) {
            melhor = dq;
            f[0] = d[q * 4];
            f[1] = d[q * 4 + 1];
            f[2] = d[q * 4 + 2];
            achou = true;
          }
        }
      }
    }
    if (!achou) {
      // Máscara macia da IA longe do assunto: o que tem a cor do fundo ali é fundo.
      if (somenteBaixar && limite2 && d[i + 3] < 250 && dist(d, i, b) <= longeDoFundo) s[i + 3] = 0;
      continue;
    }
    const a = alfaPorProjecao(d, i, f, b);
    if (a === null) continue;
    const alfa = a < 0.05 ? 0 : a > 0.95 ? 1 : a;
    s[i + 3] = somenteBaixar ? Math.min(d[i + 3], byte(255 * alfa)) : byte(d[i + 3] * alfa);
    // Mistura com o fundo sai (a >= 0,5); pouco desenho no pixel: a cor de dentro. A cor limpa não passa
    // da cor de dentro (revisão de 01/10: sem o limite, a borda escurecia além do desenho, o halo "escuro").
    for (let k = 0; k < 3; k++) {
      if (alfa < 0.5) {
        s[i + k] = byte(f[k]);
        continue;
      }
      const limpa = b[k] + (d[i + k] - b[k]) / alfa;
      const lo = d[i + k] < f[k] ? d[i + k] : f[k], hi = d[i + k] < f[k] ? f[k] : d[i + k];
      s[i + k] = byte(limpa < lo ? lo : limpa > hi ? hi : limpa);
    }
  }
  return { borda, lumFundo: nLum ? somaLum / nLum : 0 };
}

/** O transparente em volta ganha a cor da borda (2 px), sem mexer no alfa. */
export function sangrarCor(s: Uint8ClampedArray, W: number, H: number) {
  const N = W * H;
  const tem = new Uint8Array(N);
  for (let p = 0; p < N; p++) tem[p] = s[p * 4 + 3] > 0 ? 1 : 0;
  for (let volta = 0; volta < 2; volta++) {
    const novos: number[] = [];
    for (let p = 0; p < N; p++) {
      if (tem[p]) continue;
      const x = p % W;
      if ((x > 0 && tem[p - 1]) || (x < W - 1 && tem[p + 1]) || (p >= W && tem[p - W]) || (p + W < N && tem[p + W])) novos.push(p);
    }
    for (const p of novos) {
      const x0 = p % W, y0 = (p - x0) / W;
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = Math.max(0, y0 - 1); y <= Math.min(H - 1, y0 + 1); y++) {
        for (let x = Math.max(0, x0 - 1), q = y * W + x; x <= Math.min(W - 1, x0 + 1); x++, q++) {
          if (tem[q] !== 1) continue;
          r += s[q * 4];
          g += s[q * 4 + 1];
          b += s[q * 4 + 2];
          n++;
        }
      }
      if (!n) continue;
      s[p * 4] = byte(r / n);
      s[p * 4 + 1] = byte(g / n);
      s[p * 4 + 2] = byte(b / n);
    }
    for (const p of novos) tem[p] = 1;
  }
}

export function copia(d: ArrayLike<number>): Uint8ClampedArray {
  const s = new Uint8ClampedArray(d.length);
  s.set(d);
  return s;
}

/**
 * Largura da faixa de mistura entre o fundo e o desenho (px, mediana): logo
 * desenhada no tamanho tem 1 a 2 px; ampliada ou JPEG borrado, 4 a 8. Anda da
 * borda do fundo para dentro até a cor parar de mudar. Amostra até 2.000
 * pontos (barato mesmo em 12 MP).
 */
export function larguraDaBorda(d: ArrayLike<number>, W: number, H: number, fundo: Uint8Array): number {
  const N = W * H;
  const larguras: number[] = [];
  const passo = Math.max(1, Math.floor(N / 400000));
  for (let p = 0; p < N && larguras.length < 2000; p += passo) {
    if (fundo[p]) continue;
    const x = p % W;
    // Direção para dentro: oposta ao vizinho que é fundo.
    let dir = 0;
    if (x > 0 && fundo[p - 1]) dir = 1;
    else if (x < W - 1 && fundo[p + 1]) dir = -1;
    else if (p >= W && fundo[p - W]) dir = W;
    else if (p + W < N && fundo[p + W]) dir = -W;
    if (!dir) continue;
    let k = 0;
    let q = p;
    while (k < 10) {
      const r = q + dir;
      if (r < 0 || r >= N || fundo[r] || (Math.abs(dir) === 1 && Math.floor(r / W) !== Math.floor(q / W))) break;
      const dr = d[r * 4] - d[q * 4], dg = d[r * 4 + 1] - d[q * 4 + 1], db = d[r * 4 + 2] - d[q * 4 + 2];
      if (dr * dr + dg * dg + db * db < 64) break;
      k++;
      q = r;
    }
    larguras.push(k + 1);
  }
  if (!larguras.length) return 1;
  larguras.sort((a, b) => a - b);
  return larguras[Math.floor(larguras.length / 2)];
}

/**
 * Tira o fundo sólido `cor` com alfa limpo e cor descontaminada. `furos`:
 * "tirar" (padrão) ou "manter" os vãos fechados da cor do fundo.
 */
export function recortarFundoSolido(img: PixelsRGBA, o: { cor: Rgb; tolerancia?: number; furos?: "tirar" | "manter" }): { data: Uint8ClampedArray; info: InfoDoRecorte } {
  const { data: d, largura: W, altura: H } = img;
  const N = W * H;
  const B = o.cor;
  const tol = o.tolerancia || 30;
  const ehFundo = (p: number) => d[p * 4 + 3] < 16 || dist(d, p * 4, B) <= tol;
  // 1 = fundo; 3 = vão fechado ainda sem decisão; 4 = desenho.
  const marca = new Uint8Array(N);
  const pilha = new Int32Array(N);
  let fundoPx = encher(marca, pilha, W, bordaDaImagem(W, H), 1, ehFundo).length;
  const furos: number[][] = [];
  for (let p = 0; p < N; p++) if (!marca[p] && ehFundo(p)) furos.push(encher(marca, pilha, W, [p], 3, ehFundo));
  // Vão fechado da cor do fundo: sai por padrão (miolo do "o", espaço negativo de um símbolo); "manter"
  // guarda o branco que é desenho (texto branco dentro de um selo). Nenhuma regra de forma separa os dois
  // com segurança (a ACERBI tem vãos grandes dentro do quadrado verde que são fundo): a equipe escolhe.
  const manter = o.furos === "manter";
  let tirados = 0;
  for (const f of furos) {
    for (const p of f) marca[p] = manter ? 4 : 1;
    if (!manter) {
      tirados++;
      fundoPx += f.length;
    }
  }
  const mantidos = manter ? furos.length : 0;
  const fundo = new Uint8Array(N);
  for (let p = 0; p < N; p++) fundo[p] = marca[p] === 1 ? 1 : 0;
  const s = copia(d);
  // A faixa da borda acompanha a largura da mistura (2 px na logo nítida; até 8 na ampliada ou borrada).
  const raio = Math.max(2, Math.min(8, larguraDaBorda(d, W, H, fundo)));
  const m = mattear(d, s, W, H, fundo, B, null, raio, false);
  sangrarCor(s, W, H);
  return { data: s, info: { tolerancia: Math.round(tol), fundo_px: fundoPx, furos_tirados: tirados, furos_mantidos: mantidos, borda_px: m.borda, erosao: 0 } };
}

/**
 * Borda do recorte feito por IA (o alfa já existe): o fundo de cada ponto vem
 * da foto `original` (mesmo tamanho) ou da cor que ficou sob o transparente
 * (`corSobTransparente`). O alfa só baixa. `erodir` 0, 1, 2 ou "auto"
 * (1 px quando o fundo em volta era claro).
 */
export function limparBordaDoRecorte(img: PixelsRGBA, o: { original?: ArrayLike<number> | null; corSobTransparente?: boolean; erodir?: number | "auto" } = {}): { data: Uint8ClampedArray; info: InfoDoRecorte } {
  const { data: d, largura: W, altura: H } = img;
  const N = W * H;
  const fonte = o.original || (o.corSobTransparente ? d : null);
  const s = copia(d);
  const fundo = new Uint8Array(N);
  for (let p = 0; p < N; p++) fundo[p] = d[p * 4 + 3] <= 8 ? 1 : 0;
  if (!fonte) return { data: s, info: { tolerancia: 0, fundo_px: 0, furos_tirados: 0, furos_mantidos: 0, borda_px: 0, erosao: 0 } };
  // A cor do fundo vem de onde a máscara é quase fundo (alfa abaixo de 64): a máscara macia da IA pode não ter
  // nenhum pixel zerado perto da borda.
  const quaseFundo = new Uint8Array(N);
  for (let p = 0; p < N; p++) quaseFundo[p] = d[p * 4 + 3] < 64 ? 1 : 0;
  const m = mattear(d, s, W, H, fundo, null, fonte, 3, true, 45, quaseFundo);
  // Fundo claro (a média do fundo na borda): a borda cede 1 px, o resto de franja clara some sem medir de novo (CPU).
  let erosao = o.erodir === "auto" ? (m.lumFundo >= 185 ? 1 : 0) : Math.max(0, Math.min(2, Math.round(Number(o.erodir) || 0)));
  const perto = dilatar(fundo, W, H, 2);
  for (let k = 0; k < erosao; k++) {
    const antes = copia(s);
    for (let p = 0; p < N; p++) {
      if (!perto[p] || !antes[p * 4 + 3]) continue;
      const x = p % W;
      let menor = antes[p * 4 + 3];
      if (x > 0) menor = Math.min(menor, antes[(p - 1) * 4 + 3]);
      if (x < W - 1) menor = Math.min(menor, antes[(p + 1) * 4 + 3]);
      if (p >= W) menor = Math.min(menor, antes[(p - W) * 4 + 3]);
      if (p + W < N) menor = Math.min(menor, antes[(p + W) * 4 + 3]);
      s[p * 4 + 3] = menor;
    }
  }
  if (!m.borda) erosao = 0;
  sangrarCor(s, W, H);
  return { data: s, info: { tolerancia: 0, fundo_px: 0, furos_tirados: 0, furos_mantidos: 0, borda_px: m.borda, erosao } };
}
