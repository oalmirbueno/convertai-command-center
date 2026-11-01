import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { gravarEstadoDaTela } from "@/components/sistema";

/**
 * Financeiro (admin): editar plano e o ciclo da recarga de Ads.
 *
 * - Editar plano mudava só a cobrança (qualquer "renewal", até uma já paga) e nunca o plan_value do perfil,
 *   que é de onde o gatilho de renovação tira o valor da próxima mensalidade. Nenhuma escrita conferia erro.
 * - Concluir recarga somava em cima do saldo em cache, não conferia erro e concluía o pedido sem olhar o status.
 * - Pedir recarga notificava o cliente e disparava o webhook mesmo quando o pedido não tinha sido gravado.
 */

type Registro = { op: string; valor: unknown; filtros: Array<[string, unknown]> };
type Resposta = { data?: unknown; error?: unknown };

const estado = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  invalidate: vi.fn(),
  notifyUser: vi.fn(),
  fireWebhook: vi.fn(),
  escritas: [] as Registro[],
  respostas: {} as Record<string, Resposta>,
  billing: [] as Record<string, unknown>[],
  wallets: [] as Record<string, unknown>[],
  recargas: [] as Record<string, unknown>[],
}));

vi.mock("sonner", () => ({ toast: { success: estado.success, error: estado.error, warning: estado.warning, info: estado.info } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [] }), useQueryClient: () => ({ invalidateQueries: estado.invalidate }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "admin" }, profile: { role: "admin" }, loading: false }) }));
vi.mock("@/hooks/useFinancialData", () => ({
  useBilling: () => ({ data: estado.billing, isLoading: false }),
  useAdsWallet: () => ({ data: estado.wallets }),
  useRechargeRequests: () => ({ data: estado.recargas }),
}));
vi.mock("@/hooks/useSupabaseData", () => ({
  useClients: () => ({
    data: [{ id: "client", company_name: "Cliente sintético", role: "client", plan_status: "active", plan_value: 800, plan_name: "Pro", plan_renewal_date: "2026-12-10" }],
  }),
}));
vi.mock("@/hooks/useFinanceV2", () => ({ useFinanceSettings: () => ({ data: null }) }));
vi.mock("@/hooks/useFinanceBoxes", () => ({ useFinanceBoxes: () => ({ data: null }), boxesTotal: () => 0 }));
vi.mock("@/lib/notifyHelpers", () => ({ notifyUser: estado.notifyUser, notifyAdmin: vi.fn() }));
vi.mock("@/lib/webhooks", () => ({ fireWebhook: estado.fireWebhook, webhooks: { adsRecharge: "ads-recharge" } }));
vi.mock("@/components/finance/CashFlow", () => ({ default: () => null }));
vi.mock("@/components/finance/InvestorCapital", () => ({ default: () => null }));
vi.mock("@/components/finance/FixedCosts", () => ({ default: () => null }));
vi.mock("@/components/finance/PlansPricing", () => ({ default: () => null }));
vi.mock("@/components/finance/ManagementSummary", () => ({ default: () => null }));
vi.mock("@/components/finance/AdsInvestment", () => ({ default: () => null }));
vi.mock("@/components/finance/CFOAssistant", () => ({ default: () => null }));
vi.mock("recharts", () => ({ BarChart: () => null, Bar: () => null, XAxis: () => null, YAxis: () => null, CartesianGrid: () => null, Tooltip: () => null, ResponsiveContainer: () => null, Legend: () => null, PieChart: () => null, Pie: () => null, Cell: () => null }));
vi.mock("@/integrations/supabase/client", () => {
  // Cada consulta registra tabela.operação, o valor e os filtros, e responde pelo que o teste configurou.
  const consulta = (tabela: string) => {
    const filtros: Array<[string, unknown]> = [];
    let op = "select";
    let valor: unknown = null;
    const responder = () => {
      const chave = `${tabela}.${op}`;
      if (op !== "select") estado.escritas.push({ op: chave, valor, filtros: [...filtros] });
      else estado.escritas.push({ op: chave, valor: null, filtros: [...filtros] });
      const r = estado.respostas[chave] || {};
      return Promise.resolve({ data: r.data ?? (op === "update" ? [{ id: "linha" }] : []), error: r.error ?? null });
    };
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => { filtros.push([c, v]); return q; },
      in: () => q,
      order: () => q,
      limit: () => q,
      update: (v: unknown) => { op = "update"; valor = v; return q; },
      insert: (v: unknown) => { op = "insert"; valor = v; return q; },
      maybeSingle: () => responder(),
      single: () => responder(),
      then: (ok: (r: unknown) => unknown, erro?: (e: unknown) => unknown) => responder().then(ok, erro),
    };
    return q;
  };
  return { supabase: { from: (t: string) => consulta(t), functions: { invoke: () => Promise.resolve({ data: null, error: null }) } } };
});

import AdminFinanceiro from "@/pages/AdminFinanceiro";

const escritasDe = (op: string) => estado.escritas.filter((e) => e.op === op);

beforeEach(() => {
  vi.clearAllMocks();
  estado.escritas = [];
  estado.respostas = {};
  estado.billing = [];
  estado.wallets = [];
  estado.recargas = [];
  estado.invalidate.mockResolvedValue(undefined);
  estado.notifyUser.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function abrir(aba: string) {
  gravarEstadoDaTela("financeiro:aba", aba);
  render(<MemoryRouter><AdminFinanceiro /></MemoryRouter>);
}

describe("Financeiro: editar plano", () => {
  beforeEach(() => {
    // Lista em due_date desc, como o useBilling devolve: a primeira "renewal" é a de novembro, paga
    // adiantada; a de outubro segue pendente (atrasada). A pendente mais antiga de setembro já tinha sido
    // substituída e também está pendente, para provar que vale a mais recente.
    estado.billing = [
      { id: "paga", client_id: "client", type: "renewal", status: "paid", amount: 800, due_date: "2026-11-10", description: "Pro" },
      { id: "pendente", client_id: "client", type: "renewal", status: "pending", amount: 800, due_date: "2026-10-10", description: "Pro" },
      { id: "pendente-antiga", client_id: "client", type: "renewal", status: "pending", amount: 800, due_date: "2026-09-10", description: "Pro" },
    ];
  });

  function editarPlano(valor: string) {
    abrir("renewals");
    fireEvent.click(screen.getByRole("button", { name: /editar plano de cliente sintético/i }));
    const dialogo = screen.getByRole("dialog", { name: /editar plano/i });
    fireEvent.change(within(dialogo).getByLabelText("Valor mensal (R$)"), { target: { value: valor } });
    fireEvent.click(within(dialogo).getByRole("button", { name: /^salvar$/i }));
    return dialogo;
  }

  it("grava o plan_value no perfil e atualiza só a renovação pendente", async () => {
    editarPlano("950");
    await waitFor(() => expect(estado.success).toHaveBeenCalledWith("Plano atualizado"));
    const perfil = escritasDe("profiles.update");
    expect(perfil).toHaveLength(1);
    // Sem o plan_value, o gatilho de renovação criaria a próxima mensalidade com os R$ 800 antigos.
    expect(perfil[0].valor).toMatchObject({ plan_value: 950, plan_renewal_date: "2026-12-10" });
    const cobranca = escritasDe("billing.update");
    expect(cobranca).toHaveLength(1);
    expect(cobranca[0].valor).toMatchObject({ amount: 950 });
    // A paga fica como está: o update mira a pendente e só vale se ela ainda estiver pendente.
    expect(cobranca[0].filtros).toEqual([["id", "pendente"], ["status", "pending"]]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("perfil não gravou: mostra erro, não mexe na cobrança e mantém o modal", async () => {
    estado.respostas["profiles.update"] = { error: { message: "violação de RLS" } };
    editarPlano("950");
    await waitFor(() => expect(estado.error).toHaveBeenCalled());
    expect(estado.success).not.toHaveBeenCalled();
    expect(escritasDe("billing.update")).toHaveLength(0);
    expect(screen.getByRole("dialog", { name: /editar plano/i })).toBeInTheDocument();
  });

  it("cobrança pendente não gravou: mostra erro e mantém o modal", async () => {
    estado.respostas["billing.update"] = { error: { message: "rede" } };
    editarPlano("950");
    await waitFor(() => expect(estado.error).toHaveBeenCalled());
    expect(estado.success).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: /editar plano/i })).toBeInTheDocument();
  });
});

describe("Financeiro: concluir recarga", () => {
  beforeEach(() => {
    // O cache da tela diz R$ 100; no banco o saldo já é R$ 400 (outra recarga entrou depois de carregar).
    estado.wallets = [{ id: "w1", client_id: "client", platform: "meta", balance: 100, client: { company_name: "Cliente sintético" } }];
    estado.recargas = [{ id: "r1", client_id: "client", platform: "meta", amount: 250, status: "approved", created_at: "2026-10-30T12:00:00Z", requester: { full_name: "Equipe" } }];
    estado.respostas["ads_wallet.select"] = { data: { balance: 400, last_recharge_date: "2026-10-01T12:00:00Z" } };
    estado.respostas["recharge_requests.update"] = { data: [{ id: "r1" }] };
  });

  const concluir = () => {
    abrir("ads");
    fireEvent.click(screen.getByRole("button", { name: /concluir recarga/i }));
  };

  it("soma sobre o saldo lido do banco e só conclui o pedido ainda aprovado", async () => {
    concluir();
    await waitFor(() => expect(estado.success).toHaveBeenCalledWith("Saldo atualizado!"));
    const saldo = escritasDe("ads_wallet.update");
    expect(saldo).toHaveLength(1);
    expect(saldo[0].valor).toMatchObject({ balance: 650 });
    const pedido = escritasDe("recharge_requests.update");
    expect(pedido).toHaveLength(1);
    expect(pedido[0].filtros).toEqual([["id", "r1"], ["status", "approved"]]);
    expect(estado.notifyUser).toHaveBeenCalledOnce();
  });

  it("saldo não gravou: não conclui o pedido, não avisa o cliente e não diz sucesso", async () => {
    estado.respostas["ads_wallet.update"] = { error: { message: "violação de RLS" } };
    concluir();
    await waitFor(() => expect(estado.error).toHaveBeenCalled());
    expect(escritasDe("recharge_requests.update")).toHaveLength(0);
    expect(estado.notifyUser).not.toHaveBeenCalled();
    expect(estado.success).not.toHaveBeenCalled();
  });

  it("saldo mudou entre a leitura e a gravação: não grava por cima, não conclui o pedido", async () => {
    // O update só vale com o saldo lido (400); se um gasto entrou no meio, o banco não acha a linha.
    estado.respostas["ads_wallet.update"] = { data: [] };
    concluir();
    await waitFor(() => expect(estado.error).toHaveBeenCalled());
    const saldo = escritasDe("ads_wallet.update");
    expect(saldo).toHaveLength(1);
    expect(saldo[0].filtros).toEqual([["id", "w1"], ["balance", 400]]);
    expect(String(estado.error.mock.calls[0][0])).toContain("mudou");
    expect(escritasDe("recharge_requests.update")).toHaveLength(0);
    expect(estado.notifyUser).not.toHaveBeenCalled();
    expect(estado.success).not.toHaveBeenCalled();
  });

  it("pedido já não estava aprovado: desfaz o saldo somado e mostra erro", async () => {
    estado.respostas["recharge_requests.update"] = { data: [] };
    concluir();
    await waitFor(() => expect(estado.error).toHaveBeenCalled());
    const saldo = escritasDe("ads_wallet.update");
    expect(saldo).toHaveLength(2);
    expect(saldo[1].valor).toMatchObject({ balance: 400, last_recharge_date: "2026-10-01T12:00:00Z" });
    // Só desfaz se o saldo ainda for o que gravamos.
    expect(saldo[1].filtros).toEqual([["id", "w1"], ["balance", 650]]);
    expect(estado.notifyUser).not.toHaveBeenCalled();
    expect(estado.success).not.toHaveBeenCalled();
  });
});

describe("Financeiro: pedir recarga", () => {
  beforeEach(() => {
    estado.wallets = [{ id: "w1", client_id: "client", platform: "meta", balance: 100, client: { company_name: "Cliente sintético" } }];
  });

  function pedir() {
    abrir("ads");
    // Para o admin a seção das wallets nasce recolhida; o título abre.
    fireEvent.click(screen.getByText("Wallets de clientes"));
    fireEvent.click(screen.getByRole("button", { name: /solicitar recarga meta/i }));
    const dialogo = screen.getByRole("dialog", { name: /solicitar recarga/i });
    fireEvent.click(within(dialogo).getByRole("button", { name: /500/ }));
    fireEvent.click(within(dialogo).getByRole("button", { name: /enviar ao cliente/i }));
    return dialogo;
  }

  it("pedido não gravou: não notifica o cliente, não dispara webhook e não diz sucesso", async () => {
    estado.respostas["recharge_requests.insert"] = { error: { message: "violação de RLS" } };
    pedir();
    await waitFor(() => expect(estado.error).toHaveBeenCalled());
    expect(estado.notifyUser).not.toHaveBeenCalled();
    expect(estado.fireWebhook).not.toHaveBeenCalled();
    expect(estado.success).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: /solicitar recarga/i })).toBeInTheDocument();
  });

  it("pedido gravado: notifica e dispara o webhook", async () => {
    pedir();
    await waitFor(() => expect(estado.success).toHaveBeenCalled());
    expect(escritasDe("recharge_requests.insert")[0].valor).toMatchObject({ client_id: "client", platform: "meta", amount: 500 });
    expect(estado.notifyUser).toHaveBeenCalledOnce();
    expect(estado.fireWebhook).toHaveBeenCalledOnce();
  });
});
