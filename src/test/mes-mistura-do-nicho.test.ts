// @vitest-environment node
import { describe, expect, it } from "vitest";
import { gradeDoMes, type FormatoDaVaga } from "../../supabase/functions/agente-calendario/modulos/cadencia-do-mes";
import {
  cadenciaDoNicho,
  comMisturaDoNicho,
  falaDaSugestao,
  misturaDoMes,
  mixDoPerfil,
  perfilDaMistura,
  perfilDaResposta,
  perfilPorRegra,
  perguntaDaMistura,
  trocasParaMisturar,
} from "../../supabase/functions/agente-calendario/modulos/mistura-do-nicho";
import { sugestoesDoMes } from "@/components/mesa/oQueFazerAgora";

/**
 * 23/10/2026 (dono: "diversificar conteúdos e mesclar, e não ficar somente carrossel e arte; entender conforme o
 * nicho; ele já dá a sugestão de forma proativa"). Prova que o mês gerado não sai num formato só.
 */

const NOVEMBRO = { inicio: "2026-11-01", fim: "2026-11-30" };

function formatosDoMes(nicho: string, frequencia = 12, perfilDaConta?: string) {
  const perfil = perfilPorRegra(nicho);
  const cad = cadenciaDoNicho(frequencia, NOVEMBRO.inicio, NOVEMBRO.fim, perfil, perfilDaConta);
  return { perfil, cad, grade: gradeDoMes(cad, NOVEMBRO.inicio, NOVEMBRO.fim, "2026-10-23") };
}

function conferirMisturado(formatos: FormatoDaVaga[]) {
  const conta: Record<string, number> = {};
  formatos.forEach((f) => { conta[String(f)] = (conta[String(f)] || 0) + 1; });
  expect(formatos.every((f) => f !== null)).toBe(true);
  expect(Object.keys(conta).length).toBeGreaterThanOrEqual(3);
  for (const k of Object.keys(conta)) expect(conta[k] / formatos.length).toBeLessThanOrEqual(0.5);
  for (let i = 1; i < formatos.length; i++) expect(formatos[i]).not.toBe(formatos[i - 1]);
}

describe("mês gerado pelo nicho não sai monoformato", () => {
  it("paisagismo (Terra Flor): vídeo, foto e carrossel misturados, sem repetir em sequência", () => {
    const { perfil, cad, grade } = formatosDoMes("Paisagismo e projetos de jardins residenciais");
    expect(perfil.id).toBe("ambiente_e_projeto");
    expect(cad.por_semana).toBe(3);
    expect(grade).toHaveLength(12);
    conferirMisturado(grade.map((v) => v.formato));
    expect(grade.filter((v) => v.formato === "video").length).toBeGreaterThanOrEqual(4);
    expect(grade.filter((v) => v.formato === "foto").length).toBeGreaterThanOrEqual(4);
  });

  it("móveis planejados (Softy): o mesmo perfil de ambiente, com vídeo de inspiração de cozinha", () => {
    const { perfil, grade } = formatosDoMes("Softy Móveis: móveis planejados e cozinhas sob medida");
    expect(perfil.id).toBe("ambiente_e_projeto");
    expect(perfil.video).toContain("inspiração");
    conferirMisturado(grade.map((v) => v.formato));
  });

  it("serviço que explica (advocacia): carrossel lidera, mas com vídeo e estático", () => {
    const { perfil, grade } = formatosDoMes("Advocacia previdenciária, INSS");
    expect(perfil.id).toBe("servico_que_explica");
    const formatos = grade.map((v) => v.formato);
    expect(formatos.filter((f) => f === "carrossel").length).toBeGreaterThan(0);
    expect(formatos.filter((f) => f === "video").length).toBeGreaterThan(0);
    expect(new Set(formatos).size).toBeGreaterThanOrEqual(3);
  });

  it("nenhum formato passa da metade da semana, de 2 a 5 posts", () => {
    for (const p of ["ambiente_e_projeto", "produto_na_mao", "servico_que_explica", "pessoa_e_autoridade", "varejo_e_oferta"]) {
      for (let n = 2; n <= 5; n++) {
        const m = mixDoPerfil(perfilDaMistura(p), n);
        const valores = [m.foto, m.carrossel, m.estatico, m.video || 0];
        expect(valores.reduce((a, b) => a + b, 0)).toBe(n);
        expect(Math.max(...valores)).toBeLessThanOrEqual(Math.ceil(n / 2));
        expect(valores.filter((v) => v > 0).length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("a mistura pedida pela equipe vale sobre a do nicho; sem mistura, entra a do nicho", () => {
    const pedida = { por_semana: 3, mix: { foto: 2, carrossel: 1, estatico: 0, arte: 0 }, dias: [], fonte: "pedido" };
    expect(comMisturaDoNicho(pedida, perfilDaMistura("pessoa_e_autoridade"))).toBe(pedida);
    const so = comMisturaDoNicho({ por_semana: 3, mix: null, dias: [], fonte: "pedido" }, perfilDaMistura("ambiente_e_projeto"));
    expect(so.mix).not.toBeNull();
    expect(so.fonte).toBe("pedido+nicho:ambiente_e_projeto");
  });

  it("perfil da conta em fotos (Mesa Foto) puxa a foto", () => {
    const m = mixDoPerfil(perfilDaMistura("produto_na_mao"), 4, "fotos");
    expect(m.foto).toBe(2);
  });

  it("o Jev escolhe o perfil (Choice); sem resposta, a regra por palavras", () => {
    const q = perguntaDaMistura();
    expect(q.type).toBe("choice");
    expect(Object.keys(q.criteria)).toContain("ambiente_e_projeto");
    expect(perfilDaResposta({ choice: "varejo_e_oferta" }, "paisagismo").perfil.id).toBe("varejo_e_oferta");
    const semJev = perfilDaResposta(null, "Ótica no centro");
    expect(semJev).toMatchObject({ fonte: "regra" });
    expect(semJev.perfil.id).toBe("produto_na_mao");
  });
});

describe("sugestão proativa do mês repetitivo", () => {
  const carrosseis = Array.from({ length: 10 }, (_, i) => ({
    id: `p${i}`,
    title: i === 3 ? "Cozinha planejada: antes e depois" : `Dica ${i + 1} para escolher móveis`,
    due_date: `2026-11-${String(3 + i * 2).padStart(2, "0")}`,
    delivery_type: "carousel",
    status: "todo",
  }));

  it("antes: 10 de 10 em carrossel é repetitivo; depois das trocas, carrossel fica com no máximo metade", () => {
    const antes = misturaDoMes(carrosseis);
    expect(antes.repetitivo).toBe(true);
    expect(antes.frase).toBe("10 de 10 peças em carrosséis, nenhum vídeo, nenhuma foto");
    const perfil = perfilDaMistura("ambiente_e_projeto");
    // O Jev dá a nota de cada tema como vídeo e como foto; o tema de antes e depois é o melhor vídeo.
    const notas: Record<string, { score: number }> = {};
    carrosseis.forEach((_, i) => { notas[`v${i}`] = { score: i === 3 ? 3 : 1 }; notas[`f${i}`] = { score: 1.5 }; });
    const trocas = trocasParaMisturar(carrosseis, perfil, "2026-10-23", notas);
    expect(trocas).toHaveLength(4);
    expect(trocas[0]).toMatchObject({ id: "p3", para: "video" });
    expect(trocas.filter((t) => t.para === "video").length).toBe(2);
    expect(trocas.filter((t) => t.para === "foto").length).toBe(2);
    const depois = misturaDoMes(carrosseis.map((p) => {
      const t = trocas.find((x) => x.id === p.id);
      return t ? { ...p, title: t.para === "foto" ? `Peça de foto: ${p.title}` : p.title, delivery_type: t.para === "video" ? "reel" : "carousel" } : p;
    }));
    expect(depois.repetitivo).toBe(false);
    expect(depois.por_formato.carrossel / depois.total).toBeLessThanOrEqual(0.6);
    expect(falaDaSugestao(antes, trocas, perfil)).toContain("Proponho trocar 2 por vídeos");
  });

  it("peça passada ou feita não é trocada; mês misturado não sugere nada", () => {
    expect(trocasParaMisturar(carrosseis.map((p) => ({ ...p, status: "done" })), perfilDaMistura("ambiente_e_projeto"), "2026-10-23")).toEqual([]);
    const misturado = carrosseis.map((p, i) => ({ ...p, delivery_type: i % 2 ? "reel" : "carousel" }));
    expect(misturaDoMes(misturado).repetitivo).toBe(false);
  });

  it("o topo do Mês mostra a sugestão primeiro, com a ação de misturar", () => {
    const s = sugestoesDoMes({ hoje: "2026-10-23", mes: "2026-11-01", principais: [], noticiasQueServem: null, emAltaNoNicho: 0, leituraDaSemana: true, datasComPost: null, pecas: carrosseis });
    expect(s[0]).toMatchObject({ chave: "mistura", acao: "mistura" });
    expect(s[0].texto).toContain("10 de 10");
  });
});
