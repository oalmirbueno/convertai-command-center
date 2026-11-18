/**
 * MCP 2.34.0 (18/11/2026): regras permanentes do dono.
 *
 * O dono deixou de aprovar rotina. Dentro de uma regra ligada, o pedido de aprovação
 * (aceleriq_operator_request_approval) já volta aprovado, com o nome da regra na auditoria.
 * A decisão mora no banco (app_private.regra_permanente_avaliar): aqui o agente só LÊ as regras,
 * para saber o que mandar no payload e o que continua subindo para o dono.
 */

import { z } from 'https://esm.sh/zod@3.23.8';
import type { ToolDefinition } from '../../_shared/mcp-tools.ts';
import { db } from '../../_shared/aceleriq-read-services.ts';
import { ErroDaFerramenta } from './robustez.ts';

export interface RegraPermanente {
  chave: string;
  nome: string;
  area: string;
  descricao: string;
  ligada: boolean;
  acoes: string[];
  operadores: string[];
  limites: Record<string, unknown>;
  atualizado_em?: string;
}

export const SEMPRE_SOBE = [
  'Gasto acima do teto ou recarga',
  'Cliente novo',
  'Preço e negociação',
  'Reclamação',
  'Peça rejeitada mais de uma vez',
  'Mudança de rumo',
  'Financeiro, permissões e exclusão ou exportação de dados',
];

/** O que o agente precisa mandar no payload do pedido para a regra conseguir conferir. */
export const PAYLOAD_POR_REGRA: Record<string, string> = {
  conteudo_revisado:
    'action_kind publicar ou agendar; payload { trabalho_id, client_id, rejeicoes (quantas vezes a peça foi rejeitada) }. O banco confere a revisão interna aprovada e a aprovação do cliente.',
  trafego_ate_o_teto:
    'action_kind alterar_orcamento ou ativar_campanha; payload { client_id, tipo: "pausar" | "trocar_criativo" | "ajustar_verba", aumento_na_semana (R$ a mais nesta semana, 0 se não aumenta) }. O banco soma o gasto coletado de segunda a domingo. Recarga: mande recarga:true e ela sobe para o dono.',
  mensagens_de_rotina:
    'action_kind enviar_mensagem; payload { client_id, modelo (chave do modelo), texto (o modelo com os colchetes preenchidos e nada mais), canal: "grupo_do_cliente", referencia (ex.: a mensalidade ou a peça) }.',
};

const schema = z.object({ so_ligadas: z.boolean().optional() }).strict();

export function montarRegras(linhas: RegraPermanente[], operador?: string, soLigadas = false) {
  const regras = linhas.filter((r) => !soLigadas || r.ligada).map((r) => ({
    chave: r.chave,
    nome: r.nome,
    area: r.area,
    ligada: r.ligada,
    o_que_libera: r.descricao,
    acoes: r.acoes,
    quem_pode: r.operadores.length ? r.operadores : 'qualquer agente',
    ...(operador ? { vale_para_voce: r.ligada && (!r.operadores.length || r.operadores.includes(operador)) } : {}),
    limites: r.limites,
    como_pedir: PAYLOAD_POR_REGRA[r.chave] ?? 'Peça com aceleriq_operator_request_approval; o banco decide.',
  }));
  return {
    regras,
    sempre_sobe_para_o_dono: SEMPRE_SOBE,
    como_usar:
      'Peça sempre com aceleriq_operator_request_approval. Se a resposta vier com status "aprovado" e autorizado_por_regra, execute exatamente aquele payload: o uso já ficou registrado. Se vier "pendente", espere o dono; por_que_subiu diz o motivo. Regra desligada volta a pedir aprovação na hora.',
  };
}

export const FERRAMENTAS_DAS_REGRAS: readonly ToolDefinition[] = [{
  name: 'aceleriq_regras_permanentes',
  title: 'Regras permanentes do dono',
  description:
    'Só leitura. As regras permanentes do dono: o que o agente faz sozinho, com registro, sem esperar aprovação (conteúdo revisado e aprovado pelo cliente, tráfego até o teto da semana, mensagens de rotina por modelo). Diz se cada regra está ligada, quem pode usar, os limites, o que mandar no payload do pedido e o que sempre sobe para o dono. Quem decide é o banco, dentro de aceleriq_operator_request_approval.',
  scopes: ['aceleriq:read'],
  annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  cacheSeg: 30,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      operator: { type: 'string', description: 'O seu slug: marca quais regras valem para você.' },
      so_ligadas: { type: 'boolean' },
    },
  },
  handler: async (input) => {
    const bruto = (input ?? {}) as Record<string, unknown>;
    const p = schema.safeParse({ so_ligadas: bruto.so_ligadas });
    if (!p.success) throw new ErroDaFerramenta('entrada_invalida', 'so_ligadas deve ser true ou false.', null, false);
    const operador = typeof bruto.operator === 'string' ? bruto.operator.trim().toLowerCase() : undefined;
    const { data, error } = await db().from('regras_permanentes')
      .select('chave, nome, area, descricao, ligada, acoes, operadores, limites, atualizado_em').order('area');
    if (error) {
      throw new ErroDaFerramenta('regras_indisponiveis', 'As regras permanentes não puderam ser lidas agora.', 'Sem as regras, peça aprovação normalmente: nada é liberado.', true);
    }
    return montarRegras((data ?? []) as RegraPermanente[], operador, p.data.so_ligadas === true);
  },
}];
