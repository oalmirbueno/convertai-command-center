/**
 * sugerir_animacoes (frente EDT, F3): em quais frases entra uma animação e
 * qual peça. A tela manda as frases DITAS com as peças candidatas que o código
 * já montou só com o que foi dito (src/lib/editor/motion/sugestoes.ts); aqui o
 * Jev julga, em UMA chamada com as perguntas em paralelo:
 * - Noul por frase: "esta frase pede um reforço visual?";
 * - Choice por frase: qual das candidatas combina (ou nenhuma).
 * O código escolhe pelo limiar e pela densidade (espaço mínimo entre peças).
 * Sem custo para o cliente (como a ordem clara). A chave fica só no servidor.
 *
 * POST { acao: "animacoes_sugerir", client_id, frases: [{ k, inicio_s, fim_s, texto, candidatas: [peca] }], densidade: "poucas" | "medias" }
 *   -> { sugestoes: [{ k, peca, probabilidade }], fonte: "jev" }
 */

import { jevPerguntar, probabilidadeNoul, type PerguntaJev, type RespostaJev } from "../_shared/jev.ts";

export const PECAS_QUE_O_JEV_ESCOLHE: Record<string, string> = {
  rotulo: "rótulo escrito com o assunto da frase",
  carimbo: "carimbo com um veredito curto (mito, verdade, errado)",
  lista: "lista com os itens que a frase enumera",
  passos: "passo a passo numerado com as etapas ditas",
  contador: "número grande contando até o valor dito",
  lettering: "a frase em letras grandes, um pedaço por vez",
  barra: "barra de porcentagem com o valor dito",
  preco: "etiqueta de preço com o valor dito",
  comentario: "balão de comentário pedindo para comentar a palavra dita",
  selo: "selo de garantia, prazo ou frete",
};

export interface FraseRecebida {
  k: string;
  inicio_s: number;
  fim_s: number;
  texto: string;
  candidatas: string[];
}

export interface Sugestao {
  k: string;
  peca: string;
  probabilidade: number;
}

export const LIMIAR_DO_NOUL = 0.6;
export const ESPACO_POR_DENSIDADE: Record<"poucas" | "medias", number> = { poucas: 20, medias: 7 };
export const MAX_FRASES = 30;

/** Frases conferidas (texto curto, candidatas conhecidas, tempo válido). */
export function frasesDoCorpo(v: unknown): FraseRecebida[] {
  if (!Array.isArray(v)) return [];
  const saida: FraseRecebida[] = [];
  v.slice(0, MAX_FRASES).forEach((x, i) => {
    const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    const texto = String(o.texto || "").replace(/\s+/g, " ").trim().slice(0, 240);
    const ini = Number(o.inicio_s);
    const fim = Number(o.fim_s);
    const candidatas = (Array.isArray(o.candidatas) ? o.candidatas : []).map(String).filter((c, j, l) => !!PECAS_QUE_O_JEV_ESCOLHE[c] && l.indexOf(c) === j).slice(0, 6);
    if (!texto || !candidatas.length || !isFinite(ini) || !isFinite(fim) || fim < ini) return;
    saida.push({ k: /^f\d{1,4}$/.test(String(o.k)) ? String(o.k) : `f${i + 1}`, inicio_s: ini, fim_s: fim, texto, candidatas });
  });
  return saida;
}

/** Perguntas ao Jev: um Noul e um Choice por frase, todas na mesma chamada. */
export function perguntasDasFrases(frases: FraseRecebida[]): { state: unknown; questions: Record<string, PerguntaJev> } {
  const questions: Record<string, PerguntaJev> = {};
  frases.forEach((f, i) => {
    questions[`pede_${i}`] = {
      type: "noul",
      instructions: `Vídeo curto de rede social com uma pessoa falando. A frase \`frases[${i}].texto\` pede um reforço visual na tela (uma animação) porque traz um dado, uma lista, uma chamada ou uma ideia forte que o público precisa guardar? Frase de passagem, de ligação ou que só repete o que já foi dito não pede.`,
      criteria: { true: "pede animação: dado, lista, chamada, veredito ou ideia central", false: "não pede: frase de passagem, contexto ou repetição" },
    };
    const criteria: Record<string, string> = {};
    f.candidatas.forEach((c) => (criteria[c] = PECAS_QUE_O_JEV_ESCOLHE[c]));
    criteria.nenhuma = "nenhuma dessas combina com o que a frase diz";
    questions[`peca_${i}`] = {
      type: "choice",
      instructions: `Qual animação combina melhor com o que a frase \`frases[${i}].texto\` diz? Só as opções listadas existem (foram montadas com o que foi dito).`,
      criteria,
    };
  });
  return { state: { contexto: "Editor de vídeo da agência: escolher animações na fala de um vídeo vertical.", frases: frases.map((f) => ({ texto: f.texto })) }, questions };
}

/**
 * Escolha final (código): frase com Noul >= 0,6 e peça diferente de "nenhuma";
 * das mais prováveis para as menos, respeitando o espaço da densidade
 * (poucas: uma a cada 20 s; médias: uma a cada 7 s). Volta na ordem do vídeo.
 */
export function escolherSugestoes(frases: FraseRecebida[], respostas: Record<string, RespostaJev>, densidade: "poucas" | "medias"): Sugestao[] {
  const espaco = ESPACO_POR_DENSIDADE[densidade] || ESPACO_POR_DENSIDADE.medias;
  const candidatas: (Sugestao & { t: number })[] = [];
  frases.forEach((f, i) => {
    const p = probabilidadeNoul(respostas[`pede_${i}`]);
    const escolha = respostas[`peca_${i}`] && typeof respostas[`peca_${i}`].choice === "string" ? String(respostas[`peca_${i}`].choice) : "nenhuma";
    if (p === null || p < LIMIAR_DO_NOUL || escolha === "nenhuma" || f.candidatas.indexOf(escolha) < 0) return;
    candidatas.push({ k: f.k, peca: escolha, probabilidade: Math.round(p * 1000) / 1000, t: f.inicio_s });
  });
  const ficam: (Sugestao & { t: number })[] = [];
  candidatas
    .sort((a, b) => b.probabilidade - a.probabilidade || a.t - b.t)
    .forEach((c) => {
      if (ficam.some((x) => Math.abs(x.t - c.t) < espaco)) return;
      ficam.push(c);
    });
  return ficam.sort((a, b) => a.t - b.t).map(({ k, peca, probabilidade }) => ({ k, peca, probabilidade }));
}

/** A chamada ao Jev (a função confere o acesso antes). */
export async function sugerirAnimacoes(frases: FraseRecebida[], densidade: "poucas" | "medias"): Promise<Sugestao[]> {
  if (!frases.length) return [];
  const { state, questions } = perguntasDasFrases(frases);
  const r = await jevPerguntar({ state, questions });
  return escolherSugestoes(frases, r.answers, densidade);
}
