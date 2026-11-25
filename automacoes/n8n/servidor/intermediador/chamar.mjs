// uso: node chamar.mjs <ferramenta> '<json>'   (credencial do painel do Hermes, nunca impressa)
import fs from 'node:fs';
const l = fs.readFileSync('/root/.hermes/.env', 'utf8').split('\n').find((x) => x.startsWith('MCP_ACELERIQ_API_KEY='));
const chave = l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
const r = await fetch('https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/mcp-server', { method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer ' + chave },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: process.argv[2], arguments: JSON.parse(process.argv[3] || '{}') } }) });
const t = await r.text();
const linhas = t.trim().startsWith('{') ? [t] : t.split('\n').filter((x) => x.startsWith('data:')).map((x) => x.slice(5));
const j = JSON.parse(linhas[linhas.length - 1]);
const res = j.result || {};
console.log(res.isError ? 'ERRO: ' : '', (res.content && res.content[0] && res.content[0].text) || JSON.stringify(j.error || j).slice(0, 800));
