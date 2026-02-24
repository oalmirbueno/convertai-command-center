import { useProjects, useUpdates, useTasks } from "@/hooks/useSupabaseData";
import { Clock, AlertTriangle, Plus, UserPlus, Upload, FileText, MoreHorizontal, Trash2, Edit3, Link2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import CreateProjectModal from "@/components/admin/CreateProjectModal";
import CreateClientModal from "@/components/admin/CreateClientModal";
import MeetingNotesModal from "@/components/admin/MeetingNotesModal";
import BriefingLinkModal from "@/components/admin/BriefingLinkModal";
import { Slider } from "@/components/ui/slider";
import ConfirmModal from "@/components/ui/ConfirmModal";

const statusDotColors: Record<string, string> = {
  active: "bg-info pulse-dot",
  review: "bg-warning",
  planning: "bg-muted-foreground",
  paused: "bg-muted-foreground",
  done: "bg-success",
};

const updateTypeDotColors: Record<string, string> = {
  task: "bg-success",
  creative: "bg-primary",
  milestone: "bg-info",
  alert: "bg-warning",
  report: "bg-primary",
  system: "bg-muted-foreground",
};

const STATUS_OPTIONS = [
  { value: "planning", label: "Planejamento" },
  { value: "active", label: "Ativo" },
  { value: "review", label: "Revisão" },
  { value: "paused", label: "Pausado" },
  { value: "done", label: "Concluído" },
];

export default function AdminDashboard() {
  const { data: projects, isLoading: loadingProjects } = useProjects();
  const { data: updates, isLoading: loadingUpdates } = useUpdates();
  const { data: allTasks } = useTasks();
  const [hoveredProject, setHoveredProject] = useState<string | null>(null);
  const [menuProject, setMenuProject] = useState<string | null>(null);
  const [editProject, setEditProject] = useState<any>(null);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createClientOpen, setCreateClientOpen] = useState(false);
  const [meetingNotesOpen, setMeetingNotesOpen] = useState(false);
  const [briefingLinkOpen, setBriefingLinkOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const activeProjects = projects?.filter((p: any) => p.status !== "done") || [];
  const urgentTasks = (allTasks || []).filter((t: any) => t.priority === "urgent" || t.priority === "high").slice(0, 5);

  const stats = [
    { label: "Projetos Ativos", value: String(activeProjects.length), color: "bg-primary" },
    { label: "Clientes", value: "—", color: "bg-success" },
    { label: "Tarefas Pendentes", value: String((allTasks || []).filter((t: any) => t.status !== "done").length), color: "bg-warning" },
    { label: "Em Revisão", value: String(projects?.filter((p: any) => p.status === "review").length || 0), color: "bg-info" },
  ];

  const formatDate = (d: string) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  };

  const handleStatusChange = async (projectId: string, newStatus: string) => {
    await supabase.from("projects").update({ status: newStatus }).eq("id", projectId);
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    toast.success("Status atualizado");
    setMenuProject(null);
  };

  const handleProgressChange = async (projectId: string, progress: number) => {
    await supabase.from("projects").update({ progress }).eq("id", projectId);
    queryClient.invalidateQueries({ queryKey: ["projects"] });
  };

  const [confirmDeleteProject, setConfirmDeleteProject] = useState<string | null>(null);

  const handleDeleteProject = async () => {
    if (!confirmDeleteProject) return;
    await supabase.from("tasks").delete().eq("project_id", confirmDeleteProject);
    await supabase.from("milestones").delete().eq("project_id", confirmDeleteProject);
    await supabase.from("updates").delete().eq("project_id", confirmDeleteProject);
    await supabase.from("projects").delete().eq("id", confirmDeleteProject);
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    toast.success("Projeto excluído");
    setConfirmDeleteProject(null);
    setMenuProject(null);
  };

  const quickActions = [
    { label: "Novo Projeto", icon: Plus, action: () => setCreateProjectOpen(true) },
    { label: "Novo Cliente", icon: UserPlus, action: () => setCreateClientOpen(true) },
    { label: "Nova Ata de Reunião", icon: FileText, action: () => setMeetingNotesOpen(true) },
    { label: "Gerar Link Briefing", icon: Link2, action: () => setBriefingLinkOpen(true) },
    { label: "Upload", icon: Upload, action: () => navigate("/arquivos") },
  ];

  return (
    <div className="space-y-8 animate-fade-in">
      <p className="heading-page">Dashboard</p>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-children" data-tour="dash-stats">
        {stats.map((s) => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-5 hover:border-muted-foreground/30 transition-colors">
            <p className="label-sm">{s.label}</p>
            <p className="font-mono font-light text-[28px] leading-none text-foreground mt-2">{s.value}</p>
            <div className={`h-0.5 w-8 ${s.color} rounded-full mt-3 opacity-60`} />
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2" data-tour="dash-quick-actions">
        {quickActions.map((a) => (
          <button
            key={a.label}
            onClick={a.action}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[13px] text-muted-foreground border border-border hover:border-muted-foreground/50 hover:text-foreground transition-colors cursor-pointer bg-transparent"
          >
            <a.icon className="w-3.5 h-3.5" />
            {a.label}
          </button>
        ))}
      </div>

      {/* Projects */}
      <div>
        <p className="label-sm mb-4">Projetos Ativos</p>
        {loadingProjects ? (
          <div className="text-sm text-muted-foreground py-8 text-center">Carregando...</div>
        ) : activeProjects.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">Nenhum projeto encontrado.</div>
        ) : (
          <div className="space-y-0.5 stagger-children">
            {activeProjects.map((p: any) => {
              const isHovered = hoveredProject === p.id;
              const showMenu = menuProject === p.id;
              return (
                <div
                  key={p.id}
                  className="bg-card border border-border rounded-xl px-5 py-4 cursor-pointer hover:border-muted-foreground/30 transition-colors relative"
                  onMouseEnter={() => setHoveredProject(p.id)}
                  onMouseLeave={() => { setHoveredProject(null); setMenuProject(null); }}
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${statusDotColors[p.status] || "bg-muted-foreground"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{p.name}</span>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">{p.project_type?.replace("_", " ")}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{p.client?.company_name || p.client?.full_name}</p>
                    </div>
                    <div className="w-32 hidden md:block">
                      <div className="h-[3px] rounded-full bg-secondary overflow-hidden">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${p.progress}%` }} />
                      </div>
                      <p className="text-xs font-mono text-muted-foreground mt-1 text-right">{p.progress}%</p>
                    </div>
                    <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      {formatDate(p.deadline)}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setMenuProject(showMenu ? null : p.id); }}
                      className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none p-1 rounded hover:bg-secondary"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </div>

                  {showMenu && (
                    <div className="absolute right-4 top-full z-50 bg-popover border border-border rounded-xl p-1.5 shadow-lg w-48 animate-in fade-in zoom-in-95 duration-150">
                      <button onClick={(e) => { e.stopPropagation(); setEditProject(p); setMenuProject(null); }}
                        className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors cursor-pointer bg-transparent border-none text-left">
                        <Edit3 className="w-3.5 h-3.5" /> Editar
                      </button>
                      <div className="px-3 py-2">
                        <p className="text-[11px] text-muted-foreground mb-1.5">Status</p>
                        <div className="flex flex-wrap gap-1">
                          {STATUS_OPTIONS.map((s) => (
                            <button key={s.value} onClick={(e) => { e.stopPropagation(); handleStatusChange(p.id, s.value); }}
                              className={`text-[10px] px-2 py-0.5 rounded-full border cursor-pointer transition-colors ${p.status === s.value ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground bg-transparent"}`}>
                              {s.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="px-3 py-2">
                        <p className="text-[11px] text-muted-foreground mb-1.5">Progresso: {p.progress}%</p>
                        <Slider defaultValue={[p.progress]} max={100} step={5} onValueCommit={(val) => handleProgressChange(p.id, val[0])} className="w-full" />
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteProject(p.id); }}
                        className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-destructive hover:bg-destructive/10 transition-colors cursor-pointer bg-transparent border-none text-left">
                        <Trash2 className="w-3.5 h-3.5" /> Excluir
                      </button>
                    </div>
                  )}

                  {isHovered && !showMenu && p.description && (
                    <div className="mt-3 pt-3 border-t border-border flex items-center justify-between animate-fade-in">
                      <p className="text-xs text-muted-foreground">{p.description}</p>
                      <button className="text-xs text-primary hover:underline">Abrir</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Updates + Urgent Tasks */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="label-sm mb-4">Atualizações Recentes</p>
          {loadingUpdates ? (
            <div className="text-sm text-muted-foreground py-4 text-center">Carregando...</div>
          ) : (updates || []).length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">Nenhuma atualização.</div>
          ) : (
          <div className="space-y-0">
              {(updates || []).map((u: any, i: number) => (
                <div key={u.id}>
                  {i > 0 && <div className="border-t border-border" />}
                  <div
                    className="flex items-start gap-3 py-3 cursor-pointer hover:bg-secondary/30 rounded-lg transition-colors px-1"
                    onClick={() => {
                      if (u.update_type === "system" && u.message.includes("pedido")) navigate("/pedidos");
                      else if (u.update_type === "creative") navigate("/arquivos");
                      else if (u.project_id) navigate("/projetos");
                    }}
                  >
                    <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${updateTypeDotColors[u.update_type] || "bg-muted-foreground"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-foreground">{u.message}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{new Date(u.created_at).toLocaleString("pt-BR")}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <p className="label-sm mb-4 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-warning" />
            Tarefas Urgentes
          </p>
          {urgentTasks.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">Nenhuma tarefa urgente.</div>
          ) : (
            <div className="space-y-0">
              {urgentTasks.map((t: any, i: number) => (
                <div key={t.id}>
                  {i > 0 && <div className="border-t border-border" />}
                  <div className="flex items-center gap-3 py-3">
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.priority === "urgent" ? "bg-destructive" : "bg-warning"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-foreground">{t.title}</p>
                      <p className="text-[11px] text-muted-foreground">{t.project?.name}</p>
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground">{t.due_date ? new Date(t.due_date).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : ""}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <CreateProjectModal open={createProjectOpen || !!editProject} onClose={() => { setCreateProjectOpen(false); setEditProject(null); }} editProject={editProject} />
      <CreateClientModal open={createClientOpen} onClose={() => setCreateClientOpen(false)} />
      <MeetingNotesModal open={meetingNotesOpen} onClose={() => setMeetingNotesOpen(false)} />
      <BriefingLinkModal open={briefingLinkOpen} onClose={() => setBriefingLinkOpen(false)} />

      <ConfirmModal
        open={!!confirmDeleteProject}
        title="Excluir projeto"
        description="Todas as tarefas, milestones e atualizações deste projeto serão removidos permanentemente."
        onConfirm={handleDeleteProject}
        onCancel={() => setConfirmDeleteProject(null)}
      />
    </div>
  );
}
