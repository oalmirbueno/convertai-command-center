import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { AdsDailyRow } from "@/lib/adsLanguage";

/**
 * Campanhas REAIS do Meta Ads, colhidas pelo banco de hora em hora.
 *
 * Mesma divisão de acesso do resto do painel: a equipe vê os clientes da sua
 * carteira, o cliente vê só o dele. Quem separa é a RLS, não o front — aqui a
 * consulta é a mesma para os dois.
 */

export interface AdsCampaign {
  id: string;
  client_id: string;
  external_account_id: string;
  campaign_id: string;
  name: string | null;
  status: string | null;
  effective_status: string | null;
  objective: string | null;
  daily_budget: number | null;
  lifetime_budget: number | null;
  start_time: string | null;
  stop_time: string | null;
  updated_at: string;
}

export interface AdsDaily extends AdsDailyRow {
  id: string;
  client_id: string;
  external_account_id: string;
  captured_at: string;
}

/** A ficha das campanhas: nome, situação e verba. */
export function useAdsCampaigns(clientId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["ads-campaigns", user?.id, clientId ?? "all"],
    queryFn: async () => {
      let query = (supabase as any)
        .from("ads_campaigns")
        .select(
          "id, client_id, external_account_id, campaign_id, name, status, effective_status, objective, daily_budget, lifetime_budget, start_time, stop_time, updated_at",
        )
        .order("updated_at", { ascending: false })
        .limit(500);
      if (clientId) query = query.eq("client_id", clientId);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as AdsCampaign[];
    },
    enabled: !!user,
    staleTime: 60_000,
  });
}

/**
 * Os dias das campanhas. O padrão de 30 dias acompanha a janela que o banco
 * coleta: pedir mais que isso devolveria vazio e pareceria erro.
 */
export function useAdsDaily(clientId?: string, dias = 30) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["ads-daily", user?.id, clientId ?? "all", dias],
    queryFn: async () => {
      const desde = new Date();
      desde.setDate(desde.getDate() - dias);
      const iso = `${desde.getFullYear()}-${String(desde.getMonth() + 1).padStart(2, "0")}-${String(desde.getDate()).padStart(2, "0")}`;

      let query = (supabase as any)
        .from("ads_campaign_daily")
        .select("*")
        .gte("day", iso)
        .order("day", { ascending: false })
        .limit(5000);
      if (clientId) query = query.eq("client_id", clientId);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as AdsDaily[];
    },
    enabled: !!user,
    staleTime: 60_000,
  });
}

/** Situação da conexão com o Meta: quem já está ligado e quando leu por último. */
export interface AdsConnectionStatus {
  agencia: { label: string; saved_at: string } | null;
  contas: Array<{
    id: string;
    client_id: string;
    display_name: string;
    external_id: string | null;
    status: string;
    token_proprio: boolean;
    ultima_coleta: string | null;
  }>;
}

export function useAdsConnection() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["ads-connection", user?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("meta_ads_connection_status", {});
      if (error) throw error;
      return (data || { agencia: null, contas: [] }) as AdsConnectionStatus;
    },
    enabled: !!user,
    staleTime: 30_000,
  });
}

export async function collectAdsMetricsNow() {
  const { data, error } = await (supabase as any).rpc("collect_ads_metrics_now", {});
  if (error) throw error;
  return data as { since: string; until: string; dispatched: number; parsed: number };
}

/** Guarda o token de leitura do Meta Ads. Só administrador; o token vai ao cofre. */
export async function saveMetaAdsToken(token: string, label: string) {
  const { data, error } = await (supabase as any).rpc("save_meta_ads_token", {
    _token: token,
    _label: label,
  });
  if (error) throw error;
  return data as { id: string; saved_at: string };
}

/**
 * Liga uma conta de anúncios a um cliente.
 *
 * A conta entra na MESMA tabela das contas de Instagram e Facebook, com
 * platform 'meta_ads'. Nada de cadastro paralelo: o que já existe de permissão
 * e de tela de conexão passa a valer para anúncios sem alteração.
 */
export async function connectAdsAccount(input: {
  clientId: string;
  actId: string;
  displayName: string;
}) {
  // A pessoa cola "act_123456" ou só "123456"; a Graph API quer o número.
  const numero = String(input.actId).trim().replace(/^act_/i, "");
  if (!/^\d{5,}$/.test(numero)) {
    throw new Error("O número da conta de anúncios deve ter só dígitos (ex.: 123456789012345).");
  }
  const { data, error } = await (supabase as any)
    .from("external_accounts")
    .insert({
      client_id: input.clientId,
      platform: "meta_ads",
      external_id: numero,
      display_name: input.displayName.trim() || `Conta ${numero}`,
      status: "active",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data as { id: string };
}
