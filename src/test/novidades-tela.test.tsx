import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import Novidades from "@/pages/Novidades";
import { RELEASE_NOTES } from "@/lib/releaseNotes";

/** A tela /novidades: o cliente nunca vê entrada da equipe; a equipe filtra pelo público. */
const auth = vi.hoisted(() => ({ atual: { user: { id: "u" }, profile: { role: "client" } as { role: string } | null, loading: false } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth.atual }));

function montar() {
  return render(
    <MemoryRouter>
      <Novidades />
    </MemoryRouter>,
  );
}

const daEquipe = RELEASE_NOTES.filter((e) => e.publico === "equipe");
const doCliente = RELEASE_NOTES.filter((e) => e.publico === "cliente");

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("Tela de Novidades", () => {
  it("cliente: só entradas do cliente, sem seletor e sem chip de público", () => {
    auth.atual = { user: { id: "u" }, profile: { role: "client" }, loading: false };
    const { container } = montar();
    expect(container.querySelectorAll("[data-novidade]").length).toBeGreaterThan(0);
    const ids = Array.from(container.querySelectorAll("[data-novidade]")).map((el) => el.getAttribute("data-novidade"));
    for (const e of daEquipe) expect(ids).not.toContain(e.id);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByText("Da equipe")).toBeNull();
  });

  it("carregando o perfil: esqueleto, nada de entrada", () => {
    auth.atual = { user: null as never, profile: null, loading: true };
    const { container } = montar();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelectorAll("[data-novidade]").length).toBe(0);
  });

  it("admin: seletor Todas, Para clientes e Da equipe com as contagens", () => {
    auth.atual = { user: { id: "u" }, profile: { role: "admin" }, loading: false };
    montar();
    const abas = screen.getAllByRole("tab");
    expect(abas.map((a) => a.textContent)).toEqual([
      `Todas${RELEASE_NOTES.length}`,
      `Para clientes${doCliente.length}`,
      `Da equipe${daEquipe.length}`,
    ]);
    fireEvent.click(abas[1]);
    const ids = Array.from(document.querySelectorAll("[data-novidade]")).map((el) => el.getAttribute("data-novidade"));
    for (const e of daEquipe) expect(ids).not.toContain(e.id);
  });
});
