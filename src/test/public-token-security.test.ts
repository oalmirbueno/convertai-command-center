import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("public bearer-token boundaries", () => {
  it("requires a server-issued, expiring quiz invitation", () => {
    const quiz = read("supabase/functions/submit-quiz/index.ts");
    const dashboard = read("src/pages/AdminDashboard.tsx");
    const submissions = read("src/pages/AdminQuizSubmissions.tsx");

    expect(dashboard).toContain('rpc("issue_quiz_invitation_v2")');
    expect(quiz).toContain("TOKEN_PATTERN");
    expect(quiz).toContain("MAX_REQUEST_BYTES");
    expect(quiz).toContain("sha256Hex(token)");
    expect(quiz).toContain('rpc("load_quiz_invitation"');
    expect(quiz).toContain('rpc("save_quiz_invitation"');
    expect(quiz).toContain('rpc("submit_quiz_invitation"');
    expect(quiz).not.toContain('.from("quiz_submissions")');
    expect(quiz).not.toContain('.eq("token"');
    expect(quiz).not.toContain("p_token:");
    expect(submissions).not.toContain("s.token");
    expect(submissions).not.toContain("copyQuizLink");
    expect(submissions).not.toContain('.select("*")');
  });

  it("claims first access only after validation and consumes it after Auth", () => {
    const access = read("supabase/functions/client-first-access/index.ts");
    const validationIndex = access.indexOf("if (!validPassword(body.password))");
    const claimIndex = access.indexOf('"claim_first_access_token"');
    const passwordIndex = access.indexOf("admin.auth.admin.updateUserById");
    const consumeIndex = access.indexOf('"consume_first_access_claim"');
    const releaseMatches = access.match(/"release_first_access_claim"/g) ?? [];
    expect(validationIndex).toBeGreaterThan(-1);
    expect(claimIndex).toBeGreaterThan(-1);
    expect(validationIndex).toBeLessThan(claimIndex);
    expect(claimIndex).toBeLessThan(passwordIndex);
    expect(passwordIndex).toBeLessThan(consumeIndex);
    expect(releaseMatches).toHaveLength(1);
    expect(access).toContain("sha256Hex(token)");
    expect(access).toContain('email: typeof validation.email === "string"');
    expect(access).toContain('full_name: ""');
    expect(access).not.toContain('.from("profiles")');
    expect(access).not.toContain('.eq("first_access_token"');
    expect(access).not.toContain("(err as Error).message");
  });

  it("issues first-access bearers through private RPCs instead of browser writes", () => {
    const createClient = read("src/components/admin/CreateClientModal.tsx");
    const adminReset = read("supabase/functions/admin-reset-client-access/index.ts");

    expect(createClient).toContain('"issue_first_access_token"');
    expect(createClient).not.toContain("function generateToken");
    expect(createClient).not.toContain("first_access_token:");
    expect(adminReset).toContain('"issue_first_access_token_service"');
    expect(adminReset).not.toContain("crypto.randomUUID()");
    expect(adminReset).not.toMatch(/first_access_token:\s*firstAccessToken/);
  });

  it("does not write public tokens or recipient PII to logs", () => {
    const unsubscribe = read("supabase/functions/handle-email-unsubscribe/index.ts");
    const transactional = read("supabase/functions/send-transactional-email/index.ts");
    const opsWebhook = read("supabase/functions/ops-webhook/index.ts");
    expect(unsubscribe).not.toMatch(/console\.(?:log|error|warn)\([^\n]*\{[^\n]*(?:token|email)/i);
    expect(transactional).not.toMatch(/console\.(?:log|error|warn)\([^\n]*effectiveRecipient/);
    expect(opsWebhook).not.toContain("JSON.stringify(data)");
  });
});
