import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const SECRET = Deno.env.get("OPS_WEBHOOK_SECRET") ?? "";
  if (SECRET && req.headers.get("x-webhook-secret") !== SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Roles are stored in user_roles (not profiles). Get all client user_ids first.
  const { data: roleRows, error: roleErr } = await supabase
    .from("user_roles")
    .select("user_id")
    .eq("role", "client");

  if (roleErr) {
    return new Response(JSON.stringify({ error: roleErr.message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const clientUserIds = (roleRows ?? []).map((r: any) => r.user_id);
  if (clientUserIds.length === 0) {
    return new Response(JSON.stringify({ clients: [] }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const { data: profiles, error: profErr } = await supabase
    .from("profiles")
    .select("id, full_name, company_name, email, created_at")
    .in("id", clientUserIds)
    .order("created_at", { ascending: false })
    .limit(200);

  if (profErr) {
    return new Response(JSON.stringify({ error: profErr.message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const clientIds = (profiles ?? []).map((p) => p.id);
  const { data: projects } = await supabase
    .from("projects")
    .select("id, client_id, status")
    .in("client_id", clientIds.length > 0 ? clientIds : ["00000000-0000-0000-0000-000000000000"]);

  const projectsByClient = new Map<string, number>();
  (projects ?? []).forEach((p: any) => {
    if (p.status !== "done" && p.status !== "archived") {
      projectsByClient.set(p.client_id, (projectsByClient.get(p.client_id) ?? 0) + 1);
    }
  });

  const clients = (profiles ?? []).map((p) => ({
    id: p.id,
    full_name: p.full_name ?? "Cliente",
    name: p.full_name ?? null,
    company_name: p.company_name ?? null,
    company: p.company_name ?? null,
    display_name: p.company_name ?? p.full_name ?? null,
    email: p.email ?? null,
    active_projects: projectsByClient.get(p.id) ?? 0,
  }));

  return new Response(JSON.stringify({ clients }), {
    status: 200,
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
