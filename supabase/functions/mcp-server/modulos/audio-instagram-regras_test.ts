// MCP 2.39.3 (26/11/2026): regras puras do áudio do Reel e da música sugerida, sem banco nem rede.
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  classificarErroDoAudio,
  ehReel,
  ehRpcAusente,
  MENSAGEM_RECONECTE_PELO_FACEBOOK,
  MENSAGEM_SO_INSTAGRAM,
  MENSAGEM_SO_REEL,
  pareceTokenDoLoginDoInstagram,
  problemaDoAudioNoConteudo,
  problemaNaPublicacaoParaAudio,
  resumirAudio,
  TIPOS_DE_REEL,
  validarAudioConfiguration,
  validarMusicaSugerida,
  validarUrlHttps,
  validarVolume,
} from './audio-instagram-regras.ts';

Deno.test('Reel aceita audio_configuration; os tipos são os mesmos do publicador (_kind = video)', () => {
  assertEquals([...TIPOS_DE_REEL], ['reel', 'video', 'short']);
  for (const t of TIPOS_DE_REEL) {
    assert(ehReel(t));
    assertEquals(problemaDoAudioNoConteudo({ content_type: t, platform: 'instagram' }), null);
  }
  const v = validarAudioConfiguration({ audio_id: '1234567890123456789', audio_volume: 40, video_volume: 100 });
  assert(v.ok);
  if (v.ok) assertEquals(v.valor, { audio_id: '1234567890123456789', audio_volume: 40, video_volume: 100 });
  const so = validarAudioConfiguration({ audio_id: '987' });
  assert(so.ok && !('audio_volume' in so.valor) && !('video_volume' in so.valor), 'sem volume = padrão da Meta, nada enviado');
});

Deno.test('volumes: 1 e 100 passam; 0, 101, 50.5, "80", -1, NaN recusam', () => {
  assertEquals(validarVolume('audio_volume', 1), { ok: true, valor: 1 });
  assertEquals(validarVolume('audio_volume', 100), { ok: true, valor: 100 });
  assertEquals(validarVolume('audio_volume', undefined), { ok: true, valor: null });
  assertEquals(validarVolume('audio_volume', null), { ok: true, valor: null });
  for (const ruim of [0, 101, 50.5, '80', -1, Number.NaN, true, {}]) {
    const r = validarVolume('video_volume', ruim);
    assert(!r.ok, `recusa ${String(ruim)}`);
    if (!r.ok) assert(r.erro.includes('inteiro de 1 a 100'), r.erro);
    const c = validarAudioConfiguration({ audio_id: '123', video_volume: ruim });
    assert(!c.ok, `configuração com ${String(ruim)} recusa`);
  }
});

Deno.test('audio_id: texto no formato da Meta; número, vazio, com espaço ou campo a mais recusam', () => {
  assert(!validarAudioConfiguration({ audio_id: 123456 }).ok, 'número perderia dígitos');
  assert(!validarAudioConfiguration({ audio_id: '' }).ok);
  assert(!validarAudioConfiguration({ audio_id: '12 34' }).ok);
  assert(!validarAudioConfiguration({ audio_id: '1&access_token=x' }).ok);
  assert(!validarAudioConfiguration({ audio_id: '1', extra: 1 }).ok);
  assert(!validarAudioConfiguration(null).ok);
  assert(!validarAudioConfiguration(['1']).ok);
  assert(!validarAudioConfiguration('1').ok);
});

Deno.test('carrossel, imagem e story recusam audio_configuration e aceitam musica_sugerida', () => {
  for (const t of ['carousel', 'static', 'story', 'article', 'google_post', 'other', null, undefined]) {
    assertEquals(problemaDoAudioNoConteudo({ content_type: t as string, platform: 'instagram' }), MENSAGEM_SO_REEL);
    const m = validarMusicaSugerida({ titulo: 'Espresso', artista: 'Sabrina Carpenter', url: 'https://www.instagram.com/reels/audio/1', nota: 'refrão em 0:12' });
    assert(m.ok, `musica_sugerida vale em ${String(t)}`);
  }
  assert(MENSAGEM_SO_REEL.startsWith('a Meta só aceita audio_configuration em Reels; use musica_sugerida'));
  assertEquals(problemaDoAudioNoConteudo({ content_type: 'reel', platform: 'facebook' }), MENSAGEM_SO_INSTAGRAM);
});

Deno.test('musica_sugerida: titulo obrigatório 1..200, artista ≤200, url só https, nota ≤500', () => {
  assert(!validarMusicaSugerida({}).ok);
  assert(!validarMusicaSugerida({ titulo: '   ' }).ok);
  assert(!validarMusicaSugerida({ titulo: 'x'.repeat(201) }).ok);
  assert(validarMusicaSugerida({ titulo: 'x'.repeat(200) }).ok);
  assert(!validarMusicaSugerida({ titulo: 'ok', artista: 'a'.repeat(201) }).ok);
  assert(!validarMusicaSugerida({ titulo: 'ok', nota: 'n'.repeat(501) }).ok);
  assert(validarMusicaSugerida({ titulo: 'ok', nota: 'n'.repeat(500) }).ok);
  for (const url of ['http://exemplo.com/a', 'ftp://exemplo.com', 'javascript:alert(1)', 'exemplo.com', 'https://user:pw@exemplo.com', '//exemplo.com']) {
    assert(!validarUrlHttps(url).ok, `recusa ${url}`);
    assert(!validarMusicaSugerida({ titulo: 'ok', url }).ok, `musica recusa ${url}`);
  }
  const ok = validarMusicaSugerida({ titulo: '  Espresso ', artista: '', url: 'https://open.spotify.com/track/1' });
  assert(ok.ok);
  if (ok.ok) assertEquals(ok.valor, { titulo: 'Espresso', artista: null, url: 'https://open.spotify.com/track/1', nota: null });
});

Deno.test('publicação publicada ou cancelada não recebe áudio', () => {
  assert(problemaNaPublicacaoParaAudio('published'));
  assert(problemaNaPublicacaoParaAudio('cancelled'));
  for (const s of ['planned', 'scheduled', 'failed']) assertEquals(problemaNaPublicacaoParaAudio(s), null);
});

Deno.test('RPC ausente: PGRST202, 42883 e a frase do PostgREST', () => {
  assert(ehRpcAusente({ code: 'PGRST202', message: 'x' }));
  assert(ehRpcAusente({ code: '42883', message: 'x' }));
  assert(ehRpcAusente(new Error('mesa:rpc_recusada editorial_reel_audio_definir: Could not find the function public.editorial_reel_audio_definir(p_audio_id, p_publication_id) in the schema cache')));
  assert(ehRpcAusente(new Error('function public.editorial_post_musica_definir(uuid, text) does not exist')));
  assert(!ehRpcAusente(new Error('editorial client access denied')));
});

Deno.test('erros da Meta: login do Instagram, permissão faltando, token vencido, limite', () => {
  assert(pareceTokenDoLoginDoInstagram('IGAAJ123'));
  assert(!pareceTokenDoLoginDoInstagram('EAAG123'));
  const fb = classificarErroDoAudio(400, { error: { message: 'instagram_audio_requires_facebook_login', code: 100 } });
  assertEquals(fb.codigo, 'reconectar_pelo_facebook');
  assertEquals(fb.mensagem, MENSAGEM_RECONECTE_PELO_FACEBOOK);
  const perm = classificarErroDoAudio(403, { error: { message: '(#10) Requires instagram_content_publish permission', code: 10 } });
  assertEquals(perm.codigo, 'falta_permissao');
  assert(perm.mensagem.includes('instagram_content_publish') && !perm.mensagem.includes('instagram_basic e'), perm.mensagem);
  const perm2 = classificarErroDoAudio(403, { error: { message: 'Missing permission', code: 200 } });
  assert(perm2.mensagem.includes('instagram_basic e instagram_content_publish'));
  assertEquals(classificarErroDoAudio(400, { error: { message: 'Error validating access token: Session has expired', code: 190, error_subcode: 463 } }).codigo, 'token_expirado');
  const lim = classificarErroDoAudio(400, { error: { code: 4 } });
  assertEquals(lim.codigo, 'limite');
  assert(lim.transitorio);
  assertEquals(classificarErroDoAudio(500, null).transitorio, true);
});

Deno.test('resumirAudio: enxuto, sem download_url, duração em segundos, só https', () => {
  const a = resumirAudio({
    audio_id: '111', title: 'Espresso', display_artist: 'Sabrina Carpenter', duration_in_ms: 175_500,
    cover_artwork_thumbnail_url: 'https://cdn/capa.jpg', on_platform_audio_preview_link: 'https://instagram.com/reels/audio/111',
    audio_type: 'music', ...{ download_url: 'https://cdn/expira.mp3' },
  } as never, 'music');
  assertEquals(a, {
    audio_id: '111', titulo: 'Espresso', artista: 'Sabrina Carpenter', duracao_s: 175.5, tipo: 'music',
    capa: 'https://cdn/capa.jpg', preview: 'https://instagram.com/reels/audio/111',
  });
  const b = resumirAudio({ id: '222', cover_artwork_thumbnail_url: 'http://inseguro' }, 'original_sound');
  assertEquals(b.audio_id, '222');
  assertEquals(b.capa, null);
  assertEquals(b.tipo, 'original_sound');
  assertEquals(b.duracao_s, null);
});
