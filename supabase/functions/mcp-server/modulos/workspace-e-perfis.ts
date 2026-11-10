/**
 * MCP: mover e criar arquivo no Workspace, e gravar Referências e Concorrentes
 * em Mesa > Contexto > Perfis do Instagram.
 *
 * O movimento entre Em Arquivos e uma pasta do Workspace usa a mesma ordem do
 * painel (copia o blob, grava o nó, só então tira da origem).
 */

import { z } from 'https://esm.sh/zod@3.23.8';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import type { ToolDefinition } from '../../_shared/mcp-tools.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { db } from '../../_shared/aceleriq-read-services.ts';
import { dataScopeAllowsClient } from '../../_shared/mcp-security.ts';
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

const ESCRITA = { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: false };
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
    async criarArquivo(_linha: LinhaDeArquivo) {
      falha('Este caminho grava em Arquivos pelo painel. Pelo MCP, mova para uma pasta do Workspace.');
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
    },
  },
  handler: async (input, ctx) => {
    const parsed = gravarPerfisSchema.safeParse(input ?? {});
    if (!parsed.success) throw erroDeEntrada(parsed.error);
    return await gravarPerfisDoInstagram(parsed.data, ctx);
  },
};

export const FERRAMENTAS_DE_WORKSPACE_E_PERFIS: readonly ToolDefinition[] = [moverTool, criarTool, perfisTool];
