/**
 * Pedido do cliente entendido (frente AP, 28/09).
 *
 * Pedido do dono: "quando o cliente comentar em outro formato, já tem que
 * atualizar automaticamente e entender". O que o cliente escreve na
 * aprovação (pedido de ajuste ou comentário ao aprovar) vira uma pendência
 * clara na peça do Estúdio: o tipo do pedido e, quando é troca de formato, o
 * formato pedido. Nada é gerado sozinho: a tela oferece "Aplicar" (prepara o
 * ajuste, sem gerar) e "Pedir ao diretor" (deixa o pedido pronto no campo).
 *
 * O julgamento é do Jev (TypeSafe System One): duas Choices na mesma
 * chamada, sobre o mesmo estado. O resumo que aparece na tela é montado aqui
 * pelo código a partir das escolhas (o Jev escolhe, não escreve).
 *
 * Sem import de Deno nem de npm: a função, a tela e os testes (vitest) leem
 * o mesmo arquivo. A chamada HTTP fica em _shared/jev.ts (chave só no servidor).
 */

export const TIPOS_DO_PEDIDO = [
  "troca_de_formato",
  "ajuste_de_texto",
  "troca_de_foto",
  "ajuste_visual",
  "aprovacao_com_ressalva",
  "outro",
] as const;
export type TipoDoPedido = (typeof TIPOS_DO_PEDIDO)[number];

export const FORMATOS_PEDIDOS = [
  "carrossel",
  "estatico",
  "stories",
  "reels",
  "feed_4x5",
  "quadrado",
  "retrato_3x4",
  "nenhum",
] as const;
export type FormatoPedido = (typeof FORMATOS_PEDIDOS)[number];

/** Abaixo disso a escolha do tipo não vale: a tela mostra o texto do cliente como "pedido do cliente". */
export const CONFIANCA_MINIMA = 0.45;

/** O que fica gravado no pedido (ajustes_do_cliente[i].entendido). */
export interface PedidoEntendido {
  tipo: TipoDoPedido;
  formato: FormatoPedido | null;
  confianca: number;
  resumo: string;
  em: string;
  modelo: string;
}

export interface EstadoDoPedido {
  comentario: string;
  /** "aprovado" (comentário junto da aprovação) ou "ajuste" (pedido de ajuste). */
  decisao: "aprovado" | "ajuste";
  peca: {
    formato_atual: string;
    laminas: number;
    lamina_citada: number | null;
  };
}

export function estadoDoPedido(a: { texto: string; decisao?: string | null; formatoAtual?: string | null; laminas?: number | null; lamina?: number | null }): EstadoDoPedido {
  const laminas = Math.max(1, Math.floor(Number(a.laminas) || 1));
  const formato = String(a.formatoAtual || "feed_4x5");
  const tipoDePost = laminas > 1 ? "carrossel" : "post estático (uma lâmina)";
  const proporcao = formato === "stories_9x16" ? "9:16 (stories)" : formato === "quadrado_1x1" ? "1:1 (quadrado)" : formato === "retrato_3x4" ? "3:4" : "4:5 (feed)";
  return {
    comentario: String(a.texto || "").slice(0, 1500),
    decisao: a.decisao === "aprovado" ? "aprovado" : "ajuste",
    peca: {
      formato_atual: `${tipoDePost}, ${proporcao}`,
      laminas,
      lamina_citada: typeof a.lamina === "number" && a.lamina > 0 ? a.lamina : null,
    },
  };
}

/** As duas perguntas ao Jev (mesma chamada: rodam em paralelo sobre o mesmo estado). */
export function perguntasDoPedido() {
  return {
    tipo: {
      type: "choice" as const,
      instructions:
        "O cliente de uma agência escreveu `comentario` ao decidir sobre uma arte de Instagram (`decisao`: \"aprovado\" = aprovou e comentou; \"ajuste\" = pediu ajuste). A peça hoje é `peca.formato_atual`. Qual é o pedido principal do cliente?",
      criteria: {
        troca_de_formato: {
          what: "Quer a peça em outro formato ou tipo de post: carrossel, post único, stories, reels ou vídeo, ou outra proporção (quadrado, 4:5, 9:16).",
          examples: ["prefiro em carrossel", "faz em story", "melhor como reels", "pode ser uma imagem só?"],
        },
        ajuste_de_texto: {
          what: "Quer mudar palavras, título, frase, dado, nome, telefone, legenda ou erro de escrita.",
          examples: ["troca o título por...", "o telefone está errado", "não menciona Rio Branco do Sul"],
        },
        troca_de_foto: {
          what: "Quer outra foto, imagem, pessoa ou produto na arte.",
          examples: ["usa a foto da fachada", "troca a imagem da capa", "não gostei dessa foto"],
        },
        ajuste_visual: {
          what: "Quer mudar o visual sem trocar formato, texto ou foto: cores, tamanho, alinhamento, logo, layout.",
          examples: ["as imagens precisam estar na mesma altura", "aumenta a logo", "cor mais clara"],
        },
        aprovacao_com_ressalva: {
          what: "Aprovou e só fez uma observação, elogio ou lembrete que não pede mudança na arte.",
          examples: ["ficou ótimo, só posta de manhã", "aprovado, lindo!", "ok, mas na próxima usa mais verde"],
        },
        outro: "Nenhuma das anteriores ou não dá para saber o que o cliente pede.",
      },
    },
    formato: {
      type: "choice" as const,
      instructions:
        "Supondo que o cliente pediu outro formato para a arte (`comentario`; a peça hoje é `peca.formato_atual`), qual formato ele pediu? Se ele não pediu formato, escolha nenhum.",
      criteria: {
        carrossel: "Carrossel com várias lâminas.",
        estatico: "Uma imagem só, post estático.",
        stories: "Stories (9:16).",
        reels: "Reels ou vídeo.",
        feed_4x5: "Retrato 4:5 do feed.",
        quadrado: "Quadrado 1:1.",
        retrato_3x4: "Retrato 3:4.",
        nenhum: "Não pediu formato.",
      },
    },
  };
}

const ROTULO_DO_FORMATO: Record<FormatoPedido, string> = {
  carrossel: "carrossel",
  estatico: "post único",
  stories: "stories (9:16)",
  reels: "reels",
  feed_4x5: "4:5",
  quadrado: "quadrado (1:1)",
  retrato_3x4: "3:4",
  nenhum: "",
};

export const ROTULO_DO_TIPO: Record<TipoDoPedido, string> = {
  troca_de_formato: "Troca de formato",
  ajuste_de_texto: "Ajuste de texto",
  troca_de_foto: "Troca de foto",
  ajuste_visual: "Ajuste visual",
  aprovacao_com_ressalva: "Aprovado com ressalva",
  outro: "Pedido do cliente",
};

/** Frase curta da pendência, montada pelo código a partir das escolhas. */
export function resumoDoPedido(tipo: TipoDoPedido, formato: FormatoPedido | null, lamina: number | null): string {
  const naLamina = lamina ? ` na lâmina ${lamina}` : "";
  switch (tipo) {
    case "troca_de_formato":
      return formato && formato !== "nenhum" ? `Quer em ${ROTULO_DO_FORMATO[formato]}` : "Quer outro formato";
    case "ajuste_de_texto":
      return `Ajustar o texto${naLamina}`;
    case "troca_de_foto":
      return `Trocar a foto${naLamina}`;
    case "ajuste_visual":
      return `Ajuste visual${naLamina}`;
    case "aprovacao_com_ressalva":
      return "Aprovou com uma observação";
    default:
      return "Pedido do cliente";
  }
}

type Resposta = { choice?: string; confidence?: number; probabilities?: Record<string, number> };

/** Lê as respostas do Jev e monta o entendimento. Resposta fora da lista ou fraca vira "outro". */
export function entendimentoDoPedido(
  respostas: Record<string, Resposta | undefined>,
  a: { lamina: number | null; modelo: string; agora?: Date },
): PedidoEntendido {
  const rt = respostas.tipo || {};
  const rf = respostas.formato || {};
  const confianca = typeof rt.confidence === "number" && Number.isFinite(rt.confidence) ? rt.confidence : 0;
  let tipo: TipoDoPedido = (TIPOS_DO_PEDIDO as readonly string[]).indexOf(String(rt.choice)) >= 0 ? (rt.choice as TipoDoPedido) : "outro";
  if (confianca < CONFIANCA_MINIMA) tipo = "outro";
  let formato: FormatoPedido | null = (FORMATOS_PEDIDOS as readonly string[]).indexOf(String(rf.choice)) >= 0 ? (rf.choice as FormatoPedido) : null;
  // O formato só vale quando o pedido é de formato (a pergunta foi especulativa).
  if (tipo !== "troca_de_formato" || formato === "nenhum") formato = null;
  return {
    tipo,
    formato,
    confianca: Math.round(confianca * 100) / 100,
    resumo: resumoDoPedido(tipo, formato, a.lamina),
    em: (a.agora || new Date()).toISOString(),
    modelo: String(a.modelo || "jev-latest").slice(0, 40),
  };
}

/** Proporção do Estúdio que "Aplicar" escolhe (sem gerar). Null = precisa do diretor (carrossel, post único, reels). */
export function formatoDoEstudio(f: FormatoPedido | null): "feed_4x5" | "retrato_3x4" | "quadrado_1x1" | "stories_9x16" | null {
  if (f === "stories") return "stories_9x16";
  if (f === "feed_4x5") return "feed_4x5";
  if (f === "quadrado") return "quadrado_1x1";
  if (f === "retrato_3x4") return "retrato_3x4";
  return null;
}

/** Lê o entendimento gravado (tolerante). */
export function lerEntendido(bruto: unknown): PedidoEntendido | null {
  if (!bruto || typeof bruto !== "object") return null;
  const x = bruto as Record<string, unknown>;
  if ((TIPOS_DO_PEDIDO as readonly string[]).indexOf(String(x.tipo)) < 0) return null;
  const formato = (FORMATOS_PEDIDOS as readonly string[]).indexOf(String(x.formato)) >= 0 ? (x.formato as FormatoPedido) : null;
  return {
    tipo: x.tipo as TipoDoPedido,
    formato,
    confianca: typeof x.confianca === "number" ? x.confianca : 0,
    resumo: typeof x.resumo === "string" && x.resumo ? x.resumo : resumoDoPedido(x.tipo as TipoDoPedido, formato, null),
    em: typeof x.em === "string" ? x.em : "",
    modelo: typeof x.modelo === "string" ? x.modelo : "",
  };
}
