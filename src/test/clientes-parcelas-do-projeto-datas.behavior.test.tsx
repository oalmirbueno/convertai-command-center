import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Aba Pagamentos do projeto (portal e admin). `due_date` é DATE: `new Date("2026-11-10")` é meia-noite UTC, ou
 * seja 09/11 às 21h em São Paulo. A parcela aparecia com vencimento em 09/11 e ficava "Atrasado" desde a noite
 * da véspera e o dia inteiro do vencimento. O navegador está em UTC-3; o teste roda no mesmo fuso.
 */

const estado = vi.hoisted(() => ({ parcelas: [] as unknown[] }));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { id: "c1", role: "client" } }) }));
vi.mock("@/hooks/useClientIdentity", () => ({ useClientIdentity: () => ({ isImpersonating: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));
vi.mock("@/hooks/usePayments", () => ({
  useProjectPayments: () => ({
    data: { id: "pg1", total_value: 1000, entry_percentage: 50, entry_amount: 500, installments_count: 1, notes: null },
    isLoading: false,
  }),
  usePaymentInstallments: () => ({ data: estado.parcelas, isLoading: false }),
}));

import TabPayments from "@/components/client/tabs/TabPayments";

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TabPayments projectId="p1" clientId="c1" projectName="Site" />
    </QueryClientProvider>,
  );
}

const parcela = (due_date: string) => ({ id: "i1", installment_number: 1, description: "Parcela 1", amount: 500, paid_amount: 0, status: "pending", due_date });

const fusoOriginal = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/Sao_Paulo";
});
afterAll(() => {
  process.env.TZ = fusoOriginal;
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("parcelas do projeto no dia certo", () => {
  it("mostra o vencimento no dia certo e em dia na véspera às 22h", () => {
    // 09/11 às 22h em Brasília (10/11 01h UTC).
    vi.setSystemTime(new Date("2026-11-10T01:00:00Z"));
    estado.parcelas = [parcela("2026-11-10")];
    montar();
    expect(screen.getByText(/Vencimento: 10\/11\/2026/)).toBeTruthy();
    expect(screen.getByText("Pendente")).toBeTruthy();
    expect(screen.queryByText("Atrasado")).toBeNull();
  });

  it("no próprio dia do vencimento ainda não está atrasada", () => {
    vi.setSystemTime(new Date("2026-11-10T20:00:00Z"));
    estado.parcelas = [parcela("2026-11-10")];
    montar();
    expect(screen.getByText("Pendente")).toBeTruthy();
    expect(screen.queryByText("Atrasado")).toBeNull();
  });

  it("no dia seguinte ao vencimento fica atrasada", () => {
    vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
    estado.parcelas = [parcela("2026-11-10")];
    montar();
    expect(screen.getByText("Atrasado")).toBeTruthy();
  });
});
