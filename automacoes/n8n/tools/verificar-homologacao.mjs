// Lê de volta os workflows da homologação e compara com os JSONs locais: nós, tipos, versões,
// parâmetros (hash do código), conexões, active=false e gatilhos sem registro ativo.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = (n) => process.env[n] || execFileSync('powershell', ['-NoProfile', '-Command', `[Environment]::GetEnvironmentVariable('${n}','User')`], { encoding: 'utf8' }).trim();
const BASE = env('N8N_BASE_URL'), TOKEN = env('N8N_MCP_TOKEN');
let sid = null, seq = 0;
async function rpc(method, params, notify) {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer ' + TOKEN };
  if (sid) h['mcp-session-id'] = sid;
  const r = await fetch(BASE + '/mcp-server/http', { method: 'POST', headers: h, body: JSON.stringify(notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++seq, method, params }) });
  sid = r.headers.get('mcp-session-id') || sid;
  const t = await r.text(); if (notify) return null;
  const l = t.trim().startsWith('{') ? t : t.split('\n').filter((x) => x.startsWith('data:')).map((x) => x.slice(5)).pop();
  const j = JSON.parse(l); if (j.error) throw new Error(JSON.stringify(j.error)); return j.result;
}
const call = async (n, a) => { const r = await rpc('tools/call', { name: n, arguments: a }); if (r.isError) throw new Error(JSON.stringify(r.content)); return r.structuredContent || JSON.parse(r.content[0].text); };
const hash = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 12);
const norm = (p) => JSON.parse(JSON.stringify(p, (k, v) => (k === 'cachedResultName' || k === 'cachedResultUrl' ? undefined : v)));

await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acq-verificador', version: '1' } });
await rpc('notifications/initialized', {}, true);
const ids = JSON.parse(fs.readFileSync(path.join(raiz, 'piloto', 'homologacao-ids.json'), 'utf8'));
const idPorNome = Object.fromEntries(ids.workflows.map((w) => [w.nome, w.id]));
const mapaLocal = { AcqF00Ferramenta: idPorNome['ACQ-00-Ferramenta-Aceleriq'], AcqE00ErrosComum: idPorNome['ACQ-00-Erros'] };
const saida = [];
for (const w of ids.workflows) {
  const local = JSON.parse(fs.readFileSync(path.join(raiz, 'workflows', w.nome + '.json'), 'utf8'));
  const d = await call('get_workflow_details', { workflowId: w.id, detailLevel: 'full' });
  const remoto = d.workflow || d;
  const rn = Object.fromEntries((remoto.nodes || []).filter((n) => n.type !== 'n8n-nodes-base.stickyNote').map((n) => [n.name, n]));
  const dif = [];
  for (const n of local.nodes) {
    const r = rn[n.name];
    if (!r) { dif.push('falta nó ' + n.name); continue; }
    if (r.type !== n.type || Number(r.typeVersion) !== Number(n.typeVersion)) dif.push(`tipo/versão ${n.name}: ${r.type}@${r.typeVersion}`);
    const p = JSON.parse(JSON.stringify(n.parameters));
    if (p.workflowId && mapaLocal[p.workflowId.value]) p.workflowId.value = mapaLocal[p.workflowId.value];
    if (hash(norm(p)) !== hash(norm(r.parameters))) dif.push('parâmetros diferentes em ' + n.name);
    for (const k of ['retryOnFail', 'maxTries', 'onError', 'executeOnce']) if (n[k] !== undefined && r[k] !== n[k]) dif.push(`${k} em ${n.name}: ${r[k]}`);
  }
  if (Object.keys(rn).length !== local.nodes.length) dif.push(`quantidade de nós: remoto ${Object.keys(rn).length} x local ${local.nodes.length}`);
  const arestas = (c) => Object.entries(c || {}).flatMap(([de, x]) => (x.main || []).flatMap((s, i) => (s || []).map((t) => `${de}#${i}->${t.node}#${t.index}`))).sort();
  const al = arestas(local.connections), ar = arestas(remoto.connections);
  const faltam = al.filter((x) => !ar.includes(x)), sobram = ar.filter((x) => !al.includes(x));
  if (faltam.length) dif.push('conexões ausentes: ' + faltam.join(' | '));
  if (sobram.length) dif.push('conexões a mais: ' + sobram.join(' | '));
  const ativo = remoto.active === true || Boolean(remoto.activeVersionId);
  if (ativo) dif.push('WORKFLOW ATIVO/PUBLICADO');
  const codigos = local.nodes.filter((n) => n.type === 'n8n-nodes-base.code').length;
  saida.push({ nome: w.nome, id: w.id, nos: local.nodes.length, conexoes: al.length, codigo_nos: codigos, active: remoto.active, publicado: Boolean(remoto.activeVersionId),
    gatilhos: (d.triggerInfo && (d.triggerInfo.triggers || d.triggerInfo).length) || null, diferencas: dif });
  console.log((dif.length ? 'DIFERENTE ' : 'IGUAL     ') + w.nome.padEnd(30), 'nós', String(local.nodes.length).padStart(3), 'conexões', String(al.length).padStart(3), 'active=' + remoto.active, dif.slice(0, 3).join(' ; '));
}
fs.writeFileSync(path.join(raiz, 'piloto', 'homologacao-leitura-de-volta.json'), JSON.stringify({ lido_em: new Date().toISOString(), workflows: saida }, null, 2) + '\n');
