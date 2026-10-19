// Aceleriq OS — o escritor dos rituais (prompt, chamada à IA e conferência).
//
// Mora aqui, fora do index.ts, para dois chamadores usarem o MESMO escritor:
// a função ritual-writer (Central, Perfis, aprimorar) e o agente da Central
// (agente-central, "Atualizar todos").
//
// Modelo (frente CE, 28/09): GPT-6 Luna com raciocínio máximo pelo motor das
// mesas (_shared/modelo-da-central.ts), escolhido na Central; a cadeia antiga
// (gpt-4.1 > gpt-4o > gpt-4o-mini) só entra como reserva, uma vez, com aviso.
// O que o escritor lê também mudou: primeiro o ESTADO REAL lido no servidor
// (orgânico e pago separados, com período), depois as promessas conferidas, a
// memória do que já foi dito e, por último, os fatos do painel como
// complemento. Antes o dossiê inteiro vinha na frente e o corte de 12 mil
// caracteres jogava fora a semana.

import { jevPerguntar, notaScore, type PerguntaJev, probabilidadeNoul } from "../_shared/jev.ts";
import { BRIEF_POR_RITUAL, blocoDeComunicacao, expressoesDeRobo, semTravessao, TOM_DE_GENTE } from "../_shared/comunicacao-com-cliente.ts";
import { type EscolhaDoModelo, escreverComModeloDaCentral, type TextoEscrito } from "../_shared/modelo-da-central.ts";
import { aberturaDoRitual, type ResultadoDaRepeticao, type RitualParaComparar, verificarRepeticao } from "./memoria.ts";
// Frente SPP (revisão 30/09): o método da casa (prova) também no escritor dos rituais (agente rituais.escritor).
import type { MetodoInjetado } from "../_shared/superpoderes-catalogo.ts";

// A cadeia antiga continua exportada: é a reserva do motor e o agente da
// Central ainda a usa como caminho de reserva nas perguntas.
export const PRIMARY_MODEL_CHAIN = ["gpt-4.1", "gpt-4o", "gpt-4o-mini"];

// O que cada ritual precisa entregar (o conhecimento mora em
// _shared/comunicacao-com-cliente.ts, com as fontes).
export const RITUAL_BRIEF: Record<string, string> = BRIEF_POR_RITUAL;

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
3. CURTO E SÓ O QUE MUDOU (19/10, o dono: "muito textão, sempre repete, os clientes estão de saco cheio"): conte só o que andou DESDE A ÚLTIMA MENSAGEM ENVIADA. Frente sem fato novo não entra; não é preciso citar todas as frentes em toda mensagem.
4. TRÁFEGO E CAMPANHAS: quando os fatos indicarem que a verba acabou ou que falta algo para começar, apresente como o próximo passo que libera resultado ("com a verba reposta, as campanhas voltam a rodar já nesta semana"), nunca como falta ou atraso dele.
5. CONTINUIDADE: quando os fatos trouxerem o que foi dito nas mensagens anteriores, retome mostrando o avanço. Cada mensagem é capítulo de uma história, não um recomeço.
6. O QUE DEPENDE DELE: escreva sempre pelo destravamento, com prazo claro e ganho concreto ("aprovando até quarta, as peças entram no ar na data planejada"). Nunca escreva o que ele deixou de fazer, nunca use "pendente", "parado", "atrasado", "aguardando você" nem "não recebemos".
7. Quando houver material esperando o aval dele, esse é o ponto mais importante da mensagem, e ele é apresentado como algo PRONTO que só precisa do sinal verde.
8. Português claro do Brasil. SEM TRAVESSÃO (use vírgula ou ponto). Sem jargão ("sinergia", "otimização", "estratégia robusta", "engajamento"). Sem elogio vazio ("grande semana!", "estamos animados").
9. Trate por "você" e chame a agência de "a gente".
10. FORMATO DE WHATSAPP, pronto para colar no grupo, lido em 20 segundos no celular. Nas mensagens da semana (segunda, quarta, sexta): de 3 a 6 linhas no total, até 600 caracteres, uma ideia por linha, linhas separadas por linha em branco, SEM títulos de bloco e sem listas longas. No balanço do mês e no marco de 90 dias: até 14 linhas, com títulos curtos em negrito de WhatsApp (*assim*) e os números do período. Sem markdown de cabeçalho (#), sem emoji, sem tabela.
11. O título tem no máximo 60 caracteres e nomeia o fato novo desta mensagem. Nunca genérico, e nunca parecido com um título do bloco JÁ DITO (nada de "Semana fecha com anúncios em alta" de novo).
12. NÚMEROS E VENDAS: no máximo UM número por mensagem da semana, o que mais mudou, com a comparação e o que ele significa na prática. Número que já foi dito numa mensagem anterior e não mudou NÃO volta (o "custo de R$ 2 por contato" toda semana cansa). Venda registrada é o resultado mais importante: quando houver, é ela o número da mensagem.
13. PROGRESSÃO: quando os fatos trouxerem "o que mudou no dossiê", "o que mudou desde o último ritual" ou "o que a esteira provou como feito", isso vira o coração do bloco de avanço, com nome, nunca como lista de tarefas.
14. FRENTES SEPARADAS: conteúdo (Instagram, posts, artes) e tráfego pago (campanhas, leads, verba) são frentes diferentes; cada uma tem seu próprio bloco ou frase, e nunca repita a mesma ação nas duas.
15. NOME E PESSOA: a mensagem é para uma pessoa com nome. Abra com o primeiro nome da pessoa de contato ("Boa tarde, Priscila.") e cite o nome do negócio uma vez, de forma natural, no corpo. Nunca escreva "cliente", "prezado" ou "olá, tudo bem?" genérico.
16. LINGUAGEM SIMPLES, SEM TERMO TÉCNICO: escreva como se explicasse para um dono de negócio que não é do marketing. Troque sempre: "tráfego pago" por "anúncios"; "leads" por "pessoas interessadas" ou "contatos"; "conversão" por "pedidos", "orçamentos" ou "mensagens"; "alcance" por "pessoas que viram"; "impressões" por "vezes que o anúncio apareceu"; "criativos" por "artes" ou "vídeos dos anúncios"; "copy" por "texto"; "CPC/CTR/CPM/ROAS/CPA/KPI" por o que o número significa em reais ou em pessoas; "funil" por "caminho até a compra"; "landing page" por "página"; "briefing" por "orientação"; "otimizar" por "ajustar". Todo número vem com o que ele significa na prática ("R$ 55 investidos trouxeram 2 conversas no WhatsApp: cada conversa custou cerca de R$ 28").
17. AVANÇO SEMPRE VISÍVEL: toda mensagem precisa deixar claro o que andou desde a última vez. Quando os fatos trouxerem a ÚLTIMA MENSAGEM ENVIADA ou as PROMESSAS DO ÚLTIMO RITUAL, o bloco de avanço começa retomando o que foi prometido e mostrando o que virou realidade ("Na segunda a gente combinou X; X já está no ar"). Sem mensagem anterior, mostre o avanço em relação ao começo da semana. Avanço é sempre concreto e com nome; nunca "seguimos trabalhando".
18. NADA DE REPETIÇÃO: o bloco JÁ DITO traz as últimas mensagens deste cliente (título, abertura e números citados). É proibido repetir a abertura (a frase depois do cumprimento), frases, a mesma sequência de títulos de blocos ou um assunto já contado como se fosse novo. O que já foi dito só volta como continuação, dizendo o que mudou desde então. Se um assunto não teve fato novo, ele não entra de novo. Uma mensagem de segunda nunca repete a de sexta; a de sexta nunca repete a de segunda.
19. PROGRESSÃO DA SEMANA: segunda PLANEJA (parte do fechamento da sexta e diz o plano novo), quarta ACOMPANHA (parte do plano da segunda e diz o que já saiu do papel), sexta FECHA (parte do que a segunda prometeu e prova o que virou realidade). Siga a PROGRESSÃO DA SEMANA dos fatos.
20. MÉTODO: quando os fatos trouxerem a fase do MÉTODO ACELERA, a condução da mensagem segue o que aquela fase pede e o que o ritual de hoje conduz nela. Diga o próximo degrau do negócio dele, não o mesmo passo de sempre.
21. ESTADO REAL MANDA: o bloco ESTADO REAL DO CLIENTE foi lido agora no banco e é a fonte da verdade do que está sendo feito. Quando ele e os fatos do painel ou o dossiê discordarem, vale o ESTADO REAL. Todo número que você citar sai dele ou dos fatos, com o período (datas) que ele traz.
22. CAMPANHA DA MESA NÃO É ANÚNCIO: "campanha" na área de Campanhas da Mesa é um tema ou oferta de comunicação. Só fale dela como anúncio se o canal dela disser "paga" ou "orgânica e com anúncio". Anúncio pago é SÓ o que está no bloco ANÚNCIOS PAGOS. Nunca atribua a uma campanha de conteúdo número de anúncio, e nunca diga que um anúncio está no ar sem ele estar lá.
23. PROMESSA EM ANDAMENTO: o que o bloco de promessas marca como EM ANDAMENTO não volta como novidade nem como promessa nova. Para o cliente, diga com naturalidade que segue em andamento (uma frase, sem prazo inventado); o reforço interno já foi para a equipe. O que está CUMPRIDA entra como entregue, com o dia.
24. METAS: quando houver META BATIDA E AINDA NÃO COMEMORADA, reconheça em uma frase de gente ("batemos os 1.000 seguidores, parabéns, a gente chegou lá junto") e anuncie a próxima meta cadastrada com quanto falta. Meta já comemorada não se comemora de novo. Sem meta cadastrada, não invente meta.
25. COMO ESTÁ INDO: diga, com o número, se a semana (ou o mês) foi melhor ou pior que a anterior em cada frente e o que vamos fazer por causa disso. Previsão só a que vem calculada no ESTADO REAL.

ESTRUTURA DA SEMANA (até 6 linhas, sem títulos de bloco):
Linha 1: cumprimento com o primeiro nome e o fato novo mais importante, dito de um jeito que não esteja no bloco JÁ DITO.
Linhas 2 e 3: o que andou desde a última mensagem, com nome e para que serve.
Linha 4 (só se houver número novo): o número que mais mudou e o que ele significa.
Linha 5: o próximo passo; se algo depender dele, o pedido com prazo e ganho.
Última linha: "Tudo no painel: aceleriq.online".
No balanço do mês e no marco de 90 dias vale a estrutura em blocos com títulos curtos, até 14 linhas.
SEM NOVIDADE: se nada mudou desde a última mensagem enviada, escreva só 2 ou 3 linhas (cumprimento, o que segue em andamento numa frase, o próximo passo), devolva "sem_novidade": true e ponha em "alertas" que não houve fato novo desde a última mensagem. Nunca encha a mensagem para parecer movimento.

ANTES DE RESPONDER, releia o texto e remova qualquer frase que fale do que não existe, não foi feito ou não aconteceu, e qualquer frase, abertura, título ou número que esteja no bloco JÁ DITO. Se passar de 6 linhas numa mensagem da semana, corte o menos importante. Mensagem curta e nova vale mais que mensagem completa e repetida.

ALERTAS INTERNOS (nunca vão para o cliente): liste em "alertas" o que você precisou e NÃO encontrou nos fatos, ou afirmou com pouca firmeza (ex.: "sem registro do estado das campanhas", "dossiê com mais de 20 dias", "nenhum número de Instagram", "objetivo do cliente não consta"). Máximo 4, frases curtas, para a equipe completar o painel. Se não houver, lista vazia.

PRÓXIMO PASSO SEPARADO: além do texto, devolva em "next_steps" UMA frase objetiva (até 240 caracteres) com a próxima ação combinada e o que se espera dela, tirada da linha do próximo passo. Nunca vazio.

TAREFAS SUGERIDAS PARA A EQUIPE (nunca vão para o cliente): em "tarefas_sugeridas" liste de 0 a 5 tarefas internas que a equipe precisa executar para CUMPRIR o que esta mensagem promete. Cada uma nasce de uma frase do texto (em "promessa", o trecho que ela cumpre) e de um fato; nada genérico ("postar nas redes", "acompanhar métricas"). Diga QUAL peça, QUAL campanha, QUAL decisão. "frente" é social, trafego ou geral; "prazo_dias" é em quantos dias precisa estar feito (1 a 14). Não repita uma tarefa que os fatos já mostram como aberta. Elas são sugestão: a equipe aprova antes de virar tarefa.

QUANDO HOUVER "TEXTO ATUAL": a tarefa é APRIMORAR E COMPLEMENTAR, não recomeçar. Mantenha o que está certo e no tom, corrija o que os fatos contradizem, complete com os fatos que faltaram (números, vendas, frentes sem menção), separe o que estiver misturado entre conteúdo e tráfego, tire o que repete mensagens anteriores, e devolva o texto inteiro já pronto.

Responda SOMENTE com JSON válido: {"title":"...","body":"...","next_steps":"...","sem_novidade":false,"alertas":["..."],"tarefas_sugeridas":[{"titulo":"...","passo":"...","frente":"social|trafego|geral","prazo_dias":3,"promessa":"..."}]}`;

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
  /** Estado real lido no servidor (estado-real-do-cliente.ts). */
  estado?: string;
  /** Promessas da última mensagem conferidas contra o painel. */
  promessas?: string;
  textoAtual?: string;
  passoAtual?: string;
  /** Carteira de IA que paga a chamada e registro do uso. */
  clientId?: string;
  criadoPor?: string | null;
  escolha?: EscolhaDoModelo;
  /** Frente SPP: o método da casa (superpoderesPara com o agente rituais.escritor); vai no fim do sistema. */
  metodo?: MetodoInjetado | null;
  /** 19/10: as últimas mensagens deste cliente (enviadas e rascunhos), para o bloco JÁ DITO e a escolha da versão. */
  jaDito?: readonly RitualParaComparar[];
}

export interface RitualEscrito {
  title: string | null;
  body: string;
  next_steps: string;
  alertas: string[];
  tarefas_sugeridas: TarefaSugerida[];
  model: string;
  /** Rótulo legível do modelo que respondeu. */
  modelo_rotulo: string;
  raciocinio: string | null;
  /** Aviso quando não foi o modelo escolhido (reserva). */
  reserva: string | null;
  custo_usd: number | null;
  /** Expressões de molde que escaparam (aviso, nunca correção). */
  robo: string[];
  usage: unknown;
  /** Frente SPP: o uso em ia_usos (null na reserva; aí quem chama registra o método sem uso). */
  uso_id?: string | null;
  /** 19/10: o escritor disse que nada mudou desde a última mensagem enviada. */
  sem_novidade?: boolean;
  /** 19/10: como a versão foi escolhida entre as escritas em paralelo. */
  escolha_da_versao?: EscolhaDaVersao | null;
}

/** A mensagem de usuário que o escritor recebe, na ordem que decide o texto. */
export function montarPedidoAoEscritor(p: PedidoDoRitual): string {
  const partes = [
    `TIPO DE MENSAGEM: ${RITUAL_BRIEF[p.ritual]}`,
    `NEGÓCIO: ${p.clientName}\nPESSOA DE CONTATO (abra a mensagem com este primeiro nome): ${p.contactName || "não informado; use o nome do negócio"}`,
    blocoDeComunicacao(p.ritual),
    TOM_DE_GENTE,
    p.estado || "",
    p.promessas || "",
    blocoDoJaDito(p.jaDito ?? []),
    p.continuidade ? `MEMÓRIA E CONTINUIDADE (lido agora no servidor; manda sobre o que é dito nos fatos quando os dois falam do mesmo ritual):\n${p.continuidade}` : "",
    `FATOS DO PAINEL (complemento montado na tela; o dossiê e o histórico ajudam a entender o cliente, mas o ESTADO REAL acima manda nos números e no que está sendo feito):\n${p.facts}`,
    p.textoAtual
      ? `TEXTO ATUAL (aprimorar e complementar com os fatos acima; manter o que esta certo):\n${p.textoAtual}` + (p.passoAtual ? `\n\nPROXIMO PASSO ATUAL: ${p.passoAtual}` : "")
      : "",
  ];
  return partes.filter(Boolean).join("\n\n");
}

/** Lê o JSON do escritor e devolve o ritual pronto (texto sem travessão). */
export function lerRespostaDoEscritor(bruto: string, passoAtual?: string): { title: string | null; body: string; next_steps: string; alertas: string[]; tarefas_sugeridas: TarefaSugerida[]; sem_novidade: boolean } | null {
  const parsed = extractJson(bruto);
  const body = semTravessao(String(parsed?.body || "").trim());
  if (!body) return null;
  const alertas = Array.isArray(parsed?.alertas) ? (parsed.alertas as unknown[]).map((a) => String(a).slice(0, 160)).filter(Boolean).slice(0, 4) : [];
  const nextSteps = semTravessao((String(parsed?.next_steps || "").trim() || proximoPassoDoTexto(body) || passoAtual || "").slice(0, 600));
  return {
    title: semTravessao(String(parsed?.title || "").trim()) || null,
    body,
    next_steps: nextSteps,
    alertas,
    tarefas_sugeridas: normalizarTarefas(parsed?.tarefas_sugeridas),
    sem_novidade: parsed?.sem_novidade === true,
  };
}

/** Números citados num texto (dinheiro, porcentagem e contagens com nome), para o bloco JÁ DITO. */
export function numerosDoTexto(texto: string): string[] {
  const achados = String(texto ?? "").match(/R\$\s?\d[\d.,]*|\d[\d.,]*\s?(?:%|conversas?|contatos?|pessoas|seguidores|posts?|publica[çc][õo]es|visitas|intera[çc][õo]es|reservas?|vendas?|pedidos?|or[çc]amentos?)/gi) ?? [];
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const a of achados) {
    const n = a.replace(/\s+/g, " ").trim();
    if (vistos.has(n.toLowerCase())) continue;
    vistos.add(n.toLowerCase());
    saida.push(n);
  }
  return saida;
}

/**
 * 19/10 (o dono: "sempre repete a mesma coisa"): o que as últimas mensagens já
 * disseram, dito de forma explícita (título, abertura e números citados). A
 * memória longa continua no bloco de continuidade; este é o que não pode voltar.
 */
export function blocoDoJaDito(anteriores: readonly RitualParaComparar[], max = 4): string {
  const validos = anteriores.filter((a) => a && String(a.texto ?? "").trim().length > 40).slice(0, max);
  if (!validos.length) return "";
  const linhas = validos.map((a) => {
    const dia = String(a.quando ?? "").slice(0, 10).split("-").reverse().slice(0, 2).join("/");
    const numeros = numerosDoTexto(a.texto).slice(0, 6);
    const titulo = String(a.titulo ?? "").trim().slice(0, 90);
    return `- ${dia}: ${titulo ? `título "${titulo}"; ` : ""}abertura "${aberturaDoRitual(a.texto).slice(0, 160)}"${numeros.length ? `; números citados: ${numeros.join(", ")}` : ""}`;
  });
  return `JÁ DITO A ESTE CLIENTE (as últimas mensagens; não repita título, abertura, frase nem número que não mudou; o que voltar é só para dizer o que mudou):\n${linhas.join("\n")}`;
}

/** Mensagens da semana são curtas; o balanço do mês e o marco de 90 dias podem ser maiores. */
export function limiteDoRitual(ritual: string): { linhas: number; caracteres: number } {
  return ritual === "radar_aceleriq" || ritual === "marco_90" ? { linhas: 14, caracteres: 1800 } : { linhas: 6, caracteres: 650 };
}

export function linhasDoTexto(body: string): number {
  return String(body ?? "").split(/\r?\n/).filter((l) => l.trim()).length;
}

/** O aviso para a equipe quando o escritor diz que nada mudou desde a última mensagem enviada. */
export const SEM_NOVIDADE = "Nada novo desde a última mensagem enviada: a mensagem saiu curta. Avalie se vale mandar hoje.";

/** Duas versões em paralelo: a segunda começa por outro ângulo, para a escolha ter alternativa de verdade. */
export const VERSOES_DO_RITUAL = 2;
const ANGULO_DA_VERSAO_B = "VERSÃO B: comece por outro ângulo que não o óbvio (pelo próximo passo ou pelo número que mais mudou) e use palavras diferentes das mensagens do bloco JÁ DITO.";

export interface EscolhaDaVersao {
  versoes: number;
  escolhida: number;
  pontos: number[];
  jev: boolean;
}

export interface NotaDaVersao {
  novidade: number | null;
  clareza: number | null;
}

/** Nota de uma versão: a regra conta repetição e tamanho; o Jev (0 a 3) mede novidade e clareza quando respondeu. */
export function pontosDaVersao(
  body: string,
  ritual: string,
  anteriores: readonly RitualParaComparar[],
  jev: NotaDaVersao = { novidade: null, clareza: null },
): number {
  const r = verificarRepeticao(body, anteriores);
  const lim = limiteDoRitual(ritual);
  const excessoLinhas = Math.max(0, linhasDoTexto(body) - lim.linhas);
  const excessoChars = Math.max(0, body.length - lim.caracteres);
  let pontos = 0;
  pontos -= r.indice * 6 + r.frases_repetidas.length + (r.abertura_repetida ? 2 : 0);
  pontos -= excessoLinhas * 0.75 + excessoChars / 200;
  if (jev.novidade !== null) pontos += jev.novidade * 2;
  if (jev.clareza !== null) pontos += jev.clareza;
  return Math.round(pontos * 100) / 100;
}

const NIVEIS_DE_NOVIDADE = [
  "Repete o que as mensagens anteriores já disseram: o dono sente que recebeu a mesma mensagem de novo",
  "Quase tudo já foi dito antes; só um detalhe é novo",
  "Traz fato novo, mas repete abertura, frase ou número já dito antes",
  "Só traz o que mudou desde a última mensagem, sem repetir abertura, frase ou número",
];
const NIVEIS_DE_CLAREZA = [
  "Longa ou confusa: um dono de negócio leigo não entende o que andou nem qual é o próximo passo",
  "Dá para entender com esforço: texto comprido, com termo técnico ou com assunto demais",
  "Clara, mas poderia ser mais curta ou mais direta",
  "Curta e clara: em 20 segundos no celular o dono entende o que andou e o próximo passo",
];

/** O Jev dá novidade e clareza de cada versão numa chamada só (Score, 4 níveis). Falha: null e vale a regra. */
export async function notasDoJev(
  versoes: string[],
  anteriores: readonly RitualParaComparar[],
  cobrar: { clientId?: string; criadoPor?: string | null },
): Promise<NotaDaVersao[] | null> {
  const questions: Record<string, PerguntaJev> = {};
  versoes.forEach((_, i) => {
    questions[`novidade_${i}`] = {
      type: "score",
      instructions: `Uma agência manda mensagens de WhatsApp ao dono de um negócio. Comparada com as \`mensagens_anteriores\`, quanto a mensagem em \`versoes[${i}]\` traz só o que é novo, sem repetir?`,
      criteria: NIVEIS_DE_NOVIDADE,
    };
    questions[`clareza_${i}`] = {
      type: "score",
      instructions: `Quanto a mensagem em \`versoes[${i}]\` é curta e clara para o dono de um negócio, que não é de marketing, ler no celular?`,
      criteria: NIVEIS_DE_CLAREZA,
    };
  });
  try {
    const r = await jevPerguntar({
      state: {
        mensagens_anteriores: anteriores.slice(0, 4).map((a) => ({ data: String(a.quando ?? "").slice(0, 10), texto: String(a.texto ?? "").slice(0, 1500) })),
        versoes: versoes.map((v) => v.slice(0, 2500)),
      },
      questions,
    }, { timeoutMs: 10_000 });
    if (cobrar.clientId) {
      // Import dinâmico: o ia-motor lê o ambiente do Deno e o Vitest não carrega.
      const { cobrarJev } = await import("../_shared/ia-motor.ts");
      await cobrarJev(r, { clientId: cobrar.clientId, tarefa: "conversa", criadoPor: cobrar.criadoPor ?? null }).catch(() => null);
    }
    return versoes.map((_, i) => ({ novidade: notaScore(r.answers[`novidade_${i}`]), clareza: notaScore(r.answers[`clareza_${i}`]) }));
  } catch (e) {
    console.warn(`[ritual] Jev da escolha indisponível, vale a regra: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/**
 * Escreve o ritual. Devolve null quando nenhum modelo respondeu ou veio sem
 * texto: quem chama usa o texto de reserva (nunca um erro para o cliente).
 *
 * 19/10: duas versões em paralelo (a B por outro ângulo) e fica a de mais
 * pontos (menos repetição contra o JÁ DITO, dentro do tamanho e, com o Jev,
 * mais novidade e clareza). Sem laço de correção: nenhuma versão é reescrita.
 * No aprimorar (texto atual) e sem cliente, uma versão só.
 */
export async function escreverRitual(
  p: PedidoDoRitual,
  escrever: typeof escreverComModeloDaCentral = escreverComModeloDaCentral,
  julgar: typeof notasDoJev = notasDoJev,
): Promise<RitualEscrito | null> {
  const usuario = montarPedidoAoEscritor(p);
  const temperatura = p.textoAtual ? 0.35 : 0.55;
  const umaVersao = (extra: string): Promise<TextoEscrito | null> => {
    const texto = extra ? `${usuario}\n\n${extra}` : usuario;
    if (p.clientId) {
      return escrever({ clientId: p.clientId, sistema: SYSTEM_PROMPT, usuario: texto, escolha: p.escolha, temperatura, criadoPor: p.criadoPor ?? null, metodo: p.metodo ?? null });
    }
    // Sem cliente não há carteira: só a cadeia antiga.
    return escrever({ clientId: "", sistema: SYSTEM_PROMPT, usuario: texto, escolha: { modelo: "legado:gpt-4.1", raciocinio: "medium" }, temperatura, metodo: p.metodo ?? null });
  };
  const quantas = p.textoAtual || !p.clientId ? 1 : VERSOES_DO_RITUAL;
  const saidas = await Promise.all(Array.from({ length: quantas }, (_, i) => umaVersao(i === 0 ? "" : ANGULO_DA_VERSAO_B).catch(() => null)));
  const candidatas: Array<{ lido: NonNullable<ReturnType<typeof lerRespostaDoEscritor>>; saida: TextoEscrito }> = [];
  for (const saida of saidas) {
    if (!saida) continue;
    try {
      const lido = lerRespostaDoEscritor(saida.texto, p.passoAtual);
      if (lido) candidatas.push({ lido, saida });
    } catch {
      // JSON inválido: essa versão não entra na escolha.
    }
  }
  if (!candidatas.length) {
    console.warn("[ritual] nenhum modelo respondeu");
    return null;
  }

  const anteriores = p.jaDito ?? [];
  let escolhida = 0;
  let escolhaDaVersao: EscolhaDaVersao | null = null;
  if (candidatas.length > 1) {
    const notas = await julgar(candidatas.map((c) => c.lido.body), anteriores, { clientId: p.clientId, criadoPor: p.criadoPor ?? null });
    const pontos = candidatas.map((c, i) => pontosDaVersao(c.lido.body, p.ritual, anteriores, notas?.[i]));
    escolhida = pontos.indexOf(Math.max(...pontos));
    escolhaDaVersao = { versoes: candidatas.length, escolhida, pontos, jev: !!notas };
  }
  const { lido, saida } = candidatas[escolhida];
  const lim = limiteDoRitual(p.ritual);
  const linhas = linhasDoTexto(lido.body);
  const longa = linhas > lim.linhas + 2 ? [`A mensagem saiu com ${linhas} linhas (o combinado é até ${lim.linhas}). Vale cortar antes de enviar.`] : [];
  return {
    ...lido,
    alertas: [...(lido.sem_novidade ? [SEM_NOVIDADE] : []), ...lido.alertas, ...longa].slice(0, 5),
    model: saida.modelo,
    modelo_rotulo: saida.rotulo,
    raciocinio: saida.raciocinio,
    reserva: saida.reserva,
    custo_usd: saida.custoUsd,
    robo: expressoesDeRobo(lido.body),
    usage: saida.usage ?? null,
    uso_id: saida.usoId ?? null,
    escolha_da_versao: escolhaDaVersao,
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
