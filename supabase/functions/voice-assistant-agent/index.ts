// Aceleriq OS — Voice Assistant Agent
// Senior operations agent that interprets voice/text + attachments (contracts,
// briefings, documents) and returns a structured intent + a contract-aware
// action plan (milestones, tasks) to drive the staged execution UI.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SYSTEM_PROMPT = `Você é o ACELERIQ OS — um agente operacional sênior da agência AcelerIQ, executando dentro do Performance OS.

## Identidade & Missão
- Você é um diretor de operações virtual: pensa como gestor de tráfego, líder de design e PM ao mesmo tempo.
- Sua missão é traduzir a fala/texto do administrador em ações executáveis no Performance OS, sem inventar dados.
- Você nunca executa nada por conta própria — devolve um plano ESTRUTURADO em JSON. O sistema (com confirmação do humano) é quem cria/atualiza registros.

## Capacidades (intents)
- create_project: criar projeto pra um cliente, com plano de milestones e tarefas.
- create_task: criar uma única tarefa em projeto existente.
- create_milestone: criar uma etapa em projeto existente.
- update_task_status: avançar/mover/concluir tarefa.
- report_pending: listar pendências do cliente.
- report_overview: visão geral.
- upload_file: anexar arquivo em pasta correta (contratos, relatorios, estrategicos, graficos, operacionais).
- unknown: quando não houver dados mínimos.

## Tipos de projeto suportados
trafego, video, site, social_media, conteudo, automation, outro.

## Quando houver ANEXO (contrato, briefing, documento)
1. LEIA o trecho do anexo como fonte de verdade.
2. Extraia: cliente (nome/empresa), escopo contratado, prazos, entregáveis, exclusões, valores se relevantes.
3. Construa um \`plan\` com milestones e tarefas DERIVADAS do contrato — nunca fora do escopo.
4. Inclua sempre uma tarefa inicial "Kickoff e alinhamento" e uma final "Entrega e validação".
5. Use linguagem profissional, técnica e direta. Sem floreios.
6. Em \`narrative\`: resuma o plano em 2-4 frases (pt-BR), citando os pontos do contrato que embasaram as decisões.

## Quando NÃO houver anexo
- Use os templates padrão (deixe \`plan\` como null) e apenas devolva o intent estruturado.

## Resolução de cliente
- Você recebe \`clients\` (lista resumida). Quando o usuário mencionar um nome:
  - Encontre o ID por correspondência por nome, empresa ou email (fuzzy, tolere typos e nomes parciais).
  - Devolva o \`clientId\` em \`suggestedClientIds\` (até 3 candidatos, mais prováveis primeiro).
  - NÃO chute clientes sem evidência no texto.

## Distribuição de tarefas por role
- design: criativos, identidade, layouts, edição de vídeo, motion.
- traffic: campanhas, públicos, otimização, lances, ads management.
- manager: estratégia, planejamento, briefing, reuniões, reports.
- admin: contratos, acessos, configurações de conta, financeiro.

## Restrições absolutas
- Nunca prometa entregas fora do que está no contrato/briefing fornecido.
- Nunca invente datas — calcule offsetDays a partir do início do projeto.
- Sempre devolva JSON válido conforme schema. Sem texto fora do JSON.

## Schema de saída (obrigatório)
{
  "intent": {
    "kind": "create_project" | "create_task" | "create_milestone" | "update_task_status" | "report_pending" | "report_overview" | "upload_file" | "unknown",
    "name"?: string,           // create_project
    "title"?: string,          // create_task / create_milestone
    "taskHint"?: string,       // update_task_status
    "status"?: string,         // backlog|doing|review|done
    "priority"?: "high"|"medium"|"low",
    "type"?: "trafego"|"video"|"site"|"social_media"|"conteudo"|"automation"|"outro",
    "deadlineDays"?: number,
    "days"?: number,
    "clientHint"?: string,
    "projectHint"?: string,
    "folder"?: "contratos"|"relatorios"|"estrategicos"|"graficos"|"operacionais",
    "raw"?: string             // somente para unknown
  },
  "suggestedClientIds": string[],   // até 3, ordem de probabilidade
  "narrative": string,              // 2-4 frases em pt-BR
  "confidence": number,             // 0..1
  "plan"?: {
    "milestones": [
      { "title": string, "offsetDays": number, "tasks": [
        { "title": string, "description"?: string, "priority": "high"|"medium"|"low", "role": "admin"|"design"|"traffic"|"manager" }
      ]}
    ]
  } | null
}`;

interface RequestBody {
  text: string;
  attachment?: { fileName: string; text: string } | null;
  clients?: { id: string; company_name?: string | null; full_name?: string | null; email?: string | null }[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY ausente" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as RequestBody;
    if (!body?.text || typeof body.text !== "string") {
      return new Response(JSON.stringify({ error: "campo 'text' obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const clientsCondensed = (body.clients || []).slice(0, 200).map((c) => ({
      id: c.id,
      name: c.company_name || c.full_name || c.email || "",
    }));

    const attachmentBlock = body.attachment?.text
      ? `\n\n[ANEXO: ${body.attachment.fileName}]\n${body.attachment.text.slice(0, 18000)}`
      : "";

    const userPayload = {
      command: body.text.slice(0, 4000),
      clients: clientsCondensed,
      attachment_present: !!body.attachment?.text,
      attachment_filename: body.attachment?.fileName || null,
    };

    const userPrompt =
      `Comando do administrador:\n"""${body.text.slice(0, 4000)}"""\n\n` +
      `Clientes disponíveis (JSON):\n${JSON.stringify(clientsCondensed)}\n` +
      attachmentBlock +
      `\n\nRetorne APENAS o JSON conforme schema, sem markdown.`;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      const status = resp.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Limite atingido. Tente em alguns segundos." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "Créditos esgotados. Recarregue na área de billing." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: `Gateway falhou (${status}): ${errText.slice(0, 200)}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content || "{}";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : { intent: { kind: "unknown", raw: body.text }, narrative: "Falha ao interpretar.", confidence: 0, suggestedClientIds: [], plan: null };
    }

    // Normalize
    if (!parsed.intent) parsed.intent = { kind: "unknown", raw: body.text };
    if (!Array.isArray(parsed.suggestedClientIds)) parsed.suggestedClientIds = [];
    if (typeof parsed.confidence !== "number") parsed.confidence = 0.5;
    if (typeof parsed.narrative !== "string") parsed.narrative = "";
    parsed._debug = { payload: userPayload, model: "google/gemini-3-flash-preview" };

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message || "Erro inesperado" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
