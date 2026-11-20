/**
 * MCP 2.38.0 (20/11/2026): aceleriq_arquivos_enviar_para_aprovacao.
 *
 * Irmã de aceleriq_mesa_enviar_para_aprovacao (que só aceita trabalho do
 * Estúdio): manda um arquivo ou um carrossel de Arquivos para aprovação,
 * SEMPRE pela raiz, com a mesma regra da RPC mesa_enviar_para_aprovacao:
 * - admin ou gestor (manager): admin_release_file_now(raiz, 'approval') —
 *   revisão da agência, liberação e aviso ao cliente;
 * - design ou tráfego: request_file_agency_review(raiz) — pede a revisão da
 *   agência; um admin ou gestor libera depois.
 * As duas RPCs exigem parent_file_id nulo e propagam para os filhos. A
 * escrita vai como a pessoa conectada (rpcComoPessoa): o banco confere papel
 * e acesso ao cliente de novo.
 *
 * O papel é lido em user_roles (o mesmo has_role das RPCs). Sem pessoa
 * (chave sem dono), a ponte recusa antes da rede.
 */

import { z } from 'https://esm.sh/zod@3.23.8';
import type { ToolDefinition } from '../../_shared/mcp-tools.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { DataScopeError } from '../../_shared/mcp-auth.ts';
import { dataScopeAllowsClient } from '../../_shared/mcp-security.ts';
import { db } from '../../_shared/aceleriq-read-services.ts';
import { rpcComoPessoa, umaVez } from '../../_shared/mcp-mesas-acoes.ts';
import { AVISO_ACAO_SO_COM_PESSOA } from '../../_shared/mcp-mesas-ponte.ts';
import {
  type ArquivoDoCarrossel,
  ehImagemDoCarrossel,
  estadoDaAprovacao,
  internoSemAprovacao,
  MIN_CARDS,
  ordenarComoOPainel,
  rotuloDoEnvio,
} from './carrossel-de-arquivos.ts';
import { COLUNAS_DO_ARQUIVO } from './arquivos-agrupar-carrossel.ts';

export const NOME_ENVIAR_ARQUIVO = 'aceleriq_arquivos_enviar_para_aprovacao';
const ESCRITA = { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false };

export const enviarArquivoSchema = z.object({
  file_id: z.string().uuid(),
  confirmar: z.boolean().optional(),
  idempotency_key: z.string().trim().min(8).max(120).optional(),
}).strict().refine((v) => v.confirmar !== true || !!v.idempotency_key, {
  message: 'idempotency_key (8 a 120 caracteres) é obrigatória com confirmar=true',
  path: ['idempotency_key'],
});

export type PedidoDeEnviarArquivo = z.infer<typeof enviarArquivoSchema>;

export type Caminho = 'liberar_ao_cliente' | 'pedir_revisao_da_agencia';

/** A regra de mesa_enviar_para_aprovacao: admin/gestor libera ao cliente; design/tráfego pede a revisão da agência. */
export function caminhoPorPapel(papeis: readonly string[]): Caminho | null {
  if (papeis.includes('admin') || papeis.includes('manager')) return 'liberar_ao_cliente';
  if (papeis.includes('design') || papeis.includes('traffic')) return 'pedir_revisao_da_agencia';
  return null;
}

export const ESTADO_POR_CAMINHO: Record<Caminho, 'aguardando_cliente' | 'aguardando_agencia'> = {
  liberar_ao_cliente: 'aguardando_cliente',
  pedir_revisao_da_agencia: 'aguardando_agencia',
};

/** Problemas do envio (vazio = pode enviar). Raiz e filhos no mesmo estado, carrossel só de imagens e com 2+ cards. */
export function problemasDoEnvio(raiz: ArquivoDoCarrossel, filhos: readonly ArquivoDoCarrossel[]): string[] {
  const p: string[] = [];
  if (raiz.archived_at) p.push('A raiz está arquivada. Restaure com aceleriq_restore_file antes.');
  if ((raiz.status || 'ready') !== 'ready') p.push(`A raiz ainda não está pronta (status ${raiz.status}).`);
  if (!raiz.storage_path && !raiz.file_url) p.push('O upload da raiz não concluiu (sem storage).');
  if (!internoSemAprovacao(raiz)) {
    p.push(`Já está em aprovação ou fora dela: ${estadoDaAprovacao(raiz)}. Nada a enviar. Para reenviar do zero, retire antes com aceleriq_workspace_retirar_aprovacao.`);
  }
  if (filhos.length) {
    if (filhos.length + 1 < MIN_CARDS) p.push('Carrossel precisa de pelo menos 2 cards.');
    if (!ehImagemDoCarrossel(raiz)) p.push('A raiz do carrossel não é imagem png, jpg ou webp.');
    for (const f of filhos) {
      const rotulo = `Card ${f.file_name} (${f.id})`;
      if (f.client_id !== raiz.client_id || (f.project_id ?? null) !== (raiz.project_id ?? null)) p.push(`${rotulo}: de outro cliente ou projeto.`);
      if (!ehImagemDoCarrossel(f)) p.push(`${rotulo}: não é imagem png, jpg ou webp.`);
      if (f.archived_at) p.push(`${rotulo}: está arquivado (o cliente veria o carrossel sem ele). Restaure ou tire do carrossel antes.`);
      if ((f.status || 'ready') !== 'ready') p.push(`${rotulo}: ainda não está pronto.`);
      if (!f.storage_path && !f.file_url) p.push(`${rotulo}: o upload não concluiu.`);
      if (!internoSemAprovacao(f)) p.push(`${rotulo}: não está no mesmo estado da raiz (${estadoDaAprovacao(f)}).`);
    }
  }
  return p;
}

// deno-lint-ignore no-explicit-any
type Consulta = any;
type Resultado = { data: unknown; error: { message: string } | null };

export interface DependenciasDoEnvio {
  banco: { from(tabela: string): Consulta };
  rpc: (nome: 'admin_release_file_now' | 'request_file_agency_review', args: Record<string, unknown>, ctx: AuthContext) => Promise<unknown>;
  umaVez: typeof umaVez;
}

function dependenciasPadrao(): DependenciasDoEnvio {
  return { banco: db(), rpc: rpcComoPessoa, umaVez };
}

function lido<T>(r: Resultado, oque: string): T {
  if (r.error) throw new Error(`Não foi possível ler ${oque} agora. Tente de novo.`);
  return r.data as T;
}

/** Estado depois do envio, lido da raiz (a fonte da verdade é o banco). */
export function estadoLido(f: Pick<ArquivoDoCarrossel, 'visibility' | 'agency_approval_status' | 'approval_status' | 'locked_at'> | null): string | null {
  if (!f) return null;
  if (f.visibility && f.visibility !== 'internal') return f.approval_status === 'approved' ? 'aprovado' : 'aguardando_cliente';
  if (f.agency_approval_status === 'pending') return 'aguardando_agencia';
  return 'interno';
}

export async function enviarArquivoParaAprovacao(
  input: PedidoDeEnviarArquivo,
  ctx: AuthContext,
  deps: DependenciasDoEnvio = dependenciasPadrao(),
): Promise<Record<string, unknown>> {
  const { banco } = deps;
  const arquivo = lido<ArquivoDoCarrossel | null>(
    await banco.from('files').select(COLUNAS_DO_ARQUIVO).eq('id', input.file_id).maybeSingle(),
    'o arquivo',
  );
  if (!arquivo) throw new Error('Arquivo não encontrado.');
  if (!dataScopeAllowsClient(ctx.dataScope, arquivo.client_id)) {
    throw new DataScopeError('resource is outside this MCP principal data scope');
  }
  if (arquivo.parent_file_id) {
    throw new Error(`Este arquivo é um card de carrossel. A aprovação vai pela raiz: chame de novo com file_id ${arquivo.parent_file_id}.`);
  }
  const filhos = lido<ArquivoDoCarrossel[] | null>(
    await banco.from('files').select(COLUNAS_DO_ARQUIVO).eq('parent_file_id', arquivo.id),
    'os cards do carrossel',
  ) ?? [];
  const problemas = problemasDoEnvio(arquivo, filhos);
  const cards = filhos.length + 1;
  const ordem = ordenarComoOPainel(arquivo, filhos).map((f, i) => ({ ordem: i + 1, file_id: f.id, nome: f.file_name }));

  const userId = ctx.dataScope?.principalUserId ?? null;
  const papeis = userId
    ? (lido<Array<{ role: string }> | null>(await banco.from('user_roles').select('role').eq('user_id', userId), 'o papel da pessoa') ?? []).map((r) => String(r.role))
    : [];
  const caminho = userId ? caminhoPorPapel(papeis) : null;
  if (userId && !caminho) problemas.push('A pessoa conectada não é da equipe (admin, gestor, design ou tráfego): não pode mandar para aprovação.');

  const resumo = {
    root_file_id: arquivo.id,
    client_id: arquivo.client_id,
    cards,
    rotulo: rotuloDoEnvio(cards),
    ordem_dos_cards: ordem,
    estado_atual: estadoDaAprovacao(arquivo),
  };

  if (input.confirmar !== true) {
    return {
      ok: true,
      simulacao: true,
      pode_enviar: problemas.length === 0 && !!caminho,
      ...resumo,
      caminho: caminho ?? 'sem_pessoa',
      estado_depois: caminho ? ESTADO_POR_CAMINHO[caminho] : null,
      problemas,
      ...(userId ? {} : { aviso_da_sessao: AVISO_ACAO_SO_COM_PESSOA }),
      aviso: 'Simulação: nada foi enviado. Com confirmar=true (e idempotency_key) o envio acontece; com admin ou gestor o cliente é avisado na hora.',
    };
  }
  // A recusa mora dentro do umaVez: repetir a chave de um envio que deu certo volta replay, não "já em aprovação".
  return await deps.umaVez(NOME_ENVIAR_ARQUIVO, ctx, input.idempotency_key!, async () => {
    if (problemas.length) throw new Error(`Não dá para enviar: ${problemas.join(' ')}`);
    if (ctx.resultRefHolder) ctx.resultRefHolder.value = `files:${arquivo.id}`;
    // Sem pessoa, a ponte recusa com exige_oauth antes da rede (rpcComoPessoa).
    const c: Caminho = caminho ?? 'pedir_revisao_da_agencia';
    if (c === 'liberar_ao_cliente') {
      await deps.rpc('admin_release_file_now', { p_file_id: arquivo.id, p_mode: 'approval' }, ctx);
    } else {
      await deps.rpc('request_file_agency_review', { p_file_id: arquivo.id }, ctx);
    }
    const depois = lido<ArquivoDoCarrossel | null>(
      await banco.from('files').select(COLUNAS_DO_ARQUIVO).eq('id', arquivo.id).maybeSingle(),
      'o arquivo depois do envio',
    );
    const estado = estadoLido(depois) ?? ESTADO_POR_CAMINHO[c];
    return {
      ref: `files:${arquivo.id}`,
      resultado: {
        simulacao: false,
        ...resumo,
        caminho: c,
        estado,
        observacao: c === 'liberar_ao_cliente'
          ? `Liberado ao cliente como ${rotuloDoEnvio(cards)} (uma aprovação só, pela raiz). Nada foi agendado nem publicado.`
          : `Pedida a revisão da agência (${rotuloDoEnvio(cards)}). Um admin ou gestor libera ao cliente depois. Nada foi agendado nem publicado.`,
      },
    };
  }, { file_id: arquivo.id });
}

function erroDeEntrada(e: z.ZodError): Error {
  return new Error(`Invalid input: ${e.issues.map((i) => `${i.path.join('.') || 'entrada'}: ${i.message}`).join('; ')}`);
}

const tool: ToolDefinition = {
  name: NOME_ENVIAR_ARQUIVO,
  title: 'Arquivos: mandar arquivo ou carrossel para aprovação',
  description:
    'Manda um arquivo ou um carrossel de Arquivos para aprovação pela RAIZ (o cliente recebe uma aprovação só: "Carrossel · N" ou "Arquivo único"). Mesma regra de aceleriq_mesa_enviar_para_aprovacao (aquela é para trabalho do Estúdio; esta, para o que já está em Arquivos): com papel de admin ou gestor libera direto ao cliente, que é avisado (aguardando_cliente); com papel de design ou tráfego pede a revisão da agência (aguardando_agencia). Card de carrossel é recusado apontando a raiz; carrossel exige todos os cards imagens, prontos e no mesmo estado interno; o que já está em aprovação é recusado com o estado atual. Cards soltos: agrupe antes com aceleriq_arquivos_agrupar_carrossel. Sem confirmar é simulação; confirmar=true envia (efeito visível ao cliente) e exige idempotency_key. Roda com a sessão da pessoa (OAuth ou chave com dono). Não agenda nem publica. Exige files:write e o cliente no escopo.',
  scopes: ['files:write'],
  annotations: ESCRITA,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['file_id'],
    properties: {
      file_id: { type: 'string', format: 'uuid', description: 'Raiz em public.files (arquivo único ou capa do carrossel).' },
      confirmar: { type: 'boolean', description: 'true envia (o cliente pode ser avisado); ausente ou false só simula.' },
      idempotency_key: { type: 'string', minLength: 8, maxLength: 120, description: 'Obrigatória com confirmar=true. Repetir não envia de novo.' },
    },
  },
  handler: async (input, ctx) => {
    const parsed = enviarArquivoSchema.safeParse(input ?? {});
    if (!parsed.success) throw erroDeEntrada(parsed.error);
    return await enviarArquivoParaAprovacao(parsed.data, ctx);
  },
};

export const FERRAMENTA_DE_ENVIAR_ARQUIVO: readonly ToolDefinition[] = [tool];
