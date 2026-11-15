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
// dispensaProva (10/11, dono): aviso no grupo sai assim que o painel marca publicado; não espera a coleta de métricas.
function acq03Validar(p, posts, contasPorProjeto, agoraMs, dispensaProva) {
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
  if (!prova && dispensaProva) { r.estado = 'valida'; r.motivo = 'publicado_no_painel_sem_coleta'; return r; }
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

// ---- 09/11/2026 (dono): o aviso vai para o grupo do cliente no WhatsApp e sai sozinho depois de publicado.
// O texto nasce da legenda publicada (título e objetivo do painel têm linguagem interna: "Arte do Estúdio...",
// "[ACERBI | 03/11] Carrossel", "sem texto pesado"). Modelo escreve, código e Jev conferem; falhou, vai o texto seguro.

var ACQ03_INTERNO_RE = /arte do est[úu]dio|mesa do cliente|sem texto pesado|post direto|\bP\d{3}\b|\bAD\d{2}\b|tarefa [0-9a-f]{6,}|\bv\d\b|tipogr[áa]fic|\b4:5\b|\b9:16\b|\bCTA\b|\breel motion\b|\bbriefing\b|\blâmina|\bpe[çc]a est[áa]tica/i;

function acq03PostNoAr(cfg) {
  var c = (cfg && cfg.post_no_ar) || {};
  return { ativo: c.ativo === true, so_com_grupo: c.so_com_grupo !== false, grupos: c.grupos || {}, llm_url: c.llm_url || null, llm_modelo: c.llm_modelo || null };
}

// Nome exato do grupo do cliente (a ponte confere de novo ao vivo antes de enviar). Sem grupo: null.
function acq03Grupo(cfg, clientId) {
  var c = acq03PostNoAr(cfg);
  var n = c.ativo ? c.grupos[clientId] : null;
  return n ? String(n) : null;
}

// Primeira frase da legenda publicada, sem hashtag nem quebra: já passou pela aprovação do cliente.
function acq03PrimeiraFrase(legenda) {
  var t = String(legenda || '').replace(/#[^\s#]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  var m = t.match(/^(.{12,180}?[.!?…])(\s|$)/);
  var f = (m ? m[1] : t.slice(0, 160)).trim();
  return f.length >= 8 ? f : null;
}

// Texto seguro, sem modelo.
function acq03MensagemSegura(p) {
  var f = acq03PrimeiraFrase(p.legenda);
  return ['*Post novo no ar*', f || 'Conteúdo novo publicado no perfil.', p.permalink].join('\n\n');
}

function acq03PedidoRedacao(p, cfg) {
  var c = acq03PostNoAr(cfg);
  var tipo = { carousel: 'carrossel', reel: 'reel', video: 'reel', static: 'post', story: 'story' }[p.content_type] || 'post';
  var sistema = [
    'Você escreve, para o grupo de WhatsApp de um cliente da Aceleriq (empresa de marketing), o aviso de que um conteúdo dele acabou de ser publicado no Instagram.',
    'Leia a legenda publicada e devolva dois campos, em português do Brasil, simples e direto, como a equipe falaria com o dono do negócio:',
    '- tema: do que o conteúdo trata, em até 12 palavras, sem ponto final, sem aspas, sem emoji.',
    '- o_que_esperar: uma frase curta, começando por "A ideia é", dizendo para que o conteúdo serve para o negócio (por exemplo lembrar, tirar uma dúvida comum, mostrar um trabalho, chamar para pedir orçamento). Use só o que a legenda e o objetivo sustentam. Se não der para saber, devolva "".',
    'Nunca prometa resultado, alcance, vendas ou número. Não invente dado, preço, prazo ou nome que não esteja na legenda.',
    'Não use linguagem interna de produção: nada de "Arte do Estúdio", "Mesa do cliente", código de tarefa, formato (4:5, tipográfico), "CTA", "briefing". Não cite o link.',
    'Responda só em JSON: {"tema":"...","o_que_esperar":"..."}',
  ].join('\n');
  var usuario = JSON.stringify({ tipo: tipo, legenda_publicada: String(p.legenda || '').slice(0, 2200), objetivo_interno: p.objetivo ? acq03ObjetivoCurto(p.objetivo) : null });
  return { model: c.llm_modelo, messages: [{ role: 'system', content: sistema }, { role: 'user', content: usuario }], max_tokens: 400, temperature: 0.3,
    response_format: { type: 'json_schema', json_schema: { name: 'aviso', strict: true, schema: { type: 'object', additionalProperties: false, required: ['tema', 'o_que_esperar'],
      properties: { tema: { type: 'string' }, o_que_esperar: { type: 'string' } } } } } };
}

// Confere o que o modelo devolveu. Número só se estiver na legenda; nada de link, promessa ou jargão.
function acq03LerRedacao(resposta, p) {
  if (!String(p.legenda || '').trim()) return { ok: false, motivo: 'sem_legenda' };
  if (!resposta || resposta.error) return { ok: false, motivo: 'modelo_indisponivel' };
  var bruto = resposta.choices && resposta.choices[0] && resposta.choices[0].message && resposta.choices[0].message.content;
  var j = null, s = String(bruto || ''), a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { j = JSON.parse(s.slice(a, b + 1)); } catch (e) { j = null; } }
  if (!j || typeof j.tema !== 'string') return { ok: false, motivo: 'json_invalido' };
  var limpar = function (t) { return String(t || '').replace(/\*+/g, '').replace(/\s+/g, ' ').replace(/^["“]|["”]$/g, '').trim(); };
  var tema = limpar(j.tema).replace(/[.]+$/, ''), esperar = limpar(j.o_que_esperar);
  if (tema.length < 6 || tema.length > 120) return { ok: false, motivo: 'tema_fora_do_tamanho' };
  if (esperar.length > 220) return { ok: false, motivo: 'esperar_longo' };
  var tudo = tema + ' ' + esperar;
  if (/https?:\/\/|www\.|\.com\b/i.test(tudo)) return { ok: false, motivo: 'tem_link' };
  if (ACQ03_INTERNO_RE.test(tudo)) return { ok: false, motivo: 'linguagem_interna' };
  if (/garant|com certeza vai|vai (vender|bombar|viralizar)|resultado certo/i.test(tudo)) return { ok: false, motivo: 'promessa' };
  var fonte = String(p.legenda || '') + ' ' + String(p.objetivo || '');
  var numeros = tudo.match(/\d[\d.,]*/g) || [];
  if (numeros.some(function (n) { return fonte.indexOf(n.replace(/[.,]$/, '')) < 0; })) return { ok: false, motivo: 'numero_fora_da_legenda' };
  return { ok: true, tema: tema, esperar: esperar || null };
}

// Jev confere o texto contra a legenda (julgamento sobre linguagem: não é regra de código).
function acq03PedidoConferencia(p, red) {
  return { model: 'jev-latest',
    state: { legenda_publicada: String(p.legenda || '').slice(0, 2200), objetivo_do_post: p.objetivo ? acq03ObjetivoCurto(p.objetivo) : null,
      aviso: { tema: red && red.ok ? red.tema : '', o_que_esperar: red && red.ok ? (red.esperar || '') : '' } },
    questions: {
      fiel: { type: 'noul', instructions: 'O `aviso.tema` descreve corretamente o assunto de `legenda_publicada`, e `aviso.o_que_esperar` (quando preenchido) é sustentado por `legenda_publicada` ou `objetivo_do_post`?',
        criteria: { true: 'Tudo o que o aviso afirma está na legenda ou no objetivo, mesmo com outras palavras.', false: 'O aviso fala de outro assunto, ou afirma fato, número, promoção ou intenção que não aparece na legenda nem no objetivo.' } },
      promessa: { type: 'noul', instructions: 'O `aviso` promete ou sugere resultado para o negócio (vendas, clientes, alcance, crescimento) como algo que vai acontecer?',
        criteria: { true: 'Diz ou insinua que o post vai trazer resultado.', false: 'Só diz do que o post trata e para que ele serve, sem prometer resultado.' } },
      interno: { type: 'noul', instructions: 'O `aviso` usa linguagem interna de quem produziu o conteúdo, que o dono do negócio não deveria ler (nome de ferramenta, código de tarefa, instrução de design ou de formato)?' },
    } };
}

function acq03LerConferencia(resposta) {
  var a = (resposta && resposta.answers) || {};
  var n = function (k) { return a[k] && typeof a[k].noul === 'number' ? a[k].noul : null; };
  var fiel = n('fiel'), promessa = n('promessa'), interno = n('interno');
  if (fiel === null || promessa === null || interno === null) return { ok: false, motivo: 'jev_indisponivel' };
  if (fiel < 0.7) return { ok: false, motivo: 'jev_nao_fiel:' + fiel };
  if (promessa > 0.35) return { ok: false, motivo: 'jev_promessa:' + promessa };
  if (interno > 0.35) return { ok: false, motivo: 'jev_interno:' + interno };
  return { ok: true, fiel: fiel, promessa: promessa, interno: interno };
}

// A mensagem do grupo: redigida só se o código e o Jev aprovaram; senão, a segura.
function acq03MensagemGrupo(p, red, conf) {
  if (!red || !red.ok) return { texto: acq03MensagemSegura(p), origem: 'segura', motivo: (red && red.motivo) || 'sem_redacao' };
  if (!conf || !conf.ok) return { texto: acq03MensagemSegura(p), origem: 'segura', motivo: (conf && conf.motivo) || 'sem_conferencia' };
  // 09/11 (dono): blocos separados por linha em branco e rótulos em negrito, para não ficar empilhado no WhatsApp.
  var linhas = ['*Post novo no ar*', '*Tema:* ' + red.tema];
  if (red.esperar) linhas.push('*O que esperar:* ' + red.esperar);
  linhas.push(p.permalink);
  return { texto: linhas.join('\n\n'), origem: 'redigida', motivo: null };
}

// Mesmo pedido do aviso, com destino no grupo. Chave própria: mudar o destino não reaproveita o aviso do portal.
function acq03PedidoAvisoGrupo(p, mensagem, operador, grupo) {
  return { ref: p.publication_id + '|aviso', ferramenta: 'aceleriq_aviso_publicacao_preparar', client_id_escopo: p.client_id, argumentos: {
    operator: operador, publication_id: p.publication_id, mensagem: String(mensagem || '').slice(0, 2000), channel: 'whatsapp', recipient: String(grupo).slice(0, 250),
    // a chave leva o texto: o modelo pode escrever diferente numa nova tentativa, e chave igual com texto diferente o painel recusa.
    idempotency_key: 'acq03:' + p.publication_id + ':' + acqSha256(p.permalink || '').slice(0, 12) + ':grupo:' + acqSha256(String(mensagem || '')).slice(0, 10) } };
}
