import type { QueryClient } from "@tanstack/react-query";
import { chamarFuncao } from "@/lib/mesa/api";
import { normalizarKit, type KitDeFoto } from "./fotoApi";
import { guardarProdutoConfirmado } from "./cacheProdutos";
export { PUBLICOS_DO_PRODUTO, ROTULOS_PUBLICO } from "../../../supabase/functions/mesa-foto/modulos/pastas-produtos";
export type { PublicoProduto } from "../../../supabase/functions/mesa-foto/modulos/pastas-produtos";

export async function atualizarPublicoProduto(cache: QueryClient, clientId: string, kit: KitDeFoto, publico: string, reavaliar = false) {
  const data = await chamarFuncao<any>("mesa-foto", publico === "automatico"
    ? { acao: "produto_publico", client_id: clientId, kit_id: kit.id, reavaliar }
    : { acao: "produto_organizar", client_id: clientId, kit_id: kit.id, publico });
  const salvo = normalizarKit(data?.kit);
  if (!salvo?.id) throw new Error("O público do produto não foi confirmado pelo servidor.");
  await guardarProdutoConfirmado(cache, clientId, salvo);
  return { ...data, kit: salvo };
}
