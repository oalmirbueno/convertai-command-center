import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// Metricas REAIS do Instagram, coletadas pelo banco toda semana fechada
// (segunda a domingo). Staff ve todos os clientes; cliente ve so o proprio.
export interface SocialMetricsWeek {
  id: string;
  client_id: string;
  external_account_id: string;
  platform: string;
  week_start: string;
  week_end: string;
  captured_at: string;
  followers: number | null;
  media_count: number | null;
  reach: number | null;
  profile_views: number | null;
  accounts_engaged: number | null;
  total_interactions: number | null;
}

export function useSocialMetricsWeekly(clientId?: string, weeks = 26) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["social-metrics-weekly", user?.id, clientId ?? "all", weeks],
    queryFn: async () => {
      let query = (supabase as any)
        .from("social_metrics_weekly")
        .select(
          "id, client_id, external_account_id, platform, week_start, week_end, captured_at, followers, media_count, reach, profile_views, accounts_engaged, total_interactions",
        )
        .order("week_start", { ascending: false })
        .limit(clientId ? weeks : 400);
      if (clientId) query = query.eq("client_id", clientId);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as SocialMetricsWeek[];
    },
    enabled: !!user,
    staleTime: 60_000,
  });
}

export async function collectSocialMetricsNow() {
  const { data, error } = await (supabase as any).rpc(
    "collect_social_metrics_now",
    {},
  );
  if (error) throw error;
  return data as { week_start: string; dispatched: number; parsed: number };
}

export function formatMetricNumber(value: number | null | undefined) {
  if (value == null) return "-";
  return new Intl.NumberFormat("pt-BR").format(value);
}

// Variacao percentual entre a semana mais recente e a anterior, por campo.
export function weekDeltaPct(
  rows: SocialMetricsWeek[],
  field: keyof Pick<
    SocialMetricsWeek,
    "followers" | "reach" | "total_interactions" | "profile_views" | "accounts_engaged"
  >,
) {
  const withValue = rows.filter((row) => row[field] != null);
  if (withValue.length < 2) return null;
  const [latest, previous] = withValue;
  const prev = Number(previous[field]);
  if (!prev) return null;
  return ((Number(latest[field]) - prev) / prev) * 100;
}
