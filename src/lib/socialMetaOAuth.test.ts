import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke } },
}));

import {
  completeMetaOAuth,
  connectMetaOAuth,
  disconnectMetaOAuth,
  finishMetaOAuth,
  META_OAUTH_MESSAGE_TYPE,
  metaAuthorizationUrl,
  parseMetaOAuthPopupMessage,
  sanitizeMetaOAuthResources,
  startMetaOAuth,
} from "@/lib/socialMetaOAuth";

describe("social Meta OAuth client", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("starts through the Edge Function with only scoped identifiers", async () => {
    invoke.mockResolvedValue({
      data: {
        authorization_url:
          "https://www.facebook.com/v23.0/dialog/oauth?state=opaque",
      },
      error: null,
    });

    const result = await startMetaOAuth({
      client_id: "client-1",
      project_id: "project-1",
      return_path: "/oauth/meta/callback",
    });

    expect(result.authorization_url).toMatch(/^https:\/\/www\.facebook\.com\//);
    expect(invoke).toHaveBeenCalledWith("social-meta-oauth", {
      body: {
        action: "start",
        client_id: "client-1",
        project_id: "project-1",
        return_path: "/oauth/meta/callback",
      },
    });
  });

  it("rejects an authorization redirect outside Meta", () => {
    expect(() => metaAuthorizationUrl("https://example.com/oauth")).toThrow(
      "não é confiável",
    );
    expect(() => metaAuthorizationUrl("http://www.facebook.com/oauth")).toThrow(
      "não é confiável",
    );
  });

  it("sanitizes and allowlists discovered resources", () => {
    expect(
      sanitizeMetaOAuthResources([
        {
          candidate_id: " page-1\u0000 ",
          platform: "Instagram",
          display_name: "  Loja\n Oficial ",
          handle: " @loja ",
          ignored_secret: "never-forwarded",
        },
        {
          candidate_id: "page-2",
          platform: "unsupported",
          display_name: "Ignorada",
        },
      ]),
    ).toEqual([
      {
        candidate_id: "page-1",
        platform: "instagram",
        display_name: "Loja Oficial",
        handle: "@loja",
      },
    ]);
  });

  it("completes, connects and disconnects with their exact action bodies", async () => {
    invoke
      .mockResolvedValueOnce({
        data: {
          oauth_session_id: "session-1",
          resources: [
            {
              candidate_id: "candidate-1",
              platform: "facebook",
              display_name: "Página oficial",
              handle: null,
            },
          ],
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { external_account_id: "account-1" },
        error: null,
      })
      .mockResolvedValueOnce({ data: { ok: true }, error: null })
      .mockResolvedValueOnce({ data: { ok: true }, error: null });

    await expect(
      completeMetaOAuth({ code: "code-1", state: "state-1" }),
    ).resolves.toMatchObject({ oauth_session_id: "session-1" });
    await expect(
      connectMetaOAuth({
        oauth_session_id: "session-1",
        candidate_id: "candidate-1",
        client_id: "client-1",
        project_id: "project-1",
      }),
    ).resolves.toEqual({ external_account_id: "account-1" });
    await expect(
      finishMetaOAuth({
        oauth_session_id: "session-1",
        client_id: "client-1",
        project_id: "project-1",
      }),
    ).resolves.toEqual({ ok: true });
    await expect(
      disconnectMetaOAuth({ external_account_id: "account-1" }),
    ).resolves.toEqual({ ok: true });

    expect(invoke.mock.calls.map((call) => call[1].body.action)).toEqual([
      "complete",
      "connect",
      "finish",
      "disconnect",
    ]);
  });

  it("accepts only a typed, sanitized callback message", () => {
    expect(
      parseMetaOAuthPopupMessage({
        type: META_OAUTH_MESSAGE_TYPE,
        ok: true,
        oauth_session_id: "session-1",
        resources: [
          {
            candidate_id: "candidate-1",
            platform: "facebook",
            display_name: "Página oficial",
            handle: " página ",
            extra: "ignored",
          },
        ],
      }),
    ).toEqual({
      type: META_OAUTH_MESSAGE_TYPE,
      ok: true,
      oauth_session_id: "session-1",
      resources: [
        {
          candidate_id: "candidate-1",
          platform: "facebook",
          display_name: "Página oficial",
          handle: "página",
        },
      ],
    });
    expect(parseMetaOAuthPopupMessage({ type: "other", ok: true })).toBeNull();
  });
});
