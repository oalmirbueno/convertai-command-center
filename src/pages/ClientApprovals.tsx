import { useEffect, useState } from "react";
import { useFiles } from "@/hooks/useSupabaseData";
import { useClientIdentity } from "@/hooks/useClientIdentity";
import { useFileApprovalDecision } from "@/hooks/useFileApprovalDecision";
import { useEditorialApprovalPreview } from "@/hooks/useEditorialCalendar";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { AlertTriangle, FileImage, FileText, Film, Archive, ExternalLink, Download, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import FilePreviewContent from "@/components/shared/FilePreviewContent";
import { openFile, downloadFile } from "@/lib/fileActions";
import { notifyAdmin } from "@/lib/notifyHelpers";
import { orderEditorialCarouselFiles } from "@/lib/editorialMedia";
import { isCarouselAssetGroup, mediaKindFromFile, resolveFileUrl, useResolvedFileUrl } from "@/lib/fileUrls";
import { PLATFORM_LABELS, type EditorialPlatform } from "@/lib/editorial";

const approvalBadge: Record<string, { cls: string; label: string }> = {
  pending: { cls: "bg-warning/10 text-warning border-warning/20", label: "Pendente" },
  approved: { cls: "bg-success/10 text-success border-success/20", label: "Aprovado" },
  rejected: { cls: "bg-destructive/10 text-destructive border-destructive/20", label: "Ajuste Solicitado" },
};

const fileIcon = (name: string) => {
  const ext = name?.split(".").pop()?.toLowerCase() || "";
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return FileImage;
  if (["mp4"].includes(ext)) return Film;
  if (["zip"].includes(ext)) return Archive;
  return FileText;
};

const getExt = (value?: string) => {
  if (!value) return "";
  const normalized = value.split("?")[0].split("#")[0];
  return normalized.split(".").pop()?.toLowerCase() || "";
};

const isImage = (name: string, url?: string) => {
  const ext = getExt(name) || getExt(url);
  return ["jpg", "jpeg", "png", "gif", "webp"].includes(ext);
};

const isPdf = (name: string) => name?.toLowerCase().endsWith(".pdf");

function ApprovalFileThumb({ file, className = "w-full h-full" }: { file: any; className?: string }) {
  const kind = mediaKindFromFile(file.file_name, file.file_url, file.mime_type || file.file_type, file.extension);
  const Icon = fileIcon(file.file_name);
  const { url } = useResolvedFileUrl({
    fileUrl: file.file_url,
    storageBucket: file.storage_bucket,
    storagePath: file.storage_path,
    transform: kind === "image" ? { width: 640, height: 640, quality: 72, resize: "cover" } : null,
    expiresIn: 3600,
  });

  return (
    <div className={`${className} bg-secondary flex items-center justify-center overflow-hidden relative`}>
      {url && kind === "image" ? (
        <img src={url} alt={file.file_name} loading="lazy" decoding="async" className="w-full h-full object-cover" />
      ) : url && kind === "video" ? (
        <>
          <video src={`${url}#t=0.1`} muted playsInline preload="none" className="w-full h-full object-cover" />
          <div className="absolute inset-0 flex items-center justify-center bg-background/25">
            <Film className="w-5 h-5 text-foreground" />
          </div>
        </>
      ) : (
        <Icon className="w-10 h-10 text-muted-foreground/40" />
      )}
    </div>
  );
}

function CarouselPreview({ images, small }: { images: any[]; small?: boolean }) {
  const [idx, setIdx] = useState(0);
  if (images.length === 0) return null;
  const current = images[idx];
  const maxH = small ? "h-32" : "min-h-[200px] max-h-[400px]";

  return (
    <div className="relative group">
      <div className={`${maxH} bg-secondary flex items-center justify-center overflow-hidden`}>
        <ApprovalFileThumb file={current} />
      </div>
      {images.length > 1 && (
        <>
          <button
            className="absolute left-1 top-1/2 -translate-y-1/2 bg-background/80 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => { e.stopPropagation(); setIdx((idx - 1 + images.length) % images.length); }}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            className="absolute right-1 top-1/2 -translate-y-1/2 bg-background/80 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => { e.stopPropagation(); setIdx((idx + 1) % images.length); }}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex gap-1">
            {images.map((_, i) => (
              <span key={i} className={`w-1.5 h-1.5 rounded-full transition-colors ${i === idx ? "bg-primary" : "bg-muted-foreground/40"}`} />
            ))}
          </div>
        </>
      )}
      {images.length > 1 && (
        <span className="absolute top-1 right-1 bg-background/80 text-[10px] px-1.5 py-0.5 rounded-md text-muted-foreground">
          {idx + 1}/{images.length}
        </span>
      )}
    </div>
  );
}

export default function ClientApprovals() {
  const { clientId, profile } = useClientIdentity();
  const { data: files, isLoading } = useFiles(undefined, clientId || undefined);
  const { decide, submitting, isReadOnly } = useFileApprovalDecision();
  const { toast } = useToast();

  const [confirmApprove, setConfirmApprove] = useState<string | null>(null);
  const [feedbackFileId, setFeedbackFileId] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [previewFile, setPreviewFileRaw] = useState<any>(null);
  const [previewIdx, setPreviewIdx] = useState(0);
  const setPreviewFile = (f: any) => { setPreviewFileRaw(f); setPreviewIdx(0); };
  const editorialPreview = useEditorialApprovalPreview(
    previewFile?.id || null,
    !!previewFile,
  );

  // Keyboard arrows for carousel navigation inside preview.
  useEffect(() => {
    if (!previewFile) return;
    const len = getCarouselImages(previewFile).length;
    if (len <= 1) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setPreviewIdx((i) => (i - 1 + len) % len);
      if (e.key === "ArrowRight") setPreviewIdx((i) => (i + 1) % len);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewFile]);

  const allFilesList = files || [];

  // Build carousel children map
  const childrenMap = new Map<string, any[]>();
  allFilesList.forEach((f: any) => {
    if (f.parent_file_id) {
      const arr = childrenMap.get(f.parent_file_id) || [];
      arr.push(f);
      childrenMap.set(f.parent_file_id, arr);
    }
  });

  // Only parent/standalone files with approval status
  const approvalFiles = allFilesList.filter((f: any) =>
    f.visibility === "approval"
    && f.requires_approval === true
    && f.status === "ready"
    && !f.archived_at
    && f.approval_status !== "none"
    && !f.parent_file_id
  );

  const getCarouselImages = (f: any) => {
    const children = childrenMap.get(f.id) || [];
    if (isCarouselAssetGroup(f, children)) {
      // Ordem numerica real dos cards: "card 2" antes de "card 10" (o
      // localeCompare alfabetico embaralhava a sequencia do carrossel).
      return orderEditorialCarouselFiles(f, children);
    }
    return [f];
  };

  const handleApprove = async () => {
    if (!confirmApprove) return;
    const file = approvalFiles.find((candidate: any) => candidate.id === confirmApprove);
    if (!file) return;
    try {
      await decide({
        fileId: file.id,
        expectedVersion: file.version,
        decision: "approved",
      });
      toast({ title: "Aprovado com sucesso!" });
      void notifyAdmin(
        `Aprovação recebida: ${profile?.company_name || profile?.full_name || "Cliente"} aprovou "${file.file_name}". Pronto para agendar na Agenda.`,
        "approval",
        "/calendario"
      );
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
    const file = approvalFiles.find((candidate: any) => candidate.id === feedbackFileId);
    if (!file) return;
    try {
      await decide({
        fileId: file.id,
        expectedVersion: file.version,
        decision: "rejected",
        feedback: feedbackText,
      });
      toast({ title: "Feedback enviado" });
      void notifyAdmin(
        `Ajustes solicitados: ${profile?.company_name || profile?.full_name || "Cliente"} pediu mudanças em "${file.file_name}".`,
        "approval",
        "/aprovacoes"
      );
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
      <p className="heading-page">Aprovações</p>
      {isReadOnly && (
        <div className="rounded-xl border border-sky-500/20 bg-sky-500/[0.06] px-4 py-3 text-xs text-sky-600">
          Modo somente leitura: você pode conferir a experiência do cliente, mas não aprovar nem pedir ajustes por ele.
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2].map(i => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      ) : approvalFiles.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Nenhuma aprovação pendente</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
          {approvalFiles.map((f: any) => {
            const badge = approvalBadge[f.approval_status] || approvalBadge.pending;
            const images = getCarouselImages(f);
            const isCarousel = images.length > 1;
            return (
              <div key={f.id} className="bg-card border border-border rounded-xl overflow-hidden cursor-pointer hover:border-muted-foreground/30 transition-colors"
                onClick={() => setPreviewFile(f)}>
                <CarouselPreview images={images} small />
                <div className="p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground truncate">{f.file_name}</p>
                    {isCarousel && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary whitespace-nowrap">
                        Carrossel • {images.length}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">{f.project?.name || "—"} • {formatDate(f.created_at)}</p>
                  <span className={`inline-block text-[11px] px-2.5 py-1 rounded-full border ${badge.cls}`}>{badge.label}</span>
                  {f.approval_status === "rejected" && f.feedback && (
                    <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3">
                      <p className="text-[11px] text-muted-foreground mb-0.5">Seu feedback:</p>
                      <p className="text-xs text-foreground">{f.feedback}</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Preview Modal */}
      <Dialog open={!!previewFile} onOpenChange={() => setPreviewFile(null)}>
        <DialogContent className="max-w-2xl p-0 gap-0 flex flex-col max-h-[90vh]">
          <DialogHeader className="px-6 pt-5 pb-3 shrink-0 border-b border-border">
            <DialogTitle className="flex items-center gap-2 truncate pr-6 text-base">
              {previewFile?.file_name}
              {previewFile && getCarouselImages(previewFile).length > 1 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary shrink-0">
                  Carrossel • {getCarouselImages(previewFile).length} itens
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          {previewFile && (() => {
            const items = getCarouselImages(previewFile);
            const currentIdx = previewIdx % items.length;
            const setIdx = setPreviewIdx;
            const current = items[currentIdx] || previewFile;
            return (
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <div className="relative">
                <FilePreviewContent
                  fileName={current.file_name}
                  fileUrl={current.file_url}
                  fileId={current.id}
                  storageBucket={current.storage_bucket}
                  storagePath={current.storage_path}
                  mimeType={current.mime_type || current.file_type}
                  extension={current.extension}
                />
                {items.length > 1 && (
                  <>
                    <button type="button"
                      className="absolute left-2 top-1/2 -translate-y-1/2 bg-background/80 border border-border rounded-full p-2 hover:bg-background shadow-md"
                      onClick={() => setIdx((currentIdx - 1 + items.length) % items.length)}>
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 bg-background/80 border border-border rounded-full p-2 hover:bg-background shadow-md"
                      onClick={() => setIdx((currentIdx + 1) % items.length)}>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                    <span className="absolute top-2 right-2 bg-background/80 text-[10px] px-2 py-0.5 rounded-md text-muted-foreground">
                      {currentIdx + 1}/{items.length}
                    </span>
                  </>
                )}
              </div>

              {items.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {items.map((cf: any, i: number) => (
                    <button key={cf.id} onClick={() => setIdx(i)}
                      className={`shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 transition-all ${i === currentIdx ? "border-primary ring-1 ring-primary/30" : "border-border opacity-60 hover:opacity-100"}`}>
                      <ApprovalFileThumb file={cf} />
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={async () => {
                  const url = await resolveFileUrl({ fileUrl: current.file_url, storageBucket: current.storage_bucket, storagePath: current.storage_path });
                  openFile(url);
                }}>
                  <ExternalLink className="w-3.5 h-3.5" /> Abrir
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={async () => {
                  const url = await resolveFileUrl({ fileUrl: current.file_url, storageBucket: current.storage_bucket, storagePath: current.storage_path });
                  downloadFile(url, current.file_name);
                }}>
                  <Download className="w-3.5 h-3.5" /> Baixar
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">Enviado por {previewFile.uploader?.full_name || "—"} • {formatDate(previewFile.created_at)}</p>
              {previewFile.caption && <div className="space-y-0.5"><p className="text-[11px] text-muted-foreground uppercase tracking-wider">Legenda</p><p className="text-sm text-foreground">{previewFile.caption}</p></div>}
              {previewFile.carousel_text && <div className="space-y-0.5"><p className="text-[11px] text-muted-foreground uppercase tracking-wider">Texto do Carrossel</p><p className="text-sm text-foreground whitespace-pre-wrap">{previewFile.carousel_text}</p></div>}
              {previewFile.description && <div className="space-y-0.5"><p className="text-[11px] text-muted-foreground uppercase tracking-wider">Descrição</p><p className="text-sm text-foreground">{previewFile.description}</p></div>}
              {editorialPreview.isLoading && (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Conferindo o conteúdo editorial vinculado…
                </div>
              )}
              {editorialPreview.isError && (
                <div
                  role="alert"
                  className="rounded-lg border border-destructive/20 bg-destructive/5 p-3"
                >
                  <div className="flex gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    <div>
                      <p className="text-xs font-medium text-destructive">
                        Não foi possível conferir o conteúdo editorial.
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        A decisão fica bloqueada até a prévia ser validada.
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => editorialPreview.refetch()}
                  >
                    Tentar novamente
                  </Button>
                </div>
              )}
              {!editorialPreview.isLoading
                && !editorialPreview.isError
                && (editorialPreview.data || []).map((snapshot) => (
                  <section
                    key={snapshot.post_id}
                    className="space-y-3 rounded-lg border border-primary/20 bg-primary/[0.04] p-4"
                  >
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wider text-primary">
                        Conteúdo editorial vinculado
                      </p>
                      <p className="mt-1 text-sm font-semibold text-foreground">
                        {snapshot.title}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Formato: {snapshot.content_type}
                      </p>
                    </div>
                    {snapshot.objective && (
                      <div>
                        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                          Objetivo
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                          {snapshot.objective}
                        </p>
                      </div>
                    )}
                    {snapshot.default_caption && (
                      <div>
                        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                          Legenda base
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                          {snapshot.default_caption}
                        </p>
                      </div>
                    )}
                    {snapshot.plans.map((plan, planIndex) => (
                      <div
                        key={`${plan.platform}-${plan.account_handle || plan.account_name || planIndex}`}
                        className="space-y-2 rounded-md border border-border bg-background/70 p-3"
                      >
                        <div>
                          <p className="text-xs font-medium text-foreground">
                            {PLATFORM_LABELS[
                              plan.platform as EditorialPlatform
                            ] || plan.platform}
                          </p>
                          {(plan.account_handle || plan.account_name) && (
                            <p className="text-[11px] text-muted-foreground">
                              {plan.account_handle || plan.account_name}
                            </p>
                          )}
                        </div>
                        {plan.caption && (
                          <div>
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              Legenda da plataforma
                            </p>
                            <p className="mt-1 whitespace-pre-wrap text-xs text-foreground">
                              {plan.caption}
                            </p>
                          </div>
                        )}
                        {plan.first_comment && (
                          <div>
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              Primeiro comentário
                            </p>
                            <p className="mt-1 whitespace-pre-wrap text-xs text-foreground">
                              {plan.first_comment}
                            </p>
                          </div>
                        )}
                        {plan.alt_text && (
                          <div>
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              Texto alternativo
                            </p>
                            <p className="mt-1 whitespace-pre-wrap text-xs text-foreground">
                              {plan.alt_text}
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                  </section>
                ))}
              {previewFile.approval_status === "rejected" && previewFile.feedback && (
                <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3">
                  <p className="text-[11px] text-muted-foreground mb-0.5">Feedback anterior:</p>
                  <p className="text-xs text-foreground">{previewFile.feedback}</p>
                </div>
              )}
            </div>
            );
          })()}
          {previewFile?.approval_status === "pending" && (
            <DialogFooter className="px-6 py-3 border-t border-border shrink-0">
              <Button variant="outline" className="border-destructive text-destructive hover:bg-destructive/10"
                disabled={isReadOnly || editorialPreview.isFetching || editorialPreview.isError}
                onClick={() => { if (!isReadOnly) { setFeedbackFileId(previewFile.id); setFeedbackText(""); setPreviewFile(null); } }}>
                Solicitar ajuste
              </Button>
              <Button className="bg-success hover:bg-success/90 text-white"
                disabled={isReadOnly || editorialPreview.isFetching || editorialPreview.isError}
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
