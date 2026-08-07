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
