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

    const { contract_id } = await req.json();
    if (!contract_id) return json({ error: "missing contract_id" }, 400);

    const { data: contract } = await supabase
      .from("contracts").select("*").eq("id", contract_id).maybeSingle();
    if (!contract) return json({ error: "contract not found" }, 404);
    if (!contract.admin_signed_at) return json({ error: "admin must sign first" }, 400);

    const { data: client } = await supabase
      .from("profiles").select("full_name, email, company_name").eq("id", contract.client_id).maybeSingle();
    if (!client?.email) return json({ error: "client without email" }, 400);

    const signUrl = `${PORTAL_URL}/contrato/${contract.sign_token}`;
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!RESEND_API_KEY || !LOVABLE_API_KEY) {
      return json({ error: "email service not configured" }, 500);
    }

    const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0d0d0d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#e5e5e5;">
  <div style="max-width:560px;margin:0 auto;padding:48px 24px;">
    <div style="text-align:center;margin-bottom:32px;">
      <div style="display:inline-block;padding:8px 16px;background:#00FF66;color:#0d0d0d;font-weight:700;border-radius:6px;font-size:18px;letter-spacing:0.5px;">ACELERIQ</div>
    </div>
    <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:16px;padding:40px 32px;">
      <h1 style="margin:0 0 16px;font-size:24px;color:#fff;font-weight:600;">Olá, ${client.full_name || "cliente"} 👋</h1>
      <p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#b5b5b5;">
        Você recebeu um contrato para assinatura digital${contract.admin_signature_name ? ` — já assinado por <strong style="color:#fff;">${contract.admin_signature_name}</strong>` : ""}.
      </p>
      <div style="margin:24px 0;padding:16px;background:#0d0d0d;border-left:3px solid #00FF66;border-radius:4px;">
        <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Contrato</div>
        <div style="font-size:16px;color:#fff;font-weight:500;">${contract.title}</div>
      </div>
      <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#888;">
        Para assinar, basta clicar no botão abaixo. Você será direcionado ao portal Aceleriq, onde poderá ler o documento na íntegra e assiná-lo de forma segura.
      </p>
      <div style="text-align:center;margin:32px 0;">
        <a href="${signUrl}" style="display:inline-block;background:#00FF66;color:#0d0d0d;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
          Assinar contrato →
        </a>
      </div>
      <p style="margin:24px 0 0;font-size:12px;color:#555;text-align:center;">
        Ou copie e cole este link no navegador:<br>
        <span style="color:#888;word-break:break-all;">${signUrl}</span>
      </p>
    </div>
    <p style="text-align:center;margin:24px 0 0;font-size:11px;color:#555;">
      Este é um e-mail transacional do portal Aceleriq.<br>aceleriq.online
    </p>
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
        to: [client.email],
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
