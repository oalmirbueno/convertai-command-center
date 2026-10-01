/** Corpo dos pedidos de texto e leitura das respostas por provedor (MOD, 30/09/2026). Puro. Fontes: docs/motores/MODELOS.md. */

export type ImagemDoCorpo = { bytes: Uint8Array; mime: string };
export type MensagemDoCorpo = { papel: "usuario" | "agente"; conteudo: string; imagens?: ImagemDoCorpo[] };
export type EsquemaDoCorpo = { nome?: string; schema: Record<string, unknown> } | Record<string, unknown>;

export interface EntradaDoCorpo {
  sistema: string;
  mensagens: MensagemDoCorpo[];
  raciocinio?: string;
  pesquisaWeb?: boolean;
  dominiosWeb?: string[];
  esquemaJson?: EsquemaDoCorpo;
  maxTokensSaida?: number;
  /** Padrão: liga com sistema grande; "1h" ou false. */
  cachePrompt?: boolean | "1h";
}

export type FonteDaWeb = { url: string; titulo: string; trecho?: string };

export const TAMANHO_MINIMO_DO_CACHE = 4_000;
export const MAX_BUSCAS_POR_PEDIDO = 5;
export const MAX_DOMINIOS_NA_BUSCA = 20;
export const LOCAL_DA_BUSCA = { type: "approximate", country: "BR", timezone: "America/Sao_Paulo" } as const;

export function base64(bytes: Uint8Array): string {
  let s = "";
  const passo = 0x8000;
  for (let i = 0; i < bytes.length; i += passo) {
    s += String.fromCharCode(...Array.from(bytes.subarray(i, i + passo)));
  }
  return btoa(s);
}

const dataUrl = (img: ImagemDoCorpo) => `data:${img.mime};base64,${base64(img.bytes)}`;

export function nomeEsquema(e: EsquemaDoCorpo): { nome: string; schema: Record<string, unknown> } {
  const talvez = e as { nome?: string; schema?: unknown };
  if (talvez.schema && typeof talvez.schema === "object") {
    return { nome: (talvez.nome || "resposta").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64), schema: talvez.schema as Record<string, unknown> };
  }
  return { nome: "resposta", schema: e as Record<string, unknown> };
}

export function dominiosDaBusca(lista: unknown): string[] {
  const saida: string[] = [];
  for (const bruto of Array.isArray(lista) ? lista : []) {
    let d = String(bruto ?? "").trim().toLowerCase();
    if (!d) continue;
    d = d.replace(/^[a-z]+:\/\//, "").split("/")[0].replace(/^www\./, "").replace(/\.$/, "");
    if (/^([a-z0-9-]+\.)+[a-z]{2,63}$/.test(d) && saida.indexOf(d) < 0) saida.push(d);
    if (saida.length >= MAX_DOMINIOS_NA_BUSCA) break;
  }
  return saida;
}

export function usarCache(e: Pick<EntradaDoCorpo, "sistema" | "cachePrompt">): false | "5m" | "1h" {
  if (e.cachePrompt === false) return false;
  if (e.cachePrompt === "1h") return "1h";
  if (e.cachePrompt === true) return "5m";
  return String(e.sistema || "").length >= TAMANHO_MINIMO_DO_CACHE ? "5m" : false;
}

const marcaDeCache = (ttl: "5m" | "1h") => (ttl === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" });

export function corpoOpenAi(modeloApi: string, e: EntradaDoCorpo): Record<string, unknown> {
  const input = e.mensagens.map((msg) => {
    if (msg.papel === "agente") return { role: "assistant", content: msg.conteudo };
    if (!msg.imagens?.length) return { role: "user", content: msg.conteudo };
    return {
      role: "user",
      content: [
        { type: "input_text", text: msg.conteudo },
        ...msg.imagens.map((img) => ({ type: "input_image", image_url: dataUrl(img) })),
      ],
    };
  });
  const corpo: Record<string, unknown> = { model: modeloApi, instructions: e.sistema, input, store: false };
  if (e.raciocinio) corpo.reasoning = { effort: e.raciocinio };
  if (e.pesquisaWeb) {
    const busca: Record<string, unknown> = { type: "web_search", user_location: LOCAL_DA_BUSCA, search_context_size: "medium" };
    const dominios = dominiosDaBusca(e.dominiosWeb);
    if (dominios.length) busca.filters = { allowed_domains: dominios };
    corpo.tools = [busca];
    corpo.include = ["web_search_call.action.sources"];
  }
  if (e.esquemaJson) {
    const { nome, schema } = nomeEsquema(e.esquemaJson);
    corpo.text = { format: { type: "json_schema", name: nome, schema, strict: true } };
  }
  if (e.maxTokensSaida) corpo.max_output_tokens = e.maxTokensSaida;
  return corpo;
}

type RespostaOpenAi = {
  output_text?: string;
  output?: Array<{
    type?: string;
    action?: { sources?: Array<{ url?: string; title?: string }> };
    content?: Array<{ type?: string; text?: string; refusal?: string; annotations?: Array<{ type?: string; url?: string; title?: string }> }>;
  }>;
};

export function fontesDaOpenAi(data: RespostaOpenAi): FonteDaWeb[] {
  const fontes: FonteDaWeb[] = [];
  for (const item of data.output ?? []) {
    if (item.type === "message") {
      for (const c of item.content ?? []) {
        for (const a of c.annotations ?? []) if (a.type === "url_citation" && a.url) somarFonte(fontes, a.url, a.title);
      }
    }
  }
  for (const item of data.output ?? []) {
    if (item.type === "web_search_call") for (const s of item.action?.sources ?? []) if (s.url) somarFonte(fontes, s.url, s.title);
  }
  return fontes;
}

/** Busca com filtro dinâmico só nos Opus 4.6 a 5.5 e Sonnet 4.6 a 5.5; os demais, a básica. */
export function versaoDaBuscaAnthropic(modeloApi: string): "web_search_20260209" | "web_search_20250305" {
  const m = String(modeloApi || "").replace(/^anthropic\//, "").replace(/\./g, "-");
  return /^claude-(opus-(4-[678]|5|5-5)|sonnet-(4-6|5|5-5))(-|$)/.test(m) ? "web_search_20260209" : "web_search_20250305";
}

/** Aceita fallbacks "default": a recusa do classificador volta respondida por outro Claude. */
export function aceitaFallbackPadrao(modeloApi: string): boolean {
  return /^claude-(opus-5|opus-5-5|sonnet-5-5|fable-5-1)$/.test(String(modeloApi || ""));
}

export const BETA_DO_FALLBACK = "server-side-fallback-2026-07-01";

export function betasDoCorpoAnthropic(corpo: Record<string, unknown>): string {
  return corpo.fallbacks === "default" ? BETA_DO_FALLBACK : "";
}

export function corpoAnthropic(modeloApi: string, e: EntradaDoCorpo): Record<string, unknown> {
  const messages = e.mensagens.map((msg) => {
    if (msg.papel === "agente") return { role: "assistant", content: msg.conteudo };
    if (!msg.imagens?.length) return { role: "user", content: msg.conteudo };
    return {
      role: "user",
      content: [
        ...msg.imagens.map((img) => ({ type: "image", source: { type: "base64", media_type: img.mime, data: base64(img.bytes) } })),
        { type: "text", text: msg.conteudo },
      ],
    };
  });
  const cache = usarCache(e);
  const corpo: Record<string, unknown> = {
    model: modeloApi,
    max_tokens: e.maxTokensSaida ?? 16_000,
    system: cache ? [{ type: "text", text: e.sistema, cache_control: marcaDeCache(cache) }] : e.sistema,
    messages,
  };
  const outputConfig: Record<string, unknown> = {};
  if (e.raciocinio) {
    corpo.thinking = { type: "adaptive" };
    outputConfig.effort = e.raciocinio;
  }
  if (e.esquemaJson) outputConfig.format = { type: "json_schema", schema: nomeEsquema(e.esquemaJson).schema };
  if (Object.keys(outputConfig).length) corpo.output_config = outputConfig;
  if (e.pesquisaWeb) {
    const busca: Record<string, unknown> = { type: versaoDaBuscaAnthropic(modeloApi), name: "web_search", max_uses: MAX_BUSCAS_POR_PEDIDO, user_location: LOCAL_DA_BUSCA };
    const dominios = dominiosDaBusca(e.dominiosWeb);
    if (dominios.length) busca.allowed_domains = dominios;
    corpo.tools = [busca];
  }
  if (aceitaFallbackPadrao(modeloApi)) corpo.fallbacks = "default";
  return corpo;
}

type BlocoAnthropic = {
  type?: string;
  text?: string;
  citations?: Array<{ type?: string; url?: string; title?: string; cited_text?: string }>;
  content?: Array<{ type?: string; url?: string; title?: string }> | unknown;
};

export function fontesDaAnthropic(blocos: BlocoAnthropic[]): FonteDaWeb[] {
  const fontes: FonteDaWeb[] = [];
  for (const b of blocos) {
    if (b.type === "text") for (const c of b.citations ?? []) if (c.url) somarFonte(fontes, c.url, c.title, c.cited_text);
  }
  for (const b of blocos) {
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content as Array<{ type?: string; url?: string; title?: string }>) if (r.type === "web_search_result" && r.url) somarFonte(fontes, r.url, r.title);
    }
  }
  return fontes;
}

const ehClaude = (modeloApi: string) => /^anthropic\//.test(modeloApi);

export function corpoOpenRouter(modeloApi: string, e: EntradaDoCorpo): Record<string, unknown> {
  const cache = ehClaude(modeloApi) ? usarCache(e) : false;
  const messages: unknown[] = [
    cache ? { role: "system", content: [{ type: "text", text: e.sistema, cache_control: marcaDeCache(cache) }] } : { role: "system", content: e.sistema },
  ];
  for (const msg of e.mensagens) {
    if (msg.papel === "agente") { messages.push({ role: "assistant", content: msg.conteudo }); continue; }
    if (!msg.imagens?.length) { messages.push({ role: "user", content: msg.conteudo }); continue; }
    messages.push({
      role: "user",
      content: [
        { type: "text", text: msg.conteudo },
        ...msg.imagens.map((img) => ({ type: "image_url", image_url: { url: dataUrl(img) } })),
      ],
    });
  }
  const corpo: Record<string, unknown> = { model: modeloApi, messages };
  if (e.raciocinio) corpo.reasoning = { effort: e.raciocinio };
  if (e.pesquisaWeb) {
    const parametros: Record<string, unknown> = { engine: "auto", max_results: 5, max_uses: MAX_BUSCAS_POR_PEDIDO, user_location: LOCAL_DA_BUSCA };
    const dominios = dominiosDaBusca(e.dominiosWeb);
    if (dominios.length) parametros.allowed_domains = dominios;
    corpo.tools = [{ type: "openrouter:web_search", parameters: parametros }];
  }
  if (e.esquemaJson) {
    const { nome, schema } = nomeEsquema(e.esquemaJson);
    corpo.response_format = { type: "json_schema", json_schema: { name: nome, strict: true, schema } };
    corpo.provider = { require_parameters: true };
  }
  if (e.maxTokensSaida) corpo.max_tokens = e.maxTokensSaida;
  return corpo;
}

type RespostaOpenRouter = {
  choices?: Array<{ message?: { content?: string | null; annotations?: Array<{ type?: string; url_citation?: { url?: string; title?: string; content?: string } }> } }>;
};

export function fontesDoOpenRouter(data: RespostaOpenRouter): FonteDaWeb[] {
  const fontes: FonteDaWeb[] = [];
  for (const a of data.choices?.[0]?.message?.annotations ?? []) {
    const c = a.url_citation;
    if (a.type === "url_citation" && c && c.url) somarFonte(fontes, c.url, c.title, c.content);
  }
  return fontes;
}

function somarFonte(fontes: FonteDaWeb[], url: string, titulo?: string, trecho?: string) {
  const u = String(url).trim();
  if (!/^https?:\/\//i.test(u) || fontes.some((f) => f.url === u) || fontes.length >= 30) return;
  const f: FonteDaWeb = { url: u, titulo: String(titulo || "").trim().slice(0, 200) || u };
  const t = String(trecho || "").replace(/\s+/g, " ").trim();
  if (t) f.trecho = t.slice(0, 300);
  fontes.push(f);
}
