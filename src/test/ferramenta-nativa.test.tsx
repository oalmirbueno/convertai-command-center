import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

// As páginas reais são pesadas: no teste, cada rota nativa vira uma página falsa que mostra o endereço dela.
vi.mock("@/lib/mesa/preCarga", () => {
  const Falsa = () => {
    const local = useLocation();
    const [busca] = useSearchParams();
    const navegar = useNavigate();
    return (
      <div>
        <p data-testid="dentro">{local.pathname}{local.search}</p>
        <p data-testid="cliente">{busca.get("client")}</p>
        <button type="button" onClick={() => navegar("/mesa?client=c1&aba=mes")}>Ir para o mês</button>
        <button type="button" onClick={() => navegar("/dashboard")}>Ir para fora</button>
      </div>
    );
  };
  const nomes = ["PaginaMesaAds", "PaginaMesaDoCliente", "PaginaMesaEdicao", "PaginaMesaFoto", "PaginaMesaIdentidade", "PaginaMesaMotion", "PaginaMesaProposta", "PaginaMesaPublicidade", "PaginaMesaRoteiros", "PaginaMesaSite", "PaginaMesaVideos"];
  return { ...Object.fromEntries(nomes.map((n) => [n, Falsa])), preCarregarMesa: vi.fn() };
});

import FerramentaNativa, { abreNativo } from "@/components/execucao/central/FerramentaNativa";

function DoApp() {
  const l = useLocation();
  return <p data-testid="app">{l.pathname}{l.search}</p>;
}

function montar(caminho: string) {
  return render(
    <MemoryRouter initialEntries={["/execucao?aba=central"]}>
      <Routes>
        <Route path="/execucao" element={<><DoApp /><FerramentaNativa caminho={caminho} abertoEm={performance.now()} /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ferramenta nativa na Central (sem iframe, sem subir o app de novo)", () => {
  it("abre a página com o cliente da conversa, navega por dentro e não mexe no endereço da Central", async () => {
    montar("/mesa?client=c1");
    expect((await screen.findByTestId("dentro")).textContent).toBe("/mesa?client=c1");
    expect(screen.getByTestId("cliente").textContent).toBe("c1");
    fireEvent.click(screen.getByRole("button", { name: "Ir para o mês" }));
    expect((await screen.findByTestId("dentro")).textContent).toBe("/mesa?client=c1&aba=mes");
    // O endereço do app continua o da Central.
    expect(screen.getByTestId("app").textContent).toBe("/execucao?aba=central");
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("endereço que não abre na Central oferece aba nova, sem sair da conversa", async () => {
    montar("/mesa-ads?client=c1");
    fireEvent.click(await screen.findByRole("button", { name: "Ir para fora" }));
    expect(await screen.findByText("Esta parte do painel abre fora da Central.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Abrir em aba nova/ }).getAttribute("href")).toBe("/dashboard");
    expect(screen.getByTestId("app").textContent).toBe("/execucao?aba=central");
  });

  it("sabe quais endereços abrem nativos", () => {
    expect(abreNativo("/mesa?client=c1")).toBe(true);
    expect(abreNativo("/workspace?client=c1")).toBe(true);
    expect(abreNativo("/comercial/crm")).toBe(true);
    expect(abreNativo("/dashboard")).toBe(false);
  });
});
