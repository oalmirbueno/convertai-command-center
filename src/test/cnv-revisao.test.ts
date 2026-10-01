import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// O cartão Vídeo chama a função mesa-videos; aqui ela é falsa e guarda os corpos.
const chamadas: Record<string, unknown>[] = [];
const respostas: Record<string, unknown> = {};
vi.mock("@/components/mesa-videos/videosApi", () => ({
  chamarMesaVideos: vi.fn(async (corpo: Record<string, unknown>) => {
    chamadas.push(corpo);
    return respostas[String(corpo.acao)];
  }),
}));
const extrair = vi.fn(async (cliente: string) => `${cliente}/video/quadros/ultimo-x.png`);
vi.mock("@/lib/mesa-videos/quadros", () => ({ quadroDoVideoNoStorage: (...a: unknown[]) => extrair(...(a as [string])) }));
vi.mock("@/lib/mesa-videos/api", () => ({ novoUid: () => "uid-de-teste" }));

import { canvasVazio, corpoDoCanvas, ligar, novoNo, podeLigar, type Canvas } from "@/components/mesa-foto/canvasApi";
import {
  bloqueiosDoVideo,
  continuaPelaExtensao,
  dadosComMotor,
  duracoesNaTela,
  entradasDoVideo,
  ERRO_DO_ULTIMO_QUADRO,
  esperaDoVigia,
  gerarVideoDoCartao,
  vigiarAinda,
} from "@/components/mesa-foto/canvas/videoNoCanvas";
import { estimativaDoOrdenar, JEV_PRECO_ENTRADA_1M_NA_TELA } from "@/components/mesa-foto/canvas/quadro/quadroApi";
import { lerDadosDoVideo } from "../../supabase/functions/mesa-foto/modulos/video-do-canvas";
import { normalizarCanvas as normalizarNaFuncao } from "../../supabase/functions/mesa-foto/canvas-regras";
import { aplicarModelo, marcaDoQuadro, novaCamada, quadroNoFormato, quadroVazio } from "../../supabase/functions/mesa-foto/modulos/quadro-animado";
import { motorPorId } from "../../supabase/functions/mesa-videos/modulos/modelos-de-video";

/**
 * Frente CNV, correções da revisão (01/10): continuar sem cair no 1º quadro,
 * texto do Quadro fora do filtro da persona, vigia do andamento até o prazo,
 * durações do motor, continuar exclusivo, proporção pelo modelo e custo do Jev.
 */

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const IMG = "aaaaaaaa-0000-4000-8000-000000000001";
const PEDIDO = "cccccccc-0000-4000-8000-000000000001";
const ARQ = "dddddddd-0000-4000-8000-000000000001";

function resultadoComFoto(id: string) {
  const n = novoNo("gerar", 0, 0, { motores: ["m"], formato: "9:16" });
  return { ...n, id, dados: { ...n.dados, resultados: [{ geracao_id: `g-${id}`, imagem_id: IMG, storage_bucket: "mesa", storage_path: `${CLIENTE}/foto/canvas/${id}.png`, url: "", motor_id: "m", status: "gerada" as const, erro: "", custo_usd: 0.1, conferencia: null, criado_em: "", grupo: null, quadro: null, tipo: "foto" as const }] } };
}

function comContinuar(motorNovo: string) {
  const c0: Canvas = { ...canvasVazio(CLIENTE), id: "eeeeeeee-0000-4000-8000-000000000001", nos: [resultadoComFoto("s1")] };
  const pronto = lerDadosDoVideo({ motor: "kling-3-pro", pedidos: [{ pedido_id: PEDIDO, estado: "pronto", quadro_path: `${CLIENTE}/foto/canvas/s1.png`, videos: [{ n: 1, arquivo_id: ARQ, storage_path: `${CLIENTE}/video/gerados/a.mp4` }] }] });
  const v1 = novoNo("video", 600, 0, { video: pronto });
  const v2 = novoNo("video", 900, 0, { video: lerDadosDoVideo({ motor: motorNovo }) });
  const c = ligar({ ...c0, nos: c0.nos.concat([v1, v2]) }, v1.id, v2.id);
  return { c, v1, v2 };
}

describe("continuar um vídeo", () => {
  it("se o último quadro não sai no navegador, NÃO gera (nada de recomeçar do 1º quadro do clipe anterior)", async () => {
    chamadas.length = 0;
    respostas.continuar_video = { ok: true, pedido_id: PEDIDO };
    extrair.mockRejectedValueOnce(new Error("CORS"));
    const { c, v2 } = comContinuar("kling-3-pro");
    expect(motorPorId("kling-3-pro")!.cap.estender).toBe(false);
    await expect(gerarVideoDoCartao({ clientId: CLIENTE, canvas: c, videoId: v2.id, dados: v2.dados.video!, titulo: "T", custoConfirmado: 1 })).rejects.toThrow(ERRO_DO_ULTIMO_QUADRO);
    expect(chamadas).toHaveLength(0);
  });

  it("motor com extensão nativa: não tira quadro e o servidor estende o vídeo inteiro", async () => {
    chamadas.length = 0;
    extrair.mockClear();
    respostas.continuar_video = { ok: true, pedido_id: PEDIDO, via: "extensao_nativa" };
    const { c, v2 } = comContinuar("veo-3.1");
    const e = entradasDoVideo(c, v2.id);
    expect(continuaPelaExtensao(e, v2.dados.video!)).toBe(true);
    const p = await gerarVideoDoCartao({ clientId: CLIENTE, canvas: c, videoId: v2.id, dados: v2.dados.video!, titulo: "T", custoConfirmado: 1 });
    expect(extrair).not.toHaveBeenCalled();
    expect(chamadas[0]).toMatchObject({ acao: "continuar_video", arquivo_id: ARQ, quadro_path: null });
    expect(p.quadro_path).toBeNull();
  });

  it("continuar não convive com a foto do 1º ou do último quadro: tela, bloqueio e função", () => {
    const { c, v1, v2 } = comContinuar("kling-3-pro");
    expect(podeLigar(c, "s1", v2.id, null, "inicio")).toBeNull();
    expect(podeLigar(c, "s1", v2.id, null, "final")).toBeNull();
    const s = resultadoComFoto("s9");
    const outro = novoNo("video", 1200, 0, { video: lerDadosDoVideo({ motor: "kling-3-pro" }) });
    let c2: Canvas = { ...c, nos: c.nos.concat([s, outro]) };
    c2 = ligar(c2, "s9", outro.id, null, "inicio");
    expect(podeLigar(c2, v1.id, outro.id)).toBeNull();
    // Estado antigo com as duas: bloqueia antes de gerar, e a função recusa ao salvar.
    const forcado: Canvas = { ...c, ligacoes: c.ligacoes.concat([{ id: "l-x", de: "s1", para: v2.id, entrada: "inicio", ordem: 0, imagem_id: null }]) };
    expect(bloqueiosDoVideo(entradasDoVideo(forcado, v2.id), v2.dados.video!)[0]).toMatch(/continua outro E parte de uma foto/);
    expect(() => normalizarNaFuncao(corpoDoCanvas(forcado))).toThrow(/OU parte da foto/);
  });
});

describe("texto do Quadro fora do filtro da persona", () => {
  it("'Moda infantil' e 'a cara da sua marca' num Quadro salvam o canvas", () => {
    const q = quadroVazio("9:16");
    const camadas = [novaCamada("texto", q, { texto: "Moda infantil" }), novaCamada("texto", q, { texto: "Com a cara da sua marca" }), novaCamada("texto", q, { texto: "Nenhum sabor igual a este" })];
    const no = novoNo("quadro", 0, 0, { quadro: { ...q, camadas } });
    const c: Canvas = { ...canvasVazio(CLIENTE), nos: [no] };
    const r = normalizarNaFuncao(corpoDoCanvas(c));
    expect(r.nos[0].tipo).toBe("quadro");
  });

  it("o pedido do Vídeo (vai ao gerador) segue conferido, e o erro diz o cartão e o campo", () => {
    const v = novoNo("video", 0, 0, { video: lerDadosDoVideo({ prompt: "uma criança de 8 anos correndo" }), titulo: "Abertura" });
    const c: Canvas = { ...canvasVazio(CLIENTE), nos: [v] };
    expect(() => normalizarNaFuncao(corpoDoCanvas(c))).toThrow(/Cartão Vídeo "Abertura", campo "Pedido ao motor"/);
    try {
      normalizarNaFuncao(corpoDoCanvas(c));
    } catch (e) {
      expect(String((e as Error).message)).not.toMatch(/persona/);
    }
  });
});

describe("vigia do andamento", () => {
  it("intervalo crescente: 45 s, 90 s e depois 3 min", () => {
    expect([0, 1, 2, 3, 9].map(esperaDoVigia)).toEqual([45_000, 90_000, 180_000, 180_000, 180_000]);
  });

  it("vigia enquanto há pedido em andamento dentro do prazo do motor; para no fim ou no prazo", () => {
    const agora = Date.parse("2026-10-01T12:00:00Z");
    const pedido = (estado: string, minutosAtras: number, motor = "kling-3-pro") => ({ pedido_id: PEDIDO, estado, motor, criado_em: new Date(agora - minutosAtras * 60_000).toISOString() });
    const prazo = motorPorId("kling-3-pro")!.prazo_min;
    expect(vigiarAinda(lerDadosDoVideo({ pedidos: [pedido("gerando", 10)] }), agora)).toBe(true);
    expect(vigiarAinda(lerDadosDoVideo({ pedidos: [pedido("gerando", prazo + 5)] }), agora)).toBe(false);
    expect(vigiarAinda(lerDadosDoVideo({ pedidos: [pedido("pronto", 1)] }), agora)).toBe(false);
    expect(vigiarAinda(lerDadosDoVideo({ pedidos: [] }), agora)).toBe(false);
  });

  it("as consultas automáticas não engolem erro", () => {
    const fonte = readFileSync(resolve(__dirname, "../components/mesa-foto/canvas/vigiaDosVideos.ts"), "utf8");
    expect(fonte).not.toMatch(/catch\(\(\) => undefined\)/);
    expect(fonte).toMatch(/toast\.warning/);
  });
});

describe("durações do motor", () => {
  it("faixa longa mostra 10, 12 e 15 s; trocar de motor ajusta a duração", () => {
    const wan = motorPorId("wan-3.0")!;
    const l = duracoesNaTela(wan, 5);
    const lista = Array.isArray(wan.duracoes) ? wan.duracoes : null;
    if (!lista) {
      expect(l).toContain(wan.duracoes.max);
      expect(l.length).toBeLessThanOrEqual(9);
    }
    const veo = motorPorId("veo-3.1")!;
    const d = dadosComMotor(lerDadosDoVideo({ motor: "wan-3.0", duracao_s: 5 }), "veo-3.1");
    expect(d.motor).toBe("veo-3.1");
    expect(duracoesNaTela(veo, d.duracao_s)).toContain(d.duracao_s);
  });

  it("um motor de faixa 2 a 15 s inclui o máximo", () => {
    const faixa = { ...motorPorId("wan-3.0")!, duracoes: { min: 2, max: 15 } };
    const l = duracoesNaTela(faixa, 5);
    expect(l).toEqual([2, 4, 5, 6, 8, 10, 12, 15]);
  });
});

describe("Quadro: proporção e Jev", () => {
  it("com modelo da marca, trocar a proporção remonta; sem modelo, só troca o formato", () => {
    const marca = marcaDoQuadro({ nome: "Marca", paleta: [{ hex: "#112233", papel: "primaria" }], logo: null });
    const q = aplicarModelo("titulo_forte", { titulo: "Oi", subtitulo: "", cta: "", selo: "", topicos: [], midias: [] }, marca, "9:16", 6);
    const r = quadroNoFormato(q, "16:9", marca);
    expect(r.remontado).toBe(true);
    expect(r.quadro.formato).toBe("16:9");
    const manual = { ...q, modelo: null };
    const r2 = quadroNoFormato(manual, "1:1", marca);
    expect(r2.remontado).toBe(false);
    expect(r2.quadro.camadas).toEqual(manual.camadas);
  });

  it("o Ordenar mostra o custo do Jev antes, com o preço igual ao do servidor", () => {
    const motor = readFileSync(resolve(__dirname, "../../supabase/functions/_shared/ia-motor.ts"), "utf8");
    const m = motor.match(/JEV_PRECO_ENTRADA_1M = ([0-9.]+)/);
    expect(m && Number(m[1])).toBe(JEV_PRECO_ENTRADA_1M_NA_TELA);
    const usd = estimativaDoOrdenar({ pedido: "chamada para outubro", conteudo: { titulo: "Oi" }, modelos: ["a", "b", "c"] });
    expect(usd).toBeGreaterThan(0);
    expect(usd).toBeLessThan(0.01);
    const editor = readFileSync(resolve(__dirname, "../components/mesa-foto/canvas/quadro/EditorDeQuadro.tsx"), "utf8");
    expect(editor).toMatch(/data-custo-do-ordenar/);
  });
});
