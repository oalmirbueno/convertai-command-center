import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blocoDoTemaDaEpoca, domingoDePascoa, enesimoDiaDaSemana, temasDaEpoca } from "../../supabase/functions/estudio-arte/modulos/tema-da-epoca";
import { areaDaPessoaReal, arquivoDoVerbete, fraseDaPessoaReal, mundoRealPelaRegra, normalizarPessoasReais, perguntasDoMundoRealNoEstudio } from "../../supabase/functions/estudio-arte/modulos/mundo-real";
import { promptDaLamina } from "../../supabase/functions/_shared/direcao-arte";

/**
 * 17/10/2026, dono: "repete a mesma imagem da capa e a mesma pessoa só mudando o ângulo; quero mais
 * dinâmica"; "se falei de Meta Ads, o gerenciador; de uma marca, a logo correta; de um famoso, a imagem
 * dele; de Halloween, a pegada de Halloween"; "use a base de documentação"; "o ajuste mais inteligente".
 */
const ler = (p: string) => readFileSync(p, "utf8");

describe("tema da época", () => {
  it("datas móveis certas", () => {
    expect(domingoDePascoa(2026)).toBe("2026-04-05");
    expect(domingoDePascoa(2027)).toBe("2027-03-28");
    expect(enesimoDiaDaSemana(2026, 5, 0, 2)).toBe("2026-05-10"); // Dia das Mães
    expect(enesimoDiaDaSemana(2026, 8, 0, 2)).toBe("2026-08-09"); // Dia dos Pais
  });

  it("o texto que fala de Halloween manda o tema, mesmo fora da janela", () => {
    const t = temasDaEpoca({ data: "2026-09-02", textos: ["Promoção de Halloween da loja"] });
    expect(t[0]).toMatchObject({ nome: "Halloween", origem: "pedido", data: "2026-10-31" });
    expect(blocoDoTemaDaEpoca(t)).toContain("A peça inteira entra no clima");
  });

  it("a data de publicação perto da data vira convite (sem forçar)", () => {
    const t = temasDaEpoca({ data: "2026-10-27", textos: ["Como declarar o imposto"] });
    expect(t.map((x) => x.nome)).toEqual(["Halloween", "Outubro Rosa"]);
    expect(t[0].origem).toBe("calendario");
    expect(blocoDoTemaDaEpoca(t)).toContain("Se o assunto combinar");
  });

  it("Black Friday 2026 cai em 27/11 e a janela abre três semanas antes", () => {
    const t = temasDaEpoca({ data: "2026-11-10", textos: ["oferta"] });
    expect(t.some((x) => x.nome === "Black Friday" && x.data === "2026-11-27")).toBe(true);
  });

  it("sem data nem palavra, nada", () => {
    expect(temasDaEpoca({ data: "2026-08-20", textos: ["dica de limpeza"] })).toEqual([]);
    expect(blocoDoTemaDaEpoca([])).toBe("");
  });
});

describe("mundo real ampliado", () => {
  it("campanha no Meta Ads liga o mundo real (a tela do gerenciador)", () => {
    const r = mundoRealPelaRegra(["Como uma campanha no Meta Ads trouxe 40 vendas"]);
    expect(r.real).toBe(true);
    expect(r.marcas).toContain("Meta");
  });

  it("marca sozinha como CTA continua fora da regra (o Jev decide)", () => {
    expect(mundoRealPelaRegra(["Chame no WhatsApp"]).real).toBe(false);
    const q = perguntasDoMundoRealNoEstudio();
    expect(Object.keys(q)).toEqual(["mundo_real", "pessoa_publica"]);
    expect(q.pessoa_publica.type).toBe("noul");
  });

  it("pessoa pública: até 2, em até 2 lâminas, e a foto do verbete", () => {
    const p = normalizarPessoasReais([{ nome: "Anitta", arquivo_wikimedia: "", laminas: [2, 3, 4] }, { nome: "Pelé", arquivo_wikimedia: "File:Pele.jpg", laminas: [] }, { nome: "X", arquivo_wikimedia: "", laminas: [1] }], [1, 2, 3, 4]);
    expect(p.length).toBe(2);
    expect(p[0].laminas).toEqual([2, 3]);
    expect(p[1]).toMatchObject({ arquivo: "File:Pele.jpg", laminas: [1] });
    expect(arquivoDoVerbete({ query: { pages: [{ title: "Anitta", pageimage: "Anitta_em_2023.jpg" }] } })).toBe("File:Anitta em 2023.jpg");
    expect(arquivoDoVerbete({ query: { pages: [{ missing: true }] } })).toBeNull();
  });

  it("o quadro da foto fica do lado oposto ao texto e o prompt proíbe desenhar a pessoa", () => {
    expect(areaDaPessoaReal("coluna-esquerda").x0).toBeGreaterThan(0.5);
    expect(areaDaPessoaReal("base-direita").x1).toBeLessThan(0.5);
    expect(areaDaPessoaReal("topo-centro").y0).toBeGreaterThanOrEqual(0.5);
    const f = fraseDaPessoaReal(areaDaPessoaReal("centro-esquerda"), "Anitta");
    expect(f).toContain("colada pelo código");
    expect(f).toContain("Não desenhe Anitta");
  });
});

describe("série com identidade, cenas que avançam", () => {
  it("o prompt da lâmina pede cena nova, não a mesma protagonista", () => {
    const p = promptDaLamina({ ordem: 2, funcao: "conteudo", texto_exato: "Separe antes", ilustracao: "close do cesto" } as never, { paleta: [], fontes: [] } as never, {
      total: 5, carrosselInfinito: false, levaLogo: false, fioVisual: "Paleta verde e areia, luz da manhã, fios finos.", anteriores: [],
    } as never);
    expect(p).toContain("CONTINUIDADE DA SÉRIE (identidade fixa, cena nova)");
    expect(p).toContain("não repita a pessoa, o objeto nem o cenário da capa");
    expect(p).not.toContain("Mantenha a mesma protagonista");
  });

  it("nenhuma regra manda repetir a mesma protagonista no diretor, na base, na conversa e no Mês", () => {
    for (const arq of [
      "supabase/functions/estudio-arte/index.ts",
      "supabase/functions/estudio-arte/modulos/conhecimento-design.ts",
      "supabase/functions/estudio-arte/conversa-do-diretor.ts",
      "supabase/functions/agente-calendario/index.ts",
      "supabase/functions/_shared/fidelidade-da-referencia.ts",
      "supabase/functions/_shared/prancha-de-referencias.ts",
    ]) {
      const s = ler(arq);
      expect(s, arq).not.toContain("a mesma protagonista, o mesmo cenário");
      expect(s, arq).not.toContain("a mesma pessoa e o mesmo cenário");
    }
    expect(ler("supabase/functions/estudio-arte/index.ts")).toContain("Série com identidade, cenas que avançam");
  });
});

describe("diretor e ajuste com o contexto do cliente", () => {
  const f = ler("supabase/functions/estudio-arte/index.ts");
  it("a direção recebe o contexto completo da marca, o tema da época e decide o mundo real pelo Jev", () => {
    expect(f).toContain("contexto_do_negocio: (await negocioP) || null");
    expect(f).toContain("temasDaEpoca({ data: item.tarefa.due_date");
    expect(f).toContain("perguntasDoMundoRealNoEstudio()");
    expect(f).toContain('"pessoas_reais", "fontes_da_pesquisa"');
  });
  it("o ajuste pedido usa o modelo do diretor, vê a série e o negócio e busca a logo real", () => {
    expect(f).toContain('modeloDoPapel(auto ? "leitura" : "diretor_arte")');
    expect(f).toContain("PENSE COMO DIRETOR DE ARTE");
    expect(f).toContain("negocio: negocioDoAjuste");
    expect(f).toContain("logo real do ajuste não veio");
  });
});
