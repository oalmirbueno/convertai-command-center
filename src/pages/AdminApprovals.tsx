import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAllFiles, useClients } from "@/hooks/useSupabaseData";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileImage, FileText, Film, RefreshCw, Zap, ChevronLeft, ChevronRight } from "lucide-react";
import FilePreviewContent from "@/components/shared/FilePreviewContent";
import { downloadFile } from "@/lib/fileActions";
import { isCarouselAssetGroup, mediaKindFromFile, resolveFileUrl, useResolvedFileUrl } from "@/lib/fileUrls";

const approvalBadge: Record<string, { cls: string; label: string }> = {
  pending: { cls: "bg-warning/10 text-warning border-warning/20", label: "Aguardando cliente" },
  approved: { cls: "bg-success/10 text-success border-success/20", label: "Aprovado pelo cliente" },
  rejected: { cls: "bg-destructive/10 text-destructive border-destructive/20", label: "Cliente pediu ajustes" },
};

const TABS = [
  { id: "all", label: "Todos" },
  { id: "pending", label: "Aguardando cliente" },
  { id: "approved", label: "Aprovados" },
  { id: "rejected", label: "Pediu ajustes" },
];

function ApprovalThumb({ file }: { file: any }) {
  const kind = mediaKindFromFile(file.file_name, file.file_url, file.mime_type || file.file_type, file.extension);
  const { url } = useResolvedFileUrl({
    fileUrl: file.file_url,
    storageBucket: file.storage_bucket,
    storagePath: file.storage_path,
    transform: kind === "image" ? { width: 640, quality: 72, resize: "cover" } : null,
    expiresIn: 3600,
  });

  if (kind === "image" && url) {
    return <img src={url} alt={file.file_name} className="w-full h-full object-cover" loading="lazy" />;
  }
  if (kind === "video" && url) {
    return <video src={`${url}#t=0.1`} className="w-full h-full object-cover" muted playsInline preload="metadata" />;
  }
  const Icon = kind === "video" ? Film : kind === "image" ? FileImage : FileText;
  return <Icon className="w-12 h-12 text-muted-foreground/30" />;
}

function CarouselPreview({ images, small }: { images: any[]; small?: boolean }) {
  const [idx, setIdx] = useState(0);
  if (images.length === 0) return null;
  const current = images[idx];
  const maxH = small ? "h-32" : "min-h-[260px]";

  return (
    <div className="relative group">
      <div className={`${maxH} bg-secondary flex items-center justify-center overflow-hidden`}>
        {small ? (
          <ApprovalThumb file={current} />
        ) : (
          <div className="w-full">
            <FilePreviewContent
              fileName={current.file_name}
              fileUrl={current.file_url}
              fileId={current.id}
              storageBucket={current.storage_bucket}
              storagePath={current.storage_path}
              mimeType={current.mime_type || current.file_type}
              extension={current.extension}
            />
          </div>
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
  const { data: allFiles, isLoading } = useAllFiles();
  const { data: clients } = useClients();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedClient = searchParams.get("client") || "all";
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
  const approvalFiles = allFilesList.filter((f: any) => {
    if (f.approval_status === "none" || f.parent_file_id) return false;
    if (selectedClient !== "all" && f.client_id !== selectedClient) return false;
    return true;
  });
  const filtered = activeTab === "all" ? approvalFiles : approvalFiles.filter((f: any) => f.approval_status === activeTab);
  const pendingCount = approvalFiles.filter((f: any) => f.approval_status === "pending").length;
  const selectedClientProfile = (clients || []).find((client: any) => client.id === selectedClient);
  const activeTabLabel = TABS.find((tab) => tab.id === activeTab)?.label || "selecionado";

  const handleClientChange = (clientId: string) => {
    const next = new URLSearchParams(searchParams);
    if (clientId === "all") {
      next.delete("client");
    } else {
      next.set("client", clientId);
    }
    setActiveTab("all");
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    if (!clients || selectedClient === "all") return;
    const clientExists = clients.some((client: any) => client.id === selectedClient);
    if (clientExists) return;

    const next = new URLSearchParams(searchParams);
    next.delete("client");
    setActiveTab("all");
    setSearchParams(next, { replace: true });
    toast({
      title: "Cliente não encontrado",
      description: "O filtro foi removido. Escolha um cliente existente.",
      variant: "destructive",
    });
  }, [clients, searchParams, selectedClient, setSearchParams, toast]);

  const getCarouselImages = (f: any) => {
    const children = childrenMap.get(f.id) || [];
    if (isCarouselAssetGroup(f, children)) {
      return [f, ...children.sort((a: any, b: any) => a.file_name.localeCompare(b.file_name))];
    }
    return [f];
  };

  const getCorrectionUrl = (file: any) => {
    const params = new URLSearchParams({
      client: file.client_id,
      folder: "materiais",
      novo: "1",
    });
    return `/arquivos?${params.toString()}`;
  };

  const handleDownload = async (file: any) => {
    if (!file) return;
    const url = await resolveFileUrl({
      fileUrl: file.file_url,
      storageBucket: file.storage_bucket,
      storagePath: file.storage_path,
      expiresIn: 3600,
    });
    await downloadFile(url, file.file_name);
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
    <div className="-mx-4 flex h-full min-h-0 flex-col animate-fade-in md:mx-0 md:block md:h-auto md:space-y-6">
      <div className="shrink-0 border-b border-border/60 bg-background/95 px-4 pb-3 backdrop-blur-sm md:border-b-0 md:bg-transparent md:px-0 md:pb-0 md:backdrop-blur-none">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <p className="heading-page">Aprovações</p>
            {pendingCount > 0 && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-warning/10 text-warning">
                {pendingCount} aguardando cliente
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Acompanhe a decisão do cliente e os pedidos de ajuste.
          </p>
        </div>

        <Select value={selectedClient} onValueChange={handleClientChange}>
          <SelectTrigger className="w-full bg-card border-border rounded-xl text-sm sm:w-[240px]">
            <SelectValue placeholder="Todos os clientes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os clientes</SelectItem>
            {(clients || []).map((client: any) => (
              <SelectItem key={client.id} value={client.id}>
                {client.company_name || client.full_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedClientProfile && (
        <div className="mt-3 flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/[0.04] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Cliente selecionado
            </p>
            <p className="mt-0.5 text-sm font-medium text-foreground">
              {selectedClientProfile.company_name || selectedClientProfile.full_name}
            </p>
          </div>
          <Link
            to={`/arquivos?client=${encodeURIComponent(selectedClient)}&folder=materiais&novo=1`}
            className="inline-flex items-center justify-center rounded-lg border border-primary bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Novo conteúdo
          </Link>
        </div>
      )}

      <div className="mt-3 flex items-center gap-1 overflow-x-auto pb-1 scrollbar-hidden">
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
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-4 md:overflow-visible md:px-0 md:pt-0 md:pb-0">
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center text-sm text-muted-foreground">
          <p>
            {activeTab !== "all"
              ? `Nenhum item em "${activeTabLabel}"${selectedClientProfile ? ` para ${selectedClientProfile.company_name || selectedClientProfile.full_name}` : ""}.`
              : selectedClientProfile
              ? `Nenhuma aprovação encontrada para ${selectedClientProfile.company_name || selectedClientProfile.full_name}.`
              : "Nenhuma aprovação encontrada."}
          </p>
          {activeTab !== "all" ? (
            <button
              type="button"
              onClick={() => setActiveTab("all")}
              className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-primary/40"
            >
              Ver todas as aprovações
            </button>
          ) : selectedClientProfile ? (
            <Link
              to={`/arquivos?client=${encodeURIComponent(selectedClient)}&folder=materiais&novo=1`}
              className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-primary/40"
            >
              Criar conteúdo
            </Link>
          ) : null}
        </div>
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
                      <Button asChild size="sm" variant="outline" className="text-[12px] h-7 rounded-lg gap-1">
                        <Link to={getCorrectionUrl(f)} onClick={(event) => event.stopPropagation()}>
                          <RefreshCw className="w-3 h-3" /> Criar correção
                        </Link>
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
      </div>

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
                <Button asChild size="sm" variant="outline" className="gap-1">
                  <Link to={getCorrectionUrl(previewFile)} onClick={() => setPreviewFile(null)}>
                    <RefreshCw className="w-3 h-3" /> Criar correção
                  </Link>
                </Button>
                {previewFile.project_id && (
                  <Button size="sm" variant="outline" className="gap-1 border-warning/50 text-warning hover:bg-warning/10"
                    onClick={() => { handleCreateAdjustTask(previewFile); setPreviewFile(null); }}>
                    <Zap className="w-3 h-3" /> Criar Tarefa
                  </Button>
                )}
              </>
            )}
            <Button variant="outline" className="gap-2" onClick={() => handleDownload(previewFile)}>Baixar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
