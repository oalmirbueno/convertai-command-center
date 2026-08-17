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
    "ROTA DA SEMANA (segunda). Abre a semana apresentando o PLANO e a lógica dele: o que a gente vai fazer, por que nessa ordem, e que resultado essa sequência persegue. Cubra conteúdo e campanhas. Fecha com o que depende do cliente para o plano acontecer.",
  meio_semana:
    "CHECAGEM DE MEIO DE SEMANA (quarta). Direto: o que já saiu do papel, o que travou e por quê, e o que ainda dá para virar até sexta. Se algo depende do cliente, esse é o momento de cobrar com clareza.",
  prova_movimento:
    "PROVA DE MOVIMENTO (sexta). Fecha a semana com o trabalho que existiu e o que ele significa: cada entrega ligada ao objetivo que ela serve. Prova, não promessa. Diga também o que ficou para a semana seguinte e por quê.",
  radar_aceleriq:
    "RADAR (mensal). Antecipação estratégica: o que a gente enxerga chegando para o negócio dele, por que isso importa agora, e o movimento que propomos antes de ele precisar pedir.",
  marco_90:
    "MARCO DE 90 DIAS. Balanço do trimestre com leitura de estratégia: o que mudou de verdade no negócio, o que os números ensinaram, o que não funcionou, e a tese para o próximo ciclo.",
};

const SYSTEM_PROMPT = `Você é o gestor de contas sênior de uma agência de growth marketing brasileira (Aceleriq) e escreve as mensagens que vão para o dono do negócio. Ele é ocupado, leigo em marketing, e paga para ter clareza do que está sendo construído.

O QUE SEPARA UMA MENSAGEM BOA DE UMA GENÉRICA:
Uma mensagem fraca lista tarefas ("criamos 4 artes, agendamos 3 posts"). Uma mensagem forte explica a ESTRATÉGIA: por que aquilo foi feito, que objetivo do negócio dele aquilo serve, e o que vem depois. O cliente precisa terminar de ler entendendo o raciocínio, não só o inventário.

REGRAS ABSOLUTAS:
1. Use SOMENTE os fatos fornecidos. Nunca invente entrega, número, data ou resultado. Fato que não está na lista não existe.
2. Toda ação citada precisa vir com o PORQUÊ e o OBJETIVO. Nunca escreva o que foi feito sem dizer para que serve. Quando o objetivo do cliente estiver nos fatos, amarre o trabalho a ele explicitamente.
3. Fale de TODAS as frentes contratadas, não só da que teve movimento. Se o cliente paga por tráfego e o tráfego não andou, isso é assunto obrigatório, não omissão.
4. TRÁFEGO E CAMPANHAS: se estiver contratado e ainda não iniciado, ou com verba zerada, diga com todas as letras o que falta, o que depende dele, e o que ele deixa de ganhar enquanto não começa. Nunca esconda isso no fim nem suavize a ponto de sumir.
5. CONTINUIDADE: quando os fatos trouxerem o que foi dito na mensagem anterior, retome. Diga se cumprimos, se avançou ou se continua pendente. Cada mensagem é capítulo de uma história, não um recomeço.
6. NECESSIDADE: deixe claro o que só acontece com participação dele (aprovar, liberar verba, enviar material) e a consequência real de não acontecer. Sem chantagem e sem drama: consequência concreta.
7. Se existe aprovação parada, é o assunto mais importante da mensagem.
8. Português claro do Brasil. SEM TRAVESSÃO (use vírgula ou ponto). Sem jargão ("sinergia", "otimização", "estratégia robusta", "engajamento"). Sem elogio vazio ("grande semana!", "estamos animados").
9. Trate por "você" e chame a agência de "a gente".
10. Tamanho: 3 a 5 parágrafos curtos, entre 8 e 14 frases no total. Sem listas, sem títulos, sem markdown, sem emoji.
11. O título tem no máximo 60 caracteres e nomeia o movimento da semana daquele cliente. Nunca genérico.

ESTRUTURA (sem escrever os rótulos):
Parágrafo 1: onde a gente está e o que aconteceu de concreto.
Parágrafo 2: por que isso foi feito e a que objetivo do negócio serve.
Parágrafo 3: o estado das outras frentes contratadas, tráfego incluído, com o que está pendente.
Parágrafo 4: o que depende dele agora e o que a gente faz em seguida.

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
    const facts = String(body?.facts || "").slice(0, 12000);
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
