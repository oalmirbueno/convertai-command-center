import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminExecucao from "@/pages/AdminExecucao";

/**
 * E3 parte C: a Execução no sistema de design. As abas viraram Etapas e a
 * aba/visão ficam guardadas (useEstadoDaTela): sair e voltar mantém onde
 * estava. O padrão da primeira visita continua sendo o Escritório.
 */

const state = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "admin" }, profile: { role: "admin" } }) }));
vi.mock("@/hooks/useSupabaseData", () => ({ useProjects: () => ({ data: [] }), useTeamMembers: () => ({ data: [] }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: state.from, rpc: state.rpc } }));
vi.mock("@tanstack/react-query", async (original) => ({
  ...await original<typeof import("@tanstack/react-query")>(),
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    const rows: Record<string, unknown> = {
      "flag-operators-layer": "on",
      "operadores-internos": [{ id: "op", slug: "sintetico", display_name: "Operador sintético", role: "Operação", status: "active", area: "Operações" }],
      "operador-vinculos": [{ id: "link", operator_id: "op", kanban_task_id: "task", status: "in_progress", updated_at: "2026-09-14T12:00:00Z", last_action: "Trabalho de teste", approval_required: false }],
      "operador-runs": [],
      "operador-tarefas": new Map([["task", { id: "task", title: "Tarefa sintética", status: "doing", deleted_at: null }]]),
      "operador-humanos": new Map(),
      "operador-tarefas-disponiveis": [],
    };
    return { data: rows[queryKey[0]] ?? [], isSuccess: true, isLoading: false, dataUpdatedAt: 1, error: null, refetch: vi.fn() };
  },
}));

beforeEach(() => {
  window.localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

function montar() {
  return render(<MemoryRouter><QueryClientProvider client={new QueryClient()}><AdminExecucao /></QueryClientProvider></MemoryRouter>);
}
const abaAberta = () => document.querySelector('nav[aria-label="Abas da Execução"] [aria-current="page"]')?.getAttribute("data-etapa");

describe("Execução: abas no sistema de design", () => {
  it("abre no Escritório na primeira visita", () => {
    montar();
    expect(abaAberta()).toBe("pessoas");
    expect(screen.getByText(/Nada está parado esperando você/)).toBeInTheDocument();
  });

  it("a aba escolhida continua lá ao sair e voltar", () => {
    const primeira = montar();
    fireEvent.click(document.querySelector('[data-etapa="trabalho"]') as HTMLElement);
    expect(abaAberta()).toBe("trabalho");
    // O quadro abre com a coluna do vínculo em andamento.
    expect(screen.getByRole("region", { name: "Coluna Em andamento" })).toBeInTheDocument();
    primeira.unmount();

    montar();
    expect(abaAberta()).toBe("trabalho");
  });

  it("'O que foi feito' guardada não volta sozinha para o Escritório", () => {
    const primeira = montar();
    fireEvent.click(document.querySelector('[data-etapa="feito"]') as HTMLElement);
    expect(abaAberta()).toBe("feito");
    primeira.unmount();

    montar();
    expect(abaAberta()).toBe("feito");
  });
});
