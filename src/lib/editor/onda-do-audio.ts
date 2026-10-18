/**
 * Onda do áudio e corte de verdade (frente EDT, F2, 30/09/2026).
 *
 * Puro: sem Deno, sem Node, sem banco e sem import. A tela (skills do editor),
 * o worker de render (workers/render, que mede a onda com o ffmpeg) e os
 * testes usam o mesmo código.
 *
 * Regras (especificação medida do EDIT IA PRO, reescrita aqui):
 * - a onda é lida em janelas de 10 ms (RMS em dBFS);
 * - o limiar sai do chão de ruído de CADA fonte (nunca um número fixo);
 * - nenhuma pausa acima de 0,25 s fica no corte; a emenda deixa 0,12 s
 *   (0,07 s depois da fala, para não comer o fim da palavra, e 0,05 s antes);
 * - falso começo e frase repetida: fica a ÚLTIMA tomada inteira;
 * - a conferência do corte é só AVISO (sem laço de correção).
 *
 * Tempos das pausas e das palavras são da FONTE (s), como as transcrições.
 */

export const JANELA_DA_ONDA_S = 0.01;
/** Piso do dB (silêncio digital). */
export const PISO_DB = -100;

export const CORTE_PELA_ONDA = {
  /** Pausa maior que isso sai (fica só a emenda). */
  pausa_max_s: 0.25,
  /** O que sobra na emenda (depois + antes). */
  emenda_s: 0.12,
  /** Parte da emenda que fica depois da fala (protege o fim da palavra). */
  depois_s: 0.07,
  /** Parte da emenda que fica antes da próxima fala. */
  antes_s: 0.05,
} as const;

export interface TrechoDeTempo {
  de_s: number;
  ate_s: number;
}

export interface OndaMedida {
  janela_s: number;
  duracao_s: number;
  chao_db: number;
  limiar_db: number;
  /** Silêncios (abaixo do limiar) com pelo menos `pausa_min_s`. Tempo da fonte. */
  pausas: TrechoDeTempo[];
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** RMS em dBFS por janela (amostras de -1 a 1). */
export function rmsEmDb(amostras: ArrayLike<number>, taxa: number, janelaS = JANELA_DA_ONDA_S): number[] {
  const n = Math.max(1, Math.round(taxa * janelaS));
  const saida: number[] = [];
  for (let ini = 0; ini < amostras.length; ini += n) {
    const fim = Math.min(amostras.length, ini + n);
    let soma = 0;
    for (let k = ini; k < fim; k++) soma += amostras[k] * amostras[k];
    const rms = Math.sqrt(soma / Math.max(1, fim - ini));
    saida.push(rms > 0 ? Math.max(PISO_DB, 20 * Math.log10(rms)) : PISO_DB);
  }
  return saida;
}

function percentil(valores: number[], p: number): number {
  if (!valores.length) return PISO_DB;
  const o = valores.slice().sort((a, b) => a - b);
  const k = Math.min(o.length - 1, Math.max(0, Math.floor((p / 100) * (o.length - 1))));
  return o[k];
}

/**
 * Limiar da fala pelo chão de ruído da fonte: chão = percentil 10; voz =
 * percentil 90; limiar = chão + 35% do caminho até a voz, pelo menos 8 dB acima
 * do chão e pelo menos 6 dB abaixo da voz.
 */
export function limiarDaFonte(db: number[]): { chao_db: number; limiar_db: number; voz_db: number } {
  const chao = percentil(db, 10);
  const voz = percentil(db, 90);
  let limiar = chao + Math.max(8, (voz - chao) * 0.35);
  if (limiar > voz - 6) limiar = Math.max(chao + 3, voz - 6);
  return { chao_db: r1(chao), limiar_db: r1(limiar), voz_db: r1(voz) };
}

/**
 * Silêncios da onda: janelas abaixo do limiar em sequência. Estalo curto
 * (fala com menos de `estalo_s`) no meio de um silêncio não quebra a pausa.
 */
export function pausasDaOnda(db: number[], janelaS: number, limiarDb: number, o: { pausa_min_s?: number; estalo_s?: number } = {}): TrechoDeTempo[] {
  const minimo = o.pausa_min_s !== undefined ? o.pausa_min_s : 0.1;
  const estalo = Math.max(1, Math.round((o.estalo_s !== undefined ? o.estalo_s : 0.03) / janelaS));
  const fala = db.map((v) => v >= limiarDb);
  // Fala mais curta que o estalo vira silêncio.
  let k = 0;
  while (k < fala.length) {
    if (!fala[k]) {
      k++;
      continue;
    }
    let j = k;
    while (j < fala.length && fala[j]) j++;
    if (j - k < estalo) for (let x = k; x < j; x++) fala[x] = false;
    k = j;
  }
  const saida: TrechoDeTempo[] = [];
  k = 0;
  while (k < fala.length) {
    if (fala[k]) {
      k++;
      continue;
    }
    let j = k;
    while (j < fala.length && !fala[j]) j++;
    const de = k * janelaS;
    const ate = j * janelaS;
    if (ate - de >= minimo - 1e-9) saida.push({ de_s: r3(de), ate_s: r3(ate) });
    k = j;
  }
  return saida;
}

/** Mede a onda de uma fonte inteira (o worker chama com o áudio mono decodificado). */
export function medirOnda(amostras: ArrayLike<number>, taxa: number, o: { pausa_min_s?: number } = {}): OndaMedida {
  const db = rmsEmDb(amostras, taxa, JANELA_DA_ONDA_S);
  const l = limiarDaFonte(db);
  return {
    janela_s: JANELA_DA_ONDA_S,
    duracao_s: r3(amostras.length / taxa),
    chao_db: l.chao_db,
    limiar_db: l.limiar_db,
    pausas: pausasDaOnda(db, JANELA_DA_ONDA_S, l.limiar_db, { pausa_min_s: o.pausa_min_s !== undefined ? o.pausa_min_s : 0.1 }),
  };
}

// ------------------------------------------------------------------ corte pela onda

/**
 * Trechos da FONTE que saem de um clipe (entrada..saida): toda pausa acima de
 * `pausa_max_s` vira emenda de `emenda_s`. Começo e fim mudos do clipe ficam
 * com a parte da emenda do lado da fala. Nenhuma palavra sai (só silêncio medido).
 */
export function cortesDaOnda(
  clipe: { entrada_s: number; saida_s: number },
  pausas: TrechoDeTempo[],
  cfg: { pausa_max_s?: number; depois_s?: number; antes_s?: number } = {},
): TrechoDeTempo[] {
  const max = cfg.pausa_max_s !== undefined ? cfg.pausa_max_s : CORTE_PELA_ONDA.pausa_max_s;
  const depois = cfg.depois_s !== undefined ? cfg.depois_s : CORTE_PELA_ONDA.depois_s;
  const antes = cfg.antes_s !== undefined ? cfg.antes_s : CORTE_PELA_ONDA.antes_s;
  const saida: TrechoDeTempo[] = [];
  pausas.forEach((p) => {
    const de = Math.max(p.de_s, clipe.entrada_s);
    const ate = Math.min(p.ate_s, clipe.saida_s);
    if (ate - de <= max + 1e-6) return;
    const noComeco = de <= clipe.entrada_s + 1e-6;
    const noFim = ate >= clipe.saida_s - 1e-6;
    if (noComeco && noFim) return; // clipe inteiro mudo: não é pausa de fala, fica.
    const a = noComeco ? de : de + depois;
    const b = noFim ? ate : ate - antes;
    if (b - a > 0.02) saida.push({ de_s: r3(a), ate_s: r3(b) });
  });
  return saida.sort((x, y) => x.de_s - y.de_s);
}

// ------------------------------------------------------------------ palavra no tempo da onda

export interface PalavraDaFonte {
  t: string;
  i: number;
  f: number;
}

/**
 * O transcritor adianta o começo da palavra (até ~0,3 s). Palavra que começa
 * dentro de um silêncio medido passa a começar quando a voz volta; palavra que
 * termina dentro de um silêncio termina quando a voz parou.
 */
export function palavrasNaOnda(palavras: PalavraDaFonte[], pausas: TrechoDeTempo[]): PalavraDaFonte[] {
  return palavras.map((w) => {
    let i = w.i;
    let f = w.f;
    for (const p of pausas) {
      if (p.de_s <= i && i < p.ate_s && p.ate_s < f) i = p.ate_s;
      if (p.de_s < f && f <= p.ate_s && p.de_s > i) f = p.de_s;
    }
    return { t: w.t, i: r3(i), f: r3(Math.max(f, i + 0.01)) };
  });
}

// ------------------------------------------------------------------ melhor tomada

const normal = (t: string) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

export interface FraseDaFala {
  palavras: PalavraDaFonte[];
  i: number;
  f: number;
  texto: string;
}

/** Frases pela pausa (>= `pausa_s`) ou pela pontuação final. */
export function frasesDaFala(palavras: PalavraDaFonte[], pausaS = 0.45): FraseDaFala[] {
  const frases: FraseDaFala[] = [];
  let atual: PalavraDaFonte[] = [];
  const fechar = () => {
    if (!atual.length) return;
    frases.push({ palavras: atual, i: atual[0].i, f: atual[atual.length - 1].f, texto: atual.map((w) => w.t).join(" ") });
    atual = [];
  };
  palavras.forEach((w, k) => {
    const ant = k > 0 ? palavras[k - 1] : null;
    if (ant && (w.i - ant.f >= pausaS || /[.!?…]$/.test(ant.t))) fechar();
    atual.push(w);
  });
  fechar();
  return frases;
}

export interface TomadaQueSai extends TrechoDeTempo {
  texto: string;
  motivo: "falso_comeco" | "repeticao" | "gagueira";
  /** A tomada que ficou (a última inteira). */
  ficou: string;
}

function semelhanca(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let comum = 0;
  sa.forEach((x) => sb.has(x) && comum++);
  return comum / Math.max(sa.size, sb.size);
}

function prefixoComum(a: string[], b: string[]): number {
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  return k;
}

/**
 * Tomadas que saem, deixando sempre a ÚLTIMA inteira:
 * - falso começo: a frase começa igual à seguinte (2 palavras ou mais) e não
 *   é mais longa que ela ("eu queria... eu queria falar de");
 * - repetição: a frase seguinte diz quase o mesmo (semelhança >= 0,6);
 * - gagueira: a mesma palavra duas vezes seguidas dentro da frase ("o o").
 * O trecho que sai vai do começo da tomada até logo antes da próxima.
 */
export function tomadasQueSaem(palavras: PalavraDaFonte[], o: { pausa_s?: number; antes_s?: number } = {}): TomadaQueSai[] {
  const antes = o.antes_s !== undefined ? o.antes_s : CORTE_PELA_ONDA.antes_s;
  const frases = frasesDaFala(palavras, o.pausa_s !== undefined ? o.pausa_s : 0.45);
  const saida: TomadaQueSai[] = [];
  for (let k = 0; k < frases.length - 1; k++) {
    const a = frases[k].palavras.map((w) => normal(w.t)).filter(Boolean);
    // Olha a próxima e a depois dela (tomada no meio de um "não, peraí").
    for (let j = k + 1; j <= Math.min(frases.length - 1, k + 2); j++) {
      const b = frases[j].palavras.map((w) => normal(w.t)).filter(Boolean);
      const pref = prefixoComum(a, b);
      const falso = pref >= 2 && a.length <= b.length;
      const rep = !falso && a.length >= 3 && semelhanca(a, b) >= 0.6 && a.length <= b.length + 1;
      if (falso || rep) {
        saida.push({ de_s: r3(frases[k].i), ate_s: r3(Math.max(frases[k].f, frases[j].i - antes)), texto: frases[k].texto, motivo: falso ? "falso_comeco" : "repeticao", ficou: frases[j].texto });
        break;
      }
    }
  }
  // Gagueira dentro da frase: tira a primeira da dupla.
  palavras.forEach((w, k) => {
    const prox = palavras[k + 1];
    if (!prox || normal(w.t) === "" || normal(w.t) !== normal(prox.t) || prox.i - w.f > 0.4) return;
    if (saida.some((s) => w.i >= s.de_s - 1e-6 && w.f <= s.ate_s + 1e-6)) return;
    saida.push({ de_s: r3(w.i), ate_s: r3(Math.max(w.f, prox.i - 0.01)), texto: w.t, motivo: "gagueira", ficou: prox.t });
  });
  return saida.sort((x, y) => x.de_s - y.de_s);
}

// ------------------------------------------------------------------ conferência (só aviso)

export interface ClipeParaConferir {
  id: string;
  fonte: string | null;
  inicio_s: number;
  entrada_s: number;
  saida_s: number;
  velocidade: number;
}

export interface ConferenciaDoCorte {
  /** Respiros que sobraram acima do máximo (tempo da linha). */
  respiros: { em_s: number; duracao_s: number }[];
  /** Emenda no meio de uma palavra. */
  mordidas: { em_s: number; palavra: string }[];
  /** Palavra repetida seguida na fala que ficou. */
  repeticoes: { em_s: number; palavra: string }[];
  /** Clipe curto demais (< 0,2 s): pisca na tela. */
  curtos: { em_s: number; duracao_s: number }[];
  /** Fontes sem onda medida (a conferência de respiro não vale para elas). */
  sem_onda: string[];
  ok: boolean;
  resumo: string;
}

/**
 * Confere o corte da trilha principal. Não muda nada: vira aviso no cartão.
 * `ondas` e `falas` são por fonte (tempo da fonte).
 */
export function conferirCorte(
  clipes: ClipeParaConferir[],
  ondas: Record<string, { pausas: TrechoDeTempo[] } | undefined>,
  falas: Record<string, PalavraDaFonte[] | undefined>,
  cfg: { pausa_max_s?: number } = {},
): ConferenciaDoCorte {
  const max = cfg.pausa_max_s !== undefined ? cfg.pausa_max_s : CORTE_PELA_ONDA.pausa_max_s;
  const ordem = clipes.slice().sort((a, b) => a.inicio_s - b.inicio_s);
  const semOnda: string[] = [];
  const silencios: TrechoDeTempo[] = [];
  const mordidas: ConferenciaDoCorte["mordidas"] = [];
  const repeticoes: ConferenciaDoCorte["repeticoes"] = [];
  const curtos: ConferenciaDoCorte["curtos"] = [];
  let ultima: { t: string; f: number } | null = null;
  ordem.forEach((c) => {
    const v = c.velocidade > 0 ? c.velocidade : 1;
    const dur = (c.saida_s - c.entrada_s) / v;
    if (dur < 0.2) curtos.push({ em_s: r3(c.inicio_s), duracao_s: r3(dur) });
    if (!c.fonte) return;
    const onda = ondas[c.fonte];
    if (!onda) {
      if (semOnda.indexOf(c.fonte) < 0) semOnda.push(c.fonte);
    } else {
      onda.pausas.forEach((p) => {
        const de = Math.max(p.de_s, c.entrada_s);
        const ate = Math.min(p.ate_s, c.saida_s);
        if (ate - de > 0.005) silencios.push({ de_s: c.inicio_s + (de - c.entrada_s) / v, ate_s: c.inicio_s + (ate - c.entrada_s) / v });
      });
    }
    (falas[c.fonte] || []).forEach((w) => {
      [c.entrada_s, c.saida_s].forEach((borda) => {
        if (w.i + 0.02 < borda && borda < w.f - 0.02) mordidas.push({ em_s: r3(c.inicio_s + (borda - c.entrada_s) / v), palavra: w.t });
      });
      const meio = (w.i + w.f) / 2;
      if (meio < c.entrada_s || meio >= c.saida_s) return;
      const naLinha = c.inicio_s + (w.i - c.entrada_s) / v;
      if (ultima && normal(ultima.t) && normal(ultima.t) === normal(w.t) && naLinha - ultima.f < 0.6) repeticoes.push({ em_s: r3(naLinha), palavra: w.t });
      ultima = { t: w.t, f: c.inicio_s + (w.f - c.entrada_s) / v };
    });
  });
  // Silêncio que atravessa a emenda soma dos dois lados.
  silencios.sort((a, b) => a.de_s - b.de_s);
  const juntos: TrechoDeTempo[] = [];
  silencios.forEach((s) => {
    const u = juntos[juntos.length - 1];
    if (u && s.de_s <= u.ate_s + 0.002) u.ate_s = Math.max(u.ate_s, s.ate_s);
    else juntos.push({ ...s });
  });
  const inicio = ordem.length ? ordem[0].inicio_s : 0;
  const fim = ordem.reduce((m, c) => Math.max(m, c.inicio_s + (c.saida_s - c.entrada_s) / (c.velocidade > 0 ? c.velocidade : 1)), 0);
  const respiros = juntos
    // Silêncio no começo e no fim do vídeo não é respiro entre falas.
    .filter((s) => s.de_s > inicio + 0.001 && s.ate_s < fim - 0.001 && s.ate_s - s.de_s > max + 0.005)
    .map((s) => ({ em_s: r3(s.de_s), duracao_s: r3(s.ate_s - s.de_s) }));
  const partes: string[] = [];
  partes.push(`${respiros.length} ${respiros.length === 1 ? "respiro acima" : "respiros acima"} de ${String(max).replace(".", ",")} s`);
  partes.push(`${mordidas.length} ${mordidas.length === 1 ? "palavra mordida" : "palavras mordidas"}`);
  if (repeticoes.length) partes.push(`${repeticoes.length} ${repeticoes.length === 1 ? "repetição" : "repetições"}`);
  if (curtos.length) partes.push(`${curtos.length} ${curtos.length === 1 ? "clipe curto" : "clipes curtos"}`);
  if (semOnda.length) partes.push(`${semOnda.length} ${semOnda.length === 1 ? "fonte sem onda medida" : "fontes sem onda medida"}`);
  const ok = !respiros.length && !mordidas.length && !repeticoes.length && !curtos.length;
  return { respiros, mordidas, repeticoes, curtos, sem_onda: semOnda, ok, resumo: `Conferência: ${partes.join(", ")}.` };
}
