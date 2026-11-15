// ACQ-09: resumo do dia das conversas dos grupos. node --test test/resumo.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { carregarLib } from './_lib.mjs';
const L = carregarLib('nucleo', 'wf09');

const CID = 'e590497e-f985-47be-b8f2-493bae1da7df';
const linha = { client_id: CID, rotulo: 'Verzelo - MKT - Aceleriq', dia: '2026-11-10', anteriores: [], mensagens: [
  { id: 'M1', hora: '08:36', papel: 'agencia', nome: 'Almir', tipo: 'texto', audio: false, texto: 'Bom dia', jev: 'ruido' },
  { id: 'M2', hora: '09:10', papel: 'cliente_equipe', nome: 'Thiélo', tipo: 'audio', audio: true, texto: 'Pode trocar a foto da capa pela da poda de ontem', jev: 'pedido' },
  { id: 'M3', hora: '09:20', papel: 'agencia', nome: 'Almir', tipo: 'texto', audio: false, texto: 'Me manda a foto em alta por favor', jev: 'pedido' },
  { id: 'M4', hora: '09:30', papel: 'bot', nome: null, tipo: 'texto', audio: false, texto: 'Post novo no ar: poda de palmeira', jev: null },
  { id: 'M5', hora: '09:31', papel: 'cliente_equipe', nome: 'Thiélo', tipo: 'texto', audio: false, texto: '   ', jev: null },
] };
const CFG = { leitura_grupos: { ativo: true, llm_url: 'http://x', llm_modelo: 'm' } };
const llm = (o) => ({ choices: [{ message: { content: JSON.stringify(o) } }] });
const jev = (o) => ({ answers: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { type: 'noul', noul: v }])) });

test('prepara o dia: só texto de verdade, ruído não conta, nome do cliente limpo', () => {
  const p = L.acq09Preparar(linha);
  assert.deepEqual([p.cliente, p.total, p.uteis, p.tem_conteudo], ['Verzelo', 4, 3, true]);
  assert.equal(p.mensagens[1].quem, 'Cliente — Thiélo');
  assert.equal(p.mensagens[3].quem, 'Aceleriq (número da equipe)');
  const soBomDia = L.acq09Preparar({ ...linha, mensagens: [linha.mensagens[0]] });
  assert.equal(soBomDia.tem_conteudo, false, 'dia só de bom dia não gasta modelo');
});

test('pedido ao modelo leva as mensagens, os dias anteriores e esquema fechado', () => {
  const p = L.acq09Preparar({ ...linha, anteriores: [{ dia: '2026-11-09', texto: '**09/11** — capa aprovada' }] });
  const ped = L.acq09PedidoResumo(p, CFG);
  assert.equal(ped.model, 'm');
  const u = JSON.parse(ped.messages[1].content);
  assert.equal(u.mensagens.length, 4);
  assert.equal(u.dias_anteriores[0].dia, '2026-11-09');
  assert.deepEqual(u.itens_ja_registrados, []);
  const p2 = L.acq09Preparar({ ...linha, ja_registrados: [{ tipo: 'pedido_cliente', texto: 'Thiélo pediu trocar a foto da capa.', ids: ['M2'] }, { tipo: null, texto: 'x' }] });
  assert.deepEqual(JSON.parse(L.acq09PedidoResumo(p2, CFG).messages[1].content).itens_ja_registrados, [{ tipo: 'pedido_cliente', texto: 'Thiélo pediu trocar a foto da capa.' }]);
  assert.match(ped.messages[0].content, /LETRA POR LETRA/);
  assert.equal(ped.response_format.json_schema.strict, true);
  assert.match(ped.messages[0].content, /Pedido da agência ao cliente NÃO é pedido_cliente/);
});

test('lê a resposta: item sem mensagem citada que exista é descartado; áudio é marcado pelo código', () => {
  const p = L.acq09Preparar(linha);
  const r = L.acq09LerResumo(llm({ resumo: 'O cliente pediu troca da capa.', sem_novidade: false, sugestoes: ['Cobrar a foto em alta até amanhã'], itens: [
    { tipo: 'pedido_cliente', texto: 'Thiélo pediu trocar a foto da capa pela da poda.', ids: ['M2'], veio_de_audio: false },
    { tipo: 'decisao', texto: 'Cliente aprovou verba de R$ 500.', ids: ['M99'], veio_de_audio: false },
    { tipo: 'inventado', texto: 'tipo que não existe aqui', ids: ['M2'], veio_de_audio: false },
    { tipo: 'pendencia_cliente', texto: 'Agência aguarda a foto em alta.', ids: ['M3', 'M77'], veio_de_audio: false } ] }), p);
  assert.equal(r.itens.length, 2);
  assert.equal(r.itens[0].veio_de_audio, true, 'M2 é áudio mesmo que o modelo diga que não');
  assert.deepEqual(r.itens[1].ids, ['M3']);
  assert.equal(L.acq09LerResumo({ choices: [{ message: { content: 'não é json' } }] }, p), null);
  assert.equal(L.acq09LerResumo(null, p), null);
});

test('Jev confere cada afirmação; a que não se sustenta sai; sem Jev nada é afirmado', () => {
  const p = L.acq09Preparar(linha);
  const r = L.acq09LerResumo(llm({ resumo: 'O cliente pediu troca da capa.', sem_novidade: false, sugestoes: ['Cobrar a foto em alta até amanhã'], itens: [
    { tipo: 'pedido_cliente', texto: 'Thiélo pediu trocar a foto da capa pela da poda.', ids: ['M2'], veio_de_audio: true },
    { tipo: 'pendencia_cliente', texto: 'Agência aguarda a foto em alta e o cliente prometeu para sexta.', ids: ['M3'], veio_de_audio: false } ] }), p);
  const ped = L.acq09PedidoConferencia(r, p);
  assert.deepEqual(Object.keys(ped.questions), ['resumo', 'item_0', 'item_1']);
  assert.equal(ped.state.mensagens.length, 3, 'ruído não vai para a conferência');
  const f = L.acq09Fechar(r, jev({ resumo: 0.93, item_0: 0.95, item_1: 0.2 }), p);
  assert.deepEqual([f.estado, f.itens.length, f.nao_confirmados.length], ['ok', 1, 1]);
  const texto = L.acq09Texto(f);
  assert.match(texto, /^\*\*10\/11\*\* — O cliente pediu troca da capa\./);
  assert.match(texto, /Pedido do cliente: Thiélo pediu.*de áudio/);
  assert.doesNotMatch(texto, /sexta/);
  const semJev = L.acq09Fechar(r, { erro: 'timeout' }, p);
  assert.deepEqual([semJev.estado, semJev.itens.length, L.acq09Texto(semJev)], ['sem_conferencia', 0, '']);
  assert.equal(L.acq09Fechar(null, null, p).estado, 'falhou_redacao');
  const nada = L.acq09Fechar(r, jev({ resumo: 0.1, item_0: 0.1, item_1: 0.1 }), p);
  assert.deepEqual([nada.estado, nada.sugestoes.length], ['sem_novidade', 0]);
});

test('mesmo conteúdo, mesmo hash; conteúdo diferente, hash diferente', () => {
  const p = L.acq09Preparar(linha);
  const r = () => L.acq09LerResumo(llm({ resumo: 'O cliente pediu troca da capa.', sem_novidade: false, sugestoes: [], itens: [{ tipo: 'pedido_cliente', texto: 'Thiélo pediu trocar a foto da capa.', ids: ['M2'], veio_de_audio: true }] }), p);
  const a = L.acq09Fechar(r(), jev({ resumo: 0.9, item_0: 0.9 }), p), b = L.acq09Fechar(r(), jev({ resumo: 0.8, item_0: 0.97 }), p);
  assert.equal(L.acq09Hash(a), L.acq09Hash(b), 'confiança diferente não muda o conteúdo');
  const c = L.acq09Fechar(r(), jev({ resumo: 0.9, item_0: 0.1 }), p);
  assert.notEqual(L.acq09Hash(a), L.acq09Hash(c));
});

test('dossiê: a seção substitui a anterior, preserva o resto e não empilha', () => {
  const dossie = '# Verzelo\n\nTexto do dono.\n\n## Leitura automática (n8n ACQ-01, proposta) | 03/11\n- fato\n\n## Contatos\n- Thiélo';
  const s1 = L.acq09SecaoDossie([{ dia: '2026-11-10', texto: '**10/11** — capa' }], dossie, 7);
  assert.equal(s1.mudou, true);
  assert.match(s1.conteudo, /Texto do dono\./);
  assert.match(s1.conteudo, /## Leitura automática \(n8n ACQ-01/);
  assert.match(s1.conteudo, /## Contatos\n- Thiélo/);
  const s2 = L.acq09SecaoDossie([{ dia: '2026-11-11', texto: '**11/11** — foto' }, { dia: '2026-11-10', texto: '**10/11** — capa' }], s1.conteudo, 7);
  assert.equal(s2.conteudo.match(/## Conversas do grupo de WhatsApp/g).length, 1, 'uma seção só');
  assert.ok(s2.conteudo.indexOf('11/11') < s2.conteudo.indexOf('**10/11**'), 'mais novo primeiro');
  assert.match(s2.conteudo, /Atualizado até 11\/11/);
  const s3 = L.acq09SecaoDossie([{ dia: '2026-11-11', texto: '**11/11** — foto' }, { dia: '2026-11-10', texto: '**10/11** — capa' }], s2.conteudo, 7);
  assert.equal(s3.mudou, false, 'rodar de novo sem novidade não escreve');
  const oito = Array.from({ length: 9 }, (_, i) => ({ dia: '2026-11-0' + (i + 1), texto: 'd' + (i + 1) }));
  assert.equal(L.acq09SecaoDossie(oito, '', 7).secao.includes('d2\n') || L.acq09SecaoDossie(oito, '', 7).secao.endsWith('d2'), false, 'só os 7 mais novos');
  assert.equal(L.acq09SemSecao(s2.conteudo).includes('Conversas do grupo'), false);
});
