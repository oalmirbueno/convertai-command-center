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

function storagePathFromFilesReference(value?: string | null) {
  if (!value) return null;
  if (value.startsWith("files://")) return value.slice("files://".length);
  try {
    const parsed = new URL(value);
    const marker = "/storage/v1/object/";
    const markerIndex = parsed.pathname.indexOf(marker);
    if (markerIndex < 0) return null;
    const parts = parsed.pathname
      .slice(markerIndex + marker.length)
      .split("/")
      .filter(Boolean);
    if (["public", "sign", "authenticated"].includes(parts[0])) parts.shift();
    const bucket = parts.shift();
    if (bucket !== "files" || parts.length === 0) return null;
    return decodeURIComponent(parts.join("/"));
  } catch {
    return null;
  }
}

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
        .in("status", ["sent", "signed", "completed"])
        .maybeSingle();

      if (error || !contract) return json({ error: "invalid token" }, 404);

      // attach client basic info for display
      const { data: client, error: clientError } = await supabase
        .from("profiles")
        .select("full_name, company_name")
        .eq("id", contract.client_id)
        .maybeSingle();
      if (clientError) return json({ error: "client unavailable" }, 503);

      const contractPath = storagePathFromFilesReference(contract.original_file_url);
      let signedFileUrl = contract.original_file_url;
      if (contractPath) {
        const { data: signed, error: signedError } = await supabase.storage
          .from("files")
          .createSignedUrl(contractPath, 60 * 60);
        if (signedError || !signed?.signedUrl) {
          return json({ error: "contract file unavailable" }, 503);
        }
        signedFileUrl = signed.signedUrl;
      }

      return json({
        contract: {
          ...contract,
          client_id: undefined,
          original_file_url: signedFileUrl,
        },
        client,
      });
    }

    // POST -> sign action
    if (req.method === "POST") {
      const body = await req.json();
      const { token, signature_name, accept } = body || {};
      const normalizedToken = typeof token === "string" ? token.trim() : "";
      const normalizedName = typeof signature_name === "string"
        ? signature_name.trim()
        : "";
      if (!normalizedToken || !normalizedName || normalizedName.length > 200 || accept !== true) {
        return json({ error: "missing or invalid fields" }, 400);
      }

      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      const { error: completionError } = await supabase.rpc(
        "complete_contract_signature",
        {
          p_token: normalizedToken,
          p_signature_name: normalizedName,
          p_signature_ip: ip,
        },
      );
      if (completionError) {
        const status = completionError.message === "contract not found" ? 404 : 400;
        return json({ error: completionError.message }, status);
      }

      return json({ ok: true });
    }

    return json({ error: "method not allowed" }, 405);
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});
