// node --test servidor/leitor-grupos/leitor.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { carregarGrupos, normalizar, desembrulhar, corpoDoWebhook, audioCabe, vencidos, numeroDe, PROVEDOR, midiaCabe, extensaoDe, quadrosDoVideo, corpoDaMidia } from './leitor.mjs';

const G = '120363428599963988@g.us';
const grupos = carregarGrupos(JSON.stringify({ groups: [{ chat_id: G, group_name: 'Acerbi', client_id: '39ebda82-637c-498b-a23a-b622f645e852' }, { chat_id: '5541@s.whatsapp.net', client_id: 'x' }] }));
const AGORA = Date.parse('2026-11-10T15:00:00Z');
const seg = Math.floor(AGORA / 1000) - 60;
const m = (message, key = {}) => ({ key: { remoteJid: G, id: 'ABC123', participant: '111@lid', participantAlt: '5547999990000@s.whatsapp.net', ...key }, pushName: 'Maria', messageTimestamp: seg, message });

test('só grupo da lista entra; particular nunca', () => {
  assert.equal(grupos.size, 1);
  assert.equal(normalizar(m({ conversation: 'oi' }, { remoteJid: '5541999@s.whatsapp.net' }), grupos, AGORA), null);
  assert.equal(normalizar(m({ conversation: 'oi' }, { remoteJid: '120363000000000000@g.us' }), grupos, AGORA), null);
});

test('texto, autor pelo telefone e resposta', () => {
  const r = normalizar(m({ extendedTextMessage: { text: 'pode postar amanhã', contextInfo: { stanzaId: 'Q1' } } }), grupos, AGORA);
  assert.deepEqual([r.tipo, r.texto, r.de, r.nome, r.resposta_a, r.de_mim], ['texto', 'pode postar amanhã', '5547999990000', 'Maria', 'Q1', false]);
  assert.equal(numeroDe('5547999990000:12@s.whatsapp.net'), '5547999990000');
});

test('mensagem do próprio número entra marcada (serve para saber o que já foi dito)', () => {
  const r = normalizar(m({ conversation: 'Post novo no ar' }, { fromMe: true }), grupos, AGORA);
  assert.deepEqual([r.de, r.de_mim, r.nome], ['eu', true, null]);
});

test('áudio, temporária, imagem com legenda; reação e sistema ficam de fora', () => {
  const a = normalizar(m({ ephemeralMessage: { message: { audioMessage: { seconds: 42, fileLength: 9000 } } } }), grupos, AGORA);
  assert.deepEqual([a.tipo, a.segundos, a.media_id], ['audio', 42, 'ABC123']);
  assert.equal(normalizar(m({ imageMessage: { caption: 'foto do prato' } }), grupos, AGORA).texto, 'foto do prato');
  assert.equal(normalizar(m({ reactionMessage: { text: '👍' } }), grupos, AGORA), null);
  assert.equal(normalizar(m({ protocolMessage: { type: 0 } }), grupos, AGORA), null);
  assert.equal(desembrulhar({ viewOnceMessageV2: { message: { conversation: 'x' } } }).conversation, 'x');
});

test('mensagem velha (histórico do pareamento) não entra', () => {
  const velha = { ...m({ conversation: 'antiga' }), messageTimestamp: seg - 3 * 86400 };
  assert.equal(normalizar(velha, grupos, AGORA), null);
});

test('limites do áudio e faxina de 7 dias', () => {
  assert.equal(audioCabe({ segundos: 60, bytes: 1000 }), null);
  assert.equal(audioCabe({ segundos: 16 * 60, bytes: 1000 }), 'audio_longo_demais');
  assert.deepEqual(vencidos([{ nome: 'a.ogg', mtimeMs: AGORA - 8 * 86400000 }, { nome: 'b.ogg', mtimeMs: AGORA - 86400000 }], AGORA, 7), ['a.ogg']);
});

test('corpo do webhook no formato do ACQ-04', () => {
  const a = normalizar(m({ audioMessage: { seconds: 5, fileLength: 100 } }), grupos, AGORA);
  const c = corpoDoWebhook(a, { status: 'ok', texto: 'bom dia', media: 'h' });
  assert.equal(c.provedor, PROVEDOR);
  assert.deepEqual([c.mensagem.id, c.mensagem.grupo, c.mensagem.tipo, c.transcricao.texto], ['ABC123', G, 'audio', 'bom dia']);
  assert.equal(corpoDoWebhook(normalizar(m({ conversation: 'oi' }), grupos, AGORA), null).transcricao, undefined);
});

test('imagem, vídeo e documento: guarda o que precisa para baixar, limites e extensão', () => {
  const i = normalizar(m({ imageMessage: { caption: 'vaga', mimetype: 'image/jpeg', fileLength: 120000 } }), grupos, AGORA);
  assert.deepEqual([i.tipo, i.media_id, i.mime, i.bytes, midiaCabe(i), extensaoDe(i)], ['imagem', 'ABC123', 'image/jpeg', 120000, null, 'jpg']);
  const v = normalizar(m({ videoMessage: { seconds: 32, mimetype: 'video/mp4', fileLength: 70 * 1024 * 1024 } }), grupos, AGORA);
  assert.deepEqual([v.tipo, v.segundos, midiaCabe(v), extensaoDe(v)], ['video', 32, 'midia_grande_demais', 'mp4']);
  const d = normalizar(m({ documentMessage: { fileName: 'Tabela Novembro.XLS', mimetype: 'application/vnd.ms-excel', fileLength: 5000 } }), grupos, AGORA);
  assert.deepEqual([d.tipo, d.texto, extensaoDe(d), midiaCabe(d)], ['documento', 'Tabela Novembro.XLS', 'xls', null]);
  assert.equal(midiaCabe({ tipo: 'texto', bytes: 1 }), 'tipo_sem_midia');
});

test('quadros do vídeo espalhados e corpo do ACQ-12 sem o arquivo original', () => {
  assert.deepEqual(quadrosDoVideo(0), [0]);
  assert.deepEqual(quadrosDoVideo(10), [2.5, 7.5]);
  const q = quadrosDoVideo(120);
  assert.equal(q.length, 6);
  assert.ok(q[0] > 0 && q[5] < 120 && q.every((t, k) => k === 0 || t > q[k - 1]));
  const c = corpoDaMidia({ mensagem_id: 'ABC123', grupo: G, tipo: 'imagem', mime: 'image/jpeg', hash: 'a'.repeat(64), bytes: 9, arquivo: 'x.jpg' }, ['QUJD']);
  assert.deepEqual([c.provedor, c.midia.mensagem_id, c.midia.imagens.length, c.midia.arquivo], [PROVEDOR, 'ABC123', 1, undefined]);
});

test('o leitor não tem nenhuma chamada de envio, leitura marcada ou presença', () => {
  const fonte = fs.readFileSync(new URL('./leitor.mjs', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  for (const proibido of ['sendMessage', 'readMessages', 'sendPresenceUpdate', 'sendReceipt', 'groupUpdate', 'groupParticipantsUpdate', 'chatModify', 'relayMessage'])
    assert.equal(fonte.includes(proibido), false, 'achou ' + proibido);
});
