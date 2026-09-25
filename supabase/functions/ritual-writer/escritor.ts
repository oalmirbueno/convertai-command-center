// Aceleriq OS — o escritor dos rituais (prompt, chamada à IA e conferência).
//
// Mora aqui, fora do index.ts, para dois chamadores usarem o MESMO escritor:
// a função ritual-writer (Central, Perfis, aprimorar) e o agente da Central
// (agente-central, "Atualizar todos"). O modelo e a rota são os que o dono
// escolheu para o ritual (cadeia gpt-4.1 > gpt-4o > gpt-4o-mini, AI_MODEL do
// segredo sobrepõe): nada disso mudou.

import {
  DEFAULT_LOVABLE_MODEL_CHAIN,
  requestAiChatCompletion,
  resolveAiProviderChain,
} from "../_shared/ai-provider.ts";
import { jevPerguntar, probabilidadeNoul } from "../_shared/jev.ts";
import { type ResultadoDaRepeticao, type RitualParaComparar, verificarRepeticao } from "./memoria.ts";

// O modelo forte escreve; o mini fica de reserva. O custo por mensagem com o
// gpt-4.1 fica na casa de centavos (ver a estimativa na Central).
export const PRIMARY_MODEL_CHAIN = ["gpt-4.1", "gpt-4o", "gpt-4o-mini"];

// O que cada ritual precisa entregar. É a diferença entre um recado semanal
// e um relatório: cada um tem um trabalho distinto na relação com o cliente.
export const RITUAL_BRIEF: Record<string, string> = {
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

// A Central manda o ritual; a gaveta de Perfis manda o momento do grupo.
export const MOMENTO: Record<string, string> = { abertura: "rota_semana", meio: "meio_semana", fechamento: "prova_movimento" };

export const SYSTEM_PROMPT = `Você é o gestor de contas sênior de uma agência de growth marketing brasileira (Aceleriq) e escreve as mensagens que vão para o dono do negócio. Ele é ocupado, leigo em marketing, e paga para ter clareza do que está sendo construído. A agência conduz cada cliente pelo método ACELERA (Analisar, Clarear, Estruturar, Lançar, Executar, Revisar, Acelerar); a mensagem mostra essa condução pelo que ela significa no negócio dele, nunca como jargão.

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
5. CONTINUIDADE: quando os fatos trouxerem o que foi dito nas mensagens anteriores, retome mostrando o avanço. Cada mensagem é capítulo de uma história, não um recomeço.
6. O QUE DEPENDE DELE: escreva sempre pelo destravamento, com prazo claro e ganho concreto ("aprovando até quarta, as peças entram no ar na data planejada"). Nunca escreva o que ele deixou de fazer, nunca use "pendente", "parado", "atrasado", "aguardando você" nem "não recebemos".
7. Quando houver material esperando o aval dele, esse é o ponto mais importante da mensagem, e ele é apresentado como algo PRONTO que só precisa do sinal verde.
8. Português claro do Brasil. SEM TRAVESSÃO (use vírgula ou ponto). Sem jargão ("sinergia", "otimização", "estratégia robusta", "engajamento"). Sem elogio vazio ("grande semana!", "estamos animados").
9. Trate por "você" e chame a agência de "a gente".
10. FORMATO DE WHATSAPP, pronto para colar no grupo: blocos curtos separados por linha em branco, cada bloco com um título curto em negrito de WhatsApp (asteriscos: *Onde estamos*) e de 1 a 4 linhas embaixo; use "•" para listar quando houver mais de um item. Sem markdown de cabeçalho (#), sem emoji, sem tabela. Entre 10 e 18 linhas de texto no total. A pessoa lê no celular em 40 segundos e entende tudo.
11. O título tem no máximo 60 caracteres e nomeia o movimento da semana daquele cliente. Nunca genérico, e nunca igual ao título de uma mensagem anterior.
12. NÚMEROS E VENDAS: quando os fatos trouxerem números (seguidores, alcance, leads, gasto, vendas, receita), eles entram em um bloco próprio, com o número exato e a comparação que os fatos deram, seguido de UMA frase do que faremos por causa disso. Venda registrada é o resultado mais importante da mensagem: nunca fica de fora.
13. PROGRESSÃO: quando os fatos trouxerem "o que mudou no dossiê", "o que mudou desde o último ritual" ou "o que a esteira provou como feito", isso vira o coração do bloco de avanço, com nome, nunca como lista de tarefas.
14. FRENTES SEPARADAS: conteúdo (Instagram, posts, artes) e tráfego pago (campanhas, leads, verba) são frentes diferentes; cada uma tem seu próprio bloco ou frase, e nunca repita a mesma ação nas duas.
15. NOME E PESSOA: a mensagem é para uma pessoa com nome. Abra com o primeiro nome da pessoa de contato ("Boa tarde, Priscila.") e cite o nome do negócio uma vez, de forma natural, no corpo. Nunca escreva "cliente", "prezado" ou "olá, tudo bem?" genérico.
16. LINGUAGEM SIMPLES, SEM TERMO TÉCNICO: escreva como se explicasse para um dono de negócio que não é do marketing. Troque sempre: "tráfego pago" por "anúncios"; "leads" por "pessoas interessadas" ou "contatos"; "conversão" por "pedidos", "orçamentos" ou "mensagens"; "alcance" por "pessoas que viram"; "impressões" por "vezes que o anúncio apareceu"; "criativos" por "artes" ou "vídeos dos anúncios"; "copy" por "texto"; "CPC/CTR/CPM/ROAS/CPA/KPI" por o que o número significa em reais ou em pessoas; "funil" por "caminho até a compra"; "landing page" por "página"; "briefing" por "orientação"; "otimizar" por "ajustar". Todo número vem com o que ele significa na prática ("R$ 55 investidos trouxeram 2 conversas no WhatsApp: cada conversa custou cerca de R$ 28").
17. AVANÇO SEMPRE VISÍVEL: toda mensagem precisa deixar claro o que andou desde a última vez. Quando os fatos trouxerem a ÚLTIMA MENSAGEM ENVIADA ou as PROMESSAS DO ÚLTIMO RITUAL, o bloco de avanço começa retomando o que foi prometido e mostrando o que virou realidade ("Na segunda a gente combinou X; X já está no ar"). Sem mensagem anterior, mostre o avanço em relação ao começo da semana. Avanço é sempre concreto e com nome; nunca "seguimos trabalhando".
18. NADA DE REPETIÇÃO: quando os fatos trouxerem O QUE JÁ FOI DITO A ESTE CLIENTE, é proibido repetir a abertura (a frase depois do cumprimento), frases, a mesma sequência de títulos de blocos ou um assunto já contado como se fosse novo. O que já foi dito só volta como continuação, dizendo o que mudou desde então. Se um assunto não teve fato novo, ele não entra de novo. Uma mensagem de segunda nunca repete a de sexta; a de sexta nunca repete a de segunda.
19. PROGRESSÃO DA SEMANA: segunda PLANEJA (parte do fechamento da sexta e diz o plano novo), quarta ACOMPANHA (parte do plano da segunda e diz o que já saiu do papel), sexta FECHA (parte do que a segunda prometeu e prova o que virou realidade). Siga a PROGRESSÃO DA SEMANA dos fatos.
20. MÉTODO: quando os fatos trouxerem a fase do MÉTODO ACELERA, a condução da mensagem segue o que aquela fase pede e o que o ritual de hoje conduz nela. Diga o próximo degrau do negócio dele, não o mesmo passo de sempre.

ESTRUTURA (base que funciona; títulos em negrito de WhatsApp, pulando o bloco que não tiver fato):
Linha de abertura: cumprimento com o nome e uma frase NOVA que diga o momento (segunda abre a semana, quarta mostra o meio, sexta fecha), diferente das aberturas já usadas.
*Onde estamos*: o retrato do negócio hoje, vindo do dossiê, em 1 a 3 linhas.
*O que avançou*: o que a gente construiu ou entregou, com nome e com o porquê (que objetivo serve).
*O que os números dizem*: só se houver número; número exato + o que faremos por causa dele.
*O que vem agora*: o próximo passo em cada frente contratada, ligado ao foco da semana.
*Precisamos de você*: só se houver algo que depende dele, escrito pelo ganho, com prazo.
Linha final: uma frase de fechamento e "Tudo detalhado no painel: aceleriq.online".
Variação obrigatória: os títulos de "Onde estamos", "O que avançou" e "O que os números dizem" podem e devem ganhar nome próprio da semana (ex.: *A campanha de primavera no ar*), e a ordem acompanha o dia (segunda pode começar pelo plano, sexta pela prova). Os títulos *O que vem agora* e *Precisamos de você* ficam sempre com esse nome, porque o painel lê o próximo passo por eles. Nunca use a mesma sequência de títulos da mensagem anterior.

ANTES DE RESPONDER, releia o texto e remova qualquer frase que fale do que não existe, não foi feito ou não aconteceu. Remova também qualquer frase que repita uma mensagem anterior. Se sobrar pouca coisa, aprofunde o que foi construído em vez de preencher com ausências.

ALERTAS INTERNOS (nunca vão para o cliente): liste em "alertas" o que você precisou e NÃO encontrou nos fatos, ou afirmou com pouca firmeza (ex.: "sem registro do estado das campanhas", "dossiê com mais de 20 dias", "nenhum número de Instagram", "objetivo do cliente não consta"). Máximo 4, frases curtas, para a equipe completar o painel. Se não houver, lista vazia.

PRÓXIMO PASSO SEPARADO: além do texto, devolva em "next_steps" UMA frase objetiva (até 240 caracteres) com a próxima ação combinada e o que se espera dela, tirada do que você escreveu em *O que vem agora* e *Precisamos de você*. Nunca vazio.

TAREFAS SUGERIDAS PARA A EQUIPE (nunca vão para o cliente): em "tarefas_sugeridas" liste de 0 a 5 tarefas internas que a equipe precisa executar para CUMPRIR o que esta mensagem promete. Cada uma nasce de uma frase do texto (em "promessa", o trecho que ela cumpre) e de um fato; nada genérico ("postar nas redes", "acompanhar métricas"). Diga QUAL peça, QUAL campanha, QUAL decisão. "frente" é social, trafego ou geral; "prazo_dias" é em quantos dias precisa estar feito (1 a 14). Não repita uma tarefa que os fatos já mostram como aberta. Elas são sugestão: a equipe aprova antes de virar tarefa.

QUANDO HOUVER "TEXTO ATUAL": a tarefa é APRIMORAR E COMPLEMENTAR, não recomeçar. Mantenha o que está certo e no tom, corrija o que os fatos contradizem, complete com os fatos que faltaram (números, vendas, frentes sem menção), separe o que estiver misturado entre conteúdo e tráfego, tire o que repete mensagens anteriores, e devolva o texto inteiro já pronto.

Responda SOMENTE com JSON válido: {"title":"...","body":"...","next_steps":"...","alertas":["..."],"tarefas_sugeridas":[{"titulo":"...","passo":"...","frente":"social|trafego|geral","prazo_dias":3,"promessa":"..."}]}`;

/** O proximo passo tambem pode ser lido do proprio texto, quando a IA esquecer o campo. */
export function proximoPassoDoTexto(body: string): string {
  const linhas = body.split(/\r?\n/);
  const escolhidas: string[] = [];
  let dentro = false;
  for (const bruta of linhas) {
    const linha = bruta.trim();
    const titulo = linha.match(/^\*([^*]{2,60})\*:?\s*(.*)$/);
    if (titulo) {
      dentro = /o que vem agora|precisamos de voc|pr[oó]ximos? passos?/i.test(titulo[1]);
      if (dentro && titulo[2]) escolhidas.push(titulo[2].trim());
      continue;
    }
    if (!linha) { dentro = false; continue; }
    if (dentro) escolhidas.push(linha.replace(/^[•\-–]\s*/, ""));
  }
  return escolhidas.join(" ").replace(/\s+/g, " ").trim().slice(0, 600);
}

export function extractJson(raw: string): Record<string, unknown> {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("resposta sem JSON");
  return JSON.parse(trimmed.slice(start, end + 1));
}

export interface TarefaSugerida {
  titulo: string;
  passo: string;
  frente: "social" | "trafego" | "geral";
  prazo_dias: number;
  promessa: string;
}

/** Sugestões da IA em forma segura: no máximo 5, campos curtos, frente fechada. */
export function normalizarTarefas(raw: unknown): TarefaSugerida[] {
  if (!Array.isArray(raw)) return [];
  const vistas = new Set<string>();
  const saida: TarefaSugerida[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const titulo = String(r.titulo ?? "").replace(/\s+/g, " ").trim().slice(0, 90);
    if (titulo.length < 4) continue;
    const chave = titulo.toLowerCase();
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    const frente = r.frente === "social" || r.frente === "trafego" ? r.frente : "geral";
    const prazo = Math.round(Number(r.prazo_dias));
    saida.push({
      titulo,
      passo: String(r.passo ?? "").replace(/\s+/g, " ").trim().slice(0, 240),
      frente,
      prazo_dias: Number.isFinite(prazo) ? Math.min(14, Math.max(1, prazo)) : 4,
      promessa: String(r.promessa ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
    });
    if (saida.length >= 5) break;
  }
  return saida;
}

export interface PedidoDoRitual {
  ritual: string;
  clientName: string;
  contactName: string;
  facts: string;
  /** Bloco de memória e continuidade montado no servidor (contexto.ts). */
  continuidade?: string;
  textoAtual?: string;
  passoAtual?: string;
}

export interface RitualEscrito {
  title: string | null;
  body: string;
  next_steps: string;
  alertas: string[];
  tarefas_sugeridas: TarefaSugerida[];
  model: string;
  usage: unknown;
}

/**
 * Escreve o ritual. Devolve null quando a cadeia de IA não respondeu ou veio
 * sem texto: quem chama usa o texto de reserva (nunca um erro para o cliente).
 */
export async function escreverRitual(p: PedidoDoRitual): Promise<RitualEscrito | null> {
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
          `TIPO DE MENSAGEM: ${RITUAL_BRIEF[p.ritual]}\n\n` +
          `NEGÓCIO: ${p.clientName}\n` +
          `PESSOA DE CONTATO (abra a mensagem com este primeiro nome): ${p.contactName || "não informado; use o nome do negócio"}\n\n` +
          (p.continuidade ? `MEMÓRIA E CONTINUIDADE (lido agora no servidor; manda sobre o que é dito nos fatos quando os dois falam do mesmo ritual):\n${p.continuidade}\n\n` : "") +
          `FATOS REAIS DESTA SEMANA (do painel):\n${p.facts}` +
          (p.textoAtual
            ? `\n\nTEXTO ATUAL (aprimorar e complementar com os fatos acima; manter o que esta certo):\n${p.textoAtual}` +
              (p.passoAtual ? `\n\nPROXIMO PASSO ATUAL: ${p.passoAtual}` : "")
            : ""),
      },
    ],
    temperature: p.textoAtual ? 0.35 : 0.55,
  });
  if (!response.ok) {
    console.warn(`[ritual] cadeia esgotada, último: ${provider.label} HTTP ${response.status}`);
    return null;
  }
  const completion = await response.json();
  const parsed = extractJson(completion?.choices?.[0]?.message?.content || "");
  const body = String(parsed?.body || "").trim();
  if (!body) return null;
  const alertas = Array.isArray(parsed?.alertas) ? (parsed.alertas as unknown[]).map((a) => String(a).slice(0, 160)).filter(Boolean).slice(0, 4) : [];
  const nextSteps = (String(parsed?.next_steps || "").trim() || proximoPassoDoTexto(body) || p.passoAtual || "").slice(0, 600);
  return {
    title: String(parsed?.title || "").trim() || null,
    body,
    next_steps: nextSteps,
    alertas,
    tarefas_sugeridas: normalizarTarefas(parsed?.tarefas_sugeridas),
    model: provider.model,
    usage: completion?.usage ?? null,
  };
}

export type ConferenciaDeRepeticao = ResultadoDaRepeticao & {
  jev: { usado: boolean; probabilidade: number | null; aviso: string | null; erro?: string } | null;
};

/**
 * Conferência de repetição: primeiro a regra determinística (n-gramas);
 * só quando ela passa do limite o Jev lê o sentido, e o que ele diz vira
 * AVISO NA TELA. Não há segunda escrita: sem laço de correção.
 */
export async function conferirRepeticao(body: string, anteriores: readonly RitualParaComparar[]): Promise<ConferenciaDeRepeticao> {
  const r = verificarRepeticao(body, anteriores);
  if (!r.acima_do_limite) return { ...r, jev: null };
  try {
    const resposta = await jevPerguntar({
      state: {
        mensagem_nova: body.slice(0, 2500),
        mensagens_anteriores: anteriores.slice(0, 4).map((a) => ({ data: a.quando.slice(0, 10), texto: String(a.texto).slice(0, 1500) })),
        sinais_da_conferencia: r.motivos,
      },
      questions: {
        repete: {
          type: "noul",
          instructions: "Uma agência manda mensagens semanais ao dono de um negócio. A `mensagem_nova` repete para ele o que as `mensagens_anteriores` já disseram (mesmo assunto contado como novidade, mesma abertura, mesmas frases ou o mesmo plano), em vez de continuar a história com o que mudou?",
          criteria: {
            true: "Repete: o dono vai sentir que recebeu a mesma mensagem de novo.",
            false: "Continua: retoma o anterior só para dizer o que andou e traz assunto novo.",
          },
        },
      },
    }, { timeoutMs: 8_000 });
    const p = probabilidadeNoul(resposta.answers.repete);
    const aviso = p !== null && p >= 0.5
      ? `O Jev leu repetição (${Math.round(p * 100)}%). Vale ajustar antes de enviar.`
      : p !== null ? `O Jev leu continuidade (${Math.round((1 - p) * 100)}%), apesar das frases parecidas.` : null;
    return { ...r, jev: { usado: true, probabilidade: p, aviso } };
  } catch (e) {
    // Sem chave, sem rede ou fora do tempo: fica o aviso determinístico.
    return { ...r, jev: { usado: false, probabilidade: null, aviso: null, erro: e instanceof Error ? e.message : "falha" } };
  }
}
