/**
 * Hermes ↔ agentes das Mesas pelo MCP (lote B, 09/10/2026). O outro sentido
 * do encaminhamento (_shared/pedido-ao-hermes.ts): o Hermes lê o que os agentes
 * das Mesas conversaram com a equipe e deixa um pedido ou um resultado na
 * conversa ativa de um agente, nas mesmas tabelas (agente_conversas e
 * agente_mensagens). Nada de fila nova.
 *
 * - Sempre por cliente (client_id obrigatório) e só para chave irrestrita da
 *   equipe (as ferramentas novas não entram nas listas legadas por cliente).
 * - O pedido do Hermes entra como mensagem do agente marcada "Pedido do
 *   Hermes"; o agente o vê no histórico e responde na próxima rodada com as
 *   ferramentas dele (ações sensíveis continuam com aprovação).
 */
import { z } from 'https://esm.sh/zod@3.23.8';
import type { ToolDefinition } from './mcp-tools.ts';
import { db } from './aceleriq-read-services.ts';

/** Agente da Mesa → (coluna agente, referencia_tipo). Os que exigem referência pedem referencia_id. */
export const AGENTES_DAS_MESAS: Record<string, { agente: string; referencia: string; precisaReferencia?: boolean; nome: string }> = {
  contexto: { agente: 'contexto', referencia: 'cliente_contexto', nome: 'Agente de Contexto' },
  mes: { agente: 'estrategista', referencia: 'agente_do_mes', nome: 'Agente do Mês' },
  ads: { agente: 'estrategista_ads', referencia: 'ads_conta', nome: 'Agente sênior de tráfego (Ads)' },
  ads_oferta: { agente: 'estrategista_ads', referencia: 'ads_oferta', nome: 'Agente da Oferta (Ads)' },
  ads_plano: { agente: 'estrategista_ads', referencia: 'ads_plano', precisaReferencia: true, nome: 'Plano de teste (Ads)' },
  estudio: { agente: 'diretor_arte', referencia: 'estudio_trabalho', precisaReferencia: true, nome: 'Diretor de arte (Estúdio)' },
  foto: { agente: 'diretor_arte', referencia: 'mesa_foto', nome: 'Diretor de fotografia (Mesa Foto)' },
  editor: { agente: 'diretor_arte', referencia: 'editor_agente', nome: 'Agente editor (Mesa Edição)' },
  roteiros: { agente: 'estrategista', referencia: 'mesa_roteiros', nome: 'Roteirista' },
  ideias: { agente: 'estrategista', referencia: 'mesa_roteiros_ideias', nome: 'Ideias de tema' },
  site: { agente: 'site', referencia: 'mesa_site', precisaReferencia: true, nome: 'Agente do Site' },
  proposta: { agente: 'proposta', referencia: 'mesa_proposta', nome: 'Agente da Proposta' },
  publicidade: { agente: 'diretor_arte', referencia: 'mesa_publicidade', nome: 'Diretor da Publicidade' },
  motion: { agente: 'motion', referencia: 'mesa_motion', precisaReferencia: true, nome: 'Agente do Motion' },
  identidade: { agente: 'identidade', referencia: 'mesa_identidade', nome: 'Diretor de marca (Identidade)' },
  instagram: { agente: 'estrategista', referencia: 'instagram_do_cliente', nome: 'Agente do Instagram' },
  perfis: { agente: 'estrategista', referencia: 'perfil_instagram', precisaReferencia: true, nome: 'Agente de Perfis' },
  contratos: { agente: 'contrato', referencia: 'mesa_contratos', nome: 'Agente de Contratos' },
  estilo: { agente: 'diretor_arte', referencia: 'estilo_do_cliente', nome: 'Agente de Estilo' },
  campanha: { agente: 'estrategista', referencia: 'mesa_campanha', nome: 'Agente da Campanha' },
};

const UUID = z.string().uuid();
const SLUGS = Object.keys(AGENTES_DAS_MESAS) as [string, ...string[]];

function erroDeEntrada(e: z.ZodError): Error {
  return new Error(`Invalid input: ${e.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
}

export const agentConversationsTool: ToolDefinition = {
  name: 'aceleriq_agent_conversations',
  title: 'Conversas dos agentes das Mesas (ler)',
  description:
    'Lê o que os agentes das Mesas (Contexto, Mês, Ads, Estúdio, Roteiros, Site, Proposta, Publicidade, Motion, Identidade, Instagram, Perfis, Contratos, Estilo...) conversaram com a equipe sobre UM cliente. Sem conversa_id: lista as conversas (título, agente, última atividade, arquivada ou não), com busca opcional no texto. Com conversa_id: devolve as mensagens (pedido da equipe, resposta do agente, sistema). Somente leitura; use antes de pedir algo a um agente, para não repetir trabalho.',
  scopes: ['aceleriq:read'],
  annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  inputSchema: {
    type: 'object',
    properties: {
      client_id: { type: 'string', description: 'UUID do cliente.' },
      agente: { type: 'string', enum: SLUGS, description: 'Filtra por agente da Mesa (opcional).' },
      conversa_id: { type: 'string', description: 'UUID da conversa para ler as mensagens.' },
      busca: { type: 'string', description: 'Texto a procurar nas mensagens (opcional).' },
      limit: { type: 'number', description: 'Máximo de itens (até 100).' },
    },
    required: ['client_id'],
    additionalProperties: false,
  },
  handler: async (input) => {
    const p = z.object({ client_id: UUID, agente: z.enum(SLUGS).optional(), conversa_id: UUID.optional(), busca: z.string().max(200).optional(), limit: z.number().int().min(1).max(100).optional() }).strict().safeParse(input ?? {});
    if (!p.success) throw erroDeEntrada(p.error);
    const { client_id, agente, conversa_id, busca } = p.data;
    const limite = p.data.limit ?? 30;
    if (conversa_id) {
      const { data: c } = await db().from('agente_conversas').select('id, agente, referencia_tipo, referencia_id, titulo, arquivada_em').eq('id', conversa_id).eq('client_id', client_id).maybeSingle();
      if (!c) throw new Error('conversa_nao_encontrada: essa conversa não é deste cliente.');
      const { data: m, error } = await db().from('agente_mensagens').select('id, papel, conteudo, criado_em').eq('conversa_id', conversa_id).eq('client_id', client_id).order('criado_em', { ascending: false }).limit(limite);
      if (error) throw new Error(`agente_mensagens: ${error.message}`);
      return { conversa: c, mensagens: ((m ?? []) as Array<{ id: string; papel: string; conteudo: string; criado_em: string }>).reverse().map((x) => ({ ...x, conteudo: x.conteudo.slice(0, 4000) })) };
    }
    let q = db().from('agente_conversas').select('id, agente, referencia_tipo, referencia_id, titulo, atualizado_em, arquivada_em').eq('client_id', client_id);
    if (agente) q = q.eq('agente', AGENTES_DAS_MESAS[agente].agente).eq('referencia_tipo', AGENTES_DAS_MESAS[agente].referencia);
    const { data, error } = await q.order('atualizado_em', { ascending: false, nullsFirst: false }).limit(limite);
    if (error) throw new Error(`agente_conversas: ${error.message}`);
    let conversas = (data ?? []) as Array<Record<string, unknown>>;
    if (busca && conversas.length) {
      const { data: achados } = await db().from('agente_mensagens').select('conversa_id').eq('client_id', client_id).in('conversa_id', conversas.map((c) => c.id as string)).ilike('conteudo', `%${busca.replace(/[%_]/g, ' ')}%`).limit(200);
      const ids = new Set(((achados ?? []) as Array<{ conversa_id: string }>).map((a) => a.conversa_id));
      conversas = conversas.filter((c) => ids.has(c.id as string) || String(c.titulo || '').toLowerCase().includes(busca.toLowerCase()));
    }
    const nomeDe = (c: Record<string, unknown>) => Object.entries(AGENTES_DAS_MESAS).find(([, v]) => v.agente === c.agente && v.referencia === c.referencia_tipo);
    return { total: conversas.length, conversas: conversas.map((c) => ({ ...c, agente_da_mesa: nomeDe(c)?.[0] ?? null, nome: nomeDe(c)?.[1].nome ?? null })) };
  },
};

export const agentHandoffTool: ToolDefinition = {
  name: 'aceleriq_agent_handoff',
  title: 'Pedir algo a um agente da Mesa (ou devolver um resultado)',
  description:
    'O Hermes deixa um pedido ou um resultado na conversa ATIVA de um agente da Mesa de UM cliente (Contexto, Mês, Ads, Roteiros, Proposta, Identidade, Instagram, Contratos, Estilo...). A mensagem entra marcada "Pedido do Hermes" e a equipe vê no painel do agente; o agente lê no histórico e responde com as ferramentas dele na próxima rodada. Use para o que é especialidade do agente (planejar o mês, ajustar o kit, montar roteiro...). Não executa nada sozinho e não fala com cliente; ações sensíveis continuam com aprovação. Agentes por referência (site, motion, estúdio, plano de Ads, perfis) exigem referencia_id.',
  scopes: ['aceleriq:write'],
  annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false },
  inputSchema: {
    type: 'object',
    properties: {
      operator: { type: 'string', description: 'Slug do operador que pede (ex.: default para o Hermes Core).' },
      client_id: { type: 'string', description: 'UUID do cliente.' },
      agente: { type: 'string', enum: SLUGS, description: 'Agente da Mesa que recebe.' },
      referencia_id: { type: 'string', description: 'UUID da referência (site, filme, trabalho do Estúdio, plano, perfil), quando o agente exige.' },
      titulo: { type: 'string', description: 'Título curto do pedido.' },
      texto: { type: 'string', description: 'O pedido ou o resultado, com o que já foi verificado.' },
      link_id: { type: 'string', description: 'Vínculo de execução relacionado (opcional).' },
    },
    required: ['operator', 'client_id', 'agente', 'titulo', 'texto'],
    additionalProperties: false,
  },
  handler: async (input) => {
    const p = z.object({
      operator: z.string().min(2).max(40), client_id: UUID, agente: z.enum(SLUGS), referencia_id: UUID.optional(),
      titulo: z.string().min(3).max(160), texto: z.string().min(5).max(6000), link_id: UUID.optional(),
    }).strict().safeParse(input ?? {});
    if (!p.success) throw erroDeEntrada(p.error);
    const { operator, client_id, agente, referencia_id, titulo, texto, link_id } = p.data;
    const alvo = AGENTES_DAS_MESAS[agente];
    if (alvo.precisaReferencia && !referencia_id) throw new Error(`referencia_obrigatoria: o ${alvo.nome} trabalha por referência; mande referencia_id.`);
    const { data: op } = await db().from('internal_operators').select('id, display_name, status').eq('slug', operator.trim().toLowerCase()).maybeSingle();
    if (!op || (op as { status: string }).status !== 'active') throw new Error(`operador_invalido: "${operator}" não está ativo.`);
    const { data: cli } = await db().from('profiles').select('id').eq('id', client_id).maybeSingle();
    if (!cli) throw new Error('cliente_nao_encontrado');
    // Conversa ativa (não arquivada) do agente; sem ela, abre uma.
    let q = db().from('agente_conversas').select('id').eq('client_id', client_id).eq('agente', alvo.agente).eq('referencia_tipo', alvo.referencia).is('arquivada_em', null);
    q = referencia_id ? q.eq('referencia_id', referencia_id) : (alvo.referencia === 'instagram_do_cliente' ? q.eq('referencia_id', client_id) : q);
    const { data: ativa } = await q.order('criado_em', { ascending: false }).limit(1).maybeSingle();
    let conversaId = (ativa as { id: string } | null)?.id ?? null;
    if (!conversaId) {
      const { data: nova, error } = await db().from('agente_conversas').insert({
        client_id, agente: alvo.agente, referencia_tipo: alvo.referencia,
        referencia_id: referencia_id ?? (alvo.referencia === 'instagram_do_cliente' ? client_id : null), titulo: `Hermes: ${titulo}`.slice(0, 120),
      }).select('id').single();
      if (error || !nova) throw new Error(`agente_conversas: ${error?.message || 'não criada'}`);
      conversaId = (nova as { id: string }).id;
    }
    const nome = (op as { display_name: string }).display_name || operator;
    const { data: msg, error: eM } = await db().from('agente_mensagens').insert({
      conversa_id: conversaId, client_id, papel: 'agente',
      conteudo: `Pedido do Hermes (${nome}): ${titulo}\n\n${texto}`,
      anexos: [{ tipo: 'pedido_do_hermes', operador: operator, link_id: link_id ?? null, titulo }],
    }).select('id, criado_em').single();
    if (eM || !msg) throw new Error(`agente_mensagens: ${eM?.message || 'não gravada'}`);
    return {
      entregue: true,
      agente: alvo.nome,
      conversa_id: conversaId,
      mensagem_id: (msg as { id: string }).id,
      proximo_passo: 'O pedido está na conversa do agente. Ele responde na próxima rodada com a equipe; acompanhe com aceleriq_agent_conversations. Isto não é execução feita.',
    };
  },
};
