/**
 * Mapa de batidas da trilha (frente MOT, 30/09/2026): o "beat map" do método
 * de motion (plano/p3-referencias.md §2.5). O worker lê o áudio em mono
 * (ffmpeg) e chama `medirBatidas`; a Mesa Motion usa o resultado para casar
 * as trocas de cena com a batida e pôr o drop no momento forte do filme.
 *
 * Método (puro, sem dependência): energia em janelas de ~23 ms, onset =
 * subida da energia (log), andamento pela autocorrelação do onset entre 70 e
 * 180 BPM, fase pela soma dos onsets nas batidas, compasso a cada 4 batidas,
 * drop = a maior subida de energia média (janela de 2 s). Tudo determinístico.
 * Sem Deno, sem npm.
 */

export interface MapaDeBatidas {
  bpm: number;
  /** Tempo de cada batida (s). */
  batidas: number[];
  /** Começo de cada compasso de 4 (s). */
  compassos: number[];
  /** Momento de maior subida de energia (s) ou null. */
  drop_s: number | null;
  duracao_s: number;
  /** Energia por segundo, 0 a 1 (desenho da onda na tela). */
  energia: number[];
  /** Quão clara é a batida (0 a 1): baixa = trilha sem pulso, cortar pela frase. */
  confianca: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function medirBatidas(amostras: Float32Array, taxa: number): MapaDeBatidas {
  const janela = Math.max(256, Math.round(taxa * 0.0232));
  const passo = Math.round(janela / 2);
  const quadros = Math.max(0, Math.floor((amostras.length - janela) / passo));
  const duracao = amostras.length / taxa;
  const energia = new Float64Array(quadros);
  for (let q = 0; q < quadros; q++) {
    let s = 0;
    const ini = q * passo;
    for (let k = 0; k < janela; k++) {
      const v = amostras[ini + k];
      s += v * v;
    }
    energia[q] = Math.log(1e-9 + s / janela);
  }
  // Onset: subida da energia (só o que sobe), menos a média local (tira o nível de fundo).
  const onset = new Float64Array(quadros);
  for (let q = 1; q < quadros; q++) onset[q] = Math.max(0, energia[q] - energia[q - 1]);
  const media = new Float64Array(quadros);
  const raio = 16;
  let acum = 0;
  for (let q = 0; q < quadros; q++) {
    acum += onset[q];
    if (q > 2 * raio) acum -= onset[q - 2 * raio - 1];
    media[Math.max(0, q - raio)] = acum / Math.min(q + 1, 2 * raio + 1);
  }
  for (let q = 0; q < quadros; q++) onset[q] = Math.max(0, onset[q] - media[q]);

  const porSegundo = taxa / passo;
  // Andamento: autocorrelação do onset entre 70 e 180 BPM, com leve preferência a 90-140.
  let melhorLag = Math.round((porSegundo * 60) / 120);
  let melhor = -1;
  let soma = 0;
  const minLag = Math.max(2, Math.floor((porSegundo * 60) / 180));
  const maxLag = Math.ceil((porSegundo * 60) / 70);
  for (let lag = minLag; lag <= maxLag && lag < quadros; lag++) {
    let c = 0;
    for (let q = lag; q < quadros; q++) c += onset[q] * onset[q - lag];
    const bpm = (60 * porSegundo) / lag;
    const peso = bpm >= 90 && bpm <= 140 ? 1.08 : 1;
    const v = c * peso;
    soma += c;
    if (v > melhor) {
      melhor = v;
      melhorLag = lag;
    }
  }
  const media0 = soma / Math.max(1, maxLag - minLag + 1);
  const confianca = melhor > 0 && media0 > 0 ? Math.max(0, Math.min(1, (melhor / media0 - 1) / 3)) : 0;
  // Fase: o deslocamento que mais cai em cima dos onsets.
  let fase = 0;
  let melhorFase = -1;
  for (let f = 0; f < melhorLag; f++) {
    let s = 0;
    for (let q = f; q < quadros; q += melhorLag) s += onset[q];
    if (s > melhorFase) {
      melhorFase = s;
      fase = f;
    }
  }
  const periodo = melhorLag / porSegundo;
  const bpm = Math.round((60 / periodo) * 10) / 10;
  const batidas: number[] = [];
  for (let t = (fase * passo + janela / 2) / taxa; t < duracao - 0.05; t += periodo) batidas.push(r3(t));
  // Compasso: das 4 fases possíveis, a que tem mais energia no começo.
  let fc = 0;
  let melhorC = -1;
  for (let k = 0; k < 4; k++) {
    let s = 0;
    for (let i = k; i < batidas.length; i += 4) {
      const q = Math.min(quadros - 1, Math.max(0, Math.round((batidas[i] * taxa - janela / 2) / passo)));
      s += onset[q];
    }
    if (s > melhorC) {
      melhorC = s;
      fc = k;
    }
  }
  const compassos = batidas.filter((_, i) => i >= fc && (i - fc) % 4 === 0);
  // Energia por segundo (0 a 1) e drop (maior subida entre as médias de 2 s antes e depois).
  const segundos = Math.max(1, Math.ceil(duracao));
  const porSeg: number[] = [];
  for (let s = 0; s < segundos; s++) {
    const a = Math.floor(s * porSegundo);
    const b = Math.min(quadros, Math.floor((s + 1) * porSegundo));
    let m = 0;
    for (let q = a; q < b; q++) m += energia[q];
    porSeg.push(b > a ? m / (b - a) : -20);
  }
  const min = Math.min.apply(null, porSeg);
  const max = Math.max.apply(null, porSeg);
  const energiaNorm = porSeg.map((v) => (max > min ? Math.round(((v - min) / (max - min)) * 1000) / 1000 : 0));
  let drop: number | null = null;
  let maiorSubida = 0.15;
  for (let s = 2; s < segundos - 1; s++) {
    const antes = (energiaNorm[s - 2] + energiaNorm[s - 1]) / 2;
    const depois = (energiaNorm[s] + energiaNorm[Math.min(segundos - 1, s + 1)]) / 2;
    if (depois - antes > maiorSubida) {
      maiorSubida = depois - antes;
      drop = s;
    }
  }
  // O drop cai na batida mais perto.
  if (drop !== null && batidas.length) drop = batidas.reduce((m, b) => (Math.abs(b - (drop as number)) < Math.abs(m - (drop as number)) ? b : m), batidas[0]);
  return { bpm, batidas, compassos, drop_s: drop, duracao_s: r3(duracao), energia: energiaNorm, confianca: r3(confianca) };
}

/** Batida mais perto de t (ou t, sem batidas). */
export function batidaMaisPerto(t: number, batidas: number[]): number {
  if (!batidas.length) return t;
  let m = batidas[0];
  for (let i = 1; i < batidas.length; i++) if (Math.abs(batidas[i] - t) < Math.abs(m - t)) m = batidas[i];
  return m;
}

/** Normaliza o que veio do banco (resultado do pedido `batidas`). */
export function lerMapaDeBatidas(v: unknown): MapaDeBatidas | null {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  if (!o || !Array.isArray(o.batidas)) return null;
  const nums = (x: unknown) => (Array.isArray(x) ? x.map(Number).filter((n) => isFinite(n) && n >= 0) : []);
  const bpm = Number(o.bpm);
  return {
    bpm: isFinite(bpm) && bpm > 0 ? bpm : 0,
    batidas: nums(o.batidas).slice(0, 4000),
    compassos: nums(o.compassos).slice(0, 1000),
    drop_s: o.drop_s === null || o.drop_s === undefined || !isFinite(Number(o.drop_s)) ? null : Number(o.drop_s),
    duracao_s: Number(o.duracao_s) || 0,
    energia: nums(o.energia).slice(0, 3600),
    confianca: Math.max(0, Math.min(1, Number(o.confianca) || 0)),
  };
}
