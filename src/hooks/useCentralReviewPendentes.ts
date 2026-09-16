import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface RevisaoPendente {
  id: string;
  client_id: string | null;
  titulo: string;
  status: string;
  created_at: string;
}

/**
 * Pedidos de revisao do Ciclo esperando decisao (origin = central).
 * Alimenta o contador no Ciclo e o aviso na tela de revisao; o sino recebe
 * a notificacao pelo gatilho do banco.
 */
export function useCentralReviewPendentes(ativo = true) {
  const { user, profile } = useAuth() as { user: unknown; profile?: { role?: string } | null };
  const admin = profile?.role === "admin";
  const query = useQuery({
    queryKey: ["central-review-pendentes", admin],
    enabled: Boolean(user) && admin && ativo,
    refetchInterval: 60_000,
    staleTime: 20_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("operator_approvals")
        .select("id, client_id, o_que, status, created_at, payload")
        .eq("origin", "central")
        .in("status", ["pendente", "adiado"])
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) return [] as RevisaoPendente[];
      return ((data ?? []) as Array<Record<string, any>>).map((a) => ({
        id: String(a.id),
        client_id: a.client_id ? String(a.client_id) : null,
        titulo: String(a.payload?.report?.title || a.o_que || "mensagem"),
        status: String(a.status),
        created_at: String(a.created_at),
      }));
    },
  });
  const lista = query.data ?? [];
  const porCliente = new Map<string, number>();
  for (const p of lista) if (p.client_id) porCliente.set(p.client_id, (porCliente.get(p.client_id) ?? 0) + 1);
  return { pendentes: lista, total: lista.length, porCliente, carregando: query.isLoading };
}
