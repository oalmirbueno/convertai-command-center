import { describe, expect, it } from "vitest";
import {
  direcaoDeFotoCompleta,
  ESQUEMA_DA_DIRECAO_DE_FOTO,
  entregaDaPecaDeFoto,
  faltasDaDirecao,
  formatoDoMes,
  lerValorDaPeca,
  linkDaPecaNaMesaFoto,
  normalizarDirecaoDeFoto,
  tituloDaPecaDeFoto,
} from "../../supabase/functions/agente-calendario/modulos/peca-de-foto";
import {
  cadenciaDasFontes,
  cadenciaDosNumeros,
  conferirPlano,
  encaixarNaGrade,
  formatosDaSemana,
  fraseDaCadencia,
  gradeDoMes,
  lerCadencia,
  pareceTutorial,
  pendenciasDosItens,
  semanaIso,
  temasRepetidos,
  textoDoAjuste,
} from "../../supabase/functions/agente-calendario/modulos/cadencia-do-mes";

const PEDIDO_DO_DONO =
  "Este mês, conteúdo mais sobre ótica mesmo, o que o cliente de fato procura, não coisas de tutorial, mais direto, linguagem clara para o cliente, direto é mais conexão. No calendário, dentre os 3 posts por semana, 2 posts de foto (a gente vai gerar as fotos na mesa de fotos, com ângulos, completo) e 1 arte, um carrossel normal.";

describe("formato foto no Mês", () => {
  it("normaliza foto, fotos, ensaio e foto de produto para foto", () => {
    for (const v of ["foto", "Fotos", "ensaio", "foto de produto", "Post de foto", "fotografia", "carrossel de fotos", "photo"]) {
      expect(formatoDoMes(v), v).toBe("foto");
    }
    expect(formatoDoMes("carrossel")).toBe("carrossel");
    expect(formatoDoMes("Estático")).toBe("estatico");
    expect(formatoDoMes("imagem")).toBe("estatico");
    expect(formatoDoMes("reels")).toBeNull();
    expect(formatoDoMes("")).toBeNull();
  });

  it("a direção da foto segue o contrato com a Mesa Foto (campos e padrões)", () => {
    const d = normalizarDirecaoDeFoto({ assunto: "Armação tartaruga", angulos: ["frontal", "3/4", "frontal"], pessoa: "ninguém" }, { tema: "Óculos de sol" });
    expect(Object.keys(d).sort()).toEqual(["angulos", "assunto", "cenario", "luz", "objetivo", "pessoa", "quantidade", "referencias", "texto_na_foto"]);
    expect(d.assunto).toBe("Armação tartaruga");
    expect(d.angulos).toEqual(["frontal", "3/4"]);
    expect(d.pessoa).toBeNull();
    expect(d.quantidade).toBe(4);
    expect(d.texto_na_foto).toBeNull();
    expect(d.referencias).toEqual([]);
    expect(faltasDaDirecao(d)).toEqual(["cenario", "luz"]);
    const completa = direcaoDeFotoCompleta(normalizarDirecaoDeFoto({}, { tema: "Lente antirreflexo" }), "Lente antirreflexo");
    expect(faltasDaDirecao(completa)).toEqual([]);
    expect(completa.assunto).toBe("Lente antirreflexo");
    // O esquema estrito pede todos os campos do contrato.
    expect([...ESQUEMA_DA_DIRECAO_DE_FOTO.required].sort()).toEqual(Object.keys(d).sort());
  });

  it("entrega, título e link da peça de foto", () => {
    expect(entregaDaPecaDeFoto(normalizarDirecaoDeFoto({ quantidade: 1 }))).toBe("static");
    expect(entregaDaPecaDeFoto(normalizarDirecaoDeFoto({}))).toBe("carousel");
    expect(tituloDaPecaDeFoto("Óculos no rosto")).toBe("Peça de foto: Óculos no rosto");
    expect(tituloDaPecaDeFoto("Peça de foto: X")).toBe("Peça de foto: X");
    const pid = "6f1c2a3b-1111-4222-8333-444455556666";
    const tid = "7f1c2a3b-1111-4222-8333-444455556666";
    expect(linkDaPecaNaMesaFoto("c1", { propostaId: pid, indice: 3 })).toBe(`/mesa-foto?client=c1&peca=${pid}:3`);
    expect(linkDaPecaNaMesaFoto("c1", { propostaId: pid, indice: 0, taskId: tid, volta: "/mesa?client=c1&aba=mes" })).toBe(
      `/mesa-foto?client=c1&peca=${pid}:0&task=${tid}&volta=${encodeURIComponent("/mesa?client=c1&aba=mes")}`,
    );
    expect(lerValorDaPeca(`${pid}:3`)).toEqual({ propostaId: pid, indice: 3 });
    expect(lerValorDaPeca("x:3")).toBeNull();
  });
});

describe("cadência pedida", () => {
  it("lê o pedido real do dono: 3 por semana, 2 fotos e 1 carrossel", () => {
    const c = lerCadencia(PEDIDO_DO_DONO);
    expect(c).not.toBeNull();
    expect(c!.por_semana).toBe(3);
    expect(c!.mix).toEqual({ foto: 2, carrossel: 1, estatico: 0, arte: 0 });
    expect(fraseDaCadencia(c!)).toBe("3 por semana: 2 fotos e 1 carrossel");
  });

  it("variantes de frequência e mistura", () => {
    expect(lerCadencia("três vezes na semana")!.por_semana).toBe(3);
    expect(lerCadencia("quero 4x por semana")!.por_semana).toBe(4);
    expect(lerCadencia("2 posts semanais")!.por_semana).toBe(2);
    expect(lerCadencia("3/semana")!.por_semana).toBe(3);
    const m = lerCadencia("1 carrossel e 2 fotos por semana");
    expect(m!.por_semana).toBe(3);
    expect(m!.mix).toEqual({ foto: 2, carrossel: 1, estatico: 0, arte: 0 });
    // Só parte da mistura: o resto é arte (Estúdio).
    expect(lerCadencia("3 por semana, 2 de foto")!.mix).toEqual({ foto: 2, carrossel: 0, estatico: 0, arte: 1 });
    // Mistura que não fecha com a frequência fica de fora.
    const solto = lerCadencia("3 por semana, cada post com 4 fotos");
    expect(solto!.por_semana).toBe(3);
    expect(solto!.mix).toBeNull();
    // Dias pedidos.
    expect(lerCadencia("postar segunda, quarta e sexta")!.dias).toEqual([1, 3, 5]);
    expect(lerCadencia("tudo certo com o mês")).toBeNull();
  });

  it("fontes em ordem e números do modelo", () => {
    expect(cadenciaDasFontes([{ texto: "sem cadência", fonte: "pedido" }, { texto: "Frequência: 2 publicações por semana.", fonte: "plano" }])!.fonte).toBe("plano");
    expect(cadenciaDosNumeros({ por_semana: 3, fotos: 2, carrosseis: 1 })!.mix).toEqual({ foto: 2, carrossel: 1, estatico: 0, arte: 0 });
    expect(cadenciaDosNumeros({})).toBeNull();
  });
});

describe("grade, encaixe e conferência", () => {
  const cad = lerCadencia(PEDIDO_DO_DONO)!;

  it("outubro de 2026 a partir de 02/10: 12 vagas, segunda, quarta e sexta, 8 fotos e 4 carrosséis", () => {
    const grade = gradeDoMes(cad, "2026-10-01", "2026-10-31", "2026-10-02");
    expect(grade).toHaveLength(12);
    expect(grade.slice(0, 3).map((v) => v.data)).toEqual(["2026-10-05", "2026-10-07", "2026-10-09"]);
    expect(grade.slice(0, 3).map((v) => v.formato)).toEqual(["foto", "carrossel", "foto"]);
    expect(grade.filter((v) => v.formato === "foto")).toHaveLength(8);
    expect(semanaIso("2026-10-05")).toBe("2026-W41");
    expect(semanaIso("2026-01-01")).toBe("2026-W01");
    expect(formatosDaSemana({ foto: 2, carrossel: 1, estatico: 0, arte: 0 }, 2, 3).length).toBe(2);
  });

  it("o caso real (9 itens, nenhum de foto) encaixa, aponta vagas e troca formatos", () => {
    const grade = gradeDoMes(cad, "2026-10-01", "2026-10-31", "2026-10-02");
    const datas = ["2026-10-05", "2026-10-07", "2026-10-12", "2026-10-14", "2026-10-16", "2026-10-19", "2026-10-21", "2026-10-26", "2026-10-28"];
    const itens = datas.map((data, i) => ({ data, formato: (i % 2 ? "estatico" : "carrossel") as "estatico" | "carrossel", tema: `Tema ${i}` }));
    const antes = conferirPlano(itens, cad, grade);
    expect(antes.ok).toBe(false);
    expect(antes.frase).toContain("9 posts");
    const e = encaixarNaGrade(itens, grade);
    expect(e.itens).toHaveLength(9);
    expect(e.sobras).toHaveLength(0);
    expect(e.vagas_livres).toHaveLength(3);
    const depois = e.itens.map((x) => ({ data: x.vaga.data, formato: x.formato }));
    const cheio = depois.concat(e.vagas_livres.map((v) => ({ data: v.data, formato: (v.formato === "arte" || !v.formato ? "carrossel" : v.formato) as "foto" | "carrossel" | "estatico" })));
    const conf = conferirPlano(cheio, cad, grade);
    expect(conf.ok).toBe(true);
    expect(conf.frase).toBe("12 posts: 8 fotos e 4 carrosséis, 3 por semana.");
    expect(conf.semanas.every((s) => s.total === 3 && s.foto === 2)).toBe(true);
  });

  it("sobra o que passa da cadência", () => {
    const grade = gradeDoMes({ por_semana: 1, mix: null, dias: [], fonte: "pedido" }, "2026-10-05", "2026-10-09");
    const e = encaixarNaGrade([{ data: "2026-10-05", formato: "carrossel" as const }, { data: "2026-10-06", formato: "foto" as const }], grade);
    expect(e.itens).toHaveLength(1);
    expect(e.sobras).toHaveLength(1);
  });
});

describe("conteúdo: tutorial e repetição", () => {
  it("marca título de tutorial", () => {
    for (const t of ["Entenda o que é astigmatismo", "O que significa grau esférico", "Como funciona a lente multifocal", "Saiba escolher", "Aprenda a limpar", "Passo a passo da lente", "Tutorial: armação"]) {
      expect(pareceTutorial(t), t).toBe(true);
    }
    for (const t of ["Seu rosto pede armação redonda?", "Óculos de sol que combinam com o verão", "Quanto custa uma lente boa de verdade"]) {
      expect(pareceTutorial(t), t).toBe(false);
    }
  });

  it("acha tema repetido e monta o pedido de ajuste", () => {
    expect(temasRepetidos(["Óculos de sol para o verão", "Óculos de sol no verão", "Lente para dirigir à noite"])).toEqual([[0, 1]]);
    const itens = [
      { data: "2026-10-05", formato: "foto" as const, tema: "Entenda as lentes", foto: null },
      { data: "2026-10-07", formato: "carrossel" as const, tema: "Armação para rosto redondo" },
    ];
    const p = pendenciasDosItens(itens);
    expect(p).toEqual([{ n: 0, motivos: ["direcao_da_foto", "tutorial"] }]);
    const txt = textoDoAjuste([{ data: "2026-10-09", formato: "foto" }], itens, p);
    expect(txt).toContain("vaga 1: 2026-10-09 · foto");
    expect(txt).toContain("item 1: 2026-10-05 · foto");
  });
});
