// Aceleriq OS — Escritor dos rituais da Central
//
// Antes, cada ritual saía de um molde com três frases alternativas sorteadas:
// mudava a palavra, nunca o raciocínio. O cliente lia "consistência: publicar
// no ritmo planejado" tivesse acontecido o que tivesse.
//
// Aqui a IA escreve a partir dos FATOS daquele cliente naquela semana
// (entregas, aprovações paradas, publicações, etapas, números do Instagram) e
// do tipo de ritual pedido. O molde continua existindo no painel como reserva:
// se a IA não responder, o cliente recebe o texto de sempre, nunca um erro.
//
// Segurança: só equipe autenticada, e os fatos vêm do próprio chamador (o
// painel já os leu com o JWT dele, sob RLS). Esta função não lê o banco.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  DEFAULT_LOVABLE_MODEL_CHAIN,
  requestAiChatCompletion,
  resolveAiProviderChain,
} from "../_shared/ai-provider.ts";

const PRIMARY_MODEL_CHAIN = ["gpt-4o-mini"];

// O que cada ritual precisa entregar. É a diferença entre um recado semanal
// e um relatório: cada um tem um trabalho distinto na relação com o cliente.
const RITUAL_BRIEF: Record<string, string> = {
  rota_semana:
    "ROTA DA SEMANA (segunda). Abre a semana: o que a gente vai fazer, em que ordem e o que isso destrava. Termina com o que você precisa do cliente, se precisar de algo.",
  meio_semana:
    "CHECAGEM DE MEIO DE SEMANA (quarta). Curto. Diz o que já andou, o que está travado e o que ainda dá para virar até sexta.",
  prova_movimento:
    "PROVA DE MOVIMENTO (sexta). Fecha a semana mostrando o trabalho que existiu: entregas, publicações no ar, etapas fechadas. Prova, não promessa.",
  radar_aceleriq:
    "RADAR (mensal). Antecipação: uma leitura do que a gente enxerga chegando para o negócio dele e o que propomos fazer antes de precisar.",
  marco_90:
    "MARCO DE 90 DIAS. Balanço do trimestre: o que mudou de verdade no negócio, o que aprendemos e para onde vamos no próximo ciclo.",
};

const SYSTEM_PROMPT = `Você escreve as mensagens que uma agência de growth marketing brasileira (Aceleriq) manda para os clientes dela. Quem lê é dono de negócio, ocupado, leigo em marketing.

REGRAS ABSOLUTAS:
1. Use SOMENTE os fatos fornecidos. Nunca invente entrega, número, data ou resultado. Fato que não está na lista não existe.
2. Português claro do Brasil. SEM TRAVESSÃO (use vírgula ou ponto). Sem jargão de marketing, sem "sinergia", "otimização", "estratégia robusta".
3. Nada de elogio vazio nem de encheção ("estamos muito animados", "grande semana!"). Fale do trabalho.
4. Trate por "você" e chame a agência de "a gente".
5. Cada mensagem precisa responder, na ordem: o que aconteceu, o que isso significa para o negócio dele, e qual é o próximo passo.
6. Se existe aprovação parada, isso é o assunto mais importante da mensagem: diga o que está parado e o que acontece quando destravar.
7. Tamanho: 4 a 8 frases, em 2 ou 3 parágrafos curtos. Sem listas, sem títulos, sem markdown.
8. O título tem no máximo 60 caracteres, específico daquela semana, nunca genérico.

Responda SOMENTE com JSON válido: {"title":"...","body":"..."}`;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extractJson(raw: string): { title?: string; body?: string } {
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
    const ritual = String(body?.ritual || "");
    const facts = String(body?.facts || "").slice(0, 6000);
    const clientName = String(body?.client_name || "Cliente").slice(0, 120);
    if (!RITUAL_BRIEF[ritual] || !facts) {
      return jsonResponse({ error: "Ritual ou fatos ausentes." }, 400);
    }

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
            `TIPO DE MENSAGEM: ${RITUAL_BRIEF[ritual]}\n\n` +
            `CLIENTE: ${clientName}\n\n` +
            `FATOS REAIS DESTA SEMANA (do painel):\n${facts}`,
        },
      ],
      temperature: 0.6,
    });

    if (!response.ok) {
      console.warn(`[ritual] cadeia esgotada, último: ${provider.label} HTTP ${response.status}`);
      return jsonResponse({ title: null, body: null, source: "fallback" });
    }

    const completion = await response.json();
    const parsed = extractJson(completion?.choices?.[0]?.message?.content || "");
    const title = String(parsed?.title || "").trim();
    const text = String(parsed?.body || "").trim();
    if (!text) return jsonResponse({ title: null, body: null, source: "fallback" });

    return jsonResponse({ title: title || null, body: text, source: "ai" });
  } catch (error) {
    // Falha aqui nunca pode travar o ritual: o painel usa o texto de reserva.
    console.warn(`[ritual] falha: ${error instanceof Error ? error.message : String(error)}`);
    return jsonResponse({ title: null, body: null, source: "fallback" });
  }
});
