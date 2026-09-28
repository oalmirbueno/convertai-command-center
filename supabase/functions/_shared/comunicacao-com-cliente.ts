/**
 * Como uma agência conversa com o cliente (frente CE, 28/09/2026).
 *
 * O dono: as mensagens da Central estão "genéricas, ruins e repetitivas; toda
 * semana parece a mesma mensagem e o cliente não presta atenção"; a mensal é
 * "rasa e básica". Aqui fica o conhecimento que o escritor dos rituais, a
 * esteira da semana e o agente da Central seguem, resumido com nossas
 * palavras a partir de fontes públicas (citadas regra a regra). Não é texto
 * copiado: são regras de ofício, testáveis, que viram parte do prompt.
 *
 * Puro: sem Deno, sem banco. O Vitest lê as mesmas regras que o servidor.
 *
 * Fontes consultadas em 28/09/2026 (resumo nosso de cada uma na regra):
 * - Anthropic, skill "stakeholder-update" (knowledge-work-plugins):
 *   https://github.com/anthropics/knowledge-work-plugins/blob/main/product-management/skills/stakeholder-update/SKILL.md
 * - Anthropic, skill "internal-comms" (formato 3P: progresso, planos, problemas):
 *   https://github.com/anthropics/skills/tree/main/skills/internal-comms
 * - rampstackco, skill "stakeholder-communication":
 *   https://github.com/rampstackco/claude-skills/blob/main/skills/stakeholder-communication/SKILL.md
 * - AgencyAnalytics, guias de relatório e confiança:
 *   https://agencyanalytics.com/blog/client-reporting-tips
 *   https://agencyanalytics.com/client-reporting-guide/what-to-include-in-client-reports
 *   https://agencyanalytics.com/blog/building-client-trust
 * - Databox, relatório de agência: https://databox.com/agency-report
 * - Jepto, relatório e churn: https://www.jepto.com/blog/client-churn-reporting-disconnect
 * - Superthread, status semanal: https://superthread.com/learn/weekly-client-status-reporting/
 * - Productive, comunicação com cliente: https://productive.io/blog/client-communication/
 * - Teamwork, gestão de expectativa: https://www.teamwork.com/blog/managing-client-expectations/
 * - PMI, dar má notícia: https://www.pmi.org/learning/library/delivering-bad-news-9424
 * - Account Management Skills (pesquisa AAAA/ANA sobre troca de agência):
 *   https://www.accountmanagementskills.com/blog/why-do-clients-ditch-agencies
 * - HBR, "The Power of Small Wins" (Amabile e Kramer): https://hbr.org/2011/05/the-power-of-small-wins
 * - ClientSuccess, marcos pós-implantação:
 *   https://www.clientsuccess.com/resources/4-important-post-implementation-customer-success-milestones
 * - "What / So what / Now what" em narrativa de dados:
 *   https://investigationsquality.com/2025/01/18/harnessing-the-power-of-what-so-what-now-what-in-data-storytelling/
 * - Fechar o laço (closing the loop):
 *   https://www.cmswire.com/customer-experience/closing-the-customer-feedback-loop-a-practitioners-guide/
 * - Retenção no sexto mês: https://agencydashboard.io/blog/agency-client-retention-month-six
 */

export type TipoDeRitual = "rota_semana" | "meio_semana" | "prova_movimento" | "radar_aceleriq" | "marco_90";

export interface RegraDeComunicacao {
  id: string;
  /** A regra como o escritor precisa ler, em uma ou duas frases. */
  regra: string;
  /** Onde ela vale. Vazio = em todas as mensagens. */
  so?: TipoDeRitual[];
  fonte: string;
}

export const REGRAS_DE_COMUNICACAO: readonly RegraDeComunicacao[] = [
  // Check-in semanal
  {
    id: "retomar-o-combinado",
    regra: "Abra retomando o que ficou combinado na última mensagem e diga em que pé está cada item, com o fato que prova. Cumprir e mostrar que cumpriu é o que constrói confiança.",
    fonte: "https://agencyanalytics.com/blog/building-client-trust",
  },
  {
    id: "resultado-nao-atividade",
    regra: "Prova de trabalho é resultado com nome e número, não atividade ('3 posts no ar, o reel de terça foi visto por 1.240 pessoas', nunca 'trabalhamos no Instagram'). Só entra o que mudou desde a última mensagem.",
    fonte: "https://superthread.com/learn/weekly-client-status-reporting/",
  },
  {
    id: "um-pedido-com-prazo",
    regra: "No máximo UM pedido ao cliente por mensagem, dizendo o que é, até quando e o que ele destrava. Nunca 'precisamos do seu apoio'.",
    fonte: "https://github.com/anthropics/knowledge-work-plugins/blob/main/product-management/skills/stakeholder-update/SKILL.md",
  },
  {
    id: "proximo-passo-da-agencia",
    regra: "O próximo passo é da agência e tem dia: o que a gente entrega até a próxima mensagem. É esse compromisso que a próxima mensagem vai retomar.",
    fonte: "https://github.com/anthropics/skills/tree/main/skills/internal-comms",
  },
  {
    id: "linguagem-firme",
    regra: "Linguagem firme: diga o quê, quanto e por quê. Sem 'talvez', 'se tudo der certo', 'esperamos que'.",
    fonte: "https://productive.io/blog/client-communication/",
  },
  // Números e mensal
  {
    id: "numero-com-periodo",
    regra: "Todo número vem com o período exato (datas) e a comparação com o período anterior. Número solto é ignorado.",
    fonte: "https://www.jepto.com/blog/client-churn-reporting-disconnect",
  },
  {
    id: "o-que-por-que-agora",
    regra: "Para cada número importante: o que aconteceu, o que isso significa no negócio dele e o que a gente vai fazer por causa disso (o que, e daí, e agora).",
    fonte: "https://investigationsquality.com/2025/01/18/harnessing-the-power-of-what-so-what-now-what-in-data-storytelling/",
  },
  {
    id: "lingua-do-dono",
    regra: "Traduza métrica para o que o dono entende (pessoas, contatos, pedidos, reais). Teste: com essa mensagem ele consegue explicar para um sócio, em um minuto, por que paga a agência?",
    fonte: "https://agencyanalytics.com/blog/client-reporting-tips",
  },
  {
    id: "mes-ruim-com-plano",
    regra: "Mês ou semana ruim entra na mensagem, com a causa provável e o que muda. Esconder queda destrói a credibilidade do resto.",
    so: ["radar_aceleriq", "marco_90", "prova_movimento"],
    fonte: "https://agencyanalytics.com/blog/client-reporting-tips",
  },
  {
    id: "previsao-e-recomendacao",
    regra: "Feche o balanço com 2 ou 3 recomendações ligadas à meta dele e uma previsão simples do próximo período ('no ritmo atual, chegamos a X até dd/mm').",
    so: ["radar_aceleriq", "marco_90"],
    fonte: "https://databox.com/agency-report",
  },
  {
    id: "recomendacao-anterior-volta",
    regra: "O que a gente recomendou no balanço anterior volta com o resultado: deu certo, não deu, ou ainda está rodando.",
    so: ["radar_aceleriq", "marco_90"],
    fonte: "https://agencyanalytics.com/blog/client-reporting-tips",
  },
  // Continuidade e expectativa
  {
    id: "historia-continua",
    regra: "Mesma forma, conteúdo novo: cada mensagem é um capítulo que começa onde a anterior parou. O que já foi contado só volta para dizer o que mudou.",
    fonte: "https://github.com/rampstackco/claude-skills/blob/main/skills/stakeholder-communication/SKILL.md",
  },
  {
    id: "pedido-do-cliente-tem-resposta",
    regra: "Todo pedido do cliente recebe resposta: o que foi feito com ele, ou em que pé está. Silêncio corrói mais do que um 'ainda não'.",
    fonte: "https://www.cmswire.com/customer-experience/closing-the-customer-feedback-loop-a-practitioners-guide/",
  },
  {
    id: "atraso-antes-dele-perceber",
    regra: "O que não ficou pronto no prazo combinado: o cliente sabe pela gente, como 'em andamento', com o que já foi feito e a nova previsão só se ela existir nos fatos. Sem culpar ninguém e sem repetir a promessa como se fosse nova.",
    fonte: "https://www.pmi.org/learning/library/delivering-bad-news-9424",
  },
  {
    id: "prometer-menos",
    regra: "Não prometa prazo que depende de algo incerto; é melhor entregar antes do que pedir mais tempo.",
    fonte: "https://www.teamwork.com/blog/managing-client-expectations/",
  },
  {
    id: "meta-batida",
    regra: "Meta batida: reconheça com o número, divida o mérito ('a gente chegou lá junto') e anuncie a próxima meta cadastrada. Pequenas vitórias visíveis sustentam a confiança.",
    fonte: "https://hbr.org/2011/05/the-power-of-small-wins",
  },
  // Retenção
  {
    id: "ideia-que-ele-nao-pediu",
    regra: "Leve uma ideia que ele não pediu, tirada dos dados da conta (um teste, uma oportunidade, uma data). Cliente que troca de agência costuma dizer que ela nunca trouxe nada além do pedido.",
    so: ["rota_semana", "radar_aceleriq", "marco_90"],
    fonte: "https://www.accountmanagementskills.com/blog/why-do-clients-ditch-agencies",
  },
  {
    id: "ligar-ao-objetivo",
    regra: "Ligue cada entrega ao objetivo de negócio dele (vendas, contatos, agenda cheia). A agência vende transformação, não tarefa.",
    fonte: "https://agencyanalytics.com/client-reporting-guide/what-to-include-in-client-reports",
  },
  {
    id: "marco-de-90-dias",
    regra: "No marco de 90 dias: compare o começo com hoje (números e o que existe agora que não existia), diga o que aprendemos e proponha a próxima fase.",
    so: ["marco_90"],
    fonte: "https://www.clientsuccess.com/resources/4-important-post-implementation-customer-success-milestones",
  },
];

/**
 * O que cada ritual precisa entregar. A semana tem três momentos com trabalhos
 * diferentes; o mensal é balanço de verdade (números do mês contra o anterior,
 * orgânico e pago separados, metas, previsão) e não um recado.
 */
export const BRIEF_POR_RITUAL: Record<TipoDeRitual, string> = {
  rota_semana:
    "ROTA DA SEMANA (segunda). Parte do que a sexta fechou e do que ficou combinado (retome cada item com o estado real), e apresenta o PLANO desta semana com a lógica: o que a gente faz, em que ordem e que resultado persegue. Conteúdo e anúncios em frentes separadas. Leve uma ideia que ele não pediu, tirada dos dados. Fecha com o que depende dele (no máximo um pedido, com prazo).",
  meio_semana:
    "CHECAGEM DE MEIO DE SEMANA (quarta). Curta e concreta: do plano de segunda, o que já saiu do papel (com dia) e o que entra até sexta. Número novo só se houver. Se algo depende dele, é a peça que falta para fechar a semana, com prazo e ganho.",
  prova_movimento:
    "PROVA DE MOVIMENTO (sexta). Fecha a semana com a prova: o que a segunda prometeu e virou realidade, com nome e data; o que ficou em andamento, dito com naturalidade; os números da semana contra a anterior, com o que fazemos por causa deles. Termina com o que a próxima semana constrói em cima disso.",
  radar_aceleriq:
    "BALANÇO DO MÊS COM RADAR (mensal). Não é recado: é o relatório do mês em linguagem de dono. Números do mês contra o mês anterior, com datas, separando conteúdo orgânico (seguidores, alcance, interações, posts no ar) e anúncios (investimento, contatos, custo por contato, vendas); metas (batida ou quanto falta); o que foi entregue e o que isso construiu; o que aprendemos; 2 ou 3 recomendações e a previsão do próximo mês; e o radar: uma oportunidade que a gente enxerga chegando, antes de ele pedir.",
  marco_90:
    "MARCO DE 90 DIAS. Balanço do trimestre: como o negócio estava no começo e como está hoje (números com datas, orgânico e pago separados), o que existe agora que não existia, o que os números ensinaram, os ajustes que o aprendizado trouxe, e a proposta para a próxima fase com metas.",
};

/** As regras que valem para o ritual pedido, numeradas, com a fonte curta. */
export function regrasDoRitual(ritual: string): RegraDeComunicacao[] {
  return REGRAS_DE_COMUNICACAO.filter((r) => !r.so || r.so.includes(ritual as TipoDeRitual));
}

export function blocoDeComunicacao(ritual: string): string {
  const regras = regrasDoRitual(ritual);
  return [
    "OFÍCIO DE AGÊNCIA (regras de comunicação com cliente que valem nesta mensagem; siga todas):",
    ...regras.map((r, i) => `${i + 1}. ${r.regra}`),
  ].join("\n");
}

/**
 * Tom de gente, não de robô. O dono pediu "mensagem para o grupo em tom
 * natural, como gente". Estas expressões denunciam texto de máquina ou de
 * molde e são proibidas no prompt; a conferência abaixo avisa se escaparem.
 */
export const EXPRESSOES_DE_ROBO: readonly string[] = [
  "espero que esteja bem",
  "espero que você esteja bem",
  "seguimos firmes",
  "seguimos trabalhando",
  "com base nos dados",
  "vale ressaltar",
  "é importante destacar",
  "gostaríamos de informar",
  "ficamos à disposição",
  "estamos à disposição",
  "qualquer dúvida estamos",
  "sinergia",
  "alavancar",
  "robusta",
  "robusto",
  "otimização",
  "jornada",
  "potencializar",
  "estratégia assertiva",
  "grande semana",
  "estamos animados",
];

export const TOM_DE_GENTE = [
  "TOM DE GENTE (a mensagem vai para o grupo de WhatsApp do cliente):",
  "- Escreva como o gestor de contas que conhece o cliente pelo nome e fala com ele toda semana: frases curtas e médias alternadas, verbo na frente, 'a gente', 'você'.",
  "- Nada de abertura de molde ('Espero que esteja bem'), de encerramento de e-mail ('Ficamos à disposição') nem de palavra de apresentação corporativa (sinergia, alavancar, robusto, otimização, jornada, potencializar).",
  "- Cada mensagem soa diferente da anterior porque conta coisas diferentes, não porque troca sinônimos.",
  "- Sem travessão (use vírgula, ponto ou dois-pontos), sem emoji, sem cabeçalho com #.",
].join("\n");

const MARCAS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g");
const semAcento = (s: string) => s.normalize("NFD").replace(MARCAS, "").toLowerCase();

/** Expressões de robô que escaparam no texto (para o aviso da tela). */
export function expressoesDeRobo(texto: string): string[] {
  const t = semAcento(String(texto ?? ""));
  return EXPRESSOES_DE_ROBO.filter((e) => t.includes(semAcento(e)));
}

/**
 * Travessão fora, sempre: o dono não quer em texto de tela nem em mensagem.
 * Troca o travessão (e o meia-risca) entre palavras por vírgula, e o de
 * intervalo entre números (14 e 18/09 ligados por meia-risca) por "a".
 */
export function semTravessao(texto: string): string {
  const EM = String.fromCharCode(0x2014);
  const EN = String.fromCharCode(0x2013);
  return String(texto ?? "")
    .replace(new RegExp(`(\\d)\\s*[${EM}${EN}]\\s*(\\d)`, "g"), "$1 a $2")
    .replace(new RegExp(`\\s*[${EM}${EN}]\\s*`, "g"), ", ")
    .replace(/,\s*,/g, ",")
    .replace(/ ,/g, ",");
}
