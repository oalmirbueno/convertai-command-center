import { createFileRecord } from "@/lib/fileRecordActions";
import { supabase } from "@/integrations/supabase/client";

export type WorkspaceFileForHandoff = {
  id: string;
  client_id: string | null;
  kind: "folder" | "file";
  name: string;
  mime: string | null;
  size_bytes: number | null;
  storage_path: string | null;
  sent_for_approval_file_id: string | null;
};

export type WorkspaceFileHandoffInput = {
  node: WorkspaceFileForHandoff;
  clientId: string;
  userId: string;
  fileName: string;
  folder: string;
  fileType: string;
  projectId: string | null;
};

export type WorkspaceFileHandoffResult = {
  fileId: string;
  created: boolean;
};

type ExistingFile = {
  id: string;
  client_id: string;
  storage_bucket: string | null;
  storage_path: string | null;
};

function assertSameWorkspaceObject(
  row: ExistingFile,
  clientId: string,
  storagePath: string,
) {
  if (
    row.client_id !== clientId
    || row.storage_bucket !== "workspace"
    || row.storage_path !== storagePath
  ) {
    throw new Error("O vínculo existente aponta para outro cliente ou arquivo.");
  }
}

async function findFileById(fileId: string): Promise<ExistingFile | null> {
  const { data, error } = await (supabase as any)
    .from("staff_files_secure")
    .select("id, client_id, storage_bucket, storage_path")
    .eq("id", fileId)
    .maybeSingle();
  if (error) throw error;
  return data as ExistingFile | null;
}

async function findFileByWorkspacePath(
  clientId: string,
  storagePath: string,
): Promise<ExistingFile | null> {
  const { data, error } = await (supabase as any)
    .from("staff_files_secure")
    .select("id, client_id, storage_bucket, storage_path")
    .eq("client_id", clientId)
    .eq("storage_bucket", "workspace")
    .eq("storage_path", storagePath)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as ExistingFile | null;
}

async function linkWorkspaceNode(
  node: WorkspaceFileForHandoff,
  clientId: string,
  fileId: string,
) {
  const { data, error } = await supabase
    .from("workspace_nodes")
    .update({ sent_for_approval_file_id: fileId })
    .eq("id", node.id)
    .eq("client_id", clientId)
    .eq("scope", "client")
    .eq("kind", "file")
    .eq("storage_path", node.storage_path!)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error("O arquivo mudou de contexto antes de concluir o vínculo.");
  }
}

export function suggestedFileType(
  name: string,
  mime: string | null,
): string {
  const normalized = `${mime || ""} ${name}`.toLowerCase();
  if (/image\/|video\/|\.(png|jpe?g|gif|webp|mp4|mov|webm)$/i.test(normalized)) {
    return "criativo";
  }
  if (/application\/pdf|\.(pdf|docx?|xlsx?|pptx?|txt|csv)$/i.test(normalized)) {
    return "documento";
  }
  return "outro";
}

export async function handoffWorkspaceFileToFiles(
  input: WorkspaceFileHandoffInput,
): Promise<WorkspaceFileHandoffResult> {
  const {
    node,
    clientId,
    userId,
    fileName,
    folder,
    fileType,
    projectId,
  } = input;

  if (node.kind !== "file" || !node.storage_path) {
    throw new Error("Selecione um arquivo válido do Workspace.");
  }
  if (!node.client_id || node.client_id !== clientId) {
    throw new Error("O arquivo não pertence ao cliente selecionado.");
  }
  if (!fileName.trim()) {
    throw new Error("Informe o nome do arquivo.");
  }

  if (node.sent_for_approval_file_id) {
    const linked = await findFileById(node.sent_for_approval_file_id);
    if (linked) {
      assertSameWorkspaceObject(linked, clientId, node.storage_path);
      return { fileId: linked.id, created: false };
    }
  }

  const existing = await findFileByWorkspacePath(clientId, node.storage_path);
  if (existing) {
    assertSameWorkspaceObject(existing, clientId, node.storage_path);
    await linkWorkspaceNode(node, clientId, existing.id);
    return { fileId: existing.id, created: false };
  }

  let created;
  try {
    created = await createFileRecord({
      client_id: clientId,
      project_id: projectId,
      uploaded_by: userId,
      file_name: fileName.trim(),
      file_url: `workspace://${node.storage_path}`,
      file_type: fileType,
      folder,
      mime_type: node.mime,
      extension: node.name.includes(".")
        ? node.name.split(".").pop()?.toLowerCase() || null
        : null,
      storage_bucket: "workspace",
      storage_path: node.storage_path,
      size_bytes: node.size_bytes || 0,
      source: "workspace",
      idempotency_key: `workspace-node:${node.id}`,
      approval_status: "none",
      agency_approval_status: "not_requested",
      requires_approval: false,
      status: "ready",
      visibility: "internal",
    });
  } catch (error) {
    const raced = await findFileByWorkspacePath(clientId, node.storage_path);
    if (!raced) throw error;
    assertSameWorkspaceObject(raced, clientId, node.storage_path);
    await linkWorkspaceNode(node, clientId, raced.id);
    return { fileId: raced.id, created: false };
  }

  // If the node changes between creation and linkage, keep the internal Files
  // row recoverable by its unique bucket/path. Never risk deleting the shared
  // Workspace object as compensation for a stale UI context.
  await linkWorkspaceNode(node, clientId, created.id);

  return { fileId: created.id, created: true };
}
