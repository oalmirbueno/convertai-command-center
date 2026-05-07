// Temporary E2E runner — uses service role to drive Portal local-first writes
// and forwards to notify-ops. Returns full step-by-step report.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(url, svc);
  const report: any[] = [];
  const log = (step: string, d: any) => { report.push({ step, ...d }); };

  try {
    const body = await req.json().catch(() => ({}));
    const clientUserId: string = body.client_user_id;
    if (!clientUserId) throw new Error("client_user_id required (auth user already created)");

    // ── Step 1: client (profile already exists from manage-team)
    await sb.from("profiles").update({
      sync_status: "pending_ops_sync",
      sync_error: null,
    }).eq("id", clientUserId);

    const r1 = await notify("profile", {
      id: clientUserId,
      email: "e2efinal-2026-05-07@test.local",
      full_name: "E2E Final Cliente 2026-05-07",
      company_name: "E2E Final Co",
    });
    const opsClientId = r1.body?.result?.client_id ?? null;
    await sb.from("profiles").update({
      sync_status: r1.body?.ok ? "synced" : "sync_error",
      ops_client_id: opsClientId,
      sync_error: r1.body?.ok ? null : `HTTP ${r1.http}`,
    }).eq("id", clientUserId);
    log("1_client", { portal_id: clientUserId, ops_client_id: opsClientId, http: r1.http, body: r1.body });

    // ── Step 2: project
    const { data: proj, error: pe } = await sb.from("projects").insert({
      client_id: clientUserId,
      name: "E2E Final Projeto 2026-05-07",
      project_type: "individual",
      start_date: "2026-05-07",
      deadline: "2026-06-07",
      status: "planning",
      sync_status: "pending_ops_sync",
    }).select().single();
    if (pe) throw pe;

    const r2 = await notify("project", proj, { client_id: clientUserId });
    const opsWsId = r2.body?.result?.workspace_id ?? null;
    await sb.from("projects").update({
      sync_status: r2.body?.ok ? "synced" : "sync_error",
      ops_workspace_id: opsWsId,
      sync_error: r2.body?.ok ? null : `HTTP ${r2.http}`,
    }).eq("id", proj.id);
    log("2_project", { portal_id: proj.id, ops_workspace_id: opsWsId, http: r2.http, body: r2.body });

    // ── Step 3: milestone
    const { data: ms, error: me } = await sb.from("milestones").insert({
      project_id: proj.id,
      title: "E2E Final Milestone",
      target_date: "2026-05-30",
      status: "pending",
      milestone_order: 0,
      sync_status: "pending_ops_sync",
    }).select().single();
    if (me) throw me;

    const r3 = await notify("milestone", ms, {
      ops_workspace_id: opsWsId,
      client_id: clientUserId,
    });
    const opsMsId = r3.body?.result?.milestone_id ?? r3.body?.result?.id ?? null;
    await sb.from("milestones").update({
      sync_status: r3.body?.ok ? "synced" : "sync_error",
      ops_milestone_id: opsMsId,
      sync_error: r3.body?.ok ? null : `HTTP ${r3.http}`,
    }).eq("id", ms.id);
    log("3_milestone", { portal_id: ms.id, ops_milestone_id: opsMsId, http: r3.http, body: r3.body });

    // ── Step 4: task
    const { data: tk, error: te } = await sb.from("tasks").insert({
      project_id: proj.id,
      milestone_id: ms.id,
      title: "E2E Final Task",
      status: "backlog",
      priority: "medium",
      sync_status: "pending_ops_sync",
      source: "portal",
    }).select().single();
    if (te) throw te;

    const r4 = await notify("task", tk, {
      ops_workspace_id: opsWsId,
      ops_milestone_id: opsMsId,
      client_id: clientUserId,
    });
    const opsNodeId = r4.body?.result?.node_id ?? r4.body?.result?.id ?? null;
    await sb.from("tasks").update({
      sync_status: r4.body?.ok ? "synced" : "sync_error",
      ops_node_id: opsNodeId,
      sync_error: r4.body?.ok ? null : `HTTP ${r4.http}`,
    }).eq("id", tk.id);
    log("4_task", { portal_id: tk.id, ops_node_id: opsNodeId, http: r4.http, body: r4.body });

    // ── Step 5: update task
    const { data: tk2 } = await sb.from("tasks").update({
      title: "E2E Final Task (updated)",
      status: "doing",
      progress: 50,
    }).eq("id", tk.id).select().single();
    const r5 = await notify("task", tk2, {
      ops_workspace_id: opsWsId,
      ops_milestone_id: opsMsId,
      client_id: clientUserId,
    });
    log("5_task_update", { portal_id: tk.id, http: r5.http, body: r5.body });

    // ── Step 6: delete task (soft)
    await sb.from("tasks").update({
      deleted_at: new Date().toISOString(),
      sync_status: "pending_ops_sync",
    }).eq("id", tk.id);
    const r6a = await notify("task_deleted", { id: tk.id, ops_node_id: opsNodeId });
    const r6b = await notify("task_deleted", { id: tk.id, ops_node_id: opsNodeId });
    log("6_task_delete", { portal_id: tk.id, first: r6a.body, second_idempotency: r6b.body });

    // ── Step 7: delete milestone
    await sb.from("milestones").update({
      deleted_at: new Date().toISOString(),
      sync_status: "pending_ops_sync",
    }).eq("id", ms.id);
    const r7a = await notify("milestone_deleted", { id: ms.id, ops_milestone_id: opsMsId });
    const r7b = await notify("milestone_deleted", { id: ms.id, ops_milestone_id: opsMsId });
    log("7_milestone_delete", { portal_id: ms.id, first: r7a.body, second_idempotency: r7b.body });

    // ── Step 8: delete project
    await sb.from("projects").update({
      deleted_at: new Date().toISOString(),
      sync_status: "pending_ops_sync",
    }).eq("id", proj.id);
    const r8a = await notify("project_deleted", { id: proj.id, ops_workspace_id: opsWsId });
    const r8b = await notify("project_deleted", { id: proj.id, ops_workspace_id: opsWsId });
    log("8_project_delete", { portal_id: proj.id, first: r8a.body, second_idempotency: r8b.body });

    // ── Step 9: delete client (soft on profile only — keep auth user to avoid cleanup chaos)
    await sb.from("profiles").update({
      deleted_at: new Date().toISOString(),
      sync_status: "pending_ops_sync",
    }).eq("id", clientUserId);
    const r9a = await notify("profile_deleted", { id: clientUserId, ops_client_id: opsClientId });
    const r9b = await notify("profile_deleted", { id: clientUserId, ops_client_id: opsClientId });
    log("9_client_delete", { portal_id: clientUserId, first: r9a.body, second_idempotency: r9b.body });

    // Final state
    const finalState = {
      profile: (await sb.from("profiles").select("id,sync_status,deleted_at,ops_client_id").eq("id", clientUserId).maybeSingle()).data,
      project: (await sb.from("projects").select("id,sync_status,deleted_at,ops_workspace_id").eq("id", proj.id).maybeSingle()).data,
      milestone: (await sb.from("milestones").select("id,sync_status,deleted_at,ops_milestone_id").eq("id", ms.id).maybeSingle()).data,
      task: (await sb.from("tasks").select("id,sync_status,deleted_at,ops_node_id").eq("id", tk.id).maybeSingle()).data,
    };

    return new Response(JSON.stringify({ ok: true, report, finalState }, null, 2), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      report,
    }, null, 2), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
