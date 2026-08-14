import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { UNSAFE_NavigationContext, useBeforeUnload } from "react-router-dom";
import {
  CalendarClock,
  FileCheck2,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/shared/confirmDialog";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import ApprovedMediaPicker from "@/components/editorial/ApprovedMediaPicker";
import {
  findEditorialPostIdByPrimaryFile,
  loadEditorialPostForMutation,
  useEditorialEditorOptions,
  useEditorialMutations,
  type EditorialFileRow,
  type EditorialPostBundle,
} from "@/hooks/useEditorialCalendar";
import { editorialErrorMessage } from "@/lib/editorialErrorMessage";
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
import {
  buildApprovedMediaAssets,
  type EditorialApprovedMediaAsset,
} from "@/lib/editorialMedia";
import { isPublishableTask } from "@/lib/taskDeliveryTypes";
import { canDeliverAutomatically } from "@/lib/editorialScheduler";

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
  defaultContext?: string;
  defaultContentType?: string;
  defaultResponsibleId?: string;
  defaultProductionStatus?: "draft" | "production" | "ready" | "cancelled";
  lockTaskId?: boolean;
  linkedTaskIds?: readonly string[];
  onOpenChange: (open: boolean) => void;
  onSaved: (postId: string) => void;
  /** Abre o card de um conteúdo já existente (ex.: arte já usada). */
  onOpenExisting?: (postId: string) => void;
}

const EMPTY_ID_LIST: readonly string[] = [];
const EMPTY_EDITORIAL_FILES: readonly EditorialFileRow[] = [];

const contentTypes = [
  { value: "static", label: "Post estático" },
  { value: "carousel", label: "Carrossel" },
  { value: "reel", label: "Reel" },
  { value: "story", label: "Story" },
  { value: "video", label: "Vídeo" },
  { value: "short", label: "Short" },
  { value: "article", label: "Artigo" },
  { value: "google_post", label: "Post Google" },
];
const contentTypeValues = new Set(contentTypes.map(({ value }) => value));

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
  defaultContext = "",
  defaultContentType = "static",
  defaultResponsibleId = "",
  defaultProductionStatus = "draft",
  lockTaskId = false,
  linkedTaskIds = EMPTY_ID_LIST,
  onOpenChange,
  onSaved,
  onOpenExisting,
}: EditorialEditorProps) {
  const { savePost } = useEditorialMutations();
  const { navigator } = useContext(UNSAFE_NavigationContext);
  const confirmDialog = useConfirm();
  const confirmDialogRef = useRef(confirmDialog);
  confirmDialogRef.current = confirmDialog;
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
    useState<string>(newIdempotencyKey);
  const [publications, setPublications] = useState<PublicationDraft[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [pendingMutationId, setPendingMutationId] = useState<string | null>(
    null,
  );
  const dirtyNavigationRef = useRef(false);
  const savingNavigationRef = useRef(false);
  const initializedEditorKeyRef = useRef<string | null>(null);

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
    // Dialogo do painel no lugar do confirm nativo: bloqueia a navegacao,
    // pergunta e, se o usuario confirmar, refaz a navegacao original.
    const confirmNavigation = (retry?: () => void) => {
      if (savingNavigationRef.current) {
        toast.info("Aguarde o salvamento terminar antes de sair.");
        return false;
      }
      if (!dirtyNavigationRef.current) {
        setHasChanges(false);
        setPendingMutationId(null);
        return true;
      }
      void confirmDialogRef.current({
        title: "Descartar alterações?",
        description: "Você tem mudanças não salvas neste conteúdo. Elas serão perdidas.",
        confirmLabel: "Descartar e sair",
        cancelLabel: "Continuar editando",
        destructive: true,
      }).then((proceed) => {
        if (!proceed) return;
        dirtyNavigationRef.current = false;
        setHasChanges(false);
        setPendingMutationId(null);
        retry?.();
      });
      return false;
    };
    const guardedPush: typeof navigator.push = (...args) => {
      if (confirmNavigation(() => originalPush.apply(navigator, args))) {
        originalPush.apply(navigator, args);
      }
    };
    const guardedReplace: typeof navigator.replace = (...args) => {
      if (confirmNavigation(() => originalReplace.apply(navigator, args))) {
        originalReplace.apply(navigator, args);
      }
    };
    const guardedGo: typeof navigator.go = (...args) => {
      if (confirmNavigation(() => originalGo.apply(navigator, args))) {
        originalGo.apply(navigator, args);
      }
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

  // Passo 2 no MESMO popup: depois de salvar um conteúdo novo sem plano de
  // publicação, o modal vira a tela de programar (conta + horário), sem
  // fechar e abrir outro.
  const [afterSave, setAfterSave] = useState<
    null | { postId: string; clientId: string }
  >(null);
  const [afterAccountId, setAfterAccountId] = useState("");
  const [afterWhen, setAfterWhen] = useState("");
  const [afterSaving, setAfterSaving] = useState(false);

  const {
    data: options,
    isLoading: loadingOptions,
    isError: optionsError,
    error: optionsErrorDetail,
    refetch: refetchOptions,
  } = useEditorialEditorOptions(clientId || null, projectId || null, open);

  useEffect(() => {
    if (!open || !clientId || !projectId) return;

    const refreshOptionsOnFocus = () => {
      void refetchOptions();
    };

    window.addEventListener("focus", refreshOptionsOnFocus);
    return () => {
      window.removeEventListener("focus", refreshOptionsOnFocus);
    };
  }, [clientId, open, projectId, refetchOptions]);

  useEffect(() => {
    if (!open) {
      initializedEditorKeyRef.current = null;
      setAfterSave(null);
      setAfterAccountId("");
      setAfterWhen("");
      setAfterSaving(false);
      return;
    }

    const editorKey = post
      ? `post:${post.post.id}`
      : revisionOf
        ? `revision:${revisionOf.post.id}`
        : `new:${defaultTaskId}:${defaultClientId}:${defaultProjectId}:${defaultScheduledAt}`;
    if (initializedEditorKeyRef.current === editorKey) return;
    initializedEditorKeyRef.current = editorKey;

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
          .filter(({ publication }) => publication.status !== "cancelled")
          .map(({ publication, internal }) => ({
            id: publication.id,
            idempotencyKey: internal?.idempotency_key || newIdempotencyKey(),
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
              publication.scheduled_timezone || EDITORIAL_DEFAULT_TIME_ZONE,
          })),
      );
      setHasChanges(false);
      setPendingMutationId(null);
      return;
    }

    setClientId(revisionOf?.post.client_id || defaultClientId);
    setProjectId(revisionOf?.post.project_id || defaultProjectId);
    setTitle(revisionOf ? revisionOf.post.title : defaultTitle);
    setContentType(
      revisionOf?.post.content_type || defaultContentType || "static",
    );
    setObjective(revisionOf?.post.objective || defaultContext);
    setDefaultCaption(revisionOf?.post.default_caption || "");
    setProductionStatus(revisionOf ? "draft" : defaultProductionStatus);
    setPrimaryFileId("");
    setTaskId(revisionOf ? revisionOf.internal?.task_id || "" : defaultTaskId);
    setResponsibleId(
      revisionOf
        ? revisionOf.internal?.responsible_id || ""
        : defaultResponsibleId,
    );
    setInternalNotes(revisionOf?.internal?.internal_notes || "");
    setPostIdempotencyKey(newIdempotencyKey());
    setPublications([]);
    setHasChanges(false);
    setPendingMutationId(null);
  }, [
    defaultClientId,
    defaultContext,
    defaultContentType,
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
      projects.filter((project) => !clientId || project.client_id === clientId),
    [clientId, projects],
  );
  const allowedTeamMembers = useMemo(() => {
    const assignments = new Set(options?.assignments || []);
    return teamMembers.filter(
      (member) => member.role === "admin" || assignments.has(member.id),
    );
  }, [options?.assignments, teamMembers]);
  const selectableTasks = useMemo(() => {
    const linkedIds = new Set(linkedTaskIds);
    return (options?.tasks || []).filter(
      (task) =>
        task.id === taskId ||
        (!linkedIds.has(task.id) && isPublishableTask(task)),
    );
  }, [linkedTaskIds, options?.tasks, taskId]);
  const selectedFile =
    options?.files.find((file) => file.id === primaryFileId) ||
    (post?.primaryFile?.id === primaryFileId ? post.primaryFile : undefined);
  const optionFiles = options?.files || EMPTY_EDITORIAL_FILES;
  const editableRootFiles = useMemo(
    () =>
      optionFiles.filter(
        (file) => !file.parent_file_id && isFileEditable(file),
      ),
    [optionFiles],
  );
  const approvedMediaDraft = Boolean(
    !revisionOf &&
      selectedFile &&
      isFilePublishable(selectedFile) &&
      post?.post.primary_file_id !== selectedFile.id,
  );
  const primaryContentLocked = Boolean(
    post?.post.primary_file_id &&
    (loadingOptions || !selectedFile || !isFileEditable(selectedFile)),
  );
  const publicationContentLocked = Boolean(
    post?.publications.some(
      ({ publication, file }) =>
        publication.status !== "cancelled" &&
        Boolean(publication.file_id) &&
        (!file || !isFileEditable(file)),
    ),
  );
  const savedContentLocked = primaryContentLocked || publicationContentLocked;
  const contentLocked = savedContentLocked || approvedMediaDraft;
  const showExistingPublicationPlan = Boolean(
    post?.publications.some(
      ({ publication }) => publication.status !== "cancelled",
    ),
  );
  const cancelledAccountIds = useMemo(
    () =>
      new Set(
        (post?.publications || [])
          .filter(({ publication }) => publication.status === "cancelled")
          .map(({ publication }) => publication.external_account_id),
      ),
    [post],
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
    const usedAccountIds = new Set([
      ...publications.map((publication) => publication.externalAccountId),
      ...cancelledAccountIds,
    ]);
    const firstAvailable = options?.accounts.find(
      (account) => !usedAccountIds.has(account.id),
    );
    setPublications((current) => [
      ...current,
      {
        ...emptyPublication(defaultScheduledAt, firstAvailable?.id || ""),
        caption: contentLocked ? defaultCaption : "",
      },
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

  const selectApprovedMedia = (asset: EditorialApprovedMediaAsset) => {
    if (savedContentLocked) return;
    const approvedCaption = asset.root.caption?.trim() || "";
    setPrimaryFileId(asset.root.id);
    setTitle(asset.root.file_name.trim());
    setContentType(asset.contentType);
    setProductionStatus("ready");
    setObjective(asset.root.description?.trim() || "");
    setDefaultCaption(approvedCaption);
    setPublications((current) =>
      current.map((publication) => ({
        ...publication,
        fileId: "",
        caption: approvedCaption,
        firstComment: "",
        altText: "",
      })),
    );
    markChanged();
  };

  const handleSave = async () => {
    if (!clientId || !projectId || !title.trim()) {
      toast.error("Preencha cliente, projeto e título.");
      return;
    }
    const hasPublishableContentType = contentTypeValues.has(contentType);
    const preservesExistingLegacyType = Boolean(
      post?.post.content_type === contentType && !hasPublishableContentType,
    );
    if (!hasPublishableContentType && !preservesExistingLegacyType) {
      toast.error("Escolha um formato editorial publicável.");
      return;
    }
    if (lockTaskId && (!taskId || taskId !== defaultTaskId)) {
      toast.error(
        "Este conteúdo precisa permanecer vinculado à tarefa de origem.",
      );
      return;
    }
    if (revisionOf && !primaryFileId) {
      toast.error(
        "Selecione a nova versão editável do arquivo para criar a revisão.",
      );
      return;
    }
    const accountlessPublicationWithContent = publications.some(
      (publication) =>
        !publication.externalAccountId &&
        Boolean(
          publication.fileId ||
          publication.caption.trim() ||
          publication.firstComment.trim() ||
          publication.altText.trim() ||
          publication.scheduledAt,
        ),
    );
    if (accountlessPublicationWithContent) {
      toast.error("Escolha uma conta em cada publicação.");
      return;
    }

    try {
      const mutationId = pendingMutationId || newIdempotencyKey();
      setPendingMutationId(mutationId);
      const approvedAssetFileIds = new Map(
        buildApprovedMediaAssets(optionFiles).map((asset) => [
          asset.id,
          asset.files.map((file) => file.id),
        ]),
      );
      const publicationPayload = publications
        .filter((publication) => publication.externalAccountId)
        .map((publication) => {
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
          const assetIds =
            approvedAssetFileIds.get(publication.fileId || primaryFileId) || [];
          return {
            id: publication.id || null,
            idempotency_key: publication.idempotencyKey,
            external_account_id: publication.externalAccountId,
            file_id: publication.fileId || null,
            caption: publication.caption.trim() || null,
            first_comment: publication.firstComment.trim() || null,
            alt_text: publication.altText.trim() || null,
            asset_file_ids: assetIds,
            // Declara a entrega automática quando a lista congelada existe e
            // cabe no limite da Meta. Sem isto o registro nascia "manual" e o
            // motor antigo nunca olhava para ele.
            delivery_mode: canDeliverAutomatically(assetIds)
              ? "automatic"
              : "manual",
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
      // Conteúdo novo sem plano de publicação: em vez de fechar e abrir
      // outro popup, o próprio modal vira a etapa de programar.
      if (!post && !revisionOf && publicationPayload.length === 0) {
        const availableAccounts = (options?.accounts || []).filter(
          (account) => !cancelledAccountIds.has(account.id),
        );
        setAfterAccountId(
          availableAccounts.length === 1 ? availableAccounts[0].id : "",
        );
        setAfterWhen(defaultScheduledAt || "");
        setAfterSave({ postId: result.post_id, clientId });
        onSaved(result.post_id);
        toast.success("Conteúdo criado. Agora programe a publicação, sem sair daqui.");
        return;
      }
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
      const message =
        error instanceof Error
          ? error.message
          : "Não foi possível salvar o conteúdo.";
      if (
        approvedMediaDraft &&
        /already used|already linked|indisponível|unavailable|another content|outro conteúdo/i.test(
          message,
        )
      ) {
        setPrimaryFileId("");
        setHasChanges(true);
        // Nada de caça ao tesouro: o painel ACHA o conteúdo que já usa a
        // arte e abre o card dele na hora, pronto para programar.
        const existingId = primaryFileId && clientId
          ? await findEditorialPostIdByPrimaryFile(clientId, primaryFileId)
          : null;
        if (existingId) {
          toast.info(
            "Esta arte já tem conteúdo criado. Abrindo o card dele para você programar.",
            { duration: 6000 },
          );
          onOpenChange(false);
          if (onOpenExisting) onOpenExisting(existingId);
          else onSaved(existingId);
          return;
        }
        toast.error(
          "Esta arte já é a capa de um conteúdo que existe na agenda (fechar o popup não desfaz o salvamento). Procure o card dela na agenda ou escolha outra arte.",
          { duration: 10000 },
        );
        return;
      }
      // Traduz as guardas do servidor para orientacao pratica em portugues.
      if (/already under review|create a revision|immutable/i.test(message)) {
        toast.error(
          "O banco travou esta arte por revisão. Rode o SQL de atualização mais recente no Lovable Cloud e tente de novo; se a arte já foi aprovada num conteúdo, abra o original e crie uma revisão.",
          { duration: 9000 },
        );
        return;
      }
      toast.error(message);
    }
  };

  // Programa a publicação do conteúdo recém-salvo dentro do mesmo modal.
  // Lê o post fresco do banco e reaproveita publicação viva se existir, para
  // nunca nascer card duplicado.
  const programAfterSave = async () => {
    if (!afterSave) return;
    if (!afterAccountId) {
      toast.error("Escolha a conta que vai receber a publicação.");
      return;
    }
    let scheduledAtIso: string | null = null;
    if (afterWhen) {
      scheduledAtIso = zonedDateTimeLocalToIso(
        afterWhen,
        EDITORIAL_DEFAULT_TIME_ZONE,
      );
      if (!scheduledAtIso) {
        toast.error("Data ou horário inválido. Ajuste e tente de novo.");
        return;
      }
    }
    setAfterSaving(true);
    try {
      const fresh = await loadEditorialPostForMutation(
        afterSave.postId,
        afterSave.clientId,
      );
      const active = fresh.publications.find(({ publication }) =>
        ["planned", "scheduled", "failed"].includes(publication.status),
      );
      const plans: Record<string, unknown>[] = fresh.publications
        .filter(({ publication }) => publication.status === "planned")
        .map(({ publication, internal }) => {
          const isTarget = active?.publication.id === publication.id;
          return {
            id: publication.id,
            idempotency_key: internal?.idempotency_key || newIdempotencyKey(),
            external_account_id: isTarget
              ? afterAccountId
              : publication.external_account_id,
            file_id: publication.file_id,
            caption: publication.caption,
            first_comment: publication.first_comment,
            alt_text: publication.alt_text,
            scheduled_at: isTarget ? scheduledAtIso : publication.scheduled_at,
            scheduled_timezone: isTarget
              ? EDITORIAL_DEFAULT_TIME_ZONE
              : publication.scheduled_timezone || EDITORIAL_DEFAULT_TIME_ZONE,
          };
        });
      if (!active) {
        plans.push({
          id: null,
          idempotency_key: newIdempotencyKey(),
          external_account_id: afterAccountId,
          file_id: null,
          caption: fresh.post.default_caption,
          first_comment: null,
          alt_text: null,
          asset_file_ids: [],
          scheduled_at: scheduledAtIso,
          scheduled_timezone: EDITORIAL_DEFAULT_TIME_ZONE,
        });
      }
      await savePost.mutateAsync({
        payload: {
          id: fresh.post.id,
          idempotency_key:
            fresh.internal?.idempotency_key || newIdempotencyKey(),
          mutation_id: newIdempotencyKey(),
          client_id: fresh.post.client_id,
          project_id: fresh.post.project_id,
          primary_file_id: fresh.post.primary_file_id,
          title: fresh.post.title,
          content_type: fresh.post.content_type,
          objective: fresh.post.objective,
          default_caption: fresh.post.default_caption,
          production_status: fresh.post.production_status,
          task_id: fresh.internal?.task_id || null,
          responsible_id: fresh.internal?.responsible_id || null,
          internal_notes: fresh.internal?.internal_notes || null,
          revision_of_post_id: fresh.internal?.revision_of_post_id ?? null,
          publications: plans,
        },
        expectedVersion: fresh.post.version,
      });
      toast.success(
        scheduledAtIso
          ? "Publicação programada. Com o material aprovado, sai sozinha no horário."
          : "Conta definida. Escolha o horário quando quiser, pelo card.",
      );
      onOpenChange(false);
    } catch (error: unknown) {
      toast.error(
        editorialErrorMessage(error, "Não foi possível programar a publicação."),
      );
    } finally {
      setAfterSaving(false);
    }
  };

  const requestOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && savePost.isPending) return;
    if (!nextOpen && hasChanges) {
      void confirmDialog({
        title: "Descartar alterações?",
        description: "Você tem mudanças não salvas neste conteúdo. Elas serão perdidas.",
        confirmLabel: "Descartar e sair",
        cancelLabel: "Continuar editando",
        destructive: true,
      }).then((proceed) => {
        if (proceed) onOpenChange(false);
      });
      return;
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={requestOpenChange}>
      <DialogContent className="bottom-[max(0.5rem,env(safe-area-inset-bottom))] top-[max(0.5rem,env(safe-area-inset-top))] flex w-[calc(100vw-1rem)] max-w-5xl translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:bottom-auto sm:top-1/2 sm:max-h-[calc(100dvh-3rem)] sm:translate-y-[-50%]">
        {afterSave && (
          <div className="absolute inset-0 z-50 flex flex-col bg-background">
            <div className="shrink-0 border-b border-border px-4 py-4 pr-12 sm:px-6 sm:py-5">
              <p className="text-base font-semibold text-foreground">
                Conteúdo salvo. Programar a publicação?
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Sem sair daqui: escolha a conta e o horário. Aprovado e
                agendado, publica sozinho.
              </p>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
              <div className="space-y-2">
                <Label htmlFor="after-save-account">Conta</Label>
                <Select value={afterAccountId} onValueChange={setAfterAccountId}>
                  <SelectTrigger id="after-save-account">
                    <SelectValue placeholder="Selecione a conta" />
                  </SelectTrigger>
                  <SelectContent>
                    {(options?.accounts || []).map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {PLATFORM_LABELS[item.platform as EditorialPlatform] ||
                          item.platform}
                        {" · "}
                        {item.handle || item.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="after-save-when">Data e horário</Label>
                <Input
                  id="after-save-when"
                  type="datetime-local"
                  value={afterWhen}
                  onChange={(event) => setAfterWhen(event.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Sem horário, a conta fica definida e você agenda depois pelo
                  card.
                </p>
              </div>
            </div>
            <DialogFooter className="shrink-0 border-t border-border px-4 py-3 sm:px-6">
              <Button
                type="button"
                variant="outline"
                disabled={afterSaving}
                onClick={() => {
                  // Deixa claro que fechar aqui NAO desfaz nada: o conteúdo
                  // já existe na agenda (era a fonte do "arte já usada").
                  toast.info(
                    "O conteúdo continua salvo na agenda. Programe pelo card quando quiser.",
                  );
                  onOpenChange(false);
                }}
              >
                Agora não
              </Button>
              <Button
                type="button"
                disabled={afterSaving || !afterAccountId}
                onClick={() => void programAfterSave()}
              >
                {afterSaving ? "Programando..." : "Programar publicação"}
              </Button>
            </DialogFooter>
          </div>
        )}
        <DialogHeader className="shrink-0 border-b border-border bg-background px-4 py-4 pr-12 text-left sm:px-6 sm:py-5 sm:pr-14">
          <DialogTitle>
            {post
              ? "Editar conteúdo editorial"
              : revisionOf
                ? "Nova revisão editorial"
                : "Novo conteúdo editorial"}
          </DialogTitle>
          <DialogDescription className="max-w-3xl">
            {revisionOf
              ? "Escolha a nova versão do arquivo e revise o copy antes de enviar novamente para aprovação."
              : "Prepare o conteúdo e os planos por plataforma. Agendar e confirmar publicação são ações separadas."}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
          <section className="grid gap-4 rounded-xl border border-border p-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <h3 className="text-sm font-semibold text-foreground">
                Informações principais
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Defina o conteúdo antes de vincular mídia, tarefa e plataformas.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="editorial-client">Cliente</Label>
              <Select
                value={clientId}
                onValueChange={handleClientChange}
                disabled={!!post || !!revisionOf || lockTaskId}
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
                disabled={!clientId || !!post || !!revisionOf || lockTaskId}
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
            {defaultContext && !post && !revisionOf && (
              <div className="md:col-span-2 rounded-xl border border-violet-500/20 bg-violet-500/[0.06] p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-500">
                  Direção vinda do Kanban
                </p>
                <p className="mt-2 text-xs font-medium text-foreground">
                  <span className="text-muted-foreground">Tema:</span>{" "}
                  {defaultTitle || title}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                  <span className="font-medium text-foreground">Contexto:</span>{" "}
                  {defaultContext}
                </p>
              </div>
            )}
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
                  {!contentTypeValues.has(contentType) && (
                    <SelectItem value={contentType} disabled>
                      Formato legado: {contentType}
                    </SelectItem>
                  )}
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
                disabled={contentLocked}
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
                  Mídia e textos não podem mudar nesta versão. Conta,
                  horário, fuso, tarefa, responsável e notas internas
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
            <div className="rounded-xl border border-border bg-muted/20 p-3 sm:p-4">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-semibold text-foreground">
                    Mídia aprovada deste projeto
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Selecione aqui sem sair do editor. PDFs, documentos e
                    arquivos já usados não aparecem.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="self-start sm:self-auto"
                  disabled={!clientId || !projectId || loadingOptions}
                  onClick={() => refetchOptions()}
                >
                  <RefreshCw
                    className={`mr-1.5 h-3.5 w-3.5 ${
                      loadingOptions ? "animate-spin" : ""
                    }`}
                  />
                  Atualizar
                </Button>
              </div>
              {revisionOf ? (
                <div className="space-y-2">
                  <Label htmlFor="editorial-revision-file">
                    Nova versão editável
                  </Label>
                  <Select
                    value={primaryFileId || "none"}
                    onValueChange={(value) => {
                      setPrimaryFileId(value === "none" ? "" : value);
                      markChanged();
                    }}
                    disabled={!projectId || loadingOptions}
                  >
                    <SelectTrigger id="editorial-revision-file">
                      <SelectValue placeholder="Selecionar nova versão" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Selecione um arquivo</SelectItem>
                      {editableRootFiles.map((file) => (
                        <SelectItem key={file.id} value={file.id}>
                          {file.file_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <ApprovedMediaPicker
                  files={optionFiles}
                  usedRootFileIds={options?.usedFileIds || EMPTY_ID_LIST}
                  currentRootFileId={post?.post.primary_file_id || null}
                  selectedFileId={primaryFileId || null}
                  onSelect={selectApprovedMedia}
                  loading={loadingOptions}
                  error={
                    optionsError
                      ? optionsErrorDetail instanceof Error
                        ? optionsErrorDetail.message
                        : "Não foi possível carregar a mídia aprovada."
                      : null
                  }
                  disabled={!clientId || !projectId || savedContentLocked}
                  onRetry={() => refetchOptions()}
                />
              )}
              {selectedFile && (
                <Badge
                  variant="outline"
                  className={
                    isFilePublishable(selectedFile)
                      ? "mt-3 border-success/30 bg-success/10 text-success"
                      : "mt-3 border-warning/30 bg-warning/10 text-warning"
                  }
                >
                  <FileCheck2 className="mr-1 h-3 w-3" />
                  {fileGateLabel(selectedFile)}
                </Badge>
              )}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="editorial-task">Tarefa do Kanban</Label>
                <Select
                  value={taskId || "none"}
                  onValueChange={(value) => {
                    setTaskId(value === "none" ? "" : value);
                    markChanged();
                  }}
                  disabled={!projectId || lockTaskId}
                >
                  <SelectTrigger id="editorial-task">
                    <SelectValue placeholder="Vincular tarefa" />
                  </SelectTrigger>
                  <SelectContent>
                    {!lockTaskId && (
                      <SelectItem value="none">Sem tarefa</SelectItem>
                    )}
                    {selectableTasks.map((task) => (
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
                  onValueChange={(value) => {
                    setResponsibleId(value === "none" ? "" : value);
                    markChanged();
                  }}
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
          </section>

          {showExistingPublicationPlan && (
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  Plano de publicação existente
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Edite apenas este plano já criado. Para um novo plano, use
                  Agendar publicação na Agenda.
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
                  : options?.files || [];
              const selectablePublicationFiles = publicationFiles.filter(
                (file) =>
                  !file.parent_file_id &&
                  (isFileEditable(file) || file.id === publication.fileId),
              );
              const usedByOthers = new Set([
                ...publications
                  .filter((_, itemIndex) => itemIndex !== index)
                  .map((item) => item.externalAccountId),
                ...cancelledAccountIds,
              ]);
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
                      onClick={() => {
                        setPublications((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index),
                        );
                        markChanged();
                      }}
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
                                item.id === publication.externalAccountId ||
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
          )}
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t border-border bg-background px-4 py-3 sm:px-6 sm:py-4 sm:space-x-0">
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
            disabled={savePost.isPending || loadingOptions || optionsError}
          >
            {savePost.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Salvar conteúdo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
