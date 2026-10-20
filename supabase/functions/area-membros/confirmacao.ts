/** Conciliação de leitura. Eventos recebidos não são prova de pagamento. Sem SDK novo. */
export type EstadoPagamento =
  "pendente" | "pago" | "reembolsado" | "contestado";
export type Confirmacao = {
  pedido: string;
  produto: string;
  email: string;
  estado: EstadoPagamento;
};
export type Buscar = (url: string, init: RequestInit) => Promise<Response>;
const objeto = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const str = (v: unknown) => (typeof v === "string" ? v : "");
export async function confirmarAsaas(
  pedido: string,
  token: string,
  buscar: Buscar,
): Promise<Confirmacao> {
  if (!/^pay_[a-zA-Z0-9_-]{1,100}$/.test(pedido))
    throw new Error("pedido_invalido");
  if (!token) throw new Error("configuracao_pendente");
  const base = token.includes("_hmlg_")
    ? "https://api-sandbox.asaas.com"
    : "https://api.asaas.com";
  const headers = {
    access_token: token,
    "User-Agent": "Aceleriq-Membros/1.0",
    accept: "application/json",
  };
  const resposta = await buscar(`${base}/v3/payments/${pedido}`, {
    method: "GET",
    headers,
  });
  if (!resposta.ok) throw new Error("provedor_indisponivel");
  const pg = objeto(await resposta.json());
  if (pg.id !== pedido || !/^cus_[a-zA-Z0-9_-]{1,100}$/.test(str(pg.customer)))
    throw new Error("confirmacao_incompleta");
  const estados: Record<string, EstadoPagamento> = {
    RECEIVED: "pago",
    CONFIRMED: "pago",
    REFUNDED: "reembolsado",
    CHARGEBACK_REQUESTED: "contestado",
    CHARGEBACK_DISPUTE: "contestado",
    AWAITING_CHARGEBACK_REVERSAL: "contestado",
    PENDING: "pendente",
    OVERDUE: "pendente",
    AWAITING_RISK_ANALYSIS: "pendente",
  };
  const estado = estados[str(pg.status)];
  // Cancelamento, reembolso parcial, débito autorizado etc. exigem regra explícita: não inferir.
  if (!estado || pg.deleted === true) throw new Error("estado_exige_revisao");
  const produto = str(pg.externalReference) || str(pg.subscription);
  if (!produto || produto.length > 120) throw new Error("produto_sem_vinculo");
  const cliente = await buscar(`${base}/v3/customers/${str(pg.customer)}`, {
    method: "GET",
    headers,
  });
  if (!cliente.ok) throw new Error("comprador_nao_confirmado");
  const c = objeto(await cliente.json());
  const email = str(c.email).trim().toLowerCase();
  if (
    c.id !== pg.customer ||
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ||
    email.length > 254
  )
    throw new Error("comprador_nao_confirmado");
  return { pedido, produto, email, estado };
}
export function autorizaDownload(permitido: boolean, pedido: boolean): boolean {
  return !pedido || permitido;
}
