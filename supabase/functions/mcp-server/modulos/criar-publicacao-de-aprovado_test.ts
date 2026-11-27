// MCP 2.30.0 (18/11/2026): criar a publicação planejada de post já aprovado, sem banco nem rede.
import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { uuidEstavel } from '../../estudio-arte/modulos/entrega-na-agenda.ts';
import {
  aprovacaoDispensada,
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

function montar(tabelas: Tabelas = tabelasBase(), opcoes: { rpcFalha?: string; rpcErro?: Error } = {}) {
  const chamadas: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const chaves = new Set<string>();
  let n = 0;
  const deps: DependenciasDaCriacao = {
    banco: bancoFalso(tabelas),
    rpc: (nome, args) => {
      chamadas.push({ nome, args: structuredClone(args) });
      if (opcoes.rpcErro) return Promise.reject(opcoes.rpcErro);
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

Deno.test('2.35.1: falha da sessão do dono sobe como mesa:dono_da_chave, não como rpc_recusada', async () => {
  const sessao = 'mesa:dono_da_chave Não foi possível abrir a sessão do dono da chave agora. Tente de novo.';
  const { deps } = montar(tabelasBase(), { rpcErro: new Error(sessao) });
  const erro = await assertRejects(() => criarPublicacaoDeAprovado(pedido(), ctx, deps), Error);
  assertEquals(erro.message, sessao);
  const recusa = montar(tabelasBase(), { rpcFalha: 'cancelled publication stays cancelled until an admin or manager reopens it' });
  const real = await assertRejects(() => criarPublicacaoDeAprovado(pedido(), ctx, recusa.deps), Error);
  assert(real.message.startsWith('mesa:rpc_recusada '), real.message);
  assert(real.message.includes('cancelada de propósito'));
});

// ------------------------------------------------------------------ 2.42.2: aprovação dispensada no cadastro

/** O caso real da Softy: agência aprovou, liberado para aprovação, sem decisão e sem trava. */
function tabelasPendentes(modo: string | null): Tabelas {
  const t = tabelasBase();
  Object.assign(t.files[0], {
    client_id: CLIENTE_A, project_id: PROJETO, locked_at: null, visibility: 'approval', approval_status: 'pending',
    requires_approval: true, client_decided_at: null, client_decided_by: null,
  });
  t.editorial_posts[0].content_type = 'reel';
  if (modo !== null) t.profiles = [{ id: CLIENTE_A, modo_aprovacao_do_cliente: modo }];
  return t;
}

Deno.test('2.42.2 dispensada: cria pela mesma RPC, sem data, e responde a origem da dispensa', async () => {
  const { deps, chamadas, tabelas } = montar(tabelasPendentes('dispensada'));
  const r = await criarPublicacaoDeAprovado(pedido(), ctx, deps) as Record<string, any>;
  assertEquals(chamadas.length, 1);
  assertEquals(chamadas[0].nome, 'save_editorial_post');
  assert(!JSON.stringify(chamadas[0].args).includes('scheduled_at'), 'não agenda');
  assertEquals(r.ja_existia, false);
  assertEquals(r.publicacao.status, 'planned');
  assertEquals(r.aprovacao_do_cliente.modo, 'dispensada');
  assertEquals(r.aprovacao_do_cliente.origem, 'profiles.modo_aprovacao_do_cliente');
  assert(String(r.aprovacao_do_cliente.decisao_do_cliente).includes('nada foi aprovado nem decidido em nome do cliente'));
  assert(String(r.aprovacao_do_cliente.arquivo).includes(ARQUIVO), 'a regra vale para o arquivo anexado');
  assert(String(r.aprovacao_do_cliente.registro).includes('client_approval_waived'));
  // Nada no arquivo muda: a ferramenta não aprova nem decide.
  assertEquals(tabelas.files[0].approval_status, 'pending');
  assertEquals(tabelas.files[0].client_decided_at, null);
  assertEquals(tabelas.files[0].locked_at, null);
  assert(chamadas.every((c) => !/decide_file_approval|aprovar_pelo_cliente|release_file/.test(c.nome)));
});

Deno.test('2.42.2 dispensada com publicação viva: devolve a existente e a origem, sem RPC', async () => {
  const t = tabelasPendentes('dispensada');
  t.editorial_publications.push({ id: 'pub-ig', post_id: POST, version: 2, status: 'planned', platform: 'instagram', external_account_id: IG });
  const { deps, chamadas } = montar(t);
  const r = await criarPublicacaoDeAprovado(pedido(), ctx, deps) as Record<string, any>;
  assertEquals(chamadas.length, 0);
  assertEquals(r.ja_existia, true);
  assertEquals(r.aprovacao_do_cliente.modo, 'dispensada');
  assert(String(r.aprovacao_do_cliente.arquivo).includes(ARQUIVO));
  // Nenhum evento foi lido: a resposta não afirma que o registro existe.
  assert(String(r.aprovacao_do_cliente.registro).startsWith('não conferido'), r.aprovacao_do_cliente.registro);
  assert(!String(r.aprovacao_do_cliente.registro).includes('grava'));
});

/** Estado normal da agência: aprovado internamente, ainda sem pedir o cliente. Vídeo. */
function tabelasInternas(modo: string | null): Tabelas {
  const t = tabelasPendentes(modo);
  Object.assign(t.files[0], { visibility: 'internal', approval_status: 'none', requires_approval: false, mime_type: 'video/mp4' });
  t.editorial_posts[0].content_type = 'video';
  return t;
}

Deno.test('2.42.2 dispensada no estado interno aprovado pela agência (vídeo): cria sem pedir o cliente', async () => {
  const { deps, chamadas, tabelas } = montar(tabelasInternas('dispensada'));
  const r = await criarPublicacaoDeAprovado(pedido(), ctx, deps) as Record<string, any>;
  assertEquals(chamadas.length, 1);
  assertEquals(chamadas[0].nome, 'save_editorial_post');
  assertEquals(r.aprovacao_do_cliente.modo, 'dispensada');
  assertEquals(tabelas.files[0].visibility, 'internal', 'não libera ao cliente');
  assertEquals(tabelas.files[0].approval_status, 'none');
  assert(chamadas.every((c) => !/release_file|decide_file_approval|aprovar_pelo_cliente/.test(c.nome)));
});

Deno.test('2.42.2 portal no estado interno aprovado pela agência: recusa', async () => {
  for (const modo of ['portal', 'Dispensada', null]) {
    const { deps, chamadas } = montar(tabelasInternas(modo));
    await assertRejects(() => criarPublicacaoDeAprovado(pedido(), ctx, deps), Error, 'sem aprovação do cliente', String(modo));
    assertEquals(chamadas.length, 0, String(modo));
  }
});

Deno.test('2.42.2 dispensada com post pronto sem selo: o save canônico grava o primeiro selo; portal segue recusando', async () => {
  for (const tabelas of [tabelasPendentes('dispensada'), tabelasInternas('dispensada')]) {
    tabelas.editorial_post_internal[0].approval_fingerprint = null;
    const { deps, chamadas } = montar(tabelas);
    const r = await criarPublicacaoDeAprovado(pedido(), ctx, deps) as Record<string, any>;
    assertEquals(chamadas.length, 1);
    assertEquals(chamadas[0].args.p_expected_version, 7, 'versão conferida pelo banco');
    assertEquals(r.ja_existia, false);
  }
  const portal = tabelasPendentes('portal');
  portal.editorial_post_internal[0].approval_fingerprint = null;
  const recusa = montar(portal);
  await assertRejects(() => criarPublicacaoDeAprovado(pedido(), ctx, recusa.deps), Error, 'sem aprovação do cliente');
  assertEquals(recusa.chamadas.length, 0);
  // Selo presente e divergente: quem recusa é o banco, e a frase volta traduzida.
  const divergente = montar(tabelasPendentes('dispensada'), { rpcFalha: 'approved editorial copy is immutable; create a revision' });
  await assertRejects(() => criarPublicacaoDeAprovado(pedido(), ctx, divergente.deps), Error, 'A aprovação do cliente não bate mais');
});

Deno.test('2.42.2 portal, regra desconhecida ou cadastro ausente: as mesmas condições recusam como antes', async () => {
  for (const modo of ['portal', 'Dispensada', 'dispensada ', '', null]) {
    const { deps, chamadas } = montar(tabelasPendentes(modo));
    await assertRejects(() => criarPublicacaoDeAprovado(pedido(), ctx, deps), Error, 'sem aprovação do cliente', String(modo));
    assertEquals(chamadas.length, 0, String(modo));
  }
});

Deno.test('2.42.2 dispensada não abre: ajuste, só compartilhado, sem agência, arquivado, trava, estado misto, outro cliente/projeto, sem estado interno', async () => {
  const casos: Array<[string, (t: Tabelas) => void]> = [
    ['pedido de ajuste do cliente', (t) => Object.assign(t.files[0], { approval_status: 'rejected', client_decided_at: '2026-11-20T10:00:00Z', locked_at: '2026-11-20T10:00:00Z' })],
    ['só compartilhado', (t) => Object.assign(t.files[0], { visibility: 'client_shared', approval_status: 'none', requires_approval: false })],
    ['sem aprovação interna', (t) => { t.files[0].agency_approval_status = 'pending'; }],
    ['agência recusou', (t) => { t.files[0].agency_approval_status = 'rejected'; }],
    ['arquivado', (t) => { t.files[0].archived_at = '2026-11-21T00:00:00Z'; }],
    ['travado sem decisão', (t) => { t.files[0].locked_at = '2026-11-21T00:00:00Z'; }],
    ['decidido por alguém', (t) => { t.files[0].client_decided_by = CLIENTE_A; }],
    ['sem requires_approval', (t) => { t.files[0].requires_approval = false; }],
    ['lâmina filha', (t) => { t.files[0].parent_file_id = 'raiz'; }],
    ['arquivo de outro cliente', (t) => { t.files[0].client_id = CLIENTE_B; }],
    ['arquivo de outro projeto', (t) => { t.files[0].project_id = '33333333-3333-4333-8333-3333333333ff'; }],
    ['interno com requires_approval', (t) => Object.assign(t.files[0], { visibility: 'internal', approval_status: 'none', requires_approval: true })],
    ['interno pendente', (t) => Object.assign(t.files[0], { visibility: 'internal', approval_status: 'pending', requires_approval: false })],
    ['interno decidido', (t) => Object.assign(t.files[0], { visibility: 'internal', approval_status: 'none', requires_approval: false, client_decided_at: '2026-11-21T00:00:00Z' })],
    ['sem estado interno do post', (t) => { t.editorial_post_internal.splice(0); }],
    ['post não pronto', (t) => { t.editorial_posts[0].production_status = 'in_production'; }],
  ];
  for (const [nome, mexer] of casos) {
    const t = tabelasPendentes('dispensada');
    mexer(t);
    const { deps, chamadas } = montar(t);
    await assertRejects(() => criarPublicacaoDeAprovado(pedido(), ctx, deps), Error, 'sem aprovação do cliente', nome);
    assertEquals(chamadas.length, 0, nome);
  }
});

Deno.test('2.42.2 dispensada: escopo do cliente, conta e recusa do banco seguem valendo', async () => {
  const fora = montar(tabelasPendentes('dispensada'));
  await assertRejects(() => criarPublicacaoDeAprovado(pedido(), ctxDeOutroCliente, fora.deps), Error, 'outside this MCP principal data scope');
  assertEquals(fora.chamadas.length, 0);
  const conta = montar(tabelasPendentes('dispensada'));
  await assertRejects(() => criarPublicacaoDeAprovado(pedido({ external_account_id: DE_OUTRO }), ctx, conta.deps), Error, 'Conta não encontrada');
  assertEquals(conta.chamadas.length, 0);
  // Revogada entre a leitura e a escrita: o banco recusa e a frase volta traduzida.
  const revogada = montar(tabelasPendentes('dispensada'), { rpcFalha: 'approved editorial media is unavailable, unsupported or outside the project' });
  await assertRejects(() => criarPublicacaoDeAprovado(pedido(), ctx, revogada.deps), Error, 'O arquivo aprovado não está disponível');
});

Deno.test('2.42.2 aprovacaoDispensada: só a regra exata e os dois estados coerentes', () => {
  const post = { client_id: CLIENTE_A, project_id: PROJETO };
  const f = {
    id: ARQUIVO, client_id: CLIENTE_A, project_id: PROJETO, parent_file_id: null, archived_at: null, status: 'ready',
    agency_approval_status: 'approved', locked_at: null, visibility: 'approval', approval_status: 'pending',
    requires_approval: true, client_decided_at: null, client_decided_by: null,
  };
  assert(aprovacaoDispensada(f, 'dispensada', post));
  assert(!aprovacaoDispensada(f, 'portal', post));
  assert(!aprovacaoDispensada(f, undefined, post));
  assert(!aprovacaoDispensada(null, 'dispensada', post));
  assert(!aprovacaoDispensada({ ...f, approval_status: 'approved' }, 'dispensada', post), 'aprovado segue pelo caminho normal');
  assert(!aprovadoPeloCliente(f), 'a dispensa não vira aprovação do cliente');
  const interno = { ...f, visibility: 'internal', approval_status: 'none', requires_approval: false };
  assert(aprovacaoDispensada(interno, 'dispensada', post));
  assert(!aprovacaoDispensada(interno, 'portal', post));
  assert(!aprovacaoDispensada({ ...interno, requires_approval: null }, 'dispensada', post));
  assert(!aprovacaoDispensada({ ...interno, agency_approval_status: 'not_requested' }, 'dispensada', post));
  assert(!aprovacaoDispensada({ ...interno, client_decided_by: CLIENTE_A }, 'dispensada', post));
  assert(!aprovacaoDispensada({ ...f, visibility: 'internal' }, 'dispensada', post), 'estado misto não vale');
  assert(!aprovadoPeloCliente(interno));
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
