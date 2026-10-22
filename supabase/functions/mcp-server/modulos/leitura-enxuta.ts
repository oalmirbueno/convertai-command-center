/**
 * MCP 2.17 (22/10/2026): leitura rápida e econômica.
 *
 * - CacheCurto: resposta de leitura guardada por poucos segundos POR CREDENCIAL (nunca entre
 *   pessoas), com "uma busca só em voo" (dois pedidos iguais ao mesmo tempo viram um no banco).
 *   Toda escrita bem-sucedida da mesma credencial limpa o que ela tinha guardado, para quem acabou
 *   de mudar algo nunca ler o antes.
 * - Cursor opaco de página (base64url) em vez de offset solto: o agente devolve `cursor` e recebe
 *   a próxima página; lê-se uma linha a mais para saber se existe próxima, sem COUNT.
 * - lerLinhas: select só com as colunas pedidas; se a tabela ainda não tem uma coluna (deploy de
 *   banco atrasado), refaz com `*` e recorta aqui, em vez de derrubar a ferramenta.
 * - enxuto: corta textos longos e listas grandes por padrão; `detalhe: "completo"` traz tudo.
 *
 * Sem import de Deno: deno test e vitest leem o mesmo arquivo.
 */

type Objeto = Record<string, unknown>;

// ─── Cache curto por credencial ─────────────────────────────────

interface Guardado { valor: unknown; ate: number; em: number }

function estavel(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'undefined';
  if (Array.isArray(v)) return `[${v.map(estavel).join(',')}]`;
  const o = v as Objeto;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${estavel(o[k])}`).join(',')}}`;
}

/** Chave do cache: credencial + ferramenta + argumentos em ordem estável. */
export function chaveDoCache(principal: string, ferramenta: string, args: unknown): string {
  return `${principal}\u0000${ferramenta}\u0000${estavel(args ?? {})}`;
}

export class CacheCurto {
  private readonly mapa = new Map<string, Guardado>();
  private readonly emVoo = new Map<string, Promise<unknown>>();
  constructor(private readonly maximo = 300, private readonly agora: () => number = Date.now) {}

  ler(chave: string): { valor: unknown; idadeMs: number } | null {
    const g = this.mapa.get(chave);
    if (!g) return null;
    if (g.ate <= this.agora()) {
      this.mapa.delete(chave);
      return null;
    }
    return { valor: g.valor, idadeMs: this.agora() - g.em };
  }

  guardar(chave: string, valor: unknown, ttlMs: number) {
    if (!(ttlMs > 0)) return;
    if (this.mapa.size >= this.maximo) {
      // Sai o mais antigo (Map guarda a ordem de entrada).
      const primeira = this.mapa.keys().next().value;
      if (primeira !== undefined) this.mapa.delete(primeira);
    }
    this.mapa.set(chave, { valor, ate: this.agora() + ttlMs, em: this.agora() });
  }

  /** Tudo da credencial sai (depois de uma escrita dela). */
  esquecerDoPrincipal(principal: string) {
    const prefixo = `${principal}\u0000`;
    for (const k of [...this.mapa.keys()]) if (k.startsWith(prefixo)) this.mapa.delete(k);
  }

  /** Lê do cache ou busca uma vez só (pedidos iguais simultâneos esperam a mesma busca). */
  async lerOuBuscar<T>(chave: string, ttlMs: number, buscar: () => Promise<T>): Promise<{ valor: T; deCache: boolean; idadeMs: number }> {
    const achado = this.ler(chave);
    if (achado) return { valor: achado.valor as T, deCache: true, idadeMs: achado.idadeMs };
    const voando = this.emVoo.get(chave);
    if (voando) return { valor: (await voando) as T, deCache: true, idadeMs: 0 };
    const p = buscar();
    this.emVoo.set(chave, p);
    try {
      const valor = await p;
      this.guardar(chave, valor, ttlMs);
      return { valor, deCache: false, idadeMs: 0 };
    } finally {
      this.emVoo.delete(chave);
    }
  }

  get tamanho() {
    return this.mapa.size;
  }
}

export const cacheDoMcp = new CacheCurto();

// ─── Cursor de página ───────────────────────────────────────────

function paraBase64Url(texto: string): string {
  const bytes = new TextEncoder().encode(texto);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function deBase64Url(texto: string): string {
  const b64 = texto.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((texto.length + 3) % 4);
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export const PAGINA_PADRAO = 20;
export const PAGINA_MAXIMA = 100;

/** Cursor opaco: posição da próxima página e uma marca da lista, para não misturar listas. */
export function criarCursor(posicao: number, lista: string): string {
  return paraBase64Url(JSON.stringify({ p: posicao, l: lista }));
}

/** Lê o cursor. Inválido ou de outra lista: erro claro (não volta silenciosamente ao início). */
export function lerCursor(cursor: unknown, lista: string): number {
  if (cursor === undefined || cursor === null || cursor === '') return 0;
  try {
    const o = JSON.parse(deBase64Url(String(cursor))) as { p?: unknown; l?: unknown };
    const p = Number(o.p);
    if (o.l !== lista || !Number.isInteger(p) || p < 0 || p > 100_000) throw new Error('x');
    return p;
  } catch {
    throw new Error('Invalid input: cursor inválido ou de outra lista. Comece sem cursor e use o `proximo_cursor` da resposta.');
  }
}

export function tamanhoDaPagina(limite: unknown, padrao = PAGINA_PADRAO, maximo = PAGINA_MAXIMA): number {
  const n = Number(limite);
  if (!Number.isFinite(n) || n <= 0) return padrao;
  return Math.min(Math.floor(n), maximo);
}

/** Recebe as linhas lidas com UMA a mais e devolve a página com o próximo cursor (ou null). */
export function pagina<T>(linhas: T[], posicao: number, tamanho: number, lista: string): { itens: T[]; proximo_cursor: string | null } {
  const temMais = linhas.length > tamanho;
  return { itens: linhas.slice(0, tamanho), proximo_cursor: temMais ? criarCursor(posicao + tamanho, lista) : null };
}

// ─── Enxuto por padrão ──────────────────────────────────────────

export type Detalhe = 'enxuto' | 'completo';

export function detalheDe(v: unknown): Detalhe {
  return v === 'completo' ? 'completo' : 'enxuto';
}

/** Corta texto longo com reticências (o completo vem com detalhe: "completo"). */
export function cortar(v: unknown, max = 280): string | null {
  if (typeof v !== 'string') return v === null || v === undefined ? null : String(v);
  const t = v.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Só os campos pedidos, na ordem pedida (o que não existe não aparece). */
export function escolher(linha: unknown, campos: readonly string[]): Objeto {
  const o = linha && typeof linha === 'object' ? (linha as Objeto) : {};
  const saida: Objeto = {};
  for (const c of campos) if (c in o) saida[c] = o[c];
  return saida;
}

// ─── Leitura que não cai por coluna nova ────────────────────────

interface ErroDoBanco { code?: string; message?: string }

const COLUNA_AUSENTE = (e: ErroDoBanco | null) => !!e && (e.code === '42703' || e.code === 'PGRST204' || /column .* does not exist/i.test(e.message ?? ''));
export const TABELA_AUSENTE = (e: ErroDoBanco | null) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /relation .* does not exist|Could not find the table/i.test(e.message ?? ''));

// deno-lint-ignore no-explicit-any
type Consulta = any;

/**
 * Lê com as colunas pedidas. Se a tabela ainda não tem alguma (migration não aplicada), refaz
 * com `*` e recorta aqui. Tabela que não existe vira lista vazia com aviso, nunca erro 500.
 * `montar` recebe a consulta já com o select e devolve com filtros, ordem e faixa.
 */
export async function lerLinhas(
  // deno-lint-ignore no-explicit-any
  cliente: { from: (t: string) => any },
  tabela: string,
  colunas: readonly string[],
  montar: (q: Consulta) => Consulta,
): Promise<{ linhas: Objeto[]; aviso: string | null }> {
  const primeira = await montar(cliente.from(tabela).select(colunas.join(', ')));
  if (!primeira.error) return { linhas: (primeira.data ?? []) as Objeto[], aviso: null };
  if (TABELA_AUSENTE(primeira.error)) return { linhas: [], aviso: `${tabela} ainda não existe neste banco.` };
  if (!COLUNA_AUSENTE(primeira.error)) {
    const e = new Error(`${tabela}: ${primeira.error.message ?? 'falha na leitura'}`) as Error & { code?: string };
    e.code = primeira.error.code;
    throw e;
  }
  const segunda = await montar(cliente.from(tabela).select('*'));
  if (segunda.error) {
    const e = new Error(`${tabela}: ${segunda.error.message ?? 'falha na leitura'}`) as Error & { code?: string };
    e.code = segunda.error.code;
    throw e;
  }
  return { linhas: ((segunda.data ?? []) as Objeto[]).map((l) => escolher(l, colunas)), aviso: `${tabela}: alguma coluna nova ainda não chegou ao banco; li o que existe.` };
}
