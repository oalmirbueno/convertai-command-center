// Leitor dos grupos de clientes (só leitura) — segundo aparelho conectado do número da equipe.
// Pedido do Almir em 09/11/2026: ler as conversas e os áudios dos grupos para montar o contexto diário.
//
// O que este programa FAZ: recebe as mensagens dos grupos da lista liberada, transcreve os áudios aqui no
// servidor, guarda tudo num arquivo do dia e entrega ao n8n (fluxo "Clientes: leitura das conversas dos grupos").
// Desde 11/11/2026 também baixa imagem, vídeo e documento: reduz a imagem, tira quadros do vídeo, transcreve a fala
// do vídeo aqui mesmo e entrega ao fluxo "Clientes: entender imagens e vídeos dos grupos", que devolve a descrição.
// O que ele NÃO faz, por construção: não envia mensagem, não marca como lida, não aparece "online", não abre
// conversa particular (só os grupos da lista são decifrados) e não toca na ponte do comercial.
// Não existe nenhuma chamada de envio neste arquivo; o teste `leitor.test.mjs` confere isso.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const PROVEDOR = 'baileys_3429';
const env = (n, d) => (process.env[n] === undefined || process.env[n] === '' ? d : process.env[n]);
const DIR = env('LEITOR_DIR', '/var/lib/aceleriq-leitor-grupos');
const LISTA = env('LEITOR_GRUPOS', '/etc/mercurio-pilot/allowed-groups.json');
const WEBHOOK = env('LEITOR_WEBHOOK_URL', '');
const CABECALHO = env('LEITOR_WEBHOOK_CABECALHO', 'x-acq-segredo');
const SEGREDO_ARQ = env('LEITOR_WEBHOOK_SEGREDO_ARQUIVO', '/etc/aceleriq-leitor-grupos/webhook.segredo');
const PY = env('LEITOR_PYTHON', '/opt/aceleriq-leitor-grupos/venv/bin/python');
const TRANSCRITOR = env('LEITOR_TRANSCRITOR', '/opt/aceleriq-leitor-grupos/transcrever.py');
const DIAS_AUDIO = Number(env('LEITOR_DIAS_AUDIO', '7'));
const DIAS_DIARIO = Number(env('LEITOR_DIAS_DIARIO', '30'));
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
const MAX_AUDIO_SEG = 15 * 60;
const MAX_IDADE_MS = 48 * 3600 * 1000;
// Mídia (imagem, vídeo, documento): o texto da mensagem segue na hora pelo caminho de sempre; a mídia vai depois.
const WEBHOOK_MIDIA = env('LEITOR_WEBHOOK_MIDIA_URL', WEBHOOK ? WEBHOOK.replace(/acq04-mensagens\/?$/, 'acq12-midia') : '');
const DIAS_MIDIA = Number(env('LEITOR_DIAS_MIDIA', '7'));
const MAX_MIDIA_BYTES = { imagem: 20 * 1024 * 1024, documento: 20 * 1024 * 1024, video: 64 * 1024 * 1024 };
const MAX_QUADROS = 6;
const MAX_TENTATIVAS_MIDIA = 90;

// ------------------------------------------------------------------ funções puras (testadas)
export function carregarGrupos(texto) {
  const d = JSON.parse(texto);
  const itens = Array.isArray(d) ? d : d.groups;
  const mapa = new Map();
  for (const g of itens || []) {
    if (typeof g.chat_id === 'string' && g.chat_id.endsWith('@g.us') && g.client_id) mapa.set(g.chat_id, { client_id: g.client_id, nome: g.group_name || '' });
  }
  return mapa;
}

// Tira os invólucros (mensagem temporária, visualização única, editada) e devolve o conteúdo de verdade.
export function desembrulhar(message) {
  let m = message || {};
  for (let i = 0; i < 5; i++) {
    const dentro = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message ||
      m.viewOnceMessageV2Extension?.message || m.documentWithCaptionMessage?.message || m.editedMessage?.message;
    if (!dentro) break;
    m = dentro;
  }
  return m;
}

export function numeroDe(jid) { return String(jid || '').replace(/[:@].*$/, ''); }

// Mensagem do WhatsApp -> registro simples. Devolve null para o que não é conversa (reação, aviso do sistema).
export function normalizar(msg, grupos, agoraMs) {
  const chat = msg?.key?.remoteJid || '';
  if (!grupos.has(chat) || !msg.key.id || !msg.message) return null;
  const c = desembrulhar(msg.message);
  if (c.reactionMessage || c.protocolMessage || c.senderKeyDistributionMessage && Object.keys(c).length === 1 || c.pollUpdateMessage) return null;
  const ts = Number(msg.messageTimestamp?.toNumber ? msg.messageTimestamp.toNumber() : msg.messageTimestamp) * 1000;
  if (!Number.isFinite(ts) || ts <= 0) return null;
  if (agoraMs - ts > MAX_IDADE_MS) return null;
  const alt = msg.key.participantAlt || '';
  const autor = alt.endsWith('@s.whatsapp.net') ? alt : (msg.key.participant || '');
  const base = {
    id: msg.key.id, grupo: chat, de: msg.key.fromMe ? 'eu' : (numeroDe(autor) || 'desconhecido'), de_mim: !!msg.key.fromMe,
    nome: msg.key.fromMe ? null : (msg.pushName || null), em: new Date(ts).toISOString(), tipo: 'outro', texto: null, media_id: null,
  };
  const ctx = c.extendedTextMessage?.contextInfo || c.audioMessage?.contextInfo || c.imageMessage?.contextInfo || c.videoMessage?.contextInfo;
  if (ctx?.stanzaId) base.resposta_a = ctx.stanzaId;
  if (c.conversation || c.extendedTextMessage?.text) return { ...base, tipo: 'texto', texto: c.conversation || c.extendedTextMessage.text };
  if (c.audioMessage) return { ...base, tipo: 'audio', media_id: msg.key.id, segundos: Number(c.audioMessage.seconds) || 0, bytes: Number(c.audioMessage.fileLength) || 0 };
  if (c.imageMessage) return { ...base, tipo: 'imagem', texto: c.imageMessage.caption || null, media_id: msg.key.id, mime: c.imageMessage.mimetype || 'image/jpeg', bytes: Number(c.imageMessage.fileLength) || 0 };
  if (c.videoMessage) return { ...base, tipo: 'video', texto: c.videoMessage.caption || null, media_id: msg.key.id, mime: c.videoMessage.mimetype || 'video/mp4', bytes: Number(c.videoMessage.fileLength) || 0, segundos: Number(c.videoMessage.seconds) || 0 };
  if (c.documentMessage) return { ...base, tipo: 'documento', texto: [c.documentMessage.fileName, c.documentMessage.caption].filter(Boolean).join(' — ') || null,
    media_id: msg.key.id, mime: c.documentMessage.mimetype || 'application/octet-stream', bytes: Number(c.documentMessage.fileLength) || 0, arquivo_nome: c.documentMessage.fileName || null };
  if (c.pollCreationMessage || c.pollCreationMessageV3) { const p = c.pollCreationMessage || c.pollCreationMessageV3; return { ...base, tipo: 'outro', texto: 'Enquete: ' + (p.name || '') + ' | ' + (p.options || []).map((o) => o.optionName).join(' / ') }; }
  if (c.contactMessage || c.locationMessage || c.stickerMessage) return { ...base, tipo: 'outro', texto: c.contactMessage ? 'Contato: ' + (c.contactMessage.displayName || '') : c.locationMessage ? 'Localização enviada' : null };
  return null;
}

export function audioCabe(reg) {
  if (reg.segundos > MAX_AUDIO_SEG) return 'audio_longo_demais';
  if (reg.bytes > MAX_AUDIO_BYTES) return 'audio_grande_demais';
  return null;
}

// ------------------------------------------------------------------ mídia (funções puras)
export function midiaCabe(reg) {
  const teto = MAX_MIDIA_BYTES[reg.tipo];
  if (!teto) return 'tipo_sem_midia';
  if (reg.bytes > teto) return 'midia_grande_demais';
  return null;
}

const EXT_POR_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/3gpp': '3gp',
  'application/pdf': 'pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx', 'text/plain': 'txt', 'text/csv': 'csv', 'application/zip': 'zip' };
export function extensaoDe(reg) {
  const mime = String(reg.mime || '').split(';')[0].trim().toLowerCase();
  if (EXT_POR_MIME[mime]) return EXT_POR_MIME[mime];
  const doNome = /\.([A-Za-z0-9]{1,5})$/.exec(String(reg.arquivo_nome || ''));
  if (doNome) return doNome[1].toLowerCase();
  return reg.tipo === 'imagem' ? 'jpg' : reg.tipo === 'video' ? 'mp4' : 'bin';
}

// Em que segundos tirar os quadros do vídeo: espalhados do começo ao fim, no máximo 6.
export function quadrosDoVideo(segundos) {
  const s = Number(segundos) || 0;
  if (s <= 1) return [0];
  const n = Math.min(MAX_QUADROS, Math.max(2, Math.ceil(s / 5)));
  return Array.from({ length: n }, (_, i) => Math.round(((i + 0.5) * s / n) * 10) / 10);
}

// Corpo entregue ao fluxo "entender imagens e vídeos" (ACQ-12). O arquivo original não vai: só as imagens reduzidas.
export function corpoDaMidia(item, imagensB64) {
  return { provedor: PROVEDOR, midia: { mensagem_id: item.mensagem_id, grupo: item.grupo, tipo: item.tipo, mime: item.mime, nome: item.nome || null, hash: item.hash,
    bytes: item.bytes, segundos: item.segundos || 0, imagens: imagensB64, transcricao: item.transcricao || null } };
}

// Corpo entregue ao n8n (formato que o nó "Normalizar" do ACQ-04 já entende, com a transcrição junto).
export function corpoDoWebhook(reg, transcricao) {
  const corpo = { provedor: PROVEDOR, mensagem: { id: reg.id, grupo: reg.grupo, de: reg.de, em: reg.em, tipo: reg.tipo, texto: reg.texto, media_id: reg.media_id,
    de_mim: reg.de_mim, nome: reg.nome, resposta_a: reg.resposta_a || null } };
  if (reg.tipo === 'audio') corpo.transcricao = transcricao || { status: 'falhou', texto: null, media: null };
  return corpo;
}

export function vencidos(arquivos, agoraMs, dias) {
  return arquivos.filter((a) => agoraMs - a.mtimeMs > dias * 86400000).map((a) => a.nome);
}

// ------------------------------------------------------------------ disco
const pAudio = () => path.join(DIR, 'audio');
const pDiario = () => path.join(DIR, 'diario');
const pFila = () => path.join(DIR, 'fila');
const pSessao = () => path.join(DIR, 'sessao');
const pMidia = () => path.join(DIR, 'midia');
const pFilaMidia = () => path.join(DIR, 'fila-midia');
const limpo = (id) => String(id).replace(/[^A-Za-z0-9_-]/g, '_');
function prepararPastas() { for (const p of [DIR, pAudio(), pDiario(), pFila(), pSessao(), pMidia(), pFilaMidia()]) fs.mkdirSync(p, { recursive: true, mode: 0o700 }); }
function registro(o) { process.stdout.write(JSON.stringify({ em: new Date().toISOString(), ...o }) + '\n'); }
function gravarEstado(o) {
  const arq = path.join(DIR, 'estado.json');
  let atual = {};
  try { atual = JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { /* primeiro uso */ }
  fs.writeFileSync(arq + '.tmp', JSON.stringify({ ...atual, ...o, atualizado_em: new Date().toISOString() }, null, 1), { mode: 0o600 });
  fs.renameSync(arq + '.tmp', arq);
}
function jaVisto(id) { return fs.existsSync(path.join(DIR, 'vistos', id.replace(/[^A-Za-z0-9_-]/g, '_'))); }
function marcarVisto(id) {
  const d = path.join(DIR, 'vistos'); fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(d, id.replace(/[^A-Za-z0-9_-]/g, '_')), '', { mode: 0o600 });
}
function anotarNoDiario(reg, transcricao, grupo) {
  const dia = reg.em.slice(0, 10);
  fs.appendFileSync(path.join(pDiario(), dia + '.jsonl'), JSON.stringify({ ...reg, client_id: grupo.client_id, grupo_nome: grupo.nome, transcricao: transcricao || null }) + '\n', { mode: 0o600 });
}
function porNaFila(corpo) {
  const arq = path.join(pFila(), Date.now() + '-' + corpo.mensagem.id.replace(/[^A-Za-z0-9_-]/g, '_') + '.json');
  fs.writeFileSync(arq + '.tmp', JSON.stringify(corpo), { mode: 0o600 });
  fs.renameSync(arq + '.tmp', arq);
}
function faxina() {
  const agora = Date.now();
  const listar = (d) => fs.readdirSync(d).map((nome) => ({ nome, mtimeMs: fs.statSync(path.join(d, nome)).mtimeMs }));
  for (const n of vencidos(listar(pAudio()), agora, DIAS_AUDIO)) fs.unlinkSync(path.join(pAudio(), n));
  for (const n of vencidos(listar(pDiario()), agora, DIAS_DIARIO)) fs.unlinkSync(path.join(pDiario(), n));
  for (const n of vencidos(listar(pMidia()), agora, DIAS_MIDIA)) fs.unlinkSync(path.join(pMidia(), n));
  for (const n of vencidos(listar(pFilaMidia()), agora, 3)) fs.unlinkSync(path.join(pFilaMidia(), n));
  const v = path.join(DIR, 'vistos');
  if (fs.existsSync(v)) for (const n of vencidos(listar(v), agora, 10)) fs.unlinkSync(path.join(v, n));
}

// ------------------------------------------------------------------ transcrição (uma por vez, prioridade baixa)
function transcrever(arquivo) {
  return new Promise((resolve) => {
    const p = spawn('nice', ['-n', '15', PY, TRANSCRITOR, arquivo], { stdio: ['ignore', 'pipe', 'ignore'] });
    let saida = '';
    const limite = setTimeout(() => p.kill('SIGKILL'), 20 * 60 * 1000);
    p.stdout.on('data', (b) => { saida += b; });
    p.on('close', () => {
      clearTimeout(limite);
      try { const r = JSON.parse(saida.trim().split('\n').pop()); resolve(r.ok && r.texto ? { status: 'ok', texto: String(r.texto).slice(0, 12000) } : { status: r.motivo === 'sem_fala' ? 'ilegivel' : 'falhou', texto: null }); }
      catch { resolve({ status: 'falhou', texto: null }); }
    });
    p.on('error', () => { clearTimeout(limite); resolve({ status: 'falhou', texto: null }); });
  });
}

// ------------------------------------------------------------------ imagem reduzida e quadros do vídeo (ffmpeg)
function rodar(cmd, args, limiteMs) {
  return new Promise((resolve) => {
    const p = spawn('nice', ['-n', '15', cmd, ...args], { stdio: 'ignore' });
    const limite = setTimeout(() => p.kill('SIGKILL'), limiteMs);
    p.on('close', (cod) => { clearTimeout(limite); resolve(cod === 0); });
    p.on('error', () => { clearTimeout(limite); resolve(false); });
  });
}
// Devolve os nomes dos JPEGs gerados em midia/ (podem ser zero: documento, ou ffmpeg não abriu o arquivo).
async function prepararVisuais(reg, arquivo, hash) {
  const nomes = [];
  if (reg.tipo === 'imagem') {
    const nome = hash + '.v0.jpg';
    const ok = await rodar('ffmpeg', ['-loglevel', 'error', '-y', '-i', arquivo, '-frames:v', '1', '-vf', "scale='min(1280,iw)':'min(1280,ih)':force_original_aspect_ratio=decrease", '-q:v', '5', path.join(pMidia(), nome)], 60000);
    if (ok) nomes.push(nome);
  } else if (reg.tipo === 'video') {
    const tempos = quadrosDoVideo(reg.segundos);
    for (let i = 0; i < tempos.length; i++) {
      const nome = hash + '.v' + i + '.jpg';
      const ok = await rodar('ffmpeg', ['-loglevel', 'error', '-y', '-ss', String(tempos[i]), '-i', arquivo, '-frames:v', '1', '-vf', "scale='min(640,iw)':-2", '-q:v', '6', path.join(pMidia(), nome)], 60000);
      if (ok && fs.existsSync(path.join(pMidia(), nome))) nomes.push(nome);
    }
  }
  return nomes;
}

// ------------------------------------------------------------------ entrega da mídia ao n8n (ACQ-12)
async function entregarFilaMidia() {
  if (!WEBHOOK_MIDIA) return;
  let segredo;
  try { segredo = fs.readFileSync(SEGREDO_ARQ, 'utf8').trim(); } catch { return; }
  const arquivos = fs.readdirSync(pFilaMidia()).filter((n) => n.endsWith('.json')).sort().slice(0, 6);
  for (const nome of arquivos) {
    const arq = path.join(pFilaMidia(), nome);
    let item;
    try { item = JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { fs.unlinkSync(arq); continue; }
    const apagarQuadros = () => { for (const q of item.quadros || []) { try { fs.unlinkSync(path.join(pMidia(), q)); } catch { /* já saiu */ } } };
    try {
      const imagens = (item.quadros || []).filter((q) => fs.existsSync(path.join(pMidia(), q))).map((q) => fs.readFileSync(path.join(pMidia(), q)).toString('base64'));
      const r = await fetch(WEBHOOK_MIDIA, { method: 'POST', signal: AbortSignal.timeout(120000),
        headers: { 'content-type': 'application/json', [CABECALHO]: segredo, 'x-acq-carimbo': String(Math.floor(Date.now() / 1000)), 'x-provedor': PROVEDOR },
        body: JSON.stringify(corpoDaMidia(item, imagens)) });
      if (r.ok) {
        const resp = await r.json().catch(() => ({}));
        const original = path.join(pMidia(), item.arquivo);
        // Só fica guardado o que é material do cliente (a Clio leva para o painel); o resto sai do servidor na hora.
        if (resp && resp.ok === true && resp.guardar === true) {
          fs.writeFileSync(path.join(pMidia(), limpo(item.mensagem_id) + '.json'), JSON.stringify({ mensagem_id: item.mensagem_id, arquivo: item.arquivo, tipo: item.tipo, mime: item.mime, nome: item.nome || null,
            bytes: item.bytes, hash: item.hash, client_id: resp.client_id, cliente: resp.cliente, project_id: resp.project_id || null, quando: resp.quando, de: resp.nome || null, legenda: resp.legenda || null,
            descricao: resp.descricao || null }), { mode: 0o640 });
          try { fs.chmodSync(original, 0o640); } catch { /* segue */ }
        } else { try { fs.unlinkSync(original); } catch { /* já saiu */ } }
        apagarQuadros(); fs.unlinkSync(arq);
        registro({ evento: 'midia_entregue', tipo: item.tipo, descrita: !!(resp && resp.descricao), guardar: !!(resp && resp.guardar) });
        continue;
      }
      item.tentativas = (item.tentativas || 0) + 1;
      // 400 = formato recusado; 409 = a mensagem ainda não foi gravada (chega em instantes); 503 = modelo fora do ar.
      if (r.status === 400 || item.tentativas > MAX_TENTATIVAS_MIDIA) {
        apagarQuadros(); try { fs.unlinkSync(path.join(pMidia(), item.arquivo)); } catch { /* já saiu */ }
        fs.unlinkSync(arq); registro({ evento: 'midia_desistiu', status: r.status, tentativas: item.tentativas });
      } else { fs.writeFileSync(arq, JSON.stringify(item), { mode: 0o600 }); registro({ evento: 'midia_adiada', status: r.status }); if (r.status !== 409) break; }
    } catch (e) { registro({ evento: 'midia_adiada', motivo: String(e.name || 'rede') }); break; }
  }
}

// ------------------------------------------------------------------ entrega ao n8n (repete até o n8n confirmar)
async function entregarFila() {
  if (!WEBHOOK) return;
  let segredo;
  try { segredo = fs.readFileSync(SEGREDO_ARQ, 'utf8').trim(); } catch { registro({ evento: 'entrega_sem_segredo' }); return; }
  const arquivos = fs.readdirSync(pFila()).filter((n) => n.endsWith('.json')).sort().slice(0, 40);
  for (const nome of arquivos) {
    const arq = path.join(pFila(), nome);
    try {
      const r = await fetch(WEBHOOK, { method: 'POST', signal: AbortSignal.timeout(30000),
        headers: { 'content-type': 'application/json', [CABECALHO]: segredo, 'x-acq-carimbo': String(Math.floor(Date.now() / 1000)), 'x-provedor': PROVEDOR },
        body: fs.readFileSync(arq, 'utf8') });
      // 400 = o n8n recusou o formato: repetir não adianta; guarda em "recusadas" para conferência.
      if (r.ok) fs.unlinkSync(arq);
      else if (r.status === 400) { fs.mkdirSync(path.join(DIR, 'recusadas'), { recursive: true, mode: 0o700 }); fs.renameSync(arq, path.join(DIR, 'recusadas', nome)); registro({ evento: 'entrega_recusada', arquivo: nome }); }
      else { registro({ evento: 'entrega_adiada', status: r.status }); break; }
    } catch (e) { registro({ evento: 'entrega_adiada', motivo: String(e.name || 'rede') }); break; }
  }
  gravarEstado({ na_fila: fs.readdirSync(pFila()).length });
}

// ------------------------------------------------------------------ programa
async function principal() {
  prepararPastas();
  const grupos = carregarGrupos(fs.readFileSync(LISTA, 'utf8'));
  if (grupos.size < 1) throw new Error('lista de grupos vazia');
  const baileys = await import('@whiskeysockets/baileys');
  const makeWASocket = baileys.default?.default || baileys.default || baileys.makeWASocket;
  const { useMultiFileAuthState, DisconnectReason, downloadMediaMessage, Browsers, fetchLatestBaileysVersion } = baileys;
  const pino = (await import('pino')).default;
  const log = pino({ level: 'silent' });
  const parear = process.argv.includes('--parear') ? String(process.argv[process.argv.indexOf('--parear') + 1] || '').replace(/\D/g, '') : null;
  const modoQr = process.argv.includes('--qr');
  const pareando = !!parear || modoQr;
  const qrNoTerminal = modoQr ? (await import('qrcode-terminal')).default : null;
  const { state, saveCreds } = await useMultiFileAuthState(pSessao());
  // Pareado por QR não marca `registered` (só o pareamento por código marca): o que vale é ter a conta gravada.
  const pareado = () => !!(state.creds.registered || (state.creds.me && state.creds.me.id));
  if (!pareado() && !pareando) { registro({ evento: 'sem_pareamento', dica: 'rode instalar.sh para conectar o aparelho' }); process.exit(77); }
  if (pareado() && pareando) { console.log('Este leitor já está conectado. Nada a fazer.'); process.exit(0); }
  let versao; try { versao = (await fetchLatestBaileysVersion()).version; } catch { versao = undefined; }

  const filaAudio = [];
  const filaMidia = [];
  let transcrevendo = false;
  let tratandoMidia = false;
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  let tentativas = 0;

  const ligar = () => {
    const sock = makeWASocket({ auth: state, logger: log, version: versao, browser: Browsers.ubuntu('Chrome'), // o código de pareamento exige um navegador conhecido; aparece como "Chrome (Ubuntu)" printQRInTerminal: false,
      markOnlineOnConnect: false, syncFullHistory: false, shouldSyncHistoryMessage: () => false, generateHighQualityLinkPreview: false,
      // Só os grupos liberados são decifrados. Conversa particular, status e outros grupos nem são abertos.
      shouldIgnoreJid: (jid) => !grupos.has(jid) });
    sock.ev.on('creds.update', saveCreds);

    // Depois de digitar o código o WhatsApp derruba e religa a conexão: na volta já está registrado e não pede outro.
    if (parear && !pareado()) setTimeout(async () => {
      try { const codigo = await sock.requestPairingCode(parear); console.log('\nCÓDIGO PARA DIGITAR NO CELULAR: ' + codigo.replace(/(.{4})/, '$1-') + '\n(WhatsApp > Aparelhos conectados > Conectar aparelho > Conectar com número de telefone)\n'); }
      catch (e) { console.log('Não consegui gerar o código: ' + e.message); process.exit(1); }
    }, 4000);

    sock.ev.on('connection.update', (u) => {
      // O WhatsApp troca o QR a cada ~20 segundos: o mais novo é sempre o de baixo.
      if (u.qr && modoQr) { console.log('\nAponte o celular do número da equipe para este QR (WhatsApp > Aparelhos conectados > Conectar aparelho):\n'); qrNoTerminal.generate(u.qr, { small: true }); }
      if (u.connection === 'open') {
        tentativas = 0; gravarEstado({ conectado: true, conectado_em: new Date().toISOString(), grupos: grupos.size });
        registro({ evento: 'conectado', grupos: grupos.size });
        if (pareando) { console.log('\nAPARELHO CONECTADO.\n'); setTimeout(() => process.exit(0), 3000); }
      }
      if (u.connection === 'close') {
        const cod = u.lastDisconnect?.error?.output?.statusCode;
        gravarEstado({ conectado: false, caiu_em: new Date().toISOString(), codigo: cod || null });
        registro({ evento: 'desconectado', codigo: cod || null });
        // Aparelho removido no celular: não insiste (77 = não reiniciar; precisa parear de novo).
        if (cod === DisconnectReason.loggedOut) process.exit(77);
        tentativas += 1;
        setTimeout(ligar, Math.min(60000, 3000 * tentativas));
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (pareando || (type !== 'notify' && type !== 'append')) return;
      for (const msg of messages) {
        try {
          const reg = normalizar(msg, grupos, Date.now());
          if (!reg || jaVisto(reg.id)) continue;
          marcarVisto(reg.id);
          const grupo = grupos.get(reg.grupo);
          gravarEstado({ ultima_mensagem_em: reg.em });
          if (reg.tipo !== 'audio') {
            anotarNoDiario(reg, null, grupo); porNaFila(corpoDoWebhook(reg, null));
            // A mídia vai depois, por outro caminho: se ela falhar, o texto da mensagem já foi entregue.
            if (WEBHOOK_MIDIA && reg.media_id && !midiaCabe(reg)) { filaMidia.push({ msg, reg, sock }); void tocarFilaDeMidia(); }
            continue;
          }
          const motivo = audioCabe(reg);
          if (motivo) { const t = { status: 'falhou', texto: null, motivo }; anotarNoDiario(reg, t, grupo); porNaFila(corpoDoWebhook(reg, t)); continue; }
          filaAudio.push({ msg, reg, grupo, sock });
          void tocarFilaDeAudio();
        } catch (e) { registro({ evento: 'erro_mensagem', motivo: String(e.message).slice(0, 120) }); }
      }
    });
  };

  async function tocarFilaDeAudio() {
    if (transcrevendo) return;
    transcrevendo = true;
    while (filaAudio.length) {
      const { msg, reg, grupo, sock } = filaAudio.shift();
      let t = { status: 'falhou', texto: null, media: null };
      try {
        const dados = await downloadMediaMessage(msg, 'buffer', {}, { logger: log, reuploadRequest: sock.updateMediaMessage });
        if (dados.length > MAX_AUDIO_BYTES) throw new Error('audio_grande_demais');
        const hash = createHash('sha256').update(dados).digest('hex');
        const arq = path.join(pAudio(), hash + '.ogg');
        fs.writeFileSync(arq, dados, { mode: 0o600 });
        t = { ...(await transcrever(arq)), media: hash };
      } catch (e) { registro({ evento: 'audio_falhou', motivo: String(e.message).slice(0, 80) }); }
      anotarNoDiario(reg, t, grupo);
      porNaFila(corpoDoWebhook(reg, t));
      registro({ evento: 'audio', status: t.status, segundos: reg.segundos });
    }
    transcrevendo = false;
  }

  async function tocarFilaDeMidia() {
    if (tratandoMidia) return;
    tratandoMidia = true;
    while (filaMidia.length) {
      const { msg, reg, sock } = filaMidia.shift();
      try {
        const dados = await downloadMediaMessage(msg, 'buffer', {}, { logger: log, reuploadRequest: sock.updateMediaMessage });
        if (dados.length > MAX_MIDIA_BYTES[reg.tipo]) throw new Error('midia_grande_demais');
        const hash = createHash('sha256').update(dados).digest('hex');
        const arquivo = hash + '.' + extensaoDe(reg);
        fs.writeFileSync(path.join(pMidia(), arquivo), dados, { mode: 0o600 });
        const quadros = await prepararVisuais(reg, path.join(pMidia(), arquivo), hash);
        let fala = null;
        if (reg.tipo === 'video' && reg.segundos <= MAX_AUDIO_SEG) {
          // Um Whisper por vez: espera o áudio que estiver sendo transcrito.
          while (transcrevendo) await esperar(2000);
          transcrevendo = true;
          try { fala = await transcrever(path.join(pMidia(), arquivo)); } finally { transcrevendo = false; void tocarFilaDeAudio(); }
        }
        const item = { mensagem_id: reg.id, grupo: reg.grupo, tipo: reg.tipo, mime: reg.mime, nome: reg.arquivo_nome || null, hash, bytes: dados.length, segundos: reg.segundos || 0,
          arquivo, quadros, transcricao: fala && fala.status === 'ok' ? { status: 'ok', texto: fala.texto } : null, tentativas: 0 };
        fs.writeFileSync(path.join(pFilaMidia(), Date.now() + '-' + limpo(reg.id) + '.json'), JSON.stringify(item), { mode: 0o600 });
        registro({ evento: 'midia', tipo: reg.tipo, quadros: quadros.length, fala: !!item.transcricao });
      } catch (e) { registro({ evento: 'midia_falhou', tipo: reg.tipo, motivo: String(e.message).slice(0, 80) }); }
    }
    tratandoMidia = false;
  }

  ligar();
  if (!pareando) {
    setInterval(() => { entregarFila().catch(() => {}); }, 20000);
    let entregandoMidia = false;
    setInterval(() => { if (entregandoMidia) return; entregandoMidia = true; entregarFilaMidia().catch(() => {}).finally(() => { entregandoMidia = false; }); }, 30000);
    setInterval(() => { try { faxina(); } catch (e) { registro({ evento: 'faxina_falhou', motivo: e.message }); } }, 3600000);
    setInterval(() => gravarEstado({ vivo_em: new Date().toISOString() }), 60000);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal().catch((e) => { registro({ evento: 'fatal', motivo: String(e.message).slice(0, 200) }); process.exit(1); });
}
