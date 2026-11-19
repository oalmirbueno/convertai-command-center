/**
 * MCP 2.37.0 (19/11/2026): auditoria das assinaturas dos agentes.
 *
 * A credencial do Grok Bot é uma só para vários agentes (jori, trafe, orion, infra...), então o servidor não
 * consegue IMPEDIR que um agente assine como outro. O que ele faz aqui é deixar rastro e alerta:
 *   - uma linha em mcp_assinaturas_log por chamada do Escritório (todas, inclusive leitura) e de toda escrita
 *     assinada com `operator`, com o operador DECLARADO (o que o agente pediu) e o EFETIVO (o que valeu);
 *   - alerta em mcp_alertas_assinatura (um por hora, credencial e tipo, sem spam) quando: o operador declarado
 *     está fora dos vínculos; a leitura dos vínculos falhou; ou, em 10 minutos, a mesma credencial assinou
 *     como 2+ operadores com sinais de sessão diferentes (hash da sessão MCP disjunto ou user-agent diferente).
 *     IP não conta: o egress do Grok Bot (Cursor/1.0.0 em IPs AWS rotativos) muda sozinho.
 *
 * Nunca grava o header authorization nem o mcp-session-id cru (só 16 caracteres do SHA-256). Falha de auditoria
 * nunca derruba a chamada: tudo em try/catch, em segundo plano.
 */

import type { ToolDefinition } from '../../_shared/mcp-tools.ts';
import { db } from '../../_shared/aceleriq-read-services.ts';
import { ErroDaFerramenta } from './robustez.ts';
import { assinaComoOperador, principalDaChamada, vinculosDaChave, type VinculoDaChave } from './autoria.ts';

// ─── Tipos ──────────────────────────────────────────────────────

export type DecisaoDaAssinatura =
  | 'sem_operator'
  | 'ok'
  | 'fora_dos_vinculos'
  | 'vinculos_nao_instalados'
  | 'vinculos_indisponiveis'
  | 'initialize';

export type TipoDeAlerta = 'fora_dos_vinculos' | 'vinculos_indisponiveis' | 'operadores_com_sinais_diferentes';

/** Vínculos lidos: lista, null (tabela não existe) ou 'indisponivel' (a leitura falhou). */
export type VinculosLidos = VinculoDaChave[] | null | 'indisponivel';

export interface SinaisDaRequisicao {
  ip: string | null;
  user_agent: string | null;
  sessao_hash: string | null;
  protocolo: string | null;
}

export interface LinhaDeAssinatura {
  created_at?: string;
  principal: string;
  chave_nome: string | null;
  tool_name: string;
  correlation_id: string | null;
  operador_declarado: string | null;
  operador_efetivo: string | null;
  decisao: DecisaoDaAssinatura;
  ip: string | null;
  user_agent: string | null;
  sessao_hash: string | null;
  protocolo: string | null;
  cliente_info?: string | null;
}

export interface AlertaDeAssinatura {
  hora: string;
  principal: string;
  tipo: string;
  operadores: string[];
  contagem: number;
  primeira_em: string;
  ultima_em: string;
  amostra: Record<string, unknown>;
  status: string;
}

export interface Suspeita {
  tipo: TipoDeAlerta;
  operadores: string[];
  amostra: Record<string, unknown>;
}

export interface FiltrosDosRegistros {
  desde: string;
  principal?: string;
  operador?: string;
  limite: number;
}

export interface FiltrosDosAlertas {
  desde: string;
  principal?: string;
  operador?: string;
  tipo?: string;
  limite: number;
}

/** A porta para o banco (os testes trocam por uma de memória). Leitura devolve null quando a tabela não existe. */
export interface PortaDaAuditoria {
  gravar(linha: LinhaDeAssinatura): Promise<void>;
  recentes(principal: string, desde: string): Promise<LinhaDeAssinatura[]>;
  alertar(principal: string, tipo: TipoDeAlerta, operadores: string[], amostra: Record<string, unknown>): Promise<{ alerta_id: string; contagem: number; novo: boolean } | null>;
  registros(f: FiltrosDosRegistros): Promise<LinhaDeAssinatura[] | null>;
  alertas(f: FiltrosDosAlertas): Promise<AlertaDeAssinatura[] | null>;
}

// ─── Regras puras ───────────────────────────────────────────────

export const JANELA_DE_SINAIS_MS = 10 * 60_000;
const slug = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
const corte = (v: string | null | undefined, n: number) => (v ? v.slice(0, n) : null);
const objeto = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** O operador que a chamada declarou (slug minúsculo) ou null. */
export function operadorDeclarado(args: unknown): string | null {
  return slug(objeto(args).operator) || null;
}

/** Entra na auditoria: todo o Escritório (leitura também, mesmo sem operator) e toda escrita assinada. */
export function deveAuditar(toolName: string, args: unknown, readOnly: boolean): boolean {
  if (toolName.startsWith('aceleriq_escritorio_')) return true;
  return assinaComoOperador(toolName, objeto(args), readOnly);
}

export function classificar(vinculos: VinculosLidos, declarado: string | null): DecisaoDaAssinatura {
  // A leitura falhou: vem primeiro, porque é sinal (e alerta) mesmo sem operator.
  if (vinculos === 'indisponivel') return 'vinculos_indisponiveis';
  const d = slug(declarado);
  if (!d) return 'sem_operator';
  if (vinculos === null) return 'vinculos_nao_instalados';
  return vinculos.some((v) => v.operator_slug === d) ? 'ok' : 'fora_dos_vinculos';
}

/** O operador que valeu: o final dos args se está nos vínculos; senão o padrão da credencial. */
export function operadorEfetivo(vinculos: VinculosLidos, operadorFinal: string | null): string | null {
  const f = slug(operadorFinal) || null;
  if (vinculos === 'indisponivel') return null;
  if (vinculos === null) return f;
  if (f && vinculos.some((v) => v.operator_slug === f)) return f;
  const padrao = vinculos.find((v) => v.padrao) ?? (vinculos.length === 1 ? vinculos[0] : null);
  return padrao?.operator_slug ?? null;
}

async function sha256Hex(texto: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Sinais da requisição. Nunca lê o header authorization; a sessão MCP só vira hash (16 caracteres). */
export async function sinaisDaRequisicao(req: Request): Promise<SinaisDaRequisicao> {
  const h = req.headers;
  const limpo = (v: string | null) => (v && v.trim() ? v.trim() : null);
  const ip = limpo(h.get('cf-connecting-ip'))
    ?? limpo((h.get('x-forwarded-for') ?? '').split(',')[0] ?? null)
    ?? limpo(h.get('x-real-ip'));
  const sessao = limpo(h.get('mcp-session-id'));
  return {
    ip: corte(ip, 80),
    user_agent: corte(limpo(h.get('user-agent')), 200),
    sessao_hash: sessao ? (await sha256Hex(sessao)).slice(0, 16) : null,
    protocolo: corte(limpo(h.get('mcp-protocol-version')), 40),
  };
}

export const SEM_SINAIS: SinaisDaRequisicao = { ip: null, user_agent: null, sessao_hash: null, protocolo: null };

const disjuntos = (a: Set<string>, b: Set<string>) => a.size > 0 && b.size > 0 && [...a].every((x) => !b.has(x));

/**
 * O que a chamada atual levanta. `recentes` = assinaturas da mesma credencial nos últimos 10 min (a atual pode
 * estar ou não; é acrescentada se faltar). Sinais iguais entre operadores é o caso normal da chave compartilhada.
 */
export function detectarSuspeitas(atual: LinhaDeAssinatura, recentes: LinhaDeAssinatura[]): Suspeita[] {
  const amostra = {
    tool: atual.tool_name,
    operador_declarado: atual.operador_declarado,
    operador_efetivo: atual.operador_efetivo,
    correlation_id: atual.correlation_id,
    user_agent: atual.user_agent,
    ip: atual.ip,
  };
  const suspeitas: Suspeita[] = [];
  if (atual.decisao === 'fora_dos_vinculos' && atual.operador_declarado) {
    suspeitas.push({ tipo: 'fora_dos_vinculos', operadores: [atual.operador_declarado], amostra });
  }
  if (atual.decisao === 'vinculos_indisponiveis') {
    suspeitas.push({ tipo: 'vinculos_indisponiveis', operadores: atual.operador_declarado ? [atual.operador_declarado] : [], amostra });
  }
  const eu = atual.operador_declarado;
  if (!eu || atual.decisao === 'initialize') return suspeitas;

  const linhas = recentes.some((r) => r.correlation_id && r.correlation_id === atual.correlation_id) ? recentes : [...recentes, atual];
  const porOperador = new Map<string, { uas: Set<string>; sessoes: Set<string> }>();
  for (const r of linhas) {
    const op = slug(r.operador_declarado);
    if (!op || r.principal !== atual.principal || r.decisao === 'initialize') continue;
    const s = porOperador.get(op) ?? { uas: new Set<string>(), sessoes: new Set<string>() };
    if (r.user_agent) s.uas.add(r.user_agent);
    if (r.sessao_hash) s.sessoes.add(r.sessao_hash);
    porOperador.set(op, s);
  }
  const meus = porOperador.get(eu);
  if (!meus || porOperador.size < 2) return suspeitas;

  const diferentes: string[] = [];
  const motivos = new Set<string>();
  for (const [outro, s] of porOperador) {
    if (outro === eu) continue;
    const porSessao = disjuntos(meus.sessoes, s.sessoes);
    const porUa = disjuntos(meus.uas, s.uas);
    if (porSessao) motivos.add('sessao');
    if (porUa) motivos.add('user_agent');
    if (porSessao || porUa) diferentes.push(outro);
  }
  if (!diferentes.length) return suspeitas;
  const envolvidos = [eu, ...diferentes].sort();
  const sinais: Record<string, { user_agents: string[]; sessoes: string[] }> = {};
  for (const op of envolvidos) {
    const s = porOperador.get(op)!;
    sinais[op] = { user_agents: [...s.uas].slice(0, 5), sessoes: [...s.sessoes].map((x) => x.slice(0, 8)).slice(0, 5) };
  }
  suspeitas.push({
    tipo: 'operadores_com_sinais_diferentes',
    operadores: envolvidos,
    amostra: { ...amostra, motivo: [...motivos].sort(), janela_min: JANELA_DE_SINAIS_MS / 60_000, sinais },
  });
  return suspeitas;
}

// ─── Registrar (nunca derruba a chamada) ────────────────────────

export interface EntradaDaAssinatura {
  ctx: { keyId: string; origin: string | null; keyName?: string | null };
  toolName: string;
  correlationId: string | null;
  declarado: string | null;
  efetivo: string | null;
  decisao: DecisaoDaAssinatura;
  sinais?: SinaisDaRequisicao;
  clienteInfo?: string | null;
  agora?: number;
}

const erroCurto = (e: unknown) => ({ code: (e as { code?: string })?.code ?? null, nome: (e as Error)?.name ?? null });

/** Grava a linha e roda a detecção. Devolve as suspeitas que viraram alerta (para teste e log). */
export async function registrarAssinatura(entrada: EntradaDaAssinatura, porta: PortaDaAuditoria): Promise<Suspeita[]> {
  try {
    const s = entrada.sinais ?? SEM_SINAIS;
    const agora = entrada.agora ?? Date.now();
    const linha: LinhaDeAssinatura = {
      created_at: new Date(agora).toISOString(),
      principal: principalDaChamada(entrada.ctx),
      chave_nome: corte(entrada.ctx.keyName ?? null, 120),
      tool_name: entrada.toolName,
      correlation_id: entrada.correlationId,
      operador_declarado: slug(entrada.declarado) || null,
      operador_efetivo: slug(entrada.efetivo) || null,
      decisao: entrada.decisao,
      ip: corte(s.ip, 80),
      user_agent: corte(s.user_agent, 200),
      sessao_hash: corte(s.sessao_hash, 16),
      protocolo: corte(s.protocolo, 40),
      cliente_info: corte(entrada.clienteInfo ?? null, 120),
    };
    try {
      await porta.gravar(linha);
    } catch (e) {
      console.error('[mcp auditoria] linha da assinatura nao gravada', erroCurto(e));
    }
    if (linha.decisao === 'initialize') return [];

    let recentes: LinhaDeAssinatura[] = [];
    if (linha.operador_declarado) {
      try {
        recentes = await porta.recentes(linha.principal, new Date(agora - JANELA_DE_SINAIS_MS).toISOString());
      } catch (e) {
        console.error('[mcp auditoria] leitura da janela falhou', erroCurto(e));
      }
    }
    const suspeitas = detectarSuspeitas(linha, recentes);
    for (const sus of suspeitas) {
      try {
        await porta.alertar(linha.principal, sus.tipo, sus.operadores, sus.amostra);
      } catch (e) {
        console.error('[mcp auditoria] alerta nao registrado', { tipo: sus.tipo, ...erroCurto(e) });
      }
    }
    return suspeitas;
  } catch (e) {
    console.error('[mcp auditoria] falhou', erroCurto(e));
    return [];
  }
}

/**
 * A ligação usada pelo index.ts, em segundo plano: decide com os vínculos que a autoria já leu (ou a mesma
 * leitura com cache de 60 s) e registra. `indisponivel` força a decisão quando a chamada já viu a falha.
 */
export async function auditarChamada(
  e: {
    ctx: { keyId: string; origin: string | null; keyName?: string | null };
    toolName: string;
    correlationId: string;
    declarado: string | null;
    operadorFinal: string | null;
    vinculos?: VinculosLidos;
    indisponivel?: boolean;
    sinais?: SinaisDaRequisicao;
  },
  porta: PortaDaAuditoria = portaDoBancoDeAuditoria(),
  carregar: (principal: string) => Promise<VinculoDaChave[] | null> = vinculosDaChave,
): Promise<Suspeita[]> {
  try {
    let vinculos: VinculosLidos;
    if (e.indisponivel) vinculos = 'indisponivel';
    else if (e.vinculos !== undefined) vinculos = e.vinculos;
    else vinculos = await carregar(principalDaChamada(e.ctx)).catch(() => 'indisponivel' as const);
    return await registrarAssinatura({
      ctx: e.ctx,
      toolName: e.toolName,
      correlationId: e.correlationId,
      declarado: e.declarado,
      efetivo: operadorEfetivo(vinculos, e.operadorFinal),
      decisao: classificar(vinculos, e.declarado),
      sinais: e.sinais,
    }, porta);
  } catch (err) {
    console.error('[mcp auditoria] falhou', erroCurto(err));
    return [];
  }
}

// ─── Leitura para a ferramenta ──────────────────────────────────

export interface FiltrosDaListagem {
  horas?: number;
  principal?: string;
  operador?: string;
  tipo?: string;
  so_alertas?: boolean;
  limite?: number;
}

const TIPOS: readonly TipoDeAlerta[] = ['fora_dos_vinculos', 'vinculos_indisponiveis', 'operadores_com_sinais_diferentes'];
const MAX_PARA_RESUMO = 2000;

function inteiro(v: unknown, min: number, max: number, padrao: number, campo: string): number {
  if (v === undefined || v === null) return padrao;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ErroDaFerramenta('entrada_invalida', `${campo} vai de ${min} a ${max}.`, null, false);
  }
  return n;
}

/** Tira da amostra o que não pode sair (nada de segredo; sessão só com 8 caracteres). */
function amostraSegura(a: Record<string, unknown>): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(objeto(a))) {
    if (/authorization|token|secret|senha|password|session_id|cookie/i.test(k)) continue;
    saida[k] = v;
  }
  return saida;
}

export async function listarAssinaturas(entrada: unknown, porta: PortaDaAuditoria, agora = Date.now()) {
  const f = objeto(entrada) as FiltrosDaListagem;
  const horas = inteiro(f.horas, 1, 168, 24, 'horas');
  const limite = inteiro(f.limite, 1, 200, 50, 'limite');
  const principal = typeof f.principal === 'string' && f.principal.trim() ? f.principal.trim().slice(0, 200) : undefined;
  const operador = slug(f.operador) || undefined;
  // O operador entra num filtro do PostgREST (or=...): só slug.
  if (operador && !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(operador)) {
    throw new ErroDaFerramenta('entrada_invalida', 'operador deve ser um slug (letras, números, - e _).', null, false);
  }
  const tipo = typeof f.tipo === 'string' && f.tipo.trim() ? f.tipo.trim() : undefined;
  if (tipo && !TIPOS.includes(tipo as TipoDeAlerta)) {
    throw new ErroDaFerramenta('entrada_invalida', `tipo deve ser um destes: ${TIPOS.join(', ')}.`, null, false);
  }
  const desde = new Date(agora - horas * 3_600_000);
  const desdeHora = new Date(desde);
  desdeHora.setUTCMinutes(0, 0, 0);

  const [registros, alertas] = await Promise.all([
    porta.registros({ desde: desde.toISOString(), principal, operador, limite: MAX_PARA_RESUMO }),
    porta.alertas({ desde: desdeHora.toISOString(), principal, operador, tipo, limite }),
  ]);
  const instalado = registros !== null && alertas !== null;
  const linhas = registros ?? [];

  const chaveDe = new Map<string, string | null>();
  for (const r of linhas) if (!chaveDe.has(r.principal) && r.chave_nome) chaveDe.set(r.principal, r.chave_nome);

  const resumo = new Map<string, { principal: string; chave: string | null; ops: Map<string, { chamadas: number; fora: number }>; uas: Set<string>; ips: Set<string> }>();
  for (const r of linhas) {
    const g = resumo.get(r.principal) ?? { principal: r.principal, chave: chaveDe.get(r.principal) ?? null, ops: new Map(), uas: new Set<string>(), ips: new Set<string>() };
    if (r.user_agent) g.uas.add(r.user_agent);
    if (r.ip) g.ips.add(r.ip);
    if (r.decisao !== 'initialize') {
      const nome = r.operador_declarado ?? '(sem operator)';
      const o = g.ops.get(nome) ?? { chamadas: 0, fora: 0 };
      o.chamadas++;
      if (r.decisao === 'fora_dos_vinculos') o.fora++;
      g.ops.set(nome, o);
    }
    resumo.set(r.principal, g);
  }

  const ordenados = [...(alertas ?? [])].sort((a, b) => b.hora.localeCompare(a.hora) || b.ultima_em.localeCompare(a.ultima_em));
  return {
    janela_horas: horas,
    ...(instalado ? {} : { instalado: false, aviso: 'A auditoria das assinaturas ainda não foi instalada neste banco (migration 20261119211009).' }),
    alertas: ordenados.slice(0, limite).map((a) => ({
      hora: a.hora,
      principal: a.principal,
      chave: chaveDe.get(a.principal) ?? null,
      tipo: a.tipo,
      operadores: a.operadores ?? [],
      contagem: a.contagem,
      primeira_em: a.primeira_em,
      ultima_em: a.ultima_em,
      amostra: amostraSegura(a.amostra),
      status: a.status,
    })),
    resumo_por_credencial: [...resumo.values()].map((g) => ({
      principal: g.principal,
      chave: g.chave,
      operadores: [...g.ops.entries()].map(([op, o]) => ({ operador: op, chamadas: o.chamadas, fora_dos_vinculos: o.fora })).sort((a, b) => b.chamadas - a.chamadas),
      user_agents: [...g.uas].slice(0, 20),
      ips_distintos: g.ips.size,
    })),
    ...(f.so_alertas === true ? {} : {
      ultimos: linhas.slice(0, limite).map((r) => ({
        em: r.created_at ?? null,
        principal: r.principal,
        chave: r.chave_nome,
        tool: r.tool_name,
        operador_declarado: r.operador_declarado,
        operador_efetivo: r.operador_efetivo,
        decisao: r.decisao,
        ip: r.ip,
        user_agent: r.user_agent,
        sessao: r.sessao_hash ? r.sessao_hash.slice(0, 8) : null,
        protocolo: r.protocolo,
        cliente_info: r.cliente_info ?? null,
        correlation_id: r.correlation_id,
      })),
    }),
    leitura: 'Só leitura. Rastro das assinaturas dos agentes: operador declarado e efetivo por chamada do Escritório e de escrita assinada, e alertas agrupados por hora, credencial e tipo. A credencial compartilhada não impede um agente de assinar como outro: isto é log e alerta, não bloqueio. Sinais iguais entre operadores é o normal da chave compartilhada; IP não conta como sinal.',
  };
}

// ─── A porta real ───────────────────────────────────────────────

const tabelaAusente = (e: { code?: string } | null) => e?.code === '42P01' || e?.code === 'PGRST205';
const COL_LOG = 'created_at, principal, chave_nome, tool_name, correlation_id, operador_declarado, operador_efetivo, decisao, ip, user_agent, sessao_hash, protocolo, cliente_info';

function semTabela(onde: string) {
  console.error('[mcp auditoria] tabela ausente', { onde });
}

export function portaDoBancoDeAuditoria(): PortaDaAuditoria {
  return {
    async gravar(linha) {
      const { error } = await db().from('mcp_assinaturas_log').insert(linha);
      if (error) {
        if (tabelaAusente(error)) return semTabela('gravar');
        throw error;
      }
    },
    async recentes(principal, desde) {
      const { data, error } = await db().from('mcp_assinaturas_log').select(COL_LOG)
        .eq('principal', principal).gte('created_at', desde).not('operador_declarado', 'is', null)
        .order('created_at', { ascending: false }).limit(1000);
      if (error) {
        if (tabelaAusente(error)) { semTabela('recentes'); return []; }
        throw error;
      }
      return (data ?? []) as LinhaDeAssinatura[];
    },
    async alertar(principal, tipo, operadores, amostra) {
      const { data, error } = await db().rpc('mcp_alerta_assinatura_registrar', {
        _principal: principal, _tipo: tipo, _operadores: operadores, _amostra: amostra,
      });
      if (error) {
        if (tabelaAusente(error) || error.code === '42883' || error.code === 'PGRST202') { semTabela('alertar'); return null; }
        throw error;
      }
      const linha = (Array.isArray(data) ? data[0] : data) as { alerta_id: string; contagem: number; novo: boolean } | undefined;
      return linha ?? null;
    },
    async registros(f) {
      let q = db().from('mcp_assinaturas_log').select(COL_LOG).gte('created_at', f.desde);
      if (f.principal) q = q.eq('principal', f.principal);
      if (f.operador) q = q.or(`operador_declarado.eq.${f.operador},operador_efetivo.eq.${f.operador}`);
      const { data, error } = await q.order('created_at', { ascending: false }).limit(f.limite);
      if (error) {
        if (tabelaAusente(error)) { semTabela('registros'); return null; }
        throw new ErroDaFerramenta('falha_no_banco', 'A auditoria das assinaturas não respondeu agora.', 'Tente de novo em instantes.', true);
      }
      return (data ?? []) as LinhaDeAssinatura[];
    },
    async alertas(f) {
      let q = db().from('mcp_alertas_assinatura')
        .select('hora, principal, tipo, operadores, contagem, primeira_em, ultima_em, amostra, status').gte('hora', f.desde);
      if (f.principal) q = q.eq('principal', f.principal);
      if (f.tipo) q = q.eq('tipo', f.tipo);
      if (f.operador) q = q.contains('operadores', [f.operador]);
      const { data, error } = await q.order('hora', { ascending: false }).order('ultima_em', { ascending: false }).limit(f.limite);
      if (error) {
        if (tabelaAusente(error)) { semTabela('alertas'); return null; }
        throw new ErroDaFerramenta('falha_no_banco', 'Os alertas de assinatura não responderam agora.', 'Tente de novo em instantes.', true);
      }
      return (data ?? []) as AlertaDeAssinatura[];
    },
  };
}

// ─── A ferramenta ───────────────────────────────────────────────

export const FERRAMENTAS_DA_AUDITORIA_DE_ASSINATURAS: readonly ToolDefinition[] = [
  {
    name: 'aceleriq_auditoria_assinaturas_listar',
    title: 'Auditoria: quem assinou como quem',
    description:
      'Só leitura. O rastro das assinaturas dos agentes: em cada chamada do Escritório e de escrita com operator, o operador DECLARADO e o EFETIVO, a decisão (ok, fora_dos_vinculos, sem_operator, vinculos_indisponiveis...), user-agent, IP e o começo do hash da sessão MCP. Traz os alertas agrupados por hora, credencial e tipo (fora_dos_vinculos, vinculos_indisponiveis, operadores_com_sinais_diferentes), o resumo por credencial (operadores, chamadas, user-agents, IPs distintos) e os últimos registros. A credencial compartilhada não impede um agente de assinar como outro: isto é log e alerta, não bloqueio. Nunca devolve segredo.',
    scopes: ['aceleriq:read'],
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        horas: { type: 'integer', minimum: 1, maximum: 168, description: 'Janela em horas. Padrão 24.' },
        principal: { type: 'string', description: 'Só uma credencial ("key:<id>" ou "oauth:<client>").' },
        operador: { type: 'string', description: 'Só um operador (declarado ou efetivo).' },
        tipo: { type: 'string', enum: [...TIPOS], description: 'Só um tipo de alerta.' },
        so_alertas: { type: 'boolean', description: 'true omite os últimos registros.' },
        limite: { type: 'integer', minimum: 1, maximum: 200, description: 'Padrão 50 (alertas e últimos).' },
      },
    },
    handler: (input) => listarAssinaturas(input, portaDoBancoDeAuditoria()),
  },
];
