import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ResendApiError,
  parseRetryAfter,
  resolveResendEmailsUrl,
  sendResendEmail,
} from "../../supabase/functions/_shared/resend.ts";

const EMAIL = {
  from: "Aceleriq <contato@aceleriq.online>",
  to: ["cliente@example.com"],
  subject: "Assunto",
  html: "<p>Conteúdo</p>",
};

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("first-party Resend transport", () => {
  it("posts the preserved email payload directly to Resend", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ id: "email-123" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));

    const result = await sendResendEmail(EMAIL, {
      apiKey: "re_test_key",
      fetchImpl: fetchImpl as typeof fetch,
      idempotencyKey: "message-123",
    });

    expect(result).toMatchObject({ id: "email-123", status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    if (!init) throw new Error("Expected Resend request options");
    expect(url).toBe("https://api.resend.com/emails");
    expect(init).toMatchObject({ method: "POST" });
    expect(init.headers).toMatchObject({
      Authorization: "Bearer re_test_key",
      "Content-Type": "application/json",
      "Idempotency-Key": "message-123",
    });
    expect(JSON.parse(String(init.body))).toEqual(EMAIL);
  });

  it("supports a secure first-party API base URL", () => {
    expect(resolveResendEmailsUrl("https://email-api.example.com/v1/"))
      .toBe("https://email-api.example.com/v1/emails");
    expect(resolveResendEmailsUrl("https://email-api.example.com/v1/emails"))
      .toBe("https://email-api.example.com/v1/emails");
    expect(() => resolveResendEmailsUrl("http://email-api.example.com"))
      .toThrow(ResendApiError);
  });

  it("preserves provider status, code, details and Retry-After", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ name: "rate_limit_exceeded", message: "Too many requests" }),
      {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "17" },
      },
    ));

    const error = await sendResendEmail(EMAIL, {
      apiKey: "re_test_key",
      fetchImpl: fetchImpl as typeof fetch,
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(ResendApiError);
    expect(error).toMatchObject({
      status: 429,
      code: "rate_limit_exceeded",
      retryAfterSeconds: 17,
      details: { name: "rate_limit_exceeded", message: "Too many requests" },
    });
  });

  it("parses Retry-After delta seconds and HTTP dates", () => {
    const now = Date.parse("2026-08-07T12:00:00Z");
    expect(parseRetryAfter("12", now)).toBe(12);
    expect(parseRetryAfter("Fri, 07 Aug 2026 12:00:21 GMT", now)).toBe(21);
    expect(parseRetryAfter("invalid", now)).toBeNull();
  });

  it("fails closed when the provider key is absent", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const error = await sendResendEmail(EMAIL, {
      apiKey: "",
      fetchImpl: fetchImpl as typeof fetch,
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(ResendApiError);
    expect(error).toMatchObject({ status: 500, message: "Email transport is not configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("email transport static contracts", () => {
  it("removes the Lovable gateway from active senders", () => {
    for (const file of [
      "supabase/functions/process-email-queue/index.ts",
      "supabase/functions/send-contract-email/index.ts",
    ]) {
      const source = read(file);
      expect(source).toContain("../_shared/resend.ts");
      expect(source).not.toContain("connector-gateway.lovable.dev");
      expect(source).not.toContain("LOVABLE_API_KEY");
      expect(source).not.toContain("X-Connection-Api-Key");
    }
  });

  it("uses a stable provider idempotency key for queued delivery", () => {
    const source = read("supabase/functions/process-email-queue/index.ts");
    expect(source).toContain("providerIdempotencyKey");
    expect(source).toContain("payload.message_id.trim()");
    expect(source).toContain("{ idempotencyKey: providerIdempotencyKey }");
  });

  it("derives every active sender domain from portable email configuration", () => {
    for (const file of [
      "supabase/functions/auth-email-hook/index.ts",
      "supabase/functions/send-contract-email/index.ts",
      "supabase/functions/send-transactional-email/index.ts",
    ]) {
      const source = read(file);
      expect(source).toContain("email-config.ts");
      expect(source).not.toMatch(/(?:FROM_DOMAIN|SENDER_DOMAIN)\s*=\s*["']aceleriq\.online/);
    }
  });

  it("prefers scoped preview secrets and keeps only a temporary fallback", () => {
    const source = read("supabase/functions/preview-transactional-email/index.ts");
    const internal = source.indexOf("INTERNAL_HOOK_SECRET");
    const preview = source.indexOf("EMAIL_PREVIEW_SECRET");
    const fallback = source.indexOf("LOVABLE_API_KEY");

    expect(internal).toBeGreaterThan(-1);
    expect(preview).toBeGreaterThan(internal);
    expect(fallback).toBeGreaterThan(preview);
    expect(source).toContain("new Set(scopedSecrets)");
    expect(source).toContain("acceptedSecrets.add(legacyFallbackSecret)");
    expect(source).toContain("Server configuration error");
    expect(source).toContain("Unauthorized");
    expect(source).not.toContain("LOVABLE_API_KEY is not configured");
  });
});
