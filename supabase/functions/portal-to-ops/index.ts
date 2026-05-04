import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OPS_RECEIVE_URL =
  Deno.env.get("OPS_RECEIVE_URL") ??
  "https://grxljyocuadywcksfyvu.supabase.co/functions/v1/receive-portal-sync";

const PORTAL_TO_OPS_SECRET = Deno.env.get("PORTAL_TO_OPS_SECRET") ?? "";

// kanban -> ops
const KANBAN_TO_OPS_STATUS: Record<string, string> = {
  backlog: "todo",
  doing: "in_progress",
  review: "in_review",
  blocked: "blocked",
  done: "done",
};

const PROGRESS_BY_STATUS: Record<string, number> = {
  backlog: 0,
  doing: 30,
  review: 80,
  blocked: 30,
  done: 100,
};

interface PortalEvent {
  event: "task_created" | "task_updated" | "task_deleted";
  task_id: string;
  source?: string; // if "ops", skip to avoid loop
  ops_node_id?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = (await req.json()) as PortalEvent;
    const { event, task_id, source } = body || ({} as PortalEvent);

    // anti-loop
    if (source === "ops") {
      return new Response(JSON.stringify({ skipped: true, reason: "source=ops" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!event || !task_id) {
      return new Response(JSON.stringify({ error: "event and task_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let payload: Record<string, any> = { event, task_id };

    if (event === "task_deleted") {
      payload.ops_node_id = body.ops_node_id ?? null;
    } else {
      const { data: task, error } = await supabase
        .from("tasks")
        .select("id, title, status, ops_node_id, project_id, projects:project_id(client_id, name)")
        .eq("id", task_id)
        .maybeSingle();
      if (error) throw error;
      if (!task) {
        return new Response(JSON.stringify({ error: "task not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const project: any = (task as any).projects ?? {};
      payload = {
        event,
        task_id: task.id,
        title: task.title,
        status: KANBAN_TO_OPS_STATUS[task.status] ?? "todo",
        progress: PROGRESS_BY_STATUS[task.status] ?? 0,
        ops_node_id: task.ops_node_id ?? null,
        project_id: task.project_id,
        client_id: project.client_id ?? null,
        client_name: project.name ?? null,
      };
    }

    const res = await fetch(OPS_RECEIVE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PORTAL_TO_OPS_SECRET}`,
        "x-webhook-secret": PORTAL_TO_OPS_SECRET,
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let parsed: any = text;
    try { parsed = JSON.parse(text); } catch {}

    return new Response(
      JSON.stringify({ ok: res.ok, status: res.status, payload, response: parsed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("portal-to-ops error:", err);
    return new Response(JSON.stringify({ error: err?.message ?? "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
