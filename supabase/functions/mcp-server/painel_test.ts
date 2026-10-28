// MCP 2.17 (22/10/2026): testes do painel inteiro, da robustez e da leitura enxuta.
// Sem rede e sem Supabase: banco falso encadeável e relógio controlado.

import { assert, assertEquals, assertRejects, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { canInvoke, canUseToolWithDataScope, describeTool, TOOL_MAP, TOOLS } from '../_shared/mcp-tools.ts';
import type { AuthContext } from '../_shared/mcp-auth.ts';
import { acaoPermitida, ACOES_LONGAS_DA_PONTE } from '../_shared/mcp-mesas-ponte.ts';
import { MCP_VERSION } from '../_shared/mcp-release.ts';
import {
  comNovaTentativa,
  comPrazo,
  ehTransitorio,
  ErroDaFerramenta,
  explicarErro,
  prazoDaFerramenta,
  RegistroLeve,
  validarEntrada,
} from './modulos/robustez.ts';
import { CacheCurto, chaveDoCache, criarCursor, lerCursor, lerLinhas, pagina, tamanhoDaPagina } from './modulos/leitura-enxuta.ts';
import { CredencialEmCache, vencimentoDoJwt } from './modulos/credencial-em-cache.ts';
import { executarFerramenta, type FerramentaExecutavel } from './modulos/executar-ferramenta.ts';
import { ACOES_COM_CUSTO, corpoDaAcao, ENTRADA_DA_ACAO, faltaNaAcao, FERRAMENTAS_DO_PAINEL_INTEIRO } from './modulos/painel-inteiro.ts';
import { descricaoCurta, descritorEnxuto, DESCRICAO_INTEIRA, FERRAMENTAS_POR_AREA, guiaDoPainel, lerRecurso, montarPrompt, PROMPTS, RECURSOS } from './modulos/guia-do-painel.ts';
import { campanhasDoMes, membros, panoramaDoCliente, semConferirClienteNoTeste, trabalhosDoEstudio, usarBancoDeTeste, laboratorio } from './modulos/painel-leituras.ts';

const CLIENTE = '00000000-0000-0000-0000-0000000000aa';
const adminCtx: AuthContext = {
  keyId: 'oauth:00000000-0000-0000-0000-000000000001',
  keyName: 'teste',
  scopes: ['admin'],
  origin: 'teste',
  dataScope: { unrestricted: true, clientIds: [], principalUserId: '00000000-0000-0000-0000-000000000001', source: 'oauth' },
};
const restritoCtx: AuthContext = {
  ...adminCtx,
  scopes: ['aceleriq:read', 'aceleriq:write'],
  dataScope: { unrestricted: false, clientIds: [CLIENTE], principalUserId: adminCtx.dataScope.principalUserId, source: 'oauth' },
};

// ─── Banco falso encadeável ─────────────────────────────────────

interface Chamada { tabela: string; select: string; filtros: Array<[string, unknown[]]>; faixa?: [number, number]; head?: boolean }
type Resposta = { data?: unknown; error?: { code?: string; message?: string } | null; count?: number | null };

function bancoFalso(responder: (c: Chamada) => Resposta) {
  const chamadas: Chamada[] = [];
  return {
    chamadas,
    from(tabela: string) {
      const c: Chamada = { tabela, select: '', filtros: [] };
      chamadas.push(c);
      const q: Record<string, unknown> = {};
      const encadear = (nome: string) => (...args: unknown[]) => {
        c.filtros.push([nome, args]);
        return q;
      };
      for (const m of ['eq', 'is', 'not', 'in', 'gte', 'lte', 'lt', 'gt', 'order', 'limit', 'textSearch', 'or', 'neq']) q[m] = encadear(m);
      q.select = (cols: string, opts?: { head?: boolean }) => {
        c.select = cols;
        c.head = !!opts?.head;
        return q;
      };
      q.range = (a: number, b: number) => {
        c.faixa = [a, b];
        return q;
      };
      q.then = (ok: (r: unknown) => unknown, erro?: (e: unknown) => unknown) => {
        try {
          const r = responder(c);
          return Promise.resolve({ data: r.data ?? null, error: r.error ?? null, count: r.count ?? null }).then(ok, erro);
        } catch (e) {
          return Promise.reject(e).then(ok, erro);
        }
      };
      return q;
    },
  };
}

// ─── Robustez ───────────────────────────────────────────────────

Deno.test('transitório: rede, 50x e PGRST00x repetem; 40001, conflito e entrada inválida nunca', () => {
  assert(ehTransitorio(new TypeError('fetch failed')));
  assert(ehTransitorio({ message: 'x', code: 'PGRST002' }));
  assert(ehTransitorio({ message: 'Service Unavailable', status: 503 }));
  assert(ehTransitorio(new Error('tasks: upstream connect error or disconnect/reset before headers')));
  assert(!ehTransitorio({ message: 'could not serialize access', code: '40001' }));
  assert(!ehTransitorio(new Error('CENTRAL_REPORT_VERSION_CONFLICT 503')));
  assert(!ehTransitorio(new Error('Invalid input: client_id: Required')));
  assert(!ehTransitorio(new Error('mesa:rede Não foi possível falar com a mesa')));
});

Deno.test('nova tentativa: repete o transitório com recuo e para no não transitório', async () => {
  const esperas: number[] = [];
  let vezes = 0;
  const r = await comNovaTentativa(async () => {
    vezes++;
    if (vezes < 3) throw new TypeError('fetch failed');
    return 'ok';
  }, { dormir: (ms) => { esperas.push(ms); return Promise.resolve(); } });
  assertEquals(r, 'ok');
  assertEquals(vezes, 3);
  assertEquals(esperas.length, 2);
  assert(esperas[0] >= 200 && esperas[1] >= 700);

  let conflito = 0;
  await assertRejects(() => comNovaTentativa(async () => {
    conflito++;
    throw Object.assign(new Error('serialization failure'), { code: '40001' });
  }, { dormir: () => Promise.resolve() }));
  assertEquals(conflito, 1, '40001 nunca repete (laço que derrubou o banco em 26/09 e 19/10)');

  let semTempo = 0;
  await assertRejects(() => comNovaTentativa(async () => {
    semTempo++;
    throw new TypeError('fetch failed');
  }, { dormir: () => Promise.resolve(), ate: Date.now() + 500 }));
  assertEquals(semTempo, 1, 'sem folga até o prazo, devolve o erro em vez de esperar');
});

Deno.test('prazo: estoura com tempo_esgotado e não deixa relógio pendurado', async () => {
  const e = await assertRejects(() => comPrazo(() => new Promise((r) => setTimeout(r, 200)), 20, 'A leitura'), ErroDaFerramenta);
  assertEquals((e as ErroDaFerramenta).codigo, 'tempo_esgotado');
  assert((e as ErroDaFerramenta).transitorio);
  const escrita = await assertRejects(() => comPrazo(() => new Promise((r) => setTimeout(r, 200)), 20, 'A ação', true), ErroDaFerramenta);
  assertStringIncludes((escrita as ErroDaFerramenta).dica ?? '', 'ANTES de repetir');
  assertEquals(await comPrazo(() => Promise.resolve(7), 1000, 'x'), 7);
  await new Promise((r) => setTimeout(r, 250));
});

Deno.test('prazo por ferramenta: leitura 30 s, escrita 120 s, longa sem prazo de fora', () => {
  assertEquals(prazoDaFerramenta({ name: 'a', annotations: { readOnlyHint: true } }), 30_000);
  assertEquals(prazoDaFerramenta({ name: 'b', annotations: { readOnlyHint: false } }), 120_000);
  assertEquals(prazoDaFerramenta({ name: 'c', longRunning: true }), null);
  assertEquals(prazoDaFerramenta({ name: 'd', prazoMs: 5_000 }), 5_000);
});

Deno.test('erro explicado: código, dica e se vale repetir', () => {
  assertEquals(explicarErro(new Error('Invalid input: client_id: Invalid uuid'), 't').codigo, 'entrada_invalida');
  assertEquals(explicarErro(new Error('mesa:exige_oauth Agir nas mesas...'), 't').codigo, 'mesa_exige_oauth');
  assertEquals(explicarErro(new Error('Not a client'), 't').codigo, 'nao_encontrado');
  assertEquals(explicarErro(new Error('versao_mudou'), 't').codigo, 'conflito');
  const rede = explicarErro(new TypeError('fetch failed'), 't');
  assertEquals(rede.codigo, 'indisponivel');
  assert(rede.transitorio);
});

Deno.test('validação leve: objeto, obrigatórios, tipo, UUID e lista fechada; número em texto passa', () => {
  const esquema = { type: 'object', properties: { client_id: { type: 'string', format: 'uuid' }, limite: { type: 'integer' }, detalhe: { type: 'string', enum: ['enxuto', 'completo'] }, filtros: { type: 'array' } }, required: ['client_id'] };
  assertEquals(validarEntrada(esquema, { client_id: CLIENTE, limite: '50' }), []);
  assertEquals(validarEntrada(esquema, 'texto').length, 1);
  const p = validarEntrada(esquema, { limite: 'muitos', detalhe: 'tudo', filtros: 'a' });
  assert(p.some((x) => x.startsWith('client_id: obrigatório')));
  assert(p.some((x) => x.startsWith('limite:')));
  assert(p.some((x) => x.startsWith('detalhe:')));
  assert(p.some((x) => x.startsWith('filtros:')));
  assertEquals(validarEntrada(esquema, { client_id: 'abc' }), ['client_id: precisa ser um UUID']);
});

// ─── Leitura enxuta ─────────────────────────────────────────────

Deno.test('cursor: ida e volta, recusa cursor de outra lista e página com uma linha a mais', () => {
  const c = criarCursor(40, 'campanhas:x');
  assertEquals(lerCursor(c, 'campanhas:x'), 40);
  assertEquals(lerCursor(undefined, 'campanhas:x'), 0);
  let recusou = false;
  try { lerCursor(c, 'stories:x'); } catch (e) { recusou = (e as Error).message.startsWith('Invalid input'); }
  assert(recusou);
  const p = pagina([1, 2, 3, 4], 0, 3, 'l');
  assertEquals(p.itens, [1, 2, 3]);
  assertEquals(lerCursor(p.proximo_cursor, 'l'), 3);
  assertEquals(pagina([1, 2], 0, 3, 'l').proximo_cursor, null);
  assertEquals(tamanhoDaPagina(500), 100);
  assertEquals(tamanhoDaPagina(undefined), 20);
});

Deno.test('cache curto: vence pelo tempo, junta pedidos iguais em voo e esquece a credencial que escreveu', async () => {
  let agora = 1_000;
  const cache = new CacheCurto(10, () => agora);
  let buscas = 0;
  const buscar = async () => { buscas++; await new Promise((r) => setTimeout(r, 5)); return { n: buscas }; };
  const k = chaveDoCache('p1', 't', { b: 1, a: 2 });
  assertEquals(k, chaveDoCache('p1', 't', { a: 2, b: 1 }), 'ordem dos argumentos não muda a chave');
  const [a, b] = await Promise.all([cache.lerOuBuscar(k, 1000, buscar), cache.lerOuBuscar(k, 1000, buscar)]);
  assertEquals(buscas, 1);
  assertEquals(a.valor, b.valor);
  assert((await cache.lerOuBuscar(k, 1000, buscar)).deCache);
  agora += 1001;
  assert(!(await cache.lerOuBuscar(k, 1000, buscar)).deCache);
  assertEquals(buscas, 2);
  cache.esquecerDoPrincipal('p1');
  assertEquals(cache.ler(k), null);
  assert(chaveDoCache('p1', 't', {}) !== chaveDoCache('p2', 't', {}), 'credenciais diferentes nunca dividem cache');
});

Deno.test('lerLinhas: coluna que ainda não existe refaz com * e recorta; tabela ausente vira aviso', async () => {
  const banco = bancoFalso((c) => {
    if (c.tabela === 'nova') return { error: { code: '42P01', message: 'relation "nova" does not exist' } };
    if (c.select.includes('coluna_futura')) return { error: { code: '42703', message: 'column x.coluna_futura does not exist' } };
    return { data: [{ id: 1, nome: 'a', segredo: 's' }] };
  });
  const r = await lerLinhas(banco, 'sites', ['id', 'nome', 'coluna_futura'], (q) => q.limit(1));
  assertEquals(r.linhas, [{ id: 1, nome: 'a' }]);
  assert(r.aviso);
  const t = await lerLinhas(banco, 'nova', ['id'], (q) => q);
  assertEquals(t.linhas, []);
  assert(t.aviso);
});

// ─── Credencial em cache ────────────────────────────────────────

Deno.test('credencial: sucesso fica 45 s, recusa não fica, nunca passa do exp do JWT', async () => {
  let agora = 10_000_000;
  const cache = new CredencialEmCache<{ ok: boolean }>(45_000, () => agora);
  let conferencias = 0;
  const req = (t: string) => new Request('https://x', { headers: { authorization: `Bearer ${t}` } });
  const ok = () => { conferencias++; return Promise.resolve({ ok: true }); };
  await cache.autenticar(req('chave-a'), ok);
  await cache.autenticar(req('chave-a'), ok);
  assertEquals(conferencias, 1);
  agora += 46_000;
  await cache.autenticar(req('chave-a'), ok);
  assertEquals(conferencias, 2);
  let recusas = 0;
  const nao = () => { recusas++; return Promise.resolve({ ok: false }); };
  await cache.autenticar(req('chave-b'), nao);
  await cache.autenticar(req('chave-b'), nao);
  assertEquals(recusas, 2);
  const corpo = btoa(JSON.stringify({ exp: Math.floor((agora + 5_000) / 1000) })).replace(/=+$/, '');
  const jwt = `h.${corpo}.s`;
  assert(vencimentoDoJwt(jwt));
  let jwtConf = 0;
  await cache.autenticar(req(jwt), () => { jwtConf++; return Promise.resolve({ ok: true }); });
  agora += 6_000;
  await cache.autenticar(req(jwt), () => { jwtConf++; return Promise.resolve({ ok: true }); });
  assertEquals(jwtConf, 2, 'depois do exp confere de novo');
});

// ─── Executar ferramenta ────────────────────────────────────────

function deps(extra: Partial<Parameters<typeof executarFerramenta>[3]> = {}) {
  const auditorias: Array<{ success: boolean; errorCode?: string | null; statusCode: number }> = [];
  return {
    auditorias,
    d: {
      auditar: (e: { success: boolean; errorCode?: string | null; statusCode: number }) => { auditorias.push(e); return Promise.resolve(); },
      ehForaDoEscopo: (e: unknown) => String((e as Error)?.message ?? '').includes('outside this MCP'),
      cache: new CacheCurto(),
      registro: new RegistroLeve(),
      ...extra,
    },
  };
}

const ctxBase = { keyId: 'k1', origin: 'o', scopes: ['admin'] };
// deno-lint-ignore no-explicit-any
const R = (d: unknown): any => (d as { result: unknown }).result;

Deno.test('executar: entrada inválida volta isError com código e não chama o handler', async () => {
  let chamou = false;
  const t: FerramentaExecutavel = { name: 'x', inputSchema: { type: 'object', properties: { client_id: { type: 'string', format: 'uuid' } }, required: ['client_id'] }, annotations: { readOnlyHint: true }, handler: () => { chamou = true; return Promise.resolve({}); } };
  const { d, auditorias } = deps();
  const r = await executarFerramenta(t, {}, ctxBase, d);
  assertEquals(r.tipo, 'ok');
  const res = R(r);
  assertEquals(res.isError, true);
  assertEquals((res.structuredContent as { erro: { codigo: string } }).erro.codigo, 'entrada_invalida');
  assert(!chamou);
  assertEquals(auditorias[0].statusCode, 400);
});

Deno.test('executar: leitura repete no transitório; escrita não repete', async () => {
  let leituras = 0;
  const leitura: FerramentaExecutavel = { name: 'l', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true }, handler: () => { leituras++; return leituras < 2 ? Promise.reject(new TypeError('fetch failed')) : Promise.resolve({ ok: 1 }); } };
  const { d } = deps();
  const r = await executarFerramenta(leitura, {}, ctxBase, d);
  assertEquals(leituras, 2);
  assertEquals((R(r)._meta)['aceleriq/novas_tentativas'], 1);

  let escritas = 0;
  const escrita: FerramentaExecutavel = { name: 'w', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false }, handler: () => { escritas++; return Promise.reject(new TypeError('fetch failed')); } };
  const r2 = await executarFerramenta(escrita, {}, ctxBase, deps().d);
  assertEquals(escritas, 1);
  assertEquals((R(r2).structuredContent.erro.transitorio), true);
});

Deno.test('executar: prazo da ferramenta responde na hora em vez de travar', async () => {
  const lenta: FerramentaExecutavel = { name: 'lenta', prazoMs: 30, inputSchema: { type: 'object' }, annotations: { readOnlyHint: true }, handler: () => new Promise((r) => setTimeout(() => r({}), 300)) };
  const inicio = Date.now();
  const r = await executarFerramenta(lenta, {}, ctxBase, deps().d);
  assert(Date.now() - inicio < 250);
  assertEquals((R(r).structuredContent.erro.codigo), 'tempo_esgotado');
  await new Promise((r2) => setTimeout(r2, 300));
});

Deno.test('executar: leitura com cache volta do cache; escrita da mesma credencial limpa', async () => {
  let n = 0;
  const leitura: FerramentaExecutavel = { name: 'c', cacheSeg: 30, inputSchema: { type: 'object' }, annotations: { readOnlyHint: true }, handler: () => Promise.resolve({ n: ++n }) };
  const escrita: FerramentaExecutavel = { name: 'w', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false }, handler: () => Promise.resolve({ ok: true }) };
  const { d } = deps();
  await executarFerramenta(leitura, { a: 1 }, ctxBase, d);
  const segunda = await executarFerramenta(leitura, { a: 1 }, ctxBase, d);
  assertEquals((R(segunda)._meta)['aceleriq/de_cache'], true);
  assertEquals(n, 1);
  await executarFerramenta(escrita, {}, ctxBase, d);
  await executarFerramenta(leitura, { a: 1 }, ctxBase, d);
  assertEquals(n, 2);
});

Deno.test('executar: fora do escopo continua erro de protocolo; leitura audita em segundo plano', async () => {
  const fora: FerramentaExecutavel = { name: 'f', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true }, handler: () => Promise.reject(new Error('resource is outside this MCP principal data scope')) };
  const plano: Promise<unknown>[] = [];
  const { d, auditorias } = deps({ emSegundoPlano: (p) => { plano.push(p); } });
  const r = await executarFerramenta(fora, {}, ctxBase, d);
  assertEquals(r.tipo, 'fora_do_escopo');
  assertEquals(plano.length, 1);
  await Promise.all(plano);
  assertEquals(auditorias[0].statusCode, 403);
});

// ─── Ferramentas novas no catálogo ──────────────────────────────

const NOVAS = ['aceleriq_guia', 'aceleriq_panorama_do_cliente', 'aceleriq_panorama_da_casa', 'aceleriq_mes_campanhas', 'aceleriq_mesa_stories', 'aceleriq_mesa_hype', 'aceleriq_mesa_templates', 'aceleriq_estudio_trabalhos', 'aceleriq_mesa_site', 'aceleriq_laboratorio', 'aceleriq_base_dos_agentes', 'aceleriq_membros', 'aceleriq_mcp_saude', 'aceleriq_mesa_campanha_acao'];

Deno.test('catálogo 2.17: as ferramentas novas existem, sem nome repetido, e a versão subiu', () => {
  assertEquals(MCP_VERSION, '2.23.0');
  for (const n of NOVAS) assert(TOOL_MAP.has(n), n);
  assertEquals(new Set(TOOLS.map((t) => t.name)).size, TOOLS.length);
  assertEquals(FERRAMENTAS_DO_PAINEL_INTEIRO.length, NOVAS.length);
});

Deno.test('catálogo 2.17: leitura é só leitura com escopo de leitura; a ação pede mesas:write', () => {
  for (const n of NOVAS.filter((x) => x !== 'aceleriq_mesa_campanha_acao')) {
    const t = TOOL_MAP.get(n)!;
    assertEquals(t.annotations?.readOnlyHint, true, n);
    assert(t.scopes.length === 0 || t.scopes.includes('aceleriq:read'), n);
  }
  const acao = TOOL_MAP.get('aceleriq_mesa_campanha_acao')!;
  assertEquals([...acao.scopes], ['mesas:write']);
  assert(acao.longRunning);
  assert(!canInvoke({ ...adminCtx, scopes: ['aceleriq:read'] }, acao));
});

Deno.test('catálogo 2.17: principal restrito a cliente não alcança as novas (falha fechada)', () => {
  for (const n of NOVAS.filter((x) => x !== 'aceleriq_guia')) {
    assert(!canUseToolWithDataScope(restritoCtx, TOOL_MAP.get(n)!), n);
  }
  assert(canUseToolWithDataScope(restritoCtx, TOOL_MAP.get('aceleriq_guia')!));
});

Deno.test('ação da campanha: custo exige confirmar_custo, campos por ação e corpo certo para a mesa', () => {
  const base = { campanha_id: CLIENTE, idempotency_key: 'teste-123456' };
  const semCusto = ENTRADA_DA_ACAO.parse({ ...base, acao: 'mercado' });
  assertStringIncludes(faltaNaAcao(semCusto) ?? '', 'confirmar_custo');
  assertEquals(faltaNaAcao(ENTRADA_DA_ACAO.parse({ ...base, acao: 'mercado', confirmar_custo: true })), null);
  assertStringIncludes(faltaNaAcao(ENTRADA_DA_ACAO.parse({ ...base, acao: 'mudanca_confirmar' })) ?? '', 'mensagem_id');
  assertEquals(faltaNaAcao(ENTRADA_DA_ACAO.parse({ ...base, acao: 'trilha_estado' })), null);
  for (const a of ACOES_COM_CUSTO) assert(['mudanca_planejar', 'reorganizar', 'mercado', 'roteiro_video', 'trilha_gerar'].includes(a));

  const trilha = corpoDaAcao(ENTRADA_DA_ACAO.parse({ ...base, acao: 'trilha_gerar', confirmar_custo: true, duracao: 30 }), CLIENTE);
  assertEquals(trilha.acao, 'campanha_trilha');
  assertEquals(trilha.corpo.operacao, 'gerar_trilha');
  assertEquals(trilha.corpo.confirmado, true);
  const ads = corpoDaAcao(ENTRADA_DA_ACAO.parse({ ...base, acao: 'pecas_para_ads', pecas: [{ trabalho_id: CLIENTE, formato: 'feed_4x5' }] }), CLIENTE);
  assertEquals(ads.funcao, 'mesa-ads');
  assertEquals(ads.acao, 'criativos_da_campanha_mesa');
  assertEquals(ads.corpo.client_id, CLIENTE);
  const reorg = corpoDaAcao(ENTRADA_DA_ACAO.parse({ ...base, acao: 'reorganizar', confirmar_custo: true, data_evento: '2026-11-10', aplicar: false }), CLIENTE);
  assertEquals(reorg.corpo, { campanha_id: CLIENTE, data_evento: '2026-11-10', aplicar: false });

  // Toda ação que a ferramenta manda está na lista fechada da ponte; as de IA respondem com fôlego.
  for (const acao of ['mudanca_planejar', 'mudanca_confirmar', 'mudanca_desfazer', 'versao_voltar', 'reorganizar', 'mercado', 'roteiro_video', 'trilha_estado', 'pecas_para_ads'] as const) {
    const c = corpoDaAcao({ ...base, acao, mensagem: 'm', mensagem_id: CLIENTE, versao_id: 'v', tema_id: 't', pecas: [{ trabalho_id: CLIENTE, formato: 'feed_4x5' }] } as never, CLIENTE);
    assert(acaoPermitida(c.funcao, c.acao), `${c.funcao}/${c.acao}`);
  }
  assert(ACOES_LONGAS_DA_PONTE.has('agente-calendario:campanha_mercado'));
  assert(!acaoPermitida('mesa-ads', 'gerar_card'), 'gerar fora da fila continua fora');
});

Deno.test('ação da campanha: sem confirmar_custo a ferramenta recusa antes de qualquer rede', async () => {
  const t = TOOL_MAP.get('aceleriq_mesa_campanha_acao')!;
  await assertRejects(() => t.handler({ campanha_id: CLIENTE, acao: 'mudanca_planejar', mensagem: 'x', idempotency_key: 'teste-123456' }, adminCtx), Error, 'confirmar_custo');
});

// ─── Leituras com banco falso ───────────────────────────────────

Deno.test('panorama do cliente: uma chamada, partes em paralelo, a que falha vira `faltou`', async () => {
  semConferirClienteNoTeste(true);
  const banco = bancoFalso((c) => {
    if (c.tabela === 'ads_campaigns') return { error: { code: 'XX000', message: 'boom' } };
    if (c.head) return { count: c.filtros.some(([m]) => m === 'lt') ? 2 : 9 };
    if (c.tabela === 'projects') return { data: [{ id: 'p1', name: 'Projeto', status: 'active' }] };
    if (c.tabela === 'profiles') return { data: [{ id: CLIENTE, full_name: 'Cliente' }] };
    return { data: [] };
  });
  usarBancoDeTeste(() => banco);
  try {
    const r = await panoramaDoCliente({ client_id: CLIENTE }, adminCtx) as Record<string, unknown>;
    assertEquals((r.perfil as { full_name: string }).full_name, 'Cliente');
    assertEquals((r.tarefas as { abertas: number; atrasadas: number }).abertas, 9);
    assertEquals((r.tarefas as { abertas: number; atrasadas: number }).atrasadas, 2);
    assertEquals(r.anuncios, null);
    assertEquals((r.faltou as Array<{ secao: string }>).map((f) => f.secao), ['anuncios']);
    for (const s of ['campanhas', 'estudio', 'stories', 'dia_prioritario', 'dossie', 'pedidos', 'aprovacoes_da_execucao', 'sites']) assert(s in r, s);
    // Cada leitura pede só as colunas que usa.
    assert(banco.chamadas.every((c) => c.select !== '*'));
  } finally {
    usarBancoDeTeste(null);
    semConferirClienteNoTeste(false);
  }
});

Deno.test('panorama do cliente: restrito a outro cliente é barrado antes do banco', async () => {
  const banco = bancoFalso(() => ({ data: [] }));
  usarBancoDeTeste(() => banco);
  try {
    await assertRejects(() => panoramaDoCliente({ client_id: '00000000-0000-0000-0000-0000000000bb' }, restritoCtx));
    assertEquals(banco.chamadas.length, 0);
  } finally {
    usarBancoDeTeste(null);
  }
});

Deno.test('listas: enxuto por padrão, completo sob pedido, cursor para a próxima página', async () => {
  semConferirClienteNoTeste(true);
  const linhas = Array.from({ length: 4 }, (_, i) => ({ id: `t${i}`, tipo: 'post', status: 'pronto', legenda: 'x'.repeat(500), cards: [{ storage_path: 'a' }, {}], atualizado_em: '2026-10-22' }));
  const banco = bancoFalso((c) => ({ data: linhas.slice(c.faixa?.[0] ?? 0, (c.faixa?.[1] ?? 99) + 1) }));
  usarBancoDeTeste(() => banco);
  try {
    const p1 = await trabalhosDoEstudio({ client_id: CLIENTE, limite: 3 }, adminCtx) as { itens: Array<Record<string, unknown>>; proximo_cursor: string };
    assertEquals(p1.itens.length, 3);
    assert(p1.proximo_cursor);
    assert(!('cards' in p1.itens[0]), 'enxuto não manda os cards');
    assertEquals(p1.itens[0].laminas_com_arte, 1);
    assert(String(p1.itens[0].legenda).length <= 200);
    assertEquals(banco.chamadas.at(-1)?.faixa, [0, 3]);
    const p2 = await trabalhosDoEstudio({ client_id: CLIENTE, limite: 3, cursor: p1.proximo_cursor }, adminCtx) as { itens: unknown[]; proximo_cursor: string | null };
    assertEquals(p2.itens.length, 1);
    assertEquals(p2.proximo_cursor, null);
    const completo = await trabalhosDoEstudio({ client_id: CLIENTE, detalhe: 'completo' }, adminCtx) as { itens: Array<Record<string, unknown>> };
    assert('cards' in completo.itens[0]);
    assert(banco.chamadas.at(-1)?.select.includes('direcao'));
  } finally {
    usarBancoDeTeste(null);
    semConferirClienteNoTeste(false);
  }
});

Deno.test('campanha inteira: junta conteúdos, artes, stories, criativos e sons pelo id da campanha', async () => {
  semConferirClienteNoTeste(true);
  const CAMP = '00000000-0000-0000-0000-0000000000cc';
  const banco = bancoFalso((c) => {
    if (c.tabela === 'mesa_campanhas') return { data: [{ id: CAMP, client_id: CLIENTE, nome: 'Black Friday', proposta_id: 'prop', briefing: { linha_do_tempo: { evento: '2026-11-27' }, mercado: { x: 1 }, produtos: [1, 2] } }] };
    if (c.tabela === 'calendario_propostas') return { data: [{ id: 'prop', status: 'aberta', itens: [{ tema_id: 'a', tema: 'Abertura', legenda: 'longa' }] }] };
    return { data: [{ id: 'x', entrega_status: 'enviado' }] };
  });
  usarBancoDeTeste(() => banco);
  try {
    const r = await campanhasDoMes({ client_id: CLIENTE, campanha_id: CAMP }, adminCtx) as Record<string, any>;
    assertEquals(r.resumo.tem_mercado, true);
    assertEquals(r.resumo.produtos, 2);
    assertEquals(r.conteudos.total, 1);
    assert(!('legenda' in r.conteudos.itens[0]), 'conteúdo vem enxuto');
    const filtroArte = banco.chamadas.find((c) => c.tabela === 'estudio_trabalhos')!.filtros;
    assert(filtroArte.some(([m, a]) => m === 'eq' && a[0] === 'direcao->arte_rapida->>campanha_id' && a[1] === CAMP));
    assert(banco.chamadas.some((c) => c.tabela === 'ads_criativos' && c.filtros.some(([, a]) => a[0] === 'copy->>campanha_mesa_id')));
    assertEquals(r.faltou, []);
  } finally {
    usarBancoDeTeste(null);
    semConferirClienteNoTeste(false);
  }
});

Deno.test('membros e laboratório: nada pessoal nem segredo sai', async () => {
  const banco = bancoFalso((c) => {
    if (c.head) return { count: 3 };
    if (c.tabela === 'membros_crm_negocios') return { data: [{ estagio: 'proposta', valor: 100 }, { estagio: 'proposta', valor: 50 }] };
    if (c.tabela === 'membros_licencas') return { data: [{ produto_id: 'p', origem: 'pagamento', fim: '2999-01-01', revogado_em: null }, { produto_id: 'p', origem: 'pagamento', fim: '2000-01-01', revogado_em: null }] };
    return { data: [] };
  });
  usarBancoDeTeste(() => banco);
  try {
    const m = await membros({}, adminCtx) as Record<string, any>;
    assertEquals(m.crm_licenca.negocios_por_estagio.proposta, { negocios: 2, valor: 150 });
    assertEquals(m.licencas.p.ativas, 1);
    assertEquals(m.licencas.p.vencidas, 1);
    await laboratorio({}, adminCtx);
    const selects = banco.chamadas.map((c) => `${c.tabela}:${c.select}`).join(' | ');
    for (const proibido of ['email', 'telefone', 'notas', 'comprador_nome', 'comprador_whatsapp', 'segredo', 'chave', 'token_api']) {
      assert(!new RegExp(`\\b${proibido}`).test(selects.replace(/membros_crm_contatos:id/, '')), `${proibido} não pode ser lido: ${selects}`);
    }
    await assertRejects(() => membros({}, restritoCtx));
  } finally {
    usarBancoDeTeste(null);
  }
});

// ─── Guia, recursos, prompts e lista enxuta ─────────────────────

Deno.test('guia: toda ferramenta do catálogo tem área, e toda área aponta para ferramenta que existe', () => {
  const nomes = new Set(TOOLS.map((t) => t.name));
  const comArea = new Set(Object.values(FERRAMENTAS_POR_AREA).flat());
  for (const n of comArea) assert(nomes.has(n), `área aponta para ${n}, que não existe`);
  const semArea = TOOLS.map((t) => t.name).filter((n) => !comArea.has(n));
  assertEquals(semArea, [], 'ferramenta sem área no mapa do painel');
  const g = guiaDoPainel({}, TOOLS) as { areas: Array<{ area: string }>; regras: string[] };
  for (const a of ['mesa', 'mesa_ads', 'mesa_site', 'laboratorio', 'comercial', 'execucao', 'financeiro', 'memoria']) assert(g.areas.some((x) => x.area === a), a);
  assert(g.regras.length >= 5);
  const manual = guiaDoPainel({ ferramenta: 'aceleriq_operator_diary' }, TOOLS) as { manual: string };
  assertEquals(manual.manual, TOOL_MAP.get('aceleriq_operator_diary')!.description);
  assertEquals((guiaDoPainel({ area: 'Mesa Ads' }, TOOLS) as { area: string }).area, 'mesa_ads');
});

Deno.test('lista de ferramentas enxuta: bem menor, regras do Hermes inteiras, manual no guia', () => {
  const antes = JSON.stringify({ tools: TOOLS.map(describeTool) }).length;
  const depois = JSON.stringify({ tools: TOOLS.map((t) => descritorEnxuto(describeTool(t))) }).length;
  const da216 = JSON.stringify({ tools: TOOLS.filter((t) => !NOVAS.includes(t.name)).map(describeTool) }).length;
  console.log(`tools/list: 2.16 ${da216} bytes; 2.17 cheia ${antes}; 2.17 enxuta ${depois} (${Math.round((1 - depois / antes) * 100)}% menor)`);
  assert(depois < antes * 0.82, `${antes} -> ${depois}`);
  assert(depois < da216, 'mesmo com as ferramentas novas, a lista fica menor que a da 2.16');
  for (const n of DESCRICAO_INTEIRA) assertEquals(descricaoCurta(n, TOOL_MAP.get(n)!.description), TOOL_MAP.get(n)!.description);
  for (const t of TOOLS) {
    const d = descritorEnxuto(describeTool(t));
    assert(String(d.description).length <= 400 || DESCRICAO_INTEIRA.has(t.name), t.name);
    const props = (s: unknown) => Object.keys(((s as { properties?: object }).properties) ?? {}).sort();
    assertEquals(props(d.inputSchema), props(t.inputSchema), 'nenhum campo some');
    assertEquals((d.inputSchema as { required?: unknown }).required, (t.inputSchema as { required?: unknown }).required, 'obrigatórios iguais');
  }
  assertStringIncludes(descricaoCurta('aceleriq_mesa_ads_contexto', TOOL_MAP.get('aceleriq_mesa_ads_contexto')!.description), 'aceleriq_guia');
});

Deno.test('recursos e prompts do protocolo: mapa, regras e skills; prompt sem argumento obrigatório é recusado', () => {
  for (const r of RECURSOS) {
    const c = lerRecurso(r.uri, TOOLS);
    assert(c && c.text.length > 50, r.uri);
  }
  assertEquals(lerRecurso('aceleriq://nada', TOOLS), null);
  assertStringIncludes(lerRecurso('aceleriq://mapa-do-painel', TOOLS)!.text, 'aceleriq_mesa_site');
  assert(PROMPTS.length >= 4);
  assertEquals(montarPrompt('panorama_do_cliente', {}), null);
  assertStringIncludes(montarPrompt('panorama_do_cliente', { client_id: CLIENTE })!.messages[0].content.text, 'aceleriq_panorama_do_cliente');
});

// ─── Limite do _shared ──────────────────────────────────────────

Deno.test('_shared: o que só o MCP usa mora em mcp-server/modulos (navegador e arquivos saíram)', async () => {
  const raiz = new URL('../_shared/', import.meta.url);
  for (const nome of ['mcp-navegador.ts', 'mcp-files-services.ts']) {
    let existe = true;
    try { await Deno.stat(new URL(nome, raiz)); } catch { existe = false; }
    assert(!existe, `${nome} voltou para _shared`);
  }
  for (const nome of ['painel-inteiro.ts', 'painel-leituras.ts', 'robustez.ts', 'leitura-enxuta.ts', 'guia-do-painel.ts', 'executar-ferramenta.ts', 'credencial-em-cache.ts', 'mcp-navegador.ts', 'mcp-files-services.ts']) {
    await Deno.stat(new URL(`./modulos/${nome}`, import.meta.url));
  }
  // Soma do que não é pasta de função (o que a publicação do Lovable leva junto): abaixo de 4 MB.
  const funcoes = new URL('../', import.meta.url);
  let total = 0;
  const somar = async (u: URL) => {
    for await (const e of Deno.readDir(u)) {
      const filho = new URL(e.name + (e.isDirectory ? '/' : ''), u);
      if (e.isDirectory) await somar(filho);
      else total += (await Deno.stat(filho)).size;
    }
  };
  for await (const e of Deno.readDir(funcoes)) {
    const u = new URL(e.name + (e.isDirectory ? '/' : ''), funcoes);
    if (e.isDirectory) {
      let ehFuncao = true;
      try { await Deno.stat(new URL('index.ts', u)); } catch { ehFuncao = false; }
      if (!ehFuncao) await somar(u);
    } else total += (await Deno.stat(u)).size;
  }
  console.log(`compartilhado fora das funções: ${total} bytes`);
  assert(total < 4_000_000, `${total} bytes`);
});
