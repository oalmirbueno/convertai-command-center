/**
 * MCP 2.38.0 (20/11/2026): aceleriq_agenda_criar_post_de_arquivo.
 *
 * Cria o post da Agenda a partir de arquivo(s) JÁ subidos em Arquivos: um
 * arquivo (estático ou vídeo) ou um carrossel (raiz com filhos). Mesmo
 * formato do painel e do Estúdio:
 *
 * 1) item editorial = tarefa (tasks) pelo MESMO escritor do MCP e do Estúdio
 *    (createEditorialItem; arte-rapida-na-agenda.ts faz igual), com
 *    due_date = data, delivery_type = formato, status backlog;
 * 2) post = save_editorial_post como a PESSOA conectada (rpcComoPessoa), o
 *    caminho do botão da Agenda (EditorialEditor.handleSave, depois de
 *    selectApprovedMedia) e da entrega do Estúdio (sincronizarPecaNaAgenda):
 *    primary_file_id = raiz, title = nome da raiz, content_type derivado como
 *    inferEditorialMediaContentType (static | carousel | video), objective =
 *    descrição da raiz, default_caption = legenda da raiz, production_status
 *    'ready' (o painel marca ready ao escolher mídia de Arquivos; o Estúdio
 *    também), task_id = o item do passo 1, publications = [] (sem conta, sem
 *    data: a Agenda pede para programar depois);
 * 3) arquivo sem projeto: o painel "adota" a raiz e os filhos no projeto do
 *    post antes de salvar (adotarArquivoNoProjeto, UPDATE ... WHERE
 *    project_id IS NULL). Aqui igual, com a chave de serviço e o mesmo filtro.
 *
 * Não aprova, não agenda, não publica e não envia ao cliente. Arquivo que já
 * é primary_file_id de um post vivo devolve o existente (ja_existia).
 */

import { z } from 'https://esm.sh/zod@3.23.8';
import type { ToolDefinition } from '../../_shared/mcp-tools.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { DataScopeError } from '../../_shared/mcp-auth.ts';
import { dataScopeAllowsClient } from '../../_shared/mcp-security.ts';
import { db } from '../../_shared/aceleriq-read-services.ts';
import { rpcComoPessoa, umaVez } from '../../_shared/mcp-mesas-acoes.ts';
import { createEditorialItem, createEditorialItemSchema } from '../../_shared/mcp-write-services.ts';
import { uuidEstavel } from '../../estudio-arte/modulos/entrega-na-agenda.ts';
import { dataDaAgendaValida, hojeEmSaoPaulo } from '../../estudio-arte/arte-rapida-na-agenda.ts';
import {
  type ArquivoDoCarrossel,
  ordenarComoOPainel,
  rotuloDoEnvio,
  tipoDoPostDoArquivo,
  tituloDoArquivo,
} from './carrossel-de-arquivos.ts';
import { traduzirErroDaCriacao } from './criar-publicacao-de-aprovado.ts';

export const NOME_POST_DE_ARQUIVO = 'aceleriq_agenda_criar_post_de_arquivo';
const ESCRITA = { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false };
const UUID = z.string().uuid();

export const postDeArquivoSchema = z.object({
  file_id: UUID,
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data no formato AAAA-MM-DD'),
  confirmar: z.boolean().optional(),
  idempotency_key: z.string().trim().min(8).max(120).optional(),
  titulo: z.string().trim().min(1).max(200).optional(),
  legenda: z.string().trim().min(1).max(2200).optional(),
  project_id: UUID.optional(),
}).strict().refine((v) => v.confirmar !== true || !!v.idempotency_key, {
  message: 'idempotency_key (8 a 120 caracteres) é obrigatória com confirmar=true',
  path: ['idempotency_key'],
});

export type PedidoDePostDeArquivo = z.infer<typeof postDeArquivoSchema>;

type ArquivoLido = ArquivoDoCarrossel & { description?: string | null };

const COLUNAS =
  'id, client_id, project_id, parent_file_id, file_name, file_type, folder, caption, description, mime_type, extension, storage_bucket, storage_path, file_url, status, archived_at, visibility, agency_approval_status, approval_status, locked_at, created_at';

// deno-lint-ignore no-explicit-any
type Consulta = any;
type Resultado = { data: unknown; error: { message: string } | null };

export interface DependenciasDoPost {
  /** Chave de serviço: leitura e a adoção do arquivo no projeto. */
  banco: { from(tabela: string): Consulta };
  /** Escrita do post como a pessoa (auth.uid() = ela). */
  rpc: (nome: 'save_editorial_post', args: Record<string, unknown>, ctx: AuthContext) => Promise<unknown>;
  /** Cria (ou reencontra) o item editorial (tarefa). */
  criarItem: (entrada: Record<string, unknown>, ctx: AuthContext) => Promise<{ id: string; replayed: boolean }>;
  umaVez: typeof umaVez;
  hoje: () => string;
}

async function criarItemPadrao(entrada: Record<string, unknown>, ctx: AuthContext) {
  const parsed = createEditorialItemSchema.parse(entrada);
  const r = await createEditorialItem(parsed, {
    keyId: ctx.keyId,
    origin: ctx.origin,
    correlationId: ctx.correlationId ?? crypto.randomUUID(),
    dataScope: ctx.dataScope,
  });
  return { id: String((r.record as Record<string, unknown>).id), replayed: !!r.replayed };
}

function dependenciasPadrao(): DependenciasDoPost {
  return { banco: db(), rpc: rpcComoPessoa, criarItem: criarItemPadrao, umaVez, hoje: () => hojeEmSaoPaulo() };
}

function lido<T>(r: Resultado, oque: string): T {
  if (r.error) throw new Error(`Não foi possível ler ${oque} agora. Tente de novo.`);
  return r.data as T;
}

const ativo = (f: Pick<ArquivoLido, 'archived_at' | 'status'>) => !f.archived_at && (f.status || 'ready') === 'ready';

/** Sementes estáveis: o mesmo arquivo + item gera sempre a mesma chave do post e da mutação. */
export function sementesDoPost(rootId: string, taskId: string) {
  return { post: `mcp-post-de-arquivo:${rootId}:${taskId}`, mutacao: `mcp-post-de-arquivo-mutacao:${rootId}:${taskId}` };
}

/** Chave do item editorial: arquivo + projeto + data + título (a mesma chamada reencontra o mesmo item). */
export function chaveDoItem(rootId: string, projectId: string, data: string, titulo: string): string {
  let h = 5381;
  const s = `${projectId}|${data}|${titulo}`;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `mcp-post-de-arquivo:${rootId}:${(h >>> 0).toString(16)}`;
}

export interface PlanoDoPost {
  root: ArquivoLido;
  cards: ArquivoLido[];
  content_type: 'static' | 'carousel' | 'video';
  project_id: string;
  adotar_no_projeto: string[];
  titulo: string;
  legenda: string | null;
  objetivo: string | null;
}

export async function payloadDoPost(plano: PlanoDoPost, taskId: string) {
  const s = sementesDoPost(plano.root.id, taskId);
  const n = plano.cards.length;
  return {
    id: null,
    idempotency_key: await uuidEstavel(s.post),
    mutation_id: await uuidEstavel(s.mutacao),
    client_id: plano.root.client_id,
    project_id: plano.project_id,
    primary_file_id: plano.root.id,
    title: plano.titulo,
    content_type: plano.content_type,
    objective: plano.objetivo,
    default_caption: plano.legenda,
    production_status: 'ready',
    task_id: taskId,
    responsible_id: null,
    internal_notes: `Criado pelo MCP a partir de Arquivos (${rotuloDoEnvio(n)}). Aprovação, data e publicação seguem pela Agenda.`,
    revision_of_post_id: null,
    publications: [],
  };
}

export async function criarPostDeArquivo(
  input: PedidoDePostDeArquivo,
  ctx: AuthContext,
  deps: DependenciasDoPost = dependenciasPadrao(),
): Promise<Record<string, unknown>> {
  const { banco } = deps;
  const root = lido<ArquivoLido | null>(
    await banco.from('files').select(COLUNAS).eq('id', input.file_id).maybeSingle(),
    'o arquivo',
  );
  if (!root) throw new Error('Arquivo não encontrado.');
  if (!dataScopeAllowsClient(ctx.dataScope, root.client_id)) {
    throw new DataScopeError('resource is outside this MCP principal data scope');
  }
  if (root.parent_file_id) {
    throw new Error(`Este arquivo é um card de carrossel. O post nasce da raiz: chame de novo com file_id ${root.parent_file_id}.`);
  }
  if (!ativo(root)) throw new Error('O arquivo está arquivado ou ainda não está pronto. Restaure ou finalize o upload antes.');
  if (!dataDaAgendaValida(input.data, deps.hoje())) throw new Error('Escolha uma data de hoje em diante (AAAA-MM-DD, horário de São Paulo).');

  // Post vivo com esta raiz: devolve o existente, sem duplicar.
  const existentes = lido<Array<{ id: string; version: number; title: string; content_type: string; production_status: string; project_id: string }> | null>(
    await banco.from('editorial_posts')
      .select('id, version, title, content_type, production_status, project_id')
      .eq('primary_file_id', root.id)
      .eq('client_id', root.client_id)
      .is('archived_at', null),
    'os posts da Agenda',
  ) ?? [];
  if (existentes.length) {
    const p = existentes[0];
    return {
      ok: true,
      ja_existia: true,
      simulacao: input.confirmar !== true,
      post: { id: p.id, version: p.version, title: p.title, content_type: p.content_type, production_status: p.production_status },
      client_id: root.client_id,
      aviso: 'Este arquivo já é o arquivo principal de um post da Agenda. Nada foi criado.',
      proximo_passo: 'Para mandar ao cliente, use aceleriq_arquivos_enviar_para_aprovacao com a raiz. A data e a publicação seguem pela Agenda.',
    };
  }

  const filhosLidos = lido<ArquivoLido[] | null>(
    await banco.from('files').select(COLUNAS).eq('parent_file_id', root.id),
    'os cards do carrossel',
  ) ?? [];
  // Mesma seleção de buildApprovedMediaAssets: filhos ativos, mesmo cliente/projeto e imagem.
  const filhos = filhosLidos.filter((f) =>
    ativo(f) && f.client_id === root.client_id && (root.project_id == null || f.project_id == null || f.project_id === root.project_id)
  );
  const contentType = tipoDoPostDoArquivo(root, filhos);
  if (!contentType) throw new Error('A Agenda só monta post de imagem (estático ou carrossel) ou de vídeo. Este arquivo não é nenhum dos dois.');
  const cards = contentType === 'carousel' ? ordenarComoOPainel(root, filhos.filter((f) => tipoDoPostDoArquivo(f, []) === 'static')) : [root];

  // Projeto: o do arquivo; sem projeto, o pedido (adoção como o painel).
  if (root.project_id && input.project_id && input.project_id !== root.project_id) {
    throw new Error('O arquivo está em outro projeto. A Agenda exige o post no mesmo projeto do arquivo: omita project_id ou mova o arquivo antes.');
  }
  const projectId = root.project_id ?? input.project_id ?? null;
  if (!projectId) throw new Error('O arquivo não tem projeto. Mande project_id (um projeto do mesmo cliente) para o post nascer nele.');
  const projeto = lido<{ id: string; client_id: string; deleted_at: string | null } | null>(
    await banco.from('projects').select('id, client_id, deleted_at').eq('id', projectId).maybeSingle(),
    'o projeto',
  );
  if (!projeto || projeto.deleted_at || projeto.client_id !== root.client_id) {
    throw new Error('Projeto não encontrado para o cliente deste arquivo.');
  }
  const adotar = root.project_id ? [] : [root, ...filhos].filter((f) => !f.project_id).map((f) => f.id);

  const plano: PlanoDoPost = {
    root,
    cards,
    content_type: contentType,
    project_id: projectId,
    adotar_no_projeto: adotar,
    titulo: input.titulo || tituloDoArquivo(root.file_name),
    legenda: input.legenda ?? (root.caption?.trim() || null),
    objetivo: root.description?.trim() || null,
  };
  const resumo = {
    file_id: root.id,
    client_id: root.client_id,
    project_id: projectId,
    data: input.data,
    content_type: contentType,
    cards: cards.length,
    rotulo: rotuloDoEnvio(cards.length),
    titulo: plano.titulo,
    legenda: plano.legenda,
    production_status: 'ready',
    ...(adotar.length ? { adota_no_projeto: adotar } : {}),
  };

  if (input.confirmar !== true) {
    return {
      ok: true,
      simulacao: true,
      ja_existia: false,
      plano: {
        ...resumo,
        passos: [
          ...(adotar.length ? ['Arquivos sem projeto entram no projeto do post (como o painel faz ao escolher a mídia).'] : []),
          `Item editorial (tarefa) na data ${input.data}, formato ${contentType}.`,
          'Post da Agenda pronto (production_status ready) com este arquivo como principal, sem publicação e sem data.',
        ],
      },
      aviso: 'Simulação: nada foi escrito. Para criar, chame de novo com confirmar=true e uma idempotency_key. Não aprova, não agenda e não publica.',
    };
  }

  return await deps.umaVez(NOME_POST_DE_ARQUIVO, ctx, input.idempotency_key!, async () => {
    if (ctx.resultRefHolder) ctx.resultRefHolder.value = `files:${root.id}`;
    if (adotar.length) {
      const r: Resultado = await banco.from('files').update({ project_id: projectId }).in('id', adotar).is('project_id', null)
        .eq('client_id', root.client_id).select('id');
      if (r.error) {
        throw new Error(`O arquivo não pôde entrar no projeto (${r.error.message.slice(0, 160)}). Se ele já está em aprovação, retire antes com aceleriq_workspace_retirar_aprovacao ou vincule o projeto em Arquivos.`);
      }
    }
    const item = await deps.criarItem({
      client_id: root.client_id,
      project_id: projectId,
      title: plano.titulo,
      description: `Post de Arquivos (${rotuloDoEnvio(cards.length)}): ${root.file_name}. Criado pelo MCP; a aprovação, a data e a publicação seguem pela Agenda.`.slice(0, 3500),
      format: contentType,
      due_date: input.data,
      priority: 'medium',
      idempotency_key: chaveDoItem(root.id, projectId, input.data, plano.titulo),
    }, ctx);
    const payload = await payloadDoPost(plano, item.id);
    let salvo: unknown;
    try {
      salvo = await deps.rpc('save_editorial_post', { p_payload: payload, p_expected_version: null }, ctx);
    } catch (e) {
      if (e instanceof Error && /^mesa:(dono_da_chave|exige_oauth|configuracao)\s/.test(e.message)) throw e;
      throw new Error(`mesa:rpc_recusada ${traduzirErroDaCriacao(e)} O item editorial ${item.id} ficou criado; repetir com a mesma entrada reaproveita o item.`);
    }
    const postId = String((salvo as { post_id?: string } | null)?.post_id || '');
    return {
      ref: postId ? `editorial_posts:${postId}` : `tasks:${item.id}`,
      resultado: {
        ja_existia: false,
        simulacao: false,
        post_id: postId || null,
        task_id: item.id,
        item_reaproveitado: item.replayed,
        ...resumo,
        observacao: 'Nada foi aprovado, agendado, publicado ou enviado ao cliente.',
        proximo_passo: `Para o cliente aprovar, chame aceleriq_arquivos_enviar_para_aprovacao com file_id ${root.id}. A data de publicação é programada pela Agenda depois da aprovação.`,
      },
    };
  }, { file_id: root.id });
}

function erroDeEntrada(e: z.ZodError): Error {
  return new Error(`Invalid input: ${e.issues.map((i) => `${i.path.join('.') || 'entrada'}: ${i.message}`).join('; ')}`);
}

const tool: ToolDefinition = {
  name: NOME_POST_DE_ARQUIVO,
  title: 'Agenda: criar post a partir de arquivo',
  description:
    'Cria o post da Agenda a partir de arquivo já subido em Arquivos: um arquivo (estático ou vídeo) ou um carrossel (a raiz com os cards; agrupe antes com aceleriq_arquivos_agrupar_carrossel). Igual ao painel: item editorial (tarefa) na data pedida e post pronto com o arquivo como principal, formato derivado do arquivo (static, carousel ou video), título e legenda da raiz (ou os pedidos), sem publicação e sem data de postagem. file_id tem que ser a raiz (card de carrossel é recusado apontando a raiz). data AAAA-MM-DD, de hoje em diante. Arquivo sem projeto precisa de project_id do mesmo cliente. Se o arquivo já é o principal de um post vivo, devolve o existente (ja_existia true). Sem confirmar é simulação; confirmar=true cria e exige idempotency_key. Não aprova, não agenda, não publica e não envia ao cliente. Exige editorial:write e o cliente no escopo.',
  scopes: ['editorial:write'],
  annotations: ESCRITA,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['file_id', 'data'],
    properties: {
      file_id: { type: 'string', format: 'uuid', description: 'Raiz em public.files (arquivo único ou capa do carrossel).' },
      data: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Data do item editorial (AAAA-MM-DD), de hoje em diante.' },
      confirmar: { type: 'boolean', description: 'true cria; ausente ou false só simula.' },
      idempotency_key: { type: 'string', minLength: 8, maxLength: 120, description: 'Obrigatória com confirmar=true. Repetir não cria de novo.' },
      titulo: { type: 'string', maxLength: 200, description: 'Opcional. Padrão: nome da raiz sem sufixo e sem extensão.' },
      legenda: { type: 'string', maxLength: 2200, description: 'Opcional. Padrão: a legenda (caption) da raiz.' },
      project_id: { type: 'string', format: 'uuid', description: 'Opcional. Padrão: o projeto do arquivo; obrigatório se o arquivo não tem projeto.' },
    },
  },
  handler: async (input, ctx) => {
    const parsed = postDeArquivoSchema.safeParse(input ?? {});
    if (!parsed.success) throw erroDeEntrada(parsed.error);
    return await criarPostDeArquivo(parsed.data, ctx);
  },
};

export const FERRAMENTA_DE_POST_DE_ARQUIVO: readonly ToolDefinition[] = [tool];
