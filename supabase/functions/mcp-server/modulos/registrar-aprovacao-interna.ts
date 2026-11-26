/**
 * MCP 2.39.2 (25/11/2026): autoaprovação interna, só para o cliente interno.
 *
 * O dono (Almir) aprova as peças da própria agência (cliente interno AcelerIQ)
 * pelo chat com o agente. Para esse cliente, e só para ele, o agente registra
 * a aprovação que o dono deu, pelo MESMO caminho do painel quando o admin
 * aprova pelo cliente: a RPC aprovar_pelo_cliente (SECURITY DEFINER; exige
 * admin ou gestor e acesso ao cliente; faz a revisão da agência se preciso,
 * libera, aceita, trava a raiz e os filhos e grava o evento
 * client_approved_offline com canal 'equipe'). Chamada como a pessoa
 * conectada (rpcComoPessoa), nunca escrevendo direto em tabela.
 *
 * Todos os outros clientes continuam como antes: a aprovação é do cliente no
 * painel e a ferramenta recusa antes de qualquer outra leitura ou escrita.
 *
 * Não mexe no selo do post (approval_fingerprint), que precisa existir; não
 * cria publicação, não agenda e não publica. O passo seguinte é
 * aceleriq_criar_publicacao_de_aprovado e depois aceleriq_reagendar_publicacao.
 */

import { z } from 'https://esm.sh/zod@3.23.8';
import type { ToolDefinition } from '../../_shared/mcp-tools.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { DataScopeError } from '../../_shared/mcp-auth.ts';
import { dataScopeAllowsClient } from '../../_shared/mcp-security.ts';
import { db } from '../../_shared/aceleriq-read-services.ts';
import { rpcComoPessoa, umaVez } from '../../_shared/mcp-mesas-acoes.ts';
import { feitoPor } from '../../_shared/mcp-mesas-ponte.ts';
import { MCP_VERSION } from '../../_shared/mcp-release.ts';
import { aprovadoPeloCliente, type ArquivoDaAprovacao } from './criar-publicacao-de-aprovado.ts';

const NOME = 'aceleriq_registrar_aprovacao_interna';
const ESCRITA = { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false };

/**
 * Clientes em que o agente pode registrar a aprovação dada pelo dono no chat.
 * Hoje só o cliente interno AcelerIQ (a própria agência). Ligar outro cliente
 * é decisão do dono e exige mudança de código mais release: não há chave no
 * banco nem na credencial que estenda esta lista.
 */
export const CLIENTES_COM_AUTOAPROVACAO_INTERNA: ReadonlySet<string> = new Set([
  '4dd691a7-d481-451f-800b-5e6b6fdc8721', // AcelerIQ (cliente interno)
]);

export function autoaprovacaoInternaLigada(clientId: string | null | undefined): boolean {
  return !!clientId && CLIENTES_COM_AUTOAPROVACAO_INTERNA.has(clientId);
}

/** Folga para relógio adiantado de quem chama. */
export const FOLGA_DO_FUTURO_MS = 5 * 60_000;
const TETO_DA_NOTA = 500;

export const registrarAprovacaoInternaSchema = z.object({
  post_id: z.string().uuid(),
  origem: z.string().trim().min(5).max(300),
  aprovado_pelo_dono_em: z.string().datetime({ offset: true }),
  confirmar: z.literal(true),
  idempotency_key: z.string().trim().min(8).max(120),
}).strict();

export type PedidoDeAprovacaoInterna = z.infer<typeof registrarAprovacaoInternaSchema>;

// ------------------------------------------------------------------ regras puras

export const MENSAGEM_DESLIGADA =
  'Autoaprovação interna desligada para este cliente: a aprovação continua sendo do cliente no painel. Nada foi aprovado.';

/** Data da aprovação do dono: com fuso (o schema garante) e não no futuro além da folga. */
export function problemaNaData(iso: string, agora: Date): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'aprovado_pelo_dono_em inválido: use data e hora ISO com fuso.';
  if (t > agora.getTime() + FOLGA_DO_FUTURO_MS) return 'aprovado_pelo_dono_em inválido: está no futuro.';
  return null;
}

/** Nota gravada no evento (≤ 500): a origem encolhe se precisar, o resto fica inteiro. */
export function notaDaAprovacao(p: { aprovadoEm: string; origem: string; registradoPor: string; postId: string }): string {
  const montar = (origem: string) =>
    `Autoaprovação interna (cliente interno) · aprovado pelo dono em ${p.aprovadoEm} · origem: ${origem} · registrado por ${p.registradoPor} via MCP ${MCP_VERSION} · post ${p.postId}`;
  const cheia = montar(p.origem);
  if (cheia.length <= TETO_DA_NOTA) return cheia;
  const sobra = Math.max(0, p.origem.length - (cheia.length - TETO_DA_NOTA) - 1);
  return montar(`${p.origem.slice(0, sobra)}…`).slice(0, TETO_DA_NOTA);
}

/** Recusa da RPC em frase de gente. */
export function traduzirErroDaAprovacao(bruto: unknown): string {
  const m = String((bruto as { message?: string })?.message || bruto || '').replace(/^mesa:rpc_recusada\s+(aprovar_pelo_cliente:\s*)?/, '');
  if (/s[óo] admin ou gestor|admin or manager|not allowed|permission denied/i.test(m)) {
    return 'A credencial precisa ser de admin ou gestor da equipe para registrar a aprovação. Nada foi aprovado.';
  }
  if (/access denied|can_access_client|sem acesso/i.test(m)) return 'A pessoa conectada não tem acesso a este cliente. Nada foi aprovado.';
  return m ? `O painel recusou a aprovação: ${m.slice(0, 200)}` : 'O painel não respondeu. Tente de novo.';
}

// ------------------------------------------------------------------ dependências (o teste troca)

type Resultado = { data: unknown; error: { message: string } | null };
// deno-lint-ignore no-explicit-any
type Consulta = any;

export interface DependenciasDaAprovacaoInterna {
  /** Chave de serviço: só leitura. */
  banco: { from(tabela: string): Consulta };
  /** Escrita como a pessoa conectada (auth.uid() = ela). */
  rpc: (nome: 'aprovar_pelo_cliente', args: Record<string, unknown>, ctx: AuthContext) => Promise<unknown>;
  umaVez: typeof umaVez;
  agora?: () => Date;
}

function dependenciasPadrao(): DependenciasDaAprovacaoInterna {
  return { banco: db(), rpc: rpcComoPessoa, umaVez };
}

function lido<T>(r: Resultado, oque: string): T {
  if (r.error) throw new Error(`Não foi possível ler ${oque} agora. Tente de novo.`);
  return r.data as T;
}

type PostLido = {
  id: string;
  client_id: string;
  project_id: string | null;
  primary_file_id: string | null;
  title: string | null;
  production_status: string | null;
  archived_at: string | null;
};

const CAMPOS_DO_ARQUIVO = 'id, parent_file_id, archived_at, status, agency_approval_status, locked_at, visibility, approval_status, client_decided_at';
const PROXIMO_PASSO =
  'Crie a publicação com aceleriq_criar_publicacao_de_aprovado e agende com aceleriq_reagendar_publicacao. Esta ferramenta não agenda nem publica.';

// ------------------------------------------------------------------ handler

export async function registrarAprovacaoInterna(
  input: PedidoDeAprovacaoInterna,
  ctx: AuthContext,
  deps: DependenciasDaAprovacaoInterna = dependenciasPadrao(),
): Promise<Record<string, unknown>> {
  const { banco } = deps;
  const agora = deps.agora ? deps.agora() : new Date();
  const problemaData = problemaNaData(input.aprovado_pelo_dono_em, agora);
  if (problemaData) throw new Error(`Invalid input: ${problemaData}`);

  // 1) post
  const post = lido<PostLido | null>(
    await banco.from('editorial_posts')
      .select('id, client_id, project_id, primary_file_id, title, production_status, archived_at')
      .eq('id', input.post_id)
      .maybeSingle(),
    'o post da Agenda',
  );
  if (!post) throw new Error('Post não encontrado na Agenda.');
  // 2) fronteira do cliente antes de qualquer outra resposta.
  if (!dataScopeAllowsClient(ctx.dataScope, post.client_id)) {
    throw new DataScopeError('resource is outside this MCP principal data scope');
  }
  // 3) só o cliente interno; para os outros nada mais é lido nem escrito.
  if (!autoaprovacaoInternaLigada(post.client_id)) throw new Error(MENSAGEM_DESLIGADA);

  // 4) post em condição de ser aprovado.
  if (post.archived_at) throw new Error('Post arquivado na Agenda: use o post atual do conteúdo (a revisão mais nova). Nada foi aprovado.');
  if (post.production_status !== 'ready') throw new Error('O post não está pronto na Agenda (production_status precisa ser ready). Nada foi aprovado.');
  if (!post.primary_file_id) throw new Error('O post não tem arquivo principal na Agenda. Nada foi aprovado.');
  const interno = lido<{ approval_fingerprint: string | null } | null>(
    await banco.from('editorial_post_internal').select('post_id, approval_fingerprint').eq('post_id', post.id).maybeSingle(),
    'o estado interno do post',
  );
  if (!interno?.approval_fingerprint) {
    throw new Error('O post não tem o selo da aprovação (approval_fingerprint): grave o post na Agenda antes. Nada foi aprovado.');
  }

  // 5) arquivo raiz.
  const lerArquivo = async () =>
    lido<ArquivoDaAprovacao | null>(
      await banco.from('files').select(CAMPOS_DO_ARQUIVO).eq('id', post.primary_file_id).maybeSingle(),
      'o arquivo principal do post',
    );
  const arquivo = await lerArquivo();
  if (!arquivo) throw new Error('Arquivo principal do post não encontrado. Nada foi aprovado.');

  const base = { post_id: post.id, client_id: post.client_id, file_id: arquivo.id };
  if (aprovadoPeloCliente(arquivo)) {
    return {
      ok: true,
      ja_aprovado: true,
      ...base,
      estado: 'ja_aprovado',
      evento_id: null,
      aprovado_por: null,
      client_decided_at: arquivo.client_decided_at,
      locked_at: arquivo.locked_at,
      auditoria: null,
      proximo_passo: PROXIMO_PASSO,
    };
  }
  if (arquivo.approval_status === 'rejected' || arquivo.agency_approval_status === 'rejected') {
    throw new Error('O arquivo principal está recusado (pelo cliente ou pela agência): mande a nova versão antes. Nada foi aprovado.');
  }
  if (arquivo.archived_at) throw new Error('O arquivo principal está arquivado. Nada foi aprovado.');
  if (arquivo.parent_file_id) throw new Error('O arquivo principal do post é uma lâmina filha, não a raiz. Nada foi aprovado.');
  if ((arquivo.status || 'ready') !== 'ready') throw new Error('O arquivo principal ainda não está pronto (status precisa ser ready). Nada foi aprovado.');

  // 6) registra pelo caminho do painel, uma vez por idempotency_key.
  const feito = feitoPor(ctx);
  const registradoPor = feito.pessoa ?? ctx.keyId;
  const nota = notaDaAprovacao({
    aprovadoEm: input.aprovado_pelo_dono_em,
    origem: input.origem,
    registradoPor,
    postId: post.id,
  });

  return await deps.umaVez(NOME, ctx, input.idempotency_key, async () => {
    if (ctx.resultRefHolder) ctx.resultRefHolder.value = `files:${arquivo.id}`;
    let resposta: Record<string, unknown> = {};
    try {
      const r = await deps.rpc('aprovar_pelo_cliente', { p_file_id: arquivo.id, p_nota: nota }, ctx);
      if (r && typeof r === 'object') resposta = r as Record<string, unknown>;
    } catch (e) {
      // Falha de infraestrutura (sessão do dono, OAuth, configuração) sobe intacta para o agente ver o código e o transitorio.
      if (e instanceof Error && /^mesa:(dono_da_chave|exige_oauth|configuracao)\s/.test(e.message)) throw e;
      throw new Error(`mesa:rpc_recusada ${traduzirErroDaAprovacao(e)}`);
    }
    const relido = await lerArquivo();
    if (!aprovadoPeloCliente(relido)) {
      throw new Error('O painel respondeu, mas a aprovação não ficou registrada no arquivo principal. Leia o arquivo antes de repetir.');
    }
    const eventoId = typeof resposta.evento_id === 'string' ? resposta.evento_id : null;
    return {
      ref: eventoId ? `file_approval_events:${eventoId}` : `files:${arquivo.id}`,
      resultado: {
        ja_aprovado: false,
        ...base,
        estado: typeof resposta.estado === 'string' ? resposta.estado : 'aprovado',
        evento_id: eventoId,
        aprovado_por: resposta.aprovado_por ?? null,
        client_decided_at: relido!.client_decided_at,
        locked_at: relido!.locked_at,
        auditoria: {
          origem: input.origem,
          aprovado_pelo_dono_em: input.aprovado_pelo_dono_em,
          registrado_por: registradoPor,
          nota,
        },
        proximo_passo: PROXIMO_PASSO,
      },
    };
  }, { post_id: post.id });
}

const tool: ToolDefinition = {
  name: NOME,
  title: 'Registrar aprovação interna (cliente interno)',
  description:
    'Só para o cliente interno AcelerIQ (a própria agência): registra no painel a aprovação que o dono deu no chat para o arquivo principal de um post da Agenda, pelo mesmo caminho do painel quando o admin aprova pelo cliente (aprovar_pelo_cliente como a pessoa conectada, que precisa ser admin ou gestor; evento client_approved_offline com a nota de auditoria). Para qualquer outro cliente recusa sem ler nem escrever nada: a aprovação continua sendo do cliente no painel. Exige post pronto, com arquivo principal e selo da aprovação (approval_fingerprint); arquivo recusado, arquivado ou que não é a raiz recusa; já aprovado volta ja_aprovado true sem refazer. Não cria publicação, não agenda e não publica: depois use aceleriq_criar_publicacao_de_aprovado e aceleriq_reagendar_publicacao. Exige origem (onde o dono aprovou), aprovado_pelo_dono_em (ISO com fuso, não no futuro), confirmar=true, idempotency_key, editorial:write e o cliente no escopo.',
  scopes: ['editorial:write'],
  annotations: ESCRITA,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['post_id', 'origem', 'aprovado_pelo_dono_em', 'confirmar', 'idempotency_key'],
    properties: {
      post_id: { type: 'string', format: 'uuid', description: 'id do post da Agenda (editorial_posts.id) do cliente interno.' },
      origem: { type: 'string', minLength: 5, maxLength: 300, description: 'Onde o dono aprovou (ex.: "chat do Almir com a Lume").' },
      aprovado_pelo_dono_em: { type: 'string', format: 'date-time', description: 'Quando o dono aprovou, ISO 8601 com fuso (ex.: 2026-11-25T22:19:00-03:00). Não pode estar no futuro.' },
      confirmar: { type: 'boolean', const: true, description: 'Tem que ser true: registra a aprovação e trava o arquivo.' },
      idempotency_key: { type: 'string', description: 'Chave estável de 8 a 120 caracteres. Repetir não registra de novo.' },
    },
  },
  handler: async (input, ctx) => {
    const parsed = registrarAprovacaoInternaSchema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    return await registrarAprovacaoInterna(parsed.data, ctx);
  },
};

export const FERRAMENTA_DE_APROVACAO_INTERNA: readonly ToolDefinition[] = [tool];
