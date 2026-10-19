/**
 * Moldes de story viral e o conhecimento do roteirista dos Stories (20/10/2026).
 *
 * Fonte: o mapa mental "Uma novela imperdível nos Stories" (MindMeister
 * 2712335209) e o "Checklist do Instagram Viral" (Oney Araújo), reescritos com
 * palavras próprias para o painel. Contrato: docs/mesa/STORIES.md.
 *
 * Módulo puro (sem Deno, sem banco): a função mesa-stories, os testes Deno e o
 * vitest leem o mesmo arquivo. Sem travessão.
 */

export type TipoDoAdesivo = "nenhum" | "enquete" | "caixinha" | "quiz" | "link" | "contagem" | "localizacao" | "reacao" | "mencao";

export const TIPOS_DE_ADESIVO: readonly TipoDoAdesivo[] = ["nenhum", "enquete", "caixinha", "quiz", "link", "contagem", "localizacao", "reacao", "mencao"];

export type Molde = {
  chave: string;
  nome: string;
  o_que_e: string;
  quando_usar: string;
  /** Roteiro de exemplo, um item por tela (texto curto na tela). */
  exemplo: string[];
  adesivo: TipoDoAdesivo;
};

export const MOLDES_DE_STORIES: readonly Molde[] = [
  {
    chave: "me_ajude",
    nome: "Me ajudem nessa",
    o_que_e: "Pede a ajuda do público numa decisão real da marca (qual capa, qual sabor, qual horário). Quem vota se sente dono da escolha e volta para ver o resultado.",
    quando_usar: "Quando há uma decisão de verdade a tomar nos próximos dias; nunca uma pergunta de fachada.",
    exemplo: ["Preciso de vocês numa decisão", "Vamos lançar um sabor novo e estamos entre dois", "Qual vocês querem primeiro? (enquete: Morango | Pistache)", "Amanhã eu conto qual ganhou"],
    adesivo: "enquete",
  },
  {
    chave: "convite_link",
    nome: "Convite para o link",
    o_que_e: "Contexto curto do que está do outro lado e o convite para tocar no link (produto, agenda, mentoria, cardápio).",
    quando_usar: "Quando existe uma página que resolve o desejo que os stories anteriores criaram.",
    exemplo: ["Muita gente perguntou onde comprar", "Separei o link com o kit completo", "Toca aqui embaixo (link: Ver o kit)"],
    adesivo: "link",
  },
  {
    chave: "caixinha",
    nome: "Caixinha de perguntas",
    o_que_e: "Abre a caixinha sobre um tema do nicho; as respostas viram os stories dos dias seguintes.",
    quando_usar: "Para descobrir dúvidas reais do público e gerar conteúdo para a semana.",
    exemplo: ["Hoje eu respondo tudo sobre isso", "Manda a sua dúvida aqui (caixinha: O que você quer saber?)", "As melhores eu respondo amanhã"],
    adesivo: "caixinha",
  },
  {
    chave: "lugares",
    nome: "Lugares e eventos",
    o_que_e: "Bastidor de evento do nicho, visita, feira ou palestra, com o lugar marcado.",
    quando_usar: "Quando a marca está num lugar que dá prova de movimento ou de autoridade.",
    exemplo: ["Olha onde a gente veio parar hoje", "A feira mais importante do setor", "O que mais chamou atenção até agora (localização)"],
    adesivo: "localizacao",
  },
  {
    chave: "fofoca",
    nome: "Fofoca do nicho",
    o_que_e: "Novidade ou polêmica do mercado contada em tom de conversa, com a opinião da marca e a enquete.",
    quando_usar: "Quando um assunto do nicho está em alta nesta semana e a marca tem opinião sobre ele.",
    exemplo: ["Vocês viram o que aconteceu?", "O assunto da semana no setor", "A nossa opinião sincera", "E vocês, concordam? (enquete: Sim | Não)"],
    adesivo: "enquete",
  },
  {
    chave: "perrengue",
    nome: "Perrengue",
    o_que_e: "Um problema real do dia e como foi resolvido. Humaniza a marca e mostra cuidado.",
    quando_usar: "Quando algo deu errado e a solução mostra o padrão da marca.",
    exemplo: ["Hoje não foi fácil", "O fornecedor atrasou a entrega da manhã", "O que a gente fez para nenhum cliente ficar sem", "Já passaram por isso? (reação)"],
    adesivo: "reacao",
  },
  {
    chave: "stories_awards",
    nome: "Stories Awards",
    o_que_e: "Premia ou destaca quem interagiu: repost de comentário, cliente do mês, a melhor resposta da caixinha.",
    quando_usar: "Depois de uma rodada de interação, para mostrar que vale participar.",
    exemplo: ["O prêmio de hoje vai para...", "A resposta mais criativa da caixinha", "Obrigado, @cliente (menção)"],
    adesivo: "mencao",
  },
  {
    chave: "geracao_valor",
    nome: "Geração de valor",
    o_que_e: "Uma dica rápida em 2 a 4 telas: utilidade pública, teoria simples ou um \"você sabia\" com quiz.",
    quando_usar: "Todo dia que não tem novidade: ensina algo que o cliente usa hoje.",
    exemplo: ["Você sabia disso?", "O erro mais comum na hora de escolher", "Qual é o certo? (quiz: A | B | C)", "A resposta e o porquê"],
    adesivo: "quiz",
  },
  {
    chave: "ancoragem_lancamento",
    nome: "Ancoragem de lançamento",
    o_que_e: "Contagem, lembrete e prova antes de um lançamento ou promoção.",
    quando_usar: "Nos dias que antecedem um lançamento, uma data ou uma promoção com hora marcada.",
    exemplo: ["Faltam 3 dias", "O que vem por aí (um pedaço só)", "Ativa o lembrete para não perder (contagem)"],
    adesivo: "contagem",
  },
  {
    chave: "opiniao",
    nome: "Opinião",
    o_que_e: "\"Compro ou não?\", \"concorda?\": enquete de opinião sobre o tema da marca.",
    quando_usar: "Para esquentar a conversa e ler o que o público pensa antes de vender.",
    exemplo: ["Pergunta sincera", "Você pagaria mais por isso?", "Vota aqui (enquete: Pagaria | Não pagaria)"],
    adesivo: "enquete",
  },
  {
    chave: "palavra_no_direct",
    nome: "Palavra no direct",
    o_que_e: "Pede uma palavra no direct (por exemplo EU QUERO) para abrir conversa e vender um a um.",
    quando_usar: "Quando a venda acontece na conversa: orçamento, agenda, condição especial.",
    exemplo: ["Tenho uma condição só para quem está aqui", "Vale até sexta", "Manda EU QUERO no direct que eu te explico"],
    adesivo: "nenhum",
  },
];

export const CHAVES_DOS_MOLDES = MOLDES_DE_STORIES.map((m) => m.chave);

export function moldePorChave(chave: unknown): Molde | null {
  return MOLDES_DE_STORIES.find((m) => m.chave === chave) ?? null;
}

export const OBJETIVOS = ["engajar", "vender", "lancar", "relacionamento", "bastidor"] as const;
export type Objetivo = (typeof OBJETIVOS)[number];

export const ROTULO_DO_OBJETIVO: Record<Objetivo, string> = {
  engajar: "engajar (conversa e interação)",
  vender: "vender (desejo, prova e convite)",
  lancar: "lançar (ancoragem e contagem)",
  relacionamento: "relacionamento (proximidade e confiança)",
  bastidor: "bastidor (rotina e processo)",
};

/** O arco da novela, na ordem. A sequência curta usa os primeiros e termina sempre no gancho de amanhã. */
export const ARCO_DA_NOVELA = ["gancho", "desenvolvimento", "interacao", "valor_ou_prova", "convite", "gancho_de_amanha"] as const;

/** O conhecimento que vai ao sistema do roteirista (curto, com teto do motor em mente). */
export function conhecimentoDosStories(): string {
  const moldes = MOLDES_DE_STORIES.map((m) =>
    `- ${m.chave} (${m.nome}, adesivo ${m.adesivo}): ${m.o_que_e} Quando usar: ${m.quando_usar} Exemplo: ${m.exemplo.join(" / ")}.`
  ).join("\n");
  return [
    "COMO OS STORIES PRENDEM (a novela imperdível):",
    "- Cada sequência é um capítulo: gancho, desenvolvimento, interação (adesivo), valor ou prova, convite e gancho para amanhã (\"amanhã eu conto...\"). A próxima sequência abre retomando o gancho de ontem.",
    "- Um adesivo de interação a cada 3 ou 4 stories. O resto sem adesivo (o painel publica sozinho o que não tem adesivo).",
    "- Texto na tela em até 2 linhas curtas (até 90 caracteres). Fala de gente, sem jargão, sem promessa que os dados não sustentam.",
    "- Zona segura 9:16: 14% livres em cima e 20% embaixo; o adesivo ocupa o meio de baixo.",
    "- Story é conversa de hoje: bastidor real, decisão real, opinião da marca. Nada de anúncio disfarçado em todas as telas.",
    "LIMITE DA PLATAFORMA: a API do Instagram não publica adesivo (enquete, caixinha, quiz, link, contagem, localização, reação, menção). Story com adesivo sai pelo app: escreva o roteiro exato do adesivo (pergunta e opções, texto do link, data da contagem).",
    "MOLDES VIRAIS:",
    moldes,
  ].join("\n");
}

// ------------------------------------------------------------------ esquemas do modelo

const ADESIVO_NO_ESQUEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tipo", "pergunta", "opcoes", "url", "texto_do_link", "quando"],
  properties: {
    tipo: { type: "string", enum: TIPOS_DE_ADESIVO.slice() },
    pergunta: { type: "string" },
    opcoes: { type: "array", items: { type: "string" } },
    url: { type: "string" },
    texto_do_link: { type: "string" },
    quando: { type: "string" },
  },
};

const STORY_NO_ESQUEMA = {
  type: "object",
  additionalProperties: false,
  required: ["molde", "papel", "titulo", "texto_na_tela", "adesivo", "fundo", "roteiro_do_adesivo"],
  properties: {
    molde: { type: "string" },
    papel: { type: "string", enum: ARCO_DA_NOVELA.slice() },
    titulo: { type: "string" },
    texto_na_tela: { type: "string" },
    adesivo: ADESIVO_NO_ESQUEMA,
    fundo: { type: "string", enum: ["foto", "cor"] },
    roteiro_do_adesivo: { type: "string" },
  },
};

export const ESQUEMA_DO_PLANO = {
  nome: "sequencia_de_stories",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["titulo", "gancho_de_amanha", "stories"],
    properties: {
      titulo: { type: "string" },
      gancho_de_amanha: { type: "string" },
      stories: { type: "array", items: STORY_NO_ESQUEMA },
    },
  },
};

export const ESQUEMA_DO_MOLDE = {
  nome: "story_do_molde",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["story"],
    properties: { story: STORY_NO_ESQUEMA },
  },
};
