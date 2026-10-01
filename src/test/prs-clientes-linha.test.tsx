import { createElement as h } from "react";
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente PRS (30/09), achado do revisor: o "..." da linha da lista de
 * Clientes criava a proposta direto (sem projeto e sem modelo), um caminho
 * diferente da janela "Nova proposta". Agora "Nova proposta..." e "Proposta
 * de upsell..." abrem a mesma janela, já com o cliente da linha, e nada é
 * criado antes do clique em Criar.
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

const chamadasDe = (acao: string) => mock.invoke.mock.calls.filter((c) => c[1] && c[1].body && c[1].body.acao === acao);

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, { initialEntries: ["/clientes"] }, h(ConfirmDialogProvider, null, h(TooltipProvider, null, h(Clients))))));
}

beforeEach(() => {
  window.localStorage.clear();
  mock.invoke.mockReset();
  mock.invoke.mockImplementation((_f: string, { body }: any) => {
    if (body.acao === "criar") return Promise.resolve({ data: { proposta: { id: "22222222-2222-4222-8222-222222222222", numero: "2026-020" }, custo_usd: 0 }, error: null });
    return Promise.resolve({ data: {}, error: null });
  });
});

async function abrirItem(rotulo: string) {
  fireEvent.click(await screen.findByRole("button", { name: "Mais ações de Loja da Joana" }));
  const menu = await screen.findByRole("menu");
  fireEvent.click(within(menu).getByRole("menuitem", { name: rotulo }));
}

describe("o ... da linha de Clientes abre a janela única de Nova proposta", () => {
  it("Nova proposta...: a janela abre com o cliente fixo (Venda nova e Upsell) e não cria nada sozinha", async () => {
    montar();
    await abrirItem("Nova proposta...");
    const janela = await screen.findByRole("dialog", { name: /Nova proposta/ });
    expect(chamadasDe("criar")).toHaveLength(0);
    expect(within(janela).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Venda nova", "Upsell"]);
    expect(within(janela).getByRole("tab", { name: "Venda nova" }).getAttribute("aria-selected")).toBe("true");
    expect(within(janela).queryByLabelText("Cliente da proposta")).toBeNull();
    // Projeto e modelo, como em todo lugar.
    expect(within(janela).getByLabelText("Projeto")).toBeTruthy();
    fireEvent.change(within(janela).getByLabelText("Projeto"), { target: { value: "Site novo" } });
    fireEvent.click(within(janela).getByRole("button", { name: /^Criar proposta$/ }));
    await waitFor(() => expect(chamadasDe("criar")).toHaveLength(1));
    expect(chamadasDe("criar")[0][1].body).toMatchObject({ client_id: CLIENTE, titulo: "Site novo" });
  });

  it("Proposta de upsell...: a mesma janela, já no Upsell", async () => {
    montar();
    await abrirItem("Proposta de upsell...");
    const janela = await screen.findByRole("dialog", { name: /Nova proposta/ });
    expect(chamadasDe("criar")).toHaveLength(0);
    expect(within(janela).getByRole("tab", { name: "Upsell" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(within(janela).getByRole("button", { name: "Criar proposta de upsell" }));
    await waitFor(() => expect(chamadasDe("criar")).toHaveLength(1));
    expect(chamadasDe("criar")[0][1].body).toMatchObject({ client_id: CLIENTE, tipo: "upsell" });
  });
});
