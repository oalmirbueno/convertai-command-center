// Liga (publica) ou desliga fluxos ACQ na instância n8n, na ordem segura do PLANO-DE-ATIVACAO.md:
// 1) publica ACQ-00-Erros e ACQ-00-Ferramenta-Aceleriq (sem gatilho próprio; o sub-workflow só roda
//    publicado fora do modo manual); 2) liga o errorWorkflow nos fluxos pedidos; 3) publica os fluxos.
// Uso:  node tools/ativar-producao.mjs ligar ACQ-05-Dia-Prioritario-Radar [ACQ-01-Contexto-Rituais ...]
//       node tools/ativar-producao.mjs desligar ACQ-01-Contexto-Rituais [...]
// ACQ-02 e ACQ-04 (WhatsApp) são recusados até o transporte oficial existir.
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
const call = async (n, a) => { const r = await rpc('tools/call', { name: n, arguments: a }); if (r.isError) throw new Error(JSON.stringify(r.content).slice(0, 800)); return r.structuredContent || (r.content?.[0]?.text ? (() => { try { return JSON.parse(r.content[0].text); } catch { return r.content[0].text; } })() : r); };

const [acao, ...nomes] = process.argv.slice(2);
if (!['ligar', 'desligar'].includes(acao) || !nomes.length) { console.error('uso: ligar|desligar <fluxo...>'); process.exit(2); }
const WHATSAPP = ['ACQ-02-Despacho-Aprovado', 'ACQ-04-Conversas-Contexto'];
if (acao === 'ligar' && nomes.some((n) => WHATSAPP.includes(n))) { console.error('ACQ-02 e ACQ-04 dependem do WhatsApp oficial: não ligar.'); process.exit(2); }
await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acq-ativar', version: '1' } });
await rpc('notifications/initialized', {}, true);
const ids = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(raiz, 'piloto', 'homologacao-ids.json'), 'utf8')).workflows.map((w) => [w.nome, w.id]));
for (const n of nomes) if (!ids[n]) { console.error('fluxo desconhecido: ' + n); process.exit(2); }

if (acao === 'desligar') {
  for (const n of nomes) { await call('unpublish_workflow', { workflowId: ids[n] }); console.log('desligado:', n); }
  process.exit(0);
}
// 1) apoio publicado
for (const n of ['ACQ-00-Erros', 'ACQ-00-Ferramenta-Aceleriq']) { await call('publish_workflow', { workflowId: ids[n] }); console.log('publicado (apoio):', n); }
// 2) errorWorkflow e 3) publicar
for (const n of nomes) {
  const r = await call('update_workflow', { workflowId: ids[n], operations: [{ type: 'setWorkflowSettings', settings: { errorWorkflow: ids['ACQ-00-Erros'] } }], versionName: 'acq-producao-' + new Date().toISOString().slice(0, 16), skillsUsed: ['n8n-workflow-patterns'] });
  if (r && r.skippedOperations && r.skippedOperations.length) console.log(n, 'aviso:', JSON.stringify(r.skippedOperations).slice(0, 300));
  await call('publish_workflow', { workflowId: ids[n] });
  console.log('ligado:', n);
}
const det = await Promise.all(Object.entries(ids).map(async ([n, id]) => { const d = await call('get_workflow_details', { workflowId: id }); const w = d.workflow || d; return `${w.active ? 'LIGADO   ' : 'desligado'}  ${n}`; }));
console.log(det.join('\n'));
