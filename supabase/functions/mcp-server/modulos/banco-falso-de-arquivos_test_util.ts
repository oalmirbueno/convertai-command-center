// MCP 2.38.0: banco de mentira para os testes de Arquivos (select/update com eq, is, in, maybeSingle).
// Não é teste (sem Deno.test): só apoio dos *_test.ts de carrossel, post da Agenda e envio.

import { auditPrincipalSelector, buildAuditInput, persistedAuditKeyId } from '../../_shared/mcp-security.ts';
import { type EscopoDeIdempotencia, filtroDeIdempotencia } from '../../_shared/mcp-write-services.ts';
import { executarFerramenta, type EntradaDaAuditoria } from './executar-ferramenta.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { CacheCurto } from './leitura-enxuta.ts';
import { RegistroLeve } from './robustez.ts';

export type Linha = Record<string, unknown>;
export type Tabelas = Record<string, Linha[]>;

export interface OpcoesDoBanco {
  /** UPDATE nestes ids não casa nenhuma linha (como se o estado tivesse mudado). */
  updateNaoCasa?: Set<string>;
  /** Erro de leitura nesta tabela. */
  leituraFalha?: string;
}

export interface BancoFalso {
  from(tabela: string): unknown;
  updates: Array<{ tabela: string; patch: Linha; ids: string[] }>;
}

export function bancoFalso(tabelas: Tabelas, opcoes: OpcoesDoBanco = {}): BancoFalso {
  const updates: BancoFalso['updates'] = [];
  return {
    updates,
    from(tabela: string) {
      const filtros: Array<(l: Linha) => boolean> = [];
      let patch: Linha | null = null;
      let limite: number | null = null;
      const q: Record<string, unknown> = {};
      const executar = () => {
        if (opcoes.leituraFalha === tabela && !patch) return { data: null, error: { message: 'falha simulada' } };
        const linhas = tabelas[tabela] ?? (tabelas[tabela] = []);
        let casadas = linhas.filter((l) => filtros.every((f) => f(l)));
        if (patch) {
          casadas = casadas.filter((l) => !opcoes.updateNaoCasa?.has(String(l.id)));
          for (const l of casadas) Object.assign(l, patch);
          updates.push({ tabela, patch: { ...patch }, ids: casadas.map((l) => String(l.id)) });
        }
        if (limite != null) casadas = casadas.slice(0, limite);
        return { data: casadas.map((l) => ({ ...l })), error: null };
      };
      q.select = () => q;
      q.update = (p: Linha) => { patch = p; return q; };
      q.eq = (c: string, v: unknown) => { filtros.push((l) => l[c] === v); return q; };
      q.neq = (c: string, v: unknown) => { filtros.push((l) => l[c] !== v); return q; };
      q.is = (c: string, v: unknown) => { filtros.push((l) => (l[c] ?? null) === v); return q; };
      q.in = (c: string, vs: unknown[]) => { filtros.push((l) => vs.includes(l[c])); return q; };
      q.order = () => q;
      q.limit = (n: number) => { limite = n; return q; };
      q.maybeSingle = () => Promise.resolve(executar()).then((r) => ({ data: (r.data as Linha[] | null)?.[0] ?? null, error: r.error }));
      q.then = (ok: (r: unknown) => unknown, falha?: (e: unknown) => unknown) => Promise.resolve(executar()).then(ok, falha);
      return q;
    },
  };
}

/** umaVez igual ao real: a mesma chave (com o escopo) não refaz. */
export function umaVezFalso() {
  const chaves = new Set<string>();
  return (async (
    ferramenta: string,
    _ctx: unknown,
    chave: string,
    fazer: () => Promise<{ ref: string | null; resultado: Record<string, unknown> }>,
    escopo?: Record<string, string>,
  ) => {
    const k = `${ferramenta}|${chave}|${JSON.stringify(escopo ?? {})}`;
    if (chaves.has(k)) return { ok: true, replay: true };
    const { resultado } = await fazer();
    chaves.add(k);
    return { ok: true, ...resultado };
  }) as never;
}

// ─── Trilha de auditoria como a real (P1-A da revisão do Codex, 20/11/2026) ───
// executarFerramenta audita TODA chamada que deu certo (simulação inclusive) com o input cru;
// umaVez procura em mcp_audit_log por ferramenta + principal + sucesso + sanitized_input @> filtro.
// Aqui as linhas nascem com buildAuditInput e o filtro com filtroDeIdempotencia (os mesmos do código real).

/** jsonb @> do Postgres: objeto contém as chaves (recursivo), array contém cada elemento, escalar igual. */
export function contemJsonb(a: unknown, b: unknown): boolean {
  if (Array.isArray(b)) return Array.isArray(a) && b.every((x) => a.some((y) => contemJsonb(y, x)));
  if (b && typeof b === 'object') {
    if (!a || typeof a !== 'object' || Array.isArray(a)) return false;
    return Object.entries(b as Linha).every(([k, v]) => k in (a as Linha) && contemJsonb((a as Linha)[k], v));
  }
  return a === b;
}

export function trilhaDeAuditoria() {
  const linhas: Array<{ correlation_id: string; tool_name: string; key_id: string | null; success: boolean; sanitized_input: unknown }> = [];
  const auditar = (e: EntradaDaAuditoria) => {
    linhas.push({
      correlation_id: e.correlationId,
      tool_name: e.toolName,
      key_id: persistedAuditKeyId(e.keyId),
      success: e.success,
      sanitized_input: buildAuditInput(e.input, e.keyId, e.resultRef),
    });
    return Promise.resolve();
  };
  const umaVez = (async (
    ferramenta: string,
    ctx: { keyId: string; resultRefHolder?: { value?: string } },
    chave: string,
    fazer: () => Promise<{ ref: string | null; resultado: Record<string, unknown> }>,
    escopo?: EscopoDeIdempotencia,
  ) => {
    const p = auditPrincipalSelector(ctx.keyId);
    const filtro = filtroDeIdempotencia(p.principal, chave, escopo);
    const anterior = [...linhas].reverse().find((l) =>
      l.tool_name === ferramenta && l.success && l.key_id === p.keyId && contemJsonb(l.sanitized_input, filtro)
    );
    if (anterior) return { ok: true, replay: true, idempotency_replay_of: anterior.correlation_id };
    const { ref, resultado } = await fazer();
    if (ref && ctx.resultRefHolder) ctx.resultRefHolder.value = ref;
    return { ok: true, ...resultado };
  }) as never;
  let n = 0;
  /** Roda a chamada pelo executarFerramenta de verdade (valida, executa, audita). */
  const chamar = async (nome: string, handler: (input: unknown, ctx: AuthContext) => Promise<unknown>, args: unknown, ctx: AuthContext) => {
    const r = await executarFerramenta(
      { name: nome, inputSchema: { type: 'object' }, annotations: { readOnlyHint: false }, handler },
      args,
      { ...ctx, correlationId: `corr-${++n}` },
      { auditar, ehForaDoEscopo: () => false, cache: new CacheCurto(), registro: new RegistroLeve() },
    );
    if (r.tipo !== 'ok') throw new Error('fora do escopo');
    const res = r.result as { structuredContent?: Record<string, unknown>; isError?: boolean };
    if (res.isError) throw new Error(JSON.stringify(res.structuredContent));
    return res.structuredContent!;
  };
  return { linhas, auditar, umaVez, chamar };
}
