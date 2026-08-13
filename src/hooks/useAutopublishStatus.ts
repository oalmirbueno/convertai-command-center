import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Estado da publicação automática de uma publicação editorial.
 *
 * Existe porque o erro do motor ficava gravado num canto que o painel não lia:
 * a publicação falhava e continuava eternamente com o selo de "Programado",
 * sem ninguém saber. Agora a equipe vê em que passo está e qual foi o erro.
 *
 * Só a equipe enxerga. A view no banco já filtra por quem pode ver o cliente.
 */

export interface AutopublishStatus {
  publication_id: string;
  client_id: string;
  stage: "queued" | "children" | "parent" | "publish" | "permalink" | "done" | "failed";
  attempts: number;
  last_error: string | null;
  permalink: string | null;
  created_at: string;
  updated_at: string;
}

export const AUTOPUBLISH_STAGE_LABELS: Record<AutopublishStatus["stage"], string> = {
  queued: "Na fila para publicar",
  children: "Enviando os cartões do carrossel",
  parent: "Montando o carrossel",
  publish: "Publicando no Instagram",
  permalink: "Confirmando o link do post",
  done: "Publicado pelo painel",
  failed: "Não conseguiu publicar",
};

export function useAutopublishStatus(publicationId?: string | null, enabled = true) {
  return useQuery({
    queryKey: ["autopublish-status", publicationId],
    queryFn: async (): Promise<AutopublishStatus | null> => {
      if (!publicationId) return null;
      const { data, error } = await (supabase as any)
        .from("autopublish_status_secure")
        .select("*")
        .eq("publication_id", publicationId)
        .limit(1);
      // A view só existe depois da migração; sem ela a tela segue normal.
      if (error) return null;
      return (data && data[0]) || null;
    },
    enabled: enabled && !!publicationId,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
