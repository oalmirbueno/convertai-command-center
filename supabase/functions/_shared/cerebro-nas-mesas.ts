/**
 * Cérebro do cliente nas mesas (Frente H, 25/09/2026): a leitura em resumo e a
 * gravação sem duplicar, com o Jev como juiz de "repete ou contradiz".
 *
 * As regras moram em cerebro-do-cliente.ts (puro). Aqui fica só o que depende
 * do Deno: o Jev (TYPESAFE_API_KEY do ambiente) e o jeito de nunca derrubar a
 * mesa. Ler ou gravar no cérebro é ajuda: se falhar, a mesa segue e o motivo
 * vai para o log (sem dado do cliente).
 *
 * Quem usa: Mesa Ads (aprendizado_registrar e contexto), Estúdio (ajuste e
 * conversa), agente de contexto (conversa), calendário e Mesa Foto (leitura).
 */

import { jevPerguntar } from "./jev.ts";
import {
  type AreaDoCerebro,
  type BancoDoCerebro,
  type FatoDoCerebro,
  type JulgarAprendizado,
  lerCerebro,
  type NovoAprendizado,
  registrarAprendizado,
  resumoParaPrompt,
} from "./cerebro-do-cliente.ts";

/** Tempo do Jev na gravação: o mesmo do MCP (mcp-cerebro-services.ts). */
export const TIMEOUT_JEV_DO_CEREBRO_MS = 12_000;

/** O Jev como juiz de "repete ou contradiz" (mesmo padrão de mcp-cerebro-services.ts). */
export const julgarAprendizadoComJev: JulgarAprendizado = async (state, questions) => {
  const r = await jevPerguntar({ state, questions }, { timeoutMs: TIMEOUT_JEV_DO_CEREBRO_MS });
  return r.answers as Record<string, { choice?: string; probabilities?: Record<string, number>; confidence?: number }>;
};

export type GravacaoNoCerebro = {
  gravada: boolean;
  situacao: "criado" | "reforcado" | "substituiu" | null;
  id: string | null;
  reforcos: number | null;
  substituidos: string[];
  avisos: string[];
  erro: string | null;
};

/**
 * Grava pelo cérebro: texto igual vira reforço, o que diz o mesmo com outras
 * palavras também (Jev), o que contradiz aposenta o antigo, e a validade sai
 * da categoria. Nunca lança: a falha volta em `erro` para quem chamou decidir.
 */
export async function gravarNoCerebro(db: BancoDoCerebro, novo: NovoAprendizado, opcoes: { julgar?: JulgarAprendizado | null } = {}): Promise<GravacaoNoCerebro> {
  try {
    const julgar = opcoes.julgar === null ? undefined : (opcoes.julgar ?? julgarAprendizadoComJev);
    const r = await registrarAprendizado(db, novo, { julgar });
    return { gravada: true, situacao: r.situacao, id: r.id || null, reforcos: r.reforcos, substituidos: r.substituidos, avisos: r.avisos, erro: null };
  } catch (e) {
    const erro = e instanceof Error ? e.message : "falha ao gravar no cérebro";
    console.error("[cerebro] aprendizado nao gravado", { area: novo.area, categoria: novo.categoria, fonte: novo.fonte, erro });
    return { gravada: false, situacao: null, id: null, reforcos: null, substituidos: [], avisos: [], erro };
  }
}

/**
 * Resumo do cérebro das áreas pedidas (mais a geral), com teto. Vazio quando
 * o cliente ainda não ensinou nada ou quando a leitura falhou (aí `falhou`).
 */
export async function resumoDoCerebro(
  db: BancoDoCerebro,
  clientId: string,
  areas: AreaDoCerebro[],
  opcoes: { limite?: number; titulo?: string; manter?: (f: FatoDoCerebro) => boolean } = {},
): Promise<{ texto: string; usados: number; fora: number; avisos: string[]; falhou: boolean }> {
  try {
    const leitura = await lerCerebro(db, clientId);
    // `manter` tira do resumo o que já vai por outro caminho (ex.: o "Plano do mês" do calendário).
    const fatos = opcoes.manter ? leitura.fatos.filter(opcoes.manter) : leitura.fatos;
    const r = resumoParaPrompt(fatos, { areas, limite: opcoes.limite, titulo: opcoes.titulo });
    return { ...r, avisos: leitura.avisos, falhou: false };
  } catch (e) {
    console.error("[cerebro] leitura falhou", { erro: e instanceof Error ? e.message : "desconhecido" });
    return { texto: "", usados: 0, fora: 0, avisos: [], falhou: true };
  }
}
