// Rodada de observação do Instagram: lê casos (JSON), chama o Jev e a redação de verdade e NÃO publica nada.
// Uso: node tools/observar-instagram.mjs <casos.json> <saida.json>. Chaves nas variáveis de usuário; nunca impressas.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { carregarLib } from '../test/_lib.mjs';
const L = carregarLib('nucleo', 'instagram');
const env = (n) => process.env[n] || execFileSync('powershell', ['-NoProfile', '-Command', `[Environment]::GetEnvironmentVariable('${n}','User')`], { encoding: 'utf8' }).trim();
const TS = env('TYPESAFE_API_KEY'), OR = env('OPENROUTER_API_KEY');
if (!TS || !OR) throw new Error('faltam TYPESAFE_API_KEY ou OPENROUTER_API_KEY');
const [, , entrada, saida] = process.argv;
const { posts, casos, agora } = JSON.parse(fs.readFileSync(entrada, 'utf8'));
const post = async (url, chave, corpo) => {
  const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + chave, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  const j = await r.json().catch(() => null);
  return r.ok ? j : { erro: r.status, detalhe: JSON.stringify(j).slice(0, 200) };
};
const jev = (c) => post('https://api.typesafe.ai/v1/systemone', TS, c);
const out = [];
for (const c of casos) {
  const p = c.post ? { legenda: posts[c.post], cta: L.acqIgCtaDaLegenda(posts[c.post]) } : null;
  const ev = { canal: c.canal || 'comentario', id: c.id, de_id: 'x', de_usuario: null, texto: c.texto, media_id: c.post || null, em: c.em || agora, proprio: !!c.proprio };
  const rj = await jev(L.acqIgPedidoJev(ev, p, c.conversa || []));
  const julg = rj.erro ? null : L.acqIgLerJev(rj);
  const d = L.acqIgDecidir(ev, julg, { modo: 'observacao' }, {}, p, agora);
  let red = null, apoio;
  if (d.resposta_publica || d.direct) {
    const bruto = await post('https://openrouter.ai/api/v1/chat/completions', OR, L.acqIgPedidoRedacao(ev, p, d, c.conversa || [], null));
    red = L.acqIgLerRedacao(bruto);
    if (!red) console.log('      redação bruta: ' + JSON.stringify(bruto).slice(0, 500));
    const txt = red && [red.comentario, red.direct].filter(Boolean).join(' ');
    apoio = txt ? L.acqIgLerApoio(await jev(L.acqIgPedidoApoio(ev, p, txt))) : null;
  }
  const f = L.acqIgFechar(d, red, apoio);
  const o = { id: c.id, real: !c.inventado, texto: c.texto, canal: ev.canal, palavra: p && p.cta ? p.cta.palavra : null, erro: rj.erro ? rj : undefined,
    julg: julg && { tipo: julg.tipo, conf: +(julg.confianca ?? 0).toFixed(2), palavra: +julg.p_palavra.toFixed(2), ofensa: +julg.p_ofensa.toFixed(2), spam: +julg.p_spam.toFixed(2), critica: +julg.p_critica.toFixed(2), proposta: +julg.p_proposta.toFixed(2) },
    acao: d.acao, lead: d.lead, aviso: f.aviso, comentario: f.comentario, direct: f.direct, apoio, motivos: f.motivos, esperado: c.esperado || null, confere: c.esperado ? c.esperado === d.acao : null };
  out.push(o);
  const mot = f.motivos.filter((m) => !m.startsWith('modo_'));
  console.log((o.real ? 'REAL ' : 'inv  ') + o.id + ' | ' + JSON.stringify(c.texto).slice(0, 60) + ' | ' + (julg ? julg.tipo + ' ' + o.julg.conf : 'SEM JEV ' + JSON.stringify(rj).slice(0, 160)) + ' | ' + d.acao
    + (c.esperado ? (o.confere ? ' OK' : ' DIFERENTE, esperado ' + c.esperado) : '') + (f.aviso ? ' | aviso ' + f.aviso : '')
    + '\n      > ' + (f.comentario || '-') + (f.direct ? '\n      DM: ' + f.direct : '') + (mot.length ? '\n      motivos: ' + mot.join(',') : ''));
}
fs.writeFileSync(saida, JSON.stringify({ executado_em: new Date().toISOString(), casos: out }, null, 2));
const inv = out.filter((o) => o.esperado);
console.log('\ncasos ' + out.length + ' | reais ' + out.filter((o) => o.real).length + ' | inventados conferidos ' + inv.filter((o) => o.confere).length + '/' + inv.length + ' | publicados 0');
