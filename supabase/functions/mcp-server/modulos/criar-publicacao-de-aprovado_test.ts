// MCP 2.30.0 (18/11/2026): criar a publicação planejada de post já aprovado, sem banco nem rede.
import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { uuidEstavel } from '../../estudio-arte/modulos/entrega-na-agenda.ts';
import {
  aprovadoPeloCliente,
  criarPublicacaoDeAprovado,
  sementesDaCriacao,
  traduzirErroDaCriacao,
  type DependenciasDaCriacao,
} from './criar-publicacao-de-aprovado.ts';

const CLIENTE_A = '00000000-0000-4000-8000-0000000000aa';
const CLIENTE_B = '00000000-0000-4000-8000-0000000000bb';
const PROJETO = '33333333-3333-4333-8333-333333333333';
const POST = '11111111-1111-4111-8111-111111111111';
const ARQUIVO = '44444444-4444-4444-8444-444444444444';
const IG = '22222222-2222-4222-8222-2222222222a1';
const FB = '22222222-2222-4222-8222-2222222222a2';
const ADS = '22222222-2222-4222-8222-2222222222a3';
const INATIVA = '22222222-2222-4222-8222-2222222222a4';
const DE_OUTRO = '22222222-2222-4222-8222-2222222222b1';
const SEM_PROJETO = '22222222-2222-4222-8222-2222222222a5';

const ctx: AuthContext = {
  keyId: '00000000-0000-0000-0000-000000000001',
  keyName: 'test-key',
  scopes: ['editorial:write'],
  origin: 'test',
  correlationId: '00000000-0000-0000-0000-0000000000cc',
  dataScope: {
    unrestricted: false,
    clientIds: [CLIENTE_A],
    principalUserId: '00000000-0000-0000-0000-000000000001',
    source: 'oauth',
  },
};
const ctxDeOutroCliente: AuthContext = { ...ctx, dataScope: { ...ctx.dataScope, clientIds: [CLIENTE_B] } };

type Linha = Record<string, unknown>;
type Tabelas = Record<string, Linha[]>;

function tabelasBase(): Tabelas {
  return {
    editorial_posts: [{
      id: POST, version: 7, client_id: CLIENTE_A, project_id: PROJETO, primary_file_id: ARQUIVO,
      title: 'Post aprovado', content_type: 'static', objective: 'Objetivo', default_caption: 'Legenda aprovada',
      production_status: 'ready', archived_at: null,
    }],
    editorial_post_internal: [{
      post_id: POST, idempotency_key: '55555555-5555-4555-8555-555555555555', task_id: null, responsible_id: null,
      internal_notes: null, revision_of_post_id: null, approval_fingerprint: 'f'.repeat(64),
    }],
    editorial_publications: [],
    files: [{
      id: ARQUIVO, parent_file_id: null, archived_at: null, status: 'ready', agency_approval_status: 'approved',
      locked_at: '2026-11-10T10:00:00Z', visibility: 'approval', approval_status: 'approved', client_decided_at: '2026-11-10T12:00:00Z',
    }],
    external_accounts: [
      { id: IG, client_id: CLIENTE_A, platform: 'instagram', status: 'active' },
      { id: FB, client_id: CLIENTE_A, platform: 'facebook', status: 'active' },
      { id: ADS, client_id: CLIENTE_A, platform: 'meta_ads', status: 'active' },
      { id: INATIVA, client_id: CLIENTE_A, platform: 'instagram', status: 'inactive' },
      { id: DE_OUTRO, client_id: CLIENTE_B, platform: 'instagram', status: 'active' },
      { id: SEM_PROJETO, client_id: CLIENTE_A, platform: 'instagram', status: 'active' },
    ],
    project_external_accounts: [IG, FB, ADS, INATIVA, DE_OUTRO].map((id) => ({
      project_id: PROJETO, external_account_id: id, client_id: id === DE_OUTRO ? CLIENTE_B : CLIENTE_A,
    })),
  };
}

/** Banco de mentira: select/eq/maybeSingle/then sobre as tabelas acima. */
function bancoFalso(tabelas: Tabelas) {
  return {
    from(tabela: string) {
      const filtros: Array<[string, unknown]> = [];
      const resolver = () => ({
        data: (tabelas[tabela] ?? []).filter((l) => filtros.every(([c, v]) => l[c] === v)).map((l) => ({ ...l })),
        error: null,
      });
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (c: string, v: unknown) => { filtros.push([c, v]); return q; };
      q.maybeSingle = () => Promise.resolve(resolver()).then((r) => ({ data: r.data[0] ?? null, error: null }));
      q.then = (ok: (r: unknown) => unknown, falha?: (e: unknown) => unknown) => Promise.resolve(resolver()).then(ok, falha);
      return q;
    },
  };
}

function montar(tabelas: Tabelas = tabelasBase(), opcoes: { rpcFalha?: string } = {}) {
  const chamadas: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const chaves = new Set<string>();
  let n = 0;
  const deps: DependenciasDaCriacao = {
    banco: bancoFalso(tabelas),
    rpc: (nome, args) => {
      chamadas.push({ nome, args: structuredClone(args) });
      if (opcoes.rpcFalha) return Promise.reject(new Error(`mesa:rpc_recusada ${nome}: ${opcoes.rpcFalha}`));
      const payload = args.p_payload as { publications: Linha[] };
      for (const p of payload.publications) {
        const conta = tabelas.external_accounts.find((c) => c.id === p.external_account_id)!;
        n += 1;
        tabelas.editorial_publications.push({
          id: `66666666-6666-4666-8666-6666666666${String(n).padStart(2, '0')}`, post_id: POST, version: 1,
          status: 'planned', platform: conta.platform, external_account_id: p.external_account_id,
        });
      }
      return Promise.resolve({ post_id: POST, version: 8, recovered: false });
    },
    // Igual ao umaVez real: a mesma chave (com o escopo) não refaz.
    umaVez: (async (ferramenta: string, _ctx: AuthContext, chave: string, fazer: () => Promise<{ ref: string | null; resultado: Record<string, unknown> }>, escopo?: Record<string, string>) => {
      const k = `${ferramenta}|${chave}|${JSON.stringify(escopo ?? {})}`;
      if (chaves.has(k)) return { ok: true, replay: true };
      const { resultado } = await fazer();
      chaves.add(k);
      return { ok: true, ...resultado };
    }) as never,
  };
  return { deps, chamadas, tabelas };
}

const pedido = (extra: Record<string, unknown> = {}) => ({
  post_id: POST, external_account_id: IG, confirmar: true as const, idempotency_key: 'criar-pub-0001', ...extra,
});

Deno.test('caminho feliz: save_editorial_post UMA vez, uma publicação planejada, sem data, modo nem lâminas', async () => {
  const { deps, chamadas } = montar();
  const r = await criarPublicacaoDeAprovado(pedido(), ctx, deps) as Record<string, any>;
  assertEquals(chamadas.length, 1);
  assertEquals(chamadas[0].nome, 'save_editorial_post');
  assertEquals(chamadas[0].args.p_expected_version, 7);
  const payload = chamadas[0].args.p_payload as Record<string, any>;
  assertEquals(payload.id, POST);
  assertEquals(payload.client_id, CLIENTE_A);
  assertEquals(payload.project_id, PROJETO);
  assertEquals(payload.primary_file_id, ARQUIVO);
  assertEquals(payload.idempotency_key, '55555555-5555-4555-8555-555555555555');
  assertEquals(payload.publications.length, 1);
  const pub = payload.publications[0];
  assertEquals(pub.external_account_id, IG);
  assertEquals(pub.id, null);
  assertEquals(pub.caption, 'Legenda aprovada');
  for (const campo of ['scheduled_at', 'delivery_mode', 'asset_file_ids', 'reabrir_cancelada']) {
    assert(!(campo in pub), `sem ${campo}`);
  }
  assert(!JSON.stringify(payload).includes('scheduled_at'), 'nenhuma data no payload');
  // Chaves estáveis: post + conta.
  const sementes = sementesDaCriacao(POST, IG);
  assertEquals(payload.mutation_id, await uuidEstavel(sementes.mutacao));
  assertEquals(pub.idempotency_key, await uuidEstavel(`mesa-peca-publicacao:${sementes.trabalhoId}:r1:${IG}`));
  const outro = montar();
  await criarPublicacaoDeAprovado(pedido({ idempotency_key: 'outra-chave-0002' }), ctx, outro.deps);
  assertEquals((outro.chamadas[0].args.p_payload as Record<string, any>).mutation_id, payload.mutation_id, 'mesma mutação mesmo com outra chave do MCP');
  assertEquals((outro.chamadas[0].args.p_payload as Record<string, any>).publications[0].idempotency_key, pub.idempotency_key);

  assertEquals(r.ok, true);
  assertEquals(r.ja_existia, false);
  assertEquals(r.post_id, POST);
  assertEquals(r.client_id, CLIENTE_A);
  assertEquals(r.publicacao, {
    id: '66666666-6666-4666-8666-666666666601', version: 1, status: 'planned', external_account_id: IG, platform: 'instagram',
  });
  assert(r.proximo_passo.includes('aceleriq_reagendar_publicacao'));
  assert(r.proximo_passo.includes('expected_version 1'));
  assert(r.proximo_passo.includes('66666666-6666-4666-8666-666666666601'));
});

Deno.test('página do Facebook também nasce planejada', async () => {
  const { deps, chamadas } = montar();
  const r = await criarPublicacaoDeAprovado(pedido({ external_account_id: FB }), ctx, deps) as Record<string, any>;
  assertEquals(chamadas.length, 1);
  assertEquals(r.publicacao.platform, 'facebook');
  assert(!('delivery_mode' in (chamadas[0].args.p_payload as any).publications[0]));
});

Deno.test('replay: repetir não chama a RPC de novo (publicação já vista ou idempotency_key já usada)', async () => {
  const { deps, chamadas, tabelas } = montar();
  await criarPublicacaoDeAprovado(pedido(), ctx, deps);
  assertEquals(chamadas.length, 1);
  const segunda = await criarPublicacaoDeAprovado(pedido(), ctx, deps) as Record<string, any>;
  assertEquals(chamadas.length, 1, 'publicação viva: devolve sem RPC');
  assertEquals(segunda.ja_existia, true);
  // Mesmo que a leitura ainda não mostre a publicação, a idempotency_key usada não refaz.
  tabelas.editorial_publications.splice(0);
  const terceira = await criarPublicacaoDeAprovado(pedido(), ctx, deps) as Record<string, any>;
  assertEquals(chamadas.length, 1, 'umaVez não chama de novo');
  assertEquals(terceira.replay, true);
});

Deno.test('já tem publicação viva: devolve a existente sem chamar a RPC', async () => {
  const t = tabelasBase();
  t.editorial_publications.push(
    { id: 'pub-ig', post_id: POST, version: 3, status: 'planned', platform: 'instagram', external_account_id: IG },
    { id: 'pub-fb', post_id: POST, version: 2, status: 'cancelled', platform: 'facebook', external_account_id: FB },
  );
  const { deps, chamadas } = montar(t);
  const r = await criarPublicacaoDeAprovado(pedido(), ctx, deps) as Record<string, any>;
  assertEquals(chamadas.length, 0);
  assertEquals(r.ja_existia, true);
  assertEquals(r.publicacao, { id: 'pub-ig', version: 3, status: 'planned', external_account_id: IG, platform: 'instagram' });
  assert(r.proximo_passo.includes('expected_version 3'));
  assertEquals(r.aviso, undefined);
  // Pedida outra conta: continua sem RPC (o array completo cancelaria a existente), com aviso.
  const outra = await criarPublicacaoDeAprovado(pedido({ external_account_id: FB }), ctx, deps) as Record<string, any>;
  assertEquals(chamadas.length, 0);
  assertEquals(outra.ja_existia, true);
  assertEquals(outra.publicacao.id, 'pub-ig');
  assert(String(outra.aviso).includes('outra conta'));
});

Deno.test('só cancelada: recusa (reabrir é ação humana)', async () => {
  const t = tabelasBase();
  t.editorial_publications.push({ id: 'pub-c', post_id: POST, version: 4, status: 'cancelled', platform: 'instagram', external_account_id: IG });
  const { deps, chamadas } = montar(t);
  await assertRejects(() => criarPublicacaoDeAprovado(pedido(), ctx, deps), Error, 'só tem publicação cancelada');
  assertEquals(chamadas.length, 0);
});

Deno.test('fora do data scope, inexistente e arquivado recusam sem escrever', async () => {
  const { deps, chamadas } = montar();
  await assertRejects(() => criarPublicacaoDeAprovado(pedido(), ctxDeOutroCliente, deps), Error, 'outside this MCP principal data scope');
  await assertRejects(
    () => criarPublicacaoDeAprovado(pedido({ post_id: '99999999-9999-4999-8999-999999999999' }), ctx, deps),
    Error,
    'Post não encontrado',
  );
  const t = tabelasBase();
  t.editorial_posts[0].archived_at = '2026-11-15T00:00:00Z';
  const arquivado = montar(t);
  await assertRejects(() => criarPublicacaoDeAprovado(pedido(), ctx, arquivado.deps), Error, 'Post arquivado');
  // Arquivado de outro cliente: o escopo vem antes (não revela o estado).
  await assertRejects(() => criarPublicacaoDeAprovado(pedido(), ctxDeOutroCliente, arquivado.deps), Error, 'outside this MCP principal data scope');
  assertEquals(chamadas.length + arquivado.chamadas.length, 0);
});

Deno.test('sem aprovação real do cliente: recusa', async () => {
  const casos: Array<[string, (t: Tabelas) => void]> = [
    ['arquivo pendente', (t) => { t.files[0].approval_status = 'pending'; }],
    ['sem client_decided_at', (t) => { t.files[0].client_decided_at = null; }],
    ['só compartilhado', (t) => { Object.assign(t.files[0], { visibility: 'client_shared', approval_status: 'none', client_decided_at: null }); }],
    ['agência não aprovou', (t) => { t.files[0].agency_approval_status = 'pending'; }],
    ['sem fingerprint', (t) => { t.editorial_post_internal[0].approval_fingerprint = null; }],
    ['sem estado interno', (t) => { t.editorial_post_internal.splice(0); }],
    ['post não pronto', (t) => { t.editorial_posts[0].production_status = 'in_production'; }],
    ['sem arquivo principal', (t) => { t.editorial_posts[0].primary_file_id = null; }],
  ];
  for (const [nome, mexer] of casos) {
    const t = tabelasBase();
    mexer(t);
    const { deps, chamadas } = montar(t);
    await assertRejects(() => criarPublicacaoDeAprovado(pedido(), ctx, deps), Error, 'sem aprovação do cliente', nome);
    assertEquals(chamadas.length, 0, nome);
  }
});

Deno.test('conta inválida: outro cliente, meta_ads, inativa, fora do projeto ou inexistente recusam', async () => {
  const casos: Array<[string, string]> = [
    [DE_OUTRO, 'Conta não encontrada para o cliente deste post'],
    ['22222222-2222-4222-8222-2222222222ff', 'Conta não encontrada para o cliente deste post'],
    [ADS, 'só sai em Instagram ou Facebook'],
    [INATIVA, 'não está ativa'],
    [SEM_PROJETO, 'não está ligada ao projeto'],
  ];
  for (const [conta, frase] of casos) {
    const { deps, chamadas } = montar();
    const erro = await assertRejects(() => criarPublicacaoDeAprovado(pedido({ external_account_id: conta }), ctx, deps), Error, frase);
    assert(!erro.message.includes(CLIENTE_B), 'não vaza o outro cliente');
    assertEquals(chamadas.length, 0, conta);
  }
});

Deno.test('recusa do banco volta traduzida (fingerprint que não bate, conta cancelada na cadeia)', async () => {
  const { deps, chamadas } = montar(tabelasBase(), { rpcFalha: 'approved editorial copy is immutable; create a revision' });
  await assertRejects(() => criarPublicacaoDeAprovado(pedido(), ctx, deps), Error, 'A aprovação do cliente não bate mais');
  assertEquals(chamadas.length, 1);
  assert(traduzirErroDaCriacao(new Error('cancelled publication stays cancelled until an admin or manager reopens it')).includes('cancelada de propósito'));
  assert(traduzirErroDaCriacao('qualquer coisa').startsWith('A Agenda recusou'));
});

Deno.test('aprovadoPeloCliente: a regra do painel mais a decisão do cliente', () => {
  const base = {
    id: ARQUIVO, parent_file_id: null, archived_at: null, status: 'ready', agency_approval_status: 'approved',
    locked_at: '2026-11-10T10:00:00Z', visibility: 'approval', approval_status: 'approved', client_decided_at: '2026-11-10T12:00:00Z',
  };
  assert(aprovadoPeloCliente(base));
  assert(!aprovadoPeloCliente(null));
  assert(!aprovadoPeloCliente({ ...base, parent_file_id: 'pai' }), 'lâmina filha não é o principal');
  assert(!aprovadoPeloCliente({ ...base, archived_at: '2026-11-11T00:00:00Z' }));
  assert(!aprovadoPeloCliente({ ...base, locked_at: null }));
  assert(!aprovadoPeloCliente({ ...base, status: 'processing' }));
});
