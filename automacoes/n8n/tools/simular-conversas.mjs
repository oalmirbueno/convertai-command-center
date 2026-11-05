// Simulação de conversas de venda com o cérebro real do ACQ-07: as mesmas funções de lib/wf07.js, o Jev de verdade e o
// mesmo modelo de produção. Quem faz o papel do lead é outro modelo com uma persona. Não toca na Meta, no Asaas nem no CRM:
// lê só o treino e a base do Mercúrio, e o Pix e a confirmação são falsos. Chaves nas variáveis de usuário; nunca impressas.
// Uso: node tools/simular-conversas.mjs <saida.json> [id do cenário]
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { carregarLib, lerJson } from '../test/_lib.mjs';
import { PERSONAS } from '../fixtures/personas-comerciais.mjs';

const env = (n) => process.env[n] || execFileSync('powershell', ['-NoProfile', '-Command', `[Environment]::GetEnvironmentVariable('${n}','User')`], { encoding: 'utf8' }).trim();
const L = carregarLib('nucleo', 'adaptador', 'comercial', 'wf06', 'wf07');
const AMB = lerJson('config/ambientes.json');
const CFG = { comercial: AMB.ambientes.production.comercial };
const C = L.acqComCfg(CFG);
const OR = env('OPENROUTER_API_KEY'), TS = env('TYPESAFE_API_KEY'), SU = env('SUPABASE_URL'), SK = env('SUPABASE_SERVICE_ROLE_KEY');
const MODELO_LEAD = 'anthropic/claude-sonnet-5.5';
const AGORA = () => Date.now();
const PIX = { start_assistido: ['Start Assistido', 1244], essencial: ['Essencial', 1794], presenca: ['Presença', 2794], crescimento: ['Crescimento', 3994], estrutura: ['Estrutura', 5994], engenharia: ['Engenharia / OS', 9494] };
let custo = 0;

async function rest(caminho) {
  const r = await fetch(SU + '/rest/v1/' + caminho, { headers: { apikey: SK, authorization: 'Bearer ' + SK } });
  if (!r.ok) throw new Error('painel ' + r.status);
  return r.json();
}
async function modelo(corpo) {
  for (let t = 0; t < 3; t++) {
    const r = await fetch(C.llm_url, { method: 'POST', headers: { authorization: 'Bearer ' + OR, 'content-type': 'application/json' }, body: JSON.stringify({ ...corpo, usage: { include: true } }) });
    const j = await r.json().catch(() => ({}));
    if (j.usage && j.usage.cost) custo += j.usage.cost;
    if (r.ok && !j.error) return j;
    await new Promise((ok) => setTimeout(ok, 3000 * (t + 1)));
  }
  return { error: { message: 'modelo indisponível' } };
}
async function jev(pedido) {
  for (let t = 0; t < 3; t++) {
    const r = await fetch(AMB.ambientes.production.jev_url, { method: 'POST', headers: { authorization: 'Bearer ' + TS, 'content-type': 'application/json' }, body: JSON.stringify(pedido) });
    if (r.ok) return r.json();
    await new Promise((ok) => setTimeout(ok, 2000 * (t + 1)));
  }
  return null;
}

async function falaDoLead(p, conversa) {
  const sistema = `Você interpreta uma pessoa real no WhatsApp, numa simulação de treino de vendas. Fique no personagem.
PERSONAGEM: ${p.persona}
COMO VOCÊ ESCREVE: português do Brasil informal de WhatsApp, curto, às vezes sem pontuação. Você não sabe o script do vendedor. Reaja de verdade: se a resposta for boa, abra um pouco; se for genérica ou insistente, esfrie.
O QUE VOCÊ QUER NESTA CONVERSA: ${p.objetivo}
Nunca escreva tags, XML ou comentários, só o JSON. Responda em JSON: {"mensagens":["uma a três mensagens curtas, como alguém digita"],"audio":false,"fim":false}. Use "audio":true quando a fala for um áudio (escreva como fala, sem pontuação). Use "fim":true quando a conversa terminou do seu lado; nesse caso, "mensagens" pode ter a última fala ou ficar vazio.`;
  const msgs = [{ role: 'system', content: sistema }];
  conversa.forEach((x) => msgs.push({ role: x.direcao === 'saida' ? 'user' : 'assistant', content: x.texto }));
  if (!conversa.length) msgs.push({ role: 'user', content: '(Você abre a conversa agora.)' });
  const r = await modelo({ model: MODELO_LEAD, messages: msgs, max_tokens: 2000, temperature: 0.9 });
  const t = String(r.choices?.[0]?.message?.content || '');
  try { return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch { return { mensagens: [t.trim()].filter(Boolean), fim: !t.trim() }; }
}

async function simular(p, fila) {
  const lead = { lead_id: 'sim-' + p.id, nome: p.nome, empresa: p.empresa, whatsapp: '5541900000000', etapa: 'novo', qualificacao: p.anuncio ? { anuncio: p.anuncio } : {}, mensagens: [], fatos: p.fato ? [{ campo: 'presenca_digital', valor: p.fato, situacao: 'gravado' }] : [] };
  const linhas = [];
  const add = (quem, texto, extra) => { linhas.push({ quem, texto, ...(extra || {}) }); if (quem === 'lead' || quem === 'mercurio') lead.mensagens.push({ direcao: quem === 'lead' ? 'entrada' : 'saida', texto }); };
  const repasses = [];
  let pix = null;
  if (p.fato) add('mercurio', L.acqComTextoDoModelo(C.modelos.primeiro_contato, [p.empresa, p.fato]), { modelo: true });
  const roteiro = (p.primeiras || []).slice();
  for (let turno = 0; turno < (p.turnos || 14); turno++) {
    let fala;
    if (roteiro.length) fala = roteiro.shift();
    else fala = await falaDoLead(p, lead.mensagens);
    const partes = (fala.mensagens || []).map((x) => String(x).trim()).filter(Boolean);
    if (!partes.length) break;
    const em = new Date(AGORA()).toISOString();
    const lista = partes.map((texto, i) => ({ wamid: `w${turno}-${i}`, de: lead.whatsapp, em, texto, tipo: fala.audio ? 'audio' : 'text', transcrito: !!fala.audio, midia: null, botao: null }));
    lista.forEach((x) => add('lead', L.acq07TextoParaRegistro(x), { audio: !!fala.audio }));
    const m = L.acq07Lote(lista[lista.length - 1], { mais_nova: lista[lista.length - 1].wamid, mensagens: lista.map((x) => ({ m: x })) }).m;
    m.botao = fala.botao || null;
    const antes = { ...lead, mensagens: lead.mensagens.slice(0, -partes.length) };
    const julg = L.acq07LerJev(await jev(L.acq07PedidoJev(m, antes)));
    const d = L.acq07Decidir(m, antes, null, julg, fila, CFG, AGORA());
    linhas.push({ quem: 'jev', texto: julg ? `${julg.remetente} · ${julg.intencao} · etapa ${julg.etapa} · objeção ${julg.objecao} · plano ${julg.plano}` : 'indisponível', acao: d.acao, motivos: d.motivos });
    if (d.parar) { linhas.push({ quem: 'sistema', texto: 'Marcou nao_contatar. O Mercúrio não responde mais.' }); break; }
    let resposta = null, textos = [];
    if (d.responder) {
      resposta = L.acq07LerLLM(await modelo(L.acq07PedidoLLM(m, antes, d, fila, CFG)), CFG, fila.config.orientacoes, lead);
      if (!resposta.ok) { linhas.push({ quem: 'sistema', texto: 'Texto bloqueado pela conferência: ' + resposta.motivo }); if (d.modo !== 'menu') { d.caixa = true; d.motivo_caixa = 'o texto automático foi bloqueado'; textos = [L.ACQ07_TEXTO_DE_RESERVA]; } }
      else textos = resposta.partes.slice();
    }
    const it = { mensagem: m, lead: antes, decisao: d, resposta };
    if (d.cobrar && resposta && resposta.ok) {
      const [plano_nome, valor] = PIX[d.plano];
      const pedido = L.acq07PedidoCobranca(it, CFG);
      pix = { plano_nome, valor, nome: pedido.argumentos.nome, documento_final: pedido.argumentos.documento.slice(-4) };
      const cob = L.acq07PartesDaCobranca(it, { ok: true, resultado: { cobranca: { id: 'sim', plano_nome, valor, pix_copia_e_cola: '00020126...SIMULADO', link: 'https://www.asaas.com/i/SIMULADO' } } });
      textos = textos.concat(cob.partes);
      linhas.push({ quem: 'sistema', texto: `Pix falso gerado: ${plano_nome}, ${L.acq07Reais(valor)}, para ${pix.nome} (documento final ${pix.documento_final}).` });
    }
    textos.forEach((t) => add('mercurio', t));
    if (d.caixa) {
      const peds = L.acq07PedidosEscrita(it, null, null, CFG, AGORA()).filter((x) => x.ferramenta === 'aceleriq_comercial_avisar_caixa');
      peds.forEach((x) => {
        const h = { id: 'h', lead_id: lead.lead_id, tipo: x.argumentos.tipo, resumo: x.argumentos.resumo, proximo_passo: x.argumentos.proximo_passo, telefone: lead.whatsapp, dados: x.argumentos.dados, commercial_leads: { name: lead.nome, company: lead.empresa, whatsapp: lead.whatsapp } };
        const envio = L.acq08Envios(h, CFG)[0];
        repasses.push(envio.texto);
        linhas.push({ quem: 'repasse', texto: envio.texto });
      });
    }
    if (pix && p.paga && lead.mensagens.filter((x) => x.direcao === 'entrada').length && !p._pago && d.etapa === 'aguardando_pagamento') {
      p._pago = true;
      linhas.push({ quem: 'sistema', texto: `Asaas (falso) avisou: Pix de ${L.acq07Reais(pix.valor)} recebido. O painel confere o pagamento e põe na Caixa como fechou.` });
      const h = { id: 'h', lead_id: lead.lead_id, tipo: 'fechou', resumo: `${lead.empresa} fechou o plano ${pix.plano_nome}. Pix de ${L.acq07Reais(pix.valor)} confirmado no Asaas.`, proximo_passo: 'Fazer o onboarding e criar o grupo do cliente.', telefone: lead.whatsapp, dados: { pagamento_confirmado: true }, commercial_leads: { name: lead.nome, company: lead.empresa, whatsapp: lead.whatsapp } };
      const [equipe, cliente] = L.acq08Envios(h, CFG);
      repasses.push(equipe.texto);
      linhas.push({ quem: 'repasse', texto: equipe.texto });
      add('mercurio', cliente.texto);
      break;
    }
    if (fala.fim) break;
  }
  return { id: p.id, titulo: p.titulo, nicho: p.nicho, situacao: p.situacao, esperado: p.esperado, linhas, repasses, pix };
}

const [saida, so] = process.argv.slice(2);
const [conf] = await rest('commercial_agente_config?slug=eq.mercurio&select=ativo,orientacoes');
const conhecimento = await rest("agente_base_fichas?agente=eq.comercial.mercurio&ativa=eq.true&client_id=is.null&select=titulo,tecnica,quando_usar,exemplo");
const fila = { config: { ativo: true, orientacoes: conf.orientacoes, conhecimento }, itens: [] };
const lista = so ? PERSONAS.filter((p) => p.id === so) : PERSONAS;
const out = await Promise.all(lista.map((p) => simular(p, fila).catch((e) => ({ id: p.id, titulo: p.titulo, erro: String(e.message) }))));
fs.writeFileSync(saida, JSON.stringify({ gerado_em: new Date().toISOString(), modelo: C.llm_modelo, fichas: conhecimento.length, custo_usd: Math.round(custo * 1000) / 1000, conversas: out }, null, 1));
console.log('custo US$', custo.toFixed(3));
for (const c of out) console.log(c.id, c.erro || `${c.linhas.filter((l) => l.quem === 'lead').length} falas do lead, ${c.linhas.filter((l) => l.quem === 'mercurio').length} do Mercúrio, repasses ${c.repasses.length}, pix ${c.pix ? 'sim' : 'não'}, bloqueios ${c.linhas.filter((l) => /bloqueado/.test(l.texto)).length}`);
