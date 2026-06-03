import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useFiles } from "@/hooks/useSupabaseData";
import { useClientIdentity } from "@/hooks/useClientIdentity";
import { supabase } from "@/integrations/supabase/client";
import { notifyOpsMilestone, notifyOpsUpdate } from "@/lib/opsSync";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { notifyAdmin } from "@/lib/notifyHelpers";
import { fireWebhook, webhooks } from "@/lib/webhooks";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { FileImage, FileText, Film, Archive, ExternalLink, Download, ChevronLeft, ChevronRight } from "lucide-react";
import FilePreviewContent from "@/components/shared/FilePreviewContent";
import { openFile, downloadFile } from "@/lib/fileActions";

const approvalBadge: Record<string, { cls: string; label: string }> = {
  pending: { cls: "bg-warning/10 text-warning border-warning/20", label: "⏳ Pendente" },
  approved: { cls: "bg-success/10 text-success border-success/20", label: "✓ Aprovado" },
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

function CarouselPreview({ images, small }: { images: { file_url: string; file_name: string }[]; small?: boolean }) {
  const [idx, setIdx] = useState(0);
  if (images.length === 0) return null;
  const current = images[idx];
  const maxH = small ? "h-32" : "min-h-[200px] max-h-[400px]";

  return (
    <div className="relative group">
      <div className={`${maxH} bg-secondary flex items-center justify-center overflow-hidden`}>
        {isImage(current.file_name, current.file_url) ? (
          <img src={current.file_url} alt={current.file_name} className={small ? "w-full h-full object-cover" : "max-w-full max-h-[400px] object-contain"} />
        ) : (
          <FileText className="w-12 h-12 text-muted-foreground/30" />
        )}
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
  const { user, profile } = useAuth();
  const { clientId } = useClientIdentity();
  const { data: files, isLoading } = useFiles(undefined, clientId || undefined);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [confirmApprove, setConfirmApprove] = useState<string | null>(null);
  const [feedbackFileId, setFeedbackFileId] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [previewFile, setPreviewFileRaw] = useState<any>(null);
  const [previewIdx, setPreviewIdx] = useState(0);
  const setPreviewFile = (f: any) => { setPreviewFileRaw(f); setPreviewIdx(0); };

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
  const approvalFiles = allFilesList.filter((f: any) => f.approval_status !== "none" && !f.parent_file_id);

  const getCarouselImages = (f: any) => {
    const children = childrenMap.get(f.id) || [];
    if (children.length > 0) {
      return [f, ...children.sort((a: any, b: any) => a.file_name.localeCompare(b.file_name))];
    }
    return [f];
  };

  const handleApprove = async () => {
    if (!confirmApprove || !user) return;
    setSubmitting(true);
    try {
      await supabase.from("files").update({ approval_status: "approved" }).eq("id", confirmApprove);
      const file = approvalFiles.find((f: any) => f.id === confirmApprove);

      await notifyAdmin(`Cliente aprovou: ${file?.file_name}`, "approval", "/aprovacoes");

      if (file?.project_id) {
        const { data: upd } = await supabase.from("updates").insert({
          project_id: file.project_id, author_id: user.id,
          message: `Cliente aprovou: ${file?.file_name}`, update_type: "creative",
        }).select().single();
        notifyOpsUpdate(upd);
      }
      queryClient.invalidateQueries({ queryKey: ["files"] });
      toast({ title: "Aprovado com sucesso!" });

      fireWebhook(webhooks.creativeApproval, {
        file_id: confirmApprove,
        file_name: file?.file_name || '',
        project_id: file?.project_id || '',
        client_id: user.id,
        client_name: profile?.full_name || '',
        action: 'approved',
        feedback: '',
      });
    } catch {
      toast({ title: "Erro ao aprovar", variant: "destructive" });
    }
    setSubmitting(false);
    setConfirmApprove(null);
    setPreviewFile(null);
  };

  const handleReject = async () => {
    if (!feedbackFileId || !user || feedbackText.trim().length < 10) return;
    setSubmitting(true);
    try {
      await supabase.from("files").update({ approval_status: "rejected", feedback: feedbackText }).eq("id", feedbackFileId);

      await notifyAdmin(`Cliente solicitou ajustes em: ${allFilesList.find((f: any) => f.id === feedbackFileId)?.file_name}`, "approval", "/aprovacoes");

      const { data: fileData } = await supabase.from("files").select("project_id, uploaded_by, file_name").eq("id", feedbackFileId).maybeSingle();

      if (fileData?.project_id) {
        const { data: upd2 } = await supabase.from("updates").insert({
          project_id: fileData.project_id, author_id: user.id,
          message: `Cliente solicitou ajustes em: ${fileData.file_name}`, update_type: "alert",
        }).select().single();
        notifyOpsUpdate(upd2);

        const { error: taskErr } = await supabase.from("tasks").insert({
          project_id: fileData.project_id,
          title: `Ajustar: ${fileData.file_name}`,
          description: `Feedback do cliente:\n${feedbackText}`,
          status: "backlog", priority: "high",
          assigned_to: fileData.uploaded_by || null,
        });
        if (!taskErr) queryClient.invalidateQueries({ queryKey: ["tasks"] });
      }

      queryClient.invalidateQueries({ queryKey: ["files"] });
      toast({ title: "Feedback enviado" });

      fireWebhook(webhooks.creativeApproval, {
        file_id: feedbackFileId,
        file_name: fileData?.file_name || '',
        project_id: fileData?.project_id || '',
        client_id: user.id,
        client_name: profile?.full_name || '',
        action: 'rejected',
        feedback: feedbackText,
      });
    } catch {
      toast({ title: "Erro ao enviar feedback", variant: "destructive" });
    }
    setSubmitting(false);
    setFeedbackFileId(null);
    setFeedbackText("");
    setPreviewFile(null);
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

  return (
    <div className="space-y-6 animate-fade-in">
      <p className="heading-page">Aprovações</p>

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
                <FilePreviewContent fileName={current.file_name} fileUrl={current.file_url} />
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
                      {isImage(cf.file_name, cf.file_url) ? (
                        <img src={cf.file_url} alt={cf.file_name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-secondary flex items-center justify-center">
                          <FileText className="w-4 h-4 text-muted-foreground" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => openFile(current.file_url)}>
                  <ExternalLink className="w-3.5 h-3.5" /> Abrir
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => downloadFile(current.file_url, current.file_name)}>
                  <Download className="w-3.5 h-3.5" /> Baixar
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">Enviado por {previewFile.uploader?.full_name || "—"} • {formatDate(previewFile.created_at)}</p>
              {previewFile.caption && <div className="space-y-0.5"><p className="text-[11px] text-muted-foreground uppercase tracking-wider">Legenda</p><p className="text-sm text-foreground">{previewFile.caption}</p></div>}
              {previewFile.carousel_text && <div className="space-y-0.5"><p className="text-[11px] text-muted-foreground uppercase tracking-wider">Texto do Carrossel</p><p className="text-sm text-foreground whitespace-pre-wrap">{previewFile.carousel_text}</p></div>}
              {previewFile.description && <div className="space-y-0.5"><p className="text-[11px] text-muted-foreground uppercase tracking-wider">Descrição</p><p className="text-sm text-foreground">{previewFile.description}</p></div>}
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
                onClick={() => { setFeedbackFileId(previewFile.id); setFeedbackText(""); setPreviewFile(null); }}>
                ❌ Solicitar Ajuste
              </Button>
              <Button className="bg-success hover:bg-success/90 text-white"
                onClick={() => { setConfirmApprove(previewFile.id); setPreviewFile(null); }}>
                ✅ Aprovar
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
            <Button className="bg-success hover:bg-success/90 text-white" onClick={handleApprove} disabled={submitting}>
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
            <Button onClick={handleReject} disabled={submitting || feedbackText.trim().length < 10}>
              {submitting ? "Enviando..." : "Enviar Feedback"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
