// ACQ-15: Relatório semanal de anúncios para o cliente, em mensagem própria no grupo (JS puro; depende de nucleo.js,
// adaptador.js, wf11.js e wf13.js). Decisão do dono em 11/11/2026: vai separado da mensagem de segunda.
// Os números saem por código, da última semana fechada (segunda a domingo), só pelo lado favorável e sem valor
// investido. "O que fizemos" e "Próximo passo" são reescritos por um modelo a partir das ações que a equipe registrou
// na conta; a conferência é a mesma da mensagem da semana (uma pergunta por frase no Jev, número por busca exata).
// Nesta fase o fluxo só guarda o rascunho no painel para o dono ver. Nada aqui envia mensagem.

var ACQ15_AUTOR = 'n8n:ACQ-15';
var ACQ15_LIMITE = { caracteres: 1200, linhas: 10 };

function acq15Config(cfg) {
  var r = (cfg && cfg.relatorio_anuncios) || {}, pn = (cfg && cfg.post_no_ar) || {};
  return { ativo: r.ativo === true, grupos: pn.grupos || {}, fora: r.clientes_fora || [], ensaio: r.clientes_ensaio || [],
    llm_url: r.llm_url || pn.llm_url || null, llm_modelo: r.llm_modelo || pn.llm_modelo || null, preparar_envio: r.preparar_envio === true };
}

function acq15Clientes(cfg, somente) {
  var c = acq15Config(cfg);
  return Object.keys(c.grupos).filter(function (id) { return c.fora.indexOf(id) < 0 && (!somente || somente.indexOf(id) >= 0); })
    .map(function (id) { return { client_id: id, grupo: c.grupos[id] }; });
}

function acq15Mil(n) { return String(Math.round(acq13Num(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

// Frases de número: só o que é favorável. A comparação com a semana anterior só entra quando melhora.
function acq15Numeros(alvo) {
  var n = (alvo && alvo.numeros) || {};
  var contatos = acq13Num(n.contatos), ant = acq13Num(n.contatos_ant), ap = acq13Num(n.apareceu), apAnt = acq13Num(n.apareceu_ant);
  var clk = acq13Num(n.cliques), clkAnt = acq13Num(n.cliques_ant), noAr = acq13Num(n.campanhas_no_ar);
  var frases = [];
  if (contatos > 0) frases.push(acq13Plural(contatos, 'contato novo chegou', 'contatos novos chegaram') + ' pelos anúncios' + (ant > 0 && contatos > ant ? ', contra ' + ant + ' na semana anterior.' : '.'));
  if (ap > 0) frases.push('Os anúncios apareceram ' + acq15Mil(ap) + ' vezes' + (apAnt > 0 && ap > apAnt * 1.05 ? ', acima das ' + acq15Mil(apAnt) + ' da semana anterior.' : '.'));
  if (contatos <= 0 && clk > 0) frases.push(acq13Plural(clk, 'pessoa clicou', 'pessoas clicaram') + ' para saber mais' + (clkAnt > 0 && clk > clkAnt ? ', contra ' + acq15Mil(clkAnt) + ' na semana anterior.' : '.'));
  if (frases.length && noAr > 0) frases.push(acq13Plural(noAr, 'campanha segue no ar', 'campanhas seguem no ar') + '.');
  return frases;
}

// Quem recebe relatório nesta rodada.
function acq15Triagem(alvos) {
  var escrever = [], fora = [];
  (alvos || []).forEach(function (a) {
    var motivo = !a.ativo ? 'cliente_inativo' : a.ja_escrito ? 'ja_escrito' : !a.project_id ? 'sem_projeto' : !a.grupo ? 'sem_grupo'
      : acq13Num(a.numeros && a.numeros.gasto) <= 0 ? 'sem_anuncio_na_semana' : !acq15Numeros(a).length ? 'sem_numero_favoravel' : null;
    if (motivo) fora.push({ client_id: a.client_id, cliente: a.cliente, motivo: motivo }); else escrever.push(a);
  });
  return { escrever: escrever, fora: fora };
}

// Pedido ao modelo: reescrever as ações registradas na conta na língua do cliente. Sem ação registrada não há pedido.
function acq15PedidoRedacao(alvo, cfg) {
  var c = acq15Config(cfg);
  var sistema = [
    'Você escreve, para o grupo de WhatsApp de um cliente da Aceleriq (empresa de marketing), dois trechos do relatório semanal de anúncios dele.',
    'Você recebe a lista de ações que a equipe registrou na conta de anúncios (o que foi feito e por quê). Devolva, em português do Brasil, simples e direto, como a equipe falaria com o dono do negócio:',
    '- fizemos: uma ou duas frases contando, com o detalhe concreto, o que a equipe fez nos anúncios e para quê (público, idade, região, raio, onde o anúncio aparece, canal de contato, arte ou oferta trocada, anúncio que não trazia contato e foi substituído). Fale na primeira pessoa do plural ("ajustamos", "trocamos").',
    '- proximo: uma frase com o próximo passo, só se ele estiver registrado nas ações (algo já montado e ainda não ligado, um teste que começou). Se não houver, devolva "".',
    'Use somente o que está nas ações. Não invente número, data, nome, preço ou prazo. Se nenhuma ação for do interesse do cliente, devolva os dois campos como "".',
    'Deixe de fora o que é bastidor: permissão, página, token, sistema, erro, conta bloqueada, saldo, nome técnico de campanha ou de conjunto, sigla, identificador numérico, nome de ferramenta ou de pessoa da equipe.',
    'Conte só o que melhora o anúncio. Não conte problema, erro, anúncio parado, falha corrigida nem reativação depois de falha.',
    'No próximo passo, não acrescente condição, prazo ou motivo que não esteja escrito nas ações.',
    'Nunca cite valor em reais, verba, orçamento diário, gasto, custo por contato ou teto. Nunca prometa resultado.',
    'Não use travessão nem asterisco. Responda só em JSON: {"fizemos":"...","proximo":"..."}',
  ].join('\n');
  var usuario = JSON.stringify({ cliente: alvo.cliente, semana: acq13Dia(alvo.semana_inicio) + ' a ' + acq13Dia(alvo.semana_fim), acoes: (alvo.acoes || []).slice(-12) });
  return { model: c.llm_modelo, messages: [{ role: 'system', content: sistema }, { role: 'user', content: usuario }], max_tokens: 2500, temperature: 0.3,
    response_format: { type: 'json_schema', json_schema: { name: 'relatorio', strict: true, schema: { type: 'object', additionalProperties: false, required: ['fizemos', 'proximo'],
      properties: { fizemos: { type: 'string' }, proximo: { type: 'string' } } } } } };
}

// Lê a resposta do modelo. Sem ações, os dois trechos ficam vazios e o relatório sai só com os números.
function acq15LerRedacao(resposta, alvo) {
  if (!((alvo && alvo.acoes) || []).length) return { ok: true, fizemos: '', proximo: '' };
  if (!resposta || resposta.error) return { ok: false, motivo: 'modelo_indisponivel' };
  var bruto = resposta.choices && resposta.choices[0] && resposta.choices[0].message && resposta.choices[0].message.content;
  var j = null, s = String(bruto || ''), a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { j = JSON.parse(s.slice(a, b + 1)); } catch (e) { j = null; } }
  if (!j || typeof j.fizemos !== 'string') return { ok: false, motivo: 'json_invalido' };
  var limpar = function (t) { return String(t || '').replace(/\*+/g, '').replace(/\s*[–—]\s*/g, ', ').replace(/\s+/g, ' ').trim(); };
  var fizemos = limpar(j.fizemos), proximo = limpar(j.proximo);
  if (fizemos.length > 420 || proximo.length > 220) return { ok: false, motivo: 'trecho_longo' };
  if (/R\$/.test(fizemos + ' ' + proximo)) return { ok: false, motivo: 'valor_em_reais' };
  return { ok: true, fizemos: fizemos, proximo: proximo };
}

// Fonte da conferência, nos mesmos formatos que a mensagem usa (número com ponto de milhar, data em DD/MM).
function acq15Evidencia(alvo) {
  var n = alvo.numeros || {};
  var linhas = ['Relatório de anúncios de ' + alvo.cliente + ', semana de ' + acq13Dia(alvo.semana_inicio) + ' a ' + acq13Dia(alvo.semana_fim) + '.',
    'Contatos novos pelos anúncios na semana: ' + acq13Num(n.contatos) + '. Na semana anterior: ' + acq13Num(n.contatos_ant) + '.',
    'Vezes que os anúncios apareceram na semana: ' + acq15Mil(n.apareceu) + '. Na semana anterior: ' + acq15Mil(n.apareceu_ant) + '.',
    'Pessoas que clicaram para saber mais na semana: ' + acq15Mil(n.cliques) + '. Na semana anterior: ' + acq15Mil(n.cliques_ant) + '.',
    'Campanhas no ar agora: ' + acq13Num(n.campanhas_no_ar) + '.', 'Ações que a equipe registrou na conta de anúncios:'];
  (alvo.acoes || []).forEach(function (a) { linhas.push('- ' + a.dia + ' (' + a.tipo + '): ' + a.o_que + ' Motivo: ' + a.por_que); });
  if (!(alvo.acoes || []).length) linhas.push('- nenhuma ação registrada no período.');
  return linhas.join('\n');
}

// Monta a mensagem no formato que o dono exige: saudação ao time, título em negrito sozinho na linha, blocos separados.
function acq15Montar(alvo, red, agoraMs) {
  var hora = new Date(agoraMs - 3 * 3600000).getUTCHours();
  var blocos = [(hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite') + ', time.',
    '*Anúncios de ' + acq13Dia(alvo.semana_inicio) + ' a ' + acq13Dia(alvo.semana_fim) + '*\n' + acq15Numeros(alvo).join(' ')];
  if (red.fizemos) blocos.push('*O que fizemos*\n' + red.fizemos);
  if (red.proximo) blocos.push('*Próximo passo*\n' + red.proximo);
  blocos.push('Para conferir o restante, está tudo no painel: https://aceleriq.online/onde-estamos');
  return { ok: true, title: 'Relatório de anúncios ' + acq13Dia(alvo.semana_inicio) + ' a ' + acq13Dia(alvo.semana_fim) + ' | ' + alvo.cliente,
    body: blocos.join('\n\n'), next_steps: red.proximo || 'Acompanhar os anúncios da semana.', tem_acao: !!red.fizemos,
    fontes: { estado_real: acq15Evidencia(alvo), continuidade: '', dia_prioritario: '' } };
}

// Veredito: a conferência da mensagem da semana mais o tamanho combinado para texto de anúncios ao cliente.
function acq15Conferir(texto, respostaJev, semana) {
  var conf = acq11Conferir(texto, respostaJev, { semana: semana, tipo: 'relatorio_anuncios' });
  var linhas = texto.body.split('\n').filter(function (l) { var t = l.trim(); return t && !/^\*[^*]+\*:?$/.test(t); }).length;
  if (texto.body.length > ACQ15_LIMITE.caracteres) conf.motivos.push('passou_de_1200_caracteres');
  if (linhas > ACQ15_LIMITE.linhas) conf.motivos.push('passou_de_10_linhas');
  if (!texto.tem_acao) conf.motivos.push('sem_acao_concreta');
  conf.ok = conf.motivos.length === 0;
  return conf;
}

function acq15Rascunho(alvo, texto, conf, marca) {
  return { project_id: alvo.project_id, title: texto.title.slice(0, 200), period_start: alvo.semana_inicio, period_end: alvo.semana_fim,
    summary: texto.body.slice(0, 8000), next_steps: texto.next_steps.slice(0, 4000),
    metrics: { relatorio: 'anuncios_semana', written_by: ACQ15_AUTOR, gerado_por: 'automacao', semana: marca, conferencia: conf,
      texto_final: { origem: 'acq15', confirmado_pelo_dono: false }, destino_previsto: { channel: 'whatsapp', recipient: alvo.grupo } },
    idempotency_key: 'acq15:' + alvo.client_id + ':' + marca + ':' + acqSha256(texto.body).slice(0, 10) };
}

var ACQ15_MOTIVOS = { passou_de_1200_caracteres: 'passou de 1.200 caracteres', passou_de_10_linhas: 'passou de 10 linhas', sem_acao_concreta: 'não há ação da equipe registrada para contar' };

// Um aviso só por rodada para o dono: quantas prévias ficaram prontas e quais ficaram seguradas, com o motivo.
function acq15Aviso(resultados, marca) {
  var prontas = resultados.filter(function (r) { return r.ok; }), seguradas = resultados.filter(function (r) { return !r.ok; });
  return { key: 'ACQ-15|' + marca, wf: 'ACQ-15', client_id: null, sev: 'aviso',
    titulo: ('Relatório de anúncios: ' + acq13Plural(prontas.length, 'prévia pronta', 'prévias prontas') + (seguradas.length ? ' e ' + acq13Plural(seguradas.length, 'segurada', 'seguradas') : '') + ' na Central').slice(0, 120),
    detalhe: { prontas: prontas.map(function (r) { return r.cliente; }),
      seguradas: seguradas.map(function (r) { return { cliente: r.cliente, porque: (r.motivos || []).map(function (m) { return ACQ15_MOTIVOS[m] || ACQ11_MOTIVOS[m] || m; }).join('; ') }; }),
      o_que_fazer: 'Abrir a Central para ler as prévias. Nada foi enviado ao cliente.' } };
}

// Pedido na Revisão do Ciclo com o grupo como destino. Só é preparado com relatorio_anuncios.preparar_envio ligado.
function acq15PedidoRevisao(fechado, reportId, operador) {
  return { operator: operador, report_id: reportId, channel: 'whatsapp', recipient: fechado.grupo, summary: fechado.corpo, next_steps: fechado.proximo,
    idempotency_key: 'acq15:' + fechado.client_id + ':' + fechado.marca + ':revisao:' + reportId };
}
