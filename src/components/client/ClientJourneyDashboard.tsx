import CircularProgress from "./CircularProgress";
import { Skeleton } from "@/components/ui/skeleton";
import AutoSummaryCard from "./AutoSummaryCard";
import {
  CheckCircle2, Clock, AlertCircle, FileCheck, TrendingUp,
  Zap, Target, CalendarDays, MessageSquare,
  ArrowUpRight, Layers, Activity, Award, BarChart3,
  PackageCheck, ListChecks, Sparkles, Timer, Briefcase,
  CircleCheck, CircleDot, Circle, FileImage, BookOpen,
  ClipboardList, Eye, FolderOpen,
} from "lucide-react";
import { useClientDashboardData, typeLabels, relativeTime, daysUntil, formatDate, formatDateShort, type DashboardData } from "./dashboardHelpers";

const updateIcons: Record<string, typeof Activity> = {
  creative: FileImage, task: CheckCircle2, alert: AlertCircle,
  milestone: Target, system: Zap, report: TrendingUp,
};

interface Props {
  clientId: string;
  clientName: string;
  onSelectProject: (p: any) => void;
  isImpersonation?: boolean;
}

export default function ClientJourneyDashboard({ clientId, clientName, onSelectProject, isImpersonation }: Props) {
  const { loadingProjects, data } = useClientDashboardData(clientId);

  const {
    projects: allProjects, activeProjects, doneProjects, avgProgress,
    tasks, doingTasks, reviewTasks, doneTasks, totalTasks,
    milestones, completedMilestonesCount, totalMilestones,
    pendingFiles, deliveredFiles, approvedFiles, totalFiles,
    recentUpdates,
  } = data;

  const recentlyDoneTasks = doneTasks.slice(0, 5);
  const firstName = clientName.split(" ")[0];

  if (loadingProjects) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Skeleton className="h-36 w-full rounded-2xl" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-8">

      {/* ══════════ HERO ══════════ */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 sm:p-8">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.06] via-transparent to-primary/[0.02]" />
        <div className="absolute top-0 right-0 w-96 h-96 bg-primary/[0.04] rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-primary/[0.03] rounded-full blur-2xl translate-y-1/2 -translate-x-1/4" />

        <div className="relative z-10 flex items-start justify-between gap-4">
          <div className="flex-1">
            <p className="text-muted-foreground text-xs uppercase tracking-widest mb-2 flex items-center gap-2">
              <CalendarDays className="w-3 h-3" />
              {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
            </p>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-3">
              Bem-vindo de volta, {firstName}
            </h1>

            <p className="text-muted-foreground text-sm max-w-lg leading-relaxed">
              {activeProjects.length === 0 && doneProjects.length === 0
                ? "Seu painel está limpo. Novos projetos aparecerão aqui assim que forem criados."
                : <>
                    {activeProjects.length > 0 && (
                      <>{activeProjects.length === 1 ? "1 projeto ativo" : `${activeProjects.length} projetos ativos`} com {avgProgress}% de progresso. </>
                    )}
                    {doingTasks.length > 0 && <>{doingTasks.length} {doingTasks.length === 1 ? "tarefa sendo executada" : "tarefas sendo executadas"} agora. </>}
                    {pendingFiles.length > 0 && <>{pendingFiles.length} {pendingFiles.length === 1 ? "entrega aguarda" : "entregas aguardam"} sua aprovação.</>}
                  </>
              }
            </p>

            {totalTasks > 0 && (
              <div className="flex flex-wrap gap-2 mt-4">
                {doneTasks.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium bg-emerald-500/10 text-emerald-400 px-2.5 py-1 rounded-full">
                    <CheckCircle2 className="w-3 h-3" />
                    {doneTasks.length} tarefas concluídas
                  </span>
                )}
                {totalFiles > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium bg-primary/10 text-primary px-2.5 py-1 rounded-full">
                    <PackageCheck className="w-3 h-3" />
                    {totalFiles} {totalFiles === 1 ? "arquivo entregue" : "arquivos entregues"}
                  </span>
                )}
                {completedMilestonesCount > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium bg-sky-500/10 text-sky-400 px-2.5 py-1 rounded-full">
                    <Target className="w-3 h-3" />
                    {completedMilestonesCount}/{totalMilestones} etapas concluídas
                  </span>
                )}
              </div>
            )}
          </div>

          {activeProjects.length > 0 && (
            <div className="hidden sm:flex flex-col items-center gap-1.5 shrink-0">
              <CircularProgress progress={avgProgress} size={80} strokeWidth={5} />
              <span className="text-[10px] text-muted-foreground">Progresso geral</span>
            </div>
          )}
        </div>
      </div>

      {/* ══════════ METRICS ══════════ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[
          { label: "Projetos Ativos", value: activeProjects.length, sub: doneProjects.length > 0 ? `+${doneProjects.length} concluídos` : "", icon: Briefcase, color: "text-primary", bg: "bg-primary/10" },
          { label: "Tarefas em Execução", value: doingTasks.length + reviewTasks.length, sub: `de ${totalTasks} no total`, icon: ListChecks, color: "text-sky-400", bg: "bg-sky-500/10" },
          { label: "Entregas Realizadas", value: totalFiles, sub: approvedFiles > 0 ? `${approvedFiles} aprovadas` : "", icon: PackageCheck, color: "text-emerald-400", bg: "bg-emerald-500/10" },
          { label: "Aprovações Pendentes", value: pendingFiles.length, sub: pendingFiles.length > 0 ? "Ação necessária" : "Nenhuma pendência", icon: FileCheck, color: "text-amber-400", bg: "bg-amber-500/10" },
        ].map((stat) => (
          <div key={stat.label} className="bg-card border border-border rounded-xl p-4 sm:p-5 hover:border-border/80 transition-colors group">
            <div className="flex items-center justify-between mb-2">
              <div className={`w-9 h-9 rounded-lg ${stat.bg} flex items-center justify-center transition-transform group-hover:scale-105`}>
                <stat.icon className={`w-4.5 h-4.5 ${stat.color}`} />
              </div>
              <span className="text-2xl font-bold text-foreground tabular-nums">{stat.value}</span>
            </div>
            <p className="text-[11px] sm:text-xs text-muted-foreground">{stat.label}</p>
            {stat.sub && <p className="text-[10px] text-muted-foreground/60 mt-0.5">{stat.sub}</p>}
          </div>
        ))}
      </div>

      {/* ══════════ AUTO SUMMARY ══════════ */}
      <AutoSummaryCard data={data} firstName={firstName} />

      {/* ══════════ MAIN GRID ══════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* LEFT COLUMN */}
        <div className="lg:col-span-2 space-y-6">

          {/* Active Projects */}
          {activeProjects.length > 0 && (
            <section>
              <SectionHeader icon={Activity} color="text-primary" title="Projetos em Andamento" count={activeProjects.length} />
              <div className="space-y-3">
                {activeProjects.map((p: any) => {
                  const projectTasks = tasks.filter((t: any) => t.project_id === p.id);
                  const projectDoing = projectTasks.filter((t: any) => t.status === "doing" || t.status === "review");
                  const projectDone = projectTasks.filter((t: any) => t.status === "done");
                  const projectTotal = projectTasks.length;
                  const dl = daysUntil(p.deadline);
                  return (
                    <div
                      key={p.id}
                      onClick={() => onSelectProject(p)}
                      className="group bg-card border border-border rounded-xl p-5 cursor-pointer hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 transition-all duration-200"
                    >
                      <div className="flex items-start gap-4">
                        <div className="shrink-0 mt-0.5">
                          <CircularProgress progress={p.progress} size={56} strokeWidth={4} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <StatusDot status={p.status} />
                            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                              {typeLabels[p.project_type] || p.project_type}
                            </span>
                          </div>
                          <p className="text-sm font-semibold text-foreground truncate">{p.name}</p>

                          {/* Description */}
                          {p.description && (
                            <p className="text-[11px] text-muted-foreground/70 mt-1 line-clamp-2 leading-relaxed">{p.description}</p>
                          )}

                          {/* Task stats */}
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2.5 text-[11px] text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Zap className="w-3 h-3 text-sky-400" />
                              {projectDoing.length} em execução
                            </span>
                            <span className="flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                              {projectDone.length}/{projectTotal} concluídas
                            </span>
                            <span className={`flex items-center gap-1 ${dl <= 7 && dl >= 0 ? "text-amber-400" : dl < 0 ? "text-destructive" : ""}`}>
                              <Timer className="w-3 h-3" />
                              {dl < 0 ? `${Math.abs(dl)}d atrasado` : dl === 0 ? "Prazo hoje" : `${dl}d restantes`}
                            </span>
                          </div>

                          {/* Progress bar */}
                          <div className="h-1.5 w-full rounded-full bg-secondary mt-3 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-primary to-primary/70 transition-all duration-700 ease-out"
                              style={{ width: `${p.progress}%` }}
                            />
                          </div>

                          {/* Currently doing */}
                          {projectDoing.length > 0 && (
                            <div className="mt-2.5 flex flex-col gap-1">
                              {projectDoing.slice(0, 2).map((t: any) => (
                                <span key={t.id} className="text-[11px] text-primary/80 flex items-center gap-1.5 truncate">
                                  <Sparkles className="w-3 h-3 shrink-0" />
                                  {t.title}
                                  {t.assignee?.full_name && <span className="text-muted-foreground/50 ml-1">por {t.assignee.full_name}</span>}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Objectives if available */}
                          {p.objectives && (
                            <div className="mt-3 pt-2.5 border-t border-border/50">
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">Objetivo</p>
                              <p className="text-[11px] text-foreground/60 line-clamp-2 leading-relaxed">{p.objectives}</p>
                            </div>
                          )}
                        </div>
                        <ArrowUpRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-2" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Journey Timeline */}
          {milestones.length > 0 && (
            <section>
              <SectionHeader icon={Target} color="text-sky-400" title="Jornada do Projeto" count={totalMilestones} />
              <div className="bg-card border border-border rounded-xl p-5">
                <div className="relative">
                  <div className="absolute left-[15px] top-2 bottom-2 w-[2px] bg-gradient-to-b from-primary/40 via-border to-border" />
                  <div className="space-y-1">
                    {milestones.map((m: any, i: number) => {
                      const isDone = m.status === "completed";
                      const isActive = m.status === "in_progress" || (!isDone && i === 0);
                      return (
                        <div key={m.id} className="flex gap-4 py-2.5 relative">
                          <div className={`w-[32px] h-[32px] rounded-full flex items-center justify-center shrink-0 z-10 transition-all ${
                            isDone ? "bg-emerald-500/15 border-2 border-emerald-500"
                              : isActive ? "bg-primary/15 border-2 border-primary animate-pulse"
                              : "bg-card border-2 border-border"
                          }`}>
                            {isDone ? <CircleCheck className="w-3.5 h-3.5 text-emerald-400" />
                              : isActive ? <CircleDot className="w-3.5 h-3.5 text-primary" />
                              : <Circle className="w-3.5 h-3.5 text-muted-foreground/40" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-[13px] font-medium ${isDone ? "text-emerald-400 line-through decoration-emerald-500/30" : isActive ? "text-foreground" : "text-foreground/50"}`}>
                              {m.title}
                            </p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              {(m as any).project?.name} · {formatDateShort(m.target_date)}
                              {isDone && " · Concluído"}
                            </p>
                            {m.description && !isDone && (
                              <p className="text-[11px] text-muted-foreground/60 mt-1 line-clamp-1">{m.description}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {totalMilestones > 0 && (
                  <div className="mt-4 pt-3 border-t border-border flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-700"
                        style={{ width: `${(completedMilestonesCount / totalMilestones) * 100}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                      {completedMilestonesCount}/{totalMilestones} etapas
                    </span>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Recently completed tasks */}
          {recentlyDoneTasks.length > 0 && (
            <section>
              <SectionHeader icon={CheckCircle2} color="text-emerald-400" title="Concluídos Recentemente" />
              <div className="bg-card border border-border rounded-xl divide-y divide-border">
                {recentlyDoneTasks.map((t: any) => (
                  <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-foreground truncate">{t.title}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {t.project?.name} · {relativeTime(t.updated_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Completed Projects */}
          {doneProjects.length > 0 && (
            <section>
              <SectionHeader icon={Award} color="text-emerald-400" title="Projetos Concluídos" count={doneProjects.length} />
              <div className="space-y-2">
                {doneProjects.map((p: any) => (
                  <div
                    key={p.id}
                    onClick={() => onSelectProject(p)}
                    className="group bg-card border border-border rounded-xl p-4 cursor-pointer hover:border-emerald-500/20 hover:shadow-md transition-all duration-200"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                        <Award className="w-5 h-5 text-emerald-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {typeLabels[p.project_type] || p.project_type} · Finalizado em {formatDate(p.deadline)}
                        </p>
                      </div>
                      <span className="text-[10px] font-semibold text-emerald-500 bg-emerald-500/10 px-2.5 py-1 rounded-md shrink-0">
                        Entregue
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {allProjects.length === 0 && (
            <div className="bg-card border border-border rounded-xl p-10 text-center">
              <Layers className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Nenhum projeto encontrado ainda.</p>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-6">

          {/* What's happening now */}
          {doingTasks.length > 0 && (
            <div className="bg-primary/[0.04] border border-primary/15 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center">
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                </div>
                <h3 className="text-sm font-semibold text-foreground">Trabalhando Agora</h3>
              </div>
              <div className="space-y-2.5">
                {doingTasks.slice(0, 5).map((t: any) => (
                  <div key={t.id} className="flex items-start gap-2.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0 animate-pulse" />
                    <div className="min-w-0">
                      <p className="text-[12px] text-foreground truncate">{t.title}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {t.project?.name}
                        {t.assignee?.full_name && ` · ${t.assignee.full_name}`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Overview of all tasks */}
          {totalTasks > 0 && (
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-6 h-6 rounded-md bg-sky-500/10 flex items-center justify-center">
                  <ClipboardList className="w-3.5 h-3.5 text-sky-400" />
                </div>
                <h3 className="text-sm font-semibold text-foreground">Visão Geral das Tarefas</h3>
              </div>
              {(() => {
                const backlog = tasks.filter((t: any) => t.status === "backlog" || t.status === "todo").length;
                const doing = doingTasks.length;
                const review = reviewTasks.length;
                const done = doneTasks.length;
                const segments = [
                  { label: "Concluídas", value: done, color: "bg-emerald-500", textColor: "text-emerald-400" },
                  { label: "Em revisão", value: review, color: "bg-amber-400", textColor: "text-amber-400" },
                  { label: "Em execução", value: doing, color: "bg-sky-400", textColor: "text-sky-400" },
                  { label: "Planejadas", value: backlog, color: "bg-muted-foreground/30", textColor: "text-muted-foreground" },
                ];
                return (
                  <>
                    <div className="h-2 w-full rounded-full bg-secondary overflow-hidden flex">
                      {segments.map((s) => (
                        s.value > 0 && (
                          <div
                            key={s.label}
                            className={`h-full ${s.color} transition-all duration-500`}
                            style={{ width: `${(s.value / totalTasks) * 100}%` }}
                          />
                        )
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-3">
                      {segments.map((s) => (
                        <div key={s.label} className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${s.color} shrink-0`} />
                          <span className="text-[11px] text-muted-foreground">{s.label}</span>
                          <span className={`text-[11px] font-semibold ${s.textColor} ml-auto tabular-nums`}>{s.value}</span>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* Pending approvals */}
          {pendingFiles.length > 0 && (
            <div className="bg-amber-500/[0.04] border border-amber-500/15 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-md bg-amber-500/10 flex items-center justify-center">
                  <FileCheck className="w-3.5 h-3.5 text-amber-400" />
                </div>
                <h3 className="text-sm font-semibold text-foreground">Aguardando Aprovação</h3>
              </div>
              <div className="space-y-2.5">
                {pendingFiles.map((f: any) => (
                  <div key={f.id} className="flex items-start gap-2.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[12px] text-foreground truncate">{f.file_name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {(f as any).project?.name} · {relativeTime(f.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Activity feed */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center">
                <BarChart3 className="w-3.5 h-3.5 text-primary" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">Atividade Recente</h3>
            </div>
            {recentUpdates.length === 0 ? (
              <div className="py-6 text-center">
                <MessageSquare className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-[12px] text-muted-foreground">Nenhuma atualização ainda.</p>
              </div>
            ) : (
              <div className="space-y-0">
                {recentUpdates.map((u: any) => {
                  const Icon = updateIcons[u.update_type] || Zap;
                  return (
                    <div key={u.id} className="flex gap-3 py-2.5 border-b border-border/50 last:border-0">
                      <div className="w-7 h-7 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] text-foreground/90 line-clamp-2">{u.message}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {u.project?.name} · {relativeTime(u.created_at)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────── Sub-components ───────── */

function SectionHeader({ icon: Icon, color, title, count }: { icon: typeof Activity; color: string; title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Icon className={`w-4 h-4 ${color}`} />
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {count !== undefined && (
        <span className="text-[10px] text-muted-foreground bg-secondary px-2 py-0.5 rounded-full ml-1 tabular-nums">
          {count}
        </span>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: "bg-emerald-500 shadow-[0_0_6px] shadow-emerald-500/40",
    review: "bg-amber-400",
    planning: "bg-sky-400",
    done: "bg-emerald-500",
    paused: "bg-muted-foreground",
  };
  return <div className={`w-2 h-2 rounded-full shrink-0 ${styles[status] || "bg-muted-foreground"}`} />;
}
