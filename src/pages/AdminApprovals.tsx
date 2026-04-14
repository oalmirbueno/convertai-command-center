import { useState } from "react";
import { useAllFiles, useProjects } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { FileImage, FileText, Film, Archive, RefreshCw, ExternalLink, Zap, ChevronLeft, ChevronRight } from "lucide-react";

const approvalBadge: Record<string, { cls: string; label: string }> = {
  pending: { cls: "bg-warning/10 text-warning border-warning/20", label: "⏳ Pendente" },
  approved: { cls: "bg-success/10 text-success border-success/20", label: "✓ Aprovado" },
  rejected: { cls: "bg-destructive/10 text-destructive border-destructive/20", label: "Rejeitado" },
};

const TABS = [
  { id: "all", label: "Todos" },
  { id: "pending", label: "Pendentes" },
  { id: "approved", label: "Aprovados" },
  { id: "rejected", label: "Rejeitados" },
];

const fileIcon = (name: string) => {
  const ext = name?.split(".").pop()?.toLowerCase() || "";
  if (["jpg","jpeg","png","gif","webp"].includes(ext)) return FileImage;
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
  return ["jpg","jpeg","png","gif","webp"].includes(ext);
};

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
            className="absolute left-1 top-1/2 -translate-y-1/2 bg-background/80 hover:bg-background border border-border rounded-full p-1.5 shadow-md opacity-80 hover:opacity-100 transition-all"
            onClick={(e) => { e.stopPropagation(); setIdx((idx - 1 + images.length) % images.length); }}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            className="absolute right-1 top-1/2 -translate-y-1/2 bg-background/80 hover:bg-background border border-border rounded-full p-1.5 shadow-md opacity-80 hover:opacity-100 transition-all"
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

export default function AdminApprovals() {
  const { user } = useAuth();
  const { data: allFiles, isLoading } = useAllFiles();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("all");
  const [previewFile, setPreviewFile] = useState<any>(null);

  // Build carousel children map
  const allFilesList = allFiles || [];
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
  const filtered = activeTab === "all" ? approvalFiles : approvalFiles.filter((f: any) => f.approval_status === activeTab);
  const pendingCount = approvalFiles.filter((f: any) => f.approval_status === "pending").length;

  const getCarouselImages = (f: any) => {
    const children = childrenMap.get(f.id) || [];
    if (children.length > 0) {
      return [f, ...children.sort((a: any, b: any) => a.file_name.localeCompare(b.file_name))];
    }
    return [f];
  };

  const handleResend = async (fileId: string) => {
    try {
      const file = approvalFiles.find((f: any) => f.id === fileId);
      await supabase.from("files").update({ approval_status: "pending", feedback: null }).eq("id", fileId);
      if (file?.project_id) {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (authUser) {
          await supabase.from("updates").insert({
            project_id: file.project_id, author_id: authUser.id,
            message: `Criativo reenviado para aprovação: ${file.file_name}`, update_type: "delivery",
          });
        }
        if (file.client_id) {
          await supabase.from("notifications").insert({
            user_id: file.client_id,
            message: `Criativo atualizado para aprovação: ${file.file_name}`,
            notification_type: "approval",
            link: "/aprovacoes",
          });
        }
      }
      queryClient.invalidateQueries({ queryKey: ["all-files"] });
      toast({ title: "Reenviado para aprovação" });
    } catch {
      toast({ title: "Erro", variant: "destructive" });
    }
  };

  const handleCreateAdjustTask = async (file: any) => {
    try {
      await supabase.from("tasks").insert({
        project_id: file.project_id,
        title: `Ajustar: ${file.file_name}`,
        description: `Feedback do cliente:\n${file.feedback || "Sem detalhes"}`,
        status: "backlog",
        priority: "high",
        assigned_to: file.uploaded_by || null,
      });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast({ title: "Tarefa criada no Kanban!" });
    } catch {
      toast({ title: "Erro ao criar tarefa", variant: "destructive" });
    }
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <p className="heading-page">Aprovações</p>
          {pendingCount > 0 && (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-warning/10 text-warning">
              {pendingCount} pendente{pendingCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2 text-xs uppercase tracking-wide rounded-lg whitespace-nowrap transition-colors ${
              activeTab === t.id
                ? "text-foreground border-b-2 border-primary bg-secondary/50"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Nenhuma aprovação encontrada</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start stagger-children">
          {filtered.map((f: any) => {
            const badge = approvalBadge[f.approval_status] || approvalBadge.pending;
            const images = getCarouselImages(f);
            const isCarousel = images.length > 1;
            return (
              <div key={f.id} className="bg-card border border-border rounded-xl overflow-hidden cursor-pointer hover:border-muted-foreground/30 transition-colors flex flex-col"
                onClick={() => setPreviewFile(f)}>
                <CarouselPreview images={images} small />
                <div className="p-4 space-y-2 flex-1 flex flex-col">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground truncate">{f.file_name}</p>
                    {isCarousel && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary whitespace-nowrap">
                        Carrossel • {images.length}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
                    <span className="truncate max-w-[120px]">{f.project?.name || "—"}</span>
                    <span>•</span>
                    <span className="truncate max-w-[120px]">{f.client?.company_name || f.client?.full_name || "—"}</span>
                  </div>
                  <p className="text-[11px] font-mono text-muted-foreground">{formatDate(f.created_at)}</p>

                  <span className={`inline-block text-[11px] px-2.5 py-1 rounded-full border self-start ${badge.cls}`}>
                    {badge.label}
                  </span>

                  {f.approval_status === "rejected" && f.feedback && (
                    <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3 mt-auto">
                      <p className="text-[11px] text-muted-foreground mb-0.5">Feedback do cliente:</p>
                      <p className="text-xs text-foreground line-clamp-3">{f.feedback}</p>
                    </div>
                  )}

                  {f.approval_status === "rejected" && (
                    <div className="flex gap-2 pt-1 flex-wrap">
                      <Button size="sm" variant="outline" className="text-[12px] h-7 rounded-lg gap-1"
                        onClick={(e) => { e.stopPropagation(); handleResend(f.id); }}>
                        <RefreshCw className="w-3 h-3" /> Reenviar
                      </Button>
                      {f.project_id && (
                        <Button size="sm" variant="outline" className="text-[12px] h-7 rounded-lg gap-1 border-warning/50 text-warning hover:bg-warning/10"
                          onClick={(e) => { e.stopPropagation(); handleCreateAdjustTask(f); }}>
                          <Zap className="w-3 h-3" /> Criar Tarefa
                        </Button>
                      )}
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {previewFile?.file_name}
              {previewFile && getCarouselImages(previewFile).length > 1 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                  Carrossel • {getCarouselImages(previewFile).length} imagens
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          {previewFile && (
            <div className="space-y-4">
              <div className="bg-secondary rounded-xl overflow-hidden">
                <CarouselPreview images={getCarouselImages(previewFile)} />
              </div>
              <p className="text-xs text-muted-foreground">
                Enviado por {previewFile.uploader?.full_name || "—"} • {formatDate(previewFile.created_at)}
              </p>
              {previewFile.caption && <div><p className="text-[11px] text-muted-foreground uppercase">Legenda</p><p className="text-sm text-foreground">{previewFile.caption}</p></div>}
              {previewFile.carousel_text && <div><p className="text-[11px] text-muted-foreground uppercase">Texto do Carrossel</p><p className="text-sm text-foreground whitespace-pre-wrap">{previewFile.carousel_text}</p></div>}
              {previewFile.description && <div><p className="text-[11px] text-muted-foreground uppercase">Descrição</p><p className="text-sm text-foreground">{previewFile.description}</p></div>}
              <div className="flex items-center gap-2">
                <span className={`text-[11px] px-2.5 py-1 rounded-full ${(approvalBadge[previewFile.approval_status] || approvalBadge.pending).cls}`}>
                  {(approvalBadge[previewFile.approval_status] || approvalBadge.pending).label}
                </span>
              </div>
              {previewFile.approval_status === "rejected" && previewFile.feedback && (
                <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3">
                  <p className="text-[11px] text-muted-foreground mb-0.5">Feedback do cliente:</p>
                  <p className="text-xs text-foreground">{previewFile.feedback}</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="flex gap-2">
            {previewFile?.approval_status === "rejected" && (
              <>
                <Button size="sm" variant="outline" className="gap-1"
                  onClick={() => { handleResend(previewFile.id); setPreviewFile(null); }}>
                  <RefreshCw className="w-3 h-3" /> Reenviar
                </Button>
                {previewFile.project_id && (
                  <Button size="sm" variant="outline" className="gap-1 border-warning/50 text-warning hover:bg-warning/10"
                    onClick={() => { handleCreateAdjustTask(previewFile); setPreviewFile(null); }}>
                    <Zap className="w-3 h-3" /> Criar Tarefa
                  </Button>
                )}
              </>
            )}
            <a href={previewFile?.file_url} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" className="gap-2">Baixar</Button>
            </a>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
