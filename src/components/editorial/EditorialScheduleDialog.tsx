import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CalendarCheck2,
  Check,
  CheckCircle2,
  Clock3,
  Eye,
  FileCheck2,
  Loader2,
  Search,
  Settings2,
  Share2,
} from "lucide-react";
import { toast } from "sonner";
import ApprovedMediaPicker, { AssetPreview } from "@/components/editorial/ApprovedMediaPicker";
import { EditorialFileThumbnail } from "@/components/editorial/EditorialCalendarViews";
import EditorialAccountSetup from "@/components/editorial/EditorialAccountSetup";
import EditorialAssetPreviewDialog from "@/components/editorial/EditorialAssetPreviewDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  loadEditorialPostForMutation,
  useEditorialEditorOptions,
  useEditorialMutations,
  useEditorialSchedulingPosts,
  type EditorialPostBundle,
} from "@/hooks/useEditorialCalendar";
import {
  EDITORIAL_DEFAULT_TIME_ZONE,
  isoUtcToZonedDateTimeLocal,
  zonedDateTimeLocalToIso,
} from "@/lib/editorialDate";
import {
  buildApprovedMediaAssets,
  type EditorialApprovedMediaAsset,
} from "@/lib/editorialMedia";
import {
  activeEditorialSchedulePlans,
  buildEditorialSchedulePayload,
  editorialSchedulePlanFingerprint,
  editorialSchedulePlanMatchesSnapshot,
  editorialScheduleMissingFields,
  type EditorialSchedulePublicationTarget,
} from "@/lib/editorialScheduler";
import { PLATFORM_LABELS, isFilePublishable } from "@/lib/editorial";
import { cn } from "@/lib/utils";

interface Option {
  id: string;
  name: string;
  client_id?: string;
}

interface EditorialScheduleDialogProps {
  open: boolean;
  clients: Option[];
  projects: Option[];
  defaultClientId?: string;
  defaultProjectId?: string;
  defaultScheduledAt?: string;
  onOpenChange: (open: boolean) => void;
  onScheduled: (result: {
    postId: string;
    scheduledAt: string;
    clientId: string;
    projectId: string;
  }) => void;
}

interface PendingAttempt {
  fingerprint: string;
  postIdempotencyKey: string;
  mutationId: string;
  publicationKeys: Map<string, string>;
  prepared?: {
    payload: Record<string, unknown>;
    expectedVersion: number | null;
  };
}

interface SelectedExistingPlanSnapshot {
  postId: string;
  postVersion: number;
  planFingerprint: string;
  accountIds: string[];
}

const EMPTY_IDS: readonly string[] = [];

function newId() {
  return crypto.randomUUID();
}

function normalizeAccountSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^@/, "")
    .toLowerCase()
    .trim();
}

function nextHourLocal() {
  const nowInScheduleZone = isoUtcToZonedDateTimeLocal(
    new Date().toISOString(),
    EDITORIAL_DEFAULT_TIME_ZONE,
  );
  if (!nowInScheduleZone) return "";
  const civilClock = new Date(`${nowInScheduleZone}:00Z`);
  civilClock.setUTCMinutes(0, 0, 0);
  civilClock.setUTCHours(civilClock.getUTCHours() + 1);
  return civilClock.toISOString().slice(0, 16);
}

function isSchedulablePost(bundle: EditorialPostBundle) {
  const activePlans = activeEditorialSchedulePlans(bundle.publications);
  return (
    bundle.post.production_status === "ready" &&
    Boolean(bundle.post.primary_file_id) &&
    Boolean(bundle.internal?.idempotency_key) &&
    isFilePublishable(bundle.primaryFile) &&
    bundle.publicationSetComplete &&
    activePlans.every(
      ({ publication, internal, file }) =>
        publication.status === "planned" &&
        !publication.scheduled_at &&
        Boolean(internal?.idempotency_key) &&
        isFilePublishable(publication.file_id ? file : bundle.primaryFile),
    )
  );
}

const stepItems = [
  { label: "Cliente", icon: CheckCircle2 },
  { label: "Conteúdo", icon: FileCheck2 },
  { label: "Conta", icon: Share2 },
  { label: "Horário", icon: Clock3 },
];

export default function EditorialScheduleDialog({
  open,
  clients,
  projects,
  defaultClientId = "",
  defaultProjectId = "",
  defaultScheduledAt = "",
  onOpenChange,
  onScheduled,
}: EditorialScheduleDialogProps) {
  const { savePost } = useEditorialMutations();
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [selectedAsset, setSelectedAsset] =
    useState<EditorialApprovedMediaAsset | null>(null);
  const [selectedExistingPlan, setSelectedExistingPlan] =
    useState<SelectedExistingPlanSnapshot | null>(null);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [scheduledAt, setScheduledAt] = useState("");
  const [accountSearch, setAccountSearch] = useState("");
  const [showLibrary, setShowLibrary] = useState(true);
  const [previewSelectedAsset, setPreviewSelectedAsset] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const attemptRef = useRef<PendingAttempt | null>(null);

  const {
    data: options,
    isLoading: optionsLoading,
    isError: optionsFailed,
    error: optionsError,
    refetch: refetchOptions,
  } = useEditorialEditorOptions(
    clientId || null,
    projectId || null,
    open,
    "schedule",
  );
  const schedulingPosts = useEditorialSchedulingPosts(
    clientId || null,
    projectId || null,
    open,
  );

  useEffect(() => {
    if (!open) return;
    setClientId(defaultClientId);
    setProjectId(defaultProjectId);
    setSelectedAsset(null);
    setSelectedExistingPlan(null);
    setSelectedAccountIds([]);
    setScheduledAt(defaultScheduledAt || nextHourLocal());
    setAccountSearch("");
    setShowLibrary(true);
    setPreviewSelectedAsset(false);
    setDiscardConfirmOpen(false);
    setDirty(false);
    attemptRef.current = null;
  }, [defaultClientId, defaultProjectId, defaultScheduledAt, open]);

  const filteredProjects = useMemo(
    () => projects.filter((project) => project.client_id === clientId),
    [clientId, projects],
  );
  const selectedClientName =
    clients.find((client) => client.id === clientId)?.name || "Cliente";
  const selectedProjectName =
    projects.find((project) => project.id === projectId)?.name || "Projeto";

  const schedulablePosts = useMemo(
    () => (schedulingPosts.data || []).filter(isSchedulablePost),
    [schedulingPosts.data],
  );
  const existingPostByRootId = useMemo(
    () =>
      new Map(
        schedulablePosts
          .filter((bundle) => bundle.post.primary_file_id)
          .map((bundle) => [bundle.post.primary_file_id!, bundle]),
      ),
    [schedulablePosts],
  );
  const allowedUsedRootIds = useMemo(
    () => new Set(existingPostByRootId.keys()),
    [existingPostByRootId],
  );
  const blockedUsedRootIds = useMemo(
    () =>
      (options?.usedFileIds || []).filter(
        (fileId) => !allowedUsedRootIds.has(fileId),
      ),
    [allowedUsedRootIds, options?.usedFileIds],
  );
  const libraryAssets = useMemo(
    () =>
      buildApprovedMediaAssets(options?.files || [], {
        usedRootFileIds: blockedUsedRootIds,
      }),
    [blockedUsedRootIds, options?.files],
  );
  const approvedAssetByRootId = useMemo(
    () =>
      new Map(
        buildApprovedMediaAssets(options?.files || []).map((asset) => [
          asset.id,
          asset,
        ]),
      ),
    [options?.files],
  );
  const lockedAccountIds = useMemo(
    () => new Set(selectedExistingPlan?.accountIds || []),
    [selectedExistingPlan?.accountIds],
  );
  const unavailableAccountIds = useMemo(
    () =>
      new Set(
        (options?.accounts || [])
          .filter(
            (account) =>
              account.connection_status === "expired" ||
              account.connection_status === "revoked",
          )
          .map((account) => account.id),
      ),
    [options?.accounts],
  );
  const hasUnavailableSelection = selectedAccountIds.some((accountId) =>
    unavailableAccountIds.has(accountId),
  );
  const missingSelectedAccountIds = useMemo(() => {
    const visibleAccountIds = new Set(
      (options?.accounts || []).map((account) => account.id),
    );
    return selectedAccountIds.filter(
      (accountId) => !visibleAccountIds.has(accountId),
    );
  }, [options?.accounts, selectedAccountIds]);
  const hasMissingSelectedAccounts = missingSelectedAccountIds.length > 0;
  const visibleAccounts = useMemo(() => {
    const term = normalizeAccountSearch(accountSearch);
    if (!term) return options?.accounts || [];
    return (options?.accounts || []).filter((account) =>
      normalizeAccountSearch(
        [account.display_name, account.handle, account.platform]
          .filter(Boolean)
          .join(" "),
      ).includes(term),
    );
  }, [accountSearch, options?.accounts]);

  const selectAsset = (asset: EditorialApprovedMediaAsset) => {
    setSelectedAsset(asset);
    const existing = existingPostByRootId.get(asset.id);
    const activePlans = existing
      ? activeEditorialSchedulePlans(existing.publications)
      : [];
    const accountIds = activePlans.map(
      ({ publication }) => publication.external_account_id,
    );
    setSelectedExistingPlan(
      existing
        ? {
            postId: existing.post.id,
            postVersion: existing.post.version,
            planFingerprint: editorialSchedulePlanFingerprint(
              existing.publications,
            ),
            accountIds,
          }
        : null,
    );
    setSelectedAccountIds(accountIds);
    setShowLibrary(false);
    setDirty(true);
    attemptRef.current = null;
  };

  const toggleAccount = (accountId: string, checked: boolean) => {
    if (lockedAccountIds.has(accountId) && !checked) return;
    setSelectedAccountIds((current) =>
      checked
        ? [...new Set([...current, accountId])]
        : current.filter((id) => id !== accountId),
    );
    setDirty(true);
    attemptRef.current = null;
  };

  const handleAccountReady = (accountId: string) => {
    setSelectedAccountIds((current) => [
      ...new Set([...current, accountId]),
    ]);
    setDirty(true);
    attemptRef.current = null;
    void refetchOptions();
  };

  const missingFields = editorialScheduleMissingFields({
    clientId,
    projectId,
    assetId: selectedAsset?.id,
    accountIds: selectedAccountIds,
    scheduledAt,
  });

  const requestOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && savePost.isPending) return false;
    if (!nextOpen && dirty) {
      setDiscardConfirmOpen(true);
      return false;
    }
    onOpenChange(nextOpen);
    return true;
  };

  const discardAndClose = () => {
    setDiscardConfirmOpen(false);
    setDirty(false);
    attemptRef.current = null;
    onOpenChange(false);
  };

  const handleSchedule = async () => {
    if (missingFields.length > 0 || !selectedAsset) {
      toast.error(`Falta selecionar: ${missingFields.join(", ")}.`);
      return;
    }
    if (hasUnavailableSelection || hasMissingSelectedAccounts) {
      toast.error(
        "Revise as contas removidas, expiradas ou desconectadas antes de agendar.",
      );
      return;
    }

    const scheduledAtIso = zonedDateTimeLocalToIso(
      scheduledAt,
      EDITORIAL_DEFAULT_TIME_ZONE,
    );
    if (!scheduledAtIso) {
      toast.error("Escolha uma data e um horário válidos.");
      return;
    }
    if (new Date(scheduledAtIso).getTime() < Date.now() - 60_000) {
      toast.error("Escolha um horário futuro.");
      return;
    }

    const fingerprint = JSON.stringify({
      clientId,
      projectId,
      assetId: selectedAsset.id,
      accountIds: [...selectedAccountIds].sort(),
      scheduledAtIso,
      existingPlan: selectedExistingPlan
        ? {
            postId: selectedExistingPlan.postId,
            postVersion: selectedExistingPlan.postVersion,
            planFingerprint: selectedExistingPlan.planFingerprint,
          }
        : null,
    });
    if (attemptRef.current?.fingerprint !== fingerprint) {
      attemptRef.current = {
        fingerprint,
        postIdempotencyKey: newId(),
        mutationId: newId(),
        publicationKeys: new Map(),
      };
    }
    const attempt = attemptRef.current;

    const finishSchedule = (postId: string) => {
      setDirty(false);
      attemptRef.current = null;
      toast.success(
        selectedAccountIds.length > 1
          ? `${selectedAccountIds.length} publicações agendadas.`
          : "Publicação agendada no calendário.",
      );
      onScheduled({ postId, scheduledAt: scheduledAtIso, clientId, projectId });
      onOpenChange(false);
    };

    try {
      if (attempt.prepared) {
        const recoveredResult = await savePost.mutateAsync(attempt.prepared);
        finishSchedule(recoveredResult.post_id);
        return;
      }

      let completePost: EditorialPostBundle | null = null;
      if (selectedExistingPlan) {
        completePost = await loadEditorialPostForMutation(
          selectedExistingPlan.postId,
          clientId,
        );
        if (
          !editorialSchedulePlanMatchesSnapshot(
            completePost.post.version,
            completePost.publications,
            selectedExistingPlan,
          )
        ) {
          throw new Error(
            "Este plano mudou desde que você o selecionou. Atualize e confirme as contas novamente.",
          );
        }
        if (!isSchedulablePost(completePost)) {
          throw new Error(
            "Este conteúdo mudou e não está mais livre para um novo agendamento. Atualize a lista.",
          );
        }
      }

      const existingPublicationByAccountId = new Map(
        activeEditorialSchedulePlans(
          completePost?.publications || [],
        ).map((bundle) => [bundle.publication.external_account_id, bundle]),
      );
      const completeAccountIds = new Set([
        ...selectedAccountIds,
        ...existingPublicationByAccountId.keys(),
      ]);
      // A conta tem conexão oficial com automação LIGADA? Sem isto o payload
      // declarava "automatic" olhando só a quantidade de arquivos, e o banco
      // recusava o agendamento inteiro. Verzelo é o caso real: conectado,
      // token válido, automação desligada.
      const automacaoPorConta = new Map(
        (options?.accounts || []).map((account: any) => [
          account.id,
          account.connection_status === "connected" &&
            account.automation_enabled === true,
        ]),
      );

      const publicationTargets: EditorialSchedulePublicationTarget[] = [
        ...completeAccountIds,
      ].map((accountId) => {
        const existing = existingPublicationByAccountId.get(accountId);
        if (existing) {
          if (!existing.internal?.idempotency_key) {
            throw new Error(
              "Não foi possível confirmar o plano completo. Atualize e tente novamente.",
            );
          }
          const effectiveFileId =
            existing.publication.file_id || completePost?.post.primary_file_id;
          const existingAsset = effectiveFileId
            ? approvedAssetByRootId.get(effectiveFileId)
            : null;
          if (!existingAsset) {
            throw new Error(
              "Um arquivo deste plano não está mais aprovado. Atualize e revise o conteúdo.",
            );
          }
          return {
            accountId,
            id: existing.publication.id,
            idempotencyKey: existing.internal.idempotency_key,
            asset: existingAsset,
            fileId: existing.publication.file_id,
            caption: existing.publication.caption,
            firstComment: existing.publication.first_comment,
            altText: existing.publication.alt_text,
            automationReady: automacaoPorConta.get(accountId) === true,
          };
        }
        let idempotencyKey = attempt.publicationKeys.get(accountId);
        if (!idempotencyKey) {
          idempotencyKey = newId();
          attempt.publicationKeys.set(accountId, idempotencyKey);
        }
        return {
          accountId,
          idempotencyKey,
          automationReady: automacaoPorConta.get(accountId) === true,
        };
      });

      const payload = buildEditorialSchedulePayload({
        clientId,
        projectId,
        asset: selectedAsset,
        publicationTargets,
        scheduledAtIso,
        timezone: EDITORIAL_DEFAULT_TIME_ZONE,
        postIdempotencyKey: attempt.postIdempotencyKey,
        mutationId: attempt.mutationId,
        existingPost: completePost
          ? {
              id: completePost.post.id,
              idempotencyKey: completePost.internal!.idempotency_key,
              title: completePost.post.title,
              contentType: completePost.post.content_type,
              objective: completePost.post.objective,
              defaultCaption: completePost.post.default_caption,
              taskId: completePost.internal?.task_id,
              responsibleId: completePost.internal?.responsible_id,
              internalNotes: completePost.internal?.internal_notes,
              revisionOfPostId:
                completePost.internal?.revision_of_post_id,
            }
          : null,
      });

      attempt.prepared = {
        payload,
        expectedVersion: completePost?.post.version || null,
      };
      const result = await savePost.mutateAsync(attempt.prepared);
      finishSchedule(result.post_id);
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Não foi possível concluir o agendamento.";
      const stalePlan =
        /editorial post changed|refresh before saving|plano mudou|não está mais livre/i.test(
          message,
        );
      if (stalePlan || /already linked|already used/i.test(message)) {
        attemptRef.current = null;
        setSelectedAsset(null);
        setSelectedExistingPlan(null);
        setSelectedAccountIds([]);
        setShowLibrary(true);
        setPreviewSelectedAsset(false);
        await Promise.all([refetchOptions(), schedulingPosts.refetch()]);
      }
      toast.error(
        stalePlan
          ? "Este plano foi alterado por outra pessoa. Revise o conteúdo e confirme as contas novamente."
          : message,
      );
    }
  };

  const readySteps = [
    Boolean(clientId && projectId),
    Boolean(selectedAsset),
    selectedAccountIds.length > 0,
    Boolean(scheduledAt),
  ];

  return (
    <>
      <Dialog open={open} onOpenChange={requestOpenChange}>
      <DialogContent className="bottom-[max(0.5rem,env(safe-area-inset-bottom))] top-[max(0.5rem,env(safe-area-inset-top))] flex w-[calc(100vw-1rem)] max-w-5xl translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:bottom-auto sm:top-1/2 sm:max-h-[calc(100dvh-3rem)] sm:translate-y-[-50%]">
        <DialogHeader className="shrink-0 border-b border-border bg-background px-4 py-4 pr-12 text-left sm:px-6 sm:py-5">
          <DialogTitle className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CalendarCheck2 className="h-4 w-4" aria-hidden="true" />
            </span>
            Agendar publicação
          </DialogTitle>
          <DialogDescription>
            Escolha um conteúdo já aprovado. Conta e horário são registrados
            juntos, sem misturar com a criação editorial.
          </DialogDescription>
          <div className="grid grid-cols-4 gap-1.5 pt-2" aria-label="Etapas do agendamento">
            {stepItems.map((step, index) => (
              <div
                key={step.label}
                className={cn(
                  "flex min-w-0 items-center justify-center gap-1 rounded-lg border px-1.5 py-2 text-[10px] font-medium sm:justify-start sm:px-2.5",
                  readySteps[index]
                    ? "border-primary/25 bg-primary/[0.06] text-foreground"
                    : "border-border bg-muted/20 text-muted-foreground",
                )}
              >
                {readySteps[index] ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                ) : (
                  <step.icon className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="truncate">{step.label}</span>
              </div>
            ))}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
          <section className="grid gap-3 rounded-xl border border-border bg-card/60 p-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="schedule-client">Cliente</Label>
              <Select
                value={clientId}
                onValueChange={(value) => {
                  setClientId(value);
                  setProjectId("");
                  setSelectedAsset(null);
                  setSelectedExistingPlan(null);
                  setSelectedAccountIds([]);
                  setAccountSearch("");
                  setShowLibrary(true);
                  setDirty(true);
                  attemptRef.current = null;
                }}
              >
                <SelectTrigger id="schedule-client" className="h-11">
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
              <Label htmlFor="schedule-project">Projeto</Label>
              <Select
                value={projectId}
                onValueChange={(value) => {
                  setProjectId(value);
                  setSelectedAsset(null);
                  setSelectedExistingPlan(null);
                  setSelectedAccountIds([]);
                  setAccountSearch("");
                  setShowLibrary(true);
                  setDirty(true);
                  attemptRef.current = null;
                }}
                disabled={!clientId}
              >
                <SelectTrigger id="schedule-project" className="h-11">
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
          </section>

          {!clientId || !projectId ? (
            <div className="mt-4 rounded-xl border border-dashed border-border px-4 py-10 text-center">
              <Settings2 className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium text-foreground">
                Comece pelo cliente e projeto
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Assim o painel busca apenas conteúdos e contas do lugar certo.
              </p>
            </div>
          ) : optionsLoading || schedulingPosts.isLoading ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.8fr)]">
              <Skeleton className="h-[420px] rounded-xl" />
              <Skeleton className="h-[320px] rounded-xl" />
            </div>
          ) : optionsFailed || schedulingPosts.isError ? (
            <div
              role="alert"
              className="mt-4 flex flex-col items-center rounded-xl border border-destructive/25 bg-destructive/5 px-5 py-10 text-center"
            >
              <AlertCircle className="h-6 w-6 text-destructive" />
              <p className="mt-2 text-sm font-medium text-foreground">
                Não foi possível carregar o material para agendamento
              </p>
              <p className="mt-1 max-w-lg text-xs text-muted-foreground">
                {optionsError instanceof Error
                  ? optionsError.message
                  : "Atualize os conteúdos e tente novamente."}
              </p>
              <Button
                type="button"
                variant="outline"
                className="mt-4"
                onClick={() =>
                  void Promise.all([
                    refetchOptions(),
                    schedulingPosts.refetch(),
                  ])
                }
              >
                Tentar novamente
              </Button>
            </div>
          ) : (
            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.8fr)]">
              <section className="min-w-0 rounded-xl border border-border bg-card/50 p-4">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">
                      Conteúdo aprovado
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      A busca considera título, legenda e todos os slides.
                    </p>
                  </div>
                  <Badge variant="secondary">
                    {libraryAssets.length} disponíve{libraryAssets.length === 1 ? "l" : "is"}
                  </Badge>
                </div>
                {selectedAsset && !showLibrary ? (
                  <div className="rounded-xl border border-primary/25 bg-primary/[0.04] p-3">
                    <div className="flex min-w-0 items-start gap-3">
                      {/* A ARTE, não um ícone genérico. O card é a confirmação
                          visual de que a peça certa foi escolhida — com um
                          clipe de papel, quem confere no celular precisa ler o
                          nome do arquivo para ter certeza. */}
                      <span className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-border">
                        <AssetPreview asset={selectedAsset} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[10px] font-semibold uppercase tracking-wide text-primary">
                          Conteúdo escolhido
                        </span>
                        {/* Duas linhas em vez de corte: no celular o nome
                            terminava em "..." e virava adivinhação. */}
                        <span className="mt-1 block line-clamp-2 text-sm font-medium leading-snug text-foreground">
                          {selectedAsset.root.file_name}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {selectedAsset.contentType === "carousel"
                            ? `Carrossel completo · ${selectedAsset.files.length} arquivos`
                            : selectedAsset.contentType === "video"
                              ? "Vídeo aprovado"
                              : "Post aprovado"}
                        </span>
                      </span>
                    </div>
                    {/* Empilhados no aparelho estreito: lado a lado, "Trocar
                        conteúdo" quebrava dentro do próprio botão. */}
                    <div className="mt-3 grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-10"
                        onClick={() => setPreviewSelectedAsset(true)}
                      >
                        <Eye className="mr-1.5 h-4 w-4" />
                        Ver completo
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-10"
                        onClick={() => setShowLibrary(true)}
                      >
                        Trocar conteúdo
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Os conteúdos do CALENDÁRIO prontos para agendar, em um
                        clique. O diálogo sempre soube quais são
                        (schedulablePosts) — mas só os usava como índice
                        interno, e quem agendava era obrigado a reencontrar a
                        mídia na lista de arquivos. O card já carrega arte,
                        título e plano de contas: escolher ele é escolher tudo. */}
                    {schedulablePosts.length > 0 && (
                      <div className="mb-3">
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Prontos no calendário — um clique
                        </p>
                        {/* Rolagem própria: com dezenas de prontos, a lista
                            empurrava o resto do diálogo para fora da tela no
                            celular e o botão de agendar sumia. */}
                        <div className="grid max-h-[300px] gap-2 overflow-y-auto pr-1 sm:max-h-none sm:grid-cols-2 sm:overflow-visible sm:pr-0">
                          {schedulablePosts.map((bundle) => {
                            const asset = bundle.post.primary_file_id
                              ? approvedAssetByRootId.get(bundle.post.primary_file_id)
                              : undefined;
                            if (!asset) return null;
                            return (
                              <button
                                key={bundle.post.id}
                                type="button"
                                onClick={() => selectAsset(asset)}
                                className="flex min-h-[60px] items-center gap-2.5 rounded-xl border border-primary/25 bg-primary/[0.04] p-2.5 text-left transition-colors hover:border-primary/50 hover:bg-primary/10"
                              >
                                <EditorialFileThumbnail
                                  post={bundle}
                                  className="h-12 w-12 shrink-0"
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block line-clamp-2 text-[12.5px] font-medium leading-snug text-foreground">
                                    {bundle.post.title}
                                  </span>
                                  <span className="block truncate text-[10.5px] text-muted-foreground">
                                    Arte e contas já definidas · só falta a data
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                        <p className="my-2 text-center text-[10px] text-muted-foreground">
                          ou escolha direto dos arquivos
                        </p>
                      </div>
                    )}
                    <ApprovedMediaPicker
                      files={options?.files || []}
                      usedRootFileIds={blockedUsedRootIds}
                      selectedFileId={selectedAsset?.id || null}
                      onSelect={selectAsset}
                    />
                  </>
                )}
              </section>

              <div className="min-w-0 space-y-4">
                <section className="rounded-xl border border-border bg-card/50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">
                        Contas deste projeto
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {selectedClientName} · {selectedProjectName}
                      </p>
                    </div>
                    <Share2 className="h-4 w-4 text-primary" aria-hidden="true" />
                  </div>

                  {(options?.accounts || []).length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {(options?.accounts || []).length > 4 && (
                        <div className="relative">
                          <Search
                            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                            aria-hidden="true"
                          />
                          <Input
                            value={accountSearch}
                            onChange={(event) =>
                              setAccountSearch(event.target.value)
                            }
                            className="h-10 pl-9"
                            placeholder="Buscar conta ou @usuário"
                            aria-label="Buscar conta deste projeto"
                          />
                        </div>
                      )}
                      {visibleAccounts.map((account) => {
                        const checked = selectedAccountIds.includes(account.id);
                        const locked = lockedAccountIds.has(account.id);
                        const unavailable = unavailableAccountIds.has(account.id);
                        const disabled = locked || unavailable;
                        const connectionLabel =
                          account.connection_status === "connected"
                            ? "Oficial Meta"
                            : account.connection_status === "expired"
                              ? "Expirada"
                              : account.connection_status === "revoked"
                                ? "Desconectada"
                                : "Planejamento manual";
                        return (
                          <label
                            key={account.id}
                            className={cn(
                              "flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors",
                              unavailable && "cursor-not-allowed opacity-65",
                              checked
                                ? "border-primary/40 bg-primary/[0.05]"
                                : "border-border bg-background hover:border-primary/30",
                            )}
                          >
                            <Checkbox
                              checked={checked}
                              disabled={disabled}
                              onCheckedChange={(value) =>
                                toggleAccount(account.id, value === true)
                              }
                              aria-label={`Selecionar ${account.display_name}`}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-medium text-foreground">
                                {account.handle || account.display_name}
                              </span>
                              <span className="block text-[10px] text-muted-foreground">
                                {PLATFORM_LABELS[
                                  account.platform as keyof typeof PLATFORM_LABELS
                                ] || account.platform}
                                {locked
                                  ? " · já no plano"
                                  : unavailable
                                    ? " · reconexão necessária"
                                    : ""}
                              </span>
                            </span>
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[9px]",
                                account.connection_status === "connected"
                                  ? "border-success/25 bg-success/10 text-success"
                                  : unavailable
                                    ? "border-destructive/25 bg-destructive/5 text-destructive"
                                  : "text-muted-foreground",
                              )}
                            >
                              {connectionLabel}
                            </Badge>
                          </label>
                        );
                      })}
                      {visibleAccounts.length === 0 && (
                        <div className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">
                          Nenhuma conta corresponde à busca.
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="mt-3 rounded-lg border border-dashed border-border bg-muted/20 p-4 text-center">
                      <p className="text-xs font-medium text-foreground">
                        Nenhuma conta vinculada a este projeto
                      </p>
                      <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                        Conecte ou vincule a conta aqui mesmo para continuar.
                      </p>
                    </div>
                  )}

                  <div className="mt-3">
                    <EditorialAccountSetup
                      clientId={clientId}
                      clientName={selectedClientName}
                      projectId={projectId}
                      projectName={selectedProjectName}
                      linkedAccounts={options?.accounts || []}
                      availableAccounts={options?.availableAccounts || []}
                      canManage={options?.canManageAccounts === true}
                      permissionUnavailable={
                        options?.accountPermissionUnavailable === true
                      }
                      onAccountReady={handleAccountReady}
                      showManualOptions={false}
                      compact
                    />
                  </div>
                  {hasUnavailableSelection && (
                    <p
                      role="alert"
                      className="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-[10px] leading-4 text-destructive"
                    >
                      Uma conta deste plano precisa ser reconectada antes do
                      agendamento.
                    </p>
                  )}
                  {hasMissingSelectedAccounts && (
                    <p
                      role="alert"
                      className="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-[10px] leading-4 text-destructive"
                    >
                      {missingSelectedAccountIds.length === 1
                        ? "Uma conta deste plano foi inativada ou removida do projeto."
                        : `${missingSelectedAccountIds.length} contas deste plano foram inativadas ou removidas do projeto.`}{" "}
                      Revise ou reconecte o vínculo abaixo para continuar.
                    </p>
                  )}
                </section>

                <section className="rounded-xl border border-border bg-card/50 p-4">
                  <div className="space-y-2">
                    <Label htmlFor="schedule-date-time">Data e horário</Label>
                    <Input
                      id="schedule-date-time"
                      type="datetime-local"
                      value={scheduledAt}
                      min={nextHourLocal()}
                      onChange={(event) => {
                        setScheduledAt(event.target.value);
                        setDirty(true);
                        attemptRef.current = null;
                      }}
                      className="h-11"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Fuso: Brasília · o status será registrado como agendado.
                    </p>
                  </div>
                </section>

                <section className="rounded-xl border border-primary/20 bg-primary/[0.04] p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Resumo
                  </p>
                  <p className="mt-2 line-clamp-2 text-sm font-medium text-foreground">
                    {selectedAsset?.root.file_name || "Escolha um conteúdo"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {selectedAccountIds.length > 0
                      ? `${selectedAccountIds.length} conta${selectedAccountIds.length === 1 ? "" : "s"} selecionada${selectedAccountIds.length === 1 ? "" : "s"}`
                      : "Nenhuma conta selecionada"}
                  </p>
                  {selectedAsset?.contentType === "carousel" && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Carrossel completo · {selectedAsset.files.length} arquivos
                    </p>
                  )}
                </section>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 items-stretch justify-between gap-3 border-t border-border bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:px-6">
          <p className="mr-auto text-[11px] text-muted-foreground" aria-live="polite">
            {missingFields.length > 0
              ? `Falta: ${missingFields.join(", ")}`
              : hasMissingSelectedAccounts
                ? "Revise as contas que não estão mais vinculadas"
                : hasUnavailableSelection
                  ? "Reconecte ou substitua as contas indisponíveis"
              : "Tudo pronto para agendar"}
          </p>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full sm:h-10 sm:w-auto"
            onClick={() => requestOpenChange(false)}
            disabled={savePost.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            className="h-11 w-full sm:h-10 sm:w-auto"
            onClick={handleSchedule}
            disabled={
              savePost.isPending ||
              missingFields.length > 0 ||
              hasUnavailableSelection
              || hasMissingSelectedAccounts
            }
          >
            {savePost.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />
            ) : (
              <CalendarCheck2 className="mr-2 h-4 w-4" />
            )}
            {selectedAccountIds.length > 1
              ? `Agendar ${selectedAccountIds.length} publicações`
              : "Agendar publicação"}
          </Button>
        </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={discardConfirmOpen}
        onOpenChange={setDiscardConfirmOpen}
      >
        <AlertDialogContent className="w-[calc(100vw-2rem)] rounded-lg sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar este agendamento?</AlertDialogTitle>
            <AlertDialogDescription>
              O rascunho do agendamento será descartado. Contas já conectadas
              permanecem vinculadas ao cliente e ao projeto.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar editando</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={discardAndClose}
            >
              Descartar e fechar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <EditorialAssetPreviewDialog
        asset={selectedAsset}
        open={previewSelectedAsset}
        selected
        onOpenChange={setPreviewSelectedAsset}
      />
    </>
  );
}
