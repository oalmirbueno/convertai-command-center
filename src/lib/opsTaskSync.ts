/**
 * notifyOpsTask — fire-and-forget bridge from portal kanban → Ops.
 *
 * Calls the local edge function `portal-to-ops`, which forwards the event
 * to the Ops `receive-portal-sync` endpoint with the proper secret.
 *
 * Anti-loop rule: do NOT call this when a task mutation originated from
 * the Ops webhook itself (i.e. the change came in from Ops).
 *
 * Enrichment: além do task_id, enviamos milestone_id, portal_milestone_id,
 * ops_milestone_id, project_id e client_id em data, context e raiz.
 * O `portal-to-ops` ainda faz lookup definitivo, mas mandar isso na origem
 * deixa o pipeline robusto contra race conditions.
 */
import { supabase } from "@/integrations/supabase/client";

const URL = "https://gicbrgagstyvbaaumprj.supabase.co/functions/v1/portal-to-ops";
const ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";

async function enrich(task_id: string) {
  try {
    const { data } = await (supabase.from("tasks") as any)
      .select(
        "id, title, status, ops_node_id, project_id, milestone_id, " +
        "projects:project_id(client_id, name), " +
        "milestones:milestone_id(id, ops_milestone_id, title)"
      )
      .eq("id", task_id)
      .maybeSingle();
    if (!data) return null;
    const project: any = data.projects ?? {};
    const milestone: any = data.milestones ?? null;
    const portal_milestone_id = data.milestone_id ?? null;
    const ops_milestone_id = milestone?.ops_milestone_id ?? null;
    return {
      task_id: data.id,
      project_id: data.project_id,
      milestone_id: portal_milestone_id,
      portal_milestone_id,
      ops_milestone_id,
      client_id: project.client_id ?? null,
      ops_node_id: data.ops_node_id ?? null,
      title: data.title,
      status: data.status,
      data: {
        id: data.id,
        project_id: data.project_id,
        milestone_id: portal_milestone_id,
        portal_milestone_id,
        ops_milestone_id,
        ops_node_id: data.ops_node_id ?? null,
        title: data.title,
        status: data.status,
      },
      context: {
        project_id: data.project_id,
        milestone_id: portal_milestone_id,
        portal_milestone_id,
        ops_milestone_id,
        milestone_title: milestone?.title ?? null,
        client_id: project.client_id ?? null,
        project_name: project.name ?? null,
      },
    };
  } catch {
    return null;
  }
}

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

async function dispatch(event: string, task_id: string) {
  const extra = await enrich(task_id);
  send({ event, task_id, type: "task", source: "portal", ...(extra ?? {}) });
}

export const notifyOpsTaskCreated = (task_id: string) => {
  void dispatch("task_created", task_id);
};

export const notifyOpsTaskUpdated = (task_id: string) => {
  void dispatch("task_updated", task_id);
};

export const notifyOpsTaskDeleted = (task_id: string, ops_node_id?: string | null) =>
  send({ event: "task_deleted", task_id, ops_node_id: ops_node_id ?? null });
