// ACQ-06 e ACQ-07 (comercial pelo WhatsApp oficial): lógica pura e os fluxos gerados rodando no
// simulador local (tools/simulador-n8n.mjs) com Postgres real e painel/Meta/Jev/LLM FALSOS.
// Nada aqui chama a Meta, o OpenRouter, o TypeSafe ou o painel de produção.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { carregarLib, lerJson } from './_lib.mjs';
import { subirPostgres } from './_pg.mjs';
import { criarSimulador, comConfig } from '../tools/simulador-n8n.mjs';
import { criarMundo, LEADS, webhookMeta } from '../fixtures/comercial-teste.mjs';

const L = carregarLib('nucleo', 'adaptador', 'comercial', 'wf06', 'wf07');
const AMB = lerJson('config/ambientes.json');
const CONTRATO = lerJson('contratos/ferramentas.json');
const TER_10H = Date.parse('2026-11-03T13:00:00Z');   // terça, 10h em São Paulo
const TER_20H = Date.parse('2026-11-03T23:30:00Z');   // terça, 20h30
const SAB_10H = Date.parse('2026-11-07T13:00:00Z');
const cfg = (n, mudar) => { const a = JSON.parse(JSON.stringify(AMB)); if (mudar) mudar(a.ambientes[n]); return L.acqConfigEfetiva(n, a); };

// ------------------------------------------------------------------ lógica pura
test('modo seguro: ACQ-06/07 nascem em dry-run em todos os ambientes, mesmo com o resto de produção escrevendo', () => {
  for (const n of ['test', 'pilot', 'production']) {
    const c = cfg(n);
    assert.equal(L.acqDryRun(c, 'ACQ-06'), true, n);
    assert.equal(L.acqDryRun(c, 'ACQ-07'), true, n);
    assert.equal(L.acqComTransporte(c, 'ACQ-06', 'primeiro_contato').decisao, 'simular');
  }
  const prod = cfg('production');
  assert.equal(L.acqDryRun(prod, 'ACQ-01'), false, 'os outros fluxos de produção não mudam');
  const reg = { workflow_id: 'ACQ-07', run_id: 'r', ferramenta: 'aceleriq_comercial_registrar_mensagem', argumentos: { lead_id: LEADS.pronto, direcao: 'entrada', texto: 'oi' } };
  const p1 = L.acqProtegerChamada(reg, prod, CONTRATO);
  assert.equal(p1.decisao, 'simular'); assert.equal(p1.motivo, 'dry_run');
  const ligado = cfg('production', (a) => { a.dry_run_por_workflow['ACQ-07'] = false; });
  assert.equal(L.acqProtegerChamada(reg, ligado, CONTRATO).motivo, 'escrita_nao_liberada_no_ambiente', 'segunda trava: liberar a escrita em produção');
  const tudo = cfg('production', (a) => { a.dry_run_por_workflow['ACQ-07'] = false; a.escritas_liberadas.push('aceleriq_comercial_registrar_mensagem'); });
  const p3 = L.acqProtegerChamada(reg, tudo, CONTRATO);
  assert.equal(p3.decisao, 'escrever');
  assert.equal(p3.rpc.params.arguments.idempotency_key, undefined, 'esquema estrito: sem idempotency_key');
  assert.equal(L.acqProtegerChamada(Object.assign({}, reg, { workflow_id: 'ACQ-06', ferramenta: 'aceleriq_update_opportunity' }), tudo, CONTRATO).motivo, 'ferramenta_fora_da_allowlist');
  assert.equal(L.acqProtegerChamada(Object.assign({}, reg, { ferramenta: 'aceleriq_comercial_atribuir_agente' }), tudo, CONTRATO).motivo, 'ferramenta_fora_da_allowlist');
});

test('transporte só liga com phone_number_id e modelo aprovado', () => {
  const base = (m) => cfg('production', (a) => { a.dry_run_por_workflow['ACQ-06'] = false; m && m(a.comercial); });
  assert.equal(L.acqComTransporte(base((c) => { c.phone_number_id = null; }), 'ACQ-06', 'primeiro_contato').motivo, 'falta_phone_number_id');
  assert.equal(L.acqComTransporte(base((c) => { c.phone_number_id = '123'; }), 'ACQ-06', 'primeiro_contato').motivo, 'modelo_nao_aprovado:primeiro_contato');
  assert.equal(L.acqComTransporte(base((c) => { c.phone_number_id = '123'; c.modelos.primeiro_contato.aprovado = true; }), 'ACQ-06', 'primeiro_contato').decisao, 'enviar');
  assert.equal(L.acqComTransporte(base((c) => { c.phone_number_id = '123'; }), 'ACQ-06', null).decisao, 'enviar', 'texto livre não depende de modelo');
});

test('número: Brasil com e sem 9, fixo, internacional e comparação com o wa_id da Meta', () => {
  assert.deepEqual(L.acqComNumero('(19) 99876-5432'), { numero: '5519998765432', fixo: false });
  assert.deepEqual(L.acqComNumero('(19) 3232-4545'), { numero: '551932324545', fixo: true });
  assert.equal(L.acqComNumero('+595 981 123456').numero, '595981123456');
  assert.equal(L.acqComNumero('+1 (407) 555-0100').numero, '14075550100');
  assert.equal(L.acqComNumero('123'), null);
  assert.equal(L.acqComMesmoNumero('(19) 99876-5432', '551998765432'), true, 'wa_id sem o 9');
  assert.equal(L.acqComMesmoNumero('(19) 99876-5432', '5519998765432'), true);
  assert.equal(L.acqComMesmoNumero('(19) 99876-5432', '5511998765432'), false, 'DDD diferente');
});

test('fato observado: nota interna nunca vira frase para o lead', () => {
  const site = { fonte: 'maquina_de_leads', site: 'x.com' };
  assert.equal(L.acqComFatoObservado({ qualificacao: { ...site, presenca_digital: 'Site com agenda online,Instagram e WhatsApp publicados;não testados. Google não auditado.' } }), null, 'anotação da ficha não é fato');
  assert.equal(L.acqComFatoObservado({ qualificacao: { ...site, presenca_digital: 'o site parece antigo' } }), null, 'nem quando parece frase');
  assert.equal(L.acqComFatoObservado({ qualificacao: site, fatos: [{ campo: 'presenca_digital', valor: 'Site e @x publicados. Google não auditado.', situacao: 'gravado' }] }), null, 'fato gravado em forma de nota fica de fora');
  assert.equal(L.acqComFatoObservado({ qualificacao: site, fatos: [{ campo: 'presenca_digital', valor: 'o rodapé tem data; o resto não', situacao: 'gravado' }] }), null);
  assert.equal(L.acqComFatoObservado({ qualificacao: site, fatos: [{ campo: 'presenca_digital', valor: 'o endereço do site de vocês no Google não está abrindo', situacao: 'gravado' }] }).texto, 'o endereço do site de vocês no Google não está abrindo');
  assert.equal(L.acqComFatoObservado({ qualificacao: site, fatos: [{ campo: 'presenca_digital', valor: 'vocês têm nota 4,8 no Google, mas só 32 avaliações', situacao: 'gravado' }] }).texto, 'vocês têm nota 4,8 no Google, mas só 32 avaliações');
});

test('fato observado: o gravado de propósito vence; Máquina sem site vira fato; com site e sem fato fica de fora', () => {
  assert.equal(L.acqComFatoObservado({ qualificacao: { fato_observado: 'o site não abre no celular.', fonte: 'maquina_de_leads' } }).texto, 'o site não abre no celular');
  assert.equal(L.acqComFatoObservado({ qualificacao: { fonte: 'maquina_de_leads', site: 'x.com' }, fatos: [{ campo: 'presenca_digital', valor: 'o último post no Instagram é de março', situacao: 'gravado' }] }).fonte, 'fato:presenca_digital');
  assert.equal(L.acqComFatoObservado({ qualificacao: { fonte: 'maquina_de_leads', site: 'x.com' }, fatos: [{ campo: 'presenca_digital', valor: 'o rodapé do site ainda mostra 2019', situacao: 'sugestao' }] }), null, 'sugestão não confirmada não sai');
  assert.equal(L.acqComFatoObservado({ qualificacao: { fonte: 'maquina_de_leads', site: null, instagram: '@x' } }).fonte, 'maquina:sem_site_com_instagram');
  assert.equal(L.acqComFatoObservado({ qualificacao: { fonte: 'maquina_de_leads', site: 'https://x.com' } }), null);
  assert.equal(L.acqComParametro('linha 1\nlinha\t2     fim'), 'linha 1 linha 2 fim', 'sem quebra de linha nem 4+ espaços (regra da Meta)');
});

test('primeiro contato: só lead pronto, ordenado pelo encaixe, dentro do horário, dia útil e teto', () => {
  const W = criarMundo();
  const fila = (agora, mudar) => { W.m.agoraMs = agora; mudar && mudar(W.m); return W.fila(); };
  const c = cfg('test');
  const r = L.acq06Candidatos(fila(TER_10H), c, TER_10H);
  assert.equal(r.pode, true);
  assert.deepEqual(r.candidatos.map((x) => x.lead_id), [LEADS.pronto, LEADS.segundo]);
  const motivos = Object.fromEntries(r.ignorados.map((x) => [x.lead_id, x.motivo]));
  assert.equal(motivos[LEADS.naoContatar], 'nao_contatar');
  assert.equal(motivos[LEADS.siteCliente], 'lead_de_site_de_cliente');
  assert.equal(motivos[LEADS.fixo], 'telefone_fixo');
  assert.equal(motivos[LEADS.comSite], 'sem_fato_observado');
  const p = r.candidatos[0];
  assert.deepEqual(p.params, ['Pet Shop Exemplo', 'vocês têm Instagram, mas não encontrei um site próprio da empresa']);
  assert.match(p.texto, /^Oi, Pet Shop Exemplo, tudo bem\? Aqui é o Mercúrio/);
  assert.doesNotMatch(p.texto, /\{\{/);
  assert.equal(L.acq06Candidatos(fila(TER_20H), c, TER_20H).motivo, 'fora_do_horario');
  assert.equal(L.acq06Candidatos(fila(SAB_10H), c, SAB_10H).motivo, 'fim_de_semana');
  assert.equal(L.acq06Candidatos(fila(TER_10H, (m) => { m.config.limite_primeiros_contatos_dia = 1; }), c, TER_10H).candidatos.length, 1, 'teto do painel');
  assert.equal(L.acq06Candidatos(fila(TER_10H, (m) => { m.config.ativo = false; }), c, TER_10H).motivo, 'mercurio_desligado');
});

test('Meta: aceita só com wamid; erro 4xx é recusa; timeout/5xx é incerto (nunca reenviar)', () => {
  assert.equal(L.acqComClassificarMeta({ statusCode: 200, body: { messages: [{ id: 'wamid.X' }] } }).wamid, 'wamid.X');
  assert.equal(L.acqComClassificarMeta({ statusCode: 200, body: {} }).resultado, 'incerta');
  const r400 = L.acqComClassificarMeta({ statusCode: 400, body: { error: { code: 132001, message: 'Template name does not exist' } } });
  assert.equal(r400.resultado, 'recusada'); assert.equal(r400.auth, false);
  assert.equal(L.acqComClassificarMeta({ statusCode: 401, body: { error: { code: 190, message: 'token' } } }).auth, true);
  assert.equal(L.acqComClassificarMeta({ statusCode: 500, body: { error: { code: 131000 } } }).resultado, 'incerta');
  assert.equal(L.acqComClassificarMeta({ error: { message: 'ETIMEDOUT' } }).resultado, 'incerta');
  assert.equal(L.acqComClassificarMeta({ statusCode: 429, body: { error: { code: 130429 } } }).resultado, 'recusada');
});

test('webhook: verify token, assinatura HMAC e normalização (texto, botão, status com falha)', () => {
  assert.equal(L.acq07Verificacao({ 'hub.mode': 'subscribe', 'hub.verify_token': 'token-de-teste-123', 'hub.challenge': '42' }, { verify_token: 'token-de-teste-123' }).challenge, '42');
  assert.equal(L.acq07Verificacao({ 'hub.mode': 'subscribe', 'hub.verify_token': 'outro' }, { verify_token: 'token-de-teste-123' }).ok, false);
  assert.equal(L.acq07Verificacao({ 'hub.mode': 'subscribe', 'hub.verify_token': 'x' }, {}).motivo, 'verify_token_nao_configurado');
  const corpo = JSON.stringify(webhookMeta({ wamid: 'wamid.A', de: '551998765432', texto: 'Olá, ção ✓', quando: TER_10H }));
  const assin = 'sha256=' + crypto.createHmac('sha256', 'segredo-app').update(corpo, 'utf8').digest('hex');
  assert.equal(L.acq07Assinatura(corpo, assin, 'segredo-app').ok, true);
  assert.equal(L.acq07Assinatura(corpo + ' ', assin, 'segredo-app').motivo, 'assinatura_invalida');
  assert.equal(L.acq07Assinatura(corpo, assin, null).motivo, 'app_secret_nao_configurado');
  const n = L.acq07Normalizar(JSON.parse(corpo), '100000000000001');
  assert.equal(n.mensagens[0].texto, 'Olá, ção ✓');
  assert.equal(L.acq07Normalizar(JSON.parse(corpo), '999').mensagens.length, 0, 'outro número da WABA é ignorado');
  const b = L.acq07Normalizar(webhookMeta({ wamid: 'wamid.B', de: '1', tipo: 'button', botao: 'Não tenho interesse', quando: TER_10H }), null);
  assert.equal(b.mensagens[0].botao, 'Não tenho interesse');
  const st = { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: 'wamid.C', status: 'failed', timestamp: '1', recipient_id: '5519', errors: [{ code: 131049, title: 'limite de marketing' }] }] } }] }] };
  const s = L.acq07Normalizar(st, null).status[0];
  assert.equal(L.acq07EventoStatus(s, { run_id: 'r', agoraMs: TER_10H }).tipo, 'comercial_envio_falhou_na_entrega');
  assert.equal(L.acq07EventoStatus(Object.assign({}, s, { status: 'read' }), { run_id: 'r', agoraMs: TER_10H }), null);
});

test('decisão: pare nunca responde; quem avança vai para a Caixa; fora da janela não há texto livre', () => {
  const c = cfg('test');
  const fila = { config: { ativo: true }, itens: [] };
  const lead = { lead_id: LEADS.pronto, mensagens: [{ direcao: 'saida', texto: 'modelo' }], qualificacao: {} };
  const msg = (texto, extra) => Object.assign({ wamid: 'w', de: '551998765432', em: new Date(TER_10H).toISOString(), texto }, extra || {});
  const j = (intencao, extra) => Object.assign({ intencao, confianca: 0.9, p_pare: intencao === 'pare' ? 0.9 : 0.02, p_avancou: 0.05 }, extra || {});
  assert.equal(L.acq07Decidir(msg('me esquece'), lead, null, j('pare'), fila, c, TER_10H).acao, 'parar');
  assert.equal(L.acq07Decidir(msg('x'), lead, null, j('outro', { p_pare: 0.45 }), fila, c, TER_10H).acao, 'parar', 'na dúvida sobre parar, para');
  assert.equal(L.acq07Decidir(msg('Não tenho interesse', { botao: 'Não tenho interesse' }), lead, null, null, fila, c, TER_10H).acao, 'parar');
  assert.equal(L.acq07Decidir(msg('pare'), lead, { pediu_para_parar: true }, j('outro'), fila, c, TER_10H).acao, 'parar');
  const quer = L.acq07Decidir(msg('quero sim'), lead, null, j('interessado'), fila, c, TER_10H);
  assert.equal(quer.caixa, true); assert.equal(quer.responder, true);
  const preco = L.acq07Decidir(msg('quanto custa?'), lead, null, j('pergunta', { p_avancou: 0.8 }), fila, c, TER_10H);
  assert.equal(preco.caixa, true);
  assert.equal(L.acq07Decidir(msg('valeu'), lead, null, j('outro'), fila, c, TER_10H).responder, false);
  const velho = L.acq07Decidir(msg('quero', { em: new Date(TER_10H - 30 * 3600000).toISOString() }), lead, null, j('interessado'), fila, c, TER_10H);
  assert.equal(velho.responder, false); assert.equal(velho.caixa, true); assert.ok(velho.motivos.includes('fora_da_janela_de_24h'));
  assert.equal(L.acq07Decidir(msg('oi'), Object.assign({}, lead, { qualificacao: { nao_contatar: 'sim' } }), null, j('interessado'), fila, c, TER_10H).acao, 'nada');
  assert.equal(L.acq07Decidir(msg('oi'), lead, null, null, fila, c, TER_10H).motivos[0], 'classificacao_indisponivel');
  assert.equal(L.acq07Decidir(msg('oi'), null, null, j('interessado'), fila, c, TER_10H).motivos[0], 'numero_sem_lead_do_mercurio');
});

test('texto do Mercúrio: sem link fora das orientações, sem texto vazio, cortado em frase inteira', () => {
  const c = cfg('test');
  const r = (t) => ({ choices: [{ message: { content: t } }] });
  assert.equal(L.acq07LerLLM(r('Veja em https://golpe.exemplo agora.'), c, 'orientações sem link').ok, false);
  assert.equal(L.acq07LerLLM(r('Agende em https://aceleriq.com/agenda.'), c, 'Agenda: https://aceleriq.com/agenda').ok, true);
  assert.equal(L.acq07LerLLM(r('   '), c, '').ok, false);
  assert.equal(L.acq07LerLLM({ error: { message: 'sem credencial' } }, c, '').ok, false);
  const longo = L.acq07LerLLM(r('Frase um curta. ' + 'x'.repeat(800)), c, '');
  assert.equal(longo.ok, false);
  const pedido = L.acq07PedidoLLM({ wamid: 'w', texto: 'quanto custa?' }, { nome: 'Pet', etapa: 'contato', mensagens: [{ direcao: 'saida', texto: 'modelo' }], fatos: [] },
    { intencao: 'pergunta', caixa: true }, { config: { orientacoes: 'ORIENTACAO-UNICA' } }, c);
  assert.match(pedido.messages[0].content, /ORIENTACAO-UNICA/);
  assert.equal(pedido.messages[pedido.messages.length - 1].content, 'quanto custa?');
});

// ------------------------------------------------------------------ fluxos no simulador
let P, WF;
before(async () => {
  P = await subirPostgres();
  process.argv.push('--ambiente', 'test');
  const { gerarTodos } = await import('../build/gerar.mjs');
  WF = Object.fromEntries(gerarTodos().map((w) => [w.nome, w.json()]));
});
after(async () => { if (P) await P.parar(); });
beforeEach(async () => { if (P) await P.admin.query('truncate acq_n8n.eventos, acq_n8n.incidentes, acq_n8n.cursores restart identity cascade'); });

const ligarTransporte = (a) => { const t = a.ambientes.test; t.dry_run_por_workflow = { 'ACQ-06': false, 'ACQ-07': false }; t.comercial.phone_number_id = '100000000000001';
  t.comercial.modelos.primeiro_contato.aprovado = true; t.comercial.modelos.retomada.aprovado = true; };
function montar(W, aoVivo, extra) {
  const ws = ['ACQ-00-Ferramenta-Aceleriq', 'ACQ-06-Comercial-Primeiro-Contato', 'ACQ-07-Comercial-Respostas'].map((n) => (aoVivo || extra) ? comConfig(WF[n], (a) => { if (aoVivo) ligarTransporte(a); if (extra) extra(a); }) : WF[n]);
  return criarSimulador({ workflows: ws, http: W.http, pg: P.admin });
}
const eventos = async (wf) => (await P.admin.query('select tipo, idempotency_key, payload from acq_n8n.eventos where workflow_id = $1 order by id', [wf])).rows;
const incidentes = async () => (await P.admin.query('select incident_key, severidade, titulo from acq_n8n.incidentes order by incident_key')).rows;
const rodar06 = (S, agora) => S.executar('Acq06ComercialPC', 'Entrada interna', [{ json: { agora: new Date(agora).toISOString() } }]);

test('ACQ-06 dry-run: não chama a Meta, simula o registro e grava o que enviaria; repetir no dia não duplica', async () => {
  const W = criarMundo(); const S = montar(W, false);
  await rodar06(S, TER_10H);
  assert.equal(W.m.meta.enviadas.length, 0, 'nenhuma chamada à Meta');
  assert.equal(W.m.mensagens.length, 0, 'nada gravado no painel (escrita simulada)');
  const ev = await eventos('ACQ-06');
  const sim = ev.filter((e) => e.tipo === 'comercial_primeiro_contato_simulado');
  assert.equal(sim.length, 2);
  assert.match(sim[0].payload.texto, /Pet Shop Exemplo/);
  assert.ok(ev.some((e) => e.tipo === 'comercial_escrita_registro_simulada'));
  const n = ev.length;
  await rodar06(S, TER_10H + 20 * 60000);
  assert.equal((await eventos('ACQ-06')).length, n, 'mesma simulação não se repete no dia');
  assert.equal(W.m.meta.enviadas.length, 0);
});

test('ACQ-06 ao vivo: manda o modelo com nome e fato, registra com o wamid e não reenvia', async () => {
  const W = criarMundo(); const S = montar(W, true);
  await rodar06(S, TER_10H);
  assert.equal(W.m.meta.enviadas.length, 2);
  const env = W.m.meta.enviadas[0];
  assert.equal(env.url, 'http://127.0.0.1:8792/graph/v21.0/100000000000001/messages');
  assert.equal(env.corpo.type, 'template');
  assert.equal(env.corpo.to, '5519998765432');
  assert.equal(env.corpo.template.name, 'aceleriq_primeiro_contato_mercurio');
  assert.deepEqual(env.corpo.template.components[0].parameters.map((p) => p.text), ['Pet Shop Exemplo', 'vocês têm Instagram, mas não encontrei um site próprio da empresa']);
  const saidas = W.m.mensagens.filter((x) => x.direcao === 'saida');
  assert.deepEqual(saidas.map((x) => x.id_externo).sort(), ['wamid.TESTE1', 'wamid.TESTE2']);
  assert.match(saidas[0].texto, /reparei que/);
  assert.equal(W.lead(LEADS.pronto).stage, 'contato');
  assert.ok(W.m.chamadas_http.filter((c) => c.url.includes('/graph/')).every((c) => c.credencial === 'ACQ WhatsApp Cloud API (Meta)'));
  await rodar06(S, TER_10H + 20 * 60000);
  assert.equal(W.m.meta.enviadas.length, 2, 'segunda rodada não manda de novo');
  await rodar06(S, TER_10H + 24 * 3600000);
  assert.equal(W.m.meta.enviadas.length, 2, 'nem no dia seguinte');
});

test('ACQ-06: erro da Meta não marca como enviado; timeout vira incerto e nunca é repetido', async () => {
  const W = criarMundo(); const S = montar(W, true);
  W.m.meta.modo = '400';
  await rodar06(S, TER_10H);
  assert.equal(W.m.mensagens.length, 0, 'nada registrado na conversa');
  assert.ok((await eventos('ACQ-06')).some((e) => e.tipo === 'comercial_primeiro_contato_recusado'));
  assert.ok((await incidentes()).some((i) => i.incident_key === 'ACQ-06|meta_recusou|132001'));
  W.m.meta.modo = 'ok';
  await rodar06(S, TER_10H + 20 * 60000);
  assert.equal(W.m.meta.enviadas.length, 2, 'recusado hoje não tenta de novo hoje');
  await rodar06(S, TER_10H + 24 * 3600000);
  assert.equal(W.m.meta.enviadas.length, 4, 'no dia seguinte tenta de novo (nada tinha saído)');

  await P.admin.query('truncate acq_n8n.eventos, acq_n8n.incidentes restart identity cascade');
  const W2 = criarMundo({ leads: criarMundo().m.leads.filter((l) => l.id === LEADS.pronto) }); const S2 = montar(W2, true);
  W2.m.meta.modo = 'timeout';
  await rodar06(S2, TER_10H);
  assert.equal(W2.m.mensagens.length, 0);
  assert.ok((await incidentes()).some((i) => i.incident_key === 'ACQ-06|envio_incerto|' + LEADS.pronto && i.severidade === 'alto'));
  W2.m.meta.modo = 'ok';
  await rodar06(S2, TER_10H + 48 * 3600000);
  assert.equal(W2.m.meta.enviadas.length, 1, 'envio incerto nunca é repetido sozinho');
});

test('ACQ-06: fora do horário, fim de semana, teto e transporte incompleto não chamam a Meta', async () => {
  const W = criarMundo(); const S = montar(W, true);
  await rodar06(S, TER_20H); await rodar06(S, SAB_10H);
  assert.equal(W.m.meta.enviadas.length, 0);
  W.m.config.limite_primeiros_contatos_dia = 1;
  await rodar06(S, TER_10H);
  assert.equal(W.m.meta.enviadas.length, 1, 'teto do dia do painel');
  const W2 = criarMundo(); const S2 = montar(W2, false, (a) => { a.ambientes.test.dry_run_por_workflow = { 'ACQ-06': false, 'ACQ-07': false }; });
  await rodar06(S2, TER_10H);
  assert.equal(W2.m.meta.enviadas.length, 0, 'sem phone_number_id');
  assert.equal(W2.m.mensagens.length, 0, 'e sem registro falso no painel');
  assert.ok((await incidentes()).some((i) => i.incident_key === 'ACQ-06|transporte_incompleto'));
});

test('ACQ-06: Meta aceitou e o painel falhou → incidente alto e nada é reenviado', async () => {
  const W = criarMundo({ leads: criarMundo().m.leads.filter((l) => l.id === LEADS.pronto) }); const S = montar(W, true);
  W.m.falhas.aceleriq_comercial_registrar_mensagem = 'erro de teste no painel';
  await rodar06(S, TER_10H);
  assert.equal(W.m.meta.enviadas.length, 1);
  assert.ok((await incidentes()).some((i) => i.incident_key.startsWith('ACQ-06|escrita_falhou|registro|wamid.TESTE1') && i.severidade === 'alto'));
  delete W.m.falhas.aceleriq_comercial_registrar_mensagem;
  await rodar06(S, TER_10H + 20 * 60000);
  assert.equal(W.m.meta.enviadas.length, 1, 'o evento "aceito" bloqueia o reenvio mesmo sem registro no painel');
});

// --- ACQ-07
const NUM = '551998765432';  // wa_id do lead "pronto" (sem o 9)
async function segredos() { await P.admin.query(`select acq_n8n.cursor_avancar('ACQ-07', 'segredos_webhook', 0, '{"verify_token":"token-de-teste-123","app_secret":"segredo-app"}'::jsonb)`); }
function postAssinado(corpoObj, segredo = 'segredo-app') {
  const bruto = JSON.stringify(corpoObj);
  const sig = 'sha256=' + crypto.createHmac('sha256', segredo).update(bruto, 'utf8').digest('hex');
  return [{ json: { headers: { 'x-hub-signature-256': sig, 'content-type': 'application/json' }, params: {}, query: {}, body: JSON.parse(bruto) }, binary: { data: { data: Buffer.from(bruto, 'utf8').toString('base64'), mimeType: 'application/json' } } }];
}
const conversaAberta = (W) => W.m.mensagens.push({ lead_id: LEADS.pronto, direcao: 'saida', texto: 'Oi, Pet Shop Exemplo (modelo)', enviada_em: new Date(TER_10H - 3600000).toISOString(), id_externo: 'wamid.ANTES' });
// O webhook usa o relógio de verdade (Date.now()) para a janela de 24 h: a mensagem chega "agora".
const msg = (wamid, texto, extra) => webhookMeta(Object.assign({ wamid, de: NUM, texto, quando: Date.now() - 60000 }, extra || {}));

test('ACQ-07 GET: devolve o challenge só com o verify token certo', async () => {
  await segredos();
  const S = montar(criarMundo(), false);
  const ok = await S.executar('Acq07ComercialRs', 'WhatsApp: verificação (GET)', [{ json: { headers: {}, query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'token-de-teste-123', 'hub.challenge': '987654' }, body: {} } }]);
  assert.deepEqual(ok.respostas, [{ no: 'Devolver challenge', corpo: '987654', codigo: 200 }]);
  const nao = await S.executar('Acq07ComercialRs', 'WhatsApp: verificação (GET)', [{ json: { headers: {}, query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'errado', 'hub.challenge': '1' }, body: {} } }]);
  assert.equal(nao.respostas[0].codigo, 403);
});

test('ACQ-07 POST ao vivo: lead interessado → entrada registrada, Caixa avisada, Mercúrio responde e a saída fica com o wamid', async () => {
  await segredos();
  const W = criarMundo(); conversaAberta(W); W.m.agoraMs = TER_10H;
  const S = montar(W, true);
  await S.executar('Acq07ComercialRs', 'WhatsApp: mensagens (POST)', postAssinado(msg('wamid.IN1', 'Quero sim, pode preparar o diagnóstico')));
  const ent = W.m.mensagens.filter((x) => x.direcao === 'entrada');
  assert.equal(ent.length, 1); assert.equal(ent[0].id_externo, 'wamid.IN1');
  assert.equal(W.m.handoffs.length, 1); assert.equal(W.m.handoffs[0].tipo, 'avancou');
  assert.equal(W.m.llm.chamadas, 1);
  assert.match(W.m.llm.ultimo.messages[0].content, /Diagnóstico gratuito do site/);
  assert.equal(W.m.meta.enviadas.length, 1);
  assert.equal(W.m.meta.enviadas[0].corpo.type, 'text');
  assert.equal(W.m.meta.enviadas[0].corpo.to, NUM, 'responde no wa_id que escreveu');
  const saida = W.m.mensagens.filter((x) => x.direcao === 'saida' && x.id_externo === 'wamid.TESTE1');
  assert.equal(saida.length, 1);
  assert.ok(W.m.chamadas_http.filter((c) => c.url.includes('/llm')).every((c) => c.credencial === 'ACQ OpenRouter (Mercúrio)'));
  assert.ok(W.m.chamadas_http.filter((c) => c.url.includes('/jev')).every((c) => c.credencial === 'TypeSafe Jev (servidor)'));
  // a Meta reenvia o mesmo webhook: nada se repete
  await S.executar('Acq07ComercialRs', 'WhatsApp: mensagens (POST)', postAssinado(msg('wamid.IN1', 'Quero sim, pode preparar o diagnóstico')));
  assert.equal(W.m.meta.enviadas.length, 1); assert.equal(W.m.handoffs.length, 1); assert.equal(W.m.llm.chamadas, 1);
});

test('ACQ-07 dry-run: classifica e redige, mas não chama a Meta nem grava no painel', async () => {
  await segredos();
  const W = criarMundo(); conversaAberta(W);
  const S = montar(W, false);
  await S.executar('Acq07ComercialRs', 'WhatsApp: mensagens (POST)', postAssinado(msg('wamid.IN2', 'Quanto custa?')));
  assert.equal(W.m.meta.enviadas.length, 0);
  assert.equal(W.m.mensagens.length, 1, 'só a mensagem que já existia');
  assert.equal(W.m.handoffs.length, 0);
  const ev = await eventos('ACQ-07');
  const d = ev.find((e) => e.idempotency_key === 'ACQ-07|desfecho|wamid.IN2');
  assert.equal(d.tipo, 'comercial_entrada_responder_simular');
  assert.match(d.payload.resposta.texto, /diagnóstico/);
  assert.ok(ev.some((e) => e.tipo === 'comercial_escrita_caixa_simulada'));
});

test('ACQ-07: assinatura errada ou sem app secret não processa nada', async () => {
  const W = criarMundo(); conversaAberta(W); const S = montar(W, true);
  await S.executar('Acq07ComercialRs', 'WhatsApp: mensagens (POST)', postAssinado(msg('wamid.IN3', 'Quero')));
  assert.ok((await incidentes()).some((i) => i.incident_key === 'ACQ-07|webhook_recusado|app_secret_nao_configurado'));
  await segredos();
  await S.executar('Acq07ComercialRs', 'WhatsApp: mensagens (POST)', postAssinado(msg('wamid.IN3', 'Quero'), 'segredo-falso'));
  assert.ok((await incidentes()).some((i) => i.incident_key === 'ACQ-07|webhook_recusado|assinatura_invalida'));
  assert.equal(W.m.chamadas.length, 0, 'nem leu a fila');
  assert.equal(W.m.meta.enviadas.length, 0);
});

test('ACQ-07: "pare" grava nao_contatar e não responde; botão "Não tenho interesse" também', async () => {
  await segredos();
  const W = criarMundo(); conversaAberta(W); const S = montar(W, true);
  await S.executar('Acq07ComercialRs', 'WhatsApp: mensagens (POST)', postAssinado(msg('wamid.IN4', 'Vocês são chatos, me esquece')));
  assert.equal(W.lead(LEADS.pronto).qualificacao.nao_contatar, 'sim');
  assert.equal(W.m.updates.length, 1, 'gravado pelo fluxo (o painel não reconheceu a frase)');
  assert.equal(W.m.meta.enviadas.length, 0); assert.equal(W.m.llm.chamadas, 0);
  await S.executar('Acq07ComercialRs', 'WhatsApp: mensagens (POST)', postAssinado(msg('wamid.IN5', 'Quero sim')));
  assert.equal(W.m.meta.enviadas.length, 0, 'depois do pare, nada sai');

  const W2 = criarMundo(); conversaAberta(W2); const S2 = montar(W2, true);
  await S2.executar('Acq07ComercialRs', 'WhatsApp: mensagens (POST)', postAssinado(msg('wamid.IN6', null, { tipo: 'button', botao: 'Não tenho interesse' })));
  assert.equal(W2.lead(LEADS.pronto).qualificacao.nao_contatar, 'sim');
  assert.equal(W2.m.meta.enviadas.length, 0);

  const W3 = criarMundo(); conversaAberta(W3); const S3 = montar(W3, true);
  await S3.executar('Acq07ComercialRs', 'WhatsApp: mensagens (POST)', postAssinado(msg('wamid.IN7', 'pare de me mandar mensagem')));
  assert.equal(W3.lead(LEADS.pronto).qualificacao.nao_contatar, 'sim', 'o painel detectou ao registrar a entrada');
  assert.equal(W3.m.updates.length, 0, 'sem escrita repetida');
  assert.equal(W3.m.meta.enviadas.length, 0);
});

test('ACQ-07: número sem lead, Jev fora e link inventado não geram resposta', async () => {
  await segredos();
  const W = criarMundo(); conversaAberta(W); const S = montar(W, true);
  await S.executar('Acq07ComercialRs', 'WhatsApp: mensagens (POST)', postAssinado(msg('wamid.IN8', 'Oi, quem é?', { de: '5521988887777' })));
  assert.equal(W.m.meta.enviadas.length, 0);
  assert.ok((await incidentes()).some((i) => i.incident_key === 'ACQ-07|sem_lead|88887777'));
  W.m.jevFalha = true;
  await S.executar('Acq07ComercialRs', 'WhatsApp: mensagens (POST)', postAssinado(msg('wamid.IN9', 'Quero')));
  assert.equal(W.m.meta.enviadas.length, 0);
  assert.equal(W.m.mensagens.filter((x) => x.id_externo === 'wamid.IN9').length, 1, 'a entrada fica registrada mesmo assim');
  W.m.jevFalha = false; W.m.llm.texto = 'Veja nossos preços em https://site-inventado.exemplo agora.';
  await S.executar('Acq07ComercialRs', 'WhatsApp: mensagens (POST)', postAssinado(msg('wamid.IN10', 'Quanto custa?')));
  assert.equal(W.m.meta.enviadas.length, 0);
  assert.equal(W.m.handoffs.length, 1, 'a Caixa é avisada mesmo sem resposta automática');
  assert.ok((await incidentes()).some((i) => i.incident_key.startsWith('ACQ-07|resposta_nao_redigida|link_fora_das_orientacoes')));
});
