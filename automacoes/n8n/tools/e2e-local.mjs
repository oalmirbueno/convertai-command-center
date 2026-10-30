// E2E LOCAL: roda os workflows gerados (ambiente test) no n8n 2.42.7 local, com Postgres real,
// MCP de replay e transporte de teste (127.0.0.1). Tudo é TESTE: nada fala com produção.
// Uso: node tools/e2e-local.mjs [--so ACQ-02]   (precisa do tools/pg-local.mjs rodando)
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { importar, executar, publicarLocal, N8N_DIR } from './n8n-local.mjs';
import { iniciarServidores } from './servidores-teste.mjs';
import { harness } from './harness.mjs';
import { IDS } from '../fixtures/mundo-teste.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SO = (() => { const i = process.argv.indexOf('--so'); return i > 0 ? process.argv[i + 1] : null; })();
const DB = 'acq_e2e';
const PG = { host: '127.0.0.1', port: 54329, user: 'postgres', password: 'teste-local' };
const M = IDS.mirante;
const resultados = [];
let db, srv;

const q = async (sql, p) => (await db.query(sql, p)).rows;
const post = (porta, rota, corpo) => fetch(`http://127.0.0.1:${porta}${rota}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo || {}) }).then((r) => r.json());
const estadoMcp = () => fetch('http://127.0.0.1:8791/__teste/estado').then((r) => r.json());
const enviadas = () => fetch('http://127.0.0.1:8792/__teste/enviadas').then((r) => r.json());

async function limpar() {
  await q(`truncate acq_n8n.eventos, acq_n8n.cursores, acq_n8n.observacoes, acq_n8n.incidentes, acq_n8n.propostas, acq_n8n.saidas, acq_n8n.recibos,
    acq_n8n.mensagens_entrada, acq_n8n.fatos_cliente, acq_n8n.grupos_cliente, acq_n8n.remetentes, acq_n8n.destinos_aprovados restart identity cascade`);
  await post(8791, '/__teste/reset', { agoraMs: Date.now() });
  await post(8792, '/__teste/reset');
}

function resumoExecucao(r) {
  const rd = r.dados && r.dados.data && r.dados.data.resultData;
  return { code: r.code, ms: r.ms, erro: rd && rd.error ? rd.error.message : (r.dados ? null : (r.bruto || '').slice(-600)), ultimo_no: rd && rd.lastNodeExecuted, nos: rd ? Object.keys(rd.runData || {}).length : 0 };
}

async function cenario(wf, nome, fn) {
  if (SO && SO !== wf) return;
  const t0 = Date.now();
  try {
    const evid = await fn();
    resultados.push({ wf, nome, ok: true, ms: Date.now() - t0, evidencia: evid });
    console.log('✔', wf, nome, `(${Math.round((Date.now() - t0) / 1000)}s)`);
  } catch (e) {
    resultados.push({ wf, nome, ok: false, ms: Date.now() - t0, erro: String(e.message || e).slice(0, 1500) });
    console.log('✖', wf, nome, '→', String(e.message || e).slice(0, 400));
  }
}
const espera = (c, m) => { if (!c) throw new Error(m); };

// ------------------------------------------------------------ preparação
async function preparar() {
  const root = new pg.Client({ ...PG, database: 'postgres' }); await root.connect();
  await root.query(`drop database if exists ${DB} with (force)`);
  await root.query(`create database ${DB} encoding 'UTF8' template template0`);
  await root.end();
  db = new pg.Client({ ...PG, database: DB }); await db.connect();
  await db.query(fs.readFileSync(path.join(raiz, 'migrations', '20261014120000_acq_n8n_estado.sql'), 'utf8'));
  srv = await iniciarServidores({ agoraMs: Date.now() });
  const pasta = path.join(N8N_DIR, 'tmp-wf');
  fs.rmSync(pasta, { recursive: true, force: true }); fs.mkdirSync(pasta, { recursive: true });
  for (const f of fs.readdirSync(path.join(raiz, 'workflows-test'))) fs.copyFileSync(path.join(raiz, 'workflows-test', f), path.join(pasta, f));
  const H = [
    harness('AcqTesteH00Ler01', 'ACQ-00-leitura', 'AcqF00Ferramenta', { workflow_id: 'ACQ-01', run_id: 'e2e', ambiente_chamador: 'test', ref: 'a', ferramenta: 'aceleriq_get_agenda_status', argumentos: { client_id: M, days: 14 } }),
    harness('AcqTesteH00Pag01', 'ACQ-00-paginacao', 'AcqF00Ferramenta', { workflow_id: 'ACQ-05', run_id: 'e2e', ambiente_chamador: 'test', ref: 'p', ferramenta: 'aceleriq_list_tasks', paginar: true, argumentos: { client_id: M, only_open: true, limit: 25 } }),
    harness('AcqTesteH00Fora1', 'ACQ-00-fora-allowlist', 'AcqF00Ferramenta', { workflow_id: 'ACQ-02', run_id: 'e2e', ambiente_chamador: 'test', ref: 'f', ferramenta: 'aceleriq_complete_task', argumentos: { task_id: 'x' } }),
    harness('AcqTesteH00Esc01', 'ACQ-00-escrita', 'AcqF00Ferramenta', { workflow_id: 'ACQ-04', run_id: 'e2e', ambiente_chamador: 'test', ref: 'e', ferramenta: 'aceleriq_upsert_project_memory', argumentos: { client_id: M, content: 'nota de teste e2e' } }),
    harness('AcqTesteH01Mira1', 'ACQ-01-Mirante', 'Acq01ContextoRit', { client_id: M, ritual: 'meio_semana' }),
    harness('AcqTesteH03Rec01', 'ACQ-03-reconciliacao', 'Acq03PostNoArPub', { modo: 'reconciliacao' }),
    harness('AcqTesteH05Rec01', 'ACQ-05-reconciliacao', 'Acq05DiaPrioRadr', { modo: 'reconciliacao' }),
    harness('AcqTesteH05Tec01', 'ACQ-05-tecnico', 'Acq05DiaPrioRadr', { modo: 'tecnico' }),
    harness('AcqTesteH05Ter01', 'ACQ-05-terca-Stop', 'Acq05DiaPrioRadr', { modo: 'pauta', data: '2026-10-13' }),
  ];
  for (const h of H) fs.writeFileSync(path.join(pasta, h.id + '.json'), JSON.stringify(h));
  // ACQ-00 é chamado item a item pelos workflows (mode 'each'): os harnesses dele também.
  for (const h of H.filter((x) => x.id.startsWith('AcqTesteH00'))) { h.nodes[2].parameters.mode = 'each'; fs.writeFileSync(path.join(pasta, h.id + '.json'), JSON.stringify(h)); }
  const imp = await importar(pasta, DB);
  await publicarLocal(['AcqE00ErrosComum', 'AcqF00Ferramenta', 'Acq01ContextoRit', 'Acq03PostNoArPub', 'Acq04ConversasCt', 'Acq05DiaPrioRadr']);
  return imp;
}

async function rodarMensagem(id, entrada) {
  const h = harness(id, 'ACQ-04-' + id, 'Acq04ConversasCt', entrada);
  const pasta = path.join(N8N_DIR, 'tmp-wf-msg'); fs.rmSync(pasta, { recursive: true, force: true }); fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, id + '.json'), JSON.stringify(h));
  const { n8n } = await import('./n8n-local.mjs');
  const imp = await n8n(['import:workflow', '--separate', '--input=' + pasta]);
  if (imp.code) throw new Error('import harness ' + imp.stderr.slice(-300));
  return executar(id);
}

// ------------------------------------------------------------ cenários
async function main() {
  console.log('preparando banco, servidores de teste e n8n local…');
  console.log(await preparar());

  // ACQ-00 — adaptador
  await cenario('ACQ-00', 'leitura ok devolve resultado tipado', async () => {
    await limpar();
    const r = resumoExecucao(await executar('AcqTesteH00Ler01'));
    espera(!r.erro, 'execução falhou: ' + r.erro);
    const ch = (await estadoMcp()).chamadas;
    espera(ch.length === 1 && ch[0].ferramenta === 'aceleriq_get_agenda_status', 'uma chamada de leitura');
    return r;
  });
  await cenario('ACQ-00', 'HTTP 200 com error JSON-RPC vira falha (sem quebrar o fluxo)', async () => {
    await limpar(); await post(8791, '/__teste/falhas', { aceleriq_get_agenda_status: 'jsonrpc_error' });
    const ex = await executar('AcqTesteH00Ler01');
    const r = resumoExecucao(ex);
    const out = JSON.stringify(ex.dados || {});
    espera(out.includes('"ok":false') && out.includes('erro interno de teste'), 'resultado deveria trazer ok:false');
    return r;
  });
  await cenario('ACQ-00', '401 vira erro de autenticação', async () => {
    await limpar(); await post(8791, '/__teste/falhas', { aceleriq_get_agenda_status: 'http401' });
    const ex = await executar('AcqTesteH00Ler01');
    espera(JSON.stringify(ex.dados || {}).includes('"tipo":"autenticacao"'), 'tipo autenticacao');
    return resumoExecucao(ex);
  });
  await cenario('ACQ-00', 'paginação lê as 58 tarefas em 3 páginas', async () => {
    await limpar();
    const ex = await executar('AcqTesteH00Pag01');
    const s = JSON.stringify(ex.dados || {});
    const ch = (await estadoMcp()).chamadas.filter((c) => c.ferramenta === 'aceleriq_list_tasks');
    espera(ch.length === 3, 'esperava 3 páginas, houve ' + ch.length);
    espera(s.includes('"paginas_lidas":3'), 'paginas_lidas 3');
    return { paginas: ch.map((c) => c.argumentos.offset), ...resumoExecucao(ex) };
  });
  await cenario('ACQ-00', 'ferramenta fora da allowlist não chega ao MCP', async () => {
    await limpar();
    const ex = await executar('AcqTesteH00Fora1');
    espera((await estadoMcp()).chamadas.length === 0, 'nenhuma chamada');
    espera(JSON.stringify(ex.dados || {}).includes('ferramenta_fora_da_allowlist'), 'motivo');
    return resumoExecucao(ex);
  });

  // ACQ-01 — contexto e rituais
  await cenario('ACQ-01', 'Mirante: propõe contexto, rascunho e pedido de revisão; evento gravado', async () => {
    await limpar();
    const r = resumoExecucao(await executar('AcqTesteH01Mira1'));
    espera(!r.erro, 'falhou: ' + r.erro);
    const props = await q('select tipo, estado from acq_n8n.propostas order by tipo');
    const ev = await q('select tipo, payload from acq_n8n.eventos');
    const esc = (await estadoMcp()).escritas.map((e) => e.ferramenta);
    espera(props.some((p) => p.tipo === 'contexto') && props.some((p) => p.tipo === 'ritual'), 'propostas contexto e ritual');
    espera(esc.includes('aceleriq_upsert_current_dossier') && esc.includes('aceleriq_create_report_draft') && esc.includes('aceleriq_central_review_preparar'), 'escritas no replay: ' + esc);
    espera(ev.length === 1 && ev[0].tipo === 'ritual_propor', 'evento ritual_propor');
    return { propostas: props, escritas: esc, perguntas: ev[0].payload.perguntas.map((p) => p.pergunta), respondidas: ev[0].payload.respondidas };
  });
  await cenario('ACQ-01', 'replay: segunda execução não grava de novo', async () => {
    const antes = (await estadoMcp()).escritas.length;
    const r = resumoExecucao(await executar('AcqTesteH01Mira1'));
    espera(!r.erro, 'falhou: ' + r.erro);
    const depois = (await estadoMcp()).escritas.length;
    const ev = await q('select count(*)::int n from acq_n8n.eventos');
    espera(depois === antes, `escritas mudaram ${antes}→${depois}`);
    espera(ev[0].n === 1, 'evento continua único');
    return { escritas_antes: antes, escritas_depois: depois };
  });
  await cenario('ACQ-01', 'conflito de versão do dossiê: não pede revisão e marca a proposta', async () => {
    await limpar(); await post(8791, '/__teste/falhas', { aceleriq_upsert_current_dossier: 'conflito' });
    const r = resumoExecucao(await executar('AcqTesteH01Mira1'));
    const esc = (await estadoMcp()).escritas.map((e) => e.ferramenta);
    const props = await q("select tipo, estado, motivo from acq_n8n.propostas where tipo in ('contexto','ritual')");
    const ev = await q('select tipo from acq_n8n.eventos');
    espera(!esc.includes('aceleriq_central_review_preparar'), 'não deveria preparar revisão: ' + esc);
    espera(props.every((p) => p.estado === 'conflito_versao'), 'propostas em conflito_versao: ' + JSON.stringify(props));
    espera(ev[0].tipo === 'ritual_conflito_de_versao', 'evento de conflito');
    return { escritas: esc, propostas: props, ...r };
  });
  await cenario('ACQ-01', 'fonte ausente (agenda 500 depois de 3 tentativas): nada é proposto', async () => {
    await limpar(); await post(8791, '/__teste/falhas', { aceleriq_get_agenda_status: 'http500' });
    const r = resumoExecucao(await executar('AcqTesteH01Mira1'));
    const ch = (await estadoMcp()).chamadas.filter((c) => c.ferramenta === 'aceleriq_get_agenda_status').length;
    const esc = (await estadoMcp()).escritas.length;
    const ev = await q('select tipo, payload from acq_n8n.eventos');
    espera(ch === 3, 'leitura tentada 3 vezes, foi ' + ch);
    espera(esc === 0, 'nenhuma escrita');
    espera(ev[0] && ev[0].tipo === 'ritual_fonte_ausente', 'evento fonte_ausente');
    return { tentativas_agenda: ch, ...r };
  });
  await cenario('ACQ-01', 'isolamento: resposta com dado de outro cliente é recusada', async () => {
    await limpar(); await post(8791, '/__teste/falhas', { aceleriq_get_agenda_status: 'outro_cliente' });
    await executar('AcqTesteH01Mira1');
    const ev = await q('select tipo from acq_n8n.eventos');
    espera((await estadoMcp()).escritas.length === 0, 'nenhuma escrita');
    espera(ev[0].tipo === 'ritual_fonte_ausente', 'tratado como fonte ausente');
    return { evento: ev[0].tipo };
  });
  await cenario('ACQ-01', 'ritual já publicado na semana: não cria rascunho', async () => {
    await limpar();
    await post(8791, '/__teste/mundo', { relatorios: { [M]: [{ id: 'r-pub-hoje', project_id: IDS.miranteProjeto, client_id: M, title: 'Meio de semana já enviado', status: 'published', created_at: new Date().toISOString(), metrics: { ritual_type: 'meio_semana', sent_channel: 'portal' } }] } });
    await executar('AcqTesteH01Mira1');
    const esc = (await estadoMcp()).escritas.length;
    const ev = await q('select tipo from acq_n8n.eventos');
    espera(esc === 0 && ev[0].tipo === 'ritual_ja_publicado', 'ja_publicado sem escrita');
    return { evento: ev[0].tipo };
  });

  // ACQ-02 — despacho
  const aprovado = (extra = {}) => ({ fila: { esperando_decisao: [], rascunhos_sem_pedido: [], enviados_recentes: [], aprovados_para_enviar: [Object.assign({ approval_id: 'aaaa0000-0000-4000-8000-0000000000b1', report_id: 'r1', client_id: M, cliente: 'Mirante', titulo: 'Meio de semana', ritual: 'meio_semana',
    mensagem: 'Mensagem aprovada de teste', proximo_passo: 'Próximo passo de teste', destino: 'Grupo TESTE Mirante', payload_version: 1, payload_hash: 'd'.repeat(64), valid_until: new Date(Date.now() + 3 * 86400000).toISOString() }, extra)] } });
  const destino = () => q("insert into acq_n8n.destinos_aprovados (client_id, canal, provedor, rotulo, destino_tecnico, aprovado_por, aprovado_em, evidencia) values ($1,'teste','teste','Grupo TESTE Mirante','grupo-teste-001','e2e',now(),'destino de teste')", [M]);
  await cenario('ACQ-02', 'aprovado → claim → transporte de teste → recibo → registro no painel', async () => {
    await limpar(); await destino(); await post(8791, '/__teste/mundo', aprovado());
    const r = resumoExecucao(await executar('Acq02DespachoApr'));
    espera(!r.erro, 'falhou: ' + r.erro);
    const env = (await enviadas()).enviadas; const s = await q('select estado, provider_message_id, painel_registrado_em, tentativas from acq_n8n.saidas');
    const esc = (await estadoMcp()).escritas.map((e) => e.ferramenta);
    espera(env.length === 1, 'uma mensagem saiu'); espera(s[0].estado === 'aceita' && s[0].painel_registrado_em, 'aceita e registrada: ' + JSON.stringify(s));
    espera(esc.filter((x) => x === 'aceleriq_central_review_marcar_enviado').length === 1, 'marcar_enviado uma vez');
    return { enviadas: env.length, saida: s[0], escritas: esc };
  });
  await cenario('ACQ-02', 'replay: segunda execução não reenvia', async () => {
    const r = resumoExecucao(await executar('Acq02DespachoApr'));
    espera(!r.erro, 'falhou: ' + r.erro);
    espera((await enviadas()).enviadas.length === 1, 'continua uma');
    return r;
  });
  await cenario('ACQ-02', 'concorrência: duas execuções simultâneas, um único envio', async () => {
    await limpar(); await destino(); await post(8791, '/__teste/mundo', aprovado());
    const [a, b] = await Promise.all([executar('Acq02DespachoApr'), executar('Acq02DespachoApr')]);
    const env = (await enviadas()).enviadas.length;
    const s = await q('select estado, tentativas from acq_n8n.saidas');
    espera(env === 1, 'enviadas: ' + env); espera(s.length === 1 && s[0].tentativas === 1, 'uma tentativa: ' + JSON.stringify(s));
    return { execucoes: [resumoExecucao(a), resumoExecucao(b)], enviadas: env };
  });
  await cenario('ACQ-02', 'aprovação vencida é bloqueada', async () => {
    await limpar(); await destino(); await post(8791, '/__teste/mundo', aprovado({ valid_until: new Date(Date.now() - 3600000).toISOString() }));
    await executar('Acq02DespachoApr');
    const s = await q('select estado, motivo from acq_n8n.saidas');
    espera((await enviadas()).enviadas.length === 0 && s[0].estado === 'bloqueada' && s[0].motivo === 'aprovacao_vencida', JSON.stringify(s));
    return s[0];
  });
  await cenario('ACQ-02', 'payload alterado entre a fila e a revalidação invalida o envio', async () => {
    await limpar(); await destino(); await post(8791, '/__teste/mundo', aprovado()); await post(8791, '/__teste/falhas', { aceleriq_central_review_fila: 'mudar_na_releitura' });
    await executar('Acq02DespachoApr');
    const s = await q('select estado, motivo from acq_n8n.saidas');
    espera((await enviadas()).enviadas.length === 0 && s[0].estado === 'invalidada', JSON.stringify(s));
    return s[0];
  });
  await cenario('ACQ-02', 'destino sem mapeamento técnico aprovado é bloqueado', async () => {
    await limpar(); await post(8791, '/__teste/mundo', aprovado());
    await executar('Acq02DespachoApr');
    const s = await q('select estado, motivo from acq_n8n.saidas');
    espera((await enviadas()).enviadas.length === 0 && s[0].motivo === 'destino_desconhecido', JSON.stringify(s));
    return s[0];
  });
  await cenario('ACQ-02', 'provedor recusa antes de aceitar: falhou, sem registro no painel, incidente', async () => {
    await limpar(); await destino(); await post(8791, '/__teste/mundo', aprovado()); await post(8792, '/__teste/modo', { modo: 'rejeitar' });
    await executar('Acq02DespachoApr');
    const s = await q('select estado from acq_n8n.saidas'); const i = await q('select incident_key from acq_n8n.incidentes');
    espera(s[0].estado === 'falhou' && i.length === 1 && !(await estadoMcp()).escritas.length, JSON.stringify({ s, i }));
    return { saida: s[0], incidentes: i };
  });
  await cenario('ACQ-02', 'aceitou e a resposta se perdeu (502): envio_incerto e nunca reenvia', async () => {
    await limpar(); await destino(); await post(8791, '/__teste/mundo', aprovado()); await post(8792, '/__teste/modo', { modo: 'aceitar_e_cair' });
    await executar('Acq02DespachoApr');
    await post(8792, '/__teste/modo', { modo: 'aceitar' });
    await executar('Acq02DespachoApr');
    const s = await q('select estado from acq_n8n.saidas'); const tr = await enviadas();
    espera(s[0].estado === 'envio_incerto' && tr.tentativas === 1, JSON.stringify({ s, tentativas: tr.tentativas }));
    return { saida: s[0], tentativas_no_provedor: tr.tentativas };
  });
  await cenario('ACQ-02', 'painel fora depois do aceite: retoma só o registro', async () => {
    await limpar(); await destino(); await post(8791, '/__teste/mundo', aprovado()); await post(8791, '/__teste/painel-fora', { fora: true });
    await executar('Acq02DespachoApr');
    const s1 = await q('select estado, painel_registrado_em, painel_tentativas from acq_n8n.saidas');
    await post(8791, '/__teste/painel-fora', { fora: false });
    await executar('Acq02DespachoApr');
    const s2 = await q('select estado, painel_registrado_em, painel_tentativas from acq_n8n.saidas');
    const tr = await enviadas();
    espera(s1[0].estado === 'aceita' && !s1[0].painel_registrado_em, 'primeira: aceita sem registro ' + JSON.stringify(s1));
    espera(s2[0].painel_registrado_em && tr.enviadas.length === 1, 'segunda: registrou sem reenviar ' + JSON.stringify(s2));
    return { antes: s1[0], depois: s2[0], enviadas: tr.enviadas.length };
  });

  // ACQ-03 — post no ar
  const novaPub = (minAtras, extra = {}) => {
    const t = new Date(Date.now() - minAtras * 60000).toISOString();
    const pubId = extra.id || 'pub-nova-' + minAtras;
    const permalink = extra.permalink || 'https://www.instagram.com/p/TESTE' + minAtras + '/';
    return { pub: { id: pubId, project_id: IDS.miranteProjeto, external_account_id: IDS.miranteIG, platform: 'instagram', status: 'published', published_at: t, scheduled_at: t, permalink,
      account: { id: IDS.miranteIG, platform: 'instagram', handle: '@miranteluzfloripa', status: 'active' } },
      post: { client_id: M, media_id: 'media-' + pubId, media_type: 'IMAGE', permalink, posted_at: t, reach: 3, captured_at: new Date().toISOString(), external_account_id: IDS.miranteIG } };
  };
  async function publicar(lista) {
    const est = await estadoMcp(); void est;
    const cal = lista.map((x) => ({ kind: 'editorial_post', calendar_date: x.pub.published_at.slice(0, 10), project: { id: IDS.miranteProjeto, name: 'Mirante' },
      post: { id: 'post-' + x.pub.id, title: 'Post de teste ' + x.pub.id, content_type: 'static', objective: 'Mostra como consultar datas e hóspedes.', publications: [x.pub] } }));
    await post(8791, '/__teste/mundo', { calendario: { [M]: cal }, posts: { [M]: lista.map((x) => x.post) } });
  }
  await cenario('ACQ-03', 'primeira ativação inicializa o cursor sem anunciar o histórico', async () => {
    await limpar();
    const r = resumoExecucao(await executar('Acq03PostNoArPub'));
    espera(!r.erro, 'falhou: ' + r.erro);
    const ev = await q('select tipo, payload from acq_n8n.eventos'); const p = await q('select * from acq_n8n.propostas');
    espera(ev.some((e) => e.tipo === 'cursor_inicializado') && p.length === 0, JSON.stringify(ev));
    return { eventos: ev.map((e) => e.tipo), historico_ignorado: ev[0].payload.historico_ignorado };
  });
  await cenario('ACQ-03', 'publicação nova comprovada → captura (fixture) → aviso aguardando extensão da revisão', async () => {
    await publicar([novaPub(10)]);
    const r = resumoExecucao(await executar('Acq03PostNoArPub'));
    espera(!r.erro, 'falhou: ' + r.erro);
    const p = await q("select estado, conteudo from acq_n8n.propostas where tipo = 'aviso_publicacao'");
    espera(p.length === 1 && p[0].estado === 'aguardando_extensao_revisao', JSON.stringify(p.map((x) => x.estado)));
    espera(p[0].conteudo.captura.fixture === true && p[0].conteudo.afirma_crescimento === false, 'captura marcada como fixture e sem crescimento');
    return { mensagem: p[0].conteudo.mensagem, captura: p[0].conteudo.captura, platform_media_id: p[0].conteudo.platform_media_id };
  });
  await cenario('ACQ-03', 'replay não reanuncia', async () => {
    await executar('Acq03PostNoArPub');
    const n = (await q("select count(*)::int n from acq_n8n.propostas where tipo = 'aviso_publicacao'"))[0].n;
    espera(n === 1, 'continua 1: ' + n);
    return { avisos: n };
  });
  await cenario('ACQ-03', 'captura em tela de login falha explicitamente', async () => {
    await publicar([novaPub(5, { id: 'pub-login' })]);
    await post(8791, '/__teste/mundo', { captura: { url: 'https://www.instagram.com/accounts/login/', titulo: 'Log in', file_id: 'x' } });
    await executar('Acq03PostNoArPub');
    const p = await q("select estado, motivo from acq_n8n.propostas where referencia = 'pub-login'");
    espera(p[0] && p[0].estado === 'bloqueada' && p[0].motivo === 'captura_tela_de_login', JSON.stringify(p));
    return p[0];
  });
  await cenario('ACQ-03', 'permalink de outra conta vai para revisão', async () => {
    const x = novaPub(3, { id: 'pub-cruzada' }); x.post.external_account_id = IDS.cmeIG;
    await publicar([x]);
    await executar('Acq03PostNoArPub');
    const ev = await q("select tipo, payload from acq_n8n.eventos where entity_id = 'pub-cruzada'");
    espera(ev[0] && ev[0].tipo === 'publicacao_em_revisao' && ev[0].payload.motivo === 'permalink_de_outra_conta', JSON.stringify(ev));
    return ev[0].payload;
  });
  await cenario('ACQ-03', 'reconciliação diária encaminha exceções ao ACQ-05', async () => {
    await limpar();
    const r = resumoExecucao(await executar('AcqTesteH03Rec01'));
    espera(!r.erro, 'falhou: ' + r.erro);
    const ev = await q("select client_id, payload->>'tipo' tipo from acq_n8n.eventos where tipo = 'excecao_editorial'");
    espera(ev.some((e) => e.tipo === 'prontas_sem_data' && e.client_id === M), JSON.stringify(ev));
    return ev;
  });

  // ACQ-04 — conversas
  const seed04 = async () => {
    await q("insert into acq_n8n.grupos_cliente (provedor, group_id, client_id, rotulo, leitura_liberada, aprovado_por, aprovado_em) values ('teste','g-mirante',$1,'Grupo TESTE Mirante',true,'e2e',now()), ('teste','g-outro',$2,'Grupo TESTE Outro',true,'e2e',now())", [M, IDS.outro]);
    await q("insert into acq_n8n.remetentes (provedor, remetente, client_id, papel, nome) values ('teste','5500000000001',$1,'cliente_decisor','Decisora (teste)'), ('teste','bot-aceleriq',null,'bot','Bot')", [M]);
    await q(`insert into acq_n8n.propostas (workflow_id, client_id, tipo, referencia, idempotency_key, conteudo, hash, ambiente) values ('ACQ-01',$1,'contexto','meio_semana:teste','seed-04-0001',
      '{"perguntas":[{"id":"q_pautas","pergunta":"As pautas prontas sem data já foram aprovadas pela cliente para agendamento?"}]}','h','test')`, [M]);
  };
  const msg = (id, texto, extra = {}) => ({ provedor: 'teste', mensagem: Object.assign({ id, grupo: 'g-mirante', de: '5500000000001', em: new Date().toISOString(), tipo: 'texto', texto }, extra) });
  await cenario('ACQ-04', 'resposta a pergunta aberta vira proposta de contexto e fato', async () => {
    await limpar(); await seed04();
    const r = resumoExecucao(await rodarMensagem('AcqTesteM0400001', msg('m-1', 'Aprovei as pautas, podem agendar.')));
    const m = await q('select estado, motivo from acq_n8n.mensagens_entrada'); const p = await q("select tipo from acq_n8n.propostas where workflow_id = 'ACQ-04'");
    espera(m[0].estado === 'em_revisao' && /possivel_autorizacao/.test(m[0].motivo), 'autorização vai para revisão: ' + JSON.stringify(m));
    return { mensagem: m[0], propostas: p, ...r };
  });
  await cenario('ACQ-04', 'mensagem duplicada não é processada de novo', async () => {
    const r = resumoExecucao(await rodarMensagem('AcqTesteM0400001', msg('m-1', 'Aprovei as pautas, podem agendar.')));
    const n = (await q('select count(*)::int n from acq_n8n.mensagens_entrada'))[0].n;
    const ev = (await q("select count(*)::int n from acq_n8n.eventos where workflow_id = 'ACQ-04'"))[0].n;
    espera(n === 1 && ev === 1, `mensagens ${n}, eventos ${ev}`);
    return r;
  });
  await cenario('ACQ-04', 'informação útil vira proposta; evento atrasado não sobrescreve fato', async () => {
    await limpar(); await seed04();
    await rodarMensagem('AcqTesteM0400002', msg('m-2', 'Ainda não aprovei as pautas, vejo no fim de semana.'));
    const antigo = new Date(Date.now() - 2 * 3600000).toISOString();
    await rodarMensagem('AcqTesteM0400003', msg('m-3', 'As pautas estão liberadas, pode agendar.', { em: antigo }));
    const f = await q('select chave, valor, occurred_at from acq_n8n.fatos_cliente');
    const props = await q("select referencia, estado from acq_n8n.propostas where workflow_id = 'ACQ-04'");
    return { fatos: f, propostas: props };
  });
  await cenario('ACQ-04', 'mensagem do bot é descartada; remetente desconhecido e grupo de outro cliente vão para revisão', async () => {
    await limpar(); await seed04();
    await rodarMensagem('AcqTesteM0400004', msg('m-bot', 'Mensagem automática', { de: 'bot-aceleriq' }));
    await rodarMensagem('AcqTesteM0400005', msg('m-desc', 'Oi, sou novo aqui', { de: '5599999999999' }));
    await rodarMensagem('AcqTesteM0400006', msg('m-cruz', 'Aprovado', { grupo: 'g-outro' }));
    const m = await q('select provider_message_id, estado, motivo, client_id from acq_n8n.mensagens_entrada order by provider_message_id');
    const porId = Object.fromEntries(m.map((x) => [x.provider_message_id, x]));
    espera(porId['m-bot'].estado === 'descartada', 'bot');
    espera(porId['m-desc'].estado === 'em_revisao' && porId['m-desc'].motivo === 'remetente_desconhecido', 'desconhecido');
    espera(porId['m-cruz'].estado === 'em_revisao' && porId['m-cruz'].client_id === IDS.outro, 'cruzado');
    return m;
  });
  await cenario('ACQ-04', 'áudio ilegível fica pendente para pessoa', async () => {
    await limpar(); await seed04();
    const e = msg('m-audio', null, { tipo: 'audio', media_id: 'media-teste-1' }); e.transcricao_fixture = { status: 'ilegivel', media: 'audio-teste' };
    await rodarMensagem('AcqTesteM0400007', e);
    const m = await q('select estado, motivo, transcricao_status from acq_n8n.mensagens_entrada');
    espera(m[0].transcricao_status === 'ilegivel' && m[0].estado === 'em_revisao', JSON.stringify(m));
    return m[0];
  });
  await cenario('ACQ-04', '"Pode fazer." sem objeto nunca aprova; pedido vai para a Mesa por handoff', async () => {
    await limpar(); await seed04();
    await rodarMensagem('AcqTesteM0400008', msg('m-pode', 'Pode fazer.'));
    await rodarMensagem('AcqTesteM0400009', msg('m-pedido', 'Vocês conseguem criar um post sobre o feriado?'));
    const m = await q('select provider_message_id, estado, motivo from acq_n8n.mensagens_entrada order by provider_message_id');
    const esc = (await estadoMcp()).escritas.map((x) => x.ferramenta);
    return { mensagens: m, escritas: esc };
  });

  // ACQ-05 — Dia Prioritário e radar
  await cenario('ACQ-05', 'pauta do dia com até três ações; segunda rodada igual não gera nada', async () => {
    await limpar();
    const r = resumoExecucao(await executar('Acq05DiaPrioRadr'));
    espera(!r.erro, 'falhou: ' + r.erro);
    const p1 = await q("select client_id, conteudo from acq_n8n.propostas where tipo = 'pauta_dia'");
    await executar('Acq05DiaPrioRadr');
    const p2 = await q("select count(*)::int n from acq_n8n.propostas where tipo = 'pauta_dia'");
    espera(p1.length >= 1 && p2[0].n === p1.length, `primeira ${p1.length}, depois ${p2[0].n}`);
    const mirante = p1.find((x) => x.client_id === M);
    espera(mirante && mirante.conteudo.acoes.length <= 3, 'até 3 ações');
    return { clientes: p1.map((x) => x.client_id), acoes_mirante: mirante.conteudo.acoes.map((a) => a.titulo), avisos: mirante.conteudo.avisos };
  });
  await cenario('ACQ-05', 'novidade relevante gera nova pauta', async () => {
    await post(8791, '/__teste/mundo', { agenda: { [M]: { scheduled: [{ publication_id: 'nova', post_id: 'p', platform: 'instagram', scheduled_at: new Date(Date.now() + 86400000).toISOString() }], published_last_7_days: [], ready_without_date: [], without_art: [] } } });
    await executar('Acq05DiaPrioRadr');
    const n = (await q("select count(*)::int n from acq_n8n.propostas where tipo = 'pauta_dia' and client_id = $1", [M]))[0].n;
    espera(n === 2, 'esperava 2 versões da pauta: ' + n);
    return { versoes: n };
  });
  await cenario('ACQ-05', 'reconciliação das 17h sem inferir contato', async () => {
    const r = resumoExecucao(await executar('AcqTesteH05Rec01'));
    espera(!r.erro, 'falhou: ' + r.erro);
    const p = await q("select conteudo from acq_n8n.propostas where tipo = 'reconciliacao_dia' and client_id = $1", [M]);
    espera(p[0] && p[0].conteudo.reconciliacao.contato.registrado === false, JSON.stringify(p[0] && p[0].conteudo.reconciliacao));
    return p[0].conteudo.reconciliacao;
  });
  await cenario('ACQ-05', 'terça: Stop provisório marcado; Para Si fora', async () => {
    await limpar();
    await executar('AcqTesteH05Ter01');
    const p = await q("select client_id, conteudo from acq_n8n.propostas where tipo = 'pauta_dia'");
    const stop = p.find((x) => x.client_id === IDS.stop);
    espera(stop && stop.conteudo.avisos.some((a) => /provisório/.test(a)), 'Stop provisório');
    espera(!p.some((x) => x.client_id === IDS.paraSi), 'Para Si fora');
    return { clientes: p.map((x) => x.client_id), avisos_stop: stop.conteudo.avisos };
  });
  await cenario('ACQ-05', 'verificação técnica: Hermes sem sinal vira incidente; repetido não renotifica; normalizado resolve', async () => {
    await limpar();
    await executar('AcqTesteH05Tec01');
    const i1 = await q("select incident_key, ocorrencias, estado from acq_n8n.incidentes where incident_key like '%hermes%'");
    await executar('AcqTesteH05Tec01');
    const i2 = await q("select ocorrencias from acq_n8n.incidentes where incident_key like '%hermes%'");
    await post(8791, '/__teste/mundo', { board: { resumo: { incidentes: 0, execucoes_sem_heartbeat: 0 }, operadores: [{ slug: 'augusto', nome: 'Augusto', situacao: 'active', ultima_execucao: new Date().toISOString() }] } });
    await executar('AcqTesteH05Tec01');
    const i3 = await q("select estado from acq_n8n.incidentes where incident_key like '%hermes%'");
    espera(i1.length === 1 && i2[0].ocorrencias === 2 && i3[0].estado === 'resolvido', JSON.stringify({ i1, i2, i3 }));
    return { primeiro: i1[0], repetido: i2[0], depois: i3[0] };
  });

  const ok = resultados.filter((r) => r.ok).length;
  console.log(`\n${ok}/${resultados.length} cenários ok`);
  fs.writeFileSync(path.join(raiz, 'piloto', 'e2e-local-resultado.json'), JSON.stringify({ executado_em: new Date().toISOString(), n8n: '2.42.7 (local)', ambiente: 'test (fixtures, 127.0.0.1)', cenarios: resultados }, null, 2) + '\n');
  await srv.parar(); await db.end();
}
main().catch(async (e) => { console.error('ERRO GERAL', e); try { await srv?.parar(); await db?.end(); } catch {} process.exit(1); });
