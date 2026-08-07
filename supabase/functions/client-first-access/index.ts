import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { resolvePublicAppUrl } from "../_shared/public-url.ts";

const MAX_REQUEST_BYTES = 16 * 1024;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const APP_ORIGIN = new URL(resolvePublicAppUrl()).origin;
const corsHeaders = {
  "Access-Control-Allow-Origin": APP_ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

type RpcRecord = Record<string, unknown>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function validPassword(password: unknown): password is string {
  return typeof password === "string" &&
    password.length >= 12 &&
    password.length <= 128 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password);
}

function rpcRecord(value: unknown): RpcRecord | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate !== null && typeof candidate === "object" &&
      !Array.isArray(candidate)
    ? candidate as RpcRecord
    : null;
}

function isDefinitiveAuthRejection(error: unknown): boolean {
  const record = rpcRecord(error);
  const status = typeof record?.status === "number" ? record.status : 0;
  return status >= 400 && status < 500 &&
    ![408, 409, 425, 429].includes(status);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function pause(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (origin && origin !== APP_ORIGIN) return json({ error: "Forbidden" }, 403);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const declaredLength = Number(req.headers.get("content-length") || "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
      return json({ error: "Payload too large" }, 413);
    }
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
      return json({ error: "Payload too large" }, 413);
    }
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (
      !TOKEN_PATTERN.test(token) ||
      !["validate", "set_password"].includes(action)
    ) {
      return json({ error: "invalid", message: "Link inválido ou expirado." });
    }

    // Only a one-way digest crosses the database boundary. The bearer itself lives
    // for this request only and is never persisted or included in logs.
    const tokenHashHex = await sha256Hex(token);
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (action === "validate") {
      const { data, error } = await admin.rpc("validate_first_access_token", {
        p_token_hash_hex: tokenHashHex,
      });
      const validation = rpcRecord(data);
      if (error || !validation) {
        return json({
          error: "invalid",
          message: "Link inválido ou expirado.",
        });
      }
      if (validation.status === "used") {
        return json({ error: "used", message: "Este link já foi utilizado." });
      }
      if (validation.status !== "available") {
        return json({
          error: "invalid",
          message: "Link inválido ou expirado.",
        });
      }
      // EXPAND compatibility: the already-published page uses the validated
      // email for its post-reset sign-in. Remove these response extras only
      // after the new frontend is published and the CUTOVER is scheduled.
      return json({
        valid: true,
        email: typeof validation.email === "string" ? validation.email : "",
        full_name: "",
      });
    }

    // Validate before acquiring a database claim. A malformed password must never
    // consume, lock, or otherwise mutate a valid invitation.
    if (!validPassword(body.password)) {
      return json({
        error: "weak_password",
        message:
          "Use ao menos 12 caracteres, com maiúscula, minúscula, número e símbolo.",
      }, 400);
    }

    const { data: claimData, error: claimError } = await admin.rpc(
      "claim_first_access_token",
      { p_token_hash_hex: tokenHashHex },
    );
    const claim = rpcRecord(claimData);
    const claimId = typeof claim?.claim_id === "string" ? claim.claim_id : "";
    const profileId = typeof claim?.profile_id === "string"
      ? claim.profile_id
      : "";
    const email = typeof claim?.email === "string" ? claim.email : "";
    if (claimError || !claimId || !profileId || !email) {
      return json({ error: "invalid", message: "Link inválido ou expirado." });
    }

    const { error: passwordError } = await admin.auth.admin.updateUserById(
      profileId,
      { password: body.password },
    );
    if (passwordError) {
      // Only a definitive 4xx rejection proves that Auth did not accept the
      // password. Network, timeout, conflict, throttling and 5xx outcomes are
      // ambiguous and therefore remain claimed (fail closed).
      const definitiveRejection = isDefinitiveAuthRejection(passwordError);
      let claimReleased = false;
      if (definitiveRejection) {
        const { data, error } = await admin.rpc(
          "release_first_access_claim",
          { p_claim_id: claimId },
        );
        claimReleased = !error && data === true;
      }
      console.error("client-first-access password update failed", {
        code: passwordError.code,
        definitiveRejection,
        claimReleased,
      });
      if (!definitiveRejection) {
        return json({
          error: "finalization_pending",
          message:
            "Não foi possível confirmar a atualização. Peça ajuda à equipe antes de tentar novamente.",
        });
      }
      return json({
        error: "update_failed",
        message: "Não foi possível criar a senha.",
      }, 500);
    }

    let consumed = false;
    for (let attempt = 0; attempt < 3 && !consumed; attempt += 1) {
      if (attempt > 0) await pause(attempt * 100);
      const { data, error } = await admin.rpc("consume_first_access_claim", {
        p_claim_id: claimId,
      });
      consumed = !error && data === true;
    }

    if (!consumed) {
      // Auth already accepted the password. Never release or reopen the bearer in
      // this ambiguous state; the private claim remains locked for reconciliation.
      console.error("client-first-access finalization pending", {
        error: "claim_consume_failed",
      });
      return json({
        error: "finalization_pending",
        message:
          "A senha foi atualizada, mas o acesso precisa ser confirmado pela equipe.",
      });
    }

    return json({ success: true, email });
  } catch (error) {
    console.error("client-first-access failed", {
      error: error instanceof Error ? error.name : "unknown_error",
    });
    const invalidJson = error instanceof SyntaxError;
    return json(
      { error: invalidJson ? "invalid_payload" : "internal_error" },
      invalidJson ? 400 : 500,
    );
  }
});
