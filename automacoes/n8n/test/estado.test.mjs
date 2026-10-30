// Estado persistente (migrations/20261014120000_acq_n8n_estado.sql) num Postgres real.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { subirPostgres } from './_pg.mjs';
import { carregarLib } from './_lib.mjs';

const L = carregarLib('nucleo');
let P;
const MIRANTE = 'eb1270a5-4d9e-4c67-bb17-e25fa12ada34';
const OUTRO = '11111111-1111-4111-8111-111111111111';
const q = async (sql, params, c) => (await (c || P.admin).query(sql, params)).rows;
const um = async (sql, params, c) => (await q(sql, params, c))[0];

before(async () => { P = await subirPostgres(); });
after(async () => { if (P) await P.parar(); });

function evento(extra = {}) {
  return L.acqEvento(Object.assign({
    workflow_id: 'ACQ-01', run_id: 'r1', client_id: MIRANTE, entity_type: 'ritual', entity_id: 'meio_semana:2026-10-12',
    occurred_at: '2026-10-14T11:30:00.000Z', source: 'teste', idempotency_key: 'ACQ-01|ritual|' + MIRANTE + '|2026-10-12|meio_semana',
    payload: { a: 1 },
  }, extra));
}

test('evento: replay não duplica e sobrevive a outra conexão (reinício)', async () => {
  const ev = evento();
  const r1 = (await um('select acq_n8n.registrar_evento($1, $2) r', [ev, 'test'])).r;
  assert.equal(r1.novo, true);
  const outra = await P.novoCliente();
  const r2 = (await um('select acq_n8n.registrar_evento($1, $2) r', [ev, 'test'], outra)).r;
  assert.equal(r2.novo, false);
  assert.equal(r2.conflito, false);
  const n = await um('select count(*)::int n from acq_n8n.eventos');
  assert.equal(n.n, 1);
});

test('evento: mesma chave com payload diferente é conflito e não sobrescreve', async () => {
  const ev = evento({ payload: { a: 2 } });
  const r = (await um('select acq_n8n.registrar_evento($1, $2) r', [ev, 'test'])).r;
  assert.equal(r.novo, false);
  assert.equal(r.conflito, true);
  const linha = await um('select payload from acq_n8n.eventos');
  assert.deepEqual(linha.payload, { a: 1 });
});

test('evento: 20 execuções concorrentes do mesmo evento gravam uma vez', async () => {
  const ev = evento({ idempotency_key: 'ACQ-03|pub|concorrente-0001', entity_id: 'pub-x' });
  const conns = await Promise.all(Array.from({ length: 20 }, () => P.novoCliente()));
  const rs = await Promise.all(conns.map((c) => um('select acq_n8n.registrar_evento($1, $2) r', [ev, 'test'], c)));
  assert.equal(rs.filter((x) => x.r.novo).length, 1);
  const n = await um("select count(*)::int n from acq_n8n.eventos where idempotency_key = 'ACQ-03|pub|concorrente-0001'");
  assert.equal(n.n, 1);
});

test('cursor: compare-and-set deixa só uma execução avançar', async () => {
  const c0 = (await um("select acq_n8n.cursor_ler('ACQ-03','publicacoes') r")).r;
  assert.equal(c0.existe, false);
  const ini = (await um("select acq_n8n.cursor_avancar('ACQ-03','publicacoes',0,$1) r", [{ desde: '2026-10-14T00:00:00Z' }])).r;
  assert.equal(ini.avancou, true);
  const [a, b] = await Promise.all([P.novoCliente(), P.novoCliente()]);
  const rs = await Promise.all([a, b].map((c, i) => um("select acq_n8n.cursor_avancar('ACQ-03','publicacoes',1,$1) r", [{ desde: 'x' + i }], c)));
  assert.equal(rs.filter((x) => x.r.avancou).length, 1);
});

test('observação: sem mudança não gera novidade; mudança gera', async () => {
  const o = (h) => um("select acq_n8n.observar('ACQ-05',$1,'pauta',$2,$3) r", [MIRANTE, h, { h }]).then((x) => x.r);
  assert.equal((await o('h1')).mudou, true);
  assert.equal((await o('h1')).mudou, false);
  const m = await o('h2');
  assert.equal(m.mudou, true);
  assert.deepEqual(m.anterior, { h: 'h1' });
});

test('incidente: repetido não renotifica; resolvido e repetido reabre e notifica', async () => {
  const reg = (sev) => um("select acq_n8n.incidente_registrar('ACQ-05|hermes|indisponivel','ACQ-05',null,$1,'Hermes indisponível','{}') r", [sev]).then((x) => x.r);
  assert.equal((await reg('alto')).notificar, true);
  const rep = await reg('alto');
  assert.equal(rep.notificar, false);
  assert.equal(rep.ocorrencias, 2);
  assert.equal((await reg('critico')).notificar, true, 'subir severidade notifica');
  await q("select acq_n8n.incidente_resolver('ACQ-05|hermes|indisponivel','voltou')");
  const re = await reg('alto');
  assert.equal(re.reaberto, true);
  assert.equal(re.notificar, true);
});

function saida(i, extra = {}) {
  const payload = { mensagem: 'Texto aprovado ' + i, proximo_passo: 'x' };
  return Object.assign({
    idempotency_key: 'test:central:' + L.acqUuidDe('ap' + i) + ':' + L.acqHashDe(payload),
    origem: 'central_review', ambiente: 'test', approval_id: L.acqUuidDe('ap' + i), report_id: L.acqUuidDe('rp' + i),
    client_id: MIRANTE, payload_version: 1, payload_hash: L.acqHashDe(payload), payload,
    destino_rotulo: 'Mirante Luz Floripa - MKT - Aceleriq', valid_until: '2099-01-01T00:00:00Z',
  }, extra);
}

test('saída: enfileirar é idempotente e o payload fica congelado', async () => {
  const s = saida(1);
  const a = (await um('select acq_n8n.saida_enfileirar($1) r', [s])).r;
  const b = (await um('select acq_n8n.saida_enfileirar($1) r', [s])).r;
  assert.equal(a.novo, true);
  assert.equal(b.novo, false);
  await assert.rejects(q("update acq_n8n.saidas set payload = '{\"mensagem\":\"alterada\"}' where id = $1", [a.id]), /ACQ_SAIDA_CONGELADA/);
});

test('saída: claim respeita o ambiente (piloto não pega saída de teste)', async () => {
  await q('select acq_n8n.saida_enfileirar($1)', [saida(99, { ambiente: 'pilot', idempotency_key: 'pilot:central:x:' + 'a'.repeat(64) })]);
  const r = await q("select id from acq_n8n.saida_reivindicar('run-pilot', 60, 10, 'production')");
  assert.equal(r.length, 0);
  const p = await q("select id, ambiente from acq_n8n.saida_reivindicar('run-pilot', 60, 10, 'pilot')");
  assert.equal(p.length, 1); assert.equal(p[0].ambiente, 'pilot');
  await q("update acq_n8n.saidas set estado = 'bloqueada' where id = $1", [p[0].id]);
});

test('saída: 12 consumidores concorrentes reivindicam cada mensagem uma única vez', async () => {
  for (let i = 10; i < 18; i++) await q('select acq_n8n.saida_enfileirar($1)', [saida(i)]);
  const pendentes = (await um("select count(*)::int n from acq_n8n.saidas where estado = 'pendente'")).n;
  const conns = await Promise.all(Array.from({ length: 12 }, () => P.novoCliente()));
  const lotes = await Promise.all(conns.map((c, i) => q("select id from acq_n8n.saida_reivindicar($1, 60, 2, 'test')", ['run-' + i], c)));
  const ids = lotes.flat().map((r) => r.id);
  assert.equal(ids.length, pendentes, 'todas reivindicadas');
  assert.equal(new Set(ids).size, ids.length, 'nenhuma reivindicada duas vezes');
});

test('saída: lease vencida volta ao jogo só antes do envio; enviando vencido vira incerto', async () => {
  await q("update acq_n8n.saidas set lease_ate = now() - interval '1 second' where estado = 'reivindicada'");
  const re = await q("select id from acq_n8n.saida_reivindicar('run-novo', 60, 100, 'test')");
  assert.ok(re.length > 0);
  const alvo = re[0].id;
  const ini = (await um("select acq_n8n.saida_iniciar_envio($1,'run-novo',null,'teste') r", [alvo])).r;
  assert.equal(ini.pode_enviar, true);
  // dono errado não envia
  const outro = re[1].id;
  assert.equal((await um("select acq_n8n.saida_iniciar_envio($1,'intruso',null,'teste') r", [outro])).r.pode_enviar, false);
  await q("update acq_n8n.saidas set lease_ate = now() - interval '1 second' where id = $1", [alvo]);
  const nada = await q("select id from acq_n8n.saida_reivindicar('run-3', 60, 100, 'test')");
  assert.ok(!nada.some((r) => r.id === alvo), 'envio iniciado nunca é reivindicado de novo');
  const exp = (await um('select acq_n8n.saida_expirar_envios() r')).r;
  assert.ok(exp.incertos >= 1);
  assert.equal((await um('select estado from acq_n8n.saidas where id=$1', [alvo])).estado, 'envio_incerto');
  await assert.rejects(q("select acq_n8n.saida_conciliar_incerta($1, true, 'wamid.X', '')", [alvo]), /ACQ_EVIDENCIA_OBRIGATORIA/);
  const conc = (await um("select acq_n8n.saida_conciliar_incerta($1, true, 'wamid.CONC1', 'provedor confirmou no painel do provedor') r", [alvo])).r;
  assert.equal(conc.conciliado, true);
});

test('saída: aceite exige id do provedor; falha do painel retoma só o registro', async () => {
  await q('select acq_n8n.saida_enfileirar($1)', [saida(30)]);
  const [s] = await q("select id from acq_n8n.saida_reivindicar('run-a', 60, 1, 'test')");
  await q("select acq_n8n.saida_iniciar_envio($1,'run-a',null,'teste')", [s.id]);
  await assert.rejects(q("select acq_n8n.saida_resultado_transporte($1,'run-a','aceita',null,null)", [s.id]), /ACQ_ACEITE_SEM_ID/);
  const ok = (await um("select acq_n8n.saida_resultado_transporte($1,'run-a','aceita','wamid.30',null) r", [s.id])).r;
  assert.equal(ok.estado, 'aceita');
  // repetir o resultado não grava de novo
  assert.equal((await um("select acq_n8n.saida_resultado_transporte($1,'run-a','aceita','wamid.30',null) r", [s.id])).r.gravado, false);
  assert.equal((await um("select acq_n8n.saida_registro_painel($1,false,'HTTP 503') r", [s.id])).r.gravado, true);
  const pend = await q('select id from acq_n8n.saidas where estado in (\'aceita\',\'entregue\',\'lida\') and painel_registrado_em is null');
  assert.ok(pend.some((r) => r.id === s.id), 'continua pendente de registro, sem novo envio');
  assert.equal((await um('select acq_n8n.saida_registro_painel($1,true,null) r', [s.id])).r.gravado, true);
  assert.equal((await um('select acq_n8n.saida_registro_painel($1,true,null) r', [s.id])).r.gravado, false, 'registro não duplica');
  const linha = await um('select tentativas, painel_tentativas from acq_n8n.saidas where id=$1', [s.id]);
  assert.equal(linha.tentativas, 1, 'uma única tentativa de transporte');
});

test('recibos: duplicados não contam; fora de ordem não regridem', async () => {
  await q('select acq_n8n.saida_enfileirar($1)', [saida(40)]);
  const [s] = await q("select id from acq_n8n.saida_reivindicar('run-r', 60, 1, 'test')");
  await q("select acq_n8n.saida_iniciar_envio($1,'run-r',null,'teste')", [s.id]);
  await q("select acq_n8n.saida_resultado_transporte($1,'run-r','aceita','wamid.40',null)", [s.id]);
  const lida = (await um("select acq_n8n.recibo_registrar('teste','wamid.40','lida','2026-10-14T12:05:00Z','{}') r")).r;
  assert.equal(lida.estado, 'lida');
  const dup = (await um("select acq_n8n.recibo_registrar('teste','wamid.40','lida','2026-10-14T12:05:00Z','{}') r")).r;
  assert.equal(dup.duplicado, true);
  const atrasado = (await um("select acq_n8n.recibo_registrar('teste','wamid.40','entregue','2026-10-14T12:01:00Z','{}') r")).r;
  assert.equal(atrasado.estado, 'lida', 'entregue atrasado não volta o estado');
  const linha = await um('select estado, entregue_em, lida_em from acq_n8n.saidas where id=$1', [s.id]);
  assert.equal(linha.estado, 'lida');
  assert.ok(linha.entregue_em && linha.lida_em, 'aceito, entregue e lido ficam distintos');
  const orfao = (await um("select acq_n8n.recibo_registrar('teste','wamid.desconhecido','entregue',now(),'{}') r")).r;
  assert.equal(orfao.orfao, true);
});

test('mensagens: dedupe, bot descartado, grupo sem vínculo e remetente desconhecido vão para revisão', async () => {
  await q("insert into acq_n8n.grupos_cliente (provedor,group_id,client_id,rotulo,leitura_liberada,aprovado_por,aprovado_em) values ('teste','g-mirante',$1,'Mirante',true,'almir',now())", [MIRANTE]);
  await q("insert into acq_n8n.grupos_cliente (provedor,group_id,client_id,rotulo,leitura_liberada,aprovado_por,aprovado_em) values ('teste','g-outro',$1,'Outro',true,'almir',now()) on conflict do nothing", [OUTRO]);
  await q("insert into acq_n8n.remetentes (provedor,remetente,client_id,papel,nome) values ('teste','5548000000001',$1,'cliente_decisor','Simone')", [MIRANTE]);
  await q("insert into acq_n8n.remetentes (provedor,remetente,client_id,papel,nome) values ('teste','bot-aceleriq',null,'bot','Bot')");
  const msg = (id, extra = {}) => Object.assign({ provedor: 'teste', provider_message_id: id, group_id: 'g-mirante', remetente: '5548000000001', occurred_at: '2026-10-14T12:00:00Z', tipo: 'texto', texto: 'oi' }, extra);
  const reg = (m) => um('select acq_n8n.mensagem_registrar($1) r', [m]).then((x) => x.r);
  const a = await reg(msg('m1'));
  assert.equal(a.novo, true); assert.equal(a.client_id, MIRANTE); assert.equal(a.papel, 'cliente_decisor'); assert.equal(a.estado, 'recebida');
  assert.equal((await reg(msg('m1'))).novo, false);
  const bot = await reg(msg('m2', { remetente: 'bot-aceleriq' }));
  assert.equal(bot.estado, 'descartada');
  const semGrupo = await reg(msg('m3', { group_id: 'g-nao-mapeado' }));
  assert.equal(semGrupo.client_id, null); assert.equal(semGrupo.estado, 'em_revisao');
  const estranho = await reg(msg('m4', { remetente: '5500000000000' }));
  assert.equal(estranho.estado, 'em_revisao'); assert.equal(estranho.motivo, 'remetente_desconhecido');
  // remetente da Mirante escrevendo no grupo de outro cliente não ganha papel lá
  const cruzado = await reg(msg('m5', { group_id: 'g-outro' }));
  assert.equal(cruzado.client_id, OUTRO); assert.equal(cruzado.papel, null); assert.equal(cruzado.estado, 'em_revisao');
});

test('fatos: evento atrasado não sobrescreve fato mais recente', async () => {
  const f = (v, t) => um("select acq_n8n.fato_propor($1,'fotos_cafe_entregues',$2,$3,null) r", [MIRANTE, JSON.stringify(v), t]).then((x) => x.r);
  assert.equal((await f({ valor: 'sim' }, '2026-10-07T20:00:00Z')).aplicado, true);
  const atrasado = await f({ valor: 'ainda nao' }, '2026-10-05T13:00:00Z');
  assert.equal(atrasado.aplicado, false);
  assert.equal(atrasado.motivo, 'fato_mais_recente_existente');
  assert.equal((await um("select valor from acq_n8n.fatos_cliente where chave='fotos_cafe_entregues'")).valor.valor, 'sim');
});

test('propostas: replay não duplica; nova versão da mesma referência substitui a aberta', async () => {
  const p = (k, h) => ({ workflow_id: 'ACQ-01', client_id: MIRANTE, tipo: 'ritual', referencia: 'meio_semana:2026-10-12', idempotency_key: k, base_versao: 132, conteudo: { h }, hash: h, ambiente: 'test' });
  const a = (await um('select acq_n8n.proposta_registrar($1) r', [p('k-000001', 'h1')])).r;
  assert.equal(a.novo, true);
  assert.equal((await um('select acq_n8n.proposta_registrar($1) r', [p('k-000001', 'h1')])).r.novo, false);
  const b = (await um('select acq_n8n.proposta_registrar($1) r', [p('k-000002', 'h2')])).r;
  assert.equal(b.novo, true);
  assert.equal((await um('select estado from acq_n8n.propostas where id=$1', [a.id])).estado, 'substituida');
});

test('papel do n8n não pode apagar histórico', async () => {
  const r = await um("select has_table_privilege('acq_n8n_worker','acq_n8n.saidas','DELETE') d, has_table_privilege('acq_n8n_worker','acq_n8n.saidas','UPDATE') u");
  assert.equal(r.d, false);
  assert.equal(r.u, true);
});
