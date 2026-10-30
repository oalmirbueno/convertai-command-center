// ACQ n8n — núcleo comum (JS puro, sem require).
// Este arquivo é embutido nos nós Code do n8n pelo gerador (build/gerar.mjs) e carregado
// pelos testes locais. Tudo aqui é determinístico e não faz rede.

var ACQ_SCHEMA_VERSION = '1.0.0';
var ACQ_TZ = 'America/Sao_Paulo';

// ---------- SHA-256 / HMAC (puro, para o sandbox do n8n sem crypto) ----------
function acqUtf8Bytes(str) {
  var out = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      var d = str.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

var ACQ_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function acqSha256Bytes(bytes) {
  var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var l = bytes.length;
  var msg = bytes.slice();
  msg.push(0x80);
  while ((msg.length % 64) !== 56) msg.push(0);
  var bitsHi = Math.floor((l * 8) / 0x100000000), bitsLo = (l * 8) >>> 0;
  msg.push((bitsHi >>> 24) & 255, (bitsHi >>> 16) & 255, (bitsHi >>> 8) & 255, bitsHi & 255);
  msg.push((bitsLo >>> 24) & 255, (bitsLo >>> 16) & 255, (bitsLo >>> 8) & 255, bitsLo & 255);
  var W = new Array(64);
  for (var off = 0; off < msg.length; off += 64) {
    for (var t = 0; t < 16; t++) {
      W[t] = ((msg[off + 4 * t] << 24) | (msg[off + 4 * t + 1] << 16) | (msg[off + 4 * t + 2] << 8) | msg[off + 4 * t + 3]) >>> 0;
    }
    for (t = 16; t < 64; t++) {
      var x = W[t - 15], y = W[t - 2];
      var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
    }
    var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (t = 0; t < 64; t++) {
      var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      var ch = (e & f) ^ (~e & g);
      var t1 = (h + S1 + ch + ACQ_K[t] + W[t]) >>> 0;
      var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  var out = [];
  for (var i = 0; i < 8; i++) out.push((H[i] >>> 24) & 255, (H[i] >>> 16) & 255, (H[i] >>> 8) & 255, H[i] & 255);
  return out;
}

function acqHex(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
  return s;
}

function acqSha256(str) { return acqHex(acqSha256Bytes(acqUtf8Bytes(String(str)))); }

function acqHmacSha256(key, message) {
  var k = acqUtf8Bytes(String(key));
  if (k.length > 64) k = acqSha256Bytes(k);
  while (k.length < 64) k.push(0);
  var ipad = [], opad = [];
  for (var i = 0; i < 64; i++) { ipad.push(k[i] ^ 0x36); opad.push(k[i] ^ 0x5c); }
  var inner = acqSha256Bytes(ipad.concat(acqUtf8Bytes(String(message))));
  return acqHex(acqSha256Bytes(opad.concat(inner)));
}

// Comparação em tempo constante para assinaturas hex.
function acqIguaisSeguro(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length || a.length === 0) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---------- JSON estável (hash de payload independe da ordem das chaves) ----------
function acqEstavel(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(acqEstavel).join(',') + ']';
  var ks = Object.keys(v).filter(function (k) { return v[k] !== undefined; }).sort();
  return '{' + ks.map(function (k) { return JSON.stringify(k) + ':' + acqEstavel(v[k]); }).join(',') + '}';
}

function acqHashDe(v) { return acqSha256(acqEstavel(v)); }

// UUID determinístico (formato v4-like) a partir de um texto: mesma entrada → mesmo id.
function acqUuidDe(texto) {
  var h = acqSha256(texto);
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-' +
    ((parseInt(h.slice(16, 17), 16) & 3) | 8).toString(16) + h.slice(17, 20) + '-' + h.slice(20, 32);
}

// ---------- Tempo em São Paulo ----------
// O Brasil não tem horário de verão desde 2019: São Paulo é UTC-3 fixo.
// acqConferirFuso() confirma isso pelo Intl quando disponível (testado localmente).
function acqAgoraSP(agoraMs) {
  var ms = (typeof agoraMs === 'number') ? agoraMs : Date.now();
  var d = new Date(ms - 3 * 3600 * 1000);
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  return {
    iso_utc: new Date(ms).toISOString(),
    data: d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()),
    hora: d.getUTCHours(),
    minuto: d.getUTCMinutes(),
    dia_semana: d.getUTCDay(), // 0 domingo … 6 sábado
    ms: ms,
  };
}

function acqConferirFuso(agoraMs) {
  try {
    var f = new Intl.DateTimeFormat('en-CA', { timeZone: ACQ_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false });
    var partes = {};
    f.formatToParts(new Date(agoraMs)).forEach(function (p) { partes[p.type] = p.value; });
    var sp = acqAgoraSP(agoraMs);
    return (partes.year + '-' + partes.month + '-' + partes.day) === sp.data && Number(partes.hour) % 24 === sp.hora;
  } catch (e) { return null; }
}

// Segunda-feira (YYYY-MM-DD) da semana de uma data YYYY-MM-DD.
function acqSegundaDaSemana(dataISO) {
  var p = dataISO.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  var dow = d.getUTCDay();
  var delta = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function acqSomarDias(dataISO, n) {
  var p = dataISO.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return d.toISOString().slice(0, 10);
}

function acqDiasEntre(aISO, bISO) {
  var pa = aISO.slice(0, 10).split('-').map(Number), pb = bISO.slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}

// ---------- Texto ----------
// Mesma normalização da continuidade da Central (agente-central/continuidade.ts):
// NFD, minúsculas, só alfanumérico.
function acqChaveTexto(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function acqUuidValido(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
}

// ---------- Contrato mínimo de evento ----------
var ACQ_CAMPOS_EVENTO = ['schema_version', 'event_id', 'workflow_id', 'run_id', 'client_id', 'entity_type', 'entity_id',
  'occurred_at', 'observed_at', 'source', 'source_version', 'correlation_id', 'idempotency_key', 'evidence_refs'];

// A identidade do evento vem da idempotency_key (IDs/hashes); o event_id é derivado dela.
function acqEvento(base) {
  var faltando = ['workflow_id', 'run_id', 'entity_type', 'entity_id', 'occurred_at', 'source', 'idempotency_key']
    .filter(function (k) { return base[k] === undefined || base[k] === null || base[k] === ''; });
  if (faltando.length) throw new Error('evento incompleto: ' + faltando.join(', '));
  if (base.client_id && !acqUuidValido(base.client_id)) throw new Error('evento com client_id inválido');
  var ev = {
    schema_version: ACQ_SCHEMA_VERSION,
    event_id: acqUuidDe('evento|' + base.workflow_id + '|' + base.idempotency_key),
    workflow_id: base.workflow_id,
    run_id: String(base.run_id),
    client_id: base.client_id || null,
    entity_type: base.entity_type,
    entity_id: String(base.entity_id),
    occurred_at: base.occurred_at,
    observed_at: base.observed_at || new Date().toISOString(),
    source: base.source,
    source_version: base.source_version || null,
    correlation_id: base.correlation_id || base.run_id,
    idempotency_key: base.idempotency_key,
    evidence_refs: Array.isArray(base.evidence_refs) ? base.evidence_refs : [],
    tipo: base.tipo || base.entity_type,
    payload: base.payload || {},
  };
  ev.payload_hash = acqHashDe(ev.payload);
  return ev;
}

function acqValidarEvento(ev) {
  var erros = [];
  ACQ_CAMPOS_EVENTO.forEach(function (k) { if (!(k in ev)) erros.push('falta ' + k); });
  if (ev.schema_version !== ACQ_SCHEMA_VERSION) erros.push('schema_version');
  if (!acqUuidValido(ev.event_id)) erros.push('event_id');
  if (ev.client_id !== null && !acqUuidValido(ev.client_id)) erros.push('client_id');
  if (isNaN(Date.parse(ev.occurred_at))) erros.push('occurred_at');
  if (isNaN(Date.parse(ev.observed_at))) erros.push('observed_at');
  if (!Array.isArray(ev.evidence_refs)) erros.push('evidence_refs');
  if (typeof ev.idempotency_key !== 'string' || ev.idempotency_key.length < 8 || ev.idempotency_key.length > 200) erros.push('idempotency_key');
  return erros;
}

function acqRunId(workflowId, agoraMs, semente) {
  return workflowId + ':' + new Date(agoraMs).toISOString() + ':' + acqSha256(String(semente || Math.random())).slice(0, 8);
}
