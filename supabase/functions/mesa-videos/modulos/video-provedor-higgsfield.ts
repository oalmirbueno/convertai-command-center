/**
 * Executor da Higgsfield (frente V-C, 26/09/2026). Docs: docs.higgsfield.ai
 * (API atual, por request_id; resumo em docs/video/PESQUISA-GERADOR.md, seção 9).
 *
 *   enviar:    POST https://api.higgsfield.ai/higgsfield/cinema-studio/4.0
 *              Authorization: Key <HIGGSFIELD_API_KEY>:<HIGGSFIELD_API_SECRET>  (a chave é um PAR: id e segredo)
 *              -> { status: "queued", request_id, status_url, cancel_url }
 *   consultar: GET  /requests/{id}/status -> { status: queued | in_progress | completed | failed | nsfw | canceled, video: { url } }
 *   cancelar:  POST /requests/{id}/cancel (202 cancelado; 400 já começou: só cancela na fila)
 *
 * Câmera: o Cinema Studio 4.0 tem `camera_movement` com 33 movimentos prontos
 * (a antiga lista /v1/motions do DoP saiu da API atual). Sem 402 nem 429: 403 é
 * falta de crédito e 400 "concurrent" é o limite de 4 pedidos ao mesmo tempo.
 * Falha e conteúdo recusado (nsfw) não são cobrados pela Higgsfield.
 * Uma chamada por função, com Idempotency-Key por pedido/variação.
 */

import { duracaoNoMotor, type MotorDeVideo, resolucaoNoMotor } from "./modelos-de-video.ts";
import type { EntradaDaGeracao } from "./video-executor.ts";
import {
  type Credenciais,
  detalheDoCorpo,
  type EnviadoAoProvedor,
  ErroDoProvedor,
  type ExecutorDoProvedor,
  fraseDoErro,
  idDoPedidoSeguro,
  pedirJson,
  type RefDoEnvio,
  type ResultadoDoProvedor,
  semVazios,
  type SituacaoNoProvedor,
  soHttps,
} from "./video-provedor-comum.ts";

export const HIGGSFIELD_BASE = "https://api.higgsfield.ai";
export const HIGGSFIELD_CHAVE = "HIGGSFIELD_API_KEY";
export const HIGGSFIELD_SEGREDO = "HIGGSFIELD_API_SECRET";
const NOME = "A Higgsfield";
const CHAVES = `${HIGGSFIELD_CHAVE} e ${HIGGSFIELD_SEGREDO}`;

/** Rotas que a mesa usa (lista fechada). */
export const ROTAS_DA_HIGGSFIELD = ["higgsfield/cinema-studio/4.0"];

export interface MovimentoDaHiggsfield {
  valor: string;
  rotulo: string;
  grupo: string;
}

/** Movimentos de câmera do Cinema Studio 4.0 (enum camera_movement), com nome em português. */
export const MOVIMENTOS_DA_HIGGSFIELD: MovimentoDaHiggsfield[] = [
  { valor: "static-shot", rotulo: "Parada", grupo: "Básicos" },
  { valor: "handheld", rotulo: "Na mão", grupo: "Básicos" },
  { valor: "pov", rotulo: "Ponto de vista (POV)", grupo: "Básicos" },
  { valor: "rack-focus", rotulo: "Troca de foco", grupo: "Básicos" },
  { valor: "dolly-in", rotulo: "Aproximar (dolly in)", grupo: "Aproximar e afastar" },
  { valor: "dolly-out", rotulo: "Afastar (dolly out)", grupo: "Aproximar e afastar" },
  { valor: "dolly-zoom", rotulo: "Dolly zoom (vertigem)", grupo: "Aproximar e afastar" },
  { valor: "crush-zoom", rotulo: "Zoom brusco", grupo: "Aproximar e afastar" },
  { valor: "slow-zoom-in", rotulo: "Zoom lento para perto", grupo: "Aproximar e afastar" },
  { valor: "slow-zoom-out", rotulo: "Zoom lento para longe", grupo: "Aproximar e afastar" },
  { valor: "crane-up", rotulo: "Grua subindo", grupo: "Subir e descer" },
  { valor: "crane-down", rotulo: "Grua descendo", grupo: "Subir e descer" },
  { valor: "tilt-up", rotulo: "Inclinar para cima", grupo: "Subir e descer" },
  { valor: "tilt-down", rotulo: "Inclinar para baixo", grupo: "Subir e descer" },
  { valor: "pedestal-up", rotulo: "Subir reto", grupo: "Subir e descer" },
  { valor: "pedestal-down", rotulo: "Descer reto", grupo: "Subir e descer" },
  { valor: "pan-left", rotulo: "Panorâmica à esquerda", grupo: "Girar e acompanhar" },
  { valor: "pan-right", rotulo: "Panorâmica à direita", grupo: "Girar e acompanhar" },
  { valor: "whip-pan", rotulo: "Chicote (whip pan)", grupo: "Girar e acompanhar" },
  { valor: "arc-left", rotulo: "Arco à esquerda", grupo: "Girar e acompanhar" },
  { valor: "arc-right", rotulo: "Arco à direita", grupo: "Girar e acompanhar" },
  { valor: "truck-left", rotulo: "Lateral à esquerda", grupo: "Girar e acompanhar" },
  { valor: "truck-right", rotulo: "Lateral à direita", grupo: "Girar e acompanhar" },
  { valor: "slider-left", rotulo: "Slider à esquerda", grupo: "Girar e acompanhar" },
  { valor: "slider-right", rotulo: "Slider à direita", grupo: "Girar e acompanhar" },
  { valor: "side-tracking", rotulo: "Acompanhar de lado", grupo: "Girar e acompanhar" },
  { valor: "tracking", rotulo: "Acompanhar", grupo: "Girar e acompanhar" },
  { valor: "drone-orbit", rotulo: "Órbita de drone", grupo: "Aéreos" },
  { valor: "aerial-pullback", rotulo: "Afastar pelo alto", grupo: "Aéreos" },
  { valor: "helicopter-shot", rotulo: "Helicóptero", grupo: "Aéreos" },
  { valor: "bullet-time", rotulo: "Bullet time", grupo: "Especiais" },
  { valor: "snorricam", rotulo: "Presa ao corpo (snorricam)", grupo: "Especiais" },
  { valor: "robot-arm", rotulo: "Braço robótico", grupo: "Especiais" },
];

export const movimentoValido = (v: unknown): string | null => (MOVIMENTOS_DA_HIGGSFIELD.some((m) => m.valor === v) ? String(v) : null);

/** Movimento da mesa (Cena do roteiro) no movimento da Higgsfield. */
const DA_MESA: Record<string, string> = { parada: "static-shot", travelling: "tracking", pan: "pan-right", orbita: "arc-right", zoom_lento: "slow-zoom-in", na_mao: "handheld", subida: "crane-up" };
export const movimentoDaMesaNaHiggsfield = (v: string | null | undefined): string | null => (v && DA_MESA[v]) || null;

/** Formato da mesa na proporção da Higgsfield (4:5 não existe: vai 3:4). */
const PROPORCAO: Record<string, string> = { "9:16": "9:16", "16:9": "16:9", "1:1": "1:1", "4:5": "3:4", "3:4": "3:4", "4:3": "4:3", "21:9": "21:9" };

/** Corpo do pedido do Cinema Studio 4.0. A imagem entra como referência (image_urls). */
export function corpoDaHiggsfield(m: MotorDeVideo, e: EntradaDaGeracao): Record<string, unknown> {
  const refs = (e.referencias_urls || []).slice(0, Math.max(0, m.cap.referencias));
  const imagens = (e.quadro_inicial_url ? [e.quadro_inicial_url] : []).concat(refs).slice(0, 30);
  const camera = movimentoValido(e.camera);
  if (e.camera && !camera) throw new Error("Movimento de câmera desconhecido.");
  return semVazios({
    prompt: String(e.prompt || "").trim().slice(0, 2400),
    image_urls: imagens,
    camera_movement: camera,
    duration: duracaoNoMotor(m, e.duracao_s),
    resolution: resolucaoNoMotor(m, e.resolucao),
    aspect_ratio: PROPORCAO[e.formato] || "9:16",
    generate_audio: !!e.audio && m.cap.audio,
  });
}

const cabecalhos = (c: Credenciais, json = true): Record<string, string> => {
  const h: Record<string, string> = { Authorization: `Key ${c.chave}:${c.segredo || ""}` };
  if (json) h["Content-Type"] = "application/json";
  return h;
};

/** Erro HTTP da Higgsfield em frase clara. */
export function erroDaHiggsfield(status: number, corpo: Record<string, unknown> | null): ErroDoProvedor {
  const d = detalheDoCorpo(corpo);
  if (status === 401) return new ErroDoProvedor("chave_invalida", fraseDoErro("chave_invalida", NOME, CHAVES), status);
  if (status === 403 || status === 402) return new ErroDoProvedor("sem_credito", fraseDoErro("sem_credito", "Higgsfield", CHAVES), status);
  if (status === 429 || (status === 400 && /concurrent/i.test(d))) return new ErroDoProvedor("limite_de_uso", fraseDoErro("limite_de_uso", NOME, CHAVES, "até 4 pedidos ao mesmo tempo"), status);
  if (status === 400 || status === 422) {
    if (/nsfw|moderat|safety/i.test(d)) return new ErroDoProvedor("conteudo_recusado", fraseDoErro("conteudo_recusado", NOME, CHAVES, d), status);
    return new ErroDoProvedor("parametros", fraseDoErro("parametros", NOME, CHAVES, d), status);
  }
  if (status === 404) return new ErroDoProvedor("parametros", fraseDoErro("parametros", NOME, CHAVES, "modelo ou pedido não encontrado"), status);
  if (status === 423 || status === 503 || status >= 500) return new ErroDoProvedor("indisponivel", fraseDoErro("indisponivel", NOME, CHAVES, status === 423 ? "modelo bloqueado por um tempo" : ""), status);
  return new ErroDoProvedor("provedor", fraseDoErro("provedor", "Higgsfield", CHAVES, `${status}${d ? ` ${d}` : ""}`), status);
}

/** URL do vídeo na resposta (video.url, videos[].url). */
export function urlsDaHiggsfield(corpo: Record<string, unknown> | null): string[] {
  const o = corpo || {};
  const url = (v: unknown) => (v && typeof v === "object" ? soHttps((v as { url?: unknown }).url) : "");
  const saida: string[] = [];
  if (url(o.video)) saida.push(url(o.video));
  if (Array.isArray(o.videos)) (o.videos as unknown[]).forEach((v) => url(v) && saida.push(url(v)));
  return saida;
}

/** Lê o status da Higgsfield. */
export function lerStatusDaHiggsfield(corpo: Record<string, unknown> | null): SituacaoNoProvedor {
  const s = String((corpo && corpo.status) || "");
  if (s === "queued") return { estado: "fila", posicao: null, erro: null };
  if (s === "in_progress") return { estado: "gerando", posicao: null, erro: null };
  if (s === "completed") return urlsDaHiggsfield(corpo).length ? { estado: "pronto", posicao: null, erro: null } : { estado: "erro", posicao: null, erro: "A Higgsfield terminou sem devolver o vídeo." };
  if (s === "nsfw") return { estado: "erro", posicao: null, erro: "A Higgsfield recusou o conteúdo (moderação). Nada foi cobrado." };
  if (s === "failed") {
    const d = detalheDoCorpo(corpo);
    return { estado: "erro", posicao: null, erro: `Falha na Higgsfield${d ? `: ${d.slice(0, 160)}` : ""}. Nada foi cobrado.` };
  }
  if (s === "canceled" || s === "cancelled") return { estado: "erro", posicao: null, erro: "Cancelado na Higgsfield. Nada foi cobrado." };
  return { estado: "erro", posicao: null, erro: s ? `Situação desconhecida na Higgsfield: ${s}` : "A Higgsfield não disse a situação." };
}

const urlDoStatus = (id: string) => `${HIGGSFIELD_BASE}/requests/${encodeURIComponent(id)}/status`;

/** Envia UM pedido. Não repete. */
export async function enviarNaHiggsfield(endpoint: string, corpo: Record<string, unknown>, c: Credenciais, opcoes?: { idempotencia?: string | null }): Promise<EnviadoAoProvedor> {
  if (!c.chave || !c.segredo) throw new ErroDoProvedor("chave_invalida", `Falta a chave da Higgsfield (${CHAVES}).`);
  if (ROTAS_DA_HIGGSFIELD.indexOf(endpoint) < 0) throw new ErroDoProvedor("parametros", "Rota da Higgsfield fora da lista.");
  const r = await pedirJson(c.fetchImpl || fetch, `${HIGGSFIELD_BASE}/${endpoint}`, { method: "POST", headers: { ...cabecalhos(c), ...(opcoes?.idempotencia ? { "Idempotency-Key": opcoes.idempotencia } : {}) }, body: JSON.stringify(corpo) });
  if (r.status < 200 || r.status >= 300 || !r.corpo) throw erroDaHiggsfield(r.status, r.corpo);
  const id = idDoPedidoSeguro(r.corpo.request_id);
  if (!id) throw new ErroDoProvedor("provedor", "A Higgsfield não devolveu o número do pedido.");
  return { request_id: id, status_url: urlDoStatus(id), response_url: urlDoStatus(id) };
}

async function lerStatus(e: RefDoEnvio, c: Credenciais) {
  const id = idDoPedidoSeguro(e.request_id);
  if (!id) throw new ErroDoProvedor("parametros", "Número do pedido da Higgsfield inválido.");
  return await pedirJson(c.fetchImpl || fetch, urlDoStatus(id), { method: "GET", headers: cabecalhos(c, false) });
}

/** UMA consulta (404 = pedido que sumiu; o resto sobe e a próxima consulta tenta). */
export async function consultarNaHiggsfield(e: RefDoEnvio, c: Credenciais): Promise<SituacaoNoProvedor> {
  const r = await lerStatus(e, c);
  if (r.status === 404) return { estado: "erro", posicao: null, erro: "O pedido não existe mais na Higgsfield. Nada foi cobrado." };
  if (r.status < 200 || r.status >= 300) throw erroDaHiggsfield(r.status, r.corpo);
  return lerStatusDaHiggsfield(r.corpo);
}

export async function resultadoDaHiggsfield(e: RefDoEnvio, c: Credenciais): Promise<ResultadoDoProvedor> {
  const r = await lerStatus(e, c);
  if (r.status < 200 || r.status >= 300) throw erroDaHiggsfield(r.status, r.corpo);
  const urls = urlsDaHiggsfield(r.corpo);
  if (String((r.corpo && r.corpo.status) || "") !== "completed" || !urls.length) throw new ErroDoProvedor("provedor", "A Higgsfield ainda não tem o vídeo pronto.");
  return { tipo: "video", urls };
}

/** Cancela na fila. true = cancelado; false = já começou (a Higgsfield só cancela na fila). */
export async function cancelarNaHiggsfield(e: RefDoEnvio, c: Credenciais): Promise<boolean> {
  const id = idDoPedidoSeguro(e.request_id);
  if (!id) return false;
  const r = await pedirJson(c.fetchImpl || fetch, `${HIGGSFIELD_BASE}/requests/${encodeURIComponent(id)}/cancel`, { method: "POST", headers: cabecalhos(c, false) });
  if (r.status === 202 || r.status === 200 || r.status === 204) return true;
  if (r.status === 400) return false;
  throw erroDaHiggsfield(r.status, r.corpo);
}

export const EXECUTOR_DA_HIGGSFIELD: ExecutorDoProvedor = {
  provedor: "higgsfield",
  rotulo: "Higgsfield",
  enviar: (endpoint, corpo, c, opcoes) => enviarNaHiggsfield(endpoint, corpo, c, opcoes),
  consultar: consultarNaHiggsfield,
  resultado: resultadoDaHiggsfield,
  cancelar: cancelarNaHiggsfield,
};
