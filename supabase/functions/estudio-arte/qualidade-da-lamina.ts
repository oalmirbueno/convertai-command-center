/**
 * Qualidade da lâmina, fase 2 (23/10/2026). Dono: "melhore a qualidade e a
 * inteligência do gerador, mas não quebre o que já funciona e está aprovado".
 *
 * O que a medição mostrou (381 conferências de 13 a 22/10): o leitor já
 * descreve os defeitos na descricao_visual (texto coberto por objeto, campo
 * vazio, linha atravessando a arte, tela ilegível), mas ninguém transformava
 * isso em sinal: o defeito ficava num parágrafo que só o Jev da identidade lia.
 *
 * Só acréscimos, sem mudar modelo, estilo, prompt de design nem a decisão da
 * autocorreção:
 * - REGRA_TEXTO_INTEIRO: uma linha a mais nas REGRAS FINAIS (texto inteiro,
 *   não coberto, legível no celular). Reforça o que o padrão de design já pede;
 * - LEITURA_DO_ACABAMENTO: o leitor da conferência passa a dizer, na mesma
 *   descrição, se há texto difícil de ler e rosto, mão ou logo deformados;
 * - perguntasDeAcabamento / acabamentoDaConferencia: 2 ou 3 perguntas Noul a
 *   mais na MESMA chamada do Jev da conferência. Viram aviso na versão
 *   (verificacao.acabamento), nunca uma 2ª geração: a autocorreção continua só
 *   com erro objetivo (texto, logo, elemento vazio, cópia), sem laço.
 */

export const REGRA_TEXTO_INTEIRO =
  "- Texto inteiro e legível no celular: cada palavra completa e visível, nenhuma letra cortada pela borda, partida entre linhas ou coberta por objeto, pessoa, mão ou efeito; o texto menor (apoio e CTA) com contraste forte com o fundo atrás dele.";

export const LEITURA_DO_ACABAMENTO =
  " Diga ainda, na descricao_visual, se algum texto está difícil de ler no celular (pequeno demais, com pouco contraste ou coberto por objeto, pessoa ou efeito) e se algum rosto, mão ou a logo aparece deformado.";

/** Probabilidade a partir da qual o Noul vira aviso (mais alto que o 0,5 da navegação: aviso falso cansa). */
export const LIMIAR_DO_ACABAMENTO = 0.6;

export type ChaveDoAcabamento = "acabamento_texto" | "acabamento_anatomia" | "acabamento_logo";

export interface PerguntaNoul {
  type: "noul";
  instructions: string;
  criteria: { true: string; false: string };
}

/** As perguntas do acabamento (a logo só quando a lâmina leva logo e o leitor a viu). */
export function perguntasDeAcabamento(e: { esperaLogo: boolean; logoPresente: boolean | null | undefined }): Partial<Record<ChaveDoAcabamento, PerguntaNoul>> {
  const q: Partial<Record<ChaveDoAcabamento, PerguntaNoul>> = {
    acabamento_texto: {
      type: "noul",
      instructions: "Pela descrição em `arte_gerada.descricao_visual`, algum texto da arte fica difícil de ler no celular: cortado pela borda, partido, coberto por objeto, pessoa ou efeito, pequeno demais ou com pouco contraste com o fundo?",
      criteria: {
        true: "Sim: a descrição aponta texto cortado, coberto, pequeno demais ou com pouco contraste.",
        false: "Não: a descrição não aponta problema de leitura no texto da arte (texto desfocado de propósito numa tela ou documento do cenário não conta).",
      },
    },
    acabamento_anatomia: {
      type: "noul",
      instructions: "Pela descrição em `arte_gerada.descricao_visual`, algum rosto, mão ou corpo aparece deformado (dedos a mais ou a menos, membro torto, rosto distorcido)?",
      criteria: {
        true: "Sim: a descrição aponta rosto, mão ou corpo deformado.",
        false: "Não: a descrição não aponta deformação em pessoas, ou a arte não tem pessoas.",
      },
    },
  };
  if (e.esperaLogo && e.logoPresente === true) {
    q.acabamento_logo = {
      type: "noul",
      instructions: "Pela descrição em `arte_gerada.descricao_visual`, a logo da marca aparece deformada, cortada, com letras erradas ou ilegível?",
      criteria: {
        true: "Sim: a descrição aponta a logo deformada, cortada, com letras erradas ou ilegível.",
        false: "Não: a descrição não aponta defeito na logo.",
      },
    };
  }
  return q;
}

export interface AchadoDoAcabamento {
  probabilidade: number | null;
  achou: boolean | null;
}

export interface AcabamentoDaConferencia {
  texto: AchadoDoAcabamento;
  anatomia: AchadoDoAcabamento;
  logo?: AchadoDoAcabamento;
  avisos: string[];
}

const AVISO: Record<ChaveDoAcabamento, string> = {
  acabamento_texto: "Algum texto pode estar difícil de ler no celular (cortado, coberto ou com pouco contraste). Confira antes de entregar.",
  acabamento_anatomia: "Algum rosto, mão ou corpo pode ter saído deformado. Confira antes de entregar.",
  acabamento_logo: "A logo pode ter saído deformada ou com letras erradas. Confira antes de entregar.",
};

/** As respostas do Jev viram achados e avisos; sem resposta, null (nunca aviso inventado). */
export function acabamentoDaConferencia(
  respostas: Record<string, unknown>,
  probabilidade: (r: unknown) => number | null,
  perguntadas: Partial<Record<ChaveDoAcabamento, unknown>>,
): AcabamentoDaConferencia {
  const achado = (k: ChaveDoAcabamento): AchadoDoAcabamento => {
    const p = probabilidade(respostas[k]);
    return { probabilidade: p == null ? null : Math.round(p * 100) / 100, achou: p == null ? null : p >= LIMIAR_DO_ACABAMENTO };
  };
  const r: AcabamentoDaConferencia = { texto: achado("acabamento_texto"), anatomia: achado("acabamento_anatomia"), avisos: [] };
  if (perguntadas.acabamento_logo) r.logo = achado("acabamento_logo");
  if (r.texto.achou) r.avisos.push(AVISO.acabamento_texto);
  if (r.anatomia.achou) r.avisos.push(AVISO.acabamento_anatomia);
  if (r.logo && r.logo.achou) r.avisos.push(AVISO.acabamento_logo);
  return r;
}
