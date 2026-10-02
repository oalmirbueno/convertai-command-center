/**
 * Diversidade visual na Mesa Motion (02/10/2026): lê os últimos filmes do
 * cliente (motion_filmes: storyboard escolhido e cenas com a peça do kit) e
 * devolve o "o que variar agora" para os storyboards (regras em
 * _shared/diversidade-visual.ts): conceito e sequência de peças diferentes.
 *
 * pecaDoFilme é pura (Vitest); variarAgoraNoMotion lê o banco e nunca lança.
 */

import { oQueVariarAgora, type PecaRecente } from "../../_shared/diversidade-visual.ts";

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** O que um filme usou: as 3 primeiras peças (estrutura), o conceito do storyboard e o tema de cor. */
export function pecaDoFilme(f: { storyboards?: unknown; storyboard_escolhido?: unknown; cenas?: unknown; tipo?: unknown }): PecaRecente {
  const sbs = lista(f.storyboards).map(obj);
  const i = typeof f.storyboard_escolhido === "number" ? f.storyboard_escolhido : -1;
  const sb = i >= 0 && i < sbs.length ? sbs[i] : null;
  const cenas = (lista(f.cenas).length ? lista(f.cenas) : sb ? lista(sb.cenas) : []).map(obj);
  const pecas = cenas.slice(0, 3).map((c) => str(c.peca, 40)).filter(Boolean);
  const temas = cenas.map((c) => str(c.tema, 10)).filter(Boolean);
  return {
    layout: pecas.length ? pecas.join(" > ") : null,
    cenario: sb ? [str(sb.conceito, 160), str(sb.resumo, 240)].filter(Boolean).join(". ") || null : null,
    luz: temas.length && temas.every((t) => t === temas[0]) ? `tema ${temas[0]} em todas as cenas` : null,
    formato: str(f.tipo, 30) || null,
  };
}

// deno-lint-ignore no-explicit-any
type Banco = { from: (tabela: string) => any };

/** O bloco "o que variar agora" dos storyboards; nunca lança. */
export async function variarAgoraNoMotion(db: Banco, clientId: string, e: { excluirId?: string | null; pedido?: string | null } = {}): Promise<string> {
  let pecas: PecaRecente[] = [];
  try {
    const { data, error } = await db
      .from("motion_filmes")
      .select("id, tipo, storyboards, storyboard_escolhido, cenas")
      .eq("client_id", clientId)
      .is("arquivado_em", null)
      .order("atualizado_em", { ascending: false })
      .limit(10);
    if (!error) {
      pecas = ((data as Array<{ id: string; tipo?: unknown; storyboards?: unknown; storyboard_escolhido?: unknown; cenas?: unknown }> | null) ?? [])
        .filter((f) => f.id !== e.excluirId)
        .map(pecaDoFilme);
    }
  } catch {
    pecas = [];
  }
  return oQueVariarAgora(pecas, { pedido: e.pedido ?? null });
}
