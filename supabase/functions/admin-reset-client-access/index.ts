import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { EMAIL_APP_URL as PORTAL_URL } from "../_shared/email-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type RpcRecord = Record<string, unknown>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function rpcRecord(value: unknown): RpcRecord | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate !== null && typeof candidate === "object" &&
      !Array.isArray(candidate)
    ? candidate as RpcRecord
    : null;
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authHeader = req.headers.get("Authorization") ?? "";
    const authToken = authHeader.replace(/^Bearer\s+/i, "");
    if (!authToken) return json({ error: "Unauthorized" }, 401);

    const { data: userData, error: userErr } = await admin.auth.getUser(
      authToken,
    );
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);

    const { data: isAdmin, error: roleError } = await admin.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "admin",
    });
    if (roleError || !isAdmin) return json({ error: "Forbidden" }, 403);

    const body = await req.json() as Record<string, unknown>;
    const profileId = body.profile_id;
    const newEmail = typeof body.new_email === "string"
      ? body.new_email.trim().toLowerCase()
      : "";
    const newFullName = typeof body.new_full_name === "string"
      ? body.new_full_name.trim()
      : "";
    const sendContractId = body.send_contract_id;
    if (
      !validUuid(profileId) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail) ||
      newEmail.length > 254 ||
      newFullName.length > 200 ||
      (sendContractId !== undefined && sendContractId !== null &&
        !validUuid(sendContractId))
    ) {
      return json({ error: "Dados inválidos" }, 400);
    }

    const { error: authError } = await admin.auth.admin.updateUserById(
      profileId,
      {
        email: newEmail,
        email_confirm: true,
      },
    );
    if (authError) throw new Error("auth_update_failed");

    const profileUpdate: Record<string, unknown> = {
      email: newEmail,
      // Explicitly scrub legacy public credential columns. The new bearer is
      // issued only by the private token RPC below.
      portal_password: null,
      first_access_token: null,
      first_access_used_at: null,
      first_access_expires_at: null,
      first_access_attempts: 0,
      first_access_last_attempt_at: null,
    };
    if (newFullName) profileUpdate.full_name = newFullName;

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .update(profileUpdate)
      .eq("id", profileId)
      .select("full_name, company_name")
      .single();
    if (profileError) throw new Error("profile_update_failed");

    const { data: issueData, error: issueError } = await admin.rpc(
      "issue_first_access_token_service",
      { p_profile_id: profileId },
    );
    const issue = rpcRecord(issueData);
    const firstAccessToken = typeof issue?.token === "string"
      ? issue.token
      : "";
    if (issueError || !/^[a-f0-9]{64}$/.test(firstAccessToken)) {
      throw new Error("token_issue_failed");
    }

    const firstAccessUrl =
      `${PORTAL_URL}/primeiro-acesso?token=${firstAccessToken}`;
    const { data: welcomeData, error: welcomeError } = await admin.functions
      .invoke(
        "send-transactional-email",
        {
          body: {
            templateName: "client-welcome",
            recipientEmail: newEmail,
            idempotencyKey: `client-welcome-resend-${profileId}-${Date.now()}`,
            templateData: {
              name: profile?.full_name || "",
              company: profile?.company_name || "",
              email: newEmail,
              firstAccessUrl,
            },
          },
        },
      );
    const welcomeResult = rpcRecord(welcomeData);
    if (welcomeError || welcomeResult?.error) {
      throw new Error("welcome_email_failed");
    }

    let contractResult: unknown = null;
    if (sendContractId) {
      const { data, error } = await admin.functions.invoke(
        "send-contract-email",
        {
          body: { contract_id: sendContractId },
        },
      );
      const result = rpcRecord(data);
      if (error || result?.error) {
        throw new Error("contract_email_failed");
      }
      contractResult = data;
    }

    return json({ success: true, firstAccessUrl, contractResult });
  } catch (error) {
    console.error("admin-reset-client-access failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return json(
      { error: "Não foi possível redefinir o acesso do cliente." },
      500,
    );
  }
});
