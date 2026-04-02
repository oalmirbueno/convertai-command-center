import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useFiles, useProjects } from "@/hooks/useSupabaseData";
import { useClientIdentity } from "@/hooks/useClientIdentity";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { notifyAdmin } from "@/lib/notifyHelpers";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { FileImage, FileText, Film, Archive, Download, FolderOpen, ExternalLink, ChevronLeft, ChevronRight } from "lucide-react";
import FilePreviewContent from "@/components/shared/FilePreviewContent";

function CarouselSlider({ files }: { files: any[] }) {
  const [idx, setIdx] = useState(0);
  const current = files[idx];

  if (!current) return null;
  if (files.length === 1) {
    return <FilePreviewContent fileName={current.file_name} fileUrl={current.file_url} />;
  }

  return (
    <div className="relative group">
      <FilePreviewContent fileName={current.file_name} fileUrl={current.file_url} />
      <button
        type="button"
        className="absolute z-10 left-2 top-1/2 -translate-y-1/2 bg-background/80 hover:bg-background border border-border rounded-full p-2 shadow-md opacity-80 hover:opacity-100 transition-all"
        onClick={(e) => { e.stopPropagation(); setIdx((idx - 1 + files.length) % files.length); }}
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <button
        type="button"
        className="absolute z-10 right-2 top-1/2 -translate-y-1/2 bg-background/80 hover:bg-background border border-border rounded-full p-2 shadow-md opacity-80 hover:opacity-100 transition-all"
        onClick={(e) => { e.stopPropagation(); setIdx((idx + 1) % files.length); }}
      >
        <ChevronRight className="w-4 h-4" />
      </button>
      <div className="absolute z-10 bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
        {files.map((_: any, i: number) => (
          <button
            key={i}
            type="button"
            onClick={(e) => { e.stopPropagation(); setIdx(i); }}
            className={`w-2 h-2 rounded-full transition-colors ${i === idx ? "bg-primary" : "bg-muted-foreground/40"}`}
          />
        ))}
      </div>
      <span className="absolute z-10 top-2 right-2 bg-background/80 text-[10px] px-2 py-0.5 rounded-md text-muted-foreground">
        🎠 {idx + 1}/{files.length}
      </span>
    </div>
  );
}

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

const isImage = (name: string) => {
  const ext = name?.split(".").pop()?.toLowerCase() || "";
  return ["jpg", "jpeg", "png", "gif", "webp"].includes(ext);
};

const isPdf = (name: string) => name?.toLowerCase().endsWith(".pdf");

const approvalBadge: Record<string, { cls: string; label: string }> = {
  pending: { cls: "bg-warning/10 text-warning", label: "⏳ Pendente" },
  approved: { cls: "bg-success/10 text-success", label: "✓ Aprovado" },
  rejected: { cls: "bg-destructive/10 text-destructive", label: "Ajuste Solicitado" },
  none: { cls: "bg-muted text-muted-foreground", label: "—" },
};

export default function ClientDocuments() {
  const { user } = useAuth();
  const { clientId } = useClientIdentity();
  const { data: files, isLoading } = useFiles(undefined, clientId || undefined);
  const { data: projects } = useProjects();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [activeFolder, setActiveFolder] = useState("estrategicos");
  const [filterProject, setFilterProject] = useState("all");
  const [confirmApprove, setConfirmApprove] = useState<string | null>(null);
  const [feedbackFileId, setFeedbackFileId] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [previewFile, setPreviewFile] = useState<any>(null);

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

      await notifyAdmin(`Cliente aprovou: ${file?.file_name}`, "approval", "/aprovacoes");

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
    setPreviewFile(null);
  };

  const handleReject = async () => {
    if (!feedbackFileId || !user || feedbackText.trim().length < 10) return;
    setSubmitting(true);
    try {
      await supabase.from("files").update({
        approval_status: "rejected",
        feedback: feedbackText,
      }).eq("id", feedbackFileId);

      await notifyAdmin(`Cliente solicitou ajustes em: ${(files || []).find((f: any) => f.id === feedbackFileId)?.file_name}`, "approval", "/aprovacoes");

      // Fetch complete file data for task creation
      const { data: fileData } = await supabase.from("files").select("project_id, uploaded_by, file_name").eq("id", feedbackFileId).maybeSingle();

      if (fileData?.project_id) {
        await supabase.from("updates").insert({
          project_id: fileData.project_id,
          author_id: user.id,
          message: `Cliente solicitou ajustes em: ${fileData.file_name}`,
          update_type: "alert",
        });

        // Create task in kanban on rejection
        const { error: taskErr } = await supabase.from("tasks").insert({
          project_id: fileData.project_id,
          title: `Ajustar: ${fileData.file_name}`,
          description: `Feedback do cliente:\n${feedbackText}`,
          status: "backlog",
          priority: "high",
          assigned_to: fileData.uploaded_by || null,
        });
        if (!taskErr) queryClient.invalidateQueries({ queryKey: ["tasks"] });
      }

      queryClient.invalidateQueries({ queryKey: ["files"] });
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

            return (
              <div key={f.id} className="bg-card border border-border rounded-xl px-4 py-3 cursor-pointer hover:border-muted-foreground/30 transition-colors"
                onClick={() => setPreviewFile(f)}>
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
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    onClick={(e) => e.stopPropagation()}>
                    <Download className="w-4 h-4" />
                  </a>
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
              <FilePreviewContent fileName={previewFile.file_name} fileUrl={previewFile.file_url} />
              <p className="text-xs text-muted-foreground">
                Enviado por {previewFile.uploader?.full_name || "—"} • {formatDate(previewFile.created_at)}
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
