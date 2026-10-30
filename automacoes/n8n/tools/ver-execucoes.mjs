// Lista as últimas execuções de um fluxo no n8n da nuvem e, com --id, o resumo de uma delas por nó.
// Uso: node tools/ver-execucoes.mjs <nome-do-fluxo> [--id N] [--nos "A,B"]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = (n) => process.env[n] || execFileSync('powershell', ['-NoProfile', '-Command', `[Environment]::GetEnvironmentVariable('${n}','User')`], { encoding: 'utf8' }).trim();
const BASE = env('N8N_BASE_URL'), TOKEN = env('N8N_MCP_TOKEN');
const arg = (n) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : null; };
let sid = null, seq = 0;
async function rpc(method, params, notify) {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer ' + TOKEN };
  if (sid) h['mcp-session-id'] = sid;
  const corpo = JSON.stringify(notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++seq, method, params });
  let r;
  for (let t = 0; t < 20; t++) { r = await fetch(BASE + '/mcp-server/http', { method: 'POST', headers: h, body: corpo }); if (r.status !== 429) break; await new Promise((ok) => setTimeout(ok, 15000)); }
  sid = r.headers.get('mcp-session-id') || sid; const txt = await r.text(); if (notify) return null;
  const meuId = seq;
  const msgs = txt.trim().startsWith('{') ? [JSON.parse(txt)] : txt.split('\n').filter((x) => x.startsWith('data:')).map((x) => { try { return JSON.parse(x.slice(5)); } catch { return null; } }).filter(Boolean);
  const j = msgs.find((x) => x.id === meuId) || msgs[msgs.length - 1];
  if (j.error) throw new Error(JSON.stringify(j.error)); return j.result;
}
const call = async (n, a) => { const r = await rpc('tools/call', { name: n, arguments: a }); if (r.isError) throw new Error(JSON.stringify(r.content).slice(0, 800)); return r.structuredContent || JSON.parse(r.content[0].text); };
await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acq-ver', version: '1' } });
await rpc('notifications/initialized', {}, true);
const ids = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(raiz, 'piloto', 'homologacao-ids.json'), 'utf8')).workflows.map((w) => [w.nome, w.id]));
const wid = ids[process.argv[2]];
if (!arg('id')) {
  const l = await call('search_workflow_executions', { workflowId: wid, limit: 5 });
  console.log(JSON.stringify((l.data || l.executions || l).map?.((e) => ({ id: e.id, status: e.status, modo: e.mode, inicio: e.startedAt, fim: e.stoppedAt })) ?? l, null, 1).slice(0, 3000));
} else {
  const nos = arg('nos') ? arg('nos').split(',') : undefined;
  const det = await call('get_workflow_execution', { workflowId: wid, executionId: arg('id'), includeData: true, truncateData: 30000, ...(nos ? { nodeNames: nos } : {}) });
  const rd = det.data?.resultData || det.execution?.data?.resultData || {};
  const resumo = { status: det.status, erro: rd.error ? rd.error.message : null, ultimo_no: rd.lastNodeExecuted,
    nos: Object.fromEntries(Object.entries(rd.runData || {}).map(([n, runs]) => [n, { itens: runs.reduce((s, r) => s + ((r.data?.main || []).flat().length), 0), erro: runs.find((r) => r.error)?.error?.message || null,
      saida: nos ? (runs[0]?.data?.main || []).flat().map((i) => i.json) : undefined }])) };
  fs.writeFileSync(path.join(raiz, 'piloto', 'nuvem', `${process.argv[2]}-${arg('id')}-detalhe.json`), JSON.stringify(resumo, null, 1));
  console.log(JSON.stringify(resumo, null, 1).slice(0, 12000));
}
