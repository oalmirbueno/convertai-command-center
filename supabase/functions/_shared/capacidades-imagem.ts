/**
 * Capacidades e preço dos modelos de imagem (docs/mesa-foto/MODELOS-E-CANVAS.md,
 * seções 2, 3 e 8.1). Lógica pura, sem rede e sem banco: o motor
 * (ia-motor.ts), a Mesa Foto (calculos.ts) e os testes usam o mesmo código.
 *
 * - Capacidades: quantas referências o modelo aceita, que resoluções e
 *   proporções, se aceita qualidade, semente e fundo transparente, e por qual
 *   API do OpenRouter ele vai ("imagens" = POST /api/v1/images; "chat" =
 *   chat/completions com modalities image+text). Vêm da coluna
 *   ia_modelos.capacidades (sincronizada da lista pública
 *   https://openrouter.ai/api/v1/images/models e de .../endpoints); sem ela,
 *   da tabela de famílias abaixo (conferida em 2026-09-24).
 * - Preço: por imagem na resolução pedida (chaves res_1K, res_2K, res_4K em
 *   preco_imagem), por megapixel (por_megapixel) ou por token de saída
 *   (saida_imagem_1m, com os tokens por resolução de cada família). Sem nada
 *   disso vale o preço por qualidade de antes (baixa, media, alta).
 */

export type Resolucao = "512" | "1K" | "2K" | "4K";
export const RESOLUCOES: Resolucao[] = ["512", "1K", "2K", "4K"];

export type PrecoDeEndpoint = { cobra: string; unidade: string; variante: string | null; usd: number };

export type CapacidadesImagem = {
  /** Por onde o modelo vai no OpenRouter. */
  api?: "imagens" | "chat";
  /** Máximo de imagens de entrada (referências e a imagem editada). */
  refs_max?: number;
  resolucoes?: string[];
  proporcoes?: string[];
  /** Qualidades aceitas no vocabulário do provedor (low, medium, high...). */
  qualidades?: string[];
  fundo_transparente?: boolean;
  seed?: boolean;
  formatos_saida?: string[];
  precos?: PrecoDeEndpoint[];
  fonte?: string;
};

type ModeloComCapacidades = {
  provedor: string;
  modelo_api: string;
  capacidades?: CapacidadesImagem | null;
  modalidades?: { entrada?: string[]; saida?: string[] } | null;
};

const PROPORCOES_GPT = ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"];
const PROPORCOES_GEMINI = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
const PROPORCOES_SEEDREAM = ["1:1", "1:2", "2:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
const PROPORCOES_FLUX = ["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9"];
const PROPORCOES_MAI = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"];
const PROPORCOES_KREA = ["1:1", "4:3", "3:2", "16:9", "4:5", "2:3", "9:16"];
const PROPORCOES_QWEN = ["1:1", "1:2", "2:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9"];

/**
 * Famílias conhecidas (lista pública do OpenRouter, 2026-09-24). A primeira
 * que casar vale; a coluna capacidades do catálogo, quando existe, manda.
 */
const FAMILIAS: { padrao: RegExp; caps: CapacidadesImagem }[] = [
  { padrao: /^openai\/gpt-image/, caps: { api: "imagens", refs_max: 16, resolucoes: [], proporcoes: PROPORCOES_GPT, qualidades: ["low", "medium", "high"], fundo_transparente: true, seed: false } },
  { padrao: /^google\/gemini-3-pro-image/, caps: { api: "chat", refs_max: 14, resolucoes: ["1K", "2K", "4K"], proporcoes: PROPORCOES_GEMINI, fundo_transparente: false } },
  { padrao: /^google\/gemini-3\.1-flash-lite-image/, caps: { api: "chat", refs_max: 14, resolucoes: ["1K"], proporcoes: PROPORCOES_GEMINI, fundo_transparente: false } },
  { padrao: /^google\/gemini-3\.1-flash-image/, caps: { api: "chat", refs_max: 14, resolucoes: ["512", "1K", "2K", "4K"], proporcoes: PROPORCOES_GEMINI, fundo_transparente: false } },
  { padrao: /^google\/gemini/, caps: { api: "chat", refs_max: 14, resolucoes: [], proporcoes: PROPORCOES_GEMINI, fundo_transparente: false } },
  { padrao: /^bytedance-seed\/seedream-5-0-pro/, caps: { api: "imagens", refs_max: 14, resolucoes: ["1K", "2K"], proporcoes: PROPORCOES_SEEDREAM, seed: true } },
  { padrao: /^bytedance-seed\/seedream-5-0-lite/, caps: { api: "imagens", refs_max: 14, resolucoes: ["2K", "4K"], proporcoes: PROPORCOES_SEEDREAM, seed: true } },
  { padrao: /^bytedance-seed\/seedream/, caps: { api: "imagens", refs_max: 14, resolucoes: ["1K", "2K", "4K"], proporcoes: PROPORCOES_SEEDREAM, seed: true } },
  { padrao: /^sourceful\/riverflow-v2\.5-fast/, caps: { api: "imagens", refs_max: 4, resolucoes: ["1K", "2K"], proporcoes: PROPORCOES_FLUX, fundo_transparente: true } },
  { padrao: /^sourceful\/riverflow-v2-fast/, caps: { api: "imagens", refs_max: 4, resolucoes: ["1K", "2K", "4K"], proporcoes: PROPORCOES_FLUX } },
  { padrao: /^sourceful\/riverflow/, caps: { api: "imagens", refs_max: 10, resolucoes: ["1K", "2K", "4K"], proporcoes: PROPORCOES_FLUX, fundo_transparente: true, formatos_saida: ["png", "jpeg", "webp"] } },
  { padrao: /^black-forest-labs\/flux\.2-klein/, caps: { api: "imagens", refs_max: 4, resolucoes: [], proporcoes: PROPORCOES_FLUX, seed: true, formatos_saida: ["png", "jpeg"] } },
  { padrao: /^black-forest-labs\/flux/, caps: { api: "imagens", refs_max: 8, resolucoes: [], proporcoes: PROPORCOES_FLUX, seed: true, formatos_saida: ["png", "jpeg"] } },
  { padrao: /^microsoft\/mai-image-2\.6/, caps: { api: "imagens", refs_max: 5, resolucoes: [], proporcoes: PROPORCOES_MAI } },
  { padrao: /^microsoft\/mai-image/, caps: { api: "imagens", refs_max: 1, resolucoes: [], proporcoes: PROPORCOES_MAI } },
  { padrao: /^qwen\/qwen-image/, caps: { api: "imagens", refs_max: 4, resolucoes: ["1K", "2K"], proporcoes: PROPORCOES_QWEN, seed: true } },
  { padrao: /^x-ai\/grok-imagine/, caps: { api: "imagens", refs_max: 3, resolucoes: ["1K", "2K"], proporcoes: PROPORCOES_MAI, qualidades: ["low", "medium"] } },
  { padrao: /^krea\//, caps: { api: "imagens", refs_max: 1, resolucoes: ["1K"], proporcoes: PROPORCOES_KREA, seed: true } },
];

const numero = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
};

/**
 * Resoluções que o provedor RECUSA embora a lista pública do OpenRouter (ou a
 * família acima) diga que aceita. Erro real de 26/09/2026 no "Detalhar em 4K":
 * "image_size '4K' is not supported by google/gemini-3-pro-image; only
 * google/gemini-3-pro-image-preview and google/gemini-3.1-flash-image-preview
 * support 4K". As versões normais ficam em 1K e 2K; as preview fazem 4K.
 * Vale na sincronização do catálogo (capacidadesDaListaDeImagens, que monta
 * a coluna ia_modelos.capacidades) e na leitura (capacidadesDoModelo), para a
 * próxima sincronização não voltar a marcar 4K nos modelos normais e o motor
 * nunca mandar 4K a quem não aceita. Casa o slug EXATO (a preview não entra).
 */
export const RESOLUCOES_RECUSADAS: { slug: string; recusa: Resolucao[]; motivo: string }[] = [
  {
    slug: "google/gemini-3-pro-image",
    recusa: ["4K"],
    motivo: "OpenRouter, 26/09/2026: image_size 4K só em google/gemini-3-pro-image-preview e google/gemini-3.1-flash-image-preview.",
  },
  {
    slug: "google/gemini-3.1-flash-image",
    recusa: ["4K"],
    motivo: "OpenRouter, 26/09/2026: image_size 4K só em google/gemini-3-pro-image-preview e google/gemini-3.1-flash-image-preview.",
  },
];

/** Modelos que fazem 4K de verdade (conferidos no erro de 26/09/2026), na ordem de preferência para pessoa. */
export const MODELOS_4K_CONFERIDOS = ["google/gemini-3-pro-image-preview", "google/gemini-3.1-flash-image-preview"];

/** Tira da lista as resoluções que o provedor recusa para este slug (sem o prefixo openrouter:). */
export function semResolucoesRecusadas(slug: string, resolucoes: string[] | undefined): string[] {
  const lista = Array.isArray(resolucoes) ? resolucoes : [];
  const s = String(slug || "").replace(/^openrouter:/, "");
  const regra = RESOLUCOES_RECUSADAS.find((r) => r.slug === s);
  return regra ? lista.filter((r) => !(regra.recusa as string[]).includes(r)) : lista;
}

/**
 * Capacidades de um modelo de imagem: a coluna do catálogo por cima da
 * família conhecida. Modelo do OpenRouter fora da tabela vai pela API de
 * imagens quando só devolve imagem (sem texto na saída); senão pelo chat,
 * como sempre foi. OpenAI direta: GPT Image com 16 referências.
 */
export function capacidadesDoModelo(m: ModeloComCapacidades): CapacidadesImagem {
  const doCatalogo = (m.capacidades && typeof m.capacidades === "object" ? m.capacidades : {}) as CapacidadesImagem;
  if (m.provedor === "openai") {
    return { api: "imagens", refs_max: 16, resolucoes: [], proporcoes: PROPORCOES_GPT, qualidades: ["low", "medium", "high"], fundo_transparente: /^gpt-image/.test(m.modelo_api), seed: false, ...doCatalogo };
  }
  const familia = FAMILIAS.find((f) => f.padrao.test(m.modelo_api))?.caps;
  const saida = m.modalidades?.saida;
  const apiPadrao: "imagens" | "chat" = Array.isArray(saida) && saida.length > 0 && !saida.includes("text") ? "imagens" : "chat";
  const base: CapacidadesImagem = familia ?? { api: apiPadrao, refs_max: 8, resolucoes: [], fundo_transparente: false, seed: false };
  const junto: CapacidadesImagem = { ...base };
  for (const [k, v] of Object.entries(doCatalogo)) {
    if (v !== undefined && v !== null) (junto as Record<string, unknown>)[k] = v;
  }
  // GPT Image fica sempre na API de imagens (o motor já usa esse caminho).
  if (/^openai\/gpt-image/.test(m.modelo_api)) junto.api = "imagens";
  if (junto.api !== "imagens" && junto.api !== "chat") junto.api = base.api ?? apiPadrao;
  if (!(numero(junto.refs_max) >= 0)) junto.refs_max = base.refs_max ?? 8;
  // Exceção conhecida (RESOLUCOES_RECUSADAS): mesmo com o catálogo antigo dizendo 4K, não vai.
  junto.resolucoes = semResolucoesRecusadas(m.modelo_api, junto.resolucoes);
  return junto;
}

/** Limite de imagens de entrada do modelo (a coluna do catálogo ou a família). */
export function limiteDeReferencias(m: ModeloComCapacidades): number {
  const n = Math.floor(numero(capacidadesDoModelo(m).refs_max));
  return n >= 0 ? n : 8;
}

export const ehResolucao = (v: unknown): v is Resolucao => RESOLUCOES.includes(String(v) as Resolucao);

/** Resolução vinda da tela ("2k", "2K", "4K"); inválida vira null. */
export function lerResolucao(v: unknown): Resolucao | null {
  if (v == null || v === "") return null;
  const s = String(v).trim().toUpperCase();
  const r = s === "512" ? "512" : s;
  return ehResolucao(r) ? r : null;
}

/**
 * Resolução que vai ao provedor. Sem pedido: nenhuma (o modelo usa a dele).
 * Pedido que o modelo aceita: ela mesma. Senão a maior aceita abaixo da
 * pedida (ou a menor aceita) com aviso; modelo sem resolução: nada, com aviso.
 */
export function resolucaoParaModelo(caps: CapacidadesImagem, pedida: Resolucao | null | undefined): { resolucao: Resolucao | null; aviso: string | null } {
  if (!pedida) return { resolucao: null, aviso: null };
  const aceitas = (caps.resolucoes ?? []).filter(ehResolucao) as Resolucao[];
  if (!aceitas.length) return { resolucao: null, aviso: `Este modelo não escolhe resolução: a imagem sai no tamanho padrão dele (pedido ${pedida}).` };
  if (aceitas.includes(pedida)) return { resolucao: pedida, aviso: null };
  const ordem = (r: Resolucao) => RESOLUCOES.indexOf(r);
  const abaixo = aceitas.filter((r) => ordem(r) < ordem(pedida)).sort((a, b) => ordem(b) - ordem(a))[0];
  const escolhida = abaixo ?? aceitas.sort((a, b) => ordem(a) - ordem(b))[0];
  return { resolucao: escolhida, aviso: `Este modelo não gera em ${pedida}: a imagem sai em ${escolhida}.` };
}

/** O modelo gera na resolução pedida (sem ajuste). */
export const aceitaResolucao = (caps: CapacidadesImagem, r: Resolucao) => (caps.resolucoes ?? []).includes(r);

/** Proporção "l:a" do tamanho em pixels ("1088x1360") ou a própria proporção. */
function razao(tamanhoOuProporcao: string): number | null {
  const s = String(tamanhoOuProporcao || "");
  const m = s.match(/^(\d+(?:\.\d+)?)\s*[x:]\s*(\d+(?:\.\d+)?)$/i);
  if (!m) return null;
  const l = Number(m[1]);
  const a = Number(m[2]);
  return l > 0 && a > 0 ? l / a : null;
}

/** A proporção aceita pelo modelo mais perto do tamanho pedido (o código recorta depois, se precisar). */
export function proporcaoEntre(tamanhoOuProporcao: string, aceitas: string[] | undefined, padrao = "2:3"): string {
  const lista = (aceitas ?? []).filter((p) => p !== "auto" && razao(p) != null);
  const alvo = razao(tamanhoOuProporcao);
  if (!lista.length) return alvo == null ? padrao : String(tamanhoOuProporcao).includes(":") ? String(tamanhoOuProporcao) : padrao;
  if (alvo == null) return lista.includes(padrao) ? padrao : lista[0];
  let melhor = lista[0];
  let dif = Infinity;
  for (const p of lista) {
    const d = Math.abs(Math.log(razao(p)! / alvo));
    if (d < dif) { dif = d; melhor = p; }
  }
  return melhor;
}

/** Qualidade da casa (baixa, media, alta) no vocabulário que o modelo aceita; null quando ele não tem qualidade. */
export function qualidadeParaModelo(caps: CapacidadesImagem, q: "baixa" | "media" | "alta"): string | null {
  const aceitas = caps.qualidades ?? [];
  if (!aceitas.length) return null;
  const desejada = q === "baixa" ? "low" : q === "media" ? "medium" : "high";
  if (aceitas.includes(desejada)) return desejada;
  const escala = ["low", "medium", "high"];
  const alvo = escala.indexOf(desejada);
  const abaixo = escala.slice(0, alvo + 1).reverse().find((x) => aceitas.includes(x));
  return abaixo ?? aceitas.find((x) => escala.includes(x)) ?? null;
}

/**
 * Imagens de entrada dentro do limite do modelo, EM ORDEM (quem chama já pôs
 * a identidade primeiro): a imagem editada, depois as referências. O que
 * passa do limite fica de fora, com aviso.
 */
export function referenciasNoLimite<T>(editar: T | null, referencias: T[], limite: number): { imagens: T[]; cortadas: number; aviso: string | null } {
  const todas = [...(editar ? [editar] : []), ...referencias];
  const max = Math.max(0, Math.floor(limite));
  if (todas.length <= max) return { imagens: todas, cortadas: 0, aviso: null };
  const cortadas = todas.length - max;
  return {
    imagens: todas.slice(0, max),
    cortadas,
    aviso: `${cortadas} ${cortadas === 1 ? "imagem de referência ficou" : "imagens de referência ficaram"} de fora: este modelo aceita no máximo ${max}.`,
  };
}

// ------------------------------------------------------------------ preço

/** Megapixels aproximados de cada resolução (lado maior 512, 1024, 2048, 4096). */
export const MEGAPIXELS_DA_RESOLUCAO: Record<Resolucao, number> = { "512": 0.27, "1K": 1.05, "2K": 4.2, "4K": 16.8 };

/**
 * Tokens de saída de uma imagem, por família e resolução (preço oficial do
 * Google dividido pelo preço por token: Nano Banana Pro US$ 0,134 em 1K e 2K
 * e US$ 0,24 em 4K a US$ 120 por 1M; Nano Banana 2 US$ 0,045 / 0,067 / 0,101
 * / 0,151 a US$ 60 por 1M). Outros modelos cobrados por token: cerca de 1.100
 * tokens por imagem 1K (MAI-Image-2.6 sai por volta de US$ 0,04).
 */
export function tokensDeSaidaDaImagem(modeloApi: string, r: Resolucao | null): number {
  const res = r ?? "1K";
  if (/gemini-3-pro-image/.test(modeloApi)) return { "512": 1120, "1K": 1120, "2K": 1120, "4K": 2000 }[res];
  if (/gemini/.test(modeloApi)) return { "512": 750, "1K": 1120, "2K": 1680, "4K": 2520 }[res];
  return { "512": 560, "1K": 1100, "2K": 1680, "4K": 2520 }[res];
}

type TabelaDePreco = Record<string, number> | null | undefined;

/**
 * Preço de UMA imagem de saída pela tabela do catálogo: res_<resolução> quando
 * existe; senão por megapixel; senão por token de saída (quando pedida uma
 * resolução); senão o preço por qualidade de antes.
 */
export function precoPorImagem(
  m: { modelo_api: string; preco_imagem?: TabelaDePreco },
  qualidade: "baixa" | "media" | "alta" = "media",
  resolucao: Resolucao | null = null,
  tamanho?: string | null,
): number {
  const t = m.preco_imagem ?? {};
  if (resolucao && t[`res_${resolucao}`] != null) return numero(t[`res_${resolucao}`]);
  if (t.por_megapixel != null) {
    const px = tamanho && /^\d+x\d+$/.test(tamanho) ? tamanho.split("x").map(Number) : null;
    const mp = resolucao ? MEGAPIXELS_DA_RESOLUCAO[resolucao] : px ? (px[0] * px[1]) / 1_000_000 : MEGAPIXELS_DA_RESOLUCAO["1K"];
    return arred(numero(t.por_megapixel) * mp);
  }
  if (resolucao && t.saida_imagem_1m != null) return arred((numero(t.saida_imagem_1m) / 1_000_000) * tokensDeSaidaDaImagem(m.modelo_api, resolucao));
  return numero(t[qualidade] ?? t.media);
}

const arred = (v: number) => Math.round(v * 1_000_000) / 1_000_000;

// ------------------------------------------------- lista de imagens do OpenRouter

export const OPENROUTER_IMAGENS_URL = "https://openrouter.ai/api/v1/images/models";
export const urlDosEndpointsDeImagem = (slug: string) => `https://openrouter.ai/api/v1/images/models/${slug}/endpoints`;

type ParametroOpenRouter = { type?: string; values?: unknown[]; min?: number; max?: number };
export type ModeloDeImagemOpenRouter = {
  id?: string;
  name?: string;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  supported_parameters?: Record<string, ParametroOpenRouter>;
};
export type EndpointDeImagemOpenRouter = {
  provider_slug?: string;
  supported_parameters?: Record<string, ParametroOpenRouter>;
  pricing?: { billable?: string; unit?: string; cost_usd?: number | string; variant?: string }[];
};

const valores = (p: ParametroOpenRouter | undefined): string[] =>
  Array.isArray(p?.values) ? p!.values!.map((v) => String(v)) : [];

/**
 * Capacidades a partir da lista pública de imagens do OpenRouter (parâmetros
 * do modelo; os do primeiro endpoint mandam quando existem). Saída com texto
 * (Gemini) segue no chat; saída só de imagem vai pela API de imagens.
 */
export function capacidadesDaListaDeImagens(o: ModeloDeImagemOpenRouter, endpoint?: EndpointDeImagemOpenRouter | null): CapacidadesImagem {
  const p = { ...(o.supported_parameters ?? {}), ...(endpoint?.supported_parameters ?? {}) };
  const saida = o.architecture?.output_modalities ?? [];
  const slug = String(o.id ?? "");
  const refs = p.input_references;
  const qualidades = valores(p.quality).filter((q) => q !== "auto");
  return {
    api: /^openai\/gpt-image/.test(slug) || !saida.includes("text") ? "imagens" : "chat",
    refs_max: typeof refs?.max === "number" && refs.max >= 0 ? refs.max : 0,
    // A lista pública ainda diz 4K no gemini-3-pro-image normal; o provedor recusa (RESOLUCOES_RECUSADAS).
    resolucoes: semResolucoesRecusadas(slug, valores(p.resolution).filter(ehResolucao)),
    proporcoes: valores(p.aspect_ratio).filter((a) => a !== "auto"),
    qualidades,
    fundo_transparente: valores(p.background).includes("transparent"),
    seed: !!p.seed,
    formatos_saida: valores(p.output_format),
  };
}

/** Preços do endpoint no formato do catálogo (unidade image, megapixel ou token). */
export function precosDoEndpoint(endpoint?: EndpointDeImagemOpenRouter | null): PrecoDeEndpoint[] {
  return (endpoint?.pricing ?? [])
    .map((x) => ({ cobra: String(x.billable ?? ""), unidade: String(x.unit ?? ""), variante: x.variant ? String(x.variant) : null, usd: numero(x.cost_usd) }))
    .filter((x) => x.cobra && x.unidade && x.usd >= 0);
}

/**
 * preco_imagem do catálogo a partir dos preços do endpoint:
 * - por imagem: res_<R> para cada resolução aceita (variante "2k"/"4k" ou
 *   "high_resolution" para acima da menor; sem variante, a menor);
 * - por megapixel: por_megapixel;
 * - por token: saida_imagem_1m e res_<R> pelos tokens da família;
 * - entrada: entrada_por_imagem (por imagem) ou entrada_imagem_1m (por token).
 * baixa, media e alta recebem o preço da menor resolução (o seletor de
 * modelos e a rota de reserva leem essas chaves).
 */
export function precoImagemDoEndpoint(slug: string, caps: CapacidadesImagem, precos: PrecoDeEndpoint[]): {
  preco_imagem: Record<string, number> | null;
  preco_entrada_1m: number;
  preco_saida_1m: number;
} {
  const saidas = precos.filter((p) => p.cobra === "output_image");
  const tabela: Record<string, number> = {};
  const resolucoes = ((caps.resolucoes ?? []).filter(ehResolucao) as Resolucao[]).sort((a, b) => RESOLUCOES.indexOf(a) - RESOLUCOES.indexOf(b));
  const menor = resolucoes[0] ?? null;
  let precoSaidaToken = 0;

  const porImagem = saidas.filter((p) => p.unidade === "image");
  if (porImagem.length) {
    const base = porImagem.find((p) => !p.variante)?.usd ?? porImagem[0].usd;
    const alta = porImagem.find((p) => p.variante === "high_resolution")?.usd;
    const lista = resolucoes.length ? resolucoes : (["1K"] as Resolucao[]);
    for (const r of lista) {
      const exata = porImagem.find((p) => (p.variante ?? "").toLowerCase() === r.toLowerCase())?.usd;
      tabela[`res_${r}`] = arred(exata ?? (r !== (menor ?? "1K") && alta != null ? alta : base));
    }
    const padrao = tabela[`res_${menor ?? "1K"}`] ?? base;
    tabela.baixa = tabela.media = tabela.alta = arred(padrao);
  }
  const porMp = saidas.find((p) => p.unidade === "megapixel");
  if (!porImagem.length && porMp) {
    tabela.por_megapixel = arred(porMp.usd);
    const padrao = arred(porMp.usd * MEGAPIXELS_DA_RESOLUCAO["1K"]);
    tabela.baixa = tabela.media = tabela.alta = padrao;
  }
  const porToken = saidas.find((p) => p.unidade === "token");
  if (!porImagem.length && !porMp && porToken) {
    precoSaidaToken = arred(porToken.usd * 1_000_000);
    tabela.saida_imagem_1m = precoSaidaToken;
    const lista = resolucoes.length ? resolucoes : [null];
    for (const r of lista) {
      if (r) tabela[`res_${r}`] = arred(porToken.usd * tokensDeSaidaDaImagem(slug, r));
    }
    const padrao = arred(porToken.usd * tokensDeSaidaDaImagem(slug, menor));
    tabela.baixa = tabela.media = tabela.alta = padrao;
  }
  const entradaImagem = precos.find((p) => p.cobra === "input_image");
  if (entradaImagem?.unidade === "image") tabela.entrada_por_imagem = arred(entradaImagem.usd);
  if (entradaImagem?.unidade === "token") tabela.entrada_imagem_1m = arred(entradaImagem.usd * 1_000_000);
  const entradaTexto = precos.find((p) => p.cobra === "input_text" && p.unidade === "token");
  return {
    preco_imagem: Object.keys(tabela).some((k) => k === "media") ? tabela : null,
    preco_entrada_1m: entradaTexto ? arred(entradaTexto.usd * 1_000_000) : 0,
    preco_saida_1m: precoSaidaToken,
  };
}

/** Preço das imagens de entrada (modelos que cobram por imagem de referência). */
export function precoDasEntradas(m: { preco_imagem?: TabelaDePreco }, imagensDeEntrada: number): number {
  const t = m.preco_imagem ?? {};
  return t.entrada_por_imagem != null ? arred(numero(t.entrada_por_imagem) * Math.max(0, imagensDeEntrada)) : 0;
}
