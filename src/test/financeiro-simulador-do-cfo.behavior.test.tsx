import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { retratoDoCFO, avaliarGasto, type DadosDoCFO } from "../../supabase/functions/agente-cfo/modulos/cfo-calculos";
import { valorDigitadoEmReais } from "@/lib/financeiro/valorDigitado";

/**
 * Financeiro › CFO, "Posso gastar? (R$)": o campo tirava todos os pontos antes de trocar a vírgula, então
 * "1500.50" (ponto decimal, como o teclado do celular e o colar de planilha entregam) virava 150050 e o CFO
 * respondia sobre um gasto cem vezes maior. "1.500" (o placeholder, milhar) continua valendo 1500.
 */

const estado = vi.hoisted(() => ({ dados: null as unknown }));

vi.mock("sonner", () => ({ toast: { warning: vi.fn(), error: vi.fn(), info: vi.fn(), success: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "dono" }, profile: { role: "admin" }, loading: false }) }));
vi.mock("@/components/mesa/MesaContexto", () => ({ useCatalogo: () => ({ data: [], isLoading: false }) }));
vi.mock("@/components/cfo/ConversaDoCFO", () => ({ default: () => null }));
vi.mock("recharts", () => {
  const Nada = () => null;
  return { ResponsiveContainer: ({ children }: { children?: unknown }) => children ?? null, ComposedChart: Nada, Bar: Nada, Line: Nada, XAxis: Nada, YAxis: Nada, CartesianGrid: Nada, Tooltip: Nada, Legend: Nada };
});
vi.mock("@/lib/cfo/dadosDoCFO", async (orig) => {
  const real = await orig<typeof import("@/lib/cfo/dadosDoCFO")>();
  return { ...real, useDadosDoCFO: () => ({ data: estado.dados, isLoading: false, isError: false, error: null, refetch: vi.fn() }) };
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

beforeEach(() => {
  estado.dados = dados();
});
afterEach(cleanup);

async function simular(digitado: string) {
  const { default: AreaDoCFO } = await import("@/components/cfo/AreaDoCFO");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter><AreaDoCFO /></MemoryRouter></QueryClientProvider>);
  const campo = document.querySelector("[data-simulador-do-cfo]") as HTMLInputElement;
  fireEvent.change(campo, { target: { value: digitado } });
  return document.querySelector("[data-resposta-do-simulador]");
}

describe("CFO: simulador do limite lê o valor digitado", () => {
  it("\"1500.50\" é mil e quinhentos, não cento e cinquenta mil", async () => {
    // Caixa folgado: R$ 1.500,50 cabe no limite; R$ 150.050 não.
    const folgado = { ...dados(), config: { ...dados().config, saldoInicial: 50000 } };
    estado.dados = folgado;
    const r = retratoDoCFO(folgado, { meses: 12 });
    const certo = avaliarGasto(r, { valor: 1500.5, recorrente: false });
    const errado = avaliarGasto(r, { valor: 150050, recorrente: false });
    // Os dois valores dão respostas diferentes com estes dados (senão o teste não provaria nada).
    expect(certo.nivel).not.toBe(errado.nivel);
    const resposta = await simular("1500.50");
    expect(resposta?.getAttribute("data-resposta-do-simulador")).toBe(certo.nivel);
    expect(resposta?.textContent).toContain(certo.motivo);
  });
});

describe("valorDigitadoEmReais", () => {
  it("ponto decimal sem vírgula", () => {
    expect(valorDigitadoEmReais("1500.50")).toBe(1500.5);
    expect(valorDigitadoEmReais("1.5")).toBe(1.5);
    expect(valorDigitadoEmReais("100.50")).toBe(100.5);
  });
  it("ponto de milhar sem vírgula (o placeholder \"1.500\")", () => {
    expect(valorDigitadoEmReais("1.500")).toBe(1500);
    expect(valorDigitadoEmReais("12.345.678")).toBe(12345678);
  });
  it("com vírgula, ela é o decimal e os pontos são milhar", () => {
    expect(valorDigitadoEmReais("1.500,50")).toBe(1500.5);
    expect(valorDigitadoEmReais("1500,5")).toBe(1500.5);
  });
  it("vazio ou inválido é null", () => {
    expect(valorDigitadoEmReais("")).toBeNull();
    expect(valorDigitadoEmReais("   ")).toBeNull();
    expect(valorDigitadoEmReais("abc")).toBeNull();
  });
});
