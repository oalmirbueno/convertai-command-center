/**
 * Pedidos de acesso dos agentes (MCP 2.13.0, 17/10/2026, pedido do dono).
 *
 * Quando um agente (Paperclip, Hermes ou outro) chega num login:
 * - aceleriq_acesso_usar: se o dono já liberou o item do cofre (agentes_podem_usar), a senha vem na hora.
 *   Sem liberação, só vale uma vez, para o pedido que o dono acabou de responder.
 * - aceleriq_acesso_pedir: abre o pedido com o print da tela; o banco avisa o dono (gatilho sem senha).
 *   Se o cofre já tem o acesso liberado para aquele cliente e site, responde ja_lembrado sem criar pedido.
 * - aceleriq_acesso_estado: o agente consulta a cada 30 a 60 s. O código de verificação sai UMA vez e o
 *   banco apaga na mesma transação (pedido_acesso_retirar_codigo, só chave de serviço).
 *
 * A senha nunca vai para log: o despachante audita só a entrada (sem senha) e a referência do item usado
 * (client_vault:<id>). Facebook, Instagram, Meta e Google nunca por senha ou código.
 *
 * O acesso ao banco passa por uma porta (PortaDoAcesso) para as regras serem testadas sem Supabase.
 */

import { db, isUuid } from '../../_shared/aceleriq-read-services.ts';
import { assertClientAccess, type AuthContext } from '../../_shared/mcp-auth.ts';
import { exigirClienteExistente } from '../../_shared/mcp-client-id-guard.ts';
import {
  COMO_PEDIR_ACESSO,
  ehMetaOuGoogle,
  hostDe,
  itemCombina,
  lerPrint,
  normalizar,
  RECUSA_META_GOOGLE,
  MANTER_A_SESSAO,
  REGRAS_DA_SENHA,
  type TipoDePedido,
} from './acesso-regras.ts';

export { COMO_PEDIR_ACESSO };

export interface ItemDoCofre {
  id: string;
  client_id: string;
  title: string | null;
  url: string | null;
  username: string | null;
  agentes_podem_usar: boolean;
}

export interface PedidoLido {
  id: string;
  created_at: string;
  operador_slug: string;
  client_id: string | null;
  tipo: TipoDePedido;
  site: string;
  url: string | null;
  status: 'aberto' | 'respondido' | 'usado' | 'cancelado' | 'expirado';
  vault_item_id: string | null;
  expira_em: string | null;
}

export interface NovoPedido {
  id: string;
  operador_slug: string;
  client_id: string | null;
  kanban_task_id: string | null;
  tipo: TipoDePedido;
  site: string;
  url: string | null;
  conta: string | null;
  mensagem: string;
  link_para_conectar: string | null;
  print_path: string | null;
}

export interface PortaDoAcesso {
  operadorExiste(slug: string): Promise<boolean>;
  exigirCliente(clientId: string): Promise<void>;
  clienteDaTarefa(taskId: string): Promise<string | null>;
  /** Itens do cofre do cliente, SEM a senha, mais recentes primeiro. */
  itensDoCofre(clientId: string): Promise<ItemDoCofre[]>;
  item(itemId: string): Promise<ItemDoCofre | null>;
  /** O único lugar que lê a senha. */
  senhaDoItem(itemId: string): Promise<{ username: string | null; password: string | null; url: string | null } | null>;
  pedidoAbertoIgual(operador: string, tipo: TipoDePedido, clientId: string | null): Promise<PedidoLido[]>;
  guardarPrint(caminho: string, bytes: Uint8Array, mime: string): Promise<boolean>;
  criarPedido(linha: NovoPedido): Promise<void>;
  lerPedido(id: string): Promise<PedidoLido | null>;
  pedidoRespondidoDoItem(itemId: string): Promise<PedidoLido | null>;
  /** respondido -> usado, só se ainda estiver respondido. true = este chamador levou. */
  marcarUsado(pedidoId: string): Promise<boolean>;
  /** Entrega o código uma vez e apaga (RPC). null = nada a entregar (já entregue, vencido, de outro agente). */
  retirarCodigo(pedidoId: string, operador: string): Promise<string | null>;
}

const COLUNAS_DO_PEDIDO = 'id, created_at, operador_slug, client_id, tipo, site, url, status, vault_item_id, expira_em';
const COLUNAS_DO_ITEM = 'id, client_id, title, url, username, agentes_podem_usar';
const BUCKET = 'pedidos-de-acesso';

export function portaDoBanco(): PortaDoAcesso {
  return {
    async operadorExiste(slug) {
      const { data } = await db().from('internal_operators').select('id').eq('slug', slug).maybeSingle();
      return Boolean(data);
    },
    async exigirCliente(clientId) {
      await exigirClienteExistente(db(), clientId);
    },
    async clienteDaTarefa(taskId) {
      const { data } = await db().from('tasks').select('projects(client_id)').eq('id', taskId).maybeSingle();
      const projeto = (data as { projects?: { client_id?: string | null } | null } | null)?.projects;
      return projeto?.client_id ?? null;
    },
    async itensDoCofre(clientId) {
      const { data, error } = await db().from('client_vault').select(COLUNAS_DO_ITEM)
        .eq('client_id', clientId).order('updated_at', { ascending: false }).limit(500);
      if (error) throw new Error('O cofre não pôde ser lido agora.');
      return (data ?? []) as ItemDoCofre[];
    },
    async item(itemId) {
      const { data, error } = await db().from('client_vault').select(COLUNAS_DO_ITEM).eq('id', itemId).maybeSingle();
      if (error) throw new Error('O cofre não pôde ser lido agora.');
      return (data as ItemDoCofre | null) ?? null;
    },
    async senhaDoItem(itemId) {
      const { data, error } = await db().from('client_vault').select('username, password, url').eq('id', itemId).maybeSingle();
      if (error) throw new Error('O cofre não pôde ser lido agora.');
      return (data as { username: string | null; password: string | null; url: string | null } | null) ?? null;
    },
    async pedidoAbertoIgual(operador, tipo, clientId) {
      const desde = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      let q = db().from('pedidos_de_acesso').select(COLUNAS_DO_PEDIDO)
        .eq('operador_slug', operador).eq('tipo', tipo).eq('status', 'aberto').gte('created_at', desde);
      q = clientId ? q.eq('client_id', clientId) : q.is('client_id', null);
      const { data } = await q.order('created_at', { ascending: false }).limit(20);
      return (data ?? []) as PedidoLido[];
    },
    async guardarPrint(caminho, bytes, mime) {
      const { error } = await db().storage.from(BUCKET).upload(caminho, bytes, { contentType: mime, upsert: false });
      return !error;
    },
    async criarPedido(linha) {
      const { error } = await db().from('pedidos_de_acesso').insert(linha);
      if (error) throw new Error('O pedido não pôde ser gravado agora. Tente de novo em 1 minuto.');
    },
    async lerPedido(id) {
      const { data, error } = await db().from('pedidos_de_acesso').select(COLUNAS_DO_PEDIDO).eq('id', id).maybeSingle();
      if (error) throw new Error('O pedido não pôde ser lido agora.');
      return (data as PedidoLido | null) ?? null;
    },
    async pedidoRespondidoDoItem(itemId) {
      const { data } = await db().from('pedidos_de_acesso').select(COLUNAS_DO_PEDIDO)
        .eq('vault_item_id', itemId).eq('tipo', 'senha').eq('status', 'respondido')
        .order('respondido_em', { ascending: false }).limit(1).maybeSingle();
      return (data as PedidoLido | null) ?? null;
    },
    async marcarUsado(pedidoId) {
      const { data, error } = await db().from('pedidos_de_acesso')
        .update({ status: 'usado', usado_em: new Date().toISOString() })
        .eq('id', pedidoId).eq('status', 'respondido').select('id');
      if (error) throw new Error('O pedido não pôde ser atualizado agora.');
      return Array.isArray(data) && data.length > 0;
    },
    async retirarCodigo(pedidoId, operador) {
      const { data, error } = await db().rpc('pedido_acesso_retirar_codigo', { p_pedido: pedidoId, p_operador: operador });
      if (error) throw new Error('O código não pôde ser lido agora. Consulte de novo em 30 s.');
      return typeof data === 'string' && data ? data : null;
    },
  };
}

const texto = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
};

async function exigirOperador(porta: PortaDoAcesso, operador: string): Promise<string> {
  const slug = String(operador || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{1,38}$/.test(slug)) throw new Error('operator inválido: use o slug do agente (ex.: hermes).');
  if (!(await porta.operadorExiste(slug))) {
    throw new Error(`O operador "${slug}" não está cadastrado. Cadastre com aceleriq_operator_register antes de pedir acesso.`);
  }
  return slug;
}

export interface EntradaPedir {
  operator: string;
  tipo: TipoDePedido;
  site: string;
  url?: string;
  conta?: string;
  mensagem: string;
  client_id?: string;
  kanban_task_id?: string;
  link_para_conectar?: string;
  print_base64?: string;
  print_mime?: string;
}

export async function acessoPedir(input: EntradaPedir, ctx: AuthContext, porta: PortaDoAcesso = portaDoBanco()) {
  const site = texto(input.site);
  const mensagem = texto(input.mensagem);
  if (!site) throw new Error('Diga o site (ex.: "Portal da Prefeitura" ou "app.rdstation.com").');
  if (!mensagem) throw new Error('Escreva uma mensagem curta para o dono: o que você está fazendo e o que precisa.');
  const url = texto(input.url);

  if ((input.tipo === 'senha' || input.tipo === 'codigo') && ehMetaOuGoogle(site, url)) {
    throw new Error(RECUSA_META_GOOGLE);
  }

  const operador = await exigirOperador(porta, input.operator);

  let clientId: string | null = null;
  if (input.client_id) {
    if (!isUuid(input.client_id)) throw new Error('client_id precisa ser um UUID.');
    assertClientAccess(ctx, input.client_id);
    await porta.exigirCliente(input.client_id);
    clientId = input.client_id;
  }
  const tarefa = input.kanban_task_id && isUuid(input.kanban_task_id) ? input.kanban_task_id : null;
  if (input.kanban_task_id && !tarefa) throw new Error('kanban_task_id precisa ser um UUID.');
  if (!clientId && tarefa) {
    const daTarefa = await porta.clienteDaTarefa(tarefa).catch(() => null);
    if (daTarefa) {
      assertClientAccess(ctx, daTarefa);
      clientId = daTarefa;
    }
  }

  // O dono já liberou este acesso: nada de pedido novo, nada de aviso.
  if (input.tipo === 'senha' && clientId) {
    const lembrado = (await porta.itensDoCofre(clientId)).find((i) =>
      i.agentes_podem_usar && !ehMetaOuGoogle(i.title, i.url) && itemCombina(i, { site, url, conta: input.conta })
    );
    if (lembrado) {
      return {
        ja_lembrado: true,
        vault_item_id: lembrado.id,
        proximo_passo: 'Chame aceleriq_acesso_usar com este vault_item_id. Nenhum pedido foi aberto.',
      };
    }
  }

  // Mesmo pedido ainda aberto (agente repetindo): devolve o que existe, sem avisar o dono de novo.
  const iguais = await porta.pedidoAbertoIgual(operador, input.tipo, clientId).catch(() => [] as PedidoLido[]);
  const repetido = iguais.find((p) =>
    normalizar(p.site) === normalizar(site) || (hostDe(p.url) !== '' && hostDe(p.url) === hostDe(url))
  );
  if (repetido) {
    return {
      pedido_id: repetido.id,
      status: repetido.status,
      repetido: true,
      proximo_passo: 'Este pedido já está aberto. Consulte aceleriq_acesso_estado a cada 30 a 60 s.',
    };
  }

  const id = crypto.randomUUID();
  let printPath: string | null = null;
  let avisoDoPrint: string | null = null;
  if (input.print_base64) {
    const print = lerPrint(input.print_base64);
    const caminho = `pedidos/${id}.${print.ext}`;
    if (await porta.guardarPrint(caminho, print.bytes, print.mime).catch(() => false)) printPath = caminho;
    else avisoDoPrint = 'O print não subiu; o pedido foi aberto sem ele.';
  }

  await porta.criarPedido({
    id,
    operador_slug: operador,
    client_id: clientId,
    kanban_task_id: tarefa,
    tipo: input.tipo,
    site: site.slice(0, 120),
    url: url ? url.slice(0, 2000) : null,
    conta: texto(input.conta)?.slice(0, 200) ?? null,
    mensagem: mensagem.slice(0, 500),
    link_para_conectar: texto(input.link_para_conectar)?.slice(0, 2000) ?? null,
    print_path: printPath,
  });
  if (ctx.resultRefHolder) ctx.resultRefHolder.value = `pedidos_de_acesso:${id}`;

  return {
    pedido_id: id,
    status: 'aberto',
    print: Boolean(printPath),
    ...(avisoDoPrint ? { aviso: avisoDoPrint } : {}),
    proximo_passo: 'O dono foi avisado. Consulte aceleriq_acesso_estado com este pedido_id a cada 30 a 60 s.',
  };
}

export async function acessoEstado(input: { operator: string; pedido_id: string }, ctx: AuthContext, porta: PortaDoAcesso = portaDoBanco()) {
  if (!isUuid(input.pedido_id)) throw new Error('pedido_id precisa ser um UUID.');
  const operador = String(input.operator || '').trim().toLowerCase();
  const pedido = await porta.lerPedido(input.pedido_id);
  if (!pedido) throw new Error('Pedido não encontrado. Confira o pedido_id devolvido por aceleriq_acesso_pedir.');
  if (pedido.client_id) assertClientAccess(ctx, pedido.client_id);
  if (pedido.operador_slug !== operador) throw new Error('Este pedido é de outro agente.');

  const base = { pedido_id: pedido.id, tipo: pedido.tipo, site: pedido.site };

  if (pedido.status === 'aberto') {
    return { ...base, status: 'aberto', proximo_passo: 'O dono ainda não respondeu. Consulte de novo em 30 a 60 s.' };
  }

  if (pedido.status === 'respondido' && pedido.tipo === 'codigo') {
    const codigo = await porta.retirarCodigo(pedido.id, operador);
    if (codigo) {
      if (ctx.resultRefHolder) ctx.resultRefHolder.value = `pedidos_de_acesso:${pedido.id}:codigo_entregue`;
      return {
        ...base,
        status: 'usado',
        codigo,
        aviso: 'Entregue uma única vez: digite agora. ' + REGRAS_DA_SENHA + ' ' + MANTER_A_SESSAO,
      };
    }
    const depois = await porta.lerPedido(pedido.id);
    return {
      ...base,
      status: depois?.status ?? 'expirado',
      proximo_passo: 'O código não está mais disponível (já entregue ou vencido). Se ainda precisar, peça outro com tipo codigo.',
    };
  }

  if (pedido.status === 'respondido' && pedido.tipo === 'senha') {
    return {
      ...base,
      status: 'respondido',
      vault_item_id: pedido.vault_item_id,
      proximo_passo: 'Chame aceleriq_acesso_usar com este vault_item_id e o pedido_id para receber usuário e senha.',
    };
  }

  if (pedido.status === 'respondido') {
    return { ...base, status: 'respondido', proximo_passo: 'O dono marcou como feito. Tente de novo agora.' };
  }

  const fim: Record<string, string> = {
    usado: 'Já foi usado. Se precisar de novo, chame aceleriq_acesso_usar ou abra outro pedido.',
    cancelado: 'O dono cancelou. Não tente por outro caminho: registre o bloqueio e siga.',
    expirado: 'Venceu. Se ainda precisar, abra outro pedido.',
  };
  return { ...base, status: pedido.status, proximo_passo: fim[pedido.status] ?? 'Pedido encerrado.' };
}

export interface EntradaUsar {
  operator: string;
  vault_item_id?: string;
  pedido_id?: string;
  client_id?: string;
  site?: string;
  conta?: string;
}

export async function acessoUsar(input: EntradaUsar, ctx: AuthContext, porta: PortaDoAcesso = portaDoBanco()) {
  const operador = await exigirOperador(porta, input.operator);
  if (input.site && ehMetaOuGoogle(input.site)) throw new Error(RECUSA_META_GOOGLE);

  let pedido: PedidoLido | null = null;
  if (input.pedido_id) {
    if (!isUuid(input.pedido_id)) throw new Error('pedido_id precisa ser um UUID.');
    pedido = await porta.lerPedido(input.pedido_id);
    if (!pedido) throw new Error('Pedido não encontrado.');
  }

  let item: ItemDoCofre | null = null;
  const itemId = input.vault_item_id ?? pedido?.vault_item_id ?? null;
  if (itemId) {
    if (!isUuid(itemId)) throw new Error('vault_item_id precisa ser um UUID.');
    item = await porta.item(itemId);
    if (!item) throw new Error('Item do cofre não encontrado.');
  } else {
    if (pedido) throw new Error('O dono ainda não respondeu este pedido. Consulte aceleriq_acesso_estado.');
    const site = texto(input.site);
    if (!input.client_id || !site) throw new Error('Mande vault_item_id, ou client_id e site.');
    if (!isUuid(input.client_id)) throw new Error('client_id precisa ser um UUID.');
    assertClientAccess(ctx, input.client_id);
    const candidatos = (await porta.itensDoCofre(input.client_id)).filter((i) =>
      i.agentes_podem_usar && itemCombina(i, { site, conta: input.conta })
    );
    if (candidatos.length === 0) {
      throw new Error(`Nada liberado no cofre para "${site}". Peça com aceleriq_acesso_pedir (tipo senha) e o print da tela.`);
    }
    const contas = new Set(candidatos.map((c) => normalizar(c.username)));
    if (contas.size > 1) {
      const lista = candidatos.slice(0, 5).map((c) => `${c.id} (${c.username || 'sem usuário'})`).join('; ');
      throw new Error(`Há mais de uma conta liberada para "${site}". Mande vault_item_id ou conta. Itens: ${lista}`);
    }
    item = candidatos[0];
  }

  assertClientAccess(ctx, item.client_id);
  if (ehMetaOuGoogle(item.title, item.url)) throw new Error(RECUSA_META_GOOGLE);

  // Pedido respondido para este item: vira usado agora (é o "uma vez" sem liberação).
  const doItem = pedido && pedido.vault_item_id === item.id ? pedido : await porta.pedidoRespondidoDoItem(item.id);
  let levouOPedido = false;
  if (doItem && doItem.status === 'respondido' && doItem.vault_item_id === item.id && doItem.operador_slug === operador) {
    levouOPedido = await porta.marcarUsado(doItem.id);
  }

  if (!item.agentes_podem_usar && !levouOPedido) {
    throw new Error(
      'O dono não liberou este acesso para agentes. Peça com aceleriq_acesso_pedir (tipo senha) e espere a resposta.',
    );
  }

  const segredo = await porta.senhaDoItem(item.id);
  if (!segredo?.password) throw new Error('Este item do cofre não tem senha guardada. Peça com aceleriq_acesso_pedir.');

  // Trilha: o despachante grava no mcp_audit_log a entrada (operator) e esta referência. Nunca a senha.
  if (ctx.resultRefHolder) {
    ctx.resultRefHolder.value = `client_vault:${item.id}` + (levouOPedido && doItem ? `;pedidos_de_acesso:${doItem.id}` : '');
  }

  return {
    vault_item_id: item.id,
    titulo: item.title,
    usuario: segredo.username ?? item.username,
    senha: segredo.password,
    url: segredo.url ?? item.url,
    lembrado: item.agentes_podem_usar,
    regras: `${REGRAS_DA_SENHA} ${MANTER_A_SESSAO}`,
  };
}
