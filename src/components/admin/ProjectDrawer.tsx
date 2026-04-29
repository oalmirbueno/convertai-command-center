import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { notifyOpsMilestone, notifyOpsUpdate } from "@/lib/opsSync";
import { useQueryClient } from "@tanstack/react-query";
import { useTasks, useMilestones } from "@/hooks/useSupabaseData";
import { toast } from "sonner";
import { Slider } from "@/components/ui/slider";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { X, Edit3, Trash2, ExternalLink, Eye, Users, CheckCircle2, Clock, Circle, LayoutGrid } from "lucide-react";
import ConfirmModal from "@/components/ui/ConfirmModal";

const STATUS_OPTIONS = [
  { value: "planning", label: "Planejamento" },
  { value: "active", label: "Ativo" },
  { value: "review", label: "Revisão" },
  { value: "paused", label: "Pausado" },
  { value: "done", label: "Concluído" },
];

const statusDotColors: Record<string, string> = {
  active: "bg-info", review: "bg-warning", planning: "bg-muted-foreground",
  paused: "bg-muted-foreground", done: "bg-success",
};

interface Props {
  project: any;
  open: boolean;
  onClose: () => void;
  onEdit: (project: any) => void;
}

export default function ProjectDrawer({ project, open, onClose, onEdit }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: tasks } = useTasks(project?.id);
  const { data: milestones } = useMilestones(project?.id);
  const [localProgress, setLocalProgress] = useState<number | null>(null);
  const [currentStatus, setCurrentStatus] = useState(project?.status || "planning");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Sync status when project changes
  useEffect(() => {
    if (project) {
      setCurrentStatus(project.status);
      setLocalProgress(null);
    }
  }, [project]);

  if (!project) return null;

  const progress = localProgress ?? project.progress;

  const handleStatusChange = async (newStatus: string) => {
    setCurrentStatus(newStatus);
    await supabase.from("projects").update({ status: newStatus }).eq("id", project.id);
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (authUser) {
      const { data: upd } = await supabase.from("updates").insert({
        project_id: project.id, author_id: authUser.id,
        message: `Projeto "${project.name}": status → ${STATUS_OPTIONS.find(s => s.value === newStatus)?.label || newStatus}`,
        update_type: "progress",
      }).select().single();
      notifyOpsUpdate(upd);
    }
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    toast.success("Status atualizado");
  };

  const handleProgressCommit = async (val: number[]) => {
    const value = val[0];
    setLocalProgress(value);
    await supabase.from("projects").update({ progress: value }).eq("id", project.id);
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (authUser) {
      const { data: upd } = await supabase.from("updates").insert({
        project_id: project.id, author_id: authUser.id,
        message: `Projeto "${project.name}": progresso atualizado para ${value}%`,
        update_type: "progress",
      }).select().single();
      notifyOpsUpdate(upd);
    }
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    toast.success("Progresso atualizado");
  };

  const handleDelete = async () => {
    await supabase.from("tasks").delete().eq("project_id", project.id);
    await supabase.from("milestones").delete().eq("project_id", project.id);
    await supabase.from("updates").delete().eq("project_id", project.id);
    await supabase.from("projects").delete().eq("id", project.id);
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    toast.success("Projeto excluído");
    setConfirmDelete(false);
    onClose();
  };

  // Team: unique assignees from tasks
  const teamMap = new Map<string, { name: string; count: number }>();
  (tasks || []).forEach((t: any) => {
    if (t.assigned_to && t.assignee?.full_name) {
      const existing = teamMap.get(t.assigned_to);
      if (existing) existing.count++;
      else teamMap.set(t.assigned_to, { name: t.assignee.full_name, count: 1 });
    }
  });

  // Task counts by status
  const taskCounts = { backlog: 0, todo: 0, doing: 0, review: 0, done: 0 };
  (tasks || []).forEach((t: any) => {
    if (t.status in taskCounts) (taskCounts as any)[t.status]++;
  });
  const totalTasks = (tasks || []).length;

  const formatDate = (d: string) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  };

  const milestoneIcon = (status: string) => {
    if (status === "done") return <CheckCircle2 className="w-3.5 h-3.5 text-success" />;
    if (status === "in_progress") return <Clock className="w-3.5 h-3.5 text-info" />;
    return <Circle className="w-3.5 h-3.5 text-muted-foreground" />;
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-[420px] max-w-[90vw] bg-card border-l border-border p-0 overflow-y-auto" side="right">
        <div className="p-5 space-y-5">
          {/* Header */}
          <SheetHeader className="space-y-1">
            <SheetTitle className="text-base font-semibold text-foreground pr-6">{project.name}</SheetTitle>
            <p className="text-xs text-muted-foreground">{project.client?.company_name || project.client?.full_name}</p>
          </SheetHeader>

          {/* Status pills */}
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Status</p>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_OPTIONS.map(s => (
                <button key={s.value} onClick={() => handleStatusChange(s.value)}
                  className={`text-[11px] px-3 py-1 rounded-full border cursor-pointer transition-colors ${currentStatus === s.value ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground bg-transparent"}`}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Progress */}
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Progresso</p>
            <Slider
              defaultValue={[project.progress]}
              value={[progress]}
              max={100}
              step={5}
              onValueChange={(val) => setLocalProgress(val[0])}
              onValueCommit={handleProgressCommit}
              className="w-full"
            />
            <p className="text-xs font-mono text-muted-foreground text-right">{progress}%</p>
          </div>

          {/* Info */}
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Informações</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-muted-foreground">Tipo</span>
                <p className="text-foreground capitalize">{project.project_type?.replace("_", " ")}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Início</span>
                <p className="text-foreground">{formatDate(project.start_date)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Prazo</span>
                <p className="text-foreground">{formatDate(project.deadline)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Status</span>
                <div className="flex items-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full ${statusDotColors[project.status] || "bg-muted-foreground"}`} />
                  <p className="text-foreground">{STATUS_OPTIONS.find(s => s.value === project.status)?.label}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Description */}
          {project.description && (
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Descrição</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{project.description}</p>
            </div>
          )}

          {/* Team */}
          {teamMap.size > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Equipe do Projeto</p>
              <div className="space-y-1.5">
                {Array.from(teamMap.entries()).map(([id, { name, count }]) => (
                  <div key={id} className="flex items-center gap-2 text-xs">
                    <Users className="w-3 h-3 text-muted-foreground" />
                    <span className="text-foreground">{name}</span>
                    <span className="text-muted-foreground">— {count} task{count > 1 ? "s" : ""}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tasks summary */}
          {totalTasks > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Tarefas</p>
              <div className="flex gap-3 text-xs">
                {taskCounts.backlog > 0 && <span className="text-muted-foreground">Backlog: {taskCounts.backlog}</span>}
                {taskCounts.todo > 0 && <span className="text-muted-foreground">To-do: {taskCounts.todo}</span>}
                {taskCounts.doing > 0 && <span className="text-info">Doing: {taskCounts.doing}</span>}
                {taskCounts.review > 0 && <span className="text-warning">Review: {taskCounts.review}</span>}
                {taskCounts.done > 0 && <span className="text-success">Done: {taskCounts.done}</span>}
              </div>
              <button onClick={() => { onClose(); navigate("/kanban"); }}
                className="text-[11px] text-primary hover:underline cursor-pointer flex items-center gap-1 bg-transparent border-none p-0">
                <ExternalLink className="w-3 h-3" /> Ver no Kanban
              </button>
            </div>
          )}

          {/* Milestones */}
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Milestones</p>
            {(!milestones || milestones.length === 0) ? (
              <p className="text-xs text-muted-foreground">Nenhum milestone cadastrado</p>
            ) : (
              <div className="space-y-2">
                {(milestones || []).map((m: any) => (
                  <div key={m.id} className="flex items-center gap-2">
                    {m.status === "completed" ? (
                      <div className="w-5 h-5 rounded-full bg-success flex items-center justify-center shrink-0">
                        <CheckCircle2 className="w-3 h-3 text-success-foreground" />
                      </div>
                    ) : m.status === "in_progress" ? (
                      <div className="w-5 h-5 rounded-full border-2 border-primary shrink-0" />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-secondary shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-foreground">{m.title}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {new Date(m.target_date).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="space-y-2 pt-2 border-t border-border">
            <button onClick={() => { onClose(); onEdit(project); }}
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-muted-foreground hover:text-foreground hover:bg-secondary/50 cursor-pointer bg-transparent border-none text-left transition-colors">
              <Edit3 className="w-3.5 h-3.5" /> Editar Projeto
            </button>
            <button onClick={() => { onClose(); navigate(`/kanban?project=${project.id}`); }}
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-muted-foreground hover:text-foreground hover:bg-secondary/50 cursor-pointer bg-transparent border-none text-left transition-colors">
              <LayoutGrid className="w-3.5 h-3.5" /> Abrir Kanban
            </button>
            <button onClick={() => { onClose(); navigate(`/ver-como-cliente?project=${project.id}`); }}
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-muted-foreground hover:text-foreground hover:bg-secondary/50 cursor-pointer bg-transparent border-none text-left transition-colors">
              <Eye className="w-3.5 h-3.5" /> Ver como Cliente
            </button>
            <button onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-destructive hover:bg-destructive/10 cursor-pointer bg-transparent border-none text-left transition-colors">
              <Trash2 className="w-3.5 h-3.5" /> Excluir Projeto
            </button>
          </div>

          <ConfirmModal
            open={confirmDelete}
            title="Excluir projeto"
            description={`O projeto "${project.name}" e todos os dados relacionados (tarefas, milestones, atualizações) serão removidos permanentemente.`}
            onConfirm={handleDelete}
            onCancel={() => setConfirmDelete(false)}
          />

        </div>
      </SheetContent>
    </Sheet>
  );
}
