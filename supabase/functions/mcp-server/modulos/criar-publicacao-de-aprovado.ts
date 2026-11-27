/**
 * MCP 2.30.0 (18/11/2026): cria a publicação planejada (sem data) de um post
 * da Agenda que o cliente JÁ aprovou e que ainda não tem publicação.
 *
 * Caso real: posts com production_status 'ready', arquivo principal aprovado
 * pelo cliente e approval_fingerprint gravado, mas sem nenhuma linha em
 * editorial_publications. Sem publication_id, aceleriq_reagendar_publicacao
 * não tem o que agendar. Esta tool cria a linha e para aí: o agendamento é o
 * passo seguinte, pelo reagendar (com expected_version).
 *
 * Mesma regra do painel (estudio-arte/agenda-da-entrega.ts, confirmarComPerfis):
 * a escrita vai por save_editorial_post com o JWT da pessoa (o banco roteia
 * para save_approved_editorial_post_unlocked e confere acesso, projeto, conta e
 * o fingerprint da aprovação) e o payload sai de payloadComPerfis, com
 * quando=null e assetFileIds=null: sem data, sem delivery_mode e sem lâminas,
 * o banco só cria a publicação planejada. Nada agenda, nada publica.
 *
 * save_editorial_post recebe o array COMPLETO de publicações (o que faltar é
 * cancelado). Por isso, se o post já tem qualquer publicação viva, a RPC não
 * é chamada: devolve a existente (ja_existia=true). Só cancelada: recusa
 * (reabrir é ação humana na Agenda, igual ao reagendar).
 *
 * MCP 2.42.2 (27/11/2026): cliente com profiles.modo_aprovacao_do_cliente
 * exatamente 'dispensada' e arquivo principal aprovado pela agência (interno
 * ou liberado, sem decisão nem trava) também passa; post pronto sem selo deixa
 * o save canônico gravar o primeiro selo. Não grava aprovação nem
 * decisão do cliente; o banco (migration 20261127120000) confere a mesma regra
 * no save, no agendamento e no envio e registra a dispensa em cada publicação.
 */

import { z } from 'https://esm.sh/zod@3.23.8';
import type { ToolDefinition } from '../../_shared/mcp-tools.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { DataScopeError } from '../../_shared/mcp-auth.ts';
import { dataScopeAllowsClient } from '../../_shared/mcp-security.ts';
import { db } from './aceleriq-read-services.ts';
import { rpcComoPessoa, umaVez } from './mcp-mesas-acoes.ts';
import { payloadComPerfis, uuidEstavel, type PostExistente } from '../../estudio-arte/modulos/entrega-na-agenda.ts';
import { audioDaEntrada, ESQUEMA_AUDIO_CONFIGURATION, gravarAudioDaPublicacao } from './audio-instagram.ts';
import { problemaDoAudioNoConteudo } from './audio-instagram-regras.ts';

const UUID = z.string().uuid();
const ESCRITA = { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false };
const NOME = 'aceleriq_criar_publicacao_de_aprovado';

/** Onde a peça pode sair pela Agenda (o mesmo de PLATAFORMAS_DA_PECA do painel). meta_ads nunca. */
export const PLATAFORMAS_DA_PUBLICACAO = ['instagram', 'facebook'] as const;

export const criarPublicacaoSchema = z.object({
  post_id: UUID,
  external_account_id: UUID,
  confirmar: z.literal(true),
  idempotency_key: z.string().trim().min(8).max(120),
  // MCP 2.39.3: opcional, só Reel do Instagram (regras em audio-instagram-regras.ts). Ausente = igual a antes.
  audio_configuration: z.unknown().optional(),
}).strict();

export type PedidoDeCriarPublicacao = z.infer<typeof criarPublicacaoSchema>;

// ------------------------------------------------------------------ regras puras

export interface ArquivoDaAprovacao {
  id: string;
  parent_file_id: string | null;
  archived_at: string | null;
  status: string | null;
  agency_approval_status: string | null;
  locked_at: string | null;
  visibility: string | null;
  approval_status: string | null;
  client_decided_at: string | null;
}

/**
 * Aprovação real do cliente: a regra de arquivoAprovado do painel
 * (editorial_file_is_publishable: raiz, não arquivada, pronta, aprovada pela
 * agência e travada) e, além dela, a decisão do cliente gravada
 * (approval_status 'approved' com client_decided_at). Arquivo só
 * compartilhado (client_shared) sem decisão do cliente não passa aqui.
 */
export function aprovadoPeloCliente(f: ArquivoDaAprovacao | null): boolean {
  if (!f || f.parent_file_id || f.archived_at) return false;
  if ((f.status || 'ready') !== 'ready' || f.agency_approval_status !== 'approved' || !f.locked_at) return false;
  return f.approval_status === 'approved' && !!f.client_decided_at;
}

/** MCP 2.42.2: campos a mais lidos só para conferir a dispensa (o caminho do portal não os usa). */
export interface ArquivoDaDispensa extends ArquivoDaAprovacao {
  client_id?: string | null;
  project_id?: string | null;
  requires_approval?: boolean | null;
  client_decided_by?: string | null;
}

/** A regra EXATA do cadastro. Qualquer outro valor, ausente ou ilegível, é o portal. */
export const MODO_DISPENSADA = 'dispensada' as const;

/**
 * MCP 2.42.2 (27/11/2026): espelho de editorial_file_client_approval_waived
 * (migration 20261127120000). Cliente com modo_aprovacao_do_cliente =
 * 'dispensada' e a raiz do próprio cliente/projeto aprovada pela agência, sem
 * decisão do cliente e sem trava, em um de dois estados: interno
 * (internal/none/requires_approval false, o normal da agência) ou liberado
 * (approval/pending/requires_approval true). Não aprova nem decide nada: o
 * banco confere de novo no save, no agendamento e no envio, com o cadastro ao vivo.
 */
export function aprovacaoDispensada(
  f: ArquivoDaDispensa | null,
  modo: unknown,
  post: { client_id: string; project_id: string },
): boolean {
  if (modo !== MODO_DISPENSADA) return false;
  if (!f || f.parent_file_id || f.archived_at) return false;
  if (f.client_id !== post.client_id || f.project_id !== post.project_id) return false;
  if ((f.status || 'ready') !== 'ready' || f.agency_approval_status !== 'approved') return false;
  if (f.client_decided_at || f.client_decided_by || f.locked_at) return false;
  const interno = f.visibility === 'internal' && f.approval_status === 'none' && f.requires_approval === false;
  const liberado = f.visibility === 'approval' && f.approval_status === 'pending' && f.requires_approval === true;
  return interno || liberado;
}

export interface ContaExterna {
  id: string;
  client_id: string;
  platform: string;
  status: string;
}

/** Conta onde a publicação pode nascer: ativa, do cliente do post, Instagram ou Facebook e ligada ao projeto. */
export function problemaNaConta(
  conta: ContaExterna | null,
  clientId: string,
  ligadaAoProjeto: boolean,
): string | null {
  // Conta de outro cliente responde igual à inexistente: não vaza o outro cliente.
  if (!conta || conta.client_id !== clientId) return 'Conta não encontrada para o cliente deste post.';
  if (!(PLATAFORMAS_DA_PUBLICACAO as readonly string[]).includes(conta.platform)) {
    return `A conta é ${conta.platform}: publicação da Agenda só sai em Instagram ou Facebook.`;
  }
  if (conta.status !== 'active') return 'A conta não está ativa. Reconecte ou ative a conta na Agenda.';
  if (!ligadaAoProjeto) return 'A conta não está ligada ao projeto deste post. Ligue a conta ao projeto na Agenda.';
  return null;
}

/** Sementes estáveis: o mesmo post + conta gera sempre a mesma mutação e a mesma chave da publicação. */
export function sementesDaCriacao(postId: string, contaId: string) {
  return {
    trabalhoId: `mcp-criar-publicacao:${postId}`,
    mutacao: `mcp-criar-publicacao-mutacao:${postId}:${contaId}`,
  };
}

/**
 * Payload do save_editorial_post: o de payloadComPerfis (o mesmo do painel)
 * com quando=null e assetFileIds=null, uma publicação planejada para a conta.
 * O scheduled_at nulo sai do payload: o banco lê ausente igual a nulo e a
 * ferramenta nunca manda data.
 */
export async function payloadDaCriacao(
  post: PostExistente,
  conta: Pick<ContaExterna, 'id' | 'platform'>,
): Promise<{ payload: Record<string, unknown>; mutationId: string }> {
  const sementes = sementesDaCriacao(post.id, conta.id);
  const mutationId = await uuidEstavel(sementes.mutacao);
  const bruto = await payloadComPerfis({ ...post, publications: [] }, {
    trabalhoId: sementes.trabalhoId,
    rodada: 1,
    perfis: [{ id: conta.id, platform: conta.platform === 'facebook' ? 'facebook' : 'instagram', automatico: false }],
    quando: null,
    mutationId,
    assetFileIds: null,
  });
  const publicacoes = (bruto.publications as Record<string, unknown>[]).map((p) => {
    const { scheduled_at: _semData, delivery_mode: _semModo, asset_file_ids: _semLaminas, ...resto } = p;
    return resto;
  });
  return { payload: { ...bruto, publications: publicacoes }, mutationId };
}

/** Erro do banco em frase de gente (subconjunto de traduzirErroDaAgenda do painel). */
export function traduzirErroDaCriacao(bruto: unknown): string {
  const m = String((bruto as { message?: string })?.message || bruto || '');
  if (/approved editorial copy is immutable|create a revision/i.test(m)) {
    return 'A aprovação do cliente não bate mais com o post (o conteúdo mudou depois de aprovado). Peça a revisão na Agenda.';
  }
  if (/refresh before saving|post changed/i.test(m)) return 'O post mudou na Agenda enquanto isso. Leia de novo e repita.';
  if (/client access denied|access denied/i.test(m)) return 'A pessoa conectada não tem permissão na Agenda deste cliente.';
  if (/not linked to the project|account is inactive/i.test(m)) return 'A conta não está ativa ou não está ligada ao projeto deste post.';
  if (/cancelled publication stays cancelled/i.test(m)) {
    return 'Esta conta foi cancelada de propósito numa versão anterior do post. Um admin ou gestor marca a conta de novo na Agenda.';
  }
  if (/media is unavailable|outside the project|already linked to another content/i.test(m)) {
    return 'O arquivo aprovado não está disponível para este post na Agenda.';
  }
  if (/failed or published publications cannot be edited/i.test(m)) return 'O post já tem publicação que saiu ou falhou. Mude pela Agenda.';
  if (/idempotency key was reused|mutation id was reused/i.test(m)) {
    return 'A Agenda já registrou outra versão deste pedido. Leia o post e confira a publicação antes de repetir.';
  }
  return m ? `A Agenda recusou: ${m.slice(0, 240)}` : 'A Agenda não respondeu. Tente de novo.';
}

// ------------------------------------------------------------------ dependências (o teste troca)

type Resultado = { data: unknown; error: { message: string } | null };
// deno-lint-ignore no-explicit-any
type Consulta = any;

export interface DependenciasDaCriacao {
  /** Chave de serviço: só leitura. */
  banco: { from(tabela: string): Consulta };
  /** Escrita como a pessoa conectada (auth.uid() = ela). */
  rpc: (nome: 'save_editorial_post', args: Record<string, unknown>, ctx: AuthContext) => Promise<unknown>;
  umaVez: typeof umaVez;
  /** MCP 2.39.3: RPC do áudio do Reel, como a pessoa conectada. Só é chamada com audio_configuration. */
  rpcAudio?: (nome: string, args: Record<string, unknown>, ctx: AuthContext) => Promise<unknown>;
}

function dependenciasPadrao(): DependenciasDaCriacao {
  return { banco: db(), rpc: rpcComoPessoa, umaVez };
}

function lido<T>(r: Resultado, oque: string): T {
  if (r.error) throw new Error(`Não foi possível ler ${oque} agora. Tente de novo.`);
  return r.data as T;
}

type PublicacaoLida = { id: string; version: number; status: string; platform: string; external_account_id: string | null };

const paraResposta = (p: PublicacaoLida) => ({
  id: p.id,
  version: p.version,
  status: p.status,
  external_account_id: p.external_account_id,
  platform: p.platform,
});

const proximoPasso = (p: PublicacaoLida) =>
  `Para agendar, chame aceleriq_reagendar_publicacao com publication_id ${p.id} e expected_version ${p.version} (scheduled_at com fuso, confirmar=true e uma idempotency_key nova). Esta ferramenta não agenda nem publica.`;

// ------------------------------------------------------------------ handler

export async function criarPublicacaoDeAprovado(
  input: PedidoDeCriarPublicacao,
  ctx: AuthContext,
  deps: DependenciasDaCriacao = dependenciasPadrao(),
): Promise<Record<string, unknown>> {
  const { banco } = deps;
  const post = lido<(Omit<PostExistente, 'internal' | 'publications'>) | null>(
    await banco.from('editorial_posts')
      .select('id, version, client_id, project_id, primary_file_id, title, content_type, objective, default_caption, production_status, archived_at')
      .eq('id', input.post_id)
      .maybeSingle(),
    'o post da Agenda',
  );
  if (!post) throw new Error('Post não encontrado na Agenda.');
  // Fronteira do cliente antes de qualquer outra resposta ou escrita.
  if (!dataScopeAllowsClient(ctx.dataScope, post.client_id)) {
    throw new DataScopeError('resource is outside this MCP principal data scope');
  }
  if (post.archived_at) {
    throw new Error('Post arquivado na Agenda: não nasce publicação nele. Use o post atual do conteúdo (a revisão mais nova).');
  }
  // MCP 2.39.3: audio_configuration opcional, validado antes de qualquer escrita (Reel-only, volumes 1..100).
  const audio = audioDaEntrada(input.audio_configuration, { content_type: post.content_type });
  const rpcAudio = deps.rpcAudio ?? (rpcComoPessoa as unknown as NonNullable<DependenciasDaCriacao['rpcAudio']>);

  const [internoRes, pubsRes, arquivoRes] = await Promise.all([
    banco.from('editorial_post_internal')
      .select('post_id, idempotency_key, task_id, responsible_id, internal_notes, revision_of_post_id, approval_fingerprint')
      .eq('post_id', post.id)
      .maybeSingle(),
    banco.from('editorial_publications')
      .select('id, version, status, platform, external_account_id')
      .eq('post_id', post.id),
    post.primary_file_id
      ? banco.from('files')
        .select('id, client_id, project_id, parent_file_id, archived_at, status, agency_approval_status, locked_at, visibility, approval_status, requires_approval, client_decided_at, client_decided_by')
        .eq('id', post.primary_file_id)
        .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const interno = lido<(PostExistente['internal'] & { approval_fingerprint: string | null }) | null>(internoRes, 'o estado interno do post');
  const pubs = lido<PublicacaoLida[] | null>(pubsRes, 'as publicações do post') ?? [];
  const arquivo = lido<ArquivoDaDispensa | null>(arquivoRes, 'o arquivo principal do post');

  // Aprovação real: a mesma do painel. O banco ainda confere o fingerprint
  // contra editorial_compute_approval_fingerprint (a função não abre para a
  // chave de serviço); se não bater, a recusa volta traduzida.
  // MCP 2.42.2: sem decisão do cliente, só a regra exata do cadastro
  // (modo_aprovacao_do_cliente = 'dispensada') abre a exceção. O cadastro só é
  // lido quando o arquivo não tem a aprovação do cliente: o portal segue igual.
  let dispensada = false;
  if (!aprovadoPeloCliente(arquivo) && arquivo) {
    const perfil = lido<{ modo_aprovacao_do_cliente?: unknown } | null>(
      await banco.from('profiles').select('id, modo_aprovacao_do_cliente').eq('id', post.client_id).maybeSingle(),
      'a regra de aprovação do cliente',
    );
    dispensada = aprovacaoDispensada(arquivo, perfil?.modo_aprovacao_do_cliente, post);
  }
  // Selo ausente: só a dispensa exata deixa o save canônico gravar o PRIMEIRO
  // selo (o banco confere de novo; selo presente e divergente segue recusado).
  if (
    post.production_status !== 'ready'
    || !(aprovadoPeloCliente(arquivo) || dispensada)
    || (!interno?.approval_fingerprint && !dispensada)
    || (!interno && dispensada)
  ) {
    throw new Error('Post sem aprovação do cliente: o arquivo principal precisa estar aprovado pelo cliente e o post pronto na Agenda. Esta ferramenta não aprova.');
  }
  const regraDaDispensa = {
    modo: MODO_DISPENSADA,
    origem: 'profiles.modo_aprovacao_do_cliente',
    decisao_do_cliente: 'nenhuma: nada foi aprovado nem decidido em nome do cliente',
    arquivo: `a regra vale para o arquivo anexado ao post (${arquivo?.id ?? 'sem id'}), lido agora`,
  };
  // Criada agora: o gatilho do banco grava o evento na mesma transação do save.
  const aprovacaoDoCliente = dispensada
    ? {
      aprovacao_do_cliente: {
        ...regraDaDispensa,
        registro: 'o banco grava editorial_events client_approval_waived na publicação ao criar, agendar e publicar',
      },
    }
    : {};
  // Publicação existente: nenhum evento foi lido aqui; não afirma que existe.
  const aprovacaoDaExistente = dispensada
    ? {
      aprovacao_do_cliente: {
        ...regraDaDispensa,
        registro: 'não conferido: esta leitura não consulta o histórico de eventos da publicação existente',
      },
    }
    : {};

  const vivas = pubs.filter((p) => p.status !== 'cancelled');
  if (vivas.length) {
    const daConta = vivas.find((p) => p.external_account_id === input.external_account_id);
    const principal = daConta || vivas[0];
    let audioDaExistente: Record<string, unknown> | null = null;
    if (audio) {
      const problemaAudio = daConta ? problemaDoAudioNoConteudo({ content_type: post.content_type, platform: daConta.platform }) : null;
      audioDaExistente = !daConta
        ? { gravado: false, audio_configuration: audio, mensagem: 'O áudio não foi gravado: a publicação existente é de outra conta.' }
        : problemaAudio
        ? { gravado: false, audio_configuration: audio, mensagem: problemaAudio }
        : await gravarAudioDaPublicacao(daConta.id, audio, ctx, rpcAudio);
    }
    return {
      ok: true,
      ja_existia: true,
      ...aprovacaoDaExistente,
      ...(audioDaExistente ? { audio: audioDaExistente } : {}),
      publicacao: paraResposta(principal),
      ...(vivas.length > 1 ? { publicacoes: vivas.map(paraResposta) } : {}),
      ...(daConta ? {} : {
        aviso: 'O post já tem publicação em outra conta. Nada foi criado: acrescentar conta a um post aprovado é pela Agenda.',
      }),
      post_id: post.id,
      client_id: post.client_id,
      proximo_passo: proximoPasso(principal),
    };
  }
  if (pubs.length) {
    throw new Error('O post só tem publicação cancelada. Cancelada não reabre por agente: um admin ou gestor marca a conta de novo na Agenda.');
  }

  const [contaRes, ligacaoRes] = await Promise.all([
    banco.from('external_accounts')
      .select('id, client_id, platform, status')
      .eq('id', input.external_account_id)
      .maybeSingle(),
    banco.from('project_external_accounts')
      .select('external_account_id')
      .eq('project_id', post.project_id)
      .eq('external_account_id', input.external_account_id)
      .eq('client_id', post.client_id),
  ]);
  const conta = lido<ContaExterna | null>(contaRes, 'a conta');
  const ligacoes = lido<unknown[] | null>(ligacaoRes, 'as contas do projeto') ?? [];
  const problema = problemaNaConta(conta, post.client_id, ligacoes.length > 0);
  if (problema) throw new Error(problema);
  if (audio) {
    const problemaAudio = problemaDoAudioNoConteudo({ content_type: post.content_type, platform: conta!.platform });
    if (problemaAudio) throw new Error(`Invalid input: ${problemaAudio}`);
  }

  const postParaSalvar: PostExistente = {
    ...post,
    internal: interno
      ? {
        idempotency_key: interno.idempotency_key,
        task_id: interno.task_id,
        responsible_id: interno.responsible_id,
        internal_notes: interno.internal_notes,
        revision_of_post_id: interno.revision_of_post_id,
      }
      : null,
    publications: [],
  };
  const { payload } = await payloadDaCriacao(postParaSalvar, conta!);

  return await deps.umaVez(NOME, ctx, input.idempotency_key, async () => {
    if (ctx.resultRefHolder) ctx.resultRefHolder.value = `editorial_posts:${post.id}`;
    try {
      await deps.rpc('save_editorial_post', { p_payload: payload, p_expected_version: post.version }, ctx);
    } catch (e) {
      // Falha de infraestrutura (sessão do dono, OAuth, configuração) sobe intacta para o agente ver o código e o transitorio.
      if (e instanceof Error && /^mesa:(dono_da_chave|exige_oauth|configuracao)\s/.test(e.message)) throw e;
      throw new Error(`mesa:rpc_recusada ${traduzirErroDaCriacao(e)}`);
    }
    const relidas = lido<PublicacaoLida[] | null>(
      await banco.from('editorial_publications')
        .select('id, version, status, platform, external_account_id')
        .eq('post_id', post.id)
        .eq('external_account_id', input.external_account_id),
      'a publicação criada',
    ) ?? [];
    const criada = relidas.find((p) => p.status !== 'cancelled') || null;
    if (!criada) {
      return {
        ref: `editorial_posts:${post.id}`,
        resultado: {
          ja_existia: false,
          publicacao: null,
          post_id: post.id,
          client_id: post.client_id,
          aviso: 'A Agenda aceitou, mas a publicação não apareceu na releitura. Leia o post com aceleriq_list_editorial_calendar antes de repetir.',
        },
      };
    }
    return {
      ref: `editorial_publications:${criada.id}`,
      resultado: {
        ja_existia: false,
        publicacao: paraResposta(criada),
        post_id: post.id,
        client_id: post.client_id,
        ...aprovacaoDoCliente,
        ...(audio ? { audio: await gravarAudioDaPublicacao(criada.id, audio, ctx, rpcAudio) } : {}),
        proximo_passo: proximoPasso(criada),
      },
    };
  }, { post_id: input.post_id, external_account_id: input.external_account_id });
}

const tool: ToolDefinition = {
  name: NOME,
  title: 'Criar publicação de post aprovado',
  description:
    'Cria a publicação planejada, sem data, de um post da Agenda já aprovado pelo cliente que ainda não tem publicação (o caso de peça aprovada sem publication_id), na conta pedida. Exceção (2.42.2): cliente com modo_aprovacao_do_cliente exatamente "dispensada" no cadastro e arquivo principal aprovado pela agência (interno ou já liberado), sem decisão do cliente e sem trava; sem pedir o cliente; o banco registra a dispensa na publicação criada (aprovacao_do_cliente na resposta vale para o arquivo anexado) e nunca grava aprovação do cliente. Portal ou regra desconhecida: só com a aprovação do cliente; só compartilhado, ajuste pedido, arquivado ou sem aprovação interna recusam. Conta (external_account_id: Instagram ou Facebook ativo, do cliente e ligado ao projeto do post). Usa o mesmo caminho do painel (save_editorial_post como a pessoa conectada). Não aprova, não agenda e não publica. Se o post já tem publicação viva, não cria nada e devolve a existente (ja_existia true); só cancelada recusa (reabrir é ação humana na Agenda). Devolve publicacao {id, version, status, external_account_id, platform} e proximo_passo: agendar com aceleriq_reagendar_publicacao (publication_id e expected_version=version). audio_configuration opcional (2.39.3): só Reel do Instagram, grava o áudio da Meta na publicação (aceleriq_definir_audio_reel). Exige confirmar=true, idempotency_key, editorial:write e o cliente no escopo.',
  scopes: ['editorial:write'],
  annotations: ESCRITA,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['post_id', 'external_account_id', 'confirmar', 'idempotency_key'],
    properties: {
      post_id: { type: 'string', format: 'uuid', description: 'id do post da Agenda (editorial_posts.id).' },
      external_account_id: { type: 'string', format: 'uuid', description: 'Conta do Instagram ou página do Facebook do cliente, ligada ao projeto do post.' },
      confirmar: { type: 'boolean', const: true, description: 'Tem que ser true: cria a publicação que o cliente pode ver na Agenda.' },
      idempotency_key: { type: 'string', description: 'Chave estável de 8 a 120 caracteres. Repetir não cria de novo.' },
      audio_configuration: ESQUEMA_AUDIO_CONFIGURATION,
    },
  },
  handler: async (input, ctx) => {
    const parsed = criarPublicacaoSchema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    return await criarPublicacaoDeAprovado(parsed.data, ctx);
  },
};

export const FERRAMENTA_DE_CRIAR_PUBLICACAO: readonly ToolDefinition[] = [tool];
