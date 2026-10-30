// Mundo do PILOTO MIRANTE: monta, a partir do snapshot lido em produção (somente leitura, guardado
// FORA do repositório em C:/AI/n8n-local/piloto), as mesmas respostas que o MCP 2.9.0 devolveria.
// As escritas continuam bloqueadas pelo dry-run do ambiente 'pilot' antes de chegar aqui.
import fs from 'node:fs';
const DIR = process.env.ACQ_PILOTO_DIR || 'C:/AI/n8n-local/piloto';

export function criarMundoPiloto(agoraMs) {
  const B = JSON.parse(fs.readFileSync(DIR + '/mirante-base-2026-10-14.json', 'utf8'));
  const X = JSON.parse(fs.readFileSync(DIR + '/mirante-extra-2026-10-14.json', 'utf8'));
  const cid = B.client_id;
  agoraMs = agoraMs || Date.parse(B.agora);
  const clientes = {};
  B.distribuicao.forEach((d) => d.clientes.forEach(([id, nome, sit]) => { clientes[id] = { nome, dia: d.dia, situacao: sit }; }));
  B.nao_aplicavel.forEach(([id, nome]) => { clientes[id] = { nome, dia: null, situacao: 'nao_aplicavel' }; });
  const conta = B.contas[0];
  const pub = B.publicacao;
  const relatorios = B.relatorios.map(([id, title, status, created_at, ritual, canal, rv]) => ({ id, project_id: B.projeto.id, client_id: cid, title, status, created_at,
    period_start: null, period_end: null, metrics: ritual ? { ritual_type: ritual, sent_channel: canal } : {}, review_version: rv }));
  return {
    agoraMs,
    clientes,
    dossies: { [cid]: { version: X.dossie.version, project_id: X.dossie.project_id, updated_at: X.dossie.updated_at, summary: X.dossie.summary, content: X.dossie.content } },
    memoria: { [cid]: X.memoria },
    relatorios: { [cid]: relatorios },
    fila: { esperando_decisao: (X.fila_mirante || []).filter((a) => a.status === 'pendente'), aprovados_para_enviar: (X.fila_mirante || []).filter((a) => a.status === 'aprovado'), rascunhos_sem_pedido: [], enviados_recentes: [] },
    agenda: { [cid]: { scheduled: B.agendadas_14d, ready_without_date: B.prontas,
      published_last_7_days: [{ publication_id: pub.publication_id, post_id: pub.post_id, title: pub.post.title, platform: pub.platform, published_at: pub.published_at, permalink: pub.permalink }], without_art: [] } },
    calendario: { [cid]: [{ kind: 'editorial_post', calendar_date: pub.published_at.slice(0, 10), project: B.projeto,
      post: { id: pub.post_id, title: pub.post.title, content_type: pub.post.content_type, objective: pub.post.objective, publications: [{ id: pub.publication_id, project_id: pub.project_id,
        external_account_id: pub.external_account_id, file_id: pub.file_id, platform: pub.platform, status: 'published', published_at: pub.published_at, scheduled_at: pub.published_at, permalink: pub.permalink, account: conta }] } }] },
    posts: { [cid]: B.posts.map(([media_id, media_type, permalink, posted_at, reach, total]) => ({ client_id: cid, media_id, media_type, permalink, posted_at, reach, total_interactions: total, captured_at: B.posts_captured_at, external_account_id: conta.id })) },
    tarefas: { [cid]: X.tarefas },
    board: { resumo: { em_revisao: B.board_resumo_auditoria_codex.em_revisao, bloqueadas: B.board_resumo_auditoria_codex.bloqueadas, incidentes: (X.runs_recentes.failed || 0) + (X.runs_recentes.timeout || 0) + (X.runs_recentes.blocked || 0), execucoes_sem_heartbeat: 0 },
      operadores: X.operadores.map((o) => ({ slug: o.slug, nome: o.slug, situacao: o.status, ultima_execucao: o.last_run_at })) },
    ads: { [cid]: { auditoria: B.ads_auditoria, memoria: null } },
    registrosDia: { [cid]: (X.registros_dp || []).map((r) => ({ quando: r.quando, tipo: null, titulo: r.titulo })) },
    escritas: [],
    falhas: {},
  };
}
