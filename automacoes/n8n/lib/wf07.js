// ACQ-07 — Comercial: respostas dos leads no WhatsApp oficial (webhook da Cloud API).
// JS puro; depende de nucleo.js, adaptador.js e comercial.js.
// O Jev (TypeSafe) julga a intenção da mensagem; as regras abaixo decidem o que fazer. O texto livre do
// Mercúrio só sai dentro da janela de 24 h, nunca para quem pediu para parar, e sempre com as
// orientações do painel. Nada aqui manda preço, proposta ou link por conta própria.

var ACQ07_BOTOES_PARE = ['nao tenho interesse', 'parar', 'parar promocoes', 'nao quero receber', 'sair'];
var ACQ07_BOTOES_QUERO = ['quero o diagnostico', 'quero', 'tenho interesse'];

// GET de verificação da Meta: hub.mode=subscribe e hub.verify_token igual ao guardado.
function acq07Verificacao(query, segredos) {
  var q = query || {};
  var token = segredos && segredos.verify_token;
  if (!token || String(token).length < 8) return { ok: false, motivo: 'verify_token_nao_configurado' };
  if (q['hub.mode'] !== 'subscribe') return { ok: false, motivo: 'modo_invalido' };
  if (!acqIguaisSeguro(String(q['hub.verify_token'] || ''), String(token))) return { ok: false, motivo: 'verify_token_diferente' };
  return { ok: true, challenge: String(q['hub.challenge'] || '') };
}

// POST: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app secret, corpo bruto).
function acq07Assinatura(corpoBruto, cabecalho, appSecret) {
  if (!appSecret) return { ok: false, motivo: 'app_secret_nao_configurado' };
  if (typeof corpoBruto !== 'string' || !corpoBruto.length) return { ok: false, motivo: 'corpo_bruto_indisponivel' };
  var h = String(cabecalho || '');
  if (h.indexOf('sha256=') !== 0) return { ok: false, motivo: 'sem_assinatura' };
  return acqIguaisSeguro(h.slice(7).toLowerCase(), acqHmacSha256(appSecret, corpoBruto)) ? { ok: true } : { ok: false, motivo: 'assinatura_invalida' };
}

function acq07SemAcento(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Corpo do webhook (entry/changes/value). Só o número comercial configurado (quando houver).
function acq07Normalizar(corpo, phoneNumberId) {
  var out = { mensagens: [], status: [], ignoradas: [] };
  if (!corpo || corpo.object !== 'whatsapp_business_account' || !Array.isArray(corpo.entry)) { out.ignoradas.push('formato_desconhecido'); return out; }
  corpo.entry.forEach(function (e) {
    (e.changes || []).forEach(function (ch) {
      if (ch.field !== 'messages') { out.ignoradas.push('campo:' + ch.field); return; }
      var v = ch.value || {};
      var pid = v.metadata && v.metadata.phone_number_id;
      if (phoneNumberId && pid && String(pid) !== String(phoneNumberId)) { out.ignoradas.push('outro_numero'); return; }
      var perfis = {};
      (v.contacts || []).forEach(function (c) { if (c && c.wa_id) perfis[c.wa_id] = (c.profile && c.profile.name) || null; });
      (v.messages || []).forEach(function (m) {
        if (!m || !m.id || !m.from || !m.timestamp) { out.ignoradas.push('mensagem_incompleta'); return; }
        var texto = null, botao = null, midia = null;
        if (m.type === 'text') texto = m.text && m.text.body;
        else if (m.type === 'button') { texto = m.button && m.button.text; botao = (m.button && (m.button.payload || m.button.text)) || null; }
        else if (m.type === 'interactive') {
          var it = m.interactive || {};
          var r = it.button_reply || it.list_reply || {};
          texto = r.title || null; botao = r.id || r.title || null;
        } else midia = m.type;
        out.mensagens.push({ wamid: String(m.id), de: String(m.from), nome_perfil: perfis[m.from] || null,
          em: new Date(Number(m.timestamp) * 1000).toISOString(), tipo: m.type, texto: texto ? String(texto).slice(0, 4000) : null,
          botao: botao ? String(botao).slice(0, 200) : null, midia: midia, contexto_wamid: (m.context && m.context.id) || null, phone_number_id: pid || null });
      });
      (v.statuses || []).forEach(function (s) {
        if (!s || !s.id || !s.status) return;
        out.status.push({ wamid: String(s.id), status: String(s.status), em: s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : null,
          destinatario_final: String(s.recipient_id || '').slice(-4), erros: (s.errors || []).map(function (x) { return { code: x.code, title: x.title, message: x.message || (x.error_data && x.error_data.details) || null }; }) });
      });
    });
  });
  return out;
}

function acq07TextoParaRegistro(m) {
  if (m.texto) return (m.botao ? '[botão] ' : '') + m.texto;
  return '[' + (m.midia || m.tipo || 'mensagem') + ' recebido, sem texto]';
}

// Reivindica a mensagem (a Meta reenvia webhooks): uma mensagem é tratada uma vez só.
function acq07EventoEntrada(m, ctx) {
  return acqEvento({ workflow_id: 'ACQ-07', run_id: ctx.run_id, entity_type: 'mensagem_whatsapp', entity_id: m.wamid,
    occurred_at: m.em, source: 'n8n:ACQ-07', idempotency_key: 'ACQ-07|entrada|' + m.wamid, tipo: 'comercial_entrada_recebida',
    evidence_refs: ['wamid:' + m.wamid], payload: { de_final: m.de.slice(-4), tipo: m.tipo, tem_texto: !!m.texto } });
}

// Só status com falha viram evento (entregue/lido não interessam aqui).
function acq07EventoStatus(s, ctx) {
  if (s.status !== 'failed') return null;
  return acqEvento({ workflow_id: 'ACQ-07', run_id: ctx.run_id, entity_type: 'mensagem_whatsapp', entity_id: s.wamid,
    occurred_at: s.em || new Date(ctx.agoraMs).toISOString(), source: 'n8n:ACQ-07', idempotency_key: 'ACQ-07|status|' + s.wamid + '|failed',
    tipo: 'comercial_envio_falhou_na_entrega', evidence_refs: ['wamid:' + s.wamid], payload: s });
}

function acq07AcharLead(m, fila) {
  var itens = (fila && fila.itens) || [];
  for (var i = 0; i < itens.length; i++) if (itens[i] && itens[i].whatsapp && acqComMesmoNumero(itens[i].whatsapp, m.de)) return itens[i];
  return null;
}

function acq07PedidoEntrada(m, lead, cfg) {
  if (!lead) return null;
  return { ref: 'entrada|' + m.wamid, ferramenta: 'aceleriq_comercial_registrar_mensagem',
    argumentos: { lead_id: lead.lead_id, direcao: 'entrada', texto: acq07TextoParaRegistro(m), canal: 'whatsapp', enviada_em: m.em, id_externo: m.wamid } };
}

// Uma chamada ao Jev por mensagem: intenção (Choice) e se pede para avançar (Noul).
function acq07PedidoJev(m, lead) {
  var conversa = ((lead && lead.mensagens) || []).slice(-10).map(function (x) {
    return { quem: x.direcao === 'saida' ? 'aceleriq' : 'lead', texto: String(x.texto || '').slice(0, 600) };
  });
  return {
    model: 'jev-latest',
    state: {
      contexto: 'Conversa de prospecção pelo WhatsApp entre a Aceleriq (empresa de marketing e tecnologia, que oferece um diagnóstico gratuito do site e da presença online) e uma empresa.',
      lead: lead ? { nome: lead.nome || null, empresa: lead.empresa || null, etapa: lead.etapa || null } : null,
      conversa_anterior: conversa,
      ultima_mensagem: acq07TextoParaRegistro(m),
    },
    questions: {
      intencao: { type: 'choice',
        instructions: 'O que o lead quer dizer com `ultima_mensagem`, a mensagem mais recente dele, considerando `conversa_anterior`?',
        criteria: {
          interessado: 'Mostra interesse em seguir: aceita o diagnóstico, pede para mandar ou preparar, diz que quer saber mais ou que topa conversar.',
          pergunta: 'Faz uma pergunta sobre a Aceleriq, o diagnóstico, o serviço, o preço ou como funciona, sem decidir nada ainda.',
          nao_agora: 'Diz que agora não é o momento, que vai pensar, que está ocupado ou pede para falar depois, sem pedir para parar de receber mensagens.',
          pare: 'Pede para não receber mais mensagens, diz que não tem nenhum interesse, manda parar, sair ou descadastrar, ou reclama do contato.',
          outro: 'Cumprimento, agradecimento, emoji, confirmação curta ou assunto sem relação com a conversa comercial.',
        } },
      avancou: { type: 'noul',
        instructions: 'Em `ultima_mensagem`, o lead pede preço, valores, proposta, orçamento, uma reunião ou ligação, ou pede para falar com uma pessoa da equipe?' },
    },
  };
}

function acq07LerJev(resposta) {
  var a = (resposta && resposta.answers) || {};
  if (!a.intencao || typeof a.intencao.choice !== 'string' || !a.avancou || typeof a.avancou.noul !== 'number') return null;
  var p = a.intencao.probabilities || {};
  return { intencao: a.intencao.choice, confianca: typeof a.intencao.confidence === 'number' ? a.intencao.confidence : null,
    p_pare: typeof p.pare === 'number' ? p.pare : (a.intencao.choice === 'pare' ? 1 : 0), p_avancou: a.avancou.noul, modelo: resposta.model || null };
}

// Regras. registro: resultado de registrar_mensagem (pode trazer pediu_para_parar), ou null.
function acq07Decidir(m, lead, registro, julg, fila, cfg, agoraMs) {
  var c = acqComCfg(cfg);
  var d = { acao: 'nada', responder: false, caixa: false, parar: false, motivos: [], intencao: julg ? julg.intencao : null };
  var conf = (fila && fila.config) || {};
  if (!fila) { d.motivos.push('fila_indisponivel'); return d; }
  if (!lead) { d.motivos.push(conf.ativo === false ? 'mercurio_desligado' : 'numero_sem_lead_do_mercurio'); return d; }
  var botao = acq07SemAcento(m.botao || '');
  var textoSA = acq07SemAcento(m.texto || '');
  if (acqComNaoContatar(lead)) { d.motivos.push('lead_ja_marcado_nao_contatar'); return d; }
  if (registro && registro.pediu_para_parar) { d.acao = 'parar'; d.motivos.push('painel_detectou_pedido_para_parar'); return d; }
  if (m.botao && ACQ07_BOTOES_PARE.indexOf(botao) >= 0) { d.acao = 'parar'; d.parar = true; d.motivos.push('botao_nao_tenho_interesse'); return d; }
  if (!m.texto) { d.motivos.push('mensagem_sem_texto'); return d; }
  if (!julg) { d.motivos.push('classificacao_indisponivel'); return d; }
  if (julg.intencao === 'pare' || julg.p_pare >= c.limiar_pare) { d.acao = 'parar'; d.parar = true; d.motivos.push('jev_pare:' + julg.p_pare); return d; }
  if (conf.ativo === false) { d.motivos.push('mercurio_desligado'); return d; }
  var idadeH = (agoraMs - Date.parse(m.em)) / 3600000;
  var janela = isFinite(idadeH) && idadeH >= 0 && idadeH < Number(c.janela_horas);
  var quer = (m.botao && ACQ07_BOTOES_QUERO.indexOf(botao) >= 0) || ACQ07_BOTOES_QUERO.indexOf(textoSA) >= 0;
  var semSaida = !((lead.mensagens || []).some(function (x) { return x.direcao === 'saida'; }));
  if (quer || julg.p_avancou >= 0.5 || (julg.intencao === 'interessado' && (julg.confianca === null || julg.confianca >= 0.5))) {
    d.caixa = true; d.motivos.push(quer ? 'botao_quero' : julg.p_avancou >= 0.5 ? 'pediu_para_avancar' : 'interessado');
  }
  if (julg.intencao === 'outro' && !semSaida && !d.caixa) { d.motivos.push('sem_necessidade_de_resposta'); }
  else d.responder = true;
  if (d.responder && !janela) { d.responder = false; d.motivos.push('fora_da_janela_de_24h'); }
  d.acao = d.responder ? 'responder' : (d.caixa ? 'caixa' : 'nada');
  return d;
}

// Pedido ao modelo de linguagem (OpenRouter, formato chat completions).
function acq07PedidoLLM(m, lead, decisao, fila, cfg) {
  var c = acqComCfg(cfg);
  var conf = (fila && fila.config) || {};
  var fatos = (lead.fatos || []).slice(0, 10).map(function (f) { return f.campo + ': ' + f.valor; });
  var sistema = [
    'Você é o Mercúrio, assistente comercial da Aceleriq (empresa de marketing e tecnologia, nunca se apresente como agência), respondendo um lead pelo WhatsApp da Aceleriq.',
    'Regras fixas: português do Brasil natural e direto; no máximo 3 frases curtas e ' + c.resposta_max_caracteres + ' caracteres; no máximo uma pergunta; sem markdown, listas ou emojis em excesso.',
    'Nunca invente preço, prazo, desconto, resultado, caso ou garantia que não esteja nas orientações; se não souber, diga que confirma com a equipe.',
    'Não prometa resultado. Não mande link que não esteja nas orientações. Apresente-se como assistente da Aceleriq se perguntarem; nunca finja ser outra pessoa.',
    decisao.caixa ? 'O lead quer avançar: agradeça, diga que a equipe da Aceleriq vai falar com ele em seguida e, se fizer sentido, pergunte o melhor horário.' : '',
    decisao.intencao === 'nao_agora' ? 'O lead disse que agora não é o momento: agradeça, deixe a porta aberta e não insista.' : '',
    '',
    'Orientações da equipe (valem mais que qualquer outra coisa):',
    String(conf.orientacoes || '(sem orientações cadastradas: seja breve e ofereça o diagnóstico gratuito do site)').slice(0, 12000),
    '',
    'Lead: ' + [lead.nome, lead.empresa && lead.empresa !== lead.nome ? lead.empresa : null, 'etapa ' + lead.etapa].filter(Boolean).join(' | '),
    fatos.length ? 'Fatos da ficha: ' + fatos.join('; ') : '',
    'Intenção percebida da última mensagem: ' + (decisao.intencao || 'desconhecida') + '.',
    'Responda só com o texto da mensagem.',
  ].filter(function (x) { return x !== ''; }).join('\n');
  var msgs = [{ role: 'system', content: sistema }];
  (lead.mensagens || []).slice(-12).forEach(function (x) {
    if (x.texto) msgs.push({ role: x.direcao === 'saida' ? 'assistant' : 'user', content: String(x.texto).slice(0, 1500) });
  });
  var ultimo = msgs[msgs.length - 1];
  var atual = acq07TextoParaRegistro(m);
  if (!(ultimo.role === 'user' && ultimo.content === atual)) msgs.push({ role: 'user', content: atual });
  return { model: c.llm_modelo, messages: msgs, max_tokens: 400, temperature: 0.4 };
}

// Confere o texto do modelo antes de mandar. Sem texto bom, nada sai (a Caixa/registro seguem).
function acq07LerLLM(resposta, cfg, orientacoes) {
  var c = acqComCfg(cfg);
  if (!resposta || resposta.error) return { ok: false, motivo: 'llm_indisponivel: ' + String((resposta && resposta.error && (resposta.error.message || resposta.error)) || 'sem resposta').slice(0, 200) };
  var t = resposta.choices && resposta.choices[0] && resposta.choices[0].message && resposta.choices[0].message.content;
  t = String(t || '').replace(/\*\*/g, '').replace(/^["“]|["”]$/g, '').trim();
  if (!t) return { ok: false, motivo: 'llm_vazio' };
  if (t.length > Number(c.resposta_max_caracteres)) {
    var corte = t.slice(0, Number(c.resposta_max_caracteres));
    var fim = Math.max(corte.lastIndexOf('. '), corte.lastIndexOf('? '), corte.lastIndexOf('! '));
    if (fim < 40) return { ok: false, motivo: 'llm_longo_demais' };
    t = corte.slice(0, fim + 1);
  }
  var links = t.match(/https?:\/\/\S+|www\.\S+/gi) || [];
  var fora = links.filter(function (l) { return String(orientacoes || '').indexOf(l.replace(/[).,!?]+$/, '')) < 0; });
  if (fora.length) return { ok: false, motivo: 'link_fora_das_orientacoes' };
  return { ok: true, texto: t, modelo: resposta.model || null };
}

// Pedidos ao painel depois do envio (ou da decisão). ctx = item do fluxo (mensagem, lead, decisão).
function acq07PedidosEscrita(it, estadoEnvio, meta, cfg, agoraMs) {
  var c = acqComCfg(cfg);
  var out = [];
  var m = it.mensagem, lead = it.lead, d = it.decisao;
  if (!lead) return out;
  if (d.parar) {
    out.push({ ref: 'parar|' + m.wamid + '|' + lead.lead_id, ferramenta: 'aceleriq_update_opportunity',
      argumentos: { opportunity_id: lead.lead_id, qualificacao: { nao_contatar: 'sim', nao_contatar_motivo: ('Pediu para parar no WhatsApp em ' + m.em.slice(0, 10) + ' (' + (d.motivos[0] || '') + ').').slice(0, 600) } } });
  }
  if (d.caixa) {
    out.push({ ref: 'caixa|' + m.wamid + '|' + lead.lead_id, ferramenta: 'aceleriq_comercial_avisar_caixa',
      argumentos: { lead_id: lead.lead_id, tipo: 'avancou', operador: c.operador,
        resumo: ('Respondeu no WhatsApp: "' + acq07TextoParaRegistro(m).slice(0, 600) + '". Intenção: ' + (d.intencao || 'botão') + '.' + (it.resposta && it.resposta.texto ? ' O Mercúrio respondeu: "' + it.resposta.texto.slice(0, 500) + '"' : '')).slice(0, 2000),
        proximo_passo: 'Falar com o lead no WhatsApp comercial e seguir para o diagnóstico ou a proposta.', dados: { wamid: m.wamid, intencao: d.intencao || null, motivos: d.motivos } } });
  }
  if ((estadoEnvio === 'aceita' && meta && meta.wamid) || estadoEnvio === 'simular') {
    out.push({ ref: 'saida|' + m.wamid + '|' + lead.lead_id, ferramenta: 'aceleriq_comercial_registrar_mensagem',
      argumentos: { lead_id: lead.lead_id, direcao: 'saida', texto: it.resposta.texto, canal: 'whatsapp', enviada_em: new Date(agoraMs).toISOString(),
        id_externo: estadoEnvio === 'aceita' ? meta.wamid : 'simulado:resposta:' + m.wamid, operador: c.operador } });
  }
  return out;
}

// Evento do desfecho da mensagem recebida (o que foi decidido e o que saiu).
function acq07Desfecho(it, estadoEnvio, meta, ctx) {
  var m = it.mensagem, d = it.decisao;
  var ev = acqEvento({ workflow_id: 'ACQ-07', run_id: ctx.run_id, entity_type: 'mensagem_whatsapp', entity_id: m.wamid,
    occurred_at: m.em, source: 'n8n:ACQ-07', idempotency_key: 'ACQ-07|desfecho|' + m.wamid,
    tipo: 'comercial_entrada_' + d.acao + (estadoEnvio ? '_' + estadoEnvio : ''), evidence_refs: ['wamid:' + m.wamid].concat(meta && meta.wamid ? ['wamid:' + meta.wamid] : []),
    payload: { lead_id: it.lead ? it.lead.lead_id : null, de_final: m.de.slice(-4), texto: m.texto, botao: m.botao, decisao: d, julgamento: it.julgamento || null,
      registro_entrada: it.registro_entrada || null, resposta: it.resposta || null, envio: estadoEnvio || null, meta: meta || null } });
  var inc = null;
  if (!it.lead && d.motivos.indexOf('numero_sem_lead_do_mercurio') >= 0) inc = { key: 'ACQ-07|sem_lead|' + m.de.slice(-8), sev: 'aviso', titulo: 'Mensagem no WhatsApp comercial de número sem lead do Mercúrio', detalhe: { wamid: m.wamid, de_final: m.de.slice(-4), texto: m.texto } };
  else if (estadoEnvio === 'incerta') inc = { key: 'ACQ-07|envio_incerto|' + m.wamid, sev: 'alto', titulo: 'Resposta do Mercúrio com envio incerto: conferir no WhatsApp', detalhe: { wamid: m.wamid, meta: meta } };
  else if (estadoEnvio === 'recusada') inc = { key: 'ACQ-07|meta_recusou|' + (meta && meta.auth ? 'autenticacao' : meta && meta.codigo), sev: meta && meta.auth ? 'alto' : 'aviso', titulo: 'Cloud API recusou a resposta: ' + (meta && meta.motivo || ''), detalhe: { wamid: m.wamid, meta: meta } };
  else if (estadoEnvio === 'bloquear') inc = { key: 'ACQ-07|transporte_incompleto', sev: 'aviso', titulo: 'Resposta não saiu: transporte do WhatsApp incompleto', detalhe: { wamid: m.wamid } };
  else if (d.motivos.indexOf('fila_indisponivel') >= 0) inc = { key: 'ACQ-07|fila_indisponivel', sev: 'alto', titulo: 'Fila do comercial indisponível: mensagem do lead não foi registrada no painel (texto no evento)', detalhe: { wamid: m.wamid } };
  else if (d.motivos.indexOf('classificacao_indisponivel') >= 0) inc = { key: 'ACQ-07|jev_indisponivel', sev: 'aviso', titulo: 'Jev indisponível: mensagem do lead ficou sem resposta', detalhe: { wamid: m.wamid } };
  else if (it.resposta && it.resposta.ok === false) inc = { key: 'ACQ-07|resposta_nao_redigida|' + String(it.resposta.motivo).split(':')[0], sev: 'aviso', titulo: 'O Mercúrio não redigiu a resposta: ' + it.resposta.motivo, detalhe: { wamid: m.wamid } };
  return { evento: ev, incidente: inc };
}
