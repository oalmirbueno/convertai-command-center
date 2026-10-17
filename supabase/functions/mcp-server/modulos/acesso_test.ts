// Pedidos de acesso (MCP 2.13.0): regras do módulo sem banco. A porta falsa imita o que o banco faz
// (inclusive pedido_acesso_retirar_codigo: entrega uma vez, apaga e marca usado).
import { assert, assertEquals, assertRejects, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { buildAuditInput, sanitizeAuditInput } from '../../_shared/mcp-security.ts';
import {
  acessoEstado,
  acessoPedir,
  acessoUsar,
  type ItemDoCofre,
  type NovoPedido,
  type PedidoLido,
  type PortaDoAcesso,
} from './acesso.ts';
import { ehMetaOuGoogle, hostDe, itemCombina, lerPrint, RECUSA_META_GOOGLE } from './acesso-regras.ts';

const CLIENTE = '11111111-1111-4111-8111-111111111111';
const ITEM = '22222222-2222-4222-8222-222222222222';
const PEDIDO = '33333333-3333-4333-8333-333333333333';
const SENHA = 'S3nh@-Secreta-987';

type ItemComSenha = ItemDoCofre & { password: string | null };
type PedidoComCodigo = PedidoLido & { codigo?: string | null };

function ctx(): AuthContext {
  return {
    keyId: 'key-teste',
    keyName: 'teste',
    scopes: ['aceleriq:write'],
    origin: null,
    dataScope: { unrestricted: true, clientIds: [], principalUserId: null, source: 'api_key' },
    resultRefHolder: {},
  };
}

function pedido(parcial: Partial<PedidoComCodigo>): PedidoComCodigo {
  return {
    id: PEDIDO,
    created_at: new Date().toISOString(),
    operador_slug: 'hermes',
    client_id: CLIENTE,
    tipo: 'senha',
    site: 'RD Station',
    url: 'https://app.rdstation.com/login',
    status: 'aberto',
    vault_item_id: null,
    expira_em: null,
    codigo: null,
    ...parcial,
  };
}

function porta(inicio: { itens?: ItemComSenha[]; pedidos?: PedidoComCodigo[] } = {}) {
  const itens = new Map((inicio.itens ?? []).map((i) => [i.id, { ...i }]));
  const pedidos = new Map((inicio.pedidos ?? []).map((p) => [p.id, { ...p }]));
  const criados: NovoPedido[] = [];
  const prints: string[] = [];
  const semCodigo = (p: PedidoComCodigo): PedidoLido => {
    const { codigo: _c, ...resto } = p;
    return resto;
  };
  const p: PortaDoAcesso = {
    operadorExiste: (slug) => Promise.resolve(['hermes', 'paperclip'].includes(slug)),
    exigirCliente: () => Promise.resolve(),
    clienteDaTarefa: () => Promise.resolve(null),
    itensDoCofre: (clientId) =>
      Promise.resolve([...itens.values()].filter((i) => i.client_id === clientId).map(({ password: _s, ...i }) => i)),
    item: (id) => {
      const i = itens.get(id);
      if (!i) return Promise.resolve(null);
      const { password: _s, ...semSenha } = i;
      return Promise.resolve(semSenha);
    },
    senhaDoItem: (id) => {
      const i = itens.get(id);
      return Promise.resolve(i ? { username: i.username, password: i.password, url: i.url } : null);
    },
    pedidoAbertoIgual: (operador, tipo, clientId) =>
      Promise.resolve([...pedidos.values()].filter((x) =>
        x.operador_slug === operador && x.tipo === tipo && x.status === 'aberto' && x.client_id === clientId
      ).map(semCodigo)),
    guardarPrint: (caminho) => {
      prints.push(caminho);
      return Promise.resolve(true);
    },
    criarPedido: (linha) => {
      criados.push(linha);
      pedidos.set(linha.id, pedido({ ...linha, status: 'aberto', vault_item_id: null }));
      return Promise.resolve();
    },
    lerPedido: (id) => Promise.resolve(pedidos.has(id) ? semCodigo(pedidos.get(id)!) : null),
    pedidoRespondidoDoItem: (itemId) =>
      Promise.resolve([...pedidos.values()].filter((x) => x.vault_item_id === itemId && x.status === 'respondido').map(semCodigo)[0] ?? null),
    marcarUsado: (id) => {
      const x = pedidos.get(id);
      if (!x || x.status !== 'respondido') return Promise.resolve(false);
      x.status = 'usado';
      return Promise.resolve(true);
    },
    // Igual a public.pedido_acesso_retirar_codigo.
    retirarCodigo: (id, operador) => {
      const x = pedidos.get(id);
      if (!x || x.tipo !== 'codigo' || x.status !== 'respondido' || !x.codigo) return Promise.resolve(null);
      if (x.operador_slug !== operador) return Promise.resolve(null);
      if (x.expira_em && Date.parse(x.expira_em) <= Date.now()) {
        x.codigo = null;
        x.status = 'expirado';
        return Promise.resolve(null);
      }
      const c = x.codigo;
      x.codigo = null;
      x.status = 'usado';
      return Promise.resolve(c);
    },
  };
  return { porta: p, criados, prints, pedidos, itens };
}

function item(parcial: Partial<ItemComSenha>): ItemComSenha {
  return {
    id: ITEM,
    client_id: CLIENTE,
    title: 'RD Station',
    url: 'https://app.rdstation.com/login',
    username: 'contato@cliente.com.br',
    agentes_podem_usar: false,
    password: SENHA,
    ...parcial,
  };
}

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// ─── Regras puras ─────────────────────────────────────────────────────────

Deno.test('acesso: host e Meta/Google se reconhecem pelo endereço e pelo nome', () => {
  assertEquals(hostDe('https://www.App.RDStation.com/login?x=1'), 'app.rdstation.com');
  assertEquals(hostDe(''), '');
  for (const t of ['Instagram', 'Facebook Ads', 'https://business.facebook.com/x', 'Gmail', 'google.com.br', 'https://studio.youtube.com', 'Meta Business']) {
    assert(ehMetaOuGoogle(t), `${t} deveria ser Meta/Google`);
  }
  for (const t of ['RD Station', 'Metalúrgica Silva', 'https://portal.prefeitura.sp.gov.br', 'googleplex-imoveis.com.br']) {
    assert(!ehMetaOuGoogle(t), `${t} não é Meta/Google`);
  }
  assert(itemCombina({ title: 'Outro nome', url: 'https://app.rdstation.com' }, { site: 'RD', url: 'https://www.app.rdstation.com/entrar' }));
  assert(itemCombina({ title: 'RD Station', url: null }, { site: 'rd station' }));
  assert(!itemCombina({ title: 'RD Station', username: 'a@x.com' }, { site: 'RD Station', conta: 'b@x.com' }));
});

Deno.test('acesso: o print aceita só imagem de até 3 MB', () => {
  const ok = lerPrint('data:image/png;base64,' + PNG_1PX);
  assertEquals(ok.mime, 'image/png');
  assertEquals(ok.ext, 'png');
  assertThrows(() => lerPrint(btoa('isto nao e imagem')), Error, 'PNG, JPEG ou WEBP');
  assertThrows(() => lerPrint('A'.repeat(4_300_000)), Error, '3 MB');
});

// ─── aceleriq_acesso_pedir ────────────────────────────────────────────────

Deno.test('pedir: Facebook, Instagram, Meta e Google por senha ou código são recusados', async () => {
  const f = porta();
  for (const entrada of [
    { tipo: 'senha' as const, site: 'Instagram' },
    { tipo: 'codigo' as const, site: 'Gerenciador', url: 'https://business.facebook.com/settings' },
    { tipo: 'senha' as const, site: 'Gmail do cliente' },
  ]) {
    await assertRejects(
      () => acessoPedir({ operator: 'hermes', mensagem: 'Preciso entrar', client_id: CLIENTE, ...entrada }, ctx(), f.porta),
      Error,
      "tipo 'conectar'",
    );
  }
  assertEquals(f.criados.length, 0);
  assert(RECUSA_META_GOOGLE.includes('Composio'));

  // conectar é o caminho certo e abre pedido.
  const r = await acessoPedir({
    operator: 'hermes', tipo: 'conectar', site: 'Instagram', mensagem: 'Conecte o Instagram do cliente',
    client_id: CLIENTE, link_para_conectar: 'https://connect.composio.dev/x',
  }, ctx(), f.porta) as { pedido_id: string; status: string };
  assertEquals(r.status, 'aberto');
  assertEquals(f.criados.length, 1);
});

Deno.test('pedir: acesso já liberado no cofre responde ja_lembrado sem abrir pedido', async () => {
  const f = porta({ itens: [item({ agentes_podem_usar: true })] });
  const r = await acessoPedir({
    operator: 'hermes', tipo: 'senha', site: 'RD', url: 'https://app.rdstation.com/entrar', mensagem: 'Login do RD', client_id: CLIENTE,
  }, ctx(), f.porta) as Record<string, unknown>;
  assertEquals(r.ja_lembrado, true);
  assertEquals(r.vault_item_id, ITEM);
  assertEquals(f.criados.length, 0);
  assert(!JSON.stringify(r).includes(SENHA));

  // Sem liberação, abre pedido normalmente (e com o print no bucket).
  const g = porta({ itens: [item({ agentes_podem_usar: false })] });
  const p = await acessoPedir({
    operator: 'hermes', tipo: 'senha', site: 'RD Station', mensagem: 'Login do RD', client_id: CLIENTE, print_base64: PNG_1PX,
  }, ctx(), g.porta) as { pedido_id: string; print: boolean };
  assertEquals(g.criados.length, 1);
  assertEquals(p.print, true);
  assertEquals(g.criados[0].print_path, `pedidos/${p.pedido_id}.png`);
  assertEquals(g.prints, [`pedidos/${p.pedido_id}.png`]);

  // O agente repetindo o mesmo pedido não gera outro aviso.
  const de_novo = await acessoPedir({
    operator: 'hermes', tipo: 'senha', site: 'rd station', mensagem: 'Login do RD', client_id: CLIENTE,
  }, ctx(), g.porta) as { pedido_id: string; repetido?: boolean };
  assertEquals(de_novo.repetido, true);
  assertEquals(de_novo.pedido_id, p.pedido_id);
  assertEquals(g.criados.length, 1);
});

Deno.test('pedir: operador desconhecido é recusado', async () => {
  const f = porta();
  await assertRejects(
    () => acessoPedir({ operator: 'fantasma', tipo: 'outro', site: 'Portal', mensagem: 'Preciso de ajuda' }, ctx(), f.porta),
    Error,
    'aceleriq_operator_register',
  );
});

// ─── aceleriq_acesso_estado ───────────────────────────────────────────────

Deno.test('estado: o código é entregue uma vez só e some', async () => {
  const daqui10 = new Date(Date.now() + 10 * 60_000).toISOString();
  const f = porta({ pedidos: [pedido({ tipo: 'codigo', status: 'respondido', codigo: '482913', expira_em: daqui10 })] });

  const primeira = await acessoEstado({ operator: 'hermes', pedido_id: PEDIDO }, ctx(), f.porta) as Record<string, unknown>;
  assertEquals(primeira.codigo, '482913');
  assertEquals(primeira.status, 'usado');

  const segunda = await acessoEstado({ operator: 'hermes', pedido_id: PEDIDO }, ctx(), f.porta) as Record<string, unknown>;
  assertEquals(segunda.codigo, undefined);
  assertEquals(segunda.status, 'usado');
  assertEquals(f.pedidos.get(PEDIDO)!.codigo, null);
});

Deno.test('estado: código vencido não sai e o pedido expira; outro agente não lê', async () => {
  const passou = new Date(Date.now() - 60_000).toISOString();
  const f = porta({ pedidos: [pedido({ tipo: 'codigo', status: 'respondido', codigo: '111222', expira_em: passou })] });
  const r = await acessoEstado({ operator: 'hermes', pedido_id: PEDIDO }, ctx(), f.porta) as Record<string, unknown>;
  assertEquals(r.codigo, undefined);
  assertEquals(r.status, 'expirado');

  const g = porta({ pedidos: [pedido({ tipo: 'codigo', status: 'respondido', codigo: '333444', expira_em: new Date(Date.now() + 60_000).toISOString() })] });
  await assertRejects(() => acessoEstado({ operator: 'paperclip', pedido_id: PEDIDO }, ctx(), g.porta), Error, 'outro agente');
  assertEquals(g.pedidos.get(PEDIDO)!.codigo, '333444');
});

Deno.test('estado: senha respondida aponta para aceleriq_acesso_usar, sem a senha', async () => {
  const f = porta({
    itens: [item({})],
    pedidos: [pedido({ status: 'respondido', vault_item_id: ITEM })],
  });
  const r = await acessoEstado({ operator: 'hermes', pedido_id: PEDIDO }, ctx(), f.porta) as Record<string, unknown>;
  assertEquals(r.vault_item_id, ITEM);
  assert(String(r.proximo_passo).includes('aceleriq_acesso_usar'));
  assert(!JSON.stringify(r).includes(SENHA));
});

// ─── aceleriq_acesso_usar ─────────────────────────────────────────────────

Deno.test('usar: item sem agentes_podem_usar e sem pedido respondido é recusado', async () => {
  const f = porta({ itens: [item({ agentes_podem_usar: false })] });
  await assertRejects(
    () => acessoUsar({ operator: 'hermes', vault_item_id: ITEM }, ctx(), f.porta),
    Error,
    'não liberou',
  );
  await assertRejects(
    () => acessoUsar({ operator: 'hermes', client_id: CLIENTE, site: 'RD Station' }, ctx(), f.porta),
    Error,
    'aceleriq_acesso_pedir',
  );
});

Deno.test('usar: pedido respondido sem "lembrar" vale uma vez e vira usado', async () => {
  const f = porta({
    itens: [item({ agentes_podem_usar: false })],
    pedidos: [pedido({ status: 'respondido', vault_item_id: ITEM })],
  });
  const r = await acessoUsar({ operator: 'hermes', vault_item_id: ITEM, pedido_id: PEDIDO }, ctx(), f.porta) as Record<string, unknown>;
  assertEquals(r.senha, SENHA);
  assertEquals(r.lembrado, false);
  assertEquals(f.pedidos.get(PEDIDO)!.status, 'usado');
  await assertRejects(() => acessoUsar({ operator: 'hermes', vault_item_id: ITEM }, ctx(), f.porta), Error, 'não liberou');
});

Deno.test('usar: Meta/Google nunca por senha, mesmo se estiver no cofre', async () => {
  const f = porta({ itens: [item({ title: 'Instagram', url: 'https://www.instagram.com', agentes_podem_usar: true })] });
  await assertRejects(() => acessoUsar({ operator: 'hermes', vault_item_id: ITEM }, ctx(), f.porta), Error, "tipo 'conectar'");
});

Deno.test('usar: a senha nunca aparece na trilha de auditoria', async () => {
  const f = porta({ itens: [item({ agentes_podem_usar: true })] });
  const c = ctx();
  const entrada = { operator: 'hermes', client_id: CLIENTE, site: 'RD Station' };
  const r = await acessoUsar(entrada, c, f.porta) as Record<string, unknown>;
  assertEquals(r.senha, SENHA);
  assertEquals(r.usuario, 'contato@cliente.com.br');

  // É exatamente o que o despachante grava em mcp_audit_log: entrada saneada + referência do resultado.
  const trilha = JSON.stringify(buildAuditInput(entrada, c.keyId, c.resultRefHolder?.value));
  assert(!trilha.includes(SENHA), 'a senha vazou para a auditoria');
  assert(trilha.includes(`client_vault:${ITEM}`), 'a auditoria precisa dizer qual item foi usado');
  assert(trilha.includes('hermes'), 'a auditoria precisa dizer qual agente usou');

  // O print também não vai para a auditoria.
  const doPedido = JSON.stringify(sanitizeAuditInput({ operator: 'hermes', print_base64: PNG_1PX }));
  assert(!doPedido.includes(PNG_1PX));
});
