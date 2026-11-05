// ACQ-07 — Comercial: respostas dos leads no WhatsApp oficial (webhook da Cloud API).
// JS puro; depende de nucleo.js, adaptador.js e comercial.js.
// O Jev (TypeSafe) julga quem escreveu, a intenção, a etapa da venda, a objeção e o plano; as regras abaixo decidem
// o que fazer. O texto livre do Mercúrio só sai na janela de 24 h, nunca para quem pediu para parar, e sempre com as
// orientações e a base do painel. Preço e link só saem se estiverem lá; o valor do Pix vem do painel, nunca do texto.

var ACQ07_BOTOES_PARE = ['nao tenho interesse', 'parar', 'parar promocoes', 'nao quero receber', 'sair'];
var ACQ07_PLANOS = ['start_assistido', 'essencial', 'presenca', 'crescimento', 'estrutura', 'engenharia', 'google_avulso'];
var ACQ07_MAX_PARTES = 4;

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
        var texto = null, botao = null, midia = null, midiaId = null;
        if (m.type === 'text') texto = m.text && m.text.body;
        else if (m.type === 'button') { texto = m.button && m.button.text; botao = (m.button && (m.button.payload || m.button.text)) || null; }
        else if (m.type === 'interactive') {
          var it = m.interactive || {};
          var r = it.button_reply || it.list_reply || {};
          texto = r.title || null; botao = r.id || r.title || null;
        } else { midia = m.type; midiaId = (m[m.type] && m[m.type].id) || null; }
        var ref = m.referral ? { fonte: m.referral.source_type || null, id: m.referral.source_id || null, titulo: m.referral.headline || null, texto: m.referral.body ? String(m.referral.body).slice(0, 300) : null, link: m.referral.source_url || null } : null;
        out.mensagens.push({ wamid: String(m.id), de: String(m.from), nome_perfil: perfis[m.from] || null,
          em: new Date(Number(m.timestamp) * 1000).toISOString(), tipo: m.type, texto: texto ? String(texto).slice(0, 4000) : null,
          botao: botao ? String(botao).slice(0, 200) : null, midia: midia, midia_id: midiaId, anuncio: ref, contexto_wamid: (m.context && m.context.id) || null, phone_number_id: pid || null });
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
  if (m.texto) return (m.transcrito ? '[áudio] ' : m.botao ? '[botão] ' : '') + m.texto;
  return '[' + (m.midia || m.tipo || 'mensagem') + ' recebido, sem texto]';
}

// DDD + 8 últimos dígitos: junta as mensagens do mesmo número mesmo sem o 9.
function acq07De8(numero) {
  var d = String(numero || '').replace(/\D/g, '');
  if (d.indexOf('55') === 0 && d.length >= 12) d = d.slice(2);
  return d.length >= 10 ? d.slice(0, 2) + d.slice(-8) : d;
}

// Reivindica a mensagem (a Meta reenvia webhooks): uma mensagem é tratada uma vez só.
function acq07EventoEntrada(m, ctx) {
  return acqEvento({ workflow_id: 'ACQ-07', run_id: ctx.run_id, entity_type: 'mensagem_whatsapp', entity_id: m.wamid,
    occurred_at: m.em, source: 'n8n:ACQ-07', idempotency_key: 'ACQ-07|entrada|' + m.wamid, tipo: 'comercial_entrada_recebida',
    evidence_refs: ['wamid:' + m.wamid], payload: { de_final: m.de.slice(-4), de8: acq07De8(m.de), tipo: m.tipo, tem_texto: !!m.texto } });
}

// O texto da mensagem (já com o áudio transcrito), guardado para juntar com as que chegarem em seguida.
function acq07EventoTexto(m, ctx) {
  return acqEvento({ workflow_id: 'ACQ-07', run_id: ctx.run_id, entity_type: 'mensagem_whatsapp', entity_id: m.wamid,
    occurred_at: m.em, source: 'n8n:ACQ-07', idempotency_key: 'ACQ-07|texto|' + m.wamid, tipo: 'comercial_entrada_texto',
    evidence_refs: ['wamid:' + m.wamid], payload: { de8: acq07De8(m.de), m: m } });
}

function acq07PedidoTranscricao(base64, cfg) {
  var c = acqComCfg(cfg);
  return { model: c.transcricao_modelo, max_tokens: 800, temperature: 0, messages: [{ role: 'user', content: [
    { type: 'text', text: 'Transcreva este áudio de WhatsApp em português do Brasil, palavra por palavra. Responda só com a transcrição, sem comentários. Se não der para entender, responda só: [inaudível]' },
    { type: 'input_audio', input_audio: { data: base64, format: 'ogg' } },
  ] }] };
}

function acq07LerTranscricao(resposta) {
  var t = resposta && resposta.choices && resposta.choices[0] && resposta.choices[0].message && resposta.choices[0].message.content;
  t = String(t || '').trim();
  return t && !/^\[?in[aá]ud[ií]vel\]?\.?$/i.test(t) ? t.slice(0, 4000) : null;
}

// Depois da espera: só a execução da mensagem mais nova segue, levando as anteriores ainda sem resposta.
function acq07Lote(m, linha) {
  var maisNova = linha && linha.mais_nova;
  if (maisNova && maisNova !== m.wamid) return { seguir: false };
  var lista = ((linha && linha.mensagens) || []).map(function (x) { return x.m; }).filter(Boolean);
  if (!lista.some(function (x) { return x.wamid === m.wamid; })) lista.push(m);
  lista.sort(function (a, b) { return a.em < b.em ? -1 : a.em > b.em ? 1 : 0; });
  var unica = Object.assign({}, m, { wamids: lista.map(function (x) { return x.wamid; }), partes: lista,
    texto: lista.map(function (x) { return x.texto || '[' + (x.midia || 'mensagem') + ' enviado, sem texto]'; }).join('\n') });
  var botoes = lista.filter(function (x) { return x.botao; });
  unica.botao = botoes.length ? botoes[botoes.length - 1].botao : null;
  var comAnuncio = lista.filter(function (x) { return x.anuncio; });
  unica.anuncio = comAnuncio.length ? comAnuncio[0].anuncio : null;
  return { seguir: true, m: unica };
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

// Pedido que acha ou cria o lead de quem chamou sozinho (anúncio, indicação). Vale no CRM inteiro, não só na fila.
function acq07PedidoAcharLead(m, cfg) {
  return { ref: 'lead|' + m.wamid, ferramenta: 'aceleriq_comercial_entrada_nova',
    argumentos: Object.assign({ whatsapp: m.de, operador: acqComCfg(cfg).operador }, m.nome_perfil ? { nome_perfil: m.nome_perfil } : {}, m.anuncio ? { anuncio: m.anuncio } : {}) };
}

// O resultado da ponte vira o lead da conversa. Em simulação não há lead de verdade: um provisório só para a rodada.
function acq07LeadDoResultado(r, m) {
  if (!r || r.ok !== true) return null;
  if (r.simulado) return { lead_id: 'simulado-' + acq07De8(m.de), nome: m.nome_perfil || null, empresa: null, whatsapp: m.de, etapa: 'novo', qualificacao: { fonte: m.anuncio ? 'anuncio_whatsapp' : 'whatsapp_entrada', anuncio: m.anuncio || undefined }, mensagens: [], fatos: [], provisorio: true };
  var d = r.resultado || {};
  if (d.so_registrar) return { lead_id: d.lead_id, so_registrar: true, motivo: d.motivo, mensagens: [], fatos: [], qualificacao: {} };
  return d.item ? Object.assign({ whatsapp: m.de }, d.item) : null;
}

function acq07PedidoEntrada(m, lead) {
  if (!lead || lead.provisorio) return [];
  return ((m.partes && m.partes.length) ? m.partes : [m]).map(function (x) {
    return { ref: 'entrada|' + x.wamid + '|' + lead.lead_id, ferramenta: 'aceleriq_comercial_registrar_mensagem',
      argumentos: { lead_id: lead.lead_id, direcao: 'entrada', texto: acq07TextoParaRegistro(x), canal: 'whatsapp', enviada_em: x.em, id_externo: x.wamid } };
  });
}

// Uma chamada ao Jev por lote: quem escreveu, intenção, etapa da venda, objeção e plano. Perguntas independentes sobre o mesmo estado.
function acq07PedidoJev(m, lead) {
  var conversa = ((lead && lead.mensagens) || []).slice(-14).map(function (x) {
    return { quem: x.direcao === 'saida' ? 'aceleriq' : 'lead', texto: String(x.texto || '').slice(0, 600) };
  });
  return {
    model: 'jev-latest',
    state: {
      contexto: 'Conversa de venda pelo WhatsApp entre o executivo de negócios da Aceleriq (empresa de marketing e tecnologia, com planos mensais e diagnóstico gratuito) e uma empresa. Pode ser prospecção ativa ou alguém que chamou por um anúncio.',
      lead: lead ? { nome: lead.nome || null, empresa: lead.empresa || null, etapa: lead.etapa || null, veio_de_anuncio: !!(lead.qualificacao && lead.qualificacao.anuncio) } : null,
      conversa_anterior: conversa,
      ultima_mensagem: acq07TextoParaRegistro(m),
    },
    questions: {
      remetente: { type: 'choice',
        instructions: 'Quem produziu `ultima_mensagem`?',
        criteria: {
          humano: 'Uma pessoa escrevendo ou falando, mesmo que de forma curta ou informal.',
          resposta_automatica: 'Mensagem automática de ausência, saudação padrão ou "em breve retornamos", sem opções para escolher.',
          menu_de_robo: 'Robô de atendimento mostrando um menu de opções numeradas ou pedindo para digitar uma opção.',
        } },
      intencao: { type: 'choice',
        instructions: 'O que o lead quer dizer com `ultima_mensagem`, considerando `conversa_anterior`?',
        criteria: {
          interessado: 'Mostra interesse em seguir: aceita o diagnóstico, pede para mandar ou preparar, diz que quer saber mais ou que topa conversar.',
          pergunta: 'Faz uma pergunta sobre a Aceleriq, o diagnóstico, o serviço, o preço ou como funciona, sem decidir nada ainda.',
          nao_agora: 'Diz que agora não é o momento, que vai pensar, que está ocupado ou pede para falar depois, sem pedir para parar de receber mensagens.',
          pare: 'Pede para não receber mais mensagens, manda parar, sair ou descadastrar, ou reclama do contato. Uma objeção de preço ou um "não preciso agora" não é pedido para parar.',
          outro: 'Cumprimento, agradecimento, emoji, confirmação curta ou assunto sem relação com a conversa comercial.',
        } },
      etapa: { type: 'choice',
        instructions: 'Qual é o próximo passo certo do vendedor depois de `ultima_mensagem`?',
        criteria: {
          descobrir: 'Ainda falta entender o negócio ou o problema do lead. Inclui o primeiro oi de quem chegou agora.',
          apresentar: 'O problema já apareceu, ou o lead perguntou como funciona ou quanto custa: é hora de mostrar a solução ou o valor.',
          tratar_objecao: 'O lead levantou uma barreira: preço, falta de tempo, já ter fornecedor, desconfiança, resultado ruim antes.',
          propor_fechamento: 'O lead entendeu o valor, a dor está clara e ele demonstra interesse, mas ainda não decidiu: é hora de recomendar um plano e propor fechar aqui.',
          propor_reuniao: 'O lead pede para conversar com alguém, ou diz que não consegue decidir por aqui. Só nesses casos.',
          confirmar_reuniao: 'O lead está escolhendo ou acaba de dizer um dia, horário ou período para a conversa. Se ele só agradece depois de já ter combinado, a etapa é encerrar.',
          fechar_agora: 'O lead decidiu contratar agora: escolheu um plano, pediu para pagar, pediu o Pix ou mandou os dados para fechar.',
          aguardando_pagamento: 'O Pix já foi enviado na conversa e o lead fala do pagamento: disse que pagou, que vai pagar, mandou comprovante ou teve dificuldade.',
          passar_humano: 'O lead pede para falar com uma pessoa, reclama, ou pede desconto, parcelamento, prazo, garantia ou algo fora da tabela.',
          encerrar: 'A conversa acabou por agora: despedida, agradecimento depois de combinar o próximo passo, ou recusa educada depois de já ter sido ouvido.',
        } },
      objecao: { type: 'choice',
        instructions: 'Qual barreira principal aparece em `ultima_mensagem`?',
        criteria: {
          nenhuma: 'Não há objeção nesta mensagem.',
          preco: 'Acha caro, não tem verba, compara preço.',
          tempo: 'Sem tempo, está corrido, vai ver depois.',
          ja_tenho: 'Já tem agência, sobrinho, freelancer ou faz sozinho.',
          desconfianca: 'Duvida da Aceleriq, pede prova, teve experiência ruim com marketing.',
          sem_necessidade: 'Acha que não precisa, indicação já basta, movimento já está bom.',
          vai_pensar: 'Vai pensar, falar com o sócio, cônjuge ou decisor.',
        } },
      plano: { type: 'choice',
        instructions: 'Considerando `conversa_anterior` e `ultima_mensagem`, qual plano o lead escolheu para contratar? Só conta se ele escolheu.',
        criteria: {
          nenhum: 'Nenhum plano foi escolhido até agora, ou o negócio do lead fica fora do Brasil, que tem outra tabela.',
          google_avulso: 'Quer só o Perfil Google, sem plano mensal.',
          start_assistido: 'Escolheu o Start Assistido, o de R$ 847 por mês, o menor plano.', essencial: 'Escolheu o Essencial, o de R$ 1.297 por mês.', presenca: 'Escolheu o Presença, o de R$ 1.997 por mês.',
          crescimento: 'Escolheu o Crescimento, o de R$ 2.997 por mês.', estrutura: 'Escolheu o Estrutura, o de R$ 4.497 por mês.', engenharia: 'Escolheu o Engenharia ou OS, o de R$ 6.997 por mês.',
        } },
      escolheu_horario: { type: 'noul', instructions: 'Em `ultima_mensagem`, o lead escolhe ou aceita um dia e horário para a conversa, mesmo que também agradeça ou se despeça?' },
      quer_google: { type: 'noul', instructions: 'Considerando `conversa_anterior` e `ultima_mensagem`, o lead pediu o Perfil Google junto com um plano mensal?' },
    },
  };
}

function acq07LerJev(resposta) {
  var a = (resposta && resposta.answers) || {};
  if (!a.intencao || typeof a.intencao.choice !== 'string' || !a.etapa || typeof a.etapa.choice !== 'string') return null;
  var p = a.intencao.probabilities || {};
  return { intencao: a.intencao.choice, confianca: typeof a.intencao.confidence === 'number' ? a.intencao.confidence : null,
    p_pare: typeof p.pare === 'number' ? p.pare : (a.intencao.choice === 'pare' ? 1 : 0),
    remetente: (a.remetente && a.remetente.choice) || 'humano', etapa: a.etapa.choice,
    objecao: (a.objecao && a.objecao.choice) || 'nenhuma', plano: (a.plano && a.plano.choice) || 'nenhum', quer_google: !!(a.quer_google && a.quer_google.noul >= 0.5), escolheu_horario: !!(a.escolheu_horario && a.escolheu_horario.noul >= 0.5), modelo: resposta.model || null };
}

// CPF ou CNPJ com dígito certo em alguma mensagem do lead. O painel confere de novo antes de cobrar.
function acq07DocumentoValido(d) {
  if (/^(\d)\1+$/.test(d)) return false;
  var i, soma, r;
  if (d.length === 11) {
    for (var t = 9; t <= 10; t++) { soma = 0; for (i = 0; i < t; i++) soma += Number(d[i]) * (t + 1 - i); if (((soma * 10) % 11) % 10 !== Number(d[t])) return false; }
    return true;
  }
  if (d.length === 14) {
    for (var u = 12; u <= 13; u++) { soma = 0; var peso = u - 7; for (i = 0; i < u; i++) { soma += Number(d[i]) * peso; peso = peso === 2 ? 9 : peso - 1; } r = soma % 11 < 2 ? 0 : 11 - (soma % 11); if (r !== Number(d[u])) return false; }
    return true;
  }
  return false;
}

function acq07DadosDeCobranca(m, lead) {
  var textos = ((lead && lead.mensagens) || []).filter(function (x) { return x.direcao !== 'saida'; }).map(function (x) { return String(x.texto || ''); }).concat([String(m.texto || '')]);
  var documento = null, email = null;
  textos.forEach(function (t) {
    (t.match(/\d[\d.\-\/ ]{9,18}\d/g) || []).forEach(function (c) { var d = c.replace(/\D/g, ''); if (acq07DocumentoValido(d)) documento = d; });
    var e = t.match(/[^\s@,;:]+@[^\s@,;:]+\.[a-z]{2,}/i);
    if (e) email = e[0];
  });
  return { documento: documento, email: email || (lead && lead.email) || null };
}

// Regras: o Jev julga, o código decide. registro: resultado de registrar_mensagem (pode trazer pediu_para_parar).
function acq07Decidir(m, lead, registro, julg, fila, cfg, agoraMs) {
  var c = acqComCfg(cfg);
  var d = { acao: 'nada', responder: false, caixa: false, parar: false, cobrar: false, motivos: [], intencao: julg ? julg.intencao : null, etapa: julg ? julg.etapa : null, objecao: julg ? julg.objecao : null, modo: 'venda', faltam: [], plano: null, agenda: false, voz: false };
  var conf = (fila && fila.config) || {};
  if (!fila) { d.motivos.push('fila_indisponivel'); return d; }
  if (!lead) { d.motivos.push(conf.ativo === false ? 'mercurio_desligado' : 'lead_indisponivel'); return d; }
  if (lead.so_registrar) { d.motivos.push('so_registrar:' + lead.motivo); return d; }
  var botao = acq07SemAcento(m.botao || '');
  if (acqComNaoContatar(lead)) { d.motivos.push('lead_ja_marcado_nao_contatar'); return d; }
  if (registro && registro.pediu_para_parar) { d.acao = 'parar'; d.motivos.push('painel_detectou_pedido_para_parar'); return d; }
  if (m.botao && ACQ07_BOTOES_PARE.indexOf(botao) >= 0) { d.acao = 'parar'; d.parar = true; d.motivos.push('botao_nao_tenho_interesse'); return d; }
  if (!julg) { d.motivos.push('classificacao_indisponivel'); return d; }
  if (julg.intencao === 'pare' || julg.p_pare >= c.limiar_pare) { d.acao = 'parar'; d.parar = true; d.motivos.push('jev_pare:' + julg.p_pare); return d; }
  if (conf.ativo === false) { d.motivos.push('mercurio_desligado'); return d; }
  var idadeH = (agoraMs - Date.parse(m.em)) / 3600000;
  var janela = isFinite(idadeH) && idadeH >= 0 && idadeH < Number(c.janela_horas);
  if (!janela) { d.motivos.push('fora_da_janela_de_24h'); return d; }
  if (julg.remetente === 'resposta_automatica') { d.motivos.push('resposta_automatica_do_lead'); return d; }
  if (julg.remetente === 'menu_de_robo') {
    var tentativas = (lead.mensagens || []).filter(function (x) { return x.direcao === 'saida' && String(x.texto || '').length <= 3; }).length;
    if (tentativas >= 2) { d.motivos.push('robo_sem_saida'); return d; }
    d.modo = 'menu'; d.responder = true; d.acao = 'responder'; d.motivos.push('menu_de_robo'); return d;
  }
  d.responder = true;
  // Escolheu horário vale mais que a despedida na mesma mensagem: nunca promete conversa sem marcar.
  if (julg.escolheu_horario && julg.etapa === 'encerrar') { julg.etapa = 'confirmar_reuniao'; d.etapa = 'confirmar_reuniao'; }
  d.agenda = julg.etapa === 'propor_reuniao' || julg.etapa === 'confirmar_reuniao' || julg.escolheu_horario === true;
  d.voz = !!(m.transcrito || (m.partes || []).some(function (x) { return x.transcrito; }));
  if (julg.etapa === 'passar_humano') { d.caixa = true; d.motivos.push('pediu_pessoa_ou_fora_da_tabela'); }
  if (julg.etapa === 'fechar_agora') {
    var dados = acq07DadosDeCobranca(m, lead);
    d.plano = ACQ07_PLANOS.indexOf(julg.plano) >= 0 ? julg.plano : null;
    d.com_google = julg.quer_google === true && d.plano !== 'google_avulso';
    d.documento = dados.documento; d.email = dados.email;
    if (!d.plano) d.faltam.push('qual plano');
    if (!dados.documento) d.faltam.push('CPF ou CNPJ');
    d.cobrar = !d.faltam.length;
    d.motivos.push(d.cobrar ? 'fechar_com_pix' : 'fechar_faltam_dados');
  }
  if (julg.etapa === 'encerrar' && julg.intencao === 'outro') { d.responder = false; d.motivos.push('conversa_encerrada'); }
  d.acao = d.responder ? 'responder' : (d.caixa ? 'caixa' : 'nada');
  return d;
}

function acq07BaseDeVendas(conf) {
  return ((conf && conf.conhecimento) || []).map(function (x) {
    return '### ' + x.titulo + (x.quando_usar ? ' (quando: ' + x.quando_usar + ')' : '') + '\n' + x.tecnica + (x.exemplo ? '\nExemplo: ' + x.exemplo : '');
  }).join('\n\n').slice(0, 45000);
}

var ACQ07_INSTRUCAO_DA_ETAPA = {
  descobrir: 'Agora descubra. Se ainda não souber o nome da pessoa, pergunte. Faça uma pergunta específica sobre o negócio ou sobre como os clientes chegam hoje. Ainda não ofereça plano.',
  apresentar: 'Agora mostre que entende do assunto: explique o que faria primeiro para a dor dita e por quê, e como funciona o acompanhamento, ligando à situação dele. Se perguntou preço, responda com o valor do plano certo ou com a frase de preço das orientações. Termine com uma pergunta que leve à decisão.',
  tratar_objecao: 'Agora trate a objeção: reconheça sem discutir, faça uma pergunta que revele o que está por trás e conecte ao que ele já contou. Use o método e a maturação quando ajudar. Se ele já recusou duas vezes, deixe a porta aberta e pare de insistir.',
  propor_fechamento: 'Agora conduza para fechar aqui: recomende um plano, diga o valor, o que inclui e a fidelidade, e pergunte se pode gerar o Pix. Não ofereça reunião nem diga que vai passar para o responsável.',
  propor_reuniao: 'O lead pediu para conversar. Ofereça no máximo dois dos horários livres, pelo nome do dia e da hora. A conversa é com o Almir, fundador da Aceleriq.',
  confirmar_reuniao: 'O lead está escolhendo o horário. Se escolheu um dos horários livres, preencha horario_escolhido com o código dele e diga que ficou marcado e que o Almir chega sabendo de tudo. Se pediu um horário que não está na lista, explique e ofereça os que estão.',
  fechar_agora: 'O lead decidiu. Confirme o plano, o que está incluso, a fidelidade, e diga que o primeiro Pix é a entrada mais a primeira mensalidade. Se pediu o Perfil Google junto, diga que entra como adicional de R$ 297. O aporte em anúncio é sempre à parte. Não escreva código nem chave Pix nem o total: o sistema manda logo depois da sua mensagem.',
  aguardando_pagamento: 'Agradeça. Diga que, assim que o pagamento cair, o sistema avisa e o Almir chama para o onboarding. Não diga que foi confirmado e não peça comprovante.',
  passar_humano: 'Diga com naturalidade que vai passar para o Almir, que chama neste WhatsApp com o contexto. Não negocie fora da tabela.',
  encerrar: 'Agradeça em uma frase e deixe a porta aberta, sem nova oferta.',
};

// Pedido ao modelo de linguagem (OpenRouter, formato chat completions). A etapa vem do Jev; o texto, daqui.
function acq07PedidoLLM(m, lead, decisao, fila, cfg, horarios) {
  var c = acqComCfg(cfg);
  var conf = (fila && fila.config) || {};
  var ex = c.executivo || {};
  var fatos = (lead.fatos || []).filter(function (f) { return f.situacao === 'gravado'; }).slice(0, 10).map(function (f) { return f.campo + ': ' + f.valor; });
  var anuncio = lead.qualificacao && lead.qualificacao.anuncio;
  var sistema = decisao.modo === 'menu' ? [
    'Você escreve para um robô de atendimento de outra empresa. Leia o menu e escolha a opção que leva a uma pessoa, ao comercial ou ao responsável.',
    'Responda em JSON: {"mensagens":["só o número ou a palavra da opção"],"nome_cobranca":null,"horario_escolhido":null,"resumo_para_almir":null}',
  ].join('\n') : [
    'Você é ' + ex.nome + ', ' + ex.cargo + ' da Aceleriq (empresa de marketing e tecnologia; nunca diga agência), vendendo pelo WhatsApp. Seu objetivo é fechar aqui na conversa; a reunião é o último recurso. Você entende do assunto e passa segurança.',
    'Chame a pessoa pelo primeiro nome, nunca pelo nome da empresa. Se não souber o nome, pergunte. Confira o que já foi dito antes de responder: não repita explicação, não mude valor e não se contradiga.',
    'Fale como uma pessoa falaria no WhatsApp: português do Brasil, frases curtas, sem markdown, sem listas, sem jargão de marketing, no máximo um emoji quando combinar. Nada de "espero que esteja bem" ou texto de folheto. Use o que a pessoa disse. Não repita a mesma abertura. Faça uma pergunta só por vez.',
    'Quebre a resposta em 1 a ' + ACQ07_MAX_PARTES + ' mensagens curtas, como alguém digitando, com no máximo ' + c.resposta_max_caracteres + ' caracteres somando tudo.',
    'Não se descreva como assistente nem como robô. Mas, se a pessoa perguntar com sinceridade se fala com um robô ou com uma pessoa, não negue e não diga que é humano: diga que é ' + ex.nome + ', ' + ex.cargo + ' da Aceleriq, que atende aqui com apoio de inteligência artificial, e que o Almir, fundador, acompanha as conversas.',
    'Nunca invente preço, prazo, desconto, resultado, caso, cliente ou garantia. Não diga que tem muitos clientes, que atende bastante gente de um lugar ou de um nicho, nem cite volume ou experiência que não esteja escrito nas orientações. Não mande link que não esteja nelas. Não sabe: diga que confirma com o Almir.',
    'Evite frases prontas de vendedor como "que bom que chamou", "fico feliz" ou "excelente pergunta", e não comece duas respostas do mesmo jeito. Não elogie sem motivo. Não escreva o valor total do Pix: o sistema manda.',
    'Nunca peça senha, cartão ou dado bancário. CPF ou CNPJ só para fechar.',
    '',
    'Etapa decidida para esta resposta: ' + (decisao.etapa || 'descobrir') + '. ' + (ACQ07_INSTRUCAO_DA_ETAPA[decisao.etapa] || ''),
    decisao.objecao && decisao.objecao !== 'nenhuma' ? 'Objeção percebida: ' + decisao.objecao + '.' : '',
    decisao.faltam && decisao.faltam.length ? 'Para gerar o Pix ainda falta: ' + decisao.faltam.join(' e ') + '. Peça isso agora, com naturalidade.' : '',
    horarios && horarios.length ? 'HORÁRIOS LIVRES (ofereça só estes; horario_escolhido recebe o código): ' + horarios.map(function (h) { return h.inicio + ' = ' + h.rotulo; }).join('; ') + '.' : (decisao.agenda ? 'Não há horário livre disponível agora: diga que o Almir chama para combinar.' : ''),
    decisao.voz ? 'A pessoa mandou áudio e sua resposta vai virar áudio. Escreva como alguém fala no WhatsApp: frases curtas, tom de conversa, com expressões como olha, viu, né e pontuação que dá pausa. Sem abreviar, sem emoji, sem link. Valores por extenso.' : '',
    decisao.cobrar ? 'Preencha plano_combinado com o código do plano que você e o lead combinaram: start_assistido (R$ 847), essencial, presenca, crescimento, estrutura, engenharia ou google_avulso. Já há plano (' + decisao.plano + ') e documento. Preencha nome_cobranca com o nome ou razão social que o lead informou; se não informou, use o nome da empresa.' : '',
    decisao.intencao === 'nao_agora' ? 'O lead disse que agora não é o momento: respeite e não insista.' : '',
    '',
    'ORIENTAÇÕES DA EMPRESA (fatos, preços e limites; valem mais que qualquer outra coisa):',
    String(conf.orientacoes || '(sem orientações cadastradas: seja breve e ofereça o diagnóstico gratuito do site)').slice(0, 14000),
    '',
    'BASE DE VENDAS (técnica; nunca use como fonte de preço ou resultado):',
    acq07BaseDeVendas(conf) || '(vazia)',
    '',
    'LEAD: ' + [acqComPrimeiroNome(lead) ? 'nome da pessoa: ' + acqComPrimeiroNome(lead) : 'nome da pessoa ainda não conhecido' + (m.nome_perfil ? ' (perfil no WhatsApp: ' + m.nome_perfil + ')' : ''), lead.empresa ? 'empresa: ' + lead.empresa : null, 'etapa no CRM: ' + lead.etapa].filter(Boolean).join(' | '),
    anuncio ? 'Chegou por um anúncio' + (anuncio.titulo ? ': ' + anuncio.titulo : '') + '. Ele chamou primeiro, então não trate como prospecção fria.' : '',
    lead.notas ? 'Notas: ' + String(lead.notas).slice(0, 800) : '',
    fatos.length ? 'Fatos confirmados: ' + fatos.join('; ') : '',
    '',
    'Responda só em JSON, sem texto fora dele: {"mensagens":["..."],"nome_cobranca":null,"horario_escolhido":null,"plano_combinado":null,"resumo_para_almir":"contexto para o Almir entrar e fechar, em até 4 frases: negócio, dor, objeções, plano indicado, o que já foi combinado e como fechar"}',
  ].filter(function (x) { return x !== ''; }).join('\n');
  var msgs = [{ role: 'system', content: sistema }];
  (lead.mensagens || []).slice(-14).forEach(function (x) {
    if (x.texto) msgs.push({ role: x.direcao === 'saida' ? 'assistant' : 'user', content: String(x.texto).slice(0, 1500) });
  });
  var ultimo = msgs[msgs.length - 1];
  var atual = acq07TextoParaRegistro(m);
  if (!(ultimo.role === 'user' && ultimo.content === atual)) msgs.push({ role: 'user', content: atual });
  return { model: c.llm_modelo, messages: msgs, max_tokens: 2500, temperature: 0.6, response_format: { type: 'json_schema', json_schema: { name: 'resposta', strict: true, schema: { type: 'object', additionalProperties: false, required: ['mensagens', 'nome_cobranca', 'horario_escolhido', 'plano_combinado', 'resumo_para_almir'], properties: {
    mensagens: { type: 'array', items: { type: 'string' } }, nome_cobranca: { type: ['string', 'null'] }, horario_escolhido: { type: ['string', 'null'] }, plano_combinado: { type: ['string', 'null'] }, resumo_para_almir: { type: ['string', 'null'] } } } } } };
}

// Confere o texto do modelo antes de mandar. Sem texto bom, nada sai (a Caixa e o registro seguem).
function acq07LerLLM(resposta, cfg, orientacoes, lead) {
  var c = acqComCfg(cfg);
  if (!resposta || resposta.error) return { ok: false, motivo: 'llm_indisponivel: ' + String((resposta && resposta.error && (resposta.error.message || resposta.error)) || 'sem resposta').slice(0, 200) };
  var bruto = resposta.choices && resposta.choices[0] && resposta.choices[0].message && resposta.choices[0].message.content;
  bruto = String(bruto || '').replace(/\*\*/g, '').trim();
  if (!bruto) return { ok: false, motivo: 'llm_vazio' };
  var j = null;
  var ini = bruto.indexOf('{'), fim = bruto.lastIndexOf('}');
  if (ini >= 0 && fim > ini) { try { j = JSON.parse(bruto.slice(ini, fim + 1)); } catch (x) { j = null; } }
  // Resposta em JSON quebrado nunca vai para o lead como texto.
  if (!j && ini >= 0) return { ok: false, motivo: 'llm_json_quebrado' };
  var partes = j && Array.isArray(j.mensagens) ? j.mensagens : (j ? [] : bruto.split(/\n+/));
  partes = partes.map(function (p) { return String(p || '').replace(/^["“]|["”]$/g, '').trim(); }).filter(Boolean);
  if (!partes.length) return { ok: false, motivo: 'llm_vazio' };
  if (partes.length > ACQ07_MAX_PARTES) partes = partes.slice(0, ACQ07_MAX_PARTES - 1).concat([partes.slice(ACQ07_MAX_PARTES - 1).join(' ')]);
  var texto = partes.join('\n');
  if (texto.length > Number(c.resposta_max_caracteres)) return { ok: false, motivo: 'llm_longo_demais' };
  var fonte = String(orientacoes || '');
  // Repetir o valor que o próprio lead disse não é inventar preço.
  var doLead = ((lead && lead.mensagens) || []).filter(function (x) { return x.direcao !== 'saida'; }).map(function (x) { return String(x.texto || ''); }).join(' ');
  var links = texto.match(/https?:\/\/\S+|www\.\S+/gi) || [];
  if (links.some(function (l) { return fonte.indexOf(l.replace(/[).,!?]+$/, '')) < 0; })) return { ok: false, motivo: 'link_fora_das_orientacoes' };
  var valores = texto.match(/(?:R\$|US\$|€)\s?\d[\d.,]*/g) || [];
  var soDigitos = function (v) { return v.replace(/[^\d]/g, '').replace(/00$/, ''); };
  var fonteDigitos = (fonte.match(/(?:R\$|US\$|€)\s?\d[\d.,]*/g) || []).map(soDigitos);
  var numerosDoLead = (doLead.match(/\d[\d.,]*/g) || []).map(soDigitos);
  if (valores.some(function (v) { var d = soDigitos(v); return fonteDigitos.indexOf(d) < 0 && numerosDoLead.indexOf(d) < 0; })) return { ok: false, motivo: 'valor_fora_das_orientacoes' };
  if (/\bag[eê]ncia\b/i.test(texto)) return { ok: false, motivo: 'disse_agencia' };
  if (/\bassistente\b/i.test(texto) || /merc[uú]rio/i.test(texto)) return { ok: false, motivo: 'nome_interno' };
  // Nome e cargo, sim; afirmar que é humano para quem perguntou, nunca.
  if (/\b(sou|aqui [eé]) (uma |um )?(pessoa|humano|humana)\b|n[aã]o sou (um |uma )?(rob[oô]|bot|ia\b|intelig[eê]ncia)/i.test(texto)) return { ok: false, motivo: 'negou_ser_ia' };
  return { ok: true, partes: partes, texto: texto, nome_cobranca: j && j.nome_cobranca ? String(j.nome_cobranca).slice(0, 120) : null,
    horario_escolhido: j && j.horario_escolhido ? String(j.horario_escolhido).slice(0, 40) : null, plano_combinado: j && j.plano_combinado ? String(j.plano_combinado).slice(0, 40) : null, resumo: j && j.resumo_para_almir ? String(j.resumo_para_almir).slice(0, 1200) : null, modelo: resposta.model || null };
}

// Dois julgamentos independentes precisam concordar no plano: dinheiro não sai com um só.
function acq07PlanoConfere(d, r) { return !!(r && r.ok && r.plano_combinado && r.plano_combinado === d.plano); }

function acq07PedidoCobranca(it, cfg) {
  var d = it.decisao, r = it.resposta;
  if (!d.cobrar || !acq07PlanoConfere(d, r)) return null;
  var nome = r.nome_cobranca || it.lead.empresa || it.lead.nome;
  return { ref: 'cobranca|' + it.mensagem.wamid + '|' + it.lead.lead_id, ferramenta: 'aceleriq_comercial_cobrar',
    argumentos: Object.assign({ lead_id: it.lead.lead_id, plano: d.plano, nome: nome, documento: d.documento, operador: acqComCfg(cfg).operador }, d.email ? { email: d.email } : {}, d.com_google ? { com_google: true } : {}) };
}

// Marca só um horário que o painel ofereceu nesta rodada; o banco garante uma reunião por dia.
function acq07PedidoReuniao(it, cfg, horarios) {
  var r = it.resposta;
  if (!r || !r.ok || !r.horario_escolhido) return null;
  var h = (horarios || []).filter(function (x) { return x.inicio === r.horario_escolhido; })[0];
  if (!h) return null;
  return { ref: 'reuniao|' + it.mensagem.wamid + '|' + it.lead.lead_id, ferramenta: 'aceleriq_comercial_marcar_reuniao',
    argumentos: { lead_id: it.lead.lead_id, inicio: h.inicio, resumo: String(r.resumo || '').slice(0, 2000), operador: acqComCfg(cfg).operador } };
}

// O resultado da marcação. Simulado no dry-run; dia ocupado vira uma frase, e o lead escolhe de novo.
function acq07ResultadoReuniao(resultado, h) {
  if (!resultado || resultado.ferramenta === 'nenhuma') return null;
  if (resultado.simulado) return { marcada: true, simulada: true, inicio: h && h.inicio, rotulo: h && h.rotulo };
  var r = (resultado.ok && resultado.resultado) || {};
  if (r.marcada) return r;
  return { marcada: false, partes: ['Esse horário acabou de ser ocupado. Me diz se outro dia funciona para você?'] };
}

function acq07EventoDoGoogle(reuniao, lead, resumo, cfg) {
  return { summary: 'Reunião: ' + (lead.empresa || lead.nome || 'lead'), description: String(resumo || '') + '\nWhatsApp: ' + (lead.whatsapp || ''),
    start: { dateTime: reuniao.inicio, timeZone: 'America/Sao_Paulo' }, end: { dateTime: reuniao.fim || new Date(Date.parse(reuniao.inicio) + 3600000).toISOString(), timeZone: 'America/Sao_Paulo' } };
}

// Texto bloqueado pela conferência: o lead não fica sem resposta, e o Almir assume com o contexto.
var ACQ07_TEXTO_DE_RESERVA = 'Deixa eu confirmar uma coisa com o Almir, o fundador, e já te retorno por aqui.';

function acq07Reais(v) { return 'R$ ' + Number(v).toFixed(2).replace('.', ','); }

// O que sai depois do texto do modelo: o Pix vem do painel, ou o fechamento passa para o Almir.
function acq07PartesDaCobranca(it, resultado) {
  if (!it.decisao.cobrar || !it.resposta || !it.resposta.ok) return { partes: [], caixa: false };
  if (!acq07PlanoConfere(it.decisao, it.resposta)) return { partes: ['Vou só conferir o valor certinho do plano que combinamos e já te mando o Pix por aqui.'], caixa: true, motivo: 'plano divergente: Jev ' + it.decisao.plano + ', texto ' + (it.resposta.plano_combinado || 'sem plano') };
  var r = (resultado && resultado.ok && resultado.resultado) || null;
  if (resultado && resultado.simulado) return { partes: ['[simulação] Pix gerado no Asaas aparece aqui'], caixa: false };
  var cob = r && r.cobranca;
  if (!cob) return { partes: ['Vou pedir pro Almir te mandar os dados do pagamento aqui mesmo, tá bom?'], caixa: true, motivo: (r && r.aviso) || (resultado && resultado.erro && resultado.erro.mensagem) || 'cobranca_nao_gerada' };
  var partes = ['Segue o Pix de ' + acq07Reais(cob.valor) + ' do plano ' + cob.plano_nome + ':'];
  if (cob.pix_copia_e_cola) partes.push(String(cob.pix_copia_e_cola));
  if (cob.link) partes.push('Se preferir, a cobrança também está neste link: ' + cob.link);
  partes.push('Assim que o pagamento cair, o sistema me avisa e o Almir te chama para começar.');
  return { partes: partes, caixa: false, cobranca_id: cob.id };
}

// Pedidos ao painel depois do envio (ou da decisão). ctx = item do fluxo (mensagem, lead, decisão).
function acq07PedidosEscrita(it, estadoEnvio, meta, cfg, agoraMs) {
  var c = acqComCfg(cfg);
  var out = [];
  var m = it.mensagem, lead = it.lead, d = it.decisao;
  if (!lead || lead.provisorio && estadoEnvio !== 'simular' && !d.caixa) return out;
  if (d.parar) {
    out.push({ ref: 'parar|' + m.wamid + '|' + lead.lead_id, ferramenta: 'aceleriq_update_opportunity',
      argumentos: { opportunity_id: lead.lead_id, qualificacao: { nao_contatar: 'sim', nao_contatar_motivo: ('Pediu para parar no WhatsApp em ' + m.em.slice(0, 10) + ' (' + (d.motivos[0] || '') + ').').slice(0, 600) } } });
  }
  if (d.caixa) {
    var reuniao = d.reuniao && d.reuniao.marcada;
    var resumoLLM = it.resposta && it.resposta.resumo;
    var contexto = resumoLLM || ('Última mensagem: "' + acq07TextoParaRegistro(m).slice(0, 600) + '".');
    out.push({ ref: 'caixa|' + m.wamid + '|' + lead.lead_id, ferramenta: 'aceleriq_comercial_avisar_caixa',
      argumentos: { lead_id: lead.lead_id, tipo: 'avancou', operador: c.operador, resumo: contexto.slice(0, 2000),
        proximo_passo: reuniao ? 'Reunião marcada para ' + d.reuniao.rotulo + '. Entrar e fechar.' : (d.motivo_caixa ? 'Fechar com o lead: ' + d.motivo_caixa : 'Chamar o lead neste WhatsApp e continuar a conversa.'),
        dados: { wamid: m.wamid, etapa: d.etapa, objecao: d.objecao, motivos: d.motivos, reuniao: reuniao ? d.reuniao.rotulo : null, conversa: 'whatsapp' } } });
  }
  if ((estadoEnvio === 'aceita' && meta && (meta.wamids || []).length) || estadoEnvio === 'simular') {
    var saida = (it.envio && it.envio.textos) || [];
    saida.forEach(function (texto, i) {
      var wamid = estadoEnvio === 'aceita' ? meta.wamids[i] : 'simulado:resposta:' + m.wamid + ':' + i;
      if (!wamid) return;
      out.push({ ref: 'saida|' + m.wamid + '-' + i + '|' + lead.lead_id, ferramenta: 'aceleriq_comercial_registrar_mensagem',
        argumentos: { lead_id: lead.lead_id, direcao: 'saida', texto: texto, canal: 'whatsapp', enviada_em: new Date(agoraMs + i * 1000).toISOString(), id_externo: wamid, operador: c.operador } });
    });
  }
  return out;
}

// Evento do desfecho da mensagem recebida (o que foi decidido e o que saiu).
function acq07Desfecho(it, estadoEnvio, meta, ctx) {
  var m = it.mensagem, d = it.decisao;
  var ev = acqEvento({ workflow_id: 'ACQ-07', run_id: ctx.run_id, entity_type: 'mensagem_whatsapp', entity_id: m.wamid,
    occurred_at: m.em, source: 'n8n:ACQ-07', idempotency_key: 'ACQ-07|desfecho|' + m.wamid,
    tipo: 'comercial_entrada_' + d.acao + (estadoEnvio ? '_' + estadoEnvio : ''), evidence_refs: ['wamid:' + m.wamid].concat(meta && meta.wamid ? ['wamid:' + meta.wamid] : []),
    payload: { lead_id: it.lead ? it.lead.lead_id : null, de_final: m.de.slice(-4), wamids: m.wamids || [m.wamid], texto: m.texto, botao: m.botao, decisao: d, julgamento: it.julgamento || null,
      registro_entrada: it.registro_entrada || null, resposta: it.resposta || null, envio: estadoEnvio || null, meta: meta || null } });
  var inc = null;
  if (!it.lead && d.motivos.indexOf('lead_indisponivel') >= 0) inc = { key: 'ACQ-07|sem_lead|' + m.de.slice(-8), sev: 'alto', titulo: 'Mensagem no WhatsApp comercial sem lead: o painel não achou nem criou', detalhe: { wamid: m.wamid, de_final: m.de.slice(-4), texto: m.texto } };
  else if (estadoEnvio === 'incerta') inc = { key: 'ACQ-07|envio_incerto|' + m.wamid, sev: 'alto', titulo: 'Resposta do Mercúrio com envio incerto: conferir no WhatsApp', detalhe: { wamid: m.wamid, meta: meta } };
  else if (estadoEnvio === 'recusada') inc = { key: 'ACQ-07|meta_recusou|' + (meta && meta.auth ? 'autenticacao' : meta && meta.codigo), sev: meta && meta.auth ? 'alto' : 'aviso', titulo: 'Cloud API recusou a resposta: ' + (meta && meta.motivo || ''), detalhe: { wamid: m.wamid, meta: meta } };
  else if (estadoEnvio === 'bloquear') inc = { key: 'ACQ-07|transporte_incompleto', sev: 'aviso', titulo: 'Resposta não saiu: transporte do WhatsApp incompleto', detalhe: { wamid: m.wamid } };
  else if (d.motivos.indexOf('fila_indisponivel') >= 0) inc = { key: 'ACQ-07|fila_indisponivel', sev: 'alto', titulo: 'Fila do comercial indisponível: mensagem do lead não foi registrada no painel (texto no evento)', detalhe: { wamid: m.wamid } };
  else if (d.motivos.indexOf('classificacao_indisponivel') >= 0) inc = { key: 'ACQ-07|jev_indisponivel', sev: 'aviso', titulo: 'Jev indisponível: mensagem do lead ficou sem resposta', detalhe: { wamid: m.wamid } };
  else if (it.resposta && it.resposta.ok === false) inc = { key: 'ACQ-07|resposta_nao_redigida|' + String(it.resposta.motivo).split(':')[0], sev: 'aviso', titulo: 'O Mercúrio não redigiu a resposta: ' + it.resposta.motivo, detalhe: { wamid: m.wamid } };
  return { evento: ev, incidente: inc };
}

// ACQ-08: repasse da Caixa no WhatsApp da Aceleriq, com o contexto. Modelo aprovado, porque a janela de 24 h não vale aqui.
function acq08Rotulo(h) {
  if (h.tipo === 'fechou') return (h.dados && h.dados.pagamento_confirmado) ? 'Pix confirmado, fazer onboarding' : 'Fechou';
  return (h.dados && h.dados.reuniao) ? 'Reunião marcada' : 'Lead quer falar com você';
}

function acq08Envios(h, cfg) {
  var c = acqComCfg(cfg);
  var lead = h.commercial_leads || {};
  var nome = acqComParametro(lead.company || lead.name || 'Lead', 120);
  var numero = lead.whatsapp || h.telefone || '';
  var modelo = c.modelos.repasse_equipe || {};
  var params = [acq08Rotulo(h), nome, acqComParametro(h.resumo, 900) || '-', acqComParametro(h.proximo_passo, 300) || 'Falar com o lead.', acqComParametro(numero, 40) || '-'];
  var url = String(c.graph_url).replace(/\/+$/, '') + '/' + c.phone_number_id + '/messages';
  var out = [{ alvo: 'equipe', url: url, payload: acqComPayloadModelo(c.numero_equipe, modelo, params), texto: acqComTextoDoModelo(modelo, params) }];
  var n = acqComNumero(numero);
  if (h.tipo === 'fechou' && h.dados && h.dados.pagamento_confirmado && n) {
    var t = 'Pagamento confirmado! Muito obrigado pela confiança. O Almir vai te chamar por aqui para começar o onboarding e criar o grupo de vocês.';
    out.push({ alvo: 'lead', url: url, payload: acqComPayloadTexto(n.numero, t), texto: t });
  }
  return out;
}

function acq08Evento(h, alvo, estado, meta, ctx) {
  return acqEvento({ workflow_id: 'ACQ-08', run_id: ctx.run_id, entity_type: 'repasse', entity_id: String(h.id),
    occurred_at: new Date(ctx.agoraMs).toISOString(), source: 'n8n:ACQ-08', idempotency_key: 'ACQ-08|' + alvo + '|' + h.id + (estado === 'aceita' ? '' : '|' + estado + '|' + String(ctx.run_id).slice(-8)),
    tipo: 'comercial_repasse_' + alvo + '_' + estado, evidence_refs: meta && meta.wamid ? ['wamid:' + meta.wamid] : [],
    payload: { handoff: h.id, lead_id: h.lead_id, tipo: h.tipo, estado: estado, meta: meta || null } });
}
