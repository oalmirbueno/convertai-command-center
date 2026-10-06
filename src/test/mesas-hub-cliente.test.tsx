import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import Mesas from "@/pages/Mesas";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" } }) }));
vi.mock("@/hooks/useSupabaseData", () => ({ useClients: () => ({ data: [{ id: "cliente", company_name: "Para Si Ótica", full_name: "Responsável" }] }) }));
vi.mock("@/lib/mesa/preCarga", () => ({ propsDePreCarga: () => ({}) }));
vi.mock("@/components/mesa/SeletorDeClientesDaMesa", () => ({ default: ({ nome }: { nome: string }) => <span>{nome}</span> }));

describe("Hub Mesas com perfil real", () => {
  it("exibe o nome comercial e mantém o cliente nos links", () => {
    render(<MemoryRouter initialEntries={["/mesas?client=cliente"]}><Mesas /></MemoryRouter>);
    expect(screen.getByText("Para Si Ótica")).toBeVisible();
    expect(screen.getAllByText("Abrir para Para Si Ótica").length).toBeGreaterThan(5);
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
    for (const link of screen.getAllByRole("link")) expect(link.getAttribute("href")).toContain("client=cliente");
  });
});
