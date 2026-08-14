// Aceleriq OS — Narrador do mês
//
// Um parágrafo que conta o mês do cliente em linguagem de gente, escrito pela
// IA a partir da linha do tempo REAL do painel (entregas, publicações, etapas,
// relatórios). Nada é inventado: o que não aconteceu não entra.
//
// Segurança: o próprio cliente pode pedir o dele; equipe pode pedir de quem
// atende. Os dados são lidos com o JWT do chamador (RLS decide o alcance).

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  requestAiChatCompletion,
  resolveAiProviderChain,
} from "../_shared/ai-provider.ts";

const PRIMARY_MODEL_CHAIN = ["gpt-4o-mini"];
const LOVABLE_COMPAT_MODEL_CHAIN = ["google/gemini-2.5-flash"];

const SYSTEM_PROMPT = `Você escreve o "resumo do mês" para o cliente de uma agência de growth marketing brasileira (Aceleriq). O leitor é dono de negócio, leigo em marketing.

REGRAS:
1. 3 a 5 frases, português claro do Brasil, tom caloroso e direto, SEM TRAVESSÃO (use vírgula ou ponto), sem jargão.
2. Use SOMENTE os fatos fornecidos. Nunca invente número, nome ou resultado. Se um dado não existe, simplesmente não fale dele.
3. Estrutura da narrativa: o que foi construído no período, o que isso significa para o negócio, e o que vem a seguir (se houver próximo passo nos fatos).
4. Fale com "você/vocês" e diga "a gente" para a agência. Nunca liste; escreva corrido.
5. Responda SOMENTE com JSON válido: {"narrative":"..."}`;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extractJson(raw: string): { narrative?: string } {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("resposta sem JSON");
  return JSON.parse(trimmed.slice(start, end + 1));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ error: "Sessão expirada." }, 401);
    }

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userData, error: userError } = await db.auth.getUser();
    if (userError || !userData?.user) return jsonResponse({ error: "Sessão expirada." }, 401);

    const body = await req.json().catch(() => ({}));
    const clientId = String(body?.client_id || "").trim() || userData.user.id;

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthIso = monthStart.toISOString();

    // Linha do tempo real do mês, lida com o JWT do chamador (RLS decide).
    const [projectsRes, filesRes, pubsRes, reportsRes] = await Promise.all([
      db.from("projects")
        .select("id, name, project_type, status")
        .eq("client_id", clientId)
        .is("deleted_at", null),
      db.from("files")
        .select("file_name, created_at, approval_status")
        .eq("client_id", clientId)
        .is("archived_at", null)
        .is("parent_file_id", null)
        .gte("created_at", monthIso)
        .order("created_at", { ascending: false })
        .limit(20),
      db.from("editorial_publications")
        .select("status, published_at, scheduled_at")
        .eq("client_id", clientId)
        .limit(200),
      db.from("reports")
        .select("title, highlights, created_at")
        .eq("client_id", clientId)
        .eq("status", "published")
        .gte("created_at", monthIso)
        .limit(5),
    ]);

    const projects = projectsRes.data || [];
    const projectIds = projects.map((p: any) => p.id);
    const { data: milestonesData } = projectIds.length
      ? await db
          .from("milestones")
          .select("title, status, updated_at")
          .in("project_id", projectIds)
          .eq("status", "completed")
          .gte("updated_at", monthIso)
          .limit(10)
      : { data: [] as any[] };

    const publishedMonth = (pubsRes.data || []).filter(
      (p: any) => p.status === "published" && p.published_at && p.published_at >= monthIso,
    );
    const scheduledAhead = (pubsRes.data || []).filter(
      (p: any) => p.status === "scheduled" && p.scheduled_at && new Date(p.scheduled_at) > new Date(),
    );
    const files = filesRes.data || [];
    const approvedMonth = files.filter((f: any) => f.approval_status === "approved").length;

    const monthName = monthStart.toLocaleDateString("pt-BR", { month: "long" });
    // Metricas reais do Instagram: o narrador cita numeros verdadeiros.
    const { data: igWeeks } = await db
      .from("social_metrics_weekly")
      .select("week_start, week_end, followers, reach, total_interactions")
      .eq("client_id", clientId)
      .order("week_start", { ascending: false })
      .limit(2);
    const igFact = (() => {
      const latest = igWeeks?.[0];
      if (!latest) return null;
      const prev = igWeeks?.[1];
      const pct = (a: number | null, b: number | null | undefined) =>
        a != null && b ? ` (${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)}%)` : "";
      return `Instagram na última semana medida: ${latest.followers ?? "?"} seguidores${pct(latest.followers, prev?.followers)}, alcance ${latest.reach ?? "?"}${pct(latest.reach, prev?.reach)}, ${latest.total_interactions ?? "?"} interações`;
    })();
    const facts = [
      `Mês: ${monthName}`,
      ...(igFact ? [igFact] : []),
      `Frentes ativas: ${projects.filter((p: any) => p.status !== "done").map((p: any) => p.name).join("; ") || "nenhuma"}`,
      `Materiais produzidos no mês: ${files.length}${files.length > 0 ? ` (exemplos: ${files.slice(0, 4).map((f: any) => f.file_name).join(", ")})` : ""}`,
      `Materiais aprovados pelo cliente no mês: ${approvedMonth}`,
      `Publicações no ar no mês: ${publishedMonth.length}`,
      `Publicações já agendadas para os próximos dias: ${scheduledAhead.length}`,
      `Etapas de projeto concluídas no mês: ${(milestonesData || []).map((m: any) => m.title).join("; ") || "nenhuma"}`,
      `Relatórios publicados no mês: ${(reportsRes.data || []).map((r: any) => r.title).join("; ") || "nenhum"}`,
    ].join("\n");

    // Sem movimento no mês, não chama IA nem inventa: devolve vazio.
    const hasMovement =
      files.length > 0 ||
      publishedMonth.length > 0 ||
      (milestonesData || []).length > 0 ||
      (reportsRes.data || []).length > 0;
    if (!hasMovement) return jsonResponse({ narrative: null });

    const providers = resolveAiProviderChain({
      primaryModels: PRIMARY_MODEL_CHAIN,
      lovableModels: LOVABLE_COMPAT_MODEL_CHAIN,
    });

    const { response } = await requestAiChatCompletion(providers, {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `FATOS DO MÊS (painel, dados reais):\n${facts}` },
      ],
      temperature: 0.5,
    });

    if (!response.ok) {
      return jsonResponse({ error: `Narrador indisponível (${response.status}).` }, 502);
    }

    const completion = await response.json();
    const parsed = extractJson(completion?.choices?.[0]?.message?.content || "");
    const narrative = String(parsed?.narrative || "").trim();
    if (!narrative) return jsonResponse({ narrative: null });

    return jsonResponse({ narrative, month: monthName });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Erro inesperado." },
      500,
    );
  }
});
