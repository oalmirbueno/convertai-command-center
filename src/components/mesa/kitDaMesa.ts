import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { alvoDoKit, kitDaMarcaAberta, type AlvoDoKit, type OrigemDoKit } from "@/lib/mesa/kitDaMarca";
import { chaveDasMarcas, type MarcaDoCliente } from "@/lib/mesa/marcas";
import { supabase } from "@/integrations/supabase/client";
import { useKitDoCliente, type KitDoContexto } from "./contextoDoCliente";
import { useMarcaDaMesa, useMesaOpcional } from "./MesaContexto";

/**
 * Kit da marca aberta no topo (frente MC, 29/09): o que toda tela da Mesa
 * mostra e usa como paleta, logo, estilo, regras, tom e contexto. Com a CME
 * aberta, é o kit da CME (vazio onde ela não tem nada); com a Acerbi, o kit
 * do cliente. `alvo` diz onde a edição grava.
 */
export function useKitDaMesa(clientIdDado?: string): {
  data: KitDoContexto | null | undefined;
  isLoading: boolean;
  isError: boolean;
  alvo: AlvoDoKit;
  origem: OrigemDoKit;
  marca: MarcaDoCliente | null;
  /** Outra marca (não a principal) aberta: a tela diz "da CME" e grava na marca. */
  daMarca: boolean;
  /** Relê o kit do cliente e as marcas. */
  refetch: () => void;
} {
  // Fora da casca (ex.: aviso do kit num teste ou numa tela solta), vale o cliente dado e nenhuma marca.
  const mesa = useMesaOpcional();
  const clientId = clientIdDado || (mesa ? mesa.clientId : "");
  const { marca: marcaDaMesa } = useMarcaDaMesa();
  const marca = marcaDaMesa && marcaDaMesa.client_id === clientId ? marcaDaMesa : null;
  const kit = useKitDoCliente(clientId);
  const queryClient = useQueryClient();
  const efetivo = useMemo(() => kitDaMarcaAberta((kit.data as any) || null, marca, clientId), [kit.data, marca, clientId]);
  const alvo = useMemo(() => alvoDoKit(clientId, marca), [clientId, marca]);
  return {
    data: kit.data === undefined && !marca ? undefined : (efetivo.kit as KitDoContexto | null),
    isLoading: kit.isLoading,
    isError: kit.isError,
    alvo,
    origem: efetivo.origem,
    marca,
    daMarca: alvo.tabela === "cliente_marcas",
    refetch: () => {
      void kit.refetch();
      void queryClient.invalidateQueries({ queryKey: chaveDasMarcas(clientId) });
    },
  };
}

/**
 * Grava campos do kit no lugar certo: kit do cliente (upsert por cliente) ou
 * a linha da marca (update preso ao cliente). Um caminho só para a tela de
 * Marca, as logos e as sugestões; nunca grava a CME no kit da Acerbi.
 */
export async function gravarNoKit(alvo: AlvoDoKit, campos: Record<string, unknown>, userId: string | null | undefined): Promise<void> {
  const db = supabase as any;
  if (alvo.tabela === "cliente_marcas") {
    const { error } = await db
      .from("cliente_marcas")
      .update({ ...campos, atualizado_por: userId ?? null })
      .eq("id", alvo.marcaId)
      .eq("client_id", alvo.clientId);
    if (error) throw error;
    return;
  }
  const { error } = await db
    .from("cliente_kit_marca")
    .upsert({ client_id: alvo.clientId, ...campos, atualizado_por: userId ?? null }, { onConflict: "client_id" });
  if (error) throw error;
}

/** Chaves de cache que mudam quando o kit (do cliente ou da marca) muda. */
export function chavesDoKit(clientId: string): (readonly unknown[])[] {
  return [["mesa", "kit", clientId], ["mesa", "kit-tons", clientId], chaveDasMarcas(clientId)];
}
