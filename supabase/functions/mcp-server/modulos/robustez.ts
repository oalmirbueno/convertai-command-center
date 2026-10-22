/**
 * MCP 2.17 (22/10/2026): o servidor não cai e não trava por causa de uma ferramenta.
 *
 * Pedido do dono: "sem cair e sem falhar, muito veloz na leitura, leve, liso e poderoso".
 * Este arquivo junta as regras puras (sem banco, sem rede) que o despachante aplica em TODA
 * chamada de ferramenta:
 *
 * - prazo por ferramenta: leitura 30 s, escrita 120 s (abaixo do corte de 150 s da plataforma); ação longa (fôlego) fica com o prazo da
 *   própria mesa. Estourou, a resposta sai na hora dizendo o que fazer, e o isolate segue vivo;
 * - nova tentativa com recuo SÓ em erro transitório (rede, 502/503/504, PGRST000-002, conexão do
 *   Postgres) e SÓ em ferramenta de leitura. Nunca em 40001/40P01: a memória de 26/09 e 19/10
 *   mostrou que repetir conflito em laço derruba o banco (aceleriq-banco-saturado-hermes);
 * - erro claro: código curto, mensagem em português, dica do próximo passo e se vale repetir;
 * - validação leve da entrada contra o inputSchema antes de tocar no banco;
 * - registro leve de falhas na memória do isolate (as últimas 50 e a contagem por ferramenta),
 *   além do mcp_audit_log de sempre.
 *
 * Sem import de Deno: os testes (deno test e vitest) leem o mesmo arquivo.
 */

export const PRAZO_LEITURA_MS = 30_000;
export const PRAZO_ESCRITA_MS = 120_000;
/** Duas novas tentativas no máximo (três chamadas), com recuo curto e um pouco de acaso. */
export const RECUOS_MS = [200, 700] as const;

export class ErroDaFerramenta extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
    readonly dica: string | null = null,
    readonly transitorio = false,
  ) {
    super(mensagem);
    this.name = 'ErroDaFerramenta';
  }
}

type Objeto = Record<string, unknown>;
const obj = (v: unknown): Objeto | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Objeto) : null);

function textoDoErro(e: unknown): string {
  if (e instanceof Error) return e.message ?? '';
  const o = obj(e);
  if (o && typeof o.message === 'string') return o.message;
  return String(e ?? '');
}

/** Códigos do Postgres/PostgREST que se resolvem esperando um pouco (conexão, banco reiniciando). */
const CODIGOS_TRANSITORIOS = new Set([
  'PGRST000', 'PGRST001', 'PGRST002', 'PGRST003',
  '57P01', '57P02', '57P03', '53300', '53400',
  '08000', '08001', '08003', '08004', '08006',
]);

/** Nunca repetir: conflito (40001/40P01), dado errado, permissão, ação da mesa (pode ter rodado). */
const NUNCA_REPETIR = /\b(40001|40P01|serializ|deadlock|CENTRAL_|versao_mudou|ja_decidido|Invalid input|Entrada inv|must be|outside this MCP|write:forbidden|not found|não existe|nao existe|duplicate key|23505|mesa:)/i;

const TEXTO_TRANSITORIO = /(fetch failed|network|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|socket hang up|connection (reset|refused|closed|terminated)|Connection terminated|upstream connect|temporarily unavailable|Service Unavailable|Bad Gateway|Gateway Time-?out|\b50[234]\b|PGRST00[0-3]|schema cache|too many connections|server closed the connection|the database system is (starting|shutting))/i;

/**
 * O erro passa se esperar um pouco? Só os de infraestrutura. Conflito de versão (40001),
 * entrada inválida, permissão e recusa de mesa NUNCA são transitórios aqui.
 */
export function ehTransitorio(e: unknown): boolean {
  if (e instanceof ErroDaFerramenta) return e.transitorio;
  const o = obj(e);
  const codigo = o && typeof o.code === 'string' ? o.code : '';
  const texto = textoDoErro(e);
  if (codigo === '40001' || codigo === '40P01' || NUNCA_REPETIR.test(texto)) return false;
  if (CODIGOS_TRANSITORIOS.has(codigo)) return true;
  const status = o && typeof o.status === 'number' ? o.status : 0;
  if (status === 502 || status === 503 || status === 504 || status === 429) return true;
  if (e instanceof Error && (e.name === 'TypeError' && /fetch|network/i.test(texto))) return true;
  return TEXTO_TRANSITORIO.test(texto);
}

const dormirDeVerdade = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Repete `fazer` em erro transitório, com recuo (200 ms, 700 ms + acaso), sem passar do prazo
 * final. Erro não transitório sai na primeira vez, intacto.
 */
export async function comNovaTentativa<T>(
  fazer: (tentativa: number) => Promise<T>,
  opcoes: { recuosMs?: readonly number[]; ate?: number; dormir?: (ms: number) => Promise<void>; agora?: () => number; aoRepetir?: (tentativa: number, erro: unknown) => void } = {},
): Promise<T> {
  const recuos = opcoes.recuosMs ?? RECUOS_MS;
  const dormir = opcoes.dormir ?? dormirDeVerdade;
  const agora = opcoes.agora ?? Date.now;
  let tentativa = 0;
  while (true) {
    try {
      return await fazer(tentativa);
    } catch (e) {
      const recuo = recuos[tentativa];
      if (recuo === undefined || !ehTransitorio(e)) throw e;
      const espera = recuo + Math.floor(Math.random() * Math.max(1, recuo / 4));
      // Sem tempo para esperar e tentar de novo com folga: devolve o erro de verdade.
      if (opcoes.ate !== undefined && agora() + espera + 1_000 > opcoes.ate) throw e;
      opcoes.aoRepetir?.(tentativa + 1, e);
      await dormir(espera);
      tentativa++;
    }
  }
}

/**
 * Corre `fazer` com prazo. Estourou: rejeita com ErroDaFerramenta('tempo_esgotado'), e o trabalho
 * de fundo segue sozinho (leitura) sem segurar a resposta. O relógio é sempre limpo.
 */
export async function comPrazo<T>(fazer: () => Promise<T>, ms: number, oQue: string, escrita = false): Promise<T> {
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const estouro = new Promise<never>((_, rejeitar) => {
    relogio = setTimeout(() => rejeitar(new ErroDaFerramenta(
      'tempo_esgotado',
      `${oQue} passou de ${Math.round(ms / 1000)} s e a resposta foi encerrada para não travar.`,
      escrita
        ? 'A ação pode ter terminado do outro lado: confira pela leitura (ou no painel) ANTES de repetir. Repetir com a mesma idempotency_key é seguro.'
        : 'Peça menos de uma vez (limite menor, filtro por cliente ou período) ou tente de novo em instantes.',
      !escrita,
    )), ms);
  });
  try {
    return await Promise.race([fazer(), estouro]);
  } finally {
    if (relogio !== undefined) clearTimeout(relogio);
  }
}

export interface FerramentaComPrazo {
  name: string;
  longRunning?: boolean;
  prazoMs?: number;
  annotations?: Record<string, unknown>;
}

export function ehLeitura(t: FerramentaComPrazo): boolean {
  return t.annotations?.readOnlyHint === true;
}

/** Prazo da ferramenta. Null: ação longa, que já responde com fôlego e tem o prazo da mesa. */
export function prazoDaFerramenta(t: FerramentaComPrazo): number | null {
  if (typeof t.prazoMs === 'number' && t.prazoMs > 0) return t.prazoMs;
  if (t.longRunning) return null;
  return ehLeitura(t) ? PRAZO_LEITURA_MS : PRAZO_ESCRITA_MS;
}

export interface ErroExplicado {
  codigo: string;
  mensagem: string;
  dica: string | null;
  transitorio: boolean;
}

/**
 * Transforma qualquer erro em algo que o agente entende e sabe o que fazer. A mensagem original
 * segue (já era o texto que o handler escolheu), mas ganha código e dica.
 */
export function explicarErro(e: unknown, ferramenta: string): ErroExplicado {
  if (e instanceof ErroDaFerramenta) return { codigo: e.codigo, mensagem: e.message, dica: e.dica, transitorio: e.transitorio };
  const texto = textoDoErro(e).slice(0, 1500) || 'Falha sem mensagem.';
  const transitorio = ehTransitorio(e);
  if (/^Invalid input|Entrada inv/i.test(texto)) {
    return { codigo: 'entrada_invalida', mensagem: texto, dica: `Confira os campos no inputSchema de ${ferramenta} (aceleriq_guia com ferramenta="${ferramenta}" mostra o manual).`, transitorio: false };
  }
  const mesa = /^mesa:([a-z_0-9]+)\s/.exec(texto);
  if (mesa) {
    const codigo = mesa[1];
    const dicaDaMesa = codigo === 'exige_oauth' || codigo === 'dono_da_chave'
      ? 'Conecte pelo OAuth com a conta de uma pessoa da equipe ou faça a ação no painel.'
      : codigo === 'tempo_esgotado'
        ? 'A ação pode ter terminado do outro lado: confira pela leitura da mesa antes de repetir.'
        : codigo === 'confirmar_custo'
          ? 'A ação tem custo: repita com confirmar_custo=true depois de avisar o dono do valor.'
          : null;
    return { codigo: `mesa_${codigo}`, mensagem: texto.replace(/^mesa:[a-z_0-9]+\s/, ''), dica: dicaDaMesa, transitorio: codigo === 'rede' };
  }
  if (/UUID|must be a real calendar date|must be/i.test(texto)) {
    return { codigo: 'entrada_invalida', mensagem: texto, dica: 'Ids são UUID (copie de uma leitura) e datas são AAAA-MM-DD.', transitorio: false };
  }
  if (/Not a client|not found|não existe|nao existe|não encontrad/i.test(texto)) {
    return { codigo: 'nao_encontrado', mensagem: texto, dica: 'Confira o id numa leitura (aceleriq_list_clients, aceleriq_panorama_do_cliente).', transitorio: false };
  }
  if (/\b40001\b|40P01|versao_mudou|ja_decidido|conflit/i.test(texto)) {
    return { codigo: 'conflito', mensagem: texto, dica: 'O registro mudou ou já foi decidido. Leia de novo antes de agir; não repita em laço.', transitorio: false };
  }
  if (/Query timeout|statement timeout|57014|canceling statement/i.test(texto)) {
    return { codigo: 'consulta_lenta', mensagem: texto, dica: 'Peça menos de uma vez (limite menor, filtro por cliente ou período).', transitorio: true };
  }
  if (transitorio) {
    return { codigo: 'indisponivel', mensagem: texto, dica: 'O banco ou a rede oscilou. Espere alguns segundos e tente de novo uma vez.', transitorio: true };
  }
  return { codigo: 'falha_da_ferramenta', mensagem: texto, dica: null, transitorio: false };
}

// ─── Validação leve da entrada ──────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tipoQueChegou(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'lista';
  return typeof v;
}

function confereValor(nome: string, esquema: Objeto, v: unknown, problemas: string[]) {
  const tipos = Array.isArray(esquema.type) ? (esquema.type as unknown[]).map(String) : typeof esquema.type === 'string' ? [esquema.type] : [];
  if (v === null && (tipos.includes('null') || tipos.length === 0)) return;
  if (tipos.length) {
    const ok = tipos.some((t) => {
      if (t === 'string') return typeof v === 'string';
      if (t === 'number' || t === 'integer') return typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));
      if (t === 'boolean') return typeof v === 'boolean';
      if (t === 'array') return Array.isArray(v);
      if (t === 'object') return !!obj(v);
      if (t === 'null') return v === null;
      return true;
    });
    if (!ok) {
      problemas.push(`${nome}: esperava ${tipos.join(' ou ')}, chegou ${tipoQueChegou(v)}`);
      return;
    }
  }
  if (typeof v === 'string') {
    if (esquema.format === 'uuid' && !UUID.test(v)) problemas.push(`${nome}: precisa ser um UUID`);
    if (Array.isArray(esquema.enum) && !esquema.enum.includes(v)) {
      problemas.push(`${nome}: use um de ${(esquema.enum as unknown[]).slice(0, 12).join(', ')}`);
    }
  }
}

/**
 * Confere a entrada contra o inputSchema da ferramenta, de leve: objeto na raiz, campos
 * obrigatórios presentes, tipo de cada campo (número em texto passa, como o `limite` sempre
 * aceitou), UUID e lista fechada. O detalhe fino continua com o zod de cada ferramenta.
 * Devolve a lista de problemas (vazia = passou).
 */
export function validarEntrada(esquema: unknown, entrada: unknown): string[] {
  const e = obj(esquema);
  if (!e) return [];
  if (entrada !== undefined && entrada !== null && !obj(entrada)) {
    return [`os argumentos precisam ser um objeto JSON, chegou ${tipoQueChegou(entrada)}`];
  }
  const args = obj(entrada) ?? {};
  const problemas: string[] = [];
  const props = obj(e.properties) ?? {};
  const obrigatorios = Array.isArray(e.required) ? (e.required as unknown[]).map(String) : [];
  for (const campo of obrigatorios) {
    if (args[campo] === undefined || args[campo] === null || args[campo] === '') problemas.push(`${campo}: obrigatório`);
  }
  for (const [campo, valor] of Object.entries(args)) {
    if (valor === undefined) continue;
    const p = obj(props[campo]);
    if (p) confereValor(campo, p, valor, problemas);
  }
  return problemas;
}

// ─── Registro leve de falhas (por isolate) ─────────────────────

export interface FalhaRegistrada {
  ferramenta: string;
  codigo: string;
  em: string;
  ms: number;
  correlation_id: string | null;
}

interface Contagem { chamadas: number; falhas: number; ms_total: number; ms_max: number; de_cache: number; repeticoes: number }

const ULTIMAS = 50;

export class RegistroLeve {
  private readonly falhas: FalhaRegistrada[] = [];
  private readonly porFerramenta = new Map<string, Contagem>();
  readonly desde = new Date().toISOString();

  private contagem(ferramenta: string): Contagem {
    let c = this.porFerramenta.get(ferramenta);
    if (!c) {
      c = { chamadas: 0, falhas: 0, ms_total: 0, ms_max: 0, de_cache: 0, repeticoes: 0 };
      this.porFerramenta.set(ferramenta, c);
    }
    return c;
  }

  anotar(ferramenta: string, ok: boolean, ms: number, extra: { codigo?: string; correlationId?: string; deCache?: boolean; repeticoes?: number } = {}) {
    const c = this.contagem(ferramenta);
    c.chamadas++;
    c.ms_total += ms;
    c.ms_max = Math.max(c.ms_max, ms);
    if (extra.deCache) c.de_cache++;
    if (extra.repeticoes) c.repeticoes += extra.repeticoes;
    if (!ok) {
      c.falhas++;
      this.falhas.push({ ferramenta, codigo: extra.codigo ?? 'falha', em: new Date().toISOString(), ms, correlation_id: extra.correlationId ?? null });
      if (this.falhas.length > ULTIMAS) this.falhas.splice(0, this.falhas.length - ULTIMAS);
    }
  }

  resumo(limite = 15) {
    const ferramentas = [...this.porFerramenta.entries()]
      .map(([nome, c]) => ({ nome, chamadas: c.chamadas, falhas: c.falhas, ms_medio: Math.round(c.ms_total / Math.max(1, c.chamadas)), ms_max: c.ms_max, de_cache: c.de_cache, repeticoes: c.repeticoes }))
      .sort((a, b) => b.falhas - a.falhas || b.chamadas - a.chamadas)
      .slice(0, limite);
    const total = [...this.porFerramenta.values()].reduce((a, c) => ({ chamadas: a.chamadas + c.chamadas, falhas: a.falhas + c.falhas }), { chamadas: 0, falhas: 0 });
    return { desde: this.desde, ...total, ferramentas, ultimas_falhas: this.falhas.slice(-10).reverse() };
  }
}

export const registroDoMcp = new RegistroLeve();
