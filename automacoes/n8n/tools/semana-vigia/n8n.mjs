// Roda o ensaio do ACQ-11 (modo manual, rascunho) e guarda a execução inteira.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const aqui = path.dirname(fileURLToPath(import.meta.url));
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
await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acq-semana-vigia', version: '1' } });
await rpc('notifications/initialized', {}, true);
// Uso: node n8n.mjs ultimas            -> últimas execuções do ACQ-11
//      node n8n.mjs execucao <id>      -> execução inteira em JSON (redirecione para um arquivo)
//      node n8n.mjs manual             -> roda o gatilho "Executar manualmente" (rodada real; pula quem já recebeu)
const wid = 'uo2UZ80jZwBoHCxn';
const [, , cmd, arg] = process.argv;
if (cmd === 'ultimas') console.log(JSON.stringify((await call('search_workflow_executions', { workflowId: wid, limit: 6 })).data.map((e) => ({ id: e.id, status: e.status, mode: e.mode, startedAt: e.startedAt })), null, 1));
else if (cmd === 'execucao') process.stdout.write(JSON.stringify(await call('get_workflow_execution', { workflowId: wid, executionId: String(arg), includeData: true, truncateData: 200000 })));
else if (cmd === 'manual') console.log(JSON.stringify(await call('execute_workflow', { workflowId: wid, executionMode: 'manual', triggerNodeName: 'Executar manualmente' })).slice(0, 400));
else { console.error('uso: n8n.mjs ultimas | execucao <id> | manual'); process.exit(2); }
