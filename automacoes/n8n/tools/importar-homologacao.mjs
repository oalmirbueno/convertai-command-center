// Importa os workflows gerados para a instância n8n de HOMOLOGAÇÃO pelo MCP da própria instância
// (/mcp-server/http). Cria INATIVO (rascunho), nunca chama publish_workflow. Idempotente: se o
// workflow com o mesmo nome já existe, atualiza os nós/conexões em vez de duplicar.
// Token: variável de usuário N8N_MCP_TOKEN (Windows) ou ambiente; nunca impresso.
// Uso: node tools/importar-homologacao.mjs [--pasta workflows] [--somente ACQ-00-Erros]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const PASTA = path.resolve(raiz, arg('pasta', 'workflows'));
const SOMENTE = arg('somente', null);
const ORDEM = ['ACQ-00-Erros', 'ACQ-00-Ferramenta-Aceleriq', 'ACQ-01-Contexto-Rituais', 'ACQ-02-Despacho-Aprovado', 'ACQ-03-Post-No-Ar', 'ACQ-04-Conversas-Contexto', 'ACQ-05-Dia-Prioritario-Radar', 'ACQ-06-Comercial-Primeiro-Contato', 'ACQ-07-Comercial-Respostas', 'ACQ-08-Comercial-Repasses'];
const ID_LOCAL = { 'ACQ-00-Erros': 'AcqE00ErrosComum', 'ACQ-00-Ferramenta-Aceleriq': 'AcqF00Ferramenta' };
// Nomes humanos na instância (04/11/2026). O casamento é por nome: sem isto, reimportar duplicaria.
const NOME_REMOTO = {
  'ACQ-00-Erros': 'Apoio: registro de falhas',
  'ACQ-00-Ferramenta-Aceleriq': 'Apoio: ponte com o painel',
  'ACQ-01-Contexto-Rituais': 'Rituais da semana e dossiê (o Hermes já faz)',
  'ACQ-02-Despacho-Aprovado': 'Envio das mensagens aprovadas (o Hermes já faz)',
  'ACQ-03-Post-No-Ar': 'Aviso de post no ar para o cliente',
  'ACQ-04-Conversas-Contexto': 'Leitura das conversas dos grupos',
  'ACQ-05-Dia-Prioritario-Radar': 'Lista do dia: o que fazer em cada cliente',
  'ACQ-06-Comercial-Primeiro-Contato': 'Comercial: primeiro contato no WhatsApp',
  'ACQ-07-Comercial-Respostas': 'Comercial: respostas no WhatsApp',
  'ACQ-08-Comercial-Repasses': 'Comercial: repasse no WhatsApp da Aceleriq',
};
// Atualizar fluxo publicado só com pedido explícito; a nova versão só vale depois de publicar.
const PERMITIR_ATIVO = process.argv.includes('--permitir-ativo');

function envUser(n) {
  if (process.env[n]) return process.env[n];
  return execFileSync('powershell', ['-NoProfile', '-Command', `[Environment]::GetEnvironmentVariable('${n}','User')`], { encoding: 'utf8' }).trim();
}
const BASE = envUser('N8N_BASE_URL');
const TOKEN = envUser('N8N_MCP_TOKEN');
if (!BASE || !TOKEN) throw new Error('Defina N8N_BASE_URL e N8N_MCP_TOKEN (variáveis de usuário).');
let sid = null, seq = 0;
async function rpc(method, params, notify = false) {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer ' + TOKEN };
  if (sid) h['mcp-session-id'] = sid;
  const r = await fetch(BASE + '/mcp-server/http', { method: 'POST', headers: h, body: JSON.stringify(notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++seq, method, params }) });
  sid = r.headers.get('mcp-session-id') || sid;
  const t = await r.text();
  if (notify) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`);
  const linha = t.trim().startsWith('{') ? t : t.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop();
  const j = JSON.parse(linha);
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.result;
}
async function chamar(nome, args) {
  const r = await rpc('tools/call', { name: nome, arguments: args });
  if (r.isError) throw new Error(nome + ': ' + (r.content || []).map((c) => c.text).join(' ').slice(0, 800));
  return r.structuredContent || JSON.parse((r.content || [])[0]?.text || '{}');
}
if (process.argv.includes('--proibir-publicar') === false) { /* publish_workflow nunca é chamado por este script */ }

const SETTINGS_PERMITIDOS = ['executionOrder', 'timezone', 'saveManualExecutions', 'saveDataErrorExecution', 'saveDataSuccessExecution', 'callerPolicy', 'errorWorkflow'];
const NODE_SETTINGS = ['retryOnFail', 'maxTries', 'waitBetweenTries', 'onError', 'executeOnce', 'alwaysOutputData'];

async function main() {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acq-importador-homologacao', version: '1.0' } });
  await rpc('notifications/initialized', {}, true);
  const creds = (await chamar('list_credentials', { limit: 100 })).data || [];
  const credPorNome = Object.fromEntries(creds.map((c) => [c.name, c]));
  const idsRemotos = {};
  const relatorio = [];
  for (const nome of ORDEM) {
    if (SOMENTE && SOMENTE !== nome && !(nome in ID_LOCAL)) continue;
    const wf = JSON.parse(fs.readFileSync(path.join(PASTA, nome + '.json'), 'utf8'));
    const nomeRemoto = NOME_REMOTO[nome] || nome;
    const existentes = ((await chamar('search_workflows', { query: nomeRemoto, limit: 20 })).data || []).filter((w) => w.name === nomeRemoto);
    let id;
    if (existentes.length) {
      id = existentes[0].id;
      const vaiAtualizar = !SOMENTE || SOMENTE === nome;
      if (existentes[0].active && vaiAtualizar && !PERMITIR_ATIVO) throw new Error(nome + ' está ATIVO na homologação; o importador não mexe em workflow ativo.');
    } else {
      const codigo = `import { workflow, sticky } from '@n8n/workflow-sdk';
const nota = sticky('## ${nomeRemoto}\\nImportado INATIVO (homologação) por automacoes/n8n/tools/importar-homologacao.mjs. Não publicar sem o plano de ativação.', [], { color: 3 });
export default workflow('${nome.toLowerCase()}', '${nomeRemoto}').add(nota);`;
      const v = await chamar('validate_workflow', { code: codigo });
      if (v.valid === false) throw new Error('validação SDK falhou: ' + JSON.stringify(v).slice(0, 500));
      const c = await chamar('create_workflow_from_code', { code: codigo, name: nomeRemoto, description: wf.meta.acq.descricao.slice(0, 250), skillsUsed: ['n8n-workflow-patterns', 'n8n-code-javascript', 'n8n-error-handling'] });
      id = c.workflowId || c.id || (c.workflow && c.workflow.id);
      if (!id) throw new Error('create_workflow_from_code não devolveu id: ' + JSON.stringify(c).slice(0, 300));
    }
    idsRemotos[nome] = id;
    if (ID_LOCAL[nome]) idsRemotos[ID_LOCAL[nome]] = id;
    if (SOMENTE && SOMENTE !== nome) continue;

    // Ajusta referências para os ids desta instância.
    const nodes = JSON.parse(JSON.stringify(wf.nodes));
    for (const n of nodes) {
      if (n.type === 'n8n-nodes-base.executeWorkflow' && n.parameters.workflowId) {
        const alvo = idsRemotos[n.parameters.workflowId.value];
        if (!alvo) throw new Error('sub-workflow ainda não importado: ' + n.parameters.workflowId.value);
        n.parameters.workflowId = { __rl: true, mode: 'id', value: alvo, cachedResultName: n.parameters.workflowId.cachedResultName };
      }
    }
    const atual = await chamar('get_workflow_details', { workflowId: id, detailLevel: 'full' }).catch(() => null);
    const nomesAtuais = new Set(((atual && (atual.workflow?.nodes || atual.nodes)) || []).map((n) => n.name));
    const ops = [];
    const semCred = [];
    for (const n of nodes) {
      const base = { name: n.name, type: n.type, typeVersion: n.typeVersion, parameters: n.parameters, position: n.position, id: n.id, ...(n.notes ? { notes: n.notes } : {}) };
      if (n.credentials) {
        const c = {};
        for (const [tipo, ref] of Object.entries(n.credentials)) {
          const achada = credPorNome[ref.name];
          if (achada) c[tipo] = { id: achada.id, name: achada.name }; else semCred.push(n.name + ' → ' + ref.name);
        }
        if (Object.keys(c).length) base.credentials = c;
      }
      if (nomesAtuais.has(n.name)) {
        ops.push({ type: 'updateNodeParameters', nodeName: n.name, parameters: n.parameters, replace: true });
        // Nó que já existia: a conexão (credencial) precisa ser ligada à parte.
        for (const [tipo, ref] of Object.entries(base.credentials || {})) {
          ops.push({ type: 'setNodeCredential', nodeName: n.name, credentialKey: tipo, credentialId: ref.id, credentialName: ref.name });
        }
      } else ops.push({ type: 'addNode', node: base });
      const s = Object.fromEntries(NODE_SETTINGS.filter((k) => n[k] !== undefined).map((k) => [k, n[k]]));
      if (Object.keys(s).length) ops.push({ type: 'setNodeSettings', nodeName: n.name, settings: s });
    }
    const arestas = (c) => Object.entries(c || {}).flatMap(([de, x]) => (x.main || []).flatMap((s, i) => (s || []).map((t) => ({ source: de, target: t.node, sourceIndex: i, targetIndex: t.index }))));
    const chave = (a) => `${a.source}#${a.sourceIndex}->${a.target}#${a.targetIndex}`;
    const locais = arestas(wf.connections), remotas = arestas(atual && (atual.workflow?.connections || atual.connections));
    const kLocais = new Set(locais.map(chave)), kRemotas = new Set(remotas.map(chave));
    // Conexões que sobraram de uma versão anterior saem; as que faltam entram.
    remotas.filter((a) => !kLocais.has(chave(a)) && nomesAtuais.has(a.target)).forEach((a) => ops.push({ type: 'removeConnection', ...a }));
    locais.filter((a) => !kRemotas.has(chave(a))).forEach((a) => ops.push({ type: 'addConnection', ...a }));
    const settings = Object.fromEntries(SETTINGS_PERMITIDOS.filter((k) => wf.settings[k] !== undefined).map((k) => [k, wf.settings[k]]));
    // O n8n só aceita workflow de erro PUBLICADO. Como nada é publicado aqui, o vínculo fica para a
    // ativação (docs/PLANO-DE-ATIVACAO.md, passo 'publicar ACQ-00-Erros e ligar errorWorkflow').
    const erroPendente = settings.errorWorkflow ? (idsRemotos[settings.errorWorkflow] || settings.errorWorkflow) : null;
    delete settings.errorWorkflow;
    ops.push({ type: 'setWorkflowSettings', settings });
    const lotes = [];
    for (let i = 0; i < ops.length; i += 90) lotes.push(ops.slice(i, i + 90));
    for (const [k, lote] of lotes.entries()) {
      const r = await chamar('update_workflow', { workflowId: id, operations: lote, versionName: 'acq-importacao-' + new Date().toISOString().slice(0, 16), skillsUsed: ['n8n-workflow-patterns'] });
      if (r.skippedOperations && r.skippedOperations.length) console.log(nome, 'lote', k, 'operações puladas:', JSON.stringify(r.skippedOperations).slice(0, 400));
    }
    relatorio.push({ nome, id, operacoes: ops.length, sem_credencial: [...new Set(semCred.map((x) => x.split(' → ')[1]))], error_workflow_pendente: erroPendente });
    console.log('importado (inativo):', nome, id, ops.length, 'operações', semCred.length ? `| credenciais a criar: ${[...new Set(semCred.map((s) => s.split(' → ')[1]))].join(', ')}` : '');
  }
  fs.writeFileSync(path.join(raiz, 'piloto', 'homologacao-ids.json'), JSON.stringify({ instancia: BASE.replace(/^https?:\/\//, ''), importado_em: new Date().toISOString(), workflows: relatorio }, null, 2) + '\n');
}
main().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
