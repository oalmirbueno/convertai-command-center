// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { BrowserContext, Route } from "@playwright/test";
import { observedWorkTable, observeWorkReads, summarizeWorkRead } from "../../e2e/support/work-reads";

// Only the fixture registration is replaced. The guard and its forwarding logic run unchanged.
vi.mock("@playwright/test", () => ({ test: { extend: () => ({}) }, expect: vi.fn() }));
import { installEgressGuard } from "../../e2e/support/network";

const projectsUrl = "http://127.0.0.1:54321/rest/v1/projects?select=*&deleted_at=is.null";
const tasksUrl = "http://127.0.0.1:54321/rest/v1/tasks?select=*,project:projects(name)";
const response = (rows: unknown, status = 200) => ({ status: () => status, json: async () => rows });

describe("strict observations of the same real work response", () => {
  it.each([[[], []], [[{ id: "b" }, { id: "a" }], ["a", "b"]]])("accepts complete arrays, including an empty RLS result %#", async (rows, ids) => {
    const read = await summarizeWorkRead("projects", projectsUrl, response(rows));
    expect(read).toMatchObject({ bodyState: "json", jsonShape: "array", validRows: true, ids });
  });
  it.each([
    [{ id: "a" }, "object"], [null, "null"], ["[]", "primitive"], [[{ name: "missing id" }], "array"], [[null], "array"],
  ])("never accepts a wrong shape or an invalid row %#", async (rows, shape) => {
    const read = await summarizeWorkRead("projects", projectsUrl, response(rows));
    expect(read).toMatchObject({ bodyState: "json", jsonShape: shape, validRows: false, ids: [] });
  });
  it("distinguishes an unreadable body from valid JSON null without exposing the exception", async () => {
    const read = await summarizeWorkRead("projects", projectsUrl, {
      status: () => 200, json: async () => { throw new Error("private transport details must not be logged"); },
    });
    expect(read).toMatchObject({ status: 200, bodyState: "unreadable", jsonShape: "unreadable", validRows: false });
    expect(JSON.stringify(read)).not.toContain("private transport");
  });
  it("retains scoped ids and synthetic task cards for the existing cross-client assertions", async () => {
    const read = await summarizeWorkRead("tasks", tasksUrl, response([{ id: "b", title: "Task B", status: "backlog" }, { id: "a", title: "Task A", status: "backlog" }]));
    expect(read.ids).toEqual(["a", "b"]);
    expect(read.taskCards).toEqual([{ id: "a", title: "Task A", status: "backlog" }, { id: "b", title: "Task B", status: "backlog" }]);
  });
  it.each([
    ["POST", projectsUrl], ["HEAD", projectsUrl], ["GET", "http://127.0.0.1:54321/auth/v1/token?select=*"],
    ["GET", "http://127.0.0.1:54321/rest/v1/projects?select=id,client_id"],
    ["GET", "https://remote.invalid/rest/v1/projects?select=*"], ["GET", "http://user:pass@127.0.0.1:54321/rest/v1/projects?select=*"],
  ])("does not collect auth, narrower reads, credentials or another origin %#", (method, url) => {
    expect(observedWorkTable(method, url)).toBeNull();
  });
  it("drains all tracked forwarding, including a second request started during the first", async () => {
    const observation = observeWorkReads();
    let release!: () => void;
    const first = new Promise<void>((resolve) => { release = resolve; });
    let releaseSecond!: () => void;
    const second = new Promise<void>((resolve) => { releaseSecond = resolve; });
    observation.track("projects", projectsUrl, first.then(async () => {
      observation.track("tasks", tasksUrl, second.then(() => summarizeWorkRead("tasks", tasksUrl, response([]))));
      return await summarizeWorkRead("projects", projectsUrl, response([{ id: "a" }]));
    }));
    let drained = false;
    const waiting = observation.drain().then(() => { drained = true; });
    release();
    await Promise.resolve(); await Promise.resolve();
    expect(drained).toBe(false);
    releaseSecond();
    await waiting;
    expect(observation.reads.projects).toHaveLength(1);
    expect(observation.reads.tasks).toHaveLength(1);
    await observation.finish();
    observation.track("projects", projectsUrl, summarizeWorkRead("projects", projectsUrl, response([{ id: "ignored-after-finish" }])));
    expect(observation.active).toBe(false);
    expect(observation.reads.projects).toHaveLength(1);
  });
  it("keeps a failed fetch/fulfill as a failed observation instead of skipping it", async () => {
    const observation = observeWorkReads();
    observation.track("projects", projectsUrl, Promise.reject(new Error("transport failed")));
    await observation.finish();
    expect(observation.reads.projects).toMatchObject([{ status: 0, bodyState: "transport-error", validRows: false }]);
  });
});

describe("the unchanged local guard delivers and observes a single request", () => {
  it("reads the fetched APIResponse before fulfillment, waits through fulfillment and never fetches again", async () => {
    let handler!: (route: Route) => Promise<void>;
    const context = {
      route: async (_pattern: unknown, next: typeof handler) => { handler = next; },
      routeWebSocket: async () => undefined,
      close: async () => undefined,
    };
    const guard = await installEgressGuard(context as unknown as BrowserContext);
    const json = vi.fn(async () => [{ id: "allowed-project" }]);
    const fetched = { ...response(null), json, headers: () => ({}) };
    let finishFulfillment!: () => void;
    const fulfillment = new Promise<void>((resolve) => { finishFulfillment = resolve; });
    const fetch = vi.fn(async () => fetched);
    const fulfill = vi.fn(async (options: unknown) => {
      expect(json).toHaveBeenCalledTimes(1);
      expect(options).toEqual({ response: fetched });
      await fulfillment;
    });
    const route = { request: () => ({ method: () => "GET", url: () => projectsUrl }), fetch, fulfill, abort: vi.fn() };
    const forwarding = handler(route as unknown as Route);
    let drained = false;
    const waiting = guard.workReads.drain().then(() => { drained = true; });
    await vi.waitFor(() => expect(fulfill).toHaveBeenCalledTimes(1));
    expect(drained).toBe(false);
    expect(guard.workReads.reads.projects).toHaveLength(0);
    finishFulfillment();
    await forwarding; await waiting;
    expect(fetch).toHaveBeenCalledExactlyOnceWith({ maxRedirects: 0, timeout: 30_000 });
    expect(route.abort).not.toHaveBeenCalled();
    expect(guard.unexpected).toEqual([]);
    expect(guard.workReads.reads.projects).toMatchObject([{ status: 200, bodyState: "json", validRows: true, ids: ["allowed-project"] }]);
    const authJson = vi.fn(async () => { throw new Error("Auth body must never be inspected"); });
    const authResponse = { ...response(null), json: authJson, headers: () => ({}) };
    await handler({ request: () => ({ method: () => "POST", url: () => "http://127.0.0.1:54321/auth/v1/token?grant_type=password" }), fetch: async () => authResponse, fulfill: vi.fn(), abort: vi.fn() } as unknown as Route);
    expect(authJson).not.toHaveBeenCalled();
    expect(guard.workReads.reads.projects).toHaveLength(1);
  });
  it("still aborts redirects before fulfillment and never treats them as a passing work read", async () => {
    let handler!: (route: Route) => Promise<void>;
    const guard = await installEgressGuard({ route: async (_p: unknown, next: typeof handler) => { handler = next; }, routeWebSocket: async () => undefined, close: async () => undefined } as unknown as BrowserContext);
    const fulfill = vi.fn(), abort = vi.fn();
    await handler({ request: () => ({ method: () => "GET", url: () => projectsUrl }), fetch: async () => ({ status: () => 302, headers: () => ({ location: "https://redirect.invalid/forbidden" }) }), fulfill, abort } as unknown as Route);
    await guard.workReads.finish();
    expect(abort).toHaveBeenCalledExactlyOnceWith("blockedbyclient");
    expect(fulfill).not.toHaveBeenCalled();
    expect(guard.unexpected).toEqual(["https://redirect.invalid/forbidden"]);
    expect(guard.workReads.reads.projects).toMatchObject([{ status: 0, bodyState: "transport-error", validRows: false }]);
  });
});
