// Esteira: plano da semana lido do dossie e da historia do cliente.
//
// Entrada: { client_id, week_start, refresh? }. Saida: { feito, proximos,
// foco, source, cached }. O plano e gravado em project_memory (kind
// "esteira_plano", metadata.week_start) e reaproveitado na semana; "refresh"
// forca reler o dossie. O modelo so pode falar do que esta no dossie, na
// historia recente e nos fatos; nada de passo generico que serviria para
// qualquer cliente.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  DEFAULT_LOVABLE_MODEL_CHAIN,
  requestAiChatCompletion,
  resolveAiProviderChain,
} from "../_shared/ai-provider.ts";

const PRIMARY_MODEL_CHAIN = ["gpt-4o-mini"];

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function extractJson(text: string): Record<string, unknown> | null {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
}

const SYSTEM_PROMPT = `Voce e o cerebro operacional de uma agencia de marketing (Aceleriq). Recebe o DOSSIE atual de um cliente (onde ele esta, o que foi combinado), a HISTORIA recente (o que aconteceu nos ultimos 14 dias), e os FATOS do painel (posts, tarefas, marcos, rituais). Responda SOMENTE um JSON valido, em portugues do Brasil, sem travessao (use virgula ou ponto), com este formato:
{"foco":"uma frase com o foco desta semana para ESTE cliente",
 "feito":["o que foi realmente feito nesta semana, so com base em evidencia da historia ou dos fatos"],
 "proximos":[{"titulo":"nome curto do item","passo":"a acao concreta","motivo":"por que, citando o dossie ou o fato"}]}
Regras duras:
- Cada item de "proximos" precisa nascer do dossie ou de um fato. Se nao ha base, nao invente. Pode devolver lista vazia.
- Nunca repita um item que ja esta em PENDENCIAS DO PAINEL (essas ja aparecem sozinhas).
- Nunca use frases genericas como "criar conteudo da semana", "postar nas redes", "acompanhar metricas". Diga QUAL conteudo, QUAL post, QUAL campanha, QUAL decisao.
- Se o cliente esta em entrada (sem nome, sem logo, sem Instagram), os proximos sao os passos de entrada que o dossie indica, nao operacao de conteudo.
- "feito" so com evidencia; se nada, lista vazia.
- Maximo 6 proximos, maximo 6 feitos. Frases curtas.`;

function mondayIso(d: Date): string {
  const x = new Date(d);
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Metodo nao permitido." }, 405);
  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return jsonResponse({ error: "Sessao expirada." }, 401);
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userError } = await db.auth.getUser();
    if (userError || !userData?.user) return jsonResponse({ error: "Sessao expirada." }, 401);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const clientId = typeof body.client_id === "string" ? body.client_id : "";
    const weekStart = typeof body.week_start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.week_start) ? body.week_start : mondayIso(new Date());
    const refresh = body.refresh === true;
    if (!/^[0-9a-f-]{36}$/i.test(clientId)) return jsonResponse({ error: "client_id invalido." }, 400);

    // Cache da semana.
    if (!refresh) {
      const { data: cache } = await db
        .from("project_memory")
        .select("id, metadata, created_at")
        .eq("client_id", clientId)
        .eq("kind", "esteira_plano")
        .contains("metadata", { week_start: weekStart })
        .order("created_at", { ascending: false })
        .limit(1);
      const c = cache?.[0];
      if (c?.metadata && typeof c.metadata === "object") {
        const m = c.metadata as Record<string, unknown>;
        return jsonResponse({ foco: m.foco ?? "", feito: m.feito ?? [], proximos: m.proximos ?? [], source: m.source ?? "cache", cached: true, generated_at: c.created_at });
      }
    }

    const semanaIni = new Date(`${weekStart}T00:00:00Z`);
    const semanaFim = new Date(semanaIni.getTime() + 7 * 86_400_000);
    const desde14 = new Date(semanaIni.getTime() - 14 * 86_400_000).toISOString();

    const [perfil, dossie, historia, projetos, posts, rituais] = await Promise.all([
      db.from("profiles").select("full_name, company_name, services_config, created_at").eq("id", clientId).maybeSingle(),
      db.from("client_dossiers").select("summary, content, updated_at").eq("client_id", clientId).eq("is_current", true).order("updated_at", { ascending: false }).limit(1),
      db.from("project_memory").select("kind, title, content, created_at").eq("client_id", clientId).neq("kind", "esteira_plano").gte("created_at", desde14).order("created_at", { ascending: false }).limit(40),
      db.from("projects").select("id, name, tasks(title, status, due_date, updated_at), milestones(title, status, target_date)").eq("client_id", clientId).is("deleted_at", null),
      db.from("editorial_posts").select("title, production_status, primary_file_id, editorial_publications(status, scheduled_at, published_at)").eq("client_id", clientId).is("archived_at", null).order("created_at", { ascending: false }).limit(40),
      db.from("cycle_rituals").select("ritual_key, source").eq("client_id", clientId).eq("week_start", weekStart),
    ]);

    const nome = perfil.data?.company_name || perfil.data?.full_name || "Cliente";
    const servicos = Object.entries((perfil.data?.services_config ?? {}) as Record<string, unknown>).filter(([, v]) => v === true).map(([k]) => k).join(", ") || "nao informado";
    const d = dossie.data?.[0];
    const dossieTexto = String(d?.content || d?.summary || "").slice(0, 7000) || "(sem dossie escrito)";

    const hist = ((historia.data ?? []) as Array<Record<string, any>>).map((h) => `- ${String(h.created_at).slice(0, 10)} [${h.kind}] ${h.title ?? ""}: ${String(h.content ?? "").slice(0, 220)}`).join("\n") || "(nada nos ultimos 14 dias)";

    const tarefas: string[] = [];
    const marcos: string[] = [];
    for (const p of (projetos.data ?? []) as Array<Record<string, any>>) {
      for (const t of (p.tasks ?? []) as Array<Record<string, any>>) {
        const st = String(t.status ?? "").toLowerCase();
        const feita = ["done", "completed", "concluida"].includes(st);
        const upd = t.updated_at ? new Date(t.updated_at) : null;
        if (feita && upd && upd >= semanaIni && upd < semanaFim) tarefas.push(`- FEITA nesta semana: ${t.title}`);
        else if (!feita) tarefas.push(`- aberta${t.due_date ? ` (prazo ${t.due_date})` : ""}: ${t.title}`);
      }
      for (const m of (p.milestones ?? []) as Array<Record<string, any>>) {
        if (String(m.status ?? "").toLowerCase() !== "completed") marcos.push(`- ${m.title}${m.target_date ? ` (alvo ${m.target_date})` : ""}`);
      }
    }

    const postsLinhas: string[] = [];
    for (const p of (posts.data ?? []) as Array<Record<string, any>>) {
      const pubs = (p.editorial_publications ?? []) as Array<Record<string, any>>;
      const pubSemana = pubs.find((x) => x.published_at && new Date(x.published_at) >= semanaIni && new Date(x.published_at) < semanaFim);
      if (pubSemana) { postsLinhas.push(`- PUBLICADO nesta semana: ${p.title}`); continue; }
      if (pubs.some((x) => x.status === "published")) continue;
      const agendado = pubs.find((x) => x.status === "scheduled");
      if (agendado) { postsLinhas.push(`- agendado ${String(agendado.scheduled_at).slice(0, 10)}: ${p.title}`); continue; }
      postsLinhas.push(`- ${p.primary_file_id ? "arte pronta, sem data" : "pauta sem arte"}: ${p.title}`);
    }

    const rit = ((rituais.data ?? []) as Array<Record<string, any>>).map((r) => r.ritual_key).join(", ") || "nenhum";

    const fatos = [
      `CLIENTE: ${nome} (servicos: ${servicos}; na casa desde ${String(perfil.data?.created_at ?? "").slice(0, 10)})`,
      `SEMANA: ${weekStart}`,
      `DOSSIE ATUAL (fonte da verdade sobre onde o cliente esta):\n${dossieTexto}`,
      `HISTORIA (ultimos 14 dias):\n${hist}`,
      `POSTS (o painel ja mostra os elos que faltam; nao repita):\n${postsLinhas.slice(0, 30).join("\n") || "(nenhum)"}`,
      `TAREFAS DO KANBAN (o painel ja mostra atrasadas e desta semana; nao repita):\n${tarefas.slice(0, 40).join("\n") || "(nenhuma)"}`,
      `MARCOS ABERTOS:\n${marcos.join("\n") || "(nenhum)"}`,
      `RITUAIS JA FEITOS NESTA SEMANA: ${rit}`,
    ].join("\n\n");

    let plano: { foco: string; feito: string[]; proximos: Array<{ titulo: string; passo: string; motivo: string }> } | null = null;
    let source = "fallback";
    try {
      const providers = resolveAiProviderChain({ primaryModels: PRIMARY_MODEL_CHAIN, lovableModels: DEFAULT_LOVABLE_MODEL_CHAIN });
      const { response } = await requestAiChatCompletion(providers, {
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: fatos },
        ],
        temperature: 0.3,
      });
      if (response.ok) {
        const completion = await response.json();
        const parsed = extractJson(completion?.choices?.[0]?.message?.content || "");
        if (parsed) {
          const lim = (v: unknown, n: number) => (Array.isArray(v) ? v.slice(0, n) : []);
          plano = {
            foco: String(parsed.foco ?? "").slice(0, 240),
            feito: lim(parsed.feito, 6).map((x) => String(x).slice(0, 200)),
            proximos: lim(parsed.proximos, 6).map((x: any) => ({ titulo: String(x?.titulo ?? "").slice(0, 80), passo: String(x?.passo ?? "").slice(0, 200), motivo: String(x?.motivo ?? "").slice(0, 200) })).filter((x: any) => x.titulo && x.passo),
          };
          source = "ai";
        }
      }
    } catch (e) {
      console.warn(`[esteira-semana] IA falhou: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Sem IA: o que o painel prova sozinho (publicados e tarefas feitas), sem inventar proximos.
    if (!plano) {
      plano = {
        foco: "",
        feito: [...postsLinhas.filter((l) => l.startsWith("- PUBLICADO")).map((l) => l.replace("- PUBLICADO nesta semana: ", "Publicado: ")), ...tarefas.filter((l) => l.startsWith("- FEITA")).map((l) => l.replace("- FEITA nesta semana: ", "Concluida: "))].slice(0, 6),
        proximos: [],
      };
    }

    // Grava o plano da semana (uma linha por geracao; a mais recente vale).
    await db.from("project_memory").insert({
      client_id: clientId,
      kind: "esteira_plano",
      title: `Plano da semana ${weekStart}`,
      content: [plano.foco, ...plano.proximos.map((p) => `- ${p.titulo}: ${p.passo}`)].filter(Boolean).join("\n").slice(0, 4000),
      source: "esteira",
      metadata: { week_start: weekStart, foco: plano.foco, feito: plano.feito, proximos: plano.proximos, source },
      created_by: userData.user.id,
    });

    return jsonResponse({ ...plano, source, cached: false, generated_at: new Date().toISOString() });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Erro inesperado." }, 500);
  }
});
