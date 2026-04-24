import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
};

const OPS_URL = "https://grxljyocuadywcksfyvu.supabase.co/functions/v1/receive-lead";
const OPS_SECRET = Deno.env.get("OPS_WEBHOOK_SECRET") ?? "";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  // Proteção por secret — evita terceiro chamar essa função
  const received = req.headers.get("x-webhook-secret");
  if (!OPS_SECRET || received !== OPS_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Pega TODOS submissions com status "submitted"
  const { data: submissions, error } = await supabase
    .from("quiz_submissions")
    .select("*")
    .eq("status", "submitted")
    .order("submitted_at", { ascending: true });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const total = submissions?.length ?? 0;
  let success = 0;
  let failed = 0;
  const errors: Array<{ token: string; error: string }> = [];

  for (const sub of submissions ?? []) {
    try {
      const res = await fetch(OPS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-webhook-secret": OPS_SECRET,
        },
        body: JSON.stringify({
          token: sub.token,
          portal_submission_id: sub.token,
          lead_name: sub.lead_name ?? "Lead sem nome",
          lead_email: sub.lead_email,
          lead_whatsapp: sub.lead_whatsapp,
          lead_company: sub.lead_company,
          positioning: sub.positioning,
          differential: sub.differential,
          icp: sub.icp,
          main_pains: sub.main_pains,
          goals_12m: sub.goals_12m,
          success_metric: sub.success_metric,
          revenue_range: sub.revenue_range,
          team_size: sub.team_size,
          maturity_digital: sub.maturity_digital,
          ai_readiness: sub.ai_readiness,
          icp_fit_score: sub.icp_fit_score,
          recommended_plan: sub.recommended_plan,
          origin: sub.origin,
          submitted_at: sub.submitted_at,
        }),
      });
      if (res.ok) {
        success++;
      } else {
        failed++;
        const text = await res.text();
        errors.push({ token: sub.token, error: `${res.status}: ${text.slice(0, 100)}` });
      }
    } catch (err) {
      failed++;
      errors.push({ token: sub.token, error: err instanceof Error ? err.message : "erro" });
    }
  }

  return new Response(
    JSON.stringify({
      total,
      success,
      failed,
      errors: errors.slice(0, 10),
    }),
    {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    },
  );
});
