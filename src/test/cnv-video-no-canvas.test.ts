import { describe, expect, it, vi } from "vitest";

// O cartão Vídeo chama a função mesa-videos; aqui ela é falsa e guarda os corpos.
const chamadas: Record<string, unknown>[] = [];
const respostas: Record<string, unknown> = {};
vi.mock("@/components/mesa-videos/videosApi", () => ({
  chamarMesaVideos: vi.fn(async (corpo: Record<string, unknown>) => {
    chamadas.push(corpo);
    const r = respostas[String(corpo.acao)];
    return typeof r === "function" ? (r as (c: unknown) => unknown)(corpo) : r;
  }),
}));
vi.mock("@/lib/mesa-videos/quadros", () => ({ quadroDoVideoNoStorage: vi.fn(async (cliente: string) => `${cliente}/video/quadros/ultimo-x.png`) }));
vi.mock("@/lib/mesa-videos/api", () => ({ novoUid: () => "uid-de-teste" }));

import { canvasVazio, corpoDoCanvas, ligar, normalizarCanvas, novoNo, podeLigar, type Canvas } from "@/components/mesa-foto/canvasApi";
import {
  animarCenasQueFaltam,
  animarResultado,
  bloqueiosDoVideo,
  conferirPedidosDoVideo,
  corpoDoGerarVideo,
  entradasDoVideo,
  gerarVideoDoCartao,
  midiasLigadasAoQuadro,
  modoDoVideo,
  quadroAoLado,
  videosDoResultado,
} from "@/components/mesa-foto/canvas/videoNoCanvas";
import { cenaNova } from "@/components/mesa-foto/canvas/historia";
import { lerDadosDoVideo, pedidoAtualizado, pedidoDoVideo, refDoPlano } from "../../supabase/functions/mesa-foto/modulos/video-do-canvas";
import { caminhosDeFora, normalizarCanvas as normalizarNaFuncao, TIPOS_DE_NO as TIPOS_NA_FUNCAO } from "../../supabase/functions/mesa-foto/canvas-regras";
import { quadroVazio } from "../../supabase/functions/mesa-foto/modulos/quadro-animado";

/**
 * Frente CNV (30/09): "falta funcionar o canvas nos vídeos". O cartão Vídeo
 * saiu do "em breve": recebe a foto de um Resultado (1º quadro), opcionalmente
 * o último quadro ou outro vídeo para continuar, e gera pela Mesa Vídeos com o
 * custo confirmado. O cartão Quadro recebe fotos e vídeos. A função valida.
 */

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const OUTRO = "22222222-2222-4222-8222-222222222222";
const IMG = "aaaaaaaa-0000-4000-8000-000000000001";
const PEDIDO = "cccccccc-0000-4000-8000-000000000001";
const ARQ = "dddddddd-0000-4000-8000-000000000001";

function resultadoComFoto(id: string, x = 0, extra: Record<string, unknown> = {}) {
  const n = novoNo("gerar", x, 0, { motores: ["m"], formato: "9:16", ...extra });
  return { ...n, id, dados: { ...n.dados, resultados: [{ geracao_id: `g-${id}`, imagem_id: IMG, storage_bucket: "mesa", storage_path: `${CLIENTE}/foto/canvas/${id}.png`, url: "", motor_id: "m", status: "gerada" as const, erro: "", custo_usd: 0.1, conferencia: null, criado_em: "", grupo: null, quadro: null, tipo: "foto" as const }] } };
}

function base(): Canvas {
  const s1 = resultadoComFoto("s1", 0, { cena: cenaNova(1, { titulo: "Chegada", acao: "Ela abre a caixa e sorri", narrativa: "Chegou o meu kit", cenario: "sala clara", enquadramento: "close" }) });
  const s2 = resultadoComFoto("s2", 0);
  return { ...canvasVazio(CLIENTE), id: "eeeeeeee-0000-4000-8000-000000000001", nos: [s1, s2] };
}

describe("cartão Vídeo: ligações", () => {
  it("Resultado entra no 1º e no último quadro (um de cada); Vídeo continua outro Vídeo sem laço; nada entra no Resultado", () => {
    let c = base();
    const v = novoNo("video", 600, 0, { video: lerDadosDoVideo({}) });
    const v2 = novoNo("video", 900, 0, { video: lerDadosDoVideo({}) });
    c = { ...c, nos: c.nos.concat([v, v2]) };
    expect(podeLigar(c, "s1", v.id, null, "inicio")).toBe("inicio");
    c = ligar(c, "s1", v.id, null, "inicio");
    expect(podeLigar(c, "s2", v.id, null, "inicio")).toBeNull();
    expect(podeLigar(c, "s2", v.id, null, "final")).toBe("final");
    expect(podeLigar(c, "s2", v.id)).toBe("final");
    c = ligar(c, "s2", v.id);
    expect(c.ligacoes.find((l) => l.de === "s2")!.entrada).toBe("final");
    expect(podeLigar(c, v.id, v2.id)).toBe("continuar");
    c = ligar(c, v.id, v2.id);
    expect(podeLigar(c, v2.id, v.id)).toBeNull();
    expect(podeLigar(c, v.id, "s1")).toBeNull();
    const produto = novoNo("produto", 0, 0, {});
    c = { ...c, nos: c.nos.concat([produto]) };
    expect(podeLigar(c, produto.id, v.id)).toBeNull();
    const q = novoNo("quadro", 1200, 0, { quadro: quadroVazio() });
    c = { ...c, nos: c.nos.concat([q]) };
    expect(podeLigar(c, "s1", q.id)).toBe("midia");
    expect(podeLigar(c, v.id, q.id)).toBe("midia");
    expect(podeLigar(c, produto.id, q.id)).toBeNull();
    expect(podeLigar(c, q.id, "s1")).toBeNull();
  });

  it("o que a tela salva passa na função (tipos video e quadro, ligação com o quadro) e volta igual", () => {
    let c = base();
    const v = novoNo("video", 600, 0, { video: lerDadosDoVideo({ motor: "seedance-2.5", duracao_s: 8, movimento: "orbitar", audio: true }), titulo: "Vídeo da chegada" });
    const q = novoNo("quadro", 900, 0, { quadro: quadroVazio("1:1") });
    c = { ...c, nos: c.nos.concat([v, q]) };
    c = ligar(c, "s1", v.id, null, "inicio");
    c = ligar(c, "s2", v.id, null, "final");
    c = ligar(c, v.id, q.id);
    const corpo = corpoDoCanvas(c);
    const naFuncao = normalizarNaFuncao(corpo);
    expect(TIPOS_NA_FUNCAO).toContain("video");
    expect(TIPOS_NA_FUNCAO).toContain("quadro");
    expect(naFuncao.nos.map((n) => n.tipo)).toEqual(["saida", "saida", "video", "quadro"]);
    expect(naFuncao.ligacoes.map((l) => l.quadro || null)).toEqual(["inicio", "final", null]);
    expect(naFuncao.nos[2].dados).toMatchObject({ motor: "seedance-2.5", duracao_s: 8, movimento: "orbitar", audio: true, titulo: "Vídeo da chegada" });
    const deVolta = normalizarCanvas({ ...corpo, nos: naFuncao.nos, ligacoes: naFuncao.ligacoes }, CLIENTE)!;
    expect(deVolta.nos.find((n) => n.id === v.id)!.dados.video).toMatchObject({ motor: "seedance-2.5", duracao_s: 8 });
    expect(deVolta.nos.find((n) => n.id === q.id)!.dados.quadro!.formato).toBe("1:1");
    expect(deVolta.ligacoes.map((l) => l.entrada)).toEqual(["inicio", "final", "midia"]);
  });

  it("a função recusa ligação errada e mídia de outro cliente", () => {
    expect(() => normalizarNaFuncao({ nos: [{ id: "v", tipo: "video" }, { id: "s", tipo: "saida" }], ligacoes: [{ de: "v", para: "s" }] })).toThrow(/Vídeo e Quadro não entram/);
    expect(() => normalizarNaFuncao({ nos: [{ id: "p", tipo: "produto" }, { id: "v", tipo: "video" }], ligacoes: [{ de: "p", para: "v" }] })).toThrow(/O Vídeo recebe/);
    expect(() => normalizarNaFuncao({ nos: [{ id: "a", tipo: "saida" }, { id: "b", tipo: "saida" }, { id: "v", tipo: "video" }], ligacoes: [{ de: "a", para: "v" }, { de: "b", para: "v" }] })).toThrow(/já tem a foto/);
    expect(() => normalizarNaFuncao({ nos: [{ id: "v1", tipo: "video" }, { id: "v2", tipo: "video" }], ligacoes: [{ de: "v1", para: "v2" }, { de: "v2", para: "v1" }] })).toThrow(/laço|continuar/);
    const c = normalizarNaFuncao({ nos: [{ id: "q", tipo: "quadro", dados: { quadro: { camadas: [{ tipo: "imagem", midia: { bucket: "mesa", caminho: `${OUTRO}/x.png` } }] } } }] });
    expect(caminhosDeFora(c, CLIENTE)).toEqual([`${OUTRO}/x.png`]);
    expect(caminhosDeFora(c, OUTRO)).toEqual([]);
  });
});

describe("cartão Vídeo: pedido à Mesa Vídeos", () => {
  it("pedido escrito pelo código: ação, lugar, câmera, fala e a regra de continuidade", () => {
    const p = pedidoDoVideo({ cena: { numero: 1, titulo: "", acao: "Ela abre a caixa.", narrativa: 'Chegou "hoje"', cenario: "sala", enquadramento: "close" }, movimento: "orbitar", audio: true, final: true });
    expect(p).toMatch(/^Ela abre a caixa\. Lugar: sala\. Câmera: a câmera gira/);
    expect(p).toContain("Termine exatamente no quadro final");
    expect(p).toContain("Chegou 'hoje'");
    expect(p).toContain("Mantenha a pessoa");
    expect(pedidoDoVideo({ cena: null, movimento: "x", audio: false })).toContain("quase parada");
    expect(refDoPlano(3)).toBe("c3");
    expect(refDoPlano(null)).toBeNull();
  });

  it("cena_gerar com o 1º quadro (e o último), plano da cena e o custo confirmado", () => {
    let c = base();
    const v = novoNo("video", 600, 0, { video: lerDadosDoVideo({ motor: "kling-3-pro", duracao_s: 5, formato: "9:16", movimento: "aproximar" }) });
    c = { ...c, nos: c.nos.concat([v]) };
    c = ligar(c, "s1", v.id, null, "inicio");
    let e = entradasDoVideo(c, v.id);
    expect(modoDoVideo(e)).toBe("primeiro_quadro");
    expect(bloqueiosDoVideo(e, v.dados.video!)).toEqual([]);
    const corpo = corpoDoGerarVideo({ clientId: CLIENTE, canvas: c, entradas: e, dados: v.dados.video!, titulo: "T", uid: "u", custoConfirmado: 0.84 });
    expect(corpo).toMatchObject({ acao: "cena_gerar", client_id: CLIENTE, motor: "kling-3-pro", modo: "primeiro_quadro", tipo: "gerar_plano", plano_ref: "c1", quadro_inicial_path: `${CLIENTE}/foto/canvas/s1.png`, duracao_s: 5, formato: "9:16", uid: "u", custo_confirmado_usd: 0.84 });
    expect(String(corpo.prompt)).toContain("Ela abre a caixa e sorri");
    c = ligar(c, "s2", v.id, null, "final");
    e = entradasDoVideo(c, v.id);
    const comFinal = corpoDoGerarVideo({ clientId: CLIENTE, canvas: c, entradas: e, dados: { ...v.dados.video!, prompt: "meu pedido" }, titulo: "T", uid: "u", custoConfirmado: 1 });
    expect(comFinal).toMatchObject({ modo: "primeiro_ultimo", quadro_final_path: `${CLIENTE}/foto/canvas/s2.png`, prompt: "meu pedido" });
  });

  it("sem foto ligada ou sem motor, diz o motivo antes (não gera)", async () => {
    const c = { ...base(), nos: base().nos.concat([novoNo("video", 0, 0, { video: lerDadosDoVideo({}) })]) };
    const v = c.nos[2];
    expect(bloqueiosDoVideo(entradasDoVideo(c, v.id), v.dados.video!)[0]).toMatch(/Ligue a foto/);
    await expect(gerarVideoDoCartao({ clientId: CLIENTE, canvas: c, videoId: v.id, dados: v.dados.video!, titulo: "T", custoConfirmado: 1 })).rejects.toThrow(/Ligue a foto/);
    expect(chamadas).toHaveLength(0);
  });

  it("gera (uma chamada), guarda o pedido no cartão e o andamento volta pelo gerar_status", async () => {
    chamadas.length = 0;
    respostas.cena_gerar = { ok: true, pedido_id: PEDIDO, custo_estimado: { usd: 0.84 } };
    let c = base();
    const v = novoNo("video", 600, 0, { video: lerDadosDoVideo({ motor: "kling-3-pro" }) });
    c = ligar({ ...c, nos: c.nos.concat([v]) }, "s1", v.id, null, "inicio");
    const p = await gerarVideoDoCartao({ clientId: CLIENTE, canvas: c, videoId: v.id, dados: v.dados.video!, titulo: "Vídeo", custoConfirmado: 0.84 });
    expect(chamadas).toHaveLength(1);
    expect(p).toMatchObject({ pedido_id: PEDIDO, uid: "uid-de-teste", estado: "enviado", custo_usd: 0.84, quadro_path: `${CLIENTE}/foto/canvas/s1.png`, videos: [] });
    respostas.gerar_status = { pedidos: [{ id: PEDIDO, estado: "pronto", resultado: { envios: [{ n: 1, estado: "pronto", storage_path: `${CLIENTE}/video/gerados/${PEDIDO}-1.mp4`, arquivo_id: ARQ, custo_usd: 0.84 }] } }] };
    const novos = await conferirPedidosDoVideo({ ...v.dados.video!, pedidos: [p] });
    expect(chamadas[1]).toEqual({ acao: "gerar_status", pedido_id: PEDIDO });
    expect(novos[0]).toMatchObject({ estado: "pronto", videos: [{ n: 1, arquivo_id: ARQ, storage_path: `${CLIENTE}/video/gerados/${PEDIDO}-1.mp4` }] });
    // Pronto não consulta de novo.
    await conferirPedidosDoVideo({ ...v.dados.video!, pedidos: novos });
    expect(chamadas).toHaveLength(2);
  });

  it("continuar: o último quadro sai no navegador e vai no continuar_video", async () => {
    chamadas.length = 0;
    respostas.continuar_video = { ok: true, pedido_id: PEDIDO, via: "ultimo_quadro" };
    let c = base();
    const pronto = lerDadosDoVideo({ motor: "kling-3-pro", pedidos: [{ pedido_id: PEDIDO, estado: "pronto", videos: [{ n: 1, arquivo_id: ARQ, storage_path: `${CLIENTE}/video/gerados/a.mp4` }] }] });
    const v1 = novoNo("video", 600, 0, { video: pronto });
    const v2 = novoNo("video", 900, 0, { video: lerDadosDoVideo({ motor: "kling-3-pro" }) });
    c = ligar({ ...c, nos: c.nos.concat([v1, v2]) }, v1.id, v2.id);
    const e = entradasDoVideo(c, v2.id);
    expect(modoDoVideo(e)).toBe("continuar");
    await gerarVideoDoCartao({ clientId: CLIENTE, canvas: c, videoId: v2.id, dados: v2.dados.video!, titulo: "T", custoConfirmado: 1 });
    expect(chamadas[0]).toMatchObject({ acao: "continuar_video", arquivo_id: ARQ, quadro_path: `${CLIENTE}/video/quadros/ultimo-x.png` });
  });

  it("estado do pedido: erro do provedor vira o motivo; sem mudança, nada muda", () => {
    const p = lerDadosDoVideo({ pedidos: [{ pedido_id: PEDIDO, estado: "gerando" }] }).pedidos[0];
    const erro = pedidoAtualizado(p, { estado: "erro", resultado: { envios: [{ n: 1, estado: "erro", erro: "Sem crédito no provedor." }] } });
    expect(erro).toMatchObject({ estado: "erro", erro: "Sem crédito no provedor." });
    expect(pedidoAtualizado(p, null)).toBe(p);
  });
});

describe("cartão Vídeo: animar a cena e o Quadro", () => {
  it("Animar cria o cartão Vídeo ao lado, ligado ao 1º quadro, com o movimento pelo enquadramento; não duplica", () => {
    const c = base();
    const r = animarResultado(c, "s1", "kling-3-pro");
    expect(r.novo).toBe(true);
    const v = r.canvas.nos.find((n) => n.id === r.videoId)!;
    expect(v.tipo).toBe("video");
    expect(v.dados.video).toMatchObject({ motor: "kling-3-pro", movimento: "aproximar", audio: true, formato: "9:16" });
    expect(v.dados.titulo).toBe("Vídeo: Chegada");
    expect(r.canvas.ligacoes).toEqual([expect.objectContaining({ de: "s1", para: v.id, entrada: "inicio" })]);
    const de_novo = animarResultado(r.canvas, "s1", null);
    expect(de_novo.novo).toBe(false);
    expect(de_novo.videoId).toBe(v.id);
    expect(videosDoResultado(r.canvas, "s1")).toEqual({ cartoes: 1, prontos: 0, andamento: 0 });
  });

  it("Animar as que faltam: um cartão por cena com foto", () => {
    const c = base();
    const r = animarCenasQueFaltam(c, null);
    expect(r.criados).toBe(1);
    expect(animarCenasQueFaltam(r.canvas, null).criados).toBe(0);
  });

  it("Quadro ligado recebe a foto do Resultado e o vídeo pronto do cartão Vídeo", () => {
    let c = base();
    const pronto = lerDadosDoVideo({ pedidos: [{ pedido_id: PEDIDO, estado: "pronto", videos: [{ n: 1, arquivo_id: ARQ, storage_path: `${CLIENTE}/video/gerados/a.mp4` }] }] });
    const v = novoNo("video", 600, 0, { video: pronto });
    c = { ...c, nos: c.nos.concat([v]) };
    const r = quadroAoLado(c, v.id, { quadro: quadroVazio() });
    c = ligar(r.canvas, "s2", r.quadroId);
    const m = midiasLigadasAoQuadro(c, r.quadroId);
    expect(m.map((x) => x.caminho)).toEqual([`${CLIENTE}/video/gerados/a.mp4`, `${CLIENTE}/foto/canvas/s2.png`]);
    expect(m[0].arquivo_id).toBe(ARQ);
  });
});
