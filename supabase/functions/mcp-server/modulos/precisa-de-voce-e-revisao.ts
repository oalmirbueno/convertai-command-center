/**
 * Agência autogerenciável (MCP 2.28.0, 14/11/2026): três ferramentas para os
 * agentes fecharem o ciclo sem puxar o dono para o que a equipe resolve.
 *
 * - aceleriq_revisar_trabalho_interno: a revisão interna de uma peça do
 *   Estúdio (aprovado ou ajuste), pela RPC da Esteira fase 2, como a pessoa
 *   da credencial. O carimbo guarda quem revisou e quando.
 * - aceleriq_listar_precisa_de_voce: só leitura. O que cairia na caixa
 *   "Precisa de você" do painel, com as mesmas regras (precisa-de-voce-regras.ts).
 * - aceleriq_marcar_precisa_de_voce: o agente abre um pedido para o dono, com
 *   o motivo, sem precisar de vínculo de execução (RPC marcar_precisa_do_dono).
 *
 * Limite das duas escritas, e é o ponto do módulo: elas nunca respondem pelo
 * cliente, nunca põem nada na agenda e nunca levam nada ao ar. Cada uma chama
 * uma única RPC, com a sessão da pessoa (auth.uid() é ela), e a regra de quem
 * pode mora na RPC. A chave de serviço só é usada para ler.
 */

import { z } from 'https://esm.sh/zod@3.23.8';
import type { ToolDefinition } from '../../_shared/mcp-tools.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { DataScopeError } from '../../_shared/mcp-auth.ts';
import { dataScopeAllowsClient } from '../../_shared/mcp-security.ts';
import { db } from './aceleriq-read-services.ts';
import { rpcComoPessoa, umaVez } from './mcp-mesas-acoes.ts';
import type { RpcDaPonte } from './mcp-mesas-ponte.ts';
import {
  APROVACAO_EM_ABERTO,
  LINHAS_DO_DONO_VAZIAS,
  montarPedidosDoDono,
  pedidosNoEscopo,
  ROTULO_DO_TIPO,
  TIPOS_DO_PEDIDO,
  type LinhaDeAprovacao,
  type LinhaDeArquivoRejeitado,
  type LinhaDeRejeicao,
  type LinhaDeTrabalhoRejeitado,
  type LinhaDeVinculoDaExecucao,
  type LinhasDoDono,
  type PedidoDoDono,
  type TipoDoPedido,
} from './precisa-de-voce-regras.ts';

const UUID = z.string().uuid();
const CHAVE = z.string().trim().min(8).max(120);
const ESCRITA = { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false };
const LEITURA = { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false };

const FORA_DO_ESCOPO = 'resource is outside this MCP principal data scope';
const entradaInvalida = (erro: z.ZodError) => new Error(`Invalid input: ${erro.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);

/** O que as duas escritas deixam igual. Vai em toda resposta, para o agente não supor o contrário. */
export const O_QUE_NAO_MUDOU = {
  aprovacao_do_cliente: 'não alterada',
  agendamento: 'nada foi agendado',
  publicacao: 'nada foi publicado',
} as const;

/** As portas das escritas: a RPC como a pessoa e a idempotência do MCP. Trocadas nos testes. */
export interface PortaDeEscrita {
  rpc: (nome: RpcDaPonte, args: Record<string, unknown>, ctx: AuthContext) => Promise<unknown>;
  umaVez: typeof umaVez;
}

const PORTA_DE_ESCRITA: PortaDeEscrita = { rpc: rpcComoPessoa, umaVez };

// ───────────────────────────────────────────────── A) revisão interna

/** Menor nota aceita no ajuste; a RPC confere de novo. */
export const NOTA_MINIMA_DO_AJUSTE = 10;

export const revisarTrabalhoSchema = z.object({
  trabalho_id: UUID,
  decisao: z.enum(['aprovado', 'ajuste']),
  nota: z.string().trim().max(1000).optional(),
  idempotency_key: CHAVE,
}).strict().superRefine((v, c) => {
  if (v.decisao === 'ajuste' && (v.nota ?? '').length < NOTA_MINIMA_DO_AJUSTE) {
    c.addIssue({ code: z.ZodIssueCode.custom, path: ['nota'], message: `No ajuste, diga o que precisa mudar (pelo menos ${NOTA_MINIMA_DO_AJUSTE} caracteres).` });
  }
});

export interface PortaDaRevisao extends PortaDeEscrita {
  /** A peça e o cliente dela, para conferir o escopo antes de qualquer escrita. */
  lerTrabalho: (id: string) => Promise<{ id: string; client_id: string } | null>;
}

async function lerTrabalhoDoEstudio(id: string): Promise<{ id: string; client_id: string } | null> {
  const { data, error } = await db().from('estudio_trabalhos').select('id, client_id').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { id: string; client_id: string } | null) ?? null;
}

export async function revisarTrabalhoInterno(
  input: z.infer<typeof revisarTrabalhoSchema>,
  ctx: AuthContext,
  porta: PortaDaRevisao = { ...PORTA_DE_ESCRITA, lerTrabalho: lerTrabalhoDoEstudio },
) {
  const trabalho = await porta.lerTrabalho(input.trabalho_id);
  if (!trabalho) throw new Error('Peça do Estúdio não encontrada.');
  if (!dataScopeAllowsClient(ctx.dataScope, trabalho.client_id)) throw new DataScopeError(FORA_DO_ESCOPO);

  return await porta.umaVez('aceleriq_revisar_trabalho_interno', ctx, input.idempotency_key, async () => {
    const ref = `estudio_trabalhos:${trabalho.id}`;
    if (ctx.resultRefHolder) ctx.resultRefHolder.value = ref;
    const revisao = await porta.rpc('revisar_trabalho_interno', {
      p_trabalho_id: trabalho.id,
      p_decisao: input.decisao,
      p_nota: input.nota || null,
    }, ctx);
    return {
      ref,
      resultado: {
        revisao,
        client_id: trabalho.client_id,
        ...O_QUE_NAO_MUDOU,
        proximo_passo: input.decisao === 'aprovado'
          ? 'A revisão interna está registrada. A peça ainda depende do envio ao cliente e da resposta dele; esta ferramenta não faz nenhum dos dois.'
          : 'O ajuste está registrado com a nota. Quem produz corrige a arte; uma arte nova pede revisão nova.',
      },
    };
  });
}

const ferramentaDeRevisar: ToolDefinition = {
  name: 'aceleriq_revisar_trabalho_interno',
  title: 'Revisão interna de uma peça do Estúdio',
  description:
    'Registra a revisão interna de uma peça do Estúdio: aprovado ou ajuste, com quem revisou e quando. No ajuste a nota é obrigatória (pelo menos 10 caracteres) e diz o que precisa mudar. Roda como a pessoa da credencial; só a equipe (admin, gestor, design, tráfego) com acesso ao cliente revisa. A aprovação do cliente NÃO muda: esta ferramenta não aprova pelo cliente, não envia ao cliente, não agenda e não publica. Só vale para peça com a arte pronta e que ainda não seguiu para o cliente. Repetir a mesma decisão para a mesma arte devolve o que já estava registrado. Exige idempotency_key, mesas:write e o cliente no escopo.',
  scopes: ['mesas:write'],
  annotations: ESCRITA,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['trabalho_id', 'decisao', 'idempotency_key'],
    properties: {
      trabalho_id: { type: 'string', format: 'uuid', description: 'Id da peça (estudio_trabalhos.id), como em aceleriq_estudio_trabalhos.' },
      decisao: { type: 'string', enum: ['aprovado', 'ajuste'], description: 'aprovado: a arte passa na revisão interna. ajuste: volta para quem produz, com a nota.' },
      nota: { type: 'string', maxLength: 1000, description: 'O que a revisão observou. Obrigatória no ajuste, com pelo menos 10 caracteres.' },
      idempotency_key: { type: 'string', description: 'Chave estável de 8 a 120 caracteres. Repetir não revisa de novo.' },
    },
  },
  handler: async (input, ctx) => {
    const parsed = revisarTrabalhoSchema.safeParse(input ?? {});
    if (!parsed.success) throw entradaInvalida(parsed.error);
    return await revisarTrabalhoInterno(parsed.data, ctx);
  },
};

// ───────────────────────────────────────────────── C) marcar para o dono

export const marcarPrecisaDeVoceSchema = z.object({
  operator: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9-]{1,38}$/, 'slug do operador, como em aceleriq_operator_board'),
  o_que: z.string().trim().min(10).max(2000),
  por_que: z.string().trim().min(10).max(2000),
  client_id: UUID.optional(),
  link_id: UUID.optional(),
  kanban_task_id: UUID.optional(),
  custo_previsto: z.number().min(0).optional(),
  idempotency_key: CHAVE,
}).strict();

export async function marcarPrecisaDeVoce(
  input: z.infer<typeof marcarPrecisaDeVoceSchema>,
  ctx: AuthContext,
  porta: PortaDeEscrita = PORTA_DE_ESCRITA,
) {
  // Credencial presa a clientes só marca pedido de um cliente dela.
  if (input.client_id) {
    if (!dataScopeAllowsClient(ctx.dataScope, input.client_id)) throw new DataScopeError(FORA_DO_ESCOPO);
  } else if (!ctx.dataScope.unrestricted) {
    throw new DataScopeError('esta credencial é restrita a clientes: informe o client_id do pedido');
  }

  return await porta.umaVez('aceleriq_marcar_precisa_de_voce', ctx, input.idempotency_key, async () => {
    const pedido = await porta.rpc('marcar_precisa_do_dono', {
      p_operator_slug: input.operator,
      p_o_que: input.o_que,
      p_por_que: input.por_que,
      p_request_key: input.idempotency_key,
      p_client_id: input.client_id ?? null,
      p_link_id: input.link_id ?? null,
      p_kanban_task_id: input.kanban_task_id ?? null,
      p_custo_previsto: typeof input.custo_previsto === 'number' ? input.custo_previsto : null,
    }, ctx);
    const id = pedido && typeof pedido === 'object' ? String((pedido as Record<string, unknown>).approval_id ?? '') : '';
    return {
      ref: id ? `operator_approvals:${id}` : null,
      resultado: {
        pedido,
        ...O_QUE_NAO_MUDOU,
        proximo_passo: 'O pedido está na Execução e na caixa "Precisa de você", esperando o dono. Não repita o pedido e não aja como se ele tivesse sido aceito; acompanhe com aceleriq_listar_precisa_de_voce.',
      },
    };
  });
}

const ferramentaDeMarcar: ToolDefinition = {
  name: 'aceleriq_marcar_precisa_de_voce',
  title: 'Marcar uma decisão que depende do dono',
  description:
    'Abre um pedido para o dono quando a decisão realmente depende dele (dinheiro, cliente, plano, mudança de rumo), dizendo o que precisa ser decidido e por quê. Não exige vínculo de execução, ao contrário de aceleriq_operator_request_approval. O pedido entra em aberto na Execução e na caixa "Precisa de você" da Esteira, e os admins são avisados no painel. Esta chamada só pergunta: NÃO aprova, NÃO agenda, NÃO publica, não muda arquivo nem peça e não fala com o cliente. Não use para o que a equipe resolve sozinha nem para registrar o que foi feito (isso é aceleriq_operator_diary). A mesma idempotency_key devolve o pedido que já existe. Roda como a pessoa da credencial (equipe); credencial restrita a clientes precisa informar client_id.',
  scopes: ['mesas:write'],
  annotations: ESCRITA,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['operator', 'o_que', 'por_que', 'idempotency_key'],
    properties: {
      operator: { type: 'string', pattern: '^[a-z][a-z0-9-]{1,38}$', description: 'Slug do agente que pede (como em aceleriq_operator_board). Precisa estar ativo.' },
      o_que: { type: 'string', minLength: 10, maxLength: 2000, description: 'O que precisa ser decidido, em uma frase concreta.' },
      por_que: { type: 'string', minLength: 10, maxLength: 2000, description: 'Por que só o dono decide isto e o que você já preparou.' },
      client_id: { type: 'string', format: 'uuid', description: 'Cliente do pedido, quando houver. Sem cliente, vale como operação interna.' },
      link_id: { type: 'string', format: 'uuid', description: 'Vínculo de execução relacionado, se existir. Opcional; nada nele é alterado.' },
      kanban_task_id: { type: 'string', format: 'uuid', description: 'Tarefa do Kanban relacionada, se existir. Opcional; nada nela é alterado.' },
      custo_previsto: { type: 'number', minimum: 0, description: 'Custo em reais, quando houver. Com custo, o pedido entra como dinheiro na caixa.' },
      idempotency_key: { type: 'string', description: 'Chave estável de 8 a 120 caracteres. Repetir devolve o mesmo pedido.' },
    },
  },
  handler: async (input, ctx) => {
    const parsed = marcarPrecisaDeVoceSchema.safeParse(input ?? {});
    if (!parsed.success) throw entradaInvalida(parsed.error);
    return await marcarPrecisaDeVoce(parsed.data, ctx);
  },
};

// ───────────────────────────────────────────────── B) a caixa, só leitura

/** Tetos de leitura: a caixa é um resumo do que espera o dono, não um relatório. */
const TETO_DE_APROVACOES = 200;
const TETO_DE_VINCULOS = 100;
const TETO_DE_PROPOSTAS = 50;
const TETO_DE_REJEICOES = 500;
const TETO_DE_TRABALHOS = 200;
const LOTE = 100;
const DIAS_DA_PROPOSTA = 14;
const DIAS_DA_REJEICAO = 90;
export const TETO_DE_HOPS_DA_CADEIA = 8;

export type FonteDaCaixa = 'aprovacoes' | 'vinculos' | 'anuncios' | 'rejeicoes';

export interface LeituraDoDono {
  linhas: LinhasDoDono;
  /** Fontes que não puderam ser lidas agora. */
  fontesComErro: FonteDaCaixa[];
  /** Fontes que bateram no teto da leitura, antes do filtro de escopo. A lista pode estar incompleta. */
  fontesNoTeto: FonteDaCaixa[];
}

type Resposta = { data: unknown[] | null; error: { message?: string; code?: string } | null };
// O construtor de consultas do supabase-js, visto só pelo que este módulo usa.
// deno-lint-ignore no-explicit-any
type Banco = any;

async function linhasDe<T>(consulta: PromiseLike<Resposta>): Promise<T[]> {
  const { data, error } = await consulta;
  if (error) throw error;
  return (data ?? []) as T[];
}

const emLotes = (ids: string[]): string[][] => {
  const unicos = Array.from(new Set(ids.filter(Boolean)));
  const lotes: string[][] = [];
  for (let i = 0; i < unicos.length; i += LOTE) lotes.push(unicos.slice(i, i + LOTE));
  return lotes;
};

const diasAtras = (agora: Date, dias: number) => new Date(agora.getTime() - dias * 86_400_000).toISOString();

const tabelaAusente = (erro: { message?: string; code?: string } | null | undefined): boolean =>
  Boolean(erro) && (erro!.code === '42P01' || erro!.code === 'PGRST205' || /does not exist|could not find the table|schema cache/i.test(erro!.message || ''));

const COLUNAS_DO_ARQUIVO = 'id, client_id, file_name, revision_of_file_id, approval_status, archived_at, created_at';

/** Completa a cadeia de versões para a frente: sem isso, a peça já resolvida uns passos adiante continuaria na caixa. */
async function completarCadeiaDeArquivos(banco: Banco, iniciais: LinhaDeArquivoRejeitado[]): Promise<LinhaDeArquivoRejeitado[]> {
  const porId = new Map(iniciais.map((a) => [a.id, a]));
  let fronteira = iniciais.map((a) => a.id);
  for (let hop = 0; hop < TETO_DE_HOPS_DA_CADEIA && fronteira.length; hop += 1) {
    const filhos = (await Promise.all(emLotes(fronteira).map((lote) =>
      linhasDe<LinhaDeArquivoRejeitado>(banco.from('staff_files_secure').select(COLUNAS_DO_ARQUIVO).in('revision_of_file_id', lote))
    ))).flat();
    const novos: string[] = [];
    for (const a of filhos) {
      if (porId.has(a.id)) continue;
      porId.set(a.id, a);
      novos.push(a.id);
    }
    fronteira = novos;
  }
  return Array.from(porId.values());
}

async function lerRejeicoes(banco: Banco, agora: Date): Promise<Pick<LinhasDoDono, 'rejeicoes' | 'arquivos' | 'trabalhos'>> {
  const [rejeicoes, trabalhosBrutos] = await Promise.all([
    linhasDe<LinhaDeRejeicao>(
      banco.from('file_approval_events').select('id, file_id, client_id, created_at, feedback')
        .eq('event_type', 'client_rejected').gte('created_at', diasAtras(agora, DIAS_DA_REJEICAO))
        .order('created_at', { ascending: false }).limit(TETO_DE_REJEICOES)),
    linhasDe<LinhaDeTrabalhoRejeitado>(
      banco.from('estudio_trabalhos').select('id, client_id, task_id, post_id, entrega_status, file_ids, ajustes_do_cliente')
        .gte('entrega_rodada', 3).or('entrega_status.is.null,entrega_status.not.in.(aprovado,agendado)')
        .order('atualizado_em', { ascending: false }).limit(TETO_DE_TRABALHOS)),
  ]);
  const [rejeitados, tarefas] = await Promise.all([
    Promise.all(emLotes(rejeicoes.map((r) => r.file_id)).map((lote) => linhasDe<LinhaDeArquivoRejeitado>(banco.from('staff_files_secure').select(COLUNAS_DO_ARQUIVO).in('id', lote)))),
    Promise.all(emLotes(trabalhosBrutos.map((t) => t.task_id || '')).map((lote) => linhasDe<{ id: string; title: string | null }>(banco.from('tasks').select('id, title').in('id', lote)))),
  ]);
  const arquivos = await completarCadeiaDeArquivos(banco, rejeitados.flat());
  const tituloDaTarefa = new Map(tarefas.flat().map((t) => [t.id, t.title]));
  const trabalhos = trabalhosBrutos.map((t) => ({ ...t, titulo: t.task_id ? tituloDaTarefa.get(t.task_id) ?? null : null }));
  return { rejeicoes, arquivos, trabalhos };
}

/**
 * Lê tudo o que a caixa precisa, em poucas consultas para a casa inteira.
 * Nunca lança: a fonte com erro entra em `fontesComErro` e as outras seguem.
 */
export async function lerLinhasDoDono(banco: Banco, agora: Date = new Date()): Promise<LeituraDoDono> {
  const [aprovacoes, vinculos, anuncios, rejeicoes] = await Promise.allSettled([
    linhasDe<LinhaDeAprovacao>(
      banco.from('operator_approvals').select('id, status, action_kind, o_que, por_que, custo_previsto, client_id, task_link_id, created_at, invalidated_at')
        .in('status', [...APROVACAO_EM_ABERTO]).order('created_at', { ascending: false }).limit(TETO_DE_APROVACOES)),
    linhasDe<LinhaDeVinculoDaExecucao>(
      banco.from('operator_task_links').select('id, status, approval_required, block_reason, next_step, last_action, updated_at')
        .eq('approval_required', true).neq('status', 'done').order('updated_at', { ascending: false }).limit(TETO_DE_VINCULOS)),
    (async () => {
      const { data, error } = await banco.from('ads_rotina_acoes').select('*').eq('estado', 'proposta')
        .gte('criado_em', diasAtras(agora, DIAS_DA_PROPOSTA)).order('criado_em', { ascending: false }).limit(TETO_DE_PROPOSTAS);
      if (error && !tabelaAusente(error)) throw error;
      return (data ?? []) as unknown[];
    })(),
    lerRejeicoes(banco, agora),
  ]);

  const fontesComErro: FonteDaCaixa[] = [];
  const valor = <T,>(r: PromiseSettledResult<T>, fonte: FonteDaCaixa, vazio: T): T => {
    if (r.status === 'fulfilled') return r.value;
    fontesComErro.push(fonte);
    return vazio;
  };
  const partes = valor(rejeicoes, 'rejeicoes', { rejeicoes: [], arquivos: [], trabalhos: [] });
  const linhas: LinhasDoDono = {
    ...LINHAS_DO_DONO_VAZIAS,
    aprovacoes: valor(aprovacoes, 'aprovacoes', []),
    vinculos: valor(vinculos, 'vinculos', []),
    acoesDeAnuncio: valor(anuncios, 'anuncios', []),
    ...partes,
  };
  const fontesNoTeto: FonteDaCaixa[] = [];
  if (linhas.aprovacoes.length >= TETO_DE_APROVACOES) fontesNoTeto.push('aprovacoes');
  if (linhas.vinculos.length >= TETO_DE_VINCULOS) fontesNoTeto.push('vinculos');
  if (linhas.acoesDeAnuncio.length >= TETO_DE_PROPOSTAS) fontesNoTeto.push('anuncios');
  if (linhas.rejeicoes.length >= TETO_DE_REJEICOES || linhas.trabalhos.length >= TETO_DE_TRABALHOS) fontesNoTeto.push('rejeicoes');
  return { linhas, fontesComErro, fontesNoTeto };
}

interface Carteira {
  nomes: Map<string, string>;
  /** null quando o cadastro não pôde ser lido: aí a caixa não corta por cliente ativo. */
  ativos: Set<string> | null;
}

/** Nome e situação dos clientes citados nas linhas (uma leitura em lote). */
async function lerCarteira(banco: Banco, ids: string[]): Promise<Carteira> {
  const nomes = new Map<string, string>();
  const ativos = new Set<string>();
  try {
    for (const lote of emLotes(ids)) {
      const linhas = await linhasDe<{ id: string; company_name: string | null; full_name: string | null; plan_status: string | null; deleted_at: string | null }>(
        banco.from('profiles').select('id, company_name, full_name, plan_status, deleted_at').in('id', lote));
      for (const c of linhas) {
        const nome = String(c.company_name || c.full_name || '');
        if (nome) nomes.set(String(c.id), nome);
        if (c.plan_status === 'active' && !c.deleted_at) ativos.add(String(c.id));
      }
    }
    return { nomes, ativos };
  } catch {
    return { nomes, ativos: null };
  }
}

const clientesDasLinhas = (linhas: LinhasDoDono): string[] => [
  ...linhas.aprovacoes.map((a) => a.client_id),
  ...linhas.acoesDeAnuncio.map((l) => (l && typeof l === 'object' ? (l as Record<string, unknown>).client_id : null)),
  ...linhas.rejeicoes.map((r) => r.client_id),
  ...linhas.trabalhos.map((t) => t.client_id),
].filter((id): id is string => typeof id === 'string' && id.length > 0);

export const listarPrecisaDeVoceSchema = z.object({
  tipo: z.enum(['dinheiro', 'cliente_ou_plano', 'rejeicao_repetida', 'decisao_de_agente']).optional(),
  client_id: UUID.optional(),
  limite: z.number().int().min(1).max(200).optional(),
}).strict();

const itemDaCaixa = (p: PedidoDoDono) => ({
  tipo: p.tipo,
  tipo_rotulo: ROTULO_DO_TIPO[p.tipo],
  cliente: p.cliente,
  client_id: p.clientId,
  o_que: p.oQue,
  por_que: p.porQue,
  link: p.link,
  onde: p.onde,
  quando: p.quando,
  ids: p.ids,
});

export async function listarPrecisaDeVoce(
  input: z.infer<typeof listarPrecisaDeVoceSchema>,
  ctx: AuthContext,
  banco: Banco = db(),
  agora: Date = new Date(),
) {
  if (input.client_id && !dataScopeAllowsClient(ctx.dataScope, input.client_id)) throw new DataScopeError(FORA_DO_ESCOPO);

  const leitura = await lerLinhasDoDono(banco, agora);
  const carteira = await lerCarteira(banco, clientesDasLinhas(leitura.linhas));
  const todos = montarPedidosDoDono({
    ...leitura.linhas,
    nomeDe: (id) => (id ? carteira.nomes.get(id) ?? null : null),
    clientesAtivos: carteira.ativos ?? undefined,
  });

  const visiveis = pedidosNoEscopo(todos, ctx.dataScope)
    .filter((p) => !input.client_id || p.clientId === input.client_id)
    .filter((p) => !input.tipo || p.tipo === input.tipo);
  const limite = input.limite ?? 50;
  const porTipo = Object.fromEntries(TIPOS_DO_PEDIDO.map((t) => [t, visiveis.filter((p) => p.tipo === t).length])) as Record<TipoDoPedido, number>;

  return {
    total: visiveis.length,
    por_tipo: porTipo,
    itens: visiveis.slice(0, limite).map(itemDaCaixa),
    tem_mais: visiveis.length > limite,
    incompleta: leitura.fontesComErro.length > 0 || leitura.fontesNoTeto.length > 0,
    fontes_com_erro: leitura.fontesComErro,
    fontes_no_teto: leitura.fontesNoTeto,
    regra: 'Só leitura: a lista aponta onde cada assunto se resolve no painel e não decide nada. O link é o caminho dentro do painel.',
  };
}

const ferramentaDeListar: ToolDefinition = {
  name: 'aceleriq_listar_precisa_de_voce',
  title: 'O que precisa do dono agora',
  description:
    'Só leitura. Devolve o que cairia na caixa "Precisa de você" da Esteira, com as mesmas regras do painel: dinheiro e verba (pedido com custo, ação de gasto, proposta do agente de tráfego), cliente novo ou plano, peça que o cliente rejeitou mais de uma vez e decisão pedida por agente. Cada item traz tipo, cliente, o_que, por_que, link e onde se resolve no painel, quando e os ids úteis. Use antes de abrir pedido novo (para não repetir o que já está aberto) e para saber o que está parado esperando o dono. Fica de fora, de propósito: a fila inteira da Execução, saldo baixo e atrasos do dia. Filtros opcionais: tipo, client_id e limite (padrão 50). Credencial restrita a clientes só vê os pedidos dos seus clientes.',
  scopes: ['aceleriq:read'],
  annotations: LEITURA,
  cacheSeg: 30,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      tipo: { type: 'string', enum: ['dinheiro', 'cliente_ou_plano', 'rejeicao_repetida', 'decisao_de_agente'], description: 'Só um tipo de pedido.' },
      client_id: { type: 'string', format: 'uuid', description: 'Só os pedidos deste cliente.' },
      limite: { type: 'integer', minimum: 1, maximum: 200, description: 'Quantos itens devolver. Padrão 50.' },
    },
  },
  handler: async (input, ctx) => {
    const parsed = listarPrecisaDeVoceSchema.safeParse(input ?? {});
    if (!parsed.success) throw entradaInvalida(parsed.error);
    return await listarPrecisaDeVoce(parsed.data, ctx);
  },
};

export const FERRAMENTAS_DE_PRECISA_DE_VOCE_E_REVISAO: readonly ToolDefinition[] = [
  ferramentaDeRevisar,
  ferramentaDeListar,
  ferramentaDeMarcar,
];
