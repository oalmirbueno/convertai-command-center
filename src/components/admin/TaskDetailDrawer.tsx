import { useState, useRef, useCallback, useEffect, type ReactNode } from "react";
import { Secao, botao, campo, campoTexto, etiqueta, foco, juntar, lista, superficie, texto } from "@/components/sistema";
import { supabase } from "@/integrations/supabase/client";
import { gravarCopiasSemEsperar } from "@/lib/miniaturas";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { notifyUser } from "@/lib/notifyHelpers";
import { notifyOpsTaskUpdated } from "@/lib/opsTaskSync";
import { excluirTarefa } from "@/lib/taskDelete";
import { sendTaskAttachmentsToApproval } from "@/lib/reviewToApproval";
import { toast } from "sonner";
// @ts-ignore
import JSZip from "jszip";
import {
  X, Loader2, Pencil, Save, Trash2, Paperclip, Upload,
  FileText, Image, Film, Download,
  Clock, Flag, User, Folder, Calendar,
  CheckSquare, Square, Plus, Send, Archive,
} from "lucide-react";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import TaskChecklistTemplatePicker from "@/components/admin/TaskChecklistTemplatePicker";
import TaskCommentContent from "@/components/admin/TaskCommentContent";
import { resolveFileUrl } from "@/lib/fileUrls";
import {
  requestIdFromTaskSource,
  syncClientRequestStatusForTask,
} from "@/lib/requestTaskWorkflow";
import {
  TASK_WORKSTREAM_LABELS,
  TASK_WORKSTREAM_OPTIONS,
  type TaskWorkstream,
} from "@/lib/taskWorkstreams";
import {
  TASK_DELIVERY_TYPE_LABELS,
  TASK_DELIVERY_TYPE_OPTIONS,
  suggestedWorkstreamForDeliveryType,
  type TaskDeliveryType,
} from "@/lib/taskDeliveryTypes";

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

function SectionLoadError({
  label,
  onRetry,
}: {
  label: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-md bg-destructive/5 px-3 py-3 text-center">
      <p className="text-[12px] text-destructive">
        Não foi possível carregar {label}.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 text-[11px] font-medium text-foreground underline underline-offset-2"
      >
        Tentar novamente
      </button>
    </div>
  );
}

interface Props {
  task: any;
  onClose: () => void;
  teamMembers: any[];
  projects: any[];
  readOnly?: boolean;
}

import ContextoDoAgente from "@/components/execucao/ContextoDoAgente";

export default function TaskDetailDrawer({ task, onClose, teamMembers, projects, readOnly = false }: Props) {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const linkedRequestId = requestIdFromTaskSource(task.source);
  const linkedProject = projects.find((project: any) => project.id === task.project_id);
  const canManageLinkedAssignment =
    profile?.role === "admin" || profile?.role === "manager";

  // Edit state
  const [editing, setEditing] = useState(false);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || "");
  const [priority, setPriority] = useState(task.priority);
  const [status, setStatus] = useState(task.status);
  const [deliveryType, setDeliveryType] = useState<TaskDeliveryType>(
    (task.delivery_type as TaskDeliveryType) || "unspecified",
  );
  const [workstream, setWorkstream] = useState<TaskWorkstream>(
    (task.workstream as TaskWorkstream) || "general",
  );
  const [assignedTo, setAssignedTo] = useState(task.assigned_to || "");
  const [dueDate, setDueDate] = useState(task.due_date || "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const savedTaskValuesRef = useRef({
    title: task.title,
    description: task.description || "",
    priority: task.priority,
    status: task.status,
    deliveryType:
      (task.delivery_type as TaskDeliveryType) || "unspecified",
    workstream: (task.workstream as TaskWorkstream) || "general",
    assignedTo: task.assigned_to || "",
    dueDate: task.due_date || "",
  });
  const requestStatusSyncRef = useRef(task.status);

  useEffect(() => {
    const next = {
      title: task.title,
      description: task.description || "",
      priority: task.priority,
      status: task.status,
      deliveryType:
        (task.delivery_type as TaskDeliveryType) || "unspecified",
      workstream: (task.workstream as TaskWorkstream) || "general",
      assignedTo: task.assigned_to || "",
      dueDate: task.due_date || "",
    };
    savedTaskValuesRef.current = next;
    requestStatusSyncRef.current = task.status;
    setTitle(next.title);
    setDescription(next.description);
    setPriority(next.priority);
    setStatus(next.status);
    setDeliveryType(next.deliveryType);
    setWorkstream(next.workstream);
    setAssignedTo(next.assignedTo);
    setDueDate(next.dueDate);
    setEditing(false);
  }, [task]);

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

  const {
    data: linkedEligibleAssignees = [],
    isLoading: loadingLinkedAssignees,
    isError: linkedAssigneesReadFailed,
  } = useQuery({
    queryKey: [
      "request-task-assignees",
      profile?.id,
      linkedProject?.client_id,
    ],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke(
        "request-task-workflow",
        {
          body: {
            action: "list_assignees",
            clientId: linkedProject!.client_id,
          },
        },
      );
      if (error) throw error;
      if (!data?.ok || !Array.isArray(data.assignees)) {
        throw new Error(
          data?.error || "Não foi possível carregar os responsáveis.",
        );
      }
      return data.assignees;
    },
    enabled:
      !!linkedRequestId
      && !!linkedProject?.client_id
      && canManageLinkedAssignment,
  });
  const currentAssignedMember = teamMembers.find(
    (member: any) => member.id === assignedTo,
  );
  const assignmentOptions = linkedRequestId
    ? (
      currentAssignedMember
      && !linkedEligibleAssignees.some(
        (member: any) => member.id === currentAssignedMember.id,
      )
        ? [currentAssignedMember, ...linkedEligibleAssignees]
        : linkedEligibleAssignees
    )
    : teamMembers;

  // Fetch attachments
  const {
    data: attachments,
    isLoading: loadingAttachments,
    isError: attachmentsReadFailed,
    refetch: refetchAttachments,
  } = useQuery({
    queryKey: ["task-attachments", task.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_attachments")
        .select("*, uploader:profiles!task_attachments_uploaded_by_fkey(full_name)")
        .eq("task_id", task.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return Promise.all((data || []).map(async (attachment: any) => {
        try {
          return {
            ...attachment,
            resolved_url: await resolveFileUrl({ fileUrl: attachment.file_url }),
          };
        } catch {
          return { ...attachment, resolved_url: "" };
        }
      }));
    },
  });

  // Fetch comments
  const {
    data: comments,
    isLoading: loadingComments,
    isError: commentsReadFailed,
    refetch: refetchComments,
  } = useQuery({
    queryKey: ["task-comments", task.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_comments")
        .select("*, author:profiles!task_comments_author_id_fkey(full_name)")
        .eq("task_id", task.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch checklist
  const {
    data: checklistItems,
    isLoading: loadingChecklist,
    isError: checklistReadFailed,
    refetch: refetchChecklist,
  } = useQuery({
    queryKey: ["task-checklist", task.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_checklist_items")
        .select("*, creator:profiles!task_checklist_items_created_by_fkey(full_name)")
        .eq("task_id", task.id)
        .order("item_order", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  const handleSave = async () => {
    if (!title.trim()) { toast.error("Título obrigatório"); return; }
    setSaving(true);
    try {
      const previousAssignedTo = savedTaskValuesRef.current.assignedTo;
      const previousStatus = savedTaskValuesRef.current.status;
      if (linkedRequestId && assignedTo !== previousAssignedTo) {
        if (
          !canManageLinkedAssignment
          || loadingLinkedAssignees
          || linkedAssigneesReadFailed
          || (
            assignedTo
            && !linkedEligibleAssignees.some(
              (member: any) => member.id === assignedTo,
            )
          )
        ) {
          throw new Error(
            "O responsável não está autorizado para o cliente desta tarefa.",
          );
        }
      }
      let persistedStatus = status;
      let linkedRequestStatusRolledBack = false;
      const { data: updatedTask, error: taskUpdateError } = await supabase.from("tasks").update({
        title: title.trim(),
        description: description.trim() || null,
        priority, status,
        delivery_type: deliveryType,
        workstream,
        assigned_to: assignedTo || null,
        due_date: dueDate || null,
      }).eq("id", task.id).select("id").maybeSingle();
      if (taskUpdateError) throw taskUpdateError;
      if (!updatedTask) throw new Error("A tarefa não foi encontrada ou não pode ser alterada.");
      savedTaskValuesRef.current = {
        title: title.trim(),
        description: description.trim(),
        priority,
        status,
        deliveryType,
        workstream,
        assignedTo,
        dueDate,
      };
      if (!requestIdFromTaskSource(task.source)) {
        notifyOpsTaskUpdated(task.id);
      }

      const { data: { user } } = await supabase.auth.getUser();
      let linkedRequestSyncFailed = false;

      if (requestStatusSyncRef.current !== status) {
        try {
          const result = await syncClientRequestStatusForTask({
            taskId: task.id,
            projectId: task.project_id,
            source: task.source,
            taskStatus: status,
          });
          requestStatusSyncRef.current = status;
          if (result.synced) {
            queryClient.invalidateQueries({ queryKey: ["client-requests"] });
          }
        } catch (error) {
          linkedRequestSyncFailed = true;
          console.error("Client request sync failed", error);
          if (previousStatus !== status) {
            const { data: rolledBack, error: rollbackError } = await supabase
              .from("tasks")
              .update({ status: previousStatus })
              .eq("id", task.id)
              .eq("status", status)
              .select("id")
              .maybeSingle();
            if (rollbackError || !rolledBack) {
              throw new Error(
                "A sincronização do pedido falhou e o status da tarefa não pôde ser revertido com segurança.",
              );
            }
            persistedStatus = previousStatus;
            savedTaskValuesRef.current.status = previousStatus;
            requestStatusSyncRef.current = previousStatus;
            setStatus(previousStatus);
            linkedRequestStatusRolledBack = true;
          }
        }
      }

      if (assignedTo && assignedTo !== previousAssignedTo) {
        const project = projects.find((p: any) => p.id === task.project_id);
        await notifyUser(assignedTo, `Tarefa atribuída: "${title.trim()}"${project ? ` no projeto ${project.name}` : ""}`, "task", "/kanban");
      }

      if (["review", "done"].includes(persistedStatus) && previousStatus !== persistedStatus && task.project_id && user) {
        await sendTaskAttachmentsToApproval(task.id, task.project_id, title.trim(), user.id);
        queryClient.invalidateQueries({ queryKey: ["all-files"] });
        queryClient.invalidateQueries({ queryKey: ["files"] });
      }

      // Notify on status change to done
      if (persistedStatus === "done" && previousStatus !== "done") {
        const { notifyAdmin } = await import("@/lib/notifyHelpers");
        if (user) {
          await notifyAdmin(`Tarefa "${title.trim()}" concluída por ${profile?.full_name || "equipe"}`, "task", "/kanban");
        }
        if (assignedTo && user && assignedTo !== user.id) {
          await notifyUser(assignedTo, `Tarefa "${title.trim()}" marcada como concluída`, "task", "/kanban");
        }
      }

      // Notify assignee about status change
      if (previousStatus !== persistedStatus && persistedStatus !== "done" && assignedTo && user && assignedTo !== user.id) {
        const statusName = statusLabels[persistedStatus] || persistedStatus;
        await notifyUser(assignedTo, `Tarefa "${title.trim()}" movida para ${statusName}`, "task", "/kanban");
      }

      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["tasks-timeline"] });
      queryClient.invalidateQueries({ queryKey: ["milestones-all"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      if (linkedRequestSyncFailed) {
        toast.warning(
          linkedRequestStatusRolledBack
            ? "Os outros campos foram salvos, mas o status voltou ao anterior porque o pedido não pôde ser sincronizado."
            : "Tarefa atualizada, mas o pedido vinculado não pôde ser sincronizado.",
        );
      } else {
        toast.success("Tarefa atualizada!");
      }
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
    const valor = e.target.value;
    const cursor = e.target.selectionStart;
    setCommentText(valor);

    /*
     * O texto vem do EVENTO, não do estado.
     *
     * Antes isto chamava getMentionContext() dentro de um setTimeout, e
     * essa função é memoizada em [commentText] — ou seja, o timeout
     * executava a versão presa ao texto ANTERIOR. Ao digitar "@", a
     * função ainda lia o texto sem o "@", o padrão não casava e o menu
     * nunca abria. Era por isso que mencionar não funcionava.
     *
     * Lendo do evento não há defasagem: o valor é o que está na tela.
     */
    const antes = valor.slice(0, cursor);
    const casou = antes.match(/@(\w*)$/);
    if (casou) {
      setMentionQuery(casou[1]);
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
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
          await notifyUser(mid, `Você foi mencionado em "${title}"`, "task", "/kanban");
        }
      }

      // Notify assignee if not already notified
      if (assignedTo && assignedTo !== user.id && !notifiedSet.has(assignedTo)) {
        await notifyUser(assignedTo, `Novo comentário em "${title}"`, "task", "/kanban");
      }
    } catch (err: any) { toast.error(err.message); }
    finally { setSendingComment(false); }
  };

  const handleDeleteComment = async (commentId: string) => {
    await supabase.from("task_comments").delete().eq("id", commentId);
    queryClient.invalidateQueries({ queryKey: ["task-comments", task.id] });
    toast.success("Comentário removido");
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
        if (file.size > 2 * 1024 * 1024 * 1024) { toast.error(`${file.name} excede 2GB`); continue; }
        const ext = file.name.split(".").pop();
        const path = `task-attachments/${task.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("files").upload(path, file);
        if (uploadError) { toast.error(`Erro ao enviar ${file.name}`); continue; }
        gravarCopiasSemEsperar("files", path, file, { nome: file.name, mime: file.type });
        await supabase.from("task_attachments").insert({
          task_id: task.id, file_name: file.name, file_url: `files://${path}`,
          file_type: file.type, file_size: file.size, uploaded_by: user.id,
        });
      }
      if (["review", "done"].includes(status) && task.project_id) {
        await sendTaskAttachmentsToApproval(task.id, task.project_id, title, user.id);
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
      const folder = zip.folder(title.replace(/[^a-zA-Z0-9À-ÿ\s]/g, "").trim() || "carrossel");
      for (let i = 0; i < imageAttachments.length; i++) {
        const a = imageAttachments[i];
        const url = a.resolved_url || await resolveFileUrl({ fileUrl: a.file_url });
        const resp = await fetch(url);
        const blob = await resp.blob();
        const ext = a.file_name.split(".").pop() || "png";
        folder!.file(`${String(i + 1).padStart(2, "0")}_${a.file_name}`, blob);
      }
      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${title.replace(/[^a-zA-Z0-9À-ÿ\s]/g, "").trim() || "carrossel"}.zip`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("ZIP baixado!");
    } catch (err: any) {
      toast.error("Erro ao gerar ZIP");
    } finally {
      setDownloadingZip(false);
    }
  };

  const handleDownloadSingle = async (url: string, name: string) => {
    const resolvedUrl = await resolveFileUrl({ fileUrl: url });
    const link = document.createElement("a");
    link.href = resolvedUrl;
    link.download = name;
    link.target = "_blank";
    link.click();
  };

  const assignee = teamMembers.find((m: any) => m.id === assignedTo);
  const project = projects.find((p: any) => p.id === task.project_id);

  const checkedCount = (checklistItems || []).filter((i: any) => i.checked).length;
  const totalCheck = (checklistItems || []).length;
  const checkPercent = totalCheck > 0 ? Math.round((checkedCount / totalCheck) * 100) : 0;
  // Rótulo de campo com ícone pequeno (sem caixa alta: texto.rotulo).
  const rotuloDoCampo = (icone: ReactNode, nome: string) => (
    <p className={juntar(texto.rotulo, "flex items-center")}>
      <span className="mr-1 inline-flex" aria-hidden="true">{icone}</span>
      {nome}
    </p>
  );
  const pilula = "inline-block rounded-full px-2 py-0.5 text-[12px]";

  return (
    /* CENTRAL, e não lateral.
       A gaveta que entra pela direita empurra a leitura para um canto e
       fica estreita justo onde há mais conteúdo — contexto do agente,
       entrega, checklist e comentários. Central é o padrão de todos os
       pop-ups do painel: um só lugar para o olho procurar. */
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className={juntar(superficie.painel, "relative flex w-full max-w-2xl flex-col animate-in fade-in zoom-in-95 duration-150")}
        style={{ maxHeight: "min(88dvh, 900px)" }}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3 sm:px-6">
          <div className="flex min-w-0 items-center">
            <span className={juntar(etiqueta, "mr-2 rounded-full", priorityColors[priority])}>
              {priorityLabels[priority]}
            </span>
            <span className={juntar(texto.auxiliar, "min-w-0 truncate")}>{project?.name}</span>
          </div>
          <div className="ml-3 flex shrink-0 items-center [&>*+*]:ml-1">
            {!readOnly && !editing && (
              <button type="button" onClick={() => setEditing(true)} className={botao.icone} aria-label="Editar tarefa" title="Editar tarefa">
                <Pencil className="h-4 w-4" />
              </button>
            )}
            {/* Excluir daqui: é o detalhe que a Execução e o Kanban abrem, e
                era a única tela sem saída para a tarefa que perdeu o sentido. */}
            {!readOnly && !editing && canManageLinkedAssignment && (
              <button type="button" onClick={() => setConfirmarExclusao(true)} title="Excluir tarefa" aria-label="Excluir tarefa" className={juntar(botao.icone, "hover:bg-destructive/10 hover:text-destructive")}>
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            <button type="button" onClick={onClose} className={botao.icone} aria-label="Fechar" title="Fechar">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body: a única região que rola (nada de rolagem dentro dela). */}
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 sm:px-6" style={{ overscrollBehavior: "contain", WebkitOverflowScrolling: "touch" }}>
          {/* Title */}
          {editing ? (
            <input value={title} onChange={e => setTitle(e.target.value)} aria-label="Título da tarefa" className={juntar(campo, "text-[15px] font-semibold")} />
          ) : (
            <h2 className={juntar(texto.tituloPagina, "min-w-0 truncate")} title={title}>{title}</h2>
          )}

          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-4">
            <div className="min-w-0 space-y-1">
              {rotuloDoCampo(<Flag className="h-3 w-3" />, "Status")}
              {editing ? (
                <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Status" className={juntar(campo, "cursor-pointer")}>
                  {statusOrder.map(s => <option key={s} value={s}>{statusLabels[s]}</option>)}
                </select>
              ) : (
                <span className={juntar(pilula, "bg-muted text-foreground")}>{statusLabels[status]}</span>
              )}
            </div>
            <div className="min-w-0 space-y-1">
              {rotuloDoCampo(<Clock className="h-3 w-3" />, "Prioridade")}
              {editing ? (
                <select value={priority} onChange={e => setPriority(e.target.value)} aria-label="Prioridade" className={juntar(campo, "cursor-pointer")}>
                  <option value="low">Baixa</option><option value="medium">Média</option>
                  <option value="high">Alta</option><option value="urgent">Urgente</option>
                </select>
              ) : (
                <span className={juntar(pilula, priorityColors[priority])}>{priorityLabels[priority]}</span>
              )}
            </div>
            <div className="min-w-0 space-y-1">
              {rotuloDoCampo(<User className="h-3 w-3" />, "Responsável")}
              {editing ? (
                <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)}
                  aria-label="Responsável"
                  disabled={
                    !!linkedRequestId
                    && (
                      !canManageLinkedAssignment
                      || loadingLinkedAssignees
                      || linkedAssigneesReadFailed
                    )
                  }
                  className={juntar(campo, "cursor-pointer")}>
                  <option value="">Sem responsável</option>
                  {assignmentOptions.map((m: any) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                </select>
              ) : (
                <p className={juntar(texto.corpo, "truncate")}>{assignee?.full_name || "-"}</p>
              )}
            </div>
            <div className="min-w-0 space-y-1">
              {rotuloDoCampo(<Calendar className="h-3 w-3" />, "Prazo")}
              {editing ? (
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} aria-label="Prazo" className={campo} />
              ) : (
                <p className={juntar(texto.corpo, "truncate")}>
                  {dueDate ? new Date(dueDate).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }) : "-"}
                </p>
              )}
            </div>
            <div className="col-span-2 min-w-0 space-y-1">
              {editing ? (
                <>
                  <label
                    htmlFor="task-detail-delivery-type"
                    className={juntar(texto.rotulo, "block")}
                  >
                    Tipo de entrega
                  </label>
                  <select
                    id="task-detail-delivery-type"
                    value={deliveryType}
                    onChange={event => {
                      const nextType =
                        event.target.value as TaskDeliveryType;
                      setDeliveryType(nextType);
                      setWorkstream(
                        suggestedWorkstreamForDeliveryType(nextType),
                      );
                    }}
                    className={juntar(campo, "cursor-pointer")}
                  >
                    {TASK_DELIVERY_TYPE_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <>
                  <p className={texto.rotulo}>
                    Tipo de entrega
                  </p>
                  <span className={juntar(pilula, "bg-violet-500/10 text-violet-500")}>
                    {TASK_DELIVERY_TYPE_LABELS[deliveryType]}
                  </span>
                </>
              )}
            </div>
            <div className="col-span-2 min-w-0 space-y-1">
              {editing ? (
                <>
                  <label
                    htmlFor="task-detail-workstream"
                    className={juntar(texto.rotulo, "block")}
                  >
                    Área
                  </label>
                  <select
                    id="task-detail-workstream"
                    value={workstream}
                    onChange={e => setWorkstream(e.target.value as TaskWorkstream)}
                    className={juntar(campo, "cursor-pointer")}
                  >
                    {TASK_WORKSTREAM_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </>
              ) : (
                <>
                  <p className={texto.rotulo}>Área</p>
                  <span className={juntar(pilula, "bg-primary/10 text-primary")}>
                    {TASK_WORKSTREAM_LABELS[workstream]}
                  </span>
                </>
              )}
            </div>
          </div>

          {task.milestone?.title && (
            <div className="min-w-0 space-y-1">
              {rotuloDoCampo(<Folder className="h-3 w-3" />, "Milestone")}
              <span className={juntar(pilula, "bg-primary/10 text-primary")}>{task.milestone.title}</span>
            </div>
          )}

          {/* Tudo recolhe (SISTEMA.md 4.3): as quatro partes são Secao; a
              escolha de recolher fica guardada por pessoa e tela. */}
          <Secao titulo="Descrição / Instruções" nivel={3}>
            {editing ? (
              <textarea value={description} onChange={e => setDescription(e.target.value)} rows={6}
                aria-label="Descrição / Instruções"
                className={juntar(campoTexto, "resize-none")}
                placeholder="Descreva as instruções detalhadas da tarefa..." />
            ) : description ? (
              <p className={juntar(texto.corpo, "whitespace-pre-wrap leading-relaxed")}>{description}</p>
            ) : (
              <p className={texto.auxiliar}>Sem descrição ou instruções.</p>
            )}
          </Secao>

          {/* ═══ Checklist section ═══ */}
          <Secao titulo="Checklist" nivel={3} descricao={totalCheck > 0 ? `${checkedCount} de ${totalCheck}` : undefined}>
            <div className="space-y-2">
              {/* Progress bar */}
              {totalCheck > 0 && (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${checkPercent}%` }} />
                </div>
              )}

              {loadingChecklist ? (
                <p className={juntar(texto.auxiliar, "py-2 text-center")}>Carregando...</p>
              ) : checklistReadFailed ? (
                <SectionLoadError
                  label="o checklist"
                  onRetry={() => void refetchChecklist()}
                />
              ) : (
                <ul className={lista.aberta}>
                  {(checklistItems || []).map((item: any) => (
                    <li key={item.id} className="group flex min-w-0 items-center rounded-md px-2 py-1.5 transition-colors hover:bg-muted/40">
                      <button type="button" onClick={() => handleToggleCheck(item)}
                        aria-label={item.checked ? `Desmarcar ${item.title}` : `Marcar ${item.title}`}
                        className="mr-2 shrink-0 cursor-pointer border-none bg-transparent p-0 text-foreground">
                        {item.checked
                          ? <CheckSquare className="h-4 w-4 text-primary" />
                          : <Square className="h-4 w-4 text-muted-foreground" />
                        }
                      </button>
                      <span className={juntar(texto.corpo, "min-w-0 flex-1", item.checked && "text-muted-foreground line-through")}>
                        {item.title}
                      </span>
                      {!readOnly && (
                        <button type="button" onClick={() => handleDeleteCheckItem(item.id)}
                          aria-label={`Remover ${item.title}`}
                          className="ml-2 cursor-pointer rounded border-none bg-transparent p-0.5 text-muted-foreground opacity-0 transition-all hover:text-destructive group-hover:opacity-100">
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {/* Add checklist item */}
              {!readOnly && !checklistReadFailed && (
                <>
                  <div className="flex items-center">
                    <input
                      value={newCheckItem}
                      onChange={e => setNewCheckItem(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleAddCheckItem()}
                      placeholder="Adicionar item..."
                      aria-label="Novo item do checklist"
                      className={juntar(campo, "mr-2 flex-1")}
                    />
                    <button type="button" onClick={handleAddCheckItem} disabled={addingCheck || !newCheckItem.trim()}
                      aria-label="Adicionar item"
                      className={juntar(botao.secundario, "w-9 px-0")}>
                      {addingCheck ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <TaskChecklistTemplatePicker
                    taskId={task.id}
                    currentCount={(checklistItems || []).length}
                  />
                </>
              )}
            </div>
          </Secao>

          {/* Attachments section */}
          <Secao titulo="Anexos" nivel={3} descricao={(attachments || []).length > 0 ? `${(attachments || []).length} ${(attachments || []).length === 1 ? "arquivo" : "arquivos"}` : undefined}>
            <div className="space-y-2">
              {!readOnly && (
                <div>
                  <input ref={fileInputRef} type="file" multiple onChange={handleFileUpload} className="hidden"
                    accept="image/*,video/*,.pdf,.doc,.docx,.pptx,.xlsx,.zip,.md,.txt" />
                  <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
                    className={juntar("flex w-full cursor-pointer items-center justify-center rounded-md border border-dashed border-border bg-transparent py-3 text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-50", foco)}>
                    {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                    <span className="text-[12px] font-medium">{uploading ? "Enviando..." : "Anexar arquivos"}</span>
                  </button>
                </div>
              )}

              {loadingAttachments ? (
                <p className={juntar(texto.auxiliar, "py-4 text-center")}>Carregando anexos...</p>
              ) : attachmentsReadFailed ? (
                <SectionLoadError
                  label="os anexos"
                  onRetry={() => void refetchAttachments()}
                />
              ) : (attachments || []).length === 0 ? (
                <p className={juntar(texto.auxiliar, "py-4 text-center")}>Nenhum anexo</p>
              ) : (
                <div className="space-y-2">
                  {/* Carousel download button */}
                  {isCarousel && (
                    <button
                      type="button"
                      onClick={handleDownloadZip}
                      disabled={downloadingZip}
                      className={juntar(botao.secundario, "w-full")}
                    >
                      {downloadingZip ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Archive className="mr-2 h-4 w-4" />}
                      Baixar carrossel em ZIP ({imageAttachments.length} imagens)
                    </button>
                  )}

                  {imageAttachments.length > 0 && (
                    <div className="grid grid-cols-3 gap-2">
                      {imageAttachments.map((a: any) => (
                        <div key={a.id} className="group relative aspect-square overflow-hidden rounded-md border border-border">
                          <a href={a.resolved_url || undefined} target="_blank" rel="noopener noreferrer">
                            <img src={a.resolved_url || undefined} alt={a.file_name} className="h-full w-full object-cover" />
                          </a>
                          <div className="absolute inset-x-0 bottom-0 flex items-center justify-end bg-gradient-to-t from-black/60 to-transparent p-1 opacity-0 transition-opacity group-hover:opacity-100 [&>*+*]:ml-0.5">
                            {!isCarousel && (
                              <button type="button" onClick={() => handleDownloadSingle(a.file_url, a.file_name)}
                                aria-label={`Baixar ${a.file_name}`}
                                className="cursor-pointer rounded border-none bg-black/40 p-1 text-white hover:bg-black/60">
                                <Download className="h-3 w-3" />
                              </button>
                            )}
                            {!readOnly && (
                              <button type="button" onClick={() => setConfirmDelete(a.id)}
                                aria-label={`Remover ${a.file_name}`}
                                className="cursor-pointer rounded border-none bg-black/40 p-1 text-white hover:bg-destructive">
                                <Trash2 className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {(attachments || []).filter((a: any) => !a.file_type?.startsWith("image/")).length > 0 && (
                    <ul className={juntar(lista.aberta, lista.divisoria)}>
                      {(attachments || []).filter((a: any) => !a.file_type?.startsWith("image/")).map((a: any) => (
                        <li key={a.id} className="group flex min-w-0 items-center rounded-md px-2 py-2 transition-colors hover:bg-muted/40">
                          <span className="mr-3 inline-flex shrink-0">
                            {a.file_type?.startsWith("video/") ? (
                              <span className="block h-10 w-16 overflow-hidden rounded-md bg-muted">
                                <video src={a.resolved_url || undefined} className="h-full w-full object-cover" muted />
                              </span>
                            ) : getFileIcon(a.file_type)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[12px] text-foreground">{a.file_name}</p>
                            <p className="truncate text-[11px] text-muted-foreground">
                              {formatSize(a.file_size)} • {a.uploader?.full_name} • {new Date(a.created_at).toLocaleDateString("pt-BR")}
                            </p>
                          </div>
                          <div className="ml-2 flex shrink-0 items-center [&>*+*]:ml-1">
                            <a href={a.resolved_url || undefined} target="_blank" rel="noopener noreferrer"
                              aria-label={`Baixar ${a.file_name}`}
                              className={juntar(botao.icone, "h-7 w-7")}>
                              <Download className="h-3.5 w-3.5" />
                            </a>
                            {!readOnly && (
                              <button type="button" onClick={() => setConfirmDelete(a.id)}
                                aria-label={`Remover ${a.file_name}`}
                                className={juntar(botao.icone, "h-7 w-7 opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100")}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </Secao>

          {/* ═══ O trabalho do agente nesta tarefa ═══
              Antes o card mostrava título, prazo e responsável, e nada
              sobre quem de fato estava mexendo nele: o trabalho acontecia
              num lugar e o registro em outro. Some sozinho quando nenhum
              agente pegou a tarefa. */}
          <ContextoDoAgente taskId={task.id} />

          {/* ═══ Comments / Activity section ═══
              Sem rolagem própria: o corpo da janela já rola (uma por região). */}
          <Secao titulo="Comentários" nivel={3} descricao={(comments || []).length > 0 ? `${(comments || []).length} ${(comments || []).length === 1 ? "comentário" : "comentários"}` : undefined}>
            <div className="space-y-3">
              {loadingComments ? (
                <p className={juntar(texto.auxiliar, "py-4 text-center")}>Carregando...</p>
              ) : commentsReadFailed ? (
                <SectionLoadError
                  label="os comentários"
                  onRetry={() => void refetchComments()}
                />
              ) : (comments || []).length === 0 ? (
                <p className={juntar(texto.auxiliar, "py-4 text-center")}>Nenhum comentário ainda.</p>
              ) : (
                <div className="space-y-3">
                  {(comments || []).map((c: any) => (
                    <div key={c.id} className="group flex">
                      <Avatar className="mr-2.5 mt-0.5 h-7 w-7 shrink-0">
                        <AvatarFallback className="bg-muted text-[11px] font-medium text-muted-foreground">
                          {c.author?.full_name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2) || "?"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center">
                          <span className="min-w-0 truncate text-[12px] font-semibold text-foreground">{c.author?.full_name}</span>
                          <span className="ml-2 shrink-0 text-[11px] tabular-nums text-muted-foreground">
                            {new Date(c.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                            {" "}
                            {new Date(c.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          {(c.author_id === profile?.id || profile?.role === "admin") && (
                            <button type="button" onClick={() => handleDeleteComment(c.id)}
                              aria-label="Excluir comentário"
                              className="ml-auto cursor-pointer rounded border-none bg-transparent p-0.5 text-muted-foreground opacity-0 transition-all hover:text-destructive group-hover:opacity-100">
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                        <p className={juntar(texto.corpo, "mt-0.5 whitespace-pre-wrap leading-relaxed")}>
                          <TaskCommentContent
                            text={c.content}
                            memberNames={teamMembers.map(
                              (member: any) => member.full_name,
                            )}
                          />
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
                    className="absolute bottom-full left-0 z-10 mb-1 max-h-[160px] w-full overflow-y-auto rounded-md border border-border bg-card py-1 shadow-sm">
                    {filteredMentions.map((m: any, i: number) => (
                      <button type="button" key={m.id}
                        onClick={() => insertMention(m)}
                        className={juntar(
                          "flex w-full cursor-pointer items-center border-none bg-transparent px-3 py-2 text-left text-[12px] transition-colors",
                          i === mentionIndex ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted",
                        )}>
                        <Avatar className="mr-2 h-5 w-5">
                          <AvatarFallback className="bg-muted text-[11px] text-muted-foreground">
                            {m.full_name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium">{m.full_name}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-end">
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
                    aria-label="Novo comentário"
                    rows={2}
                    className={juntar(campoTexto, "mr-2 min-h-0 flex-1 resize-none")}
                  />
                  <button type="button" onClick={handleSendComment} disabled={sendingComment || !commentText.trim()}
                    aria-label="Enviar comentário"
                    className={juntar(botao.secundario, "w-9 px-0 text-primary")}>
                    {sendingComment ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          </Secao>
        </div>

        {/* Footer actions: um primário (Salvar). */}
        {editing && (
          <div className="flex shrink-0 items-center justify-end border-t border-border px-5 py-3 sm:px-6 [&>*+*]:ml-2">
            <button type="button" onClick={() => {
              const saved = savedTaskValuesRef.current;
              setEditing(false);
              setTitle(saved.title);
              setDescription(saved.description);
              setPriority(saved.priority);
              setStatus(saved.status);
              setDeliveryType(saved.deliveryType);
              setWorkstream(saved.workstream);
              setAssignedTo(saved.assignedTo);
              setDueDate(saved.dueDate);
            }}
              disabled={saving}
              className={botao.secundario}>
              Cancelar
            </button>
            <button type="button" onClick={handleSave} disabled={saving || !title.trim()}
              className={botao.primario}>
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
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
      <ConfirmModal
        open={confirmarExclusao}
        title="Excluir tarefa"
        description={`"${task.title}" sai do Kanban de vez. Comentários, checklist e anexos vão junto; o diário do cliente guarda que ela foi descartada.`}
        confirmLabel="Excluir tarefa"
        onConfirm={async () => {
          const r = await excluirTarefa(task);
          if (!r.ok) {
            toast.error(r.mensagem);
            setConfirmarExclusao(false);
            return;
          }
          toast.success("Tarefa excluída");
          setConfirmarExclusao(false);
          queryClient.invalidateQueries({ queryKey: ["tasks"] });
          queryClient.invalidateQueries({ queryKey: ["ciclo-situacao"] });
          queryClient.invalidateQueries({ queryKey: ["execucao"] });
          onClose();
        }}
        onCancel={() => setConfirmarExclusao(false)}
      />
    </div>
  );
}
