// ACQ-06/ACQ-07 — base comum do comercial pelo WhatsApp oficial (Cloud API da Meta).
// JS puro; depende de nucleo.js e adaptador.js (acqDryRun). Nada aqui faz rede.
// O painel é a fonte da fila, das regras (horário, teto, nao_contatar) e da conversa; o n8n só
// transporta. Toda decisão sobre texto (intenção do lead) é do Jev; aqui ficam regras fixas.

var ACQ_COM_PADRAO = {
  operador: 'mercurio',
  graph_url: 'https://graph.facebook.com/v21.0',
  phone_number_id: null,
  waba_id: null,
  modelos: {},
  max_por_rodada: 5,
  retomada: { ativa: false, dias_sem_resposta: 4 },
  llm_url: 'https://openrouter.ai/api/v1/chat/completions',
  llm_modelo: 'anthropic/claude-sonnet-5.5',
  resposta_max_caracteres: 700,
  janela_horas: 24,
  limiar_pare: 0.4,
  exigir_assinatura: true,
};

function acqComCfg(cfg) {
  var c = Object.assign({}, ACQ_COM_PADRAO, (cfg && cfg.comercial) || {});
  c.modelos = c.modelos || {};
  c.retomada = Object.assign({}, ACQ_COM_PADRAO.retomada, c.retomada || {});
  return c;
}

// O transporte só liga quando o fluxo não está em dry-run, há phone_number_id e (para modelo)
// o modelo está marcado como aprovado na config. A credencial da Meta é conferida pela própria
// chamada: sem ela o nó HTTP falha e nada é marcado como enviado.
function acqComTransporte(cfg, workflowId, modelo) {
  var c = acqComCfg(cfg);
  if (acqDryRun(cfg, workflowId)) return { ao_vivo: false, decisao: 'simular', motivo: 'dry_run' };
  if (!c.phone_number_id) return { ao_vivo: false, decisao: 'bloquear', motivo: 'falta_phone_number_id' };
  if (modelo) {
    var m = c.modelos[modelo];
    if (!m || !m.nome) return { ao_vivo: false, decisao: 'bloquear', motivo: 'modelo_sem_nome:' + modelo };
    if (m.aprovado !== true) return { ao_vivo: false, decisao: 'bloquear', motivo: 'modelo_nao_aprovado:' + modelo };
  }
  return { ao_vivo: true, decisao: 'enviar', motivo: null };
}

// Número no formato que a Cloud API usa (só dígitos com DDI). Sem "+", 10 ou 11 dígitos = Brasil.
// fixo=true para número brasileiro de 8 dígitos começando com 2 a 5 (telefone fixo, sem WhatsApp).
function acqComNumero(bruto) {
  var s = String(bruto || '').trim();
  if (!s) return null;
  var internacional = /^\+/.test(s) || /^00/.test(s.replace(/\D/g, ''));
  var d = s.replace(/\D/g, '');
  if (/^00/.test(d)) d = d.slice(2);
  if (!internacional && (d.length === 10 || d.length === 11)) d = '55' + d;
  if (d.length < 10 || d.length > 15) return null;
  var fixo = false;
  if (d.indexOf('55') === 0 && (d.length === 12 || d.length === 13)) {
    var local = d.slice(4);
    fixo = d.length === 12 && /^[2-5]/.test(local);
  } else if (d.indexOf('55') === 0) {
    return null;
  }
  return { numero: d, fixo: fixo };
}

// O wa_id que a Meta manda pode vir sem o 9 do celular brasileiro: compara DDD + 8 últimos dígitos.
function acqComMesmoNumero(a, b) {
  var na = acqComNumero(a), nb = acqComNumero(b);
  if (!na || !nb) return false;
  if (na.numero === nb.numero) return true;
  if (na.numero.indexOf('55') === 0 && nb.numero.indexOf('55') === 0) {
    return na.numero.slice(2, 4) === nb.numero.slice(2, 4) && na.numero.slice(-8) === nb.numero.slice(-8);
  }
  return false;
}

// Parâmetro de modelo: a Meta recusa quebra de linha, tabulação e mais de 4 espaços seguidos.
function acqComParametro(texto, max) {
  var t = String(texto === undefined || texto === null ? '' : texto).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return t.slice(0, max || 200).trim();
}

function acqComNomeDoLead(item) {
  var n = acqComParametro(item && (item.empresa || item.nome), 60);
  return n.length >= 2 ? n : null;
}

// O fato observado que vai no primeiro contato. Ordem: o que alguém gravou de propósito
// (qualificacao.fato_observado), fato com prova sobre presença digital ou problema, a presença
// digital da ficha, e por fim o que a Máquina de leads registrou (sem site próprio nas fontes).
// Lead com site e sem fato gravado fica de fora: sem fato não há mensagem personalizada.
function acqComFatoObservado(item) {
  var q = (item && item.qualificacao) || {};
  var limpar = function (t) { var x = acqComParametro(t, 220).replace(/[.!;:,\s]+$/, ''); return x.length >= 8 && x.length <= 200 ? x : null; };
  var f = limpar(q.fato_observado);
  if (f) return { texto: f, fonte: 'qualificacao.fato_observado' };
  var fatos = ((item && item.fatos) || []).filter(function (x) {
    // Sugestão ainda não confirmada não vira mensagem: um fato errado dito ao dono da empresa queima o contato.
    return x && ['presenca_digital', 'problema'].indexOf(x.campo) >= 0 && x.situacao === 'gravado';
  });
  for (var i = 0; i < fatos.length; i++) {
    var v = limpar(fatos[i].valor);
    if (v) return { texto: v, fonte: 'fato:' + fatos[i].campo };
  }
  var p = limpar(q.presenca_digital);
  if (p) return { texto: p, fonte: 'qualificacao.presenca_digital' };
  if (q.fonte === 'maquina_de_leads' && !q.site) {
    return q.instagram
      ? { texto: 'vocês têm Instagram, mas não encontrei um site próprio da empresa', fonte: 'maquina:sem_site_com_instagram' }
      : { texto: 'não encontrei um site próprio da empresa nas buscas', fonte: 'maquina:sem_site' };
  }
  return null;
}

// Texto do modelo com as variáveis, exatamente como o lead vai ler (é o que vai para a conversa).
function acqComTextoDoModelo(modelo, params) {
  var corpo = String((modelo && modelo.corpo) || '');
  return corpo.replace(/\{\{(\d+)\}\}/g, function (_, n) { return params[Number(n) - 1] === undefined ? '' : params[Number(n) - 1]; });
}

function acqComPayloadModelo(numero, modelo, params) {
  return {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: numero, type: 'template',
    template: { name: modelo.nome, language: { code: modelo.idioma || 'pt_BR' },
      components: [{ type: 'body', parameters: params.map(function (p) { return { type: 'text', text: p }; }) }] },
  };
}

function acqComPayloadTexto(numero, texto) {
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to: numero, type: 'text', text: { preview_url: false, body: texto } };
}

// Resposta do nó HTTP da Meta (fullResponse + neverError) ou o erro do nó (onError continue).
// aceita: a Meta devolveu o id da mensagem (wamid). recusada: a Meta disse não (nada saiu; pode
// tentar outro dia). incerta: não dá para saber se saiu (timeout, 5xx): nunca reenviar sozinho.
function acqComClassificarMeta(httpJson) {
  var r = { resultado: 'incerta', wamid: null, http_status: null, codigo: null, motivo: null, auth: false };
  if (!httpJson) { r.motivo = 'sem_resposta'; return r; }
  if (httpJson.error && httpJson.statusCode === undefined && httpJson.body === undefined) {
    var e = httpJson.error;
    var st = Number((e && (e.httpCode || e.status || e.statusCode)) || 0);
    r.http_status = st || null;
    r.motivo = String((e && (e.message || e.description)) || 'erro_do_no').slice(0, 300);
    if (st === 401 || st === 403) { r.resultado = 'recusada'; r.auth = true; return r; }
    if (st >= 400 && st < 500 && st !== 408) { r.resultado = 'recusada'; return r; }
    return r;
  }
  var st2 = Number(httpJson.statusCode || 0);
  var corpo = httpJson.body !== undefined ? httpJson.body : httpJson;
  if (typeof corpo === 'string') { try { corpo = JSON.parse(corpo); } catch (x) { corpo = null; } }
  r.http_status = st2 || null;
  var erro = corpo && corpo.error;
  if (erro) {
    r.codigo = erro.code === undefined ? null : erro.code;
    r.motivo = String(erro.message || 'erro').slice(0, 300) + (erro.error_data && erro.error_data.details ? ' | ' + String(erro.error_data.details).slice(0, 200) : '');
  }
  if (st2 >= 200 && st2 < 300 && corpo && corpo.messages && corpo.messages[0] && corpo.messages[0].id) {
    r.resultado = 'aceita'; r.wamid = String(corpo.messages[0].id); r.motivo = null; return r;
  }
  if (st2 === 401 || r.codigo === 190 || r.codigo === 10 || r.codigo === 200) { r.resultado = 'recusada'; r.auth = true; r.motivo = r.motivo || 'HTTP ' + st2; return r; }
  if (st2 === 429 || r.codigo === 4 || r.codigo === 80007 || r.codigo === 130429) { r.resultado = 'recusada'; r.motivo = r.motivo || 'limite_de_envio'; return r; }
  if (st2 >= 400 && st2 < 500) { r.resultado = 'recusada'; r.motivo = r.motivo || 'HTTP ' + st2; return r; }
  r.motivo = r.motivo || (st2 ? 'HTTP ' + st2 : 'resposta_sem_id');
  return r;
}

// Dia útil (seg a sex) e horário do comercial em São Paulo. Feriados não são conferidos aqui.
function acqComNoHorario(agoraMs, inicio, fim) {
  var sp = acqAgoraSP(agoraMs);
  var hhmm = (sp.hora < 10 ? '0' : '') + sp.hora + ':' + (sp.minuto < 10 ? '0' : '') + sp.minuto;
  var ini = String(inicio || '09:00').slice(0, 5), f = String(fim || '18:00').slice(0, 5);
  return { dia_util: sp.dia_semana >= 1 && sp.dia_semana <= 5, dentro: hhmm >= ini && hhmm < f, hora: hhmm, data: sp.data };
}

// Horário da config do painel ("09:00 a 18:00 (Sao Paulo)") → [inicio, fim].
function acqComHorarioDaFila(config) {
  var m = /(\d{2}:\d{2})\D+(\d{2}:\d{2})/.exec(String((config && config.horario) || ''));
  return m ? [m[1], m[2]] : ['09:00', '18:00'];
}

function acqComNaoContatar(item) {
  var q = (item && item.qualificacao) || {};
  return item && (item.nao_contatar === true || q.nao_contatar === true || q.nao_contatar === 'sim' || q.nao_contatar === 'true');
}

// Resultado de uma escrita no painel (saída do ACQ-00). ref = "<acao>|<id>|<lead_id>".
// Evento sempre; incidente quando falhou (alto se a mensagem já tinha saído pela Meta ou era um "pare").
function acqComResultadoEscrita(wf, r, ctx) {
  if (!r || r.ferramenta === 'nenhuma' || r.motivo === 'nada_a_fazer') return null;
  var partes = String(r.ref || '').split('|');
  var acao = partes[0] || 'escrita', id = partes[1] || 'sem_id', lead = partes[2] || null;
  var msgErro = String((r.erro && r.erro.mensagem) || '');
  var ok = r.ok === true || /Ja existe um aviso/i.test(msgErro);
  var sim = r.simulado === true;
  var ev = acqEvento({ workflow_id: wf, run_id: ctx.run_id, entity_type: 'lead', entity_id: lead || 'sem_lead',
    occurred_at: new Date(ctx.agoraMs).toISOString(), source: 'n8n:' + wf,
    idempotency_key: (wf + '|escrita|' + acao + '|' + id + (ok ? '' : '|falhou|' + String(ctx.run_id).slice(-8))).slice(0, 200),
    tipo: 'comercial_escrita_' + acao + '_' + (sim ? 'simulada' : ok ? 'ok' : 'falhou'), evidence_refs: [String(r.ferramenta)],
    payload: { ferramenta: r.ferramenta, ok: ok, simulado: sim, erro: r.erro || null, resultado: sim ? null : r.resultado,
      argumentos: r._req && r._req.argumentos ? r._req.argumentos : null } });
  var grave = ['registro', 'saida', 'parar'].indexOf(acao) >= 0;
  var inc = ok ? null : { key: (wf + '|escrita_falhou|' + acao + '|' + id).slice(0, 200), sev: grave ? 'alto' : 'aviso',
    titulo: (acao === 'parar' ? 'Pedido para parar NÃO foi gravado no painel (nao_contatar)' : acao === 'caixa' ? 'Aviso na Caixa do comercial falhou'
      : 'Mensagem saiu pela Meta mas não foi registrada no painel') + ': ' + msgErro.slice(0, 120),
    detalhe: { lead_id: lead, id: id, ferramenta: r.ferramenta, erro: r.erro || null } };
  return { evento: ev, incidente: inc };
}

// Parâmetros do nó Postgres que grava evento + incidente (+ contexto devolvido pela própria consulta).
function acqComPgEvento(evento, incidente, ambiente, contexto) {
  var p = [evento ? JSON.stringify(evento) : null, ambiente, incidente ? incidente.key : null, incidente ? incidente.sev : 'info',
    incidente ? String(incidente.titulo).slice(0, 300) : '', JSON.stringify(incidente ? incidente.detalhe || {} : {})];
  if (contexto !== undefined) p.push(JSON.stringify(contexto));
  return p;
}
