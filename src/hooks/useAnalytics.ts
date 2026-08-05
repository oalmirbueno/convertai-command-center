import { useEffect } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  getAnalyticsEventQueryRange,
  type AnalyticsCampaign,
  type AnalyticsConversionDefinition,
  type AnalyticsConversionEvent,
  type AnalyticsDataSet,
  type AnalyticsFilters,
  type AnalyticsMetricEntry,
  type AnalyticsUtmLink,
} from "@/lib/analytics";

const PAGE_SIZE = 500;

interface AnalyticsPage<T> {
  data: T[] | null;
  error: unknown;
}

async function readAllPages<T>(
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<AnalyticsPage<T>>,
) {
  const rows: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await fetchPage(
      from,
      from + PAGE_SIZE - 1,
    );
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
    from += PAGE_SIZE;
  }
}

const CAMPAIGN_SELECT =
  "id, client_id, project_id, name, objective, channel, status, budget, currency, utm_campaign, start_date, end_date, created_by, created_at, updated_at";
const UTM_LINK_SELECT =
  "id, campaign_id, client_id, project_id, name, destination_url, utm_source, utm_medium, utm_campaign, utm_content, utm_term, active, created_by, created_at, updated_at";
const DEFINITION_SELECT =
  "id, client_id, project_id, name, event_key, conversion_type, is_primary, counts_as_revenue, default_value, currency, funnel_order, active, created_by, created_at, updated_at";
const EVENT_SELECT =
  "id, client_id, project_id, campaign_id, utm_link_id, definition_id, definition_name, event_key, conversion_type, is_primary, counts_as_revenue, source, external_id, value, currency, occurred_at, created_by, created_at, archived_at, archived_by";
const METRIC_SELECT =
  "id, client_id, project_id, campaign_id, utm_link_id, metric_key, metric_value, currency, source, external_id, period_start, period_end, captured_at, created_by, created_at, updated_at";

async function readAnalytics(
  filters: AnalyticsFilters,
): Promise<AnalyticsDataSet> {
  const eventRange = getAnalyticsEventQueryRange(
    filters.startDate,
    filters.endDate,
  );
  if (!eventRange) {
    throw new RangeError(
      "O período de Analytics deve conter datas válidas e no máximo 366 dias.",
    );
  }

  const [campaigns, utmLinks, definitions, events, metricEntries] =
    await Promise.all([
      readAllPages<AnalyticsCampaign>((from, to) => {
        let query = supabase
          .from("analytics_campaigns")
          .select(CAMPAIGN_SELECT)
          .is("archived_at", null);
        if (filters.clientId) {
          query = query.eq("client_id", filters.clientId);
        }
        if (filters.projectId) {
          query = query.eq("project_id", filters.projectId);
        }
        return query
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to);
      }),
      readAllPages<AnalyticsUtmLink>((from, to) => {
        let query = supabase
          .from("analytics_utm_links")
          .select(UTM_LINK_SELECT)
          .is("archived_at", null);
        if (filters.clientId) {
          query = query.eq("client_id", filters.clientId);
        }
        if (filters.projectId) {
          query = query.eq("project_id", filters.projectId);
        }
        if (filters.campaignId) {
          query = query.eq("campaign_id", filters.campaignId);
        }
        return query
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to);
      }),
      readAllPages<AnalyticsConversionDefinition>((from, to) => {
        let query = supabase
          .from("analytics_conversion_definitions")
          .select(DEFINITION_SELECT)
          .is("archived_at", null);
        if (filters.clientId) {
          query = query.eq("client_id", filters.clientId);
        }
        if (filters.projectId) {
          query = query.eq("project_id", filters.projectId);
        }
        return query
          .order("funnel_order", {
            ascending: true,
            nullsFirst: false,
          })
          .order("created_at", { ascending: true })
          .range(from, to);
      }),
      readAllPages<AnalyticsConversionEvent>((from, to) => {
        let query = supabase
          .from("analytics_conversion_events")
          .select(EVENT_SELECT)
          .is("archived_at", null)
          .gte("occurred_at", eventRange.startIso)
          .lt("occurred_at", eventRange.endExclusiveIso);
        if (filters.clientId) {
          query = query.eq("client_id", filters.clientId);
        }
        if (filters.projectId) {
          query = query.eq("project_id", filters.projectId);
        }
        if (filters.campaignId) {
          query = query.eq("campaign_id", filters.campaignId);
        }
        query = query
          .order("occurred_at", { ascending: false })
          .order("id", { ascending: true });
        return query.range(from, to);
      }),
      readAllPages<AnalyticsMetricEntry>((from, to) => {
        let query = supabase
          .from("analytics_metric_entries")
          .select(METRIC_SELECT)
          .gte("period_start", filters.startDate)
          .lte("period_end", filters.endDate);
        if (filters.clientId) {
          query = query.eq("client_id", filters.clientId);
        }
        if (filters.projectId) {
          query = query.eq("project_id", filters.projectId);
        }
        if (filters.campaignId) {
          query = query.eq("campaign_id", filters.campaignId);
        }
        query = query
          .order("period_start", { ascending: true })
          .order("id", { ascending: true });
        return query.range(from, to);
      }),
    ]);

  return { campaigns, utmLinks, definitions, events, metricEntries };
}

export function useAnalyticsData(filters: AnalyticsFilters) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const validRange = Boolean(
    getAnalyticsEventQueryRange(filters.startDate, filters.endDate),
  );
  const query = useQuery({
    queryKey: [
      "growth-analytics",
      user?.id,
      filters.clientId || "all",
      filters.projectId || "all",
      filters.campaignId || "all",
      filters.startDate,
      filters.endDate,
    ],
    queryFn: () => readAnalytics(filters),
    enabled: !!user && validRange,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!user) return;
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ["growth-analytics"] });
    };
    const channel = supabase
      .channel(`growth-analytics:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "analytics_campaigns" },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "analytics_utm_links" },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "analytics_conversion_definitions",
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "analytics_conversion_events",
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "analytics_metric_entries",
        },
        refresh,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, user]);

  return query;
}

export interface CreateCampaignInput {
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
}

export interface CreateUtmLinkInput {
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
}

export interface CreateDefinitionInput {
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
}

export interface CreateEventInput {
  client_id: string;
  project_id: string;
  campaign_id: string | null;
  utm_link_id: string | null;
  definition_id: string;
  external_id: string;
  value?: number;
  currency?: string;
  occurred_at: string;
}

export interface MetricBatchItem {
  metric_key: string;
  metric_value: number;
}

export interface CreateMetricBatchInput {
  client_id: string;
  project_id: string;
  campaign_id: string | null;
  utm_link_id: string | null;
  period_start: string;
  period_end: string;
  captured_at: string;
  currency: string;
  metrics: MetricBatchItem[];
}

export function useAnalyticsMutations() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["growth-analytics"] });

  const createCampaign = useMutation({
    mutationFn: async (input: CreateCampaignInput) => {
      if (!user) throw new Error("Sessão expirada. Entre novamente.");
      const { error } = await supabase.from("analytics_campaigns").insert({
        ...input,
        created_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const createUtmLink = useMutation({
    mutationFn: async (input: CreateUtmLinkInput) => {
      if (!user) throw new Error("Sessão expirada. Entre novamente.");
      const { error } = await supabase.from("analytics_utm_links").insert({
        ...input,
        active: true,
        created_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const createDefinition = useMutation({
    mutationFn: async (input: CreateDefinitionInput) => {
      if (!user) throw new Error("Sessão expirada. Entre novamente.");
      const { error } = await supabase
        .from("analytics_conversion_definitions")
        .insert({
          ...input,
          active: true,
          created_by: user.id,
        });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const createEvent = useMutation({
    mutationFn: async (input: CreateEventInput) => {
      if (!user) throw new Error("Sessão expirada. Entre novamente.");
      const payload = {
        client_id: input.client_id,
        project_id: input.project_id,
        campaign_id: input.campaign_id,
        utm_link_id: input.utm_link_id,
        definition_id: input.definition_id,
        occurred_at: input.occurred_at,
        ...(input.value === undefined ? {} : { value: input.value }),
        ...(input.currency ? { currency: input.currency } : {}),
        source: "manual",
        external_id: input.external_id,
        created_by: user.id,
      };
      const { error } = await supabase
        .from("analytics_conversion_events")
        .insert(payload);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const createMetricBatch = useMutation({
    mutationFn: async (input: CreateMetricBatchInput) => {
      if (!user) throw new Error("Sessão expirada. Entre novamente.");
      if (!input.metrics.length) {
        throw new Error("Informe pelo menos uma métrica.");
      }
      const rows = input.metrics.map((metric) => ({
        client_id: input.client_id,
        project_id: input.project_id,
        campaign_id: input.campaign_id,
        utm_link_id: input.utm_link_id,
        metric_key: metric.metric_key,
        metric_value: metric.metric_value,
        currency: input.currency,
        source: "manual",
        external_id: crypto.randomUUID(),
        period_start: input.period_start,
        period_end: input.period_end,
        captured_at: input.captured_at,
        created_by: user.id,
      }));
      const { error } = await supabase
        .from("analytics_metric_entries")
        .insert(rows);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return {
    createCampaign,
    createUtmLink,
    createDefinition,
    createEvent,
    createMetricBatch,
  };
}
