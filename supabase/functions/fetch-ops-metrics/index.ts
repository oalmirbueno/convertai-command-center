import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autenticado" }),
        { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
    }

    // Valida auth do cliente
    const userSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userSupabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Usuário inválido" }),
        { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
    }

    // Busca ops_client_id do profile
    const adminSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: profile } = await adminSupabase
      .from("profiles")
      .select("ops_client_id")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile?.ops_client_id) {
      return new Response(JSON.stringify({ linked: false, error: "Perfil não vinculado ao Ops ainda" }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
    }

    // Chama Ops
    const OPS_URL = "https://grxljyocuadywcksfyvu.supabase.co/functions/v1";
    const SECRET = Deno.env.get("OPS_WEBHOOK_SECRET") ?? "";

    const opsRes = await fetch(`${OPS_URL}/client-metrics-public`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": SECRET,
      },
      body: JSON.stringify({ portal_client_id: user.id }),
    });

    const data = await opsRes.json();
    return new Response(JSON.stringify(data), {
      status: opsRes.status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "erro" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
