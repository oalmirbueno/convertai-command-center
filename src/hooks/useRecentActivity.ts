import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { MEMORY_LABELS } from "@/lib/clientMemory";

/**
 * O feed de atividade que enxerga o painel inteiro.
 *
 * As "Atualizações Recentes" liam só a tabela de updates — e o painel passou a
 * registrar o trabalho na memória do cliente: ritual enviado, semana do ciclo,
 * avulso feito, relatório publicado, decisão, nota do Studio. Nada disso
 * aparecia no feed, então o dashboard mostrava menos movimento do que houve, e
 * informação se perdia entre as áreas.
 *
 * Aqui as duas fontes viram uma linha do tempo só, ordenada pelo relógio.
 */

export interface ActivityEntry {
  id: string;
  /** De onde veio: "updates" ou o kind da memória (ritual, entrega, avulso...). */
  origin: string;
  /** Rótulo curto em português para o chip do feed. */
  originLabel: string;
  message: string;
  clientId: string | null;
  projectId: string | null;
  created_at: string;
}

const ORIGEM_UPDATES = "movimento";

export function useRecentActivity(limit = 14) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["recent-activity", user?.id, limit],
    queryFn: async (): Promise<ActivityEntry[]> => {
      // As duas fontes em paralelo; se uma falhar, a outra ainda alimenta o
      // feed — atividade parcial é melhor que feed vazio.
      const [updatesRes, memoryRes] = await Promise.all([
        supabase
          .from("updates")
          .select("id, message, project_id, update_type, created_at")
          .order("created_at", { ascending: false })
          .limit(limit),
        (supabase as any)
          .from("project_memory")
          .select("id, client_id, project_id, kind, title, created_at")
          .order("created_at", { ascending: false })
          .limit(limit),
      ]);

      const doUpdates: ActivityEntry[] = (updatesRes.data || []).map((u: any) => ({
        id: `u-${u.id}`,
        origin: ORIGEM_UPDATES,
        originLabel: "Projeto",
        message: String(u.message || ""),
        clientId: null,
        projectId: u.project_id || null,
        created_at: u.created_at,
      }));

      const daMemoria: ActivityEntry[] = ((memoryRes as any).data || [])
        // Nota interna sem título não vira linha de feed: não diz nada.
        .filter((m: any) => String(m.title || "").trim())
        .map((m: any) => ({
          id: `m-${m.id}`,
          origin: String(m.kind || "nota"),
          originLabel: MEMORY_LABELS[String(m.kind)] || "Registro",
          message: String(m.title),
          clientId: m.client_id || null,
          projectId: m.project_id || null,
          created_at: m.created_at,
        }));

      return [...doUpdates, ...daMemoria]
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .slice(0, limit);
    },
    enabled: !!user,
    refetchInterval: 15000,
  });
}
