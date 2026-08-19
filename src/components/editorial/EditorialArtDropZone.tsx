import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Images, Loader2, Upload } from "lucide-react";
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

/**
 * O que a pessoa quis subir.
 *
 * Não é só rótulo: escolher "carrossel" declara a intenção ANTES do envio, e
 * com isso dá para recusar um arquivo só — que subiria como arte única sem
 * ninguém perceber que o carrossel não aconteceu.
 */
type Intencao = "unica" | "carrossel";

/**
 * Como cada arquivo é nomeado.
 *
 * Com nome escolhido, a peça inteira usa ele — e o carrossel numera as
 * imagens seguintes, para a ordem ficar legível na lista de Arquivos.
 */
function nomeDaPeca(
  nome: string,
  files: File[],
  indice: number,
  isCarousel: boolean,
): string {
  const escolhido = nome.trim();
  const base = escolhido || files[0].name;
  if (!isCarousel) return escolhido || files[indice].name;
  return indice === 0 ? base : `${base} (${indice + 1}/${files.length})`;
}

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
  const intencaoRef = useRef<Intencao>("unica");
  const [enviando, setEnviando] = useState(false);
  const [nome, setNome] = useState("");
  /** Qual alvo está sob o cursor: é o que dá o retorno visual do arrasto. */
  const [alvoAtivo, setAlvoAtivo] = useState<Intencao | null>(null);

  const abrirSeletor = (intencao: Intencao) => {
    intencaoRef.current = intencao;
    inputRef.current?.click();
  };

  const enviar = async (lista: FileList | File[], intencao: Intencao) => {
    const files = Array.from(lista);
    if (files.length === 0 || !clientId || disabled || enviando) return;

    const tipos = files.map((file) =>
      mediaKindFromFile(file.name, undefined, file.type),
    );
    if (tipos.some((tipo) => tipo !== "image" && tipo !== "video")) {
      toast.error("Só imagem ou vídeo viram arte do conteúdo.");
      return;
    }
    // Pediu carrossel e mandou um arquivo só: subiria como arte única e o
    // carrossel simplesmente não teria acontecido, sem aviso nenhum.
    if (intencao === "carrossel" && files.length < 2) {
      toast.error("Carrossel precisa de pelo menos duas imagens. Selecione todas de uma vez, na ordem que devem aparecer.");
      return;
    }
    // Carrossel é de imagens, igual ao Arquivos: vídeo não entra em carrossel
    // na publicação.
    if (files.length > 1 && tipos.some((tipo) => tipo !== "image")) {
      toast.error("Carrossel é só de imagens. Envie o vídeo sozinho.");
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
      void intencao;
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
          // O nome escolhido vale para a peça inteira; sem ele, o do arquivo.
          // Nome de arquivo de celular ("IMG_20260819.jpg") é o que deixava
          // tudo com cara de genérico em Arquivos.
          file_name: nomeDaPeca(nome, files, i, isCarousel),
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
      setNome("");
      toast.success(
        isCarousel
          ? `Carrossel com ${files.length} imagens enviado e vinculado, na ordem escolhida.`
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

  /**
   * Cada alvo aceita o arrasto declarando o que ele significa.
   *
   * Antes o arrasto adivinhava pela quantidade de arquivos: soltar duas
   * imagens virava carrossel mesmo quando eram duas artes separadas, e soltar
   * uma pretendendo carrossel virava arte única. Com dois alvos, o gesto diz
   * a intenção — e a validação do carrossel passa a valer também no arrasto.
   */
  const alvoDeArrasto = (intencao: Intencao) => ({
    onDragOver: (e: React.DragEvent) => {
      if (disabled || enviando) return;
      e.preventDefault();
      e.stopPropagation();
      setAlvoAtivo(intencao);
    },
    onDragLeave: () => setAlvoAtivo((atual) => (atual === intencao ? null : atual)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setAlvoAtivo(null);
      if (!disabled && !enviando) void enviar(e.dataTransfer.files, intencao);
    },
  });

  const classeDoAlvo = (intencao: Intencao) =>
    cn(
      "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-3 py-2.5 text-[11.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
      alvoAtivo === intencao
        ? "border-primary bg-primary/15 text-primary"
        : "border-primary/40 bg-primary/[0.04] text-primary hover:bg-primary/10",
    );

  return (
    <div className="rounded-xl">
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void enviar(e.target.files, intencaoRef.current);
          e.target.value = "";
        }}
      />

      {/* O nome da peça, escolhido ANTES do envio.

          Sem ele o registro nasce com o nome do arquivo — "IMG_20260819.jpg" —
          e é isso que deixa a lista de Arquivos com cara de genérica. */}
      <label className="mb-1.5 block">
        <span className="sr-only">Nome da peça</span>
        <input
          type="text"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          disabled={disabled || enviando}
          placeholder="Nome da peça (opcional — sem isto vale o nome do arquivo)"
          className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11.5px] text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none disabled:opacity-50"
        />
      </label>

      {enviando ? (
        <p className="mb-2 flex items-center justify-center gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/[0.04] px-3 py-2 text-[11.5px] font-medium text-primary">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Enviando e vinculando…
        </p>
      ) : (
        <div className="mb-2 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            disabled={disabled || !clientId}
            onClick={() => abrirSeletor("unica")}
            title="Uma imagem ou um vídeo. Pode soltar o arquivo aqui."
            className={classeDoAlvo("unica")}
            {...alvoDeArrasto("unica")}
          >
            <Upload className="h-3.5 w-3.5" />
            {alvoAtivo === "unica" ? "Soltar como arte" : "Arte / post"}
          </button>
          <button
            type="button"
            disabled={disabled || !clientId}
            onClick={() => abrirSeletor("carrossel")}
            title="Duas imagens ou mais, na ordem em que devem aparecer. Pode soltar aqui."
            className={classeDoAlvo("carrossel")}
            {...alvoDeArrasto("carrossel")}
          >
            <Images className="h-3.5 w-3.5" />
            {alvoAtivo === "carrossel" ? "Soltar como carrossel" : "Carrossel"}
          </button>
        </div>
      )}
      {!enviando && (
        <p className="mb-2 text-center text-[10px] leading-snug text-muted-foreground">
          Clique para escolher, ou arraste até o alvo certo. No carrossel, a ordem é a da seleção.
        </p>
      )}
      {children}
    </div>
  );
}
