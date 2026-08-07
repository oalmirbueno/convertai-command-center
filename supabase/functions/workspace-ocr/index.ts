// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2.97.0";
import {
  requestAiChatCompletion,
  resolveAiProviderChain,
} from "../_shared/ai-provider.ts";

const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const ALLOWED_ROLES = new Set(["admin", "client", "design", "traffic", "manager"]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function requireWorkspaceUser(req: Request): Promise<Response | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim();
  const authorization = req.headers.get("authorization")?.trim() || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

  if (!supabaseUrl || !anonKey) return json({ error: "Server configuration error" }, 500);
  if (!token) return json({ error: "Unauthorized" }, 401);

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await caller.auth.getUser(token);
  if (authError || !authData.user) return json({ error: "Unauthorized" }, 401);

  const { data: roles, error: rolesError } = await caller
    .from("user_roles")
    .select("role")
    .eq("user_id", authData.user.id);
  if (rolesError || !roles?.some(({ role }) => ALLOWED_ROLES.has(String(role)))) {
    return json({ error: "Forbidden" }, 403);
  }

  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const contentLength = Number(req.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      return json({ error: "Payload too large" }, 413);
    }

    const authorizationError = await requireWorkspaceUser(req);
    if (authorizationError) return authorizationError;

    const authorization = req.headers.get("authorization")?.trim() || "";
    const caller = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authorization } } },
    );
    const { data: quota } = await caller.rpc("claim_ai_usage", {
      _workload: "workspace-ocr",
    });
    if (quota !== true) return json({ error: "Usage limit reached" }, 429);

    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
      return json({ error: "Payload too large" }, 413);
    }

    let body: { image?: unknown; mode?: unknown };
    try {
      body = JSON.parse(rawBody);
    } catch {
      return json({ error: "JSON inválido" }, 400);
    }

    const providers = resolveAiProviderChain({
      primaryModels: ["gpt-4o-mini"],
      lovableModels: ["google/gemini-2.5-flash-lite"],
    });
    const { image, mode } = body;
    if (
      typeof image !== "string" ||
      !/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\r\n]+$/i.test(image)
    ) {
      return json({ error: "image (data URL base64) obrigatório" }, 400);
    }
    if (mode !== undefined && mode !== "transcribe") {
      return json({ error: "mode inválido" }, 400);
    }

    const isTranscribe = mode === "transcribe";
    const sys = isTranscribe
      ? "Descreva o conteúdo visual em português (cena, elementos, texto, mood, cores). Seja preciso e objetivo, use bullets curtos."
      : "Extraia TODO o texto legível da imagem preservando quebras de linha e estrutura. Devolva apenas o texto extraído, sem comentários. Se não houver texto, responda: (sem texto detectável)";

    const { response: r } = await requestAiChatCompletion(providers, {
      messages: [
        { role: "system", content: sys },
        { role: "user", content: [
          { type: "text", text: isTranscribe ? "Descreva:" : "Extraia o texto:" },
          { type: "image_url", image_url: { url: image } },
        ]},
      ],
    });
    if (!r.ok) {
      const t = await r.text();
      console.error("Workspace OCR provider failed", { status: r.status, detail: t.slice(0, 200) });
      return json({ error: "Falha temporária no provedor de OCR" }, 502);
    }
    const j = await r.json();
    const text = j?.choices?.[0]?.message?.content ?? "";
    return json({ text });
  } catch (error: unknown) {
    console.error("Workspace OCR failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return json({ error: "Não foi possível processar a imagem" }, 500);
  }
});
