import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ModuleKind, transpileModule } from "typescript";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import * as clientScope from "@/lib/mcp/client-scope";
import * as editorial from "@/lib/mcp/editorial";
import * as compat from "@/lib/mcp/compat";
import * as security from "../../supabase/functions/_shared/mcp-security";

// Execute the actual modules with transport/SDK adapters. No source matching,
// credentials, network calls or product writes are used by these scenarios.
function loadModule(path: string, dependencies: Record<string, unknown>): Record<string, unknown> {
  const source = readFileSync(resolve(process.cwd(), path), "utf8");
  const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, unknown> = {};
  const require = (name: string) => {
    if (!(name in dependencies)) throw new Error(`Unexpected test dependency: ${name}`);
    return dependencies[name];
  };
  const run = new Function("exports", "require", "Deno", "setTimeout", compiled);
  run(exports, require, { env: { get: () => "synthetic-test-only" } }, () => 0);
  return exports;
}

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACTIVE_A = "11111111-1111-4111-8111-111111111111";
const ARCHIVED_A = "22222222-2222-4222-8222-222222222222";
const ACTIVE_B = "33333333-3333-4333-8333-333333333333";
const ARCHIVED_B = "44444444-4444-4444-8444-444444444444";
type Row = Record<string, unknown>;
type Scope = { unrestricted: boolean; clientIds: string[] };
type Options = { client_id?: string; project_id?: string; include_archived_projects?: boolean; limit?: number; offset?: number };
type Page = { items: Row[]; total: number };
type DbResult = { data: Row[] | Row | null; error: { message: string } | null; count: number };

function valueAt(row: Row, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => (value as Row | undefined)?.[key], row);
}

class Query implements PromiseLike<DbResult> {
  private filters: Array<(row: Row) => boolean> = [];
  private start = 0;
  private end = Number.MAX_SAFE_INTEGER;
  private single = false;
  private innerProject = false;
  constructor(private rows: Row[], private fail: boolean) {}
  select(columns: string) { this.innerProject = columns.includes("projects!inner"); return this; }
  is(key: string, value: unknown) { this.filters.push((row) => valueAt(row, key) === value); return this; }
  eq(key: string, value: unknown) { this.filters.push((row) => valueAt(row, key) === value); return this; }
  in(key: string, values: unknown[]) { this.filters.push((row) => values.includes(valueAt(row, key))); return this; }
  not(key: string, _op: string, values: string) {
    const excluded = values.replace(/[()"']/g, "").split(",");
    this.filters.push((row) => !excluded.includes(String(valueAt(row, key))));
    return this;
  }
  order() { return this; }
  range(start: number, end: number) { this.start = start; this.end = end; return this; }
  maybeSingle() { this.single = true; return this; }
  then<TResult1 = DbResult, TResult2 = never>(
    onfulfilled?: ((value: DbResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const matches = this.rows.filter((row) => (!this.innerProject || row.projects != null) && this.filters.every((test) => test(row)));
    const page = matches.slice(this.start, this.end + 1);
    const result: DbResult = this.fail
      ? { data: null, count: 0, error: { message: "Synthetic read failure" } }
      : { data: this.single ? page[0] ?? null : page, count: matches.length, error: null };
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}

function fixture(scope: Scope) {
  const projects = [
    { id: ACTIVE_A, client_id: A, deleted_at: null },
    { id: ARCHIVED_A, client_id: A, deleted_at: "2026-09-01" },
    { id: ACTIVE_B, client_id: B, deleted_at: null },
    { id: ARCHIVED_B, client_id: B, deleted_at: "2026-09-01" },
  ];
  const tasks = projects.map((project, index) => ({
    id: `task-${index}`, project_id: project.id, deleted_at: null, status: "review", projects: project,
  }));
  const rows: Record<string, Row[]> = {
    projects,
    tasks: [...tasks, { ...tasks[0], id: "deleted-task", deleted_at: "2026-09-01" }, { ...tasks[0], id: "orphan-task", projects: null }],
    user_roles: [{ user_id: "staff", role: scope.unrestricted ? "admin" : "manager" }],
    team_client_assignments: scope.clientIds.map((client_id) => ({ user_id: "staff", client_id })),
  };
  const state = { failedTable: "", tables: [] as string[] };
  const sb = { from: (table: string) => {
    state.tables.push(table);
    return new Query(rows[table] ?? [], state.failedTable === table);
  } };
  return { sb, state };
}

function edgeHarness(scope: Scope) {
  const { sb, state } = fixture(scope);
  const sdk = { createClient: () => sb };
  const auth = loadModule("supabase/functions/_shared/mcp-auth.ts", {
    "https://esm.sh/@supabase/supabase-js@2.45.4": sdk,
    "./mcp-security.ts": security,
    "./mcp-runtime.ts": {},
  });
  const service = loadModule("supabase/functions/_shared/aceleriq-read-services.ts", {
    "https://esm.sh/@supabase/supabase-js@2.45.4": sdk,
    "./mcp-auth.ts": auth,
    "./aceleriq-metrics-services.ts": {},
  });
  const listTasks = service.listTasks as (input: Options, ctx: { dataScope: Scope }) => Promise<Page>;
  return { state, call: (input: Options) => listTasks(input, { dataScope: scope }) };
}

function officialHarness(scope: Scope) {
  const { sb, state } = fixture(scope);
  const transport = loadModule("src/lib/mcp/supabase.ts", { "@supabase/supabase-js": { createClient: () => sb } });
  const module = loadModule("src/lib/mcp/tools/list-tasks.ts", {
    "@lovable.dev/mcp-js": { defineTool: (tool: unknown) => tool }, zod: { z },
    "../compat": compat, "../editorial": editorial, "../client-scope": clientScope, "../supabase": transport,
  });
  const tool = module.default as {
    inputSchema: z.ZodRawShape;
    handler: (input: Options, ctx: Row) => Promise<{ isError?: boolean; content: { text: string }[]; structuredContent: { tasks: Row[]; meta: { total: number } } }>;
  };
  return { state, call: async (input: Options): Promise<Page> => {
    const parsed = z.object(tool.inputSchema).parse(input);
    const result = await tool.handler(parsed, { isAuthenticated: () => true, getUserId: () => "staff", getToken: () => "synthetic-token" });
    if (result.isError) throw new Error(result.content[0].text);
    return { items: result.structuredContent.tasks, total: result.structuredContent.meta.total };
  } };
}

describe.each([
  ["Edge", edgeHarness], ["SDK", officialHarness],
] as const)("MCP %s: tarefas atuais e historico preservado", (_name, build) => {
  let api: ReturnType<typeof edgeHarness>;
  beforeEach(() => { api = build({ unrestricted: false, clientIds: [A] }); });

  it("exclui o pai arquivado antes de contar e paginar, mantendo a tarefa atual", async () => {
    const result = await api.call({});
    expect(result.total).toBe(1);
    expect(result.items.map((task) => task.id)).toEqual(["task-0"]);
    expect(result.items[0]).toMatchObject({ client_id: A, project_archived: false });
  });

  it("historico explicito inclui o pai arquivado com marcador, sem cruzar clientes", async () => {
    const result = await api.call({ include_archived_projects: true });
    expect(result.total).toBe(2);
    expect(result.items.map((task) => task.id)).toEqual(["task-0", "task-1"]);
    expect(result.items[1]).toMatchObject({ client_id: A, project_archived: true });
    expect(result.items.every((task) => task.client_id === A)).toBe(true);
  });

  it("preserva contagem historica e limites da pagina", async () => {
    const result = await api.call({ include_archived_projects: true, limit: 1, offset: 1 });
    expect(result.total).toBe(2);
    expect(result.items.map((task) => task.id)).toEqual(["task-1"]);
  });

  it("permite buscar o projeto arquivado autorizado explicitamente", async () => {
    const result = await api.call({ project_id: ARCHIVED_A, include_archived_projects: true });
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({ id: "task-1", project_archived: true });
  });

  it("recusa cliente fora do escopo mesmo em consulta historica", async () => {
    await expect(api.call({ client_id: B, include_archived_projects: true })).rejects.toThrow();
    expect(api.state.tables).not.toContain("tasks");
  });

  it("nao revela projeto historico de outro cliente", async () => {
    try {
      const result = await api.call({ project_id: ARCHIVED_B, include_archived_projects: true });
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(api.state.tables).not.toContain("tasks");
    }
  });

  it("escopo vazio nao vira acesso amplo ao historico", async () => {
    api = build({ unrestricted: false, clientIds: [] });
    const result = await api.call({ include_archived_projects: true });
    expect(result.items).toEqual([]);
    expect(api.state.tables).not.toContain("tasks");
  });

  it("admin ve historico de todos os clientes, sempre identificado", async () => {
    api = build({ unrestricted: true, clientIds: [] });
    const result = await api.call({ include_archived_projects: true });
    expect(result.total).toBe(4);
    expect(result.items.filter((task) => task.project_archived)).toHaveLength(2);
  });

  it("erro de leitura permanece erro, sem resposta vazia de sucesso", async () => {
    api.state.failedTable = "tasks";
    await expect(api.call({ include_archived_projects: true })).rejects.toThrow("Synthetic read failure");
  });
});
