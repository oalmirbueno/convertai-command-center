import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useFiles, useProjects } from "@/hooks/useSupabaseData";
import { useClientIdentity } from "@/hooks/useClientIdentity";
import { useFileApprovalDecision } from "@/hooks/useFileApprovalDecision";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AjudaRecolhida, CabecalhoDePagina, Carregando, EstadoVazio, SeletorCompacto, botao, etiqueta, foco, juntar, lista, superficie, texto, useEstadoDaTela } from "@/components/sistema";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { FileImage, FileText, Film, Archive, Download, FolderOpen, ExternalLink } from "lucide-react";
import CarouselSlider from "@/components/shared/CarouselSlider";
import { openFile, downloadFile } from "@/lib/fileActions";
import { mediaKindFromFile, resolveFileUrl, useResolvedFileUrl } from "@/lib/fileUrls";
import {
  fileLocationLabel,
  matchesFolderFilter,
  summarizeFiles,
  type FileKindId,
  type FolderId,
} from "@/lib/fileTaxonomy";

// CarouselSlider is imported from shared components (auto-fetches sibling slides).

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
  pending: { cls: "bg-warning/10 text-warning", label: "Pendente" },
  approved: { cls: "bg-success/10 text-success", label: "Aprovado" },
  rejected: { cls: "bg-destructive/10 text-destructive", label: "Ajuste Solicitado" },
  none: { cls: "bg-muted text-muted-foreground", label: "Sem status" },
};

function ClientFileThumb({ file }: { file: any }) {
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
    <div className="w-14 h-14 rounded-lg bg-secondary border border-border overflow-hidden flex items-center justify-center shrink-0 relative">
      {url && kind === "image" ? (
        <img src={url} alt={file.file_name} loading="lazy" decoding="async" className="w-full h-full object-cover" />
      ) : url && kind === "video" ? (
        <>
          <video src={`${url}#t=0.1`} muted playsInline preload="none" className="w-full h-full object-cover" />
          <div className="absolute inset-0 flex items-center justify-center bg-background/25">
            <Film className="w-4 h-4 text-foreground" />
          </div>
        </>
      ) : (
        <Icon className="w-5 h-5 text-muted-foreground" />
      )}
    </div>
  );
}

export default function ClientDocuments() {
  const { clientId } = useClientIdentity();
  const { data: files, isLoading } = useFiles(undefined, clientId || undefined);
  const { data: projects } = useProjects();
  const { decide, submitting, isReadOnly } = useFileApprovalDecision();
  const { toast } = useToast();

  const [searchParams] = useSearchParams();
  // Pasta, tipo e projeto ficam lembrados ao sair e voltar (por cliente).
  const lembrar = (k: string) => `documentos:${k}:${clientId || ""}`;
  const ehTexto = (v: unknown) => typeof v === "string";
  const [activeFolder, setActiveFolder] = useEstadoDaTela<FolderId | "todos">(lembrar("pasta"), "todos", { validar: ehTexto });
  const [activeKind, setActiveKind] = useEstadoDaTela<FileKindId | null>(lembrar("tipo"), null, { validar: (v) => v === null || ehTexto(v) });
  // A aba Entregas do projeto aponta para ca com ?project=: uma area so.
  const [projetoGuardado, setFilterProject] = useEstadoDaTela<string>(lembrar("projeto"), "all", { validar: ehTexto });
  const [projetoDoEndereco] = useState(() => searchParams.get("project"));
  const [usouEndereco, setUsouEndereco] = useState(false);
  const filterProject = projetoDoEndereco && !usouEndereco ? projetoDoEndereco : projetoGuardado;
  useEffect(() => {
    if (projetoDoEndereco && !usouEndereco) {
      setFilterProject(projetoDoEndereco);
      setUsouEndereco(true);
    }
  }, [projetoDoEndereco, usouEndereco, setFilterProject]);
  const [confirmApprove, setConfirmApprove] = useState<string | null>(null);
  const [feedbackFileId, setFeedbackFileId] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [previewFile, setPreviewFile] = useState<any>(null);

  // Build children map for carousel grouping
  const childrenMap = new Map<string, any[]>();
  const childIds = new Set<string>();
  (files || []).forEach((f: any) => {
    if (f.parent_file_id) {
      childIds.add(f.id);
      const arr = childrenMap.get(f.parent_file_id) || [];
      arr.push(f);
      childrenMap.set(f.parent_file_id, arr);
    }
  });

  // Base visível: tudo o que o banco liberou para esta pessoa (RLS decide), sem
  // o filtro de pasta - é sobre ela que as contagens dos botões são calculadas,
  // para o número no botão bater com o que aparece ao clicar.
  const visibleFiles = (files || []).filter((f: any) => {
    if (childIds.has(f.id)) return false; // filho de carrossel aparece junto do pai
    if (f.status !== "ready" || f.archived_at) return false;
    if (filterProject !== "all" && f.project_id !== filterProject) return false;
    return true;
  });

  // Só entram na barra as pastas que realmente têm algo: nada de aba vazia.
  const folderSummaries = summarizeFiles(visibleFiles).filter((entry) => entry.total > 0);
  const activeSummary = folderSummaries.find((entry) => entry.folder.id === activeFolder) || null;
  const kindChips = activeSummary && activeSummary.byKind.length > 1 ? activeSummary.byKind : [];

  const filteredFiles = visibleFiles.filter((f: any) =>
    matchesFolderFilter(f, activeFolder, activeKind),
  );

  const selectFolder = (folder: FolderId | "todos") => {
    setActiveFolder(folder);
    setActiveKind(null);
  };

  const handleApprove = async () => {
    if (!confirmApprove) return;
    const file = (files || []).find((candidate: any) => candidate.id === confirmApprove);
    if (!file) return;
    try {
      await decide({
        fileId: file.id,
        expectedVersion: file.version,
        decision: "approved",
      });
      toast({ title: "Aprovado" });
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
    const file = (files || []).find((candidate: any) => candidate.id === feedbackFileId);
    if (!file) return;
    try {
      await decide({
        fileId: file.id,
        expectedVersion: file.version,
        decision: "rejected",
        feedback: feedbackText,
      });
      toast({ title: "Feedback enviado" });
    } catch (error: any) {
      toast({
        title: "Erro ao enviar feedback",
        description: error?.message || "Atualize a página e tente novamente.",
        variant: "destructive",
      });
    }
    setFeedbackFileId(null);
    setFeedbackText("");
    setPreviewFile(null);
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

  const opcoesDeProjeto = [{ valor: "all", rotulo: "Todos os projetos" }].concat(
    (projects || []).map((p: any) => ({ valor: String(p.id), rotulo: p.name || "Projeto" })),
  );
  const opcoesDePasta = [{ valor: "todos", rotulo: "Tudo", contador: visibleFiles.length }].concat(
    folderSummaries.map((entry) => ({ valor: entry.folder.id as string, rotulo: entry.folder.label, contador: entry.total })),
  );
  const abrirComTeclado = (e: { key: string; preventDefault: () => void }, f: any) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setPreviewFile(f);
    }
  };

  return (
    <div className="min-w-0 space-y-5">
      <CabecalhoDePagina
        titulo="Documentos"
        descricao={
          [
            visibleFiles.length ? `${visibleFiles.length} ${visibleFiles.length === 1 ? "item" : "itens"}` : "",
            isReadOnly ? "somente leitura" : "",
          ].filter(Boolean).join(" · ") || undefined
        }
        ajuda={
          <>
            Tudo o que a equipe liberou para você: materiais, entregas e documentos. Toque num item para ver, baixar ou, quando estiver pendente, aprovar ou pedir ajuste.
            {isReadOnly && " Somente leitura: aprovar e pedir ajuste ficam bloqueados enquanto você vê como cliente."}
          </>
        }
      />

      {/* Uma barra só: projeto, pasta (com quantos itens tem em cada uma) e tipo.
          Antes eram duas linhas de filtro. */}
      {((projects || []).length > 0 || visibleFiles.length > 0) && (
        <div className="-m-1 flex min-w-0 flex-wrap items-center [&>*]:m-1">
          {(projects || []).length > 0 && (
            <SeletorCompacto
              modo="lista"
              rotulo="Projeto"
              icone={<FolderOpen className="h-3.5 w-3.5" />}
              valor={filterProject}
              onEscolher={setFilterProject}
              opcoes={opcoesDeProjeto}
              className="max-w-[180px] sm:max-w-[240px]"
            />
          )}
          {visibleFiles.length > 0 && (
            <SeletorCompacto
              rotulo="Pasta"
              icone={<FolderOpen className="h-3.5 w-3.5" />}
              valor={activeFolder}
              onEscolher={(v) => selectFolder(v as FolderId | "todos")}
              opcoes={opcoesDePasta}
            />
          )}
          {/* Dentro da pasta: carrossel, post, story, vídeo... */}
          {visibleFiles.length > 0 && kindChips.length > 0 && (
            <SeletorCompacto
              modo="lista"
              rotulo="Tipo"
              valor={activeKind || "__todos"}
              onEscolher={(v) => setActiveKind(v === "__todos" ? null : (v as FileKindId))}
              opcoes={[{ valor: "__todos", rotulo: "Todos os tipos" }].concat(
                kindChips.map((entry) => ({ valor: entry.kind.id as string, rotulo: entry.kind.label, contador: entry.total } as any)),
              )}
            />
          )}
          {visibleFiles.length > 0 && activeSummary && activeSummary.folder.hint && (
            <AjudaRecolhida rotulo={`O que tem em ${activeSummary.folder.label}`}>{activeSummary.folder.hint}</AjudaRecolhida>
          )}
        </div>
      )}

      {/* File list */}
      {isLoading ? (
        <Carregando linhas={4} rotulo="Carregando documentos" />
      ) : filteredFiles.length === 0 ? (
        <EstadoVazio
          icone={<FolderOpen className="h-5 w-5" />}
          titulo="Nenhum material liberado ainda"
          descricao="Quando a equipe liberar um material ou pedir sua aprovação, ele aparece aqui na hora."
        />
      ) : (
        <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Documentos">
          {filteredFiles.map((f: any) => {
            const badge = approvalBadge[f.approval_status] || approvalBadge.none;

            return (
              <li
                key={f.id}
                role="button"
                tabIndex={0}
                aria-label={`Ver ${f.file_name}`}
                className={juntar("min-w-0 cursor-pointer rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/40", foco)}
                onClick={() => setPreviewFile(f)}
                onKeyDown={(e) => abrirComTeclado(e, f)}
              >
                <div className="flex min-w-0 items-center">
                  <ClientFileThumb file={f} />
                  <div className="ml-3 min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-foreground">
                      {f.file_name}
                      {f.version > 1 && <span className="ml-1 text-[11px] text-muted-foreground">v{f.version}</span>}
                    </p>
                    <p className={juntar(texto.auxiliar, "truncate")}>
                      {fileLocationLabel(f)} · {f.project?.name || "Sem projeto"} · {formatDate(f.created_at)}
                    </p>
                    {f.approval_status !== "none" && (
                      <span className={juntar(etiqueta, "mt-1 sm:hidden", badge.cls)}>{badge.label}</span>
                    )}
                  </div>
                  {f.approval_status !== "none" && (
                    <span className={juntar(etiqueta, "ml-2 hidden sm:inline-flex", badge.cls)}>{badge.label}</span>
                  )}
                  <button
                    type="button"
                    title="Baixar"
                    aria-label={`Baixar ${f.file_name}`}
                    className={juntar(botao.icone, "ml-1")}
                    onClick={async (e) => {
                      e.stopPropagation();
                      const url = await resolveFileUrl({ fileUrl: f.file_url, storageBucket: f.storage_bucket, storagePath: f.storage_path });
                      downloadFile(url, f.file_name);
                    }}>
                    <Download className="h-4 w-4" />
                  </button>
                </div>

                {f.approval_status === "rejected" && f.feedback && (
                  <div className={juntar(superficie.poco, "ml-[68px] mt-2 px-3 py-2")}>
                    <p className={texto.auxiliar}>Seu pedido de ajuste</p>
                    <p className="text-[12px] text-foreground">{f.feedback}</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Preview Modal */}
      <Dialog open={!!previewFile} onOpenChange={() => setPreviewFile(null)}>
        <DialogContent className="max-w-2xl p-0 gap-0 flex flex-col max-h-[90vh]">
          <DialogHeader className="px-6 pt-5 pb-3 shrink-0 border-b border-border">
            <DialogTitle className="truncate pr-6 text-[15px]">{previewFile?.file_name}</DialogTitle>
          </DialogHeader>
          {previewFile && (
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <CarouselSlider parent={previewFile} initialChildren={childrenMap.get(previewFile.id) || []} />
              
              {/* Action buttons */}
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={async () => {
                  const url = await resolveFileUrl({ fileUrl: previewFile.file_url, storageBucket: previewFile.storage_bucket, storagePath: previewFile.storage_path });
                  openFile(url);
                }}>
                  <ExternalLink className="w-3.5 h-3.5" /> Abrir
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={async () => {
                  const url = await resolveFileUrl({ fileUrl: previewFile.file_url, storageBucket: previewFile.storage_bucket, storagePath: previewFile.storage_path });
                  downloadFile(url, previewFile.file_name);
                }}>
                  <Download className="w-3.5 h-3.5" /> Baixar
                </Button>
              </div>

              <p className="text-[12px] text-muted-foreground">
                Enviado por {previewFile.uploader?.full_name || "-"} • {formatDate(previewFile.created_at)}
              </p>
              {previewFile.caption && (
                <div className="space-y-0.5">
                  <p className={texto.rotulo}>Legenda</p>
                  <p className="text-[13px] text-foreground">{previewFile.caption}</p>
                </div>
              )}
              {previewFile.carousel_text && (
                <div className="space-y-0.5">
                  <p className={texto.rotulo}>Texto do carrossel</p>
                  <p className="whitespace-pre-wrap text-[13px] text-foreground">{previewFile.carousel_text}</p>
                </div>
              )}
              {previewFile.description && (
                <div className="space-y-0.5">
                  <p className={texto.rotulo}>Descrição</p>
                  <p className="text-[13px] text-foreground">{previewFile.description}</p>
                </div>
              )}
              {previewFile.approval_status === "rejected" && previewFile.feedback && (
                <div className="rounded-md bg-destructive/5 px-3 py-2">
                  <p className={juntar(texto.auxiliar, "mb-0.5")}>Pedido de ajuste anterior</p>
                  <p className="text-[12px] text-foreground">{previewFile.feedback}</p>
                </div>
              )}
            </div>
          )}
          {previewFile?.approval_status === "pending" && (
            <DialogFooter className="px-6 py-3 border-t border-border shrink-0">
              <Button variant="outline" className="border-destructive text-destructive hover:bg-destructive/10"
                disabled={isReadOnly}
                onClick={() => { if (!isReadOnly) { setFeedbackFileId(previewFile.id); setFeedbackText(""); setPreviewFile(null); } }}>
                Pedir ajuste
              </Button>
              <Button className="bg-success hover:bg-success/90 text-white"
                disabled={isReadOnly}
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
          <p className="text-[13px] text-muted-foreground">Esta ação não pode ser desfeita.</p>
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
