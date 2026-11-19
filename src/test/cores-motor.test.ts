import { describe, expect, it } from "vitest";
import {
  ajustarAteContraste, apca, contraste, escala, harmonia, hexParaOklch, hexValido, nomeDaCor, oklchParaHex, simularDaltonismo,
} from "../../supabase/functions/_shared/cores/oklch";
import { conferir, corProibida, gerarPropostas, novaAlternativa, trocarPapeis, type Briefing } from "../../supabase/functions/_shared/cores/paleta";
import { nichoPorTexto } from "../../supabase/functions/_shared/cores/nichos";

describe("matemática da cor", () => {
  it("ida e volta no OKLCH mantém o HEX", () => {
    for (const h of ["#002893", "#FD701C", "#CBF615", "#694545", "#D5B2DC", "#7A8B6F", "#FFFFFF", "#000000"]) {
      expect(oklchParaHex(hexParaOklch(h))).toBe(h);
    }
  });
  it("valores de referência do OKLCH", () => {
    const azul = hexParaOklch("#0000FF");
    expect(azul.l).toBeCloseTo(0.452, 2);
    expect(azul.h).toBeCloseTo(264.05, 0);
  });
  it("contraste WCAG conhecido", () => {
    expect(contraste("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contraste("#777777", "#FFFFFF")).toBeCloseTo(4.48, 1);
  });
  it("APCA: preto no branco perto de 106, branco no preto negativo", () => {
    expect(apca("#000000", "#FFFFFF")).toBeCloseTo(106.04, 0);
    expect(apca("#FFFFFF", "#000000")).toBeLessThan(-100);
  });
  it("escala 50-950 tem 11 tons e guarda a original", () => {
    const e = escala("#81D8D0");
    expect(e).toHaveLength(11);
    expect(e.filter((d) => d.original)).toHaveLength(1);
    expect(e.find((d) => d.original)!.hex).toBe("#81D8D0");
    // claros em cima, escuros embaixo
    expect(hexParaOklch(e[0].hex).l).toBeGreaterThan(hexParaOklch(e[10].hex).l);
  });
  it("ajusta o tom até passar no contraste sem mudar de matiz", () => {
    const novo = ajustarAteContraste("#81D8D0", "#FFFFFF", 4.5)!;
    expect(contraste(novo, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    expect(Math.abs(hexParaOklch(novo).h - hexParaOklch("#81D8D0").h)).toBeLessThan(6);
  });
  it("complementar gira 180 graus", () => {
    const [a, b] = harmonia("#002893", "complementar");
    expect(a).toBe("#002893");
    const d = Math.abs(hexParaOklch(b).h - hexParaOklch(a).h);
    expect(Math.min(d, 360 - d)).toBeGreaterThan(150);
  });
  it("daltonismo devolve HEX válido", () => {
    expect(hexValido(simularDaltonismo("#FF0000", "deuteranopia"))).not.toBeNull();
  });
  it("nomes de cor em português que não erram a família", () => {
    expect(nomeDaCor("#7A8B6F")).toBe("Sálvia");
    expect(nomeDaCor("#3F1F16")).toBe("Café");
    expect(nomeDaCor("#EAE0D4")).toBe("Bege");
    expect(nomeDaCor("#000000")).toBe("Preto");
    expect(nomeDaCor("#694545")).toBe("Marrom-vinho");
    expect(nomeDaCor("#002893")).toMatch(/Azul/);
    expect(nomeDaCor("#FD701C")).toMatch(/Laranja/);
  });
});

describe("famílias proibidas", () => {
  it("vermelho bloqueia vermelho e não bloqueia azul", () => {
    expect(corProibida("#E53935", ["Vermelho"])).toBe("Vermelho");
    expect(corProibida("#1E88E5", ["Vermelho"])).toBeNull();
  });
  it("nicho pelo texto livre", () => {
    expect(nichoPorTexto("Studio de pilates")?.id).toBe("academia");
    expect(nichoPorTexto("escritório de advocacia")?.id).toBe("advocacia");
  });
});

const PILATES: Briefing = {
  marca: "Raiz Pilates", nicho: "Academias", subnicho: "Bem-estar", preco: "premium", objetivo: "Diferenciação",
  personalidade: ["Natural", "Acolhedora", "Moderna"], estilos: ["Orgânico", "Minimalista"],
  corPrincipal: "#7A8B6F", preferidas: ["Terracota"], evitar: ["Vermelho"], quantas: 3, aplicacoes: ["Site", "Redes sociais"],
};

describe("motor de propostas", () => {
  it("três propostas com a cor fixa exata e todas as conferências passando", () => {
    const { propostas } = gerarPropostas(PILATES);
    expect(propostas).toHaveLength(3);
    expect(new Set(propostas.map((p) => p.estrutura)).size).toBe(3);
    for (const p of propostas) expect(p.cores.some((c) => c.hex === "#7A8B6F")).toBe(true);
    const falhas = conferir(propostas, PILATES).filter((c) => !c.ok);
    expect(falhas).toEqual([]);
  });
  it("o destaque é forte e salta da dominante (o erro que o Sacana comete)", () => {
    const { propostas } = gerarPropostas(PILATES);
    for (const p of propostas) {
      const d = p.cores.find((c) => c.papel === "destaque")!;
      const m = p.cores.find((c) => c.papel === "dominante")!;
      expect(contraste(d.hex, m.hex)).toBeGreaterThanOrEqual(3);
      expect(hexParaOklch(d.hex).c).toBeGreaterThanOrEqual(0.08);
    }
  });
  it("sem cor fixa, para vários nichos e preços, tudo passa", () => {
    const casos: Briefing[] = [
      { marca: "Lex", nicho: "Advocacia", preco: "premium", personalidade: ["Elegante"] },
      { marca: "Doce Mel", nicho: "Confeitaria", evitar: ["Rosa"], preferidas: ["Azul-marinho"] },
      { marca: "Byte", nicho: "Tecnologia", preco: "intermediario", personalidade: ["Ousada", "Tecnológica"] },
      { marca: "Força Total", nicho: "Academias", preco: "acessivel", personalidade: ["Ousada"] },
      { marca: "Casa Viva", nicho: "Imobiliárias", preco: "luxo" },
      { marca: "Já Limpo", nicho: "limpeza", quantas: 4 },
      { marca: "Uma Cor", nicho: "Moda", quantas: 1 },
    ];
    for (const b of casos) {
      const { propostas } = gerarPropostas(b);
      const falhas = conferir(propostas, b).filter((c) => !c.ok);
      expect({ marca: b.marca, falhas }).toEqual({ marca: b.marca, falhas: [] });
    }
  });
  it("os exemplos dos reels como cor fixa também fecham", () => {
    for (const fixa of ["#002893", "#694545", "#000000", "#F4E1D2", "#381A56", "#483B0F", "#DFE7ED"]) {
      const b: Briefing = { marca: "Teste", nicho: "Tecnologia", corPrincipal: fixa };
      const falhas = conferir(gerarPropostas(b).propostas, b).filter((c) => !c.ok);
      expect({ fixa, falhas }).toEqual({ fixa, falhas: [] });
    }
  });
  it("nova alternativa sai diferente das existentes", () => {
    const { propostas } = gerarPropostas(PILATES);
    const nova = novaAlternativa(PILATES, propostas, 1);
    expect(nova.cores.some((c) => c.hex === "#7A8B6F")).toBe(true);
  });
  it("trocar papéis mantém as cores e recalcula", () => {
    const p = gerarPropostas(PILATES).propostas[0];
    const t = trocarPapeis(p, PILATES, "dominante", "apoio");
    expect(t.cores.find((c) => c.papel === "dominante")!.hex).toBe(p.cores.find((c) => c.papel === "apoio")!.hex);
  });
});
