const MAX_INTERNAL_PATH_LENGTH = 2048;

/**
 * Accepts only same-application relative paths. Backslashes are rejected
 * because browsers can reinterpret them as slashes in special URLs.
 */
export function safeInternalPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (
    candidate.length === 0 ||
    candidate.length > MAX_INTERNAL_PATH_LENGTH ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    /%5c/i.test(candidate) ||
    /[\u0000-\u001f\u007f]/.test(candidate)
  ) {
    return null;
  }

  try {
    const base = new URL("https://internal.invalid");
    const parsed = new URL(candidate, base);
    return parsed.origin === base.origin ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * O link público de um post já no ar (Instagram/Facebook).
 *
 * Notificação de publicação leva para FORA do painel — é o único lugar do
 * app em que isso acontece — então o endereço passa por uma lista fechada
 * de destinos em vez do "é http, então vai". O valor vem do banco, gravado
 * pelo motor de autopublicação a partir da resposta da Meta; se um dia esse
 * campo for adulterado, um redirecionamento aberto sairia daqui direto para
 * uma página de phishing com a cara do painel.
 *
 * Só https, só os domínios das plataformas em que a casa publica, e sem
 * credencial embutida no endereço.
 */
const PUBLIC_POST_HOSTS = new Set([
  "instagram.com",
  "www.instagram.com",
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
  "fb.watch",
]);

export function safePublicPostUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (candidate.length === 0 || candidate.length > MAX_INTERNAL_PATH_LENGTH) {
    return null;
  }
  if (/[\u0000-\u001f\u007f]/.test(candidate)) return null;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:") return null;
    // Usuário e senha no endereço são o truque clássico de disfarçar o host.
    if (parsed.username || parsed.password) return null;
    if (!PUBLIC_POST_HOSTS.has(parsed.hostname.toLowerCase())) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
