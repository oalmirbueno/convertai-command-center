import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveWebhookBase } from "@/lib/webhooks";

describe("frontend webhook portability", () => {
  it("normalizes an explicit deployment URL", () => {
    expect(resolveWebhookBase("https://automation.example.com/webhook/"))
      .toBe("https://automation.example.com/webhook");
  });

  it("fails closed instead of inheriting a production endpoint", () => {
    expect(resolveWebhookBase()).toBeNull();
    const source = readFileSync("src/lib/webhooks.ts", "utf8");
    expect(source).not.toContain("n8n.srv1353465.hstgr.cloud");
    expect(existsSync(".env")).toBe(false);
    expect(source).not.toMatch(/VITE_WEBHOOK_URL\s*\|\|/);
  });

  it.each([
    "ftp://automation.example.com/webhook",
    "http://automation.example.com/webhook",
    "https://user:secret@automation.example.com/webhook",
    "https://automation.example.com/webhook?token=secret",
  ])("rejects an unsafe webhook URL: %s", (value) => {
    expect(() => resolveWebhookBase(value)).toThrow();
  });

  it("allows loopback HTTP during local development", () => {
    expect(resolveWebhookBase("http://127.0.0.1:5678/webhook"))
      .toBe("http://127.0.0.1:5678/webhook");
  });
});
