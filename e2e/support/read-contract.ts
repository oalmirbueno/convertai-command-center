import { CI_E2E_API_ORIGIN } from "../../config/ci-e2e-environment";

const iso = (value: unknown): value is string => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

// The reviewed STABLE RPC only reads the customer's public activity. Keep
// every other RPC, internal-history flag, mutation and nonlocal URL blocked.
export function isClientHistoryRead(method: string, raw: string, body: string | null): boolean {
  try {
    const url = new URL(raw);
    if (method !== "POST" || url.origin !== CI_E2E_API_ORIGIN || url.username || url.password
      || url.pathname !== "/rest/v1/rpc/movimentos_do_cliente" || url.search || url.hash || !body) return false;
    const value: unknown = JSON.parse(body);
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const args = value as Record<string, unknown>;
    if (Object.keys(args).sort().join(",") !== "_ate,_client_id,_desde,_somente_visiveis"
      || typeof args._client_id !== "string"
      || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(args._client_id)
      || args._somente_visiveis !== true || !iso(args._desde) || !iso(args._ate)) return false;
    const duration = Date.parse(args._ate) - Date.parse(args._desde);
    return duration >= 0 && duration <= 366 * 86_400_000;
  } catch {
    return false;
  }
}
