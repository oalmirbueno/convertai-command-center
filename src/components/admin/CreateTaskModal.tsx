import { useState, useEffect } from "react";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { Loader2, CalendarIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { notifyOpsMilestone, notifyOpsUpdate } from "@/lib/opsSync";
import { notifyOpsTaskCreated, notifyOpsTaskUpdated } from "@/lib/opsTaskSync";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useProjects } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CampoDeEscolha, CampoDeFormulario, botao, campo, campoTexto, juntar, texto } from "@/components/sistema";
import {
  TASK_WORKSTREAM_OPTIONS,
  type TaskWorkstream,
} from "@/lib/taskWorkstreams";
import {
  TASK_DELIVERY_TYPE_OPTIONS,
  isPublishableDeliveryType,
  suggestedWorkstreamForDeliveryType,
  type TaskDeliveryType,
} from "@/lib/taskDeliveryTypes";

const PRIORITIES = [
  { value: "low", label: "Baixa" },
  { value: "medium", label: "Média" },
  { value: "high", label: "Alta" },
  { value: "urgent", label: "Urgente" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  defaultStatus?: string;
  editTask?: any;
  teamMembers?: any[];
}

export default function CreateTaskModal({ open, onClose, defaultStatus = "backlog", editTask, teamMembers = [] }: Props) {
  const { data: projects } = useProjects();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const [milestoneId, setMilestoneId] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [deliveryType, setDeliveryType] =
    useState<TaskDeliveryType | "">("");
  const [workstream, setWorkstream] = useState<TaskWorkstream>("general");
  const [assignedTo, setAssignedTo] = useState("");
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Fetch milestones for selected project
  const { data: projectMilestones } = useQuery({
    queryKey: ["milestones-for-task", projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data } = await supabase.from("milestones").select("id, title, milestone_order").eq("project_id", projectId).is("deleted_at", null).order("milestone_order", { ascending: true });
      return data || [];
    },
    enabled: !!projectId,
  });

  // BUG 3 FIX: populate fields when editing
  useEffect(() => {
    if (editTask) {
      setTitle(editTask.title || "");
      setProjectId(editTask.project_id || "");
      setMilestoneId(editTask.milestone_id || "");
      setDescription(editTask.description || "");
      setPriority(editTask.priority || "medium");
      setDeliveryType(
        (editTask.delivery_type as TaskDeliveryType) || "unspecified",
      );
      setWorkstream((editTask.workstream as TaskWorkstream) || "general");
      setAssignedTo(editTask.assigned_to || "");
      setDueDate(editTask.due_date ? new Date(editTask.due_date) : undefined);
    } else {
      setTitle("");
      setProjectId("");
      setMilestoneId("");
      setDescription("");
      setPriority("medium");
      setDeliveryType("");
      setWorkstream("general");
      setAssignedTo("");
      setDueDate(undefined);
    }
  }, [editTask, open]);

  if (!open) return null;

  const isEdit = !!editTask;
  const activeProjects = (projects || []).filter((p: any) => p.status !== "done");
  const isContentTask = isPublishableDeliveryType(deliveryType);

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error("Informe o título da tarefa");
      return;
    }
    if (!projectId) {
      toast.error("Selecione o projeto");
      return;
    }
    if (
      !isEdit
      && (!deliveryType || deliveryType === "unspecified")
    ) {
      toast.error("Selecione o tipo de entrega");
      return;
    }
    if (!isEdit && isContentTask && !description.trim()) {
      toast.error("Informe o contexto do conteúdo");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        project_id: projectId,
        milestone_id: milestoneId || null,
        description: description.trim() || null,
        priority,
        delivery_type: deliveryType || "unspecified",
        workstream,
        assigned_to: assignedTo || null,
        due_date: dueDate ? format(dueDate, "yyyy-MM-dd") : null,
        ...(isEdit ? {} : { status: defaultStatus }),
      };

      if (isEdit) {
        const { error } = await supabase.from("tasks").update(payload).eq("id", editTask.id);
        if (error) throw error;
        notifyOpsTaskUpdated(editTask.id);
        toast.success("Tarefa atualizada!");
      } else {
        const { data: inserted, error } = await supabase.from("tasks").insert(payload).select().single();
        if (error) throw error;
        if (inserted?.id) notifyOpsTaskCreated(inserted.id);
        // Create update for new task
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (authUser && projectId) {
          const { data: upd } = await supabase.from("updates").insert({
            project_id: projectId, author_id: authUser.id,
            message: `Nova tarefa criada: ${title.trim()}`, update_type: "task",
          }).select().single();
          notifyOpsUpdate(upd);
        }
        toast.success("Tarefa criada!");
      }

      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar tarefa");
    } finally {
      setSaving(false);
    }
  };


  const handleDelete = async () => {
    if (!editTask) return;
    try {
      // Mesmas guardas e mesma limpeza das outras telas.
      const { excluirTarefa } = await import("@/lib/taskDelete");
      const r = await excluirTarefa(editTask as any);
      if (!r.ok) {
        toast.error(r.mensagem);
        setConfirmDelete(false);
        return;
      }
      toast.success("Tarefa excluída");
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      setConfirmDelete(false);
      onClose();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  if (!open) return null;

  return (
    // Janela do sistema (Dialog): foco preso, Esc fecha, rola por dentro e as
    // ações ficam presas no pé (SISTEMA.md seção 10).
    // A confirmação de excluir abre no lugar da janela (a janela volta ao cancelar).
    <>
    <Dialog open={open && !confirmDelete} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[88vh] max-w-[480px] flex-col overflow-hidden border-border bg-card p-0">
        <DialogHeader className="border-b border-border px-5 py-4 text-left">
          <DialogTitle className={juntar(texto.tituloSecao, "truncate pr-8")}>{isEdit ? "Editar Tarefa" : "Nova Tarefa"}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-5">
          <CampoDeFormulario rotulo={isContentTask ? "Tema do conteúdo" : "Título"} obrigatorio>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isContentTask ? "Tema que será desenvolvido" : "Nome da tarefa"} className={campo} />
          </CampoDeFormulario>

          <CampoDeFormulario rotulo="Projeto" obrigatorio>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={campo}>
              <option value="">Selecionar projeto...</option>
              {activeProjects.map((p: any) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </CampoDeFormulario>

          {projectId && (projectMilestones || []).length > 0 && (
            <CampoDeFormulario rotulo="Milestone">
              <select value={milestoneId} onChange={(e) => setMilestoneId(e.target.value)} className={campo}>
                <option value="">Sem milestone</option>
                {(projectMilestones || []).map((m: any) => (
                  <option key={m.id} value={m.id}>{m.title}</option>
                ))}
              </select>
            </CampoDeFormulario>
          )}

          <CampoDeFormulario rotulo={isContentTask ? "Contexto do conteúdo" : "Descrição"} obrigatorio={isContentTask && !isEdit}>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder={isContentTask ? "Explique o ângulo, objetivo e direção do conteúdo" : "Detalhes da tarefa..."} className={juntar(campoTexto, "resize-none")} />
          </CampoDeFormulario>

          <CampoDeFormulario rotulo="Tipo de entrega" obrigatorio={!isEdit}>
            <select
              id="task-delivery-type"
              value={deliveryType}
              onChange={(event) => {
                const nextType = event.target.value as TaskDeliveryType;
                setDeliveryType(nextType);
                setWorkstream(
                  suggestedWorkstreamForDeliveryType(nextType),
                );
              }}
              className={campo}
            >
              {!deliveryType && (
                <option value="">Selecionar tipo...</option>
              )}
              {deliveryType === "unspecified" && (
                <option value="unspecified">Não definido (legado)</option>
              )}
              {TASK_DELIVERY_TYPE_OPTIONS
                .filter((option) => option.value !== "unspecified")
                .map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
            </select>
          </CampoDeFormulario>

          <div className="grid grid-cols-2 gap-4">
            <CampoDeFormulario rotulo="Prioridade">
              <select value={priority} onChange={(e) => setPriority(e.target.value)} className={campo}>
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Área">
              <select
                id="task-workstream"
                value={workstream}
                onChange={(e) => setWorkstream(e.target.value as TaskWorkstream)}
                className={campo}
              >
                {TASK_WORKSTREAM_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </CampoDeFormulario>
          </div>

          <CampoDeFormulario rotulo="Responsável">
            <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className={campo}>
              <option value="">Nenhum</option>
              {teamMembers.map((m: any) => (
                <option key={m.id} value={m.id}>{m.full_name}</option>
              ))}
            </select>
          </CampoDeFormulario>

          <CampoDeEscolha rotulo="Prazo">
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className={juntar(campo, "flex items-center text-left hover:border-primary/50", !dueDate && "text-muted-foreground")}>
                  <CalendarIcon className="mr-2 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {dueDate ? format(dueDate, "dd/MM/yyyy") : "Selecionar prazo"}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={dueDate} onSelect={setDueDate} className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
          </CampoDeEscolha>
        </div>

        <div className="flex shrink-0 items-center border-t border-border px-5 py-3">
          {isEdit && (
            <button type="button" onClick={() => setConfirmDelete(true)} className={botao.perigo}>
              Excluir
            </button>
          )}
          <div className="ml-auto flex items-center [&>*+*]:ml-2">
            <button type="button" onClick={onClose} disabled={saving} className={botao.secundario}>
              Cancelar
            </button>
            <button type="button" onClick={handleSave} disabled={saving} className={botao.primario}>
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              {saving ? "Salvando..." : isEdit ? "Salvar" : "Criar Tarefa"}
            </button>
          </div>
        </div>

      </DialogContent>
    </Dialog>
    <ConfirmModal
      open={confirmDelete}
      title="Excluir tarefa"
      description="Esta tarefa será removida permanentemente."
      onConfirm={handleDelete}
      onCancel={() => setConfirmDelete(false)}
    />
    </>
  );
}
