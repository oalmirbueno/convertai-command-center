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
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  EditorialPostBundle,
  EditorialPublicationBundle,
} from "@/hooks/useEditorialCalendar";
import type { EditorialView } from "@/components/editorial/EditorialToolbar";
import { dateKeyInTimeZone } from "@/lib/editorialDate";

interface EditorialCalendarViewsProps {
  view: EditorialView;
  anchorDate: Date;
  posts: EditorialPostBundle[];
  clientNames: Map<string, string>;
  projectNames: Map<string, string>;
  canCreate: boolean;
  onSelectPost: (post: EditorialPostBundle) => void;
  onShowBacklog: () => void;
}

interface ScheduledItem {
  post: EditorialPostBundle;
  publication: EditorialPublicationBundle;
}

interface BacklogItem {
  post: EditorialPostBundle;
  publication: EditorialPublicationBundle | null;
}

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
  published: "border-emerald-500/25 bg-emerald-500/10 text-emerald-500",
  failed: "border-destructive/25 bg-destructive/10 text-destructive",
  cancelled: "border-border bg-muted text-muted-foreground",
};

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

function PublicationPill({
  item,
  compact = false,
  onClick,
}: {
  item: ScheduledItem;
  compact?: boolean;
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

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${item.post.post.title}, ${platform}, ${time}, ${status}`}
      className={cn(
        "w-full rounded-lg border text-left transition-colors hover:border-primary/40",
        compact ? "px-2 py-1.5" : "p-2.5",
        statusClasses[publication.status] || statusClasses.planned,
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            platformDots[publication.platform] || "bg-muted-foreground",
          )}
        />
        <span className="truncate text-[11px] font-medium">
          {compact ? time : item.post.post.title}
        </span>
      </div>
      {compact ? (
        <p className="mt-0.5 truncate text-[10px] opacity-80">
          {item.post.post.title}
        </p>
      ) : (
        <div className="mt-1 flex items-center justify-between gap-2 text-[10px] opacity-80">
          <span className="truncate">
            {platform}
            {account?.handle ? ` · ${account.handle}` : ""}
          </span>
          <span className="shrink-0">{time}</span>
        </div>
      )}
    </button>
  );
}

function EmptyState({ canCreate }: { canCreate: boolean }) {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/30 px-6 text-center">
      <CalendarClock className="mb-3 h-9 w-9 text-muted-foreground/50" />
      <p className="text-sm font-medium text-foreground">
        Nenhum conteúdo neste período
      </p>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">
        {canCreate
          ? "Ajuste os filtros ou crie um conteúdo para começar a montar o calendário editorial."
          : "Ajuste os filtros ou aguarde a equipe liberar os próximos conteúdos."}
      </p>
    </div>
  );
}

function MonthView({
  anchorDate,
  items,
  onSelectPost,
}: {
  anchorDate: Date;
  items: ScheduledItem[];
  onSelectPost: (post: EditorialPostBundle) => void;
}) {
  const start = startOfWeek(startOfMonth(anchorDate), { weekStartsOn: 1 });
  const end = endOfWeek(endOfMonth(anchorDate), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start, end });
  const todayKey = dateKeyInTimeZone(new Date());

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <div className="min-w-[900px]">
        <div className="grid grid-cols-7 border-b border-border bg-secondary/30">
          {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((day) => (
            <div
              key={day}
              className="px-3 py-2 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const key = localDateKey(day);
            const dayItems = items.filter(
              (item) =>
                scheduledDateKey(
                  item.publication.publication.scheduled_at,
                ) === key,
            );
            return (
              <div
                key={key}
                className={cn(
                  "min-h-[138px] border-b border-r border-border p-2",
                  !isSameMonth(day, anchorDate) && "bg-muted/25",
                )}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span
                    className={cn(
                      "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs",
                      key === todayKey
                        ? "bg-primary font-semibold text-primary-foreground"
                        : !isSameMonth(day, anchorDate)
                          ? "text-muted-foreground/50"
                          : "text-muted-foreground",
                    )}
                  >
                    {format(day, "d")}
                  </span>
                  {dayItems.length > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      {dayItems.length}
                    </span>
                  )}
                </div>
                <div className="max-h-[112px] space-y-1.5 overflow-y-auto pr-0.5">
                  {dayItems.map((item) => (
                    <PublicationPill
                      key={item.publication.publication.id}
                      item={item}
                      compact
                      onClick={() => onSelectPost(item.post)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function WeekView({
  anchorDate,
  items,
  onSelectPost,
}: {
  anchorDate: Date;
  items: ScheduledItem[];
  onSelectPost: (post: EditorialPostBundle) => void;
}) {
  const start = startOfWeek(anchorDate, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  const todayKey = dateKeyInTimeZone(new Date());

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <div className="grid min-w-[980px] grid-cols-7">
        {days.map((day) => {
          const key = localDateKey(day);
          const dayItems = items.filter(
            (item) =>
              scheduledDateKey(item.publication.publication.scheduled_at) ===
              key,
          );
          return (
            <section
              key={key}
              className="min-h-[430px] border-r border-border last:border-r-0"
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
                <p
                  className={cn(
                    "mt-1 text-lg font-semibold",
                    key === todayKey
                      ? "text-primary"
                      : "text-foreground",
                  )}
                >
                  {format(day, "dd")}
                </p>
              </header>
              <div className="space-y-2 p-2">
                {dayItems.map((item) => (
                  <PublicationPill
                    key={item.publication.publication.id}
                    item={item}
                    onClick={() => onSelectPost(item.post)}
                  />
                ))}
                {dayItems.length === 0 && (
                  <p className="py-8 text-center text-[10px] text-muted-foreground/60">
                    Livre
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ListView({
  posts,
  items,
  clientNames,
  projectNames,
  onSelectPost,
}: {
  posts: EditorialPostBundle[];
  items: ScheduledItem[];
  clientNames: Map<string, string>;
  projectNames: Map<string, string>;
  onSelectPost: (post: EditorialPostBundle) => void;
}) {
  const sorted = [...items].sort((a, b) =>
    (a.publication.publication.scheduled_at || "").localeCompare(
      b.publication.publication.scheduled_at || "",
    ),
  );
  const backlogItems = flattenBacklog(posts);

  return (
    <div className="space-y-3">
      {sorted.map((item) => {
        const publication = item.publication.publication;
        return (
          <article
            key={publication.id}
            className="flex w-full flex-col gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/35 sm:flex-row sm:items-center"
          >
            <button
              type="button"
              onClick={() => onSelectPost(item.post)}
              className="flex min-w-0 flex-1 flex-col gap-3 text-left sm:flex-row sm:items-center"
            >
              <div className="flex min-w-[90px] items-center gap-2 sm:block">
                <p className="text-sm font-semibold text-foreground">
                  {publication.scheduled_at
                    ? new Intl.DateTimeFormat("pt-BR", {
                        timeZone: "America/Sao_Paulo",
                        day: "2-digit",
                        month: "short",
                      }).format(new Date(publication.scheduled_at))
                    : "Sem data"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {publication.scheduled_at
                    ? timeFormatter.format(
                        new Date(publication.scheduled_at),
                      )
                    : ""}
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
                <p className="truncate text-sm font-medium text-foreground">
                  {item.post.post.title}
                </p>
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
          </article>
        );
      })}

      {backlogItems.length > 0 && (
        <section className="rounded-xl border border-dashed border-border bg-card/40 p-4">
          <div className="mb-3 flex items-center gap-2">
            <CircleDashed className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-medium text-foreground">
              Sem agendamento
            </h3>
            <Badge variant="secondary">{backlogItems.length}</Badge>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {backlogItems.map(({ post, publication }) => (
              <button
                key={
                  publication
                    ? publication.publication.id
                    : post.post.id
                }
                type="button"
                onClick={() => onSelectPost(post)}
                className="rounded-lg border border-border bg-background p-3 text-left transition-colors hover:border-primary/35"
              >
                <p className="truncate text-xs font-medium text-foreground">
                  {post.post.title}
                </p>
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
  clientNames,
  projectNames,
  canCreate,
  onSelectPost,
  onShowBacklog,
}: EditorialCalendarViewsProps) {
  if (posts.length === 0) return <EmptyState canCreate={canCreate} />;

  const items = flattenScheduled(posts);
  const backlogCount = flattenBacklog(posts).length;

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
        <span className="font-medium text-violet-500">
          Ver na lista
        </span>
      </button>
    ) : null;

  if (view === "month") {
    return (
      <>
        {backlogNotice}
        <MonthView
          anchorDate={anchorDate}
          items={items}
          onSelectPost={onSelectPost}
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
          items={items}
          onSelectPost={onSelectPost}
        />
      </>
    );
  }
  return (
    <ListView
      posts={posts}
      items={items}
      clientNames={clientNames}
      projectNames={projectNames}
      onSelectPost={onSelectPost}
    />
  );
}
