import { useState } from "react";
import { useFiles } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { FileImage, FileText, File } from "lucide-react";

const approvalBadge: Record<string, { className: string; label: string }> = {
  pending: { className: "bg-warning/10 text-warning", label: "⏳ Aguardando Aprovação" },
  approved: { className: "bg-success/10 text-success", label: "✓ Aprovado" },
  rejected: { className: "bg-destructive/10 text-destructive", label: "Ajuste Solicitado" },
  none: { className: "bg-muted text-muted-foreground", label: "Sem status" },
};

const fileIcons: Record<string, any> = {
  creative: FileImage,
  document: FileText,
  report: FileText,
};

export default function TabDeliveries({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const { data: files, isLoading } = useFiles(projectId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [confirmApprove, setConfirmApprove] = useState<string | null>(null);
  const [feedbackFileId, setFeedbackFileId] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const formatDate = (d: string) => {
    return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  };

  const handleApprove = async () => {
    if (!confirmApprove || !user) return;
    setSubmitting(true);
    try {
      await supabase.from("files").update({ approval_status: "approved" }).eq("id", confirmApprove);

      // Create notification for admin
      await supabase.from("notifications").insert({
        user_id: user.id, // will be intercepted by admin via RLS
        message: `Cliente aprovou entrega`,
        notification_type: "approval",
      });

      // Create update
      const file = files?.find((f: any) => f.id === confirmApprove);
      await supabase.from("updates").insert({
        project_id: projectId,
        author_id: user.id,
        message: `Cliente aprovou: ${file?.file_name}`,
        update_type: "creative",
      });

      queryClient.invalidateQueries({ queryKey: ["files"] });
      toast({ title: "Aprovado!", description: "A entrega foi aprovada com sucesso." });
    } catch (e) {
      toast({ title: "Erro", description: "Falha ao aprovar.", variant: "destructive" });
    }
    setSubmitting(false);
    setConfirmApprove(null);
  };

  const handleReject = async () => {
    if (!feedbackFileId || !user || feedbackText.trim().length < 10) return;
    setSubmitting(true);
    try {
      await supabase.from("files").update({
        approval_status: "rejected",
        feedback: feedbackText,
      }).eq("id", feedbackFileId);

      const file = files?.find((f: any) => f.id === feedbackFileId);

      // Create notification for admin
      await supabase.from("notifications").insert({
        user_id: user.id,
        message: `Cliente solicitou ajustes em: ${file?.file_name}`,
        notification_type: "approval",
      });

      // Create update
      await supabase.from("updates").insert({
        project_id: projectId,
        author_id: user.id,
        message: `Cliente solicitou ajustes em: ${file?.file_name}`,
        update_type: "alert",
      });

      queryClient.invalidateQueries({ queryKey: ["files"] });
      queryClient.invalidateQueries({ queryKey: ["project-updates"] });
      toast({ title: "Feedback enviado", description: "Sua solicitação de ajuste foi registrada." });
    } catch (e) {
      toast({ title: "Erro", description: "Falha ao enviar feedback.", variant: "destructive" });
    }
    setSubmitting(false);
    setFeedbackFileId(null);
    setFeedbackText("");
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2].map(i => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}
      </div>
    );
  }

  if (!files?.length) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center flex flex-col items-center gap-2">
        <File className="w-6 h-6 text-muted-foreground/50" />
        Nenhuma entrega pendente no momento
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {files.map((f: any) => {
        const Icon = fileIcons[f.file_type] || FileText;
        const badge = approvalBadge[f.approval_status] || approvalBadge.none;
        return (
          <div key={f.id} className="bg-card border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-start gap-3">
              <Icon className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{f.file_name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Enviado por {f.uploader?.full_name || "—"} • {formatDate(f.created_at)}
                </p>
              </div>
            </div>

            <div>
              <span className={`text-[11px] px-2 py-0.5 rounded-full ${badge.className}`}>
                {badge.label}
              </span>
            </div>

            {f.approval_status === "pending" && (
              <div className="flex items-center gap-2 pt-1">
                <Button
                  size="sm"
                  className="bg-success hover:bg-success/90 text-white text-[13px] rounded-lg"
                  onClick={() => setConfirmApprove(f.id)}
                >
                  ✅ Aprovar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-destructive text-destructive hover:bg-destructive/10 text-[13px] rounded-lg"
                  onClick={() => { setFeedbackFileId(f.id); setFeedbackText(""); }}
                >
                  ❌ Solicitar Ajuste
                </Button>
              </div>
            )}

            {f.approval_status === "rejected" && f.feedback && (
              <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3 mt-2">
                <p className="text-xs text-muted-foreground mb-1">Feedback enviado:</p>
                <p className="text-xs text-foreground">{f.feedback}</p>
              </div>
            )}
          </div>
        );
      })}

      {/* Approve confirmation */}
      <Dialog open={!!confirmApprove} onOpenChange={() => setConfirmApprove(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirmar aprovação?</DialogTitle>
          </DialogHeader>
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
          <DialogHeader>
            <DialogTitle>Solicitar Ajuste</DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder="Descreva as mudanças necessárias... (mínimo 10 caracteres)"
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setFeedbackFileId(null)}>Cancelar</Button>
            <Button
              onClick={handleReject}
              disabled={submitting || feedbackText.trim().length < 10}
            >
              {submitting ? "Enviando..." : "Enviar Feedback"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
