import { createElement as h } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import {
  atende,
  chavesQueFaltam,
  custoDaVariacaoPronta,
  custoDoMotor,
  estadoDoMotor,
  motorDoNivel,
  motorDoPapel,
  motorPorId,
  MOTORES_DE_VIDEO,
  nivelDoMotor,
} from "../../supabase/functions/mesa-videos/modulos/modelos-de-video";
import { corpoDaGeracao, endpointDaGeracao, executorDoProvedor, faltaParaGerar, provedorCancela, type EntradaDaGeracao } from "../../supabase/functions/mesa-videos/modulos/video-executor";
import { ErroDoProvedor } from "../../supabase/functions/mesa-videos/modulos/video-provedor-comum";
import { cancelarNaRunway, consultarNaRunway, corpoDaRunway, enviarNaRunway, erroDaRunway, lerTarefaDaRunway, resultadoDaRunway, RUNWAY_VERSAO } from "../../supabase/functions/mesa-videos/modulos/video-provedor-runway";
import { cancelarNaHiggsfield, consultarNaHiggsfield, enviarNaHiggsfield, erroDaHiggsfield, MOVIMENTOS_DA_HIGGSFIELD, movimentoDaMesaNaHiggsfield } from "../../supabase/functions/mesa-videos/modulos/video-provedor-higgsfield";
import {
  cloneLiberadoParaVideo,
  consultarNaHeygen,
  duracaoEstimadaDaFala,
  enviarNaHeygen,
  erroDaHeygen,
  listarVozesDaHeygen,
  normalizarAvataresDaHeygen,
  resultadoDaHeygen,
} from "../../supabase/functions/mesa-videos/modulos/video-provedor-heygen";

/**
 * Frente V-C (26/09): Runway, Higgsfield e HeyGen. Fetch simulado em tudo:
 * nenhuma chamada sai para o provedor nem para o Supabase real.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = () => {
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range", "update", "insert"]) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve({ data: null, error: null });
    b.single = b.maybeSingle;
    b.then = (ok: any, falha: any) => Promise.resolve({ data: [], error: null }).then(ok, falha);
    return b;
  };
  return { supabase: { functions: { invoke: mock.invoke }, rpc: vi.fn().mockResolvedValue({ data: null, error: null }), from: () => consulta(), storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://x.supabase.co/a" }, error: null }) }) } } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));

import { ehArquivoDeVideo, fotoParaEditar, LEITURA_DA_FOTO_PARA_EDITAR, LEITURA_DA_MINIATURA_DO_QUADRO, leituraParaAVisao, TETO_DO_ORIGINAL_PARA_EDITAR } from "../../supabase/functions/mesa-videos/modulos/video-armazenar";
import { erroDaChamada } from "@/components/mesa-videos/videosApi";
import AvatarFalando from "@/components/mesa-videos/AvatarFalando";
import { MODOS_DO_GERAR } from "@/components/mesa-videos/modosDoGerar";
import { roteiroDoKitUgc } from "@/components/mesa-videos/rascunhoDoAvatar";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const resposta = (corpo: unknown, status = 200) => new Response(corpo === null ? "" : JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
const falso = (...respostas: Response[]) => {
  const f = vi.fn();
  respostas.forEach((r) => f.mockResolvedValueOnce(r));
  return f as unknown as typeof fetch & ReturnType<typeof vi.fn>;
};
const chamada = (f: any, i = 0) => ({ url: String(f.mock.calls[i][0]), init: f.mock.calls[i][1] as RequestInit & { headers: Record<string, string> } });
const REF = (id: string) => ({ request_id: id, status_url: "https://outro-host.test/qualquer", response_url: "https://outro-host.test/qualquer", endpoint: "x" });
const base: EntradaDaGeracao = { modo: "primeiro_quadro", prompt: "a mulher abre a porta", duracao_s: 5, formato: "9:16", audio: false, quadro_inicial_url: "https://x.supabase.co/q.png" };

// ------------------------------------------------------------------ catálogo

describe("catálogo: Runway, Higgsfield e HeyGen", () => {
  const semChave = () => false;
  it("sem a chave: 'precisa de chave' com o NOME do segredo; Higgsfield pede o par", () => {
    expect(estadoDoMotor(motorPorId("runway-gen4.5")!, { temChave: semChave })).toBe("precisa_chave");
    expect(estadoDoMotor(motorPorId("heygen-avatar-iv")!, { temChave: semChave })).toBe("precisa_chave");
    const hf = motorPorId("higgsfield-cinema-4")!;
    expect(chavesQueFaltam(hf, semChave)).toEqual(["HIGGSFIELD_API_KEY", "HIGGSFIELD_API_SECRET"]);
    const soId = (n: string) => n === "HIGGSFIELD_API_KEY";
    expect(estadoDoMotor(hf, { temChave: soId })).toBe("precisa_chave");
    expect(chavesQueFaltam(hf, soId)).toEqual(["HIGGSFIELD_API_SECRET"]);
    const todas = () => true;
    ["runway-gen4.5", "runway-gen4-turbo", "higgsfield-cinema-4", "heygen-avatar-iv", "heygen-foto"].forEach((id) => expect(estadoDoMotor(motorPorId(id)!, { temChave: todas }), id).toBe("pronto"));
    expect(motorPorId("runway-gen4.5")!.situacao).toBeUndefined();
  });

  it("preço com fonte e data; custo antes; níveis; nunca viram a sugestão sozinhos", () => {
    ["runway-gen4.5", "runway-gen4-turbo", "higgsfield-cinema-4", "heygen-avatar-iv", "heygen-foto"].forEach((id) => {
      const m = motorPorId(id)!;
      expect(m.preco!.fonte, id).toMatch(/^https:\/\//);
      expect(m.preco!.conferido_em, id).toBe("2026-09-26");
      expect(m.escolha_manual, id).toBe(true);
    });
    expect(custoDoMotor(motorPorId("runway-gen4.5")!, { duracao_s: 5 }).usd).toBe(0.6);
    expect(custoDoMotor(motorPorId("runway-gen4-turbo")!, { duracao_s: 10, variacoes: 2 }).usd).toBe(1);
    expect(custoDoMotor(motorPorId("higgsfield-cinema-4")!, { duracao_s: 5 }).incerto).toBe(true);
    expect(custoDoMotor(motorPorId("heygen-foto")!, { duracao_s: 30 }).usd).toBe(1.5);
    expect(nivelDoMotor(motorPorId("runway-gen4.5")!)).toBe("top");
    expect(nivelDoMotor(motorPorId("runway-gen4-turbo")!)).toBe("rapido");
    // O que já estava pronto continua igual: a sugestão de cada nível e papel segue no fal.
    for (const n of ["top", "normal", "rapido"] as const) expect(motorDoNivel(n, { modo: "primeiro_quadro" })!.provedor).toBe("fal");
    expect(motorDoPapel("fala")!.provedor).toBe("fal");
    expect(motorDoPapel("movimento")!.provedor).toBe("fal");
    // Capacidades: câmera na Higgsfield, avatar na HeyGen, só primeiro quadro na Runway.
    expect(motorPorId("higgsfield-cinema-4")!.cap.camera).toBe(true);
    expect(atende(motorPorId("heygen-foto")!, { modo: "avatar", pessoa_real: true })).toBe(true);
    expect(atende(motorPorId("heygen-avatar-iv")!, { modo: "primeiro_quadro" })).toBe(false);
    expect(atende(motorPorId("runway-gen4.5")!, { modo: "primeiro_ultimo" })).toBe(false);
    expect(MOTORES_DE_VIDEO.filter((m) => m.familia === "avatar").map((m) => m.id)).toEqual(["heygen-avatar-iv", "heygen-foto"]);
  });

  it("avatar cobra pela duração real, nunca mais que o confirmado; vídeo cobra o confirmado", () => {
    const foto = motorPorId("heygen-foto")!;
    expect(custoDaVariacaoPronta(foto, 1.5, 12.4)).toBe(0.65);
    expect(custoDaVariacaoPronta(foto, 1.5, 90)).toBe(1.5);
    expect(custoDaVariacaoPronta(foto, 1.5, null)).toBe(1.5);
    expect(custoDaVariacaoPronta(motorPorId("runway-gen4.5")!, 0.6, 3)).toBe(0.6);
  });

  it("executor por provedor: fal, Runway, Higgsfield e HeyGen; cancelar só Runway e Higgsfield", () => {
    expect(executorDoProvedor("fal")!.rotulo).toBe("fal.ai");
    expect(executorDoProvedor("runway")!.provedor).toBe("runway");
    expect(executorDoProvedor("higgsfield")!.provedor).toBe("higgsfield");
    expect(executorDoProvedor("heygen")!.provedor).toBe("heygen");
    expect(executorDoProvedor("painel")).toBeNull();
    expect(executorDoProvedor("toString")).toBeNull();
    expect([provedorCancela("runway"), provedorCancela("higgsfield"), provedorCancela("heygen"), provedorCancela("fal")]).toEqual([true, true, false, false]);
  });
});

// ------------------------------------------------------------------ Runway

describe("Runway", () => {
  const gen45 = motorPorId("runway-gen4.5")!;
  it("corpo: primeiro quadro, proporção da Runway, duração presa; texto só 9:16 ou 16:9", () => {
    const c = corpoDaGeracao(gen45, { ...base, formato: "4:5", duracao_s: 12, seed: 7 });
    expect(c).toEqual(expect.objectContaining({ model: "gen4.5", ratio: "832:1104", duration: 10, seed: 7, promptImage: [{ uri: "https://x.supabase.co/q.png", position: "first" }] }));
    expect(corpoDaRunway(gen45, { ...base, modo: "texto", quadro_inicial_url: null }).promptImage).toBeUndefined();
    expect(faltaParaGerar(gen45, { ...base, modo: "texto", formato: "1:1" })).toMatch(/9:16 ou 16:9/);
    expect(endpointDaGeracao(gen45, { modo: "texto" })).toBe("text_to_video");
    expect(() => endpointDaGeracao(motorPorId("runway-gen4-turbo")!, { modo: "texto" })).toThrow(/não faz/);
  });

  it("envio: UMA chamada com Bearer e a versão da API; erro mapeado e sem nova tentativa", async () => {
    const ok = falso(resposta({ id: "b1c2d3e4-0000-4000-8000-000000000001" }));
    const r = await enviarNaRunway("image_to_video", { model: "gen4.5" }, { chave: "k", fetchImpl: ok });
    const { url, init } = chamada(ok);
    expect(url).toBe("https://api.dev.runwayml.com/v1/image_to_video");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer k");
    expect(init.headers["X-Runway-Version"]).toBe(RUNWAY_VERSAO);
    expect(r.status_url).toBe("https://api.dev.runwayml.com/v1/tasks/b1c2d3e4-0000-4000-8000-000000000001");
    for (const [status, corpo, tipo, frase] of [
      [401, { error: "Unauthorized" }, "chave_invalida", /RUNWAYML_API_SECRET/],
      [429, { error: "Too many" }, "limite_de_uso", /limite de uso/],
      [400, { error: "Validation", issues: [{ path: ["ratio"], message: "invalid" }] }, "parametros", /ratio: invalid/],
      [400, { error: "Not enough credits" }, "sem_credito", /Sem crédito/],
      [502, null, "indisponivel", /indisponível/],
    ] as const) {
      const f = falso(resposta(corpo, status));
      const e = await enviarNaRunway("image_to_video", {}, { chave: "k", fetchImpl: f }).catch((x) => x);
      expect(e).toBeInstanceOf(ErroDoProvedor);
      expect((e as ErroDoProvedor).tipo, String(status)).toBe(tipo);
      expect((e as Error).message).toMatch(frase);
      expect((e as Error).message).not.toContain("Bearer");
      expect(f).toHaveBeenCalledTimes(1);
    }
    await expect(enviarNaRunway("image_to_video", {}, { chave: "" })).rejects.toThrow(/RUNWAYML_API_SECRET/);
    await expect(enviarNaRunway("../organization", {}, { chave: "k", fetchImpl: falso() })).rejects.toThrow(/fora da lista/);
  });

  it("status: fila, gerando, pronto, moderação; a URL sai do número da tarefa, nunca do endereço guardado", async () => {
    expect(lerTarefaDaRunway({ status: "THROTTLED" }).estado).toBe("fila");
    expect(lerTarefaDaRunway({ status: "RUNNING", progress: 0.4 })).toEqual(expect.objectContaining({ estado: "gerando", progresso: 0.4 }));
    expect(lerTarefaDaRunway({ status: "FAILED", failureCode: "SAFETY.INPUT.TEXT" }).erro).toMatch(/recusou o conteúdo/);
    const f = falso(resposta({ status: "SUCCEEDED", output: ["https://dnznrvs05pmza.cloudfront.net/v.mp4"] }), resposta({ status: "SUCCEEDED", output: ["https://dnznrvs05pmza.cloudfront.net/v.mp4"] }));
    expect((await consultarNaRunway(REF("tarefa-123"), { chave: "k", fetchImpl: f })).estado).toBe("pronto");
    expect(chamada(f).url).toBe("https://api.dev.runwayml.com/v1/tasks/tarefa-123");
    expect((await resultadoDaRunway(REF("tarefa-123"), { chave: "k", fetchImpl: f })).urls).toEqual(["https://dnznrvs05pmza.cloudfront.net/v.mp4"]);
    expect((await consultarNaRunway(REF("tarefa-123"), { chave: "k", fetchImpl: falso(resposta({}, 404)) })).erro).toMatch(/não existe mais/);
    // Limite na consulta não encerra o envio: sobe como erro (a próxima consulta, pedida pela tela, tenta).
    await expect(consultarNaRunway(REF("tarefa-123"), { chave: "k", fetchImpl: falso(resposta({}, 429)) })).rejects.toThrow(/limite/);
    const del = falso(new Response(null, { status: 204 }));
    expect(await cancelarNaRunway(REF("tarefa-123"), { chave: "k", fetchImpl: del })).toBe(true);
    expect(chamada(del).init.method).toBe("DELETE");
    expect(erroDaRunway(403, null).tipo).toBe("chave_invalida");
  });
});

// ------------------------------------------------------------------ Higgsfield

describe("Higgsfield", () => {
  const hf = motorPorId("higgsfield-cinema-4")!;
  it("corpo com a câmera pronta; 4:5 vira 3:4; câmera desconhecida é recusada", () => {
    const c = corpoDaGeracao(hf, { ...base, formato: "4:5", camera: "dolly-in", audio: false, duracao_s: 20 });
    expect(c).toEqual(expect.objectContaining({ image_urls: ["https://x.supabase.co/q.png"], camera_movement: "dolly-in", aspect_ratio: "3:4", duration: 15, resolution: "720p", generate_audio: false }));
    expect(faltaParaGerar(hf, { ...base, camera: "voar-alto" })).toMatch(/desconhecido/);
    expect(faltaParaGerar(motorPorId("runway-gen4.5")!, { ...base, camera: "dolly-in" })).toMatch(/não tem movimentos/);
    expect(MOVIMENTOS_DA_HIGGSFIELD.length).toBe(33);
    expect(movimentoDaMesaNaHiggsfield("zoom_lento")).toBe("slow-zoom-in");
  });

  it("envio com o PAR de chaves; erros: 403 sem crédito, 400 concurrent limite, 401 chave", async () => {
    const ok = falso(resposta({ status: "queued", request_id: "req-abc-123", status_url: "https://api.higgsfield.ai/requests/req-abc-123/status" }));
    const r = await enviarNaHiggsfield("higgsfield/cinema-studio/4.0", { prompt: "x" }, { chave: "id1", segredo: "seg1", fetchImpl: ok });
    expect(chamada(ok).url).toBe("https://api.higgsfield.ai/higgsfield/cinema-studio/4.0");
    expect(chamada(ok).init.headers.Authorization).toBe("Key id1:seg1");
    expect(r.request_id).toBe("req-abc-123");
    await expect(enviarNaHiggsfield("higgsfield/cinema-studio/4.0", {}, { chave: "id1", segredo: "" })).rejects.toThrow(/HIGGSFIELD_API_SECRET/);
    expect(erroDaHiggsfield(403, { detail: "Not enough credits" }).tipo).toBe("sem_credito");
    expect(erroDaHiggsfield(400, { detail: "Maximum number of concurrent requests (4) has been reached" }).tipo).toBe("limite_de_uso");
    expect(erroDaHiggsfield(401, null).message).toMatch(/HIGGSFIELD_API_KEY e HIGGSFIELD_API_SECRET/);
    expect(erroDaHiggsfield(422, { detail: [{ loc: ["body", "duration"], msg: "too long" }] }).message).toMatch(/body.duration: too long/);
  });

  it("status e cancelar (só na fila)", async () => {
    const st = (corpo: unknown) => consultarNaHiggsfield(REF("req-abc-123"), { chave: "a", segredo: "b", fetchImpl: falso(resposta(corpo)) });
    expect((await st({ status: "in_progress" })).estado).toBe("gerando");
    expect((await st({ status: "completed", video: { url: "https://cdn.higgsfield.ai/v.mp4" } })).estado).toBe("pronto");
    expect((await st({ status: "nsfw" })).erro).toMatch(/recusou o conteúdo/);
    expect((await st({ status: "failed", error: "boom" })).erro).toMatch(/boom/);
    expect(await cancelarNaHiggsfield(REF("req-abc-123"), { chave: "a", segredo: "b", fetchImpl: falso(resposta({}, 202)) })).toBe(true);
    expect(await cancelarNaHiggsfield(REF("req-abc-123"), { chave: "a", segredo: "b", fetchImpl: falso(resposta({ detail: "already started" }, 400)) })).toBe(false);
  });
});

// ------------------------------------------------------------------ HeyGen

describe("HeyGen: avatar falando", () => {
  const estoque = motorPorId("heygen-avatar-iv")!;
  const foto = motorPorId("heygen-foto")!;
  const avatar = (m: Partial<NonNullable<EntradaDaGeracao["avatar"]>> = {}): EntradaDaGeracao => ({ modo: "avatar", prompt: "Oi, eu sou a Ana.", duracao_s: 5, formato: "9:16", audio: true, avatar: { tipo: "estoque", avatar_id: "Abigail_standing_1", voz_id: "v-pt-1", legendas: true, locale: "pt-BR", ...m } });

  it("corpo v3: avatar de estoque (Avatar IV) e foto que fala; legenda gravada quando pedida", () => {
    expect(corpoDaGeracao(estoque, avatar())).toEqual({
      type: "avatar",
      avatar_id: "Abigail_standing_1",
      engine: { type: "avatar_iv" },
      script: "Oi, eu sou a Ana.",
      voice_id: "v-pt-1",
      voice_settings: { speed: 1, locale: "pt-BR" },
      resolution: "1080p",
      aspect_ratio: "9:16",
      caption: { file_format: "srt", style: "default" },
    });
    const c = corpoDaGeracao(foto, avatar({ tipo: "foto", avatar_id: null, foto_url: "https://x.supabase.co/sign/foto.jpg", legendas: false }));
    expect(c).toEqual(expect.objectContaining({ type: "image", image: { type: "url", url: "https://x.supabase.co/sign/foto.jpg" } }));
    expect(c.caption).toBeUndefined();
    expect(endpointDaGeracao(foto, { modo: "avatar" })).toBe("v3/videos");
  });

  it("o que falta: roteiro, voz, avatar, foto; motor de avatar não faz vídeo comum", () => {
    expect(faltaParaGerar(estoque, avatar({ voz_id: "" }))).toBe("Escolha a voz.");
    expect(faltaParaGerar(estoque, { ...avatar(), prompt: " " })).toBe("Escreva o roteiro.");
    expect(faltaParaGerar(foto, avatar({ tipo: "foto", foto_url: "http://inseguro" }))).toMatch(/foto/);
    expect(faltaParaGerar(foto, avatar())).toMatch(/foto/);
    expect(faltaParaGerar(estoque, { ...base })).toMatch(/não faz/);
    expect(duracaoEstimadaDaFala("")).toBe(0);
    expect(duracaoEstimadaDaFala("Oi. Tudo bem? Hoje eu vou te mostrar o nosso produto novo")).toBeGreaterThanOrEqual(6);
    expect(duracaoEstimadaDaFala("um dois três quatro cinco seis", 1.5)).toBeLessThan(duracaoEstimadaDaFala("um dois três quatro cinco seis", 0.5));
  });

  it("envio com X-Api-Key e chave de idempotência; status; resultado legendado; erros mapeados", async () => {
    const ok = falso(resposta({ data: { video_id: "abc123def456", status: "waiting" } }));
    const r = await enviarNaHeygen("v3/videos", { type: "avatar" }, { chave: "hk", fetchImpl: ok }, { idempotencia: "pedido-1" });
    expect(chamada(ok).url).toBe("https://api.heygen.com/v3/videos");
    expect(chamada(ok).init.headers["X-Api-Key"]).toBe("hk");
    expect(chamada(ok).init.headers["Idempotency-Key"]).toBe("pedido-1");
    expect(r.status_url).toBe("https://api.heygen.com/v3/videos/abc123def456");
    const st = (corpo: unknown) => consultarNaHeygen(REF("abc123def456"), { chave: "hk", fetchImpl: falso(resposta(corpo)) });
    expect((await st({ data: { status: "waiting" } })).estado).toBe("fila");
    expect((await st({ data: { status: "processing" } })).estado).toBe("gerando");
    expect(await st({ data: { status: "completed", video_url: "https://files.heygen.ai/v.mp4", duration: 12.4 } })).toEqual(expect.objectContaining({ estado: "pronto", duracao_s: 12.4 }));
    expect((await st({ data: { status: "failed", failure_code: "content_policy_violation", failure_message: "blocked" } })).erro).toMatch(/recusou o conteúdo/);
    const res = await resultadoDaHeygen(REF("abc123def456"), { chave: "hk", fetchImpl: falso(resposta({ data: { status: "completed", video_url: "https://files.heygen.ai/v.mp4", captioned_video_url: "https://files.heygen.ai/v-leg.mp4", thumbnail_url: "https://files.heygen.ai/t.jpg", duration: 12 } })) });
    expect(res).toEqual({ tipo: "video", urls: ["https://files.heygen.ai/v.mp4"], legendado_url: "https://files.heygen.ai/v-leg.mp4", miniatura_url: "https://files.heygen.ai/t.jpg", duracao_s: 12 });
    expect(erroDaHeygen(402, { error: { code: "insufficient_credit", message: "no" } }).tipo).toBe("sem_credito");
    expect(erroDaHeygen(401, { error: { code: "unauthorized" } }).message).toMatch(/HEYGEN_API_KEY/);
    expect(erroDaHeygen(429, { error: { code: "rate_limit_exceeded" } }).tipo).toBe("limite_de_uso");
    expect(erroDaHeygen(400, { error: { code: "content_policy_violation", message: "x" } }).tipo).toBe("conteudo_recusado");
    expect(erroDaHeygen(400, { error: { code: "download_failed" } }).message).toMatch(/baixar a foto/);
    await expect(enviarNaHeygen("v3/videos", {}, { chave: "" })).rejects.toThrow(/HEYGEN_API_KEY/);
    const falha = falso(resposta({ error: { code: "insufficient_credit" } }, 402));
    await expect(enviarNaHeygen("v3/videos", {}, { chave: "hk", fetchImpl: falha })).rejects.toThrow(/Sem crédito/);
    expect(falha).toHaveBeenCalledTimes(1);
  });

  it("listas: só avatares do Avatar IV; só vozes em português, Brasil primeiro", async () => {
    const av = normalizarAvataresDaHeygen({ data: [{ id: "look_1", name: "Ana", gender: "female", supported_api_engines: ["avatar_iv"] }, { id: "look_2", name: "Velho", supported_api_engines: ["avatar_iii"] }, { name: "sem id" }], has_more: false });
    expect(av).toEqual({ itens: [{ id: "look_1", nome: "Ana", genero: "female", previa: null, voz_padrao: null, orientacao: null }], proximo: null });
    const f = falso(resposta({ data: [{ voice_id: "pt-pt", name: "Joana", language: "Portuguese" }, { voice_id: "pt-br", name: "Camila (Brazil)", language: "Portuguese", support_locale: true }, { voice_id: "en", name: "Emma", language: "English" }] }));
    const vozes = await listarVozesDaHeygen({ chave: "hk", fetchImpl: f });
    expect(chamada(f).url).toBe("https://api.heygen.com/v3/voices?type=public&language=Portuguese&limit=100");
    expect(vozes.itens.map((v) => v.id)).toEqual(["pt-br", "pt-pt"]);
    expect(vozes.itens[0]).toEqual(expect.objectContaining({ brasil: true, aceita_locale: true }));
  });

  it("foto de pessoa real: só clone com autorização válida (a regra da Mesa Foto)", () => {
    const ok = { id: "c1", client_id: CLIENTE, origem: "clone_de_foto_real", status: "pronta", autorizacao: { confirmada: true, quem: "Ana", data: "2026-09-01", sabe_que_e_ia: true, adulta: true, validade: "2027-01-01" } };
    expect(cloneLiberadoParaVideo(ok, CLIENTE, "2026-09-26")).toEqual({ ok: true, motivo: null });
    expect(cloneLiberadoParaVideo({ ...ok, autorizacao: { ...ok.autorizacao, revogada_em: "2026-09-20" } }, CLIENTE, "2026-09-26").motivo).toMatch(/revogada/);
    expect(cloneLiberadoParaVideo({ ...ok, autorizacao: { ...ok.autorizacao, validade: "2026-09-25" } }, CLIENTE, "2026-09-26").motivo).toMatch(/venceu/);
    expect(cloneLiberadoParaVideo({ ...ok, autorizacao: { ...ok.autorizacao, sabe_que_e_ia: false } }, CLIENTE, "2026-09-26").ok).toBe(false);
    expect(cloneLiberadoParaVideo({ ...ok, autorizacao: null }, CLIENTE).motivo).toMatch(/sem autorização/);
    expect(cloneLiberadoParaVideo(ok, "22222222-2222-4222-8222-222222222222").motivo).toMatch(/outro cliente/);
    expect(cloneLiberadoParaVideo({ ...ok, status: "arquivada" }, CLIENTE).motivo).toMatch(/arquivado/);
    expect(cloneLiberadoParaVideo({ ...ok, origem: "persona" }, CLIENTE).ok).toBe(false);
  });
});

// ------------------------------------------------------------------ tela: Avatar falando

const valor = (): MesaValor => ({ clientId: CLIENTE, clientName: "Café", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 10, catalogo: [], catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn() });
const corpos = (fn: string, acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[0] === fn && c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);
function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, { initialEntries: [`/mesa-videos?client=${CLIENTE}&etapa=gerar`] }, h(TooltipProvider, null, h(MesaProvider, { valor: valor(), children: h(AvatarFalando) })))));
}
const estados = (heygen: "pronto" | "precisa_chave") => ({
  motores: MOTORES_DE_VIDEO.map((m) => ({ id: m.id, estado: m.provedor === "heygen" ? heygen : "pronto", estado_rotulo: m.provedor === "heygen" && heygen === "precisa_chave" ? "Precisa de chave" : "Pronto", nivel: "normal", novo: false, chave: m.provedor === "heygen" && heygen === "precisa_chave" ? m.chave_env : null })),
});
const CLONES = [
  { id: "c-sem", client_id: CLIENTE, nome: "Bruno", status: "pronta", autorizacao: null, autorizacao_valida: { ok: false, motivo: "Clone sem autorização registrada." }, identidade_real: [] },
  { id: "c-ok", client_id: CLIENTE, nome: "Ana", status: "pronta", autorizacao: { confirmada: true }, autorizacao_valida: { ok: true, motivo: null }, identidade_real: [] },
];

beforeEach(() => {
  vi.clearAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
  (window as any).IntersectionObserver = class {
    observe() {}
    disconnect() {}
  };
});

describe("tela Avatar falando", () => {
  it("modo novo no Gerar e o roteiro do kit UGC não inventa nada", () => {
    expect(MODOS_DO_GERAR.map((m) => m.valor)).toContain("avatar");
    expect(roteiroDoKitUgc({ gancho: "Eu não acreditei no que esse fone faz", produto: "fone" })).toBe("Eu não acreditei no que esse fone faz\n\nLink aqui embaixo.");
  });

  it("sem a chave: mostra 'precisa de chave' com o nome do segredo e não lista nem gera", async () => {
    mock.invoke.mockImplementation((_f: string, { body }: any) => Promise.resolve({ data: body.acao === "motores_estado" ? estados("precisa_chave") : {}, error: null }));
    montar();
    await waitFor(() => expect(document.body.textContent).toMatch(/precisa de chave \(HEYGEN_API_KEY\)/i), { timeout: 8000 });
    expect(corpos("mesa-videos", "heygen_catalogo")).toHaveLength(0);
    const botao = screen.getByRole("button", { name: /^Gerar/ });
    expect(botao.hasAttribute("disabled")).toBe(true);
  });

  it("clone sem autorização fica bloqueado; com autorização exige a confirmação e manda o custo confirmado", async () => {
    mock.invoke.mockImplementation((f: string, { body }: any) => {
      if (body.acao === "motores_estado") return Promise.resolve({ data: estados("pronto"), error: null });
      if (body.acao === "heygen_catalogo") return Promise.resolve({ data: { itens: body.tipo === "vozes" ? [{ id: "pt-br", nome: "Camila", genero: "female", idioma: "Portuguese", previa: null, aceita_locale: true, brasil: true }] : [], proximo: null }, error: null });
      if (f === "mesa-foto" && body.acao === "clones_listar") return Promise.resolve({ data: { clones: CLONES }, error: null });
      if (body.acao === "avatar_gerar") return Promise.resolve({ data: { ok: true, pedido_id: "99999999-9999-4999-8999-999999999999" }, error: null });
      return Promise.resolve({ data: {}, error: null });
    });
    montar();
    fireEvent.change(await screen.findByPlaceholderText(/Eu sou a Ana/), { target: { value: "Oi! Eu sou a Ana e hoje vou mostrar a clínica." } });
    fireEvent.click(await screen.findByRole("tab", { name: "Clone" }));
    const seletor = (await screen.findByRole("combobox", { name: "Clone" })) as HTMLSelectElement;
    await waitFor(() => expect(seletor.querySelectorAll("option").length).toBe(3));
    const semAut = Array.prototype.slice.call(seletor.querySelectorAll("option")).find((o: HTMLOptionElement) => o.value === "c-sem") as HTMLOptionElement;
    expect(semAut.disabled).toBe(true);
    expect(semAut.textContent).toMatch(/sem autorização válida/);
    fireEvent.change(seletor, { target: { value: "c-ok" } });
    await waitFor(() => expect(document.body.textContent).toMatch(/Confirme que a autorização cobre vídeo/));
    const botao = screen.getByRole("button", { name: /^Gerar/ });
    expect(botao.hasAttribute("disabled")).toBe(true);
    fireEvent.click(document.querySelector('[data-confirma-uso-em-video] input') as HTMLInputElement);
    await waitFor(() => expect(botao.hasAttribute("disabled")).toBe(false));
    expect(botao.textContent).toMatch(/US\$/);
    fireEvent.click(botao);
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(corpos("mesa-videos", "avatar_gerar")).toHaveLength(1));
    const corpo = corpos("mesa-videos", "avatar_gerar")[0];
    expect(corpo).toMatchObject({ client_id: CLIENTE, fonte: "clone", clone_id: "c-ok", confirma_uso_em_video: true, voz_id: "pt-br", locale: "pt-BR", legendas: true, formato: "9:16" });
    expect(corpo.custo_confirmado_usd).toBeGreaterThan(0);
    expect(corpo.uid).toBeTruthy();
    expect(corpo.avatar_id).toBeNull();
  }, 20000);
});

// ------------------------------------------------------------------ pedidos da AB: leitura leve e queda da função

describe("leitura leve de imagens na mesa-videos (sem abrir original grande)", () => {
  const raiz = resolve(__dirname, "../..");
  const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8");

  it("miniatura do vídeo pelo quadro: cópia leve pedida à copias-leves, lida uma vez por consulta", () => {
    expect(LEITURA_DA_MINIATURA_DO_QUADRO.caixa).toBe(640);
    expect(LEITURA_DA_MINIATURA_DO_QUADRO.opcoes.pedirCopia).toBe(true);
    expect(LEITURA_DA_MINIATURA_DO_QUADRO.opcoes.aceitarCopiaMaiorAte).toBeGreaterThan(0);
    const g = ler("supabase/functions/mesa-videos/geracao.ts");
    expect(g).not.toMatch(/download\(String\(p\.parametros\.quadro_inicial_path\)\)/);
    expect(g).toMatch(/miniaturaDoQuadro\(b, caminho, String\(p\.parametros\.quadro_inicial_path\), cacheDoQuadro\)/);
  });

  it("visão do diretor: vídeo pela miniatura própria (nunca o vídeo), imagem pela cópia leve", () => {
    expect(leituraParaAVisao({ storage_path: `${CLIENTE}/video/gerados/p-1.mp4`, tipo: "gerado" })).toEqual({ caixa: 1024, miniatura: true, opcoes: expect.objectContaining({ usarCopias: false }) });
    const img = leituraParaAVisao({ storage_path: `${CLIENTE}/video/angulos/p-1.png`, tipo: "angulo" });
    expect(img.miniatura).toBe(false);
    expect(img.opcoes).toEqual(expect.objectContaining({ pedirCopia: true }));
    expect(ehArquivoDeVideo("a/b.MOV")).toBe(true);
    expect(ehArquivoDeVideo("a/b.png", "quadro")).toBe(false);
    expect(ler("supabase/functions/mesa-videos/diretor.ts")).toMatch(/leituraParaAVisao\(a\)/);
  });

  it("antes e depois: cópia até 2048 px; sem cópia, o original só até o teto", () => {
    const pouco = new Uint8Array(10);
    expect(fotoParaEditar({ cabe: true, bytes: pouco })).toEqual({ bytes: pouco, erro: null });
    expect(fotoParaEditar({ cabe: false, bytes: pouco }).erro).toBeNull();
    expect(fotoParaEditar({ cabe: false, bytes: new Uint8Array(TETO_DO_ORIGINAL_PARA_EDITAR + 1) })).toEqual({ bytes: null, erro: "foto_grande_demais" });
    expect(fotoParaEditar(null).erro).toBe("foto_ilegivel");
    expect(LEITURA_DA_FOTO_PARA_EDITAR).toEqual(expect.objectContaining({ caixa: 2048, opcoes: expect.objectContaining({ pedirCopia: true }) }));
    expect(ler("supabase/functions/mesa-videos/geracao.ts")).toMatch(/fotoParaEditar\(leitura\)/);
  });

  it("queda da função no meio vira 'funcao_interrompida' (não 'não publicada')", async () => {
    const cortada = await erroDaChamada(new TypeError("error decoding response body"));
    expect(cortada.codigo).toBe("funcao_interrompida");
    expect(cortada.message).toMatch(/parou no meio/);
    expect((await erroDaChamada({ name: "FunctionsHttpError", message: "non-2xx", context: new Response("", { status: 546 }) })).codigo).toBe("funcao_interrompida");
    expect((await erroDaChamada({ name: "FunctionsHttpError", message: "non-2xx", context: new Response("", { status: 504 }) })).codigo).toBe("funcao_interrompida");
    expect((await erroDaChamada({ name: "FunctionsHttpError", message: "non-2xx", context: new Response("", { status: 404 }) })).codigo).toBe("funcao_indisponivel");
    expect((await erroDaChamada({ name: "FunctionsFetchError", message: "Failed to send a request to the Edge Function", context: {} })).codigo).toBe("funcao_indisponivel");
    const doServidor = await erroDaChamada({ name: "FunctionsHttpError", message: "non-2xx", context: new Response(JSON.stringify({ error: "motor_precisa_chave", mensagem: "HeyGen: precisa de chave (HEYGEN_API_KEY)." }), { status: 409 }) });
    expect(doServidor.codigo).toBe("motor_precisa_chave");
    expect(doServidor.message).toMatch(/HEYGEN_API_KEY/);
  });
});

// ------------------------------------------------------------------ regras da casa nos arquivos

describe("arquivos da frente V-C", () => {
  it("sem travessão, piso Safari 11, sem laço e chave nunca no front", () => {
    const raiz = resolve(__dirname, "../..");
    const arquivos = [
      "supabase/functions/mesa-videos/modulos/video-provedor-comum.ts",
      "supabase/functions/mesa-videos/modulos/video-provedor-runway.ts",
      "supabase/functions/mesa-videos/modulos/video-provedor-higgsfield.ts",
      "supabase/functions/mesa-videos/modulos/video-provedor-heygen.ts",
      "src/components/mesa-videos/AvatarFalando.tsx",
      "src/components/mesa-videos/rascunhoDoAvatar.ts",
    ];
    for (const p of arquivos) {
      const f = readFileSync(resolve(raiz, p), "utf8");
      expect(f, p).not.toMatch(/[—–]/);
      expect(f, p).not.toMatch(/\(\?<[=!a-z]/i);
      expect(f, p).not.toMatch(/\\p\{|\.at\(|Object\.hasOwn\(/);
      expect(f, p).not.toMatch(/setInterval|refetchInterval|while \(true\)|Deno\.env/);
      if (p.indexOf("src/") === 0) expect(f, p).not.toMatch(/HEYGEN_API_KEY|RUNWAYML_API_SECRET|HIGGSFIELD_API/);
    }
  });
});
