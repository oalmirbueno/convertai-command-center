/**
 * As referências de design que servem a ESTE pedido (17/10/2026). Dono: "tudo que entrar na pasta de
 * referências já entra como aprendizado para o design e ele já usa sem eu precisar pedir; quando eu quiser
 * uma específica, eu seleciono".
 *
 * Antes o diretor recebia só as 12 referências lidas mais novas, e um cliente com 100 ou mais nunca via o
 * resto. Agora entram até 40 candidatas; com mais de 10, o Jev dá a nota de quanto a técnica de cada uma
 * serve ao pedido (Score, uma chamada) e ficam as 10 melhores, sempre com até 2 artes publicadas da marca
 * (o estilo dela). Sem o Jev, ficam as 10 mais novas, como antes. A referência escolhida à mão pela equipe
 * continua indo como imagem ao gerador, por outro caminho.
 */

import type { PerguntaJev, RespostaJev } from "../../_shared/jev.ts";

export const REFERENCIAS_NO_DIRETOR = 10;
export const CANDIDATAS_DO_PEDIDO = 40;
const IDENTIDADE_SEMPRE = 2;

export type ReferenciaLida = { papel: string; leitura: string; tags: string[] | null };

const NIVEIS = [
  "Não serve para esta arte",
  "Serve pouco: só um detalhe aproveitável",
  "Serve: a técnica combina com o que a arte pede",
  "Serve muito: é a técnica certa para esta arte",
];

export function perguntasDasReferencias(total: number): Record<string, PerguntaJev> {
  const q: Record<string, PerguntaJev> = {};
  for (let i = 0; i < total; i += 1) {
    q[`r${i}`] = { type: "score", instructions: `Quanto a técnica de design descrita em \`referencias[${i}]\` serve para fazer a arte do \`pedido\`?`, criteria: NIVEIS };
  }
  return q;
}

/** Ordena pelas notas e garante as artes publicadas da marca (identidade) no começo. */
export function escolherPelasNotas<T extends ReferenciaLida>(refs: T[], respostas: Record<string, RespostaJev>): T[] {
  const nota = (i: number) => {
    const s = respostas[`r${i}`]?.score;
    return typeof s === "number" && Number.isFinite(s) ? s : -1;
  };
  const ordem = refs.map((r, i) => ({ r, i, n: nota(i) })).sort((a, b) => b.n - a.n || a.i - b.i);
  const identidade = ordem.filter((x) => x.r.papel === "identidade").slice(0, IDENTIDADE_SEMPRE);
  const resto = ordem.filter((x) => identidade.indexOf(x) < 0).slice(0, Math.max(0, REFERENCIAS_NO_DIRETOR - identidade.length));
  return [...identidade, ...resto].map((x) => x.r);
}

export async function referenciasDoPedido<T extends ReferenciaLida>(
  refs: T[],
  pedido: string,
  julgar: (state: unknown, questions: Record<string, PerguntaJev>) => Promise<Record<string, RespostaJev>>,
): Promise<T[]> {
  if (refs.length <= REFERENCIAS_NO_DIRETOR || !pedido.trim()) return refs.slice(0, REFERENCIAS_NO_DIRETOR);
  const candidatas = refs.slice(0, CANDIDATAS_DO_PEDIDO);
  try {
    const respostas = await julgar(
      { pedido: pedido.slice(0, 3000), referencias: candidatas.map((r) => ({ tecnica: r.leitura.slice(0, 600), tags: r.tags || [] })) },
      perguntasDasReferencias(candidatas.length),
    );
    return escolherPelasNotas(candidatas, respostas);
  } catch {
    return refs.slice(0, REFERENCIAS_NO_DIRETOR);
  }
}
