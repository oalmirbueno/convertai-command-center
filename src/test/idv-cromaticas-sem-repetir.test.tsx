import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createElement as h } from "react";
import { normalizarBrandbook } from "../../supabase/functions/mesa-identidade/modulos/brandbook";
import VisaoDoBrandbook from "@/components/mesa-identidade/VisaoDoBrandbook";

/**
 * Página "Versões cromáticas" do brandbook (14/10): os fundos são o branco, a
 * escura do tema e as cores da paleta. A escura do tema é a cor mais escura da
 * paleta quando ela é bem escura (#2E3338 abaixo), e o branco pode estar na
 * paleta: a mesma cor entrava duas vezes, com a mesma chave no React.
 */

const quadrosDaPagina = (container: HTMLElement, n: number) => {
  const pagina = container.querySelector(`[data-pagina-do-brandbook="${n}"]`)!;
  // Os quadros da página 11 são as caixas de logo de 70 px.
  return Array.prototype.slice.call(pagina.querySelectorAll("div")).filter((el: HTMLElement) => el.style.height === "70px") as HTMLElement[];
};

const avisosDeChaveRepetida = (espiao: { mock: { calls: unknown[][] } }) => espiao.mock.calls.filter((args) => args.map(String).join(" ").indexOf("same key") >= 0);

describe("IDV: versões cromáticas sem quadro repetido", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("a escura do tema e o branco que já estão na paleta entram uma vez só, e a paleta completa os 6 quadros", () => {
    const dados = normalizarBrandbook({
      marca: { nome: "Forno" },
      cores: [
        { hex: "#157330", papel: "primaria" },
        { hex: "#2E3338", papel: "neutra" },
        { hex: "#F2B705", papel: "destaque" },
        { hex: "#ffffff", papel: "neutra" },
        { hex: "#8FBF9F", papel: "secundaria" },
        { hex: "#D9E4DD", papel: "secundaria" },
      ],
    });
    const espiao = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(h(VisaoDoBrandbook, { dados, modelo: "paginado", urlDe: () => null }));

    const fundos = quadrosDaPagina(container, 11).map((el) => el.style.background);
    expect(fundos).toEqual([
      "rgb(255, 255, 255)", // branco
      "rgb(46, 51, 56)", // #2E3338: a cor mais escura da paleta é a escura do tema
      "rgb(21, 115, 48)", // #157330
      "rgb(242, 183, 5)", // #F2B705
      "rgb(143, 191, 159)", // #8FBF9F
      "rgb(217, 228, 221)", // #D9E4DD
    ]);
    expect(new Set(fundos).size).toBe(fundos.length);
    expect(avisosDeChaveRepetida(espiao)).toEqual([]);
  });

  it("paleta com hex repetido em outra grafia chega sem repetição às amostras de cor", () => {
    const dados = normalizarBrandbook({ cores: [{ hex: "#abc" }, { hex: "#AABBCC" }, { hex: "aabbcc" }, { hex: "#157330" }] });
    expect(dados.cores.map((c) => c.hex)).toEqual(["#AABBCC", "#157330"]);
    const espiao = vi.spyOn(console, "error").mockImplementation(() => {});
    render(h(VisaoDoBrandbook, { dados, modelo: "paginado", urlDe: () => null }));
    render(h(VisaoDoBrandbook, { dados, modelo: "prancha", urlDe: () => null }));
    expect(avisosDeChaveRepetida(espiao)).toEqual([]);
  });
});
