import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { resolvePublicAppUrl } from "../_shared/public-url.ts";

const MAX_REQUEST_BYTES = 16 * 1024;
const APP_ORIGIN = new URL(resolvePublicAppUrl()).origin;
const NOTIFICATION_TYPES = new Set([
  "approval", "billing", "project", "report", "request", "system", "task", "update",
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": APP_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (origin && origin !== APP_ORIGIN) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Require a valid session; only staff may target other users.
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const callerId = userData.user.id;
    const { data: isStaff } = await supabase.rpc("is_staff", { _user_id: callerId });

    const caller = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${token}` } } },
    );
    const { data: quota } = await caller.rpc("claim_notification_dispatch");
    if (quota !== true) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const declaredLength = Number(req.headers.get("content-length") || "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
      return new Response(JSON.stringify({ error: "Payload too large" }), {
        status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
      return new Response(JSON.stringify({ error: "Payload too large" }), {
        status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    const message = typeof parsed.message === "string" ? parsed.message.trim() : "";
    const notification_type = typeof parsed.notification_type === "string"
      ? parsed.notification_type.trim()
      : "";
    const link = typeof parsed.link === "string" ? parsed.link.trim() : "";
    const target_user_id = typeof parsed.target_user_id === "string"
      ? parsed.target_user_id.trim()
      : "";
    if (
      !message || message.length > 500
      || !NOTIFICATION_TYPES.has(notification_type)
      || target_user_id.length > 64
      || link.length > 2048
      || (link && (
        !link.startsWith("/") || link.startsWith("//") || link.includes("\\")
        || /%5c/i.test(link) || /[\u0000-\u001f\u007f]/.test(link)
      ))
    ) {
      return new Response(JSON.stringify({ error: "missing fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Non-staff can only notify themselves or admins (default fanout).
    if (!isStaff && target_user_id && target_user_id !== callerId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    // Resolve target: explicit target_user_id OR all admins
    let targets: string[] = [];
    if (target_user_id) {
      targets = [target_user_id];
    } else {
      const { data: admins } = await supabase
        .from("user_roles").select("user_id").eq("role", "admin");
      targets = (admins || []).map((a: any) => a.user_id);
    }

    if (targets.length === 0) {
      return new Response(JSON.stringify({ ok: true, inserted: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Dedup: skip if same message+type for same user within 5 minutes
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const inserts: any[] = [];
    for (const uid of targets) {
      const { data: dup } = await supabase
        .from("notifications")
        .select("id")
        .eq("user_id", uid)
        .eq("notification_type", notification_type)
        .eq("message", message)
        .gte("created_at", fiveMinAgo)
        .limit(1);
      if (!dup || dup.length === 0) {
        inserts.push({ user_id: uid, message, notification_type, link: link || null });
      }
    }

    if (inserts.length > 0) {
      await supabase.from("notifications").insert(inserts);
    }

    return new Response(JSON.stringify({ ok: true, inserted: inserts.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("notify-admin failed", {
      error: error instanceof Error ? error.name : "unknown_error",
    });
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
