import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type FileRecord = Database["public"]["Tables"]["files"]["Row"];
export type FileRecordInput = Database["public"]["Tables"]["files"]["Insert"];
export type StoredObjectState = "exists" | "missing" | "unknown";

type RpcResult<T = unknown> = {
  data: T | null;
  error: { message?: string } | null;
};

type FileRecordRpc = <T = unknown>(
  functionName: string,
  args: Record<string, unknown>,
) => Promise<RpcResult<T>>;

export async function createFileRecord(file: FileRecordInput): Promise<FileRecord> {
  const rpc = supabase.rpc.bind(supabase) as unknown as FileRecordRpc;
  const { data, error } = await rpc<FileRecord>("create_file_record", { p_file: file });
  if (error) throw error;
  if (!data) throw new Error("Arquivo não foi registrado.");
  return data;
}

export async function confirmStoredObject(
  bucket: "files" | "workspace",
  storagePath: string,
): Promise<StoredObjectState> {
  try {
    const { data, error } = await supabase.storage.from(bucket).info(storagePath);
    if (data && !error) return "exists";

    const status = Number((error as { status?: number; statusCode?: string } | null)?.status
      || (error as { status?: number; statusCode?: string } | null)?.statusCode);
    return status === 404 ? "missing" : "unknown";
  } catch (error) {
    const status = Number((error as { status?: number; statusCode?: string } | null)?.status
      || (error as { status?: number; statusCode?: string } | null)?.statusCode);
    return status === 404 ? "missing" : "unknown";
  }
}

export async function recoverFailedFileRecordById({
  fileId,
  clientId,
  fileUrl,
}: {
  fileId: string;
  clientId: string;
  fileUrl: string;
}): Promise<FileRecord | null> {
  const { data, error } = await (supabase as any)
    .from("staff_files_secure")
    .select("*")
    .eq("id", fileId)
    .maybeSingle();
  if (error) {
    throw new Error(
      "Não foi possível confirmar o registro; o conteúdo foi preservado por segurança.",
    );
  }
  if (!data) return null;
  if (data.client_id !== clientId || data.file_url !== fileUrl) {
    throw new Error("O identificador deste envio já pertence a outro conteúdo.");
  }
  return data as FileRecord;
}

export async function recoverOrCleanupFailedFileRecord({
  fileId,
  storagePath,
}: {
  fileId: string;
  storagePath: string;
}): Promise<FileRecord | null> {
  const byId = await (supabase as any)
    .from("staff_files_secure")
    .select("*")
    .eq("id", fileId)
    .maybeSingle();
  if (byId.error) {
    throw new Error(
      "Não foi possível confirmar o registro; o objeto foi preservado por segurança.",
    );
  }
  if (byId.data) {
    if (
      byId.data.storage_bucket !== "files"
      || byId.data.storage_path !== storagePath
    ) {
      throw new Error("O identificador do upload já pertence a outro arquivo.");
    }
    return byId.data as FileRecord;
  }

  const byPath = await (supabase as any)
    .from("staff_files_secure")
    .select("*")
    .eq("storage_bucket", "files")
    .eq("storage_path", storagePath)
    .maybeSingle();
  if (byPath.error) {
    throw new Error(
      "Não foi possível confirmar o registro; o objeto foi preservado por segurança.",
    );
  }
  if (byPath.data) {
    if (byPath.data.id !== fileId) {
      throw new Error(
        "O caminho deste upload já pertence a outro arquivo; o objeto foi preservado.",
      );
    }
    return byPath.data as FileRecord;
  }

  const { error: cleanupError } = await supabase.storage
    .from("files")
    .remove([storagePath]);
  if (cleanupError) {
    throw new Error(
      "O registro falhou e o arquivo temporário não pôde ser removido.",
    );
  }
  return null;
}
