import { test as base, expect, type BrowserContext } from "@playwright/test";
import { CI_E2E_API_ORIGIN, CI_E2E_APP_ORIGIN } from "../../config/ci-e2e-environment";

const HTTP_ORIGINS = new Set([CI_E2E_APP_ORIGIN, CI_E2E_API_ORIGIN]);
const WS_ORIGINS = new Set(["ws://127.0.0.1:4173", "ws://127.0.0.1:54321"]);

export function isLocalEndpoint(raw: string, kind: "http" | "ws"): boolean {
  try {
    const url = new URL(raw);
    return !url.username && !url.password
      && (kind === "http" ? HTTP_ORIGINS : WS_ORIGINS).has(url.origin);
  } catch {
    return false;
  }
}

// Query strings may contain the local anon key. Diagnostics contain only an
// origin/path, never headers, credentials, a response body or an auth token.
function endpoint(raw: string): string {
  try {
    const url = new URL(raw);
    return url.origin + url.pathname;
  } catch {
    return "invalid-url";
  }
}

export interface EgressGuard {
  blocked: string[];
  unexpected: string[];
  expectBlocked(raw: string): void;
  close(): Promise<void>;
}

export async function installEgressGuard(context: BrowserContext): Promise<EgressGuard> {
  const expected = new Set<string>();
  let closing = false;
  const guard: EgressGuard = {
    blocked: [],
    unexpected: [],
    expectBlocked(raw) {
      if (isLocalEndpoint(raw, "http") || isLocalEndpoint(raw, "ws")) {
        throw new Error("Expected-block probes must not authorize a local request.");
      }
      expected.add(endpoint(raw));
    },
    async close() {
      // Keep routes installed while closing all pages, workers and sockets.
      // Cancelling an in-flight read during teardown is not an egress failure.
      closing = true;
      await context.close();
    },
  };
  const block = (raw: string) => {
    const safe = endpoint(raw);
    guard.blocked.push(safe);
    if (!expected.has(safe)) guard.unexpected.push(safe);
  };

  await context.route("**/*", async (route) => {
    const request = route.request();
    const raw = request.url();
    if (!isLocalEndpoint(raw, "http")) {
      block(raw);
      await route.abort("blockedbyclient");
      return;
    }
    const url = new URL(raw);
    // The selected UI flows need no database/RPC/storage writes or worker
    // calls. Permit only real Auth and the app's normal local login notice;
    // fail even if a new work endpoint is introduced under another table name.
    const isApi = url.origin === CI_E2E_API_ORIGIN;
    const normalLoginPost = request.method() === "POST"
      && ["/auth/v1/token", "/auth/v1/logout", "/functions/v1/notify-admin"].includes(url.pathname);
    const outsideReadContract = isApi && request.method() !== "OPTIONS"
      && (
        (!["GET", "HEAD"].includes(request.method()) && !normalLoginPost)
        || url.pathname.startsWith("/rest/v1/rpc/")
        || (url.pathname.startsWith("/functions/v1/") && !normalLoginPost)
      );
    if (outsideReadContract) {
      block(raw);
      await route.abort("blockedbyclient");
      return;
    }
    try {
      // Do not let Playwright's API client follow an allowed origin's redirect
      // to a remote endpoint. These password-login/read flows need no 3xx.
      const response = await route.fetch({ maxRedirects: 0, timeout: 30_000 });
      if (response.status() >= 300 && response.status() < 400
        && response.headers().location) {
        block(new URL(response.headers().location, raw).href);
        await route.abort("blockedbyclient");
        return;
      }
      await route.fulfill({ response });
    } catch {
      if (closing) return;
      guard.unexpected.push("local-request-failed:" + endpoint(raw));
      await route.abort("failed");
    }
  });
  await context.routeWebSocket(/.*/, async (socket) => {
    if (isLocalEndpoint(socket.url(), "ws")) {
      socket.connectToServer();
    } else {
      block(socket.url());
      // A routed socket has no upstream until connectToServer is called.
      await socket.close({ code: 1008, reason: "CI loopback-only network" });
    }
  });
  return guard;
}

export const test = base.extend<{ egress: EgressGuard }>({
  egress: [async ({ context }, provide) => {
    const guard = await installEgressGuard(context);
    await provide(guard);
    await guard.close();
    expect(guard.unexpected, "Unexpected external request, redirect or work mutation").toEqual([]);
  }, { auto: true }],
  // Install both context routes before creating a page, including its workers
  // and any popups. All tests import this fixture rather than the base test.
  page: async ({ context, egress: _egress }, provide) => {
    const page = await context.newPage();
    await provide(page);
  },
});

export { expect } from "@playwright/test";
