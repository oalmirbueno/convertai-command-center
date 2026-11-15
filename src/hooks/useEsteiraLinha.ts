import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useClients } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { useDiasPrioritarios } from "@/lib/diaPrioritarioApi";
import { montarGrade, podeAbrirEstudio, type ClienteDaFaixa, type FaixaDaEsteira } from "@/lib/esteiraLinha/esteiraLinha";
import { lerModosDeAprovacao, lerPecasDaEsteiraLinha } from "@/lib/esteiraLinha/esteiraLinhaFatos";

interface ClienteCadastrado {
  id: string;
  company_name?: string | null;
  full_name?: string | null;
  email?: string | null;
  plan_status?: string | null;
  deleted_at?: string | null;
}

/** A carteira ativa, pela mesma regra do Ciclo. */
export const clientesAtivosDaEsteira = (clients: ClienteCadastrado[] | undefined): ClienteDaFaixa[] =>
  (clients ?? [])
    .filter((c) => c.plan_status === "active" && !c.deleted_at)
    .map((c) => ({ id: String(c.id), nome: String(c.company_name || c.full_name || c.email || "Cliente"), planStatus: c.plan_status ?? null }));

/**
 * Esteira em linha do tempo: a carteira ativa, as peças da semana pedida e o
 * dia prioritário de cada cliente, já montados em faixas. Só leitura.
 */
export function useEsteiraLinha(segunda: string) {
  const { user, profile } = useAuth();
  const clientes = useClients();
  const dias = useDiasPrioritarios();
  const ativos = useMemo(() => clientesAtivosDaEsteira(clientes.data as ClienteCadastrado[] | undefined), [clientes.data]);
  const ids = useMemo(() => ativos.map((c) => c.id).sort(), [ativos]);

  const pecas = useQuery({
    queryKey: ["esteira-linha", user?.id, profile?.role, segunda, ids.join(",")],
    enabled: Boolean(user?.id) && ids.length > 0,
    staleTime: 60_000,
    queryFn: () => lerPecasDaEsteiraLinha(ids, segunda),
  });

  // A regra de aprovação do cliente no cadastro (hoje só a Softy é `dispensada`).
  // Leitura tolerante: sem ela, todo mundo segue o caminho normal.
  const modos = useQuery({
    queryKey: ["esteira-linha-modo-aprovacao", user?.id, ids.join(",")],
    enabled: Boolean(user?.id) && ids.length > 0,
    staleTime: 10 * 60_000,
    queryFn: () => lerModosDeAprovacao(ids),
  });

  const podeEstudio = podeAbrirEstudio(profile?.role);
  const faixas = useMemo<FaixaDaEsteira[]>(
    () => montarGrade({
      clientes: ativos.map((c) => ({ ...c, modoAprovacao: modos.data?.[c.id] ?? null })),
      pecas: pecas.data ?? [],
      diasPrioritarios: dias.data ?? [],
      segunda,
      podeAbrirEstudio: podeEstudio,
    }),
    [ativos, modos.data, pecas.data, dias.data, segunda, podeEstudio],
  );

  const carregando = clientes.isLoading || dias.isLoading || (ids.length > 0 && pecas.isLoading);
  const erro = (clientes.error || pecas.error || dias.error || null) as Error | null;

  return {
    faixas,
    carregando,
    atualizando: pecas.isFetching || clientes.isFetching || dias.isFetching,
    erro,
    semClientes: !clientes.isLoading && !clientes.error && ativos.length === 0,
    recarregar: () => {
      void clientes.refetch();
      void dias.refetch();
      if (ids.length > 0) void pecas.refetch();
    },
  };
}
