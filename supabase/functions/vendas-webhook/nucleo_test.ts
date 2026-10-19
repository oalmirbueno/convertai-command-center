/**
 * vendas-webhook: assinatura de cada gateway (válida, inválida, repetida),
 * normalização e idempotência, sem rede e sem banco (porta falsa).
 *
 *   deno test supabase/functions/vendas-webhook/nucleo_test.ts
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  conferirAssinatura,
  type EventoDeVenda,
  type Gateway,
  hmacHex,
  iguaisEmTempoConstante,
  manifestoMercadoPago,
  normalizarAsaas,
  normalizarHotmart,
  normalizarKiwify,
  normalizarMercadoPago,
  normalizarStripe,
  type PedidoDoGateway,
  sha256Hex,
} from "../_shared/vendas-gateways.ts";
import { type IntegracaoParaWebhook, type PortaDeVendas, receberWebhook, rotaDoWebhook } from "./nucleo.ts";

const CHAVE = "0123456789abcdef0123456789abcdef";
const AGORA = 1_760_900_000_000;

function pedido(corpo: unknown, cab: Record<string, string> = {}, busca = ""): PedidoDoGateway {
  const texto = typeof corpo === "string" ? corpo : JSON.stringify(corpo);
  let json: unknown = null;
  try {
    json = JSON.parse(texto);
  } catch {
    json = null;
  }
  return { cabecalhos: new Headers(cab), busca: new URLSearchParams(busca), corpo: new TextEncoder().encode(texto), json };
}

/** Porta falsa: banco em memória com o único (integração, id externo) e rede só para as APIs esperadas. */
function portaFalsa(integ: Partial<IntegracaoParaWebhook> & { gateway: Gateway }, respostas: Record<string, unknown> = {}) {
  const gravados = new Map<string, EventoDeVenda>();
  const urls: string[] = [];
  const falhas: string[] = [];
  const integracao: IntegracaoParaWebhook = { id: "int-1", client_id: null, ativo: true, segredo_hash: null, segredo: null, token_api: null, ...integ };
  const porta: PortaDeVendas = {
    integracao: (g, c) => Promise.resolve(g === integracao.gateway && c === CHAVE ? integracao : null),
    registrar: (id, e) => {
      const k = `${id}|${e.idExterno}`;
      if (gravados.has(k)) return Promise.resolve({ ok: true, duplicado: true });
      gravados.set(k, e);
      return Promise.resolve({ ok: true, evento_id: `ev-${gravados.size}` });
    },
    buscar: (url) => {
      urls.push(url);
      const corpo = respostas[url];
      if (corpo === undefined) return Promise.reject(new Error(`rede inesperada: ${url}`));
      return Promise.resolve(new Response(JSON.stringify(corpo), { status: 200 }));
    },
    falha: (onde) => {
      falhas.push(onde);
    },
  };
  return { porta, gravados, urls, falhas };
}

// ------------------------------------------------------------------ utilitários

Deno.test("rota: só /vendas-webhook/<gateway>/<chave de 32 hex>", () => {
  assertEquals(rotaDoWebhook(`/vendas-webhook/hotmart/${CHAVE}`), { gateway: "hotmart", chave: CHAVE });
  assertEquals(rotaDoWebhook(`/functions/v1/vendas-webhook/mercado_pago/${CHAVE}`), { gateway: "mercado_pago", chave: CHAVE });
  assertEquals(rotaDoWebhook(`/vendas-webhook/paypal/${CHAVE}`), null);
  assertEquals(rotaDoWebhook("/vendas-webhook/hotmart/ABC"), null);
  assertEquals(rotaDoWebhook("/vendas-webhook"), null);
});

Deno.test("comparação em tempo constante: igual, diferente e tamanhos diferentes", () => {
  assert(iguaisEmTempoConstante("abc", "abc"));
  assert(!iguaisEmTempoConstante("abc", "abd"));
  assert(!iguaisEmTempoConstante("abc", "abcd"));
  assert(!iguaisEmTempoConstante("", "a"));
});

// ------------------------------------------------------------------ Hotmart

const HOTMART_APROVADA = {
  id: "aviso-1",
  creation_date: 1760899000000,
  event: "PURCHASE_APPROVED",
  version: "2.0.0",
  data: {
    product: { id: 123456, name: "Curso X" },
    buyer: { email: "Ana@Exemplo.com", name: "Ana Souza", checkout_phone: "11987654321" },
    purchase: { transaction: "HP1234567890", status: "APPROVED", price: { value: 197, currency_value: "BRL" }, payment: { type: "CREDIT_CARD" } },
  },
};

Deno.test("Hotmart: hottok certo passa, errado e ausente recusam (só o hash fica guardado)", async () => {
  const hash = await sha256Hex("hottok-da-conta-123");
  const s = { segredoHash: hash, segredo: null };
  assertEquals(await conferirAssinatura("hotmart", pedido(HOTMART_APROVADA, { "X-HOTMART-HOTTOK": "hottok-da-conta-123" }), s), { ok: true });
  assertEquals(await conferirAssinatura("hotmart", pedido(HOTMART_APROVADA, { "X-HOTMART-HOTTOK": "outro" }), s), { ok: false, motivo: "assinatura_invalida" });
  assertEquals(await conferirAssinatura("hotmart", pedido(HOTMART_APROVADA), s), { ok: false, motivo: "sem_assinatura" });
  assertEquals(await conferirAssinatura("hotmart", pedido(HOTMART_APROVADA, { "X-HOTMART-HOTTOK": "x" }), { segredoHash: null, segredo: null }), { ok: false, motivo: "sem_segredo" });
});

Deno.test("Hotmart: normaliza compra, Pix aguardando e carrinho abandonado", () => {
  const e = normalizarHotmart(HOTMART_APROVADA)!;
  assertEquals(e.tipo, "compra_aprovada");
  assertEquals(e.idExterno, "HP1234567890:compra_aprovada");
  assertEquals(e.valor, 197);
  assertEquals(e.moeda, "BRL");
  assertEquals(e.email, "ana@exemplo.com");
  assertEquals(e.whatsapp, "5511987654321");
  assertEquals(e.produto, "123456");
  const pix = normalizarHotmart({ ...HOTMART_APROVADA, event: "PURCHASE_BILLET_PRINTED", data: { ...HOTMART_APROVADA.data, purchase: { ...HOTMART_APROVADA.data.purchase, payment: { type: "PIX" } } } })!;
  assertEquals(pix.tipo, "pix_gerado");
  const carrinho = normalizarHotmart({ id: "aviso-9", event: "PURCHASE_OUT_OF_SHOPPING_CART", data: { product: { id: 1 }, buyer: { email: "b@c.com", name: "B" } } })!;
  assertEquals(carrinho.tipo, "carrinho_abandonado");
  assertEquals(carrinho.idExterno, "aviso:aviso-9");
  assertEquals(normalizarHotmart({ ...HOTMART_APROVADA, event: "PURCHASE_COMPLETE" }), null);
});

Deno.test("Hotmart ponta a ponta: grava, repetido não duplica, hottok errado é 401", async () => {
  const f = portaFalsa({ gateway: "hotmart", segredo_hash: await sha256Hex("hottok-da-conta-123") });
  const rota = { gateway: "hotmart" as const, chave: CHAVE };
  const p = pedido(HOTMART_APROVADA, { "x-hotmart-hottok": "hottok-da-conta-123" });
  assertEquals(await receberWebhook(f.porta, rota, p, AGORA), { status: 200, corpo: { ok: true, duplicado: false, tipo: "compra_aprovada" } });
  assertEquals(await receberWebhook(f.porta, rota, p, AGORA), { status: 200, corpo: { ok: true, duplicado: true, tipo: "compra_aprovada" } });
  assertEquals(f.gravados.size, 1);
  const ruim = await receberWebhook(f.porta, rota, pedido(HOTMART_APROVADA, { "x-hotmart-hottok": "falso" }), AGORA);
  assertEquals(ruim.status, 401);
  assertEquals(f.gravados.size, 1);
});

// ------------------------------------------------------------------ Stripe

const STRIPE_SESSAO = {
  id: "evt_1Abc",
  type: "checkout.session.completed",
  livemode: false,
  data: {
    object: {
      id: "cs_test_1",
      amount_total: 19700,
      currency: "brl",
      payment_status: "paid",
      payment_link: "plink_1Xyz",
      customer_details: { email: "carla@exemplo.com", name: "Carla", phone: "+5521999998888" },
      payment_method_types: ["card"],
    },
  },
};

async function assinarStripe(corpo: string, segredo: string, t: number) {
  return `t=${t},v1=${await hmacHex("SHA-256", segredo, `${t}.${corpo}`)}`;
}

Deno.test("Stripe: assinatura válida, inválida, fora do prazo e com duas v1 (troca de segredo)", async () => {
  const segredo = "whsec_teste_123456";
  const texto = JSON.stringify(STRIPE_SESSAO);
  const t = Math.floor(AGORA / 1000);
  const s = { segredoHash: null, segredo };
  assertEquals(await conferirAssinatura("stripe", pedido(texto, { "Stripe-Signature": await assinarStripe(texto, segredo, t) }), s, AGORA), { ok: true });
  assertEquals(await conferirAssinatura("stripe", pedido(texto, { "Stripe-Signature": await assinarStripe(texto, "whsec_outro_999", t) }), s, AGORA), { ok: false, motivo: "assinatura_invalida" });
  // Corpo mexido depois de assinado.
  assertEquals(await conferirAssinatura("stripe", pedido(texto.replace("19700", "1"), { "Stripe-Signature": await assinarStripe(texto, segredo, t) }), s, AGORA), { ok: false, motivo: "assinatura_invalida" });
  // Repetição antiga (mais de 5 minutos): recusada mesmo com assinatura certa.
  assertEquals(await conferirAssinatura("stripe", pedido(texto, { "Stripe-Signature": await assinarStripe(texto, segredo, t - 301) }), s, AGORA), { ok: false, motivo: "fora_do_prazo" });
  const duas = `t=${t},v1=${"0".repeat(64)},v1=${await hmacHex("SHA-256", segredo, `${t}.${texto}`)}`;
  assertEquals(await conferirAssinatura("stripe", pedido(texto, { "Stripe-Signature": duas }), s, AGORA), { ok: true });
  assertEquals(await conferirAssinatura("stripe", pedido(texto, {}), s, AGORA), { ok: false, motivo: "sem_assinatura" });
});

Deno.test("Stripe: normaliza sessão paga, Pix pendente, reembolso e ignora evento fora da lista", () => {
  const e = normalizarStripe(STRIPE_SESSAO)!;
  assertEquals([e.tipo, e.valor, e.moeda, e.email, e.whatsapp, e.produto, e.idExterno], ["compra_aprovada", 197, "BRL", "carla@exemplo.com", "5521999998888", "plink_1Xyz", "evt_1Abc"]);
  assertEquals(e.resumo.ambiente, "teste");
  const pix = normalizarStripe({ ...STRIPE_SESSAO, data: { object: { ...STRIPE_SESSAO.data.object, payment_status: "unpaid", payment_method_types: ["pix"] } } })!;
  assertEquals(pix.tipo, "pix_gerado");
  const reembolso = normalizarStripe({ id: "evt_2", type: "charge.refunded", data: { object: { amount_refunded: 5000, currency: "brl", billing_details: { email: "x@y.com" } } } })!;
  assertEquals([reembolso.tipo, reembolso.valor], ["reembolso", 50]);
  assertEquals(normalizarStripe({ id: "evt_3", type: "customer.created", data: { object: {} } }), null);
  // Carrinho expirado sem e-mail não serve para recuperação.
  assertEquals(normalizarStripe({ id: "evt_4", type: "checkout.session.expired", data: { object: { currency: "brl" } } }), null);
});

Deno.test("Stripe ponta a ponta: repetido é idempotente", async () => {
  const segredo = "whsec_teste_123456";
  const f = portaFalsa({ gateway: "stripe", segredo });
  const texto = JSON.stringify(STRIPE_SESSAO);
  const p = pedido(texto, { "stripe-signature": await assinarStripe(texto, segredo, Math.floor(AGORA / 1000)) });
  const rota = { gateway: "stripe" as const, chave: CHAVE };
  assertEquals((await receberWebhook(f.porta, rota, p, AGORA)).corpo.duplicado, false);
  assertEquals((await receberWebhook(f.porta, rota, p, AGORA)).corpo.duplicado, true);
  assertEquals(f.gravados.size, 1);
});

// ------------------------------------------------------------------ Kiwify

const KIWIFY_PEDIDO = {
  order_id: "kw-ordem-1",
  order_status: "paid",
  webhook_event_type: "order_approved",
  payment_method: "credit_card",
  Product: { product_id: "prod-9", product_name: "Mentoria" },
  Customer: { email: "davi@exemplo.com", full_name: "Davi Lima", mobile: "+5531988887777" },
  Commissions: { charge_amount: 49700, currency: "BRL" },
};

Deno.test("Kiwify: signature na busca (corpo cru) ou na raiz (objeto order); errada e ausente recusam", async () => {
  const token = "kiwify-token-abc";
  const s = { segredoHash: null, segredo: token };
  const texto = JSON.stringify(KIWIFY_PEDIDO);
  const sig = await hmacHex("SHA-1", token, texto);
  assertEquals(await conferirAssinatura("kiwify", pedido(texto, {}, `signature=${sig}`), s), { ok: true });
  assertEquals(await conferirAssinatura("kiwify", pedido(texto, {}, `signature=${"a".repeat(40)}`), s), { ok: false, motivo: "assinatura_invalida" });
  assertEquals(await conferirAssinatura("kiwify", pedido(texto), s), { ok: false, motivo: "sem_assinatura" });
  const envelope = { signature: await hmacHex("SHA-1", token, JSON.stringify(KIWIFY_PEDIDO)), url: "https://x", order: KIWIFY_PEDIDO };
  assertEquals(await conferirAssinatura("kiwify", pedido(envelope), s), { ok: true });
  assertEquals(await conferirAssinatura("kiwify", pedido({ ...envelope, order: { ...KIWIFY_PEDIDO, order_status: "refunded" } }), s), { ok: false, motivo: "assinatura_invalida" });
});

Deno.test("Kiwify: normaliza compra (centavos), Pix aguardando e carrinho abandonado", () => {
  const e = normalizarKiwify(KIWIFY_PEDIDO)!;
  assertEquals([e.tipo, e.valor, e.moeda, e.email, e.whatsapp, e.produto, e.idExterno], ["compra_aprovada", 497, "BRL", "davi@exemplo.com", "5531988887777", "prod-9", "kw-ordem-1:compra_aprovada"]);
  const pix = normalizarKiwify({ order: { ...KIWIFY_PEDIDO, webhook_event_type: "", order_status: "waiting_payment", payment_method: "pix" } })!;
  assertEquals(pix.tipo, "pix_gerado");
  const carrinho = normalizarKiwify({ id: "cart-1", status: "abandoned", email: "e@f.com", name: "E", phone: "11999990000", product_id: "prod-9" })!;
  assertEquals([carrinho.tipo, carrinho.idExterno, carrinho.whatsapp], ["carrinho_abandonado", "carrinho:cart-1", "5511999990000"]);
});

Deno.test("Kiwify ponta a ponta: repetido é idempotente", async () => {
  const token = "kiwify-token-abc";
  const f = portaFalsa({ gateway: "kiwify", segredo: token });
  const texto = JSON.stringify(KIWIFY_PEDIDO);
  const p = pedido(texto, {}, `signature=${await hmacHex("SHA-1", token, texto)}`);
  const rota = { gateway: "kiwify" as const, chave: CHAVE };
  assertEquals((await receberWebhook(f.porta, rota, p)).status, 200);
  assertEquals((await receberWebhook(f.porta, rota, p)).corpo.duplicado, true);
  assertEquals(f.gravados.size, 1);
});

// ------------------------------------------------------------------ Mercado Pago

const MP_PAGAMENTO = {
  id: 1234567890,
  status: "approved",
  payment_method_id: "pix",
  payment_type_id: "bank_transfer",
  transaction_amount: 89.9,
  currency_id: "BRL",
  live_mode: true,
  payer: { email: "eva@exemplo.com", first_name: "Eva", last_name: "Reis", phone: { area_code: "41", number: "999990000" } },
  additional_info: { items: [{ id: "oferta-1" }] },
};

async function assinarMp(segredo: string, dataId: string, requestId: string, ts: string) {
  return `ts=${ts},v1=${await hmacHex("SHA-256", segredo, manifestoMercadoPago(dataId, requestId, ts))}`;
}

Deno.test("Mercado Pago: manifesto com partes ausentes e id alfanumérico em minúsculas", () => {
  assertEquals(manifestoMercadoPago("123", "req-1", "1700"), "id:123;request-id:req-1;ts:1700;");
  assertEquals(manifestoMercadoPago("ABC1", "", "1700"), "id:abc1;ts:1700;");
});

Deno.test("Mercado Pago: x-signature válida, inválida e de outro pagamento", async () => {
  const segredo = "mp-segredo-xyz";
  const s = { segredoHash: null, segredo };
  const corpo = { type: "payment", action: "payment.updated", data: { id: "1234567890" } };
  const cab = { "x-signature": await assinarMp(segredo, "1234567890", "req-77", "1760900000"), "x-request-id": "req-77" };
  assertEquals(await conferirAssinatura("mercado_pago", pedido(corpo, cab, "data.id=1234567890&type=payment"), s), { ok: true });
  assertEquals(await conferirAssinatura("mercado_pago", pedido(corpo, { ...cab, "x-request-id": "req-78" }, "data.id=1234567890&type=payment"), s), { ok: false, motivo: "assinatura_invalida" });
  // Assinatura de um pagamento reaproveitada para outro id.
  assertEquals(await conferirAssinatura("mercado_pago", pedido(corpo, cab, "data.id=999&type=payment"), s), { ok: false, motivo: "assinatura_invalida" });
  assertEquals(await conferirAssinatura("mercado_pago", pedido(corpo, {}, "data.id=1234567890"), s), { ok: false, motivo: "sem_assinatura" });
});

Deno.test("Mercado Pago ponta a ponta: lê o pagamento pela API do cliente, repetido não duplica, sem chave de API pede reenvio", async () => {
  const segredo = "mp-segredo-xyz";
  const url = "https://api.mercadopago.com/v1/payments/1234567890";
  const f = portaFalsa({ gateway: "mercado_pago", segredo, token_api: "APP_USR-token" }, { [url]: MP_PAGAMENTO });
  const corpo = { type: "payment", action: "payment.updated", data: { id: "1234567890" } };
  const p = pedido(corpo, { "x-signature": await assinarMp(segredo, "1234567890", "r1", "1760900000"), "x-request-id": "r1" }, "data.id=1234567890&type=payment");
  const rota = { gateway: "mercado_pago" as const, chave: CHAVE };
  assertEquals(await receberWebhook(f.porta, rota, p), { status: 200, corpo: { ok: true, duplicado: false, tipo: "compra_aprovada" } });
  assertEquals((await receberWebhook(f.porta, rota, p)).corpo.duplicado, true);
  assertEquals(f.urls, [url, url]);
  const e = [...f.gravados.values()][0];
  assertEquals([e.valor, e.email, e.whatsapp, e.produto, e.nome], [89.9, "eva@exemplo.com", "5541999990000", "oferta-1", "Eva Reis"]);
  const semToken = portaFalsa({ gateway: "mercado_pago", segredo });
  assertEquals((await receberWebhook(semToken.porta, rota, p)).status, 503);
  assertEquals(normalizarMercadoPago({ ...MP_PAGAMENTO, status: "pending" })!.tipo, "pix_gerado");
});

// ------------------------------------------------------------------ Asaas

const ASAAS_RECEBIDO = {
  id: "evt_05b708f9",
  event: "PAYMENT_RECEIVED",
  dateCreated: "2026-10-19 10:00:00",
  payment: { object: "payment", id: "pay_080225913252", customer: "cus_000005219613", value: 150, billingType: "PIX", status: "RECEIVED" },
};

Deno.test("Asaas: asaas-access-token certo passa, errado recusa", async () => {
  const token = "a".repeat(8) + "0123456789abcdef0123456789abcdef0123456789";
  const s = { segredoHash: await sha256Hex(token), segredo: null };
  assertEquals(await conferirAssinatura("asaas", pedido(ASAAS_RECEBIDO, { "asaas-access-token": token }), s), { ok: true });
  assertEquals(await conferirAssinatura("asaas", pedido(ASAAS_RECEBIDO, { "asaas-access-token": token + "x" }), s), { ok: false, motivo: "assinatura_invalida" });
});

Deno.test("Asaas ponta a ponta: CONFIRMED e RECEIVED do mesmo pagamento viram uma compra só; e-mail pela API quando há chave", async () => {
  const token = "token-gerado-pelo-painel-0123456789abcdef0123";
  const url = "https://api.asaas.com/v3/customers/cus_000005219613";
  const f = portaFalsa({ gateway: "asaas", segredo_hash: await sha256Hex(token), token_api: "$aact_prod_abc" }, { [url]: { name: "Fábio", email: "fabio@exemplo.com", mobilePhone: "47999991111" } });
  const rota = { gateway: "asaas" as const, chave: CHAVE };
  const cab = { "asaas-access-token": token };
  assertEquals((await receberWebhook(f.porta, rota, pedido({ ...ASAAS_RECEBIDO, event: "PAYMENT_CONFIRMED" }, cab))).corpo, { ok: true, duplicado: false, tipo: "compra_aprovada" });
  assertEquals((await receberWebhook(f.porta, rota, pedido(ASAAS_RECEBIDO, cab))).corpo.duplicado, true);
  const e = [...f.gravados.values()][0];
  assertEquals([e.email, e.whatsapp, e.valor], ["fabio@exemplo.com", "5547999991111", 150]);
  // Sem chave de API: grava sem contato (não chama a rede).
  const semApi = normalizarAsaas({ ...ASAAS_RECEBIDO, event: "PAYMENT_CREATED" })!;
  assertEquals([semApi.tipo, semApi.email], ["pix_gerado", null]);
});

// ------------------------------------------------------------------ casos gerais

Deno.test("integração desligada ou de outro gateway: 404 sem ler o corpo", async () => {
  const f = portaFalsa({ gateway: "hotmart", ativo: false, segredo_hash: await sha256Hex("t") });
  assertEquals((await receberWebhook(f.porta, { gateway: "hotmart", chave: CHAVE }, pedido(HOTMART_APROVADA, { "x-hotmart-hottok": "t" }))).status, 404);
  const g = portaFalsa({ gateway: "stripe" });
  assertEquals((await receberWebhook(g.porta, { gateway: "hotmart", chave: CHAVE }, pedido(HOTMART_APROVADA))).status, 404);
});

Deno.test("integração sem segredo salvo: 401 integracao_sem_segredo (o gateway reenvia depois)", async () => {
  const f = portaFalsa({ gateway: "stripe" });
  const r = await receberWebhook(f.porta, { gateway: "stripe", chave: CHAVE }, pedido(STRIPE_SESSAO, { "stripe-signature": "t=1,v1=00" }), AGORA);
  assertEquals(r, { status: 401, corpo: { ok: false, codigo: "integracao_sem_segredo" } });
});

Deno.test("evento fora da lista: 200 ignorado, nada gravado", async () => {
  const f = portaFalsa({ gateway: "hotmart", segredo_hash: await sha256Hex("t") });
  const r = await receberWebhook(f.porta, { gateway: "hotmart", chave: CHAVE }, pedido({ ...HOTMART_APROVADA, event: "CLUB_FIRST_ACCESS" }, { "x-hotmart-hottok": "t" }));
  assertEquals(r, { status: 200, corpo: { ok: true, ignorado: true } });
  assertEquals(f.gravados.size, 0);
});

Deno.test("resumo nunca leva dado de cartão nem o corpo inteiro", () => {
  const comCartao = { ...STRIPE_SESSAO, data: { object: { ...STRIPE_SESSAO.data.object, payment_method_details: { card: { last4: "4242", exp_month: 1 } } } } };
  const e = normalizarStripe(comCartao)!;
  const texto = JSON.stringify(e);
  assert(texto.indexOf("4242") < 0);
  assert(texto.indexOf("card") < 0);
  assertEquals(Object.keys(e.resumo).sort(), ["ambiente", "evento", "objeto", "status"]);
});
