// MCP 2.28.0: revisão interna, caixa "Precisa de você" e pedido ao dono, sem banco.
// As escritas rodam com a RPC e a idempotência trocadas por portas falsas; a
// leitura roda sobre um banco de mentira que só sabe devolver linhas por tabela.
import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { DataScopeError } from '../../_shared/mcp-auth.ts';
import {
  FERRAMENTAS_DE_PRECISA_DE_VOCE_E_REVISAO,
  lerLinhasDoDono,
  listarPrecisaDeVoce,
  marcarPrecisaDeVoce,
  marcarPrecisaDeVoceSchema,
  O_QUE_NAO_MUDOU,
  revisarTrabalhoInterno,
  revisarTrabalhoSchema,
  type PortaDaRevisao,
  type PortaDeEscrita,
} from './precisa-de-voce-e-revisao.ts';
import { ACAO_PEDIR_DECISAO_DO_DONO, montarPedidosDoDono, pedidosNoEscopo, tipoDaAprovacao, LINHAS_DO_DONO_VAZIAS } from './precisa-de-voce-regras.ts';

const CLIENTE_A = '11111111-1111-4111-8111-111111111111';
const CLIENTE_B = '22222222-2222-4222-8222-222222222222';
const TRABALHO = '33333333-3333-4333-8333-333333333333';
const APROVACAO = '44444444-4444-4444-8444-444444444444';

function ctx(escopo: Partial<AuthContext['dataScope']> = {}): AuthContext {
  return {
    keyId: 'key-teste',
    keyName: 'teste',
    scopes: ['aceleriq:write'],
    origin: null,
    dataScope: { unrestricted: true, clientIds: [], principalUserId: 'pessoa-1', source: 'api_key', ...escopo },
    resultRefHolder: {},
  };
}
const restrito = (...clientes: string[]) => ctx({ unrestricted: false, clientIds: clientes });

type Chamada = { nome: string; args: Record<string, unknown> };

/** Porta falsa: guarda as RPCs chamadas e imita a idempotência do MCP (a segunda vez não refaz). */
function portaFalsa(resposta: (c: Chamada) => unknown = () => ({ ok: true })) {
  const chamadas: Chamada[] = [];
  const usadas = new Map<string, string | null>();
  const porta: PortaDeEscrita = {
    rpc: (nome, args) => {
      const c = { nome, args };
      chamadas.push(c);
      return Promise.resolve(resposta(c));
    },
    umaVez: async (ferramenta, _ctx, chave, fazer) => {
      const id = `${ferramenta}:${chave}`;
      if (usadas.has(id)) return { ok: true, replay: true, ref: usadas.get(id) ?? null };
      const { ref, resultado } = await fazer();
      usadas.set(id, ref);
      return { ok: true, ...resultado, ref };
    },
  };
  return { porta, chamadas };
}

const portaDaRevisao = (trabalho: { id: string; client_id: string } | null, resposta?: (c: Chamada) => unknown) => {
  const base = portaFalsa(resposta);
  const porta: PortaDaRevisao = { ...base.porta, lerTrabalho: () => Promise.resolve(trabalho) };
  return { porta, chamadas: base.chamadas };
};

// ───────────────────────────────────────────── revisão interna

Deno.test('revisar: caminho feliz chama só a RPC da revisão interna, como a pessoa, e diz o que não mudou', async () => {
  const { porta, chamadas } = portaDaRevisao({ id: TRABALHO, client_id: CLIENTE_A }, () => ({ ok: true, revisao_decisao: 'aprovado', aprovacao_do_cliente: 'não alterada' }));
  const c = ctx();
  const r = await revisarTrabalhoInterno({ trabalho_id: TRABALHO, decisao: 'aprovado', idempotency_key: 'revisao-0001' }, c, porta) as Record<string, unknown>;
  assertEquals(chamadas.length, 1);
  assertEquals(chamadas[0].nome, 'revisar_trabalho_interno');
  assertEquals(chamadas[0].args, { p_trabalho_id: TRABALHO, p_decisao: 'aprovado', p_nota: null });
  assertEquals(r.ok, true);
  assertEquals(r.client_id, CLIENTE_A);
  assertEquals(r.aprovacao_do_cliente, 'não alterada');
  assertEquals(r.agendamento, 'nada foi agendado');
  assertEquals(r.publicacao, 'nada foi publicado');
  assertEquals(c.resultRefHolder?.value, `estudio_trabalhos:${TRABALHO}`);
});

Deno.test('revisar: ajuste leva a nota; sem nota (ou curta) o schema recusa antes de qualquer chamada', async () => {
  const { porta, chamadas } = portaDaRevisao({ id: TRABALHO, client_id: CLIENTE_A });
  const nota = 'Trocar o telefone do rodapé';
  await revisarTrabalhoInterno({ trabalho_id: TRABALHO, decisao: 'ajuste', nota, idempotency_key: 'revisao-0002' }, ctx(), porta);
  assertEquals(chamadas[0].args, { p_trabalho_id: TRABALHO, p_decisao: 'ajuste', p_nota: nota });

  assert(!revisarTrabalhoSchema.safeParse({ trabalho_id: TRABALHO, decisao: 'ajuste', idempotency_key: 'revisao-0003' }).success);
  assert(!revisarTrabalhoSchema.safeParse({ trabalho_id: TRABALHO, decisao: 'ajuste', nota: 'curta', idempotency_key: 'revisao-0003' }).success);
  const ferramenta = FERRAMENTAS_DE_PRECISA_DE_VOCE_E_REVISAO.find((t) => t.name === 'aceleriq_revisar_trabalho_interno')!;
  await assertRejects(() => ferramenta.handler({ trabalho_id: TRABALHO, decisao: 'ajuste', idempotency_key: 'revisao-0003' }, ctx()), Error, 'No ajuste, diga o que precisa mudar');
  await assertRejects(() => ferramenta.handler({ trabalho_id: TRABALHO, decisao: 'aprovado' }, ctx()), Error, 'Invalid input');
});

Deno.test('revisar: peça de cliente fora do escopo é recusada sem chamar a RPC', async () => {
  const { porta, chamadas } = portaDaRevisao({ id: TRABALHO, client_id: CLIENTE_B });
  await assertRejects(
    () => revisarTrabalhoInterno({ trabalho_id: TRABALHO, decisao: 'aprovado', idempotency_key: 'revisao-0004' }, restrito(CLIENTE_A), porta),
    DataScopeError,
  );
  assertEquals(chamadas.length, 0);
  // Escopo vazio fecha tudo.
  await assertRejects(() => revisarTrabalhoInterno({ trabalho_id: TRABALHO, decisao: 'aprovado', idempotency_key: 'revisao-0005' }, restrito(), porta), DataScopeError);
  assertEquals(chamadas.length, 0);
});

Deno.test('revisar: peça inexistente não chama a RPC; repetir a chave não revisa de novo', async () => {
  const vazia = portaDaRevisao(null);
  await assertRejects(() => revisarTrabalhoInterno({ trabalho_id: TRABALHO, decisao: 'aprovado', idempotency_key: 'revisao-0006' }, ctx(), vazia.porta), Error, 'não encontrada');
  assertEquals(vazia.chamadas.length, 0);

  const { porta, chamadas } = portaDaRevisao({ id: TRABALHO, client_id: CLIENTE_A });
  const entrada = { trabalho_id: TRABALHO, decisao: 'aprovado' as const, idempotency_key: 'revisao-0007' };
  await revisarTrabalhoInterno(entrada, ctx(), porta);
  const de_novo = await revisarTrabalhoInterno(entrada, ctx(), porta) as Record<string, unknown>;
  assertEquals(chamadas.length, 1);
  assertEquals(de_novo.replay, true);
});

Deno.test('revisar: a recusa da RPC (quem não é equipe, peça já com o cliente) sobe como erro, sem sucesso falso', async () => {
  const { porta } = portaDaRevisao({ id: TRABALHO, client_id: CLIENTE_A }, () => { throw new Error('mesa:rpc_recusada revisar_trabalho_interno: só a equipe da agência registra a revisão interna'); });
  await assertRejects(() => revisarTrabalhoInterno({ trabalho_id: TRABALHO, decisao: 'aprovado', idempotency_key: 'revisao-0008' }, ctx(), porta), Error, 'só a equipe');
});

// ───────────────────────────────────────────── marcar para o dono

const PEDIDO = { operator: 'hermes', o_que: 'Renovar o domínio do cliente', por_que: 'O valor passa do teto combinado', idempotency_key: 'precisa-0001' };

Deno.test('marcar: caminho feliz chama só a RPC do pedido ao dono, sem vínculo, e não promete nada além do pedido', async () => {
  const { porta, chamadas } = portaFalsa(() => ({ ok: true, ja_existia: false, approval_id: APROVACAO, status: 'pendente' }));
  const c = ctx();
  const r = await marcarPrecisaDeVoce(marcarPrecisaDeVoceSchema.parse(PEDIDO), c, porta) as Record<string, unknown>;
  assertEquals(chamadas.length, 1);
  assertEquals(chamadas[0].nome, 'marcar_precisa_do_dono');
  assertEquals(chamadas[0].args, {
    p_operator_slug: 'hermes',
    p_o_que: PEDIDO.o_que,
    p_por_que: PEDIDO.por_que,
    p_request_key: 'precisa-0001',
    p_client_id: null,
    p_link_id: null,
    p_kanban_task_id: null,
    p_custo_previsto: null,
  });
  assertEquals((r.pedido as Record<string, unknown>).status, 'pendente');
  assertEquals(r.aprovacao_do_cliente, O_QUE_NAO_MUDOU.aprovacao_do_cliente);
  assertEquals(r.agendamento, 'nada foi agendado');
  assertEquals(r.publicacao, 'nada foi publicado');
  assertEquals(r.ref, `operator_approvals:${APROVACAO}`);
});

Deno.test('marcar: cliente, vínculo, tarefa e custo seguem para a RPC quando informados', async () => {
  const { porta, chamadas } = portaFalsa(() => ({ ok: true, approval_id: APROVACAO }));
  await marcarPrecisaDeVoce(marcarPrecisaDeVoceSchema.parse({ ...PEDIDO, client_id: CLIENTE_A, link_id: TRABALHO, kanban_task_id: APROVACAO, custo_previsto: 250 }), ctx(), porta);
  assertEquals(chamadas[0].args.p_client_id, CLIENTE_A);
  assertEquals(chamadas[0].args.p_link_id, TRABALHO);
  assertEquals(chamadas[0].args.p_kanban_task_id, APROVACAO);
  assertEquals(chamadas[0].args.p_custo_previsto, 250);
});

Deno.test('marcar: credencial restrita só marca cliente do próprio escopo, e sempre com cliente', async () => {
  const { porta, chamadas } = portaFalsa(() => ({ ok: true, approval_id: APROVACAO }));
  await assertRejects(() => marcarPrecisaDeVoce(marcarPrecisaDeVoceSchema.parse({ ...PEDIDO, client_id: CLIENTE_B }), restrito(CLIENTE_A), porta), DataScopeError);
  await assertRejects(() => marcarPrecisaDeVoce(marcarPrecisaDeVoceSchema.parse(PEDIDO), restrito(CLIENTE_A), porta), DataScopeError, 'informe o client_id');
  assertEquals(chamadas.length, 0);
  await marcarPrecisaDeVoce(marcarPrecisaDeVoceSchema.parse({ ...PEDIDO, client_id: CLIENTE_A }), restrito(CLIENTE_A), porta);
  assertEquals(chamadas.length, 1);
});

Deno.test('marcar: mesma chave não abre dois pedidos; motivo curto não passa', async () => {
  const { porta, chamadas } = portaFalsa(() => ({ ok: true, approval_id: APROVACAO }));
  const entrada = marcarPrecisaDeVoceSchema.parse(PEDIDO);
  await marcarPrecisaDeVoce(entrada, ctx(), porta);
  const de_novo = await marcarPrecisaDeVoce(entrada, ctx(), porta) as Record<string, unknown>;
  assertEquals(chamadas.length, 1);
  assertEquals(de_novo.replay, true);

  const ferramenta = FERRAMENTAS_DE_PRECISA_DE_VOCE_E_REVISAO.find((t) => t.name === 'aceleriq_marcar_precisa_de_voce')!;
  await assertRejects(() => ferramenta.handler({ ...PEDIDO, por_que: 'porque' }, ctx()), Error, 'Invalid input');
  await assertRejects(() => ferramenta.handler({ ...PEDIDO, idempotency_key: undefined }, ctx()), Error, 'Invalid input');
});

// ───────────────────────────────────────────── o que as escritas não podem fazer

Deno.test('código: as escritas só conhecem as duas RPCs e nenhum caminho de cliente, agenda ou publicação', async () => {
  const fonte = await Deno.readTextFile(new URL('./precisa-de-voce-e-revisao.ts', import.meta.url));
  /** Só o que executa: sem comentários e sem os textos longos das descrições. */
  const codigo = fonte
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  const rpcs = [...codigo.matchAll(/porta\.rpc\('([a-z_]+)'/g)].map((m) => m[1]).sort();
  assertEquals(rpcs, ['marcar_precisa_do_dono', 'revisar_trabalho_interno']);
  assertEquals([...codigo.matchAll(/\.rpc\(/g)].length, 2, 'nenhuma outra RPC, nem pela chave de serviço');

  for (const proibido of [
    'decide_file_approval', 'aprovar_pelo_cliente', 'request_file_agency_review', 'review_file_agency',
    'mesa_enviar_para_aprovacao', 'transition_editorial_publication', 'withdraw_file_client_approval',
    'operator_approval_decidir', 'central_review',
    'chamarMesa', 'editorial_publications', 'editorial_posts', 'meta-publish', 'functions.invoke', 'fetch(',
  ]) {
    assert(!codigo.includes(proibido), `não pode aparecer: ${proibido}`);
  }
  // A chave de serviço só lê: nenhuma escrita direta em tabela.
  assert(!/\.(insert|update|upsert|delete)\(/.test(codigo), 'sem escrita direta no banco');
  // approval_status e entrega_status só aparecem em leitura (select e filtro), nunca como valor a gravar.
  assert(!/approval_status\s*:/.test(codigo) && !/entrega_status\s*:/.test(codigo));
});

Deno.test('ferramentas: três no módulo, as duas escritas com idempotency_key e a leitura marcada como leitura', () => {
  const nomes = FERRAMENTAS_DE_PRECISA_DE_VOCE_E_REVISAO.map((t) => t.name).sort();
  assertEquals(nomes, ['aceleriq_listar_precisa_de_voce', 'aceleriq_marcar_precisa_de_voce', 'aceleriq_revisar_trabalho_interno']);
  for (const t of FERRAMENTAS_DE_PRECISA_DE_VOCE_E_REVISAO) {
    const schema = t.inputSchema as { required?: string[]; additionalProperties: boolean };
    assertEquals(schema.additionalProperties, false);
    if (t.name === 'aceleriq_listar_precisa_de_voce') {
      assertEquals(t.annotations?.readOnlyHint, true);
    } else {
      assertEquals(t.annotations?.readOnlyHint, false);
      assert(schema.required?.includes('idempotency_key'));
    }
  }
});

// ───────────────────────────────────────────── a caixa (leitura)

type Filtro = { op: string; coluna: string; valor: unknown };

/** Banco de mentira: cada tabela devolve as linhas que passam nos filtros eq/neq/in; o resto encadeia sem efeito. */
function bancoFalso(tabelas: Record<string, Record<string, unknown>[] | Error>) {
  const consultas: Array<{ tabela: string; filtros: Filtro[] }> = [];
  return {
    consultas,
    from(tabela: string) {
      const filtros: Filtro[] = [];
      consultas.push({ tabela, filtros });
      const q: Record<string, unknown> = {};
      const encadeia = () => q;
      for (const m of ['select', 'order', 'limit', 'gte', 'or']) q[m] = encadeia;
      for (const op of ['eq', 'neq', 'in']) q[op] = (coluna: string, valor: unknown) => { filtros.push({ op, coluna, valor }); return q; };
      q.then = (ok: (r: unknown) => unknown, falha?: (e: unknown) => unknown) => {
        const fonte = tabelas[tabela];
        if (fonte instanceof Error) return Promise.resolve({ data: null, error: { message: fonte.message } }).then(ok, falha);
        const linhas = (fonte ?? []).filter((l) => filtros.every((f) =>
          f.op === 'eq' ? l[f.coluna] === f.valor
            : f.op === 'neq' ? l[f.coluna] !== f.valor
            : (f.valor as unknown[]).includes(l[f.coluna])));
        return Promise.resolve({ data: linhas, error: null }).then(ok, falha);
      };
      return q;
    },
  };
}

const AGORA = new Date('2026-11-14T15:00:00Z');
const aprovacao = (id: string, extra: Record<string, unknown> = {}) => ({
  id, status: 'pendente', action_kind: 'mudar_estrategia', o_que: 'Trocar a linha editorial do mês', por_que: 'O cliente pediu outro tom',
  custo_previsto: null, client_id: CLIENTE_A, task_link_id: null, created_at: '2026-11-14T10:00:00Z', invalidated_at: null, ...extra,
});

const TABELAS = {
  operator_approvals: [
    aprovacao('ap-dinheiro', { action_kind: 'gastar', o_que: 'Recarregar a conta de anúncios', custo_previsto: 300, created_at: '2026-11-14T12:00:00Z' }),
    aprovacao('ap-plano', { action_kind: 'criar_proposta', client_id: CLIENTE_B }),
    aprovacao('ap-dono', { action_kind: ACAO_PEDIR_DECISAO_DO_DONO, client_id: null, o_que: 'Definir quem atende a conta nova', por_que: 'Depende de como a equipe vai ser dividida' }),
    aprovacao('ap-decidida', { status: 'aprovado' }),
    aprovacao('ap-invalida', { invalidated_at: '2026-11-14T11:00:00Z' }),
  ],
  operator_task_links: [
    { id: 'vinc-1', status: 'doing', approval_required: true, block_reason: 'Falta o sim do dono', next_step: 'Subir a campanha', last_action: null, updated_at: '2026-11-14T09:00:00Z' },
    { id: 'vinc-feito', status: 'done', approval_required: true, block_reason: null, next_step: 'x', last_action: null, updated_at: '2026-11-14T09:00:00Z' },
  ],
  ads_rotina_acoes: [
    { id: 'acao-1', client_id: CLIENTE_A, estado: 'proposta', alvo_nome: 'Campanha de novembro', motivo: 'CPL subiu 40%', criado_em: '2026-11-14T08:00:00Z' },
  ],
  file_approval_events: [
    { id: 'ev-1', file_id: 'f1', client_id: CLIENTE_B, event_type: 'client_rejected', created_at: '2026-11-10T10:00:00Z', feedback: 'Cor errada' },
    { id: 'ev-2', file_id: 'f2', client_id: CLIENTE_B, event_type: 'client_rejected', created_at: '2026-11-12T10:00:00Z', feedback: 'Ainda não é isso' },
  ],
  estudio_trabalhos: [],
  staff_files_secure: [
    { id: 'f1', client_id: CLIENTE_B, file_name: 'banner.png', revision_of_file_id: null, approval_status: 'rejected', archived_at: null, created_at: '2026-11-09T10:00:00Z' },
    { id: 'f2', client_id: CLIENTE_B, file_name: 'banner-v2.png', revision_of_file_id: 'f1', approval_status: 'rejected', archived_at: null, created_at: '2026-11-11T10:00:00Z' },
  ],
  tasks: [],
  profiles: [
    { id: CLIENTE_A, company_name: 'Cliente A', full_name: null, plan_status: 'active', deleted_at: null },
    { id: CLIENTE_B, company_name: 'Cliente B', full_name: null, plan_status: 'active', deleted_at: null },
  ],
};

Deno.test('listar: devolve os quatro tipos na ordem da caixa, com cliente, motivo, link, onde e ids', async () => {
  const banco = bancoFalso(TABELAS);
  const r = await listarPrecisaDeVoce({}, ctx(), banco, AGORA);
  assertEquals(r.total, 6);
  assertEquals(r.por_tipo, { dinheiro: 2, cliente_ou_plano: 1, rejeicao_repetida: 1, decisao_de_agente: 2 });
  assertEquals(r.itens.map((i) => i.tipo), ['dinheiro', 'dinheiro', 'cliente_ou_plano', 'rejeicao_repetida', 'decisao_de_agente', 'decisao_de_agente']);
  assertEquals(r.incompleta, false);

  const dinheiro = r.itens[0];
  assertEquals(dinheiro.cliente, 'Cliente A');
  assertEquals(dinheiro.client_id, CLIENTE_A);
  assertEquals(dinheiro.o_que, 'Recarregar a conta de anúncios');
  assert(dinheiro.por_que.includes('Custo previsto'));
  assertEquals(dinheiro.link, '/execucao?aprovacao=ap-dinheiro');
  assertEquals(dinheiro.onde, 'Execução');
  assertEquals(dinheiro.quando, '2026-11-14T12:00:00Z');
  assertEquals(dinheiro.ids, { approval_id: 'ap-dinheiro' });

  const anuncio = r.itens[1];
  assertEquals(anuncio.link, '/anuncios/hoje');
  assertEquals(anuncio.ids, { acao_de_anuncio_id: 'acao-1' });

  const rejeitada = r.itens.find((i) => i.tipo === 'rejeicao_repetida')!;
  assertEquals(rejeitada.cliente, 'Cliente B');
  assert(rejeitada.o_que.includes('rejeitada 2 vezes'));
  assertEquals(rejeitada.onde, 'Aprovações');
  assertEquals(rejeitada.ids, { file_id: 'f1' });

  // O pedido marcado pelo agente cai como decisão de agente, e o vínculo sem pedido também.
  const decisoes = r.itens.filter((i) => i.tipo === 'decisao_de_agente');
  assertEquals(decisoes.map((d) => d.ids), [{ approval_id: 'ap-dono' }, { link_id: 'vinc-1' }]);
  assertEquals(decisoes[0].cliente, null);
  // Decidida, invalidada e vínculo concluído ficam de fora.
  const texto = JSON.stringify(r.itens);
  for (const fora of ['ap-decidida', 'ap-invalida', 'vinc-feito']) assert(!texto.includes(fora), fora);
});

Deno.test('listar: credencial restrita só vê os pedidos dos seus clientes; o que não tem cliente some', async () => {
  const r = await listarPrecisaDeVoce({}, restrito(CLIENTE_A), bancoFalso(TABELAS), AGORA);
  assertEquals(r.itens.map((i) => i.client_id), [CLIENTE_A, CLIENTE_A]);
  assertEquals(r.total, 2);
  assert(!JSON.stringify(r).includes(CLIENTE_B));
  assert(!JSON.stringify(r).includes('Cliente B'));
  assert(!JSON.stringify(r).includes('ap-dono'));

  const vazio = await listarPrecisaDeVoce({}, restrito(), bancoFalso(TABELAS), AGORA);
  assertEquals(vazio.total, 0);
  await assertRejects(() => listarPrecisaDeVoce({ client_id: CLIENTE_B }, restrito(CLIENTE_A), bancoFalso(TABELAS), AGORA), DataScopeError);
});

Deno.test('listar: filtros de tipo, cliente e limite', async () => {
  const soDinheiro = await listarPrecisaDeVoce({ tipo: 'dinheiro' }, ctx(), bancoFalso(TABELAS), AGORA);
  assertEquals(soDinheiro.total, 2);
  const doB = await listarPrecisaDeVoce({ client_id: CLIENTE_B }, ctx(), bancoFalso(TABELAS), AGORA);
  assertEquals(doB.itens.map((i) => i.tipo), ['cliente_ou_plano', 'rejeicao_repetida']);
  const um = await listarPrecisaDeVoce({ limite: 1 }, ctx(), bancoFalso(TABELAS), AGORA);
  assertEquals(um.itens.length, 1);
  assertEquals(um.total, 6);
  assertEquals(um.tem_mais, true);
});

Deno.test('listar: fonte com erro não derruba a lista e a resposta avisa que está incompleta', async () => {
  const r = await listarPrecisaDeVoce({}, ctx(), bancoFalso({ ...TABELAS, operator_task_links: new Error('timeout') }), AGORA);
  assertEquals(r.incompleta, true);
  assertEquals(r.fontes_com_erro, ['vinculos']);
  assertEquals(r.total, 5);
  // Sem a tabela de propostas de anúncio (ambiente antigo), a fonte só fica vazia.
  const semTabela = await lerLinhasDoDono(bancoFalso({ ...TABELAS, ads_rotina_acoes: new Error('relation "ads_rotina_acoes" does not exist') }), AGORA);
  assertEquals(semTabela.fontesComErro, []);
  assertEquals(semTabela.linhas.acoesDeAnuncio, []);
});

Deno.test('listar: só lê. O banco de mentira não tem escrita e nenhuma tabela de agenda é consultada', async () => {
  const banco = bancoFalso(TABELAS);
  await listarPrecisaDeVoce({}, ctx(), banco, AGORA);
  const tabelas = new Set(banco.consultas.map((c) => c.tabela));
  assertEquals([...tabelas].sort(), ['ads_rotina_acoes', 'estudio_trabalhos', 'file_approval_events', 'operator_approvals', 'operator_task_links', 'profiles', 'staff_files_secure']);
});

Deno.test('regras: o pedido marcado pelo agente é decisão de agente, salvo quando traz custo ou fala de dinheiro ou plano', () => {
  const base = { action_kind: ACAO_PEDIR_DECISAO_DO_DONO, o_que: 'Definir quem atende a conta nova', por_que: 'Depende da divisão da equipe', custo_previsto: null };
  assertEquals(tipoDaAprovacao(base), 'decisao_de_agente');
  assertEquals(tipoDaAprovacao({ ...base, custo_previsto: 90 }), 'dinheiro');
  assertEquals(tipoDaAprovacao({ ...base, o_que: 'Aprovar a recarga de verba da campanha' }), 'dinheiro');
  assertEquals(tipoDaAprovacao({ ...base, o_que: 'Cliente quer mudança de plano' }), 'cliente_ou_plano');
  // Escopo: lista vazia para credencial restrita sem clientes.
  const pedidos = montarPedidosDoDono({ ...LINHAS_DO_DONO_VAZIAS, aprovacoes: [aprovacao('x') as never], nomeDe: () => null });
  assertEquals(pedidosNoEscopo(pedidos, { unrestricted: false, clientIds: [] }), []);
  assertEquals(pedidosNoEscopo(pedidos, { unrestricted: true, clientIds: [] }).length, 1);
});
