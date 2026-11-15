#!/usr/bin/env node
// Aviso de "post novo no ar" no grupo do cliente (09/11/2026).
// O n8n (ACQ-03) prepara o aviso no painel, com o texto congelado e o nome exato do grupo. Este script, no servidor
// do Hermes, aprova pela regra permanente do dono, envia pela ponte do WhatsApp (3429, só os grupos liberados em
// /etc/mercurio-pilot/allowed-groups.json, só texto) e registra o envio no painel.
// Modos (POST_NO_AR_MODO): "previa" manda cada aviso só ao dono, uma vez, sem aprovar nem marcar; "grupos" é o real.
// Não imprime chave nem token. Estado em /var/lib/aceleriq-post-no-ar/diario.jsonl.
import fs from 'node:fs';

const MODO = process.env.POST_NO_AR_MODO === 'grupos' ? 'grupos' : 'previa';
const OPERADOR = process.env.POST_NO_AR_OPERADOR || 'default';
const MCP_URL = process.env.POST_NO_AR_MCP_URL || 'https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/mcp-server';
const PONTE = process.env.POST_NO_AR_PONTE || 'http://127.0.0.1:3049';
const GRUPOS_ARQ = '/etc/mercurio-pilot/allowed-groups.json';
const TOKEN_ARQ = '/etc/mercurio-pilot/bridge.token';
const ENV_ARQ = '/root/.hermes/.env';
const ESTADO_DIR = process.env.POST_NO_AR_ESTADO || '/var/lib/aceleriq-post-no-ar';
const DONO = '554198848435@s.whatsapp.net'; // o mesmo destino individual liberado no pilot_guard.mjs
const MAX_POR_RODADA = 3;
const CABECALHO = '*Post novo no ar*';
const REGRA_DO_DONO = 'Regra permanente do Almir, dada em 09/11/2026 no chat com o Claude: "avisa e manda só quando o post foi publicado na rede, então se ele foi publicado já foi aprovado". Vale só para aviso de post no ar preparado pelo n8n para o grupo do próprio cliente.';

const log = (o) => console.log(JSON.stringify(Object.assign({ em: new Date().toISOString(), modo: MODO }, o)));
const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));

function chaveDoPainel() {
  if (process.env.MCP_ACELERIQ_API_KEY) return process.env.MCP_ACELERIQ_API_KEY.trim();
  const linha = fs.readFileSync(ENV_ARQ, 'utf8').split('\n').find((l) => l.startsWith('MCP_ACELERIQ_API_KEY='));
  if (!linha) throw new Error('MCP_ACELERIQ_API_KEY ausente');
  return linha.slice(linha.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
}

let seq = 0;
async function mcp(chave, nome, argumentos) {
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

async function ponte(token, caminho, corpo) {
  const r = await fetch(PONTE + caminho, { method: corpo ? 'POST' : 'GET', signal: AbortSignal.timeout(75000),
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: corpo ? JSON.stringify(corpo) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('ponte ' + caminho + ' ' + r.status + ': ' + String(j.error || '').slice(0, 200));
  return j;
}

function lerDiario() {
  const arq = ESTADO_DIR + '/diario.jsonl';
  const m = new Map();
  if (fs.existsSync(arq)) for (const l of fs.readFileSync(arq, 'utf8').split('\n').filter(Boolean)) { try { const e = JSON.parse(l); m.set(e.fase + ':' + e.aviso_id, e); } catch { /* linha ruim não derruba */ } }
  return m;
}
function anotar(e) { fs.mkdirSync(ESTADO_DIR, { recursive: true, mode: 0o700 }); fs.appendFileSync(ESTADO_DIR + '/diario.jsonl', JSON.stringify(Object.assign({ em: new Date().toISOString() }, e)) + '\n', { mode: 0o600 }); }

// Só aviso do n8n para o grupo do próprio cliente: canal whatsapp, nome exato do grupo liberado e texto no molde.
function ehNosso(a, grupos) {
  const g = grupos.get(String(a.client_id));
  const d = a.destino || {};
  return !!g && d.channel === 'whatsapp' && d.recipient === g.nome && typeof a.mensagem === 'string' && a.mensagem.startsWith(CABECALHO + '\n') && /https:\/\/www\.instagram\.com\/(p|reel|tv)\/[A-Za-z0-9_-]+\/?$/.test(a.mensagem.trim().split('\n').pop());
}

async function main() {
  const chave = chaveDoPainel();
  const token = fs.readFileSync(TOKEN_ARQ, 'utf8').trim();
  const grupos = new Map(JSON.parse(fs.readFileSync(GRUPOS_ARQ, 'utf8')).groups.map((g) => [String(g.client_id), { chat: String(g.chat_id), nome: String(g.group_name) }]));
  const diario = lerDiario();
  let fila = await mcp(chave, 'aceleriq_aviso_publicacao_fila', { operator: OPERADOR });
  const esperando = (fila.esperando_decisao || []).filter((a) => ehNosso(a, grupos));

  if (MODO === 'previa') {
    let n = 0;
    for (const a of esperando) {
      if (n >= MAX_POR_RODADA) break;
      if (diario.has('previa:' + a.aviso_id)) continue;
      const g = grupos.get(String(a.client_id));
      const r = await ponte(token, '/send', { chatId: DONO, message: '[Prévia. Iria para o grupo "' + g.nome + '"]\n\n' + a.mensagem });
      anotar({ fase: 'previa', aviso_id: a.aviso_id, grupo: g.nome, message_id: r.messageId || null });
      log({ evento: 'previa_enviada_ao_dono', aviso_id: a.aviso_id, grupo: g.nome }); n++; await dormir(4000);
    }
    log({ evento: 'fim', esperando: esperando.length, previas: n });
    return;
  }

  // modo real: aprova pela regra do dono
  for (const a of esperando) {
    try {
      await mcp(chave, 'aceleriq_aviso_publicacao_decidir', { operator: OPERADOR, aviso_id: a.aviso_id, decision: 'aprovado', evidence: REGRA_DO_DONO, idempotency_key: 'pna-dec-' + a.aviso_id });
      log({ evento: 'aprovado_pela_regra', aviso_id: a.aviso_id });
    } catch (e) { log({ evento: 'falha_ao_aprovar', aviso_id: a.aviso_id, erro: String(e.message).slice(0, 200) }); }
  }
  if (esperando.length) fila = await mcp(chave, 'aceleriq_aviso_publicacao_fila', { operator: OPERADOR });
  const aprovados = (fila.aprovados_para_enviar || []).filter((a) => ehNosso(a, grupos));
  let enviados = 0;
  for (const a of aprovados) {
    if (enviados >= MAX_POR_RODADA) break;
    const g = grupos.get(String(a.client_id));
    let ja = diario.get('envio:' + a.aviso_id);
    try {
      if (!ja) {
        // intenção antes do envio: se cair no meio, a próxima rodada não manda de novo às cegas
        const antes = diario.get('intencao:' + a.aviso_id);
        if (antes && antes.desfeita !== true) { log({ evento: 'envio_incerto_nao_repetido', aviso_id: a.aviso_id, grupo: g.nome }); continue; }
        anotar({ fase: 'intencao', aviso_id: a.aviso_id, grupo: g.nome });
        let r;
        try { r = await ponte(token, '/send', { chatId: g.chat, message: a.mensagem }); }
        catch (e) {
          // falha limpa (ponte fora do ar, grupo recusado pela guarda): pode tentar de novo. Tempo esgotado ou resultado incerto: nunca repete sozinho.
          if (!/indeterminate|timeout|aborted|terminated/i.test(String(e.message))) anotar({ fase: 'intencao', aviso_id: a.aviso_id, grupo: g.nome, desfeita: true });
          throw e;
        }
        ja = { fase: 'envio', aviso_id: a.aviso_id, grupo: g.nome, message_id: r.messageId || null, enviado_em: new Date().toISOString() };
        anotar(ja); enviados++;
        log({ evento: 'enviado_ao_grupo', aviso_id: a.aviso_id, grupo: g.nome, message_id: ja.message_id });
      }
      await mcp(chave, 'aceleriq_aviso_publicacao_marcar_enviado', { operator: OPERADOR, aviso_id: a.aviso_id,
        evidence: 'Enviado no grupo "' + g.nome + '" pelo WhatsApp da Aceleriq em ' + (ja.enviado_em || ja.em) + (ja.message_id ? ', mensagem ' + ja.message_id : '') + ' (envio automático do post no ar).',
        idempotency_key: 'pna-env-' + a.aviso_id });
      log({ evento: 'marcado_enviado', aviso_id: a.aviso_id });
      await dormir(5000);
    } catch (e) { log({ evento: 'falha_no_envio', aviso_id: a.aviso_id, grupo: g.nome, erro: String(e.message).slice(0, 200) }); }
  }
  log({ evento: 'fim', esperando: esperando.length, aprovados: aprovados.length, enviados });
}

main().catch((e) => { log({ evento: 'erro', erro: String(e && e.message).slice(0, 300) }); process.exit(1); });
