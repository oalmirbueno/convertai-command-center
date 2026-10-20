import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { FocoDeEstudo, BotaoPomodoro } from "@/components/membros/FocoDeEstudo";
function montar(usuario = "pessoa") {
  return render(
    <FocoDeEstudo key={usuario} usuario={usuario}>
      <BotaoPomodoro />
    </FocoDeEstudo>,
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-20T18:00:00Z"));
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("estudo com Pomodoro", () => {
  it("mantém o prazo ao fechar o relógio e volta sem perder segundos", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Abrir Pomodoro" }));
    fireEvent.click(screen.getByRole("button", { name: "Começar" }));
    act(() => vi.advanceTimersByTime(61000));
    expect(screen.getByRole("timer")).toHaveTextContent("23:59");
    fireEvent.click(screen.getByRole("button", { name: "Pausar" }));
    act(() => vi.advanceTimersByTime(30000));
    expect(screen.getByRole("timer")).toHaveTextContent("23:59");
  });
  it("retoma após recarregar sem somar uma sessão que não terminou", () => {
    const m = montar();
    fireEvent.click(screen.getByRole("button", { name: "Abrir Pomodoro" }));
    fireEvent.click(screen.getByRole("button", { name: "Começar" }));
    m.unmount();
    act(() => vi.advanceTimersByTime(90000));
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Abrir Pomodoro" }));
    expect(screen.getByRole("timer")).toHaveTextContent("23:30");
    expect(
      screen.getByText("0 sessões de foco concluídas neste navegador"),
    ).toBeInTheDocument();
  });
  it("contabiliza uma sessão concluída uma vez e sugere pausa", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Abrir Pomodoro" }));
    fireEvent.click(screen.getByRole("button", { name: "Começar" }));
    act(() => vi.advanceTimersByTime(1500000));
    expect(screen.getByRole("timer")).toHaveTextContent("05:00");
    expect(
      screen.getByText("1 sessões de foco concluídas neste navegador"),
    ).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(15000));
    expect(
      screen.getByText("1 sessões de foco concluídas neste navegador"),
    ).toBeInTheDocument();
  });
  it("isola o relógio por conta e ignora dados locais inválidos", () => {
    localStorage.setItem(
      "membros:foco:pessoa",
      JSON.stringify({
        etapa: "toString",
        restante: 10,
        termina: null,
        sessoes: 12,
      }),
    );
    const m = montar();
    fireEvent.click(screen.getByRole("button", { name: "Abrir Pomodoro" }));
    expect(screen.getByRole("timer")).toHaveTextContent("25:00");
    fireEvent.click(screen.getByRole("button", { name: "Começar" }));
    act(() => vi.advanceTimersByTime(60000));
    m.unmount();
    montar("outra");
    fireEvent.click(screen.getByRole("button", { name: "Abrir Pomodoro" }));
    expect(screen.getByRole("timer")).toHaveTextContent("25:00");
  });
});
