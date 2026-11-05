/**
 * Aviso de pagamento do Asaas (05/11/2026). verify_jwt = false: o Asaas não tem login.
 * Confere o token do cabeçalho e, antes de acreditar, pergunta ao próprio Asaas se o dinheiro entrou e se o valor
 * bate. Só então marca a cobrança como paga e põe na Caixa: dali o n8n avisa o WhatsApp da Aceleriq para o onboarding.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { chave } from "../_shared/chaves.ts";
import { pagamentoConfirmado } from "../mcp-server/modulos/comercial-asaas.ts";

const responder = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return responder({ error: "metodo" }, 405);
  let segredo = "";
  try { segredo = await chave("ASAAS_WEBHOOK_TOKEN"); } catch { segredo = ""; }
  if (!segredo) return responder({ error: "configuracao_pendente" }, 503);
  if (!iguais(req.headers.get("asaas-access-token") || "", segredo)) return responder({ error: "nao_autorizado" }, 401);
  const corpo = await req.json().catch(() => null) as { event?: string; payment?: { id?: string } } | null;
  const pagamentoId = corpo?.payment?.id || "";
  if (corpo?.event !== "PAYMENT_RECEIVED" && corpo?.event !== "PAYMENT_CONFIRMED") return responder({ ok: true, ignorado: corpo?.event || "sem_evento" });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: cob } = await db.from("comercial_cobrancas").select("*").eq("asaas_pagamento_id", pagamentoId).maybeSingle();
  if (!cob) return responder({ ok: true, ignorado: "cobranca_de_fora" });
  if (cob.situacao === "paga") return responder({ ok: true, repetido: true });
  let conf;
  try {
    conf = await pagamentoConfirmado(await chave("ASAAS_API_KEY"), fetch, pagamentoId, Number(cob.valor));
  } catch (e) {
    console.error("[comercial-asaas-webhook] confirmar", String((e as Error).message).slice(0, 160));
    return responder({ error: "confirmacao_indisponivel" }, 502);
  }
  if (!conf.pago) {
    await db.from("comercial_cobrancas").update({ observacao: conf.motivo }).eq("id", cob.id);
    return responder({ ok: true, ignorado: conf.motivo });
  }
  // Só um aviso vence a corrida entre PAYMENT_RECEIVED e PAYMENT_CONFIRMED.
  const { data: virou } = await db.from("comercial_cobrancas").update({ situacao: "paga", paga_em: new Date().toISOString() }).eq("id", cob.id).neq("situacao", "paga").select("id").maybeSingle();
  if (!virou) return responder({ ok: true, repetido: true });
  const { data: lead } = await db.from("commercial_leads").select("id, name, company, whatsapp, stage, won_client_id").eq("id", cob.lead_id).maybeSingle();
  const empresa = lead?.company || lead?.name || "Lead";
  await db.from("commercial_handoffs").insert({
    lead_id: cob.lead_id, tipo: "fechou", operador_slug: cob.operador_slug || "mercurio", telefone: lead?.whatsapp || null,
    resumo: `${empresa} fechou o plano ${cob.plano_nome}. Pix de R$ ${Number(cob.valor).toFixed(2).replace(".", ",")} confirmado no Asaas.`.slice(0, 2000),
    proximo_passo: "Fazer o onboarding e criar o grupo do cliente.",
    dados: { cobranca_id: cob.id, plano: cob.plano, valor: cob.valor, asaas_pagamento_id: pagamentoId, pagamento_confirmado: true },
  });
  // 05/11/2026 (dono): ganho só com o cliente cadastrado; o banco recusa sem ele. O Pix fica na história até a janela de ganho.
  if (lead && lead.stage !== "ganho") {
    if (lead.won_client_id) {
      await db.from("commercial_leads").update({ stage: "ganho" }).eq("id", lead.id);
      await db.from("commercial_lead_events").insert({ lead_id: lead.id, kind: "stage", from_stage: lead.stage, to_stage: "ganho", note: "Pix confirmado no Asaas." });
    } else {
      await db.from("commercial_lead_events").insert({ lead_id: lead.id, kind: "nota", note: "Pix confirmado no Asaas. Falta marcar o ganho no CRM, que cadastra o cliente." });
    }
  }
  return responder({ ok: true, pago: true });
});
