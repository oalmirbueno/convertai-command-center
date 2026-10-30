// Roda um fluxo no n8n da nuvem em MODO MANUAL (usa o rascunho; nada é publicado) e espera o fim.
// Uso: node tools/rodar-na-nuvem.mjs <nome-do-fluxo> "<nome do gatilho manual>"
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
  for (let t = 0; t < 20; t++) { r = await fetch(BASE + '/mcp-server/http', { method: 'POST', headers: h, body: corpo }); if (r.status !== 429) break; await new Promise((ok) => setTimeout(ok, 15000)); }
  sid = r.headers.get('mcp-session-id') || sid; const txt = await r.text(); if (notify) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${txt.slice(0, 300)}`);
  const meuId = seq;
  const msgs = txt.trim().startsWith('{') ? [JSON.parse(txt)] : txt.split('\n').filter((x) => x.startsWith('data:')).map((x) => { try { return JSON.parse(x.slice(5)); } catch { return null; } }).filter(Boolean);
  const j = msgs.find((x) => x.id === meuId) || msgs[msgs.length - 1];
  if (j.error) throw new Error(JSON.stringify(j.error)); return j.result;
}
const call = async (n, a) => { const r = await rpc('tools/call', { name: n, arguments: a }); if (r.isError) throw new Error(JSON.stringify(r.content).slice(0, 800)); return r.structuredContent || JSON.parse(r.content[0].text); };
await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acq-piloto-nuvem', version: '1' } });
await rpc('notifications/initialized', {}, true);
const ids = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(raiz, 'piloto', 'homologacao-ids.json'), 'utf8')).workflows.map((w) => [w.nome, w.id]));
const [nome, gatilho] = process.argv.slice(2);
const wid = ids[nome];
const t0 = Date.now();
const ex = await call('execute_workflow', { workflowId: wid, executionMode: 'manual', triggerNodeName: gatilho });
const execId = String(ex.executionId || ex.id);
let det;
for (let k = 0; k < 120; k++) {
  await new Promise((ok) => setTimeout(ok, 5000));
  det = await call('get_workflow_execution', { workflowId: wid, executionId: execId, includeData: true, truncateData: 4000 });
  const st = det.status || det.execution?.status;
  if (st && !['running', 'new', 'waiting', 'unknown'].includes(st)) break;
}
const st = det.status || det.execution?.status;
const rd = det.data?.resultData || det.execution?.data?.resultData || {};
const saida = { fluxo: nome, execucao: execId, status: st, segundos: Math.round((Date.now() - t0) / 1000), erro: rd.error ? (rd.error.message || '') + ' ' + (rd.error.description || '') : null, ultimo_no: rd.lastNodeExecuted || null,
  nos: Object.fromEntries(Object.entries(rd.runData || {}).map(([n, runs]) => [n, { execucoes: runs.length, itens: runs.reduce((s, r) => s + ((r.data?.main || []).flat().length), 0), erro: runs.find((r) => r.error)?.error?.message || null }])) };
fs.mkdirSync(path.join(raiz, 'piloto', 'nuvem'), { recursive: true });
fs.writeFileSync(path.join(raiz, 'piloto', 'nuvem', `${nome}-${execId}.json`), JSON.stringify({ ...saida, bruto: det }, null, 1));
console.log(JSON.stringify(saida, null, 1).slice(0, 6000));
