/**
 * Assinatura do produto CRM e E-mail no Asaas (13/11/2026).
 *
 * O cartão nunca passa por aqui: a assinatura nasce num Checkout hospedado do
 * próprio Asaas (POST /v3/checkouts, recorrente). Daqui sai só o pedido com os
 * itens e o valor; o que confirma o pagamento é o aviso do Asaas, conferido de
 * novo na API antes de valer.
 *
 * Tudo aqui recebe o `buscar` de fora, para o teste rodar sem rede.
 */
import { baseDoAsaas, ErroDoAsaas } from "../../_shared/comercial-asaas.ts";

type Buscar = (url: string, init?: RequestInit) => Promise<Response>;

export interface ItemDaAssinatura {
  chave: string;
  nome: string;
  quantidade: number;
  unitario: number;
  total: number;
}

async function chamar(buscar: Buscar, token: string, etapa: string, metodo: "GET" | "POST" | "PUT" | "DELETE", caminho: string, corpo?: unknown) {
  const r = await buscar(baseDoAsaas(token) + caminho, {
    method: metodo,
    headers: { access_token: token, "User-Agent": "Aceleriq-Produto/1.0", accept: "application/json", "content-type": "application/json" },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
  });
  const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    const erros = Array.isArray(json.errors) ? (json.errors as Array<{ description?: string }>).map((e) => e.description).filter(Boolean).join("; ") : "";
    throw new ErroDoAsaas(etapa, r.status, erros || `HTTP ${r.status}`);
  }
  return json;
}

/** Itens lidos do banco, sem confiar no formato. Linha sem valor fica de fora. */
export function itensValidos(bruto: unknown): ItemDaAssinatura[] {
  if (!Array.isArray(bruto)) return [];
  const saida: ItemDaAssinatura[] = [];
  for (const x of bruto as Array<Record<string, unknown>>) {
    const quantidade = Math.floor(Number(x && x.quantidade));
    const unitario = Math.round(Number(x && x.unitario) * 100) / 100;
    if (!x || !(quantidade > 0) || !(unitario > 0)) continue;
    saida.push({
      chave: String(x.chave || "item").slice(0, 40),
      nome: String(x.nome || "Item").slice(0, 60),
      quantidade,
      unitario,
      total: Math.round(quantidade * unitario * 100) / 100,
    });
  }
  return saida;
}

export const totalDosItens = (itens: ItemDaAssinatura[]) => Math.round(itens.reduce((s, i) => s + i.total, 0) * 100) / 100;

/** A descrição da assinatura numa linha: "CRM Starter x 3 · E-mail profissional". */
export const descricaoDosItens = (itens: ItemDaAssinatura[]) =>
  itens.map((i) => (i.quantidade > 1 ? `${i.nome} x ${i.quantidade}` : i.nome)).join(" · ").slice(0, 150);

/** Dia de vencimento em São Paulo, no formato do Asaas (AAAA-MM-DD). */
export function diaEmSaoPaulo(agora: Date, somarDias = 0): string {
  const d = new Date(agora.getTime() - 3 * 3600 * 1000 + somarDias * 86400 * 1000);
  return d.toISOString().slice(0, 10);
}

/** Acha o cliente no Asaas pelo documento ou cria. */
export async function clienteNoAsaas(token: string, buscar: Buscar, p: { nome: string; documento: string; email?: string | null; telefone?: string | null }): Promise<string> {
  const achados = await chamar(buscar, token, "cliente", "GET", `/v3/customers?cpfCnpj=${encodeURIComponent(p.documento)}&limit=1`);
  const lista = Array.isArray(achados.data) ? (achados.data as Array<{ id?: string }>) : [];
  if (lista[0] && lista[0].id) return String(lista[0].id);
  const novo = await chamar(buscar, token, "cliente", "POST", "/v3/customers", {
    name: p.nome.slice(0, 100),
    cpfCnpj: p.documento,
    email: p.email || undefined,
    mobilePhone: p.telefone || undefined,
  });
  const id = String(novo.id || "");
  if (!id) throw new ErroDoAsaas("cliente", 502, "o Asaas não devolveu o cliente");
  return id;
}

export interface CheckoutCriado {
  id: string;
  link: string;
  expira_em: string;
}

/**
 * Abre o checkout recorrente no cartão. O nome do item cabe em 30 caracteres
 * no Asaas, então vai curto; a descrição leva o detalhe.
 */
export async function criarCheckoutDaAssinatura(token: string, buscar: Buscar, p: {
  /** Vazio só no teste da conexão: o próprio checkout pede os dados de quem paga. */
  clienteId: string;
  itens: ItemDaAssinatura[];
  referencia: string;
  voltarPara: string;
  agora: Date;
  minutos?: number;
}): Promise<CheckoutCriado> {
  if (!p.itens.length) throw new ErroDoAsaas("checkout", 400, "nada para assinar");
  const minutos = Math.max(10, Math.min(1440, p.minutos || 120));
  const corpo = {
    billingTypes: ["CREDIT_CARD"],
    chargeTypes: ["RECURRENT"],
    minutesToExpire: minutos,
    externalReference: p.referencia.slice(0, 200),
    ...(p.clienteId ? { customer: p.clienteId } : {}),
    callback: {
      successUrl: `${p.voltarPara}?pagamento=ok`,
      cancelUrl: `${p.voltarPara}?pagamento=cancelado`,
      expiredUrl: `${p.voltarPara}?pagamento=expirado`,
    },
    items: p.itens.map((i) => ({
      name: i.nome.slice(0, 30),
      description: `${i.nome}, por mês`.slice(0, 150),
      quantity: i.quantidade,
      value: i.unitario,
    })),
    subscription: {
      cycle: "MONTHLY",
      nextDueDate: `${diaEmSaoPaulo(p.agora)} 23:59:59`,
    },
  };
  const r = await chamar(buscar, token, "checkout", "POST", "/v3/checkouts", corpo);
  const id = String(r.id || "");
  const link = typeof r.link === "string" ? r.link : "";
  if (!id || !/^https:\/\//.test(link)) throw new ErroDoAsaas("checkout", 502, "o Asaas não devolveu o link do checkout");
  return { id, link, expira_em: new Date(p.agora.getTime() + minutos * 60 * 1000).toISOString() };
}

export interface AssinaturaNoAsaas {
  id: string;
  cliente_id: string | null;
  estado: string;
  valor: number;
  proximo_vencimento: string | null;
  checkout_id: string | null;
  referencia: string | null;
  apagada: boolean;
}

function lerAssinatura(a: Record<string, unknown>): AssinaturaNoAsaas {
  return {
    id: String(a.id || ""),
    cliente_id: typeof a.customer === "string" ? a.customer : null,
    estado: String(a.status || ""),
    valor: Number(a.value) || 0,
    proximo_vencimento: typeof a.nextDueDate === "string" ? a.nextDueDate.slice(0, 10) : null,
    checkout_id: typeof a.checkoutSession === "string" ? a.checkoutSession : null,
    referencia: typeof a.externalReference === "string" ? a.externalReference : null,
    apagada: a.deleted === true,
  };
}

const ID_DE_ASSINATURA = /^sub_[a-zA-Z0-9_-]{1,100}$/;
const ID_DE_PAGAMENTO = /^pay_[a-zA-Z0-9_-]{1,100}$/;

export async function lerAssinaturaNoAsaas(token: string, buscar: Buscar, id: string): Promise<AssinaturaNoAsaas | null> {
  if (!ID_DE_ASSINATURA.test(id)) return null;
  return lerAssinatura(await chamar(buscar, token, "assinatura", "GET", `/v3/subscriptions/${id}`));
}

/** Muda o valor da assinatura (mais usuários, outro plano). Vale da próxima cobrança em diante. */
export async function mudarValorDaAssinatura(token: string, buscar: Buscar, id: string, p: { valor: number; descricao: string }): Promise<AssinaturaNoAsaas> {
  if (!ID_DE_ASSINATURA.test(id)) throw new ErroDoAsaas("assinatura", 400, "assinatura inválida");
  const r = await chamar(buscar, token, "assinatura", "PUT", `/v3/subscriptions/${id}`, {
    value: p.valor,
    description: p.descricao.slice(0, 500),
    updatePendingPayments: true,
  });
  const lida = lerAssinatura(r);
  // O Asaas responde 200 mesmo quando ignora um campo: só vale se o valor voltou igual.
  if (Math.abs(lida.valor - p.valor) > 0.009) throw new ErroDoAsaas("assinatura", 409, "o Asaas não aceitou o valor novo");
  return lida;
}

export async function cancelarAssinaturaNoAsaas(token: string, buscar: Buscar, id: string): Promise<boolean> {
  if (!ID_DE_ASSINATURA.test(id)) return false;
  const r = await chamar(buscar, token, "cancelar", "DELETE", `/v3/subscriptions/${id}`);
  return r.deleted === true;
}

export interface PagamentoNoAsaas {
  id: string;
  cliente_id: string | null;
  assinatura_id: string | null;
  referencia: string | null;
  estado: string;
  valor: number;
  liquido: number | null;
  vencimento: string | null;
  pago_em: string | null;
  forma: string | null;
  link: string | null;
  descricao: string | null;
  cartao_final: string | null;
  cartao_bandeira: string | null;
  apagado: boolean;
}

export function lerPagamento(p: Record<string, unknown>): PagamentoNoAsaas {
  const cartao = (p.creditCard && typeof p.creditCard === "object" ? p.creditCard : {}) as Record<string, unknown>;
  const dia = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
  const liquido = Number(p.netValue);
  return {
    id: String(p.id || ""),
    cliente_id: typeof p.customer === "string" ? p.customer : null,
    assinatura_id: typeof p.subscription === "string" ? p.subscription : null,
    referencia: typeof p.externalReference === "string" ? p.externalReference : null,
    estado: String(p.status || ""),
    valor: Number(p.value) || 0,
    liquido: isFinite(liquido) && liquido > 0 ? liquido : null,
    vencimento: dia(p.dueDate),
    pago_em: dia(p.clientPaymentDate) || dia(p.paymentDate) || dia(p.confirmedDate),
    forma: typeof p.billingType === "string" ? p.billingType : null,
    link: typeof p.invoiceUrl === "string" ? p.invoiceUrl : null,
    descricao: typeof p.description === "string" ? p.description : null,
    cartao_final: typeof cartao.creditCardNumber === "string" ? cartao.creditCardNumber.replace(/\D/g, "").slice(-4) || null : null,
    cartao_bandeira: typeof cartao.creditCardBrand === "string" ? cartao.creditCardBrand : null,
    apagado: p.deleted === true,
  };
}

export async function lerPagamentoNoAsaas(token: string, buscar: Buscar, id: string): Promise<PagamentoNoAsaas | null> {
  if (!ID_DE_PAGAMENTO.test(id)) return null;
  return lerPagamento(await chamar(buscar, token, "pagamento", "GET", `/v3/payments/${id}`));
}

/** Cobrança avulsa (a migração do e-mail): o cliente escolhe Pix, boleto ou cartão na fatura do Asaas. */
export async function criarCobrancaAvulsa(token: string, buscar: Buscar, p: { clienteId: string; valor: number; descricao: string; referencia: string; vencimento: string }): Promise<PagamentoNoAsaas> {
  const r = await chamar(buscar, token, "cobranca", "POST", "/v3/payments", {
    customer: p.clienteId,
    billingType: "UNDEFINED",
    value: p.valor,
    dueDate: p.vencimento,
    description: p.descricao.slice(0, 500),
    externalReference: p.referencia.slice(0, 200),
  });
  const lido = lerPagamento(r);
  if (!lido.id) throw new ErroDoAsaas("cobranca", 502, "o Asaas não devolveu a cobrança");
  return lido;
}

/** O estado da cobrança no produto, a partir do status do Asaas. */
export function estadoDaCobranca(status: string, apagado = false): "aberta" | "paga" | "atrasada" | "estornada" | "cancelada" {
  if (apagado) return "cancelada";
  if (status === "RECEIVED" || status === "CONFIRMED" || status === "RECEIVED_IN_CASH") return "paga";
  if (status === "OVERDUE") return "atrasada";
  if (status === "REFUNDED" || status === "REFUND_REQUESTED" || status === "REFUND_IN_PROGRESS" || status === "CHARGEBACK_REQUESTED" || status === "CHARGEBACK_DISPUTE") return "estornada";
  return "aberta";
}

/** A referência que liga a cobrança do Asaas à empresa: "conta:<uuid>" ou "conta:<uuid>:migracao". */
export function contaDaReferencia(ref: string | null | undefined): { contaId: string; tipo: "mensalidade" | "migracao" } | null {
  const m = /^conta:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(:migracao)?$/i.exec(String(ref || ""));
  return m ? { contaId: m[1].toLowerCase(), tipo: m[2] ? "migracao" : "mensalidade" } : null;
}
