import { describe, expect, it } from "vitest";
import { duracaoDoClipe } from "../../supabase/functions/_shared/projeto-de-edicao";
import { aplicarOperacao, emOrdem, fimDoClipe, trilhaPrincipal } from "@/lib/editor/operacoes";
import { Montador } from "@/lib/editor/skills/tipos";
import { corteLimpoEm, planoDoCorteLimpo } from "@/lib/editor/skills/corteLimpo";
import { proporSkill } from "@/lib/editor/skills";
import { silenciosDoClipe } from "@/lib/editor/transcricao";
import { escalaMaximaSegura, ORIGEM_SEGURA_DO_ZOOM, QUADROS_QUE_SEGURA, quadrosDosClipes, vaosDaTrilha, volumeComFade } from "@/lib/editor/sequencias";
import { comJulgamento, ferramentaBarrada, lerPedidoDoDono, receitaPeloPedido } from "../../supabase/functions/editor-video/modulos/pedido-do-dono";
import { sistemaDoPlano } from "../../supabase/functions/editor-video/modulos/plano-da-edicao";
import { edicaoCompletaDoAgente } from "@/lib/editor/ferramentasDoServidor";
import { planoDoDiretor } from "@/lib/editor/motion/diretor";
import { trechosChave } from "@/lib/editor/skills/palavrasChave";
import { checklistDeEngajamento } from "@/lib/editor/engajamento";
import { CANDIDATOS_DO_AGENTE_EDITOR, modeloPadraoDoEditor } from "@/lib/mesa/modelo-por-papel";
import { montarPacote, type TakeDoPacote } from "../../supabase/functions/mesa-videos/modulos/pacote-de-edicao";
import { entradaDoPacote } from "@/components/mesa-edicao/pacote";
import type { ArquivoDeVideo } from "@/components/mesa-videos/videosApi";
import { fpsDoMp4 } from "@/lib/editor/fpsDoArquivo";
import { AGORA_SINTETICO, falaSintetica, projetoTalkingHead } from "./fixtures/talkingHeadSintetico";

/**
 * Auditoria da Mesa Edição (02/10): o motor de edição com um talking head
 * sintético que reproduz o caso real (picote de micro cortes, clipe de 0,32 s,
 * quadro preto entre clipes fora da grade).
 */

const fps = 25;
const naGrade = (s: number) => Math.abs(s * fps - Math.round(s * fps)) < 1e-6;

describe("corte limpo (antes: picote de micro cortes)", () => {
  it("o corte antigo (pausa de 0,3 s, sem clipe mínimo) picotava; o novo corta menos, sem clipe curto", () => {
    const p = projetoTalkingHead();
    const c = trilhaPrincipal(p)!.clipes[0];
    const antigos = silenciosDoClipe(c, falaSintetica(), { limiar_s: 0.3, respiro_depois_s: 0.1, respiro_antes_s: 0.08 });
    const plano = planoDoCorteLimpo(new Montador(p));
    expect(antigos.length).toBeGreaterThan(plano.cortes.length);
    expect(plano.cortes.length).toBeGreaterThan(3);
    // Teto: no máximo 14 cortes por minuto.
    expect(plano.cortes.length).toBeLessThanOrEqual(Math.floor((14 * p.duracao_s) / 60));
    // Todo corte é na grade de quadros e tira pelo menos 0,15 s.
    plano.cortes.forEach((x) => {
      expect(naGrade(x.de_s) && naGrade(x.ate_s)).toBe(true);
      expect(x.ate_s - x.de_s).toBeGreaterThanOrEqual(0.15 - 1e-9);
    });
  });

  it("nunca corta dentro de palavra e deixa respiro em volta", () => {
    const p = projetoTalkingHead();
    const plano = planoDoCorteLimpo(new Montador(p));
    falaSintetica().forEach((w) => {
      plano.cortes.forEach((x) => {
        // Nenhuma palavra encosta num corte (com pelo menos 30 ms de respiro).
        const invade = x.de_s < w.f + 0.03 - 1e-6 && x.ate_s > w.i - 0.03 + 1e-6;
        expect(invade, `"${w.t}" (${w.i} a ${w.f}) cortada por ${x.de_s} a ${x.ate_s}`).toBe(false);
      });
    });
  });

  it("uma operação só, clipes de pelo menos 0,8 s, encostados em quadros inteiros (sem buraco)", () => {
    const m = new Montador(projetoTalkingHead());
    const r = corteLimpoEm(m);
    expect(m.operacoes).toHaveLength(1);
    expect(m.operacoes[0].op).toBe("recortar_varios");
    const clipes = emOrdem(trilhaPrincipal(m.projeto)!);
    expect(clipes.length).toBe(r.cortes.length + 1 - r.cortes.filter((x) => x.de_s <= 1e-6).length);
    clipes.forEach((c, k) => {
      expect(duracaoDoClipe(c), `clipe ${c.id}`).toBeGreaterThanOrEqual(0.8 - 1e-6);
      expect(naGrade(c.inicio_s) && naGrade(fimDoClipe(c))).toBe(true);
      if (k > 0) expect(c.inicio_s).toBe(fimDoClipe(clipes[k - 1]));
    });
    // Nenhuma palavra saiu.
    const ditas = clipes.reduce((n, c) => n + falaSintetica().filter((w) => (w.i + w.f) / 2 >= c.entrada_s && (w.i + w.f) / 2 < c.saida_s).length, 0);
    expect(ditas).toBe(falaSintetica().length);
  });

  it("a palavra isolada entre pausas longas (o clipe de 0,32 s) ganha respiro e fica com 0,8 s", () => {
    const m = new Montador(projetoTalkingHead());
    corteLimpoEm(m);
    const w = falaSintetica().find((x) => x.t === "aluguel")!;
    const c = trilhaPrincipal(m.projeto)!.clipes.find((x) => x.entrada_s <= w.i && x.saida_s >= w.f)!;
    expect(duracaoDoClipe(c)).toBeGreaterThanOrEqual(0.8 - 1e-6);
  });

  it("mantém o começo: nada sai antes do tempo protegido", () => {
    const plano = planoDoCorteLimpo(new Montador(projetoTalkingHead()), { proteger_ate_s: 12 });
    plano.cortes.forEach((x) => expect(x.de_s).toBeGreaterThanOrEqual(12 - 1e-6));
  });

  it("a skill Cortar silêncios usa o corte limpo (determinística)", () => {
    const p = projetoTalkingHead();
    const a = proporSkill("cortar_silencios", p, { agora: AGORA_SINTETICO });
    const b = proporSkill("cortar_silencios", p, { agora: AGORA_SINTETICO });
    expect(a.operacoes.filter((o) => o.op === "recortar_varios")).toHaveLength(1);
    expect(JSON.stringify(a.operacoes)).toBe(JSON.stringify(b.operacoes));
  });
});

describe("fechar buracos em quadros inteiros", () => {
  it("clipe com duração fora da grade (2,98 s) não deixa meio quadro preto depois de encostar", () => {
    let p = projetoTalkingHead();
    const v = trilhaPrincipal(p)!;
    p = aplicarOperacao(p, { op: "dividir", clipe: v.clipes[0].id, em_s: 4.12 });
    const segundo = emOrdem(trilhaPrincipal(p)!)[1];
    // Simula o corte antigo: a saída fora da grade (4,12 + 2,98 = 7,10 na linha) e o próximo em 7,12.
    p = aplicarOperacao(p, { op: "recortar", clipe: segundo.id, de_s: 7.1, ate_s: 7.3 });
    p = aplicarOperacao(p, { op: "ondular", trilha: v.id });
    const l = emOrdem(trilhaPrincipal(p)!);
    for (let k = 1; k < l.length; k++) {
      expect(l[k].inicio_s).toBe(fimDoClipe(l[k - 1]));
      expect(naGrade(l[k].inicio_s)).toBe(true);
    }
  });
});

describe("composição sem quadro preto", () => {
  const clipe = (id: string, inicio_s: number, entrada_s: number, saida_s: number) => ({ id, inicio_s, entrada_s, saida_s, fonte: "f", velocidade: 1, volume: 1, texto: null, estilo: null, transicao_entrada: null, transicao_saida: null, zoom: null, cena_ref: null, nota: null, comparar: null, origem: null }) as unknown as Parameters<typeof quadrosDosClipes>[0][number];

  it("4,12 + 2,98 (ponto flutuante) não deixa o quadro 177 preto; vão de meio quadro (7,10 a 7,12) é segurado", () => {
    // Caso real da auditoria: clipe acaba em 7,10 (fora da grade) e o seguinte começa em 7,12.
    const l = [clipe("a", 4.12, 4.12, 7.1), clipe("b", 7.12, 7.3, 9.34)];
    expect(vaosDaTrilha(l, 25, 0).length).toBeLessThanOrEqual(1);
    expect(vaosDaTrilha(l, 25, QUADROS_QUE_SEGURA)).toEqual([]);
    const q = quadrosDosClipes(l, 25, QUADROS_QUE_SEGURA);
    expect(q.a.de + q.a.d).toBe(q.b.de);
  });

  it("vão de verdade (mais de 2 quadros) continua vão: a composição não inventa imagem", () => {
    const l = [clipe("a", 0, 0, 2), clipe("b", 2.2, 3, 5)];
    expect(vaosDaTrilha(l, 25, QUADROS_QUE_SEGURA)).toEqual([{ em_quadro: 50, quadros: 5 }]);
  });

  it("micro fade só no primeiro e no último quadro do corte encostado", () => {
    const v = volumeComFade(1, 50, true, true);
    expect([v(0), v(1), v(48), v(49)]).toEqual([0.5, 1, 1, 0.5]);
  });

  it("zoom sem rosto: origem acima do centro e escala que não come a cabeça", () => {
    expect(ORIGEM_SEGURA_DO_ZOOM.y).toBeLessThan(0.5);
    // Com a origem no centro, 1,15x comia 6,5% de cima; com a origem segura, menos de 5%.
    expect(0.5 * (1 - 1 / 1.15)).toBeGreaterThan(0.05);
    expect(ORIGEM_SEGURA_DO_ZOOM.y * (1 - 1 / 1.18)).toBeLessThan(0.05);
    expect(escalaMaximaSegura(ORIGEM_SEGURA_DO_ZOOM.y)).toBeGreaterThanOrEqual(1.18);
  });
});

// ------------------------------------------------------------------ o pedido do dono é lei

const semRede = async (): Promise<never> => {
  throw new Error("sem rede no teste");
};

describe("o pedido do dono é lei", () => {
  it("lê negações, só, opções da legenda, começo mantido e dúvida", () => {
    expect(lerPedidoDoDono("edita completo, dinâmico, sem legenda").sem).toEqual(["legenda"]);
    expect(lerPedidoDoDono("sem legenda nem música").sem.sort()).toEqual(["legenda", "musica"]);
    expect(lerPedidoDoDono("não quero zoom, mas coloca legenda").sem).toEqual(["zoom"]);
    expect(lerPedidoDoDono("não quero zoom, mas coloca legenda").com).toEqual(["legenda"]);
    expect(lerPedidoDoDono("só cortes").so).toEqual(["cortes"]);
    expect(lerPedidoDoDono("só corta as pausas").so).toEqual(["cortes"]);
    expect(lerPedidoDoDono("tira os silêncios e deixa dinâmico").com).toEqual(["cortes"]);
    expect(lerPedidoDoDono("sem cortes").sem).toEqual(["cortes"]);
    const l = lerPedidoDoDono("legenda grande no meio, 2 palavras");
    expect(l.legenda).toEqual({ tamanho: "grande", posicao: "meio", palavras: 2 });
    expect(lerPedidoDoDono("mantém o começo e corta o resto").manter_comeco).toBe(true);
    expect(lerPedidoDoDono("talvez uma música").ambiguos).toEqual(["musica"]);
    expect(comJulgamento(lerPedidoDoDono("talvez uma música"), { musica: 0.2 }).sem).toEqual(["musica"]);
    expect(lerPedidoDoDono("tira a legenda gravada do vídeo").sem).toEqual([]);
  });

  it("ferramenta proibida pelo pedido volta recusada ao agente", () => {
    const p = lerPedidoDoDono("edita completo, sem legenda");
    expect(ferramentaBarrada(p, "legendar", {})).toMatch(/Recusado pelo pedido do dono \(legenda: você pediu sem\)/);
    expect(ferramentaBarrada(p, "aplicar_skill", { skill: "legendas" })).toMatch(/Recusado/);
    expect(ferramentaBarrada(p, "cor", {})).toBeNull();
    expect(ferramentaBarrada(lerPedidoDoDono("só cortes"), "musica", {})).toMatch(/você pediu só cortes/);
  });

  it("profissão não escolhe edição tímida: receita calma só se o pedido pede", () => {
    expect(receitaPeloPedido("institucional", "edita o vídeo da advogada")).toBe("dinamico");
    expect(receitaPeloPedido("depoimento", "edita como depoimento, calmo")).toBe("depoimento");
    expect(receitaPeloPedido("anuncio", "qualquer")).toBe("anuncio");
    expect(sistemaDoPlano()).toMatch(/nunca pelo setor ou pela profissão/);
  });

  it("edita completo, dinâmico, sem legenda: zero legenda, e o relatório diz o que não fez", async () => {
    const r = await edicaoCompletaDoAgente(semRede, { clientId: "c", projeto: projetoTalkingHead(), args: { receita: "dinamico", pedido_do_dono: "edita completo, dinâmico, sem legenda" }, marca: null, midias: [], agora: AGORA_SINTETICO });
    const legendas = r.projeto.trilhas.filter((t) => t.tipo === "legenda").reduce((n, t) => n + t.clipes.length, 0);
    expect(legendas).toBe(0);
    expect(r.texto).toMatch(/pedido do dono: sem legenda/);
    expect(r.texto).toMatch(/não feito por pedido Legendas: Não feito: legenda \(você pediu sem\)/);
    expect(r.foraPeloPedido).toContain("legendas");
    expect(r.projeto.skills_aplicadas.map((s) => s.skill)).not.toContain("legendas");
    // O resto da edição entrou: corte, câmera e motion.
    expect(r.texto).toMatch(/feito Pausas e respiros/);
    expect(r.texto).toMatch(/feito Câmera nos momentos fortes/);
    expect(r.texto).toMatch(/feito Motion graphics na marca/);
  });

  it("só cortes: corta e mais nada (sem câmera, sem motion, sem legenda, sem cor)", async () => {
    const r = await edicaoCompletaDoAgente(semRede, { clientId: "c", projeto: projetoTalkingHead(), args: { receita: "dinamico", pedido_do_dono: "só cortes" }, marca: null, midias: [], agora: AGORA_SINTETICO });
    const v = trilhaPrincipal(r.projeto)!;
    expect(v.clipes.length).toBeGreaterThan(1);
    expect(v.clipes.every((c) => !c.zoom)).toBe(true);
    expect(r.projeto.trilhas.filter((t) => t.tipo !== "video").every((t) => t.clipes.length === 0)).toBe(true);
    expect(r.projeto.cor.look).toBe("natural");
  });
});

// ------------------------------------------------------------------ câmera, motion e engajamento

describe("câmera com motivo, motion na marca e checklist de engajamento", () => {
  const editado = (pedido = "edita completo e dinâmico") =>
    edicaoCompletaDoAgente(semRede, {
      clientId: "c",
      projeto: projetoTalkingHead(),
      args: { receita: "dinamico", pedido_do_dono: pedido },
      marca: { nome: "Marca Teste", cor: "#F1A7B4", cor2: "#FFE3E3", fonte: null, fonte_path: null, logo_path: null },
      midias: [],
      agora: AGORA_SINTETICO,
    });

  it("câmera variada: gancho empurra, nunca dois planos iguais seguidos, escala que não come a cabeça", async () => {
    const r = await editado();
    const v = emOrdem(trilhaPrincipal(r.projeto)!);
    expect(v[0].zoom).toEqual({ de: 1, para: 1.08 });
    for (let k = 1; k < v.length; k++) expect(JSON.stringify(v[k].zoom), `plano ${k}`).not.toBe(JSON.stringify(v[k - 1].zoom));
    const tipos = new Set(v.map((c) => JSON.stringify(c.zoom)));
    expect(tipos.size).toBeGreaterThanOrEqual(4);
    v.forEach((c) => {
      if (c.zoom) expect(Math.max(c.zoom.de, c.zoom.para)).toBeLessThanOrEqual(1.2);
    });
    // Nem o empurrão 1,15 da camada de ajuste nem o zoom alternado de 2 em 2.
    expect(r.projeto.trilhas.filter((t) => t.tipo === "ajuste").reduce((n, t) => n + t.clipes.length, 0)).toBe(0);
    // Nenhum plano curto nem buraco depois do ritmo.
    v.forEach((c, k) => {
      expect(duracaoDoClipe(c)).toBeGreaterThanOrEqual(0.8 - 1e-6);
      if (k) expect(c.inicio_s).toBe(fimDoClipe(v[k - 1]));
    });
  });

  it("diretor de motion: gancho no começo, palavra-chave dita, lista da enumeração e chamada do fim", () => {
    const d = planoDoDiretor(projetoTalkingHead(), { motion: true, textos: true, densidade: "medias" });
    const gancho = d.pecas.find((x) => x.peca === "gancho")!;
    expect(gancho.inicio_s).toBeLessThanOrEqual(0.5);
    expect((gancho.params.linhas as string[]).join(" ")).toMatch(/salário|CDI|diferentes/);
    const lista = d.pecas.find((x) => x.peca === "lista")!;
    expect(lista.params.itens).toEqual(["aluguel", "mercado", "transporte", "demais despesas fixas"]);
    expect(lista.params.titulo).toBe("Separe");
    const cta = d.pecas.find((x) => x.peca === "chamada")!;
    expect(cta.params).toMatchObject({ botao: "Salvar", icone: "salvar" });
    expect(d.pecas.filter((x) => x.peca === "destaque").length).toBeGreaterThanOrEqual(1);
    expect(String(cta.params.texto)).toMatch(/^Salva esse vídeo/);
    expect(String(cta.params.texto)).not.toMatch(/ a$/);
    // Peças não se atropelam.
    const l = d.pecas.slice().sort((a, b) => a.inicio_s - b.inicio_s);
    for (let k = 1; k < l.length; k++) expect(l[k].inicio_s).toBeGreaterThanOrEqual(l[k - 1].inicio_s + l[k - 1].duracao_s - 1e-6);
    // Sem nome dito, o lower-third fica de fora com o motivo.
    expect(d.fora.join(" ")).toMatch(/nome e cargo/);
  });

  it("palavras-chave: sigla, número por extenso e termo longo, sem palavra comum", () => {
    const fala = [
      { t: "pelo", i: 0, f: 0.2, clipe: "v" },
      { t: "CDI", i: 0.25, f: 0.6, clipe: "v" },
      { t: "trinta", i: 1, f: 1.3, clipe: "v" },
      { t: "planejamento", i: 2, f: 2.5, clipe: "v" },
      { t: "financeiro", i: 2.52, f: 3, clipe: "v" },
      { t: "você", i: 3.5, f: 3.7, clipe: "v" },
    ];
    expect(trechosChave(fala).map((x) => [x.texto, x.motivo])).toEqual([
      ["CDI", "sigla"],
      ["trinta", "numero"],
      ["planejamento financeiro", "termo"],
    ]);
  });

  it("checklist: o bruto falha (sem gancho, parado, sem chamada); a edição completa passa", async () => {
    const bruto = checklistDeEngajamento(projetoTalkingHead());
    expect(bruto.ok).toBe(false);
    expect(bruto.gancho).toBe(false);
    expect(bruto.maior_parado_s).toBeGreaterThan(4);
    expect(bruto.cta).toBe(false);
    const r = await editado();
    const c = checklistDeEngajamento(r.projeto);
    expect(c.gancho).toBe(true);
    expect(c.maior_parado_s).toBeLessThanOrEqual(4);
    expect(c.por_30s).toBeGreaterThanOrEqual(4);
    expect(c.cta).toBe(true);
    expect(c.ok).toBe(true);
    expect(r.engajamento).toEqual(c.linhas);
  });
});

// ------------------------------------------------------------------ modelo do agente editor

describe("modelo padrão do agente editor", () => {
  it("forte por padrão (Sonnet 5.5, depois Sol 6.1, depois Opus 5.5), nunca o mais barato; o dono continua escolhendo", () => {
    const luna = { id: "openrouter:openai/gpt-6-luna", ativo: true };
    const sonnet = { id: "openrouter:anthropic/claude-sonnet-5.5", ativo: true };
    const sol = { id: "openrouter:openai/gpt-6.1-sol", ativo: true };
    expect(modeloPadraoDoEditor([luna, sol, sonnet])).toBe(sonnet.id);
    expect(modeloPadraoDoEditor([luna, sol, { ...sonnet, ativo: false }])).toBe(sol.id);
    expect(modeloPadraoDoEditor([luna])).toBeNull();
    expect(CANDIDATOS_DO_AGENTE_EDITOR.some((x) => /luna|flash/.test(x))).toBe(false);
  });
});

// ------------------------------------------------------------------ pacote para editar

/** MP4 mínimo: ftyp, (mdat antes ou depois) e moov > trak > mdia (mdhd, hdlr vide, minf > stbl > stts). */
function mp4Sintetico(escala: number, delta: number, moovNoFim: boolean): Uint8Array {
  const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const caixa = (t: string, corpo: number[]) => u32(8 + corpo.length).concat([t.charCodeAt(0), t.charCodeAt(1), t.charCodeAt(2), t.charCodeAt(3)], corpo);
  const ascii = (t: string) => t.split("").map((c) => c.charCodeAt(0));
  const mdhd = caixa("mdhd", [0, 0, 0, 0].concat(u32(0), u32(0), u32(escala), u32(escala * 10), [0, 0, 0, 0]));
  const hdlr = caixa("hdlr", [0, 0, 0, 0].concat(u32(0), ascii("vide"), u32(0), u32(0), u32(0), [0]));
  const stts = caixa("stts", [0, 0, 0, 0].concat(u32(1), u32(250), u32(delta)));
  const moov = caixa("moov", caixa("trak", caixa("mdia", mdhd.concat(hdlr, caixa("minf", caixa("stbl", stts))))));
  const ftyp = caixa("ftyp", ascii("isom").concat(u32(0)));
  const mdat = caixa("mdat", new Array(5000).fill(7));
  return new Uint8Array(moovNoFim ? ftyp.concat(mdat, moov) : ftyp.concat(moov, mdat));
}

describe("pacote para editar", () => {
  const ler = (b: Uint8Array) => async (ini: number, fim: number) => b.subarray(ini, Math.min(fim, b.length));

  it("FPS lido do cabeçalho do arquivo (moov no começo ou depois do mdat; 29,97 vira 30)", async () => {
    expect(await fpsDoMp4(ler(mp4Sintetico(12800, 512, false)))).toBe(25);
    expect(await fpsDoMp4(ler(mp4Sintetico(30000, 1001, true)))).toBe(30);
    expect(await fpsDoMp4(ler(new Uint8Array([0, 0, 0, 8, 102, 114, 101, 101])))).toBeNull();
  });

  const take = (id: string, tipo = "bruto"): TakeDoPacote => ({ id, nome: `${id}.mp4`, nome_original: `${id}.mp4`, tipo, storage_bucket: "mesa", storage_path: `c/${id}.mp4`, grupo: null, roteiro_id: null, cena_ref: null, melhor: true, duracao_s: 30, largura: 1080, altura: 1920, bytes: 1, sha256: null });

  it("pendências viram ação; com FPS lido, fala marcada e vídeo com som, só sobra o que precisa", () => {
    const base = { cliente: { id: "c", nome: "Cliente" }, titulo: "Vídeo", formato: "9:16", gerado_em: AGORA_SINTETICO };
    const cru = montarPacote({ ...base, takes: [take("a")], fps: null, legendas: [] });
    expect(cru.pendencias_acoes.map((p) => p.acao)).toEqual(expect.arrayContaining(["transcrever", "fps"]));
    expect(cru.pendencias.join(" ")).not.toMatch(/Sincronia de áudio não medida/);
    const pronto = montarPacote({ ...base, takes: [take("a")], fps: 25, fps_origem: "arquivo", legendas: [{ arquivo_id: "a", estado: "pronto", srt: "1\n00:00:00,000 --> 00:00:01,000\nOi\n" }], projeto: projetoTalkingHead(), projeto_editado: true, srt_da_edicao: "1\n00:00:00,000 --> 00:00:01,000\nOi\n" });
    expect(pronto.pendencias).toEqual([]);
    expect(Object.keys(pronto.arquivos)).toEqual(expect.arrayContaining(["edl.json", "projeto.json", "legendas/a.srt", "legendas/edicao.srt", "LEIA-ME.md", "pacote.json"]));
    expect(JSON.parse(pronto.arquivos["pacote.json"]).fps_origem).toBe("arquivo");
    const comAudio = montarPacote({ ...base, takes: [take("a"), take("som", "audio")], fps: 25, legendas: [{ arquivo_id: "a", estado: "pronto", srt: "x" }] });
    expect(comAudio.pendencias_acoes.find((p) => p.acao === "sincronia")).toBeTruthy();
  });

  it("o pacote sai da edição aberta: edl com os cortes, SRT de cada take pela fala marcada e a legenda da edição", () => {
    const p = proporSkill("cortar_silencios", projetoTalkingHead(), { agora: AGORA_SINTETICO }).resultado;
    const fonte = Object.keys(p.fontes)[0];
    const editado = { ...p, fontes: { ...p.fontes, [fonte]: { ...p.fontes[fonte], arquivo_id: "a" } } };
    const arq = { id: "a", client_id: "c", nome: "a.mp4", nome_original: "a.mp4", storage_bucket: "mesa", storage_path: "c/a.mp4", tipo: "bruto", mime: "video/mp4", bytes: 1, duracao_s: 42, largura: 1080, altura: 1920, sha256: null, gravado_em: null, roteiro_id: null, cena_ref: null, grupo: null, melhor: true, nota: null, estado: "novo", criado_em: AGORA_SINTETICO } as ArquivoDeVideo;
    const e = entradaDoPacote({ clienteId: "c", clienteNome: "Cliente", titulo: "Vídeo", arquivos: [arq], quais: "melhores", roteiro: null, historia: null, pedidos: [], destino: "remotion", fps: 25, fpsOrigem: "arquivo", formato: "9:16", direcao: "", agora: AGORA_SINTETICO, projetoEditado: editado });
    const pac = montarPacote(e);
    const edl = JSON.parse(pac.arquivos["edl.json"]);
    expect(edl.ranges.length).toBe(trilhaPrincipal(editado)!.clipes.length);
    expect(edl.ranges.length).toBeGreaterThan(1);
    expect(pac.arquivos["legendas/a.srt"]).toMatch(/-->/);
    expect(pac.arquivos["legendas/edicao.srt"]).toMatch(/-->/);
    expect(pac.pendencias).toEqual([]);
  });
});
