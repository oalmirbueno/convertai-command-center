import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Aba Mês (pedido do dono em 24/09): "o agente do mês ali está escondido".
 * Agora ele é um botão flutuante no centro da base da tela que abre o agente
 * num pop-up grande e centralizado; no alto da aba, o plano combinado do mês
 * com os dois caminhos (planejar conversando ou criar conteúdos).
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  tabelas: {} as Record<string, unknown>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "gte", "lt", "lte", "gt", "overlaps", "contains", "order", "limit", "range", "update"]) b[m] = () => b;
    const primeiro = () => ({ data: Array.isArray(dados) ? (dados[0] === undefined ? null : dados[0]) : dados, error: null });
    b.maybeSingle = () => Promise.resolve(primeiro());
    b.single = () => Promise.resolve(primeiro());
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null, count: Array.isArray(dados) ? dados.length : 0 }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: vi.fn(),
      from: (tabela: string) => consulta(tabela),
      storage: { from: () => ({ upload: vi.fn(), createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://x.test/a.png" }, error: null }) }) },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
// O resto da aba tem testes próprios; aqui só a moldura do agente.
vi.mock("@/components/mesa/HypesDaSemana", () => ({ default: () => h("p", null, "hypes") }));
vi.mock("@/components/mesa/AgendaDoMes", () => ({ default: () => h("p", null, "agenda do mês") }));
vi.mock("@/components/mesa/PlanejamentoAutomatico", () => ({ default: () => h("p", null, "planejamento automático") }));

import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import AbaMes from "@/components/mesa/AbaMes";

const CLIENTE = "11111111-1111-1111-1111-111111111111";

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Cliente sintético",
  userId: "u-1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 50,
  catalogo: [],
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
});

function montar(rota = "/mesa?client=c&mes=2026-10-01") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(MemoryRouter, { initialEntries: [rota] }, h(QueryClientProvider, { client: qc }, h(MesaProvider, { valor: valorDaMesa() }, h(AbaMes, {})))));
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.tabelas = {};
  mock.invoke.mockResolvedValue({ data: {}, error: null });
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

describe("agente do mês em pop-up centralizado", () => {
  it("o botão flutuante fica no centro da base e abre o agente num pop-up", async () => {
    montar();
    const botao = screen.getByRole("button", { name: "Abrir o Agente do mês" });
    const faixa = botao.parentElement as HTMLElement;
    expect(faixa.className).toContain("fixed");
    expect(faixa.className).toContain("justify-center");
    expect(faixa.className).toContain("inset-x-0");
    fireEvent.click(botao);
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByRole("tab", { name: /Planejar o mês/ }).getAttribute("aria-selected")).toBe("true");
    expect(within(dialogo).getByLabelText("Pedido ao agente do mês")).toBeTruthy();
    // Com o pop-up aberto o botão flutuante sai da frente.
    expect(screen.queryByRole("button", { name: "Abrir o Agente do mês" })).toBeNull();
  });

  it("o plano do mês no alto: sem plano, convida a planejar; Criar conteúdos abre no modo certo", async () => {
    montar();
    expect(screen.getByText("Nada combinado para outubro de 2026 ainda")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Criar conteúdos/ }));
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByRole("tab", { name: /Criar conteúdos/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("com plano combinado, o texto aparece no alto e os próximos meses mostram quem já tem plano", async () => {
    mock.tabelas.agente_memoria = [
      { id: "m1", texto: "Plano do mês 2026-10: Outubro com foco em kits de presente e 3 posts por semana.", criado_em: "2026-09-24T12:00:00Z" },
      { id: "m2", texto: "Plano do mês 2026-11: Black Friday.", criado_em: "2026-09-24T12:00:00Z" },
    ];
    montar();
    await waitFor(() => expect(screen.getByText(/Outubro com foco em kits de presente/)).toBeTruthy());
    const novembro = screen.getByRole("button", { name: /novembro/ });
    expect(novembro.getAttribute("title")).toContain("Plano combinado");
    fireEvent.click(novembro);
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByRole("tab", { name: /Planejar o mês/ }).getAttribute("aria-selected")).toBe("true");
  });
});
