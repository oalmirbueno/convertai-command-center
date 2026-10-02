/**
 * Diversidade visual na Mesa Vídeos (02/10/2026): lê os últimos projetos do
 * diretor de vídeo do cliente (video_diretor_projetos.biblia: personagens com
 * aparência e roupa, cenários, paleta e luz) e devolve o "o que variar agora"
 * (regras em _shared/diversidade-visual.ts). A bíblia continua fixa DENTRO do
 * filme; a variação é entre filmes.
 *
 * pecaDoProjeto é pura (Vitest); variarAgoraNoVideo lê o banco e nunca lança.
 */

import { oQueVariarAgora, type OpcoesDoVariar, type PecaRecente } from "../../_shared/diversidade-visual.ts";

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const HEX = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;

/** O que a bíblia de um filme usou: paleta, cenários, luz, personagem e roupa. */
export function pecaDoProjeto(p: { biblia?: unknown }): PecaRecente {
  const b = obj(p.biblia);
  const estilo = obj(b.estilo);
  const personagens = lista(b.personagens).map(obj);
  const cores = lista(estilo.paleta).map((x) => String(x || "")).join(" ").match(HEX) || [];
  return {
    cores,
    cenario: lista(b.cenarios).map(obj).map((c) => [str(c.nome, 60), str(c.descricao, 140)].filter(Boolean).join(": ")).filter(Boolean).slice(0, 3).join(". ") || null,
    luz: str(estilo.luz, 80) || null,
    pessoa: personagens.length ? str(personagens[0].nome, 60) || str(personagens[0].aparencia, 60) || null : null,
    roupa: personagens.map((x) => str(x.roupa, 120)).filter(Boolean).join(". ") || null,
    formato: str(b.formato, 12) || null,
  };
}

// deno-lint-ignore no-explicit-any
type Banco = { from: (tabela: string) => any };

/** O bloco "o que variar agora" do diretor de vídeo; nunca lança. */
export async function variarAgoraNoVideo(
  db: Banco,
  clientId: string,
  e: { excluirId?: string | null; pedido?: string | null; paleta?: OpcoesDoVariar["paleta"] } = {},
): Promise<string> {
  let pecas: PecaRecente[] = [];
  try {
    const { data, error } = await db
      .from("video_diretor_projetos")
      .select("id, biblia")
      .eq("client_id", clientId)
      .order("atualizado_em", { ascending: false })
      .limit(12);
    if (!error) pecas = ((data as { id: string; biblia: unknown }[] | null) ?? []).filter((p) => p.id !== e.excluirId).map(pecaDoProjeto);
  } catch {
    pecas = [];
  }
  return oQueVariarAgora(pecas, { pedido: e.pedido ?? null, paleta: e.paleta ?? [] });
}
