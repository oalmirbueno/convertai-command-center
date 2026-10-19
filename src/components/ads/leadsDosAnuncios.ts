import type { Lead } from "@/lib/comercial";
import { lerOrigemDoClique, veioDeAnuncio, type OrigemDoClique } from "../../../supabase/functions/_shared/origem-clique";

/**
 * Leads no CRM por anúncio e por campanha (19/10/2026, ideia 8 do estudo do
 * ClickMax), e o frescor dos dados da Meta.
 *
 * De onde vem cada dado:
 * - o lead e a origem do clique: commercial_leads.origem_clique, gravada pelo
 *   formulário do site da Mesa Site (função site-formulario);
 * - o anúncio e a campanha: ads_creatives (ad_id, ad_name, campaign_id) e
 *   ads_campaigns (campaign_id, name), lidos da Meta de hora em hora;
 * - o frescor: ultima_coleta de cada conta (meta_ads_connection_status, o
 *   maior entre o retrato da conta e o captured_at dos dias).
 *
 * Ligação: primeiro pelo id (ad_id e campaign_id do link, o padrão
 * utm_content={{ad.id}}). Sem id, pelo NOME só quando o lead é deste cliente
 * (qualificacao.client_id): a casa já usou utm_content com o nome do
 * anúncio, e nome igual em outro cliente não pode puxar lead alheio.
 *
 * Puro e sem expressão regular (piso Safari 11).
 */

export type PecaParaLigar = { ad_id: string; ad_name: string | null; campaign_id: string | null };
export type CampanhaParaLigar = { campaign_id: string; name: string | null };

export type LeadComOrigem = Lead & { origem_clique?: OrigemDoClique | null };

const nome = (v: string | null | undefined) => String(v || "").trim().toLowerCase();

/** A origem do lead, conferida (o jsonb do banco passa pela mesma régua da captura). */
export const origemDoLead = (lead: Pick<LeadComOrigem, "origem_clique">): OrigemDoClique | null => lerOrigemDoClique(lead.origem_clique);

export interface LigacaoDoLead {
  adId: string | null;
  campaignId: string | null;
  /** "id" quando veio o id no link; "nome" quando casou pelo nome do anúncio ou da campanha. */
  pelo: "id" | "nome" | null;
}

/** De qual anúncio e campanha este lead veio, pelas peças e campanhas conhecidas. */
export function ligacaoDoLead(
  lead: LeadComOrigem,
  pecas: PecaParaLigar[],
  campanhas: CampanhaParaLigar[],
  clientId?: string,
): LigacaoDoLead {
  const o = origemDoLead(lead);
  if (!o) return { adId: null, campaignId: null, pelo: null };
  let adId = o.ad_id || null;
  let campaignId = o.campaign_id || null;
  let pelo: LigacaoDoLead["pelo"] = adId || campaignId ? "id" : null;
  const doCliente = !!clientId && !!lead.qualificacao && lead.qualificacao.client_id === clientId;
  if (!adId && doCliente && o.utm_content) {
    const alvo = nome(o.utm_content);
    const peca = pecas.find((p) => nome(p.ad_name) === alvo);
    if (peca) {
      adId = peca.ad_id;
      pelo = pelo || "nome";
    }
  }
  if (!campaignId && adId) {
    const peca = pecas.find((p) => p.ad_id === adId);
    if (peca && peca.campaign_id) campaignId = peca.campaign_id;
  }
  if (!campaignId && doCliente && o.utm_campaign) {
    const alvo = nome(o.utm_campaign);
    const campanha = campanhas.find((c) => nome(c.name) === alvo);
    if (campanha) {
      campaignId = campanha.campaign_id;
      pelo = pelo || "nome";
    }
  }
  return { adId, campaignId, pelo: adId || campaignId ? pelo : null };
}

export interface LeadsPorAnuncio {
  porAnuncio: Map<string, LeadComOrigem[]>;
  porCampanha: Map<string, LeadComOrigem[]>;
}

/** Agrupa os leads por anúncio e por campanha (os mais novos primeiro). */
export function ligarLeadsAosAnuncios(
  leads: LeadComOrigem[],
  pecas: PecaParaLigar[],
  campanhas: CampanhaParaLigar[],
  clientId?: string,
): LeadsPorAnuncio {
  const porAnuncio = new Map<string, LeadComOrigem[]>();
  const porCampanha = new Map<string, LeadComOrigem[]>();
  const somar = (mapa: Map<string, LeadComOrigem[]>, chave: string, lead: LeadComOrigem) => {
    const lista = mapa.get(chave);
    if (lista) lista.push(lead);
    else mapa.set(chave, [lead]);
  };
  const ordenados = [...leads].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  for (const lead of ordenados) {
    const l = ligacaoDoLead(lead, pecas, campanhas, clientId);
    if (l.adId) somar(porAnuncio, l.adId, lead);
    if (l.campaignId) somar(porCampanha, l.campaignId, lead);
  }
  return { porAnuncio, porCampanha };
}

/* ─────────────────────────────── origem no lead ─────────────────────────────── */

/** Nomes lidos da Meta para o anúncio e a campanha do lead (ads_creatives e ads_campaigns). */
export type NomesDoAnuncio = { anuncio: string | null; campanha: string | null };

/** A frase da origem, sem nome lido: só o que veio no link. */
export function fraseDaOrigem(o: OrigemDoClique, nomes?: NomesDoAnuncio | null): string {
  if (veioDeAnuncio(o)) {
    const anuncio = (nomes && nomes.anuncio) || o.ad_id || "";
    const campanha = (nomes && nomes.campanha) || o.utm_campaign || o.campaign_id || "";
    if (anuncio) return `Veio do anúncio ${anuncio}${campanha ? ` · campanha ${campanha}` : ""}`;
    if (campanha) return `Veio da campanha ${campanha}`;
    return "Veio de um anúncio da Meta (clique sem o id do anúncio)";
  }
  const partes = [o.utm_source, o.utm_medium, o.utm_campaign, o.utm_content].filter(Boolean);
  return partes.length ? `Veio pelo link ${partes.join(" · ")}` : "Veio por um link com parâmetros";
}

/* ─────────────────────────────── frescor ─────────────────────────────── */

/** Passou disto, os dados da Meta estão velhos (a leitura é de hora em hora). */
export const LIMITE_DO_FRESCOR_HORAS = 24;

export interface FrescorDaMeta {
  /** "há 12 min", "há 3 h", "há 2 dias"; vazio sem leitura. */
  curto: string;
  /** A frase inteira, para o title e o leitor de tela. */
  frase: string;
  horas: number | null;
  /** Passou de 24 h sem leitura nova. */
  velho: boolean;
}

/** A leitura mais nova entre as contas ativas (ultima_coleta). */
export function ultimaLeituraDasContas(contas: Array<{ status: string; ultima_coleta: string | null }>): string | null {
  let maior: string | null = null;
  for (const c of contas) {
    if (c.status !== "active" || !c.ultima_coleta) continue;
    if (!maior || new Date(c.ultima_coleta).getTime() > new Date(maior).getTime()) maior = c.ultima_coleta;
  }
  return maior;
}

export function frescorDaMeta(ultima: string | null | undefined, agora: Date = new Date()): FrescorDaMeta {
  const t = ultima ? new Date(ultima).getTime() : NaN;
  if (!Number.isFinite(t)) return { curto: "", frase: "Ainda sem leitura da Meta.", horas: null, velho: false };
  const min = Math.max(0, Math.round((agora.getTime() - t) / 60000));
  const horas = min / 60;
  let curto: string;
  if (min < 2) curto = "agora";
  else if (min < 60) curto = `há ${min} min`;
  else if (horas < 48) curto = `há ${Math.floor(horas)} h`;
  else curto = `há ${Math.floor(horas / 24)} dias`;
  const velho = horas > LIMITE_DO_FRESCOR_HORAS;
  const quando = curto === "agora" ? "de agora" : `de ${curto}`;
  const frase = velho
    ? `Dados da Meta ${quando}: passou de ${LIMITE_DO_FRESCOR_HORAS} h sem leitura nova. Toque em atualizar ou confira a conexão da conta.`
    : `Dados da Meta ${quando}.`;
  return { curto, frase, horas, velho };
}
