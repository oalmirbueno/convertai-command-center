import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fluxo de caixa: "Pagar" gravava o _pago_em com new Date().toISOString() (UTC). Às 23h30 de 01/11 em São
 * Paulo já é 02/11 em UTC, então o pagamento caía no dia (e, na virada do mês, no mês) seguinte. O mesmo
 * valia para o paid_date padrão ao salvar uma despesa como "Pago" sem data de pagamento.
 */

const estado = vi.hoisted(() => ({
  rpc: vi.fn(),
  updates: [] as unknown[],
  despesas: [] as Record<string, unknown>[],
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({ data: queryKey[0] === "expenses" ? estado.despesas : [], isLoading: false, error: null, refetch: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "admin" }, profile: { role: "admin" }, loading: false }) }));
vi.mock("@/hooks/useFinanceV2", () => ({
  useFinanceSettings: () => ({ data: null }),
  useFinanceMutations: () => ({ updateSettings: { mutateAsync: vi.fn(), isPending: false } }),
}));
vi.mock("@/hooks/useFinanceBoxes", () => ({ useFinanceBoxes: () => ({ data: { tax: 0, clients: 0, safety: 0 } }), boxesTotal: () => 0, EMPTY_BOXES: { tax: 0, clients: 0, safety: 0 } }));
vi.mock("@/components/cfo/TravaDeGasto", () => ({ useTravaDeGasto: () => ({ pedirLiberacao: () => Promise.resolve(true), janela: null }) }));
vi.mock("@/components/finance/NewIncomeModal", () => ({ default: () => null }));
vi.mock("recharts", () => {
  const Nada = () => null;
  return { ResponsiveContainer: Nada, BarChart: Nada, Bar: Nada, LineChart: Nada, Line: Nada, AreaChart: Nada, Area: Nada, ComposedChart: Nada, XAxis: Nada, YAxis: Nada, CartesianGrid: Nada, Tooltip: Nada, Legend: Nada, PieChart: Nada, Pie: Nada, Cell: Nada, ReferenceLine: Nada };
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: estado.rpc,
    from: () => ({ update: (v: unknown) => { estado.updates.push(v); return { eq: () => Promise.resolve({ error: null }) }; } }),
  },
}));

import CashFlow from "@/components/finance/CashFlow";

beforeEach(() => {
  vi.clearAllMocks();
  estado.updates = [];
  estado.rpc.mockResolvedValue({ data: { proximo_vencimento: null }, error: null });
  // Conta a pagar pontual, vencendo hoje (01/11 em São Paulo).
  estado.despesas = [{ id: "e1", description: "Fornecedor X", category: "fornecedores", amount: 300, due_date: "2026-11-01", status: "pending", recurrence: "none" }];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
});

describe("Fluxo de caixa: data do pagamento", () => {
  it("pagar às 23h30 de 01/11 em São Paulo grava 01/11, não o dia de UTC", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-02T02:30:00Z"));
    render(<CashFlow />);
    fireEvent.click(screen.getAllByRole("button", { name: /^pagar$/i })[0]);
    await waitFor(() => expect(estado.rpc).toHaveBeenCalled());
    expect(estado.rpc.mock.calls[0][0]).toBe("expense_pagar");
    expect(estado.rpc.mock.calls[0][1]).toMatchObject({ _expense_id: "e1", _pago_em: "2026-11-01" });
  });

  it("salvar despesa como Pago sem data, às 23h30 de 01/11, grava paid_date 01/11", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-02T02:30:00Z"));
    render(<CashFlow />);
    fireEvent.click(screen.getAllByRole("button", { name: "Editar Fornecedor X" })[0]);
    fireEvent.click(screen.getByRole("tab", { name: "Pago" }));
    fireEvent.click(screen.getByRole("button", { name: /^salvar$/i }));
    await waitFor(() => expect(estado.updates).toHaveLength(1));
    expect(estado.updates[0]).toMatchObject({ status: "paid", paid_date: "2026-11-01" });
  });
});
