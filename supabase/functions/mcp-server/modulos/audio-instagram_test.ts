// MCP 2.39.3 (26/11/2026): busca de áudios (fetch falso) e definições (RPC falsa), sem banco nem rede.
import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import {
  buscarAudiosInstagram,
  comAudioEMusica,
  definirAudioReel,
  definirAudioSchema,
  definirMusicaSugerida,
  type DependenciasDoAudio,
  FERRAMENTAS_DE_AUDIO_INSTAGRAM,
  RPCS_DO_AUDIO,
} from './audio-instagram.ts';
import { MENSAGEM_AGUARDANDO_MIGRACAO, MENSAGEM_RECONECTE_PELO_FACEBOOK } from './audio-instagram-regras.ts';
import { criarPublicacaoDeAprovado, type DependenciasDaCriacao } from './criar-publicacao-de-aprovado.ts';
import { reagendarPublicacao, type DependenciasDoReagendar } from './reagendar-publicacao.ts';

const CLIENTE = '00000000-0000-4000-8000-0000000000aa';
const OUTRO = '00000000-0000-4000-8000-0000000000bb';
const PROJETO = '33333333-3333-4333-8333-333333333333';
const POST_REEL = '11111111-1111-4111-8111-111111111111';
const POST_CARROSSEL = '11111111-1111-4111-8111-111111111112';
const POST_STORY = '11111111-1111-4111-8111-111111111113';
const POST_IMAGEM = '11111111-1111-4111-8111-111111111114';
const PUB_REEL = '66666666-6666-4666-8666-666666666601';
const PUB_CARROSSEL = '66666666-6666-4666-8666-666666666602';
const PUB_STORY = '66666666-6666-4666-8666-666666666603';
const PUB_PUBLICADA = '66666666-6666-4666-8666-666666666604';
const ARQUIVO = '44444444-4444-4444-8444-444444444444';
const IG = '22222222-2222-4222-8222-2222222222a1';
const TOKEN = 'EAAGsegredoMuitoSecreto123456789';
const TOKEN_IG = 'IGAAJsegredoDoLoginDoInstagram987';
const IG_USER = '17841400000000001';

const ctx: AuthContext = {
  keyId: '00000000-0000-0000-0000-000000000001',
  keyName: 'test-key',
  scopes: ['editorial:write', 'editorial:read'],
  origin: 'test',
  correlationId: '00000000-0000-0000-0000-0000000000cc',
  dataScope: { unrestricted: false, clientIds: [CLIENTE], principalUserId: '00000000-0000-0000-0000-0000000000a1', source: 'oauth' },
};
const ctxDeOutro: AuthContext = { ...ctx, dataScope: { ...ctx.dataScope, clientIds: [OUTRO] } };

type Linha = Record<string, unknown>;
type Tabelas = Record<string, Linha[]>;

function tabelasBase(): Tabelas {
  return {
    editorial_posts: [
      { id: POST_REEL, version: 7, client_id: CLIENTE, project_id: PROJETO, primary_file_id: ARQUIVO, title: 'Reel', content_type: 'reel', objective: null, default_caption: 'Legenda', production_status: 'ready', archived_at: null },
      { id: POST_CARROSSEL, client_id: CLIENTE, content_type: 'carousel', archived_at: null },
      { id: POST_STORY, client_id: CLIENTE, content_type: 'story', archived_at: null },
      { id: POST_IMAGEM, client_id: CLIENTE, content_type: 'static', archived_at: null },
    ],
    editorial_publications: [
      { id: PUB_REEL, post_id: POST_REEL, client_id: CLIENTE, platform: 'instagram', status: 'scheduled', version: 3 },
      { id: PUB_CARROSSEL, post_id: POST_CARROSSEL, client_id: CLIENTE, platform: 'instagram', status: 'planned', version: 1 },
      { id: PUB_STORY, post_id: POST_STORY, client_id: CLIENTE, platform: 'instagram', status: 'planned', version: 1 },
      { id: PUB_PUBLICADA, post_id: POST_REEL, client_id: CLIENTE, platform: 'facebook', status: 'published', version: 2 },
    ],
  };
}

function bancoFalso(tabelas: Tabelas, rpcs: Record<string, (args: Record<string, unknown>) => { data: unknown; error: { message: string; code?: string } | null }> = {}) {
  return {
    from(tabela: string) {
      const filtros: Array<[string, unknown]> = [];
      const resolver = () => ({ data: (tabelas[tabela] ?? []).filter((l) => filtros.every(([c, v]) => l[c] === v)).map((l) => ({ ...l })), error: null });
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (c: string, v: unknown) => { filtros.push([c, v]); return q; };
      q.maybeSingle = () => Promise.resolve(resolver()).then((r) => ({ data: r.data[0] ?? null, error: null }));
      q.then = (ok: (r: unknown) => unknown, falha?: (e: unknown) => unknown) => Promise.resolve(resolver()).then(ok, falha);
      return q;
    },
    rpc(nome: string, args: Record<string, unknown>) {
      const f = rpcs[nome];
      return Promise.resolve(f ? f(args) : { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${nome}` } });
    },
  };
}

const umaVezFalso = () => {
  const chaves = new Set<string>();
  return (async (ferramenta: string, _ctx: AuthContext, chave: string, fazer: () => Promise<{ ref: string | null; resultado: Record<string, unknown> }>, escopo?: Record<string, string>) => {
    const k = `${ferramenta}|${chave}|${JSON.stringify(escopo ?? {})}`;
    if (chaves.has(k)) return { ok: true, replay: true };
    const { resultado } = await fazer();
    chaves.add(k);
    return { ok: true, ...resultado };
  }) as never;
};

type Resposta = { status: number; corpo: unknown };

function montar(opcoes: {
  tabelas?: Tabelas;
  tokens?: Array<{ ig_user_id: string; access_token: string; origem: string }>;
  resposta?: Resposta;
  fetchFalha?: boolean;
  rpcAusente?: boolean;
  rpcErro?: string;
} = {}) {
  const tabelas = opcoes.tabelas ?? tabelasBase();
  const urls: URL[] = [];
  const chamadas: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const deps: DependenciasDoAudio = {
    banco: bancoFalso(tabelas, {
      perfis_instagram_token: () => ({ data: opcoes.tokens ?? [{ ig_user_id: IG_USER, access_token: TOKEN, origem: 'cliente' }], error: null }),
    }),
    rpc: (nome, args) => {
      chamadas.push({ nome, args: structuredClone(args) });
      if (opcoes.rpcAusente) {
        return Promise.reject(new Error(`mesa:rpc_recusada ${nome}: Could not find the function public.${nome}(p_publication_id) in the schema cache`));
      }
      if (opcoes.rpcErro) return Promise.reject(new Error(`mesa:rpc_recusada ${nome}: ${opcoes.rpcErro}`));
      return Promise.resolve({ ok: true, ...args });
    },
    buscar: ((u: URL) => {
      urls.push(new URL(String(u)));
      if (opcoes.fetchFalha) return Promise.reject(new TypeError(`fetch failed for ${String(u)}`));
      const r = opcoes.resposta ?? { status: 200, corpo: { data: [] } };
      return Promise.resolve(new Response(JSON.stringify(r.corpo), { status: r.status, headers: { 'content-type': 'application/json' } }));
    }) as typeof fetch,
    ambiente: (k) => (k === 'META_APP_SECRET' ? 'segredo-do-app' : undefined),
    umaVez: umaVezFalso(),
  };
  return { deps, urls, chamadas, tabelas };
}

const semToken = (v: unknown) => {
  const t = JSON.stringify(v);
  assert(!t.includes(TOKEN) && !t.includes(TOKEN_IG) && !t.includes('segredo'), 'o token não aparece');
};

async function erroDe(f: () => Promise<unknown>): Promise<Error & { codigo?: string; transitorio?: boolean }> {
  try {
    await f();
  } catch (e) {
    return e as Error & { codigo?: string };
  }
  throw new Error('esperava erro');
}

// ------------------------------------------------------------------ busca

Deno.test('buscar: em alta (sem search_query) chama /ig_audio com music e user_id, devolve lista enxuta sem token', async () => {
  const { deps, urls } = montar({
    resposta: {
      status: 200,
      corpo: {
        data: [
          { audio_id: '1001', title: 'Espresso', display_artist: 'Sabrina Carpenter', duration_in_ms: 30_000, cover_artwork_thumbnail_url: 'https://cdn/c.jpg', download_url: 'https://cdn/expira.mp3', on_platform_audio_preview_link: 'https://www.instagram.com/reels/audio/1001', audio_type: 'music' },
          { audio_id: '1002', title: 'Outra', display_artist: 'Banda', duration_in_ms: 12_340 },
        ],
      },
    },
  });
  const r = await buscarAudiosInstagram({ client_id: CLIENTE }, ctx, deps) as Record<string, any>;
  assertEquals(urls.length, 1);
  const u = urls[0];
  assertEquals(u.origin + u.pathname, 'https://graph.facebook.com/v26.0/ig_audio');
  assertEquals(u.searchParams.get('audio_type'), 'music');
  assertEquals(u.searchParams.get('user_id'), IG_USER);
  assertEquals(u.searchParams.get('search_query'), null);
  assertEquals(u.searchParams.get('access_token'), TOKEN, 'o token vai só para a Meta');
  assert(u.searchParams.get('appsecret_proof')?.length === 64);
  assertEquals(r.em_alta, true);
  assertEquals(r.total, 2);
  assertEquals(r.audios[0], {
    audio_id: '1001', titulo: 'Espresso', artista: 'Sabrina Carpenter', duracao_s: 30, tipo: 'music',
    capa: 'https://cdn/c.jpg', preview: 'https://www.instagram.com/reels/audio/1001',
  });
  assert(!JSON.stringify(r).includes('expira.mp3'), 'download_url não volta');
  assert((r.avisos as string[]).some((a) => a.includes('download_url') && a.includes('expira')));
  assertEquals(r.conta, 'cliente');
  semToken(r);
});

Deno.test('buscar: com search_query e original_sound; audio_id lê o áudio (GET /{id}); vazio volta lista vazia com aviso', async () => {
  const a = montar({ resposta: { status: 200, corpo: { data: [] } } });
  const r = await buscarAudiosInstagram({ client_id: CLIENTE, audio_type: 'original_sound', search_query: '  funk  ' }, ctx, a.deps) as Record<string, any>;
  assertEquals(a.urls[0].searchParams.get('search_query'), 'funk');
  assertEquals(a.urls[0].searchParams.get('audio_type'), 'original_sound');
  assertEquals(r.total, 0);
  assertEquals(r.audios, []);
  assert((r.avisos as string[])[0].includes('Nenhum áudio encontrado para "funk"'));
  semToken(r);

  const b = montar({ resposta: { status: 200, corpo: { id: '2002', title: 'Um', display_artist: 'X', duration_in_ms: 1000 } } });
  const um = await buscarAudiosInstagram({ client_id: CLIENTE, audio_id: '2002' }, ctx, b.deps) as Record<string, any>;
  assertEquals(b.urls[0].pathname, '/v26.0/2002');
  assert(b.urls[0].searchParams.get('fields')!.includes('on_platform_audio_preview_link'));
  assertEquals(b.urls[0].searchParams.get('user_id'), null);
  assertEquals(um.audios[0].audio_id, '2002');
  await assertRejects(() => buscarAudiosInstagram({ client_id: CLIENTE, audio_id: '1&x=y' }, ctx, b.deps), Error, 'audio_id inválido');
});

Deno.test('buscar: conta do login do Instagram (token IG...) recusa sem chamar a Meta e pede reconectar pelo Facebook', async () => {
  const { deps, urls } = montar({ tokens: [{ ig_user_id: IG_USER, access_token: TOKEN_IG, origem: 'cliente' }] });
  const e = await erroDe(() => buscarAudiosInstagram({ client_id: CLIENTE }, ctx, deps));
  assertEquals(urls.length, 0);
  assertEquals(e.codigo, 'reconectar_pelo_facebook');
  assertEquals(e.message, MENSAGEM_RECONECTE_PELO_FACEBOOK);
  semToken(e.message);
});

Deno.test('buscar: erro instagram_audio_requires_facebook_login, falta de permissão e token vencido viram frase clara, sem token', async () => {
  const casos: Array<[Resposta, string, string]> = [
    [{ status: 400, corpo: { error: { message: 'instagram_audio_requires_facebook_login', type: 'OAuthException', code: 100 } } }, 'reconectar_pelo_facebook', 'reconecte pelo Facebook'.replace('reconecte', 'Reconecte')],
    [{ status: 403, corpo: { error: { message: '(#10) Application does not have permission: instagram_basic', code: 10 } } }, 'falta_permissao', 'instagram_basic'],
    [{ status: 403, corpo: { error: { message: '(#200) Requires instagram_content_publish', code: 200 } } }, 'falta_permissao', 'instagram_content_publish'],
    [{ status: 400, corpo: { error: { message: `Error validating access token ${TOKEN}`, code: 190, error_subcode: 463 } } }, 'token_expirado', 'venceu'],
  ];
  for (const [resposta, codigo, frase] of casos) {
    const { deps } = montar({ resposta });
    const e = await erroDe(() => buscarAudiosInstagram({ client_id: CLIENTE }, ctx, deps));
    assertEquals(e.codigo, codigo, frase);
    assert(e.message.includes(frase), e.message);
    semToken(e.message);
    semToken(String((e as { dica?: string }).dica ?? ''));
  }
  const rede = montar({ fetchFalha: true });
  const e = await erroDe(() => buscarAudiosInstagram({ client_id: CLIENTE }, ctx, rede.deps));
  assertEquals(e.codigo, 'meta_sem_resposta');
  assertEquals(e.transitorio, true);
  semToken(e.message);
});

Deno.test('buscar: fora do escopo não lê token; sem conta do cliente usa a da agência com aviso; sem nenhuma, pede conectar', async () => {
  const { deps, urls } = montar();
  await assertRejects(() => buscarAudiosInstagram({ client_id: CLIENTE }, ctxDeOutro, deps), Error, 'outside this MCP principal data scope');
  assertEquals(urls.length, 0);
  const ag = montar({ tokens: [{ ig_user_id: '999', access_token: TOKEN, origem: 'agencia' }], resposta: { status: 200, corpo: { data: [{ audio_id: '1', title: 't' }] } } });
  const r = await buscarAudiosInstagram({ client_id: CLIENTE }, ctx, ag.deps) as Record<string, any>;
  assertEquals(r.conta, 'agencia');
  assert((r.avisos as string[])[0].includes('conta da agência'));
  const nada = montar({ tokens: [] });
  const e = await erroDe(() => buscarAudiosInstagram({ client_id: CLIENTE }, ctx, nada.deps));
  assertEquals(e.codigo, 'sem_conexao');
});

// ------------------------------------------------------------------ definir áudio do Reel

const pedidoAudio = (extra: Record<string, unknown> = {}) => ({ publication_id: PUB_REEL, audio_id: '1001', confirmar: true as const, idempotency_key: 'audio-reel-0001', ...extra });

Deno.test('definir áudio: Reel do Instagram grava pela RPC uma vez, com volumes; post_id acha a publicação', async () => {
  const { deps, chamadas } = montar();
  const r = await definirAudioReel(pedidoAudio({ audio_volume: 40, video_volume: 100, audio_title: 'Espresso' }), ctx, deps) as Record<string, any>;
  assertEquals(chamadas.length, 1);
  assertEquals(chamadas[0].nome, RPCS_DO_AUDIO.definirAudio);
  assertEquals(chamadas[0].args, {
    p_publication_id: PUB_REEL, p_audio_id: '1001', p_audio_volume: 40, p_video_volume: 100, p_audio_title: 'Espresso', p_audio_artist: null,
  });
  assertEquals(r.ok, true);
  assertEquals(r.audio_configuration, { audio_id: '1001', audio_volume: 40, video_volume: 100 });
  assertEquals(r.post_id, POST_REEL);
  const de_novo = await definirAudioReel(pedidoAudio({ audio_volume: 40, video_volume: 100 }), ctx, deps) as Record<string, any>;
  assertEquals(de_novo.replay, true);
  assertEquals(chamadas.length, 1);

  const p = montar();
  await definirAudioReel({ post_id: POST_REEL, audio_id: '1001', confirmar: true, idempotency_key: 'audio-reel-0002' }, ctx, p.deps);
  assertEquals(p.chamadas[0].args.p_publication_id, PUB_REEL, 'a do Instagram, não a do Facebook');
});

Deno.test('definir áudio: carrossel, story e imagem recusam com a frase da Meta, sem RPC', async () => {
  for (const pub of [PUB_CARROSSEL, PUB_STORY]) {
    const { deps, chamadas } = montar();
    await assertRejects(() => definirAudioReel(pedidoAudio({ publication_id: pub }), ctx, deps), Error, 'a Meta só aceita audio_configuration em Reels; use musica_sugerida');
    assertEquals(chamadas.length, 0);
  }
  const t = tabelasBase();
  t.editorial_publications.push({ id: '66666666-6666-4666-8666-666666666605', post_id: POST_IMAGEM, client_id: CLIENTE, platform: 'instagram', status: 'planned', version: 1 });
  const { deps, chamadas } = montar({ tabelas: t });
  await assertRejects(() => definirAudioReel(pedidoAudio({ publication_id: '66666666-6666-4666-8666-666666666605' }), ctx, deps), Error, 'use musica_sugerida');
  assertEquals(chamadas.length, 0);
});

Deno.test('definir áudio: volumes 0, 101, 50.5 e "80" recusam antes de ler; publicada e fora do escopo recusam', async () => {
  for (const v of [0, 101, 50.5, '80']) {
    const { deps, chamadas } = montar();
    await assertRejects(() => definirAudioReel(pedidoAudio({ audio_volume: v }), ctx, deps), Error, 'inteiro de 1 a 100');
    await assertRejects(() => definirAudioReel(pedidoAudio({ video_volume: v }), ctx, deps), Error, 'inteiro de 1 a 100');
    assertEquals(chamadas.length, 0);
  }
  const t = tabelasBase();
  t.editorial_publications[0].status = 'published';
  const pub = montar({ tabelas: t });
  await assertRejects(() => definirAudioReel(pedidoAudio(), ctx, pub.deps), Error, 'já saiu');
  const fora = montar();
  await assertRejects(() => definirAudioReel(pedidoAudio(), ctxDeOutro, fora.deps), Error, 'outside this MCP principal data scope');
  assertEquals(fora.chamadas.length, 0);
  assert(!definirAudioSchema.safeParse({ audio_id: '1', confirmar: true, idempotency_key: 'audio-reel-0003' }).success, 'sem publication_id nem post_id');
});

Deno.test('definir áudio: remover com audio_id null; RPC inexistente responde aguardando_migracao sem erro técnico', async () => {
  const { deps, chamadas } = montar();
  const r = await definirAudioReel({ publication_id: PUB_REEL, audio_id: null, remover: true, confirmar: true, idempotency_key: 'audio-reel-rm01' }, ctx, deps) as Record<string, any>;
  assertEquals(chamadas[0].nome, RPCS_DO_AUDIO.removerAudio);
  assertEquals(chamadas[0].args, { p_publication_id: PUB_REEL });
  assertEquals(r.removido, true);
  await assertRejects(() => definirAudioReel({ publication_id: PUB_REEL, audio_id: '1', remover: true, confirmar: true, idempotency_key: 'audio-reel-rm02' }, ctx, deps), Error, 'audio_id null');

  const sem = montar({ rpcAusente: true });
  const e = await erroDe(() => definirAudioReel(pedidoAudio(), ctx, sem.deps));
  assertEquals(e.codigo, 'aguardando_migracao');
  assertEquals(e.message, MENSAGEM_AGUARDANDO_MIGRACAO);
  assert(e.message.includes('aguardando a migração aprovada pelo Almir'));
  assert(!/PGRST|schema cache|function/i.test(e.message));
  assertEquals(e.transitorio, false);

  const negado = montar({ rpcErro: 'editorial client access denied' });
  await assertRejects(() => definirAudioReel(pedidoAudio(), ctx, negado.deps), Error, 'não tem permissão');
});

// ------------------------------------------------------------------ música sugerida

Deno.test('música sugerida: vale em carrossel, story, imagem e reel; RPC como a pessoa; remover; url http recusa', async () => {
  for (const post of [POST_CARROSSEL, POST_STORY, POST_IMAGEM, POST_REEL]) {
    const { deps, chamadas } = montar();
    const r = await definirMusicaSugerida({ post_id: post, titulo: 'Espresso', artista: 'Sabrina Carpenter', url: 'https://www.instagram.com/reels/audio/1001', nota: 'refrão', confirmar: true, idempotency_key: 'musica-0001' }, ctx, deps) as Record<string, any>;
    assertEquals(chamadas.length, 1);
    assertEquals(chamadas[0].nome, RPCS_DO_AUDIO.definirMusica);
    assertEquals(chamadas[0].args, { p_post_id: post, p_titulo: 'Espresso', p_artista: 'Sabrina Carpenter', p_url: 'https://www.instagram.com/reels/audio/1001', p_nota: 'refrão' });
    assertEquals(r.musica_sugerida.titulo, 'Espresso');
  }
  const m = montar();
  await assertRejects(() => definirMusicaSugerida({ post_id: POST_CARROSSEL, titulo: 'X', url: 'http://inseguro.com', confirmar: true, idempotency_key: 'musica-0002' }, ctx, m.deps), Error, 'https://');
  await assertRejects(() => definirMusicaSugerida({ post_id: POST_CARROSSEL, confirmar: true, idempotency_key: 'musica-0003' }, ctx, m.deps), Error, 'titulo é obrigatório');
  assertEquals(m.chamadas.length, 0);
  const rm = await definirMusicaSugerida({ post_id: POST_CARROSSEL, remover: true, confirmar: true, idempotency_key: 'musica-0004' }, ctx, m.deps) as Record<string, any>;
  assertEquals(m.chamadas[0].nome, RPCS_DO_AUDIO.removerMusica);
  assertEquals(rm.musica_sugerida, null);
  await assertRejects(() => definirMusicaSugerida({ post_id: POST_CARROSSEL, titulo: 'X', confirmar: true, idempotency_key: 'musica-0005' }, ctxDeOutro, m.deps), Error, 'outside this MCP principal data scope');

  const sem = montar({ rpcAusente: true });
  const e = await erroDe(() => definirMusicaSugerida({ post_id: POST_STORY, titulo: 'X', confirmar: true, idempotency_key: 'musica-0006' }, ctx, sem.deps));
  assertEquals(e.codigo, 'aguardando_migracao');
});

// ------------------------------------------------------------------ leitura da Agenda

Deno.test('Agenda: musica_sugerida e audio_reel entram só como campo adicional; sem a migração nada muda', async () => {
  const base = () => ({
    items: [
      { kind: 'editorial_post', post: { id: POST_REEL, title: 'Reel', publications: [{ id: PUB_REEL, status: 'scheduled' }] } },
      { kind: 'editorial_post', post: { id: POST_CARROSSEL, title: 'Carrossel', publications: [] } },
      { kind: 'editorial_task', post: null, task: { id: 't1' } },
    ],
    total: 3,
  });
  const semMigracao = base();
  const antes = JSON.stringify(semMigracao);
  await comAudioEMusica(semMigracao, bancoFalso({}));
  assertEquals(JSON.stringify(semMigracao), antes);

  const comMigracao = base();
  let pedidos: unknown = null;
  await comAudioEMusica(comMigracao, bancoFalso({}, {
    [RPCS_DO_AUDIO.ler]: (args) => {
      pedidos = args.p_post_ids;
      return {
        data: {
          musicas: [{ post_id: POST_CARROSSEL, titulo: 'Espresso', artista: 'Sabrina', url: null, nota: null, updated_at: '2026-11-26T12:00:00Z' }],
          audios: [{ publication_id: PUB_REEL, post_id: POST_REEL, audio_id: '1001', audio_volume: 40, video_volume: null, audio_title: 'Espresso', audio_artist: null, updated_at: '2026-11-26T12:00:00Z' }],
        },
        error: null,
      };
    },
  }));
  assertEquals(pedidos, [POST_REEL, POST_CARROSSEL]);
  const [reel, carrossel, tarefa] = comMigracao.items as Array<Record<string, any>>;
  assertEquals(reel.post.musica_sugerida, null);
  assertEquals(reel.post.publications[0].audio_reel.audio_id, '1001');
  assertEquals(reel.post.publications[0].status, 'scheduled', 'o resto fica igual');
  assertEquals(carrossel.post.musica_sugerida.titulo, 'Espresso');
  assertEquals(tarefa.post, null);
  assertEquals(comMigracao.total, 3);
});

// ------------------------------------------------------------------ audio_configuration nas tools da Agenda

function bancoDaCriacao(contentType: string) {
  const t: Tabelas = {
    editorial_posts: [{ id: POST_REEL, version: 7, client_id: CLIENTE, project_id: PROJETO, primary_file_id: ARQUIVO, title: 'Reel', content_type: contentType, objective: null, default_caption: 'Legenda', production_status: 'ready', archived_at: null }],
    editorial_post_internal: [{ post_id: POST_REEL, idempotency_key: '55555555-5555-4555-8555-555555555555', task_id: null, responsible_id: null, internal_notes: null, revision_of_post_id: null, approval_fingerprint: 'f'.repeat(64) }],
    editorial_publications: [],
    files: [{ id: ARQUIVO, parent_file_id: null, archived_at: null, status: 'ready', agency_approval_status: 'approved', locked_at: '2026-11-10T10:00:00Z', visibility: 'approval', approval_status: 'approved', client_decided_at: '2026-11-10T12:00:00Z' }],
    external_accounts: [{ id: IG, client_id: CLIENTE, platform: 'instagram', status: 'active' }],
    project_external_accounts: [{ project_id: PROJETO, external_account_id: IG, client_id: CLIENTE }],
  };
  return t;
}

function depsDaCriacao(t: Tabelas, opcoes: { rpcAusente?: boolean } = {}) {
  const chamadas: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const deps: DependenciasDaCriacao = {
    banco: bancoFalso(t),
    rpc: (nome, args) => {
      chamadas.push({ nome, args });
      t.editorial_publications.push({ id: PUB_REEL, post_id: POST_REEL, version: 1, status: 'planned', platform: 'instagram', external_account_id: IG });
      return Promise.resolve({ post_id: POST_REEL, version: 8 });
    },
    rpcAudio: (nome, args) => {
      chamadas.push({ nome, args });
      if (opcoes.rpcAusente) return Promise.reject(new Error(`mesa:rpc_recusada ${nome}: Could not find the function public.${nome} in the schema cache`));
      return Promise.resolve({ ok: true });
    },
    umaVez: umaVezFalso(),
  };
  return { deps, chamadas };
}

Deno.test('criar publicação: sem audio_configuration nada muda; com ele, Reel grava o áudio depois de criar; carrossel recusa antes', async () => {
  const a = depsDaCriacao(bancoDaCriacao('reel'));
  const semAudio = await criarPublicacaoDeAprovado({ post_id: POST_REEL, external_account_id: IG, confirmar: true, idempotency_key: 'criar-pub-0001' }, ctx, a.deps) as Record<string, any>;
  assertEquals(a.chamadas.map((c) => c.nome), ['save_editorial_post']);
  assert(!('audio' in semAudio), 'sem o campo, a resposta é a de antes');

  const b = depsDaCriacao(bancoDaCriacao('reel'));
  const comAudio = await criarPublicacaoDeAprovado({ post_id: POST_REEL, external_account_id: IG, confirmar: true, idempotency_key: 'criar-pub-0002', audio_configuration: { audio_id: '1001', audio_volume: 30 } }, ctx, b.deps) as Record<string, any>;
  assertEquals(b.chamadas.map((c) => c.nome), ['save_editorial_post', RPCS_DO_AUDIO.definirAudio]);
  assertEquals(b.chamadas[1].args.p_publication_id, PUB_REEL);
  assertEquals(comAudio.audio, { gravado: true, audio_configuration: { audio_id: '1001', audio_volume: 30 } });

  const c = depsDaCriacao(bancoDaCriacao('carousel'));
  await assertRejects(() => criarPublicacaoDeAprovado({ post_id: POST_REEL, external_account_id: IG, confirmar: true, idempotency_key: 'criar-pub-0003', audio_configuration: { audio_id: '1001' } }, ctx, c.deps), Error, 'use musica_sugerida');
  assertEquals(c.chamadas.length, 0, 'recusa antes de criar');
  const d = depsDaCriacao(bancoDaCriacao('reel'));
  await assertRejects(() => criarPublicacaoDeAprovado({ post_id: POST_REEL, external_account_id: IG, confirmar: true, idempotency_key: 'criar-pub-0004', audio_configuration: { audio_id: '1001', video_volume: 101 } }, ctx, d.deps), Error, 'inteiro de 1 a 100');
  assertEquals(d.chamadas.length, 0);

  const e = depsDaCriacao(bancoDaCriacao('reel'), { rpcAusente: true });
  const sem = await criarPublicacaoDeAprovado({ post_id: POST_REEL, external_account_id: IG, confirmar: true, idempotency_key: 'criar-pub-0005', audio_configuration: { audio_id: '1001' } }, ctx, e.deps) as Record<string, any>;
  assertEquals(sem.publicacao.id, PUB_REEL, 'a publicação nasce mesmo sem a migração');
  assertEquals(sem.audio.gravado, false);
  assertEquals(sem.audio.aguardando_migracao, true);
  assertEquals(sem.audio.mensagem, MENSAGEM_AGUARDANDO_MIGRACAO);
});

Deno.test('reagendar: sem audio_configuration lê e chama igual a antes; com ele, grava o áudio ANTES do schedule e não agenda se falhar; story recusa antes', async () => {
  const montarReagendar = (t: Tabelas) => {
    const lidas: string[] = [];
    const chamadas: Array<{ nome: string; args: Record<string, unknown> }> = [];
    const banco = bancoFalso(t);
    const deps: DependenciasDoReagendar = {
      banco: { from: (tab: string) => { lidas.push(tab); return banco.from(tab); } },
      rpc: (nome, args) => { chamadas.push({ nome, args }); return Promise.resolve({ publication_id: args.p_publication_id, status: 'scheduled', version: 4 }); },
      umaVez: umaVezFalso(),
    };
    return { deps, lidas, chamadas };
  };
  const base = { expected_version: 3, scheduled_at: '2026-11-28T12:00:00-03:00', confirmar: true as const };
  const a = montarReagendar(tabelasBase());
  const semAudio = await reagendarPublicacao({ ...base, publication_id: PUB_REEL, idempotency_key: 'reag-0001' }, ctx, a.deps) as Record<string, any>;
  assertEquals(a.lidas, ['editorial_publications']);
  assertEquals(a.chamadas.map((c) => c.nome), ['transition_editorial_publication']);
  assert(!('audio' in semAudio));

  const b = montarReagendar(tabelasBase());
  const comAudio = await reagendarPublicacao({ ...base, publication_id: PUB_REEL, idempotency_key: 'reag-0002', audio_configuration: { audio_id: '1001', video_volume: 20 } }, ctx, b.deps) as Record<string, any>;
  assertEquals(b.chamadas.map((c) => c.nome), [RPCS_DO_AUDIO.definirAudio, 'transition_editorial_publication'], 'áudio antes de agendar');
  assertEquals(comAudio.audio.gravado, true);

  // Sem a migração (ou com recusa do banco): não agenda.
  for (const [falha, frase] of [['Could not find the function public.editorial_reel_audio_definir in the schema cache', 'aguardando a migração'], ['o publicador já está criando o Reel na Meta', 'Nada foi agendado']] as const) {
    const t = tabelasBase();
    const banco = bancoFalso(t);
    const chamadas: string[] = [];
    const deps: DependenciasDoReagendar = {
      banco,
      rpc: (nome) => {
        chamadas.push(nome);
        return nome === RPCS_DO_AUDIO.definirAudio ? Promise.reject(new Error(`mesa:rpc_recusada ${nome}: ${falha}`)) : Promise.resolve({ status: 'scheduled' });
      },
      umaVez: umaVezFalso(),
    };
    await assertRejects(() => reagendarPublicacao({ ...base, publication_id: PUB_REEL, idempotency_key: 'reag-0004', audio_configuration: { audio_id: '1001' } }, ctx, deps), Error, frase);
    assertEquals(chamadas, [RPCS_DO_AUDIO.definirAudio], 'transition não roda');
  }

  const c = montarReagendar(tabelasBase());
  await assertRejects(() => reagendarPublicacao({ ...base, publication_id: PUB_STORY, idempotency_key: 'reag-0003', audio_configuration: { audio_id: '1001' } }, ctx, c.deps), Error, 'use musica_sugerida');
  assertEquals(c.chamadas.length, 0, 'não agenda quando o áudio é recusado');
});

Deno.test('reagendar (2.42.0): versão velha não grava áudio; schedule recusado volta o áudio de antes', async () => {
  const base = { scheduled_at: '2026-11-28T12:00:00-03:00', confirmar: true as const, publication_id: PUB_REEL };
  const montar = (t: Tabelas, falhaNoSchedule: boolean) => {
    const chamadas: Array<{ nome: string; args: Record<string, unknown> }> = [];
    const deps: DependenciasDoReagendar = {
      banco: bancoFalso(t),
      rpc: (nome, args) => {
        chamadas.push({ nome, args });
        if (nome === 'transition_editorial_publication' && falhaNoSchedule) return Promise.reject(new Error('mesa:rpc_recusada horário no passado'));
        return Promise.resolve({ ok: true });
      },
      umaVez: umaVezFalso(),
    };
    return { deps, chamadas };
  };
  // Versão velha: recusa antes de qualquer RPC.
  const a = montar(tabelasBase(), false);
  await assertRejects(() => reagendarPublicacao({ ...base, expected_version: 2, idempotency_key: 'reag-v-0001', audio_configuration: { audio_id: '1001' } }, ctx, a.deps), Error, 'Nada foi gravado nem agendado');
  assertEquals(a.chamadas.length, 0);
  // Sem áudio, a versão segue com o banco (igual a antes).
  const a2 = montar(tabelasBase(), false);
  await reagendarPublicacao({ ...base, expected_version: 2, idempotency_key: 'reag-v-0002' }, ctx, a2.deps);
  assertEquals(a2.chamadas.map((c) => c.nome), ['transition_editorial_publication']);
  // Sem áudio antes: schedule recusado tira o áudio novo.
  const b = montar(tabelasBase(), true);
  await assertRejects(() => reagendarPublicacao({ ...base, expected_version: 3, idempotency_key: 'reag-v-0003', audio_configuration: { audio_id: '1001' } }, ctx, b.deps), Error, 'horário no passado');
  assertEquals(b.chamadas.map((c) => c.nome), [RPCS_DO_AUDIO.definirAudio, 'transition_editorial_publication', RPCS_DO_AUDIO.removerAudio]);
  // Com áudio antes: volta o anterior.
  const t = tabelasBase();
  t.editorial_publication_audio = [{ publication_id: PUB_REEL, audio_id: '777', audio_volume: 40, video_volume: null, audio_title: 'Antes', audio_artist: 'Fulano' }];
  const c = montar(t, true);
  await assertRejects(() => reagendarPublicacao({ ...base, expected_version: 3, idempotency_key: 'reag-v-0004', audio_configuration: { audio_id: '1001' } }, ctx, c.deps), Error, 'horário no passado');
  assertEquals(c.chamadas.map((x) => x.nome), [RPCS_DO_AUDIO.definirAudio, 'transition_editorial_publication', RPCS_DO_AUDIO.definirAudio]);
  assertEquals(c.chamadas[2].args, { p_publication_id: PUB_REEL, p_audio_id: '777', p_audio_volume: 40, p_video_volume: null, p_audio_title: 'Antes', p_audio_artist: 'Fulano' });
  // Replay da mesma chave depois do sucesso: devolve o replay, sem checar a versão de novo.
  const d = montar(tabelasBase(), false);
  const pedido = { ...base, expected_version: 3, idempotency_key: 'reag-v-0005', audio_configuration: { audio_id: '1001' } };
  await reagendarPublicacao(pedido, ctx, d.deps);
  const e = { ...d.deps, banco: bancoFalso({ ...tabelasBase(), editorial_publications: tabelasBase().editorial_publications.map((p) => p.id === PUB_REEL ? { ...p, version: 4 } : p) }) };
  const replay = await reagendarPublicacao(pedido, ctx, e) as Record<string, unknown>;
  assertEquals(replay.replay, true);
  assertEquals(d.chamadas.map((x) => x.nome), [RPCS_DO_AUDIO.definirAudio, 'transition_editorial_publication']);
  // Leitura do áudio atual falha (não por tabela ausente): nada é gravado nem agendado.
  const banco = bancoFalso(tabelasBase());
  const f = montar(tabelasBase(), false);
  const fDeps: DependenciasDoReagendar = {
    ...f.deps,
    banco: {
      from: (tab: string) => tab === 'editorial_publication_audio'
        ? { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }) }) }) }
        : banco.from(tab),
    },
  };
  await assertRejects(() => reagendarPublicacao({ ...base, expected_version: 3, idempotency_key: 'reag-v-0006', audio_configuration: { audio_id: '1001' } }, ctx, fDeps), Error, 'Nada foi gravado nem agendado');
  assertEquals(f.chamadas.length, 0);
});

Deno.test('definições: três ferramentas, nomes e escopos', () => {
  assertEquals(FERRAMENTAS_DE_AUDIO_INSTAGRAM.map((t) => t.name), ['aceleriq_buscar_audios_instagram', 'aceleriq_definir_audio_reel', 'aceleriq_definir_musica_sugerida']);
  assertEquals(FERRAMENTAS_DE_AUDIO_INSTAGRAM.map((t) => t.scopes[0]), ['editorial:read', 'editorial:write', 'editorial:write']);
});
