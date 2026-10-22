/**
 * Linha do tempo da campanha (22/10/2026, dono: "ter uma lógica de início de campanha e final de campanha,
 * início, meio e fim, e já com as datas certas; se vai começar 10 dias antes, então seguir a lógica das datas;
 * senão ele já gera algo sem introdução e sem preparar o público").
 *
 * As datas saem daqui, em código (o modelo só escreve o conteúdo de cada fase):
 * - entrada: a data do evento (o dia do hype ou o fim da oferta), quantos dias antes começa e o fim;
 * - saída: as cinco fases (aquecimento, lançamento, sustentação, urgência, encerramento) com as janelas certas,
 *   pelas proporções e nomes do esquema do tipo (Black, Natal, Halloween, promoção...);
 * - as vagas das peças pelos dias, respeitando os posts por dia do cliente e o calendário: a primeira peça é
 *   sempre de introdução e a última de encerramento; começou tarde, as fases se comprimem sem pular a introdução.
 *
 * Puro (a tela e as funções importam o mesmo): sem import de rede, sem lookbehind, sem classe Unicode e sem
 * grupo nomeado (Safari 11). Sem travessão.
 */

export type FaseDaLinha = "aquecimento" | "lancamento" | "sustentacao" | "urgencia" | "encerramento";

export const ORDEM_DAS_FASES: FaseDaLinha[] = ["aquecimento", "lancamento", "sustentacao", "urgencia", "encerramento"];

/** O texto da etapa gravado na peça (o mesmo que a série usa). */
export const ETAPA_DA_FASE: Record<FaseDaLinha, string> = {
  aquecimento: "aquecimento",
  lancamento: "lançamento",
  sustentacao: "sustentação",
  urgencia: "urgência",
  encerramento: "encerramento",
};

export const ROTULO_DA_FASE_DA_LINHA: Record<FaseDaLinha, string> = {
  aquecimento: "Aquecimento",
  lancamento: "Lançamento",
  sustentacao: "Sustentação",
  urgencia: "Urgência",
  encerramento: "Encerramento",
};

/** O que cada fase faz (vai ao modelo junto com a vaga). */
export const PAPEL_DA_FASE: Record<FaseDaLinha, string> = {
  aquecimento: "introdução e preparação do público: o tema, a curiosidade, a lista de espera ou o 'vem aí' (nunca a oferta de cara)",
  lancamento: "a oferta revelada, clara: o que, quanto, até quando e como garantir",
  sustentacao: "o meio: prova, objeções respondidas e os produtos da campanha",
  urgencia: "prazo e escassez reais",
  encerramento: "última chamada e agradecimento",
};

export interface ConfigDaLinha {
  /** Dias antes do evento em que a campanha começa (padrão do tipo). */
  diasAntes: number;
  /** Dias depois do evento em que a campanha termina (Black Week e Cyber Monday vão depois). */
  diasDepois: number;
  /** Dias antes do evento abaixo dos quais a campanha está comprimida (aviso). */
  minimoAntes: number;
  /** A fase que começa no dia do evento (as de antes ficam na janela antes do evento). */
  ancora: FaseDaLinha;
  pesos: Record<FaseDaLinha, number>;
  /** O nome da fase neste tipo de campanha (ex.: Pré-Black). */
  nomes: Partial<Record<FaseDaLinha, string>>;
}

const PADRAO: ConfigDaLinha = {
  diasAntes: 7,
  diasDepois: 0,
  minimoAntes: 5,
  ancora: "encerramento",
  pesos: { aquecimento: 2, lancamento: 1, sustentacao: 2, urgencia: 2, encerramento: 1 },
  nomes: {},
};

/** A linha de cada esquema (o id é o de esquemas-de-campanha.ts). */
export const LINHA_POR_ESQUEMA: Record<string, ConfigDaLinha> = {
  halloween: {
    diasAntes: 10, diasDepois: 0, minimoAntes: 7, ancora: "encerramento",
    pesos: { aquecimento: 3, lancamento: 1, sustentacao: 4, urgencia: 2, encerramento: 1 },
    nomes: { aquecimento: "O monstro aparece", lancamento: "A poção", sustentacao: "Prova e produtos", urgencia: "Antes da meia-noite", encerramento: "Última chamada do dia 31" },
  },
  black_friday: {
    diasAntes: 14, diasDepois: 4, minimoAntes: 7, ancora: "lancamento",
    pesos: { aquecimento: 1, lancamento: 1, sustentacao: 2, urgencia: 1, encerramento: 1 },
    nomes: { aquecimento: "Pré-Black e contagem regressiva", lancamento: "Black Friday", sustentacao: "Black Weekend", urgencia: "Cyber Monday", encerramento: "Última chamada" },
  },
  natal: {
    diasAntes: 21, diasDepois: 0, minimoAntes: 10, ancora: "encerramento",
    pesos: { aquecimento: 3, lancamento: 2, sustentacao: 3, urgencia: 2, encerramento: 1 },
    nomes: { aquecimento: "Guia de presentes", lancamento: "Oferta de Natal", sustentacao: "Presente por perfil", urgencia: "Último dia de entrega", encerramento: "Véspera" },
  },
  maes_pais_criancas: {
    diasAntes: 14, diasDepois: 0, minimoAntes: 7, ancora: "encerramento",
    pesos: { aquecimento: 3, lancamento: 2, sustentacao: 3, urgencia: 2, encerramento: 1 },
    nomes: { aquecimento: "Ideias de presente", lancamento: "Oferta da data", urgencia: "Último dia de entrega", encerramento: "Véspera" },
  },
  aniversario_da_empresa: {
    diasAntes: 10, diasDepois: 0, minimoAntes: 5, ancora: "encerramento",
    pesos: { aquecimento: 2, lancamento: 1, sustentacao: 3, urgencia: 2, encerramento: 1 },
    nomes: { aquecimento: "Vem festa aí", lancamento: "Oferta de aniversário", encerramento: "Última chamada e obrigado" },
  },
  promocional: { ...PADRAO, nomes: { aquecimento: "Aviso da oferta", lancamento: "Oferta aberta", urgencia: "Acabando", encerramento: "Último dia" } },
  lancamento: {
    diasAntes: 10, diasDepois: 7, minimoAntes: 5, ancora: "lancamento",
    pesos: { aquecimento: 1, lancamento: 1, sustentacao: 3, urgencia: 2, encerramento: 1 },
    nomes: { aquecimento: "Teaser", lancamento: "Revelação", sustentacao: "Condição de lançamento", urgencia: "A condição acaba", encerramento: "Última chamada" },
  },
  data_comemorativa: { ...PADRAO, nomes: { aquecimento: "Aviso da data", lancamento: "Oferta da data", encerramento: "Última chamada" } },
  institucional: {
    diasAntes: 14, diasDepois: 0, minimoAntes: 7, ancora: "encerramento",
    pesos: { aquecimento: 3, lancamento: 2, sustentacao: 4, urgencia: 1, encerramento: 1 },
    nomes: { aquecimento: "Manifesto", lancamento: "Prova", sustentacao: "Bastidor e clientes", urgencia: "Convite", encerramento: "Convite final" },
  },
};

export const configDaLinha = (esquema: string | null | undefined): ConfigDaLinha => LINHA_POR_ESQUEMA[String(esquema || "")] || PADRAO;

export interface FaseNaLinha {
  fase: FaseDaLinha;
  etapa: string;
  nome: string;
  papel: string;
  inicio: string;
  fim: string;
  dias: number;
}

export interface LinhaDoTempo {
  esquema: string;
  evento: string;
  dias_antes: number;
  inicio: string;
  fim: string;
  fases: FaseNaLinha[];
  comprimida: boolean;
  avisos: string[];
  calculada_em: string;
}

const DIA_MS = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const somarDiasDaLinha = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
export const diasEntreDaLinha = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DIA_MS);
export const diaUtilDaLinha = (d: string) => {
  const s = new Date(`${d}T12:00:00Z`).getUTCDay();
  return s !== 0 && s !== 6;
};
const curta = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/**
 * Reparte n dias entre as fases pelos pesos (maior resto) e garante ao menos 1 dia para as fases na ordem de
 * prioridade enquanto houver de onde tirar (tira da fase com mais dias; empate, a de menor prioridade).
 */
export function repartirDias(n: number, fases: FaseDaLinha[], pesos: Record<FaseDaLinha, number>, prioridade: FaseDaLinha[]): Record<FaseDaLinha, number> {
  const saida = { aquecimento: 0, lancamento: 0, sustentacao: 0, urgencia: 0, encerramento: 0 } as Record<FaseDaLinha, number>;
  if (n <= 0 || !fases.length) return saida;
  const soma = fases.reduce((s, f) => s + Math.max(0, pesos[f]), 0) || fases.length;
  const ideais = fases.map((f) => ({ f, v: (n * (soma ? Math.max(0, pesos[f]) : 1)) / soma }));
  ideais.forEach((x) => { saida[x.f] = Math.floor(x.v); });
  let resto = n - fases.reduce((s, f) => s + saida[f], 0);
  ideais.slice().sort((a, b) => (b.v - Math.floor(b.v)) - (a.v - Math.floor(a.v)) || prioridade.indexOf(a.f) - prioridade.indexOf(b.f)).forEach((x) => {
    if (resto > 0) { saida[x.f]++; resto--; }
  });
  const ordem = prioridade.filter((f) => fases.indexOf(f) >= 0);
  ordem.forEach((f, k) => {
    if (saida[f] > 0) return;
    const doadoras = ordem.slice(k + 1).filter((g) => saida[g] > 0);
    const comFolga = fases.filter((g) => g !== f && saida[g] > 1);
    let de: FaseDaLinha | null = null;
    if (comFolga.length) de = comFolga.sort((a, b) => saida[b] - saida[a] || prioridade.indexOf(b) - prioridade.indexOf(a))[0];
    else if (doadoras.length) de = doadoras[doadoras.length - 1];
    if (de) { saida[de]--; saida[f]++; }
  });
  return saida;
}

/** A prioridade quando falta dia: a introdução nunca some; depois a oferta, o fim, a urgência e o meio. */
const PRIORIDADE: FaseDaLinha[] = ["aquecimento", "lancamento", "encerramento", "urgencia", "sustentacao"];

export interface PedidoDaLinha {
  esquema: string;
  /** O dia do evento (o hype, a data comemorativa ou o fim da oferta). */
  evento: string;
  /** Começa N dias antes do evento (sem: o padrão do tipo; com inicio, vale o inicio). */
  diasAntes?: number | null;
  inicio?: string | null;
  fim?: string | null;
  hoje: string;
}

/** As fases com as janelas de datas certas. */
export function calcularLinhaDoTempo(p: PedidoDaLinha): LinhaDoTempo {
  const cfg = configDaLinha(p.esquema);
  const avisos: string[] = [];
  const evento = ISO.test(p.evento) ? p.evento : p.hoje;
  const antes = Number.isFinite(Number(p.diasAntes)) && Number(p.diasAntes) >= 0 ? Math.min(60, Math.round(Number(p.diasAntes))) : null;
  let inicio = p.inicio && ISO.test(p.inicio) && antes === null ? p.inicio : somarDiasDaLinha(evento, -(antes === null ? cfg.diasAntes : antes));
  let fim = p.fim && ISO.test(p.fim) ? p.fim : somarDiasDaLinha(evento, cfg.diasDepois);
  if (fim < evento) fim = evento;
  if (inicio > evento) inicio = evento;
  const ideal = inicio;
  let comprimida = false;
  if (inicio < p.hoje) {
    inicio = p.hoje > fim ? fim : p.hoje;
    comprimida = true;
    avisos.push(`A janela ideal começava em ${curta(ideal)}; a campanha começa ${inicio === p.hoje ? "hoje" : `em ${curta(inicio)}`} (${curta(inicio)}) com a introdução comprimida.`);
  }
  const diasAntesDoEvento = Math.max(0, diasEntreDaLinha(inicio, evento));
  if (!comprimida && diasAntesDoEvento < cfg.minimoAntes && ORDEM_DAS_FASES.indexOf(cfg.ancora) > 0) {
    comprimida = true;
    avisos.push(`Começa só ${diasAntesDoEvento} dia(s) antes do evento (o ideal são ${cfg.diasAntes}): as fases foram comprimidas, sem pular a introdução.`);
  }
  const ancora = ORDEM_DAS_FASES.indexOf(cfg.ancora);
  const contagem = { aquecimento: 0, lancamento: 0, sustentacao: 0, urgencia: 0, encerramento: 0 } as Record<FaseDaLinha, number>;
  const preDias = diasEntreDaLinha(inicio, evento);
  const posDias = diasEntreDaLinha(evento, fim) + 1;
  if (preDias <= 0 || ancora === 0) {
    // Começa no dia do evento (ou depois): todas as fases dentro da janela que sobrou, introdução primeiro.
    const total = diasEntreDaLinha(inicio, fim) + 1;
    Object.assign(contagem, repartirDias(total, ORDEM_DAS_FASES, cfg.pesos, PRIORIDADE));
  } else {
    const antesDoEvento = ORDEM_DAS_FASES.slice(0, ancora);
    const depoisDoEvento = ORDEM_DAS_FASES.slice(ancora);
    const a = repartirDias(preDias, antesDoEvento, cfg.pesos, PRIORIDADE);
    const d = repartirDias(posDias, depoisDoEvento, cfg.pesos, PRIORIDADE);
    ORDEM_DAS_FASES.forEach((f) => { contagem[f] = a[f] + d[f]; });
  }
  const fases: FaseNaLinha[] = [];
  let dia = inicio;
  ORDEM_DAS_FASES.forEach((f) => {
    const n = contagem[f];
    if (n <= 0) return;
    const fimDaFase = somarDiasDaLinha(dia, n - 1);
    fases.push({ fase: f, etapa: ETAPA_DA_FASE[f], nome: cfg.nomes[f] || ROTULO_DA_FASE_DA_LINHA[f], papel: PAPEL_DA_FASE[f], inicio: dia, fim: fimDaFase, dias: n });
    dia = somarDiasDaLinha(fimDaFase, 1);
  });
  ajustarAosDiasUteis(fases, avisos);
  return { esquema: String(p.esquema || "promocional"), evento, dias_antes: Math.max(0, diasEntreDaLinha(ideal, evento)), inicio, fim, fases, comprimida, avisos, calculada_em: p.hoje };
}

const temDiaUtil = (de: string, ate: string) => {
  for (let d = de; d <= ate; d = somarDiasDaLinha(d, 1)) if (diaUtilDaLinha(d)) return true;
  return false;
};

/**
 * 23/10/2026 (Stop: a peça de lançamento empurrada do domingo foi parar noutra fase): o painel publica de
 * segunda a sexta, então toda fase precisa de um dia útil. A fase que só tem fim de semana pega o dia útil
 * vizinho (o encerramento olha para trás; as outras, para a frente), sem tirar o último dia útil da vizinha.
 * Assim a data de cada peça sempre cai na janela da fase dela.
 */
export function ajustarAosDiasUteis(fases: FaseNaLinha[], avisos: string[] = []): FaseNaLinha[] {
  for (let k = 0; k < fases.length; k++) {
    const f = fases[k];
    if (temDiaUtil(f.inicio, f.fim)) continue;
    const proxima = fases[k + 1];
    const anterior = fases[k - 1];
    let feito = false;
    if (proxima && k < fases.length - 1) {
      // Para a frente: até o primeiro dia útil da próxima, se ela continuar com um dia útil.
      let d = proxima.inicio;
      while (d <= proxima.fim && !diaUtilDaLinha(d)) d = somarDiasDaLinha(d, 1);
      if (d <= proxima.fim && d < proxima.fim && temDiaUtil(somarDiasDaLinha(d, 1), proxima.fim)) {
        avisos.push(`${f.nome} caía só no fim de semana (${curta(f.inicio)}${f.fim !== f.inicio ? ` a ${curta(f.fim)}` : ""}): vai até ${curta(d)}, o primeiro dia útil.`);
        f.fim = d;
        proxima.inicio = somarDiasDaLinha(d, 1);
        feito = true;
      }
    }
    if (!feito && anterior) {
      // Para trás: desde o último dia útil da anterior, se ela continuar com um dia útil.
      let d = anterior.fim;
      while (d >= anterior.inicio && !diaUtilDaLinha(d)) d = somarDiasDaLinha(d, -1);
      if (d >= anterior.inicio && d > anterior.inicio && temDiaUtil(anterior.inicio, somarDiasDaLinha(d, -1))) {
        avisos.push(`${f.nome} caía só no fim de semana (${curta(f.inicio)}${f.fim !== f.inicio ? ` a ${curta(f.fim)}` : ""}): começa em ${curta(d)}, o último dia útil antes.`);
        f.inicio = d;
        anterior.fim = somarDiasDaLinha(d, -1);
      }
    }
  }
  fases.forEach((f) => { f.dias = diasEntreDaLinha(f.inicio, f.fim) + 1; });
  return fases;
}

/**
 * Parece oferta (preço, desconto, condição ou chamada de compra)? Uma peça assim nunca conta como introdução,
 * mesmo escrita como "aquecimento". Rede de segurança quando o Jev não responde.
 */
export function pareceOferta(texto: unknown): boolean {
  const t = String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return /r\$\s*\d|\d+\s*%|\boferta\b|desconto|promoc|\bpor apenas\b|\bgaranta\b|\bcupom\b|\bcompre\b|\bcondicao especial\b|preco/.test(t);
}

/** A fase de uma data (fora da janela: null). */
export function faseNaData(linha: Pick<LinhaDoTempo, "fases">, data: string): FaseNaLinha | null {
  return linha.fases.filter((f) => data >= f.inicio && data <= f.fim)[0] || null;
}

/** A linha gravada (briefing.linha_do_tempo) em forma fixa, ou null. */
export function normalizarLinhaDoTempo(v: unknown): LinhaDoTempo | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const fases = (Array.isArray(o.fases) ? o.fases : [])
    .map((x) => {
      const f = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      const fase = ORDEM_DAS_FASES.indexOf(f.fase as FaseDaLinha) >= 0 ? (f.fase as FaseDaLinha) : null;
      if (!fase || !ISO.test(String(f.inicio)) || !ISO.test(String(f.fim))) return null;
      return { fase, etapa: ETAPA_DA_FASE[fase], nome: String(f.nome || ROTULO_DA_FASE_DA_LINHA[fase]).slice(0, 80), papel: PAPEL_DA_FASE[fase], inicio: String(f.inicio), fim: String(f.fim), dias: diasEntreDaLinha(String(f.inicio), String(f.fim)) + 1 };
    })
    .filter((f): f is FaseNaLinha => !!f);
  if (!fases.length || !ISO.test(String(o.evento))) return null;
  return {
    esquema: String(o.esquema || "promocional"),
    evento: String(o.evento),
    dias_antes: Number(o.dias_antes) || 0,
    inicio: fases[0].inicio,
    fim: fases[fases.length - 1].fim,
    fases,
    comprimida: o.comprimida === true,
    avisos: (Array.isArray(o.avisos) ? o.avisos : []).map(String).slice(0, 6),
    calculada_em: String(o.calculada_em || ""),
  };
}

export interface VagaDaPeca {
  data: string;
  fase: FaseDaLinha;
  etapa: string;
  nome: string;
  papel: string;
}

/**
 * As vagas de n peças na linha: a primeira é de introdução, a última de encerramento e o resto se espalha
 * pelas fases (pelos pesos), só de segunda a sexta e no limite de posts por dia do cliente (contando o que o
 * calendário já tem). Fase sem dia útil (o evento no sábado) usa o dia útil mais perto dentro da janela.
 */
export function vagasDasPecas(
  linha: LinhaDoTempo,
  n: number,
  opcoes: { porDia?: number; ocupacao?: Record<string, number>; pesos?: Record<FaseDaLinha, number>; introducoes?: number } = {},
): { vagas: VagaDaPeca[]; avisos: string[] } {
  const avisos: string[] = [];
  if (n <= 0 || !linha.fases.length) return { vagas: [], avisos };
  const porDia = Math.max(1, Math.round(opcoes.porDia || 1));
  const usados: Record<string, number> = { ...(opcoes.ocupacao || {}) };
  const pesos = opcoes.pesos || configDaLinha(linha.esquema).pesos;
  const fases = linha.fases;
  // Quantas peças por fase: 1 na primeira e 1 na última; o resto pelos pesos.
  const conta: number[] = fases.map(() => 0);
  conta[0] += 1;
  if (n >= 2) conta[fases.length - 1] += 1;
  const meio = n - (n >= 2 ? 2 : 1);
  if (meio > 0) {
    const pesoDe = (i: number) => Math.max(0.0001, pesos[fases[i].fase]);
    const soma = fases.reduce((s, _f, i) => s + pesoDe(i), 0);
    const ideais = fases.map((_f, i) => ({ i, v: (meio * pesoDe(i)) / soma }));
    ideais.forEach((x) => { conta[x.i] += Math.floor(x.v); });
    let resto = meio - ideais.reduce((s, x) => s + Math.floor(x.v), 0);
    ideais.slice().sort((a, b) => (b.v - Math.floor(b.v)) - (a.v - Math.floor(a.v))).forEach((x) => { if (resto > 0) { conta[x.i]++; resto--; } });
  }
  // 23/10/2026: na reorganização, a introdução tem exatamente as vagas das peças que são introdução (oferta
  // nunca cai no aquecimento); a sobra vai para o lançamento (ou a fase seguinte).
  if (typeof opcoes.introducoes === "number" && fases.length > 1 && n >= 2) {
    const alvo = Math.max(1, Math.min(n - 1, Math.round(opcoes.introducoes)));
    let diff = conta[0] - alvo;
    conta[0] = alvo;
    for (let i = 1; diff > 0 && i < fases.length; i++) { conta[i] += diff; diff = 0; }
    while (diff < 0) {
      // Faltou: tira de quem tem mais, sem zerar o encerramento.
      let maior = -1;
      for (let i = 1; i < fases.length; i++) if (conta[i] > (i === fases.length - 1 ? 1 : 0) && (maior < 0 || conta[i] > conta[maior])) maior = i;
      if (maior < 0) break;
      conta[maior]--;
      diff++;
    }
  }
  const uteisDaJanela: string[] = [];
  for (let d = linha.inicio; d <= linha.fim; d = somarDiasDaLinha(d, 1)) if (diaUtilDaLinha(d)) uteisDaJanela.push(d);
  const livre = (d: string) => (usados[d] || 0) < porDia;
  const escolhidas: VagaDaPeca[] = [];
  // A ponta (introdução ou encerramento) que só tinha fim de semana e foi para o dia útil vizinho mantém o papel.
  const pontaDeslocada = new Set<VagaDaPeca>();
  let deslocada = false;
  const marcar = (d: string, i: number) => {
    usados[d] = (usados[d] || 0) + 1;
    const f = fases[i];
    const v = { data: d, fase: f.fase, etapa: f.etapa, nome: f.nome, papel: f.papel };
    escolhidas.push(v);
    if (deslocada && (i === 0 || i === fases.length - 1)) pontaDeslocada.add(v);
  };
  // A introdução e o encerramento primeiro (as pontas), depois o meio.
  const ordemDasFases = fases.map((_f, i) => i).sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : a === fases.length - 1 ? -1 : b === fases.length - 1 ? 1 : a - b));
  ordemDasFases.forEach((i) => {
    const f = fases[i];
    const c = conta[i];
    if (c <= 0) return;
    let dias = uteisDaJanela.filter((d) => d >= f.inicio && d <= f.fim);
    deslocada = !dias.length;
    if (!dias.length) {
      // Sem dia útil na fase: o mais perto dentro da janela (o encerramento olha para trás; o resto, para a frente).
      const antes = uteisDaJanela.filter((d) => d < f.inicio);
      const depois = uteisDaJanela.filter((d) => d > f.fim);
      const perto = i === fases.length - 1 ? (antes.length ? antes[antes.length - 1] : depois[0]) : (depois.length ? depois[0] : antes[antes.length - 1]);
      if (perto) {
        dias = [perto];
        avisos.push(`${f.nome} (${curta(f.inicio)}${f.fim !== f.inicio ? ` a ${curta(f.fim)}` : ""}) cai no fim de semana: a peça sai em ${curta(perto)} (o painel publica de segunda a sexta).`);
      }
    }
    if (!dias.length) return;
    // Os espaços da fase (cada dia vale porDia), espalhados por igual.
    const espacos: string[] = [];
    dias.forEach((d) => { for (let k = 0; k < porDia - (usados[d] || 0); k++) espacos.push(d); });
    for (let k = 0; k < c; k++) {
      if (espacos.length) {
        // A introdução começa no primeiro dia da campanha (o público é preparado desde o início).
        const idx = Math.min(espacos.length - 1, Math.floor(((k + (i === 0 ? 0 : 0.5)) * espacos.length) / c));
        const d = espacos[idx];
        if (livre(d)) { marcar(d, i); espacos.splice(idx, 1); continue; }
      }
      // Sem espaço na fase: a introdução e o encerramento ficam na fase deles (acima do limite, com aviso); as
      // outras vão para o dia livre mais perto, fora da introdução e do encerramento (a fase vira a da data).
      const ponta = i === 0 || i === fases.length - 1;
      const alvo = dias[Math.floor(dias.length / 2)];
      const primeira = fases[0];
      const ultima = fases[fases.length - 1];
      const livres = ponta ? [] : uteisDaJanela.filter((d) => livre(d) && !(d >= primeira.inicio && d <= primeira.fim) && !(fases.length > 1 && d >= ultima.inicio && d <= ultima.fim)).sort((a, b) => Math.abs(diasEntreDaLinha(alvo, a)) - Math.abs(diasEntreDaLinha(alvo, b)));
      if (livres.length) marcar(livres[0], i);
      else {
        marcar(dias[dias.length - 1], i);
        avisos.push(`Sem espaço no limite de ${porDia} post(s) por dia: uma peça de ${f.nome.toLowerCase()} ficou acima do limite em ${curta(dias[dias.length - 1])}.`);
      }
    }
  });
  // 23/10/2026: a fase de cada vaga é a da janela em que a data cai (nunca a de onde ela veio).
  escolhidas.forEach((v) => {
    if (pontaDeslocada.has(v)) return;
    const f = faseNaData(linha, v.data);
    if (f) Object.assign(v, { fase: f.fase, etapa: f.etapa, nome: f.nome, papel: f.papel });
  });
  escolhidas.sort((a, b) => a.data.localeCompare(b.data) || ORDEM_DAS_FASES.indexOf(a.fase) - ORDEM_DAS_FASES.indexOf(b.fase));
  return { vagas: escolhidas, avisos: avisos.filter((a, i, l) => l.indexOf(a) === i) };
}

/** A fase de uma peça pela etapa escrita (para reorganizar quem já existe). */
export function faseDaEtapa(etapa: unknown): FaseDaLinha | null {
  const e = String(etapa || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (!e) return null;
  if (/encerr|ultimo chamado|ultima chamada|ultima chance|agradec|despedida|fecha/.test(e)) return "encerramento";
  if (/urgen|escassez|contagem|ultimos dias|ultimas|acaba|reta final|cyber/.test(e)) return "urgencia";
  if (/aquec|teaser|antecip|expectativ|curiosidade|pre[- ]|aviso|introdu|vem ai/.test(e)) return "aquecimento";
  if (/sustent|meio|prova|depoiment|objec|produto|educa|demonstra|bastidor/.test(e)) return "sustentacao";
  if (/lanc|abertura|revela|estreia|oferta/.test(e)) return "lancamento";
  return null;
}

/** O bloco da linha no prompt: as datas são fixas, o modelo só escreve o conteúdo de cada fase. */
export function blocoDaLinhaDoTempo(linha: LinhaDoTempo | null): string {
  if (!linha) return "";
  return [
    `LINHA DO TEMPO DA CAMPANHA (calculada pelo sistema; as datas e as fases são fixas, não mude): evento em ${linha.evento}, de ${linha.inicio} a ${linha.fim}.`,
    ...linha.fases.map((f) => `- ${f.nome} (${ETAPA_DA_FASE[f.fase]}): ${f.inicio}${f.fim !== f.inicio ? ` a ${f.fim}` : ""}; ${f.papel}.`),
    "- A primeira peça é sempre de introdução (prepara o público, nunca a oferta de cara) e a última é de encerramento.",
  ].join("\n");
}
