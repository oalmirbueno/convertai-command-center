/**
 * mesa-identidade: coerência da marca (frente IDR, 30/09/2026).
 *
 * - coerencia_conferir { projeto_id } -> { projeto, coerencia, custo_usd }
 *   Regras fixas pelo código e uma chamada ao Jev (Score por dimensão: nome,
 *   paleta, tipografia, tagline e o conjunto contra a estratégia). O código
 *   junta com pesos e grava em dados.coerencia. É aviso: nada do sistema muda.
 *   Sem o Jev (fora do ar, sem chave), sai só o código, com o aviso.
 * - ranquearPropostas: nota do Jev nas 3 paletas e nos 3 pares de fonte do
 *   diretor, contra a estratégia (a melhor primeiro; a equipe escolhe).
 *
 * Custo: o Jev é fração de centavo (cobrarJev registra na carteira).
 */

import { cobrarJev } from "../_shared/ia-motor.ts";
import { jevPerguntar, type PerguntaJev } from "../_shared/jev.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { type Chamador, dadosComParte, gravarProjeto, json, type LinhaDoProjeto, lerProjeto, TAREFA } from "./comum.ts";
import { conferirPorCodigo, type Coerencia, estadoParaOJev, fioDaMarca, juntarCoerencia, notaDaResposta, perguntasDaCoerencia } from "./modulos/coerencia-da-marca.ts";

export const AVISO_SEM_JEV = "O Jev não respondeu agora: a coerência saiu só pelas regras do código (sem a nota).";

/** Confere e devolve (sem gravar). Nunca lança por causa do Jev. */
export async function conferirCoerencia(ch: Chamador, p: LinhaDoProjeto): Promise<{ coerencia: Coerencia; custo_usd: number }> {
  const f = fioDaMarca(p.dados);
  const codigo = conferirPorCodigo(f);
  const perguntas = perguntasDaCoerencia(f);
  if (!Object.keys(perguntas).length) return { coerencia: juntarCoerencia(codigo, null, undefined, "Ainda não há nome, paleta, tipografia ou tagline para o Jev conferir."), custo_usd: 0 };
  try {
    const r = await jevPerguntar({ state: estadoParaOJev(f), questions: perguntas });
    const uso = await cobrarJev(r, { clientId: p.client_id, tarefa: TAREFA, referencia: { tipo: "idv_projeto", id: p.id }, criadoPor: ch.userId });
    return { coerencia: juntarCoerencia(codigo, r.answers), custo_usd: uso ? uso.custoUsd : 0 };
  } catch (e) {
    registrarFalha("mesa-identidade: coerência pelo Jev", e);
    return { coerencia: juntarCoerencia(codigo, null, undefined, AVISO_SEM_JEV), custo_usd: 0 };
  }
}

export async function coerenciaConferir(ch: Chamador, corpo: Record<string, unknown>) {
  const p = await lerProjeto(ch, corpo.projeto_id);
  const r = await conferirCoerencia(ch, p);
  // Relê antes de gravar: a equipe pode ter salvo o projeto enquanto o Jev respondia.
  const fresco = await lerProjeto(ch, p.id);
  const projeto = await gravarProjeto(fresco, { dados: dadosComParte(fresco.dados, "coerencia", r.coerencia as unknown as Record<string, unknown>, true) });
  return json({ projeto, coerencia: r.coerencia, custo_usd: r.custo_usd });
}

/**
 * Nota do Jev (0 a 1) em cada proposta, contra a estratégia do projeto; a
 * lista volta ordenada (sem nota no fim). Falha vira aviso, nunca some proposta.
 */
export async function ranquearPropostas<T extends object>(
  ch: Chamador,
  p: LinhaDoProjeto,
  propostas: T[],
  descrever: (x: T) => string,
  peca: "A paleta" | "O par de fontes",
): Promise<{ propostas: Array<T & { nota_jev: number | null }>; aviso: string | null }> {
  const f = fioDaMarca(p.dados);
  const semNota = propostas.map((x) => ({ ...x, nota_jev: null as number | null }));
  if (!f.arquetipo && !f.posicionamento) return { propostas: semNota, aviso: "Sem estratégia (arquétipo ou posicionamento): as propostas ficam sem a nota do Jev." };
  const perguntas: Record<string, PerguntaJev> = {};
  propostas.forEach((x, i) => {
    perguntas[`p${i}`] = {
      type: "score",
      instructions: `Avalie o quanto esta proposta expressa a estratégia em \`estrategia\` (arquétipo, traços, tom, posicionamento e público): ${descrever(x)}`,
      criteria: [
        `${peca} contradiz a estratégia: parece de outra marca, outro público ou outro tom`,
        `${peca} é neutra: não contradiz, mas não expressa nada da estratégia`,
        `${peca} combina em parte: um traço da estratégia aparece e outro destoa`,
        `${peca} combina bem: soa como o arquétipo, o tom e o público pedem`,
        `${peca} é a estratégia em forma: quem conhece o posicionamento reconhece na hora`,
      ],
    };
  });
  try {
    const r = await jevPerguntar({ state: { estrategia: estadoParaOJev(f).estrategia, ja_decidido: { nome: f.nome || null, logo: f.logo } }, questions: perguntas });
    await cobrarJev(r, { clientId: p.client_id, tarefa: TAREFA, referencia: { tipo: "idv_projeto", id: p.id }, criadoPor: ch.userId });
    const comNota = propostas.map((x, i) => {
      const n = notaDaResposta(r.answers ? r.answers[`p${i}`] : undefined);
      return { ...x, nota_jev: n === null ? null : Math.round(n * 100) / 100 };
    });
    const ordem = comNota.map((x, i) => ({ x, i })).sort((a, b) => (b.x.nota_jev ?? -1) - (a.x.nota_jev ?? -1) || a.i - b.i).map((o) => o.x);
    return { propostas: ordem, aviso: null };
  } catch (e) {
    registrarFalha("mesa-identidade: ranking das propostas", e);
    return { propostas: semNota, aviso: "O Jev não respondeu: as propostas estão sem nota, na ordem em que vieram." };
  }
}
