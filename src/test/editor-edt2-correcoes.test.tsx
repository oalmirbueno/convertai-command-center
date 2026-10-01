import { createElement as h } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizarProjeto, projetoDosTakes, type ProjetoDeEdicao } from "../../supabase/functions/_shared/projeto-de-edicao";
import { estimativaDoPlanoUsd, pedidoDoPlano, planoPadrao, sistemaDoPlano } from "../../supabase/functions/editor-video/modulos/plano-da-edicao";
import { TETO_DOS_SUPERPODERES } from "../../supabase/functions/_shared/superpoderes-catalogo";
import { aplicarOperacao, fimDoClipe } from "@/lib/editor/operacoes";
import { montarEdicaoCompleta } from "@/lib/editor/edicaoCompleta";
import { custoDoPlano, rastrearRosto, resumoParaOPlano } from "@/lib/editor/editarComIa";
import { blocosDeFrases, brollEmBlocos, capitulosEmBlocos, juntarCapitulos, momentosEmBlocos, mmss, type FraseParaJulgar } from "@/lib/editor/julgarEmBlocos";
import { letraDaMarcaParaVideo } from "@/lib/editor/estilosDeTexto";

/**
 * Correções do revisor na frente EDT (rodada 2, 01/10): música no Plano da
 * casa, rastreio do rosto que não perde o que já foi pago, julgamentos do
 * vídeo inteiro (em blocos), letra da marca no projeto, custo do plano com o
 * método da casa, estado "erro" da máquina de render e o cartão final sem
 * legenda por cima. Sem rede: a função e os quadros são simulados.
 */

const mock = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("@/lib/editor/quadros", () => ({
  extrairQuadro: vi.fn(async (_url: string, t: number) => ({ tempo_s: t, dataUrl: "data:image/jpeg;base64,QUJD" })),
  base64DoDataUrl: (d: string) => d.split(",")[1] || "",
  tempoDoQuadro: (t: number, fps: number) => Math.round(t * fps) / fps,
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mock.from } }));

import EstadoDaMaquina from "@/components/mesa-edicao/editor/EstadoDaMaquina";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const AGORA = "2026-10-01T12:00:00.000Z";

function frases(n: number, passo = 4): FraseParaJulgar[] {
  return Array.from({ length: n }, (_, i) => ({ k: `f${i + 1}`, inicio_s: i * passo, fim_s: i * passo + passo - 0.5, texto: `Frase número ${i + 1} do podcast.` }));
}

/** Projeto com fala de 12 s, 9:16, e (opcional) uma música na Mídia. */
function projeto(comMusica: boolean): ProjetoDeEdicao {
  let p = projetoDosTakes({
    titulo: "Reel",
    fps: 25,
    takes: [{ id: "a", nome: "fala.mp4", tipo: "bruto", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/a.mp4`, cena_ref: null, melhor: true, duracao_s: 12, largura: 1080, altura: 1920 }],
    agora: AGORA,
  });
  const palavras = "Você perde cliente todo dia. Eu vendi muito café numa semana! Comenta CAFÉ que eu te mando o passo a passo hoje.".split(" ");
  const segmentos = palavras.map((t, k) => ({ t, i: Math.round((0.3 + k * 0.5) * 1000) / 1000, f: Math.round((0.7 + k * 0.5) * 1000) / 1000 }));
  p = aplicarOperacao(p, { op: "transcricao", fonte: "fala", transcricao: { segmentos, por_palavra: true, origem: "teste", versao: 1, em: AGORA } });
  if (comMusica) {
    p = aplicarOperacao(p, { op: "fonte", fonte: { chave: "trilha-leve", arquivo_id: null, nome: "Trilha leve.mp3", tipo: "audio", storage_bucket: "mesa", storage_path: `${CLIENTE}/audio/trilha.mp3`, duracao_s: 60, largura: null, altura: null, midia: "audio" } });
  }
  return p;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------- música no Plano da casa

describe("Plano da casa com a música da Mídia", () => {
  it("a primeira música do projeto entra; sem música, a peça fica desligada", () => {
    expect(planoPadrao("dinamico", ["trilha-leve", "outra"]).musica).toEqual({ ligado: true, fonte: "trilha-leve" });
    expect(planoPadrao("dinamico").musica).toEqual({ ligado: false, fonte: "" });
  });

  it("montado pelo Plano da casa, sai a trilha com papel trilha (e o ducking)", () => {
    const p = projeto(true);
    const resumo = resumoParaOPlano(p, null, 0);
    expect(resumo.musicas).toEqual(["trilha-leve"]);
    const r = montarEdicaoCompleta(p, planoPadrao("dinamico", resumo.musicas), { agora: AGORA });
    expect(r.passos.find((x) => x.id === "musica")!.feito).toBe(true);
    const trilhas = r.proposta.resultado.trilhas.filter((t) => t.tipo === "audio").reduce((l, t) => l.concat(t.clipes), [] as ProjetoDeEdicao["trilhas"][number]["clipes"]);
    expect(trilhas.some((c) => c.fonte === "trilha-leve" && (c.estilo as Record<string, unknown>).papel === "trilha")).toBe(true);
  });
});

// ---------------------------------------------------------------- rosto: o que foi pago fica

describe("rastrear o rosto sem perder o que já foi pago", () => {
  const modelo = { id: "visao", preco_entrada_1m: 1, preco_saida_1m: 2 };
  const longo = () => {
    // 40 s de vídeo: 26 quadros, 3 lotes.
    const p = projetoDosTakes({ titulo: "Longo", fps: 25, takes: [{ id: "a", nome: "longo.mp4", tipo: "bruto", storage_bucket: "mesa", storage_path: `${CLIENTE}/l.mp4`, cena_ref: null, melhor: true, duracao_s: 40, largura: 1920, altura: 1080 }] });
    return { p, chave: Object.keys(p.fontes)[0] };
  };
  const leituras = (quadros: { tempo_s: number }[]) => quadros.map((q) => ({ t: q.tempo_s, x: 0.5, y: 0.4, w: 0.2 }));

  it("o segundo lote falha (402): as leituras do primeiro viram o rastro, com o motivo, sem lançar", async () => {
    const { p, chave } = longo();
    let n = 0;
    const chamar = vi.fn(async (corpo: Record<string, unknown>) => {
      n++;
      if (n === 2) throw new Error("Sem crédito de IA (402).");
      return { leituras: leituras(corpo.quadros as { tempo_s: number }[]), custo_usd: 0.01 };
    });
    const r = await rastrearRosto(chamar, { clientId: CLIENTE, projeto: p, chaves: [chave], urls: { [chave]: "https://x/v.mp4" }, modelo, referencia: "ref-1" });
    expect(chamar).toHaveBeenCalledTimes(2);
    expect(r.erro).toMatch(/402/);
    expect(r.ops).toHaveLength(1);
    const op = r.ops[0] as { op: string; rastro: { pontos: unknown[] } };
    expect(op.op).toBe("rosto");
    expect(op.rastro.pontos.length).toBeGreaterThan(0);
    expect(r.custo_usd).toBe(0.01);
  });

  it("Parar no meio: devolve o que já veio e marca parado", async () => {
    const { p, chave } = longo();
    let parar = false;
    const chamar = vi.fn(async (corpo: Record<string, unknown>) => {
      parar = true;
      return { leituras: leituras(corpo.quadros as { tempo_s: number }[]), custo_usd: 0.02 };
    });
    const r = await rastrearRosto(chamar, { clientId: CLIENTE, projeto: p, chaves: [chave], urls: { [chave]: "https://x/v.mp4" }, modelo, referencia: "ref-2", parado: () => parar });
    expect(chamar).toHaveBeenCalledTimes(1);
    expect(r.parado).toBe(true);
    expect(r.erro).toBeNull();
    expect(r.ops).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- julgar o vídeo inteiro

describe("julgamentos em blocos (vídeo inteiro)", () => {
  it("blocos de 60 com e sem emenda", () => {
    expect(blocosDeFrases(frases(150), 60).blocos.map((b) => b.length)).toEqual([60, 60, 30]);
    const comEmenda = blocosDeFrases(frases(150), 60, 1).blocos;
    expect(comEmenda[1][0].k).toBe("f60");
    expect(comEmenda[comEmenda.length - 1][comEmenda[comEmenda.length - 1].length - 1].k).toBe("f150");
    expect(blocosDeFrases(frases(5000), 60, 0, 3).cortado).toBe(true);
    expect(mmss(3725)).toBe("1:02:05");
  });

  it("força de 150 frases: 3 chamadas de até 60, nota para todas", async () => {
    const lidas: number[] = [];
    const chamar = vi.fn(async (c: Record<string, unknown>) => {
      const fs = c.frases as FraseParaJulgar[];
      lidas.push(fs.length);
      return { forca: fs.map((f) => ({ k: f.k, nota: 0.5 })), virais: [] };
    });
    const r = await momentosEmBlocos(chamar, { clientId: CLIENTE, titulo: "Podcast", frases: frases(150), forca: true, virais: false });
    expect(lidas).toEqual([60, 60, 30]);
    expect(r.forca).toHaveLength(150);
    expect(r.aviso).toBeNull();
  });

  it("virais: a janela desliza (emenda) e os do fim do vídeo entram", async () => {
    const chamar = vi.fn(async (c: Record<string, unknown>) => {
      const fs = c.frases as FraseParaJulgar[];
      expect(fs.length).toBeLessThanOrEqual(60);
      return { forca: [], virais: [{ inicio_s: fs[fs.length - 5].inicio_s, fim_s: fs[fs.length - 1].fim_s, nota: 0.8, texto: "trecho" }] };
    });
    const r = await momentosEmBlocos(chamar, { clientId: CLIENTE, titulo: "Podcast", frases: frases(150), forca: false, virais: true });
    expect(chamar.mock.calls.length).toBe(3);
    // O segundo bloco repete o fim do primeiro.
    const b1 = chamar.mock.calls[0][0].frases as FraseParaJulgar[];
    const b2 = chamar.mock.calls[1][0].frases as FraseParaJulgar[];
    expect(b2[0].inicio_s).toBeLessThan(b1[b1.length - 1].fim_s);
    expect(Math.max(...r.virais.map((v) => v.fim_s))).toBeGreaterThan(500);
  });

  it("capítulos: a fronteira entre blocos é julgada, o da emenda sai e passa do minuto 5", async () => {
    const chamar = vi.fn(async (c: Record<string, unknown>) => {
      const fs = c.frases as FraseParaJulgar[];
      // Toda chamada devolve a primeira frase (a da emenda, nos blocos 2 e 3) e uma no meio.
      return { capitulos: [{ inicio_s: fs[0].inicio_s, titulo: "Parte 1" }, { inicio_s: fs[30].inicio_s, titulo: `Assunto em ${fs[30].k}` }] };
    });
    const r = await capitulosEmBlocos(chamar, { clientId: CLIENTE, frases: frases(150) });
    expect(chamar.mock.calls.length).toBe(3);
    expect(r.capitulos[0]).toEqual({ inicio_s: 0, titulo: "Parte 1" });
    const emendas = [59 * 4, 118 * 4];
    expect(r.capitulos.some((c) => emendas.indexOf(c.inicio_s) >= 0)).toBe(false);
    expect(r.capitulos[r.capitulos.length - 1].inicio_s).toBeGreaterThan(300);
    expect(juntarCapitulos([{ inicio_s: 0, titulo: "Parte 9" }, { inicio_s: 5, titulo: "Perto demais" }, { inicio_s: 40, titulo: "Parte 3" }])).toEqual([
      { inicio_s: 0, titulo: "Parte 1" },
      { inicio_s: 40, titulo: "Parte 2" },
    ]);
  });

  it("B-roll em blocos de 30; um bloco que falha devolve o que saiu com o aviso julguei só até", async () => {
    let n = 0;
    const chamar = vi.fn(async (c: Record<string, unknown>) => {
      n++;
      if (n === 3) throw new Error("Jev fora do ar");
      const fs = c.frases as FraseParaJulgar[];
      return { escolhas: [{ k: fs[2].k, item: `v${n}`, inicio_s: fs[2].inicio_s, fim_s: fs[2].fim_s, probabilidade: 0.9 }] };
    });
    const r = await brollEmBlocos(chamar, { clientId: CLIENTE, frases: frases(150), acervo: [{ id: "v1", descricao: "loja" }], maximo: 6 });
    expect(chamar.mock.calls.map((x) => (x[0].frases as unknown[]).length)).toEqual([30, 30, 30]);
    expect(r.escolhas.map((e) => e.item)).toEqual(["v1", "v2"]);
    expect(r.aviso).toMatch(/julguei só até 3:5\d de 9:5\d/);
    expect(r.aviso).toMatch(/Jev fora do ar/);
  });

  it("o primeiro bloco falha: o erro sobe (quem chamou usa a regra da casa)", async () => {
    const chamar = vi.fn(async () => {
      throw new Error("sem rede");
    });
    await expect(capitulosEmBlocos(chamar, { clientId: CLIENTE, frases: frases(10) })).rejects.toThrow("sem rede");
  });
});

// ---------------------------------------------------------------- letra da marca

describe("letra da marca no vídeo", () => {
  it("escolhe a de título, limpa o nome e exige arquivo de fonte", () => {
    expect(
      letraDaMarcaParaVideo([
        { nome: "Roboto", papel: "texto", storage_path: "biblioteca/fontes/roboto/Roboto-Regular.ttf" },
        { nome: "Bebas Neue-Pró", papel: "titulo", storage_path: `${CLIENTE}/fontes/bebas.otf` },
      ]),
    ).toEqual({ familia: "Bebas Neue Pro", caminho: `${CLIENTE}/fontes/bebas.otf` });
    expect(letraDaMarcaParaVideo([{ nome: "X", papel: "titulo", storage_path: "a.ttf" }])).toBeNull();
    expect(letraDaMarcaParaVideo([{ nome: "Boa", papel: "titulo", storage_path: "a.png" }])).toBeNull();
    expect(letraDaMarcaParaVideo(null)).toBeNull();
  });

  it("o projeto guarda o arquivo só com o nome e com caminho seguro", () => {
    const base = projetoDosTakes({ titulo: "a", fps: 25, takes: [] });
    const com = (identidade: unknown) => normalizarProjeto({ ...base, identidade })!.identidade;
    expect(com({ cor: "#ff0000", fonte: "Bebas Neue", fonte_path: `${CLIENTE}/fontes/bebas.otf` })).toMatchObject({ fonte: "Bebas Neue", fonte_path: `${CLIENTE}/fontes/bebas.otf` });
    expect(com({ cor: "#ff0000", fonte: null, fonte_path: `${CLIENTE}/fontes/bebas.otf` })!.fonte_path).toBeUndefined();
    expect(com({ fonte: "Bebas", fonte_path: `${CLIENTE}/../outro/x.ttf` })!.fonte_path).toBeUndefined();
    expect(com({ fonte: "Bebas", fonte_path: "https://mal.com/x.ttf" })!.fonte_path).toBeUndefined();
  });

  it("a montagem leva a letra e o arquivo da marca para o projeto", () => {
    const p = projeto(false);
    const r = montarEdicaoCompleta(p, planoPadrao("dinamico"), { agora: AGORA, marca: { nome: "Café", cor: "#ff6600", fonte: "Bebas Neue", fonte_path: `${CLIENTE}/fontes/bebas.otf`, logo_path: null } });
    expect(r.proposta.resultado.identidade).toMatchObject({ fonte: "Bebas Neue", fonte_path: `${CLIENTE}/fontes/bebas.otf` });
    expect(r.passos.find((x) => x.id === "marca")!.detalhe).toMatch(/letra/);
  });
});

// ---------------------------------------------------------------- custo do plano com o método da casa

describe("custo do plano cobre o método da casa", () => {
  it("o mostrado nunca fica abaixo do conferido com o maior método", () => {
    const p = projeto(false);
    const resumo = resumoParaOPlano(p, "Café", 0);
    const m = { id: "m", preco_entrada_1m: 3, preco_saida_1m: 15 };
    const mostrado = custoDoPlano(m, "Deixa dinâmico", resumo, false);
    const conferido = estimativaDoPlanoUsd(3, 15, sistemaDoPlano().length + pedidoDoPlano("Deixa dinâmico", resumo).length + TETO_DOS_SUPERPODERES + 2, false);
    const semMetodo = estimativaDoPlanoUsd(3, 15, sistemaDoPlano().length + pedidoDoPlano("Deixa dinâmico", resumo).length, false);
    expect(mostrado).toBeGreaterThanOrEqual(conferido);
    expect(mostrado).toBeGreaterThan(semMetodo);
  });
});

// ---------------------------------------------------------------- cartão final limpo

describe("cartão final sem legenda por cima", () => {
  it("a legenda que passa do começo do cartão é aparada e a chamada vai para antes dele", () => {
    const p = projeto(false);
    const plano = { ...planoPadrao("dinamico"), cortar_pausas: false, cortar_erros: false, textos: { gancho: "", chamada: "Comenta CAFÉ", nome: "" }, cartao_final: { ligado: true, titulo: "Café bom", botao: "Fale com a gente" } };
    const r = montarEdicaoCompleta(p, plano, { agora: AGORA });
    const q = r.proposta.resultado;
    expect(r.passos.find((x) => x.id === "cartao")!.feito).toBe(true);
    const inicioDoCartao = Math.max(0, q.duracao_s - 3.5);
    q.trilhas
      .filter((t) => t.tipo === "legenda" || t.tipo === "texto")
      .forEach((t) =>
        t.clipes
          .filter((c) => !(c.estilo && typeof (c.estilo as Record<string, unknown>).peca === "string"))
          .forEach((c) => expect(fimDoClipe(c)).toBeLessThanOrEqual(inicioDoCartao + 0.05)),
      );
    expect(q.trilhas.some((t) => t.tipo === "legenda" && t.clipes.length > 0)).toBe(true);
  });
});

// ---------------------------------------------------------------- estado da máquina

describe("estado da máquina de render", () => {
  const consulta = (r: unknown) => {
    const b: Record<string, unknown> = {};
    ["select", "order", "limit"].forEach((k) => (b[k] = () => b));
    b.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) => Promise.resolve(r).then(ok, falha);
    return b;
  };

  it("erro de rede ou permissão: diz que não conferiu (nunca 'nunca ligado')", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mock.from.mockReturnValue(consulta({ data: null, error: { code: "42501", message: "permission denied" } }));
    render(h(EstadoDaMaquina));
    await waitFor(() => expect(document.querySelector('[data-estado-da-maquina="erro"]')).toBeTruthy());
    expect(screen.getByText("Não deu para conferir o render")).toBeTruthy();
    expect(screen.queryByText(/nunca ligado/)).toBeNull();
  });

  it("sem worker registrado: nunca ligado", async () => {
    mock.from.mockReturnValue(consulta({ data: [], error: null }));
    render(h(EstadoDaMaquina));
    await waitFor(() => expect(document.querySelector('[data-estado-da-maquina="nunca"]')).toBeTruthy());
  });
});
