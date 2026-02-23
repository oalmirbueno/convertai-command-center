import { useTasks } from "@/hooks/useSupabaseData";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

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
  const { data: tasks } = useTasks(project.id);

  const formatDate = (d: string) => {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  };

  // Get unique team members from tasks
  const teamMembers = tasks
    ? Array.from(
        new Map(
          tasks
            .filter((t: any) => t.assigned_to && t.assignee)
            .map((t: any) => [t.assigned_to, t.assignee])
        ).values()
      )
    : [];

  const objectives = project.objectives
    ? project.objectives.split("\n").filter((o: string) => o.trim())
    : [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* Left col 60% */}
      <div className="lg:col-span-3 space-y-6">
        {/* About */}
        <div>
          <p className="label-sm mb-3">Sobre o Projeto</p>
          <p className="text-sm text-foreground/80 leading-relaxed">
            {project.description || "Sem descrição disponível."}
          </p>
          {project.scope && (
            <div className="mt-4">
              <p className="label-sm mb-2">Escopo</p>
              <p className="text-[13px] text-foreground/70 leading-relaxed">{project.scope}</p>
            </div>
          )}
        </div>

        {/* Objectives */}
        {objectives.length > 0 && (
          <div>
            <p className="label-sm mb-3">Objetivos</p>
            <ul className="space-y-2">
              {objectives.map((obj: string, i: number) => (
                <li key={i} className="flex items-start gap-2.5 text-[13px] text-foreground/70">
                  <div className="w-1 h-1 rounded-full bg-primary mt-2 shrink-0" />
                  {obj}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Right col 40% */}
      <div className="lg:col-span-2 space-y-4">
        {/* Info card */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <p className="label-sm mb-1">Informações</p>
          <div className="space-y-2.5 text-[13px]">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Início</span>
              <span className="text-foreground">{formatDate(project.start_date)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Prazo</span>
              <span className="text-foreground">{formatDate(project.deadline)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Progresso</span>
              <span className="text-foreground font-mono">{project.progress}%</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Status</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${statusBadge[project.status] || "bg-muted text-muted-foreground"}`}>
                {project.status}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Tipo</span>
              <span className="text-xs text-foreground">{typeLabels[project.project_type] || project.project_type}</span>
            </div>
          </div>
        </div>

        {/* Team card */}
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="label-sm mb-3">Equipe</p>
          {teamMembers.length === 0 ? (
            <p className="text-xs text-muted-foreground">Equipe não atribuída</p>
          ) : (
            <div className="space-y-2.5">
              {(teamMembers as any[]).map((member: any, i: number) => (
                <div key={i} className="flex items-center gap-2.5">
                  <Avatar className="w-7 h-7">
                    <AvatarFallback className="text-[10px] bg-secondary text-muted-foreground">
                      {member.full_name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-[13px] text-foreground">{member.full_name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
