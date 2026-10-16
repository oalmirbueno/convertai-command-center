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

import { corsHeaders as corsDoSupabase } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  requestAiChatCompletion,
  resolverCadeiaDaIa,
  type AiProvider,
} from "../_shared/ai-provider.ts";
import { resumoDoCerebro } from "../_shared/cerebro-nas-mesas.ts";
import type { BancoDoCerebro } from "../_shared/cerebro-do-cliente.ts";
import { recortarDossie } from "../_shared/dossie-recortado.ts";
// Frente SPP (30/09): o radar com o método da casa (só a prova; o código escolhe).
import { registrarMetodoSemUso, superpoderesPara } from "../_shared/superpoderes.ts";
// O navegador guarda a resposta do preflight (OPTIONS) em vez de perguntar de novo a cada chamada.
const corsHeaders = { ...corsDoSupabase, "Access-Control-Max-Age": "7200" };

// Modelos com busca na web embutida primeiro; sem busca como reserva.
const PRIMARY_MODEL_CHAIN = ["gpt-4o-mini-search-preview", "gpt-4o-mini"];
const LOVABLE_COMPAT_MODEL_CHAIN = [
  "google/gemini-3-flash-preview",
  "google/gemini-2.5-flash",
  "openai/gpt-5-mini",
];

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
8. Uma oferta ou campanha pontual (um produto em promoção neste mês) não é o negócio do cliente. Use como contexto, nunca como o centro das três ideias.

Responda SOMENTE com JSON válido, sem markdown, neste formato exato:
{"ideas":[{"titulo":"...","descricao":"...","por_que_agora":"...","passos":["...","...","..."],"sinal":"...","interno_oferta":"...","interno_faixa_min":0,"interno_faixa_max":0,"interno_esforco":"baixo|medio|alto"}]}`;

// Evoluir uma ideia (16/10/2026, dono: "conversar ali com o agente para a gente
// conseguir trabalhar em cima daquelas ideias e evoluir"). A equipe conversa
// sobre UMA ideia; o agente relê o mesmo contexto real do cliente, responde
// curto e devolve a ideia inteira reescrita no mesmo formato da geração.
const EVOLUIR_PROMPT = `Você é o estrategista-chefe de crescimento da Aceleriq, uma agência de growth marketing brasileira, especialista em marketing de diferenciação (a escola do Fator X, de Pedro Superti). Agora você conversa com a EQUIPE da Aceleriq sobre UMA ideia do Radar de um cliente, para evoluí-la junto com eles.

REGRAS ABSOLUTAS:
1. Leia o contexto real do cliente e a ideia atual. Responda ao pedido da equipe em 1 a 4 frases curtas, direto, como um colega de trabalho.
2. Sempre devolva a ideia INTEIRA já reescrita com o que foi pedido. Mantenha o que estava bom; mude o que a equipe pediu.
3. As regras das ideias continuam: nada genérico (cite o negócio, o nicho e o que o cliente já tem), descrição completa em 2 a 4 frases, "por que agora" com fatos reais do contexto, passos que a AGÊNCIA executa em 1 a 2 semanas.
4. Se o contexto mostrar que o pedido já foi feito ou não cabe neste cliente, diga isso na resposta e proponha o ajuste.
5. Nunca invente número que não está no contexto. Nunca sugira migração de plano, reajuste ou cobrança fora dos campos internos.
6. Português claro do Brasil, sem jargão de marketing e SEM TRAVESSÃO (use vírgula ou ponto).

Responda SOMENTE com JSON válido, sem markdown, neste formato exato:
{"resposta":"...","ideia":{"titulo":"...","descricao":"...","por_que_agora":"...","passos":["...","...","..."],"sinal":"...","interno_oferta":"...","interno_faixa_min":0,"interno_faixa_max":0,"interno_esforco":"baixo|medio|alto"}}`;

// Pedidos de atalho dentro do "evoluir" (16/10/2026, dono: "se eu clicar numa ideia, abrir
// ela, ter mais ideias e evoluir com a gente. Dá para trazer mais Reels aqui também"). Sem
// `pedido`, o "evoluir" segue igual. Com ele, a ideia atual volta sem mudança e vem junto a
// lista pedida, no mesmo JSON.
type PedidoDoEvoluir = "variacoes" | "reels";

const INSTRUCAO_DO_PEDIDO: Record<PedidoDoEvoluir, string> = {
  variacoes: `PEDIDO ESPECIAL: a equipe quer MAIS IDEIAS COMO ESTA. Devolva a "ideia" atual SEM mudanças e, no campo "variacoes", até 3 ideias novas para o mesmo cliente, no MESMO formato da ideia, seguindo as mesmas regras. Cada variação muda o ângulo (outro formato, outro público, outra prova), nunca só as palavras. A "resposta" diz em 1 frase o que diferencia as variações.
Formato exato: {"resposta":"...","ideia":{...a ideia atual...},"variacoes":[{"titulo":"...","descricao":"...","por_que_agora":"...","passos":["..."],"sinal":"...","interno_oferta":"...","interno_faixa_min":0,"interno_faixa_max":0,"interno_esforco":"baixo|medio|alto"}]}`,
  reels: `PEDIDO ESPECIAL: a equipe quer IDEIAS DE REELS para executar esta ideia. Devolva a "ideia" atual SEM mudanças e, no campo "reels", até 4 Reels concretos para este cliente: "gancho" (a frase dos 2 primeiros segundos), "cena" (o que mostrar, gravável pela equipe com o que o cliente já tem) e "legenda" (curta, 1 ou 2 frases, sem hashtag). A "resposta" diz em 1 frase a linha dos Reels.
Formato exato: {"resposta":"...","ideia":{...a ideia atual...},"reels":[{"gancho":"...","cena":"...","legenda":"..."}]}`,
};

interface ReelDaIdeia {
  gancho: string;
  cena: string;
  legenda: string;
}

interface IdeiaDoRadar {
  titulo: string;
  descricao: string;
  por_que_agora: string;
  passos: string[];
  sinal: string;
  interno_oferta: string;
  interno_faixa_min: number;
  interno_faixa_max: number;
  interno_esforco: "baixo" | "medio" | "alto";
}

interface MensagemDaConversa {
  papel: "usuario" | "agente";
  texto: string;
}

/** A ideia no formato da geração, com limites de tamanho; `base` cobre o que faltar. */
function normalizarIdeia(bruta: unknown, base?: IdeiaDoRadar): IdeiaDoRadar | null {
  if (!bruta || typeof bruta !== "object") return base || null;
  const r = bruta as Record<string, unknown>;
  const txt = (v: unknown, max: number, reserva = "") => {
    const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
    return (s || reserva).slice(0, max);
  };
  const num = (v: unknown, reserva = 0) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : reserva;
  };
  const passos = Array.isArray(r.passos)
    ? r.passos.map((p) => txt(p, 300)).filter(Boolean).slice(0, 6)
    : [];
  const esforco = r.interno_esforco === "baixo" || r.interno_esforco === "alto" || r.interno_esforco === "medio"
    ? r.interno_esforco
    : base?.interno_esforco || "medio";
  const ideia: IdeiaDoRadar = {
    titulo: txt(r.titulo, 160, base?.titulo),
    descricao: txt(r.descricao, 1200, base?.descricao),
    por_que_agora: txt(r.por_que_agora, 900, base?.por_que_agora),
    passos: passos.length ? passos : base?.passos || [],
    sinal: txt(r.sinal, 400, base?.sinal),
    interno_oferta: txt(r.interno_oferta, 200, base?.interno_oferta),
    interno_faixa_min: num(r.interno_faixa_min, base?.interno_faixa_min ?? 0),
    interno_faixa_max: num(r.interno_faixa_max, base?.interno_faixa_max ?? 0),
    interno_esforco: esforco,
  };
  if (!ideia.titulo || !ideia.descricao) return null;
  return ideia;
}

/** Histórico vindo do painel: só usuário/agente, texto limitado, as últimas 12 falas. */
function normalizarMensagens(brutas: unknown): MensagemDaConversa[] {
  if (!Array.isArray(brutas)) return [];
  return brutas
    .map((m) => {
      const r = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
      const papel = r.papel === "agente" ? "agente" : r.papel === "usuario" ? "usuario" : null;
      const texto = typeof r.texto === "string" ? r.texto.trim().slice(0, 2000) : "";
      return papel && texto ? { papel, texto } : null;
    })
    .filter((m): m is MensagemDaConversa => m !== null)
    .slice(-12);
}

/** Variações pedidas: até 3, no formato da geração, com os mesmos limites. */
function normalizarVariacoes(brutas: unknown): IdeiaDoRadar[] {
  if (!Array.isArray(brutas)) return [];
  return brutas
    .map((v) => normalizarIdeia(v))
    .filter((v): v is IdeiaDoRadar => v !== null)
    .slice(0, 3);
}

/** Reels pedidos: até 4, com gancho e cena obrigatórios e texto limitado. */
function normalizarReels(brutos: unknown): ReelDaIdeia[] {
  if (!Array.isArray(brutos)) return [];
  const txt = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
  return brutos
    .map((b) => {
      const r = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
      return { gancho: txt(r.gancho, 200), cena: txt(r.cena, 500), legenda: txt(r.legenda, 300) };
    })
    .filter((r) => r.gancho && r.cena)
    .slice(0, 4);
}

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

    // action "evoluir": conversa sobre uma ideia. Sem action, nada muda (gera as 3 ideias).
    const evoluir = body?.action === "evoluir";
    const ideiaAtual = evoluir ? normalizarIdeia(body?.ideia) : null;
    const mensagens = evoluir ? normalizarMensagens(body?.mensagens) : [];
    // Atalhos do "evoluir": "variacoes" (mais ideias como esta) ou "reels". Outro valor é ignorado.
    const pedido: PedidoDoEvoluir | null = evoluir && (body?.pedido === "variacoes" || body?.pedido === "reels") ? body.pedido : null;
    if (evoluir) {
      if (!ideiaAtual) return jsonResponse({ error: "A ideia atual (titulo e descricao) é obrigatória." }, 400);
      if (mensagens.length === 0 || mensagens[mensagens.length - 1].papel !== "usuario") {
        return jsonResponse({ error: "Mande o que mudar na ideia." }, 400);
      }
    }

    // ── Contexto real do cliente, lido com RLS do chamador ──
    const [profileRes, projectsRes, filesRes, pubsRes, reportsRes] = await Promise.all([
      db.from("profiles").select("full_name, company_name").eq("id", clientId).limit(1),
      db.from("projects")
        .select("name, project_type, status, created_at")
        .eq("client_id", clientId)
        .is("deleted_at", null),
      // Só o que chegou ao cliente (compartilhado ou aprovado). Antes vinham os
      // 8 arquivos mais novos de qualquer tipo: na Stop Informática eram 8
      // fotos internas de um mouse geradas na Mesa Foto, e a IA tratava a
      // oferta de R$ 9,90 como se fosse o negócio inteiro.
      db.from("files")
        .select("file_name, created_at")
        .eq("client_id", clientId)
        .is("archived_at", null)
        .is("parent_file_id", null)
        .or("visibility.eq.client_shared,approval_status.eq.approved")
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

    // Metricas REAIS do Instagram (coletadas da Meta pelo robo semanal):
    // a IA passa a citar numeros verdadeiros e tendencia, nunca genericos.
    const { data: igWeeks } = await db
      .from("social_metrics_weekly")
      .select("week_start, week_end, followers, reach, total_interactions, profile_views")
      .eq("client_id", clientId)
      .order("week_start", { ascending: false })
      .limit(4);
    const { data: igPosts } = await db
      .from("social_post_metrics")
      .select("caption, media_type, like_count, comments_count, reach, saved, shares")
      .eq("client_id", clientId)
      .order("posted_at", { ascending: false })
      .limit(10);
    const igLines: string[] = [];
    if (igWeeks && igWeeks.length > 0) {
      const latest = igWeeks[0];
      const prev = igWeeks[1];
      const pct = (a: number | null, b: number | null) =>
        a != null && b ? ` (${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)}% vs semana anterior)` : "";
      igLines.push(
        `Instagram REAL (semana ${latest.week_start} a ${latest.week_end}): ` +
          `${latest.followers ?? "?"} seguidores${pct(latest.followers, prev?.followers)}, ` +
          `alcance ${latest.reach ?? "?"}${pct(latest.reach, prev?.reach)}, ` +
          `interações ${latest.total_interactions ?? "?"}${pct(latest.total_interactions, prev?.total_interactions)}`,
      );
    }
    if (igPosts && igPosts.length > 0) {
      const top = [...igPosts].sort(
        (a: any, b: any) =>
          (b.like_count || 0) + (b.comments_count || 0) - ((a.like_count || 0) + (a.comments_count || 0)),
      )[0];
      igLines.push(
        `Post que mais performou: "${String(top.caption || "").slice(0, 80)}" (${top.media_type || "post"}, ` +
          `${top.like_count ?? 0} curtidas, ${top.comments_count ?? 0} comentários` +
          `${top.reach != null ? `, alcance ${top.reach}` : ""}${top.saved != null ? `, ${top.saved} salvos` : ""})`,
      );
    }

    // O que o painel SABE do negócio: dossiê atual, briefing e as últimas
    // decisões. Sem isto a IA "deduzia o nicho pelo nome" e devolvia ideia
    // que servia para qualquer empresa.
    // O cérebro do cliente (o que ele já ensinou às mesas: tom, o que evitar,
    // o que performou) entra junto. O dossiê geral da Stop, por exemplo, abre
    // com 1.400 caracteres sobre o envio no WhatsApp e nada sobre o negócio.
    const cerebroP = resumoDoCerebro(db as unknown as BancoDoCerebro, clientId, ["geral", "conta", "copy", "campanha"], {
      limite: 1500,
      titulo: "CÉREBRO DO CLIENTE (o que o cliente e a equipe já ensinaram; vale sobre suposição sua)",
      manter: (f) => !/^Plano do mês /.test(f.texto),
    });
    const [dossieRes, briefingRes, memoriaRes] = await Promise.all([
      db.from("client_dossiers")
        .select("id, version, summary, content, updated_at, project_id, dossier_type, prior_version_id")
        .eq("client_id", clientId)
        .eq("is_current", true)
        .order("updated_at", { ascending: false })
        .limit(4),
      // A coluna é "responses": "answers" nunca existiu, a leitura dava erro e
      // o briefing do cliente nunca chegava ao Radar.
      db.from("briefings")
        .select("responses, created_at")
        .eq("client_id", clientId)
        .eq("submitted", true)
        .order("created_at", { ascending: false })
        .limit(1),
      db.from("project_memory")
        .select("kind, title, content, created_at")
        .eq("client_id", clientId)
        .in("kind", ["decisao", "marco", "nota", "summary", "ritual", "second_brain", "external"])
        .order("created_at", { ascending: false })
        .limit(6),
    ]);
    // O GERAL manda (nunca o de projeto por ser mais novo); projeto complementa.
    const dossiesAtuais = ((dossieRes.data || []) as any[]).sort((a, b) => Number(Boolean(a.project_id)) - Number(Boolean(b.project_id)));
    const dossieLines = dossiesAtuais.map((d: any) => {
      // AB2: o começo curto e o FIM (seções mais recentes), nunca só o começo.
      const texto = recortarDossie(String(d.content || d.summary || "").replace(/\s+/g, " ").trim(), d.project_id ? 500 : 1400).replace(/\s+/g, " ");
      return texto
        ? `DOSSIÊ ${d.project_id ? "do projeto (complemento)" : "GERAL (fonte da verdade)"} (v${d.version ?? "?"}, ${String(d.updated_at || "").slice(0, 10)}): ${texto}`
        : "";
    }).filter(Boolean);
    // O que mudou desde a versão anterior do geral: ideia boa nasce do que
    // acabou de mover, não do retrato de sempre.
    const geral = dossiesAtuais.find((d: any) => !d.project_id);
    let mudancaLine = "";
    if (geral?.prior_version_id) {
      const { data: prev } = await db.from("client_dossiers").select("content, summary, version").eq("id", geral.prior_version_id).maybeSingle();
      const limpar = (l: string) => l.replace(/^[\s#*\-•>]+/, "").replace(/\s+/g, " ").trim();
      const antes = new Set(String(prev?.content || prev?.summary || "").split(/\r?\n+/).map(limpar).filter((l) => l.length >= 12).map((l) => l.toLowerCase()));
      const novas: string[] = [];
      let auto = false;
      for (const linha of String(geral.content || "").split(/\r?\n/)) {
        const t = linha.trim();
        if (/^##\s*avan[cç]os recentes/i.test(t)) { auto = true; continue; }
        if (/^##?\s+/.test(t)) { auto = false; continue; }
        if (auto) continue;
        const limpa = limpar(t);
        if (limpa.length < 12 || antes.has(limpa.toLowerCase())) continue;
        novas.push(limpa.slice(0, 200));
        if (novas.length >= 6) break;
      }
      if (novas.length) mudancaLine = `O QUE MUDOU NO DOSSIÊ GERAL desde a v${prev?.version ?? "?"} (parta daqui: é o que acabou de acontecer): ${novas.join(" | ")}`;
    }
    // O foco desta semana pela esteira, quando ja foi lido.
    const segunda = (() => { const x = new Date(); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); return x.toISOString().slice(0, 10); })();
    const { data: planoRes } = await db.from("project_memory").select("metadata").eq("client_id", clientId).eq("kind", "esteira_plano").contains("metadata", { week_start: segunda }).order("created_at", { ascending: false }).limit(1);
    const foco = String((planoRes?.[0] as any)?.metadata?.foco || "").trim();
    const focoLine = foco ? `FOCO DESTA SEMANA (plano da esteira): ${foco}` : "";
    const briefing = (briefingRes.data?.[0] as { responses?: unknown } | undefined)?.responses;
    const briefingLine = briefing
      ? `BRIEFING (respostas do cliente): ${JSON.stringify(briefing).slice(0, 900)}`
      : "";
    const memoriaLines = (memoriaRes.data || []).map(
      (m: any) => `Registro (${m.kind}, ${String(m.created_at || "").slice(0, 10)}): ${String(m.title || "")} — ${String(m.content || "").replace(/\s+/g, " ").slice(0, 220)}`,
    );

    // Frente P (26/09): sinais dos concorrentes monitorados (Perfis do Instagram,
    // Contexto da Mesa). Só leitura, com o JWT de quem chamou; sem a tabela, nada muda.
    let concorrentesLine = "";
    try {
      const desde = new Date(Date.now() - 35 * 24 * 3600 * 1000).toISOString();
      const { data: rodadas, error: erroRodadas } = await db
        .from("cliente_perfis_rodadas")
        .select("perfil_id, ideias, fora_da_curva, iniciada_em")
        .eq("client_id", clientId)
        .in("tipo", ["monitoramento", "ideias"])
        .gte("iniciada_em", desde)
        .order("iniciada_em", { ascending: false })
        .limit(6);
      const sinais: string[] = [];
      if (!erroRodadas) {
        for (const r of (rodadas || []) as Array<{ ideias?: unknown; fora_da_curva?: number }>) {
          for (const i of Array.isArray(r.ideias) ? r.ideias as Array<Record<string, unknown>> : []) {
            const tema = String(i?.tema || "").replace(/\s+/g, " ").trim().slice(0, 120);
            if (tema) sinais.push(`${tema}${i?.por_que ? ` (${String(i.por_que).replace(/\s+/g, " ").slice(0, 140)})` : ""}`);
            if (sinais.length >= 5) break;
          }
          if (sinais.length >= 5) break;
        }
      }
      if (sinais.length) concorrentesLine = `SINAIS DOS CONCORRENTES (monitoramento do Instagram, ideias de resposta ainda não decididas): ${sinais.join(" | ")}`;
    } catch {
      concorrentesLine = "";
    }

    const cerebro = await cerebroP;
    const context = [
      `Cliente: ${clientName}`,
      cerebro.texto,
      ...dossieLines,
      mudancaLine,
      focoLine,
      briefingLine,
      ...memoriaLines,
      ...igLines,
      concorrentesLine,
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

    const temDossie = dossieLines.length > 0 || Boolean(briefingLine);
    const userPrompt = `CONTEXTO REAL DO CLIENTE (dados do painel, hoje):\n${context}\n\nPasso 1: ${
      temDossie
        ? "o nicho, o diferencial e a situação atual estão no DOSSIÊ/BRIEFING acima — parta deles, não deduza nada que o dossiê já diz, e NÃO proponha o que o dossiê ou os registros mostram que já foi feito ou já está em andamento."
        : "não há dossiê registrado: deduza o nicho pelo nome e pelos materiais e diga explicitamente que a ideia é uma hipótese a validar com o dossiê."
    } Passo 2: busque na web tendências e formatos que estão funcionando AGORA para esse nicho no Brasil (Instagram, TikTok, experiência do cliente). Passo 3: gere as 3 ideias seguindo as regras, cada uma citando o fato do dossiê/registro que a justifica. Lembre: específicas para ${clientName}, com a descrição completa da ideia.`;

    const providers = await resolverCadeiaDaIa({
      primaryModels: PRIMARY_MODEL_CHAIN,
      lovableModels: LOVABLE_COMPAT_MODEL_CHAIN,
    });

    const metodoDoRadar = await superpoderesPara(db, { agente: "rituais.radar" });

    if (evoluir && ideiaAtual) {
      // Mesmo contexto, mesma cadeia de modelos e o mesmo método; só o pedido muda.
      const historico = mensagens.map((m, i) => ({
        role: m.papel === "usuario" ? "user" : "assistant",
        content: i === mensagens.length - 1
          ? `${m.texto}\n\n(Devolva só o JSON, com "resposta" e a "ideia" completa${
            pedido === "variacoes" ? ' e as "variacoes"' : pedido === "reels" ? ' e os "reels"' : ""
          }.)`
          : m.texto,
      }));
      const sistema = pedido ? `${EVOLUIR_PROMPT}\n\n${INSTRUCAO_DO_PEDIDO[pedido]}` : EVOLUIR_PROMPT;
      const conversa = await requestAiChatCompletion(
        providers,
        (candidate: AiProvider) => ({
          messages: [
            { role: "system", content: sistema },
            {
              role: "user",
              content: `CONTEXTO REAL DO CLIENTE (dados do painel, hoje):\n${context}\n\nIDEIA ATUAL DO RADAR (JSON):\n${JSON.stringify(ideiaAtual)}\n\n${
                temDossie
                  ? "Parta do DOSSIÊ/BRIEFING acima e não proponha o que os registros mostram que já foi feito."
                  : "Não há dossiê registrado: trate o nicho como hipótese a validar."
              } Específica para ${clientName}.`,
            },
            ...historico,
          ],
          ...(candidate.model.includes("search-preview")
            ? { web_search_options: {} }
            : { temperature: 0.6 }),
        }),
        fetch,
        metodoDoRadar,
      );
      if (!conversa.response.ok) {
        const detail = await conversa.response.text().catch(() => "");
        return jsonResponse(
          { error: `O agente do Radar não respondeu (${conversa.response.status}).`, detail: detail.slice(0, 300) },
          502,
        );
      }
      void registrarMetodoSemUso(db, { metodo: metodoDoRadar, clientId });
      const completion = await conversa.response.json();
      const content = completion?.choices?.[0]?.message?.content || "";
      let parsed: { resposta?: unknown; ideia?: unknown; variacoes?: unknown; reels?: unknown } = {};
      try {
        parsed = extractJson(content) as { resposta?: unknown; ideia?: unknown; variacoes?: unknown; reels?: unknown };
      } catch {
        return jsonResponse({ error: "O agente não devolveu uma ideia válida. Tente de novo." }, 502);
      }
      // Com pedido, a ideia atual fica como estava (o pedido é a lista, não reescrever).
      const nova = pedido ? ideiaAtual : normalizarIdeia(parsed?.ideia, ideiaAtual);
      const resposta = typeof parsed?.resposta === "string" ? parsed.resposta.trim().slice(0, 2000) : "";
      if (!nova) return jsonResponse({ error: "O agente não devolveu uma ideia válida. Tente de novo." }, 502);
      const variacoes = pedido === "variacoes" ? normalizarVariacoes(parsed?.variacoes) : [];
      const reels = pedido === "reels" ? normalizarReels(parsed?.reels) : [];
      if (pedido === "variacoes" && variacoes.length === 0) {
        return jsonResponse({ error: "O agente não devolveu variações válidas. Tente de novo." }, 502);
      }
      if (pedido === "reels" && reels.length === 0) {
        return jsonResponse({ error: "O agente não devolveu Reels válidos. Tente de novo." }, 502);
      }
      return jsonResponse({
        client_id: clientId,
        client_name: clientName,
        provider: conversa.provider.label,
        web_search: conversa.provider.model.includes("search-preview"),
        resposta: resposta || (pedido === "variacoes"
          ? "Trouxe variações desta ideia."
          : pedido === "reels"
          ? "Trouxe Reels para executar esta ideia."
          : "Ajustei a ideia com o que você pediu."),
        ideia: nova,
        ...(pedido === "variacoes" ? { variacoes } : {}),
        ...(pedido === "reels" ? { reels } : {}),
      });
    }

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
      fetch,
      metodoDoRadar,
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return jsonResponse(
        { error: `O gerador de ideias não respondeu (${response.status}).`, detail: detail.slice(0, 300) },
        502,
      );
    }

    // Frente SPP (revisão 30/09): a cadeia antiga não grava em ia_usos; o método conta pelo registro sem uso.
    void registrarMetodoSemUso(db, { metodo: metodoDoRadar, clientId });
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
