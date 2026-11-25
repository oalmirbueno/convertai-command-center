/**
 * MCP: mover e criar arquivo no Workspace, e gravar, listar e arquivar
 * Referências e Concorrentes em Mesa > Contexto > Perfis do Instagram.
 *
 * O movimento entre Em Arquivos e uma pasta do Workspace usa a mesma ordem do
 * painel (copia o blob, grava o nó, só então tira da origem).
 */

import { z } from 'https://esm.sh/zod@3.23.8';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import type { ToolDefinition } from '../../_shared/mcp-tools.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { DataScopeError } from '../../_shared/mcp-auth.ts';
import { db } from './aceleriq-read-services.ts';
import { dataScopeAllowsClient } from '../../_shared/mcp-security.ts';
import { rpcComoPessoa, umaVez } from './mcp-mesas-acoes.ts';
import { LIMITS } from './mcp-files-services.ts';
import {
  conferenciaDoLink,
  podeRetirarDaAprovacao,
  referenciaDeAuditoria,
  validadeDoLink,
  type NoParaLink,
} from './workspace-link-regras.ts';
import {
  BUCKET_WORKSPACE,
  ErroDeMovimento,
  caminhoNoWorkspace,
  COLUNAS_DO_ARQUIVO,
  arquivoDeLinha,
  executarMovimento,
  extensaoDe,
  type LinhaDeArquivo,
  type LinhaDeNo,
  type NoDeWorkspace,
  type PortasDoMovimento,
} from './workspace-mover.ts';
import { planejarPerfis } from './perfis-gravar.ts';
import {
  ABA_DO_PAPEL,
  COLUNAS_DO_PERFIL,
  PAPEIS_ACEITOS,
  contagemDoPapel,
  decidirArquivamento,
  escopoDaChaveDoCliente,
  montarListaPorAba,
  normalizarPedidoDeArquivar,
  papelDoPedido,
  perfilParaLista,
  type LinhaDePerfil,
  type PedidoDeArquivar,
} from './perfis-listar-arquivar.ts';

const ESCRITA = { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: false };
const LEITURA_DOS_PERFIS = { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false };
const UUID = z.string().uuid();
const COLUNAS_DO_NO = 'id, parent_id, scope, client_id, kind, name, mime, size_bytes, storage_path, sent_for_approval_file_id';

const erroDeEntrada = (e: z.ZodError) => new Error(`Invalid input: ${e.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);

function exigirCliente(ctx: AuthContext, clientId: string) {
  if (!dataScopeAllowsClient(ctx.dataScope, clientId)) {
    throw new Error('client_id outside this MCP principal data scope');
  }
}

function noDe(row: Record<string, unknown> | null): NoDeWorkspace | null {
  if (!row) return null;
  return {
    id: String(row.id),
    parent_id: (row.parent_id as string | null) ?? null,
    scope: row.scope === 'global' ? 'global' : 'client',
    client_id: (row.client_id as string | null) ?? null,
    kind: row.kind === 'folder' ? 'folder' : 'file',
    name: String(row.name || ''),
    mime: (row.mime as string | null) ?? null,
    size_bytes: row.size_bytes == null ? null : Number(row.size_bytes),
    storage_path: (row.storage_path as string | null) ?? null,
    sent_for_approval_file_id: (row.sent_for_approval_file_id as string | null) ?? null,
  };
}

async function copiarBlob(banco: SupabaseClient, deBucket: string, dePath: string, paraBucket: string, paraPath: string) {
  const copiado = await banco.storage.from(deBucket).copy(dePath, paraPath, { destinationBucket: paraBucket });
  if (!copiado.error) return;
  const texto = `${copiado.error.message || ''}`;
  if (/already exists|duplicate|já existe/i.test(texto)) return;
  const baixado = await banco.storage.from(deBucket).download(dePath);
  if (baixado.error || !baixado.data) {
    throw new ErroDeMovimento(baixado.error?.message || 'Não foi possível ler o arquivo de origem. Nada foi alterado.');
  }
  const enviado = await banco.storage.from(paraBucket).upload(paraPath, baixado.data, {
    upsert: false,
    contentType: baixado.data.type || 'application/octet-stream',
  });
  if (!enviado.error) return;
  if (/already exists|duplicate|já existe/i.test(`${enviado.error.message || ''}`)) return;
  throw new ErroDeMovimento(enviado.error.message || 'Não foi possível copiar o arquivo. Nada foi alterado.');
}

function portas(banco: SupabaseClient): PortasDoMovimento {
  const falha = (mensagem: string): never => {
    throw new ErroDeMovimento(mensagem);
  };
  return {
    async lerArquivo(id) {
      const { data, error } = await banco.from('files')
        .select(COLUNAS_DO_ARQUIVO)
        .eq('id', id).maybeSingle();
      if (error) falha(error.message);
      if (!data) return null;
      const filhos = await banco.from('files').select('id').eq('parent_file_id', id).limit(1);
      if (filhos.error) falha(filhos.error.message);
      return arquivoDeLinha(data as Record<string, unknown>, ((filhos.data || []) as unknown[]).length > 0);
    },
    async lerNo(id) {
      const { data, error } = await banco.from('workspace_nodes').select(COLUNAS_DO_NO).eq('id', id).maybeSingle();
      if (error) falha(error.message);
      return noDe(data as Record<string, unknown> | null);
    },
    async noDoArquivo(arquivoId) {
      const { data, error } = await banco.from('workspace_nodes').select(COLUNAS_DO_NO)
        .eq('sent_for_approval_file_id', arquivoId).limit(1);
      if (error) falha(error.message);
      return noDe(((data || [])[0] as Record<string, unknown>) || null);
    },
    copiar: (deBucket, dePath, paraBucket, paraPath) => copiarBlob(banco, deBucket, dePath, paraBucket, paraPath),
    async apagarBlob(bucket, path) {
      const { error } = await banco.storage.from(bucket).remove([path]);
      if (error) throw new ErroDeMovimento(error.message);
    },
    async criarNo(linha: LinhaDeNo) {
      const { data, error } = await banco.from('workspace_nodes').insert(linha).select('id').single();
      if (error || !data) falha(error?.message || 'A pasta não recebeu o arquivo.');
      return { id: String((data as { id: string }).id) };
    },
    async moverNo(id, parentId) {
      const { data, error } = await banco.from('workspace_nodes').update({ parent_id: parentId }).eq('id', id).select('id');
      if (error || !(data || []).length) falha(error?.message || 'A pasta de destino não confirmou o arquivo.');
    },
    async apagarNo(id) {
      const { data, error } = await banco.from('workspace_nodes').delete().eq('id', id).select('id');
      if (error || !(data || []).length) falha(error?.message || 'Não foi possível tirar o arquivo da pasta de origem.');
    },
    async retirarArquivo(arquivoId, destino) {
      const apagado = await banco.from('files').delete().eq('id', arquivoId).select('id');
      if (!apagado.error && (apagado.data || []).length) return;
      const apontado = await banco.from('files').update({
        storage_bucket: destino.bucket,
        storage_path: destino.path,
        file_url: `${destino.bucket}://${destino.path}`,
      }).eq('id', arquivoId).select('id');
      if (apontado.error || !(apontado.data || []).length) {
        falha(apontado.error?.message || apagado.error?.message || 'O arquivo entrou na pasta, mas continua em Arquivos.');
      }
    },
    async definirPasta(arquivoId, pasta) {
      const { data, error } = await banco.from('files').update({ folder: pasta }).eq('id', arquivoId).select('id');
      if (error || !(data || []).length) falha(error?.message || 'A pasta de Arquivos não confirmou o arquivo.');
    },
    async criarArquivo(_linha: LinhaDeArquivo): Promise<{ id: string }> {
      throw new ErroDeMovimento('Este caminho grava em Arquivos pelo painel. Pelo MCP, mova para uma pasta do Workspace.');
    },
    async definirPastaDoArquivo(arquivoId, pasta) {
      const { data, error } = await banco.from('files').update({ folder: pasta }).eq('id', arquivoId).select('id');
      if (error || !(data || []).length) falha(error?.message || 'A pasta de Arquivos não confirmou o arquivo.');
    },
  };
}

function descendente(nos: NoDeWorkspace[], origemId: string, destinoId: string | null): boolean {
  if (!destinoId) return false;
  if (origemId === destinoId) return true;
  const porId = new Map(nos.map((no) => [no.id, no]));
  let atual = porId.get(destinoId);
  const vistos = new Set<string>();
  while (atual && !vistos.has(atual.id)) {
    if (atual.id === origemId) return true;
    vistos.add(atual.id);
    atual = atual.parent_id ? porId.get(atual.parent_id) : undefined;
  }
  return false;
}

export const moverArquivoSchema = z.object({
  client_id: UUID,
  arquivo_id: UUID,
  pasta_id: UUID.nullable(),
}).strict();

export async function moverArquivoNoWorkspace(
  input: z.infer<typeof moverArquivoSchema>,
  ctx: Pick<AuthContext, 'dataScope'>,
  banco: SupabaseClient = db(),
) {
  exigirCliente(ctx as AuthContext, input.client_id);
  const { data: cliente } = await banco.from('profiles').select('id').eq('id', input.client_id).is('deleted_at', null).maybeSingle();
  if (!cliente) throw new Error('client_id não existe (confira em aceleriq_list_clients).');

  const nos = await banco.from('workspace_nodes').select(COLUNAS_DO_NO).eq('scope', 'client').eq('client_id', input.client_id).limit(5000);
  if (nos.error) throw new Error(nos.error.message);
  const lista = ((nos.data || []) as Record<string, unknown>[]).map((row) => noDe(row)!);
  const no = lista.find((item) => item.id === input.arquivo_id) || null;
  const ator = ctx.dataScope.principalUserId;

  if (no) {
    if (no.kind !== 'file') throw new Error('arquivo_id é uma pasta. Informe o arquivo.');
    if (input.pasta_id === null && no.parent_id === null) return { ok: true, mudou: false, node_id: no.id, pasta_id: null };
    const resultado = await executarMovimento({
      virtual: false,
      kind: 'file',
      id: no.id,
      fileId: null,
      clientId: input.client_id,
      userId: ator,
      scope: 'client',
      nome: no.name,
      mime: no.mime,
      sizeBytes: no.size_bytes,
      storagePath: no.storage_path,
      targetParentId: input.pasta_id,
      parentIdAtual: no.parent_id,
      ehDescendente: (origem, destino) => descendente(lista, origem, destino),
    }, portas(banco));
    return { ok: true, mudou: resultado.mudou, node_id: no.id, pasta_id: input.pasta_id };
  }

  if (!input.pasta_id) throw new Error('Para tirar um arquivo de Em Arquivos, informe pasta_id da pasta do Workspace.');
  const arquivo = await portas(banco).lerArquivo(input.arquivo_id);
  if (!arquivo || arquivo.client_id !== input.client_id) {
    throw new Error('arquivo_id não é um arquivo do Workspace nem de Em Arquivos deste cliente.');
  }
  const resultado = await executarMovimento({
    virtual: true,
    kind: 'file',
    id: arquivo.id,
    fileId: arquivo.id,
    clientId: input.client_id,
    userId: ator,
    scope: 'client',
    nome: arquivo.file_name,
    mime: arquivo.mime_type,
    sizeBytes: arquivo.size_bytes,
    storagePath: arquivo.storage_path,
    targetParentId: input.pasta_id,
    parentIdAtual: null,
    ehDescendente: () => false,
  }, portas(banco));
  return {
    ok: true,
    mudou: resultado.mudou,
    pasta_id: input.pasta_id,
    storage_path: caminhoNoWorkspace(input.client_id, arquivo.id, arquivo.file_name),
  };
}

const nomeDeArquivo = z.string().trim().min(1).max(180).refine((nome) => !/[\\/]/.test(nome), 'nome sem barras');

export const criarArquivoSchema = z.object({
  client_id: UUID,
  pasta_id: UUID.nullable(),
  nome: nomeDeArquivo,
  conteudo: z.string().min(1).max(400_000),
  mime: z.string().trim().max(120).optional(),
  idempotency_key: z.string().trim().min(8).max(120),
}).strict();

function caminhoDoTexto(clientId: string, chave: string, ext: string): string {
  const segura = chave.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  return `client/${clientId}/mcp-${segura || 'arquivo'}.${ext}`;
}

export async function criarArquivoNoWorkspace(
  input: z.infer<typeof criarArquivoSchema>,
  ctx: Pick<AuthContext, 'dataScope'>,
  banco: SupabaseClient = db(),
) {
  exigirCliente(ctx as AuthContext, input.client_id);
  const { data: cliente } = await banco.from('profiles').select('id').eq('id', input.client_id).is('deleted_at', null).maybeSingle();
  if (!cliente) throw new Error('client_id não existe (confira em aceleriq_list_clients).');
  if (input.pasta_id) {
    const pasta = await banco.from('workspace_nodes').select('id, kind, client_id, scope')
      .eq('id', input.pasta_id).maybeSingle();
    if (pasta.error) throw new Error(pasta.error.message);
    const row = pasta.data as { kind?: string; client_id?: string; scope?: string } | null;
    if (!row || row.kind !== 'folder' || row.scope !== 'client' || row.client_id !== input.client_id) {
      throw new Error('pasta_id não é uma pasta do Workspace deste cliente.');
    }
  }
  const ext = extensaoDe(input.nome);
  const mime = input.mime || (ext === 'md' ? 'text/markdown' : 'text/plain');
  if (!mime.startsWith('text/') && mime !== 'application/json') {
    throw new Error('Esta ferramenta grava texto. Para binário, use o upload de Arquivos.');
  }
  const caminho = caminhoDoTexto(input.client_id, input.idempotency_key, ext);
  const ja = await banco.from('workspace_nodes').select('id, parent_id, storage_path')
    .eq('client_id', input.client_id).eq('storage_path', caminho).limit(1);
  if (ja.error) throw new Error(ja.error.message);
  const existente = ((ja.data || [])[0] as { id: string; parent_id: string | null } | undefined);
  if (existente) {
    return { ok: true, criado: false, node_id: existente.id, pasta_id: existente.parent_id, storage_path: caminho };
  }
  const enviado = await banco.storage.from(BUCKET_WORKSPACE).upload(caminho, new Blob([input.conteudo], { type: mime }), {
    contentType: mime,
    upsert: false,
  });
  if (enviado.error && !/already exists|duplicate|já existe/i.test(enviado.error.message || '')) {
    throw new Error(enviado.error.message);
  }
  const { data, error } = await banco.from('workspace_nodes').insert({
    name: input.nome,
    kind: 'file',
    scope: 'client',
    client_id: input.client_id,
    parent_id: input.pasta_id,
    mime,
    size_bytes: new TextEncoder().encode(input.conteudo).length,
    storage_path: caminho,
    created_by: ctx.dataScope.principalUserId,
  }).select('id').single();
  if (error || !data) {
    await banco.storage.from(BUCKET_WORKSPACE).remove([caminho]);
    throw new Error(error?.message || 'A pasta não recebeu o arquivo.');
  }
  return { ok: true, criado: true, node_id: (data as { id: string }).id, pasta_id: input.pasta_id, storage_path: caminho };
}

export const gravarPerfisSchema = z.object({
  client_id: UUID,
  referencias: z.array(z.string().trim().min(1).max(200)).max(6).optional(),
  concorrentes: z.array(z.string().trim().min(1).max(200)).max(6).optional(),
  idempotency_key: z.string().trim().min(8).max(120).optional(),
}).strict().refine(
  (valor) => (valor.referencias?.length || 0) + (valor.concorrentes?.length || 0) > 0,
  { message: 'Informe ao menos um perfil em referencias ou concorrentes.' },
);

export async function gravarPerfisDoInstagram(
  input: z.infer<typeof gravarPerfisSchema>,
  ctx: Pick<AuthContext, 'dataScope'>,
  banco: SupabaseClient = db(),
) {
  exigirCliente(ctx as AuthContext, input.client_id);
  const { data: cliente } = await banco.from('profiles').select('id').eq('id', input.client_id).is('deleted_at', null).maybeSingle();
  if (!cliente) throw new Error('client_id não existe (confira em aceleriq_list_clients).');
  if (!input.idempotency_key) return await gravarPerfisDoCliente(input, ctx, banco);
  // Com a chave, repetir o pedido não grava de novo: devolve o replay da primeira vez.
  // A chave vale por cliente: a mesma chave em outro cliente não devolve o replay deste.
  return await umaVez('aceleriq_perfis_instagram_gravar', ctx as AuthContext, input.idempotency_key, async () => {
    const resultado = await gravarPerfisDoCliente(input, ctx, banco);
    return { ref: `cliente_perfis_instagram:${input.client_id}`, resultado };
  }, escopoDaChaveDoCliente(input.client_id));
}

async function gravarPerfisDoCliente(
  input: z.infer<typeof gravarPerfisSchema>,
  ctx: Pick<AuthContext, 'dataScope'>,
  banco: SupabaseClient,
) {
  const atuais = await banco.from('cliente_perfis_instagram').select('id, papel, handle')
    .eq('client_id', input.client_id).is('arquivado_em', null);
  if (atuais.error) throw new Error(atuais.error.message);
  const pedidos = [
    ...(input.referencias || []).map((bruto) => ({ papel: 'referencia' as const, bruto })),
    ...(input.concorrentes || []).map((bruto) => ({ papel: 'concorrente' as const, bruto })),
  ];
  const plano = planejarPerfis((atuais.data || []) as { handle: string; papel: string }[], pedidos);
  if (!plano.ok) throw new Error(plano.erro);
  const gravados: { id: string; papel: string; handle: string; ja_existia: boolean }[] = [];
  for (const item of plano.ja) {
    const linha = ((atuais.data || []) as { id: string; papel: string; handle: string }[]).find((row) => row.handle === item.handle);
    if (linha) gravados.push({ id: linha.id, papel: linha.papel, handle: linha.handle, ja_existia: true });
  }
  for (const item of plano.criar) {
    const { data, error } = await banco.from('cliente_perfis_instagram').insert({
      client_id: input.client_id,
      papel: item.papel,
      handle: item.handle,
      origem: 'manual',
      criado_por: ctx.dataScope.principalUserId,
    }).select('id, papel, handle').single();
    if (error || !data) throw new Error(error?.message || `Não foi possível gravar @${item.handle}.`);
    const row = data as { id: string; papel: string; handle: string };
    gravados.push({ id: row.id, papel: row.papel, handle: row.handle, ja_existia: false });
  }
  return {
    ok: true,
    onde: 'Mesa > Contexto > Perfis do Instagram',
    referencias: gravados.filter((item) => item.papel === 'referencia'),
    concorrentes: gravados.filter((item) => item.papel === 'concorrente'),
  };
}

const moverTool: ToolDefinition = {
  name: 'aceleriq_workspace_mover_arquivo',
  title: 'Mover arquivo no Workspace',
  description:
    'Move um arquivo do Workspace para uma pasta (pasta_id) ou para a raiz (pasta_id null). Se arquivo_id for de Em Arquivos, só segue com blob em mcp-files, interno, sem aprovação e sem trava; senão recusa antes de copiar. Copia para o bucket workspace, grava workspace_nodes e só então tira da origem. Exige files:write e o cliente no escopo.',
  scopes: ['files:write'],
  annotations: ESCRITA,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['client_id', 'arquivo_id', 'pasta_id'],
    properties: {
      client_id: { type: 'string', format: 'uuid', description: 'Cliente dono do arquivo.' },
      arquivo_id: { type: 'string', format: 'uuid', description: 'Id do workspace_nodes ou, para sair de Em Arquivos, id de public.files.' },
      pasta_id: { type: ['string', 'null'], format: 'uuid', description: 'Pasta do Workspace. null leva um arquivo do Workspace para a raiz.' },
    },
  },
  handler: async (input, ctx) => {
    const parsed = moverArquivoSchema.safeParse(input ?? {});
    if (!parsed.success) throw erroDeEntrada(parsed.error);
    return await moverArquivoNoWorkspace(parsed.data, ctx);
  },
};

const criarTool: ToolDefinition = {
  name: 'aceleriq_workspace_criar_arquivo',
  title: 'Criar arquivo numa pasta do Workspace',
  description:
    'Cria um arquivo de texto numa pasta do Workspace do cliente (ou na raiz, com pasta_id null). Grava o blob em workspace e a linha em workspace_nodes. A mesma idempotency_key devolve o arquivo já criado. Não publica e não aprova. Exige files:write.',
  scopes: ['files:write'],
  annotations: ESCRITA,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['client_id', 'pasta_id', 'nome', 'conteudo', 'idempotency_key'],
    properties: {
      client_id: { type: 'string', format: 'uuid' },
      pasta_id: { type: ['string', 'null'], format: 'uuid', description: 'Pasta do Workspace. null cria na raiz do cliente.' },
      nome: { type: 'string', description: 'Nome do arquivo, com extensão. Sem barras.' },
      conteudo: { type: 'string', description: 'Texto do arquivo (até 400 mil caracteres).' },
      mime: { type: 'string', description: 'Opcional. text/* ou application/json. .md vira text/markdown.' },
      idempotency_key: { type: 'string', description: 'Chave estável de 8 a 120 caracteres. Repetir não cria outro arquivo.' },
    },
  },
  handler: async (input, ctx) => {
    const parsed = criarArquivoSchema.safeParse(input ?? {});
    if (!parsed.success) throw erroDeEntrada(parsed.error);
    return await criarArquivoNoWorkspace(parsed.data, ctx);
  },
};

const perfisTool: ToolDefinition = {
  name: 'aceleriq_perfis_instagram_gravar',
  title: 'Gravar Referências e Concorrentes',
  description:
    'Grava perfis em Mesa > Contexto > Perfis do Instagram: referencias e/ou concorrentes. Aceita @ ou link, respeita o limite de 6 por papel e não duplica um @ já ativo. Não captura posts nem publica. Exige clients:write e o cliente no escopo.',
  scopes: ['clients:write'],
  annotations: ESCRITA,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['client_id'],
    properties: {
      client_id: { type: 'string', format: 'uuid' },
      referencias: { type: 'array', maxItems: 6, items: { type: 'string' }, description: 'Perfis de referência (@ ou link do Instagram).' },
      concorrentes: { type: 'array', maxItems: 6, items: { type: 'string' }, description: 'Concorrentes (@ ou link do Instagram).' },
      idempotency_key: { type: 'string', description: 'Opcional. Chave estável de 8 a 120 caracteres. Repetir com a mesma chave não grava de novo.' },
    },
  },
  handler: async (input, ctx) => {
    const parsed = gravarPerfisSchema.safeParse(input ?? {});
    if (!parsed.success) throw erroDeEntrada(parsed.error);
    return await gravarPerfisDoInstagram(parsed.data, ctx);
  },
};

const ONDE_DOS_PERFIS = 'Mesa > Contexto > Perfis do Instagram';
const TABELA_DOS_PERFIS = 'cliente_perfis_instagram';

async function exigirClienteExistente(banco: SupabaseClient, clientId: string) {
  const { data: cliente } = await banco.from('profiles').select('id').eq('id', clientId).is('deleted_at', null).maybeSingle();
  if (!cliente) throw new Error('client_id não existe (confira em aceleriq_list_clients).');
}

/** Teto de cada leitura (ativos ou arquivados). O limite da tela é 6 ativos por aba. */
const LIMITE_DE_LEITURA_DOS_PERFIS = 200;

/**
 * Linhas que casam com o pedido de arquivar. Por handle, busca o ativo primeiro
 * e só sem ativo busca o arquivado mais recente: arquivados antigos não escondem o ativo.
 */
async function linhasDoPedidoDeArquivar(
  banco: SupabaseClient,
  clientId: string,
  pedido: PedidoDeArquivar,
): Promise<LinhaDePerfil[]> {
  const base = () => banco.from(TABELA_DOS_PERFIS).select(COLUNAS_DO_PERFIL).eq('client_id', clientId);
  if (pedido.por === 'id') {
    const { data, error } = await base().eq('id', pedido.perfil_id).limit(1);
    if (error) throw new Error(error.message);
    return (data || []) as LinhaDePerfil[];
  }
  const doHandle = () => base().eq('handle', pedido.handle).eq('papel', pedido.papel);
  const ativo = await doHandle().is('arquivado_em', null).limit(1);
  if (ativo.error) throw new Error(ativo.error.message);
  if ((ativo.data || []).length > 0) return ativo.data as LinhaDePerfil[];
  const arquivado = await doHandle().not('arquivado_em', 'is', null)
    .order('arquivado_em', { ascending: false }).limit(1);
  if (arquivado.error) throw new Error(arquivado.error.message);
  return (arquivado.data || []) as LinhaDePerfil[];
}

/** Releitura depois de um update sem linha (corrida): devolve o perfil como está agora. */
export async function relerPerfilArquivado(banco: SupabaseClient, clientId: string, perfilId: string): Promise<LinhaDePerfil> {
  const { data, error } = await banco.from(TABELA_DOS_PERFIS).select(COLUNAS_DO_PERFIL)
    .eq('id', perfilId).eq('client_id', clientId).maybeSingle();
  if (error) throw new Error(error.message);
  const linha = data as LinhaDePerfil | null;
  if (!linha || linha.client_id !== clientId) {
    throw new Error('O perfil mudou durante o arquivamento e não foi encontrado de novo. Confira com aceleriq_perfis_instagram_listar.');
  }
  return linha;
}

export const listarPerfisSchema = z.object({
  client_id: UUID,
  papel: z.enum(PAPEIS_ACEITOS).optional(),
  incluir_arquivados: z.boolean().optional(),
}).strict();

export async function listarPerfisDoInstagram(
  input: z.infer<typeof listarPerfisSchema>,
  ctx: Pick<AuthContext, 'dataScope'>,
  banco: SupabaseClient = db(),
) {
  exigirCliente(ctx as AuthContext, input.client_id);
  await exigirClienteExistente(banco, input.client_id);
  const papel = input.papel ? papelDoPedido(input.papel) : null;
  const incluirArquivados = input.incluir_arquivados !== false;
  // Ativos e arquivados em consultas separadas: muitos arquivados nunca escondem um ativo.
  const base = () => {
    const q = banco.from(TABELA_DOS_PERFIS).select(COLUNAS_DO_PERFIL).eq('client_id', input.client_id);
    return papel ? q.eq('papel', papel) : q;
  };
  const ativos = await base().is('arquivado_em', null).limit(LIMITE_DE_LEITURA_DOS_PERFIS);
  if (ativos.error) throw new Error(ativos.error.message);
  let arquivados: LinhaDePerfil[] = [];
  if (incluirArquivados) {
    const lidos = await base().not('arquivado_em', 'is', null)
      .order('arquivado_em', { ascending: false }).limit(LIMITE_DE_LEITURA_DOS_PERFIS);
    if (lidos.error) throw new Error(lidos.error.message);
    arquivados = (lidos.data || []) as LinhaDePerfil[];
  }
  const linhas = [...((ativos.data || []) as LinhaDePerfil[]), ...arquivados]
    .filter((l) => l.client_id === input.client_id);
  return {
    client_id: input.client_id,
    onde: ONDE_DOS_PERFIS,
    incluir_arquivados: incluirArquivados,
    ...montarListaPorAba(linhas, { papel, incluirArquivados }),
  };
}

export const arquivarPerfilSchema = z.object({
  client_id: UUID,
  perfil_id: UUID.optional(),
  handle: z.string().trim().min(1).max(200).optional(),
  papel: z.enum(PAPEIS_ACEITOS).optional(),
  idempotency_key: z.string().trim().min(8).max(120).optional(),
}).strict().superRefine((valor, contexto) => {
  const pedido = normalizarPedidoDeArquivar(valor);
  if (!pedido.ok) contexto.addIssue({ code: z.ZodIssueCode.custom, message: pedido.erro });
});

/** Igual ao arquivar da tela (perfis-instagram): marca arquivado_em, arquivado_por e desliga o monitoramento. Não apaga nada. */
export async function arquivarPerfilDoInstagram(
  input: z.infer<typeof arquivarPerfilSchema>,
  ctx: AuthContext,
  banco: SupabaseClient = db(),
) {
  exigirCliente(ctx, input.client_id);
  await exigirClienteExistente(banco, input.client_id);
  const normalizado = normalizarPedidoDeArquivar(input);
  if (!normalizado.ok) throw new Error(normalizado.erro);
  const pedido = normalizado.pedido;
  const decisao = decidirArquivamento(input.client_id, await linhasDoPedidoDeArquivar(banco, input.client_id, pedido), pedido);
  if (decisao.acao === 'erro') throw new Error(decisao.erro);

  const executar = async () => {
    let perfil = decisao.perfil;
    let jaEstava = decisao.acao === 'ja_arquivado';
    if (!jaEstava) {
      const feito = await banco.from(TABELA_DOS_PERFIS)
        .update({ arquivado_em: new Date().toISOString(), arquivado_por: ctx.dataScope.principalUserId, monitorar: false })
        .eq('id', perfil.id).eq('client_id', input.client_id).is('arquivado_em', null)
        .select(COLUNAS_DO_PERFIL);
      if (feito.error) throw new Error(feito.error.message || 'Não foi possível arquivar o perfil.');
      const linha = ((feito.data || []) as LinhaDePerfil[])[0];
      if (linha) perfil = linha;
      else {
        // Sem linha: outra chamada arquivou entre a leitura e o update. Relê para devolver o estado real.
        perfil = await relerPerfilArquivado(banco, input.client_id, perfil.id);
        jaEstava = Boolean(perfil.arquivado_em);
      }
    }
    const papel = papelDoPedido(perfil.papel) ?? 'referencia';
    const ativos = await banco.from(TABELA_DOS_PERFIS).select(COLUNAS_DO_PERFIL)
      .eq('client_id', input.client_id).eq('papel', papel).is('arquivado_em', null).limit(50);
    if (ativos.error) throw new Error(ativos.error.message);
    return {
      ref: `cliente_perfis_instagram:${perfil.id}`,
      resultado: {
        onde: ONDE_DOS_PERFIS,
        ja_estava_arquivado: jaEstava,
        perfil: perfilParaLista(perfil),
        aba: ABA_DO_PAPEL[papel],
        ...contagemDoPapel((ativos.data || []) as LinhaDePerfil[], papel),
      },
    };
  };

  if (input.idempotency_key) {
    return await umaVez('aceleriq_perfis_instagram_arquivar', ctx, input.idempotency_key, executar, escopoDaChaveDoCliente(input.client_id));
  }
  const { ref, resultado } = await executar();
  if (ctx.resultRefHolder) ctx.resultRefHolder.value = ref;
  return { ok: true, ...resultado };
}

const PAPEL_NO_SCHEMA = {
  type: 'string',
  enum: [...PAPEIS_ACEITOS],
  description: 'referencias ou concorrentes (aceita também referencia ou concorrente).',
};

const listarPerfisTool: ToolDefinition = {
  name: 'aceleriq_perfis_instagram_listar',
  title: 'Listar Referências e Concorrentes',
  description:
    'Só leitura. Lista os perfis de Mesa > Contexto > Perfis do Instagram por aba (referencias e concorrentes): id, handle com @, nome, seguidores, status (ativo ou arquivado), criado_em, atualizado_em, arquivado_em e monitorar. Ativos primeiro, depois os arquivados (o mais recente primeiro). Cada aba traz ativos, limite (6) e vagas. Filtros: papel e incluir_arquivados (padrão true). Exige clients:read e o cliente no escopo.',
  scopes: ['clients:read'],
  annotations: LEITURA_DOS_PERFIS,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['client_id'],
    properties: {
      client_id: { type: 'string', format: 'uuid' },
      papel: { ...PAPEL_NO_SCHEMA, description: 'Opcional. Só uma aba: referencias ou concorrentes (aceita também referencia ou concorrente).' },
      incluir_arquivados: { type: 'boolean', description: 'Padrão true. false traz só os ativos.' },
    },
  },
  handler: async (input, ctx) => {
    const parsed = listarPerfisSchema.safeParse(input ?? {});
    if (!parsed.success) throw erroDeEntrada(parsed.error);
    return await listarPerfisDoInstagram(parsed.data, ctx);
  },
};

const arquivarPerfilTool: ToolDefinition = {
  name: 'aceleriq_perfis_instagram_arquivar',
  title: 'Arquivar Referência ou Concorrente',
  description:
    'Arquiva um perfil de Mesa > Contexto > Perfis do Instagram, igual ao botão da tela: marca arquivado, desliga o monitoramento e libera a vaga. Não apaga nada (posts e leituras ficam). Informe perfil_id, ou handle (@ ou link) com papel. Se já estava arquivado, devolve ok com ja_estava_arquivado true sem mudar nada. Devolve o perfil e ativos, limite e vagas da aba. idempotency_key é opcional. Exige clients:write e o cliente no escopo.',
  scopes: ['clients:write'],
  annotations: ESCRITA,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['client_id'],
    properties: {
      client_id: { type: 'string', format: 'uuid' },
      perfil_id: { type: 'string', format: 'uuid', description: 'Id do perfil (veja aceleriq_perfis_instagram_listar). Use este ou handle.' },
      handle: { type: 'string', description: '@ ou link do perfil. Exige papel.' },
      papel: { ...PAPEL_NO_SCHEMA, description: 'Obrigatório com handle: referencias ou concorrentes (aceita também referencia ou concorrente).' },
      idempotency_key: { type: 'string', description: 'Opcional. Chave estável de 8 a 120 caracteres. Repetir não arquiva de novo.' },
    },
  },
  handler: async (input, ctx) => {
    const parsed = arquivarPerfilSchema.safeParse(input ?? {});
    if (!parsed.success) throw erroDeEntrada(parsed.error);
    return await arquivarPerfilDoInstagram(parsed.data, ctx);
  },
};

const LEITURA = { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false };
const ESCRITA_CONFIRMADA = { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false };

async function principalEhAdmin(ctx: AuthContext, banco: SupabaseClient): Promise<boolean> {
  if (ctx.scopes?.includes("admin")) return true;
  const userId = ctx.dataScope?.principalUserId;
  if (!userId) return false;
  const { data } = await banco.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").limit(1);
  return Array.isArray(data) && data.length > 0;
}

const linkSchema = z.object({
  node_id: UUID,
  validade_seg: z.number().int().min(60).max(3600).optional(),
  baixar: z.boolean().optional(),
}).strict();

export async function linkDoArquivoNoWorkspace(
  input: z.infer<typeof linkSchema>,
  ctx: AuthContext,
  banco: SupabaseClient = db(),
) {
  const { data, error } = await banco.from('workspace_nodes')
    .select('id, kind, scope, client_id, name, mime, size_bytes, storage_path, thumb_path')
    .eq('id', input.node_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const no = (data as NoParaLink | null) ?? null;
  const confere = conferenciaDoLink(
    no,
    (clientId) => dataScopeAllowsClient(ctx.dataScope, clientId),
    await principalEhAdmin(ctx, banco),
  );
  if (!confere.ok) {
    if (confere.fora) throw new DataScopeError(confere.mensagem);
    throw new Error(confere.mensagem);
  }
  const ttl = validadeDoLink(input.validade_seg, LIMITS.signedDownloadTtlSec);
  const caminho = confere.no.storage_path as string;
  const opcoes = input.baixar ? { download: confere.no.name || true } : undefined;
  const assinado = await banco.storage.from(BUCKET_WORKSPACE).createSignedUrl(caminho, ttl, opcoes);
  if (assinado.error || !assinado.data?.signedUrl) {
    throw new Error(assinado.error?.message || 'Não foi possível assinar o arquivo do Workspace.');
  }
  let thumb_url: string | undefined;
  if (confere.no.thumb_path) {
    const thumb = await banco.storage.from(BUCKET_WORKSPACE).createSignedUrl(confere.no.thumb_path, ttl);
    if (!thumb.error && thumb.data?.signedUrl) thumb_url = thumb.data.signedUrl;
  }
  if (ctx.resultRefHolder) ctx.resultRefHolder.value = referenciaDeAuditoria(confere.no.id);
  return {
    signed_url: assinado.data.signedUrl,
    expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
    name: confere.no.name,
    mime: confere.no.mime,
    size_bytes: confere.no.size_bytes,
    ...(thumb_url ? { thumb_url } : {}),
  };
}

const linkTool: ToolDefinition = {
  name: 'aceleriq_workspace_link_arquivo',
  title: 'Link assinado de arquivo do Workspace',
  description:
    'Devolve uma URL assinada de um arquivo do bucket privado workspace. validade_seg de 60 a 3600 (padrão MCP_FILE_DOWNLOAD_TTL, 600). Nó global só para admin. Exige workspace:read e o cliente no escopo. A auditoria grava o id do nó, não a URL.',
  scopes: ['workspace:read'],
  annotations: LEITURA,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['node_id'],
    properties: {
      node_id: { type: 'string', format: 'uuid' },
      validade_seg: { type: 'integer', minimum: 60, maximum: 3600 },
      baixar: { type: 'boolean', description: 'Quando verdadeiro, a URL pede download com o nome do arquivo.' },
    },
  },
  handler: async (input, ctx) => {
    const parsed = linkSchema.safeParse(input ?? {});
    if (!parsed.success) throw erroDeEntrada(parsed.error);
    return await linkDoArquivoNoWorkspace(parsed.data, ctx);
  },
};

const retirarSchema = z.object({
  file_id: UUID,
  confirmar: z.literal(true),
  idempotency_key: z.string().trim().min(8).max(120),
}).strict();

export async function retirarArquivoDaAprovacao(
  input: z.infer<typeof retirarSchema>,
  ctx: AuthContext,
  banco: SupabaseClient = db(),
) {
  const { data, error } = await banco.from('files')
    .select('id, client_id, parent_file_id, visibility, approval_status, agency_approval_status, locked_at, archived_at')
    .eq('id', input.file_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const arquivo = data as {
    id: string;
    client_id: string;
    parent_file_id: string | null;
    visibility: string | null;
    approval_status: string | null;
    locked_at: string | null;
    archived_at: string | null;
  } | null;
  if (!arquivo) throw new Error('Arquivo não encontrado.');
  if (!dataScopeAllowsClient(ctx.dataScope, arquivo.client_id)) {
    throw new DataScopeError('resource is outside this MCP principal data scope');
  }
  if (!podeRetirarDaAprovacao(arquivo)) {
    throw new Error('Só dá para retirar o que ainda espera o cliente e está visível para ele.');
  }
  return await umaVez('aceleriq_workspace_retirar_aprovacao', ctx, input.idempotency_key, async () => {
    if (ctx.resultRefHolder) ctx.resultRefHolder.value = `files:${arquivo.id}`;
    const resultado = await rpcComoPessoa('withdraw_file_client_approval', { p_file_id: arquivo.id }, ctx);
    return { ref: `files:${arquivo.id}`, resultado: { arquivo: resultado, client_id: arquivo.client_id } };
  });
}

const retirarTool: ToolDefinition = {
  name: 'aceleriq_workspace_retirar_aprovacao',
  title: 'Retirar arquivo da aprovação',
  description:
    'Cancela a aprovação pendente do cliente em um arquivo (Workspace/Estúdio já enviado). O arquivo fica interno, invisível para o cliente, sem apagar o blob. Efeito visível ao cliente: exige confirmar=true e idempotency_key. Exige files:write e o cliente no escopo. Só admin ou gestor na função do banco.',
  scopes: ['files:write'],
  annotations: ESCRITA_CONFIRMADA,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['file_id', 'confirmar', 'idempotency_key'],
    properties: {
      file_id: { type: 'string', format: 'uuid', description: 'Id em public.files da raiz que está com approval_status pending e visibility approval.' },
      confirmar: { type: 'boolean', const: true, description: 'Tem que ser true: o cliente deixa de ver o arquivo.' },
      idempotency_key: { type: 'string', description: 'Chave estável de 8 a 120 caracteres. Repetir não retira de novo.' },
    },
  },
  handler: async (input, ctx) => {
    const parsed = retirarSchema.safeParse(input ?? {});
    if (!parsed.success) throw erroDeEntrada(parsed.error);
    return await retirarArquivoDaAprovacao(parsed.data, ctx);
  },
};

export const FERRAMENTAS_DE_WORKSPACE_E_PERFIS: readonly ToolDefinition[] = [
  moverTool,
  criarTool,
  perfisTool,
  listarPerfisTool,
  arquivarPerfilTool,
  linkTool,
  retirarTool,
];
