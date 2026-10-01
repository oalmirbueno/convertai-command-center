import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { retratoDoCFO, avaliarGasto, type DadosDoCFO } from "../../supabase/functions/agente-cfo/modulos/cfo-calculos";

/**
 * Frente CFO (30/09): as telas do CFO. A trava (janela no centro com o
 * "entendi"), o campo Financeiro › CFO e a conversa com o cartão travado.
 */

const estado = vi.hoisted(() => ({
  avaliar: vi.fn(),
  registrar: vi.fn(),
  perguntar: vi.fn(),
  conversa: vi.fn(),
  chamar: vi.fn(),
  dados: null as unknown,
  toast: { warning: vi.fn(), error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: estado.toast }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "dono" }, profile: { role: "admin" }, loading: false }) }));
vi.mock("@/components/mesa/MesaContexto", () => ({ useCatalogo: () => ({ data: [], isLoading: false }) }));
vi.mock("recharts", () => {
  const Nada = () => null;
  return { ResponsiveContainer: ({ children }: { children?: unknown }) => children ?? null, ComposedChart: Nada, Bar: Nada, Line: Nada, XAxis: Nada, YAxis: Nada, CartesianGrid: Nada, Tooltip: Nada, Legend: Nada };
});
vi.mock("@/lib/cfo/dadosDoCFO", async (orig) => {
  const real = await orig<typeof import("@/lib/cfo/dadosDoCFO")>();
  return {
    ...real,
    avaliarGastoAgora: estado.avaliar,
    registrarTrava: estado.registrar,
    perguntarAoCfo: estado.perguntar,
    conversaDoCfo: estado.conversa,
    useDadosDoCFO: () => ({ data: estado.dados, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  };
});

function dados(): DadosDoCFO {
  return {
    hoje: "2026-09-15",
    cobrancas: [{ id: "b1", client_id: "c1", type: "renewal", amount: 800, paid_amount: null, status: "pending", due_date: "2026-09-01", paid_date: null }],
    parcelas: [],
    despesas: [
      { id: "d1", description: "Chat GPT pro", category: "infraestrutura", amount: 1000, status: "pending", due_date: "2026-09-28", paid_date: null, recurrence: "monthly" },
      { id: "d2", description: "Pró-labore", category: "salarios", amount: 1500, status: "pending", due_date: "2026-09-30", paid_date: null, recurrence: "monthly" },
    ],
    clientes: [{ id: "c1", nome: "Alfa", plan_name: "Pro", plan_value: 800, plan_status: "active", client_type: "recurring", interno: false }],
    config: { saldoInicial: 1500, metaMensal: 3000, proLaboreAtual: 1500, proLaboreAlvo: null, reservaAlvo: null },
    caixinhas: { tax: 0, clients: 0, safety: 0 },
  };
}

function comConsulta(no: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{no}</MemoryRouter></QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  estado.dados = dados();
  estado.registrar.mockResolvedValue(null);
  estado.conversa.mockResolvedValue([]);
});
afterEach(cleanup);

describe("CFO: a trava nas despesas", () => {
  async function montar() {
    const { useTravaDeGasto } = await import("@/components/cfo/TravaDeGasto");
    const resultado: { valor: boolean | null } = { valor: null };
    function Tela() {
      const { pedirLiberacao, janela } = useTravaDeGasto("caixa");
      const [, setX] = useState(0);
      return (
        <div>
          {janela}
          <button type="button" onClick={async () => { resultado.valor = await pedirLiberacao({ valor: 900, descricao: "Curso" }); setX((x) => x + 1); }}>lançar</button>
        </div>
      );
    }
    render(comConsulta(<Tela />));
    return resultado;
  }

  it("acima do limite: janela no centro, Lançar só depois do entendi, decisão registrada", async () => {
    const r = retratoDoCFO(dados());
    estado.avaliar.mockResolvedValue({ avaliacao: avaliarGasto(r, { valor: 900 }), retrato: r });
    const resultado = await montar();
    fireEvent.click(screen.getByRole("button", { name: "lançar" }));
    const lancar = await screen.findByRole("button", { name: "Lançar mesmo assim" });
    expect(screen.getByText("Este gasto passa do limite")).toBeInTheDocument();
    expect(lancar).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(lancar).not.toBeDisabled();
    await act(async () => { fireEvent.click(lancar); });
    await waitFor(() => expect(resultado.valor).toBe(true));
    expect(estado.registrar).toHaveBeenCalledWith(expect.objectContaining({ decisao: "lancou", origem: "caixa" }));
  });

  it("Não lançar devolve false e registra a desistência", async () => {
    const r = retratoDoCFO(dados());
    estado.avaliar.mockResolvedValue({ avaliacao: avaliarGasto(r, { valor: 900 }), retrato: r });
    const resultado = await montar();
    fireEvent.click(screen.getByRole("button", { name: "lançar" }));
    const naoLancar = await screen.findByRole("button", { name: "Não lançar" });
    await act(async () => { fireEvent.click(naoLancar); });
    await waitFor(() => expect(resultado.valor).toBe(false));
    expect(estado.registrar).toHaveBeenCalledWith(expect.objectContaining({ decisao: "desistiu" }));
  });

  it("cabe no limite: lança sem janela; conferência que falha não impede (avisa)", async () => {
    const folgado = { ...dados(), config: { ...dados().config, saldoInicial: 50000 } };
    const r = retratoDoCFO(folgado);
    estado.avaliar.mockResolvedValueOnce({ avaliacao: avaliarGasto(r, { valor: 10 }), retrato: r });
    const resultado = await montar();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "lançar" })); });
    await waitFor(() => expect(resultado.valor).toBe(true));
    expect(screen.queryByRole("button", { name: "Lançar mesmo assim" })).toBeNull();
    estado.avaliar.mockRejectedValueOnce(new Error("rede"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "lançar" })); });
    await waitFor(() => expect(estado.toast.warning).toHaveBeenCalled());
  });
});

describe("CFO: Financeiro › CFO", () => {
  it("mostra saúde, limite com o simulador, erros, projeção, cortes e plano", async () => {
    vi.doMock("@/components/cfo/ConversaDoCFO", () => ({ default: () => <div data-conversa-falsa="" /> }));
    const { default: AreaDoCFO } = await import("@/components/cfo/AreaDoCFO");
    render(comConsulta(<AreaDoCFO />));
    expect(screen.getByText("Onde você está errando")).toBeInTheDocument();
    expect(screen.getByText("Projeção")).toBeInTheDocument();
    expect(screen.getByText("Onde cortar")).toBeInTheDocument();
    expect(screen.getByText("Plano de crescimento")).toBeInTheDocument();
    const campo = document.querySelector("[data-simulador-do-cfo]") as HTMLInputElement;
    fireEvent.change(campo, { target: { value: "1.500" } });
    expect(document.querySelector('[data-resposta-do-simulador="bloqueado"]')).not.toBeNull();
    expect(document.querySelector("[data-tabela-da-projecao] tbody")!.children.length).toBe(6);
    vi.doUnmock("@/components/cfo/ConversaDoCFO");
  });
});

describe("CFO: a conversa", () => {
  it("pergunta, mostra a resposta e o cartão travado pede o entendi; erro devolve o texto ao campo", async () => {
    const r = retratoDoCFO(dados());
    const { propostaDaIntencao } = await import("../../supabase/functions/agente-cfo/modulos/cfo-acoes");
    const { acao } = propostaDaIntencao(r, "posso_gastar", { valor: 900, recorrente: false, descricao: "Curso", metaAnterior: null });
    estado.perguntar.mockResolvedValueOnce({ resposta: "Não. O limite de outubro está zerado.", resposta_do_motor: "", intencao: "posso_gastar", avaliacao: null, anexo: acao, mensagem_id: "11111111-1111-4111-8111-111111111111", modelo_id: null, custo_usd: 0, aviso: null });
    const { default: ConversaDoCFO } = await import("@/components/cfo/ConversaDoCFO");
    render(comConsulta(<ConversaDoCFO />));
    const campo = screen.getByLabelText("Pergunta para o CFO");
    fireEvent.change(campo, { target: { value: "posso gastar 900 num curso?" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enviar ao CFO" })); });
    expect(await screen.findByText("Não. O limite de outubro está zerado.")).toBeInTheDocument();
    const lancar = await screen.findByRole("button", { name: "Lançar mesmo assim" });
    expect(lancar).toBeDisabled();
    fireEvent.click(document.querySelector("[data-entendi-do-cfo]") as HTMLInputElement);
    expect(lancar).not.toBeDisabled();

    estado.perguntar.mockRejectedValueOnce(new Error("fora do ar"));
    fireEvent.change(campo, { target: { value: "projeção" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enviar ao CFO" })); });
    await waitFor(() => expect((campo as HTMLTextAreaElement).value).toBe("projeção"));
    expect(estado.toast.error).toHaveBeenCalled();
  });
});
