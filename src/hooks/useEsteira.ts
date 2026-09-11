import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useClients } from "@/hooks/useSupabaseData";
import { lerFatosDaEsteira } from "@/lib/esteira/esteiraFatos";
import { montarEsteira } from "@/lib/esteira/esteiraMontar";
import type { EsteiraDoCliente, FatosDoCliente } from "@/lib/esteira/esteiraTipos";

export interface ClienteDaEsteira {
  id: string;
  nome: string;
  avatarUrl: string | null;
  tipo: string;
  fatos: FatosDoCliente;
  esteira: EsteiraDoCliente;
}

/**
 * Carrega a carteira ativa, le os fatos item a item e monta a esteira de
 * cada cliente para a semana pedida. Uma leitura por tabela para todos.
 */
export function useEsteira(weekStart: string, hoje: Date) {
  const { data: clients, isLoading: carregandoClientes } = useClients();
  const queryClient = useQueryClient();

  const ativos = useMemo(
    () => ((clients ?? []) as Array<Record<string, any>>).filter((c) => c.plan_status === "active" && !c.deleted_at),
    [clients],
  );
  const ids = useMemo(() => ativos.map((c) => String(c.id)).sort().join(","), [ativos]);

  const fatosQuery = useQuery({
    queryKey: ["esteira-fatos", weekStart, ids],
    enabled: ativos.length > 0,
    staleTime: 60_000,
    queryFn: () => lerFatosDaEsteira(ativos.map((c) => ({ id: String(c.id), created_at: c.created_at ?? null, services_config: c.services_config ?? null })), weekStart),
  });

  const lista = useMemo<ClienteDaEsteira[]>(() => {
    const mapa = fatosQuery.data;
    if (!mapa) return [];
    return ativos.map((c) => {
      const fatos = mapa.get(String(c.id));
      if (!fatos) return null;
      return {
        id: String(c.id),
        nome: String(c.company_name || c.full_name || c.email || "Cliente"),
        avatarUrl: (c.avatar_url as string | null) ?? null,
        tipo: String(c.client_type ?? "recurring"),
        fatos,
        esteira: montarEsteira(fatos, hoje),
      };
    }).filter((x): x is ClienteDaEsteira => x !== null);
  }, [ativos, fatosQuery.data, hoje]);

  const recarregar = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["esteira-fatos"] });
  }, [queryClient]);

  return { clientes: lista, carregando: carregandoClientes || fatosQuery.isLoading, erro: fatosQuery.error, recarregar };
}
