import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type AreaDosAvisos = "painel" | "agentes";
// Os mesmos filtros são usados na lista, contagem e marcação em lote.
export function filtrarArea<T>(query: T, area: AreaDosAvisos): T {
  const q = query as any;
  return area === "agentes"
    ? q.or("notification_type.like.operator%,link.like./execucao%")
    : q.not("notification_type", "like", "operator%").or("link.is.null,link.not.like./execucao%");
}
export function useAvisosPorArea(area: AreaDosAvisos, soNaoLidas: boolean, aberto: boolean) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["notifications", user?.id, "area", area, soNaoLidas],
    enabled: !!user && aberto,
    queryFn: async () => {
      let lista = filtrarArea(supabase.from("notifications").select("*").eq("user_id", user!.id), area);
      if (soNaoLidas) lista = lista.eq("read", false);
      const [rows, count] = await Promise.all([
        lista.order("created_at", { ascending: false }).limit(100),
        filtrarArea(supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user!.id).eq("read", false), area),
      ]);
      if (rows.error || count.error) throw rows.error || count.error;
      return { lista: rows.data || [], naoLidas: count.count || 0 };
    },
    refetchInterval: aberto ? 15_000 : false,
  });
}
export async function marcarAreaComoLida(userId: string, area: AreaDosAvisos) {
  const { error } = await filtrarArea(supabase.from("notifications").update({ read: true }).eq("user_id", userId).eq("read", false), area);
  if (error) throw error;
}
