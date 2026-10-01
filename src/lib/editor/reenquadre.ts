import type { PontoDoRosto, RastroDoRosto } from "../../../supabase/functions/_shared/projeto-de-edicao";

/**
 * Reenquadramento pelo rosto (frente EDT, rodada 2). Puro (sem "@/"): a
 * composição usa na prévia e no render.
 *
 * - O rastro guarda o centro do rosto por tempo DA FONTE (0 a 1 do quadro).
 * - Suavizar é conta fixa (média móvel pelo tempo + zona morta): o recorte não
 *   treme com o erro de cada leitura e não anda por movimento pequeno.
 * - O recorte é um "cover": a mídia preenche o quadro de saída; a posição do
 *   recorte (object-position) põe o rosto no meio na horizontal e a um terço
 *   do alto na vertical (regra dos terços), sem sair da imagem.
 */

const limitar = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Janela da média móvel pela suavidade (0: colado; 1: 2,4 s para cada lado). */
export const janelaDaSuavidade = (s: number) => 0.1 + limitar(s, 0, 1) * 2.3;

const CACHE = new WeakMap<RastroDoRosto, Map<number, PontoDoRosto[]>>();

/**
 * Pontos suavizados: média ponderada (triângulo) dos vizinhos dentro da janela,
 * depois zona morta (o centro só anda quando o rosto sai 4% do lugar). Guardado
 * por rastro e suavidade (a conta roda uma vez, não por quadro).
 */
export function pontosSuaves(r: RastroDoRosto, suavidade: number): PontoDoRosto[] {
  const chave = Math.round(limitar(suavidade, 0, 1) * 100);
  let porS = CACHE.get(r);
  if (!porS) {
    porS = new Map();
    CACHE.set(r, porS);
  }
  const ja = porS.get(chave);
  if (ja) return ja;
  const janela = janelaDaSuavidade(chave / 100);
  const p = r.pontos;
  const medios = p.map((a) => {
    let sx = 0;
    let sy = 0;
    let sw = 0;
    let peso = 0;
    for (let k = 0; k < p.length; k++) {
      const d = Math.abs(p[k].t - a.t);
      if (d > janela) continue;
      const w = 1 - d / (janela + 1e-6);
      sx += p[k].x * w;
      sy += p[k].y * w;
      sw += p[k].w * w;
      peso += w;
    }
    return peso > 0 ? { t: a.t, x: sx / peso, y: sy / peso, w: sw / peso } : a;
  });
  const zona = 0.04 * (chave / 100);
  const saida: PontoDoRosto[] = [];
  medios.forEach((m, k) => {
    const ant = k > 0 ? saida[k - 1] : null;
    if (ant && Math.abs(m.x - ant.x) < zona && Math.abs(m.y - ant.y) < zona) saida.push({ ...ant, t: m.t });
    else saida.push({ t: m.t, x: Math.round(m.x * 10000) / 10000, y: Math.round(m.y * 10000) / 10000, w: Math.round(m.w * 10000) / 10000 });
  });
  porS.set(chave, saida);
  return saida;
}

/** Centro do rosto no tempo da fonte (interpolado entre as leituras). Sem rastro: null. */
export function rostoNoTempo(r: RastroDoRosto | null | undefined, t: number, suavidade = 0.6): PontoDoRosto | null {
  if (!r || !r.pontos.length) return null;
  const p = pontosSuaves(r, suavidade);
  if (t <= p[0].t) return p[0];
  const u = p[p.length - 1];
  if (t >= u.t) return u;
  let lo = 0;
  let hi = p.length - 1;
  while (hi - lo > 1) {
    const meio = (lo + hi) >> 1;
    if (p[meio].t <= t) lo = meio;
    else hi = meio;
  }
  const a = p[lo];
  const b = p[hi];
  const f = (t - a.t) / Math.max(1e-6, b.t - a.t);
  return { t, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, w: a.w + (b.w - a.w) * f };
}

export interface Recorte {
  /** object-position em % (x e y). */
  x: number;
  y: number;
  /** Onde o foco caiu na saída (0 a 1): origem do zoom e lugar do rosto para a legenda desviar. */
  focoX: number;
  focoY: number;
}

/**
 * Posição do recorte "cover" para o foco (fx, fy da fonte) cair no meio (x) e
 * a um terço do alto (y) da saída. Sem medida da fonte: o foco vira a posição
 * (acerta nas bordas e no meio; é a melhor conta possível sem saber a proporção).
 */
export function recortePara(fonteL: number | null, fonteA: number | null, saidaL: number, saidaA: number, fx: number, fy: number, alvoY = 0.38): Recorte {
  const x = limitar(fx, 0, 1);
  const y = limitar(fy, 0, 1);
  if (!fonteL || !fonteA || fonteL <= 0 || fonteA <= 0) return { x: x * 100, y: y * 100, focoX: 0.5, focoY: 0.5 };
  const escala = Math.max(saidaL / fonteL, saidaA / fonteA);
  const L = fonteL * escala;
  const A = fonteA * escala;
  const sobraX = L - saidaL;
  const sobraY = A - saidaA;
  const desX = sobraX > 0.5 ? limitar(x * L - saidaL * 0.5, 0, sobraX) : 0;
  const desY = sobraY > 0.5 ? limitar(y * A - saidaA * alvoY, 0, sobraY) : 0;
  return {
    x: sobraX > 0.5 ? (desX / sobraX) * 100 : 50,
    y: sobraY > 0.5 ? (desY / sobraY) * 100 : 50,
    focoX: limitar((x * L - desX) / saidaL, 0, 1),
    focoY: limitar((y * A - desY) / saidaA, 0, 1),
  };
}

/**
 * Suaviza e resume leituras cruas de rosto (quadro a quadro, com falhas):
 * quadro sem rosto herda o vizinho mais perto; leitura que pula mais de 35% da
 * largura em menos de 0,5 s é tratada como erro e cai fora.
 */
export function limparLeituras(leituras: { t: number; x: number | null; y: number | null; w: number | null }[]): PontoDoRosto[] {
  const boas = leituras
    .filter((l) => l.x !== null && l.y !== null && isFinite(Number(l.x)) && isFinite(Number(l.y)))
    .map((l) => ({ t: Math.round(l.t * 1000) / 1000, x: limitar(Number(l.x), 0, 1), y: limitar(Number(l.y), 0, 1), w: limitar(Number(l.w) || 0.2, 0.02, 1) }))
    .sort((a, b) => a.t - b.t);
  const saida: PontoDoRosto[] = [];
  boas.forEach((p, k) => {
    const ant = saida.length ? saida[saida.length - 1] : null;
    const prox = k + 1 < boas.length ? boas[k + 1] : null;
    const pulo = ant && p.t - ant.t < 0.5 && Math.abs(p.x - ant.x) > 0.35;
    const volta = prox && ant && Math.abs(prox.x - ant.x) < 0.1;
    if (pulo && volta) return;
    saida.push(p);
  });
  return saida;
}
