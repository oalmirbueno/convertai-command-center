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
  assert.equal(L.acqComTransporte(base((c) => { c.phone_number_id = '123'; c.modelos.primeiro_contato.aprovado = false; }), 'ACQ-06', 'primeiro_contato').motivo, 'modelo_nao_aprovado:primeiro_contato');
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
  assert.deepEqual(p.params, ['pessoal', 'Pet Shop Exemplo', 'vocês têm Instagram, mas não encontrei um site próprio da empresa']);
  assert.match(p.texto, /^Oi, pessoal, tudo bem\? Aqui é o Rafael, da Aceleriq\. Dei uma olhada na/);
  assert.equal(L.acqComPrimeiroNome({ nome: 'Renata Souza', empresa: 'Bella Forma' }), 'Renata');
  assert.equal(L.acqComPrimeiroNome({ nome: 'Bella Forma', empresa: 'Bella Forma' }), null);
  assert.equal(L.acqComPrimeiroNome({ nome: 'Clínica Sorriso' }), null, 'nome de empresa não é nome de gente');
  assert.equal(L.acqComPrimeiroNome({ nome: 'Pet', empresa: 'x', qualificacao: { contato_nome: 'Carla' } }), 'Carla');
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

test('decisão: pare nunca responde; a Caixa é só para reunião, pessoa ou fora da tabela; robô não vira conversa', () => {
  const c = cfg('test');
  const fila = { config: { ativo: true }, itens: [] };
  const lead = { lead_id: LEADS.pronto, mensagens: [{ direcao: 'saida', texto: 'modelo' }], qualificacao: {} };
  const msg = (texto, extra) => Object.assign({ wamid: 'w', de: '551998765432', em: new Date(TER_10H).toISOString(), texto }, extra || {});
  const j = (intencao, extra) => Object.assign({ intencao, confianca: 0.9, p_pare: intencao === 'pare' ? 0.9 : 0.02, remetente: 'humano', etapa: 'descobrir', objecao: 'nenhuma', plano: 'nenhum' }, extra || {});
  assert.equal(L.acq07Decidir(msg('me esquece'), lead, null, j('pare'), fila, c, TER_10H).acao, 'parar');
  // 07/11: "na dúvida, para" calou a Priscila ("stop info.com"). Agora só para com frase de saída (ou botão).
  assert.equal(L.acq07Decidir(msg('x'), lead, null, j('outro', { p_pare: 0.45 }), fila, c, TER_10H).acao, 'responder', 'dúvida sem frase de saída segue a conversa');
  assert.equal(L.acq07Decidir(msg('não quero, pode parar'), lead, null, j('outro', { p_pare: 0.45 }), fila, c, TER_10H).acao, 'parar');
  assert.equal(L.acq07Decidir(msg('Não tenho interesse', { botao: 'Não tenho interesse' }), lead, null, null, fila, c, TER_10H).acao, 'parar');
  assert.equal(L.acq07Decidir(msg('pare'), lead, { pediu_para_parar: true }, j('outro'), fila, c, TER_10H).acao, 'parar');
  const preco = L.acq07Decidir(msg('quanto custa?'), lead, null, j('pergunta', { etapa: 'apresentar' }), fila, c, TER_10H);
  assert.equal(preco.caixa, false, 'preço o Mercúrio responde'); assert.equal(preco.responder, true);
  const reuniao = L.acq07Decidir(msg('pode ser terça às 11h'), lead, null, j('interessado', { etapa: 'confirmar_reuniao' }), fila, c, TER_10H);
  assert.equal(reuniao.agenda, true); assert.equal(reuniao.caixa, false, 'a Caixa nasce quando a reunião é marcada'); assert.equal(reuniao.responder, true);
  assert.equal(L.acq07Decidir(msg('quero falar com o dono'), lead, null, j('pergunta', { etapa: 'passar_humano' }), fila, c, TER_10H).caixa, true);
  assert.equal(L.acq07Decidir(msg('valeu'), lead, null, j('outro', { etapa: 'encerrar' }), fila, c, TER_10H).responder, false);
  const velho = L.acq07Decidir(msg('quero', { em: new Date(TER_10H - 30 * 3600000).toISOString() }), lead, null, j('interessado'), fila, c, TER_10H);
  assert.equal(velho.responder, false); assert.ok(velho.motivos.includes('fora_da_janela_de_24h'));
  assert.equal(L.acq07Decidir(msg('Em breve retornamos'), lead, null, j('outro', { remetente: 'resposta_automatica' }), fila, c, TER_10H).responder, false);
  assert.equal(L.acq07Decidir(msg('Digite 1 para vendas'), lead, null, j('outro', { remetente: 'menu_de_robo' }), fila, c, TER_10H).modo, 'menu');
  const preso = Object.assign({}, lead, { mensagens: [{ direcao: 'saida', texto: '1' }, { direcao: 'saida', texto: '2' }] });
  assert.equal(L.acq07Decidir(msg('Digite 1'), preso, null, j('outro', { remetente: 'menu_de_robo' }), fila, c, TER_10H).responder, false, 'não fica preso com o robô');
  assert.equal(L.acq07Decidir(msg('oi'), Object.assign({}, lead, { qualificacao: { nao_contatar: 'sim' } }), null, j('interessado'), fila, c, TER_10H).acao, 'nada');
  assert.equal(L.acq07Decidir(msg('oi'), lead, null, null, fila, c, TER_10H).motivos[0], 'classificacao_indisponivel');
  assert.equal(L.acq07Decidir(msg('oi'), null, null, j('interessado'), fila, c, TER_10H).motivos[0], 'lead_indisponivel');
  assert.equal(L.acq07Decidir(msg('oi'), { so_registrar: true, motivo: 'ja_e_cliente' }, null, j('interessado'), fila, c, TER_10H).responder, false);
  const faltando = L.acq07Decidir(msg('quero fechar'), lead, null, j('interessado', { etapa: 'fechar_agora', plano: 'start_assistido' }), fila, c, TER_10H);
  assert.equal(faltando.cobrar, false); assert.deepEqual(faltando.faltam, ['CPF ou CNPJ']);
  const pronto = L.acq07Decidir(msg('meu cpf é 529.982.247-25'), lead, null, j('interessado', { etapa: 'fechar_agora', plano: 'start_assistido' }), fila, c, TER_10H);
  assert.equal(pronto.cobrar, true); assert.equal(pronto.documento, '52998224725');
  assert.equal(L.acq07Decidir(msg('quero com o google, cpf 529.982.247-25'), lead, null, j('interessado', { etapa: 'fechar_agora', plano: 'start_assistido', quer_google: true }), fila, c, TER_10H).com_google, true);
  assert.equal(L.acq07Decidir(msg('meu cpf é 111.111.111-11'), lead, null, j('interessado', { etapa: 'fechar_agora', plano: 'start_assistido' }), fila, c, TER_10H).cobrar, false, 'documento errado não cobra');
});

test('primeiro acolhe: sem entender a necessidade não apresenta preço, a não ser que a pessoa insista ou decida', () => {
  const c = cfg('test');
  const fila = { config: { ativo: true }, itens: [] };
  const lead = { lead_id: LEADS.pronto, mensagens: [{ direcao: 'saida', texto: 'oi' }], qualificacao: {} };
  const msg = { wamid: 'w', de: '551998765432', em: new Date(TER_10H).toISOString(), texto: 'como funciona e quanto custa?' };
  assert.equal(L.acq07Decidir(msg, { lead_id: 'x', mensagens: [], qualificacao: {} }, null, { intencao: 'pergunta', confianca: 0.9, p_pare: 0.02, remetente: 'humano', etapa: 'apresentar', objecao: 'preco', plano: 'nenhum', entendeu_necessidade: true, insiste_no_preco: false }, fila, c, TER_10H).etapa, 'acolher', 'a primeira resposta sempre acolhe');
  const j = (extra) => Object.assign({ intencao: 'pergunta', confianca: 0.9, p_pare: 0.02, remetente: 'humano', etapa: 'apresentar', objecao: 'nenhuma', plano: 'nenhum', entendeu_necessidade: false, insiste_no_preco: false }, extra);
  assert.equal(L.acq07Decidir(msg, lead, null, j({}), fila, c, TER_10H).etapa, 'acolher');
  assert.equal(L.acq07Decidir(msg, lead, null, j({ insiste_no_preco: true }), fila, c, TER_10H).etapa, 'apresentar');
  assert.equal(L.acq07Decidir(msg, lead, null, j({ entendeu_necessidade: true }), fila, c, TER_10H).etapa, 'apresentar');
  assert.equal(L.acq07Decidir(msg, lead, null, j({ etapa: 'fechar_agora' }), fila, c, TER_10H).etapa, 'fechar_agora');
  assert.match(L.acq07PedidoLLM(msg, { nome: 'x', etapa: 'novo', mensagens: [], fatos: [] }, L.acq07Decidir(msg, lead, null, j({}), fila, c, TER_10H), fila, c).messages[0].content, /Agora acolha/);
});

test('teste real: com a lista preenchida, só esses números são atendidos; desconto só depois da objeção', () => {
  const c = cfg('test', (e) => { e.comercial.teste_somente_numeros = ['5541988488435']; });
  assert.equal(L.acq07ForaDoTeste({ de: '554188488435' }, c), false, 'o próprio número, com ou sem o 9');
  assert.equal(L.acq07ForaDoTeste({ de: '5541999990000' }, c), true);
  assert.equal(L.acq07ForaDoTeste({ de: '5541999990000' }, cfg('test')), false, 'sem lista, atende todos');
  const fila = { config: { ativo: true }, itens: [] };
  const msg = { wamid: 'w', de: '551998765432', em: new Date(TER_10H).toISOString(), texto: 'tá caro' };
  const j = { intencao: 'pergunta', confianca: 0.9, p_pare: 0.02, remetente: 'humano', etapa: 'tratar_objecao', objecao: 'preco', plano: 'nenhum', entendeu_necessidade: true };
  const sem = L.acq07Decidir(msg, { lead_id: 'x', mensagens: [{ direcao: 'saida', texto: 'oi' }], qualificacao: {} }, null, Object.assign({}, j), fila, c, TER_10H);
  assert.equal(sem.pode_desconto, false, 'antes de apresentar preço não');
  const com = L.acq07Decidir(msg, { lead_id: 'x', mensagens: [{ direcao: 'saida', texto: 'R$ 847 por mês' }], qualificacao: {} }, null, Object.assign({}, j), fila, c, TER_10H);
  assert.equal(com.pode_desconto, true);
  const it = (texto, r) => ({ mensagem: { wamid: 'w' }, lead: { lead_id: 'x', empresa: 'E' }, decisao: { cobrar: true, plano: 'start_assistido', documento: '1', desconto_oferecido: /15%/.test(texto) }, resposta: Object.assign({ ok: true, plano_combinado: 'start_assistido' }, r) });
  assert.equal(L.acq07PedidoCobranca(it('sem', { com_desconto: true }), c).argumentos.com_desconto, undefined, 'não cobra com desconto que não foi oferecido');
  assert.equal(L.acq07PedidoCobranca(it('15%', { com_desconto: true }), c).argumentos.com_desconto, true);
});

test('Plano Começo: fecha com o Almir, sem Pix', () => {
  const d = L.acq07Decidir({ wamid: 'w', de: '551998765432', em: new Date(TER_10H).toISOString(), texto: 'quero o de 550' }, { lead_id: 'x', mensagens: [{ direcao: 'saida', texto: 'oi' }], qualificacao: {} }, null,
    { intencao: 'interessado', confianca: 0.9, p_pare: 0.02, remetente: 'humano', etapa: 'fechar_agora', objecao: 'nenhuma', plano: 'comeco', entendeu_necessidade: true }, { config: { ativo: true }, itens: [] }, cfg('test'), TER_10H);
  assert.equal(d.cobrar, false); assert.equal(d.caixa, true); assert.equal(d.etapa, 'passar_humano'); assert.deepEqual(d.faltam, []);
});

test('link do lead: acha, abre, lê a loja e vira fato no CRM', () => {
  const c = cfg('test');
  assert.deepEqual(L.acq07LinksDoTexto('Somos drop https://Gatum.com.br, me chama em contato@gatum.com.br ou instagram.com/gatum').map((l) => [l.host, l.rede_social]), [['gatum.com.br', false], ['instagram.com', true]]);
  assert.equal(L.acq07LinksDoTexto('vê loja.exemplo.com.br/produtos.')[0].url, 'https://loja.exemplo.com.br/produtos');
  const m = { wamid: 'w1', de: '554198848435', em: '2026-11-06T14:48:00Z', texto: 'Somos drop https://Gatum.com.br' };
  assert.equal(L.acq07LinkParaAbrir(m, { mensagens: [], fatos: [] }).host, 'gatum.com.br');
  const depois = { wamid: 'w2', de: m.de, em: m.em, texto: 'Você conseguiu analisar a loja?' };
  const lead = { lead_id: '40bcf663-9e4c-4b46-9cbf-c8f9efe855a4', mensagens: [{ direcao: 'entrada', texto: m.texto }], fatos: [] };
  assert.equal(L.acq07LinkParaAbrir(depois, lead).host, 'gatum.com.br', 'link de antes ainda não lido');
  assert.equal(L.acq07LinkParaAbrir(depois, Object.assign({}, lead, { fatos: [{ campo: 'site', valor: 'https://gatum.com.br' }] })), null, 'já lido não abre de novo');
  const html = '<html><head><title>GATUM | Tudo para gatos</title><meta name="description" content="Loja para gatos"><script src="https://cdn.shopify.com/x.js"></script></head><body>'
    + '<a href="/products/arranhador-torre">Arranhador Torre</a><span>R$ 129,90</span><a href="/products/fonte-agua">Fonte de Água</a><span>R$ 89,90</span>'
    + '<p>Pague com Pix ou cartão em até 6x. Frete grátis acima de R$ 199,00. Checkout seguro Yampi.</p><a href="https://instagram.com/gatum.br">ig</a></body></html>';
  const p = L.acq07LerPagina({ statusCode: 200, body: html }, { url: 'https://gatum.com.br', host: 'gatum.com.br' });
  assert.equal(p.ok, true); assert.deepEqual(p.plataforma, ['Shopify']); assert.deepEqual(p.checkout, ['Yampi']);
  assert.deepEqual(p.produtos, ['Arranhador Torre', 'Fonte de Água']); assert.ok(p.precos.includes('R$ 129,90'));
  assert.ok(p.pagamento.includes('Pix') && p.frete.includes('frete grátis')); assert.ok(p.contato.includes('Instagram @gatum.br'));
  assert.ok(p.resumo.length <= 600 && /Shopify/.test(p.resumo));
  assert.equal(L.acq07LerPagina({ error: { message: 'timeout' } }, { url: 'https://x.com.br', host: 'x.com.br' }).ok, false);
  assert.equal(L.acq07LerPagina({}, null), null);
  const fila = { config: { ativo: true, orientacoes: 'Start R$ 847' }, itens: [] };
  const pedido = L.acq07PedidoLLM(depois, Object.assign({ nome: 'Almir', etapa: 'contato', qualificacao: {} }, lead), { etapa: 'descobrir', faltam: [] }, fila, c, [], p);
  assert.match(pedido.messages[0].content, /O QUE VOCÊ VIU AGORA NO LINK/); assert.match(pedido.messages[0].content, /Arranhador Torre/);
  assert.match(pedido.messages[0].content, /Nunca diga que não consegue abrir link/);
  const r = (t) => ({ choices: [{ message: { content: JSON.stringify({ mensagens: [t] }) } }] });
  const fonte = 'Start R$ 847\n' + p.texto + ' ' + p.precos.join(' ') + ' ' + p.url;
  assert.equal(L.acq07LerLLM(r('Vi o Arranhador Torre a R$ 129,90 na gatum.com.br'), c, fonte, lead).ok, true, 'preço e link da própria loja passam');
  assert.equal(L.acq07LerLLM(r('Olha https://golpe.exemplo.com'), c, fonte, lead).motivo, 'link_fora_das_orientacoes');
  const esc = L.acq07PedidosEscrita({ mensagem: depois, lead: lead, decisao: { motivos: [] }, pagina: p }, 'aceita', { wamids: [] }, c, Date.parse(m.em));
  assert.deepEqual(esc.filter((x) => x.ferramenta === 'aceleriq_comercial_registrar_fato').map((x) => x.argumentos.campo), ['site', 'presenca_digital']);
});

test('"stop info.com" não é pedido para parar; frase de saída é; pausa humana varia', () => {
  const c = cfg('test');
  const fila = { config: { ativo: true }, itens: [] };
  const lead = { lead_id: 'x', mensagens: [{ direcao: 'entrada', texto: 'tem site próprio' }], qualificacao: {} };
  const jp = (p) => ({ intencao: 'pare', confianca: p, p_pare: p, remetente: 'humano', etapa: 'descobrir', objecao: 'nenhuma', plano: 'nenhum', entendeu_necessidade: false });
  const m = (t) => ({ wamid: 'w' + t.length, de: '554196932016', em: new Date(TER_10H).toISOString(), texto: t });
  const d1 = L.acq07Decidir(m('stop info.com'), lead, null, jp(0.95), fila, c, TER_10H);
  assert.equal(d1.parar, false); assert.equal(d1.responder, true); assert.ok(d1.motivos.some((x) => /^pare_nao_confirmado/.test(x)));
  assert.equal(L.acq07Decidir(m('a loja se chama Stop Informática'), lead, null, jp(0.95), fila, c, TER_10H).parar, false);
  assert.equal(L.acq07Decidir(m('Vocês são chatos, me esquece'), lead, null, jp(0.6), fila, c, TER_10H).parar, true);
  assert.equal(L.acq07Decidir(m('não quero mais receber, tira meu número'), lead, null, jp(0.5), fila, c, TER_10H).parar, true);
  assert.equal(L.acq07Decidir(m('ok'), lead, null, jp(0.45), fila, c, TER_10H).parar, false, 'Jev em dúvida sem frase não cala o Rafael');
  const pausas = Array.from({ length: 400 }, (_, i) => L.acq07PausaHumana('wamid.' + i, 'descobrir'));
  const na_hora = pausas.filter((p) => p === 0).length, demora = pausas.filter((p) => p >= 40).length;
  assert.ok(na_hora > 200 && na_hora < 320, 'maioria na hora: ' + na_hora);
  assert.ok(demora > 15 && demora < 70, 'algumas com um ou dois minutos: ' + demora);
  assert.ok(pausas.every((p) => p <= 100));
  assert.equal(L.acq07PausaHumana('wamid.1', 'fechar_agora'), 0, 'fechamento responde na hora');
});

test('cadência de 3 toques: retomada em 3 dias úteis, despedida em mais 4, robô não conta, pessoa para tudo', () => {
  const c = cfg('test', (e) => { e.comercial.cadencia = { ativa: true, dias_uteis: [3, 4] }; e.comercial.modelos.retomada.aprovado = true; e.comercial.modelos.despedida = { nome: 'x_despedida', aprovado: true, corpo: 'Oi, {{1}}! Última mensagem por aqui, prometo. Se em algum momento fizer sentido, é só me chamar aqui.' }; });
  const C = L.acqComCfg(c);
  assert.equal(L.acqComDiasUteis(Date.parse('2026-11-06T15:00:00Z'), Date.parse('2026-11-11T15:00:00Z')), 3, 'sex → qua: seg, ter, qua');
  const abertura = L.acqComTextoDoModelo(C.modelos.primeiro_contato, ['pessoal', 'Clínica X', 'o rodapé do site ainda mostra 2020']);
  assert.equal(L.acqComEhModelo(abertura, c), true); assert.equal(L.acqComEhModelo('Rafael aqui, com quem eu falo?', c), false);
  const fila = (msgs, q) => ({ config: { ativo: true, horario: '09:00 a 18:00', restam_hoje: 10 }, itens: [{ lead_id: LEADS.pronto, nome: 'Clínica X', whatsapp: '5541999990000', etapa: 'contato', primeiro_contato_feito: true, qualificacao: q || {}, mensagens: msgs, fatos: [] }] });
  const s1 = { direcao: 'saida', texto: abertura, enviada_em: '2026-11-02T13:00:00Z' };
  const qua = Date.parse('2026-11-04T13:00:00Z'), qui = Date.parse('2026-11-05T13:00:00Z');
  assert.equal(L.acq06Candidatos(fila([s1]), c, qua).candidatos.length, 0, 'só 2 dias úteis');
  const r2 = L.acq06Candidatos(fila([s1]), c, qui).candidatos[0];
  assert.equal(r2.tipo, 'retomada'); assert.deepEqual(r2.params, ['pessoal']);
  const robo = { direcao: 'entrada', texto: 'Olá! Em instantes um profissional irá te atender.', enviada_em: '2026-11-02T13:01:00Z' };
  assert.equal(L.acq06Candidatos(fila([s1, robo], { so_robo: true }), c, qui).candidatos[0].tipo, 'retomada', 'robô não conta como resposta');
  assert.equal(L.acq06Candidatos(fila([s1, robo]), c, qui).candidatos.length, 0, 'resposta sem marca de robô é pessoa: para');
  const s2 = { direcao: 'saida', texto: L.acqComTextoDoModelo(C.modelos.retomada, ['pessoal']), enviada_em: '2026-11-05T13:00:00Z' };
  assert.equal(L.acq06Candidatos(fila([s1, s2]), c, Date.parse('2026-11-10T13:00:00Z')).candidatos.length, 0, 'só 3 dias úteis depois do toque 2');
  assert.equal(L.acq06Candidatos(fila([s1, s2]), c, Date.parse('2026-11-11T13:00:00Z')).candidatos[0].tipo, 'despedida');
  const s3 = { direcao: 'saida', texto: L.acqComTextoDoModelo(C.modelos.despedida, ['pessoal']), enviada_em: '2026-11-11T13:00:00Z' };
  assert.equal(L.acq06Candidatos(fila([s1, s2, s3]), c, Date.parse('2026-11-30T13:00:00Z')).candidatos.length, 0, 'três toques e acabou');
  const semDesp = cfg('test', (e) => { e.comercial.cadencia = { ativa: true, dias_uteis: [3, 4] }; e.comercial.modelos.retomada.aprovado = true; });
  assert.deepEqual(L.acq06Candidatos(fila([s1, s2]), semDesp, Date.parse('2026-11-11T13:00:00Z')).ignorados.map((x) => x.motivo), ['modelo_nao_aprovado:despedida']);
  const esc = L.acq07PedidosEscrita({ mensagem: { wamid: 'w', em: '2026-11-02T13:01:00Z' }, lead: { lead_id: LEADS.pronto, qualificacao: {}, mensagens: [] }, decisao: { motivos: [] }, julgamento: { remetente: 'resposta_automatica' } }, null, null, c, Date.now());
  assert.deepEqual(esc.map((x) => x.argumentos.qualificacao), [{ so_robo: 'sim' }], 'o painel só aceita texto em qualificacao');
  const esc2 = L.acq07PedidosEscrita({ mensagem: { wamid: 'w2', em: '2026-11-02T14:00:00Z' }, lead: { lead_id: LEADS.pronto, qualificacao: { so_robo: true }, mensagens: [] }, decisao: { motivos: [] }, julgamento: { remetente: 'humano' } }, null, null, c, Date.now());
  assert.deepEqual(esc2.map((x) => x.argumentos.qualificacao), [{ so_robo: 'nao' }]);
  assert.equal(L.acq06Candidatos(fila([s1, robo], { so_robo: 'sim' }), c, qui).candidatos[0].tipo, 'retomada', 'marca em texto também vale');
  const pergunta = { direcao: 'saida', texto: 'Rafael aqui, com quem eu falo?', enviada_em: '2026-11-02T13:02:00Z' };
  const pessoa = { direcao: 'entrada', texto: 'Instagram', enviada_em: '2026-11-02T13:01:00Z' };
  const frio = (extra, q) => { const f = fila([s1, pessoa, pergunta], q); Object.assign(f.itens[0], { lead_frio: true }, extra); return f; };
  assert.equal(L.acq06Candidatos(frio(), c, qui).candidatos[0].tipo, 'retomada', 'pessoa que sumiu depois da nossa pergunta entra na cadência');
  assert.equal(L.acq06Candidatos(frio({ em_fechamento: true }), c, qui).candidatos.length, 0, 'em fechamento fica com o Almir');
  assert.equal(L.acq06Candidatos(frio({}, { pausar_retomada: 'sim' }), c, qui).candidatos.length, 0, 'quem pediu tempo não recebe');
  assert.equal(L.acq06Candidatos(frio({ lead_frio: false }), c, qui).candidatos.length, 0, 'só prospecção');
});

test('conversa parada: uma volta dentro da janela, só quando a vez é da pessoa', () => {
  const c = cfg('test', (e) => { e.comercial.continuar = { ativa: true, horas_silencio: 2, janela_max_horas: 23, minutos_resposta: 30 }; });
  const entrou = '2026-11-09T12:44:53Z', saiu = '2026-11-09T12:44:56Z';
  const conversa = [{ direcao: 'saida', texto: 'Oferta do diagnóstico', enviada_em: '2026-11-09T12:40:00Z' }, { direcao: 'entrada', texto: 'Instagram', enviada_em: entrou }, { direcao: 'saida', texto: 'Quem responde lá?', enviada_em: saiu }];
  const fila = (msgs, extra, q) => ({ config: { ativo: true, horario: '09:00 a 18:00', restam_hoje: 0 }, itens: [Object.assign({ lead_id: LEADS.pronto, nome: 'Luxmi', whatsapp: '5541985417260', etapa: 'contato', qualificacao: q || {}, mensagens: msgs, fatos: [] }, extra)] });
  const aos = (iso) => Date.parse(iso);
  const hora = aos('2026-11-09T15:00:00Z');
  assert.equal(L.acq06ConversaParada(fila(conversa), c, hora).tipo, 'continuar', 'mais de 2 h em silêncio');
  assert.equal(L.acq06ConversaParada(fila(conversa), cfg('test'), hora), null, 'desligado por padrão');
  assert.equal(L.acq06ConversaParada(fila(conversa), c, aos('2026-11-09T13:30:00Z')), null, 'menos de 2 h');
  assert.equal(L.acq06ConversaParada(fila(conversa), c, aos('2026-11-10T12:50:00Z')), null, 'passou de 23 h: só modelo');
  assert.equal(L.acq06ConversaParada(fila(conversa.slice(0, 2)), c, hora), null, 'a vez é nossa');
  assert.equal(L.acq06ConversaParada(fila(conversa.concat([{ direcao: 'saida', texto: 'Voltei', enviada_em: '2026-11-09T15:00:00Z' }])), c, aos('2026-11-09T18:00:00Z')), null, 'só uma volta por silêncio');
  assert.equal(L.acq06ConversaParada(fila(conversa, { em_fechamento: true }), c, hora), null, 'em fechamento');
  assert.equal(L.acq06ConversaParada(fila(conversa, {}, { so_robo: 'sim' }), c, hora), null, 'robô');
  assert.equal(L.acq06ConversaParada(fila(conversa, {}, { pausar_retomada: 'sim' }), c, hora), null, 'pediu tempo');
  assert.equal(L.acq06ConversaParada(fila(conversa, { nao_contatar: true }), c, hora), null, 'não contatar');
  assert.equal(L.acq06ConversaParada(fila(conversa), c, aos('2026-11-09T22:30:00Z')), null, 'fora do horário');
  const cand = L.acq06ConversaParada(fila(conversa), c, hora);
  const ao = cfg('test', (e) => { e.comercial.phone_number_id = '123'; });
  const envio = L.acq06EnvioContinuar(cand, { novo: true }, { decisao: 'enviar' }, ao, { ok: true, texto: 'Oi' });
  assert.equal(envio.decisao, 'enviar'); assert.equal(envio.payload.type, 'text');
  assert.equal(L.acq06EnvioContinuar(cand, { novo: true }, { decisao: 'enviar' }, ao, { ok: false, motivo: 'disse_agencia' }).decisao, 'pular', 'texto reprovado não sai');
  assert.equal(L.acq06EnvioContinuar(cand, { novo: false }, { decisao: 'enviar' }, ao, { ok: true, texto: 'Oi' }).decisao, 'pular', 'uma por dia');
  const des = L.acq06Desfecho(envio, { resultado: 'aceita', wamid: 'w' }, { run_id: 'r', agoraMs: hora, hoje: '2026-11-09' });
  assert.equal(des.evento.tipo, 'comercial_continuar_enviada', 'fora da conta de modelos pagos');
  assert.match(des.evento.idempotency_key, /2026-11-09/);
});

test('diagnóstico: pessoa aceitou, entrega com o site do cadastro e sem gravar que ela mandou o link', () => {
  const c = cfg('test');
  const lead = { lead_id: LEADS.pronto, etapa: 'contato', qualificacao: { site: 'https://www.clinicaluxmi.com.br/' }, mensagens: [{ direcao: 'saida', texto: 'Fazemos um diagnóstico gratuito. Posso preparar?' }], fatos: [] };
  const julg = () => ({ remetente: 'humano', intencao: 'interessado', etapa: 'descobrir', objecao: 'nenhuma', p_pare: 0, entendeu_necessidade: true });
  const m = { wamid: 'w', em: '2026-11-09T12:41:48Z', texto: 'Pode enviar por aqui mesmo', de: '5541985417260' };
  const fila = { config: { ativo: true } };
  const agora = Date.parse('2026-11-09T12:42:00Z');
  const d = L.acq07Decidir(m, lead, {}, julg(), fila, c, agora, null);
  assert.equal(d.etapa, 'entregar_diagnostico'); assert.equal(d.entregar_diagnostico, true);
  const semOferta = L.acq07Decidir(m, Object.assign({}, lead, { mensagens: [{ direcao: 'saida', texto: 'Oi' }] }), {}, julg(), fila, c, agora, null);
  assert.equal(semOferta.etapa, 'descobrir', 'sem oferta não há o que entregar');
  const link = L.acq07LinkParaAbrir({ texto: 'Pode enviar' }, lead, d);
  assert.equal(link.do_cadastro, true); assert.equal(link.host, 'www.clinicaluxmi.com.br');
  assert.equal(L.acq07LinkParaAbrir({ texto: 'Pode enviar' }, lead, { etapa: 'descobrir' }), null, 'sem entrega, não abre');
  assert.equal(L.acq07LinkParaAbrir({ texto: '' }, { qualificacao: { site: 'https://instagram.com/x' } }, { etapa: 'continuar' }), null, 'rede social não serve');
  const pagina = L.acq07LerPagina({ body: '<title>Luxmi</title><p>' + 'clínica '.repeat(60) + '</p>', statusCode: 200 }, link);
  assert.match(L.acq07BlocoDaPagina(pagina), /SITE DA EMPRESA/);
  assert.equal(L.acq07BlocoDaPagina({ ok: false, do_cadastro: true, url: 'x', motivo: 'y' }), '', 'site fora do ar não vira assunto');
  const esc = L.acq07PedidosEscrita({ mensagem: { wamid: 'w', em: m.em }, lead, decisao: { motivos: [], intencao: 'interessado' }, julgamento: { remetente: 'humano' }, pagina }, null, null, c, agora);
  assert.equal(esc.filter((x) => x.ferramenta === 'aceleriq_comercial_registrar_fato').length, 0, 'não foi o lead quem mandou o link');
  const pausa = L.acq07PedidosEscrita({ mensagem: { wamid: 'w', em: m.em }, lead, decisao: { motivos: [], intencao: 'nao_agora' }, julgamento: { remetente: 'humano' } }, null, null, c, agora);
  assert.deepEqual(pausa.map((x) => x.argumentos.qualificacao), [{ pausar_retomada: 'sim' }]);
  assert.ok(L.acq07PedidoLLM({ texto: 'x' }, lead, { etapa: 'continuar', faltam: [] }, { config: {} }, c, [], null).messages[0].content.includes('retomar uma única vez'));
});

test('motor de referências: o Jev escolhe as provas do lead e elas entram no texto', () => {
  const c = cfg('test');
  const provas = [
    { id: 'a', titulo: 'Ajenda: da mensagem solta ao horário acompanhado', texto: 'O cliente agenda pelo link sem aplicativo.', empresa: 'Ajenda', link: 'https://aceleriq.com/portfolio/cases/ajenda-processos', nicho: 'salão, barbearia, pilates' },
    { id: 'b', titulo: 'Stop Info: três entradas', texto: 'Três portais de entrada.', empresa: 'Stop Info', link: 'https://aceleriq.com/portfolio/cases/stop-info', nicho: 'assistência técnica, loja' },
    { id: 'c', titulo: 'ACERBI: presença local', texto: 'O perfil chegou a 500 seguidores.', empresa: 'ACERBI', link: 'https://aceleriq.com/portfolio/cases/acerbi', nicho: 'associação' },
  ];
  const m = { wamid: 'w', de: '551998765432', em: new Date(TER_10H).toISOString(), texto: 'tem algum cliente parecido comigo?' };
  const pj = L.acq07PedidoJev(m, { mensagens: [{ direcao: 'entrada', texto: 'tenho um studio de pilates' }] }, provas);
  assert.deepEqual(Object.keys(pj.questions.prova.criteria), ['nenhuma', 'p1', 'p2', 'p3']);
  assert.match(pj.questions.prova.criteria.p1, /serve para: salão, barbearia, pilates/);
  assert.equal(L.acq07PedidoJev(m, { mensagens: [] }, []).questions.prova, undefined, 'sem provas, sem pergunta');
  const jev = { answers: { prova: { choice: 'p1', probabilities: { p1: 0.6, p3: 0.25, p2: 0.1, nenhuma: 0.05 } } } };
  assert.deepEqual(L.acq07ProvasEscolhidas(jev, provas).map((p) => p.id), ['a', 'c']);
  assert.deepEqual(L.acq07ProvasEscolhidas({ answers: { prova: { choice: 'nenhuma', probabilities: { nenhuma: 0.9, p1: 0.1 } } } }, provas), []);
  const fila = { config: { ativo: true, orientacoes: 'Start R$ 847' }, itens: [] };
  const pedido = L.acq07PedidoLLM(m, { nome: 'Ana', etapa: 'contato', qualificacao: {}, mensagens: [] }, { etapa: 'tratar_objecao', faltam: [], provas: L.acq07ProvasEscolhidas(jev, provas) }, fila, c, []);
  assert.match(pedido.messages[0].content, /REFERÊNCIAS QUE COMBINAM/); assert.match(pedido.messages[0].content, /ajenda-processos/);
  const r = (t) => ({ choices: [{ message: { content: JSON.stringify({ mensagens: [t] }) } }] });
  const fonte = 'Start R$ 847\n' + provas.map((p) => p.texto + ' ' + p.link).join('\n');
  assert.equal(L.acq07LerLLM(r('Olha esse caso: https://aceleriq.com/portfolio/cases/ajenda-processos'), c, fonte, { mensagens: [] }).ok, true);
});

test('botão do nosso modelo é pessoa e o texto nunca ecoa o lead', () => {
  const c = cfg('test');
  const fila = { config: { ativo: true }, itens: [] };
  const msg = { wamid: 'w', de: '551998765432', em: new Date(TER_10H).toISOString(), tipo: 'button', botao: 'Quero o diagnóstico', texto: 'Quero o diagnóstico' };
  const j = { intencao: 'interessado', confianca: 1, p_pare: 0, remetente: 'menu_de_robo', etapa: 'descobrir', objecao: 'nenhuma', plano: 'nenhum', entendeu_necessidade: false };
  const d = L.acq07Decidir(msg, { lead_id: 'x', mensagens: [], qualificacao: {} }, null, Object.assign({}, j), fila, c, TER_10H);
  assert.equal(d.modo, 'venda'); assert.equal(d.responder, true); assert.ok(d.motivos.includes('botao_e_pessoa'));
  const r = (m) => ({ choices: [{ message: { content: JSON.stringify({ mensagens: m }) } }] });
  const lead = { mensagens: [{ direcao: 'entrada', texto: '[botão] Quero o diagnóstico' }] };
  assert.equal(L.acq07LerLLM(r(['Quero o diagnóstico']), c, '', lead).motivo, 'eco_do_lead');
  assert.equal(L.acq07LerLLM(r(['Boa, Almir! Me conta: hoje os clientes chegam como?']), c, '', lead).ok, true);
  assert.equal(L.acq07LerLLM(r(['Sim']), c, '', { mensagens: [{ direcao: 'entrada', texto: 'Sim' }] }).ok, true, 'resposta curta igual não é eco');
});

test('teto do mês: prospecção para antes, resposta para no limite, anúncio segue na janela grátis', () => {
  const c = cfg('test');
  assert.deepEqual(L.acqComOrcamento({ atendimento: 100, modelos: 10 }, c), { atendimento: 100, modelos: 10, pode_responder: true, pode_prospectar: true, modelos_restantes: 290 });
  assert.equal(L.acqComOrcamento({ atendimento: 800, modelos: 0 }, c).pode_prospectar, false, 'guarda 200 para quem está conversando');
  assert.equal(L.acqComOrcamento({ atendimento: 800, modelos: 0 }, c).pode_responder, true);
  assert.equal(L.acqComOrcamento({ atendimento: 1000, modelos: 0 }, c).pode_responder, false);
  assert.equal(L.acqComOrcamento({ atendimento: 0, modelos: 300 }, c).pode_prospectar, false);
  const fila = { config: { ativo: true }, itens: [] };
  const msg = { wamid: 'w', de: '551998765432', em: new Date(TER_10H).toISOString(), texto: 'oi' };
  const j = { intencao: 'pergunta', confianca: 0.9, p_pare: 0.02, remetente: 'humano', etapa: 'descobrir', objecao: 'nenhuma', plano: 'nenhum', entendeu_necessidade: true };
  const sem = L.acqComOrcamento({ atendimento: 1000 }, c);
  const d = L.acq07Decidir(msg, { lead_id: 'x', mensagens: [], qualificacao: {} }, null, Object.assign({}, j), fila, c, TER_10H, sem);
  assert.equal(d.responder, false); assert.equal(d.caixa, true); assert.ok(d.motivos.includes('teto_do_mes'));
  assert.equal(L.acq07Decidir(msg, { lead_id: 'x', mensagens: [], qualificacao: { anuncio: { titulo: 'x' } } }, null, Object.assign({}, j), fila, c, TER_10H, sem).responder, true);
  assert.equal(L.acq06Candidatos({ config: { ativo: true, horario: '09:00 a 18:00', restam_hoje: 20 }, itens: [] }, c, TER_10H, { pode_prospectar: false }).motivo, 'teto_do_mes');
});

test('juntar mensagens: só a mais nova responde, levando as anteriores; áudio entra como texto', () => {
  const a = { wamid: 'a', de: '5541999990000', em: '2026-11-03T13:00:00Z', texto: 'oi' };
  const b = { wamid: 'b', de: '5541999990000', em: '2026-11-03T13:00:05Z', texto: 'quanto custa', transcrito: true };
  assert.equal(L.acq07Lote(a, { mais_nova: 'b', mensagens: [{ m: a }, { m: b }] }).seguir, false);
  const l = L.acq07Lote(b, { mais_nova: 'b', mensagens: [{ m: a }, { m: b }] });
  assert.equal(l.seguir, true); assert.equal(l.m.texto, 'oi\nquanto custa'); assert.deepEqual(l.m.wamids, ['a', 'b']);
  assert.equal(L.acq07De8('5541999990000'), L.acq07De8('554199990000'), 'com ou sem o 9');
  assert.equal(L.acq07TextoParaRegistro(b), '[áudio] quanto custa');
  assert.equal(L.acq07LerTranscricao({ choices: [{ message: { content: '[inaudível]' } }] }), null);
  assert.equal(L.acq07LerTranscricao({ choices: [{ message: { content: 'quero saber o preço' } }] }), 'quero saber o preço');
});

test('webhook: áudio traz o id da mídia e anúncio traz a origem', () => {
  const corpo = webhookMeta({ wamid: 'x', de: '5541999990000', quando: TER_10H, tipo: 'audio' });
  corpo.entry[0].changes[0].value.messages[0].referral = { source_type: 'ad', source_id: '123', headline: 'Diagnóstico grátis', source_url: 'https://fb.me/x' };
  const m = L.acq07Normalizar(corpo, null).mensagens[0];
  assert.equal(m.midia_id, 'midia-1'); assert.equal(m.anuncio.titulo, 'Diagnóstico grátis');
});
test('texto do Mercúrio: quebra em mensagens e bloqueia link, preço inventado e a palavra agência', () => {
  const c = cfg('test');
  const r = (t) => ({ choices: [{ message: { content: t } }] });
  const j = (o) => r(JSON.stringify(o));
  assert.equal(L.acq07LerLLM(r('Veja em https://golpe.exemplo agora.'), c, 'orientações sem link').ok, false);
  assert.equal(L.acq07LerLLM(r('Agende em https://aceleriq.com/agenda.'), c, 'Agenda: https://aceleriq.com/agenda').ok, true);
  assert.equal(L.acq07LerLLM(r('   '), c, '').ok, false);
  assert.equal(L.acq07LerLLM({ error: { message: 'sem credencial' } }, c, '').ok, false);
  assert.equal(L.acq07LerLLM(r('x'.repeat(1500)), c, '').ok, false);
  const ok = L.acq07LerLLM(j({ mensagens: ['Oi!', 'Como vocês conseguem clientes hoje?'], horario_escolhido: '2026-11-10T14:00:00.000Z', resumo_para_almir: 'Pet shop.', nome_cobranca: 'Pet LTDA' }), c, '');
  assert.deepEqual(ok.partes, ['Oi!', 'Como vocês conseguem clientes hoje?']);
  assert.equal(ok.horario_escolhido, '2026-11-10T14:00:00.000Z'); assert.equal(ok.nome_cobranca, 'Pet LTDA');
  assert.equal(L.acq07LerLLM(j({ mensagens: ['a', 'b', 'c', 'd', 'e', 'f'] }), c, '').partes.length, 3, 'no máximo 3: cada balão conta no limite da Meta');
  assert.equal(L.acq07LerLLM(j({ mensagens: ['Fica R$ 500 por mês'] }), c, 'Plano: R$ 847 por mês').motivo, 'valor_fora_das_orientacoes');
  assert.equal(L.acq07LerLLM(j({ mensagens: ['Começa em R$ 847 por mês'] }), c, 'Plano: R$ 847 por mês').ok, true);
  assert.equal(L.acq07LerLLM(j({ mensagens: ['Somos uma agência'] }), c, '').motivo, 'disse_agencia');
  assert.equal(L.acq07LerLLM(j({ mensagens: ['Sou o assistente da Aceleriq'] }), c, '').motivo, 'nome_interno');
  assert.equal(L.acq07LerLLM(j({ mensagens: ['Aqui é o Mercúrio'] }), c, '').motivo, 'nome_interno');
  assert.equal(L.acq07LerLLM(j({ mensagens: ['Não sou robô, pode ficar tranquila'] }), c, '').motivo, 'negou_ser_ia', 'nunca nega ser IA');
  assert.equal(L.acq07LerLLM(j({ mensagens: ['Sou uma pessoa de verdade'] }), c, '').motivo, 'negou_ser_ia');
  assert.equal(L.acq07LerLLM(j({ mensagens: ['Sou o Rafael, atendo aqui com apoio de inteligência artificial'] }), c, '').ok, true);
  assert.equal(L.acq07LerLLM(r('{"mensagens":["Oi, Funciona'), c, '').motivo, 'llm_json_quebrado', 'JSON cortado nunca vai para o lead');
  assert.equal(L.acq07LerLLM(j({ mensagens: ['Entendi, R$ 400 por mês não cobre'] }), c, 'Plano: R$ 847', { mensagens: [{ direcao: 'entrada', texto: 'só posso 400' }] }).ok, true, 'pode repetir o valor do lead');
  const pedido = L.acq07PedidoLLM({ wamid: 'w', texto: 'quanto custa?' }, { nome: 'Pet', etapa: 'contato', mensagens: [{ direcao: 'saida', texto: 'modelo' }], fatos: [] },
    { intencao: 'pergunta', etapa: 'apresentar' }, { config: { orientacoes: 'ORIENTACAO-UNICA', conhecimento: [{ titulo: 'SPIN', tecnica: 'TECNICA-UNICA', quando_usar: 'sempre', exemplo: '' }] } }, c);
  assert.match(pedido.messages[0].content, /ORIENTACAO-UNICA/);
  assert.match(pedido.messages[0].content, /TECNICA-UNICA/);
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

const ligarTransporte = (a) => { const t = a.ambientes.test; t.dry_run_por_workflow = { 'ACQ-06': false, 'ACQ-07': false, 'ACQ-08': false }; t.comercial.modelos.repasse_equipe.aprovado = true; t.comercial.phone_number_id = '100000000000001';
  t.comercial.modelos.primeiro_contato.aprovado = true; t.comercial.modelos.retomada.aprovado = true; };
function montar(W, aoVivo, extra) {
  const ws = ['ACQ-00-Ferramenta-Aceleriq', 'ACQ-06-Comercial-Primeiro-Contato', 'ACQ-07-Comercial-Respostas', 'ACQ-08-Comercial-Repasses'].map((n) => (aoVivo || extra) ? comConfig(WF[n], (a) => { if (aoVivo) ligarTransporte(a); if (extra) extra(a); }) : WF[n]);
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
  assert.equal(env.corpo.template.name, 'aceleriq_contato_rafael');
  assert.deepEqual(env.corpo.template.components[0].parameters.map((p) => p.text), ['pessoal', 'Pet Shop Exemplo', 'vocês têm Instagram, mas não encontrei um site próprio da empresa']);
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
const eventoRecebida = (wamid, de, em) => L.acq07EventoEntrada({ wamid, de, em: new Date(em).toISOString(), tipo: 'text', texto: 'x' }, { run_id: 'teste-grupo' });
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

test('ACQ-07 ao vivo: registra a entrada, responde em partes com o wamid de cada uma e não repete', async () => {
  await segredos();
  const W = criarMundo(); conversaAberta(W); W.m.agoraMs = TER_10H;
  W.m.llm.texto = JSON.stringify({ mensagens: ['Que bom que respondeu!', 'Como os clientes chegam até vocês hoje?'], resumo_para_almir: 'Pet shop.' });
  const S = montar(W, true);
  await S.executar('Acq07ComercialRs', 'WhatsApp: mensagens (POST)', postAssinado(msg('wamid.IN1', 'Quero sim, pode preparar o diagnóstico')));
  const ent = W.m.mensagens.filter((x) => x.direcao === 'entrada');
  assert.equal(ent.length, 1); assert.equal(ent[0].id_externo, 'wamid.IN1');
  assert.equal(W.m.handoffs.length, 0, 'interesse o Mercúrio conduz sozinho');
  assert.equal(W.m.llm.chamadas, 1);
  assert.match(W.m.llm.ultimo.messages[0].content, /Diagnóstico gratuito do site/);
  assert.equal(W.m.meta.digitando, 1, 'marca como lida e digitando');
  assert.deepEqual(W.m.meta.enviadas.map((e) => e.corpo.text.body), ['Que bom que respondeu!', 'Como os clientes chegam até vocês hoje?']);
  assert.equal(W.m.meta.enviadas[0].corpo.to, NUM, 'responde no wa_id que escreveu');
  assert.deepEqual(W.m.mensagens.filter((x) => x.direcao === 'saida' && /wamid\.TESTE/.test(x.id_externo)).map((x) => x.id_externo), ['wamid.TESTE1', 'wamid.TESTE2']);
  assert.ok(W.m.chamadas_http.filter((c) => c.url.includes('/llm')).every((c) => c.credencial === 'ACQ OpenRouter (Mercúrio)'));
  assert.ok(W.m.chamadas_http.filter((c) => c.url.includes('/jev')).every((c) => c.credencial === 'TypeSafe Jev (servidor)'));
  await S.executar('Acq07ComercialRs', 'WhatsApp: mensagens (POST)', postAssinado(msg('wamid.IN1', 'Quero sim, pode preparar o diagnóstico')));
  assert.equal(W.m.meta.enviadas.length, 2, 'a Meta reenvia o webhook e nada se repete'); assert.equal(W.m.llm.chamadas, 1);
});

test('ACQ-07: áudio vira texto, chega à conversa e recebe resposta', async () => {
  await segredos();
  const W = criarMundo(); conversaAberta(W); W.m.transcricao = 'quanto custa o plano de vocês';
  const S = montar(W, true);
  await S.executar('Acq07ComercialRs', 'WhatsApp: mensagens (POST)', postAssinado(msg('wamid.AUD', null, { tipo: 'audio' })));
  assert.equal(W.m.mensagens.find((x) => x.id_externo === 'wamid.AUD').texto, '[áudio] quanto custa o plano de vocês');
  assert.ok(W.m.meta.enviadas.length >= 1);
  assert.ok(W.m.chamadas_http.some((c) => c.url.includes('/graph/') && c.url.includes('midia-1')), 'baixou da Meta');
});

test('ACQ-07: mensagens seguidas têm uma resposta só, e a mais antiga não responde', async () => {
  await segredos();
  const W = criarMundo(); conversaAberta(W);
  const S = montar(W, true);
  const agora = Date.now();
  // a segunda chegou enquanto a primeira esperava: a execução da primeira não responde.
  await P.admin.query("select acq_n8n.registrar_evento($1::jsonb, 'test')", [JSON.stringify(eventoRecebida('wamid.NOVA', NUM, agora))]);
  await S.executar('Acq07ComercialRs', 'WhatsApp: mensagens (POST)', postAssinado(msg('wamid.VELHA', 'oi', { quando: agora - 5000 })));
  assert.equal(W.m.llm.chamadas, 0);
  assert.equal(W.m.meta.enviadas.length, 0);
});

test('ACQ-07: quem chama por anúncio vira lead e é atendido; número de cliente só registra', async () => {
  await segredos();
  const W = criarMundo(); const S = montar(W, true);
  const corpo = msg('wamid.AD', 'Oi, vi o anúncio', { de: '5521988887777' });
  corpo.entry[0].changes[0].value.messages[0].referral = { source_type: 'ad', source_id: '9', headline: 'Diagnóstico grátis' };
  await S.executar('Acq07ComercialRs', 'WhatsApp: mensagens (POST)', postAssinado(corpo));
  assert.equal(W.m.entradas_novas[0].anuncio.titulo, 'Diagnóstico grátis');
  assert.equal(W.m.entradas_novas[0].nome_perfil, 'Contato Teste');
  assert.equal(W.m.mensagens.filter((x) => x.id_externo === 'wamid.AD').length, 1);
  assert.ok(W.m.meta.enviadas.length >= 1, 'responde');
  assert.match(W.m.llm.ultimo.messages[0].content, /Chegou por um anúncio/);

  const W2 = criarMundo(); W2.m.numero_de_cliente = true; const S2 = montar(W2, true);
  await S2.executar('Acq07ComercialRs', 'WhatsApp: mensagens (POST)', postAssinado(msg('wamid.CL', 'Oi, é sobre meu post', { de: '5521977776666' })));
  assert.equal(W2.m.meta.enviadas.length, 0); assert.equal(W2.m.llm.chamadas, 0);
});

test('ACQ-07: marca a reunião num horário livre, cria no Google e repassa pronta; dia ocupado não marca', async () => {
  await segredos();
  const W = criarMundo(); conversaAberta(W); W.m.jevExtra = { etapa: 'confirmar_reuniao' };
  W.m.google_busy = [{ start: '2026-11-12T14:00:00Z', end: '2026-11-12T15:00:00Z' }];
  W.m.llm.texto = JSON.stringify({ mensagens: ['Fechado, ficou marcado terça às 11h.', 'O Almir chega sabendo de tudo.'], horario_escolhido: '2026-11-10T14:00:00.000Z', resumo_para_almir: 'Pet shop sem site, quer mais clientes, plano Essencial.' });
  const S = montar(W, true);
  await S.executar('Acq07ComercialRs', 'WhatsApp: mensagens (POST)', postAssinado(msg('wamid.RE', 'Pode ser terça às 11h')));
  assert.deepEqual(W.m.ocupados, [{ inicio: '2026-11-12T14:00:00Z', fim: '2026-11-12T15:00:00Z' }], 'olhou o Google antes');
  assert.match(W.m.llm.ultimo.messages[0].content, /terça, 10\/11, às 11h/);
  assert.equal(W.m.reunioes[0].inicio, '2026-11-10T14:00:00.000Z');
  assert.ok(W.m.google.some((g) => g.url.endsWith('/events') && g.corpo.start.dateTime === '2026-11-10T14:00:00.000Z'), 'criou o evento');
  assert.equal(W.m.handoffs.length, 1);
  assert.equal(W.m.handoffs[0].resumo, 'Pet shop sem site, quer mais clientes, plano Essencial.');
  assert.match(W.m.handoffs[0].proximo_passo, /Reunião marcada para terça, 10\/11, às 11h/);

  const W2 = criarMundo(); conversaAberta(W2); W2.m.jevExtra = { etapa: 'confirmar_reuniao' }; W2.m.dia_ocupado = true; W2.m.llm.texto = W.m.llm.texto;
  await montar(W2, true).executar('Acq07ComercialRs', 'WhatsApp: mensagens (POST)', postAssinado(msg('wamid.RF', 'Pode ser terça às 11h')));
  assert.equal(W2.m.handoffs.length, 0);
  assert.ok(!(W2.m.google || []).some((g) => g.url.endsWith('/events')));
  assert.ok(W2.m.meta.enviadas.some((e) => /acabou de ser ocupado/.test(e.corpo.text.body)));

  const W3 = criarMundo(); conversaAberta(W3); W3.m.jevExtra = { etapa: 'confirmar_reuniao' };
  W3.m.llm.texto = JSON.stringify({ mensagens: ['Combinado'], horario_escolhido: '2026-12-25T14:00:00.000Z' });
  await montar(W3, true).executar('Acq07ComercialRs', 'WhatsApp: mensagens (POST)', postAssinado(msg('wamid.RG', 'Pode ser no natal')));
  assert.equal((W3.m.reunioes || []).length, 0, 'horário fora da lista não marca');
});

test('ACQ-07: plano divergente não gera Pix e vai para o Almir; horário escolhido com despedida marca a reunião', async () => {
  await segredos();
  const W = criarMundo(); conversaAberta(W); W.m.jevExtra = { etapa: 'fechar_agora', plano: 'essencial' };
  W.m.llm.texto = JSON.stringify({ mensagens: ['Fechado, plano de R$ 847.'], nome_cobranca: 'Pet LTDA', plano_combinado: 'start_assistido' });
  W.m.config.orientacoes += ' R$ 847';
  await montar(W, true).executar('Acq07ComercialRs', 'WhatsApp: mensagens (POST)', postAssinado(msg('wamid.PD', 'Pode fechar, CNPJ 11.222.333/0001-81')));
  assert.equal((W.m.cobrancas || []).length, 0, 'não cobra');
  assert.ok(W.m.meta.enviadas.some((e) => /conferir o valor/.test(e.corpo.text.body)));
  assert.match(W.m.handoffs[0].proximo_passo, /plano divergente/);

  const W2 = criarMundo(); conversaAberta(W2); W2.m.jevExtra = { etapa: 'encerrar', escolheu_horario: true };
  W2.m.llm.texto = JSON.stringify({ mensagens: ['Marcado.'], horario_escolhido: '2026-11-10T14:00:00.000Z', resumo_para_almir: 'x' });
  await montar(W2, true).executar('Acq07ComercialRs', 'WhatsApp: mensagens (POST)', postAssinado(msg('wamid.HD', 'pode ser terça, obrigado, até lá', { quando: Date.now() })));
  assert.equal(W2.m.reunioes.length, 1);
});

test('ACQ-07: quem manda áudio recebe áudio; o Pix continua em texto', async () => {
  await segredos();
  const W = criarMundo(); conversaAberta(W); W.m.jevExtra = { etapa: 'fechar_agora', plano: 'start_assistido', quer_google: true };
  W.m.transcricao = 'pode fechar meu cnpj é 11.222.333/0001-81';
  W.m.llm.texto = JSON.stringify({ mensagens: ['Fechado, plano Start.', 'O Google entra como adicional.'], nome_cobranca: 'Pet LTDA', plano_combinado: 'start_assistido' });
  await montar(W, true).executar('Acq07ComercialRs', 'WhatsApp: mensagens (POST)', postAssinado(msg('wamid.AV', null, { tipo: 'audio' })));
  assert.equal(W.m.falas[0].texto, 'Fechado, plano Start. O Google entra como adicional.');
  assert.equal(W.m.falas[0].modelo, 'eleven_v4');
  assert.equal(W.m.meta.midias, 1);
  assert.equal(W.m.meta.enviadas[0].corpo.type, 'audio');
  assert.equal(W.m.meta.enviadas[0].corpo.audio.voice, true);
  assert.ok(W.m.meta.enviadas.some((e) => e.corpo.text && e.corpo.text.body === '000201PIXTESTE'));
  assert.equal(W.m.cobrancas[0].com_google, true);
});

test('ACQ-07: fechamento gera o Pix pelo painel e manda o copia e cola; sem Asaas, passa para o Almir', async () => {
  await segredos();
  const W = criarMundo(); conversaAberta(W); W.m.jevExtra = { etapa: 'fechar_agora', plano: 'start_assistido' };
  W.m.llm.texto = JSON.stringify({ mensagens: ['Fechado, plano Start Assistido.'], nome_cobranca: 'Pet LTDA', plano_combinado: 'start_assistido', resumo_para_almir: 'Fechou.' });
  const S = montar(W, true);
  await S.executar('Acq07ComercialRs', 'WhatsApp: mensagens (POST)', postAssinado(msg('wamid.PX', 'Pode fechar, CNPJ 11.222.333/0001-81')));
  assert.equal(W.m.cobrancas[0].documento, '11222333000181');
  assert.equal(W.m.cobrancas[0].nome, 'Pet LTDA');
  const textos = W.m.meta.enviadas.map((e) => e.corpo.text.body);
  assert.ok(textos.includes('000201PIXTESTE'), 'copia e cola em mensagem própria');
  assert.ok(textos.some((t) => /Pix de R\$ 1394,00/.test(t)));
  assert.ok(!textos.some((t) => /confirmado/i.test(t)), 'nunca diz que foi pago');
  assert.equal(W.m.handoffs.length, 0, 'só repassa depois do Pix confirmado');

  const W2 = criarMundo(); conversaAberta(W2); W2.m.sem_asaas = true; W2.m.jevExtra = { etapa: 'fechar_agora', plano: 'start_assistido' };
  W2.m.llm.texto = W.m.llm.texto;
  await montar(W2, true).executar('Acq07ComercialRs', 'WhatsApp: mensagens (POST)', postAssinado(msg('wamid.PY', 'Pode fechar, CNPJ 11.222.333/0001-81')));
  assert.equal(W2.m.handoffs.length, 1);
  assert.match(W2.m.handoffs[0].proximo_passo, /Fechar com o lead/);
});

test('ACQ-08: repasse vai para o WhatsApp da Aceleriq com o contexto; Pix confirmado também avisa o lead; só marca se a Meta aceitar', async () => {
  const W = criarMundo();
  W.m.repasses = [{ id: 'h1', lead_id: LEADS.pronto, tipo: 'fechou', resumo: 'Fechou o Start. Pix confirmado.', proximo_passo: 'Fazer o onboarding e criar o grupo do cliente.', telefone: NUM, dados: { pagamento_confirmado: true }, commercial_leads: { name: 'Pet', company: 'Pet Shop', whatsapp: NUM } }];
  const S = montar(W, true);
  const rodar = () => S.executar('Acq08ComercialRp', 'Entrada interna', [{ json: { agora: new Date(TER_10H).toISOString() } }]);
  await rodar();
  const [equipe, lead] = W.m.meta.enviadas;
  assert.equal(equipe.corpo.to, '5541997483429');
  assert.equal(equipe.corpo.template.name, 'aceleriq_repasse_equipe');
  assert.deepEqual(equipe.corpo.template.components[0].parameters.map((p) => p.text).slice(0, 2), ['Pix confirmado, fazer onboarding', 'Pet Shop']);
  assert.match(lead.corpo.text.body, /Pagamento confirmado/);
  assert.deepEqual(W.m.repassados, ['h1']);

  const W2 = criarMundo(); W2.m.repasses = W.m.repasses; W2.m.meta.modo = '400';
  await montar(W2, true).executar('Acq08ComercialRp', 'Entrada interna', [{ json: { agora: new Date(TER_10H).toISOString() } }]);
  assert.equal((W2.m.repassados || []).length, 0, 'recusado continua pendente');

  const W3 = criarMundo(); W3.m.repasses = W.m.repasses;
  await montar(W3, false).executar('Acq08ComercialRp', 'Entrada interna', [{ json: { agora: new Date(TER_10H).toISOString() } }]);
  assert.equal(W3.m.meta.enviadas.length, 0, 'em simulação não sai nada'); assert.equal((W3.m.repassados || []).length, 0);
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
  assert.ok(ev.some((e) => e.tipo === 'comercial_escrita_saida_simulada'));
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

test('ACQ-07: painel fora, Jev fora e link inventado não geram resposta', async () => {
  await segredos();
  const W = criarMundo(); conversaAberta(W); const S = montar(W, true);
  W.m.falhas.aceleriq_comercial_entrada_nova = 'erro de teste';
  await S.executar('Acq07ComercialRs', 'WhatsApp: mensagens (POST)', postAssinado(msg('wamid.IN8', 'Oi, quem é?', { de: '5521988887777' })));
  assert.equal(W.m.meta.enviadas.length, 0);
  assert.ok((await incidentes()).some((i) => i.incident_key === 'ACQ-07|sem_lead|88887777'));
  delete W.m.falhas.aceleriq_comercial_entrada_nova;
  W.m.jevFalha = true;
  await S.executar('Acq07ComercialRs', 'WhatsApp: mensagens (POST)', postAssinado(msg('wamid.IN9', 'Quero')));
  assert.equal(W.m.meta.enviadas.length, 0);
  assert.equal(W.m.mensagens.filter((x) => x.id_externo === 'wamid.IN9').length, 1, 'a entrada fica registrada mesmo assim');
  W.m.jevFalha = false; W.m.llm.texto = 'Veja nossos preços em https://site-inventado.exemplo agora.';
  await S.executar('Acq07ComercialRs', 'WhatsApp: mensagens (POST)', postAssinado(msg('wamid.IN10', 'Quanto custa?', { quando: Date.now() })));
  assert.deepEqual(W.m.meta.enviadas.map((e) => e.corpo.text.body), [L.ACQ07_TEXTO_DE_RESERVA], 'o texto bloqueado não sai, e o lead não fica sem resposta');
  assert.ok(W.m.handoffs.some((h) => /bloqueado \(link_fora_das_orientacoes\)/.test(h.proximo_passo)), 'o Almir assume');
  assert.ok((await incidentes()).some((i) => i.incident_key.startsWith('ACQ-07|resposta_nao_redigida|link_fora_das_orientacoes')));
});