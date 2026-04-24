import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
};

const EXPECTED_SECRET = Deno.env.get("OPS_WEBHOOK_SECRET") ?? "";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  if (req.headers.get("x-webhook-secret") !== EXPECTED_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Lista todas as tabelas do schema public
  const { data: tables } = await supabase.rpc("get_schema_tables");

  // Se o RPC não existir, usa query nativa
  if (!tables) {
    const { data } = await supabase
      .from("information_schema.tables")
      .select("table_name, table_type")
      .eq("table_schema", "public");

    return new Response(JSON.stringify({ tables: data }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ tables }), {
    status: 200,
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
