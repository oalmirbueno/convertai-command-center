import { useState } from "react";
import { useProjects } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { Plus, MoreHorizontal, Clock } from "lucide-react";
import CreateProjectModal from "@/components/admin/CreateProjectModal";
import ProjectDrawer from "@/components/admin/ProjectDrawer";

const STATUS_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "planning", label: "Planejamento" },
  { value: "active", label: "Ativo" },
  { value: "review", label: "Revisão" },
  { value: "paused", label: "Pausado" },
  { value: "done", label: "Concluído" },
];

const statusDotColors: Record<string, string> = {
  active: "bg-info pulse-dot",
  review: "bg-warning",
  planning: "bg-muted-foreground",
  paused: "bg-muted-foreground",
  done: "bg-success",
};

const statusLabels: Record<string, string> = {
  planning: "Planejamento", active: "Ativo", review: "Revisão", paused: "Pausado", done: "Concluído",
};

export default function Projects() {
  const { profile } = useAuth();
  const { data: projects, isLoading } = useProjects();
  const isAdmin = profile?.role === "admin";

  const [filter, setFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editProject, setEditProject] = useState<any>(null);
  const [drawerProject, setDrawerProject] = useState<any>(null);

  const filtered = (projects || []).filter((p: any) => {
    if (!isAdmin && p.client_id !== profile?.id) return false;
    if (filter !== "all" && p.status !== filter) return false;
    return true;
  });

  const formatDate = (d: string) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <p className="heading-page">Projetos</p>
        {isAdmin && (
          <button onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer">
            <Plus className="w-3.5 h-3.5" /> Novo Projeto
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-hidden md:flex-wrap md:overflow-visible md:pb-0">
        {STATUS_OPTIONS.map(s => (
          <button key={s.value} onClick={() => setFilter(s.value)}
            className={`px-3 py-1.5 rounded-full text-[12px] cursor-pointer transition-colors border flex-shrink-0 whitespace-nowrap ${filter === s.value ? "bg-primary text-primary-foreground border-primary" : "bg-transparent text-muted-foreground border-border hover:text-foreground"}`}>
            {s.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Nenhum projeto encontrado.</div>
      ) : (
        <div className="space-y-1 stagger-children">
          {filtered.map((p: any) => (
            <div key={p.id}
              className="bg-card border border-border rounded-xl px-5 py-4 hover:border-muted-foreground/30 transition-colors relative"
            >
              <div className="flex items-center gap-4">
                <div className={`w-2 h-2 rounded-full shrink-0 ${statusDotColors[p.status] || "bg-muted-foreground"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground">{p.name}</span>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">{p.project_type?.replace("_", " ")}</span>
                    <span className="text-[10px] text-muted-foreground/60">{statusLabels[p.status]}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{p.client?.company_name || p.client?.full_name}</p>
                </div>
                <div className="w-28 hidden md:block">
                  <div className="h-[3px] rounded-full bg-secondary overflow-hidden">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${p.progress}%` }} />
                  </div>
                  <p className="text-xs font-mono text-muted-foreground mt-1 text-right">{p.progress}%</p>
                </div>
                <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  {formatDate(p.deadline)}
                </div>
                {isAdmin && (
                  <button onClick={() => setDrawerProject(p)}
                    className="text-muted-foreground hover:text-foreground cursor-pointer bg-transparent border-none p-1 rounded hover:bg-secondary">
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateProjectModal open={createOpen || !!editProject} onClose={() => { setCreateOpen(false); setEditProject(null); }} editProject={editProject} />

      {isAdmin && (
        <ProjectDrawer
          project={drawerProject}
          open={!!drawerProject}
          onClose={() => setDrawerProject(null)}
          onEdit={(p) => { setDrawerProject(null); setEditProject(p); }}
        />
      )}
    </div>
  );
}
