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
    // Quando false, apenas gera e devolve o link de primeiro acesso para o
    // admin copiar e enviar na mão, sem disparar o e-mail de convite.
    const sendEmail = body.send_email !== false;
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

    // Antes de qualquer escrita: so conta de CLIENTE pode ser redefinida.
    // Sem isso um admin poderia trocar o e-mail de outro admin ou de um
    // membro da equipe por esta porta, que foi feita para o portal.
    const { data: clientRole, error: clientRoleError } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", profileId)
      .eq("role", "client")
      .maybeSingle();
    if (clientRoleError) throw new Error("role_check_failed");
    if (!clientRole) {
      return json(
        { error: "Somente contas de cliente podem ser redefinidas" },
        403,
      );
    }

    // Guarda o estado anterior para desfazer se o Auth recusar mais adiante.
    const { data: previousProfile, error: previousError } = await admin
      .from("profiles")
      .select("email, full_name")
      .eq("id", profileId)
      .single();
    if (previousError || !previousProfile) {
      throw new Error("profile_lookup_failed");
    }

    // Ordem: perfil -> token -> Auth. O perfil e limpo ANTES do token porque
    // a RPC grava first_access_expires_at/used_at no proprio perfil, e a
    // limpeza depois apagaria o que ela acabou de escrever. O Auth vem por
    // ultimo porque e a etapa externa: se falhar, o perfil volta ao e-mail
    // anterior em vez de ficar apontando para um endereco que o Auth nao tem.
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

    const revertProfile = async (step: string) => {
      const { error: revertError } = await admin
        .from("profiles")
        .update({
          email: previousProfile.email,
          full_name: previousProfile.full_name,
        })
        .eq("id", profileId);
      if (revertError) {
        console.error("admin-reset-client-access revert failed", {
          step,
          profile_id: profileId,
          error: revertError.message,
        });
      }
    };

    const { data: issueData, error: issueError } = await admin.rpc(
      "issue_first_access_token_service",
      { p_profile_id: profileId },
    );
    const issue = rpcRecord(issueData);
    const firstAccessToken = typeof issue?.token === "string"
      ? issue.token
      : "";
    if (issueError || !/^[a-f0-9]{64}$/.test(firstAccessToken)) {
      await revertProfile("token_issue");
      throw new Error("token_issue_failed");
    }

    const { error: authError } = await admin.auth.admin.updateUserById(
      profileId,
      {
        email: newEmail,
        email_confirm: true,
      },
    );
    if (authError) {
      // O token ja foi emitido e continua valido para o perfil; o que nao
      // pode ficar e o e-mail do perfil diferente do e-mail do Auth.
      await revertProfile("auth_update");
      console.error("admin-reset-client-access auth update failed", {
        step: "auth_update",
        profile_id: profileId,
        error: authError.message,
      });
      return json(
        {
          error: "Não foi possível redefinir o acesso do cliente.",
          failed_step: "auth_update",
        },
        500,
      );
    }

    const firstAccessUrl =
      `${PORTAL_URL}/primeiro-acesso?token=${firstAccessToken}`;

    // delivery: "skipped" quando o admin só quer o link para enviar na mão.
    let delivery: { status: string; error: string | null } = {
      status: sendEmail ? "pending" : "skipped",
      error: null,
    };

    if (sendEmail) {
      const { data: welcomeData, error: welcomeError } = await admin.functions
        .invoke(
          "send-transactional-email",
          {
            body: {
              templateName: "client-welcome",
              recipientEmail: newEmail,
              idempotencyKey:
                `client-welcome-resend-${profileId}-${Date.now()}`,
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

      // Verifica a ENTREGA real no log do despachante para o painel não mentir:
      // "enfileirado" não é "entregue". Espera o dispatcher processar e lê o
      // status final (sent / failed / dlq) com a mensagem de erro, se houver.
      const welcomeMessageId = typeof welcomeResult?.message_id === "string"
        ? welcomeResult.message_id
        : null;
      if (welcomeMessageId) {
        for (let attempt = 0; attempt < 4; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          const { data: logRows } = await admin
            .from("email_send_log")
            .select("status, error_message, created_at")
            .eq("message_id", welcomeMessageId)
            .order("created_at", { ascending: false })
            .limit(5);
          const rows = Array.isArray(logRows) ? logRows : [];
          const final = rows.find((row) =>
            ["sent", "failed", "dlq", "bounced", "suppressed"].includes(
              String(row.status),
            )
          );
          if (final) {
            delivery = {
              status: String(final.status),
              error: final.error_message ? String(final.error_message) : null,
            };
            break;
          }
        }
      }
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

    return json({ success: true, firstAccessUrl, contractResult, delivery });
  } catch (error) {
    const failedStep = error instanceof Error ? error.message : "unknown_error";
    console.error("admin-reset-client-access failed", { error: failedStep });
    return json(
      {
        error: "Não foi possível redefinir o acesso do cliente.",
        failed_step: failedStep.replace(/_failed$/, ""),
      },
      500,
    );
  }
});
