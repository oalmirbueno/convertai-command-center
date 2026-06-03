import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { notifyUser } from "@/lib/notifyHelpers";
import { notifyOpsTaskUpdated } from "@/lib/opsTaskSync";
import { sendTaskAttachmentsToApproval } from "@/lib/reviewToApproval";
import { toast } from "sonner";
// @ts-ignore
import JSZip from "jszip";
import {
  X, Loader2, Pencil, Save, Trash2, Paperclip, Upload,
  FileText, Image, Film, Download, ChevronDown, ChevronUp,
  Clock, Flag, User, Folder, Calendar, MessageSquare,
  CheckSquare, Square, Plus, Send, Archive,
} from "lucide-react";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import TaskChecklistTemplatePicker from "@/components/admin/TaskChecklistTemplatePicker";

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
  const [checklistExpanded, setChecklistExpanded] = useState(true);
  const [commentsExpanded, setCommentsExpanded] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Comment state
  const [commentText, setCommentText] = useState("");
  const [sendingComment, setSendingComment] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const mentionDropdownRef = useRef<HTMLDivElement>(null);

  // Checklist state
  const [newCheckItem, setNewCheckItem] = useState("");
  const [addingCheck, setAddingCheck] = useState(false);

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

  // Fetch comments
  const { data: comments, isLoading: loadingComments } = useQuery({
    queryKey: ["task-comments", task.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("task_comments")
        .select("*, author:profiles!task_comments_author_id_fkey(full_name)")
        .eq("task_id", task.id)
        .order("created_at", { ascending: true });
      return data || [];
    },
  });

  // Fetch checklist
  const { data: checklistItems, isLoading: loadingChecklist } = useQuery({
    queryKey: ["task-checklist", task.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("task_checklist_items")
        .select("*, creator:profiles!task_checklist_items_created_by_fkey(full_name)")
        .eq("task_id", task.id)
        .order("item_order", { ascending: true });
      return data || [];
    },
  });

  const handleSave = async () => {
    if (!title.trim()) { toast.error("Título obrigatório"); return; }
    setSaving(true);
    try {
      const previousAssignedTo = task.assigned_to;
      const previousStatus = task.status;
      await supabase.from("tasks").update({
        title: title.trim(),
        description: description.trim() || null,
        priority, status,
        assigned_to: assignedTo || null,
        due_date: dueDate || null,
      }).eq("id", task.id);
      notifyOpsTaskUpdated(task.id);

      const { data: { user } } = await supabase.auth.getUser();

      if (assignedTo && assignedTo !== previousAssignedTo) {
        const project = projects.find((p: any) => p.id === task.project_id);
        await notifyUser(assignedTo, `Tarefa atribuída: "${title.trim()}"${project ? ` no projeto ${project.name}` : ""}`, "task", "/kanban");
      }

      if (["review", "done"].includes(status) && previousStatus !== status && task.project_id && user) {
        await sendTaskAttachmentsToApproval(task.id, task.project_id, title.trim(), user.id);
        queryClient.invalidateQueries({ queryKey: ["all-files"] });
        queryClient.invalidateQueries({ queryKey: ["files"] });
      }

      // Notify on status change to done
      if (status === "done" && previousStatus !== "done") {
        const { notifyAdmin } = await import("@/lib/notifyHelpers");
        if (user) {
          await notifyAdmin(`Tarefa "${title.trim()}" concluída por ${profile?.full_name || "equipe"}`, "task", "/kanban");
        }
        if (assignedTo && user && assignedTo !== user.id) {
          await notifyUser(assignedTo, `Tarefa "${title.trim()}" marcada como concluída`, "task", "/kanban");
        }
      }

      // Notify assignee about status change
      if (previousStatus !== status && status !== "done" && assignedTo && user && assignedTo !== user.id) {
        const statusName = statusLabels[status] || status;
        await notifyUser(assignedTo, `Tarefa "${title.trim()}" movida para ${statusName}`, "task", "/kanban");
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

  // ── Mention helpers ──
  const filteredMentions = mentionQuery !== null
    ? teamMembers.filter((m: any) => m.full_name?.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 5)
    : [];

  const getMentionContext = useCallback(() => {
    const el = commentRef.current;
    if (!el) return null;
    const cursor = el.selectionStart;
    const textBefore = commentText.slice(0, cursor);
    const match = textBefore.match(/@(\w*)$/);
    return match ? { query: match[1], start: cursor - match[0].length, end: cursor } : null;
  }, [commentText]);

  const handleCommentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCommentText(e.target.value);
    setTimeout(() => {
      const ctx = getMentionContext();
      if (ctx) {
        setMentionQuery(ctx.query);
        setMentionIndex(0);
      } else {
        setMentionQuery(null);
      }
    }, 0);
  };

  const insertMention = (member: any) => {
    const el = commentRef.current;
    if (!el) return;
    const cursor = el.selectionStart;
    const textBefore = commentText.slice(0, cursor);
    const match = textBefore.match(/@(\w*)$/);
    if (!match) return;
    const start = cursor - match[0].length;
    const mentionText = `@${member.full_name} `;
    const newText = commentText.slice(0, start) + mentionText + commentText.slice(cursor);
    setCommentText(newText);
    setMentionQuery(null);
    setTimeout(() => {
      el.focus();
      const pos = start + mentionText.length;
      el.setSelectionRange(pos, pos);
    }, 0);
  };

  // Parse @mentions from text and return mentioned member IDs
  const parseMentions = (text: string): string[] => {
    const ids: string[] = [];
    teamMembers.forEach((m: any) => {
      if (text.includes(`@${m.full_name}`)) {
        ids.push(m.id);
      }
    });
    return ids;
  };

  // ── Comments ──
  const handleSendComment = async () => {
    if (!commentText.trim()) return;
    setSendingComment(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Não autenticado");
      const content = commentText.trim();
      await supabase.from("task_comments").insert({
        task_id: task.id,
        author_id: user.id,
        content,
      });
      setCommentText("");
      setMentionQuery(null);
      queryClient.invalidateQueries({ queryKey: ["task-comments", task.id] });

      // Notify mentioned users
      const mentionedIds = parseMentions(content);
      const notifiedSet = new Set<string>();

      for (const mid of mentionedIds) {
        if (mid !== user.id && !notifiedSet.has(mid)) {
          notifiedSet.add(mid);
          await notifyUser(mid, `Você foi mencionado em "${task.title}"`, "task", "/kanban");
        }
      }

      // Notify assignee if not already notified
      if (task.assigned_to && task.assigned_to !== user.id && !notifiedSet.has(task.assigned_to)) {
        await notifyUser(task.assigned_to, `Novo comentário em "${task.title}"`, "task", "/kanban");
      }
    } catch (err: any) { toast.error(err.message); }
    finally { setSendingComment(false); }
  };

  const handleDeleteComment = async (commentId: string) => {
    await supabase.from("task_comments").delete().eq("id", commentId);
    queryClient.invalidateQueries({ queryKey: ["task-comments", task.id] });
    toast.success("Comentário removido");
  };

  // Render comment with highlighted @mentions
  const renderCommentWithMentions = (text: string) => {
    const mentionPattern = /@([A-Za-zÀ-ÿ\s]+?)(?=\s@|\s[^A-Za-zÀ-ÿ]|$)/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;
    while ((match = mentionPattern.exec(text)) !== null) {
      const name = match[1].trim();
      const isMember = teamMembers.some((m: any) => m.full_name === name);
      if (isMember) {
        if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
        parts.push(
          <span key={match.index} className="text-primary font-semibold bg-primary/10 px-0.5 rounded">
            @{name}
          </span>
        );
        lastIndex = match.index + match[0].length;
      }
    }
    if (lastIndex < text.length) parts.push(text.slice(lastIndex));
    return parts.length > 0 ? parts : text;
  };

  // ── Checklist ──
  const handleAddCheckItem = async () => {
    if (!newCheckItem.trim()) return;
    setAddingCheck(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Não autenticado");
      const order = (checklistItems || []).length;
      await supabase.from("task_checklist_items").insert({
        task_id: task.id,
        title: newCheckItem.trim(),
        item_order: order,
        created_by: user.id,
      });
      setNewCheckItem("");
      queryClient.invalidateQueries({ queryKey: ["task-checklist", task.id] });
    } catch (err: any) { toast.error(err.message); }
    finally { setAddingCheck(false); }
  };

  const handleToggleCheck = async (item: any) => {
    await supabase.from("task_checklist_items").update({ checked: !item.checked }).eq("id", item.id);
    queryClient.invalidateQueries({ queryKey: ["task-checklist", task.id] });
  };

  const handleDeleteCheckItem = async (itemId: string) => {
    await supabase.from("task_checklist_items").delete().eq("id", itemId);
    queryClient.invalidateQueries({ queryKey: ["task-checklist", task.id] });
  };

  // ── File Upload ──
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Não autenticado");
      for (const file of Array.from(files)) {
        if (file.size > 100 * 1024 * 1024) { toast.error(`${file.name} excede 100MB`); continue; }
        const ext = file.name.split(".").pop();
        const path = `task-attachments/${task.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("files").upload(path, file);
        if (uploadError) { toast.error(`Erro ao enviar ${file.name}`); continue; }
        const { data: { publicUrl } } = supabase.storage.from("files").getPublicUrl(path);
        await supabase.from("task_attachments").insert({
          task_id: task.id, file_name: file.name, file_url: publicUrl,
          file_type: file.type, file_size: file.size, uploaded_by: user.id,
        });
      }
      if (["review", "done"].includes(task.status) && task.project_id) {
        await sendTaskAttachmentsToApproval(task.id, task.project_id, task.title, user.id);
        queryClient.invalidateQueries({ queryKey: ["all-files"] });
        queryClient.invalidateQueries({ queryKey: ["files"] });
      }
      queryClient.invalidateQueries({ queryKey: ["task-attachments", task.id] });
      queryClient.invalidateQueries({ queryKey: ["task-attachment-counts"] });
      toast.success("Arquivo(s) anexado(s)!");
    } catch (err: any) { toast.error(err.message); }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
  };

  const handleDeleteAttachment = async () => {
    if (!confirmDelete) return;
    try {
      await supabase.from("task_attachments").delete().eq("id", confirmDelete);
      queryClient.invalidateQueries({ queryKey: ["task-attachments", task.id] });
      queryClient.invalidateQueries({ queryKey: ["task-attachment-counts"] });
      toast.success("Anexo removido!");
    } catch (err: any) { toast.error(err.message); }
    finally { setConfirmDelete(null); }
  };

  const getFileIcon = (type: string) => {
    if (type?.startsWith("image/")) return <Image className="w-4 h-4 text-primary" />;
    if (type?.startsWith("video/")) return <Film className="w-4 h-4 text-primary" />;
    return <FileText className="w-4 h-4 text-muted-foreground" />;
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  const [downloadingZip, setDownloadingZip] = useState(false);

  const imageAttachments = (attachments || []).filter((a: any) => a.file_type?.startsWith("image/"));
  const isCarousel = imageAttachments.length > 1;

  const handleDownloadZip = async () => {
    if (imageAttachments.length === 0) return;
    setDownloadingZip(true);
    try {
      const zip = new JSZip();
      const folder = zip.folder(task.title.replace(/[^a-zA-Z0-9À-ÿ\s]/g, "").trim() || "carrossel");
      for (let i = 0; i < imageAttachments.length; i++) {
        const a = imageAttachments[i];
        const resp = await fetch(a.file_url);
        const blob = await resp.blob();
        const ext = a.file_name.split(".").pop() || "png";
        folder!.file(`${String(i + 1).padStart(2, "0")}_${a.file_name}`, blob);
      }
      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${task.title.replace(/[^a-zA-Z0-9À-ÿ\s]/g, "").trim() || "carrossel"}.zip`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("ZIP baixado!");
    } catch (err: any) {
      toast.error("Erro ao gerar ZIP");
    } finally {
      setDownloadingZip(false);
    }
  };

  const handleDownloadSingle = (url: string, name: string) => {
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.target = "_blank";
    link.click();
  };

  const assignee = teamMembers.find((m: any) => m.id === (editing ? assignedTo : task.assigned_to));
  const project = projects.find((p: any) => p.id === task.project_id);

  const checkedCount = (checklistItems || []).filter((i: any) => i.checked).length;
  const totalCheck = (checklistItems || []).length;
  const checkPercent = totalCheck > 0 ? Math.round((checkedCount / totalCheck) * 100) : 0;

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
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Flag className="w-3 h-3" /> Status</p>
              {editing ? (
                <select value={status} onChange={e => setStatus(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50 cursor-pointer">
                  {statusOrder.map(s => <option key={s} value={s}>{statusLabels[s]}</option>)}
                </select>
              ) : (
                <span className="text-[12px] px-2 py-0.5 rounded-full bg-secondary text-foreground inline-block">{statusLabels[task.status]}</span>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> Prioridade</p>
              {editing ? (
                <select value={priority} onChange={e => setPriority(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50 cursor-pointer">
                  <option value="low">🟢 Baixa</option><option value="medium">🔵 Média</option>
                  <option value="high">🟡 Alta</option><option value="urgent">🔴 Urgente</option>
                </select>
              ) : (
                <span className={`text-[12px] px-2 py-0.5 rounded-full inline-block ${priorityColors[task.priority]}`}>{priorityLabels[task.priority]}</span>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><User className="w-3 h-3" /> Responsável</p>
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
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Calendar className="w-3 h-3" /> Prazo</p>
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
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Folder className="w-3 h-3" /> Milestone</p>
              <span className="text-[12px] px-2.5 py-1 rounded-full bg-primary/10 text-primary inline-block">{task.milestone.title}</span>
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
                  placeholder="Descreva as instruções detalhadas da tarefa..." />
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

          {/* ═══ Checklist section ═══ */}
          <div className="space-y-3">
            <button onClick={() => setChecklistExpanded(!checklistExpanded)}
              className="flex items-center gap-2 w-full text-left cursor-pointer bg-transparent border-none p-0">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                <CheckSquare className="w-3.5 h-3.5" /> Checklist
                {totalCheck > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-mono">
                    {checkedCount}/{totalCheck}
                  </span>
                )}
              </p>
              {checklistExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
            </button>

            {checklistExpanded && (
              <div className="space-y-2">
                {/* Progress bar */}
                {totalCheck > 0 && (
                  <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${checkPercent}%` }} />
                  </div>
                )}

                {loadingChecklist ? (
                  <p className="text-[12px] text-muted-foreground text-center py-2">Carregando...</p>
                ) : (
                  <div className="space-y-1">
                    {(checklistItems || []).map((item: any) => (
                      <div key={item.id} className="flex items-center gap-2 group px-2 py-1.5 rounded-lg hover:bg-secondary/50 transition-colors">
                        <button onClick={() => handleToggleCheck(item)}
                          className="shrink-0 cursor-pointer bg-transparent border-none p-0 text-foreground">
                          {item.checked
                            ? <CheckSquare className="w-4 h-4 text-primary" />
                            : <Square className="w-4 h-4 text-muted-foreground" />
                          }
                        </button>
                        <span className={`text-[13px] flex-1 ${item.checked ? "line-through text-muted-foreground" : "text-foreground"}`}>
                          {item.title}
                        </span>
                        {!readOnly && (
                          <button onClick={() => handleDeleteCheckItem(item.id)}
                            className="p-0.5 rounded text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all cursor-pointer bg-transparent border-none">
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Add checklist item */}
                {!readOnly && (
                  <div className="flex items-center gap-2">
                    <input
                      value={newCheckItem}
                      onChange={e => setNewCheckItem(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleAddCheckItem()}
                      placeholder="Adicionar item..."
                      className="flex-1 bg-secondary border border-border rounded-lg px-3 py-2 text-[12px] text-foreground focus:outline-none focus:border-primary/50"
                    />
                    <button onClick={handleAddCheckItem} disabled={addingCheck || !newCheckItem.trim()}
                      className="p-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none disabled:opacity-50">
                      {addingCheck ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                )}
              </div>
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
                {!readOnly && (
                  <div>
                    <input ref={fileInputRef} type="file" multiple onChange={handleFileUpload} className="hidden"
                      accept="image/*,video/*,.pdf,.doc,.docx,.pptx,.xlsx,.zip,.md,.txt" />
                    <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-border hover:border-primary/40 hover:bg-primary/5 text-muted-foreground hover:text-primary transition-all cursor-pointer bg-transparent disabled:opacity-50">
                      {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                      <span className="text-[12px] font-medium">{uploading ? "Enviando..." : "Anexar arquivos"}</span>
                    </button>
                  </div>
                )}

                {loadingAttachments ? (
                  <p className="text-[12px] text-muted-foreground text-center py-4">Carregando anexos...</p>
                ) : (attachments || []).length === 0 ? (
                  <p className="text-[12px] text-muted-foreground text-center py-4 italic">Nenhum anexo</p>
                ) : (
                  <div className="space-y-2">
                    {/* Carousel download button */}
                    {isCarousel && (
                      <button
                        onClick={handleDownloadZip}
                        disabled={downloadingZip}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary text-[12px] font-medium transition-colors cursor-pointer border border-primary/20 disabled:opacity-50"
                      >
                        {downloadingZip ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
                        Baixar carrossel em ZIP ({imageAttachments.length} imagens)
                      </button>
                    )}

                    {imageAttachments.length > 0 && (
                      <div className="grid grid-cols-3 gap-2">
                        {imageAttachments.map((a: any) => (
                          <div key={a.id} className="relative group rounded-lg overflow-hidden border border-border aspect-square">
                            <a href={a.file_url} target="_blank" rel="noopener noreferrer">
                              <img src={a.file_url} alt={a.file_name} className="w-full h-full object-cover" />
                            </a>
                            <div className="absolute bottom-0 inset-x-0 flex items-center justify-end gap-0.5 p-1 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                              {!isCarousel && (
                                <button onClick={() => handleDownloadSingle(a.file_url, a.file_name)}
                                  className="p-1 rounded bg-black/40 text-white hover:bg-black/60 cursor-pointer border-none">
                                  <Download className="w-3 h-3" />
                                </button>
                              )}
                              {!readOnly && (
                                <button onClick={() => setConfirmDelete(a.id)}
                                  className="p-1 rounded bg-black/40 text-white hover:bg-destructive cursor-pointer border-none">
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {(attachments || []).filter((a: any) => !a.file_type?.startsWith("image/")).map((a: any) => (
                      <div key={a.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-secondary/30 hover:bg-secondary/50 transition-colors group">
                        {a.file_type?.startsWith("video/") ? (
                          <div className="w-16 h-10 rounded-lg overflow-hidden bg-secondary shrink-0">
                            <video src={a.file_url} className="w-full h-full object-cover" muted />
                          </div>
                        ) : getFileIcon(a.file_type)}
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

          {/* ═══ Comments / Activity section ═══ */}
          <div className="space-y-3">
            <button onClick={() => setCommentsExpanded(!commentsExpanded)}
              className="flex items-center gap-2 w-full text-left cursor-pointer bg-transparent border-none p-0">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5" /> Comentários
                {(comments || []).length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-mono">
                    {(comments || []).length}
                  </span>
                )}
              </p>
              {commentsExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
            </button>

            {commentsExpanded && (
              <div className="space-y-3">
                {loadingComments ? (
                  <p className="text-[12px] text-muted-foreground text-center py-4">Carregando...</p>
                ) : (comments || []).length === 0 ? (
                  <p className="text-[12px] text-muted-foreground text-center py-4 italic">Nenhum comentário ainda.</p>
                ) : (
                  <div className="space-y-3 max-h-[300px] overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
                    {(comments || []).map((c: any) => (
                      <div key={c.id} className="flex gap-2.5 group">
                        <Avatar className="w-7 h-7 shrink-0 mt-0.5">
                          <AvatarFallback className="text-[9px] bg-secondary text-muted-foreground font-medium">
                            {c.author?.full_name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2) || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[12px] font-semibold text-foreground">{c.author?.full_name}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {new Date(c.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                              {" "}
                              {new Date(c.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                            {(c.author_id === profile?.id || profile?.role === "admin") && (
                              <button onClick={() => handleDeleteComment(c.id)}
                                className="p-0.5 rounded text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all cursor-pointer bg-transparent border-none ml-auto">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                          <p className="text-[13px] text-foreground whitespace-pre-wrap leading-relaxed mt-0.5">
                            {renderCommentWithMentions(c.content)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Comment input with @mention */}
                <div className="relative">
                  {mentionQuery !== null && filteredMentions.length > 0 && (
                    <div ref={mentionDropdownRef}
                      className="absolute bottom-full mb-1 left-0 w-full bg-card border border-border rounded-xl shadow-lg z-10 max-h-[160px] overflow-y-auto py-1">
                      {filteredMentions.map((m: any, i: number) => (
                        <button key={m.id}
                          onClick={() => insertMention(m)}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] cursor-pointer border-none transition-colors ${
                            i === mentionIndex ? "bg-primary/10 text-primary" : "text-foreground hover:bg-secondary"
                          } bg-transparent`}>
                          <Avatar className="w-5 h-5">
                            <AvatarFallback className="text-[8px] bg-secondary text-muted-foreground">
                              {m.full_name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">{m.full_name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex items-end gap-2">
                    <textarea
                      ref={commentRef}
                      value={commentText}
                      onChange={handleCommentChange}
                      onKeyDown={e => {
                        if (mentionQuery !== null && filteredMentions.length > 0) {
                          if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex(i => Math.min(i + 1, filteredMentions.length - 1)); return; }
                          if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex(i => Math.max(i - 1, 0)); return; }
                          if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertMention(filteredMentions[mentionIndex]); return; }
                          if (e.key === "Escape") { e.preventDefault(); setMentionQuery(null); return; }
                        }
                        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendComment(); }
                      }}
                      placeholder="Escreva um comentário... use @ para mencionar"
                      rows={2}
                      className="flex-1 bg-secondary border border-border rounded-xl px-3 py-2 text-[12px] text-foreground focus:outline-none focus:border-primary/50 resize-none"
                    />
                    <button onClick={handleSendComment} disabled={sendingComment || !commentText.trim()}
                      className="p-2.5 rounded-xl bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none disabled:opacity-50 shrink-0">
                      {sendingComment ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
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
