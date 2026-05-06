import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface OpsEvent {
  event:
    | "file_approved"
    | "node_completed"
    | "stage_advanced"
    | "node_created"
    | "node_updated"
    | "node_deleted"
    | "milestone.upserted";
  data: Record<string, any>;
}

// Ops status -> kanban column id used in the portal
// Kanban columns currently: backlog, doing, review, done. We add "blocked" as a new status value.
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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Optional shared-secret validation
    const expectedSecret = Deno.env.get("OPS_WEBHOOK_SECRET");
    if (expectedSecret) {
      const provided = req.headers.get("x-webhook-secret");
      if (provided !== expectedSecret) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const body = (await req.json()) as OpsEvent;
    const { event, data } = body || ({} as OpsEvent);

    console.log("[ops-webhook] received event:", event);
    console.log("[ops-webhook] received data:", JSON.stringify(data));

    if (!event || !data || typeof data !== "object") {
      return new Response(
        JSON.stringify({ error: "Invalid payload. Expected { event, data }" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let result: any = null;

    switch (event) {
      case "file_approved": {
        // Required: client_id, uploaded_by, file_url, file_name
        const required = ["client_id", "uploaded_by", "file_url", "file_name"];
        const missing = required.filter((k) => !data[k]);
        if (missing.length) {
          return new Response(
            JSON.stringify({ error: `Missing fields: ${missing.join(", ")}` }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { data: inserted, error } = await supabase
          .from("files")
          .insert({
            client_id: data.client_id,
            uploaded_by: data.uploaded_by,
            project_id: data.project_id ?? null,
            file_url: data.file_url,
            file_name: data.file_name,
            file_type: data.file_type ?? null,
            folder: data.folder ?? null,
            description: data.description ?? null,
            caption: data.caption ?? null,
            carousel_text: data.carousel_text ?? null,
            parent_file_id: data.parent_file_id ?? null,
            version: data.version ?? 1,
            approval_status: "approved",
          })
          .select()
          .single();

        if (error) throw error;
        result = inserted;
        break;
      }

      case "node_completed": {
        // Required: project_id, author_id, message
        const required = ["project_id", "author_id", "message"];
        const missing = required.filter((k) => !data[k]);
        if (missing.length) {
          return new Response(
            JSON.stringify({ error: `Missing fields: ${missing.join(", ")}` }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { data: inserted, error } = await supabase
          .from("updates")
          .insert({
            project_id: data.project_id,
            author_id: data.author_id,
            message: data.message,
            update_type: data.update_type ?? "system",
          })
          .select()
          .single();

        if (error) throw error;
        result = inserted;
        break;
      }

      case "stage_advanced": {
        // Required: project_id, author_id, message
        const required = ["project_id", "author_id", "message"];
        const missing = required.filter((k) => !data[k]);
        if (missing.length) {
          return new Response(
            JSON.stringify({ error: `Missing fields: ${missing.join(", ")}` }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { data: inserted, error } = await supabase
          .from("updates")
          .insert({
            project_id: data.project_id,
            author_id: data.author_id,
            message: data.message,
            update_type: "milestone",
          })
          .select()
          .single();

        if (error) throw error;
        result = inserted;
        break;
      }

      case "node_created":
      case "node_updated": {
        const opsNodeId = data.ops_node_id ?? data.node_id;
        const projectId = data.project_id;
        const title = data.title ?? data.node_title ?? "Tarefa";
        if (!opsNodeId || !projectId) {
          return new Response(
            JSON.stringify({ error: "Missing fields: project_id and ops_node_id/node_id" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const rawStatus = data.kanban_status ?? data.status;
        const mappedStatus = rawStatus
          ? OPS_TO_KANBAN_STATUS[String(rawStatus).toLowerCase()] ?? String(rawStatus).toLowerCase()
          : "backlog";
        const validColumns = new Set(["backlog", "doing", "review", "done", "blocked"]);
        const finalStatus = validColumns.has(mappedStatus) ? mappedStatus : "backlog";

        let milestoneId: string | null = data.portal_milestone_id ?? data.milestone_id ?? null;
        if (milestoneId) {
          const { data: ms } = await supabase
            .from("milestones")
            .select("id")
            .eq("id", milestoneId)
            .maybeSingle();
          if (!ms) {
            console.warn("[ops-webhook] milestone not found, dropping link:", milestoneId);
            milestoneId = null;
          }
        }

        // Find existing row by portal_task_id OR ops_node_id (scoped to project)
        const orFilter = data.portal_task_id
          ? `id.eq.${data.portal_task_id},ops_node_id.eq.${opsNodeId}`
          : `ops_node_id.eq.${opsNodeId}`;

        const { data: existing } = await supabase
          .from("tasks")
          .select("id")
          .eq("project_id", projectId)
          .or(orFilter)
          .maybeSingle();

        const row: Record<string, any> = {
          project_id: projectId,
          milestone_id: milestoneId,
          title,
          status: finalStatus,
          kanban_status: finalStatus,
          ops_node_id: opsNodeId,
          ops_updated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        if (typeof data.progress === "number") row.progress = data.progress;
        if (data.node_type) row.node_type = data.node_type;
        row.source = "ops";

        let task: any;
        if (existing) {
          const { data: upd, error: updErr } = await supabase
            .from("tasks")
            .update(row)
            .eq("id", existing.id)
            .select()
            .single();
          if (updErr) throw updErr;
          task = upd;
        } else {
          const { data: ins, error: insErr } = await supabase
            .from("tasks")
            .insert({ ...row, priority: "medium", created_at: new Date().toISOString() })
            .select()
            .single();
          if (insErr) throw insErr;
          task = ins;
        }

        if (data.author_id) {
          await supabase.from("updates").insert({
            project_id: projectId,
            author_id: data.author_id,
            message:
              data.message ??
              (event === "node_created"
                ? `Tarefa criada: ${title}`
                : `Tarefa atualizada: ${title}`),
            update_type:
              data.update_type ?? (event === "node_created" ? "task_created" : "task_updated"),
          });
        }

        result = { task, paired: !!data.portal_task_id };
        break;
      }

      case "node_deleted": {
        const opsNodeId = data.ops_node_id ?? data.node_id;
        if (!opsNodeId && !data.portal_task_id) {
          return new Response(
            JSON.stringify({ error: "Missing fields: ops_node_id/node_id or portal_task_id" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const orFilter = data.portal_task_id
          ? `id.eq.${data.portal_task_id},ops_node_id.eq.${opsNodeId ?? "00000000-0000-0000-0000-000000000000"}`
          : `ops_node_id.eq.${opsNodeId}`;

        let q = supabase.from("tasks").delete();
        if (data.project_id) q = q.eq("project_id", data.project_id);
        const { error: delErr } = await q.or(orFilter);
        if (delErr) throw delErr;

        if (data.project_id && data.author_id) {
          await supabase.from("updates").insert({
            project_id: data.project_id,
            author_id: data.author_id,
            message: data.message ?? `Tarefa removida (node ${opsNodeId})`,
            update_type: "task_deleted",
          });
        }

        result = { deleted: true };
        break;
      }

      case "milestone.upserted": {
        const opsMilestoneId = data.ops_milestone_id;
        const projectId = data.portal_project_id ?? data.project_id;
        const title = data.title ?? "Milestone";
        if (!opsMilestoneId || !projectId) {
          return new Response(
            JSON.stringify({ error: "Missing fields: portal_project_id and ops_milestone_id" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const statusMap: Record<string, string> = {
          active: "in_progress",
          in_progress: "in_progress",
          doing: "in_progress",
          done: "completed",
          completed: "completed",
          pending: "pending",
          todo: "pending",
        };
        const rawStatus = String(data.status ?? "pending").toLowerCase();
        const finalStatus = statusMap[rawStatus] ?? "pending";

        const order =
          typeof data.position === "number"
            ? data.position
            : typeof data.position?.order === "number"
              ? data.position.order
              : typeof data.order === "number"
                ? data.order
                : 0;

        // Look up existing by (project_id, ops_milestone_id)
        const { data: existing } = await supabase
          .from("milestones")
          .select("id")
          .eq("project_id", projectId)
          .eq("ops_milestone_id", opsMilestoneId)
          .maybeSingle();

        const row: Record<string, any> = {
          project_id: projectId,
          title,
          status: finalStatus,
          ops_milestone_id: opsMilestoneId,
          sync_origin: data.sync_origin ?? "ops",
          milestone_order: order,
          updated_at: new Date().toISOString(),
        };

        let milestone: any;
        if (existing) {
          const { data: upd, error: updErr } = await supabase
            .from("milestones")
            .update(row)
            .eq("id", existing.id)
            .select()
            .single();
          if (updErr) throw updErr;
          milestone = upd;
        } else {
          const { data: ins, error: insErr } = await supabase
            .from("milestones")
            .insert({
              ...row,
              target_date: data.target_date ?? new Date().toISOString().slice(0, 10),
            })
            .select()
            .single();
          if (insErr) throw insErr;
          milestone = ins;
        }

        return new Response(
          JSON.stringify({
            ok: true,
            portal_milestone_id: milestone.id,
            id: milestone.id,
            milestone_id: milestone.id,
            event,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unknown event type: ${event}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    return new Response(JSON.stringify({ success: true, event, result }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("ops-webhook error:", err);
    return new Response(
      JSON.stringify({ error: err?.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
