// Pulls all nodes (tasks) from the Ops system into the portal `tasks` table.
// Idempotent upsert by (project_id, ops_node_id).
//
// POST body (all optional):
//   { project_id?: string }   // limit to a single project, otherwise all
//
// Calls the Ops endpoint `ops-nodes-list` with x-webhook-secret = PORTAL_TO_OPS_SECRET.
// Ops MUST return: { nodes: [{ ops_node_id, project_id, milestone_id?, title, status,
//                              progress?, node_type?, updated_at? }] }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OPS_NODES_URL =
  Deno.env.get("OPS_NODES_LIST_URL") ??
  "https://grxljyocuadywcksfyvu.supabase.co/functions/v1/ops-nodes-list";

const OPS_TO_KANBAN_STATUS: Record<string, string> = {
  todo: "backlog",
  draft: "backlog",
  not_started: "backlog",
  active: "doing",
  in_progress: "doing",
  doing: "doing",
  in_review: "review",
  review: "review",
  blocked: "blocked",
  done: "done",
  completed: "done",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const projectFilter: string | undefined = body?.project_id;

    const secret = Deno.env.get("PORTAL_TO_OPS_SECRET") ?? "";
    const opsRes = await fetch(OPS_NODES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": secret,
      },
      body: JSON.stringify({ project_id: projectFilter ?? null }),
    });

    if (!opsRes.ok) {
      const text = await opsRes.text();
      return new Response(
        JSON.stringify({ error: `Ops responded ${opsRes.status}`, detail: text }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const opsJson = await opsRes.json();
    const nodes: any[] = Array.isArray(opsJson?.nodes) ? opsJson.nodes : [];

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const errors: any[] = [];

    for (const n of nodes) {
      const opsNodeId = n.ops_node_id ?? n.node_id ?? n.id;
      const projectId = n.project_id;
      if (!opsNodeId || !projectId) {
        skipped++;
        continue;
      }
      if (projectFilter && projectId !== projectFilter) {
        skipped++;
        continue;
      }

      const status =
        n.kanban_status ??
        OPS_TO_KANBAN_STATUS[String(n.status ?? "").toLowerCase()] ??
        "backlog";

      const row: Record<string, any> = {
        project_id: projectId,
        milestone_id: n.milestone_id ?? n.portal_milestone_id ?? null,
        title: n.title ?? n.node_title ?? "Tarefa",
        status,
        ops_node_id: opsNodeId,
        source: "ops",
        updated_at: n.updated_at ?? new Date().toISOString(),
      };
      if (typeof n.progress === "number") row.progress = n.progress;
      if (n.node_type) row.node_type = n.node_type;

      const { data: existing, error: selErr } = await supabase
        .from("tasks")
        .select("id")
        .eq("project_id", projectId)
        .eq("ops_node_id", opsNodeId)
        .maybeSingle();

      if (selErr) {
        errors.push({ ops_node_id: opsNodeId, error: selErr.message });
        continue;
      }

      if (existing) {
        const { error } = await supabase.from("tasks").update(row).eq("id", existing.id);
        if (error) errors.push({ ops_node_id: opsNodeId, error: error.message });
        else updated++;
      } else {
        const { error } = await supabase
          .from("tasks")
          .insert({ ...row, priority: "medium", created_at: new Date().toISOString() });
        if (error) errors.push({ ops_node_id: opsNodeId, error: error.message });
        else inserted++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        total: nodes.length,
        inserted,
        updated,
        skipped,
        errors: errors.slice(0, 20),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("pull-ops-nodes error:", err);
    return new Response(
      JSON.stringify({ error: err?.message ?? "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
