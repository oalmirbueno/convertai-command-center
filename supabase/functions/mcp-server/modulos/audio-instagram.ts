/**
 * MCP 2.39.3 (26/11/2026): Instagram Audio API para Reels e "Música em alta sugerida".
 *
 * Três ferramentas:
 * - aceleriq_buscar_audios_instagram (só leitura): GET /ig_audio da Graph com o
 *   token da conta do Instagram do cliente (o mesmo caminho das Mesas e dos
 *   Perfis: RPC perfis_instagram_token, só service_role, token do cofre). O
 *   token nunca sai daqui: não volta na resposta, no erro nem no log.
 * - aceleriq_definir_audio_reel: grava (ou remove) o áudio da Meta numa
 *   publicação de Reel do Instagram. O publicador (editorial_autopublish_tick)
 *   lê essa escolha e manda audio_configuration no contêiner REELS, depois da
 *   migração 20261126153016 (aplicada em produção em 26/11/2026, ok do Almir).
 * - aceleriq_definir_musica_sugerida: guarda a música que a agência sugere para
 *   o post (qualquer tipo: carrossel, imagem, reel, story), para quem publica
 *   ou edita escolher no app.
 *
 * As escritas vão SEMPRE por RPC SECURITY DEFINER como a pessoa conectada
 * (rpcComoPessoa, igual ao 2.39.2): o banco confere a permissão no cliente.
 * Enquanto a migração não existir no banco, a RPC responde PGRST202/42883 e a
 * ferramenta diz "recurso aguardando a migração aprovada pelo Almir".
 *
 * As regras puras (Reel-only, volumes 1..100, url https) moram em
 * audio-instagram-regras.ts e valem também no audio_configuration opcional de
 * aceleriq_criar_publicacao_de_aprovado e aceleriq_reagendar_publicacao.
 */

import { z } from 'https://esm.sh/zod@3.23.8';
import type { ToolDefinition } from '../../_shared/mcp-tools.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { DataScopeError } from '../../_shared/mcp-auth.ts';
import { dataScopeAllowsClient } from '../../_shared/mcp-security.ts';
import { db } from './aceleriq-read-services.ts';
import { rpcComoPessoa, umaVez } from './mcp-mesas-acoes.ts';
import { ErroDaFerramenta } from './robustez.ts';
import {
  type AudioConfiguration,
  AVISO_DOWNLOAD_URL,
  classificarErroDoAudio,
  ehRpcAusente,
  MENSAGEM_AGUARDANDO_MIGRACAO,
  MENSAGEM_RECONECTE_PELO_FACEBOOK,
  pareceTokenDoLoginDoInstagram,
  problemaDoAudioNoConteudo,
  problemaNaPublicacaoParaAudio,
  resumirAudio,
  type AudioDaMeta,
  validarAudioConfiguration,
  validarAudioId,
  validarMusicaSugerida,
} from './audio-instagram-regras.ts';

export const NOME_BUSCAR_AUDIOS = 'aceleriq_buscar_audios_instagram';
export const NOME_DEFINIR_AUDIO = 'aceleriq_definir_audio_reel';
export const NOME_DEFINIR_MUSICA = 'aceleriq_definir_musica_sugerida';

/** RPCs da migração 20261126153016 (escritas como a pessoa; a leitura também abre para service_role). */
export const RPCS_DO_AUDIO = {
  definirAudio: 'editorial_reel_audio_definir',
  removerAudio: 'editorial_reel_audio_remover',
  definirMusica: 'editorial_post_musica_definir',
  removerMusica: 'editorial_post_musica_remover',
  ler: 'editorial_audio_e_musica_ler',
} as const;

const LEITURA = { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: true };
const ESCRITA = { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false };
const UUID = z.string().uuid();

/** Mesma versão que a conexão do Meta usa (meta-usuario-do-sistema): o ig_audio é de 01/06/2026. */
export function versaoDaGraph(ambiente: (k: string) => string | undefined): string {
  const v = (ambiente('META_GRAPH_VERSION') || 'v26.0').trim();
  return /^v\d{1,3}\.\d{1,2}$/.test(v) ? v : 'v26.0';
}

// ------------------------------------------------------------------ dependências (o teste troca)

type Resultado = { data: unknown; error: { message: string; code?: string } | null };
// deno-lint-ignore no-explicit-any
type Consulta = any;

export interface DependenciasDoAudio {
  /** Chave de serviço: leitura e a RPC do token (só service_role). */
  banco: { from(tabela: string): Consulta; rpc(nome: string, args: Record<string, unknown>): PromiseLike<Resultado> };
  /** Escrita como a pessoa conectada (auth.uid() = ela). */
  rpc: (nome: string, args: Record<string, unknown>, ctx: AuthContext) => Promise<unknown>;
  buscar: typeof fetch;
  ambiente: (k: string) => string | undefined;
  umaVez: typeof umaVez;
}

export function dependenciasPadrao(): DependenciasDoAudio {
  return {
    banco: db() as unknown as DependenciasDoAudio['banco'],
    rpc: rpcComoPessoa as unknown as DependenciasDoAudio['rpc'],
    buscar: fetch,
    ambiente: (k) => Deno.env.get(k),
    umaVez,
  };
}

function lido<T>(r: Resultado, oque: string): T {
  if (r.error) throw new Error(`Não foi possível ler ${oque} agora. Tente de novo.`);
  return r.data as T;
}

function conferirCliente(ctx: AuthContext, clientId: string) {
  if (!dataScopeAllowsClient(ctx.dataScope, clientId)) throw new DataScopeError('resource is outside this MCP principal data scope');
}

const aguardandoMigracao = () =>
  new ErroDaFerramenta('aguardando_migracao', MENSAGEM_AGUARDANDO_MIGRACAO, 'Não repita até o Almir aplicar a migração; nada foi gravado.', false);

/** Recusa da RPC sem prefixo técnico e sem nada que pareça credencial. */
export function motivoDaRecusa(e: unknown): string {
  const m = String((e as { message?: string })?.message || e || '')
    .replace(/^mesa:rpc_recusada\s+/, '')
    .replace(/^editorial_[a-z_]+:\s*/, '')
    .replace(/access_token=[^&\s]+/gi, 'access_token=[oculto]');
  if (/access denied|permission denied|42501|sem acesso|não pode/i.test(m)) return 'A pessoa conectada não tem permissão na Agenda deste cliente para isso.';
  return m ? m.slice(0, 240) : 'O painel não respondeu. Tente de novo.';
}

function infraSobe(e: unknown) {
  // Falha de infraestrutura (sessão do dono, OAuth, configuração) sobe intacta (código e transitorio).
  if (e instanceof Error && /^mesa:(dono_da_chave|exige_oauth|configuracao)\s/.test(e.message)) throw e;
}

// ------------------------------------------------------------------ 1) buscar áudios

export const buscarAudiosSchema = z.object({
  client_id: UUID,
  audio_type: z.enum(['music', 'original_sound']).optional(),
  search_query: z.string().max(100).optional(),
  audio_id: z.string().optional(),
}).strict();

type TokenDoInstagram = { igUserId: string; token: string; origem: 'cliente' | 'agencia' };

async function tokenDoCliente(clientId: string, deps: DependenciasDoAudio): Promise<{ t: TokenDoInstagram; avisos: string[] }> {
  const { data, error } = await deps.banco.rpc('perfis_instagram_token', { _client_id: clientId });
  if (error) {
    if (ehRpcAusente(error)) throw new ErroDaFerramenta('sem_conexao', 'A leitura do token do Instagram ainda não existe neste banco (SQL de Perfis do Instagram).', null, false);
    throw new ErroDaFerramenta('token_indisponivel', 'O token do Instagram não pôde ser lido agora.', 'Tente de novo em instantes.', true);
  }
  const linhas = ((Array.isArray(data) ? data : []) as Array<{ ig_user_id?: string; access_token?: string; origem?: string }>)
    .filter((l) => l.ig_user_id && l.access_token)
    .map((l) => ({ igUserId: String(l.ig_user_id), token: String(l.access_token), origem: (l.origem === 'cliente' ? 'cliente' : 'agencia') as 'cliente' | 'agencia' }));
  const doCliente = linhas.find((l) => l.origem === 'cliente');
  if (doCliente) return { t: doCliente, avisos: [] };
  if (linhas[0]) {
    return {
      t: linhas[0],
      avisos: ['O cliente não tem Instagram conectado: a busca usou a conta da agência. O catálogo pode ser diferente na conta do cliente; confira antes de pôr no Reel.'],
    };
  }
  throw new ErroDaFerramenta('sem_conexao', 'Este cliente não tem conta do Instagram conectada. Conecte pelo Facebook em Config, Integrações.', null, false);
}

async function provaDoSegredo(token: string, ambiente: DependenciasDoAudio['ambiente']): Promise<string | null> {
  const segredo = ambiente('META_APP_SECRET')?.trim();
  if (!segredo) return null;
  const cod = new TextEncoder();
  const chave = await crypto.subtle.importKey('raw', cod.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const assinatura = new Uint8Array(await crypto.subtle.sign('HMAC', chave, cod.encode(token)));
  return Array.from(assinatura).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const CAMPOS_DO_AUDIO = 'id,title,display_artist,duration_in_ms,cover_artwork_thumbnail_url,on_platform_audio_preview_link,audio_type';

export async function buscarAudiosInstagram(
  input: z.infer<typeof buscarAudiosSchema>,
  ctx: AuthContext,
  deps: DependenciasDoAudio = dependenciasPadrao(),
): Promise<Record<string, unknown>> {
  conferirCliente(ctx, input.client_id);
  const audioType = input.audio_type ?? 'music';
  const busca = (input.search_query ?? '').trim();
  let audioId: string | null = null;
  if (input.audio_id !== undefined && input.audio_id.trim() !== '') {
    const v = validarAudioId(input.audio_id);
    if (!v.ok) throw new Error(`Invalid input: ${v.erro}`);
    audioId = v.valor;
  }

  const { t, avisos } = await tokenDoCliente(input.client_id, deps);
  if (pareceTokenDoLoginDoInstagram(t.token)) {
    throw new ErroDaFerramenta('reconectar_pelo_facebook', MENSAGEM_RECONECTE_PELO_FACEBOOK, null, false);
  }

  const graph = `https://graph.facebook.com/${versaoDaGraph(deps.ambiente)}`;
  const u = audioId ? new URL(`${graph}/${encodeURIComponent(audioId)}`) : new URL(`${graph}/ig_audio`);
  if (audioId) {
    u.searchParams.set('fields', CAMPOS_DO_AUDIO);
  } else {
    u.searchParams.set('audio_type', audioType);
    u.searchParams.set('user_id', t.igUserId);
    if (busca) u.searchParams.set('search_query', busca);
  }
  u.searchParams.set('access_token', t.token);
  const prova = await provaDoSegredo(t.token, deps.ambiente);
  if (prova) u.searchParams.set('appsecret_proof', prova);

  let res: Response;
  try {
    res = await deps.buscar(u, { signal: AbortSignal.timeout(20_000) });
  } catch {
    // Nunca repassa a mensagem do fetch: ela pode trazer a URL com o token.
    throw new ErroDaFerramenta('meta_sem_resposta', 'O Instagram não respondeu a tempo.', 'Tente de novo em instantes.', true);
  }
  const corpo = await res.json().catch(() => null) as Record<string, unknown> | null;
  if (!res.ok || !corpo || (corpo.error && typeof corpo.error === 'object')) {
    const e = classificarErroDoAudio(res.status, corpo);
    throw new ErroDaFerramenta(e.codigo, e.mensagem, null, e.transitorio);
  }

  const brutos = audioId ? [corpo as AudioDaMeta] : ((Array.isArray(corpo.data) ? corpo.data : []) as AudioDaMeta[]);
  const audios = brutos.map((a) => resumirAudio(a, audioType)).filter((a) => !!a.audio_id).slice(0, 50);
  if (!audios.length) {
    avisos.push(busca
      ? `Nenhum áudio encontrado para "${busca}". Tente outra palavra ou deixe a busca vazia para ver os em alta.`
      : 'A Meta não devolveu áudios em alta para esta conta agora. Tente de novo mais tarde ou busque por nome.');
  }
  avisos.push(AVISO_DOWNLOAD_URL);
  return {
    client_id: input.client_id,
    conta: t.origem,
    audio_type: audioType,
    busca: audioId ? null : (busca || null),
    em_alta: !audioId && !busca,
    total: audios.length,
    audios,
    avisos,
    proximo_passo: 'Para pôr um áudio num Reel do Instagram: aceleriq_definir_audio_reel (publication_id ou post_id, audio_id). Carrossel, imagem e story não aceitam áudio da Meta: use aceleriq_definir_musica_sugerida.',
  };
}

// ------------------------------------------------------------------ 2) definir áudio do Reel

export const definirAudioSchema = z.object({
  publication_id: UUID.optional(),
  post_id: UUID.optional(),
  audio_id: z.unknown().optional(),
  audio_volume: z.unknown().optional(),
  video_volume: z.unknown().optional(),
  audio_title: z.string().trim().max(200).optional(),
  audio_artist: z.string().trim().max(200).optional(),
  remover: z.boolean().optional(),
  confirmar: z.literal(true),
  idempotency_key: z.string().trim().min(8).max(120),
}).strict().refine((v) => !!v.publication_id || !!v.post_id, { message: 'informe publication_id (ou post_id do Reel)' });

type PublicacaoLida = { id: string; post_id: string; client_id: string; platform: string; status: string; version: number };
type PostLido = { id: string; client_id: string; content_type: string | null; archived_at: string | null };

/** Publicação do Instagram do post (ou a pedida) e o post dela, já dentro do escopo. */
async function publicacaoDoReel(
  alvo: { publication_id?: string; post_id?: string },
  ctx: AuthContext,
  banco: DependenciasDoAudio['banco'],
): Promise<{ pub: PublicacaoLida; post: PostLido }> {
  const CAMPOS = 'id, post_id, client_id, platform, status, version';
  let pub: PublicacaoLida | null = null;
  if (alvo.publication_id) {
    pub = lido<PublicacaoLida | null>(
      await banco.from('editorial_publications').select(CAMPOS).eq('id', alvo.publication_id).maybeSingle(),
      'a publicação',
    );
    if (!pub) throw new Error('Publicação não encontrada.');
    conferirCliente(ctx, pub.client_id);
    if (alvo.post_id && alvo.post_id !== pub.post_id) throw new Error('publication_id e post_id não são do mesmo conteúdo.');
  } else {
    const post0 = lido<{ id: string; client_id: string } | null>(
      await banco.from('editorial_posts').select('id, client_id').eq('id', alvo.post_id).maybeSingle(),
      'o post da Agenda',
    );
    if (!post0) throw new Error('Post não encontrado na Agenda.');
    conferirCliente(ctx, post0.client_id);
    const pubs = (lido<PublicacaoLida[] | null>(
      await banco.from('editorial_publications').select(CAMPOS).eq('post_id', post0.id).eq('platform', 'instagram'),
      'as publicações do post',
    ) ?? []).filter((p) => p.status !== 'cancelled' && p.client_id === post0.client_id);
    if (!pubs.length) {
      throw new Error('O post não tem publicação viva no Instagram. Crie com aceleriq_criar_publicacao_de_aprovado e depois defina o áudio com o publication_id.');
    }
    if (pubs.length > 1) throw new Error(`O post tem ${pubs.length} publicações no Instagram: informe publication_id (${pubs.map((p) => p.id).join(', ')}).`);
    pub = pubs[0];
  }
  const post = lido<PostLido | null>(
    await banco.from('editorial_posts').select('id, client_id, content_type, archived_at').eq('id', pub.post_id).maybeSingle(),
    'o post da Agenda',
  );
  if (!post || post.client_id !== pub.client_id) throw new Error('Post da publicação não encontrado na Agenda.');
  if (post.archived_at) throw new Error('Post arquivado na Agenda: use o post atual do conteúdo.');
  return { pub, post };
}

export async function definirAudioReel(
  input: z.infer<typeof definirAudioSchema>,
  ctx: AuthContext,
  deps: DependenciasDoAudio = dependenciasPadrao(),
): Promise<Record<string, unknown>> {
  const remover = input.remover === true;
  let cfg: AudioConfiguration | null = null;
  if (remover) {
    if (input.audio_id !== undefined && input.audio_id !== null) throw new Error('Invalid input: para remover, mande remover=true e audio_id null (ou sem audio_id).');
  } else {
    if (input.audio_id === undefined || input.audio_id === null) throw new Error('Invalid input: audio_id é obrigatório (ou remover=true para tirar o áudio).');
    const v = validarAudioConfiguration({
      audio_id: input.audio_id,
      ...(input.audio_volume !== undefined ? { audio_volume: input.audio_volume } : {}),
      ...(input.video_volume !== undefined ? { video_volume: input.video_volume } : {}),
    });
    if (!v.ok) throw new Error(`Invalid input: ${v.erro}`);
    cfg = v.valor;
  }

  const { pub, post } = await publicacaoDoReel(input, ctx, deps.banco);
  if (!remover) {
    const problema = problemaDoAudioNoConteudo({ content_type: post.content_type, platform: pub.platform });
    if (problema) throw new Error(problema);
  }
  const naPub = problemaNaPublicacaoParaAudio(pub.status);
  if (naPub) throw new Error(naPub);

  return await deps.umaVez(NOME_DEFINIR_AUDIO, ctx, input.idempotency_key, async () => {
    if (ctx.resultRefHolder) ctx.resultRefHolder.value = `editorial_publications:${pub.id}`;
    let registro: unknown;
    try {
      registro = remover
        ? await deps.rpc(RPCS_DO_AUDIO.removerAudio, { p_publication_id: pub.id }, ctx)
        : await deps.rpc(RPCS_DO_AUDIO.definirAudio, {
          p_publication_id: pub.id,
          p_audio_id: cfg!.audio_id,
          p_audio_volume: cfg!.audio_volume ?? null,
          p_video_volume: cfg!.video_volume ?? null,
          p_audio_title: input.audio_title || null,
          p_audio_artist: input.audio_artist || null,
        }, ctx);
    } catch (e) {
      if (ehRpcAusente(e)) throw aguardandoMigracao();
      infraSobe(e);
      throw new Error(`mesa:rpc_recusada ${motivoDaRecusa(e)}`);
    }
    return {
      ref: `editorial_publications:${pub.id}`,
      resultado: {
        publication_id: pub.id,
        post_id: post.id,
        client_id: pub.client_id,
        removido: remover,
        audio_configuration: cfg,
        registro: registro ?? null,
        aviso: remover
          ? 'O Reel sai sem áudio da Meta (só o som do vídeo).'
          : 'O áudio entra quando o publicador criar o contêiner do Reel; contêiner já criado não muda. A peça aprovada pelo cliente não muda: confira com o cliente se a música faz parte do combinado.',
      },
    };
  }, { publication_id: pub.id });
}

// ------------------------------------------------------------------ 3) música sugerida

export const definirMusicaSchema = z.object({
  post_id: UUID,
  titulo: z.unknown().optional(),
  artista: z.unknown().optional(),
  url: z.unknown().optional(),
  nota: z.unknown().optional(),
  remover: z.boolean().optional(),
  confirmar: z.literal(true),
  idempotency_key: z.string().trim().min(8).max(120),
}).strict();

export async function definirMusicaSugerida(
  input: z.infer<typeof definirMusicaSchema>,
  ctx: AuthContext,
  deps: DependenciasDoAudio = dependenciasPadrao(),
): Promise<Record<string, unknown>> {
  const remover = input.remover === true;
  let musica: ReturnType<typeof validarMusicaSugerida> | null = null;
  if (!remover) {
    musica = validarMusicaSugerida(input);
    if (!musica.ok) throw new Error(`Invalid input: ${musica.erro}`);
  }
  const post = lido<PostLido | null>(
    await deps.banco.from('editorial_posts').select('id, client_id, content_type, archived_at').eq('id', input.post_id).maybeSingle(),
    'o post da Agenda',
  );
  if (!post) throw new Error('Post não encontrado na Agenda.');
  conferirCliente(ctx, post.client_id);
  if (post.archived_at) throw new Error('Post arquivado na Agenda: use o post atual do conteúdo.');

  return await deps.umaVez(NOME_DEFINIR_MUSICA, ctx, input.idempotency_key, async () => {
    if (ctx.resultRefHolder) ctx.resultRefHolder.value = `editorial_posts:${post.id}`;
    let registro: unknown;
    try {
      registro = remover
        ? await deps.rpc(RPCS_DO_AUDIO.removerMusica, { p_post_id: post.id }, ctx)
        : await deps.rpc(RPCS_DO_AUDIO.definirMusica, {
          p_post_id: post.id,
          p_titulo: musica!.ok ? musica!.valor.titulo : null,
          p_artista: musica!.ok ? musica!.valor.artista : null,
          p_url: musica!.ok ? musica!.valor.url : null,
          p_nota: musica!.ok ? musica!.valor.nota : null,
        }, ctx);
    } catch (e) {
      if (ehRpcAusente(e)) throw aguardandoMigracao();
      infraSobe(e);
      throw new Error(`mesa:rpc_recusada ${motivoDaRecusa(e)}`);
    }
    return {
      ref: `editorial_posts:${post.id}`,
      resultado: {
        post_id: post.id,
        client_id: post.client_id,
        content_type: post.content_type,
        removido: remover,
        musica_sugerida: remover ? null : (musica!.ok ? musica!.valor : null),
        registro: registro ?? null,
        aviso: 'É só a sugestão para quem publica ou edita escolher no app: não vai para a Meta. Em Reel do Instagram, para o áudio sair na publicação, use aceleriq_definir_audio_reel.',
      },
    };
  }, { post_id: post.id });
}

// ------------------------------------------------------------------ campo opcional nas tools da Agenda

/** JSON Schema do campo audio_configuration nas tools que criam ou agendam publicação. */
export const ESQUEMA_AUDIO_CONFIGURATION = {
  type: 'object',
  additionalProperties: false,
  required: ['audio_id'],
  description: 'Opcional, só Reel do Instagram: áudio da Meta (aceleriq_buscar_audios_instagram). Carrossel, imagem e story recusam: use aceleriq_definir_musica_sugerida.',
  properties: {
    audio_id: { type: 'string', description: 'audio_id devolvido por aceleriq_buscar_audios_instagram (texto).' },
    audio_volume: { type: 'integer', minimum: 1, maximum: 100, description: 'Volume do áudio, inteiro de 1 a 100 (padrão da Meta 100).' },
    video_volume: { type: 'integer', minimum: 1, maximum: 100, description: 'Volume do som do vídeo, inteiro de 1 a 100 (padrão da Meta 100).' },
  },
} as const;

/**
 * Valida o audio_configuration opcional ANTES de qualquer escrita da tool que o recebe.
 * undefined = a tool segue exatamente como antes.
 */
export function audioDaEntrada(
  raw: unknown,
  alvo: { content_type: string | null | undefined; platform?: string | null },
): AudioConfiguration | null {
  if (raw === undefined) return null;
  const v = validarAudioConfiguration(raw);
  if (!v.ok) throw new Error(`Invalid input: ${v.erro}`);
  const problema = problemaDoAudioNoConteudo(alvo);
  if (problema) throw new Error(`Invalid input: ${problema}`);
  return v.valor;
}

/** Grava depois da ação principal. Nunca lança: a publicação já foi criada/agendada. */
export async function gravarAudioDaPublicacao(
  publicationId: string,
  cfg: AudioConfiguration,
  ctx: AuthContext,
  rpc: DependenciasDoAudio['rpc'],
): Promise<Record<string, unknown>> {
  try {
    await rpc(RPCS_DO_AUDIO.definirAudio, {
      p_publication_id: publicationId,
      p_audio_id: cfg.audio_id,
      p_audio_volume: cfg.audio_volume ?? null,
      p_video_volume: cfg.video_volume ?? null,
      p_audio_title: null,
      p_audio_artist: null,
    }, ctx);
    return { gravado: true, audio_configuration: cfg };
  } catch (e) {
    if (ehRpcAusente(e)) return { gravado: false, aguardando_migracao: true, audio_configuration: cfg, mensagem: MENSAGEM_AGUARDANDO_MIGRACAO };
    return {
      gravado: false,
      audio_configuration: cfg,
      mensagem: `O áudio não foi gravado (${motivoDaRecusa(e)}). A publicação seguiu; tente o áudio de novo com aceleriq_definir_audio_reel.`,
    };
  }
}

/**
 * Grava ANTES de uma ação que deixa a publicação pronta para sair (agendar):
 * se o áudio não grava, a ação não acontece. RPC ausente vira aguardando_migracao.
 */
export async function gravarAudioAntesDeAgendar(
  publicationId: string,
  cfg: AudioConfiguration,
  ctx: AuthContext,
  rpc: DependenciasDoAudio['rpc'],
): Promise<Record<string, unknown>> {
  try {
    await rpc(RPCS_DO_AUDIO.definirAudio, {
      p_publication_id: publicationId,
      p_audio_id: cfg.audio_id,
      p_audio_volume: cfg.audio_volume ?? null,
      p_video_volume: cfg.video_volume ?? null,
      p_audio_title: null,
      p_audio_artist: null,
    }, ctx);
    return { gravado: true, audio_configuration: cfg };
  } catch (e) {
    if (ehRpcAusente(e)) {
      throw new ErroDaFerramenta(
        'aguardando_migracao',
        `${MENSAGEM_AGUARDANDO_MIGRACAO.replace(' o resto do pedido segue normal.', '')} Nada foi agendado.`,
        'Para agendar sem o áudio, repita sem audio_configuration.',
        false,
      );
    }
    infraSobe(e);
    throw new Error(`mesa:rpc_recusada O áudio não foi gravado (${motivoDaRecusa(e)}). Nada foi agendado.`);
  }
}

// ------------------------------------------------------------------ leitura na Agenda (campo adicional)

type LeituraDoAudio = {
  musicas?: Array<Record<string, unknown> & { post_id?: string }>;
  audios?: Array<Record<string, unknown> & { publication_id?: string }>;
};

/**
 * Acrescenta post.musica_sugerida e publication.audio_reel aos itens da Agenda.
 * Só acrescenta campo; sem a migração (ou se a leitura falhar) devolve igual.
 */
export async function comAudioEMusica<T>(resultado: T, banco: Pick<DependenciasDoAudio['banco'], 'rpc'> | null = null): Promise<T> {
  const r = resultado as unknown as { items?: Array<{ kind?: string; post?: { id?: string; publications?: Array<{ id?: string }> } | null }> };
  const posts = (r?.items ?? []).filter((i) => i?.kind === 'editorial_post' && i.post?.id).map((i) => i.post!);
  if (!posts.length) return resultado;
  try {
    const cliente = banco ?? (db() as unknown as Pick<DependenciasDoAudio['banco'], 'rpc'>);
    const { data, error } = await cliente.rpc(RPCS_DO_AUDIO.ler, { p_post_ids: posts.map((p) => p.id).slice(0, 500) });
    if (error || !data || typeof data !== 'object') return resultado;
    const lida = data as LeituraDoAudio;
    const musicaPorPost = new Map((lida.musicas ?? []).filter((m) => m.post_id).map((m) => [String(m.post_id), m]));
    const audioPorPub = new Map((lida.audios ?? []).filter((a) => a.publication_id).map((a) => [String(a.publication_id), a]));
    for (const p of posts) {
      const m = musicaPorPost.get(String(p.id));
      (p as Record<string, unknown>).musica_sugerida = m
        ? { titulo: m.titulo ?? null, artista: m.artista ?? null, url: m.url ?? null, nota: m.nota ?? null, atualizada_em: m.updated_at ?? null }
        : null;
      for (const pub of p.publications ?? []) {
        const a = pub.id ? audioPorPub.get(String(pub.id)) : undefined;
        (pub as Record<string, unknown>).audio_reel = a
          ? {
            audio_id: a.audio_id ?? null,
            audio_volume: a.audio_volume ?? null,
            video_volume: a.video_volume ?? null,
            titulo: a.audio_title ?? null,
            artista: a.audio_artist ?? null,
            atualizado_em: a.updated_at ?? null,
          }
          : null;
      }
    }
  } catch {
    /* sem a leitura, a Agenda segue igual */
  }
  return resultado;
}

// ------------------------------------------------------------------ definições

const falhaDeEntrada = (issues: Array<{ message: string }>) => new Error(`Invalid input: ${issues.map((i) => i.message).join('; ')}`);

const buscar: ToolDefinition = {
  name: NOME_BUSCAR_AUDIOS,
  title: 'Buscar áudios do Instagram (Reels)',
  description:
    'Só leitura. Busca na biblioteca de áudios da Meta (Instagram Audio API, GET /ig_audio) com a conta do Instagram do cliente: sem search_query devolve os em alta; com search_query busca por nome; com audio_id lê um áudio. audio_type music (padrão) ou original_sound. Devolve lista enxuta (audio_id, titulo, artista, duracao_s, tipo, capa, preview) e avisos; o download_url da Meta expira e não volta. Conta ligada pelo login do Instagram, sem instagram_basic/instagram_content_publish ou com token vencido: diz como reconectar pelo Facebook. Nunca devolve token. Para pôr no Reel: aceleriq_definir_audio_reel. Exige editorial:read e o cliente no escopo.',
  scopes: ['editorial:read'],
  annotations: LEITURA,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['client_id'],
    properties: {
      client_id: { type: 'string', format: 'uuid', description: 'Cliente dono da conta do Instagram.' },
      audio_type: { type: 'string', enum: ['music', 'original_sound'], default: 'music' },
      search_query: { type: 'string', maxLength: 100, description: 'Busca por nome. Vazio = em alta.' },
      audio_id: { type: 'string', description: 'Opcional: lê só este áudio (GET /{ig_audio_id}).' },
    },
  },
  handler: async (input, ctx) => {
    const p = buscarAudiosSchema.safeParse(input ?? {});
    if (!p.success) throw falhaDeEntrada(p.error.issues);
    return await buscarAudiosInstagram(p.data, ctx);
  },
};

const definirAudio: ToolDefinition = {
  name: NOME_DEFINIR_AUDIO,
  title: 'Definir áudio do Reel (Instagram)',
  description:
    'Grava o áudio da Meta (audio_id de aceleriq_buscar_audios_instagram) na publicação de um Reel do Instagram: o publicador manda audio_configuration ao criar o contêiner REELS. Só Reel (content_type reel, video ou short) e plataforma instagram: carrossel, imagem e story recusam ("a Meta só aceita audio_configuration em Reels; use musica_sugerida"). audio_volume e video_volume opcionais, inteiros de 1 a 100 (0, 101, decimal ou texto recusam). Remover: remover=true e audio_id null. Publicação publicada ou cancelada recusa. Não aprova, não agenda e não publica. Grava pela RPC do banco como a pessoa conectada; antes da migração aprovada pelo Almir responde aguardando_migracao. Exige publication_id (ou post_id com uma só publicação no Instagram), confirmar=true, idempotency_key, editorial:write e o cliente no escopo.',
  scopes: ['editorial:write'],
  annotations: ESCRITA,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['confirmar', 'idempotency_key'],
    properties: {
      publication_id: { type: 'string', format: 'uuid', description: 'Publicação do Instagram (editorial_publications.id).' },
      post_id: { type: 'string', format: 'uuid', description: 'Ou o post, se ele tiver uma só publicação viva no Instagram.' },
      audio_id: { type: ['string', 'null'], description: 'audio_id da Meta (texto). null com remover=true tira o áudio.' },
      audio_volume: { type: 'integer', minimum: 1, maximum: 100 },
      video_volume: { type: 'integer', minimum: 1, maximum: 100 },
      audio_title: { type: 'string', maxLength: 200, description: 'Opcional, para a equipe ler na Agenda.' },
      audio_artist: { type: 'string', maxLength: 200 },
      remover: { type: 'boolean', description: 'true tira o áudio da publicação.' },
      confirmar: { type: 'boolean', const: true, description: 'Tem que ser true: muda o que sai no Reel.' },
      idempotency_key: { type: 'string', description: 'Chave estável de 8 a 120 caracteres. Repetir não grava de novo.' },
    },
  },
  handler: async (input, ctx) => {
    const p = definirAudioSchema.safeParse(input ?? {});
    if (!p.success) throw falhaDeEntrada(p.error.issues);
    return await definirAudioReel(p.data, ctx);
  },
};

const definirMusica: ToolDefinition = {
  name: NOME_DEFINIR_MUSICA,
  title: 'Definir música sugerida do post',
  description:
    'Guarda a música em alta que a agência sugere para um post da Agenda, de qualquer tipo (carrossel, imagem, reel, story), para quem publica ou edita escolher no app. Não vai para a Meta: em Reel do Instagram, para o áudio sair na publicação, use aceleriq_definir_audio_reel. titulo obrigatório (1 a 200), artista (até 200), url só https, nota (até 500). Remover: remover=true. Aparece em aceleriq_list_editorial_calendar como post.musica_sugerida. Grava pela RPC do banco como a pessoa conectada; antes da migração aprovada pelo Almir responde aguardando_migracao. Exige confirmar=true, idempotency_key, editorial:write e o cliente no escopo.',
  scopes: ['editorial:write'],
  annotations: ESCRITA,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['post_id', 'confirmar', 'idempotency_key'],
    properties: {
      post_id: { type: 'string', format: 'uuid', description: 'id do post da Agenda (editorial_posts.id).' },
      titulo: { type: 'string', minLength: 1, maxLength: 200, description: 'Nome da música (obrigatório, salvo remover=true).' },
      artista: { type: 'string', maxLength: 200 },
      url: { type: 'string', maxLength: 2000, description: 'Link https (ex.: o preview do Instagram).' },
      nota: { type: 'string', maxLength: 500, description: 'Ex.: trecho a usar, momento do corte.' },
      remover: { type: 'boolean', description: 'true tira a sugestão do post.' },
      confirmar: { type: 'boolean', const: true },
      idempotency_key: { type: 'string', description: 'Chave estável de 8 a 120 caracteres. Repetir não grava de novo.' },
    },
  },
  handler: async (input, ctx) => {
    const p = definirMusicaSchema.safeParse(input ?? {});
    if (!p.success) throw falhaDeEntrada(p.error.issues);
    return await definirMusicaSugerida(p.data, ctx);
  },
};

export const FERRAMENTAS_DE_AUDIO_INSTAGRAM: readonly ToolDefinition[] = [buscar, definirAudio, definirMusica];
