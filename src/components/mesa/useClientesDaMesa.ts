import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  modoParaGravar,
  montarClientesDaMesa,
  normalizarEscolhas,
  type ClienteBruto,
  type ClienteDaMesa,
  type EscolhaDaMesa,
  type MesaDeClientes,
} from "./clientesDaMesa";

/** Chave da escolha de clientes de uma mesa (vale para a equipe toda, vem do banco). */
export const chaveDasEscolhasDaMesa = (mesa: MesaDeClientes) => ["mesa", "clientes-da-mesa", mesa] as const;

/**
 * Clientes de uma mesa: o padrão (clientesDaMesa.ts) com a escolha da equipe
 * por cima. A escolha mora em mesa_cliente_escolhas e é gravada pela RPC
 * mesa_escolher_cliente (admin e gestor). Se a tabela ainda não existir ou a
 * leitura falhar, vale só o padrão: a mesa nunca fica sem seletor.
 */
export function useClientesDaMesa(mesa: MesaDeClientes, brutos: ClienteBruto[] | null | undefined) {
  const queryClient = useQueryClient();
  const escolhasQ = useQuery({
    queryKey: chaveDasEscolhasDaMesa(mesa),
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<EscolhaDaMesa[]> => {
      const { data, error } = await (supabase as any).from("mesa_cliente_escolhas").select("client_id, modo").eq("mesa", mesa);
      if (error) throw error;
      return normalizarEscolhas(data);
    },
  });
  const escolhas = useMemo(() => (escolhasQ.isError ? [] : escolhasQ.data || []), [escolhasQ.isError, escolhasQ.data]);
  const montado = useMemo(() => montarClientesDaMesa(mesa, brutos, escolhas), [mesa, brutos, escolhas]);

  /** Põe ou tira o cliente da mesa. Devolve a mensagem de erro, ou null quando gravou. */
  const definir = useCallback(
    async (cliente: ClienteDaMesa, querNaMesa: boolean): Promise<string | null> => {
      const modo = modoParaGravar(cliente.padrao, querNaMesa);
      const chave = chaveDasEscolhasDaMesa(mesa);
      const antes = queryClient.getQueryData<EscolhaDaMesa[]>(chave);
      const semEle = (antes || []).filter((e) => e.client_id !== cliente.id);
      queryClient.setQueryData<EscolhaDaMesa[]>(chave, modo ? semEle.concat([{ client_id: cliente.id, modo }]) : semEle);
      try {
        const { error } = await (supabase as any).rpc("mesa_escolher_cliente", { _mesa: mesa, _client_id: cliente.id, _modo: modo });
        if (error) throw error;
        void queryClient.invalidateQueries({ queryKey: chave });
        return null;
      } catch (e) {
        queryClient.setQueryData<EscolhaDaMesa[] | undefined>(chave, antes);
        const texto = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message || "") : "";
        return /mesa_escolher_cliente|mesa_cliente_escolhas|does not exist|schema cache/i.test(texto)
          ? "A escolha de clientes por mesa ainda não foi ativada no banco."
          : texto || "Não foi possível gravar agora.";
      }
    },
    [mesa, queryClient],
  );

  return { ...montado, carregandoEscolhas: escolhasQ.isLoading, escolhasIndisponiveis: escolhasQ.isError, definir };
}
