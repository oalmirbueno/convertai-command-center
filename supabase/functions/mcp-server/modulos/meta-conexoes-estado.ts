/**
 * MCP 2.39.0 (25/11/2026): aceleriq_meta_conexoes_estado — inventário orgânico da Meta, só leitura.
 *
 * Para cada cliente ativo (user_roles role=client, profiles.plan_status=active, sem deleted_at), TODAS as
 * contas ativas de Instagram e Facebook do painel (inclusive registro manual por @/página sem id da Meta e
 * duplicatas, sem corte), a origem da concessão, a menor expiração entre token e acesso aos dados (painel
 * e, quando houver, debug_token) e o estado: ok | venceu | caiu | sem_conexao | nao_verificado.
 *
 * Regras que esta ferramenta não negocia:
 *   - Só credencial admin explícita (escopo literal "admin") e dataScope.unrestricted, conferidos ANTES de
 *     qualquer I/O. Chave restrita a cliente, legado ou escopo agregado não passa.
 *   - Teste ao vivo só com a credencial EXATA da conta (RPC meta_conexao_token_da_conta: conta, concessão
 *     vista, ficha do cliente, plataforma e recurso esperados). Nunca outra conta, agência ou Ads.
 *   - Graph: host fixo https://graph.facebook.com, redirect:error, cache no-store, Bearer com o token do
 *     app + appsecret_proof (HMAC, como meta-usuario-do-sistema), input_token só no parâmetro oficial,
 *     prazo por chamada, concorrência limitada e prazo total menor que o do despachante.
 *   - A saída projeta só estado, motivo, validade, prazos e códigos numéricos: nunca token, segredo, URL,
 *     tipo, escopos ou mensagem da Meta. Resposta incoerente = nao_verificado.
 *   - Graph ok é diagnóstico do token, não permissão para publicar.
 */

import type { ToolDefinition } from '../../_shared/mcp-tools.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { db } from '../../_shared/aceleriq-read-services.ts';
import { ErroDaFerramenta } from './robustez.ts';

// ─── Tipos ──────────────────────────────────────────────────────

export type EstadoDaConexao = 'ok' | 'venceu' | 'caiu' | 'sem_conexao' | 'nao_verificado';
export type Plataforma = 'instagram' | 'facebook';
export const PLATAFORMAS: readonly Plataforma[] = ['instagram', 'facebook'];

export interface ClienteAtivo {
  id: string;
  nome: string | null;
}

/** Página da varredura de clientes. `fim=false` = parou antes do fim; continuar de `varridoAte`. */
export interface VarreduraDeClientes {
  clientes: ClienteAtivo[];
  fim: boolean;
  varridoAte: string | null;
}

/** Linha de meta_usuario_do_sistema_contas() (sem token). */
export interface ContaMeta {
  external_account_id: string;
  client_id: string;
  platform: string;
  external_id: string | null;
  handle: string | null;
  display_name: string | null;
  connection_status: string | null;
  expires_at: string | null;
  data_access_expires_at: string | null;
  concessao: {
    id?: string | null;
    origem?: string | null;
    status?: string | null;
    access_token_expires_at?: string | null;
    data_access_expires_at?: string | null;
  } | null;
}

export interface PedidoDeToken {
  externalAccountId: string;
  grantId: string;
  clientId: string;
  platform: Plataforma;
  providerResourceId: string;
}

export type TokenDaConta =
  | { tipo: 'token'; token: string }
  | { tipo: 'nao_localizado' }
  | { tipo: 'rpc_ausente' }
  | { tipo: 'falha' };

export interface PortaMetaConexoes {
  /** Clientes ativos em ordem de id, depois do cursor (ou só um), até `limite` linhas. */
  clientesAtivos(f: { clientId: string | null; depoisDe: string | null; limite: number; signal: AbortSignal }): Promise<VarreduraDeClientes>;
  /** Contas FB/IG ativas desses clientes. null = RPC de metadados ausente. */
  contas(clientIds: string[], signal: AbortSignal): Promise<ContaMeta[] | null>;
  /** Token exato da conta (nunca sai deste módulo). */
  tokenDaConta(pedido: PedidoDeToken, signal: AbortSignal): Promise<TokenDaConta>;
}

export interface ConfigDaMeta {
  appId: string;
  appSecret: string;
  graphVersion: string;
}

export type BuscarFn = (url: string, init: RequestInit) => Promise<Response>;

/** Projeção do debug_token. Só isto sai. */
export interface ResultadoDoGraph {
  estado: EstadoDaConexao;
  motivo: string;
  transitorio: boolean;
  valido?: boolean;
  expira_em?: string | null;
  acesso_aos_dados_expira_em?: string | null;
  codigo_da_meta?: number | null;
  subcodigo_da_meta?: number | null;
}

// ─── Constantes ─────────────────────────────────────────────────

export const GRAPH_HOST = 'https://graph.facebook.com';
export const LIMITE_PADRAO = 5;
export const LIMITE_MAXIMO = 10;
export const MAX_VERIFICACOES = 40;
export const CONCORRENCIA = 3;
export const PRAZO_GRAPH_MS = 8_000;
/** Menor que o prazoMs da ferramenta (45 s) para sobrar tempo de montar a resposta parcial. */
export const PRAZO_TOTAL_MS = 30_000;
const PRAZO_DA_FERRAMENTA_MS = 45_000;
const MAX_RESPOSTA = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTRADAS = new Set(['client_id', 'cursor', 'limite', 'verificar_ao_vivo']);
/** Subcódigo de 190 que significa prazo vencido. */
const SUBCODIGOS_DE_VENCIMENTO = new Set([463]);
/** Erros da Graph que não dizem nada do token: limite, temporário, serviço. */
const CODIGOS_TRANSITORIOS = new Set([1, 2, 4, 17, 32, 341, 368, 613]);
const HOSTS_DO_INSTAGRAM = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com']);

export const CAMINHO_OFICIAL = '/config/meta-usuario-do-sistema';

export function urlDoPainel(origem: string | null | undefined): string {
  const bruta = (origem ?? '').trim();
  let base = 'https://aceleriq.online';
  if (bruta) {
    try {
      const u = new URL(bruta);
      if (u.protocol === 'https:' && !u.username && !u.password) base = u.origin;
    } catch { /* fica a canônica */ }
  }
  return `${base}${CAMINHO_OFICIAL}`;
}

// ─── Acesso e entrada ───────────────────────────────────────────

/** Admin explícito + irrestrito. Roda antes de qualquer I/O. */
export function exigirAdminIrrestrito(ctx: AuthContext | null | undefined): void {
  const escopos = Array.isArray(ctx?.scopes) ? ctx!.scopes : [];
  if (!escopos.includes('admin') || ctx?.dataScope?.unrestricted !== true) {
    throw new ErroDaFerramenta(
      'acesso_negado',
      'Só a credencial admin da casa, sem restrição de cliente, lê o inventário das conexões da Meta.',
      'Peça ao dono uma credencial admin; chave restrita a cliente não alcança esta leitura.',
    );
  }
}

export interface EntradaValida {
  clientId: string | null;
  cursor: string | null;
  limite: number;
  verificarAoVivo: boolean;
}

export function validarEntrada(input: unknown): EntradaValida {
  const erro = (m: string) => new ErroDaFerramenta('entrada_invalida', m);
  if (input != null && (typeof input !== 'object' || Array.isArray(input))) throw erro('Entrada deve ser um objeto.');
  const e = (input ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(e)) if (!ENTRADAS.has(k)) throw erro(`Campo desconhecido: ${k}.`);
  const uuid = (v: unknown, campo: string) => {
    if (v == null) return null;
    if (typeof v !== 'string' || !UUID.test(v)) throw erro(`${campo} deve ser um UUID.`);
    return v.toLowerCase();
  };
  const clientId = uuid(e.client_id, 'client_id');
  const cursor = uuid(e.cursor, 'cursor');
  if (clientId && cursor) throw erro('Use client_id ou cursor, não os dois.');
  let limite = LIMITE_PADRAO;
  if (e.limite != null) {
    // Número em texto passa, como no validador leve do despachante (robustez.ts).
    const n = typeof e.limite === 'string' && /^\d{1,3}$/.test(e.limite.trim()) ? Number(e.limite.trim()) : e.limite;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > LIMITE_MAXIMO) {
      throw erro(`limite deve ser inteiro de 1 a ${LIMITE_MAXIMO}.`);
    }
    limite = n;
  }
  if (e.verificar_ao_vivo != null && typeof e.verificar_ao_vivo !== 'boolean') throw erro('verificar_ao_vivo deve ser booleano.');
  return { clientId, cursor, limite, verificarAoVivo: e.verificar_ao_vivo !== false };
}

// ─── Regras puras ───────────────────────────────────────────────

/** Prazo Unix (s) da Meta. Ausente/0 = sem prazo; outro formato = malformado. */
export function lerPrazo(v: unknown): { ok: true; iso: string | null } | { ok: false } {
  if (v === undefined || v === null) return { ok: true, iso: null };
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,12}$/.test(v) ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < 0) return { ok: false };
  if (n === 0) return { ok: true, iso: null };
  const d = new Date(n * 1000);
  return Number.isNaN(d.getTime()) ? { ok: false } : { ok: true, iso: d.toISOString() };
}

export function menorPrazo(...prazos: Array<string | null | undefined>): string | null {
  const ms = prazos.map((p) => (p ? Date.parse(p) : NaN)).filter((n) => Number.isFinite(n));
  return ms.length ? new Date(Math.min(...ms)).toISOString() : null;
}

const idNumerico = (v: unknown): string | null => {
  const s = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
  return /^\d{1,64}$/.test(s) ? s : null;
};

const inteiro = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);

const texto = (v: unknown, max = 80): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};

/**
 * @ do Instagram: aceita "@perfil", "perfil" ou URL do próprio instagram.com. URL de outro domínio,
 * esquema estranho ou nome fora do padrão volta null (não inventa @).
 */
export function handleDoInstagram(v: unknown): string | null {
  const s = texto(v, 300);
  if (!s) return null;
  let nome = s;
  if (s.includes('/') || /^[a-z][a-z0-9+.-]*:/i.test(s)) {
    let u: URL;
    try { u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/+/, '')}`); } catch { return null; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password || u.port || !HOSTS_DO_INSTAGRAM.has(u.hostname.toLowerCase())) return null;
    const partes = u.pathname.split('/').filter(Boolean);
    if (partes.length !== 1) return null;
    nome = partes[0];
  }
  nome = nome.replace(/^@/, '');
  return /^[A-Za-z0-9._]{1,30}$/.test(nome) ? `@${nome}` : null;
}

/** Vínculo estrito ao cliente e à plataforma orgânica. Sem id da Meta continua (registro manual). */
export function contaCasaComCliente(conta: ContaMeta, clientId: string): boolean {
  return conta.client_id === clientId && (conta.platform === 'instagram' || conta.platform === 'facebook');
}

/**
 * Estado pelo banco, antes da Graph. null = depende do teste ao vivo.
 * (Status gravado pela tela ou pelo cron vale como está; a Graph não ressuscita concessão revogada.)
 */
export function estadoPeloBanco(conta: ContaMeta, agora: Date): { estado: EstadoDaConexao; motivo: string } | null {
  if (!idNumerico(conta.external_id)) return { estado: 'sem_conexao', motivo: 'registro_manual_sem_id_da_meta' };
  const c = conta.concessao;
  if (!c) return { estado: 'sem_conexao', motivo: 'sem_concessao' };
  const grant = (c.status ?? 'active').toLowerCase();
  const conexao = (conta.connection_status ?? '').toLowerCase();
  if (grant === 'expired' || conexao === 'expired') return { estado: 'venceu', motivo: 'status_vencido_no_painel' };
  if (grant !== 'active') return { estado: 'caiu', motivo: `concessao_${grant.replace(/[^a-z_]/g, '').slice(0, 20)}` };
  if (conexao === 'revoked' || conexao === 'reauth_required') return { estado: 'caiu', motivo: `conexao_${conexao}` };
  const prazo = menorPrazo(c.access_token_expires_at, c.data_access_expires_at, conta.expires_at, conta.data_access_expires_at);
  if (prazo && Date.parse(prazo) <= agora.getTime()) return { estado: 'venceu', motivo: 'prazo_vencido_no_painel' };
  return null;
}

/** Classifica o debug_token. Projeta só estado, motivo, validade, prazos e códigos numéricos. */
export function classificarDebugToken(
  http: { status: number; corpo: unknown },
  cfg: { appId: string },
  conta: { platform: string; external_id: string | null },
  agora: Date,
): ResultadoDoGraph {
  const reg = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
  const corpo = reg(http.corpo);
  if (http.status < 200 || http.status >= 300 || !corpo) {
    // Erro HTTP fala da requisição/credencial do app; sem prova sobre o token da conta.
    const codigo = inteiro(reg(corpo?.error)?.code);
    const transitorio = http.status >= 500 || http.status === 429 || (codigo !== null && CODIGOS_TRANSITORIOS.has(codigo));
    return { estado: 'nao_verificado', motivo: transitorio ? 'meta_indisponivel' : 'consulta_nao_aceita', transitorio, codigo_da_meta: codigo };
  }
  const d = reg(corpo.data);
  if (!d || typeof d.is_valid !== 'boolean') return { estado: 'nao_verificado', motivo: 'resposta_inconsistente', transitorio: false };
  const expira = lerPrazo(d.expires_at);
  const acesso = lerPrazo(d.data_access_expires_at);
  if (!expira.ok || !acesso.ok) return { estado: 'nao_verificado', motivo: 'prazo_malformado', transitorio: false, valido: d.is_valid };
  const err = reg(d.error);
  const base = {
    valido: d.is_valid,
    expira_em: expira.iso,
    acesso_aos_dados_expira_em: acesso.iso,
    codigo_da_meta: inteiro(err?.code),
    subcodigo_da_meta: inteiro(err?.subcode),
  };
  const prazo = menorPrazo(expira.iso, acesso.iso);
  const vencido = !!prazo && Date.parse(prazo) <= agora.getTime();

  if (d.is_valid === false) {
    if (base.codigo_da_meta !== null && CODIGOS_TRANSITORIOS.has(base.codigo_da_meta)) {
      return { ...base, estado: 'nao_verificado', motivo: 'meta_indisponivel', transitorio: true };
    }
    if (vencido || (base.subcodigo_da_meta !== null && SUBCODIGOS_DE_VENCIMENTO.has(base.subcodigo_da_meta))) {
      return { ...base, estado: 'venceu', motivo: 'token_vencido', transitorio: false };
    }
    return { ...base, estado: 'caiu', motivo: 'token_invalido_ou_revogado', transitorio: false };
  }
  const appId = idNumerico(d.app_id);
  if (!appId || err) return { ...base, estado: 'nao_verificado', motivo: 'resposta_inconsistente', transitorio: false };
  if (appId !== cfg.appId) return { ...base, estado: 'nao_verificado', motivo: 'token_de_outro_app', transitorio: false };
  if (vencido) return { ...base, estado: 'venceu', motivo: 'token_vencido', transitorio: false };
  // Token de página traz profile_id = página: só confere no Facebook (no Instagram o id é da conta IG).
  const perfil = idNumerico(d.profile_id);
  if (conta.platform === 'facebook' && perfil && perfil !== idNumerico(conta.external_id)) {
    return { ...base, estado: 'caiu', motivo: 'credencial_nao_corresponde', transitorio: false };
  }
  return { ...base, estado: 'ok', motivo: 'token_valido', transitorio: false };
}

// ─── Graph ──────────────────────────────────────────────────────

export function configDaMeta(env: (k: string) => string | undefined): ConfigDaMeta | null {
  const appId = (env('META_APP_ID') ?? '').trim();
  const appSecret = (env('META_APP_SECRET') ?? '').trim();
  const graphVersion = (env('META_GRAPH_VERSION') ?? 'v26.0').trim();
  if (!/^\d{1,64}$/.test(appId) || !appSecret || !/^v\d+\.\d+$/.test(graphVersion)) return null;
  return { appId, appSecret, graphVersion };
}

/** HMAC-SHA256(token, segredo) em hex: o appsecret_proof da Meta (igual a meta-usuario-do-sistema). */
export async function provaDoSegredo(token: string, segredo: string): Promise<string> {
  const enc = new TextEncoder();
  const chave = await crypto.subtle.importKey('raw', enc.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const assinatura = await crypto.subtle.sign('HMAC', chave, enc.encode(token));
  return Array.from(new Uint8Array(assinatura)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Um debug_token. Nunca lança; nunca devolve corpo, URL nem token. Respeita o prazo total. */
export async function debugToken(
  cfg: ConfigDaMeta,
  token: string,
  conta: { platform: string; external_id: string | null },
  buscar: BuscarFn,
  agora: Date,
  prazoMs = PRAZO_GRAPH_MS,
  total?: AbortSignal,
): Promise<ResultadoDoGraph> {
  if (total?.aborted) return { estado: 'nao_verificado', motivo: 'sem_tempo', transitorio: true };
  const appToken = `${cfg.appId}|${cfg.appSecret}`;
  const url = new URL(`/${cfg.graphVersion}/debug_token`, GRAPH_HOST);
  url.searchParams.set('input_token', token);
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), prazoMs);
  const repassar = () => controle.abort();
  total?.addEventListener('abort', repassar, { once: true });
  try {
    url.searchParams.set('appsecret_proof', await provaDoSegredo(appToken, cfg.appSecret));
    if (controle.signal.aborted) throw new DOMException('prazo', 'AbortError');
    const resposta = await buscar(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${appToken}` },
      redirect: 'error',
      cache: 'no-store',
      signal: controle.signal,
    });
    if (resposta.status >= 300 && resposta.status < 400) {
      controle.abort();
      await resposta.body?.cancel().catch(() => {});
      return { estado: 'nao_verificado', motivo: 'redirect_recusado', transitorio: false };
    }
    const bruto = await resposta.text();
    if (bruto.length > MAX_RESPOSTA) return { estado: 'nao_verificado', motivo: 'resposta_grande_demais', transitorio: false };
    let corpo: unknown = null;
    try { corpo = JSON.parse(bruto); } catch { corpo = null; }
    return classificarDebugToken({ status: resposta.status, corpo }, cfg, conta, agora);
  } catch {
    const motivo = total?.aborted ? 'sem_tempo' : controle.signal.aborted ? 'tempo_esgotado' : 'meta_indisponivel';
    return { estado: 'nao_verificado', motivo, transitorio: true };
  } finally {
    clearTimeout(relogio);
    total?.removeEventListener('abort', repassar);
  }
}

/**
 * Roda `tarefas` com no máximo `n` ao mesmo tempo. Com o sinal abortado, não começa tarefa nova;
 * as em andamento recebem o mesmo sinal e terminam. Devolve quantas começaram (nada fica pendente).
 */
export async function comConcorrencia(tarefas: Array<() => Promise<void>>, n: number, sinal?: AbortSignal): Promise<number> {
  let proxima = 0;
  const trabalhador = async () => {
    while (proxima < tarefas.length && !sinal?.aborted) {
      const i = proxima++;
      await tarefas[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, tarefas.length) }, trabalhador));
  return proxima;
}

// ─── A leitura ──────────────────────────────────────────────────

export interface Dependencias {
  porta: PortaMetaConexoes;
  config: ConfigDaMeta | null;
  buscar: BuscarFn;
  painelOrigem: string | null;
  agora?: () => Date;
  prazoTotalMs?: number;
}

function perfilDaConta(c: ContaMeta): { perfil: string | null; handle_recusado?: true } {
  if (c.platform !== 'instagram') return { perfil: texto(c.display_name, 120) ?? texto(c.handle, 120) };
  const h = handleDoInstagram(c.handle);
  if (h) return { perfil: h };
  return { perfil: texto(c.display_name, 120), ...(c.handle ? { handle_recusado: true as const } : {}) };
}

export async function metaConexoesEstado(input: unknown, ctx: AuthContext, deps: Dependencias): Promise<Record<string, unknown>> {
  exigirAdminIrrestrito(ctx); // antes de qualquer I/O
  const entrada = validarEntrada(input);
  const agora = (deps.agora ?? (() => new Date()))();
  const painel = urlDoPainel(deps.painelOrigem);
  const prazoTotal = new AbortController();
  const relogio = setTimeout(() => prazoTotal.abort(), Math.min(deps.prazoTotalMs ?? PRAZO_TOTAL_MS, PRAZO_DA_FERRAMENTA_MS - 5_000));
  const sinal = prazoTotal.signal;
  const noBanco = async <T>(f: () => Promise<T>): Promise<T> => {
    try { return await f(); } catch (e) {
      if (sinal.aborted) throw new ErroDaFerramenta('tempo_esgotado', 'O banco não respondeu dentro do prazo.', 'Tente de novo com limite menor ou um client_id.', true);
      throw e;
    }
  };
  try {
    const varredura = await noBanco(() => deps.porta.clientesAtivos({ clientId: entrada.clientId, depoisDe: entrada.cursor, limite: entrada.limite + 1, signal: sinal }));
    if (entrada.clientId && !varredura.clientes.some((c) => c.id === entrada.clientId)) {
      throw new ErroDaFerramenta('cliente_nao_encontrado', 'Cliente não encontrado entre os clientes ativos.', 'Confira o client_id em aceleriq_list_clients.');
    }
    const clientes = varredura.clientes.slice(0, entrada.limite);
    let proximoCursor: string | null = null;
    let varreduraCompleta = true;
    if (!entrada.clientId) {
      if (varredura.clientes.length > entrada.limite) proximoCursor = clientes[clientes.length - 1].id;
      else if (!varredura.fim) {
        // A varredura parou antes do fim: não declara fim de clientes; continua de onde parou.
        varreduraCompleta = false;
        proximoCursor = varredura.varridoAte ?? entrada.cursor;
      }
    }

    const todas = clientes.length ? await noBanco(() => deps.porta.contas(clientes.map((c) => c.id), sinal)) : [];
    if (todas === null) {
      throw new ErroDaFerramenta('migration_ausente', 'O banco ainda não tem a leitura das contas da Meta (migration 20261027235000).', `Abra ${painel} quando a migration estiver aplicada.`);
    }

    const avisos: string[] = [];
    if (!varreduraCompleta) avisos.push('A varredura de clientes parou antes do fim: continue com proximo_cursor.');
    if (entrada.verificarAoVivo && !deps.config) avisos.push('A Meta não está configurada no servidor: o teste ao vivo ficou como nao_verificado.');
    let verificacoes = 0;
    let rpcAusente = false;

    type Item = Record<string, unknown> & { _verificar?: ContaMeta };
    const porCliente = clientes.map((cliente) => {
      const contas = todas.filter((c) => contaCasaComCliente(c, cliente.id));
      const itens: Item[] = [];
      for (const plataforma of PLATAFORMAS) {
        const daPlataforma = contas.filter((c) => c.platform === plataforma)
          .sort((a, b) => a.external_account_id.localeCompare(b.external_account_id));
        if (!daPlataforma.length) {
          itens.push({ plataforma, external_account_id: null, perfil: null, estado: 'sem_conexao', motivo: 'sem_conta_ativa', origem_da_concessao: null, expiracao: null, graph: null });
          continue;
        }
        // Duplicata = mesmo id da Meta ou mesmo @ na plataforma. Fica na lista, marcada.
        const chave = (c: ContaMeta) => idNumerico(c.external_id) ?? perfilDaConta(c).perfil?.toLowerCase() ?? c.external_account_id;
        const vezes = new Map<string, number>();
        for (const c of daPlataforma) vezes.set(chave(c), (vezes.get(chave(c)) ?? 0) + 1);
        for (const conta of daPlataforma) {
          const c = conta.concessao;
          const origem = c ? (c.origem === 'usuario_do_sistema' ? 'usuario_do_sistema' : 'oauth_usuario') : null;
          const tokenEm = menorPrazo(c?.access_token_expires_at, conta.expires_at);
          const dadosEm = menorPrazo(c?.data_access_expires_at, conta.data_access_expires_at);
          const item: Item = {
            plataforma,
            external_account_id: conta.external_account_id,
            external_id: idNumerico(conta.external_id),
            ...perfilDaConta(conta),
            ...((vezes.get(chave(conta)) ?? 0) > 1 ? { duplicada: true } : {}),
            origem_da_concessao: origem,
            expiracao: { menor_em: menorPrazo(tokenEm, dadosEm), token_em: tokenEm, acesso_aos_dados_em: dadosEm, fonte: 'painel' },
            graph: null,
          };
          const peloBanco = estadoPeloBanco(conta, agora);
          if (peloBanco) Object.assign(item, peloBanco);
          else if (!entrada.verificarAoVivo) Object.assign(item, { estado: 'nao_verificado', motivo: 'verificacao_desligada' });
          else if (!deps.config) Object.assign(item, { estado: 'nao_verificado', motivo: 'meta_nao_configurada' });
          else if (verificacoes >= MAX_VERIFICACOES) Object.assign(item, { estado: 'nao_verificado', motivo: 'limite_de_verificacoes' });
          else {
            verificacoes++;
            // Ainda sem resposta: se o prazo total acabar antes, fica assim (parcial explícito).
            Object.assign(item, { estado: 'nao_verificado', motivo: 'sem_tempo', transitorio: true });
            item._verificar = conta;
          }
          itens.push(item);
        }
      }
      return { client_id: cliente.id, cliente: texto(cliente.nome, 160), contas: itens };
    });

    const pendentes = porCliente.flatMap((p) => p.contas).filter((i) => i._verificar);
    const contasDe = new Map(pendentes.map((i) => [i, i._verificar!]));
    for (const i of pendentes) delete i._verificar;
    await comConcorrencia(pendentes.map((item) => async () => {
      const conta = contasDe.get(item)!;
      const grantId = conta.concessao?.id;
      if (!grantId || !UUID.test(grantId)) {
        Object.assign(item, { estado: 'nao_verificado', motivo: 'credencial_nao_localizada_ou_trocada', transitorio: false });
        return;
      }
      let t: TokenDaConta;
      try {
        t = await deps.porta.tokenDaConta({
          externalAccountId: conta.external_account_id,
          grantId,
          clientId: conta.client_id,
          platform: conta.platform as Plataforma,
          providerResourceId: idNumerico(conta.external_id)!,
        }, sinal);
      } catch { t = { tipo: 'falha' }; }
      if (sinal.aborted) return; // fica "sem_tempo"
      if (t.tipo === 'rpc_ausente') { rpcAusente = true; Object.assign(item, { estado: 'nao_verificado', motivo: 'leitura_do_token_nao_instalada', transitorio: false }); return; }
      if (t.tipo === 'falha') { Object.assign(item, { estado: 'nao_verificado', motivo: 'banco_indisponivel', transitorio: true }); return; }
      // Concessão ativa no painel e a RPC estrita não acha: trocou ou sumiu entre as duas leituras.
      if (t.tipo === 'nao_localizado') { Object.assign(item, { estado: 'nao_verificado', motivo: 'credencial_nao_localizada_ou_trocada', transitorio: false }); return; }
      const r = await debugToken(deps.config!, t.token, conta, deps.buscar, agora, PRAZO_GRAPH_MS, sinal);
      const { estado, motivo, transitorio, ...graph } = r;
      const exp = item.expiracao as Record<string, string | null>;
      const tokenEm = menorPrazo(exp.token_em, r.expira_em);
      const dadosEm = menorPrazo(exp.acesso_aos_dados_em, r.acesso_aos_dados_expira_em);
      Object.assign(item, {
        estado,
        motivo,
        transitorio,
        expiracao: { menor_em: menorPrazo(tokenEm, dadosEm), token_em: tokenEm, acesso_aos_dados_em: dadosEm, fonte: r.expira_em || r.acesso_aos_dados_expira_em ? 'painel_e_graph' : 'painel' },
        graph: Object.keys(graph).length ? graph : null,
      });
    }), CONCORRENCIA, sinal);
    if (rpcAusente) avisos.push('A leitura do token por conta (migration 20261125120000) ainda não está no banco: teste ao vivo como nao_verificado.');

    const resumo: Record<EstadoDaConexao, number> = { ok: 0, venceu: 0, caiu: 0, sem_conexao: 0, nao_verificado: 0 };
    let semTempo = 0;
    let semVerba = 0;
    for (const p of porCliente) {
      for (const i of p.contas) {
        resumo[i.estado as EstadoDaConexao]++;
        if (i.motivo === 'sem_tempo') semTempo++;
        if (i.motivo === 'limite_de_verificacoes') semVerba++;
      }
    }
    if (semTempo) avisos.push(`${semTempo} conta(s) ficaram sem teste ao vivo porque o prazo total (${Math.round((deps.prazoTotalMs ?? PRAZO_TOTAL_MS) / 1000)} s) acabou: motivo sem_tempo.`);
    if (semVerba) avisos.push(`${semVerba} conta(s) passaram do limite de ${MAX_VERIFICACOES} testes por chamada: use limite menor ou client_id.`);

    return {
      clientes: porCliente,
      resumo,
      parcial: !varreduraCompleta || semTempo > 0 || semVerba > 0,
      varredura_completa: varreduraCompleta,
      proximo_cursor: proximoCursor,
      verificado_em: agora.toISOString(),
      caminho_oficial: painel,
      ...(avisos.length ? { avisos } : {}),
      leitura: 'Só leitura do inventário orgânico (Instagram e Facebook), sem Ads. ok = o debug_token da credencial exata desta conta diz que ela vale agora; NÃO quer dizer permissão para publicar. venceu = prazo passou; caiu = revogada, invalidada ou de outra página; sem_conexao = sem conta ativa, registro manual sem id da Meta ou sem concessão; nao_verificado = sem configuração, sem tempo, Meta fora, credencial não localizada ou resposta que não prova nada sobre o token. Para reconectar ou trocar a concessão, use o caminho_oficial no painel.',
    };
  } finally {
    clearTimeout(relogio);
  }
}

// ─── A porta real ───────────────────────────────────────────────

const funcaoAusente = (e: { code?: string } | null) => e?.code === 'PGRST202' || e?.code === '42883';
const LOTE_DE_PERFIS = 100;
const RODADAS_DE_PERFIS = 5;

export function portaDoBanco(): PortaMetaConexoes {
  return {
    async clientesAtivos({ clientId, depoisDe, limite, signal }) {
      const clientes: ClienteAtivo[] = [];
      let varridoAte = depoisDe;
      for (let rodada = 0; rodada < RODADAS_DE_PERFIS; rodada++) {
        let q = db().from('profiles').select('id, full_name, company_name')
          .eq('plan_status', 'active').is('deleted_at', null).order('id', { ascending: true }).limit(LOTE_DE_PERFIS);
        if (clientId) q = q.eq('id', clientId);
        else if (varridoAte) q = q.gt('id', varridoAte);
        const { data, error } = await q.abortSignal(signal);
        if (error) throw new ErroDaFerramenta('falha_no_banco', 'Os clientes não responderam agora.', 'Tente de novo em instantes.', true);
        const perfis = (data ?? []) as Array<{ id: string; full_name: string | null; company_name: string | null }>;
        if (!perfis.length) return { clientes, fim: true, varridoAte };
        const papeis = await db().from('user_roles').select('user_id').eq('role', 'client')
          .in('user_id', perfis.map((p) => p.id)).abortSignal(signal);
        if (papeis.error) throw new ErroDaFerramenta('falha_no_banco', 'Os papéis não responderam agora.', 'Tente de novo em instantes.', true);
        const comPapel = new Set(((papeis.data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id));
        for (const p of perfis) {
          varridoAte = p.id; // tudo até aqui foi visto: o cursor nunca pula cliente
          if (comPapel.has(p.id)) clientes.push({ id: p.id, nome: (p.company_name ?? '').trim() || p.full_name });
          if (clientes.length >= limite) return { clientes, fim: false, varridoAte };
        }
        if (clientId || perfis.length < LOTE_DE_PERFIS) return { clientes, fim: true, varridoAte };
      }
      return { clientes, fim: false, varridoAte };
    },
    async contas(clientIds, signal) {
      const { data, error } = await db().rpc('meta_usuario_do_sistema_contas').abortSignal(signal);
      if (error) {
        if (funcaoAusente(error)) return null;
        throw new ErroDaFerramenta('falha_no_banco', 'As contas da Meta não responderam agora.', 'Tente de novo em instantes.', true);
      }
      const alvo = new Set(clientIds);
      return (Array.isArray(data) ? data : []).filter((c: ContaMeta) => alvo.has(c?.client_id)) as ContaMeta[];
    },
    async tokenDaConta(p, signal) {
      const { data, error } = await db().rpc('meta_conexao_token_da_conta', {
        _external_account_id: p.externalAccountId,
        _grant_id: p.grantId,
        _client_id: p.clientId,
        _platform: p.platform,
        _provider_resource_id: p.providerResourceId,
      }).abortSignal(signal);
      if (error) return funcaoAusente(error) ? { tipo: 'rpc_ausente' } : { tipo: 'falha' };
      const linha = Array.isArray(data) ? data[0] : null;
      const token = linha && typeof linha.access_token === 'string' ? linha.access_token : '';
      return token.length >= 16 && token.length <= 8192 ? { tipo: 'token', token } : { tipo: 'nao_localizado' };
    },
  };
}

// ─── A ferramenta ───────────────────────────────────────────────

export const FERRAMENTA_META_CONEXOES_ESTADO: readonly ToolDefinition[] = [
  {
    name: 'aceleriq_meta_conexoes_estado',
    title: 'Meta: estado das conexões orgânicas',
    description:
      'Só leitura, só admin. Inventário das conexões orgânicas da Meta por cliente ativo: todas as contas ativas de Instagram e Facebook (registro manual sem id da Meta e duplicatas aparecem marcados; plataforma sem conta = sem_conexao), origem da concessão (oauth_usuario ou usuario_do_sistema), menor expiração entre token e acesso aos dados, e o estado ok, venceu, caiu, sem_conexao ou nao_verificado. O teste ao vivo usa o debug_token da Graph com a credencial exata de cada conta; nunca outra conta, nunca Ads. ok é diagnóstico do token, não permissão para publicar. Paginado por cliente (limite até 10, proximo_cursor; parcial=true quando a varredura ou o prazo pararam antes) ou um client_id. Nunca devolve token, segredo nem resposta crua da Meta. Para corrigir: caminho_oficial (/config/meta-usuario-do-sistema).',
    scopes: ['admin'],
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: true },
    prazoMs: PRAZO_DA_FERRAMENTA_MS,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        client_id: { type: 'string', format: 'uuid', description: 'Só este cliente ativo.' },
        cursor: { type: 'string', format: 'uuid', description: 'proximo_cursor da página anterior.' },
        limite: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO, description: `Clientes por página. Padrão ${LIMITE_PADRAO}.` },
        verificar_ao_vivo: { type: 'boolean', description: 'false pula o debug_token (estado vira nao_verificado quando o painel não decide). Padrão true.' },
      },
    },
    handler: (input, ctx) => {
      exigirAdminIrrestrito(ctx); // antes de montar porta, config ou fetch
      return metaConexoesEstado(input, ctx, {
        porta: portaDoBanco(),
        config: configDaMeta((k) => Deno.env.get(k)),
        buscar: (url, init) => fetch(url, init),
        painelOrigem: Deno.env.get('PAINEL_ORIGIN') ?? null,
      });
    },
  },
];
