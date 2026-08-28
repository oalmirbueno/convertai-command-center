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
  // collect_ads_now colhe campanhas E criativos na mesma passada. Chamar só
  // o de campanhas deixaria as peças paradas esperando o cron, e quem
  // aperta "atualizar" quer ver a tela inteira mudar, não metade dela.
  const { data, error } = await (supabase as any).rpc("collect_ads_now", {});
  if (error) throw error;
  return data as {
    campanhas: { dispatched: number; parsed: number };
    criativos: { dispatched: number; parsed: number };
  };
}

export interface CriativoBruto {
  ad_id: string;
  ad_name: string | null;
  campaign_id: string | null;
  thumbnail_url: string | null;
  image_url: string | null;
  video_id: string | null;
  titulo: string | null;
  corpo: string | null;
  effective_status: string | null;
  status: string | null;
}

/**
 * Os criativos de um cliente, com o desempenho de cada peça somado.
 *
 * Duas consultas em vez de uma junção: a ficha da peça vive numa tabela e
 * os números diários em outra, e trazer o produto das duas pelo banco
 * repetiria a ficha uma vez por dia de dado. Somar aqui é mais barato e
 * mantém a leitura simples.
 */
export function useAdsCreatives(clientId?: string, dias = 30) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["ads-creatives", user?.id, clientId ?? "all", dias],
    queryFn: async () => {
      const desde = new Date();
      desde.setUTCDate(desde.getUTCDate() - (dias - 1));
      const desdeIso = desde.toISOString().slice(0, 10);

      let fichas = (supabase as any)
        .from("ads_creatives")
        .select(
          "ad_id, ad_name, campaign_id, thumbnail_url, image_url, video_id, titulo, corpo, status, effective_status",
        )
        .order("updated_at", { ascending: false })
        .limit(300);
      let numeros = (supabase as any)
        .from("ads_creative_daily")
        .select("ad_id, day, spend, impressions, reach, clicks, link_clicks")
        .gte("day", desdeIso)
        .limit(2000);

      if (clientId) {
        fichas = fichas.eq("client_id", clientId);
        numeros = numeros.eq("client_id", clientId);
      }

      const [f, n] = await Promise.all([fichas, numeros]);
      if (f.error) throw f.error;
      if (n.error) throw n.error;

      const porPeca = new Map<string, any[]>();
      for (const linha of (n.data || []) as any[]) {
        const lista = porPeca.get(linha.ad_id);
        if (lista) lista.push(linha);
        else porPeca.set(linha.ad_id, [linha]);
      }
      const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

      return ((f.data || []) as CriativoBruto[]).map((peca) => {
        const seus = porPeca.get(peca.ad_id) ?? [];
        const gasto = seus.reduce((t, l) => t + num(l.spend), 0);
        const impressoes = seus.reduce((t, l) => t + num(l.impressions), 0);
        const cliques = seus.reduce((t, l) => t + num(l.clicks), 0);
        const cliquesNoLink = seus.reduce((t, l) => t + num(l.link_clicks), 0);
        return {
          ad_id: peca.ad_id,
          ad_name: peca.ad_name,
          campaign_id: peca.campaign_id,
          thumbnail_url: peca.thumbnail_url,
          image_url: peca.image_url,
          video_id: peca.video_id,
          titulo: peca.titulo,
          corpo: peca.corpo,
          effective_status: peca.effective_status ?? peca.status,
          gasto,
          impressoes,
          cliques,
          cliques_no_link: cliquesNoLink,
          // Alcance NÃO soma: a mesma pessoa alcançada em dois dias não são
          // duas pessoas. O maior dia é o piso honesto.
          maior_alcance: seus.reduce((m, l) => Math.max(m, num(l.reach)), 0),
          ctr: impressoes > 0 ? (cliques / impressoes) * 100 : null,
          custo_no_link: cliquesNoLink > 0 ? gasto / cliquesNoLink : null,
          dias_com_dado: seus.length,
        };
      });
    },
    enabled: !!user,
    staleTime: 60_000,
  });
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
