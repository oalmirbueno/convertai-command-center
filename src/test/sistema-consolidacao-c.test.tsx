import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h, useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { botao, juntar } from "@/components/sistema/estilos";
import RegiaoRolavel from "@/components/sistema/RegiaoRolavel";
import AreaDeTrabalho, { abrirLateralDaArea } from "@/components/sistema/AreaDeTrabalho";
import FaixaDeNumeros from "@/components/sistema/FaixaDeNumeros";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import Secao from "@/components/sistema/Secao";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { useReservaFlutuante } from "@/components/sistema/useReservaFlutuante";
import ClientPlainSummary from "@/components/reports/ClientPlainSummary";

/**
 * Frente C (26/09): consolidação do sistema de design. O que as frentes de
 * tela pediram e foi promovido, mais as correções de raiz (juntar, toque de
 * 44 px, impressão no celular, leitura "messages", erro do Comercial).
 */

let respostaDoBanco: { data: unknown; error: unknown } = { data: [], error: null };
vi.mock("@/integrations/supabase/client", () => {
  const cadeia: Record<string, unknown> = {};
  const fim = () => Promise.resolve(respostaDoBanco);
  for (const m of ["select", "is", "eq", "order", "limit"]) {
    cadeia[m] = () => Object.assign(fim(), cadeia);
  }
  return { supabase: { from: () => cadeia, auth: { getUser: () => Promise.resolve({ data: { user: null } }) } } };
});

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

describe("juntar resolve conflito do Tailwind", () => {
  it("o ajuste vence a base (h-8 sobre o h-9 do botão) e trocar a letra não apaga o leading", () => {
    const b = juntar(botao.secundario, "h-8").split(" ");
    expect(b).toContain("h-8");
    expect(b).not.toContain("h-9");
    const t = juntar("text-[13px] leading-5", "text-[12px]").split(" ");
    expect(t).toContain("leading-5");
    expect(t).toContain("text-[12px]");
    expect(t).not.toContain("text-[13px]");
  });
});

describe("área de toque de 44 px sem inchar botão compacto", () => {
  it("os botões do sistema levam a marca e o CSS troca o min-height por pseudo-elemento", () => {
    for (const v of Object.keys(botao) as Array<keyof typeof botao>) expect(botao[v], v).toContain("toque-compacto");
    const css = ler("src/styles/responsive.css");
    expect(css).toContain('button:not(.toque-compacto):not([data-compacto])');
    expect(css).toContain(".toque-compacto::after");
    expect(css).toContain("min-height: 44px;");
    const bloco = css.slice(css.indexOf("/* Botões compactos"), css.indexOf("/* Inputs"));
    expect(bloco).toContain("min-width: 44px;");
    // Sem min()/max()/clamp() nas regras (o comentário pode citar).
    expect(bloco.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/\b(min|max|clamp)\(/);
  });
});

describe("impressão no celular", () => {
  it("o conteúdo do painel volta ao fluxo normal e as barras somem", () => {
    const css = ler("src/index.css");
    const impressao = css.slice(css.indexOf("@media print"), css.indexOf("/* Respect reduced motion */"));
    expect(impressao).toMatch(/\[data-casca="conteudo"\] \{\s*position: static !important;/);
    expect(impressao).toContain('[data-casca="topo"], [data-casca="rodape"], [data-casca="flutuante"]');
    expect(impressao).toContain("overflow: visible !important;");
  });
});

describe("RegiaoRolavel", () => {
  it("o elemento que rola é relative e volta ao topo ao trocar para uma chave sem posição guardada", () => {
    const { rerender, container } = render(h(RegiaoRolavel, { memoria: "teste:a", modo: "sempre" }, h("p", null, "x")));
    const el = container.querySelector(".overflow-y-auto") as HTMLDivElement;
    expect(el.className.split(" ")).toContain("relative");
    el.scrollTop = 300;
    rerender(h(RegiaoRolavel, { memoria: "teste:b", modo: "sempre" }, h("p", null, "x")));
    expect(el.scrollTop).toBe(0);
  });
});

describe("AreaDeTrabalho: abrir a lateral de fora e nascer recolhida", () => {
  it("nasce recolhida sem escolha guardada e abrirLateralDaArea tira do recolhido", () => {
    render(h(AreaDeTrabalho, { memoria: "teste-area", nasceRecolhida: true, rotuloDaLateral: "Diretor", lateral: h("p", null, "conversa") }, h("p", null, "principal")));
    expect(screen.getByRole("button", { name: "Abrir diretor" })).toBeTruthy();
    expect(screen.queryByText("conversa")).toBeNull();
    act(() => {
      expect(abrirLateralDaArea()).toBe(true);
    });
    expect(screen.getByText("conversa")).toBeTruthy();
    expect(window.localStorage.getItem("area:teste-area:recolhida")).toBe("0");
  });

  it("sem área na tela, abrir não faz nada", () => {
    expect(abrirLateralDaArea()).toBe(false);
  });
});

describe("reserva para botão flutuante", () => {
  it("liga a faixa no body enquanto o botão está na tela", () => {
    function Tela({ ativo }: { ativo: boolean }) {
      useReservaFlutuante(ativo, 96);
      return null;
    }
    const r = render(h(Tela, { ativo: true }));
    expect(document.body.hasAttribute("data-reserva-flutuante")).toBe(true);
    expect(document.body.style.getPropertyValue("--reserva-flutuante")).toBe("96px");
    r.rerender(h(Tela, { ativo: false }));
    expect(document.body.hasAttribute("data-reserva-flutuante")).toBe(false);
  });
});

describe("FaixaDeNumeros do sistema", () => {
  it("número que leva a outra tela vira link; ação vira botão; o resto é texto", () => {
    const clicou: string[] = [];
    render(
      h(
        MemoryRouter,
        null,
        h(FaixaDeNumeros, {
          rotulo: "Resumo",
          itens: [
            { rotulo: "Atrasado", valor: "R$ 10", para: "/financeiro" },
            { rotulo: "Pendentes", valor: 3, aoClicar: () => clicou.push("p") },
            { rotulo: "Ativos", valor: 5, apoio: "no mês" },
          ],
        }),
      ),
    );
    expect(screen.getByRole("group", { name: "Resumo" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Atrasado/ }).getAttribute("href")).toBe("/financeiro");
    fireEvent.click(screen.getByRole("button", { name: /Pendentes/ }));
    expect(clicou).toEqual(["p"]);
    expect(screen.getByText("no mês")).toBeTruthy();
  });
});

describe("SeletorCompacto vira lista quando não cabe", () => {
  it("rótulo cortado no segmentado troca para a lista antes da pintura", () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth");
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get() {
        return (this as HTMLElement).hasAttribute("data-rotulo-da-opcao") ? 120 : 0;
      },
    });
    try {
      function Teste() {
        const [v, setV] = useState("a");
        return h(SeletorCompacto, {
          rotulo: "Filtro",
          modo: "segmentado",
          listaQuandoNaoCabe: true,
          opcoes: [
            { valor: "a", rotulo: "Aguardando" },
            { valor: "b", rotulo: "Aprovados" },
          ],
          valor: v,
          onEscolher: setV,
        });
      }
      render(h(Teste));
      expect(screen.queryAllByRole("tab")).toHaveLength(0);
      expect(screen.getByRole("button", { name: "Filtro: Aguardando" })).toBeTruthy();
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, "scrollWidth", original);
    }
  });
});

describe("Secao: ações quebram por dentro", () => {
  it("as ações encolhem primeiro e quebram por dentro, sem passar da borda", () => {
    const { container } = render(h(Secao, { titulo: "Contas", acao: h("button", null, "Adicionar") }, h("p", null, "corpo")));
    const cab = container.querySelector("[data-cabecalho-de-secao]") as HTMLElement;
    expect(cab).toBeTruthy();
    const acoes = screen.getByText("Adicionar").parentElement as HTMLElement;
    expect(acoes.className).toContain("flex-wrap");
    expect(acoes.className).not.toContain("min-w-0");
    expect(acoes.className).not.toContain("shrink-0");
  });
});

describe("useEstadoDaTela com rota fixa", () => {
  it("guarda sob a rota passada, no mesmo formato de chave", () => {
    function Campo() {
      const [v, setV] = useEstadoDaTela("filtro", "", { esperaMs: 0, rota: "/comercial" });
      return h("input", { "aria-label": "filtro", value: v, onChange: (e: { target: { value: string } }) => setV(e.target.value) });
    }
    render(h(Campo));
    fireEvent.change(screen.getByLabelText("filtro"), { target: { value: "padaria" } });
    const bruto = window.localStorage.getItem("tela:anon:/comercial:filtro");
    expect(bruto && JSON.parse(bruto).v).toBe("padaria");
  });
});

describe("Leitura clara do relatório", () => {
  it('a chave padrão "messages" conta como "Entraram em contato"', () => {
    render(h(ClientPlainSummary, { metrics: { messages: 12, spend: 120, reach: 3000 }, periodDays: 30 }));
    expect(screen.getByText("Entraram em contato")).toBeTruthy();
    expect(screen.getAllByText("12").length).toBeGreaterThan(0);
  });
});

describe("Comercial: leitura que falha não vira lista vazia", () => {
  it("listarLeads devolve o erro em vez de []", async () => {
    const { listarLeads, ErroDeLeitura } = await import("@/lib/comercial");
    respostaDoBanco = { data: null, error: { message: "permission denied" } };
    await expect(listarLeads()).rejects.toBeInstanceOf(ErroDeLeitura);
    respostaDoBanco = { data: [], error: null };
    await waitFor(async () => expect(await listarLeads()).toEqual([]));
  });
});
