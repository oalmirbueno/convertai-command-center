// ACQ-04 — Conversas e áudios para o Hermes (JS puro; depende de nucleo.js).
// O Jev (TypeSafe) dá julgamentos tipados sobre a linguagem; identidade, papel, datas,
// autorização e execução ficam nestas regras. Saída tipada não garante verdade.

var ACQ04_JANELA_ASSINATURA_MS = 5 * 60 * 1000;

// Formato de teste e um formato no estilo da Cloud API (entry/changes/value/messages).
function acq04Normalizar(corpo, provedor, agoraMs) {
  var erros = [];
  var msgs = [];
  if (corpo && Array.isArray(corpo.entry)) {
    corpo.entry.forEach(function (e) {
      (e.changes || []).forEach(function (ch) {
        var v = ch.value || {};
        (v.messages || []).forEach(function (m) {
          msgs.push({ provider_message_id: m.id, group_id: m.group_id || (m.context && m.context.group_id) || null, remetente: m.from,
            occurred_at: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : null, tipo: m.type === 'text' ? 'texto' : m.type === 'audio' ? 'audio' : 'outro',
            texto: m.text ? m.text.body : null, media_id: m.audio ? m.audio.id : null });
        });
      });
    });
  } else if (corpo && corpo.mensagem) {
    var m = corpo.mensagem;
    msgs.push({ provider_message_id: m.id, group_id: m.grupo, remetente: m.de, occurred_at: m.em, tipo: m.tipo || 'texto', texto: m.texto || null, media_id: m.media_id || null });
  } else {
    erros.push('formato_desconhecido');
  }
  var validas = [];
  msgs.forEach(function (m) {
    var falta = ['provider_message_id', 'remetente', 'occurred_at'].filter(function (k) { return !m[k]; });
    if (falta.length) { erros.push('campos_ausentes:' + falta.join(',')); return; }
    if (isNaN(Date.parse(m.occurred_at))) { erros.push('data_invalida'); return; }
    if (Date.parse(m.occurred_at) > agoraMs + ACQ04_JANELA_ASSINATURA_MS) { erros.push('mensagem_no_futuro'); return; }
    m.provedor = provedor;
    validas.push(m);
  });
  return { mensagens: validas, erros: erros };
}

// Proteção de repetição do webhook: timestamp do cabeçalho dentro da janela.
function acq04ConferirCarimbo(carimbo, agoraMs) {
  var t = Number(carimbo) * (String(carimbo).length <= 10 ? 1000 : 1);
  if (!isFinite(t)) return { ok: false, motivo: 'carimbo_ausente' };
  if (Math.abs(agoraMs - t) > ACQ04_JANELA_ASSINATURA_MS) return { ok: false, motivo: 'carimbo_fora_da_janela' };
  return { ok: true };
}

// Agrupamento: mensagens do mesmo remetente no mesmo grupo a até 3 minutos formam um trecho.
function acq04Agrupar(msg, recentes) {
  var t = Date.parse(msg.occurred_at);
  var trecho = (recentes || []).filter(function (r) {
    return r.group_id === msg.group_id && r.remetente === msg.remetente && r.provider_message_id !== msg.provider_message_id &&
      Math.abs(Date.parse(r.occurred_at) - t) <= 3 * 60000 && r.estado !== 'descartada';
  }).sort(function (a, b) { return Date.parse(a.occurred_at) - Date.parse(b.occurred_at); });
  return trecho.concat([msg]);
}

function acq04TextoDaMensagem(m) {
  if (m.tipo === 'audio') return m.transcricao_status === 'ok' ? m.transcricao : null;
  return m.texto;
}

// Pedido ao Jev: uma chamada, perguntas independentes sobre o mesmo estado.
function acq04PedidoJev(trecho, contexto) {
  var abertas = (contexto.perguntas_abertas || []).slice(0, 20);
  var criteriosPergunta = { nenhuma: 'O trecho não responde a nenhuma das perguntas abertas listadas.' };
  abertas.forEach(function (p) { criteriosPergunta[p.id] = p.pergunta; });
  return {
    model: 'jev-latest',
    state: {
      cliente: contexto.nome_cliente || null,
      trecho: trecho.map(function (m) { return { quem: m.papel || 'desconhecido', quando: m.occurred_at, texto: acq04TextoDaMensagem(m) || '' }; }),
      perguntas_abertas: abertas.map(function (p) { return { id: p.id, pergunta: p.pergunta }; }),
    },
    questions: {
      tipo: { type: 'choice', instructions: 'Qual é a função principal do último trecho de `trecho` numa conversa entre agência de marketing e cliente?',
        criteria: {
          pedido: 'Pede que algo seja feito, enviado, alterado ou produzido.',
          resposta: 'Responde a uma pergunta feita antes ou fornece um dado que foi solicitado.',
          decisao: 'Escolhe, aprova, autoriza ou recusa algo.',
          correcao: 'Corrige uma informação, texto ou entendimento anterior.',
          informacao: 'Informa um fato novo sem pedir, decidir ou responder.',
          ruido: 'Cumprimento, agradecimento, emoji ou conversa social sem conteúdo de trabalho.',
        } },
      responde: { type: 'choice', instructions: 'Qual das perguntas abertas em `perguntas_abertas` o trecho responde diretamente?', criteria: criteriosPergunta },
      autoriza: { type: 'noul', instructions: 'O trecho expressa autorização ou aprovação para a agência executar algo?' },
      objeto_claro: { type: 'noul', instructions: 'Supondo que haja autorização no trecho, ela nomeia de forma inequívoca o que está autorizado (uma peça, campanha, valor, data ou publicação específica), sem depender de mensagens que não estão no trecho?' },
      sensivel: { type: 'noul', instructions: 'O trecho envolve dinheiro, verba de anúncios, pagamento, contratação, campanha paga ou publicação em nome do cliente?' },
    },
  };
}

function acq04LerJev(resposta) {
  var a = (resposta && resposta.answers) || {};
  var ok = a.tipo && a.responde && a.autoriza && a.objeto_claro && a.sensivel;
  if (!ok) return null;
  // Noul vem no campo `noul` (0 = não, 1 = sim). Resposta fora do contrato → null (vai para pessoa).
  var n = function (x) { return typeof x.noul === 'number' ? x.noul : null; };
  var out = { tipo: a.tipo.choice, tipo_confianca: a.tipo.confidence, responde: a.responde.choice, responde_confianca: a.responde.confidence,
    p_autoriza: n(a.autoriza), p_objeto_claro: n(a.objeto_claro), p_sensivel: n(a.sensivel), modelo: resposta.model || null };
  if (out.p_autoriza === null || out.p_objeto_claro === null || out.p_sensivel === null || typeof out.tipo !== 'string') return null;
  return out;
}

// Regras explícitas. Nada aprova, paga, publica ou altera campanha por mensagem/áudio.
function acq04Decidir(msg, julg, ctx) {
  var d = { destino: null, motivos: [], aprovacao_automatica: false };
  if (msg.papel === 'bot') { d.destino = 'descartar'; d.motivos.push('mensagem_do_proprio_bot'); return d; }
  if (!msg.client_id) { d.destino = 'revisao'; d.motivos.push('grupo_sem_vinculo_aprovado'); return d; }
  if (!msg.papel) { d.destino = 'revisao'; d.motivos.push('remetente_desconhecido'); return d; }
  if (msg.tipo === 'audio' && msg.transcricao_status !== 'ok') { d.destino = 'pendencia'; d.motivos.push('audio_' + msg.transcricao_status); return d; }
  if (!julg) { d.destino = 'revisao'; d.motivos.push('classificacao_indisponivel'); return d; }
  if (julg.tipo === 'ruido' && julg.tipo_confianca >= 0.6) { d.destino = 'descartar'; d.motivos.push('sem_conteudo_de_trabalho'); return d; }
  var autoriza = julg.p_autoriza >= 0.5;
  if (autoriza || julg.tipo === 'decisao') {
    d.destino = 'revisao';
    d.motivos.push('possivel_autorizacao_nunca_automatica');
    if (msg.papel !== 'cliente_decisor') d.motivos.push('autor_sem_papel_de_decisor');
    if (julg.p_objeto_claro < 0.7) d.motivos.push('objeto_da_autorizacao_indefinido');
    if (julg.p_sensivel >= 0.5) d.motivos.push('tema_sensivel_dinheiro_campanha_publicacao');
    return d;
  }
  // Dinheiro, verba, campanha paga ou publicação: sempre pessoa (inclusive "já paguei", que precisa de conferência).
  if (julg.p_sensivel >= 0.5) { d.destino = 'revisao'; d.motivos.push(julg.tipo === 'pedido' ? 'pedido_sensivel' : 'informacao_sensivel_a_conferir'); return d; }
  if (julg.responde !== 'nenhuma' && julg.responde_confianca >= 0.6) { d.destino = 'proposta_contexto'; d.motivos.push('responde_pergunta_aberta'); return d; }
  if (julg.tipo === 'pedido') { d.destino = 'handoff'; d.motivos.push('pedido_para_mesa'); return d; }
  if (julg.tipo === 'correcao' || julg.tipo === 'informacao' || julg.tipo === 'resposta') { d.destino = 'proposta_contexto'; d.motivos.push(julg.tipo); return d; }
  d.destino = 'revisao'; d.motivos.push('baixa_confianca');
  return d;
}

// Proposta versionada para o Hermes: trecho com evidência; nunca "confirmado pelo dono".
function acq04Proposta(msg, trecho, julg, decisao, ctx) {
  return {
    client_id: msg.client_id,
    origem: { provedor: msg.provedor, group_id: msg.group_id, provider_message_ids: trecho.map(function (m) { return m.provider_message_id; }) },
    autor: { remetente: msg.remetente, papel: msg.papel },
    ocorrido_em: msg.occurred_at,
    recebido_em: msg.received_at || null,
    evidencia: trecho.map(function (m) { return { id: m.provider_message_id, quando: m.occurred_at, texto: acq04TextoDaMensagem(m), media_hash: m.media_hash || null }; }),
    classificacao: julg,
    destino: decisao.destino,
    motivos: decisao.motivos,
    pergunta_relacionada: julg && julg.responde !== 'nenhuma' ? julg.responde : null,
    base_dossie_versao: ctx.dossie_versao || null,
    status: 'proposta_nao_confirmada',
  };
}
