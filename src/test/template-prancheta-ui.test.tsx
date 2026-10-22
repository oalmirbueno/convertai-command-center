import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({ chamar: vi.fn() }));
vi.mock("@/lib/mesa/api", () => ({ chamarFuncao: (...args: unknown[]) => estado.chamar(...args), textoDoErro: (e: Error) => e.message }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import AcoesDoPostNaPrancheta from "@/components/mesa/profile/AcoesDoPostNaPrancheta";

function montar(total = 3) {
  const onMudou = vi.fn(), onEscolher = vi.fn();
  render(<QueryClientProvider client={new QueryClient()}><AcoesDoPostNaPrancheta trabalhoId="t" clientId="c" ordem={2} total={total} bloqueado={false} onMudou={onMudou} onEscolher={onEscolher} /></QueryClientProvider>);
  return { onMudou, onEscolher };
}
beforeEach(() => { estado.chamar.mockReset().mockResolvedValue({ trabalho: { id: "t" }, ordem: 3 }); });

describe("Template · X: os posts do fio nos cards da prancheta", () => {
  it("adiciona e duplica sem custo e abre o post novo", async () => {
    const { onMudou, onEscolher } = montar();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar post depois do 2" }));
    await waitFor(() => expect(onEscolher).toHaveBeenCalledWith(3));
    expect(estado.chamar).toHaveBeenCalledWith("estudio-arte", { acao: "template_lamina", trabalho_id: "t", ordem: 2, operacao: "adicionar" });
    expect(onMudou).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Duplicar post 2" }));
    await waitFor(() => expect(estado.chamar).toHaveBeenCalledTimes(2));
    expect(estado.chamar.mock.calls[1][1]).toMatchObject({ operacao: "duplicar" });
  });
  it("tirar pede o segundo clique e o último post não sai", async () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Tirar post 2" }));
    expect(estado.chamar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar: tirar post 2" }));
    await waitFor(() => expect(estado.chamar).toHaveBeenCalledOnce());
    expect(estado.chamar.mock.calls[0][1]).toMatchObject({ operacao: "tirar" });
  });
  it("com um post só, tirar fica desligado", () => {
    montar(1);
    expect(screen.getByRole("button", { name: "Tirar post 2" })).toBeDisabled();
  });
});
