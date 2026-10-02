import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  caminhosDaLegenda,
  falaNoCorte,
  legendaDoFinal,
  linhasDasPalavras,
  linhasDaTrilhaDeLegenda,
  projetoComLegenda,
  recortarLinhas,
  srtDe,
  vttDe,
  type ProjetoParaLegenda,
} from "../../supabase/functions/mesa-videos/modulos/legenda-do-final";
import {
  corpoDoTratamento,
  custoCobrado,
  custoDoTratamento,
  estadoDepoisDe,
  faltaNoTrecho,
  fatorDoNivel,
  janelaDaAmostra,
  motorDoTratamento,
  MOTORES_DO_TRATAMENTO,
  nomeDoTratado,
  partesDoTrecho,
  pastaDoTratado,
  podeComecar,
  precoDoTopaz,
  proximoPassoDoTratamento,
  regiaoValida,
  textoDoEstadoDoTratamento,
  type PassosDaFase,
} from "../../supabase/functions/mesa-videos/modulos/tratamento-de-video";
import { acharLegenda, type QuadroEmLuma } from "../../supabase/functions/mesa-videos/modulos/deteccao-de-legenda";
import { argsDaMascara, argsDaParte, filtroDoTratamento, regiaoDoPedido } from "../../workers/render/tratamento";
import { normalizarProjeto, projetoDosTakes } from "../../supabase/functions/_shared/projeto-de-edicao";

/**
 * Mesa Edição (02/10): gerador de legenda do vídeo pronto (tempos levados pelo
 * corte), tratar vídeo (tirar a legenda gravada, melhorar a qualidade: custo,
 * partes, pedidos aos modelos e a máquina de estados amostra -> inteiro, sem
 * rede), a busca da faixa da legenda nos quadros e as guardas do banco, da
 * função e do worker.
 */

const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8").replace(/\r\n/g, "\n");

function projeto(): ProjetoParaLegenda {
  return {
    fps: 30,
    trilhas: [
      {
        id: "v1",
        tipo: "video",
        clipes: [
          // Da fonte A, o trecho 2 a 6 s entra no começo da linha do tempo.
          { id: "c1", fonte: "a", inicio_s: 0, entrada_s: 2, saida_s: 6, velocidade: 1, texto: null },
          // Da fonte A de novo, o trecho 10 a 14 s em dobro de velocidade, a partir de 4 s.
          { id: "c2", fonte: "a", inicio_s: 4, entrada_s: 10, saida_s: 14, velocidade: 2, texto: null },
        ],
      },
    ],
    transcricoes: {
      a: {
        por_palavra: true,
        segmentos: [
          { t: "isto", i: 0.5, f: 0.9 }, // cortado (antes do trecho)
          { t: "Oi", i: 2.2, f: 2.5 },
          { t: "gente.", i: 2.6, f: 3.0 },
          { t: "Hoje", i: 4.0, f: 4.3 },
          { t: "tem", i: 4.4, f: 4.6 },
          { t: "promoção", i: 4.7, f: 5.2 },
          { t: "cortado", i: 7.0, f: 7.5 }, // fora dos dois trechos
          { t: "Corre", i: 10.4, f: 10.8 },
          { t: "lá!", i: 11.0, f: 11.4 },
        ],
      },
    },
  };
}

describe("legenda do vídeo pronto: tempos levados pelo corte", () => {
  it("só entra a fala que ficou no corte, no tempo da linha do tempo (velocidade conta)", () => {
    const w = falaNoCorte(projeto());
    expect(w.map((x) => x.t)).toEqual(["Oi", "gente.", "Hoje", "tem", "promoção", "Corre", "lá!"]);
    expect(w[0].i).toBeCloseTo(0.2, 3);
    // 10,4 s da fonte no clipe 2: 4 + (10,4 - 10) / 2 = 4,2 s.
    expect(w[5].i).toBeCloseTo(4.2, 3);
    expect(w[6].f).toBeCloseTo(4.7, 3);
  });

  it("quebra no fim de frase e na pausa; tempo mínimo na tela sem passar da próxima", () => {
    const linhas = linhasDasPalavras(falaNoCorte(projeto()));
    expect(linhas.map((l) => l.texto)).toEqual(["Oi gente.", "Hoje tem promoção", "Corre lá!"]);
    linhas.forEach((l, k) => {
      expect(l.f).toBeGreaterThan(l.i);
      if (k + 1 < linhas.length) expect(l.f).toBeLessThanOrEqual(linhas[k + 1].i);
    });
  });

  it("a trilha de legenda revisada pela equipe vale mais que a fala", () => {
    const p = projeto();
    p.trilhas.push({ id: "l1", tipo: "legenda", clipes: [{ id: "x", fonte: null, inicio_s: 1, entrada_s: 0, saida_s: 2, velocidade: 1, texto: "Texto revisado" }] });
    expect(linhasDaTrilhaDeLegenda(p)).toEqual([{ texto: "Texto revisado", i: 1, f: 3 }]);
    expect(legendaDoFinal(p).origem).toBe("trilha");
    expect(legendaDoFinal(projeto()).origem).toBe("fala");
    expect(legendaDoFinal({ trilhas: [] }).linhas).toEqual([]);
  });

  it("amostra: só a janela, começando do zero", () => {
    const r = legendaDoFinal(projeto(), { inicio_s: 2.5, fim_s: 5 });
    expect(r.linhas[0].i).toBe(0);
    expect(recortarLinhas([{ texto: "a", i: 0, f: 1 }, { texto: "b", i: 10, f: 11 }], 0.5, 2)).toEqual([{ texto: "a", i: 0, f: 0.5 }]);
  });

  it("SRT e VTT no formato certo, ao lado do vídeo", () => {
    const linhas = [{ texto: "Oi --> gente", i: 1.5, f: 3.25 }, { texto: "Tchau", i: 3661.001, f: 3662 }];
    expect(srtDe(linhas)).toBe("1\n00:00:01,500 --> 00:00:03,250\nOi -> gente\n\n2\n01:01:01,001 --> 01:01:02,000\nTchau\n");
    expect(vttDe(linhas).startsWith("WEBVTT\n\n00:00:01.500 --> 00:00:03.250\n")).toBe(true);
    expect(caminhosDaLegenda("c/video/render/x.mp4")).toEqual({ srt: "c/video/render/x.srt", vtt: "c/video/render/x.vtt" });
  });

  it("a versão com a legenda gravada troca a trilha de legenda e o projeto continua válido", () => {
    const base = projetoDosTakes({ titulo: "T", formato: "9:16", fps: 30, roteiro_id: null, direcao: null, takes: [{ id: "a1", nome: "a.mp4", tipo: "bruto", storage_bucket: "mesa", storage_path: "c/a.mp4", duracao_s: 10, largura: 1080, altura: 1920 } as never], agora: "2026-10-02T10:00:00Z" });
    const com = projetoComLegenda(base as unknown as ProjetoParaLegenda, [{ texto: "Oi", i: 0.5, f: 1.5 }], "caixa", "lg1");
    const legendas = com.trilhas.filter((t) => t.tipo === "legenda");
    expect(legendas).toHaveLength(1);
    expect(legendas[0].clipes[0]).toMatchObject({ texto: "Oi", inicio_s: 0.5, entrada_s: 0, saida_s: 1, estilo: { preset: "caixa" } });
    const normal = normalizarProjeto(com);
    expect(normal && normal.trilhas.find((t) => t.tipo === "legenda")!.clipes[0].texto).toBe("Oi");
  });
});

describe("tratar vídeo: custo, partes e pedidos aos modelos", () => {
  it("motores com fonte e data; padrão VACE (tirar legenda) e Topaz (melhorar)", () => {
    expect(motorDoTratamento("tirar_legenda").id).toBe("wan-vace-inpainting");
    expect(motorDoTratamento("melhorar").id).toBe("topaz-proteus");
    expect(motorDoTratamento("melhorar", "wan-vace-inpainting").id).toBe("topaz-proteus");
    MOTORES_DO_TRATAMENTO.forEach((m) => {
      expect(m.fonte).toMatch(/^https:\/\//);
      expect(m.conferido_em).toBe("2026-10-02");
    });
  });

  it("partes iguais de até 8 s (VACE) e 30 s (Aleph); custo pelo segundo começado", () => {
    expect(partesDoTrecho(0, 20, 8)).toEqual([
      { inicio_s: 0, fim_s: 6.667 },
      { inicio_s: 6.667, fim_s: 13.333 },
      { inicio_s: 13.333, fim_s: 20 },
    ]);
    const vace = motorDoTratamento("tirar_legenda");
    expect(custoDoTratamento(vace, 0, 5).usd).toBeCloseTo(0.75, 4);
    expect(custoDoTratamento(vace, 0, 20).usd).toBeCloseTo(0.15 * 21, 4); // 3 partes de 6,67 s = 7 s cada
    const aleph = motorDoTratamento("tirar_legenda", "runway-aleph-2-legenda");
    expect(custoDoTratamento(aleph, 0, 1).usd).toBeCloseTo(0.56, 4); // mínimo de 2 s
  });

  it("Topaz cobra pela resolução de saída; dobro vai até 4K; SeedVR2 por megapixel", () => {
    const m = { largura: 1080, altura: 1920, fps: 30 };
    expect(precoDoTopaz(m, 1)).toBe(0.02);
    expect(precoDoTopaz({ largura: 720, altura: 1280 }, 1)).toBe(0.01);
    expect(fatorDoNivel("dobro", m)).toBe(2);
    expect(fatorDoNivel("dobro", { largura: 2160, altura: 3840 })).toBe(1);
    expect(precoDoTopaz(m, 2)).toBe(0.08);
    expect(precoDoTopaz({ ...m, fps: 60 }, 1)).toBe(0.04);
    expect(custoDoTratamento(motorDoTratamento("melhorar"), 0, 5, m, 1).usd).toBeCloseTo(0.1, 4);
    const seed = custoDoTratamento(motorDoTratamento("melhorar", "seedvr2-video"), 0, 5, { largura: 720, altura: 1280, fps: 30 }, 1);
    expect(seed.usd).toBeCloseTo(0.001 * ((720 * 1280 * 30) / 1e6) * 5, 3);
  });

  it("amostra de 3 a 8 s dentro do vídeo; o inteiro até 10 min", () => {
    expect(janelaDaAmostra(60, 10)).toEqual({ inicio_s: 10, fim_s: 15 });
    expect(janelaDaAmostra(60, 58)).toEqual({ inicio_s: 55, fim_s: 60 });
    expect(janelaDaAmostra(3)).toEqual({ inicio_s: 0, fim_s: 3 });
    expect(faltaNoTrecho("amostra", 0, 9)).toMatch(/8 s/);
    expect(faltaNoTrecho("final", 0, 700)).toMatch(/10 min/);
    expect(faltaNoTrecho("final", 0, 30)).toBeNull();
  });

  it("faixa da legenda com folga, dentro do quadro, de 3% a 60% da altura", () => {
    expect(regiaoValida({ x: 0.1, y: 0.8, w: 0.8, h: 0.1 })).toEqual({ x: 0.08, y: 0.78, w: 0.84, h: 0.14 });
    expect(regiaoValida({ x: 0, y: 0, w: 1, h: 0.9 })).toBeNull();
    expect(regiaoValida({ x: "a" })).toBeNull();
  });

  it("pedidos: VACE com máscara, Aleph pela instrução, Topaz sem alisar a pele, SeedVR2 fiel", () => {
    const vace = corpoDoTratamento(motorDoTratamento("tirar_legenda"), { parte_url: "https://u/p.mp4", mascara_url: "https://u/m.mp4" });
    expect(vace).toMatchObject({ video_url: "https://u/p.mp4", mask_video_url: "https://u/m.mp4", match_input_num_frames: true, match_input_frames_per_second: true });
    expect(() => corpoDoTratamento(motorDoTratamento("tirar_legenda"), { parte_url: "https://u/p.mp4" })).toThrow(/máscara/);
    const aleph = corpoDoTratamento(motorDoTratamento("tirar_legenda", "runway-aleph-2-legenda"), { parte_url: "https://u/p.mp4" });
    expect(aleph).toMatchObject({ model: "aleph2", videoUri: "https://u/p.mp4" });
    expect(String(aleph.promptText)).toMatch(/subtitles/);
    expect(String(aleph.promptText).length).toBeLessThanOrEqual(1000);
    const topaz = corpoDoTratamento(motorDoTratamento("melhorar"), { parte_url: "https://u/p.mp4", fator: 2 });
    expect(topaz).toMatchObject({ model: "Proteus", upscale_factor: 2, noise: 0, H264_output: true });
    expect(Number(topaz.grain)).toBeGreaterThan(0);
    expect(corpoDoTratamento(motorDoTratamento("melhorar", "seedvr2-video"), { parte_url: "https://u/p.mp4" })).toMatchObject({ upscale_mode: "factor", upscale_factor: 1, output_format: "X264 (.mp4)" });
  });

  it("nome e pasta do vídeo novo: o antes com o sufixo, na pasta Antes e depois ao lado", () => {
    expect(nomeDoTratado("Ana.mov", "tirar_legenda")).toBe("Ana (sem legenda).mp4");
    expect(nomeDoTratado("Ana (sem legenda).mp4", "melhorar")).toBe("Ana (melhorado).mp4");
    expect(pastaDoTratado("Ana / Brutos")).toBe("Ana / Antes e depois");
    expect(pastaDoTratado("Brutos / Cena 02")).toBe("Antes e depois");
    expect(pastaDoTratado(null)).toBe("Antes e depois");
  });
});

describe("tratar vídeo: amostra -> comparar -> inteiro (sem laço, provedor simulado)", () => {
  const envio = (estado: "enviado" | "gerando" | "baixando" | "pronto" | "erro", extra: Record<string, unknown> = {}) => ({
    parte: 1,
    motor: "wan-vace-inpainting",
    provedor: "fal" as const,
    endpoint: "fal-ai/wan-vace-14b/inpainting",
    request_id: "r1",
    status_url: "https://queue.fal.run/x/status",
    response_url: "https://queue.fal.run/x",
    estado,
    enviado_em: "2026-10-02T10:00:00Z",
    consultado_em: null,
    posicao: null,
    erro: null,
    custo_previsto_usd: 0.75,
    custo_usd: null,
    uso_id: null,
    storage_path: null,
    ...extra,
  });

  it("preparo -> enviar -> consultar -> compor -> concluir; a amostra espera o inteiro", () => {
    const p: PassosDaFase = { inicio_s: 0, fim_s: 5, motor: "wan-vace-inpainting", preparo: { render_id: "r" } };
    expect(proximoPassoDoTratamento("preparando", p, null)).toEqual({ passo: "esperar_preparo" });
    expect(proximoPassoDoTratamento("preparando", p, { estado: "rodando" })).toEqual({ passo: "esperar_preparo" });
    expect(proximoPassoDoTratamento("preparando", p, { estado: "pronto" })).toEqual({ passo: "enviar" });
    expect(proximoPassoDoTratamento("gerando", { ...p, envios: [envio("gerando")] }, null)).toEqual({ passo: "consultar" });
    expect(proximoPassoDoTratamento("gerando", { ...p, envios: [envio("pronto"), { ...envio("baixando"), parte: 2 }] }, null)).toEqual({ passo: "consultar" });
    expect(proximoPassoDoTratamento("gerando", { ...p, envios: [envio("pronto")] }, null)).toEqual({ passo: "compor" });
    expect(proximoPassoDoTratamento("compondo", p, { estado: "pronto" })).toEqual({ passo: "concluir" });
    expect(estadoDepoisDe("amostra")).toBe("amostra");
    expect(estadoDepoisDe("final")).toBe("pronto");
  });

  it("erro do worker ou do provedor encerra com o motivo (nada é refeito)", () => {
    const p: PassosDaFase = { inicio_s: 0, fim_s: 5, motor: "x" };
    expect(proximoPassoDoTratamento("preparando", p, { estado: "erro", erro: "ffmpeg" })).toMatchObject({ passo: "erro" });
    const d = proximoPassoDoTratamento("gerando", { ...p, envios: [envio("erro", { erro: "O provedor recusou." })] }, null);
    expect(d).toEqual({ passo: "erro", motivo: "O provedor recusou." });
    expect(proximoPassoDoTratamento("compondo", p, { estado: "cancelado" })).toMatchObject({ passo: "erro" });
  });

  it("o inteiro só depois da amostra; nada começa no meio do andamento", () => {
    expect(podeComecar("final", "amostra", false)).toMatch(/amostra/);
    expect(podeComecar("final", "amostra", true)).toBeNull();
    expect(podeComecar("final", "gerando", true)).toMatch(/andando/);
    expect(podeComecar("final", "erro", true)).toBeNull();
    expect(podeComecar("final", "pronto", true)).toMatch(/pronto/);
    expect(podeComecar("amostra", null, false)).toBeNull();
  });

  it("custo cobrado soma só os envios com uso registrado, nas duas fases", () => {
    const a = { inicio_s: 0, fim_s: 5, motor: "x", envios: [envio("pronto", { uso_id: "u1", custo_usd: 0.75 })] };
    const f = { inicio_s: 0, fim_s: 20, motor: "x", envios: [envio("pronto", { uso_id: "u2", custo_usd: 1.05 }), envio("gerando", { custo_usd: 1.05 })] };
    expect(custoCobrado([a, f])).toBeCloseTo(1.8, 4);
    expect(textoDoEstadoDoTratamento("gerando", "final", f)).toBe("Tratando (1 de 2 partes)");
    expect(textoDoEstadoDoTratamento("compondo", "amostra", a)).toMatch(/áudio original/);
  });
});

describe("achar a legenda gravada nos quadros (sem custo)", () => {
  /** Quadro sintético: fundo com gradiente suave e, se pedido, "letras" brancas com contorno numa faixa. */
  function quadro(W: number, H: number, legenda: { y0: number; y1: number; desloca: number } | null, ruido = 0): QuadroEmLuma {
    const luma = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) luma[y * W + x] = 60 + Math.round((40 * x) / W) + ((x * 7 + y * 13 + ruido) % 5);
    if (legenda) {
      for (let y = legenda.y0; y < legenda.y1; y++) {
        for (let x = Math.floor(W * 0.2); x < Math.floor(W * 0.8); x++) {
          const k = (x + legenda.desloca) % 9;
          luma[y * W + x] = k < 3 ? 245 : k < 5 ? 15 : luma[y * W + x];
        }
      }
    }
    return { largura: W, altura: H, luma };
  }

  it("acha a faixa embaixo, que muda entre os quadros", () => {
    const W = 120;
    const H = 200;
    const quadros = Array.from({ length: 8 }, (_, k) => quadro(W, H, { y0: 160, y1: 174, desloca: k * 2 }, k));
    const r = acharLegenda(quadros);
    expect(r).not.toBeNull();
    expect(r!.regiao.y).toBeGreaterThan(0.75);
    expect(r!.regiao.y).toBeLessThan(0.82);
    expect(r!.regiao.y + r!.regiao.h).toBeGreaterThan(0.85);
    expect(r!.regiao.x).toBeLessThan(0.2);
    expect(r!.regiao.w).toBeGreaterThan(0.55);
    expect(r!.parado).toBe(false);
    expect(r!.confianca).toBeGreaterThan(0.6);
  });

  it("sem texto, nada; texto parado no meio do quadro não é legenda", () => {
    expect(acharLegenda(Array.from({ length: 6 }, (_, k) => quadro(120, 200, null, k)))).toBeNull();
    expect(acharLegenda(Array.from({ length: 6 }, (_, k) => quadro(120, 200, { y0: 90, y1: 104, desloca: 0 }, k)))).toBeNull();
    const parado = acharLegenda(Array.from({ length: 6 }, (_, k) => quadro(120, 200, { y0: 160, y1: 174, desloca: 0 }, k)));
    expect(parado && parado.parado).toBe(true);
    expect(acharLegenda([])).toBeNull();
  });
});

describe("worker: preparar e montar o tratamento", () => {
  it("perfil fiel não reduz; padrão e Aleph usam o preparo da troca de cenário", () => {
    const fiel = argsDaParte("in.mov", "out.mp4", 2, 5, "fiel");
    expect(fiel.join(" ")).toMatch(/-crf 14/);
    expect(fiel.join(" ")).not.toMatch(/fps=30/);
    expect(argsDaParte("in.mov", "out.mp4", 2, 5, "padrao").join(" ")).toMatch(/fps=30/);
    expect(argsDaParte("in.mov", "out.mp4", 2, 5, "aleph").join(" ")).toMatch(/-maxrate 3M/);
  });

  it("máscara: preto do tamanho da parte com a faixa em branco", () => {
    const a = argsDaMascara("m.mp4", 720, 1280, 6.5, { x: 0.1, y: 0.8, w: 0.8, h: 0.1 });
    expect(a.join(" ")).toMatch(/color=c=black:s=720x1280:r=30:d=6\.500/);
    expect(a.join(" ")).toMatch(/drawbox=x=72:y=1024:w=576:h=128:color=white:t=fill/);
  });

  it("tirar legenda: só a faixa da IA (borda suave) sobre o original; melhorar: o tamanho do modelo", () => {
    const f = filtroDoTratamento({ acao: "tirar_legenda", partes: 2, W: 1080, H: 1920, duracao_s: 12, regiao: { x: 0, y: 0.8, w: 1, h: 0.12 } });
    expect(f).toMatch(/\[p1\]\[p2\]concat=n=2:v=1:a=0\[ia\]/);
    expect(f).toMatch(/alphamerge/);
    expect(f).toMatch(/boxblur/);
    expect(f).toMatch(/\[0:v\]\[faixa\]overlay=0:0/);
    expect(() => filtroDoTratamento({ acao: "tirar_legenda", partes: 1, W: 1080, H: 1920, duracao_s: 5, regiao: null })).toThrow(/faixa/);
    const m = filtroDoTratamento({ acao: "melhorar", partes: 1, W: 1080, H: 1920, duracao_s: 5, regiao: null, Wia: 2160, Hia: 3840 });
    expect(m).toMatch(/scale=2160:3840/);
    expect(m).not.toMatch(/overlay/);
    expect(regiaoDoPedido({ x: 0, y: 0.8, w: 1, h: 0.2 })).toEqual({ x: 0, y: 0.8, w: 1, h: 0.2 });
    expect(regiaoDoPedido({ x: 0, y: 2, w: 1, h: 0.2 })).toBeNull();
  });
});

describe("guardas: banco, função e worker", () => {
  const sql = ler("supabase/migrations/20261002160000_edicao_organizar.sql");
  it("migration: RLS por cliente, escrita só pelo servidor, tipo tratamento só para worker com trt-, cron acorda", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.video_tratamentos/);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.video_tratamentos FROM authenticated/);
    expect(sql).toMatch(/can_access_client\(client_id\)/);
    expect(sql).toMatch(/'render_final', 'amostra', 'onda', 'cena_hf', 'batidas', 'cenario', 'tratamento'/);
    expect(sql).toMatch(/_sabe_tratamento boolean := coalesce\(_versao, ''\) LIKE '%trt-%'/);
    expect(sql).toMatch(/AND \(p\.tipo <> 'tratamento' OR _sabe_tratamento\)/);
    // A reserva da nuvem (20261002100000) continua.
    expect(sql).toMatch(/_reservar boolean/);
    expect(sql).toMatch(/from public\.video_tratamentos\s+where estado in \('preparando', 'gerando', 'compondo'\)/);
    expect(sql).not.toMatch(/DROP TABLE|DELETE FROM/i);
  });

  it("worker sabe tratar e sobe a versão com trt-", () => {
    expect(ler("workers/render/principal.ts")).toMatch(/VERSAO_DO_WORKER = "[^"]*\+trt-1[^"]*"/);
    expect(ler("workers/render/trabalho.ts")).toMatch(/p\.tipo === "tratamento"/);
    expect(ler("workers/render/fila.ts")).toMatch(/"tratamento"/);
  });

  it("função: ações registradas, custo confirmado antes de gastar, chave só pelo nome", () => {
    const index = ler("supabase/functions/mesa-videos/index.ts");
    ["entrada_organizar_propor", "workspace_espelho_propor", "workspace_espelho_confirmar", "workspace_espelho_desfazer", "final_legenda_gerar", "final_legenda_versao", "tratamento_amostra", "tratamento_final", "tratamento_status", "tratamento_descartar"].forEach((a) => expect(index).toContain(`${a}:`));
    expect(index).toMatch(/tratamentosColetar\(baseDoCron\)/);
    const t = ler("supabase/functions/mesa-videos/tratamento.ts");
    expect(t).toMatch(/exigirConfirmacao\(b, custo\.usd, corpo\.custo_confirmado_usd/);
    expect(t).toMatch(/conferirSaldo/);
    expect(t).not.toMatch(/console\.(log|info)\([^)]*chave/);
    // O espelho no Workspace roda com a sessão de quem chamou e nunca copia arquivo.
    const e = ler("supabase/functions/mesa-videos/edicao.ts");
    expect(e).not.toMatch(/storage\.from\("workspace"\)/);
    expect(e).toMatch(/jevPerguntar\(perguntaDosPares/);
    expect(e).toMatch(/cobrarJev/);
  });
});
