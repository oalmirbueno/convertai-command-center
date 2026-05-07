// Short delete-only test: creates ONE task under an existing valid project+milestone,
// syncs it to Ops, then deletes it twice to validate soft_deleted + already_deleted.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const NOTIFY = "https://gicbrgagstyvbaaumprj.supabase.co/functions/v1/notify-ops";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

async function notify(type: string, data: any, context: any = {}) {
  const r = await fetch(NOTIFY, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
    },
    body: JSON.stringify({ type, data, context }),
  });
  let body: any = null;
  try { body = await r.json(); } catch { body = await r.text(); }
  return { http: r.status, body };
}

const actionOf = (b: any) => (b?.result?.action || b?.action || "").toString();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(url, svc);
  const report: any[] = [];

  try {
    const body = await req.json().catch(() => ({}));
    const tag: string = body.tag || `DeleteOnly-${Date.now()}`;

    // Find a controlled project+milestone with ops_workspace_id + ops_milestone_id
    let projectId: string | null = body.project_id ?? null;
    let milestoneId: string | null = body.milestone_id ?? null;
    let opsWsId: string | null = null;
    let opsMsId: string | null = null;
    let clientId: string | null = null;

    if (projectId && milestoneId) {
      const { data: p } = await sb.from("projects")
        .select("id,ops_workspace_id,client_id").eq("id", projectId).maybeSingle();
      const { data: m } = await sb.from("milestones")
        .select("id,ops_milestone_id").eq("id", milestoneId).maybeSingle();
      opsWsId = p?.ops_workspace_id ?? null;
      clientId = p?.client_id ?? null;
      opsMsId = m?.ops_milestone_id ?? null;
    } else {
      // Auto-pick: most recent active milestone with ops_milestone_id whose project also has ops_workspace_id
      const { data: rows } = await sb
        .from("milestones")
        .select("id, ops_milestone_id, project_id, projects!inner(id, ops_workspace_id, client_id, deleted_at)")
        .is("deleted_at", null)
        .not("ops_milestone_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(20);
      const pick = (rows ?? []).find((r: any) =>
        r.projects && !r.projects.deleted_at && r.projects.ops_workspace_id
      );
      if (!pick) {
        return new Response(JSON.stringify({
          ok: false,
          error: "No controlled project+milestone with ops_* ids found. Pass {project_id, milestone_id} explicitly.",
        }, null, 2), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
      }
      projectId = pick.project_id;
      milestoneId = pick.id;
      opsMsId = pick.ops_milestone_id;
      opsWsId = (pick as any).projects.ops_workspace_id;
      clientId = (pick as any).projects.client_id;
    }

    report.push({ step: "0_target", project_id: projectId, milestone_id: milestoneId, ops_workspace_id: opsWsId, ops_milestone_id: opsMsId, client_id: clientId });

    // Step 1: create task locally
    const { data: tk, error: te } = await sb.from("tasks").insert({
      project_id: projectId,
      milestone_id: milestoneId,
      title: `E2E ${tag} Task`,
      status: "backlog",
      priority: "medium",
      sync_status: "pending_ops_sync",
      source: "portal",
    }).select().single();
    if (te) throw te;

    // Step 2: sync to Ops
    const r1 = await notify("task", tk, {
      ops_workspace_id: opsWsId,
      ops_milestone_id: opsMsId,
      client_id: clientId,
    });
    const opsNodeId = r1.body?.result?.node_id ?? r1.body?.result?.task_id ?? r1.body?.result?.id ?? null;
    await sb.from("tasks").update({
      sync_status: r1.body?.ok ? "synced" : "sync_error",
      ops_node_id: opsNodeId,
      sync_error: r1.body?.ok ? null : `HTTP ${r1.http}`,
    }).eq("id", tk.id);
    report.push({ step: "1_create_task", portal_id: tk.id, ops_node_id: opsNodeId, http: r1.http, body: r1.body });

    // Step 3: soft delete locally
    await sb.from("tasks").update({
      deleted_at: new Date().toISOString(),
      sync_status: "pending_ops_sync",
    }).eq("id", tk.id);

    // Step 4: first delete event -> expect task_soft_deleted
    const r2 = await notify("task_deleted", { id: tk.id, ops_node_id: opsNodeId });
    const a2 = actionOf(r2.body);
    report.push({ step: "2_first_delete", action: a2, http: r2.http, body: r2.body });

    // Step 5+6: second delete -> expect already_deleted
    const r3 = await notify("task_deleted", { id: tk.id, ops_node_id: opsNodeId });
    const a3 = actionOf(r3.body);
    report.push({ step: "3_second_delete_idempotency", action: a3, http: r3.http, body: r3.body });

    // Step 7: verify no duplicate / no resurrection on Portal
    const { data: finalTask } = await sb.from("tasks")
      .select("id, deleted_at, sync_status, ops_node_id")
      .eq("id", tk.id).maybeSingle();
    const { data: dupes } = await sb.from("tasks")
      .select("id")
      .eq("project_id", projectId!)
      .eq("milestone_id", milestoneId!)
      .eq("title", `E2E ${tag} Task`);

    const checks = {
      created_synced: r1.body?.ok && !!opsNodeId,
      first_delete_soft_deleted: /task_soft_deleted/i.test(a2),
      second_delete_idempotent: /already_deleted/i.test(a3),
      no_ignored: !/^ignored$/i.test(a2) && !/^ignored$/i.test(a3),
      no_created_or_updated_on_delete: !/^(created|updated)$/i.test(a2) && !/^(created|updated)$/i.test(a3),
      portal_still_soft_deleted: !!finalTask?.deleted_at,
      no_portal_duplicate: (dupes?.length ?? 0) === 1,
    };
    const verdict = Object.values(checks).every(Boolean) ? "PASS" : "FAIL";

    return new Response(JSON.stringify({
      ok: true, verdict, checks, report, finalTask,
    }, null, 2), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      report,
    }, null, 2), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
