import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import CircularProgress from "./CircularProgress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Rocket, CheckCircle2, Clock, AlertCircle, FileCheck, TrendingUp,
  ChevronRight, Zap, Target, CalendarDays, MessageSquare,
  ArrowUpRight, Layers, Activity, Award, BarChart3,
} from "lucide-react";

const statusDotStyles: Record<string, string> = {
  active: "bg-emerald-500 shadow-emerald-500/40 shadow-[0_0_6px]",
  review: "bg-amber-400",
  planning: "bg-sky-400",
  done: "bg-emerald-500",
  paused: "bg-muted-foreground",
};

const statusLabels: Record<string, string> = {
  active: "Ativo",
  review: "Em Revisão",
  planning: "Planejamento",
  done: "Concluído",
  paused: "Pausado",
};

const statusIcons: Record<string, typeof Rocket> = {
  active: Activity,
  review: Clock,
  planning: Layers,
  done: Award,
  paused: Clock,
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

function relativeTime(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMinutes < 1) return "agora";
  if (diffMinutes < 60) return `${diffMinutes}min atrás`;
  if (diffHours < 24) return `${diffHours}h atrás`;
  if (diffDays < 7) return `${diffDays}d atrás`;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

const updateIcons: Record<string, typeof Rocket> = {
  creative: FileCheck,
  task: CheckCircle2,
  alert: AlertCircle,
  milestone: Target,
  system: Zap,
  report: TrendingUp,
};

interface Props {
  clientId: string;
  clientName: string;
  onSelectProject: (p: any) => void;
  isImpersonation?: boolean;
}

export default function ClientJourneyDashboard({ clientId, clientName, onSelectProject, isImpersonation }: Props) {
  const { user } = useAuth();

  const { data: projects, isLoading: loadingProjects } = useQuery({
    queryKey: ["client-projects", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && !!clientId,
    refetchInterval: 15000,
  });

  const projectIds = (projects || []).map((p: any) => p.id);

  const { data: recentUpdates } = useQuery({
    queryKey: ["client-updates-all", clientId, projectIds.join(",")],
    queryFn: async () => {
      if (!projectIds.length) return [];
      const { data, error } = await supabase
        .from("updates")
        .select("*, author:profiles!updates_author_id_fkey(full_name), project:projects!updates_project_id_fkey(name)")
        .in("project_id", projectIds)
        .order("created_at", { ascending: false })
        .limit(8);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && projectIds.length > 0,
    refetchInterval: 15000,
  });

  const { data: milestones } = useQuery({
    queryKey: ["client-milestones-all", clientId, projectIds.join(",")],
    queryFn: async () => {
      if (!projectIds.length) return [];
      const { data, error } = await supabase
        .from("milestones")
        .select("*, project:projects!milestones_project_id_fkey(name)")
        .in("project_id", projectIds)
        .neq("status", "completed")
        .order("target_date", { ascending: true })
        .limit(5);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && projectIds.length > 0,
  });

  const { data: pendingFiles } = useQuery({
    queryKey: ["client-pending-approvals", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("files")
        .select("id, file_name, created_at, project:projects!files_project_id_fkey(name)")
        .eq("client_id", clientId)
        .eq("approval_status", "pending")
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && !!clientId,
  });

  const { data: activeTasks } = useQuery({
    queryKey: ["client-active-tasks", clientId, projectIds.join(",")],
    queryFn: async () => {
      if (!projectIds.length) return [];
      const { data, error } = await supabase
        .from("tasks")
        .select("id, status, project_id")
        .in("project_id", projectIds)
        .in("status", ["doing", "review"]);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && projectIds.length > 0,
  });

  const allProjects = projects || [];
  const activeProjects = allProjects.filter((p: any) => p.status !== "done");
  const doneProjects = allProjects.filter((p: any) => p.status === "done");
  const avgProgress = activeProjects.length > 0
    ? Math.round(activeProjects.reduce((s: number, p: any) => s + (p.progress || 0), 0) / activeProjects.length)
    : 0;

  const formatDate = (d: string) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  };

  const formatDateShort = (d: string) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  };

  const firstName = clientName.split(" ")[0];

  if (loadingProjects) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-8">
      {/* Hero greeting — clean, no emojis */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 sm:p-8">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.04] via-transparent to-primary/[0.02]" />
        <div className="absolute top-0 right-0 w-80 h-80 bg-primary/[0.03] rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
        <div className="relative z-10 flex items-start justify-between">
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wider mb-2">
              {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
            </p>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">
              Bem-vindo, {firstName}
            </h1>
            <p className="text-muted-foreground text-sm max-w-md leading-relaxed">
              {activeProjects.length === 0
                ? "Nenhum projeto ativo no momento."
                : activeProjects.length === 1
                  ? `1 projeto em andamento com ${avgProgress}% de progresso.`
                  : `${activeProjects.length} projetos em andamento com ${avgProgress}% de progresso médio.`
              }
              {(pendingFiles?.length || 0) > 0 && ` ${pendingFiles!.length} aprovação pendente.`}
            </p>
          </div>
          {/* Progress ring for overall */}
          {activeProjects.length > 0 && (
            <div className="hidden sm:flex flex-col items-center gap-1">
              <CircularProgress progress={avgProgress} size={64} />
              <span className="text-[10px] text-muted-foreground mt-1">Progresso geral</span>
            </div>
          )}
        </div>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[
          { label: "Projetos Ativos", value: activeProjects.length, icon: Activity, color: "text-primary", bg: "bg-primary/10" },
          { label: "Tarefas em Execução", value: (activeTasks || []).length, icon: Zap, color: "text-sky-500", bg: "bg-sky-500/10" },
          { label: "Aprovações Pendentes", value: (pendingFiles || []).length, icon: FileCheck, color: "text-amber-500", bg: "bg-amber-500/10" },
          { label: "Projetos Concluídos", value: doneProjects.length, icon: Award, color: "text-emerald-500", bg: "bg-emerald-500/10" },
        ].map((stat) => (
          <div key={stat.label} className="bg-card border border-border rounded-xl p-4 sm:p-5 hover:border-border/80 transition-colors">
            <div className="flex items-center justify-between mb-3">
              <div className={`w-8 h-8 rounded-lg ${stat.bg} flex items-center justify-center`}>
                <stat.icon className={`w-4 h-4 ${stat.color}`} />
              </div>
              <span className="text-2xl font-bold text-foreground tabular-nums">{stat.value}</span>
            </div>
            <p className="text-[11px] sm:text-xs text-muted-foreground">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Projects + Journey */}
        <div className="lg:col-span-2 space-y-6">
          {/* Active Projects */}
          {activeProjects.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Activity className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">Projetos em Andamento</h2>
                <span className="text-[10px] text-muted-foreground bg-secondary px-2 py-0.5 rounded-full ml-1">
                  {activeProjects.length}
                </span>
              </div>
              <div className="space-y-3">
                {activeProjects.map((p: any) => {
                  const StatusIcon = statusIcons[p.status] || Activity;
                  return (
                    <div
                      key={p.id}
                      onClick={() => onSelectProject(p)}
                      className="group bg-card border border-border rounded-xl p-4 sm:p-5 cursor-pointer hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 transition-all duration-200"
                    >
                      <div className="flex items-start gap-4">
                        <div className="shrink-0 mt-1">
                          <CircularProgress progress={p.progress} size={52} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <div className={`w-2 h-2 rounded-full shrink-0 ${statusDotStyles[p.status] || "bg-muted-foreground"}`} />
                            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                              {typeLabels[p.project_type] || p.project_type}
                            </span>
                          </div>
                          <p className="text-sm font-semibold text-foreground truncate">{p.name}</p>
                          <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
                            <div className="flex items-center gap-1">
                              <StatusIcon className="w-3 h-3" />
                              <span>{statusLabels[p.status] || p.status}</span>
                            </div>
                            <span className="text-border">·</span>
                            <div className="flex items-center gap-1">
                              <CalendarDays className="w-3 h-3" />
                              <span>{formatDate(p.deadline)}</span>
                            </div>
                          </div>
                          <div className="h-[3px] w-full rounded-full bg-secondary mt-3 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-primary transition-all duration-500"
                              style={{ width: `${p.progress}%` }}
                            />
                          </div>
                        </div>
                        <ArrowUpRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-2" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Completed Projects */}
          {doneProjects.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Award className="w-4 h-4 text-emerald-500" />
                <h2 className="text-sm font-semibold text-foreground">Projetos Concluídos</h2>
                <span className="text-[10px] text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full ml-1">
                  {doneProjects.length}
                </span>
              </div>
              <div className="space-y-2">
                {doneProjects.map((p: any) => (
                  <div
                    key={p.id}
                    onClick={() => onSelectProject(p)}
                    className="group bg-card border border-border rounded-xl p-4 cursor-pointer hover:border-emerald-500/20 hover:shadow-md transition-all duration-200"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                        <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                        <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                          <span>{typeLabels[p.project_type] || p.project_type}</span>
                          <span className="text-border">·</span>
                          <span>Finalizado em {formatDate(p.deadline)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] font-medium text-emerald-600 bg-emerald-500/10 px-2 py-1 rounded-md">
                          100%
                        </span>
                        <ArrowUpRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No projects at all */}
          {allProjects.length === 0 && (
            <div className="bg-card border border-border rounded-xl p-10 text-center">
              <Layers className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Nenhum projeto encontrado.</p>
            </div>
          )}

          {/* Upcoming milestones */}
          {(milestones || []).length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Target className="w-4 h-4 text-sky-500" />
                <h2 className="text-sm font-semibold text-foreground">Próximas Etapas</h2>
              </div>
              <div className="relative">
                <div className="absolute left-[15px] top-3 bottom-3 w-[2px] bg-border" />
                <div className="space-y-0">
                  {(milestones || []).map((m: any, i: number) => {
                    const isFirst = i === 0;
                    return (
                      <div key={m.id} className="flex gap-4 py-3 relative">
                        <div className={`w-[32px] h-[32px] rounded-full flex items-center justify-center shrink-0 z-10 ${
                          isFirst ? "bg-primary/15 border-2 border-primary" : "bg-card border-2 border-border"
                        }`}>
                          <CalendarDays className={`w-3.5 h-3.5 ${isFirst ? "text-primary" : "text-muted-foreground"}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-[13px] font-medium ${isFirst ? "text-foreground" : "text-foreground/70"}`}>
                            {m.title}
                          </p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {(m as any).project?.name} · {formatDateShort(m.target_date)}
                          </p>
                          {m.description && (
                            <p className="text-[11px] text-muted-foreground/70 mt-1 line-clamp-1">{m.description}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <div className="space-y-6">
          {/* Pending approvals */}
          {(pendingFiles || []).length > 0 && (
            <div className="bg-amber-500/[0.04] border border-amber-500/15 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-md bg-amber-500/10 flex items-center justify-center">
                  <FileCheck className="w-3.5 h-3.5 text-amber-500" />
                </div>
                <h3 className="text-sm font-semibold text-foreground">Aguardando Aprovação</h3>
              </div>
              <div className="space-y-2.5">
                {(pendingFiles || []).map((f: any) => (
                  <div key={f.id} className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
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

          {/* Recent activity */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center">
                <BarChart3 className="w-3.5 h-3.5 text-primary" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">Atividade Recente</h3>
            </div>
            {!(recentUpdates || []).length ? (
              <div className="py-6 text-center">
                <MessageSquare className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-[12px] text-muted-foreground">Nenhuma atualização ainda.</p>
              </div>
            ) : (
              <div className="space-y-0">
                {(recentUpdates || []).map((u: any) => {
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
