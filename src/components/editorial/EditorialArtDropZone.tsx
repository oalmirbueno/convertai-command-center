import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  confirmStoredObject,
  createFileRecord,
} from "@/lib/fileRecordActions";
import { mediaKindFromFile } from "@/lib/fileUrls";
import { cn } from "@/lib/utils";

/**
 * Subir a arte sem sair do card.
 *
 * O caminho era: fechar o editor, ir em Arquivos, subir, voltar, procurar o
 * card, escolher a arte. Este componente é um ATALHO do mesmo caminho — grava
 * pelo MESMO RPC do Arquivos (create_file_record), no mesmo bucket, com os
 * mesmos campos. Por isso o arquivo aparece em Arquivos no mesmo instante:
 * não existe cópia, existe um lugar só.
 *
 * Aprovação não é pulada: o seletor aceita arquivo ainda não aprovado por
 * regra própria dele (a espera é do agendamento, não da seleção), e o gate de
 * publicar continua intacto.
 */

const storageSafeName = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "arquivo";

interface Props {
  clientId: string | null;
  projectId: string | null;
  disabled?: boolean;
  /** Chamado com o id do arquivo raiz recém-criado, para virar a arte do card. */
  onUploaded: (rootFileId: string) => Promise<void> | void;
  children: React.ReactNode;
}

export default function EditorialArtDropZone({
  clientId, projectId, disabled = false, onUploaded, children,
}: Props) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [arrastando, setArrastando] = useState(false);

  const enviar = async (lista: FileList | File[]) => {
    const files = Array.from(lista);
    if (files.length === 0 || !clientId || disabled || enviando) return;

    const tipos = files.map((file) =>
      mediaKindFromFile(file.name, undefined, file.type),
    );
    if (tipos.some((tipo) => tipo !== "image" && tipo !== "video")) {
      toast.error("Só imagem ou vídeo viram arte do conteúdo.");
      return;
    }
    // Mais de um arquivo é carrossel, e carrossel é de imagens — igual ao
    // Arquivos: vídeo não entra em carrossel na publicação.
    if (files.length > 1 && tipos.some((tipo) => tipo !== "image")) {
      toast.error("Vários arquivos formam um carrossel, e carrossel é só de imagens. Envie o vídeo sozinho.");
      return;
    }

    setEnviando(true);
    try {
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr || !authData?.user?.id) {
        throw new Error("Sua sessão expirou. Faça login novamente para enviar arquivos.");
      }
      const authUid = authData.user.id;
      const batchId = crypto.randomUUID();
      const isCarousel = files.length > 1;
      let parentFileId: string | null = null;

      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const fileId = crypto.randomUUID();
        const groupId = parentFileId || fileId;
        const path = `${clientId}/${groupId}/v1/${i + 1}-${storageSafeName(file.name)}`;

        const { error: storageError } = await supabase.storage
          .from("files")
          .upload(path, file);
        if (storageError) {
          // O objeto pode ter subido mesmo com resposta perdida; só é erro de
          // verdade se ele não estiver lá.
          const estado = await confirmStoredObject("files", path);
          if (estado !== "exists") throw storageError;
        }

        const inserted = await createFileRecord({
          id: fileId,
          client_id: clientId,
          file_name: isCarousel && i > 0 ? `${files[0].name} (${i + 1}/${files.length})` : file.name,
          file_url: `files://${path}`,
          // Os valores do padrão dominante do Arquivos, para o atalho criar
          // registros indistinguíveis dos criados por lá.
          file_type: isCarousel ? "carrossel" : "creative",
          mime_type: file.type || null,
          extension: file.name.split(".").pop() || null,
          storage_bucket: "files",
          storage_path: path,
          folder: "materiais",
          uploaded_by: authUid,
          project_id: projectId || null,
          approval_status: "none",
          agency_approval_status: "not_requested",
          visibility: "internal",
          requires_approval: false,
          status: "ready",
          version: 1,
          parent_file_id: isCarousel && i > 0 ? parentFileId : null,
          idempotency_key: `editorial-art-upload:${batchId}:${i}`,
        } as never);

        if (i === 0) parentFileId = inserted.id;
      }

      // As mesmas chaves que o Arquivos invalida: a tela dele, aberta em
      // outra aba, mostra o envio sem ninguém recarregar.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["all-files"] }),
        queryClient.invalidateQueries({ queryKey: ["files"] }),
        queryClient.invalidateQueries({ queryKey: ["workspace-client-files"] }),
      ]);

      if (parentFileId) await onUploaded(parentFileId);
      toast.success(
        files.length > 1
          ? `Carrossel com ${files.length} imagens enviado e vinculado.`
          : "Arte enviada e vinculada. Ela já está em Arquivos também.",
      );
    } catch (erro) {
      toast.error(
        erro instanceof Error ? erro.message : "Não foi possível enviar. Tente de novo.",
      );
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div
      onDragOver={(e) => {
        if (disabled || enviando) return;
        e.preventDefault();
        setArrastando(true);
      }}
      onDragLeave={() => setArrastando(false)}
      onDrop={(e) => {
        e.preventDefault();
        setArrastando(false);
        if (!disabled && !enviando) void enviar(e.dataTransfer.files);
      }}
      className={cn(
        "relative rounded-xl transition-shadow",
        arrastando && "ring-2 ring-primary/60 ring-offset-1",
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void enviar(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={disabled || enviando || !clientId}
        onClick={() => inputRef.current?.click()}
        className="mb-2 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/[0.04] px-3 py-2 text-[11.5px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {enviando ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Upload className="h-3.5 w-3.5" />
        )}
        {enviando
          ? "Enviando e vinculando…"
          : "Subir arte do computador — ou arraste os arquivos aqui"}
      </button>
      {children}
      {arrastando && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-primary/10">
          <p className="rounded-lg bg-card px-3 py-1.5 text-xs font-medium text-primary shadow">
            Solte para enviar e vincular
          </p>
        </div>
      )}
    </div>
  );
}
