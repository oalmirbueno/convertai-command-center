import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useFiles, useProjects } from "@/hooks/useSupabaseData";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { FileImage, FileText, Film, Archive, Download, FolderOpen } from "lucide-react";

const CLIENT_FOLDERS = [
  { id: "estrategicos", label: "📁 Estratégicos" },
  { id: "contratos", label: "📁 Contratos" },
  { id: "materiais", label: "📁 Materiais Gráficos" },
  { id: "relatorios", label: "📁 Relatórios" },
];

const fileIcon = (name: string) => {
  const ext = name?.split(".").pop()?.toLowerCase() || "";
  if (["jpg","jpeg","png","gif","webp"].includes(ext)) return FileImage;
  if (["mp4"].includes(ext)) return Film;
  if (["zip"].includes(ext)) return Archive;
  return FileText;
};

const approvalBadge: Record<string, { cls: string; label: string }> = {
  pending: { cls: "bg-warning/10 text-warning", label: "⏳ Pendente" },
  approved: { cls: "bg-success/10 text-success", label: "✓ Aprovado" },
  rejected: { cls: "bg-destructive/10 text-destructive", label: "Ajuste Solicitado" },
  none: { cls: "bg-muted text-muted-foreground", label: "—" },
};

export default function ClientDocuments() {
  const { user } = useAuth();
  const { data: files, isLoading } = useFiles(undefined, user?.id);
  const { data: projects } = useProjects();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [activeFolder, setActiveFolder] = useState("estrategicos");
  const [filterProject, setFilterProject] = useState("all");
  const [confirmApprove, setConfirmApprove] = useState<string | null>(null);
  const [feedbackFileId, setFeedbackFileId] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const filteredFiles = (files || []).filter((f: any) => {
    if ((f.folder || "estrategicos") !== activeFolder) return false;
    if (filterProject !== "all" && f.project_id !== filterProject) return false;
    return true;
  });

  const handleApprove = async () => {
    if (!confirmApprove || !user) return;
    setSubmitting(true);
    try {
      await supabase.from("files").update({ approval_status: "approved" }).eq("id", confirmApprove);
      const file = (files || []).find((f: any) => f.id === confirmApprove);
      await supabase.from("notifications").insert({
        user_id: user.id,
        message: `Cliente aprovou: ${file?.file_name}`,
        notification_type: "approval",
      });
      if (file?.project_id) {
        await supabase.from("updates").insert({
          project_id: file.project_id,
          author_id: user.id,
          message: `Cliente aprovou: ${file?.file_name}`,
          update_type: "creative",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["files"] });
      toast({ title: "Aprovado com sucesso!" });
    } catch {
      toast({ title: "Erro ao aprovar", variant: "destructive" });
    }
    setSubmitting(false);
    setConfirmApprove(null);
  };

  const handleReject = async () => {
    if (!feedbackFileId || !user || feedbackText.trim().length < 10) return;
    setSubmitting(true);
    try {
      const file = (files || []).find((f: any) => f.id === feedbackFileId);
      await supabase.from("files").update({
        approval_status: "rejected",
        feedback: feedbackText,
      }).eq("id", feedbackFileId);

      await supabase.from("notifications").insert({
        user_id: user.id,
        message: `Cliente solicitou ajustes em: ${file?.file_name}`,
        notification_type: "approval",
      });

      if (file?.project_id) {
        await supabase.from("updates").insert({
          project_id: file.project_id,
          author_id: user.id,
          message: `Cliente solicitou ajustes em: ${file?.file_name}`,
          update_type: "alert",
        });

        // Create auto task
        await supabase.from("tasks").insert({
          project_id: file.project_id,
          title: `Ajustar: ${file?.file_name}`,
          description: feedbackText,
          status: "backlog",
          priority: "high",
        });
      }

      queryClient.invalidateQueries({ queryKey: ["files"] });
      toast({ title: "Feedback enviado" });
    } catch {
      toast({ title: "Erro ao enviar feedback", variant: "destructive" });
    }
    setSubmitting(false);
    setFeedbackFileId(null);
    setFeedbackText("");
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="heading-page">Documentos</p>
        <Select value={filterProject} onValueChange={setFilterProject}>
          <SelectTrigger className="w-[200px] bg-card border-border rounded-xl text-sm">
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

      {/* Folder tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {CLIENT_FOLDERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setActiveFolder(f.id)}
            className={`px-4 py-2 text-xs uppercase tracking-wide rounded-lg whitespace-nowrap transition-colors ${
              activeFolder === f.id
                ? "text-foreground border-b-2 border-primary bg-secondary/50"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* File list */}
      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : filteredFiles.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground flex flex-col items-center gap-2">
          <FolderOpen className="w-8 h-8 text-muted-foreground/40" />
          Nenhum arquivo nesta pasta
        </div>
      ) : (
        <div className="space-y-2 stagger-children">
          {filteredFiles.map((f: any) => {
            const Icon = fileIcon(f.file_name);
            const badge = approvalBadge[f.approval_status] || approvalBadge.none;
            const showApprovalActions = activeFolder === "materiais" && f.approval_status === "pending";

            return (
              <div key={f.id} className="bg-card border border-border rounded-xl px-4 py-3 space-y-2">
                <div className="flex items-center gap-3">
                  <Icon className="w-5 h-5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-foreground truncate">
                      {f.file_name}
                      {f.version > 1 && <span className="text-xs text-muted-foreground ml-1">v{f.version}</span>}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {f.project?.name || "—"} • {formatDate(f.created_at)}
                    </p>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${badge.cls}`}>{badge.label}</span>
                  <a href={f.file_url} target="_blank" rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground transition-colors">
                    <Download className="w-4 h-4" />
                  </a>
                </div>

                {showApprovalActions && (
                  <div className="flex items-center gap-2 pl-8">
                    <Button size="sm" className="bg-success hover:bg-success/90 text-white text-[12px] rounded-lg h-7"
                      onClick={() => setConfirmApprove(f.id)}>
                      ✅ Aprovar
                    </Button>
                    <Button size="sm" variant="outline"
                      className="border-destructive text-destructive hover:bg-destructive/10 text-[12px] rounded-lg h-7"
                      onClick={() => { setFeedbackFileId(f.id); setFeedbackText(""); }}>
                      ❌ Ajustar
                    </Button>
                  </div>
                )}

                {f.approval_status === "rejected" && f.feedback && (
                  <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3 ml-8">
                    <p className="text-[11px] text-muted-foreground mb-0.5">Seu feedback:</p>
                    <p className="text-xs text-foreground">{f.feedback}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

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
