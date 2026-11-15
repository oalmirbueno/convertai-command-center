// Roda NO SERVIDOR (VPS), com o mesmo acesso ao painel do enviar.mjs: cria o rascunho e o pedido de cada texto do
// arquivo gerado por soltar-segurados.mjs. O envio em si continua sendo do enviar.mjs (timer), com todas as travas.
// Uso: /opt/mercurio-pilot/node criar-pedidos-no-servidor.mjs soltar.json   (apagar os dois arquivos depois)
// Não imprime chave.
import fs from 'node:fs';
const src = fs.readFileSync('/opt/aceleriq-grupo-cliente/enviar.mjs', 'utf8');
const ENV_ARQ = (src.match(/const ENV_ARQ = [^;]*?'([^']+)'/) || [])[1];
const MCP_URL = 'https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/mcp-server';
function chave() {
  if (process.env.MCP_ACELERIQ_API_KEY) return process.env.MCP_ACELERIQ_API_KEY.trim();
  const l = fs.readFileSync(ENV_ARQ, 'utf8').split('\n').find((x) => x.startsWith('MCP_ACELERIQ_API_KEY='));
  if (!l) throw new Error('chave ausente');
  return l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
}
let seq = 0;
async function mcp(k, nome, argumentos) {
  const r = await fetch(MCP_URL, { method: 'POST', signal: AbortSignal.timeout(60000), headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer ' + k },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method: 'tools/call', params: { name: nome, arguments: argumentos } }) });
  const t = await r.text();
  const linhas = t.trim().startsWith('{') ? [t] : t.split('\n').filter((x) => x.startsWith('data:')).map((x) => x.slice(5));
  const j = JSON.parse(linhas[linhas.length - 1]);
  if (j.error) throw new Error(nome + ': ' + String(j.error.message || '').slice(0, 300));
  const res = j.result || {};
  const texto = res.content && res.content[0] && res.content[0].text;
  if (res.isError) throw new Error(nome + ': ' + String(texto || '').slice(0, 400));
  return res.structuredContent || (texto ? JSON.parse(texto) : {});
}
const itens = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const k = chave();
for (const nome of Object.keys(itens)) {
  const it = itens[nome];
  try {
    const d = await mcp(k, 'aceleriq_create_report_draft', it.rascunho);
    const id = (d.record && d.record.id) || (d.report && d.report.id) || d.id;
    if (!id) throw new Error('rascunho sem id');
    const p = await mcp(k, 'aceleriq_central_review_preparar', Object.assign({}, it.revisao, { report_id: id }));
    console.log(JSON.stringify({ cliente: it.alvo.cliente, grupo: it.alvo.grupo, report_id: id, pedido: p.id, status: p.status }));
  } catch (e) { console.log(JSON.stringify({ cliente: it.alvo.cliente, erro: String(e.message).slice(0, 400) })); }
}
