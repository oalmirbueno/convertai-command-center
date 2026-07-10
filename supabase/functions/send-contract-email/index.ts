import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const PORTAL_URL = "https://aceleriq.online";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);


    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { contract_id, override_email } = await req.json();
    if (!contract_id) return json({ error: "missing contract_id" }, 400);

    const { data: contract } = await supabase
      .from("contracts").select("*").eq("id", contract_id).maybeSingle();
    if (!contract) return json({ error: "contract not found" }, 404);
    if (!contract.admin_signed_at) return json({ error: "admin must sign first" }, 400);

    const { data: client } = await supabase
      .from("profiles").select("full_name, email, company_name").eq("id", contract.client_id).maybeSingle();
    const recipient = (override_email as string | undefined)?.trim() || client?.email;
    if (!recipient) return json({ error: "client without email" }, 400);

    const signUrl = `${PORTAL_URL}/contrato/${contract.sign_token}`;
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!RESEND_API_KEY || !LOVABLE_API_KEY) {
      return json({ error: "email service not configured" }, 500);
    }

    const LOGO_URL = "https://gicbrgagstyvbaaumprj.supabase.co/storage/v1/object/public/email-assets/logo-aceleriq-email.png";
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
      <img src="${LOGO_URL}" alt="AcelerIQ" width="140" style="display:block;height:auto;" />
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
        <a href="https://aceleriq.online" style="color:#0D0D0D;text-decoration:none;">aceleriq.online</a>
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

    const res = await fetch("https://connector-gateway.lovable.dev/resend/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": RESEND_API_KEY,
      },
      body: JSON.stringify({
        from: "Aceleriq <contratos@aceleriq.online>",
        to: [recipient],
        subject: `📄 Contrato para assinatura: ${contract.title}`,
        html,
      }),
    });

    const result = await res.json();
    if (!res.ok) {
      return json({ error: result?.message || "email send failed", details: result }, 500);
    }

    await supabase.from("contracts").update({
      status: "sent",
      sent_at: new Date().toISOString(),
    }).eq("id", contract_id);

    return json({ ok: true, signUrl });
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});
