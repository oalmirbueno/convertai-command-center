import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import OpcoesDaCopy, { NotaDaCopy, opcoesDaResposta } from "@/components/sistema/OpcoesDaCopy";

const fonte = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("motor de copy na tela", () => {
  it("lê as variações da resposta da função, na ordem, e ignora o que não tem texto", () => {
    const lidas = opcoesDaResposta({ opcoes: [{ legenda: "A", nota: 88, framework: "aida", avisos: ["x"] }, { legenda: "" }, { legenda: "B", alerta: true }] });
    expect(lidas.map((o) => o.texto)).toEqual(["A", "B"]);
    expect(lidas[0]).toMatchObject({ nota: 88, framework: "aida", avisos: ["x"], alerta: false });
    expect(lidas[1].alerta).toBe(true);
    expect(opcoesDaResposta({ opcoes: [{ headline: "H1", nota: 70 }] }, "headline")[0].texto).toBe("H1");
    expect(opcoesDaResposta(null)).toEqual([]);
  });

  it("as outras opções ficam recolhidas e trocam o texto com um clique", () => {
    const usar = vi.fn();
    render(<OpcoesDaCopy opcoes={[{ texto: "Primeira", nota: 90 }, { texto: "Segunda", nota: 80, avisos: ["Sem CTA claro."] }, { texto: "Terceira", nota: 70 }]} atual="Primeira" onUsar={usar} />);
    expect(screen.queryByText("Segunda")).toBeNull();
    fireEvent.click(screen.getByText("Outras 2 opções escritas junto"));
    expect(screen.getByText("Segunda")).toBeTruthy();
    expect(screen.getByText("Nota 80")).toBeTruthy();
    fireEvent.click(screen.getAllByText("Usar esta")[0]);
    expect(usar).toHaveBeenCalledWith("Segunda");
  });

  it("sem outra opção, não mostra nada; a nota mostra o alerta e o primeiro aviso", () => {
    const { container } = render(<OpcoesDaCopy opcoes={[{ texto: "Só esta" }]} atual="Só esta" onUsar={() => {}} />);
    expect(container.innerHTML).toBe("");
    render(<NotaDaCopy nota={45} alerta avisos={["Promessa proibida.", "Outro."]} framework="pas" />);
    expect(screen.getByText("Nota 45")).toBeTruthy();
    expect(screen.getByText(/Promessa proibida\. \(\+1\)/)).toBeTruthy();
  });

  it("Site e Proposta mostram a nota da conferência", () => {
    expect(fonte("src/components/mesa-site/EtapaConteudo.tsx")).toContain("{o.conferencia && <NotaDaCopy nota={o.conferencia.nota}");
    expect(fonte("src/components/mesa-proposta/EtapaRascunho.tsx")).toContain('opcoesDaResposta(d ? { opcoes: d.conferencia } : null, "headline")');
  });
});
