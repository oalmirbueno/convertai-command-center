// ACQ-11 — Mensagem da semana no grupo do cliente (JS puro; depende de nucleo.js, adaptador.js e wf01.js).
// Segunda (início), quarta (meio) e sexta (fechamento). O texto vem do escritor da Central; o Jev confere contra as
// fontes (dossiê atual e resumos das conversas) e contra as últimas mensagens enviadas. Só o que passa vira pedido na
// Revisão do Ciclo com o grupo como destino; o envio é do script do servidor. O que não passa fica como rascunho e
// vira aviso para o dono. Nada aqui envia mensagem.

var ACQ11_AUTOR = 'n8n:ACQ-11';
var ACQ11_LIMITES = { apoiada: 0.6, numeros: 0.6, promessa: 0.4, interno: 0.4, repete: 0.5 };

function acq11Config(cfg) {
  var m = (cfg && cfg.mensagem_semana) || {};
  var grupos = (cfg && cfg.post_no_ar && cfg.post_no_ar.grupos) || {};
  return { ativo: m.ativo === true, grupos: grupos, operador: (cfg && cfg.operador) || 'default', fora: m.clientes_fora || [] };
}

function acq11Clientes(cfg, clientePedido) {
  var c = acq11Config(cfg);
  return Object.keys(c.grupos).filter(function (id) { return c.fora.indexOf(id) < 0 && (!clientePedido || clientePedido === id); })
    .map(function (id) { return { client_id: id, grupo: c.grupos[id] }; });
}

// Quem recebe texto nesta rodada. Quem já recebeu a mensagem deste dia (pela Central, à mão ou por aqui) fica de fora,
// e quem já tem rascunho deste fluxo na semana também: repetir a rodada não paga o modelo de novo nem duplica.
function acq11Triagem(alvos) {
  var escrever = [], fora = [];
  (alvos || []).forEach(function (a) {
    var motivo = !a.ativo ? 'cliente_inativo' : a.ja_enviada ? 'ja_enviada' : a.ja_escrita ? 'ja_escrita' : !a.project_id ? 'sem_projeto'
      : !a.dossie || String(a.dossie).trim().length < 200 ? 'sem_dossie' : !a.grupo ? 'sem_grupo' : null;
    if (motivo) fora.push({ client_id: a.client_id, cliente: a.cliente, motivo: motivo }); else escrever.push(a);
  });
  return { escrever: escrever, fora: fora };
}

function acq11Rpc(ferramenta, argumentos, semente) {
  return { jsonrpc: '2.0', id: acqSha256(ferramenta + '|' + semente).slice(0, 12), method: 'tools/call', params: { name: ferramenta, arguments: argumentos } };
}

// Palavras que nunca vão ao cliente (regra fixa, antes e além do Jev).
function acq11TextoProibido(t) {
  var s = String(t || '');
  if (/(^|[^A-Za-zÀ-ÿ])ritua(l|is)([^A-Za-zÀ-ÿ]|$)/i.test(s)) return 'palavra_ritual';
  if (/(^|[^A-Za-zÀ-ÿ])(dossi[êe]s?|hermes|n8n|jev|mcp|clio|grok|bot|payload|dry.?run)([^A-Za-zÀ-ÿ]|$)/i.test(s)) return 'termo_interno';
  // Dos anúncios vai só o número de contatos (Almir, 11/11): valor investido, verba e custo por contato não saem sozinhos.
  if (/R\$\s?\d[^.\n]{0,40}(investid|de investimento|de verba|por contato|gast[oa])|(investid\w*|investimento|verba|custo por contato)[^.\n]{0,40}R\$\s?\d/i.test(s)) return 'valor_investido';
  if (s.trim().length < 80) return 'curto_demais';
  if (s.length > 1800) return 'longo_demais';
  return null;
}

// Formato que o dono exige em todo texto ao cliente (10/11/2026): hierarquia com título em negrito, blocos separados
// por linha em branco e nenhum travessão. O escritor da Central já entrega assim; aqui é a trava.
function acq11Formato(t) {
  var s = String(t || '');
  if (/[\u2014\u2013]/.test(s)) return 'travessao';
  if (!/\*[^*\s][^*\n]*\*/.test(s)) return 'sem_negrito';
  if (s.trim().split(/\n[ \t]*\n/).length < 3) return 'sem_espacamento';
  return null;
}

// No grupo a mensagem fala com o time, não com uma pessoa pelo nome (Almir, 11/11): "Bom dia, Priscila." vira "Bom dia, time."
function acq11Saudacao(corpo) {
  return String(corpo || '').replace(/^(Bom dia|Boa tarde|Boa noite|Olá|Oi)(?:,\s*[^.!?\n]{1,40})?([.!])/i, function (_, s, p) { return s + ', time' + p; });
}

// Resposta do escritor (já interpretada pelo adaptador) -> texto ou motivo.
function acq11LerTexto(r) {
  var res = r && r.ok ? r.resultado : null;
  if (!res || res.ok !== true || !res.body || !String(res.body).trim()) {
    return { ok: false, motivo: !r ? 'sem_resposta' : !r.ok ? 'erro_' + ((r.erro && r.erro.tipo) || 'desconhecido') : String((res && res.motivo) || 'texto_vazio').slice(0, 120) };
  }
  return { ok: true, title: String(res.title || '').slice(0, 200), body: acq11Saudacao(String(res.body).trim()), next_steps: String(res.next_steps || '').trim(),
    alertas: (res.alertas || []).slice(0, 6), repeticao: res.repeticao || null, model: res.model || null, custo_usd: typeof res.custo_usd === 'number' ? res.custo_usd : null, dossie_versao: res.dossie_versao || null,
    fontes: { estado_real: String((res.fontes && res.fontes.estado_real) || '').slice(0, 12000), continuidade: String((res.fontes && res.fontes.continuidade) || '').slice(0, 20000),
      dia_prioritario: String((res.fontes && res.fontes.dia_prioritario) || '').slice(0, 1500) } };
}

// Frases da mensagem que afirmam alguma coisa: fora os títulos em negrito e a linha do painel.
function acq11Frases(corpo) {
  var out = [];
  String(corpo || '').split('\n').forEach(function (l) {
    var t = l.trim();
    if (!t || /^\*[^*]+\*:?$/.test(t) || /aceleriq\.online/.test(t)) return;
    t.split(/(?<=[.!?;])\s+/).forEach(function (f) { if (f.replace(/[^A-Za-zÀ-ÿ]/g, '').length > 12) out.push(f); });
  });
  return out.slice(0, 24);
}

// Evidência para a conferência: o estado real e o histórico, sem os rascunhos que nunca foram enviados (um rascunho
// com fato inventado não pode servir de prova para o texto seguinte).
function acq11Evidencia(texto, alvo) {
  var f = texto.fontes || {};
  var historico = String(f.continuidade || '').replace(/\n- \d\d\/\d\d \d\d:\d\d · [^\n]*rascunho não enviado[\s\S]*?(?=\n- \d\d\/\d\d \d\d:\d\d · |\n\n|$)/g, '');
  return { numeros_e_andamento: f.estado_real || '', historico_das_mensagens: historico, dia_prioritario: f.dia_prioritario || '',
    conversas_do_grupo: ((alvo && alvo.conversas) || []).map(function (c) { return { dia: c.dia, resumo: c.texto }; }) };
}

// Tira frases do corpo sem mexer em título nem na linha do painel; bloco que fica só com o título sai junto.
function acq11Tirar(corpo, descartar) {
  var titulo = /^\*[^*]+\*:?$/;
  var linhas = String(corpo || '').split('\n').map(function (l) {
    var t = l.trim();
    if (!t || titulo.test(t) || /aceleriq\.online/.test(t)) return l;
    var s = t.split(/(?<=[.!?;])\s+/).filter(function (f) { return !descartar(f); }).join(' ').replace(/;$/, '.');
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  });
  return linhas.join('\n').split(/\n[ \t]*\n/).map(function (b) { return b.split('\n').filter(function (x) { return x.trim(); }).join('\n'); })
    .filter(function (b) { return b && !titulo.test(b.trim()); }).join('\n\n');
}

function acq11Contem(frase, n) {
  return new RegExp('(^|[^0-9.,/])' + String(n).replace(/[.]/g, '[.]') + '(?![0-9]|[.,/][0-9])').test(String(frase || ''));
}

// Regra do dono (11/11): número só pelo lado positivo. Frase de zero contato sai; comparação em que o número caiu
// perde a comparação ("chegaram 4 contatos, contra 9 de ..." vira "chegaram 4 contatos").
function acq11SoPositivo(corpo) {
  var s = acq11Tirar(corpo, function (f) { return /(^|[^0-9.,\/])0 (contatos?|conversas?|pedidos?|mensagens?)(?![0-9])|nenhum (contato|pedido)|sem investimento/i.test(f); });
  return s.replace(/(\d[\d.]*)( [^\d.;!?\n]{0,40}?)?,? (contra|ante) (\d[\d.]*)([^.;!?\n]*)/g, function (tudo, a, meio, _c, b) {
    var x = Number(String(a).replace(/\./g, '')), y = Number(String(b).replace(/\./g, ''));
    return x < y ? a + (meio || '') : tudo;
  });
}

// Número e data são busca exata, não julgamento: todo número da mensagem precisa existir na evidência.
function acq11NumerosFora(corpo, evidencia) {
  var base = ' ' + JSON.stringify(evidencia || {}) + ' ', fora = [];
  var msg = String(corpo || '').split('\n').filter(function (l) { return !/aceleriq\.online/.test(l); }).join('\n');
  (msg.match(/\d+(?:[.,\/]\d+)*/g) || []).forEach(function (n) {
    if (acq11Contem(base, n) || fora.indexOf(n) >= 0) return;
    // dia solto antes de uma data ("de 07 a 13/11", "sábados 14 e 21 e domingos 15 e 22/11") vale se dd/mm está na evidência
    if (/^\d{1,2}$/.test(n)) {
      var m = msg.match(new RegExp('(^|[^0-9/.,])' + n + '(?![0-9/.,])[^.!?]{0,60}?[0-9]{1,2}/([0-9]{2})'));
      if (m && base.indexOf(('0' + n).slice(-2) + '/' + m[2]) >= 0) return;
    }
    fora.push(n);
  });
  return fora;
}

// Conferência no Jev: uma pergunta por frase (apoia, contradiz ou não fala) contra a evidência enxuta, mais três
// perguntas sobre a mensagem inteira. Um "tudo está apoiado" único sobre 40 mil caracteres reprovava até texto certo.
function acq11PedidoConferencia(texto, alvo) {
  var frases = acq11Frases(texto.body);
  var perguntas = {};
  frases.forEach(function (f, i) {
    perguntas['f' + i] = { type: 'choice', instructions: 'Como `evidencia` se relaciona com o que `afirmacoes[' + i + ']` afirma como fato sobre o trabalho feito para o cliente, seus números, datas e andamento?',
      criteria: { apoia: 'A evidência registra o fato, o número ou a data, ou o implica diretamente. Também vale quando a frase só cumprimenta, convida, comenta ou diz o que a agência pretende fazer com base em uma tarefa prevista na evidência.',
        contradiz: 'A evidência registra algo diferente: outro número, outra data ou outro estado (por exemplo, a frase diz pronto ou publicado e a evidência mostra apenas previsto ou em produção).',
        nao_fala: 'A evidência não registra o que a frase afirma.' } };
    // as mesmas duas perguntas da mensagem inteira, frase a frase, para localizar o que cortar
    perguntas['p' + i] = { type: 'noul', instructions: '`afirmacoes[' + i + ']` promete ou garante ao cliente um resultado futuro de negócio (mais vendas, clientes, contatos, crescimento, alcance ou retorno como coisa certa)?' };
    perguntas['b' + i] = { type: 'noul', instructions: '`afirmacoes[' + i + ']` expõe bastidor interno da agência (nome de sistema, ferramenta, agente ou robô, automação, rotina ou etapa interna, cota de tarefas da equipe, nome técnico de campanha)?' };
  });
  return { model: 'jev-latest',
    state: { cliente: alvo.cliente, mensagem: texto.body, afirmacoes: frases, evidencia: acq11Evidencia(texto, alvo), mensagens_anteriores: alvo.anteriores || [] },
    questions: Object.assign(perguntas, {
      promessa: { type: 'noul', instructions: '`mensagem` promete ou garante ao cliente um resultado futuro de negócio?',
        criteria: { 'true': 'Afirma como certo um ganho que ainda não aconteceu: mais vendas, mais clientes, mais contatos, crescimento, alcance ou retorno ("vai trazer", "vai aumentar", "garante", "com certeza").',
          'false': 'Só relata o que já aconteceu, diz o que a agência vai fazer ou entregar, ou explica para que serve uma peça ("para orientar", "ajuda quem avalia", "pode abrir conversas") sem garantir o resultado.' } },
      interno: { type: 'noul', instructions: '`mensagem` expõe ao cliente algum bastidor interno da agência?',
        criteria: { 'true': 'Cita nome de sistema ou ferramenta de trabalho da equipe, nome de agente ou robô, automação, etapa ou rotina interna, nome técnico de campanha ou de conjunto de anúncios, ou sigla que só a equipe usa.',
          'false': 'Fala só do negócio do cliente em linguagem comum: anúncios, contatos, valor investido, público, raio em quilômetros, bairro, arte, vídeo, post, aprovação, Instagram, WhatsApp e o painel onde o cliente acompanha.' } },
      repete: { type: 'noul', instructions: '`mensagem` diz essencialmente o mesmo que alguma das `mensagens_anteriores`, sem trazer avanço ou informação nova em relação a elas?' },
    }) };
}

// Nota de apoio = a frase mais fraca. Falta de resposta para qualquer frase = sem conferência.
function acq11Apoio(resposta, corpo) {
  var frases = acq11Frases(corpo), menor = 1, fraca = null;
  if (!frases.length) return { nota: null, fraca: null };
  for (var i = 0; i < frases.length; i++) {
    var a = resposta && resposta.answers && resposta.answers['f' + i];
    var p = a && a.probabilities && typeof a.probabilities.apoia === 'number' ? a.probabilities.apoia : null;
    if (p === null) return { nota: null, fraca: null };
    if (p < menor) { menor = p; fraca = frases[i]; }
  }
  return { nota: Math.round(menor * 100) / 100, fraca: menor < ACQ11_LIMITES.apoiada ? String(fraca).slice(0, 200) : null };
}

function acq11Noul(resposta, chave) {
  var a = resposta && resposta.answers && resposta.answers[chave];
  return a && typeof a.noul === 'number' ? Math.round(a.noul * 100) / 100 : null;
}

// Veredito com reparo (13/11, o dono: "tem que mandar todos e não só metade"): frase sem apoio, com número fora das
// fontes, com promessa ou com bastidor SAI do texto, e o que sobra segue. Só corta, nunca acrescenta. A mensagem
// inteira só fica segurada sem resposta do Jev, com palavra proibida, repetindo a anterior ou se o corte desmontar o formato.
var ACQ11_TETO_GERAL = 0.7;
function acq11Conferir(texto, respostaJev, ritual) {
  var notas = {}, motivos = [], cortes = [], cortar = {}, saiuPromessa = false, saiuBastidor = false;
  ['promessa', 'interno', 'repete'].forEach(function (k) { notas[k] = acq11Noul(respostaJev, k); });
  var corpo = String(texto.body || ''), frases = acq11Frases(corpo), ev = acq11Evidencia(texto, null);
  var foraAntes = acq11NumerosFora(corpo, ev), semResposta = !frases.length, porFrase = false, menor = 1;
  frases.forEach(function (f, i) {
    var a = respostaJev && respostaJev.answers && respostaJev.answers['f' + i];
    var p = a && a.probabilities && typeof a.probabilities.apoia === 'number' ? a.probabilities.apoia : null;
    if (p === null) { semResposta = true; return; }
    var pr = acq11Noul(respostaJev, 'p' + i), bt = acq11Noul(respostaJev, 'b' + i);
    if (pr !== null && bt !== null) porFrase = true;
    var motivo = p < ACQ11_LIMITES.apoiada ? 'sem apoio nas fontes' : foraAntes.some(function (n) { return acq11Contem(f, n); }) ? 'número ou data fora das fontes'
      : pr !== null && pr > 0.5 ? 'promessa de resultado' : bt !== null && bt > 0.5 ? 'bastidor' : null;
    if (motivo) { cortar[f] = motivo; cortes.push({ frase: String(f).slice(0, 200), motivo: motivo }); if (pr !== null && pr > 0.5) saiuPromessa = true; if (bt !== null && bt > 0.5) saiuBastidor = true; }
    else if (p < menor) menor = p;
  });
  if (!semResposta && cortes.length) corpo = acq11Tirar(corpo, function (f) { return !!cortar[f]; });
  var positivo = semResposta ? corpo : acq11SoPositivo(corpo);
  if (positivo !== corpo) { cortes.push({ frase: 'número que caiu ou zerou', motivo: 'só o lado positivo' }); corpo = positivo; }
  var numerosFora = acq11NumerosFora(corpo, ev);
  notas.apoiada = semResposta ? null : Math.round(menor * 100) / 100;
  notas.numeros = numerosFora.length ? 0 : 1;
  var fixo = acq11TextoProibido(corpo);
  if (fixo) motivos.push(fixo);
  var formato = acq11Formato(corpo);
  if (formato) motivos.push(formato);
  if (semResposta || notas.promessa === null || notas.interno === null || notas.repete === null) motivos.push('sem_conferencia');
  else {
    if (numerosFora.length) motivos.push('numero_ou_data_fora_das_fontes');
    // com a nota por frase, a nota geral (que oscila perto do limite) só segura quando acusa forte e nada foi localizado
    var limP = porFrase ? ACQ11_TETO_GERAL : ACQ11_LIMITES.promessa, limB = porFrase ? ACQ11_TETO_GERAL : ACQ11_LIMITES.interno;
    if (notas.promessa > limP && !saiuPromessa) motivos.push('promessa_de_resultado');
    if (notas.interno > limB && !saiuBastidor) motivos.push('termo_de_bastidor');
    if (notas.repete > ACQ11_LIMITES.repete) motivos.push('repete_mensagem_anterior');
  }
  if (!texto.next_steps) motivos.push('sem_proximo_passo');
  return { ok: motivos.length === 0, motivos: motivos, notas: notas, corpo: corpo, cortes: cortes, frase_sem_apoio: null, numeros_fora: numerosFora,
    semana: ritual.semana, ritual: ritual.tipo, conferido_em: new Date().toISOString() };
}

// Título do rascunho: o do escritor, desde que não nomeie o ritual (o painel reescreveria o texto já conferido).
function acq11Titulo(texto, alvo, ritual) {
  var t = String(texto.title || '').trim();
  var nomeia = /(abertura|rota|come[çc]o|in[íi]cio|meio|checagem|fechamento|fechando)\s+(d[aeo]\s+)?(semana|meio|semanal)|prova de movimento|ritual/i.test(t);
  if (!t || nomeia) t = 'Atualização de ' + ritual.data.slice(8, 10) + '/' + ritual.data.slice(5, 7) + ' | ' + alvo.cliente;
  return t.slice(0, 200);
}

function acq11Rascunho(texto, alvo, ritual, conferencia) {
  return { project_id: alvo.project_id, title: acq11Titulo(texto, alvo, ritual), period_start: ritual.semana, period_end: acqSomarDias(ritual.semana, 6),
    summary: texto.body.slice(0, 8000), next_steps: (texto.next_steps || 'Seguir o combinado da semana.').slice(0, 4000),
    metrics: { ritual_type: ritual.tipo, written_by: ACQ11_AUTOR, gerado_por: 'automacao', conferencia: conferencia,
      texto_final: { origem: 'aceleriq_ritual_redigir', confirmado_pelo_dono: false, model: texto.model, custo_usd: texto.custo_usd, dossie_versao: texto.dossie_versao, alertas: texto.alertas, repeticao: texto.repeticao },
      destino_previsto: { channel: 'whatsapp', recipient: alvo.grupo } },
    idempotency_key: 'acq11:' + alvo.client_id + ':' + ritual.semana + ':' + ritual.tipo + ':rascunho' };
}

// O painel devolve o rascunho em `record` (já devolveu em `report`); sem id não há pedido.
function acq11IdDoRascunho(res) {
  var r = res || {};
  return (r.record && r.record.id) || (r.report && r.report.id) || r.id || null;
}

function acq11PedidoRevisao(alvo, ritual, reportId, texto, operador) {
  return { operator: operador, report_id: reportId, channel: 'whatsapp', recipient: alvo.grupo, summary: texto.body, next_steps: texto.next_steps,
    idempotency_key: 'acq11:' + alvo.client_id + ':' + ritual.semana + ':' + ritual.tipo + ':revisao' };
}

var ACQ11_MOTIVOS = { fato_sem_apoio_nas_fontes: 'afirma algo que não achei no painel nem nas conversas', numero_ou_data_fora_das_fontes: 'traz número ou data que não está nas fontes',
  promessa_de_resultado: 'promete resultado', termo_de_bastidor: 'usa termo interno', repete_mensagem_anterior: 'repete a mensagem anterior', sem_conferencia: 'o Jev não respondeu',
  palavra_ritual: 'usa a palavra ritual', travessao: 'tem travessão', sem_negrito: 'veio sem título em negrito', sem_espacamento: 'veio em texto corrido, sem blocos separados', termo_interno: 'usa termo interno', valor_investido: 'cita o valor investido nos anúncios', curto_demais: 'ficou curta demais', longo_demais: 'ficou longa demais', sem_proximo_passo: 'veio sem próximo passo' };

// Aviso para o dono (sino do painel, pelo registro de incidente): uma frase, cliente e o que fazer.
function acq11Aviso(alvo, ritual, etapa, motivos) {
  var porque = (motivos || []).map(function (m) { return ACQ11_MOTIVOS[m] || m; }).join('; ');
  return { key: 'ACQ-11|' + alvo.client_id + '|' + ritual.semana + '|' + ritual.tipo + '|' + etapa, wf: 'ACQ-11', client_id: alvo.client_id, sev: 'aviso',
    titulo: ('Mensagem de ' + ritual.chave_ciclo + ' não saiu sozinha: ' + alvo.cliente).slice(0, 120),
    detalhe: { etapa: etapa, cliente: alvo.cliente, grupo: alvo.grupo, motivos: motivos || [], porque: porque, o_que_fazer: 'Abrir a Central, revisar o rascunho e enviar à mão.' } };
}
