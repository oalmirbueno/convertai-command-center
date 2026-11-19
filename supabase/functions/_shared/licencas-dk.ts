/**
 * Licenças da plataforma DK Sorteios no Asaas da Aceleriq (19/11/2026, interno, só admin).
 *
 * A plataforma DK cria as faturas das licenças (gerente R$ 597, afiliado e blogueiro R$ 397) com a chave do Asaas
 * da Aceleriq e confere cada uma por consulta, sem webhook. Aqui o painel lê essas mesmas faturas no Asaas e guarda
 * cada pagamento uma vez só (pelo id do pagamento), com bruto, taxa e líquido.
 *
 * Puro: sem Deno e sem banco. A Edge Function, a tela e o Vitest leem o mesmo arquivo.
 */

type Buscar = (url: string, init?: RequestInit) => Promise<Response>;

/** Como a plataforma DK marca as faturas de licença. As duas marcas precisam bater. */
export const PREFIXO_DA_REFERENCIA = "LIC";
export const INICIO_DA_DESCRICAO = "Infraestrutura, servidor e suporte da plataforma";

/** Situações do Asaas que contam como dinheiro recebido (cartão confirmado ainda vai cair na conta). */
const RECEBIDOS = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"] as const;
/** Situações que desfazem um recebimento: o lançamento fica, marcado como estornado, fora dos totais. */
const ESTORNOS = ["REFUNDED", "CHARGEBACK_REQUESTED", "CHARGEBACK_DISPUTE", "AWAITING_CHARGEBACK_REVERSAL"] as const;
export const SITUACOES_LIDAS: readonly string[] = [...RECEBIDOS, ...ESTORNOS];

export type Situacao = "recebido" | "confirmado" | "estornado";

export interface PagamentoDoAsaas {
  id?: unknown;
  status?: unknown;
  value?: unknown;
  netValue?: unknown;
  billingType?: unknown;
  externalReference?: unknown;
  description?: unknown;
  dateCreated?: unknown;
  paymentDate?: unknown;
  clientPaymentDate?: unknown;
  confirmedDate?: unknown;
  deleted?: unknown;
}

/** O lançamento de entrada, como fica em public.licencas_dk_pagamentos (a taxa o banco calcula: bruto - líquido). */
export interface Lancamento {
  asaas_pagamento_id: string;
  cliente_id: string | null;
  referencia: string;
  descricao: string;
  forma: string;
  situacao: Situacao;
  bruto: number;
  liquido: number;
  pago_em: string | null;
  recebido_em: string;
  criado_no_asaas: string | null;
}

const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const dia = (v: unknown) => (/^\d{4}-\d{2}-\d{2}/.test(texto(v)) ? texto(v).slice(0, 10) : null);
const centavos = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(texto(v).replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};

/** É fatura de licença da DK? A referência começa com LIC e a descrição com a frase da plataforma. */
export function ehLicencaDk(p: PagamentoDoAsaas): boolean {
  return (
    p.deleted !== true &&
    /^pay_[A-Za-z0-9_-]{1,100}$/.test(texto(p.id)) &&
    texto(p.externalReference).toUpperCase().startsWith(PREFIXO_DA_REFERENCIA) &&
    texto(p.description).toLowerCase().startsWith(INICIO_DA_DESCRICAO.toLowerCase())
  );
}

export function situacaoDoAsaas(status: unknown): Situacao | null {
  const s = texto(status).toUpperCase();
  if (s === "RECEIVED" || s === "RECEIVED_IN_CASH") return "recebido";
  if (s === "CONFIRMED") return "confirmado";
  if ((ESTORNOS as readonly string[]).includes(s)) return "estornado";
  return null;
}

/**
 * O pagamento do Asaas virando lançamento. Devolve null quando não é licença DK, não foi pago ou os valores não
 * fecham (líquido maior que o bruto, negativo ou ausente): nesse caso nada é gravado e o próximo ciclo tenta de novo.
 */
export function lancamentoDoPagamento(p: PagamentoDoAsaas, clienteId: string | null): Lancamento | null {
  if (!ehLicencaDk(p)) return null;
  const situacao = situacaoDoAsaas(p.status);
  if (!situacao) return null;
  const bruto = centavos(p.value);
  const liquido = centavos(p.netValue ?? p.value);
  if (!(bruto > 0) || !(liquido >= 0) || liquido > bruto) return null;
  const pagoEm = dia(p.clientPaymentDate) || dia(p.confirmedDate);
  // A data do recebimento: o dia em que o dinheiro entra na conta (paymentDate); no cartão confirmado e ainda não
  // creditado, o dia em que o cliente pagou.
  const recebidoEm = dia(p.paymentDate) || pagoEm || dia(p.dateCreated);
  if (!recebidoEm) return null;
  return {
    asaas_pagamento_id: texto(p.id),
    cliente_id: clienteId,
    referencia: texto(p.externalReference).slice(0, 120),
    descricao: texto(p.description).slice(0, 500),
    forma: texto(p.billingType).toUpperCase() || "UNDEFINED",
    situacao,
    bruto,
    liquido,
    pago_em: pagoEm,
    recebido_em: recebidoEm,
    criado_no_asaas: dia(p.dateCreated),
  };
}

export const baseDoAsaas = (token: string) => (token.includes("_hmlg_") ? "https://api-sandbox.asaas.com" : "https://api.asaas.com");

export class ErroDoAsaas extends Error {
  constructor(public status: number, mensagem: string) {
    super(`Asaas: ${mensagem}`.slice(0, 300));
  }
}

const POR_PAGINA = 100;
const MAX_PAGINAS = 50;

/** Lê no Asaas todos os pagamentos de uma situação (desde a data de criação dada), página por página. */
export async function listarPorSituacao(token: string, buscar: Buscar, status: string, desde: string | null): Promise<PagamentoDoAsaas[]> {
  const todos: PagamentoDoAsaas[] = [];
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const q = new URLSearchParams({ status, limit: String(POR_PAGINA), offset: String(pagina * POR_PAGINA) });
    if (desde) q.set("dateCreated[ge]", desde);
    const r = await buscar(`${baseDoAsaas(token)}/v3/payments?${q.toString()}`, {
      method: "GET",
      headers: { access_token: token, "User-Agent": "Aceleriq-Financeiro/1.0", accept: "application/json" },
    });
    const json = (await r.json().catch(() => ({}))) as { data?: unknown; hasMore?: unknown; errors?: Array<{ description?: string }> };
    if (!r.ok) throw new ErroDoAsaas(r.status, (json.errors || []).map((e) => e.description).filter(Boolean).join("; ") || `HTTP ${r.status}`);
    const lista = Array.isArray(json.data) ? (json.data as PagamentoDoAsaas[]) : [];
    todos.push(...lista);
    if (json.hasMore !== true || lista.length === 0) break;
  }
  return todos;
}

export interface Resumo {
  lidos: number;
  licencas: number;
  gravados: number;
  ignorados: number;
}

/**
 * Uma rodada: lê no Asaas as faturas pagas, confirmadas e estornadas, filtra as licenças DK e grava todas pelo
 * id do pagamento (gravar faz upsert; rodar duas vezes dá o mesmo resultado).
 */
export async function sincronizarLicencas(opcoes: {
  token: string;
  buscar: Buscar;
  clienteId: string | null;
  desde: string | null;
  gravar: (linhas: Lancamento[]) => Promise<void>;
}): Promise<Resumo> {
  const vistos = new Map<string, Lancamento>();
  let lidos = 0;
  let licencas = 0;
  for (const status of SITUACOES_LIDAS) {
    const lista = await listarPorSituacao(opcoes.token, opcoes.buscar, status, opcoes.desde);
    lidos += lista.length;
    for (const p of lista) {
      if (!ehLicencaDk(p)) continue;
      licencas++;
      const l = lancamentoDoPagamento(p, opcoes.clienteId);
      if (l) vistos.set(l.asaas_pagamento_id, l);
    }
  }
  const linhas = [...vistos.values()];
  if (linhas.length) await opcoes.gravar(linhas);
  return { lidos, licencas, gravados: linhas.length, ignorados: licencas - linhas.length };
}

/** A data de corte da rodada automática: faturas criadas nos últimos `dias` dias (a licença é mensal). */
export function desdeDias(dias: number, agora = Date.now()): string {
  return new Date(agora - dias * 86_400_000).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* Leitura da tela: totais por mês e a lista.                          */
/* ------------------------------------------------------------------ */

export interface LinhaGravada {
  asaas_pagamento_id: string;
  forma: string;
  situacao: Situacao;
  bruto: number | string;
  liquido: number | string;
  taxa?: number | string | null;
  recebido_em: string;
  pago_em?: string | null;
  referencia?: string | null;
  descricao?: string | null;
}

export interface Mes {
  mes: string; // AAAA-MM
  pagamentos: number;
  bruto: number;
  taxas: number;
  liquido: number;
  estornados: number;
}

const soma = (a: number, b: number) => Math.round((a + b) * 100) / 100;

/** Totais por mês do recebimento, do mais recente para o mais antigo. Estornos ficam fora dos valores. */
export function totaisPorMes(linhas: readonly LinhaGravada[]): Mes[] {
  const meses = new Map<string, Mes>();
  for (const l of linhas) {
    const mes = String(l.recebido_em).slice(0, 7);
    const m = meses.get(mes) || { mes, pagamentos: 0, bruto: 0, taxas: 0, liquido: 0, estornados: 0 };
    if (l.situacao === "estornado") m.estornados++;
    else {
      const bruto = Number(l.bruto);
      const liquido = Number(l.liquido);
      m.pagamentos++;
      m.bruto = soma(m.bruto, bruto);
      m.liquido = soma(m.liquido, liquido);
      m.taxas = soma(m.taxas, Math.round((bruto - liquido) * 100) / 100);
    }
    meses.set(mes, m);
  }
  return [...meses.values()].sort((a, b) => b.mes.localeCompare(a.mes));
}

export const ROTULO_DA_FORMA: Record<string, string> = {
  PIX: "Pix",
  CREDIT_CARD: "Cartão de crédito",
  DEBIT_CARD: "Cartão de débito",
  BOLETO: "Boleto",
  UNDEFINED: "A definir",
};

export const rotuloDaForma = (forma: string) => ROTULO_DA_FORMA[String(forma).toUpperCase()] || forma;
