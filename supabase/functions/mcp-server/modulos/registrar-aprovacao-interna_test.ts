// MCP 2.39.2 (25/11/2026): autoaprovação interna só do cliente interno, sem banco nem rede.
import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { MCP_VERSION } from '../../_shared/mcp-release.ts';
import {
  autoaprovacaoInternaLigada,
  MENSAGEM_DESLIGADA,
  notaDaAprovacao,
  registrarAprovacaoInterna,
  registrarAprovacaoInternaSchema,
  traduzirErroDaAprovacao,
  type DependenciasDaAprovacaoInterna,
} from './registrar-aprovacao-interna.ts';
import { FERRAMENTA_DE_APROVACAO_INTERNA } from './registrar-aprovacao-interna.ts';

const ACELERIQ = '4dd691a7-d481-451f-800b-5e6b6fdc8721';
const OUTRO = '00000000-0000-4000-8000-0000000000bb';
const POST = '11111111-1111-4111-8111-111111111111';
const ARQUIVO = '44444444-4444-4444-8444-444444444444';
const PESSOA = '00000000-0000-0000-0000-0000000000a1';
const AGORA = new Date('2026-11-25T22:30:00-03:00');

const ctx: AuthContext = {
  keyId: '00000000-0000-0000-0000-000000000001',
  keyName: 'test-key',
  scopes: ['editorial:write'],
  origin: 'test',
  correlationId: '00000000-0000-0000-0000-0000000000cc',
  dataScope: { unrestricted: false, clientIds: [ACELERIQ, OUTRO], principalUserId: PESSOA, source: 'oauth' },
};
const ctxSemAceleriq: AuthContext = { ...ctx, dataScope: { ...ctx.dataScope, clientIds: [OUTRO] } };

type Linha = Record<string, unknown>;
type Tabelas = Record<string, Linha[]>;

function tabelasBase(clientId = ACELERIQ): Tabelas {
  return {
    editorial_posts: [{
      id: POST, client_id: clientId, project_id: '33333333-3333-4333-8333-333333333333', primary_file_id: ARQUIVO,
      title: 'Post interno', production_status: 'ready', archived_at: null,
    }],
    editorial_post_internal: [{ post_id: POST, approval_fingerprint: 'f'.repeat(64) }],
    files: [{
      id: ARQUIVO, parent_file_id: null, archived_at: null, status: 'ready', agency_approval_status: 'pending',
      locked_at: null, visibility: 'internal', approval_status: 'pending', client_decided_at: null,
    }],
  };
}

function bancoFalso(tabelas: Tabelas, lidas: string[]) {
  return {
    from(tabela: string) {
      lidas.push(tabela);
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

function montar(tabelas: Tabelas = tabelasBase(), opcoes: { rpcErro?: Error; naoGrava?: boolean } = {}) {
  const chamadas: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const lidas: string[] = [];
  const chaves = new Set<string>();
  const deps: DependenciasDaAprovacaoInterna = {
    banco: bancoFalso(tabelas, lidas),
    agora: () => AGORA,
    rpc: (nome, args) => {
      chamadas.push({ nome, args: structuredClone(args) });
      if (opcoes.rpcErro) return Promise.reject(opcoes.rpcErro);
      if (!opcoes.naoGrava) {
        Object.assign(tabelas.files[0], {
          agency_approval_status: 'approved', approval_status: 'approved', visibility: 'approval',
          client_decided_at: '2026-11-26T01:30:00Z', locked_at: '2026-11-26T01:30:00Z',
        });
      }
      return Promise.resolve({ file_id: ARQUIVO, estado: 'aprovado', evento_id: '77777777-7777-4777-8777-777777777777', aprovado_por: 'Almir' });
    },
    umaVez: (async (ferramenta: string, _ctx: AuthContext, chave: string, fazer: () => Promise<{ ref: string | null; resultado: Record<string, unknown> }>, escopo?: Record<string, string>) => {
      const k = `${ferramenta}|${chave}|${JSON.stringify(escopo ?? {})}`;
      if (chaves.has(k)) return { ok: true, replay: true };
      const { resultado } = await fazer();
      chaves.add(k);
      return { ok: true, ...resultado };
    }) as never,
  };
  return { deps, chamadas, lidas, tabelas };
}

const pedido = (extra: Record<string, unknown> = {}) => ({
  post_id: POST,
  origem: 'chat do Almir com a Lume',
  aprovado_pelo_dono_em: '2026-11-25T22:19:00-03:00',
  confirmar: true as const,
  idempotency_key: 'autoaprov-0001',
  ...extra,
});

Deno.test('AcelerIQ pendente: aprovar_pelo_cliente UMA vez com o arquivo raiz e a nota de auditoria', async () => {
  const { deps, chamadas } = montar();
  const r = await registrarAprovacaoInterna(pedido(), ctx, deps) as Record<string, any>;
  assertEquals(chamadas.length, 1);
  assertEquals(chamadas[0].nome, 'aprovar_pelo_cliente');
  assertEquals(chamadas[0].args.p_file_id, ARQUIVO);
  const nota = String(chamadas[0].args.p_nota);
  assert(nota.startsWith('Autoaprovação interna'), nota);
  assert(nota.includes('chat do Almir com a Lume'));
  assert(nota.includes('2026-11-25T22:19:00-03:00'));
  assert(nota.includes(PESSOA), 'registrado por quem está conectado');
  assert(nota.includes(`MCP ${MCP_VERSION}`) && nota.includes(`post ${POST}`));
  assert(nota.length <= 500);
  assertEquals(r.ok, true);
  assertEquals(r.ja_aprovado, false);
  assertEquals(r.estado, 'aprovado');
  assertEquals(r.evento_id, '77777777-7777-4777-8777-777777777777');
  assertEquals(r.aprovado_por, 'Almir');
  assertEquals(r.file_id, ARQUIVO);
  assertEquals(r.client_id, ACELERIQ);
  assertEquals(r.client_decided_at, '2026-11-26T01:30:00Z');
  assertEquals(r.locked_at, '2026-11-26T01:30:00Z');
  assertEquals(r.auditoria.origem, 'chat do Almir com a Lume');
  assertEquals(r.auditoria.nota, nota);
  assert(r.proximo_passo.includes('aceleriq_criar_publicacao_de_aprovado') && r.proximo_passo.includes('não agenda nem publica'));
  // Repetir a mesma chave: já aprovado, sem RPC.
  const de_novo = await registrarAprovacaoInterna(pedido(), ctx, deps) as Record<string, any>;
  assertEquals(chamadas.length, 1);
  assertEquals(de_novo.ja_aprovado, true);
});

Deno.test('outro cliente: recusa com a mensagem de desligada, sem RPC e sem ler nada além do post', async () => {
  const { deps, chamadas, lidas } = montar(tabelasBase(OUTRO));
  await assertRejects(() => registrarAprovacaoInterna(pedido(), ctx, deps), Error, MENSAGEM_DESLIGADA);
  assertEquals(chamadas.length, 0);
  assertEquals(lidas, ['editorial_posts']);
  assert(!autoaprovacaoInternaLigada(OUTRO));
  assert(!autoaprovacaoInternaLigada(null));
  assert(autoaprovacaoInternaLigada(ACELERIQ));
});

Deno.test('fora do escopo de dados: DataScopeError antes da regra do cliente, sem RPC', async () => {
  const { deps, chamadas, lidas } = montar();
  await assertRejects(() => registrarAprovacaoInterna(pedido(), ctxSemAceleriq, deps), Error, 'outside this MCP principal data scope');
  assertEquals(chamadas.length, 0);
  assertEquals(lidas, ['editorial_posts']);
  const vazio = montar({ ...tabelasBase(), editorial_posts: [] });
  await assertRejects(() => registrarAprovacaoInterna(pedido(), ctx, vazio.deps), Error, 'Post não encontrado');
});

Deno.test('já aprovado pelo cliente: ja_aprovado sem RPC', async () => {
  const t = tabelasBase();
  Object.assign(t.files[0], {
    agency_approval_status: 'approved', approval_status: 'approved', client_decided_at: '2026-11-20T10:00:00Z', locked_at: '2026-11-20T10:00:00Z',
  });
  const { deps, chamadas } = montar(t);
  const r = await registrarAprovacaoInterna(pedido(), ctx, deps) as Record<string, any>;
  assertEquals(chamadas.length, 0);
  assertEquals(r.ja_aprovado, true);
  assertEquals(r.estado, 'ja_aprovado');
  assertEquals(r.client_decided_at, '2026-11-20T10:00:00Z');
});

Deno.test('post ou arquivo fora de condição: recusa sem RPC', async () => {
  const casos: Array<[string, (t: Tabelas) => void, string]> = [
    ['sem fingerprint', (t) => { t.editorial_post_internal[0].approval_fingerprint = null; }, 'selo da aprovação'],
    ['sem estado interno', (t) => { t.editorial_post_internal.splice(0); }, 'selo da aprovação'],
    ['post não pronto', (t) => { t.editorial_posts[0].production_status = 'in_production'; }, 'não está pronto'],
    ['post arquivado', (t) => { t.editorial_posts[0].archived_at = '2026-11-20T00:00:00Z'; }, 'Post arquivado'],
    ['sem arquivo principal', (t) => { t.editorial_posts[0].primary_file_id = null; }, 'não tem arquivo principal'],
    ['arquivo inexistente', (t) => { t.files.splice(0); }, 'não encontrado'],
    ['recusado pelo cliente', (t) => { t.files[0].approval_status = 'rejected'; }, 'recusado'],
    ['recusado pela agência', (t) => { t.files[0].agency_approval_status = 'rejected'; }, 'recusado'],
    ['arquivo arquivado', (t) => { t.files[0].archived_at = '2026-11-20T00:00:00Z'; }, 'arquivado'],
    ['lâmina filha', (t) => { t.files[0].parent_file_id = '55555555-5555-4555-8555-555555555555'; }, 'não a raiz'],
    ['arquivo processando', (t) => { t.files[0].status = 'processing'; }, 'não está pronto'],
  ];
  for (const [nome, mexer, frase] of casos) {
    const t = tabelasBase();
    mexer(t);
    const { deps, chamadas } = montar(t);
    await assertRejects(() => registrarAprovacaoInterna(pedido(), ctx, deps), Error, frase, nome);
    assertEquals(chamadas.length, 0, nome);
  }
});

Deno.test('aprovado_pelo_dono_em no futuro ou sem fuso: inválido, sem RPC', async () => {
  const { deps, chamadas } = montar();
  await assertRejects(
    () => registrarAprovacaoInterna(pedido({ aprovado_pelo_dono_em: '2026-11-25T23:00:00-03:00' }), ctx, deps),
    Error,
    'no futuro',
  );
  assertEquals(chamadas.length, 0);
  // Dentro da folga de 5 min passa.
  const folga = montar();
  await registrarAprovacaoInterna(pedido({ aprovado_pelo_dono_em: '2026-11-25T22:34:00-03:00' }), ctx, folga.deps);
  assertEquals(folga.chamadas.length, 1);
  // Sem fuso e texto solto: o schema recusa.
  assert(!registrarAprovacaoInternaSchema.safeParse(pedido({ aprovado_pelo_dono_em: '2026-11-25T22:19:00' })).success);
  assert(!registrarAprovacaoInternaSchema.safeParse(pedido({ aprovado_pelo_dono_em: 'ontem à noite' })).success);
  assert(registrarAprovacaoInternaSchema.safeParse(pedido()).success);
  assert(registrarAprovacaoInternaSchema.safeParse(pedido({ aprovado_pelo_dono_em: '2026-11-26T01:19:00Z' })).success);
  // Schema fechado e confirmação obrigatória.
  assert(!registrarAprovacaoInternaSchema.safeParse(pedido({ client_id: ACELERIQ })).success, 'sem campo extra');
  assert(!registrarAprovacaoInternaSchema.safeParse(pedido({ confirmar: false })).success);
  assert(!registrarAprovacaoInternaSchema.safeParse(pedido({ origem: 'chat' })).success, 'origem curta');
  assert(!registrarAprovacaoInternaSchema.safeParse(pedido({ idempotency_key: 'curta' })).success);
  // O handler da tool também recusa o futuro pelo caminho do schema + regra.
  const tool = FERRAMENTA_DE_APROVACAO_INTERNA[0];
  await assertRejects(() => tool.handler(pedido({ aprovado_pelo_dono_em: '2026-11-25T22:19:00' }), ctx), Error, 'Invalid input');
});

Deno.test('RPC recusa: traduzida; infraestrutura sobe intacta; não registrou: erro', async () => {
  const sem = montar(tabelasBase(), { rpcErro: new Error('mesa:rpc_recusada aprovar_pelo_cliente: só admin ou gestor') });
  const e1 = await assertRejects(() => registrarAprovacaoInterna(pedido(), ctx, sem.deps), Error);
  assert(e1.message.startsWith('mesa:rpc_recusada '), e1.message);
  assert(e1.message.includes('admin ou gestor'));
  const sessao = 'mesa:dono_da_chave Não foi possível abrir a sessão do dono da chave agora. Tente de novo.';
  const infra = montar(tabelasBase(), { rpcErro: new Error(sessao) });
  const e2 = await assertRejects(() => registrarAprovacaoInterna(pedido(), ctx, infra.deps), Error);
  assertEquals(e2.message, sessao);
  const nao = montar(tabelasBase(), { naoGrava: true });
  await assertRejects(() => registrarAprovacaoInterna(pedido(), ctx, nao.deps), Error, 'a aprovação não ficou registrada');
  assertEquals(nao.chamadas.length, 1);
  assert(traduzirErroDaAprovacao('qualquer coisa').startsWith('O painel recusou'));
});

Deno.test('nota: cabe em 500 com origem longa e mantém data, versão e post', () => {
  const nota = notaDaAprovacao({ aprovadoEm: '2026-11-25T22:19:00-03:00', origem: 'x'.repeat(300), registradoPor: PESSOA, postId: POST });
  assert(nota.length <= 500, String(nota.length));
  assert(nota.includes('2026-11-25T22:19:00-03:00') && nota.includes(`post ${POST}`) && nota.includes(MCP_VERSION));
});
