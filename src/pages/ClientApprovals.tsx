import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useFiles } from "@/hooks/useSupabaseData";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { FileImage, FileText, Film, Archive, ExternalLink } from "lucide-react";

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

const isImage = (name: string) => {
  const ext = name?.split(".").pop()?.toLowerCase() || "";
  return ["jpg", "jpeg", "png", "gif", "webp"].includes(ext);
};

const isPdf = (name: string) => name?.toLowerCase().endsWith(".pdf");

async function getAdminId() {
  const { data } = await supabase.from("user_roles").select("user_id").eq("role", "admin").limit(1).maybeSingle();
  return data?.user_id;
}

export default function ClientApprovals() {
  const { user } = useAuth();
  const { data: files, isLoading } = useFiles(undefined, user?.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [confirmApprove, setConfirmApprove] = useState<string | null>(null);
  const [feedbackFileId, setFeedbackFileId] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [previewFile, setPreviewFile] = useState<any>(null);

  const approvalFiles = (files || []).filter((f: any) => f.approval_status !== "none");

  const handleApprove = async () => {
    if (!confirmApprove || !user) return;
    setSubmitting(true);
    try {
      await supabase.from("files").update({ approval_status: "approved" }).eq("id", confirmApprove);
      const file = approvalFiles.find((f: any) => f.id === confirmApprove);

      // Notify admin (not self)
      const adminId = await getAdminId();
      if (adminId) {
        await supabase.from("notifications").insert({
          user_id: adminId,
          message: `Cliente aprovou: ${file?.file_name}`,
          notification_type: "approval", link: "/aprovacoes",
        });
      }

      if (file?.project_id) {
        await supabase.from("updates").insert({
          project_id: file.project_id, author_id: user.id,
          message: `Cliente aprovou: ${file?.file_name}`, update_type: "creative",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["files"] });
      toast({ title: "Aprovado com sucesso!" });
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
      const file = approvalFiles.find((f: any) => f.id === feedbackFileId);
      await supabase.from("files").update({ approval_status: "rejected", feedback: feedbackText }).eq("id", feedbackFileId);

      // Notify admin
      const adminId = await getAdminId();
      if (adminId) {
        await supabase.from("notifications").insert({
          user_id: adminId,
          message: `Cliente solicitou ajustes em: ${file?.file_name}`,
          notification_type: "approval", link: "/aprovacoes",
        });
      }

      if (file?.project_id) {
        await supabase.from("updates").insert({
          project_id: file.project_id, author_id: user.id,
          message: `Cliente solicitou ajustes em: ${file?.file_name}`, update_type: "alert",
        });

        // BUG 8 FIX: Create task in kanban
        await supabase.from("tasks").insert({
          project_id: file.project_id,
          title: `Ajustar: ${file?.file_name}`,
          description: `Feedback do cliente: ${feedbackText}`,
          status: "backlog", priority: "high",
          assigned_to: file.uploaded_by || null,
        });
      }

      queryClient.invalidateQueries({ queryKey: ["files"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast({ title: "Feedback enviado" });
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
            const Icon = fileIcon(f.file_name);
            const badge = approvalBadge[f.approval_status] || approvalBadge.pending;
            return (
              <div key={f.id} className="bg-card border border-border rounded-xl overflow-hidden cursor-pointer hover:border-muted-foreground/30 transition-colors"
                onClick={() => setPreviewFile(f)}>
                <div className="h-32 bg-secondary flex items-center justify-center">
                  {isImage(f.file_name) ? (
                    <img src={f.file_url} alt={f.file_name} className="w-full h-full object-cover" />
                  ) : (
                    <Icon className="w-12 h-12 text-muted-foreground/30" />
                  )}
                </div>
                <div className="p-4 space-y-2">
                  <p className="text-sm font-medium text-foreground truncate">{f.file_name}</p>
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

      {/* Preview Modal (BUG 7 FIX) */}
      <Dialog open={!!previewFile} onOpenChange={() => setPreviewFile(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{previewFile?.file_name}</DialogTitle></DialogHeader>
          {previewFile && (
            <div className="space-y-4">
              <div className="bg-secondary rounded-xl overflow-hidden flex items-center justify-center min-h-[200px]">
                {isImage(previewFile.file_name) ? (
                  <img src={previewFile.file_url} alt={previewFile.file_name} className="max-w-full max-h-[400px] object-contain" />
                ) : isPdf(previewFile.file_name) ? (
                  <a href={previewFile.file_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-primary hover:underline py-8">
                    <ExternalLink className="w-4 h-4" /> Abrir PDF
                  </a>
                ) : (
                  <a href={previewFile.file_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-primary hover:underline py-8">
                    <ExternalLink className="w-4 h-4" /> Baixar arquivo
                  </a>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Enviado por {previewFile.uploader?.full_name || "—"} • {formatDate(previewFile.created_at)}</p>
              {previewFile.caption && <div><p className="text-[11px] text-muted-foreground uppercase">Legenda</p><p className="text-sm text-foreground">{previewFile.caption}</p></div>}
              {previewFile.carousel_text && <div><p className="text-[11px] text-muted-foreground uppercase">Texto do Carrossel</p><p className="text-sm text-foreground whitespace-pre-wrap">{previewFile.carousel_text}</p></div>}
              {previewFile.description && <div><p className="text-[11px] text-muted-foreground uppercase">Descrição</p><p className="text-sm text-foreground">{previewFile.description}</p></div>}
              {previewFile.approval_status === "rejected" && previewFile.feedback && (
                <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3">
                  <p className="text-[11px] text-muted-foreground mb-0.5">Feedback anterior:</p>
                  <p className="text-xs text-foreground">{previewFile.feedback}</p>
                </div>
              )}
            </div>
          )}
          {previewFile?.approval_status === "pending" && (
            <DialogFooter>
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
