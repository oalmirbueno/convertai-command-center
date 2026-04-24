import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ═══ Aceleriq Ops webhook — empurra leads automaticamente ═══
const OPS_URL = "https://grxljyocuadywcksfyvu.supabase.co/functions/v1/receive-lead";
const OPS_SECRET = "aceleriq-ops-portal-bridge-2025-x7k9m2n4p8q";

// Copia simplificada do ICP-Fit calculator
const REVENUE_SCORE: Record<string, number> = {
  "Até R$ 20k/mês": 20,

  "R$ 20k-50k/mês": 35,
  "R$ 50k-200k/mês": 55,
  "R$ 200k-500k/mês": 75,
  "R$ 500k-1M/mês": 85,
  "R$ 1M-5M/mês": 95,
  "R$ 5M+/mês": 100,
};
const TEAM_SCORE: Record<string, number> = {
  "Solo (1 pessoa)": 30,
  "2-5 pessoas": 50,
  "6-15 pessoas": 75,
  "16-50 pessoas": 90,
  "51-200 pessoas": 95,
  "200+": 100,
};
const LEVEL_SCORE: Record<string, number> = { baixa: 30, media: 65, alta: 95 };

function calculateICP(body: Record<string, string | undefined>): { score: number; plan: string } {
  const revenue = body.revenue_range ? (REVENUE_SCORE[body.revenue_range] ?? 40) : 40;
  const team = body.team_size ? (TEAM_SCORE[body.team_size] ?? 50) : 50;
  const maturity = body.maturity_digital ? (LEVEL_SCORE[body.maturity_digital] ?? 50) : 50;
  const ai = body.ai_readiness ? (LEVEL_SCORE[body.ai_readiness] ?? 50) : 50;
  const commitment =
    (["positioning", "differential", "icp", "main_pains", "goals_12m", "success_metric"].filter(
      (k) => (body[k] ?? "").trim().length > 20,
    ).length /
      6) *
    100;
  const score = Math.round(revenue * 0.3 + maturity * 0.2 + ai * 0.2 + team * 0.15 + commitment * 0.15);
  let plan = "starter";
  if (body.revenue_range?.includes("200k-500k") || body.revenue_range?.includes("500k-1M")) plan = "growth";
  if (body.revenue_range?.includes("1M-5M") || body.revenue_range?.includes("5M+")) plan = "enterprise";
  return { score, plan };
}

// ═══ Push to Aceleriq Ops ═══════════════════════════════════
async function pushToOps(payload: Record<string, unknown>): Promise<void> {
  try {
    const res = await fetch(OPS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": OPS_SECRET,
      },
      body: JSON.stringify(payload),
    });
    const txt = await res.text();
    console.log(`[pushToOps] status=${res.status} body=${txt.slice(0, 200)}`);
  } catch (err) {
    console.error("[pushToOps] erro ao chamar Ops:", err);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json();
    const { token, action, ...rest } = body;

    if (!token) return new Response(JSON.stringify({ error: "Token obrigatório" }), { status: 400, headers: cors });

    if (action === "save_progress") {
      const { error } = await supabase.from("quiz_submissions").upsert(
        {
          token,
          status: "draft",
          ...rest,
        },
        { onConflict: "token" },
      );
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: cors });
      return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (action === "submit") {
      const { score, plan } = calculateICP(rest);
      const { error } = await supabase.from("quiz_submissions").upsert(
        {
          token,
          status: "submitted",
          submitted_at: new Date().toISOString(),
          icp_fit_score: score,
          recommended_plan: plan,
          ...rest,
        },
        { onConflict: "token" },
      );
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: cors });

      // Empurra pro Aceleriq Ops (não bloqueia o retorno ao usuário)
      await pushToOps({
        token,
        portal_submission_id: token,
        lead_name: rest.lead_name,
        lead_email: rest.lead_email,
        lead_whatsapp: rest.lead_whatsapp,
        lead_company: rest.lead_company,
        positioning: rest.positioning,
        differential: rest.differential,
        icp: rest.icp,
        main_pains: rest.main_pains,
        goals_12m: rest.goals_12m,
        success_metric: rest.success_metric,
        revenue_range: rest.revenue_range,
        team_size: rest.team_size,
        maturity_digital: rest.maturity_digital,
        ai_readiness: rest.ai_readiness,
        icp_fit_score: score,
        recommended_plan: plan,
        submitted_at: new Date().toISOString(),
      });

      return new Response(JSON.stringify({ ok: true, score, plan }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (action === "load") {
      const { data } = await supabase.from("quiz_submissions").select("*").eq("token", token).maybeSingle();
      return new Response(JSON.stringify({ data }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Action inválida" }), { status: 400, headers: cors });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "erro" }), {
      status: 500,
      headers: cors,
    });
  }
});
