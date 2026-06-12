// Parser/normalizador para exports de Google Ads, Meta Ads, Social Media e Vendas
// Recebe matriz [headers, ...rows] já lida (CSV ou XLSX) e devolve estrutura unificada.

import * as XLSX from "xlsx";

export type ReportSource = "google_ads" | "meta_ads" | "social_media" | "sales" | "generic";

export interface ParsedReport {
  source: ReportSource;
  sourceLabel: string;
  /** Linhas normalizadas para chart (gráfico evolução): { label, ...colunas numéricas } */
  chartData: Array<Record<string, any>>;
  /** Colunas numéricas detectadas no chart */
  chartColumns: string[];
  /** Linhas brutas normalizadas (campanha/canal/produto + métricas) p/ tabelas/breakdowns */
  rows: Array<Record<string, any>>;
  /** Totais agregados (somatórios) das colunas numéricas */
  totals: Record<string, number>;
  /** Métricas mapeadas para o schema interno (reach, clicks, ad_spend, etc.) */
  metrics: Record<string, number>;
  /** Métricas detectadas como numéricas mas SEM mapeamento → auto-personalizadas */
  customMetrics: Array<{ label: string; value: number }>;
  /** Período inferido a partir de coluna de data, se houver */
  periodStart?: string;
  periodEnd?: string;
  /** Nome de coluna textual usado como dimensão principal (Campaign/Date/Post...) */
  dimensionKey: string;
}

/* ── Normalizadores ──────────────────────────────────────── */
// Remove acentos, espaços, parênteses e qualificadores comuns ("(BRL)", "(todos)",
// "(taxa de cliques no link)" etc.) para que "Valor usado (BRL)" case com "valorusado".
const norm = (s: string) =>
  String(s ?? "").toLowerCase().trim()
    .replace(/\([^)]*\)/g, "")              // remove tudo dentro de parênteses
    .replace(/[\s_\-/.]+/g, "")
    .replace(/[áàâã]/g, "a")
    .replace(/[éê]/g, "e").replace(/[í]/g, "i").replace(/[óôõ]/g, "o").replace(/[ú]/g, "u")
    .replace(/[ç]/g, "c");

const toNumber = (v: any): number => {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;
  let s = String(v).trim().replace(/[R$%\s]/g, "");
  // formato pt-BR "1.234,56" → "1234.56"
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s);
  return isFinite(n) ? n : 0;
};

/* Mapeamento de cabeçalhos comuns → métricas internas
   IMPORTANTE: cada métrica é distinta. NÃO colapsar mensagens/visitas/seguidores no mesmo bucket. */
const HEADER_MAP: Record<string, string> = {
  // ── ALCANCE / IMPRESSÕES ──
  reach: "reach", alcance: "reach", pessoasalcancadas: "reach", contasalcancadas: "reach",
  impressions: "impressions", impressoes: "impressions", impr: "impressions",
  frequency: "frequency", frequencia: "frequency",

  // ── CLIQUES ──
  clicks: "clicks", cliques: "clicks", clicksall: "clicks", cliquestodos: "clicks",
  linkclicks: "link_clicks", clickslink: "link_clicks", cliquesnolink: "link_clicks", cliquesemlink: "link_clicks",
  uniquelinkclicks: "unique_link_clicks", cliquesunicosnolink: "unique_link_clicks",
  landingpageviews: "landing_page_views", visualizacoesdapaginadedestino: "landing_page_views",

  // ── CTR / CPC / CPM ──
  ctr: "ctr", clickthroughrate: "ctr", ctrall: "ctr", ctrtodos: "ctr",
  linkctr: "link_ctr", ctrlink: "link_ctr",
  cpc: "cpc", costperclick: "cpc", customedioporclique: "cpc",
  cpm: "cpm", costpermille: "cpm", costper1000impressions: "cpm",

  // ── INVESTIMENTO ──
  cost: "ad_spend", custo: "ad_spend", spend: "ad_spend", amountspent: "ad_spend",
  amountspentbrl: "ad_spend", valorusado: "ad_spend", valorgasto: "ad_spend",
  investimento: "ad_spend", investido: "ad_spend", totalspent: "ad_spend",

  // ── RESULTADOS / CONVERSÕES (genérico Meta) ──
  results: "results", resultados: "results",
  conversions: "conversions", conversoes: "conversions", allconversions: "conversions",
  costperresult: "cost_per_result", custoporresultado: "cost_per_result",
  costperconversion: "cpa", cpa: "cpa", costperaction: "cpa",

  // ── MENSAGENS (distintas de leads/visitas!) ──
  messagingconversationsstarted: "messages", conversasiniciadasnochat: "messages",
  newmessagingconversations: "messages", novasconversaspormensagens: "messages",
  messages: "messages", mensagens: "messages", mensagensiniciadas: "messages",
  costpermessagingconversation: "cost_per_message", custoporconversadepormensagem: "cost_per_message",

  // ── LEADS (distinto de mensagens) ──
  leads: "leads", cadastros: "leads", costperlead: "cost_per_lead", custoporlead: "cost_per_lead",

  // ── VISITAS DE PERFIL (Instagram/Facebook) ──
  profilevisits: "profile_visits", visitasdeperfil: "profile_visits",
  visitasaoperfil: "profile_visits", profileviews: "profile_visits",

  // ── SEGUIDORES ──
  followers: "followers_total", seguidores: "followers_total",
  newfollowers: "followers_gained", novosseguidores: "followers_gained",
  followsgained: "followers_gained", followersgained: "followers_gained",
  followsfromads: "followers_gained",

  // ── ENGAJAMENTO ──
  engagement: "engagement", engajamento: "engagement",
  engagementrate: "engagement_rate", taxadeengajamento: "engagement_rate",
  postengagement: "post_engagement", interacoescompublicacao: "post_engagement",
  likes: "likes", curtidas: "likes", reactions: "likes", reacoes: "likes",
  comments: "comments", comentarios: "comments",
  shares: "shares", compartilhamentos: "shares",
  saves: "saves", salvamentos: "saves", saved: "saves",

  // ── VÍDEO ──
  videoplays: "video_plays", reproducoesdevideo: "video_plays",
  videoviews: "video_views", visualizacoesdevideo: "video_views",
  thruplays: "thru_plays", reproducoescompletas: "thru_plays",
  videoaveragewatchtime: "video_avg_time", tempomediodereproducao: "video_avg_time",
  costperthruplay: "cost_per_thruplay",

  // ── E-COMMERCE / VENDAS ──
  purchases: "purchases", compras: "purchases",
  addtocart: "add_to_cart", adicoesaocarrinho: "add_to_cart",
  initiatecheckout: "initiate_checkout", finalizacoesdecomprainiciadas: "initiate_checkout",
  addpaymentinfo: "add_payment_info", adicoesdeinformacoesdepagamento: "add_payment_info",
  revenue: "revenue", receita: "revenue", vendas: "revenue", sales: "revenue",
  purchasevalue: "revenue", valordeconversao: "revenue", valordascompras: "revenue",
  orders: "orders", pedidos: "orders",
  roas: "roas", retornosobreinvestimentopublicitario: "roas",
  costperpurchase: "cost_per_purchase", custoporcompra: "cost_per_purchase",

  // ── QUALIDADE / RANKING (Meta) ──
  qualityranking: "quality_ranking", classificacaodequalidade: "quality_ranking",
  engagementrateranking: "engagement_ranking",
  conversionrateranking: "conversion_ranking",

  // ── GOOGLE ADS extra ──
  searchimpressionshare: "search_impression_share", parceladeimpressoesdarededepesquisa: "search_impression_share",
  averageposition: "avg_position", posicaomedia: "avg_position",
  qualityscore: "quality_score", indicedequalidade: "quality_score",
  conversionrate: "conversion_rate", taxadeconversao: "conversion_rate",
};

/** Métricas que são taxas/médias (não somar — calcular média ponderada/simples) */
const RATE_METRICS = new Set([
  "ctr", "link_ctr", "cpc", "cpm", "cpa", "cost_per_result", "cost_per_message",
  "cost_per_lead", "cost_per_purchase", "cost_per_thruplay",
  "engagement_rate", "conversion_rate", "frequency", "avg_position",
  "video_avg_time", "search_impression_share", "roas", "quality_score",
]);

const numericHeaderKeys = new Set(Object.keys(HEADER_MAP));

const SOURCE_HINTS: Array<{ source: ReportSource; label: string; tokens: string[] }> = [
  { source: "google_ads", label: "Google Ads", tokens: ["googleads", "googleadwords", "adwords", "campaigntype", "searchimpressionshare"] },
  { source: "meta_ads", label: "Meta Ads", tokens: ["metaads", "facebookads", "amountspent", "results", "resultados", "reachfrequency", "adsetname", "campaignname"] },
  { source: "social_media", label: "Social Media", tokens: ["postengagement", "engagementrate", "followers", "seguidores", "reels", "stories"] },
  { source: "sales", label: "Vendas", tokens: ["revenue", "receita", "orders", "pedidos", "purchases", "vendas", "ticketmedio", "averageorder"] },
];

function detectSource(headers: string[], firstRow?: any[]): { source: ReportSource; label: string } {
  const joined = headers.map(norm).join("|");
  // Sales vence se houver receita/pedidos sem gasto de mídia
  const hasSpend = headers.some(h => ["spend", "cost", "custo", "investimento", "amountspent"].includes(norm(h)));
  const hasRevenue = headers.some(h => ["revenue", "receita", "vendas", "sales", "orders", "pedidos"].includes(norm(h)));
  if (hasRevenue && !hasSpend) return { source: "sales", label: "Vendas" };

  for (const hint of SOURCE_HINTS) {
    if (hint.tokens.some(t => joined.includes(t))) return { source: hint.source, label: hint.label };
  }
  // Heurística residual: se tem campaign + spend → ads genérico (Meta)
  const hasCampaign = headers.some(h => ["campaign", "campanha", "campaignname"].includes(norm(h)));
  if (hasCampaign && hasSpend) return { source: "meta_ads", label: "Meta Ads" };
  return { source: "generic", label: "Personalizado" };
}

function findDimensionColumn(headers: string[]): { idx: number; key: string; type: "date" | "campaign" | "label" } {
  // 1) coluna de data
  const dateIdx = headers.findIndex(h => /(date|data|day|dia|mes|month|periodo)/i.test(h));
  if (dateIdx >= 0) return { idx: dateIdx, key: headers[dateIdx], type: "date" };
  // 2) campanha/post
  const campIdx = headers.findIndex(h => /(campaign|campanha|adset|conjunto|post|publica)/i.test(h));
  if (campIdx >= 0) return { idx: campIdx, key: headers[campIdx], type: "campaign" };
  // 3) primeira coluna textual
  return { idx: 0, key: headers[0] || "Item", type: "label" };
}

function tryParseDate(v: any): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  // dd/mm/yyyy
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (br) {
    const y = br[3].length === 2 ? `20${br[3]}` : br[3];
    return `${y}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

/** Núcleo: recebe matriz [headers, ...rows] e devolve ParsedReport */
export function parseMatrix(matrix: any[][]): ParsedReport {
  // limpa linhas vazias e remove possíveis linhas-cabeçalho extras (Google Ads exporta 2-3 linhas de meta no topo)
  let cleaned = matrix.filter(r => Array.isArray(r) && r.some(c => c != null && String(c).trim() !== ""));
  // Heurística Google Ads: pula linhas até encontrar uma com "Campaign" ou "Day"
  const startIdx = cleaned.findIndex(r =>
    r.some((c: any) => /(campaign|campanha|day|dia|date|data|ad group|grupo de an)/i.test(String(c ?? "")))
  );
  if (startIdx > 0) cleaned = cleaned.slice(startIdx);

  const headers = (cleaned[0] || []).map((h: any) => String(h ?? "").trim());
  const dataRows = cleaned.slice(1).filter(r => r.some((c: any) => c != null && String(c).trim() !== ""));

  const { source, label: sourceLabel } = detectSource(headers, dataRows[0]);
  const dim = findDimensionColumn(headers);

  // Identifica colunas numéricas (mapeadas OU nome aparente numérico)
  const numericCols: Array<{ idx: number; original: string; clean: string; metricKey?: string }> = [];
  headers.forEach((h, i) => {
    if (i === dim.idx) return;
    const k = norm(h);
    const metricKey = HEADER_MAP[k];
    // testa se a primeira linha de dados parece numérica
    const sample = dataRows.slice(0, 5).map(r => r[i]).filter(v => v != null && String(v).trim() !== "");
    const isNumeric = sample.length > 0 && sample.every(v => !isNaN(toNumber(v)) && String(v).match(/[\d.,]/));
    if (metricKey || isNumeric) {
      numericCols.push({ idx: i, original: h, clean: h.trim(), metricKey });
    }
  });

  // Constrói rows normalizadas
  const rows = dataRows.map(r => {
    const row: Record<string, any> = {};
    row[dim.key] = String(r[dim.idx] ?? "").trim();
    numericCols.forEach(c => { row[c.clean] = toNumber(r[c.idx]); });
    return row;
  }).filter(r => r[dim.key]);

  // chartData: se dimensão for data → ordena por data e agrega; senão agrega por dimensão (top 12)
  let chartData: Array<Record<string, any>> = [];
  let periodStart: string | undefined; let periodEnd: string | undefined;

  if (dim.type === "date") {
    const map = new Map<string, Record<string, number>>();
    rows.forEach(r => {
      const iso = tryParseDate(r[dim.key]) ?? String(r[dim.key]);
      if (!map.has(iso)) map.set(iso, {});
      const acc = map.get(iso)!;
      numericCols.forEach(c => { acc[c.clean] = (acc[c.clean] || 0) + toNumber(r[c.clean]); });
    });
    const dates = Array.from(map.keys()).sort();
    if (dates.length) { periodStart = dates[0]; periodEnd = dates[dates.length - 1]; }
    chartData = dates.map(d => {
      const label = (() => {
        const dt = new Date(d);
        return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
      })();
      return { label, ...map.get(d)! };
    });
  } else {
    // agrega por dimensão e ordena pelo maior gasto/receita/cliques
    const map = new Map<string, Record<string, number>>();
    rows.forEach(r => {
      const k = String(r[dim.key]);
      if (!map.has(k)) map.set(k, {});
      const acc = map.get(k)!;
      numericCols.forEach(c => { acc[c.clean] = (acc[c.clean] || 0) + toNumber(r[c.clean]); });
    });
    const sortKey = numericCols.find(c => c.metricKey === "ad_spend")?.clean
      ?? numericCols.find(c => c.metricKey === "revenue")?.clean
      ?? numericCols.find(c => c.metricKey === "clicks")?.clean
      ?? numericCols[0]?.clean;
    const arr = Array.from(map.entries()).map(([k, v]) => ({ label: k, ...v }));
    if (sortKey) arr.sort((a, b) => (Number(b[sortKey]) || 0) - (Number(a[sortKey]) || 0));
    chartData = arr.slice(0, 12);
  }

  // Totais e métricas internas
  const totals: Record<string, number> = {};
  numericCols.forEach(c => {
    totals[c.clean] = rows.reduce((s, r) => s + (Number(r[c.clean]) || 0), 0);
  });
  const metrics: Record<string, number> = {};
  numericCols.forEach(c => {
    if (!c.metricKey) return;
    if (RATE_METRICS.has(c.metricKey)) {
      const vals = rows.map(r => Number(r[c.clean]) || 0).filter(v => v > 0);
      metrics[c.metricKey] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    } else {
      metrics[c.metricKey] = totals[c.clean];
    }
  });

  // Colunas numéricas SEM mapeamento → viram métricas "personalizadas" (totalizadas)
  const customMetrics: Array<{ label: string; value: number }> = numericCols
    .filter(c => !c.metricKey)
    .map(c => ({ label: c.clean, value: Math.round((totals[c.clean] || 0) * 100) / 100 }))
    .filter(m => m.value !== 0);

  return {
    source, sourceLabel, chartData,
    chartColumns: numericCols.map(c => c.clean),
    rows, totals, metrics, customMetrics, periodStart, periodEnd,
    dimensionKey: dim.key,
  };
}

/* ── Entradas ────────────────────────────────────────────── */
export async function parseFile(file: File): Promise<ParsedReport> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "csv" || ext === "tsv" || ext === "txt") {
    const text = await file.text();
    const sep = text.split("\n")[0]?.includes(";") ? ";" : (ext === "tsv" ? "\t" : ",");
    const matrix = text.split(/\r?\n/).map(line =>
      // split simples respeitando aspas
      line.match(new RegExp(`(?:"([^"]*)")|([^${sep}]+)`, "g"))?.map(c => c.replace(/^"|"$/g, "").trim()) ?? []
    );
    return parseMatrix(matrix);
  }
  // xlsx/xls
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const matrix: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
  return parseMatrix(matrix);
}
