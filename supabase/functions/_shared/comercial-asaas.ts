/**
 * Fechamento direto do Mercúrio pelo Asaas (05/11/2026, dono: "só repassa após o Pix confirmado na conta").
 * Puro: a tabela de planos, a conferência do CPF/CNPJ e as chamadas ao Asaas com o fetch recebido.
 * O valor vem sempre daqui, nunca do texto do modelo de linguagem. Sem Deno e sem banco: a tela e o Vitest leem o mesmo arquivo.
 */

export interface PlanoDeFechamento {
  id: string;
  nome: string;
  mensal: number;
  entrada: number;
  meses: number;
}

/** Tabela do treino do Mercúrio (seção 3). O Start é o valor da frase de preço que o lead ouve: R$ 847 por mês (dono, a confirmar). */
export const PLANOS_DE_FECHAMENTO: PlanoDeFechamento[] = [
  { id: "start_assistido", nome: "Start Assistido", mensal: 847, entrada: 397, meses: 3 },
  { id: "essencial", nome: "Essencial", mensal: 1297, entrada: 497, meses: 6 },
  { id: "presenca", nome: "Presença", mensal: 1997, entrada: 797, meses: 6 },
  { id: "crescimento", nome: "Crescimento", mensal: 2997, entrada: 997, meses: 6 },
  { id: "estrutura", nome: "Estrutura", mensal: 4497, entrada: 1497, meses: 12 },
  { id: "engenharia", nome: "Engenharia / OS", mensal: 6997, entrada: 2497, meses: 12 },
];

export const planoPorId = (id: unknown) => PLANOS_DE_FECHAMENTO.find((p) => p.id === id) || null;

/** O primeiro Pix: entrada mais a primeira mensalidade. */
export const valorDoFechamento = (p: PlanoDeFechamento) => p.entrada + p.mensal;

const digitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

function cpfValido(d: string): boolean {
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  for (const t of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < t; i++) soma += Number(d[i]) * (t + 1 - i);
    if (((soma * 10) % 11) % 10 !== Number(d[t])) return false;
  }
  return true;
}

function cnpjValido(d: string): boolean {
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  for (const t of [12, 13]) {
    let soma = 0;
    let peso = t - 7;
    for (let i = 0; i < t; i++) {
      soma += Number(d[i]) * peso;
      peso = peso === 2 ? 9 : peso - 1;
    }
    const r = soma % 11 < 2 ? 0 : 11 - (soma % 11);
    if (r !== Number(d[t])) return false;
  }
  return true;
}

/** Só os dígitos quando o CPF ou o CNPJ confere; senão, null. */
export function documentoValido(v: unknown): string | null {
  const d = digitos(v);
  return cpfValido(d) || cnpjValido(d) ? d : null;
}

export const baseDoAsaas = (token: string) => (token.includes("_hmlg_") ? "https://api-sandbox.asaas.com" : "https://api.asaas.com");

type Buscar = (url: string, init?: RequestInit) => Promise<Response>;

export class ErroDoAsaas extends Error {
  constructor(public etapa: string, public status: number, mensagem: string) {
    super(`Asaas (${etapa}): ${mensagem}`.slice(0, 300));
  }
}

async function chamar(buscar: Buscar, token: string, etapa: string, caminho: string, corpo?: unknown) {
  const r = await buscar(baseDoAsaas(token) + caminho, {
    method: corpo === undefined ? "GET" : "POST",
    headers: { access_token: token, "User-Agent": "Aceleriq-Comercial/1.0", accept: "application/json", "content-type": "application/json" },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
  });
  const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    const erros = Array.isArray(json.errors) ? (json.errors as Array<{ description?: string }>).map((e) => e.description).filter(Boolean).join("; ") : "";
    throw new ErroDoAsaas(etapa, r.status, erros || `HTTP ${r.status}`);
  }
  return json;
}

export interface PedidoDeCobranca {
  nome: string;
  documento: string;
  email?: string | null;
  telefone?: string | null;
  valor: number;
  descricao: string;
  referencia: string;
  vencimento: string;
}

export interface CobrancaCriada {
  cliente_id: string;
  pagamento_id: string;
  link: string | null;
  pix_copia_e_cola: string | null;
}

/** Cria o cliente no Asaas (ou reaproveita pelo documento), a cobrança Pix e devolve o copia e cola. */
export async function criarCobrancaPix(token: string, buscar: Buscar, p: PedidoDeCobranca): Promise<CobrancaCriada> {
  const achados = await chamar(buscar, token, "cliente", `/v3/customers?cpfCnpj=${encodeURIComponent(p.documento)}&limit=1`);
  const lista = Array.isArray(achados.data) ? (achados.data as Array<{ id?: string }>) : [];
  let clienteId = lista[0]?.id || "";
  if (!clienteId) {
    const novo = await chamar(buscar, token, "cliente", "/v3/customers", {
      name: p.nome, cpfCnpj: p.documento, email: p.email || undefined, mobilePhone: p.telefone || undefined, notificationDisabled: true,
    });
    clienteId = String(novo.id || "");
  }
  if (!clienteId) throw new ErroDoAsaas("cliente", 502, "o Asaas não devolveu o cliente");
  const pag = await chamar(buscar, token, "cobranca", "/v3/payments", {
    customer: clienteId, billingType: "PIX", value: p.valor, dueDate: p.vencimento, description: p.descricao, externalReference: p.referencia,
  });
  const pagamentoId = String(pag.id || "");
  if (!pagamentoId) throw new ErroDoAsaas("cobranca", 502, "o Asaas não devolveu a cobrança");
  let copiaECola: string | null = null;
  try {
    const qr = await chamar(buscar, token, "pix", `/v3/payments/${pagamentoId}/pixQrCode`);
    copiaECola = typeof qr.payload === "string" ? qr.payload : null;
  } catch {
    // Sem o QR, o link da fatura também mostra o Pix.
  }
  return { cliente_id: clienteId, pagamento_id: pagamentoId, link: typeof pag.invoiceUrl === "string" ? pag.invoiceUrl : null, pix_copia_e_cola: copiaECola };
}

/** O aviso só vale depois de confirmar no próprio Asaas que o dinheiro entrou e o valor bate. */
export async function pagamentoConfirmado(token: string, buscar: Buscar, pagamentoId: string, valorEsperado: number): Promise<{ pago: boolean; motivo: string | null; pago_em: string | null }> {
  if (!/^pay_[a-zA-Z0-9_-]{1,100}$/.test(pagamentoId)) return { pago: false, motivo: "pagamento_invalido", pago_em: null };
  const pg = await chamar(buscar, token, "confirmar", `/v3/payments/${pagamentoId}`);
  if (pg.deleted === true) return { pago: false, motivo: "cobranca_apagada", pago_em: null };
  if (String(pg.status) !== "RECEIVED" && String(pg.status) !== "CONFIRMED") return { pago: false, motivo: `status_${String(pg.status)}`, pago_em: null };
  if (Math.abs(Number(pg.value) - valorEsperado) > 0.009) return { pago: false, motivo: "valor_diferente", pago_em: null };
  return { pago: true, motivo: null, pago_em: String(pg.clientPaymentDate || pg.paymentDate || pg.confirmedDate || "") || null };
}
