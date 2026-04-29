import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OPS_URL = "https://grxljyocuadywcksfyvu.supabase.co/functions/v1/receive-portal-sync";
const OPS_SECRET = Deno.env.get("OPS_WEBHOOK_SECRET") ?? "aceleriq-ops-portal-bridge-2025-x7k9m2n4p8q";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const body = await req.json();
    const { type, data, context } = body;

    if (!type || !data) {
      return new Response(JSON.stringify({ error: "type e data obrigatórios" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const res = await fetch(OPS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": OPS_SECRET,
      },
      body: JSON.stringify({ type, data, context: context ?? {} }),
    });

    const result = await res.json();

    return new Response(JSON.stringify({ ok: res.ok, status: res.status, result }),
      { headers: { ...cors, "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : "Erro desconhecido",
    }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
