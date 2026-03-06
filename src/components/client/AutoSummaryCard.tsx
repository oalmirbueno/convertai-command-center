import { useMemo } from "react";
import type { DashboardData } from "./dashboardHelpers";
import { typeLabels, relativeTime, formatDate } from "./dashboardHelpers";
import {
  FileText, TrendingUp, Sparkles, BookOpen,
} from "lucide-react";

/**
 * Generates a human-readable project summary entirely client-side
 * from updates, tasks and milestones. No AI credits used.
 */
export function useAutoSummary(data: Omit<DashboardData, "clientId" | "clientName" | "onSelectProject">) {
  return useMemo(() => {
    const paragraphs: string[] = [];
    const { activeProjects, doneProjects, tasks, doingTasks, doneTasks, milestones, completedMilestonesCount, totalMilestones, recentUpdates, pendingFiles, totalFiles, avgProgress } = data;

    // 1. Overall status
    if (activeProjects.length === 0 && doneProjects.length === 0) {
      return ["Nenhum projeto foi iniciado ainda. Assim que um novo projeto for criado, o resumo aparecerá aqui automaticamente."];
    }

    if (activeProjects.length > 0) {
      const names = activeProjects.map((p: any) => p.name);
      const projectText = names.length === 1
        ? `O projeto "${names[0]}" está em andamento`
        : `Os projetos ${names.map((n: string) => `"${n}"`).join(", ")} estão em andamento`;
      paragraphs.push(`${projectText} com progresso geral de ${avgProgress}%.`);
    }

    // 2. What's being worked on right now
    if (doingTasks.length > 0) {
      const taskNames = doingTasks.slice(0, 3).map((t: any) => t.title);
      const extra = doingTasks.length > 3 ? ` e mais ${doingTasks.length - 3}` : "";
      paragraphs.push(`Neste momento, a equipe está trabalhando em: ${taskNames.join(", ")}${extra}.`);
    }

    // 3. Recent completions
    const recentDone = doneTasks.slice(0, 5);
    if (recentDone.length > 0) {
      const taskNames = recentDone.map((t: any) => t.title);
      paragraphs.push(`Recentemente foram concluídas: ${taskNames.join(", ")}.`);
    }

    // 4. Milestones progress
    if (totalMilestones > 0) {
      const pending = totalMilestones - completedMilestonesCount;
      if (completedMilestonesCount === 0) {
        paragraphs.push(`O projeto possui ${totalMilestones} etapas planejadas. A primeira etapa está em andamento.`);
      } else if (pending === 0) {
        paragraphs.push(`Todas as ${totalMilestones} etapas foram concluídas com sucesso.`);
      } else {
        const nextMilestone = milestones.find((m: any) => m.status !== "completed");
        const nextText = nextMilestone ? ` A próxima etapa é "${nextMilestone.title}".` : "";
        paragraphs.push(`${completedMilestonesCount} de ${totalMilestones} etapas foram concluídas.${nextText}`);
      }
    }

    // 5. Deliverables
    if (totalFiles > 0) {
      paragraphs.push(`Até o momento, ${totalFiles} ${totalFiles === 1 ? "arquivo foi entregue" : "arquivos foram entregues"} para revisão e aprovação.`);
    }

    // 6. Pending actions
    if (pendingFiles.length > 0) {
      paragraphs.push(`Existem ${pendingFiles.length} ${pendingFiles.length === 1 ? "entrega aguardando" : "entregas aguardando"} sua aprovação. Acesse a aba de aprovações para revisar.`);
    }

    // 7. Completed projects
    if (doneProjects.length > 0) {
      const names = doneProjects.map((p: any) => p.name);
      paragraphs.push(`${doneProjects.length === 1 ? "O projeto" : "Os projetos"} ${names.map((n: string) => `"${n}"`).join(", ")} ${doneProjects.length === 1 ? "foi concluído" : "foram concluídos"} e entregues.`);
    }

    return paragraphs;
  }, [data]);
}

interface AutoSummaryCardProps {
  data: Omit<DashboardData, "clientId" | "clientName" | "onSelectProject">;
  firstName: string;
}

export default function AutoSummaryCard({ data, firstName }: AutoSummaryCardProps) {
  const paragraphs = useAutoSummary(data);

  if (paragraphs.length === 0) return null;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
          <BookOpen className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Resumo do seu projeto</h3>
          <p className="text-[10px] text-muted-foreground">Gerado automaticamente com base nas atualizações</p>
        </div>
      </div>
      <div className="px-5 py-4 space-y-3">
        {paragraphs.map((p, i) => (
          <p key={i} className="text-[13px] text-foreground/85 leading-relaxed">
            {p}
          </p>
        ))}
      </div>
    </div>
  );
}
