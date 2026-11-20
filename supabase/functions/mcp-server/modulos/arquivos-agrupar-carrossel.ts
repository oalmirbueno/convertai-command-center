/**
 * MCP 2.38.0 (20/11/2026): aceleriq_arquivos_agrupar_carrossel.
 *
 * Caso real (agente Orion): o upload do MCP cria cada card como arquivo
 * solto; dois carrosséis de 5 chegaram ao cliente como 5 aprovações
 * separadas. Esta tool agrupa arquivos JÁ existentes sob uma raiz, no
 * mesmo modelo do painel (ver carrossel-de-arquivos.ts).
 *
 * Por que a validação mora aqui: o files_secure_guard do banco confere
 * parent_file_id só no INSERT (mesmo cliente, sem aninhar, raiz editável).
 * No UPDATE ele só exige que a linha (e a raiz dela) esteja interna e fora
 * da aprovação, e não deixa mexer nos campos de aprovação. Então tudo é
 * conferido antes de escrever e de novo em cada UPDATE (filtros de estado
 * na própria cláusula, contagem conferida, desfaz o que já mudou se uma
 * linha não casar).
 *
 * Não mexe em aprovação, visibilidade nem trava. Não move blob: cada filho
 * continua lendo o próprio storage_bucket/storage_path (CarouselSlider do
 * painel lê os filhos por parent_file_id e assina a URL por linha; a
 * política do storage casa o objeto com a linha de files pelo caminho).
 */

import { z } from 'https://esm.sh/zod@3.23.8';
import type { ToolDefinition } from '../../_shared/mcp-tools.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { DataScopeError } from '../../_shared/mcp-auth.ts';
import { dataScopeAllowsClient } from '../../_shared/mcp-security.ts';
import { db } from '../../_shared/aceleriq-read-services.ts';
import { umaVez } from '../../_shared/mcp-mesas-acoes.ts';
import { auditLog } from '../../_shared/mcp-audit.ts';
import {
  type ArquivoDoCarrossel,
  jaAgrupado,
  MAX_CARDS,
  MIN_CARDS,
  PASTA_DO_CARROSSEL,
  planoDoAgrupamento,
  type PlanoDoAgrupamento,
  rotuloDoEnvio,
  TIPO_DO_CARROSSEL,
} from './carrossel-de-arquivos.ts';

export const NOME_AGRUPAR = 'aceleriq_arquivos_agrupar_carrossel';
const ESCRITA = { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false };
const UUID = z.string().uuid();

export const agruparCarrosselSchema = z.object({
  file_ids: z.array(UUID).min(MIN_CARDS).max(MAX_CARDS),
  confirmar: z.boolean().optional(),
  idempotency_key: z.string().trim().min(8).max(120).optional(),
  legenda: z.string().trim().min(1).max(2200).optional(),
}).strict().refine((v) => v.confirmar !== true || !!v.idempotency_key, {
  message: 'idempotency_key (8 a 120 caracteres) é obrigatória com confirmar=true',
  path: ['idempotency_key'],
});

export type PedidoDeAgrupar = z.infer<typeof agruparCarrosselSchema>;

export const COLUNAS_DO_ARQUIVO =
  'id, client_id, project_id, parent_file_id, revision_of_file_id, file_name, file_type, folder, caption, mime_type, extension, storage_bucket, storage_path, file_url, status, archived_at, visibility, agency_approval_status, approval_status, locked_at, created_at';

// deno-lint-ignore no-explicit-any
type Consulta = any;
type Resultado = { data: unknown; error: { message: string } | null };

export interface DependenciasDoAgrupar {
  /** Chave de serviço (db()): leitura e o UPDATE condicional. */
  banco: { from(tabela: string): Consulta };
  umaVez: typeof umaVez;
  auditar: typeof auditLog;
}

function dependenciasPadrao(): DependenciasDoAgrupar {
  return { banco: db(), umaVez, auditar: auditLog };
}

function lido<T>(r: Resultado, oque: string): T {
  if (r.error) throw new Error(`Não foi possível ler ${oque} agora. Tente de novo.`);
  return r.data as T;
}

/** Lê os arquivos pedidos, os filhos atuais deles e quem já tem filho. */
export async function lerParaAgrupar(banco: DependenciasDoAgrupar['banco'], ids: readonly string[]) {
  const unicos = [...new Set(ids)];
  const [arquivosRes, filhosRes] = await Promise.all([
    banco.from('files').select(COLUNAS_DO_ARQUIVO).in('id', unicos),
    banco.from('files').select('id, parent_file_id').in('parent_file_id', unicos),
  ]);
  const arquivos = lido<ArquivoDoCarrossel[] | null>(arquivosRes, 'os arquivos') ?? [];
  const filhos = lido<Array<{ id: string; parent_file_id: string }> | null>(filhosRes, 'os cards dos arquivos') ?? [];
  const comFilhos = new Set(filhos.map((f) => f.parent_file_id));
  const filhosDaRaiz = filhos.filter((f) => f.parent_file_id === ids[0]).map((f) => f.id);
  return { arquivos, comFilhos, filhosDaRaiz };
}

const proximoPasso = (raizId: string) =>
  `Para o cliente receber como um carrossel só, chame aceleriq_arquivos_enviar_para_aprovacao com file_id ${raizId} (a raiz). Para virar post da Agenda antes, use aceleriq_agenda_criar_post_de_arquivo com o mesmo file_id.`;

function cardsDaResposta(plano: PlanoDoAgrupamento) {
  return plano.cards.map((c) => ({ ordem: c.ordem, file_id: c.file_id, nome: c.nome_depois }));
}

function planoParaResposta(plano: PlanoDoAgrupamento, legenda: string | undefined) {
  return {
    root_file_id: plano.root_file_id,
    total: plano.total,
    cards: plano.cards.map((c) => ({
      ordem: c.ordem,
      file_id: c.file_id,
      papel: c.papel,
      nome_antes: c.nome_antes,
      nome_depois: c.nome_depois,
      ...(c.muda_file_type ? { file_type: { antes: c.file_type_antes, depois: TIPO_DO_CARROSSEL } } : {}),
      ...(c.muda_folder ? { folder: { antes: c.folder_antes, depois: PASTA_DO_CARROSSEL } } : {}),
    })),
    ordem_resultante: plano.ordem_resultante,
    ordem_confere: plano.ordem_confere,
    legenda_na_raiz: legenda !== undefined ? 'grava a legenda pedida na raiz' : 'não mexe na legenda',
    problemas: plano.problemas,
    ...(plano.avisos.length ? { avisos: plano.avisos } : {}),
  };
}

/** Filtros de estado que todo UPDATE leva na própria cláusula. */
function comFiltros(q: Consulta, id: string, plano: PlanoDoAgrupamento): Consulta {
  let c = q.eq('id', id)
    .eq('client_id', plano.client_id)
    .is('parent_file_id', null)
    .eq('visibility', 'internal')
    .eq('agency_approval_status', 'not_requested')
    .eq('approval_status', 'none')
    .is('locked_at', null)
    .is('archived_at', null);
  c = plano.project_id ? c.eq('project_id', plano.project_id) : c.is('project_id', null);
  return c;
}

type Original = Pick<ArquivoDoCarrossel, 'id' | 'file_name' | 'file_type' | 'folder' | 'caption'>;

/**
 * Executa o plano: filhos primeiro (parent_file_id, nome, tipo, pasta), a raiz
 * por último (nome, tipo, pasta e legenda opcional). Cada linha tem que casar
 * exatamente uma vez; senão desfaz as já alteradas e lança o erro.
 */
export async function executarAgrupamento(
  banco: DependenciasDoAgrupar['banco'],
  plano: PlanoDoAgrupamento,
  originais: ReadonlyMap<string, Original>,
  legenda: string | undefined,
): Promise<void> {
  const raizId = plano.root_file_id!;
  const feitos: string[] = [];
  const desfazer = async (): Promise<string[]> => {
    const falhas: string[] = [];
    for (const id of [...feitos].reverse()) {
      const o = originais.get(id)!;
      const volta: Record<string, unknown> = { file_name: o.file_name, file_type: o.file_type, folder: o.folder };
      if (id === raizId) {
        if (legenda !== undefined) volta.caption = o.caption ?? null;
      } else {
        volta.parent_file_id = null;
      }
      let q = banco.from('files').update(volta).eq('id', id).eq('client_id', plano.client_id);
      q = id === raizId ? q.is('parent_file_id', null) : q.eq('parent_file_id', raizId);
      const r = await q.select('id').then((x: Resultado) => x, (e: unknown) => ({ data: null, error: { message: String(e) } }));
      if (r.error || !Array.isArray(r.data) || r.data.length !== 1) falhas.push(id);
    }
    return falhas;
  };
  const falhar = async (motivo: string): Promise<never> => {
    const naoVoltaram = await desfazer();
    const sufixo = naoVoltaram.length
      ? ` ATENÇÃO: não deu para desfazer em ${naoVoltaram.join(', ')}; confira em Arquivos (aceleriq_get_file) e corrija à mão.`
      : ' Nada ficou alterado (o que já tinha mudado foi desfeito).';
    throw new Error(`${motivo}${sufixo}`);
  };

  const ordem = [...plano.cards.slice(1), plano.cards[0]];
  for (const card of ordem) {
    const patch: Record<string, unknown> = {};
    if (card.muda_nome) patch.file_name = card.nome_depois;
    if (card.muda_file_type) patch.file_type = TIPO_DO_CARROSSEL;
    if (card.muda_folder) patch.folder = PASTA_DO_CARROSSEL;
    if (card.papel === 'filho') {
      patch.parent_file_id = raizId;
      // O filho não carrega legenda (o modelo do painel): a legenda é da raiz.
    } else if (legenda !== undefined) {
      patch.caption = legenda;
    }
    if (!Object.keys(patch).length) continue;
    const r: Resultado = await comFiltros(banco.from('files').update(patch), card.file_id, plano)
      .select('id')
      .then((x: Resultado) => x, (e: unknown) => ({ data: null, error: { message: String(e) } }));
    if (r.error) await falhar(`O banco recusou o card ${card.ordem} (${card.file_id}): ${r.error.message.slice(0, 200)}.`);
    if (!Array.isArray(r.data) || r.data.length !== 1) {
      await falhar(`O card ${card.ordem} (${card.file_id}) mudou de estado enquanto isso (entrou na aprovação, foi arquivado ou virou card de outro).`);
    }
    feitos.push(card.file_id);
  }

  // Conferência depois: ninguém pendurou card num dos filhos enquanto isso (carrossel aninhado).
  const filhos = plano.cards.slice(1).map((c) => c.file_id);
  const netos = await banco.from('files').select('id').in('parent_file_id', filhos)
    .then((x: Resultado) => x, (e: unknown) => ({ data: null, error: { message: String(e) } }));
  if (netos.error) await falhar('Não deu para conferir o carrossel depois de agrupar.');
  if (Array.isArray(netos.data) && netos.data.length) {
    await falhar('Um dos cards ganhou cards próprios enquanto isso (carrossel dentro de carrossel não vale).');
  }
}

export async function agruparCarrossel(
  input: PedidoDeAgrupar,
  ctx: AuthContext,
  deps: DependenciasDoAgrupar = dependenciasPadrao(),
): Promise<Record<string, unknown>> {
  const { banco } = deps;
  const ids = input.file_ids;
  const { arquivos, comFilhos, filhosDaRaiz } = await lerParaAgrupar(banco, ids);

  // Fronteira do cliente antes de qualquer resposta com detalhe.
  if (arquivos.some((f) => !dataScopeAllowsClient(ctx.dataScope, f.client_id))) {
    throw new DataScopeError('resource is outside this MCP principal data scope');
  }

  if (jaAgrupado(ids, arquivos, filhosDaRaiz)) {
    const raiz = arquivos.find((f) => f.id === ids[0])!;
    return {
      ok: true,
      ja_agrupado: true,
      simulacao: input.confirmar !== true,
      root_file_id: raiz.id,
      client_id: raiz.client_id,
      cards: ids.map((id, i) => ({ ordem: i + 1, file_id: id, nome: arquivos.find((f) => f.id === id)!.file_name })),
      total: ids.length,
      rotulo: rotuloDoEnvio(ids.length),
      aviso: 'Estes arquivos já formam este carrossel. Nada foi alterado.',
      proximo_passo: proximoPasso(raiz.id),
    };
  }

  const plano = planoDoAgrupamento(ids, arquivos, comFilhos, (c) => dataScopeAllowsClient(ctx.dataScope, c));
  if (plano.problemas.includes('fora_do_escopo')) {
    throw new DataScopeError('resource is outside this MCP principal data scope');
  }

  if (input.confirmar !== true) {
    return {
      ok: true,
      simulacao: true,
      pode_agrupar: plano.problemas.length === 0,
      plano: planoParaResposta(plano, input.legenda),
      aviso: 'Simulação: nada foi escrito. Para executar, chame de novo com confirmar=true e uma idempotency_key.',
      ...(plano.root_file_id && !plano.problemas.length ? { proximo_passo: proximoPasso(plano.root_file_id) } : {}),
    };
  }
  if (plano.problemas.length) {
    throw new Error(`Não dá para agrupar: ${plano.problemas.join(' ')}`);
  }

  const raizId = plano.root_file_id!;
  const originais = new Map<string, Original>(arquivos.map((f) => [f.id, {
    id: f.id, file_name: f.file_name, file_type: f.file_type ?? null, folder: f.folder ?? null, caption: f.caption ?? null,
  }]));

  // Replay só de chamada confirmada (escopo { confirmar: true }): a simulação também é auditada com a
  // chave. Sem escopo por raiz: o input auditado tem file_ids, e { root_file_id } nunca casaria.
  return await deps.umaVez(NOME_AGRUPAR, ctx, input.idempotency_key!, async () => {
    if (ctx.resultRefHolder) ctx.resultRefHolder.value = `files:${raizId}`;
    await executarAgrupamento(banco, plano, originais, input.legenda);
    // Os nomes de antes ficam na trilha (a entrada da chamada não os tem).
    await deps.auditar({
      correlationId: ctx.correlationId ?? crypto.randomUUID(),
      toolName: `${NOME_AGRUPAR}.antes`,
      origin: ctx.origin,
      keyId: ctx.keyId,
      scopes: ctx.scopes,
      input: {
        root_file_id: raizId,
        antes: plano.cards.map((c) => ({ file_id: c.file_id, file_name: c.nome_antes, file_type: c.file_type_antes, folder: c.folder_antes })),
        legenda_trocada: input.legenda !== undefined,
      },
      success: true,
      statusCode: 200,
      durationMs: 0,
      resultRef: `files:${raizId}`,
    }).catch(() => undefined);
    return {
      ref: `files:${raizId}`,
      resultado: {
        ja_agrupado: false,
        simulacao: false,
        root_file_id: raizId,
        client_id: plano.client_id,
        cards: cardsDaResposta(plano),
        total: plano.total,
        rotulo: rotuloDoEnvio(plano.total),
        nomes_antes: plano.cards.filter((c) => c.muda_nome).map((c) => ({ file_id: c.file_id, antes: c.nome_antes, depois: c.nome_depois })),
        ...(plano.cards.some((c) => c.muda_file_type || c.muda_folder)
          ? {
            ajustes: plano.cards.filter((c) => c.muda_file_type || c.muda_folder).map((c) => ({
              file_id: c.file_id,
              ...(c.muda_file_type ? { file_type: { antes: c.file_type_antes, depois: TIPO_DO_CARROSSEL } } : {}),
              ...(c.muda_folder ? { folder: { antes: c.folder_antes, depois: PASTA_DO_CARROSSEL } } : {}),
            })),
          }
          : {}),
        legenda_gravada: input.legenda !== undefined,
        ...(plano.avisos.length ? { avisos: plano.avisos } : {}),
        observacao: 'Nada foi enviado ao cliente, aprovado, movido no storage ou apagado.',
        proximo_passo: proximoPasso(raizId),
      },
    };
  }, { confirmar: true });
}

function erroDeEntrada(e: z.ZodError): Error {
  return new Error(`Invalid input: ${e.issues.map((i) => `${i.path.join('.') || 'entrada'}: ${i.message}`).join('; ')}`);
}

const tool: ToolDefinition = {
  name: NOME_AGRUPAR,
  title: 'Arquivos: agrupar cards soltos como carrossel',
  description:
    'Agrupa arquivos JÁ subidos (aceleriq_upload_file / _inline criam cada card solto) como um carrossel sob a raiz, no modelo do painel: o primeiro file_id vira a raiz e os outros, na ordem, viram os cards "<nome> (i/N)"; file_type carrossel e pasta materiais. Sem confirmar (ou confirmar=false) é SIMULAÇÃO: não escreve e devolve o plano (nomes antes e depois, ordem que o painel vai mostrar e problemas). confirmar=true executa e exige idempotency_key. Só agrupa imagens png/jpg/webp prontas, do mesmo cliente e projeto, internas e fora da aprovação: arquivo já enviado ao cliente é recusado (retire antes com aceleriq_workspace_retirar_aprovacao). Não aprova, não envia ao cliente, não move nada no storage e não apaga. Mesmo conjunto já agrupado devolve ja_agrupado:true. Depois: aceleriq_arquivos_enviar_para_aprovacao com a raiz (o cliente recebe "Carrossel · N"). Exige files:write e o cliente no escopo.',
  scopes: ['files:write'],
  annotations: ESCRITA,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['file_ids'],
    properties: {
      file_ids: {
        type: 'array', minItems: MIN_CARDS, maxItems: MAX_CARDS, items: { type: 'string', format: 'uuid' },
        description: 'Ids em public.files na ordem dos cards. O primeiro é a raiz (capa).',
      },
      confirmar: { type: 'boolean', description: 'true executa; ausente ou false só simula.' },
      idempotency_key: { type: 'string', minLength: 8, maxLength: 120, description: 'Obrigatória com confirmar=true. Repetir não refaz.' },
      legenda: { type: 'string', maxLength: 2200, description: 'Opcional: grava na raiz (caption). Sem ela, a legenda não muda.' },
    },
  },
  handler: async (input, ctx) => {
    const parsed = agruparCarrosselSchema.safeParse(input ?? {});
    if (!parsed.success) throw erroDeEntrada(parsed.error);
    return await agruparCarrossel(parsed.data, ctx);
  },
};

export const FERRAMENTA_DE_AGRUPAR_CARROSSEL: readonly ToolDefinition[] = [tool];
