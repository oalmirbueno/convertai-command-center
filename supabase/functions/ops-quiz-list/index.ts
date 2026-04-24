import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  // Valida secret
  const SECRET = Deno.env.get("OPS_WEBHOOK_SECRET") ?? "";
  if (SECRET && req.headers.get("x-webhook-secret") !== SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Retorna apenas submissions com status 'submitted' (pendentes)
  const { data, error } = await supabase
    .from("quiz_submissions")
    .select("*")
    .eq("status", "submitted")
    .order("submitted_at", { ascending: false })
    .limit(100);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({ submissions: data ?? [] }), {
    status: 200, headers: { ...cors, "Content-Type": "application/json" },
  });
});
