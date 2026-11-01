import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aliquotaDigitadaEmFracao } from "@/lib/financeiro/aliquotaDigitada";
import type { FinancePlan, FinancePlanVersion } from "@/hooks/useFinanceV2";

/**
 * Planos e preços: os campos "Alíquota (%)" adivinhavam a unidade (`v > 1 ? v / 100 : v`). "0,5" (meio por
 * cento) virava 50% e "1" virava 100%. Pior: uma alíquota salva de 0,5% reaparece no modal de novo preço
 * como "0.5" e, ao criar a nova versão, era gravada como 50%.
 */

const estado = vi.hoisted(() => ({ criarVersao: vi.fn(), planos: [] as unknown[] }));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [] }) }));
vi.mock("@/hooks/useSupabaseData", () => ({ useClients: () => ({ data: [] }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/useFinanceV2", async (orig) => {
  const real = await orig<typeof import("@/hooks/useFinanceV2")>();
  const mutacao = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    ...real,
    useFinancePlans: () => ({ data: estado.planos, isLoading: false }),
    useFinanceSettings: () => ({ data: null }),
    useFinanceMutations: () => ({ upsertPlan: mutacao(), archivePlan: mutacao(), createPlanVersion: { mutateAsync: estado.criarVersao, isPending: false } }),
  };
});

import PlansPricing from "@/components/finance/PlansPricing";

function versao(taxRate: number): FinancePlanVersion {
  return {
    id: "v1", planId: "p1", version: 1, amount: 1000, taxRate, finalAmount: 1005.03, directCost: 275, directCostEstimated: false,
    billingPeriod: "monthly", setupFee: 0, amountKind: "operational", effectiveFrom: "2026-01-01", effectiveTo: null,
    description: null, createdAt: null, isActive: true, raw: {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  estado.criarVersao.mockResolvedValue(undefined);
  const v = versao(0.005);
  const plano: FinancePlan = { id: "p1", name: "Pro", code: null, description: null, isActive: true, currentVersion: v, upcomingVersion: null, versions: [v], raw: {} };
  estado.planos = [plano];
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("Planos e preços: alíquota digitada em %", () => {
  it("alíquota salva de 0,5% continua 0,5% ao criar a nova versão (não vira 50%)", async () => {
    render(<PlansPricing />);
    fireEvent.click(screen.getByRole("button", { name: "Novo preço" }));
    const dialogo = screen.getByRole("dialog", { name: /novo preço/i });
    expect(within(dialogo).getByLabelText("Alíquota (%)")).toHaveValue(0.5);
    fireEvent.click(within(dialogo).getByRole("button", { name: /criar nova versão de preço/i }));
    await waitFor(() => expect(estado.criarVersao).toHaveBeenCalled());
    expect(estado.criarVersao.mock.calls[0][0].taxRate).toBeCloseTo(0.005, 10);
  });

  it("\"1\" no modal é 1%, não 100% (que o salvar recusava)", async () => {
    render(<PlansPricing />);
    fireEvent.click(screen.getByRole("button", { name: "Novo preço" }));
    const dialogo = screen.getByRole("dialog", { name: /novo preço/i });
    fireEvent.change(within(dialogo).getByLabelText("Alíquota (%)"), { target: { value: "1" } });
    fireEvent.click(within(dialogo).getByRole("button", { name: /criar nova versão de preço/i }));
    await waitFor(() => expect(estado.criarVersao).toHaveBeenCalled());
    expect(estado.criarVersao.mock.calls[0][0].taxRate).toBeCloseTo(0.01, 10);
  });
});

describe("aliquotaDigitadaEmFracao", () => {
  it("o digitado é sempre porcentagem", () => {
    expect(aliquotaDigitadaEmFracao("6")).toBeCloseTo(0.06, 10);
    expect(aliquotaDigitadaEmFracao("0,5")).toBeCloseTo(0.005, 10);
    expect(aliquotaDigitadaEmFracao("1")).toBeCloseTo(0.01, 10);
    expect(aliquotaDigitadaEmFracao("15.5")).toBeCloseTo(0.155, 10);
    expect(aliquotaDigitadaEmFracao("0")).toBe(0);
  });
  it("vazio ou inválido é null", () => {
    expect(aliquotaDigitadaEmFracao("")).toBeNull();
    expect(aliquotaDigitadaEmFracao("  ")).toBeNull();
    expect(aliquotaDigitadaEmFracao("abc")).toBeNull();
  });
});
