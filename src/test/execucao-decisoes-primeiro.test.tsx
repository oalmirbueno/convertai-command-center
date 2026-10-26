import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminExecucao from "@/pages/AdminExecucao";

/**
 * 26/10/2026 (dono: "muita coisa para decidir, acaba confundindo; mais enxuto,
 * mais direto; eu vendo realmente funcionando de lado"): a Execução abre no que
 * espera você (uma mesa, um cartão por vez, agrupado por cliente), o ruído
 * (áreas, incidentes) começa recolhido e a lateral mostra a última ação real
 * de cada agente, com prova.
 */

const state = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "admin" }, profile: { role: "admin", full_name: "Almir" } }) }));
vi.mock("@/hooks/useSupabaseData", () => ({ useProjects: () => ({ data: [] }), useTeamMembers: () => ({ data: [] }), useClients: () => ({ data: [] }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: state.from, rpc: state.rpc } }));
const cliente = (nome: string) => ({ name: "Projeto", client: { company_name: nome } });
vi.mock("@tanstack/react-query", async (original) => ({
  ...await original<typeof import("@tanstack/react-query")>(),
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    const rows: Record<string, unknown> = {
      "flag-operators-layer": "on",
      "operadores-internos": [
        { id: "op1", slug: "trafego", display_name: "Gestor de Tráfego", role: "Tráfego", status: "active", area: "Paperclip" },
        { id: "op2", slug: "conteudo", display_name: "Estrategista de Conteúdo", role: "Conteúdo", status: "active", area: "Paperclip" },
      ],
      "operador-vinculos": [
        { id: "l-rev", operator_id: "op2", kanban_task_id: "t-rev", status: "review", updated_at: "2026-10-26T12:00:00Z", last_action: "Carrossel pronto", last_evidence: "https://exemplo.com/carrossel.png", approval_required: false },
        { id: "l-esp", operator_id: "op1", kanban_task_id: "t-esp", status: "awaiting_input", updated_at: "2026-10-26T11:00:00Z", last_action: "Preciso do acesso", approval_required: false },
        { id: "l-and", operator_id: "op1", kanban_task_id: "t-and", status: "in_progress", updated_at: "2026-10-26T10:00:00Z", last_action: "Subindo campanha", approval_required: false },
      ],
      "operador-runs": [{ id: "r1", operator_id: "op1", status: "failed", started_at: "2026-10-26T09:00:00Z", error: "timeout", attempt: 1, run_key: "k", detail: {} }],
      "operador-tarefas": new Map<string, unknown>([
        ["t-rev", { id: "t-rev", title: "ACE-401 | Carrossel de novembro", status: "review", deleted_at: null, delivery_type: "content", project: cliente("Stop") }],
        ["t-esp", { id: "t-esp", title: "ACE-275 | Meta: arquivar anúncio com erro", status: "doing", deleted_at: null, delivery_type: "traffic", project: cliente("Casa dos Assados") }],
        ["t-and", { id: "t-and", title: "Campanha de Black Friday", status: "doing", deleted_at: null, project: cliente("Casa dos Assados") }],
      ]),
      "operador-humanos": new Map(),
      "operador-tarefas-disponiveis": [],
      "execucao-pedidos": [],
    };
    return { data: rows[queryKey[0]] ?? [], isSuccess: true, isLoading: false, dataUpdatedAt: 1, error: null };
  },
}));

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); Element.prototype.scrollIntoView = vi.fn(); });
const montar = () => render(<MemoryRouter><QueryClientProvider client={new QueryClient()}><AdminExecucao /></QueryClientProvider></MemoryRouter>);

describe("Execução: decisões primeiro, ruído recolhido", () => {
  it("abre em 'Tudo que espera você', numa mesa só, agrupada por cliente", () => {
    montar();
    const mesa = screen.getByRole("region", { name: "Tarefas esperando você" });
    // Um cartão por vez: o primeiro é o do cliente que vem primeiro (Casa dos Assados), sem o código ACE.
    const cartao = within(mesa).getByRole("article");
    expect(cartao.textContent).toContain("Casa dos Assados");
    expect(cartao.getAttribute("aria-label")).toMatch(/Tráfego · Arquivar anúncio com erro$/);
    expect(cartao.textContent).not.toContain("ACE-275");
    // O que só anda (em andamento) não entra na mesa de decisão.
    expect(mesa.textContent).not.toContain("Campanha de Black Friday");
  });

  it("a lateral mostra o que espera você, a linha de estado e a última ação real com prova", () => {
    montar();
    const atencao = screen.getByRole("group", { name: "O que pede a sua atenção" });
    expect(atencao.textContent).toContain("1 agente espera uma resposta sua");
    expect(atencao.textContent).toContain("1 entrega pronta para você revisar");
    // Andando e feito não são pedido: viram uma linha de estado.
    expect(atencao.textContent).not.toContain("em andamento agora");
    expect(document.querySelector("[data-estados-da-execucao]")!.textContent).toContain("1 andando");
    const real = document.querySelector("[data-funcionando-de-verdade]") as HTMLElement;
    const linha = real.querySelector('[data-acao-real="revisao"]')!;
    expect(linha.textContent).toContain("Estrategista de Conteúdo");
    expect(linha.textContent).toContain("Stop · Conteúdo · Carrossel de novembro");
    expect(real.textContent).toContain("Sem entrega com prova ainda: 1 agente");
  });

  it("áreas e incidentes começam recolhidos", () => {
    montar();
    const recolhidas = Array.from(document.querySelectorAll('section[data-recolhido="sim"]')).map((s) => s.querySelector("h2,h3")?.textContent || "");
    expect(recolhidas.some((t) => t.indexOf("Áreas") >= 0)).toBe(true);
    expect(recolhidas.some((t) => t.indexOf("incidente") >= 0)).toBe(true);
  });
});
