/**
 * Ponte com a API da ElevenLabs (frente MOV, 30/09/2026): voz (text-to-speech
 * com tempo por caractere), biblioteca de vozes, desenho de voz, clone de voz,
 * efeitos sonoros e música. Só `fetch`: sem SDK, sem npm; o teste injeta o
 * fetch. A chave (ELEVENLABS_API_KEY) fica só no servidor e nunca volta na
 * resposta nem no erro.
 *
 * Endpoints (docs em elevenlabs.io/docs/api-reference, 30/09/2026):
 *   POST /v1/text-to-speech/{voice_id}/with-timestamps  (json: audio_base64 + alignment)
 *   GET  /v2/voices                                    (search, page_size, next_page_token)
 *   GET  /v1/shared-voices                             (Voice Library pública: language, locale, accent, search, page)
 *   POST /v1/voices/add/{public_user_id}/{voice_id}    (traz a voz da Voice Library para a conta)
 *   POST /v1/text-to-voice/design                      (3 prévias com generated_voice_id)
 *   POST /v1/text-to-voice                             (a prévia escolhida vira voz)
 *   POST /v1/voices/add                                (clone instantâneo, multipart)
 *   POST /v1/sound-generation                          (efeito, bytes de áudio)
 *   POST /v1/music                                     (trilha, bytes de áudio)
 * Sem travessão.
 */

export const BASE_DA_ELEVENLABS = "https://api.elevenlabs.io";
export const CHAVE_DA_ELEVENLABS = "ELEVENLABS_API_KEY";
export const FORMATO_DO_AUDIO = "mp3_44100_128";

export type CodigoDaVoz =
  | "voz_sem_chave"
  | "voz_chave_invalida"
  | "voz_pagamento_pendente"
  | "voz_sem_credito"
  | "voz_nao_encontrada"
  | "voz_limite_de_pedidos"
  | "voz_pedido_invalido"
  | "voz_indisponivel"
  | "voz_resposta_invalida";

const MENSAGENS: Record<CodigoDaVoz, { status: number; mensagem: string }> = {
  voz_sem_chave: { status: 503, mensagem: "A narração precisa da chave da ElevenLabs no servidor (ELEVENLABS_API_KEY). Peça a um admin para cadastrar a chave nos segredos das funções." },
  voz_chave_invalida: { status: 503, mensagem: "A chave da ElevenLabs cadastrada no servidor foi recusada. Um admin precisa trocar a ELEVENLABS_API_KEY." },
  voz_pagamento_pendente: { status: 402, mensagem: "A conta da ElevenLabs está com pagamento pendente. Quite a fatura em elevenlabs.io e tente de novo." },
  voz_sem_credito: { status: 402, mensagem: "Os créditos do mês da conta da ElevenLabs acabaram. Aumente o plano ou espere a renovação." },
  voz_nao_encontrada: { status: 404, mensagem: "Esta voz não existe mais na conta da ElevenLabs. Escolha outra voz." },
  voz_limite_de_pedidos: { status: 429, mensagem: "A ElevenLabs pediu uma pausa (muitos pedidos ao mesmo tempo). Tente de novo em instantes." },
  voz_pedido_invalido: { status: 422, mensagem: "A ElevenLabs recusou o pedido." },
  voz_indisponivel: { status: 503, mensagem: "A ElevenLabs não respondeu agora. Tente de novo em instantes." },
  voz_resposta_invalida: { status: 502, mensagem: "A ElevenLabs respondeu num formato inesperado." },
};

export class ErroDaVoz extends Error {
  codigo: CodigoDaVoz;
  status: number;
  constructor(codigo: CodigoDaVoz, detalhe?: string) {
    const m = MENSAGENS[codigo];
    super(detalhe ? `${m.mensagem} ${detalhe}` : m.mensagem);
    this.name = "ErroDaVoz";
    this.codigo = codigo;
    this.status = m.status;
  }
}

type Fetch = typeof fetch;
export interface Conexao {
  chave: string;
  fetchImpl?: Fetch;
  timeoutMs?: number;
}

/** A chave do servidor (vazia quando não existe: a tela explica o que falta). */
export function chaveDaElevenLabs(ler: (nome: string) => string | undefined): string {
  return String(ler(CHAVE_DA_ELEVENLABS) || "").trim();
}

/** Frase curta do detalhe da ElevenLabs, sem eco de chave nem de texto enviado. */
function detalheCurto(corpo: unknown): { codigo: string; status: string; mensagem: string } {
  const o = corpo && typeof corpo === "object" ? (corpo as Record<string, unknown>) : {};
  const d = o.detail && typeof o.detail === "object" ? (o.detail as Record<string, unknown>) : o;
  const msg = typeof o.detail === "string" ? o.detail : typeof d.message === "string" ? d.message : "";
  return { codigo: String(d.code || d.type || ""), status: String(d.status || ""), mensagem: msg.replace(/sk_[A-Za-z0-9]+/g, "[chave]").slice(0, 200) };
}

/** Status e corpo de erro da ElevenLabs no nosso código (o que a tela mostra). */
export function erroDaResposta(status: number, corpo: unknown): ErroDaVoz {
  const d = detalheCurto(corpo);
  const tudo = `${d.codigo} ${d.status} ${d.mensagem}`.toLowerCase();
  if (/payment|invoice/.test(tudo)) return new ErroDaVoz("voz_pagamento_pendente");
  if (/voice_limit|voices_limit/.test(tudo)) return new ErroDaVoz("voz_pedido_invalido", "A conta chegou ao limite de vozes próprias: remova uma voz na ElevenLabs.");
  if (/quota|credits|insufficient/.test(tudo) || status === 402) return new ErroDaVoz("voz_sem_credito");
  if (status === 401 || /invalid_api_key|unauthorized|api key/.test(tudo)) return new ErroDaVoz("voz_chave_invalida");
  if (status === 404 || /voice_not_found/.test(tudo)) return new ErroDaVoz("voz_nao_encontrada");
  if (status === 429 || /too_many|rate|concurrent/.test(tudo)) return new ErroDaVoz("voz_limite_de_pedidos");
  if (status === 400 || status === 422) return new ErroDaVoz("voz_pedido_invalido", d.mensagem ? `Motivo: ${d.mensagem}` : undefined);
  return new ErroDaVoz("voz_indisponivel");
}

async function pedir(c: Conexao, caminho: string, init: RequestInit & { json?: unknown }): Promise<Response> {
  if (!c.chave) throw new ErroDaVoz("voz_sem_chave");
  const f = c.fetchImpl || fetch;
  const headers: Record<string, string> = { "xi-api-key": c.chave, ...((init.headers as Record<string, string>) || {}) };
  let body = init.body;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  let r: Response;
  try {
    r = await f(`${BASE_DA_ELEVENLABS}${caminho}`, { method: init.method || "GET", headers, body, signal: AbortSignal.timeout(c.timeoutMs || 120_000) });
  } catch {
    throw new ErroDaVoz("voz_indisponivel");
  }
  if (!r.ok) {
    const corpo = await r.json().catch(() => null);
    throw erroDaResposta(r.status, corpo);
  }
  return r;
}

/** base64 em bytes (sem Buffer: Deno e navegador). */
export function bytesDoBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ------------------------------------------------------------------ voz

export interface PedidoDeFala {
  voiceId: string;
  texto: string;
  modelo: string;
  idioma: string | null;
  voiceSettings: Record<string, number | boolean>;
  anterior?: string | null;
  proximo?: string | null;
  semente?: number | null;
}

export interface FalaGerada {
  bytes: Uint8Array;
  alinhamento: unknown;
  requestId: string | null;
}

export async function falar(c: Conexao, p: PedidoDeFala): Promise<FalaGerada> {
  if (!/^[A-Za-z0-9]{8,64}$/.test(p.voiceId)) throw new ErroDaVoz("voz_nao_encontrada");
  const corpo: Record<string, unknown> = { text: p.texto, model_id: p.modelo, voice_settings: p.voiceSettings, apply_text_normalization: "auto" };
  if (p.idioma) corpo.language_code = p.idioma;
  if (p.anterior) corpo.previous_text = p.anterior.slice(0, 1000);
  if (p.proximo) corpo.next_text = p.proximo.slice(0, 1000);
  if (typeof p.semente === "number") corpo.seed = p.semente;
  const r = await pedir(c, `/v1/text-to-speech/${p.voiceId}/with-timestamps?output_format=${FORMATO_DO_AUDIO}`, { method: "POST", json: corpo });
  const j = (await r.json().catch(() => null)) as { audio_base64?: string; alignment?: unknown } | null;
  if (!j || typeof j.audio_base64 !== "string" || !j.audio_base64) throw new ErroDaVoz("voz_resposta_invalida");
  return { bytes: bytesDoBase64(j.audio_base64), alinhamento: j.alignment || null, requestId: r.headers.get("request-id") };
}

// ------------------------------------------------------------------ biblioteca

export interface VozDaBiblioteca {
  voice_id: string;
  nome: string;
  categoria: string;
  descricao: string;
  previa_url: string | null;
  idiomas: string[];
  rotulos: Record<string, string>;
  /** Prévia no português, quando a voz tem. */
  previa_pt: string | null;
}

export async function listarVozes(c: Conexao, o: { busca?: string; proxima?: string | null; tamanho?: number }): Promise<{ vozes: VozDaBiblioteca[]; proxima: string | null }> {
  const q = new URLSearchParams();
  q.set("page_size", String(Math.max(5, Math.min(60, o.tamanho || 30))));
  if (o.busca) q.set("search", o.busca.slice(0, 80));
  if (o.proxima) q.set("next_page_token", o.proxima.slice(0, 400));
  q.set("include_total_count", "false");
  const r = await pedir(c, `/v2/voices?${q.toString()}`, { method: "GET" });
  const j = (await r.json().catch(() => null)) as { voices?: unknown[]; next_page_token?: string | null; has_more?: boolean } | null;
  if (!j || !Array.isArray(j.voices)) throw new ErroDaVoz("voz_resposta_invalida");
  const vozes = j.voices
    .map((v) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {}))
    .filter((v) => typeof v.voice_id === "string")
    .map((v) => {
      const langs = (Array.isArray(v.verified_languages) ? v.verified_languages : []).map((l) => (l && typeof l === "object" ? (l as Record<string, unknown>) : {}));
      const pt = langs.find((l) => l.language === "pt" && typeof l.preview_url === "string");
      const rotulos: Record<string, string> = {};
      const lb = v.labels && typeof v.labels === "object" ? (v.labels as Record<string, unknown>) : {};
      Object.keys(lb).slice(0, 8).forEach((k) => (rotulos[k] = String(lb[k]).slice(0, 40)));
      return {
        voice_id: String(v.voice_id),
        nome: String(v.name || "Voz").slice(0, 80),
        categoria: String(v.category || "").slice(0, 30),
        descricao: String(v.description || "").slice(0, 300),
        previa_url: typeof v.preview_url === "string" ? v.preview_url : null,
        idiomas: Array.from(new Set(langs.map((l) => String(l.language || "")).filter(Boolean))).slice(0, 12),
        rotulos,
        previa_pt: pt ? String(pt.preview_url) : null,
      };
    });
  return { vozes, proxima: j.has_more && j.next_page_token ? String(j.next_page_token) : null };
}

// ------------------------------------------------------------------ Voice Library compartilhada

export interface VozCompartilhada extends VozDaBiblioteca {
  /** Dono público da voz (para trazer a voz para a conta). */
  public_owner_id: string;
  sotaque: string;
  genero: string;
  idade: string;
  /** pt-BR, pt-PT... quando a ElevenLabs informa. */
  locale: string | null;
}

/**
 * A Voice Library pública da ElevenLabs (milhares de vozes da comunidade),
 * filtrada por idioma (português por padrão), sotaque e gênero. Só lista:
 * a voz entra na conta da agência quando a equipe escolhe (adicionarVozCompartilhada).
 */
export async function listarVozesCompartilhadas(c: Conexao, o: { busca?: string; idioma?: string; locale?: string | null; sotaque?: string | null; genero?: string | null; pagina?: number; tamanho?: number }): Promise<{ vozes: VozCompartilhada[]; proxima: number | null }> {
  const q = new URLSearchParams();
  const pagina = Math.max(0, Math.min(50, Math.floor(o.pagina || 0)));
  q.set("page_size", String(Math.max(5, Math.min(60, o.tamanho || 30))));
  q.set("page", String(pagina));
  q.set("language", (o.idioma || "pt").slice(0, 8));
  if (o.locale) q.set("locale", o.locale.slice(0, 12));
  if (o.sotaque) q.set("accent", o.sotaque.slice(0, 40));
  if (o.genero === "female" || o.genero === "male" || o.genero === "neutral") q.set("gender", o.genero);
  if (o.busca) q.set("search", o.busca.slice(0, 80));
  q.set("sort", "trending");
  const r = await pedir(c, `/v1/shared-voices?${q.toString()}`, { method: "GET" });
  const j = (await r.json().catch(() => null)) as { voices?: unknown[]; has_more?: boolean } | null;
  if (!j || !Array.isArray(j.voices)) throw new ErroDaVoz("voz_resposta_invalida");
  const vozes = j.voices
    .map((v) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {}))
    .filter((v) => typeof v.voice_id === "string" && typeof v.public_owner_id === "string")
    .map((v) => {
      const langs = (Array.isArray(v.verified_languages) ? v.verified_languages : []).map((l) => (l && typeof l === "object" ? (l as Record<string, unknown>) : {}));
      const pt = langs.find((l) => l.language === "pt" && typeof l.preview_url === "string");
      const idiomas = Array.from(new Set([String(v.language || "")].concat(langs.map((l) => String(l.language || ""))).filter(Boolean))).slice(0, 12);
      const rotulos: Record<string, string> = {};
      ["accent", "gender", "age", "descriptive", "use_case"].forEach((k) => {
        if (typeof v[k] === "string" && v[k]) rotulos[k] = String(v[k]).slice(0, 40);
      });
      return {
        voice_id: String(v.voice_id),
        public_owner_id: String(v.public_owner_id),
        nome: String(v.name || "Voz").slice(0, 80),
        categoria: String(v.category || "").slice(0, 30),
        descricao: String(v.description || "").slice(0, 300),
        previa_url: typeof v.preview_url === "string" ? v.preview_url : null,
        idiomas,
        rotulos,
        previa_pt: pt ? String(pt.preview_url) : null,
        sotaque: String(v.accent || "").slice(0, 40),
        genero: String(v.gender || "").slice(0, 20),
        idade: String(v.age || "").slice(0, 20),
        locale: typeof v.locale === "string" && v.locale ? v.locale.slice(0, 12) : null,
      };
    });
  return { vozes, proxima: j.has_more ? pagina + 1 : null };
}

/** Traz uma voz da Voice Library para a conta da agência (devolve o voice_id na conta). */
export async function adicionarVozCompartilhada(c: Conexao, p: { publicOwnerId: string; voiceId: string; nome: string }): Promise<string> {
  if (!/^[A-Za-z0-9]{8,80}$/.test(p.publicOwnerId) || !/^[A-Za-z0-9]{8,64}$/.test(p.voiceId)) throw new ErroDaVoz("voz_nao_encontrada");
  const r = await pedir(c, `/v1/voices/add/${p.publicOwnerId}/${p.voiceId}`, { method: "POST", json: { new_name: p.nome.slice(0, 80) || "Voz" } });
  const j = (await r.json().catch(() => null)) as { voice_id?: string } | null;
  if (!j || typeof j.voice_id !== "string") throw new ErroDaVoz("voz_resposta_invalida");
  return j.voice_id;
}

// ------------------------------------------------------------------ desenho e clone

export interface PreviaDesenhada {
  generated_voice_id: string;
  bytes: Uint8Array;
  duracao_s: number;
}

export async function desenharVoz(c: Conexao, p: { descricao: string; texto?: string | null; modelo: string }): Promise<{ previas: PreviaDesenhada[]; texto: string }> {
  const corpo: Record<string, unknown> = { voice_description: p.descricao.slice(0, 1000), model_id: p.modelo };
  if (p.texto && p.texto.length >= 100) corpo.text = p.texto.slice(0, 1000);
  else corpo.auto_generate_text = true;
  const r = await pedir(c, `/v1/text-to-voice/design?output_format=${FORMATO_DO_AUDIO}`, { method: "POST", json: corpo });
  const j = (await r.json().catch(() => null)) as { previews?: unknown[]; text?: string } | null;
  if (!j || !Array.isArray(j.previews)) throw new ErroDaVoz("voz_resposta_invalida");
  const previas = j.previews
    .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {}))
    .filter((x) => typeof x.generated_voice_id === "string" && typeof x.audio_base_64 === "string")
    .slice(0, 3)
    .map((x) => ({ generated_voice_id: String(x.generated_voice_id), bytes: bytesDoBase64(String(x.audio_base_64)), duracao_s: Number(x.duration_secs) || 0 }));
  if (!previas.length) throw new ErroDaVoz("voz_resposta_invalida");
  return { previas, texto: String(j.text || "") };
}

export async function salvarVozDesenhada(c: Conexao, p: { generatedVoiceId: string; nome: string; descricao: string }): Promise<string> {
  const r = await pedir(c, "/v1/text-to-voice", { method: "POST", json: { voice_name: p.nome.slice(0, 80), voice_description: p.descricao.slice(0, 1000), generated_voice_id: p.generatedVoiceId } });
  const j = (await r.json().catch(() => null)) as { voice_id?: string } | null;
  if (!j || typeof j.voice_id !== "string") throw new ErroDaVoz("voz_resposta_invalida");
  return j.voice_id;
}

export async function clonarVoz(c: Conexao, p: { nome: string; descricao: string; arquivos: Array<{ nome: string; tipo: string; bytes: Uint8Array }>; removerRuido: boolean }): Promise<{ voice_id: string; precisa_verificar: boolean }> {
  const form = new FormData();
  form.append("name", p.nome.slice(0, 80));
  if (p.descricao) form.append("description", p.descricao.slice(0, 500));
  form.append("remove_background_noise", p.removerRuido ? "true" : "false");
  form.append("labels", JSON.stringify({ language: "pt" }));
  p.arquivos.forEach((a) => form.append("files", new Blob([a.bytes as Uint8Array<ArrayBuffer>], { type: a.tipo || "audio/mpeg" }), a.nome));
  const r = await pedir(c, "/v1/voices/add", { method: "POST", body: form });
  const j = (await r.json().catch(() => null)) as { voice_id?: string; requires_verification?: boolean } | null;
  if (!j || typeof j.voice_id !== "string") throw new ErroDaVoz("voz_resposta_invalida");
  return { voice_id: j.voice_id, precisa_verificar: j.requires_verification === true };
}

// ------------------------------------------------------------------ efeitos e música

export async function gerarEfeito(c: Conexao, p: { texto: string; duracao_s: number; modelo: string }): Promise<Uint8Array> {
  const r = await pedir(c, `/v1/sound-generation?output_format=${FORMATO_DO_AUDIO}`, {
    method: "POST",
    json: { text: p.texto.slice(0, 450), duration_seconds: Math.max(0.5, Math.min(30, p.duracao_s)), prompt_influence: 0.5, model_id: p.modelo },
  });
  return new Uint8Array(await r.arrayBuffer());
}

export async function comporMusica(c: Conexao, p: { prompt: string; duracao_s: number; modelo: string }): Promise<Uint8Array> {
  const r = await pedir(c, `/v1/music?output_format=${FORMATO_DO_AUDIO}`, {
    method: "POST",
    json: { prompt: p.prompt, music_length_ms: Math.round(Math.max(10, Math.min(300, p.duracao_s)) * 1000), model_id: p.modelo, force_instrumental: true },
  });
  return new Uint8Array(await r.arrayBuffer());
}
