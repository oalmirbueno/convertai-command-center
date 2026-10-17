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
    expect(areaDaPessoaReal("coluna-esquerda").x0).toBeGreaterThanOrEqual(0.6);
    expect(areaDaPessoaReal("base-direita").x1).toBeLessThan(0.5);
    expect(areaDaPessoaReal("topo-centro").y0).toBeGreaterThanOrEqual(0.5);
    const f = fraseDaPessoaReal(areaDaPessoaReal("centro-esquerda"), "Anitta");
    expect(f).toContain("colada pelo código");
    expect(f).toContain("NÃO HÁ NENHUMA PESSOA");
    expect(f).toContain("TODO o texto da lâmina fica fora dele");
  });
});

describe("foto de pessoa pública com resolução (teste real de 17/10)", () => {
  it("só fotos JPG com o nome no título e a maior acima do mínimo", async () => {
    const { fotosNaBusca, maiorFoto, LARGURA_MINIMA_DA_FOTO } = await import("../../supabase/functions/estudio-arte/modulos/mundo-real");
    const busca = { query: { search: [{ title: "File:Anitta em show 2024.jpg" }, { title: "File:Anitta logo.jpg" }, { title: "File:Outra pessoa.jpg" }, { title: "File:Anitta capa album.jpg" }] } };
    expect(fotosNaBusca(busca, "Anitta")).toEqual(["File:Anitta em show 2024.jpg"]);
    const info = (largura: number) => ({ arquivo: "x", url: "https://upload.wikimedia.org/x.jpg", pagina: null, licenca: "CC BY", autor: null, largura });
    expect(maiorFoto([info(640), info(LARGURA_MINIMA_DA_FOTO + 400), null])?.largura).toBe(LARGURA_MINIMA_DA_FOTO + 400);
    expect(maiorFoto([info(500)])).toBeNull();
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
    expect(f).toContain('"pessoas_reais", "paginas_reais", "fontes_da_pesquisa"');
  });
  it("o ajuste pedido usa o modelo do diretor, vê a série e o negócio e busca a logo real", () => {
    expect(f).toContain('modeloDoPapel(auto ? "leitura" : "diretor_arte")');
    expect(f).toContain("PENSE COMO DIRETOR DE ARTE");
    expect(f).toContain("negocio: negocioDoAjuste");
    expect(f).toContain("logo real do ajuste não veio");
  });
});

describe("print real de página pública (17/10)", () => {
  it("só http ou https sem login, até 2, uma lâmina cada; quadro do lado oposto ao texto", async () => {
    const { normalizarPaginasReais, areaDaPaginaReal, fraseDaPaginaReal } = await import("../../supabase/functions/estudio-arte/modulos/mundo-real");
    const p = normalizarPaginasReais([
      { url: "https://www.aceleriq.com.br/", laminas: [3, 4], celular: false },
      { url: "javascript:alert(1)", laminas: [1], celular: false },
      { url: "https://user:senha@site.com", laminas: [1], celular: false },
      { url: "https://loja.com/produto", laminas: [], celular: true },
      { url: "https://terceira.com", laminas: [2], celular: false },
    ], [1, 2, 3, 4]);
    expect(p).toEqual([{ url: "https://www.aceleriq.com.br/", laminas: [3], celular: false }, { url: "https://loja.com/produto", laminas: [2], celular: true }]);
    expect(areaDaPaginaReal("topo-centro", false).y0).toBeGreaterThanOrEqual(0.46);
    expect(areaDaPaginaReal("coluna-esquerda", false).x0).toBeGreaterThan(0.5);
    const f = fraseDaPaginaReal(areaDaPaginaReal("topo-centro", false), "https://www.aceleriq.com.br/", false);
    expect(f).toContain("PRINT REAL (aceleriq.com.br)");
    expect(f).toContain("Não desenhe a página");
  });
  it("o navegador tira o print numa sessão própria e curta, nunca a do cliente", () => {
    const op = readFileSync("supabase/functions/_shared/navegador-operacional.ts", "utf8");
    expect(op).toContain("export async function printPublico(");
    expect(op).toContain("p.criarSessao(contexto, { tela, curta: true })");
    expect(op).toContain('Page.captureScreenshot", { format: "png"');
    expect(readFileSync("supabase/functions/navegador-remoto/provedor.ts", "utf8")).toContain("[[false, TEMPO_DO_PRINT_S, false]]");
    expect(readFileSync("supabase/functions/estudio-arte/index.ts", "utf8")).toContain('interno_acao: "print_publico"');
  });
});
