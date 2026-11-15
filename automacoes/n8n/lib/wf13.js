// ACQ-13: Radar de anúncios (JS puro; depende de nucleo.js). Só leitura e aviso: nada aqui mexe em conta de anúncio.
// Os fatos vêm de acq_n8n.radar_anuncios_fatos() (o que o painel já coleta da Meta, somado por janela). As regras são
// fixas, sem IA, e usam os mesmos limites do boletim mínimo do painel (mesa-ads/modulos/boletim-minimo.ts) onde as duas
// coisas se cruzam, para um não contradizer o outro. O que este radar acrescenta: campanha vencida ou com nome de
// período vencido ainda gastando, teto semanal, anúncio reprovado, conta com pagamento em aberto, cliente com tráfego
// contratado e nada rodando, coleta parada e acesso da Meta perto de vencer.

var ACQ13_LIMITES = {
  coleta_horas: 3, token_dias_de_vida: 60, token_avisar_faltando: 10, token_critico_faltando: 3,
  saldo_dias_atencao: 3, saldo_dias_critico: 1,
  custo_vezes_a_media: 2, resultados_minimos_da_media: 3, gasto_sem_resultado_brl: 50,
  dias_sem_entrega: 3, parada_recente_dias: 14, dias_para_terminar: 2, folga_do_teto: 1.1, nome_vencido_dias: 2,
};
var ACQ13_CONTA = {
  2: 'conta desativada pela Meta', 3: 'pagamento em aberto (a Meta segura a conta até quitar)', 7: 'em análise de risco pela Meta',
  8: 'aguardando liquidação de pagamento', 9: 'em período de carência por falta de pagamento', 100: 'em encerramento', 101: 'conta encerrada',
};
// Como o alerta crítico aparece no sino do dono (o texto inteiro fica no boletim).
var ACQ13_CURTO = {
  coleta_parada: 'a coleta dos anúncios parou', token_meta: 'acesso da Meta da coleta vencendo', conta_parada: 'conta de anúncios parada na Meta',
  saldo_curto: 'saldo de anúncios acabando', teto_semanal: 'gasto de anúncios acima do teto semanal', vencida_gastando: 'campanha vencida ainda gastando',
  gasto_sem_resultado: 'anúncio gastando sem resultado', periodo_vencido: 'campanha com período vencido no nome ainda gastando',
  contrato_sem_campanha: 'tráfego contratado sem anúncio rodando', custo_alto: 'custo por resultado fora do normal',
  anuncio_com_problema: 'anúncio com problema na Meta', sem_entrega: 'campanha parou de entregar', terminando: 'campanha terminando', limpeza: 'campanhas paradas marcadas como ativas',
  coleta_da_conta: 'leitura da conta falhou',
};
var ACQ13_MESES = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
var ACQ13_PESO = { critico: 0, atencao: 1, info: 2 };
var ACQ13_DIA_MS = 86400000;

function acq13Num(v) { var n = typeof v === 'number' ? v : Number(v); return isFinite(n) ? n : 0; }
function acq13Reais(v) { return 'R$ ' + acq13Num(v).toFixed(2).replace('.', ','); }
function acq13Dia(iso) { var s = String(iso || ''); return s.length >= 10 ? s.slice(8, 10) + '/' + s.slice(5, 7) : '?'; }
// Data de um instante no fuso de São Paulo (UTC-3, sem horário de verão desde 2019).
function acq13DataSP(ms) { return new Date(ms - 3 * 3600000).toISOString().slice(0, 10); }
function acq13HoraSP(ms) { var d = new Date(ms - 3 * 3600000).toISOString(); return d.slice(8, 10) + '/' + d.slice(5, 7) + ' ' + d.slice(11, 13) + 'h' + d.slice(14, 16); }
function acq13Meio(iso) { return Date.parse(String(iso).slice(0, 10) + 'T12:00:00Z'); }
function acq13Plural(n, um, varios) { return n + ' ' + (n === 1 ? um : varios); }

function acq13Config(cfg) {
  var r = (cfg && cfg.radar_anuncios) || {};
  return { ativo: r.ativo === true, tetos: r.tetos_semanais || {}, fora: r.clientes_fora || [], operador: (cfg && cfg.operador) || 'default' };
}

// Fim do período escrito no nome da campanha ("07-14 OUT", "30 SET - 07 OUT", "Ciclo 05-12nov26"). Uma data só
// (ex.: "29OUT2026", que é a data de criação) não conta. Devolve AAAA-MM-DD ou null.
function acq13FimNoNome(nome, hojeIso) {
  var s = String(nome || '').toLowerCase();
  var mes = '(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z\u00e7]*';
  var sep = '\\s*(?:[-\u2013\u2014]|\\sa\\s|\\sat[e\u00e9]\\s)\\s*';
  var dois = new RegExp('(?:^|[^\\d,.])(\\d{1,2})\\s*' + mes + sep + '(\\d{1,2})\\s*' + mes + '\\.?\\s*(\\d{4}|\\d{2})?(?!\\d)').exec(s);
  var um = dois ? null : new RegExp('(?:^|[^\\d,.])(\\d{1,2})' + sep + '(\\d{1,2})\\s*(?:de\\s+)?' + mes + '\\.?\\s*(\\d{4}|\\d{2})?(?!\\d)').exec(s);
  var dia, m, ano;
  if (dois) { dia = Number(dois[3]); m = ACQ13_MESES[dois[4]]; ano = dois[5]; }
  else if (um) { dia = Number(um[2]); m = ACQ13_MESES[um[3]]; ano = um[4]; }
  else return null;
  if (!m || dia < 1 || dia > 31) return null;
  var hojeMs = acq13Meio(hojeIso);
  var y = ano ? (ano.length === 2 ? 2000 + Number(ano) : Number(ano)) : Number(String(hojeIso).slice(0, 4));
  var iso = function (yy) { return yy + '-' + String(m).padStart(2, '0') + '-' + String(dia).padStart(2, '0'); };
  // Sem ano no nome: vale a ocorrência mais recente que não esteja mais de 45 dias à frente.
  if (!ano && acq13Meio(iso(y)) - hojeMs > 45 * ACQ13_DIA_MS) y -= 1;
  return iso(y);
}

// Campanha que busca resultado (mensagem, lead, venda): mesmo critério do boletim mínimo do painel.
function acq13DeResultado(c) {
  if (acq13Num(c.r30) > 0) return true;
  if (/LEAD|SALES|CONVERSION|MESSAGE/.test(String(c.objetivo || '').toUpperCase())) return true;
  return /whats|direct|mensag|lead|venda|compra|or[c\u00e7]amento/i.test(String(c.nome || ''));
}

function acq13Soma(lista, campo) { return (lista || []).reduce(function (s, x) { return s + acq13Num(x[campo]); }, 0); }

// Todos os alertas da rodada. agoraMs entra de fora para o teste ser determinístico.
function acq13Alertas(fatos, cfg, agoraMs) {
  var L = ACQ13_LIMITES, c13 = acq13Config(cfg), out = [];
  var hoje = String((fatos && fatos.hoje) || acq13DataSP(agoraMs)).slice(0, 10);
  var hojeMs = acq13Meio(hoje);
  var por = function (cl, tipo, nivel, alvo, texto) {
    var nome = cl ? cl.cliente : 'Carteira';
    out.push({ chave: tipo + '|' + (cl ? cl.client_id : 'carteira') + '|' + (alvo || ''), client_id: cl ? cl.client_id : null,
      cliente: nome, tipo: tipo, nivel: nivel, texto: String(texto).slice(0, 560), curto: (nome + ': ' + (ACQ13_CURTO[tipo] || tipo)).slice(0, 118) });
  };

  // Vigia da coleta e do acesso da Meta: sem isso o resto olha dado velho.
  var coleta = (fatos && fatos.coleta) || {};
  var corte = Date.parse(coleta.diario_em || coleta.campanhas_em || '');
  var velha = !isFinite(corte) || agoraMs - corte > L.coleta_horas * 3600000;
  if (velha) por(null, 'coleta_parada', 'critico', '', 'A coleta dos anúncios parou: último corte ' + (isFinite(corte) ? acq13HoraSP(corte) : 'desconhecido') + '. O radar está olhando dado velho até ela voltar.');
  var tk = (fatos && fatos.token) || {};
  if (acq13Num(tk.ativos) < 1) por(null, 'token_meta', 'critico', '', 'Nenhum acesso válido da Meta para a coleta dos anúncios. Refazer o login da Meta no painel (Anúncios, Conta).');
  else if (tk.salvo_em) {
    var falta = L.token_dias_de_vida - Math.floor((agoraMs - Date.parse(tk.salvo_em)) / ACQ13_DIA_MS);
    if (falta <= L.token_avisar_faltando) por(null, 'token_meta', falta <= L.token_critico_faltando ? 'critico' : 'atencao', '',
      'O acesso da Meta usado na coleta foi renovado em ' + acq13Dia(acq13DataSP(Date.parse(tk.salvo_em))) + ' e esse tipo de acesso costuma durar ' + L.token_dias_de_vida + ' dias: faltam cerca de ' + Math.max(falta, 0) + '. Refazer o login da Meta no painel antes de vencer.');
  }

  ((fatos && fatos.clientes) || []).forEach(function (cl) {
    if (c13.fora.indexOf(cl.client_id) >= 0) return;
    var camps = cl.campanhas || [], contas = cl.contas || [];
    var ativas = camps.filter(function (c) { return String(c.efetivo || '').toUpperCase() === 'ACTIVE'; });
    var acabou = function (c) { return c.fim && Date.parse(c.fim) <= agoraMs; };
    var vivas = ativas.filter(function (c) { return !acabou(c); });
    var encerradas = ativas.filter(acabou);
    var gastando = function (c) { return acq13Num(c.g3) > 0 || acq13Num(c.g_hoje) > 0; };
    var g7 = acq13Soma(camps, 'g7'), g3 = acq13Soma(camps, 'g3'), gHoje = acq13Soma(camps, 'g_hoje');
    var g30 = acq13Soma(camps, 'g30'), r30 = acq13Soma(camps, 'r30');
    var ultimo = camps.map(function (c) { return c.ultimo_gasto || ''; }).sort().pop() || null;

    // Conta com problema de pagamento ou parada pela Meta.
    var contaRuim = null;
    contas.forEach(function (ct) {
      var st = ct.status === null || ct.status === undefined ? 1 : Number(ct.status);
      if (st !== 1 && (vivas.length || cl.trafego)) {
        contaRuim = contaRuim || ct;
        por(cl, 'conta_parada', 'critico', ct.conta || '', 'Conta de anúncios' + (ct.conta ? ' "' + ct.conta + '"' : '') + ': ' + (ACQ13_CONTA[st] || 'situação ' + st + ' na Meta') + '. Nada roda até resolver' + (g7 <= 0 && gHoje <= 0 && ultimo ? ' (último gasto em ' + acq13Dia(ultimo) + ').' : '.'));
      }
      if (ct.erro) por(cl, 'coleta_da_conta', 'atencao', ct.conta || '', 'A leitura da conta' + (ct.conta ? ' "' + ct.conta + '"' : '') + ' falhou na Meta: ' + String(ct.erro).slice(0, 140) + '.');
    });

    // Tráfego contratado e nada rodando há 7 dias: um aviso só, com o motivo mais provável.
    var semNada = cl.trafego && !cl.interno && g7 <= 0 && gHoje <= 0;
    if (semNada && !contaRuim) {
      var prePago = contas.filter(function (ct) { return ct.pre_pago === true && ct.saldo !== null && ct.saldo !== undefined; });
      var motivo = !contas.length ? 'nenhuma conta de anúncios conectada ao painel'        : prePago.length && prePago.every(function (ct) { return acq13Num(ct.saldo) < 1; }) ? 'a conta está sem saldo'
        : !vivas.length ? 'nenhuma campanha ativa' : 'há campanha ativa, mas sem entrega';
      por(cl, 'contrato_sem_campanha', 'atencao', '', 'Tráfego contratado e nenhum anúncio rodando nos últimos 7 dias: ' + motivo + '. ' +
        (ultimo ? 'Último gasto em ' + acq13Dia(ultimo) + '.' : 'Sem gasto nos últimos 30 dias.'));
    }

    // Saldo pré-pago acabando (só para quem está gastando).
    if (!semNada && vivas.length && g7 > 0) {
      contas.forEach(function (ct) {
        if (ct.pre_pago !== true || ct.saldo === null || ct.saldo === undefined) return;
        var ritmo = Math.max(g7 / 7, g3 / 3), saldo = acq13Num(ct.saldo), dias = ritmo > 0 ? saldo / ritmo : 99;
        if (dias >= L.saldo_dias_atencao) return;
        por(cl, 'saldo_curto', dias < L.saldo_dias_critico ? 'critico' : 'atencao', ct.conta || '', saldo <= 0
          ? 'Sem saldo na conta de anúncios (ritmo de ' + acq13Reais(ritmo) + ' por dia): as campanhas param.'
          : 'Saldo de ' + acq13Reais(saldo) + ' dá para ' + (dias < 1 ? 'menos de 1 dia' : 'cerca de ' + dias.toFixed(1).replace('.', ',') + ' dias') + ' no ritmo de ' + acq13Reais(ritmo) + ' por dia.');
      });
    }

    // Teto semanal do cliente: o combinado (config) ou 7 vezes o teto diário da Rotina do painel.
    var teto = acq13Num(c13.tetos[cl.client_id]) || acq13Num(cl.teto_diario) * 7;
    if (teto > 0) {
      var gSemana = acq13Soma(camps, 'g_semana');
      if (gSemana > teto) por(cl, 'teto_semanal', 'critico', '', 'Gasto desta semana (de segunda até agora) em ' + acq13Reais(gSemana) + ', acima do teto semanal de ' + acq13Reais(teto) + '.');
      else if (g7 > teto * L.folga_do_teto) por(cl, 'teto_semanal', 'atencao', '', 'Últimos 7 dias fechados somam ' + acq13Reais(g7) + ', acima do teto semanal de ' + acq13Reais(teto) + '.');
    }

    // Campanha vencida ainda ativa. Gastando é grave; parada vira uma linha de limpeza por cliente.
    encerradas.filter(gastando).forEach(function (c) {
      por(cl, 'vencida_gastando', 'critico', c.campaign_id, '"' + c.nome + '" terminou em ' + acq13Dia(acq13DataSP(Date.parse(c.fim))) + ' e ainda aparece gastando (' + acq13Reais(c.g3) + ' em 3 dias).');
    });
    var paradasVelhas = vivas.filter(function (c) {
      return !gastando(c) && (!c.ultimo_gasto || hojeMs - acq13Meio(c.ultimo_gasto) > L.parada_recente_dias * ACQ13_DIA_MS);
    });
    var lixo = encerradas.filter(function (c) { return !gastando(c); }).length + (semNada ? 0 : paradasVelhas.length);
    if (lixo > 0) por(cl, 'limpeza', 'info', '', acq13Plural(lixo, 'campanha parada continua marcada como ativa', 'campanhas paradas continuam marcadas como ativas') + ' na Meta (terminou ou não gasta há mais de ' + L.parada_recente_dias + ' dias). Não gasta, mas suja a leitura da conta: vale desativar.');

    vivas.forEach(function (c) {
      var nomeFim = acq13FimNoNome(c.nome, hoje);
      if (gastando(c) && nomeFim && hojeMs - acq13Meio(nomeFim) > L.nome_vencido_dias * ACQ13_DIA_MS) {
        por(cl, 'periodo_vencido', 'atencao', c.campaign_id, '"' + c.nome + '": o nome diz período até ' + acq13Dia(nomeFim) + ' e a campanha segue gastando (' + acq13Reais(c.g3) + ' em 3 dias), ' +
          (c.fim ? 'com término configurado para ' + acq13Dia(acq13DataSP(Date.parse(c.fim))) : 'sem data de término') + '. Confirmar se é para continuar.');
      }
      if (c.fim && gastando(c)) {
        var faltaMs = Date.parse(c.fim) - agoraMs;
        if (faltaMs > 0 && faltaMs <= L.dias_para_terminar * ACQ13_DIA_MS) por(cl, 'terminando', 'info', c.campaign_id, '"' + c.nome + '" termina em ' + acq13Dia(acq13DataSP(Date.parse(c.fim))) + ': decidir se renova.');
      }
      // Parou de entregar há pouco (o que parou há muito tempo entra na limpeza).
      var comecou = c.inicio ? Date.parse(c.inicio) : NaN;
      var madura = !isFinite(comecou) || agoraMs - comecou >= L.dias_sem_entrega * ACQ13_DIA_MS;
      if (!semNada && madura && !gastando(c) && c.ultimo_gasto && hojeMs - acq13Meio(c.ultimo_gasto) <= L.parada_recente_dias * ACQ13_DIA_MS) {
        por(cl, 'sem_entrega', 'atencao', c.campaign_id, '"' + c.nome + '": ativa e sem gastar desde ' + acq13Dia(c.ultimo_gasto) + ' (conferir saldo, aprovação do anúncio e público).');
      }
    });

    // Custo por resultado fora do normal do próprio cliente.
    var media = r30 >= L.resultados_minimos_da_media ? g30 / r30 : null;
    camps.forEach(function (c) {
      var r7 = acq13Num(c.r7), cpr = r7 > 0 ? acq13Num(c.g7) / r7 : null;
      if (cpr !== null && media !== null && cpr > L.custo_vezes_a_media * media) {
        por(cl, 'custo_alto', 'atencao', c.campaign_id, '"' + c.nome + '": custo por resultado de ' + acq13Reais(cpr) + ' nos últimos 7 dias, mais de 2 vezes a média do cliente em 30 dias (' + acq13Reais(media) + ').');
      }
      if (acq13DeResultado(c) && gastando(c) && acq13Num(c.g_sem_resultado) >= L.gasto_sem_resultado_brl) {
        por(cl, 'gasto_sem_resultado', 'critico', c.campaign_id, '"' + c.nome + '": ' + acq13Reais(c.g_sem_resultado) + ' gastos desde o último resultado.');
      }
    });

    (cl.anuncios_com_problema || []).forEach(function (a) {
      por(cl, 'anuncio_com_problema', 'atencao', a.ad_id, 'Anúncio "' + a.anuncio + '" ' + (a.estado === 'DISAPPROVED' ? 'reprovado pela Meta' : 'com problema apontado pela Meta (reprovação ou restrição)') + ' dentro de campanha ativa. Abrir o anúncio no Gerenciador para ver o motivo.');
    });
  });

  return out.sort(function (a, b) { return ACQ13_PESO[a.nivel] - ACQ13_PESO[b.nivel] || String(a.cliente).localeCompare(String(b.cliente)) || a.chave.localeCompare(b.chave); });
}

// Quem tem tráfego rodando e não tem teto semanal combinado (pergunta para o dono, não alerta).
function acq13SemTeto(fatos, cfg) {
  var c13 = acq13Config(cfg);
  return ((fatos && fatos.clientes) || []).filter(function (cl) {
    return !cl.interno && acq13Soma(cl.campanhas, 'g7') > 0 && !(acq13Num(c13.tetos[cl.client_id]) || acq13Num(cl.teto_diario));
  }).map(function (cl) { return cl.cliente; });
}

// O boletim do radar: o que mudou primeiro. delta = retorno de acq_n8n.radar_anuncios_gravar.
// Em dia sem novidade e sem crítico aberto não grava nada (silêncio = nada mudou); segunda sempre grava, com a semana.
function acq13Boletim(fatos, alertas, delta, cfg, agoraMs) {
  var c13 = acq13Config(cfg);
  var d = delta || {}, novos = d.novos || [], continuam = d.continuam || [], resolvidos = d.resolvidos || [];
  var segunda = new Date(agoraMs - 3 * 3600000).getUTCDay() === 1;
  var criticos = alertas.filter(function (a) { return a.nivel === 'critico'; });
  var atencao = alertas.filter(function (a) { return a.nivel === 'atencao'; });
  var mudou = novos.filter(function (a) { return a.nivel !== 'info'; }).length > 0 || resolvidos.filter(function (a) { return a.nivel !== 'info'; }).length > 0;
  if (!mudou && !criticos.length && !segunda) return { gravar: false, motivo: 'nada mudou e nenhum crítico aberto' };

  var desde = {};
  continuam.forEach(function (a) { desde[a.chave] = a.desde; });
  var ehNovo = {};
  novos.forEach(function (a) { ehNovo[a.chave] = true; });
  var linha = function (a) {
    return a.cliente + ': ' + a.texto + (ehNovo[a.chave] ? '' : desde[a.chave] ? ' (aberto desde ' + acq13Dia(acq13DataSP(Date.parse(desde[a.chave]))) + ')' : '');
  };
  var clientes = {};
  criticos.concat(atencao).forEach(function (a) { clientes[a.cliente] = true; });
  var partes = [];
  partes.push(criticos.length || atencao.length
    ? 'Radar: ' + [criticos.length ? acq13Plural(criticos.length, 'crítico', 'críticos') : null, atencao.length ? atencao.length + ' de atenção' : null].filter(Boolean).join(' e ') + ' em ' + acq13Plural(Object.keys(clientes).length, 'cliente', 'clientes') + '.'
    : 'Radar: nada fora do normal nos anúncios.');
  var nNovos = novos.filter(function (a) { return a.nivel !== 'info'; }).length, nRes = resolvidos.filter(function (a) { return a.nivel !== 'info'; }).length;
  if (nNovos || nRes) partes.push('Desde a última leitura: ' + [nNovos ? acq13Plural(nNovos, 'novo', 'novos') : null, nRes ? acq13Plural(nRes, 'resolvido', 'resolvidos') : null].filter(Boolean).join(' e ') + '.');
  if (criticos.length) partes.push('Mais urgente: ' + linha(criticos[0]).slice(0, 220));
  var semana = d.semana || null;
  if (segunda && semana) partes.push('Semana: ' + acq13Num(semana.abertos) + ' abertos, ' + acq13Num(semana.resolvidos) + ' resolvidos, ' + acq13Num(semana.em_aberto) + ' em aberto.');

  var semTeto = acq13SemTeto(fatos, cfg);
  var bloco = function (titulo, lista, f) { return lista.length ? [titulo].concat(lista.map(function (a) { return '- [' + a.nivel + '] ' + (f || linha)(a); }), ['']) : []; };
  var abertosNaoInfo = alertas.filter(function (a) { return a.nivel !== 'info'; });
  var texto = [partes.join(' '), '', 'Corte da coleta: ' + (fatos.coleta && fatos.coleta.diario_em ? acq13HoraSP(Date.parse(fatos.coleta.diario_em)) : 'desconhecido') + '.', '']
    .concat(bloco('NOVOS', abertosNaoInfo.filter(function (a) { return ehNovo[a.chave]; })))
    .concat(bloco('CONTINUAM', abertosNaoInfo.filter(function (a) { return !ehNovo[a.chave]; })))
    .concat(bloco('RESOLVIDOS', resolvidos.filter(function (a) { return a.nivel !== 'info'; }), function (a) { return a.cliente + ': ' + a.texto; }))
    .concat(bloco('LIMPEZA (sem urgência)', alertas.filter(function (a) { return a.nivel === 'info'; })))
    .concat(segunda && semana && (semana.mais_antigos || []).length ? ['ABERTOS HÁ MAIS TEMPO'].concat(semana.mais_antigos.map(function (a) { return '- ' + a.cliente + ' (desde ' + acq13Dia(acq13DataSP(Date.parse(a.desde))) + '): ' + a.texto; }), ['']) : [])
    .concat(semTeto.length ? ['Sem teto semanal combinado (a regra do teto não roda para eles): ' + semTeto.join(', ') + '.', ''] : [])
    .concat(['Regras fixas, sem IA: conta parada na Meta, saldo para menos de 3 dias, teto semanal, campanha vencida ou com período vencido no nome ainda gastando, R$ 50 sem resultado, custo acima de 2 vezes a média do cliente, anúncio com problema, campanha que parou de entregar, tráfego contratado sem nada rodando, coleta parada e acesso da Meta perto de vencer. O radar só lê e avisa.']);

  var porCliente = ((fatos && fatos.clientes) || []).filter(function (cl) { return acq13Soma(cl.campanhas, 'g7') > 0; }).map(function (cl) {
    return { client_id: cl.client_id, gasto: Math.round(acq13Soma(cl.campanhas, 'g7') * 100) / 100, resultado: acq13Soma(cl.campanhas, 'r7'),
      observacao: '7 dias fechados; nos 7 anteriores: ' + acq13Reais(acq13Soma(cl.campanhas, 'g7ant')) + ' e ' + acq13Plural(acq13Soma(cl.campanhas, 'r7ant'), 'resultado', 'resultados') };
  });
  return { gravar: true, argumentos: {
    periodo: 'radar', resumo: partes.join(' ').slice(0, 1900),
    alertas: novos.filter(function (a) { return a.nivel !== 'info'; }).concat(abertosNaoInfo.filter(function (a) { return !ehNovo[a.chave]; })).concat(alertas.filter(function (a) { return a.nivel === 'info'; })).slice(0, 60)
      .map(function (a) { var o = { nivel: a.nivel, texto: ((ehNovo[a.chave] ? 'Novo. ' : '') + linha(a)).slice(0, 600) }; if (a.client_id) o.client_id = a.client_id; return o; }),
    por_cliente: porCliente.slice(0, 80), texto_completo: texto.join('\n').slice(0, 39000), operator: c13.operador } };
}

function acq13Rpc(ferramenta, argumentos, semente) {
  return { jsonrpc: '2.0', id: acqSha256(ferramenta + '|' + semente).slice(0, 12), method: 'tools/call', params: { name: ferramenta, arguments: argumentos } };
}

// ---------------------------------------------------------------- relatório do cliente (prévia)
// Bloco de anúncios para o cliente: só o lado favorável, sem valor investido (regra do dono de 11/11), com a
// comparação com os 7 dias anteriores quando ela ajuda. Devolve null quando não há o que dizer de bom com número
// da fonte. Cada frase leva os números usados, para a conferência por busca exata.
function acq13BlocoDoCliente(cl, hojeIso) {
  var camps = (cl && cl.campanhas) || [];
  var fimMs = acq13Meio(hojeIso || acq13DataSP(Date.now())) - ACQ13_DIA_MS;
  var periodo = 'de ' + acq13Dia(new Date(fimMs - 6 * ACQ13_DIA_MS).toISOString()) + ' a ' + acq13Dia(new Date(fimMs).toISOString());
  var r7 = acq13Soma(camps, 'r7'), r7ant = acq13Soma(camps, 'r7ant'), imp7 = acq13Soma(camps, 'imp7'), imp7ant = acq13Soma(camps, 'imp7ant');
  var clk7 = acq13Soma(camps, 'clk7'), clk7ant = acq13Soma(camps, 'clk7ant');
  var ativos = camps.filter(function (c) { return acq13Num(c.g3) > 0 || acq13Num(c.g_hoje) > 0; }).length;
  if (acq13Soma(camps, 'g7') <= 0) return null;
  var frases = [], numeros = [];
  var mil = function (n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); };
  if (r7 > 0) {
    frases.push(r7ant > 0 && r7 > r7ant ? acq13Plural(r7, 'contato novo chegou', 'contatos novos chegaram') + ' pelos anúncios ' + periodo + ', contra ' + r7ant + ' na semana anterior.'
      : acq13Plural(r7, 'contato novo chegou', 'contatos novos chegaram') + ' pelos anúncios ' + periodo + '.');
    numeros.push(r7); if (r7ant > 0 && r7 > r7ant) numeros.push(r7ant);
  }
  if (imp7 > 0) {
    frases.push(imp7ant > 0 && imp7 > imp7ant * 1.05 ? 'Os anúncios apareceram ' + mil(imp7) + ' vezes, acima das ' + mil(imp7ant) + ' da semana anterior.' : 'Os anúncios apareceram ' + mil(imp7) + ' vezes no período.');
    numeros.push(mil(imp7)); if (imp7ant > 0 && imp7 > imp7ant * 1.05) numeros.push(mil(imp7ant));
  }
  if (r7 <= 0 && clk7 > 0) { frases.push(clk7ant > 0 && clk7 > clk7ant ? mil(clk7) + ' pessoas clicaram para saber mais, contra ' + mil(clk7ant) + ' na semana anterior.' : mil(clk7) + ' pessoas clicaram para saber mais.'); numeros.push(mil(clk7)); }
  if (ativos > 0) { frases.push(acq13Plural(ativos, 'campanha segue no ar', 'campanhas seguem no ar') + '.'); numeros.push(ativos); }
  return frases.length ? { titulo: '*Anúncios*', periodo: periodo, frases: frases, texto: '*Anúncios*\n' + frases.join(' '), numeros: numeros } : null;
}
