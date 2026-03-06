import { useTasks, useMilestones, useProjectUpdates } from "@/hooks/useSupabaseData";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  CheckCircle2, Sparkles, Target, Users, Clock,
  Activity, Zap, FileImage, AlertCircle, TrendingUp,
  Eye, Hourglass, CircleCheck, CircleDot, Circle,
} from "lucide-react";
import { relativeTime, formatDate, formatDateShort, daysUntil } from "../dashboardHelpers";

const statusBadge: Record<string, string> = {
  active: "bg-success/10 text-success",
  review: "bg-warning/10 text-warning",
  planning: "bg-info/10 text-info",
  done: "bg-success/10 text-success",
  paused: "bg-muted text-muted-foreground",
};

const typeLabels: Record<string, string> = {
  social_media: "Social Media",
  traffic: "Tráfego",
  automation: "Automação",
  site: "Site",
  landing_page: "Landing Page",
  event: "Evento",
  other: "Outro",
};

const updateIcons: Record<string, typeof Activity> = {
  creative: FileImage, task: CheckCircle2, alert: AlertCircle,
  milestone: Target, system: Zap, report: TrendingUp,
};

export default function TabOverview({ project }: { project: any }) {
  const { data: tasks } = useTasks(project.id);
  const { data: milestones } = useMilestones(project.id);
  const { data: updates } = useProjectUpdates(project.id);

  const allTasks = tasks || [];
  const doingTasks = allTasks.filter((t: any) => t.status === "doing");
  const reviewTasks = allTasks.filter((t: any) => t.status === "review");
  const doneTasks = allTasks.filter((t: any) => t.status === "done");
  const backlogTasks = allTasks.filter((t: any) => t.status === "backlog" || t.status === "todo");
  const totalTasks = allTasks.length;

  const allMilestones = milestones || [];
  const completedMilestones = allMilestones.filter((m: any) => m.status === "completed");
  const activeMilestone = allMilestones.find((m: any) => m.status === "in_progress" || m.status === "pending");

  const recentDone = doneTasks.slice(0, 6);
  const recentUpdates = (updates || []).slice(0, 6);

  const formatDateFull = (d: string) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  };

  // Team members
  const teamMembers = allTasks.length > 0
    ? Array.from(new Map(allTasks.filter((t: any) => t.assigned_to && t.assignee).map((t: any) => [t.assigned_to, t.assignee])).values()) as any[]
    : [];

  // Tasks per team member with full breakdown
  const memberTaskCounts = teamMembers.map((m: any) => {
    const memberTasks = allTasks.filter((t: any) => t.assigned_to === m.id);
    const memberDone = memberTasks.filter((t: any) => t.status === "done").length;
    const memberDoing = memberTasks.filter((t: any) => t.status === "doing").length;
    const memberReview = memberTasks.filter((t: any) => t.status === "review").length;
    const memberBacklog = memberTasks.filter((t: any) => t.status === "backlog" || t.status === "todo").length;
    return { ...m, total: memberTasks.length, done: memberDone, doing: memberDoing, review: memberReview, backlog: memberBacklog };
  });

  const objectives = project.objectives
    ? project.objectives.split("\n").filter((o: string) => o.trim())
    : [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* Left col 60% */}
      <div className="lg:col-span-3 space-y-6">
        {/* About */}
        <div>
          <p className="label-sm mb-3">Sobre o Projeto</p>
          <p className="text-sm text-foreground/80 leading-relaxed">
            {project.description || "Sem descrição disponível."}
          </p>
          {project.scope && (
            <div className="mt-4">
              <p className="label-sm mb-2">Escopo</p>
              <p className="text-[13px] text-foreground/70 leading-relaxed">{project.scope}</p>
            </div>
          )}
        </div>

        {/* Objectives */}
        {objectives.length > 0 && (
          <div>
            <p className="label-sm mb-3">Objetivos</p>
            <ul className="space-y-2">
              {objectives.map((obj: string, i: number) => (
                <li key={i} className="flex items-start gap-2.5 text-[13px] text-foreground/70">
                  <div className="w-1 h-1 rounded-full bg-primary mt-2 shrink-0" />
                  {obj}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Current milestone */}
        {activeMilestone && (
          <div className="bg-primary/[0.04] border border-primary/15 rounded-xl p-5">
            {/* Header */}
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
                <Target className="w-4 h-4 text-primary" />
              </div>
              <div>
                <span className="text-[12px] font-semibold text-foreground block">Etapa Atual</span>
                <span className="text-[10px] text-muted-foreground">
                  {completedMilestones.length} de {allMilestones.length} etapas concluídas
                </span>
              </div>
            </div>

            {/* Milestone title */}
            <p className="text-[14px] font-semibold text-foreground">{activeMilestone.title}</p>

            {/* Description */}
            {activeMilestone.description && (
              <p className="text-[12px] text-muted-foreground mt-2 leading-relaxed">
                {activeMilestone.description}
              </p>
            )}

            {/* Meta info */}
            <div className="flex items-center gap-4 mt-4 pt-3 border-t border-primary/10">
              <div className="flex items-center gap-1.5">
                <Clock className="w-3 h-3 text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground">
                  Prazo: <span className="text-foreground font-medium">{formatDateFull(activeMilestone.target_date)}</span>
                </span>
              </div>
              {activeMilestone.target_date && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  daysUntil(activeMilestone.target_date) < 0
                    ? "bg-destructive/10 text-destructive"
                    : daysUntil(activeMilestone.target_date) <= 7
                    ? "bg-amber-500/10 text-amber-400"
                    : "bg-emerald-500/10 text-emerald-400"
                }`}>
                  {daysUntil(activeMilestone.target_date) < 0
                    ? `${Math.abs(daysUntil(activeMilestone.target_date))}d em atraso`
                    : daysUntil(activeMilestone.target_date) === 0
                    ? "Prazo hoje"
                    : `${daysUntil(activeMilestone.target_date)}d restantes`}
                </span>
              )}
            </div>

            {/* Progress mini bar */}
            {allMilestones.length > 1 && (
              <div className="mt-3">
                <div className="h-1.5 w-full rounded-full bg-primary/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${(completedMilestones.length / allMilestones.length) * 100}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Milestones mini timeline */}
        {allMilestones.length > 0 && (
          <div>
            <p className="label-sm mb-3">Progresso das Etapas</p>
            <div className="space-y-2">
              {allMilestones.slice(0, 6).map((m: any, i: number) => {
                const isDone = m.status === "completed";
                const isActive = m.status === "in_progress";
                return (
                  <div key={m.id} className="flex items-center gap-3">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                      isDone ? "bg-emerald-500/15 border border-emerald-500/40"
                        : isActive ? "bg-primary/15 border border-primary/40"
                        : "bg-secondary border border-border"
                    }`}>
                      {isDone ? <CircleCheck className="w-3 h-3 text-emerald-400" />
                        : isActive ? <CircleDot className="w-3 h-3 text-primary" />
                        : <Circle className="w-3 h-3 text-muted-foreground/40" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[12px] ${isDone ? "text-emerald-400 line-through decoration-emerald-500/30" : isActive ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                        {m.title}
                      </p>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">{formatDateShort(m.target_date)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Recently completed tasks */}
        {recentDone.length > 0 && (
          <div>
            <p className="label-sm mb-3">Tarefas Concluídas Recentemente</p>
            <div className="bg-card border border-border rounded-xl divide-y divide-border">
              {recentDone.map((t: any) => (
                <div key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-foreground truncate">{t.title}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {t.assignee?.full_name && `${t.assignee.full_name} · `}{relativeTime(t.updated_at)}
                    </p>
                  </div>
                </div>
              ))}
              {doneTasks.length > 6 && (
                <div className="px-4 py-2 text-center">
                  <span className="text-[10px] text-muted-foreground">e mais {doneTasks.length - 6} concluídas</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Right col 40% */}
      <div className="lg:col-span-2 space-y-4">
        {/* Info card */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <p className="label-sm mb-1">Informações</p>
          <div className="space-y-2.5 text-[13px]">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Início</span>
              <span className="text-foreground">{formatDateFull(project.start_date)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Prazo</span>
              <span className="text-foreground">{formatDateFull(project.deadline)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Progresso</span>
              <span className="text-foreground font-mono">{project.progress}%</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Status</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${statusBadge[project.status] || "bg-muted text-muted-foreground"}`}>
                {project.status}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Tipo</span>
              <span className="text-xs text-foreground">{typeLabels[project.project_type] || project.project_type}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Total de tarefas</span>
              <span className="text-xs text-foreground font-mono">{totalTasks}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Tarefas concluídas</span>
              <span className="text-xs text-emerald-400 font-mono">{doneTasks.length}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Em execução</span>
              <span className="text-xs text-sky-400 font-mono">{doingTasks.length}</span>
            </div>
            {reviewTasks.length > 0 && (
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Em revisão</span>
                <span className="text-xs text-amber-400 font-mono">{reviewTasks.length}</span>
              </div>
            )}
          </div>
        </div>

        {/* Team card */}
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="label-sm mb-3">Equipe do Projeto</p>
          {memberTaskCounts.length === 0 ? (
            <p className="text-xs text-muted-foreground">Equipe não atribuída</p>
          ) : (
            <div className="space-y-3">
              {memberTaskCounts.map((member: any, i: number) => (
                <div key={i} className="flex items-center gap-3">
                  <Avatar className="w-8 h-8">
                    <AvatarFallback className="text-[10px] bg-secondary text-muted-foreground font-medium">
                      {member.full_name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-foreground">{member.full_name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {member.doing > 0 && `${member.doing} em execução · `}
                      {member.done}/{member.total} concluídas
                    </p>
                  </div>
                  {member.doing > 0 && (
                    <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent updates */}
        {recentUpdates.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-5">
            <p className="label-sm mb-3">Últimas Atualizações</p>
            <div className="space-y-0">
              {recentUpdates.map((u: any) => {
                const Icon = updateIcons[u.update_type] || Zap;
                return (
                  <div key={u.id} className="flex gap-2.5 py-2 border-b border-border/50 last:border-0">
                    <div className="w-6 h-6 rounded-md bg-secondary flex items-center justify-center shrink-0 mt-0.5">
                      <Icon className="w-3 h-3 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] text-foreground/85 line-clamp-2">{u.message}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {u.author?.full_name && `${u.author.full_name} · `}{relativeTime(u.created_at)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Backlog preview */}
        {backlogTasks.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Hourglass className="w-3.5 h-3.5 text-muted-foreground" />
              <p className="label-sm">Próximas Tarefas</p>
              <span className="ml-auto text-[10px] text-muted-foreground bg-secondary px-2 py-0.5 rounded-full tabular-nums">{backlogTasks.length}</span>
            </div>
            <div className="space-y-2">
              {backlogTasks.slice(0, 4).map((t: any) => (
                <div key={t.id} className="flex items-center gap-2">
                  <Circle className="w-3 h-3 text-muted-foreground/30 shrink-0" />
                  <p className="text-[11px] text-foreground/60 truncate flex-1">{t.title}</p>
                  {t.due_date && <span className="text-[9px] text-muted-foreground shrink-0">{formatDateShort(t.due_date)}</span>}
                </div>
              ))}
              {backlogTasks.length > 4 && (
                <p className="text-[10px] text-muted-foreground text-center">e mais {backlogTasks.length - 4}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
