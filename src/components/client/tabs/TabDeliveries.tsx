import { useState, useMemo, useRef, useCallback } from "react";
import { useFiles } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { notifyAdmin } from "@/lib/notifyHelpers";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { FileImage, FileText, File, ChevronLeft, ChevronRight, Images } from "lucide-react";
import FilePreviewContent from "@/components/shared/FilePreviewContent";

const approvalBadge: Record<string, { className: string; label: string }> = {
  pending: { className: "bg-warning/10 text-warning", label: "⏳ Aguardando Aprovação" },
  approved: { className: "bg-success/10 text-success", label: "✓ Aprovado" },
  rejected: { className: "bg-destructive/10 text-destructive", label: "Ajuste Solicitado" },
  none: { className: "bg-muted text-muted-foreground", label: "Sem status" },
};

const fileIcons: Record<string, any> = {
  creative: FileImage, document: FileText, report: FileText,
};

const isImage = (name: string) => {
  const ext = name?.split(".").pop()?.toLowerCase() || "";
  return ["jpg", "jpeg", "png", "gif", "webp"].includes(ext);
};

type DeliveryGroup = {
  type: "single" | "carousel";
  parent: any;
  children: any[];
};

function groupFiles(files: any[]): DeliveryGroup[] {
  const parentIds = new Set(files.filter(f => f.parent_file_id).map(f => f.parent_file_id));
  const childMap = new Map<string, any[]>();
  const standalone: any[] = [];

  for (const f of files) {
    if (f.parent_file_id) {
      const arr = childMap.get(f.parent_file_id) || [];
      arr.push(f);
      childMap.set(f.parent_file_id, arr);
    } else if (!parentIds.has(f.id)) {
      standalone.push(f);
    }
  }

  const groups: DeliveryGroup[] = [];

  for (const f of files) {
    if (parentIds.has(f.id)) {
      const children = childMap.get(f.id) || [];
      groups.push({ type: "carousel", parent: f, children: [f, ...children] });
    }
  }

  for (const f of standalone) {
    groups.push({ type: "single", parent: f, children: [f] });
  }

  groups.sort((a, b) => new Date(b.parent.created_at).getTime() - new Date(a.parent.created_at).getTime());
  return groups;
}

function CarouselThumbnails({ files, onOpen }: { files: any[]; onOpen: (idx: number) => void }) {
  const imageFiles = files.filter(f => isImage(f.file_name));
  const show = imageFiles.slice(0, 4);
  const extra = imageFiles.length - 4;

  return (
    <div className="flex gap-1.5 overflow-hidden">
      {show.map((f, i) => (
        <button key={f.id} onClick={(e) => { e.stopPropagation(); onOpen(files.indexOf(f)); }}
          className="relative w-16 h-16 rounded-lg overflow-hidden border border-border shrink-0 hover:border-primary/50 transition-colors">
          <img src={f.file_url} alt={f.file_name} className="w-full h-full object-cover" />
          {i === 3 && extra > 0 && (
            <div className="absolute inset-0 bg-background/70 flex items-center justify-center text-xs font-medium text-foreground">
              +{extra}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

export default function TabDeliveries({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const { data: files, isLoading } = useFiles(projectId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [confirmApprove, setConfirmApprove] = useState<string | null>(null);
  const [feedbackFileId, setFeedbackFileId] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [previewGroup, setPreviewGroup] = useState<DeliveryGroup | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);

  const groups = useMemo(() => groupFiles(files || []), [files]);

  const formatDate = (d: string) => new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

  const currentPreviewFile = previewGroup?.children[previewIndex] || null;

  const handleApprove = async () => {
    if (!confirmApprove || !user) return;
    setSubmitting(true);
    try {
      // Approve the parent file (controls the group status)
      const parentFile = previewGroup?.parent;
      await supabase.from("files").update({ approval_status: "approved" }).eq("id", confirmApprove);
      await notifyAdmin(`Cliente aprovou: ${parentFile?.file_name || "arquivo"}`, "approval", "/aprovacoes");
      await supabase.from("updates").insert({
        project_id: projectId, author_id: user.id,
        message: `Cliente aprovou: ${parentFile?.file_name || "arquivo"}`, update_type: "creative",
      });
      queryClient.invalidateQueries({ queryKey: ["files"] });
      toast({ title: "Aprovado!", description: "A entrega foi aprovada com sucesso." });
    } catch {
      toast({ title: "Erro", description: "Falha ao aprovar.", variant: "destructive" });
    }
    setSubmitting(false);
    setConfirmApprove(null);
    setPreviewGroup(null);
  };

  const handleReject = async () => {
    if (!feedbackFileId || !user || feedbackText.trim().length < 10) return;
    setSubmitting(true);
    try {
      const parentFile = files?.find((f: any) => f.id === feedbackFileId);
      await supabase.from("files").update({ approval_status: "rejected", feedback: feedbackText }).eq("id", feedbackFileId);
      await notifyAdmin(`Cliente solicitou ajustes em: ${parentFile?.file_name}`, "approval", "/aprovacoes");
      await supabase.from("updates").insert({
        project_id: projectId, author_id: user.id,
        message: `Cliente solicitou ajustes em: ${parentFile?.file_name}`, update_type: "alert",
      });
      const { data: fileData } = await supabase.from("files").select("project_id, uploaded_by, file_name").eq("id", feedbackFileId).maybeSingle();
      if (fileData?.project_id) {
        await supabase.from("tasks").insert({
          project_id: fileData.project_id,
          title: `Ajustar: ${fileData.file_name}`,
          description: `Feedback do cliente:\n${feedbackText}`,
          status: "backlog", priority: "high",
          assigned_to: fileData.uploaded_by || null,
        });
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
      }
      queryClient.invalidateQueries({ queryKey: ["files"] });
      toast({ title: "Feedback enviado", description: "Sua solicitação de ajuste foi registrada." });
    } catch {
      toast({ title: "Erro", description: "Falha ao enviar feedback.", variant: "destructive" });
    }
    setSubmitting(false);
    setFeedbackFileId(null);
    setFeedbackText("");
    setPreviewGroup(null);
  };

  if (isLoading) return <div className="space-y-3">{[1, 2].map(i => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}</div>;
  if (!groups.length) return (
    <div className="text-sm text-muted-foreground py-8 text-center flex flex-col items-center gap-2">
      <File className="w-6 h-6 text-muted-foreground/50" />Nenhuma entrega pendente no momento
    </div>
  );

  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const f = group.parent;
        const Icon = group.type === "carousel" ? Images : (fileIcons[f.file_type] || FileText);
        const badge = approvalBadge[f.approval_status] || approvalBadge.none;
        return (
          <div key={f.id}
            className="bg-card border border-border rounded-xl p-4 space-y-3 cursor-pointer hover:border-muted-foreground/30 transition-colors"
            onClick={() => { setPreviewGroup(group); setPreviewIndex(0); }}>
            <div className="flex items-start gap-3">
              <Icon className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{f.file_name}</p>
                  {group.type === "carousel" && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary font-medium">
                      Carrossel · {group.children.length} itens
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">Enviado por {f.uploader?.full_name || "—"} • {formatDate(f.created_at)}</p>
              </div>
            </div>

            {group.type === "carousel" && (
              <CarouselThumbnails files={group.children} onOpen={(idx) => { setPreviewGroup(group); setPreviewIndex(idx); }} />
            )}

            <span className={`text-[11px] px-2 py-0.5 rounded-full ${badge.className}`}>{badge.label}</span>
            {f.approval_status === "rejected" && f.feedback && (
              <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3 mt-2">
                <p className="text-xs text-muted-foreground mb-1">Feedback enviado:</p>
                <p className="text-xs text-foreground">{f.feedback}</p>
              </div>
            )}
          </div>
        );
      })}

      {/* Preview / Gallery Modal */}
      <Dialog open={!!previewGroup} onOpenChange={() => setPreviewGroup(null)}>
        <DialogContent className="max-w-2xl p-0 gap-0 flex flex-col max-h-[90vh]">
          <DialogHeader className="px-6 pt-5 pb-3 shrink-0 border-b border-border">
            <div className="flex items-center gap-3 pr-6">
              <DialogTitle className="truncate text-base">
                {currentPreviewFile?.file_name}
              </DialogTitle>
              {previewGroup && previewGroup.children.length > 1 && (
                <span className="text-xs text-muted-foreground shrink-0">
                  {previewIndex + 1} / {previewGroup.children.length}
                </span>
              )}
            </div>
          </DialogHeader>

          {currentPreviewFile && (
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {/* Gallery slider with swipe */}
              <SwipeableGallery
                previewIndex={previewIndex}
                setPreviewIndex={setPreviewIndex}
                totalItems={previewGroup?.children.length || 1}
              >
                <FilePreviewContent fileName={currentPreviewFile.file_name} fileUrl={currentPreviewFile.file_url} />

                {previewGroup && previewGroup.children.length > 1 && (
                  <>
                    <button
                      disabled={previewIndex === 0}
                      onClick={() => setPreviewIndex(i => Math.max(0, i - 1))}
                      className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-background/80 border border-border flex items-center justify-center hover:bg-background disabled:opacity-30 transition-all"
                    >
                      <ChevronLeft className="w-4 h-4 text-foreground" />
                    </button>
                    <button
                      disabled={previewIndex === previewGroup.children.length - 1}
                      onClick={() => setPreviewIndex(i => Math.min(previewGroup.children.length - 1, i + 1))}
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-background/80 border border-border flex items-center justify-center hover:bg-background disabled:opacity-30 transition-all"
                    >
                      <ChevronRight className="w-4 h-4 text-foreground" />
                </button>
                  </>
                )}
              </SwipeableGallery>

              {/* Dot indicators */}
              {previewGroup && previewGroup.children.length > 1 && (
                <div className="flex items-center justify-center gap-1.5">
                  {previewGroup.children.map((_: any, i: number) => (
                    <button key={i} onClick={() => setPreviewIndex(i)}
                      className={`w-2 h-2 rounded-full transition-all ${i === previewIndex ? "bg-primary w-4" : "bg-muted-foreground/30"}`} />
                  ))}
                </div>
              )}

              {/* Thumbnail strip */}
              {previewGroup && previewGroup.children.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {previewGroup.children.map((cf: any, i: number) => (
                    <button key={cf.id} onClick={() => setPreviewIndex(i)}
                      className={`shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 transition-all ${i === previewIndex ? "border-primary ring-1 ring-primary/30" : "border-border opacity-60 hover:opacity-100"}`}>
                      {isImage(cf.file_name) ? (
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

              <p className="text-xs text-muted-foreground">
                Enviado por {previewGroup?.parent.uploader?.full_name || "—"} • {formatDate(previewGroup?.parent.created_at || "")}
              </p>
              {previewGroup?.parent.caption && (
                <div className="space-y-0.5">
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Legenda</p>
                  <p className="text-sm text-foreground">{previewGroup.parent.caption}</p>
                </div>
              )}
              {previewGroup?.parent.carousel_text && (
                <div className="space-y-0.5">
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Texto do Carrossel</p>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{previewGroup.parent.carousel_text}</p>
                </div>
              )}
              {previewGroup?.parent.description && (
                <div className="space-y-0.5">
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Descrição</p>
                  <p className="text-sm text-foreground">{previewGroup.parent.description}</p>
                </div>
              )}
              {previewGroup?.parent.approval_status === "rejected" && previewGroup.parent.feedback && (
                <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3">
                  <p className="text-[11px] text-muted-foreground mb-0.5">Feedback anterior:</p>
                  <p className="text-xs text-foreground">{previewGroup.parent.feedback}</p>
                </div>
              )}
            </div>
          )}

          {previewGroup?.parent.approval_status === "pending" && (
            <DialogFooter className="px-6 py-3 border-t border-border shrink-0">
              <Button variant="outline" className="border-destructive text-destructive hover:bg-destructive/10"
                onClick={() => { setFeedbackFileId(previewGroup.parent.id); setFeedbackText(""); setPreviewGroup(null); }}>
                ❌ Solicitar Ajuste
              </Button>
              <Button className="bg-success hover:bg-success/90 text-white"
                onClick={() => { setConfirmApprove(previewGroup.parent.id); setPreviewGroup(null); }}>
                ✅ Aprovar
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Approve confirmation */}
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
          <Textarea placeholder="Descreva as mudanças necessárias... (mínimo 10 caracteres)" value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)} rows={4} />
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
