#!/usr/bin/env node
// Intermediador dos grupos de cliente (25/11/2026), lado do servidor do Hermes.
// Quem decide é o painel (MCP aceleriq_intermediador_rodada: escuta a pessoa marcada, julga com o Jev, abre a
// fila). Este script, a cada minuto, só pede a rodada, manda pela ponte do 3429 o que o painel devolveu e confirma
// cada envio (aceleriq_intermediador_envio_feito). Não escreve texto, não decide nada sobre o cliente.
// Modos (INTERMEDIADOR_MODO): "previa" (padrão) manda cada texto só ao dono, marcado "[Prévia → grupo]", e o assunto
// fecha como prévia; "grupos" é o real (só com ok do Almir). Aviso ao dono sai nos dois modos.
// Estado em /var/lib/aceleriq-intermediador/diario.jsonl. Envio com resultado incerto nunca é repetido sozinho.
// Não imprime chave, token nem número de cliente.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const MODO = process.env.INTERMEDIADOR_MODO === 'grupos' ? 'grupos' : 'previa';
// Piloto (25/11/2026, ok do Almir "Sim, pode ligar Verzelo"): clientes (client_id) que já saem de verdade no
// grupo mesmo com o modo geral em prévia. Separados por vírgula. Os outros continuam indo só ao dono.
const CLIENTES_REAIS = new Set(String(process.env.INTERMEDIADOR_CLIENTES_REAIS || '').split(',').map((s) => s.trim()).filter(Boolean));
const OPERADOR = process.env.INTERMEDIADOR_OPERADOR || 'default';
const MCP_URL = process.env.INTERMEDIADOR_MCP_URL || 'https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/mcp-server';
const PONTE = process.env.INTERMEDIADOR_PONTE || 'http://127.0.0.1:3049';
const GRUPOS_ARQ = process.env.INTERMEDIADOR_GRUPOS || '/etc/mercurio-pilot/allowed-groups.json';
const TOKEN_ARQ = '/etc/mercurio-pilot/bridge.token';
const ENV_ARQ = '/root/.hermes/.env';
const ESTADO_DIR = process.env.INTERMEDIADOR_ESTADO || '/var/lib/aceleriq-intermediador';
// Outros envios automáticos no mesmo grupo (lembrete, mensagem da semana, post no ar): pergunta nova não sai colada.
const OUTROS_DIARIOS = ['/var/lib/aceleriq-grupo-cliente/diario.jsonl', '/var/lib/aceleriq-post-no-ar/diario.jsonl'];
const DONO = '554198848435@s.whatsapp.net'; // o mesmo destino individual liberado no pilot_guard.mjs
export const MAX_POR_RODADA = 4;
export const FOLGA_DE_OUTRO_ENVIO_MS = 10 * 60 * 1000;
export const TENTATIVAS_RECUSADAS = 3;

const log = (o) => console.log(JSON.stringify(Object.assign({ em: new Date().toISOString(), modo: MODO }, o)));
const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));

// ---------------------------------------------------------------- regras puras (testadas em intermediador.test.mjs)
export function lerGrupos(json) {
  const d = typeof json === 'string' ? JSON.parse(json) : json;
  return new Map((d.groups || []).map((g) => [String(g.chat_id), { nome: String(g.group_name), client_id: String(g.client_id || '') }]));
}
/** O envio ao grupo só sai se o chat estiver na lista da ponte e o painel tiver o mesmo nome e o mesmo cliente. */
export function destinoConfere(envio, grupos) {
  if (envio.destino !== 'grupo') return envio.destino === 'dono';
  const g = grupos.get(String(envio.chat_id || ''));
  return !!g && g.nome === envio.grupo_nome && (!g.client_id || g.client_id === envio.client_id);
}
/** Menção só de número de pessoa, e com o @numero no texto (a ponte confere de novo). */
export function mencoesConferem(envio) {
  const m = envio.mencoes || [];
  if (envio.destino !== 'grupo') return m.length === 0;
  return m.length <= 2 && m.every((j) => { const n = /^(\d{10,16})@s\.whatsapp\.net$/.exec(j); return !!n && String(envio.texto).includes('@' + n[1]); });
}
export function textoDaPrevia(envio) {
  return envio.destino === 'dono' ? envio.texto : '[Prévia → "' + envio.grupo_nome + '" · ' + envio.tipo + ']\n\n' + envio.texto_previa;
}
/** Último envio automático por nome de grupo nos outros diários. */
export function ultimoPorGrupo(linhas) {
  const m = new Map();
  for (const e of linhas) {
    if (!e || !e.grupo || (e.fase !== 'envio' && e.fase !== 'intencao') || e.desfeita === true) continue;
    const t = Date.parse(e.enviado_em || e.em);
    if (Number.isFinite(t) && t > (m.get(e.grupo) || 0)) m.set(e.grupo, t);
  }
  return m;
}
/** O modo deste envio: real se o modo geral for real ou se o cliente estiver no piloto. */
export function modoDoEnvio(envio, modoGeral, clientesReais) {
  return modoGeral === 'grupos' || (clientesReais && clientesReais.has(String(envio.client_id || ''))) ? 'grupos' : 'previa';
}
/** O que fazer com um envio nesta rodada. */
export function planoDoEnvio(envio, { modo: modoGeral, clientesReais, grupos, diario, outros, agora }) {
  const modo = modoDoEnvio(envio, modoGeral, clientesReais);
  if (!destinoConfere(envio, grupos)) return { acao: 'pular', motivo: 'destino_fora_da_lista' };
  if (!mencoesConferem(envio)) return { acao: 'pular', motivo: 'mencao_invalida' };
  const intencao = diario.get('intencao:' + envio.envio_id);
  if (intencao && intencao.desfeita !== true) return { acao: 'incerto', motivo: 'intencao_sem_resultado' };
  if ((diario.get('recusas:' + envio.envio_id) || 0) >= TENTATIVAS_RECUSADAS) return { acao: 'incerto', motivo: 'recusado_pela_ponte' };
  if (modo === 'previa' || envio.destino === 'dono') return { acao: modo === 'previa' && envio.destino === 'grupo' ? 'previa' : 'dono' };
  if (envio.tipo === 'pergunta' || envio.tipo === 'lembrete') {
    const outro = outros.get(envio.grupo_nome) || 0;
    if (agora - outro < FOLGA_DE_OUTRO_ENVIO_MS) return { acao: 'esperar', motivo: 'outro_envio_recente' };
  }
  return { acao: 'grupo' };
}

// ---------------------------------------------------------------- entrada e saída
function lerLinhas(arq) {
  try { return fs.readFileSync(arq, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
  catch { return []; }
}
function anotar(e) {
  fs.mkdirSync(ESTADO_DIR, { recursive: true, mode: 0o700 });
  fs.appendFileSync(ESTADO_DIR + '/diario.jsonl', JSON.stringify(Object.assign({ em: new Date().toISOString() }, e)) + '\n', { mode: 0o600 });
}
export function diarioEmMapa(linhas) {
  const m = new Map();
  for (const e of linhas) {
    if (e.fase === 'recusa') m.set('recusas:' + e.id, (m.get('recusas:' + e.id) || 0) + 1);
    else m.set(e.fase + ':' + e.id, e);
  }
  return m;
}
function chaveDoPainel() {
  if (process.env.MCP_ACELERIQ_API_KEY) return process.env.MCP_ACELERIQ_API_KEY.trim();
  const linha = fs.readFileSync(ENV_ARQ, 'utf8').split('\n').find((l) => l.startsWith('MCP_ACELERIQ_API_KEY='));
  if (!linha) throw new Error('MCP_ACELERIQ_API_KEY ausente');
  return linha.slice(linha.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
}
let seq = 0;
async function mcp(chave, nome, argumentos) {
  const r = await fetch(MCP_URL, { method: 'POST', signal: AbortSignal.timeout(90000),
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
async function ponte(token, corpo) {
  const r = await fetch(PONTE + '/send', { method: 'POST', signal: AbortSignal.timeout(75000),
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify(corpo) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) { const e = new Error('ponte ' + r.status + ': ' + String(j.error || '').slice(0, 200)); e.status = r.status; throw e; }
  return j;
}
// Recusa antes de enviar (trava, nome do grupo, desconectado): nada saiu. Erro 500 ou tempo esgotado: incerto.
const nadaSaiu = (e) => [400, 401, 403, 503].includes(e && e.status);

async function confirmar(chave, envio_id, resultado, message_id) {
  return mcp(chave, 'aceleriq_intermediador_envio_feito', Object.assign({ operator: OPERADOR, envio_id, resultado }, message_id ? { message_id } : {}));
}

async function main() {
  const chave = chaveDoPainel();
  const token = fs.readFileSync(TOKEN_ARQ, 'utf8').trim();
  const grupos = lerGrupos(fs.readFileSync(GRUPOS_ARQ, 'utf8'));
  const diario = diarioEmMapa(lerLinhas(ESTADO_DIR + '/diario.jsonl'));
  const outros = ultimoPorGrupo(OUTROS_DIARIOS.flatMap(lerLinhas));

  const rodada = await mcp(chave, 'aceleriq_intermediador_rodada', { operator: OPERADOR, modo: MODO });
  log({ evento: 'rodada', feito: rodada.feito || {}, envios: (rodada.envios || []).length, clientes_reais: CLIENTES_REAIS.size });
  let feitos = 0;
  for (const envio of rodada.envios || []) {
    if (feitos >= MAX_POR_RODADA) break;
    const plano = planoDoEnvio(envio, { modo: MODO, clientesReais: CLIENTES_REAIS, grupos, diario, outros, agora: Date.now() });
    const id = envio.envio_id;
    if (plano.acao === 'pular' || plano.acao === 'esperar') { log({ evento: plano.acao, id, tipo: envio.tipo, motivo: plano.motivo }); continue; }
    if (plano.acao === 'incerto') {
      await confirmar(chave, id, 'incerto');
      anotar({ fase: 'incerto', id, grupo: envio.grupo_nome, motivo: plano.motivo });
      log({ evento: 'incerto_nao_repetido', id, tipo: envio.tipo, motivo: plano.motivo });
      continue;
    }
    const corpo = plano.acao === 'grupo'
      ? Object.assign({ chatId: envio.chat_id, message: envio.texto }, envio.mencoes.length ? { mentions: envio.mencoes } : {})
      : { chatId: DONO, message: textoDaPrevia(envio) };
    anotar({ fase: 'intencao', id, grupo: envio.grupo_nome, tipo: envio.tipo, para: plano.acao });
    let r;
    try {
      r = await ponte(token, corpo);
    } catch (e) {
      if (nadaSaiu(e)) {
        anotar({ fase: 'intencao', id, grupo: envio.grupo_nome, desfeita: true });
        anotar({ fase: 'recusa', id, grupo: envio.grupo_nome, erro: String(e.message).slice(0, 160) });
        log({ evento: 'ponte_recusou', id, tipo: envio.tipo, erro: String(e.message).slice(0, 160) });
      } else {
        log({ evento: 'envio_incerto', id, tipo: envio.tipo, erro: String(e.message).slice(0, 160) });
        await confirmar(chave, id, 'incerto').catch(() => {});
      }
      continue;
    }
    anotar({ fase: 'envio', id, grupo: envio.grupo_nome, tipo: envio.tipo, para: plano.acao, message_id: r.messageId || null, enviado_em: new Date().toISOString() });
    // Prévia de texto ao grupo vira "previa" no painel; aviso ao dono e envio real viram "enviado".
    const resultado = plano.acao === 'previa' ? 'previa' : 'enviado';
    await confirmar(chave, id, resultado, plano.acao === 'previa' ? undefined : r.messageId);
    feitos++;
    log({ evento: resultado === 'previa' ? 'previa_ao_dono' : plano.acao === 'dono' ? 'aviso_ao_dono' : 'enviado_no_grupo', id, tipo: envio.tipo });
    await dormir(3000);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => { log({ evento: 'falhou', erro: String(e && e.message || e).slice(0, 300) }); process.exitCode = 1; });
}
