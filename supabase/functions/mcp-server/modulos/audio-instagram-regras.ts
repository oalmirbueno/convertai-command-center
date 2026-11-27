/**
 * MCP 2.39.3 (26/11/2026): regras puras do áudio do Reel e da música sugerida.
 *
 * Um único lugar para a validação que vale nas tools novas
 * (aceleriq_buscar_audios_instagram, aceleriq_definir_audio_reel,
 * aceleriq_definir_musica_sugerida) e no campo opcional audio_configuration
 * das tools que já criam ou agendam publicação. Sem banco, sem rede, sem Deno.
 *
 * O que a Meta aceita (doc oficial, changelog 01/06/2026):
 * - audio_configuration {"audio_id", "audio_volume" 1..100, "video_volume" 1..100}
 *   só no contêiner media_type=REELS. Carrossel, imagem e story recusam.
 * - O publicador do painel (public.editorial_autopublish_tick) manda REELS quando
 *   editorial_posts.content_type está em ('reel', 'video', 'short') (_kind = 'video').
 *   TIPOS_DE_REEL segue exatamente essa regra.
 */

/** content_type que o publicador manda como REELS (_kind = 'video'). */
export const TIPOS_DE_REEL = ['reel', 'video', 'short'] as const;

/** Mesmo formato do CHECK da tabela editorial_publication_audio. */
export const FORMATO_DO_AUDIO_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const LIMITES_DA_MUSICA = { titulo: 200, artista: 200, url: 2000, nota: 500 } as const;

export const MENSAGEM_SO_REEL = 'a Meta só aceita audio_configuration em Reels; use musica_sugerida (aceleriq_definir_musica_sugerida) para carrossel, imagem ou story.';
export const MENSAGEM_SO_INSTAGRAM = 'audio_configuration só existe na publicação do Instagram (Reel). Para outra rede, use musica_sugerida.';
export const MENSAGEM_AGUARDANDO_MIGRACAO =
  'Recurso aguardando a migração aprovada pelo Almir (2026-11-26 instagram-audio-e-musica-sugerida). Nada foi gravado; o resto do pedido segue normal.';
export const AVISO_DOWNLOAD_URL =
  'A Meta também entrega um download_url de cada áudio, mas ele expira em cerca de 1,5 dia e não é devolvido aqui: para o Reel basta o audio_id.';

export function ehReel(contentType: string | null | undefined): boolean {
  return !!contentType && (TIPOS_DE_REEL as readonly string[]).includes(contentType);
}

export type AudioConfiguration = { audio_id: string; audio_volume?: number; video_volume?: number };
export type Validado<T> = { ok: true; valor: T } | { ok: false; erro: string };

/** Volume da Meta: inteiro de 1 a 100. Ausente/null = padrão da Meta (100). Decimal, string, 0 ou 101 recusa. */
export function validarVolume(nome: string, v: unknown): Validado<number | null> {
  if (v === undefined || v === null) return { ok: true, valor: null };
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 100) {
    return { ok: false, erro: `${nome} precisa ser um número inteiro de 1 a 100 (sem aspas, sem casas decimais).` };
  }
  return { ok: true, valor: v };
}

/** audio_id em texto (id da Meta é número grande: como number perderia dígitos). */
export function validarAudioId(v: unknown): Validado<string> {
  if (typeof v !== 'string') return { ok: false, erro: 'audio_id precisa vir como texto (o id que aceleriq_buscar_audios_instagram devolve), entre aspas.' };
  const id = v.trim();
  if (!FORMATO_DO_AUDIO_ID.test(id)) return { ok: false, erro: 'audio_id inválido: use o id devolvido por aceleriq_buscar_audios_instagram.' };
  return { ok: true, valor: id };
}

const CAMPOS_DA_CONFIGURACAO = new Set(['audio_id', 'audio_volume', 'video_volume']);

/** audio_configuration completo, sem campo a mais. */
export function validarAudioConfiguration(raw: unknown): Validado<AudioConfiguration> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, erro: 'audio_configuration precisa ser um objeto {audio_id, audio_volume?, video_volume?}.' };
  }
  const o = raw as Record<string, unknown>;
  const extra = Object.keys(o).filter((k) => !CAMPOS_DA_CONFIGURACAO.has(k));
  if (extra.length) return { ok: false, erro: `audio_configuration não aceita: ${extra.join(', ')}.` };
  const id = validarAudioId(o.audio_id);
  if (!id.ok) return id;
  const av = validarVolume('audio_volume', o.audio_volume);
  if (!av.ok) return av;
  const vv = validarVolume('video_volume', o.video_volume);
  if (!vv.ok) return vv;
  return {
    ok: true,
    valor: {
      audio_id: id.valor,
      ...(av.valor !== null ? { audio_volume: av.valor } : {}),
      ...(vv.valor !== null ? { video_volume: vv.valor } : {}),
    },
  };
}

/** O conteúdo aceita áudio da Meta? null = aceita. */
export function problemaDoAudioNoConteudo(alvo: { content_type: string | null | undefined; platform?: string | null }): string | null {
  if (!ehReel(alvo.content_type)) return MENSAGEM_SO_REEL;
  if (alvo.platform !== undefined && alvo.platform !== null && alvo.platform !== 'instagram') return MENSAGEM_SO_INSTAGRAM;
  return null;
}

/** Publicação que ainda pode receber o áudio (o mesmo que a RPC confere). */
export function problemaNaPublicacaoParaAudio(status: string | null | undefined): string | null {
  if (status === 'published') return 'A publicação já saiu no Instagram: o áudio não muda mais por aqui.';
  if (status === 'cancelled') return 'A publicação está cancelada: reabrir é ação humana na Agenda.';
  return null;
}

export type MusicaSugerida = { titulo: string; artista: string | null; url: string | null; nota: string | null };

function textoOpcional(nome: string, v: unknown, teto: number): Validado<string | null> {
  if (v === undefined || v === null) return { ok: true, valor: null };
  if (typeof v !== 'string') return { ok: false, erro: `${nome} precisa ser texto.` };
  const t = v.trim();
  if (!t) return { ok: true, valor: null };
  if (t.length > teto) return { ok: false, erro: `${nome} passa de ${teto} caracteres.` };
  return { ok: true, valor: t };
}

/** Só https, URL válida, sem usuário/senha embutidos. */
export function validarUrlHttps(v: unknown): Validado<string | null> {
  const t = textoOpcional('url', v, LIMITES_DA_MUSICA.url);
  if (!t.ok || t.valor === null) return t;
  let u: URL;
  try {
    u = new URL(t.valor);
  } catch {
    return { ok: false, erro: 'url inválida: use um link https completo.' };
  }
  if (u.protocol !== 'https:' || !/^https:\/\//i.test(t.valor)) return { ok: false, erro: 'url precisa começar com https:// (http e outros esquemas são recusados).' };
  if (u.username || u.password) return { ok: false, erro: 'url não pode ter usuário ou senha.' };
  return { ok: true, valor: t.valor };
}

/** Vale para qualquer tipo de post (carrossel, imagem, reel, story). */
export function validarMusicaSugerida(raw: { titulo?: unknown; artista?: unknown; url?: unknown; nota?: unknown }): Validado<MusicaSugerida> {
  if (typeof raw.titulo !== 'string' || !raw.titulo.trim()) return { ok: false, erro: 'titulo é obrigatório (1 a 200 caracteres).' };
  const titulo = raw.titulo.trim();
  if (titulo.length > LIMITES_DA_MUSICA.titulo) return { ok: false, erro: 'titulo passa de 200 caracteres.' };
  const artista = textoOpcional('artista', raw.artista, LIMITES_DA_MUSICA.artista);
  if (!artista.ok) return artista;
  const url = validarUrlHttps(raw.url);
  if (!url.ok) return url;
  const nota = textoOpcional('nota', raw.nota, LIMITES_DA_MUSICA.nota);
  if (!nota.ok) return nota;
  return { ok: true, valor: { titulo, artista: artista.valor, url: url.valor, nota: nota.valor } };
}

// ------------------------------------------------------------------ migração ainda não aplicada

/** RPC que não existe no banco (PostgREST PGRST202 ou Postgres 42883). */
export function ehRpcAusente(e: unknown): boolean {
  const o = (e && typeof e === 'object' ? e : {}) as { code?: unknown; message?: unknown };
  const code = String(o.code ?? '');
  if (code === 'PGRST202' || code === '42883') return true;
  const m = String(o.message ?? e ?? '');
  return /PGRST202|42883|Could not find the function|function .+ does not exist/i.test(m);
}

// ------------------------------------------------------------------ Instagram Audio API

export type AudioDaMeta = {
  audio_id?: unknown;
  id?: unknown;
  title?: unknown;
  display_artist?: unknown;
  duration_in_ms?: unknown;
  cover_artwork_thumbnail_url?: unknown;
  cover_artwork_thumbnail_uri?: unknown;
  on_platform_audio_preview_link?: unknown;
  audio_type?: unknown;
  ig_username?: unknown;
};

const texto = (v: unknown, teto = 300): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, teto) : null);
const httpsOuNulo = (v: unknown): string | null => {
  const t = texto(v, 2000);
  return t && /^https:\/\//i.test(t) ? t : null;
};

/** Item enxuto: nunca leva download_url (expira) nem nada da credencial. */
export function resumirAudio(a: AudioDaMeta, tipoPedido: string) {
  const id = texto(a.audio_id, 64) ?? (typeof a.audio_id === 'number' ? String(a.audio_id) : null) ?? texto(a.id, 64);
  const ms = typeof a.duration_in_ms === 'number' && Number.isFinite(a.duration_in_ms) ? a.duration_in_ms : Number(a.duration_in_ms);
  return {
    audio_id: id,
    titulo: texto(a.title),
    artista: texto(a.display_artist) ?? texto(a.ig_username),
    duracao_s: Number.isFinite(ms) && ms > 0 ? Math.round(ms / 100) / 10 : null,
    tipo: texto(a.audio_type, 40) ?? tipoPedido,
    capa: httpsOuNulo(a.cover_artwork_thumbnail_url) ?? httpsOuNulo(a.cover_artwork_thumbnail_uri),
    preview: httpsOuNulo(a.on_platform_audio_preview_link),
  };
}

export type ErroDoAudio = {
  codigo: 'reconectar_pelo_facebook' | 'falta_permissao' | 'token_expirado' | 'limite' | 'audio_nao_encontrado' | 'meta_recusou';
  mensagem: string;
  transitorio: boolean;
};

export const PERMISSOES_DO_AUDIO = ['instagram_basic', 'instagram_content_publish'] as const;

export const MENSAGEM_RECONECTE_PELO_FACEBOOK =
  'A conta do Instagram deste cliente está ligada pelo login do Instagram: a biblioteca de áudios da Meta só abre com o login do Facebook. Reconecte pelo Facebook em Config, Integrações, e tente de novo.';

/**
 * Token do login do Instagram (graph.instagram.com) começa com "IG"; o do login
 * do Facebook começa com "EAA". Só olha o prefixo: o token nunca sai daqui.
 */
export function pareceTokenDoLoginDoInstagram(token: string): boolean {
  return /^IG/.test(token);
}

/** Erro da Graph em frase de gente. Nunca repete a URL nem o token. */
export function classificarErroDoAudio(status: number, corpo: unknown): ErroDoAudio {
  const erro = (corpo && typeof corpo === 'object' && (corpo as Record<string, unknown>).error && typeof (corpo as Record<string, unknown>).error === 'object'
    ? (corpo as Record<string, unknown>).error
    : {}) as Record<string, unknown>;
  const codigo = Number(erro.code ?? 0);
  const sub = Number(erro.error_subcode ?? 0);
  const msg = `${String(erro.message ?? '')} ${String(erro.error_user_msg ?? '')} ${String(erro.type ?? '')}`;
  if (/instagram_audio_requires_facebook_login|requires_facebook_login|facebook login/i.test(msg)) {
    return { codigo: 'reconectar_pelo_facebook', mensagem: MENSAGEM_RECONECTE_PELO_FACEBOOK, transitorio: false };
  }
  if (codigo === 190 || codigo === 102 || sub === 463 || sub === 467 || status === 401) {
    return { codigo: 'token_expirado', mensagem: 'A conexão do Instagram deste cliente venceu. Reconecte a conta pelo Facebook em Config, Integrações.', transitorio: false };
  }
  if (codigo === 4 || codigo === 17 || codigo === 32 || codigo === 613 || status === 429) {
    return { codigo: 'limite', mensagem: 'O Instagram pediu uma pausa (limite de uso). Tente de novo mais tarde.', transitorio: true };
  }
  const faltam = PERMISSOES_DO_AUDIO.filter((p) => new RegExp(p, 'i').test(msg));
  if (codigo === 10 || codigo === 200 || codigo === 3 || faltam.length || /permission/i.test(msg)) {
    const quais = faltam.length ? faltam.join(' e ') : PERMISSOES_DO_AUDIO.join(' e ');
    return {
      codigo: 'falta_permissao',
      mensagem: `A conexão do Instagram deste cliente não tem a permissão ${quais}. Reconecte pelo Facebook marcando ${quais} (Config, Integrações).`,
      transitorio: false,
    };
  }
  if (codigo === 100 || codigo === 803 || status === 404) {
    return { codigo: 'audio_nao_encontrado', mensagem: 'A Meta não encontrou este áudio (ou ele não está disponível para esta conta).', transitorio: false };
  }
  return { codigo: 'meta_recusou', mensagem: 'A Meta recusou a busca de áudios agora.', transitorio: status >= 500 };
}
