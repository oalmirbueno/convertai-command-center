import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "https://esm.sh/zod@3.23.8";

const StaffRoles = new Set(["admin", "design", "traffic", "manager"]);
const MCP_FILE_PREFIX = "mcp-files://";
const WORKSPACE_FILE_PREFIX = "workspace://";
const FILES_PREFIX = "files://";

const BodySchema = z.discriminatedUnion("target", [
  z.object({ target: z.literal("files"), fileIds: z.array(z.string().uuid()).min(1).max(200) }),
  z.object({ target: z.literal("workspace_node"), nodeId: z.string().uuid() }),
]);

type FileRow = {
  id: string;
  parent_file_id?: string | null;
  revision_of_file_id?: string | null;
  client_id?: string | null;
  file_url?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  agency_approval_status?: string | null;
  approval_status?: string | null;
  visibility?: string | null;
  locked_at?: string | null;
};

type WorkspaceNode = {
  id: string;
  parent_id: string | null;
  scope: "global" | "client";
  client_id: string | null;
  kind: "folder" | "file";
  storage_path: string | null;
  sent_for_approval_file_id: string | null;
};

type FileDeletePlan = {
  rows: FileRow[];
  refs: Array<{ bucket: string; path: string }>;
};

class HttpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

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
  if (value.startsWith(FILES_PREFIX)) return { bucket: "files", path: value.slice(FILES_PREFIX.length) };
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

function assertStorageCleanupSucceeded(errors: string[]) {
  if (errors.length > 0) {
    throw new HttpError(
      `Falha ao limpar objetos privados do Storage: ${errors.join("; ")}`,
      500,
    );
  }
}

async function assertCallerCanDeleteFiles(caller: any, ids: string[]) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  for (let offset = 0; offset < uniqueIds.length; offset += 25) {
    const chunk = uniqueIds.slice(offset, offset + 25);
    const checks = await Promise.all(
      chunk.map(async (fileId) => {
        const { data, error } = await caller.rpc("can_write_file", { _file_id: fileId });
        if (error) throw error;
        return data === true;
      }),
    );
    if (checks.some((allowed) => !allowed)) {
      throw new HttpError("Sem permissão para excluir um ou mais arquivos", 403);
    }
  }
}

async function prepareFileDelete(admin: any, ids: string[]): Promise<FileDeletePlan> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (!uniqueIds.length) return { rows: [], refs: [] };

  const fields = [
    "id",
    "parent_file_id",
    "revision_of_file_id",
    "client_id",
    "file_url",
    "storage_bucket",
    "storage_path",
    "agency_approval_status",
    "approval_status",
    "visibility",
    "locked_at",
  ].join(",");
  const [
    { data: targets, error: targetError },
    { data: children, error: childError },
  ] = await Promise.all([
    admin.from("files").select(fields).in("id", uniqueIds),
    admin.from("files").select(fields).in("parent_file_id", uniqueIds),
  ]);
  if (targetError) throw targetError;
  if (childError) throw childError;
  if ((targets || []).length !== uniqueIds.length) {
    throw new HttpError("Um ou mais arquivos não foram encontrados", 404);
  }

  const rowsById = new Map<string, FileRow>();
  for (const row of [...(targets || []), ...(children || [])] as FileRow[]) rowsById.set(row.id, row);
  const rows = Array.from(rowsById.values());
  const { data: revisions, error: revisionError } = await admin
    .from("files")
    .select("id,revision_of_file_id")
    .in("revision_of_file_id", rows.map((row) => row.id));
  if (revisionError) throw revisionError;
  if ((revisions || []).length > 0) {
    throw new HttpError("Arquivos com histórico de versões não podem ser excluídos", 409);
  }

  const protectedFile = rows.find((row) =>
    row.locked_at
    || row.approval_status !== "none"
    || row.agency_approval_status !== "not_requested"
    || row.visibility !== "internal"
  );
  if (protectedFile) {
    throw new HttpError("Arquivos enviados para revisão, compartilhados ou aprovados são imutáveis", 409);
  }

  const refs = rows
    .map(storageRefFromFile)
    .filter((ref): ref is { bucket: string; path: string } =>
      ref !== null && ref.bucket !== "workspace"
    );
  return { rows, refs };
}

async function executeFileDelete(caller: any, admin: any, plan: FileDeletePlan) {
  if (!plan.rows.length) {
    return { deleted: 0, storageRemoved: 0, storageErrors: [] as string[] };
  }
  const ids = plan.rows.map((row) => row.id);
  const { data: deletedRows, error: deleteError } = await caller
    .from("files")
    .delete()
    .in("id", ids)
    .select("id");
  if (deleteError) throw deleteError;
  if ((deletedRows || []).length !== ids.length) {
    throw new HttpError("A autorização dos arquivos mudou durante a exclusão", 409);
  }

  const refs = plan.refs;
  const storage = await removeObjects(admin, refs);
  return { deleted: ids.length, storageRemoved: storage.removed, storageErrors: storage.errors };
}

async function collectWorkspaceTree(admin: any, root: WorkspaceNode) {
  const nodes = new Map<string, WorkspaceNode>();
  nodes.set(root.id, root);

  const stack = root.kind === "folder" ? [root.id] : [];
  while (stack.length) {
    const parentId = stack.pop()!;
    const { data, error } = await admin
      .from("workspace_nodes")
      .select("id,parent_id,scope,client_id,kind,storage_path,sent_for_approval_file_id")
      .eq("parent_id", parentId);
    if (error) throw error;
    for (const child of (data || []) as WorkspaceNode[]) {
      nodes.set(child.id, child);
      if (child.kind === "folder") stack.push(child.id);
    }
  }
  return Array.from(nodes.values());
}

async function assertCallerCanAccessWorkspaceTree(caller: any, nodes: WorkspaceNode[]) {
  const ids = nodes.map((node) => node.id);
  const visibleIds = new Set<string>();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const chunk = ids.slice(offset, offset + 100);
    const { data, error } = await caller
      .from("workspace_nodes")
      .select("id")
      .in("id", chunk);
    if (error) throw error;
    for (const row of data || []) visibleIds.add(row.id);
  }
  if (ids.some((id) => !visibleIds.has(id))) {
    throw new HttpError("Sem permissão para excluir um ou mais itens do workspace", 403);
  }
}

async function assertWorkspaceTreeIsUnlinked(admin: any, nodes: WorkspaceNode[]) {
  const linkedNodeIds = nodes
    .filter((node) => Boolean(node.sent_for_approval_file_id))
    .map((node) => node.id);
  const workspacePaths = Array.from(new Set(
    nodes
      .filter((node) => node.kind === "file" && Boolean(node.storage_path))
      .map((node) => node.storage_path!),
  ));
  const linkedFileIds = new Set<string>();

  for (let offset = 0; offset < workspacePaths.length; offset += 50) {
    const chunk = workspacePaths.slice(offset, offset + 50);
    const [
      { data: bucketPathMatches, error: bucketPathError },
      { data: legacyUrlMatches, error: legacyUrlError },
    ] = await Promise.all([
      admin
        .from("files")
        .select("id")
        .eq("storage_bucket", "workspace")
        .in("storage_path", chunk),
      admin
        .from("files")
        .select("id")
        .in("file_url", chunk.map((path) => `${WORKSPACE_FILE_PREFIX}${path}`)),
    ]);
    if (bucketPathError) throw bucketPathError;
    if (legacyUrlError) throw legacyUrlError;
    for (const row of [...(bucketPathMatches || []), ...(legacyUrlMatches || [])]) {
      linkedFileIds.add(row.id);
    }
  }

  if (linkedNodeIds.length > 0 || linkedFileIds.size > 0) {
    throw new HttpError(
      "Itens vinculados a Arquivos não podem ser excluídos do Workspace; remova primeiro o vínculo em Arquivos",
      409,
    );
  }
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
    const caller = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

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
      await assertCallerCanDeleteFiles(caller, parsed.data.fileIds);
      const plan = await prepareFileDelete(admin, parsed.data.fileIds);
      await assertCallerCanDeleteFiles(caller, plan.rows.map((row) => row.id));
      const result = await executeFileDelete(caller, admin, plan);
      assertStorageCleanupSucceeded(result.storageErrors);
      return json({ ok: true, ...result });
    }

    const { data: root, error: rootError } = await admin
      .from("workspace_nodes")
      .select("id,parent_id,scope,client_id,kind,storage_path,sent_for_approval_file_id")
      .eq("id", parsed.data.nodeId)
      .maybeSingle();
    if (rootError) throw rootError;
    if (!root) return json({ ok: true, deleted: 0, storageRemoved: 0, storageErrors: [] });

    const tree = await collectWorkspaceTree(admin, root as WorkspaceNode);
    await assertCallerCanAccessWorkspaceTree(caller, tree);
    await assertWorkspaceTreeIsUnlinked(admin, tree);
    const workspaceRefs = tree
      .filter((node) => node.kind === "file" && node.storage_path)
      .map((node) => ({ bucket: "workspace", path: node.storage_path! }));

    const { data: deletedRoot, error: nodeError } = await caller
      .from("workspace_nodes")
      .delete()
      .eq("id", root.id)
      .select("id")
      .maybeSingle();
    if (nodeError) throw nodeError;
    if (!deletedRoot) throw new HttpError("A autorização do workspace mudou durante a exclusão", 409);

    const workspaceStorage = await removeObjects(admin, workspaceRefs);
    const storageErrors = workspaceStorage.errors;
    assertStorageCleanupSucceeded(storageErrors);

    return json({
      ok: true,
      deleted: tree.length,
      storageRemoved: workspaceStorage.removed,
      storageErrors,
    });
  } catch (error: any) {
    return json(
      { error: error?.message || "Falha ao excluir arquivo" },
      error instanceof HttpError ? error.status : 500,
    );
  }
});
