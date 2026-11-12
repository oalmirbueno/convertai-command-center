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
};

export type Recebimento = { data: string; valor: number; clienteId?: string | null };

export type Periodo = "tudo" | "12m" | "6m" | "3m" | "ano";
export type Grao = "mes" | "semana";
export type TipoDoFiltro = "todos" | "recurring" | "hybrid" | "one_off";

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
  const doTipo = clientes.filter((c) => opcoes.tipo === "todos" || c.tipo === opcoes.tipo);
  const idsDoTipo = new Set(doTipo.map((c) => c.id));
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
  for (const c of doTipo) {
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
};

/** Os números de cima e os destaques. Sempre sobre o histórico inteiro, por mês. */
export function resumoDoCrescimento(clientes: ClienteDaCarteira[], recebimentos: Recebimento[], tipo: TipoDoFiltro = "todos", hoje: Date = new Date()): ResumoDoCrescimento {
  const meses = serieDoCrescimento(clientes, recebimentos, { periodo: "tudo", grao: "mes", tipo, hoje });
  const semanas = serieDoCrescimento(clientes, recebimentos, { periodo: "3m", grao: "semana", tipo, hoje });
  const doTipo = clientes.filter((c) => tipo === "todos" || c.tipo === tipo);
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
    ativos: doTipo.filter((c) => c.ativo).length,
    total: doTipo.length,
    entraramNoMes: esteMes?.entraram ?? 0,
    entraramNoMesPassado: mesPassado?.entraram ?? 0,
    entraramNaSemana: semanas.find((b) => b.chave === chaveSemana)?.entraram ?? 0,
    recebidoNoMes: esteMes?.recebido ?? 0,
    recebidoNoMesPassado: mesPassado?.recebido ?? 0,
    mesComMaisEntradas: maisEntradas && maisEntradas.entraram > 0 ? maisEntradas : null,
    mesComMenosEntradas: fechados.length > 1 ? menor(fechados) : null,
    mesComMaiorRecebido: maiorRecebido && maiorRecebido.recebido > 0 ? maiorRecebido : null,
    mediaPorMes: fechados.length ? Math.round((fechados.reduce((s, b) => s + b.entraram, 0) / fechados.length) * 10) / 10 : 0,
  };
}
