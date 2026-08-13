import { useEffect, useState } from "react";
import { useFiles, useProjects } from "@/hooks/useSupabaseData";
import { useClientIdentity } from "@/hooks/useClientIdentity";
import { useFileApprovalDecision } from "@/hooks/useFileApprovalDecision";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { FileImage, FileText, Film, Archive, Download, FolderOpen, ExternalLink } from "lucide-react";
import CarouselSlider from "@/components/shared/CarouselSlider";
import { openFile, downloadFile } from "@/lib/fileActions";
import { mediaKindFromFile, resolveFileUrl, useResolvedFileUrl } from "@/lib/fileUrls";
import {
  fileLocationLabel,
  matchesFolderFilter,
  summarizeFiles,
  type FileKindId,
  type FolderId,
} from "@/lib/fileTaxonomy";

// CarouselSlider is imported from shared components (auto-fetches sibling slides).

const fileIcon = (name: string) => {
  const ext = name?.split(".").pop()?.toLowerCase() || "";
  if (["jpg","jpeg","png","gif","webp"].includes(ext)) return FileImage;
  if (["mp4"].includes(ext)) return Film;
  if (["zip"].includes(ext)) return Archive;
  return FileText;
};

const isImage = (name: string) => {
  const ext = name?.split(".").pop()?.toLowerCase() || "";
  return ["jpg", "jpeg", "png", "gif", "webp"].includes(ext);
};

const isPdf = (name: string) => name?.toLowerCase().endsWith(".pdf");

const approvalBadge: Record<string, { cls: string; label: string }> = {
  pending: { cls: "bg-warning/10 text-warning", label: "Pendente" },
  approved: { cls: "bg-success/10 text-success", label: "Aprovado" },
  rejected: { cls: "bg-destructive/10 text-destructive", label: "Ajuste Solicitado" },
  none: { cls: "bg-muted text-muted-foreground", label: "Sem status" },
};

function ClientFileThumb({ file }: { file: any }) {
  const kind = mediaKindFromFile(file.file_name, file.file_url, file.mime_type || file.file_type, file.extension);
  const Icon = fileIcon(file.file_name);
  const { url } = useResolvedFileUrl({
    fileUrl: file.file_url,
    storageBucket: file.storage_bucket,
    storagePath: file.storage_path,
    transform: kind === "image" ? { width: 320, height: 320, quality: 72, resize: "cover" } : null,
    expiresIn: 3600,
  });

  return (
    <div className="w-14 h-14 rounded-lg bg-secondary border border-border overflow-hidden flex items-center justify-center shrink-0 relative">
      {url && kind === "image" ? (
        <img src={url} alt={file.file_name} loading="lazy" decoding="async" className="w-full h-full object-cover" />
      ) : url && kind === "video" ? (
        <>
          <video src={`${url}#t=0.1`} muted playsInline preload="none" className="w-full h-full object-cover" />
          <div className="absolute inset-0 flex items-center justify-center bg-background/25">
            <Film className="w-4 h-4 text-foreground" />
          </div>
        </>
      ) : (
        <Icon className="w-5 h-5 text-muted-foreground" />
      )}
    </div>
  );
}

export default function ClientDocuments() {
  const { clientId } = useClientIdentity();
  const { data: files, isLoading } = useFiles(undefined, clientId || undefined);
  const { data: projects } = useProjects();
  const { decide, submitting, isReadOnly } = useFileApprovalDecision();
  const { toast } = useToast();

  const [activeFolder, setActiveFolder] = useState<FolderId | "todos">("todos");
  const [activeKind, setActiveKind] = useState<FileKindId | null>(null);
  const [filterProject, setFilterProject] = useState("all");
  const [confirmApprove, setConfirmApprove] = useState<string | null>(null);
  const [feedbackFileId, setFeedbackFileId] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [previewFile, setPreviewFile] = useState<any>(null);

  // Build children map for carousel grouping
  const childrenMap = new Map<string, any[]>();
  const childIds = new Set<string>();
  (files || []).forEach((f: any) => {
    if (f.parent_file_id) {
      childIds.add(f.id);
      const arr = childrenMap.get(f.parent_file_id) || [];
      arr.push(f);
      childrenMap.set(f.parent_file_id, arr);
    }
  });

  // Base visível: tudo o que o banco liberou para esta pessoa (RLS decide), sem
  // o filtro de pasta - é sobre ela que as contagens dos botões são calculadas,
  // para o número no botão bater com o que aparece ao clicar.
  const visibleFiles = (files || []).filter((f: any) => {
    if (childIds.has(f.id)) return false; // filho de carrossel aparece junto do pai
    if (f.status !== "ready" || f.archived_at) return false;
    if (filterProject !== "all" && f.project_id !== filterProject) return false;
    return true;
  });

  // Só entram na barra as pastas que realmente têm algo: nada de aba vazia.
  const folderSummaries = summarizeFiles(visibleFiles).filter((entry) => entry.total > 0);
  const activeSummary = folderSummaries.find((entry) => entry.folder.id === activeFolder) || null;
  const kindChips = activeSummary && activeSummary.byKind.length > 1 ? activeSummary.byKind : [];

  const filteredFiles = visibleFiles.filter((f: any) =>
    matchesFolderFilter(f, activeFolder, activeKind),
  );

  const selectFolder = (folder: FolderId | "todos") => {
    setActiveFolder(folder);
    setActiveKind(null);
  };

  const handleApprove = async () => {
    if (!confirmApprove) return;
    const file = (files || []).find((candidate: any) => candidate.id === confirmApprove);
    if (!file) return;
    try {
      await decide({
        fileId: file.id,
        expectedVersion: file.version,
        decision: "approved",
      });
      toast({ title: "Aprovado com sucesso!" });
    } catch (error: any) {
      toast({
        title: "Erro ao aprovar",
        description: error?.message || "Atualize a página e tente novamente.",
        variant: "destructive",
      });
    }
    setConfirmApprove(null);
    setPreviewFile(null);
  };

  const handleReject = async () => {
    if (!feedbackFileId || feedbackText.trim().length < 10) return;
    const file = (files || []).find((candidate: any) => candidate.id === feedbackFileId);
    if (!file) return;
    try {
      await decide({
        fileId: file.id,
        expectedVersion: file.version,
        decision: "rejected",
        feedback: feedbackText,
      });
      toast({ title: "Feedback enviado" });
    } catch (error: any) {
      toast({
        title: "Erro ao enviar feedback",
        description: error?.message || "Atualize a página e tente novamente.",
        variant: "destructive",
      });
    }
    setFeedbackFileId(null);
    setFeedbackText("");
    setPreviewFile(null);
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="heading-page">Documentos</p>
        <Select value={filterProject} onValueChange={setFilterProject}>
          <SelectTrigger className="w-full sm:w-[200px] bg-card border-border rounded-xl text-sm">
            <SelectValue placeholder="Filtrar por projeto" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os projetos</SelectItem>
            {(projects || []).map((p: any) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {isReadOnly && (
        <div className="rounded-xl border border-sky-500/20 bg-sky-500/[0.06] px-4 py-3 text-xs text-sky-600">
          Modo somente leitura: ações de aprovação estão bloqueadas enquanto você visualiza como cliente.
        </div>
      )}

      {/* Pastas: o que é cada coisa, com quantos itens tem em cada uma. */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => selectFolder("todos")}
            className={`shrink-0 rounded-lg px-3.5 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
              activeFolder === "todos"
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Tudo ({visibleFiles.length})
          </button>
          {folderSummaries.map((entry) => (
            <button
              key={entry.folder.id}
              type="button"
              title={entry.folder.hint}
              onClick={() => selectFolder(entry.folder.id)}
              className={`shrink-0 rounded-lg px-3.5 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
                activeFolder === entry.folder.id
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {entry.folder.label} ({entry.total})
            </button>
          ))}
        </div>

        {/* Dentro da pasta: carrossel, post, story, vídeo... */}
        {kindChips.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
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

        {activeSummary && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {activeSummary.folder.hint}
          </p>
        )}
      </div>

      {/* File list */}
      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : filteredFiles.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <FolderOpen className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-medium text-foreground">Nenhum material liberado ainda</p>
          <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
            Assim que a equipe liberar um material ou enviar algo para sua aprovação, ele aparece aqui
            na hora, junto com o histórico completo no Onde Estamos.
          </p>
        </div>
      ) : (
        <div className="space-y-2 stagger-children">
          {filteredFiles.map((f: any) => {
            const badge = approvalBadge[f.approval_status] || approvalBadge.none;

            return (
              <div key={f.id} className="bg-card border border-border rounded-xl px-4 py-3 cursor-pointer hover:border-muted-foreground/30 transition-colors"
                onClick={() => setPreviewFile(f)}>
                <div className="flex items-center gap-3">
                  <ClientFileThumb file={f} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-foreground truncate">
                      {f.file_name}
                      {f.version > 1 && <span className="text-xs text-muted-foreground ml-1">v{f.version}</span>}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {fileLocationLabel(f)} • {f.project?.name || "Sem projeto"} •{" "}
                      {formatDate(f.created_at)}
                    </p>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${badge.cls}`}>{badge.label}</span>
                  <button
                    type="button"
                    title="Baixar"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    onClick={async (e) => {
                      e.stopPropagation();
                      const url = await resolveFileUrl({ fileUrl: f.file_url, storageBucket: f.storage_bucket, storagePath: f.storage_path });
                      downloadFile(url, f.file_name);
                    }}>
                    <Download className="w-4 h-4" />
                  </button>
                </div>

                {f.approval_status === "rejected" && f.feedback && (
                  <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3 ml-8 mt-2">
                    <p className="text-[11px] text-muted-foreground mb-0.5">Seu feedback:</p>
                    <p className="text-xs text-foreground">{f.feedback}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Preview Modal */}
      <Dialog open={!!previewFile} onOpenChange={() => setPreviewFile(null)}>
        <DialogContent className="max-w-2xl p-0 gap-0 flex flex-col max-h-[90vh]">
          <DialogHeader className="px-6 pt-5 pb-3 shrink-0 border-b border-border">
            <DialogTitle className="truncate pr-6 text-base">{previewFile?.file_name}</DialogTitle>
          </DialogHeader>
          {previewFile && (
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <CarouselSlider parent={previewFile} initialChildren={childrenMap.get(previewFile.id) || []} />
              
              {/* Action buttons */}
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={async () => {
                  const url = await resolveFileUrl({ fileUrl: previewFile.file_url, storageBucket: previewFile.storage_bucket, storagePath: previewFile.storage_path });
                  openFile(url);
                }}>
                  <ExternalLink className="w-3.5 h-3.5" /> Abrir
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={async () => {
                  const url = await resolveFileUrl({ fileUrl: previewFile.file_url, storageBucket: previewFile.storage_bucket, storagePath: previewFile.storage_path });
                  downloadFile(url, previewFile.file_name);
                }}>
                  <Download className="w-3.5 h-3.5" /> Baixar
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                Enviado por {previewFile.uploader?.full_name || "-"} • {formatDate(previewFile.created_at)}
              </p>
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
              {previewFile.approval_status === "rejected" && previewFile.feedback && (
                <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3">
                  <p className="text-[11px] text-muted-foreground mb-0.5">Feedback anterior:</p>
                  <p className="text-xs text-foreground">{previewFile.feedback}</p>
                </div>
              )}
            </div>
          )}
          {previewFile?.approval_status === "pending" && (
            <DialogFooter className="px-6 py-3 border-t border-border shrink-0">
              <Button variant="outline" className="border-destructive text-destructive hover:bg-destructive/10"
                disabled={isReadOnly}
                onClick={() => { if (!isReadOnly) { setFeedbackFileId(previewFile.id); setFeedbackText(""); setPreviewFile(null); } }}>
                Solicitar ajuste
              </Button>
              <Button className="bg-success hover:bg-success/90 text-white"
                disabled={isReadOnly}
                onClick={() => { if (!isReadOnly) { setConfirmApprove(previewFile.id); setPreviewFile(null); } }}>
                Aprovar
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Approve dialog */}
      <Dialog open={!!confirmApprove} onOpenChange={() => setConfirmApprove(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Confirmar aprovação?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Esta ação não pode ser desfeita.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmApprove(null)}>Cancelar</Button>
            <Button className="bg-success hover:bg-success/90 text-white" onClick={handleApprove} disabled={submitting || isReadOnly}>
              {submitting ? "Aprovando..." : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Feedback dialog */}
      <Dialog open={!!feedbackFileId} onOpenChange={() => setFeedbackFileId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Solicitar Ajuste</DialogTitle></DialogHeader>
          <Textarea placeholder="Descreva as mudanças necessárias... (mínimo 10 caracteres)"
            value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)} rows={4} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setFeedbackFileId(null)}>Cancelar</Button>
            <Button onClick={handleReject} disabled={submitting || isReadOnly || feedbackText.trim().length < 10}>
              {submitting ? "Enviando..." : "Enviar Feedback"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
