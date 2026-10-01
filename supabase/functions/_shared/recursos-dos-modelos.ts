/** Recursos dos modelos de texto lidos do OpenRouter (MOD, 30/09/2026), em ia_modelos.recursos. Puro. */

export interface RecursosDoModelo {
  ferramentas: boolean;
  json: boolean;
  esquema_estrito: boolean;
  visao: boolean;
  arquivos: boolean;
  audio_entrada: boolean;
  video_entrada: boolean;
  raciocinio_obrigatorio: boolean;
  raciocinio_padrao: string | null;
  verbosidade: boolean;
  busca_web_usd: number | null;
  cache_escrita_1m: number | null;
  cache_escrita_1h_1m: number | null;
  saida_max: number | null;
  lancado_em: string | null;
  expira_em: string | null;
  indice_inteligencia: number | null;
  fonte: "openrouter" | "manual";
}

export type ModeloOpenRouterBruto = {
  id?: string;
  name?: string;
  created?: number;
  context_length?: number;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  pricing?: Record<string, unknown>;
  top_provider?: { max_completion_tokens?: number | null } | null;
  supported_parameters?: string[];
  reasoning?: { supported_efforts?: string[]; mandatory?: boolean; default_effort?: string } | null;
  expiration_date?: string | null;
  alias_target?: unknown;
  benchmarks?: { artificial_analysis?: { intelligence_index?: number | null } | null } | null;
};

export const ORDEM_DO_RACIOCINIO = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

export const por1m = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1_000_000 * 1_000_000) / 1_000_000;
};

const numeroOuNulo = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const dataIso = (v: unknown): string | null => {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return new Date(v * 1000).toISOString().slice(0, 10);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
};

/** Apelido "~.../...-latest": muda de modelo (e de preço) sozinho, não entra no catálogo. */
export function ehApelidoDoOpenRouter(o: Pick<ModeloOpenRouterBruto, "id" | "alias_target">): boolean {
  return String(o.id ?? "").startsWith("~") || (o.alias_target != null && o.alias_target !== "");
}

/** Níveis de raciocínio que o modelo aceita, do menor para o maior. */
export function niveisDeRaciocinio(o: Pick<ModeloOpenRouterBruto, "reasoning" | "supported_parameters">): string[] {
  const esforcos = o.reasoning?.supported_efforts;
  if (Array.isArray(esforcos) && esforcos.length) return ORDEM_DO_RACIOCINIO.filter((n) => esforcos.includes(n));
  if ((o.supported_parameters ?? []).includes("reasoning_effort")) return ["low", "medium", "high"];
  return [];
}

export function recursosDoOpenRouter(o: ModeloOpenRouterBruto): RecursosDoModelo {
  const params = o.supported_parameters ?? [];
  const entrada = o.architecture?.input_modalities ?? [];
  const p = o.pricing ?? {};
  const r = o.reasoning ?? null;
  const niveis = niveisDeRaciocinio(o);
  const aa = o.benchmarks?.artificial_analysis?.intelligence_index;
  return {
    ferramentas: params.includes("tools"),
    json: params.includes("structured_outputs") || params.includes("response_format"),
    esquema_estrito: params.includes("structured_outputs"),
    visao: entrada.includes("image"),
    arquivos: entrada.includes("file"),
    audio_entrada: entrada.includes("audio"),
    video_entrada: entrada.includes("video"),
    raciocinio_obrigatorio: !!(r && r.mandatory === true),
    raciocinio_padrao: r && typeof r.default_effort === "string" && niveis.includes(r.default_effort) ? r.default_effort : null,
    verbosidade: params.includes("verbosity"),
    busca_web_usd: numeroOuNulo(p.web_search),
    cache_escrita_1m: por1m(p.input_cache_write),
    cache_escrita_1h_1m: por1m(p.input_cache_write_1h),
    saida_max: numeroOuNulo(o.top_provider?.max_completion_tokens ?? null),
    lancado_em: dataIso(o.created),
    expira_em: dataIso(o.expiration_date),
    indice_inteligencia: typeof aa === "number" && Number.isFinite(aa) ? aa : null,
    fonte: "openrouter",
  };
}
