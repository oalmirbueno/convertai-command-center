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
import { Painel, Secao, etiqueta, juntar, texto } from "@/components/sistema";

const statusBadge: Record<string, string> = {
  active: "bg-success/10 text-success",
  review: "bg-warning/10 text-warning",
  planning: "bg-info/10 text-info",
  done: "bg-success/10 text-success",
  paused: "bg-muted text-muted-foreground",
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
    <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-5">
      <div className="min-w-0 space-y-6 lg:col-span-3">
        <Secao titulo="Sobre o projeto">
          <div className="space-y-4">
            {sections.length > 0 ? (
              sections.map((section, index) => (
                <div key={`${section.title}-${index}`} className="min-w-0">
                  <p className={texto.rotulo}>{section.title}</p>
                  {section.body.map((line, lineIndex) => (
                    <p key={lineIndex} className={juntar(texto.corpo, "mt-1 text-foreground/85 [overflow-wrap:anywhere]")}>
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
                <p className={juntar(texto.corpo, "mt-1 text-foreground/75 [overflow-wrap:anywhere]")}>{cleanScope}</p>
              </div>
            )}
          </div>
        </Secao>

        {objectives.length > 0 && (
          <Secao titulo="Objetivos" divisoria>
            <ul className="space-y-1.5">
              {objectives.map((objective: string, index: number) => (
                <li key={index} className={juntar(texto.corpo, "flex items-start text-foreground/80")}>
                  <span className="mr-2.5 mt-2 h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                  <span className="min-w-0">{objective}</span>
                </li>
              ))}
            </ul>
          </Secao>
        )}

        {activeMilestone && (
          <Secao
            titulo="Etapa atual"
            divisoria
            descricao={`${completedMilestones.length} de ${allMilestones.length} concluídas`}
          >
            <p className="flex min-w-0 items-center text-[15px] font-semibold leading-[22px] text-foreground">
              <Target className="mr-2 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span className="min-w-0 truncate">{activeMilestone.title}</span>
            </p>
            {activeMilestone.target_date && (
              <p className={juntar(texto.auxiliar, "mt-1 flex items-center")}>
                <Calendar className="mr-1.5 h-3 w-3" aria-hidden="true" />
                Previsão {formatDateShort(activeMilestone.target_date)}
                {daysUntil(activeMilestone.target_date) >= 0 && <span>&nbsp;· {daysUntil(activeMilestone.target_date)} dia(s)</span>}
              </p>
            )}
          </Secao>
        )}

        {allMilestones.length > 0 && (
          <Secao titulo="Progresso das etapas" divisoria descricao={`${completedMilestones.length} de ${allMilestones.length} concluídas`}>
            <ul className="divide-y divide-border">
              {allMilestones.slice(0, 8).map((milestone: any) => {
                const isDone = milestone.status === "completed";
                const isActive = milestone.status === "in_progress";
                return (
                  <li key={milestone.id} className="flex min-w-0 items-center py-2">
                    <span className={`mr-3 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                      isDone
                        ? "border-emerald-500/40 bg-emerald-500/15"
                        : isActive
                          ? "border-primary/40 bg-primary/15"
                          : "border-border bg-muted"
                    }`}>
                      {isDone ? (
                        <CheckCircle2 className="h-3 w-3 text-emerald-500" aria-label="Concluída" />
                      ) : isActive ? (
                        <CircleDot className="h-3 w-3 text-primary" aria-label="Em andamento" />
                      ) : (
                        <Circle className="h-3 w-3 text-muted-foreground/40" aria-label="A fazer" />
                      )}
                    </span>
                    <p className={`min-w-0 flex-1 truncate text-[13px] ${
                      isDone ? "text-emerald-500" : isActive ? "font-medium text-foreground" : "text-muted-foreground"
                    }`}>
                      {milestone.title}
                    </p>
                    <span className={juntar(texto.auxiliar, "ml-3 shrink-0 tabular-nums")}>
                      {formatDateShort(milestone.target_date)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Secao>
        )}
      </div>

      <aside className="min-w-0 lg:col-span-2">
        <Painel titulo="Informações" semEspaco>
          <dl className="divide-y divide-border">
            {[
              { rotulo: "Início", valor: formatDateShort(project.start_date) || "A definir" },
              { rotulo: "Previsão", valor: formatDateShort(project.deadline) || "A definir" },
              { rotulo: "Progresso", valor: <span className="tabular-nums">{project.progress || 0}%</span> },
              {
                rotulo: "Status",
                valor: (
                  <span className={juntar(etiqueta, statusBadge[project.status] || statusBadge.paused)}>
                    {statusLabels[project.status] || project.status}
                  </span>
                ),
              },
              { rotulo: "Tipo", valor: typeLabels[project.project_type] || "Projeto" },
            ].map((linha) => (
              <div key={linha.rotulo} className="flex min-w-0 items-center justify-between px-4 py-2.5 text-[13px]">
                <dt className="text-muted-foreground">{linha.rotulo}</dt>
                <dd className="ml-3 min-w-0 truncate text-right text-foreground">{linha.valor}</dd>
              </div>
            ))}
          </dl>
        </Painel>
      </aside>
    </div>
  );
}
