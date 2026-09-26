import { useEffect, useMemo, useState, type ReactNode } from "react";
import JanelaDoCelular from "@/components/sistema/JanelaDoCelular";
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
import { Building2, Flag, Inbox, ListTodo, Loader2, Search, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AreaDeTrabalho,
  CabecalhoDePagina,
  CampoDeFormulario,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  RegiaoRolavel,
  SeletorCompacto,
  botao,
  campo,
  etiqueta,
  juntar,
  superficie,
  texto,
  useEstadoDaTela,
  useLargo,
} from "@/components/sistema";

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

/** Filtro de prioridade: normal e média contam juntas (o cliente escolhe "normal"). */
const PRIORIDADES = ["todas", "urgent", "high", "normal", "low"];
const grupoDaPrioridade = (p: string) => (p === "medium" ? "normal" : p || "normal");

export default function AdminRequests() {
  const { user, profile } = useAuth();
  const { data: requests, isLoading, isError, refetch } = useClientRequests();
  const { data: clients } = useClients();
  const { data: projects } = useProjects();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // Computador (>= 1024): lista e detalhe lado a lado. Celular e tablet: o
  // detalhe abre numa janela por cima, como antes.
  const largo = useLargo();

  const [selected, setSelected] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  // Filtros, busca e o pedido aberto ficam guardados: sair e voltar mantém.
  const [filter, setFilter] = useEstadoDaTela<string>("pedidos:status", "all", {
    validar: (v) => typeof v === "string" && ["all", "new", "in_progress", "completed"].indexOf(v) >= 0,
  });
  const [filtroCliente, setFiltroCliente] = useEstadoDaTela<string>("pedidos:cliente", "todos", { validar: (v) => typeof v === "string" });
  const [filtroPrioridade, setFiltroPrioridade] = useEstadoDaTela<string>("pedidos:prioridade", "todas", {
    validar: (v) => typeof v === "string" && PRIORIDADES.indexOf(v) >= 0,
  });
  const [busca, setBusca] = useEstadoDaTela<string>("pedidos:busca", "");
  const [abertoId, setAbertoId] = useEstadoDaTela<string>("pedidos:aberto", "");
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
    { value: "in_progress", label: "Em andamento" },
    { value: "completed", label: "Concluídos" },
  ];

  const getClient = (id: string) =>
    (clients || []).find((client: any) => client.id === id);
  const getProject = (id: string) =>
    (projects || []).find((project: any) => project.id === id);
  const nomeDoCliente = (id: string) => {
    const c = getClient(id);
    return c?.company_name || c?.full_name || "";
  };

  const todos = requests || [];
  const termo = busca.trim().toLowerCase();
  // Cliente, prioridade e busca recortam antes do status: o número de cada
  // opção de status conta o que a lista mostra.
  const recorte = todos.filter((request: any) => {
    if (filtroCliente !== "todos" && request.client_id !== filtroCliente) return false;
    if (filtroPrioridade !== "todas" && grupoDaPrioridade(request.priority) !== filtroPrioridade) return false;
    if (termo) {
      const alvo = `${request.title || ""} ${request.description || ""} ${nomeDoCliente(request.client_id)}`.toLowerCase();
      if (alvo.indexOf(termo) < 0) return false;
    }
    return true;
  });
  const filteredRequests = recorte.filter(
    (request: any) => filter === "all" || request.status === filter,
  );
  const contagemStatus = (valor: string) => (valor === "all" ? recorte.length : recorte.filter((r: any) => r.status === valor).length);
  const emAberto = todos.filter((r: any) => r.status !== "completed").length;
  const clientesComPedido = useMemo(() => {
    const ids: string[] = [];
    (requests || []).forEach((r: any) => {
      if (r.client_id && ids.indexOf(r.client_id) < 0) ids.push(r.client_id);
    });
    return ids
      .map((id) => ({ id, nome: nomeDoCliente(id) || "Cliente" }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requests, clients]);
  const filtrosAtivos = filtroCliente !== "todos" || filtroPrioridade !== "todas" || !!termo;

  // O pedido aberto volta ao reabrir a tela (no computador, onde ele fica ao
  // lado da lista; no celular a janela não abre sozinha).
  useEffect(() => {
    if (!largo || selected || !abertoId || !requests) return;
    const achado = (requests || []).find((r: any) => r.id === abertoId);
    if (achado) setSelected(achado);
  }, [largo, selected, abertoId, requests]);

  const abrirPedido = (request: any) => {
    setSelected(request);
    setAbertoId(request.id);
  };
  const fecharPedido = () => {
    setSelected(null);
    setAbertoId("");
  };

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

  const statusDe = (valor: string) =>
    statusOptions.find((option) => option.value === valor) || statusOptions[0];

  /** O detalhe do pedido: o mesmo conteúdo ao lado da lista ou na janela do celular. */
  const detalhe = selected ? (
    <div className="space-y-4">
      <div>
        <p className={texto.rotulo}>Título</p>
        <p className={juntar(texto.corpo, "mt-1 [overflow-wrap:anywhere]")}>{selected.title}</p>
      </div>
      <div>
        <p className={texto.rotulo}>Descrição</p>
        <p className={juntar(texto.corpo, "mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]")}>{selected.description}</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="min-w-0">
          <p className={texto.rotulo}>Cliente</p>
          <p className={juntar(texto.corpo, "mt-1 truncate")}>
            {getClient(selected.client_id)?.company_name ||
              getClient(selected.client_id)?.full_name ||
              "-"}
          </p>
        </div>
        <div className="min-w-0">
          <p className={texto.rotulo}>Projeto</p>
          <p className={juntar(texto.corpo, "mt-1 truncate")}>
            {getProject(selected.project_id)?.name || "Sem projeto"}
          </p>
        </div>
      </div>
      <div>
        <p className={juntar(texto.rotulo, "mb-2")}>Status</p>
        <SeletorCompacto
          rotulo="Status do pedido"
          valor={selected.status}
          onEscolher={(valor) => void handleStatusChange(valor)}
          modo="segmentado"
          listaQuandoNaoCabe
          opcoes={statusOptions.map((status) => ({
            valor: status.value,
            rotulo: status.label,
            desativada:
              saving ||
              checkingClientPermission ||
              checkingLinkedTask ||
              linkedTaskReadFailed ||
              !canMutateSelected,
          }))}
        />
        {roleCanMutate &&
        !checkingClientPermission &&
        !canMutateSelected ? (
          <p className="mt-2 text-[12px] text-warning">
            Este pedido pertence a um cliente fora da sua gestão.
          </p>
        ) : null}
        {linkedRequestTask ? (
          <p className="mt-2 text-[12px] text-primary">
            Status sincronizado pelo Kanban da tarefa vinculada.
          </p>
        ) : null}
        {linkedTaskReadFailed ? (
          <p className="mt-2 text-[12px] text-destructive">
            Não foi possível confirmar o vínculo com o Kanban. Atualize a tela antes de alterar o status.
          </p>
        ) : null}
      </div>
    </div>
  ) : null;

  /** As ações do pedido: um primário, o resto secundário. */
  const acoesDoPedido: ReactNode =
    selected && selected.status !== "completed" && canMutateSelected ? (
      <div className="flex min-w-0 flex-wrap items-center justify-end border-t border-border px-4 py-3 sm:px-5">
        {selectedClientProjects.length === 0 ? (
          <p className="mr-auto min-w-0 flex-1 py-1 pr-2 text-[12px] text-warning">
            Cadastre um projeto ativo para este cliente.
          </p>
        ) : null}
        <div className="-m-1 flex flex-wrap items-center justify-end [&>*]:m-1">
          <button
            type="button"
            onClick={() => handleStatusChange("completed")}
            disabled={
              saving ||
              checkingLinkedTask ||
              linkedTaskReadFailed
            }
            className={juntar(botao.secundario, "text-success")}
          >
            Marcar como concluído
          </button>
          <button
            type="button"
            onClick={openTaskForm}
            disabled={saving || selectedClientProjects.length === 0}
            className={botao.primario}
          >
            <ListTodo className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Transformar em tarefa
          </button>
        </div>
      </div>
    ) : null;

  const lista = isLoading ? (
    <div className="p-3">
      <Carregando linhas={5} rotulo="Carregando pedidos" />
    </div>
  ) : isError && todos.length === 0 ? (
    <div className="p-3">
      <EstadoDeErro
        titulo="Não foi possível carregar os pedidos."
        acao={<button type="button" className={botao.secundario} onClick={() => refetch()}>Tentar de novo</button>}
      />
    </div>
  ) : todos.length === 0 ? (
    <EstadoVazio icone={<Inbox className="h-5 w-5" />} titulo="Nenhum pedido recebido." descricao="Quando um cliente pedir algo pelo portal, aparece aqui." />
  ) : filteredRequests.length === 0 ? (
    <div className="p-3">
      <EstadoVazio
        compacto
        titulo="Nenhum pedido neste filtro."
        acao={
          <button
            type="button"
            className={botao.discreto}
            onClick={() => {
              setFilter("all");
              setFiltroCliente("todos");
              setFiltroPrioridade("todas");
              setBusca("");
            }}
          >
            Limpar filtros
          </button>
        }
      />
    </div>
  ) : (
    <RegiaoRolavel modo="lg" rotulo="Pedidos" sobre="cartao" memoria="pedidos:lista">
      <ul className="divide-y divide-border" aria-label="Pedidos dos clientes">
        {filteredRequests.map((request: any) => {
          const client = getClient(request.client_id);
          const project = getProject(request.project_id);
          const status = statusDe(request.status);
          const priority =
            priorityBadge[request.priority] || priorityBadge.normal;
          const aberto = selected?.id === request.id;
          return (
            <li key={request.id} className="min-w-0">
              <button
                type="button"
                onClick={() => abrirPedido(request)}
                aria-current={aberto ? "true" : undefined}
                className={juntar(
                  "flex w-full min-w-0 items-start px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5",
                  aberto && "bg-muted/70",
                )}
              >
                <span className="mr-3 min-w-0 flex-1">
                  <span className="block text-[14px] font-medium leading-5 text-foreground [overflow-wrap:anywhere]">
                    {request.title}
                  </span>
                  {request.description && (
                    <span className={juntar(texto.corpo, "mt-0.5 block truncate text-muted-foreground")}>
                      {request.description}
                    </span>
                  )}
                  <span className={juntar(texto.auxiliar, "mt-1 block truncate")}>
                    {client?.company_name || client?.full_name || "-"}
                    <span className="mx-1.5" aria-hidden="true">·</span>
                    {project?.name || "Sem projeto"}
                    <span className="mx-1.5" aria-hidden="true">·</span>
                    <span className="tabular-nums">{formatDate(request.created_at)}</span>
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end [&>*+*]:mt-1 sm:flex-row sm:items-center sm:[&>*+*]:ml-1.5 sm:[&>*+*]:mt-0">
                  <span className={juntar(etiqueta, priority.cls)}>{priority.label}</span>
                  <span className={juntar(etiqueta, status.cls)}>{status.label}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </RegiaoRolavel>
  );

  return (
    <div className="min-w-0">
      {/* Sistema de design (docs/design/SISTEMA.md): no computador a tela tem a
          altura da janela, a lista e o detalhe rolam cada um por conta própria.
          No celular a página rola normal e o detalhe abre numa janela. */}
      <AreaDeTrabalho principalRolavel={false}>
        <CabecalhoDePagina
          titulo="Pedidos"
          className="shrink-0"
          descricao={
            !roleCanMutate
              ? "Modo leitura. Admin ou manager gerencia os pedidos."
              : todos.length
                ? `${emAberto} em aberto de ${todos.length}`
                : undefined
          }
          ajuda="Pedidos que os clientes fazem pelo portal. Abra um pedido para mudar o status ou transformar em tarefa no Kanban. Pedido que já virou tarefa muda de status pelo Kanban."
        />

        {todos.length > 0 && (
          <div className="mt-4 shrink-0">
            <div className="-m-1 flex min-w-0 flex-wrap items-center [&>*]:m-1">
              <SeletorCompacto
                rotulo="Status"
                valor={filter}
                onEscolher={setFilter}
                modo="segmentado"
          listaQuandoNaoCabe
                opcoes={filters.map((item) => ({ valor: item.value, rotulo: item.label, contador: contagemStatus(item.value) }))}
              />
              <SeletorCompacto
                rotulo="Cliente"
                icone={<Building2 className="h-3.5 w-3.5" />}
                valor={filtroCliente}
                onEscolher={setFiltroCliente}
                modo="lista"
                opcoes={[{ valor: "todos", rotulo: "Todos os clientes" }].concat(
                  clientesComPedido.map((c) => ({ valor: c.id, rotulo: c.nome })),
                )}
              />
              <SeletorCompacto
                rotulo="Prioridade"
                icone={<Flag className="h-3.5 w-3.5" />}
                valor={filtroPrioridade}
                onEscolher={setFiltroPrioridade}
                modo="lista"
                opcoes={[
                  { valor: "todas", rotulo: "Toda prioridade" },
                  { valor: "urgent", rotulo: "Urgente" },
                  { valor: "high", rotulo: "Alta" },
                  { valor: "normal", rotulo: "Normal" },
                  { valor: "low", rotulo: "Baixa" },
                ]}
              />
              <label className="relative block w-full min-w-0 sm:w-56">
                <span className="sr-only">Buscar pedido</span>
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input
                  value={busca}
                  onChange={(event) => setBusca(event.target.value)}
                  placeholder="Buscar pedido ou cliente"
                  className={juntar(campo, "pl-8")}
                />
              </label>
              {filtrosAtivos && (
                <button
                  type="button"
                  className={botao.discreto}
                  onClick={() => {
                    setFiltroCliente("todos");
                    setFiltroPrioridade("todas");
                    setBusca("");
                  }}
                >
                  Limpar
                </button>
              )}
            </div>
          </div>
        )}

        <div className="mt-4 min-w-0 lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:gap-5 desk:grid-cols-[minmax(0,1fr)_minmax(0,480px)]">
          <section className={juntar(superficie.painel, "flex min-w-0 flex-col overflow-hidden lg:min-h-0")} aria-label="Lista de pedidos">
            {lista}
          </section>

          {largo && (
            <section className={juntar(superficie.painel, "flex min-w-0 flex-col overflow-hidden lg:min-h-0")} aria-label="Detalhes do pedido">
              {selected ? (
                <>
                  <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3 sm:px-5">
                    <h2 className={juntar(texto.tituloSecao, "min-w-0 truncate")}>Detalhes do pedido</h2>
                    <span className="ml-3 flex shrink-0 items-center">
                      <span className={juntar(etiqueta, "mr-1", statusDe(selected.status).cls)}>{statusDe(selected.status).label}</span>
                      <button type="button" onClick={fecharPedido} aria-label="Fechar detalhes do pedido" className={botao.icone}>
                        <X className="h-4 w-4" />
                      </button>
                    </span>
                  </div>
                  <RegiaoRolavel modo="lg" rotulo="Detalhes do pedido" sobre="cartao" memoria={`pedidos:detalhe:${selected.id}`}>
                    <div className="px-4 py-4 sm:px-5">{detalhe}</div>
                  </RegiaoRolavel>
                  <div className="shrink-0">{acoesDoPedido}</div>
                </>
              ) : (
                <EstadoVazio icone={<Inbox className="h-5 w-5" />} titulo="Escolha um pedido" descricao="O detalhe aparece aqui." />
              )}
            </section>
          )}
        </div>
      </AreaDeTrabalho>

      {/* Janela do celular e tablet (sistema: nasce no body, por cima da barra de baixo). */}
      <JanelaDoCelular aberta={!!selected && !largo} titulo="Detalhes do pedido" onFechar={fecharPedido} rotuloDoFundo="Fechar detalhes do pedido" rodape={acoesDoPedido} larga>
        {detalhe}
      </JanelaDoCelular>

      <Dialog
        open={taskFormOpen && !!selected}
        onOpenChange={(open) => {
          if (!saving) setTaskFormOpen(open);
        }}
      >
        <DialogContent className="w-[calc(100%-2rem)] max-w-[520px] gap-0 overflow-hidden border-border bg-card p-0">
          {selected ? (
            <>
              <DialogHeader className="border-b border-border px-5 py-4 pr-12">
                <DialogTitle className={texto.tituloSecao}>
                  Transformar pedido em tarefa
                </DialogTitle>
                <DialogDescription className={juntar(texto.auxiliar, "line-clamp-1")}>
                  {selected.title}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 px-5 py-4">
                <CampoDeFormulario rotulo="Projeto do cliente" obrigatorio>
                  <select
                    id="request-task-project"
                    value={taskProjectId}
                    onChange={(event) => setTaskProjectId(event.target.value)}
                    className={campo}
                  >
                    <option value="">Selecionar projeto...</option>
                    {selectedClientProjects.map((project: any) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </CampoDeFormulario>

                <CampoDeFormulario
                  rotulo="Responsável autorizado"
                  ajuda="A lista inclui admins e membros já vinculados a este cliente."
                  erro={eligibleAssigneesError ? (
                    <button
                      type="button"
                      onClick={() => void refetchEligibleAssignees()}
                      className="text-destructive underline underline-offset-2"
                    >
                      Não foi possível carregar. Tentar novamente.
                    </button>
                  ) : undefined}
                >
                  <select
                    id="request-task-assignee"
                    value={taskAssigneeId}
                    onChange={(event) => setTaskAssigneeId(event.target.value)}
                    disabled={
                      loadingEligibleAssignees || !!eligibleAssigneesError
                    }
                    className={campo}
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
                </CampoDeFormulario>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <CampoDeFormulario rotulo="Prioridade">
                    <select
                      id="request-task-priority"
                      value={taskPriority}
                      onChange={(event) =>
                        setTaskPriority(
                          event.target.value as RequestTaskPriority,
                        )
                      }
                      className={campo}
                    >
                      {taskPriorityOptions.map((priority) => (
                        <option key={priority.value} value={priority.value}>
                          {priority.label}
                        </option>
                      ))}
                    </select>
                  </CampoDeFormulario>
                  <CampoDeFormulario rotulo="Prazo">
                    <input
                      id="request-task-due-date"
                      type="date"
                      value={taskDueDate}
                      onChange={(event) => setTaskDueDate(event.target.value)}
                      className={campo}
                    />
                  </CampoDeFormulario>
                </div>
              </div>

              <DialogFooter className="border-t border-border px-5 py-3">
                <button
                  type="button"
                  onClick={() => setTaskFormOpen(false)}
                  disabled={saving}
                  className={botao.secundario}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleCreateTask}
                  disabled={saving || !taskProjectId}
                  className={botao.primario}
                >
                  {saving ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
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
