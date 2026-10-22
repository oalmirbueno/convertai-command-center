import { supabase } from "@/integrations/supabase/client";
import type { Campanha } from "./mesaV4Api";
import { campanhaSalvar, normalizarBriefing } from "./campanhasApi";

/**
 * Vínculo OPCIONAL da campanha da Mesa com uma campanha de anúncios (22/10/2026, dono: "também pode vincular,
 * opcional, com campanha Ads"). Lê só o que o painel já sincroniza da Meta (ads_campaigns e
 * ads_campaign_daily, as mesmas tabelas da aba Anúncios); nenhuma chamada nova à Meta e nada sobe para lá.
 * O vínculo mora no briefing da campanha (briefing.ads), sem coluna nova. Os anúncios continuam subindo pela
 * Mesa Ads, sempre pausados e com aprovação.
 */

export interface CampanhaDeAds {
  campaign_id: string;
  name: string | null;
  effective_status: string | null;
  objective: string | null;
  updated_at: string | null;
}

export interface DiaDoAds {
  day: string;
  spend: number | null;
  actions: unknown;
  captured_at: string | null;
}

export interface NumerosDoAds {
  gasto: number;
  leads: number;
  dias: number;
  /** Quando a Meta foi lida pela última vez (o frescor do número). */
  lidoEm: string | null;
}

export const chavesDoAds = {
  campanhas: (clientId: string) => ["mesa", "campanha-ads", clientId] as const,
  numeros: (clientId: string, campaignId: string) => ["mesa", "campanha-ads-numeros", clientId, campaignId] as const,
};

/** Os nomes de lead que a Meta usa, do mais específico ao menos (src/lib/adsLanguage.ts): conta só o primeiro achado. */
const ACOES_DE_LEAD = ["onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead", "lead", "leadgen.other"];

export async function lerCampanhasDeAds(clientId: string): Promise<CampanhaDeAds[]> {
  const { data, error } = await (supabase as any)
    .from("ads_campaigns")
    .select("campaign_id, name, effective_status, objective, updated_at")
    .eq("client_id", clientId)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data || []) as CampanhaDeAds[];
}

export async function lerDiasDoAds(clientId: string, campaignId: string, dias = 30): Promise<DiaDoAds[]> {
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await (supabase as any)
    .from("ads_campaign_daily")
    .select("day, spend, actions, captured_at")
    .eq("client_id", clientId)
    .eq("campaign_id", campaignId)
    .gte("day", desde)
    .limit(400);
  if (error) throw error;
  return (data || []) as DiaDoAds[];
}

function leadsDoDia(actions: unknown): number {
  const lista = (Array.isArray(actions) ? actions : []) as { action_type?: string; value?: unknown }[];
  for (const tipo of ACOES_DE_LEAD) {
    const achada = lista.filter((a) => a && a.action_type === tipo)[0];
    if (achada) return Number(achada.value) || 0;
  }
  return 0;
}

/** Gasto e leads somados, quantos dias e o frescor (a leitura mais recente). Função pura. */
export function numerosDoAds(dias: DiaDoAds[]): NumerosDoAds {
  let gasto = 0;
  let leads = 0;
  let lidoEm: string | null = null;
  dias.forEach((d) => {
    gasto += Number(d.spend) || 0;
    leads += leadsDoDia(d.actions);
    if (d.captured_at && (!lidoEm || d.captured_at > lidoEm)) lidoEm = d.captured_at;
  });
  return { gasto: Math.round(gasto * 100) / 100, leads, dias: dias.length, lidoEm };
}

/** O vínculo gravado na campanha, ou null. */
export function adsDaCampanha(c: Pick<Campanha, "briefing">): { campaign_id: string; nome: string; vinculado_em: string } | null {
  const b = normalizarBriefing(c.briefing);
  return b.ads && b.ads.campaign_id ? b.ads : null;
}

/** Vincula (ou, com null, desvincula) sem custo, pelo campanha_salvar. */
export async function vincularAds(c: Campanha, ads: CampanhaDeAds | null) {
  const b = normalizarBriefing(c.briefing);
  const semAds = { ...b };
  delete semAds.ads;
  const briefing = ads ? { ...semAds, ads: { campaign_id: ads.campaign_id, nome: ads.name || ads.campaign_id, vinculado_em: new Date().toISOString() } } : semAds;
  return campanhaSalvar({ campanhaId: c.id, briefing });
}

/** A Mesa Ads do cliente no Estúdio Ads, com a campanha da Mesa (as peças prontas viram criativos lá). */
export const linkDaMesaAds = (clientId: string, campanhaId: string) =>
  `/mesa-ads?client=${encodeURIComponent(clientId)}&etapa=estudio&campanha_mesa=${encodeURIComponent(campanhaId)}`;
