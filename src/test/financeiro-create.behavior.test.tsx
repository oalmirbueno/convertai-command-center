import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import AdminFinanceiro from "@/pages/AdminFinanceiro";

const state = vi.hoisted(() => ({ create: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/lib/createBilling", () => ({ createBilling: state.create }));
vi.mock("sonner", () => ({ toast: { success: state.success, error: state.error, warning: state.warning } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [] }), useQueryClient: () => ({ invalidateQueries: state.invalidate }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "admin" }, profile: { role: "admin" }, loading: false }) }));
vi.mock("@/hooks/useFinancialData", () => ({ useBilling: () => ({ data: [], isLoading: false }), useAdsWallet: () => ({ data: [] }), useRechargeRequests: () => ({ data: [] }) }));
vi.mock("@/hooks/useSupabaseData", () => ({ useClients: () => ({ data: [{ id: "client", company_name: "Cliente sintético" }] }) }));
vi.mock("@/hooks/useFinanceV2", () => ({ useFinanceSettings: () => ({ data: null }) }));
vi.mock("@/hooks/useFinanceBoxes", () => ({ useFinanceBoxes: () => ({ data: null }), boxesTotal: () => 0 }));
vi.mock("@/components/finance/CashFlow", () => ({ default: () => null }));
vi.mock("@/components/finance/InvestorCapital", () => ({ default: () => null }));
vi.mock("@/components/finance/FixedCosts", () => ({ default: () => null }));
vi.mock("@/components/finance/PlansPricing", () => ({ default: () => null }));
vi.mock("@/components/finance/ManagementSummary", () => ({ default: () => null }));
vi.mock("@/components/finance/AdsInvestment", () => ({ default: () => null }));
vi.mock("@/components/finance/CFOAssistant", () => ({ default: () => null }));
vi.mock("recharts", () => ({ BarChart: () => null, Bar: () => null, XAxis: () => null, YAxis: () => null, CartesianGrid: () => null, Tooltip: () => null, ResponsiveContainer: () => null, Legend: () => null, PieChart: () => null, Pie: () => null, Cell: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  state.create.mockResolvedValue({ notificationFailed: false });
  state.invalidate.mockResolvedValue(undefined);
});
afterEach(cleanup);

function fillBilling() {
  render(<MemoryRouter><AdminFinanceiro /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Nova Cobrança" }));
  const dialog = screen.getByRole("dialog", { name: "Nova Cobrança" });
  fireEvent.change(within(dialog).getByLabelText("Cliente"), { target: { value: "client" } });
  fireEvent.change(within(dialog).getByLabelText("Valor (R$)"), { target: { value: "50" } });
  fireEvent.change(within(dialog).getByLabelText("Vencimento"), { target: { value: "2026-09-30" } });
  fireEvent.change(within(dialog).getByLabelText("Descrição"), { target: { value: "Rascunho preservado" } });
  return dialog;
}

describe("Financeiro: confirmacao e rascunho de cobranca", () => {
  it("confirma a cobranca salva e mostra aviso separado quando a notificacao falha", async () => {
    state.create.mockResolvedValue({ notificationFailed: true });
    const dialog = fillBilling();
    fireEvent.click(within(dialog).getByRole("button", { name: "Criar Cobrança" }));
    await waitFor(() => expect(state.warning).toHaveBeenCalledWith("A cobrança foi criada, mas não consegui avisar o cliente."));
    expect(state.success).toHaveBeenCalledWith("Cobrança criada");
    expect(state.error).not.toHaveBeenCalled();
    expect(state.create).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("mantem o modal e os valores quando a persistencia falha, sem toast de sucesso", async () => {
    state.create.mockRejectedValue(new Error("Falha sintética ao gravar"));
    const dialog = fillBilling();
    fireEvent.click(within(dialog).getByRole("button", { name: "Criar Cobrança" }));
    await waitFor(() => expect(state.error).toHaveBeenCalledWith("Falha sintética ao gravar"));
    expect(state.success).not.toHaveBeenCalled();
    expect(state.invalidate).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Nova Cobrança" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Cliente")).toHaveValue("client");
    expect(within(dialog).getByLabelText("Valor (R$)")).toHaveValue(50);
    expect(within(dialog).getByLabelText("Vencimento")).toHaveValue("2026-09-30");
    expect(within(dialog).getByLabelText("Descrição")).toHaveValue("Rascunho preservado");
    expect(within(dialog).getByRole("button", { name: "Criar Cobrança" })).toBeEnabled();
  });

  it("aguarda a confirmacao, bloqueia clique duplicado e limpa o rascunho so apos sucesso", async () => {
    let finish: (value: { notificationFailed: boolean }) => void;
    state.create.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const dialog = fillBilling();
    const button = within(dialog).getByRole("button", { name: "Criar Cobrança" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(state.create).toHaveBeenCalledOnce();
    expect(state.success).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: "Criando cobrança…" })).toBeDisabled();
    expect(within(dialog).getByLabelText("Descrição")).toBeDisabled();
    await act(async () => { finish!({ notificationFailed: false }); });
    expect(state.success).toHaveBeenCalledWith("Cobrança criada");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Nova Cobrança" }));
    expect(screen.getByLabelText("Descrição")).toHaveValue("");
  });
});
