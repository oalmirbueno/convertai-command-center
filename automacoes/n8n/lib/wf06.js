// ACQ-06 — Comercial: primeiro contato (e retomada opcional) pelo modelo aprovado da Cloud API.
// JS puro; depende de nucleo.js, adaptador.js e comercial.js.
// Regras: só lead entregue ao Mercúrio (está na fila dele), com WhatsApp, sem nao_contatar, sem lead de
// site de cliente, com fato observado, dentro do horário/dia útil e do teto do dia que o painel informa.
// Uma tentativa por lead por dia (reivindicada no Postgres antes de chamar a Meta); depois de aceita ou
// incerta, nunca mais. Erro da Meta nunca vira "enviado".

var ACQ06_TIPOS_QUE_BLOQUEIAM = {
  primeiro_contato: ['comercial_primeiro_contato_aceito', 'comercial_primeiro_contato_incerto'],
  retomada: ['comercial_retomada_aceito', 'comercial_retomada_incerto'],
};

// fila: resultado de aceleriq_comercial_fila. Devolve a regra da rodada e os candidatos em ordem.
function acq06Candidatos(fila, cfg, agoraMs) {
  var c = acqComCfg(cfg);
  var conf = (fila && fila.config) || {};
  var out = { pode: false, motivo: null, limite: 0, candidatos: [], ignorados: [] };
  if (!fila || !conf.ativo) { out.motivo = 'mercurio_desligado'; return out; }
  var h = acqComHorarioDaFila(conf);
  var agora = acqComNoHorario(agoraMs, h[0], h[1]);
  if (!agora.dia_util) { out.motivo = 'fim_de_semana'; return out; }
  if (!agora.dentro || conf.dentro_do_horario === false) { out.motivo = 'fora_do_horario'; return out; }
  var restam = Math.max(0, Number(conf.restam_hoje) || 0);
  out.limite = Math.min(restam, Math.max(0, Number(c.max_por_rodada) || 0));
  var limiteRetomada = Math.max(0, (Number(c.max_por_rodada) || 0));
  var itens = ((fila && fila.itens) || []).slice().sort(function (a, b) {
    var na = Number(a && a.qualificacao && a.qualificacao.encaixe_jev), nb = Number(b && b.qualificacao && b.qualificacao.encaixe_jev);
    return (isFinite(nb) ? nb : -1) - (isFinite(na) ? na : -1);
  });
  var prim = [], ret = [];
  itens.forEach(function (it) {
    var ign = function (m) { out.ignorados.push({ lead_id: it.lead_id, motivo: m }); };
    if (!it || !acqUuidValido(it.lead_id)) return;
    if (acqComNaoContatar(it)) return ign('nao_contatar');
    var q = it.qualificacao || {};
    if (q.client_id) return ign('lead_de_site_de_cliente');
    if (['ganho', 'perdido'].indexOf(it.etapa) >= 0) return ign('etapa_fechada');
    var msgs = it.mensagens || [];
    var entradas = msgs.filter(function (m) { return m.direcao === 'entrada'; });
    var saidas = msgs.filter(function (m) { return m.direcao === 'saida'; });
    var tipo = null;
    if (!it.primeiro_contato_feito && saidas.length === 0) {
      if (entradas.length) return ign('conversa_aberta_pelo_lead');
      tipo = 'primeiro_contato';
    } else if (c.retomada.ativa && entradas.length === 0 && saidas.length === 1) {
      var ult = Date.parse(saidas[saidas.length - 1].enviada_em);
      if (!isFinite(ult) || agoraMs - ult < Number(c.retomada.dias_sem_resposta) * 86400000) return;
      tipo = 'retomada';
    } else {
      return;
    }
    var n = acqComNumero(it.whatsapp);
    if (!n) return ign('sem_whatsapp');
    if (n.fixo) return ign('telefone_fixo');
    // 04/11/2026 (dono): celular da Máquina de leads entra mesmo sem WhatsApp confirmado. Sem WhatsApp, a Meta
    // recusa e nada chega a ninguém; fixo já saiu acima.
    var nome = acqComNomeDoLead(it);
    if (!nome) return ign('sem_nome');
    var params, fato = null;
    if (tipo === 'primeiro_contato') {
      fato = acqComFatoObservado(it);
      if (!fato) return ign('sem_fato_observado');
      params = [nome, fato.texto];
    } else {
      params = [nome];
    }
    var modelo = c.modelos[tipo] || {};
    var cand = { lead_id: it.lead_id, tipo: tipo, numero: n.numero, nome: nome, fato: fato, params: params, lead_frio: it.lead_frio === true, etapa: it.etapa,
      modelo_nome: modelo.nome || null, texto: acqComTextoDoModelo(modelo, params) };
    (tipo === 'primeiro_contato' ? prim : ret).push(cand);
  });
  prim.slice(out.limite).forEach(function (x) { out.ignorados.push({ lead_id: x.lead_id, motivo: 'teto_da_rodada' }); });
  var escolhidos = prim.slice(0, out.limite);
  escolhidos = escolhidos.concat(ret.slice(0, Math.max(0, limiteRetomada - escolhidos.length)));
  out.candidatos = escolhidos;
  out.pode = true;
  out.motivo = escolhidos.length ? null : (restam <= 0 ? 'teto_do_dia_atingido' : 'ninguem_pronto');
  return out;
}

// Evento que reivindica a tentativa do dia (ou registra a simulação). A chave impede repetir no mesmo dia.
function acq06Reivindicacao(cand, transporte, ctx) {
  var simulado = transporte.decisao === 'simular';
  var tipo = 'comercial_' + cand.tipo + (simulado ? '_simulado' : transporte.decisao === 'bloquear' ? '_bloqueado' : '_reivindicado');
  var chave = 'ACQ-06|' + cand.tipo + '|' + cand.lead_id + '|' + ctx.hoje + (simulado ? '|simulado' : transporte.decisao === 'bloquear' ? '|bloqueado' : '');
  return acqEvento({ workflow_id: 'ACQ-06', run_id: ctx.run_id, entity_type: 'lead', entity_id: cand.lead_id,
    occurred_at: new Date(ctx.agoraMs).toISOString(), source: 'n8n:ACQ-06', idempotency_key: chave, tipo: tipo,
    evidence_refs: ['aceleriq_comercial_fila'],
    payload: { tipo: cand.tipo, modelo: cand.modelo_nome, numero_final: cand.numero.slice(-4), params: cand.params, fato_fonte: cand.fato && cand.fato.fonte,
      texto: cand.texto, transporte: transporte.decisao, motivo: transporte.motivo } });
}

// Parâmetros do nó Postgres que reivindica: [lead_id, tipos que bloqueiam (csv), evento, ambiente].
function acq06PgReivindicar(cand, evento, ambiente) {
  return [cand.lead_id, ACQ06_TIPOS_QUE_BLOQUEIAM[cand.tipo].join(','), JSON.stringify(evento), ambiente];
}

// Depois da reivindicação: o que fazer com o candidato.
function acq06Envio(cand, reivindicacao, transporte, cfg) {
  var c = acqComCfg(cfg);
  var r = reivindicacao || {};
  var base = { lead_id: cand.lead_id, tipo: cand.tipo, numero: cand.numero, texto: cand.texto, modelo: cand.modelo_nome, params: cand.params, fato: cand.fato };
  if (r.bloqueado === true) return Object.assign(base, { decisao: 'pular', motivo: 'ja_enviado_ou_incerto' });
  if (r.novo !== true) return Object.assign(base, { decisao: 'pular', motivo: 'ja_tentado_hoje' });
  if (transporte.decisao !== 'enviar') return Object.assign(base, { decisao: transporte.decisao, motivo: transporte.motivo });
  var modelo = c.modelos[cand.tipo];
  return Object.assign(base, { decisao: 'enviar', motivo: null, url: String(c.graph_url).replace(/\/+$/, '') + '/' + c.phone_number_id + '/messages',
    payload: acqComPayloadModelo(cand.numero, modelo, cand.params) });
}

// Evento do desfecho do envio (aceito/recusado/incerto/simulado/bloqueado/pulado) + incidente quando cabe.
function acq06Desfecho(envio, meta, ctx) {
  var est = envio.decisao === 'enviar' ? (meta ? meta.resultado : 'incerta') : envio.decisao;
  if (est === 'pular') return { evento: null, incidente: null, estado: est };
  var nomeEst = { aceita: 'aceito', recusada: 'recusado', incerta: 'incerto', simular: 'simulado_ok', bloquear: 'bloqueado', pular: 'pulado' }[est] || est;
  var chave = 'ACQ-06|' + envio.tipo + '|' + envio.lead_id + '|' + (est === 'aceita' || est === 'incerta' ? nomeEst : ctx.hoje + '|' + nomeEst);
  var ev = acqEvento({ workflow_id: 'ACQ-06', run_id: ctx.run_id, entity_type: 'lead', entity_id: envio.lead_id,
    occurred_at: new Date(ctx.agoraMs).toISOString(), source: 'n8n:ACQ-06', idempotency_key: chave,
    tipo: 'comercial_' + envio.tipo + '_' + nomeEst, evidence_refs: meta && meta.wamid ? ['wamid:' + meta.wamid] : [],
    payload: { decisao: envio.decisao, motivo: envio.motivo, meta: meta || null, texto: envio.texto, modelo: envio.modelo, numero_final: String(envio.numero).slice(-4) } });
  var inc = null;
  if (est === 'incerta') inc = { key: 'ACQ-06|envio_incerto|' + envio.lead_id, sev: 'alto', titulo: 'Envio incerto na Cloud API: conferir no WhatsApp antes de qualquer reenvio', detalhe: { lead_id: envio.lead_id, meta: meta } };
  else if (est === 'recusada' && meta && meta.auth) inc = { key: 'ACQ-06|meta_autenticacao', sev: 'alto', titulo: 'Cloud API recusou a credencial (token/permissão)', detalhe: { meta: meta } };
  else if (est === 'recusada') inc = { key: 'ACQ-06|meta_recusou|' + (meta && meta.codigo), sev: 'aviso', titulo: 'Cloud API recusou o modelo: ' + (meta && meta.motivo || ''), detalhe: { lead_id: envio.lead_id, meta: meta } };
  else if (est === 'bloquear') inc = { key: 'ACQ-06|transporte_incompleto', sev: 'aviso', titulo: 'Transporte do WhatsApp ainda incompleto: ' + envio.motivo, detalhe: { motivo: envio.motivo } };
  return { evento: ev, incidente: inc, estado: est };
}

// O que registrar no painel depois do envio. Só o que saiu de verdade (wamid) ou a simulação do dry-run.
function acq06PedidoRegistro(envio, estado, meta, cfg, agoraMs) {
  var c = acqComCfg(cfg);
  if (estado !== 'aceita' && estado !== 'simular') return null;
  var idExterno = estado === 'aceita' ? meta.wamid : 'simulado:' + envio.tipo + ':' + envio.lead_id;
  return {
    ref: 'registro|' + idExterno + '|' + envio.lead_id,
    ferramenta: 'aceleriq_comercial_registrar_mensagem',
    argumentos: { lead_id: envio.lead_id, direcao: 'saida', texto: envio.texto, canal: 'whatsapp', enviada_em: new Date(agoraMs).toISOString(),
      id_externo: idExterno, operador: c.operador },
  };
}
