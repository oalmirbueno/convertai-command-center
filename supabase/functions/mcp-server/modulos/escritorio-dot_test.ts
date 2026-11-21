import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { escritorioDotCaixa, escritorioDotEntrar, type PortaDoEscritorioDot } from './escritorio-dot.ts';
import { ErroDaFerramenta } from './robustez.ts';

const ctx: AuthContext = {
  keyId: 'oauth:teste',
  keyName: 'oauth:conector-teste',
  scopes: [],
  origin: 'oauth:conector-teste:teste',
  dataScope: { source: 'oauth', unrestricted: false, clientIds: [], principalUserId: 'teste' },
  officeOperator: 'dot',
};

const dot = { slug: 'dot', status: 'active', origem: 'chatgpt', grau: 'executor', is_coordinator: false };
const quando = '2026-11-21T02:00:00.000Z';

function bancoDeTeste(registro: typeof dot | null = dot, corpo = 'Mensagem interna de teste.') {
  const chamadas: unknown[][] = [];
  const porta = {
    from(tabela: string) {
      chamadas.push(['from', tabela]);
      const registrar = (metodo: string) => (...parametros: unknown[]) => {
        chamadas.push([metodo, ...parametros]);
        return consulta;
      };
      const consulta = {
        select: registrar('select'),
        eq: registrar('eq'),
        neq: registrar('neq'),
        is: registrar('is'),
        gte: registrar('gte'),
        order: registrar('order'),
        maybeSingle() {
          return Promise.resolve({ data: registro, error: null });
        },
        limit(limite: number) {
          chamadas.push(['limit', limite]);
          return Promise.resolve({
            data: [{
              de_slug: 'jori', corpo, created_at: quando,
              para_slug: 'dot', conversa: { id: 'conversa-interna' }, leituras: [],
            }],
            error: null,
          });
        },
      };
      return consulta;
    },
  } as unknown as PortaDoEscritorioDot;
  return { chamadas, porta };
}

Deno.test('a entrada da Dot devolve apenas a identidade e verifica o registro', async () => {
  const { porta, chamadas } = bancoDeTeste();
  assertEquals(await escritorioDotEntrar({ operator: 'dot' }, ctx, porta), {
    voce: { slug: 'dot', nome: 'Dot', plataforma: 'chatgpt', grau: 'executor', status: 'active' },
  });
  assertEquals(chamadas, [
    ['from', 'internal_operators'],
    ['select', 'slug, status, origem, grau, is_coordinator'],
    ['eq', 'slug', 'dot'],
  ]);

  for (const registro of [
    null,
    { ...dot, status: 'retired' },
    { ...dot, origem: 'grok' },
    { ...dot, grau: 'orquestrador' },
    { ...dot, is_coordinator: true },
  ]) {
    const mundo = bancoDeTeste(registro);
    const falha = await assertRejects(() => escritorioDotCaixa({}, ctx, mundo.porta), ErroDaFerramenta);
    assertEquals(falha.codigo, 'agente_parado');
    assertEquals(mundo.chamadas.filter(([op]) => op === 'from'), [['from', 'internal_operators']]);
  }
});

Deno.test('a Dot não aceita chave técnica, credencial sem vínculo ou outra identidade', async () => {
  const { porta, chamadas } = bancoDeTeste();
  for (const semVinculo of [
    { ...ctx, officeOperator: undefined },
    { ...ctx, dataScope: { ...ctx.dataScope, source: 'api_key' as const } },
    { ...ctx, dataScope: { ...ctx.dataScope, unrestricted: true } },
    { ...ctx, dataScope: { ...ctx.dataScope, clientIds: ['cliente-teste'] } },
  ]) {
    const falha = await assertRejects(() => escritorioDotEntrar({}, semVinculo, porta), ErroDaFerramenta);
    assertEquals(falha.codigo, 'nao_e_voce');
  }
  for (const entrada of [
    { operator: 'jori' },
    { conversa_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    { grupo: 'coordenacao' },
    { limite: 101 },
    { desde: 'ontem' },
    { desde: '2026-11-21T02:00:00+99:99' },
  ]) {
    const falha = await assertRejects(() => escritorioDotCaixa(entrada, ctx, porta), ErroDaFerramenta);
    assertEquals(falha.codigo, 'entrada_invalida');
  }
  assertEquals(chamadas, []);
});

Deno.test('a caixa limita no banco as mensagens diretas e sem vínculos de cliente, tarefa ou sala', async () => {
  const { chamadas, porta } = bancoDeTeste();
  const resultado = await escritorioDotCaixa({ limite: 7, desde: '2000-01-01T00:00:00.000Z' }, ctx, porta);
  assertEquals(chamadas.slice(3, -4), [
    ['from', 'escritorio_mensagens'],
    ['select', 'de_slug, corpo, created_at, conversa:escritorio_conversas!inner(id), leituras:escritorio_leituras(mensagem_id)'],
    ['eq', 'para_slug', 'dot'],
    ['neq', 'de_slug', 'dot'],
    ['is', 'grupo_id', null],
    ['is', 'client_id', null],
    ['is', 'task_id', null],
    ['eq', 'conversa.tipo', 'direta'],
    ['is', 'conversa.grupo_id', null],
    ['is', 'conversa.client_id', null],
    ['is', 'conversa.task_id', null],
    ['eq', 'leituras.leitor_slug', 'dot'],
    ['gte', 'created_at', chamadas.at(-5)?.[2]],
  ]);
  assertEquals(chamadas.slice(-4), [
    ['is', 'leituras', null],
    ['order', 'created_at', { ascending: false }],
    ['order', 'id', { ascending: false }],
    ['limit', 7],
  ]);
  const dataMinima = Date.parse(String(chamadas.at(-5)?.[2]));
  assert(Math.abs(Date.now() - 30 * 24 * 60 * 60 * 1000 - dataMinima) < 5_000);
  assertEquals(resultado, {
    de_quem_e_a_caixa: 'dot',
    mensagens: [{ de: 'jori', texto: 'Mensagem interna de teste.', quando, lida: false }],
  });

  const segredoFicticio = 'abc123def456';
  const caixaCompleta = bancoDeTeste(dot, 'Segredo: ' + segredoFicticio);
  const depois = new Date().toISOString();
  const caixa = await escritorioDotCaixa({ so_nao_lidas: false, desde: depois }, ctx, caixaCompleta.porta);
  assert(!caixa.mensagens[0].texto.includes(segredoFicticio));
  assert(caixaCompleta.chamadas.some(([op, coluna, valor]) => op === 'gte' && coluna === 'created_at' && valor === depois));
  assert(!caixaCompleta.chamadas.some(([op, coluna]) => op === 'is' && coluna === 'leituras'));
  assertEquals(caixaCompleta.chamadas.at(-1), ['limit', 30]);
});
