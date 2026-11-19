// MCP 2.37.0 (19/11/2026): auditoria das assinaturas, sem banco nem rede (porta de memória).
import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { ErroDaFerramenta, explicarErro } from './robustez.ts';
import { esquecerVinculos, prepararAutoria, type VinculoDaChave, vinculosDaChave } from './autoria.ts';
import {
  type AlertaDeAssinatura,
  auditarChamada,
  classificar,
  detectarSuspeitas,
  deveAuditar,
  type LinhaDeAssinatura,
  listarAssinaturas,
  operadorEfetivo,
  type PortaDaAuditoria,
  registrarAssinatura,
  sinaisDaRequisicao,
  type SinaisDaRequisicao,
} from './auditoria-assinaturas.ts';
import { escritorioEntrar, type PortaDoEscritorio } from './escritorio.ts';

const GROK = { keyId: 'grok-1', origin: null, keyName: 'Grok Bot' };
const PRINCIPAL = 'key:grok-1';
const VINCULOS: VinculoDaChave[] = [
  { operator_slug: 'jori', padrao: true },
  { operator_slug: 'trafe', padrao: false },
  { operator_slug: 'orion', padrao: false },
  { operator_slug: 'infra', padrao: false },
];
const CURSOR: SinaisDaRequisicao = { ip: '3.3.3.3', user_agent: 'Cursor/1.0.0', sessao_hash: null, protocolo: '2025-06-18' };

/** Porta de memória com o mesmo agrupamento da RPC (hora, credencial, tipo). */
function memoria(opcoes: { gravarFalha?: boolean; alertarFalha?: boolean } = {}) {
  const linhas: LinhaDeAssinatura[] = [];
  const alertas: AlertaDeAssinatura[] = [];
  const porta: PortaDaAuditoria = {
    gravar(l) {
      if (opcoes.gravarFalha) return Promise.reject(Object.assign(new Error('boom'), { code: '08006' }));
      linhas.push({ ...l });
      return Promise.resolve();
    },
    recentes: (p, desde) => Promise.resolve(linhas.filter((l) => l.principal === p && (l.created_at ?? '') >= desde && l.operador_declarado)),
    alertar(principal, tipo, operadores, amostra) {
      if (opcoes.alertarFalha) return Promise.reject(new Error('rpc'));
      const agora = new Date().toISOString();
      const hora = agora.slice(0, 13) + ':00:00.000Z';
      const a = alertas.find((x) => x.hora === hora && x.principal === principal && x.tipo === tipo);
      if (a) {
        a.contagem++;
        a.ultima_em = agora;
        a.operadores = [...new Set([...a.operadores, ...operadores])].sort();
        a.amostra = amostra;
        return Promise.resolve({ alerta_id: 'a', contagem: a.contagem, novo: false });
      }
      alertas.push({ hora, principal, tipo, operadores: [...operadores], contagem: 1, primeira_em: agora, ultima_em: agora, amostra, status: 'aberto' });
      return Promise.resolve({ alerta_id: 'a', contagem: 1, novo: true });
    },
    registros: (f) => Promise.resolve(linhas.filter((l) => (l.created_at ?? '') >= f.desde).reverse().slice(0, f.limite)),
    alertas: (f) => Promise.resolve(alertas.filter((a) => a.hora >= f.desde && (!f.tipo || a.tipo === f.tipo))),
  };
  return { porta, linhas, alertas };
}

let n = 0;
const correlacao = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

function chamada(m: ReturnType<typeof memoria>, declarado: string | null, sinais: SinaisDaRequisicao = CURSOR, tool = 'aceleriq_escritorio_enviar', vinculos: VinculoDaChave[] | null = VINCULOS) {
  return auditarChamada({ ctx: GROK, toolName: tool, correlationId: correlacao(), declarado, operadorFinal: declarado, vinculos, sinais }, m.porta);
}

// ─── Regras puras ───

Deno.test('classificar: sem operator, ok, fora dos vínculos, tabela ausente e leitura indisponível', () => {
  assertEquals(classificar(VINCULOS, null), 'sem_operator');
  assertEquals(classificar(VINCULOS, ''), 'sem_operator');
  assertEquals(classificar(VINCULOS, 'Trafe'), 'ok');
  assertEquals(classificar(VINCULOS, 'hermes'), 'fora_dos_vinculos');
  assertEquals(classificar([], 'jori'), 'fora_dos_vinculos');
  assertEquals(classificar(null, 'jori'), 'vinculos_nao_instalados');
  assertEquals(classificar('indisponivel', 'jori'), 'vinculos_indisponiveis');
  assertEquals(classificar('indisponivel', null), 'vinculos_indisponiveis');
});

Deno.test('operadorEfetivo: o final se está ligado, senão o padrão; leitura indisponível = ninguém', () => {
  assertEquals(operadorEfetivo(VINCULOS, 'orion'), 'orion');
  assertEquals(operadorEfetivo(VINCULOS, 'hermes'), 'jori');
  assertEquals(operadorEfetivo(VINCULOS, null), 'jori');
  assertEquals(operadorEfetivo(null, 'qualquer'), 'qualquer');
  assertEquals(operadorEfetivo('indisponivel', 'jori'), null);
});

Deno.test('deveAuditar: todo o Escritório (leitura e sem operator) e escrita assinada; leitura comum não', () => {
  assert(deveAuditar('aceleriq_escritorio_caixa', {}, true));
  assert(deveAuditar('aceleriq_escritorio_entrar', { operator: 'trafe' }, true));
  assert(deveAuditar('aceleriq_escritorio_dono', {}, false));
  assert(deveAuditar('aceleriq_create_task', { operator: 'trafe', title: 'x' }, false));
  assert(!deveAuditar('aceleriq_create_task', { title: 'x' }, false), 'escrita sem operator não assina');
  assert(!deveAuditar('aceleriq_list_tasks', { operator: 'trafe' }, true), 'leitura fora do Escritório não entra');
  assert(!deveAuditar('aceleriq_operator_diary', { operator: 'trafe' }, false), 'diário só quando escreve');
  assert(deveAuditar('aceleriq_operator_diary', { operator: 'trafe', body: 'oi' }, false));
});

Deno.test('sinaisDaRequisicao: IP pela ordem, cortes, hash da sessão (nunca o valor cru) e nada do authorization', async () => {
  const sessao = 'sessao-super-secreta-123';
  const req = new Request('https://x.test/mcp', {
    method: 'POST',
    headers: {
      authorization: 'Bearer mcp_live_abcdefghijklmnop',
      'x-forwarded-for': '10.0.0.1, 10.0.0.2',
      'x-real-ip': '10.9.9.9',
      'user-agent': 'U'.repeat(500),
      'mcp-session-id': sessao,
      'mcp-protocol-version': '2025-06-18',
    },
  });
  const s = await sinaisDaRequisicao(req);
  assertEquals(s.ip, '10.0.0.1');
  assertEquals(s.user_agent!.length, 200);
  assertEquals(s.protocolo, '2025-06-18');
  assertEquals(s.sessao_hash!.length, 16);
  assert(/^[0-9a-f]{16}$/.test(s.sessao_hash!));
  const tudo = JSON.stringify(s);
  assert(!tudo.includes(sessao), 'o session id cru não sai');
  assert(!tudo.includes('mcp_live_') && !tudo.includes('Bearer'), 'o authorization não é lido');
  assertEquals(Object.keys(s).sort(), ['ip', 'protocolo', 'sessao_hash', 'user_agent']);

  const cf = await sinaisDaRequisicao(new Request('https://x.test', { headers: { 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' } }));
  assertEquals(cf.ip, '1.1.1.1');
  const real = await sinaisDaRequisicao(new Request('https://x.test', { headers: { 'x-real-ip': '9.9.9.9' } }));
  assertEquals(real.ip, '9.9.9.9');
  const nada = await sinaisDaRequisicao(new Request('https://x.test'));
  assertEquals(nada, { ip: null, user_agent: null, sessao_hash: null, protocolo: null });
  const comprido = await sinaisDaRequisicao(new Request('https://x.test', { headers: { 'x-real-ip': '9'.repeat(200) } }));
  assertEquals(comprido.ip!.length, 80);
});

// ─── Detecção ───

Deno.test('detecção (1): trafe, orion e infra ligados, mesma chave e mesmos sinais: 3 linhas com o operador certo e nenhum alerta', async () => {
  const m = memoria();
  for (const op of ['trafe', 'orion', 'infra']) assertEquals(await chamada(m, op), []);
  assertEquals(m.linhas.map((l) => [l.operador_declarado, l.operador_efetivo, l.decisao]), [
    ['trafe', 'trafe', 'ok'], ['orion', 'orion', 'ok'], ['infra', 'infra', 'ok'],
  ]);
  assert(m.linhas.every((l) => l.principal === PRINCIPAL && l.chave_nome === 'Grok Bot' && l.user_agent === 'Cursor/1.0.0'));
  assertEquals(m.alertas.length, 0);
});

Deno.test('detecção (2): operador fora dos vínculos alerta; 3x na mesma hora = 1 alerta com contagem 3', async () => {
  const m = memoria();
  for (let i = 0; i < 3; i++) {
    const s = await chamada(m, 'hermes');
    assertEquals(s.map((x) => x.tipo), ['fora_dos_vinculos']);
  }
  assertEquals(m.linhas.map((l) => [l.operador_declarado, l.operador_efetivo, l.decisao]), Array(3).fill(['hermes', 'jori', 'fora_dos_vinculos']));
  assertEquals(m.alertas.length, 1);
  assertEquals(m.alertas[0].tipo, 'fora_dos_vinculos');
  assertEquals(m.alertas[0].contagem, 3);
  assertEquals(m.alertas[0].operadores, ['hermes']);
  const a = m.alertas[0].amostra;
  assertEquals(Object.keys(a).sort(), ['correlation_id', 'ip', 'operador_declarado', 'operador_efetivo', 'tool', 'user_agent']);
});

Deno.test('detecção (3): mesmo principal, 2 operadores com user-agents diferentes em 10 min = operadores_com_sinais_diferentes', async () => {
  const m = memoria();
  assertEquals(await chamada(m, 'trafe', CURSOR), []);
  const s = await chamada(m, 'orion', { ...CURSOR, user_agent: 'curl/8.4.0', ip: '4.4.4.4' });
  assertEquals(s.map((x) => x.tipo), ['operadores_com_sinais_diferentes']);
  assertEquals(m.alertas.length, 1);
  assertEquals(m.alertas[0].operadores, ['orion', 'trafe']);
  const amostra = m.alertas[0].amostra as { motivo: string[]; sinais: Record<string, { user_agents: string[] }> };
  assertEquals(amostra.motivo, ['user_agent']);
  assertEquals(amostra.sinais.trafe.user_agents, ['Cursor/1.0.0']);
  assertEquals(amostra.sinais.orion.user_agents, ['curl/8.4.0']);
});

Deno.test('detecção (3b): sessões MCP disjuntas também contam; só os 8 primeiros do hash vão para a amostra', async () => {
  const m = memoria();
  await chamada(m, 'trafe', { ...CURSOR, sessao_hash: 'aaaaaaaaaaaaaaaa' });
  const s = await chamada(m, 'orion', { ...CURSOR, sessao_hash: 'bbbbbbbbbbbbbbbb' });
  assertEquals(s.map((x) => x.tipo), ['operadores_com_sinais_diferentes']);
  const amostra = s[0].amostra as { motivo: string[]; sinais: Record<string, { sessoes: string[] }> };
  assertEquals(amostra.motivo, ['sessao']);
  assertEquals(amostra.sinais.trafe.sessoes, ['aaaaaaaa']);
  assert(!JSON.stringify(amostra).includes('aaaaaaaaaaaaaaaa'));
});

Deno.test('detecção (4): mesmos sinais (chave compartilhada) não alerta, nem com IP rotativo; fora da janela de 10 min não conta', async () => {
  const m = memoria();
  await chamada(m, 'trafe', { ...CURSOR, ip: '3.3.3.3', sessao_hash: 'cccccccccccccccc' });
  await chamada(m, 'orion', { ...CURSOR, ip: '5.5.5.5', sessao_hash: 'cccccccccccccccc' });
  await chamada(m, 'infra', { ...CURSOR, ip: '6.6.6.6' });
  assertEquals(m.alertas.length, 0);

  // Pura: a linha antiga (11 min) já saiu da janela que a porta devolve.
  const atual: LinhaDeAssinatura = { principal: PRINCIPAL, chave_nome: null, tool_name: 't', correlation_id: 'x', operador_declarado: 'orion', operador_efetivo: 'orion', decisao: 'ok', ip: null, user_agent: 'curl/8', sessao_hash: null, protocolo: null };
  assertEquals(detectarSuspeitas(atual, []), [], 'só um operador na janela');
  const outraCredencial = { ...atual, principal: 'key:outra', operador_declarado: 'trafe', user_agent: 'Cursor/1.0.0', correlation_id: 'y' };
  assertEquals(detectarSuspeitas(atual, [outraCredencial]), [], 'outra credencial não conta');
});

Deno.test('detecção (5): falha na gravação do log (e no alerta) não derruba; a detecção ainda roda', async () => {
  const m = memoria({ gravarFalha: true, alertarFalha: true });
  const s = await chamada(m, 'hermes');
  assertEquals(s.map((x) => x.tipo), ['fora_dos_vinculos']);
  assertEquals(m.linhas.length, 0);
  // Porta que lança em tudo, até de forma síncrona: registrarAssinatura não lança.
  const quebrada = new Proxy({}, { get: () => () => { throw new Error('tudo quebrado'); } }) as PortaDaAuditoria;
  assertEquals(await registrarAssinatura({ ctx: GROK, toolName: 'x', correlationId: null, declarado: 'trafe', efetivo: 'trafe', decisao: 'ok' }, quebrada), []);
  const s2 = await auditarChamada({ ctx: GROK, toolName: 'x', correlationId: 'c', declarado: 'trafe', operadorFinal: 'trafe' }, quebrada, () => Promise.reject(new Error('x')));
  assertEquals(s2.map((x) => x.tipo), ['vinculos_indisponiveis'], 'detecta mesmo sem conseguir gravar nada');
});

Deno.test('initialize: grava o cliente e o protocolo, sem detecção', async () => {
  const m = memoria();
  const s = await registrarAssinatura({ ctx: GROK, toolName: 'initialize', correlationId: null, declarado: null, efetivo: null, decisao: 'initialize', sinais: CURSOR, clienteInfo: 'Cursor/1.0.0' + 'x'.repeat(300) }, m.porta);
  assertEquals(s, []);
  assertEquals(m.linhas[0].decisao, 'initialize');
  assertEquals(m.linhas[0].cliente_info!.length, 120);
});

// ─── (6) Falha aberta fechada ───

function bancoFalso(resposta: { data?: unknown; error?: { code: string } | null }) {
  const q = { select: () => q, eq: () => q, limit: () => Promise.resolve({ data: resposta.data ?? null, error: resposta.error ?? null }) };
  return { from: () => q } as unknown as Parameters<typeof vinculosDaChave>[1];
}

Deno.test('(6) leitura dos vínculos falhando: lança vinculos_indisponiveis transitório, sem cache; tabela ausente continua livre', async () => {
  esquecerVinculos();
  const p = 'key:falha-1';
  const erro = await assertRejects(() => vinculosDaChave(p, bancoFalso({ error: { code: '08006' } })), ErroDaFerramenta);
  assertEquals(erro.codigo, 'vinculos_indisponiveis');
  assertEquals(erro.transitorio, true);
  assertEquals(explicarErro(erro, 'x').transitorio, true);
  // A falha não ficou no cache: a próxima leitura vai ao banco e acerta.
  assertEquals(await vinculosDaChave(p, bancoFalso({ data: [{ operator_slug: 'Trafe', padrao: true }] })), [{ operator_slug: 'trafe', padrao: true }]);

  esquecerVinculos();
  assertEquals(await vinculosDaChave('key:sem-tabela', bancoFalso({ error: { code: '42P01' } })), null);
  assertEquals(await vinculosDaChave('key:sem-tabela-2', bancoFalso({ error: { code: 'PGRST205' } })), null);
  esquecerVinculos();
});

Deno.test('(6) prepararAutoria com a leitura falhando: transitorio:true e NÃO libera o operador pedido', async () => {
  const tool = { name: 'aceleriq_create_task', annotations: { readOnlyHint: false } };
  const args = { operator: 'hermes', title: 'x' };
  const falha = () => Promise.reject(new ErroDaFerramenta('vinculos_indisponiveis', 'Não deu para conferir a quem esta credencial pertence agora.', 'Tente de novo em instantes.', true));
  const a = await prepararAutoria(tool, args, GROK, falha);
  assertEquals(a.transitorio, true);
  assert(a.erro && /conferir a quem/.test(a.erro));
  assertEquals(a.vinculos, 'indisponivel');
  assertEquals(a.args, args, 'os args voltam como vieram, e o index para antes de executar');
  // Tabela ausente (null) continua livre: segue com o operador pedido, sem erro.
  const livre = await prepararAutoria(tool, args, GROK, () => Promise.resolve(null));
  assertEquals(livre.erro, undefined);
  assertEquals(livre.transitorio, undefined);
  assertEquals((livre.args as { operator: string }).operator, 'hermes');
  // Qualquer outra exceção na leitura (rede, por exemplo) também recusa com transitorio:true e não libera.
  const rede = await prepararAutoria(tool, args, GROK, () => Promise.reject(new Error('rede caiu')));
  assertEquals(rede.transitorio, true);
  assertEquals(rede.vinculos, 'indisponivel');
  assert(rede.erro && !/rede caiu/.test(rede.erro), 'a mensagem interna não vaza');
});

Deno.test('(6) na auditoria, a leitura indisponível vira decisao vinculos_indisponiveis e gera alerta', async () => {
  const m = memoria();
  const s = await auditarChamada({ ctx: GROK, toolName: 'aceleriq_create_task', correlationId: correlacao(), declarado: 'trafe', operadorFinal: 'trafe', vinculos: 'indisponivel', sinais: CURSOR }, m.porta);
  assertEquals(s.map((x) => x.tipo), ['vinculos_indisponiveis']);
  assertEquals(m.linhas[0].decisao, 'vinculos_indisponiveis');
  assertEquals(m.linhas[0].operador_efetivo, null);
  // Sem os vínculos em mãos, ela mesma lê; se a leitura falhar, é o mesmo caso.
  const s2 = await auditarChamada({ ctx: GROK, toolName: 'aceleriq_escritorio_caixa', correlationId: correlacao(), declarado: null, operadorFinal: null, sinais: CURSOR }, m.porta, () => Promise.reject(new Error('x')));
  assertEquals(s2.map((x) => x.tipo), ['vinculos_indisponiveis']);
  assertEquals(m.alertas.length, 1);
  assertEquals(m.alertas[0].contagem, 2);
});

Deno.test('(6) Escritório: porta.vinculos falhando vira erro de ferramenta transitório', async () => {
  const falha = () => Promise.reject(new ErroDaFerramenta('vinculos_indisponiveis', 'Não deu para conferir a quem esta credencial pertence agora.', 'Tente de novo em instantes.', true));
  // O resto da porta responde vazio: o que importa é a leitura dos vínculos.
  const porta = new Proxy({}, { get: (_, k) => (k === 'vinculos' ? falha : () => Promise.resolve([])) }) as PortaDoEscritorio;
  const ctx = { keyId: 'grok-1', keyName: 'Grok Bot', scopes: ['aceleriq:read'], origin: null, dataScope: { unrestricted: true, clientIds: [], principalUserId: null, source: 'test' } } as unknown as AuthContext;
  const e = await assertRejects(() => escritorioEntrar({ operator: 'trafe' }, ctx, porta), ErroDaFerramenta);
  assertEquals(e.codigo, 'vinculos_indisponiveis');
  const explicado = explicarErro(e, 'aceleriq_escritorio_entrar');
  assertEquals(explicado.transitorio, true);
  assertEquals(explicado.codigo, 'vinculos_indisponiveis');
});

// ─── Leitura ───

Deno.test('listarAssinaturas: alertas, resumo por credencial e últimos; sessão só com 8 caracteres; so_alertas omite os últimos', async () => {
  const m = memoria();
  await chamada(m, 'trafe', { ...CURSOR, sessao_hash: 'dddddddddddddddd' });
  await chamada(m, 'hermes', { ...CURSOR, ip: '7.7.7.7', sessao_hash: 'dddddddddddddddd' });
  const out = await listarAssinaturas({}, m.porta);
  assertEquals(out.janela_horas, 24);
  assertEquals(out.alertas.map((a) => a.tipo), ['fora_dos_vinculos']);
  assertEquals(out.alertas[0].chave, 'Grok Bot');
  assertEquals(out.resumo_por_credencial.length, 1);
  const r = out.resumo_por_credencial[0];
  assertEquals(r.principal, PRINCIPAL);
  assertEquals(r.ips_distintos, 2);
  assertEquals(r.user_agents, ['Cursor/1.0.0']);
  assertEquals(r.operadores.find((o) => o.operador === 'hermes')!.fora_dos_vinculos, 1);
  assertEquals(out.ultimos!.length, 2);
  assert(out.ultimos!.every((u) => u.sessao === 'dddddddd'));
  assert(!JSON.stringify(out).includes('dddddddddddddddd'), 'hash cheio não sai');
  assert(out.leitura.startsWith('Só leitura.'));
  const so = await listarAssinaturas({ so_alertas: true, horas: 1, limite: 5 }, m.porta);
  assertEquals('ultimos' in so, false);
  await assertRejects(() => listarAssinaturas({ horas: 500 }, m.porta), ErroDaFerramenta);
  await assertRejects(() => listarAssinaturas({ operador: 'a,b.eq.x' }, m.porta), ErroDaFerramenta);
  await assertRejects(() => listarAssinaturas({ tipo: 'outro' }, m.porta), ErroDaFerramenta);
});
