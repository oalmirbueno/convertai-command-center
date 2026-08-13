/**
 * Série de crescimento do negócio do cliente, extraída dos relatórios reais.
 *
 * Cada relatório publicado vira um ponto no tempo com os mesmos "baldes" da
 * leitura clara: contatos, alcance, investido e retorno - classificados pelo
 * NOME da métrica em qualquer idioma (investimento_brl, conversas, reservas...).
 * Nada inventado: relatório sem número não vira ponto.
 */

export interface GrowthPoint {
  label: string;
  at: string;
  contacts: number;
  reach: number;
  spend: number;
  revenue: number;
}

const normalize = (key: string) =>
  key.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const isRateKey = (key: string) =>
  /^custo|cpc|cpm|cpa|ctr|taxa|rate|_pct|roas|frequen|medio|media|avg|per_|_por_/.test(key);

function bucketOf(key: string): keyof Omit<GrowthPoint, "label" | "at"> | null {
  if (isRateKey(key)) return null;
  if (/investi|spend|verba|gasto|orcamento/.test(key)) return "spend";
  if (/receita|revenue|faturamento/.test(key)) return "revenue";
  if (/conversa|lead|mensagem|msg|contato|whatsapp|direct|conversion|venda|compra|purchase|reserva|pedido|booking/.test(key)) return "contacts";
  if (/alcance|impress|reach/.test(key)) return "reach";
  return null;
}

export function sumGrowthBuckets(metrics: Record<string, unknown> | null | undefined) {
  const totals = { contacts: 0, reach: 0, spend: 0, revenue: 0 };
  const walk = (source: Record<string, unknown> | null | undefined) => {
    for (const [rawKey, rawValue] of Object.entries(source || {})) {
      if (rawKey === "custom") {
        if (rawValue && typeof rawValue === "object") walk(rawValue as Record<string, unknown>);
        continue;
      }
      if (rawKey.startsWith("__")) continue;
      const value = Number(rawValue);
      if (!Number.isFinite(value) || value <= 0) continue;
      const bucket = bucketOf(normalize(rawKey));
      if (bucket) totals[bucket] += value;
    }
  };
  walk(metrics);
  return totals;
}

export function buildGrowthSeries(
  reports: ReadonlyArray<{
    title?: string | null;
    metrics?: Record<string, unknown> | null;
    period_end?: string | null;
    period_start?: string | null;
    created_at?: string | null;
  }>,
): GrowthPoint[] {
  return reports
    .filter((report) => !(report.metrics as any)?.ritual_type)
    .map((report) => {
      const at = report.period_end || report.period_start || report.created_at || "";
      const totals = sumGrowthBuckets(report.metrics || {});
      return {
        at,
        label: at
          ? new Date(`${at.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
          : "",
        ...totals,
      };
    })
    .filter((point) => point.at && (point.contacts > 0 || point.reach > 0 || point.spend > 0))
    .sort((left, right) => (left.at < right.at ? -1 : 1));
}
