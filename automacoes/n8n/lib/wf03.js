// ACQ-03 — Post no ar, link, print e mensagem (JS puro; depende de nucleo.js).
// Publicação só conta com status published + published_at + permalink + conta certa + prova
// atual (social_post_metrics). scheduled, ready e tarefa done não são publicação.

var ACQ03_SOBREPOSICAO_HORAS = 6;
var ACQ03_PROVA_PENDENTE_MAX_HORAS = 24;

function acq03PedidosLeitura(clientes, cursorDesde, agoraMs) {
  var hoje = acqAgoraSP(agoraMs).data;
  var desdeMs = cursorDesde ? Date.parse(cursorDesde) - ACQ03_SOBREPOSICAO_HORAS * 3600000 : agoraMs - 2 * 86400000;
  var desde = acqAgoraSP(desdeMs).data;
  var out = [];
  clientes.forEach(function (cid) {
    out.push({ ref: cid + '|calendario', ferramenta: 'aceleriq_list_editorial_calendar', paginar: true,
      argumentos: { client_id: cid, publication_status: 'published', date_from: desde, date_to: hoje, include_unscheduled: false, limit: 100 } });
    out.push({ ref: cid + '|posts', ferramenta: 'aceleriq_list_social_posts', argumentos: { client_id: cid, limit: 25 } });
  });
  return out;
}

// Extrai publicações (uma por publication_id) do calendário.
function acq03Publicacoes(itensCalendario, clientId) {
  var out = [];
  (itensCalendario || []).forEach(function (it) {
    if (it.kind !== 'editorial_post' || !it.post) return;
    (it.post.publications || []).forEach(function (p) {
      out.push({ client_id: clientId, project_id: p.project_id || (it.project && it.project.id) || null, projeto: it.project ? it.project.name : null,
        post_id: it.post.id, titulo: it.post.title, objetivo: it.post.objective || null, legenda: p.caption || it.post.default_caption || null,
        content_type: it.post.content_type, publication_id: p.id, status: p.status, platform: p.platform,
        external_account_id: p.external_account_id, conta: p.account || null, published_at: p.published_at || null,
        scheduled_at: p.scheduled_at || null, permalink: p.permalink || null });
    });
  });
  return out;
}

// Contas por projeto e plataforma, vistas no próprio calendário (para detectar ambiguidade).
function acq03ContasPorProjeto(pubs) {
  var m = {};
  pubs.forEach(function (p) {
    if (!p.conta || !p.project_id) return;
    var k = p.project_id + '|' + p.platform;
    m[k] = m[k] || {};
    m[k][p.conta.id || p.external_account_id] = p.conta;
  });
  return m;
}

function acq03PermalinkValido(platform, url) {
  if (!url) return false;
  if (platform === 'instagram') return /^https:\/\/(www\.)?instagram\.com\/(p|reel|tv)\/[A-Za-z0-9_-]+\/?$/.test(url);
  if (platform === 'facebook') return /^https:\/\/(www\.|m\.)?facebook\.com\//.test(url);
  return /^https:\/\//.test(url);
}

function acq03NormalizarPermalink(u) { return String(u || '').replace(/^https:\/\/instagram\.com/, 'https://www.instagram.com').replace(/\/?$/, '/'); }

// Valida uma publicação. contasExtras: contas conhecidas do projeto (ex.: CME com duas contas).
function acq03Validar(p, posts, contasPorProjeto, agoraMs) {
  var r = { publication_id: p.publication_id, estado: null, motivo: null, platform_media_id: null, prova: null };
  if (p.status !== 'published') { r.estado = 'ignorar'; r.motivo = 'status_' + p.status + '_nao_e_publicacao'; return r; }
  if (!p.published_at) { r.estado = 'revisao'; r.motivo = 'published_sem_published_at'; return r; }
  if (!acq03PermalinkValido(p.platform, p.permalink)) { r.estado = 'revisao'; r.motivo = 'permalink_invalido_para_' + p.platform; return r; }
  if (!p.conta || !p.external_account_id) { r.estado = 'revisao'; r.motivo = 'publicacao_sem_conta'; return r; }
  if (p.conta.status && p.conta.status !== 'active') { r.estado = 'revisao'; r.motivo = 'conta_inativa'; return r; }
  if (p.conta.platform && p.conta.platform !== p.platform) { r.estado = 'revisao'; r.motivo = 'conta_de_outra_plataforma'; return r; }
  var contas = contasPorProjeto[p.project_id + '|' + p.platform] || {};
  var ativas = Object.keys(contas).filter(function (k) { return !contas[k].status || contas[k].status === 'active'; });
  if (ativas.length > 1) { r.estado = 'revisao'; r.motivo = 'projeto_com_mais_de_uma_conta_' + p.platform + ': ' + ativas.length; return r; }
  // Prova atual: o mesmo permalink na coleta do Instagram (social_post_metrics), da mesma conta.
  var alvo = acq03NormalizarPermalink(p.permalink);
  var prova = (posts || []).filter(function (x) { return acq03NormalizarPermalink(x.permalink) === alvo; })[0];
  if (!prova) {
    var horas = (agoraMs - Date.parse(p.published_at)) / 3600000;
    r.estado = horas > ACQ03_PROVA_PENDENTE_MAX_HORAS ? 'revisao' : 'prova_pendente';
    r.motivo = horas > ACQ03_PROVA_PENDENTE_MAX_HORAS ? 'sem_prova_na_coleta_apos_24h' : 'aguardando_coleta_de_metricas';
    return r;
  }
  if (prova.external_account_id && prova.external_account_id !== p.external_account_id) { r.estado = 'revisao'; r.motivo = 'permalink_de_outra_conta'; return r; }
  if (prova.posted_at && Math.abs(Date.parse(prova.posted_at) - Date.parse(p.published_at)) > 6 * 3600000) { r.estado = 'revisao'; r.motivo = 'horario_da_prova_diverge_do_painel'; return r; }
  r.estado = 'valida';
  r.platform_media_id = prova.media_id;
  r.prova = { media_id: prova.media_id, permalink: prova.permalink, posted_at: prova.posted_at, captured_at: prova.captured_at, media_type: prova.media_type };
  return r;
}

// Primeira ativação: inicializa o cursor sem anunciar o histórico.
function acq03Detectar(pubs, cursor, eventosVistos, agoraMs) {
  var vistos = {};
  (eventosVistos || []).forEach(function (k) { vistos[k] = true; });
  if (!cursor || !cursor.existe) {
    return { inicializar: true, novas: [], historico_ignorado: pubs.filter(function (p) { return p.status === 'published'; }).length,
      novo_cursor: { desde: new Date(agoraMs).toISOString() } };
  }
  var desde = Date.parse(cursor.valor.desde) - ACQ03_SOBREPOSICAO_HORAS * 3600000;
  var novas = pubs.filter(function (p) {
    return p.status === 'published' && p.published_at && Date.parse(p.published_at) >= desde && !vistos[acq03ChaveEvento(p)];
  });
  return { inicializar: false, novas: novas, historico_ignorado: 0, novo_cursor: { desde: new Date(agoraMs).toISOString() } };
}

function acq03ChaveEvento(p) { return 'pub:' + p.publication_id + ':' + (p.permalink || ''); }

// Captura do perfil: falha explícita para login, perfil errado ou timeout. Fixture nunca vira captura real.
function acq03ValidarCaptura(cap, handle) {
  if (!cap) return { ok: false, motivo: 'sem_captura' };
  if (cap.erro) return { ok: false, motivo: /timeout|tempo/i.test(cap.erro) ? 'timeout' : 'erro: ' + String(cap.erro).slice(0, 120) };
  var url = String(cap.url || ''), titulo = String(cap.titulo || '');
  if (/accounts\/login|\/login\b/i.test(url) || /log in|entrar|faça login/i.test(titulo)) return { ok: false, motivo: 'tela_de_login' };
  var h = String(handle || '').replace(/^@/, '').toLowerCase();
  if (!h || url.toLowerCase().indexOf('instagram.com/' + h) < 0) return { ok: false, motivo: 'perfil_errado' };
  if (!cap.file_id && !cap.arquivo) return { ok: false, motivo: 'captura_sem_arquivo' };
  return { ok: true, fixture: cap.fixture === true, screenshot_file_id: cap.file_id || null, arquivo: cap.arquivo || null };
}

// Comparação de alcance só com períodos comparáveis: post com 48h+ contra a mediana dos 4 anteriores
// do mesmo tipo, todos coletados também com 48h+. Sem isso, nenhuma frase de crescimento.
function acq03Comparacao(prova, posts, agoraMs) {
  if (!prova || !prova.posted_at) return null;
  var idade = (agoraMs - Date.parse(prova.posted_at)) / 3600000;
  if (idade < 48) return { comparavel: false, motivo: 'post_com_menos_de_48h' };
  var atual = (posts || []).filter(function (x) { return x.media_id === prova.media_id; })[0];
  var ant = (posts || []).filter(function (x) {
    return x.media_id !== prova.media_id && x.media_type === prova.media_type && Date.parse(x.posted_at) < Date.parse(prova.posted_at) &&
      (Date.parse(x.captured_at) - Date.parse(x.posted_at)) / 3600000 >= 48 && typeof x.reach === 'number';
  }).slice(0, 4);
  if (!atual || typeof atual.reach !== 'number' || ant.length < 3) return { comparavel: false, motivo: 'sem_base_comparavel' };
  var rs = ant.map(function (x) { return x.reach; }).sort(function (a, b) { return a - b; });
  var med = rs.length % 2 ? rs[(rs.length - 1) / 2] : (rs[rs.length / 2 - 1] + rs[rs.length / 2]) / 2;
  return { comparavel: true, alcance: atual.reach, mediana_anteriores: med, base: ant.length, acima: atual.reach > med * 1.2 };
}

function acq03Mensagem(p, validacao, comparacao) {
  var tema = p.titulo ? String(p.titulo).replace(/\.+$/, '') : 'novo conteúdo';
  var objetivo = p.objetivo ? acq03ObjetivoCurto(p.objetivo) : null;
  var linhas = ['Post novo no ar: ' + tema + '.', p.permalink];
  if (objetivo) linhas.push(objetivo);
  if (comparacao && comparacao.comparavel && comparacao.acima) {
    linhas.push('Alcance de ' + comparacao.alcance + ' contas, acima da média recente do perfil (' + comparacao.mediana_anteriores + ').');
  }
  return { texto: linhas.join('\n'), afirma_crescimento: Boolean(comparacao && comparacao.comparavel && comparacao.acima) };
}

// Aviso na Revisão do Ciclo (MCP 2.10.0). Canal portal até o envio por WhatsApp oficial ser decidido;
// o painel congela texto e destino, e o dono aprova. A chave é estável por post e link.
function acq03PedidoAviso(p, mensagem, operador) {
  return { ref: p.publication_id + '|aviso', ferramenta: 'aceleriq_aviso_publicacao_preparar', client_id_escopo: p.client_id, argumentos: {
    operator: operador, publication_id: p.publication_id, mensagem: String(mensagem || '').slice(0, 2000), channel: 'portal',
    idempotency_key: 'acq03:' + p.publication_id + ':' + acqSha256(p.permalink || '').slice(0, 12) + ':aviso' } };
}

// Estado da proposta local a partir da resposta do painel.
function acq03EstadoDoAviso(r) {
  if (!r) return { estado: 'bloqueada', motivo: 'revisao_sem_resposta', aviso_id: null };
  if (r.ok && r.simulado) return { estado: 'proposta', motivo: 'aviso_simulado_dry_run', aviso_id: null };
  if (r.ok) return { estado: 'em_revisao', motivo: null, aviso_id: (r.resultado && r.resultado.id) || null };
  var msg = String((r.erro && r.erro.mensagem) || '');
  if (/AVISO_JA_EXISTE/.test(msg)) return { estado: 'descartada', motivo: 'aviso_ja_existe_no_painel', aviso_id: null };
  if (/AVISO_POST_NAO_PUBLICADO/.test(msg)) return { estado: 'bloqueada', motivo: 'post_nao_publicado_no_painel', aviso_id: null };
  return { estado: 'bloqueada', motivo: 'revisao_' + ((r.erro && r.erro.tipo) || 'erro'), aviso_id: null };
}

// O objetivo cadastrado vira uma frase útil e curta; texto interno ("Arte do Estúdio (Mesa...)") sai.
function acq03ObjetivoCurto(obj) {
  var frases = String(obj).split(/(?<=[.!?])\s+/).map(function (s) { return s.trim(); })
    .filter(function (s) { return s && !/Arte do Est[úu]dio|Mesa do cliente|^Post direto/i.test(s); });
  var util = frases.filter(function (s) { return /apresenta|mostra|convida|ajuda|explica|orienta|lembra/i.test(s); })[0] || frases[0];
  return util ? util.replace(/^\w/, function (c) { return c.toUpperCase(); }) : null;
}

// Reconciliação diária (sem agendar nem republicar): exceções vão para o ACQ-05.
function acq03ExcecoesEditoriais(clientId, agenda, pubsAgendadasPassadas, agoraMs) {
  var ex = [];
  var ag = agenda || {};
  if (!(ag.scheduled || []).length && !(ag.ready_without_date || []).length) ex.push({ tipo: 'agenda_vazia', client_id: clientId, detalhe: ag.diagnosis || null });
  if ((ag.ready_without_date || []).length) ex.push({ tipo: 'prontas_sem_data', client_id: clientId, quantidade: ag.ready_without_date.length, itens: ag.ready_without_date.map(function (x) { return x.id; }) });
  (pubsAgendadasPassadas || []).forEach(function (p) {
    if ((p.status === 'scheduled' || p.status === 'failed') && p.scheduled_at && Date.parse(p.scheduled_at) < agoraMs - 2 * 3600000) {
      ex.push({ tipo: 'data_perdida', client_id: clientId, publication_id: p.publication_id, scheduled_at: p.scheduled_at, status: p.status });
    }
  });
  return ex;
}
