/**
 * MCP 2.17 (22/10/2026): o caminho de UMA chamada de ferramenta, do jeito que não cai.
 *
 * Ordem: valida a entrada (leve, contra o inputSchema) → cache curto (só leitura marcada, por
 * credencial) → prazo da ferramenta → nova tentativa com recuo (só leitura, só erro transitório)
 * → resultado. Escrita bem-sucedida limpa o cache da credencial. Toda chamada entra no registro
 * leve (aceleriq_mcp_saude) e no mcp_audit_log; a auditoria de LEITURA sai em segundo plano (não
 * segura a resposta), a de escrita continua esperada, porque a idempotência lê essa trilha.
 *
 * Erro de execução volta como resultado com isError (o agente lê e se corrige), com código,
 * mensagem, dica e se vale repetir. Fora do escopo do cliente continua erro de protocolo 403,
 * como sempre.
 */

import { chaveDoCache, cacheDoMcp, type CacheCurto } from './leitura-enxuta.ts';
import {
  comNovaTentativa,
  comPrazo,
  ehLeitura,
  explicarErro,
  prazoDaFerramenta,
  registroDoMcp,
  type RegistroLeve,
  validarEntrada,
} from './robustez.ts';

export interface FerramentaExecutavel {
  name: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  longRunning?: boolean;
  prazoMs?: number;
  cacheSeg?: number;
  handler: (input: unknown, ctx: any) => Promise<unknown>;
}

export interface EntradaDaAuditoria {
  correlationId: string;
  toolName: string;
  origin: string | null;
  keyId: string | null;
  scopes: string[] | null;
  input: unknown;
  success: boolean;
  statusCode: number;
  durationMs: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  resultRef?: string | null;
}

export interface Dependencias {
  auditar: (e: EntradaDaAuditoria) => Promise<void>;
  /** Roda depois de responder (EdgeRuntime.waitUntil quando existe). */
  emSegundoPlano?: (p: Promise<unknown>) => void;
  ehForaDoEscopo: (e: unknown) => boolean;
  cache?: CacheCurto;
  registro?: RegistroLeve;
  agora?: () => number;
}

export type Desfecho =
  | { tipo: 'ok'; result: Record<string, unknown> }
  | { tipo: 'fora_do_escopo' };

interface Contexto {
  keyId: string;
  origin: string | null;
  scopes: string[];
  correlationId?: string;
  resultRefHolder?: { value?: string };
}

/** EdgeRuntime.waitUntil quando roda na Supabase; senão, só deixa a promessa seguir com catch. */
export function segundoPlanoPadrao(p: Promise<unknown>) {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  const seguro = p.catch(() => {});
  if (rt?.waitUntil) rt.waitUntil(seguro);
}

export function resultadoDeErro(codigo: string, mensagem: string, dica: string | null, transitorio: boolean, correlationId: string): Record<string, unknown> {
  const erro = { codigo, mensagem, dica, transitorio, correlation_id: correlationId };
  const texto = `Erro (${codigo}): ${mensagem}${dica ? ` Próximo passo: ${dica}` : ''}${transitorio ? ' Pode tentar de novo em alguns segundos (uma vez).' : ''}`;
  return { content: [{ type: 'text', text: texto }], structuredContent: { ok: false, erro }, isError: true };
}

export async function executarFerramenta<C extends Contexto>(
  tool: FerramentaExecutavel,
  args: unknown,
  ctx: C,
  deps: Dependencias,
): Promise<Desfecho> {
  const agora = deps.agora ?? Date.now;
  const cache = deps.cache ?? cacheDoMcp;
  const registro = deps.registro ?? registroDoMcp;
  const correlationId = ctx.correlationId ?? crypto.randomUUID();
  const resultRefHolder: { value?: string } = ctx.resultRefHolder ?? {};
  const callCtx = { ...ctx, correlationId, resultRefHolder };
  const inicio = agora();
  const leitura = ehLeitura(tool);
  const base = { correlationId, toolName: tool.name, origin: ctx.origin, keyId: ctx.keyId, scopes: ctx.scopes, input: args };
  const auditar = (e: EntradaDaAuditoria) => {
    if (leitura && deps.emSegundoPlano) deps.emSegundoPlano(deps.auditar(e));
    else return deps.auditar(e);
  };

  const problemas = validarEntrada(tool.inputSchema, args);
  if (problemas.length) {
    const mensagem = `Entrada inválida: ${problemas.slice(0, 8).join('; ')}.`;
    registro.anotar(tool.name, false, agora() - inicio, { codigo: 'entrada_invalida', correlationId });
    await auditar({ ...base, success: false, statusCode: 400, durationMs: agora() - inicio, errorCode: 'entrada_invalida', errorMessage: mensagem });
    return { tipo: 'ok', result: resultadoDeErro('entrada_invalida', mensagem, `Confira os campos de ${tool.name} (aceleriq_guia com ferramenta="${tool.name}").`, false, correlationId) };
  }

  let repeticoes = 0;
  const prazo = prazoDaFerramenta(tool);
  const ate = prazo === null ? undefined : inicio + prazo;
  const rodar = () => leitura
    ? comNovaTentativa(() => tool.handler(args ?? {}, callCtx), { ate, aoRepetir: () => { repeticoes++; } })
    : tool.handler(args ?? {}, callCtx);
  const comLimite = () => (prazo === null ? rodar() : comPrazo(rodar, prazo, `A ferramenta ${tool.name}`, !leitura));

  try {
    let valor: unknown;
    let deCache = false;
    let idadeMs = 0;
    if (leitura && tool.cacheSeg && tool.cacheSeg > 0) {
      const r = await cache.lerOuBuscar(chaveDoCache(ctx.keyId, tool.name, args), tool.cacheSeg * 1000, comLimite);
      valor = r.valor;
      deCache = r.deCache;
      idadeMs = r.idadeMs;
    } else {
      valor = await comLimite();
    }
    if (!leitura) cache.esquecerDoPrincipal(ctx.keyId);
    const ms = agora() - inicio;
    registro.anotar(tool.name, true, ms, { deCache, repeticoes, correlationId });
    await auditar({ ...base, success: true, statusCode: 200, durationMs: ms, resultRef: resultRefHolder.value ?? null });
    return {
      tipo: 'ok',
      result: {
        content: [{ type: 'text', text: JSON.stringify(valor) }],
        structuredContent: valor as Record<string, unknown>,
        _meta: { 'aceleriq/ms': ms, 'aceleriq/de_cache': deCache, ...(deCache ? { 'aceleriq/idade_ms': idadeMs } : {}), ...(repeticoes ? { 'aceleriq/novas_tentativas': repeticoes } : {}) },
      },
    };
  } catch (e) {
    const ms = agora() - inicio;
    if (deps.ehForaDoEscopo(e)) {
      registro.anotar(tool.name, false, ms, { codigo: 'fora_do_escopo', correlationId });
      await auditar({ ...base, success: false, statusCode: 403, durationMs: ms, errorCode: 'data_scope_denied', errorMessage: (e as Error)?.message ?? String(e) });
      return { tipo: 'fora_do_escopo' };
    }
    const x = explicarErro(e, tool.name);
    registro.anotar(tool.name, false, ms, { codigo: x.codigo, correlationId, repeticoes });
    const status = x.codigo === 'entrada_invalida' ? 400 : x.codigo === 'nao_encontrado' ? 404 : x.codigo === 'conflito' ? 409 : x.codigo === 'tempo_esgotado' ? 504 : x.transitorio ? 503 : 500;
    await auditar({ ...base, success: false, statusCode: status, durationMs: ms, errorCode: x.codigo, errorMessage: x.mensagem });
    return { tipo: 'ok', result: resultadoDeErro(x.codigo, x.mensagem, x.dica, x.transitorio, correlationId) };
  }
}
