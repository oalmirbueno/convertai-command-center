import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
};

const OPS_URL = "https://grxljyocuadywcksfyvu.supabase.co/functions/v1/receive-lead";
const OPS_SECRET = Deno.env.get("OPS_WEBHOOK_SECRET") ?? "";
const OPS_ANON_KEY = Deno.env.get("OPS_ANON_KEY") ?? "";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

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

  // Pega ids de usuários com role "client" (role vive em user_roles, não em profiles)
  const { data: clientRoles, error: rolesError } = await supabase
    .from("user_roles")
    .select("user_id")
    .eq("role", "client");

  if (rolesError) {
    return new Response(JSON.stringify({ error: rolesError.message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const clientIds = (clientRoles ?? []).map((r) => r.user_id);

  if (clientIds.length === 0) {
    return new Response(JSON.stringify({ total: 0, success: 0, failed: 0, errors: [] }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, company_name, phone, created_at")
    .in("id", clientIds)
    .order("created_at", { ascending: true });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const total = profiles?.length ?? 0;
  let success = 0;
  let failed = 0;
  const errors: Array<{ profile_id: string; error: string }> = [];

  for (const p of profiles ?? []) {
    try {
      const res = await fetch(OPS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-webhook-secret": OPS_SECRET,
          "apikey": OPS_ANON_KEY,
          "Authorization": `Bearer ${OPS_ANON_KEY}`,
        },
        body: JSON.stringify({
          token: `profile-${p.id}`,
          portal_submission_id: p.id,
          lead_name: p.full_name ?? "Cliente sem nome",
          lead_email: p.email,
          lead_whatsapp: p.phone,
          lead_company: p.company_name,
          origin: "backfill_profiles",
          submitted_at: p.created_at,
        }),
      });
      if (res.ok) {
        success++;
      } else {
        failed++;
        const text = await res.text();
        errors.push({ profile_id: p.id, error: `${res.status}: ${text.slice(0, 100)}` });
      }
    } catch (err) {
      failed++;
      errors.push({ profile_id: p.id, error: err instanceof Error ? err.message : "erro" });
    }
  }

  return new Response(
    JSON.stringify({ total, success, failed, errors: errors.slice(0, 10) }),
    { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
  );
});
