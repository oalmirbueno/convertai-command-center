// Gera os JSONs importáveis dos workflows ACQ (n8n 2.42.x) a partir de lib/, config/ e contratos/.
// O código dos nós Code é exatamente o mesmo de lib/ que os testes locais exercitam.
// Uso: node build/gerar.mjs [--ambiente pilot|test|production] [--saida workflows]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const AMBIENTE = arg('ambiente', 'pilot');
const SAIDA = path.resolve(raiz, arg('saida', AMBIENTE === 'pilot' ? 'workflows' : 'workflows-' + AMBIENTE));
const ler = (rel) => fs.readFileSync(path.join(raiz, rel), 'utf8');
const AMBIENTES = JSON.parse(ler('config/ambientes.json'));
const CONTRATO = JSON.parse(ler('contratos/ferramentas.json'));
if (!AMBIENTES.ambientes[AMBIENTE]) throw new Error('ambiente desconhecido ' + AMBIENTE);
// --mcp-url só para rodar o piloto contra o replay local do snapshot (as regras do ambiente não mudam).
if (arg('mcp-url', null)) AMBIENTES.ambientes[AMBIENTE].mcp_url = arg('mcp-url');
if (arg('jev-url', null)) AMBIENTES.ambientes[AMBIENTE].jev_url = arg('jev-url');

export const IDS = {
  f00: 'AcqF00Ferramenta', e00: 'AcqE00ErrosComum', w01: 'Acq01ContextoRit', w02: 'Acq02DespachoApr',
  w03: 'Acq03PostNoArPub', w04: 'Acq04ConversasCt', w05: 'Acq05DiaPrioRadr',
  w06: 'Acq06ComercialPC', w07: 'Acq07ComercialRs', w08: 'Acq08ComercialRp',
};
// Credenciais só por referência (nome). Os ids são os da instância local de teste; na importação
// em outra instância o n8n pede para escolher a credencial pelo nome.
export const CRED = {
  mcp: { httpBearerAuth: { id: 'AcqCredMcp000001', name: 'ACQ MCP Aceleriq (máquina n8n)' } },
  pg: { postgres: { id: 'AcqCredPg0000001', name: 'ACQ Estado (Postgres acq_n8n)' } },
  wh04: { httpHeaderAuth: { id: 'AcqCredWh0400001', name: 'ACQ Webhook mensagens (segredo)' } },
  wh02: { httpHeaderAuth: { id: 'AcqCredWh0200001', name: 'ACQ Webhook recibos (segredo)' } },
  jev: { httpBearerAuth: { id: 'AcqCredTs0000001', name: 'TypeSafe Jev (servidor)' } },
  // Comercial (ACQ-06/07): token do usuário do sistema da BM e chave do OpenRouter, colados pelo Almir no n8n.
  meta: { httpBearerAuth: { id: 'AcqCredMeta00001', name: 'ACQ WhatsApp Cloud API (Meta)' } },
  google: { googleCalendarOAuth2Api: { id: 'AcqCredGoogle001', name: 'ACQ Google Agenda' } },
  llm: { httpBearerAuth: { id: 'AcqCredLlm000001', name: 'ACQ OpenRouter (Mercúrio)' } },
};

// ---------------------------------------------------------------- código embutido
function codigo(libs, main) {
  // O adaptador vai sempre: é nele que mora acqConfigEfetiva (o CFG de todo nó).
  const todas = ['nucleo', 'adaptador', ...libs.filter((n) => n !== 'adaptador' && n !== 'nucleo')];
  const fontes = todas.map((n) => `// ---- lib/${n}.js\n` + ler(`lib/${n}.js`)).join('\n');
  // Trava: toda função acq* chamada no nó precisa estar definida no código embutido.
  const definidas = new Set([...fontes.matchAll(/^function (acq\w+)/gm)].map((m) => m[1]));
  const chamadas = [...new Set([...(main + ' acqConfigEfetiva(').matchAll(/\b(acq\w+)\s*\(/g)].map((m) => m[1]))];
  const faltando = chamadas.filter((f) => !definidas.has(f));
  if (faltando.length) throw new Error('nó Code chama função não embutida: ' + faltando.join(', '));
  return [
    '// Gerado por build/gerar.mjs — não edite aqui: edite automacoes/n8n/lib e gere de novo.',
    `const AMBIENTE = ${JSON.stringify(AMBIENTE)};`,
    `const AMBIENTES = ${JSON.stringify(AMBIENTES)};`,
    `const CONTRATO = ${JSON.stringify(CONTRATO)};`,
    fontes,
    'const CFG = acqConfigEfetiva(AMBIENTE, AMBIENTES);',
    '// ---- principal',
    main.trim(),
  ].join('\n');
}

// ---------------------------------------------------------------- construtor
class Wf {
  constructor(id, nome, descricao) { this.id = id; this.nome = nome; this.descricao = descricao; this.nodes = []; this.con = {}; this.col = 0; this.lanes = {}; }
  no(nome, type, typeVersion, parameters, extra = {}, lane = 0) {
    if (this.nodes.some((n) => n.name === nome)) throw new Error('nó repetido ' + nome);
    const x = 240 + (extra.col !== undefined ? extra.col : this.col++) * 260;
    delete extra.col;
    this.nodes.push({ id: deterministico(this.id + '|' + nome), name: nome, type, typeVersion, position: [x, 300 + lane * 220], parameters, ...extra });
    return nome;
  }
  liga(de, para, saida = 0, entrada = 0) {
    this.con[de] = this.con[de] || { main: [] };
    while (this.con[de].main.length <= saida) this.con[de].main.push([]);
    this.con[de].main[saida].push({ node: para, type: 'main', index: entrada });
  }
  cadeia(...nomes) { for (let i = 0; i < nomes.length - 1; i++) this.liga(nomes[i], nomes[i + 1]); }
  json() {
    return {
      id: this.id, name: this.nome, active: false, nodes: this.nodes, connections: this.con, pinData: {},
      settings: { executionOrder: 'v1', timezone: 'America/Sao_Paulo', saveManualExecutions: true, saveDataErrorExecution: 'all',
        saveDataSuccessExecution: 'all', callerPolicy: 'workflowsFromSameOwner',
        ...(this.id !== IDS.e00 ? { errorWorkflow: IDS.e00 } : {}) },
      meta: { templateCredsSetupCompleted: false, acq: { gerado_por: 'automacoes/n8n/build/gerar.mjs', ambiente: AMBIENTE, descricao: this.descricao } },
      tags: [],
    };
  }
}
function deterministico(s) {
  let h1 = 0x811c9dc5, h2 = 0x1234567;
  for (let i = 0; i < s.length; i++) { h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0; h2 = Math.imul(h2 + s.charCodeAt(i), 2246822519) >>> 0; }
  const hx = (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0') + (h1 ^ h2).toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'));
  return `${hx.slice(0, 8)}-${hx.slice(8, 12)}-4${hx.slice(13, 16)}-a${hx.slice(17, 20)}-${hx.slice(20, 32)}`;
}

// ---------------------------------------------------------------- nós comuns
const code = (wf, nome, libs, main, extra = {}, lane = 0) =>
  wf.no(nome, 'n8n-nodes-base.code', 2, { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: codigo(libs, main) }, extra, lane);
const pg = (wf, nome, query, extra = {}, lane = 0) =>
  wf.no(nome, 'n8n-nodes-base.postgres', 2.7, { operation: 'executeQuery', query, options: { queryReplacement: '={{ $json.pg }}' } },
    { credentials: CRED.pg, retryOnFail: true, maxTries: 3, waitBetweenTries: 2000, ...extra }, lane);
const ferramenta = (wf, nome, extra = {}, lane = 0) =>
  wf.no(nome, 'n8n-nodes-base.executeWorkflow', 1.4, { source: 'database', workflowId: { __rl: true, mode: 'id', value: IDS.f00, cachedResultName: 'ACQ-00-Ferramenta-Aceleriq' }, mode: 'each', options: { waitForSubWorkflow: true } }, extra, lane);
const cron = (wf, nome, expressao, lane = 0) =>
  wf.no(nome, 'n8n-nodes-base.scheduleTrigger', 1.4, { rule: { interval: [{ field: 'cronExpression', expression: expressao }] } }, { col: 0 }, lane);
const manual = (wf, nome, lane = 0) => wf.no(nome, 'n8n-nodes-base.manualTrigger', 1, {}, { col: 0 }, lane);
const condicaoBool = (expressao) => ({
  conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
    conditions: [{ id: deterministico(expressao), leftValue: expressao, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' },
  looseTypeValidation: true, options: {},
});
const se = (wf, nome, expressao, extra = {}, lane = 0) => wf.no(nome, 'n8n-nodes-base.if', 2.3, condicaoBool(expressao), extra, lane);
const rota = (wf, nome, campo, valores, extra = {}, lane = 0) => wf.no(nome, 'n8n-nodes-base.switch', 3.4, {
  mode: 'rules',
  rules: { values: valores.map((v) => ({ outputKey: v, renameOutput: true, conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [{ id: deterministico(nome + v), leftValue: `={{ ${campo} }}`, rightValue: v, operator: { type: 'string', operation: 'equals' } }], combinator: 'and' } })) },
  options: { fallbackOutput: 'extra', renameFallbackOutput: 'outros' },
}, extra, lane);
const PEDIDO = (wfId) => `function pedido(p, run, extra) { return Object.assign({ workflow_id: ${JSON.stringify(wfId)}, run_id: run, ambiente_chamador: AMBIENTE, paginar: false }, p, extra || {}); }`;

// ================================================================ ACQ-00 Ferramenta
function acq00() {
  const wf = new Wf(IDS.f00, 'ACQ-00-Ferramenta-Aceleriq', 'Adaptador único do MCP Aceleriq: allowlist por workflow, dry-run imposto, erros e paginação.');
  const t = wf.no('Entrada', 'n8n-nodes-base.executeWorkflowTrigger', 1.2, { inputSource: 'passthrough' });
  const g = code(wf, 'Proteger chamada', ['adaptador'], `
return $input.all().map((it) => ({ json: acqProtegerChamada(it.json, CFG, CONTRATO) }));`);
  const r = rota(wf, 'Rota da chamada', '$json.decisao', ['ler', 'escrever']);
  const http = (nome, leitura, lane) => wf.no(nome, 'n8n-nodes-base.httpRequest', 4.5, {
    method: 'POST', url: '={{ $json.mcp_url }}', authentication: 'genericCredentialType', genericAuthType: 'httpBearerAuth',
    sendHeaders: true, headerParameters: { parameters: [{ name: 'Accept', value: 'application/json, text/event-stream' }, { name: 'MCP-Protocol-Version', value: '2025-06-18' }] },
    sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.rpc) }}',
    options: { timeout: leitura ? 30000 : 150000, response: { response: { fullResponse: true, responseFormat: 'json' } } },
  }, { credentials: CRED.mcp, onError: 'continueRegularOutput', ...(leitura ? { retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 } : { retryOnFail: false }) }, lane);
  const hl = http('MCP leitura (com nova tentativa)', true, 0);
  const he = http('MCP escrita (sem nova tentativa)', false, 1);
  const it = code(wf, 'Interpretar resposta', ['adaptador'], `
const req = $('Proteger chamada').first().json;
const resposta = $input.first().json;
let r;
if (req.decisao === 'simular') r = acqSimularEscrita(req);
else if (req.decisao === 'bloquear') r = { ok: false, simulado: false, resultado: null, erro: { tipo: req.motivo === 'nada_a_fazer' ? 'nada_a_fazer' : 'bloqueio_de_escopo', mensagem: req.motivo, pode_repetir: false } };
else {
  r = acqInterpretarResposta(req, resposta);
  if (r.ok && req.client_id_escopo && !acqConferirCliente(r.resultado, req.client_id_escopo)) {
    r = Object.assign({}, r, { ok: false, resultado: null, erro: { tipo: 'dado_de_outro_cliente', mensagem: 'resultado com client_id diferente de ' + req.client_id_escopo, pode_repetir: false } });
  }
}
return [{ json: Object.assign({}, r, { ref: req.ref, ferramenta: req.ferramenta, decisao: req.decisao, motivo: req.motivo, tipo: req.tipo, paginar: req.paginar, client_id_escopo: req.client_id_escopo,
  _req: { argumentos: req.argumentos, run_id: req.run_id, ferramenta: req.ferramenta, tipo: req.tipo, max_paginas: req.max_paginas, mcp_url: req.mcp_url } }) }];`, {}, 0);
  const tem = se(wf, 'Tem mais páginas?', '={{ $json.paginar === true && $json.ok === true && $json.resultado && $json.resultado.has_more === true }}');
  const pl = code(wf, 'Planejar páginas', ['adaptador'], `
const p = $input.first().json;
return acqPlanejarPaginas(p._req, p, p._req.max_paginas).map((x) => ({ json: { offset: x.offset, rpc: x.rpc, mcp_url: p._req.mcp_url } }));`);
  const hp = http('MCP páginas (com nova tentativa)', true, 0);
  const jp = code(wf, 'Juntar páginas', ['adaptador'], `
const primeira = $('Interpretar resposta').first().json;
const demais = $input.all().map((i) => acqInterpretarResposta({ ferramenta: primeira.ferramenta, tipo: 'leitura' }, i.json));
const j = acqJuntarPaginas(primeira, demais);
return [{ json: Object.assign({}, primeira, { ok: j.ok, resultado: j.resultado, erro: j.erro }) }];`);
  const fim = wf.no('Resultado', 'n8n-nodes-base.noOp', 1, {}, { col: 6 }, 1);
  wf.cadeia(t, g, r);
  wf.liga(r, hl, 0); wf.liga(r, he, 1); wf.liga(r, it, 2);
  wf.liga(hl, it); wf.liga(he, it);
  wf.liga(it, tem);
  wf.liga(tem, pl, 0); wf.liga(tem, fim, 1);
  wf.cadeia(pl, hp, jp);
  return wf;
}

// ================================================================ ACQ-00 Erros
function acq00Erros() {
  const wf = new Wf(IDS.e00, 'ACQ-00-Erros', 'Recebe falhas dos workflows ACQ e registra incidente deduplicado (sem alerta externo).');
  const t = wf.no('Erro em workflow ACQ', 'n8n-nodes-base.errorTrigger', 1, {});
  const m = code(wf, 'Montar incidente', [], `
const e = $input.first().json;
const wfNome = (e.workflow && e.workflow.name) || 'desconhecido';
const no = (e.execution && e.execution.lastNodeExecuted) || (e.trigger && 'gatilho') || '?';
const msg = String((e.execution && e.execution.error && e.execution.error.message) || (e.trigger && e.trigger.error && e.trigger.error.message) || 'erro');
const tipo = /401|unauthori|autentica/i.test(msg) ? 'autenticacao' : /403|forbidden|escopo/i.test(msg) ? 'escopo' : 'falha';
const key = 'ERRO|' + wfNome + '|' + no + '|' + acqSha256(msg.replace(/[0-9a-f-]{36}/g, '<id>').slice(0, 120)).slice(0, 16);
const detalhe = { workflow: wfNome, no: no, execucao: e.execution && e.execution.id, url: e.execution && e.execution.url, mensagem: msg.slice(0, 500), tipo: tipo };
return [{ json: { pg: [key, wfNome.slice(0, 6), null, tipo === 'falha' ? 'aviso' : 'alto', wfNome + ': ' + msg.slice(0, 120), JSON.stringify(detalhe)] } }];`);
  const p = pg(wf, 'Registrar incidente', 'select acq_n8n.incidente_registrar($1, $2, $3::uuid, $4, $5, $6::jsonb) as r');
  wf.cadeia(t, m, p);
  return wf;
}

// ================================================================ ACQ-01
function acq01() {
  const W = 'ACQ-01';
  const wf = new Wf(IDS.w01, 'ACQ-01-Contexto-Rituais', 'Lê contexto, separa fatos/respostas/interpretações/lacunas e propõe atualização do dossiê, rascunho de ritual e pedido de revisão.');
  const t1 = cron(wf, 'Seg e qua 08h30', '0 30 8 * * 1,3', 0);
  const t2 = cron(wf, 'Sex 16h30', '0 30 16 * * 5', 1);
  const t3 = wf.no('Manual por client_id', 'n8n-nodes-base.executeWorkflowTrigger', 1.2, { inputSource: 'passthrough' },
    { col: 0, notes: 'Entrada: { client_id, ritual?: rota_semana|meio_semana|prova_movimento, agora?: ISO }. Chamar por Execute Sub-workflow ou pelo MCP da instância.' }, 2);
  const t4 = manual(wf, 'Executar piloto (Mirante)', 3);
  const p = code(wf, 'Preparar rodada', ['adaptador', 'wf01'], `
${PEDIDO(W)}
const e = $input.first().json || {};
const agoraMs = e.agora ? Date.parse(e.agora) : Date.now();
const manualPiloto = !e.client_id && !e.timestamp && !e['Readable date'] && Array.isArray(CFG.clientes_permitidos) && CFG.clientes_permitidos.length === 1;
const clientePedido = e.client_id || (manualPiloto ? CFG.clientes_permitidos[0] : null);
const ritual = acq01RitualDaRodada(agoraMs, e.ritual || null);
if (ritual.erro) return [];
const run = acqRunId(${JSON.stringify(W)}, agoraMs, JSON.stringify(e));
return [{ json: pedido({ ref: 'dia', ferramenta: 'aceleriq_dia_prioritario', argumentos: {} }, run, { _ctx: { run_id: run, agoraMs: agoraMs, ritual: ritual, cliente_pedido: clientePedido } }) }];`);
  const l1 = ferramenta(wf, 'Ler elegibilidade');
  const s = code(wf, 'Selecionar clientes', ['adaptador', 'wf01'], `
${PEDIDO(W)}
const ctx = $('Preparar rodada').first().json._ctx;
const r = $input.first().json;
if (!r.ok) throw new Error('ACQ-01: Dia Prioritário indisponível (' + (r.erro && r.erro.tipo) + '): ' + (r.erro && r.erro.mensagem));
const el = acq01Elegiveis(r.resultado, CFG, ctx.cliente_pedido);
const out = [];
el.elegiveis.forEach((c) => acq01PedidosDeLeitura(c, ctx.ritual, CFG.operador).forEach((x) => out.push({ json: pedido(x, ctx.run_id, { _cliente: c }) })));
return out;`);
  const l2 = ferramenta(wf, 'Ler contexto');
  const d = code(wf, 'Pedir detalhes dos relatórios', ['adaptador', 'wf01'], `
${PEDIDO(W)}
const ctx = $('Preparar rodada').first().json._ctx;
const pedidos = $('Selecionar clientes').all().map((i) => i.json);
const clientes = {};
pedidos.forEach((p) => { clientes[p._cliente.client_id] = p._cliente; });
const resultados = $input.all().map((i) => i.json);
const out = [];
Object.keys(clientes).forEach((cid) => {
  const rel = resultados.filter((r) => r.ref === cid + '|relatorios')[0];
  const det = rel && rel.ok ? acq01PedidosDeDetalhe(clientes[cid], rel.resultado, ctx.ritual) : [];
  if (!det.length) out.push({ json: pedido({ ref: cid + '|sem_detalhe', ferramenta: 'nenhuma', argumentos: {} }, ctx.run_id) });
  det.forEach((x) => out.push({ json: pedido(x, ctx.run_id) }));
});
return out;`);
  const l3 = ferramenta(wf, 'Detalhar relatórios');
  const a = code(wf, 'Analisar e propor', ['adaptador', 'wf01'], `
const ctx = $('Preparar rodada').first().json._ctx;
const clientes = {};
$('Selecionar clientes').all().forEach((i) => { clientes[i.json._cliente.client_id] = i.json._cliente; });
const leituras = $('Ler contexto').all().map((i) => i.json);
const detalhes = $input.all().map((i) => i.json);
const out = [];
Object.keys(clientes).forEach((cid) => {
  const L = {}; const falhas = [];
  ['dossie', 'decisoes', 'rituais', 'agenda', 'relatorios', 'dia', 'fila'].forEach((k) => {
    const r = leituras.filter((x) => x.ref === cid + '|' + k)[0];
    if (r && r.ok) L[k] = r.resultado; else falhas.push({ fonte: k, erro: r ? r.erro : { tipo: 'sem_resposta' } });
  });
  const det = detalhes.filter((x) => String(x.ref || '').indexOf(cid + '|relatorio|') === 0 && x.ok).map((x) => x.resultado.report).filter(Boolean);
  const an = acq01Analisar({ cliente: clientes[cid], ritual: ctx.ritual, leituras: L, detalhes: det, falhas: falhas, agoraMs: ctx.agoraMs, cfg: CFG, run_id: ctx.run_id });
  const base = 'acq01:' + cid + ':' + ctx.ritual.semana + ':' + ctx.ritual.tipo + ':' + (an.hash_fatos || 'sem-fatos').slice(0, 16);
  const propostas = [];
  if (an.proposta_contexto) propostas.push({ workflow_id: 'ACQ-01', client_id: cid, tipo: 'contexto', referencia: ctx.ritual.tipo + ':' + ctx.ritual.semana, idempotency_key: base + ':contexto', base_versao: an.dossie_versao_base,
    conteudo: { secao: an.proposta_contexto.secao, tamanho_novo: an.proposta_contexto.tamanho_novo, excede_limite_mcp: an.proposta_contexto.excede_limite_mcp, perguntas: an.perguntas },
    hash: an.proposta_contexto.conteudo_hash, estado: an.proposta_contexto.excede_limite_mcp ? 'bloqueada' : 'proposta', motivo: an.proposta_contexto.excede_limite_mcp ? 'dossie_excederia_60000_caracteres' : null, ambiente: AMBIENTE });
  if (an.rascunho_ritual) propostas.push({ workflow_id: 'ACQ-01', client_id: cid, tipo: 'ritual', referencia: ctx.ritual.tipo + ':' + ctx.ritual.semana, idempotency_key: base + ':ritual', base_versao: an.dossie_versao_base,
    conteudo: an.rascunho_ritual, hash: acqHashDe(an.rascunho_ritual), ambiente: AMBIENTE });
  if (an.reconciliacao && an.reconciliacao.length) propostas.push({ workflow_id: 'ACQ-01', client_id: cid, tipo: 'reconciliacao_dia', referencia: 'historico:' + ctx.ritual.semana, idempotency_key: 'acq01:' + cid + ':reconciliacao:' + acqHashDe(an.reconciliacao).slice(0, 16),
    conteudo: { achados: an.reconciliacao }, hash: acqHashDe(an.reconciliacao), ambiente: AMBIENTE });
  const analise = Object.assign({}, an, { proposta_contexto: an.proposta_contexto ? Object.assign({}, an.proposta_contexto, { _conteudo_novo: undefined }) : null });
  out.push({ json: { client_id: cid, analise: analise, _proposta_contexto_completa: an.proposta_contexto || null, propostas: propostas, pg: [JSON.stringify(propostas)] } });
});
return out;`);
  const rp = pg(wf, 'Registrar propostas', `select coalesce(jsonb_agg(acq_n8n.proposta_registrar(p) order by o), '[]'::jsonb) as registradas
  from jsonb_array_elements($1::jsonb) with ordinality as x(p, o)`);
  // Texto final do ritual (MCP 2.10.0): só para ritual com proposta nova; uma chamada por cliente.
  const pt = code(wf, 'Pedir texto do ritual', ['adaptador', 'wf01'], `
${PEDIDO(W)}
const ctx = $('Preparar rodada').first().json._ctx;
const analises = $('Analisar e propor').all().map((i) => i.json);
const out = [];
$input.all().forEach((it, idx) => {
  const a = analises[idx];
  const x = acq01PedidoTextoFinal(a.analise, a.propostas, it.json.registradas);
  out.push({ json: x ? pedido(x, ctx.run_id) : pedido({ ref: a.client_id + '|texto|nada', ferramenta: 'nenhuma', argumentos: {} }, ctx.run_id) });
});
return out;`);
  const gt = ferramenta(wf, 'Redigir texto do ritual');
  const pe = code(wf, 'Preparar escritas', ['adaptador', 'wf01'], `
${PEDIDO(W)}
const ctx = $('Preparar rodada').first().json._ctx;
const analises = $('Analisar e propor').all().map((i) => i.json);
const textos = $input.all().map((i) => i.json);
const out = [];
// Só grava quem tem proposta NOVA (replay não grava de novo) e está em 'propor' ou 'rascunho_existente'.
$('Registrar propostas').all().forEach((it, idx) => {
  const a = analises[idx];
  const novas = (it.json.registradas || []).some((r) => r.novo);
  const pode = novas && ['propor', 'rascunho_existente'].indexOf(a.analise.estado) >= 0;
  const texto = textos.filter((t) => t.ref === a.client_id + '|texto')[0];
  const rascunho = texto ? acq01AplicarTextoFinal(a.analise.rascunho_ritual, texto) : a.analise.rascunho_ritual;
  const an = Object.assign({}, a.analise, { proposta_contexto: a._proposta_contexto_completa, rascunho_ritual: rascunho });
  const pedidos = pode ? acq01PedidosDeEscrita(an, ctx.run_id) : [];
  if (!pedidos.length) out.push({ json: pedido({ ref: a.client_id + '|escrita|nada', ferramenta: 'nenhuma', argumentos: {} }, ctx.run_id, { _grava: pode ? a.client_id : null }) });
  pedidos.forEach((x) => out.push({ json: pedido(x, ctx.run_id, { _grava: a.client_id }) }));
});
return out;`, {}, 1);
  const g1 = ferramenta(wf, 'Gravar no painel (etapa 1)', {}, 1);
  const pr = code(wf, 'Pedir revisão (etapa 2)', ['adaptador', 'wf01'], `
${PEDIDO(W)}
const ctx = $('Preparar rodada').first().json._ctx;
const analises = $('Analisar e propor').all().map((i) => i.json);
const res = $input.all().map((i) => i.json);
const out = [];
analises.forEach((a) => {
  const cid = a.client_id;
  const an = a.analise;
  if (!an.pedido_revisao) return;
  const dossie = res.filter((r) => r.ref === cid + '|escrita|dossie')[0];
  const rasc = res.filter((r) => r.ref === cid + '|escrita|rascunho')[0];
  if (dossie && !dossie.ok && dossie.erro && dossie.erro.tipo === 'conflito_versao') { out.push({ json: pedido({ ref: cid + '|revisao|conflito', ferramenta: 'nenhuma', argumentos: {} }, ctx.run_id, { _conflito: true }) }); return; }
  let reportId = an.situacao && an.situacao.report_id;
  if (rasc) reportId = rasc.ok ? (rasc.simulado ? rasc.id_simulado : (rasc.resultado.report && rasc.resultado.report.id) || rasc.resultado.id) : null;
  if (!reportId) { out.push({ json: pedido({ ref: cid + '|revisao|sem_rascunho', ferramenta: 'nenhuma', argumentos: {} }, ctx.run_id) }); return; }
  const args = { operator: an.pedido_revisao.operator, report_id: reportId, channel: an.pedido_revisao.channel, idempotency_key: 'acq01:' + cid + ':' + ctx.ritual.semana + ':' + ctx.ritual.tipo + ':revisao:' + reportId };
  if (an.pedido_revisao.recipient) args.recipient = an.pedido_revisao.recipient;
  out.push({ json: pedido({ ref: cid + '|revisao', ferramenta: 'aceleriq_central_review_preparar', client_id_escopo: cid, argumentos: args }, ctx.run_id) });
});
if (!out.length) out.push({ json: pedido({ ref: 'revisao|nada', ferramenta: 'nenhuma', argumentos: {} }, ctx.run_id) });
return out;`, {}, 1);
  const g2 = ferramenta(wf, 'Pedir revisão', {}, 1);
  const ev = code(wf, 'Registrar evidência', ['adaptador', 'wf01'], `
const ctx = $('Preparar rodada').first().json._ctx;
const analises = $('Analisar e propor').all().map((i) => i.json);
const registradas = $('Registrar propostas').all().map((i) => i.json.registradas || []);
const escritas = $('Gravar no painel (etapa 1)').all().map((i) => i.json);
const revisoes = $input.all().map((i) => i.json);
const textos = $('Redigir texto do ritual').all().map((i) => i.json);
return analises.map((a, idx) => {
  const cid = a.client_id;
  const t = textos.filter((x) => x.ref === cid + '|texto')[0];
  const textoFinal = !t ? null : t.ok && t.resultado && t.resultado.ok
    ? { ok: true, title: t.resultado.title, body: t.resultado.body, next_steps: t.resultado.next_steps, model: t.resultado.model, custo_usd: t.resultado.custo_usd, alertas: t.resultado.alertas }
    : { ok: false, erro: t.erro ? t.erro.tipo + ': ' + t.erro.mensagem : (t.resultado && t.resultado.motivo) || 'sem texto' };
  const minhas = escritas.concat(revisoes).filter((r) => String(r.ref || '').indexOf(cid + '|') === 0 && r.ferramenta !== 'nenhuma');
  const conflito = minhas.some((r) => r.erro && r.erro.tipo === 'conflito_versao');
  const regs = registradas[idx] || [];
  const ev = acqEvento({ workflow_id: 'ACQ-01', run_id: ctx.run_id, client_id: cid, entity_type: 'ritual', entity_id: ctx.ritual.tipo + ':' + ctx.ritual.semana,
    occurred_at: new Date(ctx.agoraMs).toISOString(), source: 'n8n:ACQ-01', source_version: 'dossie:v' + a.analise.dossie_versao_base,
    idempotency_key: 'ACQ-01|' + cid + '|' + ctx.ritual.semana + '|' + ctx.ritual.tipo + '|' + a.analise.estado + '|' + (a.analise.hash_fatos || 'x').slice(0, 16),
    evidence_refs: a.analise.fatos ? a.analise.fatos.map((f) => f.fonte.ferramenta + (f.fonte.publication_id ? ':' + f.fonte.publication_id : '')) : [],
    tipo: conflito ? 'ritual_conflito_de_versao' : 'ritual_' + a.analise.estado,
    payload: { estado: a.analise.estado, perguntas: a.analise.perguntas || [], lacunas: (a.analise.lacunas || []).map((l) => l.chave), respondidas: (a.analise.respondidas || []).map((r) => r.lacuna),
      reconciliacao: a.analise.reconciliacao || [], propostas: regs, texto_final: textoFinal, escritas: minhas.map((m) => ({ ferramenta: m.ferramenta, ok: m.ok, simulado: m.simulado, erro: m.erro && m.erro.tipo })) } });
  const mudancas = conflito ? regs.filter((r) => r.novo).map((r) => ({ id: r.id, estado: 'conflito_versao', motivo: 'dossie_mudou_durante_a_rodada' })) : [];
  const descartar = ['ja_publicado', 'pedido_existente'].indexOf(a.analise.estado) >= 0;
  return { json: { client_id: cid, evento: ev, pg: [JSON.stringify(ev), AMBIENTE, JSON.stringify(mudancas), cid, ctx.ritual.tipo + ':' + ctx.ritual.semana, descartar] } };
});`, {}, 0);
  const ge = pg(wf, 'Gravar evento', `select acq_n8n.registrar_evento($1::jsonb, $2) as evento,
  (select coalesce(jsonb_agg(acq_n8n.proposta_mudar_estado((m->>'id')::uuid, array['proposta'], m->>'estado', m->>'motivo')), '[]'::jsonb) from jsonb_array_elements($3::jsonb) m) as propostas,
  (select coalesce(jsonb_agg(acq_n8n.proposta_mudar_estado(p.id, array['proposta','em_revisao','bloqueada'], 'descartada', 'ritual_ja_feito_no_painel')), '[]'::jsonb)
     from acq_n8n.propostas p where $6::boolean and p.client_id = $4::uuid and p.referencia = $5 and p.tipo in ('ritual','contexto') and p.estado in ('proposta','em_revisao','bloqueada')) as descartadas`);
  [t1, t2, t3, t4].forEach((x) => wf.liga(x, p));
  wf.cadeia(p, l1, s, l2, d, l3, a, rp, pt, gt, pe, g1, pr, g2, ev, ge);
  return wf;
}

// ================================================================ ACQ-02
function acq02() {
  const W = 'ACQ-02';
  const wf = new Wf(IDS.w02, 'ACQ-02-Despacho-Aprovado', 'Despachante único: claim atômico, revalidação, transporte, recibo e registro no painel.');
  const t1 = wf.no('A cada 5 minutos', 'n8n-nodes-base.scheduleTrigger', 1.4, { rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] } }, { col: 0 }, 0);
  const t2 = manual(wf, 'Executar manualmente', 1);
  const p = code(wf, 'Preparar rodada', ['adaptador'], `
${PEDIDO(W)}
const agoraMs = Date.now();
const run = acqRunId(${JSON.stringify(W)}, agoraMs, Math.random());
return [{ json: pedido({ ref: 'fila', ferramenta: 'aceleriq_central_review_fila', argumentos: { operator: CFG.operador } }, run, { _ctx: { run_id: run, agoraMs: agoraMs } }) }];`);
  const lf = ferramenta(wf, 'Ler fila');
  const ms = code(wf, 'Montar saídas', ['adaptador', 'wf02'], `
const r = $input.first().json;
if (!r.ok) throw new Error('ACQ-02: fila de revisão indisponível (' + (r.erro && r.erro.tipo) + ')');
const e = acq02Enfileirar(r.resultado, CFG);
return [{ json: { saidas: e.saidas.length, ignorados: e.ignorados, pg: [JSON.stringify(e.saidas)] } }];`);
  const enf = pg(wf, 'Enfileirar e expirar', `select (select coalesce(jsonb_agg(acq_n8n.saida_enfileirar(s)), '[]'::jsonb) from jsonb_array_elements($1::jsonb) s) as enfileiradas,
  acq_n8n.saida_expirar_envios() as expiradas`);
  const pc = code(wf, 'Dono do lote', [], `
const ctx = $('Preparar rodada').first().json._ctx;
return [{ json: { pg: [ctx.run_id, AMBIENTE] } }];`);
  const rv = pg(wf, 'Reivindicar lote', `select * from acq_n8n.saida_reivindicar($1, 120, 5, $2)`, { alwaysOutputData: false });
  const prl = code(wf, 'Pedir releitura', ['adaptador'], `
${PEDIDO(W)}
const ctx = $('Preparar rodada').first().json._ctx;
return [{ json: pedido({ ref: 'fila-releitura', ferramenta: 'aceleriq_central_review_fila', argumentos: { operator: CFG.operador } }, ctx.run_id) }];`, { executeOnce: true });
  const rl = ferramenta(wf, 'Reler fila');
  const ds = pg(wf, 'Destinos aprovados', `select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) as destinos from acq_n8n.destinos_aprovados d where ativo`, { executeOnce: true });
  const rev = code(wf, 'Revalidar', ['adaptador', 'wf02'], `
const ctx = $('Preparar rodada').first().json._ctx;
const fila = $('Reler fila').first().json;
if (!fila.ok) throw new Error('ACQ-02: releitura da fila falhou; as saídas reivindicadas voltam ao jogo quando a lease vencer.');
const destinos = $input.first().json.destinos || [];
return $('Reivindicar lote').all().map((i) => {
  const s = i.json;
  const v = acq02Revalidar(s, fila.resultado, destinos, CFG, Date.now());
  const msg = v.destino ? acq02MensagemTransporte(s, v.destino) : null;
  const estadoSem = v.decisao === 'simular' ? 'simulada' : v.decisao === 'invalidar' ? 'invalidada' : 'bloqueada';
  return { json: { saida: s, revalidacao: v, mensagem: msg, dono: ctx.run_id,
    pg_sem_envio: [s.id, ctx.run_id, estadoSem, v.motivo], pg_iniciar: [s.id, ctx.run_id, v.destino ? v.destino.id : null, v.destino ? v.destino.provedor : null] } };
});`);
  const dec = rota(wf, 'Decisão do envio', '$json.revalidacao.decisao', ['enviar']);
  const sem = code(wf, 'Sem envio', [], `return $input.all().map((i) => ({ json: Object.assign({}, i.json, { pg: i.json.pg_sem_envio }) }));`, {}, 1);
  const csem = pg(wf, 'Concluir sem envio', `select acq_n8n.saida_concluir_sem_envio($1::uuid, $2, $3, $4) as r`, {}, 1);
  const ini = code(wf, 'Iniciar', [], `return $input.all().map((i) => ({ json: Object.assign({}, i.json, { pg: i.json.pg_iniciar }) }));`, {}, 0);
  const pini = pg(wf, 'Iniciar envio (ponto sem volta)', `select (acq_n8n.saida_iniciar_envio($1::uuid, $2, $3::uuid, $4)->>'pode_enviar')::boolean as pode_enviar`);
  const pode = se(wf, 'Pode enviar?', '={{ $json.pode_enviar === true }}');
  const tr = wf.no('Transporte de teste', 'n8n-nodes-base.httpRequest', 4.5, {
    method: 'POST', url: `=${AMBIENTES.ambientes[AMBIENTE].transporte_url || 'http://127.0.0.1:8792'}/enviar`,
    sendHeaders: true, headerParameters: { parameters: [{ name: 'x-transporte', value: 'TESTE' }] },
    sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: `={{ JSON.stringify($('Iniciar').item.json.mensagem) }}`,
    options: { timeout: 15000, response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } } },
  }, { onError: 'continueRegularOutput', retryOnFail: false, notes: 'Só o transporte de TESTE está ligado. O oficial (WhatsApp) depende de homologação; até lá a revalidação bloqueia.' });
  const cl = code(wf, 'Classificar resultado', ['wf02'], `
return $input.all().map((i, idx) => {
  const ctx = $('Iniciar').itemMatching(idx).json;
  const c = acq02ClassificarTransporte(i.json);
  const inc = c.resultado === 'aceita' ? null : { key: 'ACQ-02|' + (c.resultado === 'incerta' ? 'envio_incerto' : c.auth ? 'transporte_autenticacao' : 'envio_recusado') + '|' + ctx.saida.id,
    sev: c.resultado === 'incerta' || c.auth ? 'alto' : 'aviso', titulo: 'Despacho ' + c.resultado + ': ' + (c.motivo || '') };
  return { json: { saida: ctx.saida, resultado: c, pg: [ctx.saida.id, ctx.dono, c.resultado, c.provider_message_id || null, c.motivo || null,
    inc ? inc.key : null, ctx.saida.client_id, inc ? inc.sev : 'info', inc ? inc.titulo : '', JSON.stringify({ saida: ctx.saida.id, motivo: c.motivo || null })] } };
});`);
  const gr = pg(wf, 'Gravar resultado do transporte', `select acq_n8n.saida_resultado_transporte($1::uuid, $2, $3, $4, $5) as r,
  case when $6::text is not null then acq_n8n.incidente_registrar($6, 'ACQ-02', $7::uuid, $8, $9, $10::jsonb) end as incidente`);
  const pend = code(wf, 'Filtro de pendentes', [], `return [{ json: { pg: [AMBIENTE] } }];`, { executeOnce: true }, 2);
  const pp = pg(wf, 'Pendentes de registro no painel', `select s.id, s.approval_id, s.client_id, s.provedor, s.provider_message_id, s.aceita_em, s.payload_hash, s.destino_rotulo, s.painel_tentativas
  from acq_n8n.saidas s where s.ambiente = $1 and s.estado in ('aceita','entregue','lida') and s.painel_registrado_em is null and s.painel_tentativas < 20 order by s.aceita_em limit 20`, {}, 2);
  const mk = code(wf, 'Pedir registro no painel', ['adaptador', 'wf02'], `
${PEDIDO(W)}
const ctx = $('Preparar rodada').first().json._ctx;
return $input.all().map((i) => ({ json: pedido({ ref: 'enviado|' + i.json.id, ferramenta: 'aceleriq_central_review_marcar_enviado',
  argumentos: { operator: CFG.operador, approval_id: i.json.approval_id, evidence: acq02Evidencia(i.json, i.json.destino_rotulo), idempotency_key: 'acq02:enviado:' + i.json.id } }, ctx.run_id, { _saida_id: i.json.id }) }));`, {}, 2);
  const mr = ferramenta(wf, 'Registrar envio no painel', {}, 2);
  const mg = code(wf, 'Resultado do registro', [], `
const pedidos = $('Pedir registro no painel').all();
return $input.all().map((i, idx) => {
  const ok = i.json.ok === true || (i.json.erro && i.json.erro.tipo === 'ja_enviado');
  return { json: { saida_id: pedidos[idx].json._saida_id, ok: ok, simulado: i.json.simulado === true, pg: [pedidos[idx].json._saida_id, ok && !i.json.simulado, ok ? null : JSON.stringify(i.json.erro)] } };
});`, {}, 2);
  const mgp = pg(wf, 'Gravar registro do painel', `select acq_n8n.saida_registro_painel($1::uuid, $2::boolean, $3) as r`, {}, 2);
  // recibos
  const wh = wf.no('Recibo do provedor', 'n8n-nodes-base.webhook', 2.2, { httpMethod: 'POST', path: 'acq02-recibos', authentication: 'headerAuth', responseMode: 'responseNode', options: {} },
    { col: 0, credentials: CRED.wh02, webhookId: 'acq02-recibos-0000-4000-a000-000000000002' }, 3);
  const vr = code(wf, 'Validar recibos', ['wf02'], `
const e = $input.first().json;
const corpo = e.body !== undefined ? e.body : e;
const prov = (e.headers && e.headers['x-provedor']) || CFG.provedor_mensagens;
const r = acq02NormalizarRecibos(corpo, Date.now(), prov);
return [{ json: { validos: r.validos.length, invalidos: r.invalidos, pg: [JSON.stringify(r.validos)] } }];`, {}, 3);
  const gv = pg(wf, 'Gravar recibos', `select coalesce(jsonb_agg(acq_n8n.recibo_registrar(r->>'provedor', r->>'provider_message_id', r->>'status', (r->>'ocorrido_em')::timestamptz, r->'bruto')), '[]'::jsonb) as resultado
  from jsonb_array_elements($1::jsonb) r`, {}, 3);
  const rw = wf.no('Responder ao provedor', 'n8n-nodes-base.respondToWebhook', 1.5, { respondWith: 'json', responseBody: `={{ JSON.stringify({ recebidos: $('Validar recibos').first().json.validos, invalidos: $('Validar recibos').first().json.invalidos.length }) }}`, options: {} }, {}, 3);
  [t1, t2].forEach((x) => wf.liga(x, p));
  wf.cadeia(p, lf, ms, enf);
  wf.liga(enf, pend); wf.liga(enf, pc);
  wf.cadeia(pend, pp, mk, mr, mg, mgp);
  wf.cadeia(pc, rv, prl, rl, ds, rev, dec);
  wf.liga(dec, ini, 0); wf.liga(dec, sem, 1);
  wf.cadeia(sem, csem);
  wf.cadeia(ini, pini, pode);
  wf.liga(pode, tr, 0);
  wf.cadeia(tr, cl, gr);
  wf.liga(gr, pend);
  wf.cadeia(wh, vr, gv, rw);
  return wf;
}

// ================================================================ ACQ-03
function acq03() {
  const W = 'ACQ-03';
  const wf = new Wf(IDS.w03, 'ACQ-03-Post-No-Ar', 'Detecta publicação comprovada, valida conta/permalink/prova, captura o perfil e prepara o aviso para revisão; reconciliação editorial diária.');
  const t1 = wf.no('A cada 10 minutos', 'n8n-nodes-base.scheduleTrigger', 1.4, { rule: { interval: [{ field: 'minutes', minutesInterval: 10 }] } }, { col: 0 }, 0);
  const t2 = manual(wf, 'Executar manualmente', 1);
  const t3 = cron(wf, 'Reconciliação diária 07h30', '0 30 7 * * *', 3);
  const t4 = wf.no('Entrada interna', 'n8n-nodes-base.executeWorkflowTrigger', 1.2, { inputSource: 'passthrough' }, { col: 0, notes: 'Entrada: { modo: poll|reconciliacao }.' }, 2);
  const sm = rota(wf, 'Modo da entrada', '$json.modo', ['reconciliacao'], { col: 1 }, 2);
  const p = code(wf, 'Preparar rodada', [], `
const agoraMs = Date.now();
const run = acqRunId(${JSON.stringify(W)}, agoraMs, Math.random());
return [{ json: { _ctx: { run_id: run, agoraMs: agoraMs }, pg: ['ACQ-03', 'publicacoes'] } }];`);
  const lc = pg(wf, 'Ler cursor e vistos', `select acq_n8n.cursor_ler($1, $2) as cursor,
  (select coalesce(jsonb_agg(idempotency_key), '[]'::jsonb) from acq_n8n.eventos where workflow_id = 'ACQ-03' and tipo like 'publicacao_%' and registrado_em > now() - interval '7 days') as vistos`);
  const pcart = code(wf, 'Pedir carteira', ['adaptador'], `
${PEDIDO(W)}
const ctx = $('Preparar rodada').first().json._ctx;
return [{ json: pedido({ ref: 'carteira', ferramenta: 'aceleriq_dia_prioritario', argumentos: {} }, ctx.run_id) }];`);
  const lcart = ferramenta(wf, 'Ler carteira');
  const pl = code(wf, 'Pedidos de leitura', ['adaptador', 'wf03'], `
${PEDIDO(W)}
const ctx = $('Preparar rodada').first().json._ctx;
const c = $('Ler cursor e vistos').first().json.cursor;
const r = $input.first().json;
if (!r.ok) throw new Error('ACQ-03: carteira indisponível (' + (r.erro && r.erro.tipo) + ')');
const todos = [];
(r.resultado.distribuicao || []).forEach((d) => (d.clientes || []).forEach((x) => todos.push(x.client_id)));
const clientes = Array.isArray(CFG.clientes_permitidos) ? todos.filter((x) => CFG.clientes_permitidos.indexOf(x) >= 0) : todos;
return acq03PedidosLeitura(clientes, c && c.existe ? c.valor.desde : null, ctx.agoraMs).map((x) => ({ json: pedido(x, ctx.run_id, { _client_id: x.argumentos.client_id }) }));`);
  const lp = ferramenta(wf, 'Ler calendário e posts');
  const dv = code(wf, 'Detectar e validar', ['adaptador', 'wf03'], `
const ctx = $('Preparar rodada').first().json._ctx;
const base = $('Ler cursor e vistos').first().json;
const res = $input.all().map((i) => i.json);
const clientes = {};
$('Pedidos de leitura').all().forEach((i) => { clientes[i.json._client_id] = true; });
let pubs = [], posts = {}, falhas = [];
Object.keys(clientes).forEach((cid) => {
  const cal = res.filter((r) => r.ref === cid + '|calendario')[0];
  const ps = res.filter((r) => r.ref === cid + '|posts')[0];
  if (!cal || !cal.ok) { falhas.push({ client_id: cid, fonte: 'calendario', erro: cal && cal.erro }); return; }
  pubs = pubs.concat(acq03Publicacoes(cal.resultado.items, cid));
  posts[cid] = ps && ps.ok ? ps.resultado.posts : null;
});
const det = acq03Detectar(pubs, base.cursor, base.vistos, ctx.agoraMs);
const contas = acq03ContasPorProjeto(pubs);
const itens = [], eventos = [];
let pendenteMaisAntigo = null;
det.novas.forEach((p) => {
  if (posts[p.client_id] === null) { pendenteMaisAntigo = pendenteMaisAntigo || p.published_at; return; }
  const v = acq03Validar(p, posts[p.client_id], contas, ctx.agoraMs);
  if (v.estado === 'prova_pendente') { if (!pendenteMaisAntigo || p.published_at < pendenteMaisAntigo) pendenteMaisAntigo = p.published_at; return; }
  if (v.estado === 'ignorar') return;
  if (v.estado === 'revisao') {
    eventos.push(acqEvento({ workflow_id: 'ACQ-03', run_id: ctx.run_id, client_id: p.client_id, entity_type: 'publicacao', entity_id: p.publication_id, occurred_at: p.published_at,
      source: 'n8n:ACQ-03', idempotency_key: acq03ChaveEvento(p), tipo: 'publicacao_em_revisao', evidence_refs: ['aceleriq_list_editorial_calendar', 'aceleriq_list_social_posts'],
      payload: { motivo: v.motivo, permalink: p.permalink, external_account_id: p.external_account_id, project_id: p.project_id } }));
    return;
  }
  itens.push({ json: { pub: p, validacao: v, posts: posts[p.client_id] } });
});
if (det.inicializar) eventos.push(acqEvento({ workflow_id: 'ACQ-03', run_id: ctx.run_id, entity_type: 'cursor', entity_id: 'publicacoes', occurred_at: new Date(ctx.agoraMs).toISOString(),
  source: 'n8n:ACQ-03', idempotency_key: 'ACQ-03|cursor|inicializado', tipo: 'cursor_inicializado', payload: { historico_ignorado: det.historico_ignorado } }));
const desde = pendenteMaisAntigo && pendenteMaisAntigo < det.novo_cursor.desde ? pendenteMaisAntigo : det.novo_cursor.desde;
const versao = base.cursor && base.cursor.existe ? base.cursor.versao : 0;
return [{ json: { tipo: 'controle', falhas: falhas, inicializou: det.inicializar, historico_ignorado: det.historico_ignorado, para_captura: itens.length,
  pg: [versao, JSON.stringify({ desde: desde }), JSON.stringify(eventos), AMBIENTE] } }].concat(itens.map((i) => ({ json: Object.assign({ tipo: 'captura' }, i.json) })));`);
  const sw = rota(wf, 'Separar controle e capturas', '$json.tipo', ['controle', 'captura']);
  const gc = pg(wf, 'Gravar cursor e eventos', `select acq_n8n.cursor_avancar('ACQ-03', 'publicacoes', $1::int, $2::jsonb) as cursor,
  (select coalesce(jsonb_agg(acq_n8n.registrar_evento(e, $4)), '[]'::jsonb) from jsonb_array_elements($3::jsonb) e) as eventos`, {}, 0);
  const pcap = code(wf, 'Pedir captura do perfil', ['adaptador', 'wf03'], `
${PEDIDO(W)}
const ctx = $('Preparar rodada').first().json._ctx;
const out = [];
$input.all().forEach((i) => {
  const p = i.json.pub; const handle = String((p.conta && p.conta.handle) || '').replace(/^@/, '');
  out.push({ json: pedido({ ref: p.publication_id + '|sessao', ferramenta: 'aceleriq_browser_session', argumentos: { client_id: p.client_id, acao: 'abrir', pedido: 'Captura do perfil @' + handle + ' para aviso de post no ar' } }, ctx.run_id) });
  out.push({ json: pedido({ ref: p.publication_id + '|captura', ferramenta: 'aceleriq_browser_act', argumentos: { client_id: p.client_id, acao: 'capturar', url: 'https://www.instagram.com/' + handle + '/', pedido: 'print do perfil com o post novo' } }, ctx.run_id) });
});
return out;`, {}, 1);
  const cap = ferramenta(wf, 'Capturar perfil', {}, 1);
  const ma = code(wf, 'Montar aviso', ['adaptador', 'wf03'], `
const ctx = $('Preparar rodada').first().json._ctx;
const caps = $input.all().map((i) => i.json);
return $('Detectar e validar').all().filter((i) => i.json.tipo === 'captura').map((i) => {
  const p = i.json.pub, v = i.json.validacao;
  const c = caps.filter((x) => x.ref === p.publication_id + '|captura')[0];
  const capRes = c && c.ok && !c.simulado ? c.resultado : (c && c.simulado ? { erro: 'captura simulada (dry-run): nenhuma captura real feita' } : { erro: (c && c.erro && c.erro.mensagem) || 'sem captura' });
  const vc = acq03ValidarCaptura(capRes, p.conta && p.conta.handle);
  const cmp = acq03Comparacao(v.prova, i.json.posts, ctx.agoraMs);
  const msg = acq03Mensagem(p, v, cmp);
  const conteudo = { client_id: p.client_id, project_id: p.project_id, social_account_id: p.external_account_id, conta: p.conta && p.conta.handle, publication_id: p.publication_id,
    platform_media_id: v.platform_media_id, permalink: p.permalink, published_at: p.published_at, verified_at: new Date(ctx.agoraMs).toISOString(),
    screenshot_file_id: vc.ok ? vc.screenshot_file_id : null, captura: vc, comparacao: cmp, mensagem: msg.texto, afirma_crescimento: msg.afirma_crescimento };
  return { json: { pub: p, validacao: v, captura: vc, conteudo: conteudo } };
});`, {}, 1);
  // O aviso vai para a Revisão do Ciclo (MCP 2.10.0); a captura do perfil é evidência extra, não condição.
  const pav = code(wf, 'Pedir aviso na revisão', ['adaptador', 'wf03'], `
${PEDIDO(W)}
const ctx = $('Preparar rodada').first().json._ctx;
return $input.all().map((i) => ({ json: pedido(acq03PedidoAviso(i.json.pub, i.json.conteudo.mensagem, CFG.operador), ctx.run_id) }));`, {}, 1);
  const fav = ferramenta(wf, 'Preparar aviso na revisão', {}, 1);
  const fch = code(wf, 'Fechar aviso', ['adaptador', 'wf03'], `
const ctx = $('Preparar rodada').first().json._ctx;
const res = $input.all().map((i) => i.json);
return $('Montar aviso').all().map((i) => {
  const p = i.json.pub, v = i.json.validacao, vc = i.json.captura;
  const r = res.filter((x) => x.ref === p.publication_id + '|aviso')[0];
  const st = acq03EstadoDoAviso(r);
  const conteudo = Object.assign({}, i.json.conteudo, { aviso_id: st.aviso_id, revisao: st.estado === 'em_revisao' ? 'aviso na Revisão do Ciclo, aguardando o dono' : st.motivo });
  const proposta = { workflow_id: 'ACQ-03', client_id: p.client_id, tipo: 'aviso_publicacao', referencia: p.publication_id, idempotency_key: 'acq03:' + p.publication_id + ':' + acqSha256(p.permalink).slice(0, 12),
    conteudo: conteudo, hash: acqHashDe(conteudo), estado: st.estado, motivo: st.motivo, ambiente: AMBIENTE };
  const ev = acqEvento({ workflow_id: 'ACQ-03', run_id: ctx.run_id, client_id: p.client_id, entity_type: 'publicacao', entity_id: p.publication_id, occurred_at: p.published_at,
    source: 'n8n:ACQ-03', idempotency_key: acq03ChaveEvento(p), tipo: st.estado === 'em_revisao' ? 'publicacao_aviso_em_revisao' : st.estado === 'proposta' ? 'publicacao_aviso_simulado' : 'publicacao_aviso_' + st.estado,
    evidence_refs: ['publication:' + p.publication_id, 'media:' + v.platform_media_id].concat(vc.ok && vc.screenshot_file_id ? ['file:' + vc.screenshot_file_id] : []).concat(st.aviso_id ? ['aviso:' + st.aviso_id] : []),
    payload: { proposta: proposta.idempotency_key, captura: vc, revisao: { estado: st.estado, motivo: st.motivo, aviso_id: st.aviso_id, erro: r && r.erro ? r.erro.tipo + ': ' + r.erro.mensagem : null } } });
  return { json: { proposta: proposta, evento: ev, pg: [JSON.stringify(proposta), JSON.stringify(ev), AMBIENTE] } };
});`, {}, 1);
  const ga = pg(wf, 'Registrar aviso', `select acq_n8n.proposta_registrar($1::jsonb) as proposta, acq_n8n.registrar_evento($2::jsonb, $3) as evento`, {}, 1);
  // reconciliação diária
  const pr = code(wf, 'Preparar reconciliação', ['adaptador'], `
${PEDIDO(W)}
const agoraMs = Date.now();
const run = acqRunId('ACQ-03-reconciliacao', agoraMs, Math.random());
return [{ json: pedido({ ref: 'carteira', ferramenta: 'aceleriq_dia_prioritario', argumentos: {} }, run, { _ctx: { run_id: run, agoraMs: agoraMs } }) }];`, { col: 1 }, 3);
  const rc = ferramenta(wf, 'Ler carteira (reconciliação)', { col: 2 }, 3);
  const prc = code(wf, 'Pedidos de agenda', ['adaptador', 'wf03'], `
${PEDIDO(W)}
const ctx = $('Preparar reconciliação').first().json._ctx;
const r = $input.first().json;
if (!r.ok) throw new Error('ACQ-03: carteira indisponível na reconciliação');
const todos = [];
(r.resultado.distribuicao || []).forEach((d) => (d.clientes || []).forEach((x) => todos.push(x.client_id)));
const clientes = Array.isArray(CFG.clientes_permitidos) ? todos.filter((x) => CFG.clientes_permitidos.indexOf(x) >= 0) : todos;
const hoje = acqAgoraSP(ctx.agoraMs).data;
const out = [];
clientes.forEach((cid) => {
  out.push({ json: pedido({ ref: cid + '|agenda', ferramenta: 'aceleriq_get_agenda_status', argumentos: { client_id: cid, days: 7 } }, ctx.run_id, { _client_id: cid }) });
  out.push({ json: pedido({ ref: cid + '|agendadas', ferramenta: 'aceleriq_list_editorial_calendar', paginar: true, argumentos: { client_id: cid, publication_status: 'scheduled', date_from: acqSomarDias(hoje, -14), date_to: hoje, include_unscheduled: false, limit: 100 } }, ctx.run_id, { _client_id: cid }) });
});
return out;`, { col: 3 }, 3);
  const la = ferramenta(wf, 'Ler agenda', { col: 4 }, 3);
  const ex = code(wf, 'Exceções editoriais', ['adaptador', 'wf03'], `
const ctx = $('Preparar reconciliação').first().json._ctx;
const res = $input.all().map((i) => i.json);
const clientes = {};
$('Pedidos de agenda').all().forEach((i) => { clientes[i.json._client_id] = true; });
const hoje = acqAgoraSP(ctx.agoraMs).data;
const eventos = [];
Object.keys(clientes).forEach((cid) => {
  const ag = res.filter((r) => r.ref === cid + '|agenda')[0];
  const cal = res.filter((r) => r.ref === cid + '|agendadas')[0];
  if (!ag || !ag.ok || !cal || !cal.ok) return;
  const pubs = acq03Publicacoes(cal.resultado.items, cid);
  acq03ExcecoesEditoriais(cid, ag.resultado, pubs, ctx.agoraMs).forEach((e) => eventos.push(acqEvento({ workflow_id: 'ACQ-03', run_id: ctx.run_id, client_id: cid,
    entity_type: 'excecao_editorial', entity_id: e.tipo + (e.publication_id ? ':' + e.publication_id : ''), occurred_at: new Date(ctx.agoraMs).toISOString(), source: 'n8n:ACQ-03',
    idempotency_key: 'ACQ-03|excecao|' + cid + '|' + e.tipo + '|' + (e.publication_id || '') + '|' + hoje, tipo: 'excecao_editorial', evidence_refs: ['aceleriq_get_agenda_status'], payload: e })));
});
return [{ json: { eventos: eventos.length, pg: [JSON.stringify(eventos), AMBIENTE] } }];`, { col: 5 }, 3);
  const gex = pg(wf, 'Encaminhar exceções ao ACQ-05', `select coalesce(jsonb_agg(acq_n8n.registrar_evento(e, $2)), '[]'::jsonb) as eventos from jsonb_array_elements($1::jsonb) e`, { col: 6 }, 3);
  [t1, t2].forEach((x) => wf.liga(x, p));
  wf.liga(t4, sm); wf.liga(sm, pr, 0); wf.liga(sm, p, 1);
  wf.cadeia(p, lc, pcart, lcart, pl, lp, dv, sw);
  wf.liga(sw, gc, 0); wf.liga(sw, pcap, 1);
  wf.cadeia(pcap, cap, ma, pav, fav, fch, ga);
  wf.cadeia(t3, pr, rc, prc, la, ex, gex);
  return wf;
}

// ================================================================ ACQ-04
function acq04() {
  const W = 'ACQ-04';
  const wf = new Wf(IDS.w04, 'ACQ-04-Conversas-Contexto', 'Mensagens e áudios: registro durável, deduplicação, transcrição, classificação (Jev) e proposta versionada para o Hermes.');
  const t1 = wf.no('Mensagem recebida', 'n8n-nodes-base.webhook', 2.2, { httpMethod: 'POST', path: 'acq04-mensagens', authentication: 'headerAuth', responseMode: 'responseNode', options: {} },
    { col: 0, credentials: CRED.wh04, webhookId: 'acq04-mensagens-0000-4000-a000-000000000004' }, 0);
  const t2 = wf.no('Entrada interna de teste', 'n8n-nodes-base.executeWorkflowTrigger', 1.2, { inputSource: 'passthrough' }, { col: 0 }, 1);
  const n = code(wf, 'Normalizar', ['wf04'], `
const e = $input.first().json;
const doWebhook = e.headers !== undefined && e.body !== undefined;
const corpo = doWebhook ? e.body : e;
const agoraMs = Date.now();
if (doWebhook) {
  const c = acq04ConferirCarimbo(e.headers['x-acq-carimbo'], agoraMs);
  if (!c.ok) return [{ json: { rejeitar: true, motivo: c.motivo, pg: [] } }];
}
const prov = (doWebhook && e.headers['x-provedor']) || corpo.provedor || CFG.provedor_mensagens;
const r = acq04Normalizar(corpo, prov, agoraMs);
if (!r.mensagens.length) return [{ json: { rejeitar: true, motivo: r.erros.join(';') || 'vazio', pg: [] } }];
return r.mensagens.map((m) => ({ json: { mensagem: Object.assign({}, m, { transcricao_fixture: corpo.transcricao_fixture || null }), pg: [JSON.stringify(m)] } }));`);
  const val = se(wf, 'Entrada válida?', '={{ $json.rejeitar !== true }}');
  const reg = pg(wf, 'Registrar mensagem', `select acq_n8n.mensagem_registrar($1::jsonb) as r`);
  const veio = se(wf, 'Veio do webhook?', `={{ $('Mensagem recebida').isExecuted }}`);
  const resp = wf.no('Confirmar recebimento', 'n8n-nodes-base.respondToWebhook', 1.5, { respondWith: 'json', responseBody: '={{ JSON.stringify({ recebido: true, duplicada: $json.r.novo === false }) }}', options: {} }, { onError: 'continueRegularOutput' }, 0);
  const rej = wf.no('Recusar entrada', 'n8n-nodes-base.respondToWebhook', 1.5, { respondWith: 'json', responseBody: '={{ JSON.stringify({ recebido: false, motivo: $json.motivo }) }}', options: { responseCode: 400 } }, { onError: 'continueRegularOutput' }, 2);
  const filt = code(wf, 'Só novas de cliente conhecido', [], `
const msgs = $('Normalizar').all();
return $input.all().map((i, idx) => ({ json: Object.assign({}, msgs[idx] ? msgs[idx].json.mensagem : {}, { registro: i.json.r }) }))
  .filter((m) => m.registro && m.registro.novo === true && m.registro.estado === 'recebida');`);
  const tra = code(wf, 'Transcrição', ['wf04'], `
// Serviço de transcrição: dependência a homologar. Sem serviço, áudio fica 'pendente' (não inventa texto).
// No ambiente de teste a fixture traz o resultado explícito em transcricao_fixture.
return $input.all().map((i) => {
  const m = i.json;
  if (m.tipo !== 'audio') return { json: Object.assign({}, m, { transcricao_status: 'nao_aplicavel', pg: [m.registro.id, 'nao_aplicavel', null, null] }) };
  const f = m.transcricao_fixture;
  const st = f ? f.status : 'pendente';
  const texto = f && f.status === 'ok' ? f.texto : null;
  return { json: Object.assign({}, m, { transcricao_status: st, transcricao: texto, media_hash: f ? acqSha256(f.media || m.media_id || '') : null,
    pg: [m.registro.id, st === 'nao_aplicavel' ? 'nao_aplicavel' : st, texto, f ? acqSha256(f.media || m.media_id || '') : null] }) };
});`);
  const gt = pg(wf, 'Gravar transcrição', `select case when $2 = 'nao_aplicavel' then null else acq_n8n.mensagem_transcricao($1::uuid, $2, $3, $4) end as r`);
  const ctx = code(wf, 'Pedir contexto', [], `
const ms = $('Transcrição').all();
return ms.map((i) => ({ json: Object.assign({}, i.json, { pg: [i.json.group_id, i.json.registro.client_id] }) }));`);
  const lctx = pg(wf, 'Ler contexto local', `select
  (select coalesce(jsonb_agg(to_jsonb(m) order by m.occurred_at), '[]'::jsonb) from acq_n8n.mensagens_entrada m where m.group_id = $1 and m.occurred_at > now() - interval '30 minutes') as recentes,
  (select p.conteudo->'perguntas' from acq_n8n.propostas p where p.client_id = $2::uuid and p.tipo = 'contexto' and p.estado in ('proposta','em_revisao') order by p.criada_em desc limit 1) as perguntas_abertas,
  (select p.base_versao from acq_n8n.propostas p where p.client_id = $2::uuid and p.tipo = 'contexto' order by p.criada_em desc limit 1) as dossie_versao`);
  const pj = code(wf, 'Pedido ao Jev', ['wf04'], `
const base = $('Pedir contexto').all();
return $input.all().map((i, idx) => {
  const m = Object.assign({}, base[idx].json, { client_id: base[idx].json.registro.client_id, papel: base[idx].json.registro.papel });
  const trecho = acq04Agrupar(m, (i.json.recentes || []).map((r) => Object.assign({}, r, { transcricao_status: r.transcricao_status })));
  const pedidoJev = acq04PedidoJev(trecho, { perguntas_abertas: i.json.perguntas_abertas || [], nome_cliente: null });
  const pular = (m.tipo === 'audio' && m.transcricao_status !== 'ok');
  return { json: { mensagem: m, trecho: trecho, jev: pedidoJev, pular_jev: pular, dossie_versao: i.json.dossie_versao, jev_url: CFG.jev_url } };
});`);
  const jv = wf.no('Classificar com Jev', 'n8n-nodes-base.httpRequest', 4.5, {
    method: 'POST', url: '={{ $json.jev_url }}', authentication: 'genericCredentialType', genericAuthType: 'httpBearerAuth',
    sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.jev) }}',
    options: { timeout: 20000, response: { response: { fullResponse: false, responseFormat: 'json' } } },
  }, { credentials: CRED.jev, onError: 'continueRegularOutput', retryOnFail: true, maxTries: 3, waitBetweenTries: 3000 });
  const dc = code(wf, 'Decidir destino', ['wf04'], `
const base = $('Pedido ao Jev').all();
return $input.all().map((i, idx) => {
  const b = base[idx].json;
  const julg = b.pular_jev ? null : acq04LerJev(i.json);
  const d = acq04Decidir(b.mensagem, julg, {});
  const prop = acq04Proposta(b.mensagem, b.trecho, julg, d, { dossie_versao: b.dossie_versao });
  const ev = acqEvento({ workflow_id: 'ACQ-04', run_id: 'ACQ-04:' + b.mensagem.provider_message_id, client_id: b.mensagem.client_id, entity_type: 'mensagem', entity_id: b.mensagem.provider_message_id,
    occurred_at: b.mensagem.occurred_at, source: 'n8n:ACQ-04:' + b.mensagem.provedor, idempotency_key: 'ACQ-04|' + b.mensagem.provedor + '|' + b.mensagem.provider_message_id,
    tipo: 'conversa_' + d.destino, evidence_refs: prop.origem.provider_message_ids.map((x) => 'msg:' + x), payload: { destino: d.destino, motivos: d.motivos, classificacao: julg } });
  const estado = d.destino === 'descartar' ? 'descartada' : (d.destino === 'revisao' || d.destino === 'pendencia') ? 'em_revisao' : 'processada';
  const proposta = d.destino === 'proposta_contexto' || d.destino === 'handoff' ? { workflow_id: 'ACQ-04', client_id: b.mensagem.client_id, tipo: 'contexto_conversa',
    referencia: 'msg:' + b.mensagem.provider_message_id, idempotency_key: 'acq04:' + b.mensagem.provedor + ':' + b.mensagem.provider_message_id, base_versao: b.dossie_versao, conteudo: prop, hash: acqHashDe(prop), ambiente: AMBIENTE } : null;
  return { json: { destino: d.destino, proposta: prop, mensagem: b.mensagem, evento: ev,
    pg: [b.mensagem.registro.id, estado, d.motivos.join(','), JSON.stringify(julg), ev.event_id, JSON.stringify(ev), AMBIENTE, proposta ? JSON.stringify(proposta) : null,
      prop.pergunta_relacionada ? 'resposta:' + prop.pergunta_relacionada : null, JSON.stringify({ texto: prop.evidencia.map((x) => x.texto).join(' / '), autor: prop.autor, mensagem: b.mensagem.provider_message_id }),
      b.mensagem.occurred_at, b.mensagem.client_id] } };
});`);
  const sh = rota(wf, 'É pedido para a Mesa?', '$json.destino', ['handoff']);
  const ph = code(wf, 'Pedir handoff', ['adaptador'], `
${PEDIDO(W)}
return $input.all().map((i) => ({ json: pedido({ ref: 'handoff|' + i.json.mensagem.provider_message_id, ferramenta: 'aceleriq_agent_handoff', argumentos: {
  operator: CFG.operador, client_id: i.json.mensagem.client_id, agente: 'contexto', titulo: 'Pedido do grupo do cliente (ACQ-04)',
  texto: 'Pedido recebido no grupo (proposta, não executada): ' + (i.json.proposta.evidencia.map((e) => e.texto).join(' / ')).slice(0, 5000) } }, 'ACQ-04:' + i.json.mensagem.provider_message_id, { _base: i.json }) }));`, {}, 1);
  const hf = ferramenta(wf, 'Entregar ao Hermes (handoff)', {}, 1);
  const hj = code(wf, 'Juntar handoff', [], `
const pedidos = $('Pedir handoff').all();
return $input.all().map((i, idx) => { const b = pedidos[idx].json._base; b.evento.payload.handoff = { ok: i.json.ok, simulado: i.json.simulado === true, erro: i.json.erro && i.json.erro.tipo };
  b.pg[5] = JSON.stringify(b.evento); return { json: b }; });`, {}, 1);
  const fin = pg(wf, 'Registrar desfecho', `select acq_n8n.mensagem_concluir($1::uuid, $2, $3, $4::jsonb, $5::uuid) as mensagem,
  acq_n8n.registrar_evento($6::jsonb, $7) as evento,
  case when $8::text is not null then acq_n8n.proposta_registrar($8::jsonb) end as proposta,
  case when $9::text is not null then acq_n8n.fato_propor($12::uuid, $9, $10::jsonb, $11::timestamptz, $5::uuid) end as fato`);
  wf.cadeia(t1, n); wf.liga(t2, n);
  wf.liga(n, val);
  wf.liga(val, reg, 0); wf.liga(val, rej, 1);
  wf.cadeia(reg, veio);
  wf.liga(veio, resp, 0); wf.liga(veio, filt, 1);
  wf.liga(resp, filt);
  wf.cadeia(filt, tra, gt, ctx, lctx, pj, jv, dc, sh);
  wf.liga(sh, ph, 0); wf.liga(sh, fin, 1);
  wf.cadeia(ph, hf, hj, fin);
  return wf;
}

// ================================================================ ACQ-05
function acq05() {
  const W = 'ACQ-05';
  const wf = new Wf(IDS.w05, 'ACQ-05-Dia-Prioritario-Radar', 'Pauta do Dia Prioritário (08h), reconciliação (17h) e verificação técnica (15 min), sem notificar repetido.');
  const t1 = cron(wf, 'Dias úteis 08h00', '0 0 8 * * 1-5', 0);
  const t2 = cron(wf, 'Dias úteis 17h00', '0 0 17 * * 1-5', 1);
  const t4 = manual(wf, 'Executar pauta manualmente', 2);
  const t3 = wf.no('A cada 15 minutos', 'n8n-nodes-base.scheduleTrigger', 1.4, { rule: { interval: [{ field: 'minutes', minutesInterval: 15 }] } }, { col: 0 }, 4);
  const t5 = wf.no('Entrada interna', 'n8n-nodes-base.executeWorkflowTrigger', 1.2, { inputSource: 'passthrough' },
    { col: 0, notes: 'Entrada: { modo?: pauta|reconciliacao|tecnico, agora?: ISO, data?: AAAA-MM-DD }.' }, 3);
  const p = code(wf, 'Preparar pauta', ['adaptador', 'wf05'], `
${PEDIDO(W)}
const e = $input.first().json || {};
const agoraMs = e.agora ? Date.parse(e.agora) : Date.now();
const sp = acqAgoraSP(agoraMs);
// Só o agendamento das 17h vira reconciliação; o botão manual sempre monta a pauta.
const doAgendamento = Boolean(e.timestamp || e['Readable date']);
const modo = e.modo || (doAgendamento && sp.hora >= 16 ? 'reconciliacao' : 'pauta');
const run = acqRunId(${JSON.stringify(W)} + ':' + modo, agoraMs, Math.random());
return [{ json: pedido({ ref: 'dia', ferramenta: 'aceleriq_dia_prioritario', argumentos: e.data ? { data: e.data } : {} }, run, { _ctx: { run_id: run, agoraMs: agoraMs, modo: modo, hoje: sp.data } }) }];`);
  const ld = ferramenta(wf, 'Ler Dia Prioritário');
  const pc = code(wf, 'Pedidos por cliente', ['adaptador', 'wf05'], `
${PEDIDO(W)}
const ctx = $('Preparar pauta').first().json._ctx;
const r = $input.first().json;
if (!r.ok) throw new Error('ACQ-05: Dia Prioritário indisponível (' + (r.erro && r.erro.tipo) + ')');
const cs = acq05ClientesDoDia(r.resultado, CFG);
const out = [];
cs.forEach((c) => {
  out.push({ json: pedido({ ref: c.client_id + '|agenda', ferramenta: 'aceleriq_get_agenda_status', argumentos: { client_id: c.client_id, days: 14 } }, ctx.run_id, { _cliente: c }) });
  out.push({ json: pedido({ ref: c.client_id + '|tarefas', ferramenta: 'aceleriq_list_tasks', paginar: true, argumentos: { client_id: c.client_id, only_open: true, limit: 100 } }, ctx.run_id, { _cliente: c }) });
  out.push({ json: pedido({ ref: c.client_id + '|ads', ferramenta: 'aceleriq_mesa_ads_saude', argumentos: { client_id: c.client_id } }, ctx.run_id, { _cliente: c }) });
});
if (cs.length) out.push({ json: pedido({ ref: 'fila', ferramenta: 'aceleriq_central_review_fila', argumentos: { operator: CFG.operador } }, ctx.run_id) });
return out;`);
  const lcl = ferramenta(wf, 'Ler clientes do dia');
  const pm = code(wf, 'Pauta da manhã (para 17h)', [], `
const ctx = $('Preparar pauta').first().json._ctx;
return [{ json: { pg: ['pauta:' + ctx.hoje] } }];`, { executeOnce: true });
  const lpm = pg(wf, 'Ler pauta da manhã', `select coalesce(jsonb_object_agg(client_id, dados), '{}'::jsonb) as pautas from acq_n8n.observacoes where workflow_id = 'ACQ-05' and chave = $1`);
  const mp = code(wf, 'Montar pauta', ['adaptador', 'wf05'], `
const ctx = $('Preparar pauta').first().json._ctx;
const manha = $input.first().json.pautas || {};
const res = $('Ler clientes do dia').all().map((i) => i.json);
const fila = (res.filter((r) => r.ref === 'fila')[0] || {}).resultado || {};
const clientes = {};
$('Pedidos por cliente').all().forEach((i) => { if (i.json._cliente) clientes[i.json._cliente.client_id] = i.json._cliente; });
return Object.keys(clientes).map((cid) => {
  const c = clientes[cid];
  const ag = res.filter((r) => r.ref === cid + '|agenda')[0];
  const tk = res.filter((r) => r.ref === cid + '|tarefas')[0];
  const ads = res.filter((r) => r.ref === cid + '|ads')[0];
  const falhas = [ag, tk].filter((x) => !x || !x.ok).map((x) => (x && x.erro) || { tipo: 'sem_resposta' });
  const itens = tk && tk.ok ? tk.resultado.items : [];
  const tf = acq05Tarefas(itens, ctx.hoje); tf.itens = itens;
  const pauta = falhas.length ? { client_id: cid, nome: c.nome, data: ctx.hoje, acoes: [], avisos: ['Fonte indisponível: ' + falhas.map((f) => f.tipo).join(', ') + '. Pauta não montada.'], numeros: {}, incompleta: true }
    : acq05Pauta({ cliente: c, agenda: ag.resultado, tarefas: tf, fila: fila, ads: ads && ads.ok ? ads.resultado : null, hoje: ctx.hoje, agoraMs: ctx.agoraMs });
  if (!pauta.hash) pauta.hash = acqHashDe(pauta);
  const recon = ctx.modo === 'reconciliacao' ? acq05Reconciliar(manha[cid], pauta, c.prep, ctx.hoje) : null;
  const chave = (ctx.modo === 'reconciliacao' ? 'reconciliacao:' : 'pauta:') + ctx.hoje;
  const dados = Object.assign({}, pauta, recon ? { reconciliacao: recon } : {});
  const hash = acqHashDe({ p: pauta.hash, r: recon });
  const proposta = { workflow_id: 'ACQ-05', client_id: cid, tipo: ctx.modo === 'reconciliacao' ? 'reconciliacao_dia' : 'pauta_dia', referencia: chave, idempotency_key: 'acq05:' + cid + ':' + chave + ':' + hash.slice(0, 16),
    conteudo: dados, hash: hash, ambiente: AMBIENTE };
  return { json: { client_id: cid, pauta: dados, pg: ['ACQ-05', cid, chave, hash, JSON.stringify(dados), JSON.stringify(proposta)] } };
});`);
  const ob = pg(wf, 'Comparar com a observação anterior', `select acq_n8n.observar($1, $2::uuid, $3, $4, $5::jsonb) as obs, $6::jsonb as proposta`);
  const nov = se(wf, 'Mudou desde a última?', '={{ $json.obs.mudou === true }}');
  const rp = code(wf, 'Preparar registro', [], `return $input.all().map((i) => ({ json: { pg: [JSON.stringify(i.json.proposta)] } }));`);
  const gp = pg(wf, 'Registrar pauta', `select acq_n8n.proposta_registrar($1::jsonb) as r`);
  // verificação técnica
  const pt = code(wf, 'Preparar verificação técnica', ['adaptador'], `
${PEDIDO(W)}
const agoraMs = Date.now();
const e5 = $input.first().json || {};
const run = acqRunId('ACQ-05:tecnico', agoraMs, Math.random());
return [
  { json: pedido({ ref: 'quadro', ferramenta: 'aceleriq_operator_board', argumentos: { limit: 100 } }, run, { _ctx: { run_id: run, agoraMs: agoraMs } }) },
  { json: pedido({ ref: 'fila', ferramenta: 'aceleriq_central_review_fila', argumentos: { operator: CFG.operador } }, run) },
];`, { col: 1 }, 4);
  const lt = ferramenta(wf, 'Ler quadro e fila', { col: 2 }, 4);
  const le = code(wf, 'Filtro técnico', [], `return [{ json: { pg: ['ACQ-05'] } }];`, { executeOnce: true, col: 3 }, 4);
  const lex = pg(wf, 'Exceções e incidentes abertos', `select
  (select coalesce(jsonb_agg(e.payload), '[]'::jsonb) from acq_n8n.eventos e where e.tipo = 'excecao_editorial' and e.registrado_em > now() - interval '26 hours') as excecoes,
  (select coalesce(jsonb_agg(i.incident_key), '[]'::jsonb) from acq_n8n.incidentes i where i.workflow_id = $1 and i.estado = 'aberto') as abertos`, { col: 4 }, 4);
  const av = code(wf, 'Avaliar sinais', ['adaptador', 'wf05'], `
const res = $('Ler quadro e fila').all().map((i) => i.json);
const ctx = $('Preparar verificação técnica').first().json._ctx;
const q = res.filter((r) => r.ref === 'quadro')[0];
const f = res.filter((r) => r.ref === 'fila')[0];
const base = $input.first().json;
const filaEscopo = f && f.ok ? { esperando_decisao: acqFiltrarEscopo(f.resultado.esperando_decisao, CFG), aprovados_para_enviar: acqFiltrarEscopo(f.resultado.aprovados_para_enviar, CFG) } : null;
const incs = acq05Tecnico(q && q.ok ? q.resultado : null, filaEscopo, acqFiltrarEscopo(base.excecoes, CFG), ctx.agoraMs, CFG);
if (!f || !f.ok) incs.push({ key: 'ACQ-05|revisao|fila_indisponivel', sev: 'alto', titulo: 'Fila de revisão indisponível', detalhe: { erro: f && f.erro } });
const atuais = incs.map((i) => i.key);
const resolver = (base.abertos || []).filter((k) => atuais.indexOf(k) < 0);
return [{ json: { incidentes: incs, resolver: resolver, pg: [JSON.stringify(incs.map((i) => ({ key: i.key, sev: i.sev, titulo: i.titulo, detalhe: i.detalhe || {}, client_id: i.client_id || null }))), JSON.stringify(resolver)] } }];`, { col: 5 }, 4);
  const gi = pg(wf, 'Registrar e resolver incidentes', `select
  (select coalesce(jsonb_agg(jsonb_build_object('key', i->>'key') || acq_n8n.incidente_registrar(i->>'key', 'ACQ-05', nullif(i->>'client_id','')::uuid, i->>'sev', i->>'titulo', i->'detalhe')), '[]'::jsonb) from jsonb_array_elements($1::jsonb) i) as registrados,
  (select coalesce(jsonb_agg(acq_n8n.incidente_resolver(k, 'sinal normalizado na verificação técnica')), '[]'::jsonb) from jsonb_array_elements_text($2::jsonb) k) as resolvidos`, { col: 6 }, 4);
  const sm5 = rota(wf, 'Modo da entrada', '$json.modo', ['tecnico'], { col: 1 }, 3);
  [t1, t2, t4].forEach((x) => wf.liga(x, p));
  wf.liga(t5, sm5); wf.liga(sm5, pt, 0); wf.liga(sm5, p, 1);
  wf.cadeia(p, ld, pc, lcl, pm, lpm, mp, ob, nov);
  wf.liga(nov, rp, 0);
  wf.cadeia(rp, gp);
  wf.cadeia(t3, pt, lt, le, lex, av, gi);
  return wf;
}

// ================================================================ ACQ-06 (comercial: primeiro contato)
const SQL_EVENTO_E_INCIDENTE = (wfId, comContexto) => `select case when $1::text is not null then acq_n8n.registrar_evento($1::jsonb, $2) end as evento,
  case when $3::text is not null then acq_n8n.incidente_registrar($3, '${wfId}', null, $4, $5, $6::jsonb) end as incidente${comContexto ? ',\n  $7::jsonb as ctx' : ''}`;
const pgLiteral = (wf, nome, query, extra = {}, lane = 0) =>
  wf.no(nome, 'n8n-nodes-base.postgres', 2.7, { operation: 'executeQuery', query, options: {} },
    { credentials: CRED.pg, retryOnFail: true, maxTries: 3, waitBetweenTries: 2000, ...extra }, lane);
const httpMeta = (wf, nome, extra = {}, lane = 0) => wf.no(nome, 'n8n-nodes-base.httpRequest', 4.5, {
  method: 'POST', url: '={{ $json.envio.url }}', authentication: 'genericCredentialType', genericAuthType: 'httpBearerAuth',
  sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.envio.payload) }}',
  options: { timeout: 20000, response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } } },
}, { credentials: CRED.meta, onError: 'continueRegularOutput', retryOnFail: false,
  notes: 'Cloud API da Meta. Uma tentativa só: erro da Meta nunca vira "enviado"; timeout vira envio incerto e nunca é repetido sozinho.', ...extra }, lane);

function acq06() {
  const W = 'ACQ-06';
  const wf = new Wf(IDS.w06, 'ACQ-06-Comercial-Primeiro-Contato', 'Mercúrio: primeiro contato com lead entregue pela Máquina, pelo modelo aprovado da Cloud API (dia útil 9h-18h, teto do painel).');
  const t1 = cron(wf, 'Dias úteis 9h-18h a cada 20 min', '0 */20 9-17 * * 1-5', 0);
  const t2 = manual(wf, 'Executar manualmente', 1);
  const t3 = wf.no('Entrada interna', 'n8n-nodes-base.executeWorkflowTrigger', 1.2, { inputSource: 'passthrough' }, { col: 0, notes: 'Entrada: { agora?: ISO } (teste).' }, 2);
  const p = code(wf, 'Preparar rodada', ['comercial', 'wf06'], `
${PEDIDO(W)}
const e = $input.first().json || {};
const agoraMs = e.agora ? Date.parse(e.agora) : Date.now();
const run = acqRunId(${JSON.stringify(W)}, agoraMs, Math.random());
return [{ json: pedido({ ref: 'fila', ferramenta: 'aceleriq_comercial_fila', argumentos: { operador: acqComCfg(CFG).operador, limit: 100 } }, run,
  { _ctx: { run_id: run, agoraMs: agoraMs, hoje: acqAgoraSP(agoraMs).data } }) }];`);
  const lf = ferramenta(wf, 'Ler fila do Mercúrio');
  const es = code(wf, 'Escolher leads', ['comercial', 'wf06'], `
const ctx = $('Preparar rodada').first().json._ctx;
const r = $input.first().json;
if (!r.ok) throw new Error('ACQ-06: fila do comercial indisponível (' + (r.erro && r.erro.tipo) + '): ' + (r.erro && r.erro.mensagem));
const esc = acq06Candidatos(r.resultado, CFG, ctx.agoraMs);
return esc.candidatos.map((cand) => {
  const tr = acqComTransporte(CFG, ${JSON.stringify(W)}, cand.tipo);
  return { json: { cand: cand, transporte: tr, rodada: { motivo: esc.motivo, limite: esc.limite, ignorados: esc.ignorados.length },
    pg: acq06PgReivindicar(cand, acq06Reivindicacao(cand, tr, ctx), AMBIENTE) } };
});`);
  const rv = pg(wf, 'Reivindicar tentativa do dia', `select case when exists (select 1 from acq_n8n.eventos e where e.workflow_id = 'ACQ-06' and e.entity_type = 'lead'
    and e.entity_id = $1 and e.tipo = any(string_to_array($2, ',')))
  then jsonb_build_object('novo', false, 'bloqueado', true)
  else acq_n8n.registrar_evento($3::jsonb, $4) end as r`);
  const me = code(wf, 'Montar envios', ['comercial', 'wf06'], `
const cands = $('Escolher leads').all();
return $input.all().map((i, idx) => {
  const b = cands[idx].json;
  const envio = acq06Envio(b.cand, i.json.r, b.transporte, CFG);
  return { json: { envio: envio, enviar: envio.decisao === 'enviar' }, pairedItem: { item: idx } };
});`);
  const ev = se(wf, 'Enviar de verdade?', '={{ $json.enviar === true }}');
  const hm = httpMeta(wf, 'Enviar modelo (Cloud API)');
  const cl = code(wf, 'Classificar envio', ['comercial'], `
return $input.all().map((i, idx) => {
  const b = $('Montar envios').itemMatching(idx).json;
  return { json: { envio: b.envio, meta: acqComClassificarMeta(i.json) }, pairedItem: { item: idx } };
});`);
  const sem = code(wf, 'Sem envio', [], `return $input.all().map((i, idx) => ({ json: { envio: i.json.envio, meta: null }, pairedItem: { item: idx } }));`, {}, 1);
  const de = code(wf, 'Desfecho do envio', ['comercial', 'wf06'], `
const ctx = $('Preparar rodada').first().json._ctx;
const out = [];
$input.all().forEach((i) => {
  const d = acq06Desfecho(i.json.envio, i.json.meta, ctx);
  if (!d.evento) return;
  const ped = acq06PedidoRegistro(i.json.envio, d.estado, i.json.meta, CFG, ctx.agoraMs);
  out.push({ json: { estado: d.estado, pg: acqComPgEvento(d.evento, d.incidente, AMBIENTE, { pedido: ped, lead_id: i.json.envio.lead_id, estado: d.estado }) } });
});
return out;`);
  const gd = pg(wf, 'Gravar desfecho do envio', SQL_EVENTO_E_INCIDENTE(W, true));
  const pr = code(wf, 'Pedir registro na conversa', ['comercial', 'wf06'], `
${PEDIDO(W)}
const ctx = $('Preparar rodada').first().json._ctx;
return $input.all().map((i) => {
  const c = i.json.ctx || {};
  return { json: c.pedido ? pedido(c.pedido, ctx.run_id) : pedido({ ref: 'registro|nada|' + c.lead_id, ferramenta: 'nenhuma', argumentos: {} }, ctx.run_id) };
});`);
  const rg = ferramenta(wf, 'Registrar na conversa do lead');
  const dr = code(wf, 'Desfecho do registro', ['comercial'], `
const ctx = $('Preparar rodada').first().json._ctx;
const out = [];
$input.all().forEach((i) => {
  const d = acqComResultadoEscrita(${JSON.stringify(W)}, i.json, ctx);
  if (d) out.push({ json: { pg: acqComPgEvento(d.evento, d.incidente, AMBIENTE) } });
});
return out;`);
  const gr = pg(wf, 'Gravar desfecho do registro', SQL_EVENTO_E_INCIDENTE(W, false));
  [t1, t2, t3].forEach((x) => wf.liga(x, p));
  wf.cadeia(p, lf, es, rv, me, ev);
  wf.liga(ev, hm, 0); wf.liga(ev, sem, 1);
  wf.cadeia(hm, cl, de);
  wf.liga(sem, de);
  wf.cadeia(de, gd, pr, rg, dr, gr);
  return wf;
}

// ================================================================ ACQ-07 (comercial: respostas)
function acq07() {
  const W = 'ACQ-07';
  const wf = new Wf(IDS.w07, 'ACQ-07-Comercial-Respostas', 'Webhook do WhatsApp comercial: registra a resposta do lead, Jev julga a intenção, "pare" grava nao_contatar, Mercúrio responde na janela de 24 h e avisa a Caixa quando avança.');
  // verificação (GET)
  const wg = wf.no('WhatsApp: verificação (GET)', 'n8n-nodes-base.webhook', 2.2, { httpMethod: 'GET', path: 'acq07-whatsapp', responseMode: 'responseNode', options: {} },
    { col: 0, webhookId: 'acq07-whatsapp-get-0000-4000-a000-000000000007' }, 3);
  const sg = pgLiteral(wf, 'Ler segredos (GET)', "select acq_n8n.cursor_ler('ACQ-07', 'segredos_webhook') as segredos", { col: 1 }, 3);
  const cv = code(wf, 'Conferir verify token', ['comercial', 'wf07'], `
const q = $('WhatsApp: verificação (GET)').first().json.query || {};
const s = (($input.first().json.segredos) || {}).valor || {};
const v = acq07Verificacao(q, s);
return [{ json: { ok: v.ok, challenge: v.challenge || '', motivo: v.motivo || null } }];`, { col: 2 }, 3);
  const tc = se(wf, 'Token confere?', '={{ $json.ok === true }}', { col: 3 }, 3);
  const rc = wf.no('Devolver challenge', 'n8n-nodes-base.respondToWebhook', 1.5, { respondWith: 'text', responseBody: '={{ $json.challenge }}', options: { responseCode: 200 } }, { col: 4 }, 3);
  const rr = wf.no('Recusar verificação', 'n8n-nodes-base.respondToWebhook', 1.5, { respondWith: 'text', responseBody: 'forbidden', options: { responseCode: 403 } }, { col: 4 }, 4);
  // mensagens (POST)
  const wp = wf.no('WhatsApp: mensagens (POST)', 'n8n-nodes-base.webhook', 2.2, { httpMethod: 'POST', path: 'acq07-whatsapp', responseMode: 'onReceived', options: { rawBody: true } },
    { col: 0, webhookId: 'acq07-whatsapp-post-000-4000-a000-000000000007', notes: 'Responde 200 na hora (a Meta reenvia se demorar). A assinatura X-Hub-Signature-256 é conferida no fluxo; sem app secret configurado, nada é processado.' }, 0);
  const ti = wf.no('Entrada interna de teste', 'n8n-nodes-base.executeWorkflowTrigger', 1.2, { inputSource: 'passthrough' }, { col: 0, notes: 'Entrada: { body: <corpo do webhook da Meta>, agora?: ISO }. Não confere assinatura.' }, 1);
  const lb = code(wf, 'Ler corpo bruto', [], `
const it = $input.first();
const e = it.json || {};
const doWebhook = e.headers !== undefined && e.body !== undefined;
let bruto = null, erroBruto = null;
if (doWebhook) {
  try { const buf = await this.helpers.getBinaryDataBuffer(0, 'data'); bruto = buf.toString('utf8'); }
  catch (x) {
    erroBruto = String((x && x.message) || x).slice(0, 200);
    try { if (it.binary && it.binary.data && it.binary.data.data) bruto = Buffer.from(it.binary.data.data, 'base64').toString('utf8'); } catch (y) { /* sem corpo bruto */ }
  }
}
let body = doWebhook ? e.body : (e.body || e);
if (doWebhook && (!body || !Object.keys(body).length) && bruto) { try { body = JSON.parse(bruto); } catch (x) { body = {}; } }
return [{ json: { doWebhook: doWebhook, headers: doWebhook ? e.headers : {}, body: body, agora: doWebhook ? null : (e.agora || null), bruto: bruto, erro_bruto: bruto ? null : erroBruto } }];`);
  const ls = pgLiteral(wf, 'Ler segredos', "select acq_n8n.cursor_ler('ACQ-07', 'segredos_webhook') as segredos");
  const cs = code(wf, 'Conferir e separar', ['comercial', 'wf07'], `
const b = $('Ler corpo bruto').first().json;
const C = acqComCfg(CFG);
const seg = (($input.first().json.segredos) || {}).valor || {};
const agoraMs = b.agora ? Date.parse(b.agora) : Date.now();
const run = acqRunId(${JSON.stringify(W)}, agoraMs, Math.random());
const ctx = { run_id: run, agoraMs: agoraMs };
if (b.doWebhook && C.exigir_assinatura !== false) {
  const a = acq07Assinatura(b.bruto, (b.headers || {})['x-hub-signature-256'], seg.app_secret);
  if (!a.ok) return [{ json: { tipo: 'rejeitado', _ctx: ctx, pg: acqComPgEvento(null, { key: 'ACQ-07|webhook_recusado|' + a.motivo, sev: a.motivo === 'assinatura_invalida' ? 'aviso' : 'alto',
    titulo: 'Webhook do WhatsApp recusado: ' + a.motivo, detalhe: { motivo: a.motivo, erro_bruto: b.erro_bruto } }, AMBIENTE) } }];
}
const n = acq07Normalizar(b.body, C.phone_number_id);
const out = [];
n.mensagens.forEach((m) => out.push({ json: { tipo: 'mensagem', m: m, _ctx: ctx, pg: acqComPgEvento(acq07EventoEntrada(m, ctx), null, AMBIENTE) } }));
n.status.forEach((s) => {
  const ev = acq07EventoStatus(s, ctx);
  const erro = s.erros[0] || {};
  if (ev) out.push({ json: { tipo: 'status', _ctx: ctx, pg: acqComPgEvento(ev, { key: 'ACQ-07|entrega_falhou|' + (erro.code || 'x'), sev: 'aviso',
    titulo: 'WhatsApp não entregou mensagem do Mercúrio: ' + (erro.title || erro.message || 'falha'), detalhe: s }, AMBIENTE) } });
});
return out;`);
  const rv = pg(wf, 'Reivindicar mensagens', SQL_EVENTO_E_INCIDENTE(W, false));
  const sm = code(wf, 'Separar mensagens', ['comercial', 'wf07'], `
const sep = $('Conferir e separar').all();
const out = [];
$input.all().forEach((i, idx) => { const s = sep[idx].json; if (s.tipo === 'mensagem' && i.json.evento && i.json.evento.novo === true) out.push({ json: { m: s.m, _ctx: s._ctx, audio: !!s.m.midia_id && (s.m.midia === 'audio' || s.m.midia === 'voice'), url_midia: String(acqComCfg(CFG).graph_url).replace(/\\/+$/, '') + '/' + s.m.midia_id }, pairedItem: { item: idx } }); });
return out;`);
  const ea = se(wf, 'É áudio?', '={{ $json.audio === true }}');
  const bm = wf.no('Achar o áudio na Meta', 'n8n-nodes-base.httpRequest', 4.5, { method: 'GET', url: '={{ $json.url_midia }}', authentication: 'genericCredentialType', genericAuthType: 'httpBearerAuth', options: { timeout: 20000 } },
    { credentials: CRED.meta, onError: 'continueRegularOutput', retryOnFail: true, maxTries: 2, waitBetweenTries: 2000 }, 2);
  const ba = wf.no('Baixar o áudio', 'n8n-nodes-base.httpRequest', 4.5, { method: 'GET', url: '={{ $json.url }}', authentication: 'genericCredentialType', genericAuthType: 'httpBearerAuth', options: { timeout: 30000, response: { response: { responseFormat: 'file', outputPropertyName: 'data' } } } },
    { credentials: CRED.meta, onError: 'continueRegularOutput', retryOnFail: true, maxTries: 2, waitBetweenTries: 2000 }, 2);
  const pt = code(wf, 'Pedir transcrição', ['comercial', 'wf07'], `
const out = [];
const itens = $input.all();
for (let idx = 0; idx < itens.length; idx++) {
  let b64 = null;
  try { b64 = (await this.helpers.getBinaryDataBuffer(idx, 'data')).toString('base64'); } catch (x) { b64 = null; }
  out.push({ json: { llm: b64 ? acq07PedidoTranscricao(b64, CFG) : { model: acqComCfg(CFG).transcricao_modelo, messages: [{ role: 'user', content: 'Responda só: [inaudível]' }], max_tokens: 5 }, llm_url: acqComCfg(CFG).llm_url }, pairedItem: { item: idx } });
}
return out;`, {}, 2);
  const tr = wf.no('Transcrever o áudio', 'n8n-nodes-base.httpRequest', 4.5, {
    method: 'POST', url: '={{ $json.llm_url }}', authentication: 'genericCredentialType', genericAuthType: 'httpBearerAuth',
    sendHeaders: true, headerParameters: { parameters: [{ name: 'X-Title', value: 'Aceleriq Mercurio (n8n)' }] },
    sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.llm) }}',
    options: { timeout: 60000, response: { response: { fullResponse: false, responseFormat: 'json' } } },
  }, { credentials: CRED.llm, onError: 'continueRegularOutput', retryOnFail: true, maxTries: 2, waitBetweenTries: 3000 }, 2);
  const lt = code(wf, 'Ler transcrição', ['comercial', 'wf07'], `
const orig = $('Separar mensagens').all().filter((x) => x.json.audio === true);
return $input.all().map((i, idx) => {
  const b = orig[idx].json;
  const t = acq07LerTranscricao(i.json);
  return { json: { m: Object.assign({}, b.m, { texto: t, transcrito: !!t }), _ctx: b._ctx }, pairedItem: { item: idx } };
});`, {}, 2);
  const gt = code(wf, 'Guardar texto', ['comercial', 'wf07'], `
return $input.all().map((i, idx) => ({ json: { pg: acqComPgEvento(acq07EventoTexto(i.json.m, i.json._ctx), null, AMBIENTE, { m: i.json.m, de8: acq07De8(i.json.m.de), _ctx: i.json._ctx }) }, pairedItem: { item: idx } }));`);
  const gx = pg(wf, 'Gravar texto', SQL_EVENTO_E_INCIDENTE(W, true));
  const es = wf.no('Esperar a pessoa terminar', 'n8n-nodes-base.wait', 1.1, { amount: 15, unit: 'seconds' }, { webhookId: 'acq07-espera-0000-4000-a000-000000000007', notes: 'Quem manda três mensagens seguidas recebe uma resposta só. Se chegar outra nesse tempo, a execução da mais nova responde por todas.' });
  const jm = wf.no('Juntar mensagens', 'n8n-nodes-base.postgres', 2.7, { operation: 'executeQuery',
    query: `select (select e.entity_id from acq_n8n.eventos e where e.workflow_id = 'ACQ-07' and e.tipo = 'comercial_entrada_recebida' and e.payload->>'de8' = $1 order by e.occurred_at desc, e.entity_id desc limit 1) as mais_nova,
  coalesce((select json_agg(t.payload order by t.occurred_at) from acq_n8n.eventos t where t.workflow_id = 'ACQ-07' and t.tipo = 'comercial_entrada_texto' and t.payload->>'de8' = $1
    and t.occurred_at > ($2::timestamptz - interval '30 minutes')
    and not exists (select 1 from acq_n8n.eventos d where d.workflow_id = 'ACQ-07' and d.tipo like 'comercial_entrada_%' and d.payload ? 'wamids' and d.payload->'wamids' ? (t.payload->'m'->>'wamid'))), '[]'::json) as mensagens,
  $3::jsonb as ctx`,
    options: { queryReplacement: '={{ [$json.ctx.de8, $json.ctx.m.em, JSON.stringify($json.ctx)] }}' } },
    { credentials: CRED.pg, retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 });
  const pr = code(wf, 'Preparar rodada', ['comercial', 'wf07'], `
${PEDIDO(W)}
const out = [];
$input.all().forEach((i, idx) => {
  const l = acq07Lote(i.json.ctx.m, { mais_nova: i.json.mais_nova, mensagens: i.json.mensagens });
  if (!l.seguir) return;
  const ctx = i.json.ctx._ctx;
  out.push({ json: pedido({ ref: 'fila', ferramenta: 'aceleriq_comercial_fila', argumentos: { operador: acqComCfg(CFG).operador, limit: 100 } }, ctx.run_id, { _ctx: Object.assign({}, ctx, { m: l.m }) }), pairedItem: { item: idx } });
});
return out.slice(0, 1);`);
  const lf = ferramenta(wf, 'Ler fila do Mercúrio');
  const pl = code(wf, 'Pedir lead', ['comercial', 'wf07'], `
${PEDIDO(W)}
const ctx = $('Preparar rodada').first().json._ctx;
const f = $input.first().json;
const fila = f.ok ? f.resultado : null;
const noFila = fila ? acq07AcharLead(ctx.m, fila) : null;
return [{ json: pedido(noFila || !fila ? { ref: 'lead|' + ctx.m.wamid, ferramenta: 'nenhuma', argumentos: {} } : acq07PedidoAcharLead(ctx.m, CFG), ctx.run_id) }];`);
  const al = ferramenta(wf, 'Achar ou criar lead');
  const re = code(wf, 'Registrar entradas', ['comercial', 'wf07'], `
${PEDIDO(W)}
const ctx = $('Preparar rodada').first().json._ctx;
const f = $('Ler fila do Mercúrio').first().json;
const fila = f.ok ? f.resultado : null;
const lead = (fila ? acq07AcharLead(ctx.m, fila) : null) || acq07LeadDoResultado($input.first().json, ctx.m);
const peds = acq07PedidoEntrada(ctx.m, lead);
return (peds.length ? peds : [{ ref: 'entrada|' + ctx.m.wamid + '|sem_lead', ferramenta: 'nenhuma', argumentos: {} }]).map((p) => ({ json: pedido(p, ctx.run_id) }));`);
  const ge = ferramenta(wf, 'Gravar entradas no painel');
  const pj = code(wf, 'Pedido ao Jev', ['comercial', 'wf07'], `
const ctx = $('Preparar rodada').first().json._ctx;
const f = $('Ler fila do Mercúrio').first().json;
const fila = f.ok ? f.resultado : null;
const lead = (fila ? acq07AcharLead(ctx.m, fila) : null) || acq07LeadDoResultado($('Achar ou criar lead').first().json, ctx.m);
const regs = $input.all().map((i) => i.json);
const reg = regs.filter((r) => String(r.ref || '').indexOf('entrada|' + ctx.m.wamid) === 0)[0];
return [{ json: { mensagem: ctx.m, lead: lead, registro_entrada: reg && reg.ferramenta !== 'nenhuma' ? { ok: reg.ok === true, simulado: reg.simulado === true, resultado: reg.resultado || null, erro: reg.erro || null } : null,
  jev: acq07PedidoJev(ctx.m, lead), jev_url: CFG.jev_url } }];`);
  const jv = wf.no('Classificar com Jev', 'n8n-nodes-base.httpRequest', 4.5, {
    method: 'POST', url: '={{ $json.jev_url }}', authentication: 'genericCredentialType', genericAuthType: 'httpBearerAuth',
    sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.jev) }}',
    options: { timeout: 20000, response: { response: { fullResponse: false, responseFormat: 'json' } } },
  }, { credentials: CRED.jev, onError: 'continueRegularOutput', retryOnFail: true, maxTries: 3, waitBetweenTries: 3000 });
  const dc = code(wf, 'Decidir', ['comercial', 'wf07'], `
const ctx = $('Preparar rodada').first().json._ctx;
const b = $('Pedido ao Jev').first().json;
const f = $('Ler fila do Mercúrio').first().json;
const fila = f.ok ? f.resultado : null;
const julg = acq07LerJev($input.first().json);
const reg = b.registro_entrada && b.registro_entrada.ok && !b.registro_entrada.simulado ? b.registro_entrada.resultado : null;
const d = acq07Decidir(b.mensagem, b.lead, reg, julg, fila, CFG, ctx.agoraMs);
return [{ json: { mensagem: b.mensagem, lead: b.lead, registro_entrada: b.registro_entrada, julgamento: julg, decisao: d, agora: new Date(ctx.agoraMs).toISOString(), ate: new Date(ctx.agoraMs + 21 * 86400000).toISOString(), google_url: acqComCfg(CFG).google_url, google_id: acqComCfg(CFG).google_agenda_id } }];`);
  const qr = se(wf, 'Mercúrio responde?', '={{ $json.decisao.responder === true }}');
  const ag = se(wf, 'Precisa de agenda?', '={{ $json.decisao.agenda === true }}');
  const gf = wf.no('Ler Google Agenda', 'n8n-nodes-base.httpRequest', 4.5, {
    method: 'POST', url: '={{ $json.google_url + "/freeBusy" }}', authentication: 'predefinedCredentialType', nodeCredentialType: 'googleCalendarOAuth2Api',
    sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: '={{ JSON.stringify({ timeMin: $json.agora, timeMax: $json.ate, timeZone: "America/Sao_Paulo", items: [{ id: $json.google_id }] }) }}',
    options: { timeout: 15000 },
  }, { credentials: CRED.google, onError: 'continueRegularOutput', notes: 'Sem a credencial do Google, a agenda segue só com as reuniões do painel, uma por dia.' });
  const ph = code(wf, 'Pedir horários', ['comercial', 'wf07'], `
${PEDIDO(W)}
const ctx = $('Preparar rodada').first().json._ctx;
const b = $('Decidir').first().json;
const g = $input.first().json;
const cal = g && g.calendars ? g.calendars[b.google_id] : null;
const ocupados = cal && Array.isArray(cal.busy) ? cal.busy.map((x) => ({ inicio: x.start, fim: x.end })) : null;
return [{ json: pedido({ ref: 'horarios|' + b.mensagem.wamid, ferramenta: 'aceleriq_comercial_horarios', argumentos: ocupados ? { ocupados: ocupados } : {} }, ctx.run_id) }];`);
  const lh = ferramenta(wf, 'Ler horários');
  const pz = code(wf, 'Preparar redação', ['comercial', 'wf07'], `
const b = $('Decidir').first().json;
const f = $('Ler fila do Mercúrio').first().json;
const fila = f.ok ? f.resultado : null;
const r = $('Ler horários').isExecuted ? $('Ler horários').first().json : null;
const horarios = (r && r.ok && r.resultado && r.resultado.horarios) || [];
return [{ json: Object.assign({}, b, { horarios: horarios, llm: acq07PedidoLLM(b.mensagem, b.lead, b.decisao, fila, CFG, horarios), llm_url: acqComCfg(CFG).llm_url }) }];`);
  const llm = wf.no('Mercúrio redige (OpenRouter)', 'n8n-nodes-base.httpRequest', 4.5, {
    method: 'POST', url: '={{ $json.llm_url }}', authentication: 'genericCredentialType', genericAuthType: 'httpBearerAuth',
    sendHeaders: true, headerParameters: { parameters: [{ name: 'X-Title', value: 'Aceleriq Mercurio (n8n)' }] },
    sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.llm) }}',
    options: { timeout: 60000, response: { response: { fullResponse: false, responseFormat: 'json' } } },
  }, { credentials: CRED.llm, onError: 'continueRegularOutput', retryOnFail: true, maxTries: 2, waitBetweenTries: 3000 });
  const mr = code(wf, 'Conferir texto', ['comercial', 'wf07'], `
${PEDIDO(W)}
const ctx = $('Preparar rodada').first().json._ctx;
const f = $('Ler fila do Mercúrio').first().json;
const conf = f.ok && f.resultado && f.resultado.config ? f.resultado.config : {};
const b = $('Preparar redação').first().json;
const resp = acq07LerLLM($input.first().json, CFG, conf.orientacoes || '', { mensagens: ((b.lead && b.lead.mensagens) || []).concat([{ direcao: 'entrada', texto: b.mensagem.texto }]) });
const it = Object.assign({}, b, { llm: null, resposta: resp });
const p = acq07PedidoCobranca(it, CFG) || acq07PedidoReuniao(it, CFG, b.horarios);
return [{ json: pedido(p || { ref: 'cobranca|' + b.mensagem.wamid, ferramenta: 'nenhuma', argumentos: {} }, ctx.run_id, { _it: it }) }];`);
  const gc = ferramenta(wf, 'Gerar Pix ou marcar reunião');
  const me = code(wf, 'Montar envio', ['comercial', 'wf07'], `
const C = acqComCfg(CFG);
const it = $('Conferir texto').first().json._it;
const res = $input.first().json;
const ehReuniao = String(res.ref || '').indexOf('reuniao|') === 0;
const hEscolhido = (it.horarios || []).filter((h) => it.resposta && h.inicio === it.resposta.horario_escolhido)[0];
const reuniao = ehReuniao ? acq07ResultadoReuniao(res, hEscolhido) : null;
const cob = ehReuniao ? { partes: reuniao && reuniao.marcada ? [] : (reuniao ? reuniao.partes : []), caixa: false } : acq07PartesDaCobranca(it, res);
const d = Object.assign({}, it.decisao);
if (reuniao && reuniao.marcada) { d.caixa = true; d.reuniao = reuniao; d.motivos = d.motivos.concat(['reuniao_marcada']); }
if (cob.caixa) { d.caixa = true; d.motivo_caixa = String(cob.motivo).slice(0, 200); d.motivos = d.motivos.concat(['cobranca_nao_gerada']); }
const resp = it.resposta;
if (!resp.ok && it.decisao.modo !== 'menu') { d.caixa = true; d.motivo_caixa = 'o texto automático foi bloqueado (' + String(resp.motivo).split(':')[0] + ')'; d.motivos = d.motivos.concat(['texto_de_reserva']); }
const textos = resp.ok ? resp.partes.concat(cob.partes) : d.caixa ? [ACQ07_TEXTO_DE_RESERVA] : [];
const tr = acqComTransporte(CFG, ${JSON.stringify(W)}, null);
const url = String(C.graph_url).replace(/\\/+$/, '') + '/' + C.phone_number_id + '/messages';
const falado = d.voz && resp.ok ? resp.partes.join(' ') : '';
const voz = falado && falado.length <= 900 && !/https?:|www\\./i.test(falado) ? falado : null;
const envio = !textos.length ? { decisao: 'sem_texto', motivo: resp.motivo }
  : { decisao: tr.decisao, motivo: tr.motivo, url: url, media_url: url.replace(/messages$/, 'media'), textos: textos, para: it.mensagem.de, voz: voz, quantas_voz: voz ? resp.partes.length : 0 };
const google = reuniao && reuniao.marcada && !reuniao.simulada && envio.decisao === 'enviar';
return [{ json: Object.assign({}, it, { decisao: d, envio: envio, enviar: envio.decisao === 'enviar', criar_google: !!google, evento_google: google ? acq07EventoDoGoogle(reuniao, it.lead, resp.resumo, CFG) : null, google_url: C.google_url, google_id: C.google_agenda_id }) }];`);
  const cg = se(wf, 'Criar no Google?', '={{ $json.criar_google === true }}');
  const eg = wf.no('Criar evento no Google', 'n8n-nodes-base.httpRequest', 4.5, {
    method: 'POST', url: '={{ $json.google_url + "/calendars/" + encodeURIComponent($json.google_id) + "/events" }}', authentication: 'predefinedCredentialType', nodeCredentialType: 'googleCalendarOAuth2Api',
    sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.evento_google) }}', options: { timeout: 15000 },
  }, { credentials: CRED.google, onError: 'continueRegularOutput' });
  const rt = code(wf, 'Retomar envio', [], `
return [{ json: $('Montar envio').first().json }];`);
  const ev = se(wf, 'Enviar de verdade?', '={{ $json.enviar === true }}');
  const dg = wf.no('Marcar lida e digitando', 'n8n-nodes-base.httpRequest', 4.5, {
    method: 'POST', url: '={{ $json.envio.url }}', authentication: 'genericCredentialType', genericAuthType: 'httpBearerAuth',
    sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: '={{ JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: $json.mensagem.wamid, typing_indicator: { type: "text" } }) }}',
    options: { timeout: 10000, response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } } },
  }, { credentials: CRED.meta, onError: 'continueRegularOutput' });
  const iv = se(wf, 'Responder em áudio?', "={{ !!$('Montar envio').first().json.envio.voz }}");
  const pv = code(wf, 'Pedir voz', ['comercial'], `
${PEDIDO(W)}
const ctx = $('Preparar rodada').first().json._ctx;
const C = acqComCfg(CFG);
return [{ json: pedido({ ref: 'voz|' + $('Montar envio').first().json.mensagem.wamid, ferramenta: 'aceleriq_comercial_falar', argumentos: { texto: $('Montar envio').first().json.envio.voz, voz: C.voz_id, modelo: C.voz_modelo } }, ctx.run_id) }];`);
  const gv = ferramenta(wf, 'Gerar voz (ElevenLabs)');
  const pa = code(wf, 'Preparar áudio', [], `
const r = $input.first().json;
const b64 = r.ok && r.resultado && r.resultado.audio_base64;
if (!b64) return [{ json: { sem_audio: true }, binary: { data: await this.helpers.prepareBinaryData(Buffer.from(''), 'vazio.ogg', 'audio/ogg') } }];
return [{ json: { sem_audio: false }, binary: { data: await this.helpers.prepareBinaryData(Buffer.from(b64, 'base64'), 'voz.ogg', 'audio/ogg') } }];`);
  const sa = wf.no('Subir áudio na Meta', 'n8n-nodes-base.httpRequest', 4.5, {
    method: 'POST', url: "={{ $('Montar envio').first().json.envio.media_url }}", authentication: 'genericCredentialType', genericAuthType: 'httpBearerAuth',
    sendBody: true, contentType: 'multipart-form-data', bodyParameters: { parameters: [{ parameterType: 'formBinaryData', name: 'file', inputDataFieldName: 'data' }, { name: 'messaging_product', value: 'whatsapp' }, { name: 'type', value: 'audio/ogg' }] },
    options: { timeout: 30000 },
  }, { credentials: CRED.meta, onError: 'continueRegularOutput' });
  const sp = code(wf, 'Separar partes', ['comercial'], `
const b = $('Montar envio').first().json;
const idAudio = $('Subir áudio na Meta').isExecuted ? ($('Subir áudio na Meta').first().json || {}).id : null;
const out = [];
let resto = b.envio.textos;
if (idAudio) {
  out.push({ json: { i: 0, envio: { url: b.envio.url, payload: { messaging_product: 'whatsapp', recipient_type: 'individual', to: b.envio.para, type: 'audio', audio: { id: idAudio, voice: true } } } } });
  resto = b.envio.textos.slice(b.envio.quantas_voz);
}
resto.forEach((t) => out.push({ json: { i: out.length, envio: { url: b.envio.url, payload: acqComPayloadTexto(b.envio.para, t) } } }));
return out;`);
  const hm = wf.no('Enviar partes (Cloud API)', 'n8n-nodes-base.httpRequest', 4.5, {
    method: 'POST', url: '={{ $json.envio.url }}', authentication: 'genericCredentialType', genericAuthType: 'httpBearerAuth',
    sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.envio.payload) }}',
    options: { batching: { batch: { batchSize: 1, batchInterval: 3500 } }, timeout: 20000, response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } } },
  }, { credentials: CRED.meta, onError: 'continueRegularOutput', retryOnFail: false, notes: 'Uma mensagem por vez, com pausa, como alguém digitando. Uma tentativa só: timeout vira envio incerto.' });
  const cl = code(wf, 'Classificar envio', ['comercial'], `
const b = $('Montar envio').first().json;
const metas = $input.all().map((i) => acqComClassificarMeta(i.json));
const ruim = metas.filter((x) => x.resultado !== 'aceita')[0];
const meta = ruim ? Object.assign({}, ruim, { wamids: metas.map((x) => x.wamid).filter(Boolean) }) : { resultado: 'aceita', wamid: metas[0].wamid, wamids: metas.map((x) => x.wamid) };
return [{ json: Object.assign({}, b, { meta: meta }) }];`);
  const df = code(wf, 'Desfecho', ['comercial', 'wf07'], `
const ctx = $('Preparar rodada').first().json._ctx;
return $input.all().map((i) => {
  const it = i.json;
  const est = !it.envio ? null : it.envio.decisao === 'enviar' ? (it.meta ? it.meta.resultado : 'incerta') : it.envio.decisao;
  const d = acq07Desfecho(it, est, it.meta || null, ctx);
  const peds = acq07PedidosEscrita(it, est, it.meta || null, CFG, ctx.agoraMs);
  return { json: { pg: acqComPgEvento(d.evento, d.incidente, AMBIENTE, { pedidos: peds }) } };
});`, {}, 1);
  const gd = pg(wf, 'Gravar desfecho', SQL_EVENTO_E_INCIDENTE(W, true), {}, 1);
  const pe = code(wf, 'Pedir escritas', ['comercial', 'wf07'], `
${PEDIDO(W)}
const ctx = $('Preparar rodada').first().json._ctx;
const out = [];
$input.all().forEach((i) => ((i.json.ctx && i.json.ctx.pedidos) || []).forEach((p) => out.push({ json: pedido(p, ctx.run_id) })));
return out;`, {}, 1);
  const gp = ferramenta(wf, 'Gravar no painel', {}, 1);
  const rs = code(wf, 'Resultado das escritas', ['comercial'], `
const ctx = $('Preparar rodada').first().json._ctx;
const out = [];
$input.all().forEach((i) => { const d = acqComResultadoEscrita(${JSON.stringify(W)}, i.json, ctx); if (d) out.push({ json: { pg: acqComPgEvento(d.evento, d.incidente, AMBIENTE) } }); });
return out;`, {}, 1);
  const gr = pg(wf, 'Gravar resultado das escritas', SQL_EVENTO_E_INCIDENTE(W, false), {}, 1);
  wf.cadeia(wg, sg, cv, tc);
  wf.liga(tc, rc, 0); wf.liga(tc, rr, 1);
  wf.liga(wp, lb); wf.liga(ti, lb);
  wf.cadeia(lb, ls, cs, rv, sm, ea);
  wf.liga(ea, bm, 0); wf.liga(ea, gt, 1);
  wf.cadeia(bm, ba, pt, tr, lt, gt);
  wf.cadeia(gt, gx, es, jm, pr, lf, pl, al, re, ge, pj, jv, dc, qr);
  wf.liga(qr, ag, 0); wf.liga(qr, df, 1);
  wf.liga(ag, gf, 0); wf.liga(ag, pz, 1);
  wf.cadeia(gf, ph, lh, pz, llm, mr, gc, me, cg);
  wf.liga(cg, eg, 0); wf.liga(cg, ev, 1);
  wf.cadeia(eg, rt, ev);
  wf.liga(ev, dg, 0); wf.liga(ev, df, 1);
  wf.cadeia(dg, iv);
  wf.liga(iv, pv, 0); wf.liga(iv, sp, 1);
  wf.cadeia(pv, gv, pa, sa, sp, hm, cl, df);
  wf.cadeia(df, gd, pe, gp, rs, gr);
  return wf;
}

// ================================================================ ACQ-08 (comercial: repasse no WhatsApp da Aceleriq)
function acq08() {
  const W = 'ACQ-08';
  const wf = new Wf(IDS.w08, 'ACQ-08-Comercial-Repasses', 'Lê a Caixa do comercial e avisa o WhatsApp da Aceleriq com o contexto: reunião para confirmar, lead que quer falar e Pix confirmado para o onboarding.');
  const t1 = cron(wf, 'A cada 2 minutos', '0 */2 * * * *', 0);
  const t2 = manual(wf, 'Executar manualmente', 1);
  const t3 = wf.no('Entrada interna', 'n8n-nodes-base.executeWorkflowTrigger', 1.2, { inputSource: 'passthrough' }, { col: 0, notes: 'Entrada: { agora?: ISO } (teste).' }, 2);
  const p = code(wf, 'Preparar rodada', ['comercial', 'wf07'], `
${PEDIDO(W)}
const e = $input.first().json || {};
const agoraMs = e.agora ? Date.parse(e.agora) : Date.now();
const run = acqRunId(${JSON.stringify(W)}, agoraMs, Math.random());
return [{ json: pedido({ ref: 'repasses', ferramenta: 'aceleriq_comercial_repasses', argumentos: { limit: 10 } }, run, { _ctx: { run_id: run, agoraMs: agoraMs } }) }];`);
  const lr = ferramenta(wf, 'Ler repasses');
  const me = code(wf, 'Montar repasses', ['comercial', 'wf07'], `
const ctx = $('Preparar rodada').first().json._ctx;
const r = $input.first().json;
const itens = (r.ok && r.resultado && r.resultado.itens) || [];
const tr = acqComTransporte(CFG, ${JSON.stringify(W)}, 'repasse_equipe');
const out = [];
itens.forEach((h) => acq08Envios(h, CFG).forEach((e) => out.push({ json: { h: h, alvo: e.alvo, envio: { url: e.url, payload: e.payload, texto: e.texto, decisao: tr.decisao, motivo: tr.motivo }, enviar: tr.decisao === 'enviar', _ctx: ctx } })));
return out;`);
  const ev = se(wf, 'Enviar de verdade?', '={{ $json.enviar === true }}');
  const hm = httpMeta(wf, 'Enviar repasse (Cloud API)');
  const cl = code(wf, 'Classificar envio', ['comercial'], `
return $input.all().map((i, idx) => { const b = $('Enviar de verdade?').itemMatching(idx).json; return { json: Object.assign({}, b, { meta: acqComClassificarMeta(i.json) }), pairedItem: { item: idx } }; });`);
  const df = code(wf, 'Desfecho', ['comercial', 'wf07'], `
return $input.all().map((i) => {
  const b = i.json;
  const est = b.meta ? b.meta.resultado : b.envio.decisao;
  const ev = acq08Evento(b.h, b.alvo, est, b.meta || null, b._ctx);
  const inc = est === 'simular' || est === 'aceita' ? null : b.alvo === 'lead' && est === 'recusada' ? null : { key: 'ACQ-08|' + est + '|' + (b.meta && b.meta.codigo || b.envio.motivo || 'x'), sev: est === 'bloquear' ? 'aviso' : 'alto', titulo: 'Repasse no WhatsApp não saiu (' + est + '): continua na Caixa', detalhe: { handoff: b.h.id, motivo: b.envio.motivo || (b.meta && b.meta.motivo) || null } };
  const marcar = b.alvo === 'equipe' && est === 'aceita' ? { ref: 'marcar|' + b.h.id + '|' + b.h.lead_id, ferramenta: 'aceleriq_comercial_repasse_marcar', argumentos: { id: b.h.id, wamid: b.meta.wamid } } : null;
  return { json: { pg: acqComPgEvento(ev, inc, AMBIENTE, { marcar: marcar, run_id: b._ctx.run_id }) } };
});`, {}, 1);
  const gd = pg(wf, 'Gravar desfecho', SQL_EVENTO_E_INCIDENTE(W, true), {}, 1);
  const pm = code(wf, 'Pedir marcação', [], `
${PEDIDO(W)}
const out = [];
$input.all().forEach((i) => { if (i.json.ctx && i.json.ctx.marcar) out.push({ json: pedido(i.json.ctx.marcar, i.json.ctx.run_id) }); });
return out;`, {}, 1);
  const gm = ferramenta(wf, 'Marcar repasse no painel', {}, 1);
  wf.liga(t1, p); wf.liga(t2, p); wf.liga(t3, p);
  wf.cadeia(p, lr, me, ev);
  wf.liga(ev, hm, 0); wf.liga(ev, df, 1);
  wf.cadeia(hm, cl, df);
  wf.cadeia(df, gd, pm, gm);
  return wf;
}

export function gerarTodos() {
  return [acq00(), acq00Erros(), acq01(), acq02(), acq03(), acq04(), acq05(), acq06(), acq07(), acq08()];
}

if (process.argv[1] && process.argv[1].endsWith('gerar.mjs')) {
  fs.mkdirSync(SAIDA, { recursive: true });
  for (const wf of gerarTodos()) {
    const j = wf.json();
    const arq = path.join(SAIDA, wf.nome + '.json');
    fs.writeFileSync(arq, JSON.stringify(j, null, 2) + '\n');
    console.log(path.relative(raiz, arq), j.nodes.length, 'nós');
  }
}
