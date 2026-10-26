import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { ReviewReport } from "@/lib/centralReview";
import { inicioDaSemana } from "@/lib/mensagensDaSemana";

const CAMPOS = "id, client_id, project_id, title, summary, next_steps, highlights, metrics, status, review_version, created_at, period_start, period_end";

/** Os rascunhos de ritual desta semana (a base das Mensagens da semana). */
export function useRascunhosDaSemana(ativo: boolean) {
  return useQuery({
    queryKey: ["mensagens-da-semana", "rascunhos"],
    enabled: ativo,
    refetchInterval: 30_000,
    queryFn: async () => {
      const desde = new Date(inicioDaSemana(Date.now())).toISOString();
      const { data, error } = await (supabase as any).from("reports").select(CAMPOS).eq("status", "draft").gte("created_at", desde).order("created_at", { ascending: false }).limit(300);
      if (error) throw new Error(error.message);
      return (data || []) as ReviewReport[];
    },
  });
}

/**
 * Contador do menu e do atalho da Central: mensagens com pedido em aberto e no
 * prazo (uma por rascunho). Só admin decide; para os outros, zero.
 */
export function useContagemDeMensagensProntas() {
  const { user, profile } = useAuth();
  const ativo = !!user && profile?.role === "admin";
  const q = useQuery({
    queryKey: ["mensagens-da-semana", "contagem", user?.id],
    enabled: ativo,
    refetchInterval: 60_000,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("operator_approvals")
        .select("report_id")
        .eq("origin", "central")
        .in("status", ["pendente", "adiado"])
        .is("executed_at", null)
        .gt("valid_until", new Date().toISOString())
        .limit(300);
      if (error) return 0;
      return new Set(((data || []) as Array<{ report_id: string }>).map((r) => r.report_id)).size;
    },
  });
  return ativo ? q.data ?? 0 : 0;
}
