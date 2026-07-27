import {
  Calendar,
  CheckCircle2,
  Circle,
  CircleDot,
  Target,
} from "lucide-react";
import { useMilestones } from "@/hooks/useSupabaseData";
import {
  parseClientProjectSections,
  sanitizeClientText,
} from "@/lib/projectPresentation";
import { daysUntil, formatDateShort } from "../dashboardHelpers";

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

export default function TabOverview({ project }: { project: any }) {
  const { data: milestones } = useMilestones(project.id);
  const allMilestones = milestones || [];
  const completedMilestones = allMilestones.filter((milestone: any) => milestone.status === "completed");
  const activeMilestone = allMilestones.find((milestone: any) =>
    milestone.status === "in_progress" || milestone.status === "pending"
  );
  const sections = parseClientProjectSections(project.description);
  const objectives = sanitizeClientText(project.objectives)
    .split("\n")
    .filter((objective: string) => objective.trim());
  const cleanScope = sanitizeClientText(project.scope);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      <div className="space-y-6 lg:col-span-3">
        <section className="space-y-5">
          <p className="label-sm">Sobre o projeto</p>
          {sections.length > 0 ? (
            sections.map((section, index) => (
              <div key={`${section.title}-${index}`} className="space-y-1.5">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  {section.title}
                </p>
                {section.body.map((line, lineIndex) => (
                  <p key={lineIndex} className="text-sm leading-relaxed text-foreground/80">
                    {line}
                  </p>
                ))}
              </div>
            ))
          ) : (
            <p className="text-sm leading-relaxed text-muted-foreground">
              As informações deste projeto serão atualizadas pela equipe.
            </p>
          )}
          {cleanScope && !sections.some((section) => /escopo/i.test(section.title)) && (
            <div className="space-y-1.5">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                Escopo
              </p>
              <p className="text-[13px] leading-relaxed text-foreground/70">{cleanScope}</p>
            </div>
          )}
        </section>

        {objectives.length > 0 && (
          <section>
            <p className="label-sm mb-3">Objetivos</p>
            <ul className="space-y-2">
              {objectives.map((objective: string, index: number) => (
                <li key={index} className="flex items-start gap-2.5 text-[13px] text-foreground/70">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary" />
                  {objective}
                </li>
              ))}
            </ul>
          </section>
        )}

        {activeMilestone && (
          <section className="space-y-4 rounded-xl border border-primary/15 bg-primary/[0.04] p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15">
                  <Target className="h-4 w-4 text-primary" />
                </div>
                <p className="text-[13px] font-semibold text-foreground">Etapa atual</p>
              </div>
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] text-muted-foreground">
                {completedMilestones.length} de {allMilestones.length} concluídas
              </span>
            </div>
            <p className="text-[15px] font-semibold text-foreground">{activeMilestone.title}</p>
            {activeMilestone.target_date && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Calendar className="h-3 w-3" />
                Previsão {formatDateShort(activeMilestone.target_date)}
                {daysUntil(activeMilestone.target_date) >= 0 && (
                  <span>· {daysUntil(activeMilestone.target_date)} dia(s)</span>
                )}
              </div>
            )}
          </section>
        )}

        {allMilestones.length > 0 && (
          <section>
            <p className="label-sm mb-3">Progresso das etapas</p>
            <div className="space-y-2">
              {allMilestones.slice(0, 8).map((milestone: any) => {
                const isDone = milestone.status === "completed";
                const isActive = milestone.status === "in_progress";
                return (
                  <div key={milestone.id} className="flex items-center gap-3">
                    <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                      isDone
                        ? "border-emerald-500/40 bg-emerald-500/15"
                        : isActive
                          ? "border-primary/40 bg-primary/15"
                          : "border-border bg-secondary"
                    }`}>
                      {isDone ? (
                        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                      ) : isActive ? (
                        <CircleDot className="h-3 w-3 text-primary" />
                      ) : (
                        <Circle className="h-3 w-3 text-muted-foreground/40" />
                      )}
                    </div>
                    <p className={`min-w-0 flex-1 text-[12px] ${
                      isDone ? "text-emerald-500" : isActive ? "font-medium text-foreground" : "text-muted-foreground"
                    }`}>
                      {milestone.title}
                    </p>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {formatDateShort(milestone.target_date)}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>

      <aside className="space-y-4 lg:col-span-2">
        <div className="space-y-3 rounded-xl border border-border bg-card p-5">
          <p className="label-sm mb-1">Informações</p>
          <div className="flex justify-between text-[13px]">
            <span className="text-muted-foreground">Início</span>
            <span className="text-foreground">{formatDateShort(project.start_date) || "A definir"}</span>
          </div>
          <div className="flex justify-between text-[13px]">
            <span className="text-muted-foreground">Previsão</span>
            <span className="text-foreground">{formatDateShort(project.deadline) || "A definir"}</span>
          </div>
          <div className="flex justify-between text-[13px]">
            <span className="text-muted-foreground">Progresso</span>
            <span className="font-mono text-foreground">{project.progress || 0}%</span>
          </div>
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-muted-foreground">Status</span>
            <span className={`rounded-full px-2 py-0.5 text-xs ${statusBadge[project.status] || statusBadge.paused}`}>
              {project.status}
            </span>
          </div>
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-muted-foreground">Tipo</span>
            <span className="text-xs text-foreground">{typeLabels[project.project_type] || "Projeto"}</span>
          </div>
        </div>
      </aside>
    </div>
  );
}
