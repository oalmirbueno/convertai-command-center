import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import CircularProgress from "./CircularProgress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Rocket, CheckCircle2, Clock, AlertCircle, FileCheck, TrendingUp,
  ChevronRight, Zap, Target, CalendarDays, MessageSquare,
} from "lucide-react";

const statusDotStyles: Record<string, string> = {
  active: "bg-success pulse-dot",
  review: "bg-warning",
  planning: "bg-info",
  done: "bg-success",
  paused: "bg-muted-foreground",
};

const statusLabels: Record<string, string> = {
  active: "Ativo",
  review: "Em Revisão",
  planning: "Planejamento",
  done: "Concluído",
  paused: "Pausado",
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

  // Projects for this client
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

  // Recent updates across all client projects
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

  // Upcoming milestones
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

  // Pending approvals
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

  // Active tasks count
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
      {/* Hero greeting */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card via-card to-primary/5 p-6 sm:p-8">
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="relative z-10">
          <p className="text-muted-foreground text-sm mb-1">
            {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">
            Olá, {clientName} 👋
          </h1>
          <p className="text-muted-foreground text-sm max-w-lg">
            {activeProjects.length === 0
              ? "Nenhum projeto ativo no momento."
              : activeProjects.length === 1
                ? `Você tem 1 projeto ativo com ${avgProgress}% de progresso geral.`
                : `Você tem ${activeProjects.length} projetos ativos com ${avgProgress}% de progresso médio.`
            }
            {(pendingFiles?.length || 0) > 0 && ` ${pendingFiles!.length} item(s) aguardando sua aprovação.`}
          </p>
        </div>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[
          { label: "Projetos Ativos", value: activeProjects.length, icon: Rocket, color: "text-primary" },
          { label: "Em Andamento", value: (activeTasks || []).length, icon: Zap, color: "text-info" },
          { label: "Aguardando Aprovação", value: (pendingFiles || []).length, icon: FileCheck, color: "text-warning" },
          { label: "Concluídos", value: doneProjects.length, icon: CheckCircle2, color: "text-success" },
        ].map((stat) => (
          <div key={stat.label} className="bg-card border border-border rounded-xl p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <stat.icon className={`w-5 h-5 ${stat.color}`} />
              <span className="text-2xl font-bold text-foreground font-mono">{stat.value}</span>
            </div>
            <p className="text-[11px] sm:text-xs text-muted-foreground">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Projects + Journey */}
        <div className="lg:col-span-2 space-y-6">
          {/* Projects */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Rocket className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">Seus Projetos</h2>
            </div>
            {allProjects.length === 0 ? (
              <div className="bg-card border border-border rounded-xl p-8 text-center">
                <p className="text-sm text-muted-foreground">Nenhum projeto encontrado.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {allProjects.map((p: any) => (
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
                          <span>{statusLabels[p.status] || p.status}</span>
                          <span className="text-border">•</span>
                          <span>Prazo: {formatDate(p.deadline)}</span>
                        </div>
                        {/* Progress bar */}
                        <div className="h-[3px] w-full rounded-full bg-secondary mt-3 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all duration-500"
                            style={{ width: `${p.progress}%` }}
                          />
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-3" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Upcoming milestones - roadmap style */}
          {(milestones || []).length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Target className="w-4 h-4 text-info" />
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
                          isFirst ? "bg-primary/20 border-2 border-primary" : "bg-card border-2 border-border"
                        }`}>
                          <CalendarDays className={`w-3.5 h-3.5 ${isFirst ? "text-primary" : "text-muted-foreground"}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-[13px] font-medium ${isFirst ? "text-foreground" : "text-foreground/70"}`}>
                            {m.title}
                          </p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {(m as any).project?.name} • {formatDateShort(m.target_date)}
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
            <div className="bg-warning/5 border border-warning/20 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <FileCheck className="w-4 h-4 text-warning" />
                <h3 className="text-sm font-semibold text-foreground">Aguardando Aprovação</h3>
              </div>
              <div className="space-y-2.5">
                {(pendingFiles || []).map((f: any) => (
                  <div key={f.id} className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-warning mt-1.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[12px] text-foreground truncate">{f.file_name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {(f as any).project?.name} • {relativeTime(f.created_at)}
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
              <MessageSquare className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Atividade Recente</h3>
            </div>
            {!(recentUpdates || []).length ? (
              <p className="text-[12px] text-muted-foreground py-4 text-center">Nenhuma atualização ainda.</p>
            ) : (
              <div className="space-y-0">
                {(recentUpdates || []).map((u: any) => {
                  const Icon = updateIcons[u.update_type] || Zap;
                  return (
                    <div key={u.id} className="flex gap-3 py-2.5 border-b border-border/50 last:border-0">
                      <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center shrink-0">
                        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] text-foreground/90 line-clamp-2">{u.message}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {u.project?.name} • {relativeTime(u.created_at)}
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
