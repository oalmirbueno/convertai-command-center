/**
 * Executor dos motores de vídeo e de ângulo (frente V-A, 26/09/2026).
 *
 * fal.ai primeiro, pela FILA assíncrona (docs: fal.ai/docs, "queue"):
 *   enviar:    POST https://queue.fal.run/<endpoint>   (Authorization: Key <FAL_KEY>)
 *              -> { request_id, status_url, response_url, cancel_url }
 *   consultar: GET status_url  -> { status: IN_QUEUE | IN_PROGRESS | COMPLETED }
 *   resultado: GET response_url -> { video: { url } } | { images: [{ url }] } | ...
 * Usa sempre as URLs que o provedor devolve (endpoint com subcaminho monta a
 * URL de status de outro jeito).
 *
 * SEM LAÇO: nada aqui repete sozinho. Consultar é uma chamada só, quando a
 * tela ou o próximo passo pede, com intervalo mínimo entre consultas e prazo
 * por motor. Passou do prazo, o envio segue sendo conferido com aviso até o
 * teto duro (24 h; frente MTR) e só então vira erro, dizendo que o provedor
 * pode ter cobrado. Erro do provedor NÃO é tentado de novo: fica registrado
 * com o motivo.
 *
 * Puro onde dá: o corpo de cada motor, a leitura do resultado e as regras de
 * consulta são funções sem rede (testadas). As chamadas recebem a chave e o
 * fetch por parâmetro (a função passa Deno.env; o teste passa um falso).
 *
 * Frente V-C (26/09/2026): Runway, Higgsfield e HeyGen entram com a mesma
 * interface (`ExecutorDoProvedor`: enviar, consultar, resultado e cancelar
 * quando o provedor deixa), em `video-provedor-*.ts`. `executorDoProvedor`
 * escolhe pelo provedor do motor; o fal continua igual por baixo.
 */

import { type AnguloDeCamera, parametrosDoAngulo, promptDoAngulo, type ManterNoAngulo } from "./video-angulo.ts";
import { duracaoNoMotor, type MotorDeVideo, resolucaoNoMotor } from "./modelos-de-video.ts";
// Frente V-C (26/09): Runway, Higgsfield e HeyGen, cada um no seu executor com a mesma interface.
import { type Credenciais, type ExecutorDoProvedor, pedirJson, semVazios, type SituacaoNoProvedor } from "./video-provedor-comum.ts";
import { corpoDaRunway, EXECUTOR_DA_RUNWAY, faltaNaRunway } from "./video-provedor-runway.ts";
import { corpoDaHiggsfield, EXECUTOR_DA_HIGGSFIELD, movimentoValido } from "./video-provedor-higgsfield.ts";
import { corpoDoAvatar, type EntradaDoAvatar, EXECUTOR_DA_HEYGEN, faltaNoAvatar } from "./video-provedor-heygen.ts";
import { podeRecuperar } from "./coleta-de-video.ts";

export type { SituacaoNoProvedor } from "./video-provedor-comum.ts";

export const FAL_FILA = "https://queue.fal.run/";
export const TIMEOUT_DO_PROVEDOR_MS = 20_000;
/** Entre duas consultas do mesmo envio (a tela aberta em duas abas não martela o provedor). */
export const INTERVALO_MINIMO_DA_CONSULTA_MS = 15_000;
export const VARIACOES_MAX = 4;

export type ModoDaGeracao = "texto" | "primeiro_quadro" | "primeiro_ultimo" | "referencia" | "estender" | "angulo" | "avatar" | "labial";

export interface EntradaDaGeracao {
  modo: ModoDaGeracao;
  prompt: string;
  negativo?: string | null;
  duracao_s: number;
  formato: string;
  resolucao?: string | null;
  audio: boolean;
  seed?: number | null;
  quadro_inicial_url?: string | null;
  quadro_final_url?: string | null;
  referencias_urls?: string[];
  video_url?: string | null;
  angulo?: AnguloDeCamera | null;
  manter?: ManterNoAngulo;
  /** Movimento de câmera pronto (Higgsfield: camera_movement). */
  camera?: string | null;
  /** Avatar falando (HeyGen): quem fala, voz, legendas. O roteiro vai em `prompt`. */
  avatar?: EntradaDoAvatar | null;
  /** Labial (frente VGN): o áudio que a foto fala (URL assinada, só no servidor). */
  audio_url?: string | null;
  /** Labial pela HeyGen no fal: fala estável (padrão) ou expressiva. */
  estilo_da_fala?: "estavel" | "expressivo" | null;
}

/** Qual endpoint do motor atende ao modo. Lança Error com a frase quando nenhum. */
export function endpointDaGeracao(m: MotorDeVideo, e: Pick<EntradaDaGeracao, "modo" | "quadro_inicial_url" | "quadro_final_url">): string {
  const ep = m.endpoints;
  let alvo: string | undefined;
  if (e.modo === "angulo") alvo = ep.angulo;
  else if (e.modo === "avatar") alvo = ep.avatar;
  else if (e.modo === "labial") alvo = ep.labial;
  else if (e.modo === "estender") alvo = ep.estender;
  else if (e.modo === "referencia") alvo = ep.referencia || ep.imagem;
  else if (e.modo === "primeiro_ultimo") alvo = ep.ultimo;
  else if (e.modo === "primeiro_quadro") alvo = ep.imagem;
  else alvo = ep.texto || undefined;
  if (!alvo) throw new Error(`${m.rotulo} não faz este tipo de geração.`);
  return alvo;
}

/**
 * Corpo do pedido no jeito de cada motor. Duração presa ao que o motor
 * aceita, resolução da lista dele. Nada de chave aqui.
 */
export function corpoDaGeracao(m: MotorDeVideo, e: EntradaDaGeracao): Record<string, unknown> {
  const d = e.modo === "angulo" ? 0 : duracaoNoMotor(m, e.duracao_s);
  const r = resolucaoNoMotor(m, e.resolucao);
  const audio = !!e.audio && m.cap.audio;
  const refs = (e.referencias_urls || []).slice(0, Math.max(0, m.cap.referencias));
  const ini = e.quadro_inicial_url || null;
  const fim = e.modo === "primeiro_ultimo" ? e.quadro_final_url || null : null;
  const seed = typeof e.seed === "number" && isFinite(e.seed) ? Math.floor(e.seed) : undefined;
  const prompt = String(e.prompt || "").slice(0, 2400);
  const ar = e.formato === "4:5" ? "3:4" : e.formato;
  switch (m.dialeto) {
    case "seedance": {
      // Esquemas conferidos em 30/09: "task" e "seed" só no reference-to-video do 2.5.
      const v25 = endpointDaGeracao(m, e).indexOf("seedance-2.5") >= 0;
      if (e.modo === "estender") return semVazios({ prompt, task: "extension", video_urls: e.video_url ? [e.video_url] : [], duration: String(d), resolution: r, generate_audio: audio, seed: v25 ? seed : undefined });
      if (e.modo === "referencia") return semVazios({ prompt, task: v25 ? "reference" : undefined, image_urls: ini ? [ini].concat(refs) : refs, duration: String(d), aspect_ratio: ar, resolution: r, generate_audio: audio, seed: v25 ? seed : undefined });
      return semVazios({ prompt, image_url: ini, end_image_url: fim, duration: String(d), aspect_ratio: ar, resolution: r, generate_audio: audio });
    }
    case "kling": {
      // O3 e Turbo chamam o quadro de "image_url" (obrigatório; sem negative_prompt nem elements no
      // image-to-video do O3, prova pelo esquema público da fal, MTR e VGN 30/09); v3 Pro, 4K e 2.6 de "start_image_url".
      // O video-to-video/reference (estender do O3) não tem generate_audio.
      // Elemento pede ao menos 1 imagem extra: com uma referência só, ela vale nos dois lugares.
      const ep = endpointDaGeracao(m, e);
      const o3 = ep.indexOf("/o3/") >= 0;
      const turbo = ep.indexOf("/turbo/") >= 0;
      const arK = ar === "9:16" || ar === "16:9" || ar === "1:1" ? ar : "9:16";
      const elementos = refs.length ? [{ frontal_image_url: refs[0], reference_image_urls: refs.length > 1 ? refs.slice(1, 4) : [refs[0]] }] : [];
      if (e.modo === "estender") return semVazios({ prompt, video_url: e.video_url, duration: String(d), elements: elementos });
      if (turbo) return semVazios({ prompt, image_url: ini, duration: String(d), aspect_ratio: ini ? undefined : arK });
      if (e.modo === "texto") return semVazios({ prompt, duration: String(d), aspect_ratio: arK, negative_prompt: o3 ? undefined : e.negativo, generate_audio: audio });
      // Referência no O3 vai ao reference-to-video; no v3 Pro e no 4K, pelo image-to-video com elementos (sem proporção: segue o quadro).
      if (e.modo === "referencia" && ep.indexOf("reference-to-video") >= 0) return semVazios({ prompt, start_image_url: ini, duration: String(d), aspect_ratio: arK, elements: elementos, generate_audio: audio });
      if (e.modo === "referencia") return semVazios({ prompt, start_image_url: ini || refs[0], duration: String(d), negative_prompt: e.negativo, elements: elementos, generate_audio: audio });
      if (o3) return semVazios({ prompt, image_url: ini, end_image_url: fim, duration: String(d), generate_audio: audio });
      return semVazios({ prompt, start_image_url: ini, end_image_url: fim, duration: String(d), negative_prompt: e.negativo, generate_audio: audio, elements: elementos });
    }
    case "veo": {
      const arV = ar === "9:16" || ar === "16:9" ? ar : "9:16";
      const base = { prompt, duration: `${d}s`, resolution: r, aspect_ratio: arV, generate_audio: audio };
      if (e.modo === "estender") return semVazios({ ...base, video_url: e.video_url, duration: "7s", aspect_ratio: "auto", negative_prompt: e.negativo, seed });
      // Referência: o esquema não tem negativo nem semente.
      if (e.modo === "referencia") return semVazios({ ...base, image_urls: (ini ? [ini] : []).concat(refs).slice(0, 3) });
      if (e.modo === "primeiro_ultimo") return semVazios({ ...base, aspect_ratio: "auto", first_frame_url: ini, last_frame_url: e.quadro_final_url, negative_prompt: e.negativo, seed });
      if (e.modo === "primeiro_quadro") return semVazios({ ...base, aspect_ratio: "auto", image_url: ini, negative_prompt: e.negativo, seed });
      return semVazios({ ...base, negative_prompt: e.negativo, seed });
    }
    case "gemini_omni": {
      const arG = ar === "9:16" || ar === "16:9" ? ar : "9:16";
      if (e.modo === "referencia") return semVazios({ prompt, image_urls: (ini ? [ini] : []).concat(refs).slice(0, 3), resolution: r, aspect_ratio: arG });
      return semVazios({ prompt, image_url: ini, end_image_url: fim, resolution: r, aspect_ratio: arG });
    }
    case "wan3":
      if (e.modo === "referencia") return semVazios({ prompt, reference_image_urls: (ini ? [ini] : []).concat(refs).slice(0, 10), duration: d, resolution: r, aspect_ratio: ar, audio, seed });
      return semVazios({ prompt, start_image_url: ini, end_image_url: fim, duration: d, resolution: r, aspect_ratio: ini ? "adaptive" : ar, audio, seed });
    case "minimax_h3": {
      // O modo de expansão do prompt é obrigatório no esquema (sem ele o fal recusa com 422).
      const R = r.toUpperCase();
      if (e.modo === "estender") return semVazios({ prompt, video_url: e.video_url, duration: d, resolution: R, output: "continuation", seed });
      if (e.modo === "referencia") return semVazios({ prompt, prompt_expansion_mode: "balanced", reference_image_urls: (ini ? [ini] : []).concat(refs).slice(0, 9), duration: d, resolution: R, aspect_ratio: ar, seed });
      return semVazios({ prompt, prompt_expansion_mode: "balanced", image_url: ini, end_image_url: fim, duration: d, resolution: R, aspect_ratio: ini ? undefined : ar, seed });
    }
    case "hailuo":
      // O Hailuo 2.3 Pro não recebe duração (esquema público da fal; preço fechado por vídeo).
      return semVazios({ prompt, image_url: ini, prompt_optimizer: true });
    case "happyhorse":
      if (e.modo === "referencia") return semVazios({ prompt, image_urls: (ini ? [ini] : []).concat(refs).slice(0, 4), duration: d, resolution: r, aspect_ratio: e.formato, seed });
      return semVazios({ prompt, image_url: ini, duration: d, resolution: r, aspect_ratio: ini ? undefined : e.formato, seed });
    case "flux3":
      if (e.modo === "estender") return semVazios({ prompt, video_url: e.video_url, duration: d, resolution: r, generate_audio: audio });
      if (e.modo === "primeiro_ultimo") return semVazios({ prompt, start_image_url: ini, end_image_url: e.quadro_final_url, duration: d, resolution: r, aspect_ratio: ar, generate_audio: audio });
      return semVazios({ prompt, image_url: ini, duration: d, resolution: r, aspect_ratio: ini ? undefined : ar, generate_audio: audio });
    case "grok":
      if (e.modo === "estender") return semVazios({ prompt, video_url: e.video_url, duration: Math.min(10, d) });
      if (e.modo === "texto") return semVazios({ prompt, duration: d, resolution: r, aspect_ratio: ar });
      return semVazios({ prompt, image_url: ini, duration: d, resolution: r });
    case "pixverse":
      if (e.modo === "texto") return semVazios({ prompt, duration: d, resolution: r, aspect_ratio: ar, seed, generate_audio_switch: audio });
      return semVazios({ prompt, image_url: ini, duration: d, resolution: r, seed, generate_audio_switch: audio });
    case "ltx":
      if (e.modo === "estender") return semVazios({ prompt, video_url: e.video_url, duration: d, mode: "end" });
      if (e.modo === "texto") return semVazios({ prompt, duration: d, resolution: r, aspect_ratio: ar === "16:9" ? "16:9" : "9:16", generate_audio: audio });
      return semVazios({ prompt, image_url: ini, end_image_url: fim, duration: d, resolution: r, generate_audio: audio });
    case "hunyuan":
      return semVazios({ prompt, image_url: ini, aspect_ratio: ar === "16:9" ? "16:9" : "9:16", negative_prompt: e.negativo, seed });
    case "luma":
      // A partir de imagem só 5 s (faltaParaGerar recusa 10 s antes do custo).
      return semVazios({ prompt, image_url: ini, end_image_url: fim, duration: d >= 10 && e.modo === "texto" ? "10s" : "5s", resolution: r, aspect_ratio: ar });
    case "h3_labial":
      return semVazios({ image_url: ini, audio_url: e.audio_url, resolution: r.toUpperCase(), seed });
    case "sync_labial":
      return semVazios({ image_url: ini, audio_url: e.audio_url });
    case "heygen_fal_labial":
      return semVazios({ image_url: ini, audio_url: e.audio_url, resolution: r, aspect_ratio: e.formato, talking_style: e.estilo_da_fala === "expressivo" ? "expressive" : "stable" });
    case "runway":
      return corpoDaRunway(m, e);
    case "higgsfield":
      return corpoDaHiggsfield(m, e);
    case "heygen_avatar":
    case "heygen_foto":
      return corpoDoAvatar(m, e);
    case "qwen_angulo":
    case "flux2_angulo": {
      if (!e.angulo) throw new Error("Falta o ângulo.");
      const p = parametrosDoAngulo(e.angulo);
      return semVazios({
        image_urls: ini ? [ini] : [],
        horizontal_angle: p.horizontal_angle,
        vertical_angle: m.dialeto === "flux2_angulo" ? Math.max(0, p.vertical_angle) : p.vertical_angle,
        zoom: p.zoom,
        additional_prompt: promptDoAngulo(e.angulo, e.manter || "ambos", prompt || null),
        num_images: 1,
        seed,
      });
    }
    default:
      throw new Error(`${m.rotulo} ainda não gera por aqui.`);
  }
}

/** Confere antes de enviar: o que falta para o modo pedido. null = pode. */
export function faltaParaGerar(m: MotorDeVideo, e: EntradaDaGeracao): string | null {
  if (e.modo === "avatar" || m.familia === "avatar") {
    if (m.familia !== "avatar" || e.modo !== "avatar") return `${m.rotulo} não faz este tipo de geração.`;
    const f = faltaNoAvatar(e);
    if (f) return f;
    if (m.dialeto === "heygen_foto" && (!e.avatar || e.avatar.tipo !== "foto")) return "Este motor fala a partir de uma foto.";
    if (m.dialeto === "heygen_avatar" && (!e.avatar || e.avatar.tipo !== "estoque")) return "Este motor fala com um avatar de estoque.";
  }
  if (e.modo === "labial" || m.familia === "labial") {
    if (m.familia !== "labial" || e.modo !== "labial") return `${m.rotulo} não faz este tipo de geração.`;
    if (!e.quadro_inicial_url) return "Escolha a foto de quem fala.";
    if (!e.audio_url) return "Escolha o áudio que a pessoa vai falar.";
    if (!(e.duracao_s > 0)) return "Não deu para saber a duração do áudio.";
    if (e.duracao_s > 60) return "Áudio longo demais: até 60 s por vídeo. Divida a fala em partes.";
    return null;
  }
  if (e.modo !== "angulo" && !String(e.prompt || "").trim()) return "Escreva o que acontece no vídeo.";
  if (m.dialeto === "luma" && e.modo !== "texto" && e.duracao_s > 5) return "O Luma a partir de imagem faz só 5 s. Escolha 5 s ou gere pelo texto.";
  if (m.dialeto === "runway") {
    const f = faltaNaRunway(m, e);
    if (f) return f;
  }
  if (e.camera && (!m.cap.camera || !movimentoValido(e.camera))) return m.cap.camera ? "Movimento de câmera desconhecido." : `${m.rotulo} não tem movimentos de câmera prontos.`;
  if ((e.modo === "primeiro_quadro" || e.modo === "primeiro_ultimo" || e.modo === "angulo") && !e.quadro_inicial_url) return "Escolha o quadro inicial.";
  if (e.modo === "primeiro_ultimo" && !e.quadro_final_url) return "Escolha o último quadro.";
  if (e.modo === "estender" && !e.video_url) return "Escolha o vídeo para continuar.";
  if (e.modo === "referencia" && !(e.referencias_urls || []).length && !e.quadro_inicial_url) return "Escolha ao menos uma referência.";
  try {
    endpointDaGeracao(m, e);
  } catch (err) {
    return err instanceof Error ? err.message : "Motor não atende.";
  }
  return null;
}

// ------------------------------------------------------------------ envio e consulta

export interface EnvioAoProvedor {
  n: number;
  request_id: string;
  status_url: string;
  response_url: string;
  endpoint: string;
  estado: "enviado" | "gerando" | "baixando" | "pronto" | "erro";
  enviado_em: string;
  consultado_em: string | null;
  posicao: number | null;
  erro: string | null;
  arquivo_id: string | null;
  storage_path: string | null;
  uso_id: string | null;
  custo_usd: number | null;
  /** Duração real informada pelo provedor (HeyGen cobra por ela). */
  duracao_s?: number | null;
  /** Frente VGN: quantas vezes o resultado pronto não foi guardado (teto na coleta). */
  tentativas_de_baixar?: number;
  /** Frente VGN: quando a pessoa pediu Recuperar (o prazo do motor corre daqui; enviado_em fica intacto). */
  recuperado_em?: string | null;
}

type Buscar = typeof fetch;

/** Motivo curto do erro do provedor (sem ecoar a chave nem o corpo inteiro). */
export function motivoDoProvedor(status: number, corpo: Record<string, unknown> | null): string {
  const d = corpo && (corpo.detail ?? corpo.error ?? corpo.message);
  let t = "";
  if (typeof d === "string") t = d;
  else if (Array.isArray(d) && d.length) {
    const x = d[0] as Record<string, unknown>;
    t = [Array.isArray(x.loc) ? (x.loc as unknown[]).join(".") : "", String(x.msg || "")].filter(Boolean).join(": ");
  }
  if (status === 401 || status === 403) return "O provedor recusou a chave (conferir FAL_KEY).";
  if (status === 402) return "Sem crédito no provedor.";
  if (status === 422) return `O provedor recusou os parâmetros${t ? `: ${t.slice(0, 200)}` : "."}`;
  if (status === 429) return "O provedor pediu para esperar (limite de uso).";
  return `Erro do provedor (${status})${t ? `: ${t.slice(0, 200)}` : ""}`;
}

/** Envia UM pedido à fila do fal. Não repete: erro sobe com o motivo. */
export async function enviarAoFal(endpoint: string, corpo: Record<string, unknown>, o: { chave: string; fetchImpl?: Buscar }): Promise<Pick<EnvioAoProvedor, "request_id" | "status_url" | "response_url">> {
  if (!o.chave) throw new Error("Falta a chave do provedor.");
  const r = await pedirJson(o.fetchImpl || fetch, `${FAL_FILA}${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Key ${o.chave}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  if (r.status < 200 || r.status >= 300 || !r.corpo) throw new Error(motivoDoProvedor(r.status, r.corpo));
  const id = String(r.corpo.request_id || "");
  const st = String(r.corpo.status_url || "");
  const rs = String(r.corpo.response_url || "");
  if (!id || !/^https:\/\//.test(st) || !/^https:\/\//.test(rs)) throw new Error("O provedor não devolveu o número do pedido.");
  return { request_id: id, status_url: st, response_url: rs };
}

/** Lê o status devolvido pelo fal. */
export function lerSituacao(corpo: Record<string, unknown> | null): SituacaoNoProvedor {
  const s = String((corpo && corpo.status) || "");
  const pos = corpo && typeof corpo.queue_position === "number" ? (corpo.queue_position as number) : null;
  if (s === "COMPLETED") {
    const erro = corpo && corpo.error ? String(corpo.error).slice(0, 300) : null;
    return { estado: erro ? "erro" : "pronto", posicao: null, erro };
  }
  if (s === "IN_PROGRESS") return { estado: "gerando", posicao: null, erro: null };
  if (s === "IN_QUEUE") return { estado: "fila", posicao: pos, erro: null };
  return { estado: "erro", posicao: null, erro: s ? `Situação desconhecida: ${s}` : "O provedor não disse a situação." };
}

/** UMA consulta de status (sem repetir). */
export async function consultarNoFal(statusUrl: string, o: { chave: string; fetchImpl?: Buscar }): Promise<SituacaoNoProvedor> {
  const r = await pedirJson(o.fetchImpl || fetch, statusUrl, { method: "GET", headers: { Authorization: `Key ${o.chave}` } });
  if (r.status === 200 || r.status === 202) return lerSituacao(r.corpo);
  return { estado: "erro", posicao: null, erro: motivoDoProvedor(r.status, r.corpo) };
}

/** URLs do resultado (vídeo ou imagens), em qualquer um dos formatos do provedor. */
export function urlsDoResultado(corpo: unknown): { tipo: "video" | "imagem"; urls: string[] } {
  const o = corpo && typeof corpo === "object" ? (corpo as Record<string, unknown>) : {};
  const url = (v: unknown) => (v && typeof v === "object" && typeof (v as { url?: unknown }).url === "string" ? String((v as { url: string }).url) : "");
  const videos: string[] = [];
  if (url(o.video)) videos.push(url(o.video));
  if (Array.isArray(o.videos)) (o.videos as unknown[]).forEach((v) => url(v) && videos.push(url(v)));
  if (videos.length) return { tipo: "video", urls: videos.filter((u) => /^https:\/\//.test(u)) };
  const imagens: string[] = [];
  if (url(o.image)) imagens.push(url(o.image));
  if (Array.isArray(o.images)) (o.images as unknown[]).forEach((v) => url(v) && imagens.push(url(v)));
  return { tipo: "imagem", urls: imagens.filter((u) => /^https:\/\//.test(u)) };
}

/** Busca o resultado (uma vez). */
export async function resultadoDoFal(responseUrl: string, o: { chave: string; fetchImpl?: Buscar }): Promise<{ tipo: "video" | "imagem"; urls: string[] }> {
  const r = await pedirJson(o.fetchImpl || fetch, responseUrl, { method: "GET", headers: { Authorization: `Key ${o.chave}` } });
  if (r.status < 200 || r.status >= 300) throw new Error(motivoDoProvedor(r.status, r.corpo));
  const u = urlsDoResultado(r.corpo);
  if (!u.urls.length) throw new Error("O provedor terminou sem devolver arquivo.");
  return u;
}

// ------------------------------------------------------------------ regras da consulta (sem laço)

/** Pode consultar agora? Só envio em andamento, e com intervalo mínimo desde a última consulta. */
export function podeConsultar(e: Pick<EnvioAoProvedor, "estado" | "consultado_em">, agora: number): boolean {
  if (e.estado !== "enviado" && e.estado !== "gerando") return false;
  if (!e.consultado_em) return true;
  const t = Date.parse(e.consultado_em);
  return !isFinite(t) || agora - t >= INTERVALO_MINIMO_DA_CONSULTA_MS;
}

/**
 * Passou do prazo do motor? O envio ganha aviso e segue conferido; só vira erro
 * no teto duro (ver `passouDoTeto`), depois de uma última pergunta ao provedor.
 */
export function passouDoPrazo(e: Pick<EnvioAoProvedor, "enviado_em" | "recuperado_em">, prazoMin: number, agora: number): boolean {
  // Recuperado: o prazo conta a partir do pedido de Recuperar (enviado_em é a hora real do envio).
  const t = Date.parse(e.recuperado_em || e.enviado_em);
  return isFinite(t) && agora - t > Math.max(1, prazoMin) * 60_000;
}

/**
 * Teto duro do envio (frente MTR, rodada 2): depois do PRAZO do motor o envio
 * NÃO encerra; segue sendo conferido (com aviso) até este teto. A fal (e os
 * outros) terminam e cobram mesmo quando a fila atrasa; encerrar no prazo
 * perdia vídeo pago. 24 h, ou 6x o prazo quando o prazo for maior que 4 h.
 */
export const TETO_DO_ENVIO_MIN = 24 * 60;
export function tetoDoEnvioMin(prazoMin: number): number {
  return Math.max(TETO_DO_ENVIO_MIN, 6 * Math.max(1, prazoMin));
}
export function passouDoTeto(e: Pick<EnvioAoProvedor, "enviado_em" | "recuperado_em">, prazoMin: number, agora: number): boolean {
  return passouDoPrazo(e, tetoDoEnvioMin(prazoMin), agora);
}

/** Texto honesto de quando o envio é encerrado sem o resultado: o provedor pode ter cobrado. */
export function avisoDeCobrancaNoProvedor(requestId: string | null | undefined): string {
  const id = String(requestId || "").trim();
  return `O provedor pode ter cobrado; confira no painel dele${id ? ` (pedido ${id.slice(0, 64)})` : ""} e use Recuperar (busca o resultado de novo, sem gerar outra vez).`;
}

/**
 * Frente MTR (30/09, rodada 2): o que fazer com um envio DEPOIS de perguntar ao provedor.
 *
 * - pronto: baixa e cobra (dentro ou fora do prazo; antes, o vencido se perdia);
 * - erro do provedor: encerra com o motivo (o provedor não cobra erro);
 * - fila/gerando ou consulta que falhou (rede, 5xx):
 *   - dentro do prazo: segue, sem aviso (ou com o motivo da falha);
 *   - depois do prazo: SEGUE com um aviso ("passou do prazo, ainda conferindo");
 *     nunca vira erro por uma consulta só;
 *   - depois do teto duro (24 h): encerra, dizendo que o provedor pode ter cobrado.
 */
export function desfechoDaConsulta(
  s: { estado: "fila" | "gerando" | "pronto" | "erro"; erro?: string | null } | null,
  vencido: boolean,
  prazoMin: number,
  falhaDaConsulta: string | null = null,
  alemDoTeto = false,
  requestId: string | null = null,
): { estado: EnvioAoProvedor["estado"] | null; erro: string | null } {
  if (s && s.estado === "pronto") return { estado: "baixando", erro: null };
  if (s && s.estado === "erro") return { estado: "erro", erro: s.erro || "O provedor recusou o pedido." };
  const falha = falhaDaConsulta ? falhaDaConsulta.slice(0, 160) : null;
  const horas = Math.round(tetoDoEnvioMin(prazoMin) / 60);
  if (alemDoTeto) {
    const motivo = s ? `Passou de ${horas} h sem terminar no provedor.` : `Passou de ${horas} h sem resposta do provedor${falha ? ` (última consulta: ${falha})` : ""}.`;
    return { estado: "erro", erro: `${motivo} ${avisoDeCobrancaNoProvedor(requestId)}` };
  }
  const continua: EnvioAoProvedor["estado"] | null = s && s.estado === "gerando" ? "gerando" : null;
  if (vencido) {
    const onde = !s ? `a consulta falhou${falha ? ` (${falha})` : ""}` : s.estado === "gerando" ? "ainda gerando no provedor" : "ainda na fila do provedor";
    return { estado: continua, erro: `Passou do prazo de ${Math.max(1, prazoMin)} min e ${onde}. Seguimos conferindo por até ${horas} h; nada é cobrado aqui antes de ficar pronto.` };
  }
  // Dentro do prazo: falha de rede não encerra, a próxima consulta tenta.
  if (!s) return { estado: null, erro: falha || "Consulta falhou." };
  return { estado: continua, erro: null };
}

/**
 * Pode "Conferir de novo"? (frente MTR) É a mesma regra do "Recuperar" da frente
 * VGN (`podeRecuperar`, em coleta-de-video.ts): envio que virou erro AQUI (prazo,
 * teto, falta de resposta, motor fora do catálogo ou download não guardado),
 * ainda com o pedido no provedor (request_id) e sem arquivo. Erro do provedor e
 * cancelado não voltam (o provedor já disse que não gerou).
 */
export function podeReconferir(
  e: Pick<EnvioAoProvedor, "estado" | "request_id" | "erro" | "uso_id" | "arquivo_id"> & Partial<Pick<EnvioAoProvedor, "status_url" | "enviado_em">>,
  agora: number = Date.now(),
): boolean {
  return podeRecuperar(e, agora);
}

/** Estado do pedido a partir dos envios (as variações). */
export function estadoDoPedidoPelosEnvios(envios: Pick<EnvioAoProvedor, "estado">[]): "enviado" | "gerando" | "baixando" | "pronto" | "parcial" | "erro" {
  if (!envios.length) return "erro";
  const n = (s: string) => envios.filter((e) => e.estado === s).length;
  if (n("pronto") === envios.length) return "pronto";
  if (n("erro") === envios.length) return "erro";
  if (n("baixando")) return "baixando";
  if (n("gerando")) return "gerando";
  if (n("enviado")) return "enviado";
  return "parcial";
}

/** Chave de idempotência: o mesmo clique (mesmo uid da tela) nunca gera duas vezes. */
export function chaveDaGeracao(tipo: string, uid: string): string {
  const u = String(uid || "").replace(/[^a-z0-9-]/gi, "").slice(0, 64);
  return `${tipo}:${u || "sem-uid"}`;
}

// ------------------------------------------------------------------ provedores (frente V-C, 26/09/2026)

/** O fal na mesma interface dos outros provedores (fila com status e resultado em URLs devolvidas pelo fal). */
export const EXECUTOR_DO_FAL: ExecutorDoProvedor = {
  provedor: "fal",
  rotulo: "fal.ai",
  enviar: (endpoint, corpo, c) => enviarAoFal(endpoint, corpo, { chave: c.chave, fetchImpl: c.fetchImpl }),
  consultar: (e, c) => consultarNoFal(e.status_url, { chave: c.chave, fetchImpl: c.fetchImpl }),
  resultado: (e, c) => resultadoDoFal(e.response_url, { chave: c.chave, fetchImpl: c.fetchImpl }),
};

const EXECUTORES: Record<string, ExecutorDoProvedor> = {
  fal: EXECUTOR_DO_FAL,
  runway: EXECUTOR_DA_RUNWAY,
  higgsfield: EXECUTOR_DA_HIGGSFIELD,
  heygen: EXECUTOR_DA_HEYGEN,
};

/** Executor do provedor do motor (null = provedor sem executor: "a integrar"). */
export function executorDoProvedor(provedor: string | null | undefined): ExecutorDoProvedor | null {
  return (provedor && Object.prototype.hasOwnProperty.call(EXECUTORES, provedor) && EXECUTORES[provedor]) || null;
}

/** O provedor deixa cancelar pela API? (Runway e Higgsfield sim; fal e HeyGen não por aqui.) */
export const provedorCancela = (provedor: string | null | undefined): boolean => {
  const x = executorDoProvedor(provedor);
  return !!(x && x.cancelar);
};

/** Credenciais pelos NOMES dos segredos (quem chama lê o ambiente; aqui só monta). */
export function credenciaisPorNome(m: Pick<MotorDeVideo, "chave_env" | "segredo_env">, ler: (nome: string) => string): Credenciais {
  return { chave: m.chave_env ? ler(m.chave_env) : "", segredo: m.segredo_env ? ler(m.segredo_env) : null };
}
