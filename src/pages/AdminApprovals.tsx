import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAllFiles, useClients } from "@/hooks/useSupabaseData";
import { useEditorialApprovalPreview } from "@/hooks/useEditorialCalendar";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { AlertTriangle, FileImage, FileText, Film, Loader2, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import FilePreviewContent from "@/components/shared/FilePreviewContent";
import { downloadFile } from "@/lib/fileActions";
import { isCarouselAssetGroup, mediaKindFromFile, resolveFileUrl, useResolvedFileUrl } from "@/lib/fileUrls";
import {
  releaseFileToClient,
  reviewFileAgency,
  type FileApprovalDecision,
  type FileReleaseMode,
} from "@/lib/fileApprovalActions";
import { PLATFORM_LABELS, type EditorialPlatform } from "@/lib/editorial";

const clientApprovalBadge: Record<string, { cls: string; label: string }> = {
  pending: { cls: "bg-warning/10 text-warning border-warning/20", label: "Aguardando cliente" },
  approved: { cls: "bg-success/10 text-success border-success/20", label: "Aprovado pelo cliente" },
  rejected: { cls: "bg-destructive/10 text-destructive border-destructive/20", label: "Cliente pediu ajustes" },
};

const agencyApprovalBadge: Record<string, { cls: string; label: string }> = {
  pending: { cls: "bg-warning/10 text-warning border-warning/20", label: "Aguardando revisão interna" },
  approved: { cls: "bg-success/10 text-success border-success/20", label: "Aprovado internamente" },
  rejected: { cls: "bg-destructive/10 text-destructive border-destructive/20", label: "Ajustes internos pedidos" },
  not_requested: { cls: "bg-muted text-muted-foreground border-border", label: "Rascunho interno" },
};

const CLIENT_TABS = [
  { id: "all", label: "Todos" },
  { id: "pending", label: "Aguardando cliente" },
  { id: "approved", label: "Aprovados" },
  { id: "rejected", label: "Pediu ajustes" },
];

const AGENCY_TABS = [
  { id: "all", label: "Todos" },
  { id: "pending", label: "Aguardando revisão" },
  { id: "approved", label: "Aprovados internamente" },
  { id: "rejected", label: "Ajustes pedidos" },
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
  const { profile } = useAuth();
  const { data: allFiles, isLoading } = useAllFiles();
  const { data: clients } = useClients();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedClient = searchParams.get("client") || "all";
  const [queue, setQueue] = useState<"agency" | "client">("agency");
  const [activeTab, setActiveTab] = useState("all");
  const [previewFile, setPreviewFile] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<any>(null);
  const [reviewFeedback, setReviewFeedback] = useState("");
  const editorialPreview = useEditorialApprovalPreview(
    previewFile?.id || null,
    !!previewFile,
  );
  const canReviewAndRelease = profile?.role === "admin" || profile?.role === "manager";

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

  const approvalFiles = allFilesList.filter((f: any) => {
    if (f.parent_file_id) return false;
    if (selectedClient !== "all" && f.client_id !== selectedClient) return false;
    if (queue === "agency") {
      return (f.agency_approval_status || "not_requested") !== "not_requested";
    }
    if (f.approval_status === "none") return false;
    return true;
  });
  const statusField = queue === "agency" ? "agency_approval_status" : "approval_status";
  const filtered = activeTab === "all"
    ? approvalFiles
    : approvalFiles.filter((f: any) => (f[statusField] || "not_requested") === activeTab);
  const pendingCount = approvalFiles.filter((f: any) => f[statusField] === "pending").length;
  const selectedClientProfile = (clients || []).find((client: any) => client.id === selectedClient);
  const tabs = queue === "agency" ? AGENCY_TABS : CLIENT_TABS;
  const activeTabLabel = tabs.find((tab) => tab.id === activeTab)?.label || "selecionado";

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
      folder: file.folder || "materiais",
      novo: "1",
      revisionOf: file.id,
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

  const refreshApprovalQueues = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["all-files"] }),
      queryClient.invalidateQueries({ queryKey: ["files"] }),
    ]);
  };

  const handleAgencyReview = async (
    file: any,
    decision: FileApprovalDecision,
    feedback?: string | null,
  ) => {
    if (!canReviewAndRelease) return;
    setSubmitting(true);
    try {
      await reviewFileAgency(file.id, decision, feedback);
      await refreshApprovalQueues();
      setPreviewFile(null);
      setReviewTarget(null);
      setReviewFeedback("");
      toast({
        title: decision === "approved" ? "Revisão interna aprovada" : "Ajustes internos solicitados",
        description: decision === "approved"
          ? "Agora um admin ou manager pode liberar esta versão ao cliente."
          : "O conteúdo continua visível somente para a equipe.",
      });
    } catch (error: any) {
      toast({
        title: "Não foi possível concluir a revisão",
        description: error?.message || "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRelease = async (file: any, mode: FileReleaseMode) => {
    if (!canReviewAndRelease) return;
    setSubmitting(true);
    try {
      await releaseFileToClient(file.id, mode);
      await refreshApprovalQueues();
      setPreviewFile(null);
      toast({
        title: mode === "approval" ? "Enviado para aprovação do cliente" : "Disponibilizado ao cliente",
        description: "A liberação foi registrada com segurança.",
      });
    } catch (error: any) {
      toast({
        title: "Não foi possível liberar a entrega",
        description: error?.message || "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
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
                {pendingCount} {queue === "agency" ? "aguardando revisão interna" : "aguardando cliente"}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Revise internamente antes de liberar e acompanhe a decisão do cliente em uma fila separada.
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

      <div className="mt-3 inline-flex items-center rounded-xl border border-border bg-card p-1">
        <button
          type="button"
          onClick={() => { setQueue("agency"); setActiveTab("all"); }}
          className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
            queue === "agency" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Revisão interna
        </button>
        <button
          type="button"
          onClick={() => { setQueue("client"); setActiveTab("all"); }}
          className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
            queue === "client" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Decisão do cliente
        </button>
      </div>

      {!canReviewAndRelease && queue === "agency" && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Você pode acompanhar a fila. Somente admin ou manager pode revisar e liberar uma entrega.
        </p>
      )}

      <div className="mt-3 flex items-center gap-1 overflow-x-auto pb-1 scrollbar-hidden">
        {tabs.map((t) => (
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
            const badge = queue === "agency"
              ? agencyApprovalBadge[f.agency_approval_status] || agencyApprovalBadge.not_requested
              : clientApprovalBadge[f.approval_status] || clientApprovalBadge.pending;
            const activeFeedback = queue === "agency" ? f.agency_feedback : f.feedback;
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

                  {f[statusField] === "rejected" && activeFeedback && (
                    <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3 mt-auto">
                      <p className="text-[11px] text-muted-foreground mb-0.5">
                        {queue === "agency" ? "Feedback interno:" : "Feedback do cliente:"}
                      </p>
                      <p className="text-xs text-foreground line-clamp-3">{activeFeedback}</p>
                    </div>
                  )}

                  {f[statusField] === "rejected" && (
                    <div className="flex gap-2 pt-1 flex-wrap">
                      <Button asChild size="sm" variant="outline" className="text-[12px] h-7 rounded-lg gap-1">
                        <Link to={getCorrectionUrl(f)} onClick={(event) => event.stopPropagation()}>
                          <RefreshCw className="w-3 h-3" /> Criar nova versão
                        </Link>
                      </Button>
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
              {editorialPreview.isLoading && (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Conferindo o conteúdo editorial vinculado…
                </div>
              )}
              {editorialPreview.isError && (
                <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                  <div className="flex gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    <div>
                      <p className="text-xs font-medium text-destructive">
                        Não foi possível conferir o conteúdo editorial.
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Revisão e liberação ficam bloqueadas até a prévia ser validada.
                      </p>
                    </div>
                  </div>
                  <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => editorialPreview.refetch()}>
                    Tentar novamente
                  </Button>
                </div>
              )}
              {!editorialPreview.isLoading
                && !editorialPreview.isError
                && (editorialPreview.data || []).map((snapshot) => (
                  <section key={snapshot.post_id} className="space-y-3 rounded-lg border border-primary/20 bg-primary/[0.04] p-4">
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wider text-primary">
                        Conteúdo editorial vinculado
                      </p>
                      <p className="mt-1 text-sm font-semibold text-foreground">{snapshot.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">Formato: {snapshot.content_type}</p>
                    </div>
                    {snapshot.objective && <p className="whitespace-pre-wrap text-xs text-foreground">{snapshot.objective}</p>}
                    {snapshot.default_caption && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Legenda base</p>
                        <p className="mt-1 whitespace-pre-wrap text-xs text-foreground">{snapshot.default_caption}</p>
                      </div>
                    )}
                    {snapshot.plans.map((plan, planIndex) => (
                      <div key={`${plan.platform}-${plan.account_handle || plan.account_name || planIndex}`} className="space-y-1.5 rounded-md border border-border bg-background/70 p-3">
                        <p className="text-xs font-medium text-foreground">
                          {PLATFORM_LABELS[plan.platform as EditorialPlatform] || plan.platform}
                          {(plan.account_handle || plan.account_name) ? ` · ${plan.account_handle || plan.account_name}` : ""}
                        </p>
                        {plan.caption && <p className="whitespace-pre-wrap text-xs text-foreground">{plan.caption}</p>}
                        {plan.first_comment && <p className="whitespace-pre-wrap text-[11px] text-muted-foreground">Primeiro comentário: {plan.first_comment}</p>}
                        {plan.alt_text && <p className="whitespace-pre-wrap text-[11px] text-muted-foreground">Texto alternativo: {plan.alt_text}</p>}
                      </div>
                    ))}
                  </section>
                ))}
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-[11px] px-2.5 py-1 rounded-full ${(agencyApprovalBadge[previewFile.agency_approval_status] || agencyApprovalBadge.not_requested).cls}`}>
                  {(agencyApprovalBadge[previewFile.agency_approval_status] || agencyApprovalBadge.not_requested).label}
                </span>
                {previewFile.approval_status !== "none" && (
                  <span className={`text-[11px] px-2.5 py-1 rounded-full ${(clientApprovalBadge[previewFile.approval_status] || clientApprovalBadge.pending).cls}`}>
                    {(clientApprovalBadge[previewFile.approval_status] || clientApprovalBadge.pending).label}
                  </span>
                )}
                {previewFile.version > 1 && (
                  <span className="text-[11px] text-muted-foreground">Versão {previewFile.version}</span>
                )}
              </div>
              {previewFile.locked_at && (
                <div className="rounded-lg border border-success/20 bg-success/[0.05] p-3">
                  <p className="text-xs text-foreground">
                    Versão final protegida contra alterações.
                  </p>
                </div>
              )}
              {previewFile.agency_approval_status === "rejected" && previewFile.agency_feedback && (
                <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                  <p className="mb-0.5 text-[11px] text-muted-foreground">Feedback interno:</p>
                  <p className="text-xs text-foreground">{previewFile.agency_feedback}</p>
                </div>
              )}
              {previewFile.approval_status === "rejected" && previewFile.feedback && (
                <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3">
                  <p className="text-[11px] text-muted-foreground mb-0.5">Feedback do cliente:</p>
                  <p className="text-xs text-foreground">{previewFile.feedback}</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="flex gap-2">
            {queue === "agency"
              && previewFile?.agency_approval_status === "pending"
              && canReviewAndRelease && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-destructive/40 text-destructive hover:bg-destructive/10"
                    disabled={submitting || editorialPreview.isFetching || editorialPreview.isError}
                    onClick={() => {
                      setReviewTarget(previewFile);
                      setReviewFeedback("");
                      setPreviewFile(null);
                    }}
                  >
                    Pedir ajustes internos
                  </Button>
                  <Button
                    size="sm"
                    disabled={submitting || editorialPreview.isFetching || editorialPreview.isError}
                    onClick={() => handleAgencyReview(previewFile, "approved")}
                  >
                    Aprovar internamente
                  </Button>
                </>
              )}
            {queue === "agency"
              && previewFile?.agency_approval_status === "approved"
              && previewFile?.visibility === "internal"
              && canReviewAndRelease && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={submitting || editorialPreview.isFetching || editorialPreview.isError}
                    onClick={() => handleRelease(previewFile, "client_shared")}
                  >
                    Disponibilizar ao cliente
                  </Button>
                  <Button
                    size="sm"
                    disabled={submitting || editorialPreview.isFetching || editorialPreview.isError}
                    onClick={() => handleRelease(previewFile, "approval")}
                  >
                    Enviar para aprovação
                  </Button>
                </>
              )}
            {previewFile?.[statusField] === "rejected" && (
              <>
                <Button asChild size="sm" variant="outline" className="gap-1">
                  <Link to={getCorrectionUrl(previewFile)} onClick={() => setPreviewFile(null)}>
                    <RefreshCw className="w-3 h-3" /> Criar nova versão
                  </Link>
                </Button>
              </>
            )}
            <Button variant="outline" className="gap-2" onClick={() => handleDownload(previewFile)}>Baixar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!reviewTarget} onOpenChange={(open) => {
        if (!open && !submitting) {
          setReviewTarget(null);
          setReviewFeedback("");
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Pedir ajustes internos</DialogTitle>
          </DialogHeader>
          <div>
            <Label htmlFor="agency-review-feedback" className="text-xs">
              Explique o que precisa ser corrigido
            </Label>
            <textarea
              id="agency-review-feedback"
              value={reviewFeedback}
              onChange={(event) => setReviewFeedback(event.target.value)}
              rows={4}
              className="mt-2 w-full resize-none rounded-xl border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
              placeholder="Feedback interno para a equipe (mínimo 10 caracteres)..."
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReviewTarget(null)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={submitting || reviewFeedback.trim().length < 10}
              onClick={() => handleAgencyReview(reviewTarget, "rejected", reviewFeedback)}
            >
              {submitting ? "Salvando..." : "Solicitar ajustes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
