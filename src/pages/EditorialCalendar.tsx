import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  GripVertical,
  LayoutTemplate,
  RefreshCw,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import EditorialToolbar, {
  type EditorialView,
} from "@/components/editorial/EditorialToolbar";
import EditorialCalendarViews, {
  type ScheduledEditorialItem,
} from "@/components/editorial/EditorialCalendarViews";
import EditorialEditor from "@/components/editorial/EditorialEditor";
import EditorialScheduleDialog from "@/components/editorial/EditorialScheduleDialog";
import EditorialDetailSheet from "@/components/editorial/EditorialDetailSheet";
import type { EditorialInboxTask } from "@/components/editorial/EditorialTaskInbox";
import {
  useEditorialClientScope,
  useEditorialCalendar,
  useEditorialLinkedTaskIds,
  useEditorialMutations,
  useEditorialPostDetail,
  loadEditorialPostForMutation,
  type EditorialPostBundle,
  type EditorialRealtimeGate,
} from "@/hooks/useEditorialCalendar";
import {
  useClients,
  useProjects,
  useTasks,
  useTeamMembers,
} from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { useImpersonation } from "@/contexts/ImpersonationContext";
import {
  EDITORIAL_PLATFORMS,
  EDITORIAL_PRODUCTION_STATUS_CONFIG,
  EDITORIAL_STATUS_CONFIG,
  PLATFORM_LABELS,
  aggregateEditorialStatus,
  editorialPermissions,
  getEditorialApprovalStage,
  matchesEditorialFilters,
  type EditorialAggregateStatus,
  type EditorialPlatform,
} from "@/lib/editorial";
import {
  EDITORIAL_DEFAULT_TIME_ZONE,
  dateKeyInTimeZone,
  getEditorialQueryRange,
  getEditorialWeekDays,
  navigateEditorialDate,
  normalizeEditorialDateParam,
} from "@/lib/editorialDate";
import {
  buildEditorialPostMutationPayload,
  isEditorialPostPlanMutable,
  isEditorialPublicationDraggable,
  moveEditorialInstantToCalendarDate,
  type EditableEditorialStage,
} from "@/lib/editorialDrag";
import {
  canonicalTaskStatus,
  editorialStageForTaskStatus,
  kanbanStatusForEditorialStage,
} from "@/lib/taskWorkstreams";
import {
  updateCachedEditorialPostStage,
  updateCachedEditorialPublicationDate,
  updateCachedTaskStatus,
} from "@/lib/editorialOptimistic";
import {
  TASK_DELIVERY_TYPE_LABELS,
  contentTypeForDeliveryType,
  isPublishableTask,
  type TaskDeliveryType,
} from "@/lib/taskDeliveryTypes";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { sendTaskAttachmentsToApproval } from "@/lib/reviewToApproval";

const validViews: EditorialView[] = ["board", "month", "week", "list"];
const aggregateStatuses = Object.keys(
  EDITORIAL_STATUS_CONFIG,
) as EditorialAggregateStatus[];
const productionStatuses = Object.entries(EDITORIAL_PRODUCTION_STATUS_CONFIG)
  .filter(([value]) => value !== "archived")
  .map(([value, config]) => ({ value, label: config.label }));
const approvalStatuses = [
  { value: "not_requested", label: "Antes da revisão" },
  { value: "agency_review", label: "Revisão interna" },
  { value: "agency_approved", label: "Aprovado internamente" },
  { value: "client_review", label: "Aprovação do cliente" },
  { value: "approved", label: "Double-gate aprovado" },
  { value: "changes", label: "Ajustes solicitados" },
];
const editorialFormats = [
  { value: "static", label: "Arte / post estático" },
  { value: "carousel", label: "Carrossel" },
  { value: "reel", label: "Reels" },
  { value: "story", label: "Stories" },
  { value: "video", label: "Vídeo" },
  { value: "short", label: "Short" },
  { value: "article", label: "Artigo" },
  { value: "google_post", label: "Post Google" },
];
const editorialFormatValues = new Set(
  editorialFormats.map(({ value }) => value),
);

interface CalendarClientRow {
  id: string;
  full_name?: string | null;
  company_name?: string | null;
}

interface CalendarProjectRow {
  id: string;
  client_id: string;
  name: string;
}

interface CalendarTeamMemberRow {
  id: string;
  full_name?: string | null;
  role?: string;
}

interface EditorialDraftSeed {
  clientId: string;
  projectId: string;
  taskId?: string;
  title?: string;
  context?: string;
  contentType?: string;
  responsibleId?: string;
  productionStatus?: EditableEditorialStage | "cancelled";
  scheduledAt?: string;
}

interface DragSummary {
  kind: "task" | "post" | "publication";
  label: string;
}

function updateParam(current: URLSearchParams, key: string, value: string) {
  const next = new URLSearchParams(current);
  if (!value || value === "all") next.delete(key);
  else next.set(key, value);
  return next;
}

function periodTitle(dateKey: string, view: EditorialView) {
  if (view === "board") return "Conteúdos em produção";
  const date = new Date(`${dateKey}T12:00:00`);
  if (view === "week") {
    const days = getEditorialWeekDays(dateKey);
    if (days.length === 7) {
      const first = new Date(`${days[0].dateKey}T12:00:00`);
      const last = new Date(`${days[6].dateKey}T12:00:00`);
      const firstLabel = new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "short",
      }).format(first);
      const lastLabel = new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(last);
      return `${firstLabel} – ${lastLabel}`;
    }
  }
  return new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  }).format(date);
}

function CalendarMetrics({
  posts,
  taskCount,
}: {
  posts: EditorialPostBundle[];
  taskCount?: number;
}) {
  const publications = posts.flatMap((post) =>
    post.publications.map(({ publication }) => publication),
  );
  const metrics = [
    ...(taskCount === undefined
      ? []
      : [
          {
            label: "Tarefas",
            value: taskCount,
            icon: LayoutTemplate,
            className: "text-violet-500 bg-violet-500/10",
          },
        ]),
    {
      label: "Conteúdos",
      value: posts.length,
      icon: CalendarDays,
      className: "text-sky-500 bg-sky-500/10",
    },
    {
      label: "Agendados",
      value: publications.filter(
        (publication) => publication.status === "scheduled",
      ).length,
      icon: Clock3,
      className: "text-sky-500 bg-sky-500/10",
    },
    {
      label: "Publicados",
      value: publications.filter(
        (publication) => publication.status === "published",
      ).length,
      icon: CheckCircle2,
      className: "text-success bg-success/10",
    },
    ...(taskCount === undefined
      ? [
          {
            label: "Falhas",
            value: publications.filter(
              (publication) => publication.status === "failed",
            ).length,
            icon: AlertCircle,
            className: "text-destructive bg-destructive/10",
          },
        ]
      : []),
  ];

  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-border bg-card/70 lg:grid-cols-4">
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className="flex items-center gap-3 border-b border-r border-border px-4 py-3.5 last:border-r-0 lg:border-b-0"
        >
          <span
            className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${metric.className}`}
          >
            <metric.icon className="h-4 w-4" />
          </span>
          <div>
            <p className="text-base font-semibold leading-none text-foreground">
              {metric.value}
            </p>
            <p className="mt-1.5 text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
              {metric.label}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function EditorialCalendar() {
  const { profile } = useAuth();
  const { isImpersonating, impersonatedId } = useImpersonation();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const editorialRealtimeGateRef = useRef<EditorialRealtimeGate>({
    pendingCount: 0,
    deferred: false,
  });
  const pendingMoveKeysRef = useRef(new Set<string>());
  const [pendingMoveKeys, setPendingMoveKeys] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const effectiveRole = isImpersonating ? "client" : profile?.role;
  const todayKey = dateKeyInTimeZone(new Date()) || "2026-01-01";
  const requestedView = searchParams.get("view") as EditorialView | null;
  // Cliente no mobile abre direto em lista: nada de calendário mensal espremido.
  const defaultView: EditorialView =
    effectiveRole === "client" && typeof window !== "undefined" && window.innerWidth < 768
      ? "list"
      : "month";
  const view = validViews.includes(requestedView || ("" as EditorialView))
    ? (requestedView as EditorialView)
    : defaultView;
  const dateKey = normalizeEditorialDateParam(
    searchParams.get("date"),
    todayKey,
  );
  const search = searchParams.get("q") || "";
  const requestedClientId = searchParams.get("client") || "all";
  const projectId = searchParams.get("project") || "all";
  const requestedFormat = searchParams.get("format") || "all";
  const format =
    requestedFormat === "all" || editorialFormatValues.has(requestedFormat)
      ? requestedFormat
      : "all";
  const platform = searchParams.get("platform") || "all";
  const status = searchParams.get("status") || "all";
  const productionStatus = searchParams.get("production") || "all";
  const approvalStatus = searchParams.get("approval") || "all";
  const requestedResponsibleId = searchParams.get("responsible") || "all";
  const contentId = searchParams.get("content");
  const permissions = editorialPermissions(effectiveRole);
  const responsibleId =
    permissions.canEdit && !isImpersonating ? requestedResponsibleId : "all";
  const forcedClientId =
    effectiveRole === "client"
      ? impersonatedId || profile?.id || ""
      : requestedClientId === "all"
        ? ""
        : requestedClientId;

  const clientsQuery = useClients();
  const projectsQuery = useProjects();
  const clients = useMemo(() => clientsQuery.data || [], [clientsQuery.data]);
  const projects = useMemo(
    () => projectsQuery.data || [],
    [projectsQuery.data],
  );
  const canUseTeamData = permissions.canEdit && !isImpersonating;
  const editorialScopeQuery = useEditorialClientScope(canUseTeamData);
  const linkedTaskIdsQuery = useEditorialLinkedTaskIds(
    canUseTeamData,
    editorialRealtimeGateRef,
  );
  const teamMembersQuery = useTeamMembers(canUseTeamData);
  const tasksQuery = useTasks(undefined, {
    enabled: canUseTeamData,
    refetchInterval: pendingMoveKeys.size > 0 ? false : 15_000,
  });
  const teamMembers = useMemo(
    () => teamMembersQuery.data || [],
    [teamMembersQuery.data],
  );
  const range = view === "board" ? null : getEditorialQueryRange(dateKey, view);
  const calendarQuery = useEditorialCalendar(
    {
      clientId: forcedClientId || undefined,
      projectId: projectId === "all" ? undefined : projectId,
      platform: platform === "all" ? undefined : platform,
      rangeStart: range?.startIso,
      rangeEnd: range?.endExclusiveIso,
    },
    {
      forceClientView: isImpersonating,
      realtimeGate: editorialRealtimeGateRef,
    },
  );
  const clientRows = clients as unknown as CalendarClientRow[];
  const projectRows = projects as unknown as CalendarProjectRow[];

  // A Agenda de conteúdo é só de quem tem frente de social media: cliente com o
  // serviço marcado no cadastro ou com projeto de social ativo. Evita misturar
  // clientes de site/tráfego/avulsos no calendário editorial.
  const socialClientIds = useMemo(() => {
    const ids = new Set<string>();
    (clientRows || []).forEach((row: any) => {
      if (row?.services_config?.social) ids.add(row.id);
    });
    (projectRows || []).forEach((row: any) => {
      if (row?.project_type === "social_media" && row?.client_id) ids.add(row.client_id);
    });
    return ids;
  }, [clientRows, projectRows]);
  const restrictStaffScope = ["manager", "design", "traffic"].includes(
    profile?.role || "",
  );
  const editorialOptionsLoading =
    clientsQuery.isLoading ||
    projectsQuery.isLoading ||
    (canUseTeamData && teamMembersQuery.isLoading) ||
    (restrictStaffScope && editorialScopeQuery.isLoading);
  const editorialOptionsError =
    clientsQuery.isError ||
    projectsQuery.isError ||
    (canUseTeamData && teamMembersQuery.isError) ||
    (restrictStaffScope && editorialScopeQuery.isError);
  const canCreateEditorial =
    permissions.canEdit &&
    !isImpersonating &&
    !editorialOptionsLoading &&
    !editorialOptionsError;
  const canScheduleEditorial =
    permissions.canPublish && canCreateEditorial;
  const scopedClientIds = useMemo(() => {
    if (!restrictStaffScope) return null;
    return new Set(editorialScopeQuery.data || []);
  }, [editorialScopeQuery.data, restrictStaffScope]);
  const editorialClientRows = useMemo(
    () =>
      (scopedClientIds === null
        ? clientRows
        : clientRows.filter((client) => scopedClientIds.has(client.id))
      ).filter((client) => !canUseTeamData || socialClientIds.has(client.id)),
    [clientRows, scopedClientIds, canUseTeamData, socialClientIds],
  );
  const editorialProjectRows = useMemo(
    () =>
      (scopedClientIds === null
        ? projectRows
        : projectRows.filter((project) =>
            scopedClientIds.has(project.client_id),
          )
      ).filter((project) => !canUseTeamData || socialClientIds.has(project.client_id)),
    [projectRows, scopedClientIds, canUseTeamData, socialClientIds],
  );
  const teamRows = useMemo(
    () =>
      canUseTeamData ? (teamMembers as unknown as CalendarTeamMemberRow[]) : [],
    [canUseTeamData, teamMembers],
  );
  const posts = useMemo(
    () =>
      (calendarQuery.data?.posts || []).filter(
        (bundle) => !canUseTeamData || socialClientIds.has(bundle.post.client_id),
      ),
    [calendarQuery.data?.posts, canUseTeamData, socialClientIds],
  );
  const detailQuery = useEditorialPostDetail(
    contentId,
    forcedClientId || null,
    { forceClientView: isImpersonating },
  );
  const { savePost, transitionPublication } = useEditorialMutations();
  const [editorOpen, setEditorOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [batchScheduling, setBatchScheduling] = useState(false);

  // Fluxo sincronizado: publicações PLANEJADAS cujo conteúdo o cliente já
  // aprovou ficam prontas para confirmar o agendamento em um clique.
  // Data/horário planejados são mantidos; se o horário já passou, vai para
  // 1 hora a partir de agora.
  const approvedReadyToSchedule = useMemo(() => {
    if (!canUseTeamData || !permissions.canPublish) return [] as {
      bundle: EditorialPostBundle;
      publicationId: string;
      version: number;
      scheduledAt: string;
    }[];
    const out: { bundle: EditorialPostBundle; publicationId: string; version: number; scheduledAt: string }[] = [];
    posts.forEach((bundle) => {
      if (getEditorialApprovalStage(bundle) !== "approved") return;
      bundle.publications.forEach((publicationBundle) => {
        const publication = publicationBundle.publication;
        if (publication.status === "planned" && publication.scheduled_at) {
          out.push({
            bundle,
            publicationId: publication.id,
            version: publication.version,
            scheduledAt: publication.scheduled_at,
          });
        }
      });
    });
    return out;
  }, [posts, canUseTeamData, permissions.canPublish]);

  const scheduleApprovedNow = useCallback(async () => {
    if (batchScheduling || approvedReadyToSchedule.length === 0) return;
    setBatchScheduling(true);
    let scheduled = 0;
    let failed = 0;
    for (const item of approvedReadyToSchedule) {
      const planned = new Date(item.scheduledAt);
      const target = planned.getTime() > Date.now()
        ? item.scheduledAt
        : new Date(Date.now() + 60 * 60 * 1000).toISOString();
      try {
        await transitionPublication.mutateAsync({
          publicationId: item.publicationId,
          action: "schedule",
          expectedVersion: item.version,
          scheduledAt: target,
          timezone: EDITORIAL_DEFAULT_TIME_ZONE,
          deferRefresh: true,
        });
        scheduled += 1;
      } catch {
        failed += 1;
      }
    }
    await queryClient.invalidateQueries({ queryKey: ["editorial-calendar"] });
    if (scheduled > 0) {
      toast.success(
        `${scheduled} publicação(ões) aprovadas foram agendadas${failed > 0 ? ` · ${failed} falharam, tente novamente` : ""}.`,
      );
    } else if (failed > 0) {
      toast.error("Não foi possível agendar. Atualize o calendário e tente novamente.");
    }
    setBatchScheduling(false);
  }, [approvedReadyToSchedule, batchScheduling, queryClient, transitionPublication]);
  const [scheduleDefaultAt, setScheduleDefaultAt] = useState("");
  const [editingPost, setEditingPost] = useState<EditorialPostBundle | null>(
    null,
  );
  const [revisionSource, setRevisionSource] =
    useState<EditorialPostBundle | null>(null);
  const [draftSeed, setDraftSeed] = useState<EditorialDraftSeed | null>(null);
  const [dragSummary, setDragSummary] = useState<DragSummary | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      // O arrasto tem que colar no cursor: 2px de tolerância, sem espera.
      activationConstraint: { distance: 2 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 120, tolerance: 8 },
    }),
    useSensor(KeyboardSensor),
  );

  const clientNames = useMemo(
    () =>
      new Map(
        clientRows.map((client) => [
          client.id,
          client.company_name || client.full_name || "Cliente",
        ]),
      ),
    [clientRows],
  );
  const projectNames = useMemo(
    () =>
      new Map(
        projectRows.map((project) => [project.id, project.name || "Projeto"]),
      ),
    [projectRows],
  );
  const projectById = useMemo(
    () => new Map(editorialProjectRows.map((project) => [project.id, project])),
    [editorialProjectRows],
  );
  const responsibleNames = useMemo(
    () =>
      new Map(
        teamRows.map((member) => [
          member.id,
          member.full_name || "Membro da equipe",
        ]),
      ),
    [teamRows],
  );
  const projectScopeNames = useMemo(
    () =>
      new Map(
        projectRows.map((project) => [
          project.id,
          `${clientNames.get(project.client_id) || "Cliente"} / ${
            project.name || "Projeto"
          }`,
        ]),
      ),
    [clientNames, projectRows],
  );
  const linkedTaskIds = useMemo(
    () => new Set(linkedTaskIdsQuery.data?.taskIds || []),
    [linkedTaskIdsQuery.data?.taskIds],
  );
  const linkedPostIdByTaskId = useMemo(
    () => linkedTaskIdsQuery.data?.postIdByTaskId || {},
    [linkedTaskIdsQuery.data?.postIdByTaskId],
  );
  const candidateTasks = useMemo(() => {
    if (!canUseTeamData) return [];
    const statusOrder: Record<string, number> = {
      backlog: 0,
      todo: 0,
      doing: 1,
      review: 2,
      approved: 2,
      blocked: 3,
    };
    const priorityOrder: Record<string, number> = {
      urgent: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    return ((tasksQuery.data || []) as EditorialInboxTask[])
      .filter((task) => {
        if (
          task.source?.toLocaleLowerCase("pt-BR").startsWith("client_request:")
        ) {
          return false;
        }
        if (task.status === "done") {
          return false;
        }
        const project = projectById.get(task.project_id);
        if (!project) return false;
        if (canUseTeamData && !socialClientIds.has(project.client_id)) {
          return false;
        }
        if (forcedClientId && project.client_id !== forcedClientId) {
          return false;
        }
        if (projectId !== "all" && task.project_id !== projectId) {
          return false;
        }
        return true;
      })
      .sort((left, right) => {
        const priorityDifference =
          (priorityOrder[left.priority || ""] ?? 9) -
          (priorityOrder[right.priority || ""] ?? 9);
        if (priorityDifference !== 0) return priorityDifference;
        const statusDifference =
          (statusOrder[left.status] ?? 9) - (statusOrder[right.status] ?? 9);
        if (statusDifference !== 0) return statusDifference;
        const leftDue = left.due_date
          ? new Date(left.due_date).getTime()
          : Number.MAX_SAFE_INTEGER;
        const rightDue = right.due_date
          ? new Date(right.due_date).getTime()
          : Number.MAX_SAFE_INTEGER;
        return leftDue - rightDue;
      });
  }, [canUseTeamData, forcedClientId, projectById, projectId, tasksQuery.data]);
  const normalizedTaskSearch = useMemo(
    () =>
      search
        .trim()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLocaleLowerCase("pt-BR"),
    [search],
  );
  const matchesTaskFilters = useCallback(
    (task: EditorialInboxTask) => {
      if (
        format !== "all" &&
        contentTypeForDeliveryType(task.delivery_type) !== format
      ) {
        return false;
      }
      if (responsibleId !== "all" && task.assigned_to !== responsibleId) {
        return false;
      }
      if (
        productionStatus !== "all" &&
        editorialStageForTaskStatus(task.status) !== productionStatus
      ) {
        return false;
      }
      if (platform !== "all" || status !== "all" || approvalStatus !== "all") {
        return false;
      }
      if (!normalizedTaskSearch) return true;
      const deliveryType = task.delivery_type as
        TaskDeliveryType | null | undefined;
      const searchable = [
        task.title,
        task.description,
        projectScopeNames.get(task.project_id),
        deliveryType ? TASK_DELIVERY_TYPE_LABELS[deliveryType] : null,
        task.assigned_to
          ? responsibleNames.get(task.assigned_to)
          : "Sem responsável",
      ]
        .filter(Boolean)
        .join(" ")
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLocaleLowerCase("pt-BR");
      return searchable.includes(normalizedTaskSearch);
    },
    [
      approvalStatus,
      format,
      normalizedTaskSearch,
      platform,
      productionStatus,
      projectScopeNames,
      responsibleId,
      responsibleNames,
      status,
    ],
  );
  const editorialDeadlineTasks = useMemo(
    () =>
      candidateTasks.filter(
        (task) =>
          isPublishableTask(task) &&
          matchesTaskFilters(task),
      ),
    [candidateTasks, matchesTaskFilters],
  );
  const productionTasks = useMemo(
    () =>
      editorialDeadlineTasks.filter((task) => !linkedTaskIds.has(task.id)),
    [editorialDeadlineTasks, linkedTaskIds],
  );
  const taskDataLoading =
    canUseTeamData && (tasksQuery.isLoading || linkedTaskIdsQuery.isLoading);
  const taskDataError =
    canUseTeamData && (tasksQuery.isError || linkedTaskIdsQuery.isError);
  const taskDataReady =
    !canUseTeamData ||
    (tasksQuery.data !== undefined && linkedTaskIdsQuery.data !== undefined);
  const tasksForCurrentView =
    !canUseTeamData || !taskDataReady
      ? []
      : view === "board"
        ? productionTasks
        : editorialDeadlineTasks;
  const filteredProjects = useMemo(
    () =>
      editorialProjectRows.filter(
        (project) => !forcedClientId || project.client_id === forcedClientId,
      ),
    [editorialProjectRows, forcedClientId],
  );
  const filteredPosts = useMemo(
    () =>
      posts.filter((bundle) => {
        if (!editorialFormatValues.has(bundle.post.content_type)) {
          return false;
        }
        if (format !== "all" && bundle.post.content_type !== format) {
          return false;
        }
        if (
          productionStatus !== "all" &&
          bundle.post.production_status !== productionStatus
        ) {
          return false;
        }
        if (
          approvalStatus !== "all" &&
          getEditorialApprovalStage(bundle) !== approvalStatus
        ) {
          return false;
        }
        if (
          responsibleId !== "all" &&
          bundle.internal?.responsible_id !== responsibleId
        ) {
          return false;
        }
        return matchesEditorialFilters(
          {
            title: bundle.post.title,
            objective: bundle.post.objective,
            default_caption: bundle.post.default_caption,
            content_type: bundle.post.content_type,
            production_status: bundle.post.production_status,
            client_name: clientNames.get(bundle.post.client_id),
            project_name: projectNames.get(bundle.post.project_id),
            responsible_name: teamRows.find(
              (member) => member.id === bundle.internal?.responsible_id,
            )?.full_name,
            publications: bundle.publications.map(({ publication }) => ({
              platform: publication.platform,
              status: publication.status,
              caption: publication.caption,
            })),
          },
          {
            text: search,
            platform: platform as EditorialPlatform | "all",
            status: status as EditorialAggregateStatus | "all",
          },
        );
      }),
    [
      clientNames,
      format,
      platform,
      posts,
      productionStatus,
      projectNames,
      approvalStatus,
      responsibleId,
      search,
      status,
      teamRows,
    ],
  );
  const selectedPost = detailQuery.data?.posts[0] || null;

  useEffect(() => {
    if (
      !contentId ||
      detailQuery.isLoading ||
      detailQuery.isFetching ||
      detailQuery.isError ||
      selectedPost
    ) {
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete("content");
    setSearchParams(next, { replace: true });
  }, [
    contentId,
    detailQuery.isFetching,
    detailQuery.isError,
    detailQuery.isLoading,
    searchParams,
    selectedPost,
    setSearchParams,
  ]);

  const setParam = (key: string, value: string) => {
    setSearchParams(updateParam(searchParams, key, value), {
      replace: true,
    });
  };

  const handleClientChange = (value: string) => {
    const next = updateParam(searchParams, "client", value);
    next.delete("project");
    setSearchParams(next, { replace: true });
  };

  const navigatePeriod = (action: "previous" | "next" | "today") => {
    if (view === "board") return;
    const nextDate = navigateEditorialDate(dateKey, view, action, new Date());
    if (nextDate) setParam("date", nextDate);
  };

  const openCreate = (seed: EditorialDraftSeed | null = null) => {
    setDraftSeed(seed);
    setEditingPost(null);
    setRevisionSource(null);
    setEditorOpen(true);
  };

  const openEdit = (bundle: EditorialPostBundle) => {
    const next = new URLSearchParams(searchParams);
    next.delete("content");
    setSearchParams(next, { replace: true });
    setDraftSeed(null);
    setRevisionSource(null);
    setEditingPost(bundle);
    setEditorOpen(true);
  };

  const openRevision = (bundle: EditorialPostBundle) => {
    const next = new URLSearchParams(searchParams);
    next.delete("content");
    setSearchParams(next, { replace: true });
    setDraftSeed(null);
    setEditingPost(null);
    setRevisionSource(bundle);
    setEditorOpen(true);
  };

  const openDetailById = (postId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("content", postId);
    setSearchParams(next);
  };

  const openDetail = (bundle: EditorialPostBundle) => {
    openDetailById(bundle.post.id);
  };

  const selectedEditorClientId =
    forcedClientId ||
    (requestedClientId !== "all"
      ? requestedClientId
      : projectId !== "all"
        ? editorialProjectRows.find((project) => project.id === projectId)
            ?.client_id || ""
        : "");
  const selectedEditorProjectId = projectId === "all" ? "" : projectId;

  const openCreateOnDate = (targetDateKey: string) => {
    if (canScheduleEditorial) {
      setScheduleDefaultAt(
        targetDateKey > todayKey ? `${targetDateKey}T09:00` : "",
      );
      setScheduleOpen(true);
      return;
    }
    openCreate({
      clientId: selectedEditorClientId,
      projectId: selectedEditorProjectId,
      scheduledAt: `${targetDateKey}T09:00`,
    });
  };

  const openCreateFromTask = (
    task: EditorialInboxTask,
    targetDateKey?: string,
    targetStage?: EditableEditorialStage,
  ) => {
    const project = projectById.get(task.project_id);
    if (!project) {
      toast.error("O projeto desta tarefa não está disponível.");
      return;
    }
    openCreate({
      clientId: project.client_id,
      projectId: task.project_id,
      taskId: task.id,
      title: task.title,
      context: task.description?.trim() || undefined,
      contentType: contentTypeForDeliveryType(task.delivery_type) || "static",
      responsibleId: task.assigned_to || undefined,
      productionStatus:
        targetStage || editorialStageForTaskStatus(task.status) || "draft",
      scheduledAt: targetDateKey ? `${targetDateKey}T09:00` : undefined,
    });
  };

  const openTaskItem = (
    task: EditorialInboxTask,
    targetDateKey?: string,
    targetStage?: EditableEditorialStage,
  ) => {
    const linkedPostId = linkedPostIdByTaskId[task.id];
    if (linkedPostId) {
      openDetailById(linkedPostId);
      return;
    }
    openCreateFromTask(task, targetDateKey, targetStage);
  };

  const beginEditorialMove = useCallback((key: string) => {
    if (pendingMoveKeysRef.current.has(key)) return false;
    pendingMoveKeysRef.current.add(key);
    editorialRealtimeGateRef.current.pendingCount =
      pendingMoveKeysRef.current.size;
    setPendingMoveKeys(new Set(pendingMoveKeysRef.current));
    return true;
  }, []);

  const finishEditorialMove = useCallback(
    (key: string) => {
      pendingMoveKeysRef.current.delete(key);
      editorialRealtimeGateRef.current.pendingCount =
        pendingMoveKeysRef.current.size;
      setPendingMoveKeys(new Set(pendingMoveKeysRef.current));
      if (pendingMoveKeysRef.current.size > 0) return;

      editorialRealtimeGateRef.current.deferred = false;
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["editorial-calendar"],
        }),
        queryClient.invalidateQueries({ queryKey: ["tasks"] }),
        queryClient.invalidateQueries({
          queryKey: ["editorial-linked-task-ids"],
        }),
      ]);
    },
    [queryClient],
  );

  const moveTaskToStage = useCallback(
    async (task: EditorialInboxTask, targetStage: EditableEditorialStage) => {
      if (!permissions.canEdit) return;
      const targetStatus = kanbanStatusForEditorialStage(targetStage);
      if (!targetStatus) return;
      const previousStatus = canonicalTaskStatus(task.status);
      if (previousStatus === targetStatus) return;
      const moveKey = `task:${task.id}`;
      if (!beginEditorialMove(moveKey)) return;
      queryClient.setQueriesData({ queryKey: ["tasks"] }, (value) =>
        updateCachedTaskStatus(value, task.id, targetStatus),
      );
      try {
        const { data, error } = await supabase
          .from("tasks")
          .update({ status: targetStatus })
          .eq("id", task.id)
          .eq("status", task.status)
          .select("id")
          .maybeSingle();
        if (error) throw error;
        if (!data) {
          throw new Error(
            "A tarefa mudou em outra sessão. Atualize e tente novamente.",
          );
        }
        const { notifyOpsTaskUpdated } = await import("@/lib/opsTaskSync");
        notifyOpsTaskUpdated(task.id);
        toast.success("Tarefa atualizada também no Kanban central.");
        try {
          const {
            data: { user: authUser },
          } = await supabase.auth.getUser();
          if (targetStatus === "review" && task.project_id && authUser) {
            await sendTaskAttachmentsToApproval(
              task.id,
              task.project_id,
              task.title,
              authUser.id,
            );
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ["all-files"] }),
              queryClient.invalidateQueries({ queryKey: ["files"] }),
            ]);
          }
          if (authUser) {
            const { notifyAdmin, notifyUser } =
              await import("@/lib/notifyHelpers");
            if (!profile?.role?.includes("admin")) {
              await notifyAdmin(
                `${profile?.full_name || "Membro"} moveu "${task.title}" pelo calendário editorial`,
                "task",
                "/kanban",
              );
            }
            if (task.assigned_to && task.assigned_to !== authUser.id) {
              await notifyUser(
                task.assigned_to,
                `Tarefa "${task.title}" atualizada pelo calendário editorial`,
                "task",
                "/kanban",
              );
            }
          }
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["milestones"] }),
            queryClient.invalidateQueries({
              queryKey: ["milestones-all"],
            }),
            queryClient.invalidateQueries({ queryKey: ["projects"] }),
          ]);
        } catch (sideEffectError) {
          console.error(
            "Editorial task move side effects failed",
            sideEffectError,
          );
          toast.warning(
            "A tarefa foi movida, mas uma etapa auxiliar precisa ser atualizada.",
          );
        }
      } catch (error: unknown) {
        queryClient.setQueriesData({ queryKey: ["tasks"] }, (value) =>
          updateCachedTaskStatus(value, task.id, previousStatus),
        );
        toast.error(
          error instanceof Error
            ? error.message
            : "Não foi possível mover a tarefa.",
        );
      } finally {
        finishEditorialMove(moveKey);
      }
    },
    [
      beginEditorialMove,
      finishEditorialMove,
      permissions.canEdit,
      profile?.full_name,
      profile?.role,
      queryClient,
    ],
  );

  const movePostToStage = useCallback(
    async (
      bundle: EditorialPostBundle,
      targetStage: EditableEditorialStage,
    ) => {
      if (!permissions.canEdit) return;
      if (bundle.post.production_status === targetStage) return;
      const previousStage = bundle.post.production_status;
      const moveKey = `post:${bundle.post.id}`;
      if (!beginEditorialMove(moveKey)) return;
      queryClient.setQueriesData(
        { queryKey: ["editorial-calendar"] },
        (value) =>
          updateCachedEditorialPostStage(value, bundle.post.id, targetStage),
      );
      try {
        const completeBundle = await loadEditorialPostForMutation(
          bundle.post.id,
          bundle.post.client_id,
        );
        if (!isEditorialPostPlanMutable(completeBundle)) {
          throw new Error(
            "Este conteúdo já está agendado ou finalizado. Abra os detalhes para continuar.",
          );
        }
        if (completeBundle.post.production_status === targetStage) {
          return;
        }
        const payload = buildEditorialPostMutationPayload(completeBundle, {
          mutationId: crypto.randomUUID(),
          productionStatus: targetStage,
        });
        await savePost.mutateAsync({
          payload,
          expectedVersion: completeBundle.post.version,
          deferRefresh: true,
        });
        toast.success("Etapa de produção atualizada.");
      } catch (error: unknown) {
        queryClient.setQueriesData(
          { queryKey: ["editorial-calendar"] },
          (value) =>
            updateCachedEditorialPostStage(
              value,
              bundle.post.id,
              previousStage,
            ),
        );
        toast.error(
          error instanceof Error
            ? error.message
            : "Não foi possível mover o conteúdo.",
        );
      } finally {
        finishEditorialMove(moveKey);
      }
    },
    [
      beginEditorialMove,
      finishEditorialMove,
      permissions.canEdit,
      queryClient,
      savePost,
    ],
  );

  const movePublicationToDate = useCallback(
    async (item: ScheduledEditorialItem, targetDateKey: string) => {
      const visiblePublication = item.publication.publication;
      if (
        !isEditorialPublicationDraggable(
          item.post,
          item.publication,
          permissions,
        )
      ) {
        toast.error(
          "Esta publicação está bloqueada pela etapa ou pela aprovação.",
        );
        return;
      }
      const scheduledAt = moveEditorialInstantToCalendarDate(
        visiblePublication.scheduled_at,
        targetDateKey,
      );
      if (!scheduledAt) {
        toast.error("A data escolhida não existe neste fuso horário.");
        return;
      }
      if (
        visiblePublication.scheduled_at &&
        dateKeyInTimeZone(visiblePublication.scheduled_at) === targetDateKey
      ) {
        return;
      }
      const moveKey = `publication:${visiblePublication.id}`;
      if (!beginEditorialMove(moveKey)) return;
      queryClient.setQueriesData(
        { queryKey: ["editorial-calendar"] },
        (value) =>
          updateCachedEditorialPublicationDate(
            value,
            visiblePublication.id,
            scheduledAt,
          ),
      );
      try {
        let completePost = item.post;
        let publicationBundle = item.publication;
        if (visiblePublication.status === "planned") {
          completePost = await loadEditorialPostForMutation(
            item.post.post.id,
            item.post.post.client_id,
          );
          const completePublication = completePost.publications.find(
            ({ publication }) => publication.id === visiblePublication.id,
          );
          if (!completePublication) {
            throw new Error(
              "A publicação mudou. Atualize o calendário e tente novamente.",
            );
          }
          publicationBundle = completePublication;
        }
        if (
          !isEditorialPublicationDraggable(
            completePost,
            publicationBundle,
            permissions,
          )
        ) {
          throw new Error(
            "Esta publicação está bloqueada pela etapa ou pela aprovação.",
          );
        }

        const publication = publicationBundle.publication;

        if (publication.status === "planned") {
          const payload = buildEditorialPostMutationPayload(completePost, {
            mutationId: crypto.randomUUID(),
            publicationId: publication.id,
            scheduledAt,
            scheduledTimezone: EDITORIAL_DEFAULT_TIME_ZONE,
          });
          await savePost.mutateAsync({
            payload,
            expectedVersion: completePost.post.version,
            deferRefresh: true,
          });
        } else {
          await transitionPublication.mutateAsync({
            publicationId: publication.id,
            action: "schedule",
            expectedVersion: publication.version,
            scheduledAt,
            timezone: EDITORIAL_DEFAULT_TIME_ZONE,
            deferRefresh: true,
          });
        }
        toast.success(`Publicação movida para ${targetDateKey}.`);
      } catch (error: unknown) {
        queryClient.setQueriesData(
          { queryKey: ["editorial-calendar"] },
          (value) =>
            updateCachedEditorialPublicationDate(
              value,
              visiblePublication.id,
              visiblePublication.scheduled_at,
            ),
        );
        toast.error(
          error instanceof Error
            ? error.message
            : "Não foi possível reagendar a publicação.",
        );
      } finally {
        finishEditorialMove(moveKey);
      }
    },
    [
      beginEditorialMove,
      finishEditorialMove,
      permissions,
      queryClient,
      savePost,
      transitionPublication,
    ],
  );

  // Arrastar para "Publicado / concluído" = validação manual da equipe:
  // confirma as publicações agendadas como publicadas pelo fluxo oficial.
  const markPostPublished = useCallback(
    async (bundle: EditorialPostBundle) => {
      if (!permissions.canPublish) {
        toast.error("Somente admin ou manager podem concluir publicações.");
        return;
      }
      const moveKey = `post:${bundle.post.id}`;
      if (!beginEditorialMove(moveKey)) return;
      try {
        const completeBundle = await loadEditorialPostForMutation(
          bundle.post.id,
          bundle.post.client_id,
        );
        // Concluir vale para o que está planejado, agendado ou em falha: o
        // admin marca como publicado e o painel soma. O link padrão existe
        // porque a baixa oficial exige um link válido; quando a equipe tiver o
        // link real do post, é só editar no detalhe.
        const concludable = completeBundle.publications.filter(
          ({ publication }) => ["planned", "scheduled", "failed"].includes(publication.status),
        );
        if (concludable.length === 0) {
          throw new Error(
            "Nada para concluir aqui: as publicações deste conteúdo já estão publicadas ou canceladas.",
          );
        }
        for (const { publication } of concludable) {
          await transitionPublication.mutateAsync({
            publicationId: publication.id,
            action: "publish",
            expectedVersion: publication.version,
            permalink: publication.permalink || "https://www.instagram.com/",
            publishedAt: new Date().toISOString(),
            deferRefresh: true,
          });
        }
        await queryClient.invalidateQueries({ queryKey: ["editorial-calendar"] });
        toast.success("Concluído! Publicação confirmada pela equipe (validação manual).");
      } catch (error: unknown) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Não foi possível concluir a publicação.",
        );
      } finally {
        finishEditorialMove(moveKey);
      }
    },
    [
      permissions.canPublish,
      beginEditorialMove,
      finishEditorialMove,
      transitionPublication,
      queryClient,
    ],
  );

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current;
    if (!data) return;
    setDragSummary({
      kind: data.kind as DragSummary["kind"],
      label: String(data.label || "Item editorial"),
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDragSummary(null);
    const activeData = event.active.data.current;
    const overData = event.over?.data.current;
    if (!activeData || !overData) return;

    if (activeData.kind === "task") {
      const task = activeData.task as EditorialInboxTask;
      if (overData.kind === "date") {
        openCreateFromTask(task, String(overData.dateKey));
      } else if (overData.kind === "stage" && overData.productionStatus) {
        void moveTaskToStage(
          task,
          overData.productionStatus as EditableEditorialStage,
        );
      }
      return;
    }

    if (activeData.kind === "post" && overData.kind === "stage") {
      if (overData.stage === "delivery") {
        void markPostPublished(activeData.post as EditorialPostBundle);
        return;
      }
      if (overData.productionStatus) {
        void movePostToStage(
          activeData.post as EditorialPostBundle,
          overData.productionStatus as EditableEditorialStage,
        );
      }
      return;
    }

    if (activeData.kind === "publication" && overData.kind === "date") {
      void movePublicationToDate(
        activeData.item as ScheduledEditorialItem,
        String(overData.dateKey),
      );
    }
  };

  const clearFilters = () => {
    const next = new URLSearchParams(searchParams);
    [
      "q",
      "client",
      "project",
      "format",
      "platform",
      "status",
      "production",
      "approval",
      "responsible",
    ].forEach((key) => next.delete(key));
    setSearchParams(next, { replace: true });
  };

  const defaultScheduledAt = draftSeed?.scheduledAt || "";
  const editorClientId = draftSeed?.clientId || selectedEditorClientId;
  const editorProjectId = draftSeed?.projectId || selectedEditorProjectId;
  const pageTitle = periodTitle(dateKey, view);
  const kanbanHref = useMemo(() => {
    const params = new URLSearchParams({ area: "editorial" });
    const selectedClientId =
      requestedClientId === "all" ? "" : requestedClientId;
    if (selectedClientId) params.set("client", selectedClientId);
    if (projectId !== "all") params.set("project", projectId);
    return `/kanban?${params.toString()}`;
  }, [projectId, requestedClientId]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDragSummary(null)}
    >
      <div className="space-y-6">
        <header className="relative overflow-hidden rounded-2xl border border-border bg-card/75 px-4 py-4 sm:px-5">
          <div className="absolute inset-y-0 left-0 w-1 bg-primary" />
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <LayoutTemplate className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-primary">
                  {effectiveRole === "client"
                    ? "Calendário de Conteúdo"
                    : view === "board"
                      ? "Conteúdos em produção"
                      : "Agenda editorial"}
                </p>
                <h1 className="mt-0.5 text-xl font-semibold text-foreground">
                  {effectiveRole === "client"
                    ? "Seu conteúdo planejado, aprovado e publicado"
                    : view === "board"
                      ? "Criação e revisão em um fluxo organizado"
                      : "Conteúdo no dia certo, na conta certa"}
                </h1>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {effectiveRole === "client"
                    ? "Acompanhe o que está aprovado, programado e no ar. Aprovações acontecem na área de Aprovações."
                    : view === "board"
                      ? "Prepare o conteúdo e leve até a aprovação"
                      : "Veja prazos de produção e publicações agendadas sem misturar outras tarefas"}
                </p>
              </div>
            </div>
            <div className="flex max-w-xl items-start gap-2 rounded-xl border border-primary/15 bg-primary/[0.05] px-3.5 py-2.5 text-xs leading-5 text-muted-foreground">
              <Send className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <p>
                {view === "board"
                  ? "Aqui ficam rascunho, produção e aprovação. O agendamento acontece na Agenda. Nenhuma rede social é acionada automaticamente."
                  : "Prazos do Kanban aparecem em roxo. Publicações mostram plataforma e horário. Nenhuma rede social é acionada automaticamente."}
              </p>
            </div>
          </div>
        </header>

        {approvedReadyToSchedule.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-success/30 bg-success/5 px-4 py-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-success/15 text-success">
              <Send className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                {approvedReadyToSchedule.length === 1
                  ? "1 conteúdo aprovado pelo cliente pronto para agendar"
                  : `${approvedReadyToSchedule.length} conteúdos aprovados pelo cliente prontos para agendar`}
              </p>
              <p className="text-xs text-muted-foreground">
                Mantém a data e o horário planejados; se o horário já passou, agenda para 1 hora a partir de agora.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void scheduleApprovedNow()}
              disabled={batchScheduling}
              className="inline-flex items-center gap-1.5 rounded-lg border-none bg-success px-4 py-2 text-[12px] font-medium text-success-foreground transition-opacity hover:opacity-90 disabled:opacity-50 cursor-pointer"
            >
              {batchScheduling ? "Agendando…" : "Agendar aprovados"}
            </button>
          </div>
        )}

        {editorialOptionsError && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/25 bg-destructive/5 p-4">
            <div className="flex min-w-0 items-center gap-3">
              <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
              <p className="text-xs text-muted-foreground">
                Não foi possível carregar todas as opções editoriais. A criação
                fica bloqueada até recarregar.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void Promise.all([
                  clientsQuery.refetch(),
                  projectsQuery.refetch(),
                  teamMembersQuery.refetch(),
                  editorialScopeQuery.refetch(),
                  tasksQuery.refetch(),
                  linkedTaskIdsQuery.refetch(),
                ]);
              }}
            >
              <RefreshCw className="mr-1.5 h-4 w-4" />
              Recarregar acesso
            </Button>
          </div>
        )}

        <CalendarMetrics
          posts={filteredPosts}
          taskCount={
            canUseTeamData && view === "board"
              ? tasksForCurrentView.length
              : undefined
          }
        />

        <EditorialToolbar
          title={pageTitle}
          view={view}
          search={search}
          clientId={requestedClientId}
          projectId={projectId}
          format={format}
          platform={platform}
          status={status}
          productionStatus={productionStatus}
          approvalStatus={approvalStatus}
          responsibleId={responsibleId}
          clients={
            effectiveRole === "client"
              ? []
              : editorialClientRows.map((client) => ({
                  value: client.id,
                  label: client.company_name || client.full_name || "Cliente",
                }))
          }
          projects={filteredProjects.map((project) => ({
            value: project.id,
            label: project.name,
          }))}
          formats={editorialFormats}
          platforms={EDITORIAL_PLATFORMS.map((item) => ({
            value: item,
            label: PLATFORM_LABELS[item],
          }))}
          statuses={aggregateStatuses.map((item) => ({
            value: item,
            label: EDITORIAL_STATUS_CONFIG[item].label,
          }))}
          productionStatuses={productionStatuses}
          approvalStatuses={approvalStatuses}
          responsibles={teamRows.map((member) => ({
            value: member.id,
            label: member.full_name || "Membro da equipe",
          }))}
          canCreate={canCreateEditorial}
          canSchedule={canScheduleEditorial}
          onViewChange={(nextView) => setParam("view", nextView)}
          onSearchChange={(value) => setParam("q", value)}
          onClientChange={handleClientChange}
          onProjectChange={(value) => setParam("project", value)}
          onFormatChange={(value) => setParam("format", value)}
          onPlatformChange={(value) => setParam("platform", value)}
          onStatusChange={(value) => setParam("status", value)}
          onProductionStatusChange={(value) => setParam("production", value)}
          onApprovalStatusChange={(value) => setParam("approval", value)}
          onResponsibleChange={(value) => setParam("responsible", value)}
          onClearFilters={clearFilters}
          onPrevious={() => navigatePeriod("previous")}
          onToday={() => navigatePeriod("today")}
          onNext={() => navigatePeriod("next")}
          onCreate={() => openCreate()}
          onSchedule={() => {
            setScheduleDefaultAt("");
            setScheduleOpen(true);
          }}
        />

        {canUseTeamData && view === "board" && (
          <section className="flex flex-col gap-3 rounded-xl border border-border bg-card/60 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-500">
                <LayoutTemplate className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground">
                  Entregas editoriais do Kanban
                </p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {productionTasks.length} visíveis com os filtros atuais
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-8 items-center rounded-lg border border-violet-500/20 bg-violet-500/10 px-2.5 text-[10px] font-medium text-violet-500">
                Fluxo editorial completo
              </span>
              <Button
                asChild
                type="button"
                size="sm"
                variant="outline"
                className="h-9 text-[11px]"
              >
                <Link to={kanbanHref}>Abrir Kanban central</Link>
              </Button>
            </div>
          </section>
        )}

        {canUseTeamData && (taskDataLoading || taskDataError) && (
          <section
            aria-live="polite"
            className={cn(
              "flex min-h-11 flex-wrap items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5",
              taskDataError
                ? "border-destructive/25 bg-destructive/5"
                : "border-border bg-card/55",
            )}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              {taskDataError ? (
                <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
              ) : (
                <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-primary motion-reduce:animate-none" />
              )}
              <p className="text-xs text-muted-foreground">
                {taskDataError
                  ? "As publicações continuam visíveis, mas as tarefas do Kanban não puderam ser atualizadas."
                  : "Carregando as tarefas do Kanban sem interromper o calendário…"}
              </p>
            </div>
            {taskDataError && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-[11px]"
                onClick={() => {
                  void Promise.all([
                    tasksQuery.refetch(),
                    linkedTaskIdsQuery.refetch(),
                  ]);
                }}
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Tentar novamente
              </Button>
            )}
          </section>
        )}

        <main className="min-w-0">
          {calendarQuery.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full rounded-xl" />
              <Skeleton className="h-[480px] w-full rounded-2xl" />
            </div>
          ) : calendarQuery.isError ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-destructive/25 bg-destructive/5 p-6 text-center">
              <AlertCircle className="mb-3 h-8 w-8 text-destructive" />
              <p className="text-sm font-medium text-foreground">
                Não foi possível carregar o calendário
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Tente novamente. Se o problema continuar, avise a equipe
                responsável pelo painel.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => calendarQuery.refetch()}
              >
                <RefreshCw className="mr-1.5 h-4 w-4" />
                Recarregar
              </Button>
            </div>
          ) : (
            <EditorialCalendarViews
              view={view}
              anchorDate={new Date(`${dateKey}T12:00:00`)}
              posts={filteredPosts}
              tasks={tasksForCurrentView}
              clientNames={clientNames}
              projectNames={projectNames}
              projectScopeNames={projectScopeNames}
              responsibleNames={responsibleNames}
              canCreate={
                view === "board" ? canCreateEditorial : canScheduleEditorial
              }
              canEdit={permissions.canEdit}
              canPublish={permissions.canPublish}
              moving={false}
              onSelectPost={openDetail}
              onCreateFromTask={openTaskItem}
              onCreateOnDate={openCreateOnDate}
              onShowBacklog={() => setParam("view", "list")}
            />
          )}
        </main>

        <p className="sr-only" aria-live="polite">
          {pendingMoveKeys.size > 0
            ? `Salvando ${pendingMoveKeys.size} movimentação editorial`
            : "Movimentação editorial concluída"}
        </p>

        {contentId && detailQuery.isError && !selectedPost && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/25 bg-destructive/5 p-4">
            <div className="flex min-w-0 items-center gap-3">
              <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
              <p className="text-xs text-muted-foreground">
                Não foi possível abrir os detalhes deste conteúdo.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => detailQuery.refetch()}
              >
                Tentar novamente
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setParam("content", "")}
              >
                Fechar
              </Button>
            </div>
          </div>
        )}

        <EditorialEditor
          open={editorOpen}
          post={editingPost}
          revisionOf={revisionSource}
          clients={editorialClientRows.map((client) => ({
            id: client.id,
            name: client.company_name || client.full_name || "Cliente",
          }))}
          projects={editorialProjectRows.map((project) => ({
            id: project.id,
            name: project.name,
            client_id: project.client_id,
          }))}
          teamMembers={teamRows.map((member) => ({
            id: member.id,
            name: member.full_name || "Membro da equipe",
            role: member.role,
          }))}
          defaultClientId={editorClientId}
          defaultProjectId={editorProjectId}
          defaultScheduledAt={defaultScheduledAt}
          defaultTaskId={draftSeed?.taskId}
          defaultTitle={draftSeed?.title}
          defaultContext={draftSeed?.context}
          defaultContentType={draftSeed?.contentType}
          defaultResponsibleId={draftSeed?.responsibleId}
          defaultProductionStatus={draftSeed?.productionStatus}
          lockTaskId={Boolean(draftSeed?.taskId)}
          linkedTaskIds={linkedTaskIdsQuery.data?.taskIds || []}
          onOpenChange={(nextOpen) => {
            setEditorOpen(nextOpen);
            if (!nextOpen) {
              setEditingPost(null);
              setRevisionSource(null);
              setDraftSeed(null);
            }
          }}
          onSaved={(postId) => {
            setEditingPost(null);
            setRevisionSource(null);
            setDraftSeed(null);
            const next = new URLSearchParams(searchParams);
            next.set("content", postId);
            setSearchParams(next);
          }}
        />

        <EditorialScheduleDialog
          open={scheduleOpen}
          clients={editorialClientRows.map((client) => ({
            id: client.id,
            name: client.company_name || client.full_name || "Cliente",
          }))}
          projects={editorialProjectRows.map((project) => ({
            id: project.id,
            name: project.name,
            client_id: project.client_id,
          }))}
          defaultClientId={selectedEditorClientId}
          defaultProjectId={selectedEditorProjectId}
          defaultScheduledAt={scheduleDefaultAt}
          onOpenChange={setScheduleOpen}
          onScheduled={({ postId, scheduledAt, clientId, projectId }) => {
            const next = new URLSearchParams(searchParams);
            next.set("view", view === "board" ? "month" : view);
            const scheduledDateKey = dateKeyInTimeZone(scheduledAt);
            if (scheduledDateKey) next.set("date", scheduledDateKey);
            next.set("client", clientId);
            next.set("project", projectId);
            next.set("content", postId);
            [
              "q",
              "format",
              "platform",
              "status",
              "production",
              "approval",
              "responsible",
            ].forEach((key) => next.delete(key));
            setSearchParams(next);
          }}
        />

        <EditorialDetailSheet
          open={!!selectedPost}
          post={selectedPost}
          clientName={
            selectedPost
              ? clientNames.get(selectedPost.post.client_id) || "Cliente"
              : ""
          }
          projectName={
            selectedPost
              ? projectNames.get(selectedPost.post.project_id) || "Projeto"
              : ""
          }
          responsibleName={
            selectedPost?.internal?.responsible_id
              ? teamRows.find(
                  (member) =>
                    member.id === selectedPost.internal?.responsible_id,
                )?.full_name
              : null
          }
          canEdit={permissions.canEdit}
          canPublish={permissions.canPublish}
          isImpersonating={isImpersonating}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setParam("content", "");
          }}
          onEdit={openEdit}
          onCreateRevision={openRevision}
          onArchived={() => setParam("content", "")}
        />
      </div>

      <DragOverlay dropAnimation={null}>
        {dragSummary ? (
          <div className="flex max-w-[280px] items-center gap-2 rounded-xl border border-primary/35 bg-popover px-3 py-2.5 text-xs font-medium text-popover-foreground shadow-xl">
            <GripVertical className="h-4 w-4 shrink-0 text-primary" />
            <span className="truncate">{dragSummary.label}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
