// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { isClientHistoryRead, isProductStateRead } from "../../e2e/support/read-contract";

const url = "http://127.0.0.1:54321/rest/v1/rpc/movimentos_do_cliente";
const args = {
  _client_id: "11111111-1111-4111-8111-111111111111",
  _desde: "2026-10-01T00:00:00.000Z",
  _ate: "2026-10-20T00:00:00.000Z",
  _somente_visiveis: true,
};
describe("the isolated browser's exact client-history read contract", () => {
  it("permits the reviewed public-only read on the exact local endpoint", () => {
    expect(isClientHistoryRead("POST", url, JSON.stringify(args))).toBe(true);
  });
  it.each([
    "https://remote.supabase.co/rest/v1/rpc/movimentos_do_cliente",
    "http://localhost:54321/rest/v1/rpc/movimentos_do_cliente",
    "http://127.0.0.1:54322/rest/v1/rpc/movimentos_do_cliente",
    "http://user:pass@127.0.0.1:54321/rest/v1/rpc/movimentos_do_cliente",
    "http://127.0.0.1:54321/rest/v1/rpc/decide_file_approval",
    "http://127.0.0.1:54321/rest/v1/tasks",
    url + "?extra=1",
  ])("blocks a different origin, operation or query: %s", (target) => {
    expect(isClientHistoryRead("POST", target, JSON.stringify(args))).toBe(false);
  });
  it.each(["GET", "PATCH", "DELETE", "PUT"])("does not grant method %s", (method) => {
    expect(isClientHistoryRead(method, url, JSON.stringify(args))).toBe(false);
  });
  it.each([
    { ...args, _somente_visiveis: false }, { ...args, _somente_visiveis: "true" },
    { ...args, action: "write" }, { ...args, _client_id: null },
    { ...args, _client_id: "invalid" }, { ...args, _desde: "not-a-date" },
    { ...args, _desde: "2026-10-21T00:00:00.000Z" },
    { ...args, _desde: "2024-01-01T00:00:00.000Z" },
    { _client_id: args._client_id }, [], null,
  ])("rejects malformed, internal or excessive payload %#", (payload) => {
    expect(isClientHistoryRead("POST", url, JSON.stringify(payload))).toBe(false);
  });
  it("rejects a missing or invalid JSON body", () => {
    expect(isClientHistoryRead("POST", url, null)).toBe(false);
    expect(isClientHistoryRead("POST", url, "{")).toBe(false);
  });
});

describe("the isolated browser's exact product-state read contract", () => {
  const origin = "http://127.0.0.1:54321";
  const endpoint = `${origin}/rest/v1/rpc/produto_estado`;

  it("permits the SDK's actual zero-argument read", async () => {
    const requests: boolean[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(isProductStateRead(request.method, request.url, await request.text()));
      return Response.json({ conta: null });
    };
    const client = createClient(origin, "synthetic-test-key", { global: { fetch } });

    const { error } = await client.rpc("produto_estado");

    expect(error).toBeNull();
    expect(requests).toEqual([true]);
  });

  it.each([
    "https://remote.supabase.co/rest/v1/rpc/produto_estado",
    "http://localhost:54321/rest/v1/rpc/produto_estado",
    "http://127.0.0.1:54322/rest/v1/rpc/produto_estado",
    "http://user:pass@127.0.0.1:54321/rest/v1/rpc/produto_estado",
    `${origin}/rest/v1/rpc/produto_aceitar_convite`,
    `${endpoint}?extra=1`,
    `${endpoint}#fragment`,
  ])("blocks different URL %s", (target) => {
    expect(isProductStateRead("POST", target, "{}")).toBe(false);
  });

  it.each(["GET", "PATCH", "DELETE", "PUT"])("blocks method %s", (method) => {
    expect(isProductStateRead(method, endpoint, "{}")).toBe(false);
  });

  it.each([null, "{", "[]", '{"a":1}'])("blocks payload %s", (body) => {
    expect(isProductStateRead("POST", endpoint, body)).toBe(false);
  });
});
