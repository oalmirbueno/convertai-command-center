import { useAuth } from "@/contexts/AuthContext";
import { useProjects } from "@/hooks/useSupabaseData";
import CircularProgress from "./CircularProgress";
import { Skeleton } from "@/components/ui/skeleton";

const statusDotStyles: Record<string, string> = {
  active: "bg-success pulse-dot",
  review: "bg-warning",
  planning: "bg-info",
  done: "bg-success",
  paused: "bg-muted-foreground",
};

const typeColors: Record<string, string> = {
  social_media: "text-primary",
  traffic: "text-info",
  automation: "text-accent",
  site: "text-success",
  landing_page: "text-success",
  event: "text-warning",
  other: "text-muted-foreground",
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

interface ProjectCanvasProps {
  onSelectProject: (project: any) => void;
}

export default function ProjectCanvas({ onSelectProject }: ProjectCanvasProps) {
  const { profile } = useAuth();
  const { data: projects, isLoading } = useProjects();

  const allProjects = projects || [];
  const activeProjects = allProjects.filter((p: any) => p.status !== "done");
  const reviewProjects = allProjects.filter((p: any) => p.status === "review");
  const doneProjects = allProjects.filter((p: any) => p.status === "done");

  const formatDate = (d: string) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  };

  return (
    <div className="animate-fade-in" data-tour="client-canvas">
      {/* Greeting */}
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-foreground">
          Olá, {profile?.company_name || profile?.full_name} 👋
        </h1>
        <p className="text-[13px] text-muted-foreground mt-1">Acompanhe seus projetos em tempo real.</p>
      </div>

      {/* Stats inline */}
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground mb-8">
        <span>Total: <span className="text-foreground font-medium">{allProjects.length}</span></span>
        <span className="text-border">•</span>
        <span>Ativos: <span className="text-foreground font-medium">{activeProjects.length}</span></span>
        <span className="text-border">•</span>
        <span>Aprovação: <span className="text-foreground font-medium">{reviewProjects.length}</span></span>
        <span className="text-border">•</span>
        <span>Concluídos: <span className="text-foreground font-medium">{doneProjects.length}</span></span>
      </div>

      {/* Canvas */}
      <div className="dot-grid-bg rounded-2xl min-h-[400px] p-6">
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-[260px] w-full rounded-2xl" />
            ))}
          </div>
        ) : !projects?.length ? (
          <div className="text-sm text-muted-foreground py-16 text-center">
            Nenhum projeto encontrado.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5 canvas-stagger">
            {projects.map((p: any) => (
              <div
                key={p.id}
                onClick={() => onSelectProject(p)}
                className="group bg-card border border-border rounded-2xl p-5 sm:p-6 cursor-pointer hover:border-muted-foreground/40 hover:-translate-y-0.5 transition-all duration-200"
                style={{ width: "100%" }}
              >
                {/* Type + Status */}
                <div className="flex items-center gap-2 mb-4">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${statusDotStyles[p.status] || "bg-muted-foreground"}`} />
                  <span className={`text-[10px] uppercase tracking-widest font-medium ${typeColors[p.project_type] || "text-muted-foreground"}`}>
                    {typeLabels[p.project_type] || p.project_type}
                  </span>
                </div>

                {/* Name */}
                <p className="text-base font-semibold text-foreground leading-snug mb-5">{p.name}</p>

                {/* Circular progress */}
                <div className="flex justify-center mb-5">
                  <CircularProgress progress={p.progress} />
                </div>

                {/* Deadline + progress bar */}
                <p className="text-[11px] text-muted-foreground mb-2">Prazo: {formatDate(p.deadline)}</p>
                <div className="h-[2px] rounded-full bg-secondary overflow-hidden mb-3">
                  <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${p.progress}%` }} />
                </div>

                {/* Hover CTA */}
                <p className="text-[11px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  Clique para explorar →
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
