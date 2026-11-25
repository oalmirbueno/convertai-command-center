// Trava da ponte do 3429 com menção (25/11/2026, intermediador dos grupos).
// Roda contra o pilot_guard.mjs da mesma pasta: node --test pilot_guard.mencao.test.mjs
// Com GUARD=<caminho> roda contra outro arquivo (ex.: a cópia antiga, para ver os testes novos falharem).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const arquivo = process.env.GUARD || new URL('./pilot_guard.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const { PilotGuard } = await import(pathToFileURL(arquivo).href);

const GRUPO = '120363000000000001@g.us';
const NOME = 'Verzelo - MKT - Aceleriq';
const CLIENTE = '554799990000@s.whatsapp.net';
const DE_FORA = '554711110000@s.whatsapp.net';

function guarda() {
  const dir = mkdtempSync(join(tmpdir(), 'guard-'));
  const groups = Array.from({ length: 13 }, (_, i) => ({ chat_id: i === 0 ? GRUPO : `1203630000000000${String(i + 10)}@g.us`, group_name: i === 0 ? NOME : `Grupo ${i}`, client_id: `c${i}` }));
  const file = join(dir, 'allowed.json');
  writeFileSync(file, JSON.stringify({ schemaVersion: 1, groups }));
  return new PilotGuard({ token: 'x'.repeat(40), stateDir: join(dir, 'estado'), allowedGroupsFile: file });
}
function sock({ subject = NOME, participants = [{ id: '123456789012345@lid', phoneNumber: CLIENTE }, { id: '554197483429@s.whatsapp.net' }] } = {}) {
  const enviados = [];
  return {
    enviados,
    user: { id: '554197483429:12@s.whatsapp.net' },
    groupMetadata: async () => ({ subject, participants }),
    sendMessage: async (id, payload) => { enviados.push({ id, payload }); return { key: { id: '3EB0TESTE' } }; },
  };
}

test('texto simples no grupo continua saindo como antes', async () => {
  const s = sock();
  await guarda().send(s, GRUPO, { text: 'Bom dia, time.' });
  assert.equal(s.enviados.length, 1);
});

test('grupo com LID: a menção pelo telefone sai pelo id do participante, no texto e na lista', async () => {
  const s = sock();
  await guarda().send(s, GRUPO, { text: 'Oi, @554799990000! Tudo bem?', mentions: [CLIENTE] });
  assert.deepEqual(s.enviados[0].payload, { text: 'Oi, @123456789012345! Tudo bem?', mentions: ['123456789012345@lid'] });
});

test('grupo pelo telefone: a menção sai como veio', async () => {
  const s = sock({ participants: [{ id: CLIENTE, lid: '123456789012345@lid' }] });
  await guarda().send(s, GRUPO, { text: 'Oi, @554799990000!', mentions: [CLIENTE] });
  assert.deepEqual(s.enviados[0].payload, { text: 'Oi, @554799990000!', mentions: [CLIENTE] });
});

test('menção escondida (sem @numero no texto) é recusada', async () => {
  const s = sock();
  await assert.rejects(() => guarda().send(s, GRUPO, { text: 'Oi! Tudo bem?', mentions: [CLIENTE] }), /group mention not allowed/);
  assert.equal(s.enviados.length, 0);
});

test('menção de quem não está no grupo é recusada', async () => {
  const s = sock();
  await assert.rejects(() => guarda().send(s, GRUPO, { text: 'Oi, @554711110000!', mentions: [DE_FORA] }), /not in group/);
  assert.equal(s.enviados.length, 0);
});

test('mais de 2 menções, menção de grupo ou lid é recusada', async () => {
  const g = guarda();
  const s = sock();
  const tres = ['554799990000', '554799990001', '554799990002'];
  await assert.rejects(() => g.send(s, GRUPO, { text: tres.map((n) => '@' + n).join(' '), mentions: tres.map((n) => n + '@s.whatsapp.net') }), /mention not allowed/);
  await assert.rejects(() => g.send(s, GRUPO, { text: '@123456789012345', mentions: ['123456789012345@lid'] }), /mention not allowed/);
  await assert.rejects(() => g.send(s, GRUPO, { text: '@x', mentions: [GRUPO] }), /mention not allowed/);
  assert.equal(s.enviados.length, 0);
});

test('nome do grupo diferente continua barrando, mesmo com menção válida', async () => {
  const s = sock({ subject: 'Outro nome' });
  await assert.rejects(() => guarda().send(s, GRUPO, { text: 'Oi, @554799990000!', mentions: [CLIENTE] }), /name mismatch/);
});

test('mídia, citação e campo estranho continuam barrados', async () => {
  const g = guarda();
  const s = sock();
  await assert.rejects(() => g.send(s, GRUPO, { image: { url: 'x' }, caption: 'oi' }), /plain text only/);
  await assert.rejects(() => g.send(s, GRUPO, { text: 'oi @554799990000', mentions: [CLIENTE], contextInfo: {} }), /plain text only/);
  await assert.rejects(() => g.send(s, GRUPO, { text: 'oi' }, 60000, { quoted: {} }), /plain text only/);
});

test('middleware: grupo liberado aceita mentions válidas e recusa replyTo e menção escondida', () => {
  const g = guarda();
  const s = sock();
  const chamar = (body) => {
    let status = 200, saiu = false;
    const req = { socket: { remoteAddress: '127.0.0.1' }, headers: { authorization: 'Bearer ' + 'x'.repeat(40) }, path: '/send', method: 'POST', body };
    const res = { status: (c) => { status = c; return { json: () => {} }; } };
    g.middleware(() => s)(req, res, () => { saiu = true; });
    return saiu ? 200 : status;
  };
  assert.equal(chamar({ chatId: GRUPO, message: 'Oi, @554799990000!', mentions: [CLIENTE] }), 200);
  assert.equal(chamar({ chatId: GRUPO, message: 'Oi!', mentions: [CLIENTE] }), 403);
  assert.equal(chamar({ chatId: GRUPO, message: 'Oi', replyTo: 'ABC' }), 403);
  assert.equal(chamar({ chatId: GRUPO, message: 'Oi' }), 200);
});
