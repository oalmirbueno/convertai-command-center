/**
 * Clones: expressão fiel (pedido do dono, 26/09: na variação "Close sorrindo",
 * "meu sorriso está bem diferente do da referência"). Regras puras (sem rede,
 * sem banco, sem Deno): clones.ts usa e o teste do painel importa.
 *
 * O clone leva como identidade a folha aprovada (rosto neutro) e as fotos
 * reais de origem. Quando o pedido é sorriso, o gerador INVENTAVA o sorriso
 * (dentes, gengiva, boca, covinhas, olhos que fecham) e a pessoa mudava.
 * Agora:
 * 1. O pedido de sorriso é detectado no código por uma lista de termos
 *    (sorrindo, rindo, sorriso, feliz, gargalhada...). Termo ambíguo
 *    (simpática, alegre, espontânea...) vai ao Jev (um Noul) só para
 *    desambiguar.
 * 2. Entre as fotos reais de origem do clone e as fotos de expressão
 *    guardadas nele, as que mostram a pessoa sorrindo saem pela leitura já
 *    guardada (etiqueta expressao:*, descrição do "Ler foto", leitura do
 *    diretor); sem leitura, uma leitura barata por visão, uma vez, guardada
 *    como etiqueta. Vão 1 ou 2 como "sorriso real desta pessoa".
 * 3. A equipe pode mandar a foto da expressão na hora (1 ou 2) e guardar no
 *    clone (etiqueta clone_expressao:<clone>, com a mesma autorização).
 * 4. O prompt reforça a ordem "identidade do rosto > expressão pedida >
 *    resto" e que a expressão é a da pessoa real. Sem foto sorrindo: aviso e
 *    "sorriso natural e contido, sem inventar dentes perfeitos".
 * Sem pedido de expressão (nem foto enviada): prompt e entradas iguais a antes.
 */

import { ErroDeRegra, UUID } from "./calculos.ts";
import type { PedidoDeVariacao } from "./clones-regras.ts";

/** Fotos de expressão que vão numa variação (enviadas na hora e escolhidas pela leitura). */
export const MAX_FOTOS_DE_EXPRESSAO = 2;
/** Fotos de expressão guardadas por clone. */
export const MAX_FOTOS_DE_EXPRESSAO_GUARDADAS = 4;
/** Leituras baratas por variação (as fotos sem leitura; cada uma é lida uma vez só). */
export const MAX_LEITURAS_DE_EXPRESSAO = 6;
/**
 * O pedido ao gerador fica abaixo de 30 MB (o provedor recusa acima disso).
 * As imagens vão em base64 (4/3 do arquivo): 24 MB de base64 deixam folga
 * para o prompt e o JSON, o mesmo teto do motor (ia-motor corta do fim o que
 * passar). A expressão só entra se tudo couber: nunca empurra a logo ou o
 * estilo para fora. Cada imagem já sai com até ~2 MB de baixarReduzida.
 */
export const LIMITE_DO_PEDIDO = 30 * 1024 * 1024;
export const LIMITE_BASE64_DAS_IMAGENS = 24 * 1024 * 1024;
export const emBase64 = (bytes: number) => Math.ceil(Math.max(0, bytes) / 3) * 4;
/** Lado da leitura barata (a boca aparece bem; a cópia leve já serve). */
export const LADO_DA_LEITURA_DE_EXPRESSAO = 768;

export const PREFIXO_DA_EXPRESSAO = "expressao:";
export const tagDaExpressaoDoClone = (cloneId: string) => `clone_expressao:${cloneId}`;
/** Etiqueta da variação que saiu com a expressão real da pessoa. */
export const TAG_EXPRESSAO_REAL = "expressao_real";

export type IntensidadeDoSorriso = "leve" | "aberto" | "riso";

export type PedidoDeExpressao = {
  tipo: "sorriso" | "outra";
  /** null = sorriso natural, sem intensidade pedida. */
  intensidade: IntensidadeDoSorriso | null;
  /** O que a equipe pediu (para o prompt). */
  texto: string;
  origem: "termo" | "jev" | "foto_enviada";
};

/** Leitura da expressão de uma foto real (etiqueta expressao:<valor>). */
export const LEITURAS_DE_EXPRESSAO = ["sorriso_aberto", "sorriso_leve", "riso", "sorriso", "neutra", "outra", "sem_rosto"] as const;
export type LeituraDaExpressao = typeof LEITURAS_DE_EXPRESSAO[number];
const SORRISOS: LeituraDaExpressao[] = ["sorriso_aberto", "sorriso_leve", "riso", "sorriso"];
export const mostraSorriso = (l: LeituraDaExpressao | null | undefined) => !!l && SORRISOS.indexOf(l) >= 0;

// ------------------------------------------------------------------ termos

/** Minúsculas e sem acento (os termos são comparados assim). */
export const semAcento = (s: unknown): string => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** "sem sorrir", "não sorri", "nada de sorriso", "sem rir": o sorriso negado sai do texto antes de procurar. */
const SORRISO_NEGADO = /\b(?:sem|nao|nada de|nunca)\s+(?:(?:um|uma|o|a|nenhum)\s+)?(?:sorri\w*|rir|rindo|risad\w*|gargalhad\w*|smil\w*)/g;
/** A mesma, sem o /g (test com /g guarda a posição entre chamadas). */
const TEM_SORRISO_NEGADO = new RegExp(SORRISO_NEGADO.source);
const RISO = /\b(?:rindo|risad\w*|gargalhad\w*|gargalhando|riso|rir|laugh\w*)\b/;
const SORRISO = /\b(?:sorri\w*|sorrisinho|sorrisao|feliz\w*|smil\w*|grin(?:s|ning)?|happy)\b/;
const ABERTO = /\b(?:sorriso (?:aberto|largo|amplo|grande|radiante|com (?:os )?dentes)|sorrisao|mostrando (?:os )?dentes|dentes a mostra|big smile|wide smile|toothy)\b/;
const LEVE = /\b(?:meio sorriso|leve sorriso|pequeno sorriso|sorrisinho|sorriso (?:leve|discreto|contido|sutil|suave|timido|de canto|de lado|fechado|de boca fechada)|sem mostrar (?:os )?dentes|boca fechada|labios fechados|slight smile|soft smile|subtle smile)\b/;
/** Pedem sorriso ou não conforme o contexto: o Jev desambigua. */
const AMBIGUO = /\b(?:simpatic\w*|alegr\w*|contente\w*|animad[oa]s?|radiante|descontraid[oa]s?|acolhedor\w*|amigave\w*|receptiv[oa]s?|espontane[oa]s?|bem[- ]humorad[oa]s?|bom humor|cheerful|friendly|joyful)\b/;
/** Na leitura de uma foto: rosto sem sorriso. */
const NEUTRA = /\b(?:neutr[oa]|seri[oa]|sisud[oa]|sem sorri\w*|nao sorri\w*|boca fechada e relaxada|olhar serio|compenetrad[oa]|concentrad[oa]|pensativ[oa])\b/;

function intensidadeDo(t: string): IntensidadeDoSorriso | null {
  if (RISO.test(t)) return "riso";
  if (ABERTO.test(t)) return "aberto";
  if (LEVE.test(t)) return "leve";
  return null;
}

/**
 * Pedido de expressão da variação (expressão, pose e pedido livre; roupa,
 * cenário e luz não contam). `sorriso` quando há termo claro não negado;
 * `ambiguo` quando só há termo que depende do contexto (o Jev decide).
 */
export function detectarPedidoDeExpressao(p: Pick<PedidoDeVariacao, "expressao" | "pose" | "livre">): { sorriso: PedidoDeExpressao | null; ambiguo: boolean; texto: string } {
  const bruto = [p.expressao, p.pose, p.livre].map((x) => String(x ?? "").trim()).filter(Boolean).join("; ");
  const texto = String(p.expressao ?? "").trim() || bruto;
  const t = semAcento(bruto).replace(SORRISO_NEGADO, " ");
  if (SORRISO.test(t) || RISO.test(t)) {
    return { sorriso: { tipo: "sorriso", intensidade: intensidadeDo(t), texto: texto.slice(0, 200), origem: "termo" }, ambiguo: false, texto };
  }
  return { sorriso: null, ambiguo: AMBIGUO.test(t), texto };
}

/** Pergunta ao Jev só quando o pedido é ambíguo (um Noul: a pessoa deve aparecer sorrindo?). */
export function perguntaDoSorriso(p: Pick<PedidoDeVariacao, "expressao" | "pose" | "livre">) {
  return {
    state: { pedido: { expressao: p.expressao || "", pose: p.pose || "", pedido_livre: (p.livre || "").slice(0, 600) } },
    questions: {
      sorriso: {
        type: "noul" as const,
        instructions: "O pedido em `pedido` descreve a expressão de uma pessoa real numa foto nova. A pessoa deve aparecer com um sorriso visível na boca?",
        criteria: {
          true: "Sim: a expressão pedida implica sorriso visível, leve ou aberto (ex.: simpática sorrindo para quem vê, alegre).",
          false: "Não: a expressão pode sair com a boca neutra, séria ou só com o olhar (ex.: confiante, concentrada, falando).",
        },
      },
    },
  };
}

/** Resposta do Jev para o pedido ambíguo: sorriso leve (na dúvida, não inventa sorriso aberto). */
export function sorrisoPeloJev(probabilidade: number | null, texto: string, limiar = 0.5): PedidoDeExpressao | null {
  if (probabilidade == null || !(probabilidade >= limiar)) return null;
  return { tipo: "sorriso", intensidade: "leve", texto: texto.slice(0, 200), origem: "jev" };
}

// ------------------------------------------------------------------ leitura das fotos

/** Etiqueta expressao:<valor> já guardada na foto. */
export function expressaoDasTags(tags: string[] | null | undefined): LeituraDaExpressao | null {
  for (const t of tags ?? []) {
    const s = String(t);
    if (s.indexOf(PREFIXO_DA_EXPRESSAO) !== 0) continue;
    const v = s.slice(PREFIXO_DA_EXPRESSAO.length) as LeituraDaExpressao;
    if ((LEITURAS_DE_EXPRESSAO as readonly string[]).indexOf(v) >= 0) return v;
  }
  return null;
}

/**
 * Expressão pela leitura em texto já guardada (descrição do "Ler foto",
 * observações e a leitura do diretor). null quando o texto não fala da
 * expressão: aí a foto passa pela leitura barata.
 */
export function expressaoPelaLeitura(...textos: unknown[]): LeituraDaExpressao | null {
  const original = semAcento(textos.map((x) => (Array.isArray(x) ? x.join("; ") : String(x ?? ""))).join("; "));
  if (!original.trim()) return null;
  const t = original.replace(SORRISO_NEGADO, " ");
  if (SORRISO.test(t) || RISO.test(t)) {
    const i = intensidadeDo(t);
    return i === "riso" ? "riso" : i === "aberto" ? "sorriso_aberto" : i === "leve" ? "sorriso_leve" : /\bdentes\b/.test(t) ? "sorriso_aberto" : "sorriso";
  }
  if (NEUTRA.test(original) || TEM_SORRISO_NEGADO.test(original)) return "neutra";
  return null;
}

/** Leitura barata vinda do leitor por visão, só com os valores conhecidos. */
export function normalizarLeituraDeExpressao(bruto: unknown): LeituraDaExpressao | null {
  const r = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const v = String(r.expressao ?? "") as LeituraDaExpressao;
  if ((LEITURAS_DE_EXPRESSAO as readonly string[]).indexOf(v) < 0) return null;
  // Sorriso com a boca escondida ou borrada não serve de referência: é como se não tivesse rosto.
  if (mostraSorriso(v) && r.boca_visivel === false) return "sem_rosto";
  return v;
}

/** Tags da foto com a leitura da expressão (troca a anterior; cabe no limite de 30). */
export function tagsComExpressao(tags: string[] | null | undefined, valor: LeituraDaExpressao, max = 30): string[] {
  const outras = (tags ?? []).filter((t) => String(t).indexOf(PREFIXO_DA_EXPRESSAO) !== 0);
  return outras.slice(0, Math.max(0, max - 1)).concat([`${PREFIXO_DA_EXPRESSAO}${valor}`]);
}

/** Tags da foto guardada (ou tirada) como foto de expressão do clone. */
export function tagsDaFotoDeExpressao(tags: string[] | null | undefined, cloneId: string, guardar: boolean, max = 30): string[] {
  const tag = tagDaExpressaoDoClone(cloneId);
  const outras = (tags ?? []).filter((t) => t !== tag);
  return guardar ? outras.slice(0, Math.max(0, max - 1)).concat([tag]) : outras;
}

export const ESQUEMA_LEITURA_DE_EXPRESSAO = {
  nome: "expressao_da_foto",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["expressao", "boca_visivel"],
    properties: {
      expressao: { type: "string", enum: ["sorriso_aberto", "sorriso_leve", "riso", "neutra", "outra", "sem_rosto"] },
      boca_visivel: { type: "boolean" },
    },
  },
};

export const SISTEMA_LEITURA_DE_EXPRESSAO = `Você lê só a expressão do rosto numa foto real de uma pessoa (com autorização de uso de imagem). Não identifique a pessoa e não diga quem ela é.
- expressao: sorriso_aberto (sorriso mostrando os dentes), sorriso_leve (sorriso de boca fechada ou quase fechada), riso (rindo, gargalhada), neutra (boca relaxada ou séria, sem sorriso), outra (surpresa, falando, careta), sem_rosto (rosto pequeno demais, de costas, coberto ou fora de foco).
- boca_visivel: true quando a boca aparece nítida o bastante para ver o formato dos lábios e dos dentes.
Responda só com o JSON pedido.`;

// ------------------------------------------------------------------ escolher as fotos

export type CandidataDaExpressao = {
  id: string;
  /** enviada: a equipe mandou nesta variação; guardada: foto de expressão do clone; origem: foto real de origem. */
  origem: "enviada" | "guardada" | "origem";
  principal?: boolean;
  leitura: LeituraDaExpressao | null;
};

const PREFERENCIA: Record<string, LeituraDaExpressao[]> = {
  aberto: ["sorriso_aberto", "sorriso", "riso", "sorriso_leve"],
  leve: ["sorriso_leve", "sorriso", "sorriso_aberto", "riso"],
  riso: ["riso", "sorriso_aberto", "sorriso", "sorriso_leve"],
  natural: ["sorriso", "sorriso_aberto", "sorriso_leve", "riso"],
};

/** Fotos que ainda não têm leitura (as enviadas pela equipe não precisam). */
export const semLeitura = (lista: CandidataDaExpressao[], max = MAX_LEITURAS_DE_EXPRESSAO) => lista.filter((c) => c.origem !== "enviada" && c.leitura == null).slice(0, Math.max(0, max));

/**
 * As fotos da expressão desta variação, em ordem, até 2: primeiro as que a
 * equipe mandou (valem como estão); no sorriso, depois as que mostram a
 * pessoa sorrindo, na intensidade mais perto da pedida, as guardadas no
 * clone antes das de origem e a principal antes das outras.
 */
export function escolherFotosDaExpressao(p: PedidoDeExpressao, candidatas: CandidataDaExpressao[], max = MAX_FOTOS_DE_EXPRESSAO): string[] {
  const saida: string[] = [];
  const somar = (id: string) => {
    if (saida.length < max && saida.indexOf(id) < 0) saida.push(id);
  };
  candidatas.filter((c) => c.origem === "enviada").forEach((c) => somar(c.id));
  if (p.tipo !== "sorriso") return saida;
  const ordem = PREFERENCIA[p.intensidade ?? "natural"];
  const posicao = (c: CandidataDaExpressao) => ordem.indexOf(c.leitura as LeituraDaExpressao);
  candidatas
    .map((c, i) => ({ c, i }))
    .filter((x) => x.c.origem !== "enviada" && mostraSorriso(x.c.leitura))
    .sort((a, b) =>
      posicao(a.c) - posicao(b.c) ||
      (a.c.origem === "guardada" ? 0 : 1) - (b.c.origem === "guardada" ? 0 : 1) ||
      (a.c.principal ? 0 : 1) - (b.c.principal ? 0 : 1) ||
      a.i - b.i
    )
    .forEach((x) => somar(x.c.id));
  return saida;
}

/** Ids das fotos de expressão mandadas na hora: até 2, únicos. */
export function lerFotosDaExpressao(v: unknown): string[] {
  if (v == null || v === "") return [];
  if (!Array.isArray(v)) throw new ErroDeRegra(400, "fotos_da_expressao_invalidas", "expressao_ref_ids precisa ser uma lista.");
  const ids = Array.from(new Set(v.map((x) => String(x ?? "").trim()).filter(Boolean)));
  const ruins = ids.filter((id) => !UUID.test(id));
  if (ruins.length) throw new ErroDeRegra(400, "fotos_da_expressao_invalidas", "Foto da expressão inválida.");
  if (ids.length > MAX_FOTOS_DE_EXPRESSAO) throw new ErroDeRegra(400, "fotos_da_expressao_demais", `No máximo ${MAX_FOTOS_DE_EXPRESSAO} fotos de referência da expressão.`);
  return ids;
}

// ------------------------------------------------------------------ envio (lugares e bytes)

/**
 * Lugares reservados para as fotos da expressão na identidade (o limite de
 * imagens é o mesmo de hoje): as que já vão como identidade (a foto real
 * principal) não ocupam lugar novo.
 */
export function vagasDaExpressao(escolhidas: string[], jaNaIdentidade: string[]): number {
  return escolhidas.filter((id) => jaNaIdentidade.indexOf(id) < 0).length;
}

/**
 * Quantas fotos da expressão cabem no envio sem passar do teto (conta em
 * base64, como vai ao provedor). As imagens que já iam (identidade, estilo e
 * logo) contam primeiro: a expressão nunca tira nada do que ia antes.
 */
export function quantasCabem(bytesDasOutras: number[], bytesDaExpressao: number[], limiteBase64 = LIMITE_BASE64_DAS_IMAGENS, max = MAX_FOTOS_DE_EXPRESSAO): number {
  let total = bytesDasOutras.reduce((s, b) => s + emBase64(b), 0);
  let n = 0;
  for (const b of bytesDaExpressao.slice(0, max)) {
    if (total + emBase64(b) > limiteBase64) break;
    total += emBase64(b);
    n++;
  }
  return n;
}

/**
 * Posições das imagens no envio: identidade, expressão (as novas), estilo e
 * logo. Sem expressão, igual a antes (estilo logo depois da identidade).
 */
export function ordemDoEnvio(e: { identidade: number; expressao: number; estilo: number; logo: boolean }) {
  const inicioDaExpressao = e.identidade + 1;
  const inicioDoEstilo = e.identidade + e.expressao + 1;
  const total = e.identidade + e.expressao + e.estilo + (e.logo ? 1 : 0);
  return { inicioDaExpressao, inicioDoEstilo, indiceDaLogo: e.logo ? total : null, total };
}

// ------------------------------------------------------------------ prompt

export type ImagemDaExpressaoNoPrompt = { indice: number; ja_anexada: boolean };
export type BlocoDaExpressao = { legendas: string[]; instrucoes: string[] };

const COPIAR_SORRISO = "copie o formato da boca, os dentes, a gengiva, as covinhas e como os olhos fecham ao sorrir; não copie roupa, fundo, luz.";
const COPIAR_EXPRESSAO = "copie como a boca, os olhos, as sobrancelhas e as bochechas desta pessoa ficam nesta expressão; não copie roupa, fundo, luz.";

const INTENSIDADE_EM_PALAVRAS: Record<IntensidadeDoSorriso, string> = {
  leve: "aqui o sorriso é leve (meio sorriso), com a mesma boca",
  aberto: "aqui o sorriso é aberto, com os dentes que ela tem",
  riso: "aqui é uma risada natural, com os dentes e os olhos como os dela",
};

/**
 * O que a expressão acrescenta ao prompt da variação: a legenda de cada
 * foto da expressão (Imagem N) e as instruções (ordem de prioridade e a
 * expressão da pessoa real). Nulo quando não há pedido de expressão.
 */
export function blocoDaExpressao(p: PedidoDeExpressao | null, imagens: ImagemDaExpressaoNoPrompt[]): BlocoDaExpressao | null {
  if (!p) return null;
  const sorriso = p.tipo === "sorriso";
  const legendas = imagens.map((i) =>
    i.ja_anexada
      ? `Imagem ${i.indice} (a mesma foto real acima) também é o ${sorriso ? "SORRISO REAL DESTA PESSOA" : "EXPRESSÃO REAL DESTA PESSOA"}: ${sorriso ? COPIAR_SORRISO : COPIAR_EXPRESSAO}`
      : `Imagem ${i.indice}: ${sorriso ? "SORRISO REAL DESTA PESSOA" : "EXPRESSÃO REAL DESTA PESSOA"}: ${sorriso ? COPIAR_SORRISO : COPIAR_EXPRESSAO}`
  );
  const pedida = p.texto ? `(${p.texto})` : "";
  const instrucoes = [
    `ORDEM DE PRIORIDADE: 1) a identidade do rosto (fotos reais e folha aprovada); 2) a expressão pedida ${pedida}, que é a desta pessoa real; 3) o resto (roupa, cenário, pose e luz).`.replace(/\s+,/g, ",").replace(/\s{2,}/g, " "),
  ];
  const lista = imagens.map((i) => i.indice).join(" e ");
  if (sorriso && imagens.length) {
    instrucoes.push(
      `EXPRESSÃO: é o sorriso REAL desta pessoa, nunca um sorriso genérico: das imagens ${lista}, copie o formato da boca, os dentes (forma, tamanho, alinhamento e cor naturais), quanto de gengiva aparece, as covinhas e como os olhos se fecham ao sorrir${p.intensidade ? `; ${INTENSIDADE_EM_PALAVRAS[p.intensidade]}` : ""}. O sorriso não muda o formato do rosto, do nariz nem dos olhos.`,
    );
  } else if (sorriso) {
    instrucoes.push(
      "EXPRESSÃO: sorriso natural e contido, sem inventar dentes perfeitos (nada de dentes muito brancos, retos ou grandes; na dúvida, lábios quase fechados). É o sorriso desta pessoa, não um sorriso genérico; o sorriso não muda o formato do rosto, do nariz nem dos olhos.",
    );
  } else if (imagens.length) {
    instrucoes.push(`EXPRESSÃO: é a expressão REAL desta pessoa, como nas imagens ${lista}, nunca uma expressão genérica. A expressão não muda o formato do rosto, do nariz nem dos olhos.`);
  }
  return { legendas, instrucoes };
}

/** Aviso curto quando o sorriso sai sem foto real sorrindo. */
export const AVISO_SEM_FOTO_SORRINDO = "Envie uma foto sua sorrindo para o sorriso sair fiel.";
