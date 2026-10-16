import { createElement as h } from "react";
import { configure, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 16/10/2026 (dono: "otimizar o mobile, cara de aplicativo, menos poluído"):
 * abaixo de 768 px a lista de Clientes vira lista de app. Busca e filtros
 * presos no topo, cada linha com foto, nome e UMA linha de apoio (plano e
 * situação), sem a faixa de números nem o financeiro da linha, e o Novo
 * cliente num "+" flutuante. No computador nada muda.
 */

configure({ asyncUtilTimeout: 30000 });

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const mock = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = () => {
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "order", "limit", "range", "gte", "lte", "gt", "lt"]) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve({ data: null, error: null });
    b.single = () => Promise.resolve({ data: null, error: null });
    b.then = (ok: any, erro: any) => Promise.resolve({ data: [], error: null }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
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
  useClients: () => ({ data: [{ id: "11111111-1111-4111-8111-111111111111", company_name: "Loja da Joana", full_name: "Joana", plan_status: "active", client_type: "recurring" }], isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/hooks/useFinanceV2", () => ({
  useClientFinancialSummaries: () => ({ data: { rows: [] }, isLoading: false, isPending: false, isError: false }),
  useFinancePlans: () => ({ data: [] }),
  useFinanceSettings: () => ({ data: null }),
}));
vi.mock("@/hooks/useFinancialData", () => ({ useBilling: () => ({ data: [] }) }));
vi.mock("@/hooks/useFotosDosClientes", () => ({ useFotosDosClientes: () => ({ fotoDe: () => null }) }));
vi.mock("@/components/cronometro/CronometroProvider", () => ({ useClienteEmFoco: () => undefined }));
vi.mock("@/components/admin/EditClientDrawer", () => ({ default: () => null }));
vi.mock("@/components/admin/CreateClientModal", () => ({ default: () => null }));
vi.mock("@/components/admin/BriefingLinkModal", () => ({ default: () => null }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmDialogProvider } from "@/components/shared/confirmDialog";
import Clients from "@/pages/Clients";

function larguraDaJanela(px: number) {
  Object.defineProperty(window, "innerWidth", { value: px, configurable: true, writable: true });
}

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, { initialEntries: ["/clientes"] }, h(ConfirmDialogProvider, null, h(TooltipProvider, null, h(Clients))))));
}

const larguraOriginal = window.innerWidth;
beforeEach(() => {
  window.localStorage.clear();
  mock.invoke.mockReset();
  mock.invoke.mockResolvedValue({ data: {}, error: null });
});
afterEach(() => {
  larguraDaJanela(larguraOriginal);
  document.body.removeAttribute("data-reserva-flutuante");
});

describe("Clientes no celular (16/10/2026)", () => {
  it("lista de app: busca presa no topo, linha com uma linha de apoio, sem números e com o + flutuante", async () => {
    larguraDaJanela(375);
    const { container } = montar();
    const linha = await screen.findByRole("button", { name: "Abrir cadastro do cliente Loja da Joana" });
    // Uma linha de apoio: plano e situação (sem e-mail/telefone e sem o financeiro em grade).
    expect(linha.textContent).toContain("Sem plano · Sem cobrança criada");
    expect(linha.getAttribute("aria-describedby")).toBeNull();
    expect(container.querySelector(`#client-finance-${CLIENTE}`)).toBeNull();
    expect(screen.queryByRole("region", { name: "Resumo financeiro dos clientes" })).toBeNull();
    // Busca e filtros presos no topo da área.
    const barra = container.querySelector("[data-barra-da-lista]");
    expect(barra && barra.className).toContain("sticky top-0");
    expect(barra && barra.querySelector("input")).toBeTruthy();
    // Novo cliente: um só, o + flutuante; a faixa reservada no fim está ligada.
    const novos = screen.getAllByRole("button", { name: "Novo cliente" });
    expect(novos).toHaveLength(1);
    expect(novos[0].className).toContain("fixed");
    expect(document.body.hasAttribute("data-reserva-flutuante")).toBe(true);
    // Nenhuma função some: o "..." da linha continua.
    expect(screen.getByRole("button", { name: "Mais ações de Loja da Joana" })).toBeTruthy();
  });

  it("no computador nada muda: números, financeiro da linha e Novo cliente no topo", async () => {
    larguraDaJanela(1280);
    const { container } = montar();
    await screen.findByRole("button", { name: "Abrir cadastro do cliente Loja da Joana" });
    expect(screen.getByRole("region", { name: "Resumo financeiro dos clientes" })).toBeTruthy();
    expect(container.querySelector(`#client-finance-${CLIENTE}`)).toBeTruthy();
    expect(container.querySelector("[data-barra-da-lista]")).toBeNull();
    const novos = screen.getAllByRole("button", { name: "Novo cliente" });
    expect(novos).toHaveLength(1);
    expect(novos[0].className).not.toContain("fixed");
    expect(document.body.hasAttribute("data-reserva-flutuante")).toBe(false);
  });
});
