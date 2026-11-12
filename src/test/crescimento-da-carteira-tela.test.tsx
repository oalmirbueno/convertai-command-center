import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createElement as h } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const clientes = [
  { id: "a", company_name: "SKC", created_at: "2026-02-10T12:00:00Z", client_type: "recurring", plan_status: "active", services_config: {} },
  { id: "b", company_name: "Verzelo", created_at: "2026-07-03T12:00:00Z", client_type: "hybrid", plan_status: "active", services_config: {} },
  { id: "c", company_name: "Prix", created_at: "2026-11-05T12:00:00Z", client_type: "hybrid", plan_status: "active", services_config: {} },
  { id: "d", company_name: "Avulso X", created_at: "2026-09-05T12:00:00Z", client_type: "one_off", plan_status: "inactive", services_config: {} },
  { id: "i", company_name: "Aceleriq", created_at: "2026-02-01T12:00:00Z", client_type: "recurring", plan_status: "active", services_config: { internal_company: true } },
];
vi.mock("@/hooks/useSupabaseData", () => ({ useClients: () => ({ data: clientes, isLoading: false, isError: false, refetch: () => undefined }) }));
vi.mock("@/integrations/supabase/client", () => {
  const linhas: Record<string, unknown[]> = {
    billing: [{ client_id: "a", amount: 850, paid_amount: null, paid_date: "2026-03-04", currency: "BRL" }, { client_id: "b", amount: 500, paid_amount: 480, paid_date: "2026-11-09", currency: "BRL" }, { client_id: "b", amount: 100, paid_date: "2026-11-09", currency: "USD" }],
    payment_installments: [{ amount: 1920, paid_amount: null, paid_date: "2026-05-10", pagamento: { client_id: "a" } }],
  };
  const cadeia = (t: string) => { const c: any = { select: () => c, eq: () => c, not: () => c, limit: () => Promise.resolve({ data: linhas[t], error: null }) }; return c; };
  return { supabase: { from: (t: string) => cadeia(t) } };
});

(globalThis as any).ResizeObserver = (globalThis as any).ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };

import ConteudoDoCrescimento from "@/components/clientes/CrescimentoDaCarteira";

describe("janela do crescimento da carteira", () => {
  it("abre sem travar, mostra os números, os destaques e a lista de quem entrou", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(h(QueryClientProvider, { client: qc }, h(ConteudoDoCrescimento)));
    expect(screen.getByText("Clientes ativos hoje")).toBeTruthy();
    expect(screen.getByText("4 já passaram pela Aceleriq")).toBeTruthy();
    expect((await screen.findAllByText(/R\$\s?480/)).length).toBeGreaterThan(0);
    expect(document.querySelector('[data-destaque="Maior faturamento"]')?.textContent).toContain("maio de 2026");
    const linha = screen.getByRole("button", { name: /novembro de 2026/ });
    expect(linha.textContent).toContain("Prix");
    fireEvent.click(linha);
    expect(document.querySelector("[data-quem-entrou]")?.textContent).toContain("Prix (Híbrido)");
    fireEvent.click(screen.getByText("Por semana"));
    expect(document.querySelector("[data-total-do-periodo]")?.textContent).toContain("entrada");
  }, 20000);
});
