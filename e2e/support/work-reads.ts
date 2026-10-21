import { CI_E2E_API_ORIGIN } from "../../config/ci-e2e-environment";

export type WorkTable = "projects" | "tasks";
export interface WorkReadResult {
  status: number;
  ids: string[];
  validRows: boolean;
  queryKeys: string[];
  bodyState: "json" | "unreadable" | "transport-error";
  jsonShape: "array" | "object" | "null" | "primitive" | "unreadable";
  errorCode: string | null;
  errorMessage: string | null;
  taskCards?: { id: string; title: string; status: string }[];
}

/** Only full synthetic work reads qualify. Auth, headers and session bodies never enter the observer. */
export function observedWorkTable(method: string, raw: string): WorkTable | null {
  try {
    const url = new URL(raw);
    if (method !== "GET" || url.origin !== CI_E2E_API_ORIGIN || url.username || url.password
      || !url.searchParams.get("select")?.startsWith("*")) return null;
    return url.pathname === "/rest/v1/projects" ? "projects"
      : url.pathname === "/rest/v1/tasks" ? "tasks" : null;
  } catch { return null; }
}

function failedRead(raw: string, status: number, bodyState: "unreadable" | "transport-error"): WorkReadResult {
  return { status, ids: [], validRows: false, queryKeys: [...new URL(raw).searchParams.keys()].sort(), bodyState, jsonShape: "unreadable", errorCode: null, errorMessage: null };
}

/** Read the APIResponse owned by route.fetch before navigation can discard a browser/CDP body. */
export async function summarizeWorkRead(table: WorkTable, raw: string, response: { status(): number; json(): Promise<unknown> }): Promise<WorkReadResult> {
  let rows: unknown;
  try { rows = await response.json(); } catch { return failedRead(raw, response.status(), "unreadable"); }
  const validRows = Array.isArray(rows) && rows.every((row) => row && typeof row.id === "string");
  const error = !validRows && rows && typeof rows === "object" && !Array.isArray(rows)
    ? rows as { code?: unknown; message?: unknown } : null;
  return {
    status: response.status(), validRows,
    queryKeys: [...new URL(raw).searchParams.keys()].sort(),
    bodyState: "json", jsonShape: Array.isArray(rows) ? "array" : rows === null ? "null" : typeof rows === "object" ? "object" : "primitive",
    ids: validRows ? (rows as { id: string }[]).map((row) => row.id).sort() : [],
    errorCode: typeof error?.code === "string" ? error.code.slice(0, 24) : null,
    errorMessage: typeof error?.message === "string"
      ? error.message.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 300) : null,
    taskCards: table === "tasks" && validRows
      ? (rows as { id: string; title: string; status: string }[]).map((row) => ({ id: row.id, title: row.title, status: row.status })).sort((left, right) => left.id.localeCompare(right.id))
      : undefined,
  };
}

export interface WorkReadObservation {
  readonly reads: Record<WorkTable, WorkReadResult[]>;
  readonly active: boolean;
  track(table: WorkTable, raw: string, forwarded: Promise<WorkReadResult>): void;
  drain(): Promise<void>;
  finish(): Promise<void>;
}

/** Track from request start through fulfillment, rather than leaving body reads behind a hard goto. */
export function observeWorkReads(): WorkReadObservation {
  const reads: Record<WorkTable, WorkReadResult[]> = { projects: [], tasks: [] };
  const pending = new Set<Promise<void>>();
  let active = true;
  const drain = async () => { while (pending.size) await Promise.all([...pending]); };
  return {
    reads, get active() { return active; },
    track(table, raw, forwarded) {
      if (!active) return;
      const done = forwarded.then((result) => { reads[table].push(result); }, () => {
        // A failed fetch/fulfill remains a failed assertion, never a skipped read.
        reads[table].push(failedRead(raw, 0, "transport-error"));
      });
      pending.add(done);
      void done.then(() => pending.delete(done));
    },
    drain,
    async finish() { active = false; await drain(); },
  };
}
