/**
 * Corpo dos pedidos de texto e leitura das respostas, por provedor (frente
 * MOD, 30/09/2026). Saiu de dentro do ia-motor para ser testado de verdade
 * (o teste monta o corpo e confere cada campo). Puro: sem Deno, sem rede.
 *
 * O que entrou nesta frente (conferido nas páginas oficiais em 29/09/2026;
 * fontes em docs/motores/MODELOS.md):
 * - Anthropic (Messages API): pensamento adaptativo com output_config.effort
 *   (low, medium, high, xhigh, max), saída em output_config.format
 *   json_schema, CACHE DE PROMPT no system (cache_control ephemeral, 5 min ou
 *   1 h; escrita 1,25x ou 2x, leitura 0,1x ou menos) e busca web de servidor
 *   (web_search_20250305: chamada direta, allowed_domains, user_location) com
 *   citação e fonte.
 * - OpenAI (Responses API): reasoning.effort, text.format json_schema estrito
 *   e web_search com filters.allowed_domains, user_location e as fontes
 *   (include web_search_call.action.sources); citações url_citation.
 * - OpenRouter (Chat Completions): reasoning.effort unificado, response_format
 *   json_schema com provider.require_parameters (só provedor que cumpre o
 *   esquema), cache_control repassado aos modelos Claude e a busca web pela
 *   ferramenta de servidor openrouter:web_search (engine auto = busca nativa
 *   do provedor quando existe; ":online" e o plugin "web" estão obsoletos),
 *   com as citações url_citation.
 */

export type ImagemDoCorpo = { bytes: Uint8Array; mime: string };
export type MensagemDoCorpo = { papel: "usuario" | "agente"; conteudo: string; imagens?: ImagemDoCorpo[] };
export type EsquemaDoCorpo = { nome?: string; schema: Record<string, unknown> } | Record<string, unknown>;

export interface EntradaDoCorpo {
  sistema: string;
  mensagens: MensagemDoCorpo[];
  raciocinio?: string;
  pesquisaWeb?: boolean;
  /** Só estes domínios na busca web (vazio = a web toda). */
  dominiosWeb?: string[];
  esquemaJson?: EsquemaDoCorpo;
  maxTokensSaida?: number;
  /**
   * Cache do prompt (Anthropic direta e Claude pelo OpenRouter). Padrão: liga
   * quando o sistema é grande (TAMANHO_MINIMO_DO_CACHE), porque as mesas mandam
   * o mesmo contexto do cliente várias vezes em poucos minutos. "1h" para
   * trabalho longo (escrita a 2x); false desliga.
   */
  cachePrompt?: boolean | "1h";
}

export type FonteDaWeb = { url: string; titulo: string; trecho?: string };

/** Cerca de 1.100 tokens: acima do mínimo de 512 (Claude 5.5) e 1.024 (Claude 5). Abaixo disso o cache não pega. */
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

/** Domínios limpos para a busca: "https://www.x.com/a" vira "x.com"; no máximo 20. */
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

/** O cache vale neste pedido? (padrão: sistema grande). */
export function usarCache(e: Pick<EntradaDoCorpo, "sistema" | "cachePrompt">): false | "5m" | "1h" {
  if (e.cachePrompt === false) return false;
  if (e.cachePrompt === "1h") return "1h";
  if (e.cachePrompt === true) return "5m";
  return String(e.sistema || "").length >= TAMANHO_MINIMO_DO_CACHE ? "5m" : false;
}

const marcaDeCache = (ttl: "5m" | "1h") => (ttl === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" });

// ------------------------------------------------------------------ OpenAI

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
  // Consultadas e não citadas entram depois das citadas.
  for (const item of data.output ?? []) {
    if (item.type === "web_search_call") for (const s of item.action?.sources ?? []) if (s.url) somarFonte(fontes, s.url, s.title);
  }
  return fontes;
}

// --------------------------------------------------------------- Anthropic

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
    // Com cache, o system vira bloco com cache_control (o prefixo tools + system fica guardado).
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
    const busca: Record<string, unknown> = { type: "web_search_20250305", name: "web_search", max_uses: MAX_BUSCAS_POR_PEDIDO, user_location: LOCAL_DA_BUSCA };
    const dominios = dominiosDaBusca(e.dominiosWeb);
    if (dominios.length) busca.allowed_domains = dominios;
    corpo.tools = [busca];
  }
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

// -------------------------------------------------------------- OpenRouter

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
  // O OpenRouter ja devolve usage.cost em toda resposta (usage.include foi aposentado).
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
    // Só provedor que cumpre o esquema (o mesmo modelo pode estar em vários).
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

// ------------------------------------------------------------------ comum

function somarFonte(fontes: FonteDaWeb[], url: string, titulo?: string, trecho?: string) {
  const u = String(url).trim();
  if (!/^https?:\/\//i.test(u) || fontes.some((f) => f.url === u) || fontes.length >= 30) return;
  const f: FonteDaWeb = { url: u, titulo: String(titulo || "").trim().slice(0, 200) || u };
  const t = String(trecho || "").replace(/\s+/g, " ").trim();
  if (t) f.trecho = t.slice(0, 300);
  fontes.push(f);
}

/** Bloco "Fontes" para colar no fim de um texto (a tela também recebe a lista). */
export function textoDasFontes(fontes: FonteDaWeb[]): string {
  if (!fontes.length) return "";
  return `Fontes:\n${fontes.map((f, i) => `${i + 1}. ${f.titulo} (${f.url})`).join("\n")}`;
}
