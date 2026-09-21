import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

/**
 * O que e aquele arquivo? Julgamento tipado com TypeSafe (modelo Jev).
 *
 * Regra do dono (2026-09-21): o dossie, o diario do portal e os rituais
 * dizem o que cada material e ("Carrossel", "Documento", "Arte"). Isso vem
 * de files.file_type, que muitas vezes chega vazio ou generico ("outro",
 * "application/pdf", "image"). Aqui uma Choice do Jev escolhe o tipo dentro
 * da taxonomia do painel (src/lib/fileTaxonomy.ts) olhando nome, pasta,
 * legenda, descricao, extensao e numero de laminas. O resultado vira DADO
 * (files.file_type + extracted_metadata.jev): tudo o que le o tipo depois
 * nao precisa de IA em tempo de tela.
 *
 * Codigo decide; o modelo so julga. So grava quando a confianca da Choice
 * passa do corte; abaixo dele o arquivo fica como esta e e revisto na
 * proxima rodada (ate 3 tentativas por arquivo).
 *
 * Chamada: pelo cron (x-cron-secret) ou por equipe (JWT). Sem
 * TYPESAFE_API_KEY a funcao responde "sem chave" e nao muda nada.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
const MODELO = "jev-latest";
const LOTE = 20;
const CORTE_DE_CONFIANCA = 0.6;
const MAX_TENTATIVAS = 3;

// Mesmos ids de src/lib/fileTaxonomy.ts (FileKindId).
const TIPOS: Record<string, string> = {
  carrossel: "Sequência de lâminas/slides para Instagram (nome com '(2/4)', 'carrossel', varias páginas de arte)",
  post: "Arte única de feed (imagem estática para publicar)",
  story: "Arte vertical para stories",
  video: "Vídeo ou reels (mp4, mov, 'reel', 'vídeo')",
  logo: "Logotipo, símbolo, marca, brandbook, identidade visual",
  foto: "Fotografia bruta ou registro fotográfico (não é arte finalizada)",
  documento: "Documento de texto, PDF ou apresentação de uso geral (manual, guia, proposta, ata)",
  contrato: "Contrato, termo, aditivo ou proposta comercial assinável",
  relatorio: "Relatório de resultados, métricas, entrega ou prestação de contas",
  estrategico: "Planejamento, estratégia, plano de marketing, linha editorial, calendário",
  briefing: "Briefing do cliente, formulário de entrada, levantamento inicial",
  outro: "Nenhum dos anteriores",
};

// file_type que ja diz o que o arquivo e: nao mexe.
const TIPOS_CONFIAVEIS = new Set(["carrossel", "post", "story", "video", "logo", "foto", "documento", "contrato", "relatorio", "estrategico", "briefing", "creative", "criativo"]);

type Arquivo = {
  id: string;
  file_name: string | null;
  file_type: string | null;
  folder: string | null;
  mime_type: string | null;
  extension: string | null;
  caption: string | null;
  description: string | null;
  carousel_text: string | null;
  slide_count: number | null;
  page_count: number | null;
  extracted_metadata: Record<string, unknown> | null;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function autorizado(req: Request, admin: ReturnType<typeof createClient>): Promise<boolean> {
  const cronSecret = Deno.env.get("CRON_SECRET")?.trim();
  if (cronSecret && req.headers.get("x-cron-secret")?.trim() === cronSecret) return true;
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  if (token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return true;
  const { data: user } = await admin.auth.getUser(token);
  if (!user?.user?.id) return false;
  const { data: staff } = await admin.rpc("is_staff", { _user_id: user.user.id });
  return staff === true;
}

function estadoDoArquivo(f: Arquivo) {
  const laminas = f.slide_count && f.slide_count > 1 ? f.slide_count : null;
  return {
    nome: f.file_name || "",
    pasta: f.folder || "",
    tipo_informado: f.file_type || "",
    mime: f.mime_type || "",
    extensao: f.extension || "",
    laminas,
    paginas: f.page_count || null,
    legenda: (f.caption || "").slice(0, 300),
    descricao: (f.description || "").slice(0, 300),
    texto_do_carrossel: f.carousel_text ? "sim" : "não",
  };
}

async function julgarLote(chave: string, arquivos: Arquivo[]) {
  const state = { arquivos: arquivos.map(estadoDoArquivo) };
  const questions: Record<string, unknown> = {};
  arquivos.forEach((_, i) => {
    questions[`tipo_${i}`] = {
      type: "choice",
      instructions: {
        question: `Qual é o tipo do material descrito em \`arquivos[${i}]\`, dentro da taxonomia do painel de uma agência de marketing?`,
        dicas: "Use nome, pasta, extensão, legenda, descrição e número de lâminas. '(2/4)' ou várias lâminas indicam carrossel. PDF de contrato é contrato; PDF de resultados é relatório; PDF de plano é estratégico.",
      },
      criteria: TIPOS,
    };
  });
  const res = await fetch(TYPESAFE_URL, {
    method: "POST",
    headers: { "Authorization": `Bearer ${chave}`, "Content-Type": "application/json" },
    body: JSON.stringify({ state, model: MODELO, questions }),
  });
  if (!res.ok) throw new Error(`typesafe_${res.status}`);
  const data = await res.json() as { answers?: Record<string, { choice?: string; confidence?: number; probabilities?: Record<string, number> }> };
  return arquivos.map((f, i) => {
    const a = data.answers?.[`tipo_${i}`];
    return { id: f.id, tipo: a?.choice ?? null, confianca: typeof a?.confidence === "number" ? a.confidence : 0, probabilidades: a?.probabilities ?? null };
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (!(await autorizado(req, admin))) return json({ error: "unauthorized" }, 401);

  const chave = Deno.env.get("TYPESAFE_API_KEY")?.trim();
  if (!chave) return json({ ok: true, skipped: "sem TYPESAFE_API_KEY" });

  let corpo: Record<string, unknown> = {};
  try { corpo = await req.json(); } catch { /* corpo vazio e normal no cron */ }
  const limite = Math.min(60, Math.max(1, Number(corpo.limit) || 40));
  const clientId = typeof corpo.client_id === "string" ? corpo.client_id : null;

  // Candidatos: capa (sem parent), sem tipo confiavel, poucas tentativas.
  let q = admin.from("files")
    .select("id, file_name, file_type, folder, mime_type, extension, caption, description, carousel_text, slide_count, page_count, extracted_metadata")
    .is("archived_at", null)
    .is("parent_file_id", null)
    .order("created_at", { ascending: false })
    .limit(limite * 3);
  if (clientId) q = q.eq("client_id", clientId);
  const { data: rows, error } = await q;
  if (error) return json({ error: error.message }, 500);

  const candidatos = ((rows ?? []) as Arquivo[]).filter((f) => {
    const tipo = (f.file_type || "").toLowerCase().trim();
    if (TIPOS_CONFIAVEIS.has(tipo)) return false;
    const jev = (f.extracted_metadata?.jev ?? null) as { tentativas?: number } | null;
    return (jev?.tentativas ?? 0) < MAX_TENTATIVAS;
  }).slice(0, limite);

  let classificados = 0, incertos = 0;
  const resultado: Array<{ id: string; tipo: string | null; confianca: number; gravado: boolean }> = [];
  for (let i = 0; i < candidatos.length; i += LOTE) {
    const lote = candidatos.slice(i, i + LOTE);
    let julgamentos: Awaited<ReturnType<typeof julgarLote>>;
    try {
      julgamentos = await julgarLote(chave, lote);
    } catch (err) {
      console.error("materiais-classificar: typesafe falhou", { error: err instanceof Error ? err.message : "unknown" });
      return json({ ok: false, error: "typesafe_indisponivel", classificados, incertos }, 502);
    }
    for (const j of julgamentos) {
      const f = lote.find((x) => x.id === j.id)!;
      const jevAnterior = (f.extracted_metadata?.jev ?? {}) as Record<string, unknown>;
      const tentativas = (Number(jevAnterior.tentativas) || 0) + 1;
      const gravar = !!j.tipo && j.tipo in TIPOS && j.tipo !== "outro" && j.confianca >= CORTE_DE_CONFIANCA;
      const jev = { tipo: j.tipo, confianca: j.confianca, probabilidades: j.probabilidades, modelo: MODELO, tentativas, em: new Date().toISOString(), gravado: gravar };
      const patch: Record<string, unknown> = { extracted_metadata: { ...(f.extracted_metadata ?? {}), jev } };
      if (gravar) patch.file_type = j.tipo;
      const { error: upErr } = await admin.from("files").update(patch).eq("id", f.id);
      if (upErr) console.error("materiais-classificar: update falhou", { id: f.id, error: upErr.message });
      if (gravar) classificados += 1; else incertos += 1;
      resultado.push({ id: f.id, tipo: j.tipo, confianca: j.confianca, gravado: gravar });
    }
  }
  return json({ ok: true, candidatos: candidatos.length, classificados, incertos, resultado });
});
