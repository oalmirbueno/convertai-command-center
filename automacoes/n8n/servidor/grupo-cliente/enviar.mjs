#!/usr/bin/env node
// Mensagens da Aceleriq no grupo do cliente (10/11/2026): lembrete de aprovação e mensagem da semana (seg, qua, sex).
// Quem escreve é o painel (lembrete) e o n8n com o escritor da Central (mensagem da semana). Este script, no servidor
// do Hermes, só confere, aprova pela regra permanente do dono, envia pela ponte do WhatsApp (3429, só os grupos de
// /etc/mercurio-pilot/allowed-groups.json, só texto) e registra o envio no painel.
// Modos (GRUPO_CLIENTE_MODO): "previa" manda cada texto só ao dono, uma vez, sem aprovar nem marcar; "grupos" é o real.
// GRUPO_CLIENTE_LIGADOS escolhe o que roda: "lembrete,semana". Não imprime chave nem token.
// Estado em /var/lib/aceleriq-grupo-cliente/diario.jsonl. Envio com resultado incerto nunca é repetido sozinho.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const MODO = process.env.GRUPO_CLIENTE_MODO === 'grupos' ? 'grupos' : 'previa';
const LIGADOS = String(process.env.GRUPO_CLIENTE_LIGADOS || 'lembrete,semana').split(',').map((s) => s.trim()).filter(Boolean);
const OPERADOR = process.env.GRUPO_CLIENTE_OPERADOR || 'default';
const MCP_URL = process.env.GRUPO_CLIENTE_MCP_URL || 'https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/mcp-server';
const PONTE = process.env.GRUPO_CLIENTE_PONTE || 'http://127.0.0.1:3049';
const GRUPOS_ARQ = process.env.GRUPO_CLIENTE_GRUPOS || '/etc/mercurio-pilot/allowed-groups.json';
const TOKEN_ARQ = '/etc/mercurio-pilot/bridge.token';
const ENV_ARQ = '/root/.hermes/.env';
const ESTADO_DIR = process.env.GRUPO_CLIENTE_ESTADO || '/var/lib/aceleriq-grupo-cliente';
const DIARIO_POST_NO_AR = '/var/lib/aceleriq-post-no-ar/diario.jsonl';
const DONO = '554198848435@s.whatsapp.net'; // o mesmo destino individual liberado no pilot_guard.mjs
const MAX_POR_RODADA = 4;
const INTERVALO_NO_GRUPO_MS = 10 * 60 * 1000; // nunca dois textos seguidos no mesmo grupo
const AUTOR_DA_SEMANA = 'n8n:ACQ-11';
const REGRA_DO_DONO = 'Regra permanente do Almir, dada em 10/11/2026 no chat com o Claude: a mensagem de segunda, quarta e sexta e o lembrete de aprovação saem sozinhos no grupo do próprio cliente, pelo mesmo número dos avisos, desde que o texto venha do escritor da Central e passe na conferência do Jev.';

// Relatório semanal de anúncios (ACQ-15, 11/11/2026): frente própria, "anuncios" em GRUPO_CLIENTE_LIGADOS. Tem modo
// próprio (GRUPO_CLIENTE_ANUNCIOS_MODO, padrão "previa": só o dono recebe) e só vai ao grupo quando a autorização do
// dono estiver escrita em GRUPO_CLIENTE_REGRA_ANUNCIOS. Sem esse texto nada é aprovado.
const AUTOR_DOS_ANUNCIOS = 'n8n:ACQ-15';
const REGRA_DOS_ANUNCIOS = String(process.env.GRUPO_CLIENTE_REGRA_ANUNCIOS || '').trim();
const MODO_ANUNCIOS = MODO === 'grupos' && process.env.GRUPO_CLIENTE_ANUNCIOS_MODO === 'grupos' && REGRA_DOS_ANUNCIOS.length >= 40 ? 'grupos' : 'previa';
export const JANELA_ANUNCIOS = { dia: 2, hora: 9 }; // terça, a partir das 9h

export const RITUAIS = { rota_semana: { dia: 1, hora: 8 }, meio_semana: { dia: 3, hora: 18 }, prova_movimento: { dia: 5, hora: 18 } };

const log = (o) => console.log(JSON.stringify(Object.assign({ em: new Date().toISOString(), modo: MODO }, o)));
const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));

// ---------------------------------------------------------------- regras puras (testadas em enviar.test.mjs)
export function agoraSP(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const dias = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { data: p.year + '-' + p.month + '-' + p.day, dia_semana: dias[p.weekday], hora: Number(p.hour) % 24, minuto: Number(p.minute) };
}
export function segundaDaSemana(dataISO) {
  const d = new Date(dataISO + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
// Palavras que nunca vão ao cliente, mesmo que o resto tenha passado.
export function textoProibido(t) {
  const s = String(t || '');
  if (/(?<!\p{L})ritua(l|is)(?!\p{L})/iu.test(s)) return 'palavra_ritual';
  if (/(?<!\p{L})(dossi[êe]s?|hermes|n8n|jev|mcp|clio|grok|bot|payload|idempot\p{L}*|dry.?run)(?!\p{L})/iu.test(s)) return 'termo_interno';
  if (/\[(pr[ée]via|interno|rascunho)/i.test(s)) return 'marca_interna';
  if (s.trim().length < 40) return 'curto_demais';
  if (s.length > 2000) return 'longo_demais';
  return null;
}
// A mensagem da semana só sai no dia dela, a partir da hora combinada e até as 20h; pedido de outra semana nunca sai.
export function janelaDaSemana(ritual, ms) {
  const r = RITUAIS[ritual];
  if (!r) return 'ritual_desconhecido';
  const a = agoraSP(ms);
  if (a.dia_semana !== r.dia) return 'fora_do_dia';
  if (a.hora < r.hora) return 'antes_da_hora';
  if (a.hora >= 20) return 'depois_das_20h';
  return null;
}
export function lembreteNoHorario(ms) {
  const a = agoraSP(ms);
  return a.dia_semana >= 1 && a.dia_semana <= 5 && a.hora >= 9 && a.hora < 18;
}
export function destinoConfere(item, grupos) {
  const g = grupos.get(String(item.client_id));
  const d = item.destino || {};
  return !!g && d.channel === 'whatsapp' && d.recipient === g.nome;
}
// Pedido da mensagem da semana que este script pode aprovar: escrito pelo fluxo do n8n, conferido, desta semana.
// Na prévia (só o dono recebe) vale também o ensaio do fluxo e não há janela de horário.
export function semanaAprovavel(pedido, relatorio, grupos, ms, previa = false) {
  if (!RITUAIS[pedido.ritual]) return 'nao_e_mensagem_da_semana';
  if (!destinoConfere(pedido, grupos)) return 'destino_fora_da_lista';
  const m = (relatorio && relatorio.metrics) || {};
  if (m.written_by !== AUTOR_DA_SEMANA) return 'nao_veio_do_fluxo';
  const c = m.conferencia || {};
  if (c.ok !== true) return 'sem_conferencia_aprovada';
  const ensaio = previa && String(c.semana || '').startsWith('ensaio:');
  if ((!ensaio && c.semana !== segundaDaSemana(agoraSP(ms).data)) || c.ritual !== pedido.ritual) return 'de_outra_semana';
  if (pedido.valid_until && Date.parse(pedido.valid_until) <= ms) return 'vencido';
  return textoProibido(pedido.mensagem) || (previa ? null : janelaDaSemana(pedido.ritual, ms));
}
// O relatório de anúncios sai na terça, das 9h às 20h, e fala da semana fechada anterior (segunda a domingo).
export function janelaDosAnuncios(ms) {
  const a = agoraSP(ms);
  if (a.dia_semana !== JANELA_ANUNCIOS.dia) return 'fora_do_dia';
  if (a.hora < JANELA_ANUNCIOS.hora) return 'antes_da_hora';
  if (a.hora >= 20) return 'depois_das_20h';
  return null;
}
export function semanaFechada(ms) {
  const d = new Date(segundaDaSemana(agoraSP(ms).data) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}
// Pedido do relatório de anúncios que este script pode aprovar: sem ritual, escrito pelo ACQ-15, conferido, da semana
// fechada anterior, para o grupo exato. Na prévia vale também o ensaio do fluxo e não há janela de horário.
export function anunciosAprovavel(pedido, relatorio, grupos, ms, previa = false) {
  if (pedido.ritual && RITUAIS[pedido.ritual]) return 'e_mensagem_da_semana';
  if (!destinoConfere(pedido, grupos)) return 'destino_fora_da_lista';
  const m = (relatorio && relatorio.metrics) || {};
  if (m.written_by !== AUTOR_DOS_ANUNCIOS || m.relatorio !== 'anuncios_semana') return 'nao_veio_do_fluxo';
  const c = m.conferencia || {};
  if (c.ok !== true) return 'sem_conferencia_aprovada';
  const ensaio = previa && String(c.semana || '').startsWith('ensaio:');
  if (!ensaio && c.semana !== semanaFechada(ms)) return 'de_outra_semana';
  if (pedido.valid_until && Date.parse(pedido.valid_until) <= ms) return 'vencido';
  if (/R\$\s?\d/.test(String(pedido.mensagem || ''))) return 'valor_em_reais';
  return textoProibido(pedido.mensagem) || (previa ? null : janelaDosAnuncios(ms));
}
export function lembreteEnviavel(m, grupos, ms, previa = false) {
  if (m.tipo !== 'lembrete_aprovacao') return 'nao_e_lembrete';
  if (!destinoConfere(m, grupos)) return 'destino_fora_da_lista';
  if (m.enviar_ate && Date.parse(m.enviar_ate) <= ms) return 'vencido';
  if (!previa && !lembreteNoHorario(ms)) return 'fora_do_horario';
  if (!/https:\/\/aceleriq\.online\/\S+/.test(String(m.mensagem || ''))) return 'sem_link';
  return textoProibido(m.mensagem);
}
// Último envio em cada grupo, somando o diário do post no ar: dois textos nunca saem colados.
export function ultimoEnvioPorGrupo(linhas) {
  const m = new Map();
  for (const e of linhas) {
    if (!e || !e.grupo || (e.fase !== 'envio' && e.fase !== 'intencao') || e.desfeita === true) continue;
    const t = Date.parse(e.enviado_em || e.em);
    if (Number.isFinite(t) && t > (m.get(e.grupo) || 0)) m.set(e.grupo, t);
  }
  return m;
}

// ---------------------------------------------------------------- entrada e saída
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
  const r = await fetch(PONTE + caminho, { method: 'POST', signal: AbortSignal.timeout(75000),
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify(corpo) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('ponte ' + caminho + ' ' + r.status + ': ' + String(j.error || '').slice(0, 200));
  return j;
}
function lerLinhas(arq) {
  if (!fs.existsSync(arq)) return [];
  const out = [];
  for (const l of fs.readFileSync(arq, 'utf8').split('\n').filter(Boolean)) { try { out.push(JSON.parse(l)); } catch { /* linha ruim não derruba */ } }
  return out;
}
function anotar(e) { fs.mkdirSync(ESTADO_DIR, { recursive: true, mode: 0o700 }); fs.appendFileSync(ESTADO_DIR + '/diario.jsonl', JSON.stringify(Object.assign({ em: new Date().toISOString() }, e)) + '\n', { mode: 0o600 }); }

// Um envio, com a mesma disciplina do post no ar: intenção antes, falha limpa pode repetir, resultado incerto não.
async function enviar(ctx, id, g, texto, registrar, depois) {
  const { diario, token, ultimo } = ctx;
  let ja = diario.get('envio:' + id);
  let novo = false;
  if (!ja) {
    const antes = diario.get('intencao:' + id);
    if (antes && antes.desfeita !== true) { log({ evento: 'envio_incerto_nao_repetido', id, grupo: g.nome }); return false; }
    if (Date.now() - (ultimo.get(g.nome) || 0) < INTERVALO_NO_GRUPO_MS) { log({ evento: 'aguardando_intervalo_no_grupo', id, grupo: g.nome }); return false; }
    anotar({ fase: 'intencao', id, grupo: g.nome });
    let r;
    try { r = await ponte(token, '/send', { chatId: g.chat, message: texto }); }
    catch (e) {
      if (!/indeterminate|timeout|aborted|terminated/i.test(String(e.message))) anotar({ fase: 'intencao', id, grupo: g.nome, desfeita: true });
      throw e;
    }
    ja = { fase: 'envio', id, grupo: g.nome, message_id: r.messageId || null, enviado_em: new Date().toISOString() };
    anotar(ja); ultimo.set(g.nome, Date.now()); ctx.enviados++; novo = true;
    log({ evento: 'enviado_ao_grupo', id, grupo: g.nome, message_id: ja.message_id });
  }
  await registrar('Enviado no grupo "' + g.nome + '" pelo WhatsApp da Aceleriq em ' + ja.enviado_em + (ja.message_id ? ', mensagem ' + ja.message_id : '') + ' (envio automático).');
  log({ evento: 'marcado_enviado', id });
  // Memória do cliente no painel: só no envio novo, e falha aqui nunca desfaz o envio.
  if (novo && depois) { try { await depois(ja); } catch (e) { log({ evento: 'memoria_nao_gravada', id, erro: String(e.message).slice(0, 160) }); } }
  await dormir(5000);
  return true;
}
async function previa(ctx, id, g, rotulo, texto) {
  if (ctx.diario.has('previa:' + id) || ctx.enviados >= MAX_POR_RODADA) return;
  const r = await ponte(ctx.token, '/send', { chatId: DONO, message: '[Prévia: ' + rotulo + '. Iria para o grupo "' + g.nome + '"]\n\n' + texto });
  anotar({ fase: 'previa', id, grupo: g.nome, message_id: r.messageId || null });
  ctx.enviados++; log({ evento: 'previa_enviada_ao_dono', id, grupo: g.nome }); await dormir(4000);
}

async function lembretes(ctx) {
  const fila = await mcp(ctx.chave, 'aceleriq_mensagens_automaticas_fila', { operator: OPERADOR });
  for (const m of fila.aprovados_para_enviar || []) {
    if (ctx.enviados >= MAX_POR_RODADA) break;
    const id = 'lembrete:' + m.mensagem_id;
    const motivo = lembreteEnviavel(m, ctx.grupos, Date.now(), MODO === 'previa');
    if (motivo) { if (motivo !== 'nao_e_lembrete') log({ evento: 'lembrete_segurado', id, motivo }); continue; }
    const g = ctx.grupos.get(String(m.client_id));
    try {
      if (MODO === 'previa') { await previa(ctx, id, g, 'lembrete de aprovação', m.mensagem); continue; }
      await enviar(ctx, id, g, m.mensagem, (ev) => mcp(ctx.chave, 'aceleriq_mensagens_automaticas_marcar_enviado', { operator: OPERADOR, mensagem_id: m.mensagem_id, evidence: ev, idempotency_key: 'gc-env-' + m.mensagem_id }),
        (ja) => mcp(ctx.chave, 'aceleriq_upsert_project_memory', { client_id: m.client_id, kind: 'aprovacao', source: 'grupo-cliente', title: 'Lembrete de aprovação enviado no grupo',
          content: 'Em ' + ja.enviado_em.slice(0, 10) + ' o lembrete de aprovação saiu sozinho no grupo "' + g.nome + '". Texto enviado:\n' + m.mensagem, tags: ['lembrete', 'whatsapp'], metadata: { client_visible: false, message_id: ja.message_id, mensagem_id: m.mensagem_id } }));
    } catch (e) { log({ evento: 'falha_no_envio', id, grupo: g.nome, erro: String(e.message).slice(0, 200) }); }
  }
}

async function semana(ctx) {
  const agora = Date.now();
  const hoje = agoraSP(agora);
  if (MODO !== 'previa' && !Object.values(RITUAIS).some((r) => r.dia === hoje.dia_semana)) return;
  let fila = await mcp(ctx.chave, 'aceleriq_central_review_fila', { operator: OPERADOR });
  const candidatos = (fila.esperando_decisao || []).filter((p) => RITUAIS[p.ritual] && destinoConfere(p, ctx.grupos));
  const meus = new Set();
  for (const p of candidatos) {
    const id = 'semana:' + p.approval_id;
    let rel;
    try { rel = (await mcp(ctx.chave, 'aceleriq_get_report', { report_id: p.report_id })).report; } catch (e) { log({ evento: 'falha_ao_ler_relatorio', id, erro: String(e.message).slice(0, 160) }); continue; }
    const motivo = semanaAprovavel(p, rel, ctx.grupos, agora, MODO === 'previa');
    if (motivo) { log({ evento: 'semana_segurada', id, motivo }); continue; }
    const g = ctx.grupos.get(String(p.client_id));
    try {
      if (MODO === 'previa') { await previa(ctx, id, g, 'mensagem da semana', p.mensagem); continue; }
      await mcp(ctx.chave, 'aceleriq_central_review_decidir', { operator: OPERADOR, approval_id: p.approval_id, decision: 'aprovado', evidence: REGRA_DO_DONO, idempotency_key: 'gc-dec-' + p.approval_id });
      anotar({ fase: 'aprovado', id, grupo: g.nome }); meus.add(p.approval_id);
      log({ evento: 'aprovado_pela_regra', id });
    } catch (e) { log({ evento: 'falha_ao_aprovar', id, erro: String(e.message).slice(0, 200) }); }
  }
  if (MODO === 'previa') return;
  if (meus.size) fila = await mcp(ctx.chave, 'aceleriq_central_review_fila', { operator: OPERADOR });
  // Só envia o que ESTE script aprovou (no diário): pedido aprovado por outro caminho, novo ou antigo, não é dele.
  for (const p of fila.aprovados_para_enviar || []) {
    if (ctx.enviados >= MAX_POR_RODADA) break;
    const id = 'semana:' + p.approval_id;
    if (!ctx.diario.has('aprovado:' + id) && !meus.has(p.approval_id)) continue;
    const motivo = !destinoConfere(p, ctx.grupos) ? 'destino_fora_da_lista' : (p.valid_until && Date.parse(p.valid_until) <= Date.now()) ? 'vencido' : textoProibido(p.mensagem) || janelaDaSemana(p.ritual, Date.now());
    if (motivo) { log({ evento: 'semana_segurada', id, motivo }); continue; }
    const g = ctx.grupos.get(String(p.client_id));
    try {
      await enviar(ctx, id, g, p.mensagem, (ev) => mcp(ctx.chave, 'aceleriq_central_review_marcar_enviado', { operator: OPERADOR, approval_id: p.approval_id, evidence: ev, idempotency_key: 'gc-env-' + p.approval_id }));
    } catch (e) { log({ evento: 'falha_no_envio', id, grupo: g.nome, erro: String(e.message).slice(0, 200) }); }
  }
}

// Relatório semanal de anúncios: mesma disciplina da mensagem da semana, com modo e autorização próprios.
async function anuncios(ctx) {
  const previaSo = MODO_ANUNCIOS !== 'grupos';
  if (!previaSo && janelaDosAnuncios(Date.now())) return;
  let fila = await mcp(ctx.chave, 'aceleriq_central_review_fila', { operator: OPERADOR });
  const candidatos = (fila.esperando_decisao || []).filter((p) => !RITUAIS[p.ritual] && destinoConfere(p, ctx.grupos));
  const meus = new Set();
  for (const p of candidatos) {
    const id = 'anuncios:' + p.approval_id;
    let rel;
    try { rel = (await mcp(ctx.chave, 'aceleriq_get_report', { report_id: p.report_id })).report; } catch (e) { log({ evento: 'falha_ao_ler_relatorio', id, erro: String(e.message).slice(0, 160) }); continue; }
    const motivo = anunciosAprovavel(p, rel, ctx.grupos, Date.now(), previaSo);
    if (motivo) { if (motivo !== 'nao_veio_do_fluxo') log({ evento: 'anuncios_segurado', id, motivo }); continue; }
    const g = ctx.grupos.get(String(p.client_id));
    try {
      if (previaSo) { await previa(ctx, id, g, 'relatório de anúncios', p.mensagem); continue; }
      await mcp(ctx.chave, 'aceleriq_central_review_decidir', { operator: OPERADOR, approval_id: p.approval_id, decision: 'aprovado', evidence: REGRA_DOS_ANUNCIOS, idempotency_key: 'gc-dec-' + p.approval_id });
      anotar({ fase: 'aprovado', id, grupo: g.nome }); meus.add(p.approval_id);
      log({ evento: 'aprovado_pela_regra', id });
    } catch (e) { log({ evento: 'falha_ao_aprovar', id, erro: String(e.message).slice(0, 200) }); }
  }
  if (previaSo) return;
  if (meus.size) fila = await mcp(ctx.chave, 'aceleriq_central_review_fila', { operator: OPERADOR });
  for (const p of fila.aprovados_para_enviar || []) {
    if (ctx.enviados >= MAX_POR_RODADA) break;
    const id = 'anuncios:' + p.approval_id;
    if (!ctx.diario.has('aprovado:' + id) && !meus.has(p.approval_id)) continue;
    const motivo = !destinoConfere(p, ctx.grupos) ? 'destino_fora_da_lista' : (p.valid_until && Date.parse(p.valid_until) <= Date.now()) ? 'vencido' : textoProibido(p.mensagem) || janelaDosAnuncios(Date.now());
    if (motivo) { log({ evento: 'anuncios_segurado', id, motivo }); continue; }
    const g = ctx.grupos.get(String(p.client_id));
    try {
      await enviar(ctx, id, g, p.mensagem, (ev) => mcp(ctx.chave, 'aceleriq_central_review_marcar_enviado', { operator: OPERADOR, approval_id: p.approval_id, evidence: ev, idempotency_key: 'gc-env-' + p.approval_id }));
    } catch (e) { log({ evento: 'falha_no_envio', id, grupo: g.nome, erro: String(e.message).slice(0, 200) }); }
  }
}

async function main() {
  const grupos = new Map(JSON.parse(fs.readFileSync(GRUPOS_ARQ, 'utf8')).groups.map((g) => [String(g.client_id), { chat: String(g.chat_id), nome: String(g.group_name) }]));
  const linhas = lerLinhas(ESTADO_DIR + '/diario.jsonl');
  const ctx = { chave: chaveDoPainel(), token: fs.readFileSync(TOKEN_ARQ, 'utf8').trim(), grupos, enviados: 0,
    diario: new Map(linhas.map((e) => [e.fase + ':' + e.id, e])),
    ultimo: ultimoEnvioPorGrupo(linhas.concat(lerLinhas(DIARIO_POST_NO_AR))) };
  for (const [nome, fn] of [['semana', semana], ['anuncios', anuncios], ['lembrete', lembretes]]) {
    if (!LIGADOS.includes(nome)) continue;
    try { await fn(ctx); } catch (e) { log({ evento: 'erro_na_frente', frente: nome, erro: String(e && e.message).slice(0, 300) }); }
  }
  log({ evento: 'fim', ligados: LIGADOS.join(','), enviados: ctx.enviados });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch((e) => { log({ evento: 'erro', erro: String(e && e.message).slice(0, 300) }); process.exit(1); });
