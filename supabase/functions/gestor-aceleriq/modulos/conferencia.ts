/**
 * Segunda barreira do Gestor: o Jev confere cada afirmação contra as fontes
 * que ela cita (padrão "citation check" da TypeSafe: Choice sustenta /
 * contradiz / não diz nada). A primeira barreira (fonte existe e estado
 * combina com a seção) é código, em ficha.ts.
 *
 * Política (explícita, ajustável aqui):
 * - "sustenta" com probabilidade >= LIMIAR_SUSTENTA: fica;
 * - "contradiz" ou "nao_diz" como resposta mais provável: sai, e a tela mostra
 *   quantas saíram e por quê;
 * - "sustenta" abaixo do limiar: fica marcado "conferência fraca" (não some,
 *   mas não passa por confirmado).
 * Sem Jev (sem chave, fora do ar): os itens ficam só com a conferência de
 * código e a resposta avisa que a conferência semântica não rodou.
 */

import type { Fonte, ItemDaResposta } from "./ficha.ts";

export const LIMIAR_SUSTENTA = 0.7;
export const MAX_CONFERIDAS = 20;

export type PerguntaDeConferencia = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};

export function perguntasDeConferencia(itens: ItemDaResposta[], fontes: Fonte[]): {
  state: { afirmacoes: Array<{ afirmacao: string; secao: string; fontes: Array<{ apelido: string; estado: string; texto: string }> }> };
  questions: Record<string, PerguntaDeConferencia>;
} {
  const porApelido = new Map(fontes.map((f) => [f.apelido.toUpperCase(), f]));
  const alvo = itens.slice(0, MAX_CONFERIDAS);
  const afirmacoes = alvo.map((i) => ({
    afirmacao: i.texto,
    secao: i.secao,
    fontes: i.fontes.map((a) => porApelido.get(a)).filter((f): f is Fonte => !!f).map((f) => ({ apelido: f.apelido, estado: f.estado, texto: f.texto.slice(0, f.tipo === "anexo" ? 6000 : 1500) })),
  }));
  const questions: Record<string, PerguntaDeConferencia> = {};
  afirmacoes.forEach((_, k) => {
    questions[`a${k}`] = {
      type: "choice",
      instructions: `Compare \`afirmacoes[${k}].afirmacao\` (escrita na seção \`afirmacoes[${k}].secao\` de um relatório ao dono da agência) com o texto das fontes em \`afirmacoes[${k}].fontes\`. As fontes contêm tudo o que pode ser afirmado. Afirmar que algo foi publicado, concluído ou entregue exige que a fonte diga isso; "em revisão", "em edição" ou "agendado" não é publicado nem concluído.`,
      criteria: {
        sustenta: "as fontes dizem a afirmação ou a implicam diretamente, inclusive estados, datas, números e nomes",
        contradiz: "as fontes dizem o contrário ou um estado diferente (ex.: a afirmação diz publicado/concluído e a fonte diz revisão, edição, bloqueio ou agendado)",
        nao_diz: "as fontes não tratam do que a afirmação diz, ou a afirmação acrescenta fato que não está nelas",
      },
    };
  });
  return { state: { afirmacoes }, questions };
}

export type RespostaChoice = { choice?: string; probabilities?: Record<string, number>; confidence?: number };

export function aplicarConferencia(
  itens: ItemDaResposta[],
  respostas: Record<string, RespostaChoice> | null,
): { ficam: ItemDaResposta[]; sairam: Array<{ item: ItemDaResposta; veredito: string }>; fracos: number } {
  if (!respostas) return { ficam: itens, sairam: [], fracos: 0 };
  const ficam: ItemDaResposta[] = [];
  const sairam: Array<{ item: ItemDaResposta; veredito: string }> = [];
  let fracos = 0;
  itens.forEach((item, k) => {
    if (k >= MAX_CONFERIDAS) { ficam.push(item); return; }
    const r = respostas[`a${k}`];
    if (!r || !r.choice) { ficam.push(item); return; }
    const ps = r.probabilities || {};
    const pSustenta = typeof ps.sustenta === "number" ? ps.sustenta : r.choice === "sustenta" ? Number(r.confidence ?? 0) : 0;
    if (r.choice !== "sustenta") { sairam.push({ item, veredito: r.choice }); return; }
    if (pSustenta >= LIMIAR_SUSTENTA) ficam.push({ ...item, conferido: "jev" });
    else { fracos++; ficam.push(item); }
  });
  return { ficam, sairam, fracos };
}
