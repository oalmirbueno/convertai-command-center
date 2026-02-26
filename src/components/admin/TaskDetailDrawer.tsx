import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { notifyUser } from "@/lib/notifyHelpers";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  X, Loader2, Pencil, Save, Trash2, Paperclip, Upload,
  FileText, Image, Film, Download, ChevronDown, ChevronUp,
  Clock, Flag, User, Folder, Calendar,
} from "lucide-react";
import ConfirmModal from "@/components/ui/ConfirmModal";

const priorityLabels: Record<string, string> = {
  low: "Baixa", medium: "Média", high: "Alta", urgent: "Urgente",
};
const priorityColors: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-blue-500/10 text-blue-500",
  high: "bg-warning/10 text-warning",
  urgent: "bg-destructive/10 text-destructive",
};
const statusLabels: Record<string, string> = {
  backlog: "Backlog", doing: "Em Andamento", review: "Revisão", approved: "Aprovado", done: "Concluído",
};
const statusOrder = ["backlog", "doing", "review", "approved", "done"];

interface Props {
  task: any;
  onClose: () => void;
  teamMembers: any[];
  projects: any[];
  readOnly?: boolean;
}

export default function TaskDetailDrawer({ task, onClose, teamMembers, projects, readOnly = false }: Props) {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Edit state
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || "");
  const [priority, setPriority] = useState(task.priority);
  const [status, setStatus] = useState(task.status);
  const [assignedTo, setAssignedTo] = useState(task.assigned_to || "");
  const [dueDate, setDueDate] = useState(task.due_date || "");
  const [saving, setSaving] = useState(false);
  const [descExpanded, setDescExpanded] = useState(true);
  const [attachExpanded, setAttachExpanded] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Fetch attachments
  const { data: attachments, isLoading: loadingAttachments } = useQuery({
    queryKey: ["task-attachments", task.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("task_attachments")
        .select("*, uploader:profiles!task_attachments_uploaded_by_fkey(full_name)")
        .eq("task_id", task.id)
        .order("created_at", { ascending: false });
      return data || [];
    },
  });

  const handleSave = async () => {
    if (!title.trim()) { toast.error("Título obrigatório"); return; }
    setSaving(true);
    try {
      const previousAssignedTo = task.assigned_to;
      await supabase.from("tasks").update({
        title: title.trim(),
        description: description.trim() || null,
        priority,
        status,
        assigned_to: assignedTo || null,
        due_date: dueDate || null,
      }).eq("id", task.id);

      // Notify new assignee
      if (assignedTo && assignedTo !== previousAssignedTo) {
        const project = projects.find((p: any) => p.id === task.project_id);
        await notifyUser(
          assignedTo,
          `Tarefa atribuída: "${title.trim()}"${project ? ` no projeto ${project.name}` : ""}`,
          "task",
          "/kanban"
        );
      }

      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["tasks-timeline"] });
      queryClient.invalidateQueries({ queryKey: ["milestones-all"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Tarefa atualizada!");
      setEditing(false);
    } catch (err: any) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Não autenticado");

      for (const file of Array.from(files)) {
        if (file.size > 50 * 1024 * 1024) {
          toast.error(`${file.name} excede 50MB`);
          continue;
        }
        const ext = file.name.split(".").pop();
        const path = `task-attachments/${task.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("files").upload(path, file);
        if (uploadError) { toast.error(`Erro ao enviar ${file.name}`); continue; }

        const { data: { publicUrl } } = supabase.storage.from("files").getPublicUrl(path);
        await supabase.from("task_attachments").insert({
          task_id: task.id,
          file_name: file.name,
          file_url: publicUrl,
          file_type: file.type,
          file_size: file.size,
          uploaded_by: user.id,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["task-attachments", task.id] });
      toast.success("Arquivo(s) anexado(s)!");
    } catch (err: any) { toast.error(err.message); }
    finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDeleteAttachment = async () => {
    if (!confirmDelete) return;
    try {
      await supabase.from("task_attachments").delete().eq("id", confirmDelete);
      queryClient.invalidateQueries({ queryKey: ["task-attachments", task.id] });
      toast.success("Anexo removido!");
    } catch (err: any) { toast.error(err.message); }
    finally { setConfirmDelete(null); }
  };

  const getFileIcon = (type: string) => {
    if (type?.startsWith("image/")) return <Image className="w-4 h-4 text-blue-500" />;
    if (type?.startsWith("video/")) return <Film className="w-4 h-4 text-purple-500" />;
    return <FileText className="w-4 h-4 text-muted-foreground" />;
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  const assignee = teamMembers.find((m: any) => m.id === (editing ? assignedTo : task.assigned_to));
  const project = projects.find((p: any) => p.id === task.project_id);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border-l border-border w-full max-w-lg h-full animate-in slide-in-from-right duration-200 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${priorityColors[editing ? priority : task.priority]}`}>
              {priorityLabels[editing ? priority : task.priority]}
            </div>
            <span className="text-[11px] text-muted-foreground">{project?.name}</span>
          </div>
          <div className="flex items-center gap-2">
            {!readOnly && !editing && (
              <button onClick={() => setEditing(true)}
                className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none">
                <Pencil className="w-4 h-4" />
              </button>
            )}
            <button onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Title */}
          {editing ? (
            <input value={title} onChange={e => setTitle(e.target.value)}
              className="w-full text-lg font-semibold bg-secondary border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:border-primary/50" />
          ) : (
            <h2 className="text-lg font-semibold text-foreground">{task.title}</h2>
          )}

          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <Flag className="w-3 h-3" /> Status
              </p>
              {editing ? (
                <select value={status} onChange={e => setStatus(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50 cursor-pointer">
                  {statusOrder.map(s => <option key={s} value={s}>{statusLabels[s]}</option>)}
                </select>
              ) : (
                <span className="text-[12px] px-2 py-0.5 rounded-full bg-secondary text-foreground inline-block">
                  {statusLabels[task.status]}
                </span>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" /> Prioridade
              </p>
              {editing ? (
                <select value={priority} onChange={e => setPriority(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50 cursor-pointer">
                  <option value="low">🟢 Baixa</option>
                  <option value="medium">🔵 Média</option>
                  <option value="high">🟡 Alta</option>
                  <option value="urgent">🔴 Urgente</option>
                </select>
              ) : (
                <span className={`text-[12px] px-2 py-0.5 rounded-full inline-block ${priorityColors[task.priority]}`}>
                  {priorityLabels[task.priority]}
                </span>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <User className="w-3 h-3" /> Responsável
              </p>
              {editing ? (
                <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50 cursor-pointer">
                  <option value="">Sem responsável</option>
                  {teamMembers.map((m: any) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                </select>
              ) : (
                <p className="text-[13px] text-foreground">{assignee?.full_name || "—"}</p>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <Calendar className="w-3 h-3" /> Prazo
              </p>
              {editing ? (
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50" />
              ) : (
                <p className="text-[13px] text-foreground">
                  {task.due_date ? new Date(task.due_date).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }) : "—"}
                </p>
              )}
            </div>
          </div>

          {task.milestone?.title && (
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <Folder className="w-3 h-3" /> Milestone
              </p>
              <span className="text-[12px] px-2.5 py-1 rounded-full bg-primary/10 text-primary inline-block">
                {task.milestone.title}
              </span>
            </div>
          )}

          {/* Description section */}
          <div className="space-y-2">
            <button onClick={() => setDescExpanded(!descExpanded)}
              className="flex items-center gap-2 w-full text-left cursor-pointer bg-transparent border-none p-0">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Descrição / Instruções</p>
              {descExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
            </button>
            {descExpanded && (
              editing ? (
                <textarea value={description} onChange={e => setDescription(e.target.value)} rows={6}
                  className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm text-foreground focus:outline-none focus:border-primary/50 resize-none"
                  placeholder="Descreva as instruções detalhadas da tarefa, passo a passo, objetivos, critérios de pronto..." />
              ) : (
                <div className="bg-secondary/30 rounded-xl p-4 min-h-[80px]">
                  {task.description ? (
                    <p className="text-[13px] text-foreground whitespace-pre-wrap leading-relaxed">{task.description}</p>
                  ) : (
                    <p className="text-[13px] text-muted-foreground italic">Sem descrição ou instruções adicionadas.</p>
                  )}
                </div>
              )
            )}
          </div>

          {/* Attachments section */}
          <div className="space-y-3">
            <button onClick={() => setAttachExpanded(!attachExpanded)}
              className="flex items-center gap-2 w-full text-left cursor-pointer bg-transparent border-none p-0">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                <Paperclip className="w-3.5 h-3.5" /> Anexos
                {(attachments || []).length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-mono">
                    {(attachments || []).length}
                  </span>
                )}
              </p>
              {attachExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
            </button>

            {attachExpanded && (
              <div className="space-y-2">
                {/* Upload button */}
                {!readOnly && (
                  <div>
                    <input ref={fileInputRef} type="file" multiple onChange={handleFileUpload} className="hidden"
                      accept="image/*,video/*,.pdf,.doc,.docx,.pptx,.xlsx,.zip,.md,.txt" />
                    <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-border hover:border-primary/40 hover:bg-primary/5 text-muted-foreground hover:text-primary transition-all cursor-pointer bg-transparent disabled:opacity-50">
                      {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                      <span className="text-[12px] font-medium">{uploading ? "Enviando..." : "Anexar arquivos (fotos, vídeos, docs)"}</span>
                    </button>
                  </div>
                )}

                {/* Attachment list */}
                {loadingAttachments ? (
                  <p className="text-[12px] text-muted-foreground text-center py-4">Carregando anexos...</p>
                ) : (attachments || []).length === 0 ? (
                  <p className="text-[12px] text-muted-foreground text-center py-4 italic">Nenhum anexo</p>
                ) : (
                  <div className="space-y-2">
                    {/* Image/video previews */}
                    {(attachments || []).filter((a: any) => a.file_type?.startsWith("image/")).length > 0 && (
                      <div className="grid grid-cols-3 gap-2">
                        {(attachments || []).filter((a: any) => a.file_type?.startsWith("image/")).map((a: any) => (
                          <div key={a.id} className="relative group rounded-lg overflow-hidden border border-border aspect-square">
                            <a href={a.file_url} target="_blank" rel="noopener noreferrer">
                              <img src={a.file_url} alt={a.file_name} className="w-full h-full object-cover" />
                            </a>
                            {!readOnly && (
                              <button onClick={() => setConfirmDelete(a.id)}
                                className="absolute top-1 right-1 p-1 rounded-lg bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer border-none">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* File list */}
                    {(attachments || []).filter((a: any) => !a.file_type?.startsWith("image/")).map((a: any) => (
                      <div key={a.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-secondary/30 hover:bg-secondary/50 transition-colors group">
                        {a.file_type?.startsWith("video/") ? (
                          <div className="w-16 h-10 rounded-lg overflow-hidden bg-secondary shrink-0">
                            <video src={a.file_url} className="w-full h-full object-cover" muted />
                          </div>
                        ) : (
                          getFileIcon(a.file_type)
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] text-foreground truncate">{a.file_name}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {formatSize(a.file_size)} • {a.uploader?.full_name} • {new Date(a.created_at).toLocaleDateString("pt-BR")}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <a href={a.file_url} target="_blank" rel="noopener noreferrer"
                            className="p-1 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
                            <Download className="w-3.5 h-3.5" />
                          </a>
                          {!readOnly && (
                            <button onClick={() => setConfirmDelete(a.id)}
                              className="p-1 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors cursor-pointer bg-transparent border-none opacity-0 group-hover:opacity-100">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer actions */}
        {editing && (
          <div className="px-6 py-4 border-t border-border flex gap-3 shrink-0">
            <button onClick={() => { setEditing(false); setTitle(task.title); setDescription(task.description || ""); setPriority(task.priority); setStatus(task.status); setAssignedTo(task.assigned_to || ""); setDueDate(task.due_date || ""); }}
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl text-[13px] text-muted-foreground border border-border hover:text-foreground transition-colors cursor-pointer bg-transparent">
              Cancelar
            </button>
            <button onClick={handleSave} disabled={saving || !title.trim()}
              className="flex-1 py-2.5 rounded-xl text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none disabled:opacity-50 flex items-center justify-center gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {saving ? "Salvando..." : "Salvar"}
            </button>
          </div>
        )}
      </div>

      <ConfirmModal
        open={!!confirmDelete}
        title="Excluir anexo"
        description="Tem certeza que deseja remover este anexo?"
        onConfirm={handleDeleteAttachment}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
