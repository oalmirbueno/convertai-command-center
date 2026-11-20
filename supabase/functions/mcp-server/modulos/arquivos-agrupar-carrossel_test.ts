// MCP 2.38.0 (20/11/2026): agrupar cards soltos como carrossel, sem banco nem rede.
import { assert, assertEquals, assertRejects, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { DataScopeError } from '../../_shared/mcp-auth.ts';
import {
  baseDoCarrossel,
  ehImagemDoCarrossel,
  indiceDaOrdem,
  nomeDoCard,
  ordenarComoOPainel,
  planoDoAgrupamento,
} from './carrossel-de-arquivos.ts';
import { agruparCarrossel, agruparCarrosselSchema, type DependenciasDoAgrupar } from './arquivos-agrupar-carrossel.ts';
import { bancoFalso, type Linha, type OpcoesDoBanco, type Tabelas, umaVezFalso } from './banco-falso-de-arquivos_test_util.ts';

const CLIENTE_A = '00000000-0000-4000-8000-0000000000aa';
const CLIENTE_B = '00000000-0000-4000-8000-0000000000bb';
const PROJETO = '33333333-3333-4333-8333-333333333333';
const id = (n: number) => `44444444-4444-4444-8444-4444444444${String(n).padStart(2, '0')}`;

const ctx: AuthContext = {
  keyId: '00000000-0000-0000-0000-000000000001',
  keyName: 'test-key',
  scopes: ['files:write'],
  origin: 'test',
  correlationId: '00000000-0000-0000-0000-0000000000cc',
  dataScope: { unrestricted: false, clientIds: [CLIENTE_A], principalUserId: '00000000-0000-0000-0000-000000000001', source: 'oauth' },
};
const ctxDeOutro: AuthContext = { ...ctx, dataScope: { ...ctx.dataScope, clientIds: [CLIENTE_B] } };

function arquivo(n: number, extra: Linha = {}): Linha {
  return {
    id: id(n), client_id: CLIENTE_A, project_id: PROJETO, parent_file_id: null, revision_of_file_id: null,
    file_name: `card-0${n}.png`, file_type: null, folder: 'entregas', caption: n === 1 ? 'Legenda velha' : null,
    mime_type: 'image/png', extension: 'png', storage_bucket: 'files',
    storage_path: `${CLIENTE_A}/${id(n)}/v1/card-0${n}.png`, file_url: `mcp-files://${CLIENTE_A}/${id(n)}/v1/card-0${n}.png`,
    status: 'ready', archived_at: null, visibility: 'internal', agency_approval_status: 'not_requested',
    approval_status: 'none', locked_at: null, created_at: `2026-11-19T10:0${n}:00Z`,
    ...extra,
  };
}

function montar(tabelas: Tabelas, opcoes: OpcoesDoBanco = {}) {
  const banco = bancoFalso(tabelas, opcoes);
  const auditorias: Linha[] = [];
  const deps: DependenciasDoAgrupar = {
    banco: banco as never,
    umaVez: umaVezFalso(),
    auditar: (async (e: Linha) => { auditorias.push(e); }) as never,
  };
  return { banco, deps, auditorias };
}

const cinco = () => ({ files: [1, 2, 3, 4, 5].map((n) => arquivo(n)) });
const ids5 = [1, 2, 3, 4, 5].map(id);

// ------------------------------------------------------------------ regras puras

Deno.test('ordem: mesma regra do painel (storage com número primeiro, depois (i/N), card N, created_at)', () => {
  assertEquals(indiceDaOrdem({ file_name: 'x', storage_path: 'c/r/v1/3-card-03.png' }), 3);
  assertEquals(indiceDaOrdem({ file_name: 'Post (4/5)', storage_path: 'c/r/v1/card.png' }), 4);
  assertEquals(indiceDaOrdem({ file_name: 'slide 7', storage_path: null }), 7);
  assertEquals(indiceDaOrdem({ file_name: 'Post (2/5)', storage_path: 'c/r/v1/9_x.png' }), 9, 'o storage vale antes do nome');
  const raiz: { id: string; file_name: string; storage_path?: string | null; created_at?: string } = { id: 'r', file_name: 'capa', storage_path: null };
  const filhos = [
    { id: 'b', file_name: 'sem número', created_at: '2026-01-02T00:00:00Z' },
    { id: 'a', file_name: 'sem número', created_at: '2026-01-01T00:00:00Z' },
    { id: 'c', file_name: 'Post (2/3)' },
  ];
  assertEquals(ordenarComoOPainel(raiz, filhos).map((f) => f.id), ['r', 'c', 'a', 'b']);
});

Deno.test('nomes: raiz sem sufixo, filhos "<base> (i/N)" sem extensão e sem sufixo velho', () => {
  assertEquals(nomeDoCard('Black Friday (1/5)', 1, 5), 'Black Friday');
  assertEquals(nomeDoCard('Black Friday (1/5)', 3, 5), 'Black Friday (3/5)');
  assertEquals(nomeDoCard('card-01.png', 2, 5), 'card-01 (2/5)');
  assertEquals(baseDoCarrossel('(1/3)'), 'Carrossel');
});

Deno.test('imagem do carrossel: png, jpg e webp; gif, vídeo e pdf não', () => {
  assert(ehImagemDoCarrossel({ file_name: 'a', mime_type: 'image/webp' }));
  assert(ehImagemDoCarrossel({ file_name: 'a.JPG', mime_type: null }));
  assert(!ehImagemDoCarrossel({ file_name: 'a.gif', mime_type: 'image/gif' }));
  assert(!ehImagemDoCarrossel({ file_name: 'a.mp4', mime_type: 'video/mp4' }));
  assert(!ehImagemDoCarrossel({ file_name: 'a.pdf', mime_type: null }));
});

Deno.test('plano: ordem pelo storage que contradiz o pedido é recusada sem mover nada', () => {
  const lidos = [1, 2, 3].map((n) => arquivo(n, { storage_path: `${CLIENTE_A}/${id(n)}/v1/${4 - n}-card.png` })) as never[];
  // Pedido 1,2,3; storage diz 3,2,1 para os filhos 2 e 3 (2 e 1): o painel mostraria 1,3,2.
  const p = planoDoAgrupamento([id(1), id(2), id(3)], lidos, new Set(), () => true);
  assertEquals(p.ordem_confere, false);
  assertEquals(p.ordem_resultante, [id(1), id(3), id(2)]);
  assert(p.problemas.some((x) => x.includes('número no início')));
  // Na ordem dos números do storage, passa.
  const ok = planoDoAgrupamento([id(1), id(3), id(2)], lidos, new Set(), () => true);
  assertEquals(ok.problemas, []);
});

Deno.test('plano: recusa tudo o que o painel não aceita (estado, tipo, projeto, repetição, filho, raiz com filhos)', () => {
  const lidos = [
    arquivo(1), arquivo(2, { visibility: 'approval', approval_status: 'pending', agency_approval_status: 'approved' }),
    arquivo(3, { mime_type: 'video/mp4' }), arquivo(4, { project_id: null }), arquivo(5, { parent_file_id: id(9) }),
    arquivo(6, { archived_at: '2026-11-01T00:00:00Z' }), arquivo(7, { status: 'processing' }), arquivo(8),
  ] as never[];
  const p = planoDoAgrupamento([id(1), id(2), id(3), id(4), id(5), id(6), id(7), id(8)], lidos, new Set([id(8)]), () => true);
  const texto = p.problemas.join(' | ');
  assertStringIncludes(texto, 'aceleriq_workspace_retirar_aprovacao');
  assertStringIncludes(texto, 'aguardando o cliente');
  assertStringIncludes(texto, 'não é imagem');
  assertStringIncludes(texto, 'mesmo projeto');
  assertStringIncludes(texto, 'já é card de outro carrossel');
  assertStringIncludes(texto, 'arquivado');
  assertStringIncludes(texto, 'não está pronto');
  assertStringIncludes(texto, 'já é raiz de um carrossel');
  const rep = planoDoAgrupamento([id(1), id(1)], [arquivo(1)] as never[], new Set(), () => true);
  assertStringIncludes(rep.problemas.join(' '), 'repetido');
  const outro = planoDoAgrupamento([id(1), id(2)], [arquivo(1), arquivo(2, { client_id: CLIENTE_B })] as never[], new Set(), (c) => c === CLIENTE_A);
  assertEquals(outro.problemas, ['fora_do_escopo']);
});

Deno.test('schema: confirmar=true exige idempotency_key; campos fora recusados; 2 a 20 cards', () => {
  assert(agruparCarrosselSchema.safeParse({ file_ids: ids5 }).success, 'simulação sem chave');
  assert(!agruparCarrosselSchema.safeParse({ file_ids: ids5, confirmar: true }).success);
  assert(agruparCarrosselSchema.safeParse({ file_ids: ids5, confirmar: true, idempotency_key: 'agrupar-0001' }).success);
  assert(!agruparCarrosselSchema.safeParse({ file_ids: [id(1)] }).success);
  assert(!agruparCarrosselSchema.safeParse({ file_ids: Array.from({ length: 21 }, (_, i) => id(i)) }).success);
  assert(!agruparCarrosselSchema.safeParse({ file_ids: ids5, mover: true }).success);
});

// ------------------------------------------------------------------ handler

Deno.test('simulação não escreve e devolve o plano com nomes antes e depois', async () => {
  const t = cinco();
  const { banco, deps } = montar(t);
  const r = await agruparCarrossel({ file_ids: ids5 }, ctx, deps);
  assertEquals(r.simulacao, true);
  assertEquals(r.pode_agrupar, true);
  assertEquals(banco.updates.length, 0, 'nada escrito');
  const plano = r.plano as { cards: Array<{ nome_antes: string; nome_depois: string; folder?: unknown }>; ordem_resultante: string[] };
  assertEquals(plano.cards[0].nome_depois, 'card-01.png');
  assertEquals(plano.cards[2].nome_depois, 'card-01 (3/5)');
  assertEquals(plano.cards[2].nome_antes, 'card-03.png');
  assert(plano.cards[0].folder, 'avisa a troca de pasta');
  assertEquals(plano.ordem_resultante, ids5);
  assertEquals(t.files.every((f) => f.parent_file_id === null), true);
});

Deno.test('confirmar agrupa: filhos apontam para a raiz, nomes do painel, tipo e pasta, legenda só na raiz, sem tocar em aprovação', async () => {
  const t = cinco();
  const { banco, deps, auditorias } = montar(t);
  const r = await agruparCarrossel({ file_ids: ids5, confirmar: true, idempotency_key: 'agrupar-0001', legenda: 'Legenda nova' }, ctx, deps);
  assertEquals(r.ja_agrupado, false);
  assertEquals(r.root_file_id, id(1));
  assertEquals(r.total, 5);
  assertEquals(r.rotulo, 'Carrossel · 5');
  assertEquals((r.cards as Array<{ ordem: number; file_id: string; nome: string }>)[4], { ordem: 5, file_id: id(5), nome: 'card-01 (5/5)' });
  assertStringIncludes(String(r.proximo_passo), 'aceleriq_arquivos_enviar_para_aprovacao');
  const [raiz, ...filhos] = t.files;
  assertEquals(raiz.parent_file_id, null);
  assertEquals(raiz.caption, 'Legenda nova');
  assertEquals(raiz.file_type, 'carrossel');
  assertEquals(raiz.folder, 'materiais');
  for (const [i, f] of filhos.entries()) {
    assertEquals(f.parent_file_id, id(1));
    assertEquals(f.file_name, `card-01 (${i + 2}/5)`);
    assertEquals(f.caption, null);
    assertEquals(f.visibility, 'internal');
    assertEquals(f.approval_status, 'none');
    assertEquals(f.storage_path, `${CLIENTE_A}/${id(i + 2)}/v1/card-0${i + 2}.png`, 'não move blob');
  }
  for (const u of banco.updates) {
    for (const campo of ['visibility', 'approval_status', 'agency_approval_status', 'locked_at', 'storage_path', 'archived_at']) {
      assert(!(campo in u.patch), `não mexe em ${campo}`);
    }
  }
  // A raiz é escrita por último.
  assertEquals(banco.updates[banco.updates.length - 1].ids, [id(1)]);
  // Os nomes de antes vão para a trilha.
  assertEquals(auditorias.length, 1);
  assertStringIncludes(JSON.stringify(auditorias[0]), 'card-03.png');
  // A ordem que o painel mostra agora é a pedida.
  assertEquals(ordenarComoOPainel(raiz as never, filhos as never[]).map((f: { id: string }) => f.id), ids5);
});

Deno.test('replay: a mesma chave não refaz e o mesmo conjunto já agrupado volta ja_agrupado', async () => {
  const t = cinco();
  const { banco, deps } = montar(t);
  await agruparCarrossel({ file_ids: ids5, confirmar: true, idempotency_key: 'agrupar-0001' }, ctx, deps);
  const n = banco.updates.length;
  const de_novo = await agruparCarrossel({ file_ids: ids5, confirmar: true, idempotency_key: 'agrupar-0002' }, ctx, deps);
  assertEquals(de_novo.ja_agrupado, true);
  assertEquals(banco.updates.length, n, 'nada novo escrito');
  const sim = await agruparCarrossel({ file_ids: ids5 }, ctx, deps);
  assertEquals(sim.ja_agrupado, true);
});

Deno.test('rollback: se uma linha não casa no UPDATE, desfaz as já alteradas e recusa', async () => {
  const t = cinco();
  const { deps } = montar(t, { updateNaoCasa: new Set([id(4)]) });
  const antes = structuredClone(t.files);
  await assertRejects(
    () => agruparCarrossel({ file_ids: ids5, confirmar: true, idempotency_key: 'agrupar-0003', legenda: 'X' }, ctx, deps),
    Error,
    'Nada ficou alterado',
  );
  assertEquals(t.files, antes, 'tudo voltou como estava');
});

Deno.test('arquivo já enviado ao cliente: recusa e manda retirar antes, sem escrever', async () => {
  const t = cinco();
  Object.assign(t.files[2], { visibility: 'approval', approval_status: 'pending', agency_approval_status: 'approved' });
  const { banco, deps } = montar(t);
  await assertRejects(
    () => agruparCarrossel({ file_ids: ids5, confirmar: true, idempotency_key: 'agrupar-0004' }, ctx, deps),
    Error,
    'aceleriq_workspace_retirar_aprovacao',
  );
  assertEquals(banco.updates.length, 0);
});

Deno.test('cliente fora do escopo: DataScopeError antes de qualquer detalhe ou escrita', async () => {
  const t = cinco();
  const { banco, deps } = montar(t);
  await assertRejects(() => agruparCarrossel({ file_ids: ids5 }, ctxDeOutro, deps), DataScopeError);
  await assertRejects(() => agruparCarrossel({ file_ids: ids5, confirmar: true, idempotency_key: 'agrupar-0005' }, ctxDeOutro, deps), DataScopeError);
  assertEquals(banco.updates.length, 0);
});
