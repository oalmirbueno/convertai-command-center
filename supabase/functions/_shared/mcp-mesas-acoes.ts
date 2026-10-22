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
import { auditLog } from './mcp-audit.ts';
import { assertClientAccess, type AuthContext } from './mcp-auth.ts';
import { exigirClienteExistente } from './mcp-client-id-guard.ts';
import { getMcpRuntimeConfig } from './mcp-runtime.ts';
import { findIdempotentResult } from './mcp-write-services.ts';
import {
  acaoPermitida,
  AVISO_ACAO_SO_COM_PESSOA,
  feitoPor,
  juntarBriefingDeAds,
  laminasDoTrabalho,
  lerRespostaDaMesa,
  prazoDaAcao,
  type FuncaoDaMesa,
  type RpcDaPonte,
} from './mcp-mesas-ponte.ts';

const TETO_DA_RESPOSTA = 5 * 1024 * 1024;

function falha(codigo: string, mensagem: string): Error {
  return new Error(`mesa:${codigo} ${mensagem}`);
}

/**
 * 19/10/2026, autorizado pelo dono por escrito ("ligue para tudo funcionar e
 * não ficar travado"). A conexão OAuth do Paperclip foi trocada por uma de chave
 * em 17/10 e, desde então, toda ação nas mesas voltava "exige OAuth". Agora a
 * chave age nas mesas com a sessão de quem a criou, desde que essa pessoa seja
 * admin ou gestor da equipe: a mesa confere acesso e grava "criado por" como se
 * ela clicasse. Chave sem dono, ou de dono fora da equipe, continua só lendo.
 */
const PAPEIS_QUE_EMPRESTAM_A_SESSAO = ['admin', 'manager'];
const sessoesDosDonos = new Map<string, { token: string; validoAte: number }>();

async function sessaoDoDonoDaChave(userId: string): Promise<string> {
  const guardada = sessoesDosDonos.get(userId);
  if (guardada && guardada.validoAte > Date.now() + 5 * 60_000) return guardada.token;
  try {
    const papeis = await db().from('user_roles').select('role').eq('user_id', userId);
    if (papeis.error) throw falha('dono_da_chave', 'Não foi possível conferir o dono da chave agora. Tente de novo.');
    const roles = ((papeis.data ?? []) as Array<{ role: string }>).map((r) => String(r.role));
    if (!roles.some((r) => PAPEIS_QUE_EMPRESTAM_A_SESSAO.includes(r))) {
      throw falha('dono_da_chave', 'O dono desta chave não é admin nem gestor da equipe: ela lê as mesas, mas não age nelas.');
    }
    const usuario = await db().auth.admin.getUserById(userId);
    const email = usuario.data?.user?.email;
    if (usuario.error || !email) throw falha('dono_da_chave', 'O dono desta chave não tem e-mail para abrir a sessão.');
    const link = await db().auth.admin.generateLink({ type: 'magiclink', email });
    const hash = link.data?.properties?.hashed_token;
    if (link.error || !hash) throw falha('dono_da_chave', 'Não foi possível abrir a sessão do dono da chave agora. Tente de novo.');
    const { url, anon } = enderecoDoProjeto();
    const publico = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const sessao = await publico.auth.verifyOtp({ token_hash: hash, type: 'magiclink' });
    const token = sessao.data?.session?.access_token;
    if (sessao.error || !token) throw falha('dono_da_chave', 'Não foi possível abrir a sessão do dono da chave agora. Tente de novo.');
    const expira = Number(sessao.data?.session?.expires_at ?? 0) * 1000;
    sessoesDosDonos.set(userId, { token, validoAte: expira > Date.now() ? expira : Date.now() + 50 * 60_000 });
    return token;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('mesa:')) throw e;
    throw falha('dono_da_chave', 'Não foi possível abrir a sessão do dono da chave agora. Tente de novo.');
  }
}

async function tokenDaPessoa(ctx: AuthContext): Promise<string> {
  if (ctx.dataScope?.source === 'api_key' && ctx.dataScope.principalUserId) {
    return await sessaoDoDonoDaChave(ctx.dataScope.principalUserId);
  }
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

export async function conferirCliente(clientId: string, ctx: AuthContext) {
  if (!isUuid(clientId)) throw new Error('client_id must be a UUID');
  assertClientAccess(ctx, clientId);
  await exigirClienteExistente(db(), clientId);
}

/** Cliente dono de uma linha (campanha, proposta, trabalho): para conferir a fronteira antes de sair. */
export async function clienteDaLinha(tabela: string, id: string, rotulo: string): Promise<string> {
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
  const token = await tokenDaPessoa(ctx);
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
  const token = await tokenDaPessoa(ctx);
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
export async function umaVez(
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

// ─── Mesa Ads até o gestor (MCP 2.12) ────────────────────────
// O caminho da tela: plano de teste, criativos (copy e direção da arte), a
// arte pela fila do Estúdio e o pacote do gestor com a tarefa dele. Nada sobe
// na Meta por aqui: subir é do gestor, com o ok do dono.

type TrabalhoDoEstudio = { id: string; client_id: string; tipo: string | null; status: string | null; direcao: unknown; cards: unknown };
type FeitoNaMesa = { ref: string | null; resultado: Record<string, unknown> };

/**
 * O Paperclip 2026.1012 corta a ferramenta em 10 s (teto de 60 s, fixo no
 * gateway dele), e o plano, a produção e a entrega levam de um a vários
 * minutos. A mesa termina do mesmo jeito, mas o agente ficava sem saber.
 * Então a ação longa espera um pouco; se não terminou, responde "em
 * andamento" e segue em segundo plano (EdgeRuntime.waitUntil). O fim, com o
 * resultado ou o erro, fica na trilha do MCP como `<ferramenta>:concluida` e
 * aparece em aceleriq_mesa_ads_contexto (andamento).
 *
 * 3 s e não mais: a entrega da Stop (16/10) levou 7,8 s no handler com 6 s de
 * espera, e com a entrada do MCP e o gateway passou dos 10 s do Paperclip.
 */
export const ESPERA_ANTES_DE_SEGUIR_MS = 3_000;

export async function esperarOuSeguir(
  ferramenta: string,
  ctx: AuthContext,
  clientId: string,
  idempotencyKey: string,
  trabalho: Promise<FeitoNaMesa>,
  esperaMs = ESPERA_ANTES_DE_SEGUIR_MS,
): Promise<FeitoNaMesa> {
  const inicio = Date.now();
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const corrida = await Promise.race([
    trabalho.then((r) => ({ fim: true as const, r }), (e: unknown) => ({ fim: true as const, e })),
    new Promise<{ fim: false }>((ok) => { relogio = setTimeout(() => ok({ fim: false }), esperaMs); }),
  ]);
  clearTimeout(relogio);
  if (corrida.fim) {
    if ('e' in corrida) throw corrida.e;
    return corrida.r;
  }
  const registrar = trabalho
    .then(
      (r) => ({ ok: true, ref: r.ref, erro: null as string | null }),
      (e: unknown) => ({ ok: false, ref: null, erro: e instanceof Error ? e.message : String(e) }),
    )
    .then((f) => auditLog({
      correlationId: crypto.randomUUID(),
      toolName: `${ferramenta}:concluida`,
      origin: ctx.origin,
      keyId: ctx.keyId,
      scopes: ctx.scopes ?? null,
      input: { client_id: clientId, idempotency_key: idempotencyKey, pedido: ctx.correlationId ?? null },
      success: f.ok,
      statusCode: f.ok ? 200 : 500,
      durationMs: Date.now() - inicio,
      errorCode: f.ok ? null : (f.erro?.match(/^mesa:([a-z_]+)/)?.[1] ?? 'falhou'),
      errorMessage: f.erro,
      resultRef: f.ref,
    }));
  const er = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (er && typeof er.waitUntil === 'function') er.waitUntil(registrar.catch(() => null));
  return {
    ref: `em_andamento:${ferramenta}`,
    resultado: {
      em_andamento: true,
      client_id: clientId,
      aviso: 'A mesa ainda está trabalhando (leva alguns minutos) e termina sozinha. NÃO repita a chamada: ela gastaria de novo.',
      como_acompanhar: 'Em 1 a 3 minutos leia aceleriq_mesa_ads_contexto deste cliente: o campo andamento diz se terminou ou o erro, e planos e criativos trazem o que foi feito.',
    },
  };
}

export async function adsPlanoGerar(
  input: { client_id: string; pedido?: string; quantidade_angulos?: number; oferta_id?: string; objetivo?: string; tom?: string; idempotency_key: string },
  ctx: AuthContext,
) {
  await conferirCliente(input.client_id, ctx);
  return await umaVez('aceleriq_mesa_ads_plano_gerar', ctx, input.idempotency_key, () => esperarOuSeguir('aceleriq_mesa_ads_plano_gerar', ctx, input.client_id, input.idempotency_key, (async () => {
    const { idempotency_key: _k, ...corpo } = input;
    const dados = await chamarMesa('mesa-ads', 'plano_gerar', corpo as Record<string, unknown>, ctx);
    const plano = (dados.plano ?? {}) as Record<string, unknown>;
    const planoId = typeof plano.id === 'string' ? plano.id : null;
    const angulos = (Array.isArray(plano.angulos) ? plano.angulos : []) as Record<string, unknown>[];
    return {
      ref: planoId ? `ads_plano:${planoId}` : null,
      resultado: {
        plano_id: planoId,
        angulos: angulos.map((a) => ({ id: a.id ?? null, nome: a.nome ?? null, formatos: a.formatos ?? [], variacoes: a.variacoes ?? null, estilo_visual: a.estilo_visual ?? null })),
        custo_usd: dados.custo_usd ?? null,
        proximo_passo: planoId
          ? `Produza os criativos de um ângulo por vez com aceleriq_mesa_ads_criativos_produzir (plano_id ${planoId}, angulo_id de angulos[].id).`
          : 'A mesa não devolveu plano: leia resultado_da_mesa.',
        resultado_da_mesa: dados,
      },
    };
  })()));
}

export async function adsCriativosProduzir(
  input: { plano_id: string; angulo_id: string; formatos?: string[]; tom?: string; pedido?: string; idempotency_key: string },
  ctx: AuthContext,
) {
  const clientId = await clienteDaLinha('ads_planos', input.plano_id, 'plano_id');
  await conferirCliente(clientId, ctx);
  return await umaVez('aceleriq_mesa_ads_criativos_produzir', ctx, input.idempotency_key, () => esperarOuSeguir('aceleriq_mesa_ads_criativos_produzir', ctx, clientId, input.idempotency_key, (async () => {
    const dados = await chamarMesa('mesa-ads', 'criativos_produzir', {
      plano_id: input.plano_id,
      angulo_ids: [input.angulo_id],
      ...(input.formatos?.length ? { formatos: input.formatos } : {}),
      ...(input.tom ? { tom: input.tom } : {}),
      ...(input.pedido ? { pedido: input.pedido } : {}),
    }, ctx);
    const criativos = (Array.isArray(dados.criativos) ? dados.criativos : []) as Record<string, unknown>[];
    const trabalhoIds = (Array.isArray(dados.trabalho_ids) ? dados.trabalho_ids : []) as string[];
    return {
      ref: `ads_plano:${input.plano_id}:${input.angulo_id}`,
      resultado: {
        client_id: clientId,
        criativos: criativos.map((c) => ({ id: c.id ?? null, nome: c.nome ?? null, formato: c.formato ?? null, trabalho_id: c.trabalho_id ?? null })),
        trabalho_ids: trabalhoIds,
        custo_usd: dados.custo_usd ?? null,
        proximo_passo: trabalhoIds.length
          ? 'Gere a arte de cada trabalho com aceleriq_mesa_ads_arte_gerar (trabalho_id). A arte sai pela fila do Estúdio; acompanhe por aceleriq_mesa_ads_contexto (criativos[].arte).'
          : 'A mesa não devolveu trabalhos de arte: leia resultado_da_mesa.',
        resultado_da_mesa: dados,
      },
    };
  })()));
}

async function trabalhosDoEstudio(ids: string[]): Promise<TrabalhoDoEstudio[]> {
  if (!ids.length) return [];
  const { data, error } = await db().from('estudio_trabalhos').select('id, client_id, tipo, status, direcao, cards').in('id', ids);
  if (error) throw falha('leitura', `estudio_trabalhos: ${error.message}`);
  return (data ?? []) as TrabalhoDoEstudio[];
}

export async function adsArteGerar(
  input: { trabalho_id: string; ordens?: number[]; corrigir_sozinho?: boolean; idempotency_key: string },
  ctx: AuthContext,
) {
  if (!isUuid(input.trabalho_id)) throw new Error('trabalho_id must be a UUID');
  const [t] = await trabalhosDoEstudio([input.trabalho_id]);
  if (!t) throw falha('nao_encontrado', 'trabalho_id não existe.');
  await conferirCliente(t.client_id, ctx);
  if (t.tipo !== 'ads') {
    throw falha('nao_e_anuncio', 'Este trabalho do Estúdio não é criativo de anúncio. Arte de post segue pela Mesa do cliente.');
  }
  const laminas = laminasDoTrabalho(t);
  // Sem ordens: só o que falta gerar (refazer custa; para refazer, mande as ordens).
  const ordens = input.ordens?.length ? input.ordens.filter((o) => laminas.ordens.includes(o)) : laminas.sem_arte;
  if (!ordens.length) {
    return {
      ok: true,
      trabalho_id: t.id,
      nada_a_gerar: true,
      laminas,
      aviso: input.ordens?.length
        ? 'Nenhuma das ordens pedidas existe na direção deste trabalho.'
        : 'Todas as lâminas já têm arte. Para refazer, mande as ordens.',
      feito_por: feitoPor(ctx),
    };
  }
  return await umaVez('aceleriq_mesa_ads_arte_gerar', ctx, input.idempotency_key, async () => {
    const dados = await chamarMesa('estudio-arte', 'enfileirar', {
      trabalho_id: t.id,
      ordens,
      corrigir_sozinho: input.corrigir_sozinho !== false,
    }, ctx);
    const lote = typeof dados.lote_id === 'string' ? dados.lote_id : null;
    return {
      ref: lote ? `estudio_fila:${lote}` : `estudio_trabalho:${t.id}`,
      resultado: {
        trabalho_id: t.id,
        client_id: t.client_id,
        ordens_na_fila: ordens,
        lote_id: lote,
        ja_na_fila: dados.ja_na_fila ?? [],
        observacao: 'A arte é gerada, conferida e corrigida na fila do servidor (a mesma da tela). Leva alguns minutos por lâmina; acompanhe por aceleriq_mesa_ads_contexto (criativos[].arte). Quando todas tiverem arte, entregue com aceleriq_mesa_ads_entregar_ao_gestor.',
        resultado_da_mesa: dados,
      },
    };
  });
}

export async function adsEntregarAoGestor(
  input: { client_id: string; plano_id?: string; criativo_ids?: string[]; idempotency_key: string },
  ctx: AuthContext,
) {
  await conferirCliente(input.client_id, ctx);
  // Os mesmos criativos que o pacote vai juntar (mesmo filtro da mesa).
  let q = db().from('ads_criativos').select('id, nome, plano_id, trabalho_id').eq('client_id', input.client_id);
  if (input.plano_id) q = q.eq('plano_id', input.plano_id);
  if (input.criativo_ids?.length) q = q.in('id', input.criativo_ids);
  const { data, error } = await q.order('criado_em').limit(200);
  if (error) throw falha('leitura', `ads_criativos: ${error.message}`);
  const criativos = (data ?? []) as Array<{ id: string; nome: string | null; plano_id: string | null; trabalho_id: string | null }>;
  if (!criativos.length) throw falha('nao_encontrado', 'Nenhum criativo deste cliente com esse plano ou esses ids.');

  const trabalhos = new Map((await trabalhosDoEstudio([...new Set(criativos.map((c) => c.trabalho_id).filter((x): x is string => !!x))])).map((t) => [t.id, t]));
  const semArte = criativos.flatMap((c) => {
    const t = c.trabalho_id ? trabalhos.get(c.trabalho_id) : undefined;
    if (!t) return [{ criativo_id: c.id, nome: c.nome, motivo: 'sem trabalho de arte no Estúdio' }];
    const faltam = laminasDoTrabalho(t).sem_arte;
    return faltam.length ? [{ criativo_id: c.id, nome: c.nome, motivo: `lâminas sem arte: ${faltam.join(', ')}` }] : [];
  });
  if (semArte.length) {
    throw falha('criativos_sem_arte', `Gere a arte antes de entregar ao gestor (aceleriq_mesa_ads_arte_gerar), ou mande só os criativo_ids prontos. Faltando: ${JSON.stringify(semArte).slice(0, 1500)}`);
  }

  return await umaVez('aceleriq_mesa_ads_entregar_ao_gestor', ctx, input.idempotency_key, () => esperarOuSeguir('aceleriq_mesa_ads_entregar_ao_gestor', ctx, input.client_id, input.idempotency_key, (async () => {
    // 1) A arte vai para Arquivos > Criativos de anúncio (a mesa é idempotente por trabalho).
    const entregas: Array<{ trabalho_id: string; ja_entregue: boolean }> = [];
    for (const t of trabalhos.values()) {
      const dados = await chamarMesa('estudio-arte', 'entregar', { trabalho_id: t.id }, ctx);
      entregas.push({ trabalho_id: t.id, ja_entregue: dados.ja_entregue === true });
    }
    // 2) O pacote do gestor em Arquivos e a tarefa dele no Kanban.
    const pacote = await chamarMesa('mesa-ads', 'pacote_enviar', {
      client_id: input.client_id,
      ...(input.plano_id ? { plano_id: input.plano_id } : {}),
      ...(input.criativo_ids?.length ? { criativo_ids: input.criativo_ids } : {}),
      criar_tarefa: true,
    }, ctx);
    const { markdown: _md, ...semTexto } = pacote;
    return {
      ref: typeof pacote.file_id === 'string' ? `file:${pacote.file_id}` : null,
      resultado: {
        client_id: input.client_id,
        criativos: criativos.length,
        entregas,
        pacote_file_id: pacote.file_id ?? null,
        tarefa_do_gestor_id: pacote.tarefa_id ?? null,
        observacao: 'As artes estão em Arquivos > Criativos de anúncio e o gestor de tráfego tem a tarefa com o pacote. Nada subiu na Meta: subir é do gestor, com o ok do dono.',
        resultado_da_mesa: semTexto,
      },
    };
  })()));
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
