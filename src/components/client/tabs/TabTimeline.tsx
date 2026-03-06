import { useMilestones, useTasks } from "@/hooks/useSupabaseData";
import {
  Check, ChevronDown, ChevronLeft, ChevronRight,
  Target, Sparkles, Clock, CalendarCheck, Zap,
  TrendingUp, Users, CheckCircle2, CircleDot, Circle,
  ArrowRight, Star, Activity,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { BarChart, Bar, ResponsiveContainer, Tooltip, XAxis } from "recharts";

const PAGE_SIZE = 4;

const statusLabels: Record<string, string> = {
  completed: "Concluída",
  in_progress: "Em andamento",
  pending: "A iniciar",
};

const statusColors: Record<string, { bg: string; text: string; border: string }> = {
  completed: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" },
  in_progress: { bg: "bg-primary/10", text: "text-primary", border: "border-primary/20" },
  pending: { bg: "bg-secondary", text: "text-muted-foreground", border: "border-border" },
};

const taskStatusConfig: Record<string, { label: string; dot: string; icon: typeof Check }> = {
  backlog: { label: "Planejada", dot: "bg-muted-foreground/40", icon: Circle },
  todo: { label: "Planejada", dot: "bg-muted-foreground/40", icon: Circle },
  doing: { label: "Em execução", dot: "bg-sky-400", icon: Sparkles },
  review: { label: "Em revisão", dot: "bg-amber-400", icon: CircleDot },
  approved: { label: "Aprovada", dot: "bg-primary", icon: CheckCircle2 },
  done: { label: "Concluída", dot: "bg-emerald-500", icon: CheckCircle2 },
};

export default function TabTimeline({ projectId }: { projectId: string }) {
  const { data: milestones, isLoading: loadingMilestones } = useMilestones(projectId);
  const { data: tasks, isLoading: loadingTasks } = useTasks(projectId);
  const [expandedMilestone, setExpandedMilestone] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);

  const formatDate = (d: string) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  };

  const formatDateShort = (d: string) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  };

  const daysUntil = (d: string) => {
    if (!d) return null;
    return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
  };

  // Group tasks by milestone_id
  const tasksByMilestone: Record<string, any[]> = useMemo(() => {
    const map: Record<string, any[]> = {};
    (tasks || []).forEach((t: any) => {
      if (t.milestone_id) {
        if (!map[t.milestone_id]) map[t.milestone_id] = [];
        map[t.milestone_id].push(t);
      }
    });
    return map;
  }, [tasks]);

  // Global stats
  const stats = useMemo(() => {
    const all = milestones || [];
    const completed = all.filter((m: any) => m.status === "completed").length;
    const allTasks = tasks || [];
    const doneTasks = allTasks.filter((t: any) => t.status === "done").length;
    const totalTasks = allTasks.length;
    return { total: all.length, completed, allTasks: totalTasks, doneTasks };
  }, [milestones, tasks]);

  // Weekly delivery velocity (last 8 weeks)
  const weeklyVelocity = useMemo(() => {
    const doneTasks = (tasks || []).filter((t: any) => t.status === "done" && t.updated_at);
    const now = new Date();
    const weeks: { label: string; count: number }[] = [];

    for (let w = 7; w >= 0; w--) {
      const weekStart = new Date(now);
      weekStart.setDate(weekStart.getDate() - w * 7);
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);

      const count = doneTasks.filter((t: any) => {
        const d = new Date(t.updated_at);
        return d >= weekStart && d < weekEnd;
      }).length;

      const label = weekStart.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
      weeks.push({ label, count });
    }
    return weeks;
  }, [tasks]);

  if (loadingMilestones || loadingTasks) {
    return (
      <div className="space-y-4 py-4">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
      </div>
    );
  }

  if (!milestones?.length) {
    return (
      <div className="text-center py-16">
        <Target className="w-10 h-10 text-muted-foreground/20 mx-auto mb-4" />
        <p className="text-sm text-muted-foreground">O cronograma será montado em breve.</p>
        <p className="text-[11px] text-muted-foreground/50 mt-1">As etapas do projeto aparecerão aqui conforme forem definidas.</p>
      </div>
    );
  }

  const lastCompletedIdx = milestones.reduce((acc: number, m: any, i: number) => m.status === "completed" ? i : acc, -1);
  const visibleMilestones = milestones.slice(pageIndex, pageIndex + PAGE_SIZE);
  const canGoPrev = pageIndex > 0;
  const canGoNext = pageIndex + PAGE_SIZE < milestones.length;
  const progressPct = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

  return (
    <motion.div
      className="space-y-6"
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.1, delayChildren: 0.05 } } }}
    >

      {/* ═══════ HERO HEADER ═══════ */}
      <motion.div
        variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] } } }}
        className="relative overflow-hidden rounded-2xl border border-border bg-card"
      >
        {/* Background decorative gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.03] via-transparent to-emerald-500/[0.02] pointer-events-none" />

        <div className="relative p-5 sm:p-6">
          <div className="flex items-start gap-4 mb-5">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Target className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-[15px] font-semibold text-foreground mb-1">Cronograma do Projeto</h3>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Cada etapa representa uma fase importante do seu projeto. Acompanhe o progresso 
                de perto e veja como a equipe avança em cada entrega.
              </p>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-secondary/50 rounded-xl px-3.5 py-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <CalendarCheck className="w-3.5 h-3.5 text-primary" />
              </div>
              <p className="text-[18px] font-bold text-foreground tabular-nums">{stats.total}</p>
              <p className="text-[10px] text-muted-foreground">Etapas planejadas</p>
            </div>
            <div className="bg-emerald-500/[0.06] rounded-xl px-3.5 py-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <p className="text-[18px] font-bold text-emerald-400 tabular-nums">{stats.completed}</p>
              <p className="text-[10px] text-muted-foreground">Concluídas</p>
            </div>
            <div className="bg-sky-400/[0.06] rounded-xl px-3.5 py-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Zap className="w-3.5 h-3.5 text-sky-400" />
              </div>
              <p className="text-[18px] font-bold text-foreground tabular-nums">{stats.doneTasks}</p>
              <p className="text-[10px] text-muted-foreground">Tarefas concluídas</p>
            </div>
            <div className="bg-primary/[0.06] rounded-xl px-3.5 py-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <TrendingUp className="w-3.5 h-3.5 text-primary" />
              </div>
              <p className="text-[18px] font-bold text-primary tabular-nums">{progressPct}%</p>
              <p className="text-[10px] text-muted-foreground">Progresso geral</p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-4">
            <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-emerald-500 transition-all duration-700"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-[10px] text-muted-foreground">Início</span>
              <span className="text-[10px] text-muted-foreground">Conclusão</span>
            </div>
          </div>
        </div>
      </motion.div>

      {/* ═══════ DELIVERY VELOCITY CHART ═══════ */}
      {weeklyVelocity.some(w => w.count > 0) && (
        <motion.div
          variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] } } }}
          className="bg-card border border-border rounded-xl p-5"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg bg-sky-400/10 flex items-center justify-center shrink-0">
              <Activity className="w-4 h-4 text-sky-400" />
            </div>
            <div>
              <p className="text-[13px] font-semibold text-foreground">Ritmo de Entregas</p>
              <p className="text-[10px] text-muted-foreground">Tarefas concluídas por semana nas últimas 8 semanas</p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-[16px] font-bold text-foreground tabular-nums">
                {Math.round(weeklyVelocity.reduce((s, w) => s + w.count, 0) / Math.max(weeklyVelocity.filter(w => w.count > 0).length, 1))}
              </p>
              <p className="text-[9px] text-muted-foreground">média/semana</p>
            </div>
          </div>
          <div className="h-[100px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyVelocity} barCategoryGap="20%">
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: "hsl(var(--secondary))" }}
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 11,
                    padding: "6px 10px",
                  }}
                  formatter={(value: number) => [`${value} tarefa${value !== 1 ? "s" : ""}`, "Concluídas"]}
                  labelFormatter={(label) => `Semana de ${label}`}
                />
                <Bar
                  dataKey="count"
                  fill="hsl(var(--primary))"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      )}

      {/* ═══════ FLOW DIRECTION INDICATOR ═══════ */}
      <motion.div
        variants={{ hidden: { opacity: 0, x: -12 }, show: { opacity: 1, x: 0, transition: { duration: 0.35 } } }}
        className="flex items-center gap-2 px-2"
      >
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
          <ArrowRight className="w-3 h-3" />
          <span>O projeto avança por cada etapa, da esquerda para a direita</span>
        </div>
      </motion.div>

      {/* ═══════ MILESTONE CARDS ═══════ */}
      <div className="space-y-3">
        {visibleMilestones.map((m: any, i: number) => {
          const globalIdx = pageIndex + i;
          const milestoneTasks = tasksByMilestone[m.id] || [];
          const doneTasks = milestoneTasks.filter((t: any) => t.status === "done").length;
          const doingTasks = milestoneTasks.filter((t: any) => t.status === "doing" || t.status === "review").length;
          const totalTasks = milestoneTasks.length;
          const progress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
          const isExpanded = expandedMilestone === m.id;
          const sc = statusColors[m.status] || statusColors.pending;
          const dl = daysUntil(m.target_date);
          const isOverdue = dl !== null && dl < 0 && m.status !== "completed";

          // Unique team members on this milestone
          const teamMap = new Map();
          milestoneTasks.forEach((t: any) => {
            if (t.assigned_to && t.assignee) teamMap.set(t.assigned_to, t.assignee);
          });
          const team = Array.from(teamMap.values());

          return (
            <motion.div
              key={m.id}
              className="relative"
              variants={{ hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] } } }}
            >
              {/* Connecting line */}
              {i < visibleMilestones.length - 1 && (
                <div
                  className={`absolute left-[19px] top-[44px] w-[2px] ${
                    globalIdx <= lastCompletedIdx ? "bg-emerald-500/40" : "bg-border"
                  }`}
                  style={{ height: "calc(100% - 8px)" }}
                />
              )}

              {/* Main card */}
              <div className={`relative rounded-xl border ${sc.border} ${m.status === "in_progress" ? "bg-primary/[0.02]" : "bg-card"} transition-all hover:shadow-sm`}>
                {/* Active glow */}
                {m.status === "in_progress" && (
                  <div className="absolute inset-0 rounded-xl border border-primary/20 animate-pulse pointer-events-none" />
                )}

                <button
                  onClick={() => setExpandedMilestone(isExpanded ? null : m.id)}
                  className="w-full text-left cursor-pointer bg-transparent border-none p-0"
                >
                  <div className="p-4 sm:p-5">
                    <div className="flex items-start gap-4">
                      {/* Node */}
                      <div className="shrink-0 mt-0.5">
                        {m.status === "completed" ? (
                          <div className="w-[38px] h-[38px] rounded-full bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                            <Check className="w-5 h-5 text-white" />
                          </div>
                        ) : m.status === "in_progress" ? (
                          <div className="w-[38px] h-[38px] rounded-full border-[3px] border-primary bg-primary/10 flex items-center justify-center">
                            <Sparkles className="w-4 h-4 text-primary animate-pulse" />
                          </div>
                        ) : (
                          <div className="w-[38px] h-[38px] rounded-full bg-secondary border border-border flex items-center justify-center">
                            <Circle className="w-4 h-4 text-muted-foreground/30" />
                          </div>
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1.5">
                          <span className="text-[10px] text-muted-foreground/60 font-mono">Etapa {globalIdx + 1}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${sc.bg} ${sc.text}`}>
                            {statusLabels[m.status]}
                          </span>
                          {m.status === "in_progress" && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium flex items-center gap-1">
                              <Star className="w-2.5 h-2.5" /> Etapa atual
                            </span>
                          )}
                          {isOverdue && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium">
                              {Math.abs(dl!)}d em atraso
                            </span>
                          )}
                        </div>

                        <p className="text-[14px] font-semibold text-foreground leading-snug mb-1">{m.title}</p>

                        {m.description && (
                          <p className="text-[12px] text-muted-foreground/70 leading-relaxed mb-3 line-clamp-2">{m.description}</p>
                        )}

                        {/* Meta row */}
                        <div className="flex items-center flex-wrap gap-x-4 gap-y-2">
                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <Clock className="w-3 h-3" />
                            <span>Prazo: <span className="text-foreground font-medium">{formatDate(m.target_date)}</span></span>
                          </div>

                          {totalTasks > 0 && (
                            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                              <CheckCircle2 className="w-3 h-3" />
                              <span>{doneTasks}/{totalTasks} tarefas</span>
                              {doingTasks > 0 && (
                                <span className="text-sky-400">({doingTasks} em execução)</span>
                              )}
                            </div>
                          )}

                          {/* Team avatars */}
                          {team.length > 0 && (
                            <div className="flex items-center gap-1.5 ml-auto">
                              <Users className="w-3 h-3 text-muted-foreground" />
                              <div className="flex -space-x-1.5">
                                {team.slice(0, 4).map((member: any, idx: number) => (
                                  <Avatar key={idx} className="w-5 h-5 border-2 border-card">
                                    <AvatarFallback className="text-[7px] bg-secondary text-muted-foreground font-medium">
                                      {member.full_name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                                    </AvatarFallback>
                                  </Avatar>
                                ))}
                                {team.length > 4 && (
                                  <span className="text-[9px] text-muted-foreground ml-1">+{team.length - 4}</span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Progress bar */}
                        {totalTasks > 0 && (
                          <div className="mt-3 flex items-center gap-3">
                            <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden flex">
                              {doneTasks > 0 && (
                                <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${(doneTasks / totalTasks) * 100}%` }} />
                              )}
                              {doingTasks > 0 && (
                                <div className="h-full bg-sky-400 transition-all duration-500" style={{ width: `${(doingTasks / totalTasks) * 100}%` }} />
                              )}
                            </div>
                            <span className="text-[11px] font-mono text-muted-foreground tabular-nums shrink-0">{progress}%</span>
                          </div>
                        )}
                      </div>

                      {/* Expand */}
                      {milestoneTasks.length > 0 && (
                        <div className="shrink-0 mt-2 text-muted-foreground/50">
                          <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} />
                        </div>
                      )}
                    </div>
                  </div>
                </button>

                {/* ─── Expanded tasks ─── */}
                {isExpanded && milestoneTasks.length > 0 && (
                  <div className="border-t border-border px-4 sm:px-5 py-3 space-y-1.5 animate-in slide-in-from-top-2 duration-200 bg-secondary/20">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[11px] font-semibold text-foreground">Tarefas desta etapa</span>
                      <span className="text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded-full font-mono">{totalTasks}</span>
                    </div>
                    {milestoneTasks
                      .sort((a: any, b: any) => {
                        const order = ["done", "approved", "review", "doing", "backlog", "todo"];
                        return order.indexOf(a.status) - order.indexOf(b.status);
                      })
                      .map((t: any) => {
                        const tc = taskStatusConfig[t.status] || taskStatusConfig.backlog;
                        const TaskIcon = tc.icon;
                        return (
                          <div key={t.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-card border border-border">
                            <div className={`w-5 h-5 rounded-md flex items-center justify-center ${
                              t.status === "done" ? "bg-emerald-500/10" :
                              t.status === "doing" ? "bg-sky-400/10" :
                              t.status === "review" ? "bg-amber-400/10" :
                              "bg-secondary"
                            }`}>
                              <TaskIcon className={`w-3 h-3 ${
                                t.status === "done" ? "text-emerald-500" :
                                t.status === "doing" ? "text-sky-400" :
                                t.status === "review" ? "text-amber-400" :
                                t.status === "approved" ? "text-primary" :
                                "text-muted-foreground/40"
                              }`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`text-[12px] font-medium leading-snug ${t.status === "done" ? "text-emerald-400 line-through decoration-emerald-500/30" : "text-foreground"}`}>
                                {t.title}
                              </p>
                            </div>
                            <span className={`text-[10px] shrink-0 px-2 py-0.5 rounded-full ${
                              t.status === "done" ? "bg-emerald-500/10 text-emerald-400" :
                              t.status === "doing" ? "bg-sky-400/10 text-sky-400" :
                              t.status === "review" ? "bg-amber-400/10 text-amber-400" :
                              "bg-secondary text-muted-foreground"
                            }`}>
                              {tc.label}
                            </span>
                            {t.assignee && (
                              <Avatar className="w-5 h-5 shrink-0">
                                <AvatarFallback className="text-[7px] bg-secondary text-muted-foreground font-medium">
                                  {t.assignee.full_name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                                </AvatarFallback>
                              </Avatar>
                            )}
                            {t.due_date && (
                              <span className="text-[9px] text-muted-foreground font-mono shrink-0">{formatDateShort(t.due_date)}</span>
                            )}
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* ═══════ CAROUSEL NAVIGATION ═══════ */}
      {milestones.length > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-4 pt-2">
          <button
            disabled={!canGoPrev}
            onClick={() => setPageIndex(Math.max(0, pageIndex - PAGE_SIZE))}
            className="w-9 h-9 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer bg-transparent"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          {/* Dot indicators */}
          <div className="flex items-center gap-1.5">
            {Array.from({ length: Math.ceil(milestones.length / PAGE_SIZE) }).map((_, idx) => (
              <button
                key={idx}
                onClick={() => setPageIndex(idx * PAGE_SIZE)}
                className={`w-2 h-2 rounded-full transition-all cursor-pointer bg-transparent border-none p-0 ${
                  idx === Math.floor(pageIndex / PAGE_SIZE)
                    ? "bg-primary w-5"
                    : "bg-muted-foreground/20 hover:bg-muted-foreground/40"
                }`}
              />
            ))}
          </div>

          <button
            disabled={!canGoNext}
            onClick={() => setPageIndex(pageIndex + PAGE_SIZE)}
            className="w-9 h-9 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer bg-transparent"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ═══════ VALUE FOOTER ═══════ */}
      <motion.div
        variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] } } }}
        className="bg-card border border-border rounded-xl p-4 sm:p-5"
      >
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <p className="text-[12px] font-semibold text-foreground mb-1">O que está sendo entregue</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {stats.completed === 0 && stats.doneTasks === 0
                ? "O projeto está sendo estruturado. Em breve as primeiras entregas começarão a ser realizadas pela equipe."
                : stats.completed === stats.total
                ? `Todas as ${stats.total} etapas foram concluídas com sucesso, totalizando ${stats.doneTasks} tarefas entregues. O projeto foi finalizado com excelência.`
                : `Já foram concluídas ${stats.completed} de ${stats.total} etapas, com ${stats.doneTasks} tarefas finalizadas. A equipe segue trabalhando para garantir qualidade em cada entrega.`
              }
            </p>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
