import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TrilhoDeFerramentas, { GRUPOS_DO_TRILHO, gruposPara } from "@/components/mesa-edicao/editor/TrilhoDeFerramentas";

// 02/10: os 16 painéis do editor saíram de uma lista escondida para um trilho de ícones em grupos.

const TODAS = ["ia", "midia", "corte", "textos", "motion", "zoom", "cor", "formato", "som", "capitulos", "exportar", "gerar", "cenario", "timestamp", "referencias", "skills"].map((v) => ({ valor: v, rotulo: `Painel ${v}` }));

describe("trilho de ferramentas do editor", () => {
  it("todo painel aparece uma vez, em grupos, e um novo sem grupo não some", () => {
    const grupos = gruposPara(TODAS.concat([{ valor: "novo", rotulo: "Novo" }]));
    const vistos = grupos.flat().map((f) => f.valor);
    expect(vistos.slice().sort()).toEqual(TODAS.map((f) => f.valor).concat(["novo"]).sort());
    expect(new Set(vistos).size).toBe(vistos.length);
    expect(grupos[0].map((f) => f.valor)).toEqual(GRUPOS_DO_TRILHO[0]);
  });

  it("um clique escolhe o painel; o ativo fica marcado", () => {
    const escolher = vi.fn();
    render(<TrilhoDeFerramentas ferramentas={TODAS} valor="corte" onEscolher={escolher} />);
    expect(screen.getByRole("tab", { name: "Painel corte" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Painel cor" }));
    expect(escolher).toHaveBeenCalledWith("cor");
    expect(screen.getAllByRole("tab")).toHaveLength(TODAS.length);
  });
});
