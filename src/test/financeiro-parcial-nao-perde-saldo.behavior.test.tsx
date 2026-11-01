import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

/**
 * Financeiro: pagamento parcial. A cobrança original vira "partial" e o saldo restante nasce numa linha nova
 * "pending". O insert dessa linha não olhava o erro: se falhasse (RLS, rede), o restante sumia de A receber,
 * dos atrasados e da régua (todos leem "pending") e a tela ainda mostrava "Pagamento parcial registrado!".
 */

const hoje = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
})();

const estado = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  invalidate: vi.fn(),
  erroDoInsert: null as unknown,
  escritas: [] as Array<{ op: string; valor: unknown; filtros: Array<[string, unknown]> }>,
  cobranca: null as Record<string, unknown> | null,
}));

vi.mock("sonner", () => ({ toast: { success: estado.success, error: estado.error, warning: estado.warning, info: estado.info } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [] }), useQueryClient: () => ({ invalidateQueries: estado.invalidate }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "admin" }, profile: { role: "admin" }, loading: false }) }));
vi.mock("@/hooks/useFinancialData", () => ({
  useBilling: () => ({ data: estado.cobranca ? [estado.cobranca] : [], isLoading: false }),
  useAdsWallet: () => ({ data: [] }),
  useRechargeRequests: () => ({ data: [] }),
}));
vi.mock("@/hooks/useSupabaseData", () => ({ useClients: () => ({ data: [{ id: "client", company_name: "Cliente sintético", role: "client", plan_status: "active" }] }) }));
vi.mock("@/hooks/useFinanceV2", () => ({ useFinanceSettings: () => ({ data: null }) }));
vi.mock("@/hooks/useFinanceBoxes", () => ({ useFinanceBoxes: () => ({ data: null }), boxesTotal: () => 0 }));
vi.mock("@/lib/notifyHelpers", () => ({ notifyUser: vi.fn(), notifyAdmin: vi.fn() }));
vi.mock("@/components/finance/CashFlow", () => ({ default: () => null }));
vi.mock("@/components/finance/InvestorCapital", () => ({ default: () => null }));
vi.mock("@/components/finance/FixedCosts", () => ({ default: () => null }));
vi.mock("@/components/finance/PlansPricing", () => ({ default: () => null }));
vi.mock("@/components/finance/ManagementSummary", () => ({ default: () => null }));
vi.mock("@/components/finance/AdsInvestment", () => ({ default: () => null }));
vi.mock("@/components/finance/CFOAssistant", () => ({ default: () => null }));
vi.mock("recharts", () => ({ BarChart: () => null, Bar: () => null, XAxis: () => null, YAxis: () => null, CartesianGrid: () => null, Tooltip: () => null, ResponsiveContainer: () => null, Legend: () => null, PieChart: () => null, Pie: () => null, Cell: () => null }));
vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const filtros: Array<[string, unknown]> = [];
    let op = "select";
    let valor: unknown = null;
    const registrar = () => estado.escritas.push({ op: `${tabela}.${op}`, valor, filtros: [...filtros] });
    const q: Record<string, unknown> = {
      select: () => {
        if (op === "update") {
          registrar();
          return Promise.resolve({ data: [{ id: "b1" }], error: null });
        }
        return q;
      },
      eq: (c: string, v: unknown) => { filtros.push([c, v]); return q; },
      maybeSingle: () => Promise.resolve({ data: estado.cobranca, error: null }),
      update: (v: unknown) => { op = "update"; valor = v; return q; },
      insert: (v: unknown) => {
        op = "insert";
        valor = v;
        registrar();
        const resultado = { error: tabela === "billing" ? estado.erroDoInsert : null };
        return Object.assign(Promise.resolve(resultado), { select: () => ({ single: () => Promise.resolve({ data: null, ...resultado }) }) });
      },
      then: (ok: (r: unknown) => unknown, erro?: (e: unknown) => unknown) => {
        if (op === "update") registrar();
        return Promise.resolve({ data: [], error: null }).then(ok, erro);
      },
    };
    return q;
  };
  return { supabase: { from: (t: string) => consulta(t), functions: { invoke: () => Promise.resolve({ data: null, error: null }) } } };
});

import AdminFinanceiro from "@/pages/AdminFinanceiro";

beforeEach(() => {
  vi.clearAllMocks();
  estado.escritas = [];
  estado.erroDoInsert = null;
  estado.cobranca = { id: "b1", client_id: "client", type: "renewal", status: "pending", amount: 800, paid_amount: null, paid_date: null, due_date: hoje, description: "Mensalidade" };
  estado.invalidate.mockResolvedValue(undefined);
});
afterEach(cleanup);

async function pagarParte(valor: string) {
  render(<MemoryRouter><AdminFinanceiro /></MemoryRouter>);
  fireEvent.click(screen.getAllByRole("button", { name: /^pagar$/i })[0]);
  const dialogo = await screen.findByRole("dialog", { name: /registrar pagamento/i });
  fireEvent.click(within(dialogo).getByText("Pagou parte"));
  fireEvent.change(within(dialogo).getByRole("spinbutton"), { target: { value: valor } });
  fireEvent.click(within(dialogo).getByRole("button", { name: /^confirmar/i }));
  return dialogo;
}

describe("Financeiro: pagamento parcial não perde o saldo restante", () => {
  it("insert do saldo falhou: desfaz o parcial, mostra erro e não diz sucesso", async () => {
    estado.erroDoInsert = { message: "violação de RLS" };
    await pagarParte("300");
    await waitFor(() => expect(estado.error).toHaveBeenCalled());
    expect(String(estado.error.mock.calls[0][0])).toContain("saldo restante");
    expect(estado.success).not.toHaveBeenCalled();
    const updates = estado.escritas.filter((e) => e.op === "billing.update");
    expect(updates).toHaveLength(2);
    expect(updates[0].valor).toMatchObject({ status: "partial", paid_amount: 300 });
    // O segundo update devolve a original a pendente, sem o pago, só se ela ainda estiver no parcial que fizemos.
    expect(updates[1].valor).toMatchObject({ status: "pending", paid_amount: null, paid_date: null, description: "Mensalidade" });
    expect(updates[1].filtros).toEqual([["id", "b1"], ["status", "partial"]]);
    expect(estado.escritas.some((e) => e.op === "payment_audit_log.insert")).toBe(false);
  });

  it("insert do saldo deu certo: registra o parcial e cria a linha do restante", async () => {
    await pagarParte("300");
    await waitFor(() => expect(estado.success).toHaveBeenCalledWith("Pagamento parcial registrado!"));
    const saldo = estado.escritas.find((e) => e.op === "billing.insert");
    expect(saldo?.valor).toMatchObject({ client_id: "client", amount: 500 });
    expect(estado.escritas.filter((e) => e.op === "billing.update")).toHaveLength(1);
  });
});
