// MCP 2.31.0 (18/11/2026): e-mail profissional pelo agente, sem banco nem rede.
import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import {
  conferir,
  entradas,
  marcarPago,
  marcarPagoSchema,
  migracao,
  migracaoSchema,
  pareceSegredo,
  proximoPassoDaMigracao,
  registrar,
  registrarSchema,
  type DependenciasDoEmail,
} from './email-profissional.ts';

const DONO = '00000000-0000-4000-8000-00000000d0d0';
const PEDIDO = '11111111-1111-4111-8111-111111111111';
const DOMINIO = '22222222-2222-4222-8222-222222222222';
const CONTA = '33333333-3333-4333-8333-333333333333';

const casa: AuthContext = {
  keyId: '00000000-0000-0000-0000-000000000001',
  keyName: 'test-key',
  scopes: ['clients:read', 'clients:write'],
  origin: 'test',
  correlationId: '00000000-0000-0000-0000-0000000000cc',
  dataScope: { unrestricted: true, clientIds: [], principalUserId: DONO, source: 'oauth' },
};
const deCliente: AuthContext = { ...casa, dataScope: { ...casa.dataScope, unrestricted: false, clientIds: ['00000000-0000-4000-8000-0000000000aa'] } };

type Chamada = { nome: string; args: Record<string, unknown> };

function deps(respostas: Record<string, unknown> = {}, extra: Partial<DependenciasDoEmail> = {}) {
  const chamadas: Chamada[] = [];
  const usadas = new Set<string>();
  const d: DependenciasDoEmail = {
    rpc: (nome, args) => {
      chamadas.push({ nome, args });
      const r = respostas[nome];
      if (r instanceof Error) return Promise.resolve({ data: null, error: { message: r.message, code: 'P0001' } });
      return Promise.resolve({ data: r ?? null, error: null });
    },
    banco: {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: respostas.__dominio ?? null, error: null }) }) }),
      }),
    },
    umaVez: (async (_f: string, _c: AuthContext, chave: string, fazer: () => Promise<{ ref: string | null; resultado: Record<string, unknown> }>) => {
      if (usadas.has(chave)) return { ok: true, replay: true };
      usadas.add(chave);
      const { resultado } = await fazer();
      return { ok: true, ...resultado };
    }) as unknown as DependenciasDoEmail['umaVez'],
    busca: () => Promise.reject(new Error('sem rede no teste')),
    ambiente: () => '',
    ...extra,
  };
  return { d, chamadas };
}

Deno.test('e-mail: só a casa usa (credencial presa a cliente é recusada antes do banco)', async () => {
  const { d, chamadas } = deps();
  await assertRejects(() => entradas({ estado: 'abertos', limite: 10 }, deCliente, d), Error, 'administração da casa');
  await assertRejects(() => marcarPago({ pedido_id: PEDIDO, forma: 'pix', confirmar: true, idempotency_key: 'pago-0001' }, deCliente, d));
  assertEquals(chamadas.length, 0);
});

Deno.test('e-mail: entradas lê os abertos por padrão; todos vira nulo para o banco', async () => {
  const { d, chamadas } = deps({ produto_email_pedidos_da_casa: [{ id: PEDIDO, estado: 'novo' }] });
  const r = await entradas({ estado: 'abertos', limite: 50 }, casa, d);
  assertEquals(r.total, 1);
  assertEquals(chamadas[0].args, { _estado: 'abertos', _limite: 50 });
  await entradas({ estado: 'todos', limite: 5 }, casa, d);
  assertEquals(chamadas[1].args._estado, null);
});

Deno.test('e-mail: limite acima do teto acomoda em 200, não recusa', async () => {
  const { entradasSchema } = await import('./email-profissional.ts');
  assertEquals(entradasSchema.parse({ limite: 5000 }).limite, 200);
  assertEquals(entradasSchema.parse({}).limite, 50);
  assert(!entradasSchema.safeParse({ limite: 'muitos' }).success);
});

Deno.test('e-mail: migração pede um dos dois ids e devolve o próximo passo', async () => {
  assert(!migracaoSchema.safeParse({}).success);
  assert(!migracaoSchema.safeParse({ pedido_id: PEDIDO, dominio_id: DOMINIO }).success);
  const { d } = deps({
    produto_email_migracao: {
      pedido: { estado: 'em_andamento', pago_em: '2026-11-18T12:00:00Z' },
      dominio: { id: DOMINIO },
      etapas: [{ ordem: 1, titulo: 'Levantar', chave: 'levantamento', feito_em: 'x' }, { ordem: 2, titulo: 'Contas do cliente criadas', chave: 'contas', feito_em: null }],
    },
  });
  const r = await migracao({ dominio_id: DOMINIO }, casa, d);
  assert(String(r.proximo_passo).includes('2. Contas do cliente criadas') && String(r.proximo_passo).includes('contas'));
});

Deno.test('e-mail: próximo passo espera o pagamento e não manda marcar pago sozinho', () => {
  const t = proximoPassoDaMigracao({ pedido: { estado: 'novo', pago_em: null }, dominio: null, etapas: [] });
  assert(t.includes('quando o dono confirmar'));
  assert(proximoPassoDaMigracao({ pedido: { estado: 'em_andamento', pago_em: 'x' }, dominio: { id: DOMINIO }, etapas: [{ ordem: 1, titulo: 'a', chave: 'a', feito_em: 'x' }] }).includes('conclua'));
});

Deno.test('e-mail: registrar pedido vai como agente, com o autor, e repetir a chave não refaz', async () => {
  const { d, chamadas } = deps({ produto_email_registrar_pedido: { pedido: { id: PEDIDO }, novo: true } });
  const input = registrarSchema.parse({ o_que: 'pedido', conta_id: CONTA, dominio: 'Prix.com.br', caixas: 7, confirmar: true, idempotency_key: 'pedido-0001' });
  const r = await registrar(input, casa, d);
  assertEquals((r as { novo?: boolean }).novo, true);
  assertEquals(chamadas[0].nome, 'produto_email_registrar_pedido');
  assertEquals(chamadas[0].args._origem, 'agente');
  assertEquals(chamadas[0].args._ator, DONO);
  assertEquals(chamadas[0].args._dominio, 'prix.com.br');
  const de_novo = await registrar(input, casa, d);
  assertEquals((de_novo as { replay?: boolean }).replay, true);
  assertEquals(chamadas.length, 1);
});

Deno.test('e-mail: cada o_que chama a função certa', async () => {
  const { d, chamadas } = deps({
    produto_email_dominio_atualizar: {}, produto_email_caixa_salvar: { caixa_id: 'c1' }, produto_email_etapa_marcar: {}, produto_email_pedido_mudar: { pedido: { id: PEDIDO } },
  });
  await registrar(registrarSchema.parse({ o_que: 'dominio', dominio_id: DOMINIO, dados: { zoho_plano: 'gratuito', cloudflare_zona_id: '0123456789ABCDEF0123456789abcdef' }, confirmar: true, idempotency_key: 'dominio-001' }), casa, d);
  await registrar(registrarSchema.parse({ o_que: 'caixa', dominio_id: DOMINIO, endereco: 'Joao', estado: 'ativa', confirmar: true, idempotency_key: 'caixa-0001' }), casa, d);
  await registrar(registrarSchema.parse({ o_que: 'etapa', dominio_id: DOMINIO, etapa: 'dns_copiado', confirmar: true, idempotency_key: 'etapa-0001' }), casa, d);
  await registrar(registrarSchema.parse({ o_que: 'andamento', pedido_id: PEDIDO, estado: 'concluido', confirmar: true, idempotency_key: 'andam-0001' }), casa, d);
  assertEquals(chamadas.map((c) => c.nome), ['produto_email_dominio_atualizar', 'produto_email_caixa_salvar', 'produto_email_etapa_marcar', 'produto_email_pedido_mudar']);
  assertEquals((chamadas[0].args._dados as Record<string, string>).cloudflare_zona_id, '0123456789abcdef0123456789abcdef');
  assertEquals(chamadas[1].args._endereco, 'joao');
  assertEquals(chamadas[2].args._feito, true);
});

Deno.test('e-mail: segredo não entra (schema fechado e texto com cara de senha)', async () => {
  assert(!registrarSchema.safeParse({ o_que: 'dominio', dominio_id: DOMINIO, dados: { senha: 'x' }, confirmar: true, idempotency_key: 'dominio-002' }).success);
  assert(!registrarSchema.safeParse({ o_que: 'dominio', dominio_id: DOMINIO, dados: {}, confirmar: true, idempotency_key: 'dominio-003' }).success);
  assert(!registrarSchema.safeParse({ o_que: 'pedido', conta_id: CONTA, confirmar: false, idempotency_key: 'pedido-0002' }).success);
  assert(pareceSegredo('senha: Abc@1234'));
  assert(pareceSegredo('token 1000.0123456789abcdef0123.0123456789abcdef0123'));
  assert(!pareceSegredo('A senha padrão foi digitada pelo dono no Chrome.'));
  const { d, chamadas } = deps();
  await assertRejects(
    () => registrar(registrarSchema.parse({ o_que: 'etapa', dominio_id: DOMINIO, etapa: '7', nota: 'senha: Prix2026!', confirmar: true, idempotency_key: 'etapa-0002' }), casa, d),
    Error,
    'cofre',
  );
  assertEquals(chamadas.length, 0);
});

Deno.test('e-mail: marcar pago exige confirmar e forma conhecida, manda o autor e devolve o livro', async () => {
  assert(!marcarPagoSchema.safeParse({ pedido_id: PEDIDO, forma: 'pix', idempotency_key: 'pago-0001' }).success);
  assert(!marcarPagoSchema.safeParse({ pedido_id: PEDIDO, forma: 'bitcoin', confirmar: true, idempotency_key: 'pago-0001' }).success);
  assert(!marcarPagoSchema.safeParse({ pedido_id: PEDIDO, forma: 'pix', pago_em: '18/11/2026', confirmar: true, idempotency_key: 'pago-0001' }).success);
  const { d, chamadas } = deps({ produto_email_marcar_pago: { pedido: { id: PEDIDO, dominio_id: DOMINIO }, ja_estava_pago: false, livro: 'extra' } });
  const r = await marcarPago({ pedido_id: PEDIDO, forma: 'ja_lancado', confirmar: true, idempotency_key: 'pago-0002' }, casa, d) as Record<string, unknown>;
  assertEquals(r.livro, 'extra');
  assert(String(r.proximo_passo).includes(DOMINIO));
  assertEquals(chamadas[0].args, { _pedido: PEDIDO, _forma: 'ja_lancado', _valor: null, _pago_em: null, _ator: DONO });
});

Deno.test('e-mail: recusa da regra do banco volta com a frase dele', async () => {
  const { d } = deps({ produto_email_marcar_pago: new Error('O pedido está cancelado. Reabra antes de marcar o pagamento.') });
  await assertRejects(() => marcarPago({ pedido_id: PEDIDO, forma: 'pix', confirmar: true, idempotency_key: 'pago-0003' }, casa, d), Error, 'cancelado');
});

Deno.test('e-mail: conferir sem segredo responde indisponível, sem rede e sem repetir', async () => {
  const dominio = { id: DOMINIO, dominio: 'prix.com.br', provedor: 'zoho', dkim_seletor: 'zmail', cloudflare_zona_id: null, zoho_org_id: null, zoho_dc: 'com', zoho_plano: 'gratuito' };
  const { d } = deps({ __dominio: dominio });
  const cf = await conferir({ dominio_id: DOMINIO, onde: 'cloudflare' }, casa, d) as Record<string, unknown>;
  assertEquals(cf.indisponivel, true);
  const zo = await conferir({ dominio_id: DOMINIO, onde: 'zoho' }, casa, d) as Record<string, unknown>;
  assertEquals(zo.indisponivel, true);
});

Deno.test('e-mail: conferir na Cloudflare lê a zona, guarda o resumo e o id da zona', async () => {
  const dominio = { id: DOMINIO, dominio: 'prix.com.br', provedor: 'zoho', dkim_seletor: null, cloudflare_zona_id: null, zoho_org_id: null, zoho_dc: 'com', zoho_plano: 'gratuito' };
  const zona = { id: 'abcdefabcdefabcdefabcdefabcdefab', name: 'prix.com.br', status: 'active', name_servers: ['a.ns.cloudflare.com'] };
  const registros = [
    { type: 'MX', name: 'prix.com.br', content: 'mx.zoho.com', priority: 10 },
    { type: 'MX', name: 'prix.com.br', content: 'mx2.zoho.com', priority: 20 },
    { type: 'MX', name: 'prix.com.br', content: 'mx3.zoho.com', priority: 50 },
    { type: 'TXT', name: 'prix.com.br', content: '"v=spf1 include:zoho.com ~all"' },
    { type: 'TXT', name: 'zmail._domainkey.prix.com.br', content: `v=DKIM1; k=rsa; p=${'A'.repeat(60)}` },
    { type: 'TXT', name: '_dmarc.prix.com.br', content: 'v=DMARC1; p=none' },
  ];
  const urls: string[] = [];
  const busca = (url: string) => {
    urls.push(url);
    const result = url.includes('/dns_records') ? registros : [zona];
    return Promise.resolve(new Response(JSON.stringify({ success: true, result }), { status: 200 }));
  };
  const { d, chamadas } = deps({ __dominio: dominio }, { busca, ambiente: (n) => (n === 'CLOUDFLARE_API_TOKEN' ? 'cf-token' : '') });
  const r = await conferir({ dominio_id: DOMINIO, onde: 'cloudflare' }, casa, d) as { ok: boolean; resultado: { ok: boolean } };
  assert(r.ok && r.resultado.ok, 'zona certa passa');
  assert(urls[0].includes('/zones?name=prix.com.br'));
  assertEquals(chamadas.map((c) => c.nome), ['produto_email_gravar_conferencia', 'produto_email_dominio_atualizar']);
  assertEquals((chamadas[1].args._dados as Record<string, string>).cloudflare_zona_id, zona.id);
});
