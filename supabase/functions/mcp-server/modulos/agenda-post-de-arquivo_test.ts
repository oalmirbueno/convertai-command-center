// MCP 2.38.0 (20/11/2026): post da Agenda a partir de arquivo, sem banco nem rede.
import { assert, assertEquals, assertRejects, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { DataScopeError } from '../../_shared/mcp-auth.ts';
import { criarPostDeArquivo, type DependenciasDoPost, postDeArquivoSchema } from './agenda-post-de-arquivo.ts';
import { bancoFalso, type Linha, type Tabelas, umaVezFalso } from './banco-falso-de-arquivos_test_util.ts';

const CLIENTE_A = '00000000-0000-4000-8000-0000000000aa';
const CLIENTE_B = '00000000-0000-4000-8000-0000000000bb';
const PROJETO = '33333333-3333-4333-8333-333333333333';
const PROJETO_B = '33333333-3333-4333-8333-3333333333bb';
const id = (n: number) => `44444444-4444-4444-8444-4444444444${String(n).padStart(2, '0')}`;
const TASK = '77777777-7777-4777-8777-777777777777';
const POST = '11111111-1111-4111-8111-111111111111';

const ctx: AuthContext = {
  keyId: '00000000-0000-0000-0000-000000000001',
  keyName: 'test-key',
  scopes: ['editorial:write'],
  origin: 'test',
  correlationId: '00000000-0000-0000-0000-0000000000cc',
  dataScope: { unrestricted: false, clientIds: [CLIENTE_A], principalUserId: '00000000-0000-0000-0000-000000000001', source: 'oauth' },
};
const ctxDeOutro: AuthContext = { ...ctx, dataScope: { ...ctx.dataScope, clientIds: [CLIENTE_B] } };

function arquivo(n: number, extra: Linha = {}): Linha {
  return {
    id: id(n), client_id: CLIENTE_A, project_id: PROJETO, parent_file_id: n === 1 ? null : id(1),
    file_name: n === 1 ? 'Black Friday' : `Black Friday (${n}/3)`, file_type: 'carrossel', folder: 'materiais',
    caption: n === 1 ? 'Legenda da raiz' : null, description: n === 1 ? 'Objetivo da peça' : null,
    mime_type: 'image/png', extension: 'png', storage_bucket: 'files', storage_path: `${CLIENTE_A}/${id(n)}/v1/card.png`,
    file_url: `mcp-files://${CLIENTE_A}/${id(n)}/v1/card.png`, status: 'ready', archived_at: null,
    visibility: 'internal', agency_approval_status: 'not_requested', approval_status: 'none', locked_at: null,
    created_at: `2026-11-19T10:0${n}:00Z`,
    ...extra,
  };
}

function tabelas(extra: Partial<Tabelas> = {}): Tabelas {
  return {
    files: [arquivo(1), arquivo(2), arquivo(3)],
    editorial_posts: [],
    projects: [
      { id: PROJETO, client_id: CLIENTE_A, deleted_at: null },
      { id: PROJETO_B, client_id: CLIENTE_B, deleted_at: null },
    ],
    ...extra,
  };
}

function montar(t: Tabelas, opcoes: { rpcErro?: Error } = {}) {
  const banco = bancoFalso(t);
  const rpcs: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const itens: Array<Record<string, unknown>> = [];
  const deps: DependenciasDoPost = {
    banco: banco as never,
    rpc: (nome, args) => {
      rpcs.push({ nome, args: structuredClone(args) });
      if (opcoes.rpcErro) return Promise.reject(opcoes.rpcErro);
      return Promise.resolve({ post_id: POST, version: 1 });
    },
    criarItem: (entrada) => {
      itens.push(entrada);
      return Promise.resolve({ id: TASK, replayed: itens.length > 1 });
    },
    umaVez: umaVezFalso(),
    hoje: () => '2026-11-20',
  };
  return { banco, deps, rpcs, itens };
}

const base = { file_id: id(1), data: '2026-11-25' };

Deno.test('schema: data AAAA-MM-DD, confirmar=true exige idempotency_key, campos fora recusados', () => {
  assert(postDeArquivoSchema.safeParse(base).success);
  assert(!postDeArquivoSchema.safeParse({ ...base, confirmar: true }).success);
  assert(postDeArquivoSchema.safeParse({ ...base, confirmar: true, idempotency_key: 'post-0001' }).success);
  assert(!postDeArquivoSchema.safeParse({ ...base, data: '25/11/2026' }).success);
  assert(!postDeArquivoSchema.safeParse({ ...base, scheduled_at: '2026-11-25T10:00:00Z' }).success, 'não agenda');
});

Deno.test('simulação: plano de carrossel sem escrever (item, post ready, Carrossel · 3)', async () => {
  const t = tabelas();
  const { banco, deps, rpcs, itens } = montar(t);
  const r = await criarPostDeArquivo(base, ctx, deps);
  assertEquals(r.simulacao, true);
  const plano = r.plano as Record<string, unknown>;
  assertEquals(plano.content_type, 'carousel');
  assertEquals(plano.cards, 3);
  assertEquals(plano.rotulo, 'Carrossel · 3');
  assertEquals(plano.titulo, 'Black Friday');
  assertEquals(plano.legenda, 'Legenda da raiz');
  assertEquals(banco.updates.length + rpcs.length + itens.length, 0, 'nada escrito');
});

Deno.test('confirmar cria item editorial na data e o post no formato do painel, sem publicação', async () => {
  const t = tabelas();
  const { deps, rpcs, itens } = montar(t);
  const r = await criarPostDeArquivo({ ...base, confirmar: true, idempotency_key: 'post-0001' }, ctx, deps);
  assertEquals(r.post_id, POST);
  assertEquals(r.task_id, TASK);
  assertEquals(itens[0].due_date, '2026-11-25');
  assertEquals(itens[0].format, 'carousel');
  assertEquals(itens[0].project_id, PROJETO);
  assertEquals(rpcs.length, 1);
  assertEquals(rpcs[0].nome, 'save_editorial_post');
  const p = rpcs[0].args.p_payload as Record<string, unknown>;
  assertEquals(rpcs[0].args.p_expected_version, null);
  assertEquals(p.primary_file_id, id(1));
  assertEquals(p.content_type, 'carousel');
  assertEquals(p.production_status, 'ready');
  assertEquals(p.task_id, TASK);
  assertEquals(p.default_caption, 'Legenda da raiz');
  assertEquals(p.objective, 'Objetivo da peça');
  assertEquals(p.publications, [], 'sem publicação e sem data');
  assertEquals(p.revision_of_post_id, null);
  assert(/^[0-9a-f-]{36}$/.test(String(p.idempotency_key)) && /^[0-9a-f-]{36}$/.test(String(p.mutation_id)));
  assertStringIncludes(String(r.proximo_passo), 'aceleriq_arquivos_enviar_para_aprovacao');
  // Replay: a mesma chave não refaz.
  const de_novo = await criarPostDeArquivo({ ...base, confirmar: true, idempotency_key: 'post-0001' }, ctx, deps);
  assertEquals(de_novo.replay, true);
  assertEquals(rpcs.length, 1);
});

Deno.test('arquivo único: static; vídeo: video; título e legenda pedidos valem', async () => {
  const t = tabelas({ files: [arquivo(1, { file_name: 'peca.png' })] });
  const { deps, rpcs } = montar(t);
  await criarPostDeArquivo({ ...base, confirmar: true, idempotency_key: 'post-0002', titulo: 'Título novo', legenda: 'Outra' }, ctx, deps);
  const p = rpcs[0].args.p_payload as Record<string, unknown>;
  assertEquals(p.content_type, 'static');
  assertEquals(p.title, 'Título novo');
  assertEquals(p.default_caption, 'Outra');
  const tv = tabelas({ files: [arquivo(1, { file_name: 'reel.mp4', mime_type: 'video/mp4', storage_path: 'c/x/v1/reel.mp4', file_url: 'mcp-files://c/x/v1/reel.mp4' })] });
  const sim = await criarPostDeArquivo(base, ctx, montar(tv).deps);
  assertEquals((sim.plano as Record<string, unknown>).content_type, 'video');
});

Deno.test('post vivo com a raiz: ja_existia, sem duplicar', async () => {
  const t = tabelas({ editorial_posts: [{ id: POST, version: 3, title: 'Já existe', content_type: 'carousel', production_status: 'ready', project_id: PROJETO, primary_file_id: id(1), client_id: CLIENTE_A, archived_at: null }] });
  const { deps, rpcs, itens } = montar(t);
  const r = await criarPostDeArquivo({ ...base, confirmar: true, idempotency_key: 'post-0003' }, ctx, deps);
  assertEquals(r.ja_existia, true);
  assertEquals((r.post as Record<string, unknown>).id, POST);
  assertEquals(rpcs.length + itens.length, 0);
});

Deno.test('card de carrossel: recusa apontando a raiz', async () => {
  const { deps } = montar(tabelas());
  await assertRejects(() => criarPostDeArquivo({ ...base, file_id: id(2) }, ctx, deps), Error, id(1));
});

Deno.test('data no passado, outro cliente e projeto de outro cliente são recusados', async () => {
  const { deps } = montar(tabelas());
  await assertRejects(() => criarPostDeArquivo({ ...base, data: '2026-11-19' }, ctx, deps), Error, 'hoje em diante');
  await assertRejects(() => criarPostDeArquivo(base, ctxDeOutro, deps), DataScopeError);
  const semProjeto = tabelas({ files: [arquivo(1, { project_id: null })] });
  const m = montar(semProjeto);
  await assertRejects(() => criarPostDeArquivo(base, ctx, m.deps), Error, 'project_id');
  await assertRejects(() => criarPostDeArquivo({ ...base, project_id: PROJETO_B }, ctx, m.deps), Error, 'Projeto não encontrado');
  await assertRejects(() => criarPostDeArquivo({ ...base, project_id: PROJETO_B }, ctx, deps), Error, 'outro projeto');
});

Deno.test('arquivo sem projeto: adota raiz e filhos no projeto do post (como o painel) só com confirmar', async () => {
  const t = tabelas({ files: [arquivo(1, { project_id: null }), arquivo(2, { project_id: null })] });
  const { banco, deps, rpcs } = montar(t);
  const sim = await criarPostDeArquivo({ ...base, project_id: PROJETO }, ctx, deps);
  assertEquals((sim.plano as Record<string, unknown>).adota_no_projeto, [id(1), id(2)]);
  assertEquals(banco.updates.length, 0);
  await criarPostDeArquivo({ ...base, project_id: PROJETO, confirmar: true, idempotency_key: 'post-0004' }, ctx, deps);
  assertEquals(t.files.every((f) => f.project_id === PROJETO), true);
  assertEquals(Object.keys(banco.updates[0].patch), ['project_id'], 'só o projeto muda');
  assertEquals((rpcs[0].args.p_payload as Record<string, unknown>).project_id, PROJETO);
});

Deno.test('recusa da Agenda volta traduzida e não esconde a falha da sessão', async () => {
  const { deps } = montar(tabelas(), { rpcErro: new Error('mesa:rpc_recusada save_editorial_post: client access denied') });
  await assertRejects(() => criarPostDeArquivo({ ...base, confirmar: true, idempotency_key: 'post-0005' }, ctx, deps), Error, 'não tem permissão');
  const sessao = montar(tabelas(), { rpcErro: new Error('mesa:exige_oauth Agir nas mesas...') });
  await assertRejects(() => criarPostDeArquivo({ ...base, confirmar: true, idempotency_key: 'post-0006' }, ctx, sessao.deps), Error, 'mesa:exige_oauth');
});
