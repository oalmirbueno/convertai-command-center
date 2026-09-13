// These origins are constants: the test server must never inherit the pinned
// production configuration or a developer's .env file.
export const CI_E2E_APP_ORIGIN = "http://127.0.0.1:4173";
export const CI_E2E_API_ORIGIN = "http://127.0.0.1:54321";

export function ciE2eEnvironment(env: Record<string, string | undefined>) {
  if (env.CI !== "true" || env.GITHUB_ACTIONS !== "true") {
    throw new Error("E2E server requires the disposable GitHub CI environment.");
  }
  const anonKey = env.ACELERIQ_E2E_ANON_KEY;
  let claims: Record<string, unknown>;
  try {
    const parts = anonKey?.split(".");
    if (parts?.length !== 3) throw new Error("format");
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("E2E server requires the local Supabase anon JWT.");
  }
  if (claims.iss !== "supabase-demo" || claims.role !== "anon" || claims.ref) {
    throw new Error("E2E server refuses a remote project or privileged key.");
  }
  return {
    VITE_SUPABASE_URL: CI_E2E_API_ORIGIN,
    VITE_SUPABASE_PUBLISHABLE_KEY: anonKey!,
    VITE_SUPABASE_PROJECT_ID: "local-ci",
    VITE_APP_PUBLIC_URL: CI_E2E_APP_ORIGIN,
  };
}
