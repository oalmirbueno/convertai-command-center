import { useMemo } from "react";
import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  FileImage,
  FileText,
  GripVertical,
  Images,
  Link2,
  Palette,
  Plus,
  Send,
  UserRound,
  Video,
} from "lucide-react";
import {
  useDndContext,
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type {
  EditorialPostBundle,
  EditorialPublicationBundle,
} from "@/hooks/useEditorialCalendar";
import type { EditorialView } from "@/components/editorial/EditorialToolbar";
import type { EditorialInboxTask } from "@/components/editorial/EditorialTaskInbox";
import { dateKeyInTimeZone } from "@/lib/editorialDate";
import {
  aggregateEditorialStatus,
  getEditorialApprovalStage,
} from "@/lib/editorial";
import {
  TASK_DELIVERY_TYPE_LABELS,
  type TaskDeliveryType,
} from "@/lib/taskDeliveryTypes";
import {
  isEditorialPostPlanMutable,
  isEditorialPublicationDraggable,
} from "@/lib/editorialDrag";
import { editorialStageForTaskStatus } from "@/lib/taskWorkstreams";
import { mediaKindFromFile, useResolvedFileUrl } from "@/lib/fileUrls";

interface EditorialCalendarViewsProps {
  view: EditorialView;
  anchorDate: Date;
  posts: EditorialPostBundle[];
  tasks?: EditorialInboxTask[];
  clientNames: Map<string, string>;
  projectNames: Map<string, string>;
  projectScopeNames?: Map<string, string>;
  responsibleNames?: Map<string, string>;
  canCreate: boolean;
  canEdit: boolean;
  canPublish: boolean;
  moving?: boolean;
  onSelectPost: (post: EditorialPostBundle) => void;
  onCreateFromTask?: (
    task: EditorialInboxTask,
    targetDateKey?: string,
  ) => void;
  onCreateOnDate: (dateKey: string) => void;
  onShowBacklog: () => void;
}

export interface ScheduledEditorialItem {
  post: EditorialPostBundle;
  publication: EditorialPublicationBundle;
}

interface BacklogItem {
  post: EditorialPostBundle;
  publication: EditorialPublicationBundle | null;
}

type BoardStage = "draft" | "production" | "ready" | "delivery";

const platformLabels: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  google_business: "Google Business",
};

const platformDots: Record<string, string> = {
  instagram: "bg-fuchsia-500",
  facebook: "bg-blue-600",
  tiktok: "bg-zinc-100",
  linkedin: "bg-sky-600",
  youtube: "bg-red-600",
  google_business: "bg-emerald-500",
};

const statusLabels: Record<string, string> = {
  planned: "Planejado",
  scheduled: "Agendado",
  published: "Publicado",
  failed: "Falhou",
  cancelled: "Cancelado",
};

const statusClasses: Record<string, string> = {
  planned: "border-border bg-secondary/60 text-foreground",
  scheduled: "border-blue-500/25 bg-blue-500/10 text-blue-500",
  published:
    "border-emerald-500/25 bg-emerald-500/10 text-emerald-500",
  failed: "border-destructive/25 bg-destructive/10 text-destructive",
  cancelled: "border-border bg-muted text-muted-foreground",
};

const approvalLabels: Record<string, string> = {
  not_requested: "Rascunho",
  agency_review: "Revisão interna",
  agency_approved: "Interno aprovado",
  client_review: "Com o cliente",
  approved: "Aprovado",
  changes: "Ajustes",
};

const boardColumns: Array<{
  id: BoardStage;
  label: string;
  description: string;
  dot: string;
}> = [
  {
    id: "draft",
    label: "Rascunhos",
    description: "Ideias e conteúdos a preparar",
    dot: "bg-slate-400",
  },
  {
    id: "production",
    label: "Em produção",
    description: "Copy, arte e edição em andamento",
    dot: "bg-violet-500",
  },
  {
    id: "ready",
    label: "Pronto para revisão",
    description: "Conteúdo preparado para os gates",
    dot: "bg-amber-500",
  },
  {
    id: "delivery",
    label: "Produção concluída",
    description: "Conteúdos prontos, agendados ou já entregues",
    dot: "bg-emerald-500",
  },
];

const timeFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function scheduledDateKey(iso: string | null) {
  if (!iso) return null;
  return dateKeyInTimeZone(iso);
}

function localDateKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function taskDateKey(task: EditorialInboxTask) {
  const value = task.due_date?.slice(0, 10) || "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function flattenScheduled(posts: EditorialPostBundle[]) {
  return posts
    .flatMap((post) =>
      post.publications
        .filter((publication) => publication.publication.scheduled_at)
        .map((publication) => ({ post, publication })),
    )
    .sort((left, right) =>
      (
        left.publication.publication.scheduled_at || ""
      ).localeCompare(
        right.publication.publication.scheduled_at || "",
      ),
    );
}

function groupScheduledByDate(items: ScheduledEditorialItem[]) {
  const grouped = new Map<string, ScheduledEditorialItem[]>();
  for (const item of items) {
    const key = scheduledDateKey(
      item.publication.publication.scheduled_at,
    );
    if (!key) continue;
    const current = grouped.get(key) || [];
    current.push(item);
    grouped.set(key, current);
  }
  return grouped;
}

function groupTasksByDate(tasks: EditorialInboxTask[]) {
  const grouped = new Map<string, EditorialInboxTask[]>();
  for (const task of tasks) {
    const key = taskDateKey(task);
    if (!key) continue;
    const current = grouped.get(key) || [];
    current.push(task);
    grouped.set(key, current);
  }
  return grouped;
}

function flattenBacklog(posts: EditorialPostBundle[]) {
  return posts.flatMap<BacklogItem>((post) => {
    const unscheduled = post.publications.filter(
      ({ publication }) => !publication.scheduled_at,
    );

    if (unscheduled.length > 0) {
      return unscheduled.map((publication) => ({ post, publication }));
    }
    if (post.publications.length === 0) {
      return [{ post, publication: null }];
    }
    return [];
  });
}

function contentTypeIcon(contentType: string) {
  if (contentType === "carousel") return Images;
  if (
    ["reel", "video", "short", "story"].includes(contentType)
  ) {
    return Video;
  }
  return FileText;
}

function contentTypeLabel(contentType: string) {
  const labels: Record<string, string> = {
    static: "Estático",
    carousel: "Carrossel",
    reel: "Reel",
    story: "Story",
    video: "Vídeo",
    short: "Short",
    article: "Artigo",
    google_post: "Google",
    other: "Outro",
  };
  return labels[contentType] || contentType;
}

function boardStage(post: EditorialPostBundle): BoardStage {
  const aggregate = aggregateEditorialStatus(
    post.publications.map(({ publication }) => publication),
  );
  if (
    ["scheduled", "published", "partially_published", "failed"].includes(
      aggregate,
    ) ||
    post.post.production_status === "cancelled"
  ) {
    return "delivery";
  }
  if (post.post.production_status === "production") return "production";
  if (post.post.production_status === "ready") return "ready";
  return "draft";
}

function normalizeDirectionText(value?: string | null) {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized || null;
}

function taskContentContext(task: EditorialInboxTask) {
  return normalizeDirectionText(task.description);
}

function postContentContext(
  post: EditorialPostBundle,
  publication?: EditorialPublicationBundle | null,
) {
  return (
    normalizeDirectionText(post.post.objective) ||
    normalizeDirectionText(post.post.default_caption) ||
    normalizeDirectionText(publication?.publication.caption)
  );
}

function ContentDirection({
  theme,
  context,
  compact = false,
  className,
}: {
  theme: string;
  context?: string | null;
  compact?: boolean;
  className?: string;
}) {
  const normalizedTheme =
    normalizeDirectionText(theme) || "Tema não informado";
  const normalizedContext =
    normalizeDirectionText(context) || "Não informado";

  return (
    <div
      className={cn(
        "min-w-0 text-current",
        compact ? "space-y-0.5 text-[10px]" : "space-y-1 text-xs",
        className,
      )}
    >
      <p
        className={cn(
          "font-medium",
          compact ? "truncate" : "line-clamp-2 leading-4",
        )}
        title={`Tema: ${normalizedTheme}`}
      >
        <span className="font-semibold opacity-60">Tema:</span>{" "}
        {normalizedTheme}
      </p>
      <p
        className={cn(
          "opacity-75",
          compact ? "truncate" : "line-clamp-2 leading-4",
        )}
        title={`Contexto: ${normalizedContext}`}
      >
        <span className="font-semibold">Contexto:</span>{" "}
        {normalizedContext}
      </p>
    </div>
  );
}

function EditorialFileThumbnail({
  post,
  publication,
  className,
}: {
  post: EditorialPostBundle;
  publication?: EditorialPublicationBundle | null;
  className?: string;
}) {
  const hasPublicationOverride = Boolean(publication?.publication.file_id);
  const file = hasPublicationOverride ? publication?.file : post.primaryFile;
  const fileChildren = hasPublicationOverride
    ? publication?.fileChildren
    : post.primaryFileChildren;
  const kind = mediaKindFromFile(
    file?.file_name,
    file?.file_url,
    file?.mime_type || file?.file_type,
    file?.extension,
  );
  const { url } = useResolvedFileUrl({
    fileUrl: file?.file_url,
    storageBucket: file?.storage_bucket,
    storagePath: file?.storage_path,
    transform:
      kind === "image" ? { width: 640, quality: 74, resize: "cover" } : null,
    expiresIn: 3600,
  });
  const fileCount = file ? 1 + (fileChildren?.length || 0) : 0;

  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-secondary",
        className,
      )}
      aria-hidden="true"
    >
      {url && kind === "image" ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : url && kind === "video" ? (
        <>
          <video
            src={`${url}#t=0.1`}
            muted
            playsInline
            preload="metadata"
            className="h-full w-full object-cover"
          />
          <span className="absolute inset-0 flex items-center justify-center bg-black/20">
            <Video className="h-5 w-5 text-white" />
          </span>
        </>
      ) : (
        <FileImage className="h-5 w-5 text-muted-foreground" />
      )}
      {fileCount > 1 && (
        <span className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[9px] font-medium text-white backdrop-blur-sm">
          <Images className="h-2.5 w-2.5" />
          {fileCount}
        </span>
      )}
    </span>
  );
}

function PublicationPill({
  item,
  compact = false,
  canEdit,
  canPublish,
  moving,
  onClick,
}: {
  item: ScheduledEditorialItem;
  compact?: boolean;
  canEdit: boolean;
  canPublish: boolean;
  moving: boolean;
  onClick: () => void;
}) {
  const publication = item.publication.publication;
  const account = item.publication.account;
  const time = publication.scheduled_at
    ? timeFormatter.format(new Date(publication.scheduled_at))
    : "Sem horário";
  const platform =
    platformLabels[publication.platform] || publication.platform;
  const status = statusLabels[publication.status] || publication.status;
  const context = postContentContext(item.post, item.publication);
  const draggable = isEditorialPublicationDraggable(
    item.post,
    item.publication,
    { canEdit, canPublish },
  );
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: `publication:${publication.id}`,
    disabled: !draggable || moving,
    data: {
      kind: "publication",
      item,
      label: `${item.post.post.title} · ${platform}`,
    },
  });

  return (
    <div
      ref={setNodeRef}
      style={
        transform
          ? {
              transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
            }
          : undefined
      }
      className={cn(
        "group relative min-h-11 w-full rounded-lg border text-left transition-colors hover:border-primary/40",
        statusClasses[publication.status] || statusClasses.planned,
        isDragging && "opacity-30",
      )}
      data-content-density={compact ? "compact" : "comfortable"}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={`Tema: ${item.post.post.title}. Contexto: ${context || "não informado"}. ${platform}, ${time}, ${status}`}
        className={cn(
          "block min-h-11 w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50",
          compact ? "px-2 py-1.5" : "p-2.5",
          draggable && !moving && "pr-12",
        )}
      >
      {compact ? (
        <>
          <div className="flex min-w-0 items-center gap-1.5 text-[10px]">
            <span
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                platformDots[publication.platform] ||
                  "bg-muted-foreground",
              )}
            />
            <span
              className="truncate font-medium"
              title={`Tema: ${item.post.post.title}`}
            >
              <span className="font-semibold opacity-60">Tema:</span>{" "}
              {item.post.post.title}
            </span>
            <span className="ml-auto shrink-0 opacity-75">{time}</span>
          </div>
          <p
            className="mt-0.5 truncate text-[10px] opacity-75"
            title={`Contexto: ${context || "Não informado"}`}
          >
            <span className="font-semibold">Contexto:</span>{" "}
            {context || "Não informado"}
          </p>
        </>
      ) : (
        <div className="flex min-w-0 gap-2">
          <EditorialFileThumbnail
            post={item.post}
            publication={item.publication}
            className="h-10 w-10"
          />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5 text-[10px] opacity-80">
            <span
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                platformDots[publication.platform] ||
                  "bg-muted-foreground",
              )}
            />
            <span className="truncate font-medium">
              {platform}
              {account?.handle ? ` · ${account.handle}` : ""}
            </span>
            <span className="ml-auto shrink-0">{time}</span>
            </div>
            <ContentDirection
              theme={item.post.post.title}
              context={context}
              className="mt-1"
            />
          </div>
        </div>
      )}
      </button>
      {draggable && !moving && (
        <button
          type="button"
          className="absolute inset-y-0 right-0 inline-flex min-h-11 w-11 touch-none cursor-grab items-center justify-center rounded-r-lg border-l border-current/10 opacity-60 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50 active:cursor-grabbing"
          {...listeners}
          {...attributes}
          aria-label={`Mover ${item.post.post.title} no calendário`}
        >
          <GripVertical className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function taskDeliveryTypeLabel(task: EditorialInboxTask) {
  const type = task.delivery_type as TaskDeliveryType | null | undefined;
  return type && TASK_DELIVERY_TYPE_LABELS[type]
    ? TASK_DELIVERY_TYPE_LABELS[type]
    : "Conteúdo";
}

function TaskSchedulePill({
  task,
  compact = false,
  projectScopeName,
  onClick,
}: {
  task: EditorialInboxTask;
  compact?: boolean;
  projectScopeName?: string;
  onClick: () => void;
}) {
  const deliveryType = taskDeliveryTypeLabel(task);
  const context = taskContentContext(task);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Abrir tarefa. Tema: ${task.title}. Contexto: ${context || "não informado"}. ${deliveryType}`}
      className={cn(
        "group w-full rounded-lg border border-violet-500/25 bg-violet-500/10 text-left text-foreground transition-colors hover:border-violet-500/50 hover:bg-violet-500/[0.14]",
        compact ? "px-2 py-1.5" : "p-2.5",
      )}
      data-content-density={compact ? "compact" : "comfortable"}
    >
      {compact ? (
        <>
          <div className="flex min-w-0 items-center gap-1.5 text-[10px]">
            <Palette
              className="h-3.5 w-3.5 shrink-0 text-violet-500"
              aria-hidden="true"
            />
            <span
              className="truncate font-medium"
              title={`Tema: ${task.title}`}
            >
              <span className="font-semibold opacity-60">Tema:</span>{" "}
              {task.title}
            </span>
            <span className="ml-auto shrink-0 text-[9px] text-violet-500">
              {deliveryType}
            </span>
          </div>
          <p
            className="mt-0.5 truncate text-[10px] text-muted-foreground"
            title={`Contexto: ${context || "Não informado"}`}
          >
            <span className="font-semibold">Contexto:</span>{" "}
            {context || "Não informado"}
          </p>
        </>
      ) : (
        <>
          <div className="flex min-w-0 items-center gap-1.5">
            <Palette
              className="h-3.5 w-3.5 shrink-0 text-violet-500"
              aria-hidden="true"
            />
            <span className="truncate text-[10px] font-medium text-violet-500">
              {deliveryType}
              {projectScopeName ? ` · ${projectScopeName}` : ""}
            </span>
          </div>
          <ContentDirection
            theme={task.title}
            context={context}
            className="mt-1"
          />
        </>
      )}
    </button>
  );
}

function EmptyState({ canCreate }: { canCreate: boolean }) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/40 px-6 text-center">
      <CalendarClock className="mb-3 h-9 w-9 text-muted-foreground/50" />
      <p className="text-sm font-medium text-foreground">
        Nenhum conteúdo neste recorte
      </p>
      <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
        {canCreate
          ? "Ajuste os filtros, crie um conteúdo ou arraste uma tarefa do Kanban para começar."
          : "Ajuste os filtros ou aguarde a equipe liberar os próximos conteúdos."}
      </p>
    </div>
  );
}

function DroppableDay({
  dateKey,
  className,
  canDrop,
  children,
}: {
  dateKey: string;
  className?: string;
  canDrop: boolean;
  children: React.ReactNode;
}) {
  const { active } = useDndContext();
  const activeKind = active?.data.current?.kind;
  const acceptsActive =
    activeKind === "task" || activeKind === "publication";
  const { isOver, setNodeRef } = useDroppable({
    id: `date:${dateKey}`,
    disabled: !canDrop,
    data: { kind: "date", dateKey },
  });

  return (
    <div
      ref={setNodeRef}
      role="gridcell"
      aria-label={`Dia ${dateKey}`}
      className={cn(
        "transition-colors",
        className,
        isOver &&
          acceptsActive &&
          "bg-primary/10 ring-1 ring-inset ring-primary/60",
      )}
    >
      {children}
    </div>
  );
}

function MobileAgenda({
  days,
  itemsByDate,
  tasksByDate,
  projectScopeNames,
  canCreate,
  canEdit,
  canPublish,
  moving,
  onCreateOnDate,
  onSelectPost,
  onCreateFromTask,
}: {
  days: Date[];
  itemsByDate: Map<string, ScheduledEditorialItem[]>;
  tasksByDate: Map<string, EditorialInboxTask[]>;
  projectScopeNames: Map<string, string>;
  canCreate: boolean;
  canEdit: boolean;
  canPublish: boolean;
  moving: boolean;
  onCreateOnDate: (dateKey: string) => void;
  onSelectPost: (post: EditorialPostBundle) => void;
  onCreateFromTask: (
    task: EditorialInboxTask,
    targetDateKey?: string,
  ) => void;
}) {
  return (
    <div className="space-y-2 md:hidden">
      {days.map((day) => {
        const key = localDateKey(day);
        const dayItems = itemsByDate.get(key) || [];
        const dayTasks = tasksByDate.get(key) || [];
        return (
          <DroppableDay
            key={key}
            dateKey={key}
            canDrop={canCreate || canEdit || canPublish}
            className="rounded-xl border border-border bg-card p-3"
          >
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {format(day, "EEEE", { locale: ptBR })}
                </p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">
                  {format(day, "dd 'de' MMMM", { locale: ptBR })}
                </p>
              </div>
              {canCreate && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => onCreateOnDate(key)}
                  aria-label={`Criar conteúdo em ${key}`}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              )}
            </div>
            <div className="space-y-2">
              {dayTasks.map((task) => (
                <TaskSchedulePill
                  key={task.id}
                  task={task}
                  projectScopeName={projectScopeNames.get(task.project_id)}
                  onClick={() => onCreateFromTask(task, key)}
                />
              ))}
              {dayItems.map((item) => (
                <PublicationPill
                  key={item.publication.publication.id}
                  item={item}
                  canEdit={canEdit}
                  canPublish={canPublish}
                  moving={moving}
                  onClick={() => onSelectPost(item.post)}
                />
              ))}
              {dayItems.length === 0 && dayTasks.length === 0 && (
                <p className="rounded-lg border border-dashed border-border/75 py-3 text-center text-[10px] text-muted-foreground/65">
                  Solte uma tarefa ou publicação aqui
                </p>
              )}
            </div>
          </DroppableDay>
        );
      })}
    </div>
  );
}

function MonthView({
  anchorDate,
  itemsByDate,
  tasksByDate,
  projectScopeNames,
  canCreate,
  canEdit,
  canPublish,
  moving,
  onCreateOnDate,
  onSelectPost,
  onCreateFromTask,
}: {
  anchorDate: Date;
  itemsByDate: Map<string, ScheduledEditorialItem[]>;
  tasksByDate: Map<string, EditorialInboxTask[]>;
  projectScopeNames: Map<string, string>;
  canCreate: boolean;
  canEdit: boolean;
  canPublish: boolean;
  moving: boolean;
  onCreateOnDate: (dateKey: string) => void;
  onSelectPost: (post: EditorialPostBundle) => void;
  onCreateFromTask: (
    task: EditorialInboxTask,
    targetDateKey?: string,
  ) => void;
}) {
  const start = startOfWeek(startOfMonth(anchorDate), { weekStartsOn: 1 });
  const end = endOfWeek(endOfMonth(anchorDate), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start, end });
  const todayKey = dateKeyInTimeZone(new Date());

  return (
    <>
      <MobileAgenda
        days={days.filter((day) => isSameMonth(day, anchorDate))}
        itemsByDate={itemsByDate}
        tasksByDate={tasksByDate}
        projectScopeNames={projectScopeNames}
        canCreate={canCreate}
        canEdit={canEdit}
        canPublish={canPublish}
        moving={moving}
        onCreateOnDate={onCreateOnDate}
        onSelectPost={onSelectPost}
        onCreateFromTask={onCreateFromTask}
      />
      <div className="hidden overflow-x-auto rounded-2xl border border-border bg-card md:block">
        <div className="min-w-[840px]">
          <div
            className="grid grid-cols-7 border-b border-border bg-secondary/25"
            role="row"
          >
            {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map(
              (day) => (
                <div
                  key={day}
                  role="columnheader"
                  className="px-3 py-2.5 text-center text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
                >
                  {day}
                </div>
              ),
            )}
          </div>
          <div className="grid grid-cols-7" role="grid">
            {days.map((day) => {
              const key = localDateKey(day);
              const dayItems = itemsByDate.get(key) || [];
              const dayTasks = tasksByDate.get(key) || [];
              const visibleTasks = dayTasks.slice(0, 3);
              const visibleItems = dayItems.slice(
                0,
                Math.max(0, 3 - visibleTasks.length),
              );
              const hiddenTasks = dayTasks.slice(visibleTasks.length);
              const hiddenItems = dayItems.slice(visibleItems.length);
              const dayCount = dayItems.length + dayTasks.length;
              const visibleCount =
                visibleItems.length + visibleTasks.length;
              return (
                <DroppableDay
                  key={key}
                  dateKey={key}
                  canDrop={canCreate || canEdit || canPublish}
                  className={cn(
                    "group min-h-[148px] border-b border-r border-border p-2.5",
                    !isSameMonth(day, anchorDate) && "bg-muted/20",
                  )}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span
                      className={cn(
                        "inline-flex h-7 w-7 items-center justify-center rounded-full text-xs",
                        key === todayKey
                          ? "bg-primary font-semibold text-primary-foreground"
                          : !isSameMonth(day, anchorDate)
                            ? "text-muted-foreground/45"
                            : "text-muted-foreground",
                      )}
                    >
                      {format(day, "d")}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {dayCount > 0 && (
                        <span className="text-[10px] text-muted-foreground">
                          {dayCount}
                        </span>
                      )}
                      {canCreate && isSameMonth(day, anchorDate) && (
                        <button
                          type="button"
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-primary/10 hover:text-primary group-hover:opacity-100 focus:opacity-100"
                          onClick={() => onCreateOnDate(key)}
                          aria-label={`Criar conteúdo em ${key}`}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {visibleTasks.map((task) => (
                      <TaskSchedulePill
                        key={task.id}
                        task={task}
                        compact
                        projectScopeName={projectScopeNames.get(
                          task.project_id,
                        )}
                        onClick={() => onCreateFromTask(task, key)}
                      />
                    ))}
                    {visibleItems.map((item) => (
                      <PublicationPill
                        key={item.publication.publication.id}
                        item={item}
                        compact
                        canEdit={canEdit}
                        canPublish={canPublish}
                        moving={moving}
                        onClick={() => onSelectPost(item.post)}
                      />
                    ))}
                    {dayCount > visibleCount && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex min-h-7 w-full items-center rounded-md px-1 text-left text-[10px] font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                            aria-label={`Ver mais ${dayCount - visibleCount} itens de ${format(day, "dd 'de' MMMM", { locale: ptBR })}`}
                          >
                            +{dayCount - visibleCount} neste dia
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="start"
                          className="max-h-[min(420px,70vh)] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto p-3"
                        >
                          <p className="mb-2 text-xs font-semibold text-foreground">
                            {format(day, "EEEE, dd 'de' MMMM", {
                              locale: ptBR,
                            })}
                          </p>
                          <div className="space-y-2">
                            {hiddenTasks.map((task) => (
                              <TaskSchedulePill
                                key={task.id}
                                task={task}
                                projectScopeName={projectScopeNames.get(
                                  task.project_id,
                                )}
                                onClick={() => onCreateFromTask(task, key)}
                              />
                            ))}
                            {hiddenItems.map((item) => (
                              <PublicationPill
                                key={item.publication.publication.id}
                                item={item}
                                canEdit={canEdit}
                                canPublish={canPublish}
                                moving={moving}
                                onClick={() => onSelectPost(item.post)}
                              />
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                </DroppableDay>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

function WeekView({
  anchorDate,
  itemsByDate,
  tasksByDate,
  projectScopeNames,
  canCreate,
  canEdit,
  canPublish,
  moving,
  onCreateOnDate,
  onSelectPost,
  onCreateFromTask,
}: {
  anchorDate: Date;
  itemsByDate: Map<string, ScheduledEditorialItem[]>;
  tasksByDate: Map<string, EditorialInboxTask[]>;
  projectScopeNames: Map<string, string>;
  canCreate: boolean;
  canEdit: boolean;
  canPublish: boolean;
  moving: boolean;
  onCreateOnDate: (dateKey: string) => void;
  onSelectPost: (post: EditorialPostBundle) => void;
  onCreateFromTask: (
    task: EditorialInboxTask,
    targetDateKey?: string,
  ) => void;
}) {
  const start = startOfWeek(anchorDate, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  const todayKey = dateKeyInTimeZone(new Date());

  return (
    <>
      <MobileAgenda
        days={days}
        itemsByDate={itemsByDate}
        tasksByDate={tasksByDate}
        projectScopeNames={projectScopeNames}
        canCreate={canCreate}
        canEdit={canEdit}
        canPublish={canPublish}
        moving={moving}
        onCreateOnDate={onCreateOnDate}
        onSelectPost={onSelectPost}
        onCreateFromTask={onCreateFromTask}
      />
      <div className="hidden overflow-x-auto rounded-2xl border border-border bg-card md:block">
        <div className="grid min-w-[920px] grid-cols-7">
          {days.map((day) => {
            const key = localDateKey(day);
            const dayItems = itemsByDate.get(key) || [];
            const dayTasks = tasksByDate.get(key) || [];
            return (
              <DroppableDay
                key={key}
                dateKey={key}
                canDrop={canCreate || canEdit || canPublish}
                className="group min-h-[450px] border-r border-border last:border-r-0"
              >
                <header
                  className={cn(
                    "border-b border-border px-3 py-3 text-center",
                    key === todayKey && "bg-primary/5",
                  )}
                >
                  <p className="text-[10px] font-medium uppercase text-muted-foreground">
                    {format(day, "EEE", { locale: ptBR })}
                  </p>
                  <div className="mt-1 flex items-center justify-center gap-1">
                    <p
                      className={cn(
                        "text-lg font-semibold",
                        key === todayKey
                          ? "text-primary"
                          : "text-foreground",
                      )}
                    >
                      {format(day, "dd")}
                    </p>
                    {canCreate && (
                      <button
                        type="button"
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-primary/10 hover:text-primary group-hover:opacity-100 focus:opacity-100"
                        onClick={() => onCreateOnDate(key)}
                        aria-label={`Criar conteúdo em ${key}`}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </header>
                <div className="space-y-2 p-2.5">
                  {dayTasks.map((task) => (
                    <TaskSchedulePill
                      key={task.id}
                      task={task}
                      projectScopeName={projectScopeNames.get(
                        task.project_id,
                      )}
                      onClick={() => onCreateFromTask(task, key)}
                    />
                  ))}
                  {dayItems.map((item) => (
                    <PublicationPill
                      key={item.publication.publication.id}
                      item={item}
                      canEdit={canEdit}
                      canPublish={canPublish}
                      moving={moving}
                      onClick={() => onSelectPost(item.post)}
                    />
                  ))}
                  {dayItems.length === 0 && dayTasks.length === 0 && (
                    <p className="rounded-lg border border-dashed border-border/70 py-8 text-center text-[10px] text-muted-foreground/60">
                      Solte aqui
                    </p>
                  )}
                </div>
              </DroppableDay>
            );
          })}
        </div>
      </div>
    </>
  );
}

function BoardPostCard({
  post,
  stage,
  clientName,
  projectName,
  canEdit,
  moving,
  onClick,
}: {
  post: EditorialPostBundle;
  stage: BoardStage;
  clientName: string;
  projectName: string;
  canEdit: boolean;
  moving: boolean;
  onClick: () => void;
}) {
  const draggable =
    canEdit && stage !== "delivery" && isEditorialPostPlanMutable(post);
  const Icon = contentTypeIcon(post.post.content_type);
  const approval = getEditorialApprovalStage(post);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: `post:${post.post.id}`,
    disabled: !draggable || moving,
    data: {
      kind: "post",
      post,
      label: post.post.title,
    },
  });

  return (
    <article
      ref={setNodeRef}
      style={
        transform
          ? {
              transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
            }
          : undefined
      }
      className={cn(
        "group rounded-xl border border-border bg-background/90 p-3.5 shadow-sm transition-[border-color,box-shadow] duration-150 hover:border-primary/35 hover:shadow-md motion-reduce:transition-none",
        isDragging && "opacity-30",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="mb-3 block aspect-[16/9] w-full overflow-hidden rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        aria-label={`Ver conteúdo completo de ${post.post.title}`}
      >
        <EditorialFileThumbnail post={post} className="h-full w-full" />
      </button>
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          onClick={onClick}
          className="min-w-0 flex-1 text-left"
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {contentTypeLabel(post.post.content_type)}
            </span>
          </div>
          <h3 className="line-clamp-2 text-[13px] font-medium leading-5 text-foreground">
            {post.post.title}
          </h3>
          <p className="mt-1 truncate text-[10px] text-muted-foreground">
            {clientName} · {projectName}
          </p>
        </button>
        {draggable && !moving && (
          <button
            type="button"
            className="inline-flex h-11 w-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted-foreground opacity-50 transition-colors hover:bg-secondary hover:text-foreground hover:opacity-100 active:cursor-grabbing"
            aria-label={`Mover ${post.post.title}`}
            {...listeners}
            {...attributes}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge
          variant="outline"
          className="h-5 rounded-md px-1.5 text-[9px] font-normal"
        >
          {approvalLabels[approval] || approval}
        </Badge>
        {post.internal?.task_id && (
          <Badge
            variant="secondary"
            className="h-5 rounded-md px-1.5 text-[9px] font-normal"
          >
            <Link2 className="mr-1 h-2.5 w-2.5" />
            Kanban
          </Badge>
        )}
        <span className="ml-auto inline-flex items-center">
          {post.publications.slice(0, 4).map(({ publication }) => (
            <span
              key={publication.id}
              className={cn(
                "-ml-0.5 h-2.5 w-2.5 rounded-full border-2 border-background",
                platformDots[publication.platform] ||
                  "bg-muted-foreground",
              )}
              title={platformLabels[publication.platform]}
            />
          ))}
        </span>
      </div>
    </article>
  );
}

function boardTaskDueDate(value?: string | null) {
  if (!value) return "Sem prazo";
  const rawDate = value.slice(0, 10);
  const date = new Date(`${rawDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "Sem prazo";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

function BoardTaskCard({
  task,
  projectScopeName,
  responsibleName,
  canEdit,
  moving,
  onCreate,
}: {
  task: EditorialInboxTask;
  projectScopeName: string;
  responsibleName: string;
  canEdit: boolean;
  moving: boolean;
  onCreate: () => void;
}) {
  const draggable = canEdit && !moving;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: `task:${task.id}`,
    disabled: !draggable,
    data: {
      kind: "task",
      task,
      label: task.title,
    },
  });

  return (
    <article
      ref={setNodeRef}
      style={
        transform
          ? {
              transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
            }
          : undefined
      }
      className={cn(
        "group rounded-xl border border-primary/20 bg-primary/[0.035] p-3.5 shadow-sm transition-[border-color,box-shadow] duration-150 hover:border-primary/45 hover:shadow-md motion-reduce:transition-none",
        isDragging && "opacity-30",
      )}
    >
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          onClick={onCreate}
          disabled={!canEdit || moving}
          className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Palette className="h-3.5 w-3.5" />
            </span>
            <span className="text-[10px] font-medium uppercase tracking-wide text-primary">
              {taskDeliveryTypeLabel(task)} · Kanban
            </span>
          </div>
          <h3 className="line-clamp-2 text-[13px] font-medium leading-5 text-foreground">
            {task.title}
          </h3>
          <p className="mt-1 truncate text-[10px] text-muted-foreground">
            {projectScopeName}
          </p>
        </button>
        {draggable && (
          <button
            type="button"
            className="inline-flex h-11 w-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted-foreground opacity-60 transition-colors hover:bg-secondary hover:text-foreground hover:opacity-100 active:cursor-grabbing"
            aria-label={`Mover tarefa ${task.title}`}
            {...listeners}
            {...attributes}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="mt-3 flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground">
        {task.status === "blocked" && (
          <Badge
            variant="outline"
            className="h-5 shrink-0 border-warning/30 bg-warning/10 px-1.5 text-[9px] text-warning"
          >
            Bloqueada
          </Badge>
        )}
        <span className="inline-flex min-w-0 items-center gap-1 truncate">
          <UserRound className="h-3 w-3 shrink-0" />
          <span className="truncate">{responsibleName}</span>
        </span>
        <span className="ml-auto inline-flex shrink-0 items-center gap-1">
          <CalendarClock className="h-3 w-3" />
          {boardTaskDueDate(task.due_date)}
        </span>
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="mt-3 h-8 w-full text-[11px]"
        disabled={!canEdit || moving}
        onClick={onCreate}
      >
        <Plus className="mr-1 h-3.5 w-3.5" />
        Criar e vincular conteúdo
      </Button>
    </article>
  );
}

function BoardColumn({
  column,
  posts,
  tasks,
  clientNames,
  projectNames,
  projectScopeNames,
  responsibleNames,
  canEdit,
  moving,
  onSelectPost,
  onCreateFromTask,
}: {
  column: (typeof boardColumns)[number];
  posts: EditorialPostBundle[];
  tasks: EditorialInboxTask[];
  clientNames: Map<string, string>;
  projectNames: Map<string, string>;
  projectScopeNames: Map<string, string>;
  responsibleNames: Map<string, string>;
  canEdit: boolean;
  moving: boolean;
  onSelectPost: (post: EditorialPostBundle) => void;
  onCreateFromTask: (task: EditorialInboxTask) => void;
}) {
  const { active } = useDndContext();
  const activeKind = active?.data.current?.kind;
  const acceptsActive = activeKind === "task" || activeKind === "post";
  const isWritable = column.id !== "delivery" && canEdit;
  const { isOver, setNodeRef } = useDroppable({
    id: `stage:${column.id}`,
    disabled: !isWritable,
    data: {
      kind: "stage",
      stage: column.id,
      productionStatus:
        column.id === "delivery" ? null : column.id,
    },
  });

  return (
    <section
      ref={setNodeRef}
      className={cn(
        "flex h-[min(68vh,720px)] min-h-[520px] min-w-0 flex-col rounded-2xl border border-border bg-card/65 p-3 transition-colors",
        isOver &&
          acceptsActive &&
          "border-primary/60 bg-primary/[0.06] ring-1 ring-primary/30",
      )}
    >
      <header className="mb-3 px-1 pt-0.5">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full", column.dot)} />
          <h2 className="text-xs font-semibold text-foreground">
            {column.label}
          </h2>
          <Badge
            variant="secondary"
            className="ml-auto h-5 rounded-md px-1.5 font-mono text-[9px]"
          >
            {posts.length + tasks.length}
          </Badge>
        </div>
        <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">
          {column.description}
        </p>
      </header>
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-0.5 [scrollbar-gutter:stable]">
        {tasks.map((task) => (
          <BoardTaskCard
            key={task.id}
            task={task}
            projectScopeName={
              projectScopeNames.get(task.project_id) || "Cliente / Projeto"
            }
            responsibleName={
              task.assigned_to
                ? responsibleNames.get(task.assigned_to) || "Sem responsável"
                : "Sem responsável"
            }
            canEdit={canEdit}
            moving={moving}
            onCreate={() => onCreateFromTask(task)}
          />
        ))}
        {posts.map((post) => (
          <BoardPostCard
            key={post.post.id}
            post={post}
            stage={column.id}
            clientName={clientNames.get(post.post.client_id) || "Cliente"}
            projectName={
              projectNames.get(post.post.project_id) || "Projeto"
            }
            canEdit={canEdit}
            moving={moving}
            onClick={() => onSelectPost(post)}
          />
        ))}
        {posts.length === 0 && tasks.length === 0 && (
          <div className="flex min-h-28 items-center justify-center rounded-xl border border-dashed border-border/80 px-4 text-center">
            <p className="text-[10px] leading-4 text-muted-foreground/70">
              {isWritable
                ? "Arraste uma tarefa ou conteúdo para cá"
                : "Nenhum conteúdo finalizado"}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function BoardView({
  posts,
  tasks,
  clientNames,
  projectNames,
  projectScopeNames,
  responsibleNames,
  canEdit,
  moving,
  onSelectPost,
  onCreateFromTask,
}: {
  posts: EditorialPostBundle[];
  tasks: EditorialInboxTask[];
  clientNames: Map<string, string>;
  projectNames: Map<string, string>;
  projectScopeNames: Map<string, string>;
  responsibleNames: Map<string, string>;
  canEdit: boolean;
  moving: boolean;
  onSelectPost: (post: EditorialPostBundle) => void;
  onCreateFromTask: (task: EditorialInboxTask) => void;
}) {
  const groupedPosts = useMemo(() => {
    const initial: Record<BoardStage, EditorialPostBundle[]> = {
      draft: [],
      production: [],
      ready: [],
      delivery: [],
    };
    for (const post of posts) initial[boardStage(post)].push(post);
    return initial;
  }, [posts]);
  const groupedTasks = useMemo(() => {
    const initial: Record<BoardStage, EditorialInboxTask[]> = {
      draft: [],
      production: [],
      ready: [],
      delivery: [],
    };
    for (const task of tasks) {
      const stage = editorialStageForTaskStatus(task.status);
      if (stage) initial[stage].push(task);
    }
    return initial;
  }, [tasks]);

  return (
    <div className="pb-2">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {boardColumns.map((column) => (
          <BoardColumn
            key={column.id}
            column={column}
            posts={groupedPosts[column.id]}
            tasks={groupedTasks[column.id]}
            clientNames={clientNames}
            projectNames={projectNames}
            projectScopeNames={projectScopeNames}
            responsibleNames={responsibleNames}
            canEdit={canEdit}
            moving={moving}
            onSelectPost={onSelectPost}
            onCreateFromTask={onCreateFromTask}
          />
        ))}
      </div>
    </div>
  );
}

type ListTimelineItem =
  | {
      kind: "task";
      dateKey: string;
      sortKey: string;
      task: EditorialInboxTask;
    }
  | {
      kind: "publication";
      dateKey: string;
      sortKey: string;
      item: ScheduledEditorialItem;
    };

function ListView({
  anchorDate,
  posts,
  items,
  tasks,
  clientNames,
  projectNames,
  projectScopeNames,
  responsibleNames,
  canEdit,
  canPublish,
  moving,
  onSelectPost,
  onCreateFromTask,
}: {
  anchorDate: Date;
  posts: EditorialPostBundle[];
  items: ScheduledEditorialItem[];
  tasks: EditorialInboxTask[];
  clientNames: Map<string, string>;
  projectNames: Map<string, string>;
  projectScopeNames: Map<string, string>;
  responsibleNames: Map<string, string>;
  canEdit: boolean;
  canPublish: boolean;
  moving: boolean;
  onSelectPost: (post: EditorialPostBundle) => void;
  onCreateFromTask: (
    task: EditorialInboxTask,
    targetDateKey?: string,
  ) => void;
}) {
  const backlogItems = flattenBacklog(posts);
  const monthStartKey = localDateKey(startOfMonth(anchorDate));
  const monthEndKey = localDateKey(endOfMonth(anchorDate));
  const datedTasks = tasks
    .filter((task) => {
      const key = taskDateKey(task);
      return Boolean(
        key && key >= monthStartKey && key <= monthEndKey,
      );
    })
    .sort((left, right) =>
      (taskDateKey(left) || "").localeCompare(taskDateKey(right) || ""),
    );
  const undatedTasks = tasks.filter((task) => !taskDateKey(task));
  const timelineItems = [
    ...datedTasks.map<ListTimelineItem>((task) => {
      const dateKey = taskDateKey(task) || "";
      return {
        kind: "task",
        dateKey,
        sortKey: `${dateKey}:0`,
        task,
      };
    }),
    ...items.flatMap<ListTimelineItem>((item) => {
      const scheduledAt = item.publication.publication.scheduled_at;
      const dateKey = scheduledDateKey(scheduledAt);
      return dateKey
        ? [
            {
              kind: "publication",
              dateKey,
              sortKey: `${dateKey}:1:${scheduledAt || ""}`,
              item,
            },
          ]
        : [];
    }),
  ].sort((left, right) => left.sortKey.localeCompare(right.sortKey));

  return (
    <div className="space-y-3">
      {timelineItems.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <CalendarClock className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-medium text-foreground">
              Agenda cronológica
            </h3>
            <Badge variant="secondary">{timelineItems.length}</Badge>
          </div>
          {timelineItems.map((timelineItem) => {
            if (timelineItem.kind === "task") {
              const { task, dateKey } = timelineItem;
              return (
                <button
                  key={`task:${task.id}`}
                  type="button"
                  onClick={() => onCreateFromTask(task, dateKey)}
                  className="flex w-full flex-col gap-3 rounded-xl border border-violet-500/20 bg-violet-500/[0.06] p-4 text-left transition-colors hover:border-violet-500/45 sm:flex-row sm:items-center"
                >
                  <div className="flex min-w-[92px] items-center gap-2 sm:block">
                    <p className="text-sm font-semibold text-foreground">
                      {new Intl.DateTimeFormat("pt-BR", {
                        day: "2-digit",
                        month: "short",
                      }).format(new Date(`${dateKey}T12:00:00`))}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Prazo da tarefa
                    </p>
                  </div>
                  <span className="h-9 w-1 shrink-0 rounded-full bg-violet-500" />
                  <div className="min-w-0 flex-1">
                    <ContentDirection
                      theme={task.title}
                      context={taskContentContext(task)}
                      className="text-sm text-foreground"
                    />
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {projectScopeNames.get(task.project_id) || "Projeto"} ·{" "}
                      {taskDeliveryTypeLabel(task)}
                      {task.assigned_to
                        ? ` · ${responsibleNames.get(task.assigned_to) || "Responsável"}`
                        : ""}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className="w-fit border-violet-500/25 bg-violet-500/10 text-violet-500"
                  >
                    Abrir ou preparar
                  </Badge>
                </button>
              );
            }

            const item = timelineItem.item;
            const publication = item.publication.publication;
            const draggable = isEditorialPublicationDraggable(
              item.post,
              item.publication,
              { canEdit, canPublish },
            );
            return (
              <article
                key={`publication:${publication.id}`}
                className="flex w-full flex-col gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/35 sm:flex-row sm:items-center"
              >
                <button
                  type="button"
                  onClick={() => onSelectPost(item.post)}
                  className="flex min-w-0 flex-1 flex-col gap-3 text-left sm:flex-row sm:items-center"
                >
                  <EditorialFileThumbnail
                    post={item.post}
                    publication={item.publication}
                    className="h-14 w-14"
                  />
                  <div className="flex min-w-[92px] items-center gap-2 sm:block">
                    <p className="text-sm font-semibold text-foreground">
                      {new Intl.DateTimeFormat("pt-BR", {
                        timeZone: "America/Sao_Paulo",
                        day: "2-digit",
                        month: "short",
                      }).format(new Date(publication.scheduled_at!))}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {timeFormatter.format(
                        new Date(publication.scheduled_at!),
                      )}
                    </p>
                  </div>
                <span
                  className={cn(
                    "h-9 w-1 shrink-0 rounded-full",
                    platformDots[publication.platform] ||
                      "bg-muted-foreground",
                  )}
                />
                  <div className="min-w-0 flex-1">
                    <ContentDirection
                      theme={item.post.post.title}
                      context={postContentContext(
                        item.post,
                        item.publication,
                      )}
                      className="text-sm text-foreground"
                    />
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {clientNames.get(item.post.post.client_id) || "Cliente"} ·{" "}
                      {projectNames.get(item.post.post.project_id) || "Projeto"} ·{" "}
                      {item.publication.account?.display_name ||
                        platformLabels[publication.platform] ||
                        publication.platform}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "w-fit",
                      statusClasses[publication.status] ||
                        statusClasses.planned,
                    )}
                  >
                    {publication.status === "published" && (
                      <CheckCircle2 className="mr-1 h-3 w-3" />
                    )}
                    {statusLabels[publication.status] || publication.status}
                  </Badge>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  {draggable && !moving && (
                    <span
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2 text-[10px] text-muted-foreground"
                      title="Use a visualização de calendário para arrastar"
                    >
                      <GripVertical className="h-3 w-3" />
                      Mover
                    </span>
                  )}
                  {publication.permalink && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      asChild
                    >
                      <a
                        href={publication.permalink}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Abrir publicação"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      )}

      {(backlogItems.length > 0 || undatedTasks.length > 0) && (
        <section className="rounded-2xl border border-dashed border-border bg-card/40 p-4">
          <div className="mb-3 flex items-center gap-2">
            <CircleDashed className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-medium text-foreground">
              Sem agendamento
            </h3>
            <Badge variant="secondary">
              {backlogItems.length + undatedTasks.length}
            </Badge>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {undatedTasks.map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => onCreateFromTask(task)}
                className="rounded-xl border border-violet-500/20 bg-violet-500/[0.06] p-3 text-left transition-colors hover:border-violet-500/45"
              >
                <ContentDirection
                  theme={task.title}
                  context={taskContentContext(task)}
                  compact
                  className="text-foreground"
                />
                <p className="mt-1 truncate text-[10px] text-muted-foreground">
                  {projectScopeNames.get(task.project_id) || "Projeto"} ·{" "}
                  {taskDeliveryTypeLabel(task)}
                </p>
              </button>
            ))}
            {backlogItems.map(({ post, publication }) => (
              <button
                key={
                  publication
                    ? publication.publication.id
                    : post.post.id
                }
                type="button"
                onClick={() => onSelectPost(post)}
                className="rounded-xl border border-border bg-background p-3 text-left transition-colors hover:border-primary/35"
              >
                <ContentDirection
                  theme={post.post.title}
                  context={postContentContext(post, publication)}
                  compact
                  className="text-foreground"
                />
                <p className="mt-1 truncate text-[10px] text-muted-foreground">
                  {projectNames.get(post.post.project_id) || "Projeto"} ·{" "}
                  {publication
                    ? `${platformLabels[publication.publication.platform] || publication.publication.platform}${publication.account?.handle ? ` · ${publication.account.handle}` : ""}`
                    : post.post.production_status}
                </p>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default function EditorialCalendarViews({
  view,
  anchorDate,
  posts,
  tasks = [],
  clientNames,
  projectNames,
  projectScopeNames = new Map(),
  responsibleNames = new Map(),
  canCreate,
  canEdit,
  canPublish,
  moving = false,
  onSelectPost,
  onCreateFromTask = () => undefined,
  onCreateOnDate,
  onShowBacklog,
}: EditorialCalendarViewsProps) {
  const items = useMemo(() => flattenScheduled(posts), [posts]);
  const itemsByDate = useMemo(
    () => groupScheduledByDate(items),
    [items],
  );
  const tasksByDate = useMemo(
    () => groupTasksByDate(tasks),
    [tasks],
  );
  const backlogCount = useMemo(
    () =>
      flattenBacklog(posts).length +
      tasks.filter((task) => !taskDateKey(task)).length,
    [posts, tasks],
  );
  const listMonthStartKey = localDateKey(startOfMonth(anchorDate));
  const listMonthEndKey = localDateKey(endOfMonth(anchorDate));
  const hasVisibleListTask = tasks.some((task) => {
    const key = taskDateKey(task);
    return !key || (key >= listMonthStartKey && key <= listMonthEndKey);
  });

  if (posts.length === 0 && !hasVisibleListTask && view === "list") {
    return <EmptyState canCreate={canCreate} />;
  }

  if (view === "board") {
    return (
      <BoardView
        posts={posts}
        tasks={tasks}
        clientNames={clientNames}
        projectNames={projectNames}
        projectScopeNames={projectScopeNames}
        responsibleNames={responsibleNames}
        canEdit={canEdit}
        moving={moving}
        onSelectPost={onSelectPost}
        onCreateFromTask={onCreateFromTask}
      />
    );
  }

  const backlogNotice =
    backlogCount > 0 ? (
      <button
        type="button"
        onClick={onShowBacklog}
        className="mb-3 flex min-h-11 w-full items-center justify-between rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-2.5 text-left text-xs text-foreground transition-colors hover:border-violet-500/40"
      >
        <span>
          {backlogCount}{" "}
          {backlogCount === 1
            ? "publicação sem agendamento"
            : "publicações sem agendamento"}
        </span>
        <span className="inline-flex items-center gap-1 font-medium text-violet-500">
          Ver na lista
          <Send className="h-3 w-3" />
        </span>
      </button>
    ) : null;

  if (view === "month") {
    return (
      <>
        {backlogNotice}
        <MonthView
          anchorDate={anchorDate}
          itemsByDate={itemsByDate}
          tasksByDate={tasksByDate}
          projectScopeNames={projectScopeNames}
          canCreate={canCreate}
          canEdit={canEdit}
          canPublish={canPublish}
          moving={moving}
          onCreateOnDate={onCreateOnDate}
          onSelectPost={onSelectPost}
          onCreateFromTask={onCreateFromTask}
        />
      </>
    );
  }
  if (view === "week") {
    return (
      <>
        {backlogNotice}
        <WeekView
          anchorDate={anchorDate}
          itemsByDate={itemsByDate}
          tasksByDate={tasksByDate}
          projectScopeNames={projectScopeNames}
          canCreate={canCreate}
          canEdit={canEdit}
          canPublish={canPublish}
          moving={moving}
          onCreateOnDate={onCreateOnDate}
          onSelectPost={onSelectPost}
          onCreateFromTask={onCreateFromTask}
        />
      </>
    );
  }
  return (
    <ListView
      anchorDate={anchorDate}
      posts={posts}
      items={items}
      tasks={tasks}
      clientNames={clientNames}
      projectNames={projectNames}
      projectScopeNames={projectScopeNames}
      responsibleNames={responsibleNames}
      canEdit={canEdit}
      canPublish={canPublish}
      moving={moving}
      onSelectPost={onSelectPost}
      onCreateFromTask={onCreateFromTask}
    />
  );
}
