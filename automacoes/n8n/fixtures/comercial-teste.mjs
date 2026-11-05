// Mundo FALSO do comercial para os testes do ACQ-06/07: um painel (MCP) em memória com as mesmas regras
// das ferramentas aceleriq_comercial_* do MCP 2.23 (teto, horário, nao_contatar, id_externo, Caixa de 6 h,
// qualificação que soma, detecção de "pare"), a Cloud API da Meta, o Jev e o modelo de linguagem.
// Nenhum dado real: nomes, números e ids são inventados.

export const LEADS = {
  pronto: '0a000000-0000-4000-8000-000000000001',
  naoContatar: '0a000000-0000-4000-8000-000000000002',
  siteCliente: '0a000000-0000-4000-8000-000000000003',
  fixo: '0a000000-0000-4000-8000-000000000004',
  comSite: '0a000000-0000-4000-8000-000000000005',
  segundo: '0a000000-0000-4000-8000-000000000006',
};

const maquina = (extra) => Object.assign({ fonte: 'maquina_de_leads', nicho: 'pet shop', cidade: 'Campinas/SP', site: null, instagram: null, whatsapp_confirmado: true, encaixe_jev: 7 }, extra || {});

export function leadsPadrao() {
  return [
    { id: LEADS.pronto, name: 'Pet Shop Exemplo', company: 'Pet Shop Exemplo', whatsapp: '(19) 99876-5432', origin: 'maquina_de_leads', stage: 'novo', qualificacao: maquina({ instagram: '@petexemplo', encaixe_jev: 8 }) },
    { id: LEADS.naoContatar, name: 'Clínica Teste', company: 'Clínica Teste', whatsapp: '19998887777', origin: 'maquina_de_leads', stage: 'novo', qualificacao: maquina({ nao_contatar: 'sim' }) },
    { id: LEADS.siteCliente, name: 'Lead do site da cliente', company: null, whatsapp: '19997776666', origin: 'site', stage: 'novo', qualificacao: { client_id: '11111111-1111-4111-8111-111111111111' } },
    { id: LEADS.fixo, name: 'Padaria Fixo', company: 'Padaria Fixo', whatsapp: '(19) 3232-4545', origin: 'maquina_de_leads', stage: 'novo', qualificacao: maquina({ whatsapp_confirmado: false }) },
    { id: LEADS.comSite, name: 'Academia Com Site', company: 'Academia Com Site', whatsapp: '19995554444', origin: 'maquina_de_leads', stage: 'novo', qualificacao: maquina({ site: 'https://academia.exemplo' }) },
    { id: LEADS.segundo, name: 'Salão Segundo', company: 'Salão Segundo', whatsapp: '+55 19 99111-2222', origin: 'maquina_de_leads', stage: 'novo', qualificacao: maquina({ encaixe_jev: 5 }) },
  ];
}

const sem = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const FORTES = ['descadastrar', 'descadastre', 'nao me mande', 'nao mande mais', 'nao entre em contato', 'me tira da lista', 'me tire da lista', 'cancelar contato', 'para de me mandar', 'pare de me mandar'];
const MEDIAS = ['nao quero', 'sem interesse', 'nao tenho interesse', 'me tira', 'me tire', 'bloquear', 'para de', 'pare de'];
const FRACAS = ['parar', 'pare', 'sair', 'stop', 'remover', 'remova'];
function pedeParaParar(texto) {
  const t = sem(texto).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  const n = t.split(' ').length;
  const tem = (f) => (' ' + t + ' ').indexOf(' ' + f + ' ') >= 0;
  return FORTES.some(tem) || (n <= 8 && MEDIAS.some(tem)) || (n <= 3 && FRACAS.some(tem));
}

function horaSP(ms) {
  const d = new Date(ms - 3 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return { data: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`, hora: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` };
}

export function criarMundo(opcoes = {}) {
  const m = {
    agoraMs: opcoes.agoraMs || Date.parse('2026-11-03T13:00:00Z'), // terça, 10h em São Paulo
    config: { ativo: true, horario_inicio: '09:00', horario_fim: '18:00', limite_primeiros_contatos_dia: 20,
      orientacoes: 'Fale como a Aceleriq. Entrada no Brasil: Diagnóstico gratuito do site. Preço só na segunda mensagem. Agenda: https://aceleriq.com/agenda' },
    leads: (opcoes.leads || leadsPadrao()).map((l) => Object.assign({ agente_slug: 'mercurio' }, l)),
    mensagens: [], primeiros: [], handoffs: [], updates: [], chamadas: [], falhas: {},
    meta: { modo: 'ok', enviadas: [], n: 0 }, jevFalha: false, llm: { texto: 'Que bom! Vou preparar o diagnóstico do site de vocês e a equipe da Aceleriq fala com você ainda hoje. Qual o melhor horário?', chamadas: 0 },
  };

  const lead = (id) => m.leads.find((l) => l.id === id);
  const naoContatar = (l) => ['sim', true, 'true'].indexOf((l.qualificacao || {}).nao_contatar) >= 0;
  function regra() {
    const a = horaSP(m.agoraMs);
    const feitos = m.primeiros.filter((p) => horaSP(p.em).data === a.data).length;
    return { ativo: m.config.ativo, horario: `${m.config.horario_inicio} a ${m.config.horario_fim} (Sao Paulo)`, agora: a.hora,
      dentro_do_horario: a.hora >= m.config.horario_inicio && a.hora < m.config.horario_fim, limite_primeiros_contatos_dia: m.config.limite_primeiros_contatos_dia,
      primeiros_contatos_hoje: feitos, restam_hoje: Math.max(0, m.config.limite_primeiros_contatos_dia - feitos), orientacoes: m.config.orientacoes };
  }
  const ferramentas = {
    aceleriq_comercial_fila() {
      const cfg = regra();
      if (!cfg.ativo) return { operador: 'mercurio', config: cfg, itens: [], total: 0, aviso: 'desligado' };
      const itens = m.leads.filter((l) => l.agente_slug === 'mercurio' && ['ganho', 'perdido'].indexOf(l.stage) < 0).map((l) => {
        const conversa = m.mensagens.filter((x) => x.lead_id === l.id).slice(-20);
        return { lead_id: l.id, nome: l.name, empresa: l.company || null, whatsapp: l.whatsapp || null, etapa: l.stage, origem: l.origin,
          lead_frio: ['prospeccao', 'maquina_de_leads'].indexOf(l.origin) >= 0, primeiro_contato_feito: conversa.some((x) => x.direcao === 'saida'),
          nao_contatar: naoContatar(l), qualificacao: l.qualificacao || {}, mensagens: conversa, fatos: l.fatos || [] };
      });
      return { operador: 'mercurio', config: cfg, itens, total: itens.length };
    },
    aceleriq_comercial_registrar_mensagem(a) {
      const l = lead(a.lead_id); if (!l) throw new Error('write:not_found lead');
      if (a.id_externo) { const ja = m.mensagens.find((x) => x.lead_id === l.id && x.id_externo === a.id_externo); if (ja) return { mensagem: ja, registrada: false, duplicada: true }; }
      let primeiro = false;
      if (a.direcao === 'saida') {
        if (naoContatar(l)) throw new Error('Este lead pediu para nao ser mais contatado (LGPD).');
        primeiro = !m.mensagens.some((x) => x.lead_id === l.id && x.direcao === 'saida') && ['prospeccao', 'maquina_de_leads'].indexOf(l.origin) >= 0;
        if (primeiro) { const r = regra(); if (!r.dentro_do_horario) throw new Error('Fora do horario do comercial'); if (r.restam_hoje <= 0) throw new Error('Teto do dia atingido'); }
      }
      const msg = { lead_id: l.id, direcao: a.direcao, texto: a.texto, enviada_em: a.enviada_em, id_externo: a.id_externo || null, operador_slug: a.direcao === 'saida' ? (a.operador || 'mercurio') : null };
      m.mensagens.push(msg);
      if (primeiro) m.primeiros.push({ lead_id: l.id, em: m.agoraMs });
      if (a.direcao === 'saida' && l.stage === 'novo') l.stage = 'contato';
      let parou = false;
      if (a.direcao === 'entrada' && !naoContatar(l) && pedeParaParar(a.texto)) { parou = true; l.qualificacao = Object.assign({}, l.qualificacao, { nao_contatar: 'sim' }); }
      return Object.assign({ mensagem: msg, registrada: true, primeiro_contato: primeiro }, parou ? { pediu_para_parar: true } : {});
    },
    aceleriq_comercial_avisar_caixa(a) {
      const l = lead(a.lead_id); if (!l) throw new Error('write:not_found lead');
      if (m.handoffs.some((h) => h.lead_id === l.id && h.tipo === a.tipo)) throw new Error('Ja existe um aviso "' + a.tipo + '" aberto para este lead nas ultimas 6 horas.');
      const h = Object.assign({ id: 'h' + (m.handoffs.length + 1) }, a); m.handoffs.push(h);
      return { item: h, avisado: true };
    },
    aceleriq_comercial_entrada_nova(a) {
      m.entradas_novas = (m.entradas_novas || []).concat([a]);
      if (m.numero_de_cliente) return { lead_id: LEADS.pronto, criado: false, so_registrar: true, motivo: 'ja_e_cliente' };
      const id = 'novo-' + m.leads.length;
      const novo = { id, name: a.nome_perfil || 'Novo', company: null, whatsapp: a.whatsapp, stage: 'novo', origin: a.anuncio ? 'anuncio' : 'whatsapp', qualificacao: a.anuncio ? { anuncio: a.anuncio } : {}, agente_slug: 'mercurio' };
      m.leads.push(novo);
      return { lead_id: id, criado: true, so_registrar: false, item: { lead_id: id, nome: novo.name, empresa: null, whatsapp: a.whatsapp, etapa: 'novo', origem: novo.origin, qualificacao: novo.qualificacao, mensagens: [], fatos: [] } };
    },
    aceleriq_comercial_cobrar(a) {
      m.cobrancas = (m.cobrancas || []).concat([a]);
      if (m.sem_asaas) return { cobranca: null, nova: false, sem_asaas: true, aviso: 'sem chave' };
      return { cobranca: { id: 'c1', plano_nome: 'Start Assistido', valor: 1394, pix_copia_e_cola: '000201PIXTESTE', link: 'https://asaas.test/i/1' }, nova: true };
    },
    aceleriq_comercial_horarios(a) { m.ocupados = a.ocupados || null; return { horarios: m.horarios || [{ inicio: '2026-11-10T14:00:00.000Z', rotulo: 'terça, 10/11, às 11h' }, { inicio: '2026-11-11T14:00:00.000Z', rotulo: 'quarta, 11/11, às 11h' }] }; },
    aceleriq_comercial_marcar_reuniao(a) { m.reunioes = (m.reunioes || []).concat([a]); return m.dia_ocupado ? { marcada: false, motivo: 'dia_ocupado' } : { marcada: true, id: 'r1', inicio: a.inicio, fim: '2026-11-10T15:00:00.000Z', rotulo: 'terça, 10/11, às 11h', titulo: 'Reunião' }; },
    aceleriq_comercial_falar(a) { m.falas = (m.falas || []).concat([a]); return { audio_base64: 'T2dnUw==', mime: 'audio/ogg', bytes: 4 }; },
    aceleriq_comercial_repasses() { return { itens: m.repasses || [], total: (m.repasses || []).length }; },
    aceleriq_comercial_repasse_marcar(a) { m.repassados = (m.repassados || []).concat([a.id]); return { id: a.id, marcado: true }; },
    aceleriq_update_opportunity(a) {
      const l = lead(a.opportunity_id); if (!l) throw new Error('write:not_found lead');
      if (a.qualificacao) l.qualificacao = Object.assign({}, l.qualificacao, a.qualificacao);
      m.updates.push(a);
      return { oportunidade: { id: l.id }, campos_alterados: Object.keys(a).filter((k) => k !== 'opportunity_id') };
    },
  };

  function mcp(corpo) {
    const nome = corpo.params && corpo.params.name, args = (corpo.params && corpo.params.arguments) || {};
    m.chamadas.push({ ferramenta: nome, argumentos: args });
    const res = (r) => ({ statusCode: 200, body: { jsonrpc: '2.0', id: corpo.id, result: r } });
    if (m.falhas[nome]) return res({ isError: true, content: [{ type: 'text', text: m.falhas[nome] }] });
    if (!ferramentas[nome]) return { statusCode: 200, body: { jsonrpc: '2.0', id: corpo.id, error: { code: -32004, message: 'ferramenta inexistente ' + nome } } };
    try { const d = ferramentas[nome](args); return res({ content: [{ type: 'text', text: JSON.stringify(d) }], structuredContent: d }); }
    catch (e) { return res({ isError: true, content: [{ type: 'text', text: e.message }] }); }
  }

  function jev(corpo) {
    if (m.jevFalha) return { statusCode: 500, body: { detail: 'falha de teste' } };
    const t = sem(corpo.state && corpo.state.ultima_mensagem);
    let c = 'outro', av = 0.05;
    if (/me esquece|chato|nao tenho interesse|pare/.test(t)) c = 'pare';
    else if (/quanto|preco|valor|reuniao/.test(t)) { c = 'pergunta'; av = 0.85; }
    else if (/quero|pode preparar|pode mandar|tenho interesse|sim/.test(t)) c = 'interessado';
    else if (/depois|agora nao|mes que vem/.test(t)) c = 'nao_agora';
    else if (/\?/.test(t)) c = 'pergunta';
    const probs = { interessado: 0.02, pergunta: 0.02, nao_agora: 0.02, pare: 0.02, outro: 0.02 }; probs[c] = 0.92;
    const extra = m.jevExtra || {};
    const responder = (id, v) => ({ type: 'choice', choice: v, confidence: 0.9 });
    return { statusCode: 200, body: { model: 'jev-teste', answers: { quer_google: { type: 'noul', noul: extra.quer_google ? 0.9 : 0.05 }, escolheu_horario: { type: 'noul', noul: extra.escolheu_horario ? 0.9 : 0.05 }, entendeu_necessidade: { type: 'noul', noul: extra.entendeu_necessidade === false ? 0.1 : 0.9 }, insiste_no_preco: { type: 'noul', noul: extra.insiste_no_preco ? 0.9 : 0.05 }, remetente: responder('remetente', extra.remetente || 'humano'), etapa: responder('etapa', extra.etapa || (av > 0.5 ? 'apresentar' : 'descobrir')), objecao: responder('objecao', extra.objecao || 'nenhuma'), plano: responder('plano', extra.plano || 'nenhum'), intencao: { type: 'choice', choice: c, confidence: 0.9, probabilities: probs }, avancou: { type: 'noul', noul: av } } } };
  }

  function llm(corpo) {
    m.llm.chamadas++; m.llm.ultimo = corpo;
    return { statusCode: 200, body: { model: corpo.model, choices: [{ message: { role: 'assistant', content: m.llm.texto } }] } };
  }

  function meta(url, corpo) {
    if (url.endsWith('/media')) { m.meta.midias = (m.meta.midias || 0) + 1; return { statusCode: 200, body: { id: 'midia-voz' } }; }
    if (corpo && corpo.status === 'read') { m.meta.digitando = (m.meta.digitando || 0) + 1; return { statusCode: 200, body: { success: true } }; }
    if (!corpo) return url.includes('/arquivo') ? { statusCode: 200, body: { arquivo: 'audio-falso' } } : { statusCode: 200, body: { url: 'http://127.0.0.1:8792/graph/arquivo' } };
    m.meta.enviadas.push({ url, corpo });
    if (m.meta.modo === 'timeout') throw new Error('ETIMEDOUT: tempo esgotado (teste)');
    if (m.meta.modo === '400') return { statusCode: 400, body: { error: { message: '(#132001) Template name does not exist in the translation', type: 'OAuthException', code: 132001 } } };
    if (m.meta.modo === '401') return { statusCode: 401, body: { error: { message: 'Error validating access token', type: 'OAuthException', code: 190 } } };
    if (m.meta.modo === '500') return { statusCode: 500, body: { error: { message: 'Something went wrong', code: 131000 } } };
    m.meta.n++;
    return { statusCode: 200, body: { messaging_product: 'whatsapp', contacts: [{ input: corpo.to, wa_id: corpo.to }], messages: [{ id: 'wamid.TESTE' + m.meta.n }] } };
  }

  async function http({ url, corpo, credencial }) {
    m.chamadas_http = (m.chamadas_http || []).concat([{ url, credencial }]);
    if (url.indexOf('http://127.0.0.1:8791/mcp') === 0) return mcp(corpo);
    if (url.indexOf('http://127.0.0.1:8791/jev') === 0) return jev(corpo);
    if (url.indexOf('http://127.0.0.1:8791/llm') === 0) return JSON.stringify(corpo || {}).includes('input_audio') ? { statusCode: 200, body: { choices: [{ message: { content: m.transcricao || 'quanto custa o plano' } }] } } : llm(corpo);
    if (url.indexOf('http://127.0.0.1:8793/google') === 0) { m.google = (m.google || []).concat([{ url, corpo }]); return url.endsWith('/freeBusy') ? { statusCode: 200, body: { calendars: { primary: { busy: m.google_busy || [] } } } } : { statusCode: 200, body: { id: 'ev1' } }; }
    if (url.indexOf('http://127.0.0.1:8792/graph/') === 0) return meta(url, corpo);
    throw new Error('URL fora do mundo de teste (bloqueada): ' + url);
  }

  return { m, http, lead, fila: () => JSON.parse(JSON.stringify(ferramentas.aceleriq_comercial_fila())), escritas: () => m.chamadas.filter((c) => c.ferramenta !== 'aceleriq_comercial_fila') };
}

// Corpo de webhook da Cloud API (formato real: entry/changes/value) com uma mensagem.
export function webhookMeta({ wamid, de, texto, quando, tipo = 'text', botao, phoneNumberId = '100000000000001' }) {
  const msg = { from: de, id: wamid, timestamp: String(Math.floor(quando / 1000)), type: tipo };
  if (tipo === 'text') msg.text = { body: texto };
  if (tipo === 'button') msg.button = { text: botao, payload: botao };
  if (tipo === 'audio') msg.audio = { id: 'midia-1', mime_type: 'audio/ogg' };
  return { object: 'whatsapp_business_account', entry: [{ id: 'waba-teste', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { display_phone_number: '5519900000000', phone_number_id: phoneNumberId },
    contacts: [{ profile: { name: 'Contato Teste' }, wa_id: de }], messages: [msg] } }] }] };
}
