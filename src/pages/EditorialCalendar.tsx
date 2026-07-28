import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  RefreshCw,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import EditorialToolbar, {
  type EditorialView,
} from "@/components/editorial/EditorialToolbar";
import EditorialCalendarViews from "@/components/editorial/EditorialCalendarViews";
import EditorialEditor from "@/components/editorial/EditorialEditor";
import EditorialDetailSheet from "@/components/editorial/EditorialDetailSheet";
import {
  useEditorialClientScope,
  useEditorialCalendar,
  useEditorialPostDetail,
  type EditorialPostBundle,
} from "@/hooks/useEditorialCalendar";
import {
  useClients,
  useProjects,
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
  dateKeyInTimeZone,
  getEditorialQueryRange,
  getEditorialWeekDays,
  navigateEditorialDate,
  normalizeEditorialDateParam,
} from "@/lib/editorialDate";

const validViews: EditorialView[] = ["month", "week", "list"];
const aggregateStatuses = Object.keys(
  EDITORIAL_STATUS_CONFIG,
) as EditorialAggregateStatus[];
const productionStatuses = Object.entries(
  EDITORIAL_PRODUCTION_STATUS_CONFIG,
)
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

function updateParam(
  current: URLSearchParams,
  key: string,
  value: string,
) {
  const next = new URLSearchParams(current);
  if (!value || value === "all") next.delete(key);
  else next.set(key, value);
  return next;
}

function periodTitle(dateKey: string, view: EditorialView) {
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

function CalendarMetrics({ posts }: { posts: EditorialPostBundle[] }) {
  const publications = posts.flatMap((post) =>
    post.publications.map(({ publication }) => publication),
  );
  const metrics = [
    {
      label: "Conteúdos",
      value: posts.length,
      icon: CalendarDays,
      className: "text-violet-500 bg-violet-500/10",
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
    {
      label: "Falhas",
      value: publications.filter(
        (publication) => publication.status === "failed",
      ).length,
      icon: AlertCircle,
      className: "text-destructive bg-destructive/10",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
        >
          <span
            className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${metric.className}`}
          >
            <metric.icon className="h-4 w-4" />
          </span>
          <div>
            <p className="text-lg font-semibold leading-none text-foreground">
              {metric.value}
            </p>
            <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
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
  const todayKey = dateKeyInTimeZone(new Date()) || "2026-01-01";
  const requestedView = searchParams.get("view") as EditorialView | null;
  const view = validViews.includes(requestedView || ("" as EditorialView))
    ? (requestedView as EditorialView)
    : "month";
  const dateKey = normalizeEditorialDateParam(
    searchParams.get("date"),
    todayKey,
  );
  const search = searchParams.get("q") || "";
  const requestedClientId = searchParams.get("client") || "all";
  const projectId = searchParams.get("project") || "all";
  const platform = searchParams.get("platform") || "all";
  const status = searchParams.get("status") || "all";
  const productionStatus =
    searchParams.get("production") || "all";
  const approvalStatus = searchParams.get("approval") || "all";
  const requestedResponsibleId =
    searchParams.get("responsible") || "all";
  const contentId = searchParams.get("content");
  const effectiveRole = isImpersonating ? "client" : profile?.role;
  const permissions = editorialPermissions(effectiveRole);
  const responsibleId =
    permissions.canEdit && !isImpersonating
      ? requestedResponsibleId
      : "all";
  const forcedClientId =
    effectiveRole === "client"
      ? impersonatedId || profile?.id || ""
      : requestedClientId === "all"
        ? ""
        : requestedClientId;

  const clientsQuery = useClients();
  const projectsQuery = useProjects();
  const clients = useMemo(
    () => clientsQuery.data || [],
    [clientsQuery.data],
  );
  const projects = useMemo(
    () => projectsQuery.data || [],
    [projectsQuery.data],
  );
  const canUseTeamData = permissions.canEdit && !isImpersonating;
  const editorialScopeQuery = useEditorialClientScope(canUseTeamData);
  const teamMembersQuery = useTeamMembers(canUseTeamData);
  const teamMembers = useMemo(
    () => teamMembersQuery.data || [],
    [teamMembersQuery.data],
  );
  const range = getEditorialQueryRange(dateKey, view);
  const calendarQuery = useEditorialCalendar(
    {
      clientId: forcedClientId || undefined,
      projectId: projectId === "all" ? undefined : projectId,
      platform: platform === "all" ? undefined : platform,
      rangeStart: range?.startIso,
      rangeEnd: range?.endExclusiveIso,
    },
    { forceClientView: isImpersonating },
  );
  const clientRows = clients as unknown as CalendarClientRow[];
  const projectRows = projects as unknown as CalendarProjectRow[];
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
  const scopedClientIds = useMemo(() => {
    if (!restrictStaffScope) return null;
    return new Set(editorialScopeQuery.data || []);
  }, [editorialScopeQuery.data, restrictStaffScope]);
  const editorialClientRows = useMemo(
    () =>
      scopedClientIds === null
        ? clientRows
        : clientRows.filter((client) => scopedClientIds.has(client.id)),
    [clientRows, scopedClientIds],
  );
  const editorialProjectRows = useMemo(
    () =>
      scopedClientIds === null
        ? projectRows
        : projectRows.filter((project) =>
            scopedClientIds.has(project.client_id),
          ),
    [projectRows, scopedClientIds],
  );
  const teamRows = useMemo(
    () =>
      canUseTeamData
        ? (teamMembers as unknown as CalendarTeamMemberRow[])
        : [],
    [canUseTeamData, teamMembers],
  );
  const posts = useMemo(
    () => calendarQuery.data?.posts || [],
    [calendarQuery.data?.posts],
  );
  const detailQuery = useEditorialPostDetail(
    contentId,
    forcedClientId || null,
    { forceClientView: isImpersonating },
  );
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPost, setEditingPost] =
    useState<EditorialPostBundle | null>(null);
  const [revisionSource, setRevisionSource] =
    useState<EditorialPostBundle | null>(null);

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
        projectRows.map((project) => [
          project.id,
          project.name || "Projeto",
        ]),
      ),
    [projectRows],
  );
  const filteredProjects = useMemo(
    () =>
      editorialProjectRows.filter(
        (project) =>
          !forcedClientId || project.client_id === forcedClientId,
      ),
    [editorialProjectRows, forcedClientId],
  );
  const filteredPosts = useMemo(
    () =>
      posts.filter((bundle) => {
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

  const navigatePeriod = (
    action: "previous" | "next" | "today",
  ) => {
    const nextDate = navigateEditorialDate(
      dateKey,
      view,
      action,
      new Date(),
    );
    if (nextDate) setParam("date", nextDate);
  };

  const openCreate = () => {
    setEditingPost(null);
    setRevisionSource(null);
    setEditorOpen(true);
  };

  const openEdit = (bundle: EditorialPostBundle) => {
    const next = new URLSearchParams(searchParams);
    next.delete("content");
    setSearchParams(next, { replace: true });
    setRevisionSource(null);
    setEditingPost(bundle);
    setEditorOpen(true);
  };

  const openRevision = (bundle: EditorialPostBundle) => {
    const next = new URLSearchParams(searchParams);
    next.delete("content");
    setSearchParams(next, { replace: true });
    setEditingPost(null);
    setRevisionSource(bundle);
    setEditorOpen(true);
  };

  const openDetail = (bundle: EditorialPostBundle) => {
    const next = new URLSearchParams(searchParams);
    next.set("content", bundle.post.id);
    setSearchParams(next);
  };

  const defaultScheduledAt = `${dateKey}T09:00`;
  const editorClientId =
    forcedClientId ||
    (requestedClientId !== "all"
      ? requestedClientId
      : projectId !== "all"
        ? editorialProjectRows.find((project) => project.id === projectId)
            ?.client_id || ""
        : "");
  const editorProjectId = projectId === "all" ? "" : projectId;
  const pageTitle = periodTitle(dateKey, view);

  return (
    <div className="space-y-5 pb-8">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <CalendarDays className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-xl font-semibold text-foreground">
                Calendário editorial
              </h1>
              <p className="text-xs text-muted-foreground">
                Conteúdos, aprovações e publicações por plataforma ·
                calendário em horário de Brasília
              </p>
            </div>
          </div>
        </div>
        <div className="flex max-w-xl items-start gap-2 rounded-lg border border-primary/15 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
          <Send className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <p>
            Esta etapa organiza a fila e registra a publicação manual. Nenhuma
            rede social é acionada automaticamente.
          </p>
        </div>
      </header>

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
              ]);
            }}
          >
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Recarregar acesso
          </Button>
        </div>
      )}

      <CalendarMetrics posts={filteredPosts} />

      <EditorialToolbar
        title={pageTitle}
        view={view}
        search={search}
        clientId={requestedClientId}
        projectId={projectId}
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
                label:
                  client.company_name || client.full_name || "Cliente",
              }))
        }
        projects={filteredProjects.map((project) => ({
          value: project.id,
          label: project.name,
        }))}
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
        onViewChange={(nextView) => setParam("view", nextView)}
        onSearchChange={(value) => setParam("q", value)}
        onClientChange={handleClientChange}
        onProjectChange={(value) => setParam("project", value)}
        onPlatformChange={(value) => setParam("platform", value)}
        onStatusChange={(value) => setParam("status", value)}
        onProductionStatusChange={(value) =>
          setParam("production", value)
        }
        onApprovalStatusChange={(value) =>
          setParam("approval", value)
        }
        onResponsibleChange={(value) =>
          setParam("responsible", value)
        }
        onPrevious={() => navigatePeriod("previous")}
        onToday={() => navigatePeriod("today")}
        onNext={() => navigatePeriod("next")}
        onCreate={openCreate}
      />

      {calendarQuery.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-[420px] w-full rounded-xl" />
        </div>
      ) : calendarQuery.isError ? (
        <div className="flex min-h-[280px] flex-col items-center justify-center rounded-xl border border-destructive/25 bg-destructive/5 p-6 text-center">
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
          clientNames={clientNames}
          projectNames={projectNames}
          canCreate={canCreateEditorial}
          onSelectPost={openDetail}
          onShowBacklog={() => setParam("view", "list")}
        />
      )}

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
        onOpenChange={(nextOpen) => {
          setEditorOpen(nextOpen);
          if (!nextOpen) {
            setEditingPost(null);
            setRevisionSource(null);
          }
        }}
        onSaved={(postId) => {
          setEditingPost(null);
          const next = new URLSearchParams(searchParams);
          next.set("content", postId);
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
                  member.id ===
                  selectedPost.internal?.responsible_id,
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
  );
}
