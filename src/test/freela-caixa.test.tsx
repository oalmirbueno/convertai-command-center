import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/** Caixa do freela na tela: real e dólar em cartões separados, sem soma nem conversão. */
const hoje = "2026-11-03";

vi.mock("@/lib/freela/freelaLib", async (orig) => ({
  ...(await orig<typeof import("@/lib/freela/freelaLib")>()),
  hojeISO: () => hoje,
}));

const parcela = (id: string, valor: number, moeda: string, status: string, vencimento: string, pago_em: string | null = null) => ({
  id, projeto_id: "p1", numero: 1, valor, moeda, status, vencimento, pago_em, description: null,
});

vi.mock("@/components/freela/dadosFreela", () => ({
  useFreelaParcelas: () => ({
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    data: [
      parcela("a", 1000, "BRL", "aberta", "2026-12-01"),
      parcela("b", 200, "BRL", "aberta", "2026-10-01"),
      parcela("c", 300, "BRL", "paga", "2026-11-01", "2026-11-02"),
      parcela("d", 70, "USD", "aberta", "2026-12-01"),
      parcela("e", 11, "USD", "aberta", "2026-10-01"),
      parcela("f", 5, "USD", "paga", "2026-11-01", "2026-11-02"),
      parcela("g", 9999, "USD", "cancelada", "2026-12-01"),
    ],
  }),
  useFreelaProjetos: () => ({ data: [{ id: "p1", titulo: "Site", contato_id: "c1" }] }),
  useFreelaContatos: () => ({ data: [{ id: "c1", nome: "Ana" }] }),
}));

import AbaCaixa from "@/components/freela/AbaCaixa";

afterEach(cleanup);

const semEspaco = (t: string | null) => (t || "").replace(/\s/g, " ");

describe("Caixa do freela", () => {
  it("cada moeda tem a sua faixa, com aberto, atrasado e recebido no mês", () => {
    const { container } = render(<MemoryRouter><AbaCaixa /></MemoryRouter>);
    const texto = semEspaco(container.textContent);
    expect(screen.getByLabelText("Caixa em real (R$)")).toBeTruthy();
    expect(screen.getByLabelText("Caixa em dólar (US$)")).toBeTruthy();
    expect(texto).toContain("R$ 1.000,00");
    expect(texto).toContain("R$ 200,00");
    expect(texto).toContain("R$ 300,00");
    expect(texto).toContain("US$ 70,00");
    expect(texto).toContain("US$ 11,00");
    expect(texto).toContain("US$ 5,00");
  });

  it("nunca soma as moedas: não aparece nenhum total misturado", () => {
    const { container } = render(<MemoryRouter><AbaCaixa /></MemoryRouter>);
    const texto = semEspaco(container.textContent);
    expect(texto).not.toContain("1.070,00");
    expect(texto).not.toContain("211,00");
    expect(texto).not.toContain("305,00");
  });
});
