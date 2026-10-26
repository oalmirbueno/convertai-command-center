/**
 * MCP 2.19 (26/10/2026): quem assina é a credencial que chama.
 *
 * Diagnóstico de 26/10: o MCP aceitava `operator` livre, então qualquer chave assinava como qualquer
 * agente (a chave do Hermes escreveu como "paperclip" e "gestor-trafego"; as do Paperclip, como
 * "default"). Agora a escrita assinada só aceita operador ligado à credencial (tabela
 * operator_key_bindings, migration 20261026120000). Fora disso, grava como o operador padrão da
 * credencial e avisa; credencial sem nenhum operador ligado não assina.
 *
 * Vale para toda ferramenta de escrita com `operator` na entrada. O diário e o checklist só contam
 * como escrita quando escrevem (body; add/check): ler com outro operator continua livre.
 */

import { db } from '../../_shared/aceleriq-read-services.ts';

export interface VinculoDaChave {
  operator_slug: string;
  padrao: boolean;
}

export type DecisaoDeAutoria =
  | { tipo: 'livre' }
  | { tipo: 'ok'; operador: string }
  | { tipo: 'trocado'; operador: string; pedido: string; aviso: string }
  | { tipo: 'recusado'; erro: string };

/** 'key:<api_keys.id>' ou 'oauth:<client_id>'. O OAuth leva o client no origin ("oauth:<client>:<sub>"). */
export function principalDaChamada(ctx: { keyId: string; origin: string | null }): string {
  const id = String(ctx.keyId ?? '');
  if (id.startsWith('oauth:')) {
    const m = /^oauth:([^:]+):/.exec(String(ctx.origin ?? ''));
    return m && m[1] !== 'user' ? `oauth:${m[1]}` : id;
  }
  return `key:${id}`;
}

const slug = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

/** A chamada assina como um operador? Só escrita; diário e checklist só quando escrevem. */
export function assinaComoOperador(nome: string, args: Record<string, unknown>, somenteLeitura: boolean): boolean {
  if (somenteLeitura || !slug(args.operator)) return false;
  if (nome === 'aceleriq_operator_diary') return typeof args.body === 'string' && args.body.trim() !== '';
  if (nome === 'aceleriq_operator_checklist') {
    return (Array.isArray(args.add) && args.add.length > 0) || (Array.isArray(args.check) && args.check.length > 0);
  }
  return true;
}

/** A regra, sem banco: vínculos da credencial (null = tabela ainda não existe) e o operador pedido. */
export function decidirAutoria(vinculos: VinculoDaChave[] | null, pedido: string): DecisaoDeAutoria {
  if (vinculos === null) return { tipo: 'livre' };
  const p = slug(pedido);
  if (vinculos.some((v) => v.operator_slug === p)) return { tipo: 'ok', operador: p };
  const padrao = vinculos.find((v) => v.padrao) ?? (vinculos.length === 1 ? vinculos[0] : null);
  if (!padrao) {
    return {
      tipo: 'recusado',
      erro: vinculos.length
        ? `"${p}" não está ligado a esta credencial e ela não tem operador padrão. Assine com um destes: ${vinculos.map((v) => v.operator_slug).join(', ')}.`
        : 'Esta credencial não tem operadores ligados, então não assina como agente. Peça ao dono para ligar os operadores dela no painel (operator_key_bindings).',
    };
  }
  return {
    tipo: 'trocado',
    operador: padrao.operator_slug,
    pedido: p,
    aviso: `"${p}" não é operador desta credencial: registrado como "${padrao.operator_slug}". Cada credencial assina só pelos próprios agentes.`,
  };
}

const CACHE_MS = 60_000;
const cache = new Map<string, { em: number; vinculos: VinculoDaChave[] | null }>();

export function esquecerVinculos(principal?: string) {
  if (principal) cache.delete(principal);
  else cache.clear();
}

/** Vínculos da credencial, com cache de 1 min. Tabela ausente (migration não aplicada) = null = livre. */
export async function vinculosDaChave(principal: string, banco = db()): Promise<VinculoDaChave[] | null> {
  const guardado = cache.get(principal);
  if (guardado && Date.now() - guardado.em < CACHE_MS) return guardado.vinculos;
  const { data, error } = await banco.from('operator_key_bindings')
    .select('operator_slug, padrao').eq('principal', principal).limit(200);
  let vinculos: VinculoDaChave[] | null;
  if (error) {
    // Sem a tabela, o comportamento antigo segue; outro erro não pode derrubar a escrita do agente.
    console.error('[mcp autoria] leitura dos vinculos falhou', { code: (error as { code?: string }).code });
    vinculos = null;
  } else {
    vinculos = ((data ?? []) as Array<Record<string, unknown>>)
      .map((r) => ({ operator_slug: slug(r.operator_slug), padrao: r.padrao === true }));
  }
  cache.set(principal, { em: Date.now(), vinculos });
  return vinculos;
}

export interface Autoria {
  args: unknown;
  aviso?: string;
  erro?: string;
}

/** Antes da ferramenta: confere (e troca, se preciso) o operador que assina. */
export async function prepararAutoria(
  tool: { name: string; annotations?: Record<string, unknown> },
  args: unknown,
  ctx: { keyId: string; origin: string | null },
  carregar: (principal: string) => Promise<VinculoDaChave[] | null> = vinculosDaChave,
): Promise<Autoria> {
  const entrada = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : null;
  if (!entrada || !assinaComoOperador(tool.name, entrada, tool.annotations?.readOnlyHint === true)) return { args };
  const decisao = decidirAutoria(await carregar(principalDaChamada(ctx)), String(entrada.operator));
  if (decisao.tipo === 'recusado') return { args, erro: decisao.erro };
  if (decisao.tipo === 'trocado') return { args: { ...entrada, operator: decisao.operador }, aviso: decisao.aviso };
  if (decisao.tipo === 'ok') return { args: { ...entrada, operator: decisao.operador } };
  return { args };
}

/**
 * Depois de cadastrar um operador, ele fica ligado à credencial que o cadastrou (se ela já tem
 * vínculos). Assim o elenco continua sendo dado: o Hermes cadastra e já assina pelo novo agente.
 */
export async function depoisDaAutoria(
  nome: string,
  args: unknown,
  ctx: { keyId: string; origin: string | null },
  deuCerto: boolean,
  banco = db(),
): Promise<void> {
  if (!deuCerto || nome !== 'aceleriq_operator_register') return;
  const novo = slug((args as Record<string, unknown> | null)?.slug);
  if (!/^[a-z][a-z0-9-]{1,38}$/.test(novo)) return;
  const principal = principalDaChamada(ctx);
  const vinculos = await vinculosDaChave(principal, banco);
  if (!vinculos || !vinculos.length || vinculos.some((v) => v.operator_slug === novo)) return;
  const { error } = await banco.from('operator_key_bindings')
    .upsert({ principal, operator_slug: novo, rotulo: 'cadastrado por esta credencial' }, { onConflict: 'principal,operator_slug', ignoreDuplicates: true });
  if (error) console.error('[mcp autoria] vinculo do operador novo nao gravado', { code: (error as { code?: string }).code });
  esquecerVinculos(principal);
}

/** O aviso entra no resultado da ferramenta (texto e structuredContent). */
export function anexarAviso(result: Record<string, unknown>, aviso: string): Record<string, unknown> {
  const sc = result.structuredContent && typeof result.structuredContent === 'object' && !Array.isArray(result.structuredContent)
    ? { ...(result.structuredContent as Record<string, unknown>), aviso_de_autoria: aviso }
    : { aviso_de_autoria: aviso };
  const content = Array.isArray(result.content) ? [...result.content, { type: 'text', text: `Aviso: ${aviso}` }] : [{ type: 'text', text: `Aviso: ${aviso}` }];
  return { ...result, content, structuredContent: sc };
}
