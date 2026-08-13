// Aceleriq OS — Radar de Ideias com IA e busca na web
//
// Por que existe: o playbook local de ideias era fixo e soava genérico. Este
// motor gera as ideias do Radar com IA, PARTINDO do contexto real do cliente
// (frentes, entregas recentes, publicações, medições, Pulso) e com busca na
// web para ancorar em tendências atuais do nicho. A ideia chega descrita em
// português claro, específica para aquele negócio, nunca de prateleira.
//
// Segurança: só equipe autenticada; os dados do cliente são lidos com o JWT
// do chamador (RLS aplicado). A leitura comercial (oferta/faixa) volta num
// campo separado que o frontend só mostra para a equipe.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  requestAiChatCompletion,
  resolveAiProviderChain,
  type AiProvider,
} from "../_shared/ai-provider.ts";

// Modelos com busca na web embutida primeiro; sem busca como reserva.
const PRIMARY_MODEL_CHAIN = ["gpt-4o-mini-search-preview", "gpt-4o-mini"];
const LOVABLE_COMPAT_MODEL_CHAIN = ["google/gemini-2.5-flash"];

const SYSTEM_PROMPT = `Você é o estrategista-chefe de crescimento da Aceleriq, uma agência de growth marketing brasileira. Sua especialidade é marketing de diferenciação (a escola do Fator X, de Pedro Superti): o que torna uma marca desejada já existe dentro do negócio; o trabalho é achar esse elemento e transformá-lo em movimento, vendendo visão de mundo e não produto, até a concorrência ficar irrelevante.

Sua tarefa: gerar 3 ideias de diferenciação para UM cliente específico, a partir do contexto real dele (fornecido) e de tendências atuais que você deve buscar na web para o nicho dele.

REGRAS ABSOLUTAS:
1. NADA genérico. Cada ideia precisa citar o negócio do cliente, o nicho dele e o que ele já tem. Se a ideia servir para qualquer empresa, ela está errada.
2. A descrição explica a ideia COMPLETA em 2 a 4 frases: o que é, como funciona na prática e o que o cliente vai ver acontecendo. Quem lê tem que visualizar a ideia pronta.
3. "Por que agora" usa os números e fatos reais do contexto (meses de casa, publicações, crescimento medido, materiais recentes) e, quando houver, a tendência encontrada na web (cite de onde veio em uma frase, sem link).
4. A ideia deve ser algo que o dono provavelmente já pensou em fazer e nunca executou, ou uma tendência atual aplicada ao caso dele. Antecipação é o valor do ritual.
5. Nunca sugira migração de plano, reajuste ou qualquer cobrança. A leitura comercial vai SÓ no campo interno.
6. Português claro do Brasil, sem jargão de marketing e SEM TRAVESSÃO (use vírgula ou ponto).
7. Os passos são o que a AGÊNCIA faz, concretos, executáveis em 1 a 2 semanas.

Responda SOMENTE com JSON válido, sem markdown, neste formato exato:
{"ideas":[{"titulo":"...","descricao":"...","por_que_agora":"...","passos":["...","...","..."],"sinal":"...","interno_oferta":"...","interno_faixa_min":0,"interno_faixa_max":0,"interno_esforco":"baixo|medio|alto"}]}`;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extractJson(raw: string): unknown {
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
      return jsonResponse({ error: "Sessão expirada. Entre de novo." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const db = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await db.auth.getUser();
    if (userError || !userData?.user) {
      return jsonResponse({ error: "Sessão expirada. Entre de novo." }, 401);
    }

    const { data: roleRow } = await db
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .in("role", ["admin", "manager", "design", "traffic"])
      .limit(1);
    if (!roleRow || roleRow.length === 0) {
      return jsonResponse({ error: "Somente a equipe pode gerar ideias." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const clientId = String(body?.client_id || "").trim();
    if (!clientId) return jsonResponse({ error: "client_id é obrigatório." }, 400);

    // ── Contexto real do cliente, lido com RLS do chamador ──
    const [profileRes, projectsRes, filesRes, pubsRes, reportsRes] = await Promise.all([
      db.from("profiles").select("full_name, company_name").eq("id", clientId).limit(1),
      db.from("projects")
        .select("name, project_type, status, created_at")
        .eq("client_id", clientId)
        .is("deleted_at", null),
      db.from("files")
        .select("file_name, created_at")
        .eq("client_id", clientId)
        .is("archived_at", null)
        .is("parent_file_id", null)
        .order("created_at", { ascending: false })
        .limit(8),
      db.from("editorial_publications")
        .select("status, published_at")
        .eq("client_id", clientId)
        .eq("status", "published")
        .limit(200),
      db.from("reports")
        .select("title, metrics, period_start, period_end, created_at")
        .eq("client_id", clientId)
        .eq("status", "published")
        .order("created_at", { ascending: false })
        .limit(6),
    ]);

    const profile = profileRes.data?.[0];
    if (!profile) return jsonResponse({ error: "Cliente não encontrado." }, 404);

    const projects = projectsRes.data || [];
    const clientName = profile.company_name || profile.full_name || "Cliente";
    const d30 = Date.now() - 30 * 86400000;
    const published30 = (pubsRes.data || []).filter(
      (p: any) => p.published_at && new Date(p.published_at).getTime() >= d30,
    ).length;

    const firstProject = projects
      .map((p: any) => p.created_at)
      .filter(Boolean)
      .sort()[0];
    const months = firstProject
      ? Math.max(1, Math.round((Date.now() - new Date(firstProject).getTime()) / (30 * 86400000)))
      : 1;

    const context = [
      `Cliente: ${clientName}`,
      `Tempo de casa: ${months} mes(es)`,
      `Frentes contratadas: ${
        [...new Set(projects.map((p: any) => p.project_type).filter(Boolean))].join(", ") ||
        "nenhuma registrada"
      }`,
      `Projetos: ${projects.map((p: any) => `${p.name} (${p.status})`).join("; ") || "nenhum"}`,
      `Publicações no ar nos últimos 30 dias: ${published30} (total histórico: ${(pubsRes.data || []).length})`,
      `Últimos materiais entregues: ${
        (filesRes.data || []).slice(0, 5).map((f: any) => f.file_name).join(", ") || "nenhum"
      }`,
      `Relatórios publicados: ${
        (reportsRes.data || [])
          .map((r: any) => `${r.title} (${r.period_start || "?"} a ${r.period_end || "?"})`)
          .join("; ") || "nenhum ainda"
      }`,
    ].join("\n");

    const userPrompt = `CONTEXTO REAL DO CLIENTE (dados do painel, hoje):\n${context}\n\nPasso 1: deduza o nicho do negócio pelo nome e pelos materiais. Passo 2: busque na web tendências e formatos que estão funcionando AGORA para esse nicho no Brasil (Instagram, TikTok, experiência do cliente). Passo 3: gere as 3 ideias seguindo as regras. Lembre: específicas para ${clientName}, com a descrição completa da ideia.`;

    const providers = resolveAiProviderChain({
      primaryModels: PRIMARY_MODEL_CHAIN,
      lovableModels: LOVABLE_COMPAT_MODEL_CHAIN,
    });

    const { response, provider } = await requestAiChatCompletion(
      providers,
      (candidate: AiProvider) => ({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        // Busca na web só nos modelos que a suportam nativamente.
        ...(candidate.model.includes("search-preview")
          ? { web_search_options: {} }
          : { temperature: 0.7 }),
      }),
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return jsonResponse(
        { error: `O gerador de ideias não respondeu (${response.status}).`, detail: detail.slice(0, 300) },
        502,
      );
    }

    const completion = await response.json();
    const content = completion?.choices?.[0]?.message?.content || "";
    const parsed = extractJson(content) as { ideas?: unknown[] };
    const ideas = Array.isArray(parsed?.ideas) ? parsed.ideas.slice(0, 3) : [];
    if (ideas.length === 0) {
      return jsonResponse({ error: "A IA não devolveu ideias válidas. Tente de novo." }, 502);
    }

    return jsonResponse({
      client_id: clientId,
      client_name: clientName,
      provider: provider.label,
      web_search: provider.model.includes("search-preview"),
      ideas,
    });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Erro inesperado ao gerar ideias." },
      500,
    );
  }
});
