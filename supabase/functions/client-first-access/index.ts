import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { action, token, password } = await req.json();
    if (!token || typeof token !== "string") {
      return json({ error: "Token ausente." }, 400);
    }

    // Find the profile holding this first-access token
    const { data: profile, error: lookupError } = await admin
      .from("profiles")
      .select("id, full_name, email, company_name, first_access_used_at")
      .eq("first_access_token", token)
      .maybeSingle();

    if (lookupError) throw lookupError;
    if (!profile) {
      return json({ error: "invalid", message: "Link inválido ou expirado." }, 200);
    }
    if (profile.first_access_used_at) {
      return json({ error: "used", message: "Este link já foi utilizado." }, 200);
    }

    // Just validating the token (page load)
    if (action === "validate") {
      return json({
        valid: true,
        email: profile.email,
        full_name: profile.full_name,
        company: profile.company_name,
      });
    }

    // Setting the password (form submit)
    if (action === "set_password") {
      if (!password || typeof password !== "string" || password.length < 6) {
        return json({ error: "A senha deve ter no mínimo 6 caracteres." }, 400);
      }

      const { error: pwError } = await admin.auth.admin.updateUserById(
        profile.id,
        { password },
      );
      if (pwError) throw pwError;

      // Store the chosen password so the admin can view/manage it,
      // mark the token as used (single-use).
      const { error: updError } = await admin
        .from("profiles")
        .update({
          portal_password: password,
          first_access_used_at: new Date().toISOString(),
          first_access_token: null,
        })
        .eq("id", profile.id);
      if (updError) throw updError;

      return json({ success: true, email: profile.email });
    }

    return json({ error: "Ação inválida." }, 400);
  } catch (err) {
    console.error("client-first-access error:", err);
    return json({ error: (err as Error).message || "Erro interno." }, 400);
  }
});
