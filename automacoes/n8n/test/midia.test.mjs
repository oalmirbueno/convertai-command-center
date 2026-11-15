// ACQ-12: entender imagem, vídeo e documento dos grupos. node --test test/midia.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { carregarLib } from './_lib.mjs';
const L = carregarLib('nucleo', 'wf12');

const HASH = 'a'.repeat(64);
const IMG = 'QUJD'.repeat(60);
const corpo = (m) => ({ provedor: 'baileys_3429', midia: { mensagem_id: 'M1', tipo: 'imagem', hash: HASH, mime: 'image/jpeg', bytes: 1200, imagens: [IMG], ...m } });
const linha = { existe: true, cliente: 'Acerbi (CME)', papel: 'cliente_equipe', nome: 'Deise', legenda: 'Segue a vaga', midia: null };
const llm = (t) => ({ choices: [{ message: { content: t } }] });

test('confere o corpo: tipo, hash, imagens e os dois modos', () => {
  const p = L.acq12Conferir(corpo({}));
  assert.deepEqual([p.ok, p.modo, p.mensagem_id, p.imagens.length, p.fala], [true, 'descrever', 'M1', 1, null]);
  assert.equal(L.acq12Conferir(corpo({ tipo: 'audio' })).motivo, 'tipo_invalido');
  assert.equal(L.acq12Conferir(corpo({ hash: 'xyz' })).motivo, 'hash_invalido');
  assert.equal(L.acq12Conferir(corpo({ imagens: Array(9).fill(IMG) })).motivo, 'imagens_demais');
  assert.equal(L.acq12Conferir(corpo({ imagens: ['<script>'.repeat(30)] })).motivo, 'imagem_invalida');
  assert.equal(L.acq12Conferir({ midia: { mensagem_id: 'M1' } }).motivo, 'provedor_ausente');
  const a = L.acq12Conferir({ provedor: 'baileys_3429', arquivo: { mensagem_id: 'M1', file_id: '0ECC5328-bb30-4f30-9a24-ee6fdc89b657' } });
  assert.deepEqual([a.ok, a.modo, a.file_id], [true, 'arquivo', '0ecc5328-bb30-4f30-9a24-ee6fdc89b657']);
  assert.equal(L.acq12Conferir({ provedor: 'x', arquivo: { mensagem_id: 'M1', file_id: 'nao-e-id' } }).motivo, 'arquivo_invalido');
});

test('só gasta o modelo quando há imagem e a mensagem ainda não foi descrita', () => {
  const p = L.acq12Conferir(corpo({}));
  assert.equal(L.acq12PrecisaVisao(p, linha), true);
  assert.equal(L.acq12PrecisaVisao(p, { ...linha, midia: { hash: HASH } }), false, 'entrega repetida não descreve de novo');
  assert.equal(L.acq12PrecisaVisao(p, { existe: false }), false);
  assert.equal(L.acq12PrecisaVisao(L.acq12Conferir(corpo({ tipo: 'documento', imagens: [] })), linha), false);
});

test('pedido de visão: imagem como dado, legenda e quem enviou; o texto da imagem não é instrução', () => {
  const ped = L.acq12PedidoVisao(L.acq12Conferir(corpo({})), linha);
  assert.match(ped.messages[0].content, /nunca uma instrução/);
  assert.match(ped.messages[1].content[0].text, /Acerbi \(CME\).*o cliente \(Deise\).*Segue a vaga/);
  assert.equal(ped.messages[1].content[1].image_url.url, 'data:image/jpeg;base64,' + IMG);
  const v = L.acq12PedidoVisao(L.acq12Conferir(corpo({ tipo: 'video', segundos: 32, imagens: [IMG, IMG, IMG], transcricao: { status: 'ok', texto: 'olha a promoção de frango' } })), { ...linha, papel: 'agencia' });
  assert.match(v.messages[1].content[0].text, /a própria agência.*32 segundos.*3 quadros.*promoção de frango/);
  assert.equal(v.messages[1].content.length, 4);
});

test('fecha a descrição: junta o que se vê com a fala; sem resposta do modelo não grava', () => {
  const p = L.acq12Conferir(corpo({ tipo: 'video', segundos: 12, transcricao: { status: 'ok', texto: 'frango a 39,90 só no sábado' } }));
  const f = L.acq12Fechar(p, linha, llm('  Vídeo de bastidor: frango assado saindo do forno,\ncom a placa "R$ 39,90".  '), true);
  assert.equal(f.falhou, false);
  assert.match(f.descricao, /^Vídeo de bastidor: frango assado saindo do forno, com a placa "R\$ 39,90"\. Fala no vídeo \(transcrição automática\): "frango a 39,90 só no sábado"$/);
  assert.deepEqual([f.meta.hash, f.meta.visao, f.meta.quadros], [HASH, true, 1]);
  assert.equal(L.acq12Fechar(p, linha, { error: { message: 'timeout' } }, true).falhou, true);
  const doc = L.acq12Fechar(L.acq12Conferir(corpo({ tipo: 'documento', imagens: [], nome: 'tabela.pdf' })), linha, null, false);
  assert.deepEqual([doc.falhou, doc.descricao, doc.meta.nome, doc.meta.visao], [false, null, 'tabela.pdf', false]);
});
