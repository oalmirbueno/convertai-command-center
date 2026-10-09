/**
 * Hermes ↔ navegador remoto real do cliente (lote C, 09/10/2026; MCP 2.7.0).
 *
 * O mesmo motor da Central e do Gestor (_shared/navegador-operacional.ts): perfil do navegador
 * por cliente (login guardado, nunca compartilhado), trava de um agente por vez, registro de
 * cada ação com evidência (URL, título, trecho lido, captura de tela) e a tela ao vivo na Central.
 * - Só chave irrestrita da equipe (o Hermes). Cliente sempre explícito.
 * - Ler, navegar, pesquisar, capturar e abas: livres. Clicar e digitar: valem, mas clicar em
 *   algo que publica, envia, paga, assina ou apaga exige aprovacao_id de uma aprovação já
 *   aprovada (aceleriq_operator_request_approval); senha nunca é digitada pelo agente.
 * - O endereço de conexão e a chave do provedor nunca saem do servidor.
 * Autorizado pelo dono em 09/10/2026.
 */
import { z } from 'https://esm.sh/zod@3.23.8';
import type { ToolDefinition } from './mcp-tools.ts';
import { db } from './aceleriq-read-services.ts';
import type { AuthContext } from './mcp-auth.ts';
import { ACOES_DO_NAVEGADOR, ErroDoNavegador, sessaoDoCliente, tocar, usarNavegador } from './navegador-operacional.ts';
import { provedorDoAmbiente } from '../navegador-remoto/provedor.ts';

const UUID = z.string().uuid();

function exigirEquipe(ctx: AuthContext) {
  if (!ctx.dataScope?.unrestricted) throw new Error('somente_equipe: o navegador remoto é ferramenta da equipe (chave irrestrita).');
}

function provedorOuErro() {
  const p = provedorDoAmbiente();
  if (!p) throw new Error('nao_configurado: o navegador remoto ainda não foi ligado (falta a conta do provedor).');
  return p;
}

function erroDeEntrada(e: z.ZodError): Error {
  return new Error(`Invalid input: ${e.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
}

export const browserSessionTool: ToolDefinition = {
  name: 'aceleriq_browser_session',
  title: 'Navegador remoto do cliente (sessão)',
  description:
    'Abre (ou reaproveita) o navegador remoto real de UM cliente, no perfil dele (login feito uma vez pela equipe fica guardado), e diz se está vivo, quem está comandando agora e as abas abertas. A equipe acompanha ao vivo na Central (Ferramentas > Navegador > Remoto do cliente). Use acao "estado" para ver sem abrir, "abrir" antes de usar aceleriq_browser_act, "acoes" para ler o registro das últimas ações com evidência, e "encerrar" ao terminar (economiza as horas do plano).',
  scopes: ['aceleriq:write'],
  annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: true },
  inputSchema: {
    type: 'object',
    properties: {
      client_id: { type: 'string', description: 'UUID do cliente.' },
      acao: { type: 'string', enum: ['estado', 'abrir', 'acoes', 'encerrar'], description: 'O que fazer com a sessão.' },
      pedido: { type: 'string', description: 'Para que o navegador vai ser usado (fica no registro).' },
    },
    required: ['client_id', 'acao'],
    additionalProperties: false,
  },
  handler: async (input, ctx) => {
    exigirEquipe(ctx);
    const p = z.object({ client_id: UUID, acao: z.enum(['estado', 'abrir', 'acoes', 'encerrar']), pedido: z.string().max(500).optional() }).strict().safeParse(input ?? {});
    if (!p.success) throw erroDeEntrada(p.error);
    const { client_id, acao, pedido } = p.data;
    if (acao === 'acoes') {
      const { data } = await db().from('navegador_acoes').select('id, agente, acao, alvo, ok, url, titulo, erro, evidencia_caminho, criado_em').eq('client_id', client_id).order('criado_em', { ascending: false }).limit(20);
      return { acoes: data ?? [] };
    }
    const prov = provedorOuErro();
    if (acao === 'estado') {
      const { data } = await db().from('navegador_sessoes').select('id, sessao_externa, comandada_por, trava_ate, ultima_url, ultima_atividade').eq('client_id', client_id).eq('estado', 'aberta').order('aberta_em', { ascending: false }).limit(1).maybeSingle();
      if (!data) return { aberta: false };
      const s = data as { id: string; sessao_externa: string; comandada_por: string | null; trava_ate: string | null; ultima_url: string | null; ultima_atividade: string | null };
      const viva = await prov.verSessao(s.sessao_externa).catch(() => null);
      const comandando = s.trava_ate && new Date(s.trava_ate).getTime() > Date.now() ? s.comandada_por : null;
      return { aberta: !!viva?.rodando, sessao_id: s.id, comandada_por: comandando, ultima_url: s.ultima_url, ultima_atividade: s.ultima_atividade, abas: (viva?.paginas ?? []).map((x, i) => ({ indice: i, titulo: x.titulo, url: x.url })) };
    }
    if (acao === 'encerrar') {
      const { data } = await db().from('navegador_sessoes').select('id, sessao_externa').eq('client_id', client_id).eq('estado', 'aberta');
      for (const s of (data ?? []) as Array<{ id: string; sessao_externa: string }>) {
        await prov.encerrar(s.sessao_externa).catch(() => undefined);
        await db().from('navegador_sessoes').update({ estado: 'encerrada', encerrada_em: new Date().toISOString(), comandada_por: null, trava_ate: null }).eq('id', s.id);
      }
      return { encerradas: (data ?? []).length };
    }
    const { sessao, nova } = await sessaoDoCliente(db() as never, prov, { clientId: client_id, origem: 'hermes', pedido: pedido ?? null });
    if (nova) await tocar(prov, sessao.sessao_externa);
    const viva = await prov.verSessao(sessao.sessao_externa).catch(() => null);
    return { sessao_id: sessao.id, nova, rodando: !!viva?.rodando, abas: (viva?.paginas ?? []).map((x, i) => ({ indice: i, titulo: x.titulo, url: x.url })), ao_vivo_na_central: 'Execução > Central > Ferramentas > Navegador > Remoto do cliente' };
  },
};

export const browserActTool: ToolDefinition = {
  name: 'aceleriq_browser_act',
  title: 'Navegador remoto do cliente (agir)',
  description:
    'Faz UMA ação no navegador remoto real do cliente e devolve o que a página mostra (URL, título, texto, links ou resultados da pesquisa) com a evidência registrada (captura de tela). Ações: navegar (url), ler (página atual), pesquisar (termos, na web), capturar (tela), clicar (texto visível ou seletor), digitar (campo e valor), abas (lista), nova_aba (url). Um agente por vez: se outro estiver comandando, volta "sessao_ocupada". Clicar em algo que publica, envia, paga, assina ou apaga só com aprovacao_id de aprovação já aprovada (aceleriq_operator_request_approval); senha nunca: o login é feito pela equipe no navegador ao vivo, uma vez, e fica guardado no perfil do cliente.',
  scopes: ['aceleriq:write'],
  longRunning: true,
  annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: true },
  inputSchema: {
    type: 'object',
    properties: {
      client_id: { type: 'string', description: 'UUID do cliente.' },
      acao: { type: 'string', enum: [...ACOES_DO_NAVEGADOR], description: 'A ação.' },
      url: { type: 'string', description: 'Para navegar ou nova_aba (http ou https).' },
      termos: { type: 'string', description: 'Para pesquisar.' },
      texto: { type: 'string', description: 'Para clicar: o texto visível do botão ou link.' },
      seletor: { type: 'string', description: 'Para clicar ou digitar: seletor CSS (opcional).' },
      campo: { type: 'string', description: 'Para digitar: rótulo, placeholder ou nome do campo.' },
      valor: { type: 'string', description: 'Para digitar: o texto.' },
      aba: { type: 'number', description: 'Índice da aba (0 = primeira).' },
      pedido: { type: 'string', description: 'Para que serve esta ação (fica no registro).' },
      aprovacao_id: { type: 'string', description: 'UUID da aprovação aprovada, para clique sensível.' },
    },
    required: ['client_id', 'acao'],
    additionalProperties: false,
  },
  handler: async (input, ctx) => {
    exigirEquipe(ctx);
    const p = z.object({
      client_id: UUID, acao: z.enum(ACOES_DO_NAVEGADOR), url: z.string().max(2000).optional(), termos: z.string().max(300).optional(),
      texto: z.string().max(160).optional(), seletor: z.string().max(300).optional(), campo: z.string().max(120).optional(), valor: z.string().max(2000).optional(),
      aba: z.number().int().min(0).max(30).optional(), pedido: z.string().max(500).optional(), aprovacao_id: UUID.optional(),
    }).strict().safeParse(input ?? {});
    if (!p.success) throw erroDeEntrada(p.error);
    const d = p.data;
    try {
      const r = await usarNavegador(db() as never, provedorOuErro(), {
        clientId: d.client_id, agente: 'hermes', acao: d.acao, url: d.url ?? null, termos: d.termos ?? null, texto: d.texto ?? null, seletor: d.seletor ?? null,
        campo: d.campo ?? null, valor: d.valor ?? null, aba: d.aba ?? null, pedido: d.pedido ?? null, aprovacaoId: d.aprovacao_id ?? null,
      });
      return { ...r, texto: r.texto ? r.texto.slice(0, 8000) : null };
    } catch (e) {
      if (e instanceof ErroDoNavegador) throw new Error(`${e.codigo}: ${e.message}`);
      throw e;
    }
  },
};
