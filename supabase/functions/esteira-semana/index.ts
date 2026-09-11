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
- LEIA OS NUMEROS: quando houver metricas (alcance, seguidores, interacoes, leads, gasto), o "foco" e pelo menos um dos "proximos" precisam partir deles e apontar direcao concreta (ex.: alcance caiu 30% em duas semanas com 5 posts agendados: revisar formato dos proximos 2 posts; gasto subiu e lead caiu: pausar a campanha X e testar criativo novo). Nunca so descreva o numero; diga o que fazer por causa dele.
- VENDAS mandam na otimizacao de anuncio: quando houver linha de VENDAS, o proximo passo de trafego parte dela (campanha que vendeu recebe verba; campanha que gastou sem vender e pausada ou troca criativo; leads sem venda e problema de atendimento/oferta, nao de campanha). Cite a campanha e o numero. Venda registrada sem valor ainda conta como venda.
- Progressao: compare o dossie (onde estava) com a historia (o que andou) e diga o proximo degrau, nao o mesmo passo de sempre.
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

    const desde28 = new Date(semanaIni.getTime() - 28 * 86_400_000).toISOString().slice(0, 10);
    const desde14dia = new Date(semanaIni.getTime() - 14 * 86_400_000).toISOString().slice(0, 10);
    const [perfil, dossie, historia, projetos, posts, rituais, metricas, adsDiario, vendas] = await Promise.all([
      db.from("profiles").select("full_name, company_name, services_config, created_at").eq("id", clientId).maybeSingle(),
      // Todos os atuais: o GERAL (contexto, sem projeto) manda; projeto complementa.
      db.from("client_dossiers").select("id, project_id, dossier_type, version, summary, content, updated_at, prior_version_id").eq("client_id", clientId).eq("is_current", true).order("updated_at", { ascending: false }),
      db.from("project_memory").select("kind, title, content, created_at").eq("client_id", clientId).neq("kind", "esteira_plano").gte("created_at", desde14).order("created_at", { ascending: false }).limit(40),
      db.from("projects").select("id, name, tasks(title, status, due_date, updated_at), milestones(title, status, target_date)").eq("client_id", clientId).is("deleted_at", null),
      db.from("editorial_posts").select("title, production_status, primary_file_id, editorial_publications(status, scheduled_at, published_at)").eq("client_id", clientId).is("archived_at", null).order("created_at", { ascending: false }).limit(40),
      db.from("cycle_rituals").select("ritual_key, source").eq("client_id", clientId).eq("week_start", weekStart),
      db.from("social_metrics_weekly").select("external_account_id, week_start, reach, followers, total_interactions").eq("client_id", clientId).gte("week_start", desde28).order("week_start", { ascending: false }),
      db.from("ads_campaign_daily").select("campaign_name, day, spend, actions, action_values").eq("client_id", clientId).gte("day", desde14dia),
      db.from("ads_sales").select("sold_at, platform, campaign_name, channel, quantity, value, source").eq("client_id", clientId).gte("sold_at", desde14dia).order("sold_at", { ascending: false }),
    ]);

    // Numeros: alcance/seguidores/interacoes por semana (por conta) e
    // gasto/leads 7d contra os 7 anteriores, por campanha.
    const contarLeads = (actions: unknown): number => {
      if (!Array.isArray(actions)) return 0;
      let t = 0;
      for (const a of actions as Array<{ action_type?: string; value?: unknown }>) {
        const tipo = String(a?.action_type ?? "").toLowerCase();
        if (tipo.includes("lead") || tipo.includes("messaging_conversation_started")) t += Number(a.value) || 0;
      }
      return t;
    };
    const metricasLinhas: string[] = [];
    const porConta = new Map<string, Array<Record<string, any>>>();
    for (const m of (metricas.data ?? []) as Array<Record<string, any>>) {
      const k = String(m.external_account_id ?? "conta");
      porConta.set(k, [...(porConta.get(k) ?? []), m]);
    }
    for (const [conta, lista] of porConta) {
      const seq = lista.slice(0, 4).map((m) => `${String(m.week_start).slice(5)}: alcance ${m.reach ?? "?"}, seguidores ${m.followers ?? "?"}, interacoes ${m.total_interactions ?? "?"}`);
      metricasLinhas.push(`- Instagram (${conta.slice(-4)}), da mais recente para a anterior: ${seq.join(" | ")}`);
    }
    const agora7 = { spend: 0, leads: 0 };
    const antes7 = { spend: 0, leads: 0 };
    const porCampanha = new Map<string, { spend: number; leads: number }>();
    const corte = new Date(Date.now() - 7 * 86_400_000).getTime();
    for (const d of (adsDiario.data ?? []) as Array<Record<string, any>>) {
      const t = new Date(String(d.day)).getTime();
      const alvo = t >= corte ? agora7 : antes7;
      alvo.spend += Number(d.spend) || 0;
      alvo.leads += contarLeads(d.actions);
      if (t >= corte) {
        const c = porCampanha.get(String(d.campaign_name)) ?? { spend: 0, leads: 0 };
        c.spend += Number(d.spend) || 0;
        c.leads += contarLeads(d.actions);
        porCampanha.set(String(d.campaign_name), c);
      }
    }
    if (agora7.spend > 0 || antes7.spend > 0) {
      metricasLinhas.push(`- Anuncios ultimos 7 dias: R$ ${agora7.spend.toFixed(0)} e ${agora7.leads} leads | 7 dias anteriores: R$ ${antes7.spend.toFixed(0)} e ${antes7.leads} leads`);
      for (const [nome, v] of porCampanha) metricasLinhas.push(`  - ${nome}: R$ ${v.spend.toFixed(0)}, ${v.leads} leads (7d)`);
    }

    // VENDAS: registradas a mao no painel (WhatsApp, Instagram, balcao) +
    // compras rastreadas pela plataforma (pixel). E o numero que paga o
    // anuncio; o plano precisa partir dele.
    const TIPOS_COMPRA = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase", "onsite_conversion.purchase"];
    const compraDe = (lista: unknown): number => {
      if (!Array.isArray(lista)) return 0;
      const porTipo = new Map<string, number>();
      for (const a of lista as Array<{ action_type?: string; value?: unknown }>) porTipo.set(String(a?.action_type ?? "").toLowerCase(), (porTipo.get(String(a?.action_type ?? "").toLowerCase()) ?? 0) + (Number(a?.value) || 0));
      for (const t of TIPOS_COMPRA) { const v = porTipo.get(t); if (v && v > 0) return v; }
      return 0;
    };
    const vendasAgora = { qtd: 0, valor: 0, semValor: 0 };
    const vendasAntes = { qtd: 0, valor: 0 };
    const vendasPorCampanha = new Map<string, { qtd: number; valor: number }>();
    const vendasPorCanal = new Map<string, number>();
    for (const d of (adsDiario.data ?? []) as Array<Record<string, any>>) {
      const compras = compraDe(d.actions);
      if (!compras) continue;
      const t = new Date(String(d.day)).getTime();
      const alvo = t >= corte ? vendasAgora : vendasAntes;
      alvo.qtd += compras;
      alvo.valor += compraDe(d.action_values);
      if (t >= corte) {
        const c = vendasPorCampanha.get(String(d.campaign_name)) ?? { qtd: 0, valor: 0 };
        c.qtd += compras; c.valor += compraDe(d.action_values);
        vendasPorCampanha.set(String(d.campaign_name), c);
      }
    }
    for (const v of (vendas.data ?? []) as Array<Record<string, any>>) {
      const t = new Date(`${String(v.sold_at)}T12:00:00Z`).getTime();
      const qtd = Math.max(1, Number(v.quantity) || 1);
      const valor = v.value == null ? null : Number(v.value) || 0;
      const alvo = t >= corte ? vendasAgora : vendasAntes;
      alvo.qtd += qtd;
      if (valor !== null) alvo.valor += valor; else if (t >= corte) vendasAgora.semValor += 1;
      if (t >= corte) {
        const nome = String(v.campaign_name ?? "sem campanha");
        const c = vendasPorCampanha.get(nome) ?? { qtd: 0, valor: 0 };
        c.qtd += qtd; c.valor += valor ?? 0;
        vendasPorCampanha.set(nome, c);
        vendasPorCanal.set(String(v.channel ?? "outro"), (vendasPorCanal.get(String(v.channel ?? "outro")) ?? 0) + qtd);
      }
    }
    if (agora7.spend > 0 || antes7.spend > 0 || vendasAgora.qtd > 0 || vendasAntes.qtd > 0) {
      const brl = (n: number) => `R$ ${n.toFixed(0)}`;
      metricasLinhas.push(`- VENDAS ultimos 7 dias: ${vendasAgora.qtd}${vendasAgora.valor > 0 ? ` (${brl(vendasAgora.valor)})` : ""}${vendasAgora.semValor > 0 ? `, ${vendasAgora.semValor} sem valor informado` : ""} | 7 dias anteriores: ${vendasAntes.qtd}${vendasAntes.valor > 0 ? ` (${brl(vendasAntes.valor)})` : ""}${agora7.spend > 0 && vendasAgora.qtd > 0 ? ` | custo por venda (7d): ${brl(agora7.spend / vendasAgora.qtd)}` : ""}`);
      for (const [nome, v] of vendasPorCampanha) metricasLinhas.push(`  - vendeu: ${nome}: ${v.qtd} venda(s)${v.valor > 0 ? ` (${brl(v.valor)})` : ""} (7d)`);
      if (vendasPorCanal.size) metricasLinhas.push(`  - por onde: ${[...vendasPorCanal.entries()].map(([c, n]) => `${c} ${n}`).join(", ")}`);
      if (agora7.leads > 0 && vendasAgora.qtd === 0) metricasLinhas.push(`  - ATENCAO: ${agora7.leads} leads em 7 dias e NENHUMA venda registrada: ou o atendimento nao converte, ou as vendas nao estao sendo registradas no painel`);
    }

    const nome = perfil.data?.company_name || perfil.data?.full_name || "Cliente";
    const servicos = Object.entries((perfil.data?.services_config ?? {}) as Record<string, unknown>).filter(([, v]) => v === true).map(([k]) => k).join(", ") || "nao informado";
    const atuais = (dossie.data ?? []) as Array<Record<string, any>>;
    const d = atuais.find((x) => (x.dossier_type ?? "contexto") === "contexto" && x.project_id == null) ?? atuais[0];
    const dossieTexto = String(d?.content || d?.summary || "").slice(0, 7000) || "(sem dossie escrito)";
    const complementos = atuais.filter((x) => x && d && x.id !== d.id).map((x) => `- projeto v${x.version ?? "?"}: ${String(x.summary || x.content || "").slice(0, 300)}`).join("\n");
    // A versao anterior do geral: o que entrou de novo e a progressao.
    let mudancas: string[] = [];
    if (d?.prior_version_id) {
      const { data: prev } = await db.from("client_dossiers").select("content, summary, version").eq("id", d.prior_version_id).maybeSingle();
      const antes = new Set(String(prev?.content || prev?.summary || "").split(/\r?\n+/).map((l: string) => l.replace(/^[\s#*\-•>]+/, "").replace(/\s+/g, " ").trim().toLowerCase()).filter((l: string) => l.length >= 12));
      let auto = false;
      for (const linha of String(d.content || "").split(/\r?\n/)) {
        const t = linha.trim();
        if (/^##\s*avan[cç]os recentes/i.test(t)) { auto = true; continue; }
        if (/^##?\s+/.test(t)) { auto = false; continue; }
        if (auto) continue;
        const limpa = t.replace(/^[\s#*\-•>]+/, "").replace(/\s+/g, " ").trim();
        if (limpa.length < 12 || antes.has(limpa.toLowerCase())) continue;
        mudancas.push(limpa.slice(0, 220));
        if (mudancas.length >= 8) break;
      }
      if (mudancas.length) mudancas = [`(v${prev?.version ?? "?"} -> v${d.version ?? "?"})`, ...mudancas];
    }

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
      `DOSSIE GERAL ATUAL (fonte da verdade sobre onde o cliente esta):\n${dossieTexto}`,
      `O QUE MUDOU NO DOSSIE DESDE A VERSAO ANTERIOR (progressao; o proximo degrau parte daqui):\n${mudancas.join("\n") || "(sem versao anterior ou nada novo)"}`,
      `DOSSIES DE PROJETO (complemento):\n${complementos || "(nenhum)"}`,
      `HISTORIA (ultimos 14 dias):\n${hist}`,
      `POSTS (o painel ja mostra os elos que faltam; nao repita):\n${postsLinhas.slice(0, 30).join("\n") || "(nenhum)"}`,
      `TAREFAS DO KANBAN (o painel ja mostra atrasadas e desta semana; nao repita):\n${tarefas.slice(0, 40).join("\n") || "(nenhuma)"}`,
      `MARCOS ABERTOS:\n${marcos.join("\n") || "(nenhum)"}`,
      `NUMEROS (leia e direcione por eles):\n${metricasLinhas.join("\n") || "(sem metricas coletadas ainda)"}`,
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
