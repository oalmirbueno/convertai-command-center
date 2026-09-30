/**
 * Executor da HeyGen: avatar falando (frente V-C, 26/09/2026). Docs:
 * developers.heygen.com (API v3; a v1 e a v2 saem do ar em 31/10/2026).
 * Resumo em docs/video/PESQUISA-GERADOR.md, seção 9.
 *
 *   enviar:    POST https://api.heygen.com/v3/videos   (X-Api-Key: <HEYGEN_API_KEY>, Idempotency-Key)
 *              avatar de estoque: { type: "avatar", avatar_id, script, voice_id, engine: { type: "avatar_iv" }, ... }
 *              foto que fala:     { type: "image", image: { type: "url", url }, script, voice_id, ... }
 *              -> { data: { video_id, status: "waiting" } }
 *   consultar: GET  /v3/videos/{id} -> { data: { status: pending | processing | completed | failed, video_url,
 *              captioned_video_url, thumbnail_url, duration, failure_code, failure_message } }
 *   listas:    GET  /v3/avatars/looks (o id do "look" é o avatar_id) e GET /v3/voices?language=Portuguese
 *
 * Sem cancelamento na API (DELETE /v3/videos/{id} apaga para sempre e a doc não
 * diz se para a geração): a mesa não oferece cancelar aqui.
 * Pessoa real (foto de um clone): SÓ com a autorização de uso de imagem válida
 * do clone, a mesma regra da Mesa Foto (`cloneLiberadoParaVideo`). A HeyGen
 * exige o consentimento explícito da pessoa retratada (heygen.com/moderation-policy).
 * SEM LAÇO: uma chamada por função; a chave de idempotência evita pagar duas
 * vezes o mesmo envio.
 */

import { type MotorDeVideo, resolucaoNoMotor } from "./modelos-de-video.ts";
import type { EntradaDaGeracao } from "./video-executor.ts";
import {
  codigoDoCorpo,
  type Credenciais,
  detalheDoCorpo,
  type EnviadoAoProvedor,
  ErroDoProvedor,
  type ExecutorDoProvedor,
  fraseDoErro,
  idDoPedidoSeguro,
  numeroOuNulo,
  pedirJson,
  type RefDoEnvio,
  type ResultadoDoProvedor,
  semVazios,
  type SituacaoNoProvedor,
  soHttps,
} from "./video-provedor-comum.ts";

export const HEYGEN_BASE = "https://api.heygen.com";
export const HEYGEN_CHAVE = "HEYGEN_API_KEY";
const NOME = "A HeyGen";

/** Roteiro por vídeo (a HeyGen aceita 5.000 letras; a mesa limita para o custo caber na confirmação). */
export const ROTEIRO_MAX_CARACTERES = 3000;
/** Ritmo de fala para a estimativa (um pouco devagar: a estimativa fica por cima). */
export const PALAVRAS_POR_SEGUNDO = 2.3;

export type FonteDoAvatar = "estoque" | "foto";

export interface EntradaDoAvatar {
  tipo: FonteDoAvatar;
  /** Id do look da HeyGen (avatar de estoque). */
  avatar_id?: string | null;
  /** URL assinada da foto (clone): a HeyGen baixa na hora. */
  foto_url?: string | null;
  voz_id: string;
  legendas: boolean;
  /** 0,5 a 1,5. */
  velocidade?: number | null;
  /** "pt-BR" quando a voz aceita sotaque por locale. */
  locale?: string | null;
  titulo?: string | null;
}

/** Duração estimada da fala (s), para o custo antes. Pausas de pontuação contam. */
export function duracaoEstimadaDaFala(texto: string, velocidade = 1): number {
  const t = String(texto || "").trim();
  if (!t) return 0;
  const palavras = t.split(/\s+/).filter(Boolean).length;
  const pausas = (t.match(/[.!?;:]/g) || []).length;
  const v = Math.max(0.5, Math.min(1.5, Number(velocidade) || 1));
  return Math.max(3, Math.ceil(palavras / (PALAVRAS_POR_SEGUNDO * v) + pausas * 0.3) + 1);
}

/** O que falta no pedido de avatar (null = pode). */
export function faltaNoAvatar(e: Pick<EntradaDaGeracao, "prompt" | "avatar">): string | null {
  const roteiro = String(e.prompt || "").trim();
  if (!roteiro) return "Escreva o roteiro.";
  if (roteiro.length > ROTEIRO_MAX_CARACTERES) return `Roteiro longo demais (até ${ROTEIRO_MAX_CARACTERES} letras por vídeo).`;
  const a = e.avatar;
  if (!a) return "Escolha quem fala.";
  if (!String(a.voz_id || "").trim()) return "Escolha a voz.";
  if (a.tipo === "estoque" && !String(a.avatar_id || "").trim()) return "Escolha o avatar.";
  if (a.tipo === "foto" && !soHttps(a.foto_url)) return "Falta a foto de quem fala.";
  return null;
}

/** Proporções que a HeyGen aceita (as quatro da mesa). */
const PROPORCOES = ["9:16", "16:9", "1:1", "4:5"];

/** Corpo do POST /v3/videos. */
export function corpoDoAvatar(m: MotorDeVideo, e: EntradaDaGeracao): Record<string, unknown> {
  const falta = faltaNoAvatar(e);
  if (falta) throw new Error(falta);
  const a = e.avatar as EntradaDoAvatar;
  const velocidade = Math.max(0.5, Math.min(1.5, Number(a.velocidade) || 1));
  const base = {
    script: String(e.prompt || "").trim().slice(0, ROTEIRO_MAX_CARACTERES),
    voice_id: String(a.voz_id).trim(),
    voice_settings: semVazios({ speed: velocidade, locale: a.locale || undefined }),
    resolution: resolucaoNoMotor(m, e.resolucao),
    aspect_ratio: PROPORCOES.indexOf(e.formato) >= 0 ? e.formato : "9:16",
    // Com estilo, a legenda sai gravada no vídeo (captioned_video_url); sem, só o arquivo .srt.
    caption: a.legendas ? { file_format: "srt", style: "default" } : undefined,
    title: a.titulo ? String(a.titulo).slice(0, 120) : undefined,
  };
  if (a.tipo === "foto") return semVazios({ type: "image", image: { type: "url", url: a.foto_url }, ...base });
  return semVazios({ type: "avatar", avatar_id: String(a.avatar_id).trim(), engine: { type: "avatar_iv" }, ...base });
}

const cabecalhos = (c: Credenciais, extra: Record<string, string> = {}): Record<string, string> => ({ "X-Api-Key": c.chave, Accept: "application/json", ...extra });

/** Erro HTTP da HeyGen ({ error: { code, message } }) em frase clara. */
export function erroDaHeygen(status: number, corpo: Record<string, unknown> | null): ErroDoProvedor {
  const codigo = codigoDoCorpo(corpo);
  const d = detalheDoCorpo(corpo);
  if (status === 401 || codigo === "unauthorized") return new ErroDoProvedor("chave_invalida", fraseDoErro("chave_invalida", NOME, HEYGEN_CHAVE), status);
  if (status === 403) return new ErroDoProvedor("chave_invalida", `A chave da HeyGen não tem a permissão pedida (conferir ${HEYGEN_CHAVE} e as permissões de vídeo, avatar e voz).`, status);
  if (status === 402 || /insufficient_credit|trial_limit|subscription_required|plan_upgrade/.test(codigo)) return new ErroDoProvedor("sem_credito", fraseDoErro("sem_credito", "HeyGen", HEYGEN_CHAVE), status);
  if (status === 429 || codigo === "rate_limit_exceeded" || codigo === "quota_exceeded") return new ErroDoProvedor("limite_de_uso", fraseDoErro("limite_de_uso", NOME, HEYGEN_CHAVE, "até 10 vídeos ao mesmo tempo"), status);
  if (codigo === "content_policy_violation" || codigo === "avatar_not_usable") return new ErroDoProvedor("conteudo_recusado", fraseDoErro("conteudo_recusado", NOME, HEYGEN_CHAVE, d), status);
  if (codigo === "download_failed") return new ErroDoProvedor("parametros", "A HeyGen não conseguiu baixar a foto. Confira se a foto do clone ainda está no acervo.", status);
  if (codigo === "voice_unavailable") return new ErroDoProvedor("parametros", "Essa voz não está disponível na HeyGen. Escolha outra.", status);
  if (status === 409) return new ErroDoProvedor("provedor", "A HeyGen já está gerando este mesmo pedido.", status);
  if (status === 400 || status === 422) return new ErroDoProvedor("parametros", fraseDoErro("parametros", NOME, HEYGEN_CHAVE, d), status);
  if (status >= 500) return new ErroDoProvedor("indisponivel", fraseDoErro("indisponivel", NOME, HEYGEN_CHAVE), status);
  return new ErroDoProvedor("provedor", fraseDoErro("provedor", "HeyGen", HEYGEN_CHAVE, `${status}${d ? ` ${d}` : ""}`), status);
}

const dados = (corpo: Record<string, unknown> | null): Record<string, unknown> => {
  const d = corpo && corpo.data;
  return d && typeof d === "object" && !Array.isArray(d) ? (d as Record<string, unknown>) : corpo || {};
};

/** Lê o status do vídeo. */
export function lerVideoDaHeygen(corpo: Record<string, unknown> | null): SituacaoNoProvedor {
  const d = dados(corpo);
  const s = String(d.status || "");
  if (s === "waiting" || s === "pending") return { estado: "fila", posicao: null, erro: null };
  if (s === "processing") return { estado: "gerando", posicao: null, erro: null };
  if (s === "completed") {
    const duracao = numeroOuNulo(d.duration);
    return soHttps(d.video_url) ? { estado: "pronto", posicao: null, erro: null, duracao_s: duracao } : { estado: "erro", posicao: null, erro: "A HeyGen terminou sem devolver o vídeo." };
  }
  if (s === "failed") {
    const codigo = String(d.failure_code || "");
    const msg = String(d.failure_message || "").replace(/\s+/g, " ").trim().slice(0, 160);
    if (/policy|moderat|content|nsfw|consent/i.test(`${codigo} ${msg}`)) return { estado: "erro", posicao: null, erro: `A HeyGen recusou o conteúdo (moderação)${msg ? `: ${msg}` : ""}. Nada foi cobrado.` };
    return { estado: "erro", posicao: null, erro: `Falha na HeyGen${msg ? `: ${msg}` : codigo ? `: ${codigo}` : ""}. Nada foi cobrado.` };
  }
  return { estado: "erro", posicao: null, erro: s ? `Situação desconhecida na HeyGen: ${s}` : "A HeyGen não disse a situação." };
}

const urlDoVideo = (id: string) => `${HEYGEN_BASE}/v3/videos/${encodeURIComponent(id)}`;

/** Envia UM vídeo. Não repete (a chave de idempotência protege de pagar duas vezes). */
export async function enviarNaHeygen(endpoint: string, corpo: Record<string, unknown>, c: Credenciais, o: { idempotencia?: string | null } = {}): Promise<EnviadoAoProvedor> {
  if (!c.chave) throw new ErroDoProvedor("chave_invalida", `Falta a chave da HeyGen (${HEYGEN_CHAVE}).`);
  if (endpoint !== "v3/videos") throw new ErroDoProvedor("parametros", "Rota da HeyGen fora da lista.");
  const extra: Record<string, string> = { "Content-Type": "application/json" };
  const idem = String(o.idempotencia || "").replace(/[^A-Za-z0-9_:-]/g, "").slice(0, 120);
  if (idem) extra["Idempotency-Key"] = idem;
  const r = await pedirJson(c.fetchImpl || fetch, `${HEYGEN_BASE}/v3/videos`, { method: "POST", headers: cabecalhos(c, extra), body: JSON.stringify(corpo) });
  if (r.status < 200 || r.status >= 300 || !r.corpo) throw erroDaHeygen(r.status, r.corpo);
  const d = dados(r.corpo);
  const id = idDoPedidoSeguro(d.video_id || d.id);
  if (!id) throw new ErroDoProvedor("provedor", "A HeyGen não devolveu o número do vídeo.");
  return { request_id: id, status_url: urlDoVideo(id), response_url: urlDoVideo(id) };
}

async function lerVideo(e: RefDoEnvio, c: Credenciais) {
  const id = idDoPedidoSeguro(e.request_id);
  if (!id) throw new ErroDoProvedor("parametros", "Número do vídeo da HeyGen inválido.");
  return await pedirJson(c.fetchImpl || fetch, urlDoVideo(id), { method: "GET", headers: cabecalhos(c) });
}

export async function consultarNaHeygen(e: RefDoEnvio, c: Credenciais): Promise<SituacaoNoProvedor> {
  const r = await lerVideo(e, c);
  if (r.status === 404) return { estado: "erro", posicao: null, erro: "O vídeo não existe mais na HeyGen. Nada foi cobrado." };
  if (r.status < 200 || r.status >= 300) throw erroDaHeygen(r.status, r.corpo);
  return lerVideoDaHeygen(r.corpo);
}

/** Busca de novo (os links são assinados e vencem): vídeo, versão legendada, miniatura e duração. */
export async function resultadoDaHeygen(e: RefDoEnvio, c: Credenciais): Promise<ResultadoDoProvedor> {
  const r = await lerVideo(e, c);
  if (r.status < 200 || r.status >= 300) throw erroDaHeygen(r.status, r.corpo);
  const d = dados(r.corpo);
  const video = soHttps(d.video_url);
  if (String(d.status || "") !== "completed" || !video) throw new ErroDoProvedor("provedor", "A HeyGen ainda não tem o vídeo pronto.");
  return { tipo: "video", urls: [video], legendado_url: soHttps(d.captioned_video_url) || null, miniatura_url: soHttps(d.thumbnail_url) || null, duracao_s: numeroOuNulo(d.duration) };
}

export const EXECUTOR_DA_HEYGEN: ExecutorDoProvedor = {
  provedor: "heygen",
  rotulo: "HeyGen",
  enviar: (endpoint, corpo, c, o) => enviarNaHeygen(endpoint, corpo, c, o),
  consultar: consultarNaHeygen,
  resultado: resultadoDaHeygen,
};

// ------------------------------------------------------------------ avatares e vozes (listas grátis)

export interface AvatarDaHeygen {
  id: string;
  nome: string;
  genero: string | null;
  previa: string | null;
  voz_padrao: string | null;
  orientacao: string | null;
}

export interface VozDaHeygen {
  id: string;
  nome: string;
  genero: string | null;
  idioma: string;
  previa: string | null;
  aceita_locale: boolean;
  /** Parece português do Brasil pelo nome ou pelo idioma. */
  brasil: boolean;
}

/** Itens de uma lista da HeyGen, em qualquer um dos formatos (data[], data.items, data.looks, data.voices). */
function itensDaLista(corpo: Record<string, unknown> | null, chaves: string[]): { itens: Record<string, unknown>[]; proximo: string | null } {
  const c = corpo || {};
  const d = c.data;
  let itens: unknown[] = [];
  if (Array.isArray(d)) itens = d;
  else if (d && typeof d === "object") {
    const o = d as Record<string, unknown>;
    const k = chaves.find((x) => Array.isArray(o[x]));
    if (k) itens = o[k] as unknown[];
  } else {
    const k = chaves.find((x) => Array.isArray(c[x]));
    if (k) itens = c[k] as unknown[];
  }
  const dd = d && typeof d === "object" && !Array.isArray(d) ? (d as Record<string, unknown>) : {};
  const proximo = String(c.next_token || dd.next_token || c.token || "") || null;
  const temMais = c.has_more === false || dd.has_more === false ? false : true;
  return { itens: itens.filter((x): x is Record<string, unknown> => !!x && typeof x === "object"), proximo: temMais ? proximo : null };
}

const textoOuNulo = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null);

export function normalizarAvataresDaHeygen(corpo: Record<string, unknown> | null): { itens: AvatarDaHeygen[]; proximo: string | null } {
  const { itens, proximo } = itensDaLista(corpo, ["looks", "items", "avatars"]);
  const saida: AvatarDaHeygen[] = [];
  itens.forEach((x) => {
    const id = idDoPedidoSeguro(x.id || x.look_id || x.avatar_id);
    if (!id) return;
    // Só looks que o motor Avatar IV aceita (quando a HeyGen informa).
    const motores = Array.isArray(x.supported_api_engines) ? (x.supported_api_engines as unknown[]).map(String) : null;
    if (motores && motores.length && motores.indexOf("avatar_iv") < 0) return;
    if (x.status && String(x.status) !== "completed" && String(x.status) !== "ready" && String(x.status) !== "active") return;
    saida.push({ id, nome: textoOuNulo(x.name) || id, genero: textoOuNulo(x.gender), previa: soHttps(x.preview_image_url) || null, voz_padrao: textoOuNulo(x.default_voice_id), orientacao: textoOuNulo(x.preferred_orientation) });
  });
  return { itens: saida, proximo };
}

export function normalizarVozesDaHeygen(corpo: Record<string, unknown> | null): { itens: VozDaHeygen[]; proximo: string | null } {
  const { itens, proximo } = itensDaLista(corpo, ["voices", "items"]);
  const saida: VozDaHeygen[] = [];
  itens.forEach((x) => {
    const id = String(x.voice_id || x.id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 128);
    const idioma = String(x.language || "");
    if (!id || !/portug/i.test(idioma)) return;
    const nome = textoOuNulo(x.name) || id;
    saida.push({ id, nome, genero: textoOuNulo(x.gender), idioma, previa: soHttps(x.preview_audio_url || x.preview_audio) || null, aceita_locale: x.support_locale === true, brasil: /bra[sz]il|pt-br/i.test(`${nome} ${idioma} ${String(x.locale || "")}`) });
  });
  // Brasil primeiro, depois o nome.
  saida.sort((a, b) => (a.brasil === b.brasil ? a.nome.localeCompare(b.nome) : a.brasil ? -1 : 1));
  return { itens: saida, proximo };
}

/** UMA página de avatares de estoque (públicos). */
export async function listarAvataresDaHeygen(c: Credenciais, token?: string | null): Promise<{ itens: AvatarDaHeygen[]; proximo: string | null }> {
  if (!c.chave) throw new ErroDoProvedor("chave_invalida", `Falta a chave da HeyGen (${HEYGEN_CHAVE}).`);
  const t = token ? `&token=${encodeURIComponent(String(token).slice(0, 300))}` : "";
  const r = await pedirJson(c.fetchImpl || fetch, `${HEYGEN_BASE}/v3/avatars/looks?avatar_type=studio_avatar&ownership=public&limit=50${t}`, { method: "GET", headers: cabecalhos(c) });
  if (r.status < 200 || r.status >= 300) throw erroDaHeygen(r.status, r.corpo);
  return normalizarAvataresDaHeygen(r.corpo);
}

/** UMA página de vozes em português (públicas). */
export async function listarVozesDaHeygen(c: Credenciais, token?: string | null): Promise<{ itens: VozDaHeygen[]; proximo: string | null }> {
  if (!c.chave) throw new ErroDoProvedor("chave_invalida", `Falta a chave da HeyGen (${HEYGEN_CHAVE}).`);
  const t = token ? `&token=${encodeURIComponent(String(token).slice(0, 300))}` : "";
  const r = await pedirJson(c.fetchImpl || fetch, `${HEYGEN_BASE}/v3/voices?type=public&language=Portuguese&limit=100${t}`, { method: "GET", headers: cabecalhos(c) });
  if (r.status < 200 || r.status >= 300) throw erroDaHeygen(r.status, r.corpo);
  return normalizarVozesDaHeygen(r.corpo);
}

// ------------------------------------------------------------------ pessoa real: a autorização do clone

export interface CloneParaVideo {
  id?: string | null;
  client_id?: string | null;
  origem?: string | null;
  status?: string | null;
  autorizacao?: unknown;
}

/**
 * A foto de um clone pode virar pessoa falando? Mesma regra da Mesa Foto
 * (clones-regras.ts, autorizacaoValida): autorização confirmada, sem
 * revogação, dentro da validade, pessoa adulta e ciente de que é IA; clone
 * do próprio cliente e não arquivado.
 */
export function cloneLiberadoParaVideo(c: CloneParaVideo | null | undefined, clientId: string, hoje: string = new Date().toISOString().slice(0, 10)): { ok: boolean; motivo: string | null } {
  if (!c || !c.id) return { ok: false, motivo: "Clone não encontrado." };
  if (c.origem !== "clone_de_foto_real") return { ok: false, motivo: "Esta pessoa não é um clone com foto real." };
  if (String(c.client_id || "") !== clientId) return { ok: false, motivo: "Este clone é de outro cliente." };
  if (c.status === "arquivada") return { ok: false, motivo: "O clone está arquivado." };
  const a = c.autorizacao && typeof c.autorizacao === "object" ? (c.autorizacao as Record<string, unknown>) : null;
  if (!a || a.confirmada !== true) return { ok: false, motivo: "Clone sem autorização de imagem registrada. Registre a autorização na Mesa Foto, em Clones." };
  if (a.revogada_em) return { ok: false, motivo: "A autorização desta pessoa foi revogada: nada novo pode ser gerado." };
  if (typeof a.validade === "string" && a.validade && a.validade < hoje) return { ok: false, motivo: "A autorização desta pessoa venceu: registre uma nova." };
  if (a.sabe_que_e_ia !== true) return { ok: false, motivo: "A autorização não diz que a pessoa sabe que o conteúdo é gerado por IA." };
  if (a.adulta !== true) return { ok: false, motivo: "A autorização não confirma que a pessoa é adulta." };
  return { ok: true, motivo: null };
}
