/**
 * Vendas dos anuncios: o numero que fecha o funil e que API nenhuma entrega.
 * Quem sabe se o lead virou venda e o dono do negocio. A esteira da o lugar
 * de registrar venda a venda (data, plataforma, campanha, por onde veio,
 * quantas, valor quando se sabe) e grava no diario do cliente, para o dossie
 * e o agente lerem "teve uma venda" na hora de otimizar a campanha.
 */

import { supabase } from "@/integrations/supabase/client";
import { recordMemory } from "@/lib/clientMemory";
import type { CanalVenda, PlataformaAds, VendaFato } from "./esteiraTipos";

export const PLATAFORMAS: Array<{ key: PlataformaAds; rotulo: string; curto: string }> = [
  { key: "meta_ads", rotulo: "Meta Ads", curto: "Meta" },
  { key: "google_ads", rotulo: "Google Ads", curto: "Google" },
  { key: "tiktok_ads", rotulo: "TikTok Ads", curto: "TikTok" },
];

export const CANAIS: Array<{ key: CanalVenda; rotulo: string }> = [
  { key: "whatsapp", rotulo: "WhatsApp" },
  { key: "instagram", rotulo: "Instagram" },
  { key: "site", rotulo: "Site" },
  { key: "telefone", rotulo: "Telefone" },
  { key: "loja", rotulo: "Loja" },
  { key: "outro", rotulo: "Outro" },
];

export function rotuloDaPlataforma(p: VendaFato["plataforma"] | string): string {
  return PLATAFORMAS.find((x) => x.key === p)?.rotulo ?? (p === "organico" ? "Orgânico" : "Outro");
}

export function rotuloDoCanal(c: CanalVenda | string): string {
  return CANAIS.find((x) => x.key === c)?.rotulo ?? "Outro";
}

export function fmtBrl(v: number): string {
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: v % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}

export interface NovaVenda {
  clientId: string;
  data: string;
  plataforma: PlataformaAds;
  campanhaId: string | null;
  campanhaNome: string | null;
  canal: CanalVenda;
  quantidade: number;
  valor: number | null;
  nota: string;
}

function fraseDaVenda(v: NovaVenda): string {
  const q = Math.max(1, Math.floor(v.quantidade));
  const partes = [
    `${q} ${q === 1 ? "venda" : "vendas"}${v.valor !== null ? ` (${fmtBrl(v.valor)})` : ""}`,
    `por ${rotuloDoCanal(v.canal)}`,
    v.campanhaNome ? `da campanha ${v.campanhaNome}` : `via ${rotuloDaPlataforma(v.plataforma)}`,
    `em ${v.data.slice(8, 10)}/${v.data.slice(5, 7)}`,
  ];
  return `${partes.join(" ")}.${v.nota.trim() ? ` ${v.nota.trim()}` : ""}`;
}

/** Grava a venda e anota no diario: uma venda, um registro, um fato para o dossie. */
export async function registrarVenda(v: NovaVenda): Promise<string | null> {
  const quantidade = Math.max(1, Math.floor(v.quantidade));
  const valor = v.valor === null || !Number.isFinite(v.valor) ? null : Math.max(0, Math.round(v.valor * 100) / 100);
  const { data: sessao } = await supabase.auth.getUser();
  const { data, error } = await (supabase as any)
    .from("ads_sales")
    .insert({
      client_id: v.clientId,
      sold_at: v.data,
      platform: v.plataforma,
      campaign_id: v.campanhaId,
      campaign_name: v.campanhaNome,
      channel: v.canal,
      quantity: quantidade,
      value: valor,
      source: "manual",
      note: v.nota.trim() || null,
      created_by: sessao?.user?.id ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return null;
  const id = String((data as { id: string }).id);
  await recordMemory({
    clientId: v.clientId,
    kind: "venda",
    title: v.campanhaNome ? `Venda · ${v.campanhaNome}` : `Venda · ${rotuloDaPlataforma(v.plataforma)}`,
    content: fraseDaVenda({ ...v, quantidade, valor }),
    source: "esteira",
    metadata: { sale_id: id, platform: v.plataforma, campaign_id: v.campanhaId, campaign_name: v.campanhaNome, channel: v.canal, quantity: quantidade, value: valor, sold_at: v.data },
  });
  return id;
}

/** Apaga uma venda registrada por engano. */
export async function apagarVenda(id: string): Promise<boolean> {
  const { error } = await (supabase as any).from("ads_sales").delete().eq("id", id);
  return !error;
}
