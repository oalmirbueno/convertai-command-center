// ACQ-11: mensagem da semana no grupo do cliente. node --test test/semana.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { carregarLib } from './_lib.mjs';
const L = carregarLib('nucleo', 'adaptador', 'wf01', 'wf11');

const CID = '6a847578-ba39-44cd-be61-08e34e18e4c9';
const cfg = { operador: 'default', mensagem_semana: { ativo: true, clientes_fora: [] }, post_no_ar: { grupos: { [CID]: 'Stop - MKT - Aceleriq', outro: 'Outro - MKT' } } };
const alvo = { client_id: CID, cliente: 'Stop Informatica', grupo: 'Stop - MKT - Aceleriq', ativo: true, ja_enviada: false, ja_escrita: false, project_id: 'p1',
  dossie: 'x'.repeat(300), conversas: [{ dia: '2026-11-10', texto: 'Cliente pediu a arte da Black Friday.' }], anteriores: ['Bom dia, Priscila. Semana passada...'] };
const ritual = { tipo: 'meio_semana', chave_ciclo: 'quarta', semana: '2026-11-09', data: '2026-11-11' };
const texto = { ok: true, title: 'Mais conversas chegam pelos anúncios', next_steps: 'Avançar a comunicação até sexta.', alertas: [], model: 'm', custo_usd: 0.002,
  body: 'Boa tarde, Priscila. Meio da semana por aqui.\n\n*Anúncios*\nOs anúncios trouxeram 5 contatos de 04/11 a 10/11.\n\n*Vídeo da lista*\nEstá em andamento.\n\nPara conferir o restante, está tudo no painel: https://aceleriq.online/onde-estamos',
  fontes: { estado_real: 'Anúncios: 5 contatos de 04/11 a 10/11.', continuidade: '', dia_prioritario: '' } };
const jev = (n) => ({ answers: Object.assign(Object.fromEntries(['promessa', 'interno', 'repete'].map((k) => [k, { type: 'noul', noul: n[k] }])),
  Object.fromEntries(Array.from({ length: 12 }, (_, i) => ['f' + i, { type: 'choice', choice: 'apoia', probabilities: { apoia: Array.isArray(n.apoiada) ? (n.apoiada[i] ?? 0.9) : n.apoiada, contradiz: 0, nao_fala: 0 } }]))) });
const BOM = { apoiada: 0.9, promessa: 0.05, interno: 0.1, repete: 0.2 };

test('clientes vêm dos grupos liberados; cliente fora da lista não entra', () => {
  assert.equal(L.acq11Clientes(cfg, null).length, 2);
  assert.deepEqual(L.acq11Clientes(cfg, CID), [{ client_id: CID, grupo: 'Stop - MKT - Aceleriq' }]);
  assert.equal(L.acq11Clientes(Object.assign({}, cfg, { mensagem_semana: { ativo: true, clientes_fora: [CID] } }), CID).length, 0);
  assert.equal(L.acq11Config({}).ativo, false);
});

test('triagem: quem já recebeu, já tem texto, não tem dossiê ou está inativo fica de fora', () => {
  const t = L.acq11Triagem([alvo, Object.assign({}, alvo, { ja_enviada: true }), Object.assign({}, alvo, { ja_escrita: true }), Object.assign({}, alvo, { dossie: null }),
    Object.assign({}, alvo, { ativo: false }), Object.assign({}, alvo, { project_id: null })]);
  assert.equal(t.escrever.length, 1);
  assert.deepEqual(t.fora.map((f) => f.motivo), ['ja_enviada', 'ja_escrita', 'sem_dossie', 'cliente_inativo', 'sem_projeto']);
});

test('conferência: passa só com todas as notas boas; sem Jev nada sai', () => {
  assert.equal(L.acq11Conferir(texto, jev(BOM), ritual).ok, true);
  // frase sem apoio sai do texto e o resto segue (13/11: "tem que mandar todos e não só metade")
  const fraca = L.acq11Conferir(texto, jev(Object.assign({}, BOM, { apoiada: [0.9, 0.9, 0.9, 0.41] })), ritual);
  assert.equal(fraca.ok, true);
  assert.deepEqual(fraca.cortes, [{ frase: 'Está em andamento.', motivo: 'sem apoio nas fontes' }]);
  assert.doesNotMatch(fraca.corpo, /Está em andamento|Vídeo da lista/);
  assert.match(fraca.corpo, /5 contatos de 04\/11 a 10\/11/);
  assert.equal(fraca.notas.apoiada, 0.9);
  const semFrase = { answers: Object.assign({}, jev(BOM).answers) }; delete semFrase.answers.f2;
  assert.deepEqual(L.acq11Conferir(texto, semFrase, ritual).motivos, ['sem_conferencia']);
  assert.deepEqual(L.acq11Conferir(texto, jev(Object.assign({}, BOM, { promessa: 0.7 })), ritual).motivos, ['promessa_de_resultado']);
  assert.deepEqual(L.acq11Conferir(texto, jev(Object.assign({}, BOM, { repete: 0.8 })), ritual).motivos, ['repete_mensagem_anterior']);
  assert.deepEqual(L.acq11Conferir(texto, null, ritual).motivos, ['sem_conferencia']);
  assert.deepEqual(L.acq11Conferir(texto, { error: 'x' }, ritual).motivos, ['sem_conferencia']);
});

test('palavra ritual e termo interno seguram a mensagem mesmo com o Jev aprovando', () => {
  const comRitual = Object.assign({}, texto, { body: texto.body + ' Este é o nosso ritual de quarta.' });
  assert.ok(L.acq11Conferir(comRitual, jev(BOM), ritual).motivos.includes('palavra_ritual'));
  const comGrok = Object.assign({}, texto, { body: texto.body + ' O Grok bot já cuida da campanha.' });
  assert.ok(L.acq11Conferir(comGrok, jev(BOM), ritual).motivos.includes('termo_interno'));
  assert.equal(L.acq11TextoProibido('A espiritualidade da marca aparece em cada peça, com atenção ao cliente e ao que foi combinado na semana.'), null);
});

test('o Jev recebe o estado real do painel e as conversas como fonte', () => {
  const p = L.acq11PedidoConferencia(texto, alvo);
  assert.equal(p.model, 'jev-latest');
  assert.equal(p.state.evidencia.numeros_e_andamento, 'Anúncios: 5 contatos de 04/11 a 10/11.');
  assert.equal(p.state.evidencia.conversas_do_grupo[0].resumo, 'Cliente pediu a arte da Black Friday.');
  assert.deepEqual(Object.keys(p.questions), ['f0', 'p0', 'b0', 'f1', 'p1', 'b1', 'f2', 'p2', 'b2', 'f3', 'p3', 'b3', 'promessa', 'interno', 'repete']);
  assert.deepEqual(p.state.afirmacoes, ['Boa tarde, Priscila.', 'Meio da semana por aqui.', 'Os anúncios trouxeram 5 contatos de 04/11 a 10/11.', 'Está em andamento.']);
  assert.equal(p.questions.f2.type, 'choice');
  assert.match(p.questions.f2.instructions, /afirmacoes\[2\]/);
});

test('rascunho leva a conferência e nunca um título que faça o painel reescrever o texto', () => {
  const conf = L.acq11Conferir(texto, jev(BOM), ritual);
  const r = L.acq11Rascunho(texto, alvo, ritual, conf);
  assert.equal(r.metrics.written_by, 'n8n:ACQ-11');
  assert.equal(r.metrics.ritual_type, 'meio_semana');
  assert.equal(r.metrics.conferencia.semana, '2026-11-09');
  assert.equal(r.period_start, '2026-11-09'); assert.equal(r.period_end, '2026-11-15');
  assert.equal(r.idempotency_key, 'acq11:' + CID + ':2026-11-09:meio_semana:rascunho');
  assert.equal(L.acq11Titulo(Object.assign({}, texto, { title: 'Fechamento da semana da Stop' }), alvo, ritual), 'Atualização de 11/11 | Stop Informatica');
  assert.equal(L.acq11Titulo(texto, alvo, ritual), 'Mais conversas chegam pelos anúncios');
  const rev = L.acq11PedidoRevisao(alvo, ritual, 'rep1', texto, 'default');
  assert.deepEqual([rev.channel, rev.recipient, rev.summary], ['whatsapp', 'Stop - MKT - Aceleriq', texto.body]);
});

test('texto que o escritor não entregou vira motivo, não mensagem', () => {
  assert.equal(L.acq11LerTexto(null).ok, false);
  assert.equal(L.acq11LerTexto({ ok: true, resultado: { ok: false, motivo: 'O escritor não respondeu agora.' } }).motivo, 'O escritor não respondeu agora.');
  const a = L.acq11Aviso(alvo, ritual, 'conferencia', ['promessa_de_resultado']);
  assert.equal(a.titulo, 'Mensagem de quarta não saiu sozinha: Stop Informatica');
  assert.equal(a.detalhe.porque, 'promete resultado');
});

test('formato: sem negrito, texto corrido ou travessão não sai sozinho', () => {
  assert.equal(L.acq11Formato(texto.body), null);
  assert.equal(L.acq11Conferir(texto, jev(BOM), ritual).ok, true);
  const corrido = Object.assign({}, texto, { body: 'Boa tarde, Priscila. Os anúncios trouxeram 5 contatos de 04/11 a 10/11.\nO vídeo da lista está em andamento.\nEstá tudo no painel: https://aceleriq.online/onde-estamos' });
  assert.deepEqual(L.acq11Conferir(corrido, jev(BOM), ritual).motivos, ['sem_negrito']);
  const colado = Object.assign({}, texto, { body: texto.body.replace(/\n\n/g, '\n') });
  assert.deepEqual(L.acq11Conferir(colado, jev(BOM), ritual).motivos, ['sem_espacamento']);
  const comTravessao = Object.assign({}, texto, { body: texto.body.replace('contatos de', 'contatos \u2014 de') });
  assert.deepEqual(L.acq11Conferir(comTravessao, jev(BOM), ritual).motivos, ['travessao']);
  assert.match(L.acq11Aviso(alvo, ritual, 'conferencia', ['sem_negrito']).detalhe.porque, /negrito/);
});

test('número e data são conferidos por busca exata; a frase com número fora sai; rascunho não enviado não serve de prova', () => {
  const ev = L.acq11Evidencia(texto, alvo);
  assert.deepEqual(L.acq11NumerosFora(texto.body, ev), []);
  assert.deepEqual(L.acq11NumerosFora('De 04 a 10/11, foram 5 contatos.', ev), []);
  assert.deepEqual(L.acq11NumerosFora('De 03 a 10/11, foram 5 contatos.', ev), ['03']);
  const outro = Object.assign({}, texto, { body: texto.body.replace('Está em andamento.', 'Está em andamento. Sai em 12/11, com 15 peças.') });
  const c = L.acq11Conferir(outro, jev(BOM), ritual);
  assert.equal(c.ok, true);
  assert.deepEqual(c.cortes.map((x) => x.motivo), ['número ou data fora das fontes']);
  assert.doesNotMatch(c.corpo, /12\/11|15 peças/);
  assert.match(c.corpo, /Está em andamento\./);
  const comRascunho = Object.assign({}, texto, { fontes: { estado_real: texto.fontes.estado_real, dia_prioritario: '',
    continuidade: ['JÁ DITO:', '- 10/11 17:22 · Meio da semana (quarta) · rascunho não enviado · "x"', '  texto: A arte ficou pronta em 12/11.',
      '- 09/11 10:21 · Rota da semana (segunda) · ENVIADO · "y"', '  texto: Foram 4 contatos.', '', 'PROMESSAS'].join(String.fromCharCode(10)) } });
  const h = L.acq11Evidencia(comRascunho, alvo).historico_das_mensagens;
  assert.doesNotMatch(h, /12\/11/);
  assert.match(h, /4 contatos/);
  assert.match(h, /PROMESSAS/);
});

test('reparo: promessa e bastidor saem pela nota da frase; o lado negativo dos números sai; corte demais segura', () => {
  const porFrase = (extra) => { const r = jev(BOM); for (let i = 0; i < 12; i++) { r.answers['p' + i] = { type: 'noul', noul: 0.05 }; r.answers['b' + i] = { type: 'noul', noul: 0.05 }; } Object.assign(r.answers, extra); return r; };
  // promessa localizada na frase 3: ela sai e a nota geral alta não segura o resto
  const p = L.acq11Conferir(texto, porFrase({ p3: { type: 'noul', noul: 0.9 }, promessa: { type: 'noul', noul: 0.95 } }), ritual);
  assert.equal(p.ok, true);
  assert.deepEqual(p.cortes.map((x) => x.motivo), ['promessa de resultado']);
  // nota geral que só oscila perto do limite, sem frase culpada, não segura mais
  assert.equal(L.acq11Conferir(texto, porFrase({ interno: { type: 'noul', noul: 0.47 } }), ritual).ok, true);
  // nota geral forte sem frase localizada continua segurando
  assert.deepEqual(L.acq11Conferir(texto, porFrase({ interno: { type: 'noul', noul: 0.85 } }), ritual).motivos, ['termo_de_bastidor']);
  // número que zerou ou caiu não vai ao cliente
  assert.equal(L.acq11SoPositivo('Chegaram 4 contatos, contra 9 de 31/10 a 06/11.'), 'Chegaram 4 contatos.');
  assert.equal(L.acq11SoPositivo('Chegaram 8 contatos, contra 4 de 31/10 a 06/11.'), 'Chegaram 8 contatos, contra 4 de 31/10 a 06/11.');
  assert.equal(L.acq11SoPositivo('Oi, time.' + String.fromCharCode(10, 10) + '*Anúncios*' + String.fromCharCode(10) + 'Os anúncios geraram 0 contatos, igual a 0 antes.' + String.fromCharCode(10, 10) + 'Fim.'), 'Oi, time.' + String.fromCharCode(10, 10) + 'Fim.');
  // se quase tudo for cortado, o que sobra não tem formato e a mensagem fica para o dono
  const tudo = L.acq11Conferir(texto, porFrase({ f2: { type: 'choice', choice: 'nao_fala', probabilities: { apoia: 0.1 } }, f3: { type: 'choice', choice: 'nao_fala', probabilities: { apoia: 0.1 } } }), ritual);
  assert.equal(tudo.ok, false);
  assert.ok(tudo.motivos.includes('sem_negrito'));
});

test('id do rascunho: o painel devolve em record', () => {
  assert.equal(L.acq11IdDoRascunho({ record: { id: 'r1' } }), 'r1');
  assert.equal(L.acq11IdDoRascunho({ report: { id: 'r2' } }), 'r2');
  assert.equal(L.acq11IdDoRascunho({ id: 'r3' }), 'r3');
  assert.equal(L.acq11IdDoRascunho({}), null);
});

test('saudação fala com o time, sem o nome da pessoa', () => {
  assert.equal(L.acq11Saudacao('Bom dia, Priscila. Meio da semana por aqui.'), 'Bom dia, time. Meio da semana por aqui.');
  assert.equal(L.acq11Saudacao('Boa tarde, Priscila e equipe! Tudo certo.'), 'Boa tarde, time! Tudo certo.');
  assert.equal(L.acq11Saudacao('Bom dia. Semana começando.'), 'Bom dia, time. Semana começando.');
  assert.equal(L.acq11Saudacao('Os anúncios trouxeram 5 contatos.'), 'Os anúncios trouxeram 5 contatos.');
  const lido = L.acq11LerTexto({ ok: true, resultado: { ok: true, title: 't', body: 'Bom dia, Priscila. Os anúncios trouxeram 5 contatos.', next_steps: 'x' } });
  assert.match(lido.body, /^Bom dia, time\. /);
});

test('valor investido nos anúncios não sai sozinho; preço de produto pode', () => {
  assert.equal(L.acq11TextoProibido('De 05/11 a 11/11, foram 7 contatos com R$ 75 investidos, contra 0 contatos e R$ 0 de 29/10 a 04/11. Tudo certo por aqui nesta semana.'), 'valor_investido');
  assert.equal(L.acq11TextoProibido('Os anúncios trouxeram 7 contatos, com custo por contato de R$ 10 nesta semana, e a campanha de serviços segue ativa para a loja.'), 'valor_investido');
  assert.equal(L.acq11TextoProibido('A verba da semana foi de R$ 105 e os anúncios trouxeram 7 contatos para a loja, com novas conversas sobre serviços.'), 'valor_investido');
  assert.equal(L.acq11TextoProibido('De 05/11 a 11/11, os anúncios trouxeram 7 contatos, contra nenhum na semana anterior. A arte do mouse por R$ 9,90 está pronta para aprovação.'), null);
});
