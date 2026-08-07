import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const tools = read("supabase/functions/_shared/mcp-tools.ts");
const reads = read("supabase/functions/_shared/aceleriq-read-services.ts");
const writes = read("supabase/functions/_shared/mcp-write-services.ts");
const auth = read("supabase/functions/_shared/mcp-auth.ts");
const server = read("supabase/functions/mcp-server/index.ts");
const metadata = read("supabase/functions/mcp-oauth-metadata/index.ts");
const validator = read("integrations/codex-plugin/aceleriq-os/scripts/validate.mjs");

describe("legacy MCP editorial contract", () => {
  it("registers the scoped editorial tools and publishes one aligned version", () => {
    expect(tools).toContain("aceleriq_list_editorial_calendar");
    expect(tools).toContain("aceleriq_create_editorial_item");
    expect(tools).toContain("'editorial:read'");
    expect(tools).toContain("'editorial:write'");
    expect(tools).toContain("version: '1.8.1'");
    expect(metadata).toContain("const MCP_VERSION = '1.8.1'");
    expect(server).toContain("listChanged: false");
  });

  it("publishes current ChatGPT OAuth discovery and reauthorization metadata", () => {
    expect(tools).toMatch(/annotations: t\.annotations,[\s\S]*?securitySchemes,[\s\S]*?_meta:/);
    expect(tools).toContain("securitySchemes,");
    expect(server).toContain("'mcp/www_authenticate': [WWW_AUTH_TOOL_HEADER]");
    expect(server).toContain('error="invalid_token"');
    expect(server).toContain('error_description="OAuth authorization required"');
    expect(server).toContain("shouldUseOAuthToolChallenge(");
    expect(server).toContain("status: toolChallengeOnly ? 200 : 401");
    expect(server).toContain("scopes_supported: OAUTH_SCOPES");
    expect(server).toContain("mcp_internal_scopes_supported: INTERNAL_MCP_SCOPES");
    expect(metadata).toContain("scopes_supported: OAUTH_SCOPES");
    expect(metadata).toContain("mcp_internal_scopes_supported: INTERNAL_MCP_SCOPES");
  });

  it("returns one deduplicated, client-scoped calendar with safe media", () => {
    expect(reads).toContain("active_editorial_post_wins_over_linked_task");
    expect(reads).toContain("source.not.ilike.client_request:*");
    expect(reads).toContain("source.not.ilike.client_request");
    expect(reads).toContain("format and delivery_type cannot conflict");
    expect(reads).toContain("include_unscheduled");
    expect(reads).toContain("editorial_publications.scheduled_at");
    expect(reads).toContain(".in('content_type', ['static', 'carousel', 'reel', 'story', 'video', 'short', 'article', 'google_post'])");
    expect(reads).toContain("query = query.gte('scheduled_at', periodStart)");
    expect(reads).toContain("query = query.lte('scheduled_at', periodEnd)");
    expect(reads).toContain("allPostIds");
    expect(reads).toContain(".in('post_id', postIds)");
    expect(reads).not.toContain("social_private.editorial_publication_assets");

    const safeMedia = reads.slice(
      reads.indexOf("function safeMediaGroup"),
      reads.indexOf("export async function listEditorialCalendar"),
    );
    for (const secretField of ["storage_path", "file_url", "sha256", "external_id", "access_token"]) {
      expect(safeMedia).not.toContain(secretField);
    }
  });

  it("creates only a publishable production task and never schedules or publishes", () => {
    const createStart = writes.indexOf("export async function createEditorialItem");
    const createEnd = writes.indexOf("// ─── update_task", createStart);
    const createSource = writes.slice(createStart, createEnd);
    expect(createSource).toContain('deterministicEditorialTaskId');
    expect(createSource).toContain('editorialPayloadFingerprint');
    expect(createSource).toContain('`mcp:editorial:${fingerprint}`');
    expect(createSource).toContain("id: taskId");
    expect(createSource).toContain("(error as any).code === '23505'");
    expect(createSource).toContain("workstreamForEditorialDelivery");
    expect(createSource).toContain("getWritableProject");
    expect(createSource).toContain("different editorial input");
    expect(createSource).toContain("scheduled: false");
    expect(createSource).toContain("published: false");
    expect(createSource).toContain("approved: false");
    expect(createSource).not.toContain(".from('editorial_posts')");
    expect(createSource).not.toContain(".from('editorial_publications')");
  });

  it("uses public initialize for the optional live plugin validation", () => {
    expect(validator).toContain('method: "POST"');
    expect(validator).toContain('method: "initialize"');
    expect(validator).toContain('listChanged === false');
    expect(validator).not.toContain('fetch(url, { headers:');
  });

  it("applies the same data scope to task/project/report write paths", () => {
    expect(auth).toContain("team_client_assignments");
    expect(auth).toContain("principalUserId: userId");
    expect(auth).toContain("principalUserId: null");
    expect(writes.match(/getWritableProject\(/g)?.length).toBeGreaterThanOrEqual(5);
    expect(writes).toContain("assertWriteClientScope(ctx");
  });

  it("scopes core discovery reads and blocks every unhardened private legacy tool", () => {
    expect(tools).toContain("(input, ctx) => listClients(input, ctx)");
    expect(tools).toContain("(input, ctx) => getClientContext(input, ctx)");
    expect(tools).toContain("(input, ctx) => listProjects(input, ctx)");
    expect(tools).toContain("(input, ctx) => getProject(input, ctx)");
    expect(server).toContain("canUseToolWithDataScope(ctx, tool)");
    expect(server).toContain("errorCode: 'data_scope_denied'");

    const clientsSource = reads.slice(
      reads.indexOf("export async function listClients"),
      reads.indexOf("// ─── get_client_context"),
    );
    const clientContextSource = reads.slice(
      reads.indexOf("export async function getClientContext"),
      reads.indexOf("// ─── list_projects"),
    );
    const projectsSource = reads.slice(
      reads.indexOf("export async function listProjects"),
      reads.indexOf("// ─── get_project"),
    );
    const projectSource = reads.slice(
      reads.indexOf("export async function getProject"),
      reads.indexOf("// ─── list_tasks"),
    );

    expect(clientsSource).toContain("ctx.dataScope.unrestricted");
    expect(clientsSource).toContain("client_roles:user_roles!inner(role)");
    expect(clientsSource).toContain("qb.in('id', ctx.dataScope.clientIds)");
    expect(clientsSource).not.toContain("from('user_roles').select('user_id')");
    expect(clientContextSource).toContain("assertClientAccess(ctx, id)");
    expect(projectsSource).toContain("assertClientAccess(ctx, opts.client_id)");
    expect(projectsSource).toContain("qb.in('client_id', ctx.dataScope.clientIds)");
    expect(projectSource.indexOf("assertClientAccess(ctx")).toBeLessThan(
      projectSource.indexOf("Promise.all"),
    );
    expect(reads).toContain(".in('project_id', projectIds)");
  });
});
