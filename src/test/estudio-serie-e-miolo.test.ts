import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * Frente R4 (26/09), Estúdio:
 * 1. O que a série herda da capa: a referência da capa separada em identidade
 *    da série e só da capa (papéis do molde, regras e Choice do Jev guardado).
 * 2. O prompt da lâmina 2 herda a identidade e lista o que não repetir.
 * 3. Miolo rico: componente de lâmina pelo tipo do conteúdo, com rotação na
 *    série (sem repetir em lâminas seguidas) e troca ao refazer.
 * 4. A capa e a lâmina com referência própria não mudam; anúncio igual.
 */

import { blocoDaSerie, type MoldeDaReferencia, promptDoReplicar } from "../../supabase/functions/_shared/direcao-arte";
import type { ResultadoJev } from "../../supabase/functions/_shared/jev";
import { MUDANCAS_DO_GERADOR_DO_ESTUDIO } from "../../supabase/functions/_shared/motores";
import {
  blocoDaIdentidadeDaSerie,
  blocoDaSerieDaReferencia,
  caminhoDaSerie,
  herdaReferenciaDaCapa,
  itensDaCapa,
  perguntasDaSerie,
  referenciaDaCapaGerada,
  registroDaSerie,
  ROTULO_DA_REFERENCIA_NA_SERIE,
  rotuloDaCapaNaSerie,
  type SeparacaoDaSerie,
  separarIdentidadeDaCapa,
  soDaCapa,
  temAlgoSoDaCapa,
} from "../../supabase/functions/estudio-arte/serie-da-capa";
import {
  blocoDoMiolo,
  COMPONENTES,
  componenteDaLamina,
  componenteGravado,
  PREFERENCIAS,
  planoDoMiolo,
  tipoDoConteudo,
} from "../../supabase/functions/estudio-arte/miolo-rico";
import { blocoDoMioloDesenhado } from "../../supabase/functions/estudio-arte/composicao-dinamica";
import { CASOS_DA_SERIE, CASOS_DO_REPLICAR, MARCA_CASO } from "./fixtures/replicarCasos";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const estudio = ler("supabase/functions/estudio-arte/index.ts");
const gerar = estudio.slice(estudio.indexOf("async function gerarCard("), estudio.indexOf("async function gravarVersao("));
const HOJE = JSON.parse(ler("src/test/fixtures/replicar-identica-hoje.json")) as { replicar: { nome: string; prompt: string; textoExato: string }[]; serie: string[] };

const bloco = (papel: MoldeDaReferencia["blocos"][number]["papel"], c: { x0: number; y0: number; x1: number; y1: number }, extra: Partial<MoldeDaReferencia["blocos"][number]> = {}) => ({
  papel,
  ...c,
  altura_da_letra: 2,
  linhas: 1,
  caixa_alta: false,
  familia: "sem serifa",
  largura_da_letra: "normal",
  peso: "regular",
  cor: "#111111",
  alinhamento: "esquerda" as const,
  ...extra,
});

/** Capa de referência sintética: título gigante, selo de canto, apoio, chamada, @perfil, palavra de fundo, pessoa e elementos. */
const MOLDE_CAPA: MoldeDaReferencia = {
  versao: 2,
  proporcao: "4:5",
  fundo: "papel creme com textura leve",
  cor_do_fundo: "#F2F2EE",
  grade: "Título enorme em cima; pessoa embaixo à direita; textos pequenos nos cantos.",
  assunto: { tipo: "pessoa", descricao: "mulher sorrindo de braços cruzados", enquadramento: "meio corpo", x0: 40, y0: 38, x1: 100, y1: 100 },
  blocos: [
    bloco("titulo", { x0: 6, y0: 8, x1: 94, y1: 30 }, { altura_da_letra: 9.5, linhas: 2, caixa_alta: true, familia: "display", largura_da_letra: "condensada", peso: "black", cor: "#1E4FD8" }),
    bloco("rotulo", { x0: 6, y0: 3, x1: 30, y1: 6 }, { altura_da_letra: 1.4, caixa_alta: true, peso: "medio" }),
    bloco("texto", { x0: 6, y0: 34, x1: 40, y1: 44 }, { altura_da_letra: 1.8, linhas: 3 }),
    bloco("cta", { x0: 6, y0: 88, x1: 34, y1: 93 }, { altura_da_letra: 2.2, peso: "negrito", cor: "#FF5500" }),
    bloco("perfil", { x0: 70, y0: 94, x1: 95, y1: 97 }, { altura_da_letra: 1.4 }),
    bloco("decorativo", { x0: 0, y0: 40, x1: 100, y1: 70 }, { altura_da_letra: 22, cor: "#EDE6D8", texto_decorativo: "MELHOR" }),
  ],
  elementos: [
    { descricao: "celulares inclinados em volta da pessoa", cor: "#1E4FD8", x0: 35, y0: 40, x1: 100, y1: 95 },
    { descricao: "fio fino sob o título", cor: "#FF5500", x0: 6, y0: 31, x1: 50, y1: 32 },
    { descricao: "selo redondo de desconto", cor: "#FF5500", x0: 75, y0: 30, x1: 95, y1: 45 },
    { descricao: "forma orgânica suave", cor: "#1E4FD8", x0: 0, y0: 70, x1: 30, y1: 100 },
    { descricao: "pequeno círculo", cor: "#1E4FD8", x0: 90, y0: 5, x1: 94, y1: 8 },
    { descricao: "textura de papel no fundo", cor: "#EDE6D8", x0: 0, y0: 0, x1: 100, y1: 100 },
  ],
  tratamento: "Luz suave de estúdio, grão leve, acabamento editorial.",
};

type Guardado = Record<string, unknown>;
function depsFalsas(opcoes: { resposta?: ResultadoJev["answers"]; falha?: boolean; guardado?: Record<string, Guardado> } = {}) {
  const guardado: Record<string, Guardado> = { ...(opcoes.guardado || {}) };
  const perguntarJev = vi.fn(async (_state: unknown, _q: unknown): Promise<ResultadoJev> => {
    if (opcoes.falha) throw new Error("sem chave");
    return { answers: opcoes.resposta || {}, usage: { input_tokens: 10, output_tokens: 2 }, modelo: "jev-latest" };
  });
  const deps = {
    pasta: "c1/estudio/leituras",
    lerGuardado: vi.fn(async (c: string) => guardado[c] || null),
    guardar: vi.fn(async (c: string, v: unknown) => {
      guardado[c] = JSON.parse(JSON.stringify(v));
    }),
    perguntarJev,
    cobrarJev: vi.fn(async () => null),
  };
  return { deps, guardado };
}

const classeDe = (s: { itens: { chave: string; classe: string }[] }, chave: string) => s.itens.filter((x) => x.chave === chave)[0]?.classe;

// ------------------------------------------------------------------ 1. separação

describe("1. Identidade da série x só da capa (molde sintético)", () => {
  it("papéis e regras: título gigante, chamada, palavra de fundo, pessoa, selo e forma em volta da pessoa são só da capa; fio, textura, grafismo pequeno, apoio e marca são identidade", () => {
    const itens = itensDaCapa(MOLDE_CAPA);
    const de = (k: string) => itens.filter((x) => x.chave === k)[0];
    expect(de("b0").classe).toBe("so_da_capa");
    expect(de("b0").descricao).toBe("o título gigante de impacto");
    expect(de("b2").classe).toBe("identidade");
    expect(de("b3").classe).toBe("so_da_capa");
    expect(de("b4").classe).toBe("identidade");
    expect(de("b5").classe).toBe("so_da_capa");
    expect(de("assunto").classe).toBe("so_da_capa");
    expect(de("e0").classe).toBe("so_da_capa");
    expect(de("e1").classe).toBe("identidade");
    expect(de("e2").classe).toBe("so_da_capa");
    expect(de("e4").classe).toBe("identidade");
    expect(de("e5").classe).toBe("identidade");
    // Ambíguos (vão ao Jev): o texto pequeno de canto e a forma média sem nome claro.
    expect(itens.filter((x) => x.classe === null).map((x) => x.chave)).toEqual(["b1", "e3"]);
    // Título pequeno (não gigante) é identidade.
    expect(itensDaCapa({ ...MOLDE_CAPA, blocos: [bloco("titulo", { x0: 6, y0: 8, x1: 60, y1: 14 }, { altura_da_letra: 4 })], elementos: [], assunto: null })[0].classe).toBe("identidade");
    expect(itensDaCapa(null)).toEqual([]);
  });

  it("um Choice do Jev por item ambíguo, numa chamada só, com as duas opções definidas e o estado em campos nomeados", async () => {
    const { deps } = depsFalsas({ resposta: { q_b1: { choice: "identidade_da_serie", confidence: 0.7 }, q_e3: { choice: "so_da_capa", confidence: 0.8 } } });
    const s = await separarIdentidadeDaCapa({ refId: "ref-1", molde: MOLDE_CAPA }, deps);
    expect(deps.perguntarJev).toHaveBeenCalledTimes(1);
    const [estado, perguntas] = deps.perguntarJev.mock.calls[0] as [Record<string, unknown>, Record<string, { type: string; criteria: Record<string, unknown>; instructions: string }>];
    expect(Object.keys(perguntas)).toEqual(["q_b1", "q_e3"]);
    for (const q of Object.values(perguntas)) {
      expect(q.type).toBe("choice");
      expect(Object.keys(q.criteria)).toEqual(["identidade_da_serie", "so_da_capa"]);
    }
    expect(perguntas.q_e3.instructions).toContain("`itens.e3`");
    expect(Object.keys(estado.itens as Record<string, unknown>)).toEqual(["b1", "e3"]);
    expect((estado.capa as Record<string, unknown>).grade).toContain("Título enorme");
    expect(deps.cobrarJev).toHaveBeenCalledTimes(1);
    expect(s!.jev).toBe("respondeu");
    expect(classeDe(s!, "b1")).toBe("identidade");
    expect(classeDe(s!, "e3")).toBe("so_da_capa");
    expect(s!.itens.filter((x) => x.chave === "e3")[0].origem).toBe("jev");
    expect(deps.guardar).toHaveBeenCalledWith(caminhoDaSerie("c1/estudio/leituras", "ref-1"), expect.objectContaining({ versao: 1, jev: "respondeu" }));
    expect(temAlgoSoDaCapa(s)).toBe(true);
  });

  it("guardada por referência: a próxima lâmina (ou refazer) não chama o Jev de novo", async () => {
    const primeira = depsFalsas({ resposta: { q_b1: { choice: "so_da_capa" }, q_e3: { choice: "identidade_da_serie" } } });
    await separarIdentidadeDaCapa({ refId: "ref-1", molde: MOLDE_CAPA }, primeira.deps);
    const segunda = depsFalsas({ guardado: primeira.guardado });
    const s = await separarIdentidadeDaCapa({ refId: "ref-1", molde: MOLDE_CAPA }, segunda.deps);
    expect(segunda.deps.perguntarJev).not.toHaveBeenCalled();
    expect(segunda.deps.cobrarJev).not.toHaveBeenCalled();
    expect(s!.jev).toBe("guardado");
    expect(classeDe(s!, "b1")).toBe("so_da_capa");
    expect(classeDe(s!, "e3")).toBe("identidade");
    // Molde mudado (lido de novo): a assinatura não bate e separa de novo.
    const mudado = { ...MOLDE_CAPA, elementos: MOLDE_CAPA.elementos.concat([{ descricao: "mancha grande no canto", cor: null, x0: 60, y0: 0, x1: 100, y1: 30 }]) };
    const terceira = depsFalsas({ guardado: primeira.guardado, resposta: {} });
    await separarIdentidadeDaCapa({ refId: "ref-1", molde: mudado }, terceira.deps);
    expect(terceira.deps.perguntarJev).toHaveBeenCalledTimes(1);
  });

  it("sem Jev (falha ou sem resposta): regra de tamanho, sem guardar; sem ambíguo: nem chama; sem molde: null", async () => {
    const falha = depsFalsas({ falha: true });
    const s = await separarIdentidadeDaCapa({ refId: "ref-1", molde: MOLDE_CAPA }, falha.deps);
    expect(s!.jev).toBe("falhou");
    expect(classeDe(s!, "b1")).toBe("so_da_capa");
    // A forma ocupa cerca de 9% do quadro (menos que AREA_GRANDE): fica como identidade.
    expect(classeDe(s!, "e3")).toBe("identidade");
    expect(s!.itens.filter((x) => x.chave === "e3")[0].origem).toBe("tamanho");
    expect(falha.deps.guardar).not.toHaveBeenCalled();
    const vazia = depsFalsas({ resposta: {} });
    expect((await separarIdentidadeDaCapa({ refId: "ref-1", molde: MOLDE_CAPA }, vazia.deps))!.jev).toBe("falhou");
    expect(vazia.deps.guardar).not.toHaveBeenCalled();
    const semDuvida = depsFalsas();
    const molde = { ...MOLDE_CAPA, blocos: MOLDE_CAPA.blocos.filter((b) => b.papel !== "rotulo"), elementos: MOLDE_CAPA.elementos.filter((e) => e.descricao !== "forma orgânica suave") };
    const r = await separarIdentidadeDaCapa({ refId: "ref-2", molde }, semDuvida.deps);
    expect(semDuvida.deps.perguntarJev).not.toHaveBeenCalled();
    expect(r!.jev).toBe("nao_precisou");
    expect(semDuvida.deps.guardar).toHaveBeenCalledTimes(1);
    expect(await separarIdentidadeDaCapa({ refId: "x", molde: null }, semDuvida.deps)).toBeNull();
    expect(perguntasDaSerie(itensDaCapa(molde))).toEqual({});
  });

  it("registro da versão sem texto da referência", async () => {
    const { deps } = depsFalsas({ resposta: { q_b1: { choice: "so_da_capa" }, q_e3: { choice: "so_da_capa" } } });
    const s = (await separarIdentidadeDaCapa({ refId: "ref-1", molde: MOLDE_CAPA }, deps))!;
    const reg = registroDaSerie(s, "referencia_do_conjunto", "ref-1");
    expect(reg.so_da_capa).toEqual(soDaCapa(s).map((x) => x.chave));
    expect(JSON.stringify(reg)).not.toContain("MELHOR");
  });
});

// ------------------------------------------------------------------ 2. prompt da lâmina 2

const SEPARACAO: SeparacaoDaSerie = {
  versao: 1,
  jev: "respondeu",
  itens: [],
};

async function separacaoPronta(): Promise<SeparacaoDaSerie> {
  const { deps } = depsFalsas({ resposta: { q_b1: { choice: "so_da_capa" }, q_e3: { choice: "identidade_da_serie" } } });
  return (await separarIdentidadeDaCapa({ refId: "ref-1", molde: MOLDE_CAPA }, deps)) || SEPARACAO;
}

const SO_DA_CAPA = ["o título gigante de impacto", "a palavra decorativa gigante de fundo", "celulares inclinados em volta da pessoa", "selo redondo de desconto", "a pessoa em destaque como foto herói", "a chamada da capa"];

describe("2. Prompt da lâmina 2: herda a identidade, não repete o que é só da capa", () => {
  it("bloco da referência da capa: a linha Herde não tem nada só da capa; a linha Não repita tem tudo; cores sempre da marca", async () => {
    const s = await separacaoPronta();
    const b = blocoDaSerieDaReferencia({ ordem: 2, total: 5, molde: MOLDE_CAPA, separacao: s, paleta: MARCA_CASO.paleta, indiceDaReferencia: 3, levaLogo: false });
    const herde = b.split("\n").filter((l) => l.indexOf("- Herde") === 0)[0];
    const naoRepita = b.split("\n").filter((l) => l.indexOf("- Não repita da capa") === 0)[0];
    expect(b).toContain("a referência da capa é a imagem 3");
    expect(herde).toContain("fio fino sob o título");
    expect(herde).toContain("forma orgânica suave");
    expect(herde).toContain("a tipografia: título no desenho display, condensada, peso black, caixa alta");
    // A trava da marca tira o nome de cor da referência ("creme") do texto que vai ao gerador.
    expect(herde).toContain("o fundo (papel cor do kit com textura leve)");
    for (const x of SO_DA_CAPA) {
      expect(naoRepita, x).toContain(x);
      expect(herde, x).not.toContain(x);
    }
    expect(b).toContain("A pessoa ou o produto em destaque da capa só entra se a direção desta lâmina pedir");
    // Trava da marca: nenhuma cor da referência crua, nem a palavra decorativa dela.
    for (const hex of ["#1E4FD8", "#FF5500", "#F2F2EE", "#EDE6D8"]) expect(b.toUpperCase()).not.toContain(hex);
    expect(b).not.toContain("MELHOR");
    expect(b).not.toContain("—");
    // Logo: só quando a lâmina leva logo, no lugar da marca da referência.
    expect(b).not.toContain("a logo no lugar da marca");
    expect(blocoDaSerieDaReferencia({ ordem: 5, total: 5, molde: MOLDE_CAPA, separacao: s, paleta: MARCA_CASO.paleta, indiceDaReferencia: null, levaLogo: true })).toContain("a logo no lugar da marca da referência (na base, à direita)");
    // Cena fixa: sem fundo nem grafismos (a cena já está decidida), a lista do que não repetir continua.
    const fixa = blocoDaSerieDaReferencia({ ordem: 2, total: 5, molde: MOLDE_CAPA, separacao: s, paleta: MARCA_CASO.paleta, indiceDaReferencia: null, levaLogo: false, cenaFixa: true });
    expect(fixa).not.toContain("o fundo (");
    expect(fixa).toContain("selo redondo de desconto");
  });

  it("bloco geral da série do post e legenda da capa: identidade sim, protagonista e cenário da capa não", () => {
    const b = blocoDaIdentidadeDaSerie({ ordem: 2, total: 5, capa: 4 });
    expect(b).toContain("a capa (imagem 4)");
    expect(b).toContain("Herde da capa a IDENTIDADE DA SÉRIE");
    expect(b).toContain("Não repita o que é SÓ DA CAPA: o título gigante de impacto, selo, etiqueta ou sticker de oferta, a foto herói ou a pessoa em destaque");
    expect(b).toContain("Os cartões, conectores, colunas e ícones do conteúdo desta lâmina são desenhados nesse mesmo sistema");
    expect(b).not.toContain("não crie elementos gráficos que a capa não tem");
    expect(b).not.toContain("protagonista");
    expect(b).not.toContain("FECHAMENTO");
    expect(blocoDaIdentidadeDaSerie({ ordem: 5, total: 5, capa: 4 })).toContain("FECHAMENTO");
    expect(blocoDaIdentidadeDaSerie({ ordem: 2, total: 4, capa: 3, cenaFixa: true })).toContain("A cena desta lâmina já está decidida");
    const rotulo = rotuloDaCapaNaSerie(false);
    expect(rotulo.indexOf("CAPA desta série (lâmina 1), já aprovada: é o guia do sistema visual")).toBe(0);
    expect(rotulo).not.toContain("protagonista");
    expect(rotulo).toContain("não repita dela o título gigante");
    expect(rotuloDaCapaNaSerie(true)).toContain("o final fecha voltando a ela");
    expect(ROTULO_DA_REFERENCIA_NA_SERIE).toContain("não é o layout desta lâmina");
    for (const t of [b, rotulo, ROTULO_DA_REFERENCIA_NA_SERIE]) expect(t).not.toContain("—");
  });

  it("quando vale: lâmina 2+ com a referência do conjunto, sem a própria, sem foto, prancha, contínuo nem anúncio", () => {
    const base = { ordem: 2, total: 4, ads: false, refsDaLamina: 0, refs: 1, quadroDaPrancha: false, panorama: false, foto: false, elementos: 0 };
    expect(herdaReferenciaDaCapa(base)).toBe(true);
    expect(herdaReferenciaDaCapa({ ...base, ordem: 1 })).toBe(false);
    expect(herdaReferenciaDaCapa({ ...base, refsDaLamina: 1 })).toBe(false);
    expect(herdaReferenciaDaCapa({ ...base, ads: true })).toBe(false);
    expect(herdaReferenciaDaCapa({ ...base, quadroDaPrancha: true })).toBe(false);
    expect(herdaReferenciaDaCapa({ ...base, panorama: true })).toBe(false);
    expect(herdaReferenciaDaCapa({ ...base, foto: true })).toBe(false);
    expect(herdaReferenciaDaCapa({ ...base, elementos: 1 })).toBe(false);
    expect(herdaReferenciaDaCapa({ ...base, refs: 0 })).toBe(false);
    // Capa gerada no replicar: o id do molde (o quadro da prancha tem molde próprio).
    expect(referenciaDaCapaGerada({ modo: "replicar_referencia", referencias: ["r1"] })).toEqual({ refId: "r1", moldeId: "r1" });
    expect(referenciaDaCapaGerada({ modo: "replicar_referencia", referencias: ["r1"], prancha: [{ referencia_id: "r1", quadro: 2 }] })).toEqual({ refId: "r1", moldeId: "r1-q2" });
    expect(referenciaDaCapaGerada({ modo: "normal", referencias: ["r1"] })).toBeNull();
    expect(referenciaDaCapaGerada(null)).toBeNull();
  });

  it("servidor: a referência do conjunto sai do replicar da lâmina 2+ só com algo só da capa e vira guia da identidade", () => {
    const iSerie = gerar.indexOf("const serieDaCapa = herdaReferenciaDaCapa({");
    const iReplicar = gerar.indexOf("const replicar = refsDaEquipe.length > 0 && !panorama;");
    expect(iSerie).toBeGreaterThan(0);
    expect(iSerie).toBeLessThan(iReplicar);
    expect(gerar).toContain("refsDaLamina: (card.referencias_ids || []).length,");
    expect(gerar).toContain("if (serieDaCapa) refsDaEquipe.splice(0, refsDaEquipe.length);");
    expect(estudio).toContain("return separacao && temAlgoSoDaCapa(separacao) ? { ref, imagem, molde, separacao } : null;");
    expect(gerar).toContain('? { refs: [serieDaCapa.ref], jev: "serie_da_referencia_da_capa" }');
    expect(gerar).toContain("? ROTULO_DA_REFERENCIA_NA_SERIE");
    expect(gerar).toContain("? rotuloDaCapaNaSerie(ordem === total)");
    expect(gerar).toContain('replicar || ads || !separacaoDaSerie ? "" : blocoDaSerieDaReferencia({');
    // Mesmo custo de antes nessa lâmina (a tela já mostrava qualidade alta com referência do conjunto).
    expect(gerar).toContain('qualidade: serieDaCapa ? "alta" as Qualidade : qualidade,');
    expect(gerar).toContain("serie_da_capa: registroDaSerie(");
  });
});

// ------------------------------------------------------------------ 3. miolo rico

const lamina = (ordem: number, texto: string, funcao = "conteudo") => ({ ordem, funcao, texto_exato: texto, blocos: [{ papel: "headline" as const, texto }] });

describe("3. Miolo rico: componente pelo tipo do conteúdo, feito pelo gerador", () => {
  it("tipo do conteúdo em código", () => {
    const t = (s: string) => tipoDoConteudo([{ papel: "headline", texto: s }]);
    expect(t("Antes: dor todo dia. Depois: sorriso tranquilo")).toBe("comparacao");
    expect(t("Mito ou verdade: o certo e o errado")).toBe("comparacao");
    expect(t("Primeiro marque, em seguida venha")).toBe("passos");
    expect(t("Marque, venha, cuide")).toBe("lista");
    expect(t("70% das pessoas")).toBe("numero");
    expect(t("Vale a pena?")).toBe("pergunta");
    expect(t("Cuidado com o açúcar")).toBe("dica");
    expect(t("Seu sorriso agradece")).toBe("afirmacao");
    expect(tipoDoConteudo([{ papel: "numero", texto: "Três" }])).toBe("numero");
  });

  it("escolha pelo tipo: lista vira checklist, comparação vira colunas, passos vira linha do tempo, número vira cartão, pergunta vira balão, dica vira caixa", () => {
    const plano = planoDoMiolo([
      lamina(1, "Capa"),
      lamina(2, "Marque, venha, cuide"),
      lamina(3, "Antes e depois do clareamento"),
      lamina(4, "Primeiro escove, em seguida use o fio"),
      lamina(5, "70% das pessoas"),
      lamina(6, "Vale a pena?"),
      lamina(7, "Cuidado com o açúcar"),
      lamina(8, "Agende hoje", "cta"),
    ]);
    expect(plano.map((p) => [p.ordem, p.componente])).toEqual([
      [2, "checklist"],
      [3, "colunas_comparacao"],
      [4, "linha_do_tempo"],
      [5, "numero_em_cartao"],
      [6, "balao_pergunta"],
      [7, "caixa_de_dica"],
    ]);
    const b = blocoDoMiolo({ ordem: 3, total: 8, escolha: plano[1], zona: "topo-esquerda" });
    expect(b).toContain(COMPONENTES.colunas_comparacao.desenho);
    expect(b).toContain("Arranjo: título no topo e o componente logo abaixo dele");
    expect(b).toContain("só as cores da paleta, cada uma na sua função");
    expect(b).toContain("nenhuma palavra, rótulo, número ou legenda a mais");
    expect(b).not.toContain("—");
  });

  it("rotação: nunca o mesmo componente em lâminas seguidas e, enquanto houver, nenhum repetido na série", () => {
    const listas = [1, 2, 3, 4, 5, 6, 7, 8].map((o) => lamina(o, o === 1 ? "Capa" : "Escove, use fio, volte sempre"));
    const plano = planoDoMiolo(listas);
    expect(plano).toHaveLength(6);
    for (let i = 1; i < plano.length; i++) expect(plano[i].componente).not.toBe(plano[i - 1].componente);
    expect(plano.slice(0, 4).map((p) => p.componente)).toEqual(PREFERENCIAS.lista);
    const nomes = plano.map((p) => p.componente);
    expect(nomes.filter((x, i) => nomes.indexOf(x) === i)).toHaveLength(nomes.length);
    // Duas comparações seguidas: a segunda usa o outro componente de comparação.
    const cmp = planoDoMiolo([lamina(1, "Capa"), lamina(2, "Antes e depois"), lamina(3, "Errado e certo"), lamina(4, "Fim", "cta")]);
    expect(cmp.map((p) => p.componente)).toEqual(["colunas_comparacao", "cartoes_lado_a_lado"]);
    // Determinístico: a mesma direção dá o mesmo plano (lâminas geradas em paralelo concordam).
    expect(planoDoMiolo(listas)).toEqual(plano);
  });

  it("refazer troca o componente sem cair no das vizinhas; o gravado na versão é lido com cuidado", () => {
    const cards = [lamina(1, "Capa"), lamina(2, "Marque, venha, cuide"), lamina(3, "Escove, use fio, volte"), lamina(4, "Durma, beba água, sorria"), lamina(5, "Fim", "cta")];
    const plano = planoDoMiolo(cards);
    const primeira = componenteDaLamina({ cards, ordem: 3 });
    expect(primeira).toEqual(plano[1]);
    const refeita = componenteDaLamina({ cards, ordem: 3, anterioresDestaLamina: [primeira!.componente] });
    expect(refeita!.componente).not.toBe(primeira!.componente);
    expect([plano[0].componente, plano[2].componente]).not.toContain(refeita!.componente);
    expect(componenteDaLamina({ cards, ordem: 1 })).toBeNull();
    expect(componenteDaLamina({ cards, ordem: 5 })).toBeNull();
    expect(componenteGravado({ miolo_desenhado: { componente: "checklist" } })).toBe("checklist");
    expect(componenteGravado({ miolo_desenhado: { componente: "outro" } })).toBeNull();
    expect(componenteGravado(null)).toBeNull();
  });

  it("cena fixa: só a versão leve, gráfica, sem caixa atrás do texto; o bloco antigo por tipo continua valendo", () => {
    const fixa = blocoDoMioloDesenhado({ ordem: 2, total: 4, blocos: [{ papel: "headline", texto: "Vale a pena?" }], cenaFixa: true });
    expect(fixa).toContain("o recurso é só gráfico");
    expect(fixa).toContain("sem caixa nem painel atrás do texto");
    expect(fixa).toContain(COMPONENTES.balao_pergunta.leve);
    expect(fixa).not.toContain(COMPONENTES.balao_pergunta.desenho);
    // Com o plano da série, vale o componente escolhido; sem ele, o primeiro do tipo.
    expect(blocoDoMioloDesenhado({ ordem: 2, total: 4, blocos: [{ papel: "headline", texto: "Vale a pena?" }], componente: { ordem: 2, tipo: "pergunta", componente: "cartao_destaque" } })).toContain(COMPONENTES.cartao_destaque.desenho);
    expect(blocoDoMioloDesenhado({ ordem: 2, total: 4, blocos: [{ papel: "headline", texto: "70% das pessoas" }] })).toContain("o número como protagonista");
  });

  it("servidor: o plano da série escolhe o componente e a versão guarda (sem camada: nada é colado pelo código)", () => {
    expect(gerar).toContain("componenteDaLamina({ cards: t.direcao.cards, ordem, anterioresDestaLamina: t.cards.filter((c) => c.ordem === ordem).map((c) => componenteGravado(c)) });");
    expect(gerar).toContain("cenaFixa, componente: componenteDoMiolo, zona: zonaDoTexto }),");
    expect(gerar).toContain("miolo_desenhado: { tipo: componenteDoMiolo.tipo, componente: componenteDoMiolo.componente }");
    for (const f of ["supabase/functions/estudio-arte/serie-da-capa.ts", "supabase/functions/estudio-arte/miolo-rico.ts"]) {
      const s = ler(f);
      expect(s, f).not.toContain("chamarImagem");
      expect(s, f).not.toContain("colarMudancas");
      expect(s, f).not.toContain("—");
      expect(s, f).not.toContain("(?<");
    }
  });
});

// ------------------------------------------------------------------ 4. capa igual

describe("4. A capa não muda; referência da própria lâmina e anúncio iguais", () => {
  it("capa (lâmina 1) e post único: nenhum bloco novo", async () => {
    const s = await separacaoPronta();
    expect(blocoDaIdentidadeDaSerie({ ordem: 1, total: 5, capa: null })).toBe("");
    expect(blocoDaIdentidadeDaSerie({ ordem: 1, total: 1, capa: null })).toBe("");
    expect(blocoDaSerieDaReferencia({ ordem: 1, total: 5, molde: MOLDE_CAPA, separacao: s, paleta: MARCA_CASO.paleta, indiceDaReferencia: 2, levaLogo: true })).toBe("");
    expect(blocoDoMioloDesenhado({ ordem: 1, total: 5, blocos: [{ papel: "headline", texto: "Capa" }] })).toBe("");
    expect(blocoDoMioloDesenhado({ ordem: 5, total: 5, blocos: [{ papel: "headline", texto: "Fim" }] })).toBe("");
    expect(componenteDaLamina({ cards: [lamina(1, "Capa")], ordem: 1 })).toBeNull();
  });

  it("Idêntica (replicar) e o bloco da série do anúncio são os de hoje, byte a byte", () => {
    CASOS_DO_REPLICAR.forEach((c, i) => {
      const r = promptDoReplicar({ ...c.entrada, fidelidade: "identica" });
      expect(r.prompt, c.nome).toBe(HOJE.replicar[i].prompt);
    });
    CASOS_DA_SERIE.forEach((c, i) => expect(blocoDaSerie(c)).toBe(HOJE.serie[i]));
    // Replicando (referência da lâmina, prancha ou sem nada só da capa), o prompt próprio continua sem bloco da série.
    const bloco = gerar.slice(gerar.indexOf("// 0) Replicar a referência"), gerar.indexOf("// 1a) Foto de fundo"));
    expect(bloco).not.toContain("blocoDaIdentidadeDaSerie");
    expect(bloco).not.toContain("blocoDoMioloDesenhado");
  });

  it("registro em _shared/motores.ts aponta trechos que existem", () => {
    const m = MUDANCAS_DO_GERADOR_DO_ESTUDIO.filter((x) => x.id === "serie_e_miolo")[0];
    expect(m).toBeTruthy();
    for (const t of m.ligacao.trechos) expect(estudio).toContain(t);
  });
});
