import { useEffect, useRef, useState } from "react";
import { useFiles } from "@/hooks/useSupabaseData";
import { useClientIdentity } from "@/hooks/useClientIdentity";
import { useFileApprovalDecision } from "@/hooks/useFileApprovalDecision";
import { useEditorialApprovalPreview } from "@/hooks/useEditorialCalendar";
import { useToast } from "@/hooks/use-toast";
import { CabecalhoDePagina, Carregando, EstadoVazio, SeletorCompacto, campo, etiqueta, foco, juntar, superficie, texto, useEstadoDaTela } from "@/components/sistema";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { AlertTriangle, CheckCircle2, FileImage, FileText, Film, Archive, ExternalLink, Download, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import FilePreviewContent from "@/components/shared/FilePreviewContent";
import { openFile, downloadFile } from "@/lib/fileActions";
import { orderEditorialCarouselFiles } from "@/lib/editorialMedia";
import { isCarouselAssetGroup, mediaKindFromFile, resolveFileUrl, useResolvedFileUrl } from "@/lib/fileUrls";
import { PLATFORM_LABELS, type EditorialPlatform } from "@/lib/editorial";

const approvalBadge: Record<string, { cls: string; label: string }> = {
  pending: { cls: "bg-warning/10 text-warning border-warning/20", label: "Pendente" },
  approved: { cls: "bg-success/10 text-success border-success/20", label: "Aprovado" },
  rejected: { cls: "bg-destructive/10 text-destructive border-destructive/20", label: "Ajuste pedido" },
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

function ApprovalFileThumb({ file, className = "w-full h-full" }: { file: any; className?: string }) {
  const kind = mediaKindFromFile(file.file_name, file.file_url, file.mime_type || file.file_type, file.extension);
  const Icon = fileIcon(file.file_name);
  const { url } = useResolvedFileUrl({
    fileUrl: file.file_url,
    storageBucket: file.storage_bucket,
    storagePath: file.storage_path,
    miniatura: kind === "image",
    expiresIn: 3600,
  });

  return (
    <div className={`${className} bg-secondary flex items-center justify-center overflow-hidden relative`}>
      {url && kind === "image" ? (
        <img src={url} alt={file.file_name} loading="lazy" decoding="async" className="w-full h-full object-cover" />
      ) : url && kind === "video" ? (
        <>
          <video src={`${url}#t=0.1`} muted playsInline preload="none" className="w-full h-full object-cover" />
          <div className="absolute inset-0 flex items-center justify-center bg-background/25">
            <Film className="w-5 h-5 text-foreground" />
          </div>
        </>
      ) : (
        <Icon className="w-10 h-10 text-muted-foreground/40" />
      )}
    </div>
  );
}

/**
 * Deslizar com o dedo troca o card. No celular nao existe "passar o mouse", e
 * as setas que so apareciam no hover deixavam o cliente vendo a capa do
 * carrossel achando que era uma imagem so.
 */
function useSwipe(onPrev: () => void, onNext: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart: (event: React.TouchEvent) => {
      const touch = event.touches[0];
      start.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
    },
    onTouchEnd: (event: React.TouchEvent) => {
      const from = start.current;
      const touch = event.changedTouches[0];
      start.current = null;
      if (!from || !touch) return;
      const dx = touch.clientX - from.x;
      const dy = touch.clientY - from.y;
      if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy)) return;
      event.stopPropagation();
      if (dx > 0) onPrev(); else onNext();
    },
  };
}

function CarouselPreview({ images, small }: { images: any[]; small?: boolean }) {
  const [idx, setIdx] = useState(0);
  const prev = () => setIdx((i) => (i - 1 + images.length) % images.length);
  const next = () => setIdx((i) => (i + 1) % images.length);
  const swipe = useSwipe(prev, next);
  if (images.length === 0) return null;
  const current = images[idx] || images[0];
  const maxH = small ? "h-32" : "min-h-[200px] max-h-[400px]";

  return (
    <div className="relative group" {...(images.length > 1 ? swipe : {})}>
      <div className={`${maxH} bg-secondary flex items-center justify-center overflow-hidden`}>
        <ApprovalFileThumb file={current} />
      </div>
      {images.length > 1 && (
        <>
          <button
            type="button"
            aria-label="Card anterior"
            className="absolute left-1 top-1/2 -translate-y-1/2 bg-background/85 border border-border rounded-full p-2 shadow-md opacity-90 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
            onClick={(e) => { e.stopPropagation(); prev(); }}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label="Próximo card"
            className="absolute right-1 top-1/2 -translate-y-1/2 bg-background/85 border border-border rounded-full p-2 shadow-md opacity-90 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
            onClick={(e) => { e.stopPropagation(); next(); }}
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
  const { clientId, profile } = useClientIdentity();
  const { data: files, isLoading } = useFiles(undefined, clientId || undefined);
  const { decide, submitting, isReadOnly } = useFileApprovalDecision();
  const { toast } = useToast();

  const [confirmApprove, setConfirmApprove] = useState<string | null>(null);
  const [feedbackFileId, setFeedbackFileId] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  // Frente EA: no carrossel o cliente pode dizer qual lâmina (0 = o post todo).
  // Vai no começo do texto ("Lâmina 3: ..."): a equipe abre o Estúdio nela.
  const [feedbackLamina, setFeedbackLamina] = useState(0);
  const [previewFile, setPreviewFileRaw] = useState<any>(null);
  const [previewIdx, setPreviewIdx] = useState(0);
  const previewSwipeStart = useRef<{ x: number; y: number } | null>(null);
  const setPreviewFile = (f: any) => { setPreviewFileRaw(f); setPreviewIdx(0); };
  const [filtro, setFiltro] = useEstadoDaTela<string>("aprovacoes:filtro", "todos", {
    validar: (v) => typeof v === "string" && ["todos", "pending", "approved", "rejected"].indexOf(v) >= 0,
  });
  const editorialPreview = useEditorialApprovalPreview(
    previewFile?.id || null,
    !!previewFile,
  );

  // Keyboard arrows for carousel navigation inside preview.
  useEffect(() => {
    if (!previewFile) return;
    const len = getCarouselImages(previewFile).length;
    if (len <= 1) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setPreviewIdx((i) => (i - 1 + len) % len);
      if (e.key === "ArrowRight") setPreviewIdx((i) => (i + 1) % len);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewFile]);

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
  const approvalFiles = allFilesList.filter((f: any) =>
    f.visibility === "approval"
    && f.requires_approval === true
    && f.status === "ready"
    && !f.archived_at
    && f.approval_status !== "none"
    && !f.parent_file_id
  );

  const getCarouselImages = (f: any) => {
    const children = childrenMap.get(f.id) || [];
    if (isCarouselAssetGroup(f, children)) {
      // Ordem numerica real dos cards: "card 2" antes de "card 10" (o
      // localeCompare alfabetico embaralhava a sequencia do carrossel).
      return orderEditorialCarouselFiles(f, children);
    }
    return [f];
  };

  const handleApprove = async () => {
    if (!confirmApprove) return;
    const file = approvalFiles.find((candidate: any) => candidate.id === confirmApprove);
    if (!file) return;
    try {
      await decide({
        fileId: file.id,
        expectedVersion: file.version,
        decision: "approved",
      });
      toast({ title: "Aprovado" });
      // O aviso da equipe nasce no banco (gatilho de file_approval_events):
      // um fato, um aviso. A cópia que saía daqui duplicava o sino e o e-mail.
    } catch (error: any) {
      toast({
        title: "Erro ao aprovar",
        description: error?.message || "Atualize a página e tente novamente.",
        variant: "destructive",
      });
    }
    setConfirmApprove(null);
    setPreviewFile(null);
  };

  const handleReject = async () => {
    if (!feedbackFileId || feedbackText.trim().length < 10) return;
    const file = approvalFiles.find((candidate: any) => candidate.id === feedbackFileId);
    if (!file) return;
    try {
      await decide({
        fileId: file.id,
        expectedVersion: file.version,
        decision: "rejected",
        feedback: feedbackLamina > 0 ? `Lâmina ${feedbackLamina}: ${feedbackText.trim()}` : feedbackText,
      });
      toast({ title: "Pedido de ajuste enviado" });
      // Aviso da equipe: gatilho de file_approval_events (ver acima).
    } catch (error: any) {
      toast({
        title: "Erro ao enviar feedback",
        description: error?.message || "Atualize a página e tente novamente.",
        variant: "destructive",
      });
    }
    setFeedbackFileId(null);
    setFeedbackText("");
    setFeedbackLamina(0);
    setPreviewFile(null);
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

  const contagem = { todos: approvalFiles.length, pending: 0, approved: 0, rejected: 0 } as Record<string, number>;
  approvalFiles.forEach((f: any) => {
    if (f.approval_status in contagem) contagem[f.approval_status] += 1;
  });
  const visiveis = filtro === "todos" ? approvalFiles : approvalFiles.filter((f: any) => f.approval_status === filtro);
  const abrirComTeclado = (e: { key: string; preventDefault: () => void }, f: any) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setPreviewFile(f);
    }
  };

  return (
    <div className="min-w-0 space-y-5">
      <CabecalhoDePagina
        titulo="Aprovações"
        descricao={approvalFiles.length ? (contagem.pending ? `${contagem.pending} ${contagem.pending === 1 ? "esperando você" : "esperando você"}` : "Nada esperando você") : undefined}
        ajuda="Os materiais que a equipe preparou para você conferir antes de publicar. Toque num item para ver em tamanho grande e aprovar ou pedir ajuste. Aprovar não tem volta."
      />
      {isReadOnly && (
        <p className={juntar(texto.auxiliar, "leading-5 text-sky-600")} role="note">
          Somente leitura: dá para conferir a experiência do cliente, mas não aprovar nem pedir ajuste por ele.
        </p>
      )}

      {approvalFiles.length > 0 && (
        <SeletorCompacto
          rotulo="Filtrar aprovações"
          valor={filtro}
          onEscolher={setFiltro}
          modo="segmentado"
          listaQuandoNaoCabe
          opcoes={[
            { valor: "todos", rotulo: "Todos", contador: contagem.todos },
            { valor: "pending", rotulo: "Pendentes", contador: contagem.pending },
            { valor: "approved", rotulo: "Aprovados", contador: contagem.approved },
            { valor: "rejected", rotulo: "Com ajuste", contador: contagem.rejected },
          ]}
        />
      )}

      {isLoading ? (
        <Carregando forma="grade" linhas={3} rotulo="Carregando aprovações" />
      ) : approvalFiles.length === 0 ? (
        <EstadoVazio
          icone={<CheckCircle2 className="h-5 w-5" />}
          titulo="Nenhuma aprovação pendente"
          descricao="Quando a equipe mandar um material para você conferir, ele aparece aqui e você recebe um aviso."
        />
      ) : visiveis.length === 0 ? (
        <EstadoVazio compacto titulo="Nada neste filtro." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visiveis.map((f: any) => {
            const badge = approvalBadge[f.approval_status] || approvalBadge.pending;
            const images = getCarouselImages(f);
            const isCarousel = images.length > 1;
            return (
              <div
                key={f.id}
                role="button"
                tabIndex={0}
                aria-label={`Ver ${f.file_name}`}
                className={juntar(superficie.painel, "flex h-full min-w-0 cursor-pointer flex-col overflow-hidden transition-colors hover:border-muted-foreground/30", foco)}
                onClick={() => setPreviewFile(f)}
                onKeyDown={(e) => abrirComTeclado(e, f)}
              >
                <CarouselPreview images={images} small />
                <div className="min-w-0 px-4 py-3">
                  <div className="flex min-w-0 items-center">
                    <p className="mr-2 min-w-0 flex-1 truncate text-[14px] font-medium text-foreground">{f.file_name}</p>
                    <span className={juntar(etiqueta, "border", badge.cls)}>{badge.label}</span>
                  </div>
                  <p className={juntar(texto.auxiliar, "mt-0.5 truncate")}>
                    {isCarousel ? `Carrossel com ${images.length} cards · ` : ""}{f.project?.name || "-"} · {formatDate(f.created_at)}
                  </p>
                  {f.approval_status === "rejected" && f.feedback && (
                    <div className={juntar(superficie.poco, "mt-2 px-3 py-2")}>
                      <p className={texto.auxiliar}>Seu pedido de ajuste</p>
                      <p className="line-clamp-3 text-xs text-foreground">{f.feedback}</p>
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
              <div
                className="relative"
                {...(items.length > 1 ? {
                  onTouchStart: (event: React.TouchEvent) => {
                    const touch = event.touches[0];
                    previewSwipeStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
                  },
                  onTouchEnd: (event: React.TouchEvent) => {
                    const from = previewSwipeStart.current;
                    const touch = event.changedTouches[0];
                    previewSwipeStart.current = null;
                    if (!from || !touch) return;
                    const dx = touch.clientX - from.x;
                    const dy = touch.clientY - from.y;
                    if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy)) return;
                    setIdx(dx > 0 ? (currentIdx - 1 + items.length) % items.length : (currentIdx + 1) % items.length);
                  },
                } : {})}
              >
                <FilePreviewContent
                  fileName={current.file_name}
                  fileUrl={current.file_url}
                  fileId={current.id}
                  storageBucket={current.storage_bucket}
                  storagePath={current.storage_path}
                  mimeType={current.mime_type || current.file_type}
                  extension={current.extension}
                />
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
                      <ApprovalFileThumb file={cf} />
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={async () => {
                  const url = await resolveFileUrl({ fileUrl: current.file_url, storageBucket: current.storage_bucket, storagePath: current.storage_path });
                  openFile(url);
                }}>
                  <ExternalLink className="w-3.5 h-3.5" /> Abrir
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={async () => {
                  const url = await resolveFileUrl({ fileUrl: current.file_url, storageBucket: current.storage_bucket, storagePath: current.storage_path });
                  downloadFile(url, current.file_name);
                }}>
                  <Download className="w-3.5 h-3.5" /> Baixar
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">Enviado por {previewFile.uploader?.full_name || "-"} • {formatDate(previewFile.created_at)}</p>
              {previewFile.caption && <div className="space-y-0.5"><p className={texto.rotulo}>Legenda</p><p className="text-sm text-foreground">{previewFile.caption}</p></div>}
              {previewFile.carousel_text && <div className="space-y-0.5"><p className={texto.rotulo}>Texto do carrossel</p><p className="text-sm text-foreground whitespace-pre-wrap">{previewFile.carousel_text}</p></div>}
              {previewFile.description && <div className="space-y-0.5"><p className={texto.rotulo}>Descrição</p><p className="text-sm text-foreground">{previewFile.description}</p></div>}
              {editorialPreview.isLoading && (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Conferindo o conteúdo editorial vinculado…
                </div>
              )}
              {editorialPreview.isError && (
                <div
                  role="alert"
                  className="rounded-lg border border-destructive/20 bg-destructive/5 p-3"
                >
                  <div className="flex gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    <div>
                      <p className="text-xs font-medium text-destructive">
                        Não foi possível conferir o conteúdo editorial.
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        A decisão fica bloqueada até a prévia ser validada.
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => editorialPreview.refetch()}
                  >
                    Tentar novamente
                  </Button>
                </div>
              )}
              {!editorialPreview.isLoading
                && !editorialPreview.isError
                && (editorialPreview.data || []).map((snapshot) => (
                  <section
                    key={snapshot.post_id}
                    className="space-y-3 border-t border-border pt-4"
                  >
                    <div>
                      <p className="text-[12px] font-medium text-primary">
                        Conteúdo editorial vinculado
                      </p>
                      <p className="mt-1 text-sm font-semibold text-foreground">
                        {snapshot.title}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Formato: {snapshot.content_type}
                      </p>
                    </div>
                    {snapshot.objective && (
                      <div>
                        <p className={texto.rotulo}>
                          Objetivo
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                          {snapshot.objective}
                        </p>
                      </div>
                    )}
                    {snapshot.default_caption && (
                      <div>
                        <p className={texto.rotulo}>
                          Legenda base
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                          {snapshot.default_caption}
                        </p>
                      </div>
                    )}
                    {snapshot.plans.map((plan, planIndex) => (
                      <div
                        key={`${plan.platform}-${plan.account_handle || plan.account_name || planIndex}`}
                        className="space-y-2 rounded-md bg-muted/50 p-3"
                      >
                        <div>
                          <p className="text-xs font-medium text-foreground">
                            {PLATFORM_LABELS[
                              plan.platform as EditorialPlatform
                            ] || plan.platform}
                          </p>
                          {(plan.account_handle || plan.account_name) && (
                            <p className="text-[11px] text-muted-foreground">
                              {plan.account_handle || plan.account_name}
                            </p>
                          )}
                        </div>
                        {plan.caption && (
                          <div>
                            <p className={texto.rotulo}>
                              Legenda da plataforma
                            </p>
                            <p className="mt-1 whitespace-pre-wrap text-xs text-foreground">
                              {plan.caption}
                            </p>
                          </div>
                        )}
                        {plan.first_comment && (
                          <div>
                            <p className={texto.rotulo}>
                              Primeiro comentário
                            </p>
                            <p className="mt-1 whitespace-pre-wrap text-xs text-foreground">
                              {plan.first_comment}
                            </p>
                          </div>
                        )}
                        {plan.alt_text && (
                          <div>
                            <p className={texto.rotulo}>
                              Texto alternativo
                            </p>
                            <p className="mt-1 whitespace-pre-wrap text-xs text-foreground">
                              {plan.alt_text}
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                  </section>
                ))}
              {previewFile.approval_status === "rejected" && previewFile.feedback && (
                <div className="rounded-md bg-destructive/5 px-3 py-2">
                  <p className={juntar(texto.auxiliar, "mb-0.5")}>Pedido de ajuste anterior</p>
                  <p className="text-xs text-foreground">{previewFile.feedback}</p>
                </div>
              )}
            </div>
            );
          })()}
          {previewFile?.approval_status === "pending" && (
            <DialogFooter className="px-6 py-3 border-t border-border shrink-0">
              <Button variant="outline" className="border-destructive text-destructive hover:bg-destructive/10"
                disabled={isReadOnly || editorialPreview.isFetching || editorialPreview.isError}
                onClick={() => { if (!isReadOnly) { setFeedbackFileId(previewFile.id); setFeedbackText(""); setFeedbackLamina(0); setPreviewFile(null); } }}>
                Pedir ajuste
              </Button>
              <Button className="bg-success hover:bg-success/90 text-white"
                disabled={isReadOnly || editorialPreview.isFetching || editorialPreview.isError}
                onClick={() => { if (!isReadOnly) { setConfirmApprove(previewFile.id); setPreviewFile(null); } }}>
                Aprovar
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
            <Button className="bg-success hover:bg-success/90 text-white" onClick={handleApprove} disabled={submitting || isReadOnly}>
              {submitting ? "Aprovando..." : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Feedback dialog */}
      <Dialog open={!!feedbackFileId} onOpenChange={() => setFeedbackFileId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Pedir ajuste</DialogTitle></DialogHeader>
          {(() => {
            const arquivo = feedbackFileId ? approvalFiles.find((c: any) => c.id === feedbackFileId) : null;
            const total = arquivo ? getCarouselImages(arquivo).length : 0;
            if (total < 2) return null;
            return (
              <label className="block">
                <span className={juntar(texto.auxiliar, "mb-1 block")}>Em qual lâmina?</span>
                <select className={campo} value={feedbackLamina} onChange={(e) => setFeedbackLamina(Number(e.target.value) || 0)}>
                  <option value={0}>No post todo</option>
                  {Array.from({ length: total }, (_, i) => (
                    <option key={i + 1} value={i + 1}>Lâmina {i + 1}</option>
                  ))}
                </select>
              </label>
            );
          })()}
          <Textarea placeholder="O que precisa mudar? (mínimo 10 caracteres)"
            value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)} rows={4} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setFeedbackFileId(null)}>Cancelar</Button>
            <Button onClick={handleReject} disabled={submitting || isReadOnly || feedbackText.trim().length < 10}>
              {submitting ? "Enviando..." : "Enviar pedido de ajuste"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
