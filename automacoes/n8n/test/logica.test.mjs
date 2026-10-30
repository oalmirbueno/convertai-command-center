// Lógica pura dos workflows (o mesmo código que vai nos nós Code).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { carregarLib, lerJson } from './_lib.mjs';
import { criarMundo, IDS } from '../fixtures/mundo-teste.mjs';

const L = carregarLib('nucleo', 'adaptador', 'wf01', 'wf02', 'wf03', 'wf04', 'wf05');
const AMB = lerJson('config/ambientes.json');
const CONTRATO = lerJson('contratos/ferramentas.json');
const AGORA = Date.parse('2026-10-14T14:10:00Z'); // quarta, 11h10 em São Paulo
const cfg = (n) => L.acqConfigEfetiva(n, AMB);
const ped = (wf, ferramenta, argumentos, extra = {}) => Object.assign({ workflow_id: wf, run_id: 'r', ferramenta, argumentos }, extra);

// ------------------------------------------------------------------ núcleo
test('sha256 e hmac puros batem com o crypto do Node', () => {
  for (const s of ['', 'abc', 'Ação ✓ 🚀', 'x'.repeat(1000)]) {
    assert.equal(L.acqSha256(s), crypto.createHash('sha256').update(s, 'utf8').digest('hex'));
    assert.equal(L.acqHmacSha256('segredo-teste', s), crypto.createHmac('sha256', 'segredo-teste').update(s, 'utf8').digest('hex'));
  }
});

test('fuso de São Paulo (UTC-3 fixo) confere com Intl e semana começa na segunda', () => {
  assert.equal(L.acqConferirFuso(AGORA), true);
  const sp = L.acqAgoraSP(AGORA);
  assert.equal(sp.data, '2026-10-14'); assert.equal(sp.hora, 11); assert.equal(sp.dia_semana, 3);
  assert.equal(L.acqSegundaDaSemana('2026-10-18'), '2026-10-12');
  assert.equal(L.acqConferirFuso(Date.parse('2026-01-15T02:30:00Z')), true, 'verão de 2026 continua UTC-3');
});

test('evento: contrato mínimo completo, id derivado da chave, hash do payload estável', () => {
  const a = L.acqEvento({ workflow_id: 'ACQ-01', run_id: 'r1', client_id: IDS.mirante, entity_type: 'ritual', entity_id: 'x', occurred_at: '2026-10-14T00:00:00Z', source: 's', idempotency_key: 'chave-123456', payload: { b: 1, a: 2 } });
  const b = L.acqEvento({ workflow_id: 'ACQ-01', run_id: 'r2', client_id: IDS.mirante, entity_type: 'ritual', entity_id: 'x', occurred_at: '2026-10-14T00:00:00Z', source: 's', idempotency_key: 'chave-123456', payload: { a: 2, b: 1 } });
  assert.deepEqual(L.acqValidarEvento(a), []);
  assert.equal(a.event_id, b.event_id);
  assert.equal(a.payload_hash, b.payload_hash);
  assert.throws(() => L.acqEvento({ workflow_id: 'ACQ-01' }), /incompleto/);
  assert.throws(() => L.acqEvento({ workflow_id: 'A', run_id: 'r', client_id: 'nao-uuid', entity_type: 'e', entity_id: 'i', occurred_at: 'x', source: 's', idempotency_key: 'k-12345678' }), /client_id/);
});

// ------------------------------------------------------------------ adaptador
test('dry-run: o piloto nunca escreve, mesmo se alguém mudar dry_run para false', () => {
  const alterado = JSON.parse(JSON.stringify(AMB));
  alterado.ambientes.pilot.dry_run = false;
  alterado.ambientes.pilot.escritas_liberadas = ['aceleriq_create_report_draft'];
  const c = L.acqConfigEfetiva('pilot', alterado);
  assert.equal(c.dry_run, true);
  const r = L.acqProtegerChamada(ped('ACQ-01', 'aceleriq_create_report_draft', { project_id: 'p', title: 't', idempotency_key: 'k-12345678', client_id: undefined }, { client_id_escopo: IDS.mirante }), c, CONTRATO);
  assert.equal(r.decisao, 'simular');
  assert.equal(r.rpc, null, 'nenhum corpo JSON-RPC é montado para escrita simulada');
});

test('produção: escrita só com dry_run=false E ferramenta liberada', () => {
  const p = JSON.parse(JSON.stringify(AMB));
  const c1 = L.acqConfigEfetiva('production', p);
  const pedidoEscrita = ped('ACQ-02', 'aceleriq_central_review_marcar_enviado', { operator: 'default', approval_id: 'x', evidence: 'e', idempotency_key: 'k-12345678' });
  assert.equal(L.acqProtegerChamada(pedidoEscrita, c1, CONTRATO).decisao, 'simular');
  p.ambientes.production.dry_run = false;
  assert.equal(L.acqProtegerChamada(pedidoEscrita, L.acqConfigEfetiva('production', p), CONTRATO).decisao, 'simular', 'falta liberar a ferramenta');
  p.ambientes.production.escritas_liberadas = ['aceleriq_central_review_marcar_enviado'];
  assert.equal(L.acqProtegerChamada(pedidoEscrita, L.acqConfigEfetiva('production', p), CONTRATO).decisao, 'escrever');
});

test('allowlist, ferramenta proibida, escopo de cliente e idempotência', () => {
  const c = cfg('pilot');
  assert.equal(L.acqProtegerChamada(ped('ACQ-02', 'aceleriq_list_tasks', { client_id: IDS.mirante }), c, CONTRATO).motivo, 'ferramenta_fora_da_allowlist');
  assert.equal(L.acqProtegerChamada(ped('ACQ-01', 'aceleriq_get_agenda_status', { client_id: IDS.acerbi }), c, CONTRATO).motivo, 'cliente_fora_do_escopo');
  assert.equal(L.acqProtegerChamada(ped('ACQ-01', 'aceleriq_get_agenda_status', { client_id: IDS.mirante }), c, CONTRATO).decisao, 'ler');
  assert.equal(L.acqProtegerChamada(ped('ACQ-01', 'aceleriq_central_review_fila', { operator: 'default' }), c, CONTRATO).decisao, 'ler', 'multi-cliente é filtrado depois');
  assert.equal(L.acqProtegerChamada(ped('ACQ-01', 'aceleriq_get_report', { report_id: 'r' }), c, CONTRATO).motivo, 'chamada_sem_cliente_fora_do_escopo');
  assert.equal(L.acqProtegerChamada(ped('ACQ-01', 'aceleriq_get_report', { report_id: 'r' }, { client_id_escopo: IDS.mirante }), c, CONTRATO).decisao, 'ler');
  const t = cfg('test');
  assert.equal(L.acqProtegerChamada(ped('ACQ-01', 'aceleriq_create_report_draft', { project_id: 'p', title: 't' }, { client_id_escopo: IDS.mirante }), t, CONTRATO).motivo, 'escrita_sem_idempotency_key');
  const contratoComDecidir = JSON.parse(JSON.stringify(CONTRATO)); contratoComDecidir.por_workflow['ACQ-02'].push('aceleriq_central_review_decidir');
  assert.equal(L.acqProtegerChamada(ped('ACQ-02', 'aceleriq_central_review_decidir', {}), t, contratoComDecidir).motivo, 'ferramenta_proibida', 'decidir nunca é automático');
  assert.equal(L.acqProtegerChamada(ped('ACQ-01', 'aceleriq_dia_prioritario', {}, { ambiente_chamador: 'production' }), c, CONTRATO).motivo, 'ambiente_divergente');
});

test('teste só fala com 127.0.0.1', () => {
  const a = JSON.parse(JSON.stringify(AMB)); a.ambientes.test.mcp_url = 'https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/mcp-server';
  assert.equal(L.acqProtegerChamada(ped('ACQ-01', 'aceleriq_dia_prioritario', {}), L.acqConfigEfetiva('test', a), CONTRATO).motivo, 'teste_fora_do_loopback');
});

test('resposta: HTTP 200 com error JSON-RPC ou isError é falha; tipos de erro', () => {
  const req = { ferramenta: 'f', tipo: 'leitura' };
  const r1 = L.acqInterpretarResposta(req, { statusCode: 200, body: { jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'boom' } } });
  assert.equal(r1.ok, false); assert.equal(r1.erro.tipo, 'desconhecido');
  const r2 = L.acqInterpretarResposta(req, { statusCode: 200, body: { jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: 'falha' }] } } });
  assert.equal(r2.ok, false); assert.equal(r2.erro.tipo, 'ferramenta');
  assert.equal(L.acqInterpretarResposta(req, { statusCode: 401, body: {} }).erro.tipo, 'autenticacao');
  assert.equal(L.acqInterpretarResposta(req, { statusCode: 200, body: { jsonrpc: '2.0', error: { code: -32003, message: 'forbidden' } } }).erro.tipo, 'escopo');
  assert.equal(L.acqInterpretarResposta(req, { error: { message: 'timeout of 30000ms exceeded' } }).erro.pode_repetir, true);
  assert.equal(L.acqInterpretarResposta({ ferramenta: 'f', tipo: 'escrita' }, { error: { message: 'timeout' } }).erro.pode_repetir, false, 'escrita não repete');
  assert.equal(L.acqInterpretarResposta(req, { statusCode: 200, body: { jsonrpc: '2.0', error: { code: -32603, message: 'write:conflict version_conflict: x' } } }).erro.tipo, 'conflito_versao');
  assert.equal(L.acqInterpretarResposta(req, { statusCode: 200, body: { jsonrpc: '2.0', result: { content: [] } } }).erro.tipo, 'payload_invalido');
  const ok = L.acqInterpretarResposta(req, { statusCode: 200, body: '  {"jsonrpc":"2.0","id":1,"result":{"structuredContent":{"a":1}}}' });
  assert.equal(ok.ok, true, 'aceita o espaço inicial do "fôlego" das ferramentas longas');
  assert.equal(L.acqInterpretarResposta(req, { statusCode: 200, body: { jsonrpc: '2.0', result: { structuredContent: { ok: false, status: 'versao_mudou' } } } }).erro.tipo, 'conflito_versao');
});

test('paginação: planeja todas as páginas e só marca completo se leu tudo', () => {
  const req = { ferramenta: 'aceleriq_list_tasks', argumentos: { client_id: IDS.mirante, limit: 25, offset: 0 }, run_id: 'r' };
  const primeira = { ok: true, resultado: { items: Array.from({ length: 25 }, (_, i) => ({ id: 't' + i })), total: 58, limit: 25, offset: 0, has_more: true, next_offset: 25 } };
  const plano = L.acqPlanejarPaginas(req, primeira, 20);
  assert.deepEqual(plano.map((p) => p.offset), [25, 50]);
  const pag = (o, n) => ({ ok: true, resultado: { items: Array.from({ length: n }, (_, i) => ({ id: 't' + (o + i) })) } });
  const j = L.acqJuntarPaginas(primeira, [pag(25, 25), pag(50, 8)]);
  assert.equal(j.ok, true); assert.equal(j.resultado.items.length, 58);
  const incompleto = L.acqJuntarPaginas(primeira, [pag(25, 25), { ok: false, erro: { tipo: 'transitorio' } }]);
  assert.equal(incompleto.ok, false); assert.equal(incompleto.erro.tipo, 'paginacao_incompleta');
  assert.equal(L.acqPlanejarPaginas(req, primeira, 2).length, 1, 'teto de páginas respeitado');
});

test('isolamento: dado de outro cliente no resultado é detectado', () => {
  assert.equal(L.acqConferirCliente({ items: [{ client_id: IDS.mirante }] }, IDS.mirante), true);
  assert.equal(L.acqConferirCliente({ items: [{ client_id: IDS.mirante }, { client_id: IDS.outro }] }, IDS.mirante), false);
  const fila = criarMundo(AGORA).fila;
  assert.equal(L.acqFiltrarEscopo(fila.esperando_decisao, cfg('pilot')).length, 1);
});

// ------------------------------------------------------------------ ACQ-01
function leiturasMirante(m) {
  const cid = IDS.mirante;
  const d = m.dossies[cid];
  const prep = { client_id: cid, nome: 'Mirante', situacao: 'confirmado', tarefas_abertas: 58,
    atrasadas: m.tarefas[cid].filter((t) => t.due_date < '2026-10-14').slice(0, 8).map((t) => ({ titulo: t.title, prazo: t.due_date, status: t.status })),
    ultimos_registros: [], ultimo_ritual: { titulo: 'Semana fecha com anúncios em alta', quando: '2026-10-09T20:57:31Z' } };
  return {
    dossie: { current: { ...d, client_id: cid }, current_version: d.version },
    decisoes: { items: m.memoria[cid].filter((x) => x.kind === 'decisao') },
    rituais: { items: [] },
    agenda: { ...m.agenda[cid], days: 14, diagnosis: 'x' },
    relatorios: { items: m.relatorios[cid].map(({ metrics, ...r }) => r) },
    dia: { preparacao: [prep] },
    fila: m.fila,
  };
}
const ritualQuarta = () => L.acq01RitualDaRodada(AGORA, null);

test('ACQ-01: ritual do dia e elegibilidade (Para Si fora, Stop provisório marcado, piloto só Mirante)', () => {
  assert.equal(ritualQuarta().tipo, 'meio_semana');
  assert.equal(ritualQuarta().semana, '2026-10-12');
  assert.equal(L.acq01RitualDaRodada(Date.parse('2026-10-13T14:00:00Z'), null).erro, 'sem_ritual_neste_dia');
  const m = criarMundo(AGORA);
  const dia = { distribuicao: [2, 3].map((dd) => ({ dia: dd, clientes: Object.entries(m.clientes).filter(([, c]) => c.dia === dd).map(([id, c]) => ({ client_id: id, nome: c.nome, situacao: c.situacao })) })),
    sem_dia_por_nao_se_aplicar: [{ client_id: IDS.paraSi, nome: 'Para Si' }] };
  const piloto = L.acq01Elegiveis(dia, cfg('pilot'), null);
  assert.deepEqual(piloto.elegiveis.map((c) => c.client_id), [IDS.mirante]);
  const t = L.acq01Elegiveis(dia, cfg('test'), null);
  assert.ok(t.elegiveis.length <= 2, 'lote de até dois');
  const stop = L.acq01Elegiveis(dia, cfg('test'), IDS.stop);
  assert.equal(stop.elegiveis[0].provisorio, true);
  assert.equal(L.acq01Elegiveis(dia, cfg('test'), IDS.paraSi).recusados[0].motivo, 'nao_aplicavel');
});

test('ACQ-01: resposta já conhecida não vira pergunta; resposta ambígua continua lacuna', () => {
  const m = criarMundo(AGORA);
  const L1 = leiturasMirante(m);
  const det = m.relatorios[IDS.mirante];
  const a = L.acq01Analisar({ cliente: { client_id: IDS.mirante, nome: 'Mirante' }, ritual: ritualQuarta(), leituras: L1, detalhes: det, agoraMs: AGORA, cfg: cfg('pilot') });
  assert.equal(a.estado, 'propor');
  // "As pautas prontas sem data já foram aprovadas...?" foi respondida "ainda não" → não pergunta de novo
  assert.ok(a.respondidas.some((r) => r.lacuna === 'agenda_prontas_sem_data'));
  assert.ok(!a.perguntas.some((p) => p.chave === 'agenda_prontas_sem_data'));
  assert.ok(a.perguntas.length <= 2);
  // pergunta composta respondida com "sim" é ambígua
  const amb = a.respostas_humanas.filter((r) => /imagens reais/.test(r.objeto))[0];
  assert.equal(amb.ambigua, true);
  // proveniência separada e nada "confirmado pelo dono"
  assert.ok(a.fatos.every((f) => f.tipo === 'fato' && f.fonte.ferramenta));
  assert.ok(a.interpretacoes.every((i) => i.tipo === 'interpretacao_automatica'));
  assert.match(a.proposta_contexto.secao, /NÃO confirmada pelo dono/);
  assert.doesNotMatch(a.proposta_contexto.secao, /Confirmado pelo dono/);
  assert.equal(a.rascunho_ritual.metrics.gerado_por, 'automacao');
  assert.equal(a.pedido_revisao.channel, 'portal');
  assert.equal(a.pedido_revisao.recipient, IDS.mirante);
});

test('ACQ-01: replay produz a mesma identidade (mesmo hash de fatos)', () => {
  const m = criarMundo(AGORA);
  const args = { cliente: { client_id: IDS.mirante, nome: 'Mirante' }, ritual: ritualQuarta(), leituras: leiturasMirante(m), detalhes: m.relatorios[IDS.mirante], agoraMs: AGORA, cfg: cfg('pilot') };
  const a = L.acq01Analisar(args), b = L.acq01Analisar(JSON.parse(JSON.stringify(args)));
  assert.equal(a.hash_fatos, b.hash_fatos);
  assert.equal(L.acq01PedidosDeEscrita(a, 'r1')[0].argumentos.idempotency_key, L.acq01PedidosDeEscrita(b, 'r2')[0].argumentos.idempotency_key);
});

test('ACQ-01: fonte ausente não propõe nada', () => {
  const m = criarMundo(AGORA);
  const L1 = leiturasMirante(m); delete L1.agenda;
  const a = L.acq01Analisar({ cliente: { client_id: IDS.mirante, nome: 'Mirante' }, ritual: ritualQuarta(), leituras: L1, detalhes: [], agoraMs: AGORA, cfg: cfg('pilot') });
  assert.equal(a.estado, 'fonte_ausente');
  assert.equal(a.proposta_contexto, undefined);
  assert.ok(a.lacunas.some((l) => l.chave === 'fonte_agenda'));
});

test('ACQ-01: ritual já publicado ou rascunho existente não gera rascunho novo', () => {
  const m = criarMundo(AGORA);
  const det = m.relatorios[IDS.mirante].concat([{ id: 'r-pub-hoje', status: 'published', created_at: '2026-10-14T12:00:00Z', metrics: { ritual_type: 'meio_semana', sent_channel: 'portal' } }]);
  const a = L.acq01Analisar({ cliente: { client_id: IDS.mirante, nome: 'M' }, ritual: ritualQuarta(), leituras: leiturasMirante(m), detalhes: det, agoraMs: AGORA, cfg: cfg('pilot') });
  assert.equal(a.estado, 'ja_publicado');
  assert.equal(a.rascunho_ritual, undefined);
  const det2 = m.relatorios[IDS.mirante].concat([{ id: 'r-rasc-hoje', status: 'draft', created_at: '2026-10-14T12:00:00Z', metrics: { ritual_type: 'meio_semana' } }]);
  const b = L.acq01Analisar({ cliente: { client_id: IDS.mirante, nome: 'M' }, ritual: ritualQuarta(), leituras: leiturasMirante(m), detalhes: det2, agoraMs: AGORA, cfg: cfg('pilot') });
  assert.equal(b.estado, 'rascunho_existente');
  assert.equal(b.rascunho_ritual, undefined, 'reaproveita o rascunho do painel');
  assert.equal(L.acq01PedidosDeEscrita(b, 'r').filter((x) => x.ferramenta === 'aceleriq_create_report_draft').length, 0);
});

test('ACQ-01: ritual enviado hoje com period_start da semana passada conta como já publicado (caso real Mirante 14/10)', () => {
  const m = criarMundo(AGORA);
  const det = m.relatorios[IDS.mirante].concat([{ id: 'e268e64a', status: 'published', created_at: '2026-10-14T18:25:01Z', period_start: '2026-10-07', metrics: { ritual_type: 'meio_semana', sent_channel: 'portal' } }]);
  const a = L.acq01Analisar({ cliente: { client_id: IDS.mirante, nome: 'M' }, ritual: ritualQuarta(), leituras: leiturasMirante(m), detalhes: det, agoraMs: AGORA, cfg: cfg('pilot') });
  assert.equal(a.estado, 'ja_publicado');
});

test('ACQ-01: no piloto as escritas viram simulação (não bloqueio de escopo)', () => {
  const m = criarMundo(AGORA);
  const a = L.acq01Analisar({ cliente: { client_id: IDS.mirante, nome: 'M' }, ritual: ritualQuarta(), leituras: leiturasMirante(m), detalhes: m.relatorios[IDS.mirante], agoraMs: AGORA, cfg: cfg('pilot') });
  const pedidos = L.acq01PedidosDeEscrita(a, 'r');
  assert.ok(pedidos.length >= 1);
  pedidos.forEach((p) => assert.equal(L.acqProtegerChamada(Object.assign({ workflow_id: 'ACQ-01', run_id: 'r' }, p), cfg('pilot'), CONTRATO).decisao, 'simular', p.ferramenta));
});

test('ACQ-01: reconciliação aponta rascunho histórico coberto e pedido vencido (sem agir)', () => {
  const m = criarMundo(AGORA);
  const rec = L.acq01Reconciliar(m.relatorios[IDS.mirante], m.fila, IDS.mirante, AGORA);
  assert.ok(rec.some((r) => r.tipo === 'pedido_vencido_ainda_pendente'));
  assert.ok(rec.some((r) => r.tipo === 'rascunho_historico_coberto' && r.report_id === 'r-draft-abertura'));
  assert.ok(!rec.some((r) => String(r.approval_id).endsWith('a099')), 'pedido de outro cliente não entra');
});

test('ACQ-01: dossiê perto de 60 mil caracteres bloqueia a escrita em vez de truncar', () => {
  const m = criarMundo(AGORA);
  m.dossies[IDS.mirante].content = 'x'.repeat(59800);
  const a = L.acq01Analisar({ cliente: { client_id: IDS.mirante, nome: 'M' }, ritual: ritualQuarta(), leituras: leiturasMirante(m), detalhes: m.relatorios[IDS.mirante], agoraMs: AGORA, cfg: cfg('pilot') });
  assert.equal(a.proposta_contexto.excede_limite_mcp, true);
  assert.equal(L.acq01PedidosDeEscrita(a, 'r').filter((x) => x.ferramenta === 'aceleriq_upsert_current_dossier').length, 0);
});

// ------------------------------------------------------------------ ACQ-02
function saidaBase(extra = {}) {
  return Object.assign({ id: 's1', approval_id: 'ap1', client_id: IDS.mirante, payload_version: 1, payload_hash: 'a'.repeat(64), payload: { mensagem: 'Oi' },
    destino_rotulo: 'Grupo Mirante', valid_until: '2026-10-20T00:00:00Z' }, extra);
}
const filaCom = (extra = {}) => ({ aprovados_para_enviar: [Object.assign({ approval_id: 'ap1', client_id: IDS.mirante, payload_version: 1, payload_hash: 'a'.repeat(64), mensagem: 'Oi', valid_until: '2026-10-20T00:00:00Z', destino: 'Grupo Mirante' }, extra)] });
const destinoTeste = [{ id: 'd1', client_id: IDS.mirante, rotulo: 'Grupo Mirante', canal: 'teste', provedor: 'teste', destino_tecnico: 'grupo-teste-1', ativo: true }];

test('ACQ-02: revalidação bloqueia vencida, payload alterado, destino desconhecido/ambíguo e portal', () => {
  const t = cfg('test');
  assert.equal(L.acq02Revalidar(saidaBase(), filaCom(), destinoTeste, t, AGORA).decisao, 'enviar');
  assert.equal(L.acq02Revalidar(saidaBase({ valid_until: '2026-10-01T00:00:00Z' }), filaCom({ valid_until: '2026-10-01T00:00:00Z' }), destinoTeste, t, AGORA).motivo, 'aprovacao_vencida');
  assert.equal(L.acq02Revalidar(saidaBase(), filaCom({ payload_hash: 'b'.repeat(64) }), destinoTeste, t, AGORA).decisao, 'invalidar');
  assert.equal(L.acq02Revalidar(saidaBase(), filaCom({ mensagem: 'Texto trocado' }), destinoTeste, t, AGORA).motivo, 'texto_mudou_depois_da_aprovacao');
  assert.equal(L.acq02Revalidar(saidaBase(), { aprovados_para_enviar: [] }, destinoTeste, t, AGORA).motivo, 'aprovacao_nao_esta_mais_aprovada_para_envio');
  assert.equal(L.acq02Revalidar(saidaBase({ destino_rotulo: 'Grupo mirante' }), filaCom(), destinoTeste, t, AGORA).motivo, 'destino_desconhecido', 'nome parecido não serve');
  assert.equal(L.acq02Revalidar(saidaBase(), filaCom(), destinoTeste.concat([{ ...destinoTeste[0], id: 'd2', destino_tecnico: 'outro' }]), t, AGORA).motivo, 'destino_ambiguo');
  assert.equal(L.acq02Revalidar(saidaBase({ destino_rotulo: IDS.mirante }), filaCom(), destinoTeste, t, AGORA).motivo, 'canal_portal_publica_no_painel_nao_por_transporte');
  assert.equal(L.acq02Revalidar(saidaBase(), filaCom(), destinoTeste, cfg('pilot'), AGORA).motivo, 'destino_de_teste_fora_do_teste');
  const real = [{ ...destinoTeste[0], canal: 'whatsapp_grupo', provedor: 'cloud_api' }];
  assert.equal(L.acq02Revalidar(saidaBase(), filaCom(), real, cfg('pilot'), AGORA).decisao, 'simular');
  assert.equal(L.acq02Revalidar(saidaBase(), filaCom(), real, t, AGORA).motivo, 'destino_real_em_ambiente_de_teste');
});

test('ACQ-02: resultado do transporte — aceite exige id; timeout/5xx é incerto; 4xx é recusa', () => {
  assert.deepEqual(L.acq02ClassificarTransporte({ statusCode: 200, body: { aceita: true, message_id: 'teste.1' } }), { resultado: 'aceita', provider_message_id: 'teste.1' });
  assert.equal(L.acq02ClassificarTransporte({ statusCode: 200, body: {} }).resultado, 'incerta');
  assert.equal(L.acq02ClassificarTransporte({ statusCode: 502, body: {} }).resultado, 'incerta');
  assert.equal(L.acq02ClassificarTransporte({ error: { message: 'timeout of 15000ms exceeded' } }).resultado, 'incerta');
  assert.equal(L.acq02ClassificarTransporte({ statusCode: 422, body: { aceita: false, erro: 'x' } }).resultado, 'rejeitada');
  assert.equal(L.acq02ClassificarTransporte({ statusCode: 401, body: {} }).auth, true);
});

test('ACQ-02: recibos fora da janela, sem id ou com status desconhecido são recusados', () => {
  const r = L.acq02NormalizarRecibos({ recibos: [
    { provider_message_id: 'a', status: 'delivered', timestamp: '2026-10-14T14:00:00Z' },
    { status: 'read', timestamp: '2026-10-14T14:00:00Z' },
    { provider_message_id: 'b', status: 'weird', timestamp: '2026-10-14T14:00:00Z' },
    { provider_message_id: 'c', status: 'read', timestamp: '2026-01-01T00:00:00Z' },
  ] }, AGORA, 'teste');
  assert.equal(r.validos.length, 1); assert.equal(r.validos[0].status, 'entregue'); assert.equal(r.invalidos.length, 3);
});

test('ACQ-02: enfileirar respeita escopo e congela payload pela chave da aprovação', () => {
  const fila = { aprovados_para_enviar: [{ approval_id: 'ap1', client_id: IDS.mirante, payload_version: 1, payload_hash: 'a'.repeat(64), mensagem: 'Oi', destino: 'G' },
    { approval_id: 'ap2', client_id: IDS.outro, payload_version: 1, payload_hash: 'b'.repeat(64), mensagem: 'X', destino: 'G2' }] };
  const e = L.acq02Enfileirar(fila, cfg('pilot'));
  assert.equal(e.saidas.length, 1); assert.equal(e.ignorados[0].motivo, 'fora_do_escopo_do_ambiente');
  assert.equal(e.saidas[0].idempotency_key, 'pilot:central:ap1:' + 'a'.repeat(64));
});

// ------------------------------------------------------------------ ACQ-03
test('ACQ-03: primeira ativação inicializa cursor sem anunciar histórico; replay não reanuncia', () => {
  const m = criarMundo(AGORA);
  const pubs = L.acq03Publicacoes(m.calendario[IDS.mirante], IDS.mirante);
  const ini = L.acq03Detectar(pubs, { existe: false }, [], AGORA);
  assert.equal(ini.inicializar, true); assert.equal(ini.novas.length, 0); assert.equal(ini.historico_ignorado, 1);
  const cursor = { existe: true, valor: { desde: new Date(AGORA - 7 * 86400000).toISOString() }, versao: 1 };
  const d1 = L.acq03Detectar(pubs, cursor, [], AGORA);
  assert.equal(d1.novas.length, 1);
  const d2 = L.acq03Detectar(pubs, cursor, [L.acq03ChaveEvento(pubs[0])], AGORA);
  assert.equal(d2.novas.length, 0, 'replay não reanuncia');
});

test('ACQ-03: agendada não dispara; conta errada e permalink de outra conta vão para revisão (Acerbi x CME)', () => {
  const m = criarMundo(AGORA);
  const pubs = L.acq03Publicacoes(m.calendario[IDS.acerbi], IDS.acerbi);
  const contas = L.acq03ContasPorProjeto(pubs);
  const cme = pubs.find((p) => p.publication_id === 'pub-cme-1');
  const acerbi = pubs.find((p) => p.publication_id === 'pub-acerbi-1');
  const agendada = pubs.find((p) => p.publication_id === 'pub-cme-agendada');
  assert.equal(L.acq03Validar(agendada, m.posts[IDS.acerbi], contas, AGORA).estado, 'ignorar');
  const vCme = L.acq03Validar(cme, m.posts[IDS.acerbi], contas, AGORA);
  assert.equal(vCme.estado, 'valida'); assert.equal(vCme.platform_media_id, '18133024294727437');
  const vAc = L.acq03Validar(acerbi, m.posts[IDS.acerbi], contas, AGORA);
  assert.equal(vAc.estado, 'revisao'); assert.equal(vAc.motivo, 'permalink_de_outra_conta');
  // projeto com duas contas IG ativas usadas → ambíguo
  const dup = JSON.parse(JSON.stringify(cme)); dup.publication_id = 'pub-cme-x'; dup.external_account_id = IDS.cmeIGDuplicada; dup.conta = { id: IDS.cmeIGDuplicada, platform: 'instagram', handle: 'cmeacerbi2025', status: 'active' };
  const contas2 = L.acq03ContasPorProjeto(pubs.concat([dup]));
  assert.match(L.acq03Validar(cme, m.posts[IDS.acerbi], contas2, AGORA).motivo, /mais_de_uma_conta/);
  const semLink = Object.assign({}, cme, { permalink: 'https://example.com/x' });
  assert.match(L.acq03Validar(semLink, m.posts[IDS.acerbi], contas, AGORA).motivo, /permalink_invalido/);
});

test('ACQ-03: captura inválida falha explicitamente; fixture fica marcada', () => {
  assert.equal(L.acq03ValidarCaptura({ url: 'https://www.instagram.com/accounts/login/', file_id: 'f' }, '@miranteluzfloripa').motivo, 'tela_de_login');
  assert.equal(L.acq03ValidarCaptura({ url: 'https://www.instagram.com/outroperfil/', file_id: 'f' }, '@miranteluzfloripa').motivo, 'perfil_errado');
  assert.equal(L.acq03ValidarCaptura({ erro: 'timeout de 90s' }, '@x').motivo, 'timeout');
  const ok = L.acq03ValidarCaptura({ url: 'https://www.instagram.com/miranteluzfloripa/', file_id: 'fx', fixture: true }, '@miranteluzfloripa');
  assert.equal(ok.ok, true); assert.equal(ok.fixture, true);
});

test('ACQ-03: sem métricas comparáveis não afirma crescimento; mensagem limpa o objetivo interno', () => {
  const m = criarMundo(AGORA);
  const p = L.acq03Publicacoes(m.calendario[IDS.mirante], IDS.mirante)[0];
  const v = L.acq03Validar(p, m.posts[IDS.mirante], L.acq03ContasPorProjeto([p]), AGORA);
  const cmp = L.acq03Comparacao(v.prova, m.posts[IDS.mirante], AGORA);
  const msg = L.acq03Mensagem(p, v, cmp);
  assert.equal(msg.afirma_crescimento, false, 'alcance 29 contra mediana maior não vira elogio');
  assert.doesNotMatch(msg.texto, /Arte do Est/);
  assert.match(msg.texto, /instagram\.com\/p\/DePGZpPFk6m/);
  assert.equal(L.acq03Comparacao(null, [], AGORA), null);
  assert.equal(L.acq03Comparacao({ media_id: 'x', posted_at: new Date(AGORA - 3600000).toISOString() }, [], AGORA).motivo, 'post_com_menos_de_48h');
});

test('ACQ-03: reconciliação diária só aponta exceções (agenda vazia, prontas, data perdida)', () => {
  const ex = L.acq03ExcecoesEditoriais(IDS.mirante, { scheduled: [], ready_without_date: [{ id: 'a' }] }, [{ publication_id: 'p1', status: 'scheduled', scheduled_at: new Date(AGORA - 5 * 3600000).toISOString() }], AGORA);
  assert.deepEqual(ex.map((e) => e.tipo).sort(), ['data_perdida', 'prontas_sem_data']);
});

// ------------------------------------------------------------------ ACQ-04
test('ACQ-04: normaliza formatos, recusa futuro e carimbo fora da janela', () => {
  const a = L.acq04Normalizar({ mensagem: { id: 'm1', grupo: 'g', de: '55', em: '2026-10-14T14:00:00Z', texto: 'oi' } }, 'teste', AGORA);
  assert.equal(a.mensagens.length, 1);
  const cloud = L.acq04Normalizar({ entry: [{ changes: [{ value: { messages: [{ id: 'wamid.1', from: '55', timestamp: String(Math.floor(AGORA / 1000)), type: 'audio', audio: { id: 'media-1' } }] } }] }] }, 'cloud', AGORA);
  assert.equal(cloud.mensagens[0].tipo, 'audio');
  assert.equal(L.acq04Normalizar({ mensagem: { id: 'm', de: '5', em: '2026-10-15T14:00:00Z' } }, 't', AGORA).erros[0], 'mensagem_no_futuro');
  assert.equal(L.acq04ConferirCarimbo(String(Math.floor((AGORA - 10 * 60000) / 1000)), AGORA).ok, false);
  assert.equal(L.acq04ConferirCarimbo(String(Math.floor(AGORA / 1000)), AGORA).ok, true);
});

test('ACQ-04: regras — bot, desconhecido, áudio ilegível, "pode fazer" sem objeto e tema sensível nunca aprovam', () => {
  const base = { client_id: IDS.mirante, papel: 'cliente_decisor', tipo: 'texto', transcricao_status: 'nao_aplicavel' };
  const j = (x) => Object.assign({ tipo: 'informacao', tipo_confianca: 0.9, responde: 'nenhuma', responde_confianca: 0.9, p_autoriza: 0.05, p_objeto_claro: 0.1, p_sensivel: 0.05 }, x);
  assert.equal(L.acq04Decidir({ ...base, papel: 'bot' }, j(), {}).destino, 'descartar');
  assert.equal(L.acq04Decidir({ ...base, papel: null }, j(), {}).motivos[0], 'remetente_desconhecido');
  assert.equal(L.acq04Decidir({ ...base, client_id: null }, j(), {}).motivos[0], 'grupo_sem_vinculo_aprovado');
  assert.equal(L.acq04Decidir({ ...base, tipo: 'audio', transcricao_status: 'ilegivel' }, j(), {}).destino, 'pendencia');
  const podeFazer = L.acq04Decidir(base, j({ tipo: 'decisao', p_autoriza: 0.95, p_objeto_claro: 0.2 }), {});
  assert.equal(podeFazer.destino, 'revisao'); assert.ok(podeFazer.motivos.includes('objeto_da_autorizacao_indefinido'));
  assert.equal(podeFazer.aprovacao_automatica, false);
  const verba = L.acq04Decidir({ ...base, papel: 'cliente_equipe' }, j({ tipo: 'decisao', p_autoriza: 0.9, p_objeto_claro: 0.9, p_sensivel: 0.9 }), {});
  assert.ok(verba.motivos.includes('autor_sem_papel_de_decisor')); assert.ok(verba.motivos.includes('tema_sensivel_dinheiro_campanha_publicacao'));
  assert.equal(L.acq04Decidir(base, j({ responde: 'q1', responde_confianca: 0.8, tipo: 'resposta' }), {}).destino, 'proposta_contexto');
  assert.equal(L.acq04Decidir(base, j({ tipo: 'pedido' }), {}).destino, 'handoff');
  assert.equal(L.acq04Decidir(base, null, {}).destino, 'revisao', 'sem classificação vai para pessoa');
});

test('ACQ-04: agrupa só mesmo remetente/grupo em 3 minutos e monta pedido Jev sem dados de outro cliente', () => {
  const m = { provider_message_id: 'm3', group_id: 'g', remetente: 'a', occurred_at: '2026-10-14T14:05:00Z', texto: 'c' };
  const tr = L.acq04Agrupar(m, [
    { provider_message_id: 'm1', group_id: 'g', remetente: 'a', occurred_at: '2026-10-14T14:03:00Z', texto: 'a' },
    { provider_message_id: 'm2', group_id: 'g', remetente: 'b', occurred_at: '2026-10-14T14:04:00Z', texto: 'b' },
    { provider_message_id: 'm0', group_id: 'g', remetente: 'a', occurred_at: '2026-10-14T13:50:00Z', texto: 'antiga' }]);
  assert.deepEqual(tr.map((x) => x.provider_message_id), ['m1', 'm3']);
  const pj = L.acq04PedidoJev(tr, { perguntas_abertas: [{ id: 'q1', pergunta: 'As pautas foram aprovadas?' }] });
  assert.equal(pj.model, 'jev-latest');
  assert.ok(pj.questions.responde.criteria.q1 && pj.questions.responde.criteria.nenhuma);
});

// ------------------------------------------------------------------ ACQ-05
test('ACQ-05: pauta com até três ações, números por código, responsável existente e sem contato presumido', () => {
  const m = criarMundo(AGORA);
  const tf = L.acq05Tarefas(m.tarefas[IDS.mirante], '2026-10-14'); tf.itens = m.tarefas[IDS.mirante];
  assert.equal(tf.abertas, 58); assert.equal(tf.atrasadas, 30);
  const p = L.acq05Pauta({ cliente: { client_id: IDS.mirante, nome: 'Mirante', prep: { ultimos_registros: [] } }, agenda: m.agenda[IDS.mirante], tarefas: tf, fila: m.fila, ads: null, hoje: '2026-10-14', agoraMs: AGORA });
  assert.ok(p.acoes.length <= 3 && p.acoes.length >= 2);
  assert.equal(p.acoes[0].chave, 'pedido_vencido');
  const agenda = p.acoes.find((a) => a.chave === 'agenda_prontas_sem_data');
  assert.equal(agenda.responsavel.origem, 'tarefa_existente');
  assert.ok(p.avisos.some((a) => /não há contato presumido/.test(a)));
  const stop = L.acq05Pauta({ cliente: { client_id: IDS.stop, nome: 'Stop', provisorio: true, prep: {} }, agenda: { scheduled: [{}], ready_without_date: [] }, tarefas: L.acq05Tarefas([], '2026-10-14'), fila: {}, hoje: '2026-10-14', agoraMs: AGORA });
  assert.ok(stop.avisos.some((a) => /provisório/.test(a)));
});

test('ACQ-05: sem mudança, mesmo hash (não renotifica); novidade muda o hash', () => {
  const m = criarMundo(AGORA);
  const mk = (ag) => { const tf = L.acq05Tarefas(m.tarefas[IDS.mirante], '2026-10-14'); tf.itens = m.tarefas[IDS.mirante];
    return L.acq05Pauta({ cliente: { client_id: IDS.mirante, nome: 'M', prep: {} }, agenda: ag, tarefas: tf, fila: m.fila, hoje: '2026-10-14', agoraMs: AGORA }); };
  assert.equal(mk(m.agenda[IDS.mirante]).hash, mk(JSON.parse(JSON.stringify(m.agenda[IDS.mirante]))).hash);
  assert.notEqual(mk(m.agenda[IDS.mirante]).hash, mk({ ...m.agenda[IDS.mirante], scheduled: [{ publication_id: 'x' }] }).hash);
});

test('ACQ-05: 17h reconcilia sem inferir contato', () => {
  const r = L.acq05Reconciliar({ acoes: [{ chave: 'agenda_vazia', titulo: 'A' }, { chave: 'tarefas_atrasadas', titulo: 'B' }] }, { acoes: [{ chave: 'tarefas_atrasadas', titulo: 'B' }] }, { ultimos_registros: [] }, '2026-10-14');
  assert.deepEqual(r.itens.map((i) => i.situacao), ['resolvido_no_painel', 'sem_mudanca']);
  assert.equal(r.contato.registrado, false);
});

test('ACQ-05: verificação técnica — Hermes sem sinal, quadro fora, pedidos vencidos e exceções editoriais', () => {
  const m = criarMundo(AGORA);
  const inc = L.acq05Tecnico(m.board, { esperando_decisao: m.fila.esperando_decisao.slice(0, 1), aprovados_para_enviar: [] }, [{ tipo: 'data_perdida', client_id: IDS.mirante, publication_id: 'p1' }], AGORA, cfg('pilot'));
  const keys = inc.map((i) => i.key);
  assert.ok(keys.includes('ACQ-05|hermes|agentes_sem_sinal'), 'último agente há 30h');
  assert.ok(keys.includes('ACQ-05|revisao|pedidos_vencidos_pendentes'));
  assert.ok(keys.some((k) => k.startsWith('ACQ-05|editorial|data_perdida')));
  assert.ok(L.acq05Tecnico(null, {}, [], AGORA, cfg('pilot')).some((i) => i.key === 'ACQ-05|quadro|indisponivel'));
  // Caso real de 14/10: Hermes Core parado desde 29/08, mas Augusto ativo há 2h → sem alerta.
  const comSinal = JSON.parse(JSON.stringify(m.board)); comSinal.operadores[1].ultima_execucao = new Date(AGORA - 2 * 3600000).toISOString();
  assert.ok(!L.acq05Tecnico(comSinal, {}, [], AGORA, cfg('pilot')).some((i) => i.key.includes('hermes')));
});

// ------------------------------------------------------------------ MCP 2.10.0 (15/10/2026)
test('texto do ritual: geração roda de verdade no piloto, uma tentativa só, e fica fora de quem não a lista', () => {
  const MIRANTE = 'eb1270a5-4d9e-4c67-bb17-e25fa12ada34';
  const r = L.acqProtegerChamada(ped('ACQ-01', 'aceleriq_ritual_redigir', { client_id: MIRANTE, ritual: 'meio_semana' }), cfg('pilot'), CONTRATO);
  assert.equal(r.tipo, 'geracao');
  assert.equal(r.decisao, 'escrever', 'via sem nova tentativa, mesmo no dry-run (não grava no painel)');
  const fora = L.acqProtegerChamada(ped('ACQ-01', 'aceleriq_ritual_redigir', { client_id: '39ebda82-637c-498b-a23a-b622f645e852', ritual: 'meio_semana' }), cfg('pilot'), CONTRATO);
  assert.equal(fora.decisao, 'bloquear'); assert.equal(fora.motivo, 'cliente_fora_do_escopo');
  const outro = L.acqProtegerChamada(ped('ACQ-03', 'aceleriq_ritual_redigir', { client_id: MIRANTE, ritual: 'meio_semana' }), cfg('pilot'), CONTRATO);
  assert.equal(outro.motivo, 'ferramenta_fora_da_allowlist');
  const erro = L.acqInterpretarResposta({ ferramenta: 'aceleriq_ritual_redigir', tipo: 'geracao' }, { statusCode: 504, body: 'gateway timeout' });
  assert.equal(erro.ok, false); assert.equal(erro.erro.pode_repetir, false, 'nunca paga o modelo duas vezes');
});

test('texto do ritual: só pede para proposta de ritual nova e aplica o texto sem inventar', () => {
  const a = { client_id: 'c1', ritual: { tipo: 'meio_semana' }, rascunho_ritual: { title: 'Regra', summary: 'por regra', next_steps: 'passo regra', metrics: { texto_final_pendente: 'aguardando aceleriq_ritual_redigir', ritual_type: 'meio_semana' } } };
  const props = [{ tipo: 'contexto' }, { tipo: 'ritual' }];
  assert.equal(L.acq01PedidoTextoFinal(a, props, [{ novo: true }, { novo: false }]), null, 'ritual repetido não paga de novo');
  const p = L.acq01PedidoTextoFinal(a, props, [{ novo: false }, { novo: true }]);
  assert.deepEqual(p, { ref: 'c1|texto', ferramenta: 'aceleriq_ritual_redigir', argumentos: { client_id: 'c1', ritual: 'meio_semana' } });
  assert.equal(L.acq01PedidoTextoFinal(Object.assign({}, a, { rascunho_ritual: null }), props, [{ novo: true }, { novo: true }]), null);

  const bom = L.acq01AplicarTextoFinal(a.rascunho_ritual, { ok: true, resultado: { ok: true, title: 'Meio da semana', body: 'Texto do escritor', next_steps: 'Aprovar as pautas', model: 'm', custo_usd: 0.01, alertas: [] } });
  assert.equal(bom.summary, 'Texto do escritor'); assert.equal(bom.title, 'Meio da semana'); assert.equal(bom.next_steps, 'Aprovar as pautas');
  assert.equal(bom.metrics.texto_final_pendente, undefined);
  assert.equal(bom.metrics.texto_final.confirmado_pelo_dono, false);
  assert.equal(bom.metrics.ritual_type, 'meio_semana', 'mantém as métricas do rascunho');
  assert.equal(a.rascunho_ritual.summary, 'por regra', 'não altera o original');

  const falhou = L.acq01AplicarTextoFinal(a.rascunho_ritual, { ok: false, erro: { tipo: 'transitorio' } });
  assert.equal(falhou.summary, 'por regra'); assert.match(falhou.metrics.texto_final_pendente, /falhou \(erro: transitorio\)/);
  const vazio = L.acq01AplicarTextoFinal(a.rascunho_ritual, { ok: true, resultado: { ok: false, motivo: 'O escritor não respondeu agora.' } });
  assert.equal(vazio.summary, 'por regra'); assert.match(vazio.metrics.texto_final_pendente, /não respondeu/);
});

test('aviso de post: pedido estável no portal, decisão nunca automática e estado pelo que o painel devolveu', () => {
  const MIRANTE = 'eb1270a5-4d9e-4c67-bb17-e25fa12ada34';
  const p = { publication_id: '11111111-2222-4333-8444-555555555555', client_id: MIRANTE, permalink: 'https://www.instagram.com/p/x/' };
  const x = L.acq03PedidoAviso(p, 'Post novo no ar: X.\nhttps://www.instagram.com/p/x/', 'default');
  assert.equal(x.ferramenta, 'aceleriq_aviso_publicacao_preparar'); assert.equal(x.argumentos.channel, 'portal'); assert.equal(x.client_id_escopo, MIRANTE);
  assert.equal(x.argumentos.idempotency_key, L.acq03PedidoAviso(p, 'outro texto', 'default').argumentos.idempotency_key, 'chave estável por post');
  const r = L.acqProtegerChamada(Object.assign(ped('ACQ-03', x.ferramenta, x.argumentos), { client_id_escopo: x.client_id_escopo }), cfg('pilot'), CONTRATO);
  assert.equal(r.decisao, 'simular', 'no piloto o aviso é simulado: nada entra no painel');
  const dec = L.acqProtegerChamada(ped('ACQ-03', 'aceleriq_aviso_publicacao_decidir', { aviso_id: 'x' }), cfg('pilot'), CONTRATO);
  assert.equal(dec.decisao, 'bloquear');

  assert.deepEqual(L.acq03EstadoDoAviso({ ok: true, simulado: true }), { estado: 'proposta', motivo: 'aviso_simulado_dry_run', aviso_id: null });
  assert.deepEqual(L.acq03EstadoDoAviso({ ok: true, resultado: { id: 'a1' } }), { estado: 'em_revisao', motivo: null, aviso_id: 'a1' });
  assert.equal(L.acq03EstadoDoAviso({ ok: false, erro: { tipo: 'ferramenta', mensagem: 'AVISO_JA_EXISTE: este post já tem o aviso' } }).estado, 'descartada');
  assert.equal(L.acq03EstadoDoAviso({ ok: false, erro: { tipo: 'transitorio', mensagem: 'x' } }).motivo, 'revisao_transitorio');
  assert.equal(L.acq03EstadoDoAviso(null).estado, 'bloqueada');
});

test('produção: a leitura automática do dossiê substitui a anterior, sem empilhar', () => {
  const sec = '## Leitura automática (n8n ACQ-01, proposta, NÃO confirmada pelo dono) | 13/10/2026\n\n- fato velho';
  const dossie = '# Contexto\n\nTexto do dono.\n\n' + sec + '\n\n## Avanços recentes (automático, 13/10/2026)\n- item';
  const limpo = L.acq01SemLeituraAutomatica(dossie);
  assert.equal(limpo.includes('fato velho'), false);
  assert.equal(limpo.includes('Texto do dono.'), true);
  assert.equal(limpo.includes('## Avanços recentes'), true);
  assert.equal(L.acq01SemLeituraAutomatica('sem seção\n\n\n\nnada'), 'sem seção\n\n\n\nnada', 'sem seção anterior, texto intacto');
  const cfgProd = L.acqConfigEfetiva('production', AMB);
  assert.equal(cfgProd.dry_run, false);
  assert.deepEqual([...cfgProd.escritas_liberadas].sort(), ['aceleriq_aviso_publicacao_preparar', 'aceleriq_central_review_preparar', 'aceleriq_create_report_draft', 'aceleriq_upsert_current_dossier']);
  const nav = L.acqProtegerChamada(ped('ACQ-03', 'aceleriq_browser_act', { client_id: 'eb1270a5-4d9e-4c67-bb17-e25fa12ada34', acao: 'capturar' }), cfgProd, CONTRATO);
  assert.equal(nav.decisao, 'simular', 'navegador remoto continua simulado em produção');
  const avi = L.acqProtegerChamada(Object.assign(ped('ACQ-03', 'aceleriq_aviso_publicacao_preparar', { operator: 'default', publication_id: 'p', mensagem: 'x', channel: 'portal', idempotency_key: 'acq03:p:x:aviso' }), { client_id_escopo: 'eb1270a5-4d9e-4c67-bb17-e25fa12ada34' }), cfgProd, CONTRATO);
  assert.equal(avi.decisao, 'escrever');
});
