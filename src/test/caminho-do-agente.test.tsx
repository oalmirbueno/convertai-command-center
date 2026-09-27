import { describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import CartaoDeAcao from "@/components/agentes/CartaoDeAcao";
import CaminhoPronto from "@/components/agentes/CaminhoPronto";
import { acaoDoAnexo, caminhoSeguro } from "@/lib/agentes/acoesDoAgente";
import { caminhoSeguro as caminhoDoServidor } from "../../supabase/functions/_shared/acoes-do-agente";

function Onde() {
  const l = useLocation();
  return h("output", { "data-testid": "onde" }, `${l.pathname}${l.search}`);
}

const acao = (extra: Record<string, unknown> = {}) =>
  acaoDoAnexo({
    tipo: "acao_agente",
    agente: "foto",
    id: "a1",
    resumo: "Carrossel montado na Agenda",
    itens: [{ ref: "p1", alvo_id: "x", titulo: "Carrossel", detalhe: null, operacao: "criar", rotulo: "Criar", para: null }],
    ignorados: [],
    recusados: [],
    ...extra,
  })!;

describe("caminho do agente (27/09: termina e dá o caminho para ir)", () => {
  it("só aceita rota interna do painel, igual na tela e no servidor", () => {
    for (const f of [caminhoSeguro, caminhoDoServidor]) {
      expect(f({ rotulo: "Abrir na Agenda", destino: "/calendario?client=c1&content=p1" })).toEqual({ rotulo: "Abrir na Agenda", destino: "/calendario?client=c1&content=p1" });
      expect(f({ rotulo: "x", destino: "https://fora.test" })).toBeNull();
      expect(f({ rotulo: "x", destino: "//fora.test" })).toBeNull();
      expect(f({ rotulo: "x", destino: "javascript:alert(1)" })).toBeNull();
      expect(f({ rotulo: "", destino: "/mesa" })).toBeNull();
      expect(f({ rotulo: "Ir", destino: "/mesa", abrir_sozinho: true })).toEqual({ rotulo: "Ir", destino: "/mesa", abrir_sozinho: true });
    }
    expect(acao({ caminho: { rotulo: "Ir", destino: "https://fora.test" } }).caminho).toBeNull();
  });

  it("depois de feito, o cartão mostra o botão do caminho e ele leva à área", async () => {
    const feita = acao({ executada_em: "2026-09-27T12:00:00Z", resultados: [{ ref: "p1", alvo_id: "x", titulo: "Carrossel", operacao: "criar", ok: true }], caminho: { rotulo: "Abrir na Agenda", destino: "/calendario?client=c1&content=p1" } });
    render(h(MemoryRouter, { initialEntries: ["/mesa-foto"] }, h(CartaoDeAcao, { acao: feita, onPedido: vi.fn() }), h(Onde)));
    fireEvent.click(screen.getByRole("button", { name: /Abrir na Agenda/ }));
    await waitFor(() => expect(screen.getByTestId("onde").textContent).toBe("/calendario?client=c1&content=p1"));
  });

  it("confirmar com abrir_sozinho vai sozinho ao terminar; reabrir a conversa não navega", async () => {
    const aberta = acao({ caminho: { rotulo: "Abrir o Estúdio", destino: "/mesa?client=c1&aba=estudio", abrir_sozinho: true } });
    const feita = { ...aberta, executada_em: "2026-09-27T12:00:00Z", resultados: [{ ref: "p1", alvo_id: "x", titulo: "Carrossel", operacao: "criar", ok: true }] };
    const onPedido = vi.fn(async () => ({ anexo: feita }));
    render(h(MemoryRouter, { initialEntries: ["/mesa-foto"] }, h(CartaoDeAcao, { acao: aberta, onPedido }), h(Onde)));
    fireEvent.click(screen.getByRole("button", { name: /Confirmar/ }));
    await waitFor(() => expect(screen.getByTestId("onde").textContent).toBe("/mesa?client=c1&aba=estudio"));

    render(h(MemoryRouter, { initialEntries: ["/outra"] }, h(CartaoDeAcao, { acao: acaoDoAnexo(feita)!, onPedido: vi.fn() }), h(Onde)));
    expect(screen.getAllByTestId("onde").pop()!.textContent).toBe("/outra");
  });

  it("fora de um roteador, o botão ainda funciona (vai pelo endereço)", () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, assign } });
    render(h(CaminhoPronto, { caminho: { rotulo: "Abrir a Mesa", destino: "/mesa?client=c1" } }));
    fireEvent.click(screen.getByRole("button", { name: /Abrir a Mesa/ }));
    expect(assign).toHaveBeenCalledWith("/mesa?client=c1");
    Object.defineProperty(window, "location", { configurable: true, value: original });
  });
});
