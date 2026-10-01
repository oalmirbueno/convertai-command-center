/**
 * Motor do CFO (frente CFO, 30/09/2026).
 *
 * Pedido do dono: "um CFO de verdade, que entende todo o fluxo financeiro da
 * agência, faz a projeção, aponta onde estou errando, diz até quanto posso
 * gastar neste mês e me trava quando passo do limite".
 *
 * Regra da casa: TODO número sai daqui, em código, do mesmo jeito para a tela
 * (Financeiro › CFO), para o agente (função agente-cfo) e para a trava das
 * despesas. A IA só explica e conduz a partir destes números; ela nunca
 * calcula. Por isso o arquivo é puro: sem Deno, sem npm, sem relógio próprio
 * (a data de hoje entra em `hoje`) e sem regex moderna (Safari 11 lê o mesmo
 * arquivo pela tela).
 *
 * As fórmulas seguem as telas que já existem, para o número bater com o que o
 * dono vê:
 * - recebido respeita o pagamento parcial (CashFlow.receivedAmountOf);
 * - aporte de sócio e investimento com dinheiro dele (categoria `investidor`
 *   ou `inv_*`) NÃO é despesa (CashFlow.isInvestor);
 * - saldo em caixa = base conciliada + tudo que entrou - tudo que saiu;
 * - saldo livre = saldo - caixinhas (imposto, clientes, reserva);
 * - custo fixo = recorrentes mensais + anuais / 12 (FixedCosts.monthlyBase);
 * - carteira = mensalistas ativos fora das empresas do grupo (MRR).
 */

// ------------------------------------------------------------------ entradas

export type Valor = number | string | null | undefined;

export interface CobrancaDoCFO {
  id: string;
  client_id: string | null;
  type: string | null;
  amount: Valor;
  paid_amount?: Valor;
  status: string | null;
  due_date: string | null;
  paid_date?: string | null;
  description?: string | null;
}

export interface ParcelaDoCFO {
  id: string;
  client_id: string | null;
  amount: Valor;
  paid_amount?: Valor;
  status: string | null;
  due_date: string | null;
  paid_date?: string | null;
  description?: string | null;
  projeto?: string | null;
}

export interface DespesaDoCFO {
  id: string;
  description: string | null;
  category: string | null;
  amount: Valor;
  status: string | null;
  due_date: string | null;
  paid_date?: string | null;
  recurrence: string | null;
  notes?: string | null;
}

export interface ClienteDoCFO {
  id: string;
  nome: string;
  plan_name: string | null;
  plan_value: Valor;
  plan_status: string | null;
  client_type: string | null;
  interno: boolean;
}

export interface ConfigDoCFO {
  /** financial_settings.opening_balance (a base conciliada). */
  saldoInicial: number;
  metaMensal: number | null;
  proLaboreAtual: number | null;
  proLaboreAlvo: number | null;
  /** financial_settings.reserve_target (0 ou nulo: vale a reserva do Plano Diretor). */
  reservaAlvo: number | null;
  /** Alíquota estimada da reserva tributária (padrão 6%, a do Plano Diretor). */
  aliquota?: number | null;
}

export interface CaixinhasDoCFO {
  tax: number;
  clients: number;
  safety: number;
}

export interface MetaDoCFO {
  id: string;
  titulo: string;
  tipo: string;
  valor_alvo: Valor;
  prazo?: string | null;
  criado_em?: string | null;
}

export interface TravaRegistrada {
  valor: Valor;
  limite?: Valor;
  decisao?: string | null;
  criado_em: string;
}

export interface DadosDoCFO {
  /** AAAA-MM-DD em São Paulo. */
  hoje: string;
  cobrancas: CobrancaDoCFO[];
  parcelas: ParcelaDoCFO[];
  despesas: DespesaDoCFO[];
  clientes: ClienteDoCFO[];
  config: ConfigDoCFO;
  caixinhas: CaixinhasDoCFO;
  metas?: MetaDoCFO[];
  travas?: TravaRegistrada[];
}

// ------------------------------------------------------------------ parâmetros da casa

/** Alíquota ilustrativa do Plano Diretor (o contador confirma a real). */
export const ALIQUOTA_PADRAO = 0.06;

/** Plano de entrada da tabela do Plano Diretor (Start Assistido). Igual a src/lib/directorPlan.ts (teste pina). */
export const PLANO_DE_ENTRADA = { nome: "Start Assistido", preco: 997 };

/** Avulso de entrada do Plano Diretor (Diagnóstico express). Igual a src/lib/directorPlan.ts (teste pina). */
export const AVULSO_DE_ENTRADA = { nome: "Diagnóstico express", preco: 497 };

/** Escada de pró-labore do Plano Diretor (receita operacional → pró-labore). Igual a src/lib/directorPlan.ts. */
export const ESCADA_DO_PRO_LABORE: Array<{ revenue: number; proLabore: number }> = [
  { revenue: 10_000, proLabore: 3_000 },
  { revenue: 15_000, proLabore: 4_000 },
  { revenue: 30_000, proLabore: 5_000 },
  { revenue: 50_000, proLabore: 7_000 },
  { revenue: 100_000, proLabore: 10_000 },
  { revenue: 250_000, proLabore: 15_000 },
  { revenue: 500_000, proLabore: 20_000 },
  { revenue: 1_000_000, proLabore: 25_000 },
];

/** Reserva segura inicial do Plano Diretor quando a configuração não tem alvo. */
export const RESERVA_DO_PLANO_DIRETOR = 6_300;

/** Meses que a projeção cobre (a tela escolhe 6 ou 12). */
export const MESES_DA_PROJECAO = 12;

/** O limite do mês olha os próximos meses: gastar agora não pode afundar o caixa logo depois. */
export const MESES_DE_PROTECAO_DO_LIMITE = 3;

/** Cenário conservador: entra 15% a menos (atraso, cancelamento). */
export const QUEDA_DO_CONSERVADOR = 0.15;

/** Piso de segurança do caixa livre: meio mês de estrutura. */
export const PISO_EM_MESES_DE_ESTRUTURA = 0.5;

/** Ritmo realista de contratos novos por mês para o plano de crescimento. */
export const CONTRATOS_NOVOS_POR_MES = 2;

// ------------------------------------------------------------------ utilidades

export const centavos = (v: number) => Math.round(v * 100) / 100;

export function numero(v: Valor): number {
  const n = typeof v === "number" ? v : Number(v == null ? 0 : v);
  return isFinite(n) ? n : 0;
}

/** O quanto entrou de fato, respeitando parcial (a mesma conta das telas). */
export function recebidoDe(linha: { amount: Valor; paid_amount?: Valor; status: string | null }): number {
  const total = numero(linha.amount);
  const pago = numero(linha.paid_amount);
  if (linha.status === "partial") return Math.min(pago, total);
  if (linha.status === "paid") return pago > 0 && pago < total ? pago : total;
  return 0;
}

/** O que ainda falta entrar de uma cobrança ou parcela aberta. */
export function emAbertoDe(linha: { amount: Valor; paid_amount?: Valor; status: string | null }): number {
  if (linha.status === "pending") return numero(linha.amount);
  if (linha.status === "partial") return Math.max(0, numero(linha.amount) - numero(linha.paid_amount));
  return 0;
}

/** Aporte de sócio e investimento com o dinheiro dele: capital, não despesa. */
export function ehCapital(d: Pick<DespesaDoCFO, "category">): boolean {
  const c = d.category || "";
  return c === "investidor" || c.indexOf("inv_") === 0;
}

export function ehProLabore(d: Pick<DespesaDoCFO, "description" | "category" | "notes">): boolean {
  const t = semAcento(`${d.description || ""} ${d.notes || ""}`).toLowerCase();
  return /pro[\s_-]?labore/.test(t);
}

export function ehRecorrente(d: Pick<DespesaDoCFO, "recurrence">): boolean {
  return d.recurrence === "monthly" || d.recurrence === "yearly";
}

/** Custo mensal equivalente de um recorrente (anual vira 1/12). */
export function mensalDe(d: Pick<DespesaDoCFO, "recurrence" | "amount">): number {
  if (d.recurrence === "monthly") return numero(d.amount);
  if (d.recurrence === "yearly") return numero(d.amount) / 12;
  return 0;
}

export function semAcento(s: string): string {
  return String(s || "")
    .replace(/[áàâãä]/gi, "a")
    .replace(/[éèêë]/gi, "e")
    .replace(/[íìîï]/gi, "i")
    .replace(/[óòôõö]/gi, "o")
    .replace(/[úùûü]/gi, "u")
    .replace(/[ç]/gi, "c");
}

/** "2026-09" de uma data AAAA-MM-DD. */
export function mesDe(data: string | null | undefined): string | null {
  if (!data || !/^\d{4}-\d{2}/.test(data)) return null;
  return data.slice(0, 7);
}

export function somarMeses(mes: string, n: number): string {
  const ano = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7)) - 1 + n;
  const a = ano + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${a}-${String(mm + 1).padStart(2, "0")}`;
}

/** Diferença em meses entre dois "AAAA-MM" (b - a). */
export function mesesEntre(a: string, b: string): number {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7)));
}

const NOMES_DOS_MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function rotuloDoMes(mes: string, curto = false): string {
  const nome = NOMES_DOS_MESES[Number(mes.slice(5, 7)) - 1] || mes;
  return curto ? `${nome.slice(0, 3)}/${mes.slice(2, 4)}` : `${nome} de ${mes.slice(0, 4)}`;
}

function diasNoMes(mes: string): number {
  const ano = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7));
  return new Date(Date.UTC(ano, m, 0)).getUTCDate();
}

function diasEntre(a: string, b: string): number {
  const da = Date.UTC(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1, Number(a.slice(8, 10)));
  const db = Date.UTC(Number(b.slice(0, 4)), Number(b.slice(5, 7)) - 1, Number(b.slice(8, 10)));
  return Math.round((db - da) / 86_400_000);
}

export function reais(v: number): string {
  const n = centavos(v);
  const neg = n < 0;
  const [int, dec] = Math.abs(n).toFixed(2).split(".");
  const milhar = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${neg ? "-" : ""}R$ ${milhar},${dec}`;
}

export const minusculaInicial = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
export const primeiraMaiuscula = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function dataCurta(d: string | null | undefined): string {
  if (!d || d.length < 10) return "sem data";
  return `${d.slice(8, 10)}/${d.slice(5, 7)}`;
}

/** Pró-labore proporcional pela escada (a mesma interpolação de directorPlan.interpolateProLabore). */
export function proLaboreDaEscada(operacional: number): number {
  if (!isFinite(operacional) || operacional <= 0) return 0;
  const primeiro = ESCADA_DO_PRO_LABORE[0];
  if (operacional < primeiro.revenue) return Math.round((operacional / primeiro.revenue) * primeiro.proLabore);
  let anterior = primeiro;
  for (let i = 1; i < ESCADA_DO_PRO_LABORE.length; i++) {
    const degrau = ESCADA_DO_PRO_LABORE[i];
    if (operacional < degrau.revenue) {
      const fracao = (operacional - anterior.revenue) / (degrau.revenue - anterior.revenue);
      return Math.round(anterior.proLabore + fracao * (degrau.proLabore - anterior.proLabore));
    }
    anterior = degrau;
  }
  return anterior.proLabore;
}

// ------------------------------------------------------------------ saídas

export type Nivel = "critico" | "atencao" | "bom";

export interface AlertaDoCFO {
  chave: string;
  nivel: Nivel;
  titulo: string;
  detalhe: string;
  valor?: number;
}

export interface AcaoSugerida {
  chave: string;
  titulo: string;
  detalhe: string;
  /** Quanto a ação traz (entrada) ou poupa (corte) por mês ou de uma vez. */
  valor?: number;
}

export interface MesDaProjecao {
  mes: string;
  rotulo: string;
  entradasRecorrentes: number;
  entradasPontuais: number;
  entradas: number;
  saidasFixas: number;
  saidasPontuais: number;
  saidas: number;
  imposto: number;
  resultado: number;
  /** Saldo livre no fim do mês (base). */
  saldoLivre: number;
  /** Saldo livre no fim do mês com 15% a menos de entrada. */
  saldoLivreConservador: number;
}

export interface LimiteDoMes {
  mes: string;
  rotulo: string;
  /** Até quanto dá para gastar a mais (gasto novo, de uma vez) sem afundar o caixa. */
  valor: number;
  /** Gasto novo que se repete todo mês e ainda cabe. */
  recorrente: number;
  piso: number;
  /** O mês em que o caixa livre fica mais apertado dentro da proteção. */
  mesDoAperto: string;
  saldoNoAperto: number;
  motivo: string;
  /** Quanto o limite sobe se os 3 maiores cortes não essenciais saírem a partir do mês seguinte. */
  comCortes: number;
  cortesConsiderados: number;
}

export interface CandidatoDeCorte {
  id: string;
  descricao: string;
  categoria: string;
  mensal: number;
  anual: number;
  essencial: boolean;
  grupo: "ia" | "ferramenta" | "infra" | "servico" | "outro";
  motivo: string;
}

export interface MetaSugerida {
  chave: "equilibrio" | "reserva" | "meta_mensal" | "pro_labore";
  titulo: string;
  alvo: number;
  atual: number;
  falta: number;
  prazoMeses: number;
  como: string[];
  /** O que o dono precisa fechar por mês para chegar no prazo. */
  porMes: string;
}

export interface MetaAcompanhada extends MetaDoCFO {
  alvo: number;
  atual: number;
  progresso: number;
}

export interface Retrato {
  hoje: string;
  mesAtual: string;
  rotuloDoMes: string;
  diasRestantes: number;
  aliquota: number;
  caixa: { saldo: number; caixinhas: number; saldoLivre: number; recebidoTotal: number; pagoTotal: number };
  mes: {
    recebido: number;
    recebidoOperacional: number;
    pago: number;
    pagoFixo: number;
    pagoVariavel: number;
    pagoProLabore: number;
    aReceber: number;
    aPagar: number;
    resultado: number;
    variaveis: Array<{ descricao: string; valor: number; categoria: string }>;
  };
  estrutura: {
    custoFixo: number;
    proLabore: number;
    custoFixoTotal: number;
    recorrentes: Array<{ id: string; descricao: string; categoria: string; mensal: number }>;
    assinaturasDeIa: { quantas: number; mensal: number; nomes: string[] };
  };
  carteira: {
    mrr: number;
    mrrOperacional: number;
    clientesAtivos: number;
    ticketMedio: number;
    maior: { nome: string; valor: number; parcela: number } | null;
    pausados: Array<{ nome: string; valor: number; situacao: string }>;
    abaixoDaEntrada: Array<{ nome: string; valor: number; falta: number }>;
  };
  margem: { mensal: number; percentual: number };
  folego: { meses: number | null; texto: string };
  atrasados: {
    receber: Array<{ id: string; cliente: string; valor: number; vencimento: string; dias: number }>;
    totalReceber: number;
    pagar: Array<{ id: string; descricao: string; valor: number; vencimento: string; dias: number }>;
    totalPagar: number;
  };
  projecao: MesDaProjecao[];
  limite: LimiteDoMes;
  limiteProximo: LimiteDoMes;
  /** Mês que vale para a decisão de gasto (o próximo quando o atual termina em até 3 dias). */
  limiteQueVale: LimiteDoMes;
  impostoDoMes: { estimado: number; guardado: number; falta: number };
  proLaboreDaEscada: number;
  saude: { nota: number; rotulo: string; motivos: string[] };
  alertas: AlertaDoCFO[];
  acoesDoMes: AcaoSugerida[];
  naoGastar: string[];
  cortes: CandidatoDeCorte[];
  plano: MetaSugerida[];
  metas: MetaAcompanhada[];
  travasNoMes: { quantas: number; acimaDoLimite: number };
}

// ------------------------------------------------------------------ cortes: o que é essencial

/** Grupos por palavra (sem julgamento de IA aqui: o servidor pode refinar com o Jev). */
const PALAVRAS_DE_IA = ["chat gpt", "chatgpt", "openai", "claude", "gemini", "google ai", "heygen", "higgsfield", "eleven", "aisa", "midjourney", "runway", "kling", "suno", "perplexity", "copilot", "capcut", "edit ia"];
const PALAVRAS_ESSENCIAIS = ["contabil", "contador", "supabase", "lovable", "dominio", "vps", "hermes", "servidor", "hospedagem", "internet", "certificado"];

export function grupoDaDespesa(d: Pick<DespesaDoCFO, "description" | "category">): CandidatoDeCorte["grupo"] {
  const t = semAcento(String(d.description || "")).toLowerCase();
  for (const p of PALAVRAS_DE_IA) if (t.indexOf(p) >= 0) return "ia";
  if (d.category === "infraestrutura") return "infra";
  if (d.category === "ferramentas") return "ferramenta";
  if (d.category === "fornecedores" || d.category === "impostos" || d.category === "comissoes") return "servico";
  return "outro";
}

export function essencialPorRegra(d: Pick<DespesaDoCFO, "description" | "category">): boolean {
  if (d.category === "impostos" || d.category === "salarios") return true;
  const t = semAcento(String(d.description || "")).toLowerCase();
  for (const p of PALAVRAS_ESSENCIAIS) if (t.indexOf(p) >= 0) return true;
  return false;
}

// ------------------------------------------------------------------ o retrato

/**
 * Lê tudo e devolve o retrato do CFO. Determinístico: a mesma entrada dá
 * sempre o mesmo número. `opcoes.essenciais` deixa o servidor trocar a regra
 * de essencial (ex.: julgamento do Jev) sem mudar a conta.
 */
export function retratoDoCFO(d: DadosDoCFO, opcoes: { meses?: number; essenciais?: Record<string, boolean> } = {}): Retrato {
  const hoje = d.hoje;
  const mesAtual = hoje.slice(0, 7);
  const aliquota = d.config.aliquota != null && d.config.aliquota >= 0 && d.config.aliquota < 1 ? d.config.aliquota : ALIQUOTA_PADRAO;
  const nMeses = Math.max(6, Math.min(MESES_DA_PROJECAO, Math.round(opcoes.meses || MESES_DA_PROJECAO)));
  const diasRestantes = diasNoMes(mesAtual) - Number(hoje.slice(8, 10));

  const clientePorId: Record<string, ClienteDoCFO> = {};
  for (const c of d.clientes) clientePorId[c.id] = c;
  const nomeDo = (id: string | null) => (id && clientePorId[id] ? clientePorId[id].nome : "cliente");

  const ativos = d.clientes.filter((c) => numero(c.plan_value) > 0 && c.plan_status === "active" && c.client_type !== "one_off" && !c.interno);
  const idsAtivos: Record<string, boolean> = {};
  for (const c of ativos) idsAtivos[c.id] = true;
  const pausadosOuFora: Record<string, boolean> = {};
  for (const c of d.clientes) if (c.interno || c.plan_status === "standby" || c.plan_status === "inactive") pausadosOuFora[c.id] = true;

  const operacionais = d.despesas.filter((e) => !ehCapital(e));

  // ---- caixa
  let recebidoTotal = 0;
  for (const b of d.cobrancas) if (b.type !== "ads_recharge" && (b.status === "paid" || b.status === "partial")) recebidoTotal += recebidoDe(b);
  for (const p of d.parcelas) if (p.status === "paid" || p.status === "partial") recebidoTotal += recebidoDe(p);
  let pagoTotal = 0;
  for (const e of operacionais) if (e.status === "paid") pagoTotal += numero(e.amount);
  const saldo = numero(d.config.saldoInicial) + recebidoTotal - pagoTotal;
  const caixinhas = numero(d.caixinhas.tax) + numero(d.caixinhas.clients) + numero(d.caixinhas.safety);
  const saldoLivre = saldo - caixinhas;

  // ---- o mês corrente
  const noMes = (data: string | null | undefined) => mesDe(data) === mesAtual;
  let recebidoMes = 0;
  for (const b of d.cobrancas) if (b.type !== "ads_recharge" && (b.status === "paid" || b.status === "partial") && noMes(b.paid_date || b.due_date)) recebidoMes += recebidoDe(b);
  for (const p of d.parcelas) if ((p.status === "paid" || p.status === "partial") && noMes(p.paid_date || p.due_date)) recebidoMes += recebidoDe(p);
  let pagoMes = 0;
  let pagoProLabore = 0;
  let pagoFixo = 0;
  const variaveis: Retrato["mes"]["variaveis"] = [];
  // Nomes dos recorrentes: a saída paga de um custo fixo (linha "none" gerada ao pagar) conta como fixa.
  const nomesRecorrentes: Record<string, boolean> = {};
  for (const e of operacionais) if (ehRecorrente(e)) nomesRecorrentes[semAcento(String(e.description || "")).toLowerCase().trim()] = true;
  for (const e of operacionais) {
    if (e.status !== "paid" || !noMes(e.paid_date || e.due_date)) continue;
    const v = numero(e.amount);
    pagoMes += v;
    if (ehProLabore(e)) pagoProLabore += v;
    else if (ehRecorrente(e) || nomesRecorrentes[semAcento(String(e.description || "")).toLowerCase().trim()]) pagoFixo += v;
    else variaveis.push({ descricao: String(e.description || "Saída"), valor: v, categoria: String(e.category || "outros") });
  }
  variaveis.sort((a, b) => b.valor - a.valor);
  const pagoVariavel = pagoMes - pagoFixo - pagoProLabore;

  // ---- estrutura (custo fixo)
  const recorrentes = operacionais.filter(ehRecorrente).map((e) => ({ id: e.id, descricao: String(e.description || "Custo fixo"), categoria: String(e.category || "outros"), mensal: centavos(mensalDe(e)), proLabore: ehProLabore(e), linha: e }));
  const proLabore = recorrentes.filter((r) => r.proLabore).reduce((s, r) => s + r.mensal, 0);
  const custoFixo = recorrentes.filter((r) => !r.proLabore).reduce((s, r) => s + r.mensal, 0);
  const custoFixoTotal = custoFixo + proLabore;
  const ia = recorrentes.filter((r) => !r.proLabore && grupoDaDespesa(r.linha) === "ia");

  // ---- carteira
  const mrr = ativos.reduce((s, c) => s + numero(c.plan_value), 0);
  const mrrOperacional = mrr * (1 - aliquota);
  let maior: Retrato["carteira"]["maior"] = null;
  for (const c of ativos) if (!maior || numero(c.plan_value) > maior.valor) maior = { nome: c.nome, valor: numero(c.plan_value), parcela: 0 };
  if (maior && mrr > 0) maior.parcela = maior.valor / mrr;
  const pausados = d.clientes
    .filter((c) => !c.interno && numero(c.plan_value) > 0 && c.client_type !== "one_off" && (c.plan_status === "standby" || c.plan_status === "inactive"))
    .map((c) => ({ nome: c.nome, valor: numero(c.plan_value), situacao: c.plan_status === "standby" ? "pausado" : "inativo" }));
  const abaixoDaEntrada = ativos
    .filter((c) => numero(c.plan_value) < PLANO_DE_ENTRADA.preco)
    .map((c) => ({ nome: c.nome, valor: numero(c.plan_value), falta: PLANO_DE_ENTRADA.preco - numero(c.plan_value) }))
    .sort((a, b) => b.falta - a.falta);

  const margemMensal = mrrOperacional - custoFixoTotal;

  // ---- atrasados
  const receberAtrasado: Retrato["atrasados"]["receber"] = [];
  for (const b of d.cobrancas) {
    if (b.type === "ads_recharge" || !b.due_date || b.due_date >= hoje) continue;
    const aberto = emAbertoDe(b);
    if (aberto <= 0.009) continue;
    receberAtrasado.push({ id: b.id, cliente: nomeDo(b.client_id), valor: aberto, vencimento: b.due_date, dias: diasEntre(b.due_date, hoje) });
  }
  for (const p of d.parcelas) {
    if (!p.due_date || p.due_date >= hoje) continue;
    const aberto = emAbertoDe(p);
    if (aberto <= 0.009) continue;
    receberAtrasado.push({ id: p.id, cliente: nomeDo(p.client_id), valor: aberto, vencimento: p.due_date, dias: diasEntre(p.due_date, hoje) });
  }
  receberAtrasado.sort((a, b) => b.valor - a.valor);
  const pagarAtrasado: Retrato["atrasados"]["pagar"] = [];
  for (const e of operacionais) {
    if (e.status !== "pending" || !e.due_date || e.due_date >= hoje) continue;
    pagarAtrasado.push({ id: e.id, descricao: String(e.description || "Conta"), valor: numero(e.amount), vencimento: e.due_date, dias: diasEntre(e.due_date, hoje) });
  }
  pagarAtrasado.sort((a, b) => b.dias - a.dias);

  // ---- projeção mês a mês (saldo livre)
  const meses: string[] = [];
  for (let i = 0; i < nMeses; i++) meses.push(somarMeses(mesAtual, i));
  const indice = (mes: string | null) => (mes ? mesesEntre(mesAtual, mes) : -1);
  const entRec = meses.map(() => 0);
  const entPont = meses.map(() => 0);
  const saiFixa = meses.map(() => 0);
  const saiPont = meses.map(() => 0);

  // Recorrente por cliente ativo: a cobrança do mês quando existe (paga antes = já está no caixa), senão o valor do plano.
  const renovacoesPorClienteMes: Record<string, { pendente: number; existe: boolean }> = {};
  for (const b of d.cobrancas) {
    if (b.type !== "renewal" || !b.client_id) continue;
    const m = mesDe(b.due_date);
    if (!m) continue;
    const k = `${b.client_id}|${m}`;
    const atual = renovacoesPorClienteMes[k] || { pendente: 0, existe: false };
    atual.existe = true;
    // Atrasada (vencida antes de hoje) não entra na previsão: aparece em "a cobrar".
    if (!(b.due_date && b.due_date < hoje)) atual.pendente += emAbertoDe(b);
    renovacoesPorClienteMes[k] = atual;
  }
  for (const c of ativos) {
    for (let i = 0; i < meses.length; i++) {
      const k = `${c.id}|${meses[i]}`;
      const r = renovacoesPorClienteMes[k];
      if (r && r.existe) entRec[i] += r.pendente;
      else if (i > 0) entRec[i] += numero(c.plan_value);
      // No mês corrente, sem cobrança lançada: a renovação do mês já passou ou ainda vai ser lançada; não chuta.
    }
  }
  // Pontuais: avulsos e projetos em aberto (renovação de cliente fora da carteira não entra).
  for (const b of d.cobrancas) {
    if (b.type === "renewal" || b.type === "ads_recharge") continue;
    if (!b.due_date || b.due_date < hoje) continue;
    const i = indice(mesDe(b.due_date));
    if (i >= 0 && i < meses.length) entPont[i] += emAbertoDe(b);
  }
  for (const p of d.parcelas) {
    if (!p.due_date || p.due_date < hoje) continue;
    const i = indice(mesDe(p.due_date));
    if (i >= 0 && i < meses.length) entPont[i] += emAbertoDe(p);
  }
  // Saídas.
  for (const e of operacionais) {
    if (e.status !== "pending") continue;
    const v = numero(e.amount);
    const m = mesDe(e.due_date);
    if (!m) continue;
    const i0 = indice(m);
    if (e.recurrence === "monthly") {
      if (i0 < 0) saiPont[0] += v; // atrasada: a conta do mês que passou ainda está em aberto
      for (let i = Math.max(0, i0); i < meses.length; i++) saiFixa[i] += v;
    } else if (e.recurrence === "yearly") {
      for (let i = 0; i < meses.length; i++) {
        const dif = mesesEntre(m, meses[i]);
        if (dif >= 0 && dif % 12 === 0) saiFixa[i] += v;
      }
      if (i0 < 0 && mesesEntre(m, mesAtual) % 12 !== 0) saiPont[0] += v;
    } else {
      const i = Math.max(0, i0);
      if (i < meses.length) saiPont[i] += v;
    }
  }
  const projecao: MesDaProjecao[] = [];
  let acumulado = saldoLivre;
  let acumuladoConservador = saldoLivre;
  for (let i = 0; i < meses.length; i++) {
    const entradas = entRec[i] + entPont[i];
    const saidas = saiFixa[i] + saiPont[i];
    const imposto = entradas * aliquota;
    const resultado = entradas - saidas - imposto;
    acumulado += resultado;
    const entradasC = entradas * (1 - QUEDA_DO_CONSERVADOR);
    acumuladoConservador += entradasC - saidas - entradasC * aliquota;
    projecao.push({
      mes: meses[i],
      rotulo: rotuloDoMes(meses[i], true),
      entradasRecorrentes: centavos(entRec[i]),
      entradasPontuais: centavos(entPont[i]),
      entradas: centavos(entradas),
      saidasFixas: centavos(saiFixa[i]),
      saidasPontuais: centavos(saiPont[i]),
      saidas: centavos(saidas),
      imposto: centavos(imposto),
      resultado: centavos(resultado),
      saldoLivre: centavos(acumulado),
      saldoLivreConservador: centavos(acumuladoConservador),
    });
  }

  // ---- cortes (antes do limite: o limite mostra quanto sobe com eles)
  const essenciais = opcoes.essenciais || {};
  const cortes: CandidatoDeCorte[] = recorrentes
    .filter((r) => !r.proLabore)
    .map((r) => {
      const grupo = grupoDaDespesa(r.linha);
      const essencial = Object.prototype.hasOwnProperty.call(essenciais, r.id) ? essenciais[r.id] === true : essencialPorRegra(r.linha);
      const motivo = essencial
        ? "mantém a operação de pé (contador, infraestrutura do painel ou serviço obrigatório)"
        : grupo === "ia" && ia.length > 2
          ? `uma de ${ia.length} assinaturas de IA (${reais(ia.reduce((s, x) => s + x.mensal, 0))}/mês somadas): veja se outra já cobre`
          : "não é obrigatória para entregar aos clientes hoje";
      return { id: r.id, descricao: r.descricao, categoria: r.categoria, mensal: r.mensal, anual: centavos(r.mensal * 12), essencial, grupo, motivo };
    })
    .sort((a, b) => (a.essencial === b.essencial ? b.mensal - a.mensal : a.essencial ? 1 : -1));
  const poupancaDosCortes = cortes.filter((c) => !c.essencial).slice(0, 3).reduce((s, c) => s + c.mensal, 0);

  // ---- limite do mês
  const piso = centavos(custoFixoTotal * PISO_EM_MESES_DE_ESTRUTURA);
  const limiteDe = (i: number): LimiteDoMes => {
    const fim = Math.min(projecao.length - 1, i + MESES_DE_PROTECAO_DO_LIMITE - 1);
    let pior = projecao[i];
    let folgaRecorrente = Infinity;
    for (let k = i; k <= fim; k++) {
      if (projecao[k].saldoLivreConservador < pior.saldoLivreConservador) pior = projecao[k];
    }
    // Gasto que se repete: cada mês da proteção paga mais uma vez.
    const fimRec = Math.min(projecao.length - 1, i + 5);
    for (let k = i; k <= fimRec; k++) {
      const vezes = k - i + 1;
      folgaRecorrente = Math.min(folgaRecorrente, (projecao[k].saldoLivreConservador - piso) / vezes);
    }
    const valor = Math.max(0, centavos(pior.saldoLivreConservador - piso));
    // Simulação: os 3 maiores cortes não essenciais saem a partir do mês que vem (o saldo é acumulado: no fim do mês k, k meses poupados).
    let piorComCortes = Infinity;
    for (let k = i; k <= fim; k++) piorComCortes = Math.min(piorComCortes, projecao[k].saldoLivreConservador + poupancaDosCortes * k);
    const comCortes = Math.max(0, centavos(piorComCortes - piso));
    const recorrente = Math.max(0, centavos(Math.min(folgaRecorrente, margemMensal > 0 ? margemMensal : 0)));
    const motivo = valor <= 0
      ? `o caixa livre no cenário conservador chega a ${reais(pior.saldoLivreConservador)} em ${pior.rotulo}, abaixo do piso de ${reais(piso)}`
      : `mantém pelo menos ${reais(piso)} livres até ${projecao[fim].rotulo} mesmo entrando 15% a menos`;
    return { mes: projecao[i].mes, rotulo: rotuloDoMes(projecao[i].mes), valor, recorrente, piso, mesDoAperto: pior.mes, saldoNoAperto: pior.saldoLivreConservador, motivo, comCortes, cortesConsiderados: centavos(poupancaDosCortes) };
  };
  const limite = limiteDe(0);
  const limiteProximo = limiteDe(Math.min(1, projecao.length - 1));
  const limiteQueVale = diasRestantes <= 3 ? limiteProximo : limite;

  // ---- fôlego
  const folegoMeses = custoFixoTotal > 0 ? saldoLivre / custoFixoTotal : null;
  const folegoTexto = folegoMeses === null
    ? "sem custo fixo cadastrado"
    : folegoMeses <= 0
      ? "o caixa livre já está negativo: se a receita parar, não há fôlego"
      : `o caixa livre paga ${folegoMeses.toFixed(1).replace(".", ",")} ${folegoMeses < 1.95 && folegoMeses >= 0.95 ? "mês" : "meses"} de estrutura se a receita parar`;

  // ---- imposto
  const impostoEstimado = centavos(recebidoMes * aliquota);
  const impostoGuardado = numero(d.caixinhas.tax);

  // ---- pró-labore pela escada
  const proLaboreSugerido = proLaboreDaEscada(mrrOperacional);

  // ---- metas guardadas e progresso
  const metas: MetaAcompanhada[] = (d.metas || []).map((m) => {
    const alvo = numero(m.valor_alvo);
    // O que já se mede no painel: reserva pela caixinha, equilíbrio e pró-labore pela carteira depois do imposto, receita pela carteira.
    const atual = m.tipo === "reserva"
      ? numero(d.caixinhas.safety)
      : m.tipo === "equilibrio" || m.tipo === "pro_labore"
        ? mrrOperacional
        : m.tipo === "meta_mensal" || m.tipo === "receita_mensal"
          ? mrr
          : 0;
    return { ...m, alvo, atual: centavos(atual), progresso: alvo > 0 ? Math.max(0, Math.min(1, atual / alvo)) : 0 };
  });

  // ---- plano de crescimento
  const liquidoDaEntrada = PLANO_DE_ENTRADA.preco * (1 - aliquota);
  const plano: MetaSugerida[] = [];
  const faltaEquilibrio = Math.max(0, custoFixoTotal - mrrOperacional);
  const contratosEquilibrio = Math.ceil(faltaEquilibrio / liquidoDaEntrada);
  const reajusteTotal = abaixoDaEntrada.reduce((s, c) => s + c.falta, 0);
  plano.push({
    chave: "equilibrio",
    titulo: "Estrutura paga pela carteira",
    alvo: centavos(custoFixoTotal),
    atual: centavos(mrrOperacional),
    falta: centavos(faltaEquilibrio),
    prazoMeses: faltaEquilibrio <= 0 ? 0 : Math.max(1, Math.ceil(contratosEquilibrio / CONTRATOS_NOVOS_POR_MES)),
    como: faltaEquilibrio <= 0
      ? ["A receita recorrente já paga o custo fixo e o pró-labore. Proteja isso: nenhum custo fixo novo sem receita nova."]
      : [
        `${contratosEquilibrio} ${contratosEquilibrio === 1 ? "contrato" : "contratos"} no ${PLANO_DE_ENTRADA.nome} (${reais(PLANO_DE_ENTRADA.preco)}) ${contratosEquilibrio === 1 ? "cobre" : "cobrem"} os ${reais(faltaEquilibrio)} que faltam por mês.`,
        reajusteTotal > 0 ? `Ou levar os ${abaixoDaEntrada.length} clientes abaixo da tabela para ${reais(PLANO_DE_ENTRADA.preco)}: +${reais(reajusteTotal)}/mês na renovação.` : "",
        "Ou cortar custo fixo não essencial (lista de cortes).",
      ].filter(Boolean),
    porMes: faltaEquilibrio <= 0 ? "manter" : `${Math.min(contratosEquilibrio, CONTRATOS_NOVOS_POR_MES)} contrato(s) novo(s) por mês`,
  });
  const reservaAlvo = numero(d.config.reservaAlvo) > 0 ? numero(d.config.reservaAlvo) : RESERVA_DO_PLANO_DIRETOR;
  const reservaAtual = Math.max(0, numero(d.caixinhas.safety));
  const faltaReserva = Math.max(0, reservaAlvo - reservaAtual);
  const guardarPorMes = Math.max(0, margemMensal) > 0 ? Math.max(0, margemMensal) * 0.5 : 0;
  plano.push({
    chave: "reserva",
    titulo: "Reserva de segurança",
    alvo: centavos(reservaAlvo),
    atual: centavos(reservaAtual),
    falta: centavos(faltaReserva),
    prazoMeses: faltaReserva <= 0 ? 0 : guardarPorMes > 0 ? Math.ceil(faltaReserva / guardarPorMes) : 0,
    como: faltaReserva <= 0
      ? ["A reserva está completa. Só se usa em emergência e volta ao alvo no mês seguinte."]
      : guardarPorMes > 0
        ? [`Separar ${reais(guardarPorMes)} por mês (metade da sobra da carteira) na caixinha de reserva até chegar a ${reais(reservaAlvo)}.`]
        : ["Hoje não sobra nada da carteira para guardar: primeiro a estrutura precisa se pagar (meta anterior)."],
    porMes: guardarPorMes > 0 ? `guardar ${reais(guardarPorMes)}` : "primeiro fechar o equilíbrio",
  });
  const metaMensal = numero(d.config.metaMensal);
  if (metaMensal > 0) {
    const falta = Math.max(0, metaMensal - mrr);
    const contratos = Math.ceil(falta / PLANO_DE_ENTRADA.preco);
    plano.push({
      chave: "meta_mensal",
      titulo: "Meta mensal de receita",
      alvo: centavos(metaMensal),
      atual: centavos(mrr),
      falta: centavos(falta),
      prazoMeses: falta <= 0 ? 0 : Math.max(1, Math.ceil(contratos / CONTRATOS_NOVOS_POR_MES)),
      como: falta <= 0
        ? ["A carteira recorrente já bate a meta. Hora de subir a meta para o próximo degrau."]
        : [
          `${contratos} ${contratos === 1 ? "contrato novo" : "contratos novos"} no ${PLANO_DE_ENTRADA.nome} (${reais(PLANO_DE_ENTRADA.preco)}), ou ${Math.ceil(falta / AVULSO_DE_ENTRADA.preco)} ${AVULSO_DE_ENTRADA.nome} por mês (${reais(AVULSO_DE_ENTRADA.preco)}, 100% antecipado), que também abrem venda de plano.`,
        ],
      porMes: falta <= 0 ? "manter" : `${Math.min(contratos, CONTRATOS_NOVOS_POR_MES)} contrato(s) por mês`,
    });
  }
  const proximoDegrau = ESCADA_DO_PRO_LABORE.filter((t) => t.revenue > mrrOperacional)[0];
  if (proximoDegrau) {
    const falta = proximoDegrau.revenue - mrrOperacional;
    const contratos = Math.ceil(falta / liquidoDaEntrada);
    plano.push({
      chave: "pro_labore",
      titulo: `Pró-labore de ${reais(proximoDegrau.proLabore)} sem apertar o caixa`,
      alvo: proximoDegrau.revenue,
      atual: centavos(mrrOperacional),
      falta: centavos(falta),
      prazoMeses: Math.max(1, Math.ceil(contratos / CONTRATOS_NOVOS_POR_MES)),
      como: [`Receita operacional de ${reais(proximoDegrau.revenue)}/mês libera o degrau: faltam ${contratos} contratos no ${PLANO_DE_ENTRADA.nome}.`],
      porMes: `${CONTRATOS_NOVOS_POR_MES} contratos por mês`,
    });
  }

  // ---- travas no mês (onde o dono passou do limite)
  const travasMes = (d.travas || []).filter((t) => mesDe(t.criado_em) === mesAtual);
  const travasNoMes = { quantas: travasMes.length, acimaDoLimite: travasMes.filter((t) => t.decisao === "lancou").length };

  // ---- alertas (onde o dono está errando) e saúde
  const alertas: AlertaDoCFO[] = [];
  if (saldoLivre < 0) {
    alertas.push({ chave: "caixa_negativo", nivel: "critico", titulo: `Caixa livre negativo: ${reais(saldoLivre)}`, detalhe: `O saldo em caixa é ${reais(saldo)} e as caixinhas guardam ${reais(caixinhas)}. Qualquer gasto novo agora sai de dinheiro que já tem dono (imposto, reserva) ou de dívida.`, valor: saldoLivre });
  }
  if (margemMensal < 0) {
    alertas.push({ chave: "estrutura_maior_que_receita", nivel: "critico", titulo: `A estrutura custa mais do que a carteira paga: ${reais(margemMensal)}/mês`, detalhe: `Custo fixo ${reais(custoFixo)} + pró-labore ${reais(proLabore)} = ${reais(custoFixoTotal)}, contra ${reais(mrrOperacional)} da carteira depois do imposto. Todo mês começa no vermelho antes de qualquer gasto variável.`, valor: margemMensal });
  }
  if (proLabore > 0 && proLaboreSugerido > 0 && proLabore > proLaboreSugerido * 1.1) {
    alertas.push({ chave: "pro_labore_acima_da_escada", nivel: "atencao", titulo: `Pró-labore de ${reais(proLabore)} acima do que a receita sustenta (${reais(proLaboreSugerido)} pela escada)`, detalhe: "A escada do Plano Diretor acompanha o que entra. Acima dela, o pró-labore come o caixa da empresa. Ajuste só com a sua confirmação.", valor: proLabore - proLaboreSugerido });
  }
  const adiantamentos = d.despesas.filter((e) => e.status === "paid" && noMes(e.paid_date || e.due_date) && ehProLabore(e) && /adiant|antecip/.test(semAcento(String(e.description || "")).toLowerCase()));
  if (adiantamentos.length) {
    const soma = adiantamentos.reduce((s, e) => s + numero(e.amount), 0);
    alertas.push({ chave: "adiantamento_de_pro_labore", nivel: "atencao", titulo: `${adiantamentos.length} adiantamento(s) de pró-labore no mês (${reais(soma)})`, detalhe: "Retirada fora da data mistura o seu dinheiro com o da empresa e esconde o resultado real do mês.", valor: soma });
  }
  if (ia.length > 2) {
    const soma = ia.reduce((s, x) => s + x.mensal, 0);
    alertas.push({ chave: "assinaturas_de_ia", nivel: soma > mrr * 0.2 ? "critico" : "atencao", titulo: `${ia.length} assinaturas de IA somam ${reais(soma)}/mês (${mrr > 0 ? Math.round((soma / mrr) * 100) : 0}% da carteira)`, detalhe: `${ia.map((x) => x.descricao).join(", ")}. Várias fazem a mesma coisa; escolha as que entregam para cliente e corte o resto.`, valor: soma });
  }
  const outrosNoMes = variaveis.filter((v) => v.categoria === "outros").reduce((s, v) => s + v.valor, 0);
  if (outrosNoMes > 0 && outrosNoMes > recebidoMes * 0.1) {
    alertas.push({ chave: "gastos_sem_categoria", nivel: "atencao", titulo: `${reais(outrosNoMes)} em gastos "outros" no mês`, detalhe: `Combustível, almoço, cursos, carro: ${variaveis.filter((v) => v.categoria === "outros").slice(0, 4).map((v) => `${v.descricao} ${reais(v.valor)}`).join(", ")}. Gasto pessoal no caixa da empresa distorce o resultado.`, valor: outrosNoMes });
  }
  const totalReceber = receberAtrasado.reduce((s, x) => s + x.valor, 0);
  if (totalReceber > 0) {
    alertas.push({ chave: "atrasados_a_receber", nivel: totalReceber > mrr * 0.1 ? "critico" : "atencao", titulo: `${reais(totalReceber)} atrasados para receber`, detalhe: receberAtrasado.slice(0, 4).map((x) => `${x.cliente} ${reais(x.valor)} (${x.dias} ${x.dias === 1 ? "dia" : "dias"})`).join(", "), valor: totalReceber });
  }
  const totalPagar = pagarAtrasado.reduce((s, x) => s + x.valor, 0);
  if (pagarAtrasado.length) {
    alertas.push({ chave: "contas_vencidas", nivel: "atencao", titulo: `${pagarAtrasado.length} conta(s) vencida(s) sem baixa (${reais(totalPagar)})`, detalhe: `${pagarAtrasado.slice(0, 4).map((x) => `${x.descricao} desde ${dataCurta(x.vencimento)}`).join(", ")}. Ou pague e dê baixa, ou cancele a assinatura: conta parada distorce a projeção.`, valor: totalPagar });
  }
  if (abaixoDaEntrada.length && ativos.length) {
    alertas.push({ chave: "precos_abaixo_da_tabela", nivel: "atencao", titulo: `${abaixoDaEntrada.length} de ${ativos.length} clientes pagam abaixo do plano de entrada (${reais(PLANO_DE_ENTRADA.preco)})`, detalhe: `Ticket médio de ${reais(ativos.length ? mrr / ativos.length : 0)}. Levar todos à tabela traria +${reais(reajusteTotal)}/mês.`, valor: reajusteTotal });
  }
  if (maior && maior.parcela > 0.3) {
    alertas.push({ chave: "concentracao", nivel: "atencao", titulo: `${Math.round(maior.parcela * 100)}% da carteira em ${maior.nome}`, detalhe: "Um cliente acima de 30% da receita é risco de dependência.", valor: maior.valor });
  }
  if (impostoGuardado + 0.5 < impostoEstimado) {
    alertas.push({ chave: "imposto_sem_reserva", nivel: "atencao", titulo: `Caixinha do imposto com ${reais(impostoGuardado)}; o mês pede ${reais(impostoEstimado)}`, detalhe: "Imposto não é dinheiro da operação. Separe a diferença antes de gastar.", valor: impostoEstimado - impostoGuardado });
  }
  if (numero(d.caixinhas.safety) <= 0) {
    alertas.push({ chave: "sem_reserva", nivel: "atencao", titulo: "Sem reserva de segurança", detalhe: `A caixinha de reserva está zerada. O Plano Diretor pede ${reais(reservaAlvo)} para emergência.`, valor: reservaAlvo });
  }
  if (travasNoMes.acimaDoLimite > 0) {
    alertas.push({ chave: "passou_do_limite", nivel: "critico", titulo: `Você passou do limite ${travasNoMes.acimaDoLimite} ${travasNoMes.acimaDoLimite === 1 ? "vez" : "vezes"} neste mês`, detalhe: "Cada gasto acima do limite empurra o aperto do caixa para mais perto." });
  }
  if (!alertas.length) {
    alertas.push({ chave: "tudo_em_ordem", nivel: "bom", titulo: "Nada fora do lugar agora", detalhe: "Caixa livre positivo, estrutura paga e nada atrasado." });
  }
  const ordem: Record<Nivel, number> = { critico: 0, atencao: 1, bom: 2 };
  alertas.sort((a, b) => ordem[a.nivel] - ordem[b.nivel]);

  let nota = 100;
  const motivos: string[] = [];
  const tirar = (p: number, m: string) => { nota -= p; motivos.push(m); };
  if (saldoLivre < 0) tirar(25, "caixa livre negativo");
  else if (folegoMeses !== null && folegoMeses < 1) tirar(15, "menos de 1 mês de fôlego");
  else if (folegoMeses !== null && folegoMeses < 3) tirar(8, "menos de 3 meses de fôlego");
  if (margemMensal < 0) tirar(25, "estrutura maior que a carteira");
  else if (mrrOperacional > 0 && margemMensal / mrrOperacional < 0.2) tirar(10, "margem da carteira abaixo de 20%");
  if (totalReceber > mrr * 0.1) tirar(10, "atrasados acima de 10% da carteira");
  if (numero(d.caixinhas.safety) <= 0) tirar(10, "sem reserva de segurança");
  if (maior && maior.parcela > 0.3) tirar(5, "concentração em um cliente");
  if (projecao.some((p) => p.saldoLivreConservador < 0)) tirar(10, "a projeção conservadora fica negativa");
  nota = Math.max(0, Math.min(100, nota));
  const rotulo = nota >= 80 ? "saudável" : nota >= 60 ? "estável" : nota >= 35 ? "frágil" : "crítica";

  // ---- o que fazer neste mês e o que não gastar
  const acoesDoMes: AcaoSugerida[] = [];
  if (receberAtrasado.length) {
    acoesDoMes.push({ chave: "cobrar", titulo: `Cobrar ${reais(totalReceber)} atrasados`, detalhe: `${receberAtrasado.slice(0, 5).map((x) => `${x.cliente} ${reais(x.valor)}`).join(", ")}. Você cobra (WhatsApp ou ligação): o painel não envia cobrança sozinho.`, valor: totalReceber });
  }
  const cortaveis = cortes.filter((c) => !c.essencial);
  if (cortaveis.length && (margemMensal < 0 || saldoLivre < 0)) {
    const tres = cortaveis.slice(0, 3);
    const poupa = tres.reduce((s, c) => s + c.mensal, 0);
    acoesDoMes.push({ chave: "cortar", titulo: `Cortar ${reais(poupa)}/mês em custo fixo`, detalhe: tres.map((c) => `${c.descricao} ${reais(c.mensal)}`).join(", "), valor: poupa });
  }
  if (pagarAtrasado.length) {
    acoesDoMes.push({ chave: "contas_paradas", titulo: "Dar baixa ou cancelar as contas vencidas", detalhe: pagarAtrasado.slice(0, 4).map((x) => `${x.descricao} (${reais(x.valor)})`).join(", "), valor: totalPagar });
  }
  if (abaixoDaEntrada.length) {
    const tres = abaixoDaEntrada.slice(0, 3);
    acoesDoMes.push({ chave: "reajustar", titulo: `Reajustar na renovação: ${tres.map((c) => c.nome).join(", ")}`, detalhe: `Levar à tabela (em degraus, na renovação) traz +${reais(tres.reduce((s, c) => s + c.falta, 0))}/mês só com esses ${tres.length}.`, valor: tres.reduce((s, c) => s + c.falta, 0) });
  }
  const buraco = Math.max(0, -Math.min(0, projecao[Math.min(1, projecao.length - 1)].resultado));
  if (buraco > 0 || faltaEquilibrio > 0) {
    const alvo = Math.max(buraco, faltaEquilibrio);
    const n = Math.ceil(alvo / (AVULSO_DE_ENTRADA.preco * (1 - aliquota)));
    acoesDoMes.push({ chave: "vender", titulo: `Vender ${n} ${AVULSO_DE_ENTRADA.nome} (${reais(AVULSO_DE_ENTRADA.preco)}, à vista)`, detalhe: `Cobre os ${reais(alvo)} que faltam para o mês fechar no azul e abre conversa de plano recorrente.`, valor: n * AVULSO_DE_ENTRADA.preco });
  }
  if (impostoGuardado + 0.5 < impostoEstimado) {
    acoesDoMes.push({ chave: "separar_imposto", titulo: `Separar ${reais(impostoEstimado - impostoGuardado)} para o imposto`, detalhe: "Na caixinha tributária do Fluxo de caixa.", valor: impostoEstimado - impostoGuardado });
  }
  const naoGastar: string[] = [];
  if (limiteQueVale.valor <= 0) naoGastar.push(`Nenhum gasto novo em ${limiteQueVale.rotulo}: o limite está zerado (${limiteQueVale.motivo}).`);
  else naoGastar.push(`Nada acima de ${reais(limiteQueVale.valor)} de gasto novo em ${limiteQueVale.rotulo}.`);
  if (margemMensal < 0 || limiteQueVale.recorrente <= 0) naoGastar.push("Nenhuma assinatura ou custo fixo novo: a carteira ainda não paga a estrutura de hoje.");
  else naoGastar.push(`Custo fixo novo só até ${reais(limiteQueVale.recorrente)}/mês.`);
  if (folegoMeses === null || folegoMeses < 3) naoGastar.push("Cursos, equipamento e mudanças de escritório esperam o fôlego passar de 3 meses.");
  if (proLabore > proLaboreSugerido * 1.1 || adiantamentos.length) naoGastar.push("Nada de adiantamento de pró-labore fora da data.");

  return {
    hoje,
    mesAtual,
    rotuloDoMes: rotuloDoMes(mesAtual),
    diasRestantes,
    aliquota,
    caixa: { saldo: centavos(saldo), caixinhas: centavos(caixinhas), saldoLivre: centavos(saldoLivre), recebidoTotal: centavos(recebidoTotal), pagoTotal: centavos(pagoTotal) },
    mes: {
      recebido: centavos(recebidoMes),
      recebidoOperacional: centavos(recebidoMes * (1 - aliquota)),
      pago: centavos(pagoMes),
      pagoFixo: centavos(pagoFixo),
      pagoVariavel: centavos(pagoVariavel),
      pagoProLabore: centavos(pagoProLabore),
      aReceber: centavos(projecao[0].entradas),
      aPagar: centavos(projecao[0].saidas),
      resultado: centavos(recebidoMes - pagoMes),
      variaveis,
    },
    estrutura: {
      custoFixo: centavos(custoFixo),
      proLabore: centavos(proLabore),
      custoFixoTotal: centavos(custoFixoTotal),
      recorrentes: recorrentes.map((r) => ({ id: r.id, descricao: r.descricao, categoria: r.categoria, mensal: r.mensal })).sort((a, b) => b.mensal - a.mensal),
      assinaturasDeIa: { quantas: ia.length, mensal: centavos(ia.reduce((s, x) => s + x.mensal, 0)), nomes: ia.map((x) => x.descricao) },
    },
    carteira: {
      mrr: centavos(mrr),
      mrrOperacional: centavos(mrrOperacional),
      clientesAtivos: ativos.length,
      ticketMedio: centavos(ativos.length ? mrr / ativos.length : 0),
      maior,
      pausados,
      abaixoDaEntrada,
    },
    margem: { mensal: centavos(margemMensal), percentual: mrrOperacional > 0 ? margemMensal / mrrOperacional : 0 },
    folego: { meses: folegoMeses === null ? null : Math.round(folegoMeses * 10) / 10, texto: folegoTexto },
    atrasados: { receber: receberAtrasado, totalReceber: centavos(totalReceber), pagar: pagarAtrasado, totalPagar: centavos(totalPagar) },
    projecao,
    limite,
    limiteProximo,
    limiteQueVale,
    impostoDoMes: { estimado: impostoEstimado, guardado: centavos(impostoGuardado), falta: centavos(Math.max(0, impostoEstimado - impostoGuardado)) },
    proLaboreDaEscada: proLaboreSugerido,
    saude: { nota, rotulo, motivos },
    alertas,
    acoesDoMes,
    naoGastar,
    cortes,
    plano,
    metas,
    travasNoMes,
  };
}

// ------------------------------------------------------------------ a trava

export type NivelDaTrava = "livre" | "atencao" | "bloqueado";

export interface GastoProposto {
  valor: number;
  /** Repete todo mês (assinatura, custo fixo). */
  recorrente?: boolean;
  /** Mês do gasto ("AAAA-MM"); padrão: o mês que vale para a decisão. */
  mes?: string | null;
  categoria?: string | null;
  descricao?: string | null;
}

export interface AvaliacaoDoGasto {
  nivel: NivelDaTrava;
  valor: number;
  limite: number;
  /** O que sobra do limite depois do gasto (negativo = passou). */
  sobra: number;
  /** Quanto passou do limite (0 quando cabe). */
  excesso: number;
  mes: string;
  rotuloDoMes: string;
  titulo: string;
  motivo: string;
  folegoDepois: number | null;
  saldoNoApertoDepois: number;
  /** Capital (aporte, investimento com dinheiro do sócio) não passa pela trava. */
  foraDaTrava: boolean;
}

/**
 * A TRAVA (regra em código, não da IA): o gasto novo cabe no limite do mês?
 * - bloqueado: passa do limite (ou é custo fixo novo que a carteira não paga).
 *   A tela e o agente exigem confirmação explícita para seguir.
 * - atencao: cabe, mas usa mais da metade do limite ou deixa menos de 1 mês de fôlego.
 * - livre: cabe com folga.
 */
export function avaliarGasto(r: Retrato, g: GastoProposto): AvaliacaoDoGasto {
  const valor = Math.max(0, centavos(numero(g.valor)));
  const recorrente = g.recorrente === true;
  const lim = g.mes && g.mes === r.limiteProximo.mes ? r.limiteProximo : g.mes && g.mes === r.limite.mes ? r.limite : r.limiteQueVale;
  const foraDaTrava = !!g.categoria && ehCapital({ category: g.categoria });
  const teto = recorrente ? lim.recorrente : lim.valor;
  const sobra = centavos(teto - valor);
  const excesso = Math.max(0, centavos(valor - teto));
  // Fôlego depois: o gasto sai do caixa livre agora; o recorrente também engorda a estrutura.
  const estruturaDepois = r.estrutura.custoFixoTotal + (recorrente ? valor : 0);
  const folegoDepois = estruturaDepois > 0 ? Math.round(((r.caixa.saldoLivre - valor) / estruturaDepois) * 10) / 10 : null;
  const saldoNoApertoDepois = centavos(lim.saldoNoAperto - (recorrente ? valor * MESES_DE_PROTECAO_DO_LIMITE : valor));
  let nivel: NivelDaTrava = "livre";
  let motivo = "";
  if (foraDaTrava) {
    nivel = "livre";
    motivo = "Aporte ou investimento com dinheiro do sócio não sai do caixa da operação.";
  } else if (valor > teto + 0.009) {
    nivel = "bloqueado";
    motivo = teto <= 0
      ? `O limite de ${lim.rotulo} está zerado: ${lim.motivo}.`
      : `Passa ${reais(excesso)} do limite de ${reais(teto)}${recorrente ? " por mês" : ""} em ${lim.rotulo}. Com ele, o caixa livre chega a ${reais(saldoNoApertoDepois)} em ${rotuloDoMes(lim.mesDoAperto, true)}.`;
  } else if (valor > teto * 0.5 || (folegoDepois !== null && folegoDepois < 1)) {
    nivel = "atencao";
    motivo = `Cabe, mas usa ${teto > 0 ? Math.round((valor / teto) * 100) : 100}% do limite de ${lim.rotulo}${folegoDepois !== null ? ` e deixa ${String(folegoDepois).replace(".", ",")} mês(es) de fôlego` : ""}.`;
  } else {
    motivo = `Cabe no limite de ${reais(teto)}${recorrente ? " por mês" : ""} em ${lim.rotulo}; sobram ${reais(sobra)}.`;
  }
  const titulo = nivel === "bloqueado" ? "Este gasto passa do limite" : nivel === "atencao" ? "Este gasto cabe, mas aperta" : "Este gasto cabe no limite";
  return { nivel, valor, limite: teto, sobra, excesso, mes: lim.mes, rotuloDoMes: lim.rotulo, titulo, motivo, folegoDepois, saldoNoApertoDepois, foraDaTrava };
}

// ------------------------------------------------------------------ texto do CFO (sem IA)

export type IntencaoDoCFO = "saude" | "projecao" | "posso_gastar" | "onde_cortar" | "este_mes" | "plano" | "lancar" | "meta" | "erros" | "outra";

/**
 * A resposta do CFO escrita só com o retrato (reserva quando a IA não está
 * disponível, e o esqueleto de números que a IA recebe). Sem travessão.
 */
export function respostaDoCFO(r: Retrato, intencao: IntencaoDoCFO, extra: { avaliacao?: AvaliacaoDoGasto | null; valor?: number | null; meses?: number } = {}): string {
  const l = r.limiteQueVale;
  const linhas: string[] = [];
  const cabecaSaude = `Saúde ${r.saude.rotulo} (${r.saude.nota}/100). Caixa ${reais(r.caixa.saldo)}, livre ${reais(r.caixa.saldoLivre)} depois das caixinhas. Carteira ${reais(r.carteira.mrr)}/mês em ${r.carteira.clientesAtivos} clientes; estrutura ${reais(r.estrutura.custoFixoTotal)}/mês com pró-labore. Sobra da carteira: ${reais(r.margem.mensal)}/mês.`;
  if (intencao === "posso_gastar" && extra.avaliacao) {
    const a = extra.avaliacao;
    if (a.nivel === "bloqueado") linhas.push(`Não. ${a.motivo}`);
    else if (a.nivel === "atencao") linhas.push(`Pode, com cuidado. ${a.motivo}`);
    else linhas.push(`Pode. ${a.motivo}`);
    linhas.push(`Limite de ${a.rotuloDoMes}: ${reais(l.valor)} de gasto novo; custo fixo novo até ${reais(l.recorrente)}/mês.`);
    if (a.nivel === "bloqueado") linhas.push(`Se mesmo assim quiser lançar, o painel pede a sua confirmação explícita. Antes disso: ${r.acoesDoMes.slice(0, 2).map((x) => minusculaInicial(x.titulo)).join("; ")}.`);
    if (l.valor <= 0 && l.comCortes > 0) linhas.push(`Cortando ${reais(l.cortesConsiderados)}/mês (os 3 maiores cortes da lista), o limite sobe para ${reais(l.comCortes)}.`);
    return linhas.join("\n");
  }
  if (intencao === "projecao") {
    const n = Math.min(extra.meses || 6, r.projecao.length);
    linhas.push(`Projeção de ${n} meses (saldo livre no fim de cada mês, base e conservador com 15% a menos de entrada):`);
    for (const p of r.projecao.slice(0, n)) linhas.push(`${p.rotulo}: entra ${reais(p.entradas)}, sai ${reais(p.saidas)}, imposto ${reais(p.imposto)}, fica ${reais(p.saldoLivre)} (conservador ${reais(p.saldoLivreConservador)})`);
    const negativo = r.projecao.slice(0, n).filter((p) => p.saldoLivreConservador < 0)[0];
    linhas.push(negativo ? `No conservador, o caixa livre fica negativo em ${negativo.rotulo}.` : "No conservador, o caixa livre não fica negativo no período.");
    return linhas.join("\n");
  }
  if (intencao === "onde_cortar") {
    const cortaveis = r.cortes.filter((c) => !c.essencial);
    if (!cortaveis.length) return "Todos os custos fixos de hoje parecem essenciais. O caminho é receita: veja o plano de crescimento.";
    linhas.push(`Onde cortar (custos fixos que não são essenciais, do maior para o menor):`);
    for (const c of cortaveis.slice(0, 6)) linhas.push(`${c.descricao}: ${reais(c.mensal)}/mês (${reais(c.anual)}/ano). ${c.motivo}.`);
    const tres = cortaveis.slice(0, 3).reduce((s, c) => s + c.mensal, 0);
    linhas.push(`Só os três primeiros devolvem ${reais(tres)}/mês. A estrutura passa de ${reais(r.estrutura.custoFixoTotal)} para ${reais(r.estrutura.custoFixoTotal - tres)}.`);
    return linhas.join("\n");
  }
  if (intencao === "plano") {
    linhas.push("Plano de crescimento, na ordem:");
    r.plano.forEach((m, i) => linhas.push(`${i + 1}. ${m.titulo}: ${m.falta > 0 ? `faltam ${reais(m.falta)}` : "já cumprida"}${m.prazoMeses ? ` em ~${m.prazoMeses} ${m.prazoMeses === 1 ? "mês" : "meses"}` : ""}. ${m.como[0] || ""}`));
    return linhas.join("\n");
  }
  if (intencao === "erros") {
    linhas.push("Onde você está errando hoje:");
    r.alertas.filter((a) => a.nivel !== "bom").slice(0, 6).forEach((a) => linhas.push(`${a.titulo}. ${a.detalhe}`));
    if (linhas.length === 1) linhas.push("Nada fora do lugar agora.");
    return linhas.join("\n");
  }
  if (intencao === "este_mes") {
    linhas.push(`${primeiraMaiuscula(l.rotulo)}: limite de ${reais(l.valor)} para gasto novo (${l.motivo}).`);
    if (l.valor <= 0 && l.comCortes > 0) linhas.push(`Com os 3 maiores cortes (${reais(l.cortesConsiderados)}/mês), o limite sobe para ${reais(l.comCortes)}.`);
    linhas.push("Fazer:");
    r.acoesDoMes.slice(0, 5).forEach((a, i) => linhas.push(`${i + 1}. ${a.titulo}. ${a.detalhe}`));
    linhas.push("Não gastar:");
    r.naoGastar.forEach((x) => linhas.push(`- ${x}`));
    return linhas.join("\n");
  }
  linhas.push(cabecaSaude);
  linhas.push(`Fôlego: ${r.folego.texto}. Limite de ${l.rotulo}: ${reais(l.valor)}.`);
  r.alertas.filter((a) => a.nivel === "critico").slice(0, 3).forEach((a) => linhas.push(`${a.titulo}.`));
  if (r.acoesDoMes.length) linhas.push(`Primeiro passo: ${minusculaInicial(r.acoesDoMes[0].titulo)}.`);
  return linhas.join("\n");
}

/** Os números que a IA recebe (curtos): ela explica, não calcula. */
export function fatosParaAIa(r: Retrato): Record<string, unknown> {
  return {
    hoje: r.hoje,
    mes: r.rotuloDoMes,
    dias_restantes_no_mes: r.diasRestantes,
    saude: r.saude,
    caixa: r.caixa,
    mes_corrente: { recebido: r.mes.recebido, pago: r.mes.pago, pago_fixo: r.mes.pagoFixo, pago_variavel: r.mes.pagoVariavel, pro_labore: r.mes.pagoProLabore, maiores_variaveis: r.mes.variaveis.slice(0, 6) },
    estrutura: { custo_fixo: r.estrutura.custoFixo, pro_labore: r.estrutura.proLabore, total: r.estrutura.custoFixoTotal, assinaturas_de_ia: r.estrutura.assinaturasDeIa },
    carteira: { mrr: r.carteira.mrr, mrr_depois_do_imposto: r.carteira.mrrOperacional, clientes: r.carteira.clientesAtivos, ticket_medio: r.carteira.ticketMedio, maior: r.carteira.maior, abaixo_da_tabela: r.carteira.abaixoDaEntrada.length },
    sobra_mensal_da_carteira: r.margem.mensal,
    folego: r.folego,
    limite_do_mes: r.limiteQueVale,
    atrasados: { receber: r.atrasados.totalReceber, pagar: r.atrasados.totalPagar },
    projecao_6_meses: r.projecao.slice(0, 6).map((p) => ({ mes: p.rotulo, entra: p.entradas, sai: p.saidas, saldo_livre: p.saldoLivre, conservador: p.saldoLivreConservador })),
    alertas: r.alertas.slice(0, 8).map((a) => ({ nivel: a.nivel, titulo: a.titulo })),
    acoes_do_mes: r.acoesDoMes.map((a) => a.titulo),
    nao_gastar: r.naoGastar,
    cortes: r.cortes.filter((c) => !c.essencial).slice(0, 6).map((c) => ({ descricao: c.descricao, mensal: c.mensal })),
    plano: r.plano.map((m) => ({ titulo: m.titulo, falta: m.falta, prazo_meses: m.prazoMeses, como: m.como[0] })),
  };
}

// ------------------------------------------------------------------ valores no texto

/**
 * Candidatos a valor em reais num pedido ("posso gastar 1.500 num curso?",
 * "R$ 2 mil", "350 reais por mês"). O servidor deixa o Jev escolher qual é o
 * gasto quando há mais de um; aqui só se acha e se normaliza.
 */
export function valoresNoTexto(texto: string): Array<{ trecho: string; valor: number }> {
  const t = String(texto || "");
  const re = /(r\$\s*)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?\s*(mil|k)?(\s*reais)?/gi;
  const achados: Array<{ trecho: string; valor: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const temMoeda = !!m[1] || !!m[5] || !!m[4];
    const inteiro = Number(m[2].replace(/\./g, ""));
    let valor = inteiro + (m[3] ? Number(`0.${m[3]}`) : 0);
    if (m[4]) valor *= 1000;
    // Número solto pequeno sem moeda (ex.: "6 meses", "3 clientes") não é valor.
    const depois = t.slice(m.index + m[0].length, m.index + m[0].length + 10).toLowerCase();
    if (!temMoeda && (valor < 20 || /^\s*(mes|mês|meses|dia|dias|cliente|clientes|vez|vezes|%|ano|anos)/.test(depois))) continue;
    if (valor <= 0) continue;
    achados.push({ trecho: m[0].trim(), valor: centavos(valor) });
  }
  return achados;
}

/** Sem Jev: o pedido fala de gasto que se repete? */
export function parecerRecorrente(texto: string): boolean {
  return /(por m[eê]s|mensal|todo m[eê]s|assinatura|\/m[eê]s|recorrente|ao m[eê]s)/i.test(String(texto || ""));
}

/** Sem Jev: a intenção pelas palavras (reserva do roteamento). */
export function intencaoPorPalavras(texto: string): IntencaoDoCFO {
  const t = semAcento(String(texto || "")).toLowerCase();
  if (/(posso gastar|da para gastar|cabe no|consigo pagar|posso pagar|posso comprar|posso contratar|vale gastar)/.test(t)) return "posso_gastar";
  if (/(projec|proximos meses|como fecho|vai sobrar|previs)/.test(t)) return "projecao";
  if (/(corto|cortar|corte|economizar|reduzir custo|enxugar)/.test(t)) return "onde_cortar";
  if (/(plano de crescimento|crescer|meta de|metas|dobrar)/.test(t)) return "plano";
  if (/(errando|erro|onde estou)/.test(t)) return "erros";
  if (/(este mes|esse mes|neste mes|o que fazer|o que eu faco|limite)/.test(t)) return "este_mes";
  if (/(lanc|registr|anot).*(despesa|gasto|saida|conta)/.test(t)) return "lancar";
  if (/(saude|como estou|como esta|resumo|caixa)/.test(t)) return "saude";
  return "outra";
}
