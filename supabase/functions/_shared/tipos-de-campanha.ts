/**
 * Tipos de campanha (frente AE, 28/09).
 *
 * Pedido do dono: "não é só promoção; são várias campanhas (lançamento, data
 * comemorativa, institucional, evento, prova social, sazonal...). Cada uma
 * com identidade própria e um selo bonito, sem poluir."
 *
 * O tipo mora em `mesa_campanhas.identidade.tipo` (jsonb que já existe: sem
 * SQL novo). Cada tipo traz o que a campanha precisa dizer, como a identidade
 * do tema nasce e como o selo é desenhado. O estrategista (agente-calendario)
 * recebe o bloco do tipo na criação; o desenho do selo recebe a direção do
 * selo do tipo; o Estúdio e a Mesa Foto leem o rótulo.
 *
 * Quando a equipe não escolhe o tipo, o Jev decide pelo pedido (Choice, com
 * "outro" para o pedido que não cabe em nenhum). Confiança baixa: fica sem
 * tipo e o estrategista segue o pedido como sempre (nada é inventado).
 *
 * Sem import de Deno nem de npm: a tela, as funções e os testes (vitest)
 * leem o mesmo arquivo. Sem lookbehind, propriedade Unicode ou grupo nomeado em regex (Safari 11).
 */

export const TIPOS_DE_CAMPANHA = [
  "promocao",
  "lancamento",
  "data_comemorativa",
  "institucional",
  "evento",
  "prova_social",
  "sazonal",
] as const;

export type TipoDeCampanha = (typeof TIPOS_DE_CAMPANHA)[number];

export interface DefinicaoDoTipo {
  rotulo: string;
  /** Uma linha para a tela (o que é este tipo). */
  dica: string;
  /** Exemplo curto para o campo do pedido. */
  exemplo: string;
  /** O que o briefing precisa trazer neste tipo (para o estrategista). */
  briefing: string;
  /** Como a identidade do tema nasce neste tipo. */
  identidade: string;
  /** Como o selo é desenhado: bonito, legível pequeno e sem poluir. */
  selo: string;
  /** O arco dos conteúdos no período. */
  arco: string;
}

export const DEFINICAO_DO_TIPO: Record<TipoDeCampanha, DefinicaoDoTipo> = {
  promocao: {
    rotulo: "Promoção",
    dica: "Oferta com preço, desconto ou condição e prazo.",
    exemplo: "Semana do mouse gamer: 15% no Pix até sexta, frete grátis acima de R$ 199",
    briefing: "A oferta concreta (preço, desconto, condição e prazo) só como veio no pedido ou no contexto; nunca invente número. O produto em foco e o motivo de comprar agora.",
    identidade: "Energia de oferta sem cara de encarte: uma cor de apoio forte usada só no destaque do preço, muito respiro, o produto grande e nítido.",
    selo: "Etiqueta de oferta limpa (forma de tag, círculo ou faixa curta), com o nome da promoção em até 3 palavras. Nunca o preço dentro do selo, nunca estrela explodindo, brilho ou sombra pesada.",
    arco: "Aquecimento, anúncio da oferta, prova do produto, lembrete com prazo e último chamado.",
  },
  lancamento: {
    rotulo: "Lançamento",
    dica: "Produto, serviço ou novidade chegando.",
    exemplo: "Lançamento da linha nova de cafés especiais, pré-venda até dia 10",
    briefing: "O que é a novidade, o que ela resolve, quando chega e como garantir (pré-venda, lista, data de abertura).",
    identidade: "Clima de estreia: o produto revelado aos poucos, luz de vitrine, tipografia com presença e um detalhe gráfico que vira a assinatura do lançamento.",
    selo: "Assinatura do lançamento, elegante e curta (o nome da novidade ou 'Novo'), em linha fina ou monograma. Uma cor, sem moldura carregada.",
    arco: "Teaser, revelação, detalhes e benefícios, prova ou bastidor, abertura e chamada final.",
  },
  data_comemorativa: {
    rotulo: "Data comemorativa",
    dica: "Dia das Mães, dos Pais, Natal, aniversário da marca...",
    exemplo: "Dia das Crianças: homenagem aos pequenos clientes e kit presente",
    briefing: "A data, o sentimento que ela pede e como a marca participa (homenagem, presente, condição especial). Oferta só se o pedido trouxer.",
    identidade: "O símbolo da data tratado com delicadeza dentro da paleta da marca (um elemento, não vários), fotografia com emoção e pessoas reais quando houver.",
    selo: "Emblema da data com um único elemento simbólico discreto (um traço, uma forma) e o nome da data. Leve, centrado, sem clip-art.",
    arco: "Aquecimento com a emoção da data, homenagem ou história, a proposta da marca e o dia em si.",
  },
  institucional: {
    rotulo: "Institucional",
    dica: "Marca, valores, história, equipe e bastidores.",
    exemplo: "10 anos da clínica: nossa história, equipe e o que nos move",
    briefing: "O que a marca quer que as pessoas lembrem dela: história, propósito, diferenciais reais e provas. Sem oferta.",
    identidade: "Sóbria e confiante: a paleta da marca dominante, fotografia real da equipe e do lugar, composição com muito espaço.",
    selo: "Monograma ou assinatura discreta do tema, em linha fina e uma cor. Quase invisível: marca presença sem disputar com a logo.",
    arco: "Quem somos, como fazemos, quem faz, provas e convite para conhecer.",
  },
  evento: {
    rotulo: "Evento",
    dica: "Palestra, workshop, feira, inauguração, live.",
    exemplo: "Palestra sobre gestão financeira dia 15/10, 19h, no auditório, com Ana Souza",
    briefing: "Nome do evento, data, hora, local ou link, quem fala ou participa e como se inscrever. Nada disso é inventado: sem o dado, diga o que falta.",
    identidade: "Cartaz de evento moderno: data e hora com hierarquia clara, retrato real de quem fala quando houver, um grafismo que vira a marca do evento.",
    selo: "Marca do evento: o nome curto num bloco limpo, com a data pequena abaixo quando couber. Legível no tamanho de um ícone.",
    arco: "Anúncio (salve a data), quem participa, o que se aprende, lembrete da véspera, dia do evento e agradecimento.",
  },
  prova_social: {
    rotulo: "Prova social",
    dica: "Depoimentos, resultados, antes e depois, números.",
    exemplo: "Resultados dos alunos de setembro: depoimentos e antes e depois",
    briefing: "As provas reais (depoimentos, números, casos, avaliações) com a fonte. Nunca invente depoimento, nota ou resultado.",
    identidade: "Credibilidade: fotografia real, citações em destaque com aspas grandes e respiro, números como protagonistas.",
    selo: "Selo de confiança limpo (forma circular ou escudo simples) com 2 ou 3 palavras. Sem estrelas em excesso nem medalha brilhante.",
    arco: "O problema de quem chegou, a história de um cliente, os números, mais vozes e o convite.",
  },
  sazonal: {
    rotulo: "Sazonal",
    dica: "Estação, volta às aulas, férias, fim de ano.",
    exemplo: "Verão: cuidados com a pele e a linha de protetores",
    briefing: "A estação ou o momento, o que muda para o público nele e o produto ou serviço que resolve.",
    identidade: "A luz e a cor da estação traduzidas na paleta de apoio (sem trocar a da marca), cenário da época e fotografia com clima.",
    selo: "Emblema da estação com um elemento simples (sol, folha, floco) desenhado em traço limpo e o nome do tema. Uma ou duas cores.",
    arco: "Chegada da estação, o que muda, a solução, dicas de uso e fechamento da temporada.",
  },
};

/** Tipo válido ou null. */
export function tipoValido(v: unknown): TipoDeCampanha | null {
  const t = typeof v === "string" ? v.trim().toLowerCase() : "";
  return (TIPOS_DE_CAMPANHA as readonly string[]).indexOf(t) >= 0 ? (t as TipoDeCampanha) : null;
}

/** O tipo gravado na identidade da campanha (identidade.tipo) ou null. */
export function tipoDaCampanha(identidade: unknown): TipoDeCampanha | null {
  if (!identidade || typeof identidade !== "object") return null;
  return tipoValido((identidade as Record<string, unknown>).tipo);
}

export function rotuloDoTipo(tipo: unknown): string {
  const t = tipoValido(tipo);
  return t ? DEFINICAO_DO_TIPO[t].rotulo : "";
}

/** Bloco do tipo para o estrategista criar (ou ajustar) a campanha. Vazio sem tipo. */
export function blocoDoTipoParaOEstrategista(tipo: unknown): string {
  const t = tipoValido(tipo);
  if (!t) return "";
  const d = DEFINICAO_DO_TIPO[t];
  return [
    `TIPO DA CAMPANHA: ${d.rotulo} (${d.dica})`,
    `- Briefing: ${d.briefing}`,
    `- Identidade do tema: ${d.identidade} A identidade é própria desta campanha: nada genérico, sempre dentro da marca.`,
    `- Selo: ${d.selo}`,
    `- Arco dos conteúdos: ${d.arco}`,
  ].join("\n");
}

/** Direção do selo pelo tipo (vai no prompt do desenho do selo). */
export function direcaoDoSeloDoTipo(tipo: unknown): string {
  const t = tipoValido(tipo);
  const base = "Selo bonito e sem poluir: legível do tamanho de um ícone, poucas formas, no máximo duas cores, muito respiro em volta, sem textura, sem brilho, sem sombra e sem clip-art.";
  return t ? `${base} Estilo do selo para ${DEFINICAO_DO_TIPO[t].rotulo.toLowerCase()}: ${DEFINICAO_DO_TIPO[t].selo}` : base;
}

// ------------------------------------------------------------------ Jev

/** Pergunta do Jev (mesma forma de _shared/jev.ts, sem importar Deno). */
export interface PerguntaDeEscolha {
  type: "choice";
  instructions: unknown;
  criteria: Record<string, unknown>;
}

/**
 * Pergunta do tipo da campanha pelo pedido da equipe. `state` esperado:
 * { pedido, hype? }. "outro" = nenhum tipo serve (o estrategista segue o pedido).
 */
export function perguntaDoTipoDaCampanha(): PerguntaDeEscolha {
  const criteria: Record<string, unknown> = {};
  TIPOS_DE_CAMPANHA.forEach((t) => {
    const d = DEFINICAO_DO_TIPO[t];
    criteria[t] = { what: `${d.rotulo}: ${d.dica}`, examples: [d.exemplo] };
  });
  criteria.outro = { what: "O pedido não é claramente de nenhum dos tipos acima (ou mistura vários sem um principal)." };
  return {
    type: "choice",
    instructions: "A equipe de uma agência descreveu em `pedido` uma campanha de redes sociais para um cliente. Qual é o tipo principal desta campanha, pelo que ela quer alcançar?",
    criteria,
  };
}

/**
 * Confiança mínima para aceitar o tipo que o Jev escolheu (abaixo disso fica
 * sem tipo e o estrategista segue o pedido). Frente AG, 28/09: "Automático"
 * só vale com confiança alta (era 0,45; os docs do Jev põem 0,5 a 0,9 como
 * faixa de confirmar).
 */
export const CONFIANCA_MINIMA_DO_TIPO = 0.7;

/** Lê a resposta do Jev: o tipo aceito ou null ("outro" ou pouca confiança). */
export function tipoPelaResposta(r: { choice?: string; confidence?: number } | null | undefined): TipoDeCampanha | null {
  if (!r) return null;
  const t = tipoValido(r.choice);
  if (!t) return null;
  const c = typeof r.confidence === "number" && isFinite(r.confidence) ? r.confidence : 0;
  return c >= CONFIANCA_MINIMA_DO_TIPO ? t : null;
}
