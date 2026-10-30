// ACQ-01 — Contexto e rituais (JS puro; depende de nucleo.js e adaptador.js).
// Separa o que o painel mostra (fato), o que uma pessoa já respondeu (resposta humana com
// autor/data/objeto), o que a automação deduziu (interpretação), o que falta (lacuna) e o que
// só um humano decide (decisão). Nada aqui vira "confirmado pelo dono".

var ACQ01_RITUAIS = {
  1: { tipo: 'rota_semana', chave_ciclo: 'segunda', nome: 'Rota da semana' },
  3: { tipo: 'meio_semana', chave_ciclo: 'quarta', nome: 'Meio da semana' },
  5: { tipo: 'prova_movimento', chave_ciclo: 'sexta', nome: 'Prova de movimento' },
};

function acq01RitualDaRodada(agoraMs, ritualPedido) {
  var sp = acqAgoraSP(agoraMs);
  var semana = acqSegundaDaSemana(sp.data);
  if (ritualPedido) {
    var achado = null;
    Object.keys(ACQ01_RITUAIS).forEach(function (d) { if (ACQ01_RITUAIS[d].tipo === ritualPedido) achado = ACQ01_RITUAIS[d]; });
    if (!achado) return { erro: 'ritual_desconhecido: ' + ritualPedido };
    return Object.assign({ semana: semana, data: sp.data, manual: true }, achado);
  }
  var r = ACQ01_RITUAIS[sp.dia_semana];
  if (!r) return { erro: 'sem_ritual_neste_dia', data: sp.data };
  return Object.assign({ semana: semana, data: sp.data, manual: false }, r);
}

// Elegibilidade pela fonte canônica (Dia Prioritário): cliente recorrente é quem tem dia
// confirmado ou provisório. nao_aplicavel (ex.: Para Si) não entra; provisório entra marcado.
function acq01Elegiveis(dia, cfg, clientePedido) {
  var dist = (dia && dia.distribuicao) || [];
  var todos = [];
  dist.forEach(function (d) { (d.clientes || []).forEach(function (c) { todos.push({ client_id: c.client_id, nome: c.nome, situacao: c.situacao }); }); });
  var fora = ((dia && dia.sem_dia_por_nao_se_aplicar) || []).map(function (c) { return { client_id: c.client_id, nome: c.nome, motivo: 'nao_aplicavel' }; });
  var lista = todos.filter(function (c) { return c.situacao === 'confirmado' || c.situacao === 'provisorio'; });
  if (clientePedido) {
    var alvo = lista.filter(function (c) { return c.client_id === clientePedido; });
    if (!alvo.length) {
      var foraAlvo = fora.filter(function (c) { return c.client_id === clientePedido; });
      return { elegiveis: [], recusados: [{ client_id: clientePedido, motivo: foraAlvo.length ? 'nao_aplicavel' : 'sem_recorrencia_cadastrada' }] };
    }
    lista = alvo;
  }
  var recusados = fora.slice();
  if (Array.isArray(cfg.clientes_permitidos)) {
    lista = lista.filter(function (c) {
      var ok = cfg.clientes_permitidos.indexOf(c.client_id) >= 0;
      if (!ok) recusados.push({ client_id: c.client_id, nome: c.nome, motivo: 'fora_do_escopo_do_ambiente' });
      return ok;
    });
  }
  var lote = lista.slice(0, cfg.lote_clientes || 2);
  lista.slice(cfg.lote_clientes || 2).forEach(function (c) { recusados.push({ client_id: c.client_id, nome: c.nome, motivo: 'proximo_lote' }); });
  return { elegiveis: lote.map(function (c) { return Object.assign({ provisorio: c.situacao === 'provisorio' }, c); }), recusados: recusados };
}

function acq01PedidosDeLeitura(c, ritual, operador) {
  var cid = c.client_id;
  return [
    { ref: cid + '|dossie', ferramenta: 'aceleriq_get_current_dossier', argumentos: { client_id: cid, dossier_type: 'contexto' } },
    { ref: cid + '|decisoes', ferramenta: 'aceleriq_get_project_memory', argumentos: { client_id: cid, kind: 'decisao', limit: 50 } },
    { ref: cid + '|rituais', ferramenta: 'aceleriq_get_project_memory', argumentos: { client_id: cid, kind: 'ritual', limit: 10 } },
    { ref: cid + '|agenda', ferramenta: 'aceleriq_get_agenda_status', argumentos: { client_id: cid, days: 14 } },
    { ref: cid + '|relatorios', ferramenta: 'aceleriq_list_reports', argumentos: { client_id: cid, limit: 20 } },
    { ref: cid + '|dia', ferramenta: 'aceleriq_dia_prioritario', argumentos: { client_id: cid } },
    { ref: cid + '|fila', ferramenta: 'aceleriq_central_review_fila', argumentos: { operator: operador }, client_id_escopo: undefined },
  ];
}

// Relatórios da semana (e rascunhos dos últimos 30 dias) precisam do detalhe para saber o ritual.
function acq01PedidosDeDetalhe(c, relatorios, ritual) {
  var limite = acqSomarDias(ritual.semana, -21);
  return ((relatorios && relatorios.items) || [])
    .filter(function (r) { return String(r.created_at || '').slice(0, 10) >= limite; })
    .slice(0, 12)
    .map(function (r) { return { ref: c.client_id + '|relatorio|' + r.id, ferramenta: 'aceleriq_get_report', argumentos: { report_id: r.id }, client_id_escopo: c.client_id }; });
}

// "Pergunta\nResposta\n\nPergunta\nResposta" (formato gravado pelo agente-central em project_memory).
function acq01RespostasDaMemoria(itens) {
  var out = [];
  (itens || []).forEach(function (m) {
    var porHumano = m.source === 'agente-central' || m.source === 'central' || m.source === 'painel';
    var blocos = String(m.content || '').split(/\n\s*\n/);
    blocos.forEach(function (b) {
      var linhas = b.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
      if (linhas.length < 2 || !/\?\s*$/.test(linhas[0])) return;
      out.push({
        tipo: 'resposta_humana',
        objeto: linhas[0],
        chave: acq01ChavePergunta(linhas[0]),
        resposta: linhas.slice(1).join(' '),
        autor: m.created_by || (m.metadata && m.metadata.aprovado_por) || null,
        autor_conhecido: Boolean(m.created_by || (m.metadata && m.metadata.aprovado_por)),
        origem_humana: porHumano,
        em: m.created_at,
        fonte: { ferramenta: 'aceleriq_get_project_memory', id: m.id || null, kind: m.kind },
        ambigua: acq01RespostaAmbigua(linhas[0], linhas.slice(1).join(' ')),
      });
    });
  });
  // A mais recente vence por pergunta (mesma regra de juntarRespostas da continuidade).
  out.sort(function (a, b) { return String(b.em).localeCompare(String(a.em)); });
  var vistos = {};
  return out.filter(function (r) { if (vistos[r.chave]) return false; vistos[r.chave] = true; return true; });
}

// Chave da pergunta: normalização da continuidade sem números (a mesma pergunta com "6 pautas"
// ou "pautas" é a mesma pergunta).
function acq01ChavePergunta(t) { return acqChaveTexto(String(t || '').replace(/\d+/g, ' ')); }

var ACQ01_VALIDADE_RESPOSTA_DIAS = 14;

// Resposta curta ("sim", "ok") a pergunta composta ("X e Y?", "X ou Y?") não confirma as duas partes.
function acq01RespostaAmbigua(pergunta, resposta) {
  var curta = acqChaveTexto(resposta).length <= 4 || /^(sim|nao|não|ok|certo|pode|claro)[.!]?$/i.test(String(resposta).trim());
  var composta = /\b(e|ou)\b[^?]*\?$/.test(String(pergunta)) && String(pergunta).split(/\b(?:e|ou)\b/).length > 1;
  return Boolean(curta && composta);
}

// Decisões registradas (regras do dono etc.): sem autor identificado ficam como registro, não como aprovação.
function acq01Decisoes(itens) {
  return (itens || []).filter(function (m) { return !/^Respostas ao agente/i.test(String(m.title || '')); }).map(function (m) {
    return { tipo: 'decisao_registrada', titulo: m.title, em: m.created_at, autor: m.created_by || null, fonte: { ferramenta: 'aceleriq_get_project_memory', id: m.id || null } };
  });
}

// A semana de um relatório é a do dia em que ele foi criado/enviado (horário de São Paulo).
// period_start NÃO serve: o painel grava ali o início do período de dados (ex.: o meio de semana
// enviado em 14/10 tem period_start 07/10).
function acq01SemanaDoRelatorio(r) {
  var quando = (r.metrics && r.metrics.sent_at) || r.created_at;
  var ms = Date.parse(quando);
  return acqSegundaDaSemana(isNaN(ms) ? String(r.period_start || '').slice(0, 10) : acqAgoraSP(ms).data);
}

function acq01SituacaoDoRitual(ritual, detalhes, fila, clientId) {
  var daSemana = (detalhes || []).filter(function (r) {
    var m = r.metrics || {};
    return m.ritual_type === ritual.tipo && acq01SemanaDoRelatorio(r) === ritual.semana;
  });
  var publicado = daSemana.filter(function (r) { return r.status === 'published'; })[0];
  if (publicado) return { estado: 'ja_publicado', report_id: publicado.id, canal: (publicado.metrics || {}).sent_channel || null };
  var rascunho = daSemana.filter(function (r) { return r.status === 'draft'; })[0];
  var pedidos = ((fila && fila.esperando_decisao) || []).concat((fila && fila.aprovados_para_enviar) || []).filter(function (p) { return p.client_id === clientId; });
  if (rascunho) {
    var pedido = pedidos.filter(function (p) { return p.report_id === rascunho.id; })[0];
    return { estado: pedido ? 'pedido_existente' : 'rascunho_existente', report_id: rascunho.id, approval_id: pedido ? pedido.approval_id : null };
  }
  return { estado: 'propor' };
}

// Rascunhos históricos e pedidos vencidos: só aponta, não apaga nem expira (isso é do painel).
function acq01Reconciliar(detalhes, fila, clientId, agoraMs) {
  var achados = [];
  var publicados = {};
  (detalhes || []).forEach(function (r) {
    var m = r.metrics || {};
    var sem = acq01SemanaDoRelatorio(r);
    if (r.status === 'published' && m.ritual_type) publicados[sem] = (publicados[sem] || []).concat(m.ritual_type);
  });
  (detalhes || []).forEach(function (r) {
    if (r.status !== 'draft') return;
    var sem = acq01SemanaDoRelatorio(r);
    var tipo = (r.metrics || {}).ritual_type || null;
    if (publicados[sem] && (!tipo || publicados[sem].indexOf(tipo) >= 0)) {
      achados.push({ tipo: 'rascunho_historico_coberto', report_id: r.id, titulo: r.title, semana: sem,
        leitura: 'Já existe ritual publicado na mesma semana' + (tipo ? ' (' + tipo + ')' : '') + '; este rascunho não deve gerar novo pedido.' });
    }
  });
  var agoraISO = new Date(agoraMs).toISOString();
  ((fila && fila.esperando_decisao) || []).filter(function (p) { return p.client_id === clientId; }).forEach(function (p) {
    if (p.valid_until && p.valid_until < agoraISO) {
      achados.push({ tipo: 'pedido_vencido_ainda_pendente', approval_id: p.approval_id, report_id: p.report_id, valid_until: p.valid_until,
        leitura: 'O pedido passou da validade e continua pendente; a expiração formal é do painel.' });
    }
  });
  return achados;
}

// Candidatos a lacuna material, calculados por regra. Só viram pergunta se ninguém já respondeu.
function acq01Lacunas(ctx) {
  var l = [];
  var ag = ctx.agenda || {};
  var prontas = (ag.ready_without_date || []).length;
  var agendadas = (ag.scheduled || []).length;
  if (prontas > 0 && agendadas === 0) {
    l.push({ chave: 'agenda_prontas_sem_data', material: true, prioridade: 1,
      pergunta: 'As ' + prontas + ' pautas prontas sem data já foram aprovadas pela cliente para agendamento?',
      por_que: prontas + ' pautas prontas sem data e nenhuma publicação agendada nos próximos ' + (ag.days || 14) + ' dias.' });
  }
  if (prontas === 0 && agendadas === 0) {
    l.push({ chave: 'agenda_vazia_sem_producao', material: true, prioridade: 1,
      pergunta: 'Há conteúdo em produção para cobrir os próximos 14 dias, ou a agenda ficará vazia?',
      por_que: 'Nada agendado e nenhuma pauta pronta.' });
  }
  var dia = ctx.dia || {};
  if ((dia.atrasadas || []).length >= 5) {
    l.push({ chave: 'tarefas_atrasadas_vigentes', material: true, prioridade: 2,
      pergunta: 'As tarefas com prazo vencido desde ' + String((dia.atrasadas[0] || {}).prazo || '') + ' ainda valem ou devem ser repactuadas?',
      por_que: (dia.tarefas_abertas || 0) + ' tarefas abertas; as mais antigas venceram em ' + String((dia.atrasadas[0] || {}).prazo || '?') + '.' });
  }
  if (!ctx.dossie || !ctx.dossie.current) {
    l.push({ chave: 'dossie_inexistente', material: true, prioridade: 0, pergunta: null, por_que: 'Cliente sem dossiê de contexto atual.' });
  }
  return l;
}

// Uma resposta só resolve a lacuna se responder ao mesmo objeto (mesma chave normalizada ou
// tema marcado) e não for ambígua. Similaridade frouxa não basta: na dúvida, continua lacuna.
function acq01JaRespondida(lacuna, respostas, temasRespondidos, agoraMs) {
  if (!lacuna.pergunta) return null;
  var chave = acq01ChavePergunta(lacuna.pergunta);
  var r = respostas.filter(function (x) { return x.chave === chave || (temasRespondidos && temasRespondidos[x.chave] === lacuna.chave); })[0];
  if (!r) return null;
  // Resposta de situação envelhece: depois de 14 dias, a pergunta pode voltar (citando a anterior).
  if (agoraMs && r.em && (agoraMs - Date.parse(r.em)) > ACQ01_VALIDADE_RESPOSTA_DIAS * 86400000) return { resolvida: false, resposta: r, motivo: 'resposta_antiga' };
  return r.ambigua ? { resolvida: false, resposta: r, motivo: 'resposta_ambigua' } : { resolvida: true, resposta: r };
}

function acq01Analisar(entrada) {
  // entrada: { cliente, ritual, leituras: {dossie, decisoes, rituais, agenda, relatorios, dia, fila}, detalhes[], falhas[], agoraMs, cfg, run_id, temas_respondidos? }
  var c = entrada.cliente, rit = entrada.ritual, L = entrada.leituras || {}, agoraMs = entrada.agoraMs;
  var cid = c.client_id;
  var falhas = entrada.falhas || [];
  var obrigatorias = ['dossie', 'agenda', 'relatorios', 'decisoes'];
  var ausentes = obrigatorias.filter(function (k) { return !L[k]; });
  var projeto = ((L.relatorios && L.relatorios.items) || []).map(function (r) { return r.project_id; }).filter(Boolean)[0]
    || (L.dossie && L.dossie.current && L.dossie.current.project_id) || null;
  var base = { client_id: cid, nome: c.nome, project_id: projeto, ritual: rit, provisorio: Boolean(c.provisorio), falhas: falhas };
  if (ausentes.length) {
    return Object.assign(base, { estado: 'fonte_ausente', lacunas: ausentes.map(function (k) { return { chave: 'fonte_' + k, material: true, pergunta: null, por_que: 'Fonte ' + k + ' indisponível nesta rodada; nada foi proposto.' }; }) });
  }
  var dossie = L.dossie;
  var versao = Number(dossie.current_version || 0);
  var prepDia = ((L.dia && L.dia.preparacao) || []).filter(function (p) { return p.client_id === cid; })[0] || null;
  var fila = L.fila || {};

  var situacao = acq01SituacaoDoRitual(rit, entrada.detalhes, fila, cid);
  var reconciliacao = acq01Reconciliar(entrada.detalhes, fila, cid, agoraMs);
  var respostas = acq01RespostasDaMemoria((L.decisoes && L.decisoes.items) || []);
  var decisoes = acq01Decisoes((L.decisoes && L.decisoes.items) || []);
  var ag = L.agenda;

  var fatos = [];
  var ref = function (ferramenta, extra) { return Object.assign({ ferramenta: ferramenta, lido_em: new Date(agoraMs).toISOString() }, extra || {}); };
  fatos.push({ tipo: 'fato', texto: (ag.scheduled || []).length + ' publicação(ões) agendada(s) nos próximos ' + (ag.days || 14) + ' dias.', fonte: ref('aceleriq_get_agenda_status') });
  fatos.push({ tipo: 'fato', texto: (ag.ready_without_date || []).length + ' pauta(s) pronta(s) sem data: ' + (ag.ready_without_date || []).map(function (p) { return '“' + p.title + '”'; }).slice(0, 6).join('; ') + '.', fonte: ref('aceleriq_get_agenda_status') });
  (ag.published_last_7_days || []).forEach(function (p) {
    fatos.push({ tipo: 'fato', texto: 'Publicado em ' + String(p.published_at).slice(0, 10) + ' (' + p.platform + '): ' + (p.title || p.post_id) + ' — ' + (p.permalink || 'sem link'), fonte: ref('aceleriq_get_agenda_status', { publication_id: p.publication_id }) });
  });
  if (prepDia) {
    fatos.push({ tipo: 'fato', texto: prepDia.tarefas_abertas + ' tarefa(s) aberta(s); ' + (prepDia.atrasadas || []).length + '+ com prazo vencido (amostra do painel, limite 8).', fonte: ref('aceleriq_dia_prioritario') });
    if (prepDia.ultimo_ritual) fatos.push({ tipo: 'fato', texto: 'Último ritual registrado: “' + prepDia.ultimo_ritual.titulo + '” em ' + String(prepDia.ultimo_ritual.quando).slice(0, 10) + '.', fonte: ref('aceleriq_dia_prioritario') });
    if ((prepDia.ultimos_registros || []).length === 0) fatos.push({ tipo: 'fato', texto: 'Nenhum registro de Dia Prioritário no painel (não prova ausência de contato fora dele).', fonte: ref('aceleriq_dia_prioritario') });
  }
  fatos.push({ tipo: 'fato', texto: 'Dossiê de contexto na versão ' + versao + (dossie.current && dossie.current.updated_at ? ', atualizado em ' + String(dossie.current.updated_at).slice(0, 16).replace('T', ' ') + ' UTC' : '') + '.', fonte: ref('aceleriq_get_current_dossier', { version: versao }) });

  var interpretacoes = [];
  if ((ag.ready_without_date || []).length > 0 && (ag.scheduled || []).length === 0) {
    interpretacoes.push({ tipo: 'interpretacao_automatica', texto: 'Gargalo entre produção e agenda: há conteúdo pronto, mas nada agendado. “Pronto” não significa aprovado.', base: ['aceleriq_get_agenda_status'] });
  }
  if (prepDia && (prepDia.atrasadas || []).length >= 5) {
    interpretacoes.push({ tipo: 'interpretacao_automatica', texto: 'O quadro de tarefas acumula prazos vencidos; a lista precisa de repactuação antes de virar cobrança.', base: ['aceleriq_dia_prioritario'] });
  }
  reconciliacao.forEach(function (r) { interpretacoes.push({ tipo: 'interpretacao_automatica', texto: r.leitura, base: ['aceleriq_list_reports', 'aceleriq_central_review_fila'] }); });

  var lacunas = [];
  var respondidas = [];
  acq01Lacunas({ agenda: ag, dia: prepDia, dossie: dossie }).forEach(function (lac) {
    var j = acq01JaRespondida(lac, respostas, entrada.temas_respondidos, agoraMs);
    if (j && j.resolvida) respondidas.push({ lacuna: lac.chave, resposta: j.resposta });
    else lacunas.push(Object.assign({}, lac, j ? { resposta_ambigua: j.resposta } : {}));
  });
  lacunas.sort(function (a, b) { return a.prioridade - b.prioridade; });
  var perguntas = lacunas.filter(function (x) { return x.material && x.pergunta; }).slice(0, 2).map(function (x) {
    return { chave: x.chave, pergunta: x.pergunta, por_que: x.por_que, id: acqUuidDe(cid + '|' + rit.semana + '|' + x.chave) };
  });

  var resultado = Object.assign(base, {
    estado: situacao.estado,
    situacao: situacao,
    dossie_versao_base: versao,
    fatos: fatos,
    respostas_humanas: respostas.slice(0, 8),
    respondidas: respondidas,
    decisoes_registradas: decisoes.slice(0, 5),
    interpretacoes: interpretacoes,
    lacunas: lacunas,
    perguntas: perguntas,
    reconciliacao: reconciliacao,
  });
  resultado.hash_fatos = acqHashDe({ f: fatos.map(function (f) { return f.texto; }), r: respostas.map(function (r) { return r.chave + r.em; }), l: lacunas.map(function (x) { return x.chave; }) });
  if (situacao.estado === 'propor' || situacao.estado === 'rascunho_existente') {
    resultado.proposta_contexto = acq01PropostaContexto(resultado, dossie, agoraMs);
    if (situacao.estado === 'propor') resultado.rascunho_ritual = acq01RascunhoRitual(resultado, prepDia, ag);
    resultado.pedido_revisao = acq01PedidoRevisao(resultado, entrada.detalhes, entrada.cfg);
  }
  return resultado;
}

function acq01PropostaContexto(a, dossie, agoraMs) {
  var sp = acqAgoraSP(agoraMs);
  var data = sp.data.split('-').reverse().join('/');
  var linhas = ['## Leitura automática (n8n ACQ-01, proposta, NÃO confirmada pelo dono) | ' + data, ''];
  linhas.push('**Fatos observados no painel**');
  a.fatos.forEach(function (f) { linhas.push('- ' + f.texto + ' _(fonte: ' + f.fonte.ferramenta + ')_'); });
  if (a.respondidas.length) {
    linhas.push('', '**Já respondido por pessoa** (não perguntar de novo)');
    a.respondidas.forEach(function (r) { linhas.push('- ' + r.resposta.objeto + ' → “' + r.resposta.resposta + '” (' + String(r.resposta.em).slice(0, 10) + ')'); });
  }
  if (a.interpretacoes.length) {
    linhas.push('', '**Interpretação automática** (pode estar errada)');
    a.interpretacoes.forEach(function (i) { linhas.push('- ' + i.texto); });
  }
  if (a.lacunas.length) {
    linhas.push('', '**Lacunas**');
    a.lacunas.forEach(function (l) { linhas.push('- ' + l.por_que + (l.resposta_ambigua ? ' (há resposta anterior ambígua: “' + l.resposta_ambigua.resposta + '”)' : '')); });
  }
  var secao = linhas.join('\n');
  var atual = (dossie.current && dossie.current.content) || '';
  // Produção (15/10/2026): a leitura automática SUBSTITUI a anterior em vez de empilhar; senão cada rodada
  // (3 por semana por cliente) cresce o dossiê até o limite de 60 mil caracteres.
  var semAnterior = acq01SemLeituraAutomatica(atual);
  var conteudoNovo = semAnterior ? semAnterior + '\n\n' + secao : secao;
  return {
    operacao: 'acrescentar_secao',
    expected_version: a.dossie_versao_base,
    secao: secao,
    tamanho_atual: atual.length,
    tamanho_novo: conteudoNovo.length,
    excede_limite_mcp: conteudoNovo.length > 60000,
    conteudo_hash: acqSha256(conteudoNovo),
    _conteudo_novo: conteudoNovo,
  };
}

// Tira do dossiê a seção "## Leitura automática (n8n ACQ-01 ..." anterior (até o próximo "## " ou o fim).
function acq01SemLeituraAutomatica(texto) {
  var linhas = String(texto || '').split('\n');
  var out = [], pulando = false, achou = false;
  linhas.forEach(function (l) {
    if (/^## Leitura automática \(n8n ACQ-01/.test(l)) { pulando = true; achou = true; return; }
    if (pulando && /^## /.test(l)) pulando = false;
    if (!pulando) out.push(l);
  });
  return achou ? out.join('\n').replace(/\n{3,}/g, '\n\n').trim() : String(texto || '');
}

function acq01RascunhoRitual(a, prepDia, ag) {
  var r = a.ritual;
  var ini = r.semana, fim = acqSomarDias(r.semana, 6);
  var prontas = (ag.ready_without_date || []).length;
  var titulo = r.nome + ' | ' + a.nome + ' | ' + ini.split('-').reverse().join('/') + ' a ' + fim.split('-').reverse().join('/');
  var avancou = (ag.published_last_7_days || []).map(function (p) { return 'Post no ar em ' + String(p.published_at).slice(8, 10) + '/' + String(p.published_at).slice(5, 7) + ': ' + (p.title || 'publicação') + '.'; });
  var onde = [];
  if (prontas) onde.push(prontas + ' conteúdos prontos aguardando data de publicação.');
  if (!(ag.scheduled || []).length) onde.push('Nenhuma publicação agendada para os próximos 14 dias.');
  var proximos = [];
  if (prontas) proximos.push('Confirmar a aprovação das pautas prontas e definir as datas de publicação.');
  a.perguntas.forEach(function (p) { proximos.push('Responder: ' + p.pergunta); });
  if (!proximos.length) proximos.push('Seguir o plano da semana registrado no painel.');
  var summary = ['*O que avançou*:', avancou.length ? avancou.join(' ') : 'Sem publicação nova nos últimos 7 dias.', '', '*Onde estamos*:', onde.join(' ') || 'Agenda coberta.'].join('\n');
  return {
    title: titulo,
    period_start: ini,
    period_end: fim,
    summary: summary,
    next_steps: proximos.join('\n'),
    highlights: avancou.join('\n') || null,
    metrics: {
      ritual_type: r.tipo,
      written_by: 'n8n:ACQ-01',
      gerado_por: 'automacao',
      texto_final_pendente: 'aguardando aceleriq_ritual_redigir',
      proveniencia: { fatos: a.fatos.length, respostas_humanas: a.respondidas.length, interpretacoes: a.interpretacoes.length, lacunas: a.lacunas.length },
      hash_fatos: a.hash_fatos,
    },
  };
}

// Texto final do ritual pelo mesmo escritor da Central (MCP 2.10.0: aceleriq_ritual_redigir).
// Só para ritual com proposta NOVA nesta rodada: repetir a rodada não paga o modelo de novo.
// propostas[i] e registradas[i] andam juntas (acq_n8n.proposta_registrar devolve na mesma ordem).
function acq01PedidoTextoFinal(a, propostas, registradas) {
  if (!a || !a.rascunho_ritual) return null;
  var novo = (propostas || []).some(function (p, i) { return p && p.tipo === 'ritual' && registradas && registradas[i] && registradas[i].novo === true; });
  if (!novo) return null;
  return { ref: a.client_id + '|texto', ferramenta: 'aceleriq_ritual_redigir', argumentos: { client_id: a.client_id, ritual: a.ritual.tipo } };
}

// Troca o texto montado por regra pelo texto do escritor. Sem resposta boa, o rascunho por regra fica
// e o motivo vai para metrics.texto_final_pendente (nunca inventa texto).
function acq01AplicarTextoFinal(rascunho, resposta) {
  if (!rascunho) return null;
  var r = Object.assign({}, rascunho, { metrics: Object.assign({}, rascunho.metrics) });
  var res = resposta && resposta.ok ? resposta.resultado : null;
  if (!res || res.ok !== true || !res.body || !String(res.body).trim()) {
    var motivo = !resposta ? 'sem_resposta' : !resposta.ok ? 'erro: ' + ((resposta.erro && resposta.erro.tipo) || '?') : (res && res.motivo) || 'texto_vazio';
    r.metrics.texto_final_pendente = 'aceleriq_ritual_redigir falhou (' + String(motivo).slice(0, 120) + '); ficou o rascunho por regra';
    return r;
  }
  delete r.metrics.texto_final_pendente;
  r.title = String(res.title || r.title).slice(0, 200);
  r.summary = String(res.body).slice(0, 8000);
  if (res.next_steps && String(res.next_steps).trim()) r.next_steps = String(res.next_steps).slice(0, 4000);
  r.metrics.texto_final = { origem: 'aceleriq_ritual_redigir', confirmado_pelo_dono: false, model: res.model || null,
    custo_usd: typeof res.custo_usd === 'number' ? res.custo_usd : null, dossie_versao: res.dossie_versao || null,
    alertas: (res.alertas || []).slice(0, 6), repeticao: res.repeticao || null };
  return r;
}

function acq01PedidoRevisao(a, detalhes, cfg) {
  // Canal = o do último ritual enviado; portal usa o client_id como destinatário (regra do painel).
  var ultimo = (detalhes || []).filter(function (r) { return r.status === 'published' && r.metrics && r.metrics.sent_channel; })
    .sort(function (x, y) { return String(y.created_at).localeCompare(String(x.created_at)); })[0];
  var canal = ultimo && ultimo.metrics.sent_channel === 'whatsapp_group' ? 'whatsapp' : 'portal';
  return { operator: cfg.operador, channel: canal, recipient: canal === 'portal' ? a.client_id : null,
    observacao: canal === 'whatsapp' ? 'destinatário do grupo precisa vir do mapeamento aprovado (ACQ-02), não do nome.' : null };
}

// Monta as chamadas de escrita (em dry-run viram simulação no ACQ-00).
function acq01PedidosDeEscrita(a, run) {
  var out = [];
  if (!a.proposta_contexto) return out;
  var cid = a.client_id;
  var chave = 'acq01:' + cid + ':' + a.ritual.semana + ':' + a.ritual.tipo + ':' + a.hash_fatos.slice(0, 16);
  if (!a.proposta_contexto.excede_limite_mcp) {
    out.push({ ref: cid + '|escrita|dossie', etapa: 1, client_id_escopo: cid, ferramenta: 'aceleriq_upsert_current_dossier', argumentos: {
      client_id: cid, dossier_type: 'contexto', content: a.proposta_contexto._conteudo_novo,
      change_reason: 'ACQ-01: leitura automática proposta (' + a.ritual.tipo + ' ' + a.ritual.semana + '), sem confirmação do dono',
      source: 'n8n:ACQ-01', expected_version: a.proposta_contexto.expected_version, idempotency_key: chave + ':dossie',
      metadata: { origem: 'automacao', confirmado_pelo_dono: false, run_id: run } } });
  }
  if (a.rascunho_ritual) {
    out.push({ ref: cid + '|escrita|rascunho', etapa: 1, client_id_escopo: cid, ferramenta: 'aceleriq_create_report_draft', argumentos: Object.assign({
      project_id: a.project_id, idempotency_key: chave + ':rascunho' }, a.rascunho_ritual) });
  }
  return out;
}
