import { createElement as h } from "react";
import { cleanup, configure, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Clientes, aba Inativos. A aba junta todos os inativos numa lista só, mas o avulso concluído aparecia também no
 * grupo "Avulsos concluídos" (duas vezes na tela), e o contador dos filtros de cobrança não contava esse avulso
 * (não batia com a lista exibida).
 */

configure({ asyncUtilTimeout: 30000 });

vi.mock("@/integrations/supabase/client", () => {
  const consulta = () => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "order", "limit", "range", "gte", "lte", "gt", "lt"]) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve({ data: null, error: null });
    b.single = () => Promise.resolve({ data: null, error: null });
    b.then = (ok: (r: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: () => Promise.resolve({ data: {}, error: null }) },
      rpc: () => Promise.resolve({ data: null, error: null }),
      from: () => consulta(),
      channel: () => ({ on() { return this; }, subscribe() { return this; } }),
      removeChannel: () => undefined,
      storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: null, error: null }) }) },
    },
  };
});
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));
vi.mock("@/hooks/useSupabaseData", () => ({
  useClients: () => ({
    data: [
      { id: "11111111-1111-4111-8111-111111111111", company_name: "Ativa Ltda", full_name: "Ana", plan_status: "active", client_type: "recurring" },
      { id: "22222222-2222-4222-8222-222222222222", company_name: "Recorrente Parado", full_name: "Rui", plan_status: "inactive", client_type: "recurring" },
      {
        id: "33333333-3333-4333-8333-333333333333",
        company_name: "Avulso Entregue",
        full_name: "Bia",
        plan_status: "inactive",
        client_type: "one_off",
        services_config: { one_off_done: true },
      },
      {
        id: "44444444-4444-4444-8444-444444444444",
        company_name: "Avulso Ativo Entregue",
        full_name: "Caio",
        plan_status: "active",
        client_type: "one_off",
        services_config: { one_off_done: true },
      },
    ],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/useFinanceV2", () => ({
  useClientFinancialSummaries: () => ({ data: { rows: [] }, isLoading: false, isPending: false, isError: false }),
  useFinancePlans: () => ({ data: [] }),
  useFinanceSettings: () => ({ data: null }),
}));
vi.mock("@/hooks/useFinancialData", () => ({ useBilling: () => ({ data: [] }) }));
vi.mock("@/hooks/useFotosDosClientes", () => ({ useFotosDosClientes: () => ({ fotoDe: () => null, fotosDe: () => [] }) }));
vi.mock("@/components/cronometro/CronometroProvider", () => ({ useClienteEmFoco: () => undefined }));
vi.mock("@/components/admin/EditClientDrawer", () => ({ default: () => null }));
vi.mock("@/components/admin/CreateClientModal", () => ({ default: () => null }));
vi.mock("@/components/admin/BriefingLinkModal", () => ({ default: () => null }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmDialogProvider } from "@/components/shared/confirmDialog";
import Clients from "@/pages/Clients";

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, { initialEntries: ["/clientes"] }, h(ConfirmDialogProvider, null, h(TooltipProvider, null, h(Clients))))));
}

const ocorrencias = (texto: string) => screen.queryAllByText(texto).length;

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1280 });
});
afterEach(cleanup);

describe("aba Inativos de Clientes", () => {
  it("o avulso concluído aparece uma vez só e o contador da cobrança bate com a lista", async () => {
    montar();
    await screen.findAllByText("Ativa Ltda");
    fireEvent.click(document.querySelector('[data-etapa="inactive"]') as HTMLElement);

    const lista = await screen.findByRole("region", { name: "Clientes inativos" });
    expect(within(lista).getAllByText("Recorrente Parado").length).toBeGreaterThan(0);
    expect(within(lista).getAllByText("Avulso Entregue").length).toBeGreaterThan(0);
    expect(screen.queryByText("Avulsos concluídos")).toBeNull();
    expect(ocorrencias("Avulso Entregue")).toBe(within(lista).getAllByText("Avulso Entregue").length);

    // Nenhum dos dois tem cobrança: "Sem cobrança" conta os 2 que a lista mostra.
    const filtro = document.querySelector("[data-filtro-da-cobranca]") as HTMLElement;
    const semCobranca = within(filtro).getByRole("tab", { name: /Sem cobrança/ });
    expect(semCobranca.textContent).toContain("2");
  });

  it("nas outras abas o grupo Avulsos concluídos continua", async () => {
    montar();
    await screen.findAllByText("Ativa Ltda");
    expect(screen.getByText("Avulsos concluídos")).toBeTruthy();
    // Inativo não aparece fora da aba Inativos.
    expect(screen.queryByText("Avulso Entregue")).toBeNull();
  });
});
