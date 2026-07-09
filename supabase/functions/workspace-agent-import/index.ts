import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const { url, clear } = await req.json() as { url?: string; clear?: boolean };
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (clear) {
      await admin.from("workspace_agent_personas").delete().eq("user_id", user.id);
      return json({ ok: true, cleared: true });
    }

    if (!url || !/^https?:\/\//i.test(url)) return json({ error: "URL inválida" }, 400);

    // Fetch da página pública do GPT
    let html = "";
    try {
      const r = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; AceleriqBot/1.0)",
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        },
        redirect: "follow",
      });
      if (!r.ok) return json({ error: `Falha ao acessar link (${r.status}). O GPT precisa estar público.` }, 400);
      html = await r.text();
    } catch (e) {
      return json({ error: `Erro de rede: ${e instanceof Error ? e.message : "unknown"}` }, 400);
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

    // Sintetiza persona via Lovable AI (opcional — se falhar, usamos os metadados brutos)
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    let persona = `Você É o "${title}".\n\n${description}${starters.length ? `\n\nExemplos de perguntas que você domina:\n${starters.map(s => `- ${s}`).join("\n")}` : ""}`;

    if (apiKey) {
      try {
        const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: "Você escreve system prompts para agentes de IA em português do Brasil. Seja direto, técnico, sem clichê." },
              { role: "user", content: `A partir das informações públicas abaixo sobre um GPT customizado, escreva um SYSTEM PROMPT completo para reproduzir a mesma persona, tom, especialidade, método de trabalho e formato de saída. Não diga que é cópia. Não use emoji decorativo. Escreva em 2ª pessoa ("Você é..."). Inclua: identidade, especialidade, método/passos, regras de operação, formato de saída. Máximo 500 palavras.\n\nTÍTULO: ${title}\nDESCRIÇÃO: ${description}\nSTARTERS: ${starters.join(" | ") || "(nenhum)"}\nURL: ${url}` },
            ],
          }),
        });
        if (r.ok) {
          const j = await r.json();
          const txt = j?.choices?.[0]?.message?.content?.trim();
          if (txt && txt.length > 80) persona = txt;
        }
      } catch { /* usa fallback */ }
    }

    await admin.from("workspace_agent_personas").upsert({
      user_id: user.id,
      gpt_url: url,
      gpt_name: title || null,
      gpt_description: description || null,
      persona_prompt: persona,
      updated_at: new Date().toISOString(),
    });

    return json({ ok: true, name: title, description, starters, persona });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "erro" }, 500);
  }
});
