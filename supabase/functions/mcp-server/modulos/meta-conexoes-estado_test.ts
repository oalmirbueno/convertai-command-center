// MCP 2.40.0 (25/11/2026): aceleriq_meta_conexoes_estado, sem banco nem rede (porta e fetch de memória).
import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { ErroDaFerramenta } from './robustez.ts';
import {
  type BuscarFn,
  classificarDebugToken,
  type ClienteAtivo,
  comConcorrencia,
  configDaMeta,
  type ContaMeta,
  debugToken,
  estadoPeloBanco,
  exigirAdminIrrestrito,
  FERRAMENTA_META_CONEXOES_ESTADO,
  handleDoInstagram,
  lerPrazo,
  metaConexoesEstado,
  type PedidoDeToken,
  type PortaMetaConexoes,
  provaDoSegredo,
  type TokenDaConta,
  urlDoPainel,
  validarEntrada,
} from './meta-conexoes-estado.ts';

const AGORA = new Date('2026-11-25T12:00:00Z');
const EM = (dias: number) => Math.floor(AGORA.getTime() / 1000) + dias * 86_400;
const CFG = { appId: '1111', appSecret: 'segredo-do-app-NAO-PODE-SAIR', graphVersion: 'v26.0' };
const TOKEN = (n: number) => `EAAtokenSecretoDaConta${n}xxxxxxxxxxxxxxxx`;

const CLI = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CONTA = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const GRANT = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const admin: AuthContext = {
  keyId: 'k-admin', keyName: 'Admin', scopes: ['admin'], origin: null,
  dataScope: { unrestricted: true, clientIds: [], principalUserId: null, source: 'api_key' },
};
const negados: Array<[string, AuthContext]> = [
  ['leitura agregada', { ...admin, scopes: ['aceleriq:read', 'clients:read'] }],
  ['admin restrito a cliente', { ...admin, dataScope: { ...admin.dataScope, unrestricted: false, clientIds: [CLI(1)] } }],
  ['irrestrito sem admin', { ...admin, scopes: ['aceleriq:write'] }],
  ['sem escopos', { ...admin, scopes: [] }],
  ['legado sem dataScope', { ...admin, dataScope: undefined } as unknown as AuthContext],
];

function conta(n: number, cliente: number, extra: Partial<ContaMeta> = {}): ContaMeta {
  return {
    external_account_id: CONTA(n),
    client_id: CLI(cliente),
    platform: 'instagram',
    external_id: `1784${n}`,
    handle: `perfil${n}`,
    display_name: `Perfil ${n}`,
    connection_status: 'connected',
    expires_at: null,
    data_access_expires_at: null,
    concessao: { id: GRANT(n), origem: 'oauth_usuario', status: 'active', access_token_expires_at: null, data_access_expires_at: null },
    ...extra,
  };
}

interface Fakes {
  porta: PortaMetaConexoes;
  chamadas: { clientes: number; contas: number; tokens: PedidoDeToken[] };
}

/** `maxVarridos`: a varredura para depois de ver tantos clientes (como as 5 rodadas da porta real). */
function fakes(clientes: ClienteAtivo[], contas: ContaMeta[] | null, tokens: Record<string, TokenDaConta> = {}, maxVarridos = Infinity): Fakes {
  const chamadas = { clientes: 0, contas: 0, tokens: [] as PedidoDeToken[] };
  const ordenados = [...clientes].sort((a, b) => a.id.localeCompare(b.id));
  return {
    chamadas,
    porta: {
      async clientesAtivos({ clientId, depoisDe, limite }) {
        chamadas.clientes++;
        const resto = ordenados.filter((c) => (clientId ? c.id === clientId : !depoisDe || c.id > depoisDe));
        const vistos = resto.slice(0, Math.min(limite, maxVarridos));
        const fim = !!clientId || vistos.length === resto.length;
        return { clientes: vistos, fim, varridoAte: vistos.at(-1)?.id ?? depoisDe };
      },
      async contas(ids) {
        chamadas.contas++;
        return contas === null ? null : contas.filter((c) => ids.includes(c.client_id));
      },
      async tokenDaConta(p) {
        chamadas.tokens.push(p);
        return tokens[p.externalAccountId] ?? { tipo: 'nao_localizado' };
      },
    },
  };
}

interface Pedido { url: URL; init: RequestInit }
function graphFalsa(responder: (token: string) => { status: number; corpo: unknown } | 'pendurar'): { buscar: BuscarFn; pedidos: Pedido[] } {
  const pedidos: Pedido[] = [];
  const buscar: BuscarFn = (url, init) => {
    const u = new URL(url);
    pedidos.push({ url: u, init });
    const r = responder(u.searchParams.get('input_token') ?? '');
    if (r === 'pendurar') {
      return new Promise((_, rejeitar) => init.signal?.addEventListener('abort', () => rejeitar(new DOMException('abort', 'AbortError'))));
    }
    return Promise.resolve(new Response(JSON.stringify(r.corpo), { status: r.status }));
  };
  return { buscar, pedidos };
}

const valido = (extra: Record<string, unknown> = {}) => ({
  status: 200,
  corpo: { data: { is_valid: true, app_id: '1111', type: 'PAGE', expires_at: 0, data_access_expires_at: EM(60), scopes: ['instagram_basic', 'pages_show_list'], ...extra } },
});

const deps = (f: Fakes, buscar: BuscarFn, config = CFG as typeof CFG | null, prazoTotalMs?: number) => ({
  porta: f.porta, config, buscar, painelOrigem: null, agora: () => AGORA, prazoTotalMs,
});

// ─── Acesso negado ─────────────────────────────────────────────

Deno.test('acesso: sem admin explícito E irrestrito, recusa antes de qualquer I/O', async () => {
  for (const [nome, ctx] of negados) {
    const f = fakes([{ id: CLI(1), nome: 'A' }], [conta(1, 1)]);
    const g = graphFalsa(() => valido());
    const e = await assertRejects(() => metaConexoesEstado({}, ctx, deps(f, g.buscar)), ErroDaFerramenta);
    assertEquals((e as ErroDaFerramenta).codigo, 'acesso_negado', nome);
    assertEquals([f.chamadas.clientes, f.chamadas.contas, f.chamadas.tokens.length], [0, 0, 0], `${nome}: nada no banco`);
    assertEquals(g.pedidos.length, 0, `${nome}: nada na Meta`);
  }
});

Deno.test('acesso: o handler real recusa antes de montar porta, config ou fetch', () => {
  const tool = FERRAMENTA_META_CONEXOES_ESTADO[0];
  for (const [nome, ctx] of negados) {
    let erro: unknown = null;
    try { tool.handler({}, ctx); } catch (e) { erro = e; }
    assert(erro instanceof ErroDaFerramenta && erro.codigo === 'acesso_negado', nome);
  }
  exigirAdminIrrestrito(admin); // admin irrestrito passa
});

Deno.test('catálogo: escopo admin, só leitura, no guia, prazo do despachante e fechada para chave restrita', async () => {
  const { TOOL_MAP, canInvoke, canUseToolWithDataScope } = await import('../../_shared/mcp-tools.ts');
  const { FERRAMENTAS_POR_AREA } = await import('./guia-do-painel.ts');
  const { MCP_VERSION } = await import('../../_shared/mcp-release.ts');
  assertEquals(MCP_VERSION, '2.44.0');
  const t = TOOL_MAP.get('aceleriq_meta_conexoes_estado')!;
  assert(t, 'existe');
  assertEquals([...t.scopes], ['admin']);
  assertEquals(t.annotations?.readOnlyHint, true);
  assertEquals(t.annotations?.destructiveHint, false);
  assertEquals(t.cacheSeg, undefined, 'sem cache: estado fresco');
  assertEquals(t.prazoMs, 45_000);
  assert(!canInvoke({ ...admin, scopes: ['aceleriq:read', 'aceleriq:write', 'clients:read'] }, t));
  assert(canInvoke(admin, t));
  assert(!canUseToolWithDataScope(negados[1][1], t), 'restrita a cliente não alcança');
  assert(FERRAMENTAS_POR_AREA.metricas.includes('aceleriq_meta_conexoes_estado'));
});

// ─── Classificação da Graph ────────────────────────────────────

const IG = { platform: 'instagram', external_id: '17841' };
const FB = { platform: 'facebook', external_id: '555' };
const cl = (r: { status: number; corpo: unknown }, alvo = IG) => classificarDebugToken(r, CFG, alvo, AGORA);
const dados = (d: Record<string, unknown>) => ({ status: 200, corpo: { data: d } });

Deno.test('graph: válido = ok; validade, expiração, revogação e app/página diferentes', () => {
  const ok = cl(valido());
  assertEquals([ok.estado, ok.motivo, ok.valido], ['ok', 'token_valido', true]);
  assertEquals(ok.expira_em, null, 'expires_at 0 = sem prazo');
  assertEquals(ok.acesso_aos_dados_expira_em, new Date(EM(60) * 1000).toISOString());
  assertEquals(cl(valido({ expires_at: EM(-1) })).estado, 'venceu', 'is_valid true com prazo passado');
  assertEquals(cl(valido({ data_access_expires_at: EM(-2) })).estado, 'venceu', 'acesso aos dados vencido');
  assertEquals(cl(dados({ is_valid: false, app_id: '1111', error: { code: 190, subcode: 463 } })).estado, 'venceu');
  assertEquals(cl(dados({ is_valid: false, app_id: '1111', expires_at: EM(-3) })).estado, 'venceu');
  const revogado = cl(dados({ is_valid: false, app_id: '1111', error: { code: 190, subcode: 460, message: 'senha trocada' } }));
  assertEquals([revogado.estado, revogado.motivo, revogado.codigo_da_meta, revogado.subcodigo_da_meta], ['caiu', 'token_invalido_ou_revogado', 190, 460]);
  assertEquals(cl(dados({ is_valid: false })).estado, 'caiu');
  assertEquals(cl(valido({ app_id: '9999' })).motivo, 'token_de_outro_app');
  assertEquals(cl(valido({ app_id: '9999' })).estado, 'nao_verificado');
  assertEquals(cl(valido({ profile_id: '777' }), FB).motivo, 'credencial_nao_corresponde');
  assertEquals(cl(valido({ profile_id: '555' }), FB).estado, 'ok');
  assertEquals(cl(valido({ profile_id: '777' })).estado, 'ok', 'no Instagram o profile_id é a página: não confere');
});

Deno.test('graph: resposta incoerente, app ausente, prazo malformado e is_valid:false transitório = nao_verificado', () => {
  for (const d of [{}, { is_valid: 'true', app_id: '1111' }, { is_valid: 1, app_id: '1111' }, { is_valid: null }]) {
    assertEquals(cl(dados(d)).motivo, 'resposta_inconsistente', JSON.stringify(d));
  }
  assertEquals(cl(dados({ is_valid: true })).motivo, 'resposta_inconsistente', 'válido sem app_id');
  assertEquals(cl(dados({ is_valid: true, app_id: 'abc' })).motivo, 'resposta_inconsistente');
  assertEquals(cl(valido({ error: { code: 190 } })).motivo, 'resposta_inconsistente', 'válido com erro');
  for (const p of ['abc', -5, 1.5, true, {}, '9999999999999999']) {
    const r = cl(valido({ expires_at: p }));
    assertEquals([r.estado, r.motivo], ['nao_verificado', 'prazo_malformado'], JSON.stringify(p));
    assertEquals(cl(dados({ is_valid: false, data_access_expires_at: p })).estado, 'nao_verificado', `inválido com prazo ${JSON.stringify(p)}`);
  }
  for (const codigo of [1, 2, 4, 17, 32, 613]) {
    const r = cl(dados({ is_valid: false, app_id: '1111', expires_at: EM(-1), error: { code: codigo } }));
    assertEquals([r.estado, r.transitorio], ['nao_verificado', true], `is_valid:false com erro ${codigo} segue inconclusivo`);
  }
  assertEquals(lerPrazo(undefined), { ok: true, iso: null });
  assertEquals(lerPrazo(0), { ok: true, iso: null });
  assertEquals(lerPrazo('x'), { ok: false });
});

Deno.test('graph: erro HTTP externo não prova nada sobre o token (nunca caiu/venceu)', () => {
  const c = (status: number, corpo: unknown) => cl({ status, corpo });
  const app = c(400, { error: { code: 190, message: 'Invalid OAuth access token', error_subcode: 463 } });
  assertEquals([app.estado, app.motivo, app.transitorio, app.codigo_da_meta], ['nao_verificado', 'consulta_nao_aceita', false, 190]);
  assertEquals([c(500, { error: { code: 2 } }).estado, c(500, {}).transitorio], ['nao_verificado', true]);
  assertEquals(c(400, { error: { code: 17 } }).transitorio, true, 'limite de chamadas');
  assertEquals(c(403, { error: { code: '200' } }).codigo_da_meta, null, 'código não numérico não sai');
  assertEquals(c(200, 'nao-json').estado, 'nao_verificado');
  assertEquals(c(200, { data: null }).motivo, 'resposta_inconsistente');
});

Deno.test('graph: projeção só com estado, motivo, validade, prazos e códigos', () => {
  const r = cl(dados({ is_valid: false, app_id: '1111', type: 'PAGE', scopes: ['x'], user_id: '42', error: { code: 190, subcode: 460, message: 'cru' }, metadata: { a: 1 } }));
  const permitidas = new Set(['estado', 'motivo', 'transitorio', 'valido', 'expira_em', 'acesso_aos_dados_expira_em', 'codigo_da_meta', 'subcodigo_da_meta']);
  for (const k of Object.keys(r)) assert(permitidas.has(k), `campo ${k} não pode sair`);
  assert(!JSON.stringify(r).includes('cru'));
});

Deno.test('graph: host fixo, Bearer do app, appsecret_proof HMAC, input_token só no parâmetro, redirect error, no-store', async () => {
  const g = graphFalsa(() => valido());
  await debugToken(CFG, TOKEN(1), IG, g.buscar, AGORA);
  const [p] = g.pedidos;
  assertEquals(p.url.origin, 'https://graph.facebook.com');
  assertEquals(p.url.pathname, '/v26.0/debug_token');
  assertEquals([...p.url.searchParams.keys()].sort(), ['appsecret_proof', 'input_token']);
  assertEquals(p.url.searchParams.get('input_token'), TOKEN(1));
  assertEquals(p.url.searchParams.get('appsecret_proof'), await provaDoSegredo(`${CFG.appId}|${CFG.appSecret}`, CFG.appSecret));
  assertEquals([p.init.method, p.init.redirect, p.init.cache], ['GET', 'error', 'no-store']);
  assert(p.init.signal instanceof AbortSignal);
  assertEquals((p.init.headers as Record<string, string>).Authorization, `Bearer ${CFG.appId}|${CFG.appSecret}`);
  assert(!p.url.toString().includes(CFG.appSecret), 'segredo do app fora da URL');
});

Deno.test('graph: tempo esgotado, rede fora, redirect e resposta grande viram nao_verificado', async () => {
  const pendurada = graphFalsa(() => 'pendurar');
  const t = await debugToken(CFG, TOKEN(1), IG, pendurada.buscar, AGORA, 20);
  assertEquals([t.estado, t.motivo, t.transitorio], ['nao_verificado', 'tempo_esgotado', true]);
  assert(pendurada.pedidos[0].init.signal!.aborted, 'pedido abortado, nada pendurado');
  const fora = await debugToken(CFG, TOKEN(1), IG, () => Promise.reject(new TypeError('redirect')), AGORA);
  assertEquals([fora.estado, fora.motivo, fora.transitorio], ['nao_verificado', 'meta_indisponivel', true]);
  let sinal: AbortSignal | undefined;
  const redirect = await debugToken(CFG, TOKEN(1), IG, (_u, init) => {
    sinal = init.signal ?? undefined;
    return Promise.resolve(new Response(null, { status: 302, headers: { Location: 'https://evil.example' } }));
  }, AGORA);
  assertEquals([redirect.estado, redirect.motivo], ['nao_verificado', 'redirect_recusado']);
  assert(sinal?.aborted, 'redirect manual é abortado');
  const grande = await debugToken(CFG, TOKEN(1), IG, () => Promise.resolve(new Response('x'.repeat(70 * 1024))), AGORA);
  assertEquals(grande.motivo, 'resposta_grande_demais');
});

Deno.test('config: sem app, sem segredo ou versão inválida = sem configuração', () => {
  const env = (m: Record<string, string>) => (k: string) => m[k];
  assertEquals(configDaMeta(env({})), null);
  assertEquals(configDaMeta(env({ META_APP_ID: '1', META_APP_SECRET: '' })), null);
  assertEquals(configDaMeta(env({ META_APP_ID: '1', META_APP_SECRET: 's', META_GRAPH_VERSION: '../evil' })), null);
  assertEquals(configDaMeta(env({ META_APP_ID: '1', META_APP_SECRET: 's' }))?.graphVersion, 'v26.0');
});

// ─── Status manual (banco decide antes da Graph) ──────────────

Deno.test('status manual: registro sem id, concessão revogada/expirada, conexão e prazo do painel decidem sem Graph', () => {
  const s = (extra: Partial<ContaMeta>) => estadoPeloBanco(conta(1, 1, extra), AGORA);
  assertEquals(s({ external_id: null }), { estado: 'sem_conexao', motivo: 'registro_manual_sem_id_da_meta' });
  assertEquals(s({ external_id: '@perfil' })?.motivo, 'registro_manual_sem_id_da_meta');
  assertEquals(s({ concessao: null }), { estado: 'sem_conexao', motivo: 'sem_concessao' });
  assertEquals(s({ concessao: { status: 'revoked' } })?.estado, 'caiu');
  assertEquals(s({ concessao: { status: 'superseded' } })?.motivo, 'concessao_superseded');
  assertEquals(s({ concessao: { status: 'expired' } })?.estado, 'venceu');
  assertEquals(s({ connection_status: 'expired' })?.estado, 'venceu');
  assertEquals(s({ connection_status: 'reauth_required' })?.estado, 'caiu');
  assertEquals(s({ expires_at: '2026-11-01T00:00:00Z' })?.estado, 'venceu');
  assertEquals(s({ concessao: { status: 'active', data_access_expires_at: '2026-11-25T11:59:59Z' } })?.estado, 'venceu');
  assertEquals(s({}), null, 'ativa e no prazo: decide ao vivo');
});

Deno.test('status manual: verificar_ao_vivo=false, Meta sem configuração e RPC ausente = nao_verificado sem Graph', async () => {
  const contas = [conta(1, 1), conta(2, 1, { platform: 'facebook', external_id: '555', concessao: { id: GRANT(2), status: 'revoked' } })];
  const g = graphFalsa(() => valido());
  const desligado = await metaConexoesEstado({ verificar_ao_vivo: false }, admin, deps(fakes([{ id: CLI(1), nome: 'A' }], contas), g.buscar));
  const itens = (desligado.clientes as any[])[0].contas;
  assertEquals(itens.map((i: any) => [i.plataforma, i.estado, i.motivo]), [['instagram', 'nao_verificado', 'verificacao_desligada'], ['facebook', 'caiu', 'concessao_revoked']]);
  const semCfg = fakes([{ id: CLI(1), nome: 'A' }], contas, { [CONTA(1)]: { tipo: 'token', token: TOKEN(1) } });
  const r = await metaConexoesEstado({}, admin, deps(semCfg, g.buscar, null));
  assertEquals((r.clientes as any[])[0].contas[0].motivo, 'meta_nao_configurada');
  assertEquals(semCfg.chamadas.tokens, [], 'sem config nem lê o token');
  const semRpc = fakes([{ id: CLI(1), nome: 'A' }], contas, { [CONTA(1)]: { tipo: 'rpc_ausente' } });
  const r2 = await metaConexoesEstado({}, admin, deps(semRpc, g.buscar));
  assertEquals((r2.clientes as any[])[0].contas[0].motivo, 'leitura_do_token_nao_instalada');
  assert((r2.avisos as string[]).some((a) => a.includes('20261125211700')));
  assertEquals(g.pedidos.length, 0);
  const semContas = fakes([{ id: CLI(1), nome: 'A' }], null);
  const e = await assertRejects(() => metaConexoesEstado({}, admin, deps(semContas, g.buscar)), ErroDaFerramenta);
  assertEquals((e as ErroDaFerramenta).codigo, 'migration_ausente');
});

// ─── Matching ──────────────────────────────────────────────────

Deno.test('matching: só contas do próprio cliente e IG/FB; sem vínculo vira sem_conexao; RPC com conta, concessão, ficha, plataforma e recurso', async () => {
  const contas = [
    conta(1, 1),
    conta(2, 2, { platform: 'facebook', external_id: '555' }), // outro cliente
    conta(3, 1, { platform: 'meta_ads', external_id: '123' }), // Ads: fora
  ];
  const f = fakes([{ id: CLI(1), nome: 'A' }, { id: CLI(2), nome: 'B' }, { id: CLI(3), nome: 'Sem contas' }], contas, {
    [CONTA(1)]: { tipo: 'token', token: TOKEN(1) },
  });
  const g = graphFalsa((tk) => (tk === TOKEN(1) ? valido() : { status: 500, corpo: {} }));
  const r = await metaConexoesEstado({}, admin, deps(f, g.buscar));
  const [a, b, c] = r.clientes as any[];
  assertEquals(a.contas.map((i: any) => [i.plataforma, i.external_account_id, i.estado]), [['instagram', CONTA(1), 'ok'], ['facebook', null, 'sem_conexao']]);
  assertEquals(a.contas[0].origem_da_concessao, 'oauth_usuario');
  assertEquals(a.contas[0].perfil, '@perfil1');
  // Concessão ativa no painel e RPC estrita vazia: credencial trocada/sumida, não "sem conexão".
  assertEquals(b.contas.map((i: any) => [i.plataforma, i.estado, i.motivo]), [['instagram', 'sem_conexao', 'sem_conta_ativa'], ['facebook', 'nao_verificado', 'credencial_nao_localizada_ou_trocada']]);
  assertEquals(c.contas.map((i: any) => i.estado), ['sem_conexao', 'sem_conexao']);
  const pedidos = f.chamadas.tokens.sort((x, y) => x.externalAccountId.localeCompare(y.externalAccountId));
  assertEquals(pedidos, [
    { externalAccountId: CONTA(1), grantId: GRANT(1), clientId: CLI(1), platform: 'instagram', providerResourceId: '17841' },
    { externalAccountId: CONTA(2), grantId: GRANT(2), clientId: CLI(2), platform: 'facebook', providerResourceId: '555' },
  ], 'nunca pede token de Ads ou de outra conta');
  assertEquals(g.pedidos.length, 1);
  assertEquals(r.resumo, { ok: 1, venceu: 0, caiu: 0, sem_conexao: 4, nao_verificado: 1 });
});

Deno.test('matching: concessão sem UUID não chama a RPC (nao_verificado)', async () => {
  const f = fakes([{ id: CLI(1), nome: 'A' }], [conta(1, 1, { concessao: { status: 'active' } })]);
  const r = await metaConexoesEstado({}, admin, deps(f, graphFalsa(() => valido()).buscar));
  assertEquals((r.clientes as any[])[0].contas[0].motivo, 'credencial_nao_localizada_ou_trocada');
  assertEquals(f.chamadas.tokens.length, 0);
});

Deno.test('registros manuais, @ por URL, domínio externo e duplicatas ficam na lista sem inventar dado', async () => {
  const contas = [
    conta(1, 1, { external_id: null, handle: '@manual', concessao: null }),
    conta(2, 1, { external_id: null, handle: 'https://www.instagram.com/via.url/', concessao: null }),
    conta(3, 1, { external_id: null, handle: 'https://evil.example/perfil', display_name: null, concessao: null }),
    conta(4, 1, { external_id: '999', handle: 'dup' }),
    conta(5, 1, { external_id: '999', handle: 'dup' }),
    conta(6, 1, { platform: 'facebook', external_id: null, handle: null, display_name: 'Página Manual', concessao: null }),
  ];
  const f = fakes([{ id: CLI(1), nome: 'A' }], contas);
  const r = await metaConexoesEstado({ verificar_ao_vivo: false }, admin, deps(f, graphFalsa(() => valido()).buscar));
  const itens = (r.clientes as any[])[0].contas;
  assertEquals(itens.length, 6, 'nenhuma conta some');
  const por = (id: string) => itens.find((i: any) => i.external_account_id === id);
  assertEquals([por(CONTA(1)).perfil, por(CONTA(1)).estado, por(CONTA(1)).motivo], ['@manual', 'sem_conexao', 'registro_manual_sem_id_da_meta']);
  assertEquals(por(CONTA(2)).perfil, '@via.url');
  assertEquals([por(CONTA(3)).perfil, por(CONTA(3)).handle_recusado], [null, true]);
  assert(!JSON.stringify(itens).includes('evil.example'));
  assertEquals([por(CONTA(4)).duplicada, por(CONTA(5)).duplicada], [true, true]);
  assertEquals(por(CONTA(1)).duplicada, undefined);
  assertEquals([por(CONTA(6)).perfil, por(CONTA(6)).estado], ['Página Manual', 'sem_conexao']);
  assertEquals(f.chamadas.tokens.length, 0);
});

Deno.test('handle do Instagram: normaliza @ e URL do instagram.com; recusa domínio externo e formato estranho', () => {
  assertEquals(handleDoInstagram('perfil'), '@perfil');
  assertEquals(handleDoInstagram('@perfil.loja_1'), '@perfil.loja_1');
  assertEquals(handleDoInstagram('https://instagram.com/perfil'), '@perfil');
  assertEquals(handleDoInstagram('instagram.com/perfil/?hl=pt'), '@perfil');
  assertEquals(handleDoInstagram('http://m.instagram.com/perfil/'), '@perfil');
  for (const v of ['https://instagram.com.evil.example/perfil', 'https://evil.example/instagram.com/perfil', 'javascript:alert(1)',
    'https://instagram.com/p/abc', 'https://u:p@instagram.com/perfil', 'https://instagram.com:8443/perfil', 'nome com espaço', '', null, 42]) {
    assertEquals(handleDoInstagram(v), null, String(v));
  }
});

Deno.test('mais de 10 contas por plataforma: nenhuma descartada; acima do limite de testes vira parcial explícito', async () => {
  const contas = Array.from({ length: 45 }, (_, i) => conta(i + 1, 1));
  const tokens = Object.fromEntries(contas.map((c, i) => [c.external_account_id, { tipo: 'token', token: TOKEN(i + 1) } as TokenDaConta]));
  const f = fakes([{ id: CLI(1), nome: 'A' }], contas, tokens);
  const r = await metaConexoesEstado({}, admin, deps(f, graphFalsa(() => valido()).buscar));
  const itens = (r.clientes as any[])[0].contas;
  assertEquals(itens.filter((i: any) => i.plataforma === 'instagram').length, 45);
  assertEquals(itens.filter((i: any) => i.motivo === 'limite_de_verificacoes').length, 5);
  assertEquals(r.parcial, true);
});

Deno.test('expiração: menor entre token e acesso aos dados, do painel e do debug_token; origem do grant', async () => {
  const contas = [conta(1, 1, {
    data_access_expires_at: '2027-03-01T00:00:00Z',
    concessao: { id: GRANT(1), origem: 'usuario_do_sistema', status: 'active', access_token_expires_at: null, data_access_expires_at: '2027-02-01T00:00:00Z' },
  })];
  const f = fakes([{ id: CLI(1), nome: 'A' }], contas, { [CONTA(1)]: { tipo: 'token', token: TOKEN(1) } });
  const g = graphFalsa(() => valido({ expires_at: EM(10), data_access_expires_at: EM(90) }));
  const r = await metaConexoesEstado({}, admin, deps(f, g.buscar));
  const i = (r.clientes as any[])[0].contas[0];
  assertEquals(i.origem_da_concessao, 'usuario_do_sistema');
  assertEquals(i.expiracao.token_em, new Date(EM(10) * 1000).toISOString());
  assertEquals(i.expiracao.acesso_aos_dados_em, '2027-02-01T00:00:00.000Z');
  assertEquals(i.expiracao.menor_em, new Date(EM(10) * 1000).toISOString());
  assertEquals(i.expiracao.fonte, 'painel_e_graph');
});

// ─── Prazo total ───────────────────────────────────────────────

Deno.test('prazo total: Graph lenta aborta, contas sem tempo saem explícitas e nada fica pendente', async () => {
  const contas = Array.from({ length: 8 }, (_, i) => conta(i + 1, 1));
  const tokens = Object.fromEntries(contas.map((c, i) => [c.external_account_id, { tipo: 'token', token: TOKEN(i + 1) } as TokenDaConta]));
  const f = fakes([{ id: CLI(1), nome: 'A' }], contas, tokens);
  const g = graphFalsa(() => 'pendurar');
  const inicio = Date.now();
  const r = await metaConexoesEstado({}, admin, deps(f, g.buscar, CFG, 50));
  assert(Date.now() - inicio < 2_000, 'respeita o prazo total');
  const itens = (r.clientes as any[])[0].contas.filter((i: any) => i.plataforma === 'instagram');
  assert(itens.every((i: any) => i.estado === 'nao_verificado' && i.motivo === 'sem_tempo'), JSON.stringify(itens.map((i: any) => i.motivo)));
  assertEquals(r.parcial, true);
  assert(g.pedidos.length <= 3, 'não começa tarefa nova depois do prazo');
  assert(g.pedidos.every((p) => p.init.signal!.aborted), 'todo pedido em andamento foi abortado');
});

Deno.test('prazo total: banco lento vira tempo_esgotado transitório, com o sinal propagado', async () => {
  let recebeu: AbortSignal | null = null;
  const porta: PortaMetaConexoes = {
    clientesAtivos: ({ signal }) => {
      recebeu = signal;
      return new Promise((_, rejeitar) => signal.addEventListener('abort', () => rejeitar(new DOMException('abort', 'AbortError'))));
    },
    contas: () => Promise.resolve([]),
    tokenDaConta: () => Promise.resolve({ tipo: 'nao_localizado' }),
  };
  const e = await assertRejects(() => metaConexoesEstado({}, admin, { porta, config: CFG, buscar: fetch, painelOrigem: null, prazoTotalMs: 30 }), ErroDaFerramenta);
  assertEquals([(e as ErroDaFerramenta).codigo, (e as ErroDaFerramenta).transitorio], ['tempo_esgotado', true]);
  assert(recebeu!.aborted);
});

// ─── Saída redigida ────────────────────────────────────────────

Deno.test('saída: nunca traz token, segredo, URL da requisição nem corpo cru da Meta', async () => {
  const contas = [conta(1, 1), conta(2, 1, { platform: 'facebook', external_id: '555' })];
  const f = fakes([{ id: CLI(1), nome: 'A' }], contas, {
    [CONTA(1)]: { tipo: 'token', token: TOKEN(1) },
    [CONTA(2)]: { tipo: 'token', token: TOKEN(2) },
  });
  const g = graphFalsa((tk) => tk === TOKEN(1)
    ? valido({ user_id: '42', metadata: { sso: 'eco' } })
    : { status: 400, corpo: { error: { code: 100, message: `token ${TOKEN(2)} inválido`, fbtrace_id: 'TRACE-CRU' } } });
  const r = await metaConexoesEstado({}, admin, deps(f, g.buscar));
  const saida = JSON.stringify(r);
  for (const proibido of [TOKEN(1), TOKEN(2), CFG.appSecret, 'input_token', 'appsecret_proof', 'graph.facebook.com', 'debug_token?', 'Bearer',
    'TRACE-CRU', 'fbtrace', 'access_token', 'metadata', 'user_id', 'scopes', 'instagram_basic', '"PAGE"', '"tipo"']) {
    assert(!saida.includes(proibido), `saída não pode conter ${proibido}`);
  }
  assertEquals(r.caminho_oficial, 'https://aceleriq.online/config/meta-usuario-do-sistema');
  assert(String(r.leitura).includes('NÃO quer dizer permissão para publicar'));
});

Deno.test('caminho oficial: origem configurada só se https; senão a canônica', () => {
  assertEquals(urlDoPainel('https://preview.aceleriq.online/'), 'https://preview.aceleriq.online/config/meta-usuario-do-sistema');
  assertEquals(urlDoPainel('http://inseguro.example'), 'https://aceleriq.online/config/meta-usuario-do-sistema');
  assertEquals(urlDoPainel('https://u:p@x.example'), 'https://aceleriq.online/config/meta-usuario-do-sistema');
  assertEquals(urlDoPainel('lixo'), 'https://aceleriq.online/config/meta-usuario-do-sistema');
  assertEquals(urlDoPainel(null), 'https://aceleriq.online/config/meta-usuario-do-sistema');
});

// ─── Paginação e entrada ───────────────────────────────────────

Deno.test('paginação: limite baixo, proximo_cursor por cliente e client_id opcional', async () => {
  const clientes = Array.from({ length: 7 }, (_, i) => ({ id: CLI(i + 1), nome: `C${i + 1}` }));
  const f = fakes(clientes, []);
  const g = graphFalsa(() => valido());
  const p1 = await metaConexoesEstado({ limite: 3, verificar_ao_vivo: false }, admin, deps(f, g.buscar));
  assertEquals((p1.clientes as any[]).map((c) => c.client_id), [CLI(1), CLI(2), CLI(3)]);
  assertEquals([p1.proximo_cursor, p1.varredura_completa, p1.parcial], [CLI(3), true, false]);
  const p3 = await metaConexoesEstado({ limite: 3, cursor: CLI(6) }, admin, deps(f, g.buscar));
  assertEquals((p3.clientes as any[]).map((c) => c.client_id), [CLI(7)]);
  assertEquals(p3.proximo_cursor, null);
  const padrao = await metaConexoesEstado({}, admin, deps(f, g.buscar));
  assertEquals((padrao.clientes as any[]).length, 5);
  const um = await metaConexoesEstado({ client_id: CLI(4) }, admin, deps(f, g.buscar));
  assertEquals([(um.clientes as any[]).length, um.proximo_cursor], [1, null]);
  const e = await assertRejects(() => metaConexoesEstado({ client_id: CLI(99) }, admin, deps(f, g.buscar)), ErroDaFerramenta);
  assertEquals((e as ErroDaFerramenta).codigo, 'cliente_nao_encontrado');
});

Deno.test('paginação: varredura que para antes do fim não declara fim e o cursor não perde cliente', async () => {
  const clientes = Array.from({ length: 7 }, (_, i) => ({ id: CLI(i + 1), nome: `C${i + 1}` }));
  const f = fakes(clientes, [], {}, 2); // cada chamada só consegue varrer 2
  const vistos: string[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 10; i++) {
    const r: Record<string, unknown> = await metaConexoesEstado({ limite: 5, verificar_ao_vivo: false, ...(cursor ? { cursor } : {}) }, admin, deps(f, graphFalsa(() => valido()).buscar));
    vistos.push(...(r.clientes as any[]).map((c) => c.client_id));
    if (r.proximo_cursor) assertEquals([r.varredura_completa, r.parcial], [false, true]);
    cursor = r.proximo_cursor as string | null;
    if (!cursor) break;
  }
  assertEquals(vistos, clientes.map((c) => c.id), 'todos os clientes, uma vez, em ordem');
});

Deno.test('entrada: estrita (limite 1..10, UUID, sem campos extras, sem client_id e cursor juntos)', () => {
  const invalida = (v: unknown) => {
    try { validarEntrada(v); } catch (e) { return e instanceof ErroDaFerramenta && e.codigo === 'entrada_invalida'; }
    return false;
  };
  assertEquals(validarEntrada({ limite: '3' }).limite, 3, 'número em texto passa, como no despachante');
  for (const v of [{ limite: 0 }, { limite: 11 }, { limite: 2.5 }, { limite: '3x' }, { limite: '11' }, { client_id: 'x' }, { cursor: 'abc' },
    { client_id: CLI(1), cursor: CLI(2) }, { ad_account_id: 'act_1' }, { verificar_ao_vivo: 'sim' }, [], 'texto']) {
    assert(invalida(v), JSON.stringify(v));
  }
  assertEquals(validarEntrada(undefined), { clientId: null, cursor: null, limite: 5, verificarAoVivo: true });
  assertEquals(validarEntrada({ client_id: CLI(1).toUpperCase(), limite: 10 }).clientId, CLI(1));
});

Deno.test('concorrência: no máximo 3 ao mesmo tempo; sinal abortado não começa tarefa nova', async () => {
  let ativos = 0;
  let pico = 0;
  const feitas: number[] = [];
  const tarefa = (i: number) => async () => {
    ativos++; pico = Math.max(pico, ativos);
    await new Promise((r) => setTimeout(r, 5));
    ativos--;
    feitas.push(i);
  };
  assertEquals(await comConcorrencia(Array.from({ length: 10 }, (_, i) => tarefa(i)), 3), 10);
  assertEquals(feitas.sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert(pico <= 3, `pico ${pico}`);
  const parar = new AbortController();
  parar.abort();
  assertEquals(await comConcorrencia([tarefa(0)], 3, parar.signal), 0);
});
