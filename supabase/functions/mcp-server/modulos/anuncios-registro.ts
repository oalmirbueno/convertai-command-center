/**
 * MCP 2.19 (26/10/2026): o que o Paperclip faz nos anúncios aparece no painel.
 *
 * Decisão do dono: o Paperclip cuida dos anúncios; tudo numa página do painel (/anuncios/hoje) e UM
 * aviso no sino por boletim. Diagnóstico: as ações reais na conta (pela Composio) não chegavam em
 * ads_rotina_acoes (0 linhas desde 10/10) e o boletim Meta das 9h/17h30 não chegava ao dono.
 *
 *   aceleriq_ads_registrar_acao  grava a ação feita na conta em ads_rotina_acoes (origem agente,
 *                                estado feita) e devolve a prova "ads_acao:<id>" para o done.
 *   aceleriq_ads_boletim         grava o boletim em ads_boletins (um por dia e período) e, só no
 *                                boletim novo, toca o sino uma vez.
 *
 * Nada aqui mexe na conta de anúncios: registra o que já foi feito. Não importa mcp-tools em tempo de
 * execução (só o tipo), como painel-inteiro.ts.
 */

import { z } from 'https://esm.sh/zod@3.23.8';
import type { ToolDefinition } from '../../_shared/mcp-tools.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { db } from '../../_shared/aceleriq-read-services.ts';
import { dataScopeAllowsClient } from '../../_shared/mcp-security.ts';
import { principalDaChamada } from './autoria.ts';

const ESCRITA = { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: false };
const SLUG = z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9-]{1,38}$/);
const UUID = z.string().uuid();

export const ACOES_DE_ANUNCIO = ['pausar', 'ativar', 'verba', 'data_fim', 'criar', 'arquivar', 'outro'] as const;
export const ALVOS_DE_ANUNCIO = ['campanha', 'conjunto', 'anuncio', 'conta'] as const;

/** A ação do MCP no vocabulário de ads_rotina_acoes.tipo. */
export const TIPO_DA_ACAO: Record<(typeof ACOES_DE_ANUNCIO)[number], string> = {
  pausar: 'pausar', ativar: 'ativar', verba: 'orcamento', data_fim: 'data_fim', criar: 'montar_campanha', arquivar: 'arquivar', outro: 'outro',
};

const ARTIGO: Record<(typeof ALVOS_DE_ANUNCIO)[number], string> = { campanha: 'a campanha', conjunto: 'o conjunto', anuncio: 'o anúncio', conta: 'a conta' };
const VERBO: Record<(typeof ACOES_DE_ANUNCIO)[number], string> = {
  pausar: 'Pausou', ativar: 'Ativou', verba: 'Mudou a verba de', data_fim: 'Mudou a data de fim de', criar: 'Criou', arquivar: 'Arquivou', outro: 'Mexeu em',
};

const valorCurto = (v: unknown) => (v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 80);

export function resumoDaAcao(a: { acao: (typeof ACOES_DE_ANUNCIO)[number]; alvo_tipo: (typeof ALVOS_DE_ANUNCIO)[number]; alvo_nome: string; antes?: unknown; depois?: unknown }): string {
  const base = `${VERBO[a.acao]} ${ARTIGO[a.alvo_tipo]} ${a.alvo_nome}`.trim();
  const de = valorCurto(a.antes), para = valorCurto(a.depois);
  const mudanca = (a.acao === 'verba' || a.acao === 'data_fim' || a.acao === 'outro') && (de || para) ? ` de ${de || '?'} para ${para || '?'}` : '';
  return `${base}${mudanca}.`.slice(0, 600);
}

export const registrarAcaoSchema = z.object({
  client_id: UUID,
  conta_id: z.string().trim().min(1).max(80),
  alvo_tipo: z.enum(ALVOS_DE_ANUNCIO),
  alvo_id: z.string().trim().min(1).max(80),
  alvo_nome: z.string().trim().min(1).max(300),
  acao: z.enum(ACOES_DE_ANUNCIO),
  antes: z.unknown().optional(),
  depois: z.unknown().optional(),
  motivo: z.string().trim().min(3).max(2000),
  prova_url: z.string().trim().url().max(2000).optional(),
  operator: SLUG,
}).strict();

type Banco = ReturnType<typeof db>;

export async function registrarAcaoDeAnuncio(input: z.infer<typeof registrarAcaoSchema>, ctx: Pick<AuthContext, 'keyId' | 'origin' | 'dataScope'>, banco: Banco = db()) {
  if (ctx.dataScope && !dataScopeAllowsClient(ctx.dataScope, input.client_id)) {
    throw new Error('client_id outside this MCP principal data scope');
  }
  const { data: cliente } = await banco.from('profiles').select('id').eq('id', input.client_id).is('deleted_at', null).maybeSingle();
  if (!cliente) throw new Error(`client_id ${input.client_id} não existe (confira em aceleriq_list_clients).`);

  const tipo = TIPO_DA_ACAO[input.acao];
  const alvo = { nivel: input.alvo_tipo, meta_id: input.alvo_id, nome: input.alvo_nome, conta_id: input.conta_id };
  // Repetir a mesma ação no mesmo alvo em 10 min devolve a mesma linha (retry do agente não duplica).
  const dezMin = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: recentes } = await banco.from('ads_rotina_acoes').select('id, prova')
    .eq('client_id', input.client_id).eq('tipo', tipo).eq('estado', 'feita').gte('criado_em', dezMin)
    .contains('alvo', { meta_id: input.alvo_id }).limit(5);
  const depois = JSON.stringify(input.depois ?? null);
  const repetida = ((recentes ?? []) as Array<{ id: string; prova?: Record<string, unknown> }>)
    .find((r) => JSON.stringify(r.prova?.depois ?? null) === depois);
  if (repetida) return { ok: true, acao_id: repetida.id, prova: `ads_acao:${repetida.id}`, ja_registrada: true };

  const { data, error } = await banco.from('ads_rotina_acoes').insert({
    client_id: input.client_id,
    origem: 'agente',
    tipo,
    estado: 'feita',
    alvo,
    resumo: resumoDaAcao(input),
    porque: input.motivo.slice(0, 2000),
    prova: {
      antes: input.antes ?? null, depois: input.depois ?? null, prova_url: input.prova_url ?? null,
      operator: input.operator, acao: input.acao, fonte: 'MCP (ação feita fora do painel)', principal: principalDaChamada(ctx),
    },
    criado_por: null,
  }).select('id').single();
  if (error) {
    if (error.code === '23514') throw new Error(`ads_rotina_acoes recusou o tipo "${tipo}": falta aplicar a migration 20261026120300_ads_registro_e_boletim.sql.`);
    throw new Error(`ads_rotina_acoes: ${error.message}`);
  }
  const id = (data as { id: string }).id;
  return {
    ok: true,
    acao_id: id,
    prova: `ads_acao:${id}`,
    onde_ver: `/anuncios/hoje?cliente=${input.client_id}`,
    como_usar: 'Use prova (ads_acao:<id>) em evidence do aceleriq_operator_report done: é a prova de que a ação foi feita.',
  };
}

/**
 * 27/10: o único boletim que chegou em 26/10 (Hermes, 17h47) foi recusado por nivel "medio". O nível aceita
 * os sinônimos comuns e grava sempre um dos três da página.
 */
export const NIVEL_DO_ALERTA: Record<string, 'info' | 'atencao' | 'critico'> = {
  info: 'info', baixo: 'info', baixa: 'info', low: 'info', informativo: 'info', ok: 'info',
  atencao: 'atencao', medio: 'atencao', media: 'atencao', medium: 'atencao', aviso: 'atencao', alerta: 'atencao', warning: 'atencao',
  critico: 'critico', alto: 'critico', alta: 'critico', high: 'critico', grave: 'critico', urgente: 'critico', critical: 'critico',
};
const nivelDoAlerta = z.string().trim().transform((v, c) => {
  const n = NIVEL_DO_ALERTA[v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()];
  if (!n) {
    c.addIssue({ code: z.ZodIssueCode.custom, message: `nivel "${v}" não existe: use info, atencao ou critico` });
    return z.NEVER;
  }
  return n;
});

export const boletimSchema = z.object({
  periodo: z.string().trim().min(1).max(40),
  resumo: z.string().trim().min(1).max(2000),
  alertas: z.array(z.object({
    client_id: UUID.optional(),
    nivel: nivelDoAlerta,
    texto: z.string().trim().min(1).max(600),
  }).strict()).max(60).default([]),
  por_cliente: z.array(z.object({
    client_id: UUID,
    gasto: z.number().min(0).max(10_000_000).nullable().optional(),
    resultado: z.union([z.number(), z.string().trim().max(300)]).nullable().optional(),
    observacao: z.string().trim().max(600).optional(),
  }).strict()).max(80).default([]),
  texto_completo: z.string().max(40000).optional(),
  operator: SLUG.optional(),
}).strict();

export async function registrarBoletim(input: z.infer<typeof boletimSchema>, ctx: Pick<AuthContext, 'keyId' | 'origin'>, banco: Banco = db()) {
  const { data, error } = await banco.rpc('ads_boletim_registrar', {
    _periodo: input.periodo,
    _resumo: input.resumo,
    _alertas: input.alertas,
    _por_cliente: input.por_cliente,
    _texto_completo: input.texto_completo ?? null,
    _operator_slug: input.operator ?? null,
    _principal: principalDaChamada(ctx),
  });
  if (error) throw new Error(`ads_boletim_registrar: ${error.message}`);
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    ...r,
    onde_ver: r.boletim_id ? `/anuncios/hoje?boletim=${r.boletim_id}` : '/anuncios/hoje',
    sino: r.novo ? 'A equipe recebeu um aviso no sino.' : 'Boletim deste período já existia hoje: atualizado, sem novo aviso.',
  };
}

const erroDeEntrada = (e: z.ZodError) => new Error(`Invalid input: ${e.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);

const registrarAcaoTool: ToolDefinition = {
  name: 'aceleriq_ads_registrar_acao',
  title: 'Registrar ação feita nos anúncios',
  description:
    'Registra no painel uma ação que JÁ foi feita na conta de anúncios (pela Composio ou à mão): pausar, ativar, verba, data_fim, criar, arquivar ou outro, numa campanha, conjunto, anúncio ou conta. Entra em "O que foi feito" da Mesa Ads e na página /anuncios/hoje. Não mexe na conta: só registra. Devolve prova = "ads_acao:<id>": use em evidence do aceleriq_operator_report done. Repetir a mesma ação no mesmo alvo em 10 min devolve a mesma linha. antes/depois: o valor de antes e o de depois (status, verba diária em reais, data). operator: o agente da sua credencial que fez.',
  scopes: ['aceleriq:write'],
  annotations: ESCRITA,
  inputSchema: {
    type: 'object',
    properties: {
      client_id: { type: 'string', format: 'uuid', description: 'Cliente dono da conta.' },
      conta_id: { type: 'string', description: 'Id da conta de anúncios (act_...).' },
      alvo_tipo: { type: 'string', enum: [...ALVOS_DE_ANUNCIO] },
      alvo_id: { type: 'string', description: 'Id do alvo na plataforma.' },
      alvo_nome: { type: 'string', description: 'Nome do alvo como aparece no gerenciador.' },
      acao: { type: 'string', enum: [...ACOES_DE_ANUNCIO] },
      antes: { description: 'Valor antes (texto, número ou objeto curto).' },
      depois: { description: 'Valor depois (texto, número ou objeto curto).' },
      motivo: { type: 'string', description: 'Por que fez, em português simples.' },
      prova_url: { type: 'string', description: 'Link ou print do resultado, quando houver.' },
      operator: { type: 'string', description: 'Slug do agente (da sua credencial) que fez a ação.' },
    },
    required: ['client_id', 'conta_id', 'alvo_tipo', 'alvo_id', 'alvo_nome', 'acao', 'motivo', 'operator'],
    additionalProperties: false,
  },
  handler: async (input, ctx) => {
    const parsed = registrarAcaoSchema.safeParse(input ?? {});
    if (!parsed.success) throw erroDeEntrada(parsed.error);
    return await registrarAcaoDeAnuncio(parsed.data, ctx);
  },
};

const boletimTool: ToolDefinition = {
  name: 'aceleriq_ads_boletim',
  title: 'Boletim de anúncios do período',
  description:
    'Grava o boletim de anúncios do período (ex.: "09h", "17h30") na página /anuncios/hoje e toca UM aviso no sino da equipe. Um boletim por dia e período: mandar o mesmo período de novo no mesmo dia atualiza o texto sem novo aviso. resumo: 1 a 3 frases para o dono; alertas: [{client_id?, nivel: info|atencao|critico, texto}]; por_cliente: [{client_id, gasto em reais, resultado, observacao}]; texto_completo: o boletim inteiro. Não mexe em conta nem manda mensagem ao cliente.',
  scopes: ['aceleriq:write'],
  annotations: ESCRITA,
  inputSchema: {
    type: 'object',
    properties: {
      periodo: { type: 'string', description: '"09h", "17h30" ou outro rótulo curto.' },
      resumo: { type: 'string', description: 'O que o dono precisa saber, em 1 a 3 frases.' },
      alertas: { type: 'array', maxItems: 60, items: { type: 'object', properties: { client_id: { type: 'string', format: 'uuid' }, nivel: { type: 'string', enum: ['info', 'atencao', 'critico'], description: 'info, atencao ou critico (baixo, medio e alto também são aceitos e convertidos).' }, texto: { type: 'string' } }, required: ['nivel', 'texto'], additionalProperties: false } },
      por_cliente: { type: 'array', maxItems: 80, items: { type: 'object', properties: { client_id: { type: 'string', format: 'uuid' }, gasto: { type: 'number', description: 'Gasto em reais (opcional).' }, resultado: { type: ['number', 'string'], description: 'Resultados (número de conversões) ou frase curta (opcional).' }, observacao: { type: 'string' } }, required: ['client_id'], additionalProperties: false } },
      texto_completo: { type: 'string', description: 'O boletim inteiro (até 40 mil caracteres).' },
      operator: { type: 'string', description: 'Slug do agente (da sua credencial) que escreveu.' },
    },
    required: ['periodo', 'resumo'],
    additionalProperties: false,
  },
  handler: async (input, ctx) => {
    const parsed = boletimSchema.safeParse(input ?? {});
    if (!parsed.success) throw erroDeEntrada(parsed.error);
    return await registrarBoletim(parsed.data, ctx);
  },
};

export const FERRAMENTAS_DE_ANUNCIOS: readonly ToolDefinition[] = [registrarAcaoTool, boletimTool];
