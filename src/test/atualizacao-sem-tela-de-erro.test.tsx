import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * PERF-B14 (30/09/2026): depois de uma publicação, o clique no menu pede um
 * pedaço que a hospedagem já apagou. A recuperação dispara a recarga, mas até
 * ela sair a tela aberta quebra (o import devolve nada) e aparecia "Algo
 * travou nesta tela" com um TypeError. Com a recarga a caminho, a barreira da
 * rota mostra o mesmo aviso neutro do AppErrorBoundary.
 */

const estado = vi.hoisted(() => ({ atualizando: false }));

vi.mock("@/lib/appRefresh", async (original) => {
  const real = await original<typeof import("@/lib/appRefresh")>();
  return { ...real, atualizandoPorVersao: () => estado.atualizando };
});

import RouteErrorBoundary from "@/components/RouteErrorBoundary";

function TelaQueQuebra(): JSX.Element {
  // O que o React vê quando o import() da tela devolve nada.
  throw new TypeError("Cannot read properties of undefined (reading 'default')");
}

function montar() {
  return render(
    <MemoryRouter initialEntries={["/aprovacoes"]}>
      <RouteErrorBoundary>
        <TelaQueQuebra />
      </RouteErrorBoundary>
    </MemoryRouter>,
  );
}

describe("barreira da rota durante a atualização de versão", () => {
  afterEach(() => {
    estado.atualizando = false;
    vi.restoreAllMocks();
  });

  it("com a recarga a caminho, mostra só o aviso neutro", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    estado.atualizando = true;
    montar();
    expect(screen.getByText("Atualizando o painel...")).toBeInTheDocument();
    expect(screen.getByText("Uma versão nova acabou de sair. Só um instante.")).toBeInTheDocument();
    expect(screen.queryByText("Algo travou nesta tela")).toBeNull();
    expect(screen.queryByText(/Detalhe técnico/)).toBeNull();
  });

  it("fora da atualização, o erro de tela continua com a tela de sempre", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    montar();
    expect(screen.getByText("Algo travou nesta tela")).toBeInTheDocument();
    expect(screen.getByText(/Detalhe técnico/)).toBeInTheDocument();
    expect(screen.queryByText("Atualizando o painel...")).toBeNull();
  });
});
