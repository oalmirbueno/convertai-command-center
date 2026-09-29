/**
 * Inteligência de horas, custos e entregas (frente CR, 28/09). Tudo aqui é
 * conta em código, com o dado do banco: nada estimado por IA. As fórmulas
 * são as mesmas que a central explica no "?".
 *
 * Unidades: tempo em segundos, custo em dólar (carteira de IA), entregas em
 * quantidade. Mês = AAAA-MM-01 de São Paulo.
 */

export const CARGA_PADRAO_HORAS = 160;
/** Abaixo disto de ocupação, com eficiência estável ou melhor: dá para escalar. */
export const OCUPACAO_PARA_ESCALAR = 0.75;
/** Acima disto por dois meses seguidos: contratar. */
export const OCUPACAO_PARA_CONTRATAR = 0.9;
/** Mudança menor que isto (10%) é estável. */
export const VARIACAO_RELEVANTE = 0.1;

export type Periodo = "manha" | "tarde" | "noite";
export const PERIODOS: { chave: Periodo; rotulo: string; de: number; ate: number }[] = [
  { chave: "manha", rotulo: "Manhã", de: 6, ate: 12 },
  { chave: "tarde", rotulo: "Tarde", de: 12, ate: 18 },
  { chave: "noite", rotulo: "Noite", de: 18, ate: 30 },
];

/** Manhã 6h às 12h, tarde 12h às 18h, noite 18h às 6h. */
export function periodoDaHora(hora: number): Periodo {
  if (hora >= 6 && hora < 12) return "manha";
  if (hora >= 12 && hora < 18) return "tarde";
  return "noite";
}

// ------------------------------------------------------------------ datas

export function somarMeses(mes: string, n: number): string {
  const [a, m] = mes.split("-").map(Number);
  const total = a * 12 + (m - 1) + n;
  const ano = Math.floor(total / 12);
  const mm = (total % 12) + 1;
  return `${ano}-${mm < 10 ? "0" : ""}${mm}-01`;
}

export function diasNoMes(mes: string): number {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

/** Hoje em São Paulo (AAAA-MM-DD), a partir do instante. */
export function hojeEmSaoPaulo(agora: number): string {
  return new Date(agora - 3 * 3600_000).toISOString().slice(0, 10);
}

export function mesDoDia(dia: string): string {
  return `${dia.slice(0, 7)}-01`;
}

/** Fração do mês já passada (0 a 1). Mês passado = 1; futuro = 0. */
export function fracaoDoMes(mes: string, agora: number): number {
  const hoje = hojeEmSaoPaulo(agora);
  const atual = mesDoDia(hoje);
  if (mes < atual) return 1;
  if (mes > atual) return 0;
  const dia = Number(hoje.slice(8, 10));
  const horaSP = new Date(agora - 3 * 3600_000).getUTCHours();
  return Math.min(1, (dia - 1 + horaSP / 24) / diasNoMes(mes));
}

/**
 * Projeção linear do mês em andamento: o que já foi feito dividido pela parte
 * do mês que passou. Com menos de 3 dias passados não projeta (base curta).
 */
export function projetar(valor: number, mes: string, agora: number): number | null {
  const f = fracaoDoMes(mes, agora);
  if (f >= 1) return valor;
  if (f * diasNoMes(mes) < 3) return null;
  return valor / f;
}

/** Segunda-feira da semana de um dia (AAAA-MM-DD). */
export function inicioDaSemana(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // segunda = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/** Semanas que tocam o mês (começam na segunda). */
export function semanasDoMes(mes: string): string[] {
  const dias = diasNoMes(mes);
  const saida: string[] = [];
  for (let i = 1; i <= dias; i++) {
    const s = inicioDaSemana(`${mes.slice(0, 8)}${i < 10 ? "0" : ""}${i}`);
    if (saida.indexOf(s) < 0) saida.push(s);
  }
  return saida;
}

export function diaDaSemana(dia: string): number {
  return (new Date(`${dia}T12:00:00Z`).getUTCDay() + 6) % 7;
}

// ------------------------------------------------------------------ recortes do mês

export interface Detalhe {
  client_id: string;
  dia: string;
  hora: number;
  segundos: number;
}

export type Recorte = { tipo: "mes" } | { tipo: "semana"; inicio: string } | { tipo: "dia"; dia: string };

export function dentroDoRecorte(d: Detalhe, recorte: Recorte, periodo: Periodo | "todos"): boolean {
  if (periodo !== "todos" && periodoDaHora(d.hora) !== periodo) return false;
  if (recorte.tipo === "dia") return d.dia === recorte.dia;
  if (recorte.tipo === "semana") return inicioDaSemana(d.dia) === recorte.inicio;
  return true;
}

/** Segundos por cliente dentro do recorte. */
export function segundosPorCliente(detalhe: Detalhe[], recorte: Recorte, periodo: Periodo | "todos"): Record<string, number> {
  const saida: Record<string, number> = {};
  for (const d of detalhe) {
    if (!dentroDoRecorte(d, recorte, periodo)) continue;
    saida[d.client_id] = (saida[d.client_id] || 0) + d.segundos;
  }
  return saida;
}

/** Segundos por período do dia (para um cliente ou todos). */
export function segundosPorPeriodo(detalhe: Detalhe[], cliente: string | null = null): Record<Periodo, number> {
  const s: Record<Periodo, number> = { manha: 0, tarde: 0, noite: 0 };
  for (const d of detalhe) if (!cliente || d.client_id === cliente) s[periodoDaHora(d.hora)] += d.segundos;
  return s;
}

/** Mapa de calor: [dia da semana 0..6][hora 0..23] em segundos. */
export function mapaDeCalor(detalhe: Detalhe[], periodo: Periodo | "todos" = "todos"): number[][] {
  const mapa: number[][] = [];
  for (let i = 0; i < 7; i++) {
    const linha: number[] = [];
    for (let h = 0; h < 24; h++) linha.push(0);
    mapa.push(linha);
  }
  for (const d of detalhe) {
    if (periodo !== "todos" && periodoDaHora(d.hora) !== periodo) continue;
    const h = Math.max(0, Math.min(23, Math.floor(d.hora)));
    mapa[diaDaSemana(d.dia)][h] += d.segundos;
  }
  return mapa;
}

/** Segundos por dia do mês (para a faixa "por dia"). */
export function segundosPorDia(detalhe: Detalhe[], periodo: Periodo | "todos" = "todos"): Record<string, number> {
  const s: Record<string, number> = {};
  for (const d of detalhe) {
    if (periodo !== "todos" && periodoDaHora(d.hora) !== periodo) continue;
    s[d.dia] = (s[d.dia] || 0) + d.segundos;
  }
  return s;
}

export interface PecasPorHora {
  client_id: string;
  hora: number;
  pecas: number;
}

/**
 * Horário que rende mais de um cliente: o período com mais peças por hora
 * trabalhada (peças do Estúdio criadas naquele período ÷ horas nele). Sem
 * peças no mês, o período com mais horas. Precisa de pelo menos 30 min no
 * período para entrar na conta (evita "rende 10 por hora" com 5 minutos).
 */
export function periodoQueRendeMais(
  detalhe: Detalhe[],
  pecas: PecasPorHora[],
  cliente: string,
): { periodo: Periodo; criterio: "pecas-por-hora" | "mais-horas"; valor: number } | null {
  const horas = segundosPorPeriodo(detalhe, cliente);
  const total = horas.manha + horas.tarde + horas.noite;
  if (total <= 0) return null;
  const pp: Record<Periodo, number> = { manha: 0, tarde: 0, noite: 0 };
  let temPecas = false;
  for (const p of pecas) {
    if (p.client_id !== cliente) continue;
    pp[periodoDaHora(p.hora)] += p.pecas;
    if (p.pecas > 0) temPecas = true;
  }
  const ordem: Periodo[] = ["manha", "tarde", "noite"];
  if (temPecas) {
    let melhor: Periodo | null = null;
    let taxa = -1;
    for (const k of ordem) {
      if (horas[k] < 1800) continue;
      const t = pp[k] / (horas[k] / 3600);
      if (t > taxa) {
        taxa = t;
        melhor = k;
      }
    }
    if (melhor && taxa > 0) return { periodo: melhor, criterio: "pecas-por-hora", valor: taxa };
  }
  let maior: Periodo = "manha";
  for (const k of ordem) if (horas[k] > horas[maior]) maior = k;
  return { periodo: maior, criterio: "mais-horas", valor: horas[maior] };
}

// ------------------------------------------------------------------ eficiência

export interface Eficiencia {
  horasPorEntrega: number | null;
  custoPorEntrega: number | null;
  entregasPorHora: number | null;
  custoPorHora: number | null;
}

export function eficiencia(segundos: number, custoUsd: number, entregas: number): Eficiencia {
  const horas = segundos / 3600;
  return {
    horasPorEntrega: entregas > 0 && horas > 0 ? horas / entregas : null,
    custoPorEntrega: entregas > 0 ? custoUsd / entregas : null,
    entregasPorHora: horas >= 0.25 ? entregas / horas : null,
    custoPorHora: horas >= 0.25 ? custoUsd / horas : null,
  };
}

/** Variação relativa (0,12 = +12%). Sem base anterior: null. */
export function variacao(atual: number | null, anterior: number | null): number | null {
  if (atual === null || anterior === null || !isFinite(atual) || !isFinite(anterior) || anterior === 0) return null;
  return (atual - anterior) / anterior;
}

export type Direcao = "sobe" | "estavel" | "desce" | "sem-base";

export function direcao(v: number | null): Direcao {
  if (v === null) return "sem-base";
  if (v > VARIACAO_RELEVANTE) return "sobe";
  if (v < -VARIACAO_RELEVANTE) return "desce";
  return "estavel";
}

/** Média de uma lista, ignorando nulos. */
export function media(valores: Array<number | null>): number | null {
  const v = valores.filter((x): x is number => x !== null && isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

// ------------------------------------------------------------------ o mês consolidado

export interface MesDoCliente {
  client_id: string;
  nome: string;
  mes: string;
  segundos: number;
  dias: number;
  custoUsd: number;
  entregas: number;
  /** Entregas por tipo (peças aprovadas, posts publicados, tarefas, marcos...). */
  porTipo: Record<string, number>;
  /** Previsto no mês pelo plano: o maior entre as pautas do mês e o pacote contratado (null = sem previsão). */
  previstas: number | null;
  /** Do previsto, o que já foi feito (pautas do mês concluídas ou aprovadas). */
  feitasDoPlano: number;
  /** Previstas até hoje e ainda não entregues. */
  atrasadas: number;
}

export interface TotaisDoMes {
  mes: string;
  segundos: number;
  custoUsd: number;
  entregas: number;
  previstas: number;
  /** Clientes com previsão no mês (para o avanço não inventar plano). */
  clientesComPrevisao: number;
  entregasComPrevisao: number;
  atrasadas: number;
  clientesAtivos: number;
  porTipo: Record<string, number>;
}

export function totalizar(mes: string, linhas: MesDoCliente[]): TotaisDoMes {
  const t: TotaisDoMes = {
    mes,
    segundos: 0,
    custoUsd: 0,
    entregas: 0,
    previstas: 0,
    clientesComPrevisao: 0,
    entregasComPrevisao: 0,
    atrasadas: 0,
    clientesAtivos: 0,
    porTipo: {},
  };
  for (const l of linhas) {
    if (l.mes !== mes) continue;
    t.segundos += l.segundos;
    t.custoUsd += l.custoUsd;
    t.entregas += l.entregas;
    t.atrasadas += l.atrasadas;
    if (l.previstas !== null && l.previstas > 0) {
      t.previstas += l.previstas;
      t.clientesComPrevisao += 1;
      t.entregasComPrevisao += Math.min(l.feitasDoPlano, l.previstas);
    }
    if (l.segundos > 0) t.clientesAtivos += 1;
    for (const k of Object.keys(l.porTipo)) t.porTipo[k] = (t.porTipo[k] || 0) + l.porTipo[k];
  }
  return t;
}

/** Avanço contra o plano: entregue ÷ previsto (cada cliente conta até o previsto dele). */
export function avanco(t: { previstas: number; entregasComPrevisao: number }): number | null {
  return t.previstas > 0 ? t.entregasComPrevisao / t.previstas : null;
}

// ------------------------------------------------------------------ comparação

export interface Comparacao {
  atual: number | null;
  anterior: number | null;
  media3: number | null;
  vsAnterior: number | null;
  vsMedia3: number | null;
}

export function comparar(atual: number | null, anterior: number | null, tres: Array<number | null>): Comparacao {
  const m = media(tres);
  return { atual, anterior, media3: m, vsAnterior: variacao(atual, anterior), vsMedia3: variacao(atual, m) };
}

// ------------------------------------------------------------------ capacidade e decisão

export interface EntradaDaCapacidade {
  /** Mês em análise (o escolhido na tela). */
  mes: string;
  agora: number;
  cargaHoras: number;
  /** Totais por mês (qualquer ordem), incluindo o mês em análise e os anteriores. */
  meses: TotaisDoMes[];
}

export type Decisao = "escalar" | "segurar" | "contratar" | "sem-base";

export interface Capacidade {
  /** Horas do mês em análise (projetadas se ele está em andamento). */
  horasDoMes: number;
  horasProjetadas: boolean;
  ocupacao: number | null;
  ocupacaoAnterior: number | null;
  /** Horas médias por cliente ativo por mês (meses fechados; sem eles, o mês em andamento projetado). */
  horasPorCliente: number | null;
  baseDaMedia: string[];
  clientesQueCabem: number | null;
  clientesAtivos: number;
  clientesNovosCabem: number | null;
  folgaHoras: number;
  /** Folga convertida em dias de trabalho da carteira do mês que vem. */
  diasAdiantaveis: number | null;
  /** Horas que uma contratação precisaria assumir para você voltar a 75%. */
  horasParaContratacao: number;
  /** Clientes que uma contratação com a mesma carga atende. */
  clientesPorContratacao: number | null;
  eficienciaAtual: number | null;
  eficienciaMedia3: number | null;
  tendenciaDaEficiencia: Direcao;
  atrasadasAtual: number;
  atrasadasAnterior: number;
  decisao: Decisao;
  motivos: string[];
}

function horasDoMes(t: TotaisDoMes | undefined, agora: number): { horas: number; projetado: boolean } {
  if (!t) return { horas: 0, projetado: false };
  const h = t.segundos / 3600;
  const f = fracaoDoMes(t.mes, agora);
  if (f >= 1) return { horas: h, projetado: false };
  const p = projetar(h, t.mes, agora);
  return p === null ? { horas: h, projetado: false } : { horas: p, projetado: true };
}

/**
 * Regra da decisão (a mesma do "?" da tela):
 * - ocupação = horas do mês (projetadas no mês em andamento) ÷ carga mensal;
 * - eficiência = horas por entrega; piorando = subiu mais de 10% sobre a média dos 3 meses anteriores;
 * - contratar: ocupação acima de 90% neste mês e no anterior, ou atrasos subindo com ocupação a partir de 75%;
 * - segurar: ocupação entre 75% e 90%, ou eficiência piorando;
 * - escalar: ocupação abaixo de 75% e eficiência estável ou melhorando;
 * - sem base: nenhum tempo registrado ainda (primeira semana).
 */
export function capacidade(e: EntradaDaCapacidade): Capacidade {
  const porMes: Record<string, TotaisDoMes> = {};
  for (const t of e.meses) porMes[t.mes] = t;
  const atual = porMes[e.mes];
  const anterior = porMes[somarMeses(e.mes, -1)];
  const tres = [1, 2, 3].map((n) => porMes[somarMeses(e.mes, -n)]);

  const hAtual = horasDoMes(atual, e.agora);
  const hAnterior = horasDoMes(anterior, e.agora);
  const carga = e.cargaHoras > 0 ? e.cargaHoras : CARGA_PADRAO_HORAS;
  const ocupacao = atual && atual.segundos > 0 ? hAtual.horas / carga : null;
  const ocupacaoAnterior = anterior && anterior.segundos > 0 ? hAnterior.horas / carga : null;

  // Horas por cliente: até 3 meses fechados com tempo; sem eles, o mês em andamento projetado.
  const fechados = tres.filter((t): t is TotaisDoMes => !!t && t.segundos > 0 && t.clientesAtivos > 0);
  let horasPorCliente: number | null = null;
  let baseDaMedia: string[] = [];
  if (fechados.length) {
    const horas = fechados.reduce((s, t) => s + t.segundos / 3600, 0);
    const clientesMes = fechados.reduce((s, t) => s + t.clientesAtivos, 0);
    horasPorCliente = horas / clientesMes;
    baseDaMedia = fechados.map((t) => t.mes);
  } else if (atual && atual.segundos > 0 && atual.clientesAtivos > 0 && hAtual.projetado) {
    horasPorCliente = hAtual.horas / atual.clientesAtivos;
    baseDaMedia = [atual.mes];
  } else if (atual && atual.segundos > 0 && atual.clientesAtivos > 0 && fracaoDoMes(atual.mes, e.agora) >= 1) {
    horasPorCliente = hAtual.horas / atual.clientesAtivos;
    baseDaMedia = [atual.mes];
  }

  const clientesAtivos = atual ? atual.clientesAtivos : 0;
  const folgaHoras = Math.max(0, carga - hAtual.horas);
  const clientesQueCabem = horasPorCliente && horasPorCliente > 0 ? Math.floor(carga / horasPorCliente) : null;
  const clientesNovosCabem = horasPorCliente && horasPorCliente > 0 ? Math.floor(folgaHoras / horasPorCliente) : null;
  const horasDaCarteiraPorDia = hAtual.horas > 0 ? hAtual.horas / 30 : null;
  const diasAdiantaveis = horasDaCarteiraPorDia ? folgaHoras / horasDaCarteiraPorDia : null;
  const horasParaContratacao = Math.max(0, hAtual.horas - OCUPACAO_PARA_ESCALAR * carga);
  const clientesPorContratacao = horasPorCliente && horasPorCliente > 0 ? Math.floor(carga / horasPorCliente) : null;

  const hpe = (t: TotaisDoMes | undefined) => (t && t.entregas > 0 && t.segundos > 0 ? t.segundos / 3600 / t.entregas : null);
  const eficienciaAtual = hpe(atual);
  const eficienciaMedia3 = media(tres.map(hpe));
  const tendenciaDaEficiencia = direcao(variacao(eficienciaAtual, eficienciaMedia3));
  const atrasadasAtual = atual ? atual.atrasadas : 0;
  const atrasadasAnterior = anterior ? anterior.atrasadas : 0;

  const motivos: string[] = [];
  let decisao: Decisao;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  if (ocupacao === null) {
    decisao = "sem-base";
    motivos.push("Ainda não há horas registradas neste mês.");
  } else {
    const piorando = tendenciaDaEficiencia === "sobe"; // mais horas por entrega = pior
    const atrasosSubindo = atrasadasAtual > atrasadasAnterior;
    if (
      (ocupacao > OCUPACAO_PARA_CONTRATAR && ocupacaoAnterior !== null && ocupacaoAnterior > OCUPACAO_PARA_CONTRATAR) ||
      (atrasosSubindo && ocupacao >= OCUPACAO_PARA_ESCALAR)
    ) {
      decisao = "contratar";
      if (ocupacao > OCUPACAO_PARA_CONTRATAR && ocupacaoAnterior !== null && ocupacaoAnterior > OCUPACAO_PARA_CONTRATAR)
        motivos.push(`Ocupação acima de 90% por dois meses (${pct(ocupacaoAnterior)} e ${pct(ocupacao)}).`);
      if (atrasosSubindo && ocupacao >= OCUPACAO_PARA_ESCALAR)
        motivos.push(`Atrasos subindo (${atrasadasAnterior} para ${atrasadasAtual}) com ocupação de ${pct(ocupacao)}.`);
    } else if (ocupacao >= OCUPACAO_PARA_ESCALAR || piorando) {
      decisao = "segurar";
      if (ocupacao >= OCUPACAO_PARA_ESCALAR) motivos.push(`Ocupação de ${pct(ocupacao)}, entre 75% e 90%.`);
      if (piorando) motivos.push("Horas por entrega subiram mais de 10% sobre a média dos 3 meses anteriores.");
    } else {
      decisao = "escalar";
      motivos.push(`Ocupação de ${pct(ocupacao)}, abaixo de 75%.`);
      if (tendenciaDaEficiencia === "sem-base") motivos.push("Ainda sem base de entregas para medir a eficiência.");
      else motivos.push(tendenciaDaEficiencia === "desce" ? "Eficiência melhorando." : "Eficiência estável.");
    }
  }

  return {
    horasDoMes: hAtual.horas,
    horasProjetadas: hAtual.projetado,
    ocupacao,
    ocupacaoAnterior,
    horasPorCliente,
    baseDaMedia,
    clientesQueCabem,
    clientesAtivos,
    clientesNovosCabem,
    folgaHoras,
    diasAdiantaveis,
    horasParaContratacao,
    clientesPorContratacao,
    eficienciaAtual,
    eficienciaMedia3,
    tendenciaDaEficiencia,
    atrasadasAtual,
    atrasadasAnterior,
    decisao,
    motivos,
  };
}
