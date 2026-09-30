import { createElement as h } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clipeNovo,
  migrarProjeto,
  normalizarProjeto,
  projetoDosTakes,
  VERSAO_DO_FORMATO_DO_PROJETO,
  type ProjetoDeEdicao,
  type TakeParaProjeto,
} from "../../supabase/functions/_shared/projeto-de-edicao";
import { acharClipe, aplicarOperacao, aplicarOperacoes, assinaturaDoProjeto, ErroDaOperacao, fimDoClipe, trilhaPrincipal, type Operacao } from "@/lib/editor/operacoes";
import { comecarHistorico, desfazer, fazer, refazer } from "@/lib/editor/historico";
import { apelidosDoProjeto, ErroDeApelido, resolverApelidos, resumoParaOAgente } from "@/lib/editor/apelidos";
import { segmentosDoSrt, silenciosDoClipe, falaNaLinhaDoTempo } from "@/lib/editor/transcricao";
import { proporSkill, skillPorPalavras, SKILLS_DO_EDITOR } from "@/lib/editor/skills";
import { proporReceita } from "@/lib/editor/skills/receita";
import { criarSalvador } from "@/lib/editor/autosave";
import { anguloDaPose, confirmarGeracao, corpoDoAngulo, prepararGeracao } from "@/lib/editor/geracao";
import { tempoDoQuadro, tempoDoUltimoQuadro } from "@/lib/editor/quadros";
import { partesDoAudio, wavDe } from "@/lib/editor/audio";
import { executarFerramenta, rodarAgente } from "@/lib/editor/agente";
import { opsParaInserir, midiasDoPedido } from "@/lib/editor/biblioteca";
import { noQuadro, segundosDoTexto, tempoFino } from "@/lib/editor/tempo";
import {
  custoDoTimestamp,
  deslocarPalavras,
  juntarPartes,
  lerPasso,
  linhasDeLegenda,
  MAX_FERRAMENTAS,
  motivoParaParar,
  srtDasLinhas,
  temposDeAmostra,
  trechosConferidos,
} from "../../supabase/functions/editor-video/ferramentas";
import { detectarCortes, normalizarReceita, parametrosPelaFidelidade, planoDoLink, receitaDaMedida, ritmo, batidas } from "../../supabase/functions/editor-video/receita";
import ComparadorAntesDepois, { posicaoPelaTecla, posicaoPeloPonteiro, recorteDoDepois } from "@/components/comparar/ComparadorAntesDepois";
import { ErroDaMesa } from "@/lib/mesa/api";

/**
 * Editor de vídeo da Mesa Edição (frente V-B, 26/09). Tudo aqui é puro ou com
 * chamadas simuladas: nenhuma geração paga, nenhum banco.
 */

const AGORA = "2026-09-26T12:00:00.000Z";

const take = (id: string, nome: string, dur: number, cena: string | null = null): TakeParaProjeto => ({
  id,
  nome,
  tipo: "bruto",
  storage_bucket: "mesa",
  storage_path: `cli/video/brutos/${id}.mov`,
  cena_ref: cena,
  melhor: true,
  duracao_s: dur,
  largura: 1080,
  altura: 1920,
});

function base(): ProjetoDeEdicao {
  return projetoDosTakes({ titulo: "Reel", fps: 25, takes: [take("a", "IMG_1.MOV", 10, "c2"), take("b", "IMG_2.MOV", 6, "c1")], agora: AGORA });
}

/** Fala fictícia de img-1 (tempo da fonte): 3 frases com pausas de 1 s e 0,2 s. */
function comFala(p: ProjetoDeEdicao): ProjetoDeEdicao {
  return aplicarOperacao(p, {
    op: "transcricao",
    fonte: "img-1",
    transcricao: {
      por_palavra: true,
      origem: "teste",
      versao: 1,
      em: AGORA,
      segmentos: [
        { t: "Olá", i: 0.5, f: 0.9 },
        { t: "pessoal.", i: 0.95, f: 1.5 },
        { t: "Hoje", i: 2.5, f: 2.8 },
        { t: "vamos", i: 2.85, f: 3.2 },
        { t: "cortar.", i: 3.4, f: 4.0 },
        { t: "Fim", i: 6.0, f: 6.5 },
      ],
    },
  });
}

// ------------------------------------------------------------------ operações

describe("operações da linha do tempo", () => {
  it("dividir, aparar e mover caem no quadro exato e não mexem no projeto de entrada", () => {
    const p = base();
    const d = aplicarOperacao(p, { op: "dividir", clipe: "v1", em_s: 4.013 });
    expect(p.trilhas[0].clipes).toHaveLength(2);
    const v = trilhaPrincipal(d)!;
    expect(v.clipes.map((c) => [c.id, c.inicio_s, c.entrada_s, c.saida_s])).toEqual([
      ["v1", 0, 0, 4],
      ["v3", 4, 4, 10],
      ["v2", 10, 0, 6],
    ]);
    const a = aplicarOperacao(d, { op: "aparar", clipe: "v3", lado: "fim", tempo_s: 8.02 });
    expect(acharClipe(a, "v3")!.clipe.saida_s).toBe(8.04); // 8,02 s a 25 fps cai no quadro 201 (8,04 s)
    const m = aplicarOperacao(a, { op: "mover", clipe: "v2", inicio_s: 12 });
    expect(acharClipe(m, "v2")!.clipe.inicio_s).toBe(12);
    expect(m.duracao_s).toBe(18);
  });

  it("recusa o impossível sem aplicar pela metade", () => {
    const p = base();
    expect(() => aplicarOperacao(p, { op: "dividir", clipe: "v1", em_s: 0 })).toThrow(ErroDaOperacao);
    expect(() => aplicarOperacao(p, { op: "mover", clipe: "v2", inicio_s: 5 })).toThrow("Ali já tem outro clipe.");
    expect(() => aplicarOperacao(p, { op: "aparar", clipe: "v1", lado: "fim", tempo_s: 12 })).toThrow("A fonte acaba antes deste ponto.");
    expect(() => aplicarOperacoes(p, [{ op: "dividir", clipe: "v1", em_s: 2 }, { op: "remover", clipe: "zzz" }])).toThrow();
    expect(trilhaPrincipal(p)!.clipes).toHaveLength(2);
  });

  it("tirar com ondular puxa o resto; recortar tira um trecho da fonte e divide", () => {
    const p = base();
    const r = aplicarOperacao(p, { op: "remover", clipe: "v1", ondular: true });
    expect(trilhaPrincipal(r)!.clipes.map((c) => [c.id, c.inicio_s])).toEqual([["v2", 0]]);
    const c = aplicarOperacao(p, { op: "recortar", clipe: "v1", de_s: 3, ate_s: 5 });
    const v = trilhaPrincipal(c)!.clipes.slice().sort((x, y) => x.inicio_s - y.inicio_s);
    expect(v.map((x) => [x.entrada_s, x.saida_s, x.inicio_s])).toEqual([
      [0, 3, 0],
      [5, 10, 3],
      [0, 6, 10],
    ]);
    const o = aplicarOperacao(c, { op: "ondular", trilha: "video-1" });
    expect(o.duracao_s).toBe(14);
  });

  it("desfazer e refazer passo a passo", () => {
    const p = base();
    let hist = comecarHistorico(p);
    hist = fazer(hist, aplicarOperacao(p, { op: "dividir", clipe: "v1", em_s: 5 }), "Dividir");
    hist = fazer(hist, aplicarOperacao(hist.presente.projeto, { op: "remover", clipe: "v2" }), "Tirar");
    expect(trilhaPrincipal(hist.presente.projeto)!.clipes).toHaveLength(2);
    hist = desfazer(hist);
    expect(trilhaPrincipal(hist.presente.projeto)!.clipes).toHaveLength(3);
    hist = desfazer(hist);
    expect(hist.presente.projeto).toBe(p);
    hist = refazer(refazer(hist));
    expect(trilhaPrincipal(hist.presente.projeto)!.clipes).toHaveLength(2);
    expect(desfazer(comecarHistorico(p)).presente.projeto).toBe(p);
  });

  it("tempo: quadro, texto e leitura", () => {
    expect(noQuadro(1.013, 25)).toBe(1);
    expect(tempoFino(65.5)).toBe("1:05,50");
    expect(segundosDoTexto("1:05,5")).toBe(65.5);
    expect(tempoDoQuadro(1, 25)).toBe(1.02);
    expect(tempoDoUltimoQuadro(2, 25)).toBe(1.98);
  });
});

// ------------------------------------------------------------------ apelidos (agente)

describe("apelidos para o agente (nunca id cru)", () => {
  it("c1, c2 na ordem; operação do agente troca apelido por id; id cru e apelido inexistente são recusados", () => {
    const p = base();
    const a = apelidosDoProjeto(p);
    expect(a.lista.map((x) => [x.apelido, x.id])).toEqual([
      ["c1", "v1"],
      ["c2", "v2"],
    ]);
    expect(resolverApelidos(p, [{ op: "dividir", clipe: "c2", em_s: 12 }])).toEqual([{ op: "dividir", clipe: "v2", em_s: 12 }]);
    expect(() => resolverApelidos(p, [{ op: "remover", clipe: "v1" }])).toThrow(ErroDeApelido);
    expect(() => resolverApelidos(p, [{ op: "remover", clipe: "c9" }])).toThrow("Não existe c9");
    expect(resumoParaOAgente(p)).toContain("c1: IMG_1.MOV, 0:00,00 a 0:10,00");
  });
});

// ------------------------------------------------------------------ skills

describe("skills determinísticas", () => {
  it("cortar silêncios: pausa longa vira respiro, pausa curta fica, nenhuma palavra sai", () => {
    const sil = silenciosDoClipe({ entrada_s: 0, saida_s: 10 }, comFala(base()).transcricoes["img-1"].segmentos, { limiar_s: 0.3, respiro_depois_s: 0.1, respiro_antes_s: 0.08 });
    expect(sil).toEqual([
      { de_s: 0, ate_s: 0.42 },
      { de_s: 1.6, ate_s: 2.42 },
      { de_s: 4.1, ate_s: 5.92 },
      { de_s: 6.6, ate_s: 10 },
    ]);
    const p = comFala(base());
    const prop = proporSkill("cortar_silencios", p, { agora: AGORA });
    expect(prop.operacoes.filter((o) => o.op === "recortar")).toHaveLength(4);
    const v = trilhaPrincipal(prop.resultado)!;
    const palavras = falaNaLinhaDoTempo(prop.resultado).map((w) => w.t);
    expect(palavras).toEqual(["Olá", "pessoal.", "Hoje", "vamos", "cortar.", "Fim"]);
    expect(v.clipes.some((c) => c.fonte === "img-2")).toBe(true);
    expect(prop.resultado.duracao_s).toBeLessThan(p.duracao_s);
    // Determinístico: o mesmo pedido dá o mesmo corte.
    expect(JSON.stringify(proporSkill("cortar_silencios", p, { agora: AGORA }).operacoes)).toBe(JSON.stringify(prop.operacoes));
    // O projeto de entrada não mudou.
    expect(trilhaPrincipal(p)!.clipes).toHaveLength(2);
  });

  it("sem transcrição, cortar silêncios não inventa corte", () => {
    const prop = proporSkill("cortar_silencios", base(), { agora: AGORA });
    expect(prop.operacoes).toHaveLength(0);
    expect(prop.avisos.join(" ")).toContain("não ter transcrição");
  });

  it("legendas: blocos de até N palavras no tempo da fala, refeitos depois do corte", () => {
    const p = proporSkill("cortar_silencios", comFala(base()), { agora: AGORA }).resultado;
    const prop = proporSkill("legendas", p, { agora: AGORA }, { palavras_por_bloco: 2 });
    const leg = prop.resultado.trilhas.find((t) => t.tipo === "legenda")!;
    expect(leg.clipes.map((c) => c.texto)).toEqual(["Olá pessoal.", "Hoje vamos", "cortar.", "Fim"]);
    const primeiro = leg.clipes.slice().sort((a, b) => a.inicio_s - b.inicio_s)[0];
    expect((primeiro.estilo as any).palavras.map((w: any) => w.t)).toEqual(["Olá", "pessoal."]);
    // Nada se sobrepõe.
    const l = leg.clipes.slice().sort((a, b) => a.inicio_s - b.inicio_s);
    for (let i = 1; i < l.length; i++) expect(l[i].inicio_s).toBeGreaterThanOrEqual(fimDoClipe(l[i - 1]) - 1e-9);
  });

  it("Brabo: corta, divide em batidas nas pausas, alterna o zoom e legenda", () => {
    const longo = projetoDosTakes({ titulo: "X", fps: 25, takes: [take("a", "IMG_1.MOV", 10)], agora: AGORA });
    const segs = [] as { t: string; i: number; f: number }[];
    for (let k = 0; k < 20; k++) segs.push({ t: `p${k}`, i: k * 0.5, f: k * 0.5 + 0.4 });
    const p = aplicarOperacao(longo, { op: "transcricao", fonte: "img-1", transcricao: { segmentos: segs, por_palavra: true, origem: "t", versao: 1, em: AGORA } });
    const prop = proporSkill("brabo", p, { agora: AGORA }, { cortar: false });
    const v = trilhaPrincipal(prop.resultado)!.clipes.slice().sort((a, b) => a.inicio_s - b.inicio_s);
    expect(v.length).toBeGreaterThanOrEqual(4);
    // Corte nunca no meio de palavra: cada divisa cai num vão (x,4 a x,5).
    v.slice(1).forEach((c) => expect(((c.entrada_s % 0.5) + 0.5) % 0.5).toBeGreaterThanOrEqual(0.399));
    expect(v.map((c) => (c.zoom ? c.zoom.para : 1))).toEqual(v.map((_, k) => (k % 2 ? 1.08 : 1)));
    expect(prop.resultado.trilhas.find((t) => t.tipo === "legenda")!.clipes.length).toBeGreaterThan(0);
    expect(prop.resultado.skills_aplicadas.map((s) => s.skill)).toEqual(["brabo"]);
  });

  it("punch-in: empurrão no gancho, zoom nos jump cuts da mesma fonte", () => {
    const p = aplicarOperacao(base(), { op: "dividir", clipe: "v1", em_s: 5 });
    const prop = proporSkill("punch_in", p, { agora: AGORA });
    const v = trilhaPrincipal(prop.resultado)!.clipes.slice().sort((a, b) => a.inicio_s - b.inicio_s);
    expect(v.map((c) => c.zoom)).toEqual([{ de: 1, para: 1.12 }, { de: 1.08, para: 1.08 }, null]);
  });

  it("organizar por roteiro e antes e depois", () => {
    const p = base(); // v1 = cena c2, v2 = cena c1
    const org = proporSkill("organizar_por_roteiro", p, { agora: AGORA, cenas: [{ ref: "c1" }, { ref: "c2" }] });
    expect(trilhaPrincipal(org.resultado)!.clipes.slice().sort((a, b) => a.inicio_s - b.inicio_s).map((c) => c.id)).toEqual(["v2", "v1"]);
    const ad = proporSkill("antes_depois", p, { agora: AGORA, selecionados: ["v1", "v2"] }, { modo: "lado_a_lado_h" });
    const v = trilhaPrincipal(ad.resultado)!.clipes;
    expect(v).toHaveLength(1);
    expect(v[0].comparar).toMatchObject({ fonte_b: "img-2", modo: "lado_a_lado_h", rotulos: true });
    expect(v[0].saida_s).toBe(6); // o antes foi aparado para acabar junto do depois
    expect(proporSkill("antes_depois", p, { agora: AGORA, selecionados: ["v1"] }).operacoes).toHaveLength(0);
  });

  it("catálogo e palavras (reserva sem IA)", () => {
    expect(SKILLS_DO_EDITOR.map((s) => s.id)).toEqual(["brabo", "cortar_pela_onda", "ficar_com_melhor_tomada", "cortar_silencios", "legendas", "punch_in", "organizar_por_roteiro", "antes_depois", "fechar_buracos", "transicoes_suaves", "efeitos_sonoros"]);
    expect(skillPorPalavras("corta os silêncios")).toBe("cortar_silencios");
    expect(skillPorPalavras("edição dinâmica estilo brabo")).toBe("brabo");
    expect(skillPorPalavras("sei lá")).toBeNull();
  });
});

// ------------------------------------------------------------------ formato do projeto

describe("formato do projeto (projetos antigos abrem)", () => {
  it("formato 1 (como a E2 gravou) abre no formato 2 sem mexer em tempo", () => {
    const antigo = {
      formato_versao: 1,
      titulo: "Reel antigo",
      formato: "9:16",
      fps: 25,
      revisao: 7,
      fontes: { "img-1": { chave: "img-1", arquivo_id: "a", nome: "IMG_1.MOV", tipo: "bruto", storage_bucket: "mesa", storage_path: "c/video/brutos/a.mov", duracao_s: 10 } },
      trilhas: [{ id: "video-1", tipo: "video", nome: "Vídeo", clipes: [{ id: "v1", fonte: "img-1", inicio_s: 0, entrada_s: 1, saida_s: 8, velocidade: 1, volume: 1 }] }],
    };
    const m = migrarProjeto(antigo);
    expect(m.de).toBe(1);
    expect(m.aviso).toBeNull();
    const p = m.projeto!;
    expect(p.formato_versao).toBe(VERSAO_DO_FORMATO_DO_PROJETO);
    expect(p.revisao).toBe(7);
    expect(p.fontes["img-1"].midia).toBe("video");
    expect(p.trilhas[0].clipes[0]).toMatchObject({ entrada_s: 1, saida_s: 8, comparar: null, origem: null });
    expect(p.transcricoes).toEqual({});
    expect(p.visoes).toEqual({});
    expect(p.referencias).toEqual([]);
    expect(p.continuidade).toEqual({ personagem: null, cenario: null, referencias: [] });
    expect(migrarProjeto({ ...antigo, formato_versao: 9 }).aviso).toContain("mais novo");
  });

  it("formato 2 passa pelo normalizador do servidor sem perder o que é novo", () => {
    let p = comFala(base());
    p = aplicarOperacao(p, { op: "propriedades", clipe: "v1", campos: { comparar: { fonte_b: "img-2", entrada_b_s: 0, modo: "cortina", rotulos: true, rotulo_a: "Antes", rotulo_b: "Depois" } } });
    p = aplicarOperacao(p, { op: "visao", fonte: "img-1", visao: { trechos: [{ de_s: 0.5, ate_s: 2, descricao: "Pessoa de frente", quem: null, plano: "médio", qualidade: null }], modelo: "m", em: AGORA, amostras: 4 } });
    p = aplicarOperacao(p, { op: "referencias", lista: [{ id: "r1", nome: "Ref", origem: "link", storage_bucket: null, storage_path: null, url: "https://www.instagram.com/reel/abc", rede: "instagram", miniatura: null, receita: null, fidelidade: "proxima", template_id: null, em: AGORA }] });
    const n = normalizarProjeto(JSON.parse(JSON.stringify(p)))!;
    expect(n.transcricoes["img-1"].segmentos).toHaveLength(6);
    expect(n.transcricoes["img-1"].versao).toBe(1);
    expect(n.trilhas[0].clipes[0].comparar!.fonte_b).toBe("img-2");
    expect(n.visoes["img-1"].trechos[0].descricao).toBe("Pessoa de frente");
    expect(n.referencias[0]).toMatchObject({ rede: "instagram", fidelidade: "proxima", origem: "link" });
    expect(assinaturaDoProjeto(n)).toBe(assinaturaDoProjeto(p));
  });
});

// ------------------------------------------------------------------ salvar sozinho

describe("salvamento automático sem laço", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("salva só quando muda, um por vez, e a mudança durante a gravação vira UMA gravação a mais", async () => {
    const p0 = base();
    let resolver: (() => void) | null = null;
    const salvar = vi.fn((_p: ProjetoDeEdicao, rev: number) => new Promise<{ revisao: number }>((ok) => (resolver = () => ok({ revisao: rev + 1 }))));
    const s = criarSalvador({ salvar, revisaoInicial: 3, projetoInicial: p0, esperaMs: 1000 });
    s.mudou(p0); // igual ao salvo: nada
    await vi.advanceTimersByTimeAsync(5000);
    expect(salvar).not.toHaveBeenCalled();
    const p1 = aplicarOperacao(p0, { op: "dividir", clipe: "v1", em_s: 5 });
    s.mudou(p1);
    s.mudou(p1);
    await vi.advanceTimersByTimeAsync(999);
    expect(salvar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(salvar).toHaveBeenCalledTimes(1);
    expect(salvar.mock.calls[0][1]).toBe(3);
    const p2 = aplicarOperacao(p1, { op: "remover", clipe: "v2" });
    s.mudou(p2); // durante a gravação
    await vi.advanceTimersByTimeAsync(5000);
    expect(salvar).toHaveBeenCalledTimes(1); // um por vez
    resolver!();
    await vi.advanceTimersByTimeAsync(1000);
    expect(salvar).toHaveBeenCalledTimes(2);
    expect(salvar.mock.calls[1][1]).toBe(4);
    resolver!();
    await vi.advanceTimersByTimeAsync(10000);
    expect(salvar).toHaveBeenCalledTimes(2);
    expect(s.estado()).toBe("salvo");
    expect(s.revisao()).toBe(5);
  });

  it("erro não tenta sozinho; conflito para tudo", async () => {
    const p0 = base();
    const salvar = vi.fn().mockRejectedValueOnce(new Error("rede")).mockRejectedValueOnce(Object.assign(new Error("mudou"), { codigo: "projeto_mudou" }));
    const estados: string[] = [];
    const s = criarSalvador({ salvar, revisaoInicial: 0, projetoInicial: p0, esperaMs: 10, ehConflito: (e: any) => e && e.codigo === "projeto_mudou", aoMudar: (e) => estados.push(e) });
    s.mudou(aplicarOperacao(p0, { op: "dividir", clipe: "v1", em_s: 5 }));
    await vi.advanceTimersByTimeAsync(50);
    expect(s.estado()).toBe("erro");
    await vi.advanceTimersByTimeAsync(60000);
    expect(salvar).toHaveBeenCalledTimes(1);
    s.tentarDeNovo();
    await vi.advanceTimersByTimeAsync(50);
    expect(s.estado()).toBe("conflito");
    s.mudou(aplicarOperacao(p0, { op: "remover", clipe: "v2" }));
    await vi.advanceTimersByTimeAsync(60000);
    expect(salvar).toHaveBeenCalledTimes(2);
    expect(estados).toContain("conflito");
  });

  it("agora() espera a gravação em andamento e só resolve depois de gravar a versão mais nova (sem o respiro)", async () => {
    const p0 = base();
    const voltas: Array<() => void> = [];
    const salvar = vi.fn((_p: ProjetoDeEdicao, rev: number) => new Promise<{ revisao: number }>((ok) => voltas.push(() => ok({ revisao: rev + 1 }))));
    const s = criarSalvador({ salvar, revisaoInicial: 0, projetoInicial: p0, esperaMs: 1000 });
    const p1 = aplicarOperacao(p0, { op: "dividir", clipe: "v1", em_s: 5 });
    s.mudou(p1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(salvar).toHaveBeenCalledTimes(1);
    const p2 = aplicarOperacao(p1, { op: "remover", clipe: "v2" });
    s.mudou(p2); // mudança durante a gravação
    let pronto = false;
    const agora = s.agora().then(() => {
      pronto = true;
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(pronto).toBe(false);
    voltas[0]();
    await vi.advanceTimersByTimeAsync(0);
    // Grava a mais nova na hora (não espera os 1000 ms do respiro).
    expect(salvar).toHaveBeenCalledTimes(2);
    expect(salvar.mock.calls[1][0]).toBe(p2);
    expect(pronto).toBe(false);
    voltas[1]();
    await agora;
    expect(pronto).toBe(true);
    expect(s.estado()).toBe("salvo");
    expect(s.revisao()).toBe(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(salvar).toHaveBeenCalledTimes(2);
  });
});

// ------------------------------------------------------------------ gerações (câmera, continuar, transição)

describe("ferramenta câmera e gerações pelo contrato com a V-A (docs/video/CONTRATOS.md)", () => {
  it("estima sem gasto (so_estimar, sem custo_confirmado_usd) e gera com o custo mostrado e o uid do clique", async () => {
    const chamar = vi.fn().mockResolvedValueOnce({ ok: true, pedido_id: null, custo_estimado: { usd: 0.12, detalhe: "2 variações" } }).mockResolvedValueOnce({ ok: true, pedido_id: "p-1" });
    const corpo = corpoDoAngulo({ client_id: "cli", imagem_path: "cli/video/editor/quadros/x.png", angulo: anguloDaPose("perfil_dir", "perto"), variacoes: 9, manter: "personagem", continuidade: { personagem: "mulher de blusa verde", cenario: null } });
    expect(corpo).toEqual({
      client_id: "cli",
      imagem_path: "cli/video/editor/quadros/x.png",
      angulo: { azimute: 90, elevacao: 0, distancia: "perto" },
      variacoes: 4,
      manter: "personagem",
      prompt: "Manter o personagem: mulher de blusa verde.",
    });
    const r = await prepararGeracao(chamar, "angulo_gerar", corpo);
    expect(r).toEqual({ estado: "preparado", pedido_id: null, custo_usd: 0.12, detalhe: "2 variações" });
    expect(chamar.mock.calls[0][0]).toMatchObject({ acao: "angulo_gerar", so_estimar: true, angulo: { azimute: 90 } });
    expect(chamar.mock.calls[0][0].custo_confirmado_usd).toBeUndefined();
    const c = await confirmarGeracao(chamar, "angulo_gerar", 0.12, corpo, "uid-1");
    expect(c).toMatchObject({ estado: "confirmado", pedido_id: "p-1" });
    expect(chamar.mock.calls[1][0]).toMatchObject({ acao: "angulo_gerar", custo_confirmado_usd: 0.12, uid: "uid-1" });
    expect(chamar.mock.calls[1][0].so_estimar).toBeUndefined();
    expect(anguloDaPose("de_cima", "longe", { elevacao: 40 })).toEqual({ azimute: 0, elevacao: 60, distancia: "longe" });
    expect(anguloDaPose("costas", "medio", { azimute: 30 }).azimute).toBe(-150);
  });

  it("409 confirmar_custo também mostra o custo (sem gasto); gerar_cena vai como cena_gerar", async () => {
    const chamar = vi.fn().mockRejectedValueOnce(new ErroDaMesa("confirmar_custo", "Confirme o custo.", { custo_estimado: { usd: 1.2, detalhe: "6 s" } }));
    const r = await prepararGeracao(chamar, "gerar_cena", { client_id: "cli", modo: "primeiro_quadro", quadro_inicial_path: "cli/q.png" });
    expect(r).toMatchObject({ estado: "preparado", custo_usd: 1.2 });
    expect(chamar.mock.calls[0][0].acao).toBe("cena_gerar");
  });

  it("ação que o servidor não tem vira em preparação; custo que mudou pede confirmação de novo; sem cotação não gera", async () => {
    const semAcao = vi.fn().mockRejectedValue(new ErroDaMesa("acao_desconhecida", "Ação desconhecida."));
    expect((await prepararGeracao(semAcao, "continuar_video", {})).estado).toBe("em_preparacao");
    expect((await prepararGeracao(semAcao, "transicao_gerar", {})).estado).toBe("em_preparacao");
    const mudou = vi.fn().mockRejectedValue(new ErroDaMesa("custo_mudou", "O custo passou do mostrado.", { custo_estimado: { usd: 0.3 } }));
    expect(await confirmarGeracao(mudou, "transicao_gerar", 0.2, {}, "u")).toMatchObject({ estado: "custo_mudou", custo_usd: 0.3 });
    const semCotacao = vi.fn().mockRejectedValue(new ErroDaMesa("sem_cotacao", "Sem preço."));
    expect((await prepararGeracao(semCotacao, "continuar_video", {})).estado).toBe("erro");
    expect((await confirmarGeracao(vi.fn(), "angulo_gerar", null, {}, "u")).estado).toBe("erro");
  });

  it("resultado do pedido vira item da biblioteca e entra depois do clipe atual", () => {
    const itens = midiasDoPedido({ id: "p-1", resultado: { imagens: [{ storage_path: "cli/video/editor/angulos/a.png" }] } });
    expect(itens).toHaveLength(1);
    const p = base();
    const ops = opsParaInserir(p, itens[0], { depoisDe: "v1" }, 0, { tipo: "angulo", ref: "p-1" });
    const novo = aplicarOperacoes(p, ops);
    const v = trilhaPrincipal(novo)!.clipes.slice().sort((a, b) => a.inicio_s - b.inicio_s);
    expect(v.map((c) => c.id)).toEqual(["v1", "v3", "v2"]);
    expect(v[1]).toMatchObject({ inicio_s: 10, saida_s: 3, origem: { tipo: "angulo", ref: "p-1" } });
    expect(novo.fontes[v[1].fonte!].midia).toBe("imagem");
    expect(v[2].inicio_s).toBe(13);
  });
});

// ------------------------------------------------------------------ timestamp

describe("timestamp", () => {
  it("parte n ganha o início exato da parte; emendas sem palavra repetida; linhas e SRT", () => {
    const p1 = deslocarPalavras([{ word: "um", start: 0.1, end: 0.4 }, { word: "dois", start: 59.8, end: 60.1 }], 0);
    const p2 = deslocarPalavras([{ word: "dois", start: 0, end: 0.1 }, { word: "três.", start: 0.3, end: 0.6 }], 59.95);
    expect(p2[1]).toEqual({ t: "três.", i: 60.25, f: 60.55 });
    const todas = juntarPartes([p2, p1]);
    expect(todas.map((w) => w.t)).toEqual(["um", "dois", "três."]);
    const linhas = linhasDeLegenda(todas, 6);
    expect(linhas).toEqual([
      { texto: "um", i: 0.1, f: 0.4 },
      { texto: "dois três.", i: 59.8, f: 60.55 },
    ]);
    expect(srtDasLinhas(linhas)).toContain("00:00:59,800 --> 00:01:00,550");
    expect(custoDoTimestamp("transcrever", 90)).toBe(0.009);
    expect(custoDoTimestamp("alinhar", 90)).toBe(0.22);
  });

  it("partes do áudio: emenda no ponto mais quieto, sempre o mesmo", () => {
    const taxa = 1000;
    const a = new Float32Array(150 * taxa).map((_, i) => Math.sin(i) * 0.5);
    for (let i = 57.5 * taxa; i < 57.6 * taxa; i++) a[i] = 0; // silêncio aos 57,5 s
    const partes = partesDoAudio(a, taxa, 60, 5);
    expect(partes[0].fim_s).toBeGreaterThanOrEqual(57.5);
    expect(partes[0].fim_s).toBeLessThanOrEqual(57.6);
    expect(partes[partes.length - 1].fim_s).toBe(150);
    expect(JSON.stringify(partesDoAudio(a, taxa, 60, 5))).toBe(JSON.stringify(partes));
    const w = wavDe(new Float32Array([0, 0.5, -0.5]), 16000);
    expect(w.size).toBe(44 + 6);
  });

  it("SRT da Entrada vira fala por frase", () => {
    expect(segmentosDoSrt("1\n00:00:01,000 --> 00:00:02,500\nOlá <b>mundo</b>\n\n2\n00:00:03,000 --> 00:00:04,000\nTchau\n")).toEqual([
      { t: "Olá mundo", i: 1, f: 2.5 },
      { t: "Tchau", i: 3, f: 4 },
    ]);
  });
});

// ------------------------------------------------------------------ agente (laço de ferramentas)

describe("agente editor: laço com limites", () => {
  it("executa as ferramentas aqui, com apelidos, e para quando termina", async () => {
    const p = base();
    const chamar = vi
      .fn()
      .mockResolvedValueOnce({ passo: { plano: "Dividir e tirar.", chamadas: [{ ferramenta: "dividir", argumentos: { clipe: "c1", em_s: 5 } }, { ferramenta: "ler_projeto", argumentos: {} }], resposta: "", terminou: false, recusadas: [] }, gasto_usd: 0.01 })
      .mockResolvedValueOnce({ passo: { plano: "", chamadas: [{ ferramenta: "remover", argumentos: { clipe: "c3", ondular: true } }], resposta: "Pronto.", terminou: true, recusadas: [] }, gasto_usd: 0.02 });
    const r = await rodarAgente({ chamar, clientId: "cli", sessao: "s", pedido: "tira o fim", projeto: p, modeloId: "m", tetoUsd: 0.5, agora: AGORA });
    expect(chamar).toHaveBeenCalledTimes(2);
    expect(chamar.mock.calls[0][0]).toMatchObject({ acao: "agente_passo", passo: 1, ferramentas_usadas: 0 });
    expect(chamar.mock.calls[1][0]).toMatchObject({ passo: 2, ferramentas_usadas: 2 });
    expect(r.operacoes.map((o) => o.op)).toEqual(["dividir", "remover"]);
    expect(trilhaPrincipal(r.resultado)!.clipes.map((c) => c.id).sort()).toEqual(["v1", "v3"]);
    expect(trilhaPrincipal(p)!.clipes).toHaveLength(2); // nada aplicado sem o dono
    expect(r.resposta).toBe("Pronto.");
  });

  it("erro de ferramenta volta como texto (não quebra); limites e leitura do passo", () => {
    const x = executarFerramenta(base(), { ferramenta: "dividir", argumentos: { clipe: "v1", em_s: 3 } }, AGORA);
    expect(x.ok).toBe(false);
    expect(x.texto).toContain("apelido");
    const lido = lerPasso({ plano: "x", chamadas: [{ ferramenta: "dividir", argumentos_json: '{"clipe":"c1","em_s":2}' }, { ferramenta: "apagar_tudo", argumentos_json: "{}" }, { ferramenta: "mover", argumentos_json: "{quebrado" }], resposta: "", terminou: false }, 5);
    expect(lido.chamadas).toEqual([{ ferramenta: "dividir", argumentos: { clipe: "c1", em_s: 2 } }]);
    expect(lido.recusadas).toHaveLength(2);
    expect(lerPasso({ chamadas: Array.from({ length: 20 }, () => ({ ferramenta: "ler_projeto", argumentos_json: "{}" })) }, 3).chamadas).toHaveLength(3);
    expect(motivoParaParar({ passo: 1, ferramentasUsadas: MAX_FERRAMENTAS, gastoUsd: 0, tetoUsd: 1 })).toContain("ferramentas");
    expect(motivoParaParar({ passo: 1, ferramentasUsadas: 0, gastoUsd: 0.6, tetoUsd: 0.5 })).toContain("teto");
    expect(motivoParaParar({ passo: 2, ferramentasUsadas: 3, gastoUsd: 0.1, tetoUsd: 0.5 })).toBeNull();
  });

  it("visão só vale nos tempos dos quadros enviados", () => {
    const t = trechosConferidos({ trechos: [{ de_s: 0.9, ate_s: 7.7, descricao: "Pessoa falando", quem: "", plano: "médio", qualidade: "boa" }, { de_s: 1, ate_s: 2, descricao: "" }] }, [1, 3, 5, 8]);
    expect(t).toEqual([{ de_s: 1, ate_s: 8, descricao: "Pessoa falando", quem: null, plano: "médio", qualidade: "boa" }]);
    expect(temposDeAmostra(10, 4)).toEqual([1.25, 3.75, 6.25, 8.75]);
  });
});

// ------------------------------------------------------------------ referência de edição (receita)

describe("receita de edição da referência", () => {
  const quadro = (v: number) => new Uint8Array(64).fill(v);

  it("detecta troca de plano por diferença de quadros (sintéticos), sem pegar movimento suave", () => {
    const assin: Uint8Array[] = [];
    const tempos: number[] = [];
    for (let k = 0; k < 40; k++) {
      tempos.push(k * 0.25 + 0.125);
      // Plano A (0 a 2,5 s) com leve movimento; plano B (2,5 a 6 s); plano C (6 s em diante).
      assin.push(quadro(k < 10 ? 40 + k : k < 24 ? 200 : 110));
    }
    const r = detectarCortes(assin, tempos);
    expect(r.cortes).toEqual([2.5, 6]);
    const rit = ritmo(r.cortes, 10);
    expect(rit).toEqual({ plano_medio_s: 3.33, plano_mediano_s: 3.5, planos_por_minuto: 18 });
    expect(JSON.stringify(detectarCortes(assin, tempos))).toBe(JSON.stringify(r));
  });

  it("receita normalizada e níveis de fidelidade mudando os parâmetros", () => {
    const rec = receitaDaMedida({ duracao_s: 30, largura: 1080, altura: 1920, cortes: [1.5, 3, 4.5, 6, 7.5, 9, 30.5, -1], suaves: [2, 5, 11], quadros: 120, passo_s: 0.25, brilho: 0.4, contraste: 0.3, saturacao: 0.5, musica: null });
    expect(rec.formato).toBe("9:16");
    expect(rec.cortes).toEqual([1.5, 3, 4.5, 6, 7.5, 9]);
    expect(normalizarReceita({ duracao_s: 0 })).toBeNull();
    const comLegenda = normalizarReceita({ ...rec, legenda: { tem: true, palavras_por_vez: 3, destaque: true, posicao: "base" }, transicoes: { predominante: "fade" } })!;
    const i = parametrosPelaFidelidade(comLegenda, "identica");
    const p = parametrosPelaFidelidade(comLegenda, "proxima");
    const s = parametrosPelaFidelidade(comLegenda, "inspirada");
    const c = parametrosPelaFidelidade(comLegenda, "criativa");
    expect(i).toMatchObject({ batida_s: 1.5, zoom: 1.08, transicao: "fade", legendar: true, palavras_por_bloco: 3, estilo_legenda: "destaque", posicao_legenda: "base" });
    expect(p.batida_s).toBe(1.8);
    expect(p.zoom).toBe(1.05);
    expect(p.palavras_por_bloco).toBe(4);
    expect(s).toMatchObject({ batida_s: 2, zoom: null, transicao: null });
    expect(c).toMatchObject({ batida_s: null, zoom: null, legendar: true, estilo_legenda: "destaque" });
    // Aplicar: só a edição, pelas skills, com tempos do código.
    const prop = proporReceita(comFala(base()), comLegenda, "identica", { agora: AGORA }, "ref");
    expect(prop.operacoes.some((o) => o.op === "recortar")).toBe(true);
    expect(prop.resultado.trilhas.find((t) => t.tipo === "legenda")!.clipes.length).toBeGreaterThan(0);
    expect(batidas(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]), 0.2).batidas_por_minuto).toBe(100);
  });

  it("link de rede social nunca é baixado; arquivo do painel é usado", () => {
    const ig = planoDoLink("https://www.instagram.com/reel/Cabc123/");
    expect(ig).toMatchObject({ tipo: "rede", rede: "instagram", baixar: false });
    const yt = planoDoLink("https://youtube.com/shorts/dQw4w9WgXcQ");
    expect(yt).toMatchObject({ tipo: "rede", rede: "youtube", baixar: false, miniatura: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" });
    expect(planoDoLink("https://vm.tiktok.com/ZM123/")).toMatchObject({ rede: "tiktok", baixar: false });
    expect(planoDoLink("https://abc.supabase.co/storage/v1/object/sign/mesa/cli/video/brutos/x.mp4?token=1")).toMatchObject({ tipo: "painel", baixar: true });
    expect(planoDoLink("https://exemplo.com/video.mp4")).toMatchObject({ tipo: "arquivo_externo", baixar: false });
    expect(planoDoLink("http://inseguro.com/a.mp4").tipo).toBe("invalido");
  });
});

// ------------------------------------------------------------------ comparador

describe("comparador antes e depois", () => {
  it("teclado, ponteiro e recorte", () => {
    expect(posicaoPelaTecla(50, "ArrowLeft")).toBe(48);
    expect(posicaoPelaTecla(95, "ArrowRight", true)).toBe(100);
    expect(posicaoPelaTecla(50, "Home")).toBe(0);
    expect(posicaoPelaTecla(50, "a")).toBeNull();
    expect(posicaoPeloPonteiro(150, 0, { left: 100, top: 0, width: 200, height: 100 }, "horizontal")).toBe(25);
    expect(posicaoPeloPonteiro(0, 90, { left: 0, top: 50, width: 200, height: 80 }, "vertical")).toBe(50);
    expect(recorteDoDepois(30, "horizontal")).toBe("inset(0 0 0 30%)");
    expect(recorteDoDepois(30, "vertical")).toBe("inset(30% 0 0 0)");
  });

  it("imagem: alavanca com setas e troca de modo sem desmontar", () => {
    render(h(ComparadorAntesDepois, { tipo: "imagem", antes: { src: "a.png" }, depois: { src: "b.png" } }));
    const alavanca = screen.getByRole("slider", { name: "Divisa entre antes e depois" });
    expect(alavanca.getAttribute("aria-valuenow")).toBe("50");
    fireEvent.keyDown(alavanca, { key: "ArrowRight", shiftKey: true });
    expect(alavanca.getAttribute("aria-valuenow")).toBe("60");
    fireEvent.click(screen.getByRole("tab", { name: /Lado a lado/ }));
    expect(document.querySelector('[data-comparador="lado_a_lado"]')).toBeTruthy();
    expect(document.querySelectorAll("img").length).toBe(2);
  });
});

// ------------------------------------------------------------------ piso de compatibilidade

describe("piso Safari 11 / Chrome 64 nos arquivos da tela do editor", () => {
  it("sem lookbehind, grupo nomeado, \\p{}, .at(), Object.hasOwn, randomUUID nem travessão", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join, resolve } = await import("node:path");
    const raiz = resolve(__dirname, "../..");
    const pastas = ["src/lib/editor", "src/lib/editor/skills", "src/components/mesa-edicao", "src/components/mesa-edicao/editor", "src/components/comparar"];
    const arquivos = pastas.reduce((l, p) => l.concat(readdirSync(join(raiz, p)).filter((f) => /\.tsx?$/.test(f)).map((f) => join(raiz, p, f))), [] as string[]);
    expect(arquivos.length).toBeGreaterThan(20);
    for (const f of arquivos) {
      const t = readFileSync(f, "utf8");
      expect(t, f).not.toMatch(/\(\?<[=!]/);
      expect(t, f).not.toMatch(/\(\?<[a-z]/i);
      expect(t, f).not.toMatch(/\\p\{/);
      expect(t, f).not.toMatch(/\.at\(/);
      expect(t, f).not.toMatch(/Object\.hasOwn\(/);
      expect(t, f).not.toMatch(/crypto\.randomUUID/);
      expect(t, f).not.toMatch(/[—–]/);
    }
  });
});

// clipeNovo precisa dos campos novos com padrão (projetos antigos e novos iguais).
it("clipe novo nasce com comparar e origem vazios", () => {
  expect(clipeNovo({ id: "x", inicio_s: 0, entrada_s: 0, saida_s: 1 })).toMatchObject({ comparar: null, origem: null });
});

export type { Operacao };
