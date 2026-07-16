import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PROJECT_REF =
  Deno.env.get("SUPABASE_URL")?.match(/https?:\/\/([^.]+)\./)?.[1] ?? "gicbrgagstyvbaaumprj";

const PORTAL_TO_OPS_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/portal-to-ops`;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const OPS_SECRET = Deno.env.get("OPS_WEBHOOK_SECRET") ?? "";
  const provided = req.headers.get("x-webhook-secret") ?? "";
  if (!OPS_SECRET || provided !== OPS_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }



  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_KEY);

    const { data: tasks, error } = await supabase
      .from("tasks")
      .select("id")
      .is("ops_node_id", null);
    if (error) throw error;

    let sent = 0;
    let failed = 0;

    for (const t of tasks ?? []) {
      try {
        const r = await fetch(PORTAL_TO_OPS_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_KEY}`,
          },
          body: JSON.stringify({ event: "task_created", task_id: t.id }),
        });
        if (r.ok) sent++;
        else failed++;
      } catch {
        failed++;
      }
    }

    return new Response(
      JSON.stringify({ ok: true, total: tasks?.length ?? 0, sent, failed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message ?? "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
