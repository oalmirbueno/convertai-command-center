// Aceleriq OS — Voice Assistant Agent
// Senior operations agent. Interprets voice/text + attachments OR auto-fetches
// the client's contract from the portal storage, and returns a structured
// intent + a contract-aware action plan.
//
// Goals:
//  • Funcionar 100% no plano gratuito do Lovable AI (fallback chain de modelos
//    free; graceful-degrade pra "unknown" se TODOS falharem — nunca trava).
//  • Ler contrato direto do sistema: dado um clientId, busca o último contrato
//    em `contracts` e baixa o PDF pra extrair texto, sem o usuário precisar
//    arrastar nada.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SYSTEM_PROMPT = `Você é o ACELERIQ OS — agente operacional sênior da agência AcelerIQ, dentro do Performance OS.

## Identidade & Missão
- Diretor de operações virtual: pensa como gestor de tráfego, líder de design e PM.
- Traduz fala/texto do administrador em ações executáveis. Nunca inventa dados.
- Devolve um plano ESTRUTURADO em JSON. O sistema (com confirmação humana) é quem cria registros.

## Intents
create_project | create_task | create_milestone | update_task_status | report_pending | report_overview | upload_file | unknown.

## Tipos de projeto (use SEMPRE um destes em "type")
- "trafego" — gestão de tráfego pago / Meta Ads / Google Ads.
- "social_media" — gestão de redes sociais / conteúdo orgânico.
- "video" — vídeo COM CAPTAÇÃO real (câmera, set, equipe, locação). Use SOMENTE se o contrato cita gravação, captação, set, locação, equipamento, equipe, talents, drone, etc.
- "video_ai" — vídeo 100% GERADO POR IA, sem captação. Use SEMPRE que o contrato/admin citar "vídeo com IA", "IA", "inteligência artificial", "Runway", "Sora", "Veo", "Pika", "Heygen", "Kling", "geração de vídeo", "vídeo generativo", "AI video", "vídeo de IA" — pipeline é roteiro → prompts → geração → edição → entrega.
- "site" | "landing_page" | "automation" | "event" | "other".

⚠️ NUNCA classifique como "video" um pedido que cita IA/Runway/Sora/Veo/AI/generativo — esse é "video_ai".

## Leitura de contrato — REGRA DE OURO
Quando houver anexo/contrato, você é OBRIGADO a extrair com precisão cirúrgica:
- **Quantidade exata** de entregáveis (ex.: "12 vídeos", "8 reels", "4 campanhas/mês").
- **Duração / formato exato** de cada peça (ex.: "30 a 40 segundos", "9:16 vertical", "1080x1920").
- **Cadência** (semanal/quinzenal/mensal) e **prazos** específicos.
- **Plataformas/canais** mencionados.
- **Inclusões e EXCLUSÕES** explícitas.

Use esses dados no \`narrative\` (cite o trecho do contrato) E no \`plan\` (gere milestones e tarefas com a quantidade e duração reais — uma tarefa por entregável quando fizer sentido, ou agrupadas em lotes coerentes).

🚫 NUNCA crie placeholders genéricos como "Produção de 5 vídeos" sem ter lido isso no contrato. Se o contrato diz 12 vídeos de 30s, o plano deve refletir 12 entregáveis de 30s.

## Quando houver ANEXO ou CONTRATO DO SISTEMA
1. Use o trecho como fonte de verdade absoluta.
2. Extraia: cliente, escopo, prazos, entregáveis (quantidades + durações), exclusões.
3. Monte \`plan\` com milestones e tarefas DERIVADAS — nunca fora do escopo contratado.
4. NÃO crie milestones genéricos de "Kickoff" ou "Alinhamento inicial" — o projeto já está em execução, parta direto das fases produtivas do contrato. Idem para "Entrega final" boilerplate: só inclua se o contrato citar marco de entrega/validação real.
5. \`narrative\`: 3-6 frases (pt-BR) ricas, citando NUMERICAMENTE o que do contrato embasou cada decisão. NÃO seja preguiçoso — é melhor ser detalhista do que vago.
6. \`plan\` é OBRIGATÓRIO quando há anexo. Nunca devolva \`plan: null\` se você tem contrato em mãos.

## Sem anexo
- \`plan\` pode ser null se realmente não há informação suficiente. Use intent estruturado, deixa o sistema usar templates.

## Resolução de cliente
- Recebe \`clients\` resumido. Devolve até 3 \`suggestedClientIds\` por probabilidade.
- Não chuta clientes sem evidência no texto.

## Distribuição por role
design (criativos/edição/geração IA), traffic (campanhas/otimização), manager (estratégia/briefing/aprovação cliente), admin (contratos/entregas/organização).

## Restrições
- Nunca prometa fora do contrato. Nunca invente datas — use offsetDays.
- JSON puro, sem markdown.

## 🔒 GUARDRAILS ABSOLUTOS (jurisdição do agente)
Você é 100% autônomo DENTRO do escopo operacional: projetos, milestones, tarefas, kanban, arquivos e organização por cliente. Tudo que o admin pedir nessas áreas você faz — criar, mover, atualizar, organizar, reordenar, reclassificar, reagrupar.

🚫 Áreas PROIBIDAS — se o pedido cair aqui, devolva intent "unknown" com narrative explicando o bloqueio:
- **Financeiro**: billing, mensalidades, parcelas, recebíveis, Ads Wallet, recargas, pagamentos, faturamento, valores, descontos, reembolsos.
- **Cofre de senhas (Vault)**: senhas, credenciais, acessos salvos, integrações de cliente, qualquer leitura/escrita em client_vault.
- **Excluir cliente**: nunca deletar registro de cliente (perfil/profile). Pode arquivar tarefas/projetos do cliente, mas o cadastro permanece.

✅ Permitido sem restrição:
- Criar/mover/concluir tarefas e milestones em qualquer projeto.
- Criar projetos pra clientes existentes.
- Organizar kanban, respeitando contexto (sem misturar clientes/projetos).
- Anexar arquivos nas pastas corretas.
- Excluir TAREFAS, MILESTONES e PROJETOS quando o admin pedir explicitamente (não exclui cliente).

## Organização inteligente
- Hierarquia preservada: cliente → projeto → milestone → tarefa.
- Nunca mova tarefa entre projetos sem o admin pedir explicitamente.
- Ao reordenar, preserve dependências.

## Schema
{ "intent": { "kind": "...", "name"?, "title"?, "taskHint"?, "status"?, "priority"?, "type"?, "deadlineDays"?, "days"?, "clientHint"?, "projectHint"?, "folder"?, "raw"? },
  "suggestedClientIds": string[], "narrative": string, "confidence": number,
  "plan"?: { "milestones": [ { "title": string, "offsetDays": number, "tasks": [ { "title": string, "description"?: string, "priority": "high"|"medium"|"low", "role": "admin"|"design"|"traffic"|"manager" } ] } ] } | null }`;

// Ordem de fallback: modelos gratuitos primeiro. Se TODOS falharem (402/429),
// devolve unknown sem quebrar a UI — o regex local cuida do básico.
const MODEL_CHAIN = [
  "google/gemini-3-flash-preview",       // default atual do catálogo Lovable
  "google/gemini-3.1-flash-lite-preview",// fallback rápido / mais barato
  "google/gemini-2.5-flash",             // estável
  "google/gemini-2.5-flash-lite",        // último recurso
];

interface RequestBody {
  text: string;
  attachment?: { fileName: string; text: string } | null;
  attachments?: { fileName: string; text: string }[];
  clientId?: string | null;
  clients?: { id: string; company_name?: string | null; full_name?: string | null; email?: string | null }[];
  // Quando true, NÃO chama LLM — só devolve `documents[]` carregados do sistema
  // pra UI mostrar e poder enviar de volta na próxima chamada.
  fetchOnly?: boolean;
  // Quando true, edge não tenta recarregar contratos do sistema (UI já passou).
  skipSystemContractAutoLoad?: boolean;
}

// Extrai texto cru de PDF sem parser pesado: pega só strings ASCII dentro do
// stream — suficiente pra contratos digitais (texto, não scan). Limita 18k chars.
function quickPdfText(bytes: Uint8Array): string {
  const decoder = new TextDecoder("latin1");
  const raw = decoder.decode(bytes);
  // junta runs de caracteres imprimíveis + acentos comuns
  const matches = raw.match(/[\x20-\x7E\u00C0-\u017F]{6,}/g) || [];
  return matches.join(" ").replace(/\s+/g, " ").slice(0, 18000);
}

type LoadedDoc = { fileName: string; text: string; source: string };

async function fetchOneAsText(url: string, name: string): Promise<string> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return "";
    const ct = resp.headers.get("content-type") || "";
    if (ct.includes("pdf") || /\.pdf(\?|$)/i.test(url) || /\.pdf$/i.test(name)) {
      const buf = new Uint8Array(await resp.arrayBuffer());
      return quickPdfText(buf);
    }
    if (ct.startsWith("text/") || /\.(txt|md|csv|tsv|json|yaml|yml|log|xml|html?)$/i.test(name)) {
      const text = await resp.text();
      return text.slice(0, 18000);
    }
    return "";
  } catch { return ""; }
}

// Carrega TODOS os documentos relevantes de um cliente: contratos, briefings,
// e arquivos da pasta "contratos". A IA precisa ler tudo pra montar projeto
// completo, sem faltar uma vírgula.
async function loadAllClientDocs(
  supabase: ReturnType<typeof createClient>,
  clientId: string,
): Promise<LoadedDoc[]> {
  const docs: LoadedDoc[] = [];
  // Limite global pra não estourar prompt: ~6 documentos.
  const MAX_DOCS = 6;

  try {
    // 1) Contratos
    const { data: contracts } = await supabase
      .from("contracts")
      .select("original_file_url, original_file_name, description, title, updated_at")
      .eq("client_id", clientId)
      .order("updated_at", { ascending: false })
      .limit(MAX_DOCS);
    for (const c of contracts || []) {
      if (docs.length >= MAX_DOCS) break;
      const name = (c.original_file_name || c.title || "contrato.pdf") as string;
      const inline = ((c.description || "") as string).slice(0, 18000);
      let text = inline;
      if ((!text || text.length < 200) && c.original_file_url) {
        const fetched = await fetchOneAsText(c.original_file_url as string, name);
        if (fetched) text = fetched;
      }
      if (text) docs.push({ fileName: name, text: text.slice(0, 18000), source: "contrato" });
    }
  } catch {}

  try {
    // 2) Arquivos da pasta "contratos" (uploads avulsos)
    const { data: files } = await supabase
      .from("files")
      .select("file_url, file_name, folder, file_type, created_at")
      .eq("client_id", clientId)
      .in("folder", ["contratos", "documentos", "operacionais"])
      .order("created_at", { ascending: false })
      .limit(MAX_DOCS);
    for (const f of files || []) {
      if (docs.length >= MAX_DOCS) break;
      // evita duplicar pelo nome
      if (docs.some((d) => d.fileName === f.file_name)) continue;
      const url = f.file_url as string;
      if (!url) continue;
      const text = await fetchOneAsText(url, (f.file_name || "doc") as string);
      if (text) docs.push({ fileName: (f.file_name || "doc") as string, text: text.slice(0, 18000), source: f.folder as string });
    }
  } catch {}

  try {
    // 3) Briefings (texto puro)
    const { data: brs } = await supabase
      .from("briefings")
      .select("answers, status, created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(2);
    for (const b of brs || []) {
      if (docs.length >= MAX_DOCS) break;
      const text = typeof b.answers === "string" ? b.answers : JSON.stringify(b.answers || {}, null, 2);
      if (text && text.length > 50) {
        docs.push({ fileName: `briefing-${(b.created_at || "").slice(0, 10)}.json`, text: text.slice(0, 12000), source: "briefing" });
      }
    }
  } catch {}

  return docs;
}

async function callModel(
  apiKey: string,
  model: string,
  system: string,
  user: string,
): Promise<{ ok: true; content: string } | { ok: false; status: number; body: string }> {
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    return { ok: false, status: resp.status, body };
  }
  const data = await resp.json();
  return { ok: true, content: data?.choices?.[0]?.message?.content || "{}" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    let body: RequestBody;
    try { body = (await req.json()) as RequestBody; }
    catch { body = { text: "" } as RequestBody; }
    if (typeof body?.text !== "string") body.text = "";
    if (!body.text && !body.attachment?.text && !body.clientId) {
      // Nada pra processar — devolve 200 degradado pra UI não quebrar.
      return new Response(JSON.stringify({
        intent: { kind: "unknown", raw: "" },
        suggestedClientIds: [], narrative: "Sem entrada — diga um comando ou anexe um documento.",
        confidence: 0, plan: null, _degraded: true, _reason: "empty_input",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const clientsCondensed = (body.clients || []).slice(0, 200).map((c) => ({
      id: c.id,
      name: c.company_name || c.full_name || c.email || "",
    }));

    // Se não veio anexo mas temos clientId → busca o contrato do sistema.
    let attachment = body.attachment || null;
    let contractAutoLoaded = false;
    if (!attachment?.text && body.clientId) {
      const loaded = await loadClientContract(supabase, body.clientId);
      if (loaded?.text) {
        attachment = loaded;
        contractAutoLoaded = true;
      }
    }

    const attachmentBlock = attachment?.text
      ? `\n\n[CONTRATO/ANEXO: ${attachment.fileName}${contractAutoLoaded ? " — carregado do sistema" : ""}]\n${attachment.text.slice(0, 18000)}`
      : "";

    const userPrompt =
      `Comando do administrador:\n"""${body.text.slice(0, 4000)}"""\n\n` +
      `Clientes disponíveis (JSON):\n${JSON.stringify(clientsCondensed)}\n` +
      attachmentBlock +
      `\n\nRetorne APENAS o JSON conforme schema, sem markdown.`;

    // Fallback degradado se não há API key.
    if (!apiKey) {
      return new Response(JSON.stringify({
        intent: { kind: "unknown", raw: body.text },
        suggestedClientIds: [], narrative: "IA indisponível (sem API key). Usando interpretação local.",
        confidence: 0, plan: null, _degraded: true, _reason: "no_api_key",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Tenta cadeia de modelos free → preview. 402/429 = pula. 5xx = pula.
    let parsed: any = null;
    let usedModel: string | null = null;
    const errors: string[] = [];
    for (const model of MODEL_CHAIN) {
      const r = await callModel(apiKey, model, SYSTEM_PROMPT, userPrompt);
      if (r.ok) {
        try { parsed = JSON.parse(r.content); }
        catch {
          const m = r.content.match(/\{[\s\S]*\}/);
          parsed = m ? JSON.parse(m[0]) : null;
        }
        if (parsed) { usedModel = model; break; }
        errors.push(`${model}: parse_failed`);
        continue;
      }
      errors.push(`${model}: ${r.status}`);
      // só pula automaticamente em rate-limit / credits / server-side
      if (![402, 429, 500, 502, 503, 504].includes(r.status)) break;
    }

    // Se TODOS falharem, degrada elegante — não trava o usuário.
    if (!parsed) {
      return new Response(JSON.stringify({
        intent: { kind: "unknown", raw: body.text },
        suggestedClientIds: [],
        narrative: "Modelos de IA temporariamente indisponíveis. Interpretação local ativa — você pode confirmar manualmente.",
        confidence: 0, plan: null,
        _degraded: true, _reason: "all_models_failed", _errors: errors,
        _contractAutoLoaded: contractAutoLoaded,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Normalize
    if (!parsed.intent) parsed.intent = { kind: "unknown", raw: body.text };
    if (!Array.isArray(parsed.suggestedClientIds)) parsed.suggestedClientIds = [];
    if (typeof parsed.confidence !== "number") parsed.confidence = 0.5;
    if (typeof parsed.narrative !== "string") parsed.narrative = "";
    parsed._model = usedModel;
    parsed._contractAutoLoaded = contractAutoLoaded;
    parsed._contractName = attachment?.fileName || null;

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    // Última linha de defesa: nunca quebra a UI.
    return new Response(JSON.stringify({
      intent: { kind: "unknown", raw: "" },
      suggestedClientIds: [], narrative: "Erro interno do agente. Interpretação local ativa.",
      confidence: 0, plan: null, _degraded: true, _reason: (err as Error).message,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
