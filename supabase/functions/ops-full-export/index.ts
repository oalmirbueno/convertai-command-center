import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  // Auth por secret
  const SECRET = Deno.env.get("OPS_WEBHOOK_SECRET") ?? "";
  if (SECRET && req.headers.get("x-webhook-secret") !== SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // 1. Todos os clientes (via user_roles + profiles)
  const { data: roles } = await db.from("user_roles").select("user_id").eq("role", "client");
  const clientIds = (roles ?? []).map((r: any) => r.user_id);

  let profiles: any[] = [];
  if (clientIds.length > 0) {
    const { data } = await db.from("profiles")
      .select("id, full_name, company_name, email, phone, plan_name, created_at")
      .in("id", clientIds);
    profiles = data ?? [];
  }

  // 2. Todos os projetos
  const { data: projects } = await db.from("projects")
    .select("id, client_id, name, description, project_type, status, progress, scope, objectives, start_date, deadline, created_at")
    .order("created_at", { ascending: false });

  // 3. Todos os briefings submetidos
  const { data: briefings } = await db.from("briefings")
    .select("id, client_id, project_id, responses, submitted, created_at")
    .eq("submitted", true);

  // 4. Todos os milestones
  const { data: milestones } = await db.from("milestones")
    .select("id, project_id, title, description, status, target_date, milestone_order, created_at")
    .order("milestone_order", { ascending: true });

  // 5. Todas as tasks
  const { data: tasks } = await db.from("tasks")
    .select("id, project_id, title, description, status, priority, assigned_to, created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  // 6. Todos os updates (exceto system)
  const { data: updates } = await db.from("updates")
    .select("id, project_id, author_id, message, update_type, created_at")
    .neq("update_type", "system")
    .order("created_at", { ascending: false })
    .limit(300);

  return new Response(JSON.stringify({
    profiles: profiles ?? [],
    projects: projects ?? [],
    briefings: briefings ?? [],
    milestones: milestones ?? [],
    tasks: tasks ?? [],
    updates: updates ?? [],
    _meta: {
      exported_at: new Date().toISOString(),
      counts: {
        profiles: profiles?.length ?? 0,
        projects: projects?.length ?? 0,
        briefings: briefings?.length ?? 0,
        milestones: milestones?.length ?? 0,
        tasks: tasks?.length ?? 0,
        updates: updates?.length ?? 0,
      },
    },
  }), { headers: { ...cors, "Content-Type": "application/json" } });
});
