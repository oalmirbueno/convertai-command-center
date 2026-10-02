import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { conferirCorte, cortesDaOnda, limiarDaFonte, medirOnda, palavrasNaOnda, pausasDaOnda, rmsEmDb, tomadasQueSaem, CORTE_PELA_ONDA } from "../../supabase/functions/_shared/onda-do-audio";
import {
  BIBLIOTECA_DE_SONS,
  filtroLoudnormAplicar,
  ganhoDaTrilhaDb,
  lerLoudnorm,
  noAlvoDeLoudness,
  planoDeSons,
  somPorId,
  subidaDaTrilhaDb,
  trechosDeFala,
  ESPACO_MINIMO_ENTRE_SONS_S,
} from "../../supabase/functions/mesa-motion/modulos/som-do-editor";
import { projetoDosTakes, normalizarProjeto, type ProjetoDeEdicao } from "../../supabase/functions/_shared/projeto-de-edicao";
import { aplicarOperacao, trilhaPrincipal } from "@/lib/editor/operacoes";
import { proporSkill, skillPorPalavras } from "@/lib/editor/skills";
import { conferirCorteDoProjeto } from "@/lib/editor/skills/corteDeVerdade";

/**
 * Frente EDT (30/09): corte de verdade (onda em sinal sintético, melhor
 * tomada, conferência como aviso), plano de sons no pico, trilha 22 dB abaixo
 * da voz com duck e o -14 LUFS (cálculo). Nada de rede nem banco.
 */

const TAXA = 16000;

/** Sinal sintético: tom a -20 dBFS nas falas e ruído a ~-70 dBFS nas pausas. */
function sinal(partes: { fala: boolean; s: number }[]): Float32Array {
  const total = Math.round(partes.reduce((n, p) => n + p.s, 0) * TAXA);
  const a = new Float32Array(total);
  let k = 0;
  let semente = 7;
  const ruido = () => {
    semente = (semente * 1103515245 + 12345) & 0x7fffffff;
    return (semente / 0x7fffffff - 0.5) * 2;
  };
  partes.forEach((p) => {
    const n = Math.round(p.s * TAXA);
    for (let j = 0; j < n; j++, k++) a[k] = p.fala ? 0.1 * Math.sin((2 * Math.PI * 220 * k) / TAXA) * 1.414 : 0.0003 * ruido();
  });
  return a;
}

const AGORA = "2026-09-30T12:00:00.000Z";

function projetoComOnda(): ProjetoDeEdicao {
  const p = projetoDosTakes({ titulo: "Reel", fps: 25, takes: [{ id: "a", nome: "fala.mp4", tipo: "bruto", storage_bucket: "mesa", storage_path: "cli/video/brutos/a.mp4", cena_ref: null, melhor: true, duracao_s: 5, largura: 1080, altura: 1920 }], agora: AGORA });
  return aplicarOperacao(p, { op: "onda", fonte: "fala", onda: { janela_s: 0.01, limiar_db: -40, chao_db: -70, duracao_s: 5, pausas: [{ de_s: 0, ate_s: 0.4 }, { de_s: 1.4, ate_s: 2.2 }, { de_s: 3.0, ate_s: 3.2 }, { de_s: 4.6, ate_s: 5 }], lufs: -18, em: AGORA } });
}

describe("onda do áudio (sinal sintético)", () => {
  it("mede em janelas de 10 ms, acha o chão de ruído e as pausas", () => {
    const a = sinal([
      { fala: true, s: 1 },
      { fala: false, s: 0.6 },
      { fala: true, s: 1 },
      { fala: false, s: 0.2 },
      { fala: true, s: 1 },
    ]);
    const db = rmsEmDb(a, TAXA);
    expect(db.length).toBe(380);
    expect(Math.round(db[10])).toBe(-20);
    const l = limiarDaFonte(db);
    expect(l.chao_db).toBeLessThan(-60);
    expect(l.limiar_db).toBeGreaterThan(l.chao_db + 7);
    expect(l.limiar_db).toBeLessThan(-25);
    const o = medirOnda(a, TAXA);
    expect(o.duracao_s).toBe(3.8);
    expect(o.pausas).toEqual([
      { de_s: 1, ate_s: 1.6 },
      { de_s: 2.6, ate_s: 2.8 },
    ]);
  });

  it("estalo curto no meio do silêncio não quebra a pausa", () => {
    const db = new Array(100).fill(-70);
    db[50] = -10; // 10 ms de estalo
    expect(pausasDaOnda(db, 0.01, -40)).toEqual([{ de_s: 0, ate_s: 1 }]);
  });

  it("corte pela onda: nenhuma pausa acima de 0,25 s, emenda de 0,12 s, começo e fim ficam com o lado da fala", () => {
    const pausas = [
      { de_s: 0, ate_s: 0.5 },
      { de_s: 1, ate_s: 1.6 },
      { de_s: 2.6, ate_s: 2.8 },
      { de_s: 3.5, ate_s: 4 },
    ];
    const c = cortesDaOnda({ entrada_s: 0, saida_s: 4 }, pausas);
    expect(c).toEqual([
      { de_s: 0, ate_s: 0.45 },
      { de_s: 1.07, ate_s: 1.55 },
      { de_s: 3.57, ate_s: 4 },
    ]);
    // A emenda do meio deixa 0,12 s (0,07 depois da fala, 0,05 antes).
    expect(Math.round((0.6 - (c[1].ate_s - c[1].de_s)) * 1000) / 1000).toBe(CORTE_PELA_ONDA.emenda_s);
    // Clipe inteiro mudo não é pausa de fala.
    expect(cortesDaOnda({ entrada_s: 1.1, saida_s: 1.5 }, pausas)).toEqual([]);
  });

  it("palavra que o transcritor adiantou passa a começar quando a voz volta", () => {
    expect(palavrasNaOnda([{ t: "oi", i: 1.3, f: 1.9 }], [{ de_s: 1, ate_s: 1.6 }])).toEqual([{ t: "oi", i: 1.6, f: 1.9 }]);
  });

  it("melhor tomada: falso começo, repetição e gagueira saem; fica a última inteira", () => {
    const w = (t: string, i: number) => ({ t, i, f: i + 0.3 });
    const fala = [
      w("eu", 0), w("queria", 0.35), // falso começo
      w("eu", 1.5), w("queria", 1.85), w("falar", 2.2), w("de", 2.55), w("vendas.", 2.9),
      w("o", 4), w("o", 4.35), w("segredo", 4.7), w("é", 5.05), w("simples.", 5.4),
    ];
    const t = tomadasQueSaem(fala);
    expect(t.map((x) => x.motivo)).toEqual(["falso_comeco", "gagueira"]);
    expect(t[0]).toMatchObject({ de_s: 0, texto: "eu queria", ficou: "eu queria falar de vendas." });
    expect(t[0].ate_s).toBeCloseTo(1.45, 3);
    expect(t[1]).toMatchObject({ de_s: 4, texto: "o" });
  });

  it("conferência é só aviso: acha respiro que sobrou, palavra mordida e clipe curto", () => {
    const r = conferirCorte(
      [
        { id: "v1", fonte: "a", inicio_s: 0, entrada_s: 0, saida_s: 2, velocidade: 1 },
        { id: "v2", fonte: "a", inicio_s: 2, entrada_s: 2.5, saida_s: 2.6, velocidade: 1 },
        { id: "v3", fonte: "a", inicio_s: 2.1, entrada_s: 3, saida_s: 5, velocidade: 1 },
      ],
      { a: { pausas: [{ de_s: 1.2, ate_s: 1.6 }] } },
      { a: [{ t: "palavra", i: 1.9, f: 2.3 }] },
    );
    expect(r.respiros).toEqual([{ em_s: 1.2, duracao_s: 0.4 }]);
    expect(r.mordidas[0]).toMatchObject({ palavra: "palavra", em_s: 2 });
    expect(r.curtos.length).toBe(1);
    expect(r.ok).toBe(false);
    expect(r.resumo).toMatch(/^Conferência: 1 respiro acima de 0,25 s, 1 palavra mordida/);
  });
});

describe("skills do corte de verdade", () => {
  it("cortar_pela_onda recorta pelas pausas medidas e registra; sem onda, avisa", () => {
    const p = projetoComOnda();
    const prop = proporSkill("cortar_pela_onda", p, { agora: AGORA });
    // 02/10: os cortes saem numa operação só (corta e encosta em quadros inteiros).
    const lote = prop.operacoes.find((o) => o.op === "recortar_varios") as { cortes: unknown[] } | undefined;
    expect(lote && lote.cortes.length).toBe(3);
    const t = trilhaPrincipal(prop.resultado)!;
    const total = t.clipes.reduce((s, c) => s + (c.saida_s - c.entrada_s), 0);
    expect(Math.round(total * 100) / 100).toBe(3.64);
    const conf = conferirCorteDoProjeto(prop.resultado);
    expect(conf.respiros).toEqual([]);
    const semOnda = proporSkill("cortar_pela_onda", { ...p, ondas: {} }, { agora: AGORA });
    expect(semOnda.operacoes.length).toBe(0);
    expect(semOnda.resumo).toMatch(/Falta medir a onda/);
  });

  it("ficar_com_melhor_tomada lista o que saiu no cartão", () => {
    let p = projetoComOnda();
    p = aplicarOperacao(p, { op: "transcricao", fonte: "fala", transcricao: { por_palavra: true, origem: "t", versao: 1, em: AGORA, segmentos: [{ t: "eu", i: 0.5, f: 0.7 }, { t: "queria", i: 0.75, f: 1.1 }, { t: "eu", i: 2.3, f: 2.5 }, { t: "queria", i: 2.55, f: 2.9 }, { t: "falar", i: 2.95, f: 3.3 }] } });
    const prop = proporSkill("ficar_com_melhor_tomada", p, { agora: AGORA });
    expect(prop.operacoes.some((o) => o.op === "recortar_varios")).toBe(true);
    expect(prop.avisos[0]).toMatch(/^Falso começo: "eu queria" \(ficou "eu queria falar"\)/);
  });

  it("legenda padrão de 3 palavras e as palavras novas acham a skill", () => {
    let p = projetoComOnda();
    p = aplicarOperacao(p, { op: "transcricao", fonte: "fala", transcricao: { por_palavra: true, origem: "t", versao: 1, em: AGORA, segmentos: ["um", "dois", "três", "quatro", "cinco", "seis", "sete"].map((t, k) => ({ t, i: 0.5 + k * 0.3, f: 0.75 + k * 0.3 })) } });
    const prop = proporSkill("legendas", p, { agora: AGORA });
    const leg = prop.resultado.trilhas.find((t) => t.tipo === "legenda")!;
    expect(leg.clipes.map((c) => c.texto)).toEqual(["um dois três", "quatro cinco seis", "sete"]);
    expect(skillPorPalavras("tira as repetições e falsos começos")).toBe("ficar_com_melhor_tomada");
    expect(skillPorPalavras("corta pela onda")).toBe("cortar_pela_onda");
    expect(skillPorPalavras("põe efeito sonoro")).toBe("efeitos_sonoros");
  });

  it("projeto antigo abre com ondas vazias e mixagem padrão; onda e mixagem sobrevivem ao salvar", () => {
    const p = projetoComOnda();
    const velho = JSON.parse(JSON.stringify(p));
    delete velho.ondas;
    delete velho.mixagem;
    const n = normalizarProjeto(velho)!;
    expect(n.ondas).toEqual({});
    expect(n.mixagem).toEqual({ trilha_abaixo_da_voz_db: 22, subida_nas_pausas_db: 6, lufs_alvo: -14, duck: true });
    const salvo = normalizarProjeto(JSON.parse(JSON.stringify({ ...p, mixagem: { trilha_abaixo_da_voz_db: 99, lufs_alvo: -14 } })))!;
    expect(salvo.ondas.fala.pausas.length).toBe(4);
    expect(salvo.mixagem.trilha_abaixo_da_voz_db).toBe(36);
  });
});

describe("som: biblioteca, plano no pico, trilha e loudness", () => {
  it("cada som da biblioteca existe, é CC0 e tem o comprovante de licença ao lado", () => {
    const raiz = path.resolve(__dirname, "../../public/editor/sons");
    expect(BIBLIOTECA_DE_SONS.length).toBeGreaterThanOrEqual(15);
    BIBLIOTECA_DE_SONS.forEach((s) => {
      expect(existsSync(path.join(raiz, s.arquivo))).toBe(true);
      expect(existsSync(path.join(raiz, s.comprovante))).toBe(true);
      expect(s.licenca).toBe("CC0 1.0");
      expect(s.pico_s).toBeGreaterThanOrEqual(0);
      expect(s.pico_s).toBeLessThan(s.duracao_s);
    });
    expect(readFileSync(path.join(raiz, "licencas/pop.txt"), "utf8")).toMatch(/CC0/);
  });

  it("o pico do som cai no quadro do movimento, com 0,65 s entre sons (fica o mais importante)", () => {
    const plano = planoDeSons(
      [
        { pico_s: 1.0, som: "pop", prioridade: 1, ref: "a" },
        { pico_s: 1.4, som: "impacto", prioridade: 3, ref: "b" },
        { pico_s: 3.0, som: "whoosh", prioridade: 1, ref: "c" },
        { pico_s: 3.64, som: "pop", prioridade: 1, ref: "d" },
      ],
      { fps: 25 },
    );
    expect(plano.map((x) => x.ref)).toEqual(["b", "c"]);
    const impacto = somPorId("impacto")!;
    expect(plano[0].inicio_s).toBeCloseTo(1.4 - impacto.pico_s, 3);
    expect(plano[1].pico_s - plano[0].pico_s).toBeGreaterThanOrEqual(ESPACO_MINIMO_ENTRE_SONS_S);
    // Som que começaria antes do zero começa no zero.
    expect(planoDeSons([{ pico_s: 0.05, som: "whoosh" }])[0].inicio_s).toBe(0);
    expect(planoDeSons([{ pico_s: 1, som: "pop", prioridade: 1 }, { pico_s: 5, som: "cash", prioridade: 3 }], { modo: "poucos" }).map((x) => x.som)).toEqual(["cash"]);
  });

  it("trilha 22 dB abaixo da voz pelos LUFS medidos, com limite", () => {
    expect(ganhoDaTrilhaDb(-18, -14, 22)).toBe(-26);
    expect(ganhoDaTrilhaDb(-16, -30)).toBe(-8);
    expect(ganhoDaTrilhaDb(-10, -70)).toBe(12);
    expect(ganhoDaTrilhaDb(-30, 0)).toBe(-40);
  });

  it("duck: base durante a fala, sobe nas pausas longas com rampa, não sobe nas curtas", () => {
    const fala = trechosDeFala([
      { i: 0, f: 1 },
      { i: 1.2, f: 2 },
      { i: 4, f: 5 },
    ]);
    expect(fala).toEqual([{ de_s: 0, ate_s: 2 }, { de_s: 4, ate_s: 5 }]);
    expect(subidaDaTrilhaDb(0.5, fala)).toBe(0);
    expect(subidaDaTrilhaDb(2.1, fala)).toBeCloseTo(6 * 0.25, 3);
    expect(subidaDaTrilhaDb(3, fala)).toBe(6);
    expect(subidaDaTrilhaDb(3.94, fala)).toBeCloseTo(3, 3);
    const curta = trechosDeFala([{ i: 0, f: 1 }, { i: 1.5, f: 2 }], 0.1);
    expect(subidaDaTrilhaDb(1.25, curta)).toBe(0);
  });

  it("-14 LUFS: lê a medida do loudnorm e monta o segundo passo", () => {
    const saida = `[Parsed_loudnorm_0 @ 0x1]\n{\n\t"input_i" : "-21.36",\n\t"input_tp" : "-3.10",\n\t"input_lra" : "5.20",\n\t"input_thresh" : "-31.60",\n\t"output_i" : "-14.10",\n\t"target_offset" : "0.10"\n}\n`;
    const m = lerLoudnorm(saida)!;
    expect(m).toEqual({ input_i: -21.36, input_tp: -3.1, input_lra: 5.2, input_thresh: -31.6, target_offset: 0.1 });
    expect(filtroLoudnormAplicar(m)).toBe("loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=-21.36:measured_TP=-3.1:measured_LRA=5.2:measured_thresh=-31.6:offset=0.1:linear=true:print_format=json");
    expect(lerLoudnorm("sem json")).toBeNull();
    expect(noAlvoDeLoudness(-14.6)).toBe(true);
    expect(noAlvoDeLoudness(-16)).toBe(false);
  });
});
