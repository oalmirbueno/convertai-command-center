// ACQ-06 — Comercial: primeiro contato (e retomada opcional) pelo modelo aprovado da Cloud API.
// JS puro; depende de nucleo.js, adaptador.js e comercial.js.
// Regras: só lead entregue ao Mercúrio (está na fila dele), com WhatsApp, sem nao_contatar, sem lead de
// site de cliente, com fato observado, dentro do horário/dia útil e do teto do dia que o painel informa.
// Uma tentativa por lead por dia (reivindicada no Postgres antes de chamar a Meta); depois de aceita ou
// incerta, nunca mais. Erro da Meta nunca vira "enviado".

var ACQ06_TIPOS_QUE_BLOQUEIAM = {
  primeiro_contato: ['comercial_primeiro_contato_aceito', 'comercial_primeiro_contato_incerto'],
  retomada: ['comercial_retomada_aceito', 'comercial_retomada_incerto'],
  despedida: ['comercial_despedida_aceito', 'comercial_despedida_incerto'],
  continuar: [], // pode acontecer de novo em outro silêncio; o limite é um por lead por dia (chave da reivindicação).
};

function acq06UltimoEm(msgs) {
  return msgs.reduce(function (m, s) { var t = Date.parse(s.enviada_em); return isFinite(t) && t > m ? t : m; }, -Infinity);
}

// Conversa em que uma pessoa falou, nós perguntamos e ela sumiu, ainda dentro da janela de texto livre.
// Devolve um lead por rodada (o que falou por último) ou null. O texto é redigido depois, com a conversa.
function acq06ConversaParada(fila, cfg, agoraMs, orcamento) {
  var c = acqComCfg(cfg), conf = (fila && fila.config) || {}, r = c.continuar;
  if (!r.ativa || !fila || !conf.ativo) return null;
  if (orcamento && !orcamento.pode_responder) return null;
  var h = acqComHorarioDaFila(conf), agora = acqComNoHorario(agoraMs, h[0], h[1]);
  if (!agora.dia_util || !agora.dentro || conf.dentro_do_horario === false) return null;
  var melhor = null, melhorEm = -Infinity;
  (fila.itens || []).forEach(function (it) {
    if (!it || !acqUuidValido(it.lead_id) || acqComNaoContatar(it) || it.em_fechamento === true) return;
    var q = it.qualificacao || {};
    if (q.client_id || acqComSoRobo(q) || q.pausar_retomada === 'sim') return;
    if (['ganho', 'perdido'].indexOf(it.etapa) >= 0) return;
    var msgs = it.mensagens || [];
    var ultE = acq06UltimoEm(msgs.filter(function (m) { return m.direcao === 'entrada'; }));
    var ultS = acq06UltimoEm(msgs.filter(function (m) { return m.direcao === 'saida'; }));
    if (!isFinite(ultE) || !isFinite(ultS) || ultS < ultE) return; // a vez de responder é nossa: quem cuida é o ACQ-07
    if (ultS - ultE > Number(r.minutos_resposta) * 60000) return; // a última saída já foi uma volta: só uma por silêncio
    if (agoraMs - ultS < Number(r.horas_silencio) * 3600000 || agoraMs - ultE > Number(r.janela_max_horas) * 3600000) return;
    var n = acqComNumero(it.whatsapp);
    if (!n || n.fixo || ultE <= melhorEm) return;
    melhorEm = ultE;
    melhor = { lead_id: it.lead_id, tipo: 'continuar', numero: n.numero, nome: acqComNomeDoLead(it), fato: null, params: [], etapa: it.etapa, modelo_nome: null, texto: null, lead: it };
  });
  return melhor;
}

// Envio da volta: texto livre já conferido pelas travas do ACQ-07. Texto reprovado não sai.
function acq06EnvioContinuar(cand, reivindicacao, transporte, cfg, resp) {
  var c = acqComCfg(cfg), r = reivindicacao || {};
  var base = { lead_id: cand.lead_id, tipo: 'continuar', numero: cand.numero, texto: resp && resp.ok ? resp.texto : null, modelo: null, params: [], fato: null };
  if (r.novo !== true) return Object.assign(base, { decisao: 'pular', motivo: 'ja_tentado_hoje' });
  if (!resp || !resp.ok) return Object.assign(base, { decisao: 'pular', motivo: 'texto_reprovado:' + (resp && resp.motivo) });
  if (transporte.decisao !== 'enviar') return Object.assign(base, { decisao: transporte.decisao, motivo: transporte.motivo });
  return Object.assign(base, { decisao: 'enviar', motivo: null, url: String(c.graph_url).replace(/\/+$/, '') + '/' + c.phone_number_id + '/messages', payload: acqComPayloadTexto(cand.numero, resp.texto) });
}

// fila: resultado de aceleriq_comercial_fila. Devolve a regra da rodada e os candidatos em ordem.
function acq06Candidatos(fila, cfg, agoraMs, orcamento) {
  var c = acqComCfg(cfg);
  var conf = (fila && fila.config) || {};
  var out = { pode: false, motivo: null, limite: 0, candidatos: [], ignorados: [] };
  if (!fila || !conf.ativo) { out.motivo = 'mercurio_desligado'; return out; }
  if (orcamento && !orcamento.pode_prospectar) { out.motivo = 'teto_do_mes'; return out; }
  var h = acqComHorarioDaFila(conf);
  var agora = acqComNoHorario(agoraMs, h[0], h[1]);
  if (!agora.dia_util) { out.motivo = 'fim_de_semana'; return out; }
  if (!agora.dentro || conf.dentro_do_horario === false) { out.motivo = 'fora_do_horario'; return out; }
  var restam = Math.max(0, Number(conf.restam_hoje) || 0);
  out.limite = Math.min(restam, Math.max(0, Number(c.max_por_rodada) || 0));
  var limiteRetomada = Math.max(0, (Number(c.max_por_rodada) || 0));
  if (orcamento) { out.limite = Math.min(out.limite, orcamento.modelos_restantes); limiteRetomada = Math.min(limiteRetomada, orcamento.modelos_restantes); }
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
    // Robô de atendimento do lead não conta como resposta (o ACQ-07 marca qualificacao.so_robo).
    var humano = entradas.length > 0 && !acqComSoRobo(q);
    var toques = saidas.filter(function (s) { return acqComEhModelo(s.texto, cfg); }).length;
    if (!toques && (it.primeiro_contato_feito || saidas.length)) toques = 1;
    if (!it.primeiro_contato_feito && saidas.length === 0) {
      if (entradas.length) return ign('conversa_aberta_pelo_lead');
      tipo = 'primeiro_contato';
    } else if (c.cadencia.ativa) {
      var ultimaSaida = acq06UltimoEm(saidas), ultimaEntrada = acq06UltimoEm(entradas);
      // 09/11: prospecção em que a pessoa falou e sumiu depois da nossa pergunta entra na cadência.
      // Quem pediu tempo, está em fechamento ou espera resposta nossa fica fora.
      var pessoaSumiu = humano && it.lead_frio === true && ultimaSaida >= ultimaEntrada && it.em_fechamento !== true && q.pausar_retomada !== 'sim';
      if ((humano && !pessoaSumiu) || toques < 1 || toques > 2) return;
      var desde = Math.max(ultimaSaida, ultimaEntrada);
      if (acqComDiasUteis(desde, agoraMs) < Number(c.cadencia.dias_uteis[toques - 1])) return;
      tipo = toques === 1 ? 'retomada' : 'despedida';
      if (!(c.modelos[tipo] && c.modelos[tipo].aprovado === true)) return ign('modelo_nao_aprovado:' + tipo);
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
      params = [acqComPrimeiroNome(it) || 'pessoal', nome, fato.texto];
    } else {
      params = [acqComPrimeiroNome(it) || 'pessoal'];
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
  // A volta é texto livre, não modelo pago: "enviada" fica fora da contagem de modelos (comercial_%_aceito) e pode repetir em outro dia.
  var ehContinuar = envio.tipo === 'continuar';
  if (ehContinuar && est === 'aceita') nomeEst = 'enviada';
  var chave = 'ACQ-06|' + envio.tipo + '|' + envio.lead_id + '|' + (!ehContinuar && (est === 'aceita' || est === 'incerta') ? nomeEst : ctx.hoje + '|' + nomeEst);
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
