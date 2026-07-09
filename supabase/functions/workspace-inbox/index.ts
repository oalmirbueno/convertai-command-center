// Public inbox for Workspace folders.
// GET  ?token=<uuid>  → returns { folder: { id, name, scope, client_id } }
// POST ?token=<uuid>  (multipart form field "file", optional "sender")
//   uploads to storage bucket "workspace" and inserts workspace_nodes row as child.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  if (!token) return json({ error: "missing token" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data: folder, error } = await admin
    .from("workspace_nodes")
    .select("id, name, scope, client_id, parent_id, kind")
    .eq("inbox_token", token)
    .maybeSingle();
  if (error || !folder) return json({ error: "invalid token" }, 404);
  if (folder.kind !== "folder") return json({ error: "target is not a folder" }, 400);

  if (req.method === "GET") return json({ folder: { id: folder.id, name: folder.name, scope: folder.scope } });

  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const form = await req.formData();
  const file = form.get("file");
  const sender = String(form.get("sender") || "").slice(0, 120);
  if (!(file instanceof File)) return json({ error: "missing file" }, 400);
  if (file.size > 500 * 1024 * 1024) return json({ error: "file too large (max 500MB)" }, 413);

  const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
  const key = `${folder.scope}/${folder.scope === "client" ? folder.client_id : "global"}/inbox/${crypto.randomUUID()}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: upErr } = await admin.storage.from("workspace").upload(key, bytes, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (upErr) return json({ error: "upload failed: " + upErr.message }, 500);

  const displayName = sender ? `[${sender}] ${file.name}` : file.name;
  const { error: insErr } = await admin.from("workspace_nodes").insert({
    name: displayName, kind: "file", scope: folder.scope,
    client_id: folder.client_id, parent_id: folder.id,
    mime: file.type || null, size_bytes: file.size, storage_path: key,
  });
  if (insErr) return json({ error: "insert failed: " + insErr.message }, 500);

  return json({ ok: true });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
