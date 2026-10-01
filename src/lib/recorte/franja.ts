/**
 * Franja clara de PNG transparente e a medida do halo (frente IDR, revisão
 * de 01/10). Só a janela "Limpar fundo" da Mesa Identidade usa, sempre com
 * antes e depois: nenhum caminho automático tira franja (VIFUT e CME). O
 * núcleo do recorte limpo continua em supabase/functions/_shared/recorte-limpo.ts.
 * Puro (navegador, worker e testes), no piso Safari 11 e Chrome 64.
 */

import {
  BRANCO,
  copia,
  dilatar,
  dist,
  encher,
  type FundoDaBorda,
  fundoPelaBorda,
  type InfoDoRecorte,
  lum,
  mattear,
  type PixelsRGBA,
  recortarFundoSolido,
  type Rgb,
  sangrarCor,
  toleranciaDoFundo,
  byte,
} from "../../../supabase/functions/_shared/recorte-limpo";

export type Halo = { claro: number; escuro: number; anel: number; pontos: number };

/** Halo que vale limpar (0 a 255): acima disso a equipe vê o contorno claro no escuro. */
export const LIMITE_DO_HALO = 12;

/** Média da cor dos pixels `aceito` numa janela quadrada; null sem nenhum. */
function media(d: ArrayLike<number>, W: number, H: number, p: number, raio: number, aceito: (q: number) => boolean): Rgb | null {
  const x0 = p % W, y0 = (p - x0) / W;
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = Math.max(0, y0 - raio); y <= Math.min(H - 1, y0 + raio); y++) {
    for (let x = Math.max(0, x0 - raio), q = y * W + x; x <= Math.min(W - 1, x0 + raio); x++, q++) {
      if (!aceito(q)) continue;
      r += d[q * 4];
      g += d[q * 4 + 1];
      b += d[q * 4 + 2];
      n++;
    }
  }
  return n ? [r / n, g / n, b / n] : null;
}

/** Critério do anel de franja (revisão de 01/10, VIFUT e CME): o que passa disso é desenho e fica. */
export const ANEL_DA_FRANJA = {
  /** Largura máxima (px): cada ponto do anel encosta no transparente ou no desenho (8 vizinhos). */
  largura: 2,
  /** Fração do anel que pode ter 3 px ou mais de largura (serrilhado de canto). */
  folgaDeLargura: 0.03,
  /** O anel contorna pelo menos esta fração da borda externa das formas vizinhas. */
  contorno: 0.6,
  /** Fração máxima de branco chapado e opaco (alfa >= 250, a menos de 12 da cor do fundo): a franja é mistura. */
  chapado: 0.4,
  distanciaDoChapado: 12,
} as const;

/**
 * Distância RGB até a cor do fundo que ainda conta como franja: a mistura de
 * 1 px entre o desenho e o branco (medida: 60 deixava o anel em pedaços e só
 * 27% da borda da VIFUT mal recortada saía; 120 já pegava a CME). O cinza
 * claro da bússola da VIFUT (#A8B0C0) fica a 133 do branco.
 */
export const TOLERANCIA_DA_FRANJA = 90;

export type AneisDaFranja = { fundo: Uint8Array; aneis: number; mantidos: number; px: number; contorno: number };

/**
 * Os anéis de franja de um PNG transparente: componentes da cor `B` (até
 * `tol`) colados ao transparente que (1) têm até 2 px de largura, (2)
 * contornam 60% ou mais da borda externa das formas vizinhas e (3) têm o
 * perfil de mistura (alfa parcial ou degradê da cor do desenho para o
 * branco), não um branco chapado e opaco. Ponta clara de um símbolo, gomo
 * branco, anel branco desenhado: ficam. `fundo` volta com os anéis marcados.
 */
export function aneisDaFranja(img: PixelsRGBA, B: Rgb = BRANCO, tol = TOLERANCIA_DA_FRANJA): AneisDaFranja {
  const { data: d, largura: W, altura: H } = img;
  const N = W * H;
  const fundo = new Uint8Array(N);
  for (let p = 0; p < N; p++) fundo[p] = d[p * 4 + 3] <= 8 ? 1 : 0;
  // 1 = da cor do fundo (candidata), 2 = desenho (qualquer outra cor visível).
  const tipo = new Uint8Array(N);
  for (let p = 0; p < N; p++) if (!fundo[p]) tipo[p] = dist(d, p * 4, B) <= tol ? 1 : 2;
  const colado = dilatar(fundo, W, H, 1);
  const desenho = new Uint8Array(N);
  for (let p = 0; p < N; p++) desenho[p] = tipo[p] === 2 ? 1 : 0;
  const pertoDoDesenho = dilatar(desenho, W, H, 1);
  // Componentes claros colados ao transparente (o lado de fora); cada um com seu número em `comp`.
  const comp = new Int32Array(N);
  const pilha = new Int32Array(N);
  const marca = new Uint8Array(N);
  const ehCor = (p: number) => tipo[p] === 1;
  const lista: number[][] = [];
  const candidato: boolean[] = [];
  for (let p = 0; p < N; p++) {
    if (marca[p] || !colado[p] || tipo[p] !== 1) continue;
    const c = encher(marca, pilha, W, [p], 1, ehCor);
    const id = lista.length + 1;
    let largo = 0, chapado = 0;
    for (const q of c) {
      comp[q] = id;
      if (!colado[q] && !pertoDoDesenho[q]) largo++;
      if (d[q * 4 + 3] >= 250 && dist(d, q * 4, B) < ANEL_DA_FRANJA.distanciaDoChapado) chapado++;
    }
    lista.push(c);
    candidato.push(largo <= c.length * ANEL_DA_FRANJA.folgaDeLargura && chapado <= c.length * ANEL_DA_FRANJA.chapado);
  }
  if (!candidato.some(Boolean)) return { fundo, aneis: 0, mantidos: lista.length, px: 0, contorno: 0 };
  // Formas do desenho (4 vizinhos) e quanto da borda externa delas cada candidato cobre.
  const forma = new Int32Array(N);
  const marcaF = new Uint8Array(N);
  let nFormas = 0;
  for (let p = 0; p < N; p++) {
    if (marcaF[p] || !desenho[p]) continue;
    nFormas++;
    for (const q of encher(marcaF, pilha, W, [p], 1, (z) => desenho[z] === 1)) forma[q] = nFormas;
  }
  const perimetro = new Float64Array(nFormas + 1);
  const coberto = new Float64Array(nFormas + 1);
  const fora = (z: number) => fundo[z] === 1 || comp[z] > 0;
  const anel = (z: number) => comp[z] > 0 && candidato[comp[z] - 1];
  for (let p = 0; p < N; p++) {
    if (!desenho[p]) continue;
    const x = p % W;
    const e = x > 0, dd = x < W - 1, c = p >= W, b = p + W < N;
    if (!((e && fora(p - 1)) || (dd && fora(p + 1)) || (c && fora(p - W)) || (b && fora(p + W)))) continue;
    perimetro[forma[p]]++;
    if ((e && anel(p - 1)) || (dd && anel(p + 1)) || (c && anel(p - W)) || (b && anel(p + W))) coberto[forma[p]]++;
  }
  let aneis = 0, mantidos = 0, px = 0;
  const aceitas = new Set<number>();
  for (let k = 0; k < lista.length; k++) {
    if (!candidato[k]) {
      mantidos++;
      continue;
    }
    // As formas que este candidato toca, e a cobertura da borda externa delas (por todos os candidatos).
    const tocadas = new Set<number>();
    for (const q of lista[k]) {
      const x = q % W;
      if (x > 0 && desenho[q - 1]) tocadas.add(forma[q - 1]);
      if (x < W - 1 && desenho[q + 1]) tocadas.add(forma[q + 1]);
      if (q >= W && desenho[q - W]) tocadas.add(forma[q - W]);
      if (q + W < N && desenho[q + W]) tocadas.add(forma[q + W]);
    }
    let per = 0, cob = 0;
    tocadas.forEach((f) => {
      per += perimetro[f];
      cob += coberto[f];
    });
    if (per > 0 && cob >= per * ANEL_DA_FRANJA.contorno) {
      tocadas.forEach((f) => aceitas.add(f));
      for (const q of lista[k]) fundo[q] = 1;
      aneis++;
      px += lista[k].length;
    } else mantidos++;
  }
  // Quanto da borda externa de TODO o desenho os anéis aceitos cobrem (o diagnóstico pede a maior parte).
  let perTotal = 0, cobAceito = 0;
  for (let f = 1; f <= nFormas; f++) {
    perTotal += perimetro[f];
    if (aceitas.has(f)) cobAceito += coberto[f];
  }
  return { fundo, aneis, mantidos, px, contorno: perTotal ? Math.round((cobAceito / perTotal) * 1000) / 1000 : 0 };
}

/**
 * PNG já transparente com franja da cor `fundo` (a logo tirada de um fundo
 * branco por uma ferramenta ruim): sai só o anel de franja (aneisDaFranja:
 * fino, em volta da forma e com perfil de mistura). Branco que é desenho
 * fica. Só roda quando a equipe pede, com prévia (janela "Limpar fundo").
 */
export function tirarFranja(img: PixelsRGBA, o: { fundo?: Rgb; tolerancia?: number } = {}): { data: Uint8ClampedArray; info: InfoDoRecorte } {
  const { data: d, largura: W, altura: H } = img;
  const B = o.fundo || BRANCO;
  const tol = o.tolerancia || TOLERANCIA_DA_FRANJA;
  const achados = aneisDaFranja(img, B, tol);
  const { fundo, aneis, mantidos } = achados;
  const tiradosPx = achados.px;
  const s = copia(d);
  if (!aneis) return { data: s, info: { tolerancia: tol, fundo_px: 0, furos_tirados: 0, furos_mantidos: mantidos, borda_px: 0, erosao: 0 } };
  const m = mattear(d, s, W, H, fundo, B, null, 1, true);
  // Só a vizinhança dos anéis tirados muda (2 px): o resto da borda da logo fica como veio.
  const N = W * H;
  const anel = new Uint8Array(N);
  for (let p = 0; p < N; p++) anel[p] = fundo[p] && d[p * 4 + 3] > 8 ? 1 : 0;
  const perto = dilatar(anel, W, H, 2);
  for (let p = 0; p < N; p++) {
    if (perto[p]) continue;
    const i = p * 4;
    s[i] = d[i];
    s[i + 1] = d[i + 1];
    s[i + 2] = d[i + 2];
    s[i + 3] = d[i + 3];
  }
  sangrarCor(s, W, H);
  return { data: s, info: { tolerancia: tol, fundo_px: tiradosPx, furos_tirados: aneis, furos_mantidos: mantidos, borda_px: m.borda, erosao: 0 } };
}

/**
 * Quanto a borda destoa do miolo (0 a 255, média pelo alfa): `claro` é o halo
 * que aparece sobre fundo escuro, `escuro` o contrário; `anel` é a fração da
 * borda mais de 40 pontos mais clara que o miolo ao lado.
 */
export function medirHalo(img: PixelsRGBA): Halo {
  const { data: d, largura: W, altura: H } = img;
  const N = W * H;
  const transp = new Uint8Array(N);
  for (let p = 0; p < N; p++) transp[p] = d[p * 4 + 3] <= 8 ? 1 : 0;
  const colado = dilatar(transp, W, H, 1);
  const longe = dilatar(transp, W, H, 3);
  const passo = N > 1500000 ? 3 : 1;
  let claro = 0, escuro = 0, peso = 0, anel = 0, n = 0;
  for (let p = 0; p < N; p += passo) {
    const i = p * 4;
    if (transp[p] || !colado[p] || d[i + 3] < 32) continue;
    const ref = media(d, W, H, p, 5, (q) => !longe[q] && d[q * 4 + 3] >= 250);
    if (!ref) continue;
    const dl = lum(d[i], d[i + 1], d[i + 2]) - lum(ref[0], ref[1], ref[2]);
    const w = d[i + 3] / 255;
    claro += Math.max(0, dl) * w;
    escuro += Math.max(0, -dl) * w;
    peso += w;
    n++;
    if (dl > 40) anel++;
  }
  const r = (v: number) => Math.round(v * 10) / 10;
  return peso ? { claro: r(claro / peso), escuro: r(escuro / peso), anel: Math.round((anel / n) * 1000) / 1000, pontos: n } : { claro: 0, escuro: 0, anel: 0, pontos: 0 };
}

export type Diagnostico = { fundo: FundoDaBorda; halo: Halo | null; precisa: "fundo_solido" | "franja" | "nada" | "fundo_misto" };

/** O que o arquivo precisa: tirar o fundo liso, tirar a franja clara ou nada (fundo com foto fica com a IA). */
export function diagnosticarRecorte(img: PixelsRGBA): Diagnostico {
  const fundo = fundoPelaBorda(img);
  if (fundo.tipo === "solido") return { fundo, halo: null, precisa: "fundo_solido" };
  if (fundo.tipo === "misto") return { fundo, halo: null, precisa: "fundo_misto" };
  const halo = medirHalo(img);
  // Borda clara só é franja quando há anel que passa no critério (fino, em volta e de mistura): a ponta
  // clara da bússola da VIFUT e o anel branco da CME são desenho (revisão de 01/10).
  const franja = halo.claro >= LIMITE_DO_HALO && halo.anel >= 0.15 && aneisDaFranja(img).aneis > 0;
  return { fundo, halo, precisa: franja ? "franja" : "nada" };
}

/** O caminho certo para o arquivo (logo e arte chapada): devolve os pixels limpos ou null quando não há o que fazer. */
export function recorteLimpo(img: PixelsRGBA, furos: "tirar" | "manter" = "tirar"): { data: Uint8ClampedArray; info: InfoDoRecorte; diagnostico: Diagnostico } | null {
  const dg = diagnosticarRecorte(img);
  if (dg.precisa === "fundo_solido" && dg.fundo.cor) return { ...recortarFundoSolido(img, { cor: dg.fundo.cor, tolerancia: toleranciaDoFundo(dg.fundo.ruido), furos }), diagnostico: dg };
  if (dg.precisa === "franja") return { ...tirarFranja(img), diagnostico: dg };
  return null;
}

/** O recorte sobre uma cor (prova visual e testes): RGB opaco. */
export function comporSobre(img: PixelsRGBA, cor: Rgb): Uint8ClampedArray {
  const d = img.data;
  const s = new Uint8ClampedArray(d.length);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    for (let k = 0; k < 3; k++) s[i + k] = byte(d[i + k] * a + cor[k] * (1 - a));
    s[i + 3] = 255;
  }
  return s;
}
