import { useState } from "react";
import { useTasks } from "@/hooks/useSupabaseData";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Clock, Info, Columns3, Eye, CheckCircle2, Sparkles, CircleDot, Circle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { ScrollArea } from "@/components/ui/scroll-area";

const columns = [
  {
    id: "backlog",
    title: "Planejado",
    dotColor: "bg-muted-foreground/50",
    icon: Circle,
    hint: "Tarefas que foram planejadas e aguardam início",
  },
  {
    id: "doing",
    title: "Em Andamento",
    dotColor: "bg-sky-400",
    icon: Sparkles,
    hint: "Tarefas sendo executadas pela equipe agora",
  },
  {
    id: "review",
    title: "Em Revisão",
    dotColor: "bg-amber-400",
    icon: Eye,
    hint: "Tarefas finalizadas aguardando revisão de qualidade",
  },
  {
    id: "approved",
    title: "Aprovado",
    dotColor: "bg-primary",
    icon: CircleDot,
    hint: "Tarefas revisadas e aprovadas",
  },
  {
    id: "done",
    title: "Concluído",
    dotColor: "bg-emerald-500",
    icon: CheckCircle2,
    hint: "Tarefas 100% finalizadas e entregues",
  },
];

const priorityLabels: Record<string, { label: string; color: string }> = {
  urgent: { label: "Urgente", color: "bg-destructive/10 text-destructive" },
  high: { label: "Alta", color: "bg-amber-500/10 text-amber-400" },
  medium: { label: "Normal", color: "bg-secondary text-muted-foreground" },
  low: { label: "Baixa", color: "bg-secondary text-muted-foreground/60" },
};

const priorityBorderColors: Record<string, string> = {
  urgent: "border-l-destructive",
  high: "border-l-amber-400",
  medium: "border-l-muted-foreground/30",
  low: "border-l-border",
};

export default function TabKanban({ projectId }: { projectId: string }) {
  const { data: tasks, isLoading } = useTasks(projectId);
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState("doing");

  const formatDate = (d: string) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  };

  const daysUntil = (d: string) => {
    if (!d) return null;
    return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
  };

  if (isLoading) {
    return (
      <div className="flex gap-4 overflow-x-auto pb-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="min-w-[260px] space-y-3">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        ))}
      </div>
    );
  }

  const sortedTasks = (tasks || []).slice().sort((a: any, b: any) => {
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
  });

  const totalTasks = sortedTasks.length;
  const doneTasks = sortedTasks.filter((t: any) => t.status === "done").length;
  const doingTasks = sortedTasks.filter((t: any) => t.status === "doing").length;

  const renderCard = (task: any) => {
    const dl = daysUntil(task.due_date);
    const isOverdue = dl !== null && dl < 0;
    const isUrgentDate = dl !== null && dl >= 0 && dl <= 3;
    const prio = priorityLabels[task.priority] || priorityLabels.medium;

    return (
      <div
        key={task.id}
        className={`bg-card border border-border rounded-xl border-l-[3px] ${priorityBorderColors[task.priority] || "border-l-border"} cursor-default hover:border-muted-foreground/30 transition-all hover:shadow-sm`}
      >
        <div className="p-3.5 space-y-2.5">
          <p className="text-[13px] font-medium text-foreground leading-snug">{task.title}</p>

          {/* Tags row */}
          <div className="flex flex-wrap gap-1.5">
            {task.milestone?.title && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                {task.milestone.title}
              </span>
            )}
            {(task.priority === "urgent" || task.priority === "high") && (
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${prio.color}`}>
                {prio.label}
              </span>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-1">
            {task.due_date ? (
              <div className={`flex items-center gap-1 text-[10px] font-mono ${
                isOverdue ? "text-destructive" : isUrgentDate ? "text-amber-400" : "text-muted-foreground"
              }`}>
                <Clock className="w-3 h-3" />
                {formatDate(task.due_date)}
                {isOverdue && <span className="font-sans font-medium ml-0.5">atrasada</span>}
              </div>
            ) : (
              <span />
            )}
            {task.assignee && (
              <div className="flex items-center gap-1.5">
                <Avatar className="w-5 h-5">
                  <AvatarFallback className="text-[8px] bg-secondary text-muted-foreground font-medium">
                    {task.assignee.full_name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                  </AvatarFallback>
                </Avatar>
                <span className="text-[10px] text-muted-foreground hidden sm:inline">{task.assignee.full_name?.split(" ")[0]}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header explicativo */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
            <Columns3 className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-[13px] font-semibold text-foreground mb-1">Quadro de Tarefas</h3>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Aqui você acompanha todas as tarefas do seu projeto organizadas por status.
              As tarefas avançam da esquerda para a direita conforme são executadas pela equipe.
            </p>
          </div>
          {totalTasks > 0 && (
            <div className="text-right shrink-0">
              <p className="text-[18px] font-bold text-foreground tabular-nums">{doneTasks}/{totalTasks}</p>
              <p className="text-[10px] text-muted-foreground">concluídas</p>
            </div>
          )}
        </div>

        {/* Mini summary */}
        {totalTasks > 0 && (
          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border/50">
            <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden flex">
              {doneTasks > 0 && <div className="h-full bg-emerald-500" style={{ width: `${(doneTasks / totalTasks) * 100}%` }} />}
              {doingTasks > 0 && <div className="h-full bg-sky-400" style={{ width: `${(doingTasks / totalTasks) * 100}%` }} />}
            </div>
            <span className="text-[10px] text-muted-foreground font-mono shrink-0">{Math.round((doneTasks / totalTasks) * 100)}%</span>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-1">
        {columns.map(col => (
          <div key={col.id} className="flex items-center gap-1.5 group" title={col.hint}>
            <div className={`w-2 h-2 rounded-full ${col.dotColor}`} />
            <span className="text-[10px] text-muted-foreground group-hover:text-foreground transition-colors">{col.title}</span>
          </div>
        ))}
      </div>

      {!sortedTasks?.length ? (
        <div className="text-center py-12">
          <Columns3 className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhuma tarefa encontrada neste projeto.</p>
          <p className="text-[11px] text-muted-foreground/60 mt-1">As tarefas aparecerão aqui assim que forem criadas pela equipe.</p>
        </div>
      ) : isMobile ? (
        /* ── Mobile: tabs ── */
        <div>
          <div className="flex overflow-x-auto border-b border-border mb-4 scrollbar-hidden -mx-1 px-1">
            {columns.map(col => {
              const count = sortedTasks.filter((t: any) => t.status === col.id).length;
              return (
                <button
                  key={col.id}
                  onClick={() => setMobileTab(col.id)}
                  className={`flex-shrink-0 px-3 py-3 text-[11px] font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer bg-transparent ${
                    mobileTab === col.id
                      ? "text-foreground border-primary"
                      : "text-muted-foreground border-transparent"
                  }`}
                >
                  {col.title}
                  {count > 0 && (
                    <span className="ml-1.5 text-[9px] font-mono bg-secondary px-1.5 py-0.5 rounded-full">{count}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Column hint */}
          {(() => {
            const activeCol = columns.find(c => c.id === mobileTab);
            return activeCol ? (
              <div className="flex items-center gap-1.5 px-1 mb-3">
                <Info className="w-3 h-3 text-muted-foreground/50" />
                <span className="text-[10px] text-muted-foreground/70 italic">{activeCol.hint}</span>
              </div>
            ) : null;
          })()}

          <div className="space-y-2">
            {sortedTasks.filter((t: any) => t.status === mobileTab).map(renderCard)}
            {sortedTasks.filter((t: any) => t.status === mobileTab).length === 0 && (
              <p className="text-[12px] text-muted-foreground py-8 text-center">Nenhuma tarefa nesta coluna.</p>
            )}
          </div>
        </div>
      ) : (
        /* ── Desktop: columns with scroll ── */
        <div className="flex gap-4 overflow-x-auto pb-2">
          {columns.map(col => {
            const colTasks = sortedTasks.filter((t: any) => t.status === col.id);
            const Icon = col.icon;
            return (
              <div key={col.id} className="min-w-[250px] max-w-[270px] flex-shrink-0 flex flex-col">
                {/* Column header */}
                <div className="flex items-center gap-2 mb-3 px-1">
                  <div className={`w-5 h-5 rounded-md flex items-center justify-center ${
                    col.id === "done" ? "bg-emerald-500/10" :
                    col.id === "doing" ? "bg-sky-400/10" :
                    col.id === "review" ? "bg-amber-400/10" :
                    col.id === "approved" ? "bg-primary/10" :
                    "bg-secondary"
                  }`}>
                    <Icon className={`w-3 h-3 ${
                      col.id === "done" ? "text-emerald-500" :
                      col.id === "doing" ? "text-sky-400" :
                      col.id === "review" ? "text-amber-400" :
                      col.id === "approved" ? "text-primary" :
                      "text-muted-foreground/50"
                    }`} />
                  </div>
                  <span className="text-[12px] font-semibold text-foreground">{col.title}</span>
                  <span className="text-[10px] font-mono text-muted-foreground bg-secondary px-1.5 py-0.5 rounded-full ml-auto tabular-nums">
                    {colTasks.length}
                  </span>
                </div>

                {/* Column hint */}
                <p className="text-[9px] text-muted-foreground/60 px-1 mb-2 leading-relaxed">{col.hint}</p>

                {/* Scrollable card list */}
                <ScrollArea className="flex-1 max-h-[420px] pr-1">
                  <div className="space-y-2 pb-2">
                    {colTasks.length === 0 ? (
                      <div className="border border-dashed border-border rounded-xl py-6 text-center">
                        <p className="text-[11px] text-muted-foreground/40">Nenhuma tarefa</p>
                      </div>
                    ) : (
                      colTasks.map(renderCard)
                    )}
                  </div>
                </ScrollArea>
              </div>
            );
          })}
        </div>
      )}

      {/* Read-only notice */}
      <div className="flex items-center justify-center gap-1.5 pt-2">
        <Eye className="w-3 h-3 text-muted-foreground/40" />
        <span className="text-[10px] text-muted-foreground/40">Visualização do andamento do projeto</span>
      </div>
    </div>
  );
}
