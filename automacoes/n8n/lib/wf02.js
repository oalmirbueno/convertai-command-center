// ACQ-02 — Despacho aprovado e recibo (JS puro; depende de nucleo.js).
// Todo aviso externo passa por aqui. Concorrência é resolvida no Postgres (saida_reivindicar);
// este arquivo só decide o que é enfileirado, revalida antes de enviar e classifica o resultado.

function acq02ChaveSaida(cfgNome, approvalId, payloadHash) {
  return cfgNome + ':central:' + approvalId + ':' + payloadHash;
}

// Fila do painel → saídas congeladas. Só aprovados_para_enviar, só clientes do escopo.
function acq02Enfileirar(fila, cfg) {
  var itens = (fila && fila.aprovados_para_enviar) || [];
  var out = [], fora = [];
  itens.forEach(function (it) {
    if (Array.isArray(cfg.clientes_permitidos) && cfg.clientes_permitidos.indexOf(it.client_id) < 0) {
      fora.push({ approval_id: it.approval_id, motivo: 'fora_do_escopo_do_ambiente' }); return;
    }
    var payload = {
      approval_id: it.approval_id, report_id: it.report_id || null, titulo: it.titulo || null,
      mensagem: it.mensagem || '', proximo_passo: it.proximo_passo || null, ritual: it.ritual || null,
      payload_version: it.payload_version, payload_hash_painel: it.payload_hash || null,
    };
    if (!payload.mensagem) { fora.push({ approval_id: it.approval_id, motivo: 'mensagem_vazia' }); return; }
    var hashPainel = /^[0-9a-f]{64}$/.test(String(it.payload_hash || '')) ? it.payload_hash : acqHashDe(payload);
    out.push({
      idempotency_key: acq02ChaveSaida(cfg.nome, it.approval_id, hashPainel),
      origem: 'central_review', ambiente: cfg.nome, approval_id: it.approval_id, report_id: it.report_id || null,
      client_id: it.client_id, payload_version: it.payload_version, payload_hash: hashPainel, payload: payload,
      destino_rotulo: String(it.destino || ''), valid_until: it.valid_until || null,
    });
  });
  return { saidas: out, ignorados: fora };
}

// Revalidação no momento do envio, depois do claim: aprovação ainda aprovada e com o mesmo
// payload, dentro da validade, destino técnico aprovado por igualdade exata.
function acq02Revalidar(saida, filaAtual, destinos, cfg, agoraMs) {
  var r = { saida_id: saida.id, decisao: 'bloquear', motivo: null, destino: null };
  var aprovados = (filaAtual && filaAtual.aprovados_para_enviar) || [];
  var atual = aprovados.filter(function (a) { return a.approval_id === saida.approval_id; })[0];
  if (!atual) { r.decisao = 'invalidar'; r.motivo = 'aprovacao_nao_esta_mais_aprovada_para_envio'; return r; }
  if (String(atual.payload_version) !== String(saida.payload_version)) { r.decisao = 'invalidar'; r.motivo = 'versao_do_payload_mudou'; return r; }
  var hashAtual = /^[0-9a-f]{64}$/.test(String(atual.payload_hash || '')) ? atual.payload_hash : null;
  if (hashAtual && hashAtual !== saida.payload_hash) { r.decisao = 'invalidar'; r.motivo = 'payload_mudou_depois_da_aprovacao'; return r; }
  if (String(atual.mensagem || '') !== String((saida.payload || {}).mensagem || '')) { r.decisao = 'invalidar'; r.motivo = 'texto_mudou_depois_da_aprovacao'; return r; }
  var validade = saida.valid_until || atual.valid_until;
  if (!validade || Date.parse(validade) <= agoraMs) { r.motivo = 'aprovacao_vencida'; return r; }
  if (Array.isArray(cfg.clientes_permitidos) && cfg.clientes_permitidos.indexOf(saida.client_id) < 0) { r.motivo = 'cliente_fora_do_escopo'; return r; }
  if (saida.destino_rotulo === saida.client_id) { r.motivo = 'canal_portal_publica_no_painel_nao_por_transporte'; return r; }
  var candidatos = (destinos || []).filter(function (d) { return d.ativo !== false && d.client_id === saida.client_id && d.rotulo === saida.destino_rotulo; });
  if (candidatos.length !== 1) { r.motivo = candidatos.length ? 'destino_ambiguo' : 'destino_desconhecido'; return r; }
  r.destino = candidatos[0];
  if (cfg.transporte === 'teste' && r.destino.canal !== 'teste') { r.motivo = 'destino_real_em_ambiente_de_teste'; r.destino = null; return r; }
  if (cfg.transporte !== 'teste' && r.destino.canal === 'teste') { r.motivo = 'destino_de_teste_fora_do_teste'; r.destino = null; return r; }
  if (cfg.dry_run || cfg.transporte === 'nenhum') { r.decisao = 'simular'; r.motivo = cfg.dry_run ? 'dry_run' : 'sem_transporte'; return r; }
  if (cfg.transporte !== 'teste') { r.motivo = 'transporte_oficial_nao_homologado'; return r; }
  r.decisao = 'enviar';
  return r;
}

function acq02MensagemTransporte(saida, destino) {
  var p = saida.payload || {};
  var texto = p.mensagem + (p.proximo_passo ? '\n\n' + p.proximo_passo : '');
  return { para: destino.destino_tecnico, canal: destino.canal, texto: texto, chave_cliente: saida.id, payload_hash: saida.payload_hash };
}

// Resultado do transporte. Incerto = não sabemos se saiu: nunca reenvia sozinho.
function acq02ClassificarTransporte(httpJson) {
  if (!httpJson) return { resultado: 'incerta', motivo: 'sem_resposta' };
  if (httpJson.error && !httpJson.body) {
    var e = httpJson.error, st = Number(e.httpCode || e.status || 0);
    var msg = String(e.message || e.description || '');
    if (st >= 400 && st < 500 && st !== 408) return { resultado: 'rejeitada', motivo: 'http_' + st + ': ' + msg.slice(0, 200), auth: st === 401 || st === 403 };
    return { resultado: 'incerta', motivo: (st ? 'http_' + st + ': ' : '') + msg.slice(0, 200) };
  }
  var st2 = Number(httpJson.statusCode || 200);
  var b = httpJson.body !== undefined ? httpJson.body : httpJson;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (x) { b = {}; } }
  if (st2 >= 500 || st2 === 408) return { resultado: 'incerta', motivo: 'http_' + st2 };
  if (st2 >= 400) return { resultado: 'rejeitada', motivo: 'http_' + st2 + (b && b.erro ? ': ' + b.erro : ''), auth: st2 === 401 || st2 === 403 };
  var id = b && (b.message_id || b.provider_message_id || (b.messages && b.messages[0] && b.messages[0].id));
  if (b && b.aceita === false) return { resultado: 'rejeitada', motivo: b.erro || 'recusada_pelo_provedor' };
  if (!id) return { resultado: 'incerta', motivo: 'resposta_2xx_sem_id_do_provedor' };
  return { resultado: 'aceita', provider_message_id: String(id) };
}

function acq02Evidencia(saida, destinoRotulo) {
  return 'ACQ-02: enviado via ' + (saida.provedor || '?') + ' para "' + destinoRotulo + '"; provider_message_id=' +
    saida.provider_message_id + '; aceito_em=' + saida.aceita_em + '; saida=' + saida.id + '; payload_hash=' + saida.payload_hash;
}

// Recibos (webhook do provedor, autenticado por header no nó Webhook). Aqui só forma e janela de tempo.
function acq02NormalizarRecibos(corpo, agoraMs, provedor) {
  var lista = Array.isArray(corpo && corpo.recibos) ? corpo.recibos : (corpo ? [corpo] : []);
  var validos = [], invalidos = [];
  lista.forEach(function (r) {
    var st = String(r.status || '').toLowerCase();
    var mapa = { sent: 'aceita', accepted: 'aceita', delivered: 'entregue', read: 'lida', failed: 'falhou', aceita: 'aceita', entregue: 'entregue', lida: 'lida', falhou: 'falhou' };
    var t = Date.parse(r.ocorrido_em || r.timestamp || '');
    if (!r.provider_message_id && !r.id) { invalidos.push({ motivo: 'sem_id', r: r }); return; }
    if (!mapa[st]) { invalidos.push({ motivo: 'status_desconhecido', r: r }); return; }
    if (!isFinite(t) || Math.abs(agoraMs - t) > 7 * 86400000) { invalidos.push({ motivo: 'fora_da_janela', r: r }); return; }
    validos.push({ provedor: provedor, provider_message_id: String(r.provider_message_id || r.id), status: mapa[st], ocorrido_em: new Date(t).toISOString(), bruto: r });
  });
  return { validos: validos, invalidos: invalidos };
}
