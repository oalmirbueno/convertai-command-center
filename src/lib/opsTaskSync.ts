/**
 * notifyOpsTask — fire-and-forget bridge from portal kanban → Ops.
 *
 * Calls the local edge function `portal-to-ops`, which forwards the event
 * to the Ops `receive-portal-sync` endpoint with the proper secret.
 *
 * Anti-loop rule: do NOT call this when a task mutation originated from
 * the Ops webhook itself (i.e. the change came in from Ops).
 */
const URL = "https://gicbrgagstyvbaaumprj.supabase.co/functions/v1/portal-to-ops";
const ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";

function send(payload: Record<string, unknown>) {
  try {
    fetch(URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: ANON,
        Authorization: `Bearer ${ANON}`,
      },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* silent */
  }
}

export const notifyOpsTaskCreated = (task_id: string) =>
  send({ event: "task_created", task_id });

export const notifyOpsTaskUpdated = (task_id: string) =>
  send({ event: "task_updated", task_id });

export const notifyOpsTaskDeleted = (task_id: string, ops_node_id?: string | null) =>
  send({ event: "task_deleted", task_id, ops_node_id: ops_node_id ?? null });
