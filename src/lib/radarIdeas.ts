/**
 * O motor de ideias do Radar Aceleriq.
 *
 * O Radar antigo só via três coisas: pedir depoimento, subir o plano e reativar
 * avulso. Isso é cobrança, não é ideia. E "migrar de plano" é justamente o que
 * o cliente não quer ouvir.
 *
 * O Radar agora é um ritual de ANTECIPAÇÃO: uma vez por mês a agência chega com
 * uma ideia de diferenciação que o cliente até já pensou em fazer, mas nunca
 * executou - e a gente chega com ela pronta para rodar.
 *
 * A leitura é a do marketing de diferenciação (Fator X, de Pedro Superti): o
 * que torna a marca desejada já existe dentro do negócio, e o trabalho é achar
 * esse elemento e transformá-lo em movimento, vendendo visão de mundo e não
 * produto. Por isso as ideias nascem do que o cliente JÁ tem e já faz.
 *
 * Duas leituras separadas de propósito:
 * - `client`: o que o cliente lê. Ideia, por que agora, o que fazemos, o que
 *   vamos olhar. Nunca fala em venda.
 * - `internal`: só a equipe vê. Qual avulso aquela ideia vira e a faixa de
 *   valor. Isso jamais entra na mensagem do cliente.
 *
 * Nada aqui inventa número: o "por que agora" é montado com os dados reais do
 * painel (entregas, publicações, Pulso, tempo de casa, frentes contratadas).
 */

export type RadarLens =
  | "essencia"
  | "antecipacao"
  | "tendencia"
  | "encantamento"
  | "prova";

export interface RadarLensMeta {
  id: RadarLens;
  label: string;
  /** O que essa lente procura, em uma linha, para a equipe. */
  hint: string;
}

export const RADAR_LENSES: Record<RadarLens, RadarLensMeta> = {
  essencia: {
    id: "essencia",
    label: "Essência",
    hint: "O diferencial que já existe dentro do negócio e ninguém mostra.",
  },
  antecipacao: {
    id: "antecipacao",
    label: "Antecipação",
    hint: "A ideia que o dono já teve e nunca executou. Chegamos com ela pronta.",
  },
  tendencia: {
    id: "tendencia",
    label: "Tendência",
    hint: "O formato que está funcionando agora, aplicado ao caso dele.",
  },
  encantamento: {
    id: "encantamento",
    label: "Encantamento",
    hint: "Experiência que faz o cliente dele falar da marca sozinho.",
  },
  prova: {
    id: "prova",
    label: "Prova",
    hint: "Transformar resultado real em prova pública.",
  },
};

export interface RadarClientContext {
  clientId: string;
  clientName: string;
  /** project_type das frentes ativas: social_media, traffic, site... */
  services: string[];
  /** Nota do Pulso (1 a 5) e há quantos dias foi dada. */
  pulseScore?: number | null;
  pulseAgeDays?: number | null;
  /** Materiais liberados e publicações no ar nos últimos 30 dias. */
  releasedLast30: number;
  publishedLast30: number;
  /** Total de publicações já no ar, de todo o histórico. */
  publishedTotal: number;
  hasPublishedReport: boolean;
  monthsTogether: number;
  isOneOff: boolean;
  /** Dias desde a última entrega (para avulso parado). */
  idleDays?: number | null;
  /** Mês de referência, 0 a 11. Usado para a leitura de sazonalidade. */
  month: number;
}

export interface RadarIdea {
  id: string;
  lens: RadarLens;
  /** Nome da jogada, do jeito que o cliente lê. */
  title: string;
  /** Uma frase que explica a ideia. */
  pitch: string;
  /** Por que este é o momento, com os números reais do cliente. */
  whyNow: string;
  /** O que a Aceleriq faz, em passos concretos. */
  moves: string[];
  /** O sinal real que vamos acompanhar depois. */
  signal: string;
  /** SOMENTE EQUIPE. Nunca vai para o cliente. */
  internal: {
    /** Serviço avulso que essa ideia vira, se aprovada. */
    offer: string;
    /** Faixa de valor sugerida, em reais. */
    range: [number, number];
    effort: "baixo" | "medio" | "alto";
  };
  /** Prioridade calculada. Maior aparece primeiro. */
  score: number;
}

interface RadarPlay {
  id: string;
  lens: RadarLens;
  title: (ctx: RadarClientContext) => string;
  pitch: string;
  whyNow: (ctx: RadarClientContext) => string;
  moves: string[];
  signal: string;
  internal: RadarIdea["internal"];
  /** Retorna a prioridade, ou null quando a ideia não cabe neste cliente. */
  when: (ctx: RadarClientContext) => number | null;
}

const has = (ctx: RadarClientContext, service: string) => ctx.services.includes(service);

/** Meses de virada de ciclo comercial, onde planejar antes vale mais. */
function seasonNote(month: number): string | null {
  if (month === 10 || month === 11) return "a reta final do ano, quando a decisão de compra acelera";
  if (month === 0) return "a virada de ano, quando o cliente redefine o que vai contratar";
  if (month === 4) return "a janela do meio do ano, boa para testar antes do segundo semestre";
  return null;
}

/**
 * O playbook. Cada jogada é uma forma de diferenciação, não uma oferta.
 * A venda é consequência: aparece só na leitura interna.
 */
const PLAYS: RadarPlay[] = [
  {
    id: "bastidor-processo",
    lens: "essencia",
    title: (ctx) => `${ctx.clientName}: mostrar o que ninguém do setor mostra`,
    pitch:
      "Abrir o processo de trabalho de vocês como conteúdo. O que é rotina interna para vocês é exatamente o que o cliente nunca viu.",
    whyNow: (ctx) =>
      ctx.publishedTotal > 0
        ? `Já são ${ctx.publishedTotal} publicações no ar e o perfil tem consistência. O que falta agora não é volume, é diferença: o concorrente publica a mesma coisa, e o processo de vocês nenhum deles tem.`
        : `Antes de disputar atenção pelo mesmo caminho de todo mundo, vale começar pelo que só vocês têm: o modo como o trabalho é feito por dentro.`,
    moves: [
      "Uma diária de captação no local, registrando o processo real de ponta a ponta",
      "Edição em série de 4 peças verticais, uma para cada etapa do processo",
      "Roteiro construído para responder a dúvida que o cliente tem antes de comprar",
    ],
    signal: "Salvamentos e comentários perguntando como funciona, que é o sinal de intenção de compra.",
    internal: { offer: "Captação em campo + série de 4 vídeos", range: [1200, 2400], effort: "medio" },
    when: (ctx) => {
      if (!has(ctx, "social_media")) return null;
      return 70 + Math.min(ctx.publishedTotal, 30);
    },
  },
  {
    id: "duvida-que-trava",
    lens: "antecipacao",
    title: (ctx) => `${ctx.clientName}: responder a pergunta que trava a venda`,
    pitch:
      "Existe uma dúvida que aparece em toda negociação e some quando alguém responde bem. Publicar essa resposta encurta o caminho até o sim.",
    whyNow: (ctx) =>
      ctx.publishedLast30 > 0
        ? `Nos últimos 30 dias foram ${ctx.publishedLast30} publicações no ar. O conteúdo já alcança gente. O passo que falta é usar esse alcance para derrubar a objeção que mais aparece na hora de fechar.`
        : `O perfil está em construção, e este é o melhor momento para nascer já respondendo o que trava a decisão do cliente de vocês.`,
    moves: [
      "Conversa de 20 minutos com quem atende para listar as objeções reais",
      "Carrossel de lista salvável respondendo a principal delas, sem enrolação",
      "Versão em vídeo curto com a fala de vocês, que é o que gera confiança",
    ],
    signal: "Mensagens no direct e no WhatsApp citando o conteúdo, e a objeção aparecendo menos na conversa de venda.",
    internal: { offer: "Pacote de conteúdo de objeção (carrossel + vídeo)", range: [600, 1200], effort: "baixo" },
    when: () => 66,
  },
  {
    id: "prova-numero-real",
    lens: "prova",
    title: (ctx) => `${ctx.clientName}: transformar o resultado em prova pública`,
    pitch:
      "O que já foi construído aqui dentro vira argumento de venda lá fora. Resultado que ninguém vê não convence ninguém.",
    whyNow: (ctx) =>
      `Vocês têm ${ctx.monthsTogether} ${ctx.monthsTogether === 1 ? "mês" : "meses"} de trabalho registrado no painel, com relatório publicado. Isso já é um caso real, e caso real vende mais que promessa.`,
    moves: [
      "Montagem do caso com o antes e o agora, usando só número que existe no painel",
      "Peça de prova para o perfil e uma versão para a página ou proposta comercial",
      "Roteiro de depoimento curto para quem viveu a mudança",
    ],
    signal: "Uso do caso na conversa comercial e o tempo até o cliente pedir orçamento.",
    internal: { offer: "Case de resultado (peça + versão comercial)", range: [700, 1500], effort: "baixo" },
    when: (ctx) => {
      if (!ctx.hasPublishedReport || ctx.monthsTogether < 2) return null;
      return 74 + Math.min(ctx.monthsTogether * 2, 16);
    },
  },
  {
    id: "voz-do-dono",
    lens: "tendencia",
    title: (ctx) => `${ctx.clientName}: a marca com rosto e voz`,
    pitch:
      "Marca sem rosto compete por preço. Colocar quem toca o negócio para falar é o formato que mais gera confiança hoje.",
    whyNow: (ctx) => {
      const season = seasonNote(ctx.month);
      return season
        ? `O formato de fala direta está entregando o melhor alcance orgânico do momento, e estamos entrando em ${season}.`
        : `O material de vocês já circula, mas ainda sem rosto. É a fala direta de quem toca o negócio que separa a marca lembrada da marca ignorada.`;
    },
    moves: [
      "Bloco único de gravação: 6 falas curtas resolvidas em uma tarde",
      "Corte vertical com legenda embutida, no ritmo que retém atenção",
      "Calendário para distribuir as peças ao longo de duas semanas",
    ],
    signal: "Retenção do vídeo e crescimento de seguidores que vêm do conteúdo, não de anúncio.",
    internal: { offer: "Dia de gravação + 6 cortes verticais", range: [1500, 2800], effort: "medio" },
    when: (ctx) => (has(ctx, "social_media") ? 68 : null),
  },
  {
    id: "pos-venda-encanta",
    lens: "encantamento",
    title: (ctx) => `${ctx.clientName}: o cliente de vocês virando divulgador`,
    pitch:
      "Quase ninguém cuida do depois da venda. Uma experiência simples no pós faz o cliente falar da marca sem ser pedido.",
    whyNow: () =>
      `Conquistar um cliente novo custa caro. Fazer o cliente atual voltar e indicar custa quase nada, e é a parte que quase nenhum concorrente faz.`,
    moves: [
      "Sequência de mensagens de pós-venda com a cara da marca, não um texto genérico",
      "Peça de agradecimento pronta para enviar no fechamento",
      "Convite simples para avaliação e indicação, no momento certo da jornada",
    ],
    signal: "Avaliações novas, clientes que voltam e indicações espontâneas chegando.",
    internal: { offer: "Régua de pós-venda (mensagens + peças)", range: [800, 1800], effort: "medio" },
    when: (ctx) => 60 + (ctx.pulseScore && ctx.pulseScore >= 4 ? 10 : 0),
  },
  {
    id: "atendimento-sem-fila",
    lens: "encantamento",
    title: (ctx) => `${ctx.clientName}: ninguém mais esperando resposta`,
    pitch:
      "O contato chega e demora a ser respondido. Resposta imediata, com a linguagem da marca, é diferencial percebido na hora.",
    whyNow: (ctx) =>
      ctx.publishedLast30 > 0 || has(ctx, "traffic")
        ? `Com o movimento que estamos gerando, o volume de contato aumenta. Sem organizar a resposta, o investimento em atenção escorre pelo ralo do "vou ver e te retorno".`
        : `Organizar a resposta antes de aumentar o volume evita perder contato justamente quando o movimento cresce.`,
    moves: [
      "Mapa das perguntas que mais chegam e a resposta oficial de cada uma",
      "Atendimento automático de primeira resposta, com a voz da marca",
      "Encaminhamento para a pessoa certa sem o cliente repetir a história",
    ],
    signal: "Tempo até a primeira resposta e quantidade de contato que não fica sem retorno.",
    internal: { offer: "Automação de primeiro atendimento", range: [1200, 3000], effort: "alto" },
    when: (ctx) => (has(ctx, "automation") ? null : 62 + (has(ctx, "traffic") ? 12 : 0)),
  },
  {
    id: "alcance-pago-no-validado",
    lens: "tendencia",
    title: (ctx) => `${ctx.clientName}: colocar dinheiro no que já provou que funciona`,
    pitch:
      "Em vez de criar campanha do zero, levar verba para o conteúdo que o público já aprovou sozinho.",
    whyNow: (ctx) =>
      `Foram ${ctx.publishedLast30} publicações no ar nos últimos 30 dias e já dá para saber qual delas o público segurou. Impulsionar o que venceu no orgânico é o caminho de menor risco para ampliar alcance.`,
    moves: [
      "Leitura do que teve melhor desempenho no período",
      "Impulsionamento com verba controlada e público definido",
      "Leitura do custo por contato para decidir se vale ampliar",
    ],
    signal: "Custo por contato e volume de orçamentos chegando pelo conteúdo impulsionado.",
    internal: { offer: "Gestão de impulsionamento (teste inicial)", range: [600, 1200], effort: "baixo" },
    when: (ctx) => {
      if (!has(ctx, "social_media") || has(ctx, "traffic")) return null;
      if (ctx.publishedLast30 < 3) return null;
      return 72;
    },
  },
  {
    id: "vitrine-que-vende",
    lens: "antecipacao",
    title: (ctx) => `${ctx.clientName}: a vitrine que responde antes de perguntarem`,
    pitch:
      "Uma página curta e direta, com o que vocês fazem, quanto custa e como começar. É a ideia que quase todo negócio já teve e deixou para depois.",
    whyNow: (ctx) =>
      ctx.publishedLast30 > 0
        ? `O conteúdo está gerando atenção, mas quem se interessa hoje cai numa conversa que precisa começar do zero toda vez. Uma vitrine bem feita adianta metade da venda.`
        : `Antes de aumentar o volume de contato, vale ter para onde mandar quem se interessa.`,
    moves: [
      "Página curta com oferta clara, prova e um único caminho de contato",
      "Textos escritos para responder a dúvida antes que ela seja feita",
      "Link pronto para o perfil, o WhatsApp e a assinatura de e-mail",
    ],
    signal: "Contatos que chegam já sabendo o que querem, e menos tempo gasto explicando o básico.",
    internal: { offer: "Landing page de conversão", range: [1500, 3500], effort: "alto" },
    when: (ctx) => (has(ctx, "site") || has(ctx, "landing_page") ? null : 64),
  },
  {
    id: "retomada-avulso",
    lens: "antecipacao",
    title: (ctx) => `${ctx.clientName}: retomar de onde parou, sem recomeçar`,
    pitch:
      "O material que produzimos continua valendo. Um ciclo curto reativa o que já existe em vez de começar tudo de novo.",
    whyNow: (ctx) =>
      `O último trabalho foi entregue há ${ctx.idleDays} dias. Marca parada perde presença rápido, e o custo de retomar agora é muito menor do que reconstruir do zero mais para frente.`,
    moves: [
      "Leitura do que foi entregue e do que ainda rende resultado hoje",
      "Ciclo curto de reativação, com um foco só e prazo fechado",
      "Definição do sinal que vamos acompanhar para decidir o próximo passo",
    ],
    signal: "Retomada de movimento no perfil e volume de contato voltando a subir.",
    internal: { offer: "Ciclo de reativação (mês avulso)", range: [900, 2000], effort: "medio" },
    when: (ctx) => {
      if (!ctx.isOneOff) return null;
      if (!ctx.idleDays || ctx.idleDays < 21) return null;
      // Quanto mais tempo parado, mais urgente fica a retomada.
      return 80 + Math.min(Math.round(ctx.idleDays / 3), 20);
    },
  },
  {
    id: "indicacao-momento-alto",
    lens: "prova",
    title: (ctx) => `${ctx.clientName}: aproveitar o momento bom para crescer a rede`,
    pitch:
      "A percepção de valor está no ponto mais alto. É a hora certa de pedir a palavra de quem viveu o trabalho.",
    whyNow: (ctx) =>
      `A experiência foi avaliada com nota ${ctx.pulseScore} de 5 há ${ctx.pulseAgeDays} dias. Depoimento colhido no momento alto sai verdadeiro, e é o ativo comercial mais barato que existe.`,
    moves: [
      "Roteiro de depoimento em vídeo, curto e sem formalidade",
      "Autorização para virar caso público, com os números do painel",
      "Convite para indicar uma empresa que enfrenta o mesmo problema",
    ],
    signal: "Depoimento publicado e indicações chegando pela rede do próprio cliente.",
    internal: { offer: "Sem custo. Abre porta para case e indicação", range: [0, 0], effort: "baixo" },
    when: (ctx) => {
      if (!ctx.pulseScore || ctx.pulseScore < 4) return null;
      if (ctx.pulseAgeDays !== null && ctx.pulseAgeDays !== undefined && ctx.pulseAgeDays > 60) return null;
      return 82;
    },
  },
];

/**
 * Monta as ideias do mês para um cliente, da mais forte para a mais fraca.
 * `limit` controla quantas aparecem: o Radar é um ritual de UMA ideia por mês,
 * então a equipe escolhe entre poucas, e não entre uma lista infinita.
 */
export function buildRadarIdeas(ctx: RadarClientContext, limit = 3): RadarIdea[] {
  const ideas: RadarIdea[] = [];
  for (const play of PLAYS) {
    const score = play.when(ctx);
    if (score === null) continue;
    ideas.push({
      id: `${ctx.clientId}:${play.id}`,
      lens: play.lens,
      title: play.title(ctx),
      pitch: play.pitch,
      whyNow: play.whyNow(ctx),
      moves: play.moves,
      signal: play.signal,
      internal: play.internal,
      score,
    });
  }
  return ideas.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * O texto que vai para o cliente. Recebe a ideia escolhida e devolve os blocos
 * do Radar. A leitura interna (avulso e faixa de valor) fica de fora por
 * construção: esta função nem tem acesso a ela no que retorna.
 */
export function radarIdeaForClient(idea: RadarIdea): {
  opportunity: string;
  whyNow: string;
  recommendation: string;
  signal: string;
} {
  return {
    opportunity: idea.pitch,
    whyNow: idea.whyNow,
    recommendation: idea.moves.map((move, index) => `${index + 1}. ${move}`).join("\n"),
    signal: idea.signal,
  };
}
