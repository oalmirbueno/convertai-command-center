// MCP 2.29.0 (17/11/2026): listar e arquivar Referências e Concorrentes, sem banco.
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  contagemDoPapel,
  decidirArquivamento,
  ERRO_PERFIL_NAO_ENCONTRADO,
  montarListaPorAba,
  normalizarPedidoDeArquivar,
  papelDoPedido,
  perfilParaLista,
  type LinhaDePerfil,
} from './perfis-listar-arquivar.ts';

const CLIENTE_A = '00000000-0000-4000-8000-0000000000aa';
const CLIENTE_B = '00000000-0000-4000-8000-0000000000bb';

const linha = (id: string, extra: Partial<LinhaDePerfil> = {}): LinhaDePerfil => ({
  id,
  client_id: CLIENTE_A,
  papel: 'referencia',
  handle: id,
  nome: null,
  seguidores: null,
  monitorar: false,
  criado_em: '2026-11-01T10:00:00Z',
  atualizado_em: '2026-11-01T10:00:00Z',
  arquivado_em: null,
  ...extra,
});

Deno.test('papel: aceita singular e plural, sem caixa; o resto é nulo', () => {
  assertEquals(papelDoPedido('referencias'), 'referencia');
  assertEquals(papelDoPedido('Referencia'), 'referencia');
  assertEquals(papelDoPedido(' concorrentes '), 'concorrente');
  assertEquals(papelDoPedido('concorrente'), 'concorrente');
  assertEquals(papelDoPedido('outro'), null);
  assertEquals(papelDoPedido(undefined), null);
});

Deno.test('perfil na lista: handle com @, status pelo arquivado_em e seguidores em número', () => {
  const p = perfilParaLista(linha('fulano', { seguidores: 1200, arquivado_em: '2026-11-10T00:00:00Z', monitorar: true }));
  assertEquals(p.handle, '@fulano');
  assertEquals(p.status, 'arquivado');
  assertEquals(p.seguidores, 1200);
  assertEquals(p.monitorar, true);
  assertEquals(perfilParaLista(linha('ciclano')).status, 'ativo');
});

Deno.test('contagem: só ativos contam; vagas nunca negativas', () => {
  const linhas = [
    ...Array.from({ length: 6 }, (_, i) => linha(`r${i}`)),
    linha('r-arq', { arquivado_em: '2026-11-10T00:00:00Z' }),
    linha('c1', { papel: 'concorrente' }),
  ];
  assertEquals(contagemDoPapel(linhas, 'referencia'), { ativos: 6, limite: 6, vagas: 0 });
  assertEquals(contagemDoPapel(linhas, 'concorrente'), { ativos: 1, limite: 6, vagas: 5 });
  const demais = Array.from({ length: 7 }, (_, i) => linha(`x${i}`));
  assertEquals(contagemDoPapel(demais, 'referencia').vagas, 0);
});

Deno.test('lista por aba: ativos primeiro (mais antigo antes), arquivados depois (mais recente antes)', () => {
  const linhas = [
    linha('arq-velho', { arquivado_em: '2026-11-02T00:00:00Z', criado_em: '2026-10-01T00:00:00Z' }),
    linha('ativo-novo', { criado_em: '2026-11-05T00:00:00Z' }),
    linha('arq-novo', { arquivado_em: '2026-11-12T00:00:00Z', criado_em: '2026-10-02T00:00:00Z' }),
    linha('ativo-velho', { criado_em: '2026-11-01T00:00:00Z' }),
    linha('conc', { papel: 'concorrente', monitorar: true }),
  ];
  const r = montarListaPorAba(linhas);
  assertEquals(r.referencias!.perfis.map((p) => p.id), ['ativo-velho', 'ativo-novo', 'arq-novo', 'arq-velho']);
  assertEquals(r.referencias!.ativos, 2);
  assertEquals(r.referencias!.vagas, 4);
  assertEquals(r.concorrentes!.perfis.map((p) => p.handle), ['@conc']);
  assertEquals(r.concorrentes!.vagas, 5);
});

Deno.test('lista por aba: sem arquivados e com um papel só', () => {
  const linhas = [linha('a'), linha('b', { arquivado_em: '2026-11-12T00:00:00Z' }), linha('c', { papel: 'concorrente' })];
  const soAtivos = montarListaPorAba(linhas, { incluirArquivados: false });
  assertEquals(soAtivos.referencias!.perfis.map((p) => p.id), ['a']);
  const soConc = montarListaPorAba(linhas, { papel: 'concorrente' });
  assertEquals(Object.keys(soConc), ['concorrentes']);
  assertEquals(montarListaPorAba([]).referencias, { perfis: [], ativos: 0, limite: 6, vagas: 6 });
});

Deno.test('pedido de arquivar: perfil_id ou handle com papel, nunca os dois', () => {
  assertEquals(normalizarPedidoDeArquivar({ perfil_id: 'id-1' }), { ok: true, pedido: { por: 'id', perfil_id: 'id-1' } });
  assertEquals(
    normalizarPedidoDeArquivar({ handle: 'https://www.instagram.com/Fulano/?hl=pt', papel: 'concorrentes' }),
    { ok: true, pedido: { por: 'handle', handle: 'fulano', papel: 'concorrente' } },
  );
  assertEquals(normalizarPedidoDeArquivar({ handle: '@Fulano', papel: 'referencia' }).ok, true);
  assert(!normalizarPedidoDeArquivar({}).ok);
  assert(!normalizarPedidoDeArquivar({ perfil_id: 'id-1', handle: '@x', papel: 'referencia' }).ok);
  assert(!normalizarPedidoDeArquivar({ handle: '@fulano' }).ok, 'handle sem papel');
  assert(!normalizarPedidoDeArquivar({ handle: '@fulano', papel: 'amigo' }).ok);
  assert(!normalizarPedidoDeArquivar({ handle: 'instagram.com/p/ABC123', papel: 'referencia' }).ok, 'link de post não é perfil');
});

Deno.test('decidir por id: ativo arquiva, arquivado volta como já arquivado, outro cliente é o mesmo erro de inexistente', () => {
  const ativo = linha('p1');
  const arquivado = linha('p2', { arquivado_em: '2026-11-10T00:00:00Z' });
  const deOutro = linha('p3', { client_id: CLIENTE_B });
  const linhas = [ativo, arquivado, deOutro];
  assertEquals(decidirArquivamento(CLIENTE_A, linhas, { por: 'id', perfil_id: 'p1' }), { acao: 'arquivar', perfil: ativo });
  assertEquals(decidirArquivamento(CLIENTE_A, linhas, { por: 'id', perfil_id: 'p2' }), { acao: 'ja_arquivado', perfil: arquivado });
  const fora = decidirArquivamento(CLIENTE_A, linhas, { por: 'id', perfil_id: 'p3' });
  const inexistente = decidirArquivamento(CLIENTE_A, linhas, { por: 'id', perfil_id: 'nao-existe' });
  assertEquals(fora, { acao: 'erro', erro: ERRO_PERFIL_NAO_ENCONTRADO });
  assertEquals(inexistente, fora);
  assert(!JSON.stringify(fora).includes(CLIENTE_B), 'não vaza o outro cliente');
});

Deno.test('decidir por handle: ativo do papel, senão o arquivado mais recente, senão erro claro', () => {
  const velho = linha('v', { handle: 'fulano', arquivado_em: '2026-11-01T00:00:00Z' });
  const novo = linha('n', { handle: 'fulano', arquivado_em: '2026-11-09T00:00:00Z' });
  const ativo = linha('a', { handle: 'fulano' });
  const pedido = { por: 'handle' as const, handle: 'fulano', papel: 'referencia' as const };
  assertEquals(decidirArquivamento(CLIENTE_A, [velho, ativo, novo], pedido), { acao: 'arquivar', perfil: ativo });
  assertEquals(decidirArquivamento(CLIENTE_A, [velho, novo], pedido), { acao: 'ja_arquivado', perfil: novo });
  const outroPapel = decidirArquivamento(CLIENTE_A, [linha('c', { handle: 'fulano', papel: 'concorrente' })], pedido);
  assertEquals(outroPapel.acao, 'erro');
  if (outroPapel.acao === 'erro') assert(outroPapel.erro.includes('@fulano não está em Referências'));
  const deOutro = decidirArquivamento(CLIENTE_A, [linha('b', { handle: 'fulano', client_id: CLIENTE_B })], pedido);
  assertEquals(deOutro.acao, 'erro');
});
