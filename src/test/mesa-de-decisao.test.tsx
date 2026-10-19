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

  /* 19/10/2026 (dono: "tem coisas ficando rodando, rodando, não aprova"): os botões do cartão
     travado (Pode seguir, Concluir, Encerrar) rodavam fora da mesa e o cartão ficava na tela até a
     próxima leitura. Agora rodam pela mesa: mostram que estão salvando e o cartão sai na hora. */
  it("ação que resolve (Pode seguir, Concluir) mostra que está salvando e tira o cartão na hora", async () => {
    vi.useFakeTimers();
    try {
      let terminar: (ok: boolean) => void = () => undefined;
      const seguir = vi.fn(() => new Promise<boolean>((r) => { terminar = r; }));
      const concluir = vi.fn().mockResolvedValue(true);
      render(<MesaDeDecisao rotulo="Mesa" onDecidir={vi.fn()} itens={[
        item("a", { podeAjuste: false, podeRejeitar: false, acaoPrincipal: { rotulo: "Pode seguir", aoClicar: seguir }, acoes: [{ rotulo: "Concluir", aoClicar: concluir }] }),
        item("b"),
      ]} />);
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Pode seguir/ })); });
      expect(seguir).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: /Pode seguir/ }).getAttribute("aria-busy")).toBe("true");
      // Enquanto salva, nada mais dispara.
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Concluir/ })); });
      expect(concluir).not.toHaveBeenCalled();
      await act(async () => { terminar(true); });
      await act(async () => { vi.advanceTimersByTime(250); });
      expect(screen.queryByText("Título a")).toBeNull();
      expect(screen.getByText("Título b")).toBeTruthy();
    } finally { vi.useRealTimers(); }
  });

  it("ação extra pela mesa: Concluir resolve e o cartão sai; falhou, o cartão fica", async () => {
    vi.useFakeTimers();
    try {
      const concluir = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      render(<MesaDeDecisao rotulo="Mesa" onDecidir={vi.fn()} itens={[item("a", { acoes: [{ rotulo: "Concluir", aoClicar: concluir }] }), item("b")]} />);
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Concluir/ })); });
      await act(async () => { vi.advanceTimersByTime(250); });
      expect(screen.getByText("Título a")).toBeTruthy();
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Concluir/ })); });
      await act(async () => { vi.advanceTimersByTime(250); });
      expect(concluir).toHaveBeenCalledTimes(2);
      expect(screen.queryByText("Título a")).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("nunca fica girando para sempre: sem resposta em 20 s, solta o botão e avisa", async () => {
    vi.useFakeTimers();
    try {
      const onDecidir = vi.fn(() => new Promise<boolean>(() => undefined));
      render(<MesaDeDecisao rotulo="Mesa" itens={[item("a")]} onDecidir={onDecidir} />);
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Aprovar/ })); });
      expect((screen.getByRole("button", { name: /Aprovar/ }) as HTMLButtonElement).disabled).toBe(true);
      await act(async () => { vi.advanceTimersByTime(20_500); });
      expect((screen.getByRole("button", { name: /Aprovar/ }) as HTMLButtonElement).disabled).toBe(false);
      expect(screen.getByText(/demorou para responder/i)).toBeTruthy();
      expect(screen.getByText("Título a")).toBeTruthy();
    } finally { vi.useRealTimers(); }
  });

  /* 19/10/2026 (dono: "eu respondo e já resolvo ali mesmo, sem precisar ir para outro lugar"): o
     cartão travado responde no próprio cartão, com o campo e as sugestões, ao lado do Pode seguir. */
  it("travado: Responder abre o campo no próprio cartão e envia a resposta", async () => {
    const onDecidir = vi.fn().mockResolvedValue(true);
    render(<MesaDeDecisao rotulo="Mesa" onDecidir={onDecidir} itens={[item("a", {
      podeAjuste: true, podeRejeitar: false, rotuloAjuste: "Enviar resposta",
      textosDoAjuste: { botao: "Responder", campo: "Sua resposta ao agente" },
      sugestoesAjuste: ["Já liberei o acesso, pode tentar de novo"],
      acaoPrincipal: { rotulo: "Pode seguir", aoClicar: vi.fn() },
    })]} />);
    expect(screen.queryByRole("button", { name: /Rejeitar/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Responder/ }));
    expect(screen.getByText("Sua resposta ao agente")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Já liberei o acesso, pode tentar de novo" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar resposta" }));
    await waitFor(() => expect(onDecidir).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }), "ajuste", "Já liberei o acesso, pode tentar de novo"));
  });

  /* 19/10/2026 (dono: "ficar em tela cheia ali na área de Precisa de você, para focar em aprovar"). */
  it("tela cheia: só a mesa na tela; Esc volta", () => {
    render(<MesaDeDecisao rotulo="Mesa" itens={[item("a"), item("b")]} onDecidir={vi.fn()} />);
    expect(document.querySelector("[data-mesa-em-foco]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tela cheia" }));
    expect(document.querySelector("[data-mesa-em-foco]")).toBeTruthy();
    expect(screen.getByText("Título a")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.querySelector("[data-mesa-em-foco]")).toBeNull();
  });
});
