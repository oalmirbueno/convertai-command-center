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

// Publicacoes recentes da conta, com curtidas e comentarios reais da Meta.
export interface SocialPostMetric {
  id: string;
  client_id: string;
  external_account_id: string;
  media_id: string;
  media_type: string | null;
  caption: string | null;
  permalink: string | null;
  media_url: string | null;
  thumbnail_url: string | null;
  posted_at: string | null;
  like_count: number | null;
  comments_count: number | null;
  reach: number | null;
  saved: number | null;
  shares: number | null;
  total_interactions: number | null;
  captured_at: string;
}

/**
 * Uma conta por vez, nunca o cliente inteiro.
 *
 * Um cliente pode ter DUAS contas de Instagram (a AcelerIQ tem @aceleriq e
 * @sitebolt; a Acerbi tem @acerbispc e @cmeacerbi2025). As linhas semanais
 * vem misturadas, ordenadas so por semana: "a mais recente" era a conta que
 * o banco devolvesse primeiro, e a variacao comparava a semana de UMA conta
 * com a mesma semana da OUTRA - 500 seguidores contra 53 virava "-89%".
 * Agrupar por conta e o unico jeito de os numeros serem os da conta.
 */
export function agruparPorConta<T extends { external_account_id: string }>(rows: T[] | undefined) {
  const porConta = new Map<string, T[]>();
  for (const row of rows || []) {
    const lista = porConta.get(row.external_account_id) || [];
    lista.push(row);
    porConta.set(row.external_account_id, lista);
  }
  return porConta;
}

/**
 * A conta que representa o cliente quando so cabe uma (rituais, resumo):
 * a de maior alcance na ultima semana, e no empate a de mais seguidores.
 * E sinal, nao sorteio.
 */
export function contaPrincipal(rows: SocialMetricsWeek[] | undefined): SocialMetricsWeek[] {
  const porConta = agruparPorConta(rows);
  let melhor: SocialMetricsWeek[] = [];
  for (const lista of porConta.values()) {
    const a = lista[0];
    const b = melhor[0];
    if (!b) { melhor = lista; continue; }
    const alcanceA = a.reach ?? -1, alcanceB = b.reach ?? -1;
    if (alcanceA > alcanceB || (alcanceA === alcanceB && (a.followers ?? -1) > (b.followers ?? -1))) melhor = lista;
  }
  return melhor;
}

export function useSocialPostMetrics(clientId?: string, limit = 25, accountId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["social-post-metrics", user?.id, clientId ?? "all", limit, accountId ?? "all"],
    queryFn: async () => {
      let query = (supabase as any)
        .from("social_post_metrics")
        .select("*")
        .order("posted_at", { ascending: false })
        .limit(limit);
      if (clientId) query = query.eq("client_id", clientId);
      if (accountId) query = query.eq("external_account_id", accountId);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as SocialPostMetric[];
    },
    enabled: !!user && !!clientId,
    staleTime: 60_000,
  });
}

// Identidade visual do Instagram (foto, @, nome, bio, site) coletada pelo robo.
export interface SocialClientIdentity {
  client_id: string;
  external_account_id: string;
  username: string | null;
  display_name: string | null;
  biography: string | null;
  website: string | null;
  profile_picture_url: string | null;
  captured_at: string;
}

export function useSocialClientIdentity(clientId?: string, accountId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["social-client-identity", user?.id, clientId ?? "none", accountId ?? "any"],
    queryFn: async () => {
      let query = (supabase as any)
        .from("social_client_identity")
        .select("*")
        .eq("client_id", clientId);
      // Com a conta informada, a identidade e DAQUELA conta - e nao a mais
      // recente do cliente, que pode ser a outra.
      if (accountId) query = query.eq("external_account_id", accountId);
      const { data, error } = await query
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data || null) as SocialClientIdentity | null;
    },
    enabled: !!user && !!clientId,
    staleTime: 300_000,
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

/** A semana ainda esta correndo? (week_end e hoje ou depois) */
export function semanaEmAndamento(row: Pick<SocialMetricsWeek, "week_end">) {
  const hoje = new Date();
  const hojeISO = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
  return row.week_end >= hojeISO;
}

// Variacao percentual entre a semana mais recente e a anterior, por campo.
//
// So entre semanas FECHADAS. O robo tambem grava a semana em andamento
// (coleta diaria); comparar 3 dias com 7 dava "alcance -89%" em toda conta
// na quarta-feira - numero real, leitura falsa. Com a semana aberta no topo,
// a variacao mostrada e a da ultima semana fechada contra a anterior.
export function weekDeltaPct(
  rows: SocialMetricsWeek[],
  field: keyof Pick<
    SocialMetricsWeek,
    "followers" | "reach" | "total_interactions" | "profile_views" | "accounts_engaged"
  >,
) {
  const withValue = rows.filter((row) => row[field] != null && !semanaEmAndamento(row));
  if (withValue.length < 2) return null;
  const [latest, previous] = withValue;
  const prev = Number(previous[field]);
  if (!prev) return null;
  return ((Number(latest[field]) - prev) / prev) * 100;
}
