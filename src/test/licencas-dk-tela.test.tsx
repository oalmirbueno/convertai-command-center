import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

/** Financeiro › Licenças DK: os números do mês e a lista vêm das linhas gravadas, e o botão pede a sincronização. */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(async () => ({ data: { ok: true, gravados: 1, licencas: 1 }, error: null })),
  linhas: [
    { asaas_pagamento_id: "pay_1", forma: "PIX", situacao: "recebido", bruto: "597.00", liquido: "595.01", taxa: "1.99", recebido_em: "2026-11-05", pago_em: "2026-11-05", referencia: "LIC1", descricao: "" },
    { asaas_pagamento_id: "pay_2", forma: "CREDIT_CARD", situacao: "confirmado", bruto: "397.00", liquido: "378.66", taxa: "18.34", recebido_em: "2026-11-20", pago_em: "2026-11-06", referencia: "LIC2", descricao: "" },
    { asaas_pagamento_id: "pay_3", forma: "PIX", situacao: "estornado", bruto: "397.00", liquido: "395.01", taxa: "1.99", recebido_em: "2026-11-08", pago_em: "2026-11-08", referencia: "LIC3", descricao: "" },
    { asaas_pagamento_id: "pay_4", forma: "PIX", situacao: "recebido", bruto: "397.00", liquido: "395.01", taxa: "1.99", recebido_em: "2026-10-30", pago_em: "2026-10-30", referencia: "LIC4", descricao: "" },
  ],
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const b: any = {};
    for (const m of ["select", "eq", "order", "limit"]) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve({ data: { ultima_sincronizacao: "2026-11-19T20:00:00Z", ultimo_erro: null }, error: null });
    b.then = (ok: any, erro: any) => Promise.resolve({ data: tabela === "licencas_dk_pagamentos" ? mock.linhas : [], error: null }).then(ok, erro);
    return b;
  };
  return { supabase: { from: (t: string) => consulta(t), functions: { invoke: mock.invoke } } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import LicencasDk from "@/components/finance/LicencasDk";

const sp = (t: string) => t.replace(/\s+/g, " ").trim();
/** Casa o texto do valor ignorando o tipo de espaço depois do R$. */
const brl = (v: number) => (conteudo: string, el: Element | null) => !!el && el.children.length === 0 && sp(conteudo) === sp(v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

describe("Licenças DK na tela", () => {
  it("mostra bruto, taxas e líquido do mês mais recente, sem o estorno, e a lista do mês", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <LicencasDk />
      </QueryClientProvider>,
    );
    const cartoes = await screen.findByRole("group", { name: "Licenças DK no mês" }).catch(() => null);
    const area = cartoes ? within(cartoes) : screen;
    await waitFor(() => expect(area.getAllByText(brl(994)).length).toBeGreaterThan(0));
    expect(area.getAllByText(brl(20.33)).length).toBeGreaterThan(0);
    expect(area.getAllByText(brl(973.67)).length).toBeGreaterThan(0);
    const lista = screen.getByRole("table", { name: "Pagamentos de licença" });
    expect(within(lista).getAllByRole("row")).toHaveLength(4); // cabeçalho + 3 de novembro (o estorno aparece na lista)
    expect(within(lista).getByText("Estornado")).toBeTruthy();
    expect(within(lista).getByText("Cartão de crédito")).toBeTruthy();
    const meses = screen.getByRole("table", { name: "Licenças DK por mês" });
    expect(within(meses).getByText(brl(395.01))).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Sincronizar com o Asaas" }));
    await waitFor(() => expect(mock.invoke).toHaveBeenCalledWith("licencas-dk-sync", { body: { acao: "sincronizar", completo: false } }));
  });
});
