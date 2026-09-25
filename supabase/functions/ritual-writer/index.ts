// Aceleriq OS — Escritor dos rituais da Central
//
// Antes, cada ritual saía de um molde com três frases alternativas sorteadas:
// mudava a palavra, nunca o raciocínio. O cliente lia "consistência: publicar
// no ritmo planejado" tivesse acontecido o que tivesse.
//
// Aqui a IA escreve a partir dos FATOS daquele cliente naquela semana
// (entregas, aprovações paradas, publicações, etapas, números do Instagram) e
// do tipo de ritual pedido. O molde continua existindo no painel como reserva:
// se a IA não responder, o cliente recebe o texto de sempre, nunca um erro.
//
// Memória e continuidade (25/09/2026): com `client_id`, o servidor lê com o
// JWT de quem pediu (RLS) as últimas semanas de rituais enviados e gerados,
// o que mudou desde o último, as pendências, os números, o cérebro do
// cliente e a fase do método Acelera, e manda tudo ao escritor. Depois de
// escrever, confere a repetição contra os anteriores (n-gramas; o Jev só
// como aviso). Nada de laço de correção: o texto volta como saiu, com o aviso.
// Os fatos do painel continuam vindo do chamador, como antes.
//
// Ação "memorizar" ({ action: "memorizar", report_id }): depois do envio, o
// combinado no ritual entra no cérebro do cliente (agente_memoria, área
// geral, vale 21 dias) para a próxima semana retomar.
//
// Segurança: só equipe autenticada; leitura e escrita com o JWT dela.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { gravarNoCerebro } from "../_shared/cerebro-nas-mesas.ts";
import { conferirRepeticao, escreverRitual, MOMENTO, RITUAL_BRIEF } from "./escritor.ts";
import { lerContextoDoRitual } from "./contexto.ts";
import { extrairMemoriaDoRitual } from "./memoria.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return jsonResponse({ error: "Sessão expirada." }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData?.user) return jsonResponse({ error: "Sessão expirada." }, 401);
    const { data: isStaff } = await admin.rpc("is_staff", { _user_id: userData.user.id });
    if (!isStaff) return jsonResponse({ error: "Somente equipe." }, 403);

    // O banco com o JWT de quem pediu: a RLS decide o que ele vê e grava.
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } },
    );

    const body = await req.json().catch(() => ({}));

    if (body?.action === "memorizar") {
      const reportId = String(body?.report_id || "");
      if (!UUID.test(reportId)) return jsonResponse({ error: "report_id inválido." }, 400);
      const { data: rep } = await db.from("reports").select("id, client_id, status, summary, next_steps, created_at, metrics").eq("id", reportId).maybeSingle();
      if (!rep || rep.status !== "published") return jsonResponse({ ok: false, motivo: "ritual não enviado" });
      const mem = extrairMemoriaDoRitual(String(rep.summary || ""), String(rep.next_steps || ""));
      if (!mem.promessas.length) return jsonResponse({ ok: true, gravado: false, motivo: "sem combinado no texto" });
      const quando = new Date(String((rep.metrics as Record<string, unknown> | null)?.sent_at || rep.created_at))
        .toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
      const g = await gravarNoCerebro(db, {
        client_id: String(rep.client_id),
        area: "geral",
        categoria: "aprendizado",
        texto: `Combinado com o cliente no ritual de ${quando}: ${mem.promessas.slice(0, 3).join(" | ")}`.slice(0, 590),
        motivo: "Retomar na próxima mensagem dizendo o que andou.",
        evidencia: `reports:${reportId}`,
        fonte: "central_ritual",
        criado_por: userData.user.id,
        referencia_id: reportId,
        valido_dias: 21,
      });
      return jsonResponse({ ok: g.gravada, situacao: g.situacao, memoria: mem, erro: g.erro });
    }

    const ritual = MOMENTO[String(body?.moment || "")] || String(body?.ritual || "");
    const facts = String(body?.facts || "").slice(0, 12000);
    const clientName = String(body?.client_name || "Cliente").slice(0, 120);
    // Primeiro nome da pessoa de contato: a mensagem fala com gente, nao com CNPJ.
    const contactName = String(body?.contact_name || "").trim().split(/\s+/)[0]?.slice(0, 40) || "";
    if (!RITUAL_BRIEF[ritual] || !facts) {
      return jsonResponse({ error: "Ritual ou fatos ausentes." }, 400);
    }
    // Aprimorar: o painel manda o texto atual e a IA melhora e complementa,
    // em vez de escrever outro do zero e perder o que a pessoa ja ajustou.
    const atual = body?.improve && typeof body.improve === "object" ? body.improve as { summary?: unknown; next_steps?: unknown } : null;
    const textoAtual = atual ? String(atual.summary || "").slice(0, 8000).trim() : "";
    const passoAtual = atual ? String(atual.next_steps || "").slice(0, 1000).trim() : "";

    // Memória montada no servidor. Falha aqui nunca derruba o ritual.
    const clientId = typeof body?.client_id === "string" && UUID.test(body.client_id) ? body.client_id : "";
    const reportId = typeof body?.report_id === "string" && UUID.test(body.report_id) ? body.report_id : null;
    let contexto: Awaited<ReturnType<typeof lerContextoDoRitual>> | null = null;
    if (clientId) {
      const { data: pode } = await db.rpc("can_access_client", { _client_id: clientId });
      if (pode !== true) return jsonResponse({ error: "Sem acesso a este cliente." }, 403);
      contexto = await lerContextoDoRitual(db, clientId, { ritual, excluirReportId: reportId }).catch((e) => {
        console.warn(`[ritual] contexto falhou: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      });
    }

    const escrito = await escreverRitual({
      ritual, clientName, contactName, facts,
      continuidade: contexto?.texto,
      textoAtual, passoAtual,
    });
    if (!escrito) return jsonResponse({ title: null, body: null, source: "fallback" });
    const nextSteps = escrito.next_steps;

    // Conferência de repetição contra o que já foi dito (aviso, nunca correção).
    const repeticao = contexto
      ? await conferirRepeticao(escrito.body, contexto.anteriores.map((a) => ({ quando: a.quando, titulo: a.titulo, texto: a.texto })))
      : null;

    return jsonResponse({
      title: escrito.title,
      body: escrito.body,
      next_steps: nextSteps,
      alertas: escrito.alertas,
      tarefas_sugeridas: escrito.tarefas_sugeridas,
      repeticao,
      memoria: extrairMemoriaDoRitual(escrito.body, nextSteps),
      contexto: contexto
        ? { fase: contexto.fase, motivo_da_fase: contexto.motivoDaFase, desde: contexto.desde, contagem: contexto.contagem, avisos: contexto.avisos }
        : null,
      source: "ai",
      model: escrito.model,
      usage: escrito.usage,
      improved: !!textoAtual,
    });
  } catch (error) {
    // Falha aqui nunca pode travar o ritual: o painel usa o texto de reserva.
    console.warn(`[ritual] falha: ${error instanceof Error ? error.message : String(error)}`);
    return jsonResponse({ title: null, body: null, source: "fallback" });
  }
});
