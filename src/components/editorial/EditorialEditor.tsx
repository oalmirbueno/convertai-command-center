import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  UNSAFE_NavigationContext,
  useBeforeUnload,
} from "react-router-dom";
import {
  AlertCircle,
  CalendarClock,
  FileCheck2,
  FileImage,
  Film,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import {
  useEditorialEditorOptions,
  useEditorialMutations,
  type EditorialFileRow,
  type EditorialPostBundle,
} from "@/hooks/useEditorialCalendar";
import {
  EDITORIAL_DEFAULT_TIME_ZONE,
  isoUtcToZonedDateTimeLocal,
  zonedDateTimeLocalToIso,
} from "@/lib/editorialDate";
import {
  PLATFORM_LABELS,
  PRODUCTION_STATUS_LABELS,
  isFileEditable,
  isFilePublishable,
  type EditorialPlatform,
} from "@/lib/editorial";

interface Option {
  id: string;
  name: string;
  client_id?: string;
  role?: string;
}

interface PublicationDraft {
  id?: string;
  idempotencyKey: string;
  externalAccountId: string;
  fileId: string;
  caption: string;
  firstComment: string;
  altText: string;
  scheduledAt: string;
  timezone: string;
}

interface EditorialEditorProps {
  open: boolean;
  post: EditorialPostBundle | null;
  revisionOf?: EditorialPostBundle | null;
  clients: Option[];
  projects: Option[];
  teamMembers: Option[];
  defaultClientId?: string;
  defaultProjectId?: string;
  defaultScheduledAt?: string;
  defaultTaskId?: string;
  defaultTitle?: string;
  defaultResponsibleId?: string;
  defaultProductionStatus?: "draft" | "production" | "ready" | "cancelled";
  onOpenChange: (open: boolean) => void;
  onSaved: (postId: string) => void;
}

const contentTypes = [
  { value: "static", label: "Post estático" },
  { value: "carousel", label: "Carrossel" },
  { value: "reel", label: "Reel" },
  { value: "story", label: "Story" },
  { value: "video", label: "Vídeo" },
  { value: "short", label: "Short" },
  { value: "article", label: "Artigo" },
  { value: "google_post", label: "Post Google" },
  { value: "other", label: "Outro" },
];

const editableProductionStatuses = [
  "draft",
  "production",
  "ready",
  "cancelled",
] as const;

function newIdempotencyKey() {
  return crypto.randomUUID();
}

function emptyPublication(
  scheduledAt = "",
  externalAccountId = "",
): PublicationDraft {
  return {
    idempotencyKey: newIdempotencyKey(),
    externalAccountId,
    fileId: "",
    caption: "",
    firstComment: "",
    altText: "",
    scheduledAt,
    timezone: EDITORIAL_DEFAULT_TIME_ZONE,
  };
}

function fileGateLabel(file: EditorialFileRow | null | undefined) {
  if (!file) return null;
  if (isFilePublishable(file)) return "Aprovado para publicar";
  if (file.agency_approval_status !== "approved") {
    return "Aguardando aprovação interna";
  }
  if (file.approval_status !== "approved") {
    return "Aguardando aprovação do cliente";
  }
  return "Ainda não liberado para publicação";
}

export default function EditorialEditor({
  open,
  post,
  revisionOf = null,
  clients,
  projects,
  teamMembers,
  defaultClientId = "",
  defaultProjectId = "",
  defaultScheduledAt = "",
  defaultTaskId = "",
  defaultTitle = "",
  defaultResponsibleId = "",
  defaultProductionStatus = "draft",
  onOpenChange,
  onSaved,
}: EditorialEditorProps) {
  const { savePost } = useEditorialMutations();
  const { navigator } = useContext(UNSAFE_NavigationContext);
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [contentType, setContentType] = useState("static");
  const [objective, setObjective] = useState("");
  const [defaultCaption, setDefaultCaption] = useState("");
  const [productionStatus, setProductionStatus] = useState("draft");
  const [primaryFileId, setPrimaryFileId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [responsibleId, setResponsibleId] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [postIdempotencyKey, setPostIdempotencyKey] =
    useState(newIdempotencyKey);
  const [publications, setPublications] = useState<PublicationDraft[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [pendingMutationId, setPendingMutationId] =
    useState<string | null>(null);
  const dirtyNavigationRef = useRef(false);
  const savingNavigationRef = useRef(false);

  useEffect(() => {
    dirtyNavigationRef.current = open && hasChanges;
  }, [hasChanges, open]);

  useEffect(() => {
    savingNavigationRef.current = savePost.isPending;
  }, [savePost.isPending]);

  useBeforeUnload(
    useCallback((event) => {
      if (!dirtyNavigationRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    }, []),
  );

  useEffect(() => {
    if (!open) return;

    const originalPush = navigator.push;
    const originalReplace = navigator.replace;
    const originalGo = navigator.go;
    const confirmNavigation = () => {
      if (savingNavigationRef.current) {
        toast.info("Aguarde o salvamento terminar antes de sair.");
        return false;
      }
      if (
        !dirtyNavigationRef.current ||
        window.confirm("Descartar as alterações não salvas?")
      ) {
        dirtyNavigationRef.current = false;
        setHasChanges(false);
        setPendingMutationId(null);
        return true;
      }
      return false;
    };
    const guardedPush: typeof navigator.push = (...args) => {
      if (confirmNavigation()) originalPush.apply(navigator, args);
    };
    const guardedReplace: typeof navigator.replace = (...args) => {
      if (confirmNavigation()) originalReplace.apply(navigator, args);
    };
    const guardedGo: typeof navigator.go = (...args) => {
      if (confirmNavigation()) originalGo.apply(navigator, args);
    };

    navigator.push = guardedPush;
    navigator.replace = guardedReplace;
    navigator.go = guardedGo;

    return () => {
      if (navigator.push === guardedPush) navigator.push = originalPush;
      if (navigator.replace === guardedReplace) {
        navigator.replace = originalReplace;
      }
      if (navigator.go === guardedGo) navigator.go = originalGo;
    };
  }, [navigator, open]);

  const {
    data: options,
    isLoading: loadingOptions,
    isError: optionsError,
    error: optionsErrorDetail,
    refetch: refetchOptions,
  } = useEditorialEditorOptions(
    clientId || null,
    projectId || null,
    open,
  );

  useEffect(() => {
    if (!open) return;

    if (post) {
      setClientId(post.post.client_id);
      setProjectId(post.post.project_id);
      setTitle(post.post.title);
      setContentType(post.post.content_type);
      setObjective(post.post.objective || "");
      setDefaultCaption(post.post.default_caption || "");
      setProductionStatus(post.post.production_status);
      setPrimaryFileId(post.post.primary_file_id || "");
      setTaskId(post.internal?.task_id || "");
      setResponsibleId(post.internal?.responsible_id || "");
      setInternalNotes(post.internal?.internal_notes || "");
      setPostIdempotencyKey(
        post.internal?.idempotency_key || newIdempotencyKey(),
      );
      setPublications(
        post.publications
          .filter(
            ({ publication }) => publication.status !== "cancelled",
          )
          .map(({ publication, internal }) => ({
            id: publication.id,
            idempotencyKey:
              internal?.idempotency_key || newIdempotencyKey(),
            externalAccountId: publication.external_account_id,
            fileId: publication.file_id || "",
            caption: publication.caption || "",
            firstComment: publication.first_comment || "",
            altText: publication.alt_text || "",
            scheduledAt: publication.scheduled_at
              ? isoUtcToZonedDateTimeLocal(
                  publication.scheduled_at,
                  publication.scheduled_timezone,
                ) || ""
              : "",
            timezone:
              publication.scheduled_timezone ||
              EDITORIAL_DEFAULT_TIME_ZONE,
          })),
      );
      setHasChanges(false);
      setPendingMutationId(null);
      return;
    }

    setClientId(revisionOf?.post.client_id || defaultClientId);
    setProjectId(revisionOf?.post.project_id || defaultProjectId);
    setTitle(revisionOf ? revisionOf.post.title : defaultTitle);
    setContentType(revisionOf?.post.content_type || "static");
    setObjective(revisionOf?.post.objective || "");
    setDefaultCaption(revisionOf?.post.default_caption || "");
    setProductionStatus(
      revisionOf ? "draft" : defaultProductionStatus,
    );
    setPrimaryFileId("");
    setTaskId(
      revisionOf
        ? revisionOf.internal?.task_id || ""
        : defaultTaskId,
    );
    setResponsibleId(
      revisionOf
        ? revisionOf.internal?.responsible_id || ""
        : defaultResponsibleId,
    );
    setInternalNotes(revisionOf?.internal?.internal_notes || "");
    setPostIdempotencyKey(newIdempotencyKey());
    setPublications(
      revisionOf
        ? revisionOf.publications
            .filter(
              ({ publication }) => publication.status !== "cancelled",
            )
            .map(({ publication }) => ({
              idempotencyKey: newIdempotencyKey(),
              externalAccountId: publication.external_account_id,
              fileId: "",
              caption: publication.caption || "",
              firstComment: publication.first_comment || "",
              altText: publication.alt_text || "",
              scheduledAt: "",
              timezone:
                publication.scheduled_timezone ||
                EDITORIAL_DEFAULT_TIME_ZONE,
            }))
        : defaultScheduledAt
          ? [emptyPublication(defaultScheduledAt)]
          : [],
    );
    setHasChanges(false);
    setPendingMutationId(null);
  }, [
    defaultClientId,
    defaultProductionStatus,
    defaultProjectId,
    defaultResponsibleId,
    defaultScheduledAt,
    defaultTaskId,
    defaultTitle,
    open,
    post,
    revisionOf,
  ]);

  const filteredProjects = useMemo(
    () =>
      projects.filter(
        (project) => !clientId || project.client_id === clientId,
      ),
    [clientId, projects],
  );
  const allowedTeamMembers = useMemo(() => {
    const assignments = new Set(options?.assignments || []);
    return teamMembers.filter(
      (member) =>
        member.role === "admin" || assignments.has(member.id),
    );
  }, [options?.assignments, teamMembers]);
  const selectedFile =
    options?.files.find((file) => file.id === primaryFileId) ||
    (
      post?.primaryFile?.id === primaryFileId
        ? post.primaryFile
        : undefined
    );
  const primaryContentLocked = Boolean(
    post?.post.primary_file_id &&
      (
        loadingOptions ||
        !selectedFile ||
        !isFileEditable(selectedFile)
      ),
  );
  const publicationContentLocked = Boolean(
    post?.publications.some(
      ({ publication, file }) =>
        publication.status !== "cancelled" &&
        Boolean(publication.file_id) &&
        (!file || !isFileEditable(file)),
    ),
  );
  const contentLocked =
    primaryContentLocked || publicationContentLocked;
  const cancelledAccountIds = useMemo(
    () =>
      new Set(
        (post?.publications || [])
          .filter(
            ({ publication }) => publication.status === "cancelled",
          )
          .map(
            ({ publication }) => publication.external_account_id,
          ),
      ),
    [post],
  );
  const selectableFiles = useMemo(
    () => {
      const candidates =
        post?.primaryFile &&
        !(options?.files || []).some(
          (file) => file.id === post.primaryFile?.id,
        )
          ? [post.primaryFile, ...(options?.files || [])]
          : (options?.files || []);
      return candidates.filter(
        (file) =>
          isFileEditable(file) ||
          file.id === post?.post.primary_file_id,
      );
    },
    [
      options?.files,
      post?.post.primary_file_id,
      post?.primaryFile,
    ],
  );

  const markChanged = () => {
    setHasChanges(true);
    setPendingMutationId(null);
  };

  const updatePublication = (
    index: number,
    patch: Partial<PublicationDraft>,
  ) => {
    markChanged();
    setPublications((current) =>
      current.map((publication, itemIndex) =>
        itemIndex === index ? { ...publication, ...patch } : publication,
      ),
    );
  };

  const addPublication = () => {
    const usedAccountIds = new Set(
      [
        ...publications.map(
          (publication) => publication.externalAccountId,
        ),
        ...cancelledAccountIds,
      ],
    );
    const firstAvailable = options?.accounts.find(
      (account) => !usedAccountIds.has(account.id),
    );
    setPublications((current) => [
      ...current,
      emptyPublication(defaultScheduledAt, firstAvailable?.id || ""),
    ]);
    markChanged();
  };

  const handleClientChange = (value: string) => {
    markChanged();
    setClientId(value);
    setProjectId("");
    setPrimaryFileId("");
    setTaskId("");
    setResponsibleId("");
    setPublications([]);
  };

  const handleProjectChange = (value: string) => {
    markChanged();
    setProjectId(value);
    setPrimaryFileId("");
    setTaskId("");
    setResponsibleId("");
    setPublications([]);
  };

  const openMediaUploader = (
    mode: "single" | "carousel" | "video_link",
  ) => {
    if (!clientId || !projectId) return;
    const params = new URLSearchParams({
      client: clientId,
      project: projectId,
      folder: "criativos",
      novo: "1",
      mode,
    });
    window.open(
      `/arquivos?${params.toString()}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const handleSave = async () => {
    if (!clientId || !projectId || !title.trim()) {
      toast.error("Preencha cliente, projeto e título.");
      return;
    }
    if (revisionOf && !primaryFileId) {
      toast.error(
        "Selecione a nova versão editável do arquivo para criar a revisão.",
      );
      return;
    }
    if (
      publications.some(
        (publication) => !publication.externalAccountId,
      )
    ) {
      toast.error("Escolha uma conta em cada publicação.");
      return;
    }

    try {
      const mutationId = pendingMutationId || newIdempotencyKey();
      setPendingMutationId(mutationId);
      const publicationPayload = publications.map((publication) => {
        const scheduledAt = publication.scheduledAt
          ? zonedDateTimeLocalToIso(
              publication.scheduledAt,
              publication.timezone,
            )
          : null;
        if (publication.scheduledAt && !scheduledAt) {
          throw new Error(
            "Um dos horários não existe no fuso selecionado. Ajuste a data.",
          );
        }
        return {
          id: publication.id || null,
          idempotency_key: publication.idempotencyKey,
          external_account_id: publication.externalAccountId,
          file_id: publication.fileId || null,
          caption: publication.caption.trim() || null,
          first_comment: publication.firstComment.trim() || null,
          alt_text: publication.altText.trim() || null,
          scheduled_at: scheduledAt,
          scheduled_timezone: publication.timezone,
        };
      });

      savingNavigationRef.current = true;
      const result = await savePost.mutateAsync({
        payload: {
          id: post?.post.id || null,
          idempotency_key: postIdempotencyKey,
          mutation_id: mutationId,
          client_id: clientId,
          project_id: projectId,
          primary_file_id: primaryFileId || null,
          title: title.trim(),
          content_type: contentType,
          objective: objective.trim() || null,
          default_caption: defaultCaption.trim() || null,
          production_status: productionStatus,
          task_id: taskId || null,
          responsible_id: responsibleId || null,
          internal_notes: internalNotes.trim() || null,
          revision_of_post_id: revisionOf?.post.id || null,
          publications: publicationPayload,
        },
        expectedVersion: post?.post.version || null,
      });
      setPendingMutationId(null);
      setHasChanges(false);
      dirtyNavigationRef.current = false;
      savingNavigationRef.current = false;
      toast.success(
        post
          ? "Conteúdo atualizado."
          : revisionOf
            ? "Revisão editorial criada."
            : "Conteúdo criado.",
      );
      onSaved(result.post_id);
      onOpenChange(false);
    } catch (error: unknown) {
      savingNavigationRef.current = false;
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar o conteúdo.",
      );
    }
  };

  const requestOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && savePost.isPending) return;
    if (
      !nextOpen &&
      hasChanges &&
      !window.confirm("Descartar as alterações não salvas?")
    ) {
      return;
    }
    onOpenChange(nextOpen);
  };

  return (
    <Sheet open={open} onOpenChange={requestOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>
            {post
              ? "Editar conteúdo editorial"
              : revisionOf
                ? "Nova revisão editorial"
                : "Novo conteúdo editorial"}
          </SheetTitle>
          <SheetDescription>
            {revisionOf
              ? "Escolha a nova versão do arquivo e revise o copy antes de enviar novamente para aprovação."
              : "Prepare o conteúdo e os planos por plataforma. Agendar e confirmar publicação são ações separadas."}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 py-6">
          <section className="grid gap-4 rounded-xl border border-border p-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="editorial-client">Cliente</Label>
              <Select
                value={clientId}
                onValueChange={handleClientChange}
                disabled={!!post || !!revisionOf}
              >
                <SelectTrigger id="editorial-client">
                  <SelectValue placeholder="Selecione o cliente" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="editorial-project">Projeto</Label>
              <Select
                value={projectId}
                onValueChange={handleProjectChange}
                disabled={!clientId || !!post || !!revisionOf}
              >
                <SelectTrigger id="editorial-project">
                  <SelectValue placeholder="Selecione o projeto" />
                </SelectTrigger>
                <SelectContent>
                  {filteredProjects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="editorial-title">Título</Label>
              <Input
                id="editorial-title"
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  markChanged();
                }}
                disabled={contentLocked}
                maxLength={180}
                placeholder="Ex.: Lançamento da campanha de agosto"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editorial-type">Formato</Label>
              <Select
                value={contentType}
                onValueChange={(value) => {
                  setContentType(value);
                  markChanged();
                }}
                disabled={contentLocked}
              >
                <SelectTrigger id="editorial-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {contentTypes.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="editorial-production-status">
                Etapa de produção
              </Label>
              <Select
                value={productionStatus}
                onValueChange={(value) => {
                  setProductionStatus(value);
                  markChanged();
                }}
              >
                <SelectTrigger id="editorial-production-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {editableProductionStatuses.map((status) => (
                    <SelectItem key={status} value={status}>
                      {PRODUCTION_STATUS_LABELS[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="editorial-objective">Objetivo</Label>
              <Input
                id="editorial-objective"
                value={objective}
                onChange={(event) => {
                  setObjective(event.target.value);
                  markChanged();
                }}
                disabled={contentLocked}
                placeholder="Objetivo de comunicação ou campanha"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="editorial-caption">Legenda base</Label>
              <Textarea
                id="editorial-caption"
                value={defaultCaption}
                onChange={(event) => {
                  setDefaultCaption(event.target.value);
                  markChanged();
                }}
                disabled={contentLocked}
                rows={4}
                placeholder="Texto base que pode ser adaptado por plataforma"
              />
            </div>
          </section>

          {contentLocked && (
            <div className="flex gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
              <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  Conteúdo protegido pela aprovação
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Mídia e textos não podem mudar nesta versão. Etapa de
                  produção, horário, tarefa, responsável e notas internas
                  continuam editáveis.
                </p>
              </div>
            </div>
          )}

          <section className="space-y-4 rounded-xl border border-border p-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Produção e aprovação
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                O calendário reutiliza os registros existentes de Arquivos,
                Aprovações e Kanban.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-muted/25 p-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-xs font-semibold text-foreground">
                    Mídia do conteúdo
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Envie pela biblioteca atual e depois atualize a lista.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!clientId || !projectId}
                    onClick={() => openMediaUploader("single")}
                  >
                    <Upload className="mr-1.5 h-3.5 w-3.5" />
                    Arquivo
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!clientId || !projectId}
                    onClick={() => openMediaUploader("carousel")}
                  >
                    <FileImage className="mr-1.5 h-3.5 w-3.5" />
                    Carrossel
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!clientId || !projectId}
                    onClick={() => openMediaUploader("video_link")}
                  >
                    <Film className="mr-1.5 h-3.5 w-3.5" />
                    Vídeo
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!clientId || !projectId || loadingOptions}
                    onClick={() => refetchOptions()}
                  >
                    <RefreshCw
                      className={`mr-1.5 h-3.5 w-3.5 ${
                        loadingOptions ? "animate-spin" : ""
                      }`}
                    />
                    Atualizar biblioteca
                  </Button>
                </div>
              </div>
            </div>
            {loadingOptions ? (
              <div className="flex h-20 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : optionsError ? (
              <div className="flex min-h-24 flex-col items-center justify-center rounded-lg border border-destructive/25 bg-destructive/5 p-4 text-center">
                <AlertCircle className="mb-2 h-5 w-5 text-destructive" />
                <p className="text-xs text-muted-foreground">
                  {optionsErrorDetail instanceof Error
                    ? optionsErrorDetail.message
                    : "Não foi possível carregar Arquivos, tarefas e plataformas."}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => refetchOptions()}
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Recarregar
                </Button>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="editorial-file">Arquivo principal</Label>
                  <Select
                    value={primaryFileId || "none"}
                    onValueChange={(value) =>
                      {
                        setPrimaryFileId(
                          value === "none" ? "" : value,
                        );
                        markChanged();
                      }
                    }
                    disabled={!projectId || contentLocked}
                  >
                    <SelectTrigger id="editorial-file">
                      <SelectValue placeholder="Vincular arquivo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem arquivo</SelectItem>
                      {selectableFiles.map((file) => (
                        <SelectItem key={file.id} value={file.id}>
                          {file.file_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedFile && (
                    <Badge
                      variant="outline"
                      className={
                        isFilePublishable(selectedFile)
                          ? "border-success/30 bg-success/10 text-success"
                          : "border-warning/30 bg-warning/10 text-warning"
                      }
                    >
                      <FileCheck2 className="mr-1 h-3 w-3" />
                      {fileGateLabel(selectedFile)}
                    </Badge>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editorial-task">Tarefa do Kanban</Label>
                  <Select
                    value={taskId || "none"}
                    onValueChange={(value) =>
                      {
                        setTaskId(value === "none" ? "" : value);
                        markChanged();
                      }
                    }
                    disabled={!projectId}
                  >
                    <SelectTrigger id="editorial-task">
                      <SelectValue placeholder="Vincular tarefa" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem tarefa</SelectItem>
                      {(options?.tasks || []).map((task) => (
                        <SelectItem key={task.id} value={task.id}>
                          {task.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editorial-responsible">Responsável</Label>
                  <Select
                    value={responsibleId || "none"}
                    onValueChange={(value) =>
                      {
                        setResponsibleId(
                          value === "none" ? "" : value,
                        );
                        markChanged();
                      }
                    }
                    disabled={!clientId}
                  >
                    <SelectTrigger id="editorial-responsible">
                      <SelectValue placeholder="Escolher responsável" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem responsável</SelectItem>
                      {allowedTeamMembers.map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                          {member.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editorial-notes">Notas internas</Label>
                  <Textarea
                    id="editorial-notes"
                    value={internalNotes}
                    onChange={(event) => {
                      setInternalNotes(event.target.value);
                      markChanged();
                    }}
                    rows={3}
                    placeholder="Nunca visível ao cliente"
                  />
                </div>
              </div>
            )}
          </section>

          <section className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  Publicações por plataforma
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Cada conta pode ter horário, legenda e arquivo próprios.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addPublication}
                disabled={
                  !projectId ||
                  loadingOptions ||
                  optionsError ||
                  contentLocked ||
                  !(options?.accounts || []).some(
                    (account) =>
                      !cancelledAccountIds.has(account.id) &&
                      !publications.some(
                        (publication) =>
                          publication.externalAccountId === account.id,
                      ),
                  ) ||
                  (options?.accounts.length || 0) <= publications.length
                }
              >
                <Plus className="mr-1.5 h-4 w-4" />
                Plataforma
              </Button>
            </div>

            {projectId && !loadingOptions && options?.accounts.length === 0 && (
              <div className="rounded-xl border border-dashed border-border bg-muted/20 p-5 text-center">
                <p className="text-sm text-foreground">
                  Nenhuma conta de publicação ligada a este projeto.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Vincule as plataformas no cadastro do cliente antes de montar
                  o plano.
                </p>
              </div>
            )}

            {publications.map((publication, index) => {
              const fieldPrefix = `editorial-publication-${
                publication.id || publication.idempotencyKey
              }`;
              const account = options?.accounts.find(
                (item) => item.id === publication.externalAccountId,
              );
              const currentPublicationFile = post?.publications.find(
                ({ publication: savedPublication }) =>
                  savedPublication.id === publication.id,
              )?.file;
              const publicationFiles =
                currentPublicationFile &&
                !(options?.files || []).some(
                  (file) => file.id === currentPublicationFile.id,
                )
                  ? [currentPublicationFile, ...(options?.files || [])]
                  : (options?.files || []);
              const selectablePublicationFiles = publicationFiles.filter(
                (file) =>
                  isFileEditable(file) ||
                  file.id === publication.fileId,
              );
              const usedByOthers = new Set(
                [
                  ...publications
                    .filter((_, itemIndex) => itemIndex !== index)
                    .map((item) => item.externalAccountId),
                  ...cancelledAccountIds,
                ],
              );
              return (
                <div
                  key={publication.id || publication.idempotencyKey}
                  className="space-y-4 rounded-xl border border-border bg-card p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <CalendarClock className="h-4 w-4 text-primary" />
                      <p className="text-sm font-medium text-foreground">
                        {account
                          ? PLATFORM_LABELS[
                              account.platform as EditorialPlatform
                            ] || account.platform
                          : `Publicação ${index + 1}`}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      disabled={contentLocked}
                      onClick={() =>
                        {
                          setPublications((current) =>
                            current.filter(
                              (_, itemIndex) => itemIndex !== index,
                            ),
                          );
                          markChanged();
                        }
                      }
                      aria-label="Remover publicação"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor={`${fieldPrefix}-account`}>Conta</Label>
                      <Select
                        value={publication.externalAccountId}
                        disabled={contentLocked}
                        onValueChange={(value) =>
                          updatePublication(index, {
                            externalAccountId: value,
                          })
                        }
                      >
                        <SelectTrigger id={`${fieldPrefix}-account`}>
                          <SelectValue placeholder="Selecione a conta" />
                        </SelectTrigger>
                        <SelectContent>
                          {(options?.accounts || [])
                            .filter(
                              (item) =>
                                item.id ===
                                  publication.externalAccountId ||
                                !usedByOthers.has(item.id),
                            )
                            .map((item) => (
                              <SelectItem key={item.id} value={item.id}>
                                {PLATFORM_LABELS[
                                  item.platform as EditorialPlatform
                                ] || item.platform}
                                {" · "}
                                {item.handle || item.display_name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`${fieldPrefix}-scheduled-at`}>
                        Data e horário
                      </Label>
                      <Input
                        id={`${fieldPrefix}-scheduled-at`}
                        type="datetime-local"
                        value={publication.scheduledAt}
                        onChange={(event) =>
                          updatePublication(index, {
                            scheduledAt: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`${fieldPrefix}-file`}>
                        Arquivo específico
                      </Label>
                      <Select
                        value={publication.fileId || "primary"}
                        disabled={contentLocked}
                        onValueChange={(value) =>
                          updatePublication(index, {
                            fileId: value === "primary" ? "" : value,
                          })
                        }
                      >
                        <SelectTrigger id={`${fieldPrefix}-file`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="primary">
                            Usar arquivo principal
                          </SelectItem>
                          {selectablePublicationFiles.map((file) => (
                            <SelectItem key={file.id} value={file.id}>
                              {file.file_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`${fieldPrefix}-timezone`}>Fuso</Label>
                      <Select
                        value={publication.timezone}
                        onValueChange={(value) =>
                          updatePublication(index, { timezone: value })
                        }
                      >
                        <SelectTrigger id={`${fieldPrefix}-timezone`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="America/Sao_Paulo">
                            Brasília
                          </SelectItem>
                          <SelectItem value="America/Manaus">Manaus</SelectItem>
                          <SelectItem value="America/Recife">Recife</SelectItem>
                          <SelectItem value="UTC">UTC</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor={`${fieldPrefix}-caption`}>
                        Legenda da plataforma
                      </Label>
                      <Textarea
                        id={`${fieldPrefix}-caption`}
                        value={publication.caption}
                        disabled={contentLocked}
                        onChange={(event) =>
                          updatePublication(index, {
                            caption: event.target.value,
                          })
                        }
                        rows={3}
                        placeholder={defaultCaption || "Legenda adaptada"}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`${fieldPrefix}-first-comment`}>
                        Primeiro comentário
                      </Label>
                      <Textarea
                        id={`${fieldPrefix}-first-comment`}
                        value={publication.firstComment}
                        disabled={contentLocked}
                        onChange={(event) =>
                          updatePublication(index, {
                            firstComment: event.target.value,
                          })
                        }
                        rows={2}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`${fieldPrefix}-alt-text`}>
                        Texto alternativo
                      </Label>
                      <Textarea
                        id={`${fieldPrefix}-alt-text`}
                        value={publication.altText}
                        disabled={contentLocked}
                        onChange={(event) =>
                          updatePublication(index, {
                            altText: event.target.value,
                          })
                        }
                        rows={2}
                      />
                    </div>
                  </div>
                </div>
              );
            })}

            {publications.length === 0 && (
              <div className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">
                O conteúdo pode ser salvo como rascunho sem plataforma.
              </div>
            )}
          </section>
        </div>

        <SheetFooter className="sticky bottom-0 border-t border-border bg-background py-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => requestOpenChange(false)}
            disabled={savePost.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={
              savePost.isPending || loadingOptions || optionsError
            }
          >
            {savePost.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Salvar conteúdo
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
