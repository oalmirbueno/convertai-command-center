import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const migration = read(
  "supabase/migrations/20260729180204_add_growth_analytics_v1.sql",
);
const app = read("src/App.tsx");
const analyticsHook = read("src/hooks/useAnalytics.ts");
const analyticsActions = read(
  "src/components/analytics/AnalyticsActions.tsx",
);

const analyticsTables = [
  "analytics_campaigns",
  "analytics_utm_links",
  "analytics_conversion_definitions",
  "analytics_conversion_events",
  "analytics_metric_entries",
] as const;

const sqlBlock = (startMarker: string, endMarker: string) => {
  const start = migration.indexOf(startMarker);
  const end = migration.indexOf(endMarker, start + startMarker.length);

  if (start === -1) return "";
  return migration.slice(start, end === -1 ? undefined : end);
};

const compactSql = migration.replace(/\s+/g, " ");

const analyticsPages = readdirSync(resolve(root, "src/pages"), {
  withFileTypes: true,
})
  .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
  .map((entry) => ({
    name: entry.name,
    source: read(`src/pages/${entry.name}`),
  }))
  .filter(({ source }) =>
    /(?:useAnalyticsData|@\/components\/analytics\/|<AnalyticsOverview\b)/.test(
      source,
    ),
  );

describe("growth analytics migration security contract", () => {
  it("creates exactly five tenant-scoped analytics tables with RLS", () => {
    const createdTables = Array.from(
      migration.matchAll(/CREATE TABLE public\.(analytics_[a-z_]+)/g),
      (match) => match[1],
    );

    expect(createdTables).toEqual(analyticsTables);

    for (const table of analyticsTables) {
      expect(migration).toContain(
        `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`,
      );
      expect(migration).toMatch(
        new RegExp(
          `REVOKE\\s+ALL\\s+ON\\s+public\\.${table}\\s+FROM\\s+PUBLIC,\\s*anon,\\s*authenticated,\\s*service_role\\s*;`,
          "i",
        ),
      );
    }

    expect(
      migration.match(
        /USING \(public\.can_access_client\(client_id\)\);/g,
      ),
    ).toHaveLength(analyticsTables.length);
  });

  it("never grants deletion or exposes a delete policy", () => {
    const grantStatements = migration.match(/\bGRANT\b[\s\S]*?;/gi) ?? [];

    for (const statement of grantStatements) {
      expect(statement).not.toMatch(/\bDELETE\b/i);
      expect(statement).not.toMatch(/\bTO\s+(?:PUBLIC|anon)\b/i);
    }

    expect(migration).not.toMatch(/\bFOR\s+DELETE\b/i);
    expect(migration).not.toMatch(/\bON\s+DELETE\s+CASCADE\b/i);
  });

  it("restricts the privileged write predicate to assigned staff", () => {
    const writeFunction = sqlBlock(
      "CREATE OR REPLACE FUNCTION public.analytics_can_write_client",
      "CREATE TABLE public.analytics_campaigns",
    );

    expect(writeFunction).toContain("SECURITY DEFINER");
    expect(writeFunction).toContain("SET search_path = ''");
    expect(writeFunction).toContain("auth.uid() IS NOT NULL");
    expect(writeFunction).toContain(
      "public.has_role(auth.uid(), 'admin'::public.app_role)",
    );
    expect(writeFunction).toContain(
      "public.has_role(auth.uid(), 'manager'::public.app_role)",
    );
    expect(writeFunction).toContain(
      "public.has_role(auth.uid(), 'traffic'::public.app_role)",
    );
    expect(writeFunction).toContain(
      "FROM public.team_client_assignments AS assignment",
    );
    expect(writeFunction).toContain("assignment.user_id = auth.uid()");
    expect(writeFunction).toContain("assignment.client_id = _client_id");
    expect(writeFunction).toMatch(
      /REVOKE ALL ON FUNCTION public\.analytics_can_write_client\(uuid\)\s+FROM PUBLIC, anon;/,
    );
    expect(writeFunction).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.analytics_can_write_client\(uuid\)\s+TO authenticated, service_role;/,
    );
    expect(writeFunction).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.analytics_can_write_client\(uuid\)\s+TO (?:PUBLIC|anon)/,
    );

    expect(
      migration.match(/public\.analytics_can_write_client\(client_id\)/g)
        ?.length,
    ).toBeGreaterThanOrEqual(analyticsTables.length * 2);
  });

  it("binds every cross-entity relationship to client and project scope", () => {
    const compositeReferences = [
      "FOREIGN KEY (project_id, client_id) REFERENCES public.projects(id, client_id)",
      "FOREIGN KEY (campaign_id, client_id, project_id) REFERENCES public.analytics_campaigns(id, client_id, project_id)",
      "FOREIGN KEY (definition_id, client_id, project_id) REFERENCES public.analytics_conversion_definitions(id, client_id, project_id)",
      "FOREIGN KEY (utm_link_id, client_id, project_id, campaign_id) REFERENCES public.analytics_utm_links(id, client_id, project_id, campaign_id)",
    ];

    for (const reference of compositeReferences) {
      expect(compactSql).toContain(reference);
    }

    expect(compactSql).toContain("UNIQUE (id, client_id, project_id)");
    expect(compactSql).toContain(
      "UNIQUE (id, client_id, project_id, campaign_id)",
    );
  });

  it("keeps conversion events idempotent, snapshotted and append-only", () => {
    const eventTable = sqlBlock(
      "CREATE TABLE public.analytics_conversion_events",
      "CREATE TABLE public.analytics_metric_entries",
    );
    const eventGuard = sqlBlock(
      "CREATE OR REPLACE FUNCTION public.analytics_conversion_event_guard",
      "CREATE OR REPLACE FUNCTION public.analytics_metric_entry_immutable_guard",
    );

    expect(eventTable).toContain(
      "UNIQUE (client_id, source, external_id)",
    );

    const snapshotFields = {
      definition_name: "name",
      event_key: "event_key",
      conversion_type: "conversion_type",
      is_primary: "is_primary",
      counts_as_revenue: "counts_as_revenue",
    } as const;

    for (const [snapshotField, definitionField] of Object.entries(
      snapshotFields,
    )) {
      expect(eventTable).toContain(`${snapshotField} `);
      expect(eventGuard).toContain(
        `NEW.${snapshotField} := definition_row.${definitionField}`,
      );
      expect(eventGuard).toContain(
        `NEW.${snapshotField} IS DISTINCT FROM OLD.${snapshotField}`,
      );
    }

    expect(eventGuard).toContain(
      "conversion events are append-only; archive and create a replacement",
    );
    expect(eventGuard).toContain("NEW.archived_by := auth.uid()");
    expect(migration).toContain(
      "BEFORE INSERT OR UPDATE ON public.analytics_conversion_events",
    );
  });

  it("freezes UTM tracking fields and keeps tracking tokens slug-only", () => {
    const utmTable = sqlBlock(
      "CREATE TABLE public.analytics_utm_links",
      "CREATE TABLE public.analytics_conversion_definitions",
    );
    const utmGuard = sqlBlock(
      "CREATE OR REPLACE FUNCTION public.analytics_utm_link_immutable_guard",
      "CREATE OR REPLACE FUNCTION public.analytics_conversion_event_guard",
    );

    for (const field of [
      "campaign_id",
      "destination_url",
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
    ]) {
      expect(utmGuard).toContain(
        `NEW.${field} IS DISTINCT FROM OLD.${field}`,
      );
    }

    expect(utmGuard).toContain("NEW.utm_campaign := campaign_utm");
    expect(utmGuard).toContain(
      "used tracking fields are immutable; create a new UTM link instead",
    );
    expect(utmTable).toContain(
      "utm_source ~ '^[a-z0-9][a-z0-9_-]{0,99}$'",
    );
    expect(utmTable).toContain(
      "utm_medium ~ '^[a-z0-9][a-z0-9_-]{0,99}$'",
    );
    expect(migration).toContain(
      "BEFORE INSERT OR UPDATE ON public.analytics_utm_links",
    );
    expect(migration).toContain(
      "NEW.utm_campaign IS DISTINCT FROM OLD.utm_campaign",
    );
    expect(migration).toContain(
      "campaign UTM identity is immutable; create a new campaign instead",
    );
    expect(utmGuard).toContain("FOR SHARE");
  });

  it("keeps archive state coherent and publishes every table to realtime", () => {
    expect(compactSql).toContain(
      "(archived_at IS NULL AND status <> 'archived') OR (archived_at IS NOT NULL AND status = 'archived')",
    );
    expect(migration).toContain(
      "ALTER PUBLICATION supabase_realtime ADD TABLE public.%I",
    );
    for (const table of analyticsTables) {
      expect(migration).toContain(`'${table}'`);
    }
  });

  it("blocks overlapping metric periods under a concurrency-safe lock", () => {
    const metricGuard = sqlBlock(
      "CREATE OR REPLACE FUNCTION public.analytics_metric_entry_immutable_guard",
      "CREATE TRIGGER analytics_campaigns_record_guard",
    );

    expect(metricGuard).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(metricGuard).toContain("pg_catalog.hashtextextended");
    expect(metricGuard).toContain("pg_catalog.daterange(");
    expect(metricGuard).toContain(") && pg_catalog.daterange(");
    expect(metricGuard).toContain(
      "metric period overlaps an existing observation in this scope",
    );
    expect(metricGuard).toContain(
      "metric identity fields are immutable; update only its observed value",
    );
    expect(migration).toContain(
      "CREATE UNIQUE INDEX analytics_metric_entries_semantic_key",
    );
    expect(migration).toContain(
      "BEFORE INSERT OR UPDATE ON public.analytics_metric_entries",
    );
  });

  it("does not add explicit personal-data fields to analytics records", () => {
    const persistedAnalyticsSchema = sqlBlock(
      "CREATE TABLE public.analytics_campaigns",
      "CREATE INDEX analytics_campaigns_scope_status_idx",
    );
    const piiColumn = /^\s*(?:email|e_mail|phone|telephone|telefone|whatsapp|cpf|cnpj|ip_address|user_agent|person_name|lead_name|contact_name)\s+/im;

    expect(persistedAnalyticsSchema).not.toMatch(piiColumn);
    expect(persistedAnalyticsSchema).not.toContain("jsonb");
    expect(persistedAnalyticsSchema).not.toContain("metadata");
    expect(persistedAnalyticsSchema).not.toContain("payload");
  });
});

describe("growth analytics frontend integration contract", () => {
  it("registers an Analytics route once the page is present", () => {
    if (analyticsPages.length === 0) {
      expect(analyticsPages).toHaveLength(0);
      return;
    }

    expect(analyticsPages.length).toBeGreaterThan(0);
    expect(app).toMatch(/path=["'][^"']*analytics[^"']*["']/i);
  });

  it("reuses the same conversion idempotency key after a failed response", () => {
    expect(analyticsHook).toContain("external_id: input.external_id");
    expect(analyticsActions).toContain(
      "const [externalId] = useState(() => crypto.randomUUID())",
    );
    expect(analyticsActions).toContain("external_id: externalId");
  });
});
