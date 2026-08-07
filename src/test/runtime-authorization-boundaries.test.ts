import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

const transactionalEmail = read("supabase/functions/send-transactional-email/index.ts");
const filesWorker = read("supabase/functions/mcp-files-worker/index.ts");
const workspaceAgent = read("supabase/functions/workspace-agent/index.ts");
const authEmailHook = read("supabase/functions/auth-email-hook/index.ts");

describe("privileged runtime authorization boundaries", () => {
  it("allows only service_role or authenticated staff to send transactional email", () => {
    const authorization = transactionalEmail.indexOf("callerToken !== supabaseServiceKey");
    const parseBody = transactionalEmail.indexOf("const body = await req.json()");

    expect(authorization).toBeGreaterThan(-1);
    expect(transactionalEmail).toContain("supabase.auth.getUser(callerToken)");
    expect(transactionalEmail).toContain("supabase.rpc('is_staff'");
    expect(transactionalEmail).toContain("isStaff !== true");
    expect(authorization).toBeLessThan(parseBody);
    expect(transactionalEmail).not.toContain("No in-function auth check is needed");
  });

  it("requires the configured service_role before the files worker reads its body or queue", () => {
    const authorization = filesWorker.indexOf("bearerMatch?.[1] !== SERVICE_ROLE");
    const parseBody = filesWorker.indexOf("const body = await req.json()");
    const drainQueue = filesWorker.indexOf("const job = await claimNext()");

    expect(filesWorker).toContain("if (req.method !== 'POST')");
    expect(authorization).toBeGreaterThan(-1);
    expect(authorization).toBeLessThan(parseBody);
    expect(authorization).toBeLessThan(drainQueue);
  });

  it("resolves workspace client, project and folder through the caller before service-role reads", () => {
    const projectGuard = workspaceAgent.indexOf('await sb.from("projects")');
    const folderGuard = workspaceAgent.indexOf('await sb.from("workspace_nodes")');
    const privilegedClientRead = workspaceAgent.indexOf('admin.from("profiles")');

    expect(workspaceAgent).toContain('.select("id, user_id, client_id, system_prompt, title")');
    expect(workspaceAgent).toContain('sb.rpc("can_access_client"');
    expect(workspaceAgent).toContain('project.client_id !== authorizedClientId');
    expect(workspaceAgent).toContain('folder.client_id !== authorizedClientId');
    expect(workspaceAgent).toContain('const safeClientId = context?.client_id ?? authorizedClientId');
    expect(projectGuard).toBeGreaterThan(-1);
    expect(folderGuard).toBeGreaterThan(-1);
    expect(projectGuard).toBeLessThan(privilegedClientRead);
    expect(folderGuard).toBeLessThan(privilegedClientRead);
    expect(workspaceAgent).not.toContain('admin.from("workspace_nodes")\n        .select("id,name,kind,mime,storage_path").eq("parent_id", context.folder_id)');
  });
});

describe("portable Supabase auth URL construction", () => {
  it("appends the verify endpoint to the configured base path", () => {
    expect(authEmailHook).toContain("url = new URL(supabaseUrl)");
    expect(authEmailHook).toContain("const basePath = url.pathname.replace(/\\/+$/, '')");
    expect(authEmailHook).toContain("url.pathname = `${basePath}/auth/v1/verify`");
    expect(authEmailHook).toContain("url.search = ''");
    expect(authEmailHook).toContain("url.hash = ''");
    expect(authEmailHook).not.toContain("new URL('/auth/v1/verify', supabaseUrl)");
  });
});
