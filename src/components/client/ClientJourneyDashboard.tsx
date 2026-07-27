import {
  ArrowUpRight,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  FileCheck,
  PackageCheck,
  Target,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import CircularProgress from "./CircularProgress";
import { FadeUp, StaggerContainer } from "./motion";
import {
  daysUntil,
  formatDateShort,
  typeLabels,
  useClientDashboardData,
} from "./dashboardHelpers";

interface Props {
  clientId: string;
  clientName: string;
  onSelectProject: (project: any) => void;
  isImpersonation?: boolean;
}

const projectStatusLabel: Record<string, string> = {
  active: "Em andamento",
  review: "Em revisão",
  planning: "Planejamento",
  done: "Concluído",
  paused: "Pausado",
};

export default function ClientJourneyDashboard({
  clientId,
  clientName,
  onSelectProject,
  isImpersonation,
}: Props) {
  const { loadingProjects, data } = useClientDashboardData(clientId);
  const {
    activeProjects,
    doneProjects,
    avgProgress,
    milestones,
    completedMilestonesCount,
    totalMilestones,
    pendingFiles,
    deliveredFiles,
    approvedFiles,
    totalFiles,
  } = data;
  const firstName = clientName.split(" ")[0] || "cliente";
  const dashboardProjects = [...activeProjects, ...doneProjects];

  if (loadingProjects) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Skeleton className="h-36 w-full rounded-2xl" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[1, 2, 3, 4].map((item) => (
            <Skeleton key={item} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <StaggerContainer className="space-y-8">
      <FadeUp>
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 sm:p-8">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.06] via-transparent to-primary/[0.02]" />
          <div className="relative z-10 flex items-start justify-between gap-4">
            <div>
              <p className="mb-2 flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
                <CalendarDays className="h-3 w-3" />
                {new Date().toLocaleDateString("pt-BR", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
              </p>
              <h1 className="text-2xl font-bold text-foreground sm:text-3xl">
                Bem-vindo de volta, {firstName}
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
                Acompanhe seus projetos, etapas e entregas liberadas pela Aceleriq.
                {pendingFiles.length > 0
                  ? ` ${pendingFiles.length} ${pendingFiles.length === 1 ? "entrega aguarda" : "entregas aguardam"} sua decisão.`
                  : ""}
              </p>
              {isImpersonation && (
                <p className="mt-3 text-xs text-sky-600">
                  Visualização administrativa em modo somente leitura.
                </p>
              )}
            </div>
            {activeProjects.length > 0 && (
              <div className="hidden shrink-0 flex-col items-center gap-1.5 sm:flex">
                <CircularProgress progress={avgProgress} size={80} strokeWidth={5} />
                <span className="text-[10px] text-muted-foreground">Progresso geral</span>
              </div>
            )}
          </div>
        </div>
      </FadeUp>

      <FadeUp>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {[
            {
              label: "Projetos ativos",
              value: activeProjects.length,
              detail: doneProjects.length ? `${doneProjects.length} concluído(s)` : "Nenhum concluído",
              icon: Briefcase,
              color: "text-primary",
              bg: "bg-primary/10",
            },
            {
              label: "Etapas concluídas",
              value: completedMilestonesCount,
              detail: `${totalMilestones} etapa(s) no total`,
              icon: Target,
              color: "text-sky-500",
              bg: "bg-sky-500/10",
            },
            {
              label: "Entregas liberadas",
              value: totalFiles,
              detail: approvedFiles ? `${approvedFiles} aprovada(s)` : "Aguardando decisões",
              icon: PackageCheck,
              color: "text-emerald-500",
              bg: "bg-emerald-500/10",
            },
            {
              label: "Aprovações pendentes",
              value: pendingFiles.length,
              detail: pendingFiles.length ? "Ação necessária" : "Nenhuma pendência",
              icon: FileCheck,
              color: "text-amber-500",
              bg: "bg-amber-500/10",
            },
          ].map((metric) => (
            <div key={metric.label} className="rounded-xl border border-border bg-card p-4 sm:p-5">
              <div className="mb-2 flex items-center justify-between">
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${metric.bg}`}>
                  <metric.icon className={`h-4 w-4 ${metric.color}`} />
                </div>
                <span className="text-2xl font-bold tabular-nums text-foreground">{metric.value}</span>
              </div>
              <p className="text-xs text-muted-foreground">{metric.label}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground/70">{metric.detail}</p>
            </div>
          ))}
        </div>
      </FadeUp>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <FadeUp className="lg:col-span-2">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Projetos</h2>
              <span className="text-xs text-muted-foreground">
                {activeProjects.length} ativo(s)
                {doneProjects.length > 0 ? ` · ${doneProjects.length} concluído(s)` : ""}
              </span>
            </div>
            {dashboardProjects.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
                Novos projetos aparecerão aqui quando forem iniciados.
              </div>
            ) : (
              dashboardProjects.map((project: any) => {
                const projectMilestones = milestones.filter((milestone: any) => milestone.project_id === project.id);
                const completed = projectMilestones.filter((milestone: any) => milestone.status === "completed").length;
                const deadlineDistance = project.deadline ? daysUntil(project.deadline) : null;
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => onSelectProject(project)}
                    className="group w-full rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/30"
                  >
                    <div className="flex items-start gap-4">
                      <CircularProgress progress={project.progress || 0} size={56} strokeWidth={4} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                              {typeLabels[project.project_type] || "Projeto"} · {projectStatusLabel[project.status] || project.status}
                            </p>
                            <p className="mt-1 truncate text-sm font-semibold text-foreground">{project.name}</p>
                          </div>
                          <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
                        </div>
                        <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                            {completed}/{projectMilestones.length} etapas
                          </span>
                          {project.deadline && (
                            <span>
                              {deadlineDistance !== null && deadlineDistance < 0
                                ? "Prazo em atualização"
                                : `Previsão ${formatDateShort(project.deadline)}`}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </section>
        </FadeUp>

        <FadeUp>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground">Entregas recentes</h2>
            <div className="rounded-xl border border-border bg-card p-4">
              {deliveredFiles.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  Nenhuma entrega liberada ainda.
                </p>
              ) : (
                <div className="space-y-3">
                  {deliveredFiles.slice(0, 6).map((file: any) => (
                    <div key={file.id} className="border-b border-border/60 pb-3 last:border-0 last:pb-0">
                      <p className="truncate text-xs font-medium text-foreground">{file.file_name}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {file.project?.name || "Entrega"} · v{file.version || 1}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </FadeUp>
      </div>
    </StaggerContainer>
  );
}
