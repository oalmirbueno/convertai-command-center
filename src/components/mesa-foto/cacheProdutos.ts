import type { QueryClient } from "@tanstack/react-query";
import { chaveDosKits, chaveDasFotos, type KitDeFoto, type FotoDoAcervo } from "./fotoApi";

/** A resposta confirmada entra antes da próxima leitura; uma busca antiga não pode apagá-la. */
export async function guardarProdutoConfirmado(cache: QueryClient, clientId: string, kit: KitDeFoto) {
  if (!kit.id || kit.client_id !== clientId) throw new Error("Produto não confirmado para este cliente.");
  await cache.cancelQueries({ queryKey: chaveDosKits(clientId) });
  cache.setQueryData<KitDeFoto[]>(chaveDosKits(clientId), (atual = []) => [kit, ...atual.filter((k) => k.id !== kit.id)]);
  const ids = new Set(kit.refs.filter((r) => ["identidade", "embalagem", "detalhe", "verso", "rotulo"].includes(r.papel)).map((r) => r.imagem_id));
  cache.setQueryData<FotoDoAcervo[]>(chaveDasFotos(clientId), (atual) => atual?.map((f) => ids.has(f.id) ? { ...f, categoria: "produto" } : f));
}

export function fotosJaCadastradas(kits: KitDeFoto[]): Record<string, string> {
  const mapa: Record<string, string> = {};
  for (const k of kits) if (k.id && k.tipo !== "pessoa" && k.status !== "arquivado") {
    for (const id of [k.frente_imagem_id, ...k.refs.map((r) => r.imagem_id)]) if (id) mapa[id] = k.nome || "Produto";
  }
  return mapa;
}
