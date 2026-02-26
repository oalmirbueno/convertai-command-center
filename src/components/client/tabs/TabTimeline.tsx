import { useMilestones, useTasks } from "@/hooks/useSupabaseData";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";

const statusLabels: Record<string, string> = {
  completed: "Concluído",
  in_progress: "Em andamento",
  pending: "Pendente",
};

const statusBadge: Record<string, string> = {
  completed: "bg-success/10 text-success",
  in_progress: "bg-primary/10 text-primary",
  pending: "bg-muted text-muted-foreground",
};

const taskStatusLabels: Record<string, string> = {
  backlog: "Backlog",
  doing: "Em Andamento",
  review: "Revisão",
  approved: "Aprovado",
  done: "Concluído",
};

const taskStatusDot: Record<string, string> = {
  backlog: "bg-muted-foreground",
  doing: "bg-info",
  review: "bg-warning",
  approved: "bg-primary",
  done: "bg-success",
};

export default function TabTimeline({ projectId }: { projectId: string }) {
  const { data: milestones, isLoading: loadingMilestones } = useMilestones(projectId);
  const { data: tasks, isLoading: loadingTasks } = useTasks(projectId);
  const [expandedMilestone, setExpandedMilestone] = useState<string | null>(null);

  const formatDate = (d: string) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  };

  if (loadingMilestones || loadingTasks) {
    return (
      <div className="space-y-4 py-4">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
      </div>
    );
  }

  if (!milestones?.length) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Timeline será atualizada em breve</p>;
  }

  // Group tasks by milestone_id
  const tasksByMilestone: Record<string, any[]> = {};
  (tasks || []).forEach((t: any) => {
    if (t.milestone_id) {
      if (!tasksByMilestone[t.milestone_id]) tasksByMilestone[t.milestone_id] = [];
      tasksByMilestone[t.milestone_id].push(t);
    }
  });

  const lastCompletedIdx = milestones.reduce((acc: number, m: any, i: number) => m.status === "completed" ? i : acc, -1);

  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground mb-4">Acompanhe o cronograma e progresso de cada etapa</p>

      {milestones.map((m: any, i: number) => {
        const milestoneTasks = tasksByMilestone[m.id] || [];
        const doneTasks = milestoneTasks.filter((t: any) => t.status === "done").length;
        const totalTasks = milestoneTasks.length;
        const progress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
        const isExpanded = expandedMilestone === m.id;

        return (
          <div key={m.id} className="relative">
            {/* Connecting line */}
            {i < milestones.length - 1 && (
              <div className={`absolute left-[15px] top-[32px] w-[2px] h-[calc(100%-16px)] ${i <= lastCompletedIdx ? "bg-primary" : "bg-border"}`} />
            )}

            {/* Milestone row */}
            <button
              onClick={() => setExpandedMilestone(isExpanded ? null : m.id)}
              className="w-full flex items-start gap-3 p-3 rounded-xl hover:bg-secondary/50 transition-colors cursor-pointer bg-transparent border-none text-left"
            >
              {/* Node */}
              <div className="shrink-0 mt-0.5">
                {m.status === "completed" ? (
                  <div className="w-[30px] h-[30px] rounded-full bg-primary flex items-center justify-center shadow-lg shadow-primary/20">
                    <Check className="w-4 h-4 text-primary-foreground" />
                  </div>
                ) : m.status === "in_progress" ? (
                  <div className="w-[30px] h-[30px] rounded-full border-[3px] border-primary bg-transparent milestone-pulse" />
                ) : (
                  <div className="w-[30px] h-[30px] rounded-full bg-secondary" />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-[13px] font-medium text-foreground">{m.title}</p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${statusBadge[m.status]}`}>
                    {statusLabels[m.status]}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-[11px] text-muted-foreground">{formatDate(m.target_date)}</span>
                  {totalTasks > 0 && (
                    <span className="text-[11px] text-muted-foreground">
                      {doneTasks}/{totalTasks} tarefas
                    </span>
                  )}
                </div>
                {/* Mini progress bar */}
                {totalTasks > 0 && (
                  <div className="h-[3px] w-full max-w-[200px] rounded-full bg-secondary mt-2 overflow-hidden">
                    <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${progress}%` }} />
                  </div>
                )}
              </div>

              {/* Expand icon */}
              {milestoneTasks.length > 0 && (
                <div className="shrink-0 mt-1 text-muted-foreground">
                  {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </div>
              )}
            </button>

            {/* Expanded tasks */}
            {isExpanded && milestoneTasks.length > 0 && (
              <div className="ml-[42px] mb-2 space-y-1 animate-in slide-in-from-top-2 duration-200">
                {milestoneTasks.map((t: any) => (
                  <div key={t.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-card border border-border">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${taskStatusDot[t.status] || "bg-muted-foreground"}`} />
                    <p className="text-[12px] text-foreground flex-1 min-w-0 truncate">{t.title}</p>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {taskStatusLabels[t.status] || t.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
