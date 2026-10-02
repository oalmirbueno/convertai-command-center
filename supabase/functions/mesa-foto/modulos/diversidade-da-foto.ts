/**
 * Diversidade visual na Mesa Foto (02/10/2026): lê os últimos ensaios do
 * cliente (foto_ensaios: tomadas com cenário e luz, guia de estilo com paleta
 * e figurino, modelo sintética) e devolve o "o que variar agora" para o
 * diretor, as variações e a campanha (regras em _shared/diversidade-visual.ts).
 *
 * pecaDoEnsaio é pura (Vitest); variarAgoraNaFoto lê o banco e nunca lança.
 */

import { oQueVariarAgora, type OpcoesDoVariar, type PecaRecente } from "../../_shared/diversidade-visual.ts";

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const HEX = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;

/** O que um ensaio usou: paleta do guia, cenários e luz das tomadas, modelo e figurino. */
export function pecaDoEnsaio(e: { tomadas?: unknown; direcao?: unknown }): PecaRecente {
  const d = obj(e.direcao);
  const guia = obj(d.guia_de_estilo);
  const tomadas = lista(e.tomadas).map(obj).slice(0, 4);
  const modelo = obj(d.modelo);
  const cores = lista(guia.paleta).map((p) => String(p || "")).join(" ").match(HEX) || [];
  const figurinos = [str(guia.figurino), ...tomadas.map((t) => str(obj(t.campanha).figurino))].filter(Boolean);
  return {
    cores,
    cenario: [...tomadas.map((t) => str(t.cenario, 160)), ...lista(guia.cenarios).map((c) => str(c, 120))].filter(Boolean).slice(0, 4).join(". ") || null,
    luz: str(guia.luz, 80) || str(tomadas[0] && tomadas[0].luz, 80) || null,
    pessoa: str(modelo.perfil, 80) || null,
    roupa: figurinos.join(". ") || null,
  };
}

// deno-lint-ignore no-explicit-any
type Banco = { from: (tabela: string) => any };

/** O bloco "o que variar agora" da Mesa Foto; nunca lança. */
export async function variarAgoraNaFoto(db: Banco, clientId: string, e: { pedido?: string | null; paleta?: OpcoesDoVariar["paleta"] | null } = {}): Promise<string> {
  let pecas: PecaRecente[] = [];
  try {
    const { data, error } = await db
      .from("foto_ensaios")
      .select("tomadas, direcao")
      .eq("client_id", clientId)
      .neq("status", "arquivado")
      .order("criado_em", { ascending: false })
      .limit(12);
    if (!error) pecas = ((data as { tomadas: unknown; direcao: unknown }[] | null) ?? []).map(pecaDoEnsaio);
  } catch {
    pecas = [];
  }
  return oQueVariarAgora(pecas, { pedido: e.pedido ?? null, paleta: e.paleta ?? [] });
}
