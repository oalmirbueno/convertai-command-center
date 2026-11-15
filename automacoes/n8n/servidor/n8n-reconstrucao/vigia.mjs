// Vigia da Aceleriq no VPS: saúde do n8n (toda hora) e vencimentos (uma vez por dia, a partir das 9h).
// Avisa SÓ o dono, pelo 3429 (ponte local), e só quando precisa:
//   - n8n sem responder em duas tentativas (no máximo um aviso a cada 6 h; avisa quando volta);
//   - vencimento em 7 dias e em 1 dia (planos mensais da Hostinger pelo dia do mês; domínios pela data real, lida por RDAP).
// Não envia a mais ninguém. Modo de conferência sem envio: VIGIA_MODO=ensaio.
import fs from 'node:fs';

const PONTE = process.env.VIGIA_PONTE || 'http://127.0.0.1:3049';
const TOKEN_ARQ = '/etc/mercurio-pilot/bridge.token';
const DONO = '554198848435@s.whatsapp.net'; // mesmo destino individual liberado no pilot_guard.mjs
const CFG = JSON.parse(fs.readFileSync(process.env.VIGIA_CONFIG || '/etc/aceleriq-vigia/vigia.json', 'utf8'));
const ESTADO_ARQ = process.env.VIGIA_ESTADO || '/var/lib/aceleriq-vigia/estado.json';
const ENSAIO = process.env.VIGIA_MODO === 'ensaio';
const estado = fs.existsSync(ESTADO_ARQ) ? JSON.parse(fs.readFileSync(ESTADO_ARQ, 'utf8')) : { avisados: {}, saude: {} };
const log = (o) => console.log(JSON.stringify({ em: new Date().toISOString(), ...o }));

const agora = new Date();
const sp = new Date(agora.getTime() - 3 * 3600000); // Brasília, sem horário de verão
const hojeSP = sp.toISOString().slice(0, 10);
const horaSP = sp.getUTCHours();
const diasAte = (iso) => Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse(hojeSP + 'T00:00:00Z')) / 86400000);
const br = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);

async function avisar(texto) {
  if (ENSAIO) { log({ evento: 'ensaio_aviso', texto }); return true; }
  const token = fs.readFileSync(TOKEN_ARQ, 'utf8').trim();
  const r = await fetch(PONTE + '/send', { method: 'POST', signal: AbortSignal.timeout(75000),
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ chatId: DONO, message: texto }) });
  log({ evento: 'aviso', http: r.status });
  return r.ok;
}

async function saude() {
  let ok = false, detalhe = '';
  for (let i = 0; i < 2 && !ok; i++) {
    if (i) await new Promise((r) => setTimeout(r, 60000));
    try {
      const r = await fetch(CFG.saude_url, { signal: AbortSignal.timeout(40000) });
      const j = await r.json().catch(() => ({}));
      ok = r.ok && j.ok === true;
      detalhe = 'HTTP ' + r.status + (r.ok && j.ok !== true ? ', banco ou painel sem resposta' : '');
    } catch (e) { detalhe = String(e.cause?.code || e.name || e.message).slice(0, 80); }
  }
  log({ evento: 'saude', ok, detalhe });
  const s = estado.saude;
  if (!ok) {
    if (!s.caiu_em) s.caiu_em = agora.toISOString();
    if (!s.ultimo_aviso || agora - new Date(s.ultimo_aviso) > 6 * 3600000) {
      if (await avisar('*n8n fora do ar*\n\nO n8n da Aceleriq não respondeu ao teste de saúde (' + detalhe + ').\nAs automações ficam paradas até ele voltar.\n\nPrimeira coisa a olhar: e-mails da Hostinger sobre vencimento.')) s.ultimo_aviso = agora.toISOString();
    }
  } else if (s.caiu_em) {
    if (s.ultimo_aviso) await avisar('*n8n voltou*\n\nO teste de saúde do n8n respondeu de novo. Estava sem responder desde ' + new Date(Date.parse(s.caiu_em) - 3 * 3600000).toISOString().slice(11, 16) + '.');
    estado.saude = {};
  }
}

async function dataDoDominio(d) {
  const r = await fetch(d.rdap, { signal: AbortSignal.timeout(30000), headers: { accept: 'application/rdap+json' } });
  if (!r.ok) throw new Error('RDAP HTTP ' + r.status);
  const j = await r.json();
  const ev = (j.events || []).find((e) => e.eventAction === 'expiration');
  if (!ev) throw new Error('RDAP sem data de expiração');
  return ev.eventDate.slice(0, 10);
}
function proximoDia(dia) {
  const [a, m] = hojeSP.split('-').map(Number);
  const noMes = (ano, mes) => new Date(Date.UTC(ano, mes - 1, Math.min(dia, new Date(Date.UTC(ano, mes, 0)).getUTCDate()))).toISOString().slice(0, 10);
  const este = noMes(a, m);
  return este >= hojeSP ? este : noMes(m === 12 ? a + 1 : a, m === 12 ? 1 : m + 1);
}

async function vencimentos() {
  if (horaSP < 9 || estado.vencimentos_dia === hojeSP) return;
  const itens = [];
  for (const p of CFG.mensais || []) itens.push({ nome: p.nome, data: p.pago_ate && p.pago_ate >= hojeSP ? p.pago_ate : proximoDia(p.dia), obs: p.obs || '' }); // pago_ate = até quando já está pago; depois disso volta ao dia do mês
  for (const d of CFG.dominios || []) {
    try { itens.push({ nome: 'Domínio ' + d.nome, data: await dataDoDominio(d), obs: d.obs || '' }); }
    catch (e) { log({ evento: 'dominio_sem_data', dominio: d.nome, erro: String(e.message).slice(0, 120) }); }
  }
  let falhou = false;
  for (const it of itens) {
    const faltam = diasAte(it.data);
    log({ evento: 'vencimento', nome: it.nome, data: it.data, faltam });
    const marco = faltam === 7 ? '7' : faltam === 1 ? '1' : faltam === 0 ? '0' : null;
    if (!marco) continue;
    const chave = it.nome + '|' + it.data + '|' + marco;
    if (estado.avisados[chave]) continue;
    const quando = marco === '0' ? 'vence HOJE' : marco === '1' ? 'vence AMANHÃ' : 'vence em 7 dias';
    const texto = '*Vencimento: ' + it.nome + '*\n\n' + it.nome + ' ' + quando + ' (' + br(it.data) + ').' + (it.obs ? '\n' + it.obs : '') + '\n\nSe já renovou ou a renovação automática está ligada, pode ignorar.';
    if (await avisar(texto)) estado.avisados[chave] = agora.toISOString(); else falhou = true;
  }
  if (!falhou) estado.vencimentos_dia = hojeSP;
  for (const k of Object.keys(estado.avisados)) if (agora - new Date(estado.avisados[k]) > 400 * 86400000) delete estado.avisados[k];
}

try { await saude(); } catch (e) { log({ evento: 'erro_saude', erro: String(e.message).slice(0, 200) }); }
try { await vencimentos(); } catch (e) { log({ evento: 'erro_vencimentos', erro: String(e.message).slice(0, 200) }); }
if (!ENSAIO) fs.writeFileSync(ESTADO_ARQ, JSON.stringify(estado, null, 2), { mode: 0o600 });
