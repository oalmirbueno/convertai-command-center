import { useState, useEffect } from "react";
import { X, Loader2, CalendarIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useProjects } from "@/hooks/useSupabaseData";
import { toast } from "sonner";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

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
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [assignedTo, setAssignedTo] = useState("");
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined);

  // BUG 3 FIX: populate fields when editing
  useEffect(() => {
    if (editTask) {
      setTitle(editTask.title || "");
      setProjectId(editTask.project_id || "");
      setDescription(editTask.description || "");
      setPriority(editTask.priority || "medium");
      setAssignedTo(editTask.assigned_to || "");
      setDueDate(editTask.due_date ? new Date(editTask.due_date) : undefined);
    } else {
      setTitle("");
      setProjectId("");
      setDescription("");
      setPriority("medium");
      setAssignedTo("");
      setDueDate(undefined);
    }
  }, [editTask, open]);

  if (!open) return null;

  const isEdit = !!editTask;
  const activeProjects = (projects || []).filter((p: any) => p.status !== "done");

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error("Informe o título da tarefa");
      return;
    }
    if (!projectId) {
      toast.error("Selecione o projeto");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        project_id: projectId,
        description: description.trim() || null,
        priority,
        assigned_to: assignedTo || null,
        due_date: dueDate ? format(dueDate, "yyyy-MM-dd") : null,
        ...(isEdit ? {} : { status: defaultStatus }),
      };

      if (isEdit) {
        const { error } = await supabase.from("tasks").update(payload).eq("id", editTask.id);
        if (error) throw error;
        toast.success("Tarefa atualizada!");
      } else {
        const { error } = await supabase.from("tasks").insert(payload);
        if (error) throw error;
        // Create update for new task
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (authUser && projectId) {
          await supabase.from("updates").insert({
            project_id: projectId, author_id: authUser.id,
            message: `Nova tarefa criada: ${title.trim()}`, update_type: "task",
          });
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
    if (!editTask || !confirm("Excluir esta tarefa?")) return;
    try {
      await supabase.from("tasks").delete().eq("id", editTask.id);
      toast.success("Tarefa excluída");
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      onClose();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-2xl w-full max-w-[480px] mx-4 animate-in fade-in zoom-in-[0.96] duration-200" style={{ boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">{isEdit ? "Editar Tarefa" : "Nova Tarefa"}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Título *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nome da tarefa"
              className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors" />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Projeto *</label>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}
              className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors">
              <option value="">Selecionar projeto...</option>
              {activeProjects.map((p: any) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Descrição</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Detalhes da tarefa..."
              className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors resize-none" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Prioridade</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value)}
                className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors">
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Responsável</label>
              <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}
                className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors">
                <option value="">Nenhum</option>
                {teamMembers.map((m: any) => (
                  <option key={m.id} value={m.id}>{m.full_name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Prazo</label>
            <Popover>
              <PopoverTrigger asChild>
                <button className={cn("w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-left flex items-center gap-2 hover:border-primary/50 transition-colors cursor-pointer", !dueDate && "text-muted-foreground")}>
                  <CalendarIcon className="w-3.5 h-3.5" />
                  {dueDate ? format(dueDate, "dd/MM/yyyy") : "Selecionar prazo"}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={dueDate} onSelect={setDueDate} className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border flex justify-between">
          {isEdit && (
            <button onClick={handleDelete} className="px-4 py-2 rounded-[10px] text-[13px] text-destructive hover:bg-destructive/10 transition-colors cursor-pointer bg-transparent border-none">
              Excluir
            </button>
          )}
          <div className={`flex gap-3 ${isEdit ? "" : "ml-auto"}`}>
            <button onClick={onClose} disabled={saving} className="px-4 py-2 rounded-[10px] text-[13px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border border-border">
              Cancelar
            </button>
            <button onClick={handleSave} disabled={saving} className="px-5 py-2 rounded-[10px] text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {saving ? "Salvando..." : isEdit ? "Salvar" : "Criar Tarefa"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
