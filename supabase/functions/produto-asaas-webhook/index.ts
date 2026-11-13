/**
 * Avisos do Asaas para o produto CRM e E-mail (13/11/2026). verify_jwt = false: o Asaas não tem login.
 *
 * Confere o token do cabeçalho, marca cada aviso uma vez só (pelo id do evento) e, antes de dar a empresa
 * como paga, pergunta ao próprio Asaas. Cobrança que não é do produto é ignorada: a conta da casa no Asaas
 * também recebe o Pix do Comercial, que tem o aviso dele.
 *
 * O pagamento vale pelo que foi PAGO, não pelo que está na tela: na primeira cobrança, o plano e os
 * usuários da empresa passam a ser os do checkout que foi pago (um checkout antigo e mais barato não
 * libera o plano mais caro). Redução pedida no meio do ciclo só entra depois da cobrança seguinte.
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { chave } from "../_shared/chaves.ts";
import {
  contaDaReferencia,
  descricaoDosItens,
  estadoDaCobranca,
  itensValidos,
  lerAssinaturaNoAsaas,
  lerPagamento,
  lerPagamentoNoAsaas,
  mudarValorDaAssinatura,
  totalDosItens,
  type PagamentoNoAsaas,
} from "../produto/modulos/asaas.ts";
import { fimDoAcessoAoCancelar, pedidoDoCheckout } from "../produto/modulos/regras.ts";

const responder = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const agora = () => new Date().toISOString();

interface AssinaturaGuardada {
  conta_id: string;
  asaas_assinatura_id: string | null;
  asaas_checkout_id: string | null;
  estado: string;
  proximo_vencimento: string | null;
  pedidos: Record<string, unknown>;
  troca_agendada: Record<string, unknown> | null;
}

const COLUNAS_DA_ASSINATURA = "conta_id, asaas_assinatura_id, asaas_checkout_id, estado, proximo_vencimento, pedidos, troca_agendada";
const ID_DE_CHECKOUT = /^[A-Za-z0-9_-]{1,80}$/;

async function assinaturaDaConta(db: SupabaseClient, contaId: string): Promise<AssinaturaGuardada | null> {
  const { data } = await db.from("produto_assinaturas").select(COLUNAS_DA_ASSINATURA).eq("conta_id", contaId).maybeSingle();
  return (data as AssinaturaGuardada | null) || null;
}

/**
 * De que empresa é esta assinatura do Asaas, e de qual checkout ela nasceu.
 * Assinatura nova (a empresa ainda não tem uma valendo) é ligada aqui. Assinatura
 * diferente da que está valendo é ignorada: é a anterior, já substituída.
 */
async function contaDaAssinatura(db: SupabaseClient, token: string, assinaturaId: string): Promise<{ contaId: string; checkoutId: string | null } | null> {
  const { data: conhecida } = await db.from("produto_assinaturas").select("conta_id").eq("asaas_assinatura_id", assinaturaId).maybeSingle();
  const lida = await lerAssinaturaNoAsaas(token, fetch, assinaturaId).catch(() => null);
  if (conhecida) return { contaId: String((conhecida as { conta_id: string }).conta_id), checkoutId: lida ? lida.checkout_id : null };
  if (!lida) return null;
  let contaId: string | null = null;
  if (lida.checkout_id && ID_DE_CHECKOUT.test(lida.checkout_id)) {
    const { data: atual } = await db.from("produto_assinaturas").select("conta_id").eq("asaas_checkout_id", lida.checkout_id).maybeSingle();
    contaId = atual ? String((atual as { conta_id: string }).conta_id) : null;
    if (!contaId) {
      // Checkout mais antigo da mesma empresa: ainda está na lista de pedidos dela.
      const { data: antigo } = await db.from("produto_assinaturas").select("conta_id").not(`pedidos->${lida.checkout_id}`, "is", null).limit(1);
      contaId = antigo && antigo.length ? String((antigo[0] as { conta_id: string }).conta_id) : null;
    }
  }
  if (!contaId) {
    const ref = contaDaReferencia(lida.referencia);
    contaId = ref ? ref.contaId : null;
  }
  if (!contaId) return null;
  const atual = await assinaturaDaConta(db, contaId);
  if (!atual) return null;
  // A empresa já tem outra assinatura valendo: esta é antiga e não mexe em nada.
  if (atual.asaas_assinatura_id && atual.asaas_assinatura_id !== lida.id && (atual.estado === "ativa" || atual.estado === "atrasada")) return null;
  await db.from("produto_assinaturas").update({
    asaas_assinatura_id: lida.id,
    asaas_cliente_id: lida.cliente_id,
    proximo_vencimento: lida.proximo_vencimento,
    atualizado_em: agora(),
  }).eq("conta_id", contaId);
  return { contaId, checkoutId: lida.checkout_id };
}

interface DonoDoPagamento {
  contaId: string;
  tipo: "mensalidade" | "migracao" | "avulsa";
  checkoutId: string | null;
}

async function contaDoPagamento(db: SupabaseClient, token: string, p: PagamentoNoAsaas): Promise<DonoDoPagamento | null> {
  if (p.assinatura_id) {
    const dona = await contaDaAssinatura(db, token, p.assinatura_id);
    return dona ? { contaId: dona.contaId, tipo: "mensalidade", checkoutId: dona.checkoutId } : null;
  }
  const { data: ja } = await db.from("produto_cobrancas").select("conta_id, tipo").eq("asaas_pagamento_id", p.id).maybeSingle();
  if (ja) return { contaId: String((ja as { conta_id: string }).conta_id), tipo: (ja as { tipo: DonoDoPagamento["tipo"] }).tipo, checkoutId: null };
  const ref = contaDaReferencia(p.referencia);
  // Sem assinatura, só a cobrança avulsa da migração entra pela referência.
  return ref && ref.tipo === "migracao" ? { contaId: ref.contaId, tipo: "migracao", checkoutId: null } : null;
}

async function nomeDaConta(db: SupabaseClient, contaId: string): Promise<string> {
  const { data } = await db.from("produto_contas").select("nome").eq("id", contaId).maybeSingle();
  return (data as { nome?: string } | null)?.nome || "Uma empresa";
}

const reais = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

async function itensDaConta(db: SupabaseClient, contaId: string) {
  const { data } = await db.rpc("produto_itens_da_conta", { _conta: contaId });
  return itensValidos(data);
}

/**
 * Primeira mensalidade paga: a empresa fica com o plano e os usuários do checkout que foi pago.
 * Sem o pedido guardado, só ativa se o valor pago for o da empresa hoje. Devolve false quando não ativou.
 */
async function ativarPeloQueFoiPago(db: SupabaseClient, dono: DonoDoPagamento, ass: AssinaturaGuardada, p: PagamentoNoAsaas): Promise<boolean> {
  const pedido = pedidoDoCheckout(ass.pedidos, dono.checkoutId);
  if (pedido) {
    await db.from("produto_contas").update({ plano_id: pedido.plano_id, usuarios_contratados: pedido.usuarios, atualizado_em: agora() }).eq("id", dono.contaId);
  }
  const itens = await itensDaConta(db, dono.contaId);
  const devido = totalDosItens(itens);
  if (Math.abs(devido - p.valor) > 0.009) {
    await db.from("produto_historico").insert({ conta_id: dono.contaId, acao: "pagamento_divergente", detalhe: { pagamento: p.id, pago: p.valor, devido } });
    await db.rpc("produto_avisar_casa", { _mensagem: `CRM e E-mail: ${await nomeDaConta(db, dono.contaId)} pagou ${reais(p.valor)}, mas o contratado dá ${reais(devido)}. A empresa NÃO foi ativada: confira.`, _link: "/produto" });
    return false;
  }
  await db.from("produto_contas").update({ estado: "ativa", atrasada_desde: null, acesso_ate: null, atualizado_em: agora() }).eq("id", dono.contaId).neq("estado", "cortesia");
  await db.from("produto_assinaturas").update({
    estado: "ativa", checkout_link: null, valor_mensal: devido, itens, pedidos: {}, troca_agendada: null,
    ...(p.cartao_final ? { cartao_final: p.cartao_final, cartao_bandeira: p.cartao_bandeira } : {}),
    atualizado_em: agora(),
  }).eq("conta_id", dono.contaId);
  return true;
}

/** Mensalidade seguinte paga: a redução que esperava a cobrança entra agora, e o valor novo vai para o Asaas. */
async function aplicarTrocaAgendada(db: SupabaseClient, token: string, contaId: string, ass: AssinaturaGuardada) {
  const troca = pedidoDoCheckout({ troca: ass.troca_agendada }, "troca");
  if (!troca || !ass.asaas_assinatura_id) return;
  await db.from("produto_contas").update({ plano_id: troca.plano_id, usuarios_contratados: troca.usuarios, atualizado_em: agora() }).eq("id", contaId);
  const itens = await itensDaConta(db, contaId);
  const valor = totalDosItens(itens);
  try {
    if (valor > 0) await mudarValorDaAssinatura(token, fetch, ass.asaas_assinatura_id, { valor, descricao: descricaoDosItens(itens) });
    await db.from("produto_assinaturas").update({ valor_mensal: valor, itens, troca_agendada: null, atualizado_em: agora() }).eq("conta_id", contaId);
    await db.from("produto_historico").insert({ conta_id: contaId, acao: "troca_aplicada", detalhe: { plano: troca.plano_id, usuarios: troca.usuarios, valor } });
  } catch (e) {
    await db.rpc("produto_avisar_casa", { _mensagem: `CRM e E-mail: a troca de plano de ${await nomeDaConta(db, contaId)} não chegou ao Asaas. Sincronize pela ficha da empresa.`, _link: "/produto" });
    console.error("[produto-asaas-webhook] troca agendada", String((e as Error).message || "").slice(0, 160));
  }
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
    let ativou = true;
    if (dono.tipo === "mensalidade") {
      const ass = await assinaturaDaConta(db, dono.contaId);
      if (ass && ass.estado !== "ativa" && ass.estado !== "atrasada") {
        ativou = await ativarPeloQueFoiPago(db, dono, ass, p);
      } else if (ass) {
        await db.from("produto_contas").update({ estado: "ativa", atrasada_desde: null, acesso_ate: null, atualizado_em: agora() }).eq("id", dono.contaId).in("estado", ["ativa", "atrasada"]);
        await db.from("produto_assinaturas").update({
          estado: "ativa",
          ...(p.cartao_final ? { cartao_final: p.cartao_final, cartao_bandeira: p.cartao_bandeira } : {}),
          atualizado_em: agora(),
        }).eq("conta_id", dono.contaId);
        if (ass.troca_agendada) await aplicarTrocaAgendada(db, token, dono.contaId, ass);
      }
    }
    await db.from("produto_historico").insert({ conta_id: dono.contaId, acao: "pagamento_recebido", detalhe: { pagamento: p.id, valor: p.valor, tipo: dono.tipo } });
    if (ativou) await db.rpc("produto_avisar_casa", { _mensagem: `CRM e E-mail: ${await nomeDaConta(db, dono.contaId)} pagou ${reais(p.valor)}.`, _link: "/produto" });
  }

  // Venceu sem pagar, ou o pagamento voltou (estorno, contestação): o acesso entra na tolerância.
  const perdeuOPagamento = (estado === "atrasada" && estadoAnterior !== "atrasada") || (estado === "estornada" && estadoAnterior !== "estornada");
  if (perdeuOPagamento && dono.tipo === "mensalidade") {
    const { data: c } = await db.from("produto_contas").select("estado, atrasada_desde").eq("id", dono.contaId).maybeSingle();
    const conta = (c || {}) as { estado?: string; atrasada_desde?: string | null };
    if (conta.estado === "ativa") {
      await db.from("produto_contas").update({ estado: "atrasada", atrasada_desde: conta.atrasada_desde || agora(), atualizado_em: agora() }).eq("id", dono.contaId);
    }
    await db.from("produto_assinaturas").update({ estado: "atrasada", atualizado_em: agora() }).eq("conta_id", dono.contaId).eq("estado", "ativa");
    await db.from("produto_historico").insert({ conta_id: dono.contaId, acao: estado === "estornada" ? "pagamento_estornado" : "pagamento_atrasado", detalhe: { pagamento: p.id, valor: p.valor } });
    await db.rpc("produto_avisar_casa", {
      _mensagem: estado === "estornada"
        ? `CRM e E-mail: a mensalidade de ${await nomeDaConta(db, dono.contaId)} foi estornada ou contestada.`
        : `CRM e E-mail: a mensalidade de ${await nomeDaConta(db, dono.contaId)} venceu e não foi paga.`,
      _link: "/produto",
    });
  }
  return { conta: dono.contaId, estado };
}

async function tratarAssinatura(db: SupabaseClient, token: string, evento: string, bruto: Record<string, unknown>) {
  const id = String(bruto.id || "");
  if (!id) return { ignorado: "sem_assinatura" };
  const dona = await contaDaAssinatura(db, token, id);
  if (!dona) return { ignorado: "assinatura_de_fora" };
  const contaId = dona.contaId;
  const ass = await assinaturaDaConta(db, contaId);
  // Só a assinatura que está valendo mexe na empresa.
  if (!ass || ass.asaas_assinatura_id !== id) return { ignorado: "assinatura_substituida" };
  if (evento === "SUBSCRIPTION_DELETED" || evento === "SUBSCRIPTION_INACTIVATED") {
    if (ass.estado !== "cancelada") {
      const { data: c } = await db.from("produto_contas").select("estado").eq("id", contaId).maybeSingle();
      const ate = fimDoAcessoAoCancelar({ estadoDaConta: String((c as { estado?: string } | null)?.estado || ""), proximoVencimento: ass.proximo_vencimento, agora: new Date() });
      await db.from("produto_assinaturas").update({ estado: "cancelada", checkout_link: null, troca_agendada: null, atualizado_em: agora() }).eq("conta_id", contaId);
      await db.from("produto_contas").update({ estado: "cancelada", acesso_ate: ate, atualizado_em: agora() }).eq("id", contaId).neq("estado", "cortesia");
      await db.from("produto_historico").insert({ conta_id: contaId, acao: "assinatura_encerrada", detalhe: { evento } });
      await db.rpc("produto_avisar_casa", { _mensagem: `CRM e E-mail: a assinatura de ${await nomeDaConta(db, contaId)} foi encerrada no Asaas.`, _link: "/produto" });
    }
    return { conta: contaId, estado: "cancelada" };
  }
  const lida = await lerAssinaturaNoAsaas(token, fetch, id).catch(() => null);
  if (lida) await db.from("produto_assinaturas").update({ proximo_vencimento: lida.proximo_vencimento, asaas_cliente_id: lida.cliente_id, atualizado_em: agora() }).eq("conta_id", contaId);
  return { conta: contaId };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return responder({ error: "metodo" }, 405);
  let segredo = "";
  try { segredo = await chave("ASAAS_WEBHOOK_TOKEN"); } catch { segredo = ""; }
  if (!segredo) return responder({ error: "configuracao_pendente" }, 503);
  if (!iguais(req.headers.get("asaas-access-token") || "", segredo)) return responder({ error: "nao_autorizado" }, 401);

  const corpo = (await req.json().catch(() => null)) as { id?: string; event?: string; payment?: Record<string, unknown>; subscription?: Record<string, unknown> } | null;
  const evento = String(corpo?.event || "");
  const idDoEvento = String(corpo?.id || "").slice(0, 120);
  if (!evento || !idDoEvento) return responder({ ok: true, ignorado: "sem_evento" });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  let token = "";
  try { token = await chave("ASAAS_API_KEY"); } catch { token = ""; }
  if (!token) return responder({ error: "configuracao_pendente" }, 503);

  // O evento é marcado ANTES de processar: duas entregas ao mesmo tempo não processam duas vezes.
  const { error: jaVisto } = await db.from("produto_eventos").insert({ id: idDoEvento, tipo: evento });
  if (jaVisto) return responder({ ok: true, repetido: true });

  try {
    let resultado: Record<string, unknown> = { ignorado: evento };
    if (evento.indexOf("PAYMENT_") === 0 && corpo?.payment) resultado = await tratarPagamento(db, token, evento, corpo.payment);
    else if (evento.indexOf("SUBSCRIPTION_") === 0 && corpo?.subscription) resultado = await tratarAssinatura(db, token, evento, corpo.subscription);
    // Só o que é do produto fica guardado; o resto sai sem deixar rastro.
    if (resultado.conta) await db.from("produto_eventos").update({ conta_id: String(resultado.conta), resumo: resultado }).eq("id", idDoEvento);
    else await db.from("produto_eventos").delete().eq("id", idDoEvento);
    return responder({ ok: true, ...resultado });
  } catch (e) {
    // Sem 200 o Asaas tenta de novo: a marca do evento sai para a nova tentativa processar.
    await db.from("produto_eventos").delete().eq("id", idDoEvento);
    console.error("[produto-asaas-webhook]", evento, String((e as Error).message || "").slice(0, 200));
    return responder({ error: "tente_de_novo" }, 502);
  }
});
