import { describe, expect, it } from "vitest";
import { contraste, hexParaOklch } from "../../supabase/functions/_shared/cores/oklch";
import { linhaDosPapeis, papeisDaPeca, type PapeisDaPeca } from "../../supabase/functions/_shared/cores/papeis-da-peca";
import { promptDaLamina, type MarcaParaDirecao } from "../../supabase/functions/_shared/direcao-arte";

/** As garantias que valem para qualquer marca. */
function conferirRegra(p: PapeisDaPeca | null) {
  expect(p).not.toBeNull();
  const r = p!;
  expect(contraste(r.texto.hex, r.fundo.hex)).toBeGreaterThanOrEqual(4.5);
  expect(contraste(r.destaque.hex, r.fundo.hex)).toBeGreaterThanOrEqual(3);
  expect(hexParaOklch(r.destaque.hex).c).toBeGreaterThanOrEqual(0.08);
  expect(r.destaque.hex).not.toBe(r.fundo.hex);
  expect(r.apoio.hex).not.toBe(r.fundo.hex);
  return r;
}

describe("papeisDaPeca: regra 60-30-10", () => {
  it("marca com 3 cores boas: usa as três como vieram", () => {
    const r = conferirRegra(papeisDaPeca([
      { nome: "Verde", hex: "#1F4D3A", papel: "primaria" },
      { nome: "Creme", hex: "#F2EBDD", papel: "secundaria" },
      { nome: "Laranja", hex: "#F28C28", papel: "destaque" },
    ]));
    expect(r.fundo).toMatchObject({ hex: "#1F4D3A", origem: "marca" });
    expect(r.apoio).toMatchObject({ hex: "#F2EBDD", origem: "marca" });
    expect(r.destaque).toMatchObject({ hex: "#F28C28", nome: "Laranja", origem: "marca" });
    expect(r.avisos).toEqual([]);
  });

  it("destaque apagado da marca é trocado por um vivo, com aviso", () => {
    const r = conferirRegra(papeisDaPeca([
      { nome: "Azul", hex: "#123C69", papel: "primaria" },
      { nome: "Branco", hex: "#FFFFFF", papel: "neutra" },
      { nome: "Cinza", hex: "#8A8F96", papel: "destaque" },
    ]));
    expect(r.destaque.hex).not.toBe("#8A8F96");
    expect(r.destaque.origem).toBe("calculado");
    expect(r.avisos.join(" ")).toMatch(/#8A8F96 apagado/);
    // Matiz oposto ou vizinho do oposto ao da primária.
    const h0 = hexParaOklch("#123C69").h;
    const d = 180 - Math.abs(((hexParaOklch(r.destaque.hex).h - h0 + 540) % 360) - 180); // distância até o oposto
    expect(d).toBeLessThanOrEqual(60);
  });

  it("destaque sem contraste no fundo dá lugar a outra cor viva da marca que passe", () => {
    const r = conferirRegra(papeisDaPeca([
      { hex: "#F7F7F2", papel: "fundo" },
      { hex: "#C8102E", papel: "secundaria" },
      { hex: "#FFE14D", papel: "destaque" },
      { hex: "#0057B8", papel: "extra" },
    ]));
    expect(r.apoio.hex).toBe("#C8102E");
    expect(r.destaque).toMatchObject({ hex: "#0057B8", origem: "marca" });
  });

  it("marca com 1 cor: completa o trio com neutro tingido e destaque calculado", () => {
    const r = conferirRegra(papeisDaPeca([{ nome: "Roxo", hex: "#5B2A86", papel: "primaria" }]));
    expect(r.fundo.hex).toBe("#5B2A86");
    expect(r.apoio.origem).toBe("calculado");
    expect(hexParaOklch(r.apoio.hex).c).toBeLessThan(0.05);
    expect(r.destaque.origem).toBe("calculado");

    const claro = conferirRegra(papeisDaPeca([{ nome: "Roxo", hex: "#5B2A86", papel: "primaria" }], { fundoPreferido: "claro" }));
    const f = hexParaOklch(claro.fundo.hex);
    expect(claro.fundo.origem).toBe("calculado");
    expect(f.l).toBeGreaterThan(0.94);
    expect(f.c).toBeGreaterThan(0.005); // tingido, não branco puro
    expect(claro.apoio.hex).toBe("#5B2A86");
  });

  it("reel 1: azul #002893 + branco + laranja #FD701C", () => {
    const r = conferirRegra(papeisDaPeca([
      { nome: "Azul", hex: "#002893", papel: "primaria" },
      { nome: "Branco", hex: "#FFFFFF", papel: "neutra" },
      { nome: "Laranja", hex: "#FD701C", papel: "destaque" },
    ]));
    expect(r.fundo.hex).toBe("#002893");
    expect(r.apoio.hex).toBe("#FFFFFF");
    expect(r.destaque).toMatchObject({ hex: "#FD701C", origem: "marca" });
  });

  it("reel 2: #694545 + #D5B2DC (lilás apagado demais para botão)", () => {
    const r = conferirRegra(papeisDaPeca([
      { hex: "#694545", papel: "primaria" },
      { hex: "#D5B2DC", papel: "secundaria" },
    ]));
    expect(r.fundo.hex).toBe("#694545");
    expect(r.apoio.hex).toBe("#D5B2DC");
    expect(r.destaque.origem).toBe("calculado");
  });

  it("reel 3: #000000 + #FFFFFF + lima #CBF615", () => {
    const r = conferirRegra(papeisDaPeca([
      { hex: "#000000", papel: "primaria" },
      { hex: "#FFFFFF", papel: "neutra" },
      { hex: "#CBF615", papel: "destaque" },
    ]));
    expect(r.fundo.hex).toBe("#000000");
    expect(r.apoio.hex).toBe("#FFFFFF");
    expect(r.destaque).toMatchObject({ hex: "#CBF615", origem: "marca" });
    // Em fundo branco a lima não chega a 3:1: o motor troca, nunca deixa o botão sumir.
    const branco = conferirRegra(papeisDaPeca([
      { hex: "#FFFFFF", papel: "primaria" },
      { hex: "#000000", papel: "neutra" },
      { hex: "#CBF615", papel: "destaque" },
    ]));
    expect(branco.destaque.hex).not.toBe("#CBF615");
  });

  it("marca de 2 cores sem papel: fundo neutro tingido, não branco nem preto puro", () => {
    const r = conferirRegra(papeisDaPeca([{ hex: "#002893" }, { hex: "#FFFFFF" }]));
    expect(["#FFFFFF", "#000000"]).not.toContain(r.fundo.hex);
    expect(r.fundo.origem).toBe("calculado");
  });

  it("fundo decidido pela direção é respeitado; texto fraco é trocado", () => {
    const r = conferirRegra(papeisDaPeca([{ hex: "#1F4D3A", papel: "primaria" }], { fundo: "#F2EBDD", texto: "#F5F0E6" }));
    expect(r.fundo.hex).toBe("#F2EBDD");
    expect(r.texto.hex).toBe("#111418");
  });

  it("sem cor nenhuma: null", () => {
    expect(papeisDaPeca([])).toBeNull();
    expect(papeisDaPeca([{ hex: "xyz" }])).toBeNull();
  });
});

describe("linha da paleta no prompt", () => {
  const marca = (paleta: MarcaParaDirecao["paleta"]): MarcaParaDirecao => ({ nomeCliente: "Teste", paleta, estilo: null, regras: null, fontes: [], temLogo: false });
  const card = { ordem: 1, funcao: "capa", texto_exato: "Seu carro novo\nSem entrada", blocos: [], layout: null, evitar: [], ilustracao: null } as never;

  it("diz a proporção e o papel de cada cor, com a razão do texto", () => {
    const p = promptDaLamina(card, marca([
      { nome: "Azul", hex: "#002893", papel: "primaria" },
      { nome: "Branco", hex: "#FFFFFF", papel: "neutra" },
      { nome: "Laranja", hex: "#FD701C", papel: "destaque" },
    ]), { total: 1, carrosselInfinito: false, levaLogo: false });
    const linha = p.split("\n").find((l) => l.startsWith("- Paleta"))!;
    expect(linha).toContain("dominante Azul #002893 em ~60%");
    expect(linha).toContain("apoio Branco #FFFFFF em ~30%");
    expect(linha).toContain("destaque Laranja #FD701C em ~10%, só no botão, no selo e na palavra-chave");
    expect(linha).toMatch(/texto #F5F3EE sobre o fundo \(razão \d+,\d:1\)/);
    expect(linha).not.toContain("calculado");
  });

  it("destaque calculado aparece como de apoio, não como cor oficial", () => {
    const p = promptDaLamina(card, marca([{ hex: "#694545", papel: "primaria" }, { hex: "#D5B2DC", papel: "secundaria" }]), { total: 1, carrosselInfinito: false, levaLogo: false });
    expect(p).toContain("destaque de apoio calculado");
    expect(p).toContain("não é cor oficial da marca");
    const r = papeisDaPeca([{ hex: "#694545", papel: "primaria" }, { hex: "#D5B2DC", papel: "secundaria" }])!;
    expect(linhaDosPapeis(r)).toContain(r.destaque.hex);
    expect(p).toContain(r.destaque.hex);
  });
});
