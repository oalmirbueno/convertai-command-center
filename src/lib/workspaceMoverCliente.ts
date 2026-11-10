import { supabase } from "@/integrations/supabase/client";
import { createFileRecord } from "@/lib/fileRecordActions";
import {
  BUCKET_WORKSPACE,
  ErroDeMovimento,
  executarMovimento,
  COLUNAS_DO_ARQUIVO,
  arquivoDeLinha,
  type LinhaDeArquivo,
  type LinhaDeNo,
  type NoDeWorkspace,
  type PedidoDeMovimento,
  type PortasDoMovimento,
} from "../../supabase/functions/mcp-server/modulos/workspace-mover";

export { ErroDeMovimento };

function falha(mensagem: string): never {
  throw new ErroDeMovimento(mensagem);
}

async function copiarBlob(deBucket: string, dePath: string, paraBucket: string, paraPath: string) {
  const copiado = await supabase.storage.from(deBucket).copy(dePath, paraPath, {
    destinationBucket: paraBucket,
  });
  if (!copiado.error) return;
  const texto = `${copiado.error.message || ""}`;
  if (/already exists|duplicate|já existe/i.test(texto)) return;

  const baixado = await supabase.storage.from(deBucket).download(dePath);
  if (baixado.error || !baixado.data) {
    falha(baixado.error?.message || "Não foi possível ler o arquivo de origem. Nada foi alterado.");
  }
  const enviado = await supabase.storage.from(paraBucket).upload(paraPath, baixado.data, {
    upsert: false,
    contentType: baixado.data.type || "application/octet-stream",
  });
  if (!enviado.error) return;
  if (/already exists|duplicate|já existe/i.test(enviado.error.message || "")) return;
  falha(enviado.error.message || "Não foi possível copiar o arquivo. Nada foi alterado.");
}

function noDe(row: Record<string, unknown> | null): NoDeWorkspace | null {
  if (!row) return null;
  return {
    id: String(row.id),
    parent_id: (row.parent_id as string | null) ?? null,
    scope: row.scope === "global" ? "global" : "client",
    client_id: (row.client_id as string | null) ?? null,
    kind: row.kind === "folder" ? "folder" : "file",
    name: String(row.name || ""),
    mime: (row.mime as string | null) ?? null,
    size_bytes: row.size_bytes == null ? null : Number(row.size_bytes),
    storage_path: (row.storage_path as string | null) ?? null,
    sent_for_approval_file_id: (row.sent_for_approval_file_id as string | null) ?? null,
  };
}

const COLUNAS_DO_NO = "id, parent_id, scope, client_id, kind, name, mime, size_bytes, storage_path, sent_for_approval_file_id";

function portas(): PortasDoMovimento {
  return {
    async lerArquivo(id) {
      const { data, error } = await (supabase as any)
        .from("staff_files_secure")
        .select(COLUNAS_DO_ARQUIVO)
        .eq("id", id)
        .maybeSingle();
      if (error) falha(error.message);
      if (!data) return null;
      const filhos = await (supabase as any)
        .from("staff_files_secure")
        .select("id")
        .eq("parent_file_id", id)
        .limit(1);
      if (filhos.error) falha(filhos.error.message);
      return arquivoDeLinha(data as Record<string, unknown>, (filhos.data || []).length > 0);
    },
    async lerNo(id) {
      const { data, error } = await supabase.from("workspace_nodes").select(COLUNAS_DO_NO).eq("id", id).maybeSingle();
      if (error) falha(error.message);
      return noDe(data as Record<string, unknown> | null);
    },
    async noDoArquivo(arquivoId) {
      const { data, error } = await supabase
        .from("workspace_nodes")
        .select(COLUNAS_DO_NO)
        .eq("sent_for_approval_file_id", arquivoId)
        .limit(1);
      if (error) falha(error.message);
      const linha = (data || [])[0] as Record<string, unknown> | undefined;
      return noDe(linha || null);
    },
    copiar: copiarBlob,
    async apagarBlob(bucket, path) {
      const { error } = await supabase.storage.from(bucket).remove([path]);
      if (error) throw new ErroDeMovimento(error.message);
    },
    async criarNo(linha: LinhaDeNo) {
      const { data, error } = await supabase.from("workspace_nodes").insert(linha).select("id").single();
      if (error || !data) falha(error?.message || "A pasta não recebeu o arquivo.");
      return { id: data.id };
    },
    async moverNo(id, parentId) {
      const { data, error } = await supabase
        .from("workspace_nodes")
        .update({ parent_id: parentId })
        .eq("id", id)
        .select("id");
      if (error || !data?.length) falha(error?.message || "A pasta de destino não confirmou o arquivo.");
    },
    async apagarNo(id) {
      const { data, error } = await supabase.from("workspace_nodes").delete().eq("id", id).select("id");
      if (error || !data?.length) falha(error?.message || "Não foi possível tirar o arquivo da pasta de origem.");
    },
    async retirarArquivo(arquivoId, destino) {
      const apagado = await (supabase as any).from("files").delete().eq("id", arquivoId).select("id");
      if (!apagado.error && apagado.data?.length) return;
      const apontado = await (supabase as any)
        .from("files")
        .update({
          storage_bucket: destino.bucket,
          storage_path: destino.path,
          file_url: `${destino.bucket}://${destino.path}`,
        })
        .eq("id", arquivoId)
        .select("id");
      if (apontado.error || !apontado.data?.length) {
        falha(apontado.error?.message || apagado.error?.message || "O arquivo entrou na pasta, mas continua em Arquivos.");
      }
    },
    async definirPasta(arquivoId, pasta) {
      const { data, error } = await (supabase as any)
        .from("files")
        .update({ folder: pasta })
        .eq("id", arquivoId)
        .select("id");
      if (error || !data?.length) falha(error?.message || "A pasta de Arquivos não confirmou o arquivo.");
    },
    async criarArquivo(linha: LinhaDeArquivo) {
      const criado = await createFileRecord({
        client_id: linha.client_id,
        uploaded_by: linha.uploaded_by,
        file_name: linha.file_name,
        file_url: linha.file_url,
        file_type: linha.file_type,
        folder: linha.folder,
        mime_type: linha.mime_type,
        extension: linha.extension,
        storage_bucket: linha.storage_bucket,
        storage_path: linha.storage_path,
        size_bytes: linha.size_bytes,
        source: linha.source,
        idempotency_key: linha.idempotency_key,
        approval_status: "none",
        agency_approval_status: "not_requested",
        requires_approval: false,
        status: "ready",
        visibility: "internal",
      });
      return { id: criado.id };
    },
    async definirPastaDoArquivo(arquivoId, pasta) {
      const { data, error } = await (supabase as any)
        .from("files")
        .update({ folder: pasta })
        .eq("id", arquivoId)
        .select("id");
      if (error || !data?.length) falha(error?.message || "A pasta de Arquivos não confirmou o arquivo.");
    },
  };
}

export function moverPeloPainel(
  pedido: PedidoDeMovimento,
): Promise<{ mudou: boolean }> {
  return executarMovimento(pedido, portas());
}
