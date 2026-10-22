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
vi.mock("@/components/mesa/HypesDaSemana", () => ({
  default: (p: { onJuntando?: (ativo: boolean) => void }) =>
    h("div", null, h("p", null, "hypes"), h("button", { type: "button", onClick: () => p.onJuntando && p.onJuntando(true) }, "marcar para juntar"), h("button", { type: "button", onClick: () => p.onJuntando && p.onJuntando(false) }, "desmarcar")),
}));
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
  return render(h(MemoryRouter, { initialEntries: [rota] }, h(QueryClientProvider, { client: qc }, h(MesaProvider, { valor: valorDaMesa(), children: h(AbaMes, {}) }))));
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

describe("botão do agente e a barra de juntar (21/10)", () => {
  it("com itens juntados no Hype e Trending, o botão vai para o canto no computador e volta ao centro depois", () => {
    montar();
    const caixa = () => screen.getByRole("button", { name: "Abrir o Agente do mês" }).parentElement as HTMLElement;
    expect(caixa().className).not.toContain("md:justify-end");
    fireEvent.click(screen.getByRole("button", { name: "marcar para juntar" }));
    expect(caixa().className).toContain("md:justify-end");
    expect(caixa().hasAttribute("data-agente-no-canto")).toBe(true);
    // No celular continua no centro (a barra flutua acima dele).
    expect(caixa().className).toContain("justify-center");
    fireEvent.click(screen.getByRole("button", { name: "desmarcar" }));
    expect(caixa().className).not.toContain("md:justify-end");
  });
});

describe("Mês fácil de reconhecer (21/10)", () => {
  it("topo com o mês e o resumo, as ações do mês no topo e as áreas na ordem Calendário → Radar → Propostas e agente", async () => {
    montar();
    const topo = document.querySelector("[data-topo-do-mes]") as HTMLElement;
    expect(topo.querySelector("[data-mes-do-topo]")!.textContent).toBe("Outubro de 2026");
    expect(topo.querySelector("[data-resumo-do-mes]")!.textContent).toContain("no radar");
    expect(within(topo).getByRole("button", { name: "Criar conteúdos" })).toBeTruthy();
    expect(within(topo).getByRole("button", { name: "Novo calendário" })).toBeTruthy();
    // Uma vez só (o plano não repete as ações).
    expect(screen.getAllByRole("button", { name: "Criar conteúdos" })).toHaveLength(1);
    const ordem = (no: Node) => document.body.textContent!.indexOf(no.textContent!);
    const agenda = screen.getByText("agenda do mês");
    const radar = screen.getByText("hypes");
    const propostas = screen.getByRole("heading", { name: "Propostas e agente" });
    expect(topo.compareDocumentPosition(agenda) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(agenda.compareDocumentPosition(radar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(radar.compareDocumentPosition(propostas) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(ordem(propostas)).toBeGreaterThan(0);
  });
});
