import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import Grafico, { type GraficoDoPacote, graficoParaDesenhar, pontosValidos, tipoDoGrafico } from "../../workers/motor-codigo/modelo-site/src/lib/Grafico";

/**
 * Frente UIM (30/09): o gráfico da casca v3 do modelo de site. SVG próprio,
 * só com número real, tabela para leitor de tela e a fonte à vista.
 *
 * Contrato único com o painel: o tipo tem o nome do painel ("linha",
 * "barras", "rosca", de graficoParaDados/GRAFICO_DA_FORMA), "donut" vale como
 * rosca e qualquer outro nome não desenha nada. Antes, o painel mandava
 * "rosca" e o Grafico do motor, que só conhecia "donut", desenhava LINHA.
 */
const serie = [
  { rotulo: "Instagram", valor: 60 },
  { rotulo: "Google", valor: 30 },
  { rotulo: "Indicação", valor: 10 },
];
const desenhado = (html: string) => (/data-grafico="([a-z]+)"/.exec(html) || [])[1] || null;

describe("Grafico da casca do modelo de site", () => {
  it("o tipo tem o nome do painel; donut vira rosca; nome desconhecido não vira gráfico", () => {
    expect(tipoDoGrafico("linha")).toBe("linha");
    expect(tipoDoGrafico("barras")).toBe("barras");
    expect(tipoDoGrafico("rosca")).toBe("rosca");
    expect(tipoDoGrafico(" Rosca ")).toBe("rosca");
    expect(tipoDoGrafico("donut")).toBe("rosca");
    ["pizza", "area", "", null, undefined, 3].forEach((t) => expect(tipoDoGrafico(t)).toBeNull());
  });

  it("escolhe só o que o tipo aguenta (linha 2+, barras 2 a 8, rosca 2 a 5 sem negativo)", () => {
    const d = (n: number) => Array.from({ length: n }, (_, i) => ({ rotulo: `m${i}`, valor: i + 1 }));
    expect(pontosValidos("linha", d(1))).toBeNull();
    expect(pontosValidos("linha", d(12))!.length).toBe(12);
    expect(pontosValidos("barras", d(9))).toBeNull();
    expect(pontosValidos("barras", d(3))!.length).toBe(3);
    expect(pontosValidos("rosca", d(6))).toBeNull();
    expect(pontosValidos("rosca", [{ rotulo: "a", valor: -1 }, { rotulo: "b", valor: 3 }])).toBeNull();
    expect(pontosValidos("barras", [{ rotulo: "a", valor: Number.NaN }, { rotulo: "b", valor: 2 }])).toBeNull();
    expect(pontosValidos("barras", [{ rotulo: " ", valor: 1 }, { rotulo: "b", valor: 2 }])).toBeNull();
  });

  it("cada tipo desenha a sua forma; rosca e donut desenham a rosca; tipo desconhecido não desenha linha", () => {
    const linha = renderToString(<Grafico tipo="linha" titulo="Visitas" dados={[{ rotulo: "jan", valor: 10 }, { rotulo: "fev", valor: 14 }, { rotulo: "mar", valor: 9 }]} />);
    expect(desenhado(linha)).toBe("linha");
    expect(linha).toMatch(/<path[^>]*stroke="var\(--cor-destaque\)"/);
    expect(linha).not.toMatch(/#[0-9a-f]{6}/i);
    expect(desenhado(renderToString(<Grafico tipo="barras" titulo="Canais" dados={serie} />))).toBe("barras");
    const rosca = renderToString(<Grafico tipo="rosca" titulo="Canais" unidade="%" dados={serie} />);
    expect(desenhado(rosca)).toBe("rosca");
    expect((rosca.match(/<circle/g) || []).length).toBe(3);
    expect(rosca).toMatch(/Instagram: 60 %/);
    expect(desenhado(renderToString(<Grafico tipo="donut" titulo="Canais" dados={serie} />))).toBe("rosca");
    expect(renderToString(<Grafico tipo="area" titulo="Canais" dados={serie} />)).toBe("");
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

  it("a série do pacote (o que o painel grava em base_de_design.grafico) desenha o tipo certo, só com a fonte", () => {
    const doPainel: GraficoDoPacote = { tipo: "rosca", dados: serie, fonte: "briefing de 12/09", regra: "uupm:chart:3" };
    const r = graficoParaDesenhar({}, doPainel)!;
    expect(r.tipo).toBe("rosca");
    expect(r.fonte).toBe("briefing de 12/09");
    expect(graficoParaDesenhar({}, { ...doPainel, fonte: "" })).toBeNull();
    expect(graficoParaDesenhar({}, null)).toBeNull();
    // As props mandam quando vêm; o grafico explícito vence o do pacote.
    expect(graficoParaDesenhar({ tipo: "barras", dados: serie }, doPainel)!.tipo).toBe("barras");
    expect(graficoParaDesenhar({ grafico: { ...doPainel, tipo: "linha" } }, doPainel)!.tipo).toBe("linha");
    const html = renderToString(<Grafico grafico={doPainel} titulo="De onde vêm os clientes" />);
    expect(desenhado(html)).toBe("rosca");
    expect(html).toMatch(/Fonte: <!-- -->briefing de 12\/09|Fonte: briefing de 12\/09/);
    // O pacote vazio do modelo não tem gráfico: <Grafico /> sozinho não desenha nada.
    expect(renderToString(<Grafico titulo="Números" />)).toBe("");
  });
});

/**
 * Integração com o painel (PARTE MESAS): quando `_shared/uiux/consultas.ts`
 * estiver no main, o retorno de graficoParaDados e o pacote montado por
 * pacoteDaBaseDeDesign passam pelo Grafico da casca e o tipo desenhado tem de
 * ser o mesmo. Sem os arquivos (main de hoje), o teste fica pulado.
 */
const consultas = import.meta.glob("../../supabase/functions/_shared/uiux/consultas.ts");
const baseCompleta = import.meta.glob("../../supabase/functions/_shared/uiux/base-completa.ts");
const temPainel = Object.keys(consultas).length > 0 && Object.keys(baseCompleta).length > 0;

describe.skipIf(!temPainel)("Grafico da casca com o que o painel manda (graficoParaDados e pacoteDaBaseDeDesign)", () => {
  const series = [
    { esperado: "linha", serie: { pontos: [{ rotulo: "jan", valor: 10 }, { rotulo: "fev", valor: 12 }, { rotulo: "mar", valor: 15 }], eixo: "tempo", fonte: "dossiê" } },
    { esperado: "barras", serie: { pontos: [{ rotulo: "A", valor: 3 }, { rotulo: "B", valor: 5 }, { rotulo: "C", valor: 2 }], eixo: "categoria", fonte: "briefing" } },
    { esperado: "rosca", serie: { pontos: serie, parte_do_todo: true, fonte: "arquivo do cliente" } },
  ];

  it("cada forma do dado sai desenhada com o tipo que o painel escolheu", async () => {
    const c = (await Object.values(consultas)[0]()) as { graficoParaDados: (s: unknown) => { tipo: string } | null };
    const b = (await Object.values(baseCompleta)[0]()) as { pacoteDaBaseDeDesign: (b: unknown, p: unknown) => { grafico?: GraficoDoPacote | null } | null };
    for (const { esperado, serie: s } of series) {
      const g = c.graficoParaDados(s)!;
      expect(g.tipo).toBe(esperado);
      expect(desenhado(renderToString(<Grafico tipo={g.tipo} dados={s.pontos} fonte={s.fonte} titulo="t" />))).toBe(esperado);
      const pacote = b.pacoteDaBaseDeDesign(null, { tipos: ["numeros"], kitTemFontes: true, serie: s })!;
      expect(pacote.grafico!.tipo).toBe(esperado);
      expect(desenhado(renderToString(<Grafico grafico={pacote.grafico} titulo="t" />))).toBe(esperado);
    }
  });
});
