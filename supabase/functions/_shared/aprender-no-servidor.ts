/**
 * O lado Deno do "aprender com o dono" (frente AG3, 29/09): o Jev de verdade
 * e a gravação pelo cérebro. As regras e a política moram em
 * aprender-com-o-dono.ts (puro, testado no vitest).
 */
import { jevPerguntar } from "./jev.ts";
import { type BancoDoCerebro } from "./cerebro-do-cliente.ts";
import { gravarNoCerebro } from "./cerebro-nas-mesas.ts";
import {
  type AgenteQueAprende,
  type Aprendi,
  aprenderDoPedido,
  type CategoriaDaRegra,
  type EscopoDaRegra,
  type GravacaoDaRegra,
  guardarRegraDoDono,
  type NovaRegra,
  type PerguntarAoJev,
} from "./aprender-com-o-dono.ts";

function gravarPeloCerebro(db: BancoDoCerebro) {
  return async (nova: NovaRegra): Promise<GravacaoDaRegra> => {
    const g = await gravarNoCerebro(db, { ...nova, valido_dias: null });
    return { gravada: g.gravada, situacao: g.situacao, id: g.id, reforcos: g.reforcos, substituidos: g.substituidos, erro: g.erro };
  };
}

/** "Guardar como regra" do incerto (a equipe decidiu). Lança com o motivo quando não grava. */
export async function guardarNoServidor(
  db: BancoDoCerebro,
  o: { texto: string; categoria: CategoriaDaRegra; escopo: EscopoDaRegra; agente: AgenteQueAprende; clientId: string | null; donoId: string | null },
): Promise<Aprendi> {
  const r = await guardarRegraDoDono({ ...o, gravar: gravarPeloCerebro(db) });
  if (!r.aprendi) throw new Error(r.erro || "a regra não foi guardada");
  return r.aprendi;
}

/** Tempo curto: o aprendizado corre junto da resposta e não pode segurar a conversa. */
export const TIMEOUT_JEV_DO_APRENDIZADO_MS = 9_000;

export const perguntarAoJevDoAprendizado: PerguntarAoJev = async (state, questions) => {
  const r = await jevPerguntar({ state, questions }, { timeoutMs: TIMEOUT_JEV_DO_APRENDIZADO_MS });
  return r.answers as Record<string, { choice?: string; probabilities?: Record<string, number>; confidence?: number }>;
};

/**
 * Aprende com o pedido do dono (quando há sinal) e devolve a linha "Aprendi".
 * Nunca lança; a falha vai para o log com o motivo, sem dado do cliente.
 */
export async function aprenderNoServidor(
  db: BancoDoCerebro,
  o: { texto: string; agente: AgenteQueAprende; clientId: string | null; donoId: string | null; cliente?: string | null; contexto?: string | null },
): Promise<Aprendi | null> {
  try {
    const r = await aprenderDoPedido({
      ...o,
      perguntar: perguntarAoJevDoAprendizado,
      gravar: gravarPeloCerebro(db),
    });
    if (r.erro) console.warn(`[aprender] ${o.agente}: não aprendeu (${r.decisao.vira_regra ? "gravação" : r.decisao.motivo}): ${r.erro}`);
    return r.aprendi;
  } catch (e) {
    console.warn(`[aprender] ${o.agente}: falha ${e instanceof Error ? e.message : "desconhecida"}`);
    return null;
  }
}
