import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "https://esm.sh/zod@3.23.8";

const StaffRoles = new Set(["admin", "design", "traffic", "manager"]);
const MCP_FILE_PREFIX = "mcp-files://";
const WORKSPACE_FILE_PREFIX = "workspace://";

const BodySchema = z.discriminatedUnion("target", [
  z.object({ target: z.literal("files"), fileIds: z.array(z.string().uuid()).min(1).max(200) }),
  z.object({ target: z.literal("workspace_node"), nodeId: z.string().uuid() }),
]);

type FileRow = {
  id: string;
  parent_file_id?: string | null;
  file_url?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
};

type WorkspaceNode = {
  id: string;
  parent_id: string | null;
  kind: "folder" | "file";
  storage_path: string | null;
  sent_for_approval_file_id: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function storageRefFromUrl(value?: string | null): { bucket: string; path: string } | null {
  if (!value) return null;
  if (value.startsWith(MCP_FILE_PREFIX)) return { bucket: "mcp-files", path: value.slice(MCP_FILE_PREFIX.length) };
  if (value.startsWith(WORKSPACE_FILE_PREFIX)) return { bucket: "workspace", path: value.slice(WORKSPACE_FILE_PREFIX.length) };
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    const marker = "/storage/v1/object/";
    const idx = url.pathname.indexOf(marker);
    if (idx < 0) return null;
    const parts = url.pathname.slice(idx + marker.length).split("/").filter(Boolean);
    if (["public", "sign", "authenticated"].includes(parts[0])) parts.shift();
    const bucket = parts.shift();
    const path = parts.join("/");
    if (!bucket || !path) return null;
    return { bucket: decodeURIComponent(bucket), path: decodeURIComponent(path) };
  } catch {
    return null;
  }
}

function storageRefFromFile(row: FileRow): { bucket: string; path: string } | null {
  const bucket = row.storage_bucket || (row.file_url?.startsWith(MCP_FILE_PREFIX) ? "mcp-files" : null) || (row.file_url?.startsWith(WORKSPACE_FILE_PREFIX) ? "workspace" : null);
  const path = row.storage_path || (row.file_url?.startsWith(MCP_FILE_PREFIX) ? row.file_url.slice(MCP_FILE_PREFIX.length) : null) || (row.file_url?.startsWith(WORKSPACE_FILE_PREFIX) ? row.file_url.slice(WORKSPACE_FILE_PREFIX.length) : null);
  if (bucket && path) return { bucket, path };
  return storageRefFromUrl(row.file_url);
}

async function removeObjects(admin: any, refs: Array<{ bucket: string; path: string }>) {
  const byBucket = new Map<string, Set<string>>();
  for (const ref of refs) {
    if (!ref.bucket || !ref.path) continue;
    if (!byBucket.has(ref.bucket)) byBucket.set(ref.bucket, new Set());
    byBucket.get(ref.bucket)!.add(ref.path);
  }

  const errors: string[] = [];
  let removed = 0;
  for (const [bucket, paths] of byBucket.entries()) {
    const list = Array.from(paths);
    if (!list.length) continue;
    const { error } = await admin.storage.from(bucket).remove(list);
    if (error) errors.push(`${bucket}: ${error.message}`);
    else removed += list.length;
  }
  return { removed, errors };
}

async function deleteFileRows(admin: any, ids: string[]) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (!uniqueIds.length) return { deleted: 0, storageRemoved: 0, storageErrors: [] as string[] };

  const [{ data: parents, error: parentError }, { data: children, error: childError }] = await Promise.all([
    admin.from("files").select("id,parent_file_id,file_url,storage_bucket,storage_path").in("id", uniqueIds),
    admin.from("files").select("id,parent_file_id,file_url,storage_bucket,storage_path").in("parent_file_id", uniqueIds),
  ]);
  if (parentError) throw parentError;
  if (childError) throw childError;

  const rowsById = new Map<string, FileRow>();
  for (const row of [...(parents || []), ...(children || [])] as FileRow[]) rowsById.set(row.id, row);
  const rows = Array.from(rowsById.values());
  const childIds = rows.filter((row) => row.parent_file_id).map((row) => row.id);
  const parentIds = rows.filter((row) => !row.parent_file_id).map((row) => row.id);

  if (childIds.length) {
    const { error } = await admin.from("files").delete().in("id", childIds);
    if (error) throw error;
  }
  if (parentIds.length) {
    const { error } = await admin.from("files").delete().in("id", parentIds);
    if (error) throw error;
  }

  const refs = rows.map(storageRefFromFile).filter(Boolean) as Array<{ bucket: string; path: string }>;
  const storage = await removeObjects(admin, refs);
  return { deleted: rows.length, storageRemoved: storage.removed, storageErrors: storage.errors };
}

async function collectWorkspaceTree(admin: any, root: WorkspaceNode) {
  const nodes = new Map<string, WorkspaceNode>();
  nodes.set(root.id, root);

  const stack = root.kind === "folder" ? [root.id] : [];
  while (stack.length) {
    const parentId = stack.pop()!;
    const { data, error } = await admin
      .from("workspace_nodes")
      .select("id,parent_id,kind,storage_path,sent_for_approval_file_id")
      .eq("parent_id", parentId);
    if (error) throw error;
    for (const child of (data || []) as WorkspaceNode[]) {
      nodes.set(child.id, child);
      if (child.kind === "folder") stack.push(child.id);
    }
  }
  return Array.from(nodes.values());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Backend não configurado");

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Não autenticado" }, 401);

    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData?.user) return json({ error: "Sessão inválida" }, 401);

    const { data: roles, error: roleError } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", authData.user.id);
    if (roleError) throw roleError;
    const isStaff = (roles || []).some((row: any) => StaffRoles.has(row.role));
    if (!isStaff) return json({ error: "Sem permissão para excluir arquivos" }, 403);

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: "Dados inválidos", details: parsed.error.flatten().fieldErrors }, 400);

    if (parsed.data.target === "files") {
      const result = await deleteFileRows(admin, parsed.data.fileIds);
      return json({ ok: true, ...result });
    }

    const { data: root, error: rootError } = await admin
      .from("workspace_nodes")
      .select("id,parent_id,kind,storage_path,sent_for_approval_file_id")
      .eq("id", parsed.data.nodeId)
      .maybeSingle();
    if (rootError) throw rootError;
    if (!root) return json({ ok: true, deleted: 0, storageRemoved: 0, storageErrors: [] });

    const tree = await collectWorkspaceTree(admin, root as WorkspaceNode);
    const workspaceRefs = tree
      .filter((node) => node.kind === "file" && node.storage_path)
      .map((node) => ({ bucket: "workspace", path: node.storage_path! }));
    const approvalIds = tree.map((node) => node.sent_for_approval_file_id).filter(Boolean) as string[];

    const { error: nodeError } = await admin.from("workspace_nodes").delete().eq("id", root.id);
    if (nodeError) throw nodeError;

    const approvalResult = approvalIds.length
      ? await deleteFileRows(admin, approvalIds)
      : { deleted: 0, storageRemoved: 0, storageErrors: [] as string[] };
    const workspaceStorage = await removeObjects(admin, workspaceRefs);

    return json({
      ok: true,
      deleted: tree.length + approvalResult.deleted,
      storageRemoved: workspaceStorage.removed + approvalResult.storageRemoved,
      storageErrors: [...workspaceStorage.errors, ...approvalResult.storageErrors],
    });
  } catch (error: any) {
    return json({ error: error?.message || "Falha ao excluir arquivo" }, 500);
  }
});