// ACQ-05 — Dia Prioritário e radar operacional (JS puro; depende de nucleo.js).
// Contagens e prazos são calculados aqui; a pauta é montada por regra. Não atribui responsável,
// não conclui tarefa e não registra contato por inferência.

function acq05Modo(agoraMs, modoPedido) {
  if (modoPedido) return modoPedido;
  var sp = acqAgoraSP(agoraMs);
  if (sp.dia_semana === 0 || sp.dia_semana === 6) return 'tecnico';
  if (sp.hora === 8 && sp.minuto < 15) return 'pauta';
  if (sp.hora === 17 && sp.minuto < 15) return 'reconciliacao';
  return 'tecnico';
}

function acq05ClientesDoDia(dia, cfg) {
  var prep = (dia && dia.preparacao) || [];
  var dentro = prep.filter(function (p) { return !Array.isArray(cfg.clientes_permitidos) || cfg.clientes_permitidos.indexOf(p.client_id) >= 0; });
  return dentro.map(function (p) { return { client_id: p.client_id, nome: p.nome, situacao: p.situacao, provisorio: p.situacao === 'provisorio', prep: p }; });
}

function acq05Tarefas(itens, hojeISO) {
  var abertas = (itens || []).filter(function (t) { return ['done', 'archived', 'cancelled'].indexOf(t.status) < 0; });
  var atrasadas = abertas.filter(function (t) { return t.due_date && t.due_date < hojeISO; });
  var urgentes = atrasadas.filter(function (t) { return t.priority === 'urgent' || t.priority === 'high'; })
    .sort(function (a, b) { return String(a.due_date).localeCompare(String(b.due_date)); });
  return { abertas: abertas.length, atrasadas: atrasadas.length, urgentes_atrasadas: urgentes,
    dias_do_mais_antigo: atrasadas.length ? acqDiasEntre(atrasadas.map(function (t) { return t.due_date; }).sort()[0], hojeISO) : 0 };
}

// Até três ações relevantes, cada uma com por quê, evidência, bloqueio, próximo passo e responsável existente.
function acq05Pauta(entrada) {
  var c = entrada.cliente, ag = entrada.agenda || {}, tf = entrada.tarefas, hoje = entrada.hoje;
  var acoes = [];
  var vencidos = ((entrada.fila && entrada.fila.esperando_decisao) || []).filter(function (p) {
    return p.client_id === c.client_id && p.valid_until && p.valid_until < new Date(entrada.agoraMs).toISOString();
  });
  if (vencidos.length) acoes.push({ chave: 'pedido_vencido', peso: 90, titulo: 'Decidir o que fazer com ' + vencidos.length + ' pedido(s) de revisão vencido(s)',
    por_que: 'Pedido passou da validade e continua pendente em /ciclo/revisao.', evidencia: vencidos.map(function (v) { return 'approval:' + v.approval_id; }),
    bloqueio: 'A validade expirou; o pedido precisa ser refeito ou descartado no painel.', proximo_passo: 'Abrir /ciclo/revisao e refazer ou descartar.', responsavel: null });
  var prontas = (ag.ready_without_date || []).length, agendadas = (ag.scheduled || []).length;
  if (agendadas === 0) {
    var tarefaAgenda = (tf.itens || []).filter(function (t) { return /agenda/i.test(String(t.title || '')) && ['done', 'archived', 'cancelled'].indexOf(t.status) < 0; })[0];
    acoes.push({ chave: prontas ? 'agenda_prontas_sem_data' : 'agenda_vazia', peso: prontas ? 85 : 80,
      titulo: prontas ? 'Dar data às ' + prontas + ' pautas prontas' : 'Cobrir a agenda dos próximos 14 dias',
      por_que: prontas ? prontas + ' pautas prontas sem data e 0 agendadas em 14 dias.' : 'Nada agendado e nenhuma pauta pronta.',
      evidencia: ['aceleriq_get_agenda_status: ' + (ag.diagnosis || '')], bloqueio: prontas ? 'Confirmar aprovação da cliente antes de agendar.' : 'Falta produção.',
      proximo_passo: prontas ? 'Confirmar aprovação e agendar no /calendario.' : 'Abrir pauta de produção.',
      responsavel: tarefaAgenda ? { origem: 'tarefa_existente', task_id: tarefaAgenda.id, user_id: tarefaAgenda.assigned_to || null } : null });
  }
  if (tf.atrasadas >= 5) {
    var top = tf.urgentes_atrasadas[0];
    acoes.push({ chave: 'tarefas_atrasadas', peso: 60 + Math.min(tf.atrasadas, 30),
      titulo: 'Repactuar ' + tf.atrasadas + ' tarefas com prazo vencido', por_que: tf.atrasadas + ' de ' + tf.abertas + ' tarefas abertas estão vencidas; a mais antiga há ' + tf.dias_do_mais_antigo + ' dias.',
      evidencia: tf.urgentes_atrasadas.slice(0, 3).map(function (t) { return 'task:' + t.id + ' (' + t.due_date + ')'; }),
      bloqueio: null, proximo_passo: 'Revisar prazos no /kanban' + (top ? ', começando por “' + top.title + '”.' : '.'),
      responsavel: top && top.assigned_to ? { origem: 'tarefa_existente', task_id: top.id, user_id: top.assigned_to } : null });
  }
  var ads = entrada.ads;
  if (ads && ads.auditoria && typeof ads.auditoria.nota === 'number' && ads.auditoria.nota < 60) {
    acoes.push({ chave: 'ads_auditoria_baixa', peso: 70, titulo: 'Ver a auditoria de anúncios (nota ' + ads.auditoria.nota + ')',
      por_que: 'Auditoria existente da Mesa Ads em ' + String(ads.auditoria.criado_em || '').slice(0, 10) + '.', evidencia: ['aceleriq_mesa_ads_saude'],
      bloqueio: null, proximo_passo: 'Abrir /mesa-ads.', responsavel: null, procedencia: 'monitor existente (espelho do painel), não coleta nova na Meta' });
  }
  acoes.sort(function (a, b) { return b.peso - a.peso; });
  var avisos = [];
  if (c.provisorio) avisos.push('Dia Prioritário provisório: confirmar antes de tratar como fixo.');
  if (!(c.prep && c.prep.ultimos_registros || []).length) avisos.push('Sem registro de contato do Dia Prioritário no painel; não há contato presumido.');
  var pauta = { client_id: c.client_id, nome: c.nome, data: hoje, acoes: acoes.slice(0, 3), avisos: avisos,
    numeros: { tarefas_abertas: tf.abertas, tarefas_atrasadas: tf.atrasadas, agendadas_14d: agendadas, prontas_sem_data: prontas } };
  pauta.hash = acqHashDe({ a: pauta.acoes.map(function (x) { return [x.chave, x.titulo]; }), n: pauta.numeros, v: avisos });
  return pauta;
}

// 17h: o que mudou desde a pauta da manhã. Contato só conta se houver registro no painel hoje.
function acq05Reconciliar(pautaManha, pautaTarde, prep, hoje) {
  var manha = {};
  ((pautaManha && pautaManha.acoes) || []).forEach(function (a) { manha[a.chave] = a; });
  var tarde = {};
  ((pautaTarde && pautaTarde.acoes) || []).forEach(function (a) { tarde[a.chave] = a; });
  var itens = Object.keys(manha).map(function (k) {
    return { chave: k, titulo: manha[k].titulo, situacao: tarde[k] ? (tarde[k].titulo === manha[k].titulo ? 'sem_mudanca' : 'mudou') : 'resolvido_no_painel' };
  });
  var registrosHoje = ((prep && prep.ultimos_registros) || []).filter(function (r) { return String(r.quando || '').slice(0, 10) === hoje; });
  return { itens: itens, contato: registrosHoje.length ? { registrado: true, registros: registrosHoje } : { registrado: false, leitura: 'Sem registro de contato hoje no painel (não inferido).' } };
}

// Verificação técnica (15 min). Hermes: o MCP 2.9.0 não tem hermes_status; a prontidão é lida pelo
// heartbeat do operador "default" no quadro, e fica "não confirmada" se não houver sinal recente.
function acq05Tecnico(board, fila, excecoes, agoraMs, cfg) {
  var inc = [];
  var r = (board && board.resumo) || null;
  if (!board) inc.push({ key: 'ACQ-05|quadro|indisponivel', sev: 'alto', titulo: 'Quadro de operadores indisponível', detalhe: {} });
  if (r && r.incidentes > 0) inc.push({ key: 'ACQ-05|operadores|incidentes', sev: 'aviso', titulo: r.incidentes + ' execução(ões) de agente com falha/timeout/bloqueio', detalhe: { incidentes: r.incidentes } });
  if (r && r.execucoes_sem_heartbeat > 0) inc.push({ key: 'ACQ-05|operadores|sem_heartbeat', sev: 'aviso', titulo: r.execucoes_sem_heartbeat + ' execução(ões) sem heartbeat', detalhe: {} });
  // O Hermes novo trabalha pelos agentes (Augusto, Atlas, Helena…); o "Hermes Core" (slug default) é o
  // antigo e está parado. O sinal de vida é a execução mais recente de QUALQUER agente ativo.
  // O quadro devolve a data em `ultima_execucao`.
  var ops = (board && (board.operadores || board.operators)) || [];
  var ativos = ops.filter(function (o) { return (o.situacao || o.status || 'active') === 'active'; });
  var maisRecente = null;
  ativos.forEach(function (o) {
    var t = Date.parse(o.ultima_execucao || o.last_run_at || '');
    if (isFinite(t) && (!maisRecente || t > maisRecente.t)) maisRecente = { t: t, agente: o.nome || o.slug };
  });
  if (board && (!maisRecente || agoraMs - maisRecente.t > 24 * 3600000)) {
    inc.push({ key: 'ACQ-05|hermes|agentes_sem_sinal', sev: 'aviso', titulo: 'Nenhum agente do Hermes deu sinal nas últimas 24 horas',
      detalhe: { ultimo_sinal: maisRecente ? new Date(maisRecente.t).toISOString() : null, agente: maisRecente ? maisRecente.agente : null, fonte: 'operator_board' } });
  }
  var esperando = (fila && fila.esperando_decisao) || [];
  var vencidos = esperando.filter(function (p) { return p.valid_until && Date.parse(p.valid_until) < agoraMs; });
  if (vencidos.length) inc.push({ key: 'ACQ-05|revisao|pedidos_vencidos_pendentes', sev: 'aviso', titulo: vencidos.length + ' pedido(s) de revisão vencido(s) ainda pendente(s)', detalhe: { quantidade: vencidos.length } });
  var aprovados = (fila && fila.aprovados_para_enviar) || [];
  if (aprovados.length) inc.push({ key: 'ACQ-05|revisao|aprovados_sem_envio', sev: 'aviso', titulo: aprovados.length + ' aprovado(s) aguardando envio', detalhe: { quantidade: aprovados.length } });
  (excecoes || []).forEach(function (e) {
    inc.push({ key: 'ACQ-05|editorial|' + e.tipo + '|' + e.client_id + (e.publication_id ? '|' + e.publication_id : ''), sev: e.tipo === 'data_perdida' ? 'alto' : 'aviso',
      titulo: 'Editorial: ' + e.tipo.replace(/_/g, ' '), detalhe: e, client_id: e.client_id });
  });
  return inc;
}
