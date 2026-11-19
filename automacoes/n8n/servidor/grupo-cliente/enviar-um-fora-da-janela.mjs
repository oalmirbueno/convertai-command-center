#!/usr/bin/env node
// Envio único, fora da janela, de UMA mensagem da semana já escrita e conferida, quando o dono manda em palavras.
// Caso de uso: o grupo foi renomeado no WhatsApp, a ponte recusou o envio e o pedido ficou com o nome antigo.
// Refaz o pedido com o nome que está na lista da ponte, registra a decisão do dono como evidência, envia e marca.
// Uso (no servidor): node enviar-um-fora-da-janela.mjs <client_id> <report_id> "<mensagem do dono, com data e hora>"
// Usa o mesmo diário do enviar.mjs: não envia se já houver envio ou intenção em aberto para o pedido novo.
import fs from 'node:fs';
import { textoProibido, RITUAIS } from './enviar.mjs';

const [CLIENTE, REPORT, ORDEM] = process.argv.slice(2);
if (!CLIENTE || !REPORT || !ORDEM || ORDEM.length < 20) { console.error('uso: enviar-um-fora-da-janela.mjs <client_id> <report_id> "<mensagem do dono>"'); process.exit(2); }
const MCP_URL = 'https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/mcp-server';
const ESTADO = '/var/lib/aceleriq-grupo-cliente/diario.jsonl';
const log = (o) => console.log(JSON.stringify(o));
const anotar = (e) => fs.appendFileSync(ESTADO, JSON.stringify(Object.assign({ em: new Date().toISOString() }, e)) + '\n', { mode: 0o600 });

const linha = fs.readFileSync('/root/.hermes/.env', 'utf8').split('\n').find((l) => l.startsWith('MCP_ACELERIQ_API_KEY='));
const chave = linha.slice(linha.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
const token = fs.readFileSync('/etc/mercurio-pilot/bridge.token', 'utf8').trim();
const g = JSON.parse(fs.readFileSync('/etc/mercurio-pilot/allowed-groups.json', 'utf8')).groups.find((x) => String(x.client_id) === CLIENTE);
if (!g) { log({ erro: 'cliente_sem_grupo_na_lista' }); process.exit(1); }

let seq = 0;
async function mcp(nome, argumentos) {
  const r = await fetch(MCP_URL, { method: 'POST', signal: AbortSignal.timeout(45000),
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer ' + chave },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method: 'tools/call', params: { name: nome, arguments: argumentos } }) });
  const t = await r.text();
  const linhas = t.trim().startsWith('{') ? [t] : t.split('\n').filter((x) => x.startsWith('data:')).map((x) => x.slice(5));
  const j = JSON.parse(linhas[linhas.length - 1]);
  if (j.error) throw new Error(nome + ': ' + String(j.error.message || '').slice(0, 300));
  const res = j.result || {};
  const texto = res.content && res.content[0] && res.content[0].text;
  if (res.isError) throw new Error(nome + ': ' + String(texto || '').slice(0, 300));
  return res.structuredContent || (texto ? JSON.parse(texto) : {});
}

const rel = (await mcp('aceleriq_get_report', { report_id: REPORT })).report;
const m = (rel && rel.metrics) || {};
if (!rel || String(rel.client_id) !== CLIENTE) { log({ erro: 'relatorio_de_outro_cliente' }); process.exit(1); }
if (m.written_by !== 'n8n:ACQ-11' || !m.conferencia || m.conferencia.ok !== true || !RITUAIS[m.ritual_type]) { log({ erro: 'texto_sem_conferencia_aprovada' }); process.exit(1); }
const proibido = textoProibido(rel.summary);
if (proibido) { log({ erro: 'texto_proibido', motivo: proibido }); process.exit(1); }

const chaveBase = 'gc-fora:' + REPORT.slice(0, 8) + ':' + new Date().toISOString().slice(0, 10);
await mcp('aceleriq_central_review_preparar', { operator: 'default', report_id: REPORT, channel: 'whatsapp', recipient: g.group_name, summary: rel.summary, next_steps: rel.next_steps, idempotency_key: chaveBase + ':prep' });
let fila = await mcp('aceleriq_central_review_fila', { operator: 'default' });
const meu = (lista) => (lista || []).find((p) => String(p.client_id) === CLIENTE && p.report_id === REPORT && p.destino && p.destino.recipient === g.group_name);
let p = meu(fila.esperando_decisao) || meu(fila.aprovados_para_enviar);
if (!p) { log({ erro: 'pedido_novo_nao_apareceu_na_fila' }); process.exit(1); }
const id = 'semana:' + p.approval_id;
const diario = fs.existsSync(ESTADO) ? fs.readFileSync(ESTADO, 'utf8') : '';
if (diario.includes('"id":"' + id + '"') && /"fase":"(envio|intencao)"/.test(diario.split('\n').filter((l) => l.includes(id)).join('\n'))) { log({ erro: 'ja_ha_envio_ou_intencao_para_este_pedido', id }); process.exit(1); }
if (p.mensagem !== rel.summary && textoProibido(p.mensagem)) { log({ erro: 'mensagem_do_pedido_reprovada' }); process.exit(1); }

if (meu(fila.esperando_decisao)) {
  await mcp('aceleriq_central_review_decidir', { operator: 'default', approval_id: p.approval_id, decision: 'aprovado', evidence: ORDEM, idempotency_key: chaveBase + ':dec' });
  anotar({ fase: 'aprovado', id, grupo: g.group_name, fora_da_janela: true });
  log({ evento: 'aprovado_pela_ordem_do_dono', id });
}
anotar({ fase: 'intencao', id, grupo: g.group_name, fora_da_janela: true });
const r = await fetch('http://127.0.0.1:3049/send', { method: 'POST', signal: AbortSignal.timeout(75000),
  headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ chatId: g.chat_id, message: p.mensagem }) });
const j = await r.json().catch(() => ({}));
if (!r.ok || j.error) {
  anotar({ fase: 'intencao', id, grupo: g.group_name, desfeita: true });
  log({ erro: 'ponte_recusou', status: r.status, motivo: String(j.error || '').slice(0, 200) }); process.exit(1);
}
const enviadoEm = new Date().toISOString();
anotar({ fase: 'envio', id, grupo: g.group_name, message_id: j.messageId || null, enviado_em: enviadoEm, fora_da_janela: true });
log({ evento: 'enviado_ao_grupo', id, grupo: g.group_name, message_id: j.messageId || null, enviado_em: enviadoEm });
await mcp('aceleriq_central_review_marcar_enviado', { operator: 'default', approval_id: p.approval_id,
  evidence: 'Enviado no grupo "' + g.group_name + '" pelo WhatsApp da Aceleriq em ' + enviadoEm + (j.messageId ? ', mensagem ' + j.messageId : '') + ' (envio único fora da janela, por ordem do dono).', idempotency_key: chaveBase + ':env' });
log({ evento: 'marcado_enviado', id });
