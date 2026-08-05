import { describe, expect, it } from "vitest";
import {
  buildCampaignPerformance,
  buildDailyAnalyticsSeries,
  buildUtmUrl,
  calculateAnalyticsSummary,
  analyticsDateDefaults,
  analyticsDateRangeError,
  analyticsDateTimeLocalToIso,
  analyticsDateTimeLocalValue,
  formatAnalyticsNumber,
  getAnalyticsEventQueryRange,
  isValidAnalyticsDateKey,
  isValidAnalyticsDate,
  normalizeUtmToken,
  validateHttpUrl,
  type AnalyticsCampaign,
  type AnalyticsConversionDefinition,
  type AnalyticsConversionEvent,
  type AnalyticsMetricEntry,
} from "./analytics";

const definition = (
  overrides: Partial<AnalyticsConversionDefinition> = {},
): AnalyticsConversionDefinition => ({
  id: "definition-1",
  client_id: "client-1",
  project_id: "project-1",
  name: "Venda",
  event_key: "purchase",
  conversion_type: "purchase",
  is_primary: true,
  counts_as_revenue: true,
  default_value: null,
  currency: "BRL",
  funnel_order: 1,
  active: true,
  created_by: "user-1",
  created_at: "2026-07-01T12:00:00Z",
  updated_at: "2026-07-01T12:00:00Z",
  ...overrides,
});

const event = (
  overrides: Partial<AnalyticsConversionEvent> = {},
): AnalyticsConversionEvent => ({
  id: "event-1",
  client_id: "client-1",
  project_id: "project-1",
  campaign_id: "campaign-1",
  utm_link_id: null,
  definition_id: "definition-1",
  definition_name: "Venda",
  event_key: "purchase",
  conversion_type: "purchase",
  is_primary: true,
  counts_as_revenue: true,
  source: "manual",
  external_id: "event-external-1",
  value: 300,
  currency: "BRL",
  occurred_at: "2026-07-10T12:00:00Z",
  created_by: "user-1",
  created_at: "2026-07-10T12:00:00Z",
  archived_at: null,
  archived_by: null,
  ...overrides,
});

const metric = (
  metricKey: string,
  metricValue: number,
  overrides: Partial<AnalyticsMetricEntry> = {},
): AnalyticsMetricEntry => ({
  id: `${metricKey}-${overrides.period_start || "1"}`,
  client_id: "client-1",
  project_id: "project-1",
  campaign_id: "campaign-1",
  utm_link_id: null,
  metric_key: metricKey,
  metric_value: metricValue,
  currency: "BRL",
  source: "manual",
  external_id: `${metricKey}-external`,
  period_start: "2026-07-10",
  period_end: "2026-07-10",
  captured_at: "2026-07-10T12:00:00Z",
  created_by: "user-1",
  created_at: "2026-07-10T12:00:00Z",
  updated_at: "2026-07-10T12:00:00Z",
  ...overrides,
});

const campaign = (
  overrides: Partial<AnalyticsCampaign> = {},
): AnalyticsCampaign => ({
  id: "campaign-1",
  client_id: "client-1",
  project_id: "project-1",
  name: "Campanha principal",
  objective: "Gerar vendas",
  channel: "meta_ads",
  status: "active",
  budget: 1000,
  currency: "BRL",
  utm_campaign: "campanha-principal",
  start_date: "2026-07-01",
  end_date: "2026-07-31",
  created_by: "user-1",
  created_at: "2026-07-01T12:00:00Z",
  updated_at: "2026-07-01T12:00:00Z",
  ...overrides,
});

describe("calculateAnalyticsSummary", () => {
  it("calcula as fórmulas sem misturar sessões e cliques", () => {
    const result = calculateAnalyticsSummary(
      [
        metric("ad_spend", 100),
        metric("sessions", 20),
        metric("clicks", 200),
      ],
      [event()],
      [definition()],
    );

    expect(result.investment.value).toBe(100);
    expect(result.traffic).toMatchObject({ value: 20, source: "sessions" });
    expect(result.primaryConversions.value).toBe(1);
    expect(result.revenue.value).toBe(300);
    expect(result.cvr.value).toBe(0.05);
    expect(result.cpa.value).toBe(100);
    expect(result.roas.value).toBe(3);
  });

  it("usa cliques somente quando sessões estão ausentes", () => {
    const result = calculateAnalyticsSummary(
      [metric("clicks", 40)],
      [],
      [definition()],
    );
    expect(result.traffic).toMatchObject({ value: 40, source: "clicks" });
  });

  it("preserva ausente como ausente em vez de converter para zero", () => {
    const result = calculateAnalyticsSummary([], [], []);
    expect(result.investment).toEqual({ value: null, available: false });
    expect(result.primaryConversions).toEqual({
      value: null,
      available: false,
    });
    expect(result.cvr.available).toBe(false);
  });

  it("considera zero conversões quando existe definição primária", () => {
    const result = calculateAnalyticsSummary(
      [metric("sessions", 20)],
      [],
      [definition()],
    );
    expect(result.primaryConversions).toEqual({ value: 0, available: true });
    expect(result.cvr).toEqual({ value: 0, available: true });
    expect(result.cpa.available).toBe(false);
  });

  it("marca receita incompleta como parcial", () => {
    const result = calculateAnalyticsSummary(
      [metric("ad_spend", 100)],
      [event(), event({ id: "event-2", external_id: "event-2", value: null })],
      [definition()],
    );
    expect(result.revenue).toMatchObject({
      value: 300,
      available: true,
      partial: true,
    });
    expect(result.roas.partial).toBe(true);
  });

  it("não soma moedas diferentes silenciosamente", () => {
    const result = calculateAnalyticsSummary(
      [
        metric("ad_spend", 100, { currency: "BRL" }),
        metric("ad_spend", 20, {
          id: "spend-usd",
          external_id: "spend-usd",
          currency: "USD",
        }),
      ],
      [],
      [definition()],
    );
    expect(result.mixedCurrency).toBe(true);
    expect(result.investment).toEqual({ value: null, available: false });
    expect(result.cpa.available).toBe(false);
    expect(result.roas.available).toBe(false);
  });

  it("usa o snapshot do evento mesmo se a definição mudar depois", () => {
    const result = calculateAnalyticsSummary(
      [metric("sessions", 10)],
      [event()],
      [
        definition({
          active: false,
          is_primary: false,
          counts_as_revenue: false,
        }),
      ],
    );
    expect(result.primaryConversions.value).toBe(1);
    expect(result.revenue.value).toBe(300);
  });
});

describe("buildCampaignPerformance", () => {
  it("isola definições de conversão pelo cliente e projeto da campanha", () => {
    const result = buildCampaignPerformance({
      campaigns: [campaign()],
      utmLinks: [],
      metricEntries: [metric("ad_spend", 100)],
      events: [event()],
      definitions: [
        definition(),
        definition({
          id: "definition-other-project",
          client_id: "client-2",
          project_id: "project-2",
          currency: "USD",
        }),
      ],
    });

    expect(result[0].summary.mixedCurrency).toBe(false);
    expect(result[0].summary.currency).toBe("BRL");
    expect(result[0].summary.roas.value).toBe(3);
  });
});

describe("buildDailyAnalyticsSeries", () => {
  it("mantém dias sem investimento como nulos", () => {
    const series = buildDailyAnalyticsSeries(
      "2026-07-10",
      "2026-07-11",
      [metric("ad_spend", 50)],
      [event()],
      [definition()],
    );
    expect(series).toHaveLength(2);
    expect(series[0]).toMatchObject({
      date: "2026-07-10",
      investment: 50,
      primaryConversions: 1,
    });
    expect(series[1]).toMatchObject({
      date: "2026-07-11",
      investment: null,
      primaryConversions: 0,
    });
  });

  it("agrupa eventos pelo dia de São Paulo sem alterar a data das métricas", () => {
    const series = buildDailyAnalyticsSeries(
      "2026-07-29",
      "2026-07-30",
      [
        metric("ad_spend", 50, {
          period_start: "2026-07-29",
          period_end: "2026-07-29",
          captured_at: "2026-07-30T02:30:00.000Z",
        }),
      ],
      [
        event({
          occurred_at: "2026-07-30T02:30:00.000Z",
        }),
      ],
      [definition()],
    );

    expect(series[0]).toMatchObject({
      date: "2026-07-29",
      investment: 50,
      primaryConversions: 1,
    });
    expect(series[1]).toMatchObject({
      date: "2026-07-30",
      investment: null,
      primaryConversions: 0,
    });
  });
});

describe("Analytics business timezone", () => {
  it("converte datetime-local de São Paulo para ISO UTC e volta ao valor do input", () => {
    const instant = analyticsDateTimeLocalToIso("2026-07-29T23:30");

    expect(instant).toBe("2026-07-30T02:30:00.000Z");
    expect(analyticsDateTimeLocalValue(new Date(instant!))).toBe(
      "2026-07-29T23:30",
    );
  });

  it("usa início local inclusivo e fim local exclusivo na consulta de eventos", () => {
    expect(
      getAnalyticsEventQueryRange("2026-07-29", "2026-07-29"),
    ).toEqual({
      startIso: "2026-07-29T03:00:00.000Z",
      endExclusiveIso: "2026-07-30T03:00:00.000Z",
      dayCount: 1,
    });
  });

  it("rejeita datas impossíveis e intervalos maiores que 366 dias", () => {
    expect(isValidAnalyticsDateKey("2026-02-29")).toBe(false);
    expect(isValidAnalyticsDateKey("2024-02-29")).toBe(true);
    expect(isValidAnalyticsDate(null)).toBe(false);
    expect(
      getAnalyticsEventQueryRange("2025-01-01", "2026-01-01")?.dayCount,
    ).toBe(366);
    expect(
      getAnalyticsEventQueryRange("2025-01-01", "2026-01-02"),
    ).toBeNull();
    expect(
      getAnalyticsEventQueryRange("2026-07-30", "2026-07-29"),
    ).toBeNull();
    expect(
      analyticsDateRangeError("2025-01-01", "2026-01-02"),
    ).toContain("366");
    expect(
      analyticsDateRangeError("2026-07-30", "2026-07-29"),
    ).toContain("inicial");
    expect(
      analyticsDateRangeError("2026-02-29", "2026-03-01"),
    ).toContain("válidas");
    expect(
      buildDailyAnalyticsSeries(
        "2025-01-01",
        "2026-01-02",
        [],
        [],
        [],
      ),
    ).toEqual([]);
  });

  it("calcula os defaults pelo dia de São Paulo, não pelo dia UTC", () => {
    expect(
      analyticsDateDefaults(new Date("2026-07-30T01:30:00.000Z")),
    ).toEqual({
      startDate: "2026-06-30",
      endDate: "2026-07-29",
    });
  });

  it("rejeita datetime-local inválido", () => {
    expect(analyticsDateTimeLocalToIso("2026-02-29T10:00")).toBeNull();
    expect(analyticsDateTimeLocalValue(new Date("invalid"))).toBe("");
  });
});

describe("UTM builder", () => {
  it("normaliza tokens com acentos e espaços", () => {
    expect(normalizeUtmToken("  Anúncio São João  ")).toBe(
      "anuncio-sao-joao",
    );
  });

  it("remove ponto porque o token aceita apenas slug simples", () => {
    expect(normalizeUtmToken("Meta.Ads")).toBe("meta-ads");
  });

  it("preserva parâmetros existentes e substitui UTMs", () => {
    const result = buildUtmUrl({
      destinationUrl:
        "https://aceleriq.com.br/diagnostico?ref=site&utm_content=antigo",
      source: "Instagram",
      medium: "Social Pago",
      campaign: "Diagnóstico Julho",
    });
    const finalUrl = new URL(result.url!);

    expect(finalUrl.searchParams.get("ref")).toBe("site");
    expect(finalUrl.searchParams.get("utm_source")).toBe("instagram");
    expect(finalUrl.searchParams.get("utm_medium")).toBe("social-pago");
    expect(finalUrl.searchParams.get("utm_campaign")).toBe(
      "diagnostico-julho",
    );
    expect(finalUrl.searchParams.has("utm_content")).toBe(false);
  });

  it("aceita apenas http e https", () => {
    expect(validateHttpUrl("javascript:alert(1)")).not.toBeNull();
    expect(validateHttpUrl("https://aceleriq.com.br")).toBeNull();
  });

  it("não gera link sem os três tokens obrigatórios", () => {
    const result = buildUtmUrl({
      destinationUrl: "https://aceleriq.com.br",
      source: "",
      medium: "social",
      campaign: "julho",
    });
    expect(result.url).toBeNull();
    expect(result.error).toContain("origem");
  });
});

describe("formatAnalyticsNumber", () => {
  it("exibe ausência explicitamente", () => {
    expect(formatAnalyticsNumber(null)).toBe("Sem dados");
  });
});
