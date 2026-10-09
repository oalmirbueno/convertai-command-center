/**
 * Para onde vai a pergunta do dono (frente CFO).
 *
 * Julgamento de linguagem natural = Jev (TypeSafe), não prompt-e-parse:
 * - `intencao` (Choice): qual pergunta de CFO é esta;
 * - `valor` (Choice entre os valores que o código achou no texto + "nenhum"):
 *   o modelo escolhe, nunca escreve o número (padrão "selecionar em vez de gerar");
 * - `recorrente` (Noul): o gasto se repete todo mês?
 * As três vão juntas, numa chamada só, sobre o mesmo estado.
 * Sem Jev (sem chave, fora do ar), a reserva são as palavras (cfo-calculos.ts).
 * Puro: quem chama faz o fetch (jevPerguntar) e passa as respostas.
 */

import { centavos, intencaoPorPalavras, parecerRecorrente, valoresNoTexto, type IntencaoDoCFO } from "./cfo-calculos.ts";

export const OPCOES_DA_INTENCAO: Record<IntencaoDoCFO, string> = {
  saude: "quer saber como está o financeiro da agência hoje: caixa, saúde, resumo geral",
  projecao: "quer a projeção dos próximos meses: quanto vai entrar, sair e sobrar",
  posso_gastar: "pergunta se pode gastar, comprar, contratar ou assinar algo (com ou sem valor)",
  onde_cortar: "quer saber onde cortar custos ou como economizar",
  este_mes: "quer saber o que fazer neste mês, o limite do mês ou o que não pode gastar",
  plano: "quer um plano de crescimento, metas ou como chegar a uma receita",
  lancar: "pede para registrar ou lançar uma despesa ou conta que já decidiu fazer",
  meta: "pede para MUDAR o valor da meta mensal de receita que já existe (substitui a atual); só quando fala da meta mensal",
  nova_meta: "pede para CRIAR uma meta nova (de economia, reserva, teste, projeto), sem mexer na meta mensal de receita",
  simular: "pede para simular um cenário (e se...) sem gravar nada",
  erros: "quer saber onde está errando nas finanças",
  outra: "outra coisa que não é nenhuma das anteriores",
};

export const LIMIAR_DA_INTENCAO = 0.45;

export type RotaDoCFO = {
  intencao: IntencaoDoCFO;
  confianca: number | null;
  valor: number | null;
  recorrente: boolean;
  fonte: "jev" | "regra";
};

/** As perguntas ao Jev para um pedido. */
export function perguntasDaRota(pedido: string) {
  const candidatos = valoresNoTexto(pedido);
  const questions: Record<string, unknown> = {
    intencao: {
      type: "choice",
      instructions: "O dono da agência fez o `pedido` ao CFO (agente financeiro). Qual é a intenção dele?",
      criteria: OPCOES_DA_INTENCAO,
    },
    recorrente: {
      type: "noul",
      instructions: "O gasto ou valor de que o `pedido` fala se repete todo mês (assinatura, mensalidade, custo fixo)?",
      criteria: { true: "repete todo mês ou é assinatura", false: "é de uma vez só, ou o pedido não fala de gasto" },
    },
  };
  if (candidatos.length > 1) {
    const criteria: Record<string, string> = { nenhum: "nenhum destes é o valor do gasto ou da meta" };
    candidatos.forEach((c, i) => { criteria[`v${i}`] = `o trecho "${c.trecho}"`; });
    questions.valor = {
      type: "choice",
      instructions: "Qual destes trechos do `pedido` é o valor do gasto, da conta ou da meta de que o dono fala?",
      criteria,
    };
  }
  return { state: { pedido: String(pedido || "").slice(0, 1500) }, questions, candidatos };
}

type Resposta = { choice?: string; confidence?: number; probabilities?: Record<string, number>; noul?: number };

/** Lê as respostas do Jev (ou nada, sem Jev) e devolve a rota. */
export function lerRota(pedido: string, respostas: Record<string, Resposta> | null): RotaDoCFO {
  const candidatos = valoresNoTexto(pedido);
  const valorSemJev = candidatos.length ? candidatos[0].valor : null;
  if (!respostas) {
    return { intencao: intencaoPorPalavras(pedido), confianca: null, valor: valorSemJev, recorrente: parecerRecorrente(pedido), fonte: "regra" };
  }
  const i = respostas.intencao;
  const escolha = i && typeof i.choice === "string" && Object.prototype.hasOwnProperty.call(OPCOES_DA_INTENCAO, i.choice) ? (i.choice as IntencaoDoCFO) : null;
  const conf = i && typeof i.confidence === "number" ? i.confidence : null;
  const intencao = escolha && (conf === null || conf >= LIMIAR_DA_INTENCAO) ? escolha : intencaoPorPalavras(pedido);
  let valor: number | null = valorSemJev;
  if (candidatos.length > 1) {
    const v = respostas.valor;
    const c = v && typeof v.choice === "string" ? v.choice : "";
    const m = /^v(\d+)$/.exec(c);
    valor = c === "nenhum" ? null : m && candidatos[Number(m[1])] ? candidatos[Number(m[1])].valor : valorSemJev;
  }
  const r = respostas.recorrente;
  const recorrente = r && typeof r.noul === "number" ? r.noul >= 0.6 : parecerRecorrente(pedido);
  return { intencao, confianca: conf, valor: valor === null ? null : centavos(valor), recorrente, fonte: "jev" };
}

/**
 * Do que é o gasto, para o lançamento ("posso gastar 1.500 num curso de edição?"
 * vira "Curso de edição"; "dá pra assinar uma ferramenta de 120 por mês?" vira
 * "Ferramenta"). Regra simples, sem IA: primeiro o objeto de assinar, comprar,
 * contratar, pagar ou investir; senão o trecho depois de num/numa/em/com/para.
 * O dono vê no cartão antes de confirmar.
 */
const PREPOSICAO_NO_COMECO = /^(por|todo|toda|ao|num|numa|nuns|numas|em|no|na|nos|nas|com|de|do|da|para|pra|mais|isso|isto|esse|essa|ele|ela)\b/i;
const FIM_DO_TRECHO = /\s+(?:(?:por|todo|ao|no|na|de)\s+m[eê]s|mensal|mensais|agora|hoje|esse m[eê]s|este m[eê]s)\b.*$/i;

function limparTrecho(t: string): string {
  return t
    .replace(FIM_DO_TRECHO, "")
    .replace(/\s+(de|do|da|por|no|na|em|com|e|ou|que)$/i, "")
    .replace(/\s+(de|do|da|por|no|na|em|com|e|ou|que)$/i, "")
    .trim();
}

export function descricaoDoGasto(pedido: string): string {
  const semValor = String(pedido || "")
    .replace(/(r\$\s*)?\d[\d.,]*\s*(mil|k)?(\s*reais)?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  const verbo = /\b(?:assinar|comprar|contratar|pagar|investir|pegar|fazer|renovar|lan[cç]ar|lan[cç]a|registrar|registra|anotar|anota)\s+(?:(?:de|do|da)\s+)?(?:umas|uma|uns|um|os|as|o|a)?\s*([^?!.,;]{3,60})/i.exec(semValor);
  if (verbo && !PREPOSICAO_NO_COMECO.test(verbo[1].trim())) {
    const t = limparTrecho(verbo[1]);
    if (t.length >= 3) return capital(t);
  }
  const prep = /\b(?:numas|numa|nuns|num|em|com|para|pra|no|na)\s+(?:umas|uma|uns|um|os|as|o|a)?\s*([^?!.,;]{3,60})/i.exec(semValor);
  if (prep && !PREPOSICAO_NO_COMECO.test(prep[1].trim())) {
    const t = limparTrecho(prep[1]).replace(/^(gastar|pagar|comprar|contratar|assinar)\s+/i, "");
    if (t.length >= 3) return capital(t);
  }
  return "Gasto pedido ao CFO";
}
