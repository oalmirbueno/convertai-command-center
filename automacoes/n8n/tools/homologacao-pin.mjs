// Testes na instância de homologação com PIN DATA (test_workflow): gatilho, HTTP e nós com credencial
// usam dados fixados; os nós Code rodam de verdade no sandbox da instância. Nada sai para a internet.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = (n) => process.env[n] || execFileSync('powershell', ['-NoProfile', '-Command', `[Environment]::GetEnvironmentVariable('${n}','User')`], { encoding: 'utf8' }).trim();
const BASE = env('N8N_BASE_URL'), TOKEN = env('N8N_MCP_TOKEN');
let sid = null, seq = 0;
async function rpc(method, params, notify) {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer ' + TOKEN };
  if (sid) h['mcp-session-id'] = sid;
  const corpo = JSON.stringify(notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++seq, method, params });
  let r;
  for (let tentativa = 0; tentativa < 20; tentativa++) {
    r = await fetch(BASE + '/mcp-server/http', { method: 'POST', headers: h, body: corpo });
    if (r.status !== 429) break;
    await new Promise((ok) => setTimeout(ok, 15000)); // limite da instância (100 por janela)
  }
  sid = r.headers.get('mcp-session-id') || sid; const t = await r.text(); if (notify) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`);
  const meuId = seq;
  const msgs = t.trim().startsWith('{') ? [JSON.parse(t)] : t.split('\n').filter((x) => x.startsWith('data:')).map((x) => { try { return JSON.parse(x.slice(5)); } catch { return null; } }).filter(Boolean);
  const j = msgs.find((x) => x.id === meuId) || msgs[msgs.length - 1];
  if (!j) throw new Error('resposta vazia: ' + t.slice(0, 300));
  if (j.error) throw new Error(JSON.stringify(j.error)); return j.result;
}
const call = async (n, a) => { const r = await rpc('tools/call', { name: n, arguments: a }); if (r.isError) throw new Error(JSON.stringify(r.content).slice(0, 600)); return r.structuredContent || JSON.parse(r.content[0].text); };
await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acq-pin', version: '1' } });
await rpc('notifications/initialized', {}, true);
const ids = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(raiz, 'piloto', 'homologacao-ids.json'), 'utf8')).workflows.map((w) => [w.nome, w.id]));
const M = 'eb1270a5-4d9e-4c67-bb17-e25fa12ada34';
const rpcOk = (r) => [{ json: { statusCode: 200, headers: {}, body: { jsonrpc: '2.0', id: 'x', result: { content: [{ type: 'text', text: JSON.stringify(r) }], structuredContent: r } } } }];
const casos = [
  { nome: 'leitura ok', entrada: { workflow_id: 'ACQ-01', run_id: 'pin', ambiente_chamador: 'pilot', ref: 'a', ferramenta: 'aceleriq_get_agenda_status', argumentos: { client_id: M, days: 14 } },
    http: rpcOk({ client_id: M, scheduled: [], ready_without_date: [{ id: 'x', title: 't' }], published_last_7_days: [], diagnosis: 'teste' }), esperado: (o) => o.ok === true && o.decisao === 'ler' },
  { nome: 'escrita vira simulação (dry-run do piloto)', entrada: { workflow_id: 'ACQ-01', run_id: 'pin', ambiente_chamador: 'pilot', ref: 'w', ferramenta: 'aceleriq_create_report_draft', client_id_escopo: M, argumentos: { project_id: 'p', title: 't', idempotency_key: 'chave-pin-0001' } },
    http: rpcOk({ nao: 'deveria ser usado' }), esperado: (o) => o.simulado === true && o.decisao === 'simular' },
  { nome: 'HTTP 200 com error JSON-RPC é falha', entrada: { workflow_id: 'ACQ-01', run_id: 'pin', ambiente_chamador: 'pilot', ref: 'e', ferramenta: 'aceleriq_get_agenda_status', argumentos: { client_id: M } },
    http: [{ json: { statusCode: 200, headers: {}, body: { jsonrpc: '2.0', id: 'x', error: { code: -32603, message: 'falha simulada' } } } }], esperado: (o) => o.ok === false && o.erro && o.erro.mensagem === 'falha simulada' },
  { nome: 'ferramenta fora da allowlist bloqueada', entrada: { workflow_id: 'ACQ-02', run_id: 'pin', ambiente_chamador: 'pilot', ref: 'f', ferramenta: 'aceleriq_complete_task', argumentos: { task_id: 'x' } },
    http: rpcOk({}), esperado: (o) => o.ok === false && o.motivo === 'ferramenta_fora_da_allowlist' },
  { nome: 'cliente fora do escopo do piloto bloqueado', entrada: { workflow_id: 'ACQ-01', run_id: 'pin', ambiente_chamador: 'pilot', ref: 'c', ferramenta: 'aceleriq_get_agenda_status', argumentos: { client_id: '39ebda82-637c-498b-a23a-b622f645e852' } },
    http: rpcOk({}), esperado: (o) => o.ok === false && o.motivo === 'cliente_fora_do_escopo' },
];
const saida = [];
for (const c of casos) {
  const pinData = { 'Entrada': [{ json: c.entrada }], 'MCP leitura (com nova tentativa)': c.http, 'MCP escrita (sem nova tentativa)': c.http, 'MCP páginas (com nova tentativa)': c.http };
  const t = await call('test_workflow', { workflowId: ids['ACQ-00-Ferramenta-Aceleriq'], pinData, timeout: 120 });
  const execId = t.executionId || t.id;
  let det = null;
  for (let k = 0; k < 20; k++) {
    det = await call('get_workflow_execution', { workflowId: ids['ACQ-00-Ferramenta-Aceleriq'], executionId: String(execId), includeData: true, nodeNames: ['Interpretar resposta'], truncateData: 20000 });
    if (det.status && det.status !== 'running' && det.status !== 'new' && det.status !== 'waiting') break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  const txt = JSON.stringify(det);
  const m = txt.match(/\{\?"ok\?":(true|false)[^]*?\?"_req\?"/);
  let out = null;
  try {
    const rd = det.data?.resultData?.runData || det.execution?.data?.resultData?.runData || det.runData;
    out = rd['Interpretar resposta'][0].data.main[0][0].json;
  } catch { out = null; }
  const ok = out ? c.esperado(out) : false;
  saida.push({ caso: c.nome, execucao: execId, status: det.status, ok, resultado: out ? { ok: out.ok, decisao: out.decisao, motivo: out.motivo, simulado: out.simulado, erro: out.erro } : (m ? 'ver bruto' : txt.slice(0, 300)) });
  console.log(ok ? '✔' : '✖', c.nome, '| execução', execId, det.status, out ? JSON.stringify({ ok: out.ok, decisao: out.decisao, motivo: out.motivo, erro: out.erro && out.erro.tipo }) : txt.slice(0, 200));
}
fs.writeFileSync(path.join(raiz, 'piloto', 'homologacao-pin-data.json'), JSON.stringify({ executado_em: new Date().toISOString(), instancia: BASE.replace(/^https?:\/\//, ''), workflow: 'ACQ-00-Ferramenta-Aceleriq', casos: saida }, null, 2) + '\n');
