import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  EMAIL_APP_URL,
  EMAIL_FROM_DOMAIN,
  EMAIL_LOGO_URL,
} from "../_shared/email-config.ts";
import { ResendApiError, sendResendEmail } from "../_shared/resend.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const PORTAL_URL = EMAIL_APP_URL;
const PORTAL_HOST = new URL(PORTAL_URL).hostname;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const bearer = authHeader.slice(7).trim();
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const trustedService = bearer === serviceKey;
    let caller: ReturnType<typeof createClient> | null = null;

    if (!trustedService) {
      caller = createClient(
        supabaseUrl,
        serviceKey,
        {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: authHeader } },
        },
      );
      const { data: userData, error: userErr } = await caller.auth.getUser();
      if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
    }


    const supabase = createClient(
      supabaseUrl,
      serviceKey,
    );

    const { contract_id } = await req.json();
    if (!contract_id) return json({ error: "missing contract_id" }, 400);

    const { data: contract } = await supabase
      .from("contracts").select("*").eq("id", contract_id).maybeSingle();
    if (!contract) return json({ error: "contract not found" }, 404);
    if (!trustedService) {
      const { data: canManage, error: manageError } = await caller!.rpc(
        "can_manage_client",
        { _client_id: contract.client_id },
      );
      if (manageError || canManage !== true) {
        return json({ error: "forbidden" }, 403);
      }
    }
    if (!contract.admin_signed_at) return json({ error: "admin must sign first" }, 400);
    if (
      contract.client_signed_at
      || contract.file_id
      || !["draft", "sent"].includes(contract.status)
    ) {
      return json({ error: "contract is no longer available for sending" }, 409);
    }

    const { data: client } = await supabase
      .from("profiles").select("full_name, email, company_name").eq("id", contract.client_id).maybeSingle();
    const recipient = client?.email?.trim();
    if (!recipient) return json({ error: "client without email" }, 400);

    const signUrl = `${PORTAL_URL}/contrato/${contract.sign_token}`;
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

    if (!RESEND_API_KEY) {
      return json({ error: "email service not configured" }, 500);
    }

    const year = new Date().getFullYear();

    const html = `<!DOCTYPE html>
<html lang="pt-BR" dir="ltr">
<head>
  <meta charset="utf-8">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>Contrato para assinatura</title>
</head>
<body style="margin:0;padding:32px 16px;background-color:#F4F4F4;font-family:Outfit,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;">
    <div style="background-color:#0D0D0D;padding:28px 32px;border-radius:16px 16px 0 0;border-bottom:2px solid #00FF66;text-align:left;">
      <img src="${EMAIL_LOGO_URL}" alt="AcelerIQ" width="140" style="display:block;height:auto;" />
    </div>
    <div style="background-color:#ffffff;border-radius:0 0 16px 16px;padding:40px 36px;border:1px solid #ECECEC;border-top:none;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
      <h1 style="font-size:26px;font-weight:700;color:#0D0D0D;margin:0 0 18px;line-height:1.25;letter-spacing:-0.01em;">
        Olá, ${client.full_name || "cliente"} 👋
      </h1>
      <p style="font-size:15px;color:#3a3a3a;line-height:1.65;margin:0 0 22px;">
        Você recebeu um contrato para assinatura digital${contract.admin_signature_name ? ` — já assinado por <strong style="color:#0D0D0D;">${contract.admin_signature_name}</strong>` : ""}.
      </p>
      <div style="margin:0 0 28px;padding:18px 20px;background-color:#F7F7F7;border-left:3px solid #00FF66;border-radius:8px;">
        <div style="font-size:11px;color:#8a8a8a;text-transform:uppercase;letter-spacing:0.12em;margin-bottom:6px;font-weight:600;">Contrato</div>
        <div style="font-size:16px;color:#0D0D0D;font-weight:600;">${contract.title}</div>
      </div>
      <p style="font-size:15px;color:#3a3a3a;line-height:1.65;margin:0 0 28px;">
        Para assinar, basta clicar no botão abaixo. Você será direcionado ao portal AcelerIQ, onde poderá ler o documento na íntegra e assiná-lo de forma segura.
      </p>
      <div style="text-align:center;margin:0 0 28px;">
        <a href="${signUrl}" style="background-color:#0D0D0D;color:#00FF66;font-size:14px;font-weight:700;border-radius:10px;padding:14px 28px;text-decoration:none;display:inline-block;letter-spacing:0.02em;">
          Assinar contrato →
        </a>
      </div>
      <p style="font-size:13px;color:#8a8a8a;margin:28px 0 0;line-height:1.6;">
        Ou copie e cole este link no navegador:<br>
        <span style="color:#3a3a3a;word-break:break-all;">${signUrl}</span>
      </p>
    </div>
    <div style="padding:24px 8px 8px;text-align:left;">
      <hr style="border:none;border-top:1px solid #E5E5E5;margin:0 0 20px;" />
      <div style="font-size:12px;font-weight:700;letter-spacing:0.22em;color:#0D0D0D;margin:0 0 6px;">
        ACELER<span style="color:#00B84A;">IQ</span>
      </div>
      <div style="font-size:12px;color:#6b6b6b;margin:0 0 10px;line-height:1.5;">
        Performance OS para times que entregam.
      </div>
      <div style="font-size:12px;color:#6b6b6b;margin:0 0 8px;">
        <a href="${PORTAL_URL}" style="color:#0D0D0D;text-decoration:none;">${PORTAL_HOST}</a>
        ·
        <a href="mailto:contato@aceleriq.com.br" style="color:#0D0D0D;text-decoration:none;">contato@aceleriq.com.br</a>
      </div>
      <div style="font-size:11px;color:#9a9a9a;margin:8px 0 0;">
        © ${year} AcelerIQ. Todos os direitos reservados.
      </div>
    </div>
  </div>
</body>
</html>`;

    try {
      await sendResendEmail({
        from: `Aceleriq <contratos@${EMAIL_FROM_DOMAIN}>`,
        to: [recipient],
        subject: `📄 Contrato para assinatura: ${contract.title}`,
        html,
      });
    } catch (error) {
      if (error instanceof ResendApiError) {
        const responseBody: Record<string, unknown> = {
          error: error.message || "email send failed",
        };
        if (error.details !== null) responseBody.details = error.details;
        return json(responseBody, 500);
      }
      throw error;
    }

    const { error: statusError } = await supabase.from("contracts").update({
      status: "sent",
      sent_at: new Date().toISOString(),
    }).eq("id", contract_id);
    if (statusError) {
      return json({ error: "email sent but contract status was not recorded" }, 500);
    }

    return json({ ok: true, signUrl });
  } catch (e: unknown) {
    return json({ error: e instanceof Error ? e.message : "internal error" }, 500);
  }
});
