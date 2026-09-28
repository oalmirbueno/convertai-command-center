import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import Secao from "@/components/sistema/Secao";
import { BalaoDaConversa, CompositorDoAgente } from "@/components/sistema/PainelDoAgente";
import TextoDoAgente from "@/components/agentes/TextoDoAgente";
import { conversa } from "@/components/sistema/estilos";

/**
 * Frente UI (28/09). Dono: "os agentes estão com o texto muito curtinho, não
 * consigo ler bem" e "todos os lugares devem ser organizados para recolher".
 * A conversa ganhou um tamanho só (14 px) pelos componentes comuns, e a
 * Secao ganhou o recolher lembrado por chave.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

describe("texto dos agentes", () => {
  it("o texto do agente nasce em 14 px com linha folgada, e quem pede outro tamanho ainda vence", () => {
    const { container, rerender } = render(h(TextoDoAgente, { texto: "Olá", clientId: null }));
    const p = container.querySelector("[data-texto-do-agente]") as HTMLElement;
    expect(p.className).toContain("text-[14px]");
    expect(p.className).toContain("leading-[1.6]");
    rerender(h(TextoDoAgente, { texto: "Olá", clientId: null, className: "text-[12px]" }));
    const p2 = container.querySelector("[data-texto-do-agente]") as HTMLElement;
    expect(p2.className).toContain("text-[12px]");
    expect(p2.className).not.toContain("text-[14px]");
  });

  it("o balão tem a mesma forma para todo agente", () => {
    const { container } = render(h("div", null, h(BalaoDaConversa, { de: "usuario" }, "pedido"), h(BalaoDaConversa, { de: "agente" }, "resposta")));
    const usuario = container.querySelector('[data-balao="usuario"]') as HTMLElement;
    const agente = container.querySelector('[data-balao="agente"]') as HTMLElement;
    expect(usuario.className).toContain("text-[14px]");
    expect(usuario.className).toContain("bg-primary/10");
    expect(agente.className).toContain("text-[14px]");
    expect(agente.className).not.toContain("bg-primary/10");
  });

  it("o campo de digitar de qualquer agente fica em 14 px pelo compositor comum", () => {
    const { container } = render(h(CompositorDoAgente, null, h("textarea", { "aria-label": "Mensagem" })));
    const pe = container.querySelector("[data-compositor-do-agente]") as HTMLElement;
    expect(pe.className).toContain("[&_textarea]:text-[14px]");
  });

  it("os chats das mesas usam o tamanho da conversa, não mais 12 a 13 px", () => {
    for (const arquivo of [
      "src/components/mesa/AgenteDeContexto.tsx",
      "src/components/mesa-videos/AgenteDaMesaDeVideo.tsx",
      "src/components/mesa-videos/DiretorDoVideo.tsx",
      "src/components/mesa-roteiros/AgenteRoteirista.tsx",
      "src/components/mesa-publicidade/AgenteDaPublicidade.tsx",
      "src/components/mesa-edicao/editor/AgenteEditor.tsx",
      "src/components/mesa-foto/AgenteDiretor.tsx",
    ]) {
      const fonte = ler(arquivo);
      expect(fonte, arquivo).toMatch(/conversa\.balao|estiloDaConversa\.balao|BalaoDaConversa/);
      expect(fonte, arquivo).not.toContain("rounded-lg px-3 py-2 text-[13px] leading-relaxed");
    }
    expect(conversa.balao).toContain("text-[14px]");
  });
});

describe("Secao recolhível", () => {
  it("sem chave nada muda: título comum, conteúdo à vista", () => {
    render(h(Secao, { titulo: "Paleta" }, h("p", null, "conteúdo")));
    expect(screen.getByRole("heading", { name: "Paleta" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Paleta/ })).toBeNull();
    expect(screen.getByText("conteúdo")).toBeTruthy();
  });

  it("com chave, o título vira o botão, recolhe, mostra o resumo e lembra ao remontar", () => {
    const props = { titulo: "Paleta", recolher: "teste:paleta:c1", resumo: "3 cores", descricao: "estado", acao: h("button", { type: "button" }, "Adicionar") };
    const { unmount } = render(h(Secao, props, h("p", null, "conteúdo")));
    const botao = screen.getByRole("button", { name: /Paleta/ });
    expect(botao.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("heading", { name: "Paleta" })).toBeTruthy();
    expect(screen.getByText("conteúdo")).toBeTruthy();
    expect(screen.queryByText("3 cores")).toBeNull();
    fireEvent.click(botao);
    expect(screen.getByRole("button", { name: /Paleta/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("conteúdo")).toBeNull();
    expect(screen.queryByRole("button", { name: "Adicionar" })).toBeNull();
    expect(screen.getByText("3 cores")).toBeTruthy();
    unmount();
    render(h(Secao, props, h("p", null, "conteúdo")));
    expect(screen.getByRole("button", { name: /Paleta/ }).getAttribute("aria-expanded")).toBe("false");
  });

  it("recolhidaDeInicio vale só enquanto a pessoa não escolheu", () => {
    render(h(Secao, { titulo: "Histórico", recolher: "teste:historico:c1", recolhidaDeInicio: true }, h("p", null, "linhas")));
    expect(screen.queryByText("linhas")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Histórico/ }));
    expect(screen.getByText("linhas")).toBeTruthy();
  });
});
