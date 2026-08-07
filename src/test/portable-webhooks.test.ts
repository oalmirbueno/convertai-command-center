import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const authHook = readFileSync(
  "supabase/functions/auth-email-hook/index.ts",
  "utf8",
);
const suppressionHook = readFileSync(
  "supabase/functions/handle-email-suppression/index.ts",
  "utf8",
);

describe("portable email webhooks", () => {
  it("supports the signed native Supabase Send Email Hook contract", () => {
    expect(authHook).toContain("SEND_EMAIL_HOOK_SECRET");
    expect(authHook).toContain("standardwebhooks@1.0.0");
    expect(authHook).toContain("email_data");
    expect(authHook).toContain("webhook-id");
    expect(authHook).toContain("webhook-signature");
    expect(authHook).toContain("webhook-timestamp");
    expect(authHook).toContain("new Webhook(normalizeStandardWebhookSecret(hookSecret))");
    expect(authHook).toContain("webhook.verify(rawBody, Object.fromEntries(req.headers))");
    expect(authHook).toContain("JSON.stringify({ error: { http_code: status, message } })");
    expect(authHook).toContain("APP_PUBLIC_URL");
    expect(authHook).not.toContain("orbital-command-hq.lovable.app");
  });

  it("implements Supabase's email-change hash mapping and one-or-two delivery behavior", () => {
    expect(authHook).toContain("user.new_email ?? emailData.new_email");
    expect(authHook).toContain("delivery(email, tokenHashNew, token, 'current'");
    expect(authHook).toContain("delivery(newEmail, tokenHash, tokenNew, 'new'");
    expect(authHook).toContain("delivery(newEmail, tokenHash, tokenNew ?? token");
    expect(authHook).toContain("delivery_id: deliverySuffix");
    expect(authHook).toContain(".eq('status', 'sent')");
    expect(authHook).toContain("do not treat a pending log as delivered");
  });

  it("validates suppression payloads before privileged database writes", () => {
    expect(suppressionHook).toContain("SUPPRESSION_WEBHOOK_SECRET");
    expect(suppressionHook).not.toContain("INTERNAL_HOOK_SECRET");
    expect(suppressionHook).toContain("SUPPRESSION_REASONS");
    expect(suppressionHook).toContain("isSuppressionReason(rawReason)");
    expect(suppressionHook).toContain("typeof data.is_retry !== 'boolean'");
    expect(suppressionHook).toContain("Number.isInteger(data.retry_count)");
    expect(suppressionHook).toContain("MAX_WEBHOOK_BODY_BYTES");
    expect(suppressionHook).toContain("redactEmail(normalizedEmail)");
  });

  it("keeps Lovable packages outside the portable top-level module graph", () => {
    expect(authHook).not.toMatch(
      /^import .*@lovable\.dev/m,
    );
    expect(suppressionHook).not.toMatch(
      /^import .*@lovable\.dev/m,
    );
    expect(authHook).toContain("import('npm:@lovable.dev/email-js')");
    expect(authHook).toContain("import('npm:@lovable.dev/webhooks-js')");
    expect(suppressionHook).toContain("import('npm:@lovable.dev/webhooks-js')");
    expect(authHook).toContain("The legacy verifier is imported only");
    expect(suppressionHook).toContain("dynamically only");
  });
});
