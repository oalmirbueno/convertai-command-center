import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() } } }));

import { toast } from "sonner";
import CartaoDeAcao, { CapacidadesDoAgente, OQuePossoFazer } from "@/components/agentes/CartaoDeAcao";
import type { AcaoDoAgente } from "@/lib/agentes/acoesDoAgente";

/**
 * Cartão genérico da ação proposta por um agente: a lista exata antes de
 * fazer, Confirmar e Cancelar, o motivo de cada item que não pôde e o
 * Desfazer quando há reverso.
 */

const proposta = (extra: Partial<AcaoDoAgente> = {}): AcaoDoAgente => ({
  tipo: "acao_agente",
  agente: "contexto",
  id: "p1",
  resumo: "Vou arquivar 2 fotos e mover o logo.",
  itens: [
    { ref: "i1", alvo_id: "a", titulo: "fachada.jpg", detalhe: "pasta Loja", operacao: "arquivar_foto", rotulo: "arquivar", para: null },
    { ref: "i2", alvo_id: "b", titulo: "vitrine.jpg", detalhe: null, operacao: "arquivar_foto", rotulo: "arquivar", para: null },
    { ref: "w3", alvo_id: "c", titulo: "logo.png", detalhe: null, operacao: "mover", rotulo: "mover", para: "id-da-pasta", para_rotulo: "pasta Marca / Logos" },
  ],
  ignorados: ["i9"],
  recusados: [{ ref: "i4", titulo: "aprovada.jpg", operacao: "arquivar_foto", motivo: "A aprovação do cliente não pode sumir." }],
  ...extra,
});

describe("CartaoDeAcao", () => {
  it("mostra a lista exata, o destino, o que fica de fora e o que não entrou", () => {
    render(h(CartaoDeAcao, { acao: proposta(), onPedido: vi.fn() }));
    expect(screen.getByText(/3 itens/)).toBeTruthy();
    expect(screen.getByText("fachada.jpg")).toBeTruthy();
    expect(screen.getByText(/pasta Marca \/ Logos/)).toBeTruthy();
    expect(screen.getByText(/aprovada.jpg: A aprovação do cliente não pode sumir./)).toBeTruthy();
    expect(screen.getByText(/1 pedido não entrou/)).toBeTruthy();
    expect(document.querySelector("[data-acao-agente]")!.getAttribute("data-acao-agente")).toBe("aberta");
  });

  it("confirmar chama a função uma vez, mostra o motivo do que falhou e oferece Desfazer", async () => {
    const feita = proposta({
      executada_em: "2026-09-25T22:00:00Z",
      resultados: [
        { ref: "i1", alvo_id: "a", titulo: "fachada.jpg", operacao: "arquivar_foto", ok: true, desfazer: { ativa: true } },
        { ref: "i2", alvo_id: "b", titulo: "vitrine.jpg", operacao: "arquivar_foto", ok: false, motivo: "Esta foto não está mais no acervo deste cliente." },
        { ref: "w3", alvo_id: "c", titulo: "logo.png", operacao: "mover", ok: true, desfazer: { parent_id: null } },
      ],
    });
    const onPedido = vi.fn().mockResolvedValueOnce({ anexo: feita }).mockResolvedValueOnce({ anexo: { ...feita, desfeita_em: "2026-09-25T22:01:00Z" }, voltaram: 2 });
    const onFeito = vi.fn();
    render(h(CartaoDeAcao, { acao: proposta(), onPedido, onFeito }));
    fireEvent.click(screen.getByRole("button", { name: /Confirmar/ }));
    await waitFor(() => expect(screen.getByText(/Feito · 1 não pôde/)).toBeTruthy());
    expect(onPedido).toHaveBeenCalledWith("confirmar");
    expect(onFeito).toHaveBeenCalledWith("confirmar", expect.anything());
    expect(screen.getByText("Esta foto não está mais no acervo deste cliente.")).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith("2 itens feitos", expect.anything());

    fireEvent.click(screen.getByRole("button", { name: /Desfazer/ }));
    await waitFor(() => expect(screen.getByText(/Desfeito: voltou como estava/)).toBeTruthy());
    expect(onPedido).toHaveBeenLastCalledWith("desfazer");
    expect(screen.queryByRole("button", { name: /Desfazer/ })).toBeNull();
  });

  it("cancelar não executa e erro na chamada deixa a lista aberta", async () => {
    const onPedido = vi.fn().mockRejectedValueOnce(new Error("Sem acesso ao cliente.")).mockResolvedValueOnce({ anexo: proposta({ descartada_em: "2026-09-25T22:00:00Z" }) });
    render(h(CartaoDeAcao, { acao: proposta(), onPedido }));
    fireEvent.click(screen.getByRole("button", { name: /Confirmar/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(document.querySelector("[data-acao-agente]")!.getAttribute("data-acao-agente")).toBe("aberta");
    fireEvent.click(screen.getByRole("button", { name: /Cancelar/ }));
    await waitFor(() => expect(screen.getByText(/Cancelado: nada mudou/)).toBeTruthy());
    expect(onPedido).toHaveBeenLastCalledWith("descartar");
  });

  it("sem reverso (só refazer), não oferece Desfazer; confirmar com custo usa o botão de quem hospeda", async () => {
    const semVolta = proposta({ sem_desfazer: true, itens: [{ ref: "l1", alvo_id: "1", titulo: "Lâmina 1", detalhe: null, operacao: "refazer", rotulo: "refazer", para: null }], recusados: [], ignorados: [] });
    const onPedido = vi.fn().mockResolvedValue({ anexo: { ...semVolta, executada_em: "x", resultados: [{ ref: "l1", alvo_id: "1", titulo: "Lâmina 1", operacao: "refazer", ok: true }] } });
    render(
      h(CartaoDeAcao, {
        acao: semVolta,
        onPedido,
        renderConfirmar: (confirmar: () => Promise<unknown>) => h("button", { type: "button", onClick: () => void confirmar() }, "Confirmar e refazer (US$ 0,08)"),
      }),
    );
    expect(screen.getByText("Nada muda até confirmar.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /US\$ 0,08/ }));
    await waitFor(() => expect(screen.getByText(/^Feito/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Desfazer/ })).toBeNull();
  });

  it("a linha do que o agente pode fazer leva aos atalhos (sem prometer confirmação: há ação que é feita na hora)", () => {
    const onAtalho = vi.fn();
    render(h(OQuePossoFazer, { capacidades: ["apagar", "refazer"], atalhos: [{ rotulo: "Refazer conteúdos", texto: "Refaça os conteúdos " }], onAtalho }));
    fireEvent.click(screen.getByRole("button", { name: "Sugestões", exact: true }));
    expect(screen.getByText(/apagar, refazer\./)).toBeTruthy();
    expect(screen.queryByText(/Confirmo com você antes/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refazer conteúdos" }));
    expect(onAtalho).toHaveBeenCalledWith("Refaça os conteúdos ");
  });

  it("com até 4 atalhos, todos à vista; com mais, 3 e o \"...\" com o resto, na ordem, que também preenche", () => {
    const onAtalho = vi.fn();
    const atalhos = (n: number) => Array.from({ length: n }, (_, i) => ({ rotulo: `Atalho ${i + 1}`, texto: `Pedido ${i + 1} ` }));
    const quatro = render(h(OQuePossoFazer, { capacidades: ["x"], atalhos: atalhos(4), onAtalho }));
    fireEvent.click(screen.getByRole("button", { name: "Sugestões", exact: true }));
    expect(within(screen.getByRole("group", { name: "Atalhos de ação" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["Atalho 1", "Atalho 2", "Atalho 3", "Atalho 4"]);
    expect(screen.queryByRole("button", { name: "Mais atalhos" })).toBeNull();
    quatro.unmount();

    render(h(OQuePossoFazer, { capacidades: ["x"], atalhos: atalhos(7), onAtalho }));
    fireEvent.click(screen.getByRole("button", { name: "Sugestões", exact: true }));
    const grupo = screen.getByRole("group", { name: "Atalhos de ação" });
    expect(within(grupo).getAllByRole("button").length).toBe(4);
    expect(screen.queryByRole("button", { name: "Atalho 4" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("button", { name: "Mais atalhos" }), { key: "Enter" });
    const itens = screen.getAllByRole("menuitem");
    expect(itens.map((i) => i.textContent)).toEqual(["Atalho 4", "Atalho 5", "Atalho 6", "Atalho 7"]);
    fireEvent.click(itens[1]);
    expect(onAtalho).toHaveBeenCalledWith("Pedido 5 ");
  });

  it("sem a linha Posso (a lista foi para o \"?\"): ficam só os atalhos; a lista inteira mora em CapacidadesDoAgente", () => {
    render(h(OQuePossoFazer, { capacidades: ["apagar", "refazer"], mostrarCapacidades: false, atalhos: [{ rotulo: "Refazer", texto: "Refaça" }], onAtalho: vi.fn() }));
    fireEvent.click(screen.getByRole("button", { name: "Sugestões", exact: true }));
    expect(screen.queryByText(/Posso:/)).toBeNull();
    expect(screen.getByRole("button", { name: "Refazer" })).toBeTruthy();
    render(h(CapacidadesDoAgente, { capacidades: ["apagar (na hora)", "refazer (com Confirmar)"] }));
    expect(screen.getAllByRole("listitem").map((i) => i.textContent)).toEqual(["apagar (na hora)", "refazer (com Confirmar)"]);
  });
});
