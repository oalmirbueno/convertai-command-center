import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ModuleKind, transpileModule } from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as freshness from "../../supabase/functions/_shared/operator-freshness";

type Row = Record<string, unknown>;
type Report = { event: string; operator: string; run_key: string; kanban_task_id?: string };
type Board = { resumo: { execucoes_sem_heartbeat: number }; runs_recentes: Row[]; vinculos: Row[] };

function harness() {
  const staleRun = Object.freeze({ id: "old-run", operator_id: "op", task_link_id: "link", run_key: "old-key", status: "started", heartbeat_at: "2020-01-01T12:00:00Z", timeout_seconds: 900 });
  const link = Object.freeze({ id: "link", operator_id: "op", status: "in_progress", kanban_task_id: null });
  const rows: Record<string, Row[]> = {
    internal_operators: [{ id: "op", slug: "sintetico", display_name: "Sintético" }],
    operator_runs: [staleRun], operator_task_links: [link],
  };
  const state = { failedTable: "", staleExpired: false };
  const rpc = vi.fn(async (name: string, args?: Row) => {
    if (name === "operator_expire_stale_runs") {
      state.staleExpired = true;
      return { data: 1, error: null };
    }
    if (name === "operator_report_event") {
      if (args?._event === "started" && !state.staleExpired) {
        return { data: null, error: { message: "operator_runs_uma_viva" } };
      }
      return { data: { status: args?._event, run_key: args?._run_key }, error: null };
    }
    throw new Error(`Unexpected mutation: ${name}`);
  });
  const from = vi.fn((table: string) => {
    const promise = Promise.resolve(state.failedTable === table
      ? { data: null, error: { message: "Synthetic read failure" } }
      : { data: rows[table] ?? [], error: null });
    return Object.assign(promise, {
      select: () => promise, order: () => promise, limit: () => promise,
      eq: () => promise, in: () => promise, is: () => promise,
    });
  });
  const dependencies: Record<string, unknown> = {
    "./aceleriq-read-services.ts": { db: () => ({ from, rpc }), isUuid: (value: string) => /^[a-f0-9-]{36}$/i.test(value), READ_LIMITS: { queryTimeoutMs: 8000, maxPageSize: 500 } },
    "./operator-freshness.ts": freshness,
  };
  const source = readFileSync(resolve(process.cwd(), "supabase/functions/_shared/aceleriq-operators-services.ts"), "utf8");
  const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, unknown> = {};
  const run = new Function("exports", "require", "Deno", "setTimeout", compiled);
  run(exports, (name: string) => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, { env: { get: () => "https://app.example.com" } }, () => 0);
  return {
    state, rpc, from, staleRun, link,
    board: exports.operatorBoard as (opts: Row) => Promise<Board>,
    report: exports.operatorReport as (input: Report, actor: string) => Promise<Row>,
  };
}

describe("Operadores: leitura pura e retomada explicita", () => {
  let api: ReturnType<typeof harness>;
  beforeEach(() => { api = harness(); });

  it("ler e reler o quadro apenas projeta heartbeat atrasado, sem qualquer RPC", async () => {
    const first = await api.board({});
    const second = await api.board({});
    expect(first.resumo.execucoes_sem_heartbeat).toBe(1);
    expect(first.runs_recentes[0]).toMatchObject({ status: "started", sem_heartbeat: true });
    expect(second.runs_recentes).toEqual(first.runs_recentes);
    expect(api.staleRun.status).toBe("started");
    expect(api.link.status).toBe("in_progress");
    expect(api.rpc).not.toHaveBeenCalled();
  });

  it("uma falha ao ler o quadro nao inicia manutencao nem sucesso vazio", async () => {
    api.state.failedTable = "operator_runs";
    await expect(api.board({})).rejects.toThrow("operator_runs: Synthetic read failure");
    expect(api.rpc).not.toHaveBeenCalled();
  });

  it("started autorizado expira a trava antiga antes de retomar a execucao", async () => {
    const input = { event: "started", operator: "sintetico", run_key: "new-run" };
    await expect(api.report(input, "authorized-principal")).resolves.toMatchObject({ status: "started", run_key: "new-run" });
    expect(api.rpc.mock.calls.map(([name]) => name)).toEqual(["operator_expire_stale_runs", "operator_report_event"]);
    expect(api.rpc.mock.calls[1][1]).toMatchObject({ _actor: "authorized-principal", _event: "started", _run_key: "new-run" });
  });

  it("heartbeat informa progresso sem expirar outras execucoes", async () => {
    await api.report({ event: "heartbeat", operator: "sintetico", run_key: "old-key" }, "authorized-principal");
    expect(api.rpc.mock.calls.map(([name]) => name)).toEqual(["operator_report_event"]);
  });

  it("erro na retomada deixa a falha explicita e nao finge um started", async () => {
    api.rpc.mockResolvedValueOnce({ data: null, error: { message: "Synthetic denied maintenance" } });
    await expect(api.report({ event: "started", operator: "sintetico", run_key: "new-run" }, "authorized-principal"))
      .rejects.toThrow("operator_expire_stale_runs: Synthetic denied maintenance");
    expect(api.rpc).toHaveBeenCalledOnce();
  });

  it("id de tarefa invalido e recusado antes de qualquer escrita", async () => {
    await expect(api.report({ event: "started", operator: "sintetico", run_key: "new-run", kanban_task_id: "invalid" }, "authorized-principal"))
      .rejects.toThrow("kanban_task_id must be a UUID");
    expect(api.rpc).not.toHaveBeenCalled();
  });
});
