import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const expectedSecret = Deno.env.get("OPS_WEBHOOK_SECRET");
    if (!expectedSecret) {
      return new Response(
        JSON.stringify({ error: "Server misconfigured: OPS_WEBHOOK_SECRET not set" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const provided = req.headers.get("x-webhook-secret");
    if (provided !== expectedSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data, error } = await supabase
      .from("projects")
      .select(`
        id,
        name,
        status,
        project_type,
        client_id,
        created_at,
        client:profiles!projects_client_id_fkey ( full_name, company_name )
      `)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    const projects = (data ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      project_type: p.project_type,
      client_id: p.client_id,
      client_name: p.client?.full_name ?? null,
      client_company: p.client?.company_name ?? null,
    }));

    return new Response(JSON.stringify({ projects }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("ops-projects-list error:", err);
    return new Response(
      JSON.stringify({ error: err?.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
