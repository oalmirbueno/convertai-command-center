// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ciE2eEnvironment } from "../../config/ci-e2e-environment";

// Deliberately unsigned local fixtures, never valid authentication material.
const jwt = (claims: Record<string, unknown>) => [
  Buffer.from('{"alg":"none"}').toString("base64url"),
  Buffer.from(JSON.stringify(claims)).toString("base64url"), "fixture",
].join(".");
const environment = () => ({ CI: "true", GITHUB_ACTIONS: "true",
  ACELERIQ_E2E_ANON_KEY: jwt({ role: "anon", iss: "supabase-demo" }),
});

describe("isolated E2E public configuration", () => {
  it("fixes both origins to loopback despite a conflicting inherited VITE environment", () => {
    const result = ciE2eEnvironment({ ...environment(),
      VITE_SUPABASE_URL: "https://remote.invalid",
      VITE_APP_PUBLIC_URL: "https://remote.invalid",
      VITE_SUPABASE_PUBLISHABLE_KEY: "must-not-be-used",
      ACELERIQ_E2E_SERVICE_ROLE_KEY: "must-not-be-exposed",
    });
    expect(result.VITE_SUPABASE_URL).toBe("http://127.0.0.1:54321");
    expect(result.VITE_APP_PUBLIC_URL).toBe("http://127.0.0.1:4173");
    expect(result.VITE_SUPABASE_PUBLISHABLE_KEY).toBe(environment().ACELERIQ_E2E_ANON_KEY);
    expect(JSON.stringify(result)).not.toContain("must-not");
    expect(Object.keys(result)).toHaveLength(4);
  });
  it.each([{}, { CI: "true" }, { GITHUB_ACTIONS: "true" }, { CI: "false", GITHUB_ACTIONS: "true" }])(
    "rejects a non-CI environment %#", (flags) => {
      expect(() => ciE2eEnvironment({ ...flags, ACELERIQ_E2E_ANON_KEY: environment().ACELERIQ_E2E_ANON_KEY })).toThrow(/GitHub CI/);
    },
  );
  it.each([
    { role: "service_role", iss: "supabase-demo" },
    { role: "anon", iss: "supabase", ref: "remote-project" },
    { role: "anon", iss: "supabase-demo", ref: "remote-project" },
  ])("rejects privileged or remote claims %#", (claims) => {
    expect(() => ciE2eEnvironment({ ...environment(), ACELERIQ_E2E_ANON_KEY: jwt(claims) })).toThrow(/remote project or privileged/);
  });
  it.each([undefined, "", "not-a-jwt", "a.bad.c"])("rejects malformed local keys %#", (key) => {
    expect(() => ciE2eEnvironment({ ...environment(), ACELERIQ_E2E_ANON_KEY: key })).toThrow(/local Supabase anon JWT/);
  });
});
