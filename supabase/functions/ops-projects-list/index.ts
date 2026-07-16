import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret" };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const SECRET = Deno.env.get("OPS_WEBHOOK_SECRET") ?? "";
  if (!SECRET || req.headers.get("x-webhook-secret") !== SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: cors });
  }
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, status, project_type, client_id, client:profiles!projects_client_id_fkey(full_name, company_name)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: cors });
  const projects = (data ?? []).map((p: any) => ({
    id: p.id, name: p.name, status: p.status, project_type: p.project_type,
    client_id: p.client_id,
    client_name: p.client?.full_name ?? "Cliente",
    client_company: p.client?.company_name ?? null,
  }));
  return new Response(JSON.stringify({ projects }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
});
