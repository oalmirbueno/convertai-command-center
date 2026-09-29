import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { notifyOpsMilestone, notifyOpsUpdate } from "@/lib/opsSync";
import { useQueryClient } from "@tanstack/react-query";
import { useTasks, useMilestones } from "@/hooks/useSupabaseData";
import { toast } from "sonner";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Edit3, Trash2, ExternalLink, Eye, CheckCircle2, Clock, Circle, LayoutGrid } from "lucide-react";
import { Secao, SeletorCompacto, botao, juntar, texto } from "@/components/sistema";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { ProjectPipelineChecklist } from "./ProjectPipeline";
import { projectHasLinkedRequestTasks } from "@/lib/requestTaskWorkflow";
// Frente DOC (29/09): projeto concluído registra a entrega e oferece o documento (gerar pede Confirmar).
import BotaoDocumentoDaEntrega from "@/components/documentos/BotaoDocumentoDaEntrega";
import { registrarEntregaSemTravar } from "@/lib/documentos/registrarEntrega";

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
    const anterior = currentStatus;
    setCurrentStatus(newStatus);
    const { error: erroDoStatus } = await supabase.from("projects").update({ status: newStatus }).eq("id", project.id);
    if (erroDoStatus) {
      setCurrentStatus(anterior);
      toast.error("Status não atualizado", { description: erroDoStatus.message });
      return;
    }
    // Gancho do documento da entrega: projeto concluído fica registrado (sem custo, nada vai ao cliente).
    if (newStatus === "done" && anterior !== "done" && project.client_id) {
      void registrarEntregaSemTravar({ clientId: project.client_id, tipo: "projeto", referencia: project.id, titulo: project.name }).then((r) => {
        if (r.erro) toast.error("O documento da entrega não ficou registrado", { description: r.erro });
      });
    }
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
    try {
      if (await projectHasLinkedRequestTasks(project.id)) {
        toast.error(
          "Este projeto possui um Pedido vinculado ao Kanban e não pode ser excluído.",
        );
        setConfirmDelete(false);
        return;
      }
      await supabase.from("tasks").delete().eq("project_id", project.id);
      await supabase.from("milestones").delete().eq("project_id", project.id);
      await supabase.from("updates").delete().eq("project_id", project.id);
      await supabase.from("projects").delete().eq("id", project.id);
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Projeto excluído");
      setConfirmDelete(false);
      onClose();
    } catch (error) {
      console.error("Project delete guard failed", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível excluir o projeto.",
      );
      setConfirmDelete(false);
    }
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


  const equipe = Array.from(teamMap.values()).map(({ name, count }) => `${name.split(" ")[0]} (${count})`).join(", ");
  const resumoDasTarefas = [
    taskCounts.backlog > 0 ? `${taskCounts.backlog} no backlog` : null,
    taskCounts.todo > 0 ? `${taskCounts.todo} a fazer` : null,
    taskCounts.doing > 0 ? `${taskCounts.doing} em andamento` : null,
    taskCounts.review > 0 ? `${taskCounts.review} em revisão` : null,
    taskCounts.done > 0 ? `${taskCounts.done} concluídas` : null,
  ].filter(Boolean).join(" · ");

  return (
    // Central, como todo pop-up do painel. Rola por dentro (é janela); as
    // ações ficam presas no pé, sempre à vista.
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[88vh] max-w-lg flex-col overflow-hidden border-border bg-card p-0">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-5">
          {/* Header */}
          <DialogHeader className="space-y-0.5 text-left">
            <DialogTitle className={juntar(texto.tituloPagina, "truncate pr-8")} title={project.name}>{project.name}</DialogTitle>
            <p className={juntar(texto.auxiliar, "truncate")}>
              {[project.client?.company_name || project.client?.full_name, project.project_type?.replace("_", " ")].filter(Boolean).join(" · ")}
            </p>
          </DialogHeader>

          {/* Status e progresso lado a lado: um seletor e a régua. */}
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="min-w-0">
              <p className={juntar(texto.rotulo, "mb-1.5")}>Status</p>
              <SeletorCompacto
                rotulo="Status do projeto"
                modo="lista"
                opcoes={STATUS_OPTIONS.map((s) => ({
                  valor: s.value,
                  rotulo: s.label,
                  icone: <span className={juntar("block h-2 w-2 rounded-full", statusDotColors[s.value] || "bg-muted-foreground")} />,
                }))}
                valor={currentStatus}
                onEscolher={(v) => void handleStatusChange(v)}
                className="w-full"
              />
              {currentStatus === "done" && project.client_id && (
                <BotaoDocumentoDaEntrega
                  className="mt-2 w-full"
                  pedido={{ clientId: project.client_id, tipo: "projeto", referencia: project.id, titulo: project.name }}
                />
              )}
            </div>
            <div className="min-w-0">
              <div className="mb-1.5 flex items-center justify-between">
                <p className={texto.rotulo}>Progresso</p>
                <span className="text-[12px] tabular-nums text-muted-foreground">{progress}%</span>
              </div>
              <div className="flex h-9 items-center">
                <Slider
                  defaultValue={[project.progress]}
                  value={[progress]}
                  max={100}
                  step={5}
                  onValueChange={(val) => setLocalProgress(val[0])}
                  onValueCommit={handleProgressCommit}
                  className="w-full"
                  aria-label="Progresso do projeto"
                />
              </div>
            </div>
          </div>

          {/* Datas */}
          <dl className="mt-4 grid grid-cols-2 gap-4">
            <div className="min-w-0">
              <dt className={texto.rotulo}>Início</dt>
              <dd className={juntar(texto.corpo, "mt-0.5 tabular-nums")}>{formatDate(project.start_date) || "-"}</dd>
            </div>
            <div className="min-w-0">
              <dt className={texto.rotulo}>Prazo</dt>
              <dd className={juntar(texto.corpo, "mt-0.5 tabular-nums")}>{formatDate(project.deadline) || "-"}</dd>
            </div>
          </dl>

          {/* Descrição */}
          {project.description && (
            <p className={juntar(texto.corpo, "mt-4 whitespace-pre-line text-muted-foreground")}>{project.description}</p>
          )}

          {/* Pipeline audiovisual (opcional) */}
          <div className="mt-5 border-t border-border pt-4">
            <ProjectPipelineChecklist
              projectId={project.id}
              projectName={project.name}
              pipeline={project.pipeline}
            />
          </div>

          {/* Equipe e tarefas: estado em uma linha cada. */}
          {(teamMap.size > 0 || totalTasks > 0) && (
            <div className="mt-5 space-y-2 border-t border-border pt-4">
              {teamMap.size > 0 && (
                <p className={texto.auxiliar}>
                  <span className="text-foreground">Equipe</span> {equipe}
                </p>
              )}
              {totalTasks > 0 && (
                <div className="flex min-w-0 items-center justify-between">
                  <p className={juntar(texto.auxiliar, "mr-3 min-w-0 truncate")} title={resumoDasTarefas}>
                    <span className="text-foreground">{totalTasks} tarefas</span> {resumoDasTarefas}
                  </p>
                  <button
                    type="button"
                    onClick={() => { onClose(); navigate("/kanban"); }}
                    className={juntar(botao.discreto, "h-7 shrink-0 px-2 text-[12px]")}
                  >
                    <ExternalLink className="mr-1 h-3 w-3" aria-hidden="true" /> Ver no Kanban
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Milestones */}
          <Secao titulo="Marcos" nivel={3} divisoria className="mt-5" descricao={milestones && milestones.length > 0 ? `${milestones.length} ${milestones.length === 1 ? "marco" : "marcos"}` : undefined}>
            {(!milestones || milestones.length === 0) ? (
              <p className={texto.auxiliar}>Nenhum milestone cadastrado</p>
            ) : (
              <ul className="divide-y divide-border">
                {(milestones || []).map((m: any) => (
                  <li key={m.id} className="flex min-w-0 items-center py-2">
                    <span className="mr-2.5 shrink-0" aria-hidden="true">
                      {m.status === "completed" ? (
                        <CheckCircle2 className="h-4 w-4 text-success" />
                      ) : m.status === "in_progress" ? (
                        <Clock className="h-4 w-4 text-info" />
                      ) : (
                        <Circle className="h-4 w-4 text-muted-foreground" />
                      )}
                    </span>
                    <span className={juntar(texto.corpo, "mr-3 min-w-0 flex-1 truncate")}>{m.title}</span>
                    <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                      {new Date(m.target_date).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Secao>
        </div>

        {/* Ações no pé: nenhuma ocupa uma linha sozinha. */}
        <div className="flex shrink-0 items-center border-t border-border px-5 py-3">
          <button type="button" onClick={() => setConfirmDelete(true)} className={juntar(botao.perigo, "px-2.5")} aria-label="Excluir projeto" title="Excluir projeto">
            <Trash2 className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
            <span className="hidden sm:inline">Excluir</span>
          </button>
          <div className="ml-auto flex items-center [&>*+*]:ml-2">
            <button type="button" onClick={() => { onClose(); navigate(`/ver-como-cliente?project=${project.id}`); }} className={juntar(botao.secundario, "px-2.5")} aria-label="Ver como cliente" title="Ver como cliente">
              <Eye className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
              <span className="hidden sm:inline">Ver como cliente</span>
            </button>
            <button type="button" onClick={() => { onClose(); navigate(`/kanban?project=${project.id}`); }} className={juntar(botao.secundario, "px-2.5")} aria-label="Abrir Kanban" title="Abrir Kanban">
              <LayoutGrid className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
              <span className="hidden sm:inline">Kanban</span>
            </button>
            <button type="button" onClick={() => { onClose(); onEdit(project); }} className={botao.primario}>
              <Edit3 className="mr-1.5 h-4 w-4" aria-hidden="true" /> Editar
            </button>
          </div>
        </div>

        <ConfirmModal
          open={confirmDelete}
          title="Excluir projeto"
          description={`O projeto "${project.name}" e todos os dados relacionados (tarefas, milestones, atualizações) serão removidos permanentemente.`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
