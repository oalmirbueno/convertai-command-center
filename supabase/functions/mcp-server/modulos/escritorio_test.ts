// MCP 2.34.0 (18/11/2026): Escritório da Aceleriq, sem banco nem rede.
// As regras são funções puras; as ferramentas rodam sobre uma porta de memória.
import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { dataScopeAllowsTool, isRestrictedApiKeyIdentityScope } from '../../_shared/mcp-security.ts';
import { ErroDaFerramenta } from './robustez.ts';
import type { VinculoDaChave } from './autoria.ts';
import {
  type Automacao,
  type Conversa,
  ENVIOS_POR_MINUTO,
  escritorioAutomacao,
  escritorioCaixa,
  escritorioDiretorio,
  escritorioEntrar,
  escritorioEnviar,
  escritorioGrupos,
  escritorioMarcarLida,
  escritorioPresenca,
  FERRAMENTAS_DO_ESCRITORIO,
  type PortaDoEscritorio,
  type Presenca,
} from './escritorio.ts';
import {
  cabeMaisUma,
  contarEntreBots,
  DONO,
  funcoesRepetidas,
  type Grupo,
  type Mensagem,
  type Operador,
  pareceTerSegredo,
  podeEscreverNaSala,
  podeFalarCom,
  presencaFresca,
  tirarSegredos,
  ultimaAtividade,
} from './escritorio-regras.ts';

const op = (slug: string, extra: Partial<Operador> = {}): Operador => ({
  slug, display_name: slug[0].toUpperCase() + slug.slice(1), role: `Função de ${slug}`, status: 'active', scope: null,
  area: null, parent_slug: null, origem: 'hermes', grau: 'executor', is_coordinator: false, last_run_at: null, ...extra,
});

/** O elenco de 18/11: Jori e Hermes Core orquestram; Fred apoia; Orion e Trafe são donos de área. */
const ELENCO: Operador[] = [
  op('jori', { origem: 'grok', grau: 'orquestrador', area: 'Coordenação', role: 'Orquestradora principal' }),
  op('default', { origem: 'hermes', grau: 'orquestrador', area: 'Coordenação', role: 'Segundo orquestrador', parent_slug: 'jori' }),
  op('fred', { origem: 'openbot', grau: 'coordenador', area: 'Coordenação', role: 'Resumo do dia e segundo cérebro', parent_slug: 'jori' }),
  op('orion', { origem: 'grok', grau: 'coordenador', area: 'Conteúdo', role: 'Social media' }),
  op('clio', { origem: 'hermes', grau: 'executor', area: 'Conteúdo', role: 'Conversas dos grupos', parent_slug: 'orion' }),
  op('trafe', { origem: 'grok', grau: 'coordenador', area: 'Tráfego', role: 'Gestor de tráfego' }),
  op('sentinela', { origem: 'grok', grau: 'leitor', area: 'Tráfego', role: 'Vigia dos anúncios', parent_slug: 'trafe' }),
  op('vela', { origem: 'hermes', grau: 'leitor', area: 'Tráfego', role: 'Gestor de tráfego', status: 'paused' }),
  op('radar', { origem: 'hermes', grau: 'executor', area: 'Tráfego', role: 'Radar', status: 'retired' }),
];

const SALA_CONTEUDO = '11111111-1111-4111-8111-111111111111';
const SALA_COORD = '22222222-2222-4222-8222-222222222222';
const TAREFA = '33333333-3333-4333-8333-333333333333';
const uuid = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;

function mundo(vinculos: Record<string, VinculoDaChave[] | null> = {}) {
  const mensagens: Mensagem[] = [];
  const conversas: Conversa[] = [];
  const leituras = new Set<string>();
  const presencas: Presenca[] = [];
  const automacoes: Automacao[] = [];
  const grupos: Grupo[] = [
    { id: SALA_CONTEUDO, slug: 'conteudo', nome: 'Conteúdo', area: 'Conteúdo', ativo: true, membros: [{ operator_slug: 'orion', papel: 'dono_da_sala' }, { operator_slug: 'clio', papel: 'membro' }] },
    { id: SALA_COORD, slug: 'coordenacao', nome: 'Coordenação', area: null, ativo: true, membros: [{ operator_slug: 'jori', papel: 'dono_da_sala' }, { operator_slug: 'default', papel: 'membro' }, { operator_slug: 'fred', papel: 'observador' }] },
  ];
  let relogio = Date.now() - 3_600_000; // uma hora atrás: dentro da janela da caixa em qualquer data
  let n = 0;
  let taxaOk = true;
  const porta: PortaDoEscritorio = {
    vinculos: (p) => Promise.resolve(p in vinculos ? vinculos[p] : []),
    operadores: () => Promise.resolve(ELENCO),
    operador: (slug) => Promise.resolve(ELENCO.find((o) => o.slug === slug) ?? null),
    grupos: () => Promise.resolve(grupos),
    conversa: (id) => Promise.resolve(conversas.find((c) => c.id === id) ?? null),
    criarConversa: (c) => { const nova = { ...c, id: uuid(++n) }; conversas.push(nova); return Promise.resolve(nova); },
    mensagemPorChave: (de, chave) => Promise.resolve(mensagens.find((m) => m.de_slug === de && m.idempotency_key === chave) ?? null),
    mensagensDaUnidade: (u) => Promise.resolve(mensagens.filter((m) => (u.task_id ? m.task_id === u.task_id : m.conversa_id === u.conversa_id))),
    mensagensDaConversa: (id, limite) => Promise.resolve(mensagens.filter((m) => m.conversa_id === id).slice(-limite)),
    mensagensPara: (slug, grupoIds, desde, limite) => Promise.resolve(
      mensagens.filter((m) => (m.para_slug === slug || (m.grupo_id !== null && grupoIds.includes(m.grupo_id))) && m.de_slug !== slug && m.created_at >= desde)
        .slice().reverse().slice(0, limite)),
    gravarMensagem: (m) => { relogio += 1000; const nova = { ...m, id: uuid(++n), created_at: new Date(relogio).toISOString() } as Mensagem; mensagens.push(nova); return Promise.resolve(nova); },
    lidas: (slug, ids) => Promise.resolve(new Set(ids.filter((id) => leituras.has(`${slug}:${id}`)))),
    marcarLidas: (slug, ids) => { for (const id of ids) leituras.add(`${slug}:${id}`); return Promise.resolve(ids.length); },
    presencas: () => Promise.resolve(presencas),
    baterPresenca: (p) => { const i = presencas.findIndex((x) => x.operator_slug === p.operator_slug); const linha = { operator_slug: p.operator_slug, fazendo: p.fazendo, plataforma: p.plataforma, batimento_em: new Date().toISOString() }; if (i >= 0) presencas[i] = linha; else presencas.push(linha); return Promise.resolve(); },
    automacoes: () => Promise.resolve(automacoes),
    gravarAutomacao: (a) => { const i = automacoes.findIndex((x) => x.plataforma === a.plataforma && x.ref === a.ref); if (i >= 0) automacoes[i] = a; else automacoes.push(a); return Promise.resolve(); },
    taxa: () => Promise.resolve({ ok: taxaOk, esperar_seg: 30 }),
  };
  // O dono escreve pela tela (RPC); aqui entra direto na memória.
  const donoEscreve = (conversa_id: string, para: string, corpo: string, task_id: string | null = null) => {
    relogio += 1000;
    mensagens.push({ id: uuid(++n), conversa_id, de_slug: DONO, de_tipo: 'humano', para_slug: para, grupo_id: null, corpo, task_id, created_at: new Date(relogio).toISOString() });
  };
  return { porta, mensagens, conversas, automacoes, presencas, donoEscreve, travarTaxa: () => { taxaOk = false; } };
}

/** Credencial ligada a um ou mais agentes (o primeiro é o padrão). */
function chave(id: string, ...slugs: string[]) {
  const ctx: AuthContext = {
    keyId: id, keyName: `chave-${id}`, scopes: ['aceleriq:write'], origin: null,
    dataScope: { unrestricted: true, clientIds: [], principalUserId: 'pessoa-1', source: 'api_key' } as AuthContext['dataScope'],
    resultRefHolder: {},
  };
  return { ctx, vinculos: { [`key:${id}`]: slugs.map((s, i) => ({ operator_slug: s, padrao: i === 0 })) } };
}

const erro = async (p: Promise<unknown>, codigo: string) => {
  const e = await assertRejects(() => p, ErroDaFerramenta);
  assertEquals(e.codigo, codigo, e.message);
  return e;
};

// ─── Regras puras ───────────────────────────────────────────────

Deno.test('escritório, grau e lugar: orquestrador fala com todos; coordenador com a área e os orquestradores; executor e leitor com o coordenador', () => {
  const de = (s: string) => ELENCO.find((o) => o.slug === s)!;
  const fala = (a: string, b: string, respondendo = false) => podeFalarCom(de(a), b === DONO ? DONO : de(b), ELENCO, respondendo);
  assert(fala('jori', 'clio').ok);
  assert(fala('default', 'trafe').ok);
  assert(fala('orion', 'clio').ok, 'coordenador com a própria área');
  assert(fala('orion', 'jori').ok, 'coordenador com orquestrador');
  const foraDaArea = fala('orion', 'trafe');
  assert(!foraDaArea.ok && foraDaArea.codigo === 'fora_da_sua_area');
  assert(fala('clio', 'orion').ok, 'executor com o coordenador dele');
  const executorParaOutro = fala('clio', 'trafe');
  assert(!executorParaOutro.ok && executorParaOutro.codigo === 'fale_com_o_coordenador' && executorParaOutro.dica.includes('orion'));
  assert(fala('sentinela', 'trafe').ok, 'leitor manda alerta ao coordenador');
  assert(!fala('sentinela', 'jori').ok);
  assert(fala('clio', 'trafe', true).ok, 'responder a quem falou com você sempre pode');
});

Deno.test('escritório 2.36.1: coordenador fala direto com o Fred (coordenador da área Coordenação), sem abrir outras áreas', () => {
  const de = (s: string) => ELENCO.find((o) => o.slug === s)!;
  const fala = (a: string, b: string) => podeFalarCom(de(a), de(b), ELENCO);
  assert(fala('orion', 'fred').ok, 'orion (Conteúdo) fala com o Fred');
  assert(fala('trafe', 'fred').ok, 'trafe (Tráfego) fala com o Fred');
  const foraDaArea = fala('orion', 'trafe');
  assert(!foraDaArea.ok && foraDaArea.codigo === 'fora_da_sua_area', 'coordenador de outra área continua fechado');
  assert(foraDaArea.dica.includes('Coordenação'), 'a dica cita a área Coordenação');
  const executor = fala('clio', 'fred');
  assert(!executor.ok && executor.codigo === 'fale_com_o_coordenador', 'executor continua sem falar com o Fred');
  const fredParado = { ...de('fred'), status: 'paused' };
  const elencoComFredParado = ELENCO.map((o) => (o.slug === 'fred' ? fredParado : o));
  const parado = podeFalarCom(de('orion'), fredParado, elencoComFredParado);
  assert(!parado.ok && parado.codigo === 'destino_parado', 'Fred parado continua recusado');
});

Deno.test('escritório: dono, agente parado e destino aposentado', () => {
  const de = (s: string) => ELENCO.find((o) => o.slug === s)!;
  assert(podeFalarCom(de('orion'), DONO, ELENCO).ok);
  const executor = podeFalarCom(de('clio'), DONO, ELENCO);
  assert(!executor.ok && executor.dica.includes('aceleriq_operator_request_approval'));
  assert(podeFalarCom(de('clio'), DONO, ELENCO, true).ok, 'responde ao dono quando ele escreveu');
  const parado = podeFalarCom(de('vela'), de('trafe'), ELENCO);
  assert(!parado.ok && parado.codigo === 'agente_parado');
  const aposentado = podeFalarCom(de('jori'), de('radar'), ELENCO);
  assert(!aposentado.ok && aposentado.codigo === 'destino_parado' && aposentado.dica.includes('trafe'), 'aponta quem responde pela área');
  const simesmo = podeFalarCom(de('jori'), de('jori'), ELENCO);
  assert(!simesmo.ok && simesmo.codigo === 'para_voce_mesmo');
});

Deno.test('escritório, salas: só membro escreve; observador só observa; orquestrador entra em qualquer sala', () => {
  const { porta: _p } = mundo();
  const de = (s: string) => ELENCO.find((o) => o.slug === s)!;
  const conteudo: Grupo = { id: SALA_CONTEUDO, slug: 'conteudo', nome: 'Conteúdo', ativo: true, membros: [{ operator_slug: 'clio', papel: 'membro' }, { operator_slug: 'fred', papel: 'observador' }] };
  assert(podeEscreverNaSala(de('clio'), conteudo).ok);
  assert(podeEscreverNaSala(de('jori'), conteudo).ok);
  const fora = podeEscreverNaSala(de('trafe'), conteudo);
  assert(!fora.ok && fora.codigo === 'fora_da_sala');
  const obs = podeEscreverNaSala(de('fred'), conteudo);
  assert(!obs.ok && obs.codigo === 'so_observa');
  const fechada = podeEscreverNaSala(de('clio'), { ...conteudo, ativo: false });
  assert(!fechada.ok && fechada.codigo === 'sala_fechada');
});

Deno.test('escritório, freio: 2 mensagens entre bots por tarefa; falar com o dono não conta; a fala do dono reabre', () => {
  const bot = (para: string | null = 'x') => ({ de_tipo: 'operador' as const, para_slug: para });
  const dono = { de_tipo: 'humano' as const, para_slug: 'x' };
  assertEquals(contarEntreBots([]), 0);
  assertEquals(contarEntreBots([bot(), bot()]), 2);
  assertEquals(contarEntreBots([bot(), bot(DONO)]), 1, 'mensagem ao dono não é entre bots');
  assertEquals(contarEntreBots([bot(), bot(), dono, bot()]), 1, 'o dono zera a conta');
  assert(cabeMaisUma([bot()], false).ok);
  const cheia = cabeMaisUma([bot(), bot(null)], false);
  assert(!cheia.ok && cheia.codigo === 'limite_entre_bots' && cheia.dica.includes('aceleriq_operator_diary'));
  assert(cabeMaisUma([bot(), bot()], true).ok, 'ao dono sempre cabe');
});

Deno.test('escritório, segredo: recusa chave, token, senha rotulada e link com token; deixa passar texto comum', () => {
  for (const ruim of [
    'a chave é mcp_live_abcdefghijklmnopqrstuvwx',
    'use sk-ant-abcdefghijklmnopqrstuvwxyz0123',
    'senha: Trocar#2026',
    'token=abc123def456',
    'Authorization: Bearer abcdefghijklmnop1234',
    'abra https://exemplo.com/entrar?token=abcdef123456',
    'EAAGm0PX4ZCpsBAKZCabcdefghijklmnopqrstuvwxyz0123456789',
  ]) assert(pareceTerSegredo(ruim), ruim);
  for (const bom of [
    'Orion, o carrossel da SKC está pronto para revisão. Tarefa 33333333-3333-4333-8333-333333333333.',
    'O cliente pediu a senha do Wi-Fi da loja no post? Não, era só a foto.',
    'CNPJ 12.345.678/0001-90 confere com o contrato.',
    'Veja https://aceleriq.online/execucao?aba=escritorio',
  ]) assert(!pareceTerSegredo(bom), bom);
  const limpo = tirarSegredos('falhou: 401 em https://api.x.com/v1?access_token=abcdef123456 com Bearer abcdefghijklmnop1234');
  assert(!pareceTerSegredo(limpo) && limpo.includes('[removido]'), limpo);
});

Deno.test('escritório, função repetida: só entre ATIVOS, mesma área e mesmo papel (sem acento e caixa)', () => {
  const lista = funcoesRepetidas([
    ...ELENCO,
    op('trafe2', { area: 'trafego', role: 'GESTOR DE TRÁFEGO', origem: 'paperclip' }),
  ]);
  assertEquals(lista.length, 1);
  assertEquals(lista[0].agentes.map((a) => a.slug).sort(), ['trafe', 'trafe2'], 'a Vela pausada não entra');
  assertEquals(funcoesRepetidas(ELENCO), []);
});

Deno.test('escritório, presença: fresca até 10 minutos; última atividade é a mais recente das duas', () => {
  const agora = Date.parse('2026-11-18T12:00:00Z');
  assert(presencaFresca('2026-11-18T11:51:00Z', agora));
  assert(!presencaFresca('2026-11-18T11:49:00Z', agora));
  assert(!presencaFresca(null, agora));
  assertEquals(ultimaAtividade('2026-11-18T10:00:00Z', null, '2026-11-18T11:00:00Z'), '2026-11-18T11:00:00.000Z');
  assertEquals(ultimaAtividade(null, undefined), null);
});

// ─── Ferramentas sobre a porta de memória ───────────────────────

Deno.test('entrar: devolve identidade, a quem responde, regras, memória, skills, salas e não lidas', async () => {
  const fred = chave('fred-1', 'fred');
  const jori = chave('jori-1', 'jori');
  const m = mundo({ ...fred.vinculos, ...jori.vinculos });
  await escritorioEnviar({ para: 'fred', texto: 'Fred, mande o resumo das 8h também para a sala.', idempotency_key: 'jori:resumo:1811' }, jori.ctx, m.porta);
  const r = await escritorioEntrar({}, fred.ctx, m.porta) as Record<string, any>;
  assertEquals(r.voce.slug, 'fred');
  assertEquals(r.voce.plataforma, 'openbot');
  assertEquals(r.voce.grau, 'coordenador');
  assertEquals(r.voce.responde_a.slug, 'jori');
  assert(r.regras_da_casa.some((x: string) => x.includes('2 mensagens')));
  assert(r.memoria[0].startsWith('memory_get_context'));
  assertEquals(r.skills.catalogo, 'aceleriq_central_skills');
  assertEquals(r.salas.map((s: any) => s.slug), ['coordenacao']);
  assertEquals(r.nao_lidas.total, 1);
  assertEquals(r.nao_lidas.mensagens[0].de, 'jori');
  const areas = r.organograma.map((a: any) => a.area);
  assert(areas.includes('Conteúdo') && areas.includes('Tráfego'));
  assert(!JSON.stringify(r.organograma).includes('"radar"'), 'aposentado fora do organograma');
  assertEquals((await escritorioEntrar({}, jori.ctx, m.porta) as any).voce.responde_a.slug, DONO, 'orquestrador sem chefe responde ao dono');
});

Deno.test('entrar: credencial só entra como os agentes ligados a ela', async () => {
  const fred = chave('fred-1', 'fred');
  const hermes = chave('hermes-1', 'default', 'clio');
  const solta = chave('solta-1');
  const m = mundo({ ...fred.vinculos, ...hermes.vinculos, ...solta.vinculos });
  const e = await erro(escritorioEntrar({ operator: 'jori' }, fred.ctx, m.porta), 'nao_e_voce');
  assert(e.dica!.includes('fred'));
  assertEquals((await escritorioEntrar({ operator: 'clio' }, hermes.ctx, m.porta) as any).voce.slug, 'clio');
  assertEquals((await escritorioEntrar({}, hermes.ctx, m.porta) as any).voce.slug, 'default', 'sem operator vale o padrão');
  await erro(escritorioEntrar({}, solta.ctx, m.porta), 'diga_quem_voce_e');
  await erro(escritorioEntrar({ operator: 'dono' }, hermes.ctx, m.porta), 'entrada_invalida');
  await erro(escritorioEntrar({ operator: 'fantasma' }, { ...hermes.ctx, scopes: ['admin'] }, m.porta), 'nao_cadastrado');
  assertEquals((await escritorioEntrar({ operator: 'jori' }, { ...solta.ctx, scopes: ['admin'] }, m.porta) as any).voce.slug, 'jori', 'a credencial do dono olha qualquer agente');
});

Deno.test('prova do combinado: o Fred manda, o Hermes Core recebe e responde, e a Jori enxerga a conversa', async () => {
  const fred = chave('fred-1', 'fred');
  const hermes = chave('hermes-1', 'default');
  const jori = chave('jori-1', 'jori');
  const m = mundo({ ...fred.vinculos, ...hermes.vinculos, ...jori.vinculos });

  const ida = await escritorioEnviar({ para: 'default', assunto: 'Inventário do Hermes', texto: 'Core, preciso do inventário de rotinas de hoje para o resumo das 18h.', idempotency_key: 'fred:inventario:1811' }, fred.ctx, m.porta) as any;
  assert(ida.ok && ida.conversa_id);
  assertEquals(ida.para, 'default');
  assert(ida.entrega.includes('5 minutos'), 'diz como o Hermes recebe');
  assertEquals(ida.mensagens_entre_bots_que_ainda_cabem, 1);
  assertEquals(fred.ctx.resultRefHolder!.value, `escritorio_mensagens:${ida.mensagem_id}`);

  const caixa = await escritorioCaixa({}, hermes.ctx, m.porta) as any;
  assertEquals(caixa.nao_lidas, 1);
  assertEquals(caixa.mensagens[0].de, 'fred');
  assertEquals(caixa.mensagens[0].lida, false);

  const volta = await escritorioEnviar({ conversa_id: ida.conversa_id, texto: 'Fred, está em Shared/inventario-hermes.json, atualizado às 17h.', idempotency_key: 'default:inventario:1811' }, hermes.ctx, m.porta) as any;
  assertEquals(volta.para, 'fred', 'resposta sem "para" vai para quem falou');
  assertEquals(volta.mensagens_entre_bots_que_ainda_cabem, 0);
  assertEquals((await escritorioMarcarLida({ conversa_id: ida.conversa_id }, hermes.ctx, m.porta) as any).marcadas, 1);
  assertEquals((await escritorioCaixa({}, hermes.ctx, m.porta) as any).nao_lidas, 0);

  const fio = await escritorioCaixa({ conversa_id: ida.conversa_id }, jori.ctx, m.porta) as any;
  assertEquals(fio.mensagens.map((x: any) => x.de), ['fred', 'default'], 'a orquestradora lê o fio sem participar');
  assertEquals(fio.conversa.assunto, 'Inventário do Hermes');
  await erro(escritorioCaixa({ conversa_id: ida.conversa_id }, chave('clio-1', 'clio').ctx, mundoCom(m, chave('clio-1', 'clio').vinculos)), 'conversa_de_outros');

  // A terceira entre bots na mesma conversa não entra; com a fala do dono, abre de novo.
  await erro(escritorioEnviar({ conversa_id: ida.conversa_id, texto: 'Obrigado!', idempotency_key: 'fred:obrigado:1811' }, fred.ctx, m.porta), 'limite_entre_bots');
  assertEquals(m.mensagens.length, 2, 'nada foi gravado');
  m.donoEscreve(ida.conversa_id, 'fred', 'Fred, confirme se o arquivo abriu.');
  const depois = await escritorioEnviar({ conversa_id: ida.conversa_id, para: 'dono', texto: 'Abriu, 14 perfis e 51 rotinas.', idempotency_key: 'fred:confirmo:1811' }, fred.ctx, m.porta) as any;
  assertEquals(depois.para, DONO);
  assert(depois.entrega.includes('painel'));
});

/** A mesma memória com mais uma credencial conhecida. */
function mundoCom(m: ReturnType<typeof mundo>, vinculos: Record<string, VinculoDaChave[]>): PortaDoEscritorio {
  const original = m.porta.vinculos;
  return { ...m.porta, vinculos: (p) => (p in vinculos ? Promise.resolve(vinculos[p]) : original(p)) };
}

Deno.test('enviar: repetir com a mesma chave não duplica', async () => {
  const jori = chave('jori-1', 'jori');
  const m = mundo(jori.vinculos);
  const a = await escritorioEnviar({ para: 'orion', texto: 'Orion, prioridade de hoje é a SKC.', idempotency_key: 'jori:prioridade:1811' }, jori.ctx, m.porta) as any;
  const b = await escritorioEnviar({ para: 'orion', texto: 'Orion, prioridade de hoje é a SKC.', idempotency_key: 'jori:prioridade:1811' }, jori.ctx, m.porta) as any;
  assertEquals(b.repetida, true);
  assertEquals(b.mensagem_id, a.mensagem_id);
  assertEquals(m.mensagens.length, 1);
  assertEquals(m.conversas.length, 1);
});

Deno.test('enviar: segredo é recusado inteiro e nada é gravado', async () => {
  const jori = chave('jori-1', 'jori');
  const m = mundo(jori.vinculos);
  const e = await erro(escritorioEnviar({ para: 'orion', texto: 'Orion, a senha: Instagram#2026 é essa.', idempotency_key: 'jori:senha:1811' }, jori.ctx, m.porta), 'tem_segredo');
  assert(e.dica!.includes('aceleriq_acesso_usar'));
  await erro(escritorioEnviar({ para: 'orion', assunto: 'token=abcdef123456', texto: 'veja', idempotency_key: 'jori:assunto:1811' }, jori.ctx, m.porta), 'tem_segredo');
  assertEquals(m.mensagens.length, 0);
  assertEquals(m.conversas.length, 0);
});

Deno.test('enviar: grau e área barram; destino aposentado aponta o dono da área; limite por tarefa vale entre conversas', async () => {
  const clio = chave('clio-1', 'clio');
  const orion = chave('orion-1', 'orion');
  const trafe = chave('trafe-1', 'trafe');
  const m = mundo({ ...clio.vinculos, ...orion.vinculos, ...trafe.vinculos });
  await erro(escritorioEnviar({ para: 'trafe', texto: 'Trafe, pode impulsionar?', idempotency_key: 'clio:impulso:1811' }, clio.ctx, m.porta), 'fale_com_o_coordenador');
  await erro(escritorioEnviar({ para: 'dono', texto: 'Almir, posso publicar?', idempotency_key: 'clio:dono:1811' }, clio.ctx, m.porta), 'fale_com_o_coordenador');
  await erro(escritorioEnviar({ para: 'trafe', texto: 'Trafe, combinamos o criativo?', idempotency_key: 'orion:trafe:1811' }, orion.ctx, m.porta), 'fora_da_sua_area');
  const apos = await erro(escritorioEnviar({ para: 'radar', texto: 'Radar, e a carteira?', idempotency_key: 'trafe:radar:1811' }, trafe.ctx, m.porta), 'destino_parado');
  assert(apos.message.includes('retired'));
  await erro(escritorioEnviar({ para: 'ninguem', texto: 'oi', idempotency_key: 'orion:ninguem:1811' }, orion.ctx, m.porta), 'nao_encontrado');
  await erro(escritorioEnviar({ texto: 'oi', idempotency_key: 'orion:semdestino:1811' }, orion.ctx, m.porta), 'entrada_invalida');
  await erro(escritorioEnviar({ para: 'clio', grupo: 'conteudo', texto: 'oi', idempotency_key: 'orion:osdois:1811' }, orion.ctx, m.porta), 'entrada_invalida');
  assertEquals(m.mensagens.length, 0);

  // Duas mensagens na mesma tarefa, em conversas diferentes: a terceira para.
  await escritorioEnviar({ para: 'clio', task_id: TAREFA, texto: 'Clio, pegue o material do grupo.', idempotency_key: 'orion:t1:1811' }, orion.ctx, m.porta);
  await escritorioEnviar({ para: 'orion', task_id: TAREFA, texto: 'Peguei, está no Workspace.', idempotency_key: 'clio:t1:1811' }, clio.ctx, m.porta);
  assertEquals(m.conversas.length, 2);
  await erro(escritorioEnviar({ grupo: 'conteudo', task_id: TAREFA, texto: 'Mais um aviso.', idempotency_key: 'orion:t2:1811' }, orion.ctx, m.porta), 'limite_entre_bots');
});

Deno.test('enviar: freio por credencial e conversa em que o agente não participa', async () => {
  const jori = chave('jori-1', 'jori');
  const orion = chave('orion-1', 'orion');
  const fred = chave('fred-1', 'fred');
  const m = mundo({ ...jori.vinculos, ...orion.vinculos, ...fred.vinculos });
  const c = await escritorioEnviar({ para: 'orion', texto: 'Orion, um ponto só nosso.', idempotency_key: 'jori:privado:1811' }, jori.ctx, m.porta) as any;
  await erro(escritorioEnviar({ conversa_id: c.conversa_id, para: 'jori', texto: 'Entrei na conversa.', idempotency_key: 'fred:intruso:1811' }, fred.ctx, m.porta), 'conversa_de_outros');
  await erro(escritorioEnviar({ conversa_id: uuid(999), texto: 'oi', idempotency_key: 'jori:fantasma:1811' }, jori.ctx, m.porta), 'nao_encontrado');
  m.travarTaxa();
  const e = await erro(escritorioEnviar({ para: 'fred', texto: 'Fred, resumo?', idempotency_key: 'jori:taxa:1811' }, jori.ctx, m.porta), 'limite_de_envio');
  assert(e.transitorio && e.dica!.includes(String(ENVIOS_POR_MINUTO)));
});

Deno.test('salas: membro escreve e os outros leem; observador e quem está fora não escrevem; histórico só para quem pode', async () => {
  const orion = chave('orion-1', 'orion');
  const clio = chave('clio-1', 'clio');
  const fred = chave('fred-1', 'fred');
  const trafe = chave('trafe-1', 'trafe');
  const m = mundo({ ...orion.vinculos, ...clio.vinculos, ...fred.vinculos, ...trafe.vinculos });
  const r = await escritorioEnviar({ grupo: 'conteudo', assunto: 'Calendário', texto: 'Semana fechada, falta só a Verzelo.', idempotency_key: 'orion:sala:1811' }, orion.ctx, m.porta) as any;
  assertEquals(r.para, 'sala conteudo');
  const caixa = await escritorioCaixa({}, clio.ctx, m.porta) as any;
  assertEquals(caixa.mensagens[0].sala, 'conteudo');
  assertEquals((await escritorioCaixa({}, orion.ctx, m.porta) as any).nao_lidas, 0, 'quem mandou não recebe a própria mensagem');
  await erro(escritorioEnviar({ grupo: 'conteudo', texto: 'oi', idempotency_key: 'trafe:sala:1811' }, trafe.ctx, m.porta), 'fora_da_sala');
  await erro(escritorioEnviar({ grupo: 'coordenacao', texto: 'oi', idempotency_key: 'fred:sala:1811' }, fred.ctx, m.porta), 'so_observa');
  await erro(escritorioEnviar({ grupo: 'financeiro', texto: 'oi', idempotency_key: 'orion:semsala:1811' }, orion.ctx, m.porta), 'nao_encontrado');

  const salas = await escritorioGrupos({}, clio.ctx, m.porta) as any;
  assertEquals(salas.salas.map((s: any) => [s.slug, s.voce_participa]), [['conteudo', true], ['coordenacao', false]]);
  const historico = await escritorioGrupos({ grupo: 'conteudo' }, clio.ctx, m.porta) as any;
  assertEquals(historico.mensagens.map((x: any) => x.de), ['orion']);
  assertEquals(historico.sala.membros.find((x: any) => x.slug === 'orion').plataforma, 'grok');
  await erro(escritorioGrupos({ grupo: 'conteudo' }, trafe.ctx, m.porta), 'fora_da_sala');
});

Deno.test('marcar lida: só o que chegou para o agente; o resto é ignorado', async () => {
  const jori = chave('jori-1', 'jori');
  const orion = chave('orion-1', 'orion');
  const trafe = chave('trafe-1', 'trafe');
  const m = mundo({ ...jori.vinculos, ...orion.vinculos, ...trafe.vinculos });
  const a = await escritorioEnviar({ para: 'orion', texto: 'Para o Orion.', idempotency_key: 'jori:a:1811' }, jori.ctx, m.porta) as any;
  const b = await escritorioEnviar({ para: 'trafe', texto: 'Para o Trafe.', idempotency_key: 'jori:b:1811' }, jori.ctx, m.porta) as any;
  const r = await escritorioMarcarLida({ mensagem_ids: [a.mensagem_id, b.mensagem_id] }, orion.ctx, m.porta) as any;
  assertEquals(r.marcadas, 1);
  assert(r.aviso);
  assertEquals((await escritorioCaixa({}, trafe.ctx, m.porta) as any).nao_lidas, 1, 'a do Trafe continua não lida');
  assertEquals((await escritorioCaixa({ so_nao_lidas: false }, orion.ctx, m.porta) as any).mensagens[0].lida, true);
  await erro(escritorioMarcarLida({}, orion.ctx, m.porta), 'entrada_invalida');
});

Deno.test('presença: registra o que está fazendo, devolve as não lidas e recusa segredo e agente parado', async () => {
  const clio = chave('clio-1', 'clio');
  const orion = chave('orion-1', 'orion');
  const vela = chave('vela-1', 'vela');
  const m = mundo({ ...clio.vinculos, ...orion.vinculos, ...vela.vinculos });
  await escritorioEnviar({ para: 'clio', texto: 'Clio, veja o grupo da SKC.', idempotency_key: 'orion:skc:1811' }, orion.ctx, m.porta);
  const r = await escritorioPresenca({ fazendo: 'Lendo o grupo da SKC' }, clio.ctx, m.porta) as any;
  assertEquals(r.nao_lidas, 1);
  assertEquals(m.presencas[0].plataforma, 'hermes');
  await erro(escritorioPresenca({ fazendo: 'entrando com senha: Abc#12345' }, clio.ctx, m.porta), 'tem_segredo');
  await erro(escritorioPresenca({}, vela.ctx, m.porta), 'agente_parado');

  const dir = await escritorioDiretorio({ area: 'conteudo' }, clio.ctx, m.porta) as any;
  const linha = dir.agentes.find((a: any) => a.slug === 'clio');
  assertEquals(linha.agora, true);
  assertEquals(linha.fazendo, 'Lendo o grupo da SKC');
  assertEquals(linha.dono_da_area, 'orion');
  assert(linha.como_falar.includes('aceleriq_escritorio_enviar para="clio"'));
});

Deno.test('diretório: todas as plataformas, filtros, inativos só quando pedidos e função repetida', async () => {
  const jori = chave('jori-1', 'jori');
  const m = mundo(jori.vinculos);
  const todos = await escritorioDiretorio({}, jori.ctx, m.porta) as any;
  assertEquals(todos.total, 7, 'pausada e aposentado ficam de fora');
  assertEquals(todos.por_plataforma, { grok: 4, hermes: 2, openbot: 1 });
  assertEquals(todos.funcoes_repetidas, []);
  assertEquals((await escritorioDiretorio({ plataforma: 'openbot' }, jori.ctx, m.porta) as any).agentes.map((a: any) => a.slug), ['fred']);
  assertEquals((await escritorioDiretorio({ grau: 'leitor' }, jori.ctx, m.porta) as any).agentes.map((a: any) => a.slug), ['sentinela']);
  const comInativos = await escritorioDiretorio({ incluir_inativos: true, busca: 'trafego' }, jori.ctx, m.porta) as any;
  assertEquals(comInativos.agentes.map((a: any) => a.slug).sort(), ['radar', 'sentinela', 'trafe', 'vela']);
  assert(comInativos.agentes.find((a: any) => a.slug === 'radar').como_falar.includes('Fora de operação'));
  assert(!('automacoes' in todos));
});

Deno.test('automação: cadastra, conta execução e erro, tira segredo do erro e aparece no diretório', async () => {
  const n8n = chave('n8n-1', 'default');
  const m = mundo(n8n.vinculos);
  await erro(escritorioAutomacao({ ref: 'Acq03PostNoArPub', evento: 'ok' }, n8n.ctx, m.porta), 'entrada_invalida');
  const c = await escritorioAutomacao({ ref: 'Acq03PostNoArPub', evento: 'cadastro', nome: 'Clientes: aviso de post no ar', dono: 'orion' }, n8n.ctx, m.porta) as any;
  assertEquals(c.automacao.execucoes, 0);
  await escritorioAutomacao({ ref: 'Acq03PostNoArPub', evento: 'ok' }, n8n.ctx, m.porta);
  const e = await escritorioAutomacao({ ref: 'Acq03PostNoArPub', evento: 'erro', erro: '401 em https://graph.facebook.com/v20/me?access_token=EAAGabcdef123456 ao publicar' }, n8n.ctx, m.porta) as any;
  assertEquals([e.automacao.execucoes, e.automacao.erros, e.automacao.ultimo_status], [2, 1, 'erro']);
  assert(!pareceTerSegredo(m.automacoes[0].ultimo_erro) && m.automacoes[0].ultimo_erro!.includes('[removido]'));
  assertEquals(m.automacoes[0].dono_slug, 'orion', 'o dono não some nos avisos seguintes');
  const semDono = await escritorioAutomacao({ ref: 'AcqSaudeTeste001', evento: 'cadastro', nome: 'Apoio: teste de saúde' }, n8n.ctx, m.porta) as any;
  assert(semDono.aviso.includes('não tem dono'));
  const dir = await escritorioDiretorio({ automacoes: true }, n8n.ctx, m.porta) as any;
  assertEquals(dir.automacoes.length, 2);
  assertEquals(dir.automacoes.find((a: any) => a.ref === 'Acq03PostNoArPub').dono, 'orion');
});

Deno.test('catálogo do Escritório: oito ferramentas, todas com manual, escrita sempre com a credencial do agente', () => {
  assertEquals(FERRAMENTAS_DO_ESCRITORIO.map((t) => t.name), [
    'aceleriq_escritorio_entrar', 'aceleriq_escritorio_diretorio', 'aceleriq_escritorio_enviar', 'aceleriq_escritorio_caixa',
    'aceleriq_escritorio_marcar_lida', 'aceleriq_escritorio_grupos', 'aceleriq_escritorio_presenca', 'aceleriq_escritorio_automacao',
  ]);
  for (const t of FERRAMENTAS_DO_ESCRITORIO) {
    assert(t.description.length > 80, t.name);
    assert(!/[—–]/.test(t.description), `${t.name}: sem travessão`);
    assertEquals((t.inputSchema as { additionalProperties: boolean }).additionalProperties, false);
    const escreve = t.annotations?.readOnlyHint === false;
    const esperado = t.name === 'aceleriq_escritorio_entrar'
      ? ['aceleriq:read', 'escritorio:identity']
      : [escreve ? 'aceleriq:write' : 'aceleriq:read'];
    assertEquals([...t.scopes], esperado);
  }
});

// ─── Identidade restrita: chave API de funcionário não-admin ───

/** Chave API restrita (dono não-admin, escopo de clientes definido), ligada aos slugs dados. */
function chaveRestrita(id: string, slugs: string[] | null, extra: Partial<AuthContext> = {}, scope: Partial<AuthContext['dataScope']> = {}) {
  const ctx: AuthContext = {
    keyId: id, keyName: `restrita-${id}`, scopes: ['aceleriq:read'], origin: null,
    dataScope: { unrestricted: false, clientIds: ['cccccccc-cccc-4ccc-8ccc-cccccccccccc'], principalUserId: 'funcionario-1', source: 'api_key', ...scope },
    resultRefHolder: {}, ...extra,
  };
  return { ctx, vinculos: { [`key:${id}`]: slugs === null ? null : slugs.map((s, i) => ({ operator_slug: s, padrao: i === 0 })) } };
}

/**
 * Porta que explode se a variante restrita listar operadores ou tocar caixa, salas, leituras, presença ou
 * escrita. Registra cada leitura de vínculo (com semCache) e cada lookup de operador pelo slug.
 */
function portaSoIdentidade(vinculos: Record<string, VinculoDaChave[] | null>, chamadas: string[] = []) {
  const base = mundo(vinculos).porta;
  const proibido = (nome: string) => () => { throw new Error(`identidade restrita não pode chamar ${nome}`); };
  return {
    ...base,
    vinculos: (p: string, o?: { semCache?: boolean }) => { chamadas.push(`vinculos:${p}:${o?.semCache === true ? 'sem-cache' : 'cache'}`); return base.vinculos(p, o); },
    operador: (slug: string) => { chamadas.push(`operador:${slug}`); return base.operador(slug); },
    operadores: proibido('operadores'),
    grupos: proibido('grupos'), conversa: proibido('conversa'), criarConversa: proibido('criarConversa'),
    mensagemPorChave: proibido('mensagemPorChave'), mensagensDaUnidade: proibido('mensagensDaUnidade'),
    mensagensDaConversa: proibido('mensagensDaConversa'), mensagensPara: proibido('mensagensPara'),
    gravarMensagem: proibido('gravarMensagem'), lidas: proibido('lidas'), marcarLidas: proibido('marcarLidas'),
    presencas: proibido('presencas'), baterPresenca: proibido('baterPresenca'), automacoes: proibido('automacoes'),
    gravarAutomacao: proibido('gravarAutomacao'), taxa: proibido('taxa'),
  } as PortaDoEscritorio;
}

Deno.test('entrar restrito: chave não-admin com vínculo único e ativo vê só a própria identidade', async () => {
  const elo = chaveRestrita('elo', ['clio']);
  const ctx = { ...elo.ctx, scopes: ['escritorio:identity'] };
  for (const pedido of [{}, { operator: 'clio' }, { operator: ' CLIO ' }]) {
    const chamadas: string[] = [];
    const porta = portaSoIdentidade(elo.vinculos, chamadas);
    const r = await escritorioEntrar(pedido, ctx, porta) as Record<string, any>;
    // Vínculo lido sem cache; operador buscado só pelo próprio slug, sem listar o elenco.
    assertEquals(chamadas, ['vinculos:key:elo:sem-cache', 'operador:clio']);
    assertEquals(Object.keys(r).sort(), ['aviso', 'modo', 'voce']);
    assertEquals(r.modo, 'identidade_restrita');
    assertEquals(r.voce, { slug: 'clio', nome: 'Clio', plataforma: r.voce.plataforma, funcao: 'Conversas dos grupos', area: 'Conteúdo', grau: 'executor', status: 'active' });
    const texto = JSON.stringify(r);
    for (const outro of ELENCO.map((o) => o.slug).filter((s) => s !== 'clio')) assert(!texto.includes(`"${outro}"`), `vazou ${outro}`);
    for (const campo of ['organograma', 'salas', 'nao_lidas', 'equipe', 'responde_a', 'escopo', 'regras_da_casa', 'memoria']) {
      assert(!(campo in r) && !(campo in r.voce), `vazou ${campo}`);
    }
  }
});

Deno.test('entrar restrito: outro slug, dono e qualquer campo a mais são recusados', async () => {
  const elo = chaveRestrita('elo', ['clio']);
  const chamadas: string[] = [];
  const porta = portaSoIdentidade(elo.vinculos, chamadas);
  // Slug existente, inexistente, inativo e o dono: mesma resposta, sem citar o próprio slug nem o pedido,
  // e sem lookup do slug pedido (não vira oráculo de quem existe).
  const respostas = new Set<string>();
  for (const outro of ['orion', 'fantasma', 'vela', 'fred', 'dono']) {
    const e = await erro(escritorioEntrar({ operator: outro }, elo.ctx, porta), 'nao_e_voce');
    const texto = `${e.message} ${e.dica ?? ''}`;
    assert(!texto.includes('clio') && !texto.includes(outro), `vazou em ${outro}`);
    respostas.add(texto);
  }
  assertEquals(respostas.size, 1);
  assert(chamadas.every((c) => !c.startsWith('operador:')), chamadas.join(','));
  await erro(escritorioEntrar({ operator: 'clio', organograma: true }, elo.ctx, porta), 'entrada_invalida');
  await erro(escritorioEntrar({ client_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }, elo.ctx, porta), 'entrada_invalida');
});

Deno.test('entrar restrito: sem vínculo, vínculo múltiplo, tabela ausente ou agente inativo continuam negados', async () => {
  const casos: Array<[string[] | null, string]> = [
    [[], 'identidade_restrita_sem_vinculo'],
    [['clio', 'orion'], 'identidade_restrita_sem_vinculo'],
    [null, 'identidade_restrita_sem_vinculo'],
    [['vela'], 'identidade_restrita_inativa'],
    [['radar'], 'identidade_restrita_inativa'],
    [['fantasma'], 'identidade_restrita_inativa'],
  ];
  for (const [slugs, codigo] of casos) {
    const k = chaveRestrita('k', slugs);
    await erro(escritorioEntrar({}, k.ctx, portaSoIdentidade(k.vinculos)), codigo);
  }
  // Credencial restrita sem nenhuma linha de vínculo cadastrada.
  const solta = chaveRestrita('solta', ['clio']);
  await erro(escritorioEntrar({}, solta.ctx, portaSoIdentidade({})), 'identidade_restrita_sem_vinculo');
});

Deno.test('entrar restrito: dono ausente, zero clientes, OAuth, admin ou contexto ausente negam antes de ler vínculo', async () => {
  const semEscopo = chaveRestrita('d', ['clio']);
  (semEscopo.ctx as { dataScope?: unknown }).dataScope = undefined;
  const negados = [
    chaveRestrita('a', ['clio'], { scopes: ['aceleriq:read', 'admin'] }),
    chaveRestrita('b', ['clio'], {}, { source: 'oauth' }),
    chaveRestrita('oauth:x', ['clio']),
    chaveRestrita('c', ['clio'], {}, { principalUserId: null }),
    chaveRestrita('c2', ['clio'], {}, { principalUserId: '   ' }),
    chaveRestrita('z', ['clio'], {}, { clientIds: [] }),
    chaveRestrita('u', ['clio'], {}, { unrestricted: undefined as unknown as boolean }),
    semEscopo,
  ];
  for (const k of negados) {
    const chamadas: string[] = [];
    await erro(escritorioEntrar({}, k.ctx, portaSoIdentidade(k.vinculos, chamadas)), 'identidade_restrita_negada');
    assertEquals(chamadas, [], `${k.ctx.keyId} leu o banco antes de negar`);
  }
});

Deno.test('entrar irrestrito (legado) segue igual: organograma, salas e caixa', async () => {
  const fred = chave('fred', 'fred');
  const r = await escritorioEntrar({}, fred.ctx, mundo(fred.vinculos).porta) as any;
  assert(Array.isArray(r.organograma) && Array.isArray(r.salas) && r.nao_lidas);
  assertEquals(r.voce.slug, 'fred');
});

Deno.test('despachante: mesmo predicado do handler; só a chave API restrita completa alcança entrar', () => {
  const ENTRAR = 'aceleriq_escritorio_entrar';
  const api = { unrestricted: false, source: 'api_key', principalUserId: 'funcionario-1', clientIds: ['c1'] };
  assert(isRestrictedApiKeyIdentityScope(api));
  assert(dataScopeAllowsTool(api, ENTRAR));
  const negados: unknown[] = [
    undefined, null, {},
    { ...api, source: 'oauth' },
    { ...api, source: undefined },
    { ...api, principalUserId: null },
    { ...api, principalUserId: '' },
    { ...api, clientIds: [] },
    { ...api, clientIds: undefined },
    { ...api, unrestricted: undefined },
    { ...api, unrestricted: 'false' },
    { unrestricted: false },
  ];
  for (const s of negados) {
    const scope = s as Parameters<typeof dataScopeAllowsTool>[0];
    assert(!isRestrictedApiKeyIdentityScope(scope), JSON.stringify(s));
    assert(!dataScopeAllowsTool(scope, ENTRAR), JSON.stringify(s));
  }
  for (const t of FERRAMENTAS_DO_ESCRITORIO.filter((x) => x.name !== ENTRAR)) {
    assert(!dataScopeAllowsTool(api, t.name), t.name);
  }
  assert(!dataScopeAllowsTool(api, 'aceleriq_operator_board'));
  assert(!dataScopeAllowsTool(api, 'future_private_tool'));
  // Legado: só unrestricted === true abre tudo; truthy que não é true não abre.
  assert(dataScopeAllowsTool({ unrestricted: true, source: 'oauth' }, ENTRAR));
  assert(dataScopeAllowsTool({ unrestricted: true }, 'future_private_tool'));
  assert(!dataScopeAllowsTool({ unrestricted: 1 } as unknown as Parameters<typeof dataScopeAllowsTool>[0], 'future_private_tool'));
  // Público continua público, mesmo sem contexto.
  assert(dataScopeAllowsTool(undefined, 'qualquer', true));
});
