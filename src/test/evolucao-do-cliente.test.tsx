import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Painel de evolução (17/10): a tabela por mês do cliente escolhido, com a taxa de
 * aprovadas de primeira, rodadas, múltiplo dos posts e custo por resultado dos anúncios.
 */

const m = vi.hoisted(() => ({ chamar: vi.fn() }));
vi.mock("@/lib/mesa/api", async (orig) => ({ ...(await orig<typeof import("@/lib/mesa/api")>()), chamarFuncao: m.chamar }));

import EvolucaoDoCliente from "@/components/base-dos-agentes/EvolucaoDoCliente";

const vazio = { decididas: 0, aprovadasDePrimeira: 0, taxaDePrimeira: null, rodadasMedia: null, posts: 0, multiploMedio: null, custoPorResultado: null, resultadosAds: 0 };

function montar(clientes = [{ id: "c1", nome: "Acerbi" }, { id: "c2", nome: "CME" }]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <EvolucaoDoCliente clientes={clientes} />
    </QueryClientProvider>,
  );
}

describe("EvolucaoDoCliente", () => {
  beforeEach(() => {
    m.chamar.mockReset();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("mostra uma linha por mês com a taxa de primeira, rodadas, posts e ads", async () => {
    m.chamar.mockResolvedValue({
      ok: true,
      meses: [
        { mes: "2026-09", ...vazio, decididas: 4, aprovadasDePrimeira: 1, taxaDePrimeira: 0.25, rodadasMedia: 2.333, posts: 2, multiploMedio: 0.9 },
        { mes: "2026-10", ...vazio, decididas: 5, aprovadasDePrimeira: 4, taxaDePrimeira: 0.8, rodadasMedia: 1.2, posts: 3, multiploMedio: 1.42, custoPorResultado: 12.5, resultadosAds: 8 },
      ],
    });
    montar();
    await waitFor(() => expect(screen.getByText("out/26")).toBeTruthy());
    expect(m.chamar).toHaveBeenCalledWith("base-dos-agentes", { acao: "evolucao", client_id: "c1" });

    const linhas = screen.getAllByRole("row").slice(1);
    expect(linhas.map((l) => l.getAttribute("data-mes"))).toEqual(["2026-09", "2026-10"]);
    const out = within(linhas[1]);
    expect(out.getByText("4 de 5 (80%)")).toBeTruthy();
    expect(out.getByText("1,2")).toBeTruthy();
    expect(linhas[1].textContent).toContain("3 posts · 1,4x");
    expect(linhas[1].textContent).toContain("12,50 · 8 resultados");
    const set = within(linhas[0]);
    expect(set.getByText("1 de 4 (25%)")).toBeTruthy();
    expect(set.getByText("2,3")).toBeTruthy();
    // A barrinha acompanha a taxa.
    expect((linhas[1].querySelector("[style]") as HTMLElement).style.width).toBe("80%");
  });

  it("sem nenhum dado no período mostra o vazio, não a tabela", async () => {
    m.chamar.mockResolvedValue({ ok: true, meses: [{ mes: "2026-09", ...vazio }, { mes: "2026-10", ...vazio }] });
    montar();
    await waitFor(() => expect(screen.getByText("Sem dados nos últimos 6 meses.")).toBeTruthy());
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("sem cliente não chama a função", () => {
    montar([]);
    expect(screen.getByText("Nenhum cliente.")).toBeTruthy();
    expect(m.chamar).not.toHaveBeenCalled();
  });
});
