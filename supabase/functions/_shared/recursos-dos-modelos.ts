/**
 * Recursos dos modelos de texto do catálogo (frente MOD, 30/09/2026).
 *
 * O OpenRouter publica em GET /api/v1/models, por modelo, o que ele aceita
 * (supported_parameters: tools, structured_outputs, response_format,
 * reasoning, verbosity), o que ele lê (architecture.input_modalities: image,
 * file, audio, video), o raciocínio (reasoning.supported_efforts, mandatory,
 * default_effort), o preço da busca web, da escrita de cache (5 min e 1 h), a
 * saída máxima e a data de lançamento (created). Antes só o preço e os níveis
 * de raciocínio entravam no catálogo; aqui entra o resto, na coluna
 * ia_modelos.recursos (migration 20260930220000_modelos_e_recursos.sql).
 *
 * Puro: sem Deno e sem banco. O ia-motor (sincronização), a tela
 * (SeletorDeModelo) e os testes usam o mesmo.
 */

export interface RecursosDoModelo {
  /** Chamada de ferramentas (tools / tool_choice). */
  ferramentas: boolean;
  /** Saída em JSON (response_format ou structured_outputs). */
  json: boolean;
  /** Esquema estrito (structured_outputs): o provedor garante o formato. */
  esquema_estrito: boolean;
  /** Lê imagem. */
  visao: boolean;
  /** Lê arquivo (PDF) direto. */
  arquivos: boolean;
  audio_entrada: boolean;
  video_entrada: boolean;
  /** Não dá para desligar o raciocínio (Claude 5.5, GPT-6.1 Sol): "none" não existe. */
  raciocinio_obrigatorio: boolean;
  /** Nível que o provedor usa quando o pedido não diz. */
  raciocinio_padrao: string | null;
  verbosidade: boolean;
  /** US$ por busca web do provedor (pricing.web_search), quando publicado. */
  busca_web_usd: number | null;
  /** US$ por 1M tokens escritos no cache de 5 min e de 1 h (Anthropic e afins). */
  cache_escrita_1m: number | null;
  cache_escrita_1h_1m: number | null;
  /** Saída máxima por chamada (top_provider.max_completion_tokens). */
  saida_max: number | null;
  /** Data de lançamento no OpenRouter (AAAA-MM-DD). */
  lancado_em: string | null;
  /** Data em que o provedor desliga o modelo, quando anunciada. */
  expira_em: string | null;
  /** Índice de inteligência da Artificial Analysis, quando o OpenRouter publica. */
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

const por1m = (v: unknown): number | null => {
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

/**
 * Apelido do OpenRouter ("~anthropic/claude-opus-latest" aponta sempre para o
 * mais novo da família). Não entra no catálogo: duplicaria o modelo de verdade
 * e trocaria de modelo (e de preço) sem o dono ver.
 */
export function ehApelidoDoOpenRouter(o: Pick<ModeloOpenRouterBruto, "id" | "alias_target">): boolean {
  const slug = String(o.id ?? "");
  return slug.startsWith("~") || (o.alias_target != null && o.alias_target !== "");
}

/** Níveis de raciocínio que o modelo aceita, na ordem do menor para o maior. */
export function niveisDeRaciocinio(o: Pick<ModeloOpenRouterBruto, "reasoning" | "supported_parameters">): string[] {
  const esforcos = o.reasoning?.supported_efforts;
  if (Array.isArray(esforcos) && esforcos.length) return ORDEM_DO_RACIOCINIO.filter((n) => esforcos.includes(n));
  if ((o.supported_parameters ?? []).includes("reasoning_effort")) return ["low", "medium", "high"];
  return [];
}

/** Recursos de um modelo de texto a partir da linha pública do OpenRouter. */
export function recursosDoOpenRouter(o: ModeloOpenRouterBruto): RecursosDoModelo {
  const params = o.supported_parameters ?? [];
  const entrada = o.architecture?.input_modalities ?? [];
  const p = o.pricing ?? {};
  const r = o.reasoning ?? null;
  const niveis = niveisDeRaciocinio(o);
  const padrao = r && typeof r.default_effort === "string" && niveis.includes(r.default_effort) ? r.default_effort : null;
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
    raciocinio_padrao: padrao,
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

// ------------------------------------------------------------ leitura na tela

export type LinhaComRecursos = {
  tipo?: string;
  raciocinio?: string[] | null;
  modalidades?: { entrada?: string[]; saida?: string[] } | null;
  recursos?: Partial<RecursosDoModelo> | null;
  criado_em?: string | null;
};

export interface CapacidadesNaTela {
  visao: boolean;
  ferramentas: boolean;
  raciocinio: boolean;
  json: boolean;
}

/**
 * O que a tela mostra ao lado do nome. Linha antiga (sem recursos) cai no que
 * o catálogo já tinha: visão pelas modalidades, raciocínio pelos níveis; o
 * resto fica falso até a próxima sincronização.
 */
export function capacidadesNaTela(m: LinhaComRecursos): CapacidadesNaTela {
  const r = m.recursos || {};
  const entrada = (m.modalidades && m.modalidades.entrada) || [];
  return {
    visao: r.visao === true || entrada.indexOf("image") >= 0,
    ferramentas: r.ferramentas === true,
    raciocinio: (m.raciocinio || []).length > 0,
    json: r.json === true,
  };
}

/** Lançado (ou entrou no catálogo) há menos de `dias` dias. */
export function lancadoHaPouco(m: LinhaComRecursos, agora = Date.now(), dias = 30): boolean {
  const quando = (m.recursos && m.recursos.lancado_em) || m.criado_em || null;
  if (!quando) return false;
  const t = new Date(quando).getTime();
  return Number.isFinite(t) && agora - t >= 0 && agora - t < dias * 86400000;
}

/**
 * Nível de raciocínio que vale para o modelo: o pedido quando o modelo aceita;
 * senão o padrão do provedor; senão o mais perto acima do pedido; senão o
 * maior. Modelo sem níveis: "" (o pedido vai sem raciocínio).
 */
export function raciocinioQueVale(m: LinhaComRecursos | null | undefined, pedido: string | null | undefined): string {
  const niveis = (m && m.raciocinio) || [];
  if (!niveis.length) return "";
  const p = String(pedido || "");
  if (p && niveis.indexOf(p) >= 0) return p;
  const padrao = m && m.recursos && m.recursos.raciocinio_padrao;
  if (!p && padrao && niveis.indexOf(padrao) >= 0) return padrao;
  const alvo = ORDEM_DO_RACIOCINIO.indexOf(p || "medium");
  const acima = niveis.filter((n) => ORDEM_DO_RACIOCINIO.indexOf(n) >= alvo).sort((a, b) => ORDEM_DO_RACIOCINIO.indexOf(a) - ORDEM_DO_RACIOCINIO.indexOf(b));
  if (acima.length) return acima[0];
  return niveis.slice().sort((a, b) => ORDEM_DO_RACIOCINIO.indexOf(a) - ORDEM_DO_RACIOCINIO.indexOf(b))[niveis.length - 1];
}
