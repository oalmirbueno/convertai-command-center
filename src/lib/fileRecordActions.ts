import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type FileRecord = Database["public"]["Tables"]["files"]["Row"];
export type FileRecordInput = Database["public"]["Tables"]["files"]["Insert"];

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