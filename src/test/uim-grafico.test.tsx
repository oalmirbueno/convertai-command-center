import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import Grafico, { pontosValidos } from "../../workers/motor-codigo/modelo-site/src/lib/Grafico";

/**
 * Frente UIM (30/09): o gráfico da casca v3 do modelo de site. SVG próprio,
 * só com número real, tabela para leitor de tela e a fonte à vista.
 */
describe("Grafico da casca do modelo de site", () => {
  it("escolhe só o que o tipo aguenta (linha 2+, barras 2 a 8, donut 2 a 5 sem negativo)", () => {
    const d = (n: number) => Array.from({ length: n }, (_, i) => ({ rotulo: `m${i}`, valor: i + 1 }));
    expect(pontosValidos("linha", d(1))).toBeNull();
    expect(pontosValidos("linha", d(12))!.length).toBe(12);
    expect(pontosValidos("barras", d(9))).toBeNull();
    expect(pontosValidos("barras", d(3))!.length).toBe(3);
    expect(pontosValidos("donut", d(6))).toBeNull();
    expect(pontosValidos("donut", [{ rotulo: "a", valor: -1 }, { rotulo: "b", valor: 3 }])).toBeNull();
    expect(pontosValidos("barras", [{ rotulo: "a", valor: Number.NaN }, { rotulo: "b", valor: 2 }])).toBeNull();
  });

  it("desenha as barras com título, descrição, tabela e fonte; sem dado válido não desenha nada", () => {
    const { container, getByRole } = render(<Grafico tipo="barras" titulo="Clientes atendidos por ano" fonte="briefing de 12/09" dados={[{ rotulo: "2024", valor: 120 }, { rotulo: "2025", valor: 180 }]} />);
    const svg = getByRole("img");
    expect(svg.getAttribute("aria-labelledby")).toBeTruthy();
    expect(container.querySelectorAll("rect").length).toBe(2);
    expect(container.querySelector("title")!.textContent).toBe("Clientes atendidos por ano");
    expect(container.querySelector("desc")!.textContent).toMatch(/2024: 120; 2025: 180/);
    expect(container.querySelectorAll("table tbody tr").length).toBe(2);
    expect(container.querySelector("figcaption")!.textContent).toBe("Fonte: briefing de 12/09");
    const vazio = render(<Grafico tipo="linha" titulo="x" dados={[{ rotulo: "a", valor: 1 }]} />);
    expect(vazio.container.innerHTML).toBe("");
  });

  it("o HTML do servidor sai completo (linha e donut) e usa só a cor da marca", () => {
    const linha = renderToString(<Grafico tipo="linha" titulo="Visitas" dados={[{ rotulo: "jan", valor: 10 }, { rotulo: "fev", valor: 14 }, { rotulo: "mar", valor: 9 }]} />);
    expect(linha).toMatch(/<path[^>]*stroke="var\(--cor-destaque\)"/);
    expect(linha).not.toMatch(/#[0-9a-f]{6}/i);
    const donut = renderToString(<Grafico tipo="donut" titulo="Canais" unidade="%" dados={[{ rotulo: "Instagram", valor: 60 }, { rotulo: "Google", valor: 40 }]} />);
    expect((donut.match(/<circle/g) || []).length).toBe(2);
    expect(donut).toMatch(/Instagram: 60 %/);
  });
});
