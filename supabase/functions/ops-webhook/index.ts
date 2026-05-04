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
    | "node_deleted";
  data: Record<string, any>;
}

const OPS_TO_KANBAN_STATUS: Record<string, string> = {
  draft: "backlog",
  not_started: "backlog",
  active: "in_progress",
  in_progress: "in_progress",
  in_review: "review",
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
