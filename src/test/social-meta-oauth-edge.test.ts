import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  META_REQUIRED_SCOPES,
  buildFacebookLoginUrl,
  createAppSecretProof,
  missingMetaScopes,
  parseManagedPages,
  redactSensitive,
  sanitizeMetaResources,
  validateMetaRedirectUri,
} from "../../supabase/functions/social-meta-oauth/meta";

const edgeSource = readFileSync(
  resolve(process.cwd(), "supabase/functions/social-meta-oauth/index.ts"),
  "utf8",
);

describe("social Meta OAuth Edge boundary", () => {
  it("authenticates every action and keeps Vault writes behind one service RPC", () => {
    expect(edgeSource).toContain("admin.auth.getUser(jwt)");
    expect(edgeSource).toContain('"social_meta_oauth_store_resources"');
    expect(edgeSource).toContain('"social_meta_oauth_finish_session"');
    expect(edgeSource).toContain("_user_access_token: userAccessToken");
    expect(edgeSource).toContain("_resources: resources");
    expect(edgeSource).not.toContain('from("vault.secrets")');
    expect(edgeSource).not.toContain("vault.create_secret");
    expect(edgeSource).toMatch(
      /"finish"[\s\S]*handleFinish\(body, caller\)/,
    );
  });

  it("keeps the complete action and Bearer parser free of duplicate arguments", () => {
    expect(edgeSource).toMatch(
      /requiredText\(\s*body\.code,\s*"Código de autorização ausente\.",\s*4_096,?\s*\)/,
    );
    expect(edgeSource.match(/return match\[1\];/g)).toHaveLength(1);
  });
});

describe("social Meta OAuth Edge helpers", () => {
  it("builds a versioned Facebook Login for Business URL", () => {
    const url = new URL(
      buildFacebookLoginUrl({
        appId: "123456",
        configId: "789012",
        graphVersion: "v26.0",
        redirectUri: "https://aceleriq.online/oauth/meta/callback",
        state: "opaque-state",
      }),
    );

    expect(`${url.origin}${url.pathname}`).toBe(
      "https://www.facebook.com/v26.0/dialog/oauth",
    );
    expect(url.searchParams.get("client_id")).toBe("123456");
    expect(url.searchParams.get("config_id")).toBe("789012");
    expect(url.searchParams.get("state")).toBe("opaque-state");
    expect(url.searchParams.get("scope")?.split(",")).toEqual([
      ...META_REQUIRED_SCOPES,
    ]);
  });

  it("accepts only the canonical or local callback origin and exact path", () => {
    expect(
      validateMetaRedirectUri(
        "https://aceleriq.online/oauth/meta/callback",
      ).origin,
    ).toBe("https://aceleriq.online");
    expect(() =>
      validateMetaRedirectUri("https://preview.example/oauth/meta/callback"),
    ).toThrow("origem autorizada");
    expect(() =>
      validateMetaRedirectUri(
        "https://aceleriq.online/oauth/meta/callback?next=/calendario",
      ),
    ).toThrow("META_REDIRECT_URI inválida");
  });

  it("creates the Meta appsecret_proof with HMAC SHA-256", async () => {
    await expect(
      createAppSecretProof("user-token", "app-secret"),
    ).resolves.toBe(
      "b5a94d985eb7b68467d28ca5375162d12b9ca8fe238615acc927c8a9c08d2e95",
    );
  });

  it("rejects the connection when any required scope is missing", () => {
    const result = missingMetaScopes([
      { permission: "pages_show_list", status: "granted" },
      { permission: "pages_read_engagement", status: "granted" },
      { permission: "pages_manage_posts", status: "declined" },
      { permission: "instagram_basic", status: "granted" },
      { permission: "instagram_content_publish", status: "granted" },
    ]);

    expect(result.missing).toEqual(["pages_manage_posts"]);
    expect(result.declined).toContain("pages_manage_posts");
  });

  it("discovers a Facebook Page and its linked professional Instagram account", () => {
    let sequence = 0;
    const resources = parseManagedPages(
      [
        {
          id: "page-123",
          name: "Página Oficial",
          access_token: "page-secret-token",
          tasks: ["CREATE_CONTENT", "MODERATE"],
          picture: { data: { url: "https://images.example/page.jpg" } },
          instagram_business_account: {
            id: "ig-456",
            username: "marca.oficial",
            name: "Marca Oficial",
            profile_picture_url: "https://images.example/ig.jpg",
          },
        },
      ],
      () => `candidate-${++sequence}`,
    );

    expect(resources).toHaveLength(2);
    expect(resources.map((resource) => resource.platform)).toEqual([
      "facebook",
      "instagram",
    ]);
    expect(resources[1]).toMatchObject({
      external_account_id: "ig-456",
      page_id: "page-123",
      handle: "marca.oficial",
      page_access_token: "page-secret-token",
    });

    const publicResources = sanitizeMetaResources(resources);
    expect(publicResources).toEqual([
      {
        candidate_id: "candidate-1",
        platform: "facebook",
        display_name: "Página Oficial",
      },
      {
        candidate_id: "candidate-2",
        platform: "instagram",
        display_name: "Marca Oficial",
        handle: "marca.oficial",
      },
    ]);
    expect(JSON.stringify(publicResources)).not.toContain("secret-token");
    expect(JSON.stringify(publicResources)).not.toContain("external_account_id");
  });

  it("redacts tokens, secrets, authorization codes and OAuth state from logs", () => {
    const redacted = redactSensitive({
      access_token: "raw-token",
      nested: {
        client_secret: "raw-secret",
        url: "https://example.com/callback?code=abc&state=def&safe=yes",
        message: "request failed with Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
      },
    });
    const serialized = JSON.stringify(redacted);

    expect(serialized).not.toContain("raw-token");
    expect(serialized).not.toContain("raw-secret");
    expect(serialized).not.toContain("abc");
    expect(serialized).not.toContain("def");
    expect(serialized).not.toContain("eyJhbGci");
    expect(serialized).toContain("safe=yes");
  });
});
