import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminExecucao from "@/pages/AdminExecucao";

const state = vi.hoisted(() => ({ taskRead: true, taskStatus: "done", linkStatus: "awaiting_input", from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "admin" }, profile: { role: "admin" } }) }));
vi.mock("@/hooks/useSupabaseData", () => ({ useProjects: () => ({ data: [] }), useTeamMembers: () => ({ data: [] }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: state.from, rpc: state.rpc } }));
vi.mock("@tanstack/react-query", async (original) => ({
  ...await original<typeof import("@tanstack/react-query")>(),
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    const rows: Record<string, unknown> = {
      "flag-operators-layer": "on",
      "operadores-internos": [{ id: "op", slug: "synthetic", display_name: "Operador sintético", role: "Operação", status: "active", area: "Operações" }],
      "operador-vinculos": [{ id: "link", operator_id: "op", kanban_task_id: "task", status: state.linkStatus, updated_at: "2026-09-14T12:00:00Z", last_action: "Histórico de teste", approval_required: false }],
      "operador-runs": [],
      "operador-tarefas": new Map([["task", { id: "task", title: "Entrega sintética encerrada", status: state.taskStatus, deleted_at: null }]]),
      "operador-humanos": new Map(),
      "operador-tarefas-disponiveis": [],
    };
    return { data: rows[queryKey[0]] ?? [], isSuccess: queryKey[0] !== "operador-tarefas" || state.taskRead, isLoading: false, dataUpdatedAt: 1, error: null };
  },
}));

beforeEach(() => { vi.clearAllMocks(); state.taskRead = true; state.taskStatus = "done"; state.linkStatus = "awaiting_input"; Element.prototype.scrollIntoView = vi.fn(); });
function mount() { return render(<MemoryRouter><QueryClientProvider client={new QueryClient()}><AdminExecucao /></QueryClientProvider></MemoryRouter>); }

describe("Execução lê o estado concluído do Kanban sem reescrever o operador", () => {
  it("remove o vínculo da operação e permite consultar seu histórico", () => {
    mount();
    expect(screen.queryByRole("button", { name: /Entrega sintética encerrada/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Nada está parado esperando você/)).toBeInTheDocument();
    // 28/09 (padronização L2): "Mostrar encerrados" saiu da barra para o "..."
    // da BarraDeControles (no máximo duas linhas de controles; SISTEMA.md 4.2).
    // A função é a mesma; o teste abre o menu antes de escolher.
    fireEvent.keyDown(screen.getByRole("button", { name: "Mais ações" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: /Mostrar 1 vínculo encerrado/ }));
    expect(screen.getByRole("button", { name: /Entrega sintética encerrada/ })).toBeInTheDocument();
    expect(state.from).not.toHaveBeenCalled();
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("preserva um vínculo quando a tarefa continua ativa", () => {
    state.taskStatus = "review"; mount();
    expect(screen.getByRole("button", { name: /Entrega sintética encerrada/ })).toBeInTheDocument();
    // Sem vínculo encerrado e sem filtro ligado, o "..." nem aparece.
    expect(screen.queryByRole("button", { name: "Mais ações" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Mostrar 1 vínculo encerrado/ })).not.toBeInTheDocument();
  });
});
