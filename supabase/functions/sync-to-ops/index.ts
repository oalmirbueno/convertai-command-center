// SUBSTITUI o conteúdo da edge function sync-to-ops NO PORTAL (aceleriq.online)
// Nova versão: envia context junto com cada payload (email, nome, etc)
// para que o Ops possa fazer auto-vínculo e auto-criação de clientes.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
};

const OPS_URL = "https://grxljyocuadywcksfyvu.supabase.co/functions/v1/receive-portal-sync";
const OPS_SECRET = Deno.env.get("OPS_WEBHOOK_SECRET") ?? "";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const received = req.headers.get("x-webhook-secret");
  if (received !== OPS_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const results: Record<string, number> = { projects: 0, briefings: 0, milestones: 0, updates: 0 };
  const errors: string[] = [];

  async function pushToOps(type: string, data: Record<string, unknown>, context?: Record<string, unknown>) {
    try {
      const res = await fetch(OPS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-webhook-secret": OPS_SECRET },
        body: JSON.stringify({ type, data, context }),
      });
      if (res.ok) return true;
      const txt = await res.text();
      errors.push(`${type} ${data.id}: ${res.status} ${txt.slice(0, 100)}`);
      return false;
    } catch (err) {
      errors.push(`${type} ${data.id}: ${err instanceof Error ? err.message : "erro"}`);
      return false;
    }
  }

  // Pré-carrega TODOS os profiles pra usar como lookup table
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, email, company_name, phone, plan_name");

  const profileMap = new Map<string, any>();
  (profiles ?? []).forEach((p) => profileMap.set(p.id, p));

  // 1. Projects — envia com context enriquecido (email, nome, empresa do cliente)
  const { data: projects } = await supabase.from("projects").select("*");
  for (const p of projects ?? []) {
    const profile = profileMap.get(p.client_id);
    const context = profile ? {
      client_email: profile.email,
      client_full_name: profile.full_name,
      client_company: profile.company_name,
      client_phone: profile.phone,
      client_plan: profile.plan_name,
    } : {};
    if (await pushToOps("project", p, context)) results.projects++;
  }

  // 2. Briefings — com context do cliente
  const { data: briefings } = await supabase.from("briefings").select("*").eq("submitted", true);
  for (const b of briefings ?? []) {
    const profile = profileMap.get(b.client_id);
    const context = profile ? {
      client_email: profile.email,
      client_full_name: profile.full_name,
    } : {};
    if (await pushToOps("briefing", b, context)) results.briefings++;
  }

  // 3. Milestones
  const { data: milestones } = await supabase.from("milestones").select("*");
  for (const m of milestones ?? []) {
    if (await pushToOps("milestone", m)) results.milestones++;
  }

  // 4. Updates
  const { data: updates } = await supabase.from("updates").select("*").order("created_at", { ascending: true }).limit(500);
  for (const u of updates ?? []) {
    if (await pushToOps("update", u)) results.updates++;
  }

  return new Response(JSON.stringify({ ok: true, results, errors: errors.slice(0, 20) }),
    { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
});
