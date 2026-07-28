interface FunctionErrorWithContext {
  message?: string;
  context?: Response;
}

export async function getSupabaseFunctionErrorMessage(
  error: unknown,
  fallback: string,
) {
  const candidate = error as FunctionErrorWithContext | null;
  const response = candidate?.context;

  if (response && typeof response.clone === "function") {
    try {
      const payload = (await response.clone().json()) as {
        error?: unknown;
      };
      if (typeof payload.error === "string" && payload.error.trim()) {
        return payload.error;
      }
    } catch {
      // The SDK message remains the safe fallback for a non-JSON response.
    }
  }

  return candidate?.message || fallback;
}
