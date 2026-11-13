/**
 * Avisos do Asaas para o produto CRM e E-mail (13/11/2026). verify_jwt = false: o Asaas não tem login.
 *
 * Confere o token do cabeçalho, grava cada aviso uma vez só (pelo id do evento) e, antes de dar a empresa
 * como paga, pergunta ao próprio Asaas. Cobrança que não é do produto é ignorada: a conta da casa no Asaas
 * também recebe o Pix do Comercial, que tem o aviso dele.
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { chave } from "../_shared/chaves.ts";
import {
  contaDaReferencia,
  estadoDaCobranca,
  lerAssinaturaNoAsaas,
  lerPagamento,
  lerPagamentoNoAsaas,
  type PagamentoNoAsaas,
} from "../produto/modulos/asaas.ts";

const responder = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const agora = () => new Date().toISOString();

/** De que empresa é esta assinatura do Asaas. Guarda o vínculo quando descobre pelo checkout. */
async function contaDaAssinatura(db: SupabaseClient, token: string, assinaturaId: string): Promise<string | null> {
  const { data: conhecida } = await db.from("produto_assinaturas").select("conta_id").eq("asaas_assinatura_id", assinaturaId).maybeSingle();
  if (conhecida) return String((conhecida as { conta_id: string }).conta_id);
  const lida = await lerAssinaturaNoAsaas(token, fetch, assinaturaId).catch(() => null);
  if (!lida) return null;
  let contaId: string | null = null;
  if (lida.checkout_id) {
    const { data } = await db.from("produto_assinaturas").select("conta_id").eq("asaas_checkout_id", lida.checkout_id).maybeSingle();
    contaId = data ? String((data as { conta_id: string }).conta_id) : null;
  }
  if (!contaId) {
    const ref = contaDaReferencia(lida.referencia);
    contaId = ref ? ref.contaId : null;
  }
  if (!contaId) return null;
  await db.from("produto_assinaturas").update({
    asaas_assinatura_id: lida.id,
    asaas_cliente_id: lida.cliente_id,
    valor_mensal: lida.valor,
    proximo_vencimento: lida.proximo_vencimento,
    atualizado_em: agora(),
  }).eq("conta_id", contaId);
  return contaId;
}

async function contaDoPagamento(db: SupabaseClient, token: string, p: PagamentoNoAsaas): Promise<{ contaId: string; tipo: "mensalidade" | "migracao" | "avulsa" } | null> {
  const { data: ja } = await db.from("produto_cobrancas").select("conta_id, tipo").eq("asaas_pagamento_id", p.id).maybeSingle();
  if (ja) return { contaId: String((ja as { conta_id: string }).conta_id), tipo: (ja as { tipo: "mensalidade" | "migracao" | "avulsa" }).tipo };
  if (p.assinatura_id) {
    const contaId = await contaDaAssinatura(db, token, p.assinatura_id);
    return contaId ? { contaId, tipo: "mensalidade" } : null;
  }
  const ref = contaDaReferencia(p.referencia);
  return ref ? { contaId: ref.contaId, tipo: ref.tipo } : null;
}

async function nomeDaConta(db: SupabaseClient, contaId: string): Promise<string> {
  const { data } = await db.from("produto_contas").select("nome").eq("id", contaId).maybeSingle();
  return (data as { nome?: string } | null)?.nome || "Uma empresa";
}

async function tratarPagamento(db: SupabaseClient, token: string, evento: string, bruto: Record<string, unknown>) {
  let p = lerPagamento(bruto);
  if (!p.id) return { ignorado: "sem_pagamento" };
  const dono = await contaDoPagamento(db, token, p);
  if (!dono) return { ignorado: "cobranca_de_fora" };
  // O aviso é só o gatilho: o estado que vale é o que o Asaas responde agora.
  const conferido = await lerPagamentoNoAsaas(token, fetch, p.id).catch(() => null);
  if (conferido) p = { ...conferido, cartao_final: conferido.cartao_final || p.cartao_final, cartao_bandeira: conferido.cartao_bandeira || p.cartao_bandeira };
  else if (evento === "PAYMENT_RECEIVED" || evento === "PAYMENT_CONFIRMED") throw new Error("confirmacao_indisponivel");

  const estado = estadoDaCobranca(p.estado, p.apagado || evento === "PAYMENT_DELETED");
  const { data: antes } = await db.from("produto_cobrancas").select("estado").eq("asaas_pagamento_id", p.id).maybeSingle();
  const estadoAnterior = (antes as { estado?: string } | null)?.estado || null;
  const { error } = await db.from("produto_cobrancas").upsert({
    conta_id: dono.contaId,
    asaas_pagamento_id: p.id,
    tipo: dono.tipo,
    descricao: (p.descricao || (dono.tipo === "migracao" ? "Migração do e-mail profissional" : "Mensalidade")).slice(0, 200),
    valor: p.valor,
    valor_liquido: p.liquido,
    vencimento: p.vencimento,
    estado,
    pago_em: estado === "paga" ? (p.pago_em ? `${p.pago_em}T12:00:00-03:00` : agora()) : null,
    forma: p.forma,
    link: p.link,
    atualizado_em: agora(),
  }, { onConflict: "asaas_pagamento_id" });
  if (error) throw new Error(`cobranca_nao_gravada: ${error.message.slice(0, 120)}`);

  if (estado === "paga" && estadoAnterior !== "paga") {
    if (p.liquido != null && p.valor - p.liquido > 0.004) {
      await db.from("produto_custos").upsert({
        conta_id: dono.contaId,
        competencia: `${(p.pago_em || agora()).slice(0, 7)}-01`,
        tipo: "taxa_asaas",
        valor: Math.round((p.valor - p.liquido) * 100) / 100,
        descricao: `Taxa do Asaas (${p.forma || "cobrança"})`,
        origem_ref: `taxa:${p.id}`,
      }, { onConflict: "origem_ref" });
    }
    if (dono.tipo === "mensalidade") {
      await db.from("produto_contas").update({ estado: "ativa", atrasada_desde: null, acesso_ate: null, atualizado_em: agora() }).eq("id", dono.contaId).neq("estado", "cortesia");
      await db.from("produto_assinaturas").update({
        estado: "ativa",
        checkout_link: null,
        ...(p.cartao_final ? { cartao_final: p.cartao_final, cartao_bandeira: p.cartao_bandeira } : {}),
        atualizado_em: agora(),
      }).eq("conta_id", dono.contaId);
    }
    await db.from("produto_historico").insert({ conta_id: dono.contaId, acao: "pagamento_recebido", detalhe: { pagamento: p.id, valor: p.valor, tipo: dono.tipo } });
    await db.rpc("produto_avisar_casa", { _mensagem: `CRM e E-mail: ${await nomeDaConta(db, dono.contaId)} pagou R$ ${p.valor.toFixed(2).replace(".", ",")}.`, _link: "/produto" });
  }

  if (estado === "atrasada" && estadoAnterior !== "atrasada" && dono.tipo === "mensalidade") {
    const { data: c } = await db.from("produto_contas").select("estado, atrasada_desde").eq("id", dono.contaId).maybeSingle();
    const conta = (c || {}) as { estado?: string; atrasada_desde?: string | null };
    if (conta.estado === "ativa" || conta.estado === "teste") {
      await db.from("produto_contas").update({ estado: "atrasada", atrasada_desde: conta.atrasada_desde || agora(), atualizado_em: agora() }).eq("id", dono.contaId);
    }
    await db.from("produto_assinaturas").update({ estado: "atrasada", atualizado_em: agora() }).eq("conta_id", dono.contaId).eq("estado", "ativa");
    await db.from("produto_historico").insert({ conta_id: dono.contaId, acao: "pagamento_atrasado", detalhe: { pagamento: p.id, valor: p.valor } });
    await db.rpc("produto_avisar_casa", { _mensagem: `CRM e E-mail: a mensalidade de ${await nomeDaConta(db, dono.contaId)} venceu e não foi paga.`, _link: "/produto" });
  }
  return { conta: dono.contaId, estado };
}

async function tratarAssinatura(db: SupabaseClient, token: string, evento: string, bruto: Record<string, unknown>) {
  const id = String(bruto.id || "");
  if (!id) return { ignorado: "sem_assinatura" };
  const contaId = await contaDaAssinatura(db, token, id);
  if (!contaId) return { ignorado: "assinatura_de_fora" };
  if (evento === "SUBSCRIPTION_DELETED" || evento === "SUBSCRIPTION_INACTIVATED") {
    const { data: a } = await db.from("produto_assinaturas").select("estado, proximo_vencimento").eq("conta_id", contaId).maybeSingle();
    const ass = (a || {}) as { estado?: string; proximo_vencimento?: string | null };
    if (ass.estado !== "cancelada") {
      const hoje = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
      const ate = ass.proximo_vencimento && ass.proximo_vencimento > hoje ? `${ass.proximo_vencimento}T23:59:59-03:00` : agora();
      await db.from("produto_assinaturas").update({ estado: "cancelada", checkout_link: null, atualizado_em: agora() }).eq("conta_id", contaId);
      await db.from("produto_contas").update({ estado: "cancelada", acesso_ate: ate, atualizado_em: agora() }).eq("id", contaId).neq("estado", "cortesia");
      await db.from("produto_historico").insert({ conta_id: contaId, acao: "assinatura_encerrada", detalhe: { evento } });
      await db.rpc("produto_avisar_casa", { _mensagem: `CRM e E-mail: a assinatura de ${await nomeDaConta(db, contaId)} foi encerrada no Asaas.`, _link: "/produto" });
    }
    return { conta: contaId, estado: "cancelada" };
  }
  const lida = await lerAssinaturaNoAsaas(token, fetch, id).catch(() => null);
  if (lida) {
    await db.from("produto_assinaturas").update({ valor_mensal: lida.valor, proximo_vencimento: lida.proximo_vencimento, asaas_cliente_id: lida.cliente_id, atualizado_em: agora() }).eq("conta_id", contaId);
  }
  return { conta: contaId };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return responder({ error: "metodo" }, 405);
  let segredo = "";
  try { segredo = await chave("ASAAS_WEBHOOK_TOKEN"); } catch { segredo = ""; }
  if (!segredo) return responder({ error: "configuracao_pendente" }, 503);
  if (!iguais(req.headers.get("asaas-access-token") || "", segredo)) return responder({ error: "nao_autorizado" }, 401);

  const corpo = (await req.json().catch(() => null)) as { id?: string; event?: string; payment?: Record<string, unknown>; subscription?: Record<string, unknown>; checkout?: Record<string, unknown> } | null;
  const evento = String(corpo?.event || "");
  const idDoEvento = String(corpo?.id || "");
  if (!evento || !idDoEvento) return responder({ ok: true, ignorado: "sem_evento" });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: jaVisto } = await db.from("produto_eventos").select("id").eq("id", idDoEvento).maybeSingle();
  if (jaVisto) return responder({ ok: true, repetido: true });

  let token = "";
  try { token = await chave("ASAAS_API_KEY"); } catch { token = ""; }
  if (!token) return responder({ error: "configuracao_pendente" }, 503);

  try {
    let resultado: Record<string, unknown> = { ignorado: evento };
    if (evento.indexOf("PAYMENT_") === 0 && corpo?.payment) resultado = await tratarPagamento(db, token, evento, corpo.payment);
    else if (evento.indexOf("SUBSCRIPTION_") === 0 && corpo?.subscription) resultado = await tratarAssinatura(db, token, evento, corpo.subscription);
    else if (evento === "CHECKOUT_PAID" && corpo?.checkout) {
      const { data } = await db.from("produto_assinaturas").select("conta_id").eq("asaas_checkout_id", String(corpo.checkout.id || "")).maybeSingle();
      resultado = data ? { conta: (data as { conta_id: string }).conta_id, checkout: "pago" } : { ignorado: "checkout_de_fora" };
    }
    // Só o que é do produto fica guardado; o resto passa sem deixar rastro.
    if (resultado.conta) {
      await db.from("produto_eventos").upsert({ id: idDoEvento, tipo: evento, conta_id: String(resultado.conta), resumo: resultado }, { onConflict: "id" });
    }
    return responder({ ok: true, ...resultado });
  } catch (e) {
    // Sem 200 o Asaas tenta de novo, e o evento ainda não foi marcado como visto.
    console.error("[produto-asaas-webhook]", evento, String((e as Error).message || "").slice(0, 200));
    return responder({ error: "tente_de_novo" }, 502);
  }
});
