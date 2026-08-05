import {
  dateKeyInTimeZone,
  isoUtcToZonedDateTimeLocal,
  zonedDateTimeLocalToIso,
} from "./editorialDate";

export const ANALYTICS_TIME_ZONE = "America/Sao_Paulo";
export const ANALYTICS_MAX_DATE_RANGE_DAYS = 366;

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export interface AnalyticsEventQueryRange {
  startIso: string;
  endExclusiveIso: string;
  dayCount: number;
}

function dateKeyEpoch(value: string): number | null {
  const match = DATE_KEY_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || year > 9999 || month < 1 || month > 12) return null;

  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date.getTime();
}

function dateKeyFromEpoch(epoch: number): string | null {
  if (!Number.isFinite(epoch)) return null;
  const date = new Date(epoch);
  if (Number.isNaN(date.getTime())) return null;
  const iso = date.toISOString();
  return DATE_KEY_PATTERN.test(iso.slice(0, 10)) ? iso.slice(0, 10) : null;
}

export function isValidAnalyticsDate(value: unknown): value is string {
  return typeof value === "string" && dateKeyEpoch(value) !== null;
}

export function isValidAnalyticsDateKey(value: string): boolean {
  return isValidAnalyticsDate(value);
}

export function analyticsDateRangeError(
  startDate: string,
  endDate: string,
): string | null {
  const startEpoch = dateKeyEpoch(startDate);
  const endEpoch = dateKeyEpoch(endDate);
  if (startEpoch === null || endEpoch === null) {
    return "Informe datas válidas para consultar Analytics.";
  }
  if (startEpoch > endEpoch) {
    return "A data inicial deve ser anterior ou igual à data final.";
  }
  const dayCount =
    Math.floor((endEpoch - startEpoch) / MILLISECONDS_PER_DAY) + 1;
  if (dayCount > ANALYTICS_MAX_DATE_RANGE_DAYS) {
    return "Consulte no máximo 366 dias por vez.";
  }
  return null;
}

/**
 * Converts an Analytics `datetime-local` value in the business timezone to
 * an absolute UTC timestamp suitable for persistence.
 */
export function analyticsDateTimeLocalToIso(value: string): string | null {
  return zonedDateTimeLocalToIso(value, ANALYTICS_TIME_ZONE);
}

/**
 * Formats an instant for an HTML `datetime-local` input in the business
 * timezone. Invalid instants return an empty input value.
 */
export function analyticsDateTimeLocalValue(now = new Date()): string {
  if (Number.isNaN(now.getTime())) return "";
  return (
    isoUtcToZonedDateTimeLocal(now.toISOString(), ANALYTICS_TIME_ZONE) || ""
  );
}

/**
 * Produces an inclusive local start and exclusive local end for event
 * queries. The 366-day ceiling protects the client from unbounded reads.
 */
export function getAnalyticsEventQueryRange(
  startDate: string,
  endDate: string,
): AnalyticsEventQueryRange | null {
  const startEpoch = dateKeyEpoch(startDate);
  const endEpoch = dateKeyEpoch(endDate);
  if (startEpoch === null || endEpoch === null || startEpoch > endEpoch) {
    return null;
  }

  const dayCount =
    Math.floor((endEpoch - startEpoch) / MILLISECONDS_PER_DAY) + 1;
  if (dayCount > ANALYTICS_MAX_DATE_RANGE_DAYS) return null;

  const endExclusiveDate = dateKeyFromEpoch(
    endEpoch + MILLISECONDS_PER_DAY,
  );
  if (!endExclusiveDate) return null;

  const startIso = analyticsDateTimeLocalToIso(`${startDate}T00:00`);
  const endExclusiveIso = analyticsDateTimeLocalToIso(
    `${endExclusiveDate}T00:00`,
  );
  if (!startIso || !endExclusiveIso) return null;

  return { startIso, endExclusiveIso, dayCount };
}

export interface AnalyticsCampaign {
  id: string;
  client_id: string;
  project_id: string;
  name: string;
  objective: string;
  channel: string;
  status: string;
  budget: number;
  currency: string;
  utm_campaign: string;
  start_date: string | null;
  end_date: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AnalyticsUtmLink {
  id: string;
  campaign_id: string;
  client_id: string;
  project_id: string;
  name: string;
  destination_url: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string | null;
  utm_term: string | null;
  active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AnalyticsConversionDefinition {
  id: string;
  client_id: string;
  project_id: string;
  name: string;
  event_key: string;
  conversion_type: string;
  is_primary: boolean;
  counts_as_revenue: boolean;
  default_value: number | null;
  currency: string;
  funnel_order: number;
  active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AnalyticsConversionEvent {
  id: string;
  client_id: string;
  project_id: string;
  campaign_id: string | null;
  utm_link_id: string | null;
  definition_id: string;
  definition_name: string;
  event_key: string;
  conversion_type: string;
  is_primary: boolean;
  counts_as_revenue: boolean;
  source: string;
  external_id: string;
  value: number | null;
  currency: string;
  occurred_at: string;
  created_by: string;
  created_at: string;
  archived_at: string | null;
  archived_by: string | null;
}

export interface AnalyticsMetricEntry {
  id: string;
  client_id: string;
  project_id: string;
  campaign_id: string | null;
  utm_link_id: string | null;
  metric_key: string;
  metric_value: number;
  currency: string;
  source: string;
  external_id: string;
  period_start: string;
  period_end: string;
  captured_at: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AnalyticsDataSet {
  campaigns: AnalyticsCampaign[];
  utmLinks: AnalyticsUtmLink[];
  definitions: AnalyticsConversionDefinition[];
  events: AnalyticsConversionEvent[];
  metricEntries: AnalyticsMetricEntry[];
}

export interface AnalyticsFilters {
  clientId?: string;
  projectId?: string;
  campaignId?: string;
  startDate: string;
  endDate: string;
}

export interface AnalyticsMetricResult {
  value: number | null;
  available: boolean;
  partial?: boolean;
}

export interface AnalyticsSummary {
  currency: string | null;
  mixedCurrency: boolean;
  investment: AnalyticsMetricResult;
  traffic: AnalyticsMetricResult & {
    source: "sessions" | "clicks" | null;
  };
  primaryConversions: AnalyticsMetricResult;
  revenue: AnalyticsMetricResult;
  cvr: AnalyticsMetricResult;
  cpa: AnalyticsMetricResult;
  roas: AnalyticsMetricResult;
}

export interface AnalyticsDailyPoint {
  date: string;
  investment: number | null;
  revenue: number | null;
  traffic: number | null;
  primaryConversions: number | null;
  trafficSource: "sessions" | "clicks" | null;
}

export interface AnalyticsCampaignPerformance {
  campaign: AnalyticsCampaign;
  summary: AnalyticsSummary;
  utmCount: number;
}

const sum = (values: number[]) =>
  values.reduce((total, value) => total + value, 0);

const dateKey = (value: string) => value.slice(0, 10);

function metricSum(
  entries: AnalyticsMetricEntry[],
  key: string,
): AnalyticsMetricResult {
  const matching = entries.filter((entry) => entry.metric_key === key);
  return matching.length
    ? {
        value: sum(
          matching.map((entry) => Number(entry.metric_value)),
        ),
        available: true,
      }
    : { value: null, available: false };
}

export function calculateAnalyticsSummary(
  metricEntries: AnalyticsMetricEntry[],
  events: AnalyticsConversionEvent[],
  definitions: AnalyticsConversionDefinition[],
): AnalyticsSummary {
  const rawInvestment = metricSum(metricEntries, "ad_spend");
  const sessions = metricSum(metricEntries, "sessions");
  const clicks = metricSum(metricEntries, "clicks");
  const traffic = sessions.available
    ? { ...sessions, source: "sessions" as const }
    : clicks.available
      ? { ...clicks, source: "clicks" as const }
      : { value: null, available: false, source: null };

  const hasPrimaryDefinition = definitions.some(
    (definition) => definition.active && definition.is_primary,
  );
  const primaryEvents = events.filter((event) => event.is_primary);
  const primaryConversions =
    hasPrimaryDefinition || primaryEvents.length > 0
    ? {
        value: primaryEvents.length,
        available: true,
      }
    : { value: null, available: false };

  const hasRevenueDefinition = definitions.some(
    (definition) => definition.active && definition.counts_as_revenue,
  );
  const revenueEvents = events.filter((event) => event.counts_as_revenue);
  const revenueValues = revenueEvents
    .map((event) => event.value)
    .filter((value): value is number => value !== null);
  const missingRevenueValues = revenueEvents.some(
    (event) => event.value === null,
  );
  const rawRevenue = hasRevenueDefinition || revenueEvents.length > 0
    ? revenueEvents.length === 0
      ? { value: 0, available: true }
      : revenueValues.length
        ? {
            value: sum(revenueValues.map(Number)),
            available: true,
            partial: missingRevenueValues,
          }
        : { value: null, available: false, partial: true }
    : { value: null, available: false };

  const investmentCurrencies = metricEntries
    .filter((entry) => entry.metric_key === "ad_spend")
    .map((entry) => entry.currency);
  const revenueCurrencies =
    revenueEvents.length > 0
      ? revenueEvents
          .filter((event) => event.value !== null)
          .map((event) => event.currency)
      : definitions
          .filter(
            (definition) =>
              definition.active && definition.counts_as_revenue,
          )
          .map((definition) => definition.currency);
  const currencies = [
    ...new Set(
      [...investmentCurrencies, ...revenueCurrencies].filter(Boolean),
    ),
  ];
  const mixedCurrency = currencies.length > 1;
  const currency = currencies.length === 1 ? currencies[0] : null;
  const investment = mixedCurrency
    ? { value: null, available: false }
    : rawInvestment;
  const revenue = mixedCurrency
    ? { value: null, available: false }
    : rawRevenue;

  const primaryValue = primaryConversions.value;
  const trafficValue = traffic.value;
  const investmentValue = investment.value;
  const revenueValue = revenue.value;

  const cvr =
    primaryConversions.available &&
    traffic.available &&
    trafficValue !== null &&
    trafficValue > 0 &&
    primaryValue !== null
      ? { value: primaryValue / trafficValue, available: true }
      : { value: null, available: false };
  const cpa =
    investment.available &&
    primaryConversions.available &&
    primaryValue !== null &&
    primaryValue > 0 &&
    investmentValue !== null
      ? { value: investmentValue / primaryValue, available: true }
      : { value: null, available: false };
  const roas =
    revenue.available &&
    investment.available &&
    investmentValue !== null &&
    investmentValue > 0 &&
    revenueValue !== null
      ? {
          value: revenueValue / investmentValue,
          available: true,
          partial: revenue.partial,
        }
      : { value: null, available: false };

  return {
    currency,
    mixedCurrency,
    investment,
    traffic,
    primaryConversions,
    revenue,
    cvr,
    cpa,
    roas,
  };
}

function eachDate(startDate: string, endDate: string) {
  const range = getAnalyticsEventQueryRange(startDate, endDate);
  const startEpoch = dateKeyEpoch(startDate);
  if (!range || startEpoch === null) return [];

  return Array.from({ length: range.dayCount }, (_, index) =>
    dateKeyFromEpoch(startEpoch + index * MILLISECONDS_PER_DAY),
  ).filter((date): date is string => Boolean(date));
}

export function buildDailyAnalyticsSeries(
  startDate: string,
  endDate: string,
  metricEntries: AnalyticsMetricEntry[],
  events: AnalyticsConversionEvent[],
  definitions: AnalyticsConversionDefinition[],
): AnalyticsDailyPoint[] {
  const periodSummary = calculateAnalyticsSummary(
    metricEntries,
    events,
    definitions,
  );
  const trafficSource = metricEntries.some(
    (entry) => entry.metric_key === "sessions",
  )
    ? ("sessions" as const)
    : metricEntries.some((entry) => entry.metric_key === "clicks")
      ? ("clicks" as const)
      : null;

  return eachDate(startDate, endDate).map((date) => {
    const dayEntries = metricEntries.filter(
      (entry) => dateKey(entry.period_start) === date,
    );
    const dayEvents = events.filter(
      (event) =>
        dateKeyInTimeZone(event.occurred_at, ANALYTICS_TIME_ZONE) === date,
    );
    const summary = calculateAnalyticsSummary(
      dayEntries,
      dayEvents,
      definitions,
    );
    const dayTraffic = trafficSource
      ? metricSum(dayEntries, trafficSource)
      : { value: null, available: false };
    return {
      date,
      investment: periodSummary.mixedCurrency
        ? null
        : summary.investment.value,
      revenue: periodSummary.mixedCurrency ? null : summary.revenue.value,
      traffic: dayTraffic.value,
      primaryConversions: summary.primaryConversions.value,
      trafficSource,
    };
  });
}

export function buildCampaignPerformance(
  data: AnalyticsDataSet,
): AnalyticsCampaignPerformance[] {
  return data.campaigns.map((campaign) => {
    const metricEntries = data.metricEntries.filter(
      (entry) => entry.campaign_id === campaign.id,
    );
    const events = data.events.filter(
      (event) => event.campaign_id === campaign.id,
    );
    const definitions = data.definitions.filter(
      (definition) =>
        definition.client_id === campaign.client_id &&
        definition.project_id === campaign.project_id,
    );
    const utmCount = data.utmLinks.filter(
      (utmLink) => utmLink.campaign_id === campaign.id,
    ).length;
    return {
      campaign,
      summary: calculateAnalyticsSummary(
        metricEntries,
        events,
        definitions,
      ),
      utmCount,
    };
  });
}

export function normalizeUtmToken(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

export function validateHttpUrl(value: string) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) {
      return "Use um endereço que comece com http:// ou https://.";
    }
    return null;
  } catch {
    return "Informe uma URL completa e válida.";
  }
}

export interface UtmBuilderInput {
  destinationUrl: string;
  source: string;
  medium: string;
  campaign: string;
  content?: string;
  term?: string;
}

export interface UtmBuilderResult {
  url: string | null;
  error: string | null;
  normalized: {
    source: string;
    medium: string;
    campaign: string;
    content: string;
    term: string;
  };
}

export function buildUtmUrl(input: UtmBuilderInput): UtmBuilderResult {
  const normalized = {
    source: normalizeUtmToken(input.source),
    medium: normalizeUtmToken(input.medium),
    campaign: normalizeUtmToken(input.campaign),
    content: normalizeUtmToken(input.content || ""),
    term: normalizeUtmToken(input.term || ""),
  };
  const destinationError = validateHttpUrl(input.destinationUrl);
  if (destinationError) {
    return { url: null, error: destinationError, normalized };
  }
  if (!normalized.source || !normalized.medium || !normalized.campaign) {
    return {
      url: null,
      error: "Preencha origem, mídia e campanha para gerar o link.",
      normalized,
    };
  }

  const url = new URL(input.destinationUrl);
  url.searchParams.set("utm_source", normalized.source);
  url.searchParams.set("utm_medium", normalized.medium);
  url.searchParams.set("utm_campaign", normalized.campaign);
  if (normalized.content) {
    url.searchParams.set("utm_content", normalized.content);
  } else {
    url.searchParams.delete("utm_content");
  }
  if (normalized.term) {
    url.searchParams.set("utm_term", normalized.term);
  } else {
    url.searchParams.delete("utm_term");
  }
  return { url: url.toString(), error: null, normalized };
}

export function formatAnalyticsNumber(
  value: number | null,
  options: {
    style?: "number" | "currency" | "percent" | "multiplier";
    currency?: string;
  } = {},
) {
  if (value === null || !Number.isFinite(value)) return "Sem dados";
  const style = options.style || "number";
  if (style === "currency") {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: options.currency || "BRL",
      maximumFractionDigits: 2,
    }).format(value);
  }
  if (style === "percent") {
    return new Intl.NumberFormat("pt-BR", {
      style: "percent",
      maximumFractionDigits: 2,
    }).format(value);
  }
  if (style === "multiplier") {
    return `${new Intl.NumberFormat("pt-BR", {
      maximumFractionDigits: 2,
    }).format(value)}x`;
  }
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 2,
  }).format(value);
}

export function analyticsDateDefaults(now = new Date()) {
  const endDate = dateKeyInTimeZone(now, ANALYTICS_TIME_ZONE);
  if (!endDate) {
    throw new RangeError("now must be a valid Date");
  }
  const endEpoch = dateKeyEpoch(endDate);
  const startDate =
    endEpoch === null
      ? null
      : dateKeyFromEpoch(endEpoch - 29 * MILLISECONDS_PER_DAY);
  if (!startDate) {
    throw new RangeError("could not calculate Analytics date defaults");
  }
  return { startDate, endDate };
}
