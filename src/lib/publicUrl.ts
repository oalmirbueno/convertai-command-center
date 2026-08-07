export type AppPublicUrlEnvironment = {
  VITE_APP_PUBLIC_URL?: string;
};

function normalizePublicUrl(value: string, variableName: string): string {
  const configured = value.trim();
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error(`${variableName} precisa ser uma URL absoluta válida.`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${variableName} precisa usar http ou https.`);
  }
  const loopback = url.hostname === "localhost"
    || url.hostname === "127.0.0.1"
    || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !loopback) {
    throw new Error(`${variableName} precisa usar https fora do ambiente local.`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      `${variableName} não pode conter credenciais, query string ou fragmento.`,
    );
  }
  if (url.pathname !== "/" || configured.endsWith("/")) {
    throw new Error(
      `${variableName} precisa conter somente a origem, sem caminho ou barra final.`,
    );
  }

  return url.origin;
}

export function resolveAppPublicUrl(
  env: AppPublicUrlEnvironment,
  runtimeOrigin?: string,
): string {
  const configured = env.VITE_APP_PUBLIC_URL?.trim();
  if (configured) return normalizePublicUrl(configured, "VITE_APP_PUBLIC_URL");
  if (runtimeOrigin?.trim()) return normalizePublicUrl(runtimeOrigin, "window.location.origin");
  throw new Error(
    "URL pública da aplicação ausente: defina VITE_APP_PUBLIC_URL ou execute no navegador.",
  );
}

const browserOrigin = typeof window === "undefined"
  ? undefined
  : window.location.origin;

export const APP_PUBLIC_URL = resolveAppPublicUrl(import.meta.env, browserOrigin);

export function appPublicUrl(path = ""): string {
  if (!path) return APP_PUBLIC_URL;
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("O caminho público precisa começar com uma única barra.");
  }
  return `${APP_PUBLIC_URL}${path}`;
}
