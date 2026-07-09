import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_BASE = `Você é o **Prepro Director** — diretor de pré-produção audiovisual interno da AcelerIQ, especializado em conteúdo social, VSL, institucional e campanhas orgânicas/pagas. Fale português do Brasil, tom direto, técnico, sem enrolação e sem clichê publicitário.

## Sua base metodológica (sempre siga esta ordem quando o pedido for planejamento):
1. **Diagnóstico** — entenda em uma frase: objetivo do vídeo, público, canal (Reels/TikTok/YT/VSL), duração-alvo, tom.
2. **Big idea** — proponha 1 conceito central em uma linha (não liste 5 opções fracas — 1 forte).
3. **Roteiro** — estrutura em blocos com timecode aproximado:
   - HOOK (0-3s) com padrão-interruptor claro
   - DESENVOLVIMENTO (proof, história, argumento)
   - CTA específico e único
   Para cada bloco: FALA / IMAGEM / SFX-TRILHA / TEXTO EM TELA.
4. **Plano de gravação** — locações, elenco, figurino, props, referências visuais, planos (close, médio, aberto, detalhe).
5. **Pós** — trilha, corte (ritmo, jump-cut, b-roll), legenda, motion, cor, formato de entrega (9:16, 1:1, 16:9).
6. **Checklist de entrega** — o que sobe pro Workspace em cada pasta do pipeline (Brutos → Trilhas/SFX → Edição → Final).

## Regras
- Quando o usuário citar arquivos ([@nome](wsfile:id)), assuma que são materiais reais do projeto e referencie-os pelo nome.
- Se o contexto trouxer NOTAS, ROTEIRO ou pasta atual, TRABALHE em cima deles — não reinvente do zero.
- Nunca peça "mais informações" antes de entregar valor: dê a primeira versão com o que tem e marque explicitamente as suposições ("Assumi: público 25-40, canal Reels").
- Respostas conversacionais: seja curto. Respostas de planejamento: use markdown com headings ##, listas e tabelas quando ajudar.
- Nunca use emoji decorativo. Ícones só quando o usuário pedir.
- Referência da persona pública: https://chatgpt.com/g/g-6a4e9158529c8191a937cee536c18c9f-prepro-director-gpt — replique o padrão de saída daquele GPT.`;


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Não autenticado" }, 401);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userRes } = await sb.auth.getUser();
    const user = userRes?.user;
    if (!user) return json({ error: "Usuário inválido" }, 401);

    const body = await req.json();
    const { thread_id, message, context } = body as {
      thread_id: string;
      message: string;
      context?: { client_name?: string; folder_path?: string; notes?: string; script?: string; files?: { name: string; url?: string | null }[] };
    };
    if (!thread_id || !message?.trim()) return json({ error: "thread_id e message obrigatórios" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // valida ownership
    const { data: thread } = await admin.from("workspace_agent_threads")
      .select("id, user_id, system_prompt, title").eq("id", thread_id).maybeSingle();
    if (!thread || thread.user_id !== user.id) return json({ error: "Thread inválida" }, 403);

    // carrega histórico (últimas 30 msgs)
    const { data: history } = await admin.from("workspace_agent_messages")
      .select("role, content").eq("thread_id", thread_id).order("created_at", { ascending: true }).limit(30);

    // monta contexto
    const ctxLines: string[] = [];
    if (context?.client_name) ctxLines.push(`Cliente atual: ${context.client_name}`);
    if (context?.folder_path) ctxLines.push(`Pasta: ${context.folder_path}`);
    if (context?.files?.length) {
      ctxLines.push("Arquivos disponíveis:");
      context.files.slice(0, 20).forEach(f => ctxLines.push(`- ${f.name}${f.url ? ` (${f.url})` : ""}`));
    }
    if (context?.script) ctxLines.push(`\nROTEIRO EM CONSTRUÇÃO:\n${context.script.slice(0, 4000)}`);
    if (context?.notes) ctxLines.push(`\nNOTAS DO PROJETO:\n${context.notes.slice(0, 3000)}`);

    const systemMsg = [SYSTEM_BASE, thread.system_prompt || "", ctxLines.length ? `\n---CONTEXTO---\n${ctxLines.join("\n")}` : ""]
      .filter(Boolean).join("\n\n");

    const messages = [
      { role: "system", content: systemMsg },
      ...(history || []).map(m => ({ role: m.role, content: m.content })),
      { role: "user", content: message },
    ];

    // salva user msg imediatamente
    await admin.from("workspace_agent_messages").insert({ thread_id, role: "user", content: message });

    // stream do Lovable AI
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return json({ error: "LOVABLE_API_KEY ausente" }, 500);

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "google/gemini-2.5-flash", messages, stream: true }),
    });

    if (!aiRes.ok || !aiRes.body) {
      const t = await aiRes.text().catch(() => "");
      return json({ error: `AI falhou: ${aiRes.status} ${t.slice(0, 200)}` }, aiRes.status === 429 ? 429 : 500);
    }

    // Proxy do stream + captura para persistir
    let full = "";
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const outStream = new ReadableStream({
      async start(controller) {
        const reader = aiRes.body!.getReader();
        let buf = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split("\n"); buf = lines.pop() || "";
            for (const line of lines) {
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (payload === "[DONE]") continue;
              try {
                const j = JSON.parse(payload);
                const delta = j.choices?.[0]?.delta?.content;
                if (delta) { full += delta; controller.enqueue(encoder.encode(delta)); }
              } catch { /* ignore parse */ }
            }
          }
          // persiste assistente
          if (full.trim()) {
            await admin.from("workspace_agent_messages").insert({ thread_id, role: "assistant", content: full });
            // atualiza título se ainda for default
            if (thread.title === "Nova conversa") {
              const title = message.slice(0, 60).replace(/\n/g, " ");
              await admin.from("workspace_agent_threads").update({ title, updated_at: new Date().toISOString() }).eq("id", thread_id);
            } else {
              await admin.from("workspace_agent_threads").update({ updated_at: new Date().toISOString() }).eq("id", thread_id);
            }
          }
        } catch (e) {
          controller.error(e);
          return;
        }
        controller.close();
      },
    });

    return new Response(outStream, {
      headers: { ...cors, "Content-Type": "text/plain; charset=utf-8", "X-Accel-Buffering": "no" },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "erro" }, 500);
  }
});

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
