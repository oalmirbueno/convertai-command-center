// ACQ n8n — adaptador do MCP Aceleriq (JS puro; depende de nucleo.js).
// Decide, antes de qualquer rede, se uma chamada pode ir ao MCP, se vira simulação (dry-run)
// ou se é recusada. Depois interpreta a resposta: HTTP 200 com `error` JSON-RPC ou com
// result.isError é FALHA, nunca sucesso.

function acqConfigEfetiva(nomeAmbiente, ambientesJson) {
  var amb = ambientesJson && ambientesJson.ambientes && ambientesJson.ambientes[nomeAmbiente];
  if (!amb) throw new Error('ambiente desconhecido: ' + nomeAmbiente);
  var cfg = JSON.parse(JSON.stringify(amb));
  cfg.nome = nomeAmbiente;
  // Dry-run é o padrão. Só um "false" explícito o desliga, e o piloto nunca desliga.
  cfg.dry_run = !(amb.dry_run === false) || amb.forcar_dry_run === true || nomeAmbiente === 'pilot';
  if (nomeAmbiente === 'pilot') cfg.escritas_liberadas = [];
  cfg.escritas_liberadas = Array.isArray(cfg.escritas_liberadas) ? cfg.escritas_liberadas : [];
  return cfg;
}

// Dry-run por fluxo (comercial ACQ-06/07): dry_run_por_workflow[wf] diferente de false força
// simulação mesmo num ambiente com escrita liberada. O dry-run do ambiente vale para todos.
function acqDryRun(cfg, workflowId) {
  if (cfg.dry_run) return true;
  var m = cfg.dry_run_por_workflow;
  return !!(m && Object.prototype.hasOwnProperty.call(m, workflowId) && m[workflowId] !== false);
}

function acqEhLoopback(url) {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i.test(String(url || ''));
}

function acqClassificarFerramenta(ferramenta, args, contrato) {
  args = args || {};
  if (contrato.nunca_automatico && contrato.nunca_automatico[ferramenta]) return 'proibida';
  if (contrato.leitura.indexOf(ferramenta) >= 0) return 'leitura';
  if (contrato.escrita.indexOf(ferramenta) >= 0) return 'escrita';
  if ((contrato.geracao || []).indexOf(ferramenta) >= 0) return 'geracao';
  var cond = contrato.condicionais && contrato.condicionais[ferramenta];
  if (cond) {
    if (cond.leitura_quando) {
      var ok = Object.keys(cond.leitura_quando).every(function (k) { return cond.leitura_quando[k].indexOf(args[k]) >= 0; });
      return ok ? 'leitura' : 'escrita';
    }
    if (cond.leitura_quando_sem) {
      var semCampos = cond.leitura_quando_sem.every(function (k) { return args[k] === undefined || args[k] === null || args[k] === ''; });
      return semCampos ? 'leitura' : 'escrita';
    }
  }
  return 'desconhecida';
}

// pedido: { workflow_id, run_id, ferramenta, argumentos, paginar?, ambiente_chamador, ref? }
function acqProtegerChamada(pedido, cfg, contrato) {
  var r = {
    ref: pedido.ref || null,
    workflow_id: pedido.workflow_id,
    run_id: pedido.run_id,
    ferramenta: pedido.ferramenta,
    argumentos: pedido.argumentos || {},
    paginar: pedido.paginar === true,
    ambiente: cfg.nome,
    mcp_url: cfg.mcp_url,
    decisao: 'bloquear',
    motivo: null,
    tipo: null,
    rpc: null,
    max_paginas: cfg.max_paginas || 20,
  };
  var bloquear = function (motivo) { r.decisao = 'bloquear'; r.motivo = motivo; return r; };

  if (pedido.ferramenta === 'nenhuma') return bloquear('nada_a_fazer');
  if (!pedido.workflow_id || !contrato.por_workflow[pedido.workflow_id]) return bloquear('workflow_sem_allowlist');
  if (pedido.ambiente_chamador && pedido.ambiente_chamador !== cfg.nome) return bloquear('ambiente_divergente');
  if (contrato.por_workflow[pedido.workflow_id].indexOf(pedido.ferramenta) < 0) return bloquear('ferramenta_fora_da_allowlist');
  r.tipo = acqClassificarFerramenta(pedido.ferramenta, r.argumentos, contrato);
  if (r.tipo === 'proibida' || r.tipo === 'desconhecida') return bloquear('ferramenta_' + r.tipo);
  if (cfg.exige_loopback && !acqEhLoopback(cfg.mcp_url)) return bloquear('teste_fora_do_loopback');

  // Escopo de cliente: no piloto só a Mirante. Ferramentas multi-cliente sem client_id têm o
  // resultado filtrado depois (acqFiltrarEscopo); com client_id, o id precisa estar na lista.
  // client_id_escopo: para ferramentas que recebem outro id (ex.: get_report), o chamador declara
  // o cliente esperado; ele não vai ao MCP e o resultado é conferido depois (acqConferirCliente).
  var cid = r.argumentos.client_id !== undefined ? r.argumentos.client_id : pedido.client_id_escopo;
  r.client_id_escopo = cid === undefined ? null : cid;
  if (Array.isArray(cfg.clientes_permitidos)) {
    if (cid !== undefined && cid !== null && cfg.clientes_permitidos.indexOf(cid) < 0) return bloquear('cliente_fora_do_escopo');
    if ((cid === undefined || cid === null) && contrato.multi_cliente.indexOf(pedido.ferramenta) < 0) {
      return bloquear('chamada_sem_cliente_fora_do_escopo');
    }
  }
  if (cid !== undefined && cid !== null && !acqUuidValido(cid)) return bloquear('client_id_invalido');

  if (r.tipo === 'escrita') {
    var idem = r.argumentos.idempotency_key || r.argumentos.run_key;
    // idempotencia_propria: ferramentas de esquema estrito que deduplicam sozinhas (ex.: id_externo).
    var exigeIdem = ['aceleriq_upsert_project_memory', 'aceleriq_agent_handoff', 'aceleriq_browser_act'].indexOf(pedido.ferramenta) < 0 &&
      (contrato.idempotencia_propria || []).indexOf(pedido.ferramenta) < 0;
    if (exigeIdem && (!idem || String(idem).length < 8)) return bloquear('escrita_sem_idempotency_key');
    var liberada = cfg.escritas_liberadas.indexOf(pedido.ferramenta) >= 0;
    var dry = acqDryRun(cfg, pedido.workflow_id);
    if (dry || !liberada) {
      r.decisao = 'simular';
      r.motivo = dry ? 'dry_run' : 'escrita_nao_liberada_no_ambiente';
      return r;
    }
    r.decisao = 'escrever';
  } else if (r.tipo === 'geracao') {
    // Não grava no painel, então não é simulada no dry-run; mas gasta modelo pago: vai pela via de
    // escrita (uma tentativa só, tempo longo) para nunca pagar duas vezes a mesma chamada.
    r.decisao = 'escrever';
  } else {
    r.decisao = 'ler';
  }
  if (r.paginar) {
    r.argumentos = Object.assign({}, r.argumentos);
    if (r.argumentos.offset === undefined) r.argumentos.offset = 0;
  }
  r.rpc = acqMontarRpc(pedido.ferramenta, r.argumentos, pedido.run_id);
  return r;
}

function acqMontarRpc(ferramenta, argumentos, semente) {
  return {
    jsonrpc: '2.0',
    id: 'acq-' + acqSha256(String(semente) + '|' + ferramenta + '|' + acqEstavel(argumentos)).slice(0, 16),
    method: 'tools/call',
    params: { name: ferramenta, arguments: argumentos },
  };
}

function acqSimularEscrita(req) {
  return {
    ok: true,
    simulado: true,
    dry_run: true,
    ferramenta: req.ferramenta,
    motivo: req.motivo,
    argumentos_hash: acqHashDe(req.argumentos),
    id_simulado: acqUuidDe('simulado|' + req.ferramenta + '|' + acqEstavel(req.argumentos)),
    resultado: null,
    erro: null,
  };
}

function acqClassificarMensagem(msg) {
  var m = String(msg || '');
  if (/version_conflict|CENTRAL_REPORT_VERSION_CONFLICT|versao_mudou/i.test(m)) return 'conflito_versao';
  if (/CENTRAL_SOURCE_STALE/.test(m)) return 'fonte_vencida';
  if (/CENTRAL_APPROVAL_EXPIRED/.test(m)) return 'aprovacao_vencida';
  if (/CENTRAL_ALREADY_SENT|ja_enviado/i.test(m)) return 'ja_enviado';
  if (/write:conflict|CENTRAL_IDEMPOTENCY_CONFLICT/i.test(m)) return 'conflito';
  if (/write:not_found/i.test(m)) return 'nao_encontrado';
  if (/write:forbidden|forbidden|scope/i.test(m)) return 'escopo';
  if (/write:validation|Invalid input|must be|required/i.test(m)) return 'validacao';
  if (/sessao_ocupada/i.test(m)) return 'ocupado';
  if (/timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|temporar/i.test(m)) return 'transitorio';
  return 'desconhecido';
}

// httpJson: item.json produzido pelo nó HTTP (com fullResponse) ou o erro do nó (onError continue).
function acqInterpretarResposta(req, httpJson) {
  var base = { ok: false, simulado: false, ferramenta: req.ferramenta, ref: req.ref || null, resultado: null, erro: null };
  var erro = function (tipo, mensagem, extra) {
    base.erro = Object.assign({ tipo: tipo, mensagem: String(mensagem || '').slice(0, 500), pode_repetir: tipo === 'transitorio' && req.tipo === 'leitura' }, extra || {});
    return base;
  };
  if (!httpJson) return erro('payload_invalido', 'sem resposta');
  // Erro do próprio nó HTTP (rede, timeout, 4xx/5xx sem neverError).
  if (httpJson.error && !httpJson.jsonrpc && !httpJson.body) {
    var e = httpJson.error;
    var status = Number((e && (e.httpCode || e.status || e.statusCode)) || httpJson.statusCode || 0);
    var msg = (e && (e.message || e.description)) || JSON.stringify(e);
    if (status === 401) return erro('autenticacao', msg, { http_status: status });
    if (status === 403) return erro('escopo', msg, { http_status: status });
    if (status === 429 || status >= 500) return erro('transitorio', msg, { http_status: status });
    if (status >= 400) return erro('validacao', msg, { http_status: status });
    return erro(acqClassificarMensagem(msg) === 'desconhecido' ? 'transitorio' : acqClassificarMensagem(msg), msg);
  }
  var statusCode = Number(httpJson.statusCode || 200);
  var corpo = httpJson.body !== undefined ? httpJson.body : httpJson;
  if (typeof corpo === 'string') {
    try { corpo = JSON.parse(corpo.trim()); } catch (x) { return erro('payload_invalido', 'corpo não é JSON', { http_status: statusCode }); }
  }
  if (statusCode === 401) return erro('autenticacao', 'HTTP 401', { http_status: statusCode });
  if (statusCode === 403) return erro('escopo', 'HTTP 403', { http_status: statusCode });
  if (statusCode === 429 || statusCode >= 500) return erro('transitorio', 'HTTP ' + statusCode, { http_status: statusCode });
  if (!corpo || corpo.jsonrpc !== '2.0') return erro('payload_invalido', 'resposta não é JSON-RPC 2.0', { http_status: statusCode });
  if (corpo.error) {
    var c = Number(corpo.error.code);
    var tipo = c === -32001 ? 'autenticacao' : c === -32003 ? 'escopo' : c === -32004 ? 'ferramenta_inexistente'
      : c === -32602 ? 'validacao' : acqClassificarMensagem(corpo.error.message);
    return erro(tipo, corpo.error.message, { codigo: c });
  }
  var res = corpo.result;
  if (!res) return erro('payload_invalido', 'JSON-RPC sem result');
  if (res.isError) {
    var t = (res.content && res.content[0] && res.content[0].text) || 'isError';
    return erro(acqClassificarMensagem(t) === 'desconhecido' ? 'ferramenta' : acqClassificarMensagem(t), t);
  }
  var dados = res.structuredContent;
  if (dados === undefined && res.content && res.content[0] && typeof res.content[0].text === 'string') {
    try { dados = JSON.parse(res.content[0].text); } catch (x2) { return erro('payload_invalido', 'content[0].text não é JSON'); }
  }
  if (dados === undefined || dados === null || typeof dados !== 'object') return erro('payload_invalido', 'resultado vazio');
  // Algumas escritas devolvem {ok:false,status:'versao_mudou'|'ja_decidido'} em vez de erro.
  if (dados.ok === false && dados.status) return erro(acqClassificarMensagem(dados.status) === 'desconhecido' ? 'recusado' : acqClassificarMensagem(dados.status), dados.status, { resultado: dados });
  base.ok = true;
  base.resultado = dados;
  return base;
}

// Paginação offset/limit do MCP: {items,total,limit,offset,has_more,next_offset}.
function acqPlanejarPaginas(req, primeira, maxPaginas) {
  var r = primeira && primeira.resultado;
  if (!primeira || !primeira.ok || !r || r.has_more !== true) return [];
  var limit = Number(r.limit) || 25;
  var total = Number(r.total);
  var inicio = Number(r.next_offset);
  if (!isFinite(total) || !isFinite(inicio)) return [];
  var pedidos = [];
  for (var off = inicio; off < total && pedidos.length < (maxPaginas - 1); off += limit) {
    var args = Object.assign({}, req.argumentos, { offset: off, limit: limit });
    pedidos.push({ offset: off, rpc: acqMontarRpc(req.ferramenta, args, req.run_id + '|p' + off) });
  }
  return pedidos;
}

function acqJuntarPaginas(primeira, demais) {
  var r = primeira.resultado;
  var vistos = {};
  var itens = [];
  var falhas = [];
  var juntar = function (lista) {
    (lista || []).forEach(function (it) {
      var id = it && (it.id || (it.task && it.task.id) || (it.post && it.post.id));
      var chave = id ? String(id) : acqHashDe(it);
      if (!vistos[chave]) { vistos[chave] = true; itens.push(it); }
    });
  };
  juntar(r.items);
  (demais || []).forEach(function (p) {
    if (p.ok) juntar(p.resultado.items); else falhas.push(p.erro);
  });
  var total = Number(r.total);
  var completo = falhas.length === 0 && (!isFinite(total) || itens.length >= total);
  var out = Object.assign({}, r, { items: itens, has_more: false, next_offset: null, paginas_lidas: 1 + (demais || []).length });
  return { ok: completo, resultado: out, erro: completo ? null : { tipo: 'paginacao_incompleta', mensagem: 'lidos ' + itens.length + ' de ' + total, falhas: falhas, pode_repetir: true } };
}

// Filtra respostas multi-cliente para o escopo do ambiente.
function acqFiltrarEscopo(lista, cfg, campo) {
  if (!Array.isArray(cfg.clientes_permitidos)) return lista || [];
  campo = campo || 'client_id';
  return (lista || []).filter(function (x) { return x && cfg.clientes_permitidos.indexOf(x[campo]) >= 0; });
}

// Confere que um resultado lido pertence ao cliente esperado (dado de outro cliente é recusado).
function acqConferirCliente(resultado, clientIdEsperado) {
  if (!clientIdEsperado || !resultado) return true;
  var achados = [];
  (function varrer(v, prof) {
    if (!v || typeof v !== 'object' || prof > 3) return;
    if (typeof v.client_id === 'string') achados.push(v.client_id);
    Object.keys(v).forEach(function (k) { if (k !== 'distribuicao' && k !== 'sem_dia_por_nao_se_aplicar') varrer(v[k], prof + 1); });
  })(resultado, 0);
  return achados.every(function (c) { return c === clientIdEsperado; });
}
