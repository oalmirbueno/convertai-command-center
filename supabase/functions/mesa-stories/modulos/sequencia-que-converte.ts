/**
 * Sequência de Stories que converte (21/10/2026). Pedido do dono: "melhore a
 * área dos stories ... gera conteúdo com imagens mais bacana e não só texto, e
 * sim algo que converte ... e que também combine com as campanhas".
 *
 * - A estrutura de conversão: gancho, problema ou desejo, prova, oferta e CTA
 *   com adesivo (enquete, caixinha, link ou contagem). A API do Instagram não
 *   publica adesivo: o adesivo vai como instrução visual (área livre na arte)
 *   e no roteiro para quem posta pelo app.
 * - Os modelos prontos (lançamento, bastidores, prova social, oferta relâmpago,
 *   enquete de engajamento e tutorial), todos na mesma estrutura.
 * - A fase da campanha (aquecimento, lançamento, urgência, encerramento).
 * - O pedido ao gerador da casa (Arte rápida do Estúdio, 9:16): cada tela é
 *   uma lâmina com a imagem gerada e o texto integrado pelo motor. Foto real só
 *   como referência inteira; nada colado por cima.
 * - As partes do custo (plano, diretor, imagens), para o custo antes.
 *
 * Módulo puro (sem Deno, sem banco): a função mesa-stories, a tela e o vitest
 * leem o mesmo arquivo. Sem travessão; nada de regex que o Safari 11 não lê.
 */

import { type Objetivo, type TipoDoAdesivo, TIPOS_DE_ADESIVO } from "./moldes-de-stories.ts";
import { adesivoLimpo, caminhoDoAdesivo, limpar, type PlanoDaSequencia, rascunhoLimpo, roteiroDoAdesivo, type StoryRascunho } from "./regras-dos-stories.ts";
import { textoNativoPadrao } from "./foto-natural-do-story.ts";

/**
 * 22/10: o estilo das imagens. "natural" (padrão de story): foto do momento,
 * de celular, sem texto, e o texto nativo do Instagram por cima, desenhado
 * pelo código. "destaque" (designer): a arte da Arte rápida 9:16 com o texto
 * integrado pelo motor e a referência da campanha.
 */
export const ESTILOS_DA_IMAGEM = ["natural", "destaque"] as const;
export type EstiloDaImagem = (typeof ESTILOS_DA_IMAGEM)[number];
export const ehEstiloDaImagem = (v: unknown): v is EstiloDaImagem => v === "natural" || v === "destaque";
export const ROTULO_DO_ESTILO: Record<EstiloDaImagem, string> = { natural: "Natural (padrão de story)", destaque: "Destaque (designer)" };

// ------------------------------------------------------------------ estrutura

export const PAPEIS_DE_CONVERSAO = ["gancho", "problema_ou_desejo", "prova", "oferta", "cta"] as const;
export type PapelDeConversao = (typeof PAPEIS_DE_CONVERSAO)[number];

/** Rótulo de cada papel (os da conversão e os do arco da novela, que as sequências antigas usam). */
export const ROTULO_DO_PAPEL: Record<string, string> = {
  gancho: "Gancho",
  problema_ou_desejo: "Problema ou desejo",
  prova: "Prova",
  oferta: "Oferta",
  cta: "CTA",
  desenvolvimento: "Desenvolvimento",
  interacao: "Interação",
  valor_ou_prova: "Valor ou prova",
  convite: "Convite",
  gancho_de_amanha: "Gancho de amanhã",
};

/** O CTA sempre fecha com um destes adesivos (a ação que o seguidor faz). */
export const ADESIVOS_DO_CTA: readonly TipoDoAdesivo[] = ["enquete", "caixinha", "link", "contagem"];

export const ehPapelDeConversao = (v: unknown): v is PapelDeConversao => typeof v === "string" && (PAPEIS_DE_CONVERSAO as readonly string[]).indexOf(v) >= 0;

// ------------------------------------------------------------------ modelos prontos

export type TelaDoModelo = { papel: PapelDeConversao; adesivo: TipoDoAdesivo; dica: string };

export type ModeloDeSequencia = {
  chave: string;
  nome: string;
  descricao: string;
  objetivo: Objetivo;
  /** As 5 telas da estrutura, na ordem. */
  telas: TelaDoModelo[];
  /** A tela que se repete (antes da oferta) quando pedem mais de 5. */
  extra: TelaDoModelo;
  /** O que sai primeiro quando pedem menos de 5 (gancho e CTA nunca saem). */
  corte: PapelDeConversao[];
};

export const MODELOS_DE_SEQUENCIA: readonly ModeloDeSequencia[] = [
  {
    chave: "conversao",
    nome: "Sequência que converte",
    descricao: "Gancho, dor ou desejo, prova, oferta e CTA com adesivo. A estrutura base de venda nos stories.",
    objetivo: "vender",
    telas: [
      { papel: "gancho", adesivo: "nenhum", dica: "Uma frase que para o dedo: pergunta, número ou cena inesperada do negócio." },
      { papel: "problema_ou_desejo", adesivo: "enquete", dica: "A dor ou o desejo do público, com uma enquete que faz a pessoa se identificar." },
      { papel: "prova", adesivo: "nenhum", dica: "Prova real dos dados: resultado, cliente, número, bastidor do cuidado." },
      { papel: "oferta", adesivo: "nenhum", dica: "O que é, para quem é e a condição, sem prometer o que os dados não dizem." },
      { papel: "cta", adesivo: "link", dica: "Uma ação só: tocar no link, votar, perguntar ou ativar o lembrete." },
    ],
    extra: { papel: "prova", adesivo: "nenhum", dica: "Mais uma prova, de outro ângulo (depoimento, detalhe, número)." },
    corte: ["prova", "problema_ou_desejo"],
  },
  {
    chave: "lancamento",
    nome: "Lançamento",
    descricao: "Expectativa, revelação e contagem regressiva para a novidade.",
    objetivo: "lancar",
    telas: [
      { papel: "gancho", adesivo: "nenhum", dica: "Vem novidade: mostre só um pedaço e crie curiosidade." },
      { papel: "problema_ou_desejo", adesivo: "enquete", dica: "O desejo que a novidade resolve, com enquete do tipo quer saber primeiro." },
      { papel: "prova", adesivo: "nenhum", dica: "Bastidor da criação ou do preparo da novidade." },
      { papel: "oferta", adesivo: "nenhum", dica: "A revelação: o que é e a condição de lançamento." },
      { papel: "cta", adesivo: "contagem", dica: "Contagem regressiva com lembrete para o dia do lançamento." },
    ],
    extra: { papel: "prova", adesivo: "nenhum", dica: "Mais um detalhe da novidade, sem revelar tudo." },
    corte: ["prova", "problema_ou_desejo"],
  },
  {
    chave: "bastidores",
    nome: "Bastidores",
    descricao: "O processo real por trás do produto, que gera confiança e desejo.",
    objetivo: "bastidor",
    telas: [
      { papel: "gancho", adesivo: "nenhum", dica: "Uma cena real de agora: chegando, preparando, montando." },
      { papel: "problema_ou_desejo", adesivo: "caixinha", dica: "O cuidado que quase ninguém vê, com caixinha para perguntas." },
      { papel: "prova", adesivo: "nenhum", dica: "O detalhe do processo que mostra o padrão da marca." },
      { papel: "oferta", adesivo: "nenhum", dica: "O resultado pronto: o produto ou serviço que sai desse processo." },
      { papel: "cta", adesivo: "link", dica: "Convite para ver, pedir ou agendar pelo link." },
    ],
    extra: { papel: "prova", adesivo: "nenhum", dica: "Mais uma etapa do processo." },
    corte: ["problema_ou_desejo", "prova"],
  },
  {
    chave: "prova_social",
    nome: "Prova social",
    descricao: "Resultado de cliente, depoimento e convite para ser o próximo.",
    objetivo: "vender",
    telas: [
      { papel: "gancho", adesivo: "nenhum", dica: "O resultado do cliente em uma frase." },
      { papel: "problema_ou_desejo", adesivo: "nenhum", dica: "Como era antes: a dor que o cliente tinha." },
      { papel: "prova", adesivo: "mencao", dica: "O depoimento ou o retorno real, com a menção ao cliente quando ele autoriza." },
      { papel: "oferta", adesivo: "nenhum", dica: "O mesmo caminho para quem está assistindo." },
      { papel: "cta", adesivo: "caixinha", dica: "Caixinha: me conta o que você precisa." },
    ],
    extra: { papel: "prova", adesivo: "nenhum", dica: "Mais um cliente ou mais um número real." },
    corte: ["problema_ou_desejo", "prova"],
  },
  {
    chave: "oferta_relampago",
    nome: "Oferta relâmpago",
    descricao: "Condição com hora para acabar: urgência real e um CTA direto.",
    objetivo: "vender",
    telas: [
      { papel: "gancho", adesivo: "nenhum", dica: "Só hoje ou só até tal hora, logo na primeira tela." },
      { papel: "problema_ou_desejo", adesivo: "nenhum", dica: "Por que vale agora: o desejo que a oferta atende." },
      { papel: "prova", adesivo: "nenhum", dica: "Prova rápida: o produto real, quem já comprou, o que vem junto." },
      { papel: "oferta", adesivo: "contagem", dica: "A condição exata e a contagem até o fim." },
      { papel: "cta", adesivo: "link", dica: "Toque no link antes de acabar." },
    ],
    extra: { papel: "prova", adesivo: "nenhum", dica: "Mais um motivo concreto para aproveitar hoje." },
    corte: ["problema_ou_desejo", "prova"],
  },
  {
    chave: "enquete_engajamento",
    nome: "Enquete de engajamento",
    descricao: "Perguntas que fazem o público tocar na tela e aquecem a conversa.",
    objetivo: "engajar",
    telas: [
      { papel: "gancho", adesivo: "nenhum", dica: "Uma pergunta sincera do nicho." },
      { papel: "problema_ou_desejo", adesivo: "enquete", dica: "Enquete com duas opções reais do dia a dia do público." },
      { papel: "prova", adesivo: "quiz", dica: "Quiz com a resposta certa e o porquê na tela seguinte." },
      { papel: "oferta", adesivo: "nenhum", dica: "A resposta e a dica que resolve, ligada ao que a marca faz." },
      { papel: "cta", adesivo: "caixinha", dica: "Caixinha: manda a sua dúvida que a gente responde amanhã." },
    ],
    extra: { papel: "prova", adesivo: "reacao", dica: "Mais uma pergunta rápida com reação." },
    corte: ["prova", "oferta"],
  },
  {
    chave: "tutorial",
    nome: "Tutorial",
    descricao: "Passo a passo curto que ensina algo útil e leva para a oferta.",
    objetivo: "relacionamento",
    telas: [
      { papel: "gancho", adesivo: "nenhum", dica: "O resultado que a pessoa vai conseguir em poucos passos." },
      { papel: "problema_ou_desejo", adesivo: "nenhum", dica: "O erro mais comum de quem tenta sozinho." },
      { papel: "prova", adesivo: "nenhum", dica: "O passo a passo, um passo por tela." },
      { papel: "oferta", adesivo: "nenhum", dica: "Quando vale chamar a marca para fazer junto." },
      { papel: "cta", adesivo: "caixinha", dica: "Caixinha para dúvidas ou link para o serviço." },
    ],
    extra: { papel: "prova", adesivo: "nenhum", dica: "O próximo passo." },
    corte: ["oferta", "problema_ou_desejo"],
  },
];

export const CHAVES_DOS_MODELOS = MODELOS_DE_SEQUENCIA.map((m) => m.chave);

export function modeloPorChave(v: unknown): ModeloDeSequencia | null {
  for (const m of MODELOS_DE_SEQUENCIA) if (m.chave === v) return m;
  return null;
}

export const MIN_TELAS = 3;
export const MAX_TELAS = 8;

export function telasValidas(v: unknown): number {
  const n = Math.round(Number(v));
  if (!isFinite(n)) return 5;
  return Math.min(MAX_TELAS, Math.max(MIN_TELAS, n));
}

/** As telas do modelo para a quantidade pedida: 3 a 8, sempre começando no gancho e fechando no CTA. */
export function telasDaEstrutura(modelo: ModeloDeSequencia, quantidade: number): TelaDoModelo[] {
  const n = telasValidas(quantidade);
  let telas = modelo.telas.slice();
  if (n > telas.length) {
    const iOferta = telas.map((t) => t.papel).indexOf("oferta");
    const extras: TelaDoModelo[] = [];
    for (let i = telas.length; i < n; i++) extras.push({ ...modelo.extra });
    telas = telas.slice(0, iOferta).concat(extras, telas.slice(iOferta));
  }
  for (const papel of modelo.corte) {
    if (telas.length <= n) break;
    const i = telas.map((t) => t.papel).indexOf(papel);
    if (i > 0 && i < telas.length - 1) telas.splice(i, 1);
  }
  // Ainda sobrando (corte curto): sai o que está antes da oferta, nunca o gancho nem o CTA.
  while (telas.length > n) telas.splice(telas.length - 2, 1);
  return telas;
}

// ------------------------------------------------------------------ campanha

export const FASES_DA_CAMPANHA = ["aquecimento", "lancamento", "urgencia", "encerramento"] as const;
export type FaseDaCampanha = (typeof FASES_DA_CAMPANHA)[number];

export const ROTULO_DA_FASE: Record<FaseDaCampanha, string> = {
  aquecimento: "Aquecimento",
  lancamento: "Lançamento",
  urgencia: "Urgência",
  encerramento: "Encerramento",
};

/** O que cada fase pede da sequência (vai ao roteirista). */
export const ORIENTACAO_DA_FASE: Record<FaseDaCampanha, string> = {
  aquecimento: "Aquecimento: curiosidade e desejo, sem preço. Mostre um pedaço, abra conversa e termine pedindo o lembrete ou a resposta.",
  lancamento: "Lançamento: revele a oferta inteira, com a prova mais forte e o CTA direto.",
  urgencia: "Urgência: o prazo real e o que acaba, com contagem regressiva. Escassez só se estiver nos dados.",
  encerramento: "Encerramento: última chamada, prova de quem já aproveitou e o agradecimento a quem participou.",
};

/** O modelo que cada fase usa quando ninguém escolhe. */
export const MODELO_DA_FASE: Record<FaseDaCampanha, string> = {
  aquecimento: "lancamento",
  lancamento: "conversao",
  urgencia: "oferta_relampago",
  encerramento: "prova_social",
};

export const ehFase = (v: unknown): v is FaseDaCampanha => typeof v === "string" && (FASES_DA_CAMPANHA as readonly string[]).indexOf(v) >= 0;

export type BriefingDosStories = {
  produtos?: Array<{ nome?: string; por_que?: string }>;
  oferta?: string;
  mensagem_central?: string;
  publico?: string;
  provas?: string[];
  tom?: string;
  cta?: string;
};

export type IdentidadeDosStories = {
  tema_visual?: string;
  paleta_apoio?: Array<{ hex?: string; nome?: string }>;
  tipografia?: string;
  elementos?: string;
  tom?: string;
  selo?: { texto?: string; descricao?: string };
};

export type CampanhaDosStories = {
  id: string;
  nome: string;
  tema_id: string | null;
  fase: FaseDaCampanha;
  briefing: BriefingDosStories;
  identidade: IdentidadeDosStories;
  tem_selo: boolean;
};

const objeto = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const textos = (v: unknown, max: number, n: number) => (Array.isArray(v) ? v : []).map((x) => limpar(x, max)).filter(Boolean).slice(0, n);

/** Briefing lido com cuidado (do banco ou de quem chama). */
export function briefingLimpo(v: unknown): BriefingDosStories {
  const o = objeto(v);
  const produtos = (Array.isArray(o.produtos) ? o.produtos : []).map((p) => objeto(p)).map((p) => ({ nome: limpar(p.nome, 120), por_que: limpar(p.por_que, 300) })).filter((p) => !!p.nome).slice(0, 6);
  return {
    produtos,
    oferta: limpar(o.oferta, 400),
    mensagem_central: limpar(o.mensagem_central, 400),
    publico: limpar(o.publico, 300),
    provas: textos(o.provas, 200, 6),
    tom: limpar(o.tom, 200),
    cta: limpar(o.cta, 200),
  };
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Identidade da campanha lida com cuidado: cor só em #rrggbb. */
export function identidadeLimpa(v: unknown): IdentidadeDosStories {
  const o = objeto(v);
  const selo = objeto(o.selo);
  return {
    tema_visual: limpar(o.tema_visual, 300),
    paleta_apoio: (Array.isArray(o.paleta_apoio) ? o.paleta_apoio : []).map((c) => objeto(c)).filter((c) => typeof c.hex === "string" && HEX.test(c.hex)).map((c) => ({ hex: String(c.hex).toLowerCase(), nome: limpar(c.nome, 40) })).slice(0, 6),
    tipografia: limpar(o.tipografia, 200),
    elementos: limpar(o.elementos, 300),
    tom: limpar(o.tom, 200),
    selo: { texto: limpar(selo.texto, 80), descricao: limpar(selo.descricao, 200) },
  };
}

/** Quem chama manda o que tem na tela; o banco completa o que faltou. */
export function juntarBriefing(daTela: BriefingDosStories, doBanco: BriefingDosStories): BriefingDosStories {
  const saida: BriefingDosStories = { ...doBanco };
  (Object.keys(daTela) as Array<keyof BriefingDosStories>).forEach((k) => {
    const v = daTela[k];
    const tem = Array.isArray(v) ? v.length > 0 : !!v;
    if (tem) (saida as Record<string, unknown>)[k] = v;
  });
  return saida;
}

export function juntarIdentidade(daTela: IdentidadeDosStories, doBanco: IdentidadeDosStories): IdentidadeDosStories {
  const saida: IdentidadeDosStories = { ...doBanco };
  (Object.keys(daTela) as Array<keyof IdentidadeDosStories>).forEach((k) => {
    const v = daTela[k];
    const tem = Array.isArray(v) ? v.length > 0 : k === "selo" ? !!(v && (v as { texto?: string }).texto) : !!v;
    if (tem) (saida as Record<string, unknown>)[k] = v;
  });
  return saida;
}

/** O bloco da campanha para o roteirista: briefing, identidade e a fase. */
export function blocoDaCampanha(c: CampanhaDosStories): string {
  const b = c.briefing;
  const id = c.identidade;
  const linhas = [`CAMPANHA "${c.nome}", fase de ${ROTULO_DA_FASE[c.fase].toLowerCase()}. ${ORIENTACAO_DA_FASE[c.fase]}`];
  const brief = [
    b.produtos && b.produtos.length ? `produto(s): ${b.produtos.map((p) => (p.por_que ? `${p.nome} (${p.por_que})` : p.nome)).join("; ")}` : "",
    b.oferta ? `oferta: ${b.oferta}` : "",
    b.mensagem_central ? `mensagem central: ${b.mensagem_central}` : "",
    b.publico ? `público: ${b.publico}` : "",
    b.provas && b.provas.length ? `provas: ${b.provas.join("; ")}` : "",
    b.tom ? `tom: ${b.tom}` : "",
    b.cta ? `CTA da campanha: ${b.cta}` : "",
  ].filter(Boolean);
  if (brief.length) linhas.push(`Briefing: ${brief.join(". ")}.`);
  const ident = identidadeEmTexto(id);
  if (ident) linhas.push(`Identidade da campanha: ${ident}.`);
  linhas.push("Os stories são desta campanha: a oferta, a prova e o CTA saem do briefing; nada inventado fora dele.");
  return linhas.join("\n");
}

export function identidadeEmTexto(id: IdentidadeDosStories): string {
  const paleta = (id.paleta_apoio || []).map((c) => c.hex).filter(Boolean).join(", ");
  return [
    id.tema_visual ? `tema visual ${id.tema_visual}` : "",
    paleta ? `cores ${paleta}` : "",
    id.tipografia ? `tipografia ${id.tipografia}` : "",
    id.elementos ? `elementos ${id.elementos}` : "",
    id.tom ? `tom ${id.tom}` : "",
    id.selo && id.selo.texto ? `selo "${id.selo.texto}"` : "",
  ].filter(Boolean).join("; ");
}

// ------------------------------------------------------------------ plano do roteirista

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

export const ESQUEMA_DA_SEQUENCIA_QUE_CONVERTE = {
  nome: "sequencia_que_converte",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["titulo", "gancho_de_amanha", "stories"],
    properties: {
      titulo: { type: "string" },
      gancho_de_amanha: { type: "string" },
      stories: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["papel", "titulo", "texto_na_tela", "cena", "adesivo", "roteiro_do_adesivo"],
          properties: {
            papel: { type: "string", enum: PAPEIS_DE_CONVERSAO.slice() },
            titulo: { type: "string" },
            texto_na_tela: { type: "string" },
            cena: { type: "string" },
            adesivo: ADESIVO_NO_ESQUEMA,
            roteiro_do_adesivo: { type: "string" },
          },
        },
      },
    },
  },
};

export const SISTEMA_DA_CONVERSAO = [
  "ESTRUTURA QUE CONVERTE (obrigatória nesta sequência): cada story tem um papel, na ordem pedida em ESTRUTURA: gancho (para o dedo), problema_ou_desejo (a dor ou o desejo do público), prova (real, dos dados), oferta (o que é, para quem e a condição) e cta (uma ação só, com adesivo).",
  "O último story é o CTA e SEMPRE tem adesivo: enquete, caixinha, link ou contagem. Escreva o roteiro exato do adesivo.",
  "Cada story tem a cena da imagem: o que a foto gerada mostra (produto real, ambiente, pessoa, detalhe), concreta e do negócio, sem texto, sem logo e sem interface de app. A imagem é gerada pelo Estúdio da casa: nada de pedir colagem, recorte ou foto por cima.",
  "texto_na_tela curto (até 2 linhas, até 90 caracteres): é o texto que vai integrado na arte.",
].join("\n");

/** O pedido do usuário para o roteirista: a estrutura tela a tela, a campanha (quando tem) e o pedido da equipe. */
export function pedidoDaSequenciaQueConverte(e: { modelo: ModeloDeSequencia; telas: TelaDoModelo[]; data: string; campanha?: CampanhaDosStories | null; pedido?: string; estilo?: EstiloDaImagem }): string {
  const estrutura = e.telas.map((t, i) => `${i + 1}) ${t.papel}${t.adesivo !== "nenhum" ? ` (adesivo ${t.adesivo})` : ""}: ${t.dica}`).join("\n");
  return [
    `MODELO: ${e.modelo.nome}. ${e.modelo.descricao}`,
    `ESTRUTURA (${e.telas.length} stories, nesta ordem):\n${estrutura}`,
    e.campanha ? blocoDaCampanha(e.campanha) : "",
    e.estilo === "destaque"
      ? "ESTILO DAS IMAGENS: Destaque (designer). A cena é a arte desenhada da tela."
      : "ESTILO DAS IMAGENS: Natural, padrão de story. A cena é um momento cotidiano do perfil fotografado no celular (bastidor, mesa de trabalho, café, rua, atendimento, mão segurando um documento), com gente e lugar de verdade do negócio. Nada de produto em estúdio. O texto_na_tela é o texto que a pessoa digita no app: poucas palavras (até 8), tom de conversa.",
    `PEDIDO: ${e.telas.length} stories para ${e.data}.${e.pedido ? ` Pedido da equipe: ${e.pedido}` : ""}`,
  ].filter(Boolean).join("\n\n");
}

/** Adesivo padrão do CTA quando o roteirista não pôs um (a estrutura nunca fica sem a ação). */
export function adesivoPadraoDoCta(tipo: TipoDoAdesivo, briefing?: BriefingDosStories | null): Record<string, unknown> {
  const cta = briefing && briefing.cta ? briefing.cta : "";
  switch (tipo) {
    case "enquete":
      return { tipo, pergunta: "Você quer?", opcoes: ["Quero", "Agora não"] };
    case "caixinha":
      return { tipo, pergunta: "Ficou com alguma dúvida?" };
    case "contagem":
      return { tipo, pergunta: cta || "Falta pouco" };
    default:
      return { tipo: "link", texto_do_link: (cta || "Saiba mais").slice(0, 40) };
  }
}

/**
 * O plano do roteirista limpo e encaixado na estrutura: o papel de cada tela
 * vem da estrutura (na ordem), a cena vai para o fundo (imagem a gerar) e o CTA
 * sempre fecha com adesivo.
 */
export function planoQueConverteLimpo(bruto: unknown, telas: TelaDoModelo[], briefing?: BriefingDosStories | null, estilo: EstiloDaImagem = "destaque"): PlanoDaSequencia {
  const o = objeto(bruto);
  const lista = (Array.isArray(o.stories) ? o.stories : []).slice(0, telas.length);
  const stories: StoryRascunho[] = [];
  lista.forEach((bru, i) => {
    const b = objeto(bru);
    const tela = telas[i];
    const r = rascunhoLimpo({ ...b, molde: "livre", fundo: null }, i + 1);
    if (!r.texto_na_tela) return;
    let adesivo = r.adesivo;
    const ultimo = i === telas.length - 1 || i === lista.length - 1;
    if (ultimo && ADESIVOS_DO_CTA.indexOf(adesivo.tipo) < 0) {
      adesivo = adesivoLimpo(adesivoPadraoDoCta(tela.adesivo === "nenhum" || ADESIVOS_DO_CTA.indexOf(tela.adesivo) < 0 ? "link" : tela.adesivo, briefing));
    }
    stories.push({
      ...r,
      papel: ultimo ? "cta" : tela.papel,
      adesivo,
      caminho: caminhoDoAdesivo(adesivo),
      roteiro_do_adesivo: adesivo.tipo === "nenhum" ? null : (roteiroDoAdesivo(adesivo) || r.roteiro_do_adesivo),
      fundo: estilo === "natural"
        ? { tipo: "natural", papel: ultimo ? "cta" : tela.papel, cena: limpar(b.cena, 400), ...textoNativoPadrao(ultimo ? "cta" : tela.papel, adesivo.tipo !== "nenhum") }
        : { tipo: "gerada", papel: ultimo ? "cta" : tela.papel, cena: limpar(b.cena, 400) },
    });
  });
  return {
    titulo: limpar(o.titulo, 200),
    gancho_de_amanha: limpar(o.gancho_de_amanha, 500),
    stories: stories.map((s, i) => ({ ...s, ordem: i + 1 })),
  };
}

/** A sequência tem a estrutura de conversão inteira? (para a tela mostrar e para os testes). */
export function estruturaDaSequencia(stories: Array<{ fundo?: { papel?: string | null } | null; adesivo: { tipo: string } }>): {
  papeis: string[];
  faltando: PapelDeConversao[];
  ctaComAdesivo: boolean;
  completa: boolean;
} {
  const papeis = stories.map((s) => (s.fundo && s.fundo.papel) || "");
  const faltando = PAPEIS_DE_CONVERSAO.filter((p) => papeis.indexOf(p) < 0);
  const ultimo = stories[stories.length - 1];
  const ctaComAdesivo = !!ultimo && papeis[papeis.length - 1] === "cta" && ADESIVOS_DO_CTA.indexOf(ultimo.adesivo.tipo as TipoDoAdesivo) >= 0;
  // Sequência curta (3 ou 4 telas) não precisa de prova e problema; precisa de gancho, oferta e CTA.
  const essenciais: PapelDeConversao[] = stories.length >= 5 ? PAPEIS_DE_CONVERSAO.slice() : ["gancho", "oferta", "cta"];
  const completa = essenciais.every((p) => papeis.indexOf(p) >= 0) && papeis[0] === "gancho" && ctaComAdesivo;
  return { papeis, faltando, ctaComAdesivo, completa };
}

// ------------------------------------------------------------------ pedido ao gerador (Arte rápida, 9:16)

export const REGRA_SEM_COLAGEM_DOS_STORIES =
  "Regra da casa: toda imagem destes stories sai do gerador do Estúdio, com o texto integrado pelo motor. Nada colado por cima (nem foto, nem logo, nem recorte); foto real anexada é só referência inteira para o gerador desenhar a cena.";

const AREA_DO_ADESIVO: Partial<Record<TipoDoAdesivo, string>> = {
  enquete: "enquete",
  quiz: "quiz",
  caixinha: "caixinha de perguntas",
  link: "adesivo de link",
  contagem: "contagem regressiva",
  localizacao: "localização",
  reacao: "barra de reação",
  mencao: "menção",
};

export type TelaParaOGerador = { ordem: number; texto_na_tela: string; papel?: string | null; cena?: string | null; adesivo: { tipo: string } };

/**
 * O pedido da Arte rápida (formato stories_9x16, uma lâmina por tela): o texto
 * exato de cada tela, a cena da imagem, a área livre do adesivo e a campanha.
 * Teto de 3.000 caracteres (o do Estúdio): a cena encolhe antes; a regra sem
 * colagem nunca é cortada.
 */
/** O padrão visual da campanha (briefing.padrao, lido pelo Estúdio): referências de estilo e o resumo. */
export type PadraoDosStories = { caminhos?: string[]; referencias_ids?: string[]; resumo?: string; paleta?: Array<{ hex?: string; nome?: string }>; tratamento_de_foto?: string };

export function pedidoDasImagens(e: { titulo: string; telas: TelaParaOGerador[]; campanha?: { nome: string; fase?: FaseDaCampanha | null; identidade?: IdentidadeDosStories | null; padrao?: PadraoDosStories | null } | null; tom?: string | null }): string {
  const total = e.telas.length;
  const montar = (maxCena: number) => {
    const linhas: string[] = [
      `Sequência de Stories "${e.titulo || "Stories"}": ${total} ${total === 1 ? "tela" : "telas"} verticais 9:16, uma por lâmina, na ordem, feitas para converter (gancho, problema ou desejo, prova, oferta e CTA).`,
      "Cada lâmina é a tela inteira do story: a imagem gerada conta a cena e o texto vai integrado à arte, exatamente como escrito, grande e legível no celular. Mesma linguagem visual em todas as telas, como uma série.",
      "Zona segura: nada importante nos 14% de cima (barra e perfil) nem nos 20% de baixo (responder).",
      "Telas:",
    ];
    for (const t of e.telas) {
      const papel = t.papel ? ROTULO_DO_PAPEL[t.papel] || t.papel : "";
      const area = AREA_DO_ADESIVO[t.adesivo.tipo as TipoDoAdesivo];
      const cena = (t.cena || "").slice(0, maxCena);
      linhas.push(
        `${t.ordem}) ${papel ? `[${papel}] ` : ""}Texto: "${t.texto_na_tela}".${cena ? ` Cena: ${cena}.` : ""}${area ? ` Deixe livre o meio de baixo para a ${area} (entra pelo app): sem texto nem objeto importante ali.` : ""}`,
      );
    }
    if (e.campanha) {
      const ident = e.campanha.identidade ? identidadeEmTexto(e.campanha.identidade) : "";
      linhas.push(`Campanha "${e.campanha.nome}"${e.campanha.fase ? `, fase de ${ROTULO_DA_FASE[e.campanha.fase].toLowerCase()}` : ""}: siga a identidade da campanha${ident ? ` (${ident})` : ""}; o selo da campanha entra desenhado pelo gerador, nunca colado.`);
      const p = e.campanha.padrao;
      if (p && ((p.caminhos && p.caminhos.length) || p.resumo)) {
        linhas.push(`Padrão visual da campanha${p.resumo ? `: ${limpar(p.resumo, 240)}` : ""}. As imagens de padrão anexadas são referência de estilo (layout, tipografia, tratamento, cor): siga o estilo, nunca cole nem copie texto, logo ou pessoa delas.`);
      }
    }
    if (e.tom) linhas.push(`Tom: ${e.tom}.`);
    linhas.push(REGRA_SEM_COLAGEM_DOS_STORIES);
    return linhas.join("\n");
  };
  for (const maxCena of [400, 220, 120, 60, 0]) {
    const p = montar(maxCena);
    if (p.length <= 3000) return p;
  }
  const p = montar(0);
  return `${p.slice(0, 2990 - REGRA_SEM_COLAGEM_DOS_STORIES.length)}\n${REGRA_SEM_COLAGEM_DOS_STORIES}`;
}

// ------------------------------------------------------------------ custo antes

/** Tamanhos estimados (tokens) de cada parte; os mesmos na tela e na função. */
export const TAMANHOS_DOS_STORIES = {
  /** O roteirista escreve duas versões em paralelo (a melhor fica). */
  plano: { entrada: 14000, saida: 3000, versoes: 2 },
  diretor: { entrada: 25000, saida: 8000 },
  imagem: { entrada: 5000 },
  leitura: { entrada: 2500, saida: 400 },
} as const;

export type ParteDoCustoDosStories = {
  papel: "plano" | "diretor_arte" | "imagem" | "leitura";
  tipo: "texto" | "imagem";
  tokensEntrada: number;
  tokensSaida?: number;
  imagens?: number;
  vezes: number;
};

/** As partes do custo: o plano (opcional), a direção da série e cada imagem com a conferência. */
export function partesDoCustoDosStories(telas: number, o: { comPlano: boolean; comImagens: boolean; comDiretor?: boolean; natural?: boolean }): ParteDoCustoDosStories[] {
  const n = Math.max(0, Math.round(telas));
  const saida: ParteDoCustoDosStories[] = [];
  const T = TAMANHOS_DOS_STORIES;
  if (o.comPlano) saida.push({ papel: "plano", tipo: "texto", tokensEntrada: T.plano.entrada, tokensSaida: T.plano.saida, vezes: T.plano.versoes });
  // Natural: só a foto de cada tela (sem direção de arte nem conferência de texto: o texto é a camada nativa).
  if (o.comImagens && n > 0 && o.natural) {
    saida.push({ papel: "imagem", tipo: "imagem", tokensEntrada: T.imagem.entrada, imagens: 1, vezes: n });
  } else if (o.comImagens && n > 0) {
    if (o.comDiretor !== false) saida.push({ papel: "diretor_arte", tipo: "texto", tokensEntrada: T.diretor.entrada, tokensSaida: T.diretor.saida, vezes: 1 });
    saida.push({ papel: "imagem", tipo: "imagem", tokensEntrada: T.imagem.entrada, imagens: 1, vezes: n });
    saida.push({ papel: "leitura", tipo: "texto", tokensEntrada: T.leitura.entrada, tokensSaida: T.leitura.saida, vezes: n });
  }
  return saida;
}
