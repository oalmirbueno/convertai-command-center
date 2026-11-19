// node --test servidor/grupo-cliente/vigia.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { vigiaDaSemana, textoDoVigia, motivoDaFalha } from './enviar.mjs';

const sp = (iso) => Date.parse(iso + '-03:00');
const grupos = new Map([['a', { chat: '1@g.us', nome: 'Stop - MKT - Aceleriq' }], ['b', { chat: '2@g.us', nome: 'Terra Arte - MKT - Aceleriq' }], ['c', { chat: '3@g.us', nome: 'Verzelo - MKT - Aceleriq' }]]);
const envio = (grupo, quando, id = 'semana:x') => ({ fase: 'envio', id, grupo, enviado_em: new Date(sp(quando)).toISOString() });

test('quarta: avisa 25 minutos depois das 18h se faltar grupo, e de novo às 19h30', () => {
  const linhas = [envio('Stop - MKT - Aceleriq', '2026-11-18T18:02:00')];
  assert.equal(vigiaDaSemana(linhas, grupos, sp('2026-11-18T18:20:00')), null);
  const v = vigiaDaSemana(linhas, grupos, sp('2026-11-18T18:26:00'));
  assert.deepEqual([v.chave, v.etapa, v.enviados, v.total], ['vigia-semana:2026-11-18:primeira', 'primeira', 1, 3]);
  assert.deepEqual(v.faltam, ['Terra Arte - MKT - Aceleriq', 'Verzelo - MKT - Aceleriq']);
  assert.equal(vigiaDaSemana(linhas, grupos, sp('2026-11-18T19:31:00')).etapa, 'ultima');
  assert.equal(vigiaDaSemana(linhas, grupos, sp('2026-11-18T20:00:00')), null);
});

test('segunda conta a partir das 8h; dia sem mensagem não avisa', () => {
  assert.equal(vigiaDaSemana([], grupos, sp('2026-11-16T08:24:00')), null);
  assert.equal(vigiaDaSemana([], grupos, sp('2026-11-16T08:25:00')).enviados, 0);
  assert.equal(vigiaDaSemana([], grupos, sp('2026-11-17T18:30:00')), null);
});

test('não repete o aviso do mesmo horário e não avisa se todos receberam', () => {
  const todos = [...grupos.values()].map((g) => envio(g.nome, '2026-11-18T18:03:00'));
  assert.equal(vigiaDaSemana(todos, grupos, sp('2026-11-18T18:30:00')), null);
  const jaAvisado = [{ fase: 'alerta', id: 'vigia-semana:2026-11-18:primeira' }];
  assert.equal(vigiaDaSemana(jaAvisado, grupos, sp('2026-11-18T18:40:00')), null);
  assert.equal(vigiaDaSemana(jaAvisado, grupos, sp('2026-11-18T19:30:00')).etapa, 'ultima');
});

test('só conta mensagem da semana de hoje: lembrete e envio de outro dia não contam', () => {
  const linhas = [envio('Stop - MKT - Aceleriq', '2026-11-18T10:00:00', 'lembrete:1'), envio('Verzelo - MKT - Aceleriq', '2026-11-16T08:05:00')];
  assert.equal(vigiaDaSemana(linhas, grupos, sp('2026-11-18T18:30:00')).enviados, 0);
});

test('texto do aviso: negrito, blocos, motivo por grupo e pista quando nada ficou pronto', () => {
  const v = vigiaDaSemana([], grupos, sp('2026-11-18T18:30:00'));
  const nada = textoDoVigia(v, new Map());
  assert.ok(nada.startsWith('*Mensagem de hoje não saiu para todos*\n\nAté 18:30 saiu para 0 de 3 grupos.'));
  assert.ok(nada.includes('IA do painel sem crédito'));
  assert.ok(!nada.includes('—'));
  const parcial = textoDoVigia(vigiaDaSemana([envio('Stop - MKT - Aceleriq', '2026-11-18T18:02:00')], grupos, sp('2026-11-18T19:30:00')), new Map([['Terra Arte - MKT - Aceleriq', 'nome_do_grupo']]));
  assert.ok(parcial.includes('• Terra Arte - MKT - Aceleriq: a ponte recusou, o nome do grupo mudou no WhatsApp'));
  assert.ok(parcial.includes('• Verzelo - MKT - Aceleriq: sem texto pronto'));
  assert.ok(parcial.endsWith('A janela de envio fecha às 20h.'));
});

test('motivo da falha: nome do grupo, ponte ou nada', () => {
  assert.equal(motivoDaFalha('ponte /send 500: guard: group name mismatch'), 'nome_do_grupo');
  assert.equal(motivoDaFalha('ponte /send 503: fora do ar'), 'ponte');
  assert.equal(motivoDaFalha('aceleriq_central_review_marcar_enviado: erro'), null);
});
