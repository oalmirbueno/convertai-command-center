// MCP 2.38.0 (20/11/2026): envio de arquivo ou carrossel de Arquivos para aprovação, sem banco nem rede.
import { assert, assertEquals, assertRejects, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { DataScopeError } from '../../_shared/mcp-auth.ts';
import { RPCS_DA_PONTE } from '../../_shared/mcp-mesas-ponte.ts';
import {
  caminhoPorPapel,
  type DependenciasDoEnvio,
  enviarArquivoParaAprovacao,
  enviarArquivoSchema,
} from './arquivos-enviar-para-aprovacao.ts';
import { bancoFalso, type Linha, type Tabelas, trilhaDeAuditoria, umaVezFalso } from './banco-falso-de-arquivos_test_util.ts';

const CLIENTE_A = '00000000-0000-4000-8000-0000000000aa';
const CLIENTE_B = '00000000-0000-4000-8000-0000000000bb';
const PROJETO = '33333333-3333-4333-8333-333333333333';
const PESSOA = '00000000-0000-0000-0000-000000000001';
const id = (n: number) => `44444444-4444-4444-8444-4444444444${String(n).padStart(2, '0')}`;

const ctx: AuthContext = {
  keyId: PESSOA,
  keyName: 'test-key',
  scopes: ['files:write'],
  origin: 'test',
  correlationId: '00000000-0000-0000-0000-0000000000cc',
  dataScope: { unrestricted: false, clientIds: [CLIENTE_A], principalUserId: PESSOA, source: 'oauth' },
};

function arquivo(n: number, extra: Linha = {}): Linha {
  return {
    id: id(n), client_id: CLIENTE_A, project_id: PROJETO, parent_file_id: n === 1 ? null : id(1), revision_of_file_id: null,
    file_name: n === 1 ? 'Stop' : `Stop (${n}/5)`, file_type: 'carrossel', folder: 'materiais', caption: null,
    mime_type: 'image/png', extension: 'png', storage_bucket: 'files', storage_path: `${CLIENTE_A}/${id(n)}/v1/card.png`,
    file_url: `mcp-files://${CLIENTE_A}/${id(n)}/v1/card.png`, status: 'ready', archived_at: null,
    visibility: 'internal', agency_approval_status: 'not_requested', approval_status: 'none', locked_at: null,
    created_at: `2026-11-19T10:0${n}:00Z`,
    ...extra,
  };
}

function tabelas(papel = 'admin', arquivos?: Linha[]): Tabelas {
  return {
    files: arquivos ?? [1, 2, 3, 4, 5].map((n) => arquivo(n)),
    user_roles: [{ user_id: PESSOA, role: papel }],
  };
}

function montar(t: Tabelas, rpcErro?: Error) {
  const rpcs: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const deps: DependenciasDoEnvio = {
    banco: bancoFalso(t) as never,
    rpc: (nome, args) => {
      rpcs.push({ nome, args });
      if (rpcErro) return Promise.reject(rpcErro);
      // Como o banco: a raiz e os filhos andam juntos.
      for (const f of t.files) {
        if (f.id !== args.p_file_id && f.parent_file_id !== args.p_file_id) continue;
        if (nome === 'admin_release_file_now') Object.assign(f, { agency_approval_status: 'approved', visibility: 'approval', approval_status: f.parent_file_id ? 'none' : 'pending' });
        else Object.assign(f, { agency_approval_status: 'pending' });
      }
      return Promise.resolve(null);
    },
    umaVez: umaVezFalso(),
  };
  return { deps, rpcs };
}

const conf = (k: string) => ({ file_id: id(1), confirmar: true, idempotency_key: k });

Deno.test('regra por papel igual a mesa_enviar_para_aprovacao; RPCs na ponte; schema', () => {
  assertEquals(caminhoPorPapel(['admin']), 'liberar_ao_cliente');
  assertEquals(caminhoPorPapel(['manager', 'design']), 'liberar_ao_cliente');
  assertEquals(caminhoPorPapel(['design']), 'pedir_revisao_da_agencia');
  assertEquals(caminhoPorPapel(['traffic']), 'pedir_revisao_da_agencia');
  assertEquals(caminhoPorPapel(['client']), null);
  for (const r of ['admin_release_file_now', 'request_file_agency_review']) assert((RPCS_DA_PONTE as readonly string[]).includes(r));
  assert(enviarArquivoSchema.safeParse({ file_id: id(1) }).success);
  assert(!enviarArquivoSchema.safeParse({ file_id: id(1), confirmar: true }).success, 'confirmar exige chave');
  assert(!enviarArquivoSchema.safeParse({ file_id: id(1), motivo: 'x' }).success);
});

Deno.test('simulação não chama RPC e mostra Carrossel · 5 com a ordem do painel', async () => {
  const { deps, rpcs } = montar(tabelas());
  const r = await enviarArquivoParaAprovacao({ file_id: id(1) }, ctx, deps);
  assertEquals(r.simulacao, true);
  assertEquals(r.pode_enviar, true);
  assertEquals(r.rotulo, 'Carrossel · 5');
  assertEquals(r.estado_depois, 'aguardando_cliente');
  assertEquals((r.ordem_dos_cards as Array<{ file_id: string }>).map((c) => c.file_id), [1, 2, 3, 4, 5].map(id));
  assertEquals(rpcs.length, 0);
});

Deno.test('admin: libera pela raiz ao cliente (aguardando_cliente), uma aprovação só; replay não reenvia', async () => {
  const t = tabelas('admin');
  const { deps, rpcs } = montar(t);
  const r = await enviarArquivoParaAprovacao(conf('enviar-0001'), ctx, deps);
  assertEquals(rpcs, [{ nome: 'admin_release_file_now', args: { p_file_id: id(1), p_mode: 'approval' } }]);
  assertEquals(r.estado, 'aguardando_cliente');
  assertEquals(r.cards, 5);
  assertEquals(r.rotulo, 'Carrossel · 5');
  assertEquals(t.files.filter((f) => f.approval_status === 'pending').length, 1, 'só a raiz espera o cliente');
  const de_novo = await enviarArquivoParaAprovacao(conf('enviar-0001'), ctx, deps);
  assertEquals(de_novo.replay, true);
  assertEquals(rpcs.length, 1);
});

Deno.test('design: pede a revisão da agência (aguardando_agencia)', async () => {
  const { deps, rpcs } = montar(tabelas('design'));
  const r = await enviarArquivoParaAprovacao(conf('enviar-0002'), ctx, deps);
  assertEquals(rpcs, [{ nome: 'request_file_agency_review', args: { p_file_id: id(1) } }]);
  assertEquals(r.estado, 'aguardando_agencia');
});

Deno.test('arquivo único: Arquivo único, cards 1', async () => {
  const { deps } = montar(tabelas('admin', [arquivo(1, { file_name: 'peca.png' })]));
  const r = await enviarArquivoParaAprovacao(conf('enviar-0003'), ctx, deps);
  assertEquals(r.cards, 1);
  assertEquals(r.rotulo, 'Arquivo único');
});

Deno.test('recusas: card aponta a raiz, já em aprovação traz o estado, filho fora do estado, vídeo no carrossel, cliente sem papel', async () => {
  const { deps } = montar(tabelas());
  await assertRejects(() => enviarArquivoParaAprovacao({ file_id: id(3) }, ctx, deps), Error, id(1));
  const jaEnviado = tabelas('admin', [arquivo(1, { visibility: 'approval', approval_status: 'pending', agency_approval_status: 'approved' })]);
  await assertRejects(() => enviarArquivoParaAprovacao(conf('enviar-0004'), ctx, montar(jaEnviado).deps), Error, 'aguardando o cliente');
  const filhoFora = tabelas('admin', [arquivo(1), arquivo(2, { agency_approval_status: 'pending' })]);
  await assertRejects(() => enviarArquivoParaAprovacao(conf('enviar-0005'), ctx, montar(filhoFora).deps), Error, 'mesmo estado');
  const comVideo = tabelas('admin', [arquivo(1), arquivo(2, { mime_type: 'video/mp4' })]);
  await assertRejects(() => enviarArquivoParaAprovacao(conf('enviar-0006'), ctx, montar(comVideo).deps), Error, 'não é imagem');
  const cliente = montar(tabelas('client'));
  await assertRejects(() => enviarArquivoParaAprovacao(conf('enviar-0007'), ctx, cliente.deps), Error, 'não é da equipe');
  assertEquals(cliente.rpcs.length, 0);
});

Deno.test('outro cliente: DataScopeError antes de ler os cards ou chamar RPC', async () => {
  const { deps, rpcs } = montar(tabelas());
  const fora: AuthContext = { ...ctx, dataScope: { ...ctx.dataScope, clientIds: [CLIENTE_B] } };
  await assertRejects(() => enviarArquivoParaAprovacao(conf('enviar-0008'), fora, deps), DataScopeError);
  assertEquals(rpcs.length, 0);
});

Deno.test('falha da sessão sobe intacta (exige_oauth)', async () => {
  const { deps } = montar(tabelas(), new Error('mesa:exige_oauth Agir nas mesas pelo MCP exige a sessão de uma pessoa'));
  const e = await assertRejects(() => enviarArquivoParaAprovacao(conf('enviar-0009'), ctx, deps), Error);
  assertStringIncludes(e.message, 'mesa:exige_oauth');
});

Deno.test('P1-A: simulação com a chave não vira replay; confirmar=true com a mesma chave envia; repetir é replay', async () => {
  const t = tabelas('admin');
  const { deps, rpcs } = montar(t);
  const trilha = trilhaDeAuditoria();
  deps.umaVez = trilha.umaVez;
  const handler = (a: unknown, c: AuthContext) => enviarArquivoParaAprovacao(enviarArquivoSchema.parse(a), c, deps);
  const chamar = (args: Record<string, unknown>) => trilha.chamar('aceleriq_arquivos_enviar_para_aprovacao', handler, args, ctx);
  const sim = await chamar({ file_id: id(1), confirmar: false, idempotency_key: 'enviar-p1a-01' });
  assertEquals(sim.simulacao, true);
  await chamar({ file_id: id(1), idempotency_key: 'enviar-p1a-01' });
  assertEquals(trilha.linhas.filter((l) => l.success).length, 2, 'as simulações ficam na trilha com a chave, como no real');
  assertEquals(rpcs.length, 0);
  const r = await chamar(conf('enviar-p1a-01'));
  assertEquals(r.replay, undefined, 'não é replay da simulação');
  assertEquals(r.estado, 'aguardando_cliente');
  assertEquals(rpcs.length, 1);
  const de_novo = await chamar(conf('enviar-p1a-01'));
  assertEquals(de_novo.replay, true);
  assertEquals(rpcs.length, 1, 'não reenvia');
});
