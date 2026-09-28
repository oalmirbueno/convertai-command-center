/**
 * Navegação do carrossel (frente AG, pedido do dono em 28/09): no carrossel do
 * Estúdio, a capa e as lâminas do meio têm o indicador "arraste para o lado"
 * na base; a última lâmina tem a fileira de ícones do Instagram (curtir,
 * comentar, enviar, salvar) como chamada de engajamento. Mesmo desenho em
 * todas, na cor e na fonte da marca, discreto, sem cobrir o texto nem a foto.
 *
 * Correção do dono (28/09): "não quero que faça nada por cima, e sim pelo
 * gerador". Então nada é desenhado pelo código: a regra entra no prompt que
 * vai para o gerador de imagem (no fim da base da lâmina, em gerarCard, sem
 * mexer byte a byte no prompt de sempre de promptDaLamina e do replicar), com posição, tamanho e cor concretos e iguais
 * em todas as lâminas, e a conferência (Noul do Jev) só AVISA quando o
 * indicador ou os ícones não vieram. Sem laço de correção.
 *
 * Só carrossel orgânico: nada em arte única, story ou reel (9:16) nem no
 * criativo de anúncio (Mesa Ads).
 *
 * Módulo puro (sem Deno, sem banco, sem IA); sem lookbehind, \p{} ou grupo
 * nomeado em regex.
 */

export type NavegacaoDaLamina = "arrastar" | "icones";

/** O texto do indicador, igual em todas as lâminas. */
export const TEXTO_DO_INDICADOR = "Arraste para o lado";

export interface QuadroDaNavegacao {
  largura: number;
  altura: number;
}

/**
 * Que navegação a lâmina leva: "arrastar" na capa e no meio, "icones" na
 * última, null fora do carrossel orgânico (arte única, story ou reel 9:16,
 * criativo de anúncio).
 */
export function navegacaoDaLamina(e: { ordem: number; total: number; anuncio?: boolean; post?: string | null }): NavegacaoDaLamina | null {
  if (e.anuncio) return null;
  if (!(e.total > 1)) return null;
  if (e.post === "stories_9x16") return null;
  return e.ordem >= e.total ? "icones" : "arrastar";
}

/** Margem de baixo em percentual do quadro (a mesma do grid do post). */
function baseEmPx(quadro: QuadroDaNavegacao, margemBasePct: number): number {
  return Math.round((margemBasePct / 100) * quadro.altura);
}

/**
 * O bloco do prompt da navegação, concreto e igual em todas as lâminas do
 * mesmo tipo: lugar, tamanho relativo, cor e fonte. `cor`: a cor da marca
 * (a do texto, discreta); `fonte`: a fonte do texto da marca.
 */
export function blocoDaNavegacao(
  tipo: NavegacaoDaLamina | null,
  e: { quadro: QuadroDaNavegacao; margemBasePct: number; margemLateralPct: number; cor?: string | null; corSobreEscuro?: string | null; fonte?: string | null },
): string {
  if (!tipo) return "";
  const q = e.quadro;
  const base = baseEmPx(q, e.margemBasePct);
  const lado = Math.round((e.margemLateralPct / 100) * q.largura);
  const escuro = e.corSobreEscuro && e.corSobreEscuro !== e.cor ? ` (sobre base escura, ${e.corSobreEscuro})` : "";
  const cor = `${e.cor ? `a cor ${e.cor} da marca` : "a cor do texto da marca"}${escuro}`;
  // A regra PROIBIDO do prompt diz "nenhum texto além do texto exato": esta é a exceção declarada.
  const excecao = tipo === "arrastar"
    ? "- Este indicador é a única exceção à regra de nenhum texto além do texto exato."
    : "- Estes ícones são a única exceção à regra de nenhum ícone ou elemento solto; nenhum texto junto deles.";
  const fonte = e.fonte ? `fonte ${e.fonte}, peso regular` : "a fonte do texto da marca, peso regular";
  const discreto = "Sem caixa, faixa, fundo, sombra, contorno ou brilho; discreto, menor que o texto de apoio.";
  const letra = Math.round(q.altura * 0.02);
  if (tipo === "arrastar") {
    return [
      "NAVEGAÇÃO DO CARROSSEL (mesmo desenho na capa e em todas as lâminas do meio)",
      `- Desenhe o indicador de arrastar: o texto "${TEXTO_DO_INDICADOR}" seguido de uma seta fina apontando para a direita, numa linha só, no canto inferior direito, alinhado à margem direita (${lado} px da borda) e com a base a ${base} px da borda de baixo, logo acima da margem de segurança.`,
      `- Tamanho: letras de cerca de ${letra} px de altura numa arte de ${q.largura} x ${q.altura} (2% da altura do quadro); a seta tem a altura das letras e o conjunto ocupa no máximo 30% da largura.`,
      `- Cor e fonte: ${cor}, ${fonte}; a seta no mesmo traço e na mesma cor. ${discreto}`,
      "- Nunca sobre o texto da lâmina, a logo, um rosto ou o produto da foto real: se o canto inferior direito estiver ocupado, use o canto inferior esquerdo, no mesmo tamanho e na mesma altura.",
      excecao,
    ].join("\n");
  }
  const icone = Math.round(q.altura * 0.035);
  const espaco = Math.round(q.largura * 0.03);
  return [
    "NAVEGAÇÃO DO CARROSSEL (última lâmina, chamada de engajamento)",
    "- Desenhe a fileira de ícones do Instagram, da esquerda para a direita: coração (curtir), balão de conversa (comentar), avião de papel (enviar) e marcador de página (salvar). Traço fino, só o contorno, no desenho simples dos ícones do Instagram.",
    `- Lugar: centralizada na largura, com a base dos ícones a ${base} px da borda de baixo, logo acima da margem de segurança.`,
    `- Tamanho: cada ícone com cerca de ${icone} px de altura numa arte de ${q.largura} x ${q.altura} (3,5% da altura do quadro), ${espaco} px entre eles; a fileira ocupa cerca de 25% da largura.`,
    `- Cor: ${cor}, a mesma nos quatro ícones. Sem texto junto, sem logo do Instagram. ${discreto}`,
    `- Nesta lâmina não há indicador de arrastar.`,
    "- Nunca sobre o texto, a logo, um rosto ou o produto da foto real: se a base central estiver ocupada, a fileira vai no canto inferior direito, no mesmo tamanho e na mesma altura.",
    excecao,
  ].join("\n");
}

/**
 * Área da navegação para a máscara (fração do quadro): a faixa de baixo,
 * entre as margens laterais, acima da margem de segurança (com metade dela de
 * folga). Na lâmina com foto real, o gerador só desenha dentro das áreas
 * abertas; sem esta, o indicador voltaria apagado pelos pixels originais.
 */
export function areaDaNavegacao(margemBasePct: number, margemLateralPct: number): { x0: number; y0: number; x1: number; y1: number } {
  const y1 = Math.min(1, (100 - margemBasePct / 2) / 100);
  return {
    x0: Math.max(0, margemLateralPct / 100),
    x1: Math.min(1, 1 - margemLateralPct / 100),
    y0: Math.max(0, (100 - margemBasePct - 7) / 100),
    y1,
  };
}

/**
 * O texto lido sem o indicador de arrastar (a conferência compara o texto
 * exato com o lido: sem isto, "Arraste para o lado" virava "sobrando" e a
 * correção automática apagava o indicador).
 */
export function semTextoDaNavegacao(lido: string | null | undefined): string {
  return String(lido || "")
    .replace(/arraste\s+para\s+o\s+lado\s*[→>»➔➜➝➞⟶-]*/gi, " ")
    .replace(/(^|\n)\s*arraste\s*[→>»➔➜➝➞⟶-]*\s*(?=\n|$)/gi, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Pergunta Noul do Jev: o indicador ou os ícones vieram? (só aviso). `state.arte_gerada`: descricao_visual e texto_lido. */
export function perguntaDaNavegacao(tipo: NavegacaoDaLamina): { type: "noul"; instructions: string; criteria: { true: string; false: string } } {
  if (tipo === "arrastar") {
    return {
      type: "noul",
      instructions: "A arte descrita em `arte_gerada` (descrição visual e texto lido) mostra perto da base um indicador de arrastar para o lado, como o texto \"Arraste para o lado\" ou uma seta para a direita?",
      criteria: {
        true: "Aparece o texto de arrastar ou uma seta para a direita perto da base da arte.",
        false: "Não aparece nenhum indicador de arrastar nem seta para a direita.",
      },
    };
  }
  return {
    type: "noul",
    instructions: "A arte descrita em `arte_gerada` (descrição visual e texto lido) mostra uma fileira de ícones de curtir (coração), comentar (balão), enviar (avião de papel) e salvar (marcador), como os do Instagram?",
    criteria: {
      true: "Aparece a fileira de ícones de engajamento (coração, balão, avião, marcador), mesmo que falte um deles.",
      false: "Não aparece a fileira de ícones de engajamento.",
    },
  };
}

/** O aviso da conferência da navegação (ou null quando veio). Nunca dispara correção. */
export function avisoDaNavegacao(tipo: NavegacaoDaLamina, probabilidade: number | null): string | null {
  if (probabilidade == null || probabilidade >= 0.5) return null;
  return tipo === "arrastar"
    ? `O indicador "${TEXTO_DO_INDICADOR}" não apareceu na base desta lâmina. Confira; se precisar, peça no ajuste.`
    : "A fileira de ícones (curtir, comentar, enviar, salvar) não apareceu na última lâmina. Confira; se precisar, peça no ajuste.";
}
