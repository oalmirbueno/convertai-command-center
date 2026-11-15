// ACQ-13: radar de anúncios. node --test test/radar.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { carregarLib } from './_lib.mjs';
const L = carregarLib('nucleo', 'adaptador', 'wf13');

const AGORA = Date.parse('2026-11-11T17:43:00Z'); // quarta, 14h43 em São Paulo
const HOJE = '2026-11-11';
const cfg = { operador: 'default', radar_anuncios: { ativo: true, tetos_semanais: {}, clientes_fora: [] } };
let seq = 0;
const conta = (o) => Object.assign({ conta: 'Conta', status: 1, pre_pago: true, saldo: 200 }, o);
const camp = (o) => Object.assign({ campaign_id: 'c' + (++seq), nome: 'Campanha | Direct | Contínua', efetivo: 'ACTIVE', objetivo: 'OUTCOME_ENGAGEMENT',
  inicio: '2026-10-01T12:00:00+00:00', fim: null, g_hoje: 5, g3: 30, r3: 3, g7: 70, r7: 7, g7ant: 70, r7ant: 7, imp7: 5000, imp7ant: 4000, clk7: 50, clk7ant: 40, g30: 300, r30: 30, g_semana: 30, ultimo_gasto: HOJE, g_sem_resultado: 0 }, o);
const cliente = (o) => Object.assign({ client_id: '11111111-1111-4111-8111-111111111111', cliente: 'Cliente Teste', trafego: true, interno: false, teto_diario: null, campanhas: [camp({})], contas: [conta({})], anuncios_com_problema: [] }, o);
const fatos = (clientes, extra) => Object.assign({ hoje: HOJE, coleta: { diario_em: '2026-11-11T16:53:00Z' }, token: { ativos: 1, salvo_em: '2026-11-11T15:48:00Z' }, clientes }, extra || {});
const tipos = (a) => a.map((x) => x.tipo + ':' + x.nivel);
const rodar = (clientes, extra, c) => L.acq13Alertas(fatos(clientes, extra), c || cfg, AGORA);

test('carteira saudável não gera alerta', () => {
  assert.deepEqual(rodar([cliente({})]), []);
});

test('fim do período no nome: intervalo conta, data solta não', () => {
  assert.equal(L.acq13FimNoNome('VERZELO | Árvore perto do telhado | Direct | 07–14 OUT | R88 mídia total', HOJE), '2026-10-14');
  assert.equal(L.acq13FimNoNome('[VERZELO] Mensagens | 30 SET – 07 OUT | Cópia', HOJE), '2026-10-07');
  assert.equal(L.acq13FimNoNome('STOP | Serviços | WhatsApp | Ciclo 05-12nov26 | R15dia', HOJE), '2026-11-12');
  assert.equal(L.acq13FimNoNome('STOP | Saldo ciclo 30set-07out | WhatsApp', HOJE), '2026-10-07');
  assert.equal(L.acq13FimNoNome('MLF | IG DIRECT | FERIADO | 03-10 SET 2026', HOJE), '2026-09-10');
  assert.equal(L.acq13FimNoNome('Promo | 20-27 dez', '2026-01-05'), '2025-12-27');
  assert.equal(L.acq13FimNoNome('SOFTY | WhatsApp | Contínua | R$12 dia | 29OUT2026', HOJE), null);
  assert.equal(L.acq13FimNoNome('MLF | QUARTO 01 | CONTINUA | R5,20 DIA | 08 OUT 2026', HOJE), null);
  assert.equal(L.acq13FimNoNome('RD AR | Direct | 2 ofertas | 30-09-2026', HOJE), null);
  assert.equal(L.acq13FimNoNome('CASA | Direct Recorrente | Sab-Dom | R$40/dia', HOJE), null);
});

test('nome com período vencido e campanha gastando vira atenção; ciclo ainda dentro do prazo não', () => {
  const a = rodar([cliente({ campanhas: [camp({ nome: 'X | Direct | 07–14 OUT | R88', fim: '2026-11-18T02:59:00+00:00', g3: 2.43 }), camp({ nome: 'STOP | WhatsApp | Ciclo 05-12nov26' })] })]);
  assert.deepEqual(tipos(a), ['periodo_vencido:atencao']);
  assert.match(a[0].texto, /até 14\/10/); assert.match(a[0].texto, /R\$ 2,43/); assert.match(a[0].texto, /17\/11/);
});

test('campanha vencida: gastando é crítico; parada vira uma linha de limpeza por cliente', () => {
  const a = rodar([cliente({ campanhas: [camp({}), camp({ fim: '2026-11-01T03:00:00+00:00', g3: 12, g_hoje: 0 }),
    camp({ fim: '2026-09-10T03:00:00+00:00', g3: 0, g_hoje: 0, g7: 0, ultimo_gasto: null }), camp({ fim: '2026-08-17T03:00:00+00:00', g3: 0, g_hoje: 0, g7: 0, ultimo_gasto: null }),
    camp({ g3: 0, g_hoje: 0, g7: 0, ultimo_gasto: '2026-08-30' })] })]);
  assert.deepEqual(tipos(a), ['vencida_gastando:critico', 'limpeza:info']);
  assert.match(a[1].texto, /^3 campanhas paradas/);
});

test('saldo pré-pago: menos de 1 dia é crítico, menos de 3 é atenção, pós-pago não entra', () => {
  const thaina = cliente({ contas: [conta({ saldo: 8.38 })], campanhas: [camp({ g7: 108.7, g3: 38.5 })] });
  const stop = cliente({ client_id: '22222222-2222-4222-8222-222222222222', cliente: 'Stop', contas: [conta({ saldo: 27.51 })], campanhas: [camp({ g7: 73.67, g3: 47.42 })] });
  const cartao = cliente({ client_id: '33333333-3333-4333-8333-333333333333', cliente: 'Cartão', contas: [conta({ pre_pago: false, saldo: null })] });
  const a = rodar([thaina, stop, cartao]);
  assert.deepEqual(tipos(a), ['saldo_curto:critico', 'saldo_curto:atencao']);
  assert.match(a[0].texto, /menos de 1 dia/); assert.match(a[1].texto, /cerca de 1,7 dias/);
});

test('conta parada na Meta é crítico e não repete como contrato sem campanha', () => {
  const a = rodar([cliente({ contas: [conta({ status: 3, pre_pago: false, saldo: null })], campanhas: [camp({ g_hoje: 0, g3: 0, g7: 0, r7: 0, ultimo_gasto: '2026-10-29' })] })]);
  assert.deepEqual(tipos(a), ['conta_parada:critico']);
  assert.match(a[0].texto, /pagamento em aberto/); assert.match(a[0].texto, /29\/10/);
});

test('tráfego contratado sem nada rodando: um aviso com o motivo; interno e quem não contratou ficam de fora', () => {
  const parado = { g_hoje: 0, g3: 0, g7: 0, r7: 0, g_semana: 0 };
  const semSaldo = cliente({ contas: [conta({ saldo: 0 })], campanhas: [camp(Object.assign({ ultimo_gasto: '2026-10-27' }, parado))] });
  const semConta = cliente({ client_id: '22222222-2222-4222-8222-222222222222', cliente: 'Sem conta', contas: [], campanhas: [] });
  const interno = cliente({ client_id: '33333333-3333-4333-8333-333333333333', cliente: 'Interno', interno: true, contas: [], campanhas: [] });
  const semContrato = cliente({ client_id: '44444444-4444-4444-8444-444444444444', cliente: 'Só social', trafego: false, campanhas: [camp(Object.assign({ ultimo_gasto: '2026-09-01' }, parado))] });
  const a = rodar([semSaldo, semConta, interno, semContrato]);
  assert.deepEqual(a.filter((x) => x.nivel !== 'info').map((x) => x.cliente + '|' + x.tipo), ['Cliente Teste|contrato_sem_campanha', 'Sem conta|contrato_sem_campanha']);
  assert.match(a[0].texto, /sem saldo/); assert.match(a[0].texto, /27\/10/);
  assert.match(a[1].texto, /nenhuma conta de anúncios conectada/);
  assert.equal(L.acq13Alertas(fatos([semSaldo]), { radar_anuncios: { ativo: true, clientes_fora: [semSaldo.client_id] } }, AGORA).length, 0);
});

test('teto semanal: do combinado ou da Rotina do painel; sem teto a regra não roda', () => {
  const c = cliente({ teto_diario: 12, campanhas: [camp({ g7: 95, g_semana: 40 })] });
  assert.deepEqual(tipos(rodar([c])), ['teto_semanal:atencao']);
  assert.deepEqual(tipos(rodar([cliente({ teto_diario: 12, campanhas: [camp({ g7: 80, g_semana: 90 })] })])), ['teto_semanal:critico']);
  assert.deepEqual(tipos(rodar([cliente({ contas: [conta({ saldo: 5000 })], campanhas: [camp({ g7: 500, g3: 210, g_semana: 300, r7: 50, g30: 2000, r30: 200 })] })])), []);
  const comCombinado = { radar_anuncios: { ativo: true, tetos_semanais: { [c.client_id]: 60 } } };
  assert.deepEqual(tipos(rodar([cliente({ campanhas: [camp({ g7: 70, g_semana: 30 })] })], null, comCombinado)), ['teto_semanal:atencao']);
  assert.deepEqual(L.acq13SemTeto(fatos([cliente({})]), cfg), ['Cliente Teste']);
});

test('custo fora do normal e gasto sem resultado usam os limites do boletim mínimo do painel', () => {
  const caro = cliente({ campanhas: [camp({ g7: 100, r7: 2, g30: 300, r30: 30 })] });
  assert.deepEqual(tipos(rodar([caro])), ['custo_alto:atencao']);
  const seco = cliente({ campanhas: [camp({ g_sem_resultado: 62.5 })] });
  assert.deepEqual(tipos(rodar([seco])), ['gasto_sem_resultado:critico']);
  const reconhecimento = cliente({ campanhas: [camp({ nome: 'PEB | RECONHECIMENTO | SOMENTE IG', objetivo: 'OUTCOME_AWARENESS', r7: 0, r30: 0, g_sem_resultado: 103.55 })] });
  assert.deepEqual(tipos(rodar([reconhecimento])), []);
});

test('anúncio com problema, campanha que parou há pouco e campanha terminando', () => {
  const a = rodar([cliente({ anuncios_com_problema: [{ ad_id: 'a1', anuncio: 'VERZELO | Poda | Arte 1', estado: 'WITH_ISSUES' }],
    campanhas: [camp({}), camp({ campaign_id: 'parou', g_hoje: 0, g3: 0, ultimo_gasto: '2026-11-06' }), camp({ campaign_id: 'fim', fim: '2026-11-12T20:00:00+00:00' })] })]);
  assert.deepEqual(tipos(a), ['anuncio_com_problema:atencao', 'sem_entrega:atencao', 'terminando:info']);
  assert.match(a[1].texto, /desde 06\/11/);
});

test('vigia: coleta parada e acesso da Meta', () => {
  assert.deepEqual(tipos(rodar([], { coleta: { diario_em: '2026-11-11T13:00:00Z' } })), ['coleta_parada:critico']);
  assert.deepEqual(tipos(rodar([], { token: { ativos: 0, salvo_em: null } })), ['token_meta:critico']);
  assert.deepEqual(tipos(rodar([], { token: { ativos: 1, salvo_em: '2026-09-20T12:00:00Z' } })), ['token_meta:atencao']);
  assert.deepEqual(tipos(rodar([], { token: { ativos: 1, salvo_em: '2026-09-14T12:00:00Z' } })), ['token_meta:critico']);
});

test('boletim: diz o que mudou; dia sem novidade e sem crítico fica em silêncio; segunda sempre sai', () => {
  const f = fatos([cliente({ contas: [conta({ saldo: 27.51 })], campanhas: [camp({ g7: 73.67, g3: 47.42 })] })]);
  const al = L.acq13Alertas(f, cfg, AGORA);
  const novo = L.acq13Boletim(f, al, { novos: al, continuam: [], resolvidos: [] }, cfg, AGORA);
  assert.equal(novo.gravar, true);
  assert.equal(novo.argumentos.periodo, 'radar');
  assert.match(novo.argumentos.resumo, /1 de atenção em 1 cliente/); assert.match(novo.argumentos.resumo, /1 novo/);
  assert.match(novo.argumentos.alertas[0].texto, /^Novo\. Cliente Teste: Saldo de R\$ 27,51/);
  assert.deepEqual(Object.keys(novo.argumentos.alertas[0]).sort(), ['client_id', 'nivel', 'texto']);
  assert.match(novo.argumentos.texto_completo, /Sem teto semanal combinado/);
  assert.ok(!/[–—]/.test(novo.argumentos.texto_completo + novo.argumentos.resumo));
  const continua = al.map((a) => Object.assign({ desde: '2026-11-10T11:30:00Z' }, a));
  const igual = L.acq13Boletim(f, al, { novos: [], continuam: continua, resolvidos: [] }, cfg, AGORA);
  assert.deepEqual(igual, { gravar: false, motivo: 'nada mudou e nenhum crítico aberto' });
  const segunda = L.acq13Boletim(f, al, { novos: [], continuam: continua, resolvidos: [], semana: { abertos: 4, resolvidos: 3, em_aberto: 2, mais_antigos: [] } }, cfg, Date.parse('2026-11-16T11:30:00Z'));
  assert.equal(segunda.gravar, true);
  assert.match(segunda.argumentos.resumo, /Semana: 4 abertos, 3 resolvidos, 2 em aberto/);
  assert.match(segunda.argumentos.alertas[0].texto, /aberto desde 10\/11/);
  const resolveu = L.acq13Boletim(f, [], { novos: [], continuam: [], resolvidos: al }, cfg, AGORA);
  assert.equal(resolveu.gravar, true); assert.match(resolveu.argumentos.resumo, /nada fora do normal/); assert.match(resolveu.argumentos.resumo, /1 resolvido/);
});

test('bloco do cliente: só o lado favorável, sem valor investido, com os números usados', () => {
  const b = L.acq13BlocoDoCliente(cliente({ campanhas: [camp({ g7: 108.7, r7: 17, r7ant: 10, imp7: 8241, imp7ant: 2249, g3: 38.5 })] }), HOJE);
  assert.match(b.texto, /^\*Anúncios\*\n17 contatos novos chegaram pelos anúncios de 04\/11 a 10\/11, contra 10 na semana anterior\./);
  assert.match(b.texto, /8\.241 vezes, acima das 2\.249/);
  assert.ok(!/R\$/.test(b.texto));
  const caiu = L.acq13BlocoDoCliente(cliente({ campanhas: [camp({ r7: 6, r7ant: 15, imp7: 1791, imp7ant: 2128 })] }), HOJE);
  assert.ok(!/contra|acima/.test(caiu.texto));
  assert.equal(L.acq13BlocoDoCliente(cliente({ campanhas: [camp({ g7: 0, g3: 0, g_hoje: 0 })] }), HOJE), null);
});
