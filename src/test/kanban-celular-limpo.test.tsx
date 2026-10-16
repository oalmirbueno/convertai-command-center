import { createElement as h } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 16/10/2026 (dono): "otimizar o mobile, cara de aplicativo, menos poluído".
 * No celular (useCelular) o Kanban mostra o cabeçalho numa linha só, as abas
 * das colunas grudadas no topo (44 px) e cartões enxutos: título, uma linha
 * de apoio e no máximo um selo. Nada some: filtros de cliente e projeto vão
 * para dentro do seletor "Filtros"; o menu do cartão continua.
 */

const TAREFAS = [
  {
    id: "t-1",
    title: "Gravar reel da vitrine",
    status: "backlog",
    task_order: 10,
    priority: "high",
    due_date: "2026-10-20",
    project_id: "p-1",
    project: { name: "Projeto Loja" },
    assigned_to: null,
    assignee: { full_name: "Ana Lima" },
    source: null,
    delivery_type: null,
    workstream: "general",
    milestone: { title: "Etapa de outubro" },
  },
  {
    id: "t-2",
    title: "Tarefa travada",
    status: "blocked",
    task_order: 20,
    priority: "medium",
    due_date: null,
    project_id: "p-1",
    project: { name: "Projeto Loja" },
    assigned_to: null,
    assignee: null,
    source: null,
    delivery_type: null,
    workstream: "general",
  },
];

vi.mock("@/hooks/useSupabaseData", () => ({
  useTasks: () => ({ data: TAREFAS, isLoading: false }),
  useTeamMembers: () => ({ data: [] }),
  useProjects: () => ({ data: [{ id: "p-1", name: "Projeto Loja", client_id: "c-1", client: { company_name: "Cliente" } }] }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin", full_name: "Admin" }, user: { id: "u-1" } }) }));
vi.mock("@/hooks/useCelular", () => ({ useCelular: () => true }));
vi.mock("@/components/admin/CreateTaskModal", () => ({ default: () => null }));
vi.mock("@/components/admin/TaskDetailDrawer", async () => {
  const { createElement } = await import("react");
  return { default: ({ task }: { task: { title: string } }) => createElement("div", { "data-testid": "detalhe-da-tarefa" }, task.title) };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => {
  const canal: any = { on: () => canal, subscribe: () => canal };
  const consulta: any = {};
  ["select", "eq", "in", "order", "update", "maybeSingle"].forEach((m) => (consulta[m] = () => consulta));
  consulta.then = (ok: any, erro: any) => Promise.resolve({ data: [], error: null }).then(ok, erro);
  return { supabase: { channel: () => canal, removeChannel: vi.fn(), from: () => consulta, auth: { getUser: () => Promise.resolve({ data: { user: null } }) } } };
});
vi.mock("@/lib/opsTaskSync", () => ({ notifyOpsTaskUpdated: vi.fn() }));

import Kanban from "@/pages/Kanban";

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

async function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const r = render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, { initialEntries: ["/kanban"] }, h(Kanban))));
  await act(async () => {
    await Promise.resolve();
  });
  return r;
}

describe("Kanban no celular: limpo e sem perder função", () => {
  it("abas das colunas grudadas no topo, com 44 px e soltáveis pelo dedo", async () => {
    const { container } = await montar();
    const nav = container.querySelector('nav[aria-label="Colunas do Kanban"]') as HTMLElement;
    expect(nav).toBeTruthy();
    expect(nav.parentElement!.className).toContain("sticky");
    expect(nav.className).toContain("[&_[data-etapa]]:h-11");
    expect(nav.querySelectorAll("[data-coluna-kanban]").length).toBe(4);
  });

  it("cabeçalho numa linha: sem contagem embaixo do título e cliente/projeto dentro de Filtros", async () => {
    const { container } = await montar();
    expect(container.textContent).not.toContain("2 tarefas");
    expect(container.querySelector('select[aria-label="Cliente"]')).toBeNull();
    expect(container.querySelector('select[aria-label="Projeto"]')).toBeNull();
    const filtros = container.querySelector('button[aria-label^="Mais filtros"]') as HTMLElement;
    expect(filtros).toBeTruthy();
    await act(async () => {
      fireEvent.click(filtros);
      await Promise.resolve();
    });
    expect(document.querySelector('select[aria-label="Cliente"]')).toBeTruthy();
    expect(document.querySelector('select[aria-label="Projeto"]')).toBeTruthy();
  });

  it("cartão enxuto: título, projeto · prazo, um selo só, menu continua; toque abre", async () => {
    const { container } = await montar();
    const cartao = container.querySelector('[data-cartao-da-tarefa="t-1"] > [role="button"]') as HTMLElement;
    expect(cartao.textContent).toContain("Gravar reel da vitrine");
    expect(cartao.textContent).toContain("Projeto Loja · ");
    // Etapa e responsável ficam no detalhe.
    expect(cartao.textContent).not.toContain("Etapa de outubro");
    expect(cartao.querySelector('[title="Ana Lima"]')).toBeNull();
    expect(cartao.querySelector('button[aria-label="Ações da tarefa Gravar reel da vitrine"]')).toBeTruthy();
    fireEvent.click(cartao);
    expect(document.querySelector('[data-testid="detalhe-da-tarefa"]')?.textContent).toBe("Gravar reel da vitrine");
  });
});
