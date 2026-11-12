/**
 * Crescimento da carteira (12/11/2026, pedido do dono): quantos clientes entraram por semana e por mês,
 * o histórico inteiro, e quanto foi recebido em cada mês. Só contas; a tela fica em
 * src/components/clientes/CrescimentoDaCarteira.tsx.
 *
 * - "Entrou" é a data do cadastro do cliente no painel (profiles.created_at), no fuso de São Paulo.
 *   Empresa do grupo (interna) e cadastro apagado não contam.
 * - "Recebido" é dinheiro que entrou de fato: cobrança paga (pela data do pagamento) mais parcela de
 *   projeto paga. Só reais. Cobrança em aberto não conta.
 * - A semana começa na segunda.
 */

export type ClienteDaCarteira = {
  id: string;
  nome: string;
  entrou: string; // ISO
  tipo: "recurring" | "hybrid" | "one_off";
  ativo: boolean;
  /** Serviços contratados, pelo nome que a equipe usa (Social, Tráfego, Site...). */
  servicos?: string[];
  plano?: string | null;
  /** Valor da mensalidade (0 quando não tem). */
  mensal?: number;
  /** Valor contratado em projeto avulso (0 quando não tem). */
  avulso?: number;
  /** Quando saiu (plano inativo): a data do último pagamento, que é o que o cadastro permite saber. */
  saiuEm?: string | null;
};

export type Recebimento = { data: string; valor: number; clienteId?: string | null };

export type Periodo = "tudo" | "12m" | "6m" | "3m" | "ano";
export type Grao = "mes" | "semana";
/** "mensal" = quem tem mensalidade; "avulso" = quem contratou projeto avulso. O híbrido entra nos dois. */
export type TipoDoFiltro = "todos" | "mensal" | "avulso";

export const temMensalidade = (c: ClienteDaCarteira) => (c.mensal ?? 0) > 0 || c.tipo === "recurring" || c.tipo === "hybrid";
export const temAvulso = (c: ClienteDaCarteira) => (c.avulso ?? 0) > 0 || c.tipo === "one_off" || c.tipo === "hybrid";
export const doTipo = (c: ClienteDaCarteira, tipo: TipoDoFiltro) => tipo === "todos" || (tipo === "mensal" ? temMensalidade(c) : temAvulso(c));

export type Balde = {
  chave: string; // 2026-07 ou 2026-07-06 (segunda da semana)
  rotulo: string; // jul/26 ou 06/07
  entraram: number;
  recebido: number;
  nomes: string[];
};

const FUSO = "America/Sao_Paulo";
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** A data (ano, mês, dia) em São Paulo. Data pura "2026-07-06" é lida como está, sem fuso. */
export function diaEmSaoPaulo(iso: string): { a: number; m: number; d: number } | null {
  if (!iso) return null;
  const pura = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (pura) return { a: Number(pura[1]), m: Number(pura[2]), d: Number(pura[3]) };
  const t = new Date(iso);
  if (!Number.isFinite(t.getTime())) return null;
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).format(t).split("-");
  return { a: Number(partes[0]), m: Number(partes[1]), d: Number(partes[2]) };
}

const dois = (n: number) => String(n).padStart(2, "0");
export const chaveDoMes = (x: { a: number; m: number }) => `${x.a}-${dois(x.m)}`;

/** A segunda-feira da semana daquele dia. */
export function segundaDaSemana(x: { a: number; m: number; d: number }): { a: number; m: number; d: number } {
  const t = new Date(Date.UTC(x.a, x.m - 1, x.d));
  const dia = t.getUTCDay(); // 0 = domingo
  t.setUTCDate(t.getUTCDate() - (dia === 0 ? 6 : dia - 1));
  return { a: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
const chaveDoDia = (x: { a: number; m: number; d: number }) => `${x.a}-${dois(x.m)}-${dois(x.d)}`;

export function rotuloDoMes(chave: string): string {
  const [a, m] = chave.split("-").map(Number);
  return `${MESES[m - 1]}/${String(a).slice(2)}`;
}
export function nomeDoMes(chave: string): string {
  const [a, m] = chave.split("-").map(Number);
  const nomes = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  return `${nomes[m - 1]} de ${a}`;
}

/** Em que mês (ou semana) cai aquela data. */
export function chaveDaData(iso: string, grao: Grao): string | null {
  return chaveDe(iso, grao);
}

/** "05/11/2026", no fuso de São Paulo. */
export function dataCurta(iso: string): string {
  const d = diaEmSaoPaulo(iso);
  return d ? `${dois(d.d)}/${dois(d.m)}/${d.a}` : "";
}

/** Quantos dos que entraram contrataram cada serviço, do mais pedido para o menos. */
export function servicosDeQuemEntrou(clientes: ClienteDaCarteira[]): Array<{ servico: string; quantos: number }> {
  const conta = new Map<string, number>();
  for (const c of clientes) for (const s of c.servicos ?? []) conta.set(s, (conta.get(s) ?? 0) + 1);
  return [...conta.entries()].map(([servico, quantos]) => ({ servico, quantos })).sort((a, b) => b.quantos - a.quantos || a.servico.localeCompare(b.servico, "pt-BR"));
}

function chaveDe(iso: string, grao: Grao): string | null {
  const dia = diaEmSaoPaulo(iso);
  if (!dia) return null;
  return grao === "mes" ? chaveDoMes(dia) : chaveDoDia(segundaDaSemana(dia));
}

/** Todas as chaves entre a primeira e a última, sem buraco (mês sem cliente aparece com zero). */
function chavesSeguidas(de: string, ate: string, grao: Grao): string[] {
  const saida: string[] = [];
  if (grao === "mes") {
    let [a, m] = de.split("-").map(Number);
    const [af, mf] = ate.split("-").map(Number);
    for (let i = 0; i < 600 && (a < af || (a === af && m <= mf)); i += 1) {
      saida.push(chaveDoMes({ a, m }));
      m += 1;
      if (m > 12) { m = 1; a += 1; }
    }
    return saida;
  }
  const [a, m, d] = de.split("-").map(Number);
  const [af, mf, df] = ate.split("-").map(Number);
  const t = new Date(Date.UTC(a, m - 1, d));
  const fim = Date.UTC(af, mf - 1, df);
  for (let i = 0; i < 3000 && t.getTime() <= fim; i += 1) {
    saida.push(chaveDoDia({ a: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }));
    t.setUTCDate(t.getUTCDate() + 7);
  }
  return saida;
}

/** A primeira chave que o período deixa ver. `null` = desde o começo. */
function inicioDoPeriodo(periodo: Periodo, grao: Grao, hoje: Date): string | null {
  const dia = diaEmSaoPaulo(hoje.toISOString())!;
  if (periodo === "tudo") return null;
  let a = dia.a;
  let m = dia.m;
  if (periodo === "ano") m = 1;
  else {
    const voltar = periodo === "12m" ? 11 : periodo === "6m" ? 5 : 2;
    m -= voltar;
    while (m < 1) { m += 12; a -= 1; }
  }
  return grao === "mes" ? chaveDoMes({ a, m }) : chaveDoDia(segundaDaSemana({ a, m, d: 1 }));
}

export function serieDoCrescimento(
  clientes: ClienteDaCarteira[],
  recebimentos: Recebimento[],
  opcoes: { periodo: Periodo; grao: Grao; tipo: TipoDoFiltro; hoje?: Date },
): Balde[] {
  const hoje = opcoes.hoje ?? new Date();
  const chaveDeHoje = chaveDe(hoje.toISOString(), opcoes.grao)!;
  const filtrados = clientes.filter((c) => doTipo(c, opcoes.tipo));
  const idsDoTipo = new Set(filtrados.map((c) => c.id));
  const dinheiro = recebimentos.filter((r) => opcoes.tipo === "todos" || (r.clienteId && idsDoTipo.has(r.clienteId)));

  const mapa = new Map<string, Balde>();
  const balde = (chave: string) => {
    let b = mapa.get(chave);
    if (!b) {
      b = { chave, rotulo: opcoes.grao === "mes" ? rotuloDoMes(chave) : `${chave.slice(8, 10)}/${chave.slice(5, 7)}`, entraram: 0, recebido: 0, nomes: [] };
      mapa.set(chave, b);
    }
    return b;
  };
  for (const c of filtrados) {
    const k = chaveDe(c.entrou, opcoes.grao);
    if (!k) continue;
    const b = balde(k);
    b.entraram += 1;
    b.nomes.push(c.nome);
  }
  for (const r of dinheiro) {
    const k = chaveDe(r.data, opcoes.grao);
    if (!k || !(r.valor > 0)) continue;
    balde(k).recebido += r.valor;
  }
  const chaves = [...mapa.keys()].sort();
  if (chaves.length === 0) return [];
  const primeira = chaves[0];
  const ultima = chaves[chaves.length - 1] > chaveDeHoje ? chaves[chaves.length - 1] : chaveDeHoje;
  const corte = inicioDoPeriodo(opcoes.periodo, opcoes.grao, hoje);
  const de = corte && corte > primeira ? corte : primeira;
  return chavesSeguidas(de, ultima, opcoes.grao).map((k) => {
    const b = balde(k);
    return { ...b, recebido: Math.round(b.recebido * 100) / 100 };
  });
}

export type ResumoDoCrescimento = {
  ativos: number;
  total: number;
  entraramNoMes: number;
  entraramNoMesPassado: number;
  entraramNaSemana: number;
  recebidoNoMes: number;
  recebidoNoMesPassado: number;
  mesComMaisEntradas: Balde | null;
  mesComMenosEntradas: Balde | null;
  mesComMaiorRecebido: Balde | null;
  mediaPorMes: number;
  /** Quantos meses fechados entraram na média (o mês corrente fica de fora). */
  mesesNaMedia: number;
};

/** Os números de cima e os destaques. Sempre sobre o histórico inteiro, por mês. */
export function resumoDoCrescimento(clientes: ClienteDaCarteira[], recebimentos: Recebimento[], tipo: TipoDoFiltro = "todos", hoje: Date = new Date()): ResumoDoCrescimento {
  const meses = serieDoCrescimento(clientes, recebimentos, { periodo: "tudo", grao: "mes", tipo, hoje });
  const semanas = serieDoCrescimento(clientes, recebimentos, { periodo: "3m", grao: "semana", tipo, hoje });
  const filtrados = clientes.filter((c) => doTipo(c, tipo));
  const chaveMes = chaveDe(hoje.toISOString(), "mes")!;
  const chaveSemana = chaveDe(hoje.toISOString(), "semana")!;
  const i = meses.findIndex((b) => b.chave === chaveMes);
  const esteMes = i >= 0 ? meses[i] : null;
  const mesPassado = i > 0 ? meses[i - 1] : null;
  // O mês corrente ainda está em aberto: não entra na disputa de "menos entradas".
  const fechados = meses.filter((b) => b.chave < chaveMes);
  const maior = (lista: Balde[], campo: "entraram" | "recebido") => lista.reduce<Balde | null>((m, b) => (!m || b[campo] > m[campo] ? b : m), null);
  const menor = (lista: Balde[]) => lista.reduce<Balde | null>((m, b) => (!m || b.entraram < m.entraram ? b : m), null);
  const maisEntradas = maior(meses, "entraram");
  const maiorRecebido = maior(meses, "recebido");
  return {
    ativos: filtrados.filter((c) => c.ativo).length,
    total: filtrados.length,
    entraramNoMes: esteMes?.entraram ?? 0,
    entraramNoMesPassado: mesPassado?.entraram ?? 0,
    entraramNaSemana: semanas.find((b) => b.chave === chaveSemana)?.entraram ?? 0,
    recebidoNoMes: esteMes?.recebido ?? 0,
    recebidoNoMesPassado: mesPassado?.recebido ?? 0,
    mesComMaisEntradas: maisEntradas && maisEntradas.entraram > 0 ? maisEntradas : null,
    mesComMenosEntradas: fechados.length > 1 ? menor(fechados) : null,
    mesComMaiorRecebido: maiorRecebido && maiorRecebido.recebido > 0 ? maiorRecebido : null,
    mesesNaMedia: fechados.length,
    mediaPorMes: fechados.length ? Math.round((fechados.reduce((s, b) => s + b.entraram, 0) / fechados.length) * 10) / 10 : 0,
  };
}

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** Em que dia da semana os clientes entram: os sete dias (segunda primeiro) e o melhor. */
export function entradasPorDiaDaSemana(clientes: ClienteDaCarteira[]): { dias: Array<{ dia: string; quantos: number }>; melhor: { dia: string; quantos: number; parte: number } | null } {
  const conta = [0, 0, 0, 0, 0, 0, 0];
  let total = 0;
  for (const c of clientes) {
    const d = diaEmSaoPaulo(c.entrou);
    if (!d) continue;
    conta[new Date(Date.UTC(d.a, d.m - 1, d.d)).getUTCDay()] += 1;
    total += 1;
  }
  const ordem = [1, 2, 3, 4, 5, 6, 0];
  const dias = ordem.map((i) => ({ dia: DIAS[i], quantos: conta[i] }));
  const melhor = dias.reduce<{ dia: string; quantos: number } | null>((m, x) => (!m || x.quantos > m.quantos ? x : m), null);
  return { dias, melhor: melhor && melhor.quantos > 0 ? { ...melhor, parte: Math.round((melhor.quantos / total) * 100) } : null };
}

/** O que entrou em valor: mensalidades novas (por mês) e avulsos contratados. */
export function valorDeQuemEntrou(clientes: ClienteDaCarteira[]): { mensalidades: number; mensalPorMes: number; avulsos: number; avulsoTotal: number } {
  const comMensal = clientes.filter((c) => (c.mensal ?? 0) > 0);
  const comAvulso = clientes.filter((c) => (c.avulso ?? 0) > 0);
  const soma = (l: ClienteDaCarteira[], k: "mensal" | "avulso") => Math.round(l.reduce((s, c) => s + (c[k] ?? 0), 0) * 100) / 100;
  return { mensalidades: comMensal.length, mensalPorMes: soma(comMensal, "mensal"), avulsos: comAvulso.length, avulsoTotal: soma(comAvulso, "avulso") };
}

export type MesDeSaida = { chave: string; rotulo: string; base: number; sairam: number; nomes: string[]; perdido: number; churn: number };
export type ResumoDasSaidas = {
  meses: MesDeSaida[];
  /** Mensalistas que saíram (plano inativo), do mais recente para o mais antigo. */
  quemSaiu: ClienteDaCarteira[];
  /** Avulsos concluídos: não são perda, o projeto acabou. */
  avulsosConcluidos: ClienteDaCarteira[];
  mensalistasQueJaPassaram: number;
  mediaDeSaidasPorMes: number;
  churnMedio: number;
  mensalidadePerdida: number;
  /** Quanto tempo, em meses, ficou quem saiu. */
  permanenciaMedia: number;
};

/**
 * Saídas e churn, só de quem tinha mensalidade. A cada mês: a base é quem tinha mensalidade no começo
 * do mês e ainda não tinha saído; o churn é quem saiu no mês dividido pela base. As médias usam só mês
 * fechado. Avulso concluído fica numa lista à parte: projeto que terminou não é cliente perdido.
 */
export function resumoDasSaidas(clientes: ClienteDaCarteira[], hoje: Date = new Date()): ResumoDasSaidas {
  const mensalistas = clientes.filter((c) => (c.mensal ?? 0) > 0 || c.tipo === "recurring" || c.tipo === "hybrid");
  const quemSaiu = mensalistas.filter((c) => !c.ativo && c.saiuEm).sort((a, b) => (String(a.saiuEm) < String(b.saiuEm) ? 1 : -1));
  const avulsosConcluidos = clientes.filter((c) => !c.ativo && !mensalistas.includes(c));
  const chaveHoje = chaveDe(hoje.toISOString(), "mes")!;
  const entradas = mensalistas.map((c) => chaveDe(c.entrou, "mes")).filter(Boolean) as string[];
  if (entradas.length === 0) return { meses: [], quemSaiu, avulsosConcluidos, mensalistasQueJaPassaram: 0, mediaDeSaidasPorMes: 0, churnMedio: 0, mensalidadePerdida: 0, permanenciaMedia: 0 };
  const primeira = entradas.sort()[0];
  const meses: MesDeSaida[] = chavesSeguidas(primeira, chaveHoje, "mes").map((chave) => {
    const base = mensalistas.filter((c) => (chaveDe(c.entrou, "mes") || "") < chave && !(c.saiuEm && !c.ativo && (chaveDe(c.saiuEm, "mes") || "") < chave)).length;
    const doMes = quemSaiu.filter((c) => chaveDe(String(c.saiuEm), "mes") === chave);
    return { chave, rotulo: rotuloDoMes(chave), base, sairam: doMes.length, nomes: doMes.map((c) => c.nome), perdido: doMes.reduce((s, c) => s + (c.mensal ?? 0), 0), churn: base > 0 ? Math.round((doMes.length / base) * 1000) / 10 : 0 };
  });
  const fechados = meses.filter((m) => m.chave < chaveHoje);
  const comBase = fechados.filter((m) => m.base > 0);
  const mesesEntre = (a: string, b: string) => { const x = diaEmSaoPaulo(a); const y = diaEmSaoPaulo(b); return x && y ? Math.max(0, (y.a - x.a) * 12 + (y.m - x.m) + (y.d - x.d) / 30) : 0; };
  return {
    meses,
    quemSaiu,
    avulsosConcluidos,
    mensalistasQueJaPassaram: mensalistas.length,
    mediaDeSaidasPorMes: fechados.length ? Math.round((fechados.reduce((s, m) => s + m.sairam, 0) / fechados.length) * 10) / 10 : 0,
    churnMedio: comBase.length ? Math.round((comBase.reduce((s, m) => s + m.churn, 0) / comBase.length) * 10) / 10 : 0,
    mensalidadePerdida: Math.round(quemSaiu.reduce((s, c) => s + (c.mensal ?? 0), 0) * 100) / 100,
    permanenciaMedia: quemSaiu.length ? Math.round((quemSaiu.reduce((s, c) => s + mesesEntre(c.entrou, String(c.saiuEm)), 0) / quemSaiu.length) * 10) / 10 : 0,
  };
}
