/**
 * Quiz pelo formulário do site (Laboratório v4, nó `quiz`, 19/10/2026): o site
 * manda, junto com o contato, a pontuação, a faixa e as respostas. Aqui o
 * envio é conferido antes de ir para commercial_leads.qualificacao.quiz (o
 * banco confere de novo em site_registrar_lead).
 *
 * Formato aceito (campo opcional `quiz` do corpo):
 *   { pontuacao: number, faixa: string (até 60), respostas: { [pergunta]: resposta } (até 30 pares, cada texto até 200) }
 *
 * Puro: sem Deno, sem banco. Sem expressão regular que o Safari 11 não tem.
 */

export type QuizDoSite = { pontuacao: number; faixa: string; respostas: Record<string, string> };

export const LIMITES_DO_QUIZ = { faixa: 60, pares: 30, texto: 200, pontuacao: 1_000_000 } as const;

const umaLinha = (v: string) => v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
const temMarcacao = (s: string) => s.indexOf("<") >= 0 || s.indexOf(">") >= 0;

/**
 * Lê o quiz do corpo. Sem o campo: { quiz: null, invalido: false } (envio de
 * formulário comum, como antes). Campo presente e fora do formato:
 * { quiz: null, invalido: true } (a função responde 400 quiz_invalido).
 */
export function lerQuiz(bruto: unknown): { quiz: QuizDoSite | null; invalido: boolean } {
  if (bruto === undefined || bruto === null) return { quiz: null, invalido: false };
  const ruim = { quiz: null, invalido: true };
  if (typeof bruto !== "object" || Array.isArray(bruto)) return ruim;
  const o = bruto as Record<string, unknown>;
  const pontuacao = o.pontuacao;
  if (typeof pontuacao !== "number" || !Number.isFinite(pontuacao) || Math.abs(pontuacao) > LIMITES_DO_QUIZ.pontuacao) return ruim;
  if (typeof o.faixa !== "string") return ruim;
  const faixa = umaLinha(o.faixa);
  if (!faixa || faixa.length > LIMITES_DO_QUIZ.faixa || temMarcacao(faixa)) return ruim;
  const respostasBrutas = o.respostas === undefined ? {} : o.respostas;
  if (!respostasBrutas || typeof respostasBrutas !== "object" || Array.isArray(respostasBrutas)) return ruim;
  const pares = Object.keys(respostasBrutas as Record<string, unknown>);
  if (pares.length > LIMITES_DO_QUIZ.pares) return ruim;
  const respostas: Record<string, string> = {};
  for (const chaveBruta of pares) {
    const valor = (respostasBrutas as Record<string, unknown>)[chaveBruta];
    if (typeof valor !== "string") return ruim;
    const chave = umaLinha(chaveBruta);
    const texto = umaLinha(valor);
    if (!chave || chave.length > LIMITES_DO_QUIZ.texto || texto.length > LIMITES_DO_QUIZ.texto) return ruim;
    if (temMarcacao(chave) || temMarcacao(texto)) return ruim;
    respostas[chave] = texto;
  }
  return { quiz: { pontuacao: Math.round(pontuacao * 100) / 100, faixa, respostas }, invalido: false };
}
