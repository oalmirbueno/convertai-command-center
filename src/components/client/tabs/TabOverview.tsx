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
import { espaco, juntar, texto } from "@/components/sistema";
import { Card, CardSurface, List, ListRow, ProgressBar, StatusPill, type Tone } from "@/components/ds";

const statusTone: Record<string, Tone> = {
  active: "success",
  review: "warning",
  planning: "info",
  done: "success",
  paused: "neutral",
};

// O status aparecia cru ("active"): o cliente lê o nome em português.
const statusLabels: Record<string, string> = {
  active: "Em andamento",
  review: "Em revisão",
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
    <div className={juntar(espaco.grade, "grid-cols-1 items-start lg:grid-cols-5")}>
      <div className="min-w-0 space-y-4 sm:space-y-5 lg:col-span-3">
        <Card title="Sobre o projeto">
          <div className="space-y-5">
            {sections.length > 0 ? (
              sections.map((section, index) => (
                <div key={`${section.title}-${index}`} className="min-w-0">
                  <p className={texto.rotulo}>{section.title}</p>
                  {section.body.map((line, lineIndex) => (
                    <p key={lineIndex} className={juntar(texto.corpo, "mt-1.5 text-foreground/85 [overflow-wrap:anywhere]")}>
                      {line}
                    </p>
                  ))}
                </div>
              ))
            ) : (
              <p className={juntar(texto.corpo, "text-muted-foreground")}>
                As informações deste projeto serão atualizadas pela equipe.
              </p>
            )}
            {cleanScope && !sections.some((section) => /escopo/i.test(section.title)) && (
              <div className="min-w-0">
                <p className={texto.rotulo}>Escopo</p>
                <p className={juntar(texto.corpo, "mt-1.5 text-foreground/75 [overflow-wrap:anywhere]")}>{cleanScope}</p>
              </div>
            )}
          </div>
        </Card>

        {objectives.length > 0 && (
          <Card title="Objetivos">
            <ul className="space-y-3">
              {objectives.map((objective: string, index: number) => (
                <li key={index} className={juntar(texto.corpo, "flex items-start text-foreground/85")}>
                  <span className="mr-3 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-primary" aria-hidden="true">
                    <Target className="h-3 w-3" />
                  </span>
                  <span className="min-w-0">{objective}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {allMilestones.length > 0 && (
          <Card title="Progresso das etapas" subtitle={`${completedMilestones.length} de ${allMilestones.length} concluídas`}>
            <div className="mb-3">
              <ProgressBar value={completedMilestones.length} max={allMilestones.length} tone={1} striped height={10} />
            </div>
            <List label="Etapas do projeto">
              {allMilestones.slice(0, 8).map((milestone: any) => {
                const isDone = milestone.status === "completed";
                const isActive = milestone.status === "in_progress";
                return (
                  <ListRow
                    key={milestone.id}
                    dense
                    highlight={isActive}
                    leading={
                      <span className={juntar("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", isDone ? "bg-foreground text-background" : isActive ? "bg-accent-solid text-on-accent" : "bg-muted text-muted-foreground")}>
                        {isDone ? (
                          <CheckCircle2 className="h-4 w-4" aria-label="Concluída" />
                        ) : isActive ? (
                          <CircleDot className="h-4 w-4" aria-label="Em andamento" />
                        ) : (
                          <Circle className="h-4 w-4 opacity-50" aria-label="A fazer" />
                        )}
                      </span>
                    }
                    title={<span className={isDone || isActive ? "" : "font-normal text-muted-foreground"}>{milestone.title}</span>}
                    value={formatDateShort(milestone.target_date) || undefined}
                  />
                );
              })}
            </List>
          </Card>
        )}
      </div>

      <aside className="min-w-0 space-y-4 sm:space-y-5 lg:col-span-2">
        {activeMilestone && (
          <CardSurface variant="ink" padded>
            <p className="flex min-w-0 items-center text-[13px] font-medium leading-5 text-muted-foreground">
              <Target className="mr-2 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              Etapa atual
              <span className="ml-auto shrink-0 pl-3 tabular-nums">{`${completedMilestones.length} de ${allMilestones.length} concluídas`}</span>
            </p>
            <p className="mt-4 line-clamp-2 text-[24px] font-semibold leading-8 tracking-[-0.02em] text-foreground">{activeMilestone.title}</p>
            {activeMilestone.target_date && (
              <p className={juntar(texto.auxiliar, "mt-2 flex items-center")}>
                <Calendar className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Previsão {formatDateShort(activeMilestone.target_date)}
                {daysUntil(activeMilestone.target_date) >= 0 && <span>&nbsp;· {daysUntil(activeMilestone.target_date)} dia(s)</span>}
              </p>
            )}
          </CardSurface>
        )}
        <Card title="Informações">
          <dl className="-my-1 divide-y divide-border/70">
            {[
              { rotulo: "Início", valor: formatDateShort(project.start_date) || "A definir" },
              { rotulo: "Previsão", valor: formatDateShort(project.deadline) || "A definir" },
              { rotulo: "Progresso", valor: <span className="tabular-nums">{project.progress || 0}%</span> },
              {
                rotulo: "Status",
                valor: <StatusPill tone={statusTone[project.status] || "neutral"}>{statusLabels[project.status] || project.status}</StatusPill>,
              },
              { rotulo: "Tipo", valor: typeLabels[project.project_type] || "Projeto" },
            ].map((linha) => (
              <div key={linha.rotulo} className="flex min-w-0 items-center justify-between py-3 text-[13px]">
                <dt className="text-muted-foreground">{linha.rotulo}</dt>
                <dd className="ml-3 min-w-0 truncate text-right font-medium text-foreground">{linha.valor}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </aside>
    </div>
  );
}
