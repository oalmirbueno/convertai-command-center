import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveAppPublicUrl } from "@/lib/publicUrl";

const read = (file: string) => readFileSync(file, "utf8");

describe("public application URL portability", () => {
  it("prefers an explicit build URL and otherwise uses the browser origin", () => {
    expect(resolveAppPublicUrl(
      { VITE_APP_PUBLIC_URL: "https://app.example.com" },
      "https://runtime.example.com",
    )).toBe("https://app.example.com");
    expect(resolveAppPublicUrl({}, "https://runtime.example.com"))
      .toBe("https://runtime.example.com");
  });

  it.each([
    "http://app.example.com",
    "https://user:secret@app.example.com",
    "https://app.example.com?token=secret",
    "https://app.example.com/",
    "https://app.example.com/aceleriq",
  ])("rejects an unsafe explicit application URL: %s", (value) => {
    expect(() => resolveAppPublicUrl({ VITE_APP_PUBLIC_URL: value }))
      .toThrow();
  });

  it("removes the production host from generated operational links", () => {
    for (const file of [
      "src/components/admin/CreateClientModal.tsx",
      "src/components/admin/BriefingLinkModal.tsx",
      "src/pages/AdminDashboard.tsx",
      "src/pages/AdminQuizSubmissions.tsx",
      "src/components/admin/MCPManager.tsx",
      "supabase/functions/admin-reset-client-access/index.ts",
    ]) {
      expect(read(file)).not.toContain('https://aceleriq.online');
    }
  });
});
