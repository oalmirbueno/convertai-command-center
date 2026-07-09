import { useState, useMemo } from "react";
import { StaggerContainer, FadeUp, FadeScale } from "./motion";
import {
  ArrowLeft, Activity, CheckCircle2, Zap, Timer, Target,
  Users, Calendar, Sparkles, TrendingUp, Eye, Clock,
  PackageCheck, AlertCircle, Hourglass,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import CircularProgress from "./CircularProgress";
import TabOverview from "./tabs/TabOverview";
import TabKanban from "./tabs/TabKanban";
import TabTimeline from "./tabs/TabTimeline";
import TabDeliveries from "./tabs/TabDeliveries";
import { summarizeProjectText } from "@/lib/projectPresentation";
import TabUpdates from "./tabs/TabUpdates";
import TabPayments from "./tabs/TabPayments";
import TabDocument from "./tabs/TabDocument";
import RequestButton from "./RequestButton";
import { useTasks, useMilestones, useFiles, useProjectUpdates } from "@/hooks/useSupabaseData";
import { formatDate, formatDateShort, daysUntil, relativeTime } from "./dashboardHelpers";

const statusLabels: Record<string, string> = {
  active: "Ativo",
  review: "Em Revisão",
  planning: "Planejamento",
  done: "Concluído",
  paused: "Pausado",
};

const statusColors: Record<string, { bg: string; text: string; dot: string }> = {
  active: { bg: "bg-emerald-500/10", text: "text-emerald-400", dot: "bg-emerald-500 shadow-[0_0_8px] shadow-emerald-500/40" },
  review: { bg: "bg-amber-500/10", text: "text-amber-400", dot: "bg-amber-400" },
  planning: { bg: "bg-sky-500/10", text: "text-sky-400", dot: "bg-sky-400" },
  done: { bg: "bg-emerald-500/10", text: "text-emerald-400", dot: "bg-emerald-500" },
  paused: { bg: "bg-muted", text: "text-muted-foreground", dot: "bg-muted-foreground" },
};

const NON_RECURRING_TYPES = ["automation", "site", "landing_page", "event", "other"];

const typeLabels: Record<string, string> = {
  social_media: "Social Media",
  traffic: "Tráfego",
  automation: "Automação",
  site: "Site",
  landing_page: "Landing Page",
  event: "Evento",
  other: "Outro",
};

interface ProjectViewProps {
  project: any;
  onBack: () => void;
}

export default function ProjectView({ project, onBack }: ProjectViewProps) {
  const { data: tasks } = useTasks(project.id);
  const { data: milestones } = useMilestones(project.id);
  const { data: files } = useFiles(project.id);
  const { data: updates } = useProjectUpdates(project.id);

  const allTasks = tasks || [];
  const doingTasks = allTasks.filter((t: any) => t.status === "doing");
  const reviewTasks = allTasks.filter((t: any) => t.status === "review");
  const doneTasks = allTasks.filter((t: any) => t.status === "done");
  const backlogTasks = allTasks.filter((t: any) => t.status === "backlog" || t.status === "todo");
  const totalTasks = allTasks.length;

  const allMilestones = milestones || [];
  const completedMilestones = allMilestones.filter((m: any) => m.status === "completed").length;

  const allFiles = files || [];
  const pendingFiles = allFiles.filter((f: any) => f.approval_status === "pending").length;
  const approvedFilesCount = allFiles.filter((f: any) => f.approval_status === "approved").length;

  const dl = daysUntil(project.deadline);
  const sc = statusColors[project.status] || statusColors.paused;

  // Team members
  const teamMembers = allTasks.length > 0
    ? Array.from(new Map(allTasks.filter((t: any) => t.assigned_to && t.assignee).map((t: any) => [t.assigned_to, t.assignee])).values()) as any[]
    : [];

  // Build sparkline data from task completions over time
  const sparklineData = useMemo(() => {
    if (totalTasks === 0) return [];

    // Collect completion dates from done tasks
    const completionDates = doneTasks
      .filter((t: any) => t.updated_at)
      .map((t: any) => new Date(t.updated_at))
      .sort((a, b) => a.getTime() - b.getTime());

    if (completionDates.length === 0) {
      // Return a flat line at current progress
      return [
        { date: formatDateShort(project.start_date), progress: 0 },
        { date: "Hoje", progress: project.progress },
      ];
    }

    // Build cumulative progress points
    const points: { date: string; progress: number }[] = [];
    
    // Start point
    points.push({
      date: new Date(project.start_date).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }),
      progress: 0,
    });

    // Group completions by day and accumulate
    const dayMap = new Map<string, number>();
    completionDates.forEach((d, i) => {
      const key = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
      dayMap.set(key, i + 1);
    });

    dayMap.forEach((count, dateLabel) => {
      const pct = Math.round((count / totalTasks) * 100);
      points.push({ date: dateLabel, progress: Math.min(pct, project.progress) });
    });

    // Current point
    const lastDate = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
    const lastPoint = points[points.length - 1];
    if (lastPoint.date !== lastDate) {
      points.push({ date: lastDate, progress: project.progress });
    } else {
      lastPoint.progress = project.progress;
    }

    return points;
  }, [doneTasks, totalTasks, project.progress, project.start_date]);

  return (
    <StaggerContainer className="space-y-6">
      {/* Back button */}
      <FadeUp>
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Voltar aos projetos
      </button>
      </FadeUp>

      {/* ══════════ IMMERSIVE HERO ══════════ */}
      <FadeUp>
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card">
        {/* Background effects */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.06] via-transparent to-primary/[0.02]" />
        <div className="absolute top-0 right-0 w-80 h-80 bg-primary/[0.04] rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
        <div className="absolute bottom-0 left-0 w-40 h-40 bg-primary/[0.03] rounded-full blur-2xl translate-y-1/2 -translate-x-1/4" />

        <div className="relative z-10 p-6 sm:p-8">
          {/* Top row: type + status */}
          <div className="flex items-center gap-3 mb-3">
            <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-medium">
              {typeLabels[project.project_type] || project.project_type}
            </span>
            <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full ${sc.bg} ${sc.text}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
              {statusLabels[project.status] || project.status}
            </span>
          </div>

          {/* Title + progress + sparkline */}
          <div className="flex items-start justify-between gap-6">
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">{project.name}</h1>
              {project.description && (
                <p className="text-sm text-muted-foreground/80 leading-relaxed max-w-2xl line-clamp-2">{summarizeProjectText(project.description)}</p>

              )}
            </div>
            <div className="hidden sm:flex items-end gap-4 shrink-0">
              {/* Sparkline */}
              {sparklineData.length >= 2 && (
                <div className="flex flex-col items-center gap-1">
                  <div className="w-[120px] h-[52px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={sparklineData} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
                        <defs>
                          <linearGradient id="sparkGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <Tooltip
                          contentStyle={{
                            background: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "8px",
                            fontSize: "11px",
                            padding: "6px 10px",
                          }}
                          labelStyle={{ color: "hsl(var(--muted-foreground))", fontSize: "10px" }}
                          formatter={(value: number) => [`${value}%`, "Progresso"]}
                        />
                        <XAxis dataKey="date" hide />
                        <Area
                          type="monotone"
                          dataKey="progress"
                          stroke="hsl(var(--primary))"
                          strokeWidth={2}
                          fill="url(#sparkGradient)"
                          dot={false}
                          activeDot={{ r: 3, fill: "hsl(var(--primary))", strokeWidth: 0 }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <span className="text-[9px] text-muted-foreground">Evolução</span>
                </div>
              )}
              {/* Circular progress */}
              <div className="flex flex-col items-center gap-1">
                <CircularProgress progress={project.progress} size={76} strokeWidth={5} />
                <span className="text-[10px] text-muted-foreground mt-0.5">Progresso</span>
              </div>
            </div>
          </div>

          {/* Progress bar mobile */}
          <div className="sm:hidden mt-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground">Progresso</span>
              <span className="text-[13px] font-bold text-foreground tabular-nums">{project.progress}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-primary to-primary/70 transition-all duration-700" style={{ width: `${project.progress}%` }} />
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
            <MiniStat icon={Zap} color="text-sky-400" bg="bg-sky-500/10" label="Em Execução" value={doingTasks.length + reviewTasks.length} sub={`de ${totalTasks} tarefas`} />
            <MiniStat icon={CheckCircle2} color="text-emerald-400" bg="bg-emerald-500/10" label="Concluídas" value={doneTasks.length} sub={totalTasks > 0 ? `${Math.round((doneTasks.length / totalTasks) * 100)}% do total` : ""} />
            <MiniStat icon={Target} color="text-primary" bg="bg-primary/10" label="Etapas" value={`${completedMilestones}/${allMilestones.length}`} sub={completedMilestones === allMilestones.length && allMilestones.length > 0 ? "Todas concluídas" : "em andamento"} />
            <MiniStat
              icon={dl < 0 ? AlertCircle : Timer}
              color={dl < 0 ? "text-destructive" : dl <= 7 ? "text-amber-400" : "text-muted-foreground"}
              bg={dl < 0 ? "bg-destructive/10" : dl <= 7 ? "bg-amber-500/10" : "bg-secondary"}
              label="Prazo"
              value={dl < 0 ? `${Math.abs(dl)}d atraso` : dl === 0 ? "Hoje" : `${dl} dias`}
              sub={formatDate(project.deadline)}
            />
          </div>

          {/* Dates + team row */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mt-5 pt-5 border-t border-border/50">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Calendar className="w-3.5 h-3.5" />
              Início: {formatDate(project.start_date)}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Calendar className="w-3.5 h-3.5" />
              Prazo: {formatDate(project.deadline)}
            </div>

            {allFiles.length > 0 && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <PackageCheck className="w-3.5 h-3.5" />
                {allFiles.length} {allFiles.length === 1 ? "entrega" : "entregas"}
                {approvedFilesCount > 0 && ` (${approvedFilesCount} aprovadas)`}
              </div>
            )}

            {pendingFiles > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-medium bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded-full">
                <Eye className="w-3 h-3" />
                {pendingFiles} aguardando aprovação
              </span>
            )}

            {/* Team avatars */}
            {teamMembers.length > 0 && (
              <div className="flex items-center gap-2 ml-auto">
                <Users className="w-3.5 h-3.5 text-muted-foreground" />
                <div className="flex -space-x-1.5">
                  {teamMembers.slice(0, 5).map((m: any, i: number) => (
                    <Avatar key={i} className="w-6 h-6 border-2 border-card">
                      <AvatarFallback className="text-[8px] bg-secondary text-muted-foreground font-medium">
                        {m.full_name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                  ))}
                  {teamMembers.length > 5 && (
                    <span className="text-[9px] text-muted-foreground ml-1.5">+{teamMembers.length - 5}</span>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground">{teamMembers.length} {teamMembers.length === 1 ? "membro" : "membros"}</span>
              </div>
            )}
          </div>

          {/* Live: working now */}
          {doingTasks.length > 0 && (
            <div className="mt-5 pt-4 border-t border-border/50">
              <div className="flex items-center gap-2 mb-2.5">
                <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                <span className="text-[11px] font-semibold text-primary uppercase tracking-wider">Trabalhando agora</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {doingTasks.slice(0, 4).map((t: any) => (
                  <div key={t.id} className="flex items-center gap-2.5 bg-primary/[0.04] border border-primary/10 rounded-lg px-3 py-2">
                    <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] text-foreground truncate">{t.title}</p>
                      {t.assignee?.full_name && (
                        <p className="text-[10px] text-muted-foreground">{t.assignee.full_name}</p>
                      )}
                    </div>
                    {t.due_date && (
                      <span className={`text-[9px] tabular-nums shrink-0 ${daysUntil(t.due_date) <= 3 ? "text-amber-400" : "text-muted-foreground"}`}>
                        {daysUntil(t.due_date) >= 0 ? `${daysUntil(t.due_date)}d` : "atrasada"}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Review tasks */}
          {reviewTasks.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center gap-2 mb-2">
                <Eye className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-[11px] font-medium text-muted-foreground">Em revisão ({reviewTasks.length})</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {reviewTasks.slice(0, 4).map((t: any) => (
                  <span key={t.id} className="text-[11px] bg-amber-500/[0.06] border border-amber-500/10 text-foreground/80 px-2.5 py-1 rounded-lg truncate max-w-[200px]">
                    {t.title}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      </FadeUp>

      {/* ══════════ TASK PROGRESS BAR ══════════ */}
      {totalTasks > 0 && (
        <FadeUp>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[12px] font-semibold text-foreground">Distribuição das Tarefas</span>
            <span className="text-[11px] text-muted-foreground tabular-nums">{doneTasks.length}/{totalTasks} concluídas</span>
          </div>
          <div className="h-2.5 w-full rounded-full bg-secondary overflow-hidden flex">
            {[
              { value: doneTasks.length, color: "bg-emerald-500" },
              { value: allTasks.filter((t: any) => t.status === "approved").length, color: "bg-primary" },
              { value: reviewTasks.length, color: "bg-amber-400" },
              { value: doingTasks.length, color: "bg-sky-400" },
              { value: backlogTasks.length, color: "bg-muted-foreground/30" },
            ].map((s, i) => (
              s.value > 0 && (
                <div key={i} className={`h-full ${s.color} transition-all duration-500`} style={{ width: `${(s.value / totalTasks) * 100}%` }} />
              )
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5">
            {[
              { label: "Concluídas", value: doneTasks.length, color: "bg-emerald-500" },
              { label: "Em execução", value: doingTasks.length, color: "bg-sky-400" },
              { label: "Em revisão", value: reviewTasks.length, color: "bg-amber-400" },
              { label: "Planejadas", value: backlogTasks.length, color: "bg-muted-foreground/30" },
            ].map((s) => (
              <div key={s.label} className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${s.color}`} />
                <span className="text-[10px] text-muted-foreground">{s.label}: {s.value}</span>
              </div>
            ))}
          </div>
        </div>
        </FadeUp>
      )}

      {/* ══════════ TABS ══════════ */}
      <FadeUp>
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="bg-transparent h-auto p-0 gap-8 border-b border-border rounded-none w-full justify-start overflow-x-auto">
          {[
            { value: "overview", label: "Visão Geral" },
            { value: "kanban", label: "Kanban" },
            { value: "timeline", label: "Timeline" },
            { value: "deliveries", label: "Entregas" },
            ...(NON_RECURRING_TYPES.includes(project.project_type) ? [{ value: "payments", label: "Pagamentos" }] : []),
            { value: "document", label: "Documento" },
            { value: "updates", label: "Atualizações" },
          ].map(tab => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="bg-transparent rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none text-muted-foreground text-[13px] font-normal px-0 pb-3 pt-0 hover:text-foreground/70 transition-colors whitespace-nowrap"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <TabOverview project={project} />
        </TabsContent>
        <TabsContent value="kanban" className="mt-6">
          <TabKanban projectId={project.id} />
        </TabsContent>
        <TabsContent value="timeline" className="mt-6">
          <TabTimeline projectId={project.id} />
        </TabsContent>
        <TabsContent value="deliveries" className="mt-6">
          <TabDeliveries projectId={project.id} />
        </TabsContent>
        {NON_RECURRING_TYPES.includes(project.project_type) && (
          <TabsContent value="payments" className="mt-6">
            <TabPayments projectId={project.id} clientId={project.client_id} projectName={project.name} />
          </TabsContent>
        )}
        <TabsContent value="document" className="mt-6">
          <TabDocument projectId={project.id} />
        </TabsContent>
        <TabsContent value="updates" className="mt-6">
          <TabUpdates projectId={project.id} />
        </TabsContent>
      </Tabs>
      </FadeUp>

      {/* Floating request button */}
      <RequestButton projectId={project.id} projectName={project.name} />
    </StaggerContainer>
  );
}

/* ───── Mini stat card ───── */
function MiniStat({ icon: Icon, color, bg, label, value, sub }: {
  icon: typeof Activity; color: string; bg: string; label: string; value: string | number; sub: string;
}) {
  return (
    <div className="bg-card/50 border border-border/50 rounded-xl p-3 hover:border-border transition-colors">
      <div className="flex items-center gap-2 mb-1.5">
        <div className={`w-7 h-7 rounded-lg ${bg} flex items-center justify-center`}>
          <Icon className={`w-3.5 h-3.5 ${color}`} />
        </div>
      </div>
      <p className="text-lg font-bold text-foreground tabular-nums leading-none">{value}</p>
      <p className="text-[10px] text-muted-foreground mt-1">{label}</p>
      {sub && <p className="text-[9px] text-muted-foreground/60 mt-0.5">{sub}</p>}
    </div>
  );
}
