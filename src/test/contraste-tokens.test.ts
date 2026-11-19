import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hexParaRgb, hslParaRgb, lerTokensDoCss, nota, razaoDeContraste, rgbParaHex } from "@/lib/design/contraste";
import { verificarTokens } from "@/lib/design/verificacoes";
import { CORES_DA_EMPRESA, SUPERFICIES_DA_TINTA, SUPERFICIES_DO_TEMA, variaveisDaCor } from "@/lib/produto/aparencia";

const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
const linhas = verificarTokens(css);
const fmt = (l: { tema: string; par: string; razao: number; minimo: number }) => `${l.tema} · ${l.par}: ${l.razao.toFixed(2)} (mínimo ${l.minimo})`;

describe("contraste: a conta da WCAG", () => {
  it("converte HSL e HEX e mede como a WCAG 2.2", () => {
    expect(rgbParaHex(hslParaRgb("145 80% 38%"))).toBe("#13ae54");
    expect(hexParaRgb("#fff")).toEqual([255, 255, 255]);
    expect(razaoDeContraste("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(razaoDeContraste("0 0% 100%", "0 0% 100%")).toBeCloseTo(1, 5);
    expect(razaoDeContraste("#767676", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(nota(7)).toBe("AAA");
    expect(nota(4.5)).toBe("AA");
    expect(nota(3)).toBe("AA grande");
    expect(nota(2.99)).toBe("reprova");
  });

  it("lê os dois temas do index.css e o claro herda do escuro", () => {
    const { escuro, claro } = lerTokensDoCss(css);
    expect(escuro["--background"]).toBe("240 4% 4.5%");
    expect(claro["--card"]).toBe("0 0% 100%");
    expect(claro["--radius"]).toBe(escuro["--radius"]);
  });
});

describe("contraste dos tokens (60-30-10, WCAG 2.2 AA)", () => {
  it("todo texto do painel passa 4,5:1 nos dois temas", () => {
    const ruins = linhas.filter((l) => l.grupo === "texto" && !l.passa).map(fmt);
    expect(ruins).toEqual([]);
  });

  it("botão e anel passam 3:1 contra o fundo e o cartão nos dois temas", () => {
    const graficos = linhas.filter((l) => l.grupo === "grafico");
    expect(graficos.length).toBe(8);
    expect(graficos.filter((l) => !l.passa).map(fmt)).toEqual([]);
  });

  it("as seis cores da empresa passam em tudo nos dois temas", () => {
    const empresa = linhas.filter((l) => l.grupo === "empresa");
    expect(empresa.length).toBeGreaterThanOrEqual(6 * 5 * 2);
    expect(empresa.filter((l) => !l.passa).map(fmt)).toEqual([]);
  });

  it("o verde do claro na lista da empresa é o mesmo do painel", () => {
    const { escuro, claro } = lerTokensDoCss(css);
    const verde = CORES_DA_EMPRESA[0];
    expect(verde.claro).toBe(claro["--primary"]);
    expect(verde.escuro).toBe(escuro["--primary"]);
    expect(verde.tomDoTextoNoClaro).toBe(claro["--primary-text"]);
    expect(SUPERFICIES_DO_TEMA.dark).toEqual({ fundo: escuro["--background"], cartao: escuro["--card"] });
    expect(SUPERFICIES_DO_TEMA.light).toEqual({ fundo: claro["--background"], cartao: claro["--card"] });
  });

  it("um destaque só: no claro, o verde de preenchimento é o mesmo em botão, anel, menu e gráfico", () => {
    const { claro } = lerTokensDoCss(css);
    for (const t of ["--accent", "--ring", "--sidebar-primary", "--sidebar-ring", "--chart-1"]) expect(claro[t]).toBe(claro["--primary"]);
  });

  it("a cor da empresa troca também o cartão de destaque, com texto que lê", () => {
    for (const tema of ["dark", "light"] as const) {
      for (const c of CORES_DA_EMPRESA.slice(1)) {
        const v = variaveisDaCor(c.id, tema);
        expect(v["--accent-solid"]).toBe(v["--primary"]);
        expect(razaoDeContraste(v["--on-accent"], v["--accent-solid"])).toBeGreaterThanOrEqual(4.5);
        expect(razaoDeContraste(v["--on-accent-muted"], v["--accent-solid"])).toBeGreaterThanOrEqual(4.5);
        expect(razaoDeContraste(v["--on-accent"], v["--accent-solid-deep"])).toBeGreaterThanOrEqual(4.5);
        expect(razaoDeContraste(v["--primary-text"], SUPERFICIES_DO_TEMA[tema].fundo)).toBeGreaterThanOrEqual(4.5);
        expect(razaoDeContraste(v["--success"], SUPERFICIES_DO_TEMA[tema].cartao)).toBeGreaterThanOrEqual(4.5);
        expect(razaoDeContraste(v["--success"], v["--success-soft"])).toBeGreaterThanOrEqual(4.5);
        // .ds-accent: o texto apagado (--muted-foreground) lê também sobre o poço (--muted).
        expect(razaoDeContraste(v["--on-accent-muted"], v["--accent-solid-deep"])).toBeGreaterThanOrEqual(4.5);
        // .ds-ink: o destaque segue a cor escolhida (não fica um segundo verde) e lê no cartão de tinta.
        const tinta = SUPERFICIES_DA_TINTA[tema];
        expect(v["--card-ink-accent"]).toBeTruthy();
        expect(razaoDeContraste(v["--card-ink-accent"], tinta.cartao)).toBeGreaterThanOrEqual(4.5);
        expect(razaoDeContraste(v["--card-ink-accent"], tinta.poco)).toBeGreaterThanOrEqual(4.5);
        expect(razaoDeContraste(tinta.textoNoBotao, v["--card-ink-accent"])).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("o cartão de tinta da aparência é o mesmo do index.css (claro no escuro, escuro no claro)", () => {
    const { escuro, claro } = lerTokensDoCss(css);
    expect(SUPERFICIES_DA_TINTA.dark.cartao).toBe(escuro["--card-ink"]);
    expect(SUPERFICIES_DA_TINTA.dark.poco).toBe(escuro["--card-ink-well"]);
    expect(SUPERFICIES_DA_TINTA.light.cartao).toBe(claro["--card-ink"]);
    expect(SUPERFICIES_DA_TINTA.light.poco).toBe(claro["--card-ink-well"]);
    expect(css).toMatch(/\.light \.ds-ink \{[^}]*--primary-foreground: 150 30% 4%;/);
    expect(css).toMatch(/\.dark \.ds-ink,[^{]*\{[^}]*--primary-foreground: 0 0% 100%;/);
  });

  it("verde ou nada não troca o --card-ink-accent (fica o do painel)", () => {
    expect(variaveisDaCor("verde", "dark")).toEqual({});
    expect(variaveisDaCor(undefined, "light")).toEqual({});
  });
});
