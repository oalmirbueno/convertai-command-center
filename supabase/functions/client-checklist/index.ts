// Aceleriq OS — Motor de checklist do cliente
//
// O ciclo semanal cobre a rotina. O que ele não cobre é o combinado do
// momento: "gravar depoimento na loja quinta", "refazer a arte do cardápio",
// "pedir as fotos novas antes de sexta". Isso vivia na cabeça de quem estava
// na conversa e sumia.
//
// Aqui o dono descreve com as palavras dele e a IA devolve uma lista curta de
// itens acionáveis, já no contexto daquele cliente. Rápido de propósito:
// poucos itens, frases curtas, sem enfeite.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  DEFAULT_LOVABLE_MODEL_CHAIN,
  requestAiChatCompletion,
  resolveAiProviderChain,
} from "../_shared/ai-provider.ts";

const PRIMARY_MODEL_CHAIN = ["gpt-4o-mini"];

const SYSTEM_PROMPT = `Você transforma o pedido do dono de uma agência de marketing em uma lista de tarefas pequenas e executáveis.

REGRAS:
1. Entre 3 e 6 itens. Nunca mais que 6.
2. Cada item é uma ação concreta que uma pessoa faz e marca como pronta. Comece com o verbo no infinitivo.
3. Máximo de 60 caracteres por item. Curto, direto, sem enfeite.
4. Ordem de execução: o que vem primeiro na vida real aparece primeiro.
5. Português do Brasil, sem jargão, SEM TRAVESSÃO.
6. Use o contexto do cliente para deixar os itens específicos, mas nunca invente fato que não foi dado.
7. Não crie item genérico de "alinhar" ou "revisar tudo". Se o pedido for vago, quebre no que dá para fazer hoje.

Responda SOMENTE com JSON válido: {"title":"...","items":["...","..."]}
O título tem no máximo 50 caracteres e nomeia o conjunto.`;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extractJson(raw: string): { title?: string; items?: unknown } {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("resposta sem JSON");
  return JSON.parse(trimmed.slice(start, end + 1));
}

/**
 * Reserva sem IA: quebra o texto do jeito que a pessoa escreveu. Uma linha
 * por item, ou frases separadas por ponto e vírgula. É pior que a IA, mas
 * garante que o pedido nunca se perde por indisponibilidade.
 */
function fallbackItems(pedido: string): string[] {
  return pedido
    .split(/\n|;|\s+e\s+depois\s+|,\s+depois\s+/i)
    .map((parte) => parte.replace(/^[-•*\d.)\s]+/, "").trim())
    .filter((parte) => parte.length > 2)
    .slice(0, 6)
    .map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1, 60));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return jsonResponse({ error: "Sessão expirada." }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData?.user) return jsonResponse({ error: "Sessão expirada." }, 401);
    const { data: isStaff } = await admin.rpc("is_staff", { _user_id: userData.user.id });
    if (!isStaff) return jsonResponse({ error: "Somente equipe." }, 403);

    const body = await req.json().catch(() => ({}));
    const pedido = String(body?.request || "").trim().slice(0, 2000);
    const clientName = String(body?.client_name || "").slice(0, 120);
    const contexto = String(body?.context || "").slice(0, 2000);
    if (pedido.length < 3) return jsonResponse({ error: "Descreva o que precisa ser feito." }, 400);

    const reserva = fallbackItems(pedido);

    try {
      const providers = resolveAiProviderChain({
        primaryModels: PRIMARY_MODEL_CHAIN,
        lovableModels: DEFAULT_LOVABLE_MODEL_CHAIN,
      });
      const { response, provider } = await requestAiChatCompletion(providers, {
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content:
              `CLIENTE: ${clientName}\n` +
              (contexto ? `CONTEXTO DELE AGORA:\n${contexto}\n\n` : "") +
              `PEDIDO DO DONO:\n${pedido}`,
          },
        ],
        temperature: 0.3,
      });

      if (!response.ok) {
        console.warn(`[checklist] ${provider.label} HTTP ${response.status}`);
        return jsonResponse({ title: null, items: reserva, source: "fallback" });
      }

      const completion = await response.json();
      const parsed = extractJson(completion?.choices?.[0]?.message?.content || "");
      const itens = Array.isArray(parsed.items)
        ? parsed.items
          .map((item) => String(item).trim())
          .filter((item) => item.length > 2)
          .slice(0, 6)
        : [];
      if (itens.length === 0) {
        return jsonResponse({ title: null, items: reserva, source: "fallback" });
      }
      return jsonResponse({
        title: String(parsed.title || "").slice(0, 60) || null,
        items: itens,
        source: "ai",
      });
    } catch (error) {
      console.warn(`[checklist] falha: ${error instanceof Error ? error.message : String(error)}`);
      return jsonResponse({ title: null, items: reserva, source: "fallback" });
    }
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Erro inesperado." },
      500,
    );
  }
});
