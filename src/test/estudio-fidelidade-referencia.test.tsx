import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente E (25/09 à noite), Estúdio:
 * 1. Fidelidade à referência (Idêntica, Próxima, Inspirada, Criativa): Idêntica
 *    é o prompt aprovado pelo dono, byte a byte; os outros níveis mudam só os
 *    blocos previstos.
 * 2. Variedade com memória na capa (sem IA): o que já foi feito e o que variar.
 * 3. Selo da série nas lâminas 2..N (só informação).
 * 4. Referência prancha (print de perfil ou de carrossel): detecção, recorte,
 *    quadro por lâmina; referência simples igual a hoje.
 * 5. Registro em _shared/motores.ts.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    from: () => ({ update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }),
    storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: null, error: new Error("sem") }) }) },
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));

import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import EstudioFidelidadeDaReferencia from "@/components/mesa/EstudioFidelidadeDaReferencia";
import EstudioPranchaDaReferencia from "@/components/mesa/EstudioPranchaDaReferencia";
import EstudioBaseDaLamina, { SeloDaSerie } from "@/components/mesa/EstudioBaseDaLamina";
import {
  corpoDaFidelidade,
  corpoDaPrancha,
  estiloDoQuadro,
  fidelidadeDaLamina as fidelidadeNaTela,
  proximoPapel,
  rotuloDaVersao,
  seloDaSerie,
} from "@/components/mesa/fidelidadeDaReferencia";
import { blocoDaSerie, promptDoReplicar } from "../../supabase/functions/_shared/direcao-arte";
import {
  blocoDaVariedade,
  capasNoHistorico,
  destaquesDaPaleta,
  escolherVariedade,
  fidelidadeDaLamina,
  fidelidadeDaReferencia,
  rotuloDaReferenciaNaFidelidade,
  serieNaFidelidade,
  zonaDaCaixa,
  type CapaNoHistorico,
} from "../../supabase/functions/_shared/fidelidade-da-referencia";
import {
  continuidadeDaPrancha,
  normalizarPrancha,
  papeisDaEquipe,
  pareceArteUnica,
  pranchaComAjustes,
  quadroDaLamina,
  retanguloDoQuadro,
  serieComQuadroDaPrancha,
} from "../../supabase/functions/_shared/prancha-de-referencias";
import { MUDANCAS_DO_GERADOR_DO_ESTUDIO } from "../../supabase/functions/_shared/motores";
import { CASOS_DA_SERIE, CASOS_DO_REPLICAR, MARCA_CASO, MOLDE_CASO } from "./fixtures/replicarCasos";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const HOJE = JSON.parse(ler("src/test/fixtures/replicar-identica-hoje.json")) as { replicar: { nome: string; prompt: string; textoExato: string }[]; serie: string[] };
const estudio = ler("supabase/functions/estudio-arte/index.ts");
const gerar = estudio.slice(estudio.indexOf("async function gerarCard("), estudio.indexOf("async function gravarVersao("));
const blocoReplicar = gerar.slice(gerar.indexOf("// 0) Replicar a referência"), gerar.indexOf("// 1a) Foto de fundo"));

/** Seções do prompt do replicar, pelos títulos numerados. */
function secoes(prompt: string): Record<string, string> {
  const titulos = ["1. TEXTO EXATO", "2. LOGO", "3. MARCA", "4. ASSUNTO", "5. FORMATO", "PROIBIDO"];
  const saida: Record<string, string> = {};
  const inicio = titulos.map((t) => prompt.indexOf(`\n${t}`));
  saida.cabeca = prompt.slice(0, inicio[0]);
  titulos.forEach((t, i) => {
    saida[t] = prompt.slice(inicio[i], i + 1 < titulos.length ? inicio[i + 1] : prompt.length);
  });
  return saida;
}

describe("1. Idêntica é o prompt de hoje, byte a byte", () => {
  it("sem nível e com Idêntica, em todos os casos (capa, miolo, foto, sem molde, 2 referências, anúncio, 1:1, sem referência)", () => {
    expect(HOJE.replicar.length).toBe(CASOS_DO_REPLICAR.length);
    CASOS_DO_REPLICAR.forEach((c, i) => {
      for (const f of [undefined, null, "identica" as const]) {
        const r = promptDoReplicar({ ...c.entrada, fidelidade: f });
        expect(r.prompt, c.nome).toBe(HOJE.replicar[i].prompt);
        expect(r.textoExato, c.nome).toBe(HOJE.replicar[i].textoExato);
      }
    });
  });

  it("nível desconhecido vale Idêntica; o bloco da série não mudou", () => {
    const c = CASOS_DO_REPLICAR[0];
    expect(promptDoReplicar({ ...c.entrada, fidelidade: "outra" as never }).prompt).toBe(HOJE.replicar[0].prompt);
    CASOS_DA_SERIE.forEach((c2, i) => expect(blocoDaSerie(c2)).toBe(HOJE.serie[i]));
  });

  it("servidor: Idêntica continua editando a referência, sem variedade e com a mesma variação de refazer", () => {
    expect(gerar).toContain("const fidelidade = fidelidadeDaLamina(card, t.direcao);");
    expect(blocoReplicar).toContain('const editando = refsNoPrompt[0].indice === 1 && imagens.length > 0 && fidelidade === "identica";');
    expect(blocoReplicar).toContain('const variedade = fidelidade !== "identica" && capaDaSerie');
    expect(blocoReplicar).toContain("blocoDeVariacao(versoesAntes, false, true, ordem, false),");
    expect(blocoReplicar).toContain("fidelidade,\n    });");
    expect(blocoReplicar).toContain("fidelidade_referencia: fidelidade,");
    // A legenda da referência só muda fora de Idêntica (null em Idêntica).
    expect(rotuloDaReferenciaNaFidelidade("identica", 0)).toBeNull();
    expect(rotuloDaReferenciaNaFidelidade("criativa", 1)).toBeNull();
    expect(gerar).toContain("rotulo: (rotuloDaReferenciaNaFidelidade(fidelidade, i) || (i === 0");
    // A regra da capa no replicar simples continua (sem capa anexada).
    expect(gerar).toContain("if (capa && !replicar) {");
    expect(gerar).toContain("if (capa && replicar && (quadroDeSequencia || soltaAComposicao(fidelidade))) {");
    expect(serieNaFidelidade({ fidelidade: "identica", ordem: 2, total: 4, capa: 3 })).toBe("");
    expect(serieNaFidelidade({ fidelidade: "proxima", ordem: 2, total: 4, capa: 3 })).toBe("");
    expect(serieNaFidelidade({ fidelidade: "inspirada", ordem: 2, total: 4, capa: 3 })).toContain("imagem 3");
  });

  it("o nível que vale: o da lâmina, senão o do trabalho, senão Idêntica (servidor e tela iguais)", () => {
    for (const f of [fidelidadeDaLamina, fidelidadeNaTela]) {
      expect(f({}, {})).toBe("identica");
      expect(f({}, { fidelidade_referencia: "criativa" })).toBe("criativa");
      expect(f({ fidelidade_referencia: "proxima" }, { fidelidade_referencia: "criativa" })).toBe("proxima");
      expect(f({ fidelidade_referencia: "xyz" }, null)).toBe("identica");
    }
    expect(fidelidadeDaReferencia("inspirada")).toBe("inspirada");
    expect(fidelidadeDaReferencia(3)).toBeNull();
  });
});

describe("1. Os outros níveis mudam só os blocos previstos", () => {
  const caso = CASOS_DO_REPLICAR[0].entrada;
  const hoje = secoes(HOJE.replicar[0].prompt);

  it("Próxima: muda o cabeçalho, o layout (elementos secundários) e o assunto; texto, logo, marca, formato e proibições iguais", () => {
    const p = promptDoReplicar({ ...caso, fidelidade: "proxima" });
    const s = secoes(p.prompt);
    expect(s.cabeca).not.toBe(hoje.cabeca);
    expect(s.cabeca).toContain("MODO REFERÊNCIA PRÓXIMA");
    expect(s.cabeca).not.toContain("BASE A EDITAR");
    expect(s.cabeca).toContain("- Grade: Título enorme");
    expect(s.cabeca).toContain("os secundários podem mudar de forma, quantidade e lugar");
    expect(s["4. ASSUNTO"]).toContain("outra pose, outro gesto e outro ângulo de câmera");
    for (const k of ["1. TEXTO EXATO", "2. LOGO", "3. MARCA", "5. FORMATO", "PROIBIDO"]) expect(s[k], k).toBe(hoje[k]);
    expect(p.textoExato).toBe(HOJE.replicar[0].textoExato);
  });

  it("Inspirada: sistema gráfico sem posições, texto sem lugar, logo sem o lugar da referência; a marca igual", () => {
    const p = promptDoReplicar({ ...caso, fidelidade: "inspirada" });
    const s = secoes(p.prompt);
    expect(s.cabeca).toContain("MODO REFERÊNCIA INSPIRADA");
    expect(s.cabeca).toContain("SISTEMA GRÁFICO DA REFERÊNCIA 1");
    expect(s.cabeca).not.toMatch(/de \d+% a \d+% da largura/);
    expect(s["1. TEXTO EXATO"]).toContain('"SEU SORRISO MERECE CUIDADO", o maior texto da lâmina');
    expect(s["1. TEXTO EXATO"]).not.toContain("no lugar do TÍTULO");
    expect(s["2. LOGO"]).not.toContain("onde a referência põe a marca dela");
    expect(s["3. MARCA"]).toBe(hoje["3. MARCA"]);
    expect(s["5. FORMATO"]).not.toContain("na posição em que a referência põe o título");
    expect(s.PROIBIDO).toContain("no estilo da referência ou da marca");
    // Só a linha das formas muda nas proibições.
    const a = hoje.PROIBIDO.split("\n"), b = s.PROIBIDO.split("\n");
    expect(b.length).toBe(a.length);
    expect(b.filter((l, i) => l !== a[i]).length).toBe(1);
    // A caixa alta do desenho da referência continua.
    expect(p.textoExato).toBe(HOJE.replicar[0].textoExato);
  });

  it("Criativa: só clima e cor; o assunto é o que a ideia pedir; o texto sai sem a caixa alta do molde", () => {
    const p = promptDoReplicar({ ...caso, fidelidade: "criativa" });
    const s = secoes(p.prompt);
    expect(s.cabeca).toContain("MODO REFERÊNCIA CRIATIVA");
    expect(s.cabeca).toContain("CLIMA DA REFERÊNCIA 1");
    expect(s.cabeca).not.toContain("SISTEMA GRÁFICO");
    expect(s["4. ASSUNTO"]).toContain("o que a ideia pedir para o tema");
    expect(s["3. MARCA"]).toBe(hoje["3. MARCA"]);
    expect(p.textoExato).toBe("Seu sorriso merece cuidado");
    expect(p.mapa).toBeNull();
  });

  it("nenhum nível escreve travessão; 2 referências: a 2ª continua só o acabamento", () => {
    for (const c of CASOS_DO_REPLICAR) {
      for (const f of ["proxima", "inspirada", "criativa"] as const) {
        const t = promptDoReplicar({ ...c.entrada, fidelidade: f }).prompt;
        expect(t, `${c.nome} ${f}`).not.toContain("—");
        expect(t, `${c.nome} ${f}`).not.toContain("–");
      }
    }
    const duas = promptDoReplicar({ ...CASOS_DO_REPLICAR[1].entrada, fidelidade: "inspirada" }).prompt;
    expect(duas).toContain("Referência 2 (imagem 2): dela vem só o acabamento");
    expect(duas).not.toContain("a posição e o tamanho dos blocos são os da referência 1");
  });
});

describe("2. Variedade com memória (sem IA)", () => {
  const trabalhos = [
    {
      cards: [
        { ordem: 1, versao: 1, modo: "replicar_referencia", referencias: ["ref-a"], molde_lido: [{ referencia_id: "ref-a", lido: true }], criado_em: "2026-09-20T10:00:00Z" },
        { ordem: 1, versao: 2, modo: "replicar_referencia", referencias: ["ref-a"], fidelidade_referencia: "proxima", variedade: { pose: "de perfil ou meio perfil, com o olhar indo na direção do texto", destaque: "Laranja #E8742A" }, criado_em: "2026-09-22T10:00:00Z" },
        { ordem: 2, versao: 1, modo: "replicar_referencia", referencias: ["ref-a"], criado_em: "2026-09-22T11:00:00Z" },
        { ordem: 1, versao: 3, modo: "normal", referencias: [], criado_em: "2026-09-23T10:00:00Z" },
      ],
    },
    { cards: [{ ordem: 1, versao: 1, modo: "replicar_referencia", referencias: ["ref-b"], fidelidade_referencia: "criativa", variedade: { elemento: "uma faixa diagonal de cor atravessando um canto" }, criado_em: "2026-09-24T10:00:00Z" }] },
    { cards: "quebrado" },
  ];

  it("lê só as capas do modo replicar, das mais novas às mais velhas, marcando a mesma referência", () => {
    const h2 = capasNoHistorico(trabalhos, "ref-a");
    expect(h2.map((x) => x.criado_em)).toEqual(["2026-09-24T10:00:00Z", "2026-09-22T10:00:00Z", "2026-09-20T10:00:00Z"]);
    expect(h2.map((x) => x.mesmaReferencia)).toEqual([false, true, true]);
    expect(h2[2]).toMatchObject({ fidelidade: "identica", variedade: null, moldeLido: true });
    expect(h2[1].variedade).toEqual({ pose: "de perfil ou meio perfil, com o olhar indo na direção do texto", destaque: "Laranja #E8742A" });
    expect(capasNoHistorico(null, "x")).toEqual([]);
  });

  it("escolha: não repete o que já foi feito; Próxima não mexe no texto; Inspirada tira o título da zona da referência", () => {
    const historico = capasNoHistorico(trabalhos, "ref-a");
    const titulo = MOLDE_CASO.blocos[0];
    const base = { historico, paleta: [...MARCA_CASO.paleta, { nome: "Azul", hex: "#1E4FD8", papel: "apoio" }], temPessoa: true, temFoto: false, soTipografia: false, tituloDaReferencia: titulo };
    const proxima = escolherVariedade({ ...base, fidelidade: "proxima" });
    expect(proxima.texto).toBeUndefined();
    expect(proxima.pose).toBeTruthy();
    expect(proxima.pose).not.toBe("de perfil ou meio perfil, com o olhar indo na direção do texto");
    expect(proxima.destaque).not.toBe("Laranja #E8742A");
    expect(proxima.elemento).not.toBe("uma faixa diagonal de cor atravessando um canto");
    expect(destaquesDaPaleta(base.paleta)).toContain(proxima.destaque);
    const inspirada = escolherVariedade({ ...base, fidelidade: "inspirada" });
    // O título da referência está no topo: o texto vai para outro lugar.
    expect(zonaDaCaixa(titulo)!.vertical).toBe("topo");
    expect(inspirada.texto).toBeTruthy();
    expect(inspirada.texto!.indexOf("no topo")).toBe(-1);
    expect(inspirada.texto!.indexOf("terço de cima")).toBe(-1);
    // Com a foto do cliente a pose não muda (é a mesma foto): muda o recorte.
    const comFoto = escolherVariedade({ ...base, fidelidade: "criativa", temFoto: true });
    expect(comFoto.pose).toBeUndefined();
    expect(comFoto.camera).toContain("foto do cliente");
    // Idêntica: nada.
    expect(escolherVariedade({ ...base, fidelidade: "identica" })).toEqual({});
    // Determinístico.
    expect(escolherVariedade({ ...base, fidelidade: "proxima" })).toEqual(proxima);
  });

  it("bloco com histórico: diz o que já foi feito com a referência e o que variar", () => {
    const historico = capasNoHistorico(trabalhos, "ref-a");
    const escolha = escolherVariedade({ fidelidade: "proxima", historico, paleta: MARCA_CASO.paleta, temPessoa: true, temFoto: false, soTipografia: false, tituloDaReferencia: null });
    const b = blocoDaVariedade({ fidelidade: "proxima", historico, escolha, layoutDaReferencia: "título no topo, de lado a lado" });
    expect(b).toContain("VARIEDADE (para não repetir o que já foi feito)");
    expect(b).toContain("- Já foi feito com esta referência: 2 capas deste cliente; 1 no layout idêntico da referência (título no topo, de lado a lado); já variadas com: de perfil ou meio perfil");
    expect(b).toContain("- Varie nesta versão: ");
    expect(b).toContain("a grade e a posição dos blocos de texto da referência");
    expect(b.split("\n").length).toBeLessThanOrEqual(4);
    expect(b).not.toContain("—");
  });

  it("bloco sem histórico: ainda pede variedade; Idêntica fica sem bloco", () => {
    const escolha = escolherVariedade({ fidelidade: "criativa", historico: [], paleta: MARCA_CASO.paleta, temPessoa: false, temFoto: false, soTipografia: true, tituloDaReferencia: null });
    const b = blocoDaVariedade({ fidelidade: "criativa", historico: [], escolha });
    expect(b).toContain("nenhuma capa deste cliente ainda");
    expect(b).toContain("- Varie nesta versão: ");
    expect(escolha.pose).toBeUndefined();
    expect(escolha.camera).toBeUndefined();
    const outras: CapaNoHistorico[] = capasNoHistorico(trabalhos, "ref-z");
    expect(blocoDaVariedade({ fidelidade: "inspirada", historico: outras, escolha })).toContain("nas últimas capas com outras referências");
    expect(blocoDaVariedade({ fidelidade: "identica", historico: outras, escolha })).toBe("");
  });

  it("servidor: a variedade lê as versões do cliente (sem IA) e grava a escolha na versão", () => {
    const corpo = estudio.slice(estudio.indexOf("async function variedadeDaCapa("), estudio.indexOf("async function variedadeDaCapa(") + 2500);
    expect(corpo).toContain('.from("estudio_trabalhos")');
    expect(corpo).toContain('.select("cards")');
    expect(corpo).not.toContain("chamarTexto");
    expect(corpo).not.toContain("jevPerguntar");
    expect(blocoReplicar).toContain("...(variedade ? { variedade: variedade.escolha, variedade_historico: variedade.historico } : {}),");
  });
});

describe("4. Referência prancha", () => {
  const perfil = {
    prancha: true,
    tipo: "perfil",
    sistema: "Grade de 3 colunas, títulos grandes — fundo liso.",
    quadros: [
      { x0: 0, y0: 40, x1: 33, y1: 58, papel: "capa" },
      { x0: 33.5, y0: 40, x1: 66.5, y1: 58, papel: "capa" },
      { x0: 67, y0: 40, x1: 100, y1: 58, papel: "capa" },
      { x0: 0.5, y0: 40.5, x1: 33, y1: 58, papel: "capa" }, // repete o 1º
      { x0: 2, y0: 20, x1: 6, y1: 22, papel: "capa" }, // destaque redondo, pequeno
    ],
  };
  const carrossel = {
    prancha: true,
    tipo: "carrossel",
    sistema: "Lâminas com o mesmo fio no topo.",
    quadros: [
      { x0: 0, y0: 10, x1: 24, y1: 90, papel: "capa" },
      { x0: 25, y0: 10, x1: 49, y1: 90, papel: "sequencia" },
      { x0: 50, y0: 10, x1: 74, y1: 90, papel: "sequencia" },
      { x0: 75, y0: 10, x1: 99, y1: 90, papel: "sequencia" },
    ],
  };

  it("detecção: simples, prancha com um quadro só e leitura quebrada não são prancha; perfil e carrossel são", () => {
    expect(normalizarPrancha({ prancha: false, tipo: "simples", quadros: [], sistema: "" }).prancha).toBe(false);
    expect(normalizarPrancha({ prancha: true, tipo: "mosaico", quadros: [perfil.quadros[0]], sistema: "" }).prancha).toBe(false);
    expect(normalizarPrancha(null).prancha).toBe(false);
    expect(normalizarPrancha("x").quadros).toEqual([]);
    const p = normalizarPrancha(perfil);
    expect(p.prancha).toBe(true);
    expect(p.tipo).toBe("perfil");
    // O quadro repetido e o destaque pequeno saem; travessão vira vírgula.
    expect(p.quadros.length).toBe(3);
    expect(p.sistema).not.toContain("—");
    expect(normalizarPrancha(carrossel).quadros.map((q) => q.papel)).toEqual(["capa", "sequencia", "sequencia", "sequencia"]);
  });

  it("recorte das caixas: pixels da imagem, com recuo do fio da grade; pequeno demais é nulo", () => {
    expect(retanguloDoQuadro({ x0: 0, y0: 40, x1: 33, y1: 58 }, 1170, 2532)).toEqual({ x: 5, y: 1017, largura: 377, altura: 447 });
    expect(retanguloDoQuadro({ x0: 50, y0: 10, x1: 74, y1: 90 }, 4000, 1250)).toEqual({ x: 2005, y: 130, largura: 950, altura: 990 });
    expect(retanguloDoQuadro({ x0: 0, y0: 0, x1: 1, y1: 1 }, 1000, 1000)).toBeNull();
    expect(retanguloDoQuadro({ x0: 0, y0: 0, x1: 50, y1: 50 }, 0, 100)).toBeNull();
  });

  it("quadro por lâmina: capa gira a cada versão; lâmina k usa a sequência k, ciclando; perfil só com capas não dá quadro à lâmina 2", () => {
    const c = normalizarPrancha(carrossel);
    expect(quadroDaLamina(c, 1)).toEqual({ indice: 0, papel: "capa", posicao: 1, de: 1 });
    expect(quadroDaLamina(c, 2)!.indice).toBe(1);
    expect(quadroDaLamina(c, 3)!.indice).toBe(2);
    expect(quadroDaLamina(c, 4)!.indice).toBe(3);
    expect(quadroDaLamina(c, 5)!.indice).toBe(1); // ciclando
    const p = normalizarPrancha(perfil);
    expect([0, 1, 2, 3].map((v) => quadroDaLamina(p, 1, v)!.indice)).toEqual([0, 1, 2, 0]);
    expect(quadroDaLamina(p, 2)).toBeNull();
    // Ajuste da equipe: o 1º fora, o 3º vira sequência.
    const ajustada = pranchaComAjustes(p, papeisDaEquipe(["fora", "capa", "sequencia", "lixo"]));
    expect(ajustada.quadros.map((q) => q.papel)).toEqual(["fora", "capa", "sequencia"]);
    expect(quadroDaLamina(ajustada, 1)!.indice).toBe(1);
    expect(quadroDaLamina(ajustada, 2)!.indice).toBe(2);
    expect(papeisDaEquipe("x")).toBeNull();
    expect(quadroDaLamina(normalizarPrancha(null), 1)).toBeNull();
  });

  it("leitura automática só para quem não tem cara de arte única (print de celular, carrossel lado a lado)", () => {
    expect(pareceArteUnica({ largura: 1080, altura: 1350 })).toBe(true);
    expect(pareceArteUnica({ largura: 1080, altura: 1080 })).toBe(true);
    expect(pareceArteUnica({ largura: 1170, altura: 2532 })).toBe(false);
    expect(pareceArteUnica({ largura: 4320, altura: 1350 })).toBe(false);
    expect(pareceArteUnica(null)).toBe(false);
  });

  it("série: continuidade da prancha no replicar e o quadro de sequência no bloco da série (lâminas que não replicam)", () => {
    expect(continuidadeDaPrancha({ ordem: 1, total: 4, capa: null, quadro: { posicao: 1, de: 3 } })).toBe("");
    const c = continuidadeDaPrancha({ ordem: 4, total: 4, capa: 3, quadro: { posicao: 3, de: 3 } });
    expect(c).toContain("quadro de sequência 3 de 3");
    expect(c).toContain("imagem 3");
    expect(c).toContain("feche com o CTA");
    expect(serieComQuadroDaPrancha({ ordem: 2, total: 4, sequencia: null })).toBe("");
    expect(serieComQuadroDaPrancha({ ordem: 2, total: 4, sequencia: 4 })).toContain("(imagem 4)");
    expect(gerar).toContain('replicar ? "" : blocoDaSerie({ ordem, total, capa: indiceDaCapa, cenaFixa }),');
    expect(gerar).toContain('replicar ? "" : serieComQuadroDaPrancha({ ordem, total, sequencia: indiceDaSequencia }),');
  });

  it("servidor: a geração só usa a leitura guardada (referência simples igual); o recorte é local; a tela lê pela ação prancha", () => {
    expect(gerar).toContain("await quadrosDasPranchas(t, refsDaEquipe, ordem, versoesDaLamina)");
    expect(gerar).not.toContain("lerPrancha(");
    const quadros = estudio.slice(estudio.indexOf("async function quadrosDasPranchas("), estudio.indexOf("async function recortarQuadro("));
    expect(quadros).toContain("pranchaGuardada(t.client_id, r.id)");
    expect(quadros).toContain("if (!l || !l.prancha) return;");
    const recorte = estudio.slice(estudio.indexOf("async function recortarQuadro("), estudio.indexOf("async function sequenciaDaCapa("));
    expect(recorte).toContain("await decodificar(imagem.bytes)");
    expect(recorte).toContain("retanguloDoQuadro(q, img.width, img.height)");
    // O molde do quadro é guardado à parte (o da imagem inteira continua).
    expect(gerar).toContain("{ ...r, id: `${r.id}-q${q.quadro.indice + 1}` }");
    expect(estudio).toContain("prancha: pranchaDaReferencia,");
    expect(estudio).toContain("const caminhoDaPrancha = (clientId: string, refId: string) => `${pastaDasLeituras(clientId)}/prancha-");
    // A leitura do molde (VERSAO_DO_MOLDE, molde-<ref>.json) não mudou.
    expect(estudio).toContain("const caminho = `${pastaDasLeituras(t.client_id)}/molde-${ref.id.replace(/[^0-9a-z-]/gi, \"-\")}.json`;");
    expect(estudio).toContain("if (guardado && guardado.versao === VERSAO_DO_MOLDE) return normalizarMolde(guardado.molde);");
  });

  it("configurar: fidelidade por lâmina e do trabalho, papéis dos quadros; tudo validado", () => {
    const conf = estudio.slice(estudio.indexOf("async function configurar("), estudio.indexOf("// ------------------------------------------------------------- reabrir"));
    expect(conf).toContain('throw new ErroEstudio(400, "fidelidade_invalida"');
    expect(conf).toContain("mudou.fidelidade_referencia = fidelidadeCard;");
    expect(conf).toContain("{ fidelidade_referencia: fidelidadeConjunto }");
    expect(conf).toContain("pranchasComAjuste(x.direcao.pranchas, pranchaPedida.refId, pranchaPedida.papeis)");
    expect(corpoDaFidelidade("lamina", "proxima", 3)).toEqual({ card: { ordem: 3, fidelidade_referencia: "proxima" } });
    expect(corpoDaFidelidade("conjunto", null)).toEqual({ conjunto: { fidelidade_referencia: null } });
    expect(corpoDaPrancha("r1", ["capa", "fora"])).toEqual({ conjunto: { prancha: { referencia_id: "r1", papeis: ["capa", "fora"] } } });
    expect(proximoPapel("capa")).toBe("sequencia");
    expect(proximoPapel("sequencia")).toBe("fora");
    expect(proximoPapel("fora")).toBe("capa");
  });
});

describe("5. Registro em _shared/motores.ts", () => {
  it("cada mudança do gerador aponta trechos que existem no estúdio", () => {
    expect(MUDANCAS_DO_GERADOR_DO_ESTUDIO.map((m) => m.id)).toEqual(["fidelidade_da_referencia", "variedade_com_memoria", "prancha_de_referencias"]);
    for (const m of MUDANCAS_DO_GERADOR_DO_ESTUDIO) {
      const fonte = ler(m.ligacao.arquivo);
      for (const t of m.ligacao.trechos) expect(fonte, `${m.id}: ${t}`).toContain(t);
      expect(m.intocado.length).toBeGreaterThan(10);
      expect(`${m.pedido} ${m.o_que} ${m.intocado}`).not.toContain("—");
    }
  });
});

// ------------------------------------------------------------------ tela

const valorDaMesa = (): MesaValor => ({
  clientId: "11111111-1111-1111-1111-111111111111",
  clientName: "Cliente sintético",
  userId: "u-1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 50,
  catalogo: [],
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
});

function montar(filho: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(MemoryRouter, null, h(QueryClientProvider, { client: qc }, h(MesaProvider, { valor: valorDaMesa() }, filho))));
}

describe("3. Tela: controle da fidelidade, selo da série e versão", () => {
  beforeEach(() => mock.invoke.mockReset());

  it("controle de 4 passos: Idêntica marcada por padrão; escolher grava na lâmina", async () => {
    const onSalvar = vi.fn(() => Promise.resolve());
    montar(h(EstudioFidelidadeDaReferencia, { alvo: "lamina", ordem: 1, escolha: null, doTrabalho: null, onSalvar }));
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["Idêntica", "Próxima", "Inspirada", "Criativa"]);
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/Segue o trabalho \(Idêntica\)/)).toBeTruthy();
    fireEvent.click(radios[1]);
    await waitFor(() => expect(onSalvar).toHaveBeenCalledWith({ card: { ordem: 1, fidelidade_referencia: "proxima" } }));
  });

  it("lâmina com escolha própria: marcada, com 'usar a do trabalho'; no trabalho, Idêntica volta para o padrão (null)", async () => {
    const onSalvar = vi.fn(() => Promise.resolve());
    const { unmount } = montar(h(EstudioFidelidadeDaReferencia, { alvo: "lamina", ordem: 2, escolha: "criativa", doTrabalho: "proxima", onSalvar }));
    expect(screen.getAllByRole("radio")[3].getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByText("usar a do trabalho"));
    await waitFor(() => expect(onSalvar).toHaveBeenCalledWith({ card: { ordem: 2, fidelidade_referencia: null } }));
    unmount();
    const onConjunto = vi.fn(() => Promise.resolve());
    montar(h(EstudioFidelidadeDaReferencia, { alvo: "conjunto", escolha: "inspirada", onSalvar: onConjunto }));
    fireEvent.click(screen.getAllByRole("radio")[0]);
    await waitFor(() => expect(onConjunto).toHaveBeenCalledWith({ conjunto: { fidelidade_referencia: null } }));
  });

  it("selo da série: nada na capa; 'Segue a capa' sem referência; 'Segue a referência' com a da lâmina ou do conjunto", () => {
    expect(seloDaSerie({ ordem: 1 }, 4, [])).toBeNull();
    expect(seloDaSerie({ ordem: 2 }, 1, [])).toBeNull();
    expect(seloDaSerie({ ordem: 2 }, 4, [])).toEqual({ tipo: "capa", daLamina: false, referencia: null });
    expect(seloDaSerie({ ordem: 3, referencias_ids: ["r9"] }, 4, ["r1"])).toEqual({ tipo: "referencia", daLamina: true, referencia: "r9" });
    expect(seloDaSerie({ ordem: 3 }, 4, ["r1"])).toEqual({ tipo: "referencia", daLamina: false, referencia: "r1" });
    const { container, unmount } = montar(h(SeloDaSerie, { card: { ordem: 2 }, total: 4, refsDoConjunto: [] }));
    expect(container.querySelector("[data-selo='serie']")!.textContent).toBe("Segue a capa");
    unmount();
    const outro = montar(h(SeloDaSerie, { card: { ordem: 2 }, total: 4, refsDoConjunto: ["r1"] }));
    expect(outro.container.querySelector("[data-selo='serie']")!.textContent).toContain("Segue a referência");
    expect(outro.container.querySelector("[data-selo='serie']")!.textContent).toContain("(do conjunto)");
  });

  it("faixa da lâmina: o controle só aparece quando a lâmina replica referência; o selo com o total", () => {
    const props = (card: any) => ({
      card,
      refsDoConjunto: [],
      continuo: false,
      versao: null,
      onAbrirFotos: vi.fn(),
      onAbrirReferencias: vi.fn(),
      total: 3,
      fidelidade: h("span", { "data-teste": "controle" }, "controle"),
    });
    const { container, unmount } = montar(h(EstudioBaseDaLamina, props({ ordem: 2 })));
    expect(container.querySelector("[data-teste='controle']")).toBeNull();
    expect(container.querySelector("[data-selo='serie']")!.textContent).toBe("Segue a capa");
    unmount();
    const com = montar(h(EstudioBaseDaLamina, props({ ordem: 1, referencias_ids: ["r1"] })));
    expect(com.container.querySelector("[data-faixa='fidelidade'] [data-teste='controle']")).toBeTruthy();
    expect(com.container.querySelector("[data-selo='serie']")).toBeNull();
  });

  it("versão: mostra o nível usado no replicar (e o quadro da prancha)", () => {
    expect(rotuloDaVersao({ modo: "replicar_referencia", fidelidade_referencia: "inspirada" })).toBe("Ref. Inspirada");
    expect(rotuloDaVersao({ modo: "replicar_referencia" })).toBe("");
    expect(rotuloDaVersao({ modo: "normal", fidelidade_referencia: "criativa" })).toBe("");
    const card = ler("src/components/mesa/CardDoEstudio.tsx");
    expect(card).toContain("{rotuloDaVersao(v)}");
    expect(card).toContain("quadro ${v.prancha[0].quadro}");
  });

  it("prancha na tela: quadros com o papel; clicar troca o papel e grava todos", async () => {
    mock.invoke.mockResolvedValue({
      data: {
        referencia_id: "r1",
        lida: true,
        prancha: { prancha: true, tipo: "carrossel", sistema: "", quadros: [{ x0: 0, y0: 0, x1: 25, y1: 100, papel: "capa" }, { x0: 25, y0: 0, x1: 50, y1: 100, papel: "sequencia" }, { x0: 50, y0: 0, x1: 75, y1: 100, papel: "sequencia" }] },
        dimensoes: { largura: 4320, altura: 1350 },
        url: "https://exemplo.test/prancha.png",
      },
      error: null,
    });
    const onSalvar = vi.fn(() => Promise.resolve());
    montar(h(EstudioPranchaDaReferencia, { trabalhoId: "t1", referenciaId: "r1", rotulo: "referência", onSalvar }));
    await waitFor(() => expect(screen.getByText(/print do carrossel com 3 artes/)).toBeTruthy());
    expect(mock.invoke).toHaveBeenCalledWith("estudio-arte", expect.objectContaining({ body: expect.objectContaining({ acao: "prancha", trabalho_id: "t1", referencia_id: "r1" }) }));
    fireEvent.click(screen.getByLabelText("Quadro 1: capa"));
    await waitFor(() => expect(onSalvar).toHaveBeenCalledWith({ conjunto: { prancha: { referencia_id: "r1", papeis: ["sequencia", "sequencia", "sequencia"] } } }));
  });

  it("prancha: referência de arte única não lida mostra só o link para ler; lida como simples, nada", async () => {
    mock.invoke.mockResolvedValue({ data: { referencia_id: "r2", lida: false, prancha: null, parece_arte_unica: true }, error: null });
    const { container, unmount } = montar(h(EstudioPranchaDaReferencia, { trabalhoId: "t1", referenciaId: "r2", rotulo: "referência", onSalvar: vi.fn() }));
    await waitFor(() => expect(container.querySelector("[data-prancha='ler']")).toBeTruthy());
    unmount();
    mock.invoke.mockResolvedValue({ data: { referencia_id: "r3", lida: true, prancha: null }, error: null });
    const lida = montar(h(EstudioPranchaDaReferencia, { trabalhoId: "t1", referenciaId: "r3", rotulo: "referência", onSalvar: vi.fn() }));
    await waitFor(() => expect(mock.invoke).toHaveBeenCalled());
    await waitFor(() => expect(lida.container.querySelector("[data-prancha]")).toBeNull());
  });

  it("recorte na tela sem código: a caixa na proporção do quadro e a imagem deslocada", () => {
    const e = estiloDoQuadro({ x0: 25, y0: 10, x1: 50, y1: 90, papel: "sequencia" }, { largura: 4000, altura: 1250 });
    // Quadro de 1000 x 1000 px: caixa quadrada.
    expect(e.caixa.paddingBottom).toBe("100%");
    expect(e.imagem.width).toBe("400%");
    expect(e.imagem.left).toBe("-100%");
    expect(e.imagem.top).toBe("-12.5%");
  });

  it("só o Estúdio liga os extras nas referências (o Estúdio Ads segue igual)", () => {
    expect(ler("src/components/mesa/AbaEstudio.tsx")).toContain("extrasDoEstudio\n");
    expect(ler("src/components/mesa-ads/ReferenciasDoCriativo.tsx")).not.toContain("extrasDoEstudio");
    expect(ler("src/components/mesa/ReferenciasDoEstudio.tsx")).toContain("{extrasDoEstudio && escolhidas.length > 0 && (");
  });
});

describe("compatibilidade e texto (arquivos novos da frente E)", () => {
  it("sem lookbehind, \\p{}, grupo nomeado, .at(), Object.hasOwn, aspect-ratio, :has, min() nem travessão", () => {
    for (const rel of [
      "src/components/mesa/fidelidadeDaReferencia.ts",
      "src/components/mesa/EstudioFidelidadeDaReferencia.tsx",
      "src/components/mesa/EstudioPranchaDaReferencia.tsx",
      "src/components/mesa/EstudioBaseDaLamina.tsx",
      "src/components/mesa/ReferenciasDoEstudio.tsx",
      "supabase/functions/_shared/fidelidade-da-referencia.ts",
      "supabase/functions/_shared/prancha-de-referencias.ts",
    ]) {
      const t = ler(rel);
      expect(t, rel).not.toContain("(?<");
      expect(t, rel).not.toMatch(/\\p\{/);
      expect(t, rel).not.toContain(".at(");
      expect(t, rel).not.toContain("Object.hasOwn(");
      expect(t, rel).not.toMatch(/aspect-\[|aspect-square|aspect-video|aspectRatio/);
      expect(t, rel).not.toContain(":has(");
      expect(t, rel).not.toMatch(/(^|[^.\w])(min|max|clamp)\(/m);
      expect(t, rel).not.toContain("—");
      expect(t, rel).not.toContain("–");
    }
  });
});
