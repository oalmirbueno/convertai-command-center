import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PORTAL_URL = "https://aceleriq.online";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Require admin caller
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: isAdmin } = await admin.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "admin",
    });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const {
      profile_id,
      new_email,
      new_full_name,
      send_contract_id,
      contract_recipient_email,
    } = await req.json();
    if (!profile_id || !new_email) throw new Error("profile_id e new_email obrigatórios");

    // 1. Update auth email
    const { error: authErr } = await admin.auth.admin.updateUserById(profile_id, {
      email: new_email,
      email_confirm: true,
    });
    if (authErr) throw authErr;

    // 2. Reset first-access token
    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const updatePayload: Record<string, unknown> = {
      email: new_email,
      first_access_token: token,
      first_access_used_at: null,
      portal_password: null,
    };
    if (typeof new_full_name === "string" && new_full_name.trim()) {
      updatePayload.full_name = new_full_name.trim();
    }
    const { data: prof, error: profErr } = await admin
      .from("profiles")
      .update(updatePayload)
      .eq("id", profile_id)
      .select("full_name, company_name")
      .single();
    if (profErr) throw profErr;

    // 3. Send welcome email
    const firstAccessUrl = `${PORTAL_URL}/primeiro-acesso?token=${token}`;
    await admin.functions.invoke("send-transactional-email", {
      body: {
        templateName: "client-welcome",
        recipientEmail: new_email,
        idempotencyKey: `client-welcome-resend-${profile_id}-${Date.now()}`,
        templateData: {
          name: prof?.full_name || "",
          company: prof?.company_name || "",
          email: new_email,
          firstAccessUrl,
        },
      },
    });

    // 4. Optionally resend a signed contract to a specific email
    let contractResult: unknown = null;
    if (send_contract_id) {
      const { data, error } = await admin.functions.invoke("send-contract-email", {
        body: {
          contract_id: send_contract_id,
          override_email: contract_recipient_email || new_email,
        },
      });
      if (error) contractResult = { error: error.message };
      else contractResult = data;
    }

    return new Response(JSON.stringify({ success: true, firstAccessUrl, contractResult }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("admin-reset-client-access error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
