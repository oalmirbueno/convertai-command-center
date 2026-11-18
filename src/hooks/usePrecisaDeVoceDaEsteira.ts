import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useClients } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { podeAbrirEstudio } from "@/lib/esteiraLinha/esteiraLinha";
import { LINHAS_DO_DONO_VAZIAS, montarPedidosDoDono, type PedidoDoDono } from "@/lib/esteiraLinha/precisaDeVoce";
import { lerLinhasDoDono } from "@/lib/esteiraLinha/precisaDeVoceFatos";

interface ClienteCadastrado {
  id: string;
  company_name?: string | null;
  full_name?: string | null;
  plan_status?: string | null;
  deleted_at?: string | null;
}

/**
 * A caixa "Precisa de você" da Esteira: lê as fontes em lote e devolve a
 * lista já montada pela regra pura. Só leitura.
 */
export function usePrecisaDeVoceDaEsteira() {
  const { user, profile } = useAuth();
  const clientes = useClients();
  const leitura = useQuery({
    queryKey: ["esteira-precisa-de-voce", user?.id, profile?.role],
    enabled: Boolean(user?.id),
    staleTime: 60_000,
    refetchInterval: 120_000,
    queryFn: () => lerLinhasDoDono(),
  });

  const pedidos = useMemo<PedidoDoDono[]>(() => {
    const lista = (clientes.data ?? []) as ClienteCadastrado[];
    const nomes = new Map(lista.map((c) => [String(c.id), String(c.company_name || c.full_name || "") || null]));
    const ativos = new Set(lista.filter((c) => c.plan_status === "active" && !c.deleted_at).map((c) => String(c.id)));
    return montarPedidosDoDono({
      ...(leitura.data?.linhas ?? LINHAS_DO_DONO_VAZIAS),
      nomeDe: (id) => (id ? nomes.get(id) ?? null : null),
      // Sem a carteira lida ainda, não corta por cliente ativo.
      clientesAtivos: clientes.data ? ativos : undefined,
      podeAbrirEstudio: podeAbrirEstudio(profile?.role),
    });
  }, [leitura.data, clientes.data, profile?.role]);

  return {
    pedidos,
    carregando: leitura.isLoading,
    incompleta: (leitura.data?.fontesComErro.length ?? 0) > 0,
    recarregar: () => void leitura.refetch(),
  };
}
