/**
 * Leitura exclusiva do Escritório pela identidade OAuth da Dot.
 * Usa consultas próprias para que o catálogo geral e os filtros de sala
 * dos demais operadores não determinem o que este acesso pode ler.
 */
import { z } from 'https://esm.sh/zod@3.23.8';
import { db } from '../../_shared/aceleriq-read-services.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { DOT_OFFICE_OPERATOR as DOT } from '../../_shared/mcp-dot-oauth.ts';
import { tirarSegredos } from './escritorio-regras.ts';
import { ErroDaFerramenta } from './robustez.ts';

const JANELA_DIAS = 30;
const JANELA_MS = JANELA_DIAS * 24 * 60 * 60 * 1000;
const DESDE_TAMANHO_MAXIMO = 40;
const LIMITE_PADRAO = 30;
const LIMITE_MAXIMO = 100;
const entradaSchema = z.object({ operator: z.literal(DOT).optional() }).strict();
const caixaSchema = entradaSchema.extend({
  so_nao_lidas: z.boolean().optional(),
  desde: z.string().max(DESDE_TAMANHO_MAXIMO).datetime({ offset: true }).refine((valor) => Number.isFinite(Date.parse(valor))).optional(),
  limite: z.number().int().min(1).max(LIMITE_MAXIMO).optional(),
});

const entradaInputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    operator: { type: 'string', enum: [DOT], description: 'Identidade opcional da Dot.' },
  },
};

export const DESCRITORES_DO_ESCRITORIO_DOT: Readonly<Partial<Record<string, {
  description: string;
  inputSchema: Record<string, unknown>;
}>>> = {
  aceleriq_escritorio_entrar: {
    description: 'Confirma a identidade da Dot e seu estado de executora no Escritório.',
    inputSchema: entradaInputSchema,
  },
  aceleriq_escritorio_caixa: {
    description: `Lê as mensagens diretas internas da própria caixa da Dot nos últimos ${JANELA_DIAS} dias. Por padrão, lista as não lidas, das mais recentes para as mais antigas.`,
    inputSchema: {
      ...entradaInputSchema,
      properties: {
        ...entradaInputSchema.properties,
        so_nao_lidas: { type: 'boolean', description: 'Padrão: true.' },
        desde: { type: 'string', maxLength: DESDE_TAMANHO_MAXIMO, description: 'Data e hora ISO 8601 com fuso.' },
        limite: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO, description: `Padrão: ${LIMITE_PADRAO}.` },
      },
    },
  },
};

export type PortaDoEscritorioDot = Pick<ReturnType<typeof db>, 'from'>;

function conferirCredencial(ctx: AuthContext) {
  if (ctx.officeOperator !== DOT || ctx.dataScope.source !== 'oauth'
      || ctx.dataScope.unrestricted || ctx.dataScope.clientIds.length > 0) {
    throw new ErroDaFerramenta('nao_e_voce', 'A credencial não está vinculada à Dot.');
  }
}

function entradaInvalida(): never {
  throw new ErroDaFerramenta('entrada_invalida', 'Entrada inválida para a leitura da Dot.');
}

function falhaDeLeitura(): never {
  throw new ErroDaFerramenta('falha_no_banco', 'O Escritório da Dot não respondeu agora.', null, true);
}

async function conferirRegistro(banco: PortaDoEscritorioDot) {
  const { data, error } = await banco.from('internal_operators')
    .select('slug, status, origem, grau, is_coordinator')
    .eq('slug', DOT)
    .maybeSingle();
  if (error) falhaDeLeitura();
  if (data?.slug !== DOT || data.status !== 'active' || data.origem !== 'chatgpt'
      || data.grau !== 'executor' || data.is_coordinator !== false) {
    throw new ErroDaFerramenta('agente_parado', 'A Dot não está ativa como executora do ChatGPT.');
  }
}

export async function escritorioDotEntrar(input: unknown, ctx: AuthContext, porta?: PortaDoEscritorioDot) {
  conferirCredencial(ctx);
  if (!entradaSchema.safeParse(input ?? {}).success) entradaInvalida();
  await conferirRegistro(porta ?? db());

  return { voce: { slug: DOT, nome: 'Dot', plataforma: 'chatgpt', grau: 'executor', status: 'active' } };
}

export async function escritorioDotCaixa(input: unknown, ctx: AuthContext, porta?: PortaDoEscritorioDot) {
  conferirCredencial(ctx);
  const parsed = caixaSchema.safeParse(input ?? {});
  if (!parsed.success) entradaInvalida();
  const banco = porta ?? db();
  await conferirRegistro(banco);

  const maisAntiga = Date.now() - JANELA_MS;
  const { desde, limite = LIMITE_PADRAO, so_nao_lidas = true } = parsed.data;
  const inicio = new Date(desde ? Math.max(Date.parse(desde), maisAntiga) : maisAntiga).toISOString();
  let consulta = banco.from('escritorio_mensagens')
    .select('de_slug, corpo, created_at, conversa:escritorio_conversas!inner(id), leituras:escritorio_leituras(mensagem_id)')
    .eq('para_slug', DOT)
    .neq('de_slug', DOT)
    .is('grupo_id', null)
    .is('client_id', null)
    .is('task_id', null)
    .eq('conversa.tipo', 'direta')
    .is('conversa.grupo_id', null)
    .is('conversa.client_id', null)
    .is('conversa.task_id', null)
    .eq('leituras.leitor_slug', DOT)
    .gte('created_at', inicio);
  if (so_nao_lidas) consulta = consulta.is('leituras', null);

  const { data, error } = await consulta.order('created_at', { ascending: false })
    .order('id', { ascending: false }).limit(limite);
  if (error) falhaDeLeitura();

  return {
    de_quem_e_a_caixa: DOT,
    mensagens: (data ?? []).map((mensagem) => ({
      de: mensagem.de_slug,
      texto: tirarSegredos(mensagem.corpo),
      quando: mensagem.created_at,
      lida: mensagem.leituras.length > 0,
    })),
  };
}
