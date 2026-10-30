// PILOTO MIRANTE (manual, interno): workflows do ambiente 'pilot' (dry-run forçado, só Mirante) no n8n
// local, lendo um replay do snapshot real da Mirante (lido em produção só com SELECT, guardado fora do
// repositório). Nenhuma escrita no painel, nenhum envio. Gera piloto/PILOTO-MIRANTE.md e o JSON de evidência.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { importar, executar, publicarLocal, N8N_DIR } from './n8n-local.mjs';
import { criarMcpReplay } from './servidores-teste.mjs';
import { criarMundoPiloto } from './mundo-piloto.mjs';
import { harness } from './harness.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = 'acq_piloto';
const PG = { host: '127.0.0.1', port: 54329, user: 'postgres', password: 'teste-local' };
const M = 'eb1270a5-4d9e-4c67-bb17-e25fa12ada34';
const PASTA_WF = path.join('C:/AI/n8n-local', 'piloto', 'workflows-piloto-local');

const root = new pg.Client({ ...PG, database: 'postgres' }); await root.connect();
await root.query(`drop database if exists ${DB} with (force)`);
await root.query(`create database ${DB} encoding 'UTF8' template template0`);
await root.end();
const db = new pg.Client({ ...PG, database: DB }); await db.connect();
await db.query(fs.readFileSync(path.join(raiz, 'migrations', '20261014120000_acq_n8n_estado.sql'), 'utf8'));
const q = async (s, p) => (await db.query(s, p)).rows;

// Replay do snapshot real na porta 8793. O token de teste só existe aqui.
const estado = { mundo: criarMundoPiloto(Date.now()), idem: {}, chamadas: [], falhas: {} };
const servidor = http.createServer(criarMcpReplay(estado, criarMundoPiloto));
await new Promise((r) => servidor.listen(8793, '127.0.0.1', r));

const pasta = path.join(N8N_DIR, 'tmp-piloto'); fs.rmSync(pasta, { recursive: true, force: true }); fs.mkdirSync(pasta, { recursive: true });
for (const f of fs.readdirSync(PASTA_WF)) fs.copyFileSync(path.join(PASTA_WF, f), path.join(pasta, f));
fs.writeFileSync(path.join(pasta, 'h05t.json'), JSON.stringify(harness('AcqPilotoH05Tec1', 'PILOTO-ACQ-05-tecnico', 'Acq05DiaPrioRadr', { modo: 'tecnico' })));
fs.writeFileSync(path.join(pasta, 'h03r.json'), JSON.stringify(harness('AcqPilotoH03Rec1', 'PILOTO-ACQ-03-reconciliacao', 'Acq03PostNoArPub', { modo: 'reconciliacao' })));
console.log(await importar(pasta, DB));
await publicarLocal(['AcqE00ErrosComum', 'AcqF00Ferramenta', 'Acq03PostNoArPub', 'Acq05DiaPrioRadr']);

const execs = {};
const rodar = async (nome, id) => {
  const r = await executar(id);
  const rd = r.dados && r.dados.data && r.dados.data.resultData;
  execs[nome] = { ms: r.ms, erro: rd && rd.error ? rd.error.message : (r.dados ? null : (r.bruto || '').slice(-500)), nos: rd ? Object.keys(rd.runData || {}) : [] };
  console.log(nome, execs[nome].erro ? 'ERRO ' + execs[nome].erro : 'ok', r.ms + 'ms');
  return rd;
};

// 01 — contexto e ritual (gatilho manual do piloto: só Mirante, ritual do dia)
const rd01 = await rodar('ACQ-01', 'Acq01ContextoRit');
const rd01b = await rodar('ACQ-01 (replay)', 'Acq01ContextoRit');
// 05 — pauta do dia e verificação técnica
await rodar('ACQ-05 pauta', 'Acq05DiaPrioRadr');
await rodar('ACQ-05 pauta (replay)', 'Acq05DiaPrioRadr');
await rodar('ACQ-05 técnico', 'AcqPilotoH05Tec1');
// 03 — primeira ativação (cursor) e, depois, cursor anterior a 08/10 para exercitar o aviso real
await rodar('ACQ-03 primeira ativação', 'Acq03PostNoArPub');
await q("update acq_n8n.cursores set valor = '{\"desde\":\"2026-10-08T00:00:00Z\"}'::jsonb, versao = versao + 1 where workflow_id = 'ACQ-03'");
await rodar('ACQ-03 com cursor anterior ao post de 08/10', 'Acq03PostNoArPub');
await rodar('ACQ-03 reconciliação', 'AcqPilotoH03Rec1');
// 02 — fila real da Mirante (nenhum aprovado para enviar)
await rodar('ACQ-02', 'Acq02DespachoApr');

const no = (rd, nome) => (rd && rd.runData && rd.runData[nome] ? rd.runData[nome].flatMap((r) => (r.data?.main || []).flat().map((i) => i.json)) : []);
const analise = no(rd01, 'Analisar e propor')[0];
const escritas01 = no(rd01, 'Gravar no painel (etapa 1)').concat(no(rd01, 'Pedir revisão'));
const propostas = await q('select workflow_id, tipo, referencia, estado, motivo, base_versao, conteudo, criada_em from acq_n8n.propostas order by criada_em');
const eventos = await q('select workflow_id, tipo, entity_type, entity_id, idempotency_key, evidence_refs, payload from acq_n8n.eventos order by id');
const incidentes = await q('select incident_key, severidade, titulo, ocorrencias, estado from acq_n8n.incidentes');
const saidas = await q('select * from acq_n8n.saidas');
const chamadas = estado.chamadas.map((c) => c.ferramenta);
const escritasNoReplay = estado.mundo.escritas;

const evid = { executado_em: new Date().toISOString(), modo: 'pilot (dry-run forçado; escritas simuladas antes da rede)', fonte: 'snapshot somente leitura de 14/10/2026 (replay local)', execucoes: execs,
  chamadas_ao_mcp: chamadas, escritas_que_chegaram_ao_mcp: escritasNoReplay.length, analise_acq01: analise ? analise.analise : null,
  escritas_simuladas_acq01: escritas01.filter((e) => e.ferramenta !== 'nenhuma').map((e) => ({ ferramenta: e.ferramenta, ok: e.ok, simulado: e.simulado, motivo: e.motivo, erro: e.erro && e.erro.tipo })),
  propostas, eventos, incidentes, saidas };
fs.writeFileSync(path.join(raiz, 'piloto', 'piloto-mirante-evidencia.json'), JSON.stringify(evid, null, 2) + '\n');

// ---------------- relatório legível
const a = analise ? analise.analise : null;
const ritual = propostas.find((p) => p.tipo === 'ritual');
const contexto = propostas.find((p) => p.tipo === 'contexto');
const aviso = propostas.find((p) => p.tipo === 'aviso_publicacao');
const pauta = propostas.filter((p) => p.tipo === 'pauta_dia').pop();
const linhas = [];
linhas.push('# Piloto Mirante Luz Floripa — resultado', '');
linhas.push(`Executado em ${evid.executado_em} no n8n 2.42.7 local, ambiente **pilot** (dry-run forçado, allowlist só Mirante),`,
  'lendo um replay do snapshot real lido em produção só com SELECT em 14/10/2026. **Nenhuma escrita chegou ao painel e nada foi enviado.**', '');
linhas.push(`- Chamadas de leitura ao MCP (replay): ${chamadas.length}. Escritas que chegaram ao MCP: **${escritasNoReplay.length}**.`);
linhas.push(`- Execuções: ${Object.entries(execs).map(([k, v]) => `${k} ${v.erro ? '✖ ' + v.erro : '✔'}`).join(' · ')}`, '');
if (a) {
  linhas.push('## ACQ-01 — contexto e ritual', '');
  linhas.push(`Ritual: **${a.ritual.tipo}** da semana de ${a.ritual.semana}. Estado: **${a.estado}**. Dossiê base: v${a.dossie_versao_base}.`, '');
  linhas.push('**Fatos observados (painel)**', ...a.fatos.map((f) => `- ${f.texto} _(${f.fonte.ferramenta})_`), '');
  linhas.push('**Respostas humanas recuperadas** (autor/data/objeto)', ...a.respostas_humanas.slice(0, 6).map((r) => `- ${String(r.em).slice(0, 10)} · ${r.objeto} → “${r.resposta}”${r.ambigua ? ' _(ambígua)_' : ''}${r.autor_conhecido ? '' : ' _(autor não identificado)_'}`), '');
  if (a.respondidas.length) linhas.push('**Já respondido, não vira pergunta**', ...a.respondidas.map((r) => `- ${r.lacuna}: “${r.resposta.resposta}” em ${String(r.resposta.em).slice(0, 10)}`), '');
  linhas.push('**Interpretação automática**', ...a.interpretacoes.map((i) => `- ${i.texto}`), '');
  linhas.push('**Lacunas**', ...(a.lacunas.length ? a.lacunas.map((l) => `- ${l.por_que}`) : ['- nenhuma']), '');
  linhas.push(`**Perguntas (${a.perguntas.length}/2)**`, ...(a.perguntas.length ? a.perguntas.map((p) => `- ${p.pergunta}`) : ['- nenhuma (sem lacuna material sem resposta)']), '');
  if (a.reconciliacao.length) linhas.push('**Reconciliação de históricos (só aponta)**', ...a.reconciliacao.map((r) => `- ${r.tipo}: ${r.titulo || r.approval_id || ''} — ${r.leitura}`), '');
  linhas.push('**Escritas propostas (simuladas no dry-run)**', ...evid.escritas_simuladas_acq01.map((e) => `- ${e.ferramenta}: ${e.simulado ? 'simulada (' + e.motivo + ')' : e.erro || (e.ok ? 'ok' : 'falhou')}`), '');
  if (contexto) linhas.push(`Proposta de contexto: estado **${contexto.estado}**${contexto.motivo ? ' (' + contexto.motivo + ')' : ''}; tamanho resultante ${contexto.conteudo.tamanho_novo} caracteres.`, '');
  if (ritual) {
    linhas.push('### Como apareceria em /relatorios (rascunho)', '', '> **' + ritual.conteudo.title + '**', '>', ...String(ritual.conteudo.summary).split('\n').map((l) => '> ' + l), '>', '> *O que vem agora*:', ...String(ritual.conteudo.next_steps).split('\n').map((l) => '> - ' + l), '');
  }
  if (a.pedido_revisao) linhas.push('### Como apareceria em /ciclo/revisao', '', `Pedido preparado pelo operador \`${a.pedido_revisao.operator}\`, canal **${a.pedido_revisao.channel}** (o do último ritual enviado), aguardando decisão humana. A aprovação e o envio continuam no painel.`, '');
  if (contexto) linhas.push('### Como apareceria no dossiê (/clientes ou /mesa)', '', '```', contexto.conteudo.secao, '```', '');
}
linhas.push('### Em /execucao', '', 'Cada rodada vira um evento com `event_id`, `idempotency_key` e `evidence_refs`. No piloto ficam em `acq_n8n.eventos`; na ativação, o mesmo resumo vai por `aceleriq_operator_report` (operador `n8n`).', '');
linhas.push('Eventos gravados:', ...eventos.map((e) => `- ${e.workflow_id} · ${e.tipo} · ${e.entity_type}:${e.entity_id}`), '');
if (pauta) {
  linhas.push('## ACQ-05 — pauta do Dia Prioritário (quarta)', '');
  linhas.push(...pauta.conteudo.acoes.map((x, i) => `${i + 1}. **${x.titulo}** — ${x.por_que} Próximo passo: ${x.proximo_passo}${x.bloqueio ? ' Bloqueio: ' + x.bloqueio : ''}${x.responsavel ? ' Responsável: tarefa existente ' + x.responsavel.task_id : ' Responsável: não atribuído pela automação'}`));
  linhas.push('', ...pauta.conteudo.avisos.map((x) => '- ' + x), '', `Números (calculados por código): ${JSON.stringify(pauta.conteudo.numeros)}`, '');
}
if (aviso) {
  linhas.push('## ACQ-03 — post no ar', '', `Publicação ${aviso.conteudo.publication_id} (${aviso.conteudo.conta}), mídia ${aviso.conteudo.platform_media_id}, permalink ${aviso.conteudo.permalink}.`,
    `Captura: ${aviso.conteudo.captura.ok ? 'ok' : 'NÃO feita — ' + aviso.conteudo.captura.motivo}. Estado da proposta: **${aviso.estado}**${aviso.motivo ? ' (' + aviso.motivo + ')' : ''}.`, '', 'Mensagem proposta:', '', '> ' + String(aviso.conteudo.mensagem).split('\n').join('\n> '), '',
    `Comparação de alcance: ${aviso.conteudo.comparacao ? JSON.stringify(aviso.conteudo.comparacao) : 'sem prova'} → afirma crescimento: ${aviso.conteudo.afirma_crescimento ? 'sim' : 'não'}.`, '');
}
linhas.push('## Incidentes e exceções', ...(incidentes.length ? incidentes.map((i) => `- [${i.severidade}] ${i.titulo} (${i.ocorrencias}x, ${i.estado})`) : ['- nenhum']), '');
linhas.push('## Replays', `- ACQ-01 repetido: ${eventos.filter((e) => e.workflow_id === 'ACQ-01').length} evento(s) de ritual, propostas sem duplicar (${propostas.filter((p) => p.workflow_id === 'ACQ-01').length}).`,
  `- ACQ-05 repetido: ${propostas.filter((p) => p.tipo === 'pauta_dia').length} pauta(s) registrada(s) (sem mudança não gera outra).`, `- ACQ-02: ${saidas.length} saída(s) — a fila real não tem aprovado para enviar.`, '');
fs.writeFileSync(path.join(raiz, 'piloto', 'PILOTO-MIRANTE.md'), linhas.join('\n') + '\n');
console.log('relatório: piloto/PILOTO-MIRANTE.md');
await new Promise((r) => servidor.close(r)); await db.end();
void rd01b;
