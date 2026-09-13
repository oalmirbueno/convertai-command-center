import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import SettingsPage from "@/pages/SettingsPage";

vi.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ theme: "dark", setTheme: vi.fn() }) }));
vi.mock("@/components/NotificationsPanel", () => ({
  default: ({ open, onOpenChange }: { open: boolean; onOpenChange: (value: boolean) => void }) => open
    ? <div role="dialog" aria-label="Notificações"><button onClick={() => onOpenChange(false)}>Fechar avisos</button></div>
    : null,
}));
afterEach(cleanup);

describe("Configuracoes: acoes disponiveis", () => {
  it("Seguranca abre o perfil, onde existe a alteracao de senha", () => {
    render(<MemoryRouter initialEntries={["/configuracoes"]}><Routes>
      <Route path="/configuracoes" element={<SettingsPage />} />
      <Route path="/perfil" element={<p>Perfil e senha</p>} />
    </Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Segurança/ }));
    expect(screen.getByText("Perfil e senha")).toBeInTheDocument();
  });

  it("Notificacoes abre e fecha o painel existente", () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Notificações/ }));
    expect(screen.getByRole("dialog", { name: "Notificações" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Fechar avisos" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
