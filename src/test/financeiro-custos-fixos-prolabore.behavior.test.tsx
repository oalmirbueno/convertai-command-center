import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reajustarProLabore } from "@/lib/financeiro/reajusteDoProLabore";
import type { supabase as clienteReal } from "@/integrations/supabase/client";

/**
 * Custos fixos:
 * - Reajuste do pró-labore: encerrava a recorrência antiga e criava a nova sem conferir erro. Se o insert
 *   falhasse, o pró-labore sumia dos custos recorrentes e a tela dizia "Pró-labore atualizado".
 * - "Pagar" gravava o _pago_em com toISOString() (UTC): às 23h30 de 01/11 em São Paulo já é 02/11 em UTC.
 */

type Registro = { op: string; valor: unknown; filtros: Array<[string, unknown]> };

const estado = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  rpc: vi.fn(),
  updateSettings: vi.fn(),
  escritas: [] as Registro[],
  erros: {} as Record<string, unknown>,
  despesas: [] as Record<string, unknown>[],
}));

vi.mock("sonner", () => ({ toast: { success: estado.success, error: estado.error, warning: vi.fn(), info: vi.fn() } }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: estado.despesas, isLoading: false, error: null, refetch: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/hooks/useFinanceV2", () => ({
  useFinanceSettings: () => ({ data: { currentProLabore: 3000, targetProLabore: 10000, raw: {} } }),
  useFinanceRecurringRules: () => ({ data: [] }),
  useFinanceMutations: () => ({ updateSettings: { mutateAsync: estado.updateSettings, isPending: false }, upsertRecurringRule: { mutateAsync: vi.fn() } }),
}));
vi.mock("@/components/cfo/TravaDeGasto", () => ({ useTravaDeGasto: () => ({ pedirLiberacao: () => Promise.resolve(true), janela: null }) }));
vi.mock("@/components/finance/AreaTributaria", () => ({ default: () => null }));
vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const filtros: Array<[string, unknown]> = [];
    let op = "select";
    let valor: unknown = null;
    const responder = () => {
      const chave = `${tabela}.${op}`;
      estado.escritas.push({ op: chave, valor, filtros: [...filtros] });
      return Promise.resolve({ data: null, error: estado.erros[chave] ?? null });
    };
    const q: Record<string, unknown> = {
      eq: (c: string, v: unknown) => { filtros.push([c, v]); return q; },
      update: (v: unknown) => { op = "update"; valor = v; return q; },
      insert: (v: unknown) => { op = "insert"; valor = v; return q; },
      then: (ok: (r: unknown) => unknown, erro?: (e: unknown) => unknown) => responder().then(ok, erro),
    };
    return q;
  };
  return { supabase: { from: (t: string) => consulta(t), rpc: estado.rpc } };
});

import FixedCosts from "@/components/finance/FixedCosts";

const proLaboreMensal = { id: "pl1", description: "Pró-labore Almir", category: "salarios", amount: 3000, due_date: "2026-11-10", status: "pending", recurrence: "monthly" };

beforeEach(() => {
  vi.clearAllMocks();
  estado.escritas = [];
  estado.erros = {};
  estado.despesas = [proLaboreMensal];
  estado.updateSettings.mockResolvedValue(undefined);
  estado.rpc.mockResolvedValue({ data: { proximo_vencimento: "2026-12-10" }, error: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
});

function ajustarProLabore(valor: string) {
  render(<FixedCosts monthlyOperationalRevenue={20000} aba="custos" onAba={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Ajustar pró-labore" }));
  const dialogo = screen.getByRole("dialog", { name: "Ajustar pró-labore" });
  fireEvent.change(within(dialogo).getByLabelText(/novo valor mensal/i), { target: { value: valor } });
  fireEvent.click(within(dialogo).getByRole("button", { name: /confirmar novo pró-labore/i }));
  return dialogo;
}

describe("Custos fixos: reajuste do pró-labore", () => {
  it("insert do novo falhou: volta a recorrência do antigo, mostra erro e não diz atualizado", async () => {
    estado.erros["expenses.insert"] = { message: "violação de RLS" };
    ajustarProLabore("4000");
    await waitFor(() => expect(estado.error).toHaveBeenCalled());
    expect(estado.success).not.toHaveBeenCalled();
    const updates = estado.escritas.filter((e) => e.op === "expenses.update");
    expect(updates).toHaveLength(2);
    expect(updates[0].valor).toEqual({ recurrence: "none" });
    expect(updates[1].valor).toEqual({ recurrence: "monthly" });
    expect(updates[1].filtros).toEqual([["id", "pl1"]]);
    expect(screen.getByRole("dialog", { name: "Ajustar pró-labore" })).toBeInTheDocument();
  });

  it("deu tudo certo: encerra o antigo, cria o novo e confirma", async () => {
    ajustarProLabore("4000");
    await waitFor(() => expect(estado.success).toHaveBeenCalledWith(expect.stringContaining("Pró-labore atualizado")));
    expect(estado.escritas.map((e) => e.op)).toEqual(["expenses.update", "expenses.insert"]);
    expect(estado.escritas[1].valor).toMatchObject({ amount: 4000, recurrence: "monthly" });
  });
});

describe("reajustarProLabore", () => {
  it("encerrar o antigo falhou: não cria o novo", async () => {
    const ops: string[] = [];
    const db = {
      from: () => ({
        update: () => ({ eq: () => { ops.push("update"); return Promise.resolve({ error: { message: "rede" } }); } }),
        insert: () => { ops.push("insert"); return Promise.resolve({ error: null }); },
      }),
    } as unknown as typeof clienteReal;
    const erro = await reajustarProLabore(db, { id: "pl1", recurrence: "monthly" }, { description: "x", category: "salarios", amount: 1, due_date: "2026-11-10" });
    expect(erro).toContain("Nada foi alterado");
    expect(ops).toEqual(["update"]);
  });
});

describe("Custos fixos: data do pagamento", () => {
  it("pagar às 23h30 de 01/11 em São Paulo grava 01/11, não o dia de UTC", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-02T02:30:00Z"));
    render(<FixedCosts monthlyOperationalRevenue={20000} aba="custos" onAba={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^pagar$/i }));
    await waitFor(() => expect(estado.rpc).toHaveBeenCalled());
    expect(estado.rpc.mock.calls[0][0]).toBe("expense_pagar");
    expect(estado.rpc.mock.calls[0][1]).toMatchObject({ _expense_id: "pl1", _pago_em: "2026-11-01" });
  });
});
