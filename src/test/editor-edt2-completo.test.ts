import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { comFormato, corPadrao, migrarProjeto, normalizarProjeto, projetoDosTakes, TIPOS_DE_TRILHA, type ProjetoDeEdicao } from "../../supabase/functions/_shared/projeto-de-edicao";
import { estimativaDoPlanoUsd, LEGENDAS_DO_PLANO, LOOKS_DO_PLANO, linhasDoPlano, normalizarPlano, planoPadrao, RECEITAS, semNumeroInventado } from "../../supabase/functions/editor-video/modulos/plano-da-edicao";
import {
  candidatosDeTitulo,
  comecosDeCapitulo,
  escolherBroll,
  escolherVirais,
  estimativaDoRostoUsd,
  janelasCandidatas,
  leiturasDoRosto,
  notaDe0a1,
  notasDeForca,
  perguntasDeBroll,
  perguntasDeForca,
  perguntasDeFronteira,
  perguntasDeViral,
  titulosEscolhidos,
  NIVEIS_DA_FORCA,
} from "../../supabase/functions/editor-video/modulos/julgamentos-da-edicao";
import { aplicarCurvaDaLut, aproximarLut, curvaDeTom, ErroDaLut, filtroDaCor, lerCube, LOOKS, lutDoArquivo, matrizDeCor, parametrosFinais } from "@/lib/editor/cor";
import { cameraNoTempo, clipeDeZoom, rotuloDoAjuste } from "@/lib/editor/efeitos";
import { limparLeituras, recortePara, rostoNoTempo } from "@/lib/editor/reenquadre";
import { PRESETS_DE_LEGENDA, PRESETS_DE_TEXTO, alturaDaPosicao, alturaDoBloco, corSobre } from "@/lib/editor/estilosDeTexto";
import { aplicarOperacao, aplicarOperacoes, assinaturaDoProjeto, trilhaPrincipal } from "@/lib/editor/operacoes";
import { Montador } from "@/lib/editor/skills/tipos";
import { proporSkill, skillPorPalavras } from "@/lib/editor/skills";
import { brollDoAcervoEm, capitulosParaYoutube, frasesDaFala, frasesDoProjeto, notasPorRegra, projetoDoTrecho, textosEm, zoomNosMomentosEm } from "@/lib/editor/skills/pecasDaEdicao";
import { montarEdicaoCompleta, projetoDepoisDoCorte } from "@/lib/editor/edicaoCompleta";
import { acervoParaBroll, custoDoPlano, custoDoRosto, resumoParaOPlano, temposDoRosto } from "@/lib/editor/editarComIa";
import { linhasDaLegenda } from "@/lib/editor/render";
import { rotuloDoClipe } from "@/lib/editor/apelidos";
import TextoNaTela from "@/components/mesa-edicao/editor/TextoNaTela";
import { executarFerramenta } from "@/lib/editor/agente";

/**
 * Frente EDT, rodada 2 (30/09): o editor completo. Tudo aqui é conta pura
 * (sem rede nem banco): a LUT aproximada, o recorte que segue o rosto, a
 * camada de ajuste, os estilos de texto, as peças novas, o plano do "Editar
 * com IA", os julgamentos do Jev (montagem das perguntas e composição das
 * respostas) e o pipeline inteiro de ponta a ponta.
 */

const AGORA = "2026-09-30T12:00:00.000Z";
const CLIENTE = "11111111-1111-4111-8111-111111111111";

/** Projeto com fala palavra por palavra (tempo da fonte), 20 s, horizontal (16:9) num quadro 9:16. */
function projetoFalado(): ProjetoDeEdicao {
  const p = projetoDosTakes({
    titulo: "Reel do café",
    fps: 25,
    takes: [{ id: "a", nome: "fala.mp4", tipo: "bruto", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/brutos/a.mp4`, cena_ref: null, melhor: true, duracao_s: 20, largura: 1920, altura: 1080 }],
    agora: AGORA,
  });
  const frases = [
    "Você está perdendo cliente todo dia.",
    "Olha só isso!",
    "Eu vendi 300 cafés em uma semana.",
    "O segredo é simples.",
    "Primeiro, um cardápio curto.",
    "Depois, atendimento rápido.",
    "Comenta CAFÉ que eu te mando o passo a passo.",
  ];
  const segmentos: { t: string; i: number; f: number }[] = [];
  let t = 0.3;
  frases.forEach((f) => {
    f.split(" ").forEach((w) => {
      segmentos.push({ t: w, i: Math.round(t * 1000) / 1000, f: Math.round((t + 0.32) * 1000) / 1000 });
      t += 0.38;
    });
    t += 0.9;
  });
  return aplicarOperacao(p, { op: "transcricao", fonte: "fala", transcricao: { segmentos, por_palavra: true, origem: "teste", versao: 1, em: AGORA } });
}

// ---------------------------------------------------------------- cor e LUT

function cube3d(N: number, f: (r: number, g: number, b: number) => [number, number, number]): string {
  const linhas = ["TITLE \"Teste\"", `LUT_3D_SIZE ${N}`];
  for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) linhas.push(f(r / (N - 1), g / (N - 1), b / (N - 1)).map((x) => x.toFixed(6)).join(" "));
  return linhas.join("\n");
}

describe("cor: looks, correção e LUT", () => {
  it("neutro não desenha nada; tom e matriz de cor saem dos números", () => {
    expect(filtroDaCor(corPadrao()).neutro).toBe(true);
    expect(curvaDeTom(0, 0)[8]).toBe(0.5);
    expect(curvaDeTom(0, 0)[16]).toBe(1);
    expect(curvaDeTom(0, 0.5)[4]).toBeLessThan(0.25);
    expect(matrizDeCor(0, 0, 0)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
    const pb = matrizDeCor(-1, 0, 0);
    expect(pb[0]).toBeCloseTo(0.2126, 3);
    expect(pb[1]).toBeCloseTo(0.7152, 3);
    const f = filtroDaCor({ ...corPadrao(), look: "cinema" });
    expect(f.neutro).toBe(false);
    expect(f.tom && f.matriz).toBeTruthy();
    expect(f.vinheta).toBeGreaterThan(0);
  });

  it("força do look e ajuste manual somam dentro dos limites", () => {
    const p = parametrosFinais({ ...corPadrao(), look: "pb", intensidade: 0.5, saturacao: -0.9 });
    expect(p.saturacao).toBe(-1);
    expect(LOOKS.map((l) => l.id).sort()).toEqual(LOOKS_DO_PLANO.slice().sort());
  });

  it("LUT identidade: aproximação exata", () => {
    const l = lutDoArquivo(cube3d(9, (r, g, b) => [r, g, b]), "neutra.cube");
    expect(l.nome).toBe("Teste");
    expect(l.erro).toBeLessThan(0.002);
    expect(aplicarCurvaDaLut(l, [0.3, 0.6, 0.2]).map((x) => Math.round(x * 100) / 100)).toEqual([0.3, 0.6, 0.2]);
  });

  it("LUT quente com contraste e troca de canal: fica próxima (erro abaixo de 3%)", () => {
    const s = (v: number) => Math.min(1, Math.max(0, (v - 0.5) * 1.3 + 0.5));
    const l = aproximarLut(lerCube(cube3d(17, (r, g, b) => [s(r * 1.08), s(g * 0.98 + r * 0.03), s(b * 0.88)])), "quente");
    expect(l.erro).toBeLessThan(0.03);
    expect(l.r.length).toBe(17);
    expect(l.matriz.length).toBe(12);
  });

  it("LUT 1D vira curvas diretas; arquivo quebrado explica o motivo", () => {
    const um = lerCube(["LUT_1D_SIZE 3", "0 0 0", "0.6 0.5 0.4", "1 1 1"].join("\n"));
    const l = aproximarLut(um, "1d");
    expect(l.r).toEqual([0, 0.6, 1]);
    expect(l.erro).toBe(0);
    expect(() => lerCube("oi")).toThrow(ErroDaLut);
    expect(() => lerCube(["LUT_3D_SIZE 2", "0 0 0"].join("\n"))).toThrow(/2 pontos/);
  });
});

// ---------------------------------------------------------------- reenquadramento

describe("reenquadrar seguindo o rosto", () => {
  it("vídeo 16:9 num quadro 9:16: o rosto à direita vai para o meio", () => {
    const r = recortePara(1920, 1080, 1080, 1920, 0.7, 0.4);
    expect(r.focoX).toBeCloseTo(0.5, 2);
    expect(r.x).toBeGreaterThan(50);
    // Rosto colado na borda: o recorte para na borda (não sai da imagem).
    const borda = recortePara(1920, 1080, 1080, 1920, 0.98, 0.4);
    expect(borda.x).toBe(100);
    expect(borda.focoX).toBeGreaterThan(0.5);
    // Sem medida da fonte: o foco vira a posição.
    expect(recortePara(null, null, 1080, 1920, 0.3, 0.5).x).toBeCloseTo(30);
  });

  it("leituras com pulo de erro saem; a suavização não treme e interpola", () => {
    const leituras = [
      { t: 0, x: 0.5, y: 0.4, w: 0.2 },
      { t: 0.3, x: 0.95, y: 0.4, w: 0.2 },
      { t: 0.6, x: 0.52, y: 0.4, w: 0.2 },
      { t: 1.5, x: null, y: null, w: null },
      { t: 3, x: 0.7, y: 0.4, w: 0.2 },
    ];
    const pontos = limparLeituras(leituras);
    expect(pontos.map((p) => p.t)).toEqual([0, 0.6, 3]);
    const rastro = { pontos, origem: "teste", em: AGORA };
    const meio = rostoNoTempo(rastro, 1.8, 0);
    expect(meio && meio.x).toBeGreaterThan(0.5);
    expect(meio && meio.x).toBeLessThan(0.7);
    // Bem suave: o ponto de 0,6 s é puxado pelos vizinhos (não pula para a leitura crua).
    const suave = rostoNoTempo(rastro, 0.6, 1);
    expect(suave && suave.x).toBeGreaterThan(0.5);
    expect(suave && suave.x).toBeLessThan(0.52);
  });

  it("a composição acha o recorte do clipe pelo rastro (e o foco manual vence)", async () => {
    const { recorteDoClipe, rostoNaSaida } = await import("@/components/mesa-edicao/editor/Composicao");
    let p = comFormato(projetoFalado(), "9:16");
    p = aplicarOperacao(p, { op: "rosto", fonte: "fala", rastro: { pontos: [{ t: 0, x: 0.75, y: 0.35, w: 0.15 }, { t: 20, x: 0.75, y: 0.35, w: 0.15 }], origem: "teste", em: AGORA } });
    const c = trilhaPrincipal(p)!.clipes[0];
    const r = recorteDoClipe(p, c, 5);
    expect(r.posicao).toBeTruthy();
    expect(r.focoX).toBeCloseTo(0.5, 2);
    expect(rostoNaSaida(p, 5)).not.toBeNull();
    // Foco manual vence o rastro: o recorte passa a mostrar a esquerda da imagem.
    const manual = { ...c, estilo: { foco_x: 0.2, foco_y: 0.5 } };
    expect(recorteDoClipe(p, manual, 5).posicao).not.toBe(r.posicao);
    expect(parseFloat(String(recorteDoClipe(p, manual, 5).posicao))).toBeLessThan(parseFloat(String(r.posicao)));
  });
});

// ---------------------------------------------------------------- camada de ajuste

describe("camada de ajuste (zoom, tremor, flash, cor do trecho)", () => {
  it("punch-in entra rápido e segura; empurrão anda; flash some; cor troca no trecho", () => {
    let p = projetoFalado();
    p = aplicarOperacao(p, { op: "trilha_nova", tipo: "ajuste" });
    const t = p.trilhas.find((x) => x.tipo === "ajuste")!;
    p = aplicarOperacao(p, { op: "inserir", trilha: t.id, clipe: clipeDeZoom(1, 2, 1.2, "punch", "teste") });
    p = aplicarOperacao(p, { op: "inserir", trilha: t.id, clipe: clipeDeZoom(4, 2, 1.2, "empurrao", "teste") });
    p = aplicarOperacao(p, { op: "inserir", trilha: t.id, clipe: { inicio_s: 7, entrada_s: 0, saida_s: 1, estilo: { efeito: "flash", params: { forca: 1 } } } });
    p = aplicarOperacao(p, { op: "inserir", trilha: t.id, clipe: { inicio_s: 9, entrada_s: 0, saida_s: 2, estilo: { efeito: "cor", params: { look: "pb" } } } });
    const base = corPadrao();
    expect(cameraNoTempo(p, 0.5, base).escala).toBe(1);
    expect(cameraNoTempo(p, 1.5, base).escala).toBeCloseTo(1.2, 3);
    expect(cameraNoTempo(p, 4.5, base).escala).toBeLessThan(cameraNoTempo(p, 5.5, base).escala);
    expect(cameraNoTempo(p, 7.01, base).flash!.opacidade).toBeGreaterThan(cameraNoTempo(p, 7.3, base).flash ? cameraNoTempo(p, 7.3, base).flash!.opacidade : 0);
    expect(cameraNoTempo(p, 9.5, base).cor!.cor.look).toBe("pb");
    // Trilha escondida não conta.
    const oculta = aplicarOperacao(p, { op: "trilha", trilha: t.id, campos: { oculta: true } });
    expect(cameraNoTempo(oculta, 1.5, base).escala).toBe(1);
    expect(rotuloDoClipe(p, p.trilhas.find((x) => x.tipo === "ajuste")!.clipes[0])).toBe("Zoom 1,20x");
  });
});

// ---------------------------------------------------------------- formato do projeto

describe("formato do projeto (rodada 2)", () => {
  it("campos novos têm padrão, sobrevivem ao normalizar e projeto antigo abre igual", () => {
    const p = projetoFalado();
    expect(TIPOS_DE_TRILHA).toContain("ajuste");
    expect(p.cor).toEqual(corPadrao());
    expect(p.enquadramento.seguir_rosto).toBe(true);
    let q = aplicarOperacoes(p, [
      { op: "cor", campos: { look: "vivo", lut: { nome: "L", r: [0, 1], g: [0, 1], b: [0, 1], matriz: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], erro: 0.01 } } },
      { op: "rosto", fonte: "fala", rastro: { pontos: [{ t: 1, x: 0.6, y: 0.4, w: 0.2 }], origem: "t", em: AGORA } },
      { op: "identidade", identidade: { nome: "Café", cor: "#ff6600", cor2: null, fonte: "Anton" } },
      { op: "marcadores", tipo: "capitulo", lista: [{ tempo_s: 0, rotulo: "Abertura" }, { tempo_s: 8, rotulo: "O segredo" }] },
      { op: "marcadores", tipo: "viral", lista: [{ tempo_s: 2, fim_s: 19, nota: 0.8, rotulo: "Viral 1" }] },
      { op: "formato", formato: "1:1" },
    ]);
    q = normalizarProjeto(JSON.parse(JSON.stringify(q)))!;
    expect(q.cor.look).toBe("vivo");
    expect(q.cor.lut && q.cor.lut.nome).toBe("L");
    expect(q.rostos.fala.pontos.length).toBe(1);
    expect(q.identidade).toEqual({ nome: "Café", cor: "#ff6600", cor2: null, fonte: "Anton" });
    expect(q.marcadores.filter((m) => m.tipo === "capitulo").length).toBe(2);
    expect(q.marcadores.find((m) => m.tipo === "viral")!.fim_s).toBe(19);
    expect([q.formato, q.largura, q.altura]).toEqual(["1:1", 1080, 1080]);
    // Trocar capítulos troca só os capítulos.
    const r = aplicarOperacao(q, { op: "marcadores", tipo: "capitulo", lista: [{ tempo_s: 3, rotulo: "Novo" }] });
    expect(r.marcadores.map((m) => m.tipo).sort()).toEqual(["capitulo", "viral"]);
    // Formato 1 (sem os campos novos) abre com os padrões.
    const antigo = migrarProjeto({ titulo: "x", formato: "9:16", fps: 25, trilhas: [], fontes: {} });
    expect(antigo.projeto!.cor).toEqual(corPadrao());
    expect(antigo.projeto!.rostos).toEqual({});
    expect(antigo.projeto!.identidade).toBeNull();
  });

  it("valores fora do lugar são limpos (LUT quebrada some, cor inválida some)", () => {
    const q = normalizarProjeto({ ...projetoFalado(), cor: { look: "Nada Disso!", exposicao: 9, lut: { r: [0], g: [0, 1], b: [0, 1], matriz: [1] } }, identidade: { cor: "vermelho" } })!;
    expect(q.cor.look).toBe("natural");
    expect(q.cor.exposicao).toBe(1);
    expect(q.cor.lut).toBeNull();
    expect(q.identidade).toBeNull();
  });
});

// ---------------------------------------------------------------- peças

describe("peças da edição", () => {
  it("frases da fala e zoom só nas fortes, com espaço entre eles", () => {
    const p = projetoFalado();
    const frases = frasesDoProjeto(p);
    expect(frases.length).toBe(7);
    const notas = notasPorRegra(frases);
    expect(notas.find((n) => n.k === "f3")!.nota).toBeGreaterThan(notas.find((n) => n.k === "f5")!.nota);
    const m = new Montador(p);
    const n = zoomNosMomentosEm(m, frases, notas, "forte");
    expect(n).toBeGreaterThan(0);
    const ajuste = m.projeto.trilhas.find((t) => t.tipo === "ajuste")!;
    expect(ajuste.nome).toBe("Câmera e cor");
    const inicios = ajuste.clipes.map((c) => c.inicio_s).sort((a, b) => a - b);
    for (let k = 1; k < inicios.length; k++) expect(inicios[k] - inicios[k - 1]).toBeGreaterThan(3.5);
    expect((ajuste.clipes[0].estilo as { params: { escala: number } }).params.escala).toBe(1.25);
  });

  it("gancho, nome e chamada entram na trilha Textos com os estilos", () => {
    const m = new Montador(projetoFalado());
    expect(textosEm(m, { gancho: "Você perde cliente todo dia", nome: "Ana | barista", chamada: "Comenta CAFÉ" })).toEqual(["gancho", "nome", "chamada"]);
    // O nome cruza o gancho no tempo: vai para uma segunda trilha de textos (nada se sobrepõe na mesma).
    const trilhas = m.projeto.trilhas.filter((x) => x.nome.indexOf("Textos") === 0);
    expect(trilhas.length).toBe(2);
    expect(trilhas.reduce((l, t) => l.concat(t.clipes.map((c) => (c.estilo as { preset: string }).preset)), [] as string[]).sort()).toEqual(["chamada", "manchete", "nome"]);
  });

  it("B-roll do acervo: trilha B-roll sem som, pedaço do meio, até 4 s", () => {
    const m = new Montador(projetoFalado());
    const n = brollDoAcervoEm(m, [{ inicio_s: 2, fim_s: 9, item: { id: "x", arquivo_id: "x", nome: "xicara.mp4", tipo: "bruto", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/brutos/x.mp4`, duracao_s: 10, largura: 1080, altura: 1920 } }]);
    expect(n).toBe(1);
    const t = m.projeto.trilhas.find((x) => x.nome === "B-roll")!;
    expect(t.tipo).toBe("video");
    expect(t.muda).toBe(true);
    const c = t.clipes[0];
    expect(c.saida_s - c.entrada_s).toBe(4);
    expect(c.entrada_s).toBe(3);
  });

  it("capítulos para o YouTube começam em 0:00; corte de um trecho vem para o zero", () => {
    let p = aplicarOperacao(projetoFalado(), { op: "marcadores", tipo: "capitulo", lista: [{ tempo_s: 0.3, rotulo: "Abertura" }, { tempo_s: 75, rotulo: "Fim" }] });
    expect(capitulosParaYoutube(p)).toBe("0:00 Abertura\n1:15 Fim");
    p = proporSkill("legendas", p, { agora: AGORA }, {}).resultado;
    const corte = projetoDoTrecho(p, 5, 12, "Corte");
    expect(corte.duracao_s).toBeLessThanOrEqual(7);
    expect(Math.min(...corte.trilhas.reduce((l, t) => l.concat(t.clipes.map((c) => c.inicio_s)), [] as number[]))).toBeGreaterThanOrEqual(0);
    expect(corte.marcadores).toEqual([]);
    expect(linhasDaLegenda(corte).length).toBeGreaterThan(0);
  });

  it("skills novas: reenquadrar, cor e zoom; as palavras apontam para elas", () => {
    const p = projetoFalado();
    const r = proporSkill("reenquadrar", p, { agora: AGORA }, { formato: "16:9", seguir_rosto: true });
    expect(r.resultado.formato).toBe("16:9");
    expect(r.avisos.join(" ")).toMatch(/rastreado/);
    expect(proporSkill("cor", p, { agora: AGORA }, { look: "quente" }).resultado.cor.look).toBe("quente");
    expect(proporSkill("zoom_nos_momentos", p, { agora: AGORA }, {}).operacoes.length).toBeGreaterThan(0);
    expect(skillPorPalavras("reenquadra para 9:16")).toBe("reenquadrar");
    expect(skillPorPalavras("aplica um look de cinema")).toBe("cor");
    expect(skillPorPalavras("zoom nos momentos fortes")).toBe("zoom_nos_momentos");
  });
});

// ---------------------------------------------------------------- plano do "Editar com IA"

describe("plano do Editar com IA", () => {
  it("catálogos da tela e do plano batem", () => {
    expect(PRESETS_DE_LEGENDA.map((x) => x.valor).sort()).toEqual(LEGENDAS_DO_PLANO.slice().sort());
    expect(PRESETS_DE_TEXTO.length).toBeGreaterThanOrEqual(9);
    expect(RECEITAS.length).toBeGreaterThanOrEqual(6);
  });

  it("limpa o plano: opção fora da lista, música que não existe e número que não foi dito", () => {
    const { plano, avisos } = normalizarPlano(
      {
        receita: "anuncio",
        formato: "21:9",
        legenda: { ligado: true, estilo: "neon", palavras: 20, posicao: "lado" },
        textos: { gancho: "Vendi 500 cafés", chamada: "Comenta CAFÉ", nome: "" },
        musica: { ligado: true, fonte: "trilha-epica" },
        cor: { look: "cinema", intensidade: 3 },
      },
      { fontesDeAudio: ["musica-calma"], fala: "Eu vendi 300 cafés em uma semana." },
    );
    expect(plano.receita).toBe("anuncio");
    expect(plano.formato).toBe("manter");
    expect(plano.legenda.estilo).toBe("impacto");
    expect(plano.legenda.palavras).toBe(8);
    expect(plano.textos.gancho).toBe("");
    expect(plano.textos.chamada).toBe("Comenta CAFÉ");
    expect(plano.musica.fonte).toBe("");
    expect(plano.cor.intensidade).toBe(1);
    expect(avisos.join(" ")).toMatch(/número que não foi dito/);
    expect(avisos.join(" ")).toMatch(/não está na Mídia/);
    expect(semNumeroInventado("Vendi 300 cafés", "vendi 300 cafés").tirou).toBe(false);
  });

  it("plano da casa por receita e as linhas que o dono lê", () => {
    const aula = planoPadrao("aula");
    expect(aula.capitulos).toBe(true);
    expect(aula.legenda.estilo).toBe("discreta");
    expect(linhasDoPlano(aula).join(" ")).toMatch(/Capítulos/);
    expect(planoPadrao("nao-existe").receita).toBe("dinamico");
  });

  it("custo antes: a tela e a função usam a mesma conta", () => {
    const resumo = resumoParaOPlano(projetoFalado(), "Café", 3);
    expect(resumo.fala).toMatch(/300 cafés/);
    const m = { id: "m", preco_entrada_1m: 2, preco_saida_1m: 8 };
    const c = custoDoPlano(m, "Deixa dinâmico", resumo, false);
    expect(c).toBeGreaterThan(0);
    expect(estimativaDoPlanoUsd(2, 8, 100000, true)).toBeGreaterThan(estimativaDoPlanoUsd(2, 8, 100000, false));
    const p = projetoFalado();
    expect(temposDoRosto(20, 25).length).toBe(13);
    expect(custoDoRosto(m, p, ["fala"])).toBeGreaterThanOrEqual(estimativaDoRostoUsd(2, 8, 12, 100));
  });
});

// ---------------------------------------------------------------- julgamentos (Jev)

describe("julgamentos da edição (montagem das perguntas e composição)", () => {
  const frases = frasesDaFala(
    Array.from({ length: 40 }).map((_, k) => ({ t: k % 8 === 7 ? "fim." : `p${k}`, i: k * 1.5, f: k * 1.5 + 1, clipe: "v1", fonte: "fala" })) as never,
  );

  it("força: um Score de 5 níveis por frase; nota de 0 a 1", () => {
    const q = perguntasDeForca("Reel", frases);
    expect(Object.keys(q.questions).length).toBe(frases.length);
    const q0 = q.questions.forca_0 as { type: string; criteria: string[] };
    expect(q0.type).toBe("score");
    expect(q0.criteria).toEqual(NIVEIS_DA_FORCA);
    expect(notaDe0a1({ score: 4 }, 5)).toBe(1);
    expect(notaDe0a1({ score: 2 }, 5)).toBe(0.5);
    expect(notasDeForca(frases.slice(0, 2), { forca_0: { score: 3 } })).toEqual([{ k: frases[0].k, nota: 0.75 }]);
  });

  it("virais: janelas de 15 a 60 s, nota composta, sem sobrepor", () => {
    const janelas = janelasCandidatas(frases);
    expect(janelas.length).toBeGreaterThan(0);
    janelas.forEach((j) => expect(j.fim_s - j.inicio_s).toBeGreaterThanOrEqual(15));
    janelas.forEach((j) => expect(j.fim_s - j.inicio_s).toBeLessThanOrEqual(60));
    const q = perguntasDeViral("Reel", janelas);
    expect(q.questions.sozinho_0.type).toBe("noul");
    const respostas: Record<string, { score?: number; noul?: number }> = {};
    janelas.forEach((_, i) => {
      respostas[`viral_${i}`] = { score: i === 0 ? 4 : 1 };
      respostas[`sozinho_${i}`] = { noul: 0.9 };
    });
    const v = escolherVirais(janelas, respostas);
    expect(v.length).toBe(1);
    expect(v[0].nota).toBeCloseTo(0.97, 2);
  });

  it("capítulos: fronteira com Noul alto e espaço mínimo; título escolhido entre trechos ditos", () => {
    expect(perguntasDeFronteira(frases).questions.novo_0).toBeUndefined();
    const respostas: Record<string, { noul: number }> = {};
    frases.forEach((_, i) => (respostas[`novo_${i}`] = { noul: i % 2 ? 0.9 : 0.1 }));
    const comecos = comecosDeCapitulo(frases, respostas, 20);
    expect(comecos[0]).toBe(0);
    for (let k = 1; k < comecos.length; k++) expect(frases[comecos[k]].inicio_s - frases[comecos[k - 1]].inicio_s).toBeGreaterThanOrEqual(20);
    const cand = candidatosDeTitulo([{ k: "f1", inicio_s: 0, fim_s: 3, texto: "O segredo do café, é simples. Ok." }]);
    expect(cand).toEqual(["O segredo do café", "é simples"]);
    expect(titulosEscolhidos([{ candidatos: cand }, { candidatos: [] }], { titulo_0: { choice: "t1" } })).toEqual(["O segredo do café", "Parte 2"]);
  });

  it("B-roll: Choice por frase com 'nenhum'; um vídeo por vez e 6 s entre eles", () => {
    const itens = [{ id: "a", descricao: "xícara" }, { id: "b", descricao: "loja" }];
    const q = perguntasDeBroll(frases.slice(0, 3), itens);
    expect(Object.keys((q.questions.broll_0 as { criteria: Record<string, string> }).criteria)).toEqual(["i1", "i2", "nenhum"]);
    const r = escolherBroll(frases.slice(0, 4), itens, { broll_0: { choice: "i1", probabilities: { i1: 0.8 } }, broll_1: { choice: "i1", probabilities: { i1: 0.9 } }, broll_2: { choice: "i2", probabilities: { i2: 0.3 } }, broll_3: { choice: "nenhum" } }, 4);
    expect(r.length).toBe(1);
    expect(r[0].k).toBe(frases[1].k);
  });

  it("rosto: leitura só nos quadros enviados; sem rosto vira nulo", () => {
    const l = leiturasDoRosto({ quadros: [{ n: 1, tem_rosto: true, x: 0.6, y: 0.4, largura: 0.2 }, { n: 2, tem_rosto: false, x: 0, y: 0, largura: 0 }, { n: 9, tem_rosto: true, x: 0.1, y: 0.1, largura: 0.1 }] }, [0.5, 2]);
    expect(l).toEqual([{ t: 0.5, x: 0.6, y: 0.4, w: 0.2 }, { t: 2, x: null, y: null, w: null }]);
  });
});

// ---------------------------------------------------------------- pipeline inteiro

describe("Editar com IA de ponta a ponta (sem rede)", () => {
  it("o plano da casa monta a edição inteira numa proposta só, que aplica limpa", () => {
    const p = projetoFalado();
    const plano = { ...planoPadrao("dinamico"), formato: "9:16" as const, textos: { gancho: "Você perde cliente todo dia", chamada: "Comenta CAFÉ", nome: "" }, capitulos: true, virais: true };
    const cortado = projetoDepoisDoCorte(p, plano, AGORA);
    const frases = frasesDoProjeto(cortado);
    const r = montarEdicaoCompleta(p, plano, {
      agora: AGORA,
      marca: { nome: "Café Sintético", cor: "#ff6600", cor2: "#111111", logo_path: `${CLIENTE}/marca/logo.png` },
      notas: frases.map((f, i) => ({ k: f.k, nota: i === 2 ? 0.95 : 0.2 })),
      capitulos: [{ inicio_s: 0, titulo: "Abertura" }],
      virais: [{ inicio_s: 0.3, fim_s: 18, nota: 0.8, texto: "Você está perdendo cliente" }],
      animacoes: [{ inicio_s: frases[2].inicio_s, peca: "contador", params: { ate: 300, sufixo: " cafés" } }],
    });
    const feitos = r.passos.filter((x) => x.feito).map((x) => x.id);
    // 02/10: gancho, nome e chamada saem do diretor de motion (peças na marca), não de texto solto.
    expect(feitos).toEqual(expect.arrayContaining(["marca", "pausas", "zoom", "legenda", "diretor", "motion", "cor", "sons", "capitulos", "virais"]));
    expect(r.checklist.linhas.length).toBe(4);
    // Um vídeo só (sem troca de plano): a transição fica de fora e diz por quê.
    expect(r.passos.find((x) => x.id === "transicoes")!.detalhe).toMatch(/troca de plano/);
    expect(r.proposta.operacoes.length).toBeGreaterThan(10);
    // A proposta reaplicada sobre o projeto de entrada chega ao mesmo resultado.
    expect(assinaturaDoProjeto(aplicarOperacoes(p, r.proposta.operacoes))).toBe(assinaturaDoProjeto(r.proposta.resultado));
    const q = r.proposta.resultado;
    expect(q.identidade && q.identidade.cor).toBe("#ff6600");
    expect(q.trilhas.some((t) => t.tipo === "legenda" && t.clipes.length > 0)).toBe(true);
    // A câmera é por plano (com motivo), não mais o empurrão da camada de ajuste que comia a cabeça.
    expect(q.trilhas.some((t) => t.tipo === "video" && t.clipes.some((c) => !!c.zoom))).toBe(true);
    expect(q.cor.look).toBe("vivo");
    expect(q.skills_aplicadas[q.skills_aplicadas.length - 1].skill).toBe("editar_com_ia");
    expect(q.duracao_s).toBeLessThan(p.duracao_s);
  });

  it("sem fala: o que depende dela fica de fora com o motivo, o resto monta", () => {
    const p = projetoDosTakes({ titulo: "Sem fala", fps: 25, takes: [{ id: "a", nome: "a.mp4", tipo: "bruto", storage_bucket: "mesa", storage_path: `${CLIENTE}/a.mp4`, cena_ref: null, melhor: true, duracao_s: 8, largura: 1080, altura: 1920 }] });
    const r = montarEdicaoCompleta(p, planoPadrao("dinamico"), { agora: AGORA });
    const legenda = r.passos.find((x) => x.id === "legenda")!;
    expect(legenda.feito).toBe(false);
    expect(legenda.detalhe).toMatch(/fala/);
    expect(r.passos.find((x) => x.id === "cor")!.feito).toBe(true);
  });

  it("acervo para B-roll: tira o que já está na principal e o áudio", () => {
    const p = projetoFalado();
    const itens = [
      { id: "1", arquivo_id: "1", nome: "fala.mp4", tipo: "bruto", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/brutos/a.mp4`, duracao_s: 20, largura: 1, altura: 1 },
      { id: "2", arquivo_id: "2", nome: "loja_por_fora.mp4", tipo: "bruto", storage_bucket: "mesa", storage_path: `${CLIENTE}/b.mp4`, duracao_s: 6, largura: 1, altura: 1 },
      { id: "3", arquivo_id: "3", nome: "musica.mp3", tipo: "audio", storage_bucket: "mesa", storage_path: `${CLIENTE}/m.mp3`, duracao_s: 60, largura: null, altura: null },
    ];
    const a = acervoParaBroll(p, itens);
    expect(a.map((x) => x.id)).toEqual(["2"]);
    expect(a[0].descricao).toBe("loja por fora");
  });
});

// ---------------------------------------------------------------- estilos de texto

describe("estilos de legenda e texto (desenho)", () => {
  it("todos os estilos desenham sem quebrar, com a cor da marca", () => {
    const p = { ...projetoFalado(), identidade: { nome: "Café", cor: "#ff6600", cor2: null, fonte: null } };
    PRESETS_DE_LEGENDA.forEach((x) => {
      const html = renderToStaticMarkup(h(TextoNaTela, { projeto: p, legenda: true, frame: 5, rosto: null, c: { id: "l1", fonte: null, inicio_s: 0, entrada_s: 0, saida_s: 1.2, velocidade: 1, volume: 1, texto: "Olha só isso", estilo: { preset: x.valor, palavras: [{ t: "Olha", i: 0, f: 0.3 }, { t: "só", i: 0.3, f: 0.5 }, { t: "isso", i: 0.5, f: 0.9 }] }, transicao_entrada: null, transicao_saida: null, zoom: null, cena_ref: null, nota: null, comparar: null, origem: null } }));
      expect(html).toMatch(/Olha|OLHA/i);
    });
    PRESETS_DE_TEXTO.forEach((x) => {
      const html = renderToStaticMarkup(h(TextoNaTela, { projeto: p, legenda: false, frame: 10, rosto: { y: 0.7, meia: 0.1 }, c: { id: "t1", fonte: null, inicio_s: 0, entrada_s: 0, saida_s: 3, velocidade: 1, volume: 1, texto: "Ana | barista", estilo: { preset: x.valor }, transicao_entrada: null, transicao_saida: null, zoom: null, cena_ref: null, nota: null, comparar: null, origem: null } }));
      expect(html).toMatch(/Ana/i);
    });
    expect(corSobre("#ffffff")).toBe("#111111");
    expect(corSobre("#111111")).toBe("#ffffff");
    // Zona do rosto: legenda sobe se o rosto está embaixo; texto do alto desce para baixo do queixo se cobriria os olhos.
    expect(alturaDaPosicao("auto", true, { y: 0.8, meia: 0.1 })).toBeLessThan(0.2);
    expect(alturaDaPosicao("auto", true, { y: 0.3, meia: 0.1 })).toBe(0.72);
    expect(alturaDaPosicao("auto", false, null)).toBe(0.08);
    expect(alturaDaPosicao("auto", false, { y: 0.6, meia: 0.1 })).toBe(0.08);
    expect(alturaDaPosicao("auto", false, { y: 0.3, meia: 0.13 }, 0.2)).toBeCloseTo(0.46, 2);
    // O mesmo gancho ocupa mais do alto no 1:1 que no 9:16.
    expect(alturaDoBloco(24, 70, 1080, 1080)).toBeGreaterThan(alturaDoBloco(24, 70, 1080, 1920));
    expect(rotuloDoAjuste({ id: "e1", fonte: null, inicio_s: 0, entrada_s: 0, saida_s: 1, velocidade: 1, volume: 1, texto: null, estilo: { efeito: "cor", params: { look: "pb" } }, transicao_entrada: null, transicao_saida: null, zoom: null, cena_ref: null, nota: null, comparar: null, origem: null })).toBe("Cor: pb");
  });
});

// ---------------------------------------------------------------- agente editor

describe("ferramentas novas do agente editor (rodam na tela, numa cópia)", () => {
  it("formato, cor, efeito e texto com estilo mudam o projeto; valor errado volta como erro para o modelo", () => {
    const p = projetoFalado();
    const f = executarFerramenta(p, { ferramenta: "formato", argumentos: { formato: "1:1" } }, AGORA);
    expect(f.ok).toBe(true);
    expect(f.projeto.formato).toBe("1:1");
    expect(f.texto).toMatch(/centro/);
    const c = executarFerramenta(p, { ferramenta: "cor", argumentos: { look: "cinema", saturacao: -3 } }, AGORA);
    expect(c.projeto.cor.look).toBe("cinema");
    expect(c.projeto.cor.saturacao).toBe(-1);
    expect(executarFerramenta(p, { ferramenta: "cor", argumentos: { look: "neon" } }, AGORA).ok).toBe(false);
    const e = executarFerramenta(p, { ferramenta: "efeito", argumentos: { efeito: "zoom", inicio_s: 2, duracao_s: 1.5, escala: 1.3, modo: "empurrao" } }, AGORA);
    const aj = e.projeto.trilhas.find((t) => t.tipo === "ajuste")!;
    expect((aj.clipes[0].estilo as { params: { modo: string; escala: number } }).params).toMatchObject({ modo: "empurrao", escala: 1.3 });
    const t = executarFerramenta(p, { ferramenta: "inserir_texto", argumentos: { inicio_s: 0, duracao_s: 2, texto: "Olha isso", estilo: "manchete" } }, AGORA);
    expect(t.projeto.trilhas.find((x) => x.tipo === "texto")!.clipes[0].estilo).toEqual({ preset: "manchete" });
  });
});
