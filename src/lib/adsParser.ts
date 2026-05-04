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
  /** Período inferido a partir de coluna de data, se houver */
  periodStart?: string;
  periodEnd?: string;
  /** Nome de coluna textual usado como dimensão principal (Campaign/Date/Post...) */
  dimensionKey: string;
}

/* ── Normalizadores ──────────────────────────────────────── */
const norm = (s: string) =>
  String(s ?? "").toLowerCase().trim().replace(/[\s_\-]+/g, "").replace(/[áàâã]/g, "a")
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

/* Mapeamento de cabeçalhos comuns → métricas internas */
const HEADER_MAP: Record<string, string> = {
  // alcance/impressões
  reach: "reach", alcance: "reach", impressions: "impressions", impressoes: "impressions",
  // cliques
  clicks: "clicks", cliques: "clicks", linkclicks: "clicks", clickslink: "clicks",
  // ctr
  ctr: "ctr", clickthroughrate: "ctr",
  // gasto
  cost: "ad_spend", custo: "ad_spend", spend: "ad_spend", amountspent: "ad_spend",
  investimento: "ad_spend", valorgasto: "ad_spend", investido: "ad_spend",
  // conversões/leads/mensagens
  conversions: "conversions", conversoes: "conversions", leads: "conversions",
  messages: "conversions", mensagens: "conversions", resultados: "conversions",
  // engajamento
  engagement: "engagement", engajamento: "engagement", engagementrate: "engagement",
  // seguidores
  followers: "followers_gained", seguidores: "followers_gained", newfollowers: "followers_gained",
  // cpc/cpm/cpa
  cpc: "cpc", costperclick: "cpc",
  cpm: "cpm", costpermille: "cpm",
  cpa: "cpa", costperresult: "cpa", custoporresultado: "cpa",
  // vendas
  revenue: "revenue", receita: "revenue", vendas: "revenue", sales: "revenue",
  orders: "orders", pedidos: "orders", purchases: "orders", compras: "orders",
  roas: "roas",
};

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
    // métricas de taxa (CTR, engagement) usam média; demais somam
    if (["ctr", "engagement", "cpc", "cpm", "cpa", "roas"].includes(c.metricKey)) {
      const vals = rows.map(r => Number(r[c.clean]) || 0).filter(v => v > 0);
      metrics[c.metricKey] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    } else {
      metrics[c.metricKey] = totals[c.clean];
    }
  });

  return {
    source, sourceLabel, chartData,
    chartColumns: numericCols.map(c => c.clean),
    rows, totals, metrics, periodStart, periodEnd,
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
