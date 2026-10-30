// Piloto do texto do ritual (MCP 2.10.0) no n8n da nuvem, num dia sem ritual: test_workflow fixa só o
// gatilho ({ ritual }) e os nós do banco de estado do ACQ-01. O ACQ-00 roda de verdade (leituras reais e
// aceleriq_ritual_redigir real); gravar no painel continua simulado pelo dry-run do piloto.
// Uso: node tools/testar-texto-do-ritual.mjs [rota_semana|meio_semana|prova_movimento]
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
await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acq-texto-ritual', version: '1' } });
await rpc('notifications/initialized', {}, true);
const ids = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(raiz, 'piloto', 'homologacao-ids.json'), 'utf8')).workflows.map((w) => [w.nome, w.id]));
const wid = ids['ACQ-01-Contexto-Rituais'];
const ritual = process.argv[2] || 'prova_movimento';
const uid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const pinData = {
  'Executar piloto (Mirante)': [{ json: { ritual } }],
  'Seg e qua 08h30': [{ json: {} }], 'Sex 16h30': [{ json: {} }], 'Manual por client_id': [{ json: {} }],
  // Estado local fixado: as três propostas (contexto, ritual, reconciliação) contam como novas.
  'Registrar propostas': [{ json: { registradas: [{ novo: true, id: uid(1) }, { novo: true, id: uid(2) }, { novo: true, id: uid(3) }] } }],
  'Gravar evento': [{ json: { evento: { teste: true }, propostas: [], descartadas: [] } }],
};
const t0 = Date.now();
const t = await call('test_workflow', { workflowId: wid, pinData, triggerNodeName: 'Executar piloto (Mirante)', timeout: 600 });
const execId = String(t.executionId || t.id);
let det;
for (let k = 0; k < 150; k++) {
  det = await call('get_workflow_execution', { workflowId: wid, executionId: execId, includeData: true, truncateData: 30000,
    nodeNames: ['Analisar e propor', 'Redigir texto do ritual', 'Preparar escritas', 'Gravar no painel (etapa 1)', 'Registrar evidência'] });
  if (det.status && !['running', 'new', 'waiting', 'unknown'].includes(det.status)) break;
  await new Promise((ok) => setTimeout(ok, 5000));
}
const rd = det.data?.resultData || det.execution?.data?.resultData || {};
const saida = (n) => ((rd.runData?.[n]?.[0]?.data?.main) || []).flat().map((i) => i.json);
const analise = saida('Analisar e propor')[0]?.analise || {};
const texto = saida('Redigir texto do ritual')[0] || null;
const escritas = saida('Gravar no painel (etapa 1)');
const rascunho = saida('Preparar escritas').find((x) => x.ferramenta === 'aceleriq_create_report_draft');
const evid = saida('Registrar evidência')[0]?.evento?.payload?.texto_final || null;
const resumo = { execucao: execId, status: det.status, segundos: Math.round((Date.now() - t0) / 1000), erro: rd.error ? rd.error.message : null, ultimo_no: rd.lastNodeExecuted,
  ritual, estado: analise.estado, texto_chamado: texto ? { ok: texto.ok, decisao: texto.decisao, ferramenta: texto.ferramenta, erro: texto.erro } : null,
  rascunho_que_iria_ao_painel: rascunho ? { title: rascunho.argumentos.title, summary: rascunho.argumentos.summary, next_steps: rascunho.argumentos.next_steps, pendente: rascunho.argumentos.metrics?.texto_final_pendente || null, origem: rascunho.argumentos.metrics?.texto_final?.origem || null } : null,
  escritas: escritas.map((e) => ({ ferramenta: e.ferramenta, ok: e.ok, simulado: e.simulado, decisao: e.decisao })), texto_na_evidencia: evid ? { ok: evid.ok, model: evid.model, custo_usd: evid.custo_usd, erro: evid.erro } : null };
fs.mkdirSync(path.join(raiz, 'piloto', 'nuvem'), { recursive: true });
fs.writeFileSync(path.join(raiz, 'piloto', 'nuvem', `ACQ-01-texto-${ritual}-${execId}.json`), JSON.stringify({ ...resumo, bruto: det }, null, 1));
console.log(JSON.stringify(resumo, null, 1));
