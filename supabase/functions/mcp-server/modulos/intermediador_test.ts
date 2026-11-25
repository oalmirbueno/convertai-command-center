import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import type { ResultadoJev } from '../../_shared/jev.ts';
import {
  type Assunto,
  type Envio,
  intermediadorCancelar,
  intermediadorEnvioFeito,
  intermediadorEstado,
  intermediadorPedir,
  intermediadorRodada,
  type MsgGrupo,
  type PortaDoIntermediador,
} from './intermediador.ts';

const CLIENTE = '11111111-1111-4111-8111-111111111111';
const SEM_GRUPO = '22222222-2222-4222-8222-222222222222';
const GRUPO = '120363000000000001@g.us';
const MARCADA = '554799990000';
const OUTRA = '554788880000';
// Quarta 25/11/2026, 10h em São Paulo.
const QUARTA_10H = Date.parse('2026-11-25T13:00:00Z');

const ctx = (scopes = ['aceleriq:read', 'aceleriq:write']) => ({ keyId: 'k1', keyName: 'chave', scopes, origin: null, dataScope: { unrestricted: true, clientIds: [], principalUserId: 'p1', source: 'api_key' }, resultRefHolder: {} } as unknown as AuthContext);

type Jev = (state: unknown) => Partial<{ relacao: string; itens: number[]; humano: number; quem_e: number }>;

function memoria(opcoes: { slug?: string; grau?: string; jev?: Jev } = {}) {
  let agora = QUARTA_10H;
  let seq = 0;
  const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  const assuntos: Assunto[] = [];
  const envios: Envio[] = [];
  const eventos: { assunto_id: string | null; tipo: string; dados: Record<string, unknown>; em: string }[] = [];
  const escritas: string[] = [];
  const textosConferidos: unknown[] = [];
  let escritor: (usuario: string) => string | null = (u) => (u.includes('Tarefa: Escreva a mensagem que abre') ? 'Oi @{pessoa}, tudo certo? Vocês vão atender dia 24? E até que horas?'
    : u.includes('Feche agradecendo') ? 'Perfeito, valeu! Anotado aqui.' : u.includes('pergunte só o ponto que faltou') ? '@{pessoa} show, e até que horas fica?'
    : u.includes('lembrete') ? '@{pessoa} conseguiu ver aquela do horário?' : 'Boa, o Almir te responde por aqui.');
  let conferencia: (q: Record<string, unknown>) => Record<string, number> = () => ({});
  const devolvidas: { para: string; texto: string; estado: string }[] = [];
  const mensagens: MsgGrupo[] = [];
  const jevChamadas: unknown[] = [];
  let jev: Jev = opcoes.jev ?? (() => ({ relacao: 'responde', itens: [0.9, 0.9], humano: 0.05, quem_e: 0.02 }));
  const abertos = ['perguntando', 'esperando', 'lembrado'];

  const porta: PortaDoIntermediador = {
    agora: () => agora,
    quemChama: async () => ({ slug: opcoes.slug ?? 'fred', grau: opcoes.grau ?? 'coordenador' }),
    operadorExiste: async (s) => ['fred', 'jori', 'dono', 'default'].includes(s),
    grupoDoCliente: async (c) => (c === CLIENTE ? { group_id: GRUPO, rotulo: 'Verzelo - MKT - Aceleriq' } : null),
    pessoasDoGrupo: async (c) => (c === CLIENTE ? [{ numero: MARCADA, nome: 'Carla Souza', mensagens: 30 }, { numero: OUTRA, nome: 'Rui', mensagens: 4 }] : []),
    mensagens: async (g, desde) => mensagens.filter((m) => g === GRUPO && m.received_at > desde).sort((a, b) => a.received_at.localeCompare(b.received_at)),
    assunto: async (i) => structuredClone(assuntos.find((a) => a.id === i) ?? null),
    assuntoPorChave: async (k) => structuredClone(assuntos.find((a) => a.idempotency_key === k) ?? null),
    assuntos: async (f) => structuredClone(assuntos.filter((a) => (!f.estados || f.estados.includes(a.estado)) && (!f.client_id || a.client_id === f.client_id) && (!f.de || a.pedido_por === f.de || a.responder_para === f.de))),
    criarAssunto: async (n) => {
      const a: Assunto = { ...n, id: id(), estado: 'na_fila', pergunta_msg_id: null, perguntado_em: null, vence_em: null, lido_ate: null, envios_ao_cliente: 0, perguntou_de_volta: false, itens: {}, ouvidas: [], resposta: null, motivo: null, devolvido_em: null, fechado_em: null, criado_em: new Date(agora).toISOString() };
      assuntos.push(a);
      return structuredClone(a);
    },
    atualizarAssunto: async (i, patch, se) => {
      const a = assuntos.find((x) => x.id === i);
      if (!a || (se && !se.includes(a.estado))) return null;
      const novo = { ...a, ...patch };
      if (abertos.includes(novo.estado) && assuntos.some((x) => x.id !== i && x.group_id === novo.group_id && abertos.includes(x.estado))) return null;
      Object.assign(a, patch);
      return structuredClone(a);
    },
    envios: async (f) => structuredClone(envios.filter((e) => (!f.assunto_id || e.assunto_id === f.assunto_id) && (!f.estado || e.estado === f.estado))),
    envio: async (i) => structuredClone(envios.find((e) => e.id === i) ?? null),
    criarEnvio: async (e) => {
      if (envios.some((x) => x.assunto_id === e.assunto_id && x.tipo === e.tipo)) return null;
      const n: Envio = { ...e, id: id(), estado: 'pendente', message_id: null, criado_em: new Date(agora).toISOString(), feito_em: null };
      envios.push(n);
      return structuredClone(n);
    },
    atualizarEnvio: async (i, patch, se) => {
      const e = envios.find((x) => x.id === i);
      if (!e || (se && e.estado !== se)) return null;
      Object.assign(e, patch);
      return structuredClone(e);
    },
    ultimoEnvioNoGrupo: async (g) => {
      const ids = new Set(assuntos.filter((a) => a.group_id === g).map((a) => a.id));
      const l = envios.filter((e) => ids.has(e.assunto_id) && e.destino === 'grupo' && e.estado !== 'cancelado' && e.estado !== 'previa').map((e) => e.criado_em).sort();
      return l.length ? l[l.length - 1] : null;
    },
    evento: async (a, tipo, dados = {}) => { eventos.push({ assunto_id: a, tipo, dados, em: new Date(agora).toISOString() }); },
    devolver: async (a, texto) => { devolvidas.push({ para: a.responder_para, texto, estado: a.estado }); return id(); },
    contextoDoCliente: async () => ({ nome: 'Verzelo Jardins', dossie: 'Verzelo presta serviço de jardinagem e poda em Curitiba.' }),
    escrever: async (p) => { escritas.push(p.usuario); return escritor(p.usuario); },
    ultimoEvento: async (a, tipo) => eventos.filter((e) => e.assunto_id === a && e.tipo === tipo).map((e) => e.em).sort().pop() ?? null,
    jev: async (state, questions) => {
      if ('promete' in questions) {
        textosConferidos.push(state);
        const n = conferencia(questions);
        const answers: ResultadoJev['answers'] = {};
        for (const k of Object.keys(questions)) answers[k] = { noul: n[k] ?? (k === 'promete' ? 0.05 : 0.9) };
        return { answers, usage: null, modelo: 'jev-teste' };
      }
      jevChamadas.push(state);
      const r = { relacao: 'responde', itens: [], humano: 0, quem_e: 0, ...jev(state) };
      const answers: ResultadoJev['answers'] = { relacao: { choice: r.relacao }, humano: { noul: r.humano }, quem_e: { noul: r.quem_e } };
      r.itens.forEach((x, i) => { answers[`item_${i}`] = { noul: x }; });
      return { answers, usage: null, modelo: 'jev-teste' };
    },
  };
  return {
    porta, assuntos, envios, eventos, devolvidas, mensagens, jevChamadas, escritas, textosConferidos,
    setEscritor: (f: (usuario: string) => string | null) => { escritor = f; },
    setConferencia: (f: (q: Record<string, unknown>) => Record<string, number>) => { conferencia = f; },
    avancar: (min: number) => { agora += min * 60_000; },
    setJev: (f: Jev) => { jev = f; },
    cliente: (de: string, texto: string, extra: Partial<MsgGrupo> = {}) => {
      const em = new Date(agora).toISOString();
      mensagens.push({ id: `MSG${mensagens.length + 1}`, remetente: de, remetente_nome: de === MARCADA ? 'Carla Souza' : 'Rui', papel: 'cliente_equipe', tipo: 'texto', texto, transcricao: null, transcricao_status: 'nao_aplicavel', descricao_midia: null, resposta_a: null, occurred_at: em, received_at: em, ...extra });
    },
  };
}

const PEDIDO = {
  client_id: CLIENTE, tema: 'horário de fim de ano', pergunta: 'Vocês abrem dia 24? Até que horas?',
  o_que_conta: ['abre ou não dia 24', 'horário'], responder_para: 'fred', idempotency_key: 'fred:verzelo:horario:20261125',
};

async function perguntar(m: ReturnType<typeof memoria>) {
  await intermediadorPedir(PEDIDO, ctx(), m.porta);
  const r = await intermediadorRodada({ modo: 'grupos' }, ctx(), m.porta);
  const p = r.envios.find((e) => e.tipo === 'pergunta')!;
  await intermediadorEnvioFeito({ envio_id: p.envio_id, resultado: 'enviado', message_id: '3EB0PERGUNTA' }, ctx(), m.porta);
  return p;
}

Deno.test('pedir: abre na fila, escolhe quem mais fala e nunca devolve o número', async () => {
  const m = memoria();
  const r = await intermediadorPedir(PEDIDO, ctx(), m.porta);
  assertEquals(r.estado, 'na_fila');
  assertEquals(r.marcado, 'Carla');
  assert(!JSON.stringify(r).includes(MARCADA));
  const de_novo = await intermediadorPedir(PEDIDO, ctx(), m.porta);
  assertEquals((de_novo as { repetido?: boolean }).repetido, true);
  assertEquals(m.assuntos.length, 1);
});

Deno.test('pedir: recusa termo interno, cobrança, sem grupo e pessoa desconhecida', async () => {
  const m = memoria();
  await assertRejects(() => intermediadorPedir({ ...PEDIDO, pergunta: 'O Hermes quer saber o horário' }, ctx(), m.porta), Error, 'termo_interno');
  await assertRejects(() => intermediadorPedir({ ...PEDIDO, pergunta: 'Já pagou o boleto deste mês?' }, ctx(), m.porta), Error, 'assunto_do_almir');
  await assertRejects(() => intermediadorPedir({ ...PEDIDO, client_id: SEM_GRUPO }, ctx(), m.porta), Error, 'grupo');
  await assertRejects(() => intermediadorPedir({ ...PEDIDO, marcar: 'Fulano' }, ctx(), m.porta), Error, 'Fulano');
  assertEquals(m.assuntos.length, 0);
});

Deno.test('rodada: só o processo roda; fila abre um assunto por grupo e menciona a pessoa', async () => {
  const fora = memoria({ slug: 'fred' });
  await assertRejects(() => intermediadorRodada({ modo: 'grupos' }, ctx(), fora.porta), Error, 'processo');

  const m = memoria({ slug: 'intermediador' });
  await intermediadorPedir(PEDIDO, ctx(), m.porta);
  await intermediadorPedir({ ...PEDIDO, tema: 'fotos da fachada', pergunta: 'Podem mandar duas fotos da fachada?', idempotency_key: 'fred:verzelo:fotos:20261125' }, ctx(), m.porta);
  const r = await intermediadorRodada({ modo: 'grupos' }, ctx(), m.porta);
  assertEquals(r.envios.length, 1);
  assertEquals(r.envios[0].chat_id, GRUPO);
  assertEquals(r.envios[0].mencoes, [`${MARCADA}@s.whatsapp.net`]);
  assert(r.envios[0].texto.startsWith(`Oi @${MARCADA}, tudo certo?`));
  assert(r.envios[0].texto_previa.startsWith('Oi @Carla, tudo certo?'));
  // O escritor recebeu o contexto do cliente e a conversa; o Jev conferiu o texto antes de sair.
  assert(m.escritas[0].includes('jardinagem e poda'));
  assertEquals(m.textosConferidos.length, 1);
  assertEquals(m.assuntos.map((a) => a.estado), ['perguntando', 'na_fila']);
  // Rodada de novo não duplica a pergunta.
  assertEquals((await intermediadorRodada({ modo: 'grupos' }, ctx(), m.porta)).envios.length, 1);
});

Deno.test('rodada: fora do horário nada sai', async () => {
  const m = memoria({ slug: 'intermediador' });
  m.avancar(10 * 60); // 20h
  await intermediadorPedir(PEDIDO, ctx(), m.porta);
  assertEquals((await intermediadorRodada({ modo: 'grupos' }, ctx(), m.porta)).envios.length, 0);
});

Deno.test('caminho inteiro: outra pessoa falando de outro assunto não entra; fecha quando tudo foi respondido e devolve ao Fred', async () => {
  const m = memoria({ slug: 'intermediador', jev: (st) => JSON.stringify(st).includes('A arte de ontem') && !JSON.stringify(st).includes('meio dia')
    ? { relacao: 'outro_assunto', itens: [0.1, 0.1] } : { relacao: 'responde', itens: [0.9, 0.9] } });
  await perguntar(m);
  assertEquals(m.assuntos[0].estado, 'esperando');

  m.avancar(5);
  m.cliente(OUTRA, 'Bom dia! A arte de ontem ficou ótima');
  let r = await intermediadorRodada({ modo: 'grupos' }, ctx(), m.porta);
  assertEquals(m.jevChamadas.length, 1); // ouviu (é do cliente), mas o Jev viu que é outro assunto
  assertEquals(r.envios.length, 0);
  assertEquals(m.assuntos[0].ouvidas.length, 0); // e não entrou no que "o cliente disse"

  m.avancar(30);
  m.cliente(MARCADA, '', { tipo: 'audio', texto: null, transcricao: 'dia 24 a gente abre até meio dia', transcricao_status: 'ok' });
  r = await intermediadorRodada({ modo: 'grupos' }, ctx(), m.porta);
  assertEquals(m.jevChamadas.length, 2);
  const estado = m.jevChamadas[1] as { mensagens_do_cliente: { texto: string }[] };
  assertEquals(estado.mensagens_do_cliente.length, 1);
  assert(estado.mensagens_do_cliente[0].texto.includes('[áudio] dia 24'));
  assertEquals(r.envios.map((e) => e.tipo), ['fechamento']);
  assertEquals(m.assuntos[0].estado, 'respondido');
  assertEquals(m.devolvidas.length, 1);
  assertEquals(m.devolvidas[0].para, 'fred');
  assert(m.devolvidas[0].texto.includes('dia 24 a gente abre até meio dia'));
  assert(!m.devolvidas[0].texto.includes(MARCADA));
  const resp = m.assuntos[0].resposta as { itens: { coberto: boolean }[] };
  assert(resp.itens.every((i) => i.coberto));
});

Deno.test('quem cita a pergunta é ouvido mesmo sem ser a pessoa marcada', async () => {
  const m = memoria({ slug: 'intermediador' });
  await perguntar(m);
  m.avancar(5);
  m.cliente(OUTRA, 'Abre sim, até 12h', { resposta_a: '3EB0PERGUNTA' });
  await intermediadorRodada({ modo: 'grupos' }, ctx(), m.porta);
  assertEquals(m.assuntos[0].estado, 'respondido');
  assertEquals(m.assuntos[0].ouvidas[0].como, 'citou');
});

Deno.test('faltou um ponto: pergunta de volta só ele, uma vez; depois fecha', async () => {
  const m = memoria({ slug: 'intermediador', jev: () => ({ relacao: 'responde_parte', itens: [0.9, 0.2] }) });
  await perguntar(m);
  m.avancar(5);
  m.cliente(MARCADA, 'Abre sim');
  let r = await intermediadorRodada({ modo: 'grupos' }, ctx(), m.porta);
  const volta = r.envios.find((e) => e.tipo === 'de_volta')!;
  assert(volta.texto.startsWith(`@${MARCADA} show`));
  assert(m.escritas.some((u) => u.includes('Ponto que faltou: horário')));
  await intermediadorEnvioFeito({ envio_id: volta.envio_id, resultado: 'enviado', message_id: '3EB0VOLTA' }, ctx(), m.porta);
  m.setJev(() => ({ relacao: 'responde', itens: [0.9, 0.85] }));
  m.avancar(5);
  m.cliente(MARCADA, 'Até 12h');
  r = await intermediadorRodada({ modo: 'grupos' }, ctx(), m.porta);
  assertEquals(m.assuntos[0].estado, 'respondido');
  assertEquals(m.assuntos[0].envios_ao_cliente, 3);
});

Deno.test('pede preço ou reclama: avisa o Almir e devolve como precisa_do_almir', async () => {
  const m = memoria({ slug: 'intermediador', jev: () => ({ relacao: 'outro_assunto', itens: [0.1, 0.1], humano: 0.85 }) });
  await perguntar(m);
  m.avancar(5);
  m.cliente(MARCADA, 'Antes disso, quanto fica pra fazer mais 4 posts?');
  const r = await intermediadorRodada({ modo: 'grupos' }, ctx(), m.porta);
  assertEquals(r.envios.map((e) => `${e.tipo}:${e.destino}`).sort(), ['aviso_dono:dono', 'humano:grupo']);
  assertEquals(m.assuntos[0].estado, 'precisa_do_almir');
  assertEquals(m.devolvidas[0].para, 'fred');
});

Deno.test('"vou ver" e outro assunto: espera sem responder', async () => {
  const m = memoria({ slug: 'intermediador', jev: () => ({ relacao: 'vai_ver', itens: [0.1, 0.1] }) });
  await perguntar(m);
  m.avancar(5);
  m.cliente(MARCADA, 'Vou ver com o sócio e te falo');
  const r = await intermediadorRodada({ modo: 'grupos' }, ctx(), m.porta);
  assertEquals(r.envios.length, 0);
  assertEquals(m.assuntos[0].estado, 'esperando');
});

Deno.test('sem resposta: um lembrete na metade do prazo, depois vence e avisa o Almir', async () => {
  const m = memoria({ slug: 'intermediador' });
  await perguntar(m);
  m.avancar(6 * 60); // 16h, metade de 24 h ainda não
  assertEquals((await intermediadorRodada({ modo: 'grupos' }, ctx(), m.porta)).envios.length, 0);
  m.avancar(18 * 60); // quinta 10h: passou da metade, ainda não venceu
  m.avancar(-1);
  let r = await intermediadorRodada({ modo: 'grupos' }, ctx(), m.porta);
  assertEquals(r.envios.map((e) => e.tipo), ['lembrete']);
  assertEquals(m.assuntos[0].estado, 'lembrado');
  m.avancar(2);
  r = await intermediadorRodada({ modo: 'grupos' }, ctx(), m.porta);
  assertEquals(m.assuntos[0].estado, 'vencido');
  assert(r.envios.some((e) => e.tipo === 'aviso_dono'));
  assertEquals(m.devolvidas[0].estado, 'vencido');
});

Deno.test('prévia: a pergunta vai só ao Almir e o assunto fecha como previa', async () => {
  const m = memoria({ slug: 'intermediador' });
  await intermediadorPedir(PEDIDO, ctx(), m.porta);
  const r = await intermediadorRodada({ modo: 'previa' }, ctx(), m.porta);
  await intermediadorEnvioFeito({ envio_id: r.envios[0].envio_id, resultado: 'previa' }, ctx(), m.porta);
  assertEquals(m.assuntos[0].estado, 'previa');
  assert(m.devolvidas[0].texto.startsWith('Verzelo - MKT - Aceleriq: em prévia, a pergunta sobre "horário de fim de ano" foi só ao WhatsApp do Almir'));
  const marcado = await intermediadorEnvioFeito({ envio_id: r.envios[0].envio_id, resultado: 'previa' }, ctx(), m.porta);
  assertEquals(marcado.repetido, true);
});

Deno.test('Jev fora do ar: não decide e não avança a leitura (próxima rodada tenta de novo)', async () => {
  const m = memoria({ slug: 'intermediador' });
  await perguntar(m);
  m.porta.jev = () => Promise.reject(new Error('typesafe_529'));
  m.avancar(5);
  m.cliente(MARCADA, 'Abre até 12h');
  await intermediadorRodada({ modo: 'grupos' }, ctx(), m.porta);
  assertEquals(m.assuntos[0].estado, 'esperando');
  assertEquals(m.assuntos[0].ouvidas.length, 0);
  assert(m.eventos.some((e) => e.tipo === 'jev_falhou'));
});

Deno.test('envio incerto da pergunta: não repete, avisa o Almir', async () => {
  const m = memoria({ slug: 'intermediador' });
  await intermediadorPedir(PEDIDO, ctx(), m.porta);
  const r = await intermediadorRodada({ modo: 'grupos' }, ctx(), m.porta);
  await intermediadorEnvioFeito({ envio_id: r.envios[0].envio_id, resultado: 'incerto' }, ctx(), m.porta);
  assertEquals(m.assuntos[0].estado, 'precisa_do_almir');
  const depois = await intermediadorRodada({ modo: 'grupos' }, ctx(), m.porta);
  assertEquals(depois.envios.map((e) => e.tipo), ['aviso_dono']);
});

Deno.test('próximo assunto do mesmo grupo só abre 30 min depois da última mensagem', async () => {
  const m = memoria({ slug: 'intermediador' });
  await perguntar(m);
  await intermediadorPedir({ ...PEDIDO, tema: 'fotos da fachada', pergunta: 'Podem mandar duas fotos da fachada?', o_que_conta: ['fotos'], idempotency_key: 'fred:verzelo:fotos:20261125' }, ctx(), m.porta);
  m.avancar(5);
  m.cliente(MARCADA, 'Abre até 12h');
  let r = await intermediadorRodada({ modo: 'grupos' }, ctx(), m.porta);
  assertEquals(r.envios.map((e) => e.tipo), ['fechamento']);
  m.avancar(10);
  r = await intermediadorRodada({ modo: 'grupos' }, ctx(), m.porta);
  assertEquals(r.envios.filter((e) => e.tipo === 'pergunta').length, 0);
  m.avancar(25);
  r = await intermediadorRodada({ modo: 'grupos' }, ctx(), m.porta);
  assertEquals(r.envios.filter((e) => e.tipo === 'pergunta').length, 1);
});

Deno.test('estado e cancelar: só quem pediu vê e cancela', async () => {
  const m = memoria();
  const r = await intermediadorPedir(PEDIDO, ctx(), m.porta);
  const outro = memoria({ slug: 'trafe', grau: 'executor' });
  Object.assign(outro.porta, { assunto: m.porta.assunto, assuntos: m.porta.assuntos });
  await assertRejects(() => intermediadorEstado({ assunto_id: r.assunto_id }, ctx(), outro.porta), Error, 'não encontrado');
  assertEquals(((await intermediadorEstado({ assunto_id: r.assunto_id }, ctx(), m.porta)) as { estado: string }).estado, 'na_fila');
  const c = await intermediadorCancelar({ assunto_id: r.assunto_id, motivo: 'a peça mudou' }, ctx(), m.porta);
  assertEquals(c.estado, 'cancelado');
  assertEquals((c as { aviso?: string }).aviso, 'Nada tinha saído no grupo.');
});

Deno.test('texto que o Jev recusa duas vezes não sai: a pergunta volta para a fila e espera 15 min', async () => {
  const m = memoria({ slug: 'intermediador' });
  m.setConferencia(() => ({ natural: 0.1 }));
  await intermediadorPedir(PEDIDO, ctx(), m.porta);
  let r = await intermediadorRodada({ modo: 'grupos' }, ctx(), m.porta);
  assertEquals(r.envios.length, 0);
  assertEquals(r.feito.pergunta_segurada, 1);
  assertEquals(m.assuntos[0].estado, 'na_fila');
  assertEquals(m.escritas.length, 2);
  assert(m.escritas[1].includes('cara de texto pronto'));
  m.setConferencia(() => ({}));
  m.avancar(5);
  r = await intermediadorRodada({ modo: 'grupos' }, ctx(), m.porta);
  assertEquals(r.envios.length, 0); // ainda dentro dos 15 min
  m.avancar(11);
  r = await intermediadorRodada({ modo: 'grupos' }, ctx(), m.porta);
  assertEquals(r.envios.map((e) => e.tipo), ['pergunta']);
});

Deno.test('escritor fora do ar: nada sai e o pedido segue na fila', async () => {
  const m = memoria({ slug: 'intermediador' });
  m.setEscritor(() => null);
  await intermediadorPedir(PEDIDO, ctx(), m.porta);
  const r = await intermediadorRodada({ modo: 'grupos' }, ctx(), m.porta);
  assertEquals(r.envios.length, 0);
  assertEquals(m.assuntos[0].estado, 'na_fila');
  assert(m.eventos.some((e) => e.tipo === 'texto_segurado' && String(e.dados.motivo).includes('escritor')));
});

Deno.test('sem nome no pedido e duas pessoas falando parecido: marca as duas e ouve qualquer uma', async () => {
  const m = memoria({ slug: 'intermediador' });
  m.porta.pessoasDoGrupo = async () => [{ numero: MARCADA, nome: 'Carla Souza', mensagens: 12 }, { numero: OUTRA, nome: 'Rui', mensagens: 10 }];
  await intermediadorPedir({ ...PEDIDO }, ctx(), m.porta);
  assertEquals(m.assuntos[0].marcar_numeros, [MARCADA, OUTRA]);
  const r = await intermediadorRodada({ modo: 'grupos' }, ctx(), m.porta);
  assertEquals(r.envios[0].mencoes, [`${MARCADA}@s.whatsapp.net`, `${OUTRA}@s.whatsapp.net`]);
  assert(r.envios[0].texto.startsWith(`Oi @${MARCADA} @${OUTRA}, tudo certo?`));
  assert(r.envios[0].texto_previa.startsWith('Oi @Carla @Rui, tudo certo?'));
  await intermediadorEnvioFeito({ envio_id: r.envios[0].envio_id, resultado: 'enviado', message_id: '3EB0P' }, ctx(), m.porta);
  m.avancar(5);
  m.cliente(OUTRA, 'Atendemos dia 24 até 12h');
  await intermediadorRodada({ modo: 'grupos' }, ctx(), m.porta);
  assertEquals(m.assuntos[0].estado, 'respondido');
  assertEquals(m.assuntos[0].ouvidas[0].como, 'marcada');
});

Deno.test('nunca no vácuo: outra pessoa do cliente responde, é ouvida e passa a ser marcada (caso Casa dos Assados, 25/11)', async () => {
  const m = memoria({ slug: 'intermediador', jev: () => ({ relacao: 'responde_parte', itens: [0.9, 0.2] }) });
  await perguntar(m);
  m.avancar(3);
  m.cliente(OUTRA, 'Boa tarde');
  m.cliente(OUTRA, '10:30');
  const r = await intermediadorRodada({ modo: 'grupos' }, ctx(), m.porta);
  const volta = r.envios.find((e) => e.tipo === 'de_volta')!;
  assert(volta, 'respondeu quem respondeu');
  assertEquals(m.assuntos[0].marcar_numeros, [MARCADA, OUTRA]);
  assertEquals(volta.mencoes, [`${MARCADA}@s.whatsapp.net`, `${OUTRA}@s.whatsapp.net`]);
  assertEquals(m.assuntos[0].ouvidas.map((o) => o.como), ['outra_pessoa', 'outra_pessoa']);
});
