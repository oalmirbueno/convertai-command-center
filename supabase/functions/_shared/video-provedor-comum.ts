/**
 * Peças comuns dos executores de vídeo por provedor (frente V-C, 26/09/2026).
 *
 * Cada provedor (fal, Runway, Higgsfield, HeyGen) tem o seu arquivo
 * `video-provedor-*.ts` com a MESMA interface: enviar, consultar, buscar o
 * resultado e, quando o provedor deixa, cancelar. O executor
 * (`video-executor.ts`) escolhe pelo `provedor` do motor e a função
 * `mesa-videos` usa só a interface.
 *
 * Regras de todos:
 * - SEM LAÇO e SEM nova tentativa: cada função faz UMA chamada. Erro sobe com
 *   uma frase clara (sem crédito, chave inválida, conteúdo recusado, limite de
 *   uso, parâmetros) e fica registrado no pedido; nada é cobrado.
 * - A chave chega por parâmetro (a função lê o segredo do Supabase; o teste
 *   passa uma falsa). Nenhuma mensagem ecoa a chave nem o corpo inteiro.
 * - URL de consulta sempre montada a partir do número do pedido (nunca de um
 *   endereço guardado), para a chave só ir ao host do provedor.
 *
 * Puro: sem Deno e sem banco (a tela e os testes importam).
 */

export type Buscar = typeof fetch;

export const TIMEOUT_DO_PROVEDOR_MS = 20_000;

export interface Credenciais {
  chave: string;
  /** Segundo segredo quando o provedor pede par (Higgsfield). */
  segredo?: string | null;
  fetchImpl?: Buscar;
}

export interface EnviadoAoProvedor {
  request_id: string;
  status_url: string;
  response_url: string;
}

/** O que a consulta guarda de um envio (o mesmo formato do pedido no banco). */
export interface RefDoEnvio {
  request_id: string;
  status_url: string;
  response_url: string;
  endpoint: string;
}

export type EstadoNoProvedor = "fila" | "gerando" | "pronto" | "erro";

export interface SituacaoNoProvedor {
  estado: EstadoNoProvedor;
  posicao: number | null;
  erro: string | null;
  /** 0 a 1, quando o provedor informa. */
  progresso?: number | null;
  /** Duração real do vídeo pronto (HeyGen cobra pela duração). */
  duracao_s?: number | null;
}

export interface ResultadoDoProvedor {
  tipo: "video" | "imagem";
  urls: string[];
  /** Versão com a legenda gravada no vídeo (HeyGen). */
  legendado_url?: string | null;
  /** Miniatura pronta do provedor (imagem). */
  miniatura_url?: string | null;
  duracao_s?: number | null;
}

export interface ExecutorDoProvedor {
  provedor: string;
  rotulo: string;
  enviar(endpoint: string, corpo: Record<string, unknown>, c: Credenciais, o?: { idempotencia?: string | null }): Promise<EnviadoAoProvedor>;
  consultar(e: RefDoEnvio, c: Credenciais): Promise<SituacaoNoProvedor>;
  resultado(e: RefDoEnvio, c: Credenciais): Promise<ResultadoDoProvedor>;
  /** true = cancelado; false = o provedor não deixou (já começou). Ausente = provedor sem cancelamento. */
  cancelar?: (e: RefDoEnvio, c: Credenciais) => Promise<boolean>;
}

export type TipoDoErroDoProvedor = "chave_invalida" | "sem_credito" | "conteudo_recusado" | "limite_de_uso" | "parametros" | "indisponivel" | "rede" | "prazo" | "provedor";

/** Erro do provedor já com a frase para a tela e o tipo (para o teste e o registro). */
export class ErroDoProvedor extends Error {
  tipo: TipoDoErroDoProvedor;
  status: number;
  constructor(tipo: TipoDoErroDoProvedor, mensagem: string, status = 0) {
    super(mensagem);
    this.name = "ErroDoProvedor";
    this.tipo = tipo;
    this.status = status;
  }
}

/** Frase curta do erro (sem travessão, sem a chave). `chaves` = só o NOME dos segredos. */
export function fraseDoErro(tipo: TipoDoErroDoProvedor, provedor: string, chaves: string, detalhe?: string | null): string {
  const d = detalhe ? String(detalhe).replace(/\s+/g, " ").trim().slice(0, 200) : "";
  switch (tipo) {
    case "chave_invalida":
      return `${provedor} recusou a chave (conferir ${chaves}).`;
    case "sem_credito":
      return `Sem crédito na conta da ${provedor}. Recarregue lá e gere de novo.`;
    case "conteudo_recusado":
      return `${provedor} recusou o conteúdo (moderação)${d ? `: ${d}` : "."}`;
    case "limite_de_uso":
      return `${provedor} pediu para esperar (limite de uso)${d ? `: ${d}` : "."}`;
    case "parametros":
      return `${provedor} recusou os parâmetros${d ? `: ${d}` : "."}`;
    case "indisponivel":
      return `${provedor} está indisponível agora${d ? `: ${d}` : "."} Tente mais tarde.`;
    case "rede":
      return "Falha de rede com o provedor.";
    case "prazo":
      return "O provedor não respondeu a tempo.";
    default:
      return `Erro do provedor ${provedor}${d ? `: ${d}` : "."}`;
  }
}

/** Uma chamada JSON com prazo. Nunca repete. */
export async function pedirJson(f: Buscar, url: string, init: RequestInit, timeoutMs = TIMEOUT_DO_PROVEDOR_MS): Promise<{ status: number; corpo: Record<string, unknown> | null }> {
  let r: Response;
  // AbortSignal.timeout existe no Deno; onde não existe (testes), vai sem prazo.
  const A = AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal };
  const sinal = typeof A.timeout === "function" ? A.timeout(timeoutMs) : undefined;
  try {
    r = await f(url, { ...init, signal: sinal });
  } catch (e) {
    const nome = e instanceof Error ? e.name : "";
    if (nome === "TimeoutError" || nome === "AbortError") throw new ErroDoProvedor("prazo", fraseDoErro("prazo", "", ""));
    throw new ErroDoProvedor("rede", fraseDoErro("rede", "", ""));
  }
  const texto = await r.text().catch(() => "");
  let corpo: Record<string, unknown> | null = null;
  try {
    const j = texto ? JSON.parse(texto) : null;
    corpo = j && typeof j === "object" ? (Array.isArray(j) ? { data: j } : (j as Record<string, unknown>)) : null;
  } catch {
    corpo = null;
  }
  return { status: r.status, corpo };
}

/** Texto do detalhe do erro nos formatos mais comuns (detail, error, message, issues). */
export function detalheDoCorpo(corpo: Record<string, unknown> | null): string {
  if (!corpo) return "";
  const pegar = (v: unknown): string => {
    if (!v) return "";
    if (typeof v === "string") return v;
    if (Array.isArray(v) && v.length) {
      const x = v[0] as Record<string, unknown>;
      if (x && typeof x === "object") {
        const onde = Array.isArray(x.loc) ? (x.loc as unknown[]).join(".") : Array.isArray(x.path) ? (x.path as unknown[]).join(".") : "";
        const msg = String(x.msg || x.message || "");
        return [onde, msg].filter(Boolean).join(": ");
      }
      return String(v[0]);
    }
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      return String(o.message || o.msg || o.code || "");
    }
    return "";
  };
  const principal = pegar(corpo.detail) || pegar(corpo.error) || pegar(corpo.message) || pegar(corpo.failure);
  const extra = pegar(corpo.issues);
  return [principal, extra].filter(Boolean).join(" · ").slice(0, 300);
}

/** Código do erro quando o provedor manda (`error.code`). */
export function codigoDoCorpo(corpo: Record<string, unknown> | null): string {
  const e = corpo && corpo.error;
  if (e && typeof e === "object" && typeof (e as { code?: unknown }).code === "string") return String((e as { code: string }).code);
  if (corpo && typeof corpo.code === "string") return String(corpo.code);
  return "";
}

/** Tira vazios (undefined, null, "", lista vazia) do corpo. `false` e 0 ficam. */
export function semVazios(o: Record<string, unknown>): Record<string, unknown> {
  const s: Record<string, unknown> = {};
  Object.keys(o).forEach((k) => {
    const v = o[k];
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) return;
    s[k] = v;
  });
  return s;
}

/** Número do pedido seguro para ir na URL (letras, números, hífen e sublinhado). */
export function idDoPedidoSeguro(id: unknown): string {
  const s = String(id || "");
  return /^[A-Za-z0-9_-]{4,128}$/.test(s) ? s : "";
}

export const soHttps = (u: unknown): string => (typeof u === "string" && /^https:\/\//.test(u) ? u : "");

/** Primeiro número finito entre os valores (ou null). */
export function numeroOuNulo(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}
