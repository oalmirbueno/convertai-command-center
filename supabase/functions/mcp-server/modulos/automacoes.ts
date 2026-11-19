/**
 * MCP 2.36.0 (19/11/2026): Central de Automações.
 *
 * Qualquer IA da casa enxerga o n8n de produção sem SSH e sem chave do n8n: lista dos fluxos por grupo, saúde do
 * servidor, execuções com o caminho que cada uma fez e o guia de como trabalhar no n8n. O retrato vem do coletor
 * do VPS (a cada minuto). Ligar e desligar tem escopo próprio (automacoes:write, que nenhum outro escopo concede),
 * pede confirmar:true e motivo, e fica registrado com o nome da credencial.
 */

import type { ToolDefinition } from '../../_shared/mcp-tools.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { db } from '../../_shared/aceleriq-read-services.ts';
import { ErroDaFerramenta } from './robustez.ts';
import { ErroDeAutomacao, ligarDesligar, montarConfirmacao } from '../../_shared/automacoes.ts';
import { GUIA_DO_N8N } from '../../_shared/automacoes-guia.ts';

type Linha = Record<string, unknown>;


async function painel() {
  const { data, error } = await db().rpc('automacoes_painel');
  if (error || !data) {
    throw new ErroDaFerramenta('automacoes_indisponiveis', 'A Central de Automações não respondeu agora.', 'Tente de novo em instantes.', true);
  }
  return data as { coleta: Linha | null; fluxos: Linha[]; saude: Linha[]; acoes: Linha[] };
}

function agrupar(fluxos: Linha[]) {
  const grupos: Record<string, Linha[]> = {};
  for (const f of fluxos) (grupos[String(f.grupo ?? 'Outros')] ??= []).push(f);
  return grupos;
}

export const FERRAMENTAS_DAS_AUTOMACOES: readonly ToolDefinition[] = [
  {
    name: 'aceleriq_automacoes_listar',
    title: 'Automações: fluxos do n8n',
    description:
      'Só leitura. Todos os fluxos do n8n de produção em pastas: da_aceleriq (por grupo: Clientes, Comercial, Instagram, Apoio, Desligado) e de_clientes (fluxos feitos para um cliente, por cliente): ligado ou não, gatilhos, última e próxima execução, rodadas e erros em 24 h, se mexe com cliente. Retrato do coletor do servidor (a cada minuto; "coleta.atrasada" avisa quando parou).',
    scopes: ['aceleriq:read'],
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
    cacheSeg: 20,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        grupo: { type: 'string', description: 'Só um grupo (ex.: Clientes).' },
        so_desligados: { type: 'boolean' },
        so_com_erro: { type: 'boolean' },
      },
    },
    handler: async (input) => {
      const p = (input ?? {}) as { grupo?: string; so_desligados?: boolean; so_com_erro?: boolean };
      const d = await painel();
      let fluxos = d.fluxos;
      if (p.grupo) fluxos = fluxos.filter((f) => String(f.grupo).toLowerCase() === p.grupo!.toLowerCase());
      if (p.so_desligados) fluxos = fluxos.filter((f) => f.ativo === false);
      if (p.so_com_erro) fluxos = fluxos.filter((f) => Number(f.erros_24h) > 0);
      // 19/11: as da Aceleriq (por grupo) e as de cada cliente (por cliente), como as pastas da tela.
      const deClientes: Record<string, Linha[]> = {};
      for (const f of fluxos) if (f.client_id) (deClientes[String(f.cliente ?? f.client_id)] ??= []).push(f);
      return {
        coleta: d.coleta,
        total: d.fluxos.length,
        ligados: d.fluxos.filter((f) => f.ativo === true).length,
        da_aceleriq: agrupar(fluxos.filter((f) => !f.client_id)),
        de_clientes: deClientes,
        ultimas_acoes: d.acoes.slice(0, 5),
      };
    },
  },
  {
    name: 'aceleriq_automacoes_saude',
    title: 'Automações: saúde do servidor',
    description:
      'Só leitura. Saúde do que move as automações: n8n no ar, porta dos webhooks (n8n.aceleriq.com.br), ponte do WhatsApp da equipe (3429), leitor dos grupos, timers de envio aos grupos e de post no ar, vigia, cópia diária, disco e vencimentos. Cada item vem ok, atencao ou falha com o detalhe.',
    scopes: ['aceleriq:read'],
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
    cacheSeg: 20,
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    handler: async () => {
      const d = await painel();
      const ruins = d.saude.filter((s) => s.estado !== 'ok');
      return { coleta: d.coleta, resumo: ruins.length ? `${ruins.length} item(ns) pedem atenção` : 'tudo ok', itens: d.saude };
    },
  },
  {
    name: 'aceleriq_automacoes_execucoes',
    title: 'Automações: execuções de um fluxo',
    description:
      'Só leitura. As últimas execuções de um fluxo (até 100): estado, horário, o caminho de nós que percorreu, onde parou e o erro (mascarado, sem dado de cliente nem segredo). incluir_desenho traz os nós e as ligações do fluxo.',
    scopes: ['aceleriq:read'],
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
    cacheSeg: 15,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['fluxo_id'],
      properties: {
        fluxo_id: { type: 'string', description: 'Id do fluxo (de aceleriq_automacoes_listar).' },
        limite: { type: 'integer', minimum: 1, maximum: 100 },
        incluir_desenho: { type: 'boolean' },
      },
    },
    handler: async (input) => {
      const p = (input ?? {}) as { fluxo_id?: string; limite?: number; incluir_desenho?: boolean };
      if (!p.fluxo_id || !/^[A-Za-z0-9_-]{1,64}$/.test(p.fluxo_id)) throw new ErroDaFerramenta('entrada_invalida', 'fluxo_id inválido.', null, false);
      const { data, error } = await db().rpc('automacoes_fluxo', { _id: p.fluxo_id, _limite: p.limite ?? 20 });
      if (error) throw new ErroDaFerramenta('automacoes_indisponiveis', 'A Central de Automações não respondeu agora.', 'Tente de novo em instantes.', true);
      if (!data) throw new ErroDaFerramenta('fluxo_nao_encontrado', 'Esse fluxo não está na Central.', 'Veja os ids em aceleriq_automacoes_listar.', false);
      const r = data as Linha;
      if (!p.incluir_desenho) delete r.desenho;
      return r;
    },
  },
  {
    name: 'aceleriq_automacoes_guia',
    title: 'Automações: como trabalhar no n8n',
    description:
      'Só leitura. Tudo o que uma IA precisa para trabalhar no n8n da Aceleriq sem atrapalhar: endereços, onde roda, o que é cada grupo, onde está o código, como publicar uma mudança (desligar, importar, ligar), o que nunca fazer e as ferramentas. Não traz segredo.',
    scopes: ['aceleriq:read'],
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
    cacheSeg: 300,
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    handler: async () => GUIA_DO_N8N,
  },
  {
    name: 'aceleriq_automacoes_ligar_desligar',
    title: 'Automações: ligar ou desligar um fluxo',
    description:
      'Liga ou desliga um fluxo do n8n de produção pela API pública. Escopo automacoes:write (nenhum outro escopo concede). Sem confirmar:true devolve só o aviso do efeito (o que para, se mexe com cliente). Com confirmar:true e motivo, executa e registra a credencial, o motivo e o resultado. Fluxo de Clientes, Comercial ou Instagram: só com ordem do dono.',
    scopes: ['automacoes:write'],
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['fluxo_id', 'acao'],
      properties: {
        fluxo_id: { type: 'string' },
        acao: { type: 'string', enum: ['ligar', 'desligar'] },
        confirmar: { type: 'boolean', description: 'true executa; sem isso só mostra o aviso.' },
        motivo: { type: 'string', maxLength: 300, description: 'Obrigatório para executar: quem mandou e por quê.' },
      },
    },
    handler: async (input, ctx?: AuthContext) => {
      const p = (input ?? {}) as { fluxo_id?: string; acao?: 'ligar' | 'desligar'; confirmar?: boolean; motivo?: string };
      if (!p.fluxo_id || !/^[A-Za-z0-9_-]{1,64}$/.test(p.fluxo_id)) throw new ErroDaFerramenta('entrada_invalida', 'fluxo_id inválido.', null, false);
      if (p.acao !== 'ligar' && p.acao !== 'desligar') throw new ErroDaFerramenta('entrada_invalida', 'acao precisa ser ligar ou desligar.', null, false);
      const { data: f, error } = await db().from('automacao_fluxos').select('id, nome, grupo, ativo').eq('id', p.fluxo_id).maybeSingle();
      if (error) throw new ErroDaFerramenta('automacoes_indisponiveis', 'Não consegui ler o fluxo agora.', 'Tente de novo.', true);
      if (!f) throw new ErroDaFerramenta('fluxo_nao_encontrado', 'Esse fluxo não está na Central.', 'Veja os ids em aceleriq_automacoes_listar.', false);
      const conf = montarConfirmacao(f as { nome: string; grupo: string; ativo: boolean }, p.acao);
      if (conf.ja_esta) return { ok: true, nada_a_fazer: true, ativo: (f as Linha).ativo, fluxo_nome: (f as Linha).nome };
      if (p.confirmar !== true || !p.motivo?.trim()) {
        return { executado: false, fluxo_nome: (f as Linha).nome, acao: p.acao, ...conf, como_executar: 'Chame de novo com confirmar:true e motivo (quem mandou e por quê).' };
      }
      try {
        return await ligarDesligar(db(), {
          fluxoId: p.fluxo_id, acao: p.acao, quemId: null, quemNome: `chave:${ctx?.keyName ?? 'mcp'}`, via: 'mcp', motivo: p.motivo.trim(),
        });
      } catch (e) {
        if (e instanceof ErroDeAutomacao) throw new ErroDaFerramenta(e.codigo, e.message, null, e.status >= 500);
        throw e;
      }
    },
  },
];
