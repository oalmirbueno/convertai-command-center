import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const url = new URL(req.url);

    // GET ?token=xxx -> public details (limited fields)
    if (req.method === "GET") {
      const token = url.searchParams.get("token");
      if (!token) return json({ error: "missing token" }, 400);

      const { data: contract, error } = await supabase
        .from("contracts")
        .select("id, title, description, original_file_url, original_file_name, status, admin_signature_name, admin_signed_at, client_signature_name, client_signed_at, client_id")
        .eq("sign_token", token)
        .maybeSingle();

      if (error || !contract) return json({ error: "invalid token" }, 404);

      // attach client basic info for display
      const { data: client } = await supabase
        .from("profiles")
        .select("full_name, company_name, email")
        .eq("id", contract.client_id)
        .maybeSingle();

      return json({ contract: { ...contract, client_id: undefined }, client });
    }

    // POST -> sign action
    if (req.method === "POST") {
      const body = await req.json();
      const { token, signature_name, accept } = body || {};
      if (!token || !signature_name || !accept) return json({ error: "missing fields" }, 400);

      const { data: contract, error: fetchErr } = await supabase
        .from("contracts")
        .select("*")
        .eq("sign_token", token)
        .maybeSingle();
      if (fetchErr || !contract) return json({ error: "invalid token" }, 404);
      if (contract.client_signed_at) return json({ error: "already signed" }, 400);
      if (contract.status !== "sent" && contract.status !== "signed") {
        return json({ error: "contract not available for signing" }, 400);
      }

      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      const now = new Date().toISOString();

      // Update contract as signed by client
      const { error: updateErr } = await supabase
        .from("contracts")
        .update({
          client_signature_name: signature_name,
          client_signed_at: now,
          client_signature_ip: ip,
          status: "completed",
        })
        .eq("id", contract.id);
      if (updateErr) return json({ error: updateErr.message }, 500);

      // Insert into files table under "Contratos" folder
      const { data: fileRow, error: fileErr } = await supabase
        .from("files")
        .insert({
          client_id: contract.client_id,
          project_id: contract.project_id,
          uploaded_by: contract.created_by || contract.client_id,
          file_name: contract.original_file_name,
          file_url: contract.original_file_url,
          file_type: "application/pdf",
          folder: "contratos",
          description: `Contrato assinado por ${signature_name} em ${new Date(now).toLocaleString("pt-BR")}`,
          approval_status: "approved",
        })
        .select("id")
        .single();

      if (!fileErr && fileRow) {
        await supabase.from("contracts").update({ file_id: fileRow.id }).eq("id", contract.id);
      }

      // Notify admins
      const { data: admins } = await supabase
        .from("user_roles").select("user_id").eq("role", "admin");
      const inserts = (admins || []).map((a: any) => ({
        user_id: a.user_id,
        message: `✍️ Contrato "${contract.title}" assinado pelo cliente`,
        notification_type: "update",
        link: "/contratos",
      }));
      if (inserts.length) await supabase.from("notifications").insert(inserts);

      return json({ ok: true });
    }

    return json({ error: "method not allowed" }, 405);
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});
