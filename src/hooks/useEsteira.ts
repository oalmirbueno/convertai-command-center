import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useClients } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
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

interface ClienteCadastrado {
  id: string;
  company_name?: string | null;
  full_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  client_type?: string | null;
  plan_status?: string | null;
  deleted_at?: string | null;
  created_at?: string | null;
  services_config?: Record<string, unknown> | null;
}

const filtrarAtivos = (clients: ClienteCadastrado[] | undefined): ClienteCadastrado[] =>
  (clients ?? []).filter((c) => c.plan_status === "active" && !c.deleted_at);

const chaveDosFatos = (userId: string | undefined, role: string | undefined, weekStart: string, clientes: ClienteCadastrado[]) =>
  ["esteira-fatos", userId, role, weekStart, clientes.map((c) => c.id).sort().join(",")] as const;

const lerFatos = (clientes: ClienteCadastrado[], weekStart: string) =>
  lerFatosDaEsteira(clientes.map((c) => ({ id: c.id, created_at: c.created_at ?? null, services_config: c.services_config ?? null })), weekStart);

/**
 * Carrega a carteira ativa, le os fatos item a item e monta a esteira de
 * cada cliente para a semana pedida. Uma leitura por tabela para todos.
 */
export function useEsteira(weekStart: string, hoje: Date) {
  const { user, profile } = useAuth();
  const userId = user?.id;
  const role = profile?.role;
  const clientsQuery = useClients();
  const { data: clients, isLoading: carregandoClientes } = clientsQuery;
  const { refetch: refetchClients } = clientsQuery;
  const queryClient = useQueryClient();
  const [recarregando, setRecarregando] = useState(false);

  const ativos = useMemo(
    () => filtrarAtivos(clients),
    [clients],
  );

  const fatosQuery = useQuery({
    queryKey: chaveDosFatos(userId, role, weekStart, ativos),
    enabled: Boolean(userId) && ativos.length > 0,
    staleTime: 60_000,
    queryFn: () => lerFatos(ativos, weekStart),
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
        esteira: montarEsteira(fatos, hoje, weekStart),
      };
    }).filter((x): x is ClienteDaEsteira => x !== null);
  }, [ativos, fatosQuery.data, hoje, weekStart]);

  // Recarrega clientes E fatos; devolve quando os fatos novos chegaram, para
  // o botao poder avisar "atualizado" com verdade.
  const recarregar = useCallback(async () => {
    if (!userId) throw new Error("Entre novamente para atualizar a Esteira.");
    setRecarregando(true);
    try {
      const { data: novosClientes } = await refetchClients({ throwOnError: true });
      const novosAtivos = filtrarAtivos(novosClientes);
      await queryClient.invalidateQueries({ queryKey: ["esteira-fatos", userId, role], refetchType: "none" });
      if (novosAtivos.length > 0) {
        // Usa os clientes que acabaram de chegar, nao os ids capturados
        // antes da recarga; fetchQuery propaga erros e conserva o cache.
        await queryClient.fetchQuery({
          queryKey: chaveDosFatos(userId, role, weekStart, novosAtivos),
          queryFn: () => lerFatos(novosAtivos, weekStart),
          staleTime: 0,
        });
      }
    } finally {
      setRecarregando(false);
    }
  }, [queryClient, refetchClients, role, userId, weekStart]);

  return {
    clientes: lista,
    carregando: carregandoClientes || fatosQuery.isLoading,
    atualizando: recarregando || clientsQuery.isFetching || fatosQuery.isFetching,
    erro: clientsQuery.error || fatosQuery.error,
    recarregar,
  };
}
