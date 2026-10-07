import type { AdsCampaign, AdsDaily } from "@/hooks/useAdsMetrics";
import { summarizeCampaign } from "./adsLanguage";

export const chaveCampanha = (c: { client_id: string; external_account_id: string; campaign_id: string }) => [c.client_id, c.external_account_id, c.campaign_id].join(":");
export function carteiraPerformance(campanhas: AdsCampaign[], dias: AdsDaily[], agora = Date.now()) {
  const mapa = new Map<string, AdsDaily[]>();
  for (const dia of dias) { const k = chaveCampanha(dia); mapa.set(k, [...(mapa.get(k) || []), dia]); }
  return campanhas.map(c => {
    const linhas = mapa.get(chaveCampanha(c)) || [];
    const ultimoDia = linhas.map(x => x.day).sort().at(-1) || null;
    const corte = linhas.map(x => x.captured_at).filter(Boolean).sort().at(-1) || null;
    const frescor = !!corte && agora - Date.parse(corte) < 36 * 3600000;
    const diaRecente = !!ultimoDia && agora - Date.parse(`${ultimoDia}T00:00:00Z`) < 3 * 86400000;
    const observacao = linhas.filter(x => x.day === ultimoDia);
    const entrega = observacao.some(x => Number(x.impressions) > 0 || Number(x.spend) > 0);
    const medicao = observacao.some(x => x.impressions != null || x.spend != null);
    const situacao = !medicao || !frescor || !diaRecente ? "desatualizada" : entrega ? "entrega" : "sem_entrega";
    const fim = c.stop_time ? Date.parse(c.stop_time) : NaN;
    const ativa = c.status === "ACTIVE";
    return { campanha: c, resumo: summarizeCampaign(linhas), corte, ultimoDia, situacao,
      divergencia: ativa && (fim < agora || situacao === "sem_entrega"),
      proxima: fim >= agora && fim - agora <= 3 * 86400000,
      vencida: fim < agora,
    };
  });
}

export function execucaoReal(runs: Array<{ status: string; heartbeat_at?: string; timeout_seconds?: number }>, agora = Date.now()) {
  return runs.some(r => ["started", "progress"].includes(r.status) && !!r.heartbeat_at && agora - Date.parse(r.heartbeat_at) < (r.timeout_seconds || 900) * 1000);
}
