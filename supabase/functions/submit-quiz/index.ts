import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  dispatchLegacyOpsJson,
  isOpsLegacyBridgeEnabled,
  resolveOpsReceiveLeadUrl,
} from "../_shared/ops-config.ts";
import { resolvePublicAppUrl } from "../_shared/public-url.ts";

const MAX_REQUEST_BYTES = 64 * 1024;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const ACTIONS = new Set(["load", "save_progress", "submit"]);
const APP_ORIGIN = new URL(resolvePublicAppUrl()).origin;
const cors = {
  "Access-Control-Allow-Origin": APP_ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

const OPS_SECRET = Deno.env.get("OPS_WEBHOOK_SECRET")?.trim() ?? "";
const OPS_ENABLED = isOpsLegacyBridgeEnabled();
const OPS_URL_CONFIGURED = Boolean(
  Deno.env.get("OPS_RECEIVE_LEAD_URL")?.trim() ||
    Deno.env.get("OPS_BASE_URL")?.trim(),
);
const OPS_URL = OPS_ENABLED && OPS_SECRET && OPS_URL_CONFIGURED
  ? resolveOpsReceiveLeadUrl()
  : null;

const REVENUE_SCORE: Record<string, number> = {
  "Até R$ 20k/mês": 20,
  "R$ 20k-50k/mês": 35,
  "R$ 50k-200k/mês": 55,
  "R$ 200k-500k/mês": 75,
  "R$ 500k-1M/mês": 85,
  "R$ 1M-5M/mês": 95,
  "R$ 5M+/mês": 100,
};
const TEAM_SCORE: Record<string, number> = {
  "Solo (1 pessoa)": 30,
  "2-5 pessoas": 50,
  "6-15 pessoas": 75,
  "16-50 pessoas": 90,
  "51-200 pessoas": 95,
  "200+": 100,
};
const LEVEL_SCORE: Record<string, number> = { baixa: 30, media: 65, alta: 95 };

const PUBLIC_FIELDS = [
  "lead_name",
  "lead_email",
  "lead_whatsapp",
  "lead_company",
  "positioning",
  "differential",
  "icp",
  "main_pains",
  "goals_12m",
  "success_metric",
  "revenue_range",
  "team_size",
  "maturity_digital",
  "ai_readiness",
] as const;

const FIELD_LIMITS: Record<(typeof PUBLIC_FIELDS)[number], number> = {
  lead_name: 160,
  lead_email: 254,
  lead_whatsapp: 40,
  lead_company: 200,
  positioning: 4_000,
  differential: 4_000,
  icp: 4_000,
  main_pains: 4_000,
  goals_12m: 4_000,
  success_metric: 2_000,
  revenue_range: 80,
  team_size: 80,
  maturity_digital: 20,
  ai_readiness: 20,
};

type QuizPayload = Record<(typeof PUBLIC_FIELDS)[number], string>;
type RpcRecord = Record<string, unknown>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function rpcRecord(value: unknown): RpcRecord | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate !== null && typeof candidate === "object" &&
      !Array.isArray(candidate)
    ? candidate as RpcRecord
    : null;
}

function cleanPayload(body: Record<string, unknown>): QuizPayload {
  const payload = {} as QuizPayload;
  for (const field of PUBLIC_FIELDS) {
    const value = body[field];
    if (value !== undefined && typeof value !== "string") {
      throw new Error("invalid_payload");
    }
    const normalized = typeof value === "string" ? value.trim() : "";
    if (normalized.length > FIELD_LIMITS[field]) {
      throw new Error("invalid_payload");
    }
    payload[field] = normalized;
  }
  if (
    payload.lead_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.lead_email)
  ) {
    throw new Error("invalid_payload");
  }
  return payload;
}

function publicPayload(row: RpcRecord): QuizPayload {
  const nested = rpcRecord(row.responses) ?? rpcRecord(row.payload) ?? row;
  const payload = {} as QuizPayload;
  for (const field of PUBLIC_FIELDS) {
    payload[field] = typeof nested[field] === "string"
      ? nested[field] as string
      : "";
  }
  return payload;
}

function calculateICP(body: QuizPayload): { score: number; plan: string } {
  const revenue = REVENUE_SCORE[body.revenue_range] ?? 40;
  const team = TEAM_SCORE[body.team_size] ?? 50;
  const maturity = LEVEL_SCORE[body.maturity_digital] ?? 50;
  const ai = LEVEL_SCORE[body.ai_readiness] ?? 50;
  const commitment = (
    [
      "positioning",
      "differential",
      "icp",
      "main_pains",
      "goals_12m",
      "success_metric",
    ]
      .filter((key) => body[key as keyof QuizPayload].length > 20).length / 6
  ) * 100;
  const score = Math.round(
    revenue * 0.3 + maturity * 0.2 + ai * 0.2 + team * 0.15 + commitment * 0.15,
  );
  let plan = "starter";
  if (["R$ 200k-500k/mês", "R$ 500k-1M/mês"].includes(body.revenue_range)) {
    plan = "growth";
  }
  if (["R$ 1M-5M/mês", "R$ 5M+/mês"].includes(body.revenue_range)) {
    plan = "enterprise";
  }
  return { score, plan };
}

function numberValue(primary: unknown, fallback: unknown): number | null {
  if (typeof primary === "number" && Number.isFinite(primary)) return primary;
  if (typeof fallback === "number" && Number.isFinite(fallback)) {
    return fallback;
  }
  return null;
}

function rpcFailure(error: unknown, operation: string): Response {
  const record = rpcRecord(error);
  const message = typeof record?.message === "string"
    ? record.message.toLowerCase()
    : "";
  if (message.includes("expired")) {
    return json({ error: "Invitation expired" }, 410);
  }
  if (message.includes("rate") || message.includes("limit")) {
    return json({ error: "Invitation limit reached" }, 429);
  }
  if (message.includes("used") || message.includes("submitted")) {
    return json({ error: "Invitation already used" }, 409);
  }
  if (message.includes("invalid") || message.includes("not found")) {
    return json({ error: "Invalid invitation" }, 404);
  }
  console.error("submit-quiz RPC failed", { operation });
  return json({ error: "Unable to process invitation" }, 500);
}

function rpcOutcomeFailure(
  result: RpcRecord,
  operation: string,
): Response | null {
  const outcome = typeof result.outcome === "string" ? result.outcome : "";
  if (!outcome || outcome === "ok" || outcome === "used") return null;
  if (outcome === "invalid") {
    return json({ error: "Invalid invitation" }, 404);
  }
  if (outcome === "expired") {
    return json({ error: "Invitation expired" }, 410);
  }
  if (outcome === "rate_limited") {
    return json({ error: "Invitation limit reached" }, 429);
  }
  console.error("submit-quiz RPC returned an unknown outcome", { operation });
  return json({ error: "Unable to process invitation" }, 500);
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
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

async function pushToOps(payload: Record<string, unknown>): Promise<void> {
  const result = await dispatchLegacyOpsJson({
    enabled: OPS_ENABLED,
    url: OPS_URL,
    secret: OPS_SECRET,
    payload,
  });
  if (!result.attempted) return;
  if (result.error) {
    console.error("[pushToOps] request failed", { error: result.error });
    return;
  }
  console.log("[pushToOps] completed", { status: result.status });
}

serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (origin && origin !== APP_ORIGIN) {
    return json({ error: "Origin not allowed" }, 403);
  }
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
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
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const action = typeof body.action === "string" ? body.action : "";
    if (!TOKEN_PATTERN.test(token) || !ACTIONS.has(action)) {
      return json({ error: "Invalid invitation" }, 400);
    }

    // The raw invitation never reaches a table query, RPC parameter, or log.
    const tokenHashHex = await sha256Hex(token);
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (action === "load") {
      const { data, error } = await supabase.rpc("load_quiz_invitation", {
        p_token_hash_hex: tokenHashHex,
      });
      if (error) return rpcFailure(error, "load");
      const invitation = rpcRecord(data);
      if (!invitation) return json({ error: "Invalid invitation" }, 404);
      const outcomeFailure = rpcOutcomeFailure(invitation, "load");
      if (outcomeFailure) return outcomeFailure;

      const status = typeof invitation.status === "string"
        ? invitation.status
        : "draft";
      const score = numberValue(invitation.score, invitation.icp_fit_score);
      const plan = typeof invitation.plan === "string"
        ? invitation.plan
        : typeof invitation.recommended_plan === "string"
        ? invitation.recommended_plan
        : null;
      if (status === "submitted" || status === "used") {
        // A consumed invitation can reveal only its non-PII result summary.
        return json({
          data: {
            status: "submitted",
            icp_fit_score: score,
            recommended_plan: plan,
          },
          idempotent: true,
        });
      }

      return json({
        data: {
          ...publicPayload(invitation),
          status,
          icp_fit_score: score,
          recommended_plan: plan,
        },
      });
    }

    const payload = cleanPayload(body);
    if (action === "save_progress") {
      const { data, error } = await supabase.rpc("save_quiz_invitation", {
        p_token_hash_hex: tokenHashHex,
        p_responses: payload,
      });
      if (error) return rpcFailure(error, "save_progress");
      const saved = rpcRecord(data);
      if (!saved) return json({ error: "Unable to save" }, 500);
      const outcomeFailure = rpcOutcomeFailure(saved, "save_progress");
      if (outcomeFailure) return outcomeFailure;
      if (saved?.status === "submitted" || saved?.status === "used") {
        return json({
          ok: true,
          score: numberValue(saved.score, saved.icp_fit_score),
          plan: typeof saved.plan === "string"
            ? saved.plan
            : saved.recommended_plan ?? null,
          idempotent: true,
        });
      }
      return json({ ok: true });
    }

    const calculated = calculateICP(payload);
    const { data, error } = await supabase.rpc("submit_quiz_invitation", {
      p_token_hash_hex: tokenHashHex,
      p_responses: payload,
      p_score: calculated.score,
      p_plan: calculated.plan,
    });
    if (error) return rpcFailure(error, "submit");
    const submitted = rpcRecord(data);
    if (!submitted) return json({ error: "Unable to submit" }, 500);
    const outcomeFailure = rpcOutcomeFailure(submitted, "submit");
    if (outcomeFailure) return outcomeFailure;
    const submissionId = submitted?.id;
    const score = numberValue(submitted?.score, submitted?.icp_fit_score);
    const plan = typeof submitted?.plan === "string"
      ? submitted.plan
      : typeof submitted?.recommended_plan === "string"
      ? submitted.recommended_plan
      : null;
    const submittedAt = typeof submitted?.submitted_at === "string"
      ? submitted.submitted_at
      : null;
    const idempotent = submitted?.idempotent === true;
    if (!validUuid(submissionId) || score === null || !plan || !submittedAt) {
      console.error("submit-quiz RPC returned an invalid result", {
        operation: "submit",
      });
      return json({ error: "Unable to submit" }, 500);
    }

    if (!idempotent) {
      await pushToOps({
        portal_submission_id: submissionId,
        ...payload,
        icp_fit_score: score,
        recommended_plan: plan,
        submitted_at: submittedAt,
      });
    }

    return json({
      ok: true,
      id: submissionId,
      status: typeof submitted?.status === "string"
        ? submitted.status
        : "submitted",
      score,
      plan,
      submitted_at: submittedAt,
      idempotent,
    });
  } catch (error) {
    const invalid = error instanceof Error &&
      (error.message === "invalid_payload" || error instanceof SyntaxError);
    return json(
      { error: invalid ? "Invalid payload" : "Internal error" },
      invalid ? 400 : 500,
    );
  }
});
