import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h, useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import Etapas from "@/components/sistema/Etapas";
import SeletorDeMesa from "@/components/sistema/SeletorDeMesa";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import AreaDeTrabalho, { alturaDaArea } from "@/components/sistema/AreaDeTrabalho";
import PainelDoAgente from "@/components/sistema/PainelDoAgente";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { useEstadoDaTela, lerEstadoDaTela, gravarEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { MESAS } from "@/components/mesa-foto/TrocaDeMesas";

/**
 * Sistema de design do painel (frente D1, 26/09; docs/design/SISTEMA.md):
 * os componentes base que as próximas frentes aplicam em todas as telas.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");
const CLIENTE = "11111111-1111-4111-8111-111111111111";

function Endereco() {
  const l = useLocation();
  return h("p", { "data-testid": "endereco" }, l.pathname + l.search);
}

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

describe("Etapas", () => {
  it("marca a aberta, nunca corta o texto e anda com as setas", () => {
    const escolhidas: string[] = [];
    render(
      h(Etapas, {
        rotulo: "Etapas da Mesa",
        numerar: true,
        itens: [
          { valor: "a", rotulo: "Contexto" },
          { valor: "b", rotulo: "Mês" },
          { valor: "c", rotulo: "Entrega" },
        ],
        valor: "b",
        onEscolher: (v: string) => escolhidas.push(v),
      }),
    );
    const nav = screen.getByRole("navigation", { name: "Etapas da Mesa" });
    const botoes = within(nav).getAllByRole("button");
    expect(botoes.map((b) => b.textContent)).toEqual(["1Contexto", "2Mês", "3Entrega"]);
    expect(botoes[1].getAttribute("aria-current")).toBe("page");
    for (const b of botoes) expect(b.className).toContain("whitespace-nowrap");
    botoes[1].focus();
    fireEvent.keyDown(botoes[1], { key: "ArrowRight" });
    expect(document.activeElement).toBe(botoes[2]);
    fireEvent.click(botoes[2]);
    expect(escolhidas).toEqual(["c"]);
  });
});

describe("SeletorDeMesa", () => {
  const montar = () =>
    render(
      h(
        MemoryRouter,
        { initialEntries: [`/mesa?client=${CLIENTE}`] },
        h(Routes, null, h(Route, { path: "*", element: h("div", null, h(SeletorDeMesa, { atual: "mesa", clientId: CLIENTE, marcaId: null }), h(Endereco)) })),
      ),
    );

  it("um botão só abre a lista das mesas com o cliente junto; a aberta fica marcada e sem link", async () => {
    montar();
    const botao = screen.getByRole("button", { name: /Mesa aberta: Mesa/ });
    expect(botao.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(botao);
    const lista = await screen.findByRole("navigation", { name: "Trocar de mesa" });
    const links = within(lista).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("aria-label"))).toEqual(MESAS.filter((m) => m.valor !== "mesa").map((m) => m.rotulo));
    expect(within(lista).getByLabelText("Mesa").getAttribute("aria-current")).toBe("page");
    expect(within(lista).getByLabelText("Mesa Ads").getAttribute("href")).toBe(`/mesa-ads?client=${CLIENTE}`);
  });

  it("Alt+M abre de qualquer lugar e o número abre a mesa daquela posição", async () => {
    montar();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "m", code: "KeyM", altKey: true }));
    });
    const lista = await screen.findByRole("navigation", { name: "Trocar de mesa" });
    fireEvent.keyDown(lista.firstElementChild as HTMLElement, { key: "3" });
    expect(screen.getByTestId("endereco").textContent).toBe(`${MESAS[2].caminho}?client=${CLIENTE}`);
  });

  it("a lista de mesas é única: cada mesa tem ícone e descrição, e a Edição tem a linha pronta para entrar", () => {
    for (const m of MESAS) {
      expect(m.icone, m.valor).toBeTruthy();
      expect(m.descricao, m.valor).toBeTruthy();
    }
    expect(ler("src/components/mesa-foto/TrocaDeMesas.tsx")).toContain('caminho: "/mesa-edicao"');
  });
});

describe("SeletorCompacto", () => {
  it("até 4 opções vira segmentado (tabs); mais de 4 vira lista com ícone", async () => {
    function Teste({ n }: { n: number }) {
      const [v, setV] = useState("o0");
      const opcoes = Array.from({ length: n }).map((_, i) => ({ valor: `o${i}`, rotulo: `Opção ${i}` }));
      return h(SeletorCompacto, { rotulo: "Filtro", opcoes, valor: v, onEscolher: setV });
    }
    const um = render(h(Teste, { n: 3 }));
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    fireEvent.click(screen.getByRole("tab", { name: "Opção 2" }));
    expect(screen.getByRole("tab", { name: "Opção 2" }).getAttribute("aria-selected")).toBe("true");
    um.unmount();

    render(h(Teste, { n: 6 }));
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Filtro: Opção 0" }));
    fireEvent.click(await screen.findByRole("option", { name: /Opção 4/ }));
    expect(screen.getByRole("button", { name: "Filtro: Opção 4" })).toBeTruthy();
  });
});

describe("useEstadoDaTela", () => {
  it("guarda por chave (cliente), volta ao reabrir e troca junto com a chave", () => {
    function Campo({ cliente }: { cliente: string }) {
      const [texto, setTexto] = useEstadoDaTela(`teste:rascunho:${cliente}`, "", { esperaMs: 0 });
      return h("input", { "aria-label": "rascunho", value: texto, onChange: (e: any) => setTexto(e.target.value) });
    }
    const a = render(h(Campo, { cliente: "c1" }));
    fireEvent.change(screen.getByLabelText("rascunho"), { target: { value: "legenda pela metade" } });
    a.rerender(h(Campo, { cliente: "c2" }));
    expect((screen.getByLabelText("rascunho") as HTMLInputElement).value).toBe("");
    a.rerender(h(Campo, { cliente: "c1" }));
    expect((screen.getByLabelText("rascunho") as HTMLInputElement).value).toBe("legenda pela metade");
    a.unmount();
    render(h(Campo, { cliente: "c1" }));
    expect((screen.getByLabelText("rascunho") as HTMLInputElement).value).toBe("legenda pela metade");
  });

  it("valor inválido ou armazenamento quebrado cai no inicial", () => {
    gravarEstadoDaTela("teste:parte", "inexistente");
    expect(lerEstadoDaTela("teste:parte", "marca", (v) => v === "marca" || v === "fontes")).toBe("marca");
    window.localStorage.setItem("tela:anon:/:teste:quebrado", "{nao e json");
    expect(lerEstadoDaTela("teste:quebrado", 7)).toBe(7);
  });
});

describe("AreaDeTrabalho e PainelDoAgente", () => {
  it("altura da janela menos onde a área começa, com piso", () => {
    expect(alturaDaArea(768, 150)).toBe(768 - 150 - 16);
    expect(alturaDaArea(500, 300)).toBe(440);
  });

  it("no celular a lateral vira botão que abre o agente em tela cheia; o campo fica fora da rolagem", () => {
    const largura = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    try {
      render(
        h(
          AreaDeTrabalho,
          {
            rotuloDaLateral: "Agente de teste",
            lateral: h(PainelDoAgente, { titulo: "Agente de teste", compositor: h("textarea", { "aria-label": "mensagem" }) }, h("p", null, "olá")),
          },
          h("p", null, "principal"),
        ),
      );
      expect(screen.queryByLabelText("mensagem")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Agente de teste" }));
      const gaveta = screen.getByRole("dialog", { name: "Agente de teste" });
      const campo = within(gaveta).getByLabelText("mensagem");
      expect(campo.closest("[data-compositor-do-agente]")).toBeTruthy();
      expect(campo.closest("[data-mensagens-do-agente]")).toBeNull();
      fireEvent.click(within(gaveta).getByRole("button", { name: "Fechar" }));
      expect(gaveta.className).toContain("hidden");
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: largura });
    }
  });
});

describe("CampoDeFormulario", () => {
  it("rótulo em cima ligado ao campo, apoio e erro no aria-describedby", () => {
    render(h(CampoDeFormulario, { rotulo: "Objetivo", erro: "Conte o objetivo." }, h("input", null)));
    const campo = screen.getByLabelText("Objetivo");
    expect(campo.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(String(campo.getAttribute("aria-describedby")))!.textContent).toBe("Conte o objetivo.");
  });
});

describe("compatibilidade dos arquivos do sistema", () => {
  it("sem gap em flex, lookbehind, \\p{}, aspect-ratio, :has, min()/max()/clamp() em classe, .at() ou travessão", () => {
    const pasta = resolve(raiz, "src/components/sistema");
    for (const nome of readdirSync(pasta)) {
      const texto = ler(`src/components/sistema/${nome}`);
      expect(texto, nome).not.toContain("(?<");
      expect(texto, nome).not.toMatch(/\\p\{/);
      expect(texto, nome).not.toMatch(/aspect-(\[|square|video)/);
      expect(texto, nome).not.toContain(":has(");
      expect(texto, nome).not.toMatch(/\[(min|max|clamp)\(/);
      expect(texto, nome).not.toContain(".at(");
      expect(texto, nome).not.toContain("—");
      // gap só em grade (flex gap não existe no Safari 11 nem no Chrome 64)
      for (const classe of texto.match(/className=(?:"[^"]*"|\{`[^`]*`\})/g) || []) {
        if (/\bflex\b/.test(classe) && !/\bgrid\b/.test(classe)) expect(classe, nome).not.toMatch(/\bgap-/);
      }
    }
  });
});
