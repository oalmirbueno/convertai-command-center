import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import {
  requestAiChatCompletion,
  resolveAiProviderChain,
} from "../_shared/ai-provider.ts";
import { fetchPublicText } from "../_shared/public-http.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const MAX_REQUEST_BYTES = 64 * 1024;

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

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

    const declaredLength = Number(req.headers.get("content-length") || "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
      return json({ error: "Payload muito grande" }, 413);
    }
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
      return json({ error: "Payload muito grande" }, 413);
    }
    const { url, clear, client_id, folder_path, persona_id, delete_id } = JSON.parse(rawBody) as {
      url?: string; clear?: boolean; client_id?: string | null; folder_path?: string | null;
      persona_id?: string | null; delete_id?: string | null;
    };
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const cid = client_id || null;
    const fpath = folder_path || null;

    // deletar uma persona específica pelo id
    if (delete_id) {
      await admin.from("workspace_agent_personas").delete().eq("id", delete_id).eq("user_id", user.id);
      return json({ ok: true, deleted: delete_id });
    }

    // clear = remove TODAS as personas do escopo (mantido por compatibilidade)
    if (clear) {
      let q = admin.from("workspace_agent_personas").delete().eq("user_id", user.id);
      q = cid ? q.eq("client_id", cid) : q.is("client_id", null);
      q = fpath ? q.eq("folder_path", fpath) : q.is("folder_path", null);
      await q;
      return json({ ok: true, cleared: true });
    }

    if (!url) return json({ error: "URL inválida" }, 400);

    const { data: quota } = await sb.rpc("claim_ai_usage", {
      _workload: "workspace-agent-import",
    });
    if (quota !== true) return json({ error: "Limite de uso atingido" }, 429);

    // Fetch da página pública do GPT
    let html = "";
    let fetchedUrl = url;
    try {
      const r = await fetchPublicText(url, {
        allowedHostnames: ["chatgpt.com", "www.chatgpt.com", "chat.openai.com"],
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; AceleriqBot/1.0)",
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        },
        timeoutMs: 8_000,
        maxBytes: 1024 * 1024,
      });
      if (!r.ok) return json({ error: `Falha ao acessar link (${r.status}). O GPT precisa estar público.` }, 400);
      const contentType = r.headers.get("content-type") || "";
      if (!/text|html|xhtml/i.test(contentType)) {
        return json({ error: "O link precisa apontar para uma página pública de texto." }, 400);
      }
      html = r.text;
      fetchedUrl = r.url;
    } catch (e) {
      return json({ error: `URL pública HTTPS inválida ou inacessível: ${e instanceof Error ? e.message : "unknown"}` }, 400);
    }

    // Extrai metadados básicos
    const pick = (re: RegExp) => (html.match(re)?.[1] || "").trim();
    const decode = (s: string) => s
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");
    const title = decode(pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)
      || pick(/<title>([^<]+)</i));
    const description = decode(pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i)
      || pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i));

    // Tenta extrair starters do NEXT_DATA
    let starters: string[] = [];
    const nextData = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
    if (nextData) {
      try {
        const j = JSON.parse(nextData);
        const s = JSON.stringify(j);
        const arr = s.match(/"prompt_starters":\s*\[([^\]]+)\]/);
        if (arr) {
          starters = Array.from(arr[1].matchAll(/"([^"\\]+(?:\\.[^"\\]*)*)"/g)).map(m => m[1]).slice(0, 8);
        }
      } catch { /* ignore */ }
    }

    if (!title && !description) {
      return json({ error: "Não foi possível ler o conteúdo desse link. Verifique se o GPT está público." }, 400);
    }

    // Sintetiza a persona quando houver um provider de IA. Se falhar, usa os metadados brutos.
    const providers = resolveAiProviderChain({
      primaryModels: ["gpt-4o-mini"],
      lovableModels: ["google/gemini-2.5-flash"],
    });
    let persona = `Você É o "${title}".\n\n${description}${starters.length ? `\n\nExemplos de perguntas que você domina:\n${starters.map(s => `- ${s}`).join("\n")}` : ""}`;

    if (providers.length) {
      try {
        const { response: r } = await requestAiChatCompletion(providers, {
          messages: [
            { role: "system", content: "Você escreve system prompts para agentes de IA em português do Brasil. Seja direto, técnico, sem clichê." },
            { role: "user", content: `A partir das informações públicas abaixo sobre um GPT customizado, escreva um SYSTEM PROMPT completo para reproduzir a mesma persona, tom, especialidade, método de trabalho e formato de saída. Não diga que é cópia. Não use emoji decorativo. Escreva em 2ª pessoa ("Você é..."). Inclua: identidade, especialidade, método/passos, regras de operação, formato de saída. Máximo 500 palavras.\n\nTÍTULO: ${title}\nDESCRIÇÃO: ${description}\nSTARTERS: ${starters.join(" | ") || "(nenhum)"}\nURL: ${fetchedUrl}` },
          ],
        });
        if (r.ok) {
          const j = await r.json();
          const txt = j?.choices?.[0]?.message?.content?.trim();
          if (txt && txt.length > 80) persona = txt;
        }
      } catch { /* usa fallback */ }
    }

    // Múltiplas personas por escopo. Se persona_id vier, atualiza aquela; senão insere nova.
    const row = {
      user_id: user.id,
      client_id: cid,
      folder_path: fpath,
      gpt_url: fetchedUrl,
      gpt_name: title || null,
      gpt_description: description || null,
      persona_prompt: persona,
      updated_at: new Date().toISOString(),
    };
    let savedId: string | null = null;
    if (persona_id) {
      const { data: upd } = await admin.from("workspace_agent_personas")
        .update(row).eq("id", persona_id).eq("user_id", user.id).select("id").maybeSingle();
      savedId = upd?.id || null;
    }
    if (!savedId) {
      const { data: ins } = await admin.from("workspace_agent_personas")
        .insert(row).select("id").maybeSingle();
      savedId = ins?.id || null;
    }

    return json({ ok: true, id: savedId, name: title, description, starters, persona, scope: { client_id: cid, folder_path: fpath } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "erro" }, 500);
  }
});
