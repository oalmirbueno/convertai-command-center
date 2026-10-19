import { useQuery } from "@tanstack/react-query";
import { Megaphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { juntar } from "@/components/sistema";
import type { OrigemDoClique } from "../../../supabase/functions/_shared/origem-clique";
import { fraseDaOrigem, origemDoLead, type LeadComOrigem, type NomesDoAnuncio } from "./leadsDosAnuncios";

/**
 * "Veio do anúncio X" no lead do CRM (19/10/2026). O nome do anúncio e da
 * campanha vêm de ads_creatives e ads_campaigns (lidos da Meta); quando a
 * peça ainda não foi lida (ou é de conta que esta pessoa não vê), fica o id
 * do link. Lead com UTM sem anúncio (ex.: link do Instagram com
 * utm_source) mostra a fonte e a campanha do link. Sem origem, nada.
 */


async function nomesDoAnuncio(o: OrigemDoClique): Promise<NomesDoAnuncio> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- origem_clique e as tabelas de ads fora dos tipos gerados
  const db = supabase as any;
  let anuncio: string | null = null;
  let campanhaId = o.campaign_id || null;
  if (o.ad_id) {
    const { data } = await db.from("ads_creatives").select("ad_name, campaign_id").eq("ad_id", o.ad_id).limit(1);
    const linha = ((data || []) as Array<{ ad_name: string | null; campaign_id: string | null }>)[0];
    if (linha) {
      anuncio = linha.ad_name;
      campanhaId = campanhaId || linha.campaign_id;
    }
  }
  let campanha: string | null = null;
  if (campanhaId) {
    const { data } = await db.from("ads_campaigns").select("name").eq("campaign_id", campanhaId).limit(1);
    const linha = ((data || []) as Array<{ name: string | null }>)[0];
    if (linha) campanha = linha.name;
  }
  return { anuncio, campanha };
}

export default function OrigemDoLead({ lead, className = "" }: { lead: Pick<LeadComOrigem, "id" | "origem_clique">; className?: string }) {
  const o = origemDoLead(lead);
  const comAnuncio = !!o && !!(o.ad_id || o.campaign_id);
  const { data: nomes } = useQuery({
    queryKey: ["ads-nome-da-origem", o?.ad_id || "", o?.campaign_id || ""],
    queryFn: () => nomesDoAnuncio(o as OrigemDoClique),
    enabled: comAnuncio,
    staleTime: 5 * 60_000,
  });
  if (!o) return null;
  const frase = fraseDaOrigem(o, nomes);
  const detalhe = Object.entries(o)
    .map(([k, v]) => `${k}=${v}`)
    .join(" · ");
  return (
    <p className={juntar("flex min-w-0 items-center text-[12px] leading-4 text-muted-foreground", className)} title={detalhe} data-origem-do-lead="">
      <Megaphone className="mr-1 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
      <span className="min-w-0 truncate">{frase}</span>
    </p>
  );
}
