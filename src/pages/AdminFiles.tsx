import { useEffect, useState, useRef } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { useClients, useProjects, useAllFiles } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { gravarCopiasSemEsperar } from "@/lib/miniaturas";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Upload, FileImage, FileText, Film, Archive, Download, Trash2, FolderOpen, Pencil, Check, X, FolderInput, Grid2X2, List, Send, Search, MoreHorizontal, Users, Folder, Tag, CircleDot,
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AjudaRecolhida,
  CabecalhoDePagina,
  CampoDeFormulario,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  GrupoDeCampos,
  RegiaoRolavel,
  SeletorCompacto,
  botao,
  campo,
  campoTexto,
  etiqueta,
  juntar,
  lerEstadoDaTela,
  superficie,
  texto,
  useEstadoDaTela,
} from "@/components/sistema";
import FilePreviewContent from "@/components/shared/FilePreviewContent";
import SharedCarouselSlider from "@/components/shared/CarouselSlider";
import AdminContracts from "@/pages/AdminContracts";
import { downloadFile } from "@/lib/fileActions";
import {
  confirmStoredObject,
  createFileRecord,
  recoverFailedFileRecordById,
  recoverOrCleanupFailedFileRecord,
} from "@/lib/fileRecordActions";
import { FILE_FOLDERS, FILE_TYPES } from "@/lib/fileMetadata";
import {
  folderDefinition,
  kindLabel,
  matchesFolderFilter,
  resolveKind,
  summarizeFiles,
  type FileKindId,
  type FolderId,
} from "@/lib/fileTaxonomy";
import { isCarouselAssetGroup, mediaKindFromFile, resolveFileUrl, useResolvedFileUrl, fileExtension, mensagemDaFuncao } from "@/lib/fileUrls";
import {
  releaseFileToClient,
  requestFileAgencyReview,
  reviewFileAgency,
  type FileReleaseMode,
} from "@/lib/fileApprovalActions";

const FOLDERS = FILE_FOLDERS;

const FOLDER_IDS = new Set<string>(FOLDERS.map((folder) => folder.id));

const ACCEPTED = "*/*";
const MAX_SIZE = 100 * 1024 * 1024; // Mesmo limite configurado no bucket.

const storageSafeName = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "arquivo";

const fileIcon = (name: string) => {
  const ext = name?.split(".").pop()?.toLowerCase() || "";
  if (["jpg","jpeg","png","gif","webp"].includes(ext)) return FileImage;
  if (["mp4"].includes(ext)) return Film;
  if (["zip"].includes(ext)) return Archive;
  return FileText;
};

const approvalBadge: Record<string, { cls: string; label: string }> = {
  pending: { cls: "bg-warning/10 text-warning", label: "Pendente" },
  approved: { cls: "bg-success/10 text-success", label: "Aprovado" },
  rejected: { cls: "bg-destructive/10 text-destructive", label: "Rejeitado" },
  none: { cls: "bg-muted text-muted-foreground", label: "Sem status" },
};

const agencyBadge: Record<string, { cls: string; label: string }> = {
  not_requested: { cls: "bg-muted text-muted-foreground", label: "Rascunho interno" },
  pending: { cls: "bg-warning/10 text-warning", label: "Em revisão interna" },
  approved: { cls: "bg-success/10 text-success", label: "Revisão interna aprovada" },
  rejected: { cls: "bg-destructive/10 text-destructive", label: "Ajustes internos pedidos" },
};

type EditableFileState = {
  agency_approval_status?: string | null;
  approval_status?: string | null;
  locked_at?: string | null;
  visibility?: string | null;
};

type UploadPostSaveAction = "draft" | "internal_review" | "client_shared" | "approval";
type UploadMode = "single" | "carousel" | "video_link";

const UPLOAD_MODES = new Set<UploadMode>(["single", "carousel", "video_link"]);

const parseUploadMode = (value: string | null): UploadMode | null =>
  value && UPLOAD_MODES.has(value as UploadMode)
    ? value as UploadMode
    : null;

const clearUploadLaunchParams = (params: URLSearchParams) => {
  params.delete("novo");
  params.delete("mode");
  params.delete("project");
  return params;
};

const isEditableFile = (file?: EditableFileState | null) =>
  !!file
  && !file.locked_at
  && file.visibility === "internal"
  && (file.agency_approval_status || "not_requested") === "not_requested"
  && (file.approval_status || "none") === "none";

/**
 * Capa do arquivo: a peça INTEIRA, sem zoom nem corte, sem moldura extra e sem
 * escurecer nada. Preenche a caixa de quem chama (a proporção vem de fora, por
 * padding-bottom). O resto ganha o ícone do tipo e a extensão, para o olho
 * achar PDF, planilha ou documento de longe.
 */
function FileThumb({ file, compacto = false }: { file: any; compacto?: boolean }) {
  const kind = mediaKindFromFile(file.file_name, file.file_url, file.mime_type || file.file_type, file.extension);
  const Icon = fileIcon(file.file_name);
  const { url } = useResolvedFileUrl({
    fileUrl: file.file_url,
    storageBucket: file.storage_bucket,
    storagePath: file.storage_path,
    miniatura: kind === "image",
    expiresIn: 3600,
  });
  const ext = (fileExtension(file.file_name, file.file_url, file.extension) || "").toUpperCase().slice(0, 5);

  return (
    <span className="absolute inset-0 flex items-center justify-center overflow-hidden bg-muted">
      {url && kind === "image" ? (
        <img src={url} alt="" loading="lazy" decoding="async" className="h-full w-full object-contain" />
      ) : url && kind === "video" ? (
        <>
          <video src={`${url}#t=0.1`} muted playsInline preload="none" className="h-full w-full object-contain" />
          <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-background/85 text-foreground">
              <Film className="h-4 w-4" />
            </span>
          </span>
        </>
      ) : (
        <span className="flex flex-col items-center justify-center" aria-hidden="true">
          <Icon className={compacto ? "h-5 w-5 text-muted-foreground" : "h-8 w-8 text-muted-foreground"} />
          {!compacto && ext && <span className={juntar(etiqueta, "mt-1.5 bg-card text-muted-foreground")}>{ext}</span>}
        </span>
      )}
      {!compacto && ext && (kind === "image" || kind === "video") && (
        <span className={juntar(etiqueta, "absolute bottom-1.5 right-1.5 bg-background/90 text-foreground")} aria-hidden="true">{ext}</span>
      )}
    </span>
  );
}

type FiltroDeStatus = "todos" | "interno" | "revisao" | "ajustes" | "cliente";

const FILTROS_DE_STATUS: { valor: FiltroDeStatus; rotulo: string }[] = [
  { valor: "todos", rotulo: "Todos os status" },
  { valor: "interno", rotulo: "Cliente não vê" },
  { valor: "revisao", rotulo: "Em revisão interna" },
  { valor: "ajustes", rotulo: "Ajustes pedidos" },
  { valor: "cliente", rotulo: "Visível ao cliente" },
];
const STATUS_IDS = new Set<string>(FILTROS_DE_STATUS.map((f) => f.valor));

const bateStatus = (file: any, filtro: FiltroDeStatus) => {
  if (filtro === "todos") return true;
  if (filtro === "interno") return file.visibility === "internal";
  if (filtro === "revisao") return file.agency_approval_status === "pending";
  if (filtro === "ajustes") return file.agency_approval_status === "rejected" || file.approval_status === "rejected";
  return file.visibility !== "internal";
};

type AcoesDoArquivoProps = {
  file: any;
  podeLiberar: boolean;
  podeMover: boolean;
  podeExcluir: boolean;
  onLiberar: () => void;
  onMover: (pasta: string) => void;
  onBaixar: () => void;
  onExcluir: () => void;
  /** Botões sobre a imagem (fundo claro por trás) ou na linha da lista. */
  sobreImagem?: boolean;
  onMenu?: (aberto: boolean) => void;
};

/** Ações de um arquivo: liberar, mover de pasta, baixar e excluir (cada uma só quando vale). */
function AcoesDoArquivo({ file, podeLiberar, podeMover, podeExcluir, onLiberar, onMover, onBaixar, onExcluir, sobreImagem = false, onMenu }: AcoesDoArquivoProps) {
  const base = sobreImagem
    ? "inline-flex h-7 w-7 items-center justify-center rounded-md bg-background/90 text-foreground transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    : botao.icone;
  return (
    <div className={juntar("flex shrink-0 items-center", sobreImagem && "[&>*+*]:ml-1")}>
      {podeLiberar && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onLiberar(); }}
          title="Liberar ao cliente agora (revisão interna registrada junto)"
          aria-label={`Liberar ${file.file_name} ao cliente`}
          className={juntar(base, "text-warning hover:text-success")}
        >
          <Send className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
      {podeMover && (
        <DropdownMenu onOpenChange={onMenu}>
          <DropdownMenuTrigger asChild>
            <button type="button" onClick={(e) => e.stopPropagation()} className={base} title="Mover de pasta" aria-label={`Mover ${file.file_name} de pasta`}>
              <FolderInput className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {FOLDERS.filter(fo => fo.id !== (file.folder || "estrategicos")).map(fo => (
              <DropdownMenuItem key={fo.id} onClick={(e) => { e.stopPropagation(); onMover(fo.id); }}>
                {fo.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onBaixar(); }}
        className={base}
        title="Baixar"
        aria-label={`Baixar ${file.file_name}`}
      >
        <Download className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {podeExcluir && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onExcluir(); }}
          className={juntar(base, "hover:text-destructive")}
          title="Excluir"
          aria-label={`Excluir ${file.file_name}`}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

type ItemDoArquivoProps = Omit<AcoesDoArquivoProps, "sobreImagem" | "onMenu"> & {
  itensNoCarrossel: number;
  onAbrir: () => void;
  formatDate: (d: string) => string;
};

const seloDeVisibilidade = (file: any) =>
  file.visibility === "internal"
    ? { cor: "text-warning", fundo: "bg-warning/15", label: "Cliente não vê" }
    : { cor: "text-success", fundo: "bg-success/10", label: "Visível ao cliente" };

/** Cartão de mídia: a imagem manda, legenda em uma linha, ações no hover (sempre visíveis no celular). */
function CartaoDoArquivo({ itensNoCarrossel, onAbrir, formatDate, ...acoes }: ItemDoArquivoProps) {
  const { file } = acoes;
  const [menuAberto, setMenuAberto] = useState(false);
  const revisao = agencyBadge[file.agency_approval_status] || agencyBadge.not_requested;
  // A raiz das reclamações: upload nasce interno e o cliente NÃO vê. Fica na cara.
  const visibilidade = seloDeVisibilidade(file);
  return (
    <div className="group relative min-w-0">
      <button
        type="button"
        onClick={onAbrir}
        className="block w-full min-w-0 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        title={`${file.file_name} · ${kindLabel(resolveKind(file))} · ${file.project?.name || "Sem projeto"}`}
      >
        <span className="relative block overflow-hidden rounded-md" style={{ paddingBottom: "100%" }}>
          <FileThumb file={file} />
          <span className={juntar(etiqueta, "absolute bottom-1.5 left-1.5 bg-background/90", visibilidade.cor)}>{visibilidade.label}</span>
          {itensNoCarrossel > 1 && (
            <span className={juntar(etiqueta, "absolute left-1.5 top-1.5 bg-background/90 text-primary")} title="Imagens no carrossel">{itensNoCarrossel}</span>
          )}
        </span>
        <span className="mt-2 flex min-w-0 items-baseline">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{file.file_name}</span>
          {file.version > 1 && <span className="ml-1 shrink-0 text-[11px] tabular-nums text-muted-foreground">v{file.version}</span>}
        </span>
        <span className={juntar(texto.auxiliar, "block truncate")}>
          {revisao.label} · {formatDate(file.created_at)}
        </span>
      </button>
      <div
        className={juntar(
          "absolute right-1.5 top-1.5 transition-opacity",
          menuAberto ? "opacity-100" : "opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100",
        )}
      >
        <AcoesDoArquivo {...acoes} sobreImagem onMenu={setMenuAberto} />
      </div>
    </div>
  );
}

/** Linha da lista: miniatura pequena, nome, uma linha de estado e as ações à direita. */
function LinhaDoArquivo({ itensNoCarrossel, onAbrir, formatDate, ...acoes }: ItemDoArquivoProps) {
  const { file } = acoes;
  const revisao = agencyBadge[file.agency_approval_status] || agencyBadge.not_requested;
  const visibilidade = seloDeVisibilidade(file);
  return (
    <li className="flex min-w-0 items-center py-2">
      <button
        type="button"
        onClick={onAbrir}
        className="flex min-w-0 flex-1 items-center rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="relative mr-3 block h-12 w-12 shrink-0 overflow-hidden rounded-md">
          <FileThumb file={file} compacto />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline">
            <span className="min-w-0 truncate text-[13px] font-medium text-foreground">{file.file_name}</span>
            {file.version > 1 && <span className="ml-1 shrink-0 text-[11px] tabular-nums text-muted-foreground">v{file.version}</span>}
            {itensNoCarrossel > 1 && <span className={juntar(etiqueta, "ml-1.5 bg-primary/10 text-primary")}>{itensNoCarrossel}</span>}
          </span>
          <span className={juntar(texto.auxiliar, "block truncate")}>
            {kindLabel(resolveKind(file))} · {file.project?.name || "Sem projeto"} · {formatDate(file.created_at)}
            {file.uploader?.full_name ? ` · ${file.uploader.full_name}` : ""}
          </span>
        </span>
        <span className={juntar(etiqueta, "ml-2 hidden md:inline-flex", revisao.cls)}>{revisao.label}</span>
        <span className={juntar(etiqueta, "ml-2", visibilidade.fundo, visibilidade.cor, file.visibility === "internal" ? "" : "hidden sm:inline-flex")}>
          {visibilidade.label}
        </span>
      </button>
      <div className="ml-1">
        <AcoesDoArquivo {...acoes} />
      </div>
    </li>
  );
}

/** Select do shadcn que aceita o id/aria do CampoDeFormulario (o rótulo aponta para o gatilho). */
function SelectDeCampo({
  value,
  onValueChange,
  placeholder,
  children,
  id,
  "aria-describedby": descrito,
  "aria-invalid": invalido,
}: {
  value: string;
  onValueChange: (v: string) => void;
  placeholder?: string;
  children: React.ReactNode;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger id={id} aria-describedby={descrito} aria-invalid={invalido} className="h-9 rounded-md text-[13px]">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}

export default function AdminFiles() {
  const { user, profile, loading: loadingAuth } = useAuth();
  const isStaff = profile?.role === "admin"
    || ["design", "traffic", "manager"].includes(profile?.role || "");
  const canReviewAndRelease = profile?.role === "admin" || profile?.role === "manager";
  // O administrador apaga qualquer arquivo, travado ou nao: a trava e da
  // equipe, nao do dono da casa. O banco aplica a mesma regra.
  const isAdmin = profile?.role === "admin";
  const { data: clients, isLoading: loadingClients } = useClients();
  const { data: projects, isLoading: loadingProjects } = useProjects();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedClientId = searchParams.get("client");
  const {
    data: allFiles,
    isLoading: loadingFiles,
    isError: filesReadFailed,
    error: filesReadError,
    refetch: refetchFiles,
    isFetching: refreshingFiles,
    // Cliente escolhido vai para o banco; "Todos" traz so os mais recentes.
  } = useAllFiles(requestedClientId || undefined);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const requestedFolderId = searchParams.get("folder");
  const requestedRevisionId = searchParams.get("revisionOf");
  const requestedModeParam = searchParams.get("mode");
  const requestedUploadMode = parseUploadMode(requestedModeParam);
  const requestedProjectId = searchParams.get("project");
  const shouldOpenNewContent = searchParams.get("novo") === "1";
  const initialFolder = requestedFolderId && FOLDER_IDS.has(requestedFolderId)
    ? requestedFolderId
    : "estrategicos";

  const selectedClient = requestedClientId || "all";
  const activeFolder = requestedFolderId && FOLDER_IDS.has(requestedFolderId)
    ? requestedFolderId
    : "estrategicos";
  // Visualização, filtros e busca ficam guardados (sair e voltar mantém).
  const [viewMode, setViewMode] = useEstadoDaTela<"grid" | "list">("arquivos:visualizacao", "grid", {
    validar: (v) => v === "grid" || v === "list",
  });
  const [activeKind, setActiveKind] = useEstadoDaTela<FileKindId | null>("arquivos:tipo", null, {
    validar: (v) => v === null || (typeof v === "string" && (FILE_TYPES as string[]).indexOf(v) >= 0),
  });
  const [statusFilter, setStatusFilter] = useEstadoDaTela<FiltroDeStatus>("arquivos:status", "todos", {
    validar: (v) => typeof v === "string" && STATUS_IDS.has(v),
  });
  const [search, setSearch] = useEstadoDaTela<string>("arquivos:busca", "");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initializedRevisionRef = useRef<string | null>(null);
  const uploadAttemptRef = useRef<{
    fingerprint: string;
    batchId: string;
    fileIds: string[];
  } | null>(null);

  // Upload form state
  const [uploadMode, setUploadMode] = useState<UploadMode>("single");
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadName, setUploadName] = useState("");
  const [uploadFolder, setUploadFolder] = useState(initialFolder);
  const [uploadProject, setUploadProject] = useState("");
  const [uploadType, setUploadType] = useState<string>(
    folderDefinition(initialFolder).defaultKind,
  );
  const [uploadPostSaveAction, setUploadPostSaveAction] = useState<UploadPostSaveAction>("draft");
  const [uploadCaption, setUploadCaption] = useState("");
  const [uploadCarousel, setUploadCarousel] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadVideoUrl, setUploadVideoUrl] = useState("");
  const [previewFile, setPreviewFile] = useState<any>(null);
  // Uma acao por vez no rodape do preview: com os botoes livres durante a
  // chamada, o segundo clique disparava revisao e liberacao em cima da mesma
  // peca e o banco recusava a segunda com estado confuso na tela.
  const [acting, setActing] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");
  const revisionSource = requestedRevisionId
    ? (allFiles || []).find((file: any) => file.id === requestedRevisionId) || null
    : null;
  const revisionVersion = revisionSource ? Number(revisionSource.version || 1) + 1 : 1;

  // Cliente escolhido e pasta atual moram no endereço (links de revisão e de
  // "novo conteúdo" dependem disso). Aqui eles também ficam guardados: abrir
  // /arquivos sem nada no endereço volta para o último cliente e pasta.
  const guardadosAoAbrir = useRef<{ cliente: string; pasta: string } | null>(null);
  if (guardadosAoAbrir.current === null) {
    guardadosAoAbrir.current = {
      cliente: lerEstadoDaTela<string>("arquivos:cliente", "all", (v) => typeof v === "string" && v.length > 0),
      pasta: lerEstadoDaTela<string>("arquivos:pasta", "", (v) => typeof v === "string" && FOLDER_IDS.has(v)),
    };
  }
  const [, setClienteGuardado] = useEstadoDaTela<string>("arquivos:cliente", "all");
  const [, setPastaGuardada] = useEstadoDaTela<string>("arquivos:pasta", "");
  const restaurouRef = useRef(false);
  useEffect(() => {
    if (restaurouRef.current) return;
    restaurouRef.current = true;
    const guardado = guardadosAoAbrir.current;
    if (!guardado) return;
    // Link com destino (novo conteúdo, correção) manda: nada é restaurado.
    if (searchParams.get("novo") || searchParams.get("revisionOf")) return;
    const next = new URLSearchParams(searchParams);
    let mudou = false;
    if (!searchParams.get("client") && guardado.cliente && guardado.cliente !== "all") {
      next.set("client", guardado.cliente);
      mudou = true;
    }
    if (!searchParams.get("folder") && guardado.pasta) {
      next.set("folder", guardado.pasta);
      mudou = true;
    }
    if (mudou) setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!restaurouRef.current) return;
    setClienteGuardado(selectedClient);
  }, [selectedClient, setClienteGuardado]);
  useEffect(() => {
    if (!restaurouRef.current) return;
    setPastaGuardada(activeFolder);
  }, [activeFolder, setPastaGuardada]);

  const invalidateFileViews = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["all-files"] }),
    queryClient.invalidateQueries({ queryKey: ["files"] }),
    queryClient.invalidateQueries({ queryKey: ["workspace-client-files"] }),
  ]);

  // Envolve os botoes de acao do preview: trava enquanto a chamada roda e
  // solta no fim, com ou sem erro (cada handler ja trata o proprio toast).
  const runActing = async (action: () => Promise<void>) => {
    if (acting) return;
    setActing(true);
    try {
      await action();
    } finally {
      setActing(false);
    }
  };

  useEffect(() => {
    if (!isStaff || !clients) return;

    if (requestedClientId) {
      const clientExists = clients.some((client: any) => client.id === requestedClientId);
      if (!clientExists) {
        const next = clearUploadLaunchParams(new URLSearchParams(searchParams));
        next.delete("client");
        setSearchParams(next, { replace: true });
        toast({
          title: "Cliente não encontrado",
          description: "Escolha um cliente existente antes de criar a entrega.",
          variant: "destructive",
        });
        return;
      }
    }

    // Never turn a read failure into an unlinked revision. Keep the URL and
    // wait for the explicit retry in the error state.
    if (requestedRevisionId && (loadingFiles || filesReadFailed)) return;

    if (requestedRevisionId && !loadingFiles) {
      const source = (allFiles || []).find((file: any) => file.id === requestedRevisionId);
      if (!source || source.client_id !== requestedClientId) {
        const next = new URLSearchParams(searchParams);
        next.delete("novo");
        next.delete("mode");
        next.delete("project");
        next.delete("revisionOf");
        setUploadOpen(false);
        setSearchParams(next, { replace: true });
        toast({
          title: "Versão anterior não encontrada",
          description: "Atualize Arquivos e abra a correção novamente para preservar o histórico.",
          variant: "destructive",
        });
        return;
      }
    }

    if (
      shouldOpenNewContent
      && !requestedRevisionId
      && requestedProjectId
      && loadingProjects
    ) {
      return;
    }

    if (shouldOpenNewContent && requestedClientId) {
      // A pasta da URL so entra no formulario na ABERTURA. Antes era aplicada
      // fora deste bloco, em todo refetch de arquivos, e desfazia a pasta que
      // a pessoa tinha acabado de escolher no formulario aberto.
      if (requestedFolderId && FOLDER_IDS.has(requestedFolderId)) {
        setUploadFolder(requestedFolderId);
      } else {
        setUploadFolder(activeFolder);
      }
      if (revisionSource && initializedRevisionRef.current !== revisionSource.id) {
        const sourceChildren = (allFiles || []).filter((file: any) => file.parent_file_id === revisionSource.id);
        setUploadMode(isCarouselAssetGroup(revisionSource, sourceChildren) ? "carousel" : "single");
        setUploadName(revisionSource.file_name || "");
        setUploadFolder(revisionSource.folder || activeFolder);
        setUploadProject(revisionSource.project_id || "none");
        setUploadType(revisionSource.file_type || "criativo");
        setUploadCaption(revisionSource.caption || "");
        setUploadCarousel(revisionSource.carousel_text || "");
        setUploadDescription(revisionSource.description || "");
        initializedRevisionRef.current = revisionSource.id;
      } else if (!revisionSource) {
        const requestedProject = requestedProjectId
          ? (projects || []).find(
              (project) =>
                project.id === requestedProjectId
                && project.client_id === requestedClientId,
            )
          : null;
        setUploadMode(requestedUploadMode || "single");
        setUploadProject(requestedProject?.id || "");
      }
      setUploadOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete("novo");
      if (requestedModeParam && !requestedUploadMode) {
        next.delete("mode");
      }
      if (
        !revisionSource
        && requestedProjectId
        && !(projects || []).some(
          (project) =>
            project.id === requestedProjectId
            && project.client_id === requestedClientId,
        )
      ) {
        next.delete("project");
      }
      setSearchParams(next, { replace: true });
    }
  }, [
    clients,
    allFiles,
    loadingFiles,
    filesReadFailed,
    requestedClientId,
    requestedFolderId,
    requestedModeParam,
    requestedProjectId,
    requestedRevisionId,
    requestedUploadMode,
    revisionSource,
    searchParams,
    setSearchParams,
    shouldOpenNewContent,
    toast,
    activeFolder,
    isStaff,
    loadingProjects,
    projects,
  ]);

  const handleClientChange = (clientId: string) => {
    const next = new URLSearchParams(searchParams);
    if (clientId === "all") {
      next.delete("client");
    } else {
      next.set("client", clientId);
    }
    clearUploadLaunchParams(next);
    setSearchParams(next, { replace: true });
  };

  const handleFolderChange = (folderId: string) => {
    setActiveKind(null);
    const next = new URLSearchParams(searchParams);
    next.set("folder", folderId);
    setSearchParams(next, { replace: true });
  };

  /**
   * Renomear é mudar o RÓTULO, não o material.
   *
   * A trava era `isEditableFile`, a mesma de editar conteúdo: exigia arquivo
   * interno, sem aprovação e sem revisão. O efeito prático era que todo
   * arquivo já compartilhado ficava preso ao nome com que subiu — em geral o
   * do celular, "IMG_20260819.jpg" —, e a lista inteira parecia genérica sem
   * jeito de arrumar.
   *
   * O que a aprovação protege é o CONTEÚDO: caminho no storage, versão,
   * decisão registrada. Nada disso muda ao trocar o nome exibido. Continua
   * bloqueado o arquivo travado (`locked_at`), porque aí a peça é imutável de
   * propósito.
   */
  const handleRename = async () => {
    if (!previewFile || !editNameValue.trim()) return;
    if (previewFile.locked_at) {
      toast({
        title: "Arquivo travado",
        description: "Esta peça está travada e não aceita mudanças, nem de nome.",
        variant: "destructive",
      });
      return;
    }
    try {
      // Pela função dedicada, e não pelo UPDATE direto: a política de escrita
      // da tabela exige arquivo intocado, então o update falharia justamente
      // nos arquivos que mais precisam de nome decente.
      const { data, error } = await (supabase as any).rpc("rename_file", {
        _file_id: previewFile.id,
        _new_name: editNameValue.trim(),
      });
      if (error) throw error;
      if (!data) throw new Error("O arquivo não foi alterado.");
      void invalidateFileViews();
      setPreviewFile({ ...previewFile, file_name: editNameValue.trim() });
      setEditingName(false);
      toast({ title: "Nome atualizado" });
    } catch (e: any) {
      toast({
        title: "Erro ao renomear",
        description: e?.message || "Tente novamente.",
        variant: "destructive",
      });
    }
  };

  const handleMoveFolder = async (fileId: string, newFolder: string) => {
    /* Mover de pasta é organizar a gaveta, não mexer no material — vale para
       qualquer arquivo, em revisão ou liberado. O update direto era barrado
       pela política de escrita (que exige arquivo intocado), então a mudança
       passa pela função dedicada, com a régua própria dela. */
    try {
      const { data, error } = await (supabase as any).rpc("move_file", {
        _file_id: fileId,
        _folder: newFolder,
      });
      if (error) throw error;
      if (!data) throw new Error("Nenhum arquivo foi alterado.");
      void invalidateFileViews();
      if (previewFile?.id === fileId) {
        setPreviewFile((prev: any) => prev ? { ...prev, folder: newFolder } : null);
      }
      const folderLabel = FOLDERS.find(f => f.id === newFolder)?.label || newFolder;
      toast({ title: `Movido para ${folderLabel}` });
    } catch (e: any) {
      toast({
        title: "Erro ao mover arquivo",
        description: e?.message || "Tente novamente.",
        variant: "destructive",
      });
    }
  };

  const isImage = (name: string) => {
    const ext = name?.split(".").pop()?.toLowerCase() || "";
    return ["jpg", "jpeg", "png", "gif", "webp"].includes(ext);
  };
  const isPdf = (name: string) => name?.toLowerCase().endsWith(".pdf");
  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

  // Build carousel children map
  const childrenMap = new Map<string, any[]>();
  (allFiles || []).forEach((f: any) => {
    if (f.parent_file_id) {
      const arr = childrenMap.get(f.parent_file_id) || [];
      arr.push(f);
      childrenMap.set(f.parent_file_id, arr);
    }
  });

  // Tudo do cliente selecionado, antes de escolher a pasta: é sobre esta base
  // que as contagens das abas são feitas, para o número bater com a tela.
  // O recorte por cliente ja veio do banco (useAllFiles); a checagem abaixo
  // so protege a troca de cliente enquanto o cache anterior ainda esta na tela.
  const scopedFiles = (allFiles || []).filter((f: any) => {
    if (f.parent_file_id) return false; // filho de carrossel aparece junto do pai
    if (selectedClient !== "all" && f.client_id !== selectedClient) return false;
    return true;
  });

  const folderSummaries = summarizeFiles(scopedFiles);
  const activeSummary = folderSummaries.find((entry) => entry.folder.id === activeFolder) || null;
  const kindChips = activeSummary && activeSummary.byKind.length > 1 ? activeSummary.byKind : [];
  const searchTerm = search.trim().toLowerCase();
  // Tipo guardado que não existe nesta pasta (ou nos dados de agora) não filtra nada.
  const kindEfetivo = activeKind && kindChips.some((entry) => entry.kind.id === activeKind) ? activeKind : null;
  const folderFiles = scopedFiles.filter((f: any) => matchesFolderFilter(f, activeFolder as FolderId, kindEfetivo));
  const statusCounts = FILTROS_DE_STATUS.reduce<Record<string, number>>((acc, filtro) => {
    acc[filtro.valor] = folderFiles.filter((f: any) => bateStatus(f, filtro.valor)).length;
    return acc;
  }, {});
  const filtrosAtivos = !!searchTerm || !!kindEfetivo || statusFilter !== "todos";
  const limparFiltros = () => {
    setSearch("");
    setActiveKind(null);
    setStatusFilter("todos");
  };

  const filteredFiles = scopedFiles.filter((f: any) => {
    if (!matchesFolderFilter(f, activeFolder as FolderId, kindEfetivo)) return false;
    if (!bateStatus(f, statusFilter)) return false;
    if (!searchTerm) return true;
    return [f.file_name, f.description, f.caption, f.project?.name, f.client?.company_name]
      .filter(Boolean)
      .some((value: string) => String(value).toLowerCase().includes(searchTerm));
  });

  const handleFilesSelect = (newFiles: File[]) => {
    const valid: File[] = [];
    for (const file of newFiles) {
      if (file.size > MAX_SIZE) {
        toast({ title: "Arquivo muito grande", description: `${file.name} excede 100 MB.`, variant: "destructive" });
        continue;
      }
      if (uploadMode === "carousel" && mediaKindFromFile(file.name, undefined, file.type) !== "image") {
        toast({ title: "Formato não aceito", description: `${file.name} não é uma imagem para carrossel.`, variant: "destructive" });
        continue;
      }
      valid.push(file);
    }
    if (valid.length === 0) return;
    if (uploadMode === "single") {
      setUploadFiles([valid[0]]);
      setUploadName(valid[0].name);
    } else {
      setUploadFiles(prev => [...prev, ...valid]);
      if (uploadFiles.length === 0 && valid.length > 0) {
        setUploadName(valid[0].name);
      }
    }
    setUploadFolder(activeFolder);
  };

  const removeUploadFile = (index: number) => {
    setUploadFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) handleFilesSelect(files);
  };

  const handleRequestAgencyReview = async (file: any) => {
    if (!isEditableFile(file)) {
      toast({
        title: "Revisão indisponível",
        description: "Esta versão já entrou em revisão ou foi finalizada.",
        variant: "destructive",
      });
      return;
    }
    try {
      await requestFileAgencyReview(file.id);
      await invalidateFileViews();
      setPreviewFile((current: any) => current?.id === file.id
        ? { ...current, agency_approval_status: "pending" }
        : current);
      toast({
        title: "Enviado para revisão interna",
        description: "O cliente continua sem acesso até a liberação.",
      });
    } catch (error: any) {
      toast({
        title: "Não foi possível solicitar a revisão",
        description: error?.message || "Tente novamente.",
        variant: "destructive",
      });
    }
  };

  const handleAgencyApproval = async (file: any) => {
    if (!canReviewAndRelease || !file?.id) return;
    try {
      await reviewFileAgency(file.id, "approved");
      await invalidateFileViews();
      setPreviewFile((current: any) => current?.id === file.id
        ? {
          ...current,
          agency_approval_status: "approved",
          agency_feedback: null,
          agency_reviewed_by: user?.id || current.agency_reviewed_by,
          agency_reviewed_at: new Date().toISOString(),
        }
        : current);
      toast({ title: "Revisão interna aprovada" });
    } catch (error: any) {
      toast({
        title: "Não foi possível aprovar internamente",
        description: error?.message || "Tente novamente.",
        variant: "destructive",
      });
    }
  };

  const handleReleaseToClient = async (file: any, mode: FileReleaseMode) => {
    if (!canReviewAndRelease || !file?.id) return;
    try {
      const { error: releaseError } = await (supabase as any).rpc(
        "admin_release_file_now",
        { p_file_id: file.id, p_mode: mode },
      );
      if (releaseError) throw releaseError;
      await Promise.all([
        invalidateFileViews(),
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      ]);
      setPreviewFile(null);
      toast({
        title: mode === "approval" ? "Enviado para aprovação do cliente" : "Disponibilizado ao cliente",
        description: mode === "approval"
          ? "O cliente recebeu a entrega para decidir no painel."
          : "O cliente recebeu a entrega sem etapa de aprovação final.",
      });
    } catch (error: any) {
      toast({
        title: "Não foi possível liberar ao cliente",
        description: error?.message || "Tente novamente.",
        variant: "destructive",
      });
    }
  };

  const handleDirectReleaseToClient = async (file: any, mode: FileReleaseMode) => {
    if (!canReviewAndRelease || !file?.id) return;
    if (!isEditableFile(file)) {
      toast({
        title: "Liberação indisponível",
        description: "Use a fila de aprovações para versões que já entraram em revisão.",
        variant: "destructive",
      });
      return;
    }
    try {
      // Uma RPC atomica faz revisao interna + liberacao na mesma transacao:
      // fim dos erros de estado entre passos separados.
      const { error: releaseError } = await (supabase as any).rpc(
        "admin_release_file_now",
        { p_file_id: file.id, p_mode: mode },
      );
      if (releaseError) throw releaseError;
      await Promise.all([
        invalidateFileViews(),
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      ]);
      setPreviewFile(null);
      toast({
        title: mode === "approval" ? "Enviado para aprovação do cliente" : "Disponibilizado ao cliente",
        description: "A revisão interna foi registrada pelo admin antes da liberação.",
      });
    } catch (error: any) {
      toast({
        title: "Não foi possível concluir a liberação",
        description: error?.message || "Tente novamente.",
        variant: "destructive",
      });
    }
  };

  const applyPostSaveAction = async (fileId: string): Promise<UploadPostSaveAction> => {
    if (uploadPostSaveAction === "draft") return "draft";
    // Quando a revisao interna ja foi registrada e so a liberacao falhou, o
    // estado real e "em revisao interna", nao rascunho: o aviso tem de bater
    // com o banco, senao a pessoa procura o conteudo na fila errada.
    let reviewRequested = false;
    try {
      await requestFileAgencyReview(fileId);
      reviewRequested = true;
      if (uploadPostSaveAction === "internal_review") return "internal_review";
      if (!canReviewAndRelease) {
        throw new Error("Somente admin ou manager pode liberar conteúdo ao cliente.");
      }
      const { error: releaseError } = await (supabase as any).rpc(
        "admin_release_file_now",
        { p_file_id: fileId, p_mode: uploadPostSaveAction },
      );
      if (releaseError) throw releaseError;
      return uploadPostSaveAction;
    } catch (error: any) {
      toast({
        title: reviewRequested
          ? "Conteúdo em revisão interna, mas a liberação falhou"
          : "Conteúdo salvo, mas a etapa final falhou",
        description: error?.message || "Abra o conteúdo e conclua a liberação manualmente.",
        variant: "destructive",
      });
      return reviewRequested ? "internal_review" : "draft";
    }
  };

  const postSaveTitle = (action: UploadPostSaveAction, isCarousel?: boolean, totalFiles?: number) => {
    if (action === "approval") return "Conteúdo enviado para aprovação do cliente";
    if (action === "client_shared") return "Conteúdo disponibilizado ao cliente";
    if (action === "internal_review") return "Conteúdo enviado para revisão interna";
    if (isCarousel) return `Carrossel salvo internamente (${totalFiles || 0} arquivos)`;
    return "Conteúdo salvo internamente";
  };

  const postSaveDescription = (action: UploadPostSaveAction) => {
    if (action === "approval") return "O cliente já pode aprovar ou pedir ajustes no painel.";
    if (action === "client_shared") return "O cliente já pode visualizar a entrega, sem aprovação final.";
    if (action === "internal_review") return "A entrega entrou na fila interna antes de ir ao cliente.";
    return "O cliente ainda não recebeu esta versão.";
  };

  const ensureUploadAttempt = (totalFiles: number) => {
    const fingerprint = JSON.stringify({
      clientId: selectedClient,
      revisionId: revisionSource?.id || null,
      mode: uploadMode,
      videoUrl: uploadMode === "video_link" ? uploadVideoUrl.trim() : null,
      name: uploadName,
      folder: uploadFolder,
      project: uploadProject,
      type: uploadType,
      postSaveAction: uploadPostSaveAction,
      caption: uploadCaption,
      carousel: uploadCarousel,
      description: uploadDescription,
      files: uploadFiles.map((file) => ({
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
      })),
    });
    if (
      uploadAttemptRef.current?.fingerprint === fingerprint
      && uploadAttemptRef.current.fileIds.length === totalFiles
    ) {
      return uploadAttemptRef.current;
    }
    if (uploadAttemptRef.current) {
      throw new Error(
        "Este envio já foi iniciado. Para evitar duplicação, mantenha os mesmos arquivos e informações ao tentar novamente.",
      );
    }
    const attempt = {
      fingerprint,
      batchId: crypto.randomUUID(),
      fileIds: Array.from({ length: totalFiles }, () => crypto.randomUUID()),
    };
    uploadAttemptRef.current = attempt;
    return attempt;
  };

  const handleUpload = async () => {
    if (!isStaff) {
      toast({
        title: "Acesso restrito",
        description: "Somente a equipe da Aceleriq pode criar entregas por esta tela.",
        variant: "destructive",
      });
      return;
    }
    if (requestedRevisionId && !revisionSource) {
      toast({
        title: "Versão anterior ainda não carregada",
        description:
          "Atualize Arquivos antes de enviar a correção para preservar o vínculo e o histórico.",
        variant: "destructive",
      });
      return;
    }
    if (!user || !selectedClient || selectedClient === "all") {
      toast({ title: "Selecione um cliente", variant: "destructive" });
      return;
    }
    if (uploadMode === "video_link") {
      if (!uploadVideoUrl.trim()) {
        toast({ title: "Cole a URL do vídeo", variant: "destructive" });
        return;
      }
      try {
        new URL(uploadVideoUrl.trim());
      } catch {
        toast({ title: "URL inválida", variant: "destructive" });
        return;
      }
    } else if (uploadFiles.length === 0) {
      toast({ title: "Selecione ao menos um arquivo", variant: "destructive" });
      return;
    }
    setUploading(true);
    setUploadProgress(5);

    // Fora do try para o catch saber se ficou um carrossel pela metade: raiz
    // criada e lote nao concluido e o que precisa ser desfeito.
    let rootFileId: string | null = null;
    let batchComplete = false;

    try {
      // Garante que a sessão está fresca antes de inserir — evita RLS por JWT expirado.
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr || !authData?.user?.id) {
        throw new Error("Sua sessão expirou. Faça login novamente para enviar arquivos.");
      }
      const authUid = authData.user.id;
      const uploadAttempt = ensureUploadAttempt(
        uploadMode === "video_link" ? 1 : uploadFiles.length,
      );

      const revisionOfFileId = revisionSource?.client_id === selectedClient ? revisionSource.id : null;
      const nextVersion = revisionOfFileId ? revisionVersion : 1;


      // Links externos também nascem internos e só ficam visíveis após os gates.
      if (uploadMode === "video_link") {
        const url = uploadVideoUrl.trim();
        const displayName = uploadName.trim() || (() => {
          try {
            const u = new URL(url);
            return `Vídeo • ${u.hostname.replace(/^www\./, "")}`;
          } catch { return "Vídeo externo"; }
        })();
        const fileId = uploadAttempt.fileIds[0];
        let inserted;
        try {
          inserted = await createFileRecord({
            id: fileId,
            client_id: selectedClient,
            file_name: displayName,
            file_url: url,
            file_type: "video",
            folder: uploadFolder,
            uploaded_by: authUid,
            project_id: uploadProject === "none" ? null : uploadProject || null,
            approval_status: "none",
            agency_approval_status: "not_requested",
            visibility: "internal",
            requires_approval: false,
            status: "ready",
            version: nextVersion,
            revision_of_file_id: revisionOfFileId,
            caption: uploadCaption.trim() || null,
            description: uploadDescription.trim() || null,
            idempotency_key: `admin-files-upload:${uploadAttempt.batchId}:0`,
          });
        } catch (insertError) {
          const recovered = await recoverFailedFileRecordById({
            fileId,
            clientId: selectedClient,
            fileUrl: url,
          });
          if (!recovered) throw insertError;
          inserted = recovered;
        }
        rootFileId = inserted?.id || fileId;
        batchComplete = true;
        await invalidateFileViews();
        const completedAction = await applyPostSaveAction(rootFileId);
        setUploadProgress(100);
        void invalidateFileViews();
        queryClient.invalidateQueries({ queryKey: ["notifications"] });
        toast({
          title: postSaveTitle(completedAction),
          description: postSaveDescription(completedAction),
        });
        setUploadOpen(false);
        resetUploadForm();
        const next = clearUploadLaunchParams(new URLSearchParams(searchParams));
        next.delete("revisionOf");
        setSearchParams(next, { replace: true });
        setUploading(false);
        return;
      }

      const totalFiles = uploadFiles.length;
      const carouselSafe = uploadFiles.every((file) => mediaKindFromFile(file.name, undefined, file.type) === "image");
      const isCarousel = uploadMode === "carousel" && totalFiles > 1 && carouselSafe;
      // For carousel: first file gets the main record, others are linked via parent_file_id
      let parentFileId: string | null = null;

      for (let i = 0; i < totalFiles; i++) {
        const file = uploadFiles[i];
        const ext = file.name.split(".").pop();
        const fileId = uploadAttempt.fileIds[i];
        const groupId = parentFileId || fileId;
        const path = `${selectedClient}/${groupId}/v${nextVersion}/${i + 1}-${storageSafeName(file.name)}`;

        const { error: storageError } = await supabase.storage.from("files").upload(path, file);
        if (storageError) {
          const objectState = await confirmStoredObject("files", path);
          if (objectState === "missing") throw storageError;
          if (objectState === "unknown") {
            throw new Error(
              "O envio perdeu a confirmação; o objeto foi preservado e precisa ser conferido antes de tentar novamente.",
            );
          }
        }
        gravarCopiasSemEsperar("files", path, file, { nome: file.name, mime: file.type });

        const fileName = i === 0
          ? (uploadName || file.name)
          : (isCarousel ? `${uploadName || uploadFiles[0].name} (${i + 1}/${totalFiles})` : file.name);

        let inserted;
        try {
          inserted = await createFileRecord({
            id: fileId,
            client_id: selectedClient,
            file_name: fileName,
            file_url: `files://${path}`,
            file_type: isCarousel ? "carrossel" : uploadType,
            mime_type: file.type || null,
            extension: ext || null,
            storage_bucket: "files",
            storage_path: path,
            folder: uploadFolder,
            uploaded_by: authUid,
            project_id: uploadProject === "none" ? null : uploadProject || null,
            approval_status: "none",
            agency_approval_status: "not_requested",
            visibility: "internal",
            requires_approval: false,
            status: "ready",
            version: nextVersion,
            revision_of_file_id: i === 0 ? revisionOfFileId : null,
            caption: i === 0 ? (uploadCaption.trim() || null) : null,
            carousel_text: i === 0 ? (uploadCarousel.trim() || null) : null,
            description: i === 0 ? (uploadDescription.trim() || null) : null,
            parent_file_id: isCarousel && i > 0 ? parentFileId : null,
            idempotency_key: `admin-files-upload:${uploadAttempt.batchId}:${i}`,
          });
        } catch (insertError: any) {
          const recovered = await recoverOrCleanupFailedFileRecord({
            fileId,
            storagePath: path,
          });
          if (!recovered) throw insertError;
          inserted = recovered;
        }

        if (i === 0 && inserted) {
          parentFileId = inserted.id;
          rootFileId = inserted.id;
        }

        setUploadProgress(Math.round(((i + 1) / totalFiles) * 85) + 10);
      }
      batchComplete = true;

      if (!rootFileId) throw new Error("Não foi possível identificar a entrega criada.");
      await invalidateFileViews();
      const completedAction = await applyPostSaveAction(rootFileId);

      // Notificação estritamente interna. O cliente só é avisado pelo RPC de liberação.
      const { data: adminId, error: adminIdError } = await supabase.rpc("get_admin_user_id");
      if (adminIdError) {
        toast({
          title: "Conteúdo salvo, mas o aviso interno falhou",
          description: adminIdError.message,
          variant: "destructive",
        });
      } else if (adminId && completedAction === "internal_review") {
        const clientProfile = (clients || []).find((c: any) => c.id === selectedClient);
        const clientName = clientProfile?.company_name || clientProfile?.full_name || "cliente";
        const { error: notificationError } = await supabase.from("notifications").insert({
          user_id: adminId,
          message: `${user.email} salvou ${isCarousel ? `carrossel (${totalFiles})` : "conteúdo"} interno: ${uploadName} para ${clientName}`,
          notification_type: "system",
          link: "/aprovacoes",
        });
        if (notificationError) {
          toast({
            title: "Conteúdo salvo, mas o aviso interno falhou",
            description: notificationError.message,
            variant: "destructive",
          });
        }
      }

      setUploadProgress(100);
      void invalidateFileViews();
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast({
        title: postSaveTitle(completedAction, isCarousel, totalFiles),
        description: postSaveDescription(completedAction),
      });
      setUploadOpen(false);
      resetUploadForm();
      const next = clearUploadLaunchParams(new URLSearchParams(searchParams));
      next.delete("revisionOf");
      setSearchParams(next, { replace: true });
    } catch (err: any) {
      // Carrossel pela metade nao pode ficar no banco: a raiz existe mas os
      // slides seguintes falharam. A funcao apaga raiz, filhos e objetos do
      // storage de uma vez; a tentativa seguinte comeca limpa.
      if (rootFileId && !batchComplete) {
        try {
          const { error: cleanupError } = await supabase.functions.invoke("delete-file-assets", {
            body: { target: "files", fileIds: [rootFileId] },
          });
          if (cleanupError) {
            console.warn("Nao foi possivel desfazer o carrossel parcial", cleanupError);
          }
        } catch (cleanupError) {
          console.warn("Nao foi possivel desfazer o carrossel parcial", cleanupError);
        }
        void invalidateFileViews();
      }
      const raw = err?.message || "";
      const friendly = /row-level security|permission denied/i.test(raw)
        ? "O registro do arquivo foi bloqueado pela permissão do banco. Tente novamente; se persistir, chame o suporte técnico."
        : /JWT|sessão/i.test(raw)
          ? "A sessão precisa ser renovada. Saia e entre novamente para continuar."
        : raw || "Não foi possível enviar o arquivo.";
      toast({ title: "Erro no upload", description: friendly, variant: "destructive" });
    }
    setUploading(false);
  };


  const resetUploadForm = () => {
    initializedRevisionRef.current = null;
    uploadAttemptRef.current = null;
    setUploadMode("single");
    setUploadFiles([]);
    setUploadName("");
    setUploadProject("");
    setUploadType("criativo");
    setUploadPostSaveAction("draft");
    setUploadProgress(0);
    setUploadCaption("");
    setUploadCarousel("");
    setUploadDescription("");
    setUploadVideoUrl("");
  };

  const closeUploadForm = () => {
    setUploadOpen(false);
    resetUploadForm();
    const next = new URLSearchParams(searchParams);
    next.delete("novo");
    next.delete("mode");
    next.delete("project");
    next.delete("revisionOf");
    setSearchParams(next, { replace: true });
  };

  const [confirmDeleteFile, setConfirmDeleteFile] = useState<{ id: string; name?: string } | null>(null);
  const [deletingFile, setDeletingFile] = useState(false);

  const handleDelete = async () => {
    if (!confirmDeleteFile || deletingFile) return;
    const target = (allFiles || []).find((file: any) => file.id === confirmDeleteFile.id);
    if (!isEditableFile(target) && !isAdmin) {
      toast({
        title: "Exclusão indisponível",
        description: "O arquivo só pode ser excluído antes de entrar em revisão.",
        variant: "destructive",
      });
      setConfirmDeleteFile(null);
      return;
    }
    setDeletingFile(true);
    try {
      const { data, error } = await supabase.functions.invoke("delete-file-assets", {
        body: { target: "files", fileIds: [confirmDeleteFile.id] },
      });
      if (error) throw new Error(await mensagemDaFuncao(error, "Não foi possível excluir agora."));
      if ((data as any)?.error) throw new Error((data as any).error);
      void invalidateFileViews();
      if (previewFile?.id === confirmDeleteFile.id) setPreviewFile(null);
      toast({ title: "Arquivo excluído" });
      setConfirmDeleteFile(null);
    } catch (e: any) {
      toast({ title: "Erro ao excluir", description: e?.message || "Tente novamente.", variant: "destructive" });
    } finally {
      setDeletingFile(false);
    }
  };

  const clientProjects = (projects || []).filter((p: any) =>
    selectedClient === "all" || p.client_id === selectedClient
  );
  const selectedClientProfile = (clients || []).find((client: any) => client.id === selectedClient);

  // formatDate already defined above

  if (loadingAuth) {
    return <Carregando forma="grade" linhas={8} rotulo="Carregando Arquivos" />;
  }

  if (!isStaff) {
    return <Navigate to="/dashboard" replace />;
  }

  // Enviar pede um cliente escolhido e, em correção, a versão anterior confirmada.
  const envioBloqueado = selectedClient === "all"
    || (!!requestedRevisionId && !revisionSource);
  const abrirEnvio = () => { setUploadFolder(activeFolder); setUploadOpen(true); };
  const dicaDoEnvio = selectedClient === "all"
    ? "Escolha um cliente para enviar"
    : envioBloqueado
      ? "Esperando a versão anterior carregar"
      : "Novo conteúdo";
  const emContratos = activeFolder === "contratos";
  const primeiraCarga = loadingFiles && !allFiles;
  const linkDeAprovacoes = `/aprovacoes?client=${encodeURIComponent(selectedClient)}`;
  const nomeDoCliente = (c: any) => c.company_name || c.full_name;

  const baixarArquivo = async (f: any) => {
    const url = await resolveFileUrl({ fileUrl: f.file_url, storageBucket: f.storage_bucket, storagePath: f.storage_path });
    downloadFile(url, f.file_name);
  };

  const propsDoItem = (f: any) => {
    const carouselChildren = childrenMap.get(f.id) || [];
    const isCarousel = isCarouselAssetGroup(f, carouselChildren);
    const isEditable = isEditableFile(f);
    return {
      file: f,
      itensNoCarrossel: isCarousel ? carouselChildren.length + 1 : 0,
      podeLiberar: canReviewAndRelease && f.visibility === "internal" && isEditable,
      podeMover: isEditable,
      podeExcluir: isEditable || isAdmin,
      onAbrir: () => setPreviewFile(f),
      onLiberar: () => { void handleDirectReleaseToClient(f, "client_shared"); },
      onMover: (pasta: string) => { void handleMoveFolder(f.id, pasta); },
      onBaixar: () => { void baixarArquivo(f); },
      onExcluir: () => setConfirmDeleteFile({ id: f.id, name: f.file_name }),
      formatDate,
    };
  };

  // Uma linha de estado: quantos arquivos a tela mostra agora.
  const estadoDaLista = emContratos || primeiraCarga || !activeSummary
    ? undefined
    : filtrosAtivos
      ? `${filteredFiles.length} de ${activeSummary.total} arquivos`
      : `${filteredFiles.length} ${filteredFiles.length === 1 ? "arquivo" : "arquivos"}`;

  const tentarDeNovo = (
    <button type="button" className={botao.secundario} onClick={() => void refetchFiles()} disabled={refreshingFiles}>
      Tentar de novo
    </button>
  );

  const acoesDoTopo = (
    <>
      {selectedClientProfile && (
        <Link to={linkDeAprovacoes} className={juntar(botao.secundario, "hidden sm:inline-flex")}>
          Aprovações
        </Link>
      )}
      {selectedClientProfile && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={juntar(botao.icone, "sm:hidden")} aria-label="Mais ações">
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link to={linkDeAprovacoes}>Acompanhar aprovações</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {!emContratos && (
        <>
          <button
            type="button"
            onClick={abrirEnvio}
            disabled={envioBloqueado}
            title={dicaDoEnvio}
            className={juntar(botao.primario, "hidden sm:inline-flex")}
          >
            <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Novo conteúdo
          </button>
          <button
            type="button"
            onClick={abrirEnvio}
            disabled={envioBloqueado}
            aria-label={dicaDoEnvio}
            title={dicaDoEnvio}
            className={juntar(botao.primario, "w-9 px-0 sm:hidden")}
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
          </button>
        </>
      )}
    </>
  );

  return (
    <div className="min-w-0 space-y-4">
      <CabecalhoDePagina
        titulo="Arquivos"
        descricao={estadoDaLista}
        ajuda="Entregas, legendas e materiais de cada cliente, por pasta. Tudo nasce interno: o cliente só vê depois de liberado."
        acoes={acoesDoTopo}
      />

      {/* Filtros numa barra só: cliente, pasta, tipo, status, busca e visualização. */}
      <div className="-m-1 flex min-w-0 flex-wrap items-center [&>*]:m-1" role="group" aria-label="Filtros de arquivos">
        <SeletorCompacto
          modo="lista"
          rotulo="Cliente"
          icone={<Users className="h-3.5 w-3.5" />}
          className="max-w-[220px]"
          valor={selectedClient}
          onEscolher={handleClientChange}
          opcoes={[
            { valor: "all", rotulo: "Todos os clientes" },
            ...(clients || []).map((c: any) => ({ valor: c.id, rotulo: nomeDoCliente(c) })),
          ]}
        />
        <SeletorCompacto
          modo="lista"
          rotulo="Pasta"
          icone={<Folder className="h-3.5 w-3.5" />}
          className="max-w-[240px]"
          valor={activeFolder}
          onEscolher={handleFolderChange}
          opcoes={folderSummaries.map((entry) => ({
            valor: entry.folder.id,
            rotulo: entry.folder.label,
            contador: allFiles ? entry.total : null,
            descricao: entry.folder.hint,
          }))}
        />
        {!emContratos && kindChips.length > 0 && (
          <SeletorCompacto
            rotulo="Tipo"
            icone={<Tag className="h-3.5 w-3.5" />}
            valor={kindEfetivo || "todos"}
            onEscolher={(v) => setActiveKind(v === "todos" ? null : (v as FileKindId))}
            opcoes={[
              { valor: "todos", rotulo: "Todos os tipos" },
              ...kindChips.map((entry) => ({ valor: entry.kind.id, rotulo: entry.kind.label, contador: entry.total })),
            ]}
          />
        )}
        {!emContratos && (
          <SeletorCompacto
            modo="lista"
            rotulo="Status"
            icone={<CircleDot className="h-3.5 w-3.5" />}
            valor={statusFilter}
            onEscolher={(v) => setStatusFilter(v as FiltroDeStatus)}
            opcoes={FILTROS_DE_STATUS.map((filtro) => ({
              valor: filtro.valor,
              rotulo: filtro.rotulo,
              contador: allFiles ? statusCounts[filtro.valor] : null,
            }))}
          />
        )}
        {!emContratos && (
          <div className="relative w-full min-w-0 sm:w-56">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar pelo nome"
              aria-label="Buscar arquivos"
              className={juntar(campo, "pl-8")}
            />
          </div>
        )}
        {!emContratos && (
          <SeletorCompacto
            rotulo="Visualização"
            valor={viewMode}
            onEscolher={(v) => setViewMode(v === "list" ? "list" : "grid")}
            opcoes={[
              { valor: "grid", rotulo: "Grade", icone: <Grid2X2 className="h-3.5 w-3.5" /> },
              { valor: "list", rotulo: "Lista", icone: <List className="h-3.5 w-3.5" /> },
            ]}
          />
        )}
      </div>

      {emContratos ? (
        selectedClient === "all" ? (
          <EstadoVazio
            icone={<FolderOpen className="h-5 w-5" />}
            titulo="Escolha um cliente"
            descricao="Os contratos aparecem e são enviados por cliente."
          />
        ) : (
          <div className="-mx-4 md:-mx-6">
            <AdminContracts clientId={selectedClient} />
          </div>
        )
      ) : primeiraCarga ? (
        <Carregando forma={viewMode === "list" ? "lista" : "grade"} linhas={viewMode === "list" ? 6 : 8} rotulo="Carregando arquivos" />
      ) : filesReadFailed && !allFiles ? (
        <EstadoDeErro
          titulo="Não foi possível carregar os arquivos."
          descricao={`A pasta não está vazia. Houve uma falha de leitura${filesReadError instanceof Error ? `: ${filesReadError.message}` : "."}`}
          acao={tentarDeNovo}
        />
      ) : (
        <>
          {filesReadFailed && (
            <EstadoDeErro
              titulo="Não foi possível atualizar a lista."
              descricao={`Mostrando a última leitura${filesReadError instanceof Error ? `: ${filesReadError.message}` : "."}`}
              acao={tentarDeNovo}
            />
          )}
          {filteredFiles.length === 0 ? (
            filtrosAtivos ? (
              <EstadoVazio
                icone={<Search className="h-5 w-5" />}
                titulo="Nada com esses filtros"
                descricao="Troque o tipo, o status ou a busca."
                acao={
                  <button type="button" className={botao.secundario} onClick={limparFiltros}>
                    Limpar filtros
                  </button>
                }
              />
            ) : (
              <EstadoVazio
                icone={<FolderOpen className="h-5 w-5" />}
                titulo="Nenhum arquivo nesta pasta"
                descricao={selectedClient === "all" ? "Escolha um cliente para enviar." : undefined}
                acao={
                  envioBloqueado ? undefined : (
                    <button type="button" className={botao.primario} onClick={abrirEnvio}>
                      <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" />
                      Novo conteúdo
                    </button>
                  )
                }
              />
            )
          ) : (
            <RegiaoRolavel memoria="arquivos:lista" rotulo="Lista de arquivos" className="lg:max-h-[70vh]">
              {viewMode === "grid" ? (
                <div className="grid grid-cols-2 gap-x-3 gap-y-4 p-1 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 desk:grid-cols-6">
                  {filteredFiles.map((f: any) => (
                    <CartaoDoArquivo key={f.id} {...propsDoItem(f)} />
                  ))}
                </div>
              ) : (
                <ul className="divide-y divide-border border-y border-border">
                  {filteredFiles.map((f: any) => (
                    <LinhaDoArquivo key={f.id} {...propsDoItem(f)} />
                  ))}
                </ul>
              )}
            </RegiaoRolavel>
          )}
        </>
      )}

      {/* Preview Modal */}
      <Dialog open={!!previewFile} onOpenChange={(o) => { if (!o) { setPreviewFile(null); setEditingName(false); } }}>
        <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col gap-0 p-0">
          <DialogHeader className="shrink-0 space-y-0.5 border-b border-border px-5 py-4 text-left">
            {editingName ? (
              <div className="flex min-w-0 items-center pr-8">
                <Input
                  value={editNameValue}
                  onChange={(e) => setEditNameValue(e.target.value)}
                  aria-label="Novo nome do arquivo"
                  className="h-9 min-w-0 flex-1 rounded-md text-[13px]"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") setEditingName(false); }}
                />
                <button type="button" onClick={handleRename} className={juntar(botao.icone, "ml-1 text-success")} aria-label="Salvar nome"><Check className="h-4 w-4" aria-hidden="true" /></button>
                <button type="button" onClick={() => setEditingName(false)} className={botao.icone} aria-label="Cancelar renomear"><X className="h-4 w-4" aria-hidden="true" /></button>
              </div>
            ) : (
              <div className="flex min-w-0 items-center pr-8">
                <DialogTitle className={juntar(texto.tituloSecao, "min-w-0 truncate")}>{previewFile?.file_name}</DialogTitle>
                {!previewFile?.locked_at && (
                  <button
                    type="button"
                    onClick={() => { setEditNameValue(previewFile?.file_name || ""); setEditingName(true); }}
                    className={juntar(botao.icone, "ml-1")}
                    title="Renomear"
                    aria-label="Renomear"
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            )}
            <DialogDescription className={juntar(texto.auxiliar, "truncate")}>
              Enviado por {previewFile?.uploader?.full_name || "-"}{previewFile?.created_at ? ` · ${formatDate(previewFile.created_at)}` : ""}
            </DialogDescription>
          </DialogHeader>
          {previewFile && (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
              {isCarouselAssetGroup(previewFile, childrenMap.get(previewFile.id) || []) ? (
                <SharedCarouselSlider parent={previewFile} initialChildren={childrenMap.get(previewFile.id) || []} />
              ) : (
                <FilePreviewContent
                  fileName={previewFile.file_name}
                  fileUrl={previewFile.file_url}
                  fileId={previewFile.id}
                  storageBucket={previewFile.storage_bucket}
                  storagePath={previewFile.storage_path}
                  mimeType={previewFile.mime_type || previewFile.file_type}
                  extension={previewFile.extension}
                />
              )}
              <div className="-m-1 flex flex-wrap items-center [&>*]:m-1">
                <span className={juntar(etiqueta, (agencyBadge[previewFile.agency_approval_status] || agencyBadge.not_requested).cls)}>
                  {(agencyBadge[previewFile.agency_approval_status] || agencyBadge.not_requested).label}
                </span>
                <span className={juntar(etiqueta, (approvalBadge[previewFile.approval_status] || approvalBadge.none).cls)}>
                  Cliente: {(approvalBadge[previewFile.approval_status] || approvalBadge.none).label}
                </span>
                <span className={juntar(etiqueta, seloDeVisibilidade(previewFile).fundo, seloDeVisibilidade(previewFile).cor)}>
                  {seloDeVisibilidade(previewFile).label}
                </span>
              </div>
              {previewFile.caption && (
                <div>
                  <p className={juntar(texto.rotulo, "mb-0.5")}>Legenda</p>
                  <p className={juntar(texto.corpo, "whitespace-pre-wrap [overflow-wrap:anywhere]")}>{previewFile.caption}</p>
                </div>
              )}
              {previewFile.carousel_text && (
                <div>
                  <p className={juntar(texto.rotulo, "mb-0.5")}>Texto do carrossel</p>
                  <p className={juntar(texto.corpo, "whitespace-pre-wrap [overflow-wrap:anywhere]")}>{previewFile.carousel_text}</p>
                </div>
              )}
              {previewFile.description && (
                <div>
                  <p className={juntar(texto.rotulo, "mb-0.5")}>Descrição</p>
                  <p className={juntar(texto.corpo, "whitespace-pre-wrap [overflow-wrap:anywhere]")}>{previewFile.description}</p>
                </div>
              )}
              {previewFile.feedback && (
                <div className={juntar(superficie.poco, "border-l-2 border-destructive px-3 py-2")}>
                  <p className={juntar(texto.rotulo, "mb-0.5")}>Feedback do cliente</p>
                  <p className={texto.corpo}>{previewFile.feedback}</p>
                </div>
              )}
              {previewFile.agency_feedback && (
                <div className={juntar(superficie.poco, "border-l-2 border-warning px-3 py-2")}>
                  <p className={juntar(texto.rotulo, "mb-0.5")}>Feedback da revisão interna</p>
                  <p className={texto.corpo}>{previewFile.agency_feedback}</p>
                </div>
              )}
              {/* Mover de pasta e de projeto: organização vale para qualquer
                  arquivo; a trava antiga (só antes da revisão) prendia
                  exatamente os que mais precisavam de arrumação. */}
              <GrupoDeCampos className="border-t border-border pt-4">
                <CampoDeFormulario rotulo="Pasta">
                  <SelectDeCampo
                    value={previewFile.folder || "estrategicos"}
                    onValueChange={(v) => handleMoveFolder(previewFile.id, v)}
                  >
                    {FOLDERS.map(f => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}
                  </SelectDeCampo>
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Projeto">
                  <SelectDeCampo
                    value={previewFile.project_id || ""}
                    placeholder="Escolher projeto"
                    onValueChange={async (v) => {
                      try {
                        const { error } = await (supabase as any).rpc("move_file", {
                          _file_id: previewFile.id,
                          _project_id: v,
                        });
                        if (error) throw error;
                        void invalidateFileViews();
                        setPreviewFile((prev: any) =>
                          prev ? { ...prev, project_id: v } : null,
                        );
                        toast({ title: "Projeto do arquivo atualizado" });
                      } catch (e: any) {
                        toast({
                          title: "Não foi possível mudar o projeto",
                          description: e?.message || "Tente de novo.",
                          variant: "destructive",
                        });
                      }
                    }}
                  >
                    {(projects || [])
                      .filter((pj: any) => pj.client_id === previewFile.client_id)
                      .map((pj: any) => (
                        <SelectItem key={pj.id} value={pj.id}>{pj.name}</SelectItem>
                      ))}
                  </SelectDeCampo>
                </CampoDeFormulario>
              </GrupoDeCampos>
            </div>
          )}
          <div className="flex shrink-0 flex-wrap items-center justify-end border-t border-border px-4 py-2">
            <button
              type="button"
              className={juntar(botao.discreto, "m-1")}
              onClick={async () => {
                if (!previewFile) return;
                const url = await resolveFileUrl({ fileUrl: previewFile.file_url, storageBucket: previewFile.storage_bucket, storagePath: previewFile.storage_path });
                downloadFile(url, previewFile.file_name);
              }}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Baixar
            </button>
            {isEditableFile(previewFile) && (
              <>
                <button
                  type="button"
                  className={juntar(botao.secundario, "m-1")}
                  disabled={acting}
                  onClick={() => runActing(() => handleRequestAgencyReview(previewFile))}
                >
                  Solicitar revisão interna
                </button>
                {canReviewAndRelease && (
                  <>
                    <button
                      type="button"
                      className={juntar(botao.secundario, "m-1")}
                      disabled={acting}
                      onClick={() => runActing(() => handleDirectReleaseToClient(previewFile, "approval"))}
                    >
                      Pedir aprovação do cliente
                    </button>
                    {/* Disponibilizar é o caminho padrão: revisão interna já
                        basta. Aprovação do cliente é a exceção explícita. */}
                    <button
                      type="button"
                      className={juntar(botao.primario, "m-1")}
                      disabled={acting}
                      onClick={() => runActing(() => handleDirectReleaseToClient(previewFile, "client_shared"))}
                    >
                      Disponibilizar ao cliente
                    </button>
                  </>
                )}
              </>
            )}
            {previewFile?.agency_approval_status === "pending" && canReviewAndRelease && (
              <button
                type="button"
                className={juntar(botao.primario, "m-1")}
                disabled={acting}
                onClick={() => runActing(() => handleAgencyApproval(previewFile))}
              >
                Aprovar internamente
              </button>
            )}
            {previewFile?.agency_approval_status === "approved"
              && previewFile?.visibility === "internal"
              && canReviewAndRelease && (
                <>
                  <button
                    type="button"
                    className={juntar(botao.secundario, "m-1")}
                    disabled={acting}
                    onClick={() => runActing(() => handleReleaseToClient(previewFile, "approval"))}
                  >
                    Pedir aprovação do cliente
                  </button>
                  <button
                    type="button"
                    className={juntar(botao.primario, "m-1")}
                    disabled={acting}
                    onClick={() => runActing(() => handleReleaseToClient(previewFile, "client_shared"))}
                  >
                    Disponibilizar ao cliente
                  </button>
                </>
              )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Upload Modal */}
      <Dialog
        open={uploadOpen}
        onOpenChange={(open) => {
          if (uploading) return;
          if (open) {
            setUploadOpen(true);
          } else {
            closeUploadForm();
          }
        }}
      >
        <DialogContent className="flex max-h-[88vh] max-w-xl flex-col gap-0 p-0">
          <DialogHeader className="shrink-0 space-y-0.5 border-b border-border px-5 py-4 text-left">
            <DialogTitle className={texto.tituloSecao}>Novo conteúdo</DialogTitle>
            <DialogDescription className={juntar(texto.auxiliar, "truncate")}>
              {selectedClientProfile ? `Cliente: ${nomeDoCliente(selectedClientProfile)}` : "Escolha um cliente"}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
            {revisionSource && (
              <div className={juntar(superficie.poco, "border-l-2 border-warning px-3 py-2")}>
                <p className="text-[13px] font-medium text-foreground">
                  Nova correção · versão {revisionVersion}
                </p>
                <p className={juntar(texto.auxiliar, "mt-0.5 leading-5")}>
                  A versão {revisionSource.version || 1} de “{revisionSource.file_name}” e o feedback anterior serão preservados.
                </p>
              </div>
            )}

            {/* Modo de envio */}
            <div>
              <p className={juntar(texto.rotulo, "mb-1.5")}>Modo de envio</p>
              <SeletorCompacto
                rotulo="Modo de envio"
                larguraTotal
                valor={uploadMode}
                onEscolher={(modo) => {
                  if (modo === "single") { setUploadMode("single"); setUploadFiles(prev => prev.slice(0, 1)); }
                  else if (modo === "carousel") setUploadMode("carousel");
                  else { setUploadMode("video_link"); setUploadFiles([]); }
                }}
                opcoes={[
                  { valor: "single", rotulo: "Arquivo único" },
                  { valor: "carousel", rotulo: "Carrossel" },
                  { valor: "video_link", rotulo: "Vídeo" },
                ]}
              />
            </div>

            {uploadMode === "video_link" ? (
              <CampoDeFormulario
                rotulo="URL do vídeo"
                obrigatorio
                ajuda="Link do YouTube, Vimeo, Loom, Drive, Wistia ou MP4 direto. Sem limite de tamanho: nada vai para o armazenamento."
              >
                <input
                  value={uploadVideoUrl}
                  onChange={(e) => setUploadVideoUrl(e.target.value)}
                  placeholder="https://youtube.com/watch?v=..."
                  inputMode="url"
                  className={campo}
                />
              </CampoDeFormulario>
            ) : (
              <>
                {/* Arrastar e soltar */}
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={uploadMode === "carousel" ? "Escolher imagens do carrossel" : "Escolher arquivo"}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  className={juntar(
                    "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    dragOver ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground",
                    uploadFiles.length > 0 ? "py-4" : "py-8",
                  )}
                >
                  <Upload className="mb-2 h-6 w-6 text-muted-foreground" aria-hidden="true" />
                  <p className={juntar(texto.corpo, "text-muted-foreground")}>
                    {uploadFiles.length === 0
                      ? uploadMode === "carousel"
                        ? "Arraste ou clique para escolher as imagens"
                        : "Arraste ou clique para escolher"
                      : `${uploadFiles.length} arquivo(s) selecionado(s)`}
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={uploadMode === "carousel" ? "image/*" : ACCEPTED}
                  multiple={uploadMode === "carousel"}
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length > 0) handleFilesSelect(files);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                />
              </>
            )}

            {uploadFiles.length > 0 && (
              <ul className={juntar(superficie.poco, "max-h-[140px] divide-y divide-border overflow-y-auto overscroll-contain px-3")}>
                {uploadFiles.map((f, i) => (
                  <li key={i} className="flex min-w-0 items-center py-1.5">
                    <FileImage className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">{f.name}</span>
                    <span className="ml-2 shrink-0 text-[11px] tabular-nums text-muted-foreground">{(f.size / 1024 / 1024).toFixed(1)}MB</span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeUploadFile(i); }}
                      className={juntar(botao.icone, "ml-1 h-7 w-7 hover:text-destructive")}
                      aria-label={`Tirar ${f.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <GrupoDeCampos>
              <CampoDeFormulario rotulo="Nome do arquivo" largo>
                <input value={uploadName} onChange={(e) => setUploadName(e.target.value)} className={campo} />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Pasta" apoio={folderDefinition(uploadFolder).hint}>
                <SelectDeCampo
                  value={uploadFolder}
                  onValueChange={(folder) => {
                    setUploadFolder(folder);
                    // Trocou de pasta: o tipo acompanha, para nunca gravar
                    // "contrato" dentro de Materiais gráficos.
                    const definition = folderDefinition(folder);
                    if (!definition.kinds.includes(uploadType as FileKindId)) {
                      setUploadType(definition.defaultKind);
                    }
                  }}
                >
                  {FOLDERS.map(f => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}
                </SelectDeCampo>
              </CampoDeFormulario>
              {/* Só os tipos que fazem sentido na pasta escolhida: dentro de
                  Materiais gráficos vem carrossel, post, story e vídeo. */}
              <CampoDeFormulario rotulo="Tipo">
                <SelectDeCampo value={uploadType} onValueChange={setUploadType}>
                  {folderDefinition(uploadFolder).kinds.map((kind) => (
                    <SelectItem key={kind} value={kind}>{kindLabel(kind)}</SelectItem>
                  ))}
                </SelectDeCampo>
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Projeto" apoio="Opcional.">
                <SelectDeCampo value={uploadProject} onValueChange={setUploadProject} placeholder="Nenhum">
                  <SelectItem value="none">Nenhum</SelectItem>
                  {clientProjects.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectDeCampo>
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Legenda" apoio="Opcional." largo>
                <textarea value={uploadCaption} onChange={(e) => setUploadCaption(e.target.value)} rows={2} placeholder="Legenda do post"
                  className={juntar(campoTexto, "min-h-[64px] resize-none")} />
              </CampoDeFormulario>
              {uploadMode === "carousel" && (
                <CampoDeFormulario rotulo="Texto do carrossel" apoio="Opcional." largo>
                  <textarea value={uploadCarousel} onChange={(e) => setUploadCarousel(e.target.value)} rows={2} placeholder="Texto dos slides"
                    className={juntar(campoTexto, "min-h-[64px] resize-none")} />
                </CampoDeFormulario>
              )}
              <CampoDeFormulario rotulo="Descrição da entrega" apoio="Opcional. O cliente poderá ler." largo>
                <textarea value={uploadDescription} onChange={(e) => setUploadDescription(e.target.value)} rows={2} placeholder="Contexto ou orientação"
                  className={juntar(campoTexto, "min-h-[64px] resize-none")} />
              </CampoDeFormulario>
            </GrupoDeCampos>

            <div>
              <div className="mb-1.5 flex items-center">
                <p className={texto.rotulo} id="depois-de-salvar">Depois de salvar</p>
                <AjudaRecolhida className="ml-1">
                  Para enviar ao cliente, escolha se precisa de aprovação final ou se será apenas disponibilizado.
                </AjudaRecolhida>
              </div>
              <RadioGroup
                value={uploadPostSaveAction}
                onValueChange={(value) => setUploadPostSaveAction(value as UploadPostSaveAction)}
                aria-labelledby="depois-de-salvar"
                className="grid grid-cols-1 gap-2 sm:grid-cols-2"
              >
                {([
                  { id: "save-internal-draft", valor: "draft", titulo: "Salvar internamente", apoio: "Só a equipe vê e pode continuar editando.", mostrar: true },
                  { id: "request-agency-review", valor: "internal_review", titulo: "Solicitar revisão interna", apoio: "Admin ou manager revisa antes do cliente.", mostrar: true },
                  { id: "release-client-shared", valor: "client_shared", titulo: "Disponibilizar ao cliente", apoio: "O cliente só visualiza.", mostrar: canReviewAndRelease },
                  { id: "release-for-approval", valor: "approval", titulo: "Enviar para aprovação", apoio: "O cliente decide no painel.", mostrar: canReviewAndRelease },
                ] as const).filter((opcao) => opcao.mostrar).map((opcao) => (
                  <Label
                    key={opcao.id}
                    htmlFor={opcao.id}
                    className={juntar(
                      "flex min-w-0 cursor-pointer items-start rounded-md border px-3 py-2.5 text-left font-normal transition-colors",
                      uploadPostSaveAction === opcao.valor
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <RadioGroupItem id={opcao.id} value={opcao.valor} className="mr-2 mt-0.5 shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">{opcao.titulo}</span>
                      <span className="mt-0.5 block text-[12px] leading-4 opacity-80">{opcao.apoio}</span>
                    </span>
                  </Label>
                ))}
              </RadioGroup>
            </div>

            {uploading && <Progress value={uploadProgress} className="h-2 rounded-full" />}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end border-t border-border px-5 py-3 [&>*+*]:ml-2">
            <button type="button" className={botao.discreto} onClick={closeUploadForm} disabled={uploading}>Cancelar</button>
            <button
              type="button"
              className={botao.primario}
              onClick={handleUpload}
              disabled={uploading || (uploadMode === "video_link" ? !uploadVideoUrl.trim() : uploadFiles.length === 0)}
            >
              {uploading
                ? "Salvando..."
                : uploadPostSaveAction === "approval"
                  ? "Salvar e enviar para aprovação"
                  : uploadPostSaveAction === "client_shared"
                    ? "Salvar e disponibilizar"
                    : uploadPostSaveAction === "internal_review"
                      ? "Salvar e solicitar revisão"
                      : "Salvar internamente"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={!!confirmDeleteFile}
        title="Excluir arquivo"
        description={`Este arquivo${confirmDeleteFile?.name ? ` (${confirmDeleteFile.name})` : ""} será removido permanentemente do sistema.`}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDeleteFile(null)}
      />
    </div>
  );
}
