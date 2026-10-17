import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blocoDoHype, blocoDoNichoAgora, contarSinais, hypesQueValem, validadeEmDias } from "../../supabase/functions/agente-calendario/modulos/hype-no-conteudo";

/**
 * 17/10/2026: o hype da semana entra tematizando toda geração do Mês enquanto vale,
 * e a busca traz a segunda lista "Em alta no nicho" com os sinais reais do Instagram.
 */
const linha = {
  semana: "2026-10-12",
  resumo: "Semana de Halloween chegando",
  itens: [
    { titulo: "Halloween", janela: "proximas_semanas", como_usar: "Kit assustador", nota: 9 },
    { titulo: "Notícia de ontem", janela: "hoje", nota: 8 },
    { titulo: "Assunto fraco", janela: "esta_semana", nota: 2 },
    { tipo: "nicho", titulo: "Trend do antes e depois", sinal: "@perfil 4,2x a mediana", nota: 7.5 },
  ],
};

describe("hype que vale para o período", () => {
  it("na semana da busca entram os hypes com nota boa e o nicho, separados", () => {
    const h = hypesQueValem(linha, { inicio: "2026-10-14", fim: "2026-10-20" });
    expect(h?.hypes.map((x) => x.titulo)).toEqual(["Halloween", "Notícia de ontem"]);
    expect(h?.nicho.map((x) => x.titulo)).toEqual(["Trend do antes e depois"]);
  });

  it("duas semanas depois só fica o que é das próximas semanas", () => {
    const h = hypesQueValem(linha, { inicio: "2026-10-27", fim: "2026-10-31" });
    expect(h?.hypes.map((x) => x.titulo)).toEqual(["Halloween"]);
    expect(h?.nicho).toEqual([]);
  });

  it("busca vencida para o período não entra (antes ia a última, mesmo velha)", () => {
    expect(hypesQueValem(linha, { inicio: "2026-11-20", fim: "2026-11-30" })).toBeNull();
    expect(hypesQueValem(null, { inicio: "2026-10-14", fim: "2026-10-20" })).toBeNull();
  });

  it("validade: semana para hoje e esta semana, 3 semanas para próximas, 2 para o nicho", () => {
    expect(validadeEmDias({ janela: "hoje" })).toBe(7);
    expect(validadeEmDias({ janela: "proximas_semanas" })).toBe(21);
    expect(validadeEmDias({ tipo: "nicho" })).toBe(14);
  });

  it("o bloco manda tematizar e cita o onde está viralizando", () => {
    const b = blocoDoHype(hypesQueValem(linha, { inicio: "2026-10-14", fim: "2026-10-20" }));
    expect(b).toContain("HYPE E ASSUNTOS EM ALTA AGORA");
    expect(b).toContain("tematizar");
    expect(b).toContain("em_alta_no_nicho");
    expect(b).toContain("@perfil 4,2x a mediana");
    expect(blocoDoHype(null)).toBe("");
  });
});

describe("sinais do Instagram para o nicho", () => {
  const sinais = {
    instagram: { hashtags: [{ tag: "marketingdigital", posts: [{ legenda: "post", link: "https://instagram.com/p/x", curtidas: 900 }] }], motivo: null },
    referencias: { perfis: [{ handle: "perfil", papel: "referencia", posts: [{ legenda: "viral", destaque: "4,2x a mediana" }] }], motivo: null },
    publicados: { posts: [], motivo: "sem posts" },
  };

  it("conta e monta o bloco com os posts reais", () => {
    expect(contarSinais(sinais)).toEqual({ hashtags: 1, referencias: 1, publicados: 0 });
    const b = blocoDoNichoAgora(sinais);
    expect(b).toContain("#marketingdigital");
    expect(b).toContain("4,2x a mediana");
  });

  it("sem sinal nenhum, avisa que vem só da web", () => {
    expect(blocoDoNichoAgora(null)).toContain("só da busca na web");
  });
});

describe("contrato no agente do Mês", () => {
  const fonte = readFileSync("supabase/functions/agente-calendario/index.ts", "utf8");
  it("toda geração leva o hype que vale; a busca não lê o anterior e traz o nicho", () => {
    expect(fonte).toContain("hypesQueValem(data as");
    expect(fonte).toContain("blocoDoHype(ctx.hype)");
    expect(fonte).toContain("{ semHype: true }");
    expect(fonte).toContain("em_alta_no_nicho: {");
    expect(fonte).toContain("lerSinaisDoMundo(servico, {");
  });
});
