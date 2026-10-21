import { describe, expect, it } from "vitest";
import { alvosDoPedido, temCartoesSobrepostos } from "@/lib/laboratorio/execucaoDoPedido";
import { canvasVazio, criarNo, ligar, mudarDados, organizar, NOS_COM_MODELO_DE_TEXTO, TIPOS_DE_NO } from "@/lib/laboratorio/nos";

describe("pedido que monta e gera conteúdos", () => {
  it("gera só especialistas novos e deixa publicação e operadores externos para a aprovação própria", () => {
    let c = canvasVazio();
    for (const tipo of ["contexto", "copy", "landing", "por_no_ar", "agente_externo"] as const) c = criarNo(c, tipo, undefined, {}, tipo).canvas;
    expect(alvosDoPedido(canvasVazio(), c)).toEqual(["copy", "landing"]);
  });
  it("corrigir um nó não inclui as outras artes prontas nem mudanças só de posição", () => {
    let c = criarNo(canvasVazio(), "carrossel", { x: 0, y: 0 }, { tema: "Marca" }, "artes").canvas;
    c = criarNo(c, "copy", { x: 0, y: 600 }, { instrucao: "Rascunho" }, "texto").canvas;
    const corrigido = mudarDados(organizar(c), "texto", { instrucao: "Novo gancho" });
    expect(alvosDoPedido(c, corrigido)).toEqual(["texto"]);
    expect(alvosDoPedido(c, organizar(c))).toEqual([]);
  });
  it("trocar o modelo coloca somente esse especialista no orçamento", () => {
    const c = criarNo(canvasVazio(), "copy", undefined, {}, "texto").canvas;
    expect(alvosDoPedido(c, mudarDados(c, "texto", { modelo_id: "modelo-escolhido" }))).toEqual(["texto"]);
  });
  it("atualiza o preço nas páginas ligadas sem refazer uma frente independente", () => {
    let c = canvasVazio();
    for (const tipo of ["produto", "landing", "checkout", "copy"] as const) c = criarNo(c, tipo, undefined, {}, tipo).canvas;
    c = ligar(ligar(c, "produto", "landing"), "landing", "checkout");
    expect(alvosDoPedido(c, mudarDados(c, "produto", { preco: "197" }))).toEqual(["landing", "checkout"]);
  });
  it("uma ligação nova atualiza seu destino e a retirada de uma fonte atualiza a página", () => {
    let c = criarNo(canvasVazio(), "contexto", undefined, {}, "base").canvas;
    c = criarNo(c, "copy", undefined, {}, "copy").canvas;
    const ligado = ligar(c, "base", "copy");
    expect(alvosDoPedido(c, ligado)).toEqual(["copy"]);
    expect(alvosDoPedido(ligado, c)).toEqual(["copy"]);
    const semBase = { ...ligado, nos: ligado.nos.filter((n) => n.id !== "base"), ligacoes: [] };
    expect(alvosDoPedido(ligado, semBase)).toEqual(["copy"]);
  });
});

describe("espaço e modelos do canvas", () => {
  it("reorganiza geometria antiga sem alterar conteúdo ou ligações", () => {
    let c = criarNo(canvasVazio(), "contexto", { x: 0, y: 0 }, { texto: "Briefing" }, "base").canvas;
    c = criarNo(c, "copy", { x: 320, y: 0 }, {}, "texto").canvas;
    c = ligar(c, "base", "texto");
    expect(temCartoesSobrepostos(c)).toBe(true);
    const organizado = organizar(c);
    expect(temCartoesSobrepostos(organizado)).toBe(false);
    expect(organizado.ligacoes).toEqual(c.ligacoes);
    expect(organizado.nos.map((n) => n.dados)).toEqual(c.nos.map((n) => n.dados));
  });
  it("oferece seleção de texto só nos especialistas que utilizam esse modelo", () => {
    for (const tipo of NOS_COM_MODELO_DE_TEXTO) expect(TIPOS_DE_NO[tipo].campos.filter((c) => c.chave === "modelo_id")).toHaveLength(1);
    for (const tipo of ["imagem", "logo", "crm", "dominio", "teste_ab", "fontes_trafego"] as const) expect(TIPOS_DE_NO[tipo].campos.some((c) => c.chave === "modelo_id")).toBe(false);
    expect(TIPOS_DE_NO.carrossel.campos.some((c) => c.chave === "motor")).toBe(true);
    expect(TIPOS_DE_NO.logo.campos.some((c) => c.chave === "motor")).toBe(true);
  });
});
