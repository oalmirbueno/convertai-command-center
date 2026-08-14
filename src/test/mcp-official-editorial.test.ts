import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPageMeta,
  compareCalendarEntries,
  contentTypeForEditorialFormat,
  deliveryTypesForEditorialFormat,
  editorialRequestFingerprint,
  editorialWorkstreamFor,
  isValidIsoDate,
  nextIsoDate,
  orderEditorialFiles,
  type EditorialFileQueryRow,
} from "@/lib/mcp/editorial";
import { mcpScopeAllowsClient } from "@/lib/mcp/client-scope";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const index = read("src/lib/mcp/index.ts");
const listCalendar = read(
  "src/lib/mcp/tools/list-editorial-calendar.ts",
);
const createEditorial = read(
  "src/lib/mcp/tools/create-editorial-item.ts",
);
const listClients = read("src/lib/mcp/tools/list-clients.ts");
const listProjects = read("src/lib/mcp/tools/list-projects.ts");
const listTasks = read("src/lib/mcp/tools/list-tasks.ts");
const clientScope = read("src/lib/mcp/client-scope.ts");

function file(
  id: string,
  fileName: string,
  parentFileId: string | null,
  createdAt: string,
  storagePath: string | null = null,
): EditorialFileQueryRow {
  return {
    id,
    client_id: "client-1",
    project_id: "project-1",
    file_name: fileName,
    file_type: "image",
    mime_type: "image/png",
    extension: "png",
    file_url: `https://cdn.test/${fileName}`,
    size_bytes: 10,
    caption: null,
    carousel_text: null,
    description: null,
    approval_status: "approved",
    visibility: "client",
    status: "ready",
    archived_at: null,
    parent_file_id: parentFileId,
    storage_path: storagePath,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

describe("official MCP editorial helpers", () => {
  it("validates real ISO dates and computes the inclusive range boundary", () => {
    expect(isValidIsoDate("2026-02-28")).toBe(true);
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(nextIsoDate("2026-12-31")).toBe("2027-01-01");
  });

  it("maps every publishable format to a deterministic workstream", () => {
    expect(editorialWorkstreamFor("static")).toBe("design");
    expect(editorialWorkstreamFor("carousel")).toBe("design");
    expect(editorialWorkstreamFor("video")).toBe("video");
    expect(editorialWorkstreamFor("story")).toBe("content");
    expect(contentTypeForEditorialFormat("design")).toBe("static");
    expect(deliveryTypesForEditorialFormat("static")).toEqual([
      "design",
      "static",
    ]);
  });

  it("returns complete pagination metadata", () => {
    expect(buildPageMeta(121, 50, 50, 50)).toEqual({
      total: 121,
      returned: 50,
      has_more: true,
      next_offset: 100,
      offset: 50,
      limit: 50,
    });
    expect(buildPageMeta(75, 25, 50, 50).next_offset).toBeNull();
  });

  it("orders a complete carousel and removes internal storage fields", () => {
    const root = file("root", "capa.png", null, "2026-01-01T00:00:00Z");
    const files = orderEditorialFiles(root, [
      file("third", "slide-3.png", "root", "2026-01-03T00:00:00Z"),
      file("first", "qualquer.png", "root", "2026-01-02T00:00:00Z", "1-slide.png"),
      file("second", "card-2.png", "root", "2026-01-04T00:00:00Z"),
      file("foreign", "card-1.png", "other-root", "2026-01-01T00:00:00Z"),
    ]);

    expect(files.map((row) => row.id)).toEqual([
      "root",
      "first",
      "second",
      "third",
    ]);
    expect(JSON.stringify(files)).not.toContain("storage_path");
    expect(JSON.stringify(files)).not.toContain("archived_at");
  });

  it("uses stable chronological pagination with unscheduled work last", () => {
    const entries = [
      { kind: "post" as const, id: "b", calendar_at: null, updated_at: "2026-03-01" },
      { kind: "task" as const, id: "a", calendar_at: "2026-02-01", updated_at: "2026-01-01" },
      { kind: "post" as const, id: "c", calendar_at: "2026-01-15", updated_at: "2026-01-02" },
    ].sort(compareCalendarEntries);
    expect(entries.map((entry) => entry.id)).toEqual(["c", "a", "b"]);
  });

  it("fingerprints the immutable request independently of object key order", async () => {
    const left = await editorialRequestFingerprint({
      project_id: "project",
      title: "Carrossel",
      priority: "high",
    });
    const right = await editorialRequestFingerprint({
      priority: "high",
      title: "Carrossel",
      project_id: "project",
    });
    expect(left).toBe(right);
    expect(left).toHaveLength(64);
    expect(await editorialRequestFingerprint({ title: "Outro" })).not.toBe(left);
  });

  it("fails closed for clients outside an explicit MCP scope", () => {
    const scope = { unrestricted: false, clientIds: ["client-a"] };
    expect(mcpScopeAllowsClient(scope, "client-a")).toBe(true);
    expect(mcpScopeAllowsClient(scope, "client-b")).toBe(false);
    expect(mcpScopeAllowsClient({ unrestricted: true, clientIds: [] }, "client-b"))
      .toBe(true);
  });
});

describe("official MCP editorial contract", () => {
  it("registers both editorial tools and documents their non-publishing boundary", () => {
    // Versao fixada de proposito: subir exige decisao consciente. 1.4.0
    // adiciona get_client_metrics (metricas reais do Instagram, leitura) e
    // instrui os agentes a citarem numeros verdadeiros com variacao.
    expect(index).toContain('version: "1.4.0"');
    expect(index).toContain("getClientMetricsTool");
    expect(index).toContain("listEditorialCalendarTool");
    expect(index).toContain("createEditorialItemTool");
    expect(index).toContain("sem aprovar, agendar ou publicar");
    expect(index).toContain("ORGANIZACAO DE ARQUIVOS");
  });

  it("keeps every editorial read scoped by client, project and JWT RLS", () => {
    expect(listCalendar).toContain('client_id: z.string().uuid()');
    expect(listCalendar).toContain('.eq("client_id", input.client_id)');
    expect(listCalendar).toContain('.eq("projects.client_id", input.client_id)');
    expect(listCalendar).toContain('.eq("project_id", input.project_id)');
    expect(listCalendar).toContain("supabaseForUser(ctx)");
    expect(listCalendar).toContain("resolveMcpClientScope");
    expect(listCalendar).toContain("mcpScopeAllowsClient");
    expect(listCalendar).not.toContain("service_role");
  });

  it("pages every source, filters only publishable work and deduplicates linked tasks", () => {
    expect(listCalendar).toContain("readAllPages<TaskRow>");
    expect(listCalendar).toContain("readAllPages<PostRow>");
    expect(listCalendar).toContain("EDITORIAL_DELIVERY_TYPE_VALUES");
    expect(listCalendar).toContain(
      "source.not.ilike.client_request:*",
    );
    expect(listCalendar).toContain("source.not.ilike.client_request,");
    expect(listCalendar).toContain('.not("status", "in", "(done,archived,cancelled)")');
    expect(listCalendar).toContain(
      "const includeTasks = !input.production_status && !input.publication_status",
    );
    expect(listCalendar).toContain('.from("editorial_post_internal")');
    expect(listCalendar).toContain("activeLinkedPostIds.has(link.post_id)");
    expect(listCalendar).toContain("linked_task_id");
    expect(listCalendar).toContain("calendar_at_asc_nulls_last");
  });

  it("returns safe accounts and complete ordered carousel files", () => {
    expect(listCalendar).toContain("orderEditorialFiles");
    expect(listCalendar).toContain('.in("parent_file_id", chunk)');
    expect(listCalendar).toContain("ACCOUNT_FIELDS");
    expect(listCalendar).not.toMatch(/ACCOUNT_FIELDS[\s\S]{0,200}external_id/);
    expect(listCalendar).not.toContain("external_post_id");
    expect(listCalendar).not.toContain("access_token");
  });

  it("creates only production tasks with project validation and strict idempotency", () => {
    expect(createEditorial).toContain('.eq("client_id", input.client_id)');
    expect(createEditorial).toContain("format: z.enum(EDITORIAL_DELIVERY_TYPE_VALUES)");
    expect(createEditorial).toContain("editorialRequestFingerprint");
    expect(createEditorial).toContain("task.source === source");
    expect(createEditorial).toContain('error.code === "23505"');
    expect(createEditorial).toContain("ctx.getUserId()");
    expect(createEditorial).toContain("input.assigned_to !== actorId");
    expect(createEditorial).toContain("mcp:editorial:${input.idempotency_key}");
    expect(createEditorial).not.toContain("editorial_publications");
    expect(createEditorial).not.toContain("editorial_posts");
  });

  it("applies assignment scope to discovery and removes unnecessary client PII", () => {
    expect(clientScope).toContain('.from("team_client_assignments")');
    expect(clientScope).toContain('.from("user_roles")');
    for (const source of [listClients, listProjects, listTasks]) {
      expect(source).toContain("resolveMcpClientScope");
    }
    expect(listClients).toContain('.in("id", scope.clientIds)');
    expect(listProjects).toContain('.in("client_id", scope.clientIds)');
    expect(listTasks).toContain('.in("projects.client_id", scope.clientIds)');
    expect(listClients).not.toContain("full_name, email, company_name");
  });

  it("paginates client, project and generic task discovery without a 200-row ceiling", () => {
    for (const source of [listClients, listProjects, listTasks]) {
      expect(source).toContain("max(500)");
      expect(source).toContain("offset");
      expect(source).toContain("buildPageMeta");
      expect(source).toContain("count: \"exact\"");
    }
    expect(listTasks).toContain("workstream");
    expect(listTasks).toContain("delivery_type");
    expect(listTasks).toContain("source");
    expect(listTasks).toContain("only_open");
    expect(listTasks).toContain('"(done,archived,cancelled)"');
    expect(listTasks).toContain("client_id: projectScope?.client_id");
  });
});
