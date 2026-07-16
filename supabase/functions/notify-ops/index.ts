// notify-ops — proxy server-to-server do Portal para o Ops.
// Encaminha qualquer evento {type, data, context} para `receive-portal-sync`,
// inclusive eventos de deleção (profile_deleted, project_deleted,
// milestone_deleted, task_deleted).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OPS_URL =
  "https://grxljyocuadywcksfyvu.supabase.co/functions/v1/receive-portal-sync";
const OPS_SECRET = Deno.env.get("OPS_WEBHOOK_SECRET") ?? "";
if (!OPS_SECRET) {
  console.error("notify-ops: OPS_WEBHOOK_SECRET not configured");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  // Require shared webhook secret for this server-to-server proxy.
  const provided = req.headers.get("x-webhook-secret") ?? "";
  if (!OPS_SECRET || provided !== OPS_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }



  try {
    const body = await req.json();
    const { type, data, context } = body ?? {};

    if (!type || !data) {
      return new Response(
        JSON.stringify({ error: "type e data obrigatórios" }),
        {
          status: 400,
          headers: { ...cors, "Content-Type": "application/json" },
        },
      );
    }

    const res = await fetch(OPS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": OPS_SECRET,
      },
      body: JSON.stringify({
        type,
        event: type, // alguns receptores aceitam `event` em vez de `type`
        data,
        context: context ?? {},
        source: "portal",
      }),
    });

    let result: any = null;
    try {
      result = await res.json();
    } catch {
      result = { raw: await res.text() };
    }

    return new Response(
      JSON.stringify({ ok: res.ok, status: res.status, result }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("notify-ops error:", err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : "Erro desconhecido",
      }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
