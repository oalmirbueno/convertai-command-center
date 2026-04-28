import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SECRET =
  Deno.env.get("PORTAL_WEBHOOK_SECRET") ??
  Deno.env.get("OPS_WEBHOOK_SECRET") ??
  "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  if (!SECRET || req.headers.get("x-webhook-secret") !== SECRET) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: any = {};
  try {
    if (req.method === "POST") {
      const txt = await req.text();
      body = txt ? JSON.parse(txt) : {};
    }
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const rawLimit = Number(body.limit ?? 200);
  const limit = Math.max(1, Math.min(500, Number.isFinite(rawLimit) ? rawLimit : 200));
  const since: string | undefined = typeof body.since === "string" ? body.since : undefined;
  const after: string | undefined = typeof body.after === "string" ? body.after : undefined;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let query = supabase
    .from("quiz_submissions")
    .select("*")
    .order("submitted_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(limit);

  if (since) query = query.gte("submitted_at", since);
  if (after) query = query.lt("submitted_at", after);

  const { data, error } = await query;
  if (error) return json({ error: error.message }, 500);

  const rows = data ?? [];

  const leads = rows.map((r: any) => ({
    token: r.token ?? String(r.id),
    portal_submission_id: r.id ? String(r.id) : null,
    lead_name: r.lead_name ?? "Lead sem nome",
    lead_email: r.lead_email ?? null,
    lead_whatsapp: r.lead_whatsapp ?? null,
    lead_company: r.lead_company ?? null,
    positioning: r.positioning ?? null,
    differential: r.differential ?? null,
    icp: r.icp ?? null,
    main_pains: r.main_pains ?? null,
    goals_12m: r.goals_12m ?? null,
    success_metric: r.success_metric ?? null,
    revenue_range: r.revenue_range ?? null,
    team_size: r.team_size ?? null,
    maturity_digital: r.maturity_digital ?? null,
    ai_readiness: r.ai_readiness ?? null,
    icp_fit_score: r.icp_fit_score ?? null,
    recommended_plan: r.recommended_plan ?? null,
    origin: r.origin ?? null,
    submitted_at: r.submitted_at ?? r.created_at ?? null,
  }));

  const next_cursor =
    rows.length === limit ? rows[rows.length - 1]?.submitted_at ?? null : null;

  return json({ leads, next_cursor });
});
