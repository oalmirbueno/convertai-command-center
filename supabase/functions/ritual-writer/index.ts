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
    "CHECAGEM DE MEIO DE SEMANA (quarta). Direto: o que já saiu do papel e o que ainda entra até sexta. Se algo depende do cliente, apresente como a peça que falta para fechar a semana redonda, com prazo e ganho.",
  prova_movimento:
    "PROVA DE MOVIMENTO (sexta). Fecha a semana com o trabalho que existiu e o que ele significa: cada entrega ligada ao objetivo que ela serve. Prova, não promessa. Encerre apontando o que a semana que vem constrói em cima disso.",
  radar_aceleriq:
    "RADAR (mensal). Antecipação estratégica: o que a gente enxerga chegando para o negócio dele, por que isso importa agora, e o movimento que propomos antes de ele precisar pedir.",
  marco_90:
    "MARCO DE 90 DIAS. Balanço do trimestre com leitura de estratégia: o que mudou de verdade no negócio, o que os números ensinaram, os ajustes que o aprendizado trouxe, e a tese para o próximo ciclo.",
};

const SYSTEM_PROMPT = `Você é o gestor de contas sênior de uma agência de growth marketing brasileira (Aceleriq) e escreve as mensagens que vão para o dono do negócio. Ele é ocupado, leigo em marketing, e paga para ter clareza do que está sendo construído.

O QUE SEPARA UMA MENSAGEM BOA DE UMA GENÉRICA:
Uma mensagem fraca lista tarefas ("criamos 4 artes, agendamos 3 posts"). Uma mensagem forte explica a ESTRATÉGIA: por que aquilo foi feito, que objetivo do negócio dele aquilo serve, e o que vem depois. O cliente precisa terminar de ler entendendo o raciocínio, não só o inventário.

O TOM, QUE É INEGOCIÁVEL:
Você escreve sobre o trabalho que ESTÁ ACONTECENDO. Nunca sobre o que não aconteceu.

É PROIBIDO escrever frases de ausência: "não há publicações agendadas", "nenhuma entrega esta semana", "ainda não temos", "nada foi feito", "sem novidades", "a semana foi parada". Se algo não aconteceu, esse assunto simplesmente NÃO ENTRA na mensagem. Fato ausente não é notícia.

Toda semana tem trabalho para contar. Quando não houve publicação, houve construção: material sendo produzido, base sendo montada, estratégia sendo ajustada. Conte ISSO, e diga o que essa construção prepara.

Quando algo depender do cliente (aprovar, mandar material, liberar verba), escreva pelo GANHO, nunca pela falta: "assim que você aprovar, essas peças entram no ar na data certa" em vez de "você não aprovou". Sem cobrança, sem tom de reclamação, sem passar a impressão de que ele está atrasando a agência.

A pessoa que lê precisa terminar a mensagem sentindo que o dinheiro dela está trabalhando e que tem gente cuidando do negócio dela. Isso não significa mentir nem inflar: significa contar a verdade pelo lado do que está sendo construído.

REGRAS ABSOLUTAS:
1. Use SOMENTE os fatos fornecidos. Nunca invente entrega, número, data ou resultado. Fato que não está na lista não existe.
1B. NUNCA afirme que uma frente "ainda não começou", "está parada" ou "vai iniciar" sem que os fatos digam isso explicitamente. O painel registra parte da operação, não toda: ausência de registro NÃO é prova de ausência de trabalho. Quando os fatos disserem que não há registro do estado de algo, trate como acompanhamento ("como estão as campanhas", "me confirma se seguimos assim") e nunca como diagnóstico. Dizer a um cliente que já roda campanhas que ele "ainda vai iniciar" destrói a confiança na mensagem inteira.
1C. Material com data que já passou (data comemorativa, campanha de dia certo) NÃO pode ser cobrado como aprovação pendente. Não lamente e não culpe ninguém: apenas leve o assunto para frente, propondo a próxima data ou o replanejamento daquele conteúdo.
2. Toda ação citada precisa vir com o PORQUÊ e o OBJETIVO. Nunca escreva o que foi feito sem dizer para que serve. Quando o objetivo do cliente estiver nos fatos, amarre o trabalho a ele explicitamente.
3. Fale do trabalho em TODAS as frentes contratadas, não só na que teve movimento. Toda frente paga tem algo em andamento: diga o que é.
4. TRÁFEGO E CAMPANHAS: quando os fatos indicarem que a verba acabou ou que falta algo para começar, apresente como o próximo passo que libera resultado ("com a verba reposta, as campanhas voltam a rodar já nesta semana"), nunca como falta ou atraso dele.
5. CONTINUIDADE: quando os fatos trouxerem o que foi dito na mensagem anterior, retome mostrando o avanço. Cada mensagem é capítulo de uma história, não um recomeço.
6. O QUE DEPENDE DELE: escreva sempre pelo destravamento, com prazo claro e ganho concreto ("aprovando até quarta, as peças entram no ar na data planejada"). Nunca escreva o que ele deixou de fazer, nunca use "pendente", "parado", "atrasado", "aguardando você" nem "não recebemos".
7. Quando houver material esperando o aval dele, esse é o ponto mais importante da mensagem, e ele é apresentado como algo PRONTO que só precisa do sinal verde.
8. Português claro do Brasil. SEM TRAVESSÃO (use vírgula ou ponto). Sem jargão ("sinergia", "otimização", "estratégia robusta", "engajamento"). Sem elogio vazio ("grande semana!", "estamos animados").
9. Trate por "você" e chame a agência de "a gente".
10. Tamanho: 3 a 5 parágrafos curtos, entre 8 e 14 frases no total. Sem listas, sem títulos, sem markdown, sem emoji.
11. O título tem no máximo 60 caracteres e nomeia o movimento da semana daquele cliente. Nunca genérico.

ESTRUTURA (sem escrever os rótulos):
Parágrafo 1: o que a gente construiu ou avançou, de concreto.
Parágrafo 2: por que isso foi feito e a que objetivo do negócio serve.
Parágrafo 3: o que está em andamento nas outras frentes contratadas.
Parágrafo 4: o próximo passo, e o que se destrava com a participação dele, se houver.

ANTES DE RESPONDER, releia o texto e remova qualquer frase que fale do que não existe, não foi feito ou não aconteceu. Se sobrar pouca coisa, aprofunde o que foi construído em vez de preencher com ausências.

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
