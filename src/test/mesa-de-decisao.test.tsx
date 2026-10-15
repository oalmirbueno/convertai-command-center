import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import MesaDeDecisao, { type ItemDaMesa } from "@/components/decisao/MesaDeDecisao";

/**
 * Mesa de decisão (15/10/2026): um item por vez; decidiu, entra o próximo.
 * Ajuste exige dizer o quê; atalhos de teclado; e nunca some sem o servidor confirmar.
 */
const item = (id: string, extra: Partial<ItemDaMesa> = {}): ItemDaMesa => ({ id, tipo: "Post no ar", cliente: "Mirante", titulo: `Título ${id}`, mensagem: `Mensagem ${id}`, podeAjuste: true, podeRejeitar: true, ...extra });

describe("mesa de decisão", () => {
  it("mostra um por vez e, aprovado, entra o próximo", async () => {
    vi.useFakeTimers();
    try {
      const onDecidir = vi.fn().mockResolvedValue(true);
      render(<MesaDeDecisao rotulo="Mesa" itens={[item("a"), item("b")]} onDecidir={onDecidir} />);
      expect(screen.getByText("Título a")).toBeTruthy();
      expect(screen.queryByText("Título b")).toBeNull();
      expect(screen.getByText("1 de 2")).toBeTruthy();
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Aprovar/ })); });
      expect(onDecidir).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }), "aprovado", "");
      await act(async () => { vi.advanceTimersByTime(250); });
      expect(screen.getByText("Título b")).toBeTruthy();
      expect(screen.getByText("1 de 1")).toBeTruthy();
    } finally { vi.useRealTimers(); }
  });

  it("se o servidor recusa, o cartão fica", async () => {
    const onDecidir = vi.fn().mockResolvedValue(false);
    render(<MesaDeDecisao rotulo="Mesa" itens={[item("a"), item("b")]} onDecidir={onDecidir} />);
    fireEvent.click(screen.getByRole("button", { name: /Aprovar/ }));
    await waitFor(() => expect(onDecidir).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 250));
    expect(screen.getByText("Título a")).toBeTruthy();
  });

  it("ajuste pede o quê; sugestões preenchem; envia com a nota", async () => {
    const onDecidir = vi.fn().mockResolvedValue(true);
    render(<MesaDeDecisao rotulo="Mesa" itens={[item("a")]} onDecidir={onDecidir} />);
    fireEvent.click(screen.getByRole("button", { name: /Ajuste/ }));
    const enviar = screen.getByRole("button", { name: "Pedir ajuste" }) as HTMLButtonElement;
    expect(enviar.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Texto mais curto" }));
    expect(enviar.disabled).toBe(false);
    fireEvent.click(enviar);
    await waitFor(() => expect(onDecidir).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }), "ajuste", "Texto mais curto"));
  });

  it("bloqueio de aprovar desliga o botão e diz o motivo", () => {
    render(<MesaDeDecisao rotulo="Mesa" itens={[item("a", { bloqueioDeAprovar: "Falta o próximo passo" })]} onDecidir={vi.fn()} />);
    expect((screen.getByRole("button", { name: /Aprovar/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Falta o próximo passo")).toBeTruthy();
  });

  it("teclado: seta passa, E abre o ajuste; vazio diz tudo decidido", () => {
    const { rerender } = render(<MesaDeDecisao rotulo="Mesa" itens={[item("a"), item("b")]} onDecidir={vi.fn()} />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("Título b")).toBeTruthy();
    fireEvent.keyDown(window, { key: "e" });
    expect(screen.getByRole("button", { name: "Pedir ajuste" })).toBeTruthy();
    rerender(<MesaDeDecisao rotulo="Mesa" itens={[]} onDecidir={vi.fn()} vazio="Nada agora." />);
    expect(screen.getByText("Tudo decidido")).toBeTruthy();
  });

  it("abre direto no item do link", () => {
    render(<MesaDeDecisao rotulo="Mesa" itens={[item("a"), item("b")]} onDecidir={vi.fn()} inicialId="b" />);
    expect(screen.getByText("Título b")).toBeTruthy();
    expect(screen.getByText("2 de 2")).toBeTruthy();
  });
  it("sem o que aprovar, o botão principal faz a ação (Responder) e não decide nada", () => {
    const responder = vi.fn();
    const onDecidir = vi.fn();
    render(<MesaDeDecisao rotulo="Mesa" itens={[item("a", { podeAjuste: false, podeRejeitar: false, acaoPrincipal: { rotulo: "Responder", aoClicar: responder } })]} onDecidir={onDecidir} />);
    expect(screen.queryByRole("button", { name: /Aprovar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Rejeitar/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Responder/ }));
    fireEvent.keyDown(window, { key: "a" });
    expect(responder).toHaveBeenCalledTimes(2);
    expect(onDecidir).not.toHaveBeenCalled();
  });
});
