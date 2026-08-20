import { useEffect, useState, useRef } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { useClients, useProjects, useAllFiles } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Upload, FileImage, FileText, Film, Archive, Download, Trash2, FolderOpen, Pencil, Check, X, ChevronLeft, ChevronRight, FolderInput, Grid2X2, List, RefreshCw, Send,
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import FilePreviewContent, { prefetchImages } from "@/components/shared/FilePreviewContent";
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
import { isCarouselAssetGroup, mediaKindFromFile, resolveFileUrl, useResolvedFileUrl } from "@/lib/fileUrls";
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

function FileThumb({ file, className = "w-20 h-20" }: { file: any; className?: string }) {
  const kind = mediaKindFromFile(file.file_name, file.file_url, file.mime_type || file.file_type, file.extension);
  const Icon = fileIcon(file.file_name);
  const { url } = useResolvedFileUrl({
    fileUrl: file.file_url,
    storageBucket: file.storage_bucket,
    storagePath: file.storage_path,
    transform: kind === "image" ? { width: 640, quality: 72, resize: "cover" } : null,
    expiresIn: 3600,
  });

  return (
    <div className={`${className} rounded-lg bg-secondary border border-border overflow-hidden flex items-center justify-center shrink-0 relative`}>
      {url && kind === "image" ? (
        <img src={url} alt={file.file_name} loading="lazy" decoding="async" className="w-full h-full object-cover" />
      ) : url && kind === "video" ? (
        <>
          <video src={`${url}#t=0.1`} muted playsInline preload="none" className="w-full h-full object-cover" />
          <div className="absolute inset-0 flex items-center justify-center bg-black/25">
            <Film className="w-5 h-5 text-primary-foreground drop-shadow" />
          </div>
        </>
      ) : (
        <Icon className="w-7 h-7 text-muted-foreground" />
      )}
    </div>
  );
}

function CarouselSlider({ files }: { files: any[] }) {
  const [idx, setIdx] = useState(0);
  const current = files[idx];

  useEffect(() => {
    prefetchImages(files.map((f) => f?.file_url).filter(Boolean));
    setIdx(0);
  }, [files]);

  useEffect(() => {
    if (files.length <= 1) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setIdx((i) => (i - 1 + files.length) % files.length);
      if (e.key === "ArrowRight") setIdx((i) => (i + 1) % files.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [files.length]);

  if (!current) return null;
  if (files.length === 1) {
    return (
      <FilePreviewContent
        fileName={current.file_name}
        fileUrl={current.file_url}
        fileId={current.id}
        storageBucket={current.storage_bucket}
        storagePath={current.storage_path}
        mimeType={current.mime_type || current.file_type}
        extension={current.extension}
      />
    );
  }

  return (
    <div className="relative group">
      <FilePreviewContent
        fileName={current.file_name}
        fileUrl={current.file_url}
        fileId={current.id}
        storageBucket={current.storage_bucket}
        storagePath={current.storage_path}
        mimeType={current.mime_type || current.file_type}
        extension={current.extension}
      />
      <button
        type="button"
        className="absolute z-10 left-2 top-1/2 -translate-y-1/2 bg-background/80 hover:bg-background border border-border rounded-full p-2 shadow-md opacity-80 hover:opacity-100 transition-all"
        onClick={(e) => {
          e.stopPropagation();
          setIdx((idx - 1 + files.length) % files.length);
        }}
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <button
        type="button"
        className="absolute z-10 right-2 top-1/2 -translate-y-1/2 bg-background/80 hover:bg-background border border-border rounded-full p-2 shadow-md opacity-80 hover:opacity-100 transition-all"
        onClick={(e) => {
          e.stopPropagation();
          setIdx((idx + 1) % files.length);
        }}
      >
        <ChevronRight className="w-4 h-4" />
      </button>
      <div className="absolute z-10 bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
        {files.map((_: any, i: number) => (
          <button
            key={i}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIdx(i);
            }}
            className={`w-2 h-2 rounded-full transition-colors ${i === idx ? "bg-primary" : "bg-muted-foreground/40"}`}
          />
        ))}
      </div>
      <span className="absolute z-10 top-2 right-2 bg-background/80 text-[10px] px-2 py-0.5 rounded-md text-muted-foreground">
        {idx + 1}/{files.length}
      </span>
    </div>
  );
}

export default function AdminFiles() {
  const { user, profile, loading: loadingAuth } = useAuth();
  const isStaff = profile?.role === "admin"
    || ["design", "traffic", "manager"].includes(profile?.role || "");
  const canReviewAndRelease = profile?.role === "admin" || profile?.role === "manager";
  const { data: clients, isLoading: loadingClients } = useClients();
  const { data: projects, isLoading: loadingProjects } = useProjects();
  const {
    data: allFiles,
    isLoading: loadingFiles,
    isError: filesReadFailed,
    error: filesReadError,
    refetch: refetchFiles,
    isFetching: refreshingFiles,
  } = useAllFiles();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedClientId = searchParams.get("client");
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
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [activeKind, setActiveKind] = useState<FileKindId | null>(null);
  const [search, setSearch] = useState("");
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
  const [editingName, setEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");
  const revisionSource = requestedRevisionId
    ? (allFiles || []).find((file: any) => file.id === requestedRevisionId) || null
    : null;
  const revisionVersion = revisionSource ? Number(revisionSource.version || 1) + 1 : 1;

  const invalidateFileViews = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["all-files"] }),
    queryClient.invalidateQueries({ queryKey: ["files"] }),
    queryClient.invalidateQueries({ queryKey: ["workspace-client-files"] }),
  ]);

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

    if (requestedFolderId && FOLDER_IDS.has(requestedFolderId)) {
      setUploadFolder(requestedFolderId);
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
      setUploadFolder(activeFolder);
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
    } catch {
      toast({ title: "Erro ao renomear", variant: "destructive" });
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
    } catch {
      toast({ title: "Erro ao mover arquivo", variant: "destructive" });
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
  const scopedFiles = (allFiles || []).filter((f: any) => {
    if (f.parent_file_id) return false; // filho de carrossel aparece junto do pai
    if (selectedClient !== "all" && f.client_id !== selectedClient) return false;
    return true;
  });

  const folderSummaries = summarizeFiles(scopedFiles);
  const activeSummary = folderSummaries.find((entry) => entry.folder.id === activeFolder) || null;
  const kindChips = activeSummary && activeSummary.byKind.length > 1 ? activeSummary.byKind : [];
  const searchTerm = search.trim().toLowerCase();

  const filteredFiles = scopedFiles.filter((f: any) => {
    if (!matchesFolderFilter(f, activeFolder as FolderId, activeKind)) return false;
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
    try {
      await requestFileAgencyReview(fileId);
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
        title: "Conteúdo salvo, mas a etapa final falhou",
        description: error?.message || "Abra o conteúdo e conclua a liberação manualmente.",
        variant: "destructive",
      });
      return "draft";
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

      let rootFileId: string | null = null;
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
    if (!isEditableFile(target)) {
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
      if (error) throw error;
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
    return <div className="py-8 text-center text-sm text-muted-foreground">Carregando...</div>;
  }

  if (!isStaff) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="heading-page">Conteúdos e arquivos</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Organize entregas, legendas e materiais do cliente.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedClient} onValueChange={handleClientChange}>
            <SelectTrigger className="w-full sm:w-[220px] bg-card border-border rounded-xl text-sm">
              <SelectValue placeholder="Todos os clientes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os clientes</SelectItem>
              {(clients || []).map((c: any) => (
                <SelectItem key={c.id} value={c.id}>{c.company_name || c.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedClientProfile && (
        <div className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/[0.04] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Cliente selecionado
            </p>
            <p className="mt-0.5 text-sm font-medium text-foreground">
              {selectedClientProfile.company_name || selectedClientProfile.full_name}
            </p>
          </div>
          <Link
            to={`/aprovacoes?client=${encodeURIComponent(selectedClient)}`}
            className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-primary/40"
          >
            Acompanhar aprovações
          </Link>
        </div>
      )}

      {/* Pastas, com quantos itens tem em cada uma */}
      <div className="space-y-2">
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {folderSummaries.map((entry) => (
            <button
              key={entry.folder.id}
              onClick={() => handleFolderChange(entry.folder.id)}
              title={entry.folder.hint}
              className={`shrink-0 px-4 py-2 text-xs uppercase tracking-wide rounded-lg whitespace-nowrap transition-colors ${
                activeFolder === entry.folder.id
                  ? "text-foreground border-b-2 border-primary bg-secondary/50"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {entry.folder.label}
              {entry.total > 0 && (
                <span className="ml-1.5 text-[10px] text-muted-foreground">{entry.total}</span>
              )}
            </button>
          ))}
        </div>

        {activeFolder !== "contratos" && (
          <div className="flex flex-wrap items-center gap-2">
            {kindChips.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto">
                <button
                  type="button"
                  onClick={() => setActiveKind(null)}
                  className={`shrink-0 rounded-full border px-3 py-1 text-[11px] transition-colors ${
                    activeKind === null
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Todos os tipos
                </button>
                {kindChips.map((entry) => (
                  <button
                    key={entry.kind.id}
                    type="button"
                    onClick={() => setActiveKind(entry.kind.id)}
                    className={`shrink-0 rounded-full border px-3 py-1 text-[11px] transition-colors ${
                      activeKind === entry.kind.id
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {entry.kind.label} ({entry.total})
                  </button>
                ))}
              </div>
            )}
            <div className="ml-auto w-full sm:w-56">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar pelo nome..."
                className="h-9 rounded-lg bg-card text-xs"
              />
            </div>
          </div>
        )}

        {activeSummary && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {activeSummary.folder.hint}
          </p>
        )}
      </div>

      {activeFolder === "contratos" ? (
        selectedClient === "all" ? (
          <div className="text-center py-12 text-sm text-muted-foreground flex flex-col items-center gap-2">
            <FolderOpen className="w-8 h-8 text-muted-foreground/40" />
            Selecione um cliente para ver e enviar contratos.
          </div>
        ) : (
          <div className="-mx-4 md:-mx-6">
            <AdminContracts clientId={selectedClient} />
          </div>
        )
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="inline-flex items-center rounded-xl border border-border bg-card p-1">
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={`h-9 w-9 rounded-lg inline-flex items-center justify-center transition-colors ${viewMode === "grid" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                title="Blocos"
              >
                <Grid2X2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={`h-9 w-9 rounded-lg inline-flex items-center justify-center transition-colors ${viewMode === "list" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                title="Lista"
              >
                <List className="w-4 h-4" />
              </button>
            </div>
            <Button
              onClick={() => { setUploadFolder(activeFolder); setUploadOpen(true); }}
              className="rounded-xl gap-2"
              disabled={
                selectedClient === "all"
                || (!!requestedRevisionId && !revisionSource)
              }
            >
              <Upload className="w-4 h-4" />
              Novo conteúdo
            </Button>
          </div>

          {/* File list */}
          {loadingFiles || loadingClients ? (
            <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
          ) : filesReadFailed ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-8 text-center">
              <FolderOpen className="mx-auto mb-3 h-8 w-8 text-destructive/70" />
              <p className="text-sm font-medium text-foreground">Não foi possível carregar Arquivos</p>
              <p className="mx-auto mt-1 max-w-lg text-xs text-muted-foreground">
                A pasta não está vazia. Houve uma falha de leitura
                {filesReadError instanceof Error ? `: ${filesReadError.message}` : "."}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4 gap-2"
                onClick={() => void refetchFiles()}
                disabled={refreshingFiles}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshingFiles ? "animate-spin" : ""}`} />
                Tentar novamente
              </Button>
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground flex flex-col items-center gap-2">
              <FolderOpen className="w-8 h-8 text-muted-foreground/40" />
              Nenhum arquivo nesta pasta
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid auto-rows-fr grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 stagger-children">
              {filteredFiles.map((f: any) => {
                const reviewBadge = agencyBadge[f.agency_approval_status] || agencyBadge.not_requested;
                const carouselChildren = childrenMap.get(f.id) || [];
                const isCarousel = isCarouselAssetGroup(f, carouselChildren);
                const isEditable = isEditableFile(f);
                return (
                  <div key={f.id} className="flex h-full flex-col bg-card border border-border rounded-xl overflow-hidden cursor-pointer hover:border-muted-foreground/30 transition-colors"
                    onClick={() => setPreviewFile(f)}>
                    <FileThumb file={f} className="w-full aspect-square rounded-none border-0" />
                    <div className="flex flex-1 flex-col gap-2 p-3">
                      <div className="flex items-start gap-2">
                        <p className="flex-1 text-[13px] font-medium text-foreground line-clamp-2">
                          {f.file_name}
                          {f.version > 1 && <span className="text-xs text-muted-foreground ml-1">v{f.version}</span>}
                        </p>
                        {isCarousel && <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary shrink-0">{carouselChildren.length + 1}</span>}
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">{kindLabel(resolveKind(f))} • {f.project?.name || "Sem projeto"} • {formatDate(f.created_at)}</p>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full ${reviewBadge.cls}`}>{reviewBadge.label}</span>
                          {/* A raiz das reclamações: upload nasce interno e o
                              cliente NÃO vê. Agora isso fica na cara. */}
                          {f.visibility === "internal" ? (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-warning/15 text-warning">Cliente não vê</span>
                          ) : (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-success/10 text-success">Visível ao cliente</span>
                          )}
                        </span>
                        <div className="flex items-center gap-2">
                          {canReviewAndRelease && f.visibility === "internal" && isEditable && (
                            <button
                              onClick={(e) => { e.stopPropagation(); void handleDirectReleaseToClient(f, "client_shared"); }}
                              title="Liberar ao cliente agora (revisão interna registrada junto)"
                              className="text-warning hover:text-success transition-colors"
                            >
                              <Send className="w-4 h-4" />
                            </button>
                          )}
                          {isEditable && (
                            <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteFile({ id: f.id, name: f.file_name }); }}
                              className="text-muted-foreground hover:text-destructive transition-colors">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2 stagger-children">
              {filteredFiles.map((f: any) => {
                const reviewBadge = agencyBadge[f.agency_approval_status] || agencyBadge.not_requested;
                const carouselChildren = childrenMap.get(f.id) || [];
                const isCarousel = isCarouselAssetGroup(f, carouselChildren);
                const isEditable = isEditableFile(f);
                return (
                  <div key={f.id} className="bg-card border border-border rounded-xl px-3 py-3 cursor-pointer hover:border-muted-foreground/30 transition-colors"
                    onClick={() => setPreviewFile(f)}>
                    <div className="flex items-center gap-3">
                      <FileThumb file={f} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-[13px] font-medium text-foreground truncate">
                            {f.file_name}
                            {f.version > 1 && <span className="text-xs text-muted-foreground ml-1">v{f.version}</span>}
                          </p>
                          {isCarousel && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary whitespace-nowrap shrink-0">
                              {carouselChildren.length + 1}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {kindLabel(resolveKind(f))} • {f.project?.name || "Sem projeto"} •{" "}
                          {formatDate(f.created_at)}
                        </p>
                      </div>
                      <div className="hidden md:flex items-center gap-2">
                        <Avatar className="w-5 h-5">
                          <AvatarFallback className="text-[8px] bg-secondary text-secondary-foreground">
                            {f.uploader?.full_name?.charAt(0) || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-[11px] text-muted-foreground">{f.uploader?.full_name}</span>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 hidden sm:inline ${reviewBadge.cls}`}>{reviewBadge.label}</span>
                      {f.visibility === "internal" ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full shrink-0 bg-warning/15 text-warning">Cliente não vê</span>
                      ) : (
                        <span className="text-[10px] px-2 py-0.5 rounded-full shrink-0 hidden sm:inline bg-success/10 text-success">Visível ao cliente</span>
                      )}
                      {canReviewAndRelease && f.visibility === "internal" && isEditable && (
                        <button
                          onClick={(e) => { e.stopPropagation(); void handleDirectReleaseToClient(f, "client_shared"); }}
                          title="Liberar ao cliente agora"
                          className="text-warning hover:text-success transition-colors"
                        >
                          <Send className="w-4 h-4" />
                        </button>
                      )}
                      {isEditable && <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button onClick={(e) => e.stopPropagation()} className="text-muted-foreground hover:text-foreground transition-colors" title="Mover de pasta">
                            <FolderInput className="w-4 h-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {FOLDERS.filter(fo => fo.id !== (f.folder || "estrategicos")).map(fo => (
                            <DropdownMenuItem key={fo.id} onClick={(e) => { e.stopPropagation(); handleMoveFolder(f.id, fo.id); }}>
                              {fo.label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>}
                      <button type="button"
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        onClick={async (e) => {
                          e.stopPropagation();
                          const url = await resolveFileUrl({ fileUrl: f.file_url, storageBucket: f.storage_bucket, storagePath: f.storage_path });
                          downloadFile(url, f.file_name);
                        }}>
                        <Download className="w-4 h-4" />
                      </button>
                      {isEditable && (
                        <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteFile({ id: f.id, name: f.file_name }); }}
                          className="text-muted-foreground hover:text-destructive transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <div className="sm:hidden mt-2 ml-[92px]">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${reviewBadge.cls}`}>{reviewBadge.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Preview Modal */}
      <Dialog open={!!previewFile} onOpenChange={(o) => { if (!o) { setPreviewFile(null); setEditingName(false); } }}>
        <DialogContent className="max-w-2xl p-0 gap-0 flex flex-col max-h-[90vh]">
          <DialogHeader className="px-6 pt-5 pb-3 shrink-0 border-b border-border">
            {editingName ? (
              <div className="flex items-center gap-2 pr-6">
                <Input
                  value={editNameValue}
                  onChange={(e) => setEditNameValue(e.target.value)}
                  className="h-8 text-sm bg-secondary border-border rounded-lg flex-1"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") setEditingName(false); }}
                />
                <button onClick={handleRename} className="text-success hover:text-success/80 transition-colors"><Check className="w-4 h-4" /></button>
                <button onClick={() => setEditingName(false)} className="text-muted-foreground hover:text-foreground transition-colors"><X className="w-4 h-4" /></button>
              </div>
            ) : (
              <div className="flex items-center gap-2 pr-6">
                <DialogTitle className="truncate text-base">{previewFile?.file_name}</DialogTitle>
                {!previewFile?.locked_at && (
                  <button
                    onClick={() => { setEditNameValue(previewFile?.file_name || ""); setEditingName(true); }}
                    className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    title="Renomear"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
          </DialogHeader>
          {previewFile && (
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
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
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[11px] px-2.5 py-1 rounded-full ${(agencyBadge[previewFile.agency_approval_status] || agencyBadge.not_requested).cls}`}>
                  {(agencyBadge[previewFile.agency_approval_status] || agencyBadge.not_requested).label}
                </span>
                <span className={`text-[11px] px-2.5 py-1 rounded-full ${(approvalBadge[previewFile.approval_status] || approvalBadge.none).cls}`}>
                  Cliente: {(approvalBadge[previewFile.approval_status] || approvalBadge.none).label}
                </span>
                <span className="text-xs text-muted-foreground">
                  Enviado por {previewFile.uploader?.full_name || "-"} • {formatDate(previewFile.created_at)}
                </span>
              </div>
              {previewFile.caption && (
                <div className="space-y-0.5">
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Legenda</p>
                  <p className="text-sm text-foreground">{previewFile.caption}</p>
                </div>
              )}
              {previewFile.carousel_text && (
                <div className="space-y-0.5">
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Texto do Carrossel</p>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{previewFile.carousel_text}</p>
                </div>
              )}
              {previewFile.description && (
                <div className="space-y-0.5">
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Descrição</p>
                  <p className="text-sm text-foreground">{previewFile.description}</p>
                </div>
              )}
              {previewFile.feedback && (
                <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3">
                  <p className="text-[11px] text-muted-foreground mb-0.5">Feedback do cliente:</p>
                  <p className="text-xs text-foreground">{previewFile.feedback}</p>
                </div>
              )}
              {previewFile.agency_feedback && (
                <div className="rounded-lg border border-warning/20 bg-warning/5 p-3">
                  <p className="mb-0.5 text-[11px] text-muted-foreground">Feedback da revisão interna:</p>
                  <p className="text-xs text-foreground">{previewFile.agency_feedback}</p>
                </div>
              )}
              {/* Mover de pasta e de projeto: organização vale para qualquer
                  arquivo — a trava antiga (só antes da revisão) prendia
                  exatamente os que mais precisavam de arrumação. */}
              <div className="flex items-center gap-2">
                <FolderInput className="w-4 h-4 text-muted-foreground shrink-0" />
                <Select
                  value={previewFile.folder || "estrategicos"}
                  onValueChange={(v) => handleMoveFolder(previewFile.id, v)}
                >
                  <SelectTrigger className="h-8 text-xs bg-secondary border-border rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FOLDERS.map(f => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select
                  value={previewFile.project_id || ""}
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
                  <SelectTrigger className="h-8 text-xs bg-secondary border-border rounded-lg">
                    <SelectValue placeholder="Projeto" />
                  </SelectTrigger>
                  <SelectContent>
                    {(projects || [])
                      .filter((pj: any) => pj.client_id === previewFile.client_id)
                      .map((pj: any) => (
                        <SelectItem key={pj.id} value={pj.id}>{pj.name}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter className="px-6 py-3 border-t border-border shrink-0 flex gap-2">
            {isEditableFile(previewFile) && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleRequestAgencyReview(previewFile)}
                >
                  Solicitar revisão interna
                </Button>
                {canReviewAndRelease && (
                  <>
                    {/* Disponibilizar é o caminho padrão: revisão interna já
                        basta. Aprovação do cliente é a exceção explícita. */}
                    <Button
                      size="sm"
                      onClick={() => handleDirectReleaseToClient(previewFile, "client_shared")}
                    >
                      Disponibilizar ao cliente
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDirectReleaseToClient(previewFile, "approval")}
                    >
                      Pedir aprovação do cliente
                    </Button>
                  </>
                )}
              </>
            )}
            {previewFile?.agency_approval_status === "pending" && canReviewAndRelease && (
              <Button
                size="sm"
                onClick={() => handleAgencyApproval(previewFile)}
              >
                Aprovar internamente
              </Button>
            )}
            {previewFile?.agency_approval_status === "approved"
              && previewFile?.visibility === "internal"
              && canReviewAndRelease && (
                <>
                  <Button
                    size="sm"
                    onClick={() => handleReleaseToClient(previewFile, "client_shared")}
                  >
                    Disponibilizar ao cliente
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleReleaseToClient(previewFile, "approval")}
                  >
                    Pedir aprovação do cliente
                  </Button>
                </>
              )}
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={async () => {
                if (!previewFile) return;
                const url = await resolveFileUrl({ fileUrl: previewFile.file_url, storageBucket: previewFile.storage_bucket, storagePath: previewFile.storage_path });
                downloadFile(url, previewFile.file_name);
              }}
            >
              <Download className="w-3.5 h-3.5" /> Baixar
            </Button>
          </DialogFooter>
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
        <DialogContent className="max-w-lg p-0 gap-0 flex flex-col max-h-[85vh]">
          <DialogHeader className="px-6 pt-5 pb-3 shrink-0 border-b border-border">
            <DialogTitle>Novo conteúdo</DialogTitle>
            {selectedClientProfile && (
              <p className="text-xs text-muted-foreground">
                Cliente: {selectedClientProfile.company_name || selectedClientProfile.full_name}
              </p>
            )}
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto flex-1 px-6 py-4">
            {revisionSource && (
              <div className="rounded-xl border border-warning/25 bg-warning/[0.06] px-3 py-2.5">
                <p className="text-xs font-medium text-foreground">
                  Nova correção · versão {revisionVersion}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  A versão {revisionSource.version || 1} de “{revisionSource.file_name}” e o feedback anterior serão preservados.
                </p>
              </div>
            )}

            {/* Mode selector */}
            <div>
              <Label className="label-sm mb-1.5 block">Modo de envio</Label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => { setUploadMode("single"); setUploadFiles(prev => prev.slice(0, 1)); }}
                  className={`px-3 py-2.5 rounded-xl text-xs font-medium border transition-colors ${
                    uploadMode === "single"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-secondary text-muted-foreground border-border hover:text-foreground"
                  }`}
                >
                  Arquivo único
                </button>
                <button
                  onClick={() => setUploadMode("carousel")}
                  className={`px-3 py-2.5 rounded-xl text-xs font-medium border transition-colors ${
                    uploadMode === "carousel"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-secondary text-muted-foreground border-border hover:text-foreground"
                  }`}
                >
                  Carrossel
                </button>
                <button
                  onClick={() => { setUploadMode("video_link"); setUploadFiles([]); }}
                  className={`px-3 py-2.5 rounded-xl text-xs font-medium border transition-colors ${
                    uploadMode === "video_link"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-secondary text-muted-foreground border-border hover:text-foreground"
                  }`}
                >
                  Vídeo
                </button>
              </div>
              {uploadMode === "video_link" && (
                <p className="text-[11px] text-muted-foreground/70 mt-2">
                  Cole link do YouTube, Vimeo, Loom, Drive, Wistia ou MP4 direto. Sem limite de tamanho, nada vai para o storage.
                </p>
              )}
            </div>

            {uploadMode === "video_link" ? (
              <div>
                <Label className="label-sm">URL do vídeo</Label>
                <Input
                  value={uploadVideoUrl}
                  onChange={(e) => setUploadVideoUrl(e.target.value)}
                  placeholder="https://youtube.com/watch?v=... ou https://vimeo.com/..."
                  className="mt-1 bg-secondary border-border rounded-xl"
                />
              </div>
            ) : (
              <>
                {/* Drag & Drop zone */}
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl min-h-[100px] flex flex-col items-center justify-center cursor-pointer transition-colors ${
                    dragOver ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground"
                  } ${uploadFiles.length > 0 ? "py-3" : "h-36"}`}
                >
                  <Upload className="w-7 h-7 text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">
                    {uploadFiles.length === 0
                      ? uploadMode === "carousel"
                        ? "Arraste ou clique para selecionar múltiplas imagens"
                        : "Arraste ou clique para selecionar"
                      : `${uploadFiles.length} arquivo(s) selecionado(s)`}
                  </p>
                  {uploadMode === "carousel" && (
                    <p className="text-[11px] text-muted-foreground/60 mt-1">Selecione várias imagens para montar o carrossel</p>
                  )}
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
              <div className="space-y-1.5 max-h-[140px] overflow-y-auto">
                {uploadFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 bg-secondary/50 border border-border rounded-lg px-3 py-1.5">
                    <FileImage className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs text-foreground truncate flex-1">{f.name}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{(f.size / 1024 / 1024).toFixed(1)}MB</span>
                    <button onClick={(e) => { e.stopPropagation(); removeUploadFile(i); }}
                      className="text-muted-foreground hover:text-destructive transition-colors cursor-pointer bg-transparent border-none p-0.5">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <Label className="label-sm">Nome do arquivo</Label>
                <Input value={uploadName} onChange={(e) => setUploadName(e.target.value)}
                  className="mt-1 bg-secondary border-border rounded-xl" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="label-sm">Pasta</Label>
                  <Select
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
                    <SelectTrigger className="mt-1 bg-secondary border-border rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FOLDERS.map(f => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="label-sm">Tipo</Label>
                  {/* Só os tipos que fazem sentido na pasta escolhida: dentro de
                      Materiais gráficos vem carrossel, post, story e vídeo. */}
                  <Select value={uploadType} onValueChange={setUploadType}>
                    <SelectTrigger className="mt-1 bg-secondary border-border rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {folderDefinition(uploadFolder).kinds.map((kind) => (
                        <SelectItem key={kind} value={kind}>{kindLabel(kind)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {folderDefinition(uploadFolder).hint}
              </p>
              <div>
                <Label className="label-sm">Projeto vinculado (opcional)</Label>
                <Select value={uploadProject} onValueChange={setUploadProject}>
                  <SelectTrigger className="mt-1 bg-secondary border-border rounded-xl"><SelectValue placeholder="Nenhum" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {clientProjects.map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="label-sm">Legenda (opcional)</Label>
                <textarea value={uploadCaption} onChange={(e) => setUploadCaption(e.target.value)} rows={2} placeholder="Legenda do post..."
                  className="mt-1 w-full bg-secondary border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors resize-none" />
              </div>
              {uploadMode === "carousel" && (
                <div>
                  <Label className="label-sm">Texto do Carrossel (opcional)</Label>
                  <textarea value={uploadCarousel} onChange={(e) => setUploadCarousel(e.target.value)} rows={2} placeholder="Texto para carrossel multi-slide..."
                    className="mt-1 w-full bg-secondary border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors resize-none" />
                </div>
              )}
              <div>
                <Label className="label-sm">Descrição da entrega (opcional)</Label>
                <textarea value={uploadDescription} onChange={(e) => setUploadDescription(e.target.value)} rows={2} placeholder="Contexto ou orientação que o cliente poderá ler..."
                  className="mt-1 w-full bg-secondary border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors resize-none" />
              </div>
              <div>
                <Label className="label-sm mb-1.5 block">O que fazer depois de salvar?</Label>
                <RadioGroup
                  value={uploadPostSaveAction}
                  onValueChange={(value) => setUploadPostSaveAction(value as UploadPostSaveAction)}
                  className="grid grid-cols-1 gap-2 sm:grid-cols-2"
                >
                  <Label
                    htmlFor="save-internal-draft"
                    className={`flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2.5 text-left text-xs transition-colors ${
                      uploadPostSaveAction === "draft"
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-secondary text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <RadioGroupItem id="save-internal-draft" value="draft" className="mt-0.5 shrink-0" />
                    <span>
                      <span className="block font-medium">Salvar internamente</span>
                      <span className="mt-0.5 block text-[10px] opacity-75">Só a equipe vê e pode continuar editando.</span>
                    </span>
                  </Label>
                  <Label
                    htmlFor="request-agency-review"
                    className={`flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2.5 text-left text-xs transition-colors ${
                      uploadPostSaveAction === "internal_review"
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-secondary text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <RadioGroupItem id="request-agency-review" value="internal_review" className="mt-0.5 shrink-0" />
                    <span>
                      <span className="block font-medium">Solicitar revisão interna</span>
                      <span className="mt-0.5 block text-[10px] opacity-75">Admin ou manager revisa antes do cliente receber.</span>
                    </span>
                  </Label>
                  {canReviewAndRelease && (
                    <>
                      <Label
                        htmlFor="release-client-shared"
                        className={`flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2.5 text-left text-xs transition-colors ${
                          uploadPostSaveAction === "client_shared"
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border bg-secondary text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <RadioGroupItem id="release-client-shared" value="client_shared" className="mt-0.5 shrink-0" />
                        <span>
                          <span className="block font-medium">Disponibilizar ao cliente</span>
                          <span className="mt-0.5 block text-[10px] opacity-75">Admin aprova internamente e o cliente só visualiza.</span>
                        </span>
                      </Label>
                      <Label
                        htmlFor="release-for-approval"
                        className={`flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2.5 text-left text-xs transition-colors ${
                          uploadPostSaveAction === "approval"
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border bg-secondary text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <RadioGroupItem id="release-for-approval" value="approval" className="mt-0.5 shrink-0" />
                        <span>
                          <span className="block font-medium">Enviar para aprovação</span>
                          <span className="mt-0.5 block text-[10px] opacity-75">Admin aprova e o cliente decide no painel.</span>
                        </span>
                      </Label>
                    </>
                  )}
                </RadioGroup>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Para enviar ao cliente, escolha se precisa de aprovação final ou se será apenas disponibilizado.
                </p>
              </div>
            </div>

            {uploading && <Progress value={uploadProgress} className="h-2 rounded-full" />}
          </div>
          <DialogFooter className="px-6 py-3 border-t border-border shrink-0">
            <Button variant="outline" onClick={closeUploadForm} disabled={uploading}>Cancelar</Button>
            <Button onClick={handleUpload} disabled={uploading || (uploadMode === "video_link" ? !uploadVideoUrl.trim() : uploadFiles.length === 0)}>
              {uploading
                ? "Salvando..."
                : uploadPostSaveAction === "approval"
                  ? "Salvar e enviar para aprovação"
                  : uploadPostSaveAction === "client_shared"
                    ? "Salvar e disponibilizar"
                    : uploadPostSaveAction === "internal_review"
                      ? "Salvar e solicitar revisão"
                      : "Salvar internamente"}
            </Button>
          </DialogFooter>
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
