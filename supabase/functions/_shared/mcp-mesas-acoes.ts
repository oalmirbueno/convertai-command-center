/**
 * Ações do MCP nas mesas (MCP 2.3): o agente também FAZ, não só vê.
 *
 * Cada ação chama a função da mesa correspondente pelo servidor, com a
 * sessão da pessoa conectada (ver mcp-mesas-ponte.ts, que explica o porquê).
 * Nada de regra de negócio duplicada aqui: validar campanha, conferir foto
 * do acervo, versionar briefing, gravar a agenda, entregar a arte e liberar
 * para aprovação são trabalho da mesa. Este arquivo só:
 *
 * 1. confere a fronteira do cliente antes de sair (assertClientAccess), para
 *    principal restrito nunca chegar à rede;
 * 2. exige confirmação explícita onde há custo de IA ou efeito no cliente;
 * 3. aplica a idempotência do MCP (a mesma idempotency_key não refaz nada);
 * 4. devolve o resultado da mesa com a prova de quem fez.
 *
 * O token da pessoa só vai no cabeçalho para a URL do próprio projeto
 * (SUPABASE_URL/functions/v1/<função da lista fechada>). Não entra em log,
 * resposta nem auditoria.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { db, isUuid } from './aceleriq-read-services.ts';
import { assertClientAccess, type AuthContext } from './mcp-auth.ts';
import { exigirClienteExistente } from './mcp-client-id-guard.ts';
import { getMcpRuntimeConfig } from './mcp-runtime.ts';
import { findIdempotentResult } from './mcp-write-services.ts';
import {
  acaoPermitida,
  AVISO_ACAO_SO_COM_PESSOA,
  feitoPor,
  juntarBriefingDeAds,
  lerRespostaDaMesa,
  prazoDaAcao,
  type FuncaoDaMesa,
  type RpcDaPonte,
} from './mcp-mesas-ponte.ts';

const TETO_DA_RESPOSTA = 5 * 1024 * 1024;

function falha(codigo: string, mensagem: string): Error {
  return new Error(`mesa:${codigo} ${mensagem}`);
}

function tokenDaPessoa(ctx: AuthContext): string {
  const token = ctx.userAccessToken;
  if (!token || ctx.dataScope?.source !== 'oauth') throw falha('exige_oauth', AVISO_ACAO_SO_COM_PESSOA);
  return token;
}

function enderecoDoProjeto(): { url: string; anon: string } {
  const url = getMcpRuntimeConfig().supabaseUrl;
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!url || !anon) throw falha('configuracao', 'SUPABASE_URL ou SUPABASE_ANON_KEY ausente no servidor do MCP.');
  return { url: url.replace(/\/+$/, ''), anon };
}

async function conferirCliente(clientId: string, ctx: AuthContext) {
  if (!isUuid(clientId)) throw new Error('client_id must be a UUID');
  assertClientAccess(ctx, clientId);
  await exigirClienteExistente(db(), clientId);
}

/** Cliente dono de uma linha (campanha, proposta, trabalho): para conferir a fronteira antes de sair. */
async function clienteDaLinha(tabela: string, id: string, rotulo: string): Promise<string> {
  if (!isUuid(id)) throw new Error(`${rotulo} must be a UUID`);
  const { data, error } = await db().from(tabela).select('client_id').eq('id', id).maybeSingle();
  if (error) throw falha('leitura', `${tabela}: ${error.message}`);
  const clientId = (data as { client_id?: string } | null)?.client_id;
  if (!clientId) throw falha('nao_encontrado', `${rotulo} não existe.`);
  return clientId;
}

/** Chama uma ação de uma mesa como a pessoa conectada. */
export async function chamarMesa(
  funcao: FuncaoDaMesa,
  acao: string,
  corpo: Record<string, unknown>,
  ctx: AuthContext,
): Promise<Record<string, unknown>> {
  if (!acaoPermitida(funcao, acao)) throw falha('acao_fora_da_ponte', `${funcao}/${acao} não está na lista de ações do MCP.`);
  const token = tokenDaPessoa(ctx);
  const { url, anon } = enderecoDoProjeto();
  const prazo = prazoDaAcao(funcao, acao);
  let resposta: Response;
  try {
    resposta = await fetch(`${url}/functions/v1/${funcao}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anon,
        'Content-Type': 'application/json',
        'x-client-info': 'aceleriq-mcp-acoes',
      },
      body: JSON.stringify({ ...corpo, acao }),
      redirect: 'error',
      signal: AbortSignal.timeout(prazo),
    });
  } catch (e) {
    const nome = e instanceof Error ? e.name : '';
    if (nome === 'TimeoutError' || nome === 'AbortError') {
      throw falha('tempo_esgotado', `A mesa não respondeu em ${Math.round(prazo / 1000)} s. A ação pode ter terminado do outro lado: confira pela leitura da mesa ou no painel ANTES de repetir.`);
    }
    throw falha('rede', 'Não foi possível falar com a mesa agora. Tente de novo em instantes.');
  }
  const declarado = Number(resposta.headers.get('content-length') ?? '0');
  if (declarado > TETO_DA_RESPOSTA) {
    await resposta.body?.cancel().catch(() => {});
    throw falha('resposta_grande', 'A mesa devolveu mais dados do que o MCP repassa. Leia pela ferramenta de contexto da mesa.');
  }
  const texto = await resposta.text();
  if (texto.length > TETO_DA_RESPOSTA) throw falha('resposta_grande', 'A mesa devolveu mais dados do que o MCP repassa. Leia pela ferramenta de contexto da mesa.');
  const lido = lerRespostaDaMesa(texto, resposta.status);
  if (!lido.ok) {
    const detalhe = lido.detalhes ? ` Detalhes: ${JSON.stringify(lido.detalhes).slice(0, 600)}` : '';
    throw falha(lido.codigo, `${lido.mensagem}${detalhe}`);
  }
  return lido.dados;
}

/** Chama uma RPC do banco como a pessoa (auth.uid() = ela), para as regras da RPC valerem. */
export async function rpcComoPessoa(nome: RpcDaPonte, args: Record<string, unknown>, ctx: AuthContext): Promise<unknown> {
  const token = tokenDaPessoa(ctx);
  const { url, anon } = enderecoDoProjeto();
  const cliente = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await cliente.rpc(nome, args);
  if (error) throw falha('rpc_recusada', `${nome}: ${error.message}`);
  return data;
}

/**
 * Idempotência do MCP: a mesma idempotency_key, pela mesma credencial, em
 * 24 h, não refaz a ação (a trilha de auditoria guarda a chamada e o id do
 * resultado). Quem repete recebe o aviso e o id, sem nada novo na mesa.
 */
async function umaVez(
  ferramenta: string,
  ctx: AuthContext,
  idempotencyKey: string,
  fazer: () => Promise<{ ref: string | null; resultado: Record<string, unknown> }>,
): Promise<Record<string, unknown>> {
  const anterior = await findIdempotentResult(ferramenta, ctx.keyId, idempotencyKey).catch(() => null);
  if (anterior) {
    return {
      ok: true,
      replay: true,
      idempotency_replay_of: anterior.correlationId,
      ref: anterior.resultRef,
      aviso: 'Esta idempotency_key já foi usada com sucesso por esta credencial: nada foi refeito. Leia o estado atual pela leitura da mesa.',
      feito_por: feitoPor(ctx),
    };
  }
  const { ref, resultado } = await fazer();
  if (ref && ctx.resultRefHolder) ctx.resultRefHolder.value = ref;
  return { ok: true, ...resultado, feito_por: feitoPor(ctx) };
}

const idDe = (v: unknown): string | null => {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  return o && typeof o.id === 'string' ? o.id : null;
};

// ─── Calendário (agente-calendario) ──────────────────────────

export async function calendarioPedido(
  input: { client_id: string; mensagem: string; data_inicio?: string; campanha_id?: string; idempotency_key: string },
  ctx: AuthContext,
) {
  await conferirCliente(input.client_id, ctx);
  return await umaVez('aceleriq_mesa_calendario_pedido', ctx, input.idempotency_key, async () => {
    const dados = await chamarMesa('agente-calendario', 'pedido_livre', {
      client_id: input.client_id,
      mensagem: input.mensagem,
      ...(input.data_inicio ? { data_inicio: input.data_inicio } : {}),
      ...(input.campanha_id ? { campanha_id: input.campanha_id } : {}),
    }, ctx);
    const propostaId = idDe(dados.proposta);
    return {
      ref: propostaId ? `proposta:${propostaId}` : null,
      resultado: {
        proposta_id: propostaId,
        resultado_da_mesa: dados,
        proximo_passo: propostaId
          ? `Revise os itens e grave na agenda com aceleriq_mesa_calendario_gravar (proposta_id ${propostaId}). Até gravar, nada entrou no calendário.`
          : 'A mesa não devolveu proposta: leia resultado_da_mesa.',
      },
    };
  });
}

export async function calendarioGravar(
  input: { proposta_id: string; project_id?: string; idempotency_key: string },
  ctx: AuthContext,
) {
  const clientId = await clienteDaLinha('calendario_propostas', input.proposta_id, 'proposta_id');
  await conferirCliente(clientId, ctx);
  return await umaVez('aceleriq_mesa_calendario_gravar', ctx, input.idempotency_key, async () => {
    const dados = await chamarMesa('agente-calendario', 'gravar', {
      proposta_id: input.proposta_id,
      ...(input.project_id ? { project_id: input.project_id } : {}),
    }, ctx);
    return {
      ref: `proposta:${input.proposta_id}`,
      resultado: {
        proposta_id: input.proposta_id,
        client_id: clientId,
        resultado_da_mesa: dados,
        observacao: 'Os itens entram na agenda como tarefas de produção (backlog). Nada foi aprovado, agendado nem publicado.',
      },
    };
  });
}

// ─── Campanhas (agente-calendario) ───────────────────────────

export async function campanhaCriar(
  input: {
    client_id: string; pedido: string; periodo_inicio?: string; periodo_fim?: string; quantidade?: number;
    briefing?: Record<string, unknown>; imagens?: unknown[]; idempotency_key: string;
  },
  ctx: AuthContext,
) {
  await conferirCliente(input.client_id, ctx);
  return await umaVez('aceleriq_mesa_campanha_criar', ctx, input.idempotency_key, async () => {
    const { idempotency_key: _k, ...corpo } = input;
    const dados = await chamarMesa('agente-calendario', 'campanha_criar', corpo as Record<string, unknown>, ctx);
    const campanhaId = idDe(dados.campanha);
    return {
      ref: campanhaId ? `campanha:${campanhaId}` : null,
      resultado: {
        campanha_id: campanhaId,
        proposta_id: idDe(dados.proposta),
        resultado_da_mesa: dados,
        proximo_passo: 'A campanha nasce com uma proposta de conteúdos. Ajuste briefing e imagens com aceleriq_mesa_campanha_salvar e grave os conteúdos com aceleriq_mesa_calendario_gravar.',
      },
    };
  });
}

export async function campanhaSalvar(
  input: { campanha_id: string; briefing?: Record<string, unknown>; imagens?: unknown[]; objetivo?: string; idempotency_key: string },
  ctx: AuthContext,
) {
  const clientId = await clienteDaLinha('mesa_campanhas', input.campanha_id, 'campanha_id');
  await conferirCliente(clientId, ctx);
  return await umaVez('aceleriq_mesa_campanha_salvar', ctx, input.idempotency_key, async () => {
    const { idempotency_key: _k, ...corpo } = input;
    const dados = await chamarMesa('agente-calendario', 'campanha_salvar', corpo as Record<string, unknown>, ctx);
    const recusadas = Array.isArray(dados.recusadas) ? dados.recusadas : [];
    return {
      ref: `campanha:${input.campanha_id}`,
      resultado: {
        campanha_id: input.campanha_id,
        client_id: clientId,
        imagens_recusadas: recusadas,
        aviso: recusadas.length
          ? 'Algumas imagens foram recusadas pela mesa (não são do acervo ativo deste cliente ou são referência da internet). Use ids de aceleriq_mesa_foto_contexto (fotos_aprovadas).'
          : null,
        resultado_da_mesa: dados,
      },
    };
  });
}

// ─── Mesa Ads ────────────────────────────────────────────────

export async function adsBriefingSalvar(
  input: { client_id: string; briefing: Record<string, unknown>; idempotency_key: string },
  ctx: AuthContext,
) {
  await conferirCliente(input.client_id, ctx);
  return await umaVez('aceleriq_mesa_ads_briefing_salvar', ctx, input.idempotency_key, async () => {
    // A mesa grava versão nova inteira: junta com a atual para o que não veio não sumir.
    const { data, error } = await db()
      .from('ads_briefings')
      .select('oferta, publico, objecoes, provas, destino, objetivo, restricoes, versao')
      .eq('client_id', input.client_id)
      .eq('atual', true)
      .order('versao', { ascending: false })
      .limit(1);
    if (error) throw falha('leitura', `ads_briefings: ${error.message}`);
    const atual = ((data ?? []) as Record<string, unknown>[])[0] ?? null;
    const briefing = juntarBriefingDeAds(atual, input.briefing);
    const dados = await chamarMesa('mesa-ads', 'briefing_salvar', { client_id: input.client_id, briefing }, ctx);
    const novo = dados.briefing as Record<string, unknown> | undefined;
    return {
      ref: novo && typeof novo.id === 'string' ? `ads_briefing:${novo.id}` : null,
      resultado: {
        versao_anterior: atual ? atual.versao ?? null : null,
        versao_nova: novo ? novo.versao ?? null : null,
        observacao: 'O que não veio no pedido foi mantido da versão anterior. Autorização de depoimento e rosto não é marcada pelo agente.',
        resultado_da_mesa: dados,
      },
    };
  });
}

export async function adsOfertaSalvar(
  input: { client_id: string; oferta_id: string; campos?: Record<string, unknown>; status?: 'rascunho' | 'escolhida' | 'arquivada'; idempotency_key: string },
  ctx: AuthContext,
) {
  await conferirCliente(input.client_id, ctx);
  return await umaVez('aceleriq_mesa_ads_oferta_salvar', ctx, input.idempotency_key, async () => {
    const { idempotency_key: _k, ...corpo } = input;
    const dados = await chamarMesa('mesa-ads', 'oferta_salvar', corpo as Record<string, unknown>, ctx);
    return {
      ref: `ads_oferta:${input.oferta_id}`,
      resultado: {
        oferta_id: input.oferta_id,
        observacao: input.campos ? 'Mudar o conteúdo apaga a nota do Jev da oferta (ficou velha): peça nova avaliação na Mesa Ads antes de subir.' : null,
        resultado_da_mesa: dados,
      },
    };
  });
}

export async function adsOfertaDoContexto(
  input: { client_id: string; forcar?: boolean; idempotency_key: string },
  ctx: AuthContext,
) {
  await conferirCliente(input.client_id, ctx);
  return await umaVez('aceleriq_mesa_ads_oferta_do_contexto', ctx, input.idempotency_key, async () => {
    const dados = await chamarMesa('mesa-ads', 'oferta_do_contexto', { client_id: input.client_id, gravar: true, forcar: input.forcar === true }, ctx);
    const oferta = idDe(dados.oferta);
    return {
      ref: oferta ? `ads_oferta:${oferta}` : null,
      resultado: { oferta_id: oferta, criada: dados.criada ?? null, resultado_da_mesa: dados },
    };
  });
}

// ─── Aprovação (Estúdio + RPC da entrega) ────────────────────

export async function enviarParaAprovacao(
  input: { trabalho_ids: string[]; idempotency_key: string },
  ctx: AuthContext,
) {
  const ids = [...new Set(input.trabalho_ids)];
  const { data, error } = await db().from('estudio_trabalhos').select('id, client_id, status, tipo, file_ids').in('id', ids);
  if (error) throw falha('leitura', `estudio_trabalhos: ${error.message}`);
  const linhas = (data ?? []) as Array<{ id: string; client_id: string; status: string; tipo?: string | null; file_ids?: string[] | null }>;
  const faltando = ids.filter((id) => !linhas.some((l) => l.id === id));
  if (faltando.length) throw falha('nao_encontrado', `Trabalho(s) do Estúdio não encontrado(s): ${faltando.join(', ')}.`);
  for (const l of linhas) await conferirCliente(l.client_id, ctx);
  const deAnuncio = linhas.filter((l) => l.tipo === 'ads').map((l) => l.id);
  if (deAnuncio.length) {
    throw falha('criativo_de_anuncio', `Criativo de anúncio não passa pela aprovação de post (${deAnuncio.join(', ')}): ele segue pela Mesa Ads para o gestor de tráfego.`);
  }

  return await umaVez('aceleriq_mesa_enviar_para_aprovacao', ctx, input.idempotency_key, async () => {
    // 1) Entrega em Arquivos o que ainda não foi entregue (a própria mesa é idempotente por lâmina).
    const entregas: Array<{ trabalho_id: string; ja_entregue: boolean; root_file_id: unknown }> = [];
    for (const l of linhas) {
      if (l.status === 'entregue' && (l.file_ids ?? []).length) {
        entregas.push({ trabalho_id: l.id, ja_entregue: true, root_file_id: (l.file_ids ?? [])[0] ?? null });
        continue;
      }
      const dados = await chamarMesa('estudio-arte', 'entregar', { trabalho_id: l.id }, ctx);
      entregas.push({ trabalho_id: l.id, ja_entregue: dados.ja_entregue === true, root_file_id: dados.root_file_id ?? null });
    }
    // 2) Libera para aprovação pelo mesmo caminho da tela (admin e gestor liberam ao cliente; design pede revisão da agência).
    const envio = await rpcComoPessoa('mesa_enviar_para_aprovacao', { _trabalho_ids: ids }, ctx);
    const resultados = ((envio as { resultados?: unknown[] } | null)?.resultados ?? []) as unknown[];
    return {
      ref: `aprovacao:${ids.join(',')}`.slice(0, 300),
      resultado: {
        entregas,
        resultados_do_envio: resultados,
        observacao: 'Cada peça segue a regra da tela: com papel de admin ou gestor vai direto ao cliente; com papel de design pede primeiro a revisão da agência. Nada foi agendado nem publicado por aqui.',
      },
    };
  });
}
