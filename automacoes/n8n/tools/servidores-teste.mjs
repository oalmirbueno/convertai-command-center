// SERVIDORES DE TESTE — só 127.0.0.1, dados de fixture, nada real.
//  - MCP de replay (porta 8791): JSON-RPC igual ao MCP Aceleriq 2.9.0 para as ferramentas da
//    allowlist, com injeção de falhas e registro das escritas.
//  - Transporte de teste (porta 8792): finge um provedor de mensagens (aceita, recusa, demora,
//    aceita e perde a resposta) e registra o que "saiu".
// Uso: node tools/servidores-teste.mjs  |  ou importe iniciarServidores() nos testes.
import http from 'node:http';
import { criarMundo, IDS } from '../fixtures/mundo-teste.mjs';

const json = (res, st, obj) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const lerCorpo = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch { ok({ __invalido: b }); } }); });
const pageMeta = (total, limit, offset) => ({ total, limit, offset, has_more: offset + limit < total, next_offset: offset + limit < total ? offset + limit : null });
const DIAS = { 1: 'segunda-feira', 2: 'terça-feira', 3: 'quarta-feira', 4: 'quinta-feira', 5: 'sexta-feira' };

export function criarMcpReplay(estado, fabrica = criarMundo) {
  const M = () => estado.mundo;
  const err = (msg) => { const e = new Error(msg); e.rpc = -32603; throw e; };
  const idem = (nome, key, fn) => {
    const k = nome + '|' + key;
    if (estado.idem[k]) return { ...estado.idem[k], replay: true };
    const r = fn(); estado.idem[k] = r; return r;
  };
  const escrever = (nome, args, r) => { M().escritas.push({ ferramenta: nome, argumentos: args, resultado: r, em: new Date().toISOString() }); return r; };
  const prep = (cid) => {
    const c = M().clientes[cid] || {};
    const hoje = new Date(M().agoraMs).toISOString().slice(0, 10);
    const t = (M().tarefas[cid] || []).filter((x) => !['done', 'archived', 'cancelled'].includes(x.status));
    const atr = t.filter((x) => x.due_date && x.due_date < hoje).sort((a, b) => a.due_date.localeCompare(b.due_date));
    const rit = (M().memoria[cid] || []).filter((m) => m.kind === 'ritual')[0];
    return { client_id: cid, nome: c.nome, dia: DIAS[c.dia] || null, situacao: c.situacao, tarefas_abertas: t.length,
      atrasadas: atr.slice(0, 8).map((x) => ({ titulo: x.title, prazo: x.due_date, status: x.status })), desta_semana: [], captacoes: [],
      ultimos_registros: M().registrosDia?.[cid] || [], ultimo_ritual: rit ? { titulo: rit.title, quando: rit.created_at } : null,
      dossie_resumo: M().dossies[cid]?.summary || null };
  };
  const ferramentas = {
    aceleriq_dia_prioritario: (a) => {
      const cs = M().clientes;
      const dist = [1, 2, 3, 4, 5].map((d) => ({ dia: d, nome: DIAS[d], clientes: Object.entries(cs).filter(([, c]) => c.dia === d && c.situacao !== 'nao_aplicavel').map(([id, c]) => ({ client_id: id, nome: c.nome, situacao: c.situacao })) }));
      const dow = a.data ? new Date(a.data + 'T12:00:00Z').getUTCDay() : new Date(M().agoraMs - 3 * 3600000).getUTCDay();
      const alvos = a.client_id ? [a.client_id] : Object.entries(cs).filter(([, c]) => c.dia === dow && c.situacao !== 'nao_aplicavel').map(([id]) => id);
      return { hoje: new Date(M().agoraMs).toISOString().slice(0, 10), clientes_do_dia: a.client_id ? [] : alvos, preparacao: alvos.map(prep), distribuicao: dist,
        sem_dia_por_nao_se_aplicar: Object.entries(cs).filter(([, c]) => c.situacao === 'nao_aplicavel').map(([id, c]) => ({ client_id: id, nome: c.nome })) };
    },
    aceleriq_get_current_dossier: (a) => {
      const d = M().dossies[a.client_id];
      return d ? { current: { client_id: a.client_id, dossier_type: 'contexto', ...d }, current_version: d.version, history: [] } : { current: null, current_version: 0, history: [] };
    },
    aceleriq_get_project_memory: (a) => {
      const it = (M().memoria[a.client_id] || []).filter((m) => !a.kind || m.kind === a.kind).map((m) => ({ ...m, client_id: a.client_id }));
      return { count: it.length, items: it.slice(0, a.limit || 50) };
    },
    aceleriq_get_agenda_status: (a) => {
      const g = M().agenda[a.client_id] || { scheduled: [], published_last_7_days: [], ready_without_date: [], without_art: [] };
      const diag = g.scheduled.length === 0 && g.ready_without_date.length ? `conteúdo pronto na gaveta: ${g.ready_without_date.length} pauta(s) pronta(s) sem data e nada agendado nos próximos ${a.days || 14} dias.` : 'agenda de teste';
      return { client_id: a.client_id, days: a.days || 14, ...g, covered_until: null, diagnosis: diag };
    },
    aceleriq_list_reports: (a) => {
      const all = (M().relatorios[a.client_id] || []).slice().sort((x, y) => y.created_at.localeCompare(x.created_at));
      const lim = a.limit || 25, off = a.offset || 0;
      return { items: all.slice(off, off + lim).map(({ metrics, review_version, ...lite }) => lite), ...pageMeta(all.length, lim, off) };
    },
    aceleriq_get_report: (a) => {
      const r = Object.values(M().relatorios).flat().find((x) => x.id === a.report_id);
      if (!r) err('report not found');
      return { report: r };
    },
    aceleriq_central_review_fila: () => JSON.parse(JSON.stringify(M().fila)),
    aceleriq_list_editorial_calendar: (a) => {
      let it = (M().calendario[a.client_id] || []).map((x) => ({ ...x, client_id: a.client_id }));
      if (a.publication_status) it = it.filter((x) => (x.post?.publications || []).some((p) => p.status === a.publication_status));
      const lim = a.limit || 25, off = a.offset || 0;
      return { items: it.slice(off, off + lim), ...pageMeta(it.length, lim, off) };
    },
    aceleriq_list_social_posts: (a) => { const p = M().posts[a.client_id] || []; return { posts: p.slice(0, a.limit || 25), top_posts: p.slice(0, 5) }; },
    aceleriq_get_social_metrics: () => ({ semanas: [] }),
    aceleriq_list_tasks: (a) => {
      let t = (M().tarefas[a.client_id] || []);
      if (a.only_open) t = t.filter((x) => !['done', 'archived', 'cancelled'].includes(x.status));
      const lim = Math.min(a.limit || 25, 500), off = a.offset || 0;
      return { items: t.slice(off, off + lim), ...pageMeta(t.length, lim, off) };
    },
    aceleriq_operator_board: () => JSON.parse(JSON.stringify(M().board)),
    aceleriq_operator_digest: () => ({ dias: 7, grupos: [], trilha_completa: true }),
    aceleriq_operator_diary: (a) => (a.body ? escrever('aceleriq_operator_diary', a, { ok: true }) : { entradas: [] }),
    aceleriq_mesa_ads_saude: (a) => M().ads[a.client_id] || { auditoria: null, memoria: null },
    aceleriq_browser_session: (a) => (['estado', 'acoes'].includes(a.acao) ? { sessao: null, acao: a.acao } : escrever('aceleriq_browser_session', a, { ok: true, sessao: 'teste' })),
    aceleriq_browser_act: (a) => escrever('aceleriq_browser_act', a, M().captura || { url: 'https://www.instagram.com/' + String(a.url || '').split('instagram.com/')[1], titulo: 'perfil (FIXTURE)', file_id: 'fixture-captura-0001', fixture: true }),
    aceleriq_upload_file_inline: (a) => idem('upload', a.idempotency_key, () => escrever('aceleriq_upload_file_inline', a, { file_id: 'fixture-arquivo-' + Object.keys(estado.idem).length })),
    aceleriq_upsert_current_dossier: (a) => idem('dossie', a.idempotency_key, () => {
      const d = M().dossies[a.client_id] || { version: 0 };
      if (a.expected_version !== undefined && a.expected_version !== d.version) err('write:conflict version_conflict: expected ' + a.expected_version + ' current ' + d.version);
      M().dossies[a.client_id] = { ...d, version: d.version + 1, content: a.content, updated_at: new Date().toISOString() };
      return escrever('aceleriq_upsert_current_dossier', a, { version: d.version + 1, current_record: { id: 'dossie-v' + (d.version + 1) } });
    }),
    aceleriq_create_report_draft: (a) => idem('rascunho', a.idempotency_key, () => {
      const cid = Object.keys(M().clientes).find((c) => (M().relatorios[c] || []).some((r) => r.project_id === a.project_id)) || IDS.mirante;
      const r = { id: 'r-novo-' + (M().escritas.length + 1), project_id: a.project_id, client_id: cid, title: a.title, status: 'draft', created_at: new Date(M().agoraMs).toISOString(),
        period_start: a.period_start || null, period_end: a.period_end || null, metrics: a.metrics || {}, summary: a.summary, next_steps: a.next_steps, review_version: 1 };
      (M().relatorios[cid] = M().relatorios[cid] || []).push(r);
      return escrever('aceleriq_create_report_draft', a, { report: { id: r.id, status: 'draft' } });
    }),
    aceleriq_central_review_preparar: (a) => idem('preparar', a.idempotency_key, () => {
      const r = Object.values(M().relatorios).flat().find((x) => x.id === a.report_id);
      if (!r) err('report not found');
      const ap = { approval_id: 'ap-' + a.report_id, report_id: a.report_id, client_id: r.client_id, cliente: M().clientes[r.client_id]?.nome, titulo: r.title, ritual: r.metrics?.ritual_type || null,
        mensagem: r.summary, proximo_passo: r.next_steps, destino: a.recipient || r.client_id, payload_version: 1, payload_hash: 'c'.repeat(64), valid_until: new Date(M().agoraMs + 7 * 86400000).toISOString() };
      M().fila.esperando_decisao.push(ap);
      return escrever('aceleriq_central_review_preparar', a, { ok: true, approval_id: ap.approval_id });
    }),
    aceleriq_central_review_marcar_enviado: (a) => idem('enviado', a.idempotency_key, () => {
      if (estado.painelFora) { const e = new Error('Service Unavailable'); e.http = 503; throw e; }
      const i = M().fila.aprovados_para_enviar.findIndex((x) => x.approval_id === a.approval_id);
      if (i < 0) err('CENTRAL_ALREADY_SENT');
      const [ap] = M().fila.aprovados_para_enviar.splice(i, 1);
      M().fila.enviados_recentes.push({ ...ap, executed_at: new Date().toISOString(), evidencia: a.evidence });
      return escrever('aceleriq_central_review_marcar_enviado', a, { ok: true });
    }),
    aceleriq_upsert_project_memory: (a) => escrever('aceleriq_upsert_project_memory', a, { id: 'mem-' + M().escritas.length }),
    aceleriq_agent_handoff: (a) => escrever('aceleriq_agent_handoff', a, { ok: true, conversa: 'conv-teste' }),
    aceleriq_operator_report: (a) => idem('report', a.run_key, () => escrever('aceleriq_operator_report', a, { ok: true })),
    aceleriq_dia_prioritario_registrar: (a) => idem('registrar', a.idempotency_key, () => escrever('aceleriq_dia_prioritario_registrar', a, { ok: true, id: 'reg-' + M().escritas.length })),
  };

  return async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/__teste/estado') return json(res, 200, { escritas: M().escritas, fila: M().fila, chamadas: estado.chamadas });
    if (url.pathname === '/__teste/reset') { const b = await lerCorpo(req); estado.mundo = fabrica(b.agoraMs); estado.idem = {}; estado.chamadas = []; estado.falhas = {}; estado.painelFora = false; estado.leiturasFila = 0; return json(res, 200, { ok: true }); }
    if (url.pathname === '/__teste/falhas') { estado.falhas = await lerCorpo(req); return json(res, 200, { ok: true }); }
    if (url.pathname === '/__teste/mundo') { const b = await lerCorpo(req); Object.assign(estado.mundo, b); return json(res, 200, { ok: true }); }
    if (url.pathname === '/__teste/aprovar') {
      // Simula a decisão HUMANA tomada no painel (só no teste).
      const b = await lerCorpo(req);
      const f = M().fila; const i = f.esperando_decisao.findIndex((x) => x.approval_id === b.approval_id);
      if (i < 0) return json(res, 404, { erro: 'nao_encontrado' });
      const [ap] = f.esperando_decisao.splice(i, 1); f.aprovados_para_enviar.push({ ...ap, ...(b.alterar || {}) });
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/__teste/painel-fora') { estado.painelFora = (await lerCorpo(req)).fora === true; return json(res, 200, { ok: true }); }
    if (url.pathname === '/jev') {
      // Juiz de TESTE (não é o Jev): respostas determinísticas por palavra-chave, só para exercitar o fluxo.
      const b = await lerCorpo(req);
      const t = (b.state?.trecho || []).map((x) => x.texto).join(' ').toLowerCase();
      const ab = (b.state?.perguntas_abertas || []);
      const autoriza = /pode fazer|pode seguir|aprovad|autoriz|pode publicar|manda ver/.test(t);
      const objeto = /campanha|post|carrossel|verba|r\$|dia \d|segunda|terça|quarta|quinta|sexta/.test(t);
      const sens = /verba|pagamento|pagar|campanha|r\$|boleto|publica/.test(t);
      const tipo = autoriza ? 'decisao' : /\?$/.test(t.trim()) || /pode (criar|fazer|mandar|ajustar)/.test(t) ? 'pedido' : /^(ok|obrigad|bom dia|boa tarde|👍)/.test(t.trim()) ? 'ruido' : /corrig|na verdade|errado/.test(t) ? 'correcao' : 'informacao';
      const resp = ab.find((p) => /aprov/.test(p.pergunta.toLowerCase()) && /aprov|pode agendar|liberad/.test(t));
      return json(res, 200, { model: 'juiz-de-teste', answers: {
        tipo: { type: 'choice', choice: tipo, probabilities: { [tipo]: 0.9 }, confidence: 0.85 },
        responde: { type: 'choice', choice: resp ? resp.id : 'nenhuma', probabilities: {}, confidence: 0.8 },
        autoriza: { type: 'noul', noul: autoriza ? 0.92 : 0.05 },
        objeto_claro: { type: 'noul', noul: objeto ? 0.8 : 0.15 },
        sensivel: { type: 'noul', noul: sens ? 0.85 : 0.05 } } });
    }
    if (url.pathname !== '/mcp') return json(res, 404, { erro: 'rota' });
    if (!/^Bearer teste-local-/.test(req.headers.authorization || '')) return json(res, 401, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'unauthorized' } });
    const b = await lerCorpo(req);
    if (b.__invalido) return json(res, 200, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
    const nome = b.params?.name, args = b.params?.arguments || {};
    estado.chamadas.push({ ferramenta: nome, argumentos: args });
    const falha = estado.falhas[nome];
    if (falha === 'http401') return json(res, 401, { jsonrpc: '2.0', id: b.id, error: { code: -32001, message: 'unauthorized' } });
    if (falha === 'conflito') return json(res, 200, { jsonrpc: '2.0', id: b.id, error: { code: -32603, message: 'write:conflict version_conflict: expected 132 current 134' } });
    if (falha === 'outro_cliente') { const r = ferramentas[nome](args); const x = JSON.parse(JSON.stringify(r)); x.client_id = IDS.outro; return json(res, 200, { jsonrpc: '2.0', id: b.id, result: { structuredContent: x } }); }
    if (falha === 'mudar_na_releitura') {
      estado.leiturasFila = (estado.leiturasFila || 0) + 1;
      const r = ferramentas[nome](args);
      if (estado.leiturasFila >= 2) r.aprovados_para_enviar = r.aprovados_para_enviar.map((a) => ({ ...a, mensagem: a.mensagem + ' (editado depois da aprovação)' }));
      return json(res, 200, { jsonrpc: '2.0', id: b.id, result: { structuredContent: r } });
    }
    if (falha === 'timeout') { await new Promise((r) => setTimeout(r, 35000)); return json(res, 504, {}); }
    if (falha === 'http500') return json(res, 500, { erro: 'interno' });
    if (falha === 'jsonrpc_error') return json(res, 200, { jsonrpc: '2.0', id: b.id, error: { code: -32603, message: 'erro interno de teste' } });
    if (falha === 'isError') return json(res, 200, { jsonrpc: '2.0', id: b.id, result: { isError: true, content: [{ type: 'text', text: 'falha de teste' }] } });
    if (falha === 'payload_vazio') return json(res, 200, { jsonrpc: '2.0', id: b.id, result: { content: [] } });
    const fn = ferramentas[nome];
    if (!fn) return json(res, 200, { jsonrpc: '2.0', id: b.id, error: { code: -32004, message: 'tool not found: ' + nome } });
    try {
      const r = fn(args);
      return json(res, 200, { jsonrpc: '2.0', id: b.id, result: { content: [{ type: 'text', text: JSON.stringify(r) }], structuredContent: r } });
    } catch (e) {
      if (e.http) return json(res, e.http, { erro: e.message });
      return json(res, 200, { jsonrpc: '2.0', id: b.id, error: { code: e.rpc || -32603, message: e.message } });
    }
  };
}

export function criarTransporteTeste(estado) {
  return async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/__teste/modo') { estado.modo = (await lerCorpo(req)).modo; return json(res, 200, { ok: true }); }
    if (url.pathname === '/__teste/enviadas') return json(res, 200, { enviadas: estado.enviadas, tentativas: estado.tentativas });
    if (url.pathname === '/__teste/reset') { estado.enviadas = []; estado.tentativas = 0; estado.modo = 'aceitar'; return json(res, 200, { ok: true }); }
    if (url.pathname !== '/enviar') return json(res, 404, {});
    if (req.headers['x-transporte'] !== 'TESTE') return json(res, 401, { aceita: false, erro: 'sem_marcador_de_teste' });
    const b = await lerCorpo(req);
    estado.tentativas++;
    const modo = estado.modo || 'aceitar';
    if (modo === 'rejeitar') return json(res, 422, { aceita: false, erro: 'destino_recusado' });
    if (modo === 'erro500') return json(res, 500, { erro: 'interno' });
    if (modo === 'timeout') { await new Promise((r) => setTimeout(r, 25000)); return json(res, 504, {}); }
    const id = 'teste.' + (estado.enviadas.length + 1);
    estado.enviadas.push({ id, para: b.para, texto: b.texto, chave_cliente: b.chave_cliente, em: new Date().toISOString() });
    if (modo === 'aceitar_e_cair') return json(res, 502, { erro: 'gateway' });
    return json(res, 200, { aceita: true, message_id: id });
  };
}

export async function iniciarServidores({ portaMcp = 8791, portaTransporte = 8792, agoraMs, fabrica = criarMundo } = {}) {
  const estadoMcp = { mundo: fabrica(agoraMs), idem: {}, chamadas: [], falhas: {} };
  const estadoTr = { enviadas: [], tentativas: 0, modo: 'aceitar' };
  const s1 = http.createServer(criarMcpReplay(estadoMcp, fabrica));
  const s2 = http.createServer(criarTransporteTeste(estadoTr));
  await new Promise((r) => s1.listen(portaMcp, '127.0.0.1', r));
  await new Promise((r) => s2.listen(portaTransporte, '127.0.0.1', r));
  return { estadoMcp, estadoTr, parar: () => Promise.all([new Promise((r) => s1.close(r)), new Promise((r) => s2.close(r))]) };
}

if (process.argv[1] && process.argv[1].endsWith('servidores-teste.mjs')) {
  const s = await iniciarServidores({ agoraMs: process.env.ACQ_AGORA ? Date.parse(process.env.ACQ_AGORA) : undefined });
  console.log('TESTE: MCP replay em http://127.0.0.1:8791/mcp e transporte em http://127.0.0.1:8792 (dados de fixture)');
  void s;
}
