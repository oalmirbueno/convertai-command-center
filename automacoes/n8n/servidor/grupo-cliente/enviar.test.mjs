// node --test servidor/grupo-cliente/enviar.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { agoraSP, segundaDaSemana, textoProibido, janelaDaSemana, lembreteNoHorario, semanaAprovavel, lembreteEnviavel, ultimoEnvioPorGrupo } from './enviar.mjs';

const sp = (iso) => Date.parse(iso + '-03:00');
const CID = '6a847578-ba39-44cd-be61-08e34e18e4c9';
const grupos = new Map([[CID, { chat: '1@g.us', nome: 'Stop - MKT - Aceleriq' }]]);
const TEXTO = 'Bom dia, pessoal. Esta semana entram dois posts novos e a campanha segue no ar. Está tudo no painel: https://aceleriq.online/onde-estamos';
const pedido = (x) => Object.assign({ approval_id: 'a1', report_id: 'r1', client_id: CID, ritual: 'meio_semana', mensagem: TEXTO,
  destino: { channel: 'whatsapp', recipient: 'Stop - MKT - Aceleriq' }, valid_until: '2026-11-13T00:00:00Z' }, x);
const rel = (x) => ({ metrics: Object.assign({ written_by: 'n8n:ACQ-11', conferencia: { ok: true, semana: '2026-11-09', ritual: 'meio_semana' } }, x) });

test('relógio de São Paulo e segunda da semana', () => {
  const a = agoraSP(sp('2026-11-11T18:05:00'));
  assert.deepEqual([a.data, a.dia_semana, a.hora], ['2026-11-11', 3, 18]);
  assert.equal(segundaDaSemana('2026-11-11'), '2026-11-09');
  assert.equal(segundaDaSemana('2026-11-15'), '2026-11-09');
  assert.equal(segundaDaSemana('2026-11-09'), '2026-11-09');
});

test('janela: segunda 8h, quarta e sexta 18h, só no dia', () => {
  assert.equal(janelaDaSemana('rota_semana', sp('2026-11-09T07:59:00')), 'antes_da_hora');
  assert.equal(janelaDaSemana('rota_semana', sp('2026-11-09T08:00:00')), null);
  assert.equal(janelaDaSemana('meio_semana', sp('2026-11-11T17:59:00')), 'antes_da_hora');
  assert.equal(janelaDaSemana('meio_semana', sp('2026-11-11T18:00:00')), null);
  assert.equal(janelaDaSemana('meio_semana', sp('2026-11-12T18:00:00')), 'fora_do_dia');
  assert.equal(janelaDaSemana('prova_movimento', sp('2026-11-13T20:00:00')), 'depois_das_20h');
});

test('texto com termo interno, a palavra ritual ou marca de prévia não sai', () => {
  assert.equal(textoProibido(TEXTO), null);
  assert.equal(textoProibido(TEXTO + ' Este é o ritual da semana.'), 'palavra_ritual');
  assert.equal(textoProibido(TEXTO + ' Atualizamos o dossiê.'), 'termo_interno');
  assert.equal(textoProibido('[Prévia] ' + TEXTO), 'marca_interna');
  assert.equal(textoProibido('oi'), 'curto_demais');
});

test('mensagem da semana: só a do fluxo, conferida, desta semana, para o grupo exato', () => {
  const agora = sp('2026-11-11T18:01:00');
  assert.equal(semanaAprovavel(pedido(), rel(), grupos, agora), null);
  assert.equal(semanaAprovavel(pedido(), rel({ written_by: 'ai' }), grupos, agora), 'nao_veio_do_fluxo');
  assert.equal(semanaAprovavel(pedido(), rel({ conferencia: { ok: false } }), grupos, agora), 'sem_conferencia_aprovada');
  assert.equal(semanaAprovavel(pedido(), rel({ conferencia: { ok: true, semana: '2026-11-02', ritual: 'meio_semana' } }), grupos, agora), 'de_outra_semana');
  assert.equal(semanaAprovavel(pedido({ destino: { channel: 'whatsapp', recipient: 'Outro grupo' } }), rel(), grupos, agora), 'destino_fora_da_lista');
  assert.equal(semanaAprovavel(pedido({ client_id: 'x' }), rel(), grupos, agora), 'destino_fora_da_lista');
  assert.equal(semanaAprovavel(pedido({ valid_until: '2026-11-09T11:00:00Z' }), rel(), grupos, agora), 'vencido');
  assert.equal(semanaAprovavel(pedido({ ritual: null }), rel(), grupos, agora), 'nao_e_mensagem_da_semana');
  assert.equal(semanaAprovavel(pedido(), rel(), grupos, sp('2026-11-11T12:00:00')), 'antes_da_hora');
});

test('lembrete: só lembrete, com link, em dia útil das 9h às 18h; cobrança nunca', () => {
  const m = { mensagem_id: 'm1', tipo: 'lembrete_aprovacao', client_id: CID, destino: { channel: 'whatsapp', recipient: 'Stop - MKT - Aceleriq' },
    mensagem: 'Oi, pessoal! Tem 1 peça esperando a aprovação de vocês:\n• Post\nDá para aprovar direto por aqui: https://aceleriq.online/aprovacoes?peca=abc', enviar_ate: '2026-11-11T21:00:00Z' };
  const agora = sp('2026-11-11T10:00:00');
  assert.equal(lembreteEnviavel(m, grupos, agora), null);
  assert.equal(lembreteEnviavel(Object.assign({}, m, { tipo: 'cobranca' }), grupos, agora), 'nao_e_lembrete');
  assert.equal(lembreteEnviavel(Object.assign({}, m, { mensagem: 'Oi, pessoal! Tem 1 peça esperando a aprovação de vocês, vejam no painel.' }), grupos, agora), 'sem_link');
  assert.equal(lembreteEnviavel(m, grupos, sp('2026-11-11T08:30:00')), 'fora_do_horario');
  assert.equal(lembreteEnviavel(m, grupos, sp('2026-11-14T10:00:00')), 'vencido');
  assert.equal(lembreteNoHorario(sp('2026-11-15T10:00:00')), false);
});

test('intervalo no grupo soma os envios do post no ar e ignora intenção desfeita', () => {
  const u = ultimoEnvioPorGrupo([
    { fase: 'envio', grupo: 'A', enviado_em: '2026-11-11T21:00:00Z' },
    { fase: 'envio', grupo: 'A', aviso_id: 'x', em: '2026-11-11T21:05:00Z' },
    { fase: 'intencao', grupo: 'B', em: '2026-11-11T21:06:00Z', desfeita: true },
    { fase: 'previa', grupo: 'C', em: '2026-11-11T21:07:00Z' },
  ]);
  assert.equal(u.get('A'), Date.parse('2026-11-11T21:05:00Z'));
  assert.equal(u.has('B'), false);
  assert.equal(u.has('C'), false);
});

// ---- relatório semanal de anúncios (ACQ-15)
import { janelaDosAnuncios, semanaFechada, anunciosAprovavel } from './enviar.mjs';
const TEXTO_ADS = 'Bom dia, time.\n\n*Anúncios de 02/11 a 08/11*\n10 contatos novos chegaram pelos anúncios.\n\n*O que fizemos*\nAjustamos o público para 25 a 65 anos.\n\nPara conferir o restante, está tudo no painel: https://aceleriq.online/onde-estamos';
const pedidoAds = (x) => Object.assign({ approval_id: 'b1', report_id: 'r2', client_id: CID, ritual: null, mensagem: TEXTO_ADS,
  destino: { channel: 'whatsapp', recipient: 'Stop - MKT - Aceleriq' }, valid_until: '2026-11-17T00:00:00Z' }, x);
const relAds = (x) => ({ metrics: Object.assign({ written_by: 'n8n:ACQ-15', relatorio: 'anuncios_semana', conferencia: { ok: true, semana: '2026-11-02' } }, x) });

test('anúncios: terça das 9h às 20h; a semana do relatório é a fechada anterior', () => {
  assert.equal(janelaDosAnuncios(sp('2026-11-10T09:05:00')), null);
  assert.equal(janelaDosAnuncios(sp('2026-11-10T08:50:00')), 'antes_da_hora');
  assert.equal(janelaDosAnuncios(sp('2026-11-10T20:00:00')), 'depois_das_20h');
  assert.equal(janelaDosAnuncios(sp('2026-11-11T10:00:00')), 'fora_do_dia');
  assert.equal(semanaFechada(sp('2026-11-10T09:05:00')), '2026-11-02');
});

test('anúncios: só aprova o que veio do ACQ-15, conferido, da semana fechada, para o grupo exato', () => {
  const t = sp('2026-11-10T09:05:00');
  assert.equal(anunciosAprovavel(pedidoAds(), relAds(), grupos, t), null);
  assert.equal(anunciosAprovavel(pedidoAds({ ritual: 'meio_semana' }), relAds(), grupos, t), 'e_mensagem_da_semana');
  assert.equal(anunciosAprovavel(pedidoAds(), rel(), grupos, t), 'nao_veio_do_fluxo');
  assert.equal(anunciosAprovavel(pedidoAds(), relAds({ conferencia: { ok: false, semana: '2026-11-02' } }), grupos, t), 'sem_conferencia_aprovada');
  assert.equal(anunciosAprovavel(pedidoAds(), relAds({ conferencia: { ok: true, semana: '2026-10-26' } }), grupos, t), 'de_outra_semana');
  assert.equal(anunciosAprovavel(pedidoAds({ destino: { channel: 'whatsapp', recipient: 'Outro grupo' } }), relAds(), grupos, t), 'destino_fora_da_lista');
  assert.equal(anunciosAprovavel(pedidoAds({ mensagem: TEXTO_ADS + ' Foram R$ 61,84.' }), relAds(), grupos, t), 'valor_em_reais');
  assert.equal(anunciosAprovavel(pedidoAds(), relAds(), grupos, sp('2026-11-11T10:00:00')), 'fora_do_dia');
  const ensaio = relAds({ conferencia: { ok: true, semana: 'ensaio:2026-11-11' } });
  assert.equal(anunciosAprovavel(pedidoAds(), ensaio, grupos, sp('2026-11-11T10:00:00'), true), null);
  assert.equal(anunciosAprovavel(pedidoAds(), ensaio, grupos, t), 'de_outra_semana');
  assert.equal(semanaAprovavel(pedidoAds(), relAds(), grupos, t), 'nao_e_mensagem_da_semana');
});
