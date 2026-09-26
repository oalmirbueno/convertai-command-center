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
 * por motor; passou do prazo, o envio vira erro registrado. Erro do provedor
 * NÃO é tentado de novo: fica registrado com o motivo.
 *
 * Puro onde dá: o corpo de cada motor, a leitura do resultado e as regras de
 * consulta são funções sem rede (testadas). As chamadas recebem a chave e o
 * fetch por parâmetro (a função passa Deno.env; o teste passa um falso).
 */

import { type AnguloDeCamera, parametrosDoAngulo, promptDoAngulo, type ManterNoAngulo } from "./video-angulo.ts";
import { duracaoNoMotor, type MotorDeVideo, resolucaoNoMotor } from "./modelos-de-video.ts";

export const FAL_FILA = "https://queue.fal.run/";
export const TIMEOUT_DO_PROVEDOR_MS = 20_000;
/** Entre duas consultas do mesmo envio (a tela aberta em duas abas não martela o provedor). */
export const INTERVALO_MINIMO_DA_CONSULTA_MS = 15_000;
export const VARIACOES_MAX = 4;

export type ModoDaGeracao = "texto" | "primeiro_quadro" | "primeiro_ultimo" | "referencia" | "estender" | "angulo";

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
}

const semVazios = (o: Record<string, unknown>) => {
  const s: Record<string, unknown> = {};
  Object.keys(o).forEach((k) => {
    const v = o[k];
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) return;
    s[k] = v;
  });
  return s;
};

/** Qual endpoint do motor atende ao modo. Lança Error com a frase quando nenhum. */
export function endpointDaGeracao(m: MotorDeVideo, e: Pick<EntradaDaGeracao, "modo" | "quadro_inicial_url" | "quadro_final_url">): string {
  const ep = m.endpoints;
  let alvo: string | undefined;
  if (e.modo === "angulo") alvo = ep.angulo;
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
    case "seedance":
      if (e.modo === "estender") return semVazios({ prompt, task: "extension", video_urls: e.video_url ? [e.video_url] : [], duration: String(d), resolution: r, generate_audio: audio, seed });
      if (e.modo === "referencia") return semVazios({ prompt, task: "reference", image_urls: ini ? [ini].concat(refs) : refs, duration: String(d), aspect_ratio: ar, resolution: r, generate_audio: audio, seed });
      return semVazios({ prompt, image_url: ini, end_image_url: fim, duration: String(d), aspect_ratio: ar, resolution: r, generate_audio: audio, seed });
    case "kling": {
      const elementos = refs.length ? [{ frontal_image_url: refs[0], reference_image_urls: refs.slice(1, 4) }] : [];
      if (e.modo === "estender") return semVazios({ prompt, video_url: e.video_url, duration: String(d), elements: elementos, generate_audio: audio });
      return semVazios({ prompt, start_image_url: ini, end_image_url: fim, duration: String(d), aspect_ratio: ini ? undefined : ar, negative_prompt: e.negativo, generate_audio: audio, elements: elementos });
    }
    case "veo": {
      const base = { prompt, duration: `${d}s`, resolution: r, aspect_ratio: ar === "9:16" || ar === "16:9" ? ar : "auto", generate_audio: audio, negative_prompt: e.negativo, seed };
      if (e.modo === "estender") return semVazios({ ...base, video_url: e.video_url, duration: "7s" });
      if (e.modo === "primeiro_ultimo") return semVazios({ ...base, first_frame_url: ini, last_frame_url: e.quadro_final_url });
      if (e.modo === "referencia") return semVazios({ ...base, image_urls: (ini ? [ini] : []).concat(refs).slice(0, 3) });
      return semVazios({ ...base, image_url: ini });
    }
    case "gemini_omni":
      if (e.modo === "referencia") return semVazios({ prompt, image_urls: (ini ? [ini] : []).concat(refs).slice(0, 3), resolution: r, aspect_ratio: ar });
      return semVazios({ prompt, image_url: ini, end_image_url: fim, resolution: r, aspect_ratio: ar });
    case "wan3":
      return semVazios({ prompt, start_image_url: e.modo === "referencia" ? undefined : ini, end_image_url: fim, reference_image_urls: e.modo === "referencia" ? (ini ? [ini] : []).concat(refs) : undefined, duration: d, resolution: r, aspect_ratio: ar, audio, negative_prompt: e.negativo, seed });
    case "minimax_h3": {
      const R = r.toUpperCase();
      if (e.modo === "estender") return semVazios({ prompt, video_url: e.video_url, duration: d, resolution: R, output: "continuation", seed });
      return semVazios({ prompt, image_url: ini, end_image_url: fim, duration: d, resolution: R, aspect_ratio: ini ? undefined : ar, seed });
    }
    case "hailuo":
      return semVazios({ prompt, image_url: ini, duration: String(d), prompt_optimizer: true });
    case "happyhorse":
      return semVazios({ prompt, image_url: ini, duration: d, resolution: r, aspect_ratio: ini ? undefined : ar, seed });
    case "flux3":
      if (e.modo === "estender") return semVazios({ prompt, video_url: e.video_url, duration: d, resolution: r, generate_audio: audio });
      if (e.modo === "primeiro_ultimo") return semVazios({ prompt, keyframes: [{ image_url: ini, frame_index: 0 }, { image_url: e.quadro_final_url, frame_index: d * 24 - 1 }], duration: d, resolution: r, aspect_ratio: ar, generate_audio: audio });
      return semVazios({ prompt, image_url: ini, duration: d, resolution: r, aspect_ratio: ini ? undefined : ar, generate_audio: audio });
    case "grok":
      if (e.modo === "estender") return semVazios({ prompt, video_url: e.video_url, duration: Math.min(10, d) });
      return semVazios({ prompt, image_url: ini, duration: d, resolution: r });
    case "pixverse":
      return semVazios({ prompt, image_url: ini, duration: d, resolution: r, aspect_ratio: ini ? undefined : ar, negative_prompt: e.negativo, seed, generate_audio_switch: audio });
    case "ltx":
      if (e.modo === "estender") return semVazios({ prompt, video_url: e.video_url, duration: d, mode: "end" });
      return semVazios({ prompt, image_url: ini, end_image_url: fim, duration: d, resolution: r, aspect_ratio: ini ? undefined : ar, generate_audio: audio });
    case "hunyuan":
      return semVazios({ prompt, image_url: ini, aspect_ratio: ini ? undefined : ar, seed });
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
  if (e.modo !== "angulo" && !String(e.prompt || "").trim()) return "Escreva o que acontece no vídeo.";
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
}

type Buscar = typeof fetch;

async function pedirJson(f: Buscar, url: string, init: RequestInit, timeoutMs = TIMEOUT_DO_PROVEDOR_MS): Promise<{ status: number; corpo: Record<string, unknown> | null }> {
  let r: Response;
  // AbortSignal.timeout existe no Deno; onde não existe (testes), vai sem prazo.
  const A = AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal };
  const sinal = typeof A.timeout === "function" ? A.timeout(timeoutMs) : undefined;
  try {
    r = await f(url, { ...init, signal: sinal });
  } catch (e) {
    const nome = e instanceof Error ? e.name : "";
    throw new Error(nome === "TimeoutError" || nome === "AbortError" ? "O provedor não respondeu a tempo." : "Falha de rede com o provedor.");
  }
  const texto = await r.text().catch(() => "");
  let corpo: Record<string, unknown> | null = null;
  try {
    corpo = texto ? (JSON.parse(texto) as Record<string, unknown>) : null;
  } catch {
    corpo = null;
  }
  return { status: r.status, corpo };
}

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

export type SituacaoNoProvedor = { estado: "fila" | "gerando" | "pronto" | "erro"; posicao: number | null; erro: string | null };

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

/** Passou do prazo do motor? (o envio vira erro registrado e para de ser consultado) */
export function passouDoPrazo(e: Pick<EnvioAoProvedor, "enviado_em">, prazoMin: number, agora: number): boolean {
  const t = Date.parse(e.enviado_em);
  return isFinite(t) && agora - t > Math.max(1, prazoMin) * 60_000;
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
