import { useState } from "react";
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
import { FileImage, FileText, File, ExternalLink } from "lucide-react";

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

const isPdf = (name: string) => name?.toLowerCase().endsWith(".pdf");


export default function TabDeliveries({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const { data: files, isLoading } = useFiles(projectId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [confirmApprove, setConfirmApprove] = useState<string | null>(null);
  const [feedbackFileId, setFeedbackFileId] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [previewFile, setPreviewFile] = useState<any>(null);

  const formatDate = (d: string) => new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

  const handleApprove = async () => {
    if (!confirmApprove || !user) return;
    setSubmitting(true);
    try {
      await supabase.from("files").update({ approval_status: "approved" }).eq("id", confirmApprove);
      const file = files?.find((f: any) => f.id === confirmApprove);

      // Notify admin
      await notifyAdmin(`Cliente aprovou: ${file?.file_name}`, "approval", "/aprovacoes");

      await supabase.from("updates").insert({
        project_id: projectId, author_id: user.id,
        message: `Cliente aprovou: ${file?.file_name}`, update_type: "creative",
      });

      queryClient.invalidateQueries({ queryKey: ["files"] });
      toast({ title: "Aprovado!", description: "A entrega foi aprovada com sucesso." });
    } catch {
      toast({ title: "Erro", description: "Falha ao aprovar.", variant: "destructive" });
    }
    setSubmitting(false);
    setConfirmApprove(null);
    setPreviewFile(null);
  };

  const handleReject = async () => {
    if (!feedbackFileId || !user || feedbackText.trim().length < 10) return;
    setSubmitting(true);
    try {
      const file = files?.find((f: any) => f.id === feedbackFileId);
      await supabase.from("files").update({ approval_status: "rejected", feedback: feedbackText }).eq("id", feedbackFileId);

      // Notify admin
      await notifyAdmin(`Cliente solicitou ajustes em: ${file?.file_name}`, "approval", "/aprovacoes");

      await supabase.from("updates").insert({
        project_id: projectId, author_id: user.id,
        message: `Cliente solicitou ajustes em: ${file?.file_name}`, update_type: "alert",
      });

      // Create task in kanban on rejection
      const { data: fileData } = await supabase.from("files").select("project_id, uploaded_by, file_name").eq("id", feedbackFileId).maybeSingle();
      if (fileData?.project_id) {
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
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast({ title: "Feedback enviado", description: "Sua solicitação de ajuste foi registrada." });
    } catch {
      toast({ title: "Erro", description: "Falha ao enviar feedback.", variant: "destructive" });
    }
    setSubmitting(false);
    setFeedbackFileId(null);
    setFeedbackText("");
    setPreviewFile(null);
  };

  if (isLoading) return <div className="space-y-3">{[1, 2].map(i => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}</div>;
  if (!files?.length) return (
    <div className="text-sm text-muted-foreground py-8 text-center flex flex-col items-center gap-2">
      <File className="w-6 h-6 text-muted-foreground/50" />Nenhuma entrega pendente no momento
    </div>
  );

  return (
    <div className="space-y-3">
      {files.map((f: any) => {
        const Icon = fileIcons[f.file_type] || FileText;
        const badge = approvalBadge[f.approval_status] || approvalBadge.none;
        return (
          <div key={f.id} className="bg-card border border-border rounded-xl p-4 space-y-3 cursor-pointer hover:border-muted-foreground/30 transition-colors" onClick={() => setPreviewFile(f)}>
            <div className="flex items-start gap-3">
              <Icon className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{f.file_name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Enviado por {f.uploader?.full_name || "—"} • {formatDate(f.created_at)}</p>
              </div>
            </div>
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

      {/* Preview Modal */}
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
