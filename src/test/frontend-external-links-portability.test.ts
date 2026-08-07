import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveSupportWhatsAppNumber } from "@/lib/supportContact";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("portable frontend external links", () => {
  it("uses a canonical OAuth consent route and keeps Lovable only as an alias", () => {
    const app = read("src/App.tsx");
    expect(app).toContain('path="/oauth/consent"');
    expect(app).toContain('path="/.lovable/oauth/consent"');
  });

  it("serves social preview metadata from the current host", () => {
    const html = read("index.html");
    expect(html).toContain('content="%VITE_APP_PUBLIC_URL%/icon-512.png"');
    expect(html).not.toMatch(/\.lovable\.app|\.r2\.dev/);
    expect(read("vite.config.ts")).toContain(
      'requireProductionUrl("VITE_APP_PUBLIC_URL", env.VITE_APP_PUBLIC_URL)',
    );
  });

  it("normalizes a configured international WhatsApp number", () => {
    expect(resolveSupportWhatsAppNumber("+55 (11) 99999-9999"))
      .toBe("5511999999999");
    expect(resolveSupportWhatsAppNumber()).toBeNull();
    expect(() => resolveSupportWhatsAppNumber("invalid"))
      .toThrow("VITE_SUPPORT_WHATSAPP_NUMBER");
  });

  it("does not ship the retired placeholder number", () => {
    expect(read("src/pages/ReportDetail.tsx")).not.toContain("5500000000000");
    expect(read("src/pages/QuizPublicPage.tsx")).not.toMatch(/const WHATSAPP_NUMBER\s*=/);
    expect(read("src/pages/QuizPublicPage.tsx")).toContain("supportWhatsAppUrl");
  });
});
