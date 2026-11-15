// ACQ-09 — Resumo do dia das conversas dos grupos, por cliente (JS puro; depende de nucleo.js).
// O modelo de texto escreve o resumo; o Jev confere cada afirmação contra as mensagens citadas; o código decide o
// que entra. O resumo do dia SUBSTITUI o anterior do mesmo dia (chave cliente + dia) e a seção do dossiê é sempre
// reescrita com os últimos 7 dias, nunca empilhada. Nome, valor e data vindos de áudio saem marcados como áudio.

var ACQ09_TIPOS = ['pedido_cliente', 'decisao', 'feito_agencia', 'pendencia_agencia', 'pendencia_cliente', 'informacao'];
var ACQ09_ROTULOS = { pedido_cliente: 'Pedido do cliente', decisao: 'Decisão', feito_agencia: 'Feito pela agência', pendencia_agencia: 'Pendente conosco',
  pendencia_cliente: 'Pendente com o cliente', informacao: 'Informação' };
var ACQ09_LIMIAR = 0.6;
var ACQ09_CABECALHO = '## Conversas do grupo de WhatsApp (leitura automática n8n ACQ-09, não confirmada pelo dono)';

function acq09Config(cfg) {
  var c = (cfg && cfg.leitura_grupos) || {};
  return { ativo: c.ativo === true, llm_url: c.llm_url || null, llm_modelo: c.llm_modelo || null, dias_no_dossie: c.dias_no_dossie || 7 };
}

function acq09Quem(m) {
  var papel = { bot: 'Aceleriq (número da equipe)', agencia: 'Aceleriq', cliente_decisor: 'Cliente (decisor)', cliente_equipe: 'Cliente' }[m.papel] || 'Desconhecido';
  return m.nome && m.papel !== 'bot' ? papel + ' — ' + m.nome : papel;
}

// Mensagens do dia em forma enxuta. Só "bom dia" e agradecimento não justificam resumo.
function acq09Preparar(linha) {
  var ms = (linha.mensagens || []).filter(function (m) { return m && m.id && m.texto && String(m.texto).trim(); }).map(function (m) {
    return { id: String(m.id), hora: m.hora, quem: acq09Quem(m), papel: m.papel || null, audio: m.audio === true, texto: String(m.texto).slice(0, 2500), ruido: m.jev === 'ruido' };
  });
  var uteis = ms.filter(function (m) { return !m.ruido; });
  return { client_id: linha.client_id, cliente: String(linha.rotulo || '').replace(/\s*-\s*MKT.*$/i, '').trim(), dia: String(linha.dia).slice(0, 10),
    mensagens: ms.slice(-120), total: ms.length, uteis: uteis.length, anteriores: (linha.anteriores || []).slice(0, 6),
    ja_registrados: (linha.ja_registrados || []).filter(function (i) { return i && i.tipo && i.texto; }).slice(0, 12).map(function (i) { return { tipo: i.tipo, texto: String(i.texto) }; }),
    tem_conteudo: uteis.length > 0 };
}

function acq09PedidoResumo(p, cfg) {
  var c = acq09Config(cfg);
  var sistema = [
    'Você é da equipe da Aceleriq, uma agência de marketing. Leia as mensagens de UM dia do grupo de WhatsApp de um cliente e escreva o registro interno desse dia, para a equipe.',
    'Use só o que está nas mensagens. Não invente nome, valor, data, prazo ou resultado. Se algo não está dito, não escreva.',
    'Mensagens com "audio": true vieram de transcrição automática e podem ter palavra errada: nome próprio, número e data de áudio só entram se fizerem sentido no contexto, e marque veio_de_audio.',
    'Quem fala importa: "Aceleriq" é a agência; "Cliente" é o cliente. Pedido da agência ao cliente NÃO é pedido_cliente: é pendencia_cliente (algo que o cliente precisa responder ou enviar).',
    'Cada item é uma afirmação curta, completa e verificável, em português do Brasil, com os ids das mensagens que a sustentam. Tipos:',
    '- pedido_cliente: o cliente pediu que a agência faça, envie, mude ou produza algo.',
    '- decisao: algo foi escolhido, aprovado, autorizado ou recusado (diga por quem).',
    '- feito_agencia: a agência informou que fez, entregou, publicou ou ajustou algo.',
    '- pendencia_agencia: a agência prometeu algo que ainda não entregou.',
    '- pendencia_cliente: a agência espera resposta, aprovação ou material do cliente.',
    '- informacao: fato novo do negócio do cliente que vale lembrar.',
    'Material que o cliente manda sem explicar (vaga de emprego, foto, vídeo, promoção, aviso, documento) é pedido_cliente. Escreva só o fato, com as palavras dele: "O cliente enviou <o quê> <para onde ou para quê, se ele disse>". Não escreva o que você supõe que ele quer nem o que a agência "deve" fazer: suposição é derrubada na conferência. Mensagem "[imagem sem legenda]", "[video sem legenda]" ou "[documento sem legenda]" indica só que o arquivo foi enviado.',
    'Quando a mensagem traz "[imagem enviada, descrição automática: ...]" (ou video), a descrição diz o que havia no arquivo. Use-a para dizer O QUE foi enviado, com os dados visíveis que importam (preço, data, nome, cargo): "O cliente enviou a arte de uma vaga de auxiliar de produção". É leitura automática: não acrescente nada que não esteja na descrição. Arquivo enviado pela Aceleriq costuma ser a peça mandada para o cliente ver: registre como feito_agencia ("A agência enviou a arte de ...") e, se ela pediu aprovação, também pendencia_cliente.',
    'Ignore cumprimento, agradecimento e emoji. No máximo 10 itens, os mais importantes.',
    'O dia é resumido mais de uma vez. Em "itens_ja_registrados" estão os itens que já foram escritos hoje para este cliente. Se um deles continua valendo, repita o tipo e o texto dele LETRA POR LETRA, sem melhorar a redação; só reescreva se o fato mudou, e tire o que deixou de valer. Depois acrescente os itens novos.',
    'resumo: 2 a 3 frases dizendo o que aconteceu no dia, sem repetir o que já está em "dias_anteriores" (isso já foi registrado).',
    'sugestoes: até 2 sugestões práticas para o dono da agência se antecipar (o que cobrar, oferecer ou ajustar), só se as mensagens derem base; senão lista vazia.',
    'Se o dia não trouxe nada de trabalho, sem_novidade true e listas vazias.',
  ].join('\n');
  var usuario = JSON.stringify({ cliente: p.cliente, dia: p.dia, mensagens: p.mensagens.map(function (m) { return { id: m.id, hora: m.hora, quem: m.quem, audio: m.audio, texto: m.texto }; }),
    dias_anteriores: p.anteriores, itens_ja_registrados: p.ja_registrados || [] });
  var item = { type: 'object', additionalProperties: false, required: ['tipo', 'texto', 'ids', 'veio_de_audio'], properties: {
    tipo: { type: 'string', enum: ACQ09_TIPOS }, texto: { type: 'string' }, ids: { type: 'array', items: { type: 'string' } }, veio_de_audio: { type: 'boolean' } } };
  return { model: c.llm_modelo, messages: [{ role: 'system', content: sistema }, { role: 'user', content: usuario }], max_tokens: 1800, temperature: 0.2,
    response_format: { type: 'json_schema', json_schema: { name: 'resumo_do_dia', strict: true, schema: { type: 'object', additionalProperties: false,
      required: ['resumo', 'itens', 'sugestoes', 'sem_novidade'], properties: { resumo: { type: 'string' }, itens: { type: 'array', items: item },
        sugestoes: { type: 'array', items: { type: 'string' } }, sem_novidade: { type: 'boolean' } } } } } };
}

// Resposta do modelo -> rascunho. Item sem mensagem citada que exista no dia é descartado aqui, antes do Jev.
function acq09LerResumo(resposta, p) {
  var bruto = null;
  try {
    var txt = resposta && resposta.choices && resposta.choices[0] && resposta.choices[0].message && resposta.choices[0].message.content;
    bruto = typeof txt === 'string' ? JSON.parse(txt.replace(/^```(?:json)?\s*|\s*```$/g, '')) : null;
  } catch (e) { bruto = null; }
  if (!bruto || typeof bruto.resumo !== 'string' || !Array.isArray(bruto.itens)) return null;
  var porId = {}; p.mensagens.forEach(function (m) { porId[m.id] = m; });
  var itens = [];
  bruto.itens.slice(0, 10).forEach(function (i) {
    if (!i || ACQ09_TIPOS.indexOf(i.tipo) < 0 || typeof i.texto !== 'string' || i.texto.trim().length < 8) return;
    var ids = (Array.isArray(i.ids) ? i.ids : []).map(String).filter(function (id) { return !!porId[id]; });
    if (!ids.length) return;
    itens.push({ tipo: i.tipo, texto: i.texto.trim().slice(0, 400), ids: ids, veio_de_audio: ids.some(function (id) { return porId[id].audio; }) });
  });
  return { resumo: bruto.resumo.trim().slice(0, 700), itens: itens, sugestoes: (Array.isArray(bruto.sugestoes) ? bruto.sugestoes : []).filter(function (s) { return typeof s === 'string' && s.trim().length > 8; }).slice(0, 2).map(function (s) { return s.trim().slice(0, 300); }),
    sem_novidade: bruto.sem_novidade === true };
}

// Conferência no Jev: uma pergunta por afirmação (independentes, mesmo estado) e uma para o resumo.
function acq09PedidoConferencia(rascunho, p) {
  var perguntas = { resumo: { type: 'noul', instructions: 'O texto em `resumo` descreve só coisas que aparecem em `mensagens`, sem acrescentar fato, nome, valor, data ou resultado que não foi dito?' } };
  rascunho.itens.forEach(function (it, n) {
    perguntas['item_' + n] = { type: 'noul', instructions: 'A afirmação em `afirmacoes[' + n + '].texto` é sustentada pelo que foi dito em `mensagens` (em especial nas de id listado em `afirmacoes[' + n + '].ids`), incluindo quem pediu, decidiu ou fez, sem acrescentar fato que não aparece nelas?' };
  });
  // Mensagem citada por algum item entra mesmo marcada como ruído (ex.: a foto que o cliente mandou junto do texto).
  var citadas = {};
  rascunho.itens.forEach(function (it) { (it.ids || []).forEach(function (id) { citadas[id] = true; }); });
  return { model: 'jev-latest', state: { cliente: p.cliente, mensagens: p.mensagens.filter(function (m) { return !m.ruido || citadas[m.id]; }).map(function (m) { return { id: m.id, quem: m.quem, texto: m.texto }; }),
    resumo: rascunho.resumo, afirmacoes: rascunho.itens.map(function (it) { return { tipo: ACQ09_ROTULOS[it.tipo], texto: it.texto, ids: it.ids }; }) }, questions: perguntas };
}

function acq09Noul(resposta, chave) {
  var a = resposta && resposta.answers && resposta.answers[chave];
  return a && typeof a.noul === 'number' ? a.noul : null;
}

// Sem conferência do Jev nada é afirmado: o dia fica com estado 'sem_conferencia' e não vai ao dossiê.
function acq09Fechar(rascunho, respostaJev, p) {
  var base = { client_id: p.client_id, cliente: p.cliente, dia: p.dia, mensagens: p.total, uteis: p.uteis };
  if (!rascunho) return Object.assign(base, { estado: 'falhou_redacao', resumo: null, itens: [], nao_confirmados: [], sugestoes: [] });
  var nResumo = acq09Noul(respostaJev, 'resumo');
  if (nResumo === null) return Object.assign(base, { estado: 'sem_conferencia', resumo: null, itens: [], nao_confirmados: rascunho.itens, sugestoes: [] });
  var ok = [], fora = [];
  rascunho.itens.forEach(function (it, n) {
    var v = acq09Noul(respostaJev, 'item_' + n);
    var item = Object.assign({}, it, { confianca: v === null ? null : Math.round(v * 100) / 100 });
    (v !== null && v >= ACQ09_LIMIAR ? ok : fora).push(item);
  });
  var resumoOk = nResumo >= ACQ09_LIMIAR;
  var semNovidade = rascunho.sem_novidade || (!ok.length && !resumoOk);
  return Object.assign(base, { estado: semNovidade ? 'sem_novidade' : 'ok', resumo: resumoOk ? rascunho.resumo : null, resumo_confianca: Math.round(nResumo * 100) / 100,
    itens: ok, nao_confirmados: fora, sugestoes: ok.length ? rascunho.sugestoes : [] });
}

function acq09DataBR(dia) { var d = String(dia).slice(0, 10).split('-'); return d[2] + '/' + d[1]; }

// Texto do dia (vai para o dossiê e para o segundo cérebro). Curto de propósito.
function acq09Texto(f) {
  if (f.estado !== 'ok') return '';
  var linhas = ['**' + acq09DataBR(f.dia) + '**' + (f.resumo ? ' — ' + f.resumo : '')];
  ACQ09_TIPOS.forEach(function (t) {
    f.itens.filter(function (i) { return i.tipo === t; }).forEach(function (i) { linhas.push('- ' + ACQ09_ROTULOS[t] + ': ' + i.texto + (i.veio_de_audio ? ' _(de áudio, conferir nomes e valores)_' : '')); });
  });
  return linhas.join('\n').slice(0, 2400);
}

// O que identifica o conteúdo: mesmo conteúdo, mesmo hash, nenhuma escrita nova.
function acq09Hash(f) {
  return acqHashDe({ estado: f.estado, resumo: f.resumo, itens: f.itens.map(function (i) { return [i.tipo, i.texto, i.ids]; }), sugestoes: f.sugestoes });
}

// Tira do dossiê a seção anterior deste fluxo (até o próximo "## " ou o fim).
function acq09SemSecao(texto) {
  var out = [], pulando = false, achou = false;
  String(texto || '').split('\n').forEach(function (l) {
    if (/^## Conversas do grupo de WhatsApp \(leitura automática n8n ACQ-09/.test(l)) { pulando = true; achou = true; return; }
    if (pulando && /^## /.test(l)) pulando = false;
    if (!pulando) out.push(l);
  });
  return achou ? out.join('\n').replace(/\n{3,}/g, '\n\n').trim() : String(texto || '');
}

// Seção do dossiê: os últimos dias com conteúdo, do mais novo para o mais velho, sempre substituindo a anterior.
function acq09SecaoDossie(semana, dossieAtual, maxDias) {
  var dias = (semana || []).filter(function (d) { return d && d.texto; }).sort(function (a, b) { return String(b.dia).localeCompare(String(a.dia)); }).slice(0, maxDias || 7);
  var semAnterior = acq09SemSecao(dossieAtual);
  if (!dias.length) return { secao: '', conteudo: semAnterior, mudou: semAnterior !== String(dossieAtual || '') };
  var secao = [ACQ09_CABECALHO, 'Atualizado até ' + acq09DataBR(dias[0].dia) + '. Fonte: mensagens e áudios do grupo; áudio é transcrição automática.', ''].concat(dias.map(function (d) { return d.texto; })).join('\n\n').slice(0, 9000);
  var conteudo = semAnterior ? semAnterior + '\n\n' + secao : secao;
  return { secao: secao, conteudo: conteudo, mudou: conteudo !== String(dossieAtual || ''), excede: conteudo.length > 60000 };
}
