// ACQ-15: relatório semanal de anúncios para o cliente. node --test test/relatorio-anuncios.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { carregarLib } from './_lib.mjs';
const L = carregarLib('nucleo', 'adaptador', 'wf01', 'wf11', 'wf13', 'wf15');

const CID = 'bad69252-05ad-4b80-ab76-4a0e9fd3c314';
const cfg = { relatorio_anuncios: { ativo: true, clientes_fora: [], clientes_ensaio: [CID] }, post_no_ar: { llm_url: 'https://x/llm', llm_modelo: 'm', grupos: { [CID]: 'SKC - MKT', outro: 'Outro - MKT' } } };
const AGORA = Date.parse('2026-11-10T11:40:00Z'); // terça, 08h40 em São Paulo
const alvo = (o) => Object.assign({ client_id: CID, grupo: 'SKC - MKT', cliente: 'SKC', ativo: true, ja_escrito: false, project_id: 'p1', semana_inicio: '2026-11-02', semana_fim: '2026-11-08', hoje: '2026-11-10',
  numeros: { contatos: 10, contatos_ant: 2, apareceu: 8622, apareceu_ant: 929, cliques: 95, cliques_ant: 7, gasto: 61.84, campanhas_no_ar: 1 },
  acoes: [{ dia: '09/11', tipo: 'outro', o_que: 'Mexeu em o conjunto de age 18-65 para age 25-65, FB/IG feed+stories+reels.', por_que: 'Andreus reclamou de curiosos.' }], anteriores: [] }, o);
const llm = (j) => ({ choices: [{ message: { content: JSON.stringify(j) } }] });
const RED = { fizemos: 'Ajustamos o público para 25 a 65 anos e escolhemos onde o anúncio aparece, para reduzir os curiosos.', proximo: 'A campanha para consultórios já está montada, pronta para ligar.' };
const jev = (apoia, n) => ({ answers: Object.assign(Object.fromEntries(['promessa', 'interno', 'repete'].map((k) => [k, { type: 'noul', noul: (n || {})[k] ?? 0.1 }])),
  Object.fromEntries(Array.from({ length: 12 }, (_, i) => ['f' + i, { type: 'choice', choice: 'apoia', probabilities: { apoia, contradiz: 0, nao_fala: 1 - apoia } }]))) });

test('clientes vêm dos grupos liberados; ensaio restringe', () => {
  assert.equal(L.acq15Clientes(cfg, null).length, 2);
  assert.deepEqual(L.acq15Clientes(cfg, [CID]), [{ client_id: CID, grupo: 'SKC - MKT' }]);
  assert.equal(L.acq15Config({}).ativo, false);
});

test('números: só o lado favorável; comparação só quando melhora; nunca valor investido', () => {
  assert.deepEqual(L.acq15Numeros(alvo({})), ['10 contatos novos chegaram pelos anúncios, contra 2 na semana anterior.', 'Os anúncios apareceram 8.622 vezes, acima das 929 da semana anterior.', '1 campanha segue no ar.']);
  const caiu = L.acq15Numeros(alvo({ numeros: { contatos: 11, contatos_ant: 13, apareceu: 6729, apareceu_ant: 7000, cliques: 65, cliques_ant: 58, gasto: 91.89, campanhas_no_ar: 1 } }));
  assert.deepEqual(caiu, ['11 contatos novos chegaram pelos anúncios.', 'Os anúncios apareceram 6.729 vezes.', '1 campanha segue no ar.']);
  const semContato = L.acq15Numeros(alvo({ numeros: { contatos: 0, contatos_ant: 0, apareceu: 2033, apareceu_ant: 0, cliques: 12, cliques_ant: 5, gasto: 9, campanhas_no_ar: 1 } }));
  assert.match(semContato.join(' '), /12 pessoas clicaram para saber mais, contra 5 na semana anterior/);
  assert.ok(!/R\$/.test(L.acq15Numeros(alvo({})).join(' ')));
});

test('triagem: inativo, já escrito, sem projeto, sem anúncio na semana ficam de fora', () => {
  const t = L.acq15Triagem([alvo({}), alvo({ ativo: false }), alvo({ ja_escrito: true }), alvo({ project_id: null }),
    alvo({ numeros: { contatos: 0, apareceu: 0, cliques: 0, gasto: 0, campanhas_no_ar: 0 } }), alvo({ numeros: { contatos: 0, apareceu: 0, cliques: 0, gasto: 5, campanhas_no_ar: 1 } })]);
  assert.equal(t.escrever.length, 1);
  assert.deepEqual(t.fora.map((f) => f.motivo), ['cliente_inativo', 'ja_escrito', 'sem_projeto', 'sem_anuncio_na_semana', 'sem_numero_favoravel']);
});

test('redação: pede JSON estrito, recusa valor em reais, troca travessão; sem ação não chama o modelo', () => {
  const p = L.acq15PedidoRedacao(alvo({}), cfg);
  assert.equal(p.model, 'm'); assert.equal(p.response_format.json_schema.strict, true);
  assert.match(p.messages[0].content, /Nunca cite valor em reais/);
  assert.deepEqual(L.acq15LerRedacao(llm(RED), alvo({})), Object.assign({ ok: true }, RED));
  assert.equal(L.acq15LerRedacao(llm({ fizemos: 'Baixamos a verba para R$ 11 por dia.', proximo: '' }), alvo({})).motivo, 'valor_em_reais');
  assert.equal(L.acq15LerRedacao(llm({ fizemos: 'Ajustamos o público — 25 a 65 anos.', proximo: '' }), alvo({})).fizemos, 'Ajustamos o público, 25 a 65 anos.');
  assert.equal(L.acq15LerRedacao({ error: { message: 'x' } }, alvo({})).motivo, 'modelo_indisponivel');
  assert.deepEqual(L.acq15LerRedacao(null, alvo({ acoes: [] })), { ok: true, fizemos: '', proximo: '' });
});

test('mensagem: saudação ao time, blocos com título em negrito, datas da semana, dentro do tamanho', () => {
  const t = L.acq15Montar(alvo({}), RED, AGORA);
  assert.equal(t.body, ['Bom dia, time.', '*Anúncios de 02/11 a 08/11*\n10 contatos novos chegaram pelos anúncios, contra 2 na semana anterior. Os anúncios apareceram 8.622 vezes, acima das 929 da semana anterior. 1 campanha segue no ar.',
    '*O que fizemos*\n' + RED.fizemos, '*Próximo passo*\n' + RED.proximo, 'Para conferir o restante, está tudo no painel: https://aceleriq.online/onde-estamos'].join('\n\n'));
  assert.equal(L.acq11Formato(t.body), null);
  assert.equal(L.acq11TextoProibido(t.body), null);
  assert.deepEqual(L.acq11NumerosFora(t.body, L.acq11Evidencia(t, null)), []);
  assert.ok(t.body.length <= 1200);
});

test('conferência: passa com apoio alto; segura número fora da fonte, frase sem apoio e relatório sem ação', () => {
  const t = L.acq15Montar(alvo({}), RED, AGORA);
  const ok = L.acq15Conferir(t, jev(0.9), '2026-11-02');
  assert.equal(ok.ok, true, JSON.stringify(ok.motivos));
  assert.deepEqual(L.acq15Conferir(t, jev(0.3), '2026-11-02').motivos, ['fato_sem_apoio_nas_fontes']);
  const inventou = L.acq15Montar(alvo({}), { fizemos: 'Ajustamos o raio para 14 km em volta da loja.', proximo: '' }, AGORA);
  assert.ok(L.acq15Conferir(inventou, jev(0.9), '2026-11-02').motivos.includes('numero_ou_data_fora_das_fontes'));
  const semAcao = L.acq15Montar(alvo({ acoes: [] }), { fizemos: '', proximo: '' }, AGORA);
  assert.deepEqual(L.acq15Conferir(semAcao, jev(0.9), '2026-11-02').motivos, ['sem_acao_concreta']);
  assert.ok(L.acq15Conferir(t, null, '2026-11-02').motivos.includes('sem_conferencia'));
});

test('rascunho e aviso: marca da semana, autor, um aviso por rodada', () => {
  const t = L.acq15Montar(alvo({}), RED, AGORA);
  const r = L.acq15Rascunho(alvo({}), t, { ok: true }, '2026-11-02');
  assert.equal(r.metrics.written_by, 'n8n:ACQ-15'); assert.equal(r.metrics.semana, '2026-11-02'); assert.ok(!('ritual_type' in r.metrics));
  assert.equal(r.title, 'Relatório de anúncios 02/11 a 08/11 | SKC');
  const a = L.acq15Aviso([{ ok: true, cliente: 'SKC' }, { ok: false, cliente: 'Thainá', motivos: ['sem_acao_concreta'] }], '2026-11-02');
  assert.equal(a.titulo, 'Relatório de anúncios: 1 prévia pronta e 1 segurada na Central');
  assert.equal(a.detalhe.seguradas[0].porque, 'não há ação da equipe registrada para contar');
});
