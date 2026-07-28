import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useClientRequests,
  useClients,
  useProjects,
} from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { notifyOpsUpdate } from "@/lib/opsSync";
import {
  canMutateClientRequests,
  clientRequestStatusForTaskStatus,
  createOrRecoverRequestTask,
  requestIdFromTaskSource,
  requestPriorityToTaskPriority,
  requestTaskKanbanPath,
  syncClientRequestStatusForTask,
  type RequestTaskPriority,
} from "@/lib/requestTaskWorkflow";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const statusOptions = [
  { value: "new", label: "Novo", cls: "bg-info/10 text-info" },
  { value: "analyzing", label: "Em Análise", cls: "bg-warning/10 text-warning" },
  { value: "in_progress", label: "Em Andamento", cls: "bg-primary/10 text-primary" },
  { value: "completed", label: "Concluído", cls: "bg-success/10 text-success" },
];

const taskPriorityOptions: Array<{ value: RequestTaskPriority; label: string }> = [
  { value: "low", label: "Baixa" },
  { value: "medium", label: "Média" },
  { value: "high", label: "Alta" },
  { value: "urgent", label: "Urgente" },
];

const priorityBadge: Record<string, { cls: string; label: string }> = {
  low: { cls: "bg-muted text-muted-foreground", label: "Baixa" },
  normal: { cls: "bg-secondary text-foreground", label: "Normal" },
  medium: { cls: "bg-secondary text-foreground", label: "Média" },
  high: { cls: "bg-warning/10 text-warning", label: "Alta" },
  urgent: { cls: "bg-destructive/10 text-destructive", label: "Urgente" },
};

export default function AdminRequests() {
  const { user, profile } = useAuth();
  const { data: requests, isLoading } = useClientRequests();
  const { data: clients } = useClients();
  const { data: projects } = useProjects();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [selected, setSelected] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("all");
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [taskProjectId, setTaskProjectId] = useState("");
  const [taskAssigneeId, setTaskAssigneeId] = useState("");
  const [taskPriority, setTaskPriority] = useState<RequestTaskPriority>("medium");
  const [taskDueDate, setTaskDueDate] = useState("");

  const roleCanMutate = canMutateClientRequests(profile?.role);
  const { data: canManageSelectedClient, isFetching: checkingClientPermission } =
    useQuery({
      queryKey: [
        "can-manage-client-request",
        user?.id,
        selected?.client_id,
      ],
      queryFn: async () => {
        if (profile?.role === "admin") return true;
        if (profile?.role !== "manager" || !selected?.client_id) return false;
        const { data, error } = await supabase.rpc("can_manage_client", {
          _client_id: selected.client_id,
        });
        if (error) throw error;
        return data === true;
      },
      enabled: !!user && !!selected?.client_id && roleCanMutate,
    });

  const canMutateSelected =
    profile?.role === "admin" ||
    (profile?.role === "manager" && canManageSelectedClient === true);

  const {
    data: linkedRequestTask,
    isFetching: checkingLinkedTask,
    isError: linkedTaskReadFailed,
  } = useQuery({
    queryKey: ["request-linked-task", user?.id, selected?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id, project_id, status, source")
        .like("source", `client_request:${selected!.id}:%`)
        .is("deleted_at", null)
        .limit(2);
      if (error) throw error;
      const linked = (data || []).filter(
        (task: any) =>
          requestIdFromTaskSource(task.source) === selected!.id,
      );
      if (linked.length > 1) {
        throw new Error("Há mais de uma tarefa vinculada a este pedido.");
      }
      return linked[0] || null;
    },
    enabled:
      !!user
      && !!selected?.id
      && !!selected?.client_id
      && canMutateSelected,
  });

  const {
    data: eligibleAssignees = [],
    error: eligibleAssigneesError,
    isFetching: loadingEligibleAssignees,
    refetch: refetchEligibleAssignees,
  } = useQuery({
    queryKey: [
      "request-task-assignees",
      user?.id,
      selected?.client_id,
    ],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke(
        "request-task-workflow",
        {
          body: {
            action: "list_assignees",
            clientId: selected!.client_id,
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
      taskFormOpen &&
      !!user &&
      !!selected?.client_id &&
      canMutateSelected,
  });

  const filters = [
    { value: "all", label: "Todos" },
    { value: "new", label: "Novos" },
    { value: "in_progress", label: "Em Andamento" },
    { value: "completed", label: "Concluídos" },
  ];

  const filteredRequests = (requests || []).filter(
    (request: any) => filter === "all" || request.status === filter,
  );

  const getClient = (id: string) =>
    (clients || []).find((client: any) => client.id === id);
  const getProject = (id: string) =>
    (projects || []).find((project: any) => project.id === id);

  const selectedClientProjects = useMemo(
    () =>
      (projects || []).filter(
        (project: any) =>
          project.client_id === selected?.client_id &&
          !project.deleted_at &&
          project.status !== "done",
      ),
    [projects, selected?.client_id],
  );

  const recordRequestUpdate = async (
    request: any,
    message: string,
    clientVisible: boolean,
    projectId = request.project_id,
    notifyLegacyOps = true,
  ) => {
    if (!projectId) return;
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    if (!authUser) return;

    const { data: update } = await supabase
      .from("updates")
      .insert({
        project_id: projectId,
        author_id: authUser.id,
        client_visible: clientVisible,
        message,
        update_type: "request",
      })
      .select()
      .single();
    if (notifyLegacyOps) notifyOpsUpdate(update);
  };

  const handleStatusChange = async (status: string) => {
    if (!selected || !canMutateSelected || saving) return;
    if (checkingLinkedTask || linkedTaskReadFailed) {
      toast.error(
        linkedTaskReadFailed
          ? "Não foi possível confirmar o vínculo com o Kanban. Atualize a tela antes de alterar o status."
          : "Aguarde a confirmação do vínculo com o Kanban.",
      );
      return;
    }
    if (linkedRequestTask) {
      toast.error(
        "Este pedido acompanha uma tarefa. Altere o status pelo Kanban para manter os dois sincronizados.",
      );
      navigate(
        requestTaskKanbanPath(
          linkedRequestTask.project_id,
          linkedRequestTask.id,
        ),
      );
      return;
    }
    setSaving(true);
    try {
      const { data: updatedRequest, error } = await supabase
        .from("client_requests")
        .update({ status })
        .eq("id", selected.id)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!updatedRequest) {
        throw new Error("O pedido não foi encontrado ou não pode ser alterado.");
      }

      const label =
        statusOptions.find((option) => option.value === status)?.label ||
        status;
      await recordRequestUpdate(
        selected,
        `Pedido "${selected.title}": status alterado para ${label}`,
        true,
      );
      await queryClient.invalidateQueries({ queryKey: ["client-requests"] });
      setSelected((current: any) =>
        current ? { ...current, status } : current,
      );
      toast.success("Status atualizado");
    } catch (error: any) {
      toast.error(error.message || "Não foi possível atualizar o pedido.");
    } finally {
      setSaving(false);
    }
  };

  const openTaskForm = () => {
    if (!selected || !canMutateSelected) return;
    const requestedProject = selectedClientProjects.some(
      (project: any) => project.id === selected.project_id,
    )
      ? selected.project_id
      : selectedClientProjects[0]?.id || "";
    setTaskProjectId(requestedProject);
    setTaskAssigneeId("");
    setTaskPriority(requestPriorityToTaskPriority(selected.priority));
    setTaskDueDate("");
    setTaskFormOpen(true);
  };

  const handleCreateTask = async () => {
    if (!selected || !canMutateSelected || saving) return;

    const project = selectedClientProjects.find(
      (candidate: any) => candidate.id === taskProjectId,
    );
    if (!project) {
      toast.error("Selecione um projeto deste cliente.");
      return;
    }
    if (
      taskAssigneeId &&
      !eligibleAssignees.some((member: any) => member.id === taskAssigneeId)
    ) {
      toast.error("O responsável não está autorizado para este cliente.");
      return;
    }

    setSaving(true);
    try {
      const result = await createOrRecoverRequestTask(
        {
          requestId: selected.id,
          title: selected.title,
          description: selected.description ?? null,
          projectId: project.id,
          assignedTo: taskAssigneeId || null,
          priority: taskPriority,
          dueDate: taskDueDate || null,
        },
        { allowCreate: selected.status !== "in_progress" },
      );

      const requestStatus = clientRequestStatusForTaskStatus(
        result.task.status,
      );
      const statusSync = await syncClientRequestStatusForTask({
        taskId: result.task.id,
        projectId: result.task.project_id,
        source: result.task.source,
        taskStatus: result.task.status,
      });
      if (!statusSync.synced) {
        throw new Error(
          "A tarefa foi preservada, mas o vínculo do pedido precisa ser revisado.",
        );
      }

      if (result.resolution === "created") {
        await recordRequestUpdate(
          selected,
          `Pedido "${selected.title}" transformado em tarefa`,
          false,
          result.task.project_id,
          false,
        );
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["client-requests"] }),
        queryClient.invalidateQueries({ queryKey: ["tasks"] }),
      ]);

      setSelected((current: any) =>
        current ? { ...current, status: requestStatus } : current,
      );
      setTaskFormOpen(false);
      toast.success(
        result.resolution === "created"
          ? "Tarefa criada a partir do pedido"
          : "Tarefa já vinculada recuperada sem duplicação",
      );
      navigate(
        requestTaskKanbanPath(result.task.project_id, result.task.id),
      );
    } catch (error: any) {
      toast.error(
        error.message || "Não foi possível transformar o pedido em tarefa.",
      );
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (date: string) =>
    new Date(date).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="heading-page">Pedidos de Clientes</p>
          {!roleCanMutate ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Acompanhamento em modo leitura. Admin ou manager gerencia os
              pedidos.
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-hidden">
          {filters.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setFilter(item.value)}
              className={`px-3 py-1.5 rounded-full text-[12px] transition-colors cursor-pointer border flex-shrink-0 whitespace-nowrap ${
                filter === item.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:text-foreground bg-transparent"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((item) => (
            <Skeleton key={item} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : (requests || []).length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          Nenhum pedido recebido.
        </div>
      ) : (
        <div className="space-y-2 stagger-children">
          {filteredRequests.map((request: any) => {
            const client = getClient(request.client_id);
            const project = getProject(request.project_id);
            const status =
              statusOptions.find(
                (option) => option.value === request.status,
              ) || statusOptions[0];
            const priority =
              priorityBadge[request.priority] || priorityBadge.normal;
            return (
              <button
                key={request.id}
                type="button"
                onClick={() => setSelected(request)}
                className="w-full bg-card border border-border rounded-xl px-5 py-4 cursor-pointer hover:border-muted-foreground/30 transition-colors text-left"
              >
                <div className="flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {request.title}
                    </p>
                    <p className="text-[13px] text-muted-foreground mt-0.5 line-clamp-1">
                      {request.description}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5 text-[11px] text-muted-foreground">
                      <span>
                        {client?.company_name || client?.full_name || "—"}
                      </span>
                      <span>•</span>
                      <span>{project?.name || "Sem projeto"}</span>
                      <span>•</span>
                      <span className="font-mono">
                        {formatDate(request.created_at)}
                      </span>
                    </div>
                  </div>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${priority.cls}`}
                  >
                    {priority.label}
                  </span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${status.cls}`}
                  >
                    {status.label}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected ? (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <button
            type="button"
            aria-label="Fechar detalhes do pedido"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setSelected(null)}
          />
          <div
            className="relative bg-card border border-border rounded-t-2xl sm:rounded-2xl w-full max-w-[520px] sm:mx-4 animate-in fade-in zoom-in-[0.96] duration-200 max-h-[95vh] overflow-hidden"
            style={{ boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">
                Detalhes do Pedido
              </h2>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Fechar"
                className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Título
                </p>
                <p className="text-sm text-foreground mt-1">
                  {selected.title}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Descrição
                </p>
                <p className="text-sm text-foreground mt-1 whitespace-pre-wrap">
                  {selected.description}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Cliente
                  </p>
                  <p className="text-sm text-foreground mt-1">
                    {getClient(selected.client_id)?.company_name ||
                      getClient(selected.client_id)?.full_name ||
                      "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Projeto
                  </p>
                  <p className="text-sm text-foreground mt-1">
                    {getProject(selected.project_id)?.name || "Sem projeto"}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                  Status
                </p>
                <div className="flex flex-wrap gap-1">
                  {statusOptions.map((status) => (
                    <button
                      key={status.value}
                      type="button"
                      disabled={
                        saving ||
                        checkingClientPermission ||
                        checkingLinkedTask ||
                        linkedTaskReadFailed ||
                        !canMutateSelected
                      }
                      onClick={() => handleStatusChange(status.value)}
                      className={`text-[11px] px-3 py-1 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                        selected.status === status.value
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border text-muted-foreground hover:text-foreground bg-transparent"
                      }`}
                    >
                      {status.label}
                    </button>
                  ))}
                </div>
                {roleCanMutate &&
                !checkingClientPermission &&
                !canMutateSelected ? (
                  <p className="mt-2 text-[11px] text-warning">
                    Este pedido pertence a um cliente fora da sua gestão.
                  </p>
                ) : null}
                {linkedRequestTask ? (
                  <p className="mt-2 text-[11px] text-primary">
                    Status sincronizado pelo Kanban da tarefa vinculada.
                  </p>
                ) : null}
                {linkedTaskReadFailed ? (
                  <p className="mt-2 text-[11px] text-destructive">
                    Não foi possível confirmar o vínculo com o Kanban. Atualize a tela antes de alterar o status.
                  </p>
                ) : null}
              </div>
            </div>
            {selected.status !== "completed" && canMutateSelected ? (
              <div className="px-5 sm:px-6 py-4 border-t border-border flex flex-col sm:flex-row justify-end gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={openTaskForm}
                  disabled={saving || selectedClientProjects.length === 0}
                  className="px-4 py-2 rounded-[10px] text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 flex items-center gap-2"
                >
                  Transformar em Tarefa
                </button>
                <button
                  type="button"
                  onClick={() => handleStatusChange("completed")}
                  disabled={
                    saving ||
                    checkingLinkedTask ||
                    linkedTaskReadFailed
                  }
                  className="px-4 py-2 rounded-[10px] text-[13px] text-success border border-success/30 hover:bg-success/10 transition-colors cursor-pointer bg-transparent disabled:opacity-50"
                >
                  Marcar como Concluído
                </button>
                {selectedClientProjects.length === 0 ? (
                  <p className="text-[11px] text-warning sm:self-center">
                    Cadastre um projeto ativo para este cliente.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <Dialog
        open={taskFormOpen && !!selected}
        onOpenChange={(open) => {
          if (!saving) setTaskFormOpen(open);
        }}
      >
        <DialogContent className="w-[calc(100%-2rem)] max-w-[520px] gap-0 overflow-hidden border-border bg-card p-0">
          {selected ? (
            <>
              <DialogHeader className="border-b border-border px-6 py-4 pr-12">
                <DialogTitle className="text-sm font-semibold text-foreground">
                  Transformar pedido em tarefa
                </DialogTitle>
                <DialogDescription className="line-clamp-1 text-[11px] text-muted-foreground">
                  {selected.title}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 px-6 py-5">
              <div className="space-y-1.5">
                <label
                  htmlFor="request-task-project"
                  className="text-[11px] uppercase tracking-wider text-muted-foreground"
                >
                  Projeto do cliente *
                </label>
                <select
                  id="request-task-project"
                  value={taskProjectId}
                  onChange={(event) => setTaskProjectId(event.target.value)}
                  className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50"
                >
                  <option value="">Selecionar projeto...</option>
                  {selectedClientProjects.map((project: any) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="request-task-assignee"
                  className="text-[11px] uppercase tracking-wider text-muted-foreground"
                >
                  Responsável autorizado
                </label>
                <select
                  id="request-task-assignee"
                  value={taskAssigneeId}
                  onChange={(event) => setTaskAssigneeId(event.target.value)}
                  disabled={
                    loadingEligibleAssignees || !!eligibleAssigneesError
                  }
                  className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50"
                >
                  <option value="">
                    {loadingEligibleAssignees
                      ? "Carregando responsáveis..."
                      : "Sem responsável"}
                  </option>
                  {eligibleAssignees.map((member: any) => (
                    <option key={member.id} value={member.id}>
                      {member.full_name}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-muted-foreground">
                  A lista inclui admins e membros já vinculados a este cliente.
                </p>
                {eligibleAssigneesError ? (
                  <button
                    type="button"
                    onClick={() => void refetchEligibleAssignees()}
                    className="text-[10px] text-destructive underline underline-offset-2"
                  >
                    Não foi possível carregar. Tentar novamente.
                  </button>
                ) : null}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="request-task-priority"
                    className="text-[11px] uppercase tracking-wider text-muted-foreground"
                  >
                    Prioridade
                  </label>
                  <select
                    id="request-task-priority"
                    value={taskPriority}
                    onChange={(event) =>
                      setTaskPriority(
                        event.target.value as RequestTaskPriority,
                      )
                    }
                    className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50"
                  >
                    {taskPriorityOptions.map((priority) => (
                      <option key={priority.value} value={priority.value}>
                        {priority.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label
                    htmlFor="request-task-due-date"
                    className="text-[11px] uppercase tracking-wider text-muted-foreground"
                  >
                    Prazo
                  </label>
                  <input
                    id="request-task-due-date"
                    type="date"
                    value={taskDueDate}
                    onChange={(event) => setTaskDueDate(event.target.value)}
                    className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50"
                  />
                </div>
              </div>
              </div>

              <DialogFooter className="border-t border-border px-6 py-4">
                <button
                  type="button"
                  onClick={() => setTaskFormOpen(false)}
                  disabled={saving}
                  className="px-4 py-2 rounded-[10px] text-[13px] text-muted-foreground border border-border hover:text-foreground disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleCreateTask}
                  disabled={saving || !taskProjectId}
                  className="px-5 py-2 rounded-[10px] text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 flex items-center gap-2"
                >
                  {saving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : null}
                  {saving ? "Criando..." : "Criar e abrir no Kanban"}
                </button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
