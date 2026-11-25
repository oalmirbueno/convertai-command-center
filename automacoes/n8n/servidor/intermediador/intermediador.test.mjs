import { test } from 'node:test';
import assert from 'node:assert/strict';
import { destinoConfere, diarioEmMapa, lerGrupos, mencoesConferem, planoDoEnvio, textoDaPrevia, ultimoPorGrupo, TENTATIVAS_RECUSADAS } from './intermediador.mjs';

const GRUPO = '120363000000000001@g.us';
const grupos = lerGrupos({ schemaVersion: 1, groups: [{ chat_id: GRUPO, group_name: 'Verzelo - MKT - Aceleriq', client_id: 'c1' }] });
const pergunta = { envio_id: 'e1', tipo: 'pergunta', destino: 'grupo', client_id: 'c1', chat_id: GRUPO, grupo_nome: 'Verzelo - MKT - Aceleriq',
  texto: 'Oi, @554799990000! Tudo bem?', texto_previa: 'Oi, @Carla! Tudo bem?', mencoes: ['554799990000@s.whatsapp.net'] };
const base = { modo: 'grupos', grupos, diario: new Map(), outros: new Map(), agora: Date.parse('2026-11-25T13:00:00Z') };

test('destino: só chat da lista da ponte, com o mesmo nome e o mesmo cliente', () => {
  assert.equal(destinoConfere(pergunta, grupos), true);
  assert.equal(destinoConfere({ ...pergunta, grupo_nome: 'Outro' }, grupos), false);
  assert.equal(destinoConfere({ ...pergunta, client_id: 'c2' }, grupos), false);
  assert.equal(destinoConfere({ ...pergunta, chat_id: '999@g.us' }, grupos), false);
  assert.equal(destinoConfere({ destino: 'dono' }, grupos), true);
});

test('menção: só número com @numero no texto; ao dono nunca há menção', () => {
  assert.equal(mencoesConferem(pergunta), true);
  assert.equal(mencoesConferem({ ...pergunta, texto: 'Oi!' }), false);
  assert.equal(mencoesConferem({ ...pergunta, mencoes: ['x@lid'] }), false);
  assert.equal(mencoesConferem({ destino: 'dono', mencoes: ['554799990000@s.whatsapp.net'] }), false);
});

test('prévia: texto ao grupo vai ao dono com rótulo e nome no lugar do número', () => {
  const t = textoDaPrevia(pergunta);
  assert.ok(t.startsWith('[Prévia → "Verzelo - MKT - Aceleriq" · pergunta]'));
  assert.ok(t.includes('@Carla') && !t.includes('554799990000'));
  assert.deepEqual(planoDoEnvio(pergunta, { ...base, modo: 'previa' }), { acao: 'previa' });
  assert.deepEqual(planoDoEnvio({ destino: 'dono', tipo: 'aviso_dono', mencoes: [], envio_id: 'e9' }, { ...base, modo: 'previa' }), { acao: 'dono' });
});

test('modo real: vai ao grupo; pergunta espera 10 min depois de outro envio automático no grupo', () => {
  assert.deepEqual(planoDoEnvio(pergunta, base), { acao: 'grupo' });
  const outros = ultimoPorGrupo([{ fase: 'envio', grupo: 'Verzelo - MKT - Aceleriq', enviado_em: '2026-11-25T12:55:00Z' }]);
  assert.equal(planoDoEnvio(pergunta, { ...base, outros }).acao, 'esperar');
  assert.equal(planoDoEnvio({ ...pergunta, tipo: 'fechamento', mencoes: [], texto: 'Perfeito, obrigado!' }, { ...base, outros }).acao, 'grupo');
});

test('intenção sem resultado nunca é repetida; recusa da ponte 3 vezes vira incerto', () => {
  const comIntencao = diarioEmMapa([{ fase: 'intencao', id: 'e1' }]);
  assert.equal(planoDoEnvio(pergunta, { ...base, diario: comIntencao }).acao, 'incerto');
  const desfeita = diarioEmMapa([{ fase: 'intencao', id: 'e1' }, { fase: 'intencao', id: 'e1', desfeita: true }]);
  assert.equal(planoDoEnvio(pergunta, { ...base, diario: desfeita }).acao, 'grupo');
  const recusas = diarioEmMapa(Array.from({ length: TENTATIVAS_RECUSADAS }, () => ({ fase: 'recusa', id: 'e1' })));
  assert.equal(planoDoEnvio(pergunta, { ...base, diario: recusas }).acao, 'incerto');
});

test('destino errado ou menção errada: pula sem enviar', () => {
  assert.equal(planoDoEnvio({ ...pergunta, grupo_nome: 'X' }, base).acao, 'pular');
  assert.equal(planoDoEnvio({ ...pergunta, texto: 'sem arroba' }, base).acao, 'pular');
});
