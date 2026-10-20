/**
 * Vendas pelo checkout do gateway do cliente (Laboratório v4, ESPEC seção 5,
 * opção (a), decisão do dono em 19/10/2026): conferir a assinatura de cada
 * gateway e traduzir o evento dele num evento único do painel.
 *
 * Puro: só Web Crypto (crypto.subtle) e TextEncoder, que existem no Deno, no
 * Node do vitest e no navegador. Sem banco, sem env, sem log. A função
 * vendas-webhook usa; os testes de supabase/functions/vendas-webhook usam.
 *
 * Como cada gateway prova que o aviso é dele (documentação pública, 19/10):
 * - Hotmart (webhook 2.0.0): cabeçalho X-HOTMART-HOTTOK com o hottok da conta.
 *   O hottok é da Hotmart; guardamos só o hash SHA-256 e comparamos o hash.
 * - Asaas: cabeçalho asaas-access-token com o authToken que o dono cadastra no
 *   webhook. O painel gera o token (48 hex, 32 a 255 caracteres como o Asaas
 *   pede), mostra uma vez e guarda só o hash.
 * - Stripe: cabeçalho Stripe-Signature "t=...,v1=..." com HMAC SHA-256 de
 *   "<t>.<corpo cru>" pelo segredo do endpoint (whsec_...), tolerância de 300 s.
 * - Mercado Pago: cabeçalho x-signature "ts=...,v1=..." com HMAC SHA-256 do
 *   manifesto "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" pela chave
 *   secreta da aplicação (parte ausente sai do manifesto; data.id alfanumérico
 *   vai em minúsculas).
 * - Kiwify: "signature" (40 hex) na busca do endereço ou na raiz do JSON, HMAC
 *   SHA-1 pelo token do webhook. A Kiwify não publica o que entra na conta: o
 *   formato vem dos integradores. Aceitamos o corpo cru ou o objeto "order";
 *   qualquer um exige o token, então errar o formato só recusa, nunca deixa
 *   passar. Confirmar com uma compra de teste.
 *
 * O que entra no banco: só o resumo (tipo, valor, moeda, produto, contato do
 * comprador e meia dúzia de campos de estado). Dado de cartão nunca é lido.
 */

// ------------------------------------------------------------------ catálogo

export const GATEWAYS = ["hotmart", "kiwify", "stripe", "mercado_pago", "asaas"] as const;
export type Gateway = (typeof GATEWAYS)[number];
export const ehGateway = (v: unknown): v is Gateway => typeof v === "string" && (GATEWAYS as readonly string[]).indexOf(v) >= 0;

export const NOME_DO_GATEWAY: Record<Gateway, string> = {
  hotmart: "Hotmart",
  kiwify: "Kiwify",
  stripe: "Stripe",
  mercado_pago: "Mercado Pago",
  asaas: "Asaas",
};

/** token: o gateway manda o segredo e comparamos o hash. hmac: precisamos do segredo para recalcular a assinatura (fica no Vault). */
export const VALIDACAO_DO_GATEWAY: Record<Gateway, "token" | "hmac"> = {
  hotmart: "token",
  asaas: "token",
  stripe: "hmac",
  kiwify: "hmac",
  mercado_pago: "hmac",
};

/** Gateways em que o painel gera o segredo (mostra uma vez). Nos outros, o dono cola o segredo que o gateway mostrou. */
export const SEGREDO_GERADO_PELO_PAINEL: Record<Gateway, boolean> = { hotmart: false, kiwify: false, stripe: false, mercado_pago: false, asaas: true };

/** Chave de API do cliente (só leitura) para completar o evento: Mercado Pago (obrigatória) e Asaas (opcional, traz o e-mail). */
export const TOKEN_API_DO_GATEWAY: Record<Gateway, "obrigatorio" | "opcional" | "nao"> = {
  hotmart: "nao",
  kiwify: "nao",
  stripe: "nao",
  mercado_pago: "obrigatorio",
  asaas: "opcional",
};

export const TIPOS_DE_EVENTO = [
  "compra_aprovada",
  "compra_recusada",
  "pix_gerado",
  "boleto_gerado",
  "pagamento_expirado",
  "carrinho_abandonado",
  "reembolso",
  "chargeback",
  "cancelamento",
  "assinatura_renovada",
  "assinatura_atrasada",
  "assinatura_cancelada",
] as const;
export type TipoDeEvento = (typeof TIPOS_DE_EVENTO)[number];

/** Chave pública da integração (vai no endereço): 32 hex, gerada no banco. */
export const CHAVE_DA_INTEGRACAO = /^[a-f0-9]{32}$/;

export type EventoDeVenda = {
  idExterno: string;
  tipo: TipoDeEvento;
  valor: number | null;
  moeda: string | null;
  produto: string | null;
  email: string | null;
  nome: string | null;
  whatsapp: string | null;
  resumo: Record<string, string | number | boolean>;
};

// ------------------------------------------------------------------ cripto

const codificar = (s: string) => new TextEncoder().encode(s);

function juntarBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const r = new Uint8Array(a.length + b.length);
  r.set(a, 0);
  r.set(b, a.length);
  return r;
}

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");

export async function hmacHex(algoritmo: "SHA-1" | "SHA-256", segredo: string, mensagem: string | Uint8Array): Promise<string> {
  const chave = await crypto.subtle.importKey("raw", codificar(segredo), { name: "HMAC", hash: algoritmo }, false, ["sign"]);
  const dados = typeof mensagem === "string" ? codificar(mensagem) : mensagem;
  return hex(await crypto.subtle.sign("HMAC", chave, dados as BufferSource));
}

export async function sha256Hex(texto: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", codificar(texto)));
}

/** Compara sem sair cedo: o tempo não diz quantos caracteres bateram. */
export function iguaisEmTempoConstante(a: string, b: string): boolean {
  const x = codificar(String(a));
  const y = codificar(String(b));
  let diferenca = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diferenca |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diferenca === 0;
}

// ------------------------------------------------------------------ conferência da assinatura

export type PedidoDoGateway = {
  /** Cabeçalhos do pedido (Headers ou parecido: get com nome em qualquer caixa). */
  cabecalhos: { get(nome: string): string | null };
  busca: URLSearchParams;
  /** Corpo cru, byte a byte, como chegou (a assinatura é sobre ele). */
  corpo: Uint8Array;
  /** O corpo já lido como JSON (null quando não é JSON). */
  json: unknown;
};

export type SegredosDaIntegracao = {
  /** SHA-256 hex do token (Hotmart, Asaas). */
  segredoHash: string | null;
  /** Segredo de assinatura (Stripe, Kiwify, Mercado Pago), lido do Vault. */
  segredo: string | null;
};

export type Conferencia = { ok: true } | { ok: false; motivo: "sem_segredo" | "sem_assinatura" | "assinatura_invalida" | "fora_do_prazo" };

export const TOLERANCIA_STRIPE_S = 300;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const txt = (v: unknown, max = 200): string => (typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, max) : "");

async function conferirToken(recebido: string | null, segredoHash: string | null): Promise<Conferencia> {
  if (!segredoHash) return { ok: false, motivo: "sem_segredo" };
  const token = String(recebido || "").trim();
  if (!token || token.length > 512) return { ok: false, motivo: "sem_assinatura" };
  return iguaisEmTempoConstante(await sha256Hex(token), segredoHash.toLowerCase()) ? { ok: true } : { ok: false, motivo: "assinatura_invalida" };
}

/** Lê "a=1,b=2,b=3" (Stripe-Signature, x-signature) em pares; a mesma chave pode repetir. */
export function lerPares(cabecalho: string | null): Array<[string, string]> {
  const pares: Array<[string, string]> = [];
  for (const parte of String(cabecalho || "").split(",")) {
    const i = parte.indexOf("=");
    if (i <= 0) continue;
    pares.push([parte.slice(0, i).trim(), parte.slice(i + 1).trim()]);
  }
  return pares;
}

export async function conferirStripe(p: PedidoDoGateway, s: SegredosDaIntegracao, agoraMs = Date.now(), toleranciaS = TOLERANCIA_STRIPE_S): Promise<Conferencia> {
  if (!s.segredo) return { ok: false, motivo: "sem_segredo" };
  const pares = lerPares(p.cabecalhos.get("stripe-signature"));
  const t = pares.filter(([k]) => k === "t").map(([, v]) => v)[0] || "";
  const assinaturas = pares.filter(([k]) => k === "v1").map(([, v]) => v.toLowerCase());
  if (!/^\d{9,11}$/.test(t) || !assinaturas.length) return { ok: false, motivo: "sem_assinatura" };
  if (Math.abs(Math.floor(agoraMs / 1000) - Number(t)) > toleranciaS) return { ok: false, motivo: "fora_do_prazo" };
  const esperado = await hmacHex("SHA-256", s.segredo, juntarBytes(codificar(`${t}.`), p.corpo));
  let bateu = false;
  for (const a of assinaturas) if (iguaisEmTempoConstante(a, esperado)) bateu = true;
  return bateu ? { ok: true } : { ok: false, motivo: "assinatura_invalida" };
}

/** Manifesto do Mercado Pago: só as partes presentes, nesta ordem. */
export function manifestoMercadoPago(dataId: string, requestId: string, ts: string): string {
  let m = "";
  if (dataId) m += `id:${/^[A-Za-z0-9]+$/.test(dataId) ? dataId.toLowerCase() : dataId};`;
  if (requestId) m += `request-id:${requestId};`;
  if (ts) m += `ts:${ts};`;
  return m;
}

export function dataIdDoMercadoPago(p: Pick<PedidoDoGateway, "busca" | "json">): string {
  return txt(p.busca.get("data.id") ?? p.busca.get("id") ?? obj(obj(p.json).data).id, 64);
}

export async function conferirMercadoPago(p: PedidoDoGateway, s: SegredosDaIntegracao): Promise<Conferencia> {
  if (!s.segredo) return { ok: false, motivo: "sem_segredo" };
  const pares = lerPares(p.cabecalhos.get("x-signature"));
  const ts = pares.filter(([k]) => k === "ts").map(([, v]) => v)[0] || "";
  const v1 = (pares.filter(([k]) => k === "v1").map(([, v]) => v)[0] || "").toLowerCase();
  if (!ts || !/^[a-f0-9]{64}$/.test(v1)) return { ok: false, motivo: "sem_assinatura" };
  const manifesto = manifestoMercadoPago(dataIdDoMercadoPago(p), txt(p.cabecalhos.get("x-request-id"), 200), ts);
  const esperado = await hmacHex("SHA-256", s.segredo, manifesto);
  return iguaisEmTempoConstante(v1, esperado) ? { ok: true } : { ok: false, motivo: "assinatura_invalida" };
}

export async function conferirKiwify(p: PedidoDoGateway, s: SegredosDaIntegracao): Promise<Conferencia> {
  if (!s.segredo) return { ok: false, motivo: "sem_segredo" };
  const raiz = obj(p.json);
  const assinatura = String(p.busca.get("signature") || (typeof raiz.signature === "string" ? raiz.signature : "")).trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(assinatura)) return { ok: false, motivo: "sem_assinatura" };
  const candidatos: Array<string | Uint8Array> = [p.corpo];
  if (raiz.order && typeof raiz.order === "object") candidatos.push(JSON.stringify(raiz.order));
  let bateu = false;
  for (const c of candidatos) if (iguaisEmTempoConstante(assinatura, await hmacHex("SHA-1", s.segredo, c))) bateu = true;
  return bateu ? { ok: true } : { ok: false, motivo: "assinatura_invalida" };
}

export function conferirAssinatura(gateway: Gateway, p: PedidoDoGateway, s: SegredosDaIntegracao, agoraMs = Date.now()): Promise<Conferencia> {
  switch (gateway) {
    case "hotmart":
      return conferirToken(p.cabecalhos.get("x-hotmart-hottok"), s.segredoHash);
    case "asaas":
      return conferirToken(p.cabecalhos.get("asaas-access-token"), s.segredoHash);
    case "stripe":
      return conferirStripe(p, s, agoraMs);
    case "mercado_pago":
      return conferirMercadoPago(p, s);
    case "kiwify":
      return conferirKiwify(p, s);
  }
}

// ------------------------------------------------------------------ contato do comprador

export function emailValido(v: unknown): string | null {
  const s = String(v ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(s) && s.length <= 120 ? s : null;
}

/** Mesma régua do formulário do site (site-lancamento.ts): só dígitos, com 55 no Brasil. */
export function whatsappValido(v: unknown): string | null {
  const bruto = String(v ?? "").trim();
  if (!bruto) return null;
  const internacional = bruto.charAt(0) === "+";
  let d = bruto.replace(/\D/g, "");
  if (d.indexOf("00") === 0) d = d.slice(2);
  if (!internacional && (d.length === 10 || d.length === 11)) d = `55${d}`;
  if (d.indexOf("55") === 0) return d.length === 12 || d.length === 13 ? d : null;
  return internacional && d.length >= 8 && d.length <= 15 ? d : null;
}

const nomeLimpo = (v: unknown): string | null => {
  const s = txt(v, 120).replace(/\s+/g, " ");
  return s && s.indexOf("<") < 0 ? s : null;
};

const valorDe = (v: unknown, divisor = 1): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round((n / divisor) * 100) / 100;
};

const moedaDe = (v: unknown): string | null => {
  const s = txt(v, 3).toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : null;
};

const idDe = (v: unknown, max = 120): string | null => {
  const s = txt(v, max);
  return s && /^[A-Za-z0-9_.:@-]+$/.test(s) ? s : null;
};

function evento(base: Omit<EventoDeVenda, "resumo"> & { resumo?: Record<string, unknown> }): EventoDeVenda {
  const resumo: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(base.resumo || {})) {
    if (typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) resumo[k] = v;
    else if (typeof v === "string" && v.trim()) resumo[k] = v.trim().slice(0, 120);
  }
  return { ...base, idExterno: base.idExterno.slice(0, 200), resumo };
}

// ------------------------------------------------------------------ Hotmart

const HOTMART: Record<string, TipoDeEvento | "aguardando"> = {
  PURCHASE_APPROVED: "compra_aprovada",
  PURCHASE_BILLET_PRINTED: "aguardando",
  PURCHASE_CANCELED: "cancelamento",
  PURCHASE_REFUNDED: "reembolso",
  PURCHASE_CHARGEBACK: "chargeback",
  PURCHASE_EXPIRED: "pagamento_expirado",
  PURCHASE_DELAYED: "pagamento_expirado",
  PURCHASE_OUT_OF_SHOPPING_CART: "carrinho_abandonado",
  SUBSCRIPTION_CANCELLATION: "assinatura_cancelada",
};

export function normalizarHotmart(json: unknown): EventoDeVenda | null {
  const raiz = obj(json);
  const nomeDoEvento = txt(raiz.event, 60).toUpperCase();
  let tipo = HOTMART[nomeDoEvento];
  if (!tipo) return null;
  const data = obj(raiz.data);
  const compra = obj(data.purchase);
  const comprador = obj(data.buyer);
  const produto = obj(data.product);
  const metodo = txt(obj(compra.payment).type, 30).toUpperCase();
  const assinatura = Object.keys(obj(data.subscription)).length > 0;
  if (tipo === "aguardando") tipo = metodo === "PIX" ? "pix_gerado" : "boleto_gerado";
  if (nomeDoEvento === "PURCHASE_DELAYED" && assinatura) tipo = "assinatura_atrasada";
  const transacao = idDe(compra.transaction);
  const idDoAviso = idDe(raiz.id);
  const idExterno = transacao ? `${transacao}:${tipo}` : idDoAviso ? `aviso:${idDoAviso}` : "";
  if (!idExterno) return null;
  const preco = obj(compra.price);
  return evento({
    idExterno,
    tipo,
    valor: valorDe(preco.value),
    moeda: moedaDe(preco.currency_value),
    produto: idDe(produto.id) ?? idDe(produto.ucode),
    email: emailValido(comprador.email),
    nome: nomeLimpo(comprador.name),
    whatsapp: whatsappValido(comprador.checkout_phone ?? comprador.phone),
    resumo: { evento: nomeDoEvento, status: txt(compra.status, 30), metodo, transacao: transacao || "", produto_nome: txt(produto.name, 120), assinatura },
  });
}

// ------------------------------------------------------------------ Kiwify

const KIWIFY_EVENTO: Record<string, TipoDeEvento | "aguardando"> = {
  order_approved: "compra_aprovada",
  order_rejected: "compra_recusada",
  order_refunded: "reembolso",
  chargeback: "chargeback",
  order_chargeback: "chargeback",
  pix_created: "pix_gerado",
  billet_created: "boleto_gerado",
  subscription_canceled: "assinatura_cancelada",
  subscription_late: "assinatura_atrasada",
  subscription_renewed: "assinatura_renovada",
};

const KIWIFY_STATUS: Record<string, TipoDeEvento | "aguardando"> = {
  paid: "compra_aprovada",
  approved: "compra_aprovada",
  refused: "compra_recusada",
  refunded: "reembolso",
  chargedback: "chargeback",
  waiting_payment: "aguardando",
};

export function normalizarKiwify(json: unknown): EventoDeVenda | null {
  const raiz = obj(json);
  const pedido = raiz.order && typeof raiz.order === "object" ? obj(raiz.order) : raiz;
  // Carrinho abandonado vem noutro formato: sem order_id, com status "abandoned".
  if (!pedido.order_id && txt(pedido.status, 30).toLowerCase() === "abandoned") {
    const id = idDe(pedido.id);
    if (!id) return null;
    return evento({
      idExterno: `carrinho:${id}`,
      tipo: "carrinho_abandonado",
      valor: null,
      moeda: null,
      produto: idDe(pedido.product_id),
      email: emailValido(pedido.email),
      nome: nomeLimpo(pedido.name),
      whatsapp: whatsappValido(pedido.phone),
      resumo: { evento: "carrinho_abandonado", produto_nome: txt(pedido.product_name, 120) },
    });
  }
  const ordem = idDe(pedido.order_id);
  if (!ordem) return null;
  const evNome = txt(pedido.webhook_event_type, 60).toLowerCase();
  const status = txt(pedido.order_status, 30).toLowerCase();
  let tipo = KIWIFY_EVENTO[evNome] ?? KIWIFY_STATUS[status];
  if (!tipo) return null;
  const metodo = txt(pedido.payment_method, 30).toLowerCase();
  if (tipo === "aguardando") {
    if (metodo === "pix") tipo = "pix_gerado";
    else if (metodo === "boleto" || metodo === "billet") tipo = "boleto_gerado";
    else return null;
  }
  const cliente = obj(pedido.Customer);
  const produto = obj(pedido.Product);
  const comissoes = obj(pedido.Commissions);
  return evento({
    idExterno: `${ordem}:${tipo}`,
    tipo,
    valor: valorDe(comissoes.charge_amount, 100),
    moeda: moedaDe(comissoes.currency) ?? "BRL",
    produto: idDe(produto.product_id),
    email: emailValido(cliente.email),
    nome: nomeLimpo(cliente.full_name ?? cliente.first_name),
    whatsapp: whatsappValido(cliente.mobile),
    resumo: { evento: evNome || status, status, metodo, produto_nome: txt(produto.product_name, 120) },
  });
}

// ------------------------------------------------------------------ Stripe

const SEM_CENTAVOS = ["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"];

export function normalizarStripe(json: unknown): EventoDeVenda | null {
  const ev = obj(json);
  const idDoEvento = idDe(ev.id);
  const nomeDoEvento = txt(ev.type, 80);
  const o = obj(obj(ev.data).object);
  if (!idDoEvento || !nomeDoEvento) return null;
  let tipo: TipoDeEvento | null = null;
  let quantia: unknown = o.amount_total;
  const metodos = Array.isArray(o.payment_method_types) ? (o.payment_method_types as unknown[]).map((m) => String(m)) : [];
  switch (nomeDoEvento) {
    case "checkout.session.completed":
      if (o.payment_status === "paid" || o.payment_status === "no_payment_required") tipo = "compra_aprovada";
      else if (metodos.indexOf("pix") >= 0) tipo = "pix_gerado";
      else if (metodos.indexOf("boleto") >= 0) tipo = "boleto_gerado";
      break;
    case "checkout.session.async_payment_succeeded":
      tipo = "compra_aprovada";
      break;
    case "checkout.session.async_payment_failed":
      tipo = "compra_recusada";
      break;
    case "checkout.session.expired":
      tipo = "carrinho_abandonado";
      break;
    case "charge.refunded":
      tipo = "reembolso";
      quantia = o.amount_refunded;
      break;
    case "charge.dispute.created":
      tipo = "chargeback";
      quantia = o.amount;
      break;
    case "invoice.paid":
      if (o.billing_reason === "subscription_cycle") tipo = "assinatura_renovada";
      quantia = o.amount_paid;
      break;
    case "invoice.payment_failed":
      tipo = "assinatura_atrasada";
      quantia = o.amount_due;
      break;
    case "customer.subscription.deleted":
      tipo = "assinatura_cancelada";
      quantia = null;
      break;
  }
  if (!tipo) return null;
  const moedaMin = txt(o.currency, 3).toLowerCase();
  const detalhes = obj(o.customer_details);
  const cobranca = obj(o.billing_details);
  const email = emailValido(detalhes.email ?? o.customer_email ?? o.receipt_email ?? cobranca.email);
  // Carrinho expirado sem contato não serve para recuperação: fica de fora.
  if (tipo === "carrinho_abandonado" && !email) return null;
  return evento({
    idExterno: idDoEvento,
    tipo,
    valor: quantia == null ? null : valorDe(quantia, SEM_CENTAVOS.indexOf(moedaMin) >= 0 ? 1 : 100),
    moeda: moedaDe(moedaMin),
    produto: idDe(o.payment_link) ?? idDe(obj(o.metadata).produto),
    email,
    nome: nomeLimpo(detalhes.name ?? cobranca.name ?? o.customer_name),
    whatsapp: whatsappValido(detalhes.phone ?? cobranca.phone ?? o.customer_phone),
    resumo: { evento: nomeDoEvento, status: txt(o.payment_status ?? o.status, 30), objeto: txt(o.id, 80), ambiente: ev.livemode === true ? "producao" : "teste" },
  });
}

// ------------------------------------------------------------------ Mercado Pago

/** O aviso do Mercado Pago só traz o id: os dados vêm de GET /v1/payments/{id} com a chave do cliente. */
export function idDoPagamentoMercadoPago(p: Pick<PedidoDoGateway, "busca" | "json">): string | null {
  const raiz = obj(p.json);
  const tipo = txt(raiz.type ?? p.busca.get("type") ?? p.busca.get("topic"), 40);
  if (tipo !== "payment") return null;
  const id = dataIdDoMercadoPago(p);
  return /^\d{1,30}$/.test(id) ? id : null;
}

export function normalizarMercadoPago(pagamento: unknown): EventoDeVenda | null {
  const pg = obj(pagamento);
  const id = idDe(pg.id);
  if (!id) return null;
  const status = txt(pg.status, 30);
  const metodo = txt(pg.payment_method_id, 30).toLowerCase();
  const tipoDoMetodo = txt(pg.payment_type_id, 30).toLowerCase();
  let tipo: TipoDeEvento | null = null;
  if (status === "approved") tipo = "compra_aprovada";
  else if (status === "rejected") tipo = "compra_recusada";
  else if (status === "refunded") tipo = "reembolso";
  else if (status === "charged_back") tipo = "chargeback";
  else if (status === "cancelled") tipo = "cancelamento";
  else if (status === "pending" || status === "in_process") {
    if (metodo === "pix") tipo = "pix_gerado";
    else if (tipoDoMetodo === "ticket") tipo = "boleto_gerado";
  }
  if (!tipo) return null;
  const pagador = obj(pg.payer);
  const fone = obj(pagador.phone);
  const telefone = txt(fone.area_code, 4) + txt(fone.number, 20);
  const itens = Array.isArray(obj(pg.additional_info).items) ? (obj(pg.additional_info).items as unknown[]) : [];
  const nome = [txt(pagador.first_name, 60), txt(pagador.last_name, 60)].filter(Boolean).join(" ");
  return evento({
    idExterno: `${id}:${tipo}`,
    tipo,
    valor: valorDe(pg.transaction_amount),
    moeda: moedaDe(pg.currency_id),
    produto: idDe(obj(itens[0]).id) ?? idDe(pg.external_reference),
    email: emailValido(pagador.email),
    nome: nomeLimpo(nome),
    whatsapp: whatsappValido(telefone),
    resumo: { evento: "payment", status, metodo, ambiente: pg.live_mode === false ? "teste" : "producao" },
  });
}

// ------------------------------------------------------------------ Asaas

export function clienteDoAsaas(json: unknown): string | null {
  const c = txt(obj(obj(json).payment).customer ?? obj(obj(json).subscription).customer, 60);
  return /^cus_[A-Za-z0-9]{1,50}$/.test(c) ? c : null;
}

export function normalizarAsaas(json: unknown, cliente?: unknown): EventoDeVenda | null {
  const raiz = obj(json);
  const nomeDoEvento = txt(raiz.event, 60).toUpperCase();
  const pg = obj(raiz.payment);
  const assinatura = obj(raiz.subscription);
  const metodo = txt(pg.billingType, 20).toUpperCase();
  let tipo: TipoDeEvento | null = null;
  switch (nomeDoEvento) {
    case "PAYMENT_CREATED":
      tipo = metodo === "PIX" ? "pix_gerado" : metodo === "BOLETO" ? "boleto_gerado" : null;
      break;
    case "PAYMENT_CONFIRMED":
    case "PAYMENT_RECEIVED":
      tipo = "compra_aprovada";
      break;
    case "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED":
    case "PAYMENT_REPROVED_BY_RISK_ANALYSIS":
      tipo = "compra_recusada";
      break;
    case "PAYMENT_OVERDUE":
      tipo = pg.subscription ? "assinatura_atrasada" : "pagamento_expirado";
      break;
    case "PAYMENT_REFUNDED":
      tipo = "reembolso";
      break;
    case "PAYMENT_CHARGEBACK_REQUESTED":
      tipo = "chargeback";
      break;
    case "PAYMENT_DELETED":
      tipo = "cancelamento";
      break;
    case "SUBSCRIPTION_DELETED":
    case "SUBSCRIPTION_INACTIVATED":
      tipo = "assinatura_cancelada";
      break;
  }
  if (!tipo) return null;
  const base = tipo === "assinatura_cancelada" ? assinatura : pg;
  const id = idDe(base.id);
  if (!id) return null;
  const c = obj(cliente);
  return evento({
    idExterno: `${id}:${tipo}`,
    tipo,
    valor: valorDe(base.value),
    moeda: "BRL",
    produto: idDe(base.externalReference) ?? idDe(pg.subscription),
    email: emailValido(c.email),
    nome: nomeLimpo(c.name),
    whatsapp: whatsappValido(c.mobilePhone ?? c.phone),
    resumo: { evento: nomeDoEvento, status: txt(base.status, 30), metodo },
  });
}

export function normalizar(gateway: Exclude<Gateway, "mercado_pago" | "asaas">, json: unknown): EventoDeVenda | null {
  if (gateway === "hotmart") return normalizarHotmart(json);
  if (gateway === "kiwify") return normalizarKiwify(json);
  return normalizarStripe(json);
}
